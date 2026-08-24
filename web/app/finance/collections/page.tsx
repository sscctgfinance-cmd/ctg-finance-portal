'use client';

// The route. Everything impure lives here — the session, the POST, the busy flag — so that
// src/finance-collections.tsx stays a pure function of its props and can be diffed against the legacy
// golden. Same split as app/finance/wht/page.tsx; see that file for the Finance route convention
// (`app/finance/<tab-id>/`, where <tab-id> is the tab's own `data-t`).
//
// Collections is NOT on `render(t)`'s `asyncTabs` list (app.html:1504) — it fetches nothing to paint,
// so there is no load step. The only call it ever makes is the one the operator asks for by pressing
// the button, and that call SENDS MAIL, so it is made from here and nowhere else.

import { useCallback, useEffect, useRef, useState } from 'react';

import FinanceCollections, { collectionsReachable, previewBody, type CollPreview, type Perms } from '../../../src/finance-collections';
import { call, legacyUrl, token } from '../../../src/portal';
import FailedLoad, { OVERVIEW_HOME } from '../../../src/failed-load';

export default function FinanceCollectionsPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [busy, setBusy] = useState(false);
  // SYNCHRONOUS refuse gate — see hr/expenses `savingRef` (PR #112). The button had no `if (busy)`
  // guard at all, so two taps in one tick both fired `previewBody()` and mailed the collections run
  // twice. The state is only what the button READS; the ref is what refuses.
  const busyRef = useRef(false);
  const [result, setResult] = useState<CollPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE — app.html:1434, the chain's final `else`. Collections is a feature tab.
    // `collectionsReachable()` is exported from the screen so the screen's own test can pin both
    // directions. The server is the boundary: `portal_trigger_collections` takes the token.
    void call<Perms>({ api: 'my_perms' })
      .then(setPerms)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  /** `trigColl(btn)` — app.html:2434, including its failure copy. */
  const onGenerate = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    void (async () => {
      try {
        const r = await call<{ result?: CollPreview }>(previewBody());
        setResult(r.result || {});
        setError(null);
      } catch {
        // app.html:2446 — the legacy branch shows one message whatever the failure was.
        setResult(null);
        setError('no permission or network issue');
      } finally {
        setBusy(false);
        busyRef.current = false;
      }
    })();
  }, []);

  return (
    <>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <FailedLoad message={err} home={OVERVIEW_HOME} />
        : perms !== null && !collectionsReachable(perms)
          ? <Panel>Collections is not one of the features on your login. Ask an administrator if you need access.</Panel>
        : perms === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : <FinanceCollections busy={busy} result={result} error={error} onGenerate={onGenerate} />}
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
        <a href={`${legacyUrl('app.html')}#tab=collections`}>app.html · Collections</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
