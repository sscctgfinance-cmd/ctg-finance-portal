'use client';

// The route. Everything impure lives here — the session, the fetch, the search state — so that
// src/finance-pharm.tsx stays a pure function of its props and can be diffed against the legacy golden.
// Same split as the other nine Finance screens; see app/finance/wht/page.tsx for the convention.
//
// ── THE REFUSAL BRANCH, and the one place this route is not byte-exact ─────────────────────────────
// `renderPharm()` (app.html:6598) distinguishes two failures: a RETURNED `{ok:false}` payload → the 🔒
// panel naming SKINDAE, and a THROW → the ⚠️ panel. common.js's `call()` returns the first and throws
// the second (common.js:67 only throws when the HTTP status is not ok).
//
// web/src/portal.ts's `call()` throws on BOTH (portal.ts:50-51), and this route may not edit it. So the
// split is made on what is still distinguishable: a transport failure surfaces as the TypeError `fetch`
// itself raises, which portal.ts does not wrap; everything else is a message the SERVER produced, which
// is exactly what the legacy 🔒 branch prints. The one case that lands differently from the legacy is a
// non-2xx carrying a server message (a 401 on a dead token) — legacy shows ⚠️, this shows 🔒 with the
// same text. That is the safe direction: it can only over-state the refusal, never render a refusal as
// an empty success.
//
// `pharmOpen(id)` / `pharmNewStart()` open `pharmRenderDetail()` (app.html:6733) — the seven-section
// profile form with its save, delete and Xero-contact-link modal, which is NOT migrated. Handing off to
// the legacy tab is the honest strangler edge `finance.wht` uses for `whtDocHtml()`: same origin, same
// session, and the operator lands on the screen that can actually edit the record.

import { useCallback, useEffect, useRef, useState } from 'react';

import FinancePharm, { pharmReachable, type Pharmacy } from '../../../src/finance-pharm';
import { call, legacyUrl, token } from '../../../src/portal';

export default function FinancePharmPage() {
  const [pharmacies, setPharmacies] = useState<Pharmacy[] | null>(null);
  const [editable, setEditable] = useState(false);
  const [search, setSearch] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // No client gate: app.html:1425 shows this tab to everyone and the server decides. pharmReachable()
    // is called anyway so the rule has one place, and the screen's test pins it.
    if (!pharmReachable()) return;
    void call<{ pharmacies?: Pharmacy[]; editable?: boolean }>({ api: 'pharmacy_list' })
      .then((r) => { setPharmacies(r.pharmacies || []); setEditable(!!r.editable); })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof TypeError) setFailed(msg); else setRefused(msg || 'Failed to load');
      });
  }, []);

  /** `_pharmSearchDebounced` — app.html:6592, the same 180ms. */
  const onSearch = useCallback((v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSearch(v), 180);
  }, []);

  const toLegacy = useCallback(() => { location.href = `${legacyUrl('app.html')}#tab=pharm`; }, []);

  if (signedIn === false) {
    return (
      <>
        <Banner />
        <div className="panel"><div className="muted" style={{ padding: '18px' }}>
          Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
          the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
          already be signed in.
        </div></div>
      </>
    );
  }

  return (
    <>
      <Banner />
      <FinancePharm
        pharmacies={pharmacies}
        search={search}
        editable={editable}
        refused={refused}
        failed={failed}
        onSearch={onSearch}
        onOpen={toLegacy}
        onNew={toLegacy}
      />
    </>
  );
}

function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('app.html')}#tab=pharm`}>app.html · Pharmacies</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
