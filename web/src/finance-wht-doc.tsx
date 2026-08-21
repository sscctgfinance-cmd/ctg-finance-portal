// Finance OS · Withholding Tax — the COMPUTATION PAGE (`WHT.page === 'doc'`).
//
// A SIBLING PAGE, not a branch. `renderWht()` (app.html:3223) dispatches on `WHT.page`:
// `whtDocHtml()` (app.html:3381) owns every byte of `#wht` when the operator opens or creates a
// computation, and `whtListHtml()` owns it otherwise. web/src/finance-wht.tsx migrated the list and
// handed this page off to `app.html#tab=wht`; this file closes that handoff, so an operator who clicks
// a row in React stays in React.
//
// Both legacy functions are STILL THERE and still shipping; nothing was deleted.
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. The `wht_get` /
// `wht_save` / `wht_delete` calls, the DOM sync and `window.open` live in app/finance/wht/doc/page.tsx.
//
// ── NO GOLDEN HOLDS THIS PAGE ─────────────────────────────────────────────────────────────────────
// `tests/golden/finance.wht.html` was captured at `WHT.page === 'list'`, so there is no committed
// baseline to diff against and no `relax()` comparison to lean on. The screen's test therefore asserts
// this page STRUCTURALLY — the field ids `whtSync()` reads, the figures `whtCompute()` produces, the
// POST body, the printable document's own text — and reads the legacy expressions out of `app.html` at
// run time wherever a claim about the legacy is being made, so the check cannot drift from the function
// it protects. Whether this page deserves a captured baseline of its own is answered in the PR.
//
// ── THE ARITHMETIC IS IMPORTED. IT IS NOT RE-EXPRESSED HERE, EVER ──────────────────────────────────
// `whtCompute`, `whtMoney`, `whtRound2`, `whtLineSst`, `whtLineTotal` and `whtDueDate` come from
// wht.js — the same file `app.html` loads as a classic script — through wht.d.ts. This page PRINTS the
// figures a real company remits to LHDN and hands a tax agent; a second copy of that arithmetic is a
// wrong filing waiting for the day the two stop agreeing. Nothing in this file rounds, grosses up or
// applies a rate.
//
// ── TWO LEGACY DEFECTS MIRRORED, NOT FIXED ────────────────────────────────────────────────────────
// 1. DUPLICATE `style=` ATTRIBUTES, twice. `<th class="amt" style="text-align:right"
//    style="min-width:110px">` (app.html:3438) and `<td class="amt" style="text-align:right"
//    id="w_total" style="color:var(--coral,#e2604b)">` (app.html:3449). A parser keeps the FIRST and
//    drops the second, so the "Fee (RM)" column has never had its min-width and the "Total payable to
//    LHDN" figure has never been coral. React cannot emit a duplicate attribute at all — the same
//    finding `ln()` (hros.html:4837) produced for hr.calculator. Mirrored as the DOM actually is: the
//    first attribute only. Fixing either is a visible change, not a migration detail.
// 2. `w_grossbase` IS NEVER RECALCULATED. `whtRecalc()` (app.html:3369) sets `w_fee`, `w_sstt`,
//    `w_incl`, `w_gross`, `w_wht`, `w_pena`, `w_total` and `w_netpay` — but not `w_grossbase`, the
//    Computation panel's "Fee subject to withholding" row. So in the legacy screen, typing an amount
//    moves the tax and leaves the fee it was charged on stale until something forces a full re-render.
//    This port CANNOT reproduce that: every figure here is derived from the same state in one render
//    pass, so the two rows cannot disagree. That is a divergence, in the safe direction, and it is
//    recorded rather than hidden.

import { whtCompute, whtDueDate, whtLineSst, whtLineTotal, whtMoney, whtRound2 } from '../../wht.js';
import type { WhtPayee } from './finance-wht';

export type { WhtPayee };

/** One entity of `wht_config.entities` — tests/render_fixtures.ts:216. */
export interface WhtEntity {
  tenant_id: string;
  name?: string | null;
  /** The PAYER's tax number. Printed on the document and posted as `entity_tin`. */
  tax_no?: string | null;
}

/** `COMPANIES` — app.html:1394. `whtCoName()` (app.html:3399) resolves a tenant's display name here. */
export interface Company { tenant_id: string; tenant_name: string }

/** One editable payment line — `WHT.lines[i]`, as `whtOpen()` (app.html:3339) shapes it. */
export interface WhtDocLine {
  payment_date?: string | null;
  receipt_no?: string | null;
  description?: string | null;
  amount?: number | string | null;
}

/** `WHT.doc` — app.html:3331 (`whtNew()`) and `wht_get.summary` (`whtOpen()`, app.html:3336). */
export interface WhtDocState {
  id?: number | null;
  doc_no?: string | null;
  tenant_id: string;
  payee_id?: number | null;
  payee_name: string;
  payee_tin?: string | null;
  payee_country?: string | null;
  /** Fraction, not percent. */
  wht_rate: number;
  wht_type?: string | null;
  /** `'net'` or anything else (gross). */
  basis: string;
  sst_rate: number;
  penalty_pct: number;
  penalty_on: boolean;
  status?: string | null;
  period_label: string;
  notes?: string | null;
  entity_tin?: string | null;
  /** `whtSetPayee()` caches the picked payee here — app.html:3327. */
  _payee?: WhtPayee | null;
}

/** `whtCoName(t)` — app.html:3399. A tenant with no company row prints as the empty string. */
export function whtCoName(companies: Company[], tenant: string): string {
  const c = (companies || []).find((x) => x.tenant_id === tenant);
  return c ? c.tenant_name : '';
}

/**
 * The LHDN return a charging section is remitted on — app.html:3446 and again at app.html:3512, the
 * same three-branch expression in both halves of the legacy.
 *
 * NOT lifted into wht.js, deliberately: `WHT_TYPES` (the charging-section table itself) already lives
 * there because both halves print its labels, but this mapping is printed and never posted — no
 * `wht_*` handler reads it (finance.ts:1194 onward) — so lifting it would mean editing wht.js,
 * wht.d.ts and two sites in app.html for a ternary. It is instead PINNED against app.html's own text
 * in web/tests/finance-wht-doc.parity.test.tsx, so a change to the legacy mapping fails this port's
 * test rather than silently forking it. That seam is named in the PR.
 */
export function whtFormNo(whtType: string | null | undefined): string {
  return whtType === 's4a_special' ? 'CP37D' : whtType === 'contract' ? 'CP37A / CP37F' : 'CP37';
}

/**
 * `whtSave()`'s line filter — app.html:3467, and byte for byte the same filter `whtPrint()` uses
 * (app.html:3487). A row is kept when it carries an amount, a receipt number OR a payment date.
 *
 * Split out because it decides what is FILED. A blank row that slipped through would post a zero line
 * onto a statutory computation; a row with a date and no amount yet dropped would silently shorten the
 * period the due date is derived from.
 */
export function saveLines(lines: WhtDocLine[]): WhtDocLine[] {
  return (lines || []).filter((l) => (Number(l.amount) || 0) > 0 || String(l.receipt_no || '').trim() !== '' || !!l.payment_date);
}

/**
 * The `{api:'wht_save', summary, lines}` body — `whtSave(status)`, app.html:3461.
 *
 * No golden sees a request body, so the field set, the `entity_tin` lookup and the three refusals are
 * provable nowhere else. Same treatment as `bankFile()`, `profileBody()` and `reconcileBody('')`: the
 * legacy toasts and returns, this THROWS, and the route turns the throw back into the same message.
 *
 * `entity_tin` is resolved from `wht_config.entities`, not typed: it is the PAYER's tax number on a
 * statutory return, and a document filed under the wrong TIN is filed against the wrong company.
 */
export function saveBody(
  doc: WhtDocState,
  lines: WhtDocLine[],
  status: string,
  entities: WhtEntity[],
): { summary: WhtDocState; lines: WhtDocLine[] } {
  if (!doc.tenant_id) throw new Error('Pick the paying company');
  if (!doc.payee_name) throw new Error('Pick the payee');
  const kept = saveLines(lines);
  if (!kept.length) throw new Error('Add at least one payment line');
  const ent = (entities || []).find((x) => x.tenant_id === doc.tenant_id) || ({} as WhtEntity);
  return {
    summary: { ...doc, entity_tin: ent.tax_no || null, status: status || doc.status || 'draft' },
    lines: kept,
  };
}

/** `esc()` — app.html:1257. Only `printDocHtml()` needs it; JSX escapes on its own. */
const esc = (x: unknown) =>
  (x == null ? '' : String(x)).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/**
 * `whtPrint()`'s document — app.html:3483 — as a PURE STRING, with the `window.open`, the
 * `document.write` and the print timeout left in the route.
 *
 * Same split `sbiInvoiceHTML()` got, and for the same reason: this is a DOCUMENT THAT LEAVES THE
 * BUILDING. It is the copy the tax agent files from and the copy an auditor reads, so its figures, its
 * basis note and its due date are pinned by assertion in the screen's own test — nothing else can see
 * them.
 */
export function printDocHtml(
  doc: WhtDocState,
  lines: WhtDocLine[],
  companies: Company[],
  entities: WhtEntity[],
): string {
  const d = doc;
  const c = whtCompute(d, lines);
  const due = whtDueDate(lines);
  const ent = (entities || []).find((x) => x.tenant_id === d.tenant_id) || ({} as WhtEntity);
  const rows = saveLines(lines).map((l, i) => {
    const a = Number(l.amount) || 0, s = whtLineSst(a, d.sst_rate);
    return '<tr><td>' + (i + 1) + '</td><td>' + esc(l.payment_date || '') + '</td><td>' + esc(l.receipt_no || '') + '</td><td>' + esc(l.description || '') +
      '</td><td class="amt" style="text-align:right">' + whtMoney(a) + '</td><td class="amt" style="text-align:right">' + whtMoney(s) + '</td><td class="amt" style="text-align:right">' + whtMoney(whtRound2(a + s)) + '</td></tr>';
  }).join('');
  const ratePct = (Number(d.wht_rate) * 100).toFixed(2).replace(/\.00$/, '');
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(d.doc_no || 'WHT') + '</title><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;color:#17231f;margin:32px;font-size:12px}' +
    'h1{font-size:17px;margin:0 0 2px}.mut{color:#5e6e67;font-size:11px}' +
    'table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #cfd8d4;padding:5px 7px;text-align:left}' +
    'th{background:#eef3f1}.r{text-align:right}.tot td{font-weight:bold;background:#f6f9f8}' +
    '.box{margin-top:14px;max-width:420px}.note{margin-top:16px;font-size:10.5px;color:#5e6e67;line-height:1.5}' +
    '</style></head><body>' +
    '<h1>WITHHOLDING TAX SUMMARY</h1><div class="mut">' + esc(d.doc_no || '') + '</div>' +
    '<table style="margin-top:14px"><tr><td style="width:150px"><b>Payer</b></td><td>' + esc(whtCoName(companies, d.tenant_id) || ent.name || '') + '</td>' +
      '<td style="width:110px"><b>TIN</b></td><td>' + esc(ent.tax_no || '') + '</td></tr>' +
      '<tr><td><b>Payee</b></td><td>' + esc(d.payee_name || '') + '</td><td><b>TIN</b></td><td>' + esc(d.payee_tin || '') + '</td></tr>' +
      '<tr><td><b>Country</b></td><td>' + esc(d.payee_country || '') + '</td><td><b>Period</b></td><td>' + esc(d.period_label || '') + '</td></tr></table>' +
    '<table><thead><tr><th>No</th><th>Payment date</th><th>Receipt no</th><th>Description</th><th class="amt" style="text-align:right">Fee (RM)</th><th class="amt" style="text-align:right">SST ' + ((Number(d.sst_rate) || 0) * 100).toFixed(0) + '%</th><th class="amt" style="text-align:right">Total</th></tr></thead>' +
    '<tbody>' + rows + '</tbody><tfoot><tr class="tot"><td colspan="4">Subtotal</td><td class="amt" style="text-align:right">' + whtMoney(c.fee) + '</td><td class="amt" style="text-align:right">' + whtMoney(c.sst) + '</td><td class="amt" style="text-align:right">' + whtMoney(c.feeInclSst) + '</td></tr></tfoot></table>' +
    '<table class="box"><tr><td>Fee subject to withholding</td><td class="amt" style="text-align:right">' + whtMoney(c.fee) + '</td></tr>' +
      (d.basis === 'net' ? '<tr><td>Grossed-up amount</td><td class="amt" style="text-align:right">' + whtMoney(c.gross) + '</td></tr>' : '') +
      '<tr><td>WHT rate</td><td class="amt" style="text-align:right">' + ratePct + '%</td></tr>' +
      '<tr class="tot"><td>Withholding tax</td><td class="amt" style="text-align:right">' + whtMoney(c.wht) + '</td></tr>' +
      (d.penalty_on ? '<tr><td>Increase 10% (s.109(2))</td><td class="amt" style="text-align:right">' + whtMoney(c.penalty) + '</td></tr>' : '') +
      '<tr class="tot"><td>Total payable to LHDN</td><td class="amt" style="text-align:right">' + whtMoney(c.total) + '</td></tr></table>' +
    '<div class="note">Basis of computation: withholding tax is charged on the fee excluding Malaysian service tax. ' +
      (d.basis === 'net' ? 'The fee is stated net of tax, so it has been grossed up because the tax is borne by the payer. ' : '') +
      'Treaty rates apply only where a valid Certificate of Residence is held. ' +
      (due ? ('Remittance due ' + esc(due) + ' — one month after the last payment date; form ' + esc(whtFormNo(d.wht_type)) + '. ') : '') +
      (d.notes ? ('<br>' + esc(d.notes)) : '') + '</div>' +
    '</body></html>';
}

/** app.html:3385 — the shared input style. */
const S = 'padding:7px 9px;background:var(--panel-2,#141a22);border:1px solid var(--border,#243040);border-radius:7px;color:var(--text,#e8eef6);font-size:12.5px;width:100%';
/** app.html:3386 — the narrower style the payment-line cells use. */
const CS = 'padding:5px 7px;background:var(--panel-2,#141a22);border:1px solid var(--border,#243040);border-radius:6px;color:var(--text,#e8eef6);font-size:12px;width:100%';

/**
 * Every inline style is written as a STRING and split mechanically — the `st()` the WHT list pilot
 * introduced. A style OBJECT hands React two chances to change a value silently (it appends `px` to a
 * bare number and re-serialises `.15` as `0.15`), and these values are the legacy's own.
 */
function st(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of css.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const key = name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase());
    out[key] = part.slice(at + 1).trim();
  }
  return out;
}

/** app.html:3387 — one labelled field. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="muted" style={st('font-size:11px;display:block;margin-bottom:3px')}>{label}</label>
      {children}
    </div>
  );
}

/** The keys `whtSync()` (app.html:3312) writes back onto `WHT.doc`. */
export type DocField = 'tenant_id' | 'period_label' | 'basis' | 'wht_rate' | 'sst_rate' | 'penalty_on' | 'notes';
/** The keys `whtSync()` writes back onto each `WHT.lines[i]`. */
export type LineField = 'payment_date' | 'receipt_no' | 'description' | 'amount';

export interface FinanceWhtDocProps {
  doc: WhtDocState;
  lines: WhtDocLine[];
  /** `wht_config.entities` — the paying-company picker AND the TIN that is filed. */
  entities: WhtEntity[];
  /** `wht_config.payees`. */
  payees: WhtPayee[];
  /** `COMPANIES` — app.html:1394, read by `whtCoName()`. */
  companies: Company[];
  /** `whtSync()` + a re-render. Called for every field the legacy syncs. */
  onField: (key: DocField, value: string | boolean) => void;
  onLineField: (index: number, key: LineField, value: string) => void;
  /** `whtSetPayee(this.value)` — app.html:3323. An empty string clears the payee. */
  onPayee: (id: string) => void;
  /** `whtAddLine()` / `whtDelLine(i)` — app.html:3332, :3333. */
  onAddLine: () => void;
  onDelLine: (index: number) => void;
  /** `whtSave('draft'|'final')` — app.html:3461. */
  onSave: (status: string) => void;
  /** `whtPrint()` — app.html:3483. */
  onPrint: () => void;
  /** `whtDelete()` — app.html:3476. Only rendered for a computation that already exists. */
  onDelete: () => void;
  /** `WHT.page='list';WHT.doc=null;renderWht()` — app.html:3243. */
  onBack: () => void;
}

/**
 * `whtHead(sub)` in its `WHT.page==='doc'` form — app.html:3236. The `sub` is interpolated as HTML by
 * the legacy (the doc number arrives wrapped in `<b>`), so it is taken as a node here rather than a
 * string.
 */
function Head({ sub, onBack }: { sub: React.ReactNode; onBack: () => void }) {
  return (
    <div style={st('display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px')}>
      <div><h2 style={st('margin:0;font-size:19px')}>🌏 Withholding Tax</h2>
        <div className="muted" style={st('font-size:12px')}>{sub}</div></div>
      <div style={st('display:flex;gap:8px;flex-wrap:wrap')}>
        <button className="btn sm" onClick={onBack}>← All computations</button>
      </div>
    </div>
  );
}

/**
 * `whtDocHtml()` — app.html:3381.
 *
 * UNCONTROLLED, with every legacy `w_*` / `wl_*` element id kept. That is the contract: `whtSync()`
 * (app.html:3312) reads this form back out of the DOM by exactly those ids, `whtRecalc()` writes the
 * derived cells back by them, and the route here reads the same ids for the same reason. A field that
 * loses its id syncs as blank — on this form that is a wiped period, a rate silently reset to 0, or a
 * payment line that never reaches the filing. The screen's test extracts the id list from `app.html` at
 * run time and checks it against this markup, so it cannot drift from the function it protects.
 *
 * The route re-mounts this component (a `key`) whenever state changes a field's value from OUTSIDE the
 * field — picking a payee rewrites the rate box, adding or deleting a line renumbers the rows — which
 * is what the legacy's wholesale `innerHTML=` does. Typing never re-mounts, so the caret is never moved.
 */
export default function FinanceWhtDoc(props: FinanceWhtDocProps) {
  const d = props.doc;
  const c = whtCompute(d, props.lines);
  const due = whtDueDate(props.lines);
  const ents = props.entities || [];
  const ent = ents.find((x) => x.tenant_id === d.tenant_id) || ({} as WhtEntity);
  const payee = d._payee || (props.payees || []).find((x) => x.id === d.payee_id) || ({} as WhtPayee);

  const ratePct = (Number(d.wht_rate) * 100).toFixed(2).replace(/\.00$/, '');

  // app.html:3403 — the Certificate of Residence warning. A treaty rate with no COR on file is the one
  // thing on this page LHDN can reassess, so it is rendered from the PAYEE's own flags, never the doc's.
  const corWarn = payee.treaty_relief && !payee.has_cor
    ? <div style={st('background:rgba(224,168,0,.12);border:1px solid rgba(224,168,0,.35);border-radius:8px;padding:9px 12px;margin-bottom:12px;font-size:12px;color:var(--amber,#e0a800)')}>
        {'⚠ A treaty rate is being applied to '}<b>{payee.name || ''}</b>
        {' but no Certificate of Residence is recorded. Without a current COR, LHDN can assess at the full domestic rate ('
          + ((Number(payee.statutory_rate != null ? payee.statutory_rate : 0.10)) * 100).toFixed(0) + '%) plus the 10% increase.'}
      </div>
    : null;

  // app.html:3407 — built as ONE string, as the legacy reads it: adjacent JSX text expressions are two
  // text nodes where the legacy has one.
  const basisNote = d.basis === 'net'
    ? 'Net basis — the payee is paid the fee in full and the company bears the tax, so the fee is grossed up to ' + whtMoney(c.gross) + ' before the rate is applied.'
    : 'Gross basis — the fee is the gross amount and the WHT is deducted from what the payee is paid.';

  return (
    <>
      <Head onBack={props.onBack} sub={<>{d.doc_no ? <><b>{d.doc_no}</b>{' · '}</> : null}Withholding tax computation</>} />
      {corWarn}

      <div className="panel" style={st('margin-bottom:14px')}>
        <div style={st('display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px')}>
          <Field label="Paying company *">
            <select id="w_entity" defaultValue={d.tenant_id || ''} onChange={(e) => props.onField('tenant_id', e.target.value)} style={st(S)}>
              <option value="">— pick —</option>
              {ents.map((e) => <option key={e.tenant_id} value={e.tenant_id}>{whtCoName(props.companies, e.tenant_id) || e.name || e.tenant_id}</option>)}
            </select>
            {ent.tax_no
              ? <div className="muted" style={st('font-size:10.5px;margin-top:3px')}>{'TIN ' + ent.tax_no}</div>
              : <div className="muted" style={st('font-size:10.5px;margin-top:3px')}>No TIN in Company Info</div>}
          </Field>
          <Field label="Payee *">
            <select id="w_payee" defaultValue={d.payee_id == null ? '' : String(d.payee_id)} onChange={(e) => props.onPayee(e.target.value)} style={st(S)}>
              <option value="">— pick —</option>
              {(props.payees || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {d.payee_tin
              ? <div className="muted" style={st('font-size:10.5px;margin-top:3px')}>{'TIN ' + d.payee_tin + ' · ' + (d.payee_country || '')}</div>
              : null}
          </Field>
          <Field label="Period">
            <input id="w_period" defaultValue={d.period_label || ''} placeholder="e.g. July 2026"
              onInput={(e) => props.onField('period_label', (e.target as HTMLInputElement).value)} style={st(S)} />
          </Field>
          <Field label="WHT rate (%)">
            <input id="w_rate" type="number" step="0.01" min="0" max="99" defaultValue={Number(d.wht_rate) * 100}
              onInput={(e) => props.onField('wht_rate', (e.target as HTMLInputElement).value)} style={st(S)} />
          </Field>
          <Field label="Basis">
            <select id="w_basis" defaultValue={d.basis === 'net' ? 'net' : 'gross'} onChange={(e) => props.onField('basis', e.target.value)} style={st(S)}>
              <option value="gross">Gross — tax deducted from the fee</option>
              <option value="net">Net — company bears the tax (gross up)</option>
            </select>
          </Field>
          <Field label="Service tax on imported services (%)">
            <input id="w_sst" type="number" step="0.01" min="0" max="99" defaultValue={Number(d.sst_rate) * 100}
              onInput={(e) => props.onField('sst_rate', (e.target as HTMLInputElement).value)} style={st(S)} />
          </Field>
        </div>
        <div className="muted" style={st('font-size:11.5px;margin-top:9px')}>{basisNote}</div>
      </div>

      <div className="panel" style={st('margin-bottom:14px')}>
        <div className="panel-hd"><h3>Payments</h3>
          <button className="btn sm" onClick={props.onAddLine}>+ Add row</button></div>
        <div className="muted" style={st('font-size:11.5px;margin-bottom:8px')}>Enter the <b>fee only</b>, excluding Malaysian service tax. The service tax column is derived — it is the company’s own self-accounted liability under s.26A Service Tax Act 2018 and is <b>not</b> part of the withholding base.</div>
        <div className="tbl-wrap"><table className="bigtable">
          <thead><tr><th></th><th style={st('min-width:130px')}>Payment date</th><th>Receipt no</th><th>Description</th>
            {/* app.html:3438 writes TWO style= attributes here; a parser keeps the first. See the header. */}
            <th className="amt" style={st('text-align:right')}>Fee (RM)</th><th className="amt" style={st('text-align:right')}>SST</th><th className="amt" style={st('text-align:right')}>Fee + SST</th><th></th></tr></thead>
          <tbody>
            {(props.lines || []).map((l, i) => {
              const a = Number(l.amount) || 0;
              return (
                <tr key={i}>
                  <td className="muted" style={st('width:26px')}>{i + 1}</td>
                  <td><input type="date" id={'wl_d' + i} defaultValue={l.payment_date || ''} onInput={(e) => props.onLineField(i, 'payment_date', (e.target as HTMLInputElement).value)} style={st(CS)} /></td>
                  <td><input id={'wl_r' + i} defaultValue={l.receipt_no || ''} placeholder="Receipt / invoice no" onInput={(e) => props.onLineField(i, 'receipt_no', (e.target as HTMLInputElement).value)} style={st(CS)} /></td>
                  <td><input id={'wl_x' + i} defaultValue={l.description || ''} placeholder="Description" onInput={(e) => props.onLineField(i, 'description', (e.target as HTMLInputElement).value)} style={st(CS)} /></td>
                  <td><input id={'wl_a' + i} type="number" step="0.01" min="0" defaultValue={a || ''} onInput={(e) => props.onLineField(i, 'amount', (e.target as HTMLInputElement).value)} style={st(CS + ';text-align:right')} /></td>
                  <td className="amt muted" style={st('text-align:right')} id={'wl_s' + i}>{whtMoney(whtLineSst(a, d.sst_rate))}</td>
                  <td className="amt" style={st('text-align:right')} id={'wl_t' + i}>{whtMoney(whtLineTotal(a, d.sst_rate))}</td>
                  <td><button className="btn xs d" onClick={() => props.onDelLine(i)}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr style={st('font-weight:700;border-top:2px solid var(--border,#243040)')}><td colSpan={4}>Subtotal</td>
            <td className="amt" style={st('text-align:right')} id="w_fee">{whtMoney(c.fee)}</td>
            <td className="amt" style={st('text-align:right')} id="w_sstt">{whtMoney(c.sst)}</td>
            <td className="amt" style={st('text-align:right')} id="w_incl">{whtMoney(c.feeInclSst)}</td><td></td></tr></tfoot>
        </table></div>
      </div>

      <div className="panel" style={st('margin-bottom:14px')}>
        <div className="panel-hd"><h3>Computation</h3></div>
        <table className="bigtable" style={st('max-width:560px')}><tbody>
          <tr><td>Fee subject to withholding{d.basis === 'net' ? <> <span className="muted">(before gross-up)</span></> : null}</td>
            <td className="amt" style={st('text-align:right')} id="w_grossbase">{whtMoney(c.fee)}</td></tr>
          {d.basis === 'net'
            ? <tr><td>Grossed-up amount <span className="muted">{'÷ (1 − ' + ratePct + '%)'}</span></td>
                <td className="amt" style={st('text-align:right')} id="w_gross">{whtMoney(c.gross)}</td></tr>
            : <tr style={st('display:none')}><td></td><td id="w_gross">{whtMoney(c.gross)}</td></tr>}
          <tr><td>WHT rate</td><td className="amt" style={st('text-align:right')}>{ratePct + '%'}</td></tr>
          <tr style={st('font-weight:700')}><td>Withholding tax</td><td className="amt" style={st('text-align:right')} id="w_wht">{whtMoney(c.wht)}</td></tr>
          <tr><td><label style={st('display:inline-flex;gap:6px;align-items:center')}>
            <input type="checkbox" id="w_pen" defaultChecked={!!d.penalty_on} onChange={(e) => props.onField('penalty_on', (e.target as HTMLInputElement).checked)} /> Late — add the 10% increase <span className="muted">s.109(2)</span></label></td>
            <td className="amt" style={st('text-align:right')} id="w_pena">{whtMoney(c.penalty)}</td></tr>
          {/* app.html:3449 writes TWO style= attributes on this cell; the coral colour is the second and
              has never reached the DOM. See the header. */}
          <tr style={st('font-weight:700;border-top:2px solid var(--border,#243040)')}><td>Total payable to LHDN</td>
            <td className="amt" style={st('text-align:right')} id="w_total">{whtMoney(c.total)}</td></tr>
          <tr><td className="muted">Net remitted to the payee</td><td className="amt muted" style={st('text-align:right')} id="w_netpay">{whtMoney(c.netToPayee)}</td></tr>
        </tbody></table>
        {due
          ? <div className="muted" style={st('font-size:11.5px;margin-top:10px')}>{'Remittance due '}<b>{due}</b>{' — one month after the last payment date. Form ' + whtFormNo(d.wht_type) + ', paid via ByrHASiL / e-TT.'}</div>
          : null}
      </div>

      <div className="panel">
        <Field label="Notes">
          <input id="w_notes" defaultValue={d.notes || ''} placeholder="Anything the tax agent should know"
            onInput={(e) => props.onField('notes', (e.target as HTMLInputElement).value)} style={st(S)} />
        </Field>
        <div style={st('display:flex;gap:8px;margin-top:12px;flex-wrap:wrap')}>
          <button className="btn p sm" onClick={() => props.onSave('draft')}>💾 Save draft</button>
          <button className="btn sm" onClick={() => props.onSave('final')}>✓ Mark final</button>
          <button className="btn sm" onClick={props.onPrint}>🖨 Print / PDF</button>
          {d.id ? <button className="btn sm d" style={st('margin-left:auto')} onClick={props.onDelete}>Delete</button> : null}
        </div>
      </div>
    </>
  );
}
