// A shared root .js must not schedule work that reads the page — CLAUDE.md's rule for these files.
//
// WHY THIS FILE EXISTS: `ctg-shell.js` arrived as a drop-in bundle ending in
// `window.addEventListener('load', build)`. In a browser that is correct: it re-runs after `showApp()`
// reveals #app. But these files are also CONCATENATED AND EVALUATED by tests/render_harness.ts with no
// browser attached, and Deno dispatches a REAL `load` event — so `build()` ran outside any browser,
// after the harness had torn its stub document down, and threw
// "Cannot read properties of undefined (reading 'getElementById')".
//
// The shape of that failure is the point. `tools/render_probe.ts` printed **"wrote 42/42 goldens"** and
// THEN crashed on the load event, so it exits non-zero under a success message — in CI, a red step whose
// visible output says everything worked. `deno test` did not catch it either, which is why this file is
// not redundant with the golden run sitting next to it.
//
// The rule is CLAUDE.md's, verbatim: "Nothing runs at load time that reads per-app state." Registering a
// listener is fine; registering one that cannot survive being fired without a DOM is not.

import { assertEquals } from "jsr:@std/assert@1";
import { sharedScripts } from "../tools/extract.ts";

const ROOT = new URL("../", import.meta.url);

/** Both apps' shared root scripts, deduped. `sharedScripts` already skips vendored *.min.js. */
async function sharedFiles(): Promise<string[]> {
  const out = new Set<string>();
  for (const page of ["app.html", "hros.html"]) {
    for (const f of sharedScripts(await Deno.readTextFile(new URL(page, ROOT)))) out.add(f);
  }
  return [...out].sort();
}

/** Comments quote these idioms while explaining why they are avoided — strip them before matching. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

Deno.test("the shared-script inventory is not empty", async () => {
  const files = await sharedFiles();
  // Guard the guard: an extraction that silently returns [] makes every assertion below vacuous.
  assertEquals(files.length > 3, true, "sharedScripts() found almost nothing (" + files.join(", ") + ")");
});

Deno.test("a shared root .js that hooks load / DOMContentLoaded also guards for a missing DOM", async () => {
  const offenders: string[] = [];
  for (const f of await sharedFiles()) {
    let src: string;
    try { src = codeOnly(await Deno.readTextFile(new URL(f, ROOT))); } catch { continue; }
    const hooks = /addEventListener\s*\(\s*['"](?:load|DOMContentLoaded)['"]/.test(src);
    if (!hooks) continue;
    // A guard is any test that the host actually has a document before the handler touches one.
    const guarded = /typeof\s+document\s*[!=]==?\s*['"]undefined['"]/.test(src) ||
      /typeof\s+document\.getElementById\s*===?\s*['"]function['"]/.test(src);
    if (!guarded) offenders.push(f);
  }
  assertEquals(offenders, [], "these hook a page-lifecycle event and would throw when it fires with no " +
    "document — which is exactly what tools/render_probe.ts does AFTER writing all 42 goldens, so the " +
    "tool fails with 'wrote 42/42 goldens' as its last visible line: " + offenders.join(", "));
});

Deno.test("no shared root .js touches the page at the TOP level", async () => {
  // The load-time rule's other half. A bare `document.` / `window.` statement outside any function runs
  // the moment the harness evaluates the file, before any test has set anything up.
  const offenders: string[] = [];
  for (const f of await sharedFiles()) {
    let src: string;
    try { src = codeOnly(await Deno.readTextFile(new URL(f, ROOT))); } catch { continue; }
    for (const line of src.split("\n")) {
      // Top level = column 0. Anything indented is inside a function or an IIFE and is not load-time.
      if (/^(?:document|window)\s*\./.test(line)) { offenders.push(f + ": " + line.trim().slice(0, 60)); break; }
    }
  }
  assertEquals(offenders, [], "these read the page at load time, so merely LOADING the file in the " +
    "offline harness runs them: " + offenders.join(" | "));
});
