'use client';

// The route. Everything impure lives here — the session, the FileReader, DocScanner, the two POSTs, the
// DOM reads, the confirm — so that src/finance-ocr.tsx stays a pure function of its props and can be
// diffed against the legacy golden. Same split as app/finance/wht/page.tsx; the Finance route
// convention is documented there.
//
// `ocr` is NOT on `render(t)`'s `asyncTabs` list (app.html:1504) — it paints from what it already has,
// so there is no load step in front of the screen. `my_perms` is still awaited, because that is the
// gate, and on THIS tab the gate is closed for everyone (app.html:1427). The screen is migrated in full
// anyway: the credits come back, the tab comes back, and a half-ported screen would come back with it.
//
// THE FORM IS READ OUT OF THE DOM, exactly as `ocrPostBill()` (app.html:7215) does, by the same
// `#ocr_tenant` id and the same `[data-k]` / `[data-li-i]` / `[data-li-k]` attributes. Those names ARE
// the contract — the screen's test pins them against app.html at run time.

import { useCallback, useEffect, useRef, useState } from 'react';

import FinanceOcr, {
  billBody, collectLines, confirmText, extractBody, ocrReachable,
  type Company, type OcrExtract, type OcrLine, type OcrOut, type Perms,
} from '../../../src/finance-ocr';
import { showConfirm } from '../../../src/confirm';
import { call, legacyUrl, token } from '../../../src/portal';

/** `UP_MAX_MB` — app.html:4546. */
const UP_MAX_MB = 10;

// ── DocScanner IS SHARED CODE AND IS NOT FORKED, but it cannot be IMPORTED ────────────────────────
// Same arrangement app/finance/upload/page.tsx documents: `DocScanner` is a top-level `const` in
// common.js, so it lives in the global LEXICAL environment — `window.DocScanner` is `undefined` and a
// module cannot `import` a classic script. An indirect `eval` at global scope resolves against exactly
// that environment. Re-writing the 600-line camera pipeline in React to avoid it would be the fork the
// shared-`.js` rule exists to prevent.
interface DocScannerApi {
  open(o: { multi: boolean; title: string; onDone: (r: { jpegB64: string; jpegDataUrl: string; pdfBlob: Blob; pageCount: number }) => void }): void;
}

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

export default function FinanceOcrPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [out, setOut] = useState<OcrOut | null>(null);
  const [canExtract, setCanExtract] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // `OCR_FILE_B64` / `OCR_MIME` / `OCR_SCAN_PDF` — app.html:7126. Refs, not state: nothing on the
  // screen renders from them, and re-rendering on a 4 MB base64 string would be pure waste.
  const b64 = useRef('');
  const mime = useRef('');
  const scanPdf = useRef<Blob | null>(null);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount.
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    void call<Perms>({ api: 'my_perms' }).then(setPerms).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    void call<{ companies?: Company[] }>({ api: 'me' })
      .then((r) => setCompanies(r.companies || []))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  /** `ocrPick(input)` — app.html:7148, including the size refusal. */
  const onPick = useCallback((input: HTMLInputElement) => {
    const f = input.files && input.files[0];
    if (!f) return;
    if (f.size > UP_MAX_MB * 1024 * 1024) {
      // `upTooBig()` (app.html:4547) toasts; the shell here has no toast yet, so it says so in place.
      input.value = '';
      setCanExtract(false);
      setOut({ kind: 'failed', error: `${f.name} is ${(f.size / 1048576).toFixed(1)} MB — the OCR limit is ${UP_MAX_MB} MB. Compress it or scan at a lower resolution.` });
      return;
    }
    mime.current = f.type || 'image/jpeg';
    scanPdf.current = null;
    const rd = new FileReader();
    rd.onload = (e) => {
      b64.current = String(e.target?.result || '').split(',').pop() || '';
      setCanExtract(true);
      setOut({ kind: 'picked', name: f.name, size: f.size });
    };
    rd.readAsDataURL(f);
  }, []);

  /** `ocrScan()` — app.html:7159. The scan feeds the SAME extractor the file picker does. */
  const onScan = useCallback(() => {
    void loadDocScanner().then((ds) => {
      if (!ds) { setOut({ kind: 'failed', error: 'Scanning is unavailable — could not load common.js.' }); return; }
      ds.open({
        multi: false,
        title: '📷 Scan receipt / invoice',
        onDone: (res) => {
          b64.current = res.jpegB64;
          mime.current = 'image/jpeg';
          scanPdf.current = res.pdfBlob;
          setCanExtract(true);
          setOut({ kind: 'scanned', jpegDataUrl: res.jpegDataUrl, pageCount: res.pageCount });
        },
      });
    });
  }, []);

  /** `ocrDownloadScan()` — app.html:7171. */
  const onDownloadScan = useCallback(() => {
    if (!scanPdf.current) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(scanPdf.current);
    a.download = 'scan_' + Date.now() + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  /** `ocrExtract()` — app.html:7172. `runOnce` becomes the `busy` flag: one billed call per click. */
  const onExtract = useCallback(() => {
    if (!b64.current) { setOut({ kind: 'failed', error: 'Pick a file first' }); return; }
    // app.html:7176 — refused before the call, not after: a PDF cannot succeed and would still be billed.
    if (mime.current === 'application/pdf') { setOut({ kind: 'pdf' }); return; }
    if (busy) return;
    setBusy(true);
    setOut({ kind: 'reading' });
    void (async () => {
      try {
        const r = await call<{ extracted?: OcrExtract; raw?: string }>(extractBody(b64.current, mime.current));
        setOut({ kind: 'extracted', result: r.extracted || {} });
      } catch (e) {
        setOut({ kind: 'failed', error: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(false);
      }
    })();
  }, [busy]);

  /** `ocrPostBill()`'s DOM half — app.html:7215. The rules it applies live in the screen. */
  const onPostBill = useCallback(() => {
    const tenant = (document.getElementById('ocr_tenant') as HTMLSelectElement | null)?.value || '';
    if (!tenant) { setOut({ kind: 'failed', error: 'Pick a company' }); return; }
    const scope = root.current;
    if (!scope) return;

    const bill: Record<string, unknown> = {};
    scope.querySelectorAll<HTMLInputElement>('#ocr_out [data-k]').forEach((el) => {
      bill[el.dataset.k as string] = el.type === 'number' ? (Number(el.value) || 0) : el.value;
    });

    const rows: Record<string, OcrLine> = {};
    scope.querySelectorAll<HTMLInputElement>('#ocr_lines [data-li-i]').forEach((el) => {
      const i = el.dataset.liI as string;
      (rows[i] ||= {} as OcrLine)[el.dataset.liK as keyof OcrLine] = el.value as never;
    });
    bill.line_items = collectLines(Object.keys(rows).map((k) => rows[k]));

    if (busy) return;
    void (async () => {
      // Last-chance confirm before a document exists in Xero — app.html:7227, wording and all.
      if (!await showConfirm('Create draft bill in Xero', confirmText(bill), 'Create', 'p')) return;
      setBusy(true);
      try {
        const r = await call<{ number?: string; invoice_id?: string; total?: number; contact?: string }>(billBody(tenant, bill));
        setOut({ kind: 'posted', number: r.number || r.invoice_id || '', total: r.total || 0, contact: r.contact || '' });
      } catch (e) {
        setOut({ kind: 'failed', error: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(false);
      }
    })();
  }, [busy]);

  /** `renderOcr()`'s own reset — app.html:7146. "+ Upload another" repaints the empty form. */
  const onUploadAnother = useCallback(() => {
    b64.current = '';
    mime.current = '';
    scanPdf.current = null;
    setCanExtract(false);
    setOut(null);
  }, []);

  return (
    <div ref={root}>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
        // THE PERMISSION GATE — app.html:1427. Smart OCR is hidden from EVERYONE, not admin-gated and
        // not feature-gated: the Anthropic vision credits ran out on 2026-07-09. `ocrReachable()`
        // returns false for every login and the screen's test pins that. Re-enabling is one edit in
        // app.html (`true` → `!canManage`) and one in src/finance-ocr.tsx, and it is a decision, not a
        // migration detail.
        : !ocrReachable(perms)
          ? <Panel>
              Smart OCR is switched off. The Claude vision credits it runs on were exhausted on
              2026&#8209;07&#8209;09; the screen is intact and comes back with a top-up. Ask an administrator.
            </Panel>
        : <FinanceOcr
            companies={companies}
            canExtract={canExtract}
            out={out}
            onPick={onPick}
            onScan={onScan}
            onExtract={onExtract}
            onDownloadScan={onDownloadScan}
            onDiscard={() => setOut(null)}
            onPostBill={onPostBill}
            onUploadAnother={onUploadAnother}
          />}
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
        <a href={`${legacyUrl('app.html')}#tab=ocr`}>app.html · Smart OCR</a>, unchanged — and hidden
        there too. This page renders the same form from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
