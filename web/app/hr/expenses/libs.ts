'use client';

// The four vendored classic scripts this route loads on demand, and the one top-level `const` it has to
// reach by indirect `eval`.
//
// All four are served from THIS origin next to the legacy apps (`vercel.json` copies `*.js` over the
// export after the build — CLAUDE.md), so they are injected by `<script src>` and never imported: they
// are UMD/classic bundles with no ES exports, and `web`'s tsconfig sets `allowJs:false`.
//
// Each loader MEMOISES THE IN-FLIGHT PROMISE, not just the loaded global. CLAUDE.md's `gwLoadXlsx()`
// lesson: a loader that only checks the global injects a second `<script>` for a second caller that
// arrives before the first lands, and the queued caller is the one that gets dropped — a Scan button
// that silently does nothing. Two of these genuinely race (📷 Scan reads the QR while the PDF engine is
// still loading), so this is not theoretical here.

import { legacyUrl } from '../../../src/portal';

const pending: Record<string, Promise<unknown>> = {};

function inject<T>(file: string, get: () => T | null | undefined): Promise<T | null> {
  const have = get();
  if (have) return Promise.resolve(have);
  if (!pending[file]) {
    pending[file] = new Promise<T | null>((res) => {
      const s = document.createElement('script');
      s.src = legacyUrl(file);
      s.onload = () => res(get() ?? null);
      // Resolve, never reject: `hrLoadPdfLib`'s own comment (hros.html:1892) — "still fire callbacks so
      // awaiting code fails loudly, not forever". An await that never settles is a dead button.
      s.onerror = () => res(null);
      document.head.appendChild(s);
    });
  }
  return pending[file] as Promise<T | null>;
}

/** `hrLoadJsPDF()` — the jsPDF constructor, or null. */
export const loadJsPDF = (): Promise<any> =>
  inject('jspdf.umd.min.js', () => (window as any).jspdf && (window as any).jspdf.jsPDF);

/** `hrLoadPdfLib()` — hros.html:1886. */
export const loadPdfLib = (): Promise<any> =>
  inject('pdf-lib.min.js', () => (window as any).PDFLib);

/** `hrLoadJsQR()` — hros.html:2238. */
export const loadJsQR = (): Promise<any> =>
  inject('jsqr.min.js', () => (window as any).jsQR);

export interface DocScannerResult {
  pdfBlob: Blob;
  jpegB64: string;
  pageCanvases?: HTMLCanvasElement[];
  rawCanvases?: HTMLCanvasElement[];
}
export interface DocScannerApi {
  open(o: { multi: boolean; title: string; onDone: (r: DocScannerResult) => void }): void;
}

/**
 * common.js's `DocScanner` — a top-level `const`, so it is in the global LEXICAL environment and
 * `window.DocScanner` is `undefined`. CLAUDE.md says so, and assuming otherwise has already caused a
 * silent fall-back to the file picker once. An indirect `eval` runs at global scope and resolves
 * against exactly that environment; `app/finance/upload/page.tsx` is the precedent.
 */
const docScanner = (): DocScannerApi | null => {
  try { return (0, eval)('typeof DocScanner !== "undefined" ? DocScanner : null') as DocScannerApi | null; }
  catch { return null; }
};

export const loadDocScanner = (): Promise<DocScannerApi | null> =>
  inject('common.js', docScanner);
