'use client';

// The route. Everything impure lives here — the session, the permission fetch — so that
// src/finance-bankfeed.tsx stays a pure function of its props and can be diffed against the legacy
// golden. Same split as every migrated screen: see app/finance/wht/page.tsx.
//
// This is the thinnest Finance route there is, and for a good reason: `renderBankFeed()` fetches
// nothing. `bankfeed` is NOT in `render(t)`'s `asyncTabs` list (app.html:1504), so the legacy tab paints
// from what it already has and needs no skeleton and no load step. The only asynchronous thing on this
// page is the permission check, which is the gate — not the data.
//
// `loaded.bankfeed` (app.html:4057) is deliberately not reproduced; src/finance-bankfeed.tsx's header
// says why (it is already a no-op in the legacy, and a render-once flag in a React component is state
// that can only go stale).

import { useEffect, useState } from 'react';

import FinanceBankFeed, { bankfeedReachable, type Perms } from '../../../src/finance-bankfeed';
import { call, legacyUrl, token } from '../../../src/portal';

export default function FinanceBankFeedPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE — app.html:1432, via `showApp()`'s `canManage` (app.html:1419). Bank Feed is
    // admin-only: it advertises the existence and the address of the company's bank-feed program, which
    // staff sign into with their own banking credentials. `bankfeedReachable()` is exported from the
    // screen so the screen's own test can pin both directions.
    void call<Perms>({ api: 'my_perms' })
      .then(setPerms)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
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
        : err ? <Panel>⚠️ {err}</Panel>
        : perms === null ? <Panel><span className="spin"></span> Checking access…</Panel>
        : !bankfeedReachable(perms)
          ? <Panel>
              Bank Feed is an admin-only screen. Ask an administrator if you need access to the bank-feed
              program.
            </Panel>
          : <FinanceBankFeed />}
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
        <a href={`${legacyUrl('app.html')}#tab=bankfeed`}>app.html · Bank Feed</a>, unchanged.
        This page renders the same launcher from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
