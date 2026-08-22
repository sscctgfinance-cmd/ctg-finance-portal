// No hostile input produces a NaN, an Infinity, or a negative where money cannot be negative.
//
// WHY THIS FILE EXISTS: `o2oApplyMasterRate` at exactly 100% divided by zero and wrote the literal text
// "NaN" into an invoice line. That is the whole class — a figure that is never checked because it is
// "obviously" a number, in code that then hands it to a CSV, a PDF or a Xero payload. Every module here
// takes numbers from a spreadsheet cell, an OCR verdict or a typed box, and none of those is trusted.
//
// It sweeps the values that break arithmetic rather than the values that exercise it: NaN, ±Infinity,
// null, undefined, '', strings, objects, negatives, and numbers past the safe integer range.

import { assertEquals } from "jsr:@std/assert@1";

// deno-lint-ignore no-explicit-any
async function load(file: string, names: string): Promise<any> {
  const src = await Deno.readTextFile(new URL("../" + file, import.meta.url));
  return await import("data:application/javascript," + encodeURIComponent(
    src.replace(/if \(typeof module[\s\S]*$/, `export { ${names} };`),
  ));
}

const wht = await load("wht.js", "whtCompute, whtDueDate, whtLineSst, whtLineTotal");
const o2o = await load("o2o.js", "o2oApplyMasterRate, o2oGrandTotal, o2oParseRows");
const gw = await load("gateway.js", "gwNum, gwRnd, gwTotals, gwCSV, gwParseDate, gwConvertHitpay, gwNewAudit");
const sr = await load("salesrecon.js", "srNum, srBuildLines, srSummary, srTally");
const pnl = await load("pnl.js", "pnlSen, pnlBuild, pnlCsvLines");

/** Everything a number field can arrive as when it did not arrive as a number. */
const HOSTILE = [
  NaN, Infinity, -Infinity, null, undefined, "", " ", "abc", "1e400", {}, [],
  -1, -0.005, 1e21, Number.MAX_SAFE_INTEGER + 2, "12,345.67", true, false,
];

/** Walks a result and fails on the first value arithmetic cannot survive. */
// deno-lint-ignore no-explicit-any
function assertSane(v: any, where: string, allowNegative = false, seen = new Set()): void {
  if (v === null || v === undefined) return;
  if (typeof v === "number") {
    assertEquals(Number.isFinite(v), true, `${where} is ${v}`);
    if (!allowNegative) assertEquals(v >= 0, true, `${where} is negative (${v})`);
    return;
  }
  if (typeof v === "string") {
    assertEquals(/\bNaN\b|\bInfinity\b/.test(v), false, `${where} contains "${v.slice(0, 60)}"`);
    return;
  }
  if (typeof v !== "object" || seen.has(v)) return;
  seen.add(v);
  for (const [k, x] of Object.entries(v)) assertSane(x, `${where}.${k}`, allowNegative, seen);
}

Deno.test("whtCompute survives every hostile rate, basis and amount", () => {
  for (const h of HOSTILE) {
    // RATES are clamped to the range both save paths and the DB CHECK already enforce, so no rate can
    // produce a negative figure. AMOUNTS are the operator's own typing and `wht_save` refuses a negative
    // one with a message — showing a negative in the live preview is honest feedback, not a defect — so
    // an amount-driven negative is allowed here and only finiteness is required.
    // deno-lint-ignore no-explicit-any
    const doc: any = { wht_rate: h, sst_rate: h, penalty_pct: h, basis: "net", penalty_on: true };
    assertSane(wht.whtCompute(doc, [{ amount: 1000 }]), `whtCompute(rate=${String(h)})`);
    assertSane(wht.whtCompute({ ...doc, basis: "gross" }, [{ amount: 1000 }]), `whtCompute(gross,${String(h)})`);
    assertSane(wht.whtCompute(doc, [{ amount: h }, { amount: 1000 }]), `whtCompute(amount=${String(h)})`, true);
    assertSane(wht.whtLineSst(h, 0.08), `whtLineSst(${String(h)})`, true);
    assertSane(wht.whtLineTotal(1000, h), `whtLineTotal(rate=${String(h)})`);
  }
  // A rate can never make the payee owe money, whatever arrives.
  for (const bad of [1, 2, 99, "5", Infinity]) {
    const c = wht.whtCompute({ wht_rate: bad, sst_rate: 0.08, penalty_pct: 0.1, basis: "gross" }, [{ amount: 1000 }]);
    assertEquals(c.netToPayee >= 0, true, `rate ${String(bad)} left the payee at ${c.netToPayee}`);
    assertEquals(c.wht <= c.fee, true, `rate ${String(bad)} withheld more than the fee`);
  }
  // A 100% rate on the net basis is the divide-by-zero, and it is guarded at both ends.
  assertSane(wht.whtCompute({ wht_rate: 1, sst_rate: 0.08, penalty_pct: 0.1, basis: "net" }, [{ amount: 1000 }]), "wht@100%");
  assertEquals(wht.whtDueDate([{ payment_date: "not-a-date" }]), null);
  assertEquals(wht.whtDueDate([{ payment_date: {} }]), null);
});

Deno.test("the O2O master rate cannot produce NaN or a negative bill", () => {
  const pharmacy = () => ({
    total_sales: 1000, commission: 192, total: 808,
    lines: [{ package: "A", unit_price: 500, quantity: 2, discount_rate: 19.2, amount: 808 }],
  });
  for (const h of HOSTILE) {
    const p = pharmacy();
    o2o.o2oApplyMasterRate(p, h);
    assertSane(p, `o2o(rate=${String(h)})`);
    // Applying twice is what turned 100% into NaN.
    o2o.o2oApplyMasterRate(p, h);
    assertSane(p, `o2o(rate=${String(h)}, twice)`);
  }
  assertSane(o2o.o2oGrandTotal(null), "grandTotal(null)");
  assertSane(o2o.o2oGrandTotal([{ total: NaN }, { total: 5 }]), "grandTotal(NaN row)");
});

Deno.test("a gateway export full of rubbish still produces a valid CSV", () => {
  for (const h of HOSTILE) {
    assertSane(gw.gwNum(h), `gwNum(${String(h)})`, true);
    assertSane(gw.gwRnd(h), `gwRnd(${String(h)})`, true);
  }
  const rows = HOSTILE.map((h, i) => ({
    "Completed Date": i % 3 === 0 ? "2026-08-01" : h,
    "Converted Amount in MYR": h, "Refunded Amount": h,
    "All Inclusive Fee Amount in MYR": h, "ID": "p" + i, "Order ID": "o" + i,
  }));
  const A = gw.gwNewAudit();
  const out = gw.gwConvertHitpay({ txn: { rows } }, A, "ymd", "ID", true, true);
  // Money-in can legitimately be negative (a refund), so amounts are not sign-checked here.
  assertSane(gw.gwTotals(out), "gwTotals", true);
  const csv = gw.gwCSV(out);
  assertEquals(/NaN|Infinity|undefined/.test(csv), false, "the CSV carries a non-number");
  // Every Amount cell must parse back as a finite number — it is imported into a ledger.
  for (const line of csv.split("\r\n").slice(1)) {
    const amt = Number(line.split(",")[1]);
    assertEquals(Number.isFinite(amt), true, `CSV row is not a number: ${line.slice(0, 80)}`);
  }
  assertEquals(gw.gwParseDate("nonsense"), null);
  assertEquals(gw.gwParseDate({}), null);
});

Deno.test("a sales sheet of rubbish produces no NaN invoice", () => {
  for (const h of HOSTILE) assertSane(sr.srNum(h), `srNum(${String(h)})`, true);
  const rows = HOSTILE.map((h, i) => ({ Date: i % 2 ? "2026-08-01" : h, Amount: h, Ref: i % 4 ? "SO-IP100" + i : h }));
  const { lines } = sr.srBuildLines({}, [{ name: "X", rows }]);
  assertSane(lines, "srBuildLines", true);
  assertSane(sr.srSummary(lines), "srSummary", true);
  assertSane(sr.srTally(lines, {}, {}), "srTally", true);
  for (const l of lines) assertEquals(Number.isFinite(l.amt), true, `line amt ${l.amt}`);
});

Deno.test("a P&L of nulls and rubbish exports no NaN", () => {
  for (const h of HOSTILE) assertSane(pnl.pnlSen(h), `pnlSen(${String(h)})`, true);
  const cell = (a: unknown) => ({ amount: a, pct: a });
  const data = {
    months: ["Jan 2026", "Feb 2026"],
    totals: { "Jan 2026": { income: NaN, expenses: Infinity, net_profit: null } },
    rows: HOSTILE.map((h, i) => ({
      section: i % 2 ? "Trading Income" : "Operating Expenses", account: "A" + i, block: "G&A",
      by_month: { "Jan 2026": cell(h), "Feb 2026": cell(h) },
    })),
  };
  const mdl = pnl.pnlBuild(data, 2, true);
  for (const line of pnl.pnlCsvLines(mdl, data.totals)) {
    assertEquals(/NaN|Infinity/.test(line), false, `CSV line: ${line.slice(0, 90)}`);
  }
  // …and with no rows at all, which takes the monthly-totals fallback.
  const bare = pnl.pnlBuild({ months: ["Jan 2026"], totals: data.totals, rows: [] }, 1, false);
  for (const line of pnl.pnlCsvLines(bare, data.totals)) {
    assertEquals(/NaN|Infinity/.test(line), false, `fallback CSV line: ${line}`);
  }
});
