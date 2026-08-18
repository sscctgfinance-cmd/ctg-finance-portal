// HR OS · Access & Roles — the React half of the strangler's first screen.
//
// The legacy original is `hrAccessRender()` at hros.html:1576 and it is STILL THERE and still shipping;
// nothing was deleted. Both are reachable side by side (`hros.html#tab=access` and `/hr/access/`), which
// is the point of a pilot.
//
// This file is a PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window. That is what lets
// tests/hr-access.parity.test.tsx render it with `renderToStaticMarkup` and diff the result against
// tests/golden/hr.access.html, the committed baseline captured from the legacy renderer. The data
// loading and the session live in app/hr/access/page.tsx, on the other side of that line.
//
// The markup deliberately mirrors the legacy string concatenation element for element, including the
// inline `style` strings. It is not "better" — it is the SAME, because the golden is the contract and a
// tidy-up is a diff. Restyling this screen is a later, separate, visible change.

import type { CSSProperties, ReactNode } from 'react';

export interface HrUser {
  id: string;
  email?: string | null;
  name?: string | null;
  role: string;
  self?: boolean;
  employee?: string | null;
  company_count?: number;
  all_companies?: boolean;
  can_edit?: boolean;
}

export interface HrEmpCandidate {
  id: string;
  name: string;
  emp_no?: string | null;
  email?: string | null;
}

/** The `hr_users_list` response, as the legacy screen consumes it. */
export interface HrUsersList {
  users?: HrUser[];
  employee_candidates?: HrEmpCandidate[];
}

/** The invite form's own state — `HRA.role/emp/email/name` at hros.html:1558. */
export interface InviteState {
  role: string;
  emp: string;
  email: string;
  name: string;
}

export interface HrAccessProps {
  data: HrUsersList;
  /** `hrCompanyName()` — hros.html:4445. Chrome, so it is passed in rather than resolved here. */
  companyName: string;
  invite: InviteState;
  onRoleChange: (userId: string, role: string) => void;
  onInviteRoleChange: (role: string) => void;
  onPickEmployee: (employeeId: string) => void;
  onInvite: () => void;
}

/** hros.html:1559 */
function roleLabel(r: string): string {
  return r === 'admin' ? 'Master Admin'
    : r === 'hr_admin' ? 'HR Admin'
    : r === 'viewer' ? 'Viewer'
    : r === 'approver' ? 'Approver'
    : r === 'employee' ? 'Employee'
    : r;
}

/** hros.html:1560 */
function RolePill({ role }: { role: string }) {
  const c = role === 'admin' ? 'pill-ok' : role === 'hr_admin' ? 'pill-warn' : role === 'viewer' ? 'pill-info' : 'pill-neu';
  return <span className={`pill ${c}`}>{roleLabel(role)}</span>;
}

/**
 * `ic(name, size)` — hros.html:1241, with the two icon paths this screen uses (hros.html:1238-1239).
 * Only these two are inlined: a general icon module is the HR OS migration's job, not the pilot's, and
 * copying 40 unused paths here now would be 40 things to keep in sync for no caller.
 */
const ICONS: Record<string, ReactNode> = {
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
};

function Ic({ name, size = 18 }: { name: string; size?: number }) {
  const d = ICONS[name];
  if (!d) return null;
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
  );
}

/** The legacy `S` control style — hros.html:1578. Same declarations, same order, so the same string. */
const S: CSSProperties = {
  padding: '6px 9px',
  background: 'var(--panel-2)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--r-sm)',
  color: 'var(--text)',
  fontSize: '12px',
};

const LABEL: CSSProperties = { fontSize: '11px', display: 'block', marginBottom: '3px' };
const PILL_SM: CSSProperties = { fontSize: '9px' };

const INVITE_ROLES: [string, string][] = [
  ['employee', 'Employee (own payslips, leave & claims)'],
  ['hr_admin', 'HR Admin (full HR, no Finance)'],
  ['viewer', 'Viewer (read-only)'],
  ['admin', 'Master Admin (full control)'],
];

export default function HrAccess({ data, companyName, invite, onRoleChange, onInviteRoleChange, onPickEmployee, onInvite }: HrAccessProps) {
  const users = data.users || [];
  const cands = data.employee_candidates || [];
  const isEmp = (invite.role || 'employee') === 'employee';

  return (
    <>
      {/* The page head is built by hrRender(), not hrAccessRender() — hros.html:1537. It is shared chrome,
          and report.md §3.5 is explicit that during the transition the chrome is re-implemented in each
          world rather than shared. Included here because it is inside the `#hr` element the golden holds,
          so leaving it out would mean diffing against an arbitrary slice instead of a whole named target. */}
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Admin</div>
          <h2 className="page-title">Access &amp; Roles</h2>
          <div className="page-sub">Manage who can sign in to HR OS and their access level</div>
        </div>
        <div className="page-meta">
          <span className="page-chip"><span className="dot"></span>{companyName}</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hd"><h3>Users &amp; access ({users.length})</h3></div>
        <div className="muted" style={{ fontSize: '11.5px', marginBottom: '10px', lineHeight: '1.55' }}>
          <b><Ic name="shield" size={13} /> Master Admin</b> = full control incl. managing users. &nbsp;
          <b><Ic name="shield" size={13} /> HR Admin</b> = full HR management (no user management, no Finance Portal). &nbsp;
          <b><Ic name="eye" size={13} /> Viewer</b> = sees everything but changes nothing. HR Admin, Viewer &amp; Employee
          logins have <b>no access to the Finance Portal</b>. You can’t change the last Master Admin, or your own role here.
        </div>
        <div className="tbl-wrap">
          <table className="bigtable">
            <thead><tr><th>Name</th><th>Email</th><th>Access role</th><th>HR employee</th></tr></thead>
            <tbody>
              {users.length === 0
                ? <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: '16px' }}>No users</td></tr>
                : users.map((u) => <UserRow key={u.id} u={u} onRoleChange={onRoleChange} />)}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ maxWidth: '580px' }}>
        <div className="panel-hd"><h3>Invite a user</h3></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
          <div>
            <label className="muted" style={LABEL}>
              Email{isEmp ? <>{' '}<span style={{ fontSize: '10px' }}>(from their record — override if needed)</span></> : null}
            </label>
            <input key={invite.email} id="hra_email" defaultValue={invite.email || ''} placeholder="name@company.com" style={{ ...S, width: '100%' }} />
          </div>
          <div>
            <label className="muted" style={LABEL}>Name</label>
            <input key={invite.name} id="hra_name" defaultValue={invite.name || ''} disabled={isEmp} placeholder="Full name"
              style={isEmp ? { ...S, width: '100%', opacity: '.6' } : { ...S, width: '100%' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
          <div style={{ flex: '1' }}>
            <label className="muted" style={LABEL}>Access role</label>
            <select id="hra_role" onChange={(e) => onInviteRoleChange(e.target.value)} style={{ ...S, width: '100%' }}
              value={invite.role || 'employee'}>
              {INVITE_ROLES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </div>
          <button className="btn p sm" onClick={onInvite}>Create login</button>
        </div>

        {/* hros.html:1600 — an Employee login must be LINKED to their hr_employees row, so for that role
            the operator picks the person instead of typing an address. Not rendered for any other role. */}
        {isEmp ? (
          <div style={{ marginTop: '10px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '9px', padding: '10px 12px' }}>
            <label className="muted" style={LABEL}>Which employee?</label>
            {cands.length ? (
              <>
                <select id="hra_emp" onChange={(e) => onPickEmployee(e.target.value)} style={{ ...S, width: '100%' }} value={invite.emp || ''}>
                  <option value="">— pick an employee —</option>
                  {cands.map((e) => (
                    <option key={e.id} value={e.id} data-email={e.email || ''}>
                      {(e.emp_no ? e.emp_no + ' — ' : '') + e.name + (e.email ? '' : '  (no email on file)')}
                    </option>
                  ))}
                </select>
                <div className="muted" style={{ fontSize: '10.5px', marginTop: '5px' }}>
                  Only active staff in this company who don’t have a login yet. Their login is tied to their record,
                  so payslips, leave and claims all resolve to them.
                </div>
              </>
            ) : (
              <div className="muted" style={{ fontSize: '12px' }}>
                Everyone active in this company already has a login. Add the employee under <b>Employees</b> first,
                or switch company at the top left.
              </div>
            )}
          </div>
        ) : null}

        <div className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>
          Creates an HR OS login and shows a one-time password to share. Only <b>Master Admin</b> can also open the Finance Portal.
        </div>
      </div>
    </>
  );
}

function UserRow({ u, onRoleChange }: { u: HrUser; onRoleChange: (userId: string, role: string) => void }) {
  // hros.html:1583 — an account spanning more than the selected company is flagged, and one reaching
  // beyond the caller's own access is read-only: its role is group-wide, so editing it here would
  // silently change that person's access in a company you can't see.
  const scopeTag = u.all_companies
    ? <>{' '}<span className="pill pill-neu" style={PILL_SM}>all companies</span></>
    : (u.company_count && u.company_count > 1
      ? <>{' '}<span className="pill pill-neu" style={PILL_SM}>{u.company_count} companies</span></>
      : null);
  const locked = u.can_edit === false;

  return (
    <tr>
      <td>
        <b>{u.name || '—'}</b>
        {u.self ? <>{' '}<span className="pill pill-neu" style={PILL_SM}>you</span></> : null}
        {scopeTag}
      </td>
      <td className="muted">{u.email || ''}</td>
      <td>
        {(u.self || locked)
          ? <RolePill role={u.role} />
          : (
            <select onChange={(e) => onRoleChange(u.id, e.target.value)} style={S} value={u.role}>
              {['admin', 'hr_admin', 'viewer', 'approver', 'employee'].map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
          )}
        {locked && !u.self ? <>{' '}<span className="muted" style={{ fontSize: '10px' }}>· outside your access</span></> : null}
      </td>
      <td className="muted">{u.employee || '—'}</td>
    </tr>
  );
}
