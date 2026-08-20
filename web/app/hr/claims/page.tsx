'use client';

// The route. Everything impure lives here — the session, the fetches, the state — so that
// src/hr-claims.tsx stays a pure function of its props and can be diffed against the legacy golden.
// Same split as the pilot: see app/hr/access/page.tsx.

import { useCallback, useEffect, useState } from 'react';

import HrClaims, { claimsReachable, type Claim } from '../../../src/hr-claims';
import { call, legacyUrl, token } from '../../../src/portal';

/** hros.html:1410 — the fallback company when the account has no Xero orgs. */
const PROCARE = 'I PROCARE MALAYSIA SDN BHD';
const HR_PROCARE_TENANT = '99911869-9e91-4572-b7dc-4db51b45b6a9';

interface Company { tenant_id: string; tenant_name: string }

export default function HrClaimsPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
      const co = await call<{ companies?: Company[] }>({ api: 'hr_companies' }).catch(() => ({ companies: [] }));
      const list = (co.companies || []).length ? co.companies! : [{ tenant_id: HR_PROCARE_TENANT, tenant_name: PROCARE }];
      const pick = list.find((c) => c.tenant_id === saved) || list.find((c) => c.tenant_name === PROCARE) || list[0];
      setCompany(pick);
      // `renderHR()` — hros.html:1451. Admin-only server side, which is the same boundary the gate below
      // enforces client side; the screen draws `HR.data.claims` straight out of this response.
      const r = await call<{ claims?: Claim[] }>({ api: 'hr_bootstrap', tenant: pick.tenant_id });
      setClaims(r.claims || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE — hros.html:1368 + :1531. Claims is in HR_NAV, not HR_EMP_NAV: every row is
    // another person's claim and the buttons decide their money, so an employee/approver login is never
    // routed here and `hr_bootstrap` is never even asked for. `claimsReachable()` is exported from the
    // screen so tests/hr-claims.parity.test.tsx can pin both directions of it.
    void call<{ user?: { role?: string } }>({ api: 'me' })
      .then((r) => {
        const rl = (r.user && r.user.role) || '';
        setRole(rl);
        if (claimsReachable(rl)) void load();
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [load]);

  /** `hrDecideClaim()` — hros.html:3706. */
  const onDecide = useCallback((id: string, status: 'Approved' | 'Rejected') => {
    void (async () => {
      try {
        await call({ api: 'hr_claim_decide', id, status });
        setNotice('Claim ' + status.toLowerCase());
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [load]);

  return (
    <>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
        : role !== null && !claimsReachable(role)
          ? <Panel>
              Claims is an HR admin screen — it lists every employee&apos;s claims. Your own are under{' '}
              <a href={`${legacyUrl('hros.html')}#tab=expenses`}>Reimbursement</a>.
            </Panel>
        : !claims || !company ? <Panel><span className="spin"></span> Loading claims…</Panel>
        : (
          <>
            {notice ? <Panel>{notice}</Panel> : null}
            <HrClaims claims={claims} companyName={company.tenant_name} onDecide={onDecide} />
          </>
        )}
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
        <a href={`${legacyUrl('hros.html')}#tab=claims`}>hros.html · Claims</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
