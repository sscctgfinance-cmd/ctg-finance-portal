'use client';

// The route. Everything impure lives here — the session, the `{api:'pnl_analysis'}` load, the company
// scope, the 6/12 toggle, the show-zero flag and the CSV download — so that src/finance-pnl.tsx stays a
// pure function of its props and can be diffed against the legacy golden.
//
// `pnl` IS on `render(t)`'s asyncTabs list (app.html:1504): `renderPnl()` paints a spinner, awaits the
// fetch, and only then calls `pnlRender()`. Both write the SAME element, which is why the golden holds
// the loaded screen and not the spinner — see the screen's test.
//
// THE COMPANY SCOPE IS READ BACK OUT OF THE DOM, exactly as the legacy does. `curCo()` (app.html:1539)
// is `document.getElementById('company').value` and `cfoScopeName()` (app.html:1836) turns it into a
// name; the shell keeps that same id (src/finance-shell.tsx:118), so this reads the one control rather
// than holding a second copy of the selection that could disagree with the picker on screen. A `change`
// on it reloads, which is `onCompany()`'s (app.html:1526) effect for this tab.
//
// THE STALE GUARD IS THE LEGACY'S OWN: `renderPnl()` drops a response whose `scoped_tenant` no longer
// matches the picker, because an operator who switches company mid-load would otherwise read another
// company's P&L under this company's heading.

import { useCallback, useEffect, useRef, useState } from 'react';

import { pnlBuild, pnlCsvLines, pnlCsvName } from '../../../../pnl.js';
import FinancePnl, {
  PnlFailure, PnlLoading, pnlReachable,
  type Perms, type PnlData,
} from '../../../src/finance-pnl';
import { call, legacyUrl, token } from '../../../src/portal';

/** `curCo()` — app.html:1539. The shell's picker is the one source of the selection. */
function curCo(): string {
  const el = document.getElementById('company') as HTMLSelectElement | null;
  return (el && el.value) || '';
}

/** `cfoScopeName()` — app.html:1836, off the same control. */
function scopeName(): string | null {
  const el = document.getElementById('company') as HTMLSelectElement | null;
  if (!el || !el.value || el.selectedIndex < 0) return null;
  return el.options[el.selectedIndex].text;
}

/** `todayLocalISO()` — app.html:1261. MYT, so an export made before 8am is not filed under yesterday. */
function todayLocalISO(): string {
  const d = new Date(Date.now() + 8 * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

type Failure = { kind: 'refused' | 'threw'; message: string } | null;

export default function FinancePnlPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<PnlData | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const [months, setMonths] = useState(6);
  const [showZero, setShowZero] = useState(false);
  const [scopeCo, setScopeCo] = useState<string | null>(null);
  // Bumped by the ↻ Refresh button and by a change on the shell's company picker.
  const [nonce, setNonce] = useState(0);
  const gate = useRef(false);

  /** `renderPnl()` — app.html:4364, including its stale guard and both failure branches. */
  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE — app.html:1434's final `else`, the FEATURE flag. See pnlReachable().
    void call<Perms>({ api: 'my_perms' })
      .then((p) => { setPerms(p); gate.current = pnlReachable(p); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!gate.current) return;
    let dropped = false;
    const asked = curCo() || null;
    setData(null);
    setFailure(null);
    setScopeCo(scopeName());
    void call<PnlData>({ api: 'pnl_analysis', tenant: asked, months })
      .then((r) => {
        // Stale — the operator switched company mid-load. app.html:4372.
        if (dropped || (r.scoped_tenant || null) !== (curCo() || null)) return;
        setData(r);
      })
      .catch((e) => {
        if (dropped) return;
        // portal.ts throws on BOTH an `{ok:false}` body and a transport failure, where common.js
        // returns the first. Only a transport failure is a TypeError, so splitting on it keeps the
        // legacy's two documents apart — finance/pharm/page.tsx makes the same split for the same reason.
        setFailure(e instanceof TypeError
          ? { kind: 'threw', message: e.message || String(e) }
          : { kind: 'refused', message: (e instanceof Error && e.message) || 'Could not load the P&L' });
      });
    return () => { dropped = true; };
  }, [months, nonce, perms]);

  // `onCompany()` (app.html:1526) re-renders the active tab when the picker moves.
  useEffect(() => {
    const el = document.getElementById('company');
    if (!el) return;
    const onChange = () => setNonce((n) => n + 1);
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);

  /** `pnlSetMonths(n)` — app.html:4375. A no-op when the span has not changed, as the legacy is. */
  const onMonths = useCallback((n: number) => setMonths((cur) => (cur === n ? cur : (Number(n) || 6))), []);

  const onToggleZero = useCallback(() => setShowZero((z) => !z), []);

  const onRefresh = useCallback(() => setNonce((n) => n + 1), []);

  /** `pnlExportCsv()` — app.html:4517. The lines and the name are pnl.js's; only the download is here. */
  const onExport = useCallback(() => {
    if (!data) { window.alert('Nothing to export yet'); return; }
    try {
      const mdl = pnlBuild(data, months, showZero);
      const lines = pnlCsvLines(mdl, data.totals);
      const fn = pnlCsvName(scopeName() || 'All companies', mdl.months.length, todayLocalISO());
      const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fn;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 800);
      void call({ api: 'export_log', what: 'pnl', tab: 'pnl', rows: Math.max(0, lines.length - 1), filename: fn }).catch(() => {});
    } catch (e) {
      window.alert('Export failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [data, months, showZero]);

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
        : perms !== null && !pnlReachable(perms)
          ? <Panel>P&amp;L Analysis is not one of your role&apos;s features. Ask an administrator if you need it.</Panel>
        : perms === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : failure ? <PnlFailure kind={failure.kind} message={failure.message} />
        : data === null ? <PnlLoading scopeCo={scopeCo} />
        : <FinancePnl
            data={data} months={months} showZero={showZero} scopeCo={scopeCo}
            onMonths={onMonths} onToggleZero={onToggleZero} onExport={onExport} onRefresh={onRefresh} />}
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
        <a href={`${legacyUrl('app.html')}#tab=pnl`}>app.html · P&amp;L Analysis</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
