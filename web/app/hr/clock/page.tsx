'use client';

// The route. Everything impure lives here — the session, the fetches, the 1s tick, the geolocation
// prompt — so that src/hr-clock.tsx stays a pure function of its props and can be diffed against the
// legacy golden. Same split as the pilot:
//
//   app/<area>/<screen>/page.tsx   'use client', loads, holds state, wires handlers   — not golden-tested
//   src/<screen>.tsx              pure, props in / markup out                         — golden-tested

import { useCallback, useEffect, useRef, useState } from 'react';

import HrClock, { type ClockStatus, type PushState } from '../../../src/hr-clock';
import { call, legacyUrl, token } from '../../../src/portal';

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

/* ────────────────────── Web Push, the device half — hros.html:2979-3010 ────────────────────── */

/** `pushB64ToU8()` — hros.html:2981. */
function b64ToU8(base64: string): Uint8Array {
  const pad = '='.repeat((4 - base64.length % 4) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** `pushIsIOS()` / `pushStandalone()` — hros.html:2982-2983. */
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent);
const standalone = () =>
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

/** `PUSH.supported` — hros.html:2979. */
const pushSupported = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/**
 * `pushInitSW()` — hros.html:2984.
 *
 * `sw.js` is the SAME service worker the legacy app registers, loaded from the same origin by its own
 * path — `legacyUrl()`, because `navigator.serviceWorker.register('sw.js')` from `/hr/clock/` would
 * resolve to `/hr/clock/sw.js` and 404. Nothing in sw.js changes: it is registered at the root scope by
 * both apps, so a device that enabled reminders on one is already subscribed on the other. A push
 * notification still opens the LEGACY screen, because that is what sw.js navigates to.
 */
async function initSW(): Promise<ServiceWorkerRegistration | null> {
  try {
    const reg = await navigator.serviceWorker.register(legacyUrl('sw.js'));
    await navigator.serviceWorker.ready;
    return reg;
  } catch { return null; }
}

export default function HrClockPage() {
  const [company, setCompany] = useState<string | null>(null);
  const [data, setData] = useState<ClockStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [acting, setActing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const schedRef = useRef<HTMLDivElement>(null);
  /** `PUSH` — hros.html:2979. `null` until the mount check runs, and permanently on an unsupported browser. */
  const [push, setPush] = useState<PushState | null>(null);
  const pushReg = useRef<ServiceWorkerRegistration | null>(null);
  const pushSub = useRef<PushSubscription | null>(null);

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

  /**
   * `pushInitSW()`'s call site — the legacy app runs it at boot; here it runs on mount, and only to find
   * out what to RENDER. It asks for no permission and creates no subscription: `getSubscription()`
   * reports one that already exists, which is how a device that enabled reminders on either app shows as
   * on here. Anything that prompts is behind the button.
   */
  useEffect(() => {
    if (!pushSupported()) return;   // stays null → hrPushCard()'s `return ''`
    let live = true;
    setPush({ on: false, busy: false, iosNeedsInstall: isIOS() && !standalone() });
    void (async () => {
      const reg = await initSW();
      if (!live) return;
      pushReg.current = reg;
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (!live) return;
      pushSub.current = sub;
      setPush({ on: !!sub, busy: false, iosNeedsInstall: isIOS() && !standalone() });
    })();
    return () => { live = false; };
  }, []);

  /** `pushEnable()` — hros.html:2989. */
  const onPushEnable = useCallback(async () => {
    if (!push || push.busy) return;
    if (isIOS() && !standalone()) {
      setErr('On iPhone: Share → Add to Home Screen, open it from there, then enable.');
      setPush({ ...push, iosNeedsInstall: true });
      return;
    }
    setPush({ ...push, busy: true });
    const stop = (msg: string) => { setErr(msg); setPush((p) => (p ? { ...p, busy: false } : p)); };
    try {
      if (await Notification.requestPermission() !== 'granted') {
        return stop('Notifications not allowed — turn them on in your phone/browser settings.');
      }
      if (!pushReg.current) pushReg.current = await initSW();
      if (!pushReg.current) return stop('Couldn’t start the notifier');
      const pk = await call<{ publicKey?: string }>({ api: 'push_pubkey' });
      if (!pk || !pk.publicKey) return stop('Push isn’t set up yet — tell HR.');
      const existing = await pushReg.current.pushManager.getSubscription();
      const sub = existing || await pushReg.current.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: b64ToU8(pk.publicKey) as never,
      });
      pushSub.current = sub;
      await call({ api: 'push_subscribe', subscription: sub.toJSON(), ua: navigator.userAgent.slice(0, 200) });
      setPush({ on: true, busy: false, iosNeedsInstall: false });
    } catch (e) {
      stop('Setup failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [push]);

  /** `pushDisable()` — hros.html:3005. The endpoint is read BEFORE unsubscribing, as the legacy does:
      once `unsubscribe()` resolves there is nothing left to tell the server to forget. */
  const onPushDisable = useCallback(async () => {
    const sub = pushSub.current;
    try {
      if (sub) {
        const endpoint = sub.endpoint;
        try { await sub.unsubscribe(); } catch { /* already gone */ }
        await call({ api: 'push_unsubscribe', endpoint });
        pushSub.current = null;
      }
    } catch { /* hros.html swallows this too — the local state is what the operator sees */ }
    setPush((p) => (p ? { ...p, on: false, busy: false } : p));
  }, []);

  /** `pushTest()` — hros.html:3010. */
  const onPushTest = useCallback(async () => {
    try { await call({ api: 'push_test' }); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);

  return (
    <div ref={schedRef}>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
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
            push={push}
            onPushEnable={onPushEnable}
            onPushDisable={onPushDisable}
            onPushTest={onPushTest}
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
