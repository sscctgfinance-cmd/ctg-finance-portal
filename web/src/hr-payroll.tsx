// HR OS · Payroll — the React half of the strangler's ninth screen.
//
// The legacy original is `hrPayroll()` at hros.html:4057, with `hrGridInit()` at :3709,
// `hrGridRowCompute()` at :3727, `hrGridAll()` at :3749, `hrGCell()`/`hrGPcbCell()` at :3768/:3781,
// `hrDedCell()`/`hrDedPanel()` at :3791/:3794, `hrPaySumHtml()` at :3819, `hrPayHub()` at :3993,
// `hrGRowMenuBtn()`/`hrGRowMenuPanel()` at :4243/:4267 and `hrGridStateHtml()` at :4300. All of it is
// STILL THERE and still shipping; nothing was deleted. Both screens are reachable side by side
// (`hros.html#tab=payroll` and `/hr/payroll/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. That is what lets
// tests/hr-payroll.parity.test.tsx render it with `renderToStaticMarkup` and diff the result against
// tests/golden/hr.payroll.html. The loading, the session, the period, the checklist ticks (which are
// localStorage) and every export live in app/hr/payroll/page.tsx, on the other side of that line.
//
// ── The statutory engine is IMPORTED, never re-expressed ────────────────────────────────────────────
// `gridRowCompute()` below is `hrGridRowCompute()` moved across verbatim, and the money comes out of
// `hrCompute` in payroll.js — the same function `hros.html` calls as a classic script, pinned by
// tests/statutory_test.ts and tests/engine_parity_test.ts. Not one rate, table row or rounding step is
// re-typed here. A wrong statutory figure over-deducts from every employee at once and silently, and
// the backend recompute would then 409 the whole company's finalise with `recompute_mismatch`.
//
// The employee-field WHITELIST inside `gridRowCompute()` carries the same warning the legacy one does:
// it must hold every field `hrCompute` reads, or the two engines disagree. It is copied field for field
// from hros.html:3732 — do not prune it.
//
// ── Two derivations that are lifted OUT of the component, for the reason CLAUDE.md gives ────────────
// `dueInfo()` and `gridState()` read a clock in the legacy code (`new Date()` for "28 days left", and
// `toLocaleDateString` for the saved-at stamp). A component that read the clock itself would render
// something different tomorrow and start failing on its own. Both are exported as pure functions of a
// Date they are HANDED: the route hands them the real one, the test hands them the harness's fixed
// instant. That keeps the derivation under test — a shifted due date diffs — instead of hiding it.
//
// ── NOT covered by the golden ───────────────────────────────────────────────────────────────────────
// The golden is one state: data loaded, nothing typed, no run, every panel closed. So the loading /
// error / no-rates / no-employees panels, the FINALISED (locked) grid, the skipped-employee rows, the
// deduction panel and the row menu are all mirrored from the legacy source but NOT reached by the
// parity test. They are here rather than dropped because leaving them out would wire "⋯", "Deduct" and
// the finalise flow to nothing — see CLAUDE.md, "a branch the golden does not hold is not covered".
//
// Four heavyweight panels the legacy screen also owns — ⚙️ Rates, 🏢 Company, 🆔 Statutory numbers and
// 🧾 TP1 reliefs — are NOT migrated. Their buttons are in the golden, so they are wired, but to the
// route's `onLegacyPanel` notice pointing at hros.html, the same way hr-calculator's payslip button is
// (app/hr/calculator/page.tsx). Each is a full editor over records this screen does not otherwise
// touch; migrating one is its own screen, not a footnote on this one.

import type { CSSProperties, FocusEvent, ReactNode } from 'react';

import { hrCompute } from '../../payroll.js';

/* ───────────────────────────── the state this screen is a view of ───────────────────────────── */

/** `HR_MONTHS` — hros.html:1445. */
export const HR_MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `HR_DED_TYPES` — hros.html:3789. */
export const HR_DED_TYPES = ['Salary advance', 'Loan repayment', 'PTPTN', 'Zakat', 'CP38 (LHDN)', 'Insurance', 'Uniform / equipment', 'Staff welfare', 'Union / society', 'Other deduction'];

/** One itemised deduction — hros.html:3716. */
export interface Deduction { label: string; amount: number }

/** One employee row of `hr_payroll_data.employees`, as this screen reads it. */
export interface PayEmployee {
  id: string;
  emp_no?: string | null;
  name?: string | null;
  basic_salary?: number | null;
  fixed_allowance?: number | null;
  pay_type?: string | null;
  hourly_rate?: number | null;
  daily_rate?: number | null;
  status?: string | null;
  resign_date?: string | null;
  resident?: boolean;
  [k: string]: unknown;
}

/** One row of `hr_payroll_data.adjustments`. */
export interface PayAdjustment { employee_id?: string; kind?: string; label?: string | null; amount?: number | null }

/** The finalise/save state the backend keeps for the month — `hr_payroll_data.run`. */
export interface PayRun {
  id?: string;
  status?: string | null;
  entries_saved_at?: string | null;
  finalised_at?: string | null;
}

/** `HR.pay.data` — the `hr_payroll_data` payload, as this screen reads it. */
export interface PayData {
  employees?: PayEmployee[];
  adjustments?: PayAdjustment[];
  attendance?: Record<string, { hours?: number; days?: number }>;
  ytd?: Record<string, unknown>;
  rates?: unknown;
  run?: PayRun | null;
}

/** One entry of `HR.pay.grid` — hros.html:3721. */
export interface GridRow {
  basic: number;
  allow: number;
  bonus: number;
  ot: number;
  allowance: number;
  deductions: Deduction[];
  unpaid: number;
  pcbSet: number | null;
  skip: boolean;
  _att: { hours?: number; days?: number };
  _autoBasic: number | null;
  _payType: string;
}

/** What `hrCompute` returns, for the fields this screen renders. */
export interface PayQuote {
  gross: number; epfEe: number; epfEr: number; socsoEe: number; socsoEr: number;
  eisEe: number; eisEr: number; lindung: number; pcb: number; net: number; employerCost: number;
  _meta?: { epfEeRate?: number; socsoCat?: number; senior?: boolean };
}

/** One rendered grid row — `hrGridAll()`'s `{e,p,d}` (hros.html:3757). */
export interface PayRow { e: PayEmployee; p: PayQuote; d: Record<string, unknown> }

export interface PayTotals {
  gross: number; epfEe: number; epfEr: number; socsoEe: number; socsoEr: number;
  eisEe: number; eisEr: number; lindung: number; pcb: number; net: number; cost: number;
}

/** The five checklist keys — hros.html:3995. */
export type HubKey = 'salary' | 'epf' | 'perkeso' | 'pcb' | 'xero';
export const HUB_KEYS: HubKey[] = ['salary', 'epf', 'perkeso', 'pcb', 'xero'];

/** `hrUobCfg()` — hros.html:3829. */
export interface UobCfg { acct?: string; cd?: string }

/* ─────────────────────────────────── the pure derivations ─────────────────────────────────── */

/**
 * `hrGridInit()` — hros.html:3709, moved across unchanged.
 *
 * Not part of the render: the route calls it once per period and keeps the result in state, so the
 * component stays a pure function of props. Exported so the parity test can build the grid the same
 * way the app does instead of hand-writing one.
 */
export function gridInit(data: PayData): Record<string, GridRow> {
  const emps = data.employees || [], adjs = data.adjustments || [];
  const grid: Record<string, GridRow> = {};
  emps.forEach((e) => {
    const mine = adjs.filter((a) => a.employee_id === e.id);
    const sumK = (k: string) => mine.filter((a) => a.kind === k).reduce((s, a) => s + Number(a.amount || 0), 0);
    const setK = (k: string) => { const f = mine.filter((a) => a.kind === k); return f.length ? Number(f[f.length - 1].amount) : null; };
    const bset = setK('basic_set'), aset = setK('allow_set');
    const deds = mine.filter((a) => a.kind === 'deduction').map((a) => ({ label: a.label || 'Other deduction', amount: Number(a.amount) || 0 }));
    // Part-timers (hourly/daily): auto-fill Basic from this month's clocked hours × rate unless the
    // admin set a manual basic override. Monthly staff keep their fixed basic_salary.
    const att = (data.attendance || {})[e.id] || {};
    let autoBasic: number | null = null;
    if (e.pay_type === 'hourly') autoBasic = Math.round((Number(att.hours) || 0) * (Number(e.hourly_rate) || 0) * 100) / 100;
    else if (e.pay_type === 'daily') autoBasic = Math.round((Number(att.days) || 0) * (Number(e.daily_rate) || 0) * 100) / 100;
    const baseVal = bset != null ? bset : (autoBasic != null ? autoBasic : Number(e.basic_salary || 0));
    grid[e.id] = {
      basic: baseVal, allow: aset != null ? aset : Number(e.fixed_allowance || 0),
      bonus: sumK('bonus'), ot: sumK('ot'), allowance: sumK('allowance'), deductions: deds,
      unpaid: sumK('unpaid_leave'), pcbSet: setK('pcb_set'),
      skip: mine.some((a) => a.kind === 'skip'),
      _att: att, _autoBasic: autoBasic, _payType: String(e.pay_type || 'monthly'),
    };
  });
  return grid;
}

/** `hrDedTot()` — hros.html:3790. */
export function dedTot(g: Partial<GridRow> | undefined): number {
  return ((g && g.deductions) || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

/**
 * `hrGridRowCompute()` — hros.html:3727, moved across unchanged, INCLUDING the field whitelist and the
 * warning attached to it. The maths itself is `hrCompute` from payroll.js.
 */
export function gridRowCompute(
  e: PayEmployee, g: Partial<GridRow>, rates: unknown,
  period: { month: number; year: number }, ytd?: unknown,
): PayQuote {
  // ⚠️ This whitelist must carry EVERY employee field hrCompute reads. The backend recompute uses the
  // REAL employee row, so anything dropped here makes the two engines disagree and 409s the entire
  // company's payroll. citizen_status was missing once (v182) and was latent only because every member
  // of staff happened to be a citizen. tests/engine_parity_test.ts derives the required list from
  // hrCompute's own source, so the next field added to the engine fails the build instead of payroll.
  const synth = {
    basic_salary: Number(g.basic) || 0, fixed_allowance: Number(g.allow) || 0,
    epf_eligible: e.epf_eligible, socso_eligible: e.socso_eligible, eis_eligible: e.eis_eligible,
    resident: e.resident, date_of_birth: e.date_of_birth, epf_ee_rate: e.epf_ee_rate,
    epf_er_rate: e.epf_er_rate, socso_category: e.socso_category, marital_status: e.marital_status,
    spouse_working: e.spouse_working, num_children: e.num_children, citizen_status: e.citizen_status,
    lindung24: e.lindung24,
    join_date: e.join_date, resign_date: e.resign_date,   // v155: needed for MTD service-month annualisation
  };
  const adj: Record<string, unknown>[] = [];
  if (Number(g.bonus)) adj.push({ kind: 'bonus', amount: Number(g.bonus), epf_subject: true });
  if (Number(g.ot)) adj.push({ kind: 'ot', amount: Number(g.ot), epf_subject: true });
  if (Number(g.allowance)) adj.push({ kind: 'allowance', amount: Number(g.allowance), epf_subject: true });
  const dt = dedTot(g); if (dt) adj.push({ kind: 'deduction', amount: dt, epf_subject: false });
  if (Number(g.unpaid)) adj.push({ kind: 'unpaid_leave', amount: Number(g.unpaid), epf_subject: false });
  // v195: blank = let the engine compute. 0 is a REAL override (some staff genuinely have nil MTD), so
  // this must test for null/'' — not falsiness.
  if (g.pcbSet != null && (g.pcbSet as unknown) !== '') adj.push({ kind: 'pcb_set', amount: Number(g.pcbSet) || 0, epf_subject: false });
  return hrCompute(synth, rates, adj, period, (ytd as Record<string, unknown> | undefined)) as PayQuote;
}

/**
 * `hrGridAll()` — hros.html:3749, moved across unchanged.
 *
 * v205: `skip` takes somebody out of THIS month's run without touching their record. Skipped rows are
 * dropped here and drawn separately by the component, so an exclusion is visible rather than silent.
 */
export function gridAll(
  data: PayData, grid: Record<string, GridRow>, period: { month: number; year: number },
): { rows: PayRow[]; tot: PayTotals } {
  const emps = (data.employees || []).filter((e) => !((grid[e.id] || ({} as GridRow)).skip));
  const rows: PayRow[] = [];
  const tot: PayTotals = { gross: 0, epfEe: 0, epfEr: 0, socsoEe: 0, socsoEr: 0, eisEe: 0, eisEr: 0, lindung: 0, pcb: 0, net: 0, cost: 0 };
  emps.forEach((e) => {
    const g = grid[e.id] || ({} as GridRow);
    const q = gridRowCompute(e, g, data.rates, period, (data.ytd || {})[e.id]);
    const eff = Object.assign({}, e, { basic_salary: Number(g.basic) || 0, fixed_allowance: Number(g.allow) || 0 });
    const d = {
      basic: Number(g.basic) || 0, allow: Number(g.allow) || 0, bonus: Number(g.bonus) || 0,
      ot: Number(g.ot) || 0, allowance: Number(g.allowance) || 0,
      deductions: (g.deductions || []).slice(), deduction: dedTot(g), unpaid: Number(g.unpaid) || 0,
    };
    rows.push({ e: eff, p: q, d });
    tot.gross += q.gross; tot.epfEe += q.epfEe; tot.epfEr += q.epfEr;
    tot.socsoEe += q.socsoEe; tot.socsoEr += q.socsoEr; tot.eisEe += q.eisEe; tot.eisEr += q.eisEr;
    tot.lindung += (q.lindung || 0); tot.pcb += q.pcb; tot.net += q.net; tot.cost += q.employerCost;
  });
  return { rows, tot };
}

/**
 * `hrDueInfo()` — hros.html:3831, with the clock read turned into an argument.
 *
 * The legacy body calls `new Date()` for "28 days left". Handed the date instead, so the same instant
 * the golden was captured under can be handed to the test and the real one to the route.
 */
export function dueInfo(month: number, year: number, now: Date): { txt: string; col: string } {
  const due = new Date(year, month, 15);
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((due.getTime() - t.getTime()) / 86400000);
  const nm = month === 12 ? 1 : month + 1, ny = month === 12 ? year + 1 : year;
  const col = days < 0 ? 'var(--coral-soft)' : (days <= 7 ? 'var(--amber)' : 'var(--muted)');
  return {
    txt: 'due 15 ' + HR_MONTHS[nm] + ' ' + ny + (days < 0 ? (' · OVERDUE ' + (-days) + 'd') : (' · ' + days + ' day' + (days === 1 ? '' : 's') + ' left')),
    col,
  };
}

export interface GridStateChip { text: string; cls: string; tip: string }

/**
 * `hrGridStateHtml()` — hros.html:4300, returning the three values rather than a string.
 *
 * Its `fmt()` is `toLocaleDateString`/`toLocaleTimeString`, which is why this is not inside the
 * component: the goldens were captured under tests/render_harness.ts's UTC override, and vitest runs in
 * the machine's zone. The golden's state (`run === null`, nothing typed) reaches none of the formatted
 * branches, but a later screen state would, so the formatting stays somewhere a test can pin it.
 */
export function gridState(run: PayRun | null | undefined, dirty: boolean): GridStateChip {
  const fin = !!run && run.status === 'finalised';
  const fmt = (t: string | null | undefined) => {
    if (!t) return '';
    const d = new Date(t);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };
  if (dirty) return { text: '● Unsaved changes', cls: 'pill-amber', tip: 'These figures are only in this browser. Save entries to keep them.' };
  if (fin && run) {
    // Entries edited after the payslips were written: the payslips no longer match the entries.
    const stale = !!run.entries_saved_at && !!run.finalised_at && (new Date(run.entries_saved_at) > new Date(run.finalised_at));
    if (stale) {
      return {
        text: '⚠ Edited after finalising', cls: 'pill-amber',
        tip: 'Entries were saved at ' + fmt(run.entries_saved_at) + ', after this month was finalised at ' +
          fmt(run.finalised_at) + '. The payslips still show the OLD figures — re-finalise to update them.',
      };
    }
    return { text: '✓ Finalised' + (run.finalised_at ? (' · ' + fmt(run.finalised_at)) : ''), cls: 'pill-green', tip: 'Payslips are written for this month.' };
  }
  if (run && run.entries_saved_at) return { text: 'Draft saved · ' + fmt(run.entries_saved_at), cls: 'pill-blue', tip: 'Entries are saved. Nothing is final until you finalise.' };
  return { text: 'Draft — not saved yet', cls: '', tip: 'Nothing has been saved for this month yet.' };
}

/* ───────────────────────────────────────── the component ───────────────────────────────────────── */

/** `M()` — hros.html:1268. */
function M(n: number): string {
  return 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Which of the four un-migrated legacy panels a button asked for. */
export type LegacyPanel = 'rates' | 'employer' | 'statids' | 'tp1';

/** The grid cells `hrGCell()` draws — hros.html:4081. */
export type CellField = 'basic' | 'allow' | 'bonus' | 'ot' | 'allowance' | 'unpaid';

/** The raw-csv exports — hros.html:4053. */
export type StatFile = 'epf' | 'socso' | 'eis' | 'pcb';

export interface HrPayrollProps {
  /** `hrCompanyName()` — hros.html:4445. Chrome, so it is passed in rather than resolved here. */
  companyName: string;
  month: number;
  year: number;
  /** `HR.pay.grid` — the typed figures. */
  grid: Record<string, GridRow>;
  /** `hrGridAll()`'s output. */
  rows: PayRow[];
  tot: PayTotals;
  /** Employees `hrGridAll()` dropped because they are skipped this month — hros.html:4086. */
  skipped: PayEmployee[];
  /** `hrGridLocked()` — hros.html:3766. A finalised month with the editor closed. */
  locked: boolean;
  /** `!!p.data.run && p.data.run.status === 'finalised'` — hros.html:4076. */
  finalised: boolean;
  /** `p.data.run.id` — what `hrPostXero()` posts against, once the month is finalised. */
  runId?: string | null;
  /** `hrGridStateHtml()`'s chip — hros.html:4300. */
  state: GridStateChip;
  /** `hrHubGet()` — hros.html:3827. localStorage, so it is read by the route. */
  ticks: Partial<Record<HubKey, boolean>>;
  /** `hrUobCfg()` — hros.html:3829. localStorage, so it is read by the route. */
  uob: UobCfg;
  /** `hrDueInfo()`'s output — hros.html:3831. */
  due: { txt: string; col: string };
  /** `HR_VIEWER` — hros.html:1374. A viewer sees the figures and none of the write controls. */
  viewer?: boolean;
  /** `HR.pay.dedEmp` — whose deduction panel is open, if any. */
  dedEmp?: string | null;
  /** `HR.pay.rowMenu` — whose ⋯ menu is open, if any. */
  rowMenu?: string | null;
  /** `todayLocalISO()` — the default in the row menu's resign-date field. */
  today?: string;

  onPickPeriod: () => void;
  onLegacyPanel: (p: LegacyPanel) => void;
  onGridSave: () => void;
  onFinalise: () => void;
  onEditFinalised: () => void;
  onRowMenu: (empId: string) => void;
  onCell: (empId: string, field: CellField, v: string) => void;
  onPcbCell: (empId: string, v: string) => void;
  onPcbAuto: (empId: string) => void;
  onDedOpen: (empId: string) => void;
  onDedAdd: (empId: string, label?: string) => void;
  onDedDel: (empId: string, i: number) => void;
  onDedLabel: (empId: string, i: number, v: string) => void;
  onDedAmt: (empId: string, i: number, v: string) => void;
  onSkip: (empId: string, on: boolean) => void;
  onResign: (empId: string) => void;
  onEmpDelete: (empId: string) => void;
  onSubmitAll: () => void;
  onUobSave: () => void;
  onExpBank: (bank: string) => void;
  onExpGiro: () => void;
  onExpKwsp: () => void;
  onExpAssist: () => void;
  onExpCp39: () => void;
  onPostXero: (runId: string) => void;
  onExpSummary: () => void;
  onExpPayslips: () => void;
  onEmailAll: () => void;
  onExpStatutory: (f: StatFile) => void;
  onHubTick: (k: HubKey, on: boolean) => void;
}

/* The inline styles, verbatim from the legacy strings. Property ORDER is preserved — React serialises a
 * style object in insertion order, and the golden holds the legacy order. */

const PERIOD_SELECT: CSSProperties = {
  padding: '7px', background: 'var(--panel-2)', border: '1px solid var(--border)',
  borderRadius: '6px', color: 'var(--text)',
};
const CELL: CSSProperties = {
  width: '74px', padding: '4px 6px', background: 'var(--panel-2)', border: '1px solid var(--border)',
  borderRadius: '5px', color: 'var(--text)', fontSize: '11.5px', textAlign: 'right',
};
const CELL_LOCKED: CSSProperties = { ...CELL, opacity: '.6', cursor: 'not-allowed' };
const ROW_MENU_BTN = (on: boolean): CSSProperties => ({
  background: 'none', border: 'none', color: on ? 'var(--coral)' : 'var(--muted)',
  cursor: 'pointer', fontSize: '14px', lineHeight: '1', padding: '0 2px',
});
const GRP_TH: CSSProperties = {
  textAlign: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '3px',
};
const HUB_SEC: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'minmax(200px,1.1fr) minmax(240px,1.7fr) auto', gap: '10px',
  alignItems: 'start', padding: '12px 2px', borderBottom: '1px solid var(--border)',
};
const HUB_BTNS: CSSProperties = { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' };
const HUB_PATH: CSSProperties = { fontSize: '10.5px', marginTop: '5px', lineHeight: '1.55' };
const HUB_CHECK_LABEL: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: 'var(--muted)',
  cursor: 'pointer', whiteSpace: 'nowrap',
};
const UOB_INPUT: CSSProperties = {
  padding: '6px 8px', background: 'var(--panel-2)', border: '1px solid var(--border)',
  borderRadius: '6px', color: 'var(--text)', fontSize: '12px',
};

/** `onfocus="this.select()"` — hros.html:3768. The browser selecting the field's own text. */
const selectAll = (e: FocusEvent<HTMLInputElement>) => e.target.select?.();

const val = (e: { target: EventTarget }) => (e.target as HTMLInputElement).value;

export default function HrPayroll(p: HrPayrollProps) {
  const rw = <T,>(node: T): T | null => (p.viewer ? null : node);   // `hrRW()` — hros.html:1374
  const period = HR_MONTHS[p.month] + ' ' + p.year;
  const years = [p.year - 1, p.year, p.year + 1];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Payroll</div>
          <h2 className="page-title">Payroll</h2>
          <div className="page-sub">Run monthly payroll, statutory files &amp; payslips</div>
        </div>
        <div className="page-meta">
          <span className="page-chip"><span className="dot"></span>{p.companyName}</span>
        </div>
      </div>

      {/* the period picker — hros.html:4059. The two selects carry no handler in the legacy screen
          either: `hrPickPeriod()` reads them by id when Load is clicked. */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
        <select id="hr_pm" defaultValue={String(p.month)} style={PERIOD_SELECT}>
          {HR_MONTHS.slice(1).map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
        </select>
        <select id="hr_py" defaultValue={String(p.year)} style={PERIOD_SELECT}>
          {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
        <button className="btn sm" onClick={() => p.onPickPeriod()}>Load</button>
      </div>

      {/* the grid — hros.html:4105 */}
      <div className="panel">
        <div className="panel-hd">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {'Payroll grid — ' + period}
            <span id="hr_paystate" className={'pill ' + p.state.cls} style={{ fontSize: '10px', fontWeight: '600' }} title={p.state.tip}>{p.state.text}</span>
          </h3>
          <span style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {rw(<button className="btn sm" onClick={() => p.onLegacyPanel('employer')} title="Company details + logo (printed on payslips, forms, year-end)">🏢 Company</button>)}
            <button className="btn sm" onClick={() => p.onLegacyPanel('rates')} title="View / edit statutory rates">⚙️ Rates</button>
            {/* v181: once finalised the grid is READ-ONLY until the operator deliberately unlocks it. */}
            {p.locked
              ? rw(<button className="btn sm" onClick={() => p.onEditFinalised()} title="Payslips are already written for this month. Unlock to change the entries; you must re-finalise afterwards for the payslips to match.">✏️ Edit entries</button>)
              : rw(<>
                  <button className="btn sm" onClick={() => p.onGridSave()}>💾 Save entries</button>
                  <button className="btn p sm" onClick={() => p.onFinalise()}>{p.finalised ? 'Re-finalise' : 'Finalise payroll'}</button>
                </>)}
          </span>
        </div>
        {p.locked
          ? <div className="muted" style={{ fontSize: '11.5px', padding: '0 2px 8px', color: 'var(--amber)' }}>This month is finalised — payslips are written, so the entries are locked. Click <b>✏️ Edit entries</b> to change them, then re-finalise so the payslips match.</div>
          : null}
        <div className="muted" style={{ fontSize: '11px', padding: '0 2px 8px' }}>Type in any white cell — Gross / EPF / SOCSO / EIS / PCB / Net recalculate live using the Malaysian statutory tables. Basic &amp; Allowance pre-fill from each profile. Bonus / OT / Extra allow are EPF-subject earnings; <b>Unpaid</b> lowers the wage (so it reduces statutory too); <b>Deduct</b> reduces net only. <b>PCB is editable</b> — it calculates from the MTD tables, and typing over it pins the real figure for this month (turns amber; ↺ goes back to auto). Each employee&#39;s EPF rate / SOCSO category / age rules come from their profile.</div>
        <div className="tbl-wrap">
          <table className="bigtable" style={{ fontSize: '12px' }}>
            <thead>
              <tr style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                <th></th>
                <th colSpan={5} className="muted" style={GRP_TH}>Earnings (RM)</th>
                <th colSpan={2} className="muted" style={GRP_TH}>Deductions (RM)</th>
                <th colSpan={7} className="muted" style={{ textAlign: 'center', borderBottom: '1px solid var(--coral-soft)', paddingBottom: '3px', color: 'var(--coral)' }}>Statutory · auto-calculated</th>
              </tr>
              <tr>
                <th>Employee</th>
                <th className="amt">Basic</th>
                <th className="amt">Allow</th>
                <th className="amt">Bonus</th>
                <th className="amt">OT</th>
                <th className="amt">Extra allow</th>
                <th className="amt">Deduct</th>
                <th className="amt">Unpaid</th>
                <th className="amt">Gross</th>
                <th className="amt">EPF</th>
                <th className="amt">SOCSO</th>
                <th className="amt">EIS</th>
                <th className="amt" title="PERKESO LINDUNG 24 Jam (SKBBK) — employee-only, since 1 Jun 2026">LIND24</th>
                <th className="amt" title="Calculated from the MTD tables — type over it to set the real figure for this month">PCB <span style={{ fontWeight: '400', textTransform: 'none', letterSpacing: '0' }}>✎</span></th>
                <th className="amt">Net</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => <GridTr key={r.e.id} p={p} r={r} />)}
              {/* Skipped staff are out of `rows`, so they get their own greyed rows — hros.html:4087.
                  An exclusion you cannot see is one you forget you made. NOT in the golden. */}
              {p.skipped.map((e) => (
                <tr key={e.id} style={{ opacity: '.55' }}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px' }}>
                      <RowMenuBtn p={p} id={e.id} />
                      <span><b>{e.emp_no}</b> {e.name}<div style={{ fontSize: '9.5px', marginTop: '1px', color: 'var(--amber)' }}>Skipped — no payslip this month</div></span>
                    </span>
                  </td>
                  <td colSpan={13} className="muted" style={{ fontSize: '11px' }}>Not in this run. {rw(<button className="btn xs" onClick={() => p.onSkip(e.id, false)}>Include</button>)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: '700', borderTop: '2px solid var(--border)' }}>
                <td>{'Total (' + p.rows.length + (p.skipped.length ? (' · ' + p.skipped.length + ' skipped') : '') + ')'}</td>
                <td colSpan={7} className="muted" style={{ fontSize: '11px', fontWeight: '400', textAlign: 'right' }}>variable items →</td>
                <td className="amt" id="t_g">{M(p.tot.gross)}</td>
                <td className="amt" id="t_epf">{M(p.tot.epfEe)}</td>
                <td className="amt" id="t_soc">{M(p.tot.socsoEe)}</td>
                <td className="amt" id="t_eis">{M(p.tot.eisEe)}</td>
                <td className="amt" id="t_lin">{M(p.tot.lindung)}</td>
                <td className="amt" id="t_pcb">{M(p.tot.pcb)}</td>
                <td className="amt" style={{ color: 'var(--green-soft)' }} id="t_net">{M(p.tot.net)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* `hrPaySumHtml()` — hros.html:3819. v196: PERKESO is billed the Second-Schedule contribution AND
          LINDUNG 24 together; leaving lindung out understates what has to be paid over. */}
      <div id="hr_paysum" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '10px', marginTop: '14px' }}>
        {([
          ['EPF (KWSP) payable', p.tot.epfEe + p.tot.epfEr],
          ['SOCSO (PERKESO) payable', p.tot.socsoEe + p.tot.lindung + p.tot.socsoEr],
          ['EIS payable', p.tot.eisEe + p.tot.eisEr],
          ['PCB (LHDN) payable', p.tot.pcb],
          ['Employer total cost', p.tot.cost],
        ] as [string, number][]).map(([label, amt]) => (
          <div key={label} className="panel" style={{ padding: '12px', margin: '0' }}>
            <div className="muted" style={{ fontSize: '11px' }}>{label}</div>
            <div style={{ fontSize: '16px', fontWeight: '700', marginTop: '2px' }}>{M(amt)}</div>
          </div>
        ))}
      </div>

      <PayHub p={p} period={period} />

      {/* NOT in the golden: both panels are closed when it is captured. */}
      {p.dedEmp ? <DedPanel p={p} empId={p.dedEmp} /> : null}
      {p.rowMenu ? <RowMenuPanel p={p} empId={p.rowMenu} /> : null}
    </>
  );
}

/** `hrGRowMenuBtn()` — hros.html:4243. */
function RowMenuBtn({ p, id }: { p: HrPayrollProps; id: string }) {
  if (p.locked) return null;
  return (
    <button onClick={() => p.onRowMenu(id)} title="Skip this month, mark resigned, or delete" style={ROW_MENU_BTN(p.rowMenu === id)}>⋯</button>
  );
}

/** `hrGCell()` — hros.html:3768. */
function Cell({ p, id, field }: { p: HrPayrollProps; id: string; field: CellField }) {
  const g = p.grid[id] || ({} as GridRow);
  return (
    <input
      type="number" step="0.01" value={Number(g[field]) || 0} disabled={p.locked || undefined}
      onInput={(e) => p.onCell(id, field, val(e))} onFocus={selectAll}
      style={p.locked ? CELL_LOCKED : CELL}
    />
  );
}

/**
 * `hrGPcbCell()` — hros.html:3781.
 *
 * v195: PCB is the one statutory figure the operator sometimes has to type in — a mid-year go-live will
 * not reconcile from first principles. Blank = computed; any entry is stored as a `pcb_set` adjustment
 * so the server recomputes to exactly the same number.
 * v205: this shipped showing the calculated figure as a PLACEHOLDER, which renders grey and clipped —
 * the one editable statutory column looked disabled. It shows a real value now.
 */
function PcbCell({ p, id, computed }: { p: HrPayrollProps; id: string; computed: number }) {
  const g = p.grid[id] || ({} as GridRow);
  const ov = pcbOn(g);
  const shown = (ov ? Number(g.pcbSet) : Number(computed) || 0).toFixed(2);
  const style: CSSProperties = {
    width: '92px', padding: '4px 6px', background: 'var(--panel-2)',
    border: '1px solid ' + (ov ? 'var(--amber)' : 'var(--border)'), borderRadius: '5px',
    color: ov ? 'var(--amber)' : 'var(--text)', fontSize: '11.5px', textAlign: 'right',
    fontWeight: ov ? '700' : '400',
    ...(p.locked ? { opacity: '.6', cursor: 'not-allowed' } : null),
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', justifyContent: 'flex-end' }}>
      <input
        type="number" step="0.01" min="0" id={'pcb_' + id} value={shown} disabled={p.locked || undefined}
        onInput={(e) => p.onPcbCell(id, val(e))} onFocus={selectAll}
        title={ov ? 'Manual PCB for this month. ↺ goes back to the calculated figure.' : 'Calculated from the MTD tables. Type over it to set the real figure for this month.'}
        style={style}
      />
      {p.locked ? null : (
        <button
          id={'pcbu_' + id} onClick={() => p.onPcbAuto(id)} title="Back to the calculated figure"
          style={{ background: 'none', border: 'none', color: 'var(--amber)', cursor: 'pointer', fontSize: '12px', padding: '0 1px', lineHeight: '1', display: ov ? 'inline' : 'none' }}
        >↺</button>
      )}
    </span>
  );
}

/** `hrGridPcbOn()` — hros.html:4228. */
export function pcbOn(g: Partial<GridRow> | undefined): boolean {
  return !!g && g.pcbSet != null && (g.pcbSet as unknown) !== '';
}

/** One employee row of the grid — hros.html:4078. */
function GridTr({ p, r }: { p: HrPayrollProps; r: PayRow }) {
  const e = r.e, q = r.p, id = e.id, mt = q._meta || {};
  const g = p.grid[id] || ({} as GridRow);
  const n = (g.deductions || []).filter((x) => Number(x.amount)).length;
  const dedOpen = p.dedEmp === id;
  const amt = (cellId: string, v: number, style?: CSSProperties) => (
    <td className="amt" style={style} id={cellId}>{M(v)}</td>
  );
  return (
    <tr>
      <td style={{ whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px' }}>
          <RowMenuBtn p={p} id={id} />
          <span>
            <b>{e.emp_no}</b> {e.name}
            <div className="muted" style={{ fontSize: '9.5px', marginTop: '1px' }}>
              {'EPF ' + Math.round((mt.epfEeRate || 0) * 1000) / 10 + '% · SOC C' + (mt.socsoCat || 1)}
              {mt.senior ? <> · <span style={{ color: 'var(--amber)' }}>60+</span></> : null}
              {e.resident === false ? <> · <span style={{ color: 'var(--amber)' }}>non-res</span></> : null}
            </div>
          </span>
        </span>
      </td>
      <td><Cell p={p} id={id} field="basic" /></td>
      <td><Cell p={p} id={id} field="allow" /></td>
      <td><Cell p={p} id={id} field="bonus" /></td>
      <td><Cell p={p} id={id} field="ot" /></td>
      <td><Cell p={p} id={id} field="allowance" /></td>
      {/* `hrDedCell()` — hros.html:3791 */}
      <td>
        <button className="btn xs" id={'ded_' + id} onClick={() => p.onDedOpen(id)} title="Itemise deductions" style={dedOpen ? { minWidth: '74px', borderColor: 'var(--coral)' } : { minWidth: '74px' }}>
          {M(dedTot(g)) + (n ? (' · ' + n) : '') + ' ▾'}
        </button>
      </td>
      <td><Cell p={p} id={id} field="unpaid" /></td>
      {amt('g_' + id, q.gross)}
      {amt('epf_' + id, q.epfEe)}
      {amt('soc_' + id, q.socsoEe)}
      {amt('eis_' + id, q.eisEe)}
      {amt('lin_' + id, q.lindung)}
      <td className="amt"><PcbCell p={p} id={id} computed={q.pcb} /></td>
      {amt('net_' + id, q.net, { fontWeight: '700', color: 'var(--green-soft)' })}
    </tr>
  );
}

/* ─────────────────────────── 💸 Payment & Statutory Hub — hros.html:3993 ─────────────────────────── */

function HubTick({ p, k }: { p: HrPayrollProps; k: HubKey }) {
  return (
    <label style={HUB_CHECK_LABEL}>
      <input type="checkbox" checked={!!p.ticks[k]} onChange={(e) => p.onHubTick(k, e.target.checked)} style={{ accentColor: 'var(--green-soft)' }} /> Done
    </label>
  );
}

function HubSection(
  { p, icon, title, amt, due, btns, path, k }:
  { p: HrPayrollProps; icon: string; title: string; amt: ReactNode; due: ReactNode; btns: ReactNode; path: ReactNode; k: HubKey },
) {
  return (
    <div style={HUB_SEC}>
      <div>
        <div style={{ fontWeight: '700', fontSize: '13px' }}>{icon + ' ' + title}</div>
        <div style={{ fontSize: '15px', fontWeight: '750', marginTop: '2px' }}>{amt}</div>
        {due ? <div style={{ marginTop: '2px' }}>{due}</div> : null}
      </div>
      <div>
        <div style={HUB_BTNS}>{btns}</div>
        <div className="muted" style={HUB_PATH}>{path}</div>
      </div>
      <div style={{ paddingTop: '4px' }}><HubTick p={p} k={k} /></div>
    </div>
  );
}

function PayHub({ p, period }: { p: HrPayrollProps; period: string }) {
  const tot = p.tot;
  const done = HUB_KEYS.filter((k) => p.ticks[k]).length;
  const dd = <span style={{ fontSize: '10.5px', color: p.due.col }}>{p.due.txt}</span>;
  return (
    <div className="panel" style={{ marginTop: '14px' }}>
      <div className="panel-hd">
        <h3>💸 Payment &amp; Statutory Hub — {period}</h3>
        <span className={'pill ' + (done >= 5 ? 'pill-green' : 'pill-draft')} style={{ fontSize: '10.5px' }}>{done + '/5 done'}</span>
      </div>

      {/* One-click bar: generate ALL statutory + salary files in a single ZIP, then guide the upload. */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', background: 'linear-gradient(180deg,rgba(226,96,75,.16),rgba(226,96,75,.05))', border: '1px solid rgba(226,96,75,.4)', borderRadius: '11px', padding: '12px 14px', marginBottom: '12px' }}>
        <button className="btn p" onClick={() => p.onSubmitAll()} style={{ fontSize: '14px' }}>📤 Submit all — generate every file</button>
        <button className="btn" onClick={() => p.onLegacyPanel('statids')} style={{ fontSize: '13px' }}>🆔 Statutory numbers</button>
        <button className="btn" onClick={() => p.onLegacyPanel('tp1')} style={{ fontSize: '13px' }}>🧾 TP1 reliefs</button>
        <span className="muted" style={{ fontSize: '11.5px', flex: '1', minWidth: '160px' }}>One click builds the UOB salary + EPF + SOCSO/EIS + PCB files into a single ZIP, then shows exactly where to upload each. {p.finalised ? null : <b style={{ color: 'var(--amber)' }}>Finalise payroll first for authoritative figures.</b>}</span>
      </div>

      {/* `HR.submitPack`'s generated-file list (hros.html:4010) is NOT migrated with this screen: it
          exists only after hrSubmitAll() has built the ZIP, which is the export half. Not in the golden
          either — the pack is null when it is captured. */}

      <HubSection
        p={p} icon="🏦" title="Salaries — UOB Infinity" k="salary"
        amt={<>{M(tot.net)} <span className="muted" style={{ fontSize: '10px' }}>net pay</span></>}
        due={<span className="muted" style={{ fontSize: '10.5px' }}>pay on your payday</span>}
        btns={<>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'end', width: '100%', marginBottom: '6px' }}>
            <div>
              <label className="muted" style={{ fontSize: '10px' }}>UOB debit account</label>
              <br />
              <input id="hr_uob_acct" defaultValue={p.uob.acct || ''} placeholder="company UOB account no" style={{ ...UOB_INPUT, width: '180px' }} />
            </div>
            <div>
              <label className="muted" style={{ fontSize: '10px' }}>Crediting date</label>
              <br />
              <input id="hr_uob_cd" type="date" defaultValue={p.uob.cd || ''} style={UOB_INPUT} />
            </div>
            <button className="btn xs" onClick={() => p.onUobSave()}>Save</button>
          </div>
          <button className="btn xs p" onClick={() => p.onExpBank('uob')}>⬇ UOB Infinity salary file</button>
          <button className="btn xs" onClick={() => p.onExpBank('maybank')}>Maybank M2E</button>
          <button className="btn xs" onClick={() => p.onExpGiro()}>Generic IBG CSV</button>
        </>}
        path={<>UOB Infinity → <b>Pay &amp; Transfer → Bulk Transactions → Upload Bulk Files</b> → file type <b>“IBG Payroll with Payment Advice (Employee)”</b>. First upload needs UOB’s one-time test-file certification. If your Infinity requires their fixed-width UFF template, get the spec sheet from your UOB RM — it can be encoded exactly.</>}
      />
      <HubSection
        p={p} icon="🏛️" title="EPF — KWSP" k="epf"
        amt={<>{M(tot.epfEe + tot.epfEr)} <span className="muted" style={{ fontSize: '10px' }}>{'EE ' + M(tot.epfEe) + ' + ER ' + M(tot.epfEr)}</span></>}
        due={dd}
        btns={<button className="btn xs p" onClick={() => p.onExpKwsp()}>⬇ KWSP i-Akaun file</button>}
        path={<>Upload + pay at <b>i-Akaun (Majikan)</b>, or in UOB Infinity → Upload Bulk Files → file type <b>“EPF Payment (Employee)”</b>.</>}
      />
      <HubSection
        p={p} icon="🏛️" title="SOCSO + EIS — PERKESO" k="perkeso"
        /* v196: LINDUNG is payable to PERKESO too. */
        amt={<>{M(tot.socsoEe + tot.lindung + tot.socsoEr + tot.eisEe + tot.eisEr)} <span className="muted" style={{ fontSize: '10px' }}>{'SOCSO ' + M(tot.socsoEe + tot.socsoEr) + (tot.lindung ? (' · LINDUNG 24 ' + M(tot.lindung)) : '') + ' · EIS ' + M(tot.eisEe + tot.eisEr)}</span></>}
        due={dd}
        btns={<button className="btn xs p" onClick={() => p.onExpAssist()}>⬇ PERKESO ASSIST file</button>}
        path={<>Upload + pay at the <b>ASSIST portal</b>, or in UOB Infinity → <b>Services → Send to UOB</b> → “SOCSO Monthly Contribution” / “EIS Contribution”.</>}
      />
      <HubSection
        p={p} icon="🏛️" title="PCB — LHDN" k="pcb"
        amt={M(tot.pcb)} due={dd}
        btns={<button className="btn xs p" onClick={() => p.onExpCp39()}>⬇ CP39 / e-PCB file</button>}
        path={<>Upload at <b>e-PCB / e-Data PCB</b> and pay by FPX there. ⚠ UOB Infinity does <b>not</b> accept PCB files — LHDN portal only.</>}
      />
      <HubSection
        p={p} icon="📒" title="Xero — payroll journal" k="xero"
        amt={<span className="muted" style={{ fontSize: '12px' }}>wages + statutory liabilities</span>}
        due={''}
        btns={p.finalised && p.runId
          ? <button className="btn xs p" onClick={() => p.onPostXero(p.runId as string)}>📥 Post DRAFT journal</button>
          : <button className="btn xs" disabled style={{ opacity: '.5', cursor: 'not-allowed' }} title="Finalise payroll first">Finalise payroll first</button>}
        path={<>Posts a <b>DRAFT</b> manual journal to Xero — you review &amp; approve it inside Xero.</>}
      />

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '10px' }}>
        <span className="muted" style={{ fontSize: '11px', fontWeight: '600' }}>📄 Documents</span>
        <button className="btn xs" onClick={() => p.onExpSummary()}>Payroll Summary (Excel)</button>
        <button className="btn xs" onClick={() => p.onExpPayslips()}>Payslips PDF</button>
        <button className="btn xs" onClick={() => p.onEmailAll()}>✉️ Email payslips</button>
        <span className="muted" style={{ fontSize: '10.5px' }}>· raw csv:</span>
        <button className="btn xs" onClick={() => p.onExpStatutory('epf')}>EPF</button>
        <button className="btn xs" onClick={() => p.onExpStatutory('socso')}>SOCSO</button>
        <button className="btn xs" onClick={() => p.onExpStatutory('eis')}>EIS</button>
        <button className="btn xs" onClick={() => p.onExpStatutory('pcb')}>PCB</button>
      </div>
      <div className="muted" style={{ fontSize: '10.5px', marginTop: '8px', lineHeight: '1.5' }}>Checklist ticks save per company + month (this browser). Statutory amounts are system-computed estimates — verify against the official portal figure before paying, and do a one-time test upload for each file type.</div>
    </div>
  );
}

/* ───────────────────── the two panels the golden does not reach — hros.html:3794/:4267 ───────────────────── */

/** `hrDedPanel()` — hros.html:3794. NOT covered by the parity test: `dedEmp` is null in the golden. */
function DedPanel({ p, empId }: { p: HrPayrollProps; empId: string }) {
  const e = p.rows.map((r) => r.e).concat(p.skipped).find((x) => x.id === empId);
  if (!e) return null;
  const g = p.grid[empId] || ({} as GridRow);
  const deds = g.deductions || [];
  const dis = p.locked || undefined;
  const dsty: CSSProperties = p.locked ? { opacity: '.6', cursor: 'not-allowed' } : {};
  const box: CSSProperties = { padding: '6px 8px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '12px' };
  return (
    <div className="panel" id="hr_dedpanel" style={{ maxWidth: '560px', marginTop: '14px', borderColor: 'var(--coral-soft)' }}>
      <div className="panel-hd">
        <h3>{'Deductions — ' + e.name + ' · ' + HR_MONTHS[p.month] + ' ' + p.year}</h3>
        <button className="btn sm" onClick={() => p.onDedOpen(empId)}>✕ Close</button>
      </div>
      <datalist id="hr_dedtypes">{HR_DED_TYPES.map((t) => <option key={t} value={t}></option>)}</datalist>
      {deds.length
        ? deds.map((x, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 34px', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
              <input value={x.label || ''} disabled={dis} onInput={(ev) => p.onDedLabel(empId, i, val(ev))} placeholder="Deduction name" list="hr_dedtypes" style={{ ...box, ...dsty }} />
              <input type="number" step="0.01" value={Number(x.amount) || 0} disabled={dis} onInput={(ev) => p.onDedAmt(empId, i, val(ev))} onFocus={selectAll} placeholder="RM" style={{ ...box, textAlign: 'right', ...dsty }} />
              <button className="btn xs" disabled={dis} onClick={() => p.onDedDel(empId, i)} title="Remove">✕</button>
            </div>
          ))
        : <div className="muted" style={{ fontSize: '12px', padding: '4px 0 8px' }}>No deductions yet — add advances, loans, PTPTN, zakat, CP38, etc.</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
        <button className="btn p sm" disabled={dis} onClick={() => p.onDedAdd(empId)}>+ Add deduction</button>
        <select
          disabled={dis} value=""
          onChange={(ev) => { if (ev.target.value) p.onDedAdd(empId, ev.target.value); }}
          style={{ padding: '7px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '12px' }}
        >
          <option value="">Quick add…</option>
          {HR_DED_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span id="hr_dedtotal" style={{ marginLeft: 'auto', fontWeight: '700' }}>{'Total: ' + M(dedTot(g))}</span>
      </div>
      <div className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>These reduce net pay only (not EPF/SOCSO/EIS/PCB) and appear as separate lines on the payslip. Zakat &amp; CP38 have tax effects — confirm with your tax agent.</div>
    </div>
  );
}

/** `hrGRowMenuPanel()` — hros.html:4267. NOT covered by the parity test: `rowMenu` is null in the golden. */
function RowMenuPanel({ p, empId }: { p: HrPayrollProps; empId: string }) {
  const e = p.rows.map((r) => r.e).concat(p.skipped).find((x) => x.id === empId);
  if (!e) return null;
  const g = p.grid[empId] || ({} as GridRow);
  const gone = String(e.status || '') === 'resigned' || !!e.resign_date;   // `hrIsResigned()` — hros.html
  const rw = <T,>(node: T): T | null => (p.viewer ? null : node);
  const Box = ({ t, children }: { t: string; children: ReactNode }) => (
    <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '9px', padding: '10px 12px' }}>
      <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)', marginBottom: '6px' }}>{t}</div>
      {children}
    </div>
  );
  return (
    <div className="panel" id="hr_rowmenu" style={{ maxWidth: '720px', marginTop: '14px', borderColor: 'var(--coral-soft)' }}>
      <div className="panel-hd">
        <h3>{(e.emp_no || '') + ' ' + (e.name || '')}</h3>
        <button className="btn sm" onClick={() => p.onRowMenu(empId)}>✕ Close</button>
      </div>
      <div style={{ display: 'grid', gap: '10px' }}>
        <Box t="This month only">
          <div className="muted" style={{ fontSize: '11.5px', marginBottom: '7px' }}>{'Keeps everything, just leaves them out of ' + HR_MONTHS[p.month] + ' ' + p.year + ' — no payslip, no bank line, out of every statutory total. Reversible.'}</div>
          {g.skip
            ? rw(<button className="btn sm" onClick={() => p.onSkip(empId, false)}>↩ Put back in this month</button>)
            : rw(<button className="btn sm" onClick={() => p.onSkip(empId, true)}>⊘ Skip this month</button>)}
        </Box>
        <Box t="They have left">
          {gone
            ? <div style={{ fontSize: '12px', color: 'var(--amber)' }}>{'Already marked resigned' + (e.resign_date ? (' on ' + e.resign_date) : '') + '.'}</div>
            : <>
                <div className="muted" style={{ fontSize: '11.5px', marginBottom: '7px' }}>Drops them out of every future payroll. History, payslips and the EA form are all kept.</div>
                <div style={{ display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label className="muted" style={{ fontSize: '11px' }}>Last working day</label>
                  <input type="date" id="hr_rm_resign" defaultValue={p.today || ''} style={{ padding: '6px 8px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '12px' }} />
                  {rw(<button className="btn sm" onClick={() => p.onResign(empId)}>🚪 Mark resigned</button>)}
                </div>
              </>}
        </Box>
        <Box t="Delete permanently">
          {gone
            ? <>
                <div className="muted" style={{ fontSize: '11.5px', marginBottom: '7px' }}>Erases the profile and their leave / claim / attendance records. If they have payslips this year you still need the EA form, so that needs a second confirmation.</div>
                {rw(<button className="btn sm d" onClick={() => p.onEmpDelete(empId)}>{'🗑 Delete ' + (e.name || '')}</button>)}
              </>
            : <div className="muted" style={{ fontSize: '11.5px' }}>Only a resigned employee can be deleted — mark them resigned first. That is deliberate: deleting someone who was paid this year destroys the EA / Form E source data.</div>}
        </Box>
      </div>
    </div>
  );
}
