// HR OS · Payroll Calculator — the React half of the strangler's fifth screen.
//
// The legacy original is `hrCalculator()` at hros.html:4870 (with `hrCalcOutHtml()` at :4836 and the
// `hrCI`/`hrCS`/`hrCO`/`hrCF` mutators at :4856-4859) and it is STILL THERE and still shipping; nothing
// was deleted. Both are reachable side by side (`hros.html#tab=calculator` and `/hr/calculator/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. That is what lets
// tests/hr-calculator.parity.test.tsx render it with `renderToStaticMarkup` and diff the result against
// tests/golden/hr.calculator.html. The loading, the session and the state live in
// app/hr/calculator/page.tsx, on the other side of that line.
//
// ── The statutory engine is IMPORTED, never re-expressed ─────────────────────────────────────────────
// `calcCompute()` below is `hrCalcCompute()` (hros.html:4761) moved across verbatim, and every figure in
// it still comes out of payroll.js — hrEpfParts, myStatLookup + the gazetted MY_SOCSO_CAT1/CAT2/MY_EIS
// tables, myLindung24, myPcbRoundUp5, hrProgTax, hrRound2. Not one rate, table row or rounding step is
// re-typed here: a wrong statutory figure over-deducts from every employee at once and silently, and
// payroll.js is the copy that tests/statutory_test.ts and tests/engine_parity_test.ts pin.
// What IS here is this screen's own wage-base assembly (which item feeds which base, per the flag grid),
// because that is the calculator's UI, not the engine.
//
// ── Two things the legacy renderer emits that React cannot, and what was done about them ─────────────
// 1. `ln()` (hros.html:4837) writes TWO `style=` attributes on the amount span when a colour is asked
//    for: `<span style="font-size:13px" style="color:var(--coral-soft);font-size:13px">`. HTML says a
//    duplicate attribute is a parse error and the second one is DROPPED, so the colour has never reached
//    an operator's screen — every amount on this panel renders in the default text colour, not coral or
//    green. React cannot emit a duplicate attribute at all, so this component emits the one the browser
//    keeps (`font-size`) and NOT the dead colour. That is the same DOM, and it is deliberate: making the
//    colour appear is a visible change to the screen and belongs in its own PR against hros.html, where
//    the golden would move with it. See the parity test's `sameDocument()`.
// 2. `ln()`'s non-bold row style ends in a stray `;` (`padding:5px 0;`). It is reproduced exactly —
//    React trims but does not strip it — so the comparison stays byte-exact on style values. React logs
//    one dev warning about it per run; that warning IS the legacy quirk, and silencing it by tidying the
//    value would be a diff against the golden.
//
// NOT reachable from the golden, mirrored from the legacy source anyway (see CLAUDE.md — "a branch the
// golden does not hold is not covered, say so where you write it"): the manual-override panel
// (`ov.on === false` when the golden was captured), the "Enter a Basic Salary to calculate" placeholder
// (`res === null`, i.e. the statutory rates have not loaded), and the audit-log list, which the legacy
// screen paints into `#hrcalc_hist` with `hrCalcHistory()` (hros.html:4910) after a click. The parity
// test does not reach any of the three.

import type { CSSProperties, FocusEvent, ReactNode } from 'react';

import {
  MY_EIS, MY_SOCSO_CAT1, MY_SOCSO_CAT2,
  hrEpfParts, hrProgTax, hrRound2, myLindung24, myLindungActive, myPcbRoundUp5, myStatLookup,
} from '../../payroll.js';

/* ────────────────────────────── the state this screen is a view of ────────────────────────────── */

/** `HR_CALC.inp` — hros.html:4752. Strings because they are what an `<input>` holds. */
export interface CalcInputs {
  basic: string | number;
  allowance: string | number;
  claim: string | number;
  bonus: string | number;
  deduction: string | number;
  zakat: string | number;
  relief: string | number;
}

/** One row of `HR_CALC.flags` — which statutory bases this pay item feeds. */
export interface ItemFlags { taxable: boolean; epf: boolean; socso: boolean; eis: boolean; pcb: boolean }

export type FlagItem = 'allowance' | 'bonus' | 'claim';
export type FlagKey = keyof ItemFlags;

/** `HR_CALC.settings` — hros.html:4758. The rate selects hold '' for "use the default". */
export interface CalcSettings {
  epfEeRate: string;
  epfErRate: string;
  socsoCat: string;
  resident: boolean;
  married: boolean;
  spouseWorking: boolean;
  children: string | number;
  senior: boolean;
  epfOn: boolean;
  socsoOn: boolean;
  eisOn: boolean;
  lindungOn: boolean;
}

/** `HR_CALC.ov` — hros.html:4759. */
export interface CalcOverride {
  on: boolean;
  epfEe: string; epfEr: string; socsoEe: string; socsoEr: string; eisEe: string; eisEr: string; pcb: string;
  reason: string;
}
export type OverrideKey = Exclude<keyof CalcOverride, 'on'>;

export interface CalcState {
  empId: string;
  inp: CalcInputs;
  flags: Record<FlagItem, ItemFlags>;
  settings: CalcSettings;
  ov: CalcOverride;
}

/** `HR_CALC`'s initial value — hros.html:4752-4759. */
export const CALC_INITIAL: CalcState = {
  empId: '',
  inp: { basic: '', allowance: '', claim: '', bonus: '', deduction: '', zakat: '', relief: '' },
  // v183: bonus defaults to socso:false / eis:false to match the payroll engine — the Employees' Social
  // Security Act 1969 wage definition excludes bonus, and EIS (Act 800) shares it. EPF stays on.
  flags: {
    allowance: { taxable: true, epf: true, socso: true, eis: true, pcb: true },
    bonus: { taxable: true, epf: true, socso: false, eis: false, pcb: true },
    claim: { taxable: false, epf: false, socso: false, eis: false, pcb: false },
  },
  settings: {
    epfEeRate: '', epfErRate: '', socsoCat: '', resident: true, married: false, spouseWorking: false,
    children: 0, senior: false, epfOn: true, socsoOn: true, eisOn: true, lindungOn: true,
  },
  ov: { on: false, epfEe: '', epfEr: '', socsoEe: '', socsoEr: '', eisEe: '', eisEr: '', pcb: '', reason: '' },
};

/** `HR.data.rates` — only the fields this screen reads. */
export interface CalcRates {
  epf: { eeRate: number; eeSenior?: number; erSenior?: number; erRateLow: number; erRateHigh: number; threshold: number };
  reliefPersonal?: number;
  reliefSpouse?: number;
  reliefChild?: number;
  reliefEpfMax?: number;
  reliefSocsoEisMax?: number;
  pcbMethod?: string;
}

/** What `hrCalcCompute()` returns. */
export interface CalcResult {
  epfEe: number; epfEr: number; socsoEe: number; socsoEr: number; eisEe: number; eisEr: number;
  lindung: number; pcb: number; gross: number;
  epfWage: number; socsoWage: number; eisWage: number; taxWage: number;
  _eeRate: number; _erRate: number; _scat: number;
  overridden: boolean; net: number; employerCost: number;
  deduction: number; claim: number; zakat: number; relief: number;
}

/**
 * The employee rows the prefill picker lists — `HR.data.employees`. The picker itself shows `emp_no` and
 * `name`; the other four are what `hrCalcPayslip()` (hros.html:4890) prints in the PDF header.
 */
export interface CalcEmployee {
  id: string;
  emp_no: string;
  name: string;
  ic_no?: string | null;
  position?: string | null;
  dept?: string | null;
}

/** One row of `hr_calc_history` — hros.html:4910. */
export interface CalcAuditRow {
  created_at?: string | null;
  employee_name?: string | null;
  created_by?: string | null;
  overridden?: boolean;
  reason?: string | null;
  result?: { net?: number } | null;
}

/** What `#hrcalc_hist` holds. `null` is the golden's state: the button has not been pressed. */
export type CalcHistoryState =
  | { loading: true }
  | { error: string }
  | { rows: CalcAuditRow[] }
  | null;

/** `HR_MONTHS` — hros.html:1265. */
const HR_MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** What `hrDrawPayslip()` is handed, plus the name the file is saved under. */
export interface CalcPayslipDoc {
  e: Record<string, unknown>;
  p: Record<string, unknown>;
  period: { month: number; year: number; label: string };
  d: Record<string, unknown>;
  fileName: string;
}

/**
 * `hrCalcPayslip()`'s ARGUMENTS — hros.html:4890.
 *
 * NO GOLDEN SEES A PDF, so this is split out of the route the same way `bankFile()` was split out of
 * hr-expenses and `profileBody()` out of hr-profile: the mapping from the calculator's state to the four
 * objects `hrDrawPayslip()` draws is the part with one right answer, and it is pinned in this screen's
 * own test. The drawing itself is `hr-docs.js`'s and is not re-expressed anywhere.
 *
 * `now` is a PARAMETER, not `new Date()`: the legacy function stamps the payslip with the month it is
 * RUN in (not the month being calculated), and a component or helper that read the clock itself would
 * be untestable and would drift on the 1st. hr.yearend's `taxYears(now)` rule.
 *
 * Two things here look like mistakes and are not — both are mirrored from the legacy source, and the
 * test pins them so a later "tidy-up" is a red test rather than a wrong document:
 *   • `gross` is `res.gross + res.claim`. The claim is EXCLUDED from `res.gross` by the engine (it is
 *     usually a non-taxable reimbursement) and added back for the payslip, because the employee is paid
 *     it. Drop the `+ res.claim` and the printed deductions no longer explain the printed net.
 *   • the claim is carried into the payslip's `allowance` slot, and the calculator's own `allowance`
 *     input into `e.allowance` (the fixed monthly figure in the header). They are different fields.
 */
export function calcPayslipDoc(C: CalcState, res: CalcResult, emp: CalcEmployee | null, now: Date): CalcPayslipDoc {
  const e = {
    empNo: emp ? emp.emp_no : 'CALC',
    name: emp ? emp.name : 'Payroll Calculation',
    ic: emp ? emp.ic_no : '',
    position: emp ? emp.position : '',
    dept: emp ? emp.dept : '',
    basic: num(C.inp.basic),
    allowance: num(C.inp.allowance),
    bank: '',
    resident: C.settings.resident,
  };
  const p = {
    gross: hrRound2(res.gross + res.claim),
    epfEe: res.epfEe, epfEr: res.epfEr, socsoEe: res.socsoEe, socsoEr: res.socsoEr,
    eisEe: res.eisEe, eisEr: res.eisEr, lindung: res.lindung, pcb: res.pcb,
    net: res.net, employerCost: res.employerCost,
    _meta: {
      epfEeRate: res._eeRate, epfErRate: res._erRate, socsoCat: res._scat,
      pcbCat: (C.settings.resident === false ? 0 : 1), senior: C.settings.senior,
    },
  };
  const d = {
    bonus: num(C.inp.bonus),
    ot: 0,
    allowance: num(C.inp.claim),
    deductions: num(C.inp.deduction) ? [{ label: 'Deduction', amount: num(C.inp.deduction) }] : [],
    unpaid: 0,
  };
  const month = now.getMonth() + 1, year = now.getFullYear();
  return {
    e, p, d,
    period: { month, year, label: HR_MONTHS[month] + ' ' + year },
    fileName: 'Payroll_Calc_' + (emp ? emp.emp_no : 'adhoc') + '.pdf',
  };
}

/* ────────────────────────────────────── the computation ────────────────────────────────────── */

/** `hrCalcNum()` — hros.html:4760. */
function num(v: unknown): number { const n = Number(v); return isNaN(n) ? 0 : n; }

/**
 * `hrCalcCompute()` — hros.html:4761, moved across unchanged.
 *
 * Not part of the render: it is called by the route and its result handed in as a prop, so the component
 * itself stays a pure function of props. It is exported from this file rather than the route's, because
 * the parity test has to run the REAL engine to prove the React screen quotes the same figures the
 * legacy one does — feeding the component a hand-written result would prove only that spans nest.
 *
 * `myLindungActive(null)` reads the clock, exactly as the legacy call does; that is the one reason this
 * is not inside the component.
 */
export function calcCompute(C: CalcState, cfg: CalcRates | null | undefined): CalcResult | null {
  const inp = C.inp, fl = C.flags, s = C.settings;
  if (!cfg) return null;
  const basic = num(inp.basic), allow = num(inp.allowance), claim = num(inp.claim), bonus = num(inp.bonus), ded = num(inp.deduction);
  const zakat = num(inp.zakat), relief = num(inp.relief);
  const items = [
    { a: basic, f: { taxable: true, epf: true, socso: true, eis: true, pcb: true } as ItemFlags },
    { a: allow, f: fl.allowance }, { a: bonus, f: fl.bonus }, { a: claim, f: fl.claim },
  ];
  const baseFor = (k: FlagKey) => items.reduce((t, it) => (it.f && it.f[k] ? t + it.a : t), 0);
  const epfWage = baseFor('epf'), socsoWage = baseFor('socso'), eisWage = baseFor('eis'), taxWage = baseFor('pcb');
  const grossPay = basic + allow + bonus, senior = !!s.senior;
  const eeRate = (s.epfEeRate !== '' && s.epfEeRate != null) ? Number(s.epfEeRate)
    : (senior ? (cfg.epf.eeSenior != null ? cfg.epf.eeSenior : 0) : cfg.epf.eeRate);
  const erRate = (s.epfErRate !== '' && s.epfErRate != null) ? Number(s.epfErRate)
    : senior ? (cfg.epf.erSenior != null ? cfg.epf.erSenior : 0.04)
      : (epfWage <= cfg.epf.threshold ? cfg.epf.erRateLow : cfg.epf.erRateHigh);
  const ep = (s.epfOn !== false) ? hrEpfParts(epfWage, eeRate, erRate) : { ee: 0, er: 0 };
  const scat = (s.socsoCat !== '' && s.socsoCat != null) ? Number(s.socsoCat) : (senior ? 2 : 1);
  // v159: the SAME statutory source as payroll — the pre-v155 midpoint × rate formula quoted figures the
  // payslip then contradicted (RM3,500 basic: SOCSO ER 60.40 here vs 60.35 on the payslip).
  const sp = (s.socsoOn !== false) ? myStatLookup(scat === 2 ? MY_SOCSO_CAT2 : MY_SOCSO_CAT1, socsoWage) : { ee: 0, er: 0 };
  const ip = (s.eisOn !== false && !senior) ? myStatLookup(MY_EIS, eisWage) : { ee: 0, er: 0 };
  // v184: LINDUNG 24 Jam (SKBBK) — employee-only, on the SOCSO wage.
  const linOn = (s.lindungOn !== false) && (s.socsoOn !== false) && myLindungActive(null);
  const lindung: number = linOn ? myLindung24(socsoWage) : 0;
  let pcb: number;
  // v159: PCB uses the LHDN rounding the payroll engine uses — truncate to 2dp, round UP to 5 sen — and
  // the "monthly MTD under RM10 is nil" rule.
  if (s.resident === false) { pcb = myPcbRoundUp5(taxWage * 0.30); }
  else {
    const rPers = cfg.reliefPersonal != null ? cfg.reliefPersonal : 9000;
    const rSp = cfg.reliefSpouse != null ? cfg.reliefSpouse : 4000;
    const rCh = cfg.reliefChild != null ? cfg.reliefChild : 2000;
    const rEpf = cfg.reliefEpfMax != null ? cfg.reliefEpfMax : 4000;
    const cat2 = !!s.married && s.spouseWorking === false, kids = num(s.children);
    // v183: bonus is ADDITIONAL remuneration — annualise the NORMAL wage, then add
    // tax(normal+bonus) − tax(normal) once, the way the engine does.
    const bonusTax = (fl.bonus && fl.bonus.pcb) ? bonus : 0;
    const normalWage = Math.max(0, taxWage - bonusTax);
    // v185: same PCB method switch as the payroll engine.
    const pcbMy = String(cfg.pcbMethod || 'payroll_my') === 'payroll_my';
    const rSocsoEis = cfg.reliefSocsoEisMax != null ? cfg.reliefSocsoEisMax : 350;
    const reliefs = rPers + (cat2 ? rSp : 0) + kids * rCh + Math.min(ep.ee * 12, rEpf)
      + (pcbMy ? 0 : Math.min((sp.ee + ip.ee + lindung) * 12, rSocsoEis)) + Math.max(0, relief);
    const chargeable = Math.max(0, normalWage * 12 - reliefs);
    const tax = hrProgTax(chargeable), rebate = chargeable <= 35000 ? (400 + (cat2 ? 400 : 0)) : 0;
    const bAnnual = () => {
      const chargeableB = Math.max(0, normalWage * 12 + bonusTax - reliefs);
      const taxB = hrProgTax(chargeableB), rebateB = chargeableB <= 35000 ? (400 + (cat2 ? 400 : 0)) : 0;
      return taxB - rebateB;
    };
    if (pcbMy) {
      let norm = myPcbRoundUp5(Math.max(0, (tax - rebate) / 12)); if (norm < 10) norm = 0;
      const addlM = bonusTax > 0 ? Math.max(0, bAnnual() - norm * 12) : 0;
      pcb = hrRound2(norm + (addlM > 0 ? myPcbRoundUp5(addlM) : 0));
    } else {
      const addl = bonusTax > 0 ? Math.max(0, bAnnual() - (tax - rebate)) : 0;
      const pcbC = myPcbRoundUp5(Math.max(0, (tax - rebate) / 12) + addl);
      pcb = pcbC < 10 ? 0 : pcbC;   // LHDN: monthly MTD of less than RM10 is nil
    }
  }
  // v183: zakat reduces MTD ringgit-for-ringgit. It still leaves net pay as a deduction below.
  if (zakat > 0) pcb = Math.max(0, hrRound2(pcb - zakat));
  const res: CalcResult = {
    epfEe: ep.ee, epfEr: ep.er, socsoEe: sp.ee, socsoEr: sp.er, eisEe: ip.ee, eisEr: ip.er, lindung, pcb,
    gross: hrRound2(grossPay), epfWage: hrRound2(epfWage), socsoWage: hrRound2(socsoWage),
    eisWage: hrRound2(eisWage), taxWage: hrRound2(taxWage), _eeRate: eeRate, _erRate: erRate, _scat: scat,
    overridden: false, net: 0, employerCost: 0, deduction: ded, claim, zakat, relief,
  };
  const ov = C.ov;
  if (ov.on) {
    (['epfEe', 'epfEr', 'socsoEe', 'socsoEr', 'eisEe', 'eisEr', 'pcb'] as const).forEach((k) => {
      const v = ov[k];
      if (v !== '' && v != null && !isNaN(Number(v))) { res[k] = Number(v); res.overridden = true; }
    });
  }
  res.net = hrRound2(res.gross - res.epfEe - res.socsoEe - res.eisEe - res.lindung - res.pcb - ded - zakat + claim);
  res.employerCost = hrRound2(res.gross + res.epfEr + res.socsoEr + res.eisEr);
  return res;
}

/* ─────────────────────────────────────── the component ─────────────────────────────────────── */

/** `M()` — hros.html:1268. */
function M(n: number): string {
  return 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface HrCalculatorProps {
  state: CalcState;
  /** `HR.data.employees` — the prefill picker. */
  employees: CalcEmployee[];
  /** `hrCalcCompute()`'s result, or null when the statutory rates have not loaded. */
  result: CalcResult | null;
  /** `hrCompanyName()` — hros.html:4445. Chrome, so it is passed in rather than resolved here. */
  companyName: string;
  /** `#hrcalc_hist`'s content. `null`/absent is the golden: the audit log has not been asked for. */
  history?: CalcHistoryState;
  onPickEmp: (id: string) => void;
  onInput: (k: keyof CalcInputs, v: string) => void;
  onFlag: (item: FlagItem, flag: FlagKey, on: boolean) => void;
  onSetting: (k: keyof CalcSettings, v: string | boolean) => void;
  onOverride: (k: OverrideKey, v: string) => void;
  onOvToggle: () => void;
  onPayslip: () => void;
  onSave: () => void;
  onHistory: () => void;
}

const MONEY_INPUT: CSSProperties = {
  width: '100%', padding: '8px 10px', background: 'var(--panel-2)', border: '1px solid var(--border)',
  borderRadius: '8px', color: 'var(--text)', fontSize: '13px', textAlign: 'right',
};
const SETTING_SELECT: CSSProperties = {
  padding: '6px 8px', background: 'var(--panel-2)', border: '1px solid var(--border)',
  borderRadius: '7px', color: 'var(--text)', fontSize: '12px',
};
const CHECK: CSSProperties = { accentColor: 'var(--coral)' };
const CK_LABEL: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', margin: '0 14px 6px 0',
};

/**
 * `onfocus="this.select()"` — hros.html:4872.
 *
 * Optional-called: the handler-parity harness invokes every handler with a stub event carrying only
 * `value` (tests/handlers.ts), and a real focus event always has `select()`.
 */
const selectAll = (e: FocusEvent<HTMLInputElement>) => e.target.select?.();

/**
 * `this.value` inside the legacy `oninput="…"`. React types an InputEvent's `target` as a bare
 * EventTarget, so the element type is asserted once, here, rather than at each of the nine call sites.
 */
const inputValue = (e: { target: EventTarget }) => (e.target as HTMLInputElement).value;

export default function HrCalculator(p: HrCalculatorProps) {
  const C = p.state, res = p.result;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Payroll</div>
          <h2 className="page-title">Calculator</h2>
          <div className="page-sub">Quick Malaysia salary &amp; statutory calculator</div>
        </div>
        <div className="page-meta">
          <span className="page-chip"><span className="dot"></span>{p.companyName}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,.95fr)', gap: '16px', alignItems: 'start' }}>
        <div>
          <div className="panel">
            <div className="panel-hd"><h3>🧮 Payroll inputs</h3></div>
            <Field label="Prefill from employee (optional)">
              <select
                value={C.empId}
                onChange={(e) => p.onPickEmp(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '12.5px' }}
              >
                <option value="">— Ad-hoc / manual —</option>
                {p.employees.map((e) => <option key={e.id} value={e.id}>{e.emp_no + ' · ' + e.name}</option>)}
              </select>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <Money p={p} k="basic" label="Basic salary (RM) *" />
              <Money p={p} k="allowance" label="Allowance (RM)" />
              <Money p={p} k="bonus" label="Bonus / Commission (RM)" />
              <Money p={p} k="claim" label="Claim / reimbursement (RM)" hint="Excluded from statutory by default" />
              <Money p={p} k="deduction" label="Deduction (RM)" hint="Reduces net only" />
              <Money p={p} k="zakat" label="Muslim zakat (RM)" hint="Reduces PCB ringgit-for-ringgit" />
              <Money p={p} k="relief" label="Allowable deduction / TP1 (RM)" hint="Annual declared relief" />
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd"><h3>⚙️ Statutory flags per item</h3></div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: '10.5px' }} className="muted">ITEM</th>
                  <th className="muted" style={{ fontSize: '10.5px' }}>Taxable</th>
                  <th className="muted" style={{ fontSize: '10.5px' }}>EPF</th>
                  <th className="muted" style={{ fontSize: '10.5px' }}>SOCSO</th>
                  <th className="muted" style={{ fontSize: '10.5px' }}>EIS</th>
                  <th className="muted" style={{ fontSize: '10.5px' }}>PCB</th>
                </tr>
              </thead>
              <tbody>
                <FlagRow p={p} item="allowance" label="Allowance" />
                <FlagRow p={p} item="bonus" label="Bonus / Commission" />
                <FlagRow p={p} item="claim" label="Claim / reimbursement" />
              </tbody>
            </table>
            <div className="muted" style={{ fontSize: '10px', marginTop: '6px', lineHeight: 1.5 }}>Basic salary is always fully statutory. Deduction reduces net only. Toggle a box to include/exclude that item from a statutory base — e.g. a travel claim can be excluded from EPF/SOCSO/EIS/PCB.</div>
          </div>

          <div className="panel">
            <div className="panel-hd"><h3>🧾 Statutory settings</h3></div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px', marginBottom: '8px' }}>
              <span className="muted">EPF EE</span>
              <Setting p={p} k="epfEeRate" opts={[['', 'Default'], ['0.11', '11%'], ['0.09', '9%'], ['0.08', '8%'], ['0.07', '7%'], ['0.055', '5.5%'], ['0', '0%']]} />
              <span className="muted">EPF ER</span>
              <Setting p={p} k="epfErRate" opts={[['', 'Default'], ['0.13', '13%'], ['0.12', '12%'], ['0.14', '14%'], ['0.15', '15%'], ['0.16', '16%'], ['0.17', '17%'], ['0.18', '18%'], ['0.19', '19%'], ['0.20', '20%'], ['0.04', '4%'], ['0', '0%']]} />
              <span className="muted">SOCSO cat</span>
              <Setting p={p} k="socsoCat" opts={[['', 'Auto'], ['1', 'Cat 1'], ['2', 'Cat 2']]} />
              <span className="muted">Children</span>
              <input
                type="number" min="0" value={C.settings.children || 0}
                onInput={(e) => p.onSetting('children', inputValue(e))}
                style={{ width: '54px', padding: '6px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '7px', color: 'var(--text)', fontSize: '12px' }}
              />
            </div>
            <div>
              <Ck p={p} k="resident" lbl="Tax resident" />
              <Ck p={p} k="married" lbl="Married" />
              <Ck p={p} k="spouseWorking" lbl="Spouse working" />
              <Ck p={p} k="senior" lbl="Age 60+" />
              <Ck p={p} k="epfOn" lbl="EPF" />
              <Ck p={p} k="socsoOn" lbl="SOCSO" />
              <Ck p={p} k="eisOn" lbl="EIS" />
              <Ck p={p} k="lindungOn" lbl="LINDUNG 24" />
            </div>
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="panel-hd">
              <h3>💵 Result</h3>
              <span style={{ display: 'flex', gap: '6px' }}>
                <button className="btn xs" onClick={p.onOvToggle}>✏️ Override</button>
                <button className="btn xs" onClick={p.onPayslip}>📄 Payslip</button>
                <button className="btn xs p" onClick={p.onSave}>💾 Save</button>
              </span>
            </div>
            <div id="hrcalc_out"><CalcOut res={res} /></div>
          </div>
          {C.ov.on ? <OverridePanel p={p} /> : null}
          <div style={{ marginTop: '12px' }}>
            <button className="btn sm" onClick={p.onHistory}>🕓 Calculation audit log</button>
            <div id="hrcalc_hist" style={{ marginTop: '10px' }}><CalcHistory h={p.history ?? null} /></div>
          </div>
        </div>
      </div>
    </>
  );
}

/** `g()` — hros.html:4873. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <label className="muted" style={{ fontSize: '11px' }}>{label}</label>
      {children}
      {hint ? <div className="muted" style={{ fontSize: '10px', marginTop: '2px' }}>{hint}</div> : null}
    </div>
  );
}

/** `money()` — hros.html:4872, wrapped in its `g()`. */
function Money({ p, k, label, hint }: { p: HrCalculatorProps; k: keyof CalcInputs; label: string; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number" step="0.01" value={p.state.inp[k] === '' ? '' : p.state.inp[k]}
        onInput={(e) => p.onInput(k, inputValue(e))}
        onFocus={selectAll}
        placeholder="0.00" style={MONEY_INPUT}
      />
    </Field>
  );
}

/** `fRow()` — hros.html:4875. */
function FlagRow({ p, item, label }: { p: HrCalculatorProps; item: FlagItem; label: string }) {
  const f = p.state.flags[item];
  const cell = (k: FlagKey) => (
    <td key={k} style={{ textAlign: 'center', padding: '3px' }}>
      <input type="checkbox" checked={f[k]} onChange={(e) => p.onFlag(item, k, e.target.checked)} style={CHECK} />
    </td>
  );
  return (
    <tr>
      <td style={{ padding: '5px 8px', fontSize: '12px' }}>{label}</td>
      {cell('taxable')}{cell('epf')}{cell('socso')}{cell('eis')}{cell('pcb')}
    </tr>
  );
}

/** `sel()` — hros.html:4878. */
function Setting({ p, k, opts }: { p: HrCalculatorProps; k: keyof CalcSettings; opts: [string, string][] }) {
  return (
    <select value={String(p.state.settings[k])} onChange={(e) => p.onSetting(k, e.target.value)} style={SETTING_SELECT}>
      {opts.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
    </select>
  );
}

/** `ck()` — hros.html:4877. */
function Ck({ p, k, lbl }: { p: HrCalculatorProps; k: keyof CalcSettings; lbl: string }) {
  return (
    <label style={CK_LABEL}>
      <input type="checkbox" checked={!!p.state.settings[k]} onChange={(e) => p.onSetting(k, e.target.checked)} style={CHECK} />
      {lbl}
    </label>
  );
}

/**
 * `ovPanel` / `ovIn()` — hros.html:4881-4882. NOT in the golden: it is captured with `ov.on === false`,
 * so the parity test never renders this. Mirrored from the legacy source anyway, because leaving it out
 * would wire "✏️ Override" to a button that opens nothing.
 */
function OverridePanel({ p }: { p: HrCalculatorProps }) {
  const ov = p.state.ov;
  const ovIn = (k: OverrideKey, lbl: string) => (
    <div key={k}>
      <label className="muted" style={{ fontSize: '10px' }}>{lbl}</label>
      <input
        type="number" step="0.01" value={ov[k] === '' ? '' : ov[k]}
        onInput={(e) => p.onOverride(k, inputValue(e))}
        placeholder="auto"
        style={{ width: '100%', padding: '6px 8px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '12px', textAlign: 'right' }}
      />
    </div>
  );
  return (
    <div className="panel" style={{ marginTop: '12px', borderColor: 'var(--amber)' }}>
      <div className="panel-hd">
        <h3>✏️ Manual override</h3>
        <button className="btn sm" onClick={p.onOvToggle}>✕ Close</button>
      </div>
      <div className="muted" style={{ fontSize: '11px', padding: '0 2px 8px' }}>Blank = keep the computed value. A <b>reason is required</b> to save an overridden calculation (stored in the audit log).</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px' }}>
        {ovIn('epfEe', 'EPF EE')}{ovIn('epfEr', 'EPF ER')}{ovIn('socsoEe', 'SOCSO EE')}{ovIn('socsoEr', 'SOCSO ER')}
        {ovIn('eisEe', 'EIS EE')}{ovIn('eisEr', 'EIS ER')}{ovIn('pcb', 'PCB')}
      </div>
      <div style={{ marginTop: '10px' }}>
        <label className="muted" style={{ fontSize: '11px' }}>Reason for override *</label>
        <input
          value={ov.reason || ''} onInput={(e) => p.onOverride('reason', inputValue(e))}
          placeholder="e.g. LHDN CP38 directive, arrears adjustment…"
          style={{ width: '100%', padding: '8px 10px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '12.5px' }}
        />
      </div>
    </div>
  );
}

/**
 * `hrCalcHistory()`'s innerHTML — hros.html:4910. NOT in the golden: the legacy screen paints this only
 * after "🕓 Calculation audit log" is clicked, so `#hrcalc_hist` is captured empty and the parity test
 * never reaches any branch below. Mirrored from the legacy source anyway — leaving it out would wire
 * that button to nothing.
 */
function CalcHistory({ h }: { h: CalcHistoryState }) {
  if (!h) return null;
  if ('loading' in h) return <div className="muted" style={{ fontSize: '12px' }}><span className="spin"></span> Loading…</div>;
  if ('error' in h) return <div className="muted" style={{ fontSize: '12px' }}>{h.error}</div>;
  if (!h.rows.length) return <div className="muted" style={{ fontSize: '12px' }}>No saved calculations yet.</div>;
  return (
    <div className="panel" style={{ margin: 0, padding: 0 }}>
      <div className="tbl-wrap" style={{ maxHeight: '300px', overflow: 'auto' }}>
        <table className="bigtable" style={{ fontSize: '11.5px' }}>
          <thead><tr><th>When</th><th>Employee</th><th className="amt">Net</th><th>By</th><th>Override</th></tr></thead>
          <tbody>
            {h.rows.map((x, i) => (
              <tr key={i}>
                <td className="muted">{String(x.created_at || '').replace('T', ' ').slice(0, 16)}</td>
                <td>{x.employee_name || '—'}</td>
                <td className="amt">{M((x.result && x.result.net) || 0)}</td>
                <td className="muted" style={{ fontSize: '10.5px' }}>{x.created_by || ''}</td>
                <td>{x.overridden
                  ? <span title={x.reason || ''} style={{ color: 'var(--amber)' }}>⚠ {String(x.reason || '').slice(0, 28)}</span>
                  : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * `ln()` — hros.html:4837.
 *
 * `o.col` is NOT rendered. The legacy helper puts it in a SECOND `style=` attribute on the same span,
 * which an HTML parser discards as a duplicate, so no operator has ever seen the coral/green amounts.
 * Emitting it here would be a change to the screen, not a migration of it — see this file's header.
 */
function Line({ label, val, b, neg, mut }: { label: string; val: number; b?: boolean; neg?: boolean; mut?: boolean }) {
  const row: CSSProperties = b
    ? { display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontWeight: 700, borderTop: '1px solid var(--border)', marginTop: '4px', paddingTop: '8px' }
    // The stray trailing `;` is the legacy string's, reproduced so the style value stays byte-exact.
    : { display: 'flex', justifyContent: 'space-between', padding: '5px 0;' };
  return (
    <div style={row}>
      <span style={{ fontSize: b ? '13.5px' : '12.5px' }} {...(mut ? { className: 'muted' } : {})}>{label}</span>
      <span style={{ fontSize: b ? '15px' : '13px' }}>{(neg ? '-' : '') + M(val)}</span>
    </div>
  );
}

/** `hrCalcOutHtml()` — hros.html:4836. What the legacy screen repaints into `#hrcalc_out`. */
function CalcOut({ res }: { res: CalcResult | null }) {
  // Not in the golden: the golden's fixture has `HR.data.rates`, so `res` is never null there.
  if (!res) return <div className="muted" style={{ padding: '16px', fontSize: '12.5px' }}>Enter a Basic Salary to calculate. (If nothing shows, open 💰 Payroll once so the statutory rates load.)</div>;
  return (
    <>
      <div style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--coral)', fontWeight: 700, marginBottom: '2px' }}>Employee deductions</div>
      <Line label={'EPF (KWSP) ' + (Math.round(res._eeRate * 1000) / 10) + '%'} val={res.epfEe} neg />
      <Line label={'SOCSO (PERKESO) · Cat ' + res._scat} val={res.socsoEe} neg />
      <Line label="EIS (SIP)" val={res.eisEe} neg />
      {res.lindung ? <Line label="LINDUNG 24 Jam (SKBBK)" val={res.lindung} neg /> : null}
      <Line label="PCB / MTD (estimate)" val={res.pcb} neg />
      {res.deduction ? <Line label="Other deduction" val={res.deduction} neg /> : null}
      {res.zakat ? <Line label="Zakat (displaces PCB)" val={res.zakat} neg /> : null}
      {res.claim ? <Line label="Claim / reimbursement" val={res.claim} /> : null}
      <Line label="Gross salary" val={res.gross} b />
      <Line label="NET PAY" val={res.net} b />
      <div style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--sky-soft)', fontWeight: 700, margin: '14px 0 2px' }}>Employer contributions</div>
      <Line label={'EPF (KWSP) ' + (Math.round(res._erRate * 1000) / 10) + '%'} val={res.epfEr} />
      <Line label="SOCSO (PERKESO)" val={res.socsoEr} />
      <Line label="EIS (SIP)" val={res.eisEr} />
      <Line label="Employer total cost" val={res.employerCost} b />
      {res.overridden ? <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--amber)' }}>⚠ Some values were manually overridden.</div> : null}
      <div className="muted" style={{ fontSize: '10px', marginTop: '10px', lineHeight: 1.5 }}>Statutory bases → EPF {M(res.epfWage)} · SOCSO {M(res.socsoWage)} · EIS {M(res.eisWage)} · Taxable(PCB) {M(res.taxWage)}. PCB is an LHDN MTD estimate — verify before filing.</div>
    </>
  );
}
