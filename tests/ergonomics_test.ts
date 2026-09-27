// The ergonomics layer (2026-09-26) — what a user holding a phone needs from every screen.
//
// WHY THIS FILE EXISTS: tools/ergo_probe.js, run inside each screen as an employee and as an admin on a
// 375px phone, measured what the goldens cannot: every form field drawn at 13px (iOS zooms the whole page
// on focus below 16px, and the user pinches back out after EVERY field), approval tables whose Approve
// button sat off-screen to the right, a 16x14 payroll menu, checkboxes stretched into 44px boxes that drew
// their square BELOW the sentence they confirm, a Finance sidebar pinned over 45% of the screen, a Save
// button two screens below the field being edited, and a leave form that told you what a request cost
// only in the toast after you had sent it.
//
// None of that is markup, so no golden can see it, and every piece of it is one "tidy-up" from coming
// back. The CSS half is pinned by source; the logic half (column captions, the leave preview) is DRIVEN.

import { assertEquals } from "jsr:@std/assert@1";
import { fnSource } from "../tools/extract.ts";

const ROOT = new URL("../", import.meta.url);
const read = (f: string) => Deno.readTextFile(new URL(f, ROOT));
const CSS = await read("ctg-shell.css");
const COMMON = await read("common.js");
const DOCS = await read("hr-docs.js");
const APP = await read("app.html");
const HROS = await read("hros.html");
const HR_TS = await read("supabase/functions/portal/hr.ts");

/** Lift named functions out of a shared file — both touch `document` at load, so neither is run whole. */
// deno-lint-ignore no-explicit-any
const lift = (src: string, names: string[], extra = ""): any =>
  new Function(extra + "\n" + names.map((n) => fnSource(src, n)).join("\n") + "\nreturn {" + names.join(",") + "};")();
const TONE = /var HR_LEAVE_TONE = \{[^}]*\};/.exec(DOCS)![0];
const docs = {
  ...lift(DOCS, ["hrWorkingDays", "hrNextWorkingDay", "hrLeavePreview"], TONE),
  HR_LEAVE_TONE: new Function(TONE + " return HR_LEAVE_TONE;")(),
};
const common = lift(COMMON, ["ctgHeadLabels", "ctgErgoInstall"], "var CTG_ERGO_ON = false;");

Deno.test("both apps install the ergonomics layer when they boot — and only then", () => {
  for (const [name, src] of [["app.html", APP], ["hros.html", HROS]]) {
    const at = src.indexOf("function enterApp(){");
    assertEquals(at > 0, true, `${name}: enterApp() not found`);
    assertEquals(/^\s*ctgErgoInstall\(\);/.test(src.slice(at + 20, at + 120)), true,
      `${name}: enterApp() no longer installs ctgErgo — every screen loses the phone fixes at once`);
  }
  // Load-time: nothing in common.js may call it (tests/shared_script_loadtime_test.ts's rule). Calling
  // the installer here, with no DOM, must be a harmless no-op.
  assertEquals(common.ctgErgoInstall(), undefined);
});

Deno.test("form fields are 16px on a touch screen, overriding the renderers' inline 13px", () => {
  const coarse = /@media \(pointer:coarse\)\{([\s\S]*?)\n\}/.exec(CSS);
  assertEquals(!!coarse, true, "the pointer:coarse block is gone");
  assertEquals(/select, textarea\{ font-size:16px !important; \}/.test(coarse![1]), true,
    "fields are no longer forced to 16px — iOS zooms the page on focus below that, on every field");
});

Deno.test("a checkbox is a box beside its sentence, not the bottom of a 44px column", () => {
  // Both apps' mobile rules set min-height:44px on EVERY input; app.html also width:100%.
  const rule = /input\[type="checkbox"\], input\[type="radio"\]\{([^}]*)\}/.exec(CSS);
  assertEquals(!!rule, true);
  assertEquals(/min-height:0 !important/.test(rule![1]) && /width:18px !important/.test(rule![1]), true,
    "checkboxes inherit the 44px / 100% field sizing again");
});

Deno.test("the Finance sidebar is not pinned on a phone", () => {
  const m = /@media\(max-width:900px\)\{[\s\S]*?\.ctg-side\{([\s\S]*?)\}/.exec(CSS);
  assertEquals(!!m, true);
  assertEquals(/position:static/.test(m![1]) && !/position:sticky/.test(m![1]), true,
    "the sidebar is sticky again — 364px of a 812px phone parked over every form");
});

Deno.test("a long form's primary action is pinned, and wins over .btn.p's position:relative", () => {
  assertEquals(/\.ctg-sticky-act\{ position:sticky !important;/.test(CSS), true,
    "without !important `.btn.p` computes position:relative and the Save button never pins");
  assertEquals(/function ctgErgoStickyActions\(panel\)/.test(COMMON), true);
});

Deno.test("column captions read a grouped header as a grid, not its first row", () => {
  const c = (textContent: string, colSpan = 1, rowSpan = 1) => ({ textContent, colSpan, rowSpan });
  // The payroll grid's shape: a group row with rowspans, then the per-column row.
  const thead = { rows: [
    { cells: [c("Employee", 1, 2), c("Earnings (RM)", 3), c("Net", 1, 2)] },
    { cells: [c("Basic"), c("Allow"), c("OT")] },
  ] };
  assertEquals(common.ctgHeadLabels(thead), ["Employee", "Earnings (RM) · Basic", "Earnings (RM) · Allow", "Earnings (RM) · OT", "Net"]);
  // A flat header is unchanged, colspans included.
  assertEquals(common.ctgHeadLabels({ rows: [{ cells: [c("Type"), c("Dates", 2), c("")] }] }), ["Type", "Dates", "Dates", ""]);
});

Deno.test("the leave preview counts days exactly as hr_leave_apply does", () => {
  // Source pins on the server's rule, so a change there makes this file red rather than the two apart.
  assertEquals(/if \(b\.half_day && from===to\) days = 0\.5;/.test(HR_TS), true, "hr_leave_apply's half-day rule changed");
  assertEquals(/if\(dow!==0&&dow!==6\) n\+\+/.test(HR_TS), true, "hr_leave_apply's weekday rule changed");
  const W = docs.hrWorkingDays;
  assertEquals(W("2026-09-28", "2026-10-02"), 5);        // Mon–Fri
  assertEquals(W("2026-09-26", "2026-09-27"), 0);        // Sat–Sun
  assertEquals(W("2026-09-25", "2026-09-28"), 2);        // Fri → Mon, across a weekend
  assertEquals(W("2026-09-28", "2026-09-28", true), 0.5);
  assertEquals(W("2026-09-26", "2026-09-26", true), 0.5, "the server counts a Saturday half day as 0.5 — so must the preview");
  assertEquals(W("2026-09-28", "2026-09-29", true), 2, "half day only applies to a single date");
  assertEquals(W("2026-10-02", "2026-09-28"), 0);        // reversed
  assertEquals(W("2026-12-28", "2027-01-01"), 5);        // across a year end
});

Deno.test("the form opens on a working day, so it never OPENS in its own error state", () => {
  assertEquals(docs.hrNextWorkingDay("2026-09-26"), "2026-09-28");   // Saturday → Monday
  assertEquals(docs.hrNextWorkingDay("2026-09-27"), "2026-09-28");   // Sunday → Monday
  assertEquals(docs.hrNextWorkingDay("2026-09-29"), "2026-09-29");   // a weekday is left alone
  assertEquals(/var today=hrNextWorkingDay\(todayLocalISO\(\)\)/.test(HROS), true, "hros.html's leave form stopped using it");
});

Deno.test("the leave preview says what a request costs, and blocks only what the server would refuse", () => {
  const types = [{ id: "al", name: "Annual leave", paid: true }, { id: "up", name: "Unpaid leave", paid: false }];
  const bals = [{ type: "Annual leave", remaining: 11 }];
  const P = (t: string, f: string, to: string, h = false) => docs.hrLeavePreview(types, bals, t, f, to, h);
  assertEquals(P("al", "2026-09-28", "2026-10-02"), { ok: true, tone: "green", text: "5 working days · 11 left → 6 after this" });
  // Over the balance WARNS, it does not block — whether excess is allowed is HR's call on the server.
  const over = P("al", "2026-09-28", "2026-10-20");
  assertEquals([over.ok, over.tone], [true, "amber"]);
  assertEquals(P("up", "2026-09-28", "2026-09-28").text, "1 working day · unpaid");
  assertEquals(P("al", "2026-09-28", "2026-09-28", true).text, "0.5 working days · 11 left → 10.5 after this");
  // What the server refuses, the form refuses first — with the reason on screen, not in a toast.
  for (const [f, to] of [["2026-10-02", "2026-09-28"], ["2026-09-26", "2026-09-27"], ["", "2026-09-28"]]) {
    assertEquals(P("al", f, to).ok, false, `${f} → ${to} should not be submittable`);
  }
  // Every tone has a colour token, so no preview can render in an undefined colour.
  for (const tone of ["green", "amber", "red", "muted"]) assertEquals(typeof docs.HR_LEAVE_TONE[tone], "string");
});

Deno.test("an employee's claim form does not ask them to find their own name", () => {
  assertEquals(/if\(!f\.employee_id && cfg\.me && cfg\.me\.employee && \(cfg\.employees\|\|\[\]\)\.some\(/.test(HROS), true,
    "the claimant no longer defaults to the person filing");
  assertEquals(/\(\(cfg\.employees\|\|\[\]\)\.length===1\?'':'<option value="">— select —<\/option>'\)/.test(HROS), true,
    "a list of ONE (an employee's own config) offers '— select —' again");
});
