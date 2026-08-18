// HR OS · Approvals — the leave approval chain, migrated.
//
// The legacy original is `hrApprovalsRender()` at hros.html:3558 (with `hrApvLeave()` at :3572 and
// `hrApvFlowSel()` at :3565) and it is STILL THERE and still shipping; nothing was deleted. Both are
// reachable side by side (`hros.html#tab=approvals` and `/hr/approvals/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window — which is what lets
// tests/hr-approvals.parity.test.tsx render it with `renderToStaticMarkup` and diff the result against
// tests/golden/hr.approvals.html. The loading, the session and the state live in
// app/hr/approvals/page.tsx, on the other side of that line.
//
// The markup mirrors the legacy string concatenation element for element, inline `style` strings
// included. It is not "better" — it is the SAME, because the golden is the contract.
//
// SCOPE: the Reimbursement tab (`hrApvRc()`, hros.html:3592, plus the workflow form) is NOT migrated.
// The golden captures `APV.tab === 'leave'`, which is the first-paint state, and the rc half is its own
// screen's worth of markup. The tab bar is still rendered from props so the active-button class stays a
// function of state rather than a hardcode; `tab === 'rc'` renders no body here and the route says so.
//
// VIEWERS: the legacy wraps the write controls in `hrRW()` (hros.html:1374). Not reproduced, because
// hros.html:1535 bounces a viewer off this view entirely before the renderer runs — so on this screen
// `hrRW()` is always the identity function and a viewer branch here would be dead code.

import type { CSSProperties } from 'react';

/** One level of the chain — the shape `hr_leave_admin.flow` returns (hros.html:3549). */
export interface ApvStep {
  name?: string | null;
  approver_type?: string | null;
  approver_role?: string | null;
  approver_employee_id?: string | null;
}

export interface ApvEmployee {
  id: string;
  name: string;
}

export interface HrApprovalsProps {
  /** `APV.leaveFlow` — the editable copy of the saved chain. */
  flow: ApvStep[];
  /** `hrApvEmps()` — hros.html:3557. */
  employees: ApvEmployee[];
  /** `hrCompanyName()` — hros.html:4445. Chrome, so it is passed in rather than resolved here. */
  companyName: string;
  /** `APV.tab` — hros.html:3535. */
  tab: 'leave' | 'rc';
  onTab: (tab: string) => void;
  onLevelSet: (index: number, value: string) => void;
  onLevelDel: (index: number) => void;
  onLevelAdd: () => void;
  onSave: () => void;
}

/** `APV_MINI` + the `min-width` the flow select adds — hros.html:3537, 3570. */
const SEL: CSSProperties = {
  padding: '6px 8px',
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text)',
  fontSize: '12.5px',
  minWidth: '230px',
};

const TABS: [string, string][] = [['leave', '🌴 Leave approval'], ['rc', '🧾 Reimbursement approval']];

/** hros.html:3567 — which option a step is currently on. A value matching no option selects none. */
function stepValue(s: ApvStep): string {
  return s.approver_type === 'employee' ? 'emp:' + (s.approver_employee_id || '')
    : s.approver_type === 'manager' ? 'manager'
    : 'role:' + (s.approver_role || '');
}

export default function HrApprovals({ flow, employees, companyName, tab, onTab, onLevelSet, onLevelDel, onLevelAdd, onSave }: HrApprovalsProps) {
  return (
    <>
      {/* The page head is built by hrRender(), not hrApprovalsRender() — hros.html:1538. Shared chrome,
          included because it is inside the `#hr` element the golden holds. */}
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Admin</div>
          <h2 className="page-title">Approvals</h2>
          <div className="page-sub">Configure the multi-level approval chain for leave &amp; reimbursement</div>
        </div>
        <div className="page-meta">
          <span className="page-chip"><span className="dot"></span>{companyName}</span>
        </div>
      </div>

      <div>
        <div className="muted" style={{ fontSize: '12px', marginBottom: '14px', maxWidth: '660px', lineHeight: '1.55' }}>
          One place to control <b>who approves</b> — and in what order — for every leave request and expense
          claim in {companyName}. Changes apply to <b>future</b> submissions; requests already in flight keep
          their original chain.
        </div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
          {TABS.map(([id, label]) => (
            <button key={id} className={'btn sm' + (tab === id ? ' p' : '')} onClick={() => onTab(id)}>{label}</button>
          ))}
        </div>
        {tab === 'leave' ? <LeaveLevels flow={flow} employees={employees} onLevelSet={onLevelSet} onLevelDel={onLevelDel} onLevelAdd={onLevelAdd} onSave={onSave} /> : null}
      </div>
    </>
  );
}

/** hros.html:3572 */
function LeaveLevels({ flow, employees, onLevelSet, onLevelDel, onLevelAdd, onSave }: Pick<HrApprovalsProps, 'flow' | 'employees' | 'onLevelSet' | 'onLevelDel' | 'onLevelAdd' | 'onSave'>) {
  const chain = flow.length
    ? flow.map((s) => s.name || s.approver_role).join(' → ')
    : 'No levels — leave goes straight to any admin.';

  return (
    <div className="panel" style={{ maxWidth: '560px' }}>
      <div className="panel-hd">
        <h3>Leave approval levels</h3>
        <span className="muted" style={{ fontSize: '11px' }}>every leave request passes through these, in order</span>
      </div>
      <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 12px', fontSize: '12.5px', marginBottom: '14px' }}>
        Current chain: <b>{chain}</b>
      </div>
      {flow.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <span className="pill pill-neu" style={{ minWidth: '30px', textAlign: 'center' }}>{i + 1}</span>
          <select onChange={(e) => onLevelSet(i, e.target.value)} style={SEL} value={stepValue(s)}>
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
          <a onClick={() => onLevelDel(i)} style={{ cursor: 'pointer', color: 'var(--coral-soft)', fontSize: '12px' }}>remove</a>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
        <button className="btn xs" onClick={onLevelAdd}>+ Add level</button>
        <button className="btn p xs" onClick={onSave}>💾 Save leave flow</button>
      </div>
      <div className="muted" style={{ fontSize: '11px', marginTop: '10px' }}>
        Pick a specific person, the applicant’s <b>direct manager</b> (resolves per employee), or a role
        (HR / Finance / Director → whoever holds it). Set role holders in the Reimbursement tab → Role approvers.
      </div>
    </div>
  );
}
