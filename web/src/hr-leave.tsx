// HR OS · Leave — the React half of the strangler's fifth screen.
//
// The legacy original is `hrLeave()` at hros.html:3414 and `hrLeaveAdminRender()` at :3426, with
// `hrLeaveBalPanelHtml()` at :3481, `hrObWhoHtml()` at :3505 and the step pills at `hrLeaveStepPills()`
// (:3159, shared with the employee view). All of it is STILL THERE and still shipping; nothing was
// deleted. Both are reachable side by side (`hros.html#tab=leave` and `/hr/leave/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. `todayLocalISO()`
// (the default for the two date inputs) reads the clock, so it arrives as the `today` prop instead.
// That is what lets tests/hr-leave.parity.test.tsx render this with `renderToStaticMarkup` and diff the
// result against tests/golden/hr.leave.html; the loading, the session and the state live in
// app/hr/leave/page.tsx, on the other side of that line.
//
// The markup deliberately mirrors the legacy string concatenation element for element, inline `style`
// strings included. It is not "better" — it is the SAME, because the golden is the contract.
//
// NOT covered by the golden, and included anyway — the golden was captured with `LVA.applyOpen` and
// `LVA.balOpen` both false, `LVA.data` loaded and `HR_VIEWER` false, so the parity test never reaches
// any of these:
//   • the "Apply on behalf" form and the "Adjust leave balances" panel. Both toolbar buttons do nothing
//     but toggle them, so leaving them out would wire two buttons to nothing.
//   • the loading spinner and the error/retry panel (`hrLeave()`, :3415-3417).
//   • the two empty branches — "No levels" and "No leave requests".
//   • the viewer branch. Unlike Approvals, hros.html does NOT bounce a viewer off this view, so
//     `hrRW()` (hros.html:1374) is load-bearing here: it is what keeps Approve/Reject, the toolbar and
//     the flow editor away from a read-only account. Reproduced as the `viewer` prop.
// Each is mirrored from the legacy source line for line; what the parity test proves is the branch the
// golden DOES hold.

import type { CSSProperties } from 'react';

/** One step of a request's approval chain — `hrLeaveStepPills()`, hros.html:3159. */
export interface LeaveStep {
  step_order?: number | null;
  name?: string | null;
  approver_role?: string | null;
  status?: string | null;
  assignee_name?: string | null;
  decided_by_name?: string | null;
  decided_at?: string | null;
}

/** One row of `hr_leave_admin.requests` — hros.html:3475. */
export interface LeaveRequest {
  id: string;
  leave_type?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  days?: number | null;
  status?: string | null;
  current_step?: number | null;
  steps?: LeaveStep[] | null;
  hr_employees?: { name?: string | null } | null;
}

export interface LeaveEmployee {
  id: string;
  name?: string | null;
  emp_no?: string | null;
}

export interface LeaveType {
  id: string;
  code?: string | null;
  name?: string | null;
  paid?: boolean | null;
  default_days?: number | null;
}

/** One level of `LVA.flowEdit` — the editable copy of the saved chain, hros.html:3459. */
export interface LeaveFlowStep {
  name?: string | null;
  approver_type?: string | null;
  approver_role?: string | null;
  approver_employee_id?: string | null;
}

/** `hr_leave_my`, as the balance editor consumes it — hros.html:3487. */
export interface LeaveBalances {
  year?: number | string | null;
  types?: LeaveType[] | null;
  balances?: { type?: string | null; entitled?: number | null; taken?: number | null }[] | null;
}

/** The apply-on-behalf form's fields — uncontrolled `#lvob_*` inputs in the legacy, state here. */
export interface LeaveApplyForm {
  employee_id: string;
  leave_type_id: string;
  date_from: string;
  date_to: string;
  reason: string;
  half_day: boolean;
  auto_approve: boolean;
}

export interface HrLeaveProps {
  requests: LeaveRequest[];
  employees: LeaveEmployee[];
  leaveTypes: LeaveType[];
  /** `LVA.flowEdit` — hros.html:3459. */
  flow: LeaveFlowStep[];
  /** `hrCompanyName()` — chrome, so it is passed in rather than resolved here. */
  companyName: string;
  /** `HR_VIEWER` — hros.html:1372. A read-only account gets the table and nothing else. */
  viewer?: boolean;

  applyOpen: boolean;
  onApplyToggle: () => void;
  onApplyClose: () => void;
  /** `hrMyEmpId()` — hros.html:3502. Decides the caption under the employee picker. */
  myEmpId: string;
  /** `todayLocalISO()` — hros.html reads the clock; this component must not. */
  today: string;
  apply: LeaveApplyForm;
  onApplyChange: <K extends keyof LeaveApplyForm>(field: K, value: LeaveApplyForm[K]) => void;
  onApplySubmit: () => void;

  balOpen: boolean;
  onBalToggle: () => void;
  onBalClose: () => void;
  /** `LVA.balEmp` / `LVA.balLoading` / `LVA.balData` — hros.html:3411. */
  balEmp: string;
  balLoading: boolean;
  balData: LeaveBalances | null;
  /** Edits not yet saved, keyed by leave type id. Absent ⇒ the value the server gave. */
  balEdit: Record<string, { entitled?: string; taken?: string }>;
  onBalPick: (employeeId: string) => void;
  onBalEdit: (typeId: string, field: 'entitled' | 'taken', value: string) => void;
  onBalSave: (typeId: string) => void;

  onFlowSet: (index: number, value: string) => void;
  onFlowDel: (index: number) => void;
  onFlowAdd: () => void;
  onFlowSave: () => void;

  onRefresh: () => void;
  onDecide: (id: string, decision: 'approve' | 'reject') => void;
}

/** `LV_SS` — hros.html:3412. */
const LV_SS: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  color: 'var(--text)',
  fontSize: '13px',
};

/** `LV_MINI` — hros.html:3413. */
const LV_MINI: CSSProperties = {
  padding: '5px 7px',
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text)',
  fontSize: '12px',
};

/** `LV_MINI+';min-width:210px'` — hros.html:3464. Key order matters: it is the serialised string. */
const FLOW_SEL: CSSProperties = { ...LV_MINI, minWidth: '210px' };

/** `'width:82px;'+LV_MINI+';text-align:right'` — hros.html:3492. */
const BAL_INPUT: CSSProperties = { width: '82px', ...LV_MINI, textAlign: 'right' };

const FINAL = ['Approved', 'Rejected', 'Cancelled'];

/**
 * `hrDT()` — hros.html:1246. Pure UTC arithmetic with a fixed +8 offset, NOT `toLocaleString`, so it
 * needs no zone pinning in the test (unlike hr.clock) and cannot drift with the machine's timezone.
 */
export function hrDT(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
  const m = new Date(d.getTime() + 8 * 3600000);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m.getUTCMonth()];
  const hh = m.getUTCHours();
  const ap = hh < 12 ? 'am' : 'pm';
  const h12 = ((hh + 11) % 12) + 1;
  const mm = String(m.getUTCMinutes()).padStart(2, '0');
  return `${m.getUTCDate()} ${mon} ${m.getUTCFullYear()}, ${h12}:${mm}${ap}`;
}

/** hros.html:3462 — which option a level is currently on. A value matching no option selects none. */
function flowValue(s: LeaveFlowStep): string {
  return s.approver_type === 'employee' ? 'emp:' + (s.approver_employee_id || '')
    : s.approver_type === 'manager' ? 'manager'
    : 'role:' + (s.approver_role || '');
}

export default function HrLeave(props: HrLeaveProps) {
  const { requests, companyName, viewer } = props;

  return (
    <>
      {/* The page head is built by hrRender(), not hrLeaveAdminRender() — hros.html:1538. Shared chrome,
          included because it is inside the `#hr` element the golden holds. HR_NAV's row for this view
          (hros.html:1462) supplies the eyebrow, the title and the sub. */}
      <div className="page-head">
        <div>
          <div className="page-eyebrow">People</div>
          <h2 className="page-title">Leave</h2>
          <div className="page-sub">Review and approve leave requests</div>
        </div>
        <div className="page-meta">
          <span className="page-chip"><span className="dot"></span>{companyName}</span>
        </div>
      </div>

      {/* hros.html:3479 — a viewer gets the table and nothing that writes. */}
      {viewer ? null : (
        <>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <button className="btn p sm" onClick={props.onApplyToggle}>➕ Apply on behalf</button>
            <button className="btn sm" onClick={props.onBalToggle}>⚖️ Adjust leave balances</button>
          </div>
          {props.applyOpen ? <ApplyPanel {...props} /> : null}
          {props.balOpen ? <BalancePanel {...props} /> : null}
          <FlowPanel {...props} />
        </>
      )}

      <div className="panel">
        <div className="panel-hd">
          <h3>Leave requests</h3>
          <button className="btn xs" onClick={props.onRefresh}>↻</button>
        </div>
        <div className="tbl-wrap">
          <table className="bigtable">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>Dates</th>
                <th className="amt">Days</th>
                <th>Approval</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.length ? requests.map((x) => <RequestRow key={x.id} x={x} viewer={viewer} onDecide={props.onDecide} />) : (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: '20px' }}>No leave requests</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** hros.html:3475 */
function RequestRow({ x, viewer, onDecide }: { x: LeaveRequest; viewer?: boolean; onDecide: HrLeaveProps['onDecide'] }) {
  const st = x.status;
  const fin = FINAL.indexOf(String(st)) >= 0;
  const col = st === 'Approved' ? 'var(--green-soft)'
    : st === 'Rejected' ? 'var(--coral-soft)'
    : st === 'Cancelled' ? 'var(--muted)'
    : 'var(--amber)';

  return (
    <tr>
      <td>{(x.hr_employees && x.hr_employees.name) || '—'}</td>
      <td>{x.leave_type ?? ''}</td>
      <td className="muted">{x.date_from ?? ''} → {x.date_to ?? ''}</td>
      <td className="amt">{x.days}</td>
      <td><StepPills x={x} /></td>
      <td><span className="pill" style={{ color: col, fontSize: '10px' }}>{st}</span></td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {/* `hrRW()` (hros.html:1374) is why a viewer sees no decision buttons at all — not disabled ones. */}
        {!fin && !viewer ? (
          <>
            <button className="btn xs" onClick={() => onDecide(x.id, 'approve')}>Approve</button>
            {' '}
            <button className="btn xs d" onClick={() => onDecide(x.id, 'reject')}>Reject</button>
          </>
        ) : null}
      </td>
    </tr>
  );
}

/** `hrLeaveStepPills()` — hros.html:3159. Shared with the employee view; mirrored, not imported. */
function StepPills({ x }: { x: LeaveRequest }) {
  const steps = x.steps || [];
  if (!steps.length) return <span className="muted" style={{ fontSize: '10.5px' }}>—</span>;
  const cur = x.current_step || 1;
  const fin = FINAL.indexOf(String(x.status)) >= 0;

  return (
    <>
      {steps.map((s, i) => {
        const done = s.status === 'Approved';
        const rej = s.status === 'Rejected';
        const isCur = s.step_order === cur && !fin;
        const col = done ? 'var(--green-soft)' : rej ? 'var(--coral-soft)' : isCur ? 'var(--amber)' : 'var(--muted)';
        const ic = done ? '✓' : rej ? '✕' : isCur ? '⏳' : '○';

        // Tooltip shows who acted and when (Malaysia time).
        let tip = s.status || '';
        if (s.decided_at || s.decided_by_name) {
          const verb = done ? 'Approved' : rej ? 'Rejected' : 'Acted';
          tip = verb + (s.decided_by_name ? ' by ' + s.decided_by_name : '') + (s.decided_at ? ' · ' + hrDT(s.decided_at) : '');
        } else if (s.assignee_name) {
          tip = 'Awaiting ' + s.assignee_name;
        }

        const subText = (done || rej) && (s.decided_by_name || s.decided_at)
          ? (s.decided_by_name || '') + (s.decided_at ? (s.decided_by_name ? ', ' : '') + hrDT(s.decided_at) : '')
          : (s.assignee_name || '');
        const showSub = (done || rej) && (s.decided_by_name || s.decided_at) ? true : !!s.assignee_name;

        return (
          <span key={i} style={{ fontSize: '10px', color: col, marginRight: '9px', whiteSpace: 'nowrap' }} title={tip}>
            {ic}{' '}{s.name || s.approver_role || ''}
            {showSub ? <span style={{ color: 'var(--muted)' }}>{' ('}{subText}{')'}</span> : null}
          </span>
        );
      })}
    </>
  );
}

/** hros.html:3459-3473 */
function FlowPanel({ employees, flow, onFlowSet, onFlowDel, onFlowAdd, onFlowSave }: HrLeaveProps) {
  return (
    <div className="panel" style={{ marginBottom: '14px', maxWidth: '520px' }}>
      <div className="panel-hd">
        <h3>Approval flow</h3>
        <span className="muted" style={{ fontSize: '11px' }}>levels every leave request passes through</span>
      </div>
      {flow.length ? flow.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span className="muted" style={{ width: '18px' }}>{i + 1}.</span>
          <select onChange={(e) => onFlowSet(i, e.target.value)} style={FLOW_SEL} value={flowValue(s)}>
            {employees.length ? (
              <optgroup label="People">
                {employees.map((e) => <option key={e.id} value={'emp:' + e.id}>{e.name}</option>)}
              </optgroup>
            ) : null}
            <optgroup label="Roles">
              <option value="role:hr">Any HR</option>
              <option value="role:director">Any Director</option>
            </optgroup>
          </select>
          <a onClick={() => onFlowDel(i)} style={{ cursor: 'pointer', color: 'var(--coral-soft)', fontSize: '11.5px' }}>remove</a>
        </div>
      )) : (
        <div className="muted" style={{ fontSize: '12px', marginBottom: '6px' }}>No levels — leave goes straight to any admin.</div>
      )}
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button className="btn xs" onClick={onFlowAdd}>+ Add level</button>
        <button className="btn p xs" onClick={onFlowSave}>💾 Save flow</button>
      </div>
      <div className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>
        Pick a specific person (by name) for each level, or use a role — HR / Director resolve to whoever
        holds that role. Applies to future requests.
      </div>
    </div>
  );
}

/** hros.html:3428 — `<option>Name (EMP_NO)</option>`, shared by the two employee pickers. */
function EmpOptions({ employees }: { employees: LeaveEmployee[] }) {
  return <>{employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.emp_no || ''})</option>)}</>;
}

/** hros.html:3435-3455. Not reached by the golden — `LVA.applyOpen` is false at first paint. */
function ApplyPanel({ employees, leaveTypes, myEmpId, today, apply, onApplyChange, onApplyClose, onApplySubmit }: HrLeaveProps) {
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="muted" style={{ fontSize: '11px', display: 'block', marginBottom: '3px' }}>{label}</label>
      {children}
    </div>
  );

  return (
    <div className="panel" style={{ marginBottom: '14px', maxWidth: '660px' }}>
      <div className="panel-hd">
        <h3>Apply leave on behalf</h3>
        <button className="btn sm" onClick={onApplyClose}>✕ Close</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
        <Field label="Employee">
          <select id="lvob_emp" onChange={(e) => onApplyChange('employee_id', e.target.value)} style={LV_SS} value={apply.employee_id}>
            <option value="">— pick employee —</option>
            <EmpOptions employees={employees} />
          </select>
          {/* v198 (hros.html:3505): the caption that names whose leave this is. The legacy repaints it
              imperatively through `hrObWhoPaint()`; here it is simply derived from the picked id. */}
          <div id="lvob_who"><WhoCaption employees={employees} id={apply.employee_id} myEmpId={myEmpId} /></div>
        </Field>
        <Field label="Leave type">
          <select id="lvob_type" style={LV_SS} value={apply.leave_type_id} onChange={(e) => onApplyChange('leave_type_id', e.target.value)}>
            {leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}{t.paid ? '' : ' (unpaid)'}</option>)}
          </select>
        </Field>
        <Field label="From">
          <input type="date" id="lvob_from" value={apply.date_from || today} style={LV_SS} onChange={(e) => onApplyChange('date_from', e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" id="lvob_to" value={apply.date_to || today} style={LV_SS} onChange={(e) => onApplyChange('date_to', e.target.value)} />
        </Field>
      </div>
      <Field label="Reason">
        <input id="lvob_reason" placeholder="e.g. MC — clinic visit" style={LV_SS} value={apply.reason} onChange={(e) => onApplyChange('reason', e.target.value)} />
      </Field>
      <div style={{ margin: '8px 0 4px' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}>
          <input type="checkbox" id="lvob_half" style={{ accentColor: 'var(--coral)' }} checked={apply.half_day} onChange={(e) => onApplyChange('half_day', e.target.checked)} /> Half day (single date)
        </label>
      </div>
      <div style={{ margin: '4px 0 12px' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}>
          <input type="checkbox" id="lvob_auto" style={{ accentColor: 'var(--coral)' }} checked={apply.auto_approve} onChange={(e) => onApplyChange('auto_approve', e.target.checked)} /> Record as already approved &amp; deduct balance now <span className="muted">(untick to route through the approval flow)</span>
        </label>
      </div>
      <button className="btn p sm" onClick={onApplySubmit}>Submit</button>
    </div>
  );
}

/** `hrObWhoHtml()` — hros.html:3505. */
function WhoCaption({ employees, id, myEmpId }: { employees: LeaveEmployee[]; id: string; myEmpId: string }) {
  if (!id) return <div className="muted" style={{ fontSize: '10.5px', marginTop: '3px' }}>Pick whose leave this is.</div>;
  if (id === myEmpId) return <div className="muted" style={{ fontSize: '10.5px', marginTop: '3px' }}>Your own leave.</div>;
  const name = (employees.find((e) => e.id === id) || {}).name || '';
  return (
    <div style={{ fontSize: '10.5px', marginTop: '3px', color: 'var(--amber)', fontWeight: '600' }}>
      ⚠ On behalf of {name || 'another employee'} — not you.
    </div>
  );
}

/** `hrLeaveBalPanelHtml()` — hros.html:3481. Not reached by the golden; `LVA.balOpen` is false. */
function BalancePanel({ employees, balEmp, balLoading, balData, balEdit, onBalClose, onBalPick, onBalEdit, onBalSave }: HrLeaveProps) {
  const ptypes = ((balData && balData.types) || []).filter((t) => t.paid);
  const balByName: Record<string, { entitled?: number | null; taken?: number | null }> = {};
  ((balData && balData.balances) || []).forEach((b) => { if (b.type) balByName[b.type] = b; });

  return (
    <div className="panel" style={{ marginBottom: '14px', maxWidth: '660px' }}>
      <div className="panel-hd">
        <h3>Adjust leave balances</h3>
        <button className="btn sm" onClick={onBalClose}>✕ Close</button>
      </div>
      <div style={{ marginBottom: '10px' }}>
        <label className="muted" style={{ fontSize: '11px', display: 'block', marginBottom: '3px' }}>Employee</label>
        <select onChange={(e) => onBalPick(e.target.value)} style={LV_SS} value={balEmp}>
          <option value="">— pick an employee —</option>
          <EmpOptions employees={employees} />
        </select>
      </div>
      {balLoading ? (
        <div className="muted" style={{ fontSize: '12px', padding: '8px' }}><span className="spin"></span> Loading…</div>
      ) : balData ? (
        <>
          <div className="tbl-wrap">
            <table className="bigtable">
              <thead>
                <tr><th>Leave type</th><th>Entitled (days)</th><th>Taken (days)</th><th></th></tr>
              </thead>
              <tbody>
                {ptypes.map((t) => {
                  const b = balByName[String(t.name)] || {};
                  const ent = b.entitled != null ? b.entitled : (t.default_days || 0);
                  const tk = b.taken || 0;
                  const edit = balEdit[t.id] || {};
                  return (
                    <tr key={t.id}>
                      <td>{t.name} <span className="muted" style={{ fontSize: '10px' }}>{t.code || ''}</span></td>
                      <td><input id={'bal_ent_' + t.id} type="number" step="0.5" min="0" value={edit.entitled ?? String(ent)} style={BAL_INPUT} onChange={(e) => onBalEdit(t.id, 'entitled', e.target.value)} /></td>
                      <td><input id={'bal_tk_' + t.id} type="number" step="0.5" min="0" value={edit.taken ?? String(tk)} style={BAL_INPUT} onChange={(e) => onBalEdit(t.id, 'taken', e.target.value)} /></td>
                      <td><button className="btn xs p" onClick={() => onBalSave(t.id)}>Save</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ fontSize: '11px', marginTop: '6px' }}>
            Set entitlement or correct the taken count for Annual, Medical (MC), Emergency, etc. Year: {balData.year || ''}.
          </div>
        </>
      ) : (
        <div className="muted" style={{ fontSize: '12px', padding: '4px 0' }}>Pick an employee to view &amp; edit their balances.</div>
      )}
    </div>
  );
}
