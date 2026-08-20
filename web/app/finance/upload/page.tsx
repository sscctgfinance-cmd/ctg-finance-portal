'use client';

// The route. Everything impure lives here — the session, the fetch, the FileReader, the DOM reads, the
// state — so that src/finance-upload.tsx stays a pure function of its props and can be diffed against
// the legacy golden. Same split as app/finance/wht/page.tsx; the Finance route convention is documented
// there.
//
// `upload` is NOT on `render(t)`'s `asyncTabs` list (app.html:1504) — it paints from what it already has
// — so there is no load step in front of the screen. `my_perms` is still awaited, because that is the
// gate, and `me` is awaited for the company list, which is what the tenant `<select>` is made of.
//
// ── DocScanner IS SHARED CODE AND IS NOT FORKED, but it cannot be IMPORTED ────────────────────────
// `DocScanner` is common.js's camera → edge-detect → PDF pipeline, and CLAUDE.md is explicit that it is
// a top-level `const` and therefore NOT on `window` — the two legacy apps reach it because a classic
// script's top-level bindings share one global LEXICAL environment, which is not the global OBJECT.
// So neither `import` (common.js is a classic script; web's tsconfig sets `allowJs:false`, and the
// bindings it needs are `window`-scoped app helpers, not exports) nor `window.DocScanner` reaches it.
// What does is an indirect `eval` at global scope, which resolves against exactly that global lexical
// environment. That is four lines and it keeps ONE copy of the scanner; re-expressing a 600-line camera
// pipeline in React to avoid an eval would be the fork this migration exists to prevent.
// The script itself is injected from the same origin, exactly as app/hr/payslip/page.tsx injects
// jspdf.umd.min.js and app/finance/recon/page.tsx injects xlsx.full.min.js.

import { useCallback, useEffect, useRef, useState } from 'react';

import FinanceUpload, {
  chooseUpload, uploadBody, uploadReachable,
  type Company, type Perms, type ScanNote, type UploadOut,
} from '../../../src/finance-upload';
import { call, legacyUrl, token } from '../../../src/portal';

interface DocScannerApi {
  open(o: { multi: boolean; title: string; onDone: (r: { pdfBlob: Blob; jpegDataUrl: string; pageCount: number }) => void }): void;
}

/** common.js's `DocScanner`, reached the only way a module can — see the header. */
function docScanner(): DocScannerApi | null {
  try {
    return (0, eval)('typeof DocScanner !== "undefined" ? DocScanner : null') as DocScannerApi | null;
  } catch {
    return null;
  }
}

let commonLoading: Promise<DocScannerApi | null> | null = null;
function loadDocScanner(): Promise<DocScannerApi | null> {
  const have = docScanner();
  if (have) return Promise.resolve(have);
  if (!commonLoading) {
    commonLoading = new Promise((res) => {
      const s = document.createElement('script');
      s.src = legacyUrl('common.js');          // classic script, so its top-level const lands where eval can see it
      s.onload = () => res(docScanner());
      s.onerror = () => res(null);
      document.head.appendChild(s);
    });
  }
  return commonLoading;
}

export default function FinanceUploadPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scan, setScan] = useState<ScanNote | null>(null);
  const [out, setOut] = useState<UploadOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  /** `UP_SCAN` — app.html:2472. The PDF itself, which never belongs in render state. */
  const scanBlob = useRef<{ blob: Blob; name: string } | null>(null);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    void call<Perms>({ api: 'my_perms' })
      .then(setPerms)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    void call<{ companies?: Company[] }>({ api: 'me' })
      .then((r) => setCompanies(r.companies || []))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const val = (id: string) => el<HTMLInputElement>(id)?.value ?? '';

  /** `upClearScan()` — app.html:2485. */
  const onClearScan = useCallback(() => { scanBlob.current = null; setScan(null); }, []);

  /** `upScan()` — app.html:2473. */
  const onScan = useCallback(() => {
    void loadDocScanner().then((ds) => {
      if (!ds) { setOut({ kind: 'error', text: 'Scanning is unavailable — could not load common.js.' }); return; }
      ds.open({
        multi: true, title: '📷 Scan document',
        onDone: (res) => {
          scanBlob.current = { blob: res.pdfBlob, name: 'scan_' + Date.now() + '.pdf' };
          // app.html:2477 — a scan blanks the picker, so the two sources cannot both be live.
          const fi = el<HTMLInputElement>('up_file'); if (fi) fi.value = '';
          setScan({ jpegDataUrl: res.jpegDataUrl, pageCount: res.pageCount });
        },
      });
    });
  }, []);

  /** `doUpload(btn)` — app.html:2487. The source rule and the body are the screen's; this is the I/O. */
  const onUpload = useCallback(() => {
    if (busy) return;
    const picked = el<HTMLInputElement>('up_file')?.files?.[0] || null;
    const s = scanBlob.current;
    const choice = chooseUpload(
      s ? { name: s.name, type: 'application/pdf', size: s.blob.size } : null,
      picked ? { name: picked.name, type: picked.type, size: picked.size } : null,
    );
    if (!choice.ok) { setOut({ kind: 'error', text: choice.error }); return; }
    const blob: Blob = choice.source === 'scan' ? s!.blob : picked!;
    setBusy(true);
    void (async () => {
      try {
        const b64 = await new Promise<string>((rs, rj) => {
          const r = new FileReader();
          r.onload = () => rs(String(r.result));
          r.onerror = rj;
          r.readAsDataURL(blob);
        });
        await call(uploadBody({
          tenant: val('up_tenant'), category: val('up_cat'), fileName: choice.fileName,
          contentBase64: b64, contentType: choice.contentType, note: val('up_note'),
        }));
        setOut({ kind: 'ok' });
        const fi = el<HTMLInputElement>('up_file'); if (fi) fi.value = '';
        const n = el<HTMLTextAreaElement>('up_note'); if (n) n.value = '';
        onClearScan();
      } catch (x) {
        setOut({ kind: 'error', text: 'Upload error: ' + (x instanceof Error ? x.message : String(x)) });
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, onClearScan]);

  return (
    <div>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
        : perms === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : !uploadReachable(perms)
          ? <Panel>
              Document Upload is not enabled for your login — it files documents into a company&apos;s finance
              inbox. Ask an administrator if you need access.
            </Panel>
        : (
          <FinanceUpload
            companies={companies}
            scan={scan}
            out={out}
            busy={busy}
            onClearScan={onClearScan}
            onScan={onScan}
            onUpload={onUpload}
          />
        )}
    </div>
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
        <a href={`${legacyUrl('app.html')}#tab=upload`}>app.html · Upload</a>, unchanged.
        This page renders the same form from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
