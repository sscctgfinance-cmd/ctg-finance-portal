// Capture the golden HTML of every rendered surface in both single-file apps.
//
// Companion to tools/route_probe.ts, applied to the frontend instead of the router: boot the app
// offline under a stub DOM, hand each screen a canned server answer, render it, and write what came out.
// Nothing here touches the live database or the live edge function — see tests/render_harness.ts.
//
// Regenerate the goldens after a DELIBERATE change to a screen:
//   deno run -A tools/render_probe.ts tests/golden
//
// Then read `git diff tests/golden/` before committing. That diff is the change you just made to what
// operators see; if it contains anything you did not intend, that is the bug this exists to catch.

import { renderSurface, SURFACES } from "../tests/render_surfaces.ts";

if (import.meta.main) {
  const dir = Deno.args[0] || "tests/golden";
  await Deno.mkdir(dir, { recursive: true });
  let written = 0;
  const failed: string[] = [];
  for (const s of SURFACES) {
    try {
      await Deno.writeTextFile(`${dir}/${s.id}.html`, await renderSurface(s));
      written++;
    } catch (e) {
      failed.push(`${s.id}: ${(e as Error).message}`);
    }
  }
  console.error(`wrote ${written}/${SURFACES.length} goldens to ${dir}`);
  if (failed.length) {
    console.error("FAILED:\n  " + failed.join("\n  "));
    Deno.exit(1);
  }
}
