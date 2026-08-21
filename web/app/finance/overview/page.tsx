'use client';

// The route. Everything impure lives here — the session, the three loads, the company the chrome is
// scoped to, the period state, the two lazy loaders and their stale-response guards — so that
// src/finance-overview.tsx stays a pure function of its props and can be diffed against the legacy
// golden. Same split as app/finance/approvals/page.tsx.
//
// `overview` IS on `render(t)`'s `asyncTabs` list (app.html:1507), so it fetches before it can paint and
// this route has a load step. THREE loads, deliberately kept separate exactly as app.html keeps them:
// the tab's own (`overview` or `overview_range`), then `ovTrendLoad()` and `ovChartsLoad()`, which
// app.html fires WITHOUT awaiting so the cards appear before the charts do.
//
// TWO STALE-RESPONSE GUARDS ARE PORTED, not invented. `ovTrendLoad()` (app.html:2152) drops a response
// whose `scoped_tenant` no longer matches the company bar, and `ovChartsLoad()` (app.html:2265, added in
// v190 for exactly this reason) drops one whose tenant no longer matches. Without them an A-response
// landing after the operator moved to B either shows B's screen with A's figures or blanks the charts.
//
// `#last-refresh` is the shell's chrome div (finance-shell.tsx:127, rendered empty) and app.html:2140
// writes into it. It is PORTALLED rather than written by hand: the shell is off limits, and a portal
// keeps the markup a pure component's output so the golden's own `#last-refresh` section can diff it.

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import FinanceOverview, {
  LastRefresh, OvCharts, OvChartsError, OvChartsLoading, OvTrend, OvTrendError, OvTrendLoading,
  overviewReachable, ovDates,
  type OvMonth, type OvRange, type OvRangeData, type OvVendor, type OvYtd, type Perms, type PnlReport,
} from '../../../src/finance-overview';
import { call, legacyUrl, token } from '../../../src/portal';

interface OverviewResponse { ok?: boolean; error?: string; companies?: OvYtd['companies']; as_of?: string | null }
interface RangeResponse { ok?: boolean; error?: string; companies?: OvRangeData['companies']; partial?: boolean; unavailable?: string[]; source?: string }
interface TrendResponse { ok?: boolean; error?: string; scoped_tenant?: string | null; monthly?: OvMonth[]; top_vendors?: OvVendor[] }
interface PnlResponse extends PnlReport { ok?: boolean; error?: string }

export default function FinanceOverviewPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const [range, setRange] = useState<OvRange | null>(null);
  const [ytd, setYtd] = useState<OvYtd | null>(null);
  const [rangeData, setRangeData] = useState<OvRangeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noData, setNoData] = useState(false);

  const [trend, setTrend] = useState<React.ReactNode>(<OvTrendLoading />);
  const [charts, setCharts] = useState<React.ReactNode>(<OvChartsLoading />);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [lrNode, setLrNode] = useState<HTMLElement | null>(null);

  // `curCo()` — app.html:1538. The chrome owns the select; this reads it and follows it.
  useEffect(() => {
    const el = document.getElementById('company') as HTMLSelectElement | null;
    if (!el) return;
    setFilter(el.value || '');
    const on = () => setFilter(el.value || '');
    el.addEventListener('change', on);
    return () => el.removeEventListener('change', on);
  }, []);

  // The shell renders `#last-refresh` empty and never gives it children, so portalling into it is safe.
  useEffect(() => { setLrNode(document.getElementById('last-refresh')); }, []);

  /** `renderOverview()`'s own load — app.html:2085 / :2108, both branches. */
  const load = useCallback((r: OvRange | null, co: string) => {
    setYtd(null); setRangeData(null); setError(null); setNoData(false);
    setTrend(<OvTrendLoading />); setCharts(<OvChartsLoading />);

    const tabLoad = r === null
      ? call<OverviewResponse>({ api: 'overview' }).then((res) => {
          if (res && res.ok === false) { setError(res.error || 'Could not load overview'); return false; }
          if (!res || !res.companies) { setNoData(true); return false; }
          setYtd({ companies: res.companies, as_of: res.as_of ?? null });
          return true;
        })
      : call<RangeResponse>({ api: 'overview_range', from: r.from, to: r.to }).then((res) => {
          if (!res || !res.companies) { setError((res && res.error) || null); setNoData(true); return false; }
          setRangeData({ companies: res.companies, partial: res.partial, unavailable: res.unavailable, source: res.source });
          return true;
        });

    void tabLoad
      .then((ok) => {
        // app.html:2086/:2087/:2109 all `return` before appending the placeholders and before touching
        // `#last-refresh`, so an error screen gets neither the charts nor a refreshed-at time.
        if (!ok) return;
        setRefreshedAt(Date.now());
        void trendLoad(co);
        void chartsLoad(co, r);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

    /** `ovTrendLoad()` — app.html:2146, including its stale-response guard and both failure branches. */
    async function trendLoad(scopedTo: string) {
      try {
        const res = await call<TrendResponse>({ api: 'group_dashboard', months: 12, tenant: scopedTo || null });
        if (res && res.ok && (res.scoped_tenant || null) !== (scopedTo || null)) return;   // company switched mid-load
        if (!res || !res.ok) { setTrend(<OvTrendError ico="📉" message={(res && res.error) || 'Could not load trend'} />); return; }
        setTrend(<OvTrend monthly={res.monthly || []} vendors={res.top_vendors || []} />);
      } catch (e) {
        setTrend(<OvTrendError ico="⚠️" message={e instanceof Error ? e.message : String(e)} />);
      }
    }

    /** `ovChartsLoad()` — app.html:2254, including v190's guard and both failure branches. */
    async function chartsLoad(scopedTo: string, rr: OvRange | null) {
      try {
        const body: Record<string, unknown> = { api: 'pnl_report' };
        if (scopedTo) body.tenant = scopedTo;
        if (rr) { body.from = rr.from; body.to = rr.to; }
        const res = await call<PnlResponse>(body);
        if ((document.getElementById('company') as HTMLSelectElement | null)?.value !== scopedTo) return;
        if (!res || !res.ok) { setCharts(<OvChartsError ico="📉" message={(res && res.error) || 'Could not load P&L'} />); return; }
        setCharts(<OvCharts report={res} filter={scopedTo} />);
      } catch (e) {
        setCharts(<OvChartsError ico="⚠️" message={e instanceof Error ? e.message : String(e)} />);
      }
    }
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE — app.html:1434's final `else`, a FEATURE flag: see overviewReachable()'s doc
    // comment. `renderOverview()` has no role check of its own and this screen shows every company's
    // bank balance, so the route refuses to LOAD on a false, not merely to render.
    void call<Perms>({ api: 'my_perms' })
      .then((p) => { setPerms(p); if (overviewReachable(p)) load(null, (document.getElementById('company') as HTMLSelectElement | null)?.value || ''); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [load]);

  // A company switch re-runs every load, exactly as `onCompany()` re-renders the tab (app.html:1526).
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    if (!booted) { setBooted(true); return; }
    if (perms && overviewReachable(perms)) load(range, filter);
  }, [filter]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** `ovSetPreset(key)` — app.html:1618. `current` is the null range. */
  const onPreset = useCallback((key: string) => {
    const next = key === 'current' ? null : (ovDates(Date.now())[key] || null);
    if (key !== 'current' && !next) return;                  // app.html:1620 — an unknown key does nothing
    setRange(next);
    load(next, (document.getElementById('company') as HTMLSelectElement | null)?.value || '');
  }, [load]);

  /**
   * `ovApplyCustom()` — app.html:1623. Reads the two inputs back out of the DOM by their legacy ids,
   * which is why the screen keeps them uncontrolled, and refuses the two bad inputs the legacy refuses.
   */
  const onApplyCustom = useCallback(() => {
    const f = (document.getElementById('ov_from') as HTMLInputElement | null)?.value || '';
    const t = (document.getElementById('ov_to') as HTMLInputElement | null)?.value || '';
    if (!f || !t) { setErr('Pick both From and To dates'); return; }
    if (t < f) { setErr('To date is before From date'); return; }
    setErr(null);
    const next: OvRange = { from: f, to: t, label: f + ' → ' + t };
    setRange(next);
    load(next, (document.getElementById('company') as HTMLSelectElement | null)?.value || '');
  }, [load]);

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
        : perms !== null && !overviewReachable(perms)
          ? <Panel>
              Overview is not part of your role. It shows every company&apos;s revenue, expenses, net profit
              and cash position. Ask an administrator if you need it.
            </Panel>
        : perms === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : <>
            <FinanceOverview
              range={range} now={Date.now()} filter={filter}
              ytd={ytd} rangeData={rangeData} error={error} noData={noData}
              onPreset={onPreset} onApplyCustom={onApplyCustom}
              trend={trend} charts={charts}
            />
            {lrNode && refreshedAt !== null ? createPortal(<LastRefresh now={refreshedAt} />, lrNode) : null}
          </>}
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
        <a href={`${legacyUrl('app.html')}#tab=overview`}>app.html · Overview</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
