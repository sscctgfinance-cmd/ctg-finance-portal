// Finance OS · O2O Billing — the React half of `renderO2O()` (app.html:2848), the sixth Finance screen.
//
// The legacy original is STILL THERE and still shipping; nothing was deleted. Both are reachable side by
// side (`app.html#tab=o2o` and `/finance/o2o/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no FileReader, no clock read. The
// file read, the XLSX decode, the contact resolve, the POST, the ZIP and the state all live in
// app/finance/o2o/page.tsx.
//
// ── THE ARITHMETIC IS IMPORTED, NOT RE-EXPRESSED ───────────────────────────────────────────────────
// `o2oParseRows`, `o2oApplyMasterRate`, `o2oGrandTotal` and `o2oInvoiceNumbers` come from `../../o2o.js`
// — the same classic script `app.html` now loads. They were lifted out of app.html by this migration
// for the reason wht.js gives, only sharper: `o2o_issue` (finance.ts:626) does NOT recompute anything.
// It forwards Quantity / UnitAmount / DiscountRate straight into the Xero payload, so these numbers ARE
// the invoice and there is no server figure to fall back on the day two copies disagree. (Contrast
// Quick Invoice, which correctly declined to lift its one `reduce` because Xero's own `iv.Total` is the
// authority there.) Nothing in this file does money arithmetic; it renders what o2o.js returned.
//
// ── WHAT THE GOLDEN HOLDS, AND WHAT IT DOES NOT ────────────────────────────────────────────────────
// `tests/golden/finance.o2o.html` is `renderO2O()`'s output and nothing else: the panel, the company
// <select>, the two date inputs, the invoice-numbering bar, the file input, the test-mode checkbox, the
// disabled Issue button, and an `#o2o-out` holding only "Pick the Excel to preview.". Everything an
// operator reads before issuing — the pharmacy cards, the per-SKU line tables, the Xero-contact badges,
// the results table — is written later by `o2oRenderPreview()` (app.html:3134) and `o2oIssue()`
// (app.html:3299) into that div, so NO golden reaches it. It is mirrored here anyway and pinned in
// web/tests/finance-o2o.parity.test.tsx instead of by the diff.
//
// THE GOLDEN IS NOT AN INTERMEDIATE STATE. `renderQinv()` writes its markup and THEN calls
// `qiAddLine()`, so Quick Invoice's golden holds an empty list while every operator sees one row.
// `renderO2O()` was checked for the same: after its `innerHTML` write it does exactly one thing,
// `loaded.o2o=true` — no appendChild, no `.value=`, no setTimeout, no follow-up fetch. Both dates are
// written INTO the html string (`value="'+o2oToday()+'"`), so unlike `qi_date` they do reach the
// golden. What an operator sees on tab open is what the golden holds.
//
// ── THE DATES ARE DERIVED FROM THE CLOCK, SO THE DERIVATION IS LIFTED OUT ──────────────────────────
// `hr.yearend`'s rule. `o2oToday()`/`o2oPlusDays(30)` (app.html:2766-2767) read `new Date()`, so a
// component that read the clock itself would render a different document tomorrow and could not be
// diffed against a fixed golden. `todayLocal(now)` and `plusDaysLocal(now, n)` below are pure functions
// of a Date they are HANDED — the route hands them the real one, the test hands them a fixed instant.
// That keeps the derivation under test (a shifted date diffs) rather than hiding it in the route.
//
// ── THE PERMISSION GATE ────────────────────────────────────────────────────────────────────────────
// `renderO2O()` has no role check. `showApp()` (app.html:1420-1434) gates the tab, and O2O is named in
// NONE of its branches: it falls through to the chain's final `else`, so it is the FEATURE list,
// `PERMS.features.indexOf('o2o')`, that decides — not `manage_users`, which gates the seven admin tabs
// listed above it. `o2oReachable()` mirrors that one line; the route refuses to load or render on a
// false and the screen's test pins both directions plus the withheld one. The server is stricter
// (`o2o_issue` wants isAdmin AND the tenant in `allowedTenants`, finance.ts:627-632), so this is tab
// visibility, not the boundary.

import type { O2OData, O2OLine, O2OPharmacy } from '../../o2o.js';

/** `COMPANIES` — app.html:1253's company list, as `renderO2O()` reads it. */
export interface O2OCompany {
  tenant_id: string;
  tenant_name: string;
}

/** `PERMS` — resolved by `showApp()` (app.html:1416). Only `features` decides this tab. */
export interface Perms {
  features?: string[] | null;
}

/**
 * app.html:1434 — the final `else` of `showApp()`'s tab pass: `feats.indexOf(t)<0` hides the tab, and
 * `o2o` appears in none of the named branches above it.
 *
 * Exported from the screen, not hidden in the route, so the screen's own test can pin both directions.
 */
export function o2oReachable(perms: Perms | null | undefined): boolean {
  return ((perms && perms.features) || []).indexOf('o2o') >= 0;
}

/** `o2oToday()` — app.html:2766, as a pure function of the instant it is handed. LOCAL date parts. */
export function todayLocal(now: Date): string {
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

/** `o2oPlusDays(n)` — app.html:2767. Same `setDate` roll-over the legacy relies on for month ends. */
export function plusDaysLocal(now: Date, n: number): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + n);
  return todayLocal(d);
}

/**
 * `o2oInitTenant()` — app.html:2811. Defaults to Skindae when the operator has access to it, else the
 * first allowed company; keeps the current choice when it is still in the list.
 *
 * Which company is selected is not cosmetic: it decides whether SKU codes are sent, which Xero
 * organisation the contacts resolve in, and which ledger the invoices land in.
 */
export function initTenant(companies: O2OCompany[] | null | undefined, current: string | null): string | null {
  const list = companies || [];
  if (!list.length) return null;
  if (current && list.some((c) => c.tenant_id === current)) return current;
  const sk = list.find((c) => /skindae/i.test(c.tenant_name || ''));
  return (sk && sk.tenant_id) || list[0].tenant_id;
}

/** `o2oIsSkindae()` — app.html:2818. Decides SKU mode vs Package mode, and whether ItemCode is sent. */
export function isSkindae(companies: O2OCompany[] | null | undefined, tenant: string | null): boolean {
  const c = (companies || []).find((x) => x.tenant_id === tenant);
  return !!(c && /skindae/i.test(c.tenant_name || ''));
}

/** `o2oTenantName()` — app.html:2822, including its "the selected company" fallback. */
export function tenantName(companies: O2OCompany[] | null | undefined, tenant: string | null): string {
  const c = (companies || []).find((x) => x.tenant_id === tenant);
  return (c && c.tenant_name) || 'the selected company';
}

/** What `o2o_contacts_resolve` attaches to a pharmacy — `__xero` in app.html:3105. */
export interface XeroResolve {
  status?: 'linked' | 'exact' | 'suggest' | 'none' | string | null;
  contact_name?: string | null;
  suggestions?: { contact_id: string; name: string; score?: number }[] | null;
}

/** The pharmacy master record — `__master` in app.html:3109, from `pharmacy_list`. */
export interface PharmMaster {
  pic_name?: string | null;
  pic_role?: string | null;
  pic_phone?: string | null;
  pic_email?: string | null;
  city?: string | null;
  state?: string | null;
  commission_rate?: number | string | null;
  default_voucher_code?: string | null;
}

/** A parsed pharmacy with the two enrichment lookups attached, as the preview renders it. */
export type O2OPharmacyView = O2OPharmacy & { __xero?: XeroResolve | null; __master?: PharmMaster | null };
export type O2ODataView = Omit<O2OData, 'pharmacies'> & { pharmacies: O2OPharmacyView[] };

/** One row of `o2o_issue`'s `results` — finance.ts:679. */
export interface IssueResult {
  pharmacy: string;
  total: number;
  number?: string | null;
  status: string;
  contact?: string | null;
  invoice_id?: string | null;
}

export interface IssueResponse {
  dry_run?: boolean;
  issued?: number;
  emailed?: number;
  failed?: number;
  results?: IssueResult[];
}

/** One entry of the ZIP batch stashed after a live post — `O2O_LAST_ISSUED.invoices`, app.html:3336. */
export interface IssuedInvoice {
  invoice_id: string;
  pharmacy: string;
  number?: string | null;
  total?: number | null;
}

/** A PDF that came back from `o2o_pdfs` without bytes — app.html:3243. */
export interface PdfFailure {
  pharmacy?: string | null;
  error?: string | null;
}

/**
 * `o2oIssue()`'s POST body — app.html:3331 — with the confirm(), the toast and the fetch left in the
 * route.
 *
 * Split out for the same reason `bankFile()`, `profileBody()`, `reconcileBody()` and `invoiceBody()`
 * were: no golden sees a request body, so what this sends is provable nowhere else, and every field it
 * gets wrong is a real invoice posted to a real customer. Two rules live here and only here:
 *
 *   • ITEM CODE IS STRIPPED FOR A NON-SKINDAE TARGET. SKO2OB3 and friends are Skindae-only inventory
 *     items in Xero; sending one to another organisation is a rejected invoice at best and the wrong
 *     item at worst. The server strips it too (finance.ts:658), so this is belt and braces — but the
 *     legacy strips it here and a port that stopped would be relying on the server quietly.
 *   • `invoice_number` IS ATTACHED BY POSITION, `invNums[idx]`, over the pharmacies in preview order.
 *     Re-ordering, sorting or filtering the list between the preview and here would hand a pharmacy
 *     another pharmacy's invoice number.
 *
 * `dryRun` is passed through as `dry_run`; the server treats anything but an explicit `false` as a dry
 * run (finance.ts:673), so a port that dropped the field could only ever be SAFER, never live-by-
 * accident. `send_email:false` is the legacy's, unchanged.
 */
export function issueBody(args: {
  tenant: string;
  data: O2ODataView;
  invoiceDate: string;
  dueDate: string;
  dryRun: boolean;
  /** `o2oInvoiceNumbers()`'s answer. `[]` = let Xero number them; never pass `null` — reject first. */
  invNums: string[];
  skindae: boolean;
}): Record<string, unknown> {
  if (!args.tenant) throw new Error('Pick a company first');
  const invoices = args.data.pharmacies.map((p, idx) => {
    let base: Record<string, unknown> = args.skindae
      ? (p as unknown as Record<string, unknown>)
      : { ...p, lines: (p.lines || []).map((l) => { const c = { ...l } as Partial<O2OLine>; delete c.item_code; return c; }) };
    if (args.invNums.length) base = { ...base, invoice_number: args.invNums[idx] };
    return base;
  });
  return {
    api: 'o2o_issue',
    tenant: args.tenant,
    period: args.data.period,
    reference: args.data.reference,
    invoice_date: args.invoiceDate,
    due_date: args.dueDate,
    dry_run: args.dryRun,
    send_email: false,
    invoices,
  };
}

/**
 * `o2oPreviewNums()` — app.html:2791 — as a value rather than an imperative textContent/innerHTML write.
 *
 * Returns the hint under the numbering fields and whether it is an error (the legacy paints
 * `var(--red-soft)` in that case). `range` is rendered in <b> by the caller, as the legacy does.
 */
export function previewNums(prefix: string, startRaw: string, nums: string[] | null, pharmacyCount: number): {
  error: boolean;
  text?: string;
  range?: [string, string];
  start?: string;
  count?: number;
} {
  if (!prefix.trim() && !startRaw.trim()) return { error: false, text: 'Leave empty → Xero auto-generates' };
  if (!startRaw.trim() || !/^\d+$/.test(startRaw.trim())) return { error: true, text: 'Start # must be digits (e.g. 001, 1183)' };
  if (!nums || !nums.length) return { error: true, text: 'Invalid' };
  if (pharmacyCount) return { error: false, range: [nums[0], nums[nums.length - 1]], count: pharmacyCount };
  return { error: false, start: nums[0] };
}

/** app.html:1253 — `M`. Mirrored rather than imported: it is inline in app.html, not in a shared file. */
const M = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Every inline style is the legacy STRING, split mechanically — same reason src/finance-wht.tsx gives:
 * nothing in parity.ts touches an attribute value, so these are compared character for character, and a
 * React style OBJECT would let React re-serialise a number or append `px` silently.
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

const LBL = 'font-size:11px;color:var(--muted);letter-spacing:.6px;text-transform:uppercase;font-weight:700';

/** What `#o2o-out` holds. `'idle'` is the golden's state — see the header. */
export type O2OOut =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'preview'; data: O2ODataView }
  | { kind: 'issued'; res: IssueResponse; downloadable: IssuedInvoice[]; failures: PdfFailure[] | null; downloaded: number };

export interface FinanceO2OProps {
  /** `COMPANIES` — the `o2o-tenant` options, in order. */
  companies: O2OCompany[];
  /** `O2O_TENANT` after `o2oInitTenant()`. Drives the <select> and the note below it. */
  tenant: string | null;
  /** `o2oToday()`, already derived — see the header on why the clock read is not in here. */
  today: string;
  /** `o2oPlusDays(30)`, already derived. */
  due: string;
  /** What `#o2o-out` currently holds. `{kind:'idle'}` in the golden. */
  out: O2OOut;
  /** The `#o2o-invnum-preview` hint. The golden's value is `previewNums('','',[],0)`. */
  nums: ReturnType<typeof previewNums>;
  /** `#o2o-issue`'s disabled state — `renderO2O()` writes it disabled; the preview enables it. */
  canIssue: boolean;
  /** Which pharmacy block is expanded. The legacy toggles `display` on a random id; this is state. */
  openPharmacy: number | null;
  onTenantChange: (e: { target: unknown }) => void;
  onResetDates: () => void;
  onPreviewNums: () => void;
  onPick: (e: { target: unknown }) => void;
  onIssue: () => void;
  onTogglePharmacy: (i: number) => void;
  onLinkContact: (pharmacy: string, contactId: string, contactName: string, source: string) => void;
  onSearchContacts: (pharmacy: string, q: string) => void;
  onDownloadPdfs: (retryOnly: boolean) => void;
  onDismissPdfPanel: () => void;
  onAddPharmacy: (name: string) => void;
}

/** `o2oTenantNoteHTML()` — app.html:2826. Empty for a Skindae target. */
function TenantNote({ skindae }: { skindae: boolean }) {
  if (skindae) return null;
  return (
    <>
      <span style={st('color:var(--amber)')}>⚠</span>
      {' Non-Skindae target — SKU codes (SKO2OB3 etc.) will not be sent to Xero (only description + account 500-0100). Pharmacy contacts will be resolved by name in that company\'s Xero.'}
    </>
  );
}

/** The Xero-contact badge — app.html:3145. Read-only: a wrong contact invoices the wrong customer. */
function XeroBadge({ xr }: { xr: XeroResolve | null | undefined }) {
  const xst = xr ? xr.status : null;
  if (xst === 'linked') return <span className="pill pill-green" style={st('font-size:10px;margin-left:8px')} title={'Saved link → ' + (xr!.contact_name || '')}>✓ Xero contact</span>;
  if (xst === 'exact') return <span className="pill pill-green" style={st('font-size:10px;margin-left:8px')} title={'Name matches → ' + (xr!.contact_name || '')}>{'✓ ' + (xr!.contact_name || 'Xero contact')}</span>;
  if (xst === 'suggest') return <span className="pill" style={st('background:rgba(255,165,89,.16);color:var(--coral-soft);font-size:10px;margin-left:8px')} title="Closest matches found — confirm below">❓ confirm contact</span>;
  if (xst === 'none') return <span className="pill" style={st('background:rgba(255,120,120,.16);color:var(--coral-soft);font-size:10px;margin-left:8px')} title="No similar contact in this Xero organisation">⚠ no Xero contact</span>;
  return null;
}

/** The master-data strip — app.html:3175. */
function MasterInfo({ p, onAddPharmacy }: { p: O2OPharmacyView; onAddPharmacy: (n: string) => void }) {
  const m = p.__master;
  if (!m) {
    return (
      <div style={st('background:rgba(255,165,89,.06);border:1px dashed rgba(255,165,89,.3);padding:8px 12px;border-radius:6px;font-size:12px;margin:6px 0 4px;color:var(--coral-soft)')}>
        {'⚠ This pharmacy is not in your master list. The invoice will still be created (Xero contact lookup by name still works), but you should add it to '}
        <a href="#" data-add-pharm={p.pharmacy} style={st('color:var(--coral-soft);text-decoration:underline;font-weight:600')}
           onClick={(e) => { e.preventDefault?.(); onAddPharmacy(p.pharmacy); }}>Pharmacies</a>
        {' for richer billing info.'}
      </div>
    );
  }
  // `Number(m.commission_rate||19.2)!==19.2` — app.html:3183. The rate is what the pharmacy is
  // discounted by, so showing it when it is NOT the default is the operator's only warning.
  const custom = Number(m.commission_rate || 19.2) !== 19.2;
  return (
    <div style={st('background:var(--panel-2);padding:8px 12px;border-radius:6px;font-size:12px;margin:6px 0 4px;display:flex;gap:14px;flex-wrap:wrap;color:var(--text-soft)')}>
      {m.pic_name ? <span><b>PIC:</b>{' ' + m.pic_name + (m.pic_role ? ' (' + m.pic_role + ')' : '')}</span> : null}
      {m.pic_phone ? <span><b>📞</b>{' ' + m.pic_phone}</span> : null}
      {m.pic_email ? <span><b>✉</b>{' ' + m.pic_email}</span> : null}
      {m.city ? <span><b>📍</b>{' ' + [m.city, m.state].filter(Boolean).join(', ')}</span> : null}
      {custom ? <span style={st('color:var(--amber)')}><b>⚙ Custom commission:</b>{' ' + Number(m.commission_rate).toFixed(1) + '%'}</span> : null}
      {m.default_voucher_code ? <span><b>🎟</b>{' ' + m.default_voucher_code}</span> : null}
    </div>
  );
}

/** One pharmacy block — app.html:3200. */
function PharmacyBlock({ p, i, open, props }: { p: O2OPharmacyView; i: number; open: boolean; props: FinanceO2OProps }) {
  const xr = p.__xero;
  const xst = xr ? xr.status : null;
  const lineRows = (p.lines || []).map((l, li) => (
    // Keyed by POSITION. Two SKUs can share a description and a price in Package mode; the parse has
    // already decided which rows grouped into which line, and this must not re-derive it.
    <tr key={li}>
      <td>{l.item_code ? <span className="pill pill-blue" style={st('margin-right:6px;font-family:monospace')}>{l.item_code}</span> : null}{l.package || ''}</td>
      <td className="amt">{l.quantity}</td>
      <td className="amt">{M(l.unit_price)}</td>
      <td className="amt">{l.discount_rate ? <span className="muted">{'Disc ' + l.discount_rate + '%'}</span> : <span className="muted">—</span>}</td>
      <td className="amt"><b>{M(l.amount ?? (l.unit_price * l.quantity))}</b></td>
    </tr>
  ));
  return (
    <div style={st('border:1px solid var(--panel-border);border-radius:10px;margin-bottom:10px;background:var(--panel)')}>
      <div style={st('padding:10px 14px;display:flex;align-items:center;gap:10px;cursor:pointer')} onClick={() => props.onTogglePharmacy(i)}>
        <b style={st('flex:1')}>{p.pharmacy}<XeroBadge xr={xr} /></b>
        <span className="muted">{p.line_count + ' line' + (p.line_count === 1 ? '' : 's')}</span>
        <span className="amt">{'Full ' + M(p.total_sales)}</span>
        <span className="amt" style={st('color:var(--coral-soft)')}>{p.commission > 0 ? '-' + M(p.commission) : '—'}</span>
        <span className="amt"><b>{M(p.total)}</b></span>
      </div>
      <div style={st(open ? 'display:block;padding:0 14px 12px' : 'display:none;padding:0 14px 12px')}>
        <MasterInfo p={p} onAddPharmacy={props.onAddPharmacy} />
        <table className="bigtable">
          <thead><tr><th>Item / Description</th><th className="amt">Qty</th><th className="amt">Unit Price</th><th className="amt">Disc.</th><th className="amt">Amount</th></tr></thead>
          <tbody>{lineRows}</tbody>
        </table>
        {xr && (xst === 'suggest' || xst === 'none') ? (
          <div style={st('background:var(--panel-2);padding:8px 12px;border-radius:6px;margin:6px 0 4px;font-size:12px')}>
            <div className="muted" style={st('margin-bottom:6px')}>
              {'Xero contact for '}<b>{tenantName(props.companies, props.tenant)}</b>
              {(xr.suggestions || []).length ? ' — closest matches:' : ' — nothing similar found, search:'}
            </div>
            {/* Suggestions are SHOWN, never auto-applied: a wrong contact means invoicing the wrong
                customer. That is the legacy's rule (app.html:3153) and it is kept. */}
            {(xr.suggestions || []).map((g) => (
              <button key={g.contact_id} className="btn sm" style={st('margin:0 6px 6px 0')}
                      onClick={() => props.onLinkContact(p.pharmacy, g.contact_id, g.name, 'fuzzy')}>
                {g.name} <span className="muted">{Math.round((g.score || 0) * 100) + '%'}</span>
              </button>
            ))}
            <div style={st('display:flex;gap:6px;margin-top:4px')}>
              <input placeholder="Search this company's Xero contacts…" style={st('flex:1;padding:6px 9px;font-size:12px')}
                     onKeyDown={(e) => { if (e.key === 'Enter') props.onSearchContacts(p.pharmacy, (e.target as HTMLInputElement).value); }} />
            </div>
            <div className="o2o-sr" style={st('margin-top:6px')}></div>
          </div>
        ) : null}
        {p.unmatched && p.unmatched.length ? (
          <div style={st('color:var(--coral-soft);font-size:12px;margin:6px 0 0')}>
            {'⚠ ' + p.unmatched.length + ' row(s) billed at their Excel price with no SKU mapping: '
              + p.unmatched.slice(0, 3).map((u) => u.pkg).join(', ') + (p.unmatched.length > 3 ? ' …' : '')}
          </div>
        ) : null}
        {p.fallback ? <div style={st('color:var(--coral-soft);font-size:12px;margin:6px 0 0')}>⚠ Fallback mode: no per-row data found, using single Total-Sales line.</div> : null}
      </div>
    </div>
  );
}

/** `o2oRenderPreview()` — app.html:3134. In NO golden; see the header. */
function Preview({ data, props }: { data: O2ODataView; props: FinanceO2OProps }) {
  const anyUnmatched = data.pharmacies.some((p) => p.unmatched && p.unmatched.length);
  const anyFallback = data.pharmacies.some((p) => p.fallback);
  return (
    <>
      <div className="cards">
        <div className="card"><div className="n" style={st('color:var(--coral-soft)')}>{data.pharmacy_count}</div><div className="l">Pharmacies</div></div>
        <div className="card"><div className="n" style={st('color:var(--green-soft)')}>{M(data.grand_total)}</div><div className="l">Total billed</div></div>
      </div>
      <div className="status-bar" style={st('margin:2px 0 6px')}><div className="dot-green"></div>{'Reference → '}<b>{data.reference || ''}</b></div>
      <div className="muted" style={st('font-size:12px;margin:0 0 12px')}>{'From Excel: ' + (data.period || '')}</div>
      {anyUnmatched ? (
        <div style={st('background:rgba(255,165,89,.08);border:1px solid var(--coral-soft);padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:10px;color:var(--coral-soft)')}>
          {'⚠ Some rows have no SKU mapping (Basic A-3 / Basic B-1 / Promo B / Promo C / Promo D). They are '}<b>billed at their Excel price</b>{' using the Package text as the description — expand a pharmacy to see which.'}
        </div>
      ) : null}
      {anyFallback ? (
        <div style={st('background:rgba(255,165,89,.08);border:1px solid var(--coral-soft);padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:10px;color:var(--coral-soft)')}>
          ⚠ One or more sheets had no Date/Package/Price rows. Falling back to single Total-Sales line for those.
        </div>
      ) : null}
      {data.pharmacies.map((p, i) => <PharmacyBlock key={i} p={p} i={i} open={props.openPharmacy === i} props={props} />)}
    </>
  );
}

/** `o2oIssue()`'s results block — app.html:3341 — plus `o2oDownloadPdfs()`'s panel (app.html:3252). */
function Issued({ o, props }: { o: Extract<O2OOut, { kind: 'issued' }>; props: FinanceO2OProps }) {
  const r = o.res;
  const rows = (r.results || []).map((x, i) => {
    const pill = x.status === 'issued' ? 'pill-green' : x.status === 'dry_run' ? 'pill-submit' : 'pill-draft';
    return (
      // Keyed by POSITION: `results[i]` is `built[i]` (finance.ts:679), which is `invoices[i]`, which is
      // `pharmacies[i]`. Sorting this table would print one pharmacy's invoice number against another's.
      <tr key={i}>
        <td>{x.pharmacy}</td>
        <td className="amt">{M(x.total)}</td>
        <td>{(x.number || '') + ' '}<span className={'pill ' + pill}>{x.status}</span></td>
        <td className="muted">{x.contact === 'new' ? '⚠ new' : '✓ existing'}</td>
      </tr>
    );
  });
  const failures = o.failures;
  return (
    <>
      <div className="cards">
        <div className="card"><div className="n" style={st('color:var(--green-soft)')}>{r.issued || 0}</div><div className="l">Issued</div></div>
        <div className="card"><div className="n" style={st('color:var(--sky-soft)')}>{r.emailed || 0}</div><div className="l">Emailed</div></div>
        <div className="card"><div className="n" style={st((r.failed || 0) ? 'color:var(--red-soft)' : 'color:var(--muted)')}>{r.failed || 0}</div><div className="l">Failed</div></div>
      </div>
      {r.dry_run ? <div className="status-bar" style={st('margin:0 0 10px')}><div className="dot-green"></div>DRY-RUN — nothing posted (set live in backend)</div> : null}
      {o.downloadable.length ? (
        <div style={st('display:flex;gap:10px;align-items:center;margin:0 0 12px;flex-wrap:wrap')}>
          <button className="btn p" id="o2o-dl" onClick={() => props.onDownloadPdfs(false)}>📥 Download all invoices (ZIP)</button>
          <span className="muted" style={st('font-size:12px')}>
            {o.downloadable.length + ' PDFs · file names like '}
            <code style={st('background:rgba(255,255,255,.06);padding:2px 6px;border-radius:4px')}>Pharmacy_INV-1234_MYR159.98.pdf</code>
          </span>
        </div>
      ) : null}
      {failures && failures.length ? (
        <div id="o2o-dl-panel" style={st('margin:10px 0 14px')}>
          <div style={st('padding:12px 14px;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.06);border-radius:11px')}>
            <div style={st('display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px')}>
              <span style={st('color:var(--red-soft);font-weight:600;font-size:13px')}>
                {'⚠ ' + failures.length + ' PDF' + (failures.length > 1 ? 's' : '') + ' failed' + (o.downloaded ? ' · ' + o.downloaded + ' downloaded' : '')}
              </span>
              <button className="btn" onClick={() => props.onDownloadPdfs(true)} style={st('padding:5px 11px;font-size:12px')}>↻ Retry failed only</button>
              <button className="btn" onClick={props.onDismissPdfPanel} style={st('padding:5px 11px;font-size:12px')}>Dismiss</button>
            </div>
            <div className="tbl-wrap" style={st('max-height:260px;overflow-y:auto')}>
              <table className="bigtable"><thead><tr><th>Pharmacy</th><th>Error</th></tr></thead>
                <tbody>{failures.slice(0, 20).map((p, i) => (
                  <tr key={i}><td>{p.pharmacy || '—'}</td><td className="muted" style={st('font-size:11.5px')}>{p.error || 'unknown error'}</td></tr>
                ))}</tbody></table>
            </div>
            {failures.length > 20 ? <div className="muted" style={st('font-size:11.5px;margin:6px 0 0')}>{'…and ' + (failures.length - 20) + ' more'}</div> : null}
          </div>
        </div>
      ) : null}
      <div className="tbl-wrap"><table className="bigtable">
        <thead><tr><th>Pharmacy</th><th className="amt">Total</th><th>Invoice</th><th>Contact</th></tr></thead>
        <tbody>{rows}</tbody></table></div>
    </>
  );
}

/** `renderO2O()` — app.html:2848. Owns every byte written into `#o2o`. */
export default function FinanceO2O(props: FinanceO2OProps) {
  const o = props.out;
  const n = props.nums;
  return (
    <div className="panel"><div className="panel-hd"><h3>O2O Pharmacy Billing → Xero</h3></div>
      <div className="bar" style={st('margin:0 0 12px')}>
        <span style={st(LBL)}>Issue into</span>
        {/* CONTROLLED, unlike Bank Rec's `rc_co`: the legacy carries `selected` on the current tenant
            (app.html:2850) and `o2oOnTenantChange()` re-parses the workbook when it changes, so the
            value is real state rather than something read back out of the DOM at post time. The id is
            kept anyway — it is the legacy's contract. */}
        <select id="o2o-tenant" value={props.tenant || ''} onChange={props.onTenantChange} style={st('min-width:230px')}>
          {props.companies.map((c) => <option key={c.tenant_id} value={c.tenant_id}>{c.tenant_name}</option>)}
        </select>
      </div>
      <p className="muted" style={st('font-size:13px;margin:0 0 6px')}>Upload the monthly O2O billing Excel. It is parsed in your browser — preview each pharmacy invoice, then issue them into {'the selected company\'s Xero.'}</p>
      <p id="o2o-tenant-note" className="muted" style={st('font-size:12px;margin:0 0 14px;line-height:1.55')}>
        <TenantNote skindae={isSkindae(props.companies, props.tenant)} />
      </p>
      <div className="bar" style={st('margin:0 0 10px')}>
        <span style={st(LBL)}>Invoice date</span>
        {/* UNCONTROLLED, with the legacy ids kept: `o2oIssue()` (app.html:3305) reads both dates back
            out of the DOM by id, `o2oResetDates()` writes them back the same way, and the route does
            exactly that. `defaultValue` renders as the `value` attribute the golden carries. */}
        <input type="date" id="o2o-invdate" defaultValue={props.today} style={st('min-width:150px')} />
        <span style={st(LBL)}>Due date</span>
        <input type="date" id="o2o-duedate" defaultValue={props.due} style={st('min-width:150px')} />
        <button className="btn" type="button" onClick={props.onResetDates} style={st('padding:6px 11px;font-size:11.5px')}>Reset</button>
      </div>
      <div className="bar" style={st('margin:0 0 10px')}>
        <span style={st(LBL)}>Invoice #</span>
        <input type="text" id="o2o-invprefix" placeholder="Prefix (e.g. SK-2606-)" onInput={props.onPreviewNums} style={st('min-width:160px')} />
        <input type="text" id="o2o-invstart" placeholder="Start # (e.g. 001)" onInput={props.onPreviewNums} style={st('min-width:130px')} />
        <span id="o2o-invnum-preview" className="muted" style={st(n.error ? 'font-size:12px;flex:1;min-width:200px;color:var(--red-soft)' : 'font-size:12px;flex:1;min-width:200px')}>
          {n.range ? <>{'Will generate '}<b>{n.range[0]}</b>{' → '}<b>{n.range[1]}</b>{' (' + n.count + ' invoices)'}</>
            : n.start ? <>{'Will start at '}<b>{n.start}</b>{' (upload Excel to see the range)'}</>
            : n.text}
        </span>
      </div>
      <div style={st('display:flex;gap:10px;flex-wrap:wrap;align-items:center')}>
        <input type="file" id="o2o_file" accept=".xlsx" onChange={props.onPick} />
        <label style={st('display:flex;gap:7px;align-items:center;font-size:12px;color:var(--text-soft)')}>
          <input type="checkbox" id="o2o-test" defaultChecked style={st('width:auto')} />{' Test mode (don\'t post)'}</label>
        <button className="btn p" id="o2o-issue" onClick={props.onIssue} disabled={!props.canIssue}>Issue invoices in Xero →</button>
      </div>
      <div id="o2o-out" style={st('margin-top:14px')}>
        {o.kind === 'idle' ? <p className="muted">Pick the Excel to preview.</p>
          : o.kind === 'error' ? <div style={st('color:var(--red-soft)')}>{o.message}</div>
          : o.kind === 'preview' ? <Preview data={o.data} props={props} />
          : <Issued o={o} props={props} />}
      </div></div>
  );
}
