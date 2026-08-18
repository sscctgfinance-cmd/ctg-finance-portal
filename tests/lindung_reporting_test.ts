// LINDUNG 24 Jam (SKBBK) must reach every downstream artefact, not just the calculation.
//
// WHY THIS FILE EXISTS: the engine computed LINDUNG correctly from the day it shipped (v184) and subtracted
// it from net pay — and then every consumer dropped it. The payslip PDF listed EPF, SOCSO, EIS and PCB and
// then printed a net that was lower than those deductions explained. The PERKESO ASSIST submission and the
// SOCSO CSV declared only the Second-Schedule contribution, so the money was taken from employees and never
// declared to PERKESO (RM515.40 on CTG4U's July 2026 run alone). The EA form and CP8D under-reported the
// employee's annual contribution, which also shrinks the RM350 relief they can claim.
//
// Nothing failed. Nothing errored. The figures were simply absent, and only a hand-check of one payslip
// against its own net pay would have caught it. Hence this file: a money component that reaches net pay must
// reach the documents too.

import { assertEquals } from "jsr:@std/assert@1";
import { BACKEND_ENGINE, BACKEND_TABLES, FRONTEND_ENGINE, FRONTEND_TABLES, fnSource, inlineScript, loadEngine } from "../tools/extract.ts";

const html = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
const feSrc = inlineScript(html);
const ts = await Deno.readTextFile(new URL("../supabase/functions/portal/hr.ts", import.meta.url));

// deno-lint-ignore no-explicit-any
const fe: any = await loadEngine(feSrc, FRONTEND_ENGINE, FRONTEND_TABLES, ["hrCompute"]);
// deno-lint-ignore no-explicit-any
const be: any = await loadEngine(ts, BACKEND_ENGINE, BACKEND_TABLES, ["computePayrollMY"]);

const CFG = {
  epf: { eeRate: 0.11, erRateLow: 0.13, erRateHigh: 0.12, threshold: 5000, erSenior: 0.04, eeSenior: 0 },
  socso: { eeRate: 0.005, erRate: 0.0175, erRate2: 0.0125, ceiling: 6000 },
  eis: { eeRate: 0.002, erRate: 0.002, ceiling: 6000 },
};
const PERIOD = { month: 7, year: 2026 };
const emp = (over: Record<string, unknown> = {}) => ({
  basic_salary: 3500, fixed_allowance: 0, epf_eligible: true, socso_eligible: true, eis_eligible: true,
  resident: true, date_of_birth: "1995-01-01", marital_status: "single", num_children: 0,
  citizen_status: "citizen", lindung24: true, ...over,
});

Deno.test("a payslip's listed deductions must add up to its net pay", () => {
  // This is the invariant the shipped payslip broke. If LINDUNG is not one of the printed lines, the
  // employee sees deductions that do not explain the number at the bottom of the page.
  for (const basic of [1500, 3500, 3869, 5000, 6000, 8000, 20000]) {
    for (const ded of [0, 250]) {
      const adj = ded ? [{ kind: "deduction", amount: ded, epf_subject: false }] : [];
      for (const [label, calc] of [["frontend", fe.hrCompute], ["backend", be.computePayrollMY]] as const) {
        const c = label === "frontend"
          ? (calc as (...a: unknown[]) => any)(emp({ basic_salary: basic }), CFG, adj, PERIOD)
          : (calc as (...a: unknown[]) => any)(emp({ basic_salary: basic }), CFG, adj, undefined, PERIOD);
        const listed = c.epfEe + c.socsoEe + (c.lindung || 0) + c.eisEe + c.pcb + ded;
        assertEquals(Math.round((c.gross - listed) * 100) / 100, Math.round(c.net * 100) / 100,
          `${label} @ ${basic}: gross ${c.gross} - deductions ${listed} != net ${c.net}`);
      }
    }
  }
});

Deno.test("LINDUNG is a real, non-zero deduction — the test above is not vacuous", () => {
  const c = be.computePayrollMY(emp({ basic_salary: 3500 }), CFG, [], undefined, PERIOD);
  assertEquals(c.lindung > 0, true, "LINDUNG is zero, so nothing above proves anything");
  assertEquals(c.lindung, 25.85, "RM3,400.01-3,500 band");
});

// The consumers. Each is identified by the function that builds it; the assertion is only that LINDUNG is
// referenced at all — a weak check that would nonetheless have caught every one of these misses.
const CONSUMERS: [string, string, string][] = [
  ["hrDrawPayslip", "the payslip PDF", feSrc],
  ["hrExpStatutory", "the SOCSO CSV export", feSrc],
  ["hrExpAssist", "the PERKESO ASSIST submission file", feSrc],
  ["hrExpSummary", "the payroll summary report", feSrc],
  ["hrDrawEA", "the EA form (year-end)", feSrc],
  ["hrPaySumHtml", "the statutory-payable summary cards", feSrc],
];

for (const [fn, what, src] of CONSUMERS) {
  Deno.test(`${what} reports LINDUNG (${fn})`, () => {
    const body = fnSource(src, fn);
    assertEquals(typeof body === "string" && body.length > 0, true, `could not find ${fn} — rename?`);
    assertEquals(/lindung/i.test(body as string), true,
      `${fn} never mentions lindung, so ${what} silently omits it while net pay includes it`);
  });
}

Deno.test("the backend returns LINDUNG on both payslip read paths", () => {
  // hr_payslips stores lindung24; both readers used to drop it on the way out.
  for (const [api, what] of [["hr_my_payslips", "employee self-service payslips"], ["hr_annual", "EA / year-end totals"]]) {
    const at = ts.indexOf(`api === "${api}"`);
    assertEquals(at > 0, true, `${api} not found`);
    const block = ts.slice(at, at + 4000);
    assertEquals(/lindung/i.test(block), true, `${api} does not read lindung24 — ${what} under-report it`);
  }
});

Deno.test("the finalise snapshot still persists lindung24", () => {
  // If this write ever drops, everything above becomes a test of zeroes.
  assertEquals(/lindung24:\s*s\.c\.lindung/.test(ts), true,
    "hr_payroll_finalise no longer writes lindung24 to hr_payslips");
  assertEquals(/const NUMF=\[[^\]]*"lindung"/.test(ts), true,
    "lindung dropped out of NUMF, so the server would stop verifying it against the screen");
});
