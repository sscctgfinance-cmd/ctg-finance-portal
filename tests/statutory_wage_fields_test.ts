// The wage each statutory contribution was charged on, returned by BOTH engines (2026-11-02).
//
// WHY THIS FILE EXISTS: the KWSP / EPF / SOCSO / EIS / ASSIST files declared GROSS as the wage, so a non-EPF
// allowance was reported as EPF wages (and a bonus as SOCSO / EIS wages) next to a contribution computed
// without it. The files now declare `epfWage` / `socsoWage` from the engine. Those two numbers are only
// worth declaring if they are EXACTLY the base the deductions used — so this pins them against the
// contributions themselves, on both engines, rather than against a re-typed formula.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { BACKEND_ENGINE, BACKEND_TABLES, FRONTEND_ENGINE, FRONTEND_TABLES, inlineScript, loadEngine } from "../tools/extract.ts";

const html = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
const ts = await Deno.readTextFile(new URL("../supabase/functions/portal/hr.ts", import.meta.url));
const docs = await Deno.readTextFile(new URL("../hr-docs.js", import.meta.url));
const fe = await loadEngine(inlineScript(html), FRONTEND_ENGINE, FRONTEND_TABLES, ["hrCompute"]);
const be = await loadEngine(ts, BACKEND_ENGINE, BACKEND_TABLES, ["computePayrollMY"]);
// deno-lint-ignore no-explicit-any
const hrCompute = fe.hrCompute as any;
// deno-lint-ignore no-explicit-any
const computePayrollMY = be.computePayrollMY as any;

const CFG = {
  epf: { eeRate: 0.11, erRateLow: 0.13, erRateHigh: 0.12, threshold: 5000, erSenior: 0.04, eeSenior: 0 },
  socso: { eeRate: 0.005, erRate: 0.0175, erRate2: 0.0125, ceiling: 6000 },
  eis: { eeRate: 0.002, erRate: 0.002, ceiling: 6000 },
  reliefPersonal: 9000, reliefSpouse: 4000, reliefChild: 2000,
};
const PERIOD = { month: 7, year: 2026 };
const emp = (o: Record<string, unknown> = {}) => ({
  basic_salary: 4000, fixed_allowance: 0, date_of_birth: "1990-05-14", join_date: "2020-01-01", resign_date: null,
  resident: true, epf_eligible: true, socso_eligible: true, eis_eligible: true, socso_category: null,
  epf_ee_rate: null, marital_status: "single", spouse_working: false, num_children: 0, pay_type: "monthly", ...o,
});
const run = (e: Record<string, unknown>, adj: unknown[]) => {
  const a = hrCompute(e, CFG, adj, PERIOD), b = computePayrollMY(e, CFG, adj, undefined, PERIOD);
  for (const k of ["epfWage", "socsoWage", "epfEe", "socsoEe", "eisEe", "gross"]) assertEquals(a[k], b[k], `${k}: frontend vs backend`);
  return b;
};

Deno.test("non-EPF allowance and travel are in gross but in NEITHER wage; bonus is EPF wage only", () => {
  const r = run({ ...emp(), travel_allowance: 300 }, [
    { kind: "allowance", amount: 500, epf_subject: false },
    { kind: "bonus", amount: 800, epf_subject: true },
    { kind: "allowance", amount: 200, epf_subject: true },
  ]);
  assertEquals(r.gross, 4000 + 500 + 800 + 200 + 300);
  assertEquals(r.epfWage, 4000 + 800 + 200);
  assertEquals(r.socsoWage, 4000 + 200);
});

Deno.test("unpaid leave lowers both wages, as it lowers the contributions", () => {
  const r = run(emp(), [{ kind: "unpaid_leave", amount: 400, epf_subject: false }]);
  assertEquals([r.epfWage, r.socsoWage], [3600, 3600]);
});

Deno.test("the declared wages ARE the contribution bases — recomputing on them gives the same deductions", () => {
  const withExtras = run(emp(), [{ kind: "allowance", amount: 650, epf_subject: false }, { kind: "bonus", amount: 1000 }]);
  // An employee whose whole pay is the declared EPF wage pays the same EPF; same for SOCSO / EIS.
  const asEpf = run(emp({ basic_salary: withExtras.epfWage }), []);
  const asSoc = run(emp({ basic_salary: withExtras.socsoWage }), []);
  assertEquals([asEpf.epfEe, asEpf.epfWage], [withExtras.epfEe, withExtras.epfWage]);
  assertEquals([asSoc.socsoEe, asSoc.eisEe], [withExtras.socsoEe, withExtras.eisEe]);
});

Deno.test("every statutory file reads the engine's wage, and the Summary counts the non-EPF allowance", () => {
  const files = docs.slice(docs.indexOf("function hrBuildStatutory("), docs.indexOf("function hrBuildGiro("));
  assertEquals((files.match(/hrEpfWageOf\(p\)/g) || []).length, 2, "EPF CSV + KWSP");
  assertEquals((files.match(/hrSocsoWageOf\(p\)/g) || []).length, 3, "SOCSO CSV + EIS CSV + ASSIST");
  assertEquals(/hrStatWageOf\(p\)\)|f2\(p\.gross\)|hrCents\(p\.gross\)/.test(files), false, "a file reads gross / gross-less-travel as a wage again");
  assert(docs.includes("+(Number(d.allowanceNs)||0)+(Number(d.travel)||0);"), "Summary Additions must include the non-EPF allowance");
});
