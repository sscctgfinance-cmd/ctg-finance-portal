// Every figure that leaves the building is rounded to the sen ONCE, at construction.
//
// WHY THIS FILE EXISTS: three modules write money into a real ledger and none of them had a Deno test.
// All three carried the same defect, in three different disguises, and it is the one the operator found
// on the Withholding Tax screen first (a subtotal of 4,024.97 over rows adding to 4,024.95):
//
//   gateway.js    the row objects ARE both the CSV and the four summary cards. Only gwCSV rounded
//                 (`toFixed(2)`), so the card said RM 256.79 over a CSV importing RM 256.78. HitPay is
//                 the worst case — it charges in SGD and settles in MYR, so "Converted Amount in MYR"
//                 genuinely carries sub-sen digits on every row.
//   salesrecon.js WORSE: the same batch of invoices carried THREE different answers depending on how it
//                 left. srXeroRow rounded (CSV import: RM 350.00), srPostChunks did not (API body:
//                 RM 350.014), and srSummary/srTally showed the raw figure and reported a one-sen
//                 "discrepancy" against the order that the CSV would never have created.
//   pnl.js        subtotals are sums of 2dp figures in binary floating point, exported raw — so a
//                 section total left as 1234.5600000000002 in a file read against a screen showing
//                 1,234.56.
//
// The shape of the rule, for the next module: round where the figure is STORED, not where it is
// printed. A printer is one of several exits.

import { assertEquals } from "jsr:@std/assert@1";

// deno-lint-ignore no-explicit-any
async function load(file: string, names: string): Promise<any> {
  const src = await Deno.readTextFile(new URL("../" + file, import.meta.url));
  return await import("data:application/javascript," + encodeURIComponent(
    src.replace(/if \(typeof module[\s\S]*$/, `export { ${names} };`),
  ));
}

const gw = await load("gateway.js", "gwConvertHitpay, gwConvertPayex, gwConvertAtome, gwConvertNttData, gwNewAudit, gwTotals, gwCSV");
const sr = await load("salesrecon.js", "srBuildLines, srSummary, srXeroRow, srPostChunks, srTally, SR_XERO_COLS");
const pnl = await load("pnl.js", "pnlBuild, pnlCsvLines");

/** What the CSV's Amount column actually adds up to — the figure that reaches the ledger. */
const csvTotal = (csv: string, col: number) =>
  Math.round(csv.split("\r\n").slice(1).map((l) => Number(l.split(",")[col])).reduce((a, b) => a + b, 0) * 100) / 100;

/* ── gateway.js ─────────────────────────────────────────────────────────────────────────────────── */

Deno.test("HitPay: the summary card equals the CSV it is printed above", () => {
  // Sub-sen amounts are not contrived here: HitPay charges in SGD and settles in MYR.
  const txn = {
    rows: [
      { "Completed Date": "2026-08-01", "Converted Amount in MYR": "123.456", "Refunded Amount": "0", "All Inclusive Fee Amount in MYR": "2.10", "ID": "p1", "Order ID": "o1" },
      { "Completed Date": "2026-08-01", "Converted Amount in MYR": "77.774", "Refunded Amount": "0", "All Inclusive Fee Amount in MYR": "1.30", "ID": "p2", "Order ID": "o2" },
      { "Completed Date": "2026-08-02", "Converted Amount in MYR": "55.555", "Refunded Amount": "0", "All Inclusive Fee Amount in MYR": "0.90", "ID": "p3", "Order ID": "o3" },
    ],
  };
  const A = gw.gwNewAudit();
  const rows = gw.gwConvertHitpay({ txn }, A, "ymd", "ID", false, false);
  const t = gw.gwTotals(rows);
  assertEquals(csvTotal(gw.gwCSV(rows), 1), Math.round(t.sIn * 100) / 100,
    "the money-in card and the CSV disagree — the operator reconciles one against the other");
  // Every stored amount is already a sen figure, so no exit can round it differently.
  for (const r of rows) assertEquals(Math.round(r.amount * 100) / 100, r.amount, `row ${r.ref} is not a sen figure`);
  assertEquals(t.sIn, 256.79);   // 123.46 + 77.77 + 55.56, half-up per line
});

Deno.test("HitPay's derived fee rate is NOT computed on the rounded rows", () => {
  // The rate is fee ÷ gross from the transaction report, and it grosses up EVERY payout. It has to
  // stay on what HitPay actually charged on what they actually processed; rounding the denominator
  // puts a small error into a rate applied to the whole settlement.
  const txn = { rows: [{ "Completed Date": "2026-08-01", "Converted Amount in MYR": "100.004", "Refunded Amount": "0", "All Inclusive Fee Amount in MYR": "1.50", "ID": "p1" }] };
  const payout = { rows: [{ "Payout Date": "2026-08-03", "Net Payout Amount": "98.50" }] };
  const A = gw.gwNewAudit();
  gw.gwConvertHitpay({ txn, payout }, A, "ymd", "ID", true, true);
  assertEquals(A.hpFeeRate, 1.5 / 100.004, "the fee rate moved onto the rounded gross");
});

Deno.test("Payex, Atome and NTT Data store sen figures too", () => {
  const A1 = gw.gwNewAudit();
  const px = gw.gwConvertPayex(
    { txn: { rows: [{ Date: "01/08/2026", Amount: "100.005", RefundAmount: "0.001", TransactionId: "t1", CustomerName: "C" }] } },
    A1, "ymd", "TransactionId", false, false);
  assertEquals(px[0].amount, 100);

  const A2 = gw.gwNewAudit();
  const at = gw.gwConvertAtome(
    { txn: { rows: [{ "Transaction Time": "01/08/2026", "Transaction Amount": "88.888", "Atome Order ID": "a1" }] } },
    A2, "ymd", "Atome Order ID", false, false);
  assertEquals(at[0].amount, 88.89);

  const A3 = gw.gwNewAudit();
  const nt = gw.gwConvertNttData(
    { txn: { rows: [{ tx_create_date: "01/08/2026", tx_amount: "44.444", merchant_mdr_amount: "-0.50", net_amount: "43.944", gateway_tx_id: "g1" }] } },
    A3, "ymd", "gateway_tx_id", false, false);
    assertEquals(nt.find((r: { kind: string }) => r.kind === "in").amount, 44.44);
  // The NTT self-check compares gross + MDR against net; rounding the row must not break it.
  assertEquals(A3.reconOk, A3.reconTot);
});

/* ── salesrecon.js ──────────────────────────────────────────────────────────────────────────────── */

const SHEETS = [{
  name: "HITPAY",
  rows: [
    { Date: "2026-08-01", Amount: "100.005", Ref: "SO-IP1001" },
    { Date: "2026-08-01", Amount: "200.005", Ref: "SO-IP1001" },
    { Date: "2026-08-02", Amount: "50.004", Ref: "SO-IP1002" },
  ],
}];
const LOOKUP = {
  "SO-IP1001": { gt: 300.01, ch: "HITPAY", pkg: "Pkg A", odate: new Date(2026, 7, 1) },
  "SO-IP1002": { gt: 50.00, ch: "HITPAY", pkg: "Pkg B", odate: new Date(2026, 7, 2) },
};

Deno.test("an invoice is the SAME amount whether it leaves by CSV or by API", () => {
  // The defect this pins: srXeroRow rounded and srPostChunks did not, so the operator got a different
  // invoice in a real Xero ledger depending on which button they pressed.
  const { lines } = sr.srBuildLines(LOOKUP, SHEETS);
  const unitCol = sr.SR_XERO_COLS.indexOf("*UnitAmount");
  const viaCsv = lines.map((l: unknown) => Number(sr.srXeroRow(l)[unitCol]));
  const viaApi = sr.srPostChunks(lines)[0].map((x: { amount: number }) => x.amount);
  assertEquals(viaApi, viaCsv, "the API body and the CSV carry different amounts for the same invoice");
  assertEquals(viaCsv, [100.01, 200.01, 50]);
});

Deno.test("the on-screen total is the total of the invoices actually issued", () => {
  const { lines } = sr.srBuildLines(LOOKUP, SHEETS);
  const unitCol = sr.SR_XERO_COLS.indexOf("*UnitAmount");
  const issued = lines.reduce((s: number, l: unknown) => s + Number(sr.srXeroRow(l)[unitCol]), 0);
  assertEquals(Math.round(sr.srSummary(lines).tot * 100) / 100, Math.round(issued * 100) / 100);
  assertEquals(sr.srSummary(lines).tot, 350.02);
});

Deno.test("the tally reports the discrepancy the ISSUED invoices really have", () => {
  // Before the fix this said file 300.02 against an order of 300.01 — a one-sen overpayment that the
  // CSV (300.00) would never have created. An operator chasing that is chasing the rounding.
  const { lines } = sr.srBuildLines(LOOKUP, SHEETS);
  const t = sr.srTally(lines, LOOKUP, {});
  const so1 = t.find((r: { so: string }) => r.so === "SO-IP1001");
  assertEquals(so1.file, 300.02, "the tally is not looking at the invoiced figures");
  assertEquals(so1.diff, 0.01, "300.02 invoiced against a 300.01 order really is one sen over");
});

Deno.test("a sub-half-sen row is still a line, not a silent disappearance", () => {
  // The truthiness guard stays on the RAW value. Dropping such a row would remove a payment from a
  // reconciliation with nothing on screen saying so — worse than a 0.00 line.
  const { lines } = sr.srBuildLines({}, [{ name: "X", rows: [{ Date: "2026-08-01", Amount: "0.004", Ref: "" }] }]);
  assertEquals(lines.length, 1);
  assertEquals(lines[0].amt, 0);
  // …and a genuinely empty cell is still skipped.
  assertEquals(sr.srBuildLines({}, [{ name: "X", rows: [{ Date: "2026-08-01", Amount: "", Ref: "" }] }]).lines.length, 0);
});

/* ── pnl.js ─────────────────────────────────────────────────────────────────────────────────────── */

Deno.test("the P&L export carries the numbers the screen shows, not their float residue", () => {
  const months = ["Jan 2026", "Feb 2026"];
  const cell = (a: number) => ({ amount: a, pct: null });
  const data = {
    months,
    totals: {},
    rows: [
      { section: "Trading Income", account: "Sales A", by_month: { "Jan 2026": cell(0.1), "Feb 2026": cell(0.2) } },
      { section: "Trading Income", account: "Sales B", by_month: { "Jan 2026": cell(0.2), "Feb 2026": cell(0.1) } },
    ],
  };
  const mdl = pnl.pnlBuild(data, 2, false);
  const sub = mdl.rows.find((r: { label: string }) => r.label === "Total Trading Income");
  // The model keeps full precision — 0.1 + 0.2 is 0.30000000000000004 and that is not a defect.
  assertEquals(sub.vals[0].amt !== 0.3, true, "the fixture no longer exercises float accumulation");
  // The FILE must not.
  const lines = pnl.pnlCsvLines(mdl, {});
  const row = lines.find((l: string) => l.startsWith("Total Trading Income"))!;
  assertEquals(row, "Total Trading Income,0.3,0.3,0.6");
  for (const l of lines) {
    for (const cellText of l.split(",")) {
      if (/^-?\d+\.\d{3,}$/.test(cellText)) throw new Error(`CSV cell "${cellText}" carries float residue: ${l}`);
    }
  }
});

/* ── Quick Invoice's PDF ─────────────────────────────────────────────────────────────────────────── */

Deno.test("the invoice PDF adds up, and agrees with the invoice Xero issues", async () => {
  // Xero totals a document LINE BY LINE: LineAmount is qty x unitAmount rounded to the sen, and the
  // total is the sum of those. Summing the RAW products instead put three lines of 50.00 over a TOTAL
  // of 149.98 on a customer-facing invoice — 1.5 x 33.33, three times. The quantity box is a bare
  // <input type="number"> with no step, so a fractional quantity is one keystroke away.
  const app = await Deno.readTextFile(new URL("../app.html", import.meta.url));
  const at = app.indexOf("var qiLineAmt=");
  assertEquals(at > -1, true, "app.html no longer derives a per-line invoice amount");
  const block = app.slice(at, at + 2500);
  assertEquals(block.includes("s+qiLineAmt(l)"), true, "the subtotal is not the sum of the ROUNDED lines");
  assertEquals(block.includes("var amt = qiLineAmt(l);"), true, "the printed row and the subtotal use different arithmetic");

  // The arithmetic itself, driven rather than described.
  const lineAmt = (q: number, u: number) => Math.round(q * u * 100) / 100;
  const lines = [[1.5, 33.33], [1.5, 33.33], [1.5, 33.33]] as [number, number][];
  const total = lines.reduce((s, [q, u]) => s + lineAmt(q, u), 0);
  assertEquals(lines.map(([q, u]) => lineAmt(q, u)), [50, 50, 50]);
  assertEquals(Math.round(total * 100) / 100, 150, "the lines shown do not add to the total shown");
  // …and it is NOT what summing the raw products gives, or the fixture proves nothing.
  assertEquals(Math.round(lines.reduce((s, [q, u]) => s + q * u, 0) * 100) / 100, 149.98);

  // The React port must not have kept the old arithmetic — the two render the same document.
  const tsx = await Deno.readTextFile(new URL("../web/src/finance-qinv.tsx", import.meta.url));
  assertEquals(tsx.includes("s + qiLineAmt(l)"), true, "the React invoice sums raw products");
  assertEquals(tsx.includes("pdfAmt(qiLineAmt(l))"), true, "the React invoice row uses different arithmetic");
});
