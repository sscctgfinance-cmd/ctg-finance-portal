'use client';

// The route. Everything impure lives here — the session, the fetch, the day window — so that
// src/finance-calendar.tsx stays a pure function of its props and can be diffed against the legacy
// golden. Same split as app/finance/collections/page.tsx.
//
// Calendar IS on `render(t)`'s `asyncTabs` list (app.html:1504): it fetches before it can paint, so
// there is a load step. In the legacy app that is `spin('calendar')` overwriting the shared div; here it
// is an ordinary branch, and the skeleton reaches no golden because `calRender()` overwrites the same id
// (see the screen's test, which pins that).
//
// The gate is SERVER-SIDE (app.html:1426 — always visible), so this route does not withhold the screen
// from anyone. `portal_compliance_calendar` decides, and its refusal is rendered as a refusal: an
// HTTP-200 `{ok:false}` becomes the 🔒 panel, anything else the ⚠️ one. src/portal.ts throws on both
// where common.js returns the first, so the split is `e instanceof TypeError` — the same safe direction
// app/finance/pharm/page.tsx takes, since it can only over-state a refusal.

import { useCallback, useEffect, useState } from 'react';

import FinanceCalendar, {
  calendarBody, Failed, Refused, type Deadline,
} from '../../../src/finance-calendar';
import { call, legacyUrl, token } from '../../../src/portal';

export default function FinanceCalendarPage() {
  /** `CAL_DAYS` — app.html:6898. 365 at load. */
  const [days, setDays] = useState(365);
  /** `CAL_DATA` — null while loading, which is a DIFFERENT document from an empty calendar. */
  const [deadlines, setDeadlines] = useState<Deadline[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  /** `renderCalendar()` — app.html:6899. */
  const load = useCallback((d: number) => {
    setDeadlines(null);
    setRefused(null);
    setFailed(null);
    void (async () => {
      try {
        const r = await call<{ deadlines?: Deadline[] }>(calendarBody(d));
        setDeadlines(r.deadlines || []);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof TypeError) setFailed(msg); else setRefused(msg);
      }
    })();
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (t) load(365);
  }, [load]);

  /** `CAL_DAYS=<n>;renderCalendar()` — app.html:6924. Sets the window AND re-fetches, in that order. */
  const onDays = useCallback((d: number) => { setDays(d); load(d); }, [load]);

  return (
    <>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : refused !== null ? <Refused error={refused} />
        : failed !== null ? <Failed error={failed} />
        : deadlines === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : <FinanceCalendar deadlines={deadlines} days={days} onDays={onDays} />}
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
        <a href={`${legacyUrl('app.html')}#tab=calendar`}>app.html · Compliance Calendar</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
