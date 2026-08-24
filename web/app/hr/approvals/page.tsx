'use client';

// The route. Everything impure lives here — the session, the fetches, the state — so that
// src/hr-approvals.tsx stays a pure function of its props and can be diffed against the legacy golden.
// Same split as the pilot: see app/hr/access/page.tsx.

import { useCallback, useEffect, useState } from 'react';

import { showConfirm } from '../../../src/confirm';
import HrApprovals, { type ApvEmployee, type ApvStep } from '../../../src/hr-approvals';
import HrApprovalsRc, {
  rcStepFromValue, rcWfEditFrom, rcWfNew, rcWfSaveBody,
  type RcClaimType, type RcRoleApprover, type RcWorkflow, type RcWorkflowStep, type WfEdit, type WfStep,
} from '../../../src/hr-approvals-rc';
import { call, legacyUrl, token } from '../../../src/portal';
import FailedLoad from '../../../src/failed-load';

/** hros.html:1410 — the fallback company when the account has no Xero orgs. */
const PROCARE = 'I PROCARE MALAYSIA SDN BHD';

interface Company { tenant_id: string; tenant_name: string }
interface LeaveAdmin { flow?: ApvStep[]; employees?: ApvEmployee[] }
/** `hr_rc_config` — hr.ts:1970. */
interface RcConfig {
  workflows?: RcWorkflow[];
  workflow_steps?: RcWorkflowStep[];
  role_approvers?: RcRoleApprover[];
  claim_types?: RcClaimType[];
  employees?: ApvEmployee[];
}

export default function HrApprovalsPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [flow, setFlow] = useState<ApvStep[] | null>(null);
  const [employees, setEmployees] = useState<ApvEmployee[]>([]);
  const [tab, setTab] = useState<'leave' | 'rc'>('leave');
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The Reimbursement half — `APV.rc` / `APV.wfEdit`, hros.html:3535.
  const [rc, setRc] = useState<RcConfig | null>(null);
  const [wfEdit, setWfEdit] = useState<WfEdit | null>(null);
  // The workflow form is UNCONTROLLED (its `apv_wf_*` ids are the contract `hrApvWfSave()` reads it
  // back by), so a step change must re-materialise the header inputs from the synced state — which is
  // what the legacy's wholesale `hrRender()` does. Bumping this key is that re-materialisation.
  const [wfGen, setWfGen] = useState(0);

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
      // `hrApprovalsLoad()` — hros.html:3545 — makes BOTH calls. `hrApvEmps()` (hros.html:3557) then
      // prefers the leave list and falls back to the rc one, which is what the `||` below mirrors.
      const cfg = await call<RcConfig>({ api: 'hr_rc_config', tenant: pick ? pick.tenant_id : null });
      setRc(cfg);
      if (!(lv.employees || []).length) setEmployees(cfg.employees || []);
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

  /** `hrApprovalsReload()` — hros.html:3556. Only the rc half is refetched. */
  const reloadRc = useCallback(async () => {
    try {
      const cfg = await call<RcConfig>({ api: 'hr_rc_config', tenant: company ? company.tenant_id : null });
      setRc(cfg);
    } catch { /* hros.html:3556 swallows this too — the panel keeps what it has */ }
  }, [company]);

  /** `hrApvWfSyncInputs()` — hros.html:3641. Read the header inputs back before anything re-renders. */
  const wfForm = useCallback(() => {
    const gv = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
    const active = document.getElementById('apv_wf_active') as HTMLInputElement | null;
    return {
      name: gv('apv_wf_name'), scope: gv('apv_wf_scope'), min: gv('apv_wf_min'), max: gv('apv_wf_max'),
      prio: gv('apv_wf_prio'), dept: gv('apv_wf_dept'), type: gv('apv_wf_type'),
      active: active ? active.checked : undefined,
    };
  }, []);

  /** Carry the header inputs into state, exactly as `hrApvWfSyncInputs()` does, then change a step. */
  const syncThen = useCallback((change: (steps: WfStep[]) => WfStep[]) => {
    const f = wfForm();
    setWfEdit((w) => (w ? {
      ...w, name: f.name, min_amount: f.min, max_amount: f.max, priority: f.prio,
      tenant_id: f.scope === 'all' ? null : (company ? company.tenant_id : null),
      match_department: f.dept, match_claim_type_id: f.type,
      active: f.active === undefined ? w.active : f.active,
      steps: change(w.steps),
    } : w));
    setWfGen((g) => g + 1);
  }, [wfForm, company]);

  return (
    <>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <FailedLoad message={err} />
        : !flow || !company ? <Panel><span className="spin"></span> Loading approval settings…</Panel>
        : (
          <>
            {notice ? <Panel>{notice}</Panel> : null}
            <HrApprovals
              flow={flow}
              employees={employees}
              companyName={company.tenant_name}
              tab={tab}
              onTab={(t) => { setTab(t as 'leave' | 'rc'); setWfEdit(null); }}
              onLevelSet={onLevelSet}
              onLevelDel={onLevelDel}
              onLevelAdd={onLevelAdd}
              onSave={onSave}
              // `hrApvRc()` — hros.html:3592, the sibling half of this renderer. It IS migrated now, so
              // the handoff to hros.html this used to make is gone.
              rc={rc ? (
                <HrApprovalsRc
                  key={wfGen}
                  workflows={rc.workflows || []}
                  workflowSteps={rc.workflow_steps || []}
                  roleApprovers={rc.role_approvers || []}
                  claimTypes={rc.claim_types || []}
                  employees={employees}
                  wfEdit={wfEdit}
                  onWfNew={() => { setWfEdit(rcWfNew(company ? company.tenant_id : null)); setWfGen((g) => g + 1); }}
                  onWfEdit={(id) => {
                    const w = (rc.workflows || []).find((x) => x.id === id);
                    if (!w) return;   // hros.html:3626's `if(!w)return`
                    setWfEdit(rcWfEditFrom(w, rc.workflow_steps || []));
                    setWfGen((g) => g + 1);
                  }}
                  onWfOff={(id) => {
                    void (async () => {
                      if (!await showConfirm('Turn workflow off',
                        'Turn this workflow off? Claims already in flight keep their chain; new claims use another matching workflow (or Finance).',
                        'Turn off')) return;
                      try {
                        await call({ api: 'hr_rc_admin_save', kind: 'workflow_del', row: { id } });
                        setNotice('Workflow turned off');
                        await reloadRc();
                      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
                    })();
                  }}
                  onWfCancel={() => setWfEdit(null)}
                  onWfSave={() => {
                    if (!wfEdit) return;
                    void (async () => {
                      try {
                        const row = rcWfSaveBody(wfEdit.steps, wfForm(), company ? company.tenant_id : null, wfEdit.id);
                        await call({ api: 'hr_rc_admin_save', kind: 'workflow', row });
                        setNotice('Workflow saved ✓');
                        setWfEdit(null);
                        await reloadRc();
                      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
                    })();
                  }}
                  onStepSet={(i, v) => syncThen((steps) => steps.map((s, n) => (n === i ? rcStepFromValue(v, employees) : s)))}
                  onStepAdd={() => syncThen((steps) => [...steps, { approver_type: 'role', approver_role: 'hr', name: 'HR' }])}
                  onStepDel={(i) => syncThen((steps) => steps.filter((_s, n) => n !== i))}
                  onApproverAdd={(role) => {
                    // `hrApvApproverAdd(role)` — hros.html:3697. Reads `#apv_addapp_<role>` back out of
                    // the DOM by the role it sits next to, so the person lands on the level clicked.
                    const sel = document.getElementById('apv_addapp_' + role) as HTMLSelectElement | null;
                    const id = sel ? sel.value : '';
                    if (!id) { setNotice('Pick a person'); return; }
                    void (async () => {
                      try {
                        await call({ api: 'hr_rc_admin_save', kind: 'role_approver', row: { role, employee_id: id, tenant_id: company ? company.tenant_id : null } });
                        setNotice('Added');
                        await reloadRc();
                      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
                    })();
                  }}
                  onApproverDel={(id) => {
                    void (async () => {
                      try {
                        await call({ api: 'hr_rc_admin_save', kind: 'role_approver_del', row: { id } });
                        setNotice('Removed');
                        await reloadRc();
                      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
                    })();
                  }}
                />
              ) : <Panel><span className="spin"></span> Loading approval settings…</Panel>}
            />

          </>
        )}
    </>
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
