'use client';

// The route. Everything impure lives here — the session, the `{api:'ctg_access_list'}` load, the search
// and filter state, the two confirmations, the grant/revoke posts and the busy flag — so that
// src/finance-ctgaccess.tsx stays a pure function of its props and can be diffed against the legacy
// golden. Same split as app/finance/approvals/page.tsx.
//
// `ctgaccess` is NOT on `render(t)`'s `asyncTabs` list, but `renderCtgAccess()` is async all the same:
// it paints its own panel with a spinner inside `#ctga_body` and then lets `ctgaLoad()` fill it. That is
// mirrored here by the screen's `rows={null}` state rather than by a second component.
//
// BOTH CONFIRMATIONS ARE KEPT. `ctgaGrant()` asks before handing out the ADMIN role and `ctgaRevoke()`
// asks before every revoke, naming the person; the legacy uses the browser's own `confirm()` for both
// (app.html:5087, :5101), not `showConfirm()`, so there is nothing to migrate and nothing to drop.

import { useCallback, useEffect, useState } from 'react';

import FinanceCtgAccess, {
  ctgAccessReachable, grantBody, pickedRole, revokeBody,
  type Counts, type CtgRow, type Filter, type Orphan, type Perms,
} from '../../../src/finance-ctgaccess';
import { call, legacyUrl, token } from '../../../src/portal';

interface ListResponse { ok?: boolean; error?: string; rows?: CtgRow[]; orphans?: Orphan[]; counts?: Counts }

export default function FinanceCtgAccessPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [rows, setRows] = useState<CtgRow[] | null>(null);
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  /** `ctgaLoad()` — app.html:4991, including its failure branch. */
  const load = useCallback(() => {
    setRows(null);
    setError(null);
    void call<ListResponse>({ api: 'ctg_access_list' })
      .then((r) => {
        setRows(r.rows || []);
        setOrphans(r.orphans || []);
        setCounts(r.counts || {});
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No response from the server.'));
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE — app.html:1423. `manage_users`, not the feature list: see
    // ctgAccessReachable()'s doc comment. The server's `ctg_access_*` group checks again on every call,
    // so this is tab visibility rather than the boundary.
    void call<Perms>({ api: 'my_perms' })
      .then((p) => { setPerms(p); if (ctgAccessReachable(p)) load(); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [load]);

  /** `ctgaGrant(sub, role)` — app.html:5083. No role ⇒ read the row's own select. */
  const onGrant = useCallback((sub: string, role?: string) => {
    if (busy) return;                                        // no double-submit — app.html:5084
    const r = role || pickedRole(sub, document as never);
    const who = (rows || []).filter((x) => x.sub === sub)[0];
    if (r === 'admin' && !window.confirm(
      'Give ' + ((who && (who.name || who.email)) || sub) + ' the ADMIN role?\n\n' +
      'Admins can manage users, post to Xero and see every company.')) return;
    setBusy(true);
    void call<{ email?: string }>(grantBody(sub, r))
      .then(() => load())
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not grant access'))
      .finally(() => setBusy(false));
  }, [busy, rows, load]);

  /** `ctgaRevoke(sub, email)` — app.html:5099. The email is what the confirmation names. */
  const onRevoke = useCallback((sub: string, email: string) => {
    if (busy) return;
    if (!window.confirm('Remove ' + email + ' access to this portal?\n\n' +
      'Any session they have open right now ends immediately.')) return;
    setBusy(true);
    void call({ ...revokeBody(sub) })
      .then(() => load())
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not revoke'))
      .finally(() => setBusy(false));
  }, [busy, load]);

  return (
    <>
      <Banner />
      {err ? <Panel>⚠️ {err}</Panel> : null}
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : perms !== null && !ctgAccessReachable(perms)
          ? <Panel>
              CTG Access is for administrators — it lists the CTG Portal staff directory and controls who
              may sign in to this portal. Ask an administrator if you need access.
            </Panel>
        : perms === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : <FinanceCtgAccess
            rows={rows} orphans={orphans} counts={counts} q={q} filter={filter} busy={busy} error={error}
            onFilter={setFilter} onSearch={setQ} onGrant={onGrant} onRevoke={onRevoke} onRefresh={load} />}
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
        <a href={`${legacyUrl('app.html')}#tab=ctgaccess`}>app.html · CTG Access</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
