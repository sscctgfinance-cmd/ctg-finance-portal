// Finance OS · Quick Invoice — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.qinv.html` was captured from `renderQinv()` (app.html:3356) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts,
// tests/parity.ts or tests/handlers.ts.
//
// ── NO SEVENTH RELAXATION ─────────────────────────────────────────────────────────────────────────
// This reuses ./parity.ts's six UNCHANGED and adds no screen-local rule either — the second Finance
// screen and the eighteenth overall to do so. The one thing that looked like it would need one did not:
// the legacy writes `don\'t post` as a literal apostrophe and React's text escaper emits `&#x27;`,
// which is exactly what R6 exists to decode. `catches the Test-mode label being reworded` below moves
// that string to prove the comparison is still reading it.
//
// ── WHAT THE GOLDEN DOES NOT REACH, and how each is covered instead ───────────────────────────────
// The golden is a BLANK FORM: no line rows, `#qi_out` empty, `#qi_contacts` empty. Everything an
// operator actually types is outside it. So this file does three things the diff cannot:
//   1. pins the DOM contract (`qi_*` ids and `.qi-*` classes) against app.html's own text at run time,
//      because that is what `qiCollect()` reads a filled form back out by;
//   2. pins `collect()` — the rule deciding which typed lines become invoice lines;
//   3. pins `invoiceBody()` and the preview's arithmetic, which are what reach Xero and the customer.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { COMPANIES } from '../../tests/render_fixtures';
import FinanceQinv, {
  collect, fmtDate, invoiceBody, qinvReachable, todayLocalISO,
  type PreviewData, type QinvMeta, type RawLine,
} from '../src/finance-qinv';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `#qinv` is the tab div `render('qinv')` writes into (app.html:1160). The golden's only section. */
const GOLDEN = goldenSection('finance.qinv', 'qinv');

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');

/** `inv_meta`'s answer. There is no fixture for it — `renderQinv()` never calls it; `qiMeta()` does. */
const META: QinvMeta = {
  contacts: [{ name: 'ACME RETAIL SDN BHD', contact_id: 'c-acme' }, { name: 'BETA PHARMACY', contact_id: 'c-beta' }],
  items: [{ name: 'Serum 30ml', code: 'SKU-30', description: 'Serum 30ml', price: 89.9, account: '500-0100' }],
  accounts: [{ code: '500-0100', name: 'Retail Sales (O2O)' }, { code: '500-0200', name: 'Wholesale' }],
};

const noop = () => {};

type Props = Parameters<typeof FinanceQinv>[0];

function screen(over: Partial<Props> = {}) {
  return (
    <FinanceQinv
      companies={COMPANIES}
      // As the harness captured it: `QINV_META` is `{contacts:[],accounts:[],items:[]}` (app.html:3355)
      // and `render('qinv')` runs no `inv_meta` call, so every dropdown is at its placeholder.
      meta={{}}
      // ZERO, and that is the finding worth stating rather than working around: `renderQinv()` DOES call
      // `qiAddLine()` (app.html:3369), but that appends the row with `appendChild`, and the golden
      // harness records innerHTML writes to elements with ids. So `#qi_lines` reached the golden empty
      // while an operator always sees one row. The row markup is mirrored from app.html:4646 and is
      // covered by the DOM-contract block below, not by the diff.
      lines={0}
      out={null}
      onMeta={noop}
      onAddLine={noop}
      onPreview={noop}
      onCreate={noop}
      onRemoveLine={noop}
      onFillProduct={noop}
      onBackToEdit={noop}
      onPrintPdf={noop}
      {...over}
    />
  );
}

const rendered = (over: Partial<Props> = {}) => relax(renderToStaticMarkup(screen(over)));

describe('Finance Quick Invoice — React vs the legacy golden', () => {
  it('renders the same document as renderQinv() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same controls, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * EVERY handler in this golden is argument-free — `qiMeta()`, `qiAddLine()`, `qiPreview()`,
 * `qiCreate()` — so argument parity alone cannot tell any of them apart and "👁 Preview invoice"
 * posting a live invoice to Xero would pass. That is the `hr.profile` shape, and it gets the treatment
 * CLAUDE.md prescribes for it, COPIED here rather than pushed into the shared ./handlers.ts:
 *
 *   • `LEGACY_TO_PROP` — a map DERIVED FROM THE GOLDEN'S OWN TEXT from the legacy function name to the
 *     prop it became, compared as a sequence.
 *   • the guard-the-guard is "every golden handler name resolved to a known prop", NOT
 *     `want.some(args.length > 0)` — that clause is unsatisfiable on a screen with no arguments
 *     anywhere, and a passing-because-unsatisfiable guard is not a guard. This spelling also fails if
 *     someone adds a legacy button and forgets the map, instead of falling through `?? h.raw`.
 *
 * No `identArgs()` widening: this screen has no row ids at all. `goldenHandlers().args` is `[]` on
 * every handler here and that is the truth, not an extraction gap.
 */
const LEGACY_TO_PROP: Record<string, string> = {
  'qiMeta()': 'meta',
  'qiAddLine()': 'addLine',
  'qiPreview()': 'preview',
  'qiCreate()': 'create',
};

const propFor = (raw: string) => LEGACY_TO_PROP[raw] ?? raw;

function assertHandlerParity(over: Partial<Props> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args
        .filter((a) => (typeof a === 'string' || typeof a === 'number') && a !== STUB_VALUE)
        .map(String),
    });
  misfire = record('misfire');

  const got = reactHandlers(screen({
    onMeta: record('meta') as never,
    onAddLine: record('addLine') as never,
    onPreview: record('preview') as never,
    onCreate: record('create') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard: if the golden ever stops carrying handlers, or grows one this map does not know,
  // the assertions above go quiet and R1 becomes the blind strip it is not allowed to be.
  expect(want.length).toBeGreaterThan(0);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

describe('the comparison still bites', () => {
  // This SCREEN's real risks. Every one of them ends as a document a customer receives or an entry in
  // someone's Xero ledger, so they are named as the wrong invoice they produce.
  const want = relax(GOLDEN);

  it('catches a company dropped out of the picker', () => {
    // Invoicing from the wrong Xero tenant is a receivable booked in the wrong company's books.
    expect(rendered({ companies: COMPANIES.slice(0, 1) })).not.toBe(want);
  });

  it('catches a company renamed or re-pointed at another tenant id', () => {
    expect(rendered({ companies: [{ ...COMPANIES[0], tenant_name: 'SKINDAE HOLDINGS' }, COMPANIES[1]] })).not.toBe(want);
    expect(rendered({ companies: [{ ...COMPANIES[0], tenant_id: COMPANIES[1].tenant_id }, COMPANIES[1]] })).not.toBe(want);
  });

  it('catches the Test-mode default flipping to LIVE', () => {
    // `checked` on #qi_test is what stands between a preview and a real invoice in Xero. R4 normalises
    // its SPELLING (`checked` vs `checked=""`), never its presence — this proves that.
    expect(relax(renderToStaticMarkup(screen()).replace(' checked=""', ''))).not.toBe(want);
  });

  it('catches the Test-mode label being reworded — the R6 apostrophe is really compared', () => {
    // The legacy writes a literal `'`; React emits `&#x27;`; R6 decodes both. If R6 were doing more than
    // that, this would still pass.
    expect(relax(renderToStaticMarkup(screen()).replace('don&#x27;t post', 'do not post'))).not.toBe(want);
  });

  it('catches a line row appearing — the branch no golden holds', () => {
    // Proves the golden really is the pre-qiAddLine state, so the row markup is genuinely untested by
    // the diff rather than accidentally included in it.
    expect(rendered({ lines: 1 })).not.toBe(want);
  });

  it('catches anything at all landing in #qi_out', () => {
    expect(rendered({ out: { kind: 'loading', text: 'Working…' } })).not.toBe(want);
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=` from the string comparison, so every one of these is invisible to the diff above.

  it('catches "👁 Preview invoice" posting to Xero instead', () => {
    // The defect this screen cannot afford: the safe button doing the irreversible thing. Both are
    // argument-free, so only LEGACY_TO_PROP can see it.
    expect(() => assertHandlerParity({ onPreview: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches "+ Add line" wired to the company loader', () => {
    expect(() => assertHandlerParity({ onAddLine: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches the company picker gaining an argument it never had', () => {
    expect(() => assertHandlerParity({ onMeta: (() => misfire('qinv')) as never })).toThrow(/deeply equal/);
  });
});

describe('the feature gate — app.html:1434', () => {
  // The withheld direction, asserted. Quick Invoice is named NOWHERE in `showApp()`'s if/else chain, so
  // it falls through to the final `else` and the gate is the FEATURE flag, not `manage_users`.
  it('opens for a login whose features include qinv', () => {
    expect(qinvReachable({ features: ['overview', 'qinv'] })).toBe(true);
  });

  it('is closed for every other shape of permission, including a missing one', () => {
    for (const p of [null, undefined, {}, { features: [] }, { features: null }, { features: ['overview', 'pnl'] }]) {
      expect(qinvReachable(p as never)).toBe(false);
    }
  });

  it('is NOT the admin gate — manage_users alone does not open it', () => {
    // The trap this screen sits next to: `wht`, `selfbill`, `gateway`, `bankfeed` and `salesrecon` ARE
    // `!canManage`, and copying that line here would hand Quick Invoice to every administrator whether
    // or not the feature is licensed to their login — and hand it away from a non-admin who has it.
    expect(qinvReachable({ manage_users: true } as never)).toBe(false);
  });

  it('is what the route gates on — the screen renders the Xero tenant ids and the price list', () => {
    // Guard the guard: if the props stopped carrying what the gate exists to protect, the assertions
    // above would be about nothing.
    const html = renderToStaticMarkup(screen({ meta: META, lines: 1 }));
    expect(html).toContain(COMPANIES[0].tenant_id);     // a live Xero tenant id
    expect(html).toContain('ACME RETAIL SDN BHD');      // the customer list
    expect(html).toContain('RM 89.90');                 // the product price list
    expect(html).toContain('500-0100 · Retail Sales (O2O)');  // the revenue account codes
  });
});

describe('the DOM contract — the ids and classes qiCollect() reads a filled form back out by', () => {
  // No golden holds a filled form, so this is the contract that actually governs it, extracted from
  // app.html at run time rather than retyped: a retyped list agrees with a widened port by construction.
  // A field that loses its id or its class collects as blank — which on this screen is a line silently
  // missing from an invoice, or a quantity read as 0 and the line refused.
  const collectSrc = APP.slice(APP.indexOf('function qiCollect()'), APP.indexOf('function qiAccountLabel'));
  const createSrc = APP.slice(APP.indexOf('async function qiCreate()'), APP.indexOf('/* ---- P&L Analysis'));
  const ids = [...new Set([...(collectSrc + createSrc).matchAll(/getElementById\('(qi[_-][a-z]+)'\)/g)].map((m) => m[1]))];
  const classes = [...new Set([...collectSrc.matchAll(/querySelector\('\.(qi-[a-z]+)'\)/g)].map((m) => m[1]))];
  const html = renderToStaticMarkup(screen({ meta: META, lines: 2 }));

  it('finds the ids and classes in the legacy read path at all', () => {
    expect(ids).toEqual(expect.arrayContaining(['qi_co', 'qi_cust', 'qi_date', 'qi_due', 'qi_ref', 'qi_test']));
    expect(classes.slice().sort()).toEqual(['qi-acct', 'qi-amt', 'qi-desc', 'qi-qty']);
  });

  for (const id of ids) it(`renders #${id}`, () => expect(html).toContain(`id="${id}"`));
  for (const c of classes) {
    it(`renders .${c} on every row`, () => {
      expect(html.split(`class="${c}"`).length - 1).toBe(2);   // one per row, both rows
    });
  }

  it('keeps #qi_lines the direct-children container qiCollect() enumerates', () => {
    // `querySelectorAll('#qi_lines > div')` — DIRECT children. A wrapper div per row would make every
    // row collect as blank and every invoice come out empty, with no error anywhere.
    expect(collectSrc).toContain("'#qi_lines > div'");
    const inner = html.slice(html.indexOf('id="qi_lines"'));
    expect(inner.slice(0, inner.indexOf('+ Add line')).split('<div style="display:grid').length - 1).toBe(2);
  });

  it("defaults a new row's quantity to 1, as the legacy attribute does", () => {
    // app.html:4650 writes `value="1"`. Without it a fresh row reads qty '' → the row is either dropped
    // as blank or refused as invalid, and neither is what the operator sees on screen.
    expect(APP).toContain('placeholder="Qty" value="1"');
    expect(html).toContain('value="1"');
  });
});

describe('collect() — which typed lines become invoice lines', () => {
  const rows = (...r: Partial<RawLine>[]): RawLine[] =>
    r.map((x) => ({ description: '', qty: '', amount: '', account_code: '500-0100', ...x }));
  const base = { tenant: COMPANIES[0].tenant_id, customer: 'ACME RETAIL SDN BHD', contacts: META.contacts };

  it("binds each row's quantity and rate to its OWN line, in order", () => {
    // The mis-binding the brief names: two rows whose numbers swap places is a customer billed 3 × the
    // expensive item and 1 × the cheap one. Deliberately values that would still total the same.
    const r = collect({ ...base, rows: rows({ description: 'A', qty: '3', amount: '10' }, { description: 'B', qty: '1', amount: '30' }) });
    expect(r.errors).toEqual([]);
    expect(r.lines).toEqual([
      { description: 'A', quantity: 3, unit_amount: 10, account_code: '500-0100' },
      { description: 'B', quantity: 1, unit_amount: 30, account_code: '500-0100' },
    ]);
  });

  it('ignores a wholly blank row silently', () => {
    const r = collect({ ...base, rows: rows({ description: 'A', qty: '1', amount: '10' }, { account_code: '' }) });
    expect(r.errors).toEqual([]);
    expect(r.lines).toHaveLength(1);
  });

  it('REFUSES a half-filled row rather than dropping it', () => {
    // The whole point of `partials`. A row with a description and no amount must not quietly vanish off
    // an invoice — that is money not billed, and nothing on screen would say so.
    const r = collect({ ...base, rows: rows({ description: 'Consulting', qty: '1', amount: '' }) });
    expect(r.lines).toEqual([]);
    expect(r.errors).toContain('1 line(s) have invalid quantity or amount — fix or clear them');
  });

  it('REFUSES a zero or negative quantity or amount, and a non-numeric one', () => {
    for (const bad of [{ qty: '0' }, { qty: '-1' }, { amount: '0' }, { amount: '-5' }, { amount: 'abc' }]) {
      const r = collect({ ...base, rows: rows({ description: 'X', qty: '1', amount: '10', ...bad }) });
      expect(r.lines).toEqual([]);
      expect(r.errors.join(' ')).toContain('invalid quantity or amount');
    }
  });

  it('REFUSES a line with no revenue account', () => {
    // Xero would post it to the default account and the revenue lands in the wrong place, invisible
    // until someone reads the P&L.
    const r = collect({ ...base, rows: rows({ description: 'A', qty: '1', amount: '10', account_code: '' }) });
    expect(r.errors).toContain('1 line(s) have no account selected');
  });

  it('defaults an empty description to "Item", never to blank', () => {
    expect(collect({ ...base, rows: rows({ qty: '2', amount: '5' }) }).lines[0].description).toBe('Item');
  });

  it('refuses an invoice with no company, no customer, or no lines', () => {
    expect(collect({ ...base, tenant: '', rows: rows({ qty: '1', amount: '1' }) }).errors).toContain('Pick a company');
    expect(collect({ ...base, customer: '  ', rows: rows({ qty: '1', amount: '1' }) }).errors).toContain('Enter a customer');
    expect(collect({ ...base, rows: [] }).errors).toContain('Add a line with quantity & amount');
  });

  it('matches an existing Xero contact case-insensitively, on the TRIMMED name', () => {
    // A false miss creates a duplicate customer in Xero; a false hit bills the wrong one.
    expect(collect({ ...base, customer: '  acme retail sdn bhd  ', rows: rows({ qty: '1', amount: '1' }) }).contactMatch?.contact_id).toBe('c-acme');
    expect(collect({ ...base, customer: 'ACME RETAIL', rows: rows({ qty: '1', amount: '1' }) }).contactMatch).toBeUndefined();
  });
});

describe('the quick_invoice POST body — no golden sees a request', () => {
  const f = {
    tenant: COMPANIES[0].tenant_id, customer: 'ACME RETAIL SDN BHD',
    lines: [{ description: 'A', quantity: 2, unit_amount: 10, account_code: '500-0100' }],
    date: '2026-08-21', due: '2026-09-20', ref: 'PO-991', test: true,
  };

  it('sends contact_id for a matched contact and contact_name for a new one — never both', () => {
    const matched = invoiceBody({ ...f, contactMatch: { contact_id: 'c-acme' } });
    expect(matched.contact_id).toBe('c-acme');
    expect(matched).not.toHaveProperty('contact_name');
    const fresh = invoiceBody(f);
    expect(fresh.contact_name).toBe('ACME RETAIL SDN BHD');
    expect(fresh).not.toHaveProperty('contact_id');
  });

  it('omits an empty due date and reference rather than sending blanks', () => {
    const b = invoiceBody({ ...f, due: '', ref: '' });
    expect(b.due_date).toBeUndefined();
    expect(b.reference).toBeUndefined();
  });

  it('carries dry_run as the Test-mode checkbox, and it is a BOOLEAN', () => {
    // `finance.ts:780` is `if (b.dry_run !== false)` — it posts for real only on a literal `false`. A
    // truthy-string port would be safe; a MISSING dry_run is also safe. What is not safe is the reverse,
    // so both directions are pinned.
    expect(invoiceBody({ ...f, test: true }).dry_run).toBe(true);
    expect(invoiceBody({ ...f, test: false }).dry_run).toBe(false);
  });

  it('carries exactly the fields qiCreate() sends, and no others', () => {
    // Read out of app.html at run time rather than retyped: an extra field on this body is something the
    // legacy screen never let anyone put on an invoice.
    // The literal AND the two conditional `body.contact_*` assignments below it — the contact key is
    // added after the object is built, so slicing at the first `};` would miss exactly the field this
    // body most needs to get right.
    const at = APP.indexOf("var body={api:'quick_invoice'");
    expect(at).toBeGreaterThan(0);
    const src = APP.slice(at, APP.indexOf("document.getElementById('qi_out')", at));
    const legacy = [...new Set([
      ...[...APP.slice(at, APP.indexOf('};', at)).matchAll(/([a-z_]+)\s*:/g)].map((m) => m[1]),
      ...[...src.matchAll(/body\.([a-z_]+)\s*=/g)].map((m) => m[1]),
    ])].sort();
    expect(legacy).toContain('contact_name');
    // `invoiceBody()` sets exactly one contact key per call, as the legacy if/else does; the union of
    // both calls is what the legacy source lists.
    const keys = [...new Set([...Object.keys(invoiceBody(f)), ...Object.keys(invoiceBody({ ...f, contactMatch: { contact_id: 'c' } }))])].sort();
    expect(keys).toEqual(legacy);
  });
});

describe('the invoice the customer receives — the preview', () => {
  const d = (over: Partial<PreviewData> = {}): PreviewData => ({
    companyName: 'SKINDAE SDN BHD', customer: 'ACME RETAIL SDN BHD', contactMatch: true,
    lines: [
      { description: 'Serum 30ml', quantity: 3, unit_amount: 89.9, account_code: '500-0100' },
      { description: 'Delivery', quantity: 2, unit_amount: 12.5, account_code: '500-0200' },
    ],
    date: '2026-08-21', due: '2026-09-20', ref: 'PO-991', test: true, stamp: '2026-08-21', ...over,
  });
  const pv = (over: Partial<PreviewData> = {}) =>
    renderToStaticMarkup(screen({ meta: META, out: { kind: 'preview', data: d(over) } }));

  it('extends each line at its OWN quantity × its OWN unit price', () => {
    // 3 × 89.90 = 269.70 and 2 × 12.50 = 25.00. Asserted on the Amount CELL, not on the bare figure:
    // `12.50` also appears as row 2's UNIT PRICE, so a row extended at another row's rate would still
    // "contain" it and this would pass. The quantities are deliberately chosen so that no two cells on
    // the paper carry the same number and every extension is unique to its row.
    const html = pv();
    expect(html).toContain('font-size:13px">269.70</td>');
    expect(html).toContain('font-size:13px">25.00</td>');
    // A row extended at row 1's rate would put 179.80 here; a row extended at its own qty but the
    // wrong price would put 89.90. Neither may appear as an Amount cell.
    expect(html).not.toContain('font-size:13px">179.80</td>');
    expect(html).not.toContain('font-size:13px">89.90</td></tr>');
  });

  it('CASTS: the total tracks the lines, it is not transcribed', () => {
    // The defect class: a total that stops agreeing with the rows above it. Add exactly 100.00 of line
    // and the subtotal must move by exactly 100.00.
    expect(pv()).toContain('294.70');                               // 269.70 + 25.00
    const more = pv({ lines: [...d().lines, { description: 'Extra', quantity: 4, unit_amount: 25, account_code: '500-0100' }] });
    expect(more).toContain('394.70');
    // and the same figure lands in BOTH the Subtotal and the TOTAL rows, as the legacy writes it.
    expect(more.split('394.70').length - 1).toBe(2);
  });

  it('prints money to the sen with thousands separated, and never rounds a sen away', () => {
    const big = pv({ lines: [{ description: 'Bulk', quantity: 137, unit_amount: 89.9, account_code: '500-0100' }] });
    expect(big).toContain('12,316.30');
    expect(big).not.toContain('12,316.3<');
  });

  it('shows Total Tax as the literal 0.00 the legacy writes — this screen posts tax-exclusive lines', () => {
    // Pinned as literal on purpose. If someone later makes it a computed field, this fails and they have
    // to say so, rather than a tax line quietly appearing on an invoice that never had one.
    expect(APP).toContain('>Total Tax</td>');
    expect(pv()).toContain('Total Tax');
    expect(pv()).toContain('Amounts are tax exclusive');
    expect(pv()).toContain('>0.00<');
  });

  it('drops a line out of the paper if it is dropped out of the data', () => {
    expect(pv({ lines: [d().lines[0]] })).not.toContain('Delivery');
  });

  it('names the revenue account per line, and flags a line that has none', () => {
    expect(pv()).toContain('500-0200 · Wholesale');
    expect(pv({ lines: [{ ...d().lines[0], account_code: '' }] })).toContain('⚠ no account');
  });

  it('says LIVE, not TEST, when Test mode is off', () => {
    // The banner is the last thing between an operator and a real Xero invoice.
    expect(pv({ test: true })).toContain('TEST mode');
    expect(pv({ test: false })).toContain('confirming will create this invoice in Xero');
    expect(pv({ test: false })).not.toContain('TEST mode');
  });

  it('omits the Due Date and Reference rows when they are blank, as the legacy does', () => {
    // Scoped to the paper: "Reference" is also the FORM's own field label, which is always there.
    expect(pv()).toContain('>Reference</td>');
    expect(pv({ due: '', ref: '' })).not.toContain('>Reference</td>');
    expect(pv({ due: '', ref: '' })).not.toContain('>Due Date</td>');
    expect(pv({ due: '', ref: '' })).toContain('Due Date: —');
  });
});

describe("the invoice date — todayLocalISO() is Malaysia time, not the browser's", () => {
  // app.html:1258 adds 8h and reads the UTC parts. Getting this wrong dates an invoice into the wrong
  // day and, at a month end, the wrong revenue period and the wrong Xero aging bucket. Pinned as a pure
  // function of an instant so the boundary is testable rather than a matter of where the machine is.
  const at = (iso: string) => todayLocalISO(Date.parse(iso));

  it('is already the next day in KL at 16:00 UTC', () => {
    expect(at('2026-08-21T15:59:59Z')).toBe('2026-08-21');
    expect(at('2026-08-21T16:00:00Z')).toBe('2026-08-22');
  });

  it('rolls the month and the year on the KL boundary, not the UTC one', () => {
    expect(at('2026-08-31T16:00:00Z')).toBe('2026-09-01');
    expect(at('2026-12-31T16:00:00Z')).toBe('2027-01-01');
  });

  it('zero-pads, so the value is one an <input type="date"> accepts', () => {
    expect(at('2026-01-05T00:00:00Z')).toBe('2026-01-05');
  });

  it('reads the clock nowhere — the same instant always gives the same date', () => {
    expect(todayLocalISO(0)).toBe(todayLocalISO(0));
    expect(todayLocalISO(0)).toBe('1970-01-01');
  });

  it('fmtDate names the same day the ISO string does', () => {
    expect(fmtDate('2026-08-21')).toBe('21 Aug 2026');
    expect(fmtDate('2026-01-01')).toBe('1 Jan 2026');
    expect(fmtDate('')).toBe('');
  });
});
