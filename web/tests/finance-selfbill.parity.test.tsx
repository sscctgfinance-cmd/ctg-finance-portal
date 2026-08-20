// Finance OS · Personal (Self-Billed) Invoices — the React screen against the legacy screen's golden.
//
// `tests/golden/finance.selfbill.html` was captured from `renderSelfbill()` (app.html:4237) by the
// 40-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts, tests/parity.ts or tests/handlers.ts. The component is rendered with
// `renderToStaticMarkup` from the SAME fixture the golden was captured from — tests/render_fixtures.ts,
// imported directly — normalised by the harness's own normalise(), relaxed by the documented layer in
// ./parity.ts, and compared.
//
// NO SEVENTH RELAXATION IN ./parity.ts. One screen-local rule, `decodeRefs`, of a kind two shipped
// screens already carry: hr-payroll's `decodeNamedRefs` (`&ldquo;`/`&rdquo;`/`&rsquo;`) and
// finance-bankfeed's `decodeNumericRefs` (`&#8599;`). This screen needs BOTH kinds in one comparison —
// `&rsquo;`, `&mdash;`, `&ldquo;`, `&rdquo;` and `&rarr;` written into the HTML string (app.html:4249,
// :4258) alongside the numeric `&#8635;` on the Sync PDF button — so they are one function here rather
// than two. React's text escaper emits only `& < > " '` as references: a `’` in JSX comes out as the
// character and the literal string `"&rsquo;"` comes out as `&amp;rsquo;`, so neither side can be
// spelled into the other. It is applied to BOTH sides, held to parity.ts's bar, and has its own
// "cannot hide" block below. NOT moved into parity.ts: that file is shared with three in-flight sibling
// migrations, and CLAUDE.md already names folding ONE reference-decoding rule in as a change to make
// once they land.
//
// ── ASYNC: WHAT THE GOLDEN ACTUALLY HOLDS, CHECKED RATHER THAN ASSUMED ────────────────────────────
// `renderSelfbill()` writes `#selfbill` TWICE — a `Loading…` panel, then `sbiRender()`'s real screen.
// CLAUDE.md's `finance.qinv` warning is that a golden can hold an INTERMEDIATE state, so both were read
// to the end and the check is an ASSERTION against app.html's own text below (`the golden is the screen
// an operator sees`), not a claim: `sbiRender()` does nothing after its `el.innerHTML=`.
//
// ── THIS SCREEN MOVES MONEY OUT OF THE BUSINESS ──────────────────────────────────────────────────
// Self-billing means the company raises the supplier's invoice for them, so every row here ends in a
// payment. R1 strips `on*=` from the string diff, so a View bound to another invoice, a `→ Xero` that
// posts a second bill when it meant to re-sync a PDF, and an Approve on the wrong draft are all
// invisible above and are caught only by handler parity. That is why this file's mis-wire cases carry
// the weight.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { COMPANIES, FIXTURES } from '../../tests/render_fixtures';
import FinanceSelfbill, {
  invoiceBody, invoiceDocHtml, lineAmount, payeeBody, recalc, saveRefusal, sbiShort,
  selfbillReachable, type Company, type InvoiceForm, type InvoiceRow, type Payee, type PayeeForm,
} from '../src/finance-selfbill';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `#selfbill` is the tab div `render('selfbill')` writes into — the golden's ONLY section. */
const GOLDEN = goldenSection('finance.selfbill', 'selfbill');

const PAYEES = (FIXTURES.individuals_list as { individuals: Payee[] }).individuals;
const LIST = (FIXTURES.sbi_list as { invoices: InvoiceRow[] }).invoices;
const COS = COMPANIES as Company[];

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');

const noop = () => {};

type Props = Parameters<typeof FinanceSelfbill>[0];

function screen(over: Partial<Props> = {}) {
  // The state the harness captured: both calls resolved, `SBI.showPayees===false`, `SBI.editId===null`.
  return (
    <FinanceSelfbill
      companies={COS} payees={PAYEES} list={LIST}
      showPayees={false} payeeForm={null} form={null} editId={null}
      lines={[]} accounts={[]} whtType="none" customRate=""
      onTogglePayees={noop} onNewInvoice={noop}
      onView={noop} onEdit={noop} onApprove={noop} onPostXero={noop} onVoid={noop}
      onPayeeForm={noop} onDeletePayee={noop} onSavePayee={noop} onClosePayeeForm={noop}
      onCloseForm={noop} onPickCompany={noop} onPickPayee={noop} onPtypeChange={noop}
      onClassTouched={noop} onWhtChange={noop} onLineChange={noop} onAddLine={noop}
      onRmLine={noop} onSave={noop}
      {...over}
    />
  );
}

/**
 * The one screen-local rule. Named references FIRST, then numeric — order matters only in that neither
 * may produce a reference the other then re-decodes, which is what the `cannot hide` block proves.
 *
 * `&amp;` is deliberately NOT decoded: the legacy writes `&amp;` for the ampersand in "tax &amp; audit
 * format" and React's escaper emits `&amp;` for the same character, so both sides already agree and
 * decoding it would only make the doubly-escaped defect (`&amp;rsquo;` printing on the page) invisible.
 */
function decodeRefs(html: string): string {
  return html
    .replace(/&rsquo;/g, '’').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&mdash;/g, '—').replace(/&rarr;/g, '→')
    .replace(/&#(\d+);|&#[xX]([0-9a-fA-F]+);/g, (_m, dec: string, hex: string) =>
      String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16)));
}

/** Both sides read as the same document, then compared under ./parity.ts's six relaxations. */
const sameDocument = (html: string) => relax(decodeRefs(html));

const rendered = (over: Partial<Props> = {}) => sameDocument(renderToStaticMarkup(screen(over)));

describe('Finance Personal Invoices — React vs the legacy golden', () => {
  it('renders the same document as sbiRender() does', () => {
    expect(rendered()).toBe(sameDocument(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * TWO established local widenings, both COPIED here rather than pushed into the shared ./handlers.ts
 * which sibling migrations share, and ONE addition this screen is the first to need.
 *
 *  • `identArgs()` for BARE INTEGERS. Every row button on this screen is `sbiView(11)`, `sbiEdit(12)`,
 *    `sbiApprove(12)`, `sbiVoid(12)` — the invoice id and nothing else. `goldenHandlers()` collects
 *    QUOTED literals, so quoted-only extraction returns `[]` for every one of them and the check would
 *    pass with all nine buttons pointed at the same invoice. Ninth screen to need it.
 *
 *  • `LEGACY_TO_PROP` for the ARGUMENT-FREE buttons. `+ New self-billed invoice` is `sbiNewInvoice()`
 *    and the Payees toggle is an inline STATEMENT (`SBI.showPayees=!SBI.showPayees;sbiRender()`), so
 *    the map is keyed on the whole raw text first — finance-wht's shape, because app.html writes
 *    several such statements where hros.html writes almost none.
 *
 *  • NEW, and the reason it is here: `identArgs()` also keeps a BARE `true`/`false`. Both Xero buttons
 *    are `sbiPostXero(id, posted)` and the flag is the whole difference between POSTING A SECOND BILL
 *    to Xero and merely re-attaching a PDF to the one already there (app.html:4420 branches the
 *    confirmation text on it, and `sbi_post_xero` skips the create when the bill exists). Integer-only
 *    extraction would read both as `['11']` and a `→ Xero` that passed `true` — or a Sync PDF that
 *    passed `false` — would go unchecked. This is a strict widening of the shared default: it can only
 *    add arguments to compare, never remove one, and it is proved by a case below.
 */
function identArgs(raw: string): string[] {
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|\b(-?\d+)\b|\b(true|false)\b/g)]
    .map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]);
}

const LEGACY_TO_PROP: Record<string, string> = {
  'SBI.showPayees=!SBI.showPayees;sbiRender()': 'togglePayees',
  sbiNewInvoice: 'newInvoice',
  sbiView: 'view',
  sbiEdit: 'edit',
  sbiApprove: 'approve',
  sbiPostXero: 'postXero',
  sbiVoid: 'void',
};

/** The prop a golden handler stands for: keyed on the whole raw text first, then on the function name. */
const propFor = (raw: string) => LEGACY_TO_PROP[raw] ?? LEGACY_TO_PROP[raw.replace(/\(.*$/, '')] ?? raw;

function assertHandlerParity(over: Partial<Props> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args
        .filter((a) => (typeof a === 'string' || typeof a === 'number' || typeof a === 'boolean') && a !== STUB_VALUE)
        .map(String),
    });
  misfire = record('misfire');

  const got = reactHandlers(screen({
    onTogglePayees: record('togglePayees') as never,
    onNewInvoice: record('newInvoice') as never,
    onView: record('view') as never,
    onEdit: record('edit') as never,
    onApprove: record('approve') as never,
    onPostXero: record('postXero') as never,
    onVoid: record('void') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => identArgs(h.raw)));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard. `want.length > 0` alone is not enough here: two of this screen's golden handlers
  // carry no arguments at all, so the usual "every handler has an argument" assertion is unsatisfiable.
  // It is replaced — not dropped — with "every golden handler resolved to a KNOWN prop", so a legacy
  // button added later cannot fall through `propFor()`'s `?? h.raw` and pass silently.
  expect(want.length).toBeGreaterThan(0);
  expect(want.some((h) => identArgs(h.raw).length > 0)).toBe(true);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

// ── THE GOLDEN IS THE SCREEN, NOT AN INTERMEDIATE STATE ──────────────────────────────────────────

describe('the golden is the screen an operator sees — checked against app.html, not assumed', () => {
  it('sbiRender() does nothing after its innerHTML write', () => {
    // finance.qinv's trap: `renderQinv()` calls `qiAddLine()` AFTER its write, so its golden holds a
    // state no operator ever sees. `sbiRender()`'s last statement IS the write, and `renderSelfbill()`
    // only sets `loaded.selfbill` after calling it. Read out of app.html so a line added later fails
    // here rather than silently invalidating the diff above.
    const fn = APP.slice(APP.indexOf('function sbiRender(){'), APP.indexOf('// ---- Payees master ----'));
    const tail = fn.slice(fn.indexOf('el.innerHTML=head+payees'));
    expect(tail).not.toMatch(/appendChild|setTimeout|\.value\s*=|await |call\(\{/);
    expect(tail.replace(/\s/g, '')).toBe('el.innerHTML=head+payees+\'<divid="sbi_form"></div>\'+table;}');

    const outer = APP.slice(APP.indexOf('async function renderSelfbill(){'), APP.indexOf('function sbiRender(){'));
    expect(outer).toContain('sbiRender();');
    expect(outer.slice(outer.indexOf('sbiRender();') + 12)).not.toMatch(/appendChild|\.value\s*=/);
  });

  it('the golden really holds the loaded table, not the Loading… panel', () => {
    // Guard the guard for every case below: a golden that had captured the first write would make them
    // all vacuous.
    expect(GOLDEN).not.toContain('Loading…');
    expect(GOLDEN).toContain('SBI-2026-0007');
    expect((GOLDEN.match(/<tr>/g) || []).length).toBe(3); // header + two invoices
  });

  it('the golden holds NEITHER the payees panel NOR the invoice form', () => {
    // `SBI.showPayees` is false and `SBI.editId` is null after every load, so `#sbi_form` is captured
    // EMPTY. Both are ported anyway — see `the four documents no golden holds` below.
    expect(GOLDEN).toContain('<div id="sbi_form">');
    expect(GOLDEN).not.toContain('Payees (individuals)');
    expect(GOLDEN).not.toContain('sbi_save_btn');
  });
});

// ── THE COMPARISON STILL BITES ───────────────────────────────────────────────────────────────────

describe('the comparison still bites', () => {
  const want = sameDocument(GOLDEN);
  const withRow = (i: number, over: Partial<InvoiceRow>) =>
    rendered({ list: LIST.map((x, k) => (k === i ? { ...x, ...over } : x)) });

  it('catches one sen on any of the three money columns', () => {
    // Gross, WHT and net payable are the figures a payment is raised against.
    expect(withRow(0, { gross_amount: 5000.01 })).not.toBe(want);
    expect(withRow(0, { wht_amount: 100.01 })).not.toBe(want);
    expect(withRow(0, { net_payable: 4900.01 })).not.toBe(want);
  });

  it('CASTS: money is formatted to the sen, thousands separated — never a raw float', () => {
    const html = renderToStaticMarkup(screen());
    expect(html).toContain('RM 5,000.00');
    expect(html).toContain('RM 4,900.00');
    expect(html).not.toContain('>5000<');
    expect(renderToStaticMarkup(screen({ list: [{ ...LIST[0], net_payable: 1234567.891 }] }))).toContain('RM 1,234,567.89');
    expect(renderToStaticMarkup(screen({ list: [{ ...LIST[0], wht_amount: null }] }))).toContain('RM 0.00');
  });

  it('catches an invoice dropped out of the list', () => {
    // A self-billed invoice that stops being listed is an individual who does not get paid.
    expect(rendered({ list: LIST.slice(0, 1) })).not.toBe(want);
  });

  it('catches a DRAFT presenting as APPROVED — the pill is the only thing that says so', () => {
    // A draft that reads as approved is an invoice an operator believes is cleared for payment. The
    // status also drives which buttons the row carries, so both halves move.
    expect(withRow(1, { status: 'approved' })).not.toBe(want);
    expect(sameDocument(GOLDEN.replace('color:var(--muted);font-size:10px', 'color:var(--sky-soft);font-size:10px'))).not.toBe(want);
  });

  it('catches a row bound to the wrong PAYEE NAME or invoice number', () => {
    expect(withRow(0, { payee_name: 'NURUL AIN BINTI HASSAN' })).not.toBe(want);
    expect(withRow(0, { invoice_no: 'SBI-2026-0009' })).not.toBe(want);
  });

  it('catches the paying COMPANY on a row changing', () => {
    // Which company's bank account the money leaves from.
    expect(withRow(0, { tenant_id: LIST[1].tenant_id })).not.toBe(want);
  });

  it('catches the invoice date changing', () => {
    expect(withRow(1, { invoice_date: '2026-09-12' })).not.toBe(want);
  });

  it('catches an invoice already in Xero losing its "in Xero" pill and gaining Edit/Void', () => {
    // `xero_bill_id` is what stops a posted bill being edited or posted twice. Clearing it turns a
    // read-only row into an editable, re-postable one.
    expect(withRow(0, { xero_bill_id: null })).not.toBe(want);
  });

  it('catches the Sync PDF button losing its title — the only thing saying it does not re-post', () => {
    expect(sameDocument(GOLDEN.replace(/ title="Re-send[^"]*"/, ''))).not.toBe(want);
  });

  it('catches an escaping hole: server text reaches the page as text, not markup', () => {
    const html = renderToStaticMarkup(screen({ list: [{ ...LIST[0], payee_name: '<script>x</script>' }] }));
    expect(html).not.toContain('<script>');
  });

  it('catches the company-name trim being dropped or widened', () => {
    // `sbiShort()` → `cfoShortName()`; the column shows SKINDAE, not SKINDAE SDN BHD.
    expect(sbiShort('SKINDAE SDN BHD')).toBe('SKINDAE');
    expect(sbiShort('I PROCARE MALAYSIA SDN BHD')).toBe('I PROCARE MALAYSIA');
    expect(sbiShort(null)).toBe('');
    expect(GOLDEN).toContain('>SKINDAE<');
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────

  it('catches an action bound to the WRONG INVOICE', () => {
    // Approve, Void and → Xero all take an id and nothing else. On screen: nothing. In the ledger: the
    // wrong individual's invoice approved, voided or posted for payment.
    expect(() => assertHandlerParity({
      onApprove: ((_id: number) => misfire(LIST[0].id)) as never,
    })).toThrow(/deeply equal/);
    expect(() => assertHandlerParity({
      onVoid: ((id: number) => misfire(id + 1)) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches → Xero and Sync PDF swapping their POSTED flag', () => {
    // The whole point of the bare-boolean widening. `sbiPostXero(id,false)` creates a SUBMITTED bill in
    // Xero; `sbiPostXero(id,true)` only re-attaches the PDF to the bill already there. Swapping them
    // either double-posts a payable or silently does nothing where the operator expected a post — and
    // the two buttons are on different rows, so nothing on screen looks wrong.
    expect(() => assertHandlerParity({
      onPostXero: ((id: number, _p: boolean) => misfire(id, true)) as never,
    })).toThrow(/deeply equal/);
    expect(() => assertHandlerParity({
      onPostXero: ((id: number, _p: boolean) => misfire(id, false)) as never,
    })).toThrow(/deeply equal/);
  });

  it('the boolean widening really is what catches it — integer-only extraction would not', () => {
    // Guard the guard for the widening itself: without `true|false`, both Xero handlers read as one
    // argument and the case above would pass.
    const intOnly = (raw: string) => [...raw.matchAll(/'([^']*)'|"([^"]*)"|\b(-?\d+)\b/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    expect(intOnly('sbiPostXero(12,false)')).toEqual(['12']);
    expect(identArgs('sbiPostXero(12,false)')).toEqual(['12', 'false']);
    expect(identArgs('sbiPostXero(12,true)')).not.toEqual(identArgs('sbiPostXero(12,false)'));
  });

  it('catches View and Edit swapped — same argument, different act', () => {
    // Argument parity alone cannot tell `sbiView(12)` from `sbiEdit(12)`; the identity comparison can.
    // View opens a read-only document, Edit opens a form over a live payment instruction.
    expect(() => assertHandlerParity({
      onEdit: ((id: number) => misfire(id)) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches the two argument-free header buttons swapped', () => {
    // `+ New self-billed invoice` opening the payees panel, or the reverse. Neither carries an argument,
    // so only `LEGACY_TO_PROP` separates them.
    expect(() => assertHandlerParity({ onNewInvoice: (() => misfire()) as never })).toThrow(/deeply equal/);
    expect(() => assertHandlerParity({ onTogglePayees: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches a button that stopped calling anything at all', () => {
    expect(() => assertHandlerParity({ onView: (() => {}) as never })).toThrow(/deeply equal/);
  });
});

describe('decodeRefs cannot hide a real change', () => {
  // Held to ./parity.ts's own bar: it maps five named references and every numeric reference to the
  // characters they denote, and NOTHING else. Each case here fails if it ever widened.
  it('decodes exactly those references, on both sides alike', () => {
    expect(decodeRefs('a&rsquo;b&mdash;c&ldquo;d&rdquo;e&rarr;f&#8635;g')).toBe('a’b—c“d”e→f↻g');
  });

  it('leaves &amp; alone, so a doubly-escaped entity still shows up', () => {
    expect(decodeRefs('tax &amp; audit')).toBe('tax &amp; audit');
    expect(decodeRefs('&amp;rsquo;')).toBe('&amp;rsquo;');
    expect(decodeRefs('&amp;#8635;')).toBe('&amp;#8635;');
    expect(decodeRefs('&lt;b&gt;')).toBe('&lt;b&gt;');
  });

  it('does not absorb a changed number', () => {
    expect(decodeRefs('&mdash; RM 1.00')).not.toBe(decodeRefs('&mdash; RM 2.00'));
  });

  it('does not absorb a renamed label', () => {
    expect(decodeRefs('&rarr; Xero')).not.toBe(decodeRefs('&rarr; Void'));
  });

  it('does not absorb a missing attribute or a dropped element', () => {
    expect(decodeRefs('<b style="a">&rarr;</b>')).not.toBe(decodeRefs('<b>&rarr;</b>'));
    expect(decodeRefs('<b>&rarr;</b><i>x</i>')).not.toBe(decodeRefs('<b>&rarr;</b>'));
  });

  it('really fires on this screen — the golden carries them', () => {
    for (const ref of ['&rsquo;', '&mdash;', '&rarr;', '&#8635;']) expect(GOLDEN).toContain(ref);
    // `&ldquo;`/`&rdquo;` live on the empty-table branch, which the golden does not hold.
    expect(APP).toContain('Click &ldquo;New self-billed invoice&rdquo;.');
  });
});

// ── THE FOUR DOCUMENTS NO GOLDEN HOLDS ───────────────────────────────────────────────────────────

describe('the four documents no golden holds', () => {
  it('paints renderSelfbill()\'s Loading… panel while the two calls are in flight', () => {
    expect(renderToStaticMarkup(screen({ list: null }))).toBe(
      '<div class="panel"><div class="muted" style="padding:24px;text-align:center"><span class="spin"></span> Loading…</div></div>',
    );
  });

  it('shows the caught error — app.html:4243', () => {
    const html = renderToStaticMarkup(screen({ error: 'Network down' }));
    expect(html).toBe('<div class="panel"><div class="empty"><div class="empty-ico">⚠️</div><div>Network down</div></div></div>');
    expect(html).not.toContain('SBI-2026-0007');
  });

  it('shows the empty-table copy, curly quotes and all — app.html:4259', () => {
    const html = renderToStaticMarkup(screen({ list: [] }));
    expect(html).toContain('No self-billed invoices yet. Click “New self-billed invoice”.');
    expect(html).toContain('colSpan="9"');   // React's spelling; relax()'s R4 lower-cases both sides
  });

  it('opens the payees panel behind SBI.showPayees, with every payee row', () => {
    const html = renderToStaticMarkup(screen({ showPayees: true }));
    expect(html).toContain('👤 Payees (individuals)');
    expect(html).toContain('LIM WEI JIE');
    expect(html).toContain('IC 900101-14-5501');
    expect(html).toContain('Maybank 162011223344');
    expect(html).toContain('IG12345678901');
    // The count on the toggle follows the list it opens.
    expect(html).toContain('👤 Payees (2)');
  });

  it('shows "No payees yet." rather than an empty table body', () => {
    expect(renderToStaticMarkup(screen({ showPayees: true, payees: [] }))).toContain('No payees yet.');
    expect(renderToStaticMarkup(screen({ payees: [] }))).toContain('👤 Payees (0)');
  });

  it('keeps every pf_* id sbiSavePayee() reads the form back out of the DOM by', () => {
    // Extracted from app.html at run time — a retyped list agrees with a widened port by construction.
    // A field that loses its id saves BLANK, which on this form is a wiped bank account or IC number.
    const fn = APP.slice(APP.indexOf('async function sbiSavePayee(){'), APP.indexOf('async function sbiDeletePayee('));
    const ids = new Set([
      ...[...fn.matchAll(/getElementById\('(pf_[a-z_]+)'\)/g)].map((m) => m[1]),
      ...[...fn.matchAll(/g\('([a-z_]+)'\)/g)].map((m) => 'pf_' + m[1]),
    ]);
    expect(ids.size).toBeGreaterThan(8);
    const html = renderToStaticMarkup(screen({ showPayees: true, payeeForm: PAYEES[0] }));
    for (const id of ids) expect(html).toContain('id="' + id + '"');
  });

  it('keeps every sbi_* id sbiSave() reads the invoice form back out of the DOM by', () => {
    const fn = APP.slice(APP.indexOf('async function sbiSave(){'), APP.indexOf('var SBI_SAVING=false;'));
    const ids = [...new Set([...fn.matchAll(/getElementById\('(sbi_[a-z_]+)'\)/g)].map((m) => m[1]))];
    expect(ids.length).toBeGreaterThan(12);
    const html = renderToStaticMarkup(screen({ form: {}, lines: [{ description: '', qty: 1, unit_price: 0, amount: 0 }] }));
    for (const id of ids) expect(html).toContain('id="' + id + '"');
    // …and the file input the attachments are read from, which sbiFilesRead() reaches separately.
    expect(html).toContain('id="sbi_files"');
  });

  it('the invoice form is uncontrolled, and an EDIT paints the record it is editing', () => {
    // `sbiSave()` reads these boxes back out of the DOM, so a controlled port would fight the operator's
    // typing; an uncontrolled one that dropped the record's values would silently blank a saved invoice.
    const html = renderToStaticMarkup(screen({
      form: { buyer_name: 'SKINDAE SDN BHD', payee_bank_account: '8001234567', notes: 'August retainer' },
      editId: 12, lines: [{ description: 'Design work', qty: 1, unit_price: 1800, amount: 1800 }],
    }));
    expect(html).toContain('id="sbi_bname"');
    expect(html).toContain('value="SKINDAE SDN BHD"');
    expect(html).toContain('value="8001234567"');
    expect(html).toContain('value="August retainer"');
    expect(html).toContain('value="Design work"');
    expect(html).toContain('value="1800"');
  });

  it('the WHT rate box is hidden unless the type is custom — app.html:4331', () => {
    expect(renderToStaticMarkup(screen({ form: {}, whtType: 'none' }))).toContain('id="sbi_wht_rate_box" style="margin-bottom:8px;display:none"');
    expect(renderToStaticMarkup(screen({ form: {}, whtType: 'custom' }))).toContain('id="sbi_wht_rate_box" style="margin-bottom:8px;display:block"');
  });

  it('the save button says what it will do, and cannot be pressed twice', () => {
    // app.html:4413 — a double-click created TWO invoices with sequential numbers. The lock is real.
    expect(renderToStaticMarkup(screen({ form: {}, editId: null }))).toContain('>Create invoice</button>');
    expect(renderToStaticMarkup(screen({ form: { id: 12 }, editId: 12 }))).toContain('>Save changes</button>');
    const busy = renderToStaticMarkup(screen({ form: {}, editId: null, saving: true }));
    expect(busy).toContain('disabled=""');
    expect(busy).toContain('Saving…');
  });

  it('the GL dropdowns show the company\'s own accounts, split expense from liability', () => {
    const accounts = [
      { code: '400', name: 'Consulting', cls: 'EXPENSE' },
      { code: '820', name: 'WHT payable', cls: 'LIABILITY' },
    ];
    const html = renderToStaticMarkup(screen({ form: { tenant_id: COS[0].tenant_id }, accounts }));
    expect(html).toContain('400 · Consulting');
    expect(html).toContain('820 · WHT payable');
    expect(html).toContain('— select expense account —');
    expect(html).toContain('— none (only if withholding) —');
    // Before the fetch resolves, the legacy placeholder stands.
    expect(renderToStaticMarkup(screen({ form: {} }))).toContain('— select company first —');
  });
});

// ── THE PREVIEW ARITHMETIC ───────────────────────────────────────────────────────────────────────

describe('recalc() — the box an operator reads before pressing the button', () => {
  it('is a DISPLAY ECHO: the server recomputes gross, WHT and net on every save', () => {
    // Quick Invoice's case, not O2O's, and this is the evidence rather than the assertion. `sbi_save`
    // derives all three itself, so nothing was lifted into a shared `.js`.
    const fin = readFileSync(join(REPO, 'supabase', 'functions', 'portal', 'finance.ts'), 'utf8');
    const h = fin.slice(fin.indexOf('if (api === "sbi_save")'), fin.indexOf('if (api === "sbi_approve")'));
    expect(h).toContain('const gross = items.reduce(');
    expect(h).toContain('const whtAmount = Math.round(gross * whtRate/100 * 100)/100;');
    expect(h).toContain('gross_amount: gross');
    expect(h).toContain('net_payable: net');
  });

  it('sums qty × unit price and withholds at the type\'s statutory rate', () => {
    const lines = [{ qty: 2, unit_price: 1500 }, { qty: 1, unit_price: 2000 }];
    expect(recalc(lines, 'none', '')).toEqual({ gross: 5000, wht: 0, net: 5000, rate: 0 });
    expect(recalc(lines, 's107d_2', '')).toEqual({ gross: 5000, wht: 100, net: 4900, rate: 2 });
    expect(recalc(lines, 'nr_10', '')).toEqual({ gross: 5000, wht: 500, net: 4500, rate: 10 });
  });

  it('takes a typed Amount over qty × unit price — the operator\'s override, not a bug', () => {
    expect(lineAmount({ qty: 3, unit_price: 10, amount: 25, manual: true })).toBe(25);
    expect(lineAmount({ qty: 3, unit_price: 10, amount: 25 })).toBe(30);
    expect(recalc([{ qty: 3, unit_price: 10, amount: 25, manual: true }], 'none', '').gross).toBe(25);
  });

  it('rounds the withheld figure to the sen, and never lets net drift from gross − wht', () => {
    // 1234.56 × 2% = 24.6912 → 24.69, and net must be the rounded pair, not a re-rounded subtraction.
    const t = recalc([{ qty: 1, unit_price: 1234.56 }], 's107d_2', '');
    expect(t.wht).toBe(24.69);
    expect(t.net).toBe(1209.87);
    expect(Math.round((t.gross - t.wht) * 100) / 100).toBe(t.net);
  });

  it('reads a custom rate only when the type is custom', () => {
    expect(recalc([{ qty: 1, unit_price: 1000 }], 'custom', '7.5')).toEqual({ gross: 1000, wht: 75, net: 925, rate: 7.5 });
    expect(recalc([{ qty: 1, unit_price: 1000 }], 'custom', '').rate).toBe(0);
    // A custom rate typed while the type is s.107D must NOT be applied.
    expect(recalc([{ qty: 1, unit_price: 1000 }], 's107d_2', '90').rate).toBe(2);
  });

  it('MIRRORS the legacy gap: the preview net ignores SST, the server does not', () => {
    // finance.ts:1401 is `gross + sst − wht`; app.html:4378 is `gross − wht`. The form has no SST input
    // (app.html:4399's H7 comment), so the two agree on everything this form can produce — but the
    // divergence is real and is recorded here rather than silently "fixed" in the port.
    const fin = readFileSync(join(REPO, 'supabase', 'functions', 'portal', 'finance.ts'), 'utf8');
    expect(fin).toContain('const net = Math.round((gross + sst - whtAmount)*100)/100;');
    expect(APP).toContain('var net=Math.round((gross-wht)*100)/100;');
    const html = renderToStaticMarkup(screen({ form: {}, lines: [{ qty: 1, unit_price: 100 }], whtType: 'none' }));
    // The totals box holds three rows and no SST line, so the preview cannot show what it does not add.
    const box = html.slice(html.indexOf('id="sbi_t_gross"'), html.indexOf('id="sbi_save_btn"'));
    expect(box).toContain('RM 100.00');
    expect(box).not.toContain('SST');
  });
});

// ── THE REQUESTS ─────────────────────────────────────────────────────────────────────────────────

describe('the requests this screen makes — no golden sees them, and they create payments', () => {
  const form = (): InvoiceForm => ({
    editId: null, tenant_id: COS[0].tenant_id, payee: '2',
    buyer_name: 'SKINDAE SDN BHD', buyer_ssm: '201801012345', buyer_tin: 'C123', buyer_sst: '', buyer_address: 'KL',
    invoice_date: '2026-08-20', due_date: '', payment_type: 'service', classification_code: '036',
    bank_name: ' CIMB ', bank_account: ' 8001234567 ', bank_holder: ' NURUL AIN BINTI HASSAN ',
    lines: [{ description: 'Design work', qty: 1, unit_price: 1800, amount: 1800 }],
    wht_type: 'none', wht_rate: 0, gl_account: '400', wht_gl_account: '', sst_amount: 0,
    notes: '', new_attachments: [],
  });

  it('is exactly what sbiSave() POSTs, read out of app.html rather than retyped', () => {
    const fn = APP.slice(APP.indexOf('async function sbiSave(){'), APP.indexOf('var SBI_SAVING=false;'));
    expect([...fn.matchAll(/call\(\{([^}]*)\}\)/g)].map((m) => m[1])).toEqual(["api:'sbi_save',invoice:inv"]);
    const inv = invoiceBody(form()).invoice as Record<string, unknown>;
    // The FIELD SET, out of the legacy function's own text — a widened port cannot agree by construction.
    const legacyKeys = [...fn.matchAll(/(?:^|[,{\n ])([a-z_]+):(?=document|SBI|Number|parseInt|files|wt|rate|bank)/g)].map((m) => m[1]);
    expect(legacyKeys.length).toBeGreaterThan(10);
    for (const k of legacyKeys) expect(Object.keys(inv)).toContain(k);
  });

  it('resolves the payee to an integer id — never a string the server would coerce', () => {
    expect((invoiceBody(form()).invoice as Record<string, unknown>).individual_id).toBe(2);
  });

  it('trims the bank block, because it IS the payment destination', () => {
    const inv = invoiceBody(form()).invoice as Record<string, unknown>;
    expect(inv.payee_bank_name).toBe('CIMB');
    expect(inv.payee_bank_account).toBe('8001234567');
    expect(inv.payee_bank_holder).toBe('NURUL AIN BINTI HASSAN');
  });

  it('keeps a line that carries an amount and no description — app.html:4397', () => {
    // Tidying this to "needs a description" drops money off an invoice with nothing on screen changing.
    const f = form();
    f.lines = [{ description: '', qty: 1, unit_price: 0, amount: 250 }, { description: '', amount: 0 }];
    expect((invoiceBody(f).invoice as { line_items: unknown[] }).line_items).toEqual([{ description: '', qty: 1, unit_price: 0, amount: 250 }]);
  });

  it('preserves the record\'s SST rather than zeroing it on a re-save — app.html:4399 (H7)', () => {
    const f = form(); f.editId = 12; f.sst_amount = 108;
    expect((invoiceBody(f).invoice as Record<string, unknown>).sst_amount).toBe(108);
    expect((invoiceBody(f).invoice as Record<string, unknown>).id).toBe(12);
  });

  it('refuses before posting when the payment has no company, no payee or no destination', () => {
    // The server would otherwise fall back to the PAYEE MASTER's bank account (finance.ts:1389) — a
    // different account than the one the operator was looking at.
    expect(saveRefusal(form())).toBeNull();
    expect(saveRefusal({ ...form(), tenant_id: '' })).toBe('Select the paying company');
    expect(saveRefusal({ ...form(), payee: '' })).toBe('Select the payee');
    expect(saveRefusal({ ...form(), bank_name: '   ' })).toBe('Bank name and account number are required for payment');
    expect(saveRefusal({ ...form(), bank_account: '' })).toBe('Bank name and account number are required for payment');
  });

  it('the payee body is what sbiSavePayee() POSTs, and carries the id it is editing', () => {
    const fn = APP.slice(APP.indexOf('async function sbiSavePayee(){'), APP.indexOf('async function sbiDeletePayee('));
    expect(fn).toContain("call({api:'individual_save',payee:payee})");
    const p: PayeeForm = {
      id: 1, name: 'LIM WEI JIE', id_type: 'ic', id_no: '900101-14-5501', tin: 'IG1', phone: '', email: '',
      address: '', bank_name: 'Maybank', bank_account: '162011223344', default_payment_type: 'commission',
    };
    expect(payeeBody(p)).toEqual({ api: 'individual_save', payee: { ...p } });
    // A blank id is a NEW payee; sending the wrong one overwrites somebody else's bank account.
    expect((payeeBody({ ...p, id: null }).payee as { id: unknown }).id).toBeNull();
  });
});

// ── THE PRINTABLE INVOICE ────────────────────────────────────────────────────────────────────────

describe('invoiceDocHtml() — the document that leaves the building', () => {
  const inv = {
    tenant_id: COS[0].tenant_id, invoice_no: 'SBI-2026-0007', invoice_date: '2026-08-05',
    buyer_name: 'SKINDAE SDN BHD', buyer_ssm: '201801012345', buyer_tin: 'C123', buyer_sst: '',
    payee_name: 'LIM WEI JIE', payee_id_type: 'ic', payee_id_no: '900101-14-5501', payee_tin: 'IG1',
    payee_bank_name: 'Maybank', payee_bank_account: '162011223344', payee_bank_holder: '',
    payment_type: 'commission', classification_code: '037', currency: 'MYR',
    gross_amount: 5000, wht_amount: 100, wht_rate: 2, net_payable: 4900, sst_amount: 0,
    line_items: [{ description: 'Commission Aug 2026', qty: 1, unit_price: 5000, amount: 5000 }],
  };

  it('names the payee, the bank and the account the money goes to', () => {
    const html = invoiceDocHtml(inv, COS);
    expect(html).toContain('<b>LIM WEI JIE</b>');
    expect(html).toContain('<b>Maybank</b>');
    expect(html).toContain('<b>162011223344</b>');
    // Account holder falls back to the payee's own name, not to a blank.
    expect(html).toContain('Account holder</td><td style="border:none;padding:2px 0"><b>LIM WEI JIE</b>');
  });

  it('states the withheld tax and that it goes to LHDN', () => {
    expect(invoiceDocHtml(inv, COS)).toContain('Withholding tax of 2% (MYR 100.00) has been deducted and will be remitted to LHDN.');
    expect(invoiceDocHtml({ ...inv, wht_amount: 0 }, COS)).not.toContain('remitted to LHDN');
  });

  it('shows the net payable in the invoice\'s own currency, to the sen', () => {
    expect(invoiceDocHtml(inv, COS)).toContain('NET PAYABLE</td><td class="r">MYR 4,900.00');
    expect(invoiceDocHtml({ ...inv, currency: 'SGD', net_payable: 1234.5 }, COS)).toContain('SGD 1,234.50');
  });

  it('escapes what the server sent — this document is opened as a page', () => {
    expect(invoiceDocHtml({ ...inv, payee_name: '<script>x</script>' }, COS)).not.toContain('<script>x');
  });

  it('is the legacy builder\'s own structure, read out of app.html', () => {
    const fn = APP.slice(APP.indexOf('function sbiInvoiceHTML(v){'), APP.indexOf('function qiProductOptions('));
    for (const s of ['SELF-BILLED INVOICE', 'Payment details', 'NET PAYABLE', 'Supplier (individual)', 'Buyer (issued by)']) {
      expect(fn).toContain(s);
      expect(invoiceDocHtml(inv, COS)).toContain(s);
    }
  });
});

// ── THE PERMISSION GATE ──────────────────────────────────────────────────────────────────────────

describe('the admin gate — app.html:1429, and it is NOT the feature flag', () => {
  it('opens only for a login that manages users', () => {
    expect(selfbillReachable({ manage_users: true })).toBe(true);
  });

  it('is closed for every other shape of permission, including a missing one', () => {
    for (const p of [null, undefined, {}, { manage_users: false }, { manage_users: null }]) {
      expect(selfbillReachable(p as never)).toBe(false);
    }
    // A rich feature list is not a substitute for the admin flag.
    expect(selfbillReachable({ features: ['selfbill', 'wht'] } as never)).toBe(false);
  });

  it('mirrors showApp()\'s actual line for THIS tab, read out of app.html', () => {
    // Three shipped screens found their gate was not their neighbours'. `selfbill` really is `!canManage`
    // — and the legacy's own comment on that line says why.
    const block = APP.slice(APP.indexOf('const feats=PERMS.features||[]'), APP.indexOf('// Hide any category whose sub-tabs'));
    expect(block).toContain("else if(t==='selfbill') el.classList.toggle('hide', !canManage); // Personal (self-billed) invoices: admin-only (creates payments)");
    expect(block).toContain('const canManage=!!PERMS.manage_users;');
  });

  it('is why the gate exists: the screen hands out bank accounts and payment buttons', () => {
    // Guard the guard. `renderSelfbill()` has no role check in it, so this screen leaks by default.
    const html = renderToStaticMarkup(screen({ showPayees: true }));
    expect(html).toContain('162011223344');       // an individual's bank account number
    expect(html).toContain('900101-14-5501');     // an individual's IC number
    expect(html).toContain('>Approve</button>');  // clears an invoice for payment
    expect(html).toContain('Xero');               // posts a payable
  });

  it('is what nav.ts hides the tab on too — the same rule, in one place', () => {
    const nav = readFileSync(join(REPO, 'web', 'src', 'nav.ts'), 'utf8');
    expect(nav).toContain("id === 'selfbill'");
    expect(nav).toContain('hidden = !canManage');
  });
});
