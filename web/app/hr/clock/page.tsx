'use client';

// The route. Everything impure lives here — the session, the fetches, the 1s tick, the geolocation
// prompt — so that src/hr-clock.tsx stays a pure function of its props and can be diffed against the
// legacy golden. Same split as the pilot:
//
//   app/<area>/<screen>/page.tsx   'use client', loads, holds state, wires handlers   — not golden-tested
//   src/<screen>.tsx              pure, props in / markup out                         — golden-tested

import { useCallback, useEffect, useRef, useState } from 'react';

import HrClock, { type ClockStatus } from '../../../src/hr-clock';
import { call, legacyUrl, token } from '../../../src/portal';
import FailedLoad from '../../../src/failed-load';

/** `hrClkTick()` — hros.html:2910. Same arithmetic; here it feeds a prop instead of `el.textContent`. */
function elapsedSince(iso: string, now: number): string {
  let ms = now - new Date(iso).getTime();
  if (!(ms > 0)) ms = 0;
  const p = (n: number) => String(n).padStart(2, '0');
  return p(Math.floor(ms / 3600000)) + ':' + p(Math.floor(ms % 3600000 / 60000)) + ':' + p(Math.floor(ms % 60000 / 1000));
}

/** `hrClkNow()` — hros.html:2909. */
const clkNow = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * `hrGetGeo()` — hros.html:2911. Resolves `{}` rather than rejecting on refusal or timeout, because a
 * punch that fails because someone declined the location prompt is worse than a punch without a
 * location: the clock is the thing they are paid from.
 */
function getGeo(): Promise<Record<string, number>> {
  return new Promise((res) => {
    if (!navigator.geolocation) return res({});
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; res({}); } }, 4000);
    const finish = (v: Record<string, number>) => { if (done) return; done = true; clearTimeout(t); res(v); };
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => finish({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => finish({}),
        { enableHighAccuracy: false, timeout: 3500, maximumAge: 60000 });
    } catch { finish({}); }
  });
}

// v224 — the Web Push device half that used to sit here (b64ToU8 / pushIsIOS / pushStandalone /
// pushInitSW and the enable / disable / test handlers, hros.html:2977-3024) is GONE with the feature.
// `sw.js` is no longer registered from this route; the only thing that still registers it is the
// forwarding page on the OLD origin, whose job is to unregister it. The clock-in reminder survives as
// email — `cron_clock_reminders`, hr.ts:1116 — and nothing here touched that path.

export default function HrClockPage() {
  const [company, setCompany] = useState<string | null>(null);
  const [data, setData] = useState<ClockStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [acting, setActing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const schedRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
      const co = await call<{ companies?: { tenant_id: string; tenant_name: string }[] }>({ api: 'hr_companies' });
      const list = co.companies || [];
      setCompany((list.find((c) => c.tenant_id === saved) || list[0])?.tenant_name || '');
      setData(await call<ClockStatus>({ api: 'clock_status' }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (t) void load();
  }, [load]);

  // `hrClock()` (hros.html:2913) starts one interval and never clears it; an effect owns its own, which
  // is the whole difference. Re-rendering once a second is what advances the elapsed counter.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const onClockAction = useCallback(async (dir: 'in' | 'out') => {
    if (acting) return;
    setActing(true);
    const geo = await getGeo();
    try {
      await call({ api: dir === 'in' ? 'clock_in' : 'clock_out', ...geo });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  }, [acting, load]);

  /**
   * `hrSchedSave()` — hros.html:2971. Reads the inputs back out of the DOM by their ids, exactly as the
   * legacy one does, because the component leaves them uncontrolled for that reason. Scoped to this
   * screen's subtree rather than `document`, so it cannot pick up an id the shell happens to reuse.
   */
  const onSchedSave = useCallback(async () => {
    const root = schedRef.current;
    const v = (id: string) => root?.querySelector<HTMLInputElement>('#' + id)?.value || '';
    const work_days = [1, 2, 3, 4, 5, 6, 7].filter((n) => !!root?.querySelector<HTMLInputElement>('#sch_wd' + n)?.checked);
    try {
      await call({ api: 'hr_shift_save', shift_start: v('sch_start') || null, shift_end: v('sch_end') || null, work_days, reminders_on: true });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [load]);

  return (
    <div ref={schedRef}>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <FailedLoad message={err} />
        : !data || company === null ? <Panel><span className="spin"></span> Loading your clock…</Panel>
        : (
          <HrClock
            data={data}
            companyName={company}
            elapsed={data.open ? elapsedSince(data.open.clock_in, now) : '00:00:00'}
            now={clkNow(now)}
            acting={acting}
            onClockAction={onClockAction}
            onSchedSave={onSchedSave}
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
 * deleted from hros.html and the legacy screen is still the one staff use. This says so on the page
 * rather than only in a PR description, and links straight at the original.
 */
function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React migration.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('hros.html')}#tab=clock`}>hros.html · Time Clock</a>, unchanged. This page renders
        the same data from the same session and is diffed against the same golden. Clock-in reminders
        register the same <code>sw.js</code> at the same scope, so a device subscribed on either app is
        subscribed on both — a reminder still opens the legacy screen, which is what sw.js navigates to.
      </div>
    </div>
  );
}
