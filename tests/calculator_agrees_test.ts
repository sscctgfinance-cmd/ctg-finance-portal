// The 🧮 calculator tab must agree with the payroll engine.
//
// WHY THIS FILE EXISTS: this tab quotes figures that go into offer letters and into hr_calc_audit, and it
// is a SECOND implementation of the statutory rules — so it drifts from the payslip silently. It has
// happened before: v159 found it still running the pre-v155 midpoint×rate contribution formula, quoting
// SOCSO employer 60.40 against the payslip's 60.35.
//
// It drifted again the moment v180 excluded bonus from the SOCSO/EIS wage, and it had never adopted the
// v155 additional-remuneration split, so any bonus was annualised ×12 and massively over-quoted PCB.
// Nothing caught either, because nothing compared the two.

import { assertEquals } from "jsr:@std/assert@1";
import {
  BACKEND_ENGINE, BACKEND_TABLES, FRONTEND_ENGINE, FRONTEND_TABLES, inlineScript, loadEngine,
} from "../tools/extract.ts";

const html = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
const ts = await Deno.readTextFile(new URL("../portal_current.ts", import.meta.url));
const feSrc = inlineScript(html);

// hrCalcCompute reads the HR_CALC and HR globals instead of taking them as arguments, so stand them up
// in the module rather than adding test-only hooks to the shipped app.
const PRELUDE = `
  // deno-lint-ignore prefer-const
  let HR_CALC = {}; const HR = { data: null, pay: null };
  export function __setCalc(c){ for (const k of Object.keys(HR_CALC)) delete HR_CALC[k]; Object.assign(HR_CALC, c); }
  export function __setData(d){ HR.data = d; }
`;
const fe = await loadEngine(
  feSrc,
  [...FRONTEND_ENGINE, "hrCalcNum", "hrCalcCompute"],
  FRONTEND_TABLES,
  ["hrCalcCompute"],
  PRELUDE,
);
const be = await loadEngine(ts, BACKEND_ENGINE, BACKEND_TABLES, ["computePayrollMY"]);
// deno-lint-ignore no-explicit-any
const computePayrollMY = be.computePayrollMY as any;

const CFG = {
  epf: { eeRate: 0.11, erRateLow: 0.13, erRateHigh: 0.12, threshold: 5000, erSenior: 0.04, eeSenior: 0 },
  socso: { eeRate: 0.005, erRate: 0.0175, erRate2: 0.0125, ceiling: 6000 },
  eis: { eeRate: 0.002, erRate: 0.002, ceiling: 6000 },
  reliefPersonal: 9000, reliefSpouse: 4000, reliefChild: 2000, reliefEpfMax: 4000, reliefSocsoEisMax: 350,
};

// hrCalcCompute reads the HR_CALC / HR globals from its own module scope.
// deno-lint-ignore no-explicit-any
const mod = fe as any;

function calc(basic: number, bonus = 0) {
  mod.__setData({ rates: CFG });
  mod.__setCalc({
    empId: "", inp: { basic, allowance: "", claim: "", bonus: bonus || "", deduction: "", zakat: "", relief: "" },
    flags: {
      allowance: { taxable: true, epf: true, socso: true, eis: true, pcb: true },
      bonus: { taxable: true, epf: true, socso: false, eis: false, pcb: true },
      claim: { taxable: false, epf: false, socso: false, eis: false, pcb: false },
    },
    settings: {
      epfEeRate: "", epfErRate: "", socsoCat: "", resident: true, married: false, spouseWorking: false,
      children: 0, senior: false, epfOn: true, socsoOn: true, eisOn: true,
    },
    ov: { on: false, epfEe: "", epfEr: "", socsoEe: "", socsoEr: "", eisEe: "", eisEr: "", pcb: "", reason: "" },
    result: null,
  });
  return mod.hrCalcCompute();
}

// The payroll engine, on a full 12-month year with no YTD — the same basis the calculator assumes.
function engine(basic: number, bonus = 0) {
  const emp = {
    basic_salary: basic, fixed_allowance: 0, date_of_birth: "1990-05-14", join_date: "2020-01-01",
    resign_date: null, resident: true, epf_eligible: true, socso_eligible: true, eis_eligible: true,
    socso_category: null, epf_ee_rate: null, epf_er_rate: null, marital_status: "single",
    spouse_working: false, num_children: 0, citizen_status: "citizen",
  };
  const adj = bonus ? [{ kind: "bonus", amount: bonus, epf_subject: true }] : [];
  return computePayrollMY(emp, CFG, adj, undefined, { month: 12, year: 2026 });
}

const CONTRIB = ["epfEe", "epfEr", "socsoEe", "socsoEr", "eisEe", "eisEr"] as const;

Deno.test("the SHIPPED default flags exclude bonus from SOCSO/EIS", () => {
  // The tests below pass their own flags, so they would happily pass while the app still shipped the old
  // socso:true / eis:true defaults — and the operator would see the wrong figures on a screen these tests
  // called correct. Assert what actually ships.
  const decl = feSrc.slice(feSrc.indexOf("var HR_CALC="));
  const bonus = decl.slice(decl.indexOf("bonus:{"), decl.indexOf("}", decl.indexOf("bonus:{")) + 1);
  assertEquals(/socso:false/.test(bonus), true, "default bonus flags must exclude SOCSO: " + bonus);
  assertEquals(/eis:false/.test(bonus), true, "default bonus flags must exclude EIS: " + bonus);
  assertEquals(/epf:true/.test(bonus), true, "but bonus IS EPF wages: " + bonus);
});

Deno.test("calculator matches the payroll engine on contributions — no bonus", () => {
  for (const basic of [1200, 3000, 3500, 5000, 5000.01, 6000, 8000]) {
    const c = calc(basic), e = engine(basic);
    for (const k of CONTRIB) {
      assertEquals(c[k], e[k], `basic ${basic}: ${k} — calculator ${c[k]} vs payslip ${e[k]}`);
    }
  }
});

Deno.test("calculator matches the payroll engine on a BONUS month (v180 + v155)", () => {
  // The two rules that had drifted: bonus is EPF wages but NOT SOCSO/EIS wages, and bonus is additional
  // remuneration for PCB rather than something that recurs 12 times.
  for (const [basic, bonus] of [[3500, 369], [3000, 5000], [4000, 12000], [8000, 20000]] as const) {
    const c = calc(basic, bonus), e = engine(basic, bonus);
    for (const k of CONTRIB) {
      assertEquals(c[k], e[k], `${basic}+${bonus}: ${k} — calculator ${c[k]} vs payslip ${e[k]}`);
    }
  }
});

Deno.test("the operator's payroll.my anchor — RM3,500 + RM369 bonus", () => {
  const c = calc(3500, 369);
  assertEquals(c.epfEe, 427.00, "EPF employee — bonus IS EPF wages");
  assertEquals(c.socsoEe, 17.25, "SOCSO on RM3,500, bonus excluded");
  assertEquals(c.socsoEr, 60.35);
  assertEquals(c.eisEe, 6.90, "EIS on RM3,500 — the figure payroll.my shows");
});

Deno.test("a bonus is not annualised — it must not be taxed as if it recurred monthly", () => {
  // Before this fix the whole taxable wage went through ×12, so RM4,000 + a RM12,000 bonus was taxed as
  // an RM192k salary. The bonus's own tax must be bounded by the tax on the bonus itself.
  const withB = calc(4000, 12000), noB = calc(4000);
  const delta = withB.pcb - noB.pcb;
  assertEquals(delta > 0, true, "a bonus must add some tax");
  assertEquals(delta < 12000 * 0.30, true, "but never more than the top marginal rate on the bonus itself");
  assertEquals(withB.pcb, engine(4000, 12000).pcb, "and must equal what the payslip will deduct");
});

Deno.test("employer EPF rate override flows through the calculator (v183)", () => {
  mod.__setData({ rates: CFG });
  const run = (rate: string) => {
    mod.__setCalc({
      empId: "", inp: { basic: 4000, allowance: "", claim: "", bonus: "", deduction: "", zakat: "", relief: "" },
      flags: {
        allowance: { taxable: true, epf: true, socso: true, eis: true, pcb: true },
        bonus: { taxable: true, epf: true, socso: false, eis: false, pcb: true },
        claim: { taxable: false, epf: false, socso: false, eis: false, pcb: false },
      },
      settings: {
        epfEeRate: "", epfErRate: rate, socsoCat: "", resident: true, married: false, spouseWorking: false,
        children: 0, senior: false, epfOn: true, socsoOn: true, eisOn: true,
      },
      ov: { on: false, epfEe: "", epfEr: "", socsoEe: "", socsoEr: "", eisEe: "", eisEr: "", pcb: "", reason: "" },
      result: null,
    });
    return mod.hrCalcCompute();
  };
  assertEquals(run("").epfEr, 520.00, "blank = statutory 13% at or below RM5,000");
  assertEquals(run("0.19").epfEr, 760.00, "19% override");
  assertEquals(run("0").epfEr, 0, "an explicit 0% must not fall back to statutory");
  assertEquals(run("0.19").epfEe, run("").epfEe, "the employer rate must not move the employee's EPF");
});

Deno.test("zakat displaces PCB ringgit-for-ringgit but still leaves net pay", () => {
  mod.__setData({ rates: CFG });
  const run = (zakat: string) => {
    mod.__setCalc({
      empId: "", inp: { basic: 9000, allowance: "", claim: "", bonus: "", deduction: "", zakat, relief: "" },
      flags: {
        allowance: { taxable: true, epf: true, socso: true, eis: true, pcb: true },
        bonus: { taxable: true, epf: true, socso: false, eis: false, pcb: true },
        claim: { taxable: false, epf: false, socso: false, eis: false, pcb: false },
      },
      settings: {
        epfEeRate: "", epfErRate: "", socsoCat: "", resident: true, married: false, spouseWorking: false,
        children: 0, senior: false, epfOn: true, socsoOn: true, eisOn: true,
      },
      ov: { on: false, epfEe: "", epfEr: "", socsoEe: "", socsoEr: "", eisEe: "", eisEr: "", pcb: "", reason: "" },
      result: null,
    });
    return mod.hrCalcCompute();
  };
  const none = run(""), some = run("100");
  assertEquals(Math.round((none.pcb - some.pcb) * 100) / 100, 100, "PCB drops by exactly the zakat paid");
  assertEquals(none.net, some.net, "so net pay is unchanged — that is the point of the relief");
  const huge = run("999999");
  assertEquals(huge.pcb, 0, "zakat beyond the PCB floors it at zero, never negative");
});
