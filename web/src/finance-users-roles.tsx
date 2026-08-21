// Finance OS · Users → 🛡 Roles & permissions — the first sub-view, and the one that decides what every
// other screen in Finance OS will open for everybody else.
//
// The legacy originals are `rolesLoad()` (app.html:4855), `roleForm()` (:4872), `roleSave()` (:4887) and
// `roleDelete()` (:4902). All four are still there and still shipping.
//
// PURE FUNCTIONS OF THEIR PROPS. The `roles_list` fetch, the `confirm()` a delete asks for, the two
// POSTs and the modal's open/close all live in app/finance/users/page.tsx.
//
// ── `FEATURE_META` IS THE PERMISSION VOCABULARY, AND IT IS NOT DERIVED ────────────────────────────
// app.html:4846 lists the ten tabs a role may be granted, in a fixed order, with the labels the operator
// ticks. It is NOT `web/src/nav.ts`'s 22 Finance tabs and must not be "helpfully" widened to them: a tab
// missing from this list cannot be granted through this form, and a tab ADDED to it is offered as
// grantable whether or not `showApp()` would honour it. Twelve of the 22 Finance tabs are deliberately
// absent (wht, selfbill, gateway, bankfeed, salesrecon, users, ctgaccess, info, calendar, pharm, ocr,
// ap) — some are `!canManage`, two are switched off entirely. Copied verbatim and pinned against
// app.html's own text in the screen's test, so a drift in either direction fails rather than silently
// granting or withholding a tab.
//
// ── NO GOLDEN ─────────────────────────────────────────────────────────────────────────────────────
// See `web/src/finance-users-sessions.tsx`'s header: the markup here is pinned against `rolesLoad()`'s
// and `roleForm()`'s own string literals, read out of app.html at run time.

/** One row of `{api:'roles_list'}`.roles — app.html:4858. */
export interface RoleRow {
  name: string;
  label?: string | null;
  features?: string[] | null;
  manage_users?: boolean | null;
  is_system?: boolean | null;
}

/** `FEATURE_META` — app.html:4846-4853, in that order. See the header before touching it. */
export const FEATURE_META: [string, string][] = [
  ['cfo', '🎯 CFO Cockpit'],
  ['overview', '📊 Overview'], ['approvals', '✅ Approvals'], ['collections', '📨 Collections'],
  ['upload', '⬆ Upload'], ['o2o', '💊 O2O Billing'], ['qinv', '🧾 Quick Invoice'],
  ['pnl', '📑 P&L Analysis'],
  ['close', '📋 Close'], ['recon', '🏦 Bank Rec'],
];

/** The chip label for one granted feature — app.html:4860. An unknown key prints RAW, not blank. */
export function featureLabel(f: string): string {
  const m = FEATURE_META.filter((x) => x[0] === f)[0];
  return m ? m[1] : f;
}

/**
 * The body `roleSave()` POSTs — app.html:4896.
 *
 * Split out of the route because no golden sees a request body and this one REWRITES A ROLE'S TAB LIST
 * for everyone holding it. Two rules travel with it, both from app.html:4890-4894:
 *
 *  • the role KEY is slugged (`lowercase`, non `[a-z0-9_]` → `_`) only when it is being CREATED. On an
 *    edit — and always for a system role — `RF_NAME` holds the existing name and the disabled input is
 *    ignored, so a save can never rename a role out from under the users who hold it.
 *  • a blank `label` falls back to the key, so `role_save` never stores an empty display name.
 *
 * Throws on a blank key rather than posting one: `roleSave()` refuses with "Role key is required"
 * (app.html:4895) and a role saved under `''` is one no `PERMS` lookup can ever match.
 */
export function roleKey(existing: string | null, typed: string): string {
  return existing != null ? existing : typed.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

export function roleSaveBody(
  name: string, label: string, features: string[], manage_users: boolean,
): Record<string, unknown> {
  if (!name) throw new Error('roleSaveBody: role key is required');
  return { api: 'role_save', name, label: label || name, features, manage_users };
}

/** The body `roleDelete()` POSTs — app.html:4904. Keyed by NAME; the row index never leaves the client. */
export function roleDeleteBody(name: string): Record<string, unknown> {
  if (!name) throw new Error('roleDeleteBody: role name is required');
  return { api: 'role_delete', name };
}

/** `confirm()`'s wording — app.html:4903. Ported: it is the only thing before a role disappears. */
export function roleDeleteConfirm(ro: RoleRow): string {
  return 'Delete role "' + (ro.label || ro.name) + '"? Users must be reassigned first.';
}

export interface RolesPanelProps {
  /** `roleForm(null)` — app.html:4856's "+ New role". */
  onNew: () => void;
  /** `#roles_out`'s content. Absent is the spinner `rolesLoad()` paints before its call lands. */
  children?: React.ReactNode;
}

/** `rolesLoad()`'s first write — app.html:4856. Every byte of `#uv_body`. */
export function RolesPanel(props: RolesPanelProps) {
  return (
    <div className="panel">
      <div className="panel-hd">
        <h3>Roles &amp; permissions · what each role can open</h3>
        <button className="btn p" onClick={props.onNew}>+ New role</button>
      </div>
      <div id="roles_out">
        {props.children ?? <div className="load"><span className="spin"></span>Loading…</div>}
      </div>
    </div>
  );
}

export interface RolesTableProps {
  roles: RoleRow[];
  /** `roleForm(i)` — app.html:4865. The index into `roles`, which is the legacy contract. */
  onEdit: (i: number) => void;
  /** `roleDelete(i)` — app.html:4864. Same index, and it removes a role. */
  onDelete: (i: number) => void;
}

/**
 * `rolesLoad()`'s second write — app.html:4867. Every byte of `#roles_out`.
 *
 * Rows of near-identical name / chips / buttons, each carrying a bare positional index. A Delete bound
 * one row off deletes the wrong role and every user holding it loses every tab at once, so the screen's
 * test drives each mis-binding as its own case.
 */
export default function RolesTable(props: RolesTableProps) {
  return (
    <>
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead>
            <tr><th>Role</th><th>Allowed features</th><th></th></tr>
          </thead>
          <tbody>
            {props.roles.map((ro, i) => {
              const feats = ro.features || [];
              return (
                <tr key={ro.name}>
                  <td>
                    <b>{ro.label || ro.name}</b>{' '}
                    {ro.is_system ? <span className="pill pill-blue" style={{ fontSize: '9px' }}>system</span> : null}
                    <br />
                    <span className="muted" style={{ fontSize: '11px' }}>{ro.name}</span>
                  </td>
                  <td>
                    {feats.length
                      ? feats.map((f) => (
                        <span key={f} className="pill pill-draft" style={{ fontSize: '9.5px', margin: '2px 2px 0 0' }}>{featureLabel(f)}</span>
                      ))
                      : <span className="muted" style={{ fontSize: '11px' }}>no features</span>}
                    {' '}
                    {ro.manage_users ? <span className="pill pill-coral" style={{ fontSize: '9.5px' }}>manage users</span> : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => props.onEdit(i)}>Edit</button>
                    {ro.is_system ? null : ' '}
                    {ro.is_system ? null : <button className="btn sm" onClick={() => props.onDelete(i)}>Delete</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: '11px', marginTop: '12px', lineHeight: '1.6' }}>
        System roles (admin / approver / viewer) can be re-scoped but not deleted. The <b>admin</b> role always keeps user-management rights.
      </div>
    </>
  );
}

export interface RoleModalProps {
  /** `roleForm(i)`'s argument: `null` is "+ New role", a row is an edit. */
  role: RoleRow | null;
  onClose: () => void;
  onSave: () => void;
  /** `#rf_err`'s text — `roleSave()` writes into it and removes `hide`. */
  error?: string | null;
  /** `btn.textContent='Saving…'` and `btn.disabled=true` — app.html:4895. */
  saving?: boolean;
}

/**
 * `roleForm()`'s modal — app.html:4878. Every byte of `#role_modal`.
 *
 * UNCONTROLLED, and its ids and classes are the contract `roleSave()` reads the form back out of the DOM
 * by: `#rf_name`, `#rf_label`, `.rf-feat:checked`, `#rf_manage`, `#rf_err`, `#rf_save`. The route reads
 * the same names, and the screen's test extracts BOTH sets out of app.html at run time rather than
 * retyping them — the `qi_*` / `data-k` treatment. A checkbox that lost `class="rf-feat"` saves the role
 * with that feature silently REMOVED, which takes a tab away from everyone holding it and shows no error.
 *
 * Three disabled rules, all from app.html:4879-4882 and each load-bearing:
 *  • the role KEY is disabled for a system role AND for any edit — see `roleKey()`.
 *  • `#rf_manage` is disabled when the role is `admin`, because admin always keeps user management. Note
 *    the legacy keys that on `ro.name==='admin'` and not on `is_system`, so a non-system role literally
 *    named `admin` is covered too; mirrored.
 */
export function RoleModal(props: RoleModalProps) {
  const isNew = props.role === null;
  const ro: RoleRow = props.role ?? { name: '', label: '', features: [], manage_users: false, is_system: false };
  const isSys = !!ro.is_system;
  return (
    <div className="overlay">
      <div className="modal" style={{ width: '480px' }}>
        <div className="modal-hd">
          <h3>{isNew ? 'New role' : 'Edit role'}</h3>
          <button className="modal-close" onClick={props.onClose}>×</button>
        </div>
        <div className="fld">
          <label>Role key</label>
          <input id="rf_name" defaultValue={ro.name || ''} placeholder="e.g. billing_clerk" disabled={isSys || !isNew} />
          <div className="muted" style={{ fontSize: '11px', marginTop: '4px' }}>Lowercase id, used internally. Cannot change after creation.</div>
        </div>
        <div className="fld">
          <label>Display name</label>
          <input id="rf_label" defaultValue={ro.label || ''} placeholder="e.g. Billing Clerk" />
        </div>
        <div className="fld">
          <label>Allowed features (tabs)</label>
          <div style={{ maxHeight: '230px', overflow: 'auto', border: '1px solid var(--border-strong)', borderRadius: '9px', padding: '12px', columns: '2' }}>
            {FEATURE_META.map((m) => (
              <label key={m[0]} style={{ display: 'flex', gap: '7px', alignItems: 'center', fontSize: '12.5px', color: 'var(--text-soft)', marginBottom: '5px' }}>
                <input type="checkbox" className="rf-feat" value={m[0]} defaultChecked={(ro.features || []).indexOf(m[0]) >= 0} style={{ width: 'auto' }} />
                {' ' + m[1]}
              </label>
            ))}
          </div>
        </div>
        <label style={{ display: 'flex', gap: '7px', alignItems: 'center', fontSize: '12.5px', color: 'var(--text-soft)', marginBottom: '10px' }}>
          <input type="checkbox" id="rf_manage" defaultChecked={!!ro.manage_users} disabled={ro.name === 'admin'} style={{ width: 'auto' }} />
          {' Can manage users & roles (admin powers)'}
        </label>
        <div className={'lerr' + (props.error ? '' : ' hide')} id="rf_err">{props.error || ''}</div>
        <div className="modal-ft">
          <button className="btn" onClick={props.onClose}>Cancel</button>
          <button className="btn p" id="rf_save" onClick={props.onSave} disabled={!!props.saving}>{props.saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
