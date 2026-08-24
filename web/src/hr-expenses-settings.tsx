// HR OS · Reimbursement · ⚙ Settings — `hrRCSettings()` (hros.html:2619), migrated.
//
// PURE FUNCTION OF ITS PROPS. Five tabs over `RC.setTab` — Claim Types / Mileage Rates / Cost Centers /
// Approval Workflows / Role Approvers — plus the claim-type EDITOR (`hrRCTypeForm()`, hros.html:2660),
// which the tab bar reaches through `RC.typeEdit`. The prompts, the confirms, the `hr_rc_admin_save`
// POSTs and the Xero chart-of-accounts load all live in app/hr/expenses/page.tsx.
//
// ── FIVE MODES, FIVE GOLDENS ────────────────────────────────────────────────────────────────────
// CLAUDE.md: "a screen whose tabs are MODES has as many modes as tabs, and one golden covers one of
// them". Here each tab is a different table over a different slice of `RC.cfg`, so each is its own
// surface — `hr.expenses.settings` (the default, Claim Types) plus `hr.expenses.settings.rates`,
// `.costcenters`, `.workflows` and `.approvers`. A golden per mode is one line in
// tests/render_surfaces.ts and byte-level; the alternative is an assertion that agrees with a widened
// port by construction.
//
// NOT reachable from ANY golden, mirrored from the legacy source anyway and pinned in the screen's
// own test:
//   • `TypeForm` — `RC.typeEdit` is null on every nav, so the editor renders in no golden. Both of its
//     GL branches (the loaded `<select>` and the "Loading Xero chart of accounts…" spinner) with it.
//   • the Cost Centers empty row, and the "no active type is missing a GL" case of the ⚠ banner.
//
// ── NOTHING IS LIFTED, AND THE REASON IS THE USUAL ONE ──────────────────────────────────────────
// There is no arithmetic on this screen at all: every figure is a stored config value printed back.
// What DOES leave is the POST body, so — `bankFile()`/`profileBody()`'s rule — the four `hr_rc_admin_save`
// row builders are pure functions here (`typeRow`, `costCenterRow`, `mileageRateRow`, `approverRow`),
// pinned against their legacy callers' own text. The DOM read that feeds `typeRow` stays in the route,
// as `qiCollect()` does.
//
// ── A LEGACY FINDING, REPORTED NOT FIXED ────────────────────────────────────────────────────────
// `hrRCSettings()`'s Role Approvers tab groups `cfg.role_approvers` by `a.role`, which is the column
// `hr_claim_role_approvers` actually has (hr.ts:1966). `tests/render_fixtures.ts` writes `claim_role`
// instead — CLAUDE.md already records that finding for `hr.approvals.rc` — so under the fixture BOTH
// role rows read "none". The golden holds that, on both sides, because it is what the legacy renders
// from the same data; the screen's own test builds rows in the SERVER's shape to reach the other branch.

import type { CSSProperties } from 'react';

import { st, type RcClaimType, type RcConfig, type RcCostCenter, type RcEmployeeOpt, type RcMileageRate } from './hr-expenses-form';

/** `M()` — hros.html:1268. */
const M = (n: unknown) =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `RC_SEL` — hros.html:1782. */
const RC_SEL = 'width:100%;padding:8px 10px;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px';

export type RcSetTab = 'types' | 'rates' | 'costcenters' | 'workflows' | 'approvers';

/** The five columns of `hr_claim_types` the settings table reads that the FORM's type does not. */
export interface RcSettingsClaimType extends RcClaimType {
  code?: string | null;
  taxable?: boolean;
  max_amount_per_claim?: number | string | null;
  max_amount_per_month?: number | string | null;
  sort_order?: number | null;
}

export interface RcWorkflow {
  id: string;
  name?: string | null;
  min_amount?: number | null;
  max_amount?: number | null;
  active?: boolean;
}
export interface RcWorkflowStep {
  id?: string;
  workflow_id: string;
  step_order: number;
  name?: string | null;
  approver_role?: string | null;
}
/** `hr_claim_role_approvers` (hr.ts:1966) — the column is `role`. See the finding in the header. */
export interface RcRoleApprover { id: string; role?: string | null; employee_id?: string | null }

export interface RcSettingsConfig extends RcConfig {
  claim_types?: RcSettingsClaimType[];
  workflows?: RcWorkflow[];
  workflow_steps?: RcWorkflowStep[];
  role_approvers?: RcRoleApprover[];
}

/** One row of `sbi_accounts` — `hrRCLoadAccounts()` (hros.html:2652) keeps only these three. */
export interface XeroAccount { code: string; name?: string | null; cls?: string | null }

const TABS: [RcSetTab, string][] = [
  ['types', 'Claim Types'], ['rates', 'Mileage Rates'], ['costcenters', 'Cost Centers'],
  ['workflows', 'Approval Workflows'], ['approvers', 'Role Approvers'],
];

/** hros.html:2647 — Manager & Finance retired per operator, so the screen offers two roles, not four. */
const ROLES: [string, string][] = [['hr', 'HR'], ['director', 'Director / Boss']];

export interface HrExpensesSettingsProps {
  cfg: RcSettingsConfig;
  /** `RC.setTab` — hros.html:2618. `null`/absent means the legacy's `RC.setTab||'types'`. */
  tab: RcSetTab;
  /** `RC.typeEdit` — the claim type being edited, or null for the table. */
  typeEdit: RcSettingsClaimType | null;
  /** `RC.accounts` — the Xero expense chart, and `RC.accLoading` while it is in flight. */
  accounts: XeroAccount[];
  accLoading: boolean;
  onSetTab: (tab: RcSetTab) => void;
  onTypeNew: () => void;
  onTypeEdit: (id: string) => void;
  onTypeCancel: () => void;
  onTypeSave: () => void;
  onAddRate: () => void;
  onAddCostCenter: () => void;
  onDelCostCenter: (id: string) => void;
  onAddApprover: (role: string) => void;
  onDelApprover: (id: string) => void;
}

export default function HrExpensesSettings(p: HrExpensesSettingsProps) {
  return (
    <>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {TABS.map(([id, label]) => (
          <button key={id} className={'btn xs' + (p.tab === id ? ' p' : '')} onClick={() => p.onSetTab(id)}>{label}</button>
        ))}
      </div>
      {p.tab === 'types' ? (p.typeEdit ? <TypeForm {...p} t={p.typeEdit} /> : <TypesTable {...p} />)
        : p.tab === 'rates' ? <RatesTable {...p} />
        : p.tab === 'costcenters' ? <CostCentersTable {...p} />
        : p.tab === 'workflows' ? <WorkflowsTable {...p} />
        : p.tab === 'approvers' ? <ApproversPanel {...p} />
        : null}
    </>
  );
}

// ── Claim Types — hros.html:2623 ──────────────────────────────────────────────────────────────────

function TypesTable(p: HrExpensesSettingsProps) {
  const types = p.cfg.claim_types || [];
  const anyMissing = types.some((t) => t.active && !t.gl_account);
  return (
    <div className="panel">
      <div className="panel-hd"><h3>Claim Types</h3><button className="btn p sm" onClick={p.onTypeNew}>+ New type</button></div>
      {anyMissing ? (
        <div style={{ background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', borderRadius: '8px', padding: '8px 11px', fontSize: '12px', color: 'var(--amber)', marginBottom: '10px' }}>
          ⚠ Some active types have no GL account — claims of those types can’t post to Xero until you set one (click Edit).
        </div>
      ) : null}
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead><tr><th>Name</th><th>Xero GL</th><th>Receipt</th><th className="amt">Per-claim cap</th><th className="amt">Monthly cap</th><th>Tax</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <td><b>{t.name}</b>{t.is_mileage ? ' 🚗' : ''}</td>
                <td>
                  {t.gl_account ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t.gl_account}</span>
                    : t.active ? <span style={{ color: 'var(--amber)' }}>— set —</span>
                    : <span className="muted">—</span>}
                </td>
                <td>{t.requires_receipt ? 'Yes' : '—'}</td>
                <td className="amt">{t.max_amount_per_claim != null ? M(t.max_amount_per_claim) : '—'}</td>
                <td className="amt">{t.max_amount_per_month != null ? M(t.max_amount_per_month) : '—'}</td>
                <td>{t.taxable ? 'Taxable' : '—'}</td>
                <td>{t.active ? <span className="pill pill-green">active</span> : <span className="pill pill-draft">off</span>}</td>
                <td><button className="btn xs" onClick={() => p.onTypeEdit(t.id)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>
        All types are reimbursement-only and do NOT affect EPF / SOCSO / EIS / PCB. The <b>Xero GL</b> is where an approved claim of this type posts (ACCPAY bill, SUBMITTED).
      </div>
    </div>
  );
}

// ── the claim-type editor — hros.html:2660. In NO golden; pinned by assertion. ────────────────────

const G = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><label className="muted" style={{ fontSize: '11px' }}>{label}</label>{children}</div>
);
const CHK: CSSProperties = { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', cursor: 'pointer' };

/**
 * The form is UNCONTROLLED and its `rct_*` ids are the contract `typeRow()` reads it back by — the same
 * arrangement `hrRCTypeSave()` (hros.html:2679) has, and the same one every other migrated Finance form
 * uses. A field that loses its id saves as blank, which here silently clears a GL account or a cap.
 */
function TypeForm(p: HrExpensesSettingsProps & { t: RcSettingsClaimType }) {
  const t = p.t;
  const accs = (p.accounts || []).filter((a) => a.cls === 'EXPENSE');
  const known = accs.some((a) => String(a.code) === String(t.gl_account || ''));
  const inp = (id: string, ph: string, val: unknown, extra?: { type?: string; step?: string }) => (
    <input id={'rct_' + id} placeholder={ph} defaultValue={val == null ? '' : String(val)} type={extra && extra.type} step={extra && extra.step} style={st(RC_SEL)} />
  );
  const chk = (id: string, lbl: string, on: boolean) => (
    <label style={CHK}><input type="checkbox" id={'rct_' + id} defaultChecked={on} /> {lbl}</label>
  );
  return (
    <div className="panel" style={{ maxWidth: '660px' }}>
      <div className="panel-hd"><h3>{t.id ? 'Edit claim type' : 'New claim type'}</h3><button className="btn sm" onClick={p.onTypeCancel}>✕ Close</button></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
        <G label="Name *">{inp('name', 'e.g. Meals', t.name)}</G>
        <G label="Xero GL account (expense)">
          {p.accLoading
            ? <div className="muted" style={{ fontSize: '12px', padding: '8px 0' }}><span className="spin"></span> Loading Xero chart of accounts…</div>
            : (
              <select id="rct_gl" defaultValue={String(t.gl_account || '')} style={st(RC_SEL)}>
                <option value="">— none (can’t post to Xero until set) —</option>
                {accs.map((a) => <option key={a.code} value={a.code}>{a.code + ' — ' + a.name}</option>)}
                {/* hros.html:2663 — a GL the chart does not carry is still offered, so opening the form
                    on a stale code cannot silently blank it on save. */}
                {t.gl_account && !known ? <option value={String(t.gl_account)}>{t.gl_account + ' (current)'}</option> : null}
              </select>
            )}
        </G>
        <G label="Max per claim (RM, blank = no cap)">{inp('pc', '', t.max_amount_per_claim, { type: 'number', step: '0.01' })}</G>
        <G label="Max per month (RM, blank = no cap)">{inp('pm', '', t.max_amount_per_month, { type: 'number', step: '0.01' })}</G>
      </div>
      <div style={{ display: 'flex', gap: '22px', flexWrap: 'wrap', margin: '4px 0 14px' }}>
        {chk('rr', 'Require receipt', !!t.requires_receipt)}
        {chk('tax', 'Taxable (BIK)', !!t.taxable)}
        {chk('mile', 'Mileage type (km × rate)', !!t.is_mileage)}
        {chk('act', 'Active', t.active !== false)}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="btn p sm" onClick={p.onTypeSave}>Save claim type</button>
        <button className="btn sm" onClick={p.onTypeCancel}>Cancel</button>
      </div>
      <div className="muted" style={{ fontSize: '11px', marginTop: '10px' }}>
        The GL account is where an approved claim of this type posts in Xero (ACCPAY bill, SUBMITTED). Reimbursements never touch EPF / SOCSO / EIS / PCB.
      </div>
    </div>
  );
}

// ── Mileage Rates — hros.html:2632 ────────────────────────────────────────────────────────────────

function RatesTable(p: HrExpensesSettingsProps) {
  return (
    <div className="panel">
      <div className="panel-hd"><h3>Mileage Rates</h3><button className="btn p sm" onClick={p.onAddRate}>+ Add rate</button></div>
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead><tr><th>Rate</th><th>Label</th><th>Status</th></tr></thead>
          <tbody>
            {(p.cfg.mileage_rates || []).map((r, i) => (
              <tr key={r.id || i}>
                {/* `'RM'+r.rate+' / km'` — the RAW stored number, NOT M(). RM0.6, not RM 0.60. */}
                <td><b>{'RM' + r.rate + ' / km'}</b>{r.is_default ? <>{' '}<span className="pill pill-blue">default</span></> : null}</td>
                <td className="muted">{r.label || ''}</td>
                <td>{r.active ? 'active' : 'off'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Cost Centers — hros.html:2636 ─────────────────────────────────────────────────────────────────

function CostCentersTable(p: HrExpensesSettingsProps) {
  const list = (p.cfg.cost_centers || []) as (RcCostCenter & { tenant_id?: string | null })[];
  return (
    <div className="panel">
      <div className="panel-hd"><h3>Cost Centers</h3><button className="btn p sm" onClick={p.onAddCostCenter}>+ Add cost center</button></div>
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead><tr><th>Code</th><th>Name</th><th>Scope</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list.length ? list.map((c, i) => (
              <tr key={c.id || i}>
                <td><b>{c.code}</b></td>
                <td>{c.name}</td>
                <td className="muted">{c.tenant_id ? 'this company' : 'all companies'}</td>
                <td>{c.active ? <span className="pill pill-green">active</span> : <span className="pill pill-draft">off</span>}</td>
                <td>{c.active ? <button className="btn xs d" onClick={() => p.onDelCostCenter(String(c.id))}>deactivate</button> : null}</td>
              </tr>
            )) : (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '18px' }}>No cost centers yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>
        Selectable on the claim header and per expense line; flows into the accounting export.
      </div>
    </div>
  );
}

// ── Approval Workflows — hros.html:2640. Read-only in the legacy, so read-only here. ──────────────

/** `rng` — hros.html:2643. `'RM'+min+(max!=null?('–'+max):'+')`, raw numbers, en dash. */
export function workflowRange(w: RcWorkflow): string {
  return 'RM' + (w.min_amount || 0) + (w.max_amount != null ? ('–' + w.max_amount) : '+');
}

/** `chain` — hros.html:2643. Steps sorted by `step_order`, joined with ' → ', '—' when there are none. */
export function workflowChain(steps: RcWorkflowStep[]): string {
  return steps.slice().sort((a, b) => a.step_order - b.step_order).map((s) => s.name || s.approver_role).join(' → ') || '—';
}

function WorkflowsTable(p: HrExpensesSettingsProps) {
  const byWf: Record<string, RcWorkflowStep[]> = {};
  (p.cfg.workflow_steps || []).forEach((s) => { (byWf[s.workflow_id] = byWf[s.workflow_id] || []).push(s); });
  return (
    <div className="panel">
      <div className="panel-hd"><h3>Approval Workflows</h3></div>
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead><tr><th>Workflow</th><th>Amount range</th><th>Approval chain</th><th>Status</th></tr></thead>
          <tbody>
            {(p.cfg.workflows || []).map((w) => (
              <tr key={w.id}>
                <td><b>{w.name}</b></td>
                <td className="muted">{workflowRange(w)}</td>
                <td style={{ fontSize: '12px' }}>{workflowChain(byWf[w.id] || [])}</td>
                <td>{w.active ? <span className="pill pill-green">active</span> : <span className="pill pill-draft">off</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>
        A claim is routed to the highest-priority active workflow whose amount range (and optional dept/type/project filters) match. Manager step resolves to the employee’s direct manager.
      </div>
    </div>
  );
}

// ── Role Approvers — hros.html:2645 ───────────────────────────────────────────────────────────────

function ApproversPanel(p: HrExpensesSettingsProps) {
  const byRole: Record<string, RcRoleApprover[]> = {};
  (p.cfg.role_approvers || []).forEach((a) => { const k = String(a.role ?? ''); (byRole[k] = byRole[k] || []).push(a); });
  const empName = (id: string | null | undefined) => {
    const e = (p.cfg.employees || []).find((x: RcEmployeeOpt) => x.id === id);
    return e ? e.name : id;
  };
  return (
    <div className="panel">
      <div className="panel-hd"><h3>Role Approvers</h3></div>
      <div className="muted" style={{ fontSize: '11.5px', marginBottom: '10px' }}>
        Assign who approves at each role level. (Until assigned, an admin can approve any step.)
      </div>
      {ROLES.map(([role, label]) => {
        const list = byRole[role] || [];
        return (
          <div key={role} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: '120px', fontWeight: 600, fontSize: '13px' }}>{label}</div>
            <div style={{ flex: '1' }}>
              {list.length ? list.map((a) => (
                <span key={a.id} className="pill pill-coral" style={{ marginRight: '4px' }}>
                  {empName(a.employee_id)}{' '}
                  <a onClick={() => p.onDelApprover(a.id)} style={{ cursor: 'pointer' }}>✕</a>
                </span>
              )) : <span className="muted" style={{ fontSize: '12px' }}>none</span>}
            </div>
            <button className="btn xs" onClick={() => p.onAddApprover(role)}>+ add</button>
          </div>
        );
      })}
    </div>
  );
}

// ── What LEAVES: the four `hr_rc_admin_save` row builders ─────────────────────────────────────────
//
// No golden sees a request body, so each of these is a pure function pinned against its legacy
// caller's own text in web/tests/hr-expenses-settings.test.tsx. The reads that feed them (a DOM value,
// a prompt) stay in the route.

/** What the type editor was read back as — the route's `v()`/`ck()` of the `rct_*` ids. */
export interface TypeFormValues {
  name: string; gl: string; pc: string; pm: string;
  rr: boolean; tax: boolean; mile: boolean; act: boolean;
}

/**
 * `hrRCTypeSave()`'s `row` — hros.html:2679. Three things here are load-bearing:
 *
 *  1. `gl_account` while the chart is still LOADING keeps the type's EXISTING code. The `<select>` is
 *     not rendered yet, so reading it would send `null` and silently un-code every future claim of
 *     that type (it can then no longer post to Xero at all — hr.ts:2450).
 *  2. a blank cap is `null` ("no cap"), NOT `Number('')` → 0, which would cap every claim at RM0.
 *  3. `code` and `sort_order` are set on a CREATE ONLY. Re-slugging on an edit changes the key other
 *     rows join on; the legacy guards it with `if(!t.id)` and so does this.
 */
export function typeRow(t: RcSettingsClaimType, v: TypeFormValues, accLoading: boolean, now: number): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: t.id || undefined,
    name: v.name,
    gl_account: accLoading ? (t.gl_account || null) : (v.gl || null),
    requires_receipt: v.rr,
    taxable: v.tax,
    is_mileage: v.mile,
    active: v.act,
    max_amount_per_claim: (v.pc === '' ? null : Number(v.pc)),
    max_amount_per_month: (v.pm === '' ? null : Number(v.pm)),
  };
  if (!t.id) {
    row.code = v.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || ('TYPE' + String(now).slice(-4));
    if (t.sort_order != null) row.sort_order = t.sort_order;
  }
  return row;
}

/** `hrRCAddCC()` — hros.html:2687. `shareAll` is the confirm: true ⇒ tenant_id null ⇒ every company. */
export function costCenterRow(code: string, name: string, shareAll: boolean, tenant: string | null): Record<string, unknown> {
  return { code: code.trim().toUpperCase(), name: name.trim() || code.trim(), tenant_id: (shareAll ? null : tenant) };
}

/** `hrRCAddRate()` — hros.html:2689. */
export function mileageRateRow(rate: string, label: string | null): Record<string, unknown> {
  return { rate: Number(rate), label: label || ('RM' + rate + '/km'), active: true };
}

/** `hrRCAddApprover()` — hros.html:2690. The column is `role`; see the header's finding. */
export function approverRow(role: string, employeeId: string, tenant: string | null): Record<string, unknown> {
  return { role, employee_id: employeeId, tenant_id: tenant };
}

/** `hrRCAddApprover()`'s numbered picker — hros.html:2690. `'1. E001 — AHMAD'`, one per line. */
export function approverPrompt(role: string, employees: RcEmployeeOpt[]): string {
  return 'Assign ' + role + ' approver — enter number:\n'
    + employees.map((e, i) => (i + 1) + '. ' + e.emp_no + ' — ' + e.name).join('\n');
}
