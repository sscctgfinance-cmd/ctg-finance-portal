'use client';

// The route. Everything impure lives here — the session, the three loads `usersLoad()` makes, the
// sub-view the operator is on, the `prompt()` a password reset asks for and the POST it sends — so that
// src/finance-users.tsx stays a pure function of its props and can be diffed against the legacy golden.
// Same split as app/finance/approvals/page.tsx.
//
// `users` IS on `render(t)`'s `asyncTabs` list (app.html:1505), so the legacy paints `spin('users')`
// before it can show anything. That skeleton belongs to `tab()`, not to the screen (CLAUDE.md: the
// `loaded.<tab>` flag does not port, and neither does the placeholder that exists because the legacy
// overwrites one shared div) — here `usersLoad()`'s OWN spinner, which IS in the golden as `#uv_body`,
// fills the same gap.
//
// ── ONLY THE `users` SUB-VIEW IS MIGRATED ─────────────────────────────────────────────────────────
// `usersView()` (app.html:5114) dispatches over five sub-views. Four of them — Roles & permissions,
// Active sessions, Audit log, Xero sync — are separate renderers with no golden of their own, so they
// hand off to `app.html#tab=users`, the honest strangler edge `whtDocHtml()` established. The buttons
// stay buttons, with the same handler arguments the golden carries, because turning one into an anchor
// would drop it out of handler parity (finance.bankfeed's finding, in reverse).
//
// ── `+ Add user` AND `Edit` HAND OFF TOO ──────────────────────────────────────────────────────────
// Both open `userForm()` (app.html:5211), which writes a MODAL into `#user_modal`. The four legacy
// modals were not migrated (CLAUDE.md), and a form that grants company access and roles is not one to
// re-express without a golden to diff it against. `🔑 Reset` is NOT a modal — it is `prompt()` plus one
// POST — so it is ported, with the browser's own prompt carrying the legacy wording, exactly as
// app/finance/approvals/page.tsx uses the browser's `confirm()`.

import { useCallback, useEffect, useState } from 'react';

import FinanceUsersTable, {
  MIGRATED_VIEW, MIN_PASSWORD, UsersPanel, UsersSubnav, resetBody, usersReachable,
  type Company, type Perms, type Role, type User, type UserCompany, type UsersView,
} from '../../../src/finance-users';
import { call, legacyUrl, token } from '../../../src/portal';

interface UsersResponse { ok?: boolean; error?: string; users?: User[]; user_companies?: UserCompany[] }

export default function FinanceUsersPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [userCompanies, setUserCompanies] = useState<UserCompany[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // `USERS_VIEW` — app.html:4972, and `renderUsers()` opens on it. Only MIGRATED_VIEW renders here.
  const [view] = useState<UsersView>(MIGRATED_VIEW);

  const load = useCallback(() => {
    // `usersLoad()` — app.html:5159. Three calls, in the legacy's order: roles, companies, then users.
    void (async () => {
      try {
        const rs = await call<{ roles?: Role[] }>({ api: 'roles_list' });
        setRoles((rs && rs.roles) || []);
        const co = await call<{ companies?: Company[] }>({ api: 'companies_list' });
        setCompanies((co && co.companies) || []);
        const r = await call<UsersResponse>({ api: 'users_list' });
        if (!r || r.ok === false) { setError((r && r.error) || 'failed'); return; }
        setUsers(r.users || []);
        setUserCompanies(r.user_companies || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE. app.html:1422 LOOKS like `!canManage` and is overwritten by the chain's final
    // `else` two lines later — see usersReachable(). The server checks the role on every `users_*`
    // handler, so this is tab visibility rather than the boundary.
    void call<Perms>({ api: 'my_perms' })
      .then((p) => { setPerms(p); if (usersReachable(p)) load(); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const legacyUsers = `${legacyUrl('app.html')}#tab=users`;

  /** `usersView(v)` — app.html:5114. Four of the five sub-views live in the legacy app. */
  const onView = useCallback((v: UsersView) => {
    if (v === MIGRATED_VIEW) return;
    window.location.href = legacyUsers;
  }, [legacyUsers]);

  /** `userForm(null)` / `userEdit(i)` — app.html:5211, :5197. Both open the un-migrated modal. */
  const onForm = useCallback(() => { window.location.href = legacyUsers; }, [legacyUsers]);

  /** `userReset(i)` — app.html:5204, wording and rules included. */
  const onReset = useCallback((i: number) => {
    const u = (users || [])[i];
    if (!u) return;
    const pw = window.prompt('Set a new password for ' + (u.name || u.email) +
      ' (min ' + MIN_PASSWORD + ' chars). The user can change it after signing in.');
    if (pw == null) return;
    if (pw.length < MIN_PASSWORD) { setErr('Password must be at least ' + MIN_PASSWORD + ' characters'); return; }
    void (async () => {
      try {
        await call(resetBody(u.id, pw));
        setErr('Password reset for ' + (u.name || u.email));
      } catch (e) {
        setErr('Reset failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    })();
  }, [users]);

  const body = () => {
    if (error !== null) return <div style={{ color: 'var(--red-soft)' }}>{error}</div>;
    if (!users) return undefined;   // UsersPanel paints usersLoad()'s own spinner
    return (
      <FinanceUsersTable
        users={users} userCompanies={userCompanies} companies={companies} roles={roles}
        now={Date.now()} onEdit={onForm} onReset={onReset}
      />
    );
  };

  return (
    <>
      <Banner />
      {err ? <Panel>{err}</Panel> : null}
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : perms !== null && !usersReachable(perms)
          ? <Panel>
              Users is not on your feature list — it lists every login, its role and its company access, and
              can reset a password. Ask an administrator if you need access.
            </Panel>
        : perms === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : <UsersSubnav active={view} onView={onView}>
            <UsersPanel onAdd={onForm}>{body()}</UsersPanel>
          </UsersSubnav>}
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
        <a href={`${legacyUrl('app.html')}#tab=users`}>app.html · Users</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
        Roles &amp; permissions, sessions, the audit log, Xero sync and the add/edit form are still there.
      </div>
    </div>
  );
}
