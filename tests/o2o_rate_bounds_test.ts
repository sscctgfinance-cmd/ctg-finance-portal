// The O2O master commission rate is bounded, and why that is not a style preference.
//
// `o2o_issue` (finance.ts:626) forwards Quantity / UnitAmount / DiscountRate straight into the Xero
// payload and recomputes nothing, so whatever `o2oApplyMasterRate` leaves on a line IS the invoice a
// pharmacy receives. The rate itself is typed by an operator into a pharmacy master record, which makes
// a decimal-point slip the realistic failure: `19.2` entered as `192`.
//
// The caller does not read the return value (app.html:2975, web/app/finance/o2o/page.tsx:126), so an
// out-of-range rate falls back to the default 19.2% silently. That is deliberate and it is the safe
// direction — a normal invoice rather than a negative one — but it is a property worth knowing, so it
// is asserted here rather than left to be discovered.

import { assertEquals } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("../o2o.js", import.meta.url));
// deno-lint-ignore no-explicit-any
const o2o = await import("data:application/javascript," + encodeURIComponent(
  src.replace(/if \(typeof module[\s\S]*$/, "export { o2oApplyMasterRate, o2oGrandTotal, O2O_DISCOUNT_RATE };"),
)) as any;

/** One pharmacy at the default 19.2%: RM1,000 of sales, RM192 commission, RM808 billed. */
const pharmacy = () => ({
  total_sales: 1000, commission: 192, total: 808,
  lines: [{ package: "A", unit_price: 500, quantity: 2, discount_rate: 19.2, amount: 808 }],
});

Deno.test("a rate typed with the decimal point lost cannot invoice a NEGATIVE amount", () => {
  // 19.2 -> 192. Before the upper bound this billed the pharmacy MINUS RM18,200.
  const p = pharmacy();
  assertEquals(o2o.o2oApplyMasterRate(p, 192), false, "192% was accepted as a commission rate");
  assertEquals(p.total, 808, "the default billing was overwritten by an impossible rate");
  assertEquals(p.lines[0].amount, 808);
  for (const bad of [100, 100.01, 150, 1920, 1e6]) {
    const q = pharmacy();
    assertEquals(o2o.o2oApplyMasterRate(q, bad), false, `${bad}% was accepted`);
    assertEquals(q.lines[0].amount > 0, true, `${bad}% produced a non-positive line`);
  }
});

Deno.test("100% is excluded, not capped — it is what made a second call render NaN", () => {
  // At exactly 100 the line's own discount_rate becomes 100, and the gross recovery divides by
  // `1 - discount_rate/100`. A second application then divides by zero and every amount becomes NaN,
  // which is written into a bill as the literal text "NaN".
  const p = pharmacy();
  o2o.o2oApplyMasterRate(p, 100);
  o2o.o2oApplyMasterRate(p, 50);
  assertEquals(Number.isFinite(p.lines[0].amount), true, "a line amount went NaN");
  assertEquals(Number.isFinite(p.total), true);
  // No reachable rate can put a line's discount_rate where the divisor is zero.
  for (const r of [0.01, 19.2, 50, 99.99]) {
    const q = pharmacy();
    o2o.o2oApplyMasterRate(q, r);
    assertEquals(1 - (q.lines[0].discount_rate || 0) / 100 !== 0, true, `${r}% left a zero divisor`);
  }
});

Deno.test("a valid rate still applies, and re-prices every line as well as the header", () => {
  // The guard must not have narrowed what legitimately works. 25% of 1,000 is 250, leaving 750.
  const p = pharmacy();
  assertEquals(o2o.o2oApplyMasterRate(p, 25), true);
  assertEquals(p.commission, 250);
  assertEquals(p.total, 750);
  assertEquals(p.lines[0].amount, 750, "the header moved but the line did not — v217's own defect");
  assertEquals(p.lines[0].discount_rate, 25);
  // Just inside the bound.
  const q = pharmacy();
  assertEquals(o2o.o2oApplyMasterRate(q, 99.99), true);
  assertEquals(q.total > 0, true);
});

Deno.test("blank, non-numeric, negative and the default rate all fall back to 19.2%", () => {
  // `Number('') === 0` would zero the discount and invoice at full gross price — o2o.js's own comment.
  for (const r of ["", null, undefined, "abc", NaN, 0, -5, 19.2]) {
    const p = pharmacy();
    assertEquals(o2o.o2oApplyMasterRate(p, r), false, `${JSON.stringify(r)} was applied`);
    assertEquals(p.total, 808, `${JSON.stringify(r)} changed the billing`);
  }
});

Deno.test("the grand total is the sum of what each pharmacy is billed, to the sen", () => {
  const a = pharmacy(), b = pharmacy();
  o2o.o2oApplyMasterRate(b, 25);
  assertEquals(o2o.o2oGrandTotal([a, b]), 1558);
  assertEquals(o2o.o2oGrandTotal([]), 0);
});
