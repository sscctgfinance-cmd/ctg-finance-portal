'use client';

// The route. Everything impure lives here — the session, the drag-and-drop wiring, the file read, the
// XLSX decode, the provider detection, the CSV blob and the state — so that src/finance-gateway.tsx
// stays a pure function of its props and can be diffed against the legacy golden. Same split as
// app/finance/recon/page.tsx, which has the same XLSX arrangement.
//
// `gateway` is NOT on `render(t)`'s `asyncTabs` list (app.html:1507): the screen paints immediately and
// fetches nothing ever — it talks to no server at all. The only network call here is `my_perms`, for the
// gate.
//
// The drag listeners are attached with `addEventListener` on a ref rather than as `onDragOver` props,
// because that is what the legacy does (app.html:3816-3820) and the golden therefore carries no drag
// handler. Adding React props for them would put handlers on `#gw-drop` that the golden does not have,
// and handler parity would fail — correctly, because it would be a change to the screen.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  gwCSV, gwDetect, gwNewAudit, gwConvertRows, gwOutName,
  type GwAudit, type GwFile, type GwFiles, type GwProvider, type GwRow,
} from '../../../../gateway.js';
import FinanceGateway, { downloadRows, gatewayReachable, type GwResult, type Perms } from '../../../src/finance-gateway';
import { call, legacyUrl, token } from '../../../src/portal';
import FailedLoad, { OVERVIEW_HOME } from '../../../src/failed-load';

interface Xlsx {
  read: (data: unknown, opts: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json: (ws: unknown, opts: Record<string, unknown>) => Record<string, unknown>[] };
}

/** `gwLoadXlsx()` — app.html:3760, minus its callback queue. Same vendored file, same origin. */
function loadXlsx(): Promise<Xlsx | null> {
  const w = window as unknown as { XLSX?: Xlsx };
  if (w.XLSX) return Promise.resolve(w.XLSX);
  return new Promise((res) => {
    const s = document.createElement('script');
    s.src = legacyUrl('xlsx.full.min.js');
    s.onload = () => res(w.XLSX || null);
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });
}

/** `GW`'s per-provider file slots — app.html:3758. */
type Loaded = Record<GwProvider, GwFiles>;
const EMPTY: Loaded = { payex: {}, atome: {}, hitpay: {}, nttdata: {} };

export default function FinanceGatewayPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const [provider, setProvider] = useState<GwProvider>('payex');
  const [files, setFiles] = useState<Loaded>(EMPTY);
  const [result, setResult] = useState<GwResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE — app.html:1434, `!canManage`. See gatewayReachable()'s doc comment: this is
    // inside showApp()'s if/else if chain, so it is NOT the feature flag its `o2o`/`recon` neighbours
    // fall through to. Nothing on this screen posts, so the tab gate is the only gate there is.
    void call<Perms & { ok?: boolean }>({ api: 'my_perms' })
      .then(setPerms)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  /** `gwHandleFiles()` — app.html:3844. Detection decides the provider, exactly as the legacy does. */
  const handleFiles = useCallback((list: FileList | null) => {
    if (!list || !list.length) return;
    void loadXlsx().then((XLSX) => {
      if (!XLSX) { setNote('Could not load the spreadsheet engine (xlsx.full.min.js). Check your connection and retry.'); return; }
      Array.prototype.forEach.call(list, (file: File) => {
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const wb = XLSX.read(rd.result, { type: 'array', cellDates: true });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
            if (!rows.length) { setNote(file.name + ': empty sheet'); return; }
            const keys = Object.keys(rows[0]).map((k) => k.toLowerCase().trim());
            const det = gwDetect(keys);
            if (!det) { setNote(file.name + ': unrecognised columns (not a known Payex/Atome/HitPay export)'); return; }
            const loaded: GwFile = { name: file.name, rows };
            setFiles((f) => ({ ...f, [det[0]]: { ...f[det[0]], [det[1]]: loaded } }));
            setProvider(det[0]);
            setResult(null);
            setNote(file.name + ' loaded (' + rows.length + ' rows)');
          } catch (e) {
            setNote(file.name + ': read failed — ' + (e instanceof Error ? e.message : String(e)));
          }
        };
        rd.readAsArrayBuffer(file);
      });
    });
  }, []);

  // `renderGateway()`'s drop listeners — app.html:3816-3820, including the border repaint.
  useEffect(() => {
    const dz = rootRef.current?.querySelector('#gw-drop') as HTMLElement | null;
    if (!dz) return;
    const over = (ev: Event) => { ev.preventDefault(); dz.style.borderColor = 'var(--coral)'; };
    const leave = (ev: Event) => { ev.preventDefault(); dz.style.borderColor = 'var(--border)'; };
    const drop = (ev: DragEvent) => { ev.preventDefault(); dz.style.borderColor = 'var(--border)'; handleFiles(ev.dataTransfer?.files ?? null); };
    dz.addEventListener('dragover', over); dz.addEventListener('dragenter', over);
    dz.addEventListener('dragleave', leave); dz.addEventListener('drop', drop as EventListener);
    return () => {
      dz.removeEventListener('dragover', over); dz.removeEventListener('dragenter', over);
      dz.removeEventListener('dragleave', leave); dz.removeEventListener('drop', drop as EventListener);
    };
  }, [handleFiles, perms]);

  /** `gwConvert()` — app.html:3866. The four controls are read back out of the DOM, as they are there. */
  const convert = useCallback(() => {
    const g = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    const fmt = (g('gw-datefmt') as HTMLSelectElement | null)?.value || 'ymd';
    const refField = (g('gw-ref') as HTMLSelectElement | null)?.value || '';
    const wantPayout = !!(g('gw-payout') as HTMLInputElement | null)?.checked;
    const wantFee = !!(g('gw-fee') as HTMLInputElement | null)?.checked;
    const audit: GwAudit = gwNewAudit();
    const rows = gwConvertRows(provider, files[provider], audit, fmt, refField, wantPayout, wantFee);
    setResult({ provider, rows, audit, files: files[provider] });
  }, [provider, files]);

  /** `gwDownload(which)` — app.html:3888, byte for byte including the UTF-8 BOM. */
  const download = useCallback((which: 'all' | 'in' | 'out') => {
    if (!result) return;
    let rows: GwRow[] = result.rows;
    if (which === 'in') rows = rows.filter((r) => r.kind === 'in');
    if (which === 'out') rows = rows.filter((r) => r.kind === 'out');
    if (!rows.length) { setNote('Nothing to download.'); return; }
    const blob = new Blob(['﻿' + gwCSV(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = gwOutName(result.provider, which, rows);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, [result]);

  /** `gwReset()` — app.html:3838. Clears every provider's files, not just the visible one. */
  const reset = useCallback(() => {
    setFiles(EMPTY);
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  return (
    <>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <FailedLoad message={err} home={OVERVIEW_HOME} />
        : perms === null ? <Panel><span className="spin"></span> Checking your access…</Panel>
        : !gatewayReachable(perms)
          ? <Panel>
              Gateway → Xero is an administrator tool — it reads a company&apos;s full gateway settlement
              history and writes it out as a bank-statement CSV. Ask an administrator if you need access.
            </Panel>
        : (
          <div ref={rootRef}>
            {note ? <div className="panel" style={{ marginBottom: '14px' }}><div className="muted" style={{ padding: '10px 14px', fontSize: '12px' }}>{note}</div></div> : null}
            {/*
              The hidden file input lives INSIDE the pure component (it is in the golden), so the route
              reaches it by its legacy id — the same contract `gwHandleFiles()` and `gwReset()` use.
            */}
            <FinanceGateway
              provider={provider}
              files={files[provider]}
              result={result}
              onProvider={(pv) => { setProvider(pv); setResult(null); }}
              onReset={reset}
              onBrowse={() => {
                const el = (fileRef.current ??= document.getElementById('gw_fi') as HTMLInputElement | null);
                el?.click();
              }}
              onConvert={convert}
              onDownload={download}
            />
            <Picker onFiles={handleFiles} />
          </div>
        )}
    </>
  );
}

/**
 * The `change` listener `renderGateway()` attaches to `#gw_fi` (app.html:3821). It is attached here
 * rather than as an `onChange` prop for the same reason the drag listeners are: the golden's file input
 * carries no handler attribute, so a React prop there would fail handler parity.
 */
function Picker({ onFiles }: { onFiles: (l: FileList | null) => void }) {
  useEffect(() => {
    const el = document.getElementById('gw_fi') as HTMLInputElement | null;
    if (!el) return;
    const on = (ev: Event) => { onFiles((ev.target as HTMLInputElement).files); (ev.target as HTMLInputElement).value = ''; };
    el.addEventListener('change', on);
    return () => el.removeEventListener('change', on);
  }, [onFiles]);
  return null;
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel"><div className="muted" style={{ padding: '18px' }}>{children}</div></div>;
}

function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('app.html')}#tab=gateway`}>app.html · Gateway → Xero</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
