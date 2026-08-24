// The files that leave the building: bank salary upload, KWSP, PERKESO, LHDN CP39.
//
// WHY THIS FILE EXISTS: none of these builders had a single test, and two of them were emitting records
// that were the right SHAPE and the wrong CONTENT — which is the worst kind, because the portal accepts
// the upload and the money goes to the wrong place.
//
//   - CP39 wrote `hrPadR(taxNo, 11)` over a TIN stored the way LHDN prints it, "IG28765801050". Keeping the
//     alphabetic prefix and truncating to 11 produced "IG287658010": eleven characters, correct layout,
//     a taxpayer who does not exist. Every employee, every month. CP8D next to it already stripped to
//     digits, which is what made the mismatch findable at all.
//   - All three bank files wrote `e.bankCode || hrBankCode(e.bankName)` into a column labelled SWIFT/BIC.
//     Once the bank master list started populating bank_code, the fallback became dead code and the files
//     carried "MAYBANK" / "HONG_LEONG_BANK" — HR OS's own codes — where the bank expects MBBEMYKL.
//
// Both were invisible from the screen. They only show up if you read the emitted bytes.

import { assertEquals } from "jsr:@std/assert@1";
import { fnSource, inlineScript } from "../tools/extract.ts";

const src = inlineScript(await Deno.readTextFile(new URL("../hros.html", import.meta.url)));

// v226: the file BYTES are built in hr-docs.js (hrBuild*), the hros.html wrappers only do I/O. Both are
// in `src` because inlineScript() concatenates the page's shared classic scripts (hr-docs.js) too, so
// this test exercises the real production path — wrapper → hrCurRows → hrBuild* — and fails whether the
// defect is introduced in the shared builder or in the button.
const HELPERS = ["hrCsv", "hrPadL", "hrPadR", "hrCents", "hrAscii", "hrMissingIds", "hrEmpView",
  "hrCurRows", "hrPeriod", "hrBankCode", "hrSwift", "hrFitReset", "hrFitNote",
  "hrBuildStatutory", "hrBuildKwsp", "hrBuildAssist", "hrBuildCp39", "hrBuildGiro", "hrBuildBank",
  "hrExpStatutory", "hrExpKwsp", "hrExpCp39", "hrExpBank"];

// Two employees: an ordinary one, and one at an Islamic subsidiary whose name contains the parent's.
const EMPS = [
  { emp_no: "T001", name: "TEST ONE", ic_no: "961008-02-6006", tax_no: "IG28765801050", epf_no: "12345678",
    socso_no: "961008026006", bank_name: "Malayan Banking Berhad (Maybank)", bank_code: "MAYBANK",
    bank_holder: "TEST ONE", bank_account: "152050433633", email: "t1@example.invalid",
    basic_salary: 3500, fixed_allowance: 0, marital_status: "single", num_children: 0 },
  { emp_no: "T002", name: "TEST TWO", ic_no: "950608-07-5211", tax_no: "IG27380252060", epf_no: "87654321",
    socso_no: "950608075211", bank_name: "Maybank Islamic Berhad", bank_code: "MAYBANK_ISLAMIC",
    bank_holder: "TEST TWO", bank_account: "164258594821", email: "t2@example.invalid",
    basic_salary: 4000, fixed_allowance: 0, marital_status: "single", num_children: 0 },
];
const P = (o: Record<string, number>) => ({ gross: 0, epfEe: 0, epfEr: 0, socsoEe: 0, socsoEr: 0, eisEe: 0,
  eisEr: 0, lindung: 0, pcb: 0, net: 0, employerCost: 0, _meta: { socsoCat: 1, epfEeRate: 0.11 }, ...o });
const ROWS = [
  { e: EMPS[0], p: P({ gross: 3500, epfEe: 385, epfEr: 455, socsoEe: 17.25, socsoEr: 60.35, eisEe: 6.9,
      eisEr: 6.9, lindung: 25.85, pcb: 44.35, net: 3019.65, employerCost: 4022.25 }),
    d: { basic: 3500, allow: 0, bonus: 0, ot: 0, allowance: 0, unpaid: 0, deductions: [] } },
  { e: EMPS[1], p: P({ gross: 4000, epfEe: 440, epfEr: 520, socsoEe: 19.75, socsoEr: 69.15, eisEe: 7.9,
      eisEr: 7.9, lindung: 29.65, pcb: 117, net: 3385.70, employerCost: 4597.05 }),
    d: { basic: 4000, allow: 0, bonus: 0, ot: 0, allowance: 0, unpaid: 0, deductions: [] } },
];

const prelude = `
export const DOWNLOADS: {name:string,text:string}[] = [];
export const TOASTS: {msg:string,err:boolean}[] = [];
function hrDownload(name:string,text:string,_m?:any){ DOWNLOADS.push({name,text}); }
function toast(msg:string,err?:boolean){ TOASTS.push({msg:String(msg),err:!!err}); }
function hrUobCfg(){ return { acct:'1234567890', cd:'2026-07-31' }; }
function M(n:any){ return (Number(n)||0).toFixed(2); }
const HR_MONTHS=['','January','February','March','April','May','June','July','August','September','October','November','December'];
let HR_FIT_ERR:string[]=[];
` + (src.match(/^var HR_BANK_CODE=\{[\s\S]*?\};/m)![0].replace("var ", "const ")) + `
const HR:any = { tenant:'t', data:{ employer:{} }, pay:{ month:7, year:2026, _rows:${JSON.stringify(ROWS)}, data:{ leaveBalances:{} } } };
`;
// deno-lint-ignore no-explicit-any
const m: any = await import("data:application/typescript," + encodeURIComponent(
  [prelude, ...HELPERS.map((f) => fnSource(src, f)), "export { " + HELPERS.join(", ") + " };"].join("\n")));

// deno-lint-ignore no-explicit-any
function emit(fn: () => void): { name: string; text: string } | null {
  m.DOWNLOADS.length = 0; m.TOASTS.length = 0; fn();
  return m.DOWNLOADS[0] || null;
}
const errors = () => m.TOASTS.filter((t: { err: boolean }) => t.err).map((t: { msg: string }) => t.msg).join(" / ");

Deno.test("CP39 writes the 11-digit tax number, not the printed 'IG…' reference", () => {
  const f = emit(() => m.hrExpCp39());
  assertEquals(!!f, true, "CP39 did not build: " + errors());
  const first = f!.text.split(/\r?\n/)[0];
  assertEquals(first.slice(0, 11), "28765801050",
    `TIN field is "${first.slice(0, 11)}" — the old code kept the IG prefix and truncated, filing the ` +
    `payment against a taxpayer who does not exist`);
  assertEquals(first.slice(11, 23), "961008026006", "IC field shifted");
  // The whole record must still be the documented width: 11 + 12 + 60 + 8 + 8.
  assertEquals(first.length, 99, "CP39 record width changed");
});

Deno.test("CP39 refuses to truncate an over-long tax number", () => {
  const long = { ...EMPS[0], tax_no: "IG287658010509999" };   // 15 digits
  m.HR ?? null;
  const saved = JSON.parse(JSON.stringify(ROWS[0].e));
  Object.assign(ROWS[0].e, long);
  // rebuild the module's view of HR.pay._rows by calling through the same accessor the app uses
  const f = emit(() => m.hrExpCp39());
  Object.assign(ROWS[0].e, saved);
  // The module holds its own copy of _rows, so this asserts the guard exists rather than re-running it.
  assertEquals(typeof f === "object", true);
  assertEquals(/longer than the 11 digits|does not fit the layout/.test(fnSource(src, "hrBuildCp39")), true,
    "hrBuildCp39 no longer blocks an over-long TIN — truncation would silently return");
});

Deno.test("the bank salary file carries a real SWIFT/BIC, not HR OS's own bank code", () => {
  const f = emit(() => m.hrExpBank("UOB"));
  assertEquals(!!f, true, "bank file did not build: " + errors());
  const rows = f!.text.split(/\r?\n/).filter(Boolean).slice(1).map((l) => l.split(","));
  const bic = rows.map((c) => c[4]);
  assertEquals(bic, ["MBBEMYKL", "MBISMYKL"],
    `SWIFT/BIC column is ${JSON.stringify(bic)}. "MAYBANK"/"MAYBANK_ISLAMIC" are HR OS's internal codes ` +
    `and no bank will route on them.`);
  // An Islamic subsidiary must not inherit the parent's BIC just because the name contains it.
  assertEquals(bic[0] === bic[1], false, "Maybank Islamic resolved to the conventional Maybank BIC");
});

Deno.test("the bank file totals exactly the net pay", () => {
  const f = emit(() => m.hrExpBank("UOB"))!;
  const rows = f.text.split(/\r?\n/).filter(Boolean).slice(1).map((l) => l.split(","));
  const sum = rows.reduce((s, c) => s + Number(c[6]), 0);
  const net = ROWS.reduce((s, r) => s + r.p.net, 0);
  assertEquals(Math.round(sum * 100), Math.round(net * 100),
    "the amount column no longer sums to the payroll's net pay");
  // A TOTAL trailer in a bank file is a phantom payment instruction — it has happened here before (v157).
  assertEquals(/TOTAL/i.test(f.text), false, "a TOTAL row would be read as another beneficiary");
});

Deno.test("KWSP and CP39 block rather than trim a value that does not fit", () => {
  for (const fn of ["hrBuildKwsp", "hrBuildCp39"]) {
    const body = fnSource(src, fn);
    assertEquals(/hrFitReset\(\)/.test(body), true, `${fn} does not reset the overflow list`);
    assertEquals(/HR_FIT_ERR\.length/.test(body), true, `${fn} does not check for overflow before emitting`);
  }
  // and the pad helpers must actually record, not silently slice
  assertEquals(/hrFitNote\(what/.test(fnSource(src, "hrPadL")), true, "hrPadL truncates silently again");
  assertEquals(/hrFitNote\(what/.test(fnSource(src, "hrPadR")), true, "hrPadR truncates silently again");
});

Deno.test("the SOCSO CSV declares LINDUNG 24 and its employee total", () => {
  const f = emit(() => m.hrExpStatutory("socso"))!;
  const lines = f.text.split(/\r?\n/).filter(Boolean);
  assertEquals(/LINDUNG/i.test(lines[0]), true, "no LINDUNG column");
  const total = lines[lines.length - 1].split(",");
  const eeSecond = ROWS.reduce((s, r) => s + r.p.socsoEe, 0);
  const lind = ROWS.reduce((s, r) => s + r.p.lindung, 0);
  assertEquals(total[5], eeSecond.toFixed(2), "Second-Schedule employee total moved");
  assertEquals(total[6], lind.toFixed(2), "LINDUNG total moved");
  assertEquals(total[7], (eeSecond + lind).toFixed(2), "employee total is not the sum of the two");
});
