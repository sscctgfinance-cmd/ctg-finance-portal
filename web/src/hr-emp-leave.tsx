// HR OS · Leave (employee mode) — the OTHER screen behind the `leave` nav id.
//
// hros.html:1553 is `else if(HR.view==='leave') body=(HR_EMP_MODE?hrEmpLeave():hrLeave());` — one nav
// id, two screens, chosen by role. `src/hr-leave.tsx` is the admin one; this is `hrEmpLeaveRender()`
// (hros.html:3074), which is the whole of Leave for every non-admin employee — the largest population
// in the product, and mostly on a phone.
//
// Three actions, and the third is the one that is easy to miss: a line manager who is NOT HR approves
// their team's leave here and nowhere else (`hr_leave_pending` → Approve / Reject). Losing it is not
// "employees cannot apply", it is "team leave approval does not exist".
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. `todayLocalISO()`
// (hros.html:3086, the default for both date boxes) reads the clock, so it arrives as `today`. The
// impure half is app/hr/leave/page.tsx. Diffed against tests/golden/hr.leave.emp.html.
//
// The FORM IS UNCONTROLLED and keeps the legacy `lv_*` ids, because `hrEmpLeaveApply()`
// (hros.html:3104) reads it back out of the DOM by exactly those ids and the route does the same. A
// controlled port would emit `value=""` the golden does not carry, and add handlers it does not carry
// either.
//
// NOT covered by the golden, and mirrored anyway from the legacy source: the loading spinner
// (hros.html:3062), the error/retry panel (:3075) and the "No leave requests yet" empty row. The golden
// was captured loaded, with data, so the parity test reaches none of the three.

import type { CSSProperties } from 'react';

import { StepPills, type LeaveRequest, type LeaveType } from './hr-leave';

/** One row of `hr_leave_my.balances` — hr.ts:1331. */
export interface LeaveBalance {
  type?: string | null;
  code?: string | null;
  paid?: boolean | null;
  color?: string | null;
  entitled?: number | null;
  taken?: number | null;
  remaining?: number | null;
}

/** One row of `hr_leave_pending.requests` — hr.ts:1505. */
export interface PendingRequest extends LeaveRequest {
  current_step_name?: string | null;
  reason?: string | null;
}

export interface HrEmpLeaveProps {
  /** `hrCompanyName()` — chrome, passed in rather than resolved here. */
  companyName: string;
  /** `ELV.data.types` / `.balances` / `.requests` — hros.html:3076. */
  types: LeaveType[];
  balances: LeaveBalance[];
  requests: LeaveRequest[];
  /** `ELV.pending` — the approver queue. Empty ⇒ the card is not rendered at all (hros.html:3097). */
  pending: PendingRequest[];
  /** `todayLocalISO()` — hros.html reads the clock; this component must not. */
  today: string;
  /** Bumped by the route to re-mount the uncontrolled form after a successful apply. */
  formKey?: number;
  onApply: () => void;
  onCancel: (id: string) => void;
  onDecide: (id: string, decision: 'approve' | 'reject') => void;
}

/**
 * `RC_SEL` — hros.html:1782, which `hrEmpLeaveRender()` reads as `S` (hros.html:3078). Key order is the
 * serialised string, so it is the legacy declaration order.
 */
const S: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  color: 'var(--text)',
  fontSize: '13px',
};

const FINAL = ['Approved', 'Rejected', 'Cancelled'];

/** What the route reads back out of the uncontrolled `lv_*` boxes — hros.html:3105-3111. */
export interface ApplyInput {
  leave_type_id: string;
  date_from: string;
  date_to: string;
  half_day: boolean;
  reason: string;
}

/**
 * `hrEmpLeaveApply()`'s body — hros.html:3104-3111 — split out of the route the way `profileBody()` and
 * `bankFile()` were, because NO GOLDEN SEES A REQUEST BODY. Two things are proven here and nowhere else:
 *
 * 1. The three refusals, IN ORDER, with the legacy's own wording. They are the only thing between a
 *    mistyped range and a leave request the employee's balance is deducted by.
 * 2. The TARGET. `hr_leave_apply` (hr.ts:1420) resolves the employee from the TOKEN and the request
 *    carries no id, so the proof is the negative — the body names no employee and no tenant. A port
 *    that "helpfully" added `employee_id` would let anyone file leave against anyone.
 */
export function applyBody(f: ApplyInput): { error: string } | Record<string, unknown> {
  if (!f.leave_type_id) return { error: 'Select a leave type' };
  if (!f.date_from || !f.date_to) return { error: 'Pick the dates' };
  if (f.date_to < f.date_from) return { error: 'End date can\u2019t be before start' };
  return {
    api: 'hr_leave_apply',
    leave_type_id: f.leave_type_id,
    date_from: f.date_from,
    date_to: f.date_to,
    half_day: f.half_day,
    reason: f.reason,
  };
}

/** `g()` — hros.html:3081. Label above control. */
function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <label className="muted" style={{ fontSize: '11px', display: 'block', marginBottom: '3px' }}>{label}</label>
      {children}
    </div>
  );
}

export default function HrEmpLeave(props: HrEmpLeaveProps) {
  const { companyName, types, balances, requests, pending, today, formKey, onApply, onCancel, onDecide } = props;

  return (
    <>
      {/* The page head is built by hrRender() (hros.html:1544), not by the screen. HR_EMP_NAV's row for
          this view (hros.html:1491) supplies the eyebrow, the title and the sub — and they differ from
          the admin screen's, which is the visible half of "this is a different screen". */}
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Me</div>
          <h2 className="page-title">Leave</h2>
          <div className="page-sub">Apply for leave and check your balance</div>
        </div>
        <div className="page-meta">
          <span className="page-chip"><span className="dot"></span>{companyName}</span>
        </div>
      </div>

      {/* hros.html:3097 — the approver queue is rendered ONLY when something is waiting. An empty card
          would tell a manager they have an inbox they do not. */}
      {pending.length ? (
        <div className="panel" style={{ marginBottom: '14px', borderColor: 'rgba(245,158,11,.35)' }}>
          <div className="panel-hd">
            <h3>🔔 Pending your approval <span className="pill" style={{ color: 'var(--amber)', fontSize: '10px' }}>{pending.length}</span></h3>
          </div>
          <div className="tbl-wrap">
            <table className="bigtable">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>Dates</th>
                  <th className="amt">Days</th>
                  <th>Level</th>
                  <th>Reason</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((x) => (
                  <tr key={x.id}>
                    <td>{(x.hr_employees && x.hr_employees.name) || '—'}</td>
                    <td>{x.leave_type ?? ''}</td>
                    <td className="muted">{x.date_from ?? ''} → {x.date_to ?? ''}</td>
                    <td className="amt">{x.days}</td>
                    <td className="muted" style={{ fontSize: '11px' }}>{x.current_step_name || ''}</td>
                    <td className="muted" style={{ fontSize: '11px' }}>{x.reason || ''}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn xs" onClick={() => onDecide(x.id, 'approve')}>Approve</button>
                      {' '}
                      <button className="btn xs d" onClick={() => onDecide(x.id, 'reject')}>Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* hros.html:3080 — UNPAID types carry no entitlement, so `.filter(b => b.paid)` is what keeps a
          "0 left / 0" card off the screen. */}
      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', marginBottom: '14px' }}>
        {balances.filter((b) => b.paid).map((b, i) => (
          <div className="card" key={i}>
            <div className="n" style={{ color: b.color || 'var(--green-soft)' }}>{b.remaining}</div>
            <div className="l">{b.type} left <span className="muted">/ {b.entitled}</span></div>
          </div>
        ))}
      </div>

      <div className="panel" style={{ marginBottom: '14px', maxWidth: '560px' }} key={formKey}>
        <div className="panel-hd"><h3>Apply for leave</h3></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <Field label="Leave type">
            <select id="lv_type" style={S}>
              {types.map((t) => <option value={t.id} key={t.id}>{t.name}{t.paid ? '' : ' (unpaid)'}</option>)}
            </select>
          </Field>
          {/* hros.html:3083 writes the ENTITY `&nbsp;` here; the escape keeps it from looking like a stray
              space in source. parity.ts's R2 canonicalises the character back to the entity. */}
          <Field label={'\u00a0'}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', paddingTop: '7px' }}>
              <input type="checkbox" id="lv_half" style={{ accentColor: 'var(--coral)' }} /> Half day (single day)
            </label>
          </Field>
          <Field label="From"><input type="date" id="lv_from" defaultValue={today} style={S} /></Field>
          <Field label="To"><input type="date" id="lv_to" defaultValue={today} style={S} /></Field>
        </div>
        <Field label="Reason"><input id="lv_reason" placeholder="e.g. family matters" style={S} /></Field>
        <button className="btn p sm" id="lv_submit" style={{ marginTop: '4px' }} onClick={onApply}>Submit application</button>
        <div className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>Counted as working days (Mon–Fri; weekends excluded, public holidays not auto-deducted). Routed through the approval levels (e.g. Manager → HR → Director) — approvers are notified by email at each step.</div>
      </div>

      <div className="panel">
        <div className="panel-hd"><h3>My leave</h3></div>
        <div className="tbl-wrap">
          <table className="bigtable">
            <thead>
              <tr>
                <th>Type</th>
                <th>Dates</th>
                <th className="amt">Days</th>
                <th>Approval</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.length ? requests.map((x) => <MyRow key={x.id} x={x} onCancel={onCancel} />) : (
                <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '16px' }}>No leave requests yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** hros.html:3092 */
function MyRow({ x, onCancel }: { x: LeaveRequest; onCancel: (id: string) => void }) {
  const st = x.status;
  const fin = FINAL.indexOf(String(st)) >= 0;
  const col = st === 'Approved' ? 'var(--green-soft)'
    : st === 'Rejected' ? 'var(--red-soft)'
    : st === 'Cancelled' ? 'var(--muted)'
    : 'var(--amber)';

  return (
    <tr>
      <td>{x.leave_type ?? ''}</td>
      <td className="muted">{x.date_from ?? ''} → {x.date_to ?? ''}</td>
      <td className="amt">{x.days}</td>
      <td><StepPills x={x} /></td>
      <td><span className="pill" style={{ color: col, fontSize: '10px' }}>{st}</span></td>
      <td>
        {/* hros.html:3093 — an `<a>`, not a button, and only while the request is still open. Cancelling
            a decided request is what the server refuses; hiding it is what the legacy does. */}
        {!fin ? (
          <a onClick={() => onCancel(x.id)} style={{ cursor: 'pointer', color: 'var(--coral-soft)', fontSize: '11.5px' }}>cancel</a>
        ) : null}
      </td>
    </tr>
  );
}
