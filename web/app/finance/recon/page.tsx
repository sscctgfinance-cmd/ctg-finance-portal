'use client';

// The route. Everything impure lives here — the session, the file read, the XLSX decode, the POST and
// the state — so that src/finance-recon.tsx stays a pure function of its props and can be diffed against
// the legacy golden. Same split as app/finance/wht/page.tsx.
//
// `recon` is NOT on `render(t)`'s `asyncTabs` list (app.html:1504): the screen paints from the company
// list it already has and fetches nothing until a statement is uploaded. So there is no load step here,
// only the permission resolve and the companies.
//
// XLSX is the vendored `xlsx.full.min.js` app.html loads as a classic script, pulled in from the same
// origin on first use — the same arrangement app/hr/payslip/page.tsx has with jspdf.umd.min.js. It is a
// 900 KB parser for a file the operator has not uploaded yet, so it is deliberately not imported.

import { useCallback, useEffect, useState } from 'react';

import FinanceRecon, {
  bankLines, reconcileBody, reconReachable,
  type Perms, type ReconCompany, type ReconOut, type ReconResponse,
} from '../../../src/finance-recon';
import { call, legacyUrl, token } from '../../../src/portal';

interface Xlsx {
  read: (data: unknown, opts: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json: (ws: unknown, opts: Record<string, unknown>) => unknown[][] };
}

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

export default function FinanceReconPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [companies, setCompanies] = useState<ReconCompany[] | null>(null);
  const [out, setOut] = useState<ReconOut>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE — app.html:1434, the chain's final `else`. Bank Rec is a FEATURE, not an
    // admin tab: see reconReachable()'s doc comment. The server checks both the role and the tenant
    // (finance.ts:837-840), so this is tab visibility rather than the boundary.
    void call<Perms & { ok?: boolean }>({ api: 'my_perms' })
      .then((p) => {
        setPerms(p);
        if (reconReachable(p)) {
          return call<{ companies?: ReconCompany[] }>({ api: 'companies_list' })
            .then((c) => setCompanies(c.companies || []));
        }
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  /** `reconRun()` — app.html:5973. The tenant comes from the `rc_co` select, exactly as it does there. */
  const run = useCallback(async (lines: ReturnType<typeof bankLines>) => {
    const t = (document.getElementById('rc_co') as HTMLSelectElement | null)?.value || '';
    if (!t) { setOut({ kind: 'error', message: 'Pick a company' }); return; }
    setOut({ kind: 'loading', lines: lines.length });
    try {
      const r = await call<ReconResponse>(reconcileBody(t, lines));
      setOut({ kind: 'result', data: r });
    } catch (e) {
      setOut({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  /** `reconPick(input)` — app.html:5966, including its "No usable rows" branch. */
  const onPick = useCallback((e: { target: unknown }) => {
    const f = (e.target as HTMLInputElement | null)?.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = (ev) => {
      void (async () => {
        try {
          const XLSX = await loadXlsx();
          if (!XLSX) { setOut({ kind: 'error', message: 'Could not load the spreadsheet reader (xlsx.full.min.js).' }); return; }
          const buf = ev.target?.result as ArrayBuffer;
          const isCsv = /\.csv$/i.test(f.name);
          const wb = isCsv
            ? XLSX.read(new TextDecoder().decode(new Uint8Array(buf)), { type: 'string' })
            : XLSX.read(new Uint8Array(buf), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const lines = bankLines(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null }));
          if (!lines.length) { setOut({ kind: 'empty' }); return; }
          await run(lines);
        } catch (err2) {
          setOut({ kind: 'error', message: err2 instanceof Error ? err2.message : String(err2) });
        }
      })();
    };
    rd.readAsArrayBuffer(f);
  }, [run]);

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
        : perms !== null && !reconReachable(perms)
          ? <Panel>
              Bank Rec is not on your feature list — it matches bank lines against this company&apos;s open Xero
              invoices and bills. Ask an administrator if you need access.
            </Panel>
        : !companies ? <Panel><span className="spin"></span> Loading companies…</Panel>
        : <FinanceRecon companies={companies} out={out} onPick={onPick} />}
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
        <a href={`${legacyUrl('app.html')}#tab=recon`}>app.html · Bank Rec</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
