'use client';

// The route. Everything impure lives here — the session, the `{api:'pending'}` load, the company the
// chrome's select is showing, the reject confirmation, the `{api:'approve'}` post and the in-flight set
// — so that src/finance-approvals.tsx stays a pure function of its props and can be diffed against the
// legacy golden. Same split as app/finance/wht/page.tsx.
//
// `approvals` IS on `render(t)`'s `asyncTabs` list (app.html:1504) — `renderApprovals()` cannot paint
// before its fetch resolves — so unlike Collections and Bank Rec this route has a real load step, and
// the screen's `bills={null}` skeleton is what fills it.
//
// THE COMPANY FILTER comes from the chrome, not from this page: `curCo()` (app.html:1535) reads
// `#company`, the select `src/finance-shell.tsx` renders, and `onCompany()` re-renders the active tab.
// The layout owns that state and does not pass it down, so this route reads the same element by id —
// exactly as app/finance/recon/page.tsx reads `rc_co` — and listens for its change event to re-filter.
//
// REJECT VOIDS THE BILL IN XERO and cannot be undone; the legacy screen asks first, via `showConfirm()`
// (app.html:2395). That modal IS migrated now — src/confirm.tsx — so this asks with the app's own
// dialog carrying the legacy's title, sentence and button word, rather than with the browser's.

import { useCallback, useEffect, useRef, useState } from 'react';

import FinanceApprovals, {
  approvalsReachable, decideBody, type Bill, type Decision, type Perms,
} from '../../../src/finance-approvals';
import { showConfirm } from '../../../src/confirm';
import { call, legacyUrl, token } from '../../../src/portal';

export default function FinanceApprovalsPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [noData, setNoData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number[]>([]);
  // SYNCHRONOUS refuse gate, per row — see hr/expenses `savingRef` (PR #112). `busy` is state, so two
  // taps on the same row in one tick both read it empty before React re-renders and both apply or VOID
  // the same Xero bill. The ref holds the in-flight indices and refuses the second synchronously.
  const busyRef = useRef<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE — app.html:1434, the chain's final `else`. Approvals is a FEATURE tab, not an
    // admin one: see approvalsReachable()'s doc comment. The server checks the role and the tenant on
    // every `approve`, so this is tab visibility rather than the boundary.
    void call<Perms>({ api: 'my_perms' })
      .then((p) => {
        setPerms(p);
        if (!approvalsReachable(p)) return;
        // `renderApprovals()` — app.html:2359-2364, including both of its failure branches.
        return call<{ ok?: boolean; error?: string; bills?: Bill[] }>({ api: 'pending' })
          .then((r) => {
            if (r && r.ok === false) { setError(r.error || 'Could not load approvals'); return; }
            if (!r || !r.bills) { setNoData(true); return; }
            setBills(r.bills);
          });
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  // `curCo()` — app.html:1535. The chrome owns the select; this reads it and follows it.
  useEffect(() => {
    const el = document.getElementById('company') as HTMLSelectElement | null;
    if (!el) return;
    setFilter(el.value || '');
    const on = () => setFilter(el.value || '');
    el.addEventListener('change', on);
    return () => el.removeEventListener('change', on);
  }, []);

  /** `approve(tenant, invoice, action, i)` — app.html:2402. */
  const onDecide = useCallback((tenant: string, invoice: string, action: Decision, i: number) => {
    // app.html:2411 sets `pointer-events:none` on the row, which does NOT stop a keyboard activation.
    // A second post would apply or void the same bill twice, so the in-flight row is refused here too.
    if (busy.indexOf(i) >= 0 || busyRef.current.has(i)) return;
    busyRef.current.add(i);
    void (async () => {
      try {
      // `showConfirm('Reject Bill', …, 'Reject', 'd')` — app.html:2413, now the ported dialog rather
      // than the browser's. Same title, same sentence, same button word.
      if (action === 'reject' && !await showConfirm('Reject Bill',
        'Reject and void this bill? This action cannot be undone.', 'Reject', 'd')) return;
      setBusy((b) => b.concat(i));
      try {
        const r = await call<{ ok?: boolean; error?: string }>(decideBody(tenant, invoice, action));
        if (r && r.ok) {
          // app.html:2417 — the decided row leaves the list. Nothing else on the screen changes.
          setBills((prev) => (prev || []).filter((b) => b.invoice_id !== invoice));
        } else {
          setErr('Failed: ' + ((r && r.error) || 'Xero rejected'));
        }
      } catch (e) {
        setErr('Failed: ' + (e instanceof Error ? e.message : String(e)));
      } finally {
        setBusy((b) => b.filter((x) => x !== i));
      }
      } finally {
        busyRef.current.delete(i);
      }
    })();
  }, [busy]);

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
        : perms !== null && !approvalsReachable(perms)
          ? <Panel>
              Approvals is not on your feature list — it approves and voids supplier bills in Xero. Ask an
              administrator if you need access.
            </Panel>
        : perms === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : <FinanceApprovals bills={bills} filter={filter} error={error} noData={noData} busy={busy} onDecide={onDecide} />}
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
        <a href={`${legacyUrl('app.html')}#tab=approvals`}>app.html · Approvals</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
