'use client';

// The route. Everything impure lives here — the session, the fetches, the state, the clock — so that
// src/hr-leave.tsx stays a pure function of its props and can be diffed against the legacy golden.
// Same split as the pilot: see app/hr/access/page.tsx.

import { useCallback, useEffect, useState } from 'react';

import HrLeave, {
  type LeaveApplyForm, type LeaveBalances, type LeaveEmployee, type LeaveFlowStep,
  type LeaveRequest, type LeaveType,
} from '../../../src/hr-leave';
import { showConfirm } from '../../../src/confirm';
import { mytISO } from '../../../../myt.js';
import { call, legacyUrl, token } from '../../../src/portal';

/** hros.html:1410 — the fallback company when the account has no Xero orgs. */
const PROCARE = 'I PROCARE MALAYSIA SDN BHD';
/** hros.html:1410 — the tenant that fallback resolves to. */
const HR_PROCARE_TENANT = '99911869-9e91-4572-b7dc-4db51b45b6a9';

interface Company { tenant_id: string; tenant_name: string }
interface LeaveAdmin {
  requests?: LeaveRequest[];
  employees?: LeaveEmployee[];
  leave_types?: LeaveType[];
  flow?: LeaveFlowStep[];
}

/**
 * `todayLocalISO()` — hros.html:1271, which v224 made MALAYSIAN. The clock read the component is not
 * allowed to do. It defaults the apply-on-behalf date range, so it is the first and last day of
 * somebody's leave.
 */
const todayLocalISO = (): string => mytISO(Date.now());

const BLANK_APPLY: LeaveApplyForm = {
  employee_id: '', leave_type_id: '', date_from: '', date_to: '', reason: '', half_day: false, auto_approve: true,
};

export default function HrLeavePage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [data, setData] = useState<LeaveAdmin | null>(null);
  const [flow, setFlow] = useState<LeaveFlowStep[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [today] = useState(todayLocalISO);

  const [applyOpen, setApplyOpen] = useState(false);
  const [apply, setApply] = useState<LeaveApplyForm>(BLANK_APPLY);
  const [myEmpId, setMyEmpId] = useState('');

  const [balOpen, setBalOpen] = useState(false);
  const [balEmp, setBalEmp] = useState('');
  const [balLoading, setBalLoading] = useState(false);
  const [balData, setBalData] = useState<LeaveBalances | null>(null);
  const [balEdit, setBalEdit] = useState<Record<string, { entitled?: string; taken?: string }>>({});

  const load = useCallback(async () => {
    setErr(null);
    try {
      const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
      // hros.html:1404 — a failed/empty company list is not fatal there, it falls back to I PROCARE.
      // Mirrored, because it is what makes the screen usable on an account with no Xero orgs.
      const co = await call<{ companies?: Company[] }>({ api: 'hr_companies' }).catch(() => ({ companies: [] }));
      const list = (co.companies || []).length ? co.companies! : [{ tenant_id: HR_PROCARE_TENANT, tenant_name: PROCARE }];
      const pick = list.find((c) => c.tenant_id === saved)
        || list.find((c) => c.tenant_name === PROCARE)
        || list[0]
        || null;
      setCompany(pick);
      const lv = await call<LeaveAdmin>({ api: 'hr_leave_admin', tenant: pick ? pick.tenant_id : null });
      setData(lv);
      // hros.html:3420 keeps its own editable copy of the saved chain — editing must not mutate the
      // response, or "unsaved" and "saved" become the same object.
      setFlow((lv.flow || []).map((s) => ({
        name: s.name, approver_type: s.approver_type, approver_role: s.approver_role, approver_employee_id: s.approver_employee_id,
      })));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    void load();
    // `hrMyEmpId()` (hros.html:3502) reads RC.me, loaded by hrRCBoot(). Best-effort: the apply form's
    // "whose leave is this" caption degrades to "Pick whose leave this is." without it.
    void call<{ me?: { employee?: { id?: string } } }>({ api: 'hr_rc_config' })
      .then((r) => setMyEmpId((r.me && r.me.employee && r.me.employee.id) || ''))
      .catch(() => {});
  }, [load]);

  /** hros.html:3524 — the option value decides the whole level, not just its id. */
  const onFlowSet = useCallback((i: number, v: string) => {
    const employees = (data && data.employees) || [];
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
  }, [data]);

  /** hros.html:3530 */
  const onFlowAdd = useCallback(() => {
    const employees = (data && data.employees) || [];
    setFlow((f) => [...(f || []), employees.length
      ? { name: employees[0].name, approver_type: 'employee', approver_employee_id: employees[0].id }
      : { name: 'HR', approver_type: 'role', approver_role: 'hr' }]);
  }, [data]);

  const onFlowDel = useCallback((i: number) => {
    setFlow((f) => (f || []).filter((_s, n) => n !== i));
  }, []);

  const run = useCallback(async (body: Record<string, unknown>, ok: string) => {
    try {
      await call(body);
      setNotice(ok);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [load]);

  /** hros.html:3532 */
  const onFlowSave = useCallback(() => {
    void run({ api: 'hr_leave_flow_save', tenant: company ? company.tenant_id : null, steps: flow || [] }, 'Approval flow saved ✓');
  }, [company, flow, run]);

  /**
   * hros.html:3533 — a rejection is confirmed, because it is not reversible from this screen. The legacy
   * uses the browser's `confirm()`; this now asks with the app's own dialog (src/confirm.tsx).
   */
  const onDecide = useCallback(async (id: string, decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !await showConfirm('Reject leave request', 'Reject this leave request?', 'Reject')) return;
    void run({ api: 'hr_leave_decide', id, decision }, `Leave ${decision}${decision === 'reject' ? 'ed' : 'd'} ✓`);
  }, [run]);

  /** hros.html:3499 */
  const onBalPick = useCallback(async (empId: string) => {
    setBalEmp(empId);
    setBalData(null);
    setBalEdit({});
    if (!empId) return;
    setBalLoading(true);
    try {
      setBalData(await call<LeaveBalances>({ api: 'hr_leave_my', employee_id: empId }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBalLoading(false);
  }, []);

  /** hros.html:3500 */
  const onBalSave = useCallback((typeId: string) => {
    if (!balEmp) { setErr('Pick an employee'); return; }
    const types = (balData && balData.types) || [];
    const t = types.find((x) => x.id === typeId);
    const b = ((balData && balData.balances) || []).find((x) => x.type === (t && t.name));
    const edit = balEdit[typeId] || {};
    const entitled = Number(edit.entitled ?? (b && b.entitled != null ? b.entitled : (t && t.default_days) || 0)) || 0;
    const taken = Number(edit.taken ?? ((b && b.taken) || 0)) || 0;
    void (async () => {
      try {
        await call({ api: 'hr_leave_balance_save', employee_id: balEmp, leave_type_id: typeId, year: (balData && balData.year) || undefined, entitled, taken });
        setNotice('Balance saved ✓');
        await onBalPick(balEmp);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [balData, balEdit, balEmp, onBalPick]);

  /**
   * hros.html:3510 — filing against the wrong person is silent and expensive: the request, the balance
   * deduction and the approval email all carry that person's name. Confirmed by name whenever it is not
   * the admin themselves, exactly as the legacy does.
   */
  const onApplySubmit = useCallback(async () => {
    const employees = (data && data.employees) || [];
    const emp = apply.employee_id;
    if (!emp) { setErr('Pick an employee'); return; }
    const name = (employees.find((e) => e.id === emp) || {}).name || 'this employee';
    if (emp !== myEmpId && !await showConfirm('Submit leave for someone else',
      `Submit this leave for ${name}?\n\nThis is NOT your own leave — it will be recorded against them and their balance.`, 'Submit', 'p')) return;
    if (!apply.leave_type_id) { setErr('Pick a leave type'); return; }
    const from = apply.date_from || today, to = apply.date_to || today;
    if (to < from) { setErr('End date can’t be before start'); return; }
    setApplyOpen(false);
    void run({
      api: 'hr_leave_apply', employee_id: emp, leave_type_id: apply.leave_type_id,
      date_from: from, date_to: to, half_day: apply.half_day, reason: apply.reason, auto_approve: apply.auto_approve,
    }, `Leave submitted for ${name} ✓`);
  }, [apply, data, myEmpId, run, today]);

  return (
    <>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
        : !data || !flow || !company ? <Panel><span className="spin"></span> Loading leave…</Panel>
        : (
          <>
            {notice ? <Panel>{notice}</Panel> : null}
            <HrLeave
              requests={data.requests || []}
              employees={data.employees || []}
              leaveTypes={data.leave_types || []}
              flow={flow}
              companyName={company.tenant_name}
              applyOpen={applyOpen}
              onApplyToggle={() => setApplyOpen((v) => !v)}
              onApplyClose={() => setApplyOpen(false)}
              myEmpId={myEmpId}
              today={today}
              apply={apply}
              onApplyChange={(k, v) => setApply((a) => ({ ...a, [k]: v }))}
              onApplySubmit={onApplySubmit}
              balOpen={balOpen}
              onBalToggle={() => setBalOpen((v) => !v)}
              onBalClose={() => setBalOpen(false)}
              balEmp={balEmp}
              balLoading={balLoading}
              balData={balData}
              balEdit={balEdit}
              onBalPick={(id) => void onBalPick(id)}
              onBalEdit={(id, field, value) => setBalEdit((m) => ({ ...m, [id]: { ...m[id], [field]: value } }))}
              onBalSave={onBalSave}
              onFlowSet={onFlowSet}
              onFlowDel={onFlowDel}
              onFlowAdd={onFlowAdd}
              onFlowSave={onFlowSave}
              onRefresh={() => void load()}
              onDecide={onDecide}
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
        <a href={`${legacyUrl('hros.html')}#tab=leave`}>hros.html · Leave</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
