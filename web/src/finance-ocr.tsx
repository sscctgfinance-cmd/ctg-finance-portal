// Finance OS · Smart OCR — the React half of `renderOcr()` (app.html:7127).
//
// The legacy original is STILL THERE and still shipping; nothing was deleted. Both are reachable side
// by side (`app.html#tab=ocr` and `/finance/ocr/`) — insofar as either is reachable at all, which
// today is "not at all": see `ocrReachable()` below.
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read, no FileReader. The
// session, the `ocr_extract` call, the `create_bill_from_ocr` POST, `DocScanner` and every DOM read
// live in app/finance/ocr/page.tsx. See src/finance-wht.tsx's header for what a Finance screen differs
// on (no chrome in the golden, one section, `app/finance/<tab-id>/`, the gate in `showApp()`); none of
// that is repeated here.
//
// ── THE GOLDEN IS THE EMPTY FORM, AND `#ocr_out` IS WHERE THIS SCREEN LIVES ────────────────────────
// `renderOcr()` writes the panel, the company picker, the file input, two buttons and an EMPTY
// `#ocr_out`, then resets four module globals and sets `loaded.ocr`. It does NOT `appendChild`, set a
// `.value`, `setTimeout` or fetch after the innerHTML write — checked, because `renderQinv()` does and
// its golden is therefore not the screen an operator sees (CLAUDE.md says so). This one IS: what the
// harness captured is exactly what an operator gets on arrival.
//
// What that leaves outside the diff is everything that happens next. SEVEN different things get
// innerHTML'd into `#ocr_out` — a picked file, a camera scan, the reading spinner, the PDF refusal, a
// failure, the extracted bill form, and the posted-bill confirmation. `Out` below is the inventory of
// all seven, mirrored from app.html and pinned by assertion in the screen's own test, because a
// golden-only check on this screen would prove the empty form and nothing else.
//
// ── THE EXTRACTED FORM IS UNCONTROLLED, AND ITS `data-*` NAMES ARE THE CONTRACT ────────────────────
// `ocrPostBill()` (app.html:7215) reads the bill back out of the DOM by `[data-k]` on the eight header
// fields and `[data-li-i]` / `[data-li-k]` on the line inputs. Same treatment as Quick Invoice's
// `qi_*` ids: the controls stay uncontrolled and keep those attributes, the route reads the same ones,
// and tests/finance-ocr.parity.test.tsx extracts both name sets from app.html at run time so the check
// cannot drift from the function it protects. A field that loses its `data-k` posts as MISSING on a
// draft bill in Xero — a vendor, a date or a total silently absent from a real accounting document.

/** `COMPANIES` — app.html:1391. */
export interface Company { tenant_id: string; tenant_name: string }

/** `PERMS` — resolved by `showApp()` from `my_perms`, `fallbackPerms()` (app.html:1398) standing in. */
export interface Perms { features?: string[] | null; manage_users?: boolean | null }

/**
 * app.html:1427 — and this one is not like its neighbours, so it is quoted verbatim:
 *
 *   else if(t==='ocr') el.classList.toggle('hide', true); // OCR HIDDEN — Anthropic (Claude vision)
 *   credits exhausted 2026-07-09; flip true→!canManage to re-enable after a top-up
 *
 * The tab is hidden from EVERYONE — not admin-gated, not feature-gated. That is a deliberate operational
 * state, not an oversight, so the port reproduces it exactly rather than helpfully restoring the rule the
 * comment describes. Turning it back on is one edit in app.html and one here, and it is the captain's
 * call, not a migration detail.
 */
export function ocrReachable(_perms: Perms | null | undefined): boolean {
  return false;
}

/**
 * The rule app.html:1427's comment says to restore after a credit top-up — `true` → `!canManage`, i.e.
 * admin-only, the same gate `selfbill` / `wht` / `gateway` / `bankfeed` / `salesrecon` carry.
 *
 * Exported and tested so the re-enable instruction survives the port as an executable statement rather
 * than as a comment someone has to find. Nothing calls it: the route gates on `ocrReachable()` above,
 * and the screen's test pins that it does.
 */
export function ocrReachableAfterTopUp(perms: Perms | null | undefined): boolean {
  return !!(perms && perms.manage_users);
}

/** `M()` — app.html:1253. A currency FORMAT, not maths; one line, mirrored rather than imported. */
const M = (n: unknown) =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Every inline style is a STRING parsed here, not a React style object — same helper and same reason as
 * src/finance-wht.tsx and src/finance-qinv.tsx: nothing in tests/parity.ts touches an attribute VALUE,
 * so these are compared character for character, and a style object would re-serialise `.7` as `0.7`
 * and append `px` to a bare number.
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

// ── The extraction, as the server returns it ───────────────────────────────────────────────────────

/** One line as `ocr_extract` returns it — app.html:7196. Every field is optional there, and here. */
export interface OcrLine {
  description?: string | null;
  quantity?: number | string | null;
  unit_amount?: number | string | null;
  account_code_guess?: string | null;
}

/** `OCR_RESULT` — app.html:7126, `r.extracted` from `ocr_extract`. */
export interface OcrExtract {
  confidence?: 'high' | 'medium' | 'low' | string | null;
  vendor_name?: string | null;
  invoice_no?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  currency?: string | null;
  subtotal?: number | string | null;
  tax_amount?: number | string | null;
  total?: number | string | null;
  suggested_gl_account?: string | null;
  line_items?: OcrLine[] | null;
  notes?: string | null;
}

/**
 * The seven things `#ocr_out` can hold. `null` is the golden's state — the div is present and empty.
 * Mirrored from app.html:7152 (`ocrPick`), :7161 (`ocrScan`), :7176/:7178/:7186 (`ocrExtract`),
 * :7189 (`ocrRenderResult`) and :7232 (`ocrPostBill`).
 */
export type OcrOut =
  | { kind: 'picked'; name: string; size: number }
  | { kind: 'scanned'; jpegDataUrl: string; pageCount: number }
  | { kind: 'reading' }
  | { kind: 'pdf' }
  | { kind: 'failed'; error: string; raw?: string | null }
  | { kind: 'extracted'; result: OcrExtract }
  | { kind: 'posted'; number: string; total: number; contact: string };

// ── The two request bodies. No golden sees a request, and one of these writes to Xero. ─────────────

/** `ocrExtract()` — app.html:7180. The document itself, base64, and nothing else. */
export function extractBody(contentB64: string, contentType: string): Record<string, unknown> {
  return { api: 'ocr_extract', content_base64: contentB64, content_type: contentType };
}

/**
 * `ocrPostBill()`'s line filter — app.html:7226:
 *   `.filter(l => l.description || l.unit_amount || Number(l.quantity) > 0)`
 *
 * and its per-field coercion (:7224): `quantity` and `unit_amount` are `Number(v)||0`, everything else
 * is the raw string. Lifted out of the route as a pure function of the rows the DOM held, because this
 * is where a line silently leaves a real accounting document: a row whose description was cleared but
 * whose amount is still 15,000 is KEPT by that filter, and a port that tidied it to "needs a
 * description" would drop RM 15,000 off a draft bill with nothing on screen changing.
 */
export function collectLines(rows: OcrLine[]): { description: string; quantity: number; unit_amount: number; account_code_guess: string }[] {
  return rows
    .map((r) => ({
      description: String(r.description ?? ''),
      quantity: Number(r.quantity) || 0,
      unit_amount: Number(r.unit_amount) || 0,
      account_code_guess: String(r.account_code_guess ?? ''),
    }))
    .filter((l) => l.description || l.unit_amount || l.quantity > 0);
}

/**
 * `ocrPostBill()` — app.html:7230, `call({api:'create_bill_from_ocr', tenant, bill})`.
 *
 * The TENANT is the whole safety property here and it is why this throws rather than defaulting: the
 * bill is posted into whichever Xero organisation this id names, and a blank one posting into "the
 * first company" would file a supplier invoice against the wrong entity's ledger. Same reasoning as
 * `reconcileBody('')` on the Bank Rec screen.
 */
export function billBody(tenant: string, bill: Record<string, unknown>): Record<string, unknown> {
  if (!tenant) throw new Error('Pick a company');
  return { api: 'create_bill_from_ocr', tenant, bill };
}

/**
 * The confirm text `ocrPostBill()` shows before posting — app.html:7227. Split out because it is the
 * last thing between an operator and a document in Xero, and it names the vendor and the total the
 * server is about to be handed. Its `.toFixed(2)` is the legacy's, not `M()`.
 */
export function confirmText(bill: { vendor_name?: unknown; total?: unknown }): string {
  return 'Create DRAFT bill for ' + (bill.vendor_name || '?') + ' · Total: RM ' +
    (Number(bill.total) || 0).toFixed(2) +
    '\n\nThe bill will be DRAFT in Xero — review and approve there before payment.';
}

// ── #ocr_out ───────────────────────────────────────────────────────────────────────────────────────

/** `ocrRenderResult()`'s `fld()` — app.html:7192. Uncontrolled; `data-k` is what `ocrPostBill()` reads. */
function Fld({ label, k, val, type }: { label: string; k: string; val: unknown; type?: string }) {
  return (
    <div style={st('margin-bottom:8px')}>
      <label style={st('font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:3px')}>{label}</label>
      <input type={type || 'text'} data-k={k} defaultValue={val == null ? '' : String(val)} style={st('width:100%')} />
    </div>
  );
}

/** `ocrRenderResult()` — app.html:7189. */
function Extracted({ result, onDiscard, onPostBill }: { result: OcrExtract; onDiscard: () => void; onPostBill: () => void }) {
  const r = result || {};
  const conf = r.confidence || 'medium';
  const confPill = conf === 'high'
    ? <span className="pill pill-green" style={st('font-size:10px')}>high confidence</span>
    : conf === 'low'
      ? <span className="pill" style={st('background:rgba(239,68,68,.16);color:var(--red-soft);font-size:10px')}>low — please review</span>
      : <span className="pill" style={st('background:rgba(245,158,11,.16);color:var(--amber);font-size:10px')}>medium</span>;
  return (
    <>
      <div style={st('background:var(--panel);border:1px solid var(--panel-border);border-radius:12px;padding:18px;margin-bottom:14px')}>
        <div style={st('display:flex;align-items:center;gap:10px;margin-bottom:12px')}><h3 style={st('margin:0;font-size:15px')}>Extracted</h3>{confPill}</div>
        <div style={st('display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px')}>
          <Fld label="Vendor" k="vendor_name" val={r.vendor_name} />
          <Fld label="Invoice no." k="invoice_no" val={r.invoice_no} />
          <Fld label="Invoice date" k="invoice_date" val={r.invoice_date} type="date" />
          <Fld label="Due date" k="due_date" val={r.due_date} type="date" />
          <Fld label="Currency" k="currency" val={r.currency || 'MYR'} />
          <Fld label="Subtotal" k="subtotal" val={r.subtotal} type="number" />
          <Fld label="Tax" k="tax_amount" val={r.tax_amount} type="number" />
          <Fld label="Total" k="total" val={r.total} type="number" />
        </div>
        <div style={st('margin-top:14px')}>
          <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px')}>Line items</div>
          <table style={st('width:100%;font-size:12.5px')} id="ocr_lines">
            <thead><tr>
              <th style={st('text-align:left')}>Description</th>
              <th style={st('text-align:left')}>Qty</th>
              <th style={st('text-align:left')}>Unit</th>
              <th style={st('text-align:left')}>GL account</th>
            </tr></thead>
            <tbody>
              {(r.line_items || []).map((l, i) => (
                <tr key={i}>
                  <td><input data-li-i={i} data-li-k="description" defaultValue={String(l.description || '')} style={st('width:100%;font-size:12px')} /></td>
                  <td><input data-li-i={i} data-li-k="quantity" type="number" defaultValue={String(l.quantity || 1)} style={st('width:60px;font-size:12px')} /></td>
                  <td><input data-li-i={i} data-li-k="unit_amount" type="number" step="0.01" defaultValue={String(l.unit_amount || 0)} style={st('width:100px;font-size:12px')} /></td>
                  {/* app.html:7196 — the guess, then the document-level suggestion, then Xero's default expense code. */}
                  <td><input data-li-i={i} data-li-k="account_code_guess" defaultValue={String(l.account_code_guess || r.suggested_gl_account || '610-1000')} style={st('width:120px;font-size:12px')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.notes ? <div className="muted" style={st('font-size:11.5px;margin-top:10px')}><b>AI notes:</b>{' ' + r.notes}</div> : null}
      </div>
      <div style={st('display:flex;gap:8px;justify-content:flex-end')}>
        <button className="btn" onClick={onDiscard}>← Discard</button>
        <button className="btn p" id="ocr_post_btn" onClick={onPostBill}>✓ Create DRAFT Bill in Xero</button>
      </div>
    </>
  );
}

/** Everything `#ocr_out` can hold. Each branch names the legacy line it mirrors. */
function Out(p: FinanceOcrProps & { out: OcrOut }) {
  const o = p.out;
  // app.html:7152 — `ocrPick()`'s acknowledgement, with the size the operator can sanity-check.
  if (o.kind === 'picked') {
    return <div className="muted" style={st('font-size:12px')}>{'📎 ' + o.name + ' ready (' + (o.size / 1024).toFixed(0) + ' KB) · click '}<b>Extract with AI</b></div>;
  }
  // app.html:7161 — the DocScanner result: the cleaned page, and the PDF it can also give you.
  if (o.kind === 'scanned') {
    return (
      <div style={st('display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:var(--panel);border:1px solid var(--panel-border);border-radius:10px;padding:12px')}>
        <img src={o.jpegDataUrl} style={st('height:120px;border-radius:8px;border:1px solid var(--panel-border)')} />
        <div>
          <div style={st('color:var(--green-soft);font-size:12.5px;font-weight:600')}>✓ Scanned &amp; cleaned</div>
          <div className="muted" style={st('font-size:12px;margin:4px 0 8px')}>{o.pageCount + ' page' + (o.pageCount > 1 ? 's' : '') + ' · click '}<b>Extract with AI</b>{' below'}</div>
          <button type="button" className="btn sm" onClick={p.onDownloadScan}>⬇ Download PDF</button>
        </div>
      </div>
    );
  }
  // app.html:7178 — written INSIDE runOnce so a double-click cannot fire two Claude calls.
  if (o.kind === 'reading') return <div className="muted"><span className="spin"></span>{' AI reading the document (5-15s)…'}</div>;
  // app.html:7176 — a PDF is refused up front rather than sent and charged for.
  if (o.kind === 'pdf') return <div style={st('color:var(--red-soft);font-size:13px')}>⚠ PDF support coming soon — please screenshot the invoice as PNG/JPEG and upload that.</div>;
  // app.html:7182 — the model's raw reply is kept behind a <details> so a bad parse is diagnosable.
  if (o.kind === 'failed') {
    return (
      <div style={st('color:var(--red-soft);font-size:13px')}>{o.error}
        {o.raw
          ? <details style={st('margin-top:8px')}><summary className="muted">Raw response</summary><pre style={st('white-space:pre-wrap;font-size:11px;background:var(--panel-2);padding:8px;border-radius:6px')}>{o.raw}</pre></details>
          : null}
      </div>
    );
  }
  // app.html:7232 — the only state that means something exists in Xero.
  if (o.kind === 'posted') {
    return (
      <div className="empty" style={st('padding:30px')}>
        <div className="empty-ico">✓</div>
        <div style={st('font-size:16px;color:var(--green-soft)')}>{'Draft bill created: ' + o.number}</div>
        <div className="muted" style={st('font-size:12.5px;margin-top:8px')}>{'Total: ' + M(o.total) + ' · Contact: ' + o.contact}</div>
        <div style={st('margin-top:18px')}><button className="btn p" onClick={p.onUploadAnother}>+ Upload another</button></div>
      </div>
    );
  }
  return <Extracted result={o.result} onDiscard={p.onDiscard} onPostBill={p.onPostBill} />;
}

export interface FinanceOcrProps {
  /** `COMPANIES` — app.html:1391, the `#ocr_tenant` options. */
  companies: Company[];
  /** `#ocr_extract_btn`'s `disabled` — app.html:7140, cleared by `ocrPick()` / `ocrScan()`. */
  canExtract: boolean;
  /** What `#ocr_out` holds. `null` is the golden's state. */
  out: OcrOut | null;
  /** `onchange="ocrPick(this)"` — app.html:7137. Handed the input, as the legacy is. */
  onPick: (input: HTMLInputElement) => void;
  /** `ocrScan()` — app.html:7139. */
  onScan: () => void;
  /** `ocrExtract()` — app.html:7140. */
  onExtract: () => void;
  /** `ocrDownloadScan()` — app.html:7171. Not in any golden. */
  onDownloadScan: () => void;
  /** `document.getElementById('ocr_out').innerHTML=''` — app.html:7211. Not in any golden. */
  onDiscard: () => void;
  /** `ocrPostBill()` — app.html:7211. Not in any golden, and it writes to Xero. */
  onPostBill: () => void;
  /** `renderOcr()` — app.html:7232's "+ Upload another". Not in any golden. */
  onUploadAnother: () => void;
}

/** `renderOcr()` — app.html:7127. This component is every byte of the `#ocr` tab div. */
export default function FinanceOcr(props: FinanceOcrProps) {
  return (
    <div className="panel" style={st('max-width:900px')}>
      <div className="panel-hd"><h3>🤖 Smart OCR — Upload a supplier invoice / receipt</h3></div>
      <p className="muted" style={st('font-size:12.5px;margin:0 0 14px;line-height:1.6')}>{'Upload an invoice or receipt (image or PDF). AI reads it, extracts vendor / date / line items / tax / suggested GL account. Review → one click creates a '}<b>DRAFT Bill</b>{' in Xero with the file attached. Powered by Claude vision.'}</p>
      <div style={st('display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px')}>
        <div>
          <label style={st('font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:4px')}>Post to company</label>
          {/* Uncontrolled and keeping the legacy id: `ocrPostBill()` reads `#ocr_tenant`.value, and so
              does the route. A controlled <select> would add an onChange the golden does not carry. */}
          <select id="ocr_tenant" style={st('width:100%')}>
            {props.companies.map((c) => <option key={c.tenant_id} value={c.tenant_id}>{c.tenant_name}</option>)}
          </select>
        </div>
        <div>
          <label style={st('font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:4px')}>Receipt / invoice file</label>
          <input type="file" id="ocr_file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => props.onPick(e.target as HTMLInputElement)} style={st('width:100%')} />
        </div>
      </div>
      <button type="button" className="btn" style={st('width:100%;margin-bottom:10px;justify-content:center;background:linear-gradient(180deg,rgba(226,96,75,.18),rgba(226,96,75,.08));border-color:rgba(226,96,75,.4)')} onClick={props.onScan}>{'📷 Scan with camera '}<span style={st('opacity:.7;font-weight:400')}>{'— auto-crop & clean like a scanner'}</span></button>
      <button className="btn p" id="ocr_extract_btn" onClick={props.onExtract} disabled={!props.canExtract}>🧠 Extract with AI</button>
      <div id="ocr_out" style={st('margin-top:14px')}>{props.out ? <Out {...props} out={props.out} /> : null}</div>
    </div>
  );
}
