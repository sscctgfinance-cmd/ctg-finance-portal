// Finance OS · Users → the add/edit user modal. The legacy originals are `userForm()` (app.html:4780),
// `ufToggleRow()` (:4807), `ufClose()` (:4813) and `userSave()` (:4815); all four are still there.
//
// This is the control the migrated Users LIST could not open: `+ Add user` and every row's `Edit` used
// to send the operator back to app.html mid-screen. It is also the widest grant on the screen — one save
// sets a person's role, their company access, a per-company role OVERRIDE, and whether they can log in
// at all.
//
// PURE FUNCTION OF ITS PROPS, and it holds NO state: `web/tests/handlers.ts`'s walker invokes function
// components directly, so a `useState` anywhere in a presentational tree would throw there. The route
// owns the open/close, the save and the two DOM reads described below.
//
// ── UNCONTROLLED, AND ITS IDS AND CLASSES ARE THE CONTRACT ────────────────────────────────────────
// `userSave()` reads the form back out of the DOM by `#uf_name`, `#uf_role`, `#uf_email`, `#uf_pass`,
// `#uf_active`, `.uf-comp:checked` and `.uf-comp-role[data-tid=…]`. The route reads exactly the same
// names, and the screen's test extracts BOTH sets out of app.html at run time rather than retyping them
// — the `qi_*` / `data-k` treatment. A field that loses its id saves as BLANK, which on this form is a
// wiped role or a wiped company list and no error anywhere.
//
// ── THE PART WITH ONE RIGHT ANSWER IS LIFTED; THE DOM READ IS NOT ─────────────────────────────────
// `finance.qinv`'s rule: `qiCollect()` was left in the route because it reads the DOM, and `collect()` —
// which rows become which lines — was lifted. Same split here. `ufTenants()` and `userSaveBody()` below
// are pure functions of plain data; the four `getElementById` calls that produce that data stay in
// app/finance/users/page.tsx, where the golden could not have reached them anyway.

import type { Company, Role } from './finance-users';

/** What `userForm()` is opened over — app.html:4780. `null` is "+ Add user". */
export interface UserFormUser {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  active?: boolean | null;
  /** `userEdit()` (app.html:4763) builds these from `USERS_UC` / `USERS_UC_ROLE`. */
  tenants?: { tenant_id: string; role?: string | null }[] | null;
}

/** One row of the company list as the form has it — checked, plus the per-company override. */
export interface CompRow { tenant_id: string; checked: boolean; role: string }

/**
 * `pwValid()` — app.html:2525. Only the CREATE path applies it; `🔑 Reset` on the list uses `MIN_PASSWORD`
 * (6) instead, which is the legacy's own inconsistency and is mirrored rather than reconciled.
 */
export function pwValid(p: string): boolean {
  return (p || '').length >= 8 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);
}

/**
 * `userSave()`'s tenant collection — app.html:4821-4826, as a pure function of the rows.
 *
 * TWO rules, and both matter more than they look:
 *  • only CHECKED rows are sent. An unchecked row is not sent as `false`; it is absent, and the server
 *    replaces the whole set. Sending an unchecked row would grant the company it was meant to remove.
 *  • an empty override is sent as `null`, NOT as `''`. `null` means "inherit the global role"; `''`
 *    would be a role name no `roles_list` row matches, and `roleLabelFor()` prints an unmatched name
 *    raw — so the operator would see a per-company override that grants nothing.
 */
export function ufTenants(rows: CompRow[]): { tenant_id: string; role: string | null }[] {
  return rows.filter((r) => r.checked).map((r) => ({ tenant_id: r.tenant_id, role: r.role ? r.role : null }));
}

/**
 * The body `userSave()` POSTs — app.html:4829 (edit) and :4838 (create).
 *
 * No golden sees a request body, and this one is the widest grant on the screen. Pinned in the test
 * against `userSave()`'s own text rather than a retyped expectation, in both directions:
 *
 *  • EDIT sends `user_id` and NOT `email` and NOT `pass` — the legacy disables the email input on an
 *    edit, so an address can never be changed out from under an existing login, and a password can only
 *    be set through `user_reset_password`, which is separately audited.
 *  • CREATE sends `email`, `pass` and `name:name||email` and NO `user_id`.
 *  • `active` rides along only on an edit, and only because `#uf_active` exists there.
 *
 * Throws rather than posting a body the server would have to guess at.
 */
export function userSaveBody(a: {
  editId: string | null;
  name: string;
  role: string;
  tenants: { tenant_id: string; role: string | null }[];
  active?: boolean;
  email?: string;
  pass?: string;
}): Record<string, unknown> {
  if (a.editId) {
    const body: Record<string, unknown> = {
      api: 'user_update', user_id: a.editId, name: a.name, role: a.role, tenants: a.tenants,
    };
    if (a.active !== undefined) body.active = a.active;
    return body;
  }
  const email = (a.email || '').trim();
  const pass = a.pass || '';
  if (!email || !pass) throw new Error('Email and password are required');
  if (!pwValid(pass)) throw new Error('Password must be at least 8 characters and include letters and numbers');
  return { api: 'user_create', email, name: a.name || email, pass, role: a.role, tenants: a.tenants };
}

/** The two error strings `userSave()` writes into `#uf_err` — app.html:4835, :4836. */
export const UF_ERR_REQUIRED = 'Email and password are required';
export const UF_ERR_WEAK = 'Password must be at least 8 characters and include letters and numbers';

/** `roleOpts` — app.html:4795. The count is the number of TABS the role opens, which is the thing being granted. */
export function roleOptionLabel(r: Role & { features?: string[] | null; manage_users?: boolean | null }): string {
  const n = (r.features || []).length;
  return (r.label || r.name) + ' (' + n + ' feature' + (n === 1 ? '' : 's') + (r.manage_users ? ', manages users' : '') + ')';
}

/** The role a NEW user gets if nothing is chosen — app.html:4806. Least privilege; do not change it silently. */
export const DEFAULT_ROLE = 'viewer';

export interface UserModalProps {
  /** `userForm(u)`'s argument. `null` is Add; anything with an `id` is Edit. */
  user: UserFormUser | null;
  companies: Company[];
  roles: (Role & { features?: string[] | null; manage_users?: boolean | null })[];
  /** `ufClose()` — app.html:4813. */
  onClose: () => void;
  /** `userSave()` — app.html:4815. */
  onSave: () => void;
  /** `ufToggleRow(this)` — app.html:4807. The route does the two DOM writes; see this file's header. */
  onCompToggle: (e: { currentTarget?: HTMLInputElement }) => void;
  /** `#uf_err`'s text — `userSave()` writes into it and removes `hide`. */
  error?: string | null;
  /** `btn.textContent='Saving…'` and `btn.disabled=true` — app.html:4827. */
  saving?: boolean;
}

/**
 * `userForm()`'s modal — app.html:4786. Every byte of `#user_modal`.
 *
 * ── ONE INVISIBLE MUTATION, PORTED AS MARKUP ─────────────────────────────────────────────────────
 * `userForm()`'s LAST statement is `document.getElementById('uf_role').value=u.role||'viewer'`
 * (app.html:4806) — the `finance.qinv` / `finance.users` trap: the `roleOpts` string carries no
 * `selected`, so the raw markup shows the FIRST role while every operator sees the user's own. There is
 * no golden here to be captured a moment too early, so the React port renders the state an operator
 * sees (`defaultValue`) and the screen's test pins that legacy statement out of app.html.
 *
 * ── AND ONE LEGACY QUIRK IN THE PER-COMPANY SELECT ───────────────────────────────────────────────
 * app.html:4791 marks the override selected with a STRING `String.replace` —
 * `perCoRoleOpts.replace('value="'+roleVal+'"', 'value="'+roleVal+'" selected')` — which silently does
 * nothing when the stored override names a role that `roles_list` no longer returns, leaving the browser
 * on "(inherit global)". `defaultValue` behaves the same way for the same input, so the port neither
 * fixes nor worsens it; the test drives that case so the equivalence is not a claim.
 */
export function UserModal(props: UserModalProps) {
  const u = props.user ?? {};
  const isEdit = !!u.id;
  const existing: Record<string, { tenant_id: string; role?: string | null }> = {};
  (u.tenants || []).forEach((t) => { existing[t.tenant_id] = t; });

  return (
    <div className="overlay">
      <div className="modal" style={{ width: '520px' }}>
        <div className="modal-hd">
          <h3>{isEdit ? 'Edit user' : 'Add user'}</h3>
          <button className="modal-close" onClick={props.onClose}>×</button>
        </div>
        <div className="fld">
          <label>Name</label>
          <input id="uf_name" defaultValue={u.name || ''} />
        </div>
        <div className="fld">
          <label>Email</label>
          <input id="uf_email" type="email" defaultValue={u.email || ''} disabled={isEdit} />
        </div>
        {isEdit ? null : (
          <div className="fld">
            <label>Password <span style={{ color: 'var(--muted)', textTransform: 'none', letterSpacing: '0' }}>(min 8, letters + numbers · user changes it on first login)</span></label>
            <input id="uf_pass" type="password" placeholder="••••••••" />
          </div>
        )}
        <div className="fld">
          <label>Default role <span style={{ color: 'var(--muted)', textTransform: 'none', letterSpacing: '0' }}>(applied to all companies unless overridden below)</span></label>
          <select id="uf_role" defaultValue={u.role || DEFAULT_ROLE}>
            {props.roles.map((r) => <option key={r.name} value={r.name}>{roleOptionLabel(r)}</option>)}
          </select>
        </div>
        <div className="fld">
          <label>Company access &amp; per-company role</label>
          <div style={{ maxHeight: '220px', overflow: 'auto', border: '1px solid var(--border-strong)', borderRadius: '9px', padding: '8px 6px' }}>
            {props.companies.map((c) => {
              const ex = existing[c.tenant_id];
              const ck = !!ex;
              const roleVal = (ex && ex.role) ? ex.role : '';
              return (
                <div key={c.tenant_id} className="uf-comp-row" style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '6px 4px', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                  <input type="checkbox" className="uf-comp" data-tid={c.tenant_id} value={c.tenant_id}
                         defaultChecked={ck} style={{ width: 'auto', flexShrink: '0' }} onChange={props.onCompToggle} />
                  <span style={{ flex: '1', fontSize: '12.5px', color: 'var(--text-soft)' }}>{c.tenant_name}</span>
                  <select className="uf-comp-role" data-tid={c.tenant_id}
                          style={{ fontSize: '11.5px', padding: '4px 8px', width: 'auto', minWidth: '135px' }}
                          disabled={!ck} defaultValue={roleVal}>
                    <option value="">(inherit global)</option>
                    {props.roles.map((r) => <option key={r.name} value={r.name}>{r.label || r.name}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
          <div className="muted" style={{ fontSize: '11px', marginTop: '5px' }}>Tick companies, optionally override the role per company. Admins see all regardless.</div>
        </div>
        {isEdit ? (
          <label style={{ display: 'flex', gap: '7px', alignItems: 'center', fontSize: '12.5px', color: 'var(--text-soft)', marginBottom: '10px' }}>
            <input type="checkbox" id="uf_active" defaultChecked={!!u.active} style={{ width: 'auto' }} />
            {' Active (can log in)'}
          </label>
        ) : null}
        <div className={'lerr' + (props.error ? '' : ' hide')} id="uf_err">{props.error || ''}</div>
        <div className="modal-ft">
          <button className="btn" onClick={props.onClose}>Cancel</button>
          <button className="btn p" id="uf_save" onClick={props.onSave} disabled={!!props.saving}>{props.saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
