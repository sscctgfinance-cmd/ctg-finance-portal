// Finance OS · AP Inbox — the React half of `renderAp()` / `apRender()` (app.html:6753).
//
// The legacy original is STILL THERE and still shipping; nothing was deleted from it except
// `apDeriveKeyword()`, which moved into the shared `ap.js` this file imports (see "arithmetic" below).
// Both screens are reachable side by side (`app.html#tab=ap` and `/finance/ap/`) — insofar as either is
// reachable at all, which today is "not at all": see `apReachable()`.
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. The session, the
// five loads, the six POSTs, the DOM reads, the confirms and the prompt live in app/finance/ap/page.tsx.
// See src/finance-wht.tsx's header for what a Finance screen differs on (no chrome in the golden, one
// section, `app/finance/<tab-id>/`, the gate in `showApp()`); none of that is repeated here.
//
// ── THE SHAPE OF THIS SCREEN, DECLARED ────────────────────────────────────────────────────────────
// `#ap` is ONE section and the golden holds all of it — but the screen has FOUR regions and the golden
// only reaches inside one of them:
//
//   1. Automation stat banner (5 cards)          — IN the golden, fully.
//   2. Panel "📧 AP Inbox": filters + inbox table + the detail slot
//                                                — IN the golden, with `AP_DETAIL === null`, so the
//                                                  slot holds the 📨 placeholder and `apRenderDetail()`
//                                                  — the largest single renderer on the screen —
//                                                  appears in no golden at all.
//   3. Panel "🗺 GL coding rules"                — HEADER in the golden; `AP_SHOW_RULES` is `false`,
//                                                  so `apRenderRules()`'s body is not.
//   4. Panel "⚙ Automation settings"             — HEADER in the golden; `AP_SHOW_SETTINGS` is `false`,
//                                                  so `apRenderSettings()`'s body is not.
//
// And one region that is not in `#ap` at all: `apShowPreviewModal()` (app.html:7071) appends
// `#ap_preview_modal` to `document.body`. It is a sibling overlay, not a branch of this renderer, and
// it is ported in full below because it is the last thing an operator reads before a bill enters Xero.
//
// So: one golden section, four regions, one of four bodies covered. Everything outside that is pinned
// by assertion in tests/finance-ap.parity.test.tsx, not by the diff.
//
// ── THE GOLDEN IS THE LOADED SCREEN — checked, not assumed ────────────────────────────────────────
// CLAUDE.md's Quick Invoice / Users / Gateway finding: check what the legacy renderer does AFTER its
// innerHTML write. `renderAp()` calls `spin('ap')`, awaits three loads, then calls `apRender()`, which
// writes `#ap` and returns; `renderAp()` then sets `loaded.ap = true` and stops. `apRender()` itself
// ends at the write — no `appendChild`, no `.value=`, no `classList`, no `.textContent`, no timeout.
// Both writes target the SAME id, so last-write-wins leaves the golden holding the LOADED screen and no
// skeleton. This is `finance.approvals`' case, NOT `finance.qinv`'s, and the screen's test proves it by
// reading app.html at run time rather than asserting it.
//
// ── ARITHMETIC: one lift, and everything else is a display echo ───────────────────────────────────
// The standard question is "does the server re-derive this figure?".
//   • The stat banner (`cnt.*`, `handled * 6`) is derived from the list the server just sent and is
//     shown to nobody but the operator. Nothing posts it. Quick Invoice's case — NOT lifted.
//   • Every money figure on the screen is the server's: `ai_verdict.total` in the inbox rows, and on
//     `ap_post` (finance.ts:1838) the server rebuilds the ENTIRE Xero payload itself — contact
//     resolution, the `Quantity||1` / `UnitAmount||0` coercions, the `account_code ||
//     suggested_gl_account || '610-1000'` fallback, the dates, and crucially the TENANT, which it takes
//     from the inbox row and not from anything the client sends. The client sends overrides. NOT lifted.
//   • `apDeriveKeyword()` is the exception and the one thing the server stores verbatim
//     (`ap_rule_save`, finance.ts:1899). A second copy could drift by one stop word and quietly teach a
//     different Chart-of-Account for every future bill matching it. LIFTED into `ap.js`, which
//     `app.html` now loads and this file imports through `ap.d.ts` — the `wht.js` / `o2o.js` /
//     `gateway.js` arrangement.
//
// ── DATES: THE ZONE IS PINNED IN THE LEGACY AND MUST STAY PINNED ──────────────────────────────────
// All three `toLocale*` calls on this screen pass `timeZone:'Asia/Kuala_Lumpur'` explicitly
// (app.html:6821, :6913, :6960). Dropping that option is invisible on this machine and on CI — both sit
// at UTC+8 — and west of Greenwich it prints the PREVIOUS DAY on an accounts-payable queue: the fixture's
// 2026-08-17T02:14Z reads "17 Aug, 10:14" zoned and "16 Aug, 22:14" unzoned. That is the Compliance
// Calendar's defect class exactly, and no output assertion run here can see it. So the two formatters
// below are exported, and the screen's test pins their SOURCE — every `toLocale*` in this file must
// carry the zone — as well as their output. (This is also why the screen needs no `hr.clock`-style zone
// pin in its test: the explicit option beats the harness's UTC default, which spreads the caller's
// options last.)

import { apDeriveKeyword } from '../../ap.js';

export { apDeriveKeyword };

/** `COMPANIES` — app.html:1391. */
export interface Company { tenant_id: string; tenant_name: string }

/** `PERMS` — resolved by `showApp()` from `my_perms`, `fallbackPerms()` (app.html:1398) standing in. */
export interface Perms { features?: string[] | null; manage_users?: boolean | null }

/**
 * app.html:1428 — and this one is not like most of its neighbours, so it is quoted verbatim:
 *
 *   else if(t==='ap') el.classList.toggle('hide', true);  // AP Inbox HIDDEN — Anthropic (Claude vision)
 *   credits exhausted 2026-07-09; flip true→!canManage to re-enable after a top-up
 *
 * The tab is hidden from EVERYONE — not admin-gated, not feature-gated. Its only twin is `ocr` on the
 * line above, for the same reason. That is a deliberate operational state, not an oversight, so the port
 * reproduces it exactly rather than helpfully restoring the rule the comment describes. Turning it back
 * on is one edit in app.html and one here, and it is the captain's call, not a migration detail.
 */
export function apReachable(_perms: Perms | null | undefined): boolean {
  return false;
}

/**
 * The rule app.html:1428's comment says to restore after a credit top-up — `true` → `!canManage`, i.e.
 * admin-only, the same gate `selfbill` / `wht` / `gateway` / `bankfeed` / `salesrecon` carry.
 *
 * Exported and tested so the re-enable instruction survives the port as an executable statement rather
 * than as a comment someone has to find. Nothing calls it: the route gates on `apReachable()` above, and
 * the screen's test pins that it does. Same arrangement as `ocrReachableAfterTopUp()`.
 */
export function apReachableAfterTopUp(perms: Perms | null | undefined): boolean {
  return !!(perms && perms.manage_users);
}

/** `M()` — app.html:1256. A currency FORMAT, not maths; one line, mirrored rather than imported. */
const M = (n: unknown) =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Every inline style is a STRING parsed here, not a React style object — same helper and same reason as
 * src/finance-wht.tsx and src/finance-ocr.tsx: nothing in tests/parity.ts touches an attribute VALUE, so
 * these are compared character for character, and a style object would re-serialise `.04em` unchanged
 * but `.5` as `0.5` and append `px` to a bare number.
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

// ── The status vocabulary — app.html:6731-6749, verbatim ───────────────────────────────────────────

/** `AP_STATUS_LABELS` — app.html:6733. Order matters: it is the status filter's option order. */
export const AP_STATUS_LABELS: Record<string, [string, string]> = {
  received: ['Received', 'muted'], processing: ['Processing…', 'sky'],
  needs_review: ['⚠ Needs review', 'amber'],
  reply_drafted: ['Reply ready', 'sky'],
  reply_sent: ['✉ Auto-replied', 'green'],
  duplicate_rejected: ['🚫 Duplicate', 'red'],
  duplicate_rejected_replied: ['🚫 Dup — replied', 'red'],
  compliance_rejected: ['❌ Missing docs', 'red'],
  company_conflict: ['Company conflict', 'red'],
  company_unknown: ['Company unknown', 'amber'],
  google_drive_access_issue: ['Drive access', 'amber'],
  auto_posting: ['Posting…', 'sky'],
  auto_posted: ['✅ Auto-posted', 'green'],
  posted: ['✅ Posted', 'green'],
  rejected: ['Rejected', 'muted'],
};

/** `AP_COLOR_RGB` / `AP_COLOR_VAR` — app.html:6750. */
const AP_COLOR_RGB: Record<string, string> = { green: '126,224,160', amber: '245,158,11', red: '239,68,68', sky: '91,155,213', muted: '107,122,147' };
const AP_COLOR_VAR: Record<string, string> = { green: '--green-soft', amber: '--amber', red: '--red-soft', sky: '--sky-soft', muted: '--muted' };

/** `AP_INBOUND_MAILBOX` — app.html:6732. */
export const AP_INBOUND_MAILBOX = 'ssc.ctgfinance';

// ── The two date formatters. See this file's header for why they are exported and source-pinned. ──

/**
 * `apRender()`'s inbox column and `apRenderDetail()`'s decision log — app.html:6821 and :6913, the same
 * options in both.
 *
 * `new Date(x)` on a missing value is an Invalid Date and prints "Invalid Date", exactly as the legacy
 * does; that is mirrored rather than guarded, because a row with no `received_at` is a data problem the
 * operator should see rather than a blank cell.
 */
export function apWhen(iso: unknown): string {
  return new Date(iso as string).toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** `apRenderDetail()`'s "Received …" line — app.html:6960. Full date and time, same zone. */
export function apReceived(iso: unknown): string {
  return new Date(iso as string).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });
}

// ── The records, as the server returns them ────────────────────────────────────────────────────────

export interface ApAttachment { name?: string | null; size?: number | null; download_url?: string | null }

/** `ai_verdict` — whatever `ap_process` wrote. Every field is optional there, and here. */
export interface ApVerdict {
  doc_type?: string | null;
  total?: number | string | null;
  confidence?: string | null;
  vendor_name?: string | null;
  invoice_no?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  suggested_gl_account?: string | null;
  line_items?: ApLine[] | null;
  issues?: string[] | null;
  audit_notes?: string[] | null;
  tax_review?: Record<string, string | null> | null;
  server_duplicate?: { number?: string | null; invoice_id?: string | null; inv_date?: string | null; total?: unknown; status?: string | null; amount_due?: unknown } | null;
  server_decision?: unknown;
  server_reasoning?: string | null;
  company_routing_status?: string | null;
  company_name?: string | null;
  company_code?: string | null;
  buyer_name_on_document?: string | null;
  company_conflict_reason?: string | null;
  reimb_has_claim_form?: boolean | null;
  reimb_claimant_signed?: boolean | null;
  reimb_approver_signed?: boolean | null;
  reimb_all_invoices_attached?: boolean | null;
  reimb_payment_proof_attached?: boolean | null;
  amount_consistent?: boolean | null;
  date_consistent?: boolean | null;
  inv_is_formal?: boolean | null;
  inv_has_supplier_id?: boolean | null;
  inv_bill_to_correct?: boolean | null;
}

export interface ApLine {
  description?: string | null;
  quantity?: number | string | null;
  unit_amount?: number | string | null;
  account_code?: string | null;
  gl_matched_keyword?: string | null;
}

/** One row of `ap_inbox_list` — app.html:6819. */
export interface ApItem {
  id: number;
  tenant_id?: string | null;
  tenant_name?: string | null;
  status?: string | null;
  received_at?: string | null;
  from_name?: string | null;
  from_email?: string | null;
  subject?: string | null;
  attachments?: ApAttachment[] | null;
  ai_verdict?: ApVerdict | null;
}

/** `ap_inbox_get`'s `item` — the inbox row plus the bodies and the reply draft. */
export interface ApDetail extends ApItem {
  text_body?: string | null;
  html_body?: string | null;
  reply_subject?: string | null;
  reply_body?: string | null;
  xero_invoice_number?: string | null;
  xero_invoice_id?: string | null;
}

/** `ap_decision_log`'s rows — app.html:6913. */
export interface ApDecision { created_at?: string | null; decision?: string | null; reasoning?: string | null }

/** One row of `ap_settings_get` — app.html:6857. */
export interface ApSetting {
  tenant_id: string;
  tenant_name?: string | null;
  routing_slug?: string | null;
  max_auto_post_amount?: number | string | null;
  auto_post_when_compliant?: boolean | null;
  auto_reply_when_rejected?: boolean | null;
  require_4item_reimbursement?: boolean | null;
  require_known_vendor_for_autopost?: boolean | null;
  ai_provider?: string | null;
  duplicate_check_days?: number | string | null;
  enabled?: boolean | null;
}

/** One row of `ap_rules_list` — app.html:6882. */
export interface ApRule {
  id: number;
  tenant_id?: string | null;
  pattern_keywords?: string[] | null;
  account_code?: string | null;
  notes?: string | null;
  priority?: number | string | null;
}

// ── The stat banner's counts. A display echo of the loaded list; see the header. ───────────────────

export interface ApCounts { posted: number; replied: number; rejected: number; review: number; total: number }

/** `apRender()`'s first block — app.html:6802. Split out so the bucketing can be driven directly. */
export function apCounts(inbox: ApItem[]): ApCounts {
  const cnt: ApCounts = { posted: 0, replied: 0, rejected: 0, review: 0, total: inbox.length };
  inbox.forEach((m) => {
    const s = m.status || '';
    if (s === 'posted' || s === 'auto_posted') cnt.posted++;
    else if (s === 'reply_sent' || s === 'duplicate_rejected_replied') cnt.replied++;
    else if (s === 'duplicate_rejected' || s === 'compliance_rejected' || s === 'rejected') cnt.rejected++;
    else if (s === 'needs_review') cnt.review++;
  });
  return cnt;
}

/**
 * `apRender()` — app.html:6810. `handled * 6` minutes, shown as hours from one hour up.
 *
 * Deliberately kept as one function of the counts rather than inlined, so the `>=60` boundary and the
 * one-decimal hour are drivable: `59m` and `1.0h` are one minute apart and read very differently.
 */
export function apMinutesSaved(cnt: ApCounts): string {
  const mins = (cnt.posted + cnt.replied + cnt.rejected) * 6;
  return mins >= 60 ? (mins / 60).toFixed(1) + 'h' : mins + 'm';
}

// ── The request bodies. No golden sees a request, and four of these change a real ledger or mailbox. ─

/**
 * `apPostBill()` — app.html:7134, `call({api:'ap_post', id, bill})`.
 *
 * The bill is OVERRIDES, not the whole document: `ap_post` (finance.ts:1845) prefers them over the AI
 * verdict field by field and takes the TENANT from the inbox row itself, so nothing here can bind a bill
 * to another company. What it CAN bind wrong is the supplier — `vendor_name` is what
 * `resolveContact(item.tenant_id, vendor)` looks up, so a blank or swapped vendor pays or credits the
 * wrong contact. Hence the id is required rather than defaulted.
 */
export function postBody(id: number | null, bill: Record<string, unknown>): Record<string, unknown> {
  if (!id) throw new Error('No email selected');
  return { api: 'ap_post', id, bill };
}

/** `apPreviewPayload()` — app.html:7059. The same bill, dry-run: nothing is sent to Xero. */
export function previewBody(id: number | null, bill: Record<string, unknown>): Record<string, unknown> {
  if (!id) throw new Error('No email selected');
  return { api: 'ap_post_preview', id, bill };
}

/** `apSendReply()` — app.html:7042. This one leaves the building: it emails the sender. */
export function replyBody(id: number | null, subject: string, body: string): Record<string, unknown> {
  if (!id) throw new Error('No email selected');
  if (!body.trim()) throw new Error('Reply body required');
  return { api: 'ap_reply_send', id, subject, body };
}

/** `apReject()` — app.html:7157. `reason || 'manually rejected'` is the legacy's own default. */
export function rejectBody(id: number | null, reason: string): Record<string, unknown> {
  if (!id) throw new Error('No email selected');
  return { api: 'ap_reject', id, reason: reason || 'manually rejected' };
}

/** `apSaveSettings()` — app.html:7025. Per-company automation limits; `tid` decides whose. */
export function settingsBody(tenant: string, patch: Record<string, string>): Record<string, unknown> {
  if (!tenant) throw new Error('Pick a company');
  return { api: 'ap_settings_save', tenant, patch };
}

/** `apAddRule()` — app.html:7168, and `apPostBill()`'s teach loop (:7145) with priority 200. */
export function ruleSaveBody(tenant: string, keywords: string[], accountCode: string, priority: number, notes?: string): Record<string, unknown> {
  if (!tenant || !keywords.length || !accountCode) throw new Error('Company, keywords and GL code required');
  const b: Record<string, unknown> = { api: 'ap_rule_save', tenant, keywords, account_code: accountCode, priority };
  if (notes !== undefined) b.notes = notes;
  return b;
}

/**
 * `apAddRule()`'s field read — app.html:7169. Split out because the keyword normalisation (trim,
 * lowercase, drop blanks) is what decides whether a rule ever matches: an untrimmed " grab" never fires
 * and the operator sees a saved rule that silently does nothing.
 */
export function parseKeywords(raw: string): string[] {
  return (raw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * `apCollectBill()`'s line filter — app.html:7053, the same rule `ocrPostBill()` carries:
 *   `.filter(l => l.description || l.unit_amount || Number(l.quantity) > 0)`
 * and its per-field coercion: `quantity` / `unit_amount` are `Number(v)||0`, everything else the raw
 * string. A row whose description was cleared but whose amount is still 15,000 is KEPT; a port that
 * tidied it to "needs a description" would drop RM 15,000 off a bill in Xero with nothing on screen
 * changing.
 */
export function collectLines(rows: ApLine[]): { description: string; quantity: number; unit_amount: number; account_code: string }[] {
  return rows
    .map((r) => ({
      description: String(r.description ?? ''),
      quantity: Number(r.quantity) || 0,
      unit_amount: Number(r.unit_amount) || 0,
      account_code: String(r.account_code ?? ''),
    }))
    .filter((l) => l.description || l.unit_amount || l.quantity > 0);
}

/**
 * The confirm `apPostBill()` shows before a bill exists in Xero — app.html:7133. Its `.toFixed(2)` is
 * the legacy's, not `M()`. The vendor it names is the contact the server will resolve.
 */
export function postConfirmText(bill: { vendor_name?: unknown; total?: unknown }): string {
  return 'Create Bill in Xero for ' + (bill.vendor_name || '?') + ' · Total: RM ' + (Number(bill.total || 0)).toFixed(2) + '?';
}

/** `apSendReply()`'s confirm — app.html:7046. It names the recipient, which is the point. */
export function replyConfirmText(email: unknown): string {
  return 'Send reply to ' + email + '?';
}

// ── Small pieces ───────────────────────────────────────────────────────────────────────────────────

/** `apStatusPill()` — app.html:6789. An unknown status keeps its raw name and goes muted. */
export function StatusPill({ status }: { status: string }) {
  const m = AP_STATUS_LABELS[status] || [status, 'muted'];
  const rgb = AP_COLOR_RGB[m[1]] || AP_COLOR_RGB.muted;
  const v = AP_COLOR_VAR[m[1]] || '--muted';
  return <span className="pill" style={st('font-size:10px;background:rgba(' + rgb + ',.16);color:var(' + v + ')')}>{m[0]}</span>;
}

/** `apStat()` — app.html:6795. `ico` and `n` are unescaped in the legacy; both are ours, not the data's. */
function Stat({ n, label, color, ico }: { n: number | string; label: string; color: string; ico: string }) {
  const v = AP_COLOR_VAR[color] || '--muted';
  return (
    <div style={st('flex:1;min-width:130px;background:var(--panel-2);border:1px solid var(--panel-border);border-radius:12px;padding:14px 16px')}>
      <div style={st('font-size:22px;font-weight:700;color:var(' + v + ');line-height:1')}>{ico + ' ' + n}</div>
      <div className="muted" style={st('font-size:11px;margin-top:5px;text-transform:uppercase;letter-spacing:.04em')}>{label}</div>
    </div>
  );
}

/** `apRenderDetail()`'s `fld()` — app.html:6897. Uncontrolled; `data-bk` is what `apCollectBill()` reads. */
function Fld({ label, k, val, type }: { label: string; k: string; val: unknown; type?: string }) {
  return (
    <div style={st('margin-bottom:8px')}>
      <label style={st('font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:3px')}>{label}</label>
      <input type={type || 'text'} data-bk={k} defaultValue={val == null ? '' : String(val)} style={st('width:100%')} />
    </div>
  );
}

/** `apRenderDetail()`'s `chk()` — app.html:6900. */
function Chk({ ok, label }: { ok: unknown; label: string }) {
  return (
    <div style={st('display:flex;align-items:center;gap:7px;font-size:12px;padding:2px 0')}>
      <span style={st('color:var(' + (ok ? '--green-soft' : '--red-soft') + ');font-weight:700;width:14px')}>{ok ? '✓' : '✗'}</span>
      <span style={st('color:var(' + (ok ? '--text' : '--red-soft') + ')')}>{label}</span>
    </div>
  );
}

// ── The detail pane — `apRenderDetail()`, app.html:6893. In no golden. ────────────────────────────

export interface ApDetailProps {
  detail: ApDetail;
  decisions: ApDecision[];
  onSendReply: () => void;
  onRerun: () => void;
  onReject: () => void;
  onPreview: () => void;
  onPostBill: () => void;
}

export function ApDetailPane(p: ApDetailProps) {
  const d = p.detail || ({} as ApDetail);
  const ai = d.ai_verdict || {};
  const issues = ai.issues || [];
  const status = d.status || 'received';
  const dup = ai.server_duplicate;
  const decision = ai.server_decision;
  const reasoning = ai.server_reasoning;
  const docType = ai.doc_type;
  const taxReview = ai.tax_review || {};

  const confidence = ai.confidence || 'medium';
  const confPill = confidence === 'high'
    ? <span className="pill pill-green" style={st('font-size:10px')}>high confidence</span>
    : confidence === 'low'
      ? <span className="pill" style={st('background:rgba(239,68,68,.16);color:var(--red-soft);font-size:10px')}>low confidence</span>
      : <span className="pill" style={st('background:rgba(245,158,11,.16);color:var(--amber);font-size:10px')}>medium confidence</span>;

  const routingStatus = ai.company_routing_status || '';
  const routingColor = routingStatus === 'company_matched_high_confidence' ? 'var(--green-soft)'
    : routingStatus === 'company_matched_medium_confidence' ? 'var(--amber)' : 'var(--red-soft)';

  const taxVals = ['sst_risk', 'wht_risk', 'imported_service_tax_risk', 'capitalisation_risk', 'prepayment_risk']
    .filter((k) => taxReview[k] && taxReview[k] !== 'none');

  // app.html:6971 — the same three states `ocrPostBill()`'s buttons key off, and the whole reason the
  // Post button is not simply always there.
  const canPost = (status === 'needs_review' || status === 'auto_posted') && !!(ai.line_items || []).length;
  const canReply = (status === 'reply_drafted' || status === 'needs_review' || status === 'compliance_rejected' || status === 'duplicate_rejected');
  const canRerun = status !== 'posted' && status !== 'auto_posted';
  const isDone = (status === 'posted' || status === 'auto_posted' || status === 'reply_sent' || status === 'duplicate_rejected_replied' || status === 'rejected');

  const atts = (d.attachments || []);

  return (
    <div style={st('background:var(--panel-2);border:1px solid var(--panel-border);border-radius:12px;padding:18px;margin-top:14px')}>
      <div style={st('display:grid;grid-template-columns:1fr 1fr;gap:18px')}>
        {/* LEFT — original email + attachments + compliance */}
        <div>
          <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px')}>Original email</div>
          <div style={st('background:var(--panel);border:1px solid var(--panel-border);border-radius:8px;padding:12px;margin-bottom:10px')}>
            <div style={st('font-size:12.5px')}><b>From:</b>{' ' + (d.from_name || '') + ' <' + (d.from_email || '') + '>'}</div>
            <div style={st('font-size:12.5px;margin:4px 0')}><b>Subject:</b>{' ' + (d.subject || '')}</div>
            <div style={st('font-size:11.5px;color:var(--muted)')}>
              {'Received ' + apReceived(d.received_at) + ' MYT · ' + (d.tenant_name || d.tenant_id || '') + (docType ? ' · ' + docType : '')}
            </div>
          </div>
          <div style={st('background:var(--panel);border:1px solid var(--panel-border);border-radius:8px;padding:12px;max-height:200px;overflow-y:auto;font-size:12.5px;white-space:pre-wrap;line-height:1.5;margin-bottom:10px')}>
            {(d.text_body || d.html_body || '').slice(0, 3000)}
          </div>
          {atts.length ? (
            <div style={st('margin-bottom:10px')}>
              <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px')}>Attachments</div>
              {atts.map((a, i) => (
                <a key={i} href={a.download_url || '#'} target="_blank" rel="noopener" style={st('display:inline-flex;align-items:center;gap:6px;padding:6px 11px;background:var(--panel-2);border:1px solid var(--panel-border);border-radius:8px;font-size:12px;color:var(--text);text-decoration:none;margin:4px 6px 4px 0')}>
                  {'📎 ' + (a.name || 'file') + ' '}
                  <span className="muted" style={st('font-size:10.5px')}>{((a.size || 0) / 1024).toFixed(0) + ' KB'}</span>
                </a>
              ))}
            </div>
          ) : null}
          {/* app.html:6923 — the compliance checklist, one per doc type, and none for anything else. */}
          {docType === 'reimbursement' ? (
            <div style={st('background:var(--panel);border:1px solid var(--panel-border);border-radius:8px;padding:12px;margin-bottom:10px')}>
              <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px')}>Reimbursement compliance (MFRS)</div>
              <Chk ok={ai.reimb_has_claim_form} label="Claim form present" />
              <Chk ok={ai.reimb_claimant_signed} label="Claimant signature" />
              <Chk ok={ai.reimb_approver_signed} label="Approver / manager signature" />
              <Chk ok={ai.reimb_all_invoices_attached} label="Formal invoice for every line item" />
              <Chk ok={ai.reimb_payment_proof_attached} label="Payment proof (card/bank receipt)" />
              <Chk ok={ai.amount_consistent !== false} label="Amounts match across documents" />
              <Chk ok={ai.date_consistent !== false} label="Dates consistent (one period)" />
            </div>
          ) : docType === 'invoice' ? (
            <div style={st('background:var(--panel);border:1px solid var(--panel-border);border-radius:8px;padding:12px;margin-bottom:10px')}>
              <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px')}>Supplier invoice compliance (MFRS/SST)</div>
              <Chk ok={ai.inv_is_formal} label="Formal tax invoice (not receipt/quote)" />
              <Chk ok={ai.inv_has_supplier_id} label="Supplier SST / business reg no." />
              <Chk ok={ai.inv_bill_to_correct} label="Bill-to is the correct Sdn Bhd" />
              <Chk ok={ai.amount_consistent !== false} label="Amounts match across documents" />
            </div>
          ) : null}
        </div>

        {/* RIGHT — AI verdict + decision + bill / reply */}
        <div>
          <div style={st('display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap')}>
            <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>AI verdict</div>
            {confPill}
            <StatusPill status={status} />
          </div>

          {/* routingBox — app.html:6910 */}
          {routingStatus ? (
            <div style={st('background:var(--panel);border:1px solid var(--panel-border);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12px')}>
              <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px')}>Company routing</div>
              <div>
                <b style={{ color: routingColor }}>{routingStatus.replace(/_/g, ' ')}</b>
                {(ai.company_name ? ' · ' + ai.company_name : '') + (ai.company_code ? ' [' + ai.company_code + ']' : '')}
              </div>
              {ai.buyer_name_on_document ? <div className="muted" style={st('margin-top:3px')}>{'Buyer on document: ' + ai.buyer_name_on_document}</div> : null}
              {ai.company_conflict_reason ? <div style={st('color:var(--red-soft);margin-top:3px')}>{ai.company_conflict_reason}</div> : null}
            </div>
          ) : null}

          {/* decBox — app.html:6919 */}
          {decision ? (
            <div style={st('background:var(--panel);border:1px solid var(--panel-border);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12px')}>
              <b>🤖 System decision:</b>{' '}<StatusPill status={status} />
              <div className="muted" style={st('margin-top:4px;line-height:1.5')}>{reasoning || ''}</div>
            </div>
          ) : null}

          {/* dupBox — app.html:6917. The row that means "we already have this bill". */}
          {dup ? (
            <div style={st('background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.4);border-radius:8px;padding:12px;margin-bottom:10px;color:var(--red-soft)')}>
              <b>🚫 Duplicate detected</b>
              <div style={st('font-size:12px;margin-top:5px;color:var(--text)')}>
                {'Matches an existing bill '}<b>{dup.number || dup.invoice_id || ''}</b>
                {' · ' + (dup.inv_date || '') + ' · RM ' + (dup.total ?? '') + ' · status '}
                <b>{dup.status || ''}</b>
                {' (amount due RM ' + (dup.amount_due ?? '0') + '). No new bill was created.'}
              </div>
            </div>
          ) : null}

          {/* taxBox — app.html:6907 */}
          {taxVals.length ? (
            <div style={st('background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:var(--amber)')}>
              <b>Tax/accounting review:</b>{' ' + taxVals.map((k) => k.replace(/_/g, ' ') + ': ' + taxReview[k]).join(' · ')}
            </div>
          ) : null}

          {/* auditBox — app.html:6908 */}
          {(ai.audit_notes && ai.audit_notes.length) ? (
            <details style={st('margin-bottom:10px')}>
              <summary style={st('font-size:11px;color:var(--muted);cursor:pointer;text-transform:uppercase;letter-spacing:.05em')}>Controller audit notes</summary>
              <ul style={st('margin:8px 0 0 17px;padding:0;font-size:11.5px;color:var(--text-soft);line-height:1.5')}>
                {ai.audit_notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </details>
          ) : null}

          {/* logBox — app.html:6913 */}
          {(p.decisions && p.decisions.length) ? (
            <details style={st('margin-bottom:10px')}>
              <summary style={st('font-size:11px;color:var(--muted);cursor:pointer;text-transform:uppercase;letter-spacing:.05em')}>{'Decision audit log (' + p.decisions.length + ')'}</summary>
              <div style={st('margin-top:8px')}>
                {p.decisions.map((x, i) => (
                  <div key={i} style={st('font-size:11.5px;padding:5px 0;border-bottom:1px solid var(--panel-border)')}>
                    <span className="muted">{apWhen(x.created_at)}</span>{' · '}<b>{x.decision}</b>
                    {x.reasoning ? <div className="muted" style={st('font-size:10.5px;margin-top:2px')}>{x.reasoning}</div> : null}
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {issues.length ? (
            <div style={st('background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--amber);margin-bottom:10px')}>
              <b>⚠ Issues:</b>{' ' + issues.join(' · ')}
            </div>
          ) : null}

          {isDone ? (
            (status === 'posted' || status === 'auto_posted') ? (
              <div style={st('background:rgba(126,224,160,.08);border:1px solid var(--green-soft);border-radius:8px;padding:14px;color:var(--green-soft)')}>
                <b>✅ Posted to Xero</b>{' as ' + (d.xero_invoice_number || d.xero_invoice_id || '')}
                <div className="muted" style={st('font-size:11.5px;margin-top:4px')}>Source files attached automatically. Nothing more to do.</div>
              </div>
            ) : (status === 'reply_sent' || status === 'duplicate_rejected_replied') ? (
              <div style={st('background:rgba(126,224,160,.08);border:1px solid var(--green-soft);border-radius:8px;padding:14px;color:var(--green-soft)')}>
                <b>✉ Auto-replied</b>{' to ' + d.from_email}
                <div className="muted" style={st('font-size:11.5px;margin-top:4px;color:var(--text);white-space:pre-wrap')}>{(d.reply_body || '').slice(0, 500)}</div>
              </div>
            ) : (
              <div style={st('background:var(--panel);border:1px solid var(--panel-border);border-radius:8px;padding:14px;color:var(--muted)')}>Rejected. No further action.</div>
            )
          ) : (
            <>
              {canReply ? (
                <div style={st('background:var(--panel);border:1px solid var(--panel-border);border-radius:8px;padding:12px;margin-bottom:10px')}>
                  <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px')}>Draft reply (edit + send)</div>
                  {/* Uncontrolled and keeping the legacy ids: `apSendReply()` reads #ap_reply_subject /
                      #ap_reply_body back out of the DOM, and so does the route. */}
                  <input id="ap_reply_subject" defaultValue={d.reply_subject || ''} placeholder="Subject" style={st('width:100%;font-size:13px;margin-bottom:6px')} />
                  <textarea id="ap_reply_body" rows={6} placeholder="Body" defaultValue={d.reply_body || ''} style={st('width:100%;font-size:13px')} />
                  <div style={st('display:flex;gap:8px;margin-top:8px;justify-content:flex-end')}>
                    <button className="btn p" onClick={p.onSendReply}>✉ Send reply</button>
                  </div>
                </div>
              ) : null}
              {canPost ? (
                <div id="ap_bill_form" style={st('background:var(--panel);border:1px solid var(--panel-border);border-radius:8px;padding:12px')}>
                  <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px')}>Bill to post (ACCPAY)</div>
                  <div style={st('display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px')}>
                    <Fld label="Vendor" k="vendor_name" val={ai.vendor_name} />
                    <Fld label="Invoice no." k="invoice_no" val={ai.invoice_no} />
                    <Fld label="Invoice date" k="invoice_date" val={ai.invoice_date} type="date" />
                    <Fld label="Due date" k="due_date" val={ai.due_date} type="date" />
                    <Fld label="Total" k="total" val={ai.total} type="number" />
                  </div>
                  <div style={st('margin-top:10px')}>
                    <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px')}>Line items + GL codes</div>
                    <table id="ap_lines" style={st('width:100%;font-size:12.5px')}>
                      <thead><tr>
                        <th style={st('text-align:left')}>Description</th>
                        <th style={st('text-align:left')}>Qty</th>
                        <th style={st('text-align:left')}>Unit</th>
                        <th style={st('text-align:left')}>GL</th>
                      </tr></thead>
                      <tbody>
                        {(ai.line_items || []).map((l, i) => (
                          <tr key={i}>
                            <td><input data-li-i={i} data-li-k="description" defaultValue={String(l.description || '')} style={st('width:100%;font-size:12px')} /></td>
                            <td><input data-li-i={i} data-li-k="quantity" type="number" defaultValue={String(l.quantity || 1)} style={st('width:55px;font-size:12px')} /></td>
                            <td><input data-li-i={i} data-li-k="unit_amount" type="number" step="0.01" defaultValue={String(l.unit_amount || 0)} style={st('width:90px;font-size:12px')} /></td>
                            {/* app.html:6902 — the line's own code, then the document suggestion, then Xero's default. */}
                            <td>
                              <input data-li-i={i} data-li-k="account_code" defaultValue={String(l.account_code || ai.suggested_gl_account || '904-2200')} style={st('width:95px;font-size:12px')} />
                              {l.gl_matched_keyword
                                ? <div className="muted" style={st('font-size:9px')}>{'via "' + l.gl_matched_keyword + '"'}</div>
                                : <div style={st('font-size:9px;color:var(--amber)')}>no rule — set manually</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <label style={st('display:flex;align-items:center;gap:7px;font-size:11.5px;margin-top:10px;cursor:pointer')}>
                    <input type="checkbox" id="ap_teach" style={st('width:auto')} />
                    🎓 Remember these GL codes — auto-code similar bills next time (teaches the rule engine)
                  </label>
                  <div style={st('display:flex;gap:8px;margin-top:10px;justify-content:flex-end;flex-wrap:wrap')}>
                    {canRerun ? <button className="btn" id="ap_rerun_btn" onClick={p.onRerun}>🔁 Re-run AI</button> : null}
                    <button className="btn d" onClick={p.onReject}>Reject</button>
                    {/* v67: preview the exact Xero payload before posting — spec §F/§69 */}
                    <button className="btn" id="ap_preview_btn" onClick={p.onPreview} title="See the exact Xero JSON payload + sanity checks before posting">🔍 Preview payload</button>
                    <button className="btn p" id="ap_post_btn" onClick={p.onPostBill}>✓ Post to Xero</button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── The Xero payload preview — `apShowPreviewModal()`, app.html:7071. A sibling overlay, in no golden. ─

export interface ApPreview {
  payload?: unknown;
  checks?: { pass?: boolean; name?: string; detail?: string | null }[] | null;
  warnings?: string[] | null;
  xero_dupes?: { match_type?: string | null; invoice_number?: string | null; contact_name?: string | null; total?: number | string | null; date?: string | null; status?: string | null }[] | null;
  tenant_id?: string | null;
  idempotency_key?: string | null;
}

/**
 * `anyFail` — app.html:7101. It changes the primary button from "Looks good" to "⚠ Post anyway", which
 * is the whole point of the modal: a failing check or a Xero duplicate must not be able to hide behind a
 * green-looking button.
 */
export function previewAnyFail(r: ApPreview): boolean {
  return (r.checks || []).some((c) => !c.pass) || (r.xero_dupes || []).length > 0;
}

export function ApPreviewModal({ r, onClose, onPostAnyway }: { r: ApPreview; onClose: () => void; onPostAnyway: () => void }) {
  const pretty = JSON.stringify({ Invoices: [r.payload] }, null, 2);
  const dupes = r.xero_dupes || [];
  const anyFail = previewAnyFail(r);
  return (
    <div style={st('position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px')} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={st('background:linear-gradient(180deg,rgba(19,28,45,.98),rgba(12,20,33,.97));border:1px solid var(--border-strong);border-radius:16px;width:min(900px,96vw);max-height:88vh;overflow:hidden;display:flex;flex-direction:column')}>
        <div style={st('padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center')}>
          <div>
            <div style={st('font-size:15px;font-weight:700')}>🔍 Xero payload preview</div>
            <div style={st('font-size:11.5px;color:var(--muted);margin-top:2px')}>This is the EXACT JSON that will POST to Xero. Nothing has been sent yet.</div>
          </div>
          <button className="btn" onClick={onClose} style={st('padding:6px 11px')}>Close</button>
        </div>
        <div style={st('padding:16px 20px;overflow:auto;flex:1')}>
          {(r.warnings || []).length ? (
            <div style={st('background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12.5px;color:var(--red-soft)')}>
              {'⚠ '}
              {(r.warnings || []).map((w, i) => <span key={i}>{i ? <br /> : null}{w}</span>)}
            </div>
          ) : null}
          {dupes.length ? (
            <div style={st('background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.35);border-radius:8px;padding:10px 12px;margin-bottom:12px')}>
              <div style={st('font-size:12.5px;font-weight:600;color:var(--red-soft);margin-bottom:6px')}>{'🚨 Xero already has ' + dupes.length + ' bill' + (dupes.length > 1 ? 's' : '') + ' that may be duplicates:'}</div>
              <table style={st('width:100%;border-collapse:collapse;font-size:11.5px')}>
                <thead><tr style={st('color:var(--muted);text-transform:uppercase;font-size:10px;letter-spacing:.04em')}>
                  <th style={st('text-align:left;padding:4px')}>Match</th>
                  <th style={st('text-align:left;padding:4px')}>Invoice #</th>
                  <th style={st('text-align:left;padding:4px')}>Contact</th>
                  <th style={st('text-align:right;padding:4px')}>Total</th>
                  <th style={st('text-align:left;padding:4px')}>Date</th>
                  <th style={st('text-align:left;padding:4px')}>Status</th>
                </tr></thead>
                <tbody>
                  {dupes.map((x, i) => (
                    <tr key={i}>
                      <td style={st('padding:4px')}><span className="pill" style={st('background:rgba(239,68,68,.15);color:var(--red-soft);font-size:10px;padding:2px 6px;border-radius:4px')}>{x.match_type || ''}</span></td>
                      <td style={st('padding:4px;font-family:ui-monospace,Menlo,monospace')}>{x.invoice_number || '—'}</td>
                      <td style={st('padding:4px')}>{x.contact_name || ''}</td>
                      <td style={st('padding:4px;text-align:right;font-variant-numeric:tabular-nums')}>{'RM ' + Number(x.total || 0).toFixed(2)}</td>
                      <td style={st('padding:4px')}>{x.date || ''}</td>
                      <td style={st('padding:4px')}><span className="muted">{x.status || ''}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px')}>Sanity checks</div>
          <div style={st('border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:14px')}>
            <table style={st('width:100%;border-collapse:collapse')}><tbody>
              {(r.checks || []).map((c, i) => (
                <tr key={i}>
                  <td style={st('padding:6px 8px;width:24px;text-align:center')}>
                    {c.pass
                      ? <span style={st('color:var(--green-soft);font-weight:600')}>✓</span>
                      : <span style={st('color:var(--red-soft);font-weight:600')}>✗</span>}
                  </td>
                  <td style={st('padding:6px 8px;font-size:12.5px')}>{c.name}</td>
                  <td style={st('padding:6px 8px;font-size:11.5px;color:var(--muted)')}>{c.detail || ''}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
          <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px')}>{'Payload · POST /Invoices  ·  tenant ' + (r.tenant_id || '').slice(0, 8) + '…'}</div>
          <pre style={st('background:rgba(7,13,23,.7);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:11.5px;line-height:1.5;overflow:auto;max-height:340px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text-soft);white-space:pre')}>{pretty}</pre>
          <div style={st('font-size:11px;color:var(--muted);margin-top:6px')}>{'Idempotency-Key: '}<code style={st('background:rgba(255,255,255,.05);padding:2px 6px;border-radius:4px')}>{r.idempotency_key || ''}</code></div>
        </div>
        <div style={st('padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px')}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn p" style={anyFail ? st('opacity:.75') : undefined} onClick={onPostAnyway}>{anyFail ? '⚠ Post anyway' : '✓ Looks good — Post to Xero'}</button>
        </div>
      </div>
    </div>
  );
}

// ── GL coding rules — `apRenderRules()`, app.html:6882. Collapsed in the golden. ───────────────────

export interface ApRulesProps {
  companies: Company[];
  rules: ApRule[];
  rulesTenant: string;
  onRulesTenant: (v: string) => void;
  onRefresh: () => void;
  onDeleteRule: (id: number) => void;
  onAddRule: () => void;
}

export function ApRulesBody(p: ApRulesProps) {
  const nameByTenant: Record<string, string> = {};
  (p.companies || []).forEach((c) => { nameByTenant[c.tenant_id] = c.tenant_name; });
  const rules = p.rules || [];
  return (
    <div style={st('padding:4px 0 0')}>
      <div className="muted" style={st('font-size:12px;line-height:1.6;margin-bottom:10px')}>When a bill line matches any keyword, the AI auto-assigns that Chart-of-Account code. Highest priority wins. This is how the agent codes the right GL without you — and you teach it new patterns here or directly from a reviewed bill.</div>
      <div style={st('display:flex;gap:8px;align-items:center;margin-bottom:10px')}>
        <select id="ap_rules_tenant_filter" onChange={(e) => p.onRulesTenant((e.target as HTMLSelectElement).value)} value={p.rulesTenant} style={st('padding:5px 9px;font-size:12px')}>
          <option value="">All companies</option>
          {(p.companies || []).map((c) => <option key={c.tenant_id} value={c.tenant_id}>{c.tenant_name}</option>)}
        </select>
        <button className="btn sm" onClick={p.onRefresh}>↻</button>
      </div>
      <div className="tbl-wrap" style={st('margin-bottom:14px')}>
        <table className="bigtable" style={st('font-size:12px')}>
          <thead><tr><th>Company</th><th>Keywords (any match)</th><th>GL code</th><th>Notes</th><th>Prio</th><th></th></tr></thead>
          <tbody>
            {rules.length ? rules.map((r) => (
              <tr key={r.id}>
                <td className="muted" style={st('font-size:11px')}>{(nameByTenant[r.tenant_id || ''] || r.tenant_id || '').slice(0, 18)}</td>
                <td>{(r.pattern_keywords || []).map((k, i) => (
                  <span key={i}>{i ? ' ' : null}<span className="pill" style={st('font-size:10px;background:var(--panel-2);margin:1px')}>{k}</span></span>
                ))}</td>
                <td><code style={st('font-size:12px;color:var(--coral-soft)')}>{r.account_code}</code></td>
                <td className="muted" style={st('font-size:11px')}>{r.notes || ''}</td>
                <td className="muted" style={st('font-size:11px;text-align:center')}>{String(r.priority || 100)}</td>
                <td><button className="btn d" style={st('padding:3px 8px;font-size:10px')} onClick={() => p.onDeleteRule(r.id)}>✕</button></td>
              </tr>
            )) : (
              <tr><td colSpan={6} className="muted" style={st('text-align:center;padding:18px')}>No rules loaded. Pick a company filter or add one below.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Add-rule form. Uncontrolled and keeping the legacy ids — `apAddRule()` reads all four back. */}
      <div style={st('background:var(--panel-2);border:1px solid var(--panel-border);border-radius:10px;padding:14px')}>
        <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px')}>➕ Add a coding rule</div>
        <div style={st('display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end')}>
          <div>
            <label style={st('font-size:10px;color:var(--muted);display:block;margin-bottom:3px')}>Company</label>
            <select id="ap_rule_tenant" style={st('width:100%;font-size:12px')}>
              {(p.companies || []).map((c) => <option key={c.tenant_id} value={c.tenant_id}>{c.tenant_name}</option>)}
            </select>
          </div>
          <div>
            <label style={st('font-size:10px;color:var(--muted);display:block;margin-bottom:3px')}>Keywords (comma-separated)</label>
            <input id="ap_rule_keywords" placeholder="e.g. grab, taxi, e-hailing" style={st('width:100%;font-size:12px')} />
          </div>
          <div>
            <label style={st('font-size:10px;color:var(--muted);display:block;margin-bottom:3px')}>GL code</label>
            <input id="ap_rule_code" placeholder="e.g. 903-0100" style={st('width:100%;font-size:12px')} />
          </div>
          <div>
            <label style={st('font-size:10px;color:var(--muted);display:block;margin-bottom:3px')}>Priority</label>
            <input id="ap_rule_prio" type="number" defaultValue="200" style={st('width:100%;font-size:12px')} />
          </div>
          <div><button className="btn p" id="ap_rule_add_btn" onClick={p.onAddRule} style={st('width:100%')}>Add rule</button></div>
        </div>
      </div>
    </div>
  );
}

// ── Automation settings — `apRenderSettings()`, app.html:6857. Collapsed in the golden. ───────────

export interface ApSettingsProps {
  settings: ApSetting[];
  onSaveSettings: (tenantId: string) => void;
  onCopyEmail: (email: string) => void;
}

/** `apRenderSettings()` — app.html:6859. The inbound address a supplier is told to mail. */
export function inboundEmail(slug: string | null | undefined): string {
  return slug ? (AP_INBOUND_MAILBOX + '+' + slug + '@gmail.com') : '— set a slug —';
}

export function ApSettingsBody(p: ApSettingsProps) {
  return (
    <div style={st('padding:4px 0 0')}>
      <div className="muted" style={st('font-size:12px;line-height:1.6;margin-bottom:12px')}>
        {'Inbound mail is routed per company using Gmail plus-addressing on '}
        <code style={st('color:var(--coral-soft)')}>{AP_INBOUND_MAILBOX + '@gmail.com'}</code>
        {'. The hourly Auto-Bookkeeping agent forwards each email to '}
        <code style={st('color:var(--coral-soft)')}>{AP_INBOUND_MAILBOX + '+<slug>@gmail.com'}</code>
        {'. '}<b>Auto-post</b>{' = posts to Xero when compliant. '}<b>Auto-reply</b>
        {' = emails the sender on duplicate/missing-docs. '}<b>4-item gate</b>
        {' = reimbursements need form + 2 signatures + invoices + payment proof. Set '}
        <b>Auto-post max</b>{' to a huge number (e.g. 99999999) for no cap.'}
      </div>
      <div className="tbl-wrap">
        <table className="bigtable" style={st('font-size:12px')}>
          <thead><tr>
            <th>Company</th>
            <th>Inbound email</th>
            <th className="amt">Auto-post max</th>
            <th title="Post to Xero automatically when compliant">Auto-post</th>
            <th title="Auto-email sender on rejection">Auto-reply</th>
            <th title="Require claim form + 2 signatures + invoices + payment proof">4-item gate</th>
            <th title="New vendor / AI-only coding → route to review instead of auto-post (spec §E). Off = pure full autonomy.">Known vendor</th>
            <th title="Which AI reads the invoices for this company. Claude (Anthropic), OpenAI, or Gemini. Requires the matching Supabase Edge secret (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY).">AI</th>
            <th>Dup days</th>
            <th>On</th>
            <th></th>
          </tr></thead>
          <tbody>
            {(p.settings || []).map((s) => {
              const slug = s.routing_slug || '';
              const email = inboundEmail(slug);
              // app.html:6861 — the "no cap" note, and the number that means it.
              const noCap = Number(s.max_auto_post_amount) >= 99999999;
              return (
                <tr key={s.tenant_id}>
                  <td><b>{s.tenant_name || ''}</b></td>
                  <td>
                    <code style={st('font-size:11px;color:var(--coral-soft);background:var(--panel-2);padding:3px 7px;border-radius:5px')}>{email}</code>
                    {slug ? <button className="btn" style={st('padding:2px 7px;font-size:10px;margin-left:6px')} onClick={() => p.onCopyEmail(email)}>📋</button> : null}
                  </td>
                  {/* Uncontrolled, and `data-ten` / `data-k` are the contract `apSaveSettings()` reads back. */}
                  <td>
                    <input data-ten={s.tenant_id} data-k="max_auto_post_amount" type="number" defaultValue={String(s.max_auto_post_amount || 1000)} style={st('width:110px;font-size:12px;padding:5px 8px')} />
                    {noCap ? <div className="muted" style={st('font-size:9.5px')}>no cap</div> : null}
                  </td>
                  <td style={st('text-align:center')}><input data-ten={s.tenant_id} data-k="auto_post_when_compliant" type="checkbox" defaultChecked={s.auto_post_when_compliant !== false} style={st('width:auto')} /></td>
                  <td style={st('text-align:center')}><input data-ten={s.tenant_id} data-k="auto_reply_when_rejected" type="checkbox" defaultChecked={s.auto_reply_when_rejected !== false} style={st('width:auto')} /></td>
                  <td style={st('text-align:center')}><input data-ten={s.tenant_id} data-k="require_4item_reimbursement" type="checkbox" defaultChecked={s.require_4item_reimbursement !== false} style={st('width:auto')} /></td>
                  <td style={st('text-align:center')}><input data-ten={s.tenant_id} data-k="require_known_vendor_for_autopost" type="checkbox" defaultChecked={s.require_known_vendor_for_autopost !== false} style={st('width:auto')} /></td>
                  <td>
                    <select data-ten={s.tenant_id} data-k="ai_provider" defaultValue={s.ai_provider || 'anthropic'} style={st('font-size:11.5px;padding:4px 6px')}>
                      <option value="anthropic">Claude</option>
                      <option value="openai">OpenAI</option>
                      <option value="gemini">Gemini</option>
                    </select>
                  </td>
                  <td><input data-ten={s.tenant_id} data-k="duplicate_check_days" type="number" defaultValue={String(s.duplicate_check_days || 90)} style={st('width:60px;font-size:12px;padding:5px 8px')} /></td>
                  <td style={st('text-align:center')}><input data-ten={s.tenant_id} data-k="enabled" type="checkbox" defaultChecked={!!s.enabled} style={st('width:auto')} /></td>
                  <td><button className="btn p" style={st('padding:4px 10px;font-size:11px')} onClick={() => p.onSaveSettings(s.tenant_id)}>Save</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="muted" style={st('font-size:11px;margin-top:10px;line-height:1.6')}>
        <b>One-time external setup:</b>{' set Supabase Edge secret '}
        <code style={st('color:var(--coral-soft)')}>ANTHROPIC_API_KEY</code>
        {' (so Claude can read invoices) and either '}
        <code style={st('color:var(--coral-soft)')}>GMAIL_USER</code>+<code style={st('color:var(--coral-soft)')}>GMAIL_APP_PASSWORD</code>
        {' or '}<code style={st('color:var(--coral-soft)')}>RESEND_API_KEY</code>{' (so it can send replies).'}
      </div>
    </div>
  );
}

// ── The screen ─────────────────────────────────────────────────────────────────────────────────────

export interface FinanceApProps extends ApRulesProps, ApSettingsProps {
  /** `AP_INBOX` — app.html:6730, `ap_inbox_list`'s items. */
  inbox: ApItem[];
  /** `AP_ACTIVE_ID` — the highlighted row. `null` is the golden's state. */
  activeId: number | null;
  /** `AP_DETAIL` — `null` is the golden's state, and it paints the 📨 placeholder. */
  detail: ApDetail | null;
  /** `AP_DECISIONS` — only reachable through the detail pane. */
  decisions: ApDecision[];
  /** `AP_FILTER_TENANT` / `AP_FILTER_STATUS` — both `''` in the golden. */
  filterTenant: string;
  filterStatus: string;
  /** `AP_SHOW_RULES` / `AP_SHOW_SETTINGS` — both `false` in the golden. */
  showRules: boolean;
  showSettings: boolean;
  onFilterTenant: (v: string) => void;
  onFilterStatus: (v: string) => void;
  onOpen: (id: number) => void;
  onToggleRules: () => void;
  onToggleSettings: () => void;
  onSendReply: () => void;
  onRerun: () => void;
  onReject: () => void;
  onPreview: () => void;
  onPostBill: () => void;
}

/** `apRender()` — app.html:6801. This component is every byte of the `#ap` tab div. */
export default function FinanceAp(p: FinanceApProps) {
  const cnt = apCounts(p.inbox || []);
  const rows = p.inbox || [];
  return (
    <>
      {/* ── Automation stats (computed from loaded inbox) ── */}
      <div style={st('display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px')}>
        <Stat n={cnt.posted} label="Auto-posted to Xero" color="green" ico="✅" />
        <Stat n={cnt.replied} label="Auto-replied" color="sky" ico="✉" />
        <Stat n={cnt.rejected} label="Auto-rejected" color="red" ico="🚫" />
        <Stat n={cnt.review} label="Needs your review" color="amber" ico="⚠" />
        <Stat n={apMinutesSaved(cnt)} label="Manual work saved" color="muted" ico="⏱" />
      </div>

      <div className="panel">
        <div className="panel-hd" style={st('flex-wrap:wrap')}>
          <h3>📧 AP Inbox <span className="muted" style={st('font-size:11px;font-weight:400')}>— fully automated, you only touch ⚠ items</span></h3>
          <div style={st('display:flex;gap:8px;align-items:center;flex-wrap:wrap')}>
            <select id="ap_filter_tenant" onChange={(e) => p.onFilterTenant((e.target as HTMLSelectElement).value)} value={p.filterTenant} style={st('padding:5px 9px;font-size:12px')}>
              <option value="">All companies</option>
              {(p.companies || []).map((c) => <option key={c.tenant_id} value={c.tenant_id}>{c.tenant_name}</option>)}
            </select>
            <select id="ap_filter_status" onChange={(e) => p.onFilterStatus((e.target as HTMLSelectElement).value)} value={p.filterStatus} style={st('padding:5px 9px;font-size:12px')}>
              <option value="">All statuses</option>
              {Object.keys(AP_STATUS_LABELS).map((s) => <option key={s} value={s}>{AP_STATUS_LABELS[s][0]}</option>)}
            </select>
            <button className="btn sm" onClick={p.onRefresh}>↻ Refresh</button>
          </div>
        </div>
        <div className="tbl-wrap" style={st('margin-bottom:14px')}>
          <table className="bigtable">
            <thead><tr>
              <th>Status</th><th>Received</th><th>From</th><th>Subject</th><th>Company</th><th className="amt">AI total</th>
            </tr></thead>
            <tbody>
              {rows.length ? rows.map((m) => {
                const attCount = (m.attachments || []).length;
                const aiTotal = m.ai_verdict && m.ai_verdict.total;
                const dt = m.ai_verdict && m.ai_verdict.doc_type;
                return (
                  // The row id is the ONLY thing binding these cells to a document: `apOpen(m.id)`
                  // fetches the email whose bill the operator will post. Handler parity is what checks it.
                  <tr key={m.id} onClick={() => p.onOpen(m.id)} style={st('cursor:pointer' + (p.activeId === m.id ? ';background:rgba(232,93,60,.06)' : ''))}>
                    <td><StatusPill status={m.status || 'received'} /></td>
                    <td className="muted" style={st('font-size:11.5px;white-space:nowrap')}>{apWhen(m.received_at)}</td>
                    <td>
                      <b style={st('font-size:12.5px')}>{m.from_name || m.from_email || ''}</b>
                      <div className="muted" style={st('font-size:10.5px')}>{m.from_email || ''}</div>
                    </td>
                    <td>
                      {m.subject || '(no subject)'}
                      {attCount ? <span className="muted" style={st('font-size:10.5px;margin-left:6px')}>{'📎 ' + attCount}</span> : null}
                      {' '}
                      {dt === 'reimbursement' ? <span className="muted" style={st('font-size:10px')}>🧾 claim</span>
                        : dt === 'invoice' ? <span className="muted" style={st('font-size:10px')}>📄 invoice</span>
                        : null}
                    </td>
                    <td className="muted" style={st('font-size:11.5px')}>{m.tenant_name || ''}</td>
                    <td className="amt">{aiTotal ? M(aiTotal) : <span className="muted">—</span>}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={6} className="muted" style={st('text-align:center;padding:24px')}>No emails in this queue yet. The hourly Auto-Bookkeeping agent will fill this as it processes inbound mail.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {p.detail
          ? <ApDetailPane detail={p.detail} decisions={p.decisions} onSendReply={p.onSendReply} onRerun={p.onRerun} onReject={p.onReject} onPreview={p.onPreview} onPostBill={p.onPostBill} />
          : (
            <div className="empty" style={st('padding:36px')}>
              <div className="empty-ico">📨</div>
              <div style={st('font-size:13px;margin-top:8px')}>Click an email above to review the AI decision, compliance checklist, and (if it needs your review) post or reply.</div>
            </div>
          )}
      </div>

      {/* ── Collapsible: GL coding rules ── */}
      <div className="panel" style={st('margin-top:14px')}>
        <div className="panel-hd" style={st('cursor:pointer')} onClick={p.onToggleRules}>
          <h3>🗺 GL coding rules <span className="muted" style={st('font-size:11px;font-weight:400')}>— teach the AI which Chart-of-Account to use</span></h3>
          <button className="btn sm">{p.showRules ? 'Hide ▲' : 'Show ▼'}</button>
        </div>
        {p.showRules ? <ApRulesBody {...p} /> : null}
      </div>

      {/* ── Collapsible: per-company settings ── */}
      <div className="panel" style={st('margin-top:14px')}>
        <div className="panel-hd" style={st('cursor:pointer')} onClick={p.onToggleSettings}>
          <h3>⚙ Automation settings <span className="muted" style={st('font-size:11px;font-weight:400')}>— routing, auto-post, auto-reply, caps</span></h3>
          <button className="btn sm">{p.showSettings ? 'Hide ▲' : 'Show ▼'}</button>
        </div>
        {p.showSettings ? <ApSettingsBody {...p} /> : null}
      </div>
    </>
  );
}
