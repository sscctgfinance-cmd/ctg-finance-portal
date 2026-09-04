// HR OS must agree, to the sen, with AutoCount — the payroll system CTG actually ran the year on.
//
// WHY THIS FILE EXISTS: "make HR OS compute like AutoCount" was until now an assertion nobody had
// tested. This pins it against a real, signed-off month: the AutoCount "Payroll Summary Report"
// for GTI GROUP SDN BHD, batch IPRO - IPROCARE, period 07/2026 (14 employees, total earning
// 95,135.53, net 78,071.53) — the same month HR OS holds as its only finalised run.
//
// Two things about that report are worth writing down, because both cost an hour to work out and
// neither is guessable from the column headers:
//
//   1. The "SOCSO" employee column is SOCSO ee + LINDUNG 24 combined. AutoCount has no separate
//      SKBBK column, so 74.40 on an RM8,000 earner is 29.75 + 44.65, not a Category-2 figure.
//      Reading it as SOCSO alone makes every high earner look over-deducted by RM44.65.
//   2. Allowances here are NOT statutory wages — EPF is charged on basic only. That is a per-
//      allowance setting in AutoCount, and it is why MICHELLE on 5,000 + 1,000 contributes 550
//      (11% of 5,000) rather than 660.
//
// PCB IS DELIBERATELY NOT ASSERTED HERE. MTD is cumulative — each month reconciles the year to date —
// so July's figure cannot be reproduced without January to June, which HR OS does not yet hold. Once
// those six months are migrated, the PCB comparison becomes meaningful and belongs in this file.

import { assertEquals } from "jsr:@std/assert@1";

// deno-lint-ignore no-explicit-any
async function load(file: string, names: string): Promise<any> {
  const src = await Deno.readTextFile(new URL("../" + file, import.meta.url));
  return await import("data:application/javascript," + encodeURIComponent(
    src.replace(/if \(typeof module[\s\S]*$/, `export { ${names} };`),
  ));
}
const { hrCompute } = await load("payroll.js", "hrCompute");

const CFG = {
  epf: { eeRate: 0.11, erRateLow: 0.13, erRateHigh: 0.12, threshold: 5000, eeSenior: 0, erSenior: 0.04 },
};
const PERIOD = { year: 2026, month: 7 };

type Row = {
  name: string; basic: number; allow: number; unpaid?: number; dob: string; join?: string;
  married?: boolean;
  epfEe: number; epfEr: number; socsoCol: number; socsoEr: number; eisEe: number; eisEr: number;
};

/** Every paid line of the AutoCount 07/2026 summary, transcribed column for column. */
const REPORT: Row[] = [
  { name: "ONG SOO FANG", basic: 8000, allow: 0, dob: "1986-05-13", join: "2020-07-15",
    epfEe: 880, epfEr: 960, socsoCol: 74.40, socsoEr: 104.15, eisEe: 11.90, eisEr: 11.90 },
  { name: "MICHELLE MA PEI YEE", basic: 5000, allow: 1000, dob: "1996-11-13", married: true,
    epfEe: 550, epfEr: 650, socsoCol: 61.90, socsoEr: 86.65, eisEe: 9.90, eisEr: 9.90 },
  { name: "CELINE TAN SING HOOI", basic: 3500, allow: 369, dob: "1996-10-08", join: "2022-03-01",
    epfEe: 385, epfEr: 455, socsoCol: 43.10, socsoEr: 60.35, eisEe: 6.90, eisEr: 6.90 },
  { name: "ONG SOO CHEEN", basic: 20000, allow: 0, dob: "1991-05-07", join: "2023-01-10",
    epfEe: 2200, epfEr: 2400, socsoCol: 74.40, socsoEr: 104.15, eisEe: 11.90, eisEr: 11.90 },
  { name: "H'NG KAR SENG", basic: 6000, allow: 0, dob: "1999-01-23", join: "2019-04-01",
    epfEe: 660, epfEr: 720, socsoCol: 74.40, socsoEr: 104.15, eisEe: 11.90, eisEr: 11.90 },
  { name: "LIM ZUN DI", basic: 3500, allow: 587.50, dob: "1995-06-08", join: "2023-09-05",
    epfEe: 385, epfEr: 455, socsoCol: 43.10, socsoEr: 60.35, eisEe: 6.90, eisEr: 6.90 },
  { name: "CHEAH YONG SING", basic: 4000, allow: 950, dob: "2002-03-01",
    epfEe: 440, epfEr: 520, socsoCol: 49.40, socsoEr: 69.15, eisEe: 7.90, eisEr: 7.90 },
  { name: "CHENG WEI JIE", basic: 5000, allow: 1700, dob: "1996-08-24",
    epfEe: 550, epfEr: 650, socsoCol: 61.90, socsoEr: 86.65, eisEe: 9.90, eisEr: 9.90 },
  // The only unpaid-leave line on the report, and the reason HR OS's July gross is 362.90 lower than
  // AutoCount's: AutoCount reports gross BEFORE unpaid leave and deducts it; HR OS stores it net.
  { name: "TEH PHAIK SHUANG", basic: 5000, allow: 0, unpaid: 362.90, dob: "1995-11-13",
    epfEe: 511, epfEr: 604, socsoCol: 58.10, socsoEr: 81.35, eisEe: 9.30, eisEr: 9.30 },
  { name: "CHENG EE HWA", basic: 6000, allow: 800, dob: "1998-06-23",
    epfEe: 660, epfEr: 720, socsoCol: 74.40, socsoEr: 104.15, eisEe: 11.90, eisEr: 11.90 },
  { name: "WONG TUCK HONG", basic: 6000, allow: 2000, dob: "1999-01-12",
    epfEe: 660, epfEr: 720, socsoCol: 74.40, socsoEr: 104.15, eisEe: 11.90, eisEr: 11.90 },
  { name: "NG LAY JING", basic: 5000, allow: 1500, dob: "1995-09-16",
    epfEe: 550, epfEr: 650, socsoCol: 61.90, socsoEr: 86.65, eisEe: 9.90, eisEr: 9.90 },
  { name: "MAK BAKIM", basic: 5000, allow: 600, dob: "1996-10-05",
    epfEe: 550, epfEr: 650, socsoCol: 61.90, socsoEr: 86.65, eisEe: 9.90, eisEr: 9.90 },
  // Joined 07/07/2026, so July is a part month — 3,629.03 of a 4,500 salary. Lands mid-band, which is
  // the one line that exercises KWSP's round-up rather than a wage that is already a multiple of 20.
  { name: "GOH JUN XIAN", basic: 3629.03, allow: 0, dob: "1997-12-16", join: "2026-07-07",
    epfEe: 401, epfEr: 474, socsoCol: 45.60, socsoEr: 63.85, eisEe: 7.30, eisEr: 7.30 },
];

// deno-lint-ignore no-explicit-any
function run(r: Row): any {
  const emp = {
    basic_salary: r.basic, fixed_allowance: 0, date_of_birth: r.dob, join_date: r.join || null,
    marital_status: r.married ? "married" : "single", spouse_working: false, num_children: 0,
    resident: true, citizen_status: "citizen", lindung24: true,
    epf_eligible: true, socso_eligible: true, eis_eligible: true,
  };
  const adj: Record<string, unknown>[] = [];
  // epf_subject:false is what makes EPF fall on basic only, matching how the allowance is set up in
  // AutoCount. Flip it and every allowance-earning line below fails.
  if (r.allow) adj.push({ kind: "allowance", amount: r.allow, epf_subject: false });
  if (r.unpaid) adj.push({ kind: "unpaid_leave", amount: r.unpaid });
  return hrCompute(emp, CFG, adj, PERIOD, null);
}

const sen = (n: number) => Math.round(n * 100) / 100;

Deno.test("EPF matches the AutoCount 07/2026 summary on every line", () => {
  for (const r of REPORT) {
    const o = run(r);
    assertEquals(sen(o.epfEe), r.epfEe, `${r.name} EPF employee`);
    assertEquals(sen(o.epfEr), r.epfEr, `${r.name} EPF employer`);
  }
});

Deno.test("SOCSO matches, once LINDUNG 24 is added back into AutoCount's employee column", () => {
  for (const r of REPORT) {
    const o = run(r);
    assertEquals(sen(o.socsoEe + o.lindung), r.socsoCol, `${r.name} SOCSO employee + LINDUNG 24`);
    assertEquals(sen(o.socsoEr), r.socsoEr, `${r.name} SOCSO employer`);
  }
});

Deno.test("EIS matches on every line, both sides", () => {
  for (const r of REPORT) {
    const o = run(r);
    assertEquals(sen(o.eisEe), r.eisEe, `${r.name} EIS employee`);
    assertEquals(sen(o.eisEr), r.eisEr, `${r.name} EIS employer`);
  }
});

Deno.test("KWSP's RM100 wage band above RM5,000 — SIM SOO WOAN's part month, 06/2026", () => {
  // The bug this pins was invisible for as long as every wage was a round hundred, because RM20 and
  // RM100 banding agree there. SIM SOO WOAN left on 21/06/2026, and her part month of 5,653.85 is the
  // first wage in the book that is both above RM5,000 and not a round hundred:
  //   RM20 banding  -> 5,660 -> ee 622.60 -> 623, er 679.20 -> 680   (what HR OS used to produce)
  //   RM100 banding -> 5,700 -> ee 627.00 -> 627, er 684.00 -> 684   (what AutoCount produces)
  // AutoCount's "I PROCARE JUN26" summary says 627.00 / 684.00.
  const o = hrCompute({
    basic_salary: 5653.85, fixed_allowance: 0, date_of_birth: "1993-03-15", resign_date: "2026-06-21",
    marital_status: "single", spouse_working: false, num_children: 0, resident: true,
    citizen_status: "citizen", lindung24: true, epf_eligible: true, socso_eligible: true, eis_eligible: true,
  }, CFG, [], { year: 2026, month: 6 }, null);
  assertEquals(sen(o.epfEe), 627.00, "EPF employee on a part month above RM5,000");
  assertEquals(sen(o.epfEr), 684.00, "EPF employer on a part month above RM5,000");
  // The rest of her line, so a "fix" that moves EPF by breaking something else cannot pass.
  assertEquals(sen(o.socsoEe + o.lindung), 70.60, "SOCSO employee + LINDUNG 24");
  assertEquals(sen(o.socsoEr), 98.85, "SOCSO employer");
  assertEquals(sen(o.eisEe), 11.30, "EIS employee");
});

Deno.test("the report's employer-contribution totals reconcile", () => {
  let epfEr = 0, socsoEr = 0, eisEr = 0, epfEe = 0;
  for (const r of REPORT) {
    const o = run(r);
    epfEe += o.epfEe; epfEr += o.epfEr; socsoEr += o.socsoEr; eisEr += o.eisEr;
  }
  // AutoCount's footer row, verbatim.
  assertEquals(sen(epfEe), 9382.00, "EPF employee total");
  assertEquals(sen(epfEr), 10628.00, "EPF employer total");
  assertEquals(sen(socsoEr), 1202.40, "SOCSO employer total");
  assertEquals(sen(eisEr), 137.40, "EIS employer total");
});
