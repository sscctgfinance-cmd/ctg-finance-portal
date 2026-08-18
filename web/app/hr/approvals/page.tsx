'use client';

// The route. Everything impure lives here — the session, the fetches, the state — so that
// src/hr-approvals.tsx stays a pure function of its props and can be diffed against the legacy golden.
// Same split as the pilot: see app/hr/access/page.tsx.

import { useCallback, useEffect, useState } from 'react';

import HrApprovals, { type ApvEmployee, type ApvStep } from '../../../src/hr-approvals';
import { call, legacyUrl, token } from '../../../src/portal';

/** hros.html:1410 — the fallback company when the account has no Xero orgs. */
const PROCARE = 'I PROCARE MALAYSIA SDN BHD';

interface Company { tenant_id: string; tenant_name: string }
interface LeaveAdmin { flow?: ApvStep[]; employees?: ApvEmployee[] }

export default function HrApprovalsPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [flow, setFlow] = useState<ApvStep[] | null>(null);
  const [employees, setEmployees] = useState<ApvEmployee[]>([]);
  const [tab, setTab] = useState<'leave' | 'rc'>('leave');
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
      const co = await call<{ companies?: Company[] }>({ api: 'hr_companies' });
      const list = co.companies || [];
      const pick = list.find((c) => c.tenant_id === saved)
        || list.find((c) => c.tenant_name === PROCARE)
        || list[0]
        || null;
      setCompany(pick);
      const lv = await call<LeaveAdmin>({ api: 'hr_leave_admin', tenant: pick ? pick.tenant_id : null });
      // hros.html:3549 keeps its own editable copy of the saved chain — editing must not mutate the
      // response, or "unsaved" and "saved" become the same object.
      setFlow((lv.flow || []).map((s) => ({
        name: s.name, approver_type: s.approver_type, approver_role: s.approver_role, approver_employee_id: s.approver_employee_id,
      })));
      setEmployees(lv.employees || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (t) void load();
  }, [load]);

  /** hros.html:3582 — the option value decides the whole step, not just its id. */
  const onLevelSet = useCallback((i: number, v: string) => {
    setFlow((f) => (f || []).map((s, n) => {
      if (n !== i) return s;
      if (v.startsWith('emp:')) {
        const id = v.slice(4);
        const e = employees.find((x) => x.id === id);
        return { name: (e && e.name) || 'Employee', approver_type: 'employee', approver_employee_id: id };
      }
      if (v === 'manager') return { name: 'Direct Manager', approver_type: 'manager', approver_role: 'manager' };
      const role = v.slice(5);
      const nm = ({ hr: 'HR', finance: 'Finance', director: 'Director / Boss' } as Record<string, string>)[role] || role;
      return { name: nm, approver_type: 'role', approver_role: role };
    }));
  }, [employees]);

  /** hros.html:3588 */
  const onLevelAdd = useCallback(() => {
    setFlow((f) => [...(f || []), employees.length
      ? { name: employees[0].name, approver_type: 'employee', approver_employee_id: employees[0].id }
      : { name: 'HR', approver_type: 'role', approver_role: 'hr' }]);
  }, [employees]);

  const onLevelDel = useCallback((i: number) => {
    setFlow((f) => (f || []).filter((_s, n) => n !== i));
  }, []);

  /** hros.html:3590 */
  const onSave = useCallback(async () => {
    try {
      await call({ api: 'hr_leave_flow_save', tenant: company ? company.tenant_id : null, steps: flow || [] });
      setNotice('Leave approval flow saved ✓');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [company, flow]);

  return (
    <div id="app" style={{ display: 'flex', minHeight: '100vh', alignItems: 'stretch' }}>
      <main style={{ flex: 1, minWidth: 0, padding: '28px 34px 64px' }}>
        <Banner />
        {signedIn === false
          ? <Panel>
              Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
              the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
              already be signed in.
            </Panel>
          : err ? <Panel>⚠️ {err}</Panel>
          : !flow || !company ? <Panel><span className="spin"></span> Loading approval settings…</Panel>
          : (
            <>
              {notice ? <Panel>{notice}</Panel> : null}
              <HrApprovals
                flow={flow}
                employees={employees}
                companyName={company.tenant_name}
                tab={tab}
                onTab={(t) => setTab(t as 'leave' | 'rc')}
                onLevelSet={onLevelSet}
                onLevelDel={onLevelDel}
                onLevelAdd={onLevelAdd}
                onSave={onSave}
              />
              {/* The Reimbursement tab is not migrated — hrApvRc() and the workflow form are their own
                  screen's worth of markup and have no golden of their own here. The tab still switches,
                  and switching to it hands the operator back to the screen that does have it. */}
              {tab === 'rc' ? (
                <Panel>
                  Reimbursement approval workflows are not migrated yet.{' '}
                  <a href={`${legacyUrl('hros.html')}#tab=approvals`}>Open them in HR OS</a>.
                </Panel>
              ) : null}
            </>
          )}
      </main>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel"><div className="muted" style={{ padding: '18px' }}>{children}</div></div>;
}

function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('hros.html')}#tab=approvals`}>hros.html · Approvals</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
