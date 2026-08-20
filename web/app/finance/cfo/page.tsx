'use client';

// The route. Everything impure lives here — the session, the TWO loads (`{api:'group_dashboard'}` and
// `{api:'fin_analytics'}`), their stale-response guards, the company scope read out of the chrome and
// the Refresh button — so that src/finance-cfo.tsx stays a pure function of its props and can be diffed
// against the legacy golden. Same split as app/finance/ctgaccess/page.tsx.
//
// `cfo` IS on `render(t)`'s `asyncTabs` list (app.html:1507): it cannot paint before it fetches, so the
// loading state is a real branch here rather than a placeholder. The two requests are independent —
// `cfoRender()` starts the second only after the first paints — and are kept independent here for the
// reason the screen's test pins: a failure in one must not blank the other.
//
// THE STALE GUARD IS NOT AN OPTIMISATION. app.html:1843 and :1938 both drop a response whose
// `scoped_tenant` no longer matches the company now selected. Without it, switching company mid-load
// paints ANOTHER company's revenue, receivables and named customers under the new company's name, with
// nothing on screen saying so.

import { useCallback, useEffect, useRef, useState } from 'react';

import FinanceCfo, {
  Analytics, AnalyticsLoading, cfoReachable, ErrorPanel, Loading, ytdYear,
  type CfoData, type FinData, type Perms,
} from '../../../src/finance-cfo';
import { call, legacyUrl, token } from '../../../src/portal';

interface CfoResponse extends CfoData { ok?: boolean; error?: string }
interface FinResponse extends FinData { ok?: boolean; error?: string }

export default function FinanceCfoPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [tenant, setTenant] = useState<string>('');
  const [scopeName, setScopeName] = useState<string | null>(null);

  const [data, setData] = useState<CfoData | null>(null);
  const [dataErr, setDataErr] = useState<{ icon: string; text: string } | null>(null);
  const [fin, setFin] = useState<FinData | null>(null);
  const [finErr, setFinErr] = useState<{ icon: string; text: string } | null>(null);

  /** Bumped on every Refresh — `CFO_DATA=null;FIN_DATA=null;renderCFO()` (app.html:1921). */
  const [nonce, setNonce] = useState(0);
  const [companyCount, setCompanyCount] = useState(0);

  // `curCo()` (app.html:1535) and `cfoScopeName()` (app.html:1836). The chrome owns the select; this
  // reads it and follows it. The scope NAME is the selected option's own text, which is what
  // cfoScopeName() resolves out of COMPANIES — the same string, without a second request for the list.
  const scopeRef = useRef<string>('');
  scopeRef.current = tenant;
  useEffect(() => {
    const el = document.getElementById('company') as HTMLSelectElement | null;
    if (!el) return;
    const read = () => {
      setTenant(el.value || '');
      setScopeName(el.value ? ((el.selectedOptions[0] && el.selectedOptions[0].textContent) || null) : null);
      setCompanyCount(Math.max(0, el.options.length - 1));   // minus the all-companies option
    };
    read();
    el.addEventListener('change', read);
    return () => el.removeEventListener('change', read);
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE — app.html:1439's fall-through, mirrored by cfoReachable(). The server is the
    // boundary; this is tab visibility, and it is what stops the whole group's financial position being
    // served to a login the legacy would never have shown the tab to.
    void call<Perms>({ api: 'my_perms' })
      .then(setPerms)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const reachable = perms !== null && cfoReachable(perms);

  useEffect(() => {
    if (!reachable) return;
    const want = tenant;
    setData(null); setDataErr(null);
    setFin(null); setFinErr(null);
    void (async () => {
      try {
        const r = await call<CfoResponse>({ api: 'group_dashboard', months: 12, tenant: want || null });
        if ((r.scoped_tenant || '') !== (scopeRef.current || '')) return;   // app.html:1843
        setData(r);
      } catch (e) {
        setDataErr({ icon: '⚠️', text: e instanceof Error ? e.message : String(e) });
        return;
      }
      try {
        const r = await call<FinResponse>({ api: 'fin_analytics', months: 12, tenant: want || null });
        if ((r.scoped_tenant || '') !== (scopeRef.current || '')) return;   // app.html:1938
        setFin(r);
      } catch (e) {
        setFinErr({ icon: '⚠️', text: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [reachable, tenant, nonce]);

  const onRefresh = useCallback(() => setNonce((n) => n + 1), []);

  const analytics = finErr
    ? <ErrorPanel icon={finErr.icon} text={finErr.text} />
    : fin ? <Analytics data={fin} /> : <AnalyticsLoading />;

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
        : perms !== null && !reachable
          ? <Panel>
              CFO Cockpit is not on your feature list — it shows the group&apos;s revenue, net profit, working
              capital, receivables aging and customer credit risk. Ask an administrator if you need access.
            </Panel>
        : perms === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : dataErr ? <ErrorPanel icon={dataErr.icon} text={dataErr.text} />
        : data === null ? <Loading scopeName={scopeName} companyCount={companyCount} />
        : <FinanceCfo
            data={data} scopeName={scopeName} ytdYear={ytdYear(new Date())}
            onRefresh={onRefresh} analytics={analytics} />}
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
        <a href={`${legacyUrl('app.html')}#tab=cfo`}>app.html · CFO Cockpit</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
