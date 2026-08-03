// Frontend/backend payroll engine parity.
//
// WHY THIS FILE EXISTS: hr_payroll_finalise recomputes every payslip server-side and REJECTS the whole run
// with 409 recompute_mismatch if any figure differs by more than a sen. That is the right design — the
// server must own the statutory record — but it means the two engines are a matched pair, and any drift
// between them does not cause a small error, it stops payroll for the entire company with an error
// message that blames a stale cache.
//
// Three separate drifts shipped before this test existed:
//   - basic_set / allow_set: the grid's per-period Basic override was persisted and used by the frontend
//     but never read by computePayrollMY, so every pro-rated joiner 409'd the run, unrecoverably.
//   - age: taken as at "today" on both sides, but with local getters on the frontend and UTC on the
//     backend — they disagreed on a birthday for anyone west of MYT.
//   - cfg.taxBands: honoured by the server, hard-coded on the client.
//
// This walks a matrix through both engines and asserts they agree to the sen.

import { assertEquals } from "jsr:@std/assert@1";
import {
  BACKEND_ENGINE, BACKEND_TABLES, FRONTEND_ENGINE, FRONTEND_TABLES, fnSource, inlineScript, loadEngine,
} from "../tools/extract.ts";

const html = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
const feSrc = inlineScript(html);
const ts = await Deno.readTextFile(new URL("../portal_current.ts", import.meta.url));

const fe = await loadEngine(inlineScript(html), FRONTEND_ENGINE, FRONTEND_TABLES, ["hrCompute"]);
const be = await loadEngine(ts, BACKEND_ENGINE, BACKEND_TABLES, ["computePayrollMY"]);
// deno-lint-ignore no-explicit-any
const hrCompute = fe.hrCompute as any;
// deno-lint-ignore no-explicit-any
const computePayrollMY = be.computePayrollMY as any;

// The statutory rates row as it actually exists in hr_statutory_rates.rates.
const CFG = {
  epf: { eeRate: 0.11, erRateLow: 0.13, erRateHigh: 0.12, threshold: 5000, erSenior: 0.04, eeSenior: 0 },
  socso: { eeRate: 0.005, erRate: 0.0175, erRate2: 0.0125, ceiling: 6000 },
  eis: { eeRate: 0.002, erRate: 0.002, ceiling: 6000 },
  reliefPersonal: 9000, reliefSpouse: 4000, reliefChild: 2000, reliefEpfMax: 4000,
};

const MONEY = ["gross", "epfEe", "epfEr", "socsoEe", "socsoEr", "eisEe", "eisEr", "lindung", "pcb", "net", "employerCost"];

function baseEmp(over: Record<string, unknown> = {}) {
  return {
    basic_salary: 3000, fixed_allowance: 0, date_of_birth: "1990-05-14", join_date: "2020-01-01",
    resign_date: null, resident: true, epf_eligible: true, socso_eligible: true, eis_eligible: true,
    socso_category: null, epf_ee_rate: null, marital_status: "single", spouse_working: false,
    num_children: 0, pay_type: "monthly", hourly_rate: null, daily_rate: null, ...over,
  };
}

// The two engines are called with DIFFERENT shapes in production, which is the whole reason they drift:
//
//   frontend (hrGridRowCompute): builds a SYNTHETIC employee whose basic_salary / fixed_allowance are the
//     resolved grid values, and passes only bonus / ot / allowance / deduction / unpaid_leave.
//   backend (hr_payroll_finalise): passes the REAL employee row plus the stored adjustments, which include
//     the basic_set / allow_set rows hrGridSave persisted when the grid differed from the employee record.
//
// Comparing hrCompute and computePayrollMY on identical arguments would therefore test a contract neither
// side actually uses. This models the real call on each side.
type Scenario = {
  emp: Record<string, unknown>;
  gridBasic?: number;   // what the operator typed in the Basic cell
  gridAllow?: number;
  earnings?: { kind: string; amount: number; epf_subject?: boolean }[];
  deduction?: number;
  deductions?: { label: string; amount: number }[];   // labelled — zakat / CP38 are recognised by label
  unpaid?: number;
  ytd?: unknown;
  period?: { month: number; year: number };
};

function compare(label: string, sc: Scenario) {
  const period = sc.period ?? PERIOD;
  const empBasic = Number(sc.emp.basic_salary) || 0;
  const empAllow = Number(sc.emp.fixed_allowance) || 0;
  const basic = sc.gridBasic ?? empBasic;
  const allow = sc.gridAllow ?? empAllow;
  const common = [
    ...(sc.earnings ?? []).map((e) => ({ epf_subject: true, ...e })),
    ...(sc.deduction ? [{ kind: "deduction", amount: sc.deduction, epf_subject: false }] : []),
    ...((sc.deductions ?? []).map((d) => ({ kind: "deduction", label: d.label, amount: d.amount, epf_subject: false }))),
    ...(sc.unpaid ? [{ kind: "unpaid_leave", amount: sc.unpaid, epf_subject: false }] : []),
  ];

  const synth = { ...sc.emp, basic_salary: basic, fixed_allowance: allow };
  const a = hrCompute(synth, CFG, common, period, sc.ytd);

  // hrGridSave only writes basic_set / allow_set when the grid differs from the employee record.
  const stored = [
    ...common,
    ...(basic !== empBasic ? [{ kind: "basic_set", amount: basic, epf_subject: true }] : []),
    ...(allow !== empAllow ? [{ kind: "allow_set", amount: allow, epf_subject: true }] : []),
  ];
  const b = computePayrollMY(sc.emp, CFG, stored, undefined, period, sc.ytd);

  for (const k of MONEY) {
    const av = Math.round((Number(a[k]) || 0) * 100);
    const bv = Math.round((Number(b[k]) || 0) * 100);
    assertEquals(av, bv, `${label}: ${k} — frontend ${a[k]} vs backend ${b[k]} (this would 409 the whole run)`);
  }
}

const PERIOD = { month: 7, year: 2026 };

Deno.test("parity — salary sweep across every statutory boundary", () => {
  for (const basic of [0, 800, 2999, 3000, 4999, 5000, 5000.01, 5999, 6000, 6000.01, 8000, 25000]) {
    compare(`basic ${basic}`, { emp: baseEmp({ basic_salary: basic }) });
  }
});

Deno.test("parity — age drives EPF/SOCSO/EIS category, and must use the PERIOD not today", () => {
  // 1966-08-03 turns 60 during Aug 2026. Processing July in August is normal Malaysian practice, so
  // "today" and "period end" disagree here — exactly the case that silently applied senior rates
  // retroactively to an already-finalised July payslip.
  for (const dob of ["1966-08-03", "1966-07-31", "1966-06-15", "1990-01-01", "2005-12-31"]) {
    const emp = baseEmp({ date_of_birth: dob, basic_salary: 5000 });
    compare(`dob ${dob} (Jul 2026)`, { emp });
    compare(`dob ${dob} (Aug 2026)`, { emp, period: { month: 8, year: 2026 } });
  }
});

Deno.test("parity — grid Basic / Allowance overrides (pro-rated joiner)", () => {
  // The drift that blocked an entire company's payroll: the frontend resolved these into its synthetic
  // employee, the backend ignored the basic_set / allow_set rows entirely.
  compare("basic override", { emp: baseEmp(), gridBasic: 1500 });
  compare("allowance override", { emp: baseEmp(), gridAllow: 250 });
  compare("both overridden", { emp: baseEmp(), gridBasic: 1500, gridAllow: 250 });
  compare("override to zero", { emp: baseEmp(), gridBasic: 0 });
  compare("override upward", { emp: baseEmp(), gridBasic: 7200 });
  compare("override + earnings", {
    emp: baseEmp({ basic_salary: 4500 }), gridBasic: 4000,
    earnings: [{ kind: "bonus", amount: 2000 }, { kind: "ot", amount: 133.33 }],
    deduction: 80, unpaid: 200,
  });
});

Deno.test("parity — earnings, deductions and unpaid leave", () => {
  compare("bonus", { emp: baseEmp(), earnings: [{ kind: "bonus", amount: 5000 }] });
  compare("bonus not EPF-subject", { emp: baseEmp(), earnings: [{ kind: "bonus", amount: 5000, epf_subject: false }] });
  compare("ot + allowance", { emp: baseEmp(), earnings: [{ kind: "ot", amount: 420.5 }, { kind: "allowance", amount: 300 }] });
  compare("unpaid leave", { emp: baseEmp(), unpaid: 600 });
  compare("unpaid exceeds salary", { emp: baseEmp({ basic_salary: 1200 }), unpaid: 1500 });
  compare("deduction", { emp: baseEmp(), deduction: 150 });
});

Deno.test("parity — eligibility flags and non-residents", () => {
  compare("no EPF", { emp: baseEmp({ epf_eligible: false }) });
  compare("no SOCSO", { emp: baseEmp({ socso_eligible: false }) });
  compare("no EIS", { emp: baseEmp({ eis_eligible: false }) });
  compare("SOCSO cat 2 forced", { emp: baseEmp({ socso_category: 2 }) });
  compare("non-resident 30%", { emp: baseEmp({ resident: false, basic_salary: 9000 }) });
  compare("custom EPF ee rate", { emp: baseEmp({ epf_ee_rate: 0.09 }) });
});

Deno.test("parity — PCB reliefs and YTD reconciliation", () => {
  compare("married, spouse not working", { emp: baseEmp({ basic_salary: 9000, marital_status: "married", spouse_working: false }) });
  compare("married + 3 children", { emp: baseEmp({ basic_salary: 12000, marital_status: "married", spouse_working: false, num_children: 3 }) });
  compare("mid-year joiner", { emp: baseEmp({ basic_salary: 8000, join_date: "2026-06-16" }) });
  compare("leaver", { emp: baseEmp({ basic_salary: 8000, resign_date: "2026-09-30" }) });
  // YTD opening balances (mid-year go-live): none, on-track, under-paid and over-paid.
  for (const ytd of [
    { gross: 0, epf: 0, pcb: 0, months: 0 },
    { gross: 48000, epf: 5280, pcb: 660, months: 6 },
    { gross: 48000, epf: 5280, pcb: 0, months: 6 },
    { gross: 48000, epf: 5280, pcb: 5000, months: 6 },
  ]) {
    compare(`ytd pcb ${ytd.pcb}`, { emp: baseEmp({ basic_salary: 8000 }), ytd });
  }
});

Deno.test("parity — zakat and the SOCSO/EIS relief (v165)", () => {
  // Zakat reduces MTD ringgit-for-ringgit rather than acting as an ordinary deduction, and the employee's
  // SOCSO+EIS contributions are an allowable MTD relief capped at RM350/yr. Both were missing; both must
  // land identically on each side or every payroll run 409s.
  for (const z of [50, 200, 100000]) {   // the last must floor PCB at zero, never go negative
    compare(`zakat ${z}`, {
      emp: baseEmp({ basic_salary: 9000 }),
      deductions: [{ label: "Zakat", amount: z }],
    });
  }
  // A deduction that is NOT zakat must not touch PCB — the label match has to be specific.
  compare("non-zakat deduction", {
    emp: baseEmp({ basic_salary: 9000 }),
    deductions: [{ label: "Salary advance", amount: 200 }],
  });
  compare("zakat + other deduction", {
    emp: baseEmp({ basic_salary: 9000 }),
    deductions: [{ label: "Zakat", amount: 120 }, { label: "PTPTN", amount: 300 }],
  });
  // The SOCSO/EIS relief bites hardest around the tax threshold.
  for (const basic of [3000, 4000, 5000, 6000, 8000, 12000]) {
    compare(`socso/eis relief @ ${basic}`, { emp: baseEmp({ basic_salary: basic }) });
  }
});

Deno.test("parity — citizenship drives EPF and EIS (v166)", () => {
  // Rules verified against two independent sources each:
  //   EPF non-citizen (non-PR): 2% + 2%, mandatory from 1 Oct 2025, ceases at 75.
  //   EIS (Act 800): Malaysian citizens and PRs only — a foreign worker contributes nothing.
  //   SOCSO: unchanged — Category 1 under 60, Category 2 at 60+, same as Malaysians.
  for (const st of ["citizen", "pr", "non_citizen"]) {
    for (const basic of [1500, 4999, 5000, 7000, 25000]) {
      compare(`${st} @ ${basic}`, { emp: baseEmp({ citizen_status: st, basic_salary: basic }) });
    }
    compare(`${st} aged 62`, { emp: baseEmp({ citizen_status: st, date_of_birth: "1964-01-10", basic_salary: 5000 }) });
    compare(`${st} aged 76`, { emp: baseEmp({ citizen_status: st, date_of_birth: "1950-01-10", basic_salary: 5000 }) });
  }
});

Deno.test("rules — a foreign worker is on 2% EPF and pays no EIS", () => {
  const P = { month: 7, year: 2026 };
  const my = computePayrollMY(baseEmp({ citizen_status: "citizen",     basic_salary: 4000 }), CFG, [], undefined, P);
  const pr = computePayrollMY(baseEmp({ citizen_status: "pr",          basic_salary: 4000 }), CFG, [], undefined, P);
  const fw = computePayrollMY(baseEmp({ citizen_status: "non_citizen", basic_salary: 4000 }), CFG, [], undefined, P);

  assertEquals(pr.epfEe, my.epfEe, "a Permanent Resident follows the Malaysian rates");
  assertEquals(pr.eisEe, my.eisEe, "a Permanent Resident is covered by EIS");

  assertEquals(fw.epfEe, 80, "foreign worker EPF employee = 2% of RM4,000");
  assertEquals(fw.epfEr, 80, "foreign worker EPF employer = 2% of RM4,000");
  assertEquals(fw.eisEe, 0, "foreign workers are outside EIS (Act 800)");
  assertEquals(fw.eisEr, 0, "foreign workers are outside EIS (Act 800)");
  assertEquals(fw.socsoEe, my.socsoEe, "SOCSO is identical — foreign workers joined Category 1 in Jul 2024");
  assertEquals(fw.socsoEr, my.socsoEr);

  const old = computePayrollMY(baseEmp({ citizen_status: "citizen", date_of_birth: "1950-01-10", basic_salary: 4000 }), CFG, [], undefined, P);
  assertEquals(old.epfEe, 0, "EPF ceases at 75");
  assertEquals(old.epfEr, 0, "EPF ceases at 75");
});

Deno.test("parity + rule — TP1 declared reliefs reduce PCB (v167)", () => {
  const emp = baseEmp({ basic_salary: 9000 });
  for (const tp1 of [0, 2500, 9000, 500000]) {   // the last must not drive PCB negative
    compare(`tp1 ${tp1}`, { emp, ytd: { gross: 0, epf: 0, pcb: 0, months: 0, tp1 } });
  }
  // The relief must actually bite, and more relief must never mean more tax.
  const P = { month: 7, year: 2026 };
  const none = computePayrollMY(emp, CFG, [], undefined, P, { gross: 0, epf: 0, pcb: 0, months: 0, tp1: 0 });
  const some = computePayrollMY(emp, CFG, [], undefined, P, { gross: 0, epf: 0, pcb: 0, months: 0, tp1: 6000 });
  const huge = computePayrollMY(emp, CFG, [], undefined, P, { gross: 0, epf: 0, pcb: 0, months: 0, tp1: 500000 });
  assertEquals(some.pcb < none.pcb, true, "a declared relief must reduce PCB");
  assertEquals(huge.pcb, 0, "relief beyond the chargeable income floors PCB at zero, never negative");
  assertEquals(none.net < some.net, true, "less PCB means more take-home");
});

Deno.test("parity + rule — PCB method: payroll.my vs LHDN (v185)", () => {
  // The operator asked for payroll.my's method after being shown that it differs from LHDN's. It differs
  // in exactly two ways, both confirmed against payroll.my's own documentation:
  //   (a) SOCSO/EIS are not treated as tax relief;
  //   (b) the bonus is charged the residual annual tax MINUS the normal MTD that will actually be
  //       deducted — and a normal MTD under RM10 is nil, so the whole year's tax can land on the bonus.
  const MY = { ...CFG, pcbMethod: "payroll_my" };
  const LH = { ...CFG, pcbMethod: "lhdn" };
  const P = { month: 7, year: 2026 };
  const emp = baseEmp({ basic_salary: 3500 });
  const bonus = [{ kind: "bonus", amount: 369, epf_subject: true }];

  // The operator's own side-by-side. This is the whole point of the change.
  assertEquals(computePayrollMY(emp, MY, bonus, undefined, P).pcb, 31.10, "payroll.my figure");
  // LHDN mode reads 11.90, not the 12.05 quoted before v184: adding SKBBK to the SOCSO/EIS relief pushed
  // this employee to the RM350 annual cap, which shaved ~15 sen off the monthly MTD. That the payroll.my
  // figure is UNCHANGED by v184 is itself the tell — that method grants no SOCSO/EIS relief at all.
  assertEquals(computePayrollMY(emp, LH, bonus, undefined, P).pcb, 11.90, "LHDN figure, still available");

  // Default must be payroll.my (cfg with no pcbMethod at all).
  assertEquals(computePayrollMY(emp, CFG, bonus, undefined, P).pcb, 31.10, "default is payroll.my");

  // Without a bonus the two methods differ ONLY by the SOCSO/EIS relief, and both stay nil here.
  assertEquals(computePayrollMY(emp, MY, [], undefined, P).pcb, 0);
  assertEquals(computePayrollMY(emp, LH, [], undefined, P).pcb, 0);

  // Both engines must agree under BOTH methods, or finalise 409s the whole run.
  for (const cfgName of ["payroll_my", "lhdn"]) {
    for (const basic of [1200, 3500, 5000, 9000, 25000]) {
      for (const b of [0, 369, 12000]) {
        const label = `${cfgName} ${basic}+${b}`;
        const a = hrCompute({ ...emp, basic_salary: basic }, { ...CFG, pcbMethod: cfgName },
          b ? [{ kind: "bonus", amount: b, epf_subject: true }] : [], P, undefined);
        const s = computePayrollMY({ ...emp, basic_salary: basic }, { ...CFG, pcbMethod: cfgName },
          b ? [{ kind: "bonus", amount: b, epf_subject: true }] : [], undefined, P, undefined);
        for (const k of MONEY) {
          assertEquals(Math.round((Number(a[k]) || 0) * 100), Math.round((Number(s[k]) || 0) * 100),
            `${label}: ${k} — frontend ${a[k]} vs backend ${s[k]}`);
        }
      }
    }
  }

  // payroll.my's method must never deduct MORE than the whole year's tax on the combined income — that
  // is its own upper bound, and a sanity floor on the "everything lands in the bonus month" behaviour.
  const big = computePayrollMY(baseEmp({ basic_salary: 4000 }), MY,
    [{ kind: "bonus", amount: 12000, epf_subject: true }], undefined, P);
  assertEquals(big.pcb > 0, true);
  assertEquals(big.pcb <= 4000 * 12 + 12000, true, "cannot exceed the income it is taxing");

  // A high earner already paying real monthly MTD: the normal part is NOT nil, so it IS subtracted, and
  // the two methods converge to within the SOCSO/EIS relief. This is the case that shows (b) only bites
  // when the normal MTD was suppressed.
  const hiMy = computePayrollMY(baseEmp({ basic_salary: 9000 }), MY, bonus, undefined, P);
  const hiLh = computePayrollMY(baseEmp({ basic_salary: 9000 }), LH, bonus, undefined, P);
  assertEquals(Math.abs(hiMy.pcb - hiLh.pcb) < 15, true,
    `high earner should be close, got ${hiMy.pcb} vs ${hiLh.pcb}`);
});

Deno.test("parity + rule — LINDUNG 24 Jam / SKBBK (v184)", () => {
  const JUN26 = { month: 6, year: 2026 }, MAY26 = { month: 5, year: 2026 }, JUL26 = { month: 7, year: 2026 };
  for (const period of [MAY26, JUN26, JUL26]) {
    for (const basic of [1200, 3050, 5000, 6000, 9000]) {
      for (const l of [true, false]) {
        compare(`lindung ${l} @ ${basic} ${period.month}/${period.year}`, { emp: baseEmp({ basic_salary: basic, lindung24: l }), period });
      }
    }
  }

  const at2 = (over: Record<string, unknown>, period = JUL26) => computePayrollMY(baseEmp(over), CFG, [], undefined, period);

  // Employee-only: it must reduce net pay and must NOT appear in employer cost.
  const on = at2({ basic_salary: 3050 }), off = at2({ basic_salary: 3050, lindung24: false });
  assertEquals(on.lindung, 22.85, "the published RM3,000.01–3,100 figure");
  assertEquals(off.lindung, 0, "opted out contributes nothing");
  assertEquals(on.employerCost, off.employerCost, "there is NO employer share");
  assertEquals(Math.round((off.net - on.net) * 100) / 100, 22.85, "it comes straight out of net pay");

  // The scheme did not exist before June 2026 — deducting it earlier would invent a liability.
  assertEquals(at2({ basic_salary: 3050 }, MAY26).lindung, 0, "May 2026: scheme not yet in force");
  assertEquals(at2({ basic_salary: 3050 }, JUN26).lindung, 22.85, "June 2026: in force");

  // Mandatory for foreign workers — their opt-out flag must be ignored.
  assertEquals(at2({ basic_salary: 3050, citizen_status: "non_citizen", lindung24: false }).lindung, 22.85,
    "a foreign worker cannot opt out");
  // ...but EIS still excludes them, so the two must not be confused for each other.
  assertEquals(at2({ basic_salary: 3050, citizen_status: "non_citizen" }).eisEe, 0, "EIS still excludes non-citizens");

  // 60+ (SOCSO Cat 2) still contribute: both renamed categories include Non-Employment Injury.
  const senior = at2({ basic_salary: 3050, date_of_birth: "1960-01-01" });
  assertEquals(senior.socsoEe, 0, "Cat 2 pays no ordinary employee SOCSO");
  assertEquals(senior.lindung, 22.85, "but SKBBK still applies at 60+");

  // No SOCSO coverage at all → no SKBBK either; the ceiling clamps.
  assertEquals(at2({ basic_salary: 3050, socso_eligible: false }).lindung, 0, "not SOCSO-covered, not SKBBK-covered");
  assertEquals(at2({ basic_salary: 99999 }).lindung, 44.65, "clamped at the RM6,000 ceiling");

  // Act 4 wage definition — bonus is excluded here exactly as it is for SOCSO/EIS (v180).
  const withBonus = computePayrollMY(baseEmp({ basic_salary: 3050 }), CFG,
    [{ kind: "bonus", amount: 5000, epf_subject: true }], undefined, JUL26);
  assertEquals(withBonus.lindung, 22.85, "a bonus must not raise SKBBK");
});

Deno.test("parity + rule — employer EPF rate override (v183)", () => {
  // payroll.my exposes "Employer EPF Rate" as a plain dropdown; HR OS could only DERIVE it, so an
  // above-statutory contribution (directors, senior staff) could not be paid at all.
  for (const er of [null, 0, 0.04, 0.12, 0.13, 0.15, 0.19]) {
    for (const basic of [3000, 5000, 5000.01, 8000]) {
      compare(`epf_er_rate ${er} @ ${basic}`, { emp: baseEmp({ basic_salary: basic, epf_er_rate: er }) });
    }
  }

  const P = { month: 7, year: 2026 };
  const at = (over: Record<string, unknown>) => computePayrollMY(baseEmp(over), CFG, [], undefined, P);

  // The override must actually bite, and must NOT touch the employee side.
  const dflt = at({ basic_salary: 4000 });                      // statutory: 13% at or below RM5,000
  const high = at({ basic_salary: 4000, epf_er_rate: 0.19 });
  assertEquals(dflt.epfEr, 520.00, "statutory employer 13% on RM4,000");
  assertEquals(high.epfEr, 760.00, "19% override applies");
  assertEquals(high.epfEe, dflt.epfEe, "the employer override must not move the employee's EPF");

  // It outranks the derived threshold, the 60+ rate and the non-citizen rate — same precedence as the
  // employee override, otherwise "I set 15%" would silently not apply to exactly the staff it is for.
  assertEquals(at({ basic_salary: 8000, epf_er_rate: 0.13 }).epfEr, 1040.00, "beats the >RM5,000 12% rate");
  assertEquals(at({ basic_salary: 4000, date_of_birth: "1960-01-01", epf_er_rate: 0.13 }).epfEr, 520.00, "beats the 60+ 4% rate");
  assertEquals(at({ basic_salary: 4000, citizen_status: "non_citizen", epf_er_rate: 0.13 }).epfEr, 520.00, "beats the non-citizen 2% rate");

  // 0 must mean zero, not "fall back to statutory" — the classic falsy-override bug.
  assertEquals(at({ basic_salary: 4000, epf_er_rate: 0 }).epfEr, 0, "an explicit 0% must contribute nothing");
  assertEquals(at({ basic_salary: 4000, epf_er_rate: 0 }).epfEe, dflt.epfEe, "and must not disturb the employee side");

  // Ineligible still wins: no EPF means no EPF, whatever rate is set.
  assertEquals(at({ basic_salary: 4000, epf_eligible: false, epf_er_rate: 0.19 }).epfEr, 0, "EPF-ineligible stays zero");
  assertEquals(at({ basic_salary: 4000, date_of_birth: "1945-01-01", epf_er_rate: 0.19 }).epfEr, 0, "EPF ceases at 75");
});

Deno.test("the grid's synthetic employee carries EVERY field hrCompute reads (v182)", () => {
  // In production the frontend does NOT hand hrCompute the employee row — hrGridRowCompute builds a
  // hand-written WHITELIST of fields. The backend recompute uses the real row. So any field the engine
  // reads but the whitelist forgets makes the engines disagree, and hr_payroll_finalise 409s the whole
  // company's payroll with an error blaming a stale cache.
  //
  // citizen_status was missing exactly this way: a foreign worker is 2%+2% EPF and no EIS on the server,
  // but full Malaysian rates on screen. It was invisible only because every current employee is a citizen.
  //
  // Derive the requirement from the engine's own source rather than listing fields here, so a field added
  // to hrCompute later fails this test instead of failing payroll.
  const engine = fnSource(feSrc, "hrCompute");
  const synth = fnSource(feSrc, "hrGridRowCompute");
  const reads = [...new Set([...engine.matchAll(/\bemp\.([a-zA-Z_][\w]*)/g)].map((m) => m[1]))].sort();
  assertEquals(reads.length > 8, true, "sanity: hrCompute should read many employee fields, got " + reads.length);
  const missing = reads.filter((f) => !new RegExp("\\b" + f + "\\s*:").test(synth));
  assertEquals(missing, [], "hrGridRowCompute's synthetic employee drops field(s) hrCompute reads");
});

Deno.test("rule — bonus is EPF wages but NOT SOCSO/EIS wages (v180)", () => {
  // Both engines charged SOCSO and EIS on a wage that included the bonus, so a bonus month over-deducted
  // from the employee and over-contributed for the company — and the PERKESO filing would not reconcile.
  // The Employees' Social Security Act 1969 definition of wages excludes bonus; EIS (Act 800) adopts the
  // same definition. EPF is the opposite: bonus IS EPF wages.
  //
  // Anchor is a real side-by-side against payroll.my: RM3,500 salary + RM369 bonus. It charges SOCSO/EIS
  // on 3,500 and EPF on 3,869 — EPF already agreed to the sen, SOCSO/EIS did not.
  const emp = baseEmp({ basic_salary: 3500 });
  const bonus = [{ kind: "bonus", amount: 369 }];
  compare("3500 + 369 bonus", { emp, earnings: bonus });

  const withB = computePayrollMY(emp, CFG, [{ kind: "bonus", amount: 369, epf_subject: true }], undefined, PERIOD);
  assertEquals(withB.socsoEe, 17.25, "SOCSO employee must be the RM3,400.01-3,500 band, not the bonus-inflated one");
  assertEquals(withB.socsoEr, 60.35, "SOCSO employer likewise");
  assertEquals(withB.eisEe, 6.90, "EIS on RM3,500 — payroll.my agrees; the bug gave 7.70");
  assertEquals(withB.eisEr, 6.90);
  assertEquals(withB.epfEe, 427.00, "EPF DOES include the bonus: Third Schedule band for RM3,869");

  // And the structural claim, independent of the anchor: a bonus moves EPF and never moves SOCSO/EIS.
  const noB = computePayrollMY(emp, CFG, [], undefined, PERIOD);
  assertEquals(withB.socsoEe, noB.socsoEe, "a bonus must not change SOCSO");
  assertEquals(withB.socsoEr, noB.socsoEr);
  assertEquals(withB.eisEe, noB.eisEe, "a bonus must not change EIS");
  assertEquals(withB.eisEr, noB.eisEr);
  assertEquals(withB.epfEe > noB.epfEe, true, "a bonus MUST raise EPF");

  // A bonus big enough to cross the ceiling must not sneak the wage over it either.
  const huge = computePayrollMY(baseEmp({ basic_salary: 4000 }), CFG,
    [{ kind: "bonus", amount: 50000, epf_subject: true }], undefined, PERIOD);
  const plain = computePayrollMY(baseEmp({ basic_salary: 4000 }), CFG, [], undefined, PERIOD);
  assertEquals(huge.socsoEr, plain.socsoEr, "a RM50k bonus must not push SOCSO to the ceiling band");
  assertEquals(huge.eisEe, plain.eisEe);

  // An allowance is NOT a bonus — it stays in the SOCSO/EIS wage. Narrowing this fix past bonus would
  // under-contribute, which is the expensive direction (back-payment plus penalties).
  const allow = computePayrollMY(emp, CFG, [{ kind: "allowance", amount: 369, epf_subject: true }], undefined, PERIOD);
  assertEquals(allow.socsoEe > noB.socsoEe, true, "an allowance still counts as SOCSO wages");
});

Deno.test("parity — no engine produces a negative or non-finite figure", () => {
  const a = hrCompute(baseEmp({ basic_salary: 1200 }), CFG, [{ kind: "deduction", amount: 99999 }], PERIOD);
  for (const k of MONEY) {
    assertEquals(Number.isFinite(Number(a[k])), true, `${k} is not finite`);
    if (k !== "net") assertEquals(Number(a[k]) >= 0, true, `${k} went negative`);
  }
});
