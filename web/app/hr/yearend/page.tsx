'use client';

// The route. Everything impure lives here — the session, the fetch, the clock read, the jsPDF load and
// the file downloads — so that src/hr-yearend.tsx stays a pure function of its props and can be diffed
// against the legacy golden. Same split as the four screens before it:
//
//   app/<area>/<screen>/page.tsx   'use client', loads, holds state, wires handlers   — not golden-tested
//   src/<screen>.tsx              pure, props in / markup out                         — golden-tested

import { useCallback, useEffect, useRef, useState } from 'react';

import HrYearend, { defaultTaxYear, taxYears, type YeEmployee, type YeTotals } from '../../../src/hr-yearend';
import { call, legacyUrl, token } from '../../../src/portal';

interface Annual { annual?: Record<string, YeTotals>; employer?: { employer_no?: string } | null }

export default function HrYearendPage() {
  const [company, setCompany] = useState<string | null>(null);
  const [employees, setEmployees] = useState<YeEmployee[] | null>(null);
  const [year, setYear] = useState(() => defaultTaxYear(new Date()));
  const [years] = useState(() => taxYears(new Date()));
  const [data, setData] = useState<Annual | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    (async () => {
      try {
        const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
        const co = await call<{ companies?: { tenant_id: string; tenant_name: string }[] }>({ api: 'hr_companies' });
        const list = co.companies || [];
        setCompany((list.find((c) => c.tenant_id === saved) || list[0])?.tenant_name || '');
        setEmployees((await call<{ employees?: YeEmployee[] }>({ api: 'hr_bootstrap' })).employees || []);
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    })();
  }, []);

  /** `hrYeLoad()` — hros.html:4946. Re-runs whenever the Y/A changes, which is what Load does. */
  useEffect(() => {
    if (signedIn !== true) return;
    let live = true;
    setData(null);
    call<Annual>({ api: 'hr_annual', year })
      .then((r) => { if (live) setData({ annual: r.annual || {}, employer: r.employer || null }); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [signedIn, year]);

  /**
   * `hrYePick()` — hros.html:4945. Reads `#hr_yey` back out of the DOM exactly as the legacy one does,
   * because the component leaves the <select> uncontrolled for that reason. Scoped to this screen's
   * subtree rather than `document`, so it cannot pick up an id the shell happens to reuse.
   */
  const onPick = useCallback(() => {
    const v = rootRef.current?.querySelector<HTMLSelectElement>('#hr_yey')?.value;
    if (v) setYear(Number(v));
  }, []);

  /**
   * The three exports are NOT migrated. `hrExpEA` / `hrExpFormE` / `hrExpCp8d` (hros.html:4952-4993)
   * draw through `hr-docs.js`'s jsPDF layouts and `hrDownload`/`hrCsv` from `common.js` — shared classic
   * scripts that both legacy apps load as globals, and that a Next client bundle does not. Wiring them
   * up is its own change (CLAUDE.md's note on hr-docs.js reading HR_EMPLOYER/HR_COMPANY is the reason),
   * so this hands the operator straight back to the legacy screen rather than silently doing nothing.
   */
  const toLegacy = useCallback(() => {
    window.location.href = `${legacyUrl('hros.html')}#tab=yearend`;
  }, []);

  return (
    <div ref={rootRef}>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
        : !employees || company === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : (
          <HrYearend
            year={year}
            years={years}
            employees={employees}
            annual={data?.annual ?? null}
            employerNo={data?.employer?.employer_no || ''}
            companyName={company}
            onPick={onPick}
            onExpEA={toLegacy}
            onExpFormE={toLegacy}
            onExpCp8d={toLegacy}
          />
        )}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel"><div className="muted" style={{ padding: '18px' }}>{children}</div></div>;
}

/**
 * The strangler is explicitly "both versions reachable and comparable side by side" — nothing was
 * deleted from hros.html and the legacy screen is still the one staff use.
 */
function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React migration.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('hros.html')}#tab=yearend`}>hros.html · Year-end</a>, unchanged. This page renders
        the same data from the same session and is diffed against the same golden. The EA / Form E / CP8D
        exports still run on the legacy screen — the buttons here hand you back to it.
      </div>
    </div>
  );
}
