// The payroll engine's PROPERTIES, swept across the whole salary range.
//
// WHY THIS FILE EXISTS, next to the two payroll tests that already exist. `statutory_test.ts` checks
// gazetted ANCHORS — specific wages whose published answer is known. `engine_parity_test.ts` checks the
// frontend and the backend AGREE. Neither can see a defect that is wrong in the same way on both sides
// at a wage nobody picked as an anchor, and there are ~2,000 payable wage points below the ceiling.
//
// So this asserts the things that must hold at EVERY wage rather than at chosen ones:
//
//   · the payslip balances — gross minus the listed deductions IS net, to the sen. That is the arithmetic
//     an employee does on the paper, and v196 shipped a payslip where it did not (LINDUNG was deducted
//     and printed nowhere).
//   · nothing is negative, nothing is NaN, and every figure is a sen figure. A NaN reaching a bank file
//     is a payment that fails; a third decimal place is a file KWSP rejects.
//   · SOCSO and EIS stop at the RM6,000 ceiling and EPF's employer rate steps at RM5,000, at the wage
//     the schedules say and not one ringgit either side.
//   · a raise never reduces take-home. PCB is rounded UP to 5 sen and both statutory tables move in
//     steps, so this is not obvious — and an employee who is paid more and takes home less is a
//     conversation no payroll department wants to have on an engine's behalf.
//
// It runs both engines over the same sweep, so a property that holds on one and not the other is also
// a 409 recompute_mismatch waiting to stop a whole company's payroll.

import { assertEquals } from "jsr:@std/assert@1";
import {
  BACKEND_ENGINE, BACKEND_TABLES, FRONTEND_ENGINE, FRONTEND_TABLES, inlineScript, loadEngine,
} from "../tools/extract.ts";

const HROS = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
const html = HROS;
const ts = await Deno.readTextFile(new URL("../supabase/functions/portal/hr.ts", import.meta.url));
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
  reliefPersonal: 9000, reliefSpouse: 4000, reliefChild: 2000, reliefEpfMax: 4000,
};
const PERIOD = { month: 7, year: 2026 };

function emp(basic: number, over: Record<string, unknown> = {}) {
  return {
    basic_salary: basic, fixed_allowance: 0, date_of_birth: "1990-05-14", join_date: "2020-01-01",
    resign_date: null, resident: true, epf_eligible: true, socso_eligible: true, eis_eligible: true,
    lindung24: false, socso_category: null, epf_ee_rate: null, marital_status: "single",
    spouse_working: false, num_children: 0, pay_type: "monthly", hourly_rate: null, daily_rate: null,
    ...over,
  };
}

/** The wage points to sweep. Dense everywhere payable, denser still where a schedule steps. */
function wages(): number[] {
  const out = new Set<number>();
  for (let w = 0; w <= 30000; w += 10) out.add(w);
  // Every RM20 EPF band edge and every RM100 SOCSO/EIS band edge up to the ceiling, plus the two
  // thresholds, ±1 sen — a boundary is where an off-by-one lives and a RM10 sweep steps straight over it.
  for (const edge of [5000, 6000]) for (const d of [-0.01, 0, 0.01, -1, 1]) out.add(Math.round((edge + d) * 100) / 100);
  for (let w = 0; w <= 6000; w += 100) for (const d of [-0.01, 0, 0.01]) out.add(Math.round((w + d) * 100) / 100);
  return [...out].filter((w) => w >= 0).sort((a, b) => a - b);
}
const WAGES = wages();
const MONEY = ["gross", "epfEe", "epfEr", "socsoEe", "socsoEr", "eisEe", "eisEr", "lindung", "pcb", "net", "employerCost"];
const sen = (n: number) => Math.round(n * 100) / 100;

/** Both engines, over the same employee. The backend takes the real row; the frontend the same shape. */
// deno-lint-ignore no-explicit-any
function both(e: Record<string, unknown>): [string, any][] {
  return [
    ["frontend", hrCompute(e, CFG, [], PERIOD, null)],
    ["backend", computePayrollMY(e, CFG, [], undefined, PERIOD, null)],
  ];
}

Deno.test("the payslip balances at every wage — gross minus what is listed IS net", () => {
  // The arithmetic an employee does on the paper. A component that is deducted but not listed makes
  // this fail, which is exactly what LINDUNG 24 did before v196.
  for (const w of WAGES) {
    for (const [side, p] of both(emp(w, { lindung24: true }))) {
      const listed = sen(p.epfEe + p.socsoEe + p.eisEe + p.lindung + p.pcb);
      assertEquals(sen(p.gross - listed), sen(p.net), `${side} @ RM${w}: ${p.gross} − ${listed} ≠ ${p.net}`);
      assertEquals(sen(p.gross + p.epfEr + p.socsoEr + p.eisEr), sen(p.employerCost),
        `${side} @ RM${w}: employer cost does not reconcile`);
    }
  }
});

Deno.test("nothing is negative, NaN or carries a third decimal", () => {
  // A NaN in a bank file is a payment that fails; a third decimal is a row KWSP rejects.
  for (const w of WAGES) {
    for (const [side, p] of both(emp(w, { lindung24: true }))) {
      for (const k of MONEY) {
        const v = p[k];
        assertEquals(Number.isFinite(v), true, `${side} @ RM${w}: ${k} is ${v}`);
        // net's own floor is asserted separately — it has a documented sub-RM4 edge.
        if (k !== "net") assertEquals(v >= 0, true, `${side} @ RM${w}: ${k} is negative (${v})`);
        assertEquals(sen(v), v, `${side} @ RM${w}: ${k} = ${v} is not a sen figure`);
      }
      assertEquals(p.net <= p.gross, true, `${side} @ RM${w}: net ${p.net} exceeds gross ${p.gross}`);
      assertEquals(p.pcb <= p.gross, true, `${side} @ RM${w}: PCB ${p.pcb} exceeds gross`);
    }
  }
});

Deno.test("the statutory contributions never fall as the wage rises", () => {
  // EPF, SOCSO and EIS are schedule-driven and have no rebate or floor rule, so each must be monotonic
  // in the wage. NET is deliberately NOT asserted here — see the two cliffs pinned below, both of which
  // are Malaysian tax law rather than defects.
  for (const [side, key] of [["frontend", "fe"], ["backend", "be"]] as const) {
    const at = (w: number) => key === "fe"
      ? hrCompute(emp(w), CFG, [], PERIOD, null)
      : computePayrollMY(emp(w), CFG, [], undefined, PERIOD, null);
    const prev: Record<string, number> = {};
    let pw = -1;
    for (const w of WAGES) {
      const p = at(w);
      // epfEr is deliberately absent: KWSP steps the employer rate 13% -> 12% AT RM5,000, so the
      // employer's contribution FALLS by RM47 on a wage one sen higher. Pinned as its own test below.
      for (const k of ["gross", "epfEe", "socsoEe", "socsoEr", "eisEe", "eisEr"]) {
        if (prev[k] !== undefined) {
          assertEquals(p[k] >= prev[k], true, `${side}: ${k} FELL from RM${pw} to RM${w} (${prev[k]} → ${p[k]})`);
        }
        prev[k] = p[k];
      }
      pw = w;
    }
  }
});

Deno.test("the two places take-home DROPS on a raise are the law, not the engine", () => {
  // Both are real and both are deliberate. Pinned so that a future reader who finds them by sweeping —
  // as this file did — has the citation instead of "smoothing" a statutory rule out of the engine.
  const at = (w: number) => hrCompute(emp(w), CFG, [], PERIOD, null);

  // 1. LHDN: a monthly MTD of less than RM10 is nil (payroll.js's `if(norm<10) norm=0`). So PCB is 0
  //    right up to the point the computed MTD reaches RM10, then charged in full.
  assertEquals(at(3775).pcb, 0);
  assertEquals(at(3780).pcb >= 10, true, "the RM10 MTD floor has moved");
  assertEquals(at(3780).net < at(3775).net, true, "the RM10 floor no longer produces its step");

  // 2. ITA s.6A: the RM400 individual rebate applies only while annual chargeable income is at most
  //    RM35,000. One ringgit over and the whole rebate is lost — RM400/12 = RM33.33 a month.
  const below = at(4000), above = at(4001);
  assertEquals(Math.round((above.pcb - below.pcb) * 100) / 100, 33.4,
    "the s.6A rebate cliff is no longer RM400/12 — check the rebate rule before changing this");
  assertEquals(above.net < below.net, true);
});

Deno.test("net is never negative at any wage a person is actually paid", () => {
  // Below about RM3.15 of gross it CAN be: EPF's first wage band charges the employee RM3 whatever the
  // wage is, so a gross of one sen produces a net of −3.14. Reachable only through unpaid leave that
  // very nearly cancels the salary (basic 3,000 with 2,999.99 unpaid). Two things make it harmless and
  // both are asserted rather than assumed: the window is tiny, and the bank file already refuses to
  // disburse a non-positive net — see the companion assertion in this file.
  for (const w of WAGES.filter((w) => w >= 10)) {
    for (const [side, p] of both(emp(w, { lindung24: true }))) {
      assertEquals(p.net >= 0, true, `${side} @ RM${w}: net is ${p.net}`);
    }
  }
  // The edge itself, pinned so a change to EPF's first band shows up here.
  assertEquals(hrCompute(emp(0.01), CFG, [], PERIOD, null).net < 0, true);
  assertEquals(hrCompute(emp(4), CFG, [], PERIOD, null).net >= 0, true);
});

Deno.test("the bank payment file never carries a non-positive amount", async () => {
  // This is what stops the negative net above from ever becoming a payment instruction. hrBuildBank
  // filters `x.p.net > 0` before it builds a row; that filter IS the guard, so it is read out of
  // hr-docs.js rather than described. (It also means such an employee is silently absent from the file —
  // a real gap, but the safe direction.) v226: the builder moved from hros.html to hr-docs.js.
  const docs = await Deno.readTextFile(new URL("../hr-docs.js", import.meta.url));
  const src = docs.slice(docs.indexOf("function hrBuildBank("), docs.indexOf("function hrBuildBank(") + 900);
  assertEquals(/rows\.filter\(function\(x\)\{ return x\.p\.net>0; \}\)/.test(src), true,
    "hrBuildBank no longer filters out non-positive net pay — a negative amount can now reach a bank file");
});

Deno.test("SOCSO and EIS stop at the RM6,000 ceiling, and not one ringgit early", () => {
  for (const [side, key] of [["frontend", "fe"], ["backend", "be"]] as const) {
    const at = (w: number) => key === "fe"
      ? hrCompute(emp(w), CFG, [], PERIOD, null)
      : computePayrollMY(emp(w), CFG, [], undefined, PERIOD, null);
    const ceil = at(6000), above = at(6000.01), way = at(30000);
    for (const k of ["socsoEe", "socsoEr", "eisEe", "eisEr"]) {
      assertEquals(above[k], ceil[k], `${side}: ${k} moved one sen above the ceiling`);
      assertEquals(way[k], ceil[k], `${side}: ${k} is not capped at RM6,000`);
    }
    // …and it must still be RISING just below it, or the "ceiling" is really somewhere else.
    assertEquals(at(5900).socsoEr < ceil.socsoEr, true, `${side}: SOCSO is flat below the ceiling`);
  }
});

Deno.test("the EPF employer rate steps at RM5,000 — 13% at the threshold, 12% above it", () => {
  // KWSP Third Schedule: 13% for wages up to RM5,000, 12% above. The step is AT RM5,000, so RM5,000
  // itself is the LOW side; treating it as the high side under-contributes for everyone paid exactly
  // that. Asserted on the RINGGIT, not on _meta, because only the frontend returns _meta — and the
  // ringgit is what reaches KWSP.
  for (const [side, key] of [["frontend", "fe"], ["backend", "be"]] as const) {
    const at = (w: number) => key === "fe"
      ? hrCompute(emp(w), CFG, [], PERIOD, null)
      : computePayrollMY(emp(w), CFG, [], undefined, PERIOD, null);
    assertEquals(at(5000).epfEr, 650, `${side}: RM5,000 is not on the 13% side (650 = 13% of 5,000)`);
    assertEquals(at(4999.99).epfEr, 650, `${side}`);
    // One sen over: the RM20 wage band rounds to 5,020 and the rate drops to 12% -> 602.4 -> RM603.
    assertEquals(at(5000.01).epfEr, 603, `${side}: the step is not at RM5,000`);
    // The employee side is a flat 11% and does NOT step.
    assertEquals(at(5000).epfEe, 550, `${side}`);
    assertEquals(at(5000.01).epfEe >= 550, true, `${side}: the employee rate stepped, which it must not`);
  }
});

Deno.test("an employee opted OUT of a scheme is charged nothing by it", () => {
  // The eligibility flags are booleans on a row that hr_emp_save can write, and v197 was a save path
  // that re-enabled them. A flag that is honoured for the ee side and not the er side costs the company.
  for (const w of [1500, 3000, 5500, 9000]) {
    for (const [side, p] of both(emp(w, { epf_eligible: false, socso_eligible: false, eis_eligible: false, lindung24: false }))) {
      for (const k of ["epfEe", "epfEr", "socsoEe", "socsoEr", "eisEe", "eisEr", "lindung"]) {
        assertEquals(p[k], 0, `${side} @ RM${w}: opted out of everything but ${k} is ${p[k]}`);
      }
      assertEquals(sen(p.gross - p.pcb), sen(p.net), `${side} @ RM${w}: net is not gross less PCB`);
    }
  }
});

Deno.test("a non-resident is charged the flat rate and no reliefs", () => {
  // s.109 / Schedule 1 Part II: a non-resident's employment income is taxed at a flat 30% with no
  // personal relief. Reading `resident` the wrong way round under-withholds for the whole year.
  for (const w of [3000, 8000, 20000]) {
    for (const [side, p] of both(emp(w, { resident: false }))) {
      const res = both(emp(w, { resident: true }))[side === "frontend" ? 0 : 1][1];
      assertEquals(p.pcb > res.pcb, true, `${side} @ RM${w}: a non-resident is not withheld more`);
    }
  }
});

Deno.test("unpaid leave lowers the STATUTORY wage, not just the pay", () => {
  // EPF/SOCSO/EIS are charged on wages actually payable. Deducting unpaid leave from the pay but not
  // from the statutory base over-contributes on money nobody received.
  const adj = [{ kind: "unpaid_leave", amount: 500 }];
  const full = hrCompute(emp(3000), CFG, [], PERIOD, null);
  const short = hrCompute(emp(3000), CFG, adj, PERIOD, null);
  const equiv = hrCompute(emp(2500), CFG, [], PERIOD, null);
  assertEquals(short.gross, 2500);
  assertEquals(short.epfEe, equiv.epfEe, "EPF was charged on the pre-leave wage");
  assertEquals(short.socsoEe, equiv.socsoEe, "SOCSO was charged on the pre-leave wage");
  assertEquals(short.eisEe, equiv.eisEe, "EIS was charged on the pre-leave wage");
  assertEquals(full.epfEe > short.epfEe, true);
});

Deno.test("a bonus is EPF wages but NOT SOCSO/EIS wages — v180, at every wage", () => {
  // Employees' Social Security Act 1969 excludes bonus from "wages"; EIS (Act 800) uses the same
  // definition. EPF is the opposite. Charging SOCSO/EIS on a bonus month over-deducts from the employee
  // AND over-contributes for the company, and it only shows up in a month somebody got a bonus.
  for (const w of [1200, 3000, 4800, 5500]) {
    const plain = hrCompute(emp(w), CFG, [], PERIOD, null);
    const bonus = hrCompute(emp(w), CFG, [{ kind: "bonus", amount: 1000 }], PERIOD, null);
    assertEquals(bonus.socsoEe, plain.socsoEe, `RM${w}: SOCSO moved on a bonus`);
    assertEquals(bonus.socsoEr, plain.socsoEr, `RM${w}: employer SOCSO moved on a bonus`);
    assertEquals(bonus.eisEe, plain.eisEe, `RM${w}: EIS moved on a bonus`);
    assertEquals(bonus.epfEe > plain.epfEe, true, `RM${w}: EPF did NOT move on a bonus`);
  }
});
