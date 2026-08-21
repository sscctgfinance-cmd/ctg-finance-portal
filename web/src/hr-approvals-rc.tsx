// HR OS · Approvals — the REIMBURSEMENT tab (`APV.tab === 'rc'`) and its workflow form.
//
// A SIBLING PAGE inside a migrated screen. `hrApprovalsRender()` (hros.html:3558) dispatches on
// `APV.tab`: web/src/hr-approvals.tsx migrated the LEAVE half (which is what the golden captured) and
// handed this half back to `hros.html#tab=approvals`. This file closes that handoff. `hrApvRc()`
// (hros.html:3592) and `hrApvWfForm()` (hros.html:3659) are STILL THERE and still shipping.
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. The
// `hr_rc_config` load and the `hr_rc_admin_save` POSTs live in app/hr/approvals/page.tsx.
//
// ── NO GOLDEN HOLDS THIS TAB ──────────────────────────────────────────────────────────────────────
// `tests/golden/hr.approvals.html` was captured at `APV.tab === 'leave'` — the first-paint state
// (hros.html:3535) — so there is no committed baseline for this half. Its test is therefore structural:
// what each control is BOUND to, what each POST body carries, and the legacy expressions read out of
// `hros.html` at run time wherever a claim about the legacy is made.
//
// ── WHAT THIS SCREEN ACTUALLY DECIDES ─────────────────────────────────────────────────────────────
// Not one ringgit is approved here — but every ringgit approved anywhere in Reimbursement is approved
// by WHOEVER THIS SCREEN NAMES. A workflow switched off, a step bound to the wrong row, a role
// approver removed by the wrong id, or `approver_type` written as `'employee'` instead of `'user'` all
// end the same way: a claim routed to a single fallback approver, or to a person who was never meant
// to see it. None of that is visible on the claim. Every binding below is asserted by id in the
// screen's own test, and the four wiring mistakes are driven as their own cases.
//
// ── `approver_type` IS `'user'` HERE AND `'employee'` ON THE LEAVE TAB ────────────────────────────
// `hrApvWfStepSet()` (hros.html:3651) writes `approver_type:'user'`; `hrApvLeaveSet()` (hros.html:3582)
// writes `'employee'` for the same option value. `stepEligibleApprovers` (hr.ts:258 onward) resolves
// them separately, so copying the leave half's spelling into a reimbursement step silently drops the
// named person and falls through to the role. `rcStepFromValue()` below is the reimbursement one, and
// the test pins BOTH spellings out of hros.html so the two cannot converge by accident.
//
// ── VIEWERS ───────────────────────────────────────────────────────────────────────────────────────
// The legacy wraps the write controls in `hrRW()` (hros.html:1374). Not reproduced, for the reason
// hr-approvals.tsx already gives: hros.html:1535 bounces a viewer off this view before the renderer
// runs, AND `hrApprovals()` itself (hros.html:3539) returns an empty panel for one. On this screen
// `hrRW()` is the identity function and a viewer branch here would be dead code.
//
// ── ARITHMETIC ────────────────────────────────────────────────────────────────────────────────────
// None to lift. `hr_rc_admin_save` (hr.ts:2645 onward) stores the row it is handed and re-derives
// nothing, but nothing here is COMPUTED either: the amount range is two numbers the operator types and
// the chain is a list of names. `rcRange()` is a display format, not a formula.

import type { CSSProperties } from 'react';

/** One row of `hr_rc_config.workflows` — hr.ts:1970. */
export interface RcWorkflow {
  id: string;
  name?: string | null;
  /** `null` means "all companies"; a tenant id means this company only. */
  tenant_id?: string | null;
  min_amount?: number | string | null;
  max_amount?: number | string | null;
  priority?: number | null;
  active?: boolean | null;
  match_department?: string | null;
  match_claim_type_id?: string | null;
}

/** One row of `hr_rc_config.workflow_steps`. */
export interface RcWorkflowStep {
  id?: string;
  workflow_id: string;
  step_order: number;
  name?: string | null;
  approver_type?: string | null;
  approver_role?: string | null;
  approver_employee_id?: string | null;
}

/** One row of `hr_rc_config.role_approvers` — `hr_claim_role_approvers.*` (hr.ts:1966). */
export interface RcRoleApprover {
  id: string;
  role?: string | null;
  employee_id?: string | null;
}

export interface RcClaimType { id: string; name?: string | null }
export interface ApvEmployee { id: string; name: string }

/** A step as the workflow FORM holds it — `APV.wfEdit.steps[i]`, hros.html:3627. */
export interface WfStep {
  name?: string | null;
  approver_type?: string | null;
  approver_role?: string | null;
  approver_employee_id?: string | null;
}

/** `APV.wfEdit` — hros.html:3625 (`hrApvWfNew`) and :3628 (`hrApvWfEdit`). */
export interface WfEdit {
  id: string | null;
  name: string;
  tenant_id: string | null;
  min_amount: string | number;
  max_amount: string | number;
  priority: string | number;
  active: boolean;
  match_department: string;
  match_claim_type_id: string;
  steps: WfStep[];
}

/**
 * `roles` — hros.html:3617. Manager and Finance were RETIRED by the operator and are deliberately not
 * offered; the comment on that line says so. Re-adding one hands a level to a role no holder is
 * assigned for, which falls through to "an admin approves this level".
 */
export const RC_ROLES: [string, string][] = [['hr', 'HR'], ['director', 'Director / Boss']];

/** `APV_S` — hros.html:3536. */
const APV_S = 'width:100%;padding:8px 10px;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px';
/** `APV_MINI` — hros.html:3537. */
const APV_MINI = 'padding:6px 8px;background:var(--panel-2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12.5px';

function st(css: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const part of css.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const key = name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase());
    out[key] = part.slice(at + 1).trim();
  }
  return out as CSSProperties;
}

/**
 * `rng` — hros.html:3599. `'RM' + min + ('–' + max | '+')`.
 *
 * A DISPLAY format, not a formula: it is the only place an operator sees which band a workflow claims,
 * and `min_amount` falsy — including a real 0 — prints as 0, which is the legacy behaviour and is
 * correct for a floor.
 */
export function rcRange(w: RcWorkflow): string {
  return 'RM' + (w.min_amount || 0) + (w.max_amount != null ? ('–' + w.max_amount) : '+');
}

/** `chain` — hros.html:3598 and again at :3665. A step with no name falls back to its role. */
export function rcChain(steps: WfStep[] | RcWorkflowStep[]): string {
  return (steps || []).map((s) => s.name || s.approver_role).join(' → ') || '—';
}

/** `stepsByWf` + the sort — hros.html:3595, :3597. `step_order` is the chain, so it is never assumed. */
export function rcStepsFor(workflowId: string, all: RcWorkflowStep[]): RcWorkflowStep[] {
  return (all || []).filter((s) => s.workflow_id === workflowId).sort((a, b) => a.step_order - b.step_order);
}

/**
 * `wfWarn` — hros.html:3609. THE loud one, and the reason it is a named function rather than a ternary
 * inline: workflows configured but ALL switched off means every new claim quietly drops to a
 * SINGLE-approver fallback, with the multi-level chain the operator designed sitting right there
 * looking configured. Nothing on the claim says so.
 */
export type RcWarning = { kind: 'all-off'; count: number } | { kind: 'none' } | null;
export function rcWarning(workflows: RcWorkflow[]): RcWarning {
  const all = workflows || [];
  const on = all.filter((w) => w.active);
  if (all.length && !on.length) return { kind: 'all-off', count: all.length };
  if (!all.length) return { kind: 'none' };
  return null;
}

/** `hrApvWfStepSel()` / `hrApvFlowSel()` — which option a step is currently on (hros.html:3635). */
export function rcStepValue(s: WfStep): string {
  return s.approver_type === 'user' ? 'emp:' + (s.approver_employee_id || '')
    : s.approver_type === 'manager' ? 'manager'
    : 'role:' + (s.approver_role || '');
}

/**
 * `hrApvWfStepSet(i, v)` — hros.html:3651. The option value decides the WHOLE step, not just its id.
 *
 * `approver_type:'user'`, NOT `'employee'`. See the header: the leave tab spells the same choice
 * differently and the server resolves the two apart.
 */
export function rcStepFromValue(v: string, employees: ApvEmployee[]): WfStep {
  if (v && v.indexOf('emp:') === 0) {
    const id = v.slice(4);
    const e = (employees || []).find((x) => x.id === id);
    return { approver_type: 'user', approver_employee_id: id, name: (e && e.name) || 'Employee' };
  }
  if (v === 'manager') return { approver_type: 'manager', approver_role: 'manager', name: 'Direct Manager' };
  const role = v.slice(5);
  const nm = ({ hr: 'HR', finance: 'Finance', director: 'Director / Boss' } as Record<string, string>)[role] || role;
  return { approver_type: 'role', approver_role: role, name: nm };
}

/** `hrApvWfNew()` — hros.html:3625, field for field. */
export function rcWfNew(tenant: string | null): WfEdit {
  return {
    id: null, name: '', tenant_id: tenant, min_amount: '', max_amount: '', priority: 10, active: true,
    match_department: '', match_claim_type_id: '',
    steps: [{ approver_type: 'role', approver_role: 'finance', name: 'Finance' }],
  };
}

/**
 * `hrApvWfEdit(id)` — hros.html:3626.
 *
 * A workflow with no steps on file opens with a single Finance step, exactly as the legacy's
 * `(st.length ? st : [...])` does — an empty chain would save as "no approvers" and the claim would
 * fall through to the same fallback the warning above is about.
 */
export function rcWfEditFrom(w: RcWorkflow, allSteps: RcWorkflowStep[]): WfEdit {
  const steps: WfStep[] = rcStepsFor(w.id, allSteps).map((s) => ({
    approver_type: s.approver_type || 'role', approver_role: s.approver_role,
    approver_employee_id: s.approver_employee_id, name: s.name,
  }));
  return {
    id: w.id, name: w.name || '', tenant_id: w.tenant_id ?? null,
    min_amount: w.min_amount == null ? '' : w.min_amount,
    max_amount: w.max_amount == null ? '' : w.max_amount,
    priority: w.priority || 0, active: w.active !== false,
    match_department: w.match_department || '', match_claim_type_id: w.match_claim_type_id || '',
    steps: steps.length ? steps : [{ approver_type: 'role', approver_role: 'finance', name: 'Finance' }],
  };
}

/** What the workflow form's `apv_wf_*` inputs read back as — the route hands these in. */
export interface WfFormValues {
  name: string; scope: string; min: string; max: string; prio: string; dept: string; type: string;
  /** `(document.getElementById('apv_wf_active')||{}).checked !== false` — a MISSING box is ACTIVE. */
  active: boolean | undefined;
}

/**
 * The `{api:'hr_rc_admin_save', kind:'workflow', row}` body — `hrApvWfSave()`, hros.html:3682.
 *
 * No golden sees a request body, and this one decides who approves money. Five rules live only here:
 *  · a blank name and an empty step list are REFUSED (the legacy toasts and returns; this throws);
 *  · `tenant_id` is `null` for scope 'all' and the CURRENT tenant otherwise — get it backwards and a
 *    company-specific chain silently governs every company, or vice versa;
 *  · a blank min is 0 and a blank max is `null` ("no cap") — a blank max coerced to 0 would make the
 *    workflow match nothing and every claim fall to the fallback;
 *  · `active` defaults to TRUE when the checkbox is missing (`!== false`), which is the legacy;
 *  · each step is reduced to the four fields the server stores, with `null` (not `undefined`) for the
 *    two ids, because `undefined` is dropped by JSON.stringify and the column would keep its old value.
 */
export function rcWfSaveBody(steps: WfStep[], f: WfFormValues, tenant: string | null, id: string | null) {
  const name = (f.name || '').trim();
  if (!name) throw new Error('Give the workflow a name');
  if (!steps || !steps.length) throw new Error('Add at least one approval step');
  return {
    id: id || undefined,
    name,
    tenant_id: f.scope === 'all' ? null : tenant,
    min_amount: f.min === '' ? 0 : Number(f.min),
    max_amount: f.max === '' ? null : Number(f.max),
    priority: Number(f.prio) || 0,
    active: f.active !== false,
    match_department: (f.dept || '').trim() || null,
    match_claim_type_id: f.type || null,
    steps: steps.map((s) => ({
      name: s.name, approver_type: s.approver_type,
      approver_role: s.approver_role || null, approver_employee_id: s.approver_employee_id || null,
    })),
  };
}

export interface HrApprovalsRcProps {
  workflows: RcWorkflow[];
  workflowSteps: RcWorkflowStep[];
  roleApprovers: RcRoleApprover[];
  claimTypes: RcClaimType[];
  employees: ApvEmployee[];
  /** `APV.wfEdit` — non-null replaces both panels with the form (hros.html:3593). */
  wfEdit: WfEdit | null;
  onWfNew: () => void;
  onWfEdit: (id: string) => void;
  /** `hrApvWfDel(id)` — hros.html:3696. Turns a workflow OFF; it does not delete it. */
  onWfOff: (id: string) => void;
  onWfCancel: () => void;
  onWfSave: () => void;
  onStepSet: (index: number, value: string) => void;
  onStepAdd: () => void;
  onStepDel: (index: number) => void;
  /** `hrApvApproverAdd(role)` — hros.html:3697. Reads `#apv_addapp_<role>` back out of the DOM. */
  onApproverAdd: (role: string) => void;
  /** `hrApvApproverDel(id)` — hros.html:3698. The id is the ROLE-APPROVER row's, not the employee's. */
  onApproverDel: (id: string) => void;
}

/** `hrApvWfStepSel()` — hros.html:3634, and byte for byte the option set `hrApvFlowSel()` offers. */
function StepSelect({ value, employees, onChange }: { value: string; employees: ApvEmployee[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={st(APV_MINI + ';min-width:230px')}>
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
  );
}

/** `g(l, el)` — hros.html:3662. */
function G({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="muted" style={st('font-size:11px;display:block;margin-bottom:3px')}>{label}</label>
      {children}
    </div>
  );
}

/**
 * `hrApvWfForm()` — hros.html:3659.
 *
 * UNCONTROLLED, with every legacy `apv_wf_*` element id kept: `hrApvWfSyncInputs()` (hros.html:3641)
 * and `hrApvWfSave()` (hros.html:3683) read this form back out of the DOM by exactly those ids, and the
 * route does the same. A field that loses its id saves as blank — here that is a workflow whose amount
 * band collapses to RM0–0 and therefore matches nothing, with the chain still on screen.
 *
 * The STEPS are state, not DOM: the legacy syncs the header inputs into `APV.wfEdit` before every step
 * change for exactly that reason (its own comment, hros.html:3639), and the route re-mounts this form
 * on a step change so the header inputs come back from the synced state.
 */
function WfForm(p: HrApprovalsRcProps & { wfEdit: WfEdit }) {
  const w = p.wfEdit;
  return (
    <div className="panel" style={st('max-width:640px')}>
      <div className="panel-hd"><h3>{w.id ? 'Edit workflow' : 'New workflow'}</h3>
        <button className="btn sm" onClick={p.onWfCancel}>✕ Close</button></div>
      <div style={st('display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px')}>
        <G label="Workflow name">
          <input id="apv_wf_name" defaultValue={w.name} placeholder="e.g. Claims above RM1,000" style={st(APV_S)} />
        </G>
        <G label="Applies to">
          <select id="apv_wf_scope" defaultValue={w.tenant_id ? 'tenant' : 'all'} style={st(APV_S)}>
            <option value="tenant">This company only</option>
            <option value="all">All companies</option>
          </select>
        </G>
        <G label="Min amount (RM)">
          <input id="apv_wf_min" type="number" step="0.01" defaultValue={String(w.min_amount)} placeholder="0" style={st(APV_S)} />
        </G>
        <G label="Max amount (RM, blank = no cap)">
          <input id="apv_wf_max" type="number" step="0.01" defaultValue={String(w.max_amount)} placeholder="∞" style={st(APV_S)} />
        </G>
        <G label="Only for claim type">
          <select id="apv_wf_type" defaultValue={w.match_claim_type_id ? String(w.match_claim_type_id) : ''} style={st(APV_S)}>
            <option value="">any type</option>
            {(p.claimTypes || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </G>
        <G label="Only for department (blank = any)">
          <input id="apv_wf_dept" defaultValue={w.match_department} placeholder="any" style={st(APV_S)} />
        </G>
        <G label="Priority (higher wins)">
          <input id="apv_wf_prio" type="number" defaultValue={String(w.priority)} style={st(APV_S)} />
        </G>
        <G label={' '}>
          <label style={st('display:inline-flex;align-items:center;gap:7px;font-size:13px;padding-top:8px')}>
            <input type="checkbox" id="apv_wf_active" defaultChecked={w.active} style={st('accent-color:var(--coral)')} /> Active
          </label>
        </G>
      </div>
      <div className="muted" style={st('font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px')}>Approval steps (in order)</div>
      <div style={st('background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:12.5px;margin-bottom:12px')}>Chain: <b>{rcChain(w.steps)}</b></div>
      {(w.steps || []).map((s, i) => (
        <div key={i} style={st('display:flex;align-items:center;gap:10px;margin-bottom:8px')}>
          <span className="pill pill-neu" style={st('min-width:30px;text-align:center')}>{i + 1}</span>
          <StepSelect value={rcStepValue(s)} employees={p.employees} onChange={(v) => p.onStepSet(i, v)} />
          {/* hros.html:3664 — the LAST step carries no remove link. A chain of zero steps saves as
              "no approvers", which is the single-approver fallback all over again. */}
          {w.steps.length > 1
            ? <a onClick={() => p.onStepDel(i)} style={st('cursor:pointer;color:var(--coral-soft);font-size:12px')}>remove</a>
            : null}
        </div>
      ))}
      <div style={st('display:flex;gap:8px;margin-top:6px')}><button className="btn xs" onClick={p.onStepAdd}>+ Add step</button></div>
      <div style={st('margin-top:16px;display:flex;gap:8px')}>
        <button className="btn p sm" onClick={p.onWfSave}>💾 Save workflow</button>
        <button className="btn sm" onClick={p.onWfCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** `hrApvRc()` — hros.html:3592. */
export default function HrApprovalsRc(props: HrApprovalsRcProps) {
  if (props.wfEdit) return <WfForm {...props} wfEdit={props.wfEdit} />;

  const warn = rcWarning(props.workflows);
  const empName = (id: string | null | undefined) => {
    const e = props.employees.find((x) => x.id === id);
    return e ? e.name : id;
  };
  const byRole: Record<string, RcRoleApprover[]> = {};
  for (const a of props.roleApprovers || []) {
    const k = String(a.role);
    (byRole[k] = byRole[k] || []).push(a);
  }

  return (
    <>
      <div className="panel" style={st('margin-bottom:14px')}>
        <div className="panel-hd"><h3>Reimbursement approval workflows</h3>
          <button className="btn p sm" onClick={props.onWfNew}>+ New workflow</button></div>
        {warn && warn.kind === 'all-off'
          ? <div style={st('background:rgba(245,158,11,.14);border:1px solid var(--amber);border-radius:10px;padding:10px 13px;margin-bottom:10px;font-size:12.5px;color:var(--amber)')}>
              <b>⚠ No workflow is active.</b> You have {warn.count} workflow(s) configured but all are switched <b>off</b>, so every new claim uses a <b>single-approver fallback</b> — your multi-level chain is not being applied. Switch one on below.
            </div>
          : warn && warn.kind === 'none'
            ? <div style={st('background:rgba(245,158,11,.10);border:1px solid var(--amber);border-radius:10px;padding:10px 13px;margin-bottom:10px;font-size:12.5px;color:var(--amber)')}>
                <b>⚠ No approval workflow.</b> Claims use a single-approver fallback. Add a workflow to require more than one approver.
              </div>
            : null}
        <div className="tbl-wrap"><table className="bigtable">
          <thead><tr><th>Workflow</th><th>Amount</th><th>Approval chain</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(props.workflows || []).length
              ? props.workflows.map((w) => (
                <tr key={w.id}>
                  <td><b>{w.name}</b><br /><span className="muted" style={st('font-size:10.5px')}>{(w.tenant_id ? 'this company' : 'all companies') + ' · priority ' + (w.priority || 0)}</span></td>
                  <td className="muted">{rcRange(w)}</td>
                  <td style={st('font-size:12px')}>{rcChain(rcStepsFor(w.id, props.workflowSteps))}</td>
                  <td>{w.active ? <span className="pill pill-green">active</span> : <span className="pill pill-draft">off</span>}</td>
                  <td style={st('white-space:nowrap')}>
                    <button className="btn xs" onClick={() => props.onWfEdit(w.id)}>Edit</button>{' '}
                    {w.active ? <button className="btn xs d" onClick={() => props.onWfOff(w.id)}>off</button> : null}
                  </td>
                </tr>
              ))
              : <tr><td colSpan={5} className="muted" style={st('text-align:center;padding:18px')}>No workflows yet — claims fall back to a single Finance approval. Add one to build a multi-level chain.</td></tr>}
          </tbody>
        </table></div>
        <div className="muted" style={st('font-size:11px;margin-top:8px')}>A claim routes to the <b>highest-priority active</b> workflow whose amount range (and optional department / type filter) match. If none match, it falls back to a <b>single</b> approver (a role that has a holder) and the claim is flagged with a warning. “Manager” resolves to the employee’s direct manager.</div>
      </div>

      <div className="panel">
        <div className="panel-hd"><h3>Role approvers</h3>
          <span className="muted" style={st('font-size:11px')}>who holds each role — used by both leave &amp; reimbursement</span></div>
        {RC_ROLES.map(([role, label]) => {
          const list = byRole[role] || [];
          return (
            <div key={role} style={st('display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);flex-wrap:wrap')}>
              <div style={st('width:130px;font-weight:600;font-size:13px')}>{label}</div>
              <div style={st('flex:1;min-width:160px')}>
                {list.length
                  ? list.map((a) => (
                    <span key={a.id} className="pill pill-coral" style={st('margin-right:5px')}>{empName(a.employee_id)}{' '}
                      {/* hros.html:3620 — the ✕ carries the ROLE-APPROVER row's id, not the employee's.
                          Binding it to the employee would remove that person from EVERY role at once. */}
                      <a onClick={() => props.onApproverDel(a.id)} style={st('cursor:pointer')}>✕</a></span>
                  ))
                  : <span className="muted" style={st('font-size:12px')}>none — an admin approves this level until you assign someone</span>}
              </div>
              <div>
                <select id={'apv_addapp_' + role} defaultValue="" style={st(APV_MINI + ';max-width:180px')}>
                  <option value="">+ add person…</option>
                  {props.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>{' '}
                <button className="btn xs" onClick={() => props.onApproverAdd(role)}>add</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
