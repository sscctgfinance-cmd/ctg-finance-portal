// The collapsed sidebar has to stay usable, and one part of it is load-bearing.
//
// WHY THIS FILE EXISTS: collapsing the rail (`localStorage.ctg_rail = '1'`) takes `.ctg-side` to 66px
// and the stylesheet hides `.ctg-side-link .lbl`, the group headings and `.ctg-side-company`. That
// last one is not cosmetic — it wraps the REAL `<select id="company">` (moved, not cloned), so the
// collapsed rail used to remove both the answer to "which of the seven companies am I in" and the
// only way to change it. Posting into the wrong Xero org is this product's expensive mistake.
//
// Two more things were wrong in the same place and are cheap to keep fixed: a collapsed nav button
// had NO accessible name at all (`.lbl` is display:none, `.ic` is aria-hidden), and the toggle went
// on announcing itself as "Collapse navigation" after it had become the control that expands.
import { assertEquals } from "jsr:@std/assert@1";

const SRC = await Deno.readTextFile(new URL("../ctg-shell.js", import.meta.url));
const CSS = await Deno.readTextFile(new URL("../ctg-shell.css", import.meta.url));

/** Lift the pure helper out of the shipped file rather than re-typing it. */
function loadInitials(): (s: string) => string {
  const m = /function ctgCoInitials\([\s\S]*?\n\}/.exec(SRC);
  if (!m) throw new Error("ctg-shell.js no longer defines ctgCoInitials");
  return new Function(m[0] + "; return ctgCoInitials;")() as (s: string) => string;
}

Deno.test("the company tile distinguishes every company in the group", () => {
  const initials = loadInitials();
  // The real seven, as `xero_tenants.tenant_name` spells them.
  const NAMES = [
    "CTG4U DRSMILE WHITENING SDN BHD",
    "CTG4U ILADY SDN BHD",
    "CTG4U SCALE HOLDING SDN BHD",
    "CTG4U WELLNESS SDN BHD",
    "CTG4U ZEERO SKINCARE SDN BHD",
    "SKINDAE SDN BHD",
    "YUAN CHUAN TANG CTG4U SDN BHD",
  ];
  const got = NAMES.map(initials);
  assertEquals(got, ["DRS", "ILA", "SCA", "WEL", "ZEE", "SKI", "YUA"]);
  // The point of the tile is that it tells them APART — a collision would put two companies behind
  // the same three letters and the tile would be worse than nothing.
  assertEquals(new Set(got).size, NAMES.length, `two companies share a tile: ${got.join(", ")}`);
});

Deno.test("the all-companies option is a tile, not a blank square", () => {
  const initials = loadInitials();
  for (const s of ["— All Companies —", "All Companies", "- all companies -"]) {
    assertEquals(initials(s), "ALL", `"${s}" should read ALL`);
  }
  // Nothing selected yet is legitimately empty — the tile's title says "Pick a company".
  assertEquals(initials(""), "");
  assertEquals(initials(null as unknown as string), "");
});

Deno.test("the group prefix is dropped only when something follows it", () => {
  const initials = loadInitials();
  // Every company but SKINDAE starts with CTG4U, so keeping it would give six identical tiles.
  assertEquals(initials("CTG4U ZEERO SKINCARE SDN BHD"), "ZEE");
  // …but a company actually CALLED CTG4U must not be reduced to an empty tile.
  assertEquals(initials("CTG4U SDN BHD"), "CTG");
});

Deno.test("every nav button carries its own name, so a collapsed icon is identifiable", () => {
  // `.lbl` is display:none when collapsed and `.ic` is aria-hidden, so without these two the button
  // has no accessible name and no tooltip — eighteen icons that read as "button".
  assertEquals(/b\.title\s*=\s*parts\.lbl/.test(SRC), true,
    "nav buttons no longer get a title — a collapsed icon has no tooltip");
  assertEquals(/b\.setAttribute\(['"]aria-label['"],\s*parts\.lbl\)/.test(SRC), true,
    "nav buttons no longer get an aria-label — a collapsed icon has no accessible name");
});

Deno.test("the toggle's label tracks the STATE, not the state it started in", () => {
  assertEquals(/Expand navigation/.test(SRC), true,
    "the rail never announces 'Expand' — collapsed, the control that expands still says 'Collapse'");
  // It must be re-applied on click, not only at build time.
  const onclick = /rail\.onclick\s*=\s*function[\s\S]*?\n    \};/.exec(SRC);
  assertEquals(!!onclick, true, "rail.onclick is gone");
  assertEquals(/railLabel\(/.test(onclick![0]), true,
    "the click handler no longer updates the label, so it goes stale the moment it is used");
});

Deno.test("the company tile is shown ONLY while collapsed, and is big enough to hit", () => {
  assertEquals(/\.ctg-side-cotile\{\s*display:none/.test(CSS), true,
    "the tile is not hidden by default — it would duplicate the <select> that is already visible");
  const rule = /\.ctg-side\.collapsed \.ctg-side-cotile\{([\s\S]*?)\}/.exec(CSS);
  assertEquals(!!rule, true, "no collapsed rule for the company tile");
  assertEquals(/display:flex/.test(rule![1]), true, "the tile does not appear when collapsed");
  // WCAG 2.5.8 asks 24x24. This one identifies the company AND is the way back to the full nav, so
  // it is sized well past the minimum on purpose; anything under 24 is a regression.
  const w = /width:(\d+)px/.exec(rule![1]);
  const h = /height:(\d+)px/.exec(rule![1]);
  assertEquals(!!w && !!h, true, "the tile has no explicit size");
  assertEquals(Number(w![1]) >= 24 && Number(h![1]) >= 24, true,
    `the company tile is ${w![1]}x${h![1]}, under WCAG 2.5.8's 24x24`);
});

Deno.test("the tile is repainted when the company list arrives, not only on change", () => {
  // The options are filled asynchronously once the companies load, so a one-shot read leaves the tile
  // blank on every cold start — which is the same "no company shown" failure, with extra steps.
  assertEquals(/addEventListener\(['"]change['"],\s*paintTile\)/.test(SRC), true,
    "the tile no longer follows the select's value");
  assertEquals(/MutationObserver\(paintTile\)/.test(SRC), true,
    "the tile no longer follows the select's OPTIONS — it will be blank until the operator switches");
});

Deno.test("the collapsed rail's own expand button FITS INSIDE the rail", () => {
  // MEASURED IN A BROWSER, which is the only place this was visible: `.ctg-side-brand` is a flex ROW
  // with 18px side padding, so a 66px rail leaves 30px of content box for a 36px logo that cannot
  // shrink (`flex-shrink:0`). The expand control was laid out at x=72..92 — entirely outside the 66px
  // sidebar — so once collapsed there was NO reachable way back; clearing localStorage was the escape.
  // No golden could see it: the goldens record markup, and this is pure layout.
  const rule = /\.ctg-side\.collapsed \.ctg-side-brand\{([^}]*)\}/.exec(CSS);
  assertEquals(!!rule, true,
    "the collapsed brand row is a plain flex ROW again — a 36px logo plus a button cannot fit in 66px");
  assertEquals(/flex-direction:\s*column/.test(rule![1]), true,
    "the collapsed brand row must stack, or the expand button is pushed outside the rail");

  const railRule = /\.ctg-side\.collapsed \.ctg-side-rail\{([\s\S]*?)\}/.exec(CSS);
  assertEquals(!!railRule, true, "no collapsed rule for the expand button");
  // `margin-left:auto` is what shoved it off the edge in a row layout; it must not come back.
  assertEquals(/margin-left:\s*0/.test(railRule![1]), true,
    "margin-left:auto is back — that is what pushed the button out of the rail");
  assertEquals(/width:\s*100%/.test(railRule![1]), true, "the button no longer spans the rail");
  const h = /min-height:\s*(\d+)px/.exec(railRule![1]);
  assertEquals(!!h && Number(h[1]) >= 24, true,
    `the expand button is ${h ? h[1] : "?"}px tall, under WCAG 2.5.8's 24x24 — and it is the ONLY way back`);
});
