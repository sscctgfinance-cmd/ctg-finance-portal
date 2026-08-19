// HR OS · Year-end (Borang EA / Form E / CP8D) — the React half of the strangler's fifth screen.
//
// The legacy original is `hrYearend()` at hros.html:4920, with the four functions it wires up around it
// — `hrYePick()` (:4945), `hrYeLoad()` (:4946), `hrExpEA()` (:4952), `hrExpFormE()` (:4964) and
// `hrExpCp8d()` (:4975). It is STILL THERE and still shipping; nothing was deleted. Both are reachable
// side by side (`hros.html#tab=yearend` and `/hr/yearend/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, AND NO CLOCK READ. The last one is
// what this screen turns on: the legacy renderer calls `new Date().getFullYear()` twice, to build the
// Y/A dropdown and to default the year to last year. Reading the clock inside the component would make
// its markup depend on when the test runs, so both derivations moved out into the two exported helpers
// below, which are pure functions of a Date they are HANDED. app/hr/yearend/page.tsx hands them the real
// one; tests/hr-yearend.parity.test.tsx hands them the instant the golden was captured at.
//
// The markup deliberately mirrors the legacy string concatenation element for element, including the
// inline `style` strings. It is not "better" — it is the SAME, because the golden is the contract.

import type { CSSProperties } from 'react';

/** One employee, as `HR.data.employees` carries them. Only the three fields this screen reads. */
export interface YeEmployee {
  id: string;
  emp_no?: string | null;
  name?: string | null;
}

/** One entry of `hr_annual`'s `annual` map, keyed by employee id. */
export interface YeTotals {
  months: number;
  gross: number;
  epfEe: number;
  socsoEe?: number | null;
  /** LINDUNG 24 is a SOCSO contribution and is shown INSIDE the SOCSO column — v196, hros.html:4935. */
  lindung?: number | null;
  pcb: number;
}

export interface HrYearendProps {
  /** The Y/A being shown. `HR_YE.year` — hros.html:4919. */
  year: number;
  /** The dropdown's options, newest first. Build it with `taxYears()` below. */
  years: number[];
  employees: YeEmployee[];
  /**
   * `HR_YE.annual`. `null` is the pre-load state, which paints the spinner panel instead of the screen
   * — see the note on that branch below.
   */
  annual: Record<string, YeTotals> | null;
  /** `HR_YE.employer.employer_no` — empty means the LHDN E-number warning banner shows. */
  employerNo?: string | null;
  /** `hrCompanyName()` — hros.html:4445. Chrome, so it is passed in rather than resolved here. */
  companyName: string;
  /** `hrYePick()`. Takes no argument: the legacy one reads `#hr_yey` back out of the DOM, and so does
      the route, because the <select> is uncontrolled for exactly that reason. */
  onPick: () => void;
  /** `hrExpEA(empId)`. `0` is the legacy sentinel for "every paid employee" — hros.html:4952. */
  onExpEA: (empId: string | 0) => void;
  onExpFormE: () => void;
  onExpCp8d: (fmt: 'txt' | 'csv') => void;
}

/** `M()` — hros.html:1268. */
function M(n: number): string {
  return 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * The Y/A dropdown's options — `hrYearend()`'s `for(var y=cy;y>=cy-4;y--)`, hros.html:4922.
 * A pure function of the instant it is given, so the screen's markup is testable against a fixed one.
 */
export function taxYears(now: Date): number[] {
  const cy = now.getFullYear();
  const out: number[] = [];
  for (let y = cy; y >= cy - 4; y--) out.push(y);
  return out;
}

/**
 * `HR_YE.year`'s default — hros.html:4921. Last year, because that is the year you file for: EA reaches
 * the employee by 28 Feb and Form e-E by 31 March, both for the year that just closed.
 */
export const defaultTaxYear = (now: Date): number => now.getFullYear() - 1;

export default function HrYearend(props: HrYearendProps) {
  const { year, years, employees, annual, employerNo, companyName, onPick, onExpEA, onExpFormE, onExpCp8d } = props;

  return (
    <>
      {/* The page head is built by hrRender(), not hrYearend() — hros.html:1538. Shared chrome, and
          report.md §3.5 keeps chrome out of a screen-by-screen strangler, but it is inside the `#hr`
          element the golden holds, so leaving it out would mean diffing against an arbitrary slice.
          Eyebrow / title / sub are HR_NAV's row for this view — hros.html:1467. */}
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Payroll</div>
          <h2 className="page-title">Year-end</h2>
          <div className="page-sub">Borang EA, Form E and CP8D statements</div>
        </div>
        <div className="page-meta">
          <span className="page-chip"><span className="dot"></span>{companyName}</span>
        </div>
      </div>

      {/* The picker. UNCONTROLLED, exactly as the legacy one is: its id is the contract, because
          `hrYePick()` (hros.html:4945) reads the value straight back out of the DOM. Controlling it
          would also mean an `onChange` the legacy screen does not have, and the golden would say so. */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: '12px' }}>Tax year (Y/A)</span>
        <select id="hr_yey" defaultValue={String(year)} style={SELECT}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button className="btn sm" onClick={onPick}>Load</button>
      </div>

      {annual === null ? <Loading year={year} /> : <Loaded {...props} annual={annual} />}
    </>
  );
}

/**
 * `hrYearend()`'s `ye.annual===null` early return — hros.html:4927.
 *
 * NOT COVERED BY THE PARITY TEST: a golden is one state of one screen, and `hr.yearend.html` was
 * captured after `hrYeLoad()` had landed, so this branch never appears in it. It is mirrored from the
 * legacy source anyway because the alternative is a screen that paints nothing at all between opening
 * it and the aggregate arriving.
 */
function Loading({ year }: { year: number }) {
  return (
    <div className="panel">
      <div className="muted" style={{ padding: '24px', textAlign: 'center' }}>
        <span className="spin"></span> Aggregating finalised payslips for {year}…
      </div>
    </div>
  );
}

function Loaded({ year, employees, annual, employerNo, onExpEA, onExpFormE, onExpCp8d }:
  HrYearendProps & { annual: Record<string, YeTotals> }) {
  // hros.html:4929 — "paid in <year>" is months>0, not merely having a row. An employee with a row and
  // no finalised payslip has nothing to put on an EA form.
  const withPay = employees.filter((e) => annual[e.id] && annual[e.id].months > 0);

  let tg = 0, tp = 0, subj = 0;
  withPay.forEach((e) => { const t = annual[e.id]; tg += t.gross; tp += t.pcb; if (t.pcb > 0) subj++; });

  const cards: [string, string | number, string][] = [
    ['Employees paid in ' + year, withPay.length, 'var(--sky-soft)'],
    ['Total gross remuneration', M(tg), 'var(--green-soft)'],
    ['Total PCB / MTD', M(tp), 'var(--coral)'],
    ['Subject to MTD', subj, 'var(--muted)'],
  ];

  return (
    <>
      {/* hros.html:4933. Absent from the golden because the fixture's employer HAS an E-number; without
          one every EA / Form E / CP8D prints a placeholder and is rejected at filing time. */}
      {employerNo ? null : (
        <div className="panel" style={{ borderColor: 'var(--amber)', background: 'rgba(240,180,40,.06)', padding: '10px 14px', marginBottom: '12px', fontSize: '12.5px' }}>
          ⚠️ Employer E-number is not set in <b>hr_employer_info</b>. EA / Form E / CP8D will print a placeholder — set it before filing with LHDN.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '12px', marginBottom: '16px' }}>
        {cards.map((c) => (
          <div key={c[0]} className="panel" style={{ padding: '14px', margin: '0' }}>
            <div className="muted" style={{ fontSize: '11px' }}>{c[0]}</div>
            <div style={{ fontSize: '20px', fontWeight: '700', marginTop: '4px', color: c[2] }}>{c[1]}</div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-hd"><h3>Year-end {year} — annual per-employee totals</h3></div>
        <div className="tbl-wrap">
          <table className="bigtable">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="amt">Months</th>
                <th className="amt">Gross</th>
                <th className="amt">EPF (ee)</th>
                <th className="amt">SOCSO (ee)</th>
                <th className="amt">PCB</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {withPay.length ? withPay.map((e) => {
                const t = annual[e.id];
                return (
                  <tr key={e.id}>
                    <td><b>{e.emp_no}</b> {e.name}</td>
                    <td className="amt">{t.months}</td>
                    <td className="amt">{M(t.gross)}</td>
                    <td className="amt">{M(t.epfEe)}</td>
                    <td className="amt">{M((Number(t.socsoEe) || 0) + (Number(t.lindung) || 0))}</td>
                    <td className="amt">{M(t.pcb)}</td>
                    <td><button className="btn xs" onClick={() => onExpEA(e.id)}>EA PDF</button></td>
                  </tr>
                );
              }) : (
                // hros.html:4935's `||` fallback. Not in the golden — the fixture has three paid
                // employees — but leaving it out would paint an empty table with no explanation.
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: '20px' }}>No finalised payslips for {year} yet. Finalise monthly payroll first.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '14px' }}>
        <span className="muted" style={{ fontSize: '11px' }}>LHDN forms:</span>
        <button className="btn xs" onClick={() => onExpEA(0)}>📄 All EA forms (C.P.8A)</button>
        <button className="btn xs" onClick={onExpFormE}>📋 Form E (C.P.8)</button>
        <button className="btn xs" onClick={() => onExpCp8d('txt')}>🗂️ CP8D TXT (upload)</button>
        <button className="btn xs" onClick={() => onExpCp8d('csv')}>CP8D CSV (review)</button>
      </div>
      <div className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>EA must reach each employee by 28 Feb. File Form e-E on MyTax by 31 March. PCB is an estimate — verify against LHDN before filing. BIK / VOLA / bonus must be added manually.</div>
    </>
  );
}

/** The legacy `#hr_yey` control style — hros.html:4925. */
const SELECT: CSSProperties = {
  padding: '7px',
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text)',
};
