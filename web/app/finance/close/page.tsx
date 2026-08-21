'use client';

// The route. Everything impure lives here — the session, the `{api:'close_list'}` load, the period the
// operator picks, the `{api:'close_update'}` posts and the error banner — so that
// src/finance-close.tsx stays a pure function of its props and can be diffed against the legacy golden.
// Same split as app/finance/ctgaccess/page.tsx.
//
// `close` IS on `render(t)`'s `asyncTabs` list in spirit but not in fact: `renderClose()` is synchronous
// and paints its own frame with a muted "Loading…" inside `#close_out`, then lets `closeLoad()` fill it.
// That is mirrored here by `tasks === null` plus the `initial` flag rather than by a second component.
//
// THE PERIOD IS READ BACK OUT OF THE DOM, exactly as the legacy does — `closeLoad()` reads
// `document.getElementById('close_period').value`. The input stays uncontrolled and keeps that id, so a
// month typed into it and a month loaded can never disagree.

import { useCallback, useEffect, useRef, useState } from 'react';

import FinanceClose, {
  assignBody, closeReachable, defaultPeriod, updateBody,
  type CloseTask, type Perms,
} from '../../../src/finance-close';
import { call, legacyUrl, token } from '../../../src/portal';

interface ListResponse { ok?: boolean; error?: string; tasks?: CloseTask[] }

export default function FinanceClosePage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [tasks, setTasks] = useState<CloseTask[] | null>(null);
  const [initial, setInitial] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // The period `renderClose()` seeds the input with — MYT, not UTC (app.html:5739). Frozen on mount so
  // a re-render cannot shift the label out from under the rows already on screen.
  const period = useRef(defaultPeriod(Date.now())).current;

  /** `closeLoad()` — app.html:5743, including both of its failure branches. */
  const load = useCallback(() => {
    const el = document.getElementById('close_period') as HTMLInputElement | null;
    const p = (el && el.value) || period;
    setInitial(false);
    setTasks(null);
    setError(null);
    void call<ListResponse>({ api: 'close_list', period: p })
      .then((r) => setTasks(r.tasks || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [period]);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE — app.html:1434's final `else`, the FEATURE flag. See closeReachable().
    void call<Perms>({ api: 'my_perms' })
      .then((p) => { setPerms(p); if (closeReachable(p)) load(); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [load]);

  /** `closeSet(id, status)` — app.html:5764. Reloads on success, toasts on failure. */
  const onSet = useCallback((id: string, status: string) => {
    void call<{ ok?: boolean; error?: string }>(updateBody(id, status))
      .then((r) => { if (r && r.ok !== false) load(); else setErr((r && r.error) || 'failed'); })
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, [load]);

  /** `closeAssign(id, assignee)` — app.html:5765. Fire-and-forget, exactly as the legacy is. */
  const onAssign = useCallback((id: string, assignee: string) => {
    void call(assignBody(id, assignee)).catch(() => {});
  }, []);

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
        : perms !== null && !closeReachable(perms)
          ? <Panel>
              Month-end close is not one of your role&apos;s features. Ask an administrator if you need it.
            </Panel>
        : perms === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : <FinanceClose
            period={period} tasks={tasks} initial={initial} error={error}
            onLoad={load} onSet={onSet} onAssign={onAssign} />}
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
        <a href={`${legacyUrl('app.html')}#tab=close`}>app.html · Close</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
