// A mouse wheel must never change a number — and must never stop the page scrolling.
//
// WHY THIS FILE EXISTS: Chrome and Firefox increment a FOCUSED `<input type="number">` when the wheel
// turns over it. The Payroll grid is sixteen columns of money and the operator's normal motion is
// click a cell, scroll to reach another column, come back — pointer still resting on the cell they just
// clicked. A salary changes, nothing says so, and the statutory figures underneath quietly re-compute.
//
// THE ASSERTION THAT MATTERS IS THE SECOND ONE. There are two ways to write this guard and only one is
// an improvement:
//
//   blur()            the value stops changing AND the page scrolls normally      ✔
//   preventDefault()  the value stops changing AND THE PAGE STOPS SCROLLING       ✘
//
// The second is the version somebody reaches for first, and it trades a rare accident for a daily
// obstruction — a page that will not scroll while the pointer happens to sit over a cell, with no
// explanation on screen. `{ passive: true }` makes that regression impossible rather than merely
// discouraged: a passive listener cannot cancel its event, so the browser ignores any preventDefault a
// future edit adds. This file pins the passive flag for exactly that reason.
//
// Driven, not described: the handler is lifted out of common.js and run against a fake event, so a
// guard that stops blurring — or starts cancelling — fails here.

import { assertEquals } from "jsr:@std/assert@1";

const SRC = await Deno.readTextFile(new URL("../common.js", import.meta.url));

/** The registration, as shipped. Comments are blanked first: this file's own header quotes the words. */
const code = SRC.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const reg = /addEventListener\(\s*['"]wheel['"][\s\S]*?\}\s*,\s*(\{[^}]*\})\s*\)/.exec(code);

Deno.test("the wheel guard is registered, and registered PASSIVE", () => {
  assertEquals(!!reg, true, "common.js no longer installs a wheel guard at all");
  const opts = reg![1];
  // The load-bearing one. Passive is what makes "the page always scrolls" a property of the platform
  // rather than of whoever edits this next.
  assertEquals(/passive\s*:\s*true/.test(opts), true,
    "the wheel listener is no longer passive — it can now cancel the event and freeze page scrolling");
  assertEquals(/capture\s*:\s*true/.test(opts), true,
    "the listener must run in the CAPTURE phase, so focus is gone before the browser's default action looks for it");
});

Deno.test("it never cancels the event — the page keeps scrolling", () => {
  // A cancelled wheel is the regression this guard exists to avoid becoming. Nothing in the handler may
  // call preventDefault / stopPropagation, and `passive: true` above means the browser would ignore it
  // anyway; both halves are asserted so the intent survives a future edit that drops the flag.
  const body = /addEventListener\(\s*['"]wheel['"]\s*,\s*function[^{]*\{([\s\S]*?)\}\s*,\s*\{/.exec(code);
  assertEquals(!!body, true, "could not read the wheel handler's body");
  for (const forbidden of ["preventDefault", "stopPropagation", "stopImmediatePropagation", "returnValue"]) {
    assertEquals(body![1].includes(forbidden), false,
      `the wheel handler calls ${forbidden}() — that stops the PAGE scrolling, which is worse than the bug`);
  }
});

Deno.test("it blurs the focused number input, and ONLY that", () => {
  // Run the shipped handler against fakes. `document.activeElement` is what the browser increments, so
  // the guard has to key on it — blurring `e.target` instead would blur a field the pointer merely
  // passes over while the operator scrolls, stealing focus mid-edit.
  const fn = new Function("document", "return " + (/addEventListener\(\s*['"]wheel['"]\s*,\s*(function[\s\S]*?\})\s*,\s*\{/.exec(code)![1]));

  const make = (type: string) => { let blurred = false; const el = { type, blur: () => { blurred = true; } }; return { el, was: () => blurred }; };

  // the case it exists for: a focused NUMBER input, pointer over it
  {
    const n = make("number");
    fn({ activeElement: n.el })({ target: n.el });
    assertEquals(n.was(), true, "a wheel over the focused number input did not blur it — the value still changes");
  }
  // a focused number input the pointer is NOT over: scrolling the page must not steal focus
  {
    const n = make("number");
    fn({ activeElement: n.el })({ target: { type: "number" } });
    assertEquals(n.was(), false, "scrolling elsewhere blurred a field the operator is still typing in");
  }
  // every other control is left alone — a wheel over a focused <select> or text box changes nothing,
  // so blurring it would be a gratuitous loss of focus
  for (const t of ["text", "date", "select-one", "checkbox", "textarea"]) {
    const o = make(t);
    fn({ activeElement: o.el })({ target: o.el });
    assertEquals(o.was(), false, `a wheel over a focused ${t} control blurred it for no reason`);
  }
  // nothing focused, and a focus that is not an element at all — must not throw
  fn({ activeElement: null })({ target: {} });
  fn({ activeElement: undefined })({ target: null });
});
