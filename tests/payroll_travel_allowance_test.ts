// Travel allowance on HR OS payroll (2026-11-02).
//
// WHY THIS FILE EXISTS: the operator asked for a travel allowance — a fixed figure on the employee profile,
// overridable per month on the grid (`travel_set`), with the statutory treatment Malaysian law gives it:
//   - NOT statutory wages: EPF Act 1991 s.2, Act 4 (SOCSO / LINDUNG 24) and Act 800 (EIS) all exclude
//     "travelling allowance" — so EPF, SOCSO, EIS and LINDUNG must not move by a sen.
//   - PCB: LHDN exempts up to RM6,000 a year of travel / petrol / toll allowance for official duties; only
//     the excess is income. The cap is spent in calendar order (ytd.travel = what was paid earlier).
// Both engines must agree to the sen or hr_payroll_finalise 409s the whole company's run, and they are
// called with DIFFERENT shapes (the grid hands a synthetic employee; the server reads the real row plus
// stored adjustments) — so the parity cases model the real call on each side, as engine_parity_test does.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { BACKEND_ENGINE, BACKEND_TABLES, FRONTEND_ENGINE, FRONTEND_TABLES, inlineScript, loadEngine } from "../tools/extract.ts";

const html = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
const ts = await Deno.readTextFile(new URL("../supabase/functions/portal/hr.ts", import.meta.url));
const docs = await Deno.readTextFile(new URL("../hr-docs.js", import.meta.url));
const fe = await loadEngine(inlineScript(html), FRONTEND_ENGINE, FRONTEND_TABLES, ["hrCompute"]);
const be = await loadEngine(ts, BACKEND_ENGINE, BACKEND_TABLES, ["computePayrollMY", "payTravel"]);
// deno-lint-ignore no-explicit-any
const hrCompute = fe.hrCompute as any;
// deno-lint-ignore no-explicit-any
const computePayrollMY = be.computePayrollMY as any;
// deno-lint-ignore no-explicit-any
const payTravel = be.payTravel as any;

const CFG = {
  epf: { eeRate: 0.11, erRateLow: 0.13, erRateHigh: 0.12, threshold: 5000, erSenior: 0.04, eeSenior: 0 },
  socso: { eeRate: 0.005, erRate: 0.0175, erRate2: 0.0125, ceiling: 6000 },
  eis: { eeRate: 0.002, erRate: 0.002, ceiling: 6000 },
  reliefPersonal: 9000, reliefSpouse: 4000, reliefChild: 2000,
};
const PERIOD = { month: 7, year: 2026 };
const MONEY = ["gross", "epfEe", "epfEr", "socsoEe", "socsoEr", "eisEe", "eisEr", "lindung", "pcb", "net", "employerCost", "travel", "travelTaxable"];
const STATUTORY = ["epfEe", "epfEr", "socsoEe", "socsoEr", "eisEe", "eisEr", "lindung"];

function emp(over: Record<string, unknown> = {}) {
  return {
    basic_salary: 9000, fixed_allowance: 0, date_of_birth: "1990-05-14", join_date: "2020-01-01",
    resign_date: null, resident: true, epf_eligible: true, socso_eligible: true, eis_eligible: true,
    socso_category: null, epf_ee_rate: null, marital_status: "single", spouse_working: false,
    num_children: 0, pay_type: "monthly", ...over,
  };
}
// The real call on each side: the grid resolves the cell into the synthetic employee and sends NO
// travel_set; the server reads the profile figure and the stored travel_set row (only when they differ).
function both(profile: number, cell: number, ytd?: unknown, over: Record<string, unknown> = {}) {
  const a = hrCompute({ ...emp(over), travel_allowance: cell }, CFG, [], PERIOD, ytd);
  const adj = cell !== profile ? [{ kind: "travel_set", amount: cell, epf_subject: false }] : [];
  const b = computePayrollMY({ ...emp(over), travel_allowance: profile }, CFG, adj, undefined, PERIOD, ytd);
  for (const k of MONEY) {
    assert(Math.abs(Number(a[k]) - Number(b[k])) <= 0.01, `profile ${profile} / cell ${cell}: ${k} — frontend ${a[k]} vs backend ${b[k]}`);
  }
  return b;
}

Deno.test("no travel allowance changes nothing — the field absent, zero, or a zero override", () => {
  const plain = computePayrollMY(emp(), CFG, [], undefined, PERIOD);
  for (const r of [both(0, 0), computePayrollMY({ ...emp(), travel_allowance: null }, CFG, [], undefined, PERIOD)]) {
    for (const k of ["gross", "pcb", "net", "employerCost", ...STATUTORY]) assertEquals(r[k], plain[k], k);
    assertEquals(r.travel, 0);
  }
  // A profile figure overridden to 0 for one month really is 0 that month.
  assertEquals(both(800, 0).travel, 0);
});

Deno.test("travel reaches gross, net and employer cost — and NO statutory contribution", () => {
  const plain = computePayrollMY(emp(), CFG, [], undefined, PERIOD);
  const t = both(450, 450);
  assertEquals(t.travel, 450);
  assertEquals(t.gross, plain.gross + 450);
  for (const k of STATUTORY) assertEquals(t[k], plain[k], `${k} moved — travelling allowance is not wages`);
  assertEquals(t.employerCost, plain.employerCost + 450);
  // RM450 x 12 = RM5,400 < RM6,000: fully exempt, so not a sen of PCB either.
  assertEquals(t.travelTaxable, 0);
  assertEquals(t.pcb, plain.pcb);
  assertEquals(t.net, plain.net + 450);
});

Deno.test("a grid override (travel_set) wins over the profile, identically on both sides; last row wins", () => {
  assertEquals(both(300, 750).travel, 750);
  assertEquals(both(750, 300).travel, 300);
  const dup = [{ kind: "travel_set", amount: 100 }, { kind: "travel_set", amount: 250 }];
  assertEquals(computePayrollMY({ ...emp(), travel_allowance: 900 }, CFG, dup, undefined, PERIOD).travel, 250);
  assertEquals(hrCompute({ ...emp(), travel_allowance: 900 }, CFG, dup, PERIOD).travel, 250);
  assertEquals(payTravel({ travel_allowance: 900 }, dup), 250);
  assertEquals(payTravel({ travel_allowance: 900 }, []), 900);
  assertEquals(payTravel({ travel_allowance: -50 }, []), 0, "a negative figure is refused");
});

Deno.test("the RM6,000 exemption is spent in calendar order — only the excess this month is taxable", () => {
  assertEquals(both(500, 500, { travel: 0 }).travelTaxable, 0);
  assertEquals(both(500, 500, { travel: 5800 }).travelTaxable, 300, "200 of the cap left");
  assertEquals(both(500, 500, { travel: 6000 }).travelTaxable, 500, "cap already spent");
  assertEquals(both(500, 500, { travel: 9000 }).travelTaxable, 500);
  // A config may move the cap (hr_statutory_rates.rates.travelExemptMax).
  const cfg = { ...CFG, travelExemptMax: 3000 };
  const a = hrCompute({ ...emp(), travel_allowance: 500 }, cfg, [], PERIOD, { travel: 2800 });
  const b = computePayrollMY({ ...emp(), travel_allowance: 500 }, cfg, [], undefined, PERIOD, { travel: 2800 });
  assertEquals([a.travelTaxable, b.travelTaxable], [300, 300]);
});

Deno.test("PCB: projected over the year — under RM6,000/yr no tax, over it the excess is taxed", () => {
  const jan = { month: 1, year: 2026 };
  const plain = computePayrollMY(emp(), CFG, [], undefined, jan, { travel: 0 });
  const under = computePayrollMY({ ...emp(), travel_allowance: 500 }, CFG, [], undefined, jan, { travel: 0 });    // 6,000/yr exactly
  const over = computePayrollMY({ ...emp(), travel_allowance: 1000 }, CFG, [], undefined, jan, { travel: 0 });    // 12,000/yr
  assertEquals(under.pcb, plain.pcb, "exactly at the cap: no PCB");
  assert(over.pcb > plain.pcb, `RM6,000 a year of taxable travel must raise PCB (${over.pcb} vs ${plain.pcb})`);
  // And the frontend agrees in the same month.
  assertEquals(hrCompute({ ...emp(), travel_allowance: 1000 }, CFG, [], jan, { travel: 0 }).pcb, over.pcb);
  // Past travel sits in ytd.gross IN FULL; its exempt share must come back out, or every later month
  // is taxed on travel the law exempts. With 6 x 500 already paid (all exempt), PCB matches plain.
  const ytdPlain = { gross: 6 * 9000, epf: 6 * 990, pcb: 6 * plain.pcb, months: 6, travel: 0 };
  const ytdTravel = { ...ytdPlain, gross: 6 * 9500, travel: 3000 };
  const p7 = computePayrollMY(emp(), CFG, [], undefined, PERIOD, ytdPlain);
  const t7 = computePayrollMY({ ...emp(), travel_allowance: 500 }, CFG, [], undefined, PERIOD, ytdTravel);
  assertEquals(t7.pcb, p7.pcb, "exempt travel already paid this year was taxed again");
});

Deno.test("non-resident: 30% on statutory wage plus the TAXABLE travel only", () => {
  const nr = (t: number, yt: number) => both(t, t, { travel: yt }, { resident: false });
  assertEquals(nr(500, 0).pcb, nr(0, 0).pcb, "exempt travel is not taxed at 30% either");
  assert(nr(500, 6000).pcb > nr(0, 0).pcb);
});

Deno.test("an hourly worker's base is backed out of gross WITHOUT the travel in it", () => {
  // hr_payroll_finalise: baseOverride = gross - earnings + unpaid - travel. Here: base 1,200 + travel 300.
  const r = computePayrollMY({ ...emp({ pay_type: "hourly" }), travel_allowance: 300 }, CFG, [], 1200, PERIOD);
  assertEquals(r.gross, 1500);
  const fin = ts.slice(ts.indexOf('if (api === "hr_payroll_finalise")'));
  assert(fin.includes("baseOverride=Math.max(0, Number(r.gross||0) - earnSum + unpaidSum - payTravel(emp, adjE));"));
});

Deno.test("the record: finalise writes travel, YTD reads it back, EA/CP8D drop the exempt share", () => {
  assert(ts.includes("travel:s.c.travel"), "the payslip row must record the travel paid");
  assert(ts.includes('select("employee_id,gross,epf_ee,pcb,travel,run_id")'), "YTD must read travel");
  assert(ts.includes("out[id].travel += Number(p.travel)||0;"));
  const ann = ts.slice(ts.indexOf('if (api === "hr_annual")'), ts.indexOf('if (api === "hr_post_xero")'));
  assert(ann.includes("t.travelExempt=payRound2(Math.min(t.travel, cap)); t.gross=payRound2(t.gross - t.travelExempt);"));
  assert(ts.includes('keepIfSent("travel",   "travel_allowance"'), "the profile figure must save");
});

Deno.test("grid + files: travel_set saved as a delta; wages columns and CP39 exclude it", () => {
  assert(html.includes("if((Number(g.travel)||0)!==(Number(e.travel_allowance)||0)) out.push({employee_id:e.id,kind:'travel_set'"));
  assert(html.includes("travel_allowance:Number(g.travel)||0, epf_eligible"), "the grid must hand the cell to the engine");
  assert(docs.includes("if(_trv) row('Travel allowance',_trv);"), "the payslip must print it");
  // No EPF / SOCSO / EIS wages column and no KWSP / ASSIST wage may read raw gross any more.
  const files = docs.slice(docs.indexOf("function hrBuildStatutory("), docs.indexOf("function hrBuildGiro("));
  assertEquals(/f2\(p\.gross\)|hrCents\(p\.gross\)/.test(files), false, "a statutory file reads gross as wages again");
  // eval the two helpers: with no travel they ARE gross, so every other file is unchanged.
  const fn = new Function(docs.slice(docs.indexOf("function hrStatWageOf("), docs.indexOf("function hrBuildStatutory(")) + "; return [hrStatWageOf, hrTaxRemOf];");
  const [wage, rem] = fn();
  assertEquals([wage({ gross: 3500 }), rem({ gross: 3500 })], [3500, 3500]);
  assertEquals([wage({ gross: 4000, travel: 500, travelTaxable: 200 }), rem({ gross: 4000, travel: 500, travelTaxable: 200 })], [3500, 3700]);
});
