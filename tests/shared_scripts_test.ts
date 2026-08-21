// Every shared classic script the apps load must exist and must parse.
//
// WHY THIS FILE EXISTS: a syntax error in common.js, payroll.js or hr-docs.js white-screens HR OS or
// Finance OS for every user, exactly like one inside the inline <script> — the browser stops at the
// broken file and the inline script never runs. CI covers `common.js` by NAME (an explicit `cp
// common.js .ci/common.js` step in .github/workflows/ci.yml; there is no glob), so a shared file added
// later ships with no parse coverage at all unless someone remembers to edit that step.
//
// This closes that gap from the tests side instead, which is where it belongs: the list is read from the
// pages' own <script src=> tags, so a fourth shared file is covered the moment an app loads it, with no
// workflow edit and nothing to remember. `deno test --allow-read tests/` is the last step of CI, so this
// runs there too.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { inlineScript, sharedScripts } from "../tools/extract.ts";

const APPS = ["app.html", "hros.html"];

for (const app of APPS) {
  const html = await Deno.readTextFile(new URL("../" + app, import.meta.url));
  const shared = sharedScripts(html);

  Deno.test(app + " loads at least one shared script, and every one of them parses", () => {
    // Fail-closed: no shared files found means the tag matcher broke, and "nothing to check" would
    // otherwise read as a pass while common.js sat unparsed.
    assert(shared.length > 0, app + " loads no shared <script src=> files — the matcher is broken");

    for (const src of shared) {
      const text = Deno.readTextFileSync(new URL("../" + src, import.meta.url));
      assert(text.length > 0, src + " is empty — " + app + " loads it, so that is a white screen");
      // new Function() parses without running: a SyntaxError here is what the user's browser would hit.
      new Function(text);
    }
  });

  Deno.test(app + "'s shared scripts are all inside inlineScript()", () => {
    // The render goldens and the engine tests evaluate inlineScript(). If a shared file stopped being
    // included, every symbol in it would silently become undeclared and the suite would go on passing
    // against code the browser never runs.
    const full = inlineScript(html);
    for (const src of shared) {
      const text = Deno.readTextFileSync(new URL("../" + src, import.meta.url));
      assert(full.includes(text), src + " is loaded by " + app + " but missing from inlineScript()");
    }
  });
}

Deno.test("the vendored libraries stay out of inlineScript()", () => {
  // Concatenating a megabyte of minified SheetJS in front of every render would cost more than the whole
  // suite, and nothing here looks a symbol up inside them.
  const html = Deno.readTextFileSync(new URL("../app.html", import.meta.url));
  assertEquals(sharedScripts(html).filter((s) => s.endsWith(".min.js")), []);
});
