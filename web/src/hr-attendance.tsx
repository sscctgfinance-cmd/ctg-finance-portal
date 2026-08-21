// HR OS · Attendance — the React half of the strangler's third screen.
//
// The legacy original is `hrAttendance()` at hros.html:3039 (the month picker + the two buttons) and
// `hrAttRender()` at :3055 (the hours summary and the punch log), with `hrAttEditModal()` at :3065 and
// the `hrDtLocal()` formatter at :3038. All of it is STILL THERE and still shipping; nothing was
// deleted. Both are reachable side by side (`hros.html#tab=attendance` and `/hr/attendance/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. That is what lets
// tests/hr-attendance.parity.test.tsx render it with `renderToStaticMarkup` and diff the result against
// tests/golden/hr.attendance.html. The loading, the session, the month state and the save/delete calls
// live in app/hr/attendance/page.tsx, on the other side of that line.
//
// The markup deliberately mirrors the legacy string concatenation element for element, including the
// inline `style` strings. It is not "better" — it is the SAME, because the golden is the contract.
//
// NOT covered by the golden, and included anyway: the loading panel, the two empty-table branches, and
// `hrAttEditModal()`. The golden was captured with data loaded and `ATT.editRow === null`, so none of
// them appear in it — but unlike the pilot's `hrPushCard()` (device chrome that renders nothing without
// a service worker) these are ordinary branches of the same renderer, and dropping the modal would leave
// "+ Add punch" wired to nothing. They are mirrored from the legacy source line for line; the parity
// test proves the branch the golden DOES hold.

import type { CSSProperties } from 'react';

import { mytDtLocal } from '../../myt.js';

/** One row of `attendance_list.summary` — hros.html:3058. */
export interface AttSummary {
  employee_id?: string;
  name?: string | null;
  emp_no?: string | null;
  pay_type?: string | null;
  hours?: number | null;
  days?: number | null;
  est_pay?: number | null;
  open?: number | null;
}

/** One row of `attendance_list.punches` — hros.html:3060. */
export interface AttPunch {
  id: string;
  employee_id?: string | null;
  work_date?: string | null;
  clock_in?: string | null;
  clock_out?: string | null;
  hours?: number | null;
  break_minutes?: number | null;
  source?: string | null;
  note?: string | null;
  hr_employees?: { name?: string | null; emp_no?: string | null } | null;
}

/** The `attendance_list` response, as the legacy screen consumes it. */
export interface AttendanceList {
  summary?: AttSummary[];
  punches?: AttPunch[];
}

/** The employees `hrAttEditModal()` offers — hros.html:3066. */
export interface AttEmployee {
  id: string;
  name?: string | null;
  emp_no?: string | null;
}

export interface HrAttendanceProps {
  /** `ATT.data` — null while the first load is in flight, which is the legacy loading panel. */
  data: AttendanceList | null;
  /** `hrCompanyName()` — hros.html:4445. Chrome, so it is passed in rather than resolved here. */
  companyName: string;
  /** `ATT.month`, `YYYY-MM`. A prop because `todayLocalISO()` (hros.html:3040) reads the clock. */
  month: string;
  /** `ATT.editRow` — hros.html:3037. `null` = no modal; `{}` = add; a punch = edit. */
  editRow?: AttPunch | Record<string, never> | null;
  /** `hrNeedsClock()`-eligible staff for the modal's picker. Empty when the modal is closed. */
  employees?: AttEmployee[];
  onMonthChange: (month: string) => void;
  onAdd: () => void;
  onExport: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onCloseModal: () => void;
  onSave: () => void;
}

/** `M()` — hros.html:1268. */
function M(n: number): string {
  return 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * `hrClkTime()` — hros.html:2908. Same call, so the same string: the punch is stored in UTC and shown in
 * the viewer's zone, which is what an operator checking a timesheet expects. The parity test pins that
 * zone so the comparison is read the way the golden was written.
 */
export function clkTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * `hrDtLocal()` — hros.html:3038, which v224 made MALAYSIAN. IMPORTED, not re-expressed, for the same
 * reason `hrCompute` is: a `datetime-local` box carries wall time and NO zone, so what fills it and what
 * reads it back are one contract, and two copies of that contract eventually move a punch.
 *
 * It used to be the MACHINE's wall clock. An admin outside Malaysia saw an hour the punch was never at,
 * and saving anything on that form re-posted the shifted instant — someone's paid hours. The route's
 * save half is `mytFromDtLocal`, the exact inverse.
 */
export const dtLocal = (iso?: string | null): string => mytDtLocal(iso ?? null);

/** The month picker's style — hros.html:3044. Same declarations, same order, so the same string. */
const MONTH_INPUT: CSSProperties = {
  padding: '8px 10px',
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  color: 'var(--text)',
  fontSize: '13px',
};

/** The legacy modal's shared control style `S` — hros.html:3068. */
const S: CSSProperties = { width: '100%', ...MONTH_INPUT };

const OPEN_PILL: CSSProperties = { fontSize: '9px' };
const SMALL_MUTED: CSSProperties = { fontSize: '11px' };

export default function HrAttendance(p: HrAttendanceProps) {
  const { data, companyName, month } = p;
  const sum = data?.summary || [];
  const punches = data?.punches || [];

  return (
    <>
      {/* The page head is built by hrRender(), not hrAttendance() — hros.html:1537. Shared chrome, and
          report.md §3.5 keeps it re-implemented per world during the transition. Included because it is
          inside the `#hr` element the golden holds. */}
      <div className="page-head">
        <div>
          <div className="page-eyebrow">People</div>
          <h2 className="page-title">Attendance</h2>
          <div className="page-sub">Clock-in records, hours &amp; timesheet corrections</div>
        </div>
        <div className="page-meta">
          <span className="page-chip"><span className="dot"></span>{companyName}</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
        <input type="month" value={month} onChange={(e) => p.onMonthChange(e.target.value)} style={MONTH_INPUT} />
        <div style={{ display: 'flex', gap: '6px' }}>
          <button className="btn xs" onClick={p.onAdd}>+ Add punch</button>
          <button className="btn xs" onClick={p.onExport}>⬇ CSV</button>
        </div>
      </div>

      {!data
        ? <div className="panel" style={{ padding: '40px', textAlign: 'center' }}><span className="spin"></span> <span className="muted">Loading…</span></div>
        : (
          <>
            <div className="panel" style={{ marginBottom: '14px' }}>
              <div className="panel-hd">
                <h3>Hours summary · {month}</h3>
                <span className="muted" style={SMALL_MUTED}>est. pay = hourly/daily staff only</span>
              </div>
              {sum.length ? (
                <div className="tbl-wrap">
                  <table className="bigtable">
                    <thead><tr><th>Employee</th><th>Pay type</th><th className="amt">Hours</th><th className="amt">Days</th><th className="amt">Est. pay</th><th className="amt"></th></tr></thead>
                    <tbody>
                      {sum.map((s, i) => (
                        <tr key={s.employee_id || i}>
                          <td><b>{s.name || ''}</b> <span className="muted" style={{ fontSize: '10.5px' }}>{s.emp_no || ''}</span></td>
                          <td className="muted">{s.pay_type || 'monthly'}</td>
                          <td className="amt">{Number(s.hours || 0).toFixed(2)}</td>
                          <td className="amt">{s.days}</td>
                          <td className="amt" style={{ fontWeight: '700' }}>{s.est_pay != null ? M(s.est_pay) : '—'}</td>
                          <td className="amt">{s.open ? <span className="pill pill-amber" style={OPEN_PILL}>{s.open} open</span> : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="muted" style={{ padding: '12px' }}>No attendance this month.</div>}
            </div>

            <div className="panel">
              <div className="panel-hd">
                <h3>Punch log</h3>
                <span className="muted" style={SMALL_MUTED}>{punches.length} records</span>
              </div>
              {punches.length ? (
                <div className="tbl-wrap">
                  <table className="bigtable">
                    <thead><tr><th>Date</th><th>Employee</th><th>In</th><th>Out</th><th className="amt">Hrs</th><th>Src</th><th></th></tr></thead>
                    <tbody>{punches.map((pu) => <PunchRow key={pu.id} p={pu} onEdit={p.onEdit} onDelete={p.onDelete} />)}</tbody>
                  </table>
                </div>
              ) : <div className="muted" style={{ padding: '12px' }}>No punches.</div>}
            </div>
          </>
        )}

      {p.editRow != null ? <EditModal {...p} /> : null}
    </>
  );
}

/** hros.html:3060. */
function PunchRow({ p, onEdit, onDelete }: { p: AttPunch; onEdit: (id: string) => void; onDelete: (id: string) => void }) {
  const e = p.hr_employees || {};
  return (
    <tr>
      <td className="muted">{String(p.work_date)}</td>
      <td>{e.name || ''}</td>
      <td>{clkTime(p.clock_in)}</td>
      <td>{p.clock_out ? clkTime(p.clock_out) : <span className="pill pill-amber" style={OPEN_PILL}>OPEN</span>}</td>
      <td className="amt">{p.hours != null ? Number(p.hours).toFixed(2) : '—'}</td>
      <td className="muted" style={SMALL_MUTED}>{p.source || ''}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <a onClick={() => onEdit(p.id)} style={{ cursor: 'pointer', color: 'var(--sky-soft)', fontSize: '11.5px' }}>edit</a> · <a onClick={() => onDelete(p.id)} style={{ cursor: 'pointer', color: 'var(--coral-soft)', fontSize: '11.5px' }}>del</a>
      </td>
    </tr>
  );
}

/**
 * `hrAttEditModal()` — hros.html:3065. The inputs are read back by id at save time, exactly as the
 * legacy `hrAttSave()` does (hros.html:3082), so they stay uncontrolled here and the page owns the read.
 * `key` on each input is what makes a re-open with a different punch reset the value.
 */
function EditModal(p: HrAttendanceProps) {
  const r = (p.editRow || {}) as AttPunch;
  const emps = p.employees || [];
  const G = ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => (
    <div style={{ marginBottom: '10px' }}>
      <label className="muted" style={{ fontSize: '11px', display: 'block', marginBottom: '3px' }}>{label}</label>
      {children}
    </div>
  );
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) p.onCloseModal(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(5,10,20,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '20px' }}>
      <div className="panel" style={{ maxWidth: '440px', width: '100%', margin: 0 }}>
        <div className="panel-hd"><h3>{r.id ? 'Edit' : 'Add'} punch</h3><button className="btn sm" onClick={p.onCloseModal}>✕</button></div>
        <G label="Employee">
          <select id="att_emp" defaultValue={r.employee_id || ''} key={r.id || 'new'} style={S}>
            <option value="">— select employee —</option>
            {emps.map((e) => <option key={e.id} value={e.id}>{(e.name || '') + ' (' + (e.emp_no || '') + ')'}</option>)}
          </select>
        </G>
        <G label="Clock in"><input type="datetime-local" id="att_in" key={'i' + (r.id || 'new')} defaultValue={dtLocal(r.clock_in)} style={S} /></G>
        <G label={<>Clock out <span style={{ opacity: '.6' }}>(blank = still working)</span></>}>
          <input type="datetime-local" id="att_out" key={'o' + (r.id || 'new')} defaultValue={dtLocal(r.clock_out)} style={S} />
        </G>
        <G label="Break (minutes)"><input type="number" id="att_break" key={'b' + (r.id || 'new')} defaultValue={Number(r.break_minutes) || 0} min="0" step="5" style={S} /></G>
        <G label="Note"><input id="att_note" key={'n' + (r.id || 'new')} defaultValue={r.note || ''} placeholder="e.g. forgot to clock out" style={S} /></G>
        <button className="btn p sm" style={{ width: '100%', marginTop: '6px' }} onClick={p.onSave}>Save punch</button>
      </div>
    </div>
  );
}
