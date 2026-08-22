// Finance OS · Personal (Self-Billed) Invoices — the tenth screen out of app.html.
//
// The legacy original is `renderSelfbill()` (app.html:4237) and the `sbi*` family below it, all STILL
// THERE and still shipping; nothing was deleted. Both are reachable side by side
// (`app.html#tab=selfbill` and `/finance/selfbill/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. The two loads, the
// six posts, the three confirms, the file reader and the double-submit lock all live in
// app/finance/selfbill/page.tsx. See src/finance-wht.tsx's header for what a Finance screen differs on:
// no chrome in the golden, one section, and a permission gate upstream of the renderer in `showApp()`.
//
// ── WHAT THIS SCREEN IS ────────────────────────────────────────────────────────────────────────────
// Self-billing means the COMPANY raises the invoice on the individual supplier's behalf, so every figure
// on it is money leaving the business and every payee row is a bank account it leaves towards. The
// consequential defects are therefore: a button bound to the wrong invoice id, a `→ Xero` that posts
// when it meant to re-sync, a draft that presents as issued, and a bank block that carries a different
// person's account number than the payee the invoice names.
//
// ── ASYNC: WHAT THE GOLDEN HOLDS, CHECKED RATHER THAN ASSUMED ─────────────────────────────────────
// `renderSelfbill()` is `async` and writes `#selfbill` TWICE — a `Loading…` panel, then (via
// `sbiRender()`) the real screen. CLAUDE.md's `finance.qinv` warning is that a golden can hold an
// INTERMEDIATE state, so both functions were read to the end. `sbiRender()` does NOTHING after its
// `el.innerHTML=` — no `appendChild`, no `.value=`, no `setTimeout`, no follow-up fetch — and
// `renderSelfbill()` only sets `loaded.selfbill=true` after it. So the golden IS the screen an operator
// sees. That is asserted against app.html's own text in the screen's test, not left as a claim.
//
// ── FOUR DOCUMENTS THE GOLDEN DOES NOT HOLD ───────────────────────────────────────────────────────
// The harness captured `SBI.showPayees===false` and `SBI.editId===null`, so `#sbi_form` is EMPTY and the
// payees panel is absent. The payees panel, its inline payee form, the invoice form with its line rows,
// and the printable invoice document are all mirrored from the legacy source anyway — leaving them out
// would wire five golden buttons to nothing — and each is pinned by assertion in the screen's own test.
//
// ── THE ARITHMETIC IS A DISPLAY ECHO, NOT A SECOND COPY OF THE MATHS ──────────────────────────────
// Quick Invoice's case, not O2O's, and it was decided by reading the server rather than the shape of the
// code. `sbi_save` (finance.ts:1394-1401) recomputes gross from `line_items`, recomputes `wht_amount`
// from the rate and recomputes `net_payable` itself; the client's figures are never trusted for the row
// that is stored. So `recalc()` below is the on-screen preview only and is mirrored, not lifted into a
// shared `.js` the way `wht.js` and `o2o.js` were. Its one divergence from the server is a legacy
// finding mirrored as-is and pinned in the test — see recalc()'s own comment.

// ── THE PERMISSION GATE ────────────────────────────────────────────────────────────────────────────
// app.html:1429 — `else if(t==='selfbill') el.classList.toggle('hide', !canManage);` with the legacy's
// own comment on the same line: "admin-only (creates payments)". That is the ADMIN gate, not the
// feature flag four of this screen's neighbours fall through to (`approvals`, `collections`, `recon`,
// `qinv`, `o2o`), and `renderSelfbill()` itself has no role check in it at all — a port that mirrored
// only the renderer would serve every payee's name, IC, TIN and BANK ACCOUNT NUMBER, plus buttons that
// approve and post payments, to anyone who typed the URL. The server is stricter still (every `sbi_*`
// and `individual_*` handler requires `superAdmin` — finance.ts:1159, :1341, :1379), so this is tab
// visibility rather than the boundary.

/** `PERMS` — resolved by `showApp()` from `my_perms`, with `fallbackPerms()` (app.html:1398) standing in. */
export interface Perms {
  manage_users?: boolean | null;
}

/** app.html:1429, mirrored exactly. `!!` means missing PERMS, missing key and explicit false all read alike. */
export function selfbillReachable(perms: Perms | null | undefined): boolean {
  return !!(perms && perms.manage_users);
}

// ── THE SHAPES ─────────────────────────────────────────────────────────────────────────────────────

/** `COMPANIES` — app.html's company list; tests/render_fixtures.ts:14. */
export interface Company { tenant_id: string; tenant_name: string }

/** One row of `{api:'individuals_list'}`.individuals — tests/render_fixtures.ts:230. */
export interface Payee {
  id: number;
  name: string;
  id_type?: string | null;
  id_no?: string | null;
  tin?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  default_payment_type?: string | null;
}

/** One row of `{api:'sbi_list'}`.invoices — tests/render_fixtures.ts:234. */
export interface InvoiceRow {
  id: number;
  tenant_id: string;
  invoice_no?: string | null;
  payee_name?: string | null;
  invoice_date?: string | null;
  gross_amount?: number | null;
  wht_amount?: number | null;
  net_payable?: number | null;
  status: string;
  xero_bill_id?: string | null;
}

/** One line item — `SBI.lines`, app.html:4360. `manual` is set when the Amount box is typed into. */
export interface Line {
  description?: string | null;
  qty?: number | string | null;
  unit_price?: number | string | null;
  amount?: number | string | null;
  manual?: boolean;
}

/** The record `{api:'sbi_get'}` returns, as far as the form reads it — app.html:4293. */
export interface Invoice {
  id?: number | null;
  tenant_id?: string | null;
  individual_id?: number | null;
  invoice_no?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  payment_type?: string | null;
  classification_code?: string | null;
  buyer_name?: string | null;
  buyer_ssm?: string | null;
  buyer_tin?: string | null;
  buyer_sst?: string | null;
  buyer_address?: string | null;
  payee_name?: string | null;
  payee_id_type?: string | null;
  payee_id_no?: string | null;
  payee_tin?: string | null;
  payee_address?: string | null;
  payee_bank_name?: string | null;
  payee_bank_holder?: string | null;
  payee_bank_account?: string | null;
  gl_account?: string | null;
  wht_gl_account?: string | null;
  wht_type?: string | null;
  wht_rate?: number | string | null;
  wht_amount?: number | null;
  gross_amount?: number | null;
  sst_amount?: number | null;
  net_payable?: number | null;
  currency?: string | null;
  notes?: string | null;
  line_items?: Line[] | null;
}

/** One row of `{api:'sbi_accounts'}`.accounts — app.html:4453. */
export interface Account { code: string; name: string; cls?: string | null }

// ── THE CONSTANTS, mirrored from app.html:3517-3535 ───────────────────────────────────────────────

export const SBI_PTYPES = ['commission', 'service', 'rental', 'royalty', 'other'];

export const SBI_WHT: { v: string; label: string; rate: number | null }[] = [
  { v: 'none', label: 'None', rate: 0 },
  { v: 's107d_2', label: 's.107D 2% (resident agent/dealer/distributor)', rate: 2 },
  { v: 'nr_10', label: 'Non-resident 10%', rate: 10 },
  { v: 'custom', label: 'Custom rate…', rate: null },
];

export const SBI_CLASS: { c: string; d: string }[] = [
  { c: '037', d: '037 · Self-billed — payment to agents / dealers / distributors (commission)' },
  { c: '036', d: '036 · Self-billed — others (service / freelance / rental / royalty)' },
  { c: '035', d: '035 · Self-billed — importation of services (non-resident supplier)' },
  { c: '034', d: '034 · Self-billed — importation of goods' },
  { c: '045', d: '045 · Self-billed — non-monetary payment to agents / dealers / distributors' },
  { c: '033', d: '033 · Self-billed — betting and gaming' },
  { c: '027', d: '027 · Reimbursement' },
  { c: '030', d: '030 · Repair and maintenance' },
  { c: '031', d: '031 · Research and development' },
  { c: '028', d: '028 · Rental of motor vehicle' },
  { c: '022', d: '022 · Others' },
];

/** `sbiClassDefault()` — app.html:3534. */
export const sbiClassDefault = (pt: string) => (pt === 'commission' ? '037' : '036');

/** `sbiShort()` → `cfoShortName()` — app.html:1685/3519. A display trim, mirrored not imported. */
export const sbiShort = (n: unknown) =>
  String(n || '').replace(/\s*(SDN\s*BHD|CTG4U)\s*/gi, ' ').replace(/\s+/g, ' ').trim();

/** `M()` — app.html:1254. One line, mirrored rather than imported: it is a currency FORMAT, not maths. */
const M = (n: unknown) =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `esc()` — app.html:1253. Only `invoiceDocHtml()` needs it; JSX escapes on its own. */
const esc = (x: unknown) =>
  (x == null ? '' : String(x)).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** `sbiSelStyle()` — app.html:3535. */
const SEL = 'width:100%;padding:7px 9px;background:var(--panel-2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12.5px';
const INP = 'width:100%;padding:7px 9px;background:var(--panel-2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12.5px';

// ── THE PREVIEW ARITHMETIC ────────────────────────────────────────────────────────────────────────

export interface Totals { gross: number; wht: number; net: number; rate: number }

/**
 * `sbiRecalc()` — app.html:4372, character for character INCLUDING its divergence from the server.
 *
 * The server is authoritative (see this file's header): it recomputes gross, wht and net on every save.
 * This is the box the operator reads before pressing the button, so it is mirrored rather than lifted.
 *
 * TWO legacy behaviours deliberately preserved rather than "fixed":
 *  • a line with `manual` set uses the typed Amount and IGNORES qty × unit_price. That is how an
 *    operator overrides a rounding; tidying it would silently re-derive an amount they typed.
 *  • net is `gross − wht`, while `sbi_save` computes `gross + sst − wht` (finance.ts:1401). On a record
 *    carrying SST the preview UNDERSTATES what will be paid. The form has no SST input at all (the
 *    legacy's own H7 comment, app.html:4399, says SST is set at create via OCR and merely preserved),
 *    so the two agree on everything this form can produce. Mirrored as-is and pinned in the test:
 *    changing it is a behaviour change, not a migration detail.
 */
export function recalc(lines: Line[], whtType: string, customRate: unknown): Totals {
  // Each line to the sen, then the sum of the ROUNDED lines — mirrors sbiRecalc() and sbi_save.
  let gross = 0;
  for (const l of lines) gross += lineAmount(l);
  gross = Math.round(gross * 100) / 100;
  const rate = whtType === 'custom'
    ? (parseFloat(String(customRate)) || 0)
    : ((SBI_WHT.find((w) => w.v === whtType) || {}).rate || 0);
  const wht = Math.round(gross * rate / 100 * 100) / 100;
  const net = Math.round((gross - wht) * 100) / 100;
  return { gross, wht, net, rate };
}

/** `sbiRecalc()`'s per-line write-back — app.html:4373. The amount the POST carries for each line. */
export function lineAmount(l: Line): number {
  return Math.round((l.manual ? (Number(l.amount) || 0) : (Number(l.qty) || 0) * (Number(l.unit_price) || 0)) * 100) / 100;
}

// ── THE REQUESTS ──────────────────────────────────────────────────────────────────────────────────
// No golden sees a request body, and both of these move money's destination. Split out of the route for
// the same reason `bankFile()`, `profileBody()` and `decideBody()` were, and pinned in the screen's own
// test against the legacy function's own text in app.html rather than against a retyped expectation.

export interface PayeeForm {
  id: number | null;
  name: string; id_type: string; id_no: string; tin: string; phone: string; email: string;
  address: string; bank_name: string; bank_account: string; default_payment_type: string;
}

/** `sbiSavePayee()` — app.html:4290. `name` is required; the legacy refuses before posting. */
export function payeeBody(p: PayeeForm): Record<string, unknown> {
  return { api: 'individual_save', payee: { ...p } };
}

export interface InvoiceForm {
  editId: number | null;
  tenant_id: string;
  payee: string;
  buyer_name: string; buyer_ssm: string; buyer_tin: string; buyer_sst: string; buyer_address: string;
  invoice_date: string; due_date: string;
  payment_type: string; classification_code: string;
  bank_name: string; bank_account: string; bank_holder: string;
  lines: Line[];
  wht_type: string; wht_rate: number;
  gl_account: string; wht_gl_account: string;
  sst_amount: number;
  notes: string;
  new_attachments: unknown[];
}

/**
 * `sbiSave()`'s body — app.html:4386-4404.
 *
 * The three refusals above it are `chooseSave()`'s job, not this one's, because the legacy refuses
 * BEFORE reading the files: no company, no payee, and no bank name/account. All three are here as a
 * pure guard so the route cannot forget one — a self-billed invoice saved without a bank account is a
 * payment instruction with no destination, and the server's own check (finance.ts:1390) would fall back
 * to the PAYEE MASTER's account, which is a different account than the one the operator was shown.
 */
export function saveRefusal(f: InvoiceForm): string | null {
  if (!f.tenant_id) return 'Select the paying company';
  if (!f.payee) return 'Select the payee';
  if (!f.bank_name.trim() || !f.bank_account.trim()) return 'Bank name and account number are required for payment';
  return null;
}

export function invoiceBody(f: InvoiceForm): Record<string, unknown> {
  return {
    api: 'sbi_save',
    invoice: {
      id: f.editId,
      tenant_id: f.tenant_id,
      individual_id: parseInt(f.payee, 10),
      buyer_name: f.buyer_name, buyer_ssm: f.buyer_ssm, buyer_tin: f.buyer_tin,
      buyer_sst: f.buyer_sst, buyer_address: f.buyer_address,
      invoice_date: f.invoice_date || null, due_date: f.due_date || null,
      payment_type: f.payment_type, classification_code: f.classification_code,
      payee_bank_name: f.bank_name.trim(),
      payee_bank_account: f.bank_account.trim(),
      payee_bank_holder: f.bank_holder.trim(),
      // app.html:4397 — a line is kept when it has a description OR an amount. A row with an amount and
      // no description is KEPT; tidying that to "needs a description" drops money off the invoice.
      line_items: f.lines.filter((l) => (l.description || '') || l.amount),
      wht_type: f.wht_type, wht_rate: f.wht_rate,
      gl_account: f.gl_account, wht_gl_account: f.wht_gl_account,
      // app.html:4399 (H7): the form has no SST input; the record's SST is preserved so re-saving does
      // not zero it — net = gross + sst − wht on a tax document.
      sst_amount: Number(f.sst_amount) || 0,
      notes: f.notes,
      new_attachments: f.new_attachments,
    },
  };
}

// ── THE PRINTABLE INVOICE ─────────────────────────────────────────────────────────────────────────

/**
 * `sbiInvoiceHTML()` — app.html:4436, character for character.
 *
 * A document that LEAVES THE BUILDING: `sbiView()` opens it in a new window and the operator prints or
 * PDFs it, and it is what the supplier and an LHDN auditor read. No golden sees it, so it gets the
 * `bankFile()` treatment — a pure function returning the string, with the `window.open` left in the
 * route — precisely so the screen's test can pin the payment block and the WHT declaration.
 */
export function invoiceDocHtml(v: Invoice, companies: Company[]): string {
  const co = (companies.find((c) => c.tenant_id === v.tenant_id) || { tenant_name: '' }).tenant_name || '';
  const items = (v.line_items || []).map((l, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + esc(l.description || '') + '</td><td class="r">' + (l.qty || 1) +
    '</td><td class="r">' + Number(l.unit_price || 0).toFixed(2) + '</td><td class="r">' + Number(l.amount || 0).toFixed(2) + '</td></tr>').join('');
  const whtRow = (Number(v.wht_amount) || 0) > 0
    ? '<tr><td colspan="4" class="r">Less: Withholding tax (' + (v.wht_rate || 0) + '%)</td><td class="r">-' + Number(v.wht_amount).toFixed(2) + '</td></tr>'
    : '';
  const fmt = (n: unknown) => (v.currency || 'MYR') + ' ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(v.invoice_no || 'Self-Billed Invoice') + '</title><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;color:#111;max-width:800px;margin:24px auto;padding:0 24px;font-size:13px;text-transform:uppercase}' +
    'h1{font-size:20px;letter-spacing:1px;margin:0 0 2px}.sub{color:#666;font-size:11px;margin-bottom:18px}' +
    '.row{display:flex;justify-content:space-between;gap:24px}.box{flex:1}.lbl{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}' +
    'b{font-size:13px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px;text-align:left}th{background:#f5f5f5}.r{text-align:right}' +
    '.tot td{border:none;padding:3px 8px}.tot .r{text-align:right}.net{font-size:15px;font-weight:bold;border-top:2px solid #111}' +
    '.decl{margin-top:22px;font-size:10.5px;color:#555;border-top:1px solid #eee;padding-top:10px;line-height:1.6}' +
    '@media print{.noprint{display:none}body{margin:0}}' +
    '</style></head><body>' +
    '<div class="noprint" style="text-align:right;margin-bottom:10px"><button onclick="window.print()" style="padding:8px 16px;font-size:13px;cursor:pointer">🖨 Print / Save as PDF</button></div>' +
    '<h1>SELF-BILLED INVOICE</h1><div class="sub">Issued by the buyer on behalf of the supplier under the MyInvois self-billed arrangement</div>' +
    '<div class="row" style="margin-bottom:16px"><div class="box"><div class="lbl">Buyer (issued by)</div><b>' + esc(v.buyer_name || co) + '</b><div>SSM: ' + esc(v.buyer_ssm || '—') + '</div><div>TIN: ' + esc(v.buyer_tin || '—') + '</div><div>SST: ' + esc(v.buyer_sst || '—') + '</div><div style="color:#555">' + esc(v.buyer_address || '') + '</div></div>' +
    '<div class="box" style="text-align:right"><div class="lbl">Invoice No</div><b>' + esc(v.invoice_no || '') + '</b><div class="lbl" style="margin-top:6px">Date</div><div>' + esc(v.invoice_date || '') + '</div>' + (v.due_date ? '<div class="lbl" style="margin-top:6px">Due</div><div>' + esc(v.due_date) + '</div>' : '') + '</div></div>' +
    '<div class="box" style="border:1px solid #eee;border-radius:6px;padding:10px;margin-bottom:6px"><div class="lbl">Supplier (individual)</div><b>' + esc(v.payee_name || '') + '</b> &nbsp; <span style="color:#666">' + esc((v.payee_id_type || '').toUpperCase()) + ' ' + esc(v.payee_id_no || '') + '</span><div>TIN: ' + esc(v.payee_tin || '—') + ' &nbsp; Payment type: ' + esc(v.payment_type || '') + (v.classification_code ? (' &nbsp; Class: ' + esc(v.classification_code)) : '') + '</div><div style="color:#555">' + esc(v.payee_address || '') + '</div></div>' +
    '<table><thead><tr><th style="width:26px">#</th><th>Description</th><th class="r" style="width:50px">Qty</th><th class="r" style="width:90px">Unit price</th><th class="r" style="width:100px">Amount</th></tr></thead><tbody>' + items + '</tbody></table>' +
    '<table class="tot" style="margin-top:8px"><tr><td colspan="4" class="r">Subtotal</td><td class="r" style="width:100px">' + Number(v.gross_amount || 0).toFixed(2) + '</td></tr>' + (Number(v.sst_amount) > 0 ? '<tr><td colspan="4" class="r">SST</td><td class="r">' + Number(v.sst_amount).toFixed(2) + '</td></tr>' : '') + whtRow + '<tr class="net"><td colspan="4" class="r">NET PAYABLE</td><td class="r">' + fmt(v.net_payable) + '</td></tr></table>' +
    '<div style="margin-top:16px;border:1.5px solid #111;border-radius:6px;padding:10px"><div class="lbl" style="color:#111;font-weight:bold">Payment details</div><table style="border:none;margin-top:2px"><tr><td style="border:none;padding:2px 8px 2px 0;color:#666;width:130px">Bank name</td><td style="border:none;padding:2px 0"><b>' + esc(v.payee_bank_name || '—') + '</b></td></tr><tr><td style="border:none;padding:2px 8px 2px 0;color:#666">Account holder</td><td style="border:none;padding:2px 0"><b>' + esc(v.payee_bank_holder || v.payee_name || '—') + '</b></td></tr><tr><td style="border:none;padding:2px 8px 2px 0;color:#666">Account number</td><td style="border:none;padding:2px 0"><b>' + esc(v.payee_bank_account || '—') + '</b></td></tr></table></div>' +
    '<div class="decl">This is a <b>self-billed invoice</b> issued by ' + esc(v.buyer_name || co) + ' on behalf of ' + esc(v.payee_name || '') + '. ' + ((Number(v.wht_amount) || 0) > 0 ? ('Withholding tax of ' + (v.wht_rate || 0) + '% (' + fmt(v.wht_amount) + ') has been deducted and will be remitted to LHDN. ') : '') + 'Retain this document and all supporting evidence for audit. WHT applicability and MyInvois classification to be confirmed by a licensed tax agent.</div>' +
    '</body></html>';
}

// ── THE COMPONENT ─────────────────────────────────────────────────────────────────────────────────

/**
 * Every inline style is written as a STRING and split here, not as a React style object — see
 * src/finance-wht.tsx's `st()` for the full reasoning. This screen has far more than the handful
 * finance-collections got away with writing as objects, so it copies the splitter.
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

/** `stCol` — app.html:4254. The only thing separating a draft from a paid invoice on screen. */
const STATUS_COLOUR: Record<string, string> = {
  draft: 'var(--muted)',
  approved: 'var(--sky-soft)',
  paid: 'var(--green-soft)',
  void: 'var(--red-soft)',
};

export type LineKey = 'description' | 'qty' | 'unit_price' | 'amount';

export interface FinanceSelfbillProps {
  companies: Company[];
  /** `SBI.payees` — `{api:'individuals_list'}`.individuals. */
  payees: Payee[];
  /** `SBI.list` — `{api:'sbi_list'}`.invoices. `null` is the pre-response state, not "none yet". */
  list: InvoiceRow[] | null;
  /** app.html:4243 — the catch branch. `null` when there is none. */
  error?: string | null;
  /** `SBI.showPayees` — FALSE in the golden. */
  showPayees: boolean;
  /** The payees panel's inline form. `null` is closed; `{}` is `sbiPayeeForm(0)`, a blank record. */
  payeeForm: Partial<Payee> | null;
  /** `#sbi_form`. `null` is closed, which is the golden. */
  form: Invoice | null;
  /** `SBI.editId` — null on a new invoice. */
  editId: number | null;
  /** `SBI.lines`. Only read when `form` is open. */
  lines: Line[];
  /** `SBI.accounts`, already loaded for the picked company. Empty before `sbi_accounts` resolves. */
  accounts: Account[];
  /** The live `#sbi_wht` value and `#sbi_wht_rate` — the route owns them so the totals box can follow. */
  whtType: string;
  customRate: number | string;
  /** `SBI_SAVING` — app.html:4413's double-submit lock. */
  saving?: boolean;

  onTogglePayees: () => void;
  onNewInvoice: () => void;
  onView: (id: number) => void;
  onEdit: (id: number) => void;
  onApprove: (id: number) => void;
  onPostXero: (id: number, posted: boolean) => void;
  onVoid: (id: number) => void;

  onPayeeForm: (id: number) => void;
  onDeletePayee: (id: number) => void;
  onSavePayee: () => void;
  onClosePayeeForm: () => void;

  onCloseForm: () => void;
  onPickCompany: () => void;
  onPickPayee: () => void;
  onPtypeChange: () => void;
  onClassTouched: () => void;
  onWhtChange: () => void;
  onLineChange: (i: number, k: LineKey, v: string) => void;
  onAddLine: () => void;
  onRmLine: (i: number) => void;
  onSave: () => void;
}

/** `renderSelfbill()`'s Loading panel — app.html:4239, character for character. In no golden. */
function Loading() {
  return (
    <div className="panel">
      <div className="muted" style={st('padding:24px;text-align:center')}><span className="spin"></span> Loading…</div>
    </div>
  );
}

/** `sbiRender()` — app.html:4247. This component is every byte of the `#selfbill` tab div. */
export default function FinanceSelfbill(props: FinanceSelfbillProps) {
  if (props.error) {
    // app.html:4243 — the catch branch, a bare `.empty` inside a panel.
    return <div className="panel"><div className="empty"><div className="empty-ico">⚠️</div><div>{props.error}</div></div></div>;
  }
  if (!props.list) return <Loading />;

  return (
    <>
      <div style={st('display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px')}>
        <div><h2 style={st('margin:0;font-size:19px')}>🧑 Personal (Self-Billed) Invoices</h2>
          <div className="muted" style={st('font-size:12px')}>Issue an invoice on an individual’s behalf to pay them — Malaysian tax &amp; audit format.</div></div>
        <div style={st('display:flex;gap:8px')}>
          <button className="btn sm" onClick={props.onTogglePayees}>{'👤 Payees (' + props.payees.length + ')'}</button>
          <button className="btn p sm" onClick={props.onNewInvoice}>+ New self-billed invoice</button>
        </div>
      </div>
      {props.showPayees ? <PayeesPanel {...props} /> : null}
      <div id="sbi_form">{props.form ? <InvoiceForm {...props} inv={props.form} /> : null}</div>
      <InvoiceTable {...props} list={props.list} />
    </>
  );
}

/** The invoice list — app.html:4252-4260. The only part of this screen a golden holds. */
function InvoiceTable(props: FinanceSelfbillProps & { list: InvoiceRow[] }) {
  const rows = props.list.map((x) => {
    const co = (props.companies.find((c) => c.tenant_id === x.tenant_id) || { tenant_name: '' }).tenant_name || x.tenant_id;
    const stCol = STATUS_COLOUR[x.status] || 'var(--muted)';
    // app.html:4257 — three independent conditions, mirrored exactly. `!x.xero_bill_id` is what stops an
    // invoice already in Xero being edited or double-posted, and it is NOT the same as `status==='draft'`.
    const editable = x.status !== 'void' && !x.xero_bill_id;
    return (
      <tr key={x.id}>
        <td><b>{x.invoice_no || '—'}</b></td>
        <td className="muted" style={st('font-size:11.5px')}>{sbiShort(co)}</td>
        <td>{x.payee_name || ''}</td>
        <td className="muted" style={st('font-size:11.5px')}>{x.invoice_date || ''}</td>
        <td className="amt">{M(x.gross_amount)}</td>
        <td className="amt" style={st('color:var(--amber)')}>{M(x.wht_amount)}</td>
        <td className="amt" style={st('font-weight:700')}>{M(x.net_payable)}</td>
        <td><span className="pill" style={st('color:' + stCol + ';font-size:10px;text-transform:uppercase')}>{x.status}</span></td>
        <td style={st('white-space:nowrap')}>
          <button className="btn xs" onClick={() => props.onView(x.id)}>View</button>
          {editable ? <>{' '}<button className="btn xs" onClick={() => props.onEdit(x.id)}>Edit</button></> : null}
          {x.status === 'draft' ? <>{' '}<button className="btn xs" onClick={() => props.onApprove(x.id)}>Approve</button></> : null}
          {editable ? <>{' '}<button className="btn xs" onClick={() => props.onPostXero(x.id, false)}>→ Xero</button></> : null}
          {x.xero_bill_id ? <>{' '}<span className="pill pill-green" style={st('font-size:9px')}>in Xero</span>{' '}
            <button className="btn xs" title="Re-send the Reference and attach the invoice PDF to the existing Xero bill" onClick={() => props.onPostXero(x.id, true)}>↻ Sync PDF</button></> : null}
          {x.status === 'draft' ? <>{' '}<button className="btn xs" onClick={() => props.onVoid(x.id)}>Void</button></> : null}
        </td>
      </tr>
    );
  });
  return (
    <div className="panel"><div className="panel-hd"><h3>Invoices</h3></div><div className="tbl-wrap">
      <table className="bigtable">
        <thead><tr>
          <th>Invoice No</th><th>Company</th><th>Payee</th><th>Date</th>
          <th className="amt">Gross</th><th className="amt">WHT</th><th className="amt">Net payable</th>
          <th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody>{rows.length ? rows : (
          <tr><td colSpan={9} className="muted" style={st('text-align:center;padding:20px')}>No self-billed invoices yet. Click “New self-billed invoice”.</td></tr>
        )}</tbody>
      </table>
    </div></div>
  );
}

/**
 * `sbiPayeesPanel()` — app.html:4264. NOT IN THE GOLDEN: `SBI.showPayees` is false when the harness
 * captures the screen. Every row here carries an individual's IC/passport number, TIN and BANK ACCOUNT,
 * which is why this screen's gate is the admin one.
 */
function PayeesPanel(props: FinanceSelfbillProps) {
  const rows = props.payees.map((p) => (
    <tr key={p.id}>
      <td><b>{p.name}</b></td>
      <td className="muted" style={st('font-size:11.5px')}>{(p.id_type || '').toUpperCase() + ' ' + (p.id_no || '')}</td>
      <td className="muted" style={st('font-size:11.5px')}>{p.tin || '—'}</td>
      <td className="muted" style={st('font-size:11.5px')}>{(p.bank_name || '') + ' ' + (p.bank_account || '')}</td>
      <td className="muted" style={st('font-size:11px')}>{p.default_payment_type || ''}</td>
      <td style={st('white-space:nowrap')}>
        <button className="btn xs" onClick={() => props.onPayeeForm(p.id)}>Edit</button>{' '}
        <button className="btn xs" onClick={() => props.onDeletePayee(p.id)}>Del</button>
      </td>
    </tr>
  ));
  return (
    <div className="panel" style={st('margin-bottom:14px')}>
      <div className="panel-hd"><h3>👤 Payees (individuals)</h3>
        <button className="btn sm" onClick={() => props.onPayeeForm(0)}>+ Add payee</button></div>
      <div id="sbi_payee_form">{props.payeeForm ? <PayeeFormBox p={props.payeeForm} onSave={props.onSavePayee} onCancel={props.onClosePayeeForm} /> : null}</div>
      <div className="tbl-wrap"><table className="bigtable">
        <thead><tr><th>Name</th><th>ID</th><th>TIN</th><th>Bank</th><th>Type</th><th></th></tr></thead>
        <tbody>{rows.length ? rows : (
          <tr><td colSpan={6} className="muted" style={st('text-align:center;padding:14px')}>No payees yet.</td></tr>
        )}</tbody>
      </table></div>
    </div>
  );
}

/**
 * `sbiPayeeForm()` — app.html:4270. UNCONTROLLED, and the `pf_*` ids ARE the contract: `sbiSavePayee()`
 * (app.html:4290) reads the form back out of the DOM by them, and the route does the same. A field that
 * loses its id saves as BLANK — on this form that is a wiped bank account or IC, with no error anywhere.
 */
function PayeeFormBox({ p, onSave, onCancel }: { p: Partial<Payee>; onSave: () => void; onCancel: () => void }) {
  const inp = (k: string, ph: string, val: unknown) =>
    <input id={'pf_' + k} placeholder={ph} defaultValue={val == null ? '' : String(val)} style={st(INP)} />;
  return (
    <div style={st('background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px')}>
      <input type="hidden" id="pf_id" defaultValue={p.id ? String(p.id) : ''} />
      <div style={st('display:grid;grid-template-columns:1fr 120px 1fr;gap:8px;margin-bottom:8px')}>
        {inp('name', 'Full name *', p.name)}
        <select id="pf_id_type" defaultValue={p.id_type || 'ic'} style={st('padding:7px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:var(--text)')}>
          {['ic', 'passport', 'brn'].map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
        </select>
        {inp('id_no', 'IC / Passport / Reg no.', p.id_no)}
      </div>
      <div style={st('display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px')}>
        {inp('tin', 'TIN (MyInvois)', p.tin)}{inp('phone', 'Phone', p.phone)}{inp('email', 'Email', p.email)}
      </div>
      <div style={st('margin-bottom:8px')}>{inp('address', 'Address', p.address)}</div>
      <div style={st('display:grid;grid-template-columns:1fr 1fr 160px;gap:8px;margin-bottom:8px')}>
        {inp('bank_name', 'Bank name', p.bank_name)}{inp('bank_account', 'Bank account no.', p.bank_account)}
        <select id="pf_ptype" defaultValue={p.default_payment_type || 'service'} style={st('padding:7px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:var(--text)')}>
          {SBI_PTYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={st('display:flex;gap:8px')}>
        <button className="btn p sm" onClick={onSave}>Save payee</button>
        <button className="btn sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * `sbiFormRender()` — app.html:4293. NOT IN THE GOLDEN (`SBI.editId` is null after every load, so
 * `#sbi_form` is captured empty), and the largest of this screen's four unseen documents.
 *
 * UNCONTROLLED, and the `sbi_*` ids are the contract `sbiSave()` (app.html:4386) reads it back by —
 * the same arrangement `finance.qinv`'s `qi_*` and `finance.wht`'s `wp_*` carry. `sbi_gl` / `sbi_whtgl`
 * are keyed on the tenant so that swapping the company REBUILDS them rather than leaving another
 * company's chart of accounts selected.
 */
function InvoiceForm(props: FinanceSelfbillProps & { inv: Invoice }) {
  const inv = props.inv;
  const t = recalc(props.lines, props.whtType, props.customRate);
  const curCls = inv.classification_code || sbiClassDefault(inv.payment_type || 'service');
  const exp = props.accounts.filter((a) => a.cls === 'EXPENSE');
  const liab = props.accounts.filter((a) => a.cls === 'LIABILITY');
  const inp = (id: string, ph: string, val: unknown, extra?: Record<string, string>) =>
    <input id={id} placeholder={ph} defaultValue={val == null ? '' : String(val)} {...extra} style={st(INP)} />;
  // `sbiOptList()` — app.html:3537. Rebuilt per tenant; `key` carries the tenant so React remounts the
  // select and cannot leave the previous company's selection standing.
  const accOpts = (list: Account[], placeholder: string) => [
    <option key="" value="">{placeholder}</option>,
    ...list.map((a) => <option key={a.code} value={a.code}>{a.code + ' · ' + a.name}</option>),
  ];
  return (
    <div className="panel" style={st('margin-bottom:16px;border-color:var(--coral-soft)')}>
      <div className="panel-hd"><h3>{(props.editId ? 'Edit' : 'New') + ' self-billed invoice'}</h3>
        <button className="btn sm" onClick={props.onCloseForm}>✕ Close</button></div>

      <div style={st('display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px')}>
        <div><label className="muted" style={st('font-size:11px')}>Paying company *</label>
          <select id="sbi_co" defaultValue={inv.tenant_id || ''} onChange={props.onPickCompany} style={st('width:100%;padding:8px;background:var(--panel-2);border:1px solid var(--border);border-radius:6px;color:var(--text)')}>
            <option value="">— select paying company —</option>
            {props.companies.map((c) => <option key={c.tenant_id} value={c.tenant_id}>{c.tenant_name}</option>)}
          </select></div>
        <div><label className="muted" style={st('font-size:11px')}>Payee (individual) *</label>
          <select id="sbi_payee" defaultValue={inv.individual_id ? String(inv.individual_id) : ''} onChange={props.onPickPayee} style={st('width:100%;padding:8px;background:var(--panel-2);border:1px solid var(--border);border-radius:6px;color:var(--text)')}>
            <option value="">— select payee —</option>
            {props.payees.map((p) => <option key={p.id} value={p.id}>{p.name + (p.tin ? (' · TIN ' + p.tin) : '')}</option>)}
          </select></div>
      </div>

      <div id="sbi_buyer_box" style={st('background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:10px')}>
        <div className="muted" style={st('font-size:11px;margin-bottom:6px')}>BUYER (company) — auto-filled from Company Info, editable</div>
        <div style={st('display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:6px')}>
          {inp('sbi_bname', 'Legal name', inv.buyer_name)}{inp('sbi_bssm', 'SSM no.', inv.buyer_ssm)}
          {inp('sbi_btin', 'TIN', inv.buyer_tin)}{inp('sbi_bsst', 'SST no.', inv.buyer_sst)}
        </div>
        {inp('sbi_baddr', 'Registered address', inv.buyer_address)}
      </div>

      <div style={st('background:var(--panel-2);border:1px solid var(--coral-soft);border-radius:8px;padding:10px;margin-bottom:10px')}>
        <div className="muted" style={st('font-size:11px;margin-bottom:6px')}>💳 PAYMENT DETAILS (BANK) — required</div>
        <div style={st('display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px')}>
          {inp('sbi_bank_name', 'Bank name *', inv.payee_bank_name)}
          {inp('sbi_bank_holder', 'Account holder name', inv.payee_bank_holder)}
          {inp('sbi_bank_acct', 'Account number *', inv.payee_bank_account)}
        </div>
      </div>

      <div style={st('display:grid;grid-template-columns:130px 130px 1fr 220px;gap:10px;margin-bottom:10px')}>
        <div><label className="muted" style={st('font-size:11px')}>Invoice date</label>{inp('sbi_date', '', inv.invoice_date, { type: 'date' })}</div>
        <div><label className="muted" style={st('font-size:11px')}>Due date</label>{inp('sbi_due', '', inv.due_date, { type: 'date' })}</div>
        <div><label className="muted" style={st('font-size:11px')}>Payment type</label>
          <select id="sbi_ptype" defaultValue={inv.payment_type || 'service'} onChange={props.onPtypeChange} style={st('width:100%;padding:7px;background:var(--panel-2);border:1px solid var(--border);border-radius:6px;color:var(--text)')}>
            {SBI_PTYPES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select></div>
        <div><label className="muted" style={st('font-size:11px')}>MyInvois classification</label>
          <select id="sbi_class" defaultValue={curCls} onChange={props.onClassTouched} style={st(SEL)}>
            {SBI_CLASS.map((x) => <option key={x.c} value={x.c}>{x.d}</option>)}
          </select></div>
      </div>

      <div className="muted" style={st('font-size:11px;margin-bottom:4px')}>Line items</div>
      {/* `sbiLinesRender()` — app.html:4360. UNCONTROLLED, exactly as the legacy is: `sbiRecalc()`
          writes `l.amount` but never rewrites the Amount box, so an operator's typed override survives
          until the row set changes. The wrapper is keyed on the row COUNT so that adding or removing a
          line remounts every row — which is what `sbiLinesRender()`'s full rewrite does. */}
      <div id="sbi_lines" key={'lines' + props.lines.length}>
        {props.lines.map((l, i) => (
          <div key={i} style={st('display:grid;grid-template-columns:1fr 70px 110px 120px 28px;gap:6px;margin-bottom:5px')}>
            <input defaultValue={l.description == null ? '' : String(l.description)} placeholder="Description of service/goods"
              onInput={(e) => props.onLineChange(i, 'description', (e.target as HTMLInputElement).value)}
              style={st('padding:6px 8px;background:var(--panel-2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px')} />
            <input type="number" step="0.01" defaultValue={l.qty == null ? 1 : String(l.qty)}
              onInput={(e) => props.onLineChange(i, 'qty', (e.target as HTMLInputElement).value)}
              style={st('padding:6px;background:var(--panel-2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;text-align:right')} />
            <input type="number" step="0.01" defaultValue={l.unit_price == null ? 0 : String(l.unit_price)} placeholder="Unit price"
              onInput={(e) => props.onLineChange(i, 'unit_price', (e.target as HTMLInputElement).value)}
              style={st('padding:6px;background:var(--panel-2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;text-align:right')} />
            <input type="number" step="0.01" defaultValue={String(lineAmount(l))} placeholder="Amount"
              onInput={(e) => props.onLineChange(i, 'amount', (e.target as HTMLInputElement).value)}
              style={st('padding:6px;background:var(--panel-2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;text-align:right;font-weight:600')} />
            <button className="btn xs" onClick={() => props.onRmLine(i)} style={st('padding:2px 6px')}>✕</button>
          </div>
        ))}
      </div>
      <button className="btn xs" onClick={props.onAddLine} style={st('margin:6px 0')}>+ line</button>

      <div style={st('display:grid;grid-template-columns:1fr 240px;gap:16px;margin-top:10px')}>
        <div>
          <label className="muted" style={st('font-size:11px')}>GL account (expense) — the company&apos;s cost account</label>
          <select key={'gl' + (inv.tenant_id || '')} id="sbi_gl" defaultValue={inv.gl_account || ''} style={st(SEL)}>
            {props.accounts.length
              ? accOpts(exp.length ? exp : props.accounts, exp.length ? '— select expense account —' : '— no accounts —')
              : (inv.gl_account
                ? <option value={inv.gl_account}>{inv.gl_account}</option>
                : <option value="">— select company first —</option>)}
          </select>
          <div className="muted" style={st('font-size:10.5px;margin-top:3px')}>Loaded live from this company&apos;s Xero chart of accounts.</div>
          <div style={st('margin-top:8px')}>
            <label className="muted" style={st('font-size:11px')}>WHT payable GL (only if withholding)</label>
            <select key={'wg' + (inv.tenant_id || '')} id="sbi_whtgl" defaultValue={inv.wht_gl_account || ''} style={st(SEL)}>
              {props.accounts.length
                ? accOpts(liab.length ? liab : props.accounts, '— none (only if withholding) —')
                : (inv.wht_gl_account
                  ? <option value={inv.wht_gl_account}>{inv.wht_gl_account}</option>
                  : <option value="">— none —</option>)}
            </select>
          </div>
          <div style={st('margin-top:8px')}>
            <label className="muted" style={st('font-size:11px')}>Supporting docs (contract / proof / approval)</label>
            <input type="file" id="sbi_files" multiple style={st('font-size:11.5px;color:var(--muted)')} />
          </div>
          <div style={st('margin-top:8px')}><label className="muted" style={st('font-size:11px')}>Notes</label>{inp('sbi_notes', '', inv.notes)}</div>
        </div>
        <div style={st('background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:12px')}>
          <div style={st('margin-bottom:8px')}><label className="muted" style={st('font-size:11px')}>Withholding tax</label>
            <select id="sbi_wht" value={props.whtType} onChange={props.onWhtChange} style={st('width:100%;padding:7px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11.5px')}>
              {SBI_WHT.map((w) => <option key={w.v} value={w.v}>{w.label}</option>)}
            </select></div>
          {/* app.html:4331 — the rate box is `display:none` unless the type is `custom`. */}
          <div id="sbi_wht_rate_box" style={st('margin-bottom:8px;display:' + (props.whtType === 'custom' ? 'block' : 'none'))}>
            <label className="muted" style={st('font-size:11px')}>WHT rate %</label>
            {/* app.html:4331 carries NO handler on this box — the totals only follow it when the
                select next fires `sbiWhtChange()`. Mirrored as-is; wiring an oninput here would be a
                behaviour change, and the SERVER recomputes the withheld figure regardless. */}
            <input id="sbi_wht_rate" defaultValue={props.customRate == null ? '' : String(props.customRate)} type="number" step="0.01" style={st(INP)} />
          </div>
          <div style={st('border-top:1px solid var(--border);padding-top:8px;font-size:13px;line-height:1.9')}>
            <div style={st('display:flex;justify-content:space-between')}><span className="muted">Gross</span><b id="sbi_t_gross">{M(t.gross)}</b></div>
            <div style={st('display:flex;justify-content:space-between')}><span className="muted">WHT <span id="sbi_t_whtr">{t.rate ? '(' + t.rate + '%)' : ''}</span></span><b id="sbi_t_wht" style={st('color:var(--amber)')}>{M(t.wht)}</b></div>
            <div style={st('display:flex;justify-content:space-between;font-size:15px;margin-top:4px')}><span>Net payable</span><b id="sbi_t_net" style={st('color:var(--green-soft)')}>{M(t.net)}</b></div>
          </div>
          {/* app.html:4413's `SBI_SAVING` lock: the file read plus the network await leave the button
              clickable, and a double-click created TWO invoices with sequential numbers. */}
          <button className="btn p sm" id="sbi_save_btn" disabled={!!props.saving} style={st('width:100%;margin-top:10px')} onClick={props.onSave}>
            {props.saving ? 'Saving…' : (props.editId ? 'Save changes' : 'Create invoice')}
          </button>
        </div>
      </div>
      <div className="muted" style={st('font-size:11px;margin-top:10px;line-height:1.6')}>⚠️ Whether WHT applies (e.g. s.107D) and the MyInvois classification should be confirmed with your licensed tax agent. e-Invoice submission to IRBM is handled via Xero once posted.</div>
    </div>
  );
}
