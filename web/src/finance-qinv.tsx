// Finance OS · Quick Invoice — the React half of `renderQinv()` (app.html:3356).
//
// The legacy original is STILL THERE and still shipping; nothing was deleted. Both are reachable side
// by side (`app.html#tab=qinv` and `/finance/qinv/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. The session, the
// `inv_meta` load, the `quick_invoice` POST and every DOM read live in app/finance/qinv/page.tsx.
//
// Second Finance screen; everything in src/finance-wht.tsx's header about what makes a Finance screen
// different (no chrome in the golden, the route is `app/finance/<tab-id>/`, the gate is in `showApp()`
// not in the renderer) applies unchanged and is not repeated.
//
// ── THE FORM IS UNCONTROLLED, ON PURPOSE ──────────────────────────────────────────────────────────
// The golden holds `<input id="qi_ref" placeholder="optional"/>` — no `value=`. A controlled React
// input emits `value=""`, which diffs, and there is no way to write it that does not. More importantly
// that is the actual contract: `qiCollect()` (app.html:4693) reads the form back out of the DOM by the
// `qi_*` ids and the `.qi-desc` / `.qi-qty` / `.qi-amt` / `.qi-acct` classes, and so does the route.
// A field that loses its id or its class here collects as blank — on this form that is a line silently
// dropped off an invoice, or a quantity read as 0. tests/finance-qinv.parity.test.tsx extracts both
// name sets from app.html at run time and checks them against this markup, so the check cannot drift
// from the function it protects.
//
// ── WHAT THE GOLDEN DOES NOT HOLD ─────────────────────────────────────────────────────────────────
// 1. THE LINE ROWS. `renderQinv()` calls `qiAddLine()` (app.html:4646) right after the innerHTML
//    write, and that appends a row with `appendChild` — the golden harness records innerHTML writes to
//    elements with ids, so the row never reached tests/golden/finance.qinv.html and `#qi_lines` is
//    captured EMPTY. An operator always sees one row. So the golden state is `lines={0}` and the route
//    starts at 1, and the row markup below is mirrored from app.html rather than diffed. Said plainly
//    because it is the largest uncovered branch on this screen.
// 2. EVERYTHING INSIDE `#qi_out`. Six different things get innerHTML'd into that one div by
//    `qiMeta()`, `qiPreview()` and `qiCreate()`; the golden holds it empty. `QinvOut` below is the
//    inventory of all six, mirrored, and the preview is where this screen's money lives — see `Preview`.
// 3. THE DATE. `renderQinv()` sets `qi_date.value` as a DOM PROPERTY after the write, so no `value`
//    attribute is in the golden and this component must not render one. `todayLocalISO()` is exported
//    here as a pure function of an instant (the hr.yearend rule: a derivation from the clock is lifted
//    out of the component so it stays under test) and the route applies it exactly as app.html does.

/** `COMPANIES` — app.html:1391. */
export interface Company { tenant_id: string; tenant_name: string }

/** `QINV_META` — app.html:3355, filled by `inv_meta`. */
export interface QinvMeta {
  contacts?: { name?: string | null; contact_id?: string | null; address?: unknown }[];
  items?: { name?: string | null; description?: string | null; code?: string | null; price?: number | null; account?: string | null }[];
  accounts?: { code: string; name: string }[];
}

/** One line as `qiCollect()` returns it — the shape that goes into `quick_invoice.line_items`. */
export interface QinvLine { description: string; quantity: number; unit_amount: number; account_code: string }

/** One line row as the DOM holds it, before validation. Strings, because the boxes hold strings. */
export interface RawLine { description: string; qty: string; amount: string; account_code: string }

/** `PERMS` — resolved by `showApp()` from `my_perms`, with `fallbackPerms()` (app.html:1398) standing in. */
export interface Perms { features?: string[] | null }

/**
 * app.html:1434 — Quick Invoice is named NOWHERE in `showApp()`'s if/else chain, so it falls through to
 * the chain's final `else`: `el.classList.toggle('hide', feats.indexOf(t)<0)`. The gate is the FEATURE
 * flag, not `manage_users` — read app.html:1420-1434 as a whole before trusting one line of it.
 *
 * Worth stating what this screen leaks without the gate, because it is not a report: the company list
 * with its Xero tenant ids, the customer contact list, the product catalogue WITH PRICES, and the
 * revenue account codes — and the button under all of it posts a real invoice into Xero.
 *
 * Exported from the screen, not hidden in the route, so the screen's own test can pin both directions.
 */
export function qinvReachable(perms: Perms | null | undefined): boolean {
  return ((perms && perms.features) || []).indexOf('qinv') >= 0;
}

/**
 * `todayLocalISO()` — app.html:1258, as a pure function of the instant it is handed.
 *
 * The +8h is Malaysia, and it is the whole point of the function: a browser in any other zone must
 * still date the invoice by the day it is in Kuala Lumpur. Getting this wrong dates an invoice into the
 * wrong month, which is a wrong revenue period and a wrong Xero aging bucket. Kept as a derivation from
 * a Date the caller HANDS IN, so the test can pin the MYT midnight boundary instead of the machine's.
 */
export function todayLocalISO(nowMs: number): string {
  const d = new Date(nowMs + 8 * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

/** `M` — app.html:1253. Formatting, not arithmetic. */
const M = (n: unknown) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `pdfAmt` — app.html:4752, the preview's own formatter. No currency prefix; the column header carries it. */
const pdfAmt = (n: unknown) => Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * `fmtDate` — app.html:4751. "31 May 2026", the Xero PDF date style. Parsed at T00:00:00 LOCAL exactly
 * as the legacy does, so the two agree on which day an ISO string names.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(iso: string): string {
  if (!iso) return '';
  const dt = new Date(iso + 'T00:00:00');
  return dt.getDate() + ' ' + MONTHS[dt.getMonth()] + ' ' + dt.getFullYear();
}

/**
 * `qiCollect()` — app.html:4693 — with the three DOM reads lifted into arguments.
 *
 * Split out for the same reason `payeeBody()` and `bankFile()` were: no golden sees what a screen
 * SENDS, so the rule that decides WHICH LINES BECOME AN INVOICE is provable nowhere else. Three
 * behaviours here are load-bearing and each one is a wrong invoice if it drifts:
 *
 *   • A wholly blank row is ignored silently (an operator adds a row and changes their mind).
 *   • A row that LOOKS filled but has a non-positive or non-numeric qty or amount is NOT silently
 *     dropped — it is counted and refused. That distinction is the difference between "you invoiced
 *     less than you meant to" and "the app told you".
 *   • A line with no revenue account is refused. Xero would take the default and the revenue lands in
 *     the wrong account, which is invisible until someone reads the P&L.
 *
 * There is deliberately no total here: `qiCollect()` computes none, and the authoritative total is the
 * server's (`finance.ts:780`, and Xero's own for a live post). The preview's subtotal is a DISPLAY of
 * `Σ qty × unit_amount` and lives with the markup that shows it.
 */
export function collect(f: { tenant: string; customer: string; rows: RawLine[]; contacts?: QinvMeta['contacts'] }): {
  tenant: string; customer: string; lines: QinvLine[];
  contactMatch: NonNullable<QinvMeta['contacts']>[number] | undefined; errors: string[];
} {
  const errors: string[] = [];
  const t = f.tenant; if (!t) errors.push('Pick a company');
  const cust = f.customer.trim(); if (!cust) errors.push('Enter a customer');
  const lines: QinvLine[] = [];
  let partials = 0;
  f.rows.forEach((row) => {
    const qRaw = row.qty, aRaw = row.amount, dRaw = row.description;
    if (!qRaw && !aRaw && !dRaw) return;                       // truly blank line, ignore silently
    const qty = Number(qRaw), amt = Number(aRaw);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(amt) || amt <= 0) { partials++; return; }
    lines.push({ description: dRaw || 'Item', quantity: qty, unit_amount: amt, account_code: row.account_code });
  });
  if (partials) errors.push(partials + ' line(s) have invalid quantity or amount — fix or clear them');
  if (!lines.length) errors.push('Add a line with quantity & amount');
  const missingAcct = lines.filter((l) => !l.account_code);
  if (missingAcct.length) errors.push(missingAcct.length + ' line(s) have no account selected');
  const match = (f.contacts || []).filter((c) => (c.name || '').toLowerCase() === cust.toLowerCase())[0];
  return { tenant: t, customer: cust, lines, contactMatch: match, errors };
}

/**
 * The body `qiCreate()` (app.html:4838) POSTs as `{api:'quick_invoice', …}`.
 *
 * Pinned here because it is the request that creates a real document in Xero. Two things it proves:
 * the FIELD SET (extracted from app.html in the test, not retyped), and the contact rule — a matched
 * Xero contact is sent by `contact_id` and an unmatched one by `contact_name`, NEVER both. Sending
 * both, or the wrong one, either duplicates a customer in Xero or bills the wrong one.
 *
 * `due_date` and `reference` are `|| undefined` exactly as the legacy writes them: an empty box must be
 * absent, not an empty string, or Xero is handed a blank reference where it had none.
 */
export function invoiceBody(f: {
  tenant: string; customer: string; lines: QinvLine[];
  contactMatch?: { contact_id?: string | null } | undefined;
  date: string; due: string; ref: string; test: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    api: 'quick_invoice', tenant: f.tenant, line_items: f.lines, date: f.date,
    due_date: f.due || undefined, reference: f.ref || undefined, dry_run: f.test,
  };
  if (f.contactMatch) body.contact_id = f.contactMatch.contact_id;
  else body.contact_name = f.customer;
  return body;
}

/** Everything `#qi_out` is ever given. The golden holds it EMPTY; none of this is diffed. */
export type QinvOut =
  /** `qiMeta()` / `qiCreate()` — app.html:4674, :4845. */
  | { kind: 'loading'; text: string }
  /** `qiMeta()`'s ✓ line — app.html:4671 (cached) and :4681. */
  | { kind: 'meta'; contacts: number; items: number; accounts: number; cached: boolean }
  /** `qiPreview()`'s validation block — app.html:4736. */
  | { kind: 'errors'; errors: string[] }
  /** Any failure — app.html:4683, :4685, :4852. */
  | { kind: 'failed'; error: string }
  /** `qiCreate()`'s dry run — app.html:4850. */
  | { kind: 'test'; total: number; existing: boolean }
  /** `qiCreate()`'s live result — app.html:4851. */
  | { kind: 'created'; number: string; total: number }
  /** `qiPreview()` — app.html:4734. */
  | { kind: 'preview'; data: PreviewData };

export interface PreviewData {
  companyName: string; customer: string; contactMatch: boolean;
  lines: QinvLine[]; date: string; due: string; ref: string; test: boolean;
  /** `new Date().toISOString().slice(0,10)` — app.html:4823. Handed in, never read from the clock here. */
  stamp: string;
}

export interface FinanceQinvProps {
  /** `COMPANIES` — the company <select>'s options. */
  companies: Company[];
  /** `QINV_META`. Empty until a company is picked. */
  meta: QinvMeta;
  /** How many line rows to render. `qiAddLine()` appends one; the golden was captured before it ran. */
  lines: number;
  /** `#qi_out`'s content, or null for empty as the golden has it. */
  out: QinvOut | null;
  /** `qiMeta()` — app.html:4663. */
  onMeta: () => void;
  /** `qiAddLine()` — app.html:4646. */
  onAddLine: () => void;
  /** `qiPreview()` — app.html:4732. */
  onPreview: () => void;
  /** `qiCreate()` — app.html:4838. */
  onCreate: () => void;
  /** `this.parentNode.remove()` — app.html:4655, by row index. */
  onRemoveLine: (i: number) => void;
  /** `qiFillProduct(this)` — app.html:4636. Handed the <select>, as the legacy is. */
  onFillProduct: (sel: HTMLSelectElement) => void;
  /** `document.getElementById('qi_out').innerHTML=''` — app.html:4832. */
  onBackToEdit: () => void;
  /** `qiPrintPdf()` — app.html:4835. */
  onPrintPdf: () => void;
}

/**
 * Every inline style is written as a STRING and parsed here, not as a React style object — same reason
 * and same helper as src/finance-wht.tsx: nothing in parity.ts touches an attribute VALUE, so these are
 * compared character for character, and a React style object would silently append `px` to a bare
 * number and re-serialise `.4` as `0.4`.
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

/** `qiProductOptions()` — app.html:4629. */
function ProductOptions({ meta }: { meta: QinvMeta }) {
  return (
    <>
      <option value="">— product —</option>
      {(meta.items || []).map((it, ix) => (
        <option key={ix} value={String(ix)}>{it.name + (it.price ? (' · ' + M(it.price)) : '')}</option>
      ))}
    </>
  );
}

/** `qiAccountOptions()` — app.html:4631. */
function AccountOptions({ meta }: { meta: QinvMeta }) {
  return (
    <>
      <option value="">— account —</option>
      {(meta.accounts || []).map((a) => <option key={a.code} value={a.code}>{a.code + ' · ' + a.name}</option>)}
    </>
  );
}

/**
 * `qiAddLine()`'s row — app.html:4646. IN NO GOLDEN (see the header): the legacy appends it with
 * `appendChild`, which the golden harness does not record, so `#qi_lines` was captured empty.
 *
 * Uncontrolled, and the `.qi-*` classes are the contract `qiCollect()` reads a row back by. `qty`
 * defaults to `1` as a `defaultValue`, matching the legacy `value="1"` attribute — a row that lost it
 * would collect as qty 0 and be refused, or worse be read as a blank line and vanish.
 */
function LineRow({ meta, onFillProduct, onRemove }: { meta: QinvMeta; onFillProduct: (sel: HTMLSelectElement) => void; onRemove: () => void }) {
  return (
    <div style={st('display:grid;grid-template-columns:160px 1fr 60px 110px 200px 36px;gap:6px;margin-bottom:6px;align-items:center')}>
      <select className="qi-prod" onChange={(e) => onFillProduct(e.target as HTMLSelectElement)}><ProductOptions meta={meta} /></select>
      <input placeholder="Description" className="qi-desc" />
      <input type="number" placeholder="Qty" defaultValue="1" className="qi-qty" />
      <input type="number" placeholder="Unit amount" className="qi-amt" />
      <select className="qi-acct" title="Revenue account for this line"><AccountOptions meta={meta} /></select>
      <button className="btn sm" onClick={onRemove}>×</button>
    </div>
  );
}

/**
 * `qiPreview()`'s Xero-PDF mockup — app.html:4769. IN NO GOLDEN.
 *
 * Ported rather than handed off to the legacy tab (the treatment `whtDocHtml` got) because it has no
 * URL: it renders UNSAVED form state, so there is nothing for a handoff to carry. It is also where
 * every number on this screen turns into the document the customer sees, which is what the test file's
 * arithmetic cases are pointed at.
 *
 * THE SUBTOTAL IS THE ONLY ARITHMETIC ON THE SCREEN and it is `Σ qty × unit_amount`, mirrored from
 * app.html:4745. It is NOT lifted into a shared root `.js` the way `whtCompute` was, and that is a
 * judgement, not an oversight: the withholding computation is a statutory formula with one correct
 * answer that two copies could disagree about, whereas this is a display echo of a total whose
 * authority is the server (`finance.ts:780` rounds it, and a live post takes Xero's `iv.Total`).
 * Raised in the PR as a seam rather than acted on.
 *
 * `Total Tax` is the literal `0.00` the legacy writes — this screen posts tax-exclusive lines and says
 * so in the "Amounts are tax exclusive" caption. It is not computed, so it cannot round away; a test
 * pins it as literal in case someone later "fixes" it into a computed field.
 */
function Preview({ meta, d }: { meta: QinvMeta; d: PreviewData }) {
  const currency = 'MYR';
  const subtotal = d.lines.reduce((s, l) => s + l.quantity * l.unit_amount, 0);
  const th = 'padding:8px;text-align:right;font-size:10px;color:#7c8694;text-transform:uppercase;letter-spacing:.1em;font-weight:600';
  const td = 'padding:14px 8px;border-top:1px solid #d9dde2;vertical-align:top;';

  /** `qiAccountLabel(code)` — app.html:4718. */
  const acctLabel = (code: string) => {
    if (!code) return <span style={st('color:var(--red-soft)')}>⚠ no account</span>;
    const a = (meta.accounts || []).filter((x) => x.code === code)[0];
    return a ? a.code + ' · ' + a.name : code;
  };

  const rows = d.lines.map((l, i) => {
    // app.html:4748 — best-effort SKU from the product catalogue, matched on either name or description.
    let sku = '';
    (meta.items || []).forEach((it) => { if (it.name === l.description || it.description === l.description) sku = it.code || ''; });
    return (
      <tr key={i}>
        <td style={st('padding:14px 8px 14px 0;border-top:1px solid #d9dde2;vertical-align:top;color:#7c8694;font-size:11px;letter-spacing:.02em')}>{sku ? sku : ' '}</td>
        <td style={st(td + 'color:#202632;font-size:13px;line-height:1.45')}>{l.description}</td>
        <td style={st(td + 'text-align:right;color:#202632;font-size:13px')}>{String(l.quantity)}</td>
        <td style={st(td + 'text-align:right;color:#202632;font-size:13px')}>{pdfAmt(l.unit_amount)}</td>
        <td style={st(td + 'text-align:right;color:#7c8694;font-size:11px')}>{acctLabel(l.account_code)}</td>
        <td style={st('padding:14px 0 14px 8px;border-top:1px solid #d9dde2;vertical-align:top;text-align:right;color:#202632;font-size:13px')}>{pdfAmt(l.quantity * l.unit_amount)}</td>
      </tr>
    );
  });

  return (
    <div id="qi-pdf" style={st("background:#fff;color:#202632;border-radius:8px;padding:48px 54px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;line-height:1.5;box-shadow:0 8px 32px rgba(0,0,0,.4);max-width:780px;margin:0 auto")}>
      <table style={st('width:100%;border-collapse:collapse;margin-bottom:36px')}><tbody><tr>
        <td style={st('width:55%;vertical-align:top')}>
          <div style={st('font-size:11px;letter-spacing:.15em;color:#7c8694;text-transform:uppercase;font-weight:600;margin-bottom:6px')}>Tax Invoice</div>
          <div style={st('font-size:24px;color:#202632;font-weight:300;letter-spacing:-.02em')}>{d.companyName}</div>
        </td>
        <td style={st('width:45%;vertical-align:top;text-align:right')}>
          <div style={st('font-size:30px;color:#1a73e8;font-weight:300;letter-spacing:-.01em')}>INVOICE</div>
          <div style={st('font-size:12px;color:#7c8694;margin-top:2px;letter-spacing:.05em')}>{d.test ? '(TEST preview — no number assigned)' : '(number will be assigned by Xero)'}</div>
        </td>
      </tr></tbody></table>
      <table style={st('width:100%;border-collapse:collapse;margin-bottom:36px')}><tbody><tr>
        <td style={st('width:55%;vertical-align:top;padding-right:24px')}>
          <div style={st('font-size:10px;color:#7c8694;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;font-weight:600')}>Bill To</div>
          <div style={st('font-size:14px;color:#202632;font-weight:500')}>{d.customer}</div>
        </td>
        <td style={st('width:45%;vertical-align:top')}>
          <table style={st('width:100%;border-collapse:collapse;font-size:12.5px')}><tbody>
            <tr><td style={st('padding:3px 0;color:#7c8694')}>Invoice Date</td><td style={st('padding:3px 0;text-align:right;color:#202632')}>{fmtDate(d.date)}</td></tr>
            {d.due ? <tr><td style={st('padding:3px 0;color:#7c8694')}>Due Date</td><td style={st('padding:3px 0;text-align:right;color:#202632')}>{fmtDate(d.due)}</td></tr> : null}
            {d.ref ? <tr><td style={st('padding:3px 0;color:#7c8694')}>Reference</td><td style={st('padding:3px 0;text-align:right;color:#202632')}>{d.ref}</td></tr> : null}
            <tr><td style={st('padding:3px 0;color:#7c8694')}>Currency</td><td style={st('padding:3px 0;text-align:right;color:#202632')}>{currency}</td></tr>
          </tbody></table>
        </td>
      </tr></tbody></table>
      <div style={st('font-size:10px;color:#7c8694;text-transform:uppercase;letter-spacing:.1em;text-align:right;margin-bottom:4px;font-weight:600')}>Amounts are tax exclusive</div>
      <table style={st('width:100%;border-collapse:collapse')}>
        <thead><tr style={st('border-bottom:2px solid #202632')}>
          <th style={st('padding:8px 8px 8px 0;text-align:left;font-size:10px;color:#7c8694;text-transform:uppercase;letter-spacing:.1em;font-weight:600')}>Item</th>
          <th style={st('padding:8px;text-align:left;font-size:10px;color:#7c8694;text-transform:uppercase;letter-spacing:.1em;font-weight:600')}>Description</th>
          <th style={st(th)}>Qty</th>
          <th style={st(th)}>Unit Price</th>
          <th style={st(th)}>Account</th>
          <th style={st('padding:8px 0 8px 8px;text-align:right;font-size:10px;color:#7c8694;text-transform:uppercase;letter-spacing:.1em;font-weight:600')}>{'Amount ' + currency}</th>
        </tr></thead>
        <tbody>{rows}</tbody>
      </table>
      <table style={st('width:100%;border-collapse:collapse;margin-top:14px')}><tbody><tr><td style={st('width:60%')}></td><td style={st('width:40%')}>
        <table style={st('width:100%;border-collapse:collapse;font-size:13px')}><tbody>
          <tr><td style={st('padding:8px 8px 8px 0;color:#202632')}>Subtotal</td><td style={st('padding:8px 0 8px 8px;text-align:right;color:#202632')}>{pdfAmt(subtotal)}</td></tr>
          <tr><td style={st('padding:8px 8px 8px 0;color:#202632')}>Total Tax</td><td style={st('padding:8px 0 8px 8px;text-align:right;color:#202632')}>0.00</td></tr>
          <tr style={st('border-top:2px solid #202632')}><td style={st('padding:12px 8px 12px 0;color:#202632;font-weight:600;font-size:15px')}>{'TOTAL ' + currency}</td><td style={st('padding:12px 0 12px 8px;text-align:right;color:#202632;font-weight:600;font-size:15px')}>{pdfAmt(subtotal)}</td></tr>
          <tr><td colSpan={2} style={st('padding-top:8px;text-align:right;color:#7c8694;font-size:11px')}>{'Due Date: ' + (fmtDate(d.due) || '—')}</td></tr>
        </tbody></table>
      </td></tr></tbody></table>
      <div style={st('margin-top:48px;padding-top:14px;border-top:1px solid #d9dde2;text-align:center;font-size:10px;color:#7c8694;letter-spacing:.05em')}>{'CTG Finance Portal · Preview · ' + d.stamp}</div>
    </div>
  );
}

/** `#qi_out` — app.html's six writes into it, as one branch each. IN NO GOLDEN. */
function Out(p: FinanceQinvProps & { out: QinvOut }) {
  const o = p.out;
  if (o.kind === 'loading') return <span className="muted">{o.text}</span>;
  if (o.kind === 'meta') {
    return <span className="muted">{'✓ ' + o.contacts + ' contacts · ' + o.items + ' products · ' + o.accounts + ' revenue accounts'}
      {o.cached ? <>{' '}<span style={st('opacity:.6')}>(cached)</span></> : null}</span>;
  }
  if (o.kind === 'errors') return <div style={st('color:var(--red-soft);font-size:13px')}>{'⚠ ' + o.errors.join(' · ')}</div>;
  if (o.kind === 'failed') return <div style={st('color:var(--red-soft)')}>{o.error}</div>;
  if (o.kind === 'test') {
    return <div className="card" style={st('max-width:420px')}>
      <div className="n" style={st('color:var(--amber);font-size:16px')}>{'TEST · total ' + M(o.total)}</div>
      <div className="l">{'Customer: ' + (o.existing ? '✓ existing Xero contact' : '⚠ new contact will be created') + ' · uncheck Test mode to create'}</div>
    </div>;
  }
  if (o.kind === 'created') {
    return <div className="card" style={st('max-width:380px')}>
      <div className="n" style={st('color:var(--green-soft)')}>{o.number + ' · ' + M(o.total)}</div>
      <div className="l">Invoice created in Xero ✓</div>
    </div>;
  }
  const d = o.data;
  // app.html:4761 — the mode banner and the contact-match chip live ABOVE the paper, not inside it.
  return (
    <>
      {d.test
        ? <div style={st('background:rgba(255,187,86,.12);border:1px solid rgba(255,187,86,.4);color:#ffbb56;padding:8px 14px;border-radius:8px;font-size:12.5px;margin-bottom:12px')}>⚠ <b>TEST mode</b> — this is a preview only. Nothing will be posted to Xero.</div>
        : <div style={st('background:rgba(126,224,160,.12);border:1px solid rgba(126,224,160,.4);color:#7ee0a0;padding:8px 14px;border-radius:8px;font-size:12.5px;margin-bottom:12px')}>✓ <b>LIVE</b> — confirming will create this invoice in Xero.</div>}
      <div style={st('display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:12.5px;color:var(--text-soft)')}>
        <div><b>Customer:</b>{' ' + d.customer}
          {d.contactMatch
            ? <span style={st('font-size:11px;color:#7ee0a0;margin-left:8px')}>✓ existing Xero contact</span>
            : <span style={st('font-size:11px;color:var(--coral-soft);margin-left:8px')}>⚠ new contact will be created</span>}
        </div>
        <div className="muted">{'Preview the invoice as Xero will render it. ✓ Confirm below to ' + (d.test ? 'run a test' : 'create in Xero') + '.'}</div>
      </div>
      <Preview meta={p.meta} d={d} />
      <div style={st('display:flex;gap:8px;margin-top:16px;justify-content:flex-end')}>
        <button className="btn" onClick={p.onBackToEdit}>← Back to edit</button>
        <button className="btn" onClick={p.onPrintPdf}>🖨 Print preview</button>
        {/* class qi-create-btn matches the form button's class so runOnce locks BOTH. */}
        <button className="btn p qi-create-btn" onClick={p.onCreate}>{d.test ? 'Run test (no posting)' : '✓ Confirm & create in Xero'}</button>
      </div>
    </>
  );
}

/** `renderQinv()` — app.html:3356. */
export default function FinanceQinv(props: FinanceQinvProps) {
  return (
    <div className="panel" style={st('max-width:880px')}><div className="panel-hd"><h3>Quick Invoice → Xero</h3></div>
      <div style={st('display:grid;grid-template-columns:1fr 1fr;gap:10px')}><div className="fld"><label>Company</label><select id="qi_co" onChange={props.onMeta}><option value="">— select —</option>
        {props.companies.map((c) => <option key={c.tenant_id} value={c.tenant_id}>{c.tenant_name}</option>)}
      </select></div>
      <div className="fld"><label>Customer</label><input id="qi_cust" list="qi_contacts" placeholder="type or pick" /><datalist id="qi_contacts">
        {(props.meta.contacts || []).map((c, i) => <option key={i} value={c.name || ''}></option>)}
      </datalist></div></div>
      <div className="fld"><label>Reference</label><input id="qi_ref" placeholder="optional" /></div>
      <div className="fld"><label>Line items</label><div id="qi_lines">
        {Array.from({ length: props.lines }, (_v, i) => (
          <LineRow key={i} meta={props.meta} onFillProduct={props.onFillProduct} onRemove={() => props.onRemoveLine(i)} />
        ))}
      </div><button className="btn sm" onClick={props.onAddLine}>+ Add line</button></div>
      <div style={st('display:grid;grid-template-columns:1fr 1fr;gap:10px')}><div className="fld"><label>Date</label><input type="date" id="qi_date" /></div><div className="fld"><label>Due date</label><input type="date" id="qi_due" /></div></div>
      <label style={st('display:flex;gap:7px;align-items:center;font-size:12px;color:var(--text-soft);margin-bottom:10px')}><input type="checkbox" id="qi_test" defaultChecked style={st('width:auto')} />{' Test mode (don\'t post)'}</label>
      <div style={st('display:flex;gap:8px;flex-wrap:wrap')}><button className="btn" onClick={props.onPreview}>👁 Preview invoice</button><button className="btn p qi-create-btn" id="qi-create-btn" onClick={props.onCreate}>Create invoice in Xero →</button></div>
      <div id="qi_out" style={st('margin-top:12px')}>{props.out ? <Out {...props} out={props.out} /> : null}</div></div>
  );
}
