'use client';

// The route. Everything impure lives here — the session, the drag/drop and file listeners, the XLSX
// decode, the two Xero lookups, the POST, the CSV/xlsx downloads and the state — so that
// src/finance-salesrecon.tsx stays a pure function of its props and can be diffed against the legacy
// golden. Same split as app/finance/recon/page.tsx.
//
// `salesrecon` is NOT on `render(t)`'s `asyncTabs` list (app.html:1504): the screen paints immediately
// and fetches nothing until the operator presses Reconcile. So there is no load step here, only the
// permission resolve.
//
// The ARITHMETIC is salesrecon.js's, imported — see src/finance-salesrecon.tsx's header for why. What
// this file adds around it is exactly what `srBuild()` (app.html:3621) adds: the decode, the two awaits,
// the confirm() and the progress messages.
//
// XLSX is the vendored `xlsx.full.min.js` app.html loads as a classic script, pulled in from the same
// origin on first use — the same arrangement app/finance/recon/page.tsx and app/hr/payslip/page.tsx have.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  SR_CFG, SR_TENANT,
  srApplySoSuffix, srApplyYrdz, srBuildLines, srCsv, srOrderLookup, srPostBody, srPostChunks,
  srReportSheets, srSmartCols, srSoBases, srSummary, srTag, srTally, srYrdzPeriods,
  type SrLine, type SrOrder, type SrSheet, type SrSoInfo, type SrTallyRow,
} from '../../../../salesrecon.js';
import FinanceSalesRecon, {
  salesreconReachable, type Perms, type SrResult,
} from '../../../src/finance-salesrecon';
import { showConfirm } from '../../../src/confirm';
import { call, legacyUrl, token } from '../../../src/portal';

interface Xlsx {
  read: (data: unknown, opts: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json: (ws: unknown, opts: Record<string, unknown>) => never[];
    book_new: () => unknown;
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    aoa_to_sheet: (rows: unknown[][]) => unknown;
  };
  writeFile: (wb: unknown, name: string) => void;
}

type Wb = { SheetNames: string[]; Sheets: Record<string, unknown> };

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

/** `srSheetRows(ws)` — app.html:3563. The XLSX decode, which is why it is here and not in salesrecon.js. */
function sheetRows(XLSX: Xlsx, ws: unknown): Record<string, unknown>[] {
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  let hr = 0;
  for (let i = 0; i < Math.min(8, aoa.length); i++) { if ((aoa[i] || []).filter((c) => c !== '' && c != null).length >= 4) { hr = i; break; } }
  const H = (aoa[hr] || []).map((c) => String(c).trim());
  const rows: Record<string, unknown>[] = [];
  for (let i = hr + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r.some((c) => c !== '' && c != null)) continue;
    const o: Record<string, unknown> = {};
    H.forEach((h, j) => { o[h] = r[j]; });
    rows.push(o);
  }
  return rows;
}

export default function FinanceSalesReconPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const [ofName, setOfName] = useState<string | null>(null);
  const [sfName, setSfName] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<SrResult | null>(null);
  const [note, setNote] = useState<string[]>([]);

  // `SR.of` / `SR.sf` — the workbooks themselves are not state the screen renders, so they live in a ref
  // exactly as the legacy keeps them on the SR global.
  const of = useRef<{ name: string; wb: Wb } | null>(null);
  const sf = useRef<{ name: string; wb: Wb } | null>(null);
  const lines = useRef<SrLine[]>([]);
  const tally = useRef<SrTallyRow[] | null>(null);
  const posted = useRef(false);

  const say = useCallback((m: string) => setNote((n) => [...n.slice(-4), m]), []);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE — app.html:1433. Sales Recon is an ADMIN tab (`!canManage`), not one of the
    // feature-flagged ones: see salesreconReachable()'s doc comment. The server wants superAdmin on all
    // three `sr_*` handlers (finance.ts:857, 899, 926), so this is tab visibility rather than the boundary.
    void call<Perms & { ok?: boolean }>({ api: 'my_perms' })
      .then(setPerms)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  /** `srFiles(list)` — app.html:3592. Content-first classification, the legacy's own tests. */
  const takeFiles = useCallback(async (list: FileList | null) => {
    if (!list || !list.length) return;
    const XLSX = await loadXlsx();
    if (!XLSX) { say('Could not load the spreadsheet reader (xlsx.full.min.js).'); return; }
    for (const file of Array.from(list)) {
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true }) as Wb;
        const names = wb.SheetNames.map((s) => s.toUpperCase().trim());
        const ws0 = wb.Sheets[wb.SheetNames[0]];
        const H = ((XLSX.utils.sheet_to_json(ws0, { header: 1, defval: '' })[0] as unknown[]) || []).map((c) => String(c).trim());
        const isOF = H.indexOf('Order No') >= 0 && (H.indexOf('Grand Total') >= 0 || H.indexOf('Package') >= 0 || H.indexOf('Channel') >= 0);
        const isSales = !isOF && (names.some((n) => !!SR_CFG[n]) || wb.SheetNames.some((sn) => !!srSmartCols(sheetRows(XLSX, wb.Sheets[sn]))));
        if (isOF) { of.current = { name: file.name, wb }; setOfName(file.name); }
        else if (isSales) { sf.current = { name: file.name, wb }; setSfName(file.name + ' · ' + wb.SheetNames.length + ' sheets'); }
        else say(file.name + ': unrecognised — no Order Form headers and no sheet with recognisable date + amount content');
      } catch (e) {
        say(file.name + ': read failed — ' + (e instanceof Error ? e.message : String(e)));
      }
    }
  }, [say]);

  /** `renderSalesRecon()`'s four addEventListener calls — app.html:3667-3670, by the same element ids. */
  useEffect(() => {
    const dz = document.getElementById('sr-drop');
    const fi = document.getElementById('sr-fi') as HTMLInputElement | null;
    if (!dz || !fi) return;
    const over = (ev: Event) => { ev.preventDefault(); (dz as HTMLElement).style.borderColor = 'var(--coral)'; };
    const leave = (ev: Event) => { ev.preventDefault(); (dz as HTMLElement).style.borderColor = 'var(--border)'; };
    const drop = (ev: DragEvent) => { ev.preventDefault(); (dz as HTMLElement).style.borderColor = 'var(--border)'; void takeFiles(ev.dataTransfer?.files || null); };
    const change = (ev: Event) => { const t = ev.target as HTMLInputElement; void takeFiles(t.files); t.value = ''; };
    dz.addEventListener('dragover', over); dz.addEventListener('dragenter', over);
    dz.addEventListener('dragleave', leave); dz.addEventListener('drop', drop as EventListener);
    fi.addEventListener('change', change);
    return () => {
      dz.removeEventListener('dragover', over); dz.removeEventListener('dragenter', over);
      dz.removeEventListener('dragleave', leave); dz.removeEventListener('drop', drop as EventListener);
      fi.removeEventListener('change', change);
    };
  }, [takeFiles, perms]);

  /** `srReset()` — app.html:3591. */
  const onReset = useCallback(() => {
    of.current = null; sf.current = null; lines.current = []; tally.current = null; posted.current = false;
    setOfName(null); setSfName(null); setResult(null); setNote([]);
  }, []);

  /** `srBuild()` — app.html:3621. The four passes are salesrecon.js's; the I/O between them is here. */
  const onBuild = useCallback(async () => {
    if (!of.current || !sf.current) { say('Load both the Order Form and the Sales file.'); return; }
    const XLSX = await loadXlsx();
    if (!XLSX) { say('Could not load the spreadsheet reader (xlsx.full.min.js).'); return; }
    // Pass 1
    const ofWs = of.current.wb.Sheets[of.current.wb.SheetNames[0]];
    const lk = srOrderLookup(XLSX.utils.sheet_to_json(ofWs, { header: 1, raw: true, defval: '' }));
    const LK: Record<string, SrOrder> = lk.lookup;
    const sheets: SrSheet[] = sf.current.wb.SheetNames.map((sn) => ({ name: sn, rows: sheetRows(XLSX, sf.current!.wb.Sheets[sn]) }));
    const built = srBuildLines(LK, sheets);
    const out = built.lines;
    if (built.skipped.length) say('⚠ Skipped sheet(s): ' + built.skipped.join(' · '));
    if (built.smartNote.length) say('Content-recognised columns — ' + built.smartNote.join(' | '));
    if (!out.length) { say('No payment rows recognised in the Sales file.'); return; }
    // Pass 2 — YRDZ numbering continues from what is already in Xero.
    const pers = srYrdzPeriods(out);
    let base: Record<string, number> = {};
    if (pers.length) {
      say('Checking Xero for existing YRDZ numbering…');
      let res: { ok?: boolean; max?: Record<string, number>; error?: string } | null = null;
      try { res = await call({ api: 'sr_yrdz_next', tenant: SR_TENANT, prefixes: pers.map((p) => 'YRDZ_' + p + '_') }); } catch { res = null; }
      if (res && res.ok) base = res.max || {};
      else {
        // The legacy asks before restarting at 0001, and the question is the only thing between a failed
        // lookup and a month imported into Xero twice. Not dropped in the port — same call as Approvals'
        // reject confirm.
        if (!await showConfirm('Xero lookup failed',
          'Could not check Xero for existing YRDZ numbers (' + ((res && res.error) || 'network error') + ').\n\nContinue starting from 0001 anyway?\n⚠ Risk: duplicate invoice numbers if this month was already imported into Xero.',
          'Continue anyway')) return;
        base = {};
      }
    }
    const contDesc = srApplyYrdz(out, base);
    if (contDesc.length) say('YRDZ numbering: ' + contDesc.join(' · '));
    if (built.swapNote.length) say('Date repair: Excel-swapped DD/MM detected + corrected on sheet(s): ' + built.swapNote.join(', '));
    // Pass 3 — repeat payments on one SO get the next free suffix.
    const soList = srSoBases(out);
    let soInfo: Record<string, SrSoInfo> = {};
    if (soList.length) {
      let res2: { ok?: boolean; existing?: Record<string, SrSoInfo>; error?: string } | null = null;
      try { res2 = await call({ api: 'sr_so_suffix', tenant: SR_TENANT, bases: soList }); } catch { res2 = null; }
      if (res2 && res2.ok) soInfo = res2.existing || {};
      else say('Could not check Xero for existing SO numbers (' + ((res2 && res2.error) || 'network') + ') — duplicates de-duplicated within this file only.');
    }
    const soDup = srApplySoSuffix(out, soInfo);
    if (soDup) say(soDup + ' repeat SO payment(s) suffixed _1, _2 … (unique in Xero)');
    // Pass 4 — reports only.
    const t = lk.hasGrandTotal ? srTally(out, LK, soInfo) : null;
    if (t) {
      const mm = t.filter((x) => x.st === 'short' || x.st === 'over').length;
      if (mm) say('⚠ SO tally: ' + mm + ' SO(s) where payments ≠ Order Form total — see the tally table');
    }
    lines.current = out; tally.current = t; posted.current = false;
    setResult({ lines: out, summary: srSummary(out), tally: t });
  }, [say]);

  /** `srPostXero()` — app.html:3775. */
  const onPostXero = useCallback(async () => {
    const out = lines.current;
    if (!out.length) { say('Nothing to post.'); return; }
    // `SR._posting` (app.html:3777). The legacy also disables the button, which does NOT stop a keyboard
    // activation — same gap Approvals has — so the guard is the state, not the attribute.
    if (posting) { say('Already posting…'); return; }
    const total = out.reduce((s, l) => s + l.amt, 0);
    if (!await showConfirm('Create Sales Invoices in Xero',
      'Create ' + out.length + ' Sales Invoices in Xero (I PROCARE) as DRAFT?\nTotal RM ' + total.toFixed(2) + '\n\nThey go in as DRAFT — you review & approve inside Xero.\nInvoice numbers are unique, so already-created ones are skipped automatically.',
      'Create drafts', 'p')) return;
    setPosting(true);
    try {
      let ok = 0, dup = 0, fail = 0, done = 0;
      const failures: string[] = [];
      const chunks = srPostChunks(out);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        say('Creating ' + (done + 1) + '–' + (done + chunk.length) + ' of ' + out.length + ' in Xero…');
        let r: { ok?: boolean; posted?: number; dup?: number; fail?: number; error?: string; failures?: { number: string; error: string }[] } | null = null;
        try { r = await call(srPostBody(SR_TENANT, chunk)); } catch (e) { r = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
        if (!r || !r.ok) { say((r && r.error) || 'Posting failed at batch ' + (i + 1) + ' — already-created invoices are safe; fix and retry.'); break; }
        done += chunk.length;
        ok += r.posted || 0; dup += r.dup || 0; fail += r.fail || 0;
        (r.failures || []).forEach((x) => failures.push(x.number + ': ' + x.error));
      }
      posted.current = true;
      say('Xero: ' + ok + ' draft invoice(s) created' + (dup ? (' · ' + dup + ' already existed (skipped)') : '') + (fail ? (' · ' + fail + ' FAILED') : ''));
      if (failures.length) say('Failed invoices (' + failures.length + '): ' + failures.slice(0, 12).join(' | ') + (failures.length > 12 ? ' …' : ''));
    } finally { setPosting(false); }
  }, [posting, say]);

  const download = useCallback((blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }, []);

  /** `srDownloadCSV()` — app.html:3767. The CSV itself is salesrecon.js's. */
  const onDownloadCsv = useCallback(() => {
    if (!lines.current.length) { say('Nothing to export.'); return; }
    download(new Blob([srCsv(lines.current)], { type: 'text/csv;charset=utf-8' }), 'IPROCARE_Xero_SalesInvoice_' + srTag(lines.current) + '.csv');
  }, [download, say]);

  /** `srDownloadXlsx()` — app.html:3794. The sheets are salesrecon.js's; XLSX writes them. */
  const onDownloadXlsx = useCallback(async () => {
    if (!lines.current.length) { say('Nothing to export.'); return; }
    const XLSX = await loadXlsx();
    if (!XLSX) { say('Could not load the spreadsheet reader (xlsx.full.min.js).'); return; }
    const wb = XLSX.utils.book_new();
    srReportSheets(lines.current, tally.current).forEach((sh) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.rows), sh.name));
    XLSX.writeFile(wb, 'IPROCARE_Sales_Reconciliation_' + srTag(lines.current) + '.xlsx');
  }, [say]);

  return (
    <>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
        : perms === null ? <Panel><span className="spin"></span> Checking your access…</Panel>
        : !salesreconReachable(perms)
          ? <Panel>
              Sales Reconciliation is administrator-only — it creates draft Sales Invoices in this
              company&apos;s Xero. Ask an administrator if you need access.
            </Panel>
        : <>
            <FinanceSalesRecon
              ofName={ofName}
              sfName={sfName}
              canBuild={!!(ofName && sfName)}
              posting={posting}
              result={result}
              onReset={onReset}
              onOpenPicker={() => document.getElementById('sr-fi')?.click()}
              onBuild={() => { void onBuild(); }}
              onPostXero={() => { void onPostXero(); }}
              onDownloadCsv={onDownloadCsv}
              onDownloadXlsx={() => { void onDownloadXlsx(); }}
            />
            {note.length
              ? <div className="panel" style={{ marginTop: '14px' }}><div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px', lineHeight: 1.7 }}>{note.map((n, i) => <div key={i}>{n}</div>)}</div></div>
              : null}
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
        <a href={`${legacyUrl('app.html')}#tab=salesrecon`}>app.html · Sales Reconciliation</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
