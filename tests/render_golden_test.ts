// Every screen in both apps still renders the same HTML.
//
// WHY THIS FILE EXISTS: render_smoke_test.ts exists because v205 shipped a ReferenceError inside
// hrPayroll() that lint could not see, the parse gate could not see, and no test could see because no
// test had ever CALLED a renderer — the operator found it, as a spinner that never stopped. That fix
// covered two screens. This covers all forty, and takes it one step further: not just "it did not
// throw", but "it produced exactly this HTML".
//
// The goldens under tests/golden/ were captured from the current code and ARE the contract, the same
// arrangement tests/route_parity.golden.jsonl has for the router. A screen that quietly loses a column,
// renames a button, drops a total or stops wiring an onclick shows up here as a diff and nowhere else.
// (`deno lint` and the HTML parse gate both stay green through every one of those.)
//
// It is offline and credential-free by construction: fetch is answered from tests/render_fixtures.ts,
// the clock and timezone are pinned, and Math.random is stubbed. No browser, no database, no token.
//
// If you change a screen ON PURPOSE, regenerate and read the diff before committing:
//   deno run -A tools/render_probe.ts tests/golden
//
// Not covered, deliberately: see COVERAGE.md next to this file for the four surfaces whose goldens
// record a narrower slice than the screen has, and why.

import { assertEquals, fail } from "jsr:@std/assert@1";
import { renderSurface, SURFACES } from "./render_surfaces.ts";

const GOLDEN = new URL("./golden/", import.meta.url);

Deno.test("the surface inventory matches the goldens on disk — no screen silently added or dropped", async () => {
  const onDisk: string[] = [];
  for await (const e of Deno.readDir(GOLDEN)) if (e.isFile && e.name.endsWith(".html")) onDisk.push(e.name.slice(0, -5));
  assertEquals(onDisk.sort(), SURFACES.map((s) => s.id).sort(),
    "tests/golden/ and SURFACES disagree — regenerate with: deno run -A tools/render_probe.ts tests/golden");
});

Deno.test("all 41 rendered surfaces are covered", () => {
  assertEquals(SURFACES.length, 41);
  assertEquals(SURFACES.filter((s) => s.app === "app.html").length, 22, "Finance OS tabs");
  assertEquals(SURFACES.filter((s) => s.app === "hros.html").length, 19,
    "HR OS views (13) + dashboard sub-pages (5) + the employee half of Leave (hros.html:1553)");
  assertEquals(new Set(SURFACES.map((s) => s.id)).size, 41, "duplicate surface id");
});

/**
 * A readable failure. `assertEquals` on two 60 KB documents prints both of them, which in CI scrolls the
 * actual change off the screen and trains everyone to skim past a red build.
 *
 * So trim the identical head and the identical tail and print only the window between them. A naive
 * line-by-line comparison is no good either: deleting one `<th>` shifts every following line, and
 * "53 lines changed" for a one-column edit reads like the harness is broken. Trimming both ends reports
 * that as the one line it is.
 */
function diffReport(title: string, got: string, want: string): string {
  const a = got.split("\n"), b = want.split("\n");
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const show = (lines: string[], from: number) => {
    const win = lines.slice(from, lines.length - suf);
    if (!win.length) return "    (nothing)";
    return win.slice(0, 8).map((l, k) => `    ${from + k + 1} | ${l}`).join("\n") +
      (win.length > 8 ? `\n    … ${win.length - 8} more line(s)` : "");
  };
  return `${title} renders differently to its golden` +
    `\n  golden ${b.length} lines, rendered ${a.length}; they agree for ${pre} line(s) then diverge` +
    `\n  was:\n${show(b, pre)}` +
    `\n  now:\n${show(a, pre)}` +
    `\n\nIf you changed this screen ON PURPOSE, regenerate and read the diff:` +
    `\n  deno run -A tools/render_probe.ts tests/golden`;
}

for (const s of SURFACES) {
  Deno.test(`${s.id} — ${s.title} renders unchanged`, async () => {
    const want = await Deno.readTextFile(new URL(s.id + ".html", GOLDEN));
    const got = await renderSurface(s);
    if (got !== want) fail(diffReport(s.title, got, want));
  });
}
