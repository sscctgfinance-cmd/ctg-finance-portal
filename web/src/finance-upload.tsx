// Finance OS · Upload — the React half of `renderUpload()` (app.html:2450).
//
// The legacy original is STILL THERE and still shipping; nothing was deleted. Both are reachable side
// by side (`app.html#tab=upload` and `/finance/upload/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read, no FileReader. The
// session, the `upload` POST, the DocScanner call and every DOM read live in app/finance/upload/page.tsx.
//
// Sixth Finance screen; everything in src/finance-wht.tsx's header about what makes a Finance screen
// different (no chrome in the golden, the route is `app/finance/<tab-id>/`, the gate is in `showApp()`
// not in the renderer) applies unchanged and is not repeated.
//
// ── THE GOLDEN IS THE SCREEN AN OPERATOR SEES, and that was checked ───────────────────────────────
// CLAUDE.md's `finance.qinv` note says to look at what the legacy renderer does AFTER its innerHTML
// write before trusting a golden. `renderUpload()` does exactly one thing after it: `UP_SCAN=null`
// (app.html:2471) — a module variable, no `appendChild`, no `.value=`, no `setTimeout`, no fetch, and
// `upload` is not on `render(t)`'s `asyncTabs` list (app.html:1504) so nothing paints over it later.
// So unlike Quick Invoice this golden IS the initial screen, and the only two things outside it are the
// two divs the legacy fills later: `#up_scan_note` (a scan preview) and `#upres` (the result line).
// Both are mirrored below and both are pinned in the screen's own test rather than by the diff.
//
// ── THE FORM IS UNCONTROLLED, ON PURPOSE ──────────────────────────────────────────────────────────
// `doUpload()` (app.html:2487) reads the form back out of the DOM by `up_tenant`, `up_cat`, `up_file`
// and `up_note`, and so does the route. Those ids are the contract, not decoration: a company `<select>`
// that lost its id reads back as blank and the document is filed against the wrong tenant — a supplier
// bill in another company's books, with nothing on screen saying so. tests/finance-upload.parity.test.tsx
// extracts the id set from app.html at run time so the check cannot drift from the function it protects.

/** `COMPANIES` — app.html:1391. */
export interface Company { tenant_id: string; tenant_name: string }

/** `PERMS` — resolved by `showApp()` from `my_perms`, with `fallbackPerms()` (app.html:1398) standing in. */
export interface Perms { features?: string[] | null }

/**
 * app.html:1434 — `upload` is named NOWHERE in `showApp()`'s if/else chain, so it falls through to the
 * chain's final `else`: `el.classList.toggle('hide', feats.indexOf(t)<0)`. The gate is the FEATURE flag,
 * not `manage_users` — read app.html:1420-1434 as a whole before trusting one line of it.
 *
 * Worth stating what the gate is actually holding, because this screen is not a report: the panel lists
 * every company the login can file against WITH ITS XERO TENANT ID, and the button under it puts a file
 * into the finance system against whichever of them is picked.
 *
 * Exported from the screen, not hidden in the route, so the screen's own test can pin both directions.
 */
export function uploadReachable(perms: Perms | null | undefined): boolean {
  return ((perms && perms.features) || []).indexOf('upload') >= 0;
}

/** `<option>` list of `#up_cat`, verbatim from app.html:2458. The value IS the label; there is no code. */
export const CATEGORIES = ['AP Supplier Bill', 'Reimbursement', 'Bank Statement', 'Other'];

/** 15MB — app.html:2496. The edge function takes the file as base64 in a JSON body. */
export const MAX_BYTES = 15 * 1024 * 1024;

/** What the file picker gives back, and what a scanned PDF stands in as. Size in bytes. */
export interface Picked { name: string; type: string; size: number }

/**
 * `doUpload()`'s source-selection half — app.html:2489-2496 — as a pure function.
 *
 * Split out for the same reason `bankFile()` and `reconcileBody()` were: no golden sees which bytes a
 * screen decides to send. Three behaviours here are load-bearing and each one is a wrong document filed:
 *
 *   • A SCANNED PDF TAKES PRECEDENCE over the file picker, always. `upScan()` blanks `#up_file` when a
 *     scan lands (app.html:2477) and `upClearScan()` is wired to the picker's own onchange, so the two
 *     cannot both be live — but the precedence is what decides it if they ever are, and getting it
 *     backwards uploads the stale picked file while the operator watches their scan preview.
 *   • NOTHING SELECTED IS REFUSED, not silently ignored.
 *   • OVER 15MB IS REFUSED BEFORE THE READ. Past the limit the edge function rejects the body, so a port
 *     that dropped the check would spend a minute base64-ing a file to be told no.
 *
 * A scanned PDF is always `application/pdf`; a picked file carries the browser's own `type`, which may
 * legitimately be `''` for a `.csv` on some platforms and is sent as such, exactly as the legacy does.
 */
export function chooseUpload(scan: Picked | null, file: Picked | null):
  { ok: true; source: 'scan' | 'file'; fileName: string; contentType: string; size: number } | { ok: false; error: string } {
  const src = scan ? { p: scan, kind: 'scan' as const, type: 'application/pdf' }
    : file ? { p: file, kind: 'file' as const, type: file.type } : null;
  if (!src) return { ok: false, error: 'Please select a file or scan a document' };
  if (src.p.size > MAX_BYTES) return { ok: false, error: 'File too large (max 15MB)' };
  return { ok: true, source: src.kind, fileName: src.p.name, contentType: src.type, size: src.p.size };
}

/**
 * The body `doUpload()` POSTs as `{api:'upload', …}` — app.html:2500.
 *
 * Pinned here because no golden sees a request and this one decides WHICH COMPANY a document is filed
 * against. `tenant` is not defaulted and not optional: an upload posted with a blank tenant is a
 * supplier bill sitting in the wrong company's inbox, so `uploadBody` throws rather than guessing —
 * the same reasoning `reconcileBody('')` carries in src/finance-recon.tsx.
 */
export function uploadBody(f: {
  tenant: string; category: string; fileName: string; contentBase64: string; contentType: string; note: string;
}): Record<string, unknown> {
  if (!f.tenant) throw new Error('Pick a company before uploading — a document filed against the wrong tenant is invisible.');
  return {
    api: 'upload', tenant: f.tenant, category: f.category, file_name: f.fileName,
    content_base64: f.contentBase64, content_type: f.contentType, note: f.note,
  };
}

/** `#upres` — every state app.html writes into it (:2493, :2496, :2504, :2506, :2507). Empty in the golden. */
export type UploadOut =
  | { kind: 'ok' }
  | { kind: 'error'; text: string };

/** `#up_scan_note` — `upScan()`'s preview (app.html:2478). Empty in the golden; `UP_SCAN` starts null. */
export interface ScanNote { jpegDataUrl: string; pageCount: number }

export interface FinanceUploadProps {
  /** `COMPANIES` — `#up_tenant`'s options. */
  companies: Company[];
  /** `UP_SCAN`'s preview, or null for the empty `#up_scan_note` the golden holds. */
  scan: ScanNote | null;
  /** `#upres`, or null for empty as the golden has it. */
  out: UploadOut | null;
  /** `btn.disabled=true; btn.textContent='Uploading…'` — app.html:2497, as a prop. */
  busy: boolean;
  /** `upClearScan()` — app.html:2485. Wired to the picker's onchange AND to the note's own "clear" link. */
  onClearScan: () => void;
  /** `upScan()` — app.html:2473. */
  onScan: () => void;
  /** `doUpload(this)` — app.html:2487. */
  onUpload: () => void;
}

/**
 * Every inline style is written as a STRING and parsed here, not as a React style object — same reason
 * and same helper as src/finance-wht.tsx: nothing in parity.ts touches an attribute VALUE, so these are
 * compared character for character, and a React style object would silently append `px` to a bare number
 * and re-serialise `.7` as `0.7`. This screen's scan button carries a five-declaration gradient, so it
 * is well past the handful src/finance-collections.tsx got away with writing as plain objects.
 */
function st(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of css.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const key = name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[key] = part.slice(at + 1).trim();
  }
  return out;
}

/** The "(PDF / Image / Excel)" / "(Optional)" hint span — app.html:2462, :2467. */
const HINT = 'color:var(--muted);text-transform:none;letter-spacing:0';

/** `upScan()`'s note — app.html:2478. IN NO GOLDEN: `renderUpload()` sets `UP_SCAN=null` on the way out. */
function ScanNoteBlock({ scan, onClearScan }: { scan: ScanNote; onClearScan: () => void }) {
  return (
    <div style={st('display:flex;gap:10px;align-items:center;background:var(--panel);border:1px solid var(--panel-border);border-radius:8px;padding:8px 10px')}>
      <img src={scan.jpegDataUrl} style={st('height:64px;border-radius:5px;border:1px solid var(--panel-border)')} />
      <span style={st('color:var(--green-soft);font-size:12.5px')}>
        {'📄 Scanned PDF ready (' + scan.pageCount + ' page' + (scan.pageCount > 1 ? 's' : '') + ') — click '}
        <b>Upload</b>
        {'. '}
        {/* `onclick="upClearScan();return false"` — the `return false` is the anchor's own default; React
            takes preventDefault instead, which is the same document and the same behaviour. */}
        <a href="#" onClick={(e) => { e.preventDefault?.(); onClearScan(); }} style={st('color:var(--muted)')}>clear</a>
      </span>
    </div>
  );
}

/** `#upres` — app.html's five writes into it, as one branch each. IN NO GOLDEN. */
function Out({ out }: { out: UploadOut }) {
  if (out.kind === 'ok') {
    return <div style={st('color:var(--green-soft);font-size:13px')}>✅ Uploaded. Finance will process it.</div>;
  }
  return <span style={st('color:var(--red-soft)')}>{out.text}</span>;
}

/** `renderUpload()` — app.html:2450. */
export default function FinanceUpload(props: FinanceUploadProps) {
  return (
    <div className="panel" style={st('max-width:560px')}>
      <div className="panel-hd"><h3>Document Upload</h3></div>
      <p className="muted" style={st('font-size:13px;margin:0 0 18px')}>Upload invoices, receipts, or bank statements for processing by finance.</p>
      <div className="fld"><label>Company</label><select id="up_tenant">
        {props.companies.map((c) => <option key={c.tenant_id} value={c.tenant_id}>{c.tenant_name}</option>)}
      </select></div>
      <div className="fld"><label>Category</label><select id="up_cat">
        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
      </select></div>
      <div className="fld"><label>File <span style={st(HINT)}>(PDF / Image / Excel)</span></label>
        <input type="file" id="up_file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv" onChange={props.onClearScan} /></div>
      <button type="button" className="btn" style={st('width:100%;justify-content:center;margin:-4px 0 14px;background:linear-gradient(180deg,rgba(226,96,75,.18),rgba(226,96,75,.08));border-color:rgba(226,96,75,.4)')} onClick={props.onScan}>📷 Scan document → PDF <span style={st('opacity:.7;font-weight:400')}>— auto-crop, multi-page</span></button>
      <div id="up_scan_note" style={st('margin:-6px 0 12px')}>{props.scan ? <ScanNoteBlock scan={props.scan} onClearScan={props.onClearScan} /> : null}</div>
      <div className="fld"><label>Note <span style={st(HINT)}>(Optional)</span></label>
        <textarea id="up_note" placeholder="e.g. March rent invoice"></textarea></div>
      <button className="btn p" onClick={props.onUpload} disabled={props.busy}>{props.busy ? 'Uploading…' : '⬆ Upload'}</button>
      <div id="upres" style={st('margin-top:14px')}>{props.out ? <Out out={props.out} /> : null}</div>
    </div>
  );
}
