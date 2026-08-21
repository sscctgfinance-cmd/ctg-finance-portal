// Finance OS · Users — the tenth screen out of app.html, and the first with THREE golden sections.
//
// The legacy original is `renderUsers()` (app.html:5102) with `usersView()` (:5114), `usersLoad()`
// (:5159), `userEdit()` (:5197) and `userReset()` (:5204) below it. All of them are STILL THERE and
// still shipping; nothing was deleted. Both halves are reachable side by side (`app.html#tab=users`
// and `/finance/users/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. The three loads
// (`roles_list`, `companies_list`, `users_list`), the `prompt()` a password reset asks for, the POST and
// the sub-view switching all live in app/finance/users/page.tsx.
//
// ── THREE SECTIONS, BECAUSE THE LEGACY WRITES THREE NESTED DIVS ────────────────────────────────────
// `tests/golden/finance.users.html` is the first Finance golden with more than two `<!-- #id -->`
// blocks, and they are three DIFFERENT elements, nested:
//
//   #users     ← renderUsers()  — the sub-nav, plus the empty #uv_body / #user_modal / #role_modal divs
//   #uv_body   ← usersLoad()    — the panel, with #users_out holding the spinner
//   #users_out ← usersLoad()    — the loaded table
//
// So the screen is three components, one per legacy innerHTML target, and the screen's test diffs each
// against its own section. Composing them is app/finance/users/page.tsx's job; the DEFAULT export here
// is the table — the section the row handlers live on.
//
// ── THE GOLDEN HOLDS AN INTERMEDIATE STATE, AND THIS ONE IS A FINDING ──────────────────────────────
// CLAUDE.md's `finance.qinv` warning applies here and the answer is the qinv answer, not the
// finance.upload one. `renderUsers()` does NOT stop after its `innerHTML=`: its last statement is
// `usersView(USERS_VIEW||'users')`, and `usersView()` (app.html:5115-5116) reassigns every sub-nav
// button's `.className`:
//
//     ['users','roles','sessions','audit','xero'].forEach(function(k){
//       var b=document.getElementById('uv_'+k); if(b) b.className='btn sm'+(k===v?' p':''); });
//
// A `.className=` assignment is invisible to `tests/render_harness.ts`, which records innerHTML writes
// by element id. So the golden holds `class="btn sm"` on ALL FIVE buttons, while every operator sees
// `uv_users` as `btn sm p` — the highlighted tab. `UsersSubnav` therefore takes an `active` prop whose
// GOLDEN value is `null` ("usersView() has not run yet") and whose ROUTE value is the live sub-view.
// The screen's test pins that assignment out of app.html so this cannot quietly stop being true.
//
// ── THE PERMISSION GATE IS NOT WHAT ITS LINE SAYS ──────────────────────────────────────────────────
// See `usersReachable()`. Read app.html:1420-1439 as a whole before trusting one line of it.
//
// ── NO ARITHMETIC WAS LIFTED, AND NONE EXISTS ──────────────────────────────────────────────────────
// There is no money on this screen and no formula: `relTime()` is a duration FORMAT and `login_count`
// is printed as it arrives. Nothing here is a second copy of a computation the server also does, so
// this is neither the `wht.js` case nor the `o2o.js` one — it is the Quick Invoice answer for a
// different reason (there is nothing to lift, rather than the server owning it).

import { Fragment } from 'react';

/**
 * `PERMS` — resolved by `showApp()` from `my_perms`, with `fallbackPerms()` (app.html:1398) standing in
 * when that call fails.
 */
export interface Perms {
  features?: string[] | null;
  manage_users?: boolean;
}

/**
 * app.html:1422 says `if(t==='users') el.classList.toggle('hide', !canManage);` and that line is DEAD.
 *
 * Read the shape of the block, not the intent of the line. `users` is a STANDALONE `if`; the
 * `if/else if` chain RESTARTS at `ctgaccess` on the next line. `users` matches no branch of that chain,
 * so it falls through to its final `else` — `el.classList.toggle('hide', feats.indexOf(t)<0)` — which
 * runs unconditionally afterwards and OVERWRITES the admin toggle. The effective rule for this tab is
 * therefore its FEATURE FLAG, and a login with `manage_users:true` and no `users` feature does not see
 * it. That is exactly what the shipped fixtures show: `ALL_FEATURES` does not contain `users`, so the
 * tab is hidden even for the Administrator the goldens were captured as.
 *
 * CLAUDE.md flags this quirk and says whoever ports the Users tab owns it; `web/src/nav.ts` already
 * transcribes the same control flow. Mirrored here as the pure predicate the route refuses on, and
 * pinned in BOTH directions — including that it is not `manage_users` — in the screen's own test.
 *
 * The server is stricter than this either way (`users_list`, `user_save` and `user_reset_password` all
 * check the role), so this is tab visibility, not the boundary.
 */
export function usersReachable(perms: Perms | null | undefined): boolean {
  return !!(perms && (perms.features || []).indexOf('users') >= 0);
}

/** The five sub-views `usersView()` dispatches over — app.html:5116, in that order. */
export const USERS_VIEWS = ['users', 'roles', 'sessions', 'audit', 'xero'] as const;
export type UsersView = (typeof USERS_VIEWS)[number];

/**
 * The sub-view `renderUsers()` opens on — app.html:4678, `usersView(USERS_VIEW||'users')`. All five are
 * now migrated; this is the landing one, and it is why the golden holds the `users` table and no other.
 */
export const DEFAULT_VIEW: UsersView = 'users';

/** One row of `{api:'roles_list'}`.roles — app.html:5160, fixture at tests/render_fixtures.ts:61. */
export interface Role { name: string; label?: string | null }

/** One row of `{api:'companies_list'}`.companies. */
export interface Company { tenant_id: string; tenant_name: string }

/** One row of `{api:'users_list'}`.users — app.html:5167. */
export interface User {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  active?: boolean | null;
  totp_enabled?: boolean | null;
  last_login_at?: string | null;
  last_login_ip?: string | null;
  login_count?: number | null;
}

/** One row of `{api:'users_list'}`.user_companies — app.html:5169. */
export interface UserCompany { user_id: string; tenant_id: string; role?: string | null }

/** `roleLabelFor()` — app.html:5158. Falls back to the raw role name, which is what the pill shows. */
export function roleLabelFor(name: string, roles: Role[]): string {
  const r = roles.filter((x) => x.name === name)[0];
  return r ? (r.label || r.name) : name;
}

/** `rolePill` — app.html:5195 and again at :5137. Three classes, admin first. */
export function rolePillClass(role: string): string {
  return role === 'admin' ? 'pill-coral' : role === 'approver' ? 'pill-blue' : 'pill-draft';
}

/**
 * `relTime()` — app.html:5172-5179, as a pure function of the instant it is handed.
 *
 * hr.yearend's rule: a component that read the clock itself would render one thing today and something
 * else tomorrow, and the golden (captured at `tests/render_harness.ts`'s FIXED_MS) could not be diffed
 * against it. The route hands it `Date.now()`; the test hands it FIXED_MS. Returns a NODE because the
 * legacy returns markup for the null case.
 */
export function relTime(iso: string | null | undefined, now: number): React.ReactNode {
  if (!iso) return <span className="muted">never</span>;
  const d = new Date(iso);
  const s = Math.floor((now - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 2592000) return Math.floor(s / 86400) + ' d ago';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

/**
 * The body `userReset()` POSTs — app.html:5208, `call({api:'user_reset_password',user_id,new_pass})`.
 *
 * Split out of the route for the same reason `decideBody()` was on Approvals and `profileBody()` on the
 * HR side: no golden sees a request body, and this one SETS SOMEONE'S PASSWORD. The user is resolved
 * from `USERS_LIST[i]` — a positional index into three visually near-identical rows — so a mis-bound
 * row hands one person's account to whoever typed the new password for another. The screen's test
 * compares this against `userReset()`'s own text in app.html rather than against a retyped expectation.
 */
export function resetBody(user_id: string, new_pass: string): Record<string, unknown> {
  return { api: 'user_reset_password', user_id, new_pass };
}

/** `pw.length<6` — app.html:5207. The only client-side rule on a new password. */
export const MIN_PASSWORD = 6;

export interface UsersSubnavProps {
  /**
   * The highlighted sub-view, or `null` for the state `renderUsers()` leaves the markup in BEFORE
   * `usersView()` reassigns the classNames. `null` is the golden's state and no operator's — see the
   * header.
   */
  active: UsersView | null;
  /** `usersView(v)` — app.html:5114. */
  onView: (v: UsersView) => void;
  /** `#uv_body`'s content. */
  children?: React.ReactNode;
}

/** The label on each sub-nav button — app.html:5105-5109, character for character. */
const VIEW_LABEL: Record<UsersView, string> = {
  users: '👥 Users',
  roles: '🛡 Roles & permissions',
  sessions: '🖥 Active sessions',
  audit: '📜 Audit log',
  xero: '🔗 Xero sync',
};

/**
 * `renderUsers()` — app.html:5102. Every byte of the `#users` tab div.
 *
 * The two empty modal hosts are kept: `userForm()` and the roles editor write into them by id, and this
 * screen hands both off to the legacy app (CLAUDE.md — the four modals were not migrated), so the
 * elements are markup parity rather than live sockets. Dropping them would diff.
 */
export function UsersSubnav(props: UsersSubnavProps) {
  return (
    <>
      <div className="subnav" style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
        {USERS_VIEWS.map((v) => (
          <button key={v} className={'btn sm' + (v === props.active ? ' p' : '')} id={'uv_' + v}
                  onClick={() => props.onView(v)}>{VIEW_LABEL[v]}</button>
        ))}
      </div>
      <div id="uv_body">{props.children}</div>
      <div id="user_modal"></div>
      <div id="role_modal"></div>
    </>
  );
}

export interface UsersPanelProps {
  /** `userForm(null)` — app.html:5161's "+ Add user". */
  onAdd: () => void;
  /** `#users_out`'s content. Absent is the spinner `usersLoad()` paints before its three calls land. */
  children?: React.ReactNode;
}

/** `usersLoad()`'s first write — app.html:5160. Every byte of `#uv_body`. */
export function UsersPanel(props: UsersPanelProps) {
  return (
    <div className="panel">
      <div className="panel-hd">
        <h3>User access · who can log in &amp; what they see</h3>
        <button className="btn p" onClick={props.onAdd}>+ Add user</button>
      </div>
      <div id="users_out">
        {props.children ?? <div className="load"><span className="spin"></span>Loading…</div>}
      </div>
    </div>
  );
}

export interface FinanceUsersProps {
  users: User[];
  userCompanies: UserCompany[];
  companies: Company[];
  roles: Role[];
  /** The instant `relTime()` measures against — `Date.now()` in the route, FIXED_MS in the test. */
  now: number;
  /** `userEdit(i)` — app.html:5197. The index into `users`, not the user id: that is the legacy contract. */
  onEdit: (i: number) => void;
  /** `userReset(i)` — app.html:5204. Same index, and it sets a password. */
  onReset: (i: number) => void;
}

/**
 * `usersLoad()`'s second write — app.html:5194. Every byte of `#users_out`.
 *
 * Three rows of name / role / companies that look alike, each carrying `userEdit(i)` and `userReset(i)`
 * — the defect this screen is built to make catchable is a button bound to a neighbouring row. R1
 * strips both from the string diff, so handler parity is the only thing holding them.
 */
export default function FinanceUsersTable(props: FinanceUsersProps) {
  // `USERS_UC` / `USERS_UC_ROLE` — app.html:5169-5172. Grouped here rather than in the route because a
  // component is a pure function of its props and this is a fold of one of them.
  const byUser: Record<string, UserCompany[]> = {};
  props.userCompanies.forEach((x) => { (byUser[x.user_id] = byUser[x.user_id] || []).push(x); });

  return (
    <div className="tbl-wrap">
      <table className="bigtable">
        <thead>
          <tr>
            <th>User</th><th>Role</th><th>Company access</th><th>Last login</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {props.users.map((u, i) => (
            <tr key={u.id}>
              <td>
                <b>{u.name || ''}</b>{' '}
                {u.totp_enabled
                  ? <span className="pill pill-green" style={{ fontSize: '9px' }} title="Two-factor authentication on">🔐 2FA</span>
                  : null}
                <br />
                <span className="muted" style={{ fontSize: '11px' }}>{u.email}</span>
              </td>
              <td><span className={'pill ' + rolePillClass(u.role)}>{roleLabelFor(u.role, props.roles)}</span></td>
              <td className="muted" style={{ fontSize: '11.5px' }}>
                <CompanyAccess user={u} rows={byUser[u.id] || []} companies={props.companies} />
              </td>
              <td>
                <div className="muted" style={{ fontSize: '11px' }}>
                  {relTime(u.last_login_at, props.now)}
                  {u.last_login_ip ? ' · ' : ''}
                  {u.last_login_ip ? <span style={{ fontFamily: 'monospace' }}>{u.last_login_ip}</span> : null}
                  {u.login_count ? ' · ' + u.login_count + '×' : ''}
                </div>
              </td>
              <td>
                {u.active
                  ? <span className="pill pill-green">active</span>
                  : <span className="pill pill-draft">disabled</span>}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm" onClick={() => props.onEdit(i)}>Edit</button>{' '}
                <button className="btn sm" onClick={() => props.onReset(i)}>🔑 Reset</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * `compTxt` — app.html:5185-5192.
 *
 * A company the user is assigned to prints its NAME; a per-company role override prints in coral after
 * it. With nothing assigned, an admin gets "All companies (admin)" and everyone else an em-dashed
 * "none" — and the difference matters: the first says the blank row means everything, the second says
 * it means nothing.
 *
 * LEGACY FINDING, deliberately not fixed: the legacy interpolates `nm` (the company name, and the raw
 * tenant_id when no company matches) into its HTML string WITHOUT `esc()`, while `ov` beside it IS
 * escaped. React escapes text always, so a company name carrying `&` or `<` would diff here — the
 * fixture's names are plain, so nothing fires today. React is the safer of the two; that is a finding
 * about app.html, not a relaxation, and it is pinned in the screen's test.
 */
function CompanyAccess({ user, rows, companies }: { user: User; rows: UserCompany[]; companies: Company[] }) {
  if (!rows.length) {
    return <>{user.role === 'admin' ? 'All companies (admin)' : '— none assigned —'}</>;
  }
  return (
    <>
      {rows.map((x, k) => {
        const c = companies.filter((y) => y.tenant_id === x.tenant_id)[0];
        const nm = c ? c.tenant_name : x.tenant_id;
        return (
          <Fragment key={x.tenant_id}>
            {k ? ', ' : ''}
            {nm}
            {x.role ? ' ' : ''}
            {x.role ? <span style={{ color: 'var(--coral-soft)', fontSize: '10.5px' }}>{'(' + x.role + ')'}</span> : null}
          </Fragment>
        );
      })}
    </>
  );
}
