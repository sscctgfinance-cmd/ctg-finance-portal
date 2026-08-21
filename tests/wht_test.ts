// Withholding tax — the arithmetic, and that the screen actually renders.
//
// WHY THIS FILE EXISTS: this module replaces Malaysia_WHT_Summary.xlsx, and the workbook it replaces had
// four defects that a spreadsheet cannot warn you about. Each one is pinned here as a test, because the
// point of moving off Excel is that the next version cannot quietly reintroduce them:
//
//   1. Rows 23-24 of the payment table had NO SST and NO total formula, while the subtotal still summed
//      D10:D24 / E10:E24 / F10:F24. Type an amount in the last two rows and the fee counts toward the WHT
//      base but its service tax and gross silently vanish from the totals.
//   2. The "Penalty (10% of WHT)" cell was empty. A label is not a formula.
//   3. The note describes a net-of-tax basis with a gross-up. The sheet never implemented one, so a
//      net-of-tax contract was under-withheld — WHT charged on the net instead of on the grossed-up fee.
//   4. B14:B24 pointed at #REF! after the source range was deleted.
//
// Plus the rule the workbook DID get right and which is worth locking down: WHT is charged on the fee
// excluding Malaysian service tax. Charging it on fee+SST over-withholds on every single payment.

import { assertEquals } from "jsr:@std/assert@1";
import { fnSource, inlineScript } from "../tools/extract.ts";
import { loadApp } from "./render_harness.ts";

const src = inlineScript(await Deno.readTextFile(new URL("../app.html", import.meta.url)));

const mod = await import("data:application/typescript," + encodeURIComponent(
  [fnSource(src, "whtRound2"), fnSource(src, "whtLineSst"), fnSource(src, "whtLineTotal"),
   fnSource(src, "whtCompute"), fnSource(src, "whtDueDate"),
   "export { whtRound2, whtLineSst, whtLineTotal, whtCompute, whtDueDate };"].join("\n")));
// deno-lint-ignore no-explicit-any
const { whtCompute, whtDueDate, whtLineSst, whtLineTotal } = mod as any;

const doc = (over: Record<string, unknown> = {}) => ({
  wht_rate: 0.10, sst_rate: 0.08, penalty_pct: 0.10, basis: "gross", penalty_on: false, ...over,
});
const lines = (...amts: number[]) => amts.map((a) => ({ amount: a }));

Deno.test("WHT is charged on the fee, never on the fee plus service tax", () => {
  const c = whtCompute(doc(), lines(1000));
  assertEquals(c.fee, 1000);
  assertEquals(c.sst, 80, "service tax on imported taxable services at 8%");
  assertEquals(c.feeInclSst, 1080);
  assertEquals(c.wht, 100, "10% of 1,000 — NOT 108, which is 10% of the SST-inclusive amount");
  // The whole point: the service tax is the payer's own liability and is outside the withholding base.
  assertEquals(c.wht === whtCompute(doc({ sst_rate: 0 }), lines(1000)).wht, true,
    "changing the service tax rate moved the withholding tax — the SST has leaked into the base");
});

Deno.test("every line reaches the totals — the workbook lost the last two rows", () => {
  // 15 lines, which is exactly the workbook's row 10-24 range. Rows 23-24 there had no SST/total formula.
  const amts = Array.from({ length: 15 }, (_, i) => 100 + i);      // 100..114, sum 1,605
  const c = whtCompute(doc(), lines(...amts));
  const expected = amts.reduce((s, a) => s + a, 0);
  assertEquals(c.fee, expected, "the fee subtotal dropped a line");
  assertEquals(c.sst, Math.round(expected * 0.08 * 100) / 100, "the SST subtotal dropped a line");
  assertEquals(c.feeInclSst, Math.round((expected * 1.08) * 100) / 100, "the gross subtotal dropped a line");
});

Deno.test("the printed columns cast — subtotals equal the sum of the visible rows", () => {
  // The real ManyChat computation the operator caught: 11 payment lines whose SST column added to
  // 298.13 and whose total column added to 4,024.95, printed under subtotals of 298.15 and 4,024.97.
  // The rate was being applied to the aggregate fee while every row showed its own rounded sen, so the
  // document did not cast. Each payment is a separate acquisition of an imported taxable service, so
  // per-line is also the right answer, not merely the one that foots.
  const amts = [386.31, 386.31, 386.31, 386.73, 386.73, 386.64, 193.32, 193.02, 193.02, 388.06, 440.37];
  const c = whtCompute(doc(), lines(...amts));
  assertEquals(c.fee, 3726.82);

  const rowSst = amts.map((a) => whtLineSst(a, 0.08));
  const rowTot = amts.map((a) => whtLineTotal(a, 0.08));
  const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

  assertEquals(c.sst, sum(rowSst), "the SST subtotal is not what the SST column adds up to");
  assertEquals(c.feeInclSst, sum(rowTot), "the fee+SST subtotal is not what that column adds up to");
  assertEquals(c.feeInclSst, 4024.95, "the operator's own casting of the printed column");
  assertEquals(c.sst, 298.13);
  // Every row must also cast across, not just the columns down.
  amts.forEach((a, i) => assertEquals(rowTot[i], Math.round((a + rowSst[i]) * 100) / 100, `row ${i + 1}`));
  // And none of this may touch the tax actually payable — that is 10% of the fee, unchanged.
  assertEquals(c.wht, 372.68);
});

Deno.test("net basis grosses up — the sheet described this and never did it", () => {
  // RM900 is what the payee keeps. At 10% the gross is 1,000 and the tax is 100.
  const c = whtCompute(doc({ basis: "net" }), lines(900));
  assertEquals(c.gross, 1000, "gross-up is fee / (1 - rate)");
  assertEquals(c.wht, 100, "the tax is the difference, not 10% of the net");
  assertEquals(c.netToPayee, 900, "on a net contract the payee still receives the full fee");
  // The under-withholding this prevents: 10% of 900 is 90, not 100.
  assertEquals(c.wht !== whtCompute(doc(), lines(900)).wht, true,
    "net basis produced the same tax as gross basis — the gross-up is not being applied");
});

Deno.test("gross basis deducts from the payee", () => {
  const c = whtCompute(doc(), lines(1000));
  assertEquals(c.gross, 1000);
  assertEquals(c.netToPayee, 900, "on a gross contract the payee receives the fee less the tax");
});

Deno.test("the 10% increase is computed, not typed", () => {
  const off = whtCompute(doc(), lines(1000));
  assertEquals(off.penalty, 0, "no increase unless the remittance is late");
  assertEquals(off.total, 100);
  const on = whtCompute(doc({ penalty_on: true }), lines(1000));
  assertEquals(on.penalty, 10, "s.109(2) — 10% of the tax, not of the fee");
  assertEquals(on.total, 110);
});

Deno.test("treaty rates compute correctly", () => {
  // Ireland and Singapore royalties are capped at 8% under their DTAs; the US has no comprehensive
  // treaty with Malaysia, so those payees stay on the 10% domestic rate.
  assertEquals(whtCompute(doc({ wht_rate: 0.08 }), lines(5000)).wht, 400);
  assertEquals(whtCompute(doc({ wht_rate: 0.10 }), lines(5000)).wht, 500);
});

Deno.test("rounding is to the sen at every step, and nothing goes NaN", () => {
  const c = whtCompute(doc(), lines(33.33, 66.67, 0.01));
  assertEquals(c.fee, 100.01);
  assertEquals(c.wht, 10, "10.001 rounds to 10.00");
  for (const k of ["fee", "sst", "feeInclSst", "gross", "wht", "penalty", "total", "netToPayee"]) {
    assertEquals(Number.isFinite(c[k]), true, `${k} is not a finite number`);
  }
  // A blank form must not render NaN across the panel.
  const empty = whtCompute(doc(), []);
  for (const k of ["fee", "sst", "wht", "total"]) assertEquals(empty[k], 0, `${k} on an empty form`);
});

Deno.test("a 100% rate cannot divide by zero on the net basis", () => {
  // Blocked at the DB (CHECK) and in both save paths, but the calculator must not render Infinity if a
  // legacy row ever carries one.
  const c = whtCompute(doc({ basis: "net", wht_rate: 1 }), lines(1000));
  assertEquals(Number.isFinite(c.gross), true, "gross went infinite");
  assertEquals(Number.isFinite(c.wht), true, "wht went infinite");
});

Deno.test("the remittance deadline is one month after the LAST payment", () => {
  assertEquals(whtDueDate([{ payment_date: "2026-07-05" }, { payment_date: "2026-07-28" }]), "2026-08-28");
  assertEquals(whtDueDate([]), null, "no dates, no deadline");
  // Month-end has to clamp, or 31 January + 1 month silently becomes 3 March.
  const feb = whtDueDate([{ payment_date: "2026-01-31" }]);
  assertEquals(feb!.slice(0, 7), "2026-02", `31 Jan + 1 month landed in ${feb}`);
});

Deno.test("the Withholding Tax screen renders", () => {
  // The v206 lesson: an undeclared identifier in a renderer is a runtime ReferenceError that lint cannot
  // see and the parse gate passes. Render it here or find out from the operator.
  //
  // This used to hand-roll a `document` stub and a prelude re-declaring esc/COMPANIES/WHT_TYPES so the
  // lifted functions had something to close over. It now boots the whole of app.html under the shared
  // stub DOM (render_harness.ts), which means the real esc, the real COMPANIES and the real WHT_TYPES —
  // a prelude that drifts from the app is a test that passes while the screen is broken.
  const app = loadApp("app.html");
  try {
    app.exec("COMPANIES=[{tenant_id:'t1',tenant_name:'SKINDAE SDN BHD'}]");
    app.exec(`WHT.cfg={ payees:[{id:1,name:'OPENAI OPCO, LLC',tin:'C57831485010',country:'UNITED STATES',wht_rate:0.10,statutory_rate:0.10,wht_type:'royalty',treaty_relief:false,has_cor:false},
                                 {id:2,name:'META PLATFORMS IRELAND LIMITED',tin:'C29806901060',country:'IRELAND',wht_rate:0.08,statutory_rate:0.10,wht_type:'royalty',treaty_relief:true,has_cor:false}],
                        entities:[{tenant_id:'t1',name:'SKINDAE SDN BHD',tax_no:'C58427907080'}] };
              WHT.list=[{id:1,doc_no:'WHT-202608-0001',payee_name:'OPENAI OPCO, LLC',payee_country:'UNITED STATES',wht_rate:0.10,basis:'gross',period_label:'July 2026',fee_total:1000,status:'draft',sst_rate:0.08,penalty_pct:0.10}];
              WHT.page='list'; WHT.doc=null; WHT.lines=[]; WHT.payees=false; WHT.editPayee=null;`);

    const list = app.exec("whtListHtml()") as string;
    assertEquals(typeof list === "string" && list.length > 400, true, "the list view rendered nothing");
    assertEquals(list.indexOf("OPENAI OPCO") >= 0, true, "computations are missing from the list");

    const withPayees = app.exec("WHT.payees=true; whtListHtml()") as string;
    assertEquals(/Certificate of Residence/.test(withPayees), true,
      "a treaty rate with no COR on file must be flagged — that is the difference between 8% and 10% plus a penalty");

    const docHtml = app.exec(`WHT.payees=false; WHT.page='doc';
      WHT.doc={tenant_id:'t1',payee_id:2,payee_name:'META PLATFORMS IRELAND LIMITED',payee_tin:'C29806901060',payee_country:'IRELAND',wht_rate:0.08,wht_type:'royalty',basis:'net',sst_rate:0.08,penalty_pct:0.10,penalty_on:true,status:'draft'};
      WHT.lines=[{payment_date:'2026-07-10',receipt_no:'R-1',amount:920}];
      whtDocHtml()`) as string;
    assertEquals(typeof docHtml === "string" && docHtml.length > 1000, true, "the computation view rendered nothing");
    assertEquals(/Grossed-up/.test(docHtml), true, "a net-basis computation must show the gross-up line");
    assertEquals(/2026-08-10/.test(docHtml), true, "the remittance due date is missing");
  } finally {
    app.restore();
  }
});
