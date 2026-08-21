// Finance OS · Smart OCR — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.ocr.html` was captured from `renderOcr()` (app.html:7127) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts,
// tests/parity.ts or tests/handlers.ts. The component is rendered with `renderToStaticMarkup`,
// normalised by the harness's own normalise(), relaxed by the documented layer in ./parity.ts, and
// compared.
//
// NO SEVENTH RELAXATION, and none was close. The one thing that looked like a candidate is the `&amp;`
// in the camera button's caption — but app.html writes it ESCAPED (`auto-crop &amp; clean`), so the
// golden holds the entity and React's text escaper emits the same entity for a bare `&`. That is the
// opposite of hr-employees' `decodeAttrAmp` and hr-payslip's `decodeTextAmp`, both of which exist
// because the legacy forgot the escape. Here it did not, so the two sides agree byte for byte.
//
// ── THE GOLDEN IS THE SCREEN, WHICH ON THIS SCREEN IS WORTH SAYING ────────────────────────────────
// CLAUDE.md's Quick Invoice note: check what the legacy renderer does AFTER its innerHTML write before
// trusting a golden. `renderOcr()` (app.html:7146) does four things — resets OCR_RESULT, OCR_FILE_NAME,
// OCR_FILE_B64, OCR_MIME, and sets `loaded.ocr`. No appendChild, no `.value=`, no setTimeout, no fetch.
// So unlike `finance.qinv`, this golden IS what an operator sees on arrival, and the `renderOcr() is
// the whole paint` case below pins that by reading app.html at run time.
//
// What the golden does NOT hold is `#ocr_out`, which is where the entire useful life of this screen
// happens — seven states, one of which posts a real document into Xero. Those are asserted here, not
// diffed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import FinanceOcr, {
  billBody, collectLines, confirmText, extractBody, ocrReachable, ocrReachableAfterTopUp,
  type OcrExtract, type OcrOut,
} from '../src/finance-ocr';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `#ocr` is the tab div `render('ocr')` writes into — the golden's ONLY section. */
const GOLDEN = goldenSection('finance.ocr', 'ocr');

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');

const noop = () => {};

type Props = Parameters<typeof FinanceOcr>[0];

/** The fixture the harness rendered the golden under — tests/render_fixtures.ts's two companies. */
const COMPANIES = [
  { tenant_id: '11111111-1111-4111-8111-111111111111', tenant_name: 'SKINDAE SDN BHD' },
  { tenant_id: '22222222-2222-4222-8222-222222222222', tenant_name: 'I PROCARE MALAYSIA SDN BHD' },
];

function screen(over: Partial<Props> = {}) {
  // The state the harness captured: a fresh `renderOcr()` — nothing picked, so the Extract button is
  // disabled and `#ocr_out` is empty.
  return (
    <FinanceOcr
      companies={COMPANIES}
      canExtract={false}
      out={null}
      onPick={noop}
      onScan={noop}
      onExtract={noop}
      onDownloadScan={noop}
      onDiscard={noop}
      onPostBill={noop}
      onUploadAnother={noop}
      {...over}
    />
  );
}

const rendered = (over: Partial<Props> = {}) => relax(renderToStaticMarkup(screen(over)));

describe('Finance Smart OCR — React vs the legacy golden', () => {
  it('renders the same document as renderOcr() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * Every handler on this screen is argument-free (`ocrPick(this)` carries only the browser's own `this`),
 * so argument parity is vacuous and cannot be the check on its own — the case hr-payroll, hr-profile,
 * finance-collections and finance-wht all added `LEGACY_TO_PROP` for. Without it, `onclick="ocrScan()"`
 * and `onclick="ocrExtract()"` are both `[]` and a camera button wired to the extractor passes: the
 * operator presses "Scan with camera" and is charged for a Claude call on whatever was picked last.
 *
 * Keyed on the WHOLE raw text first, as finance-wht's is, because app.html writes inline statements as
 * handlers elsewhere on this tab (`document.getElementById('ocr_out').innerHTML=''` is one, though it
 * is not in this golden).
 */
const LEGACY_TO_PROP: Record<string, string> = {
  'ocrPick(this)': 'pick',
  'ocrScan()': 'scan',
  'ocrExtract()': 'extract',
};

const propFor = (raw: string) => LEGACY_TO_PROP[raw] ?? LEGACY_TO_PROP[raw.replace(/\(.*$/, '')] ?? raw;

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
    onPick: record('pick') as never,
    onScan: record('scan') as never,
    onExtract: record('extract') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard. hr-clock's "some handler carries an argument" clause is unsatisfiable on a screen
  // whose every handler is argument-free, so it is REPLACED, not dropped, with hr-profile's: every
  // golden handler must resolve to a KNOWN prop, so a new legacy button falls through `propFor()`'s
  // `?? raw` and fails here rather than passing silently.
  expect(want.length).toBe(3);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

describe('the comparison still bites', () => {
  const want = relax(GOLDEN);
  const html = renderToStaticMarkup(screen());

  it('renderOcr() is the WHOLE paint — nothing runs after the innerHTML write that changes the DOM', () => {
    // CLAUDE.md's `finance.qinv` finding, applied rather than assumed. The harness records innerHTML
    // writes to elements with ids and is blind to appendChild / `.value=` / classList, so if this
    // renderer did any of those the golden above would be a screen no operator ever sees and every
    // assertion in this file would be about the wrong document.
    const fn = APP.slice(APP.indexOf('function renderOcr(){'));
    const body = fn.slice(0, fn.indexOf('\nfunction ocrPick('));
    const after = body.slice(body.indexOf("loaded.ocr=true"));
    expect(body).toContain("document.getElementById('ocr').innerHTML=");
    // Everything between the write and the end of the function, checked for DOM mutation.
    const tail = body.slice(body.indexOf('</div>\';') + 8);
    for (const forbidden of ['appendChild', 'setTimeout', '.value=', 'classList', 'call({', 'insertAdjacent']) {
      expect(tail).not.toContain(forbidden);
    }
    expect(after.trim().replace(/[;\s}]/g, '')).toBe('loaded.ocr=true');
  });

  it('catches the company picker losing an option — the bill would post to the wrong entity', () => {
    expect(rendered({ companies: [COMPANIES[0]] })).not.toBe(want);
  });

  it('catches a tenant_id changing while the name stays the same', () => {
    // The visible half is identical and the invisible half decides which Xero organisation is billed.
    expect(rendered({ companies: [COMPANIES[0], { ...COMPANIES[1], tenant_id: COMPANIES[0].tenant_id }] })).not.toBe(want);
  });

  it('catches the Extract button losing its disabled state', () => {
    // `renderOcr()` paints it disabled and only `ocrPick()` / `ocrScan()` clear it. Enabled with no file
    // loaded means a click sends an empty document to Claude — a billed call that can only fail.
    expect(rendered({ canExtract: true })).not.toBe(want);
  });

  it('catches #ocr_out or #ocr_tenant losing its id', () => {
    // Both are read back out of the DOM by `ocrPostBill()` and by the route. A lost id posts a bill
    // with no tenant, or writes the result nowhere.
    expect(relax(GOLDEN.replace('id="ocr_out"', ''))).not.toBe(want);
    expect(relax(GOLDEN.replace('id="ocr_tenant"', ''))).not.toBe(want);
  });

  it('catches the file input accepting something the extractor cannot read', () => {
    expect(relax(GOLDEN.replace('accept="image/png,image/jpeg,image/webp,application/pdf"', 'accept="*/*"'))).not.toBe(want);
  });

  it('catches the DRAFT promise going out of the copy', () => {
    // "creates a DRAFT Bill" is the promise that nothing is payable without a human approving it in
    // Xero. A screen that said "creates a Bill" is a different assurance under the same button.
    expect(GOLDEN).toContain('<b>DRAFT Bill</b>');
    expect(relax(GOLDEN.replace('<b>DRAFT Bill</b>', '<b>Bill</b>'))).not.toBe(want);
  });

  it('catches a result branch appearing when the golden holds none', () => {
    // Proves the golden really is the empty-#ocr_out state, so the assertions below are genuinely
    // untested by the diff rather than accidentally included in it.
    for (const out of [{ kind: 'reading' }, { kind: 'pdf' }, { kind: 'picked', name: 'a.png', size: 1024 }] as OcrOut[]) {
      expect(rendered({ out })).not.toBe(want);
    }
  });

  it('the golden state paints an EMPTY #ocr_out and a DISABLED extract button', () => {
    expect(html).toContain('<div id="ocr_out" style="margin-top:14px"></div>');
    expect(html).toContain('id="ocr_extract_btn"');
    expect(html).toContain('disabled');
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=` from the string comparison, so every one of these is invisible to the diff above.

  it('catches the camera button wired to the extractor', () => {
    expect(() => assertHandlerParity({ onScan: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches the extract button wired to the scanner', () => {
    expect(() => assertHandlerParity({ onExtract: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches the file input losing its change handler', () => {
    expect(() => assertHandlerParity({ onPick: undefined as never })).toThrow();
  });
});

describe('#ocr_out — the seven states no golden holds', () => {
  const out = (o: OcrOut) => renderToStaticMarkup(screen({ out: o }));

  it('acknowledges a picked file by name and size', () => {
    const html = out({ kind: 'picked', name: 'tnb-bill.png', size: 204800 });
    expect(html).toContain('📎 tnb-bill.png ready (200 KB)');
  });

  it('escapes what came off the filesystem — a file name reaches the page as text', () => {
    expect(out({ kind: 'picked', name: '<img onerror=x>', size: 0 })).not.toContain('<img onerror');
  });

  it('refuses a PDF up front rather than paying for a call that cannot succeed', () => {
    // app.html:7176 — `ocrExtract()` returns before `call()` when the mime is application/pdf.
    expect(out({ kind: 'pdf' })).toContain('⚠ PDF support coming soon');
  });

  it('shows the reading spinner, which is what stops a second billed call', () => {
    expect(out({ kind: 'reading' })).toContain('<span class="spin"></span>');
  });

  it('keeps the model\'s raw reply behind a details, and omits it when there is none', () => {
    expect(out({ kind: 'failed', error: 'Could not parse', raw: '{"x":1}' })).toContain('Raw response');
    expect(out({ kind: 'failed', error: 'Could not parse', raw: null })).not.toContain('Raw response');
  });

  it('offers the scanned PDF and pluralises the page count', () => {
    expect(out({ kind: 'scanned', jpegDataUrl: 'data:image/jpeg;base64,AA', pageCount: 1 })).toContain('1 page ·');
    expect(out({ kind: 'scanned', jpegDataUrl: 'data:image/jpeg;base64,AA', pageCount: 3 })).toContain('3 pages ·');
    expect(out({ kind: 'scanned', jpegDataUrl: 'data:image/jpeg;base64,AA', pageCount: 1 })).toContain('⬇ Download PDF');
  });

  it('formats the posted bill total to the sen, never as a raw float', () => {
    // `1234.5` printed raw reads as RM 1234.5, which an operator reconciling against Xero would take
    // for a different figure. M() (app.html:1253) is the format; this proves it is applied.
    const html = out({ kind: 'posted', number: 'BILL-0031', total: 1234.5, contact: 'TNB' });
    expect(html).toContain('Draft bill created: BILL-0031');
    expect(html).toContain('Total: RM 1,234.50 · Contact: TNB');
    expect(html).not.toContain('1234.5<');
  });
});

describe('the extracted bill form — uncontrolled, and its data-* names ARE the contract', () => {
  const extract: OcrExtract = {
    confidence: 'low',
    vendor_name: 'TENAGA NASIONAL BERHAD', invoice_no: 'INV-9', invoice_date: '2026-08-01',
    due_date: '2026-08-31', currency: 'MYR', subtotal: 100, tax_amount: 6, total: 106,
    suggested_gl_account: '445-2000', notes: 'Handwritten total',
    line_items: [
      { description: 'Electricity', quantity: 1, unit_amount: 100 },
      { description: 'Meter rental', quantity: 2, unit_amount: 3, account_code_guess: '429-1000' },
    ],
  };
  const html = renderToStaticMarkup(screen({ out: { kind: 'extracted', result: extract } }));

  it('carries every [data-k] name ocrPostBill() reads, extracted from app.html at run time', () => {
    // A retyped list agrees with a widened or narrowed port by construction. `ocrPostBill()` collects
    // `#ocr_out [data-k]`; a field that lost its attribute posts as ABSENT on a real accounting
    // document — a vendor, a date or a total silently missing from a draft bill in Xero.
    const render = APP.slice(APP.indexOf('function ocrRenderResult(){'), APP.indexOf('async function ocrPostBill('));
    const keys = [...render.matchAll(/fld\('[^']*','([^']+)'/g)].map((m) => m[1]);
    expect(keys.length).toBe(8);
    for (const k of keys) expect(html).toContain(`data-k="${k}"`);
    expect([...html.matchAll(/data-k="/g)].length).toBe(keys.length);
  });

  it('carries every [data-li-k] name, and one [data-li-i] per row', () => {
    const render = APP.slice(APP.indexOf('function ocrRenderResult(){'), APP.indexOf('async function ocrPostBill('));
    const liKeys = [...new Set([...render.matchAll(/data-li-k="([^"]+)"/g)].map((m) => m[1]))];
    expect(liKeys.sort()).toEqual(['account_code_guess', 'description', 'quantity', 'unit_amount']);
    for (const k of liKeys) expect(html).toContain(`data-li-k="${k}"`);
    expect([...html.matchAll(/data-li-i="0"/g)].length).toBe(4);
    expect([...html.matchAll(/data-li-i="1"/g)].length).toBe(4);
  });

  it('is UNCONTROLLED — no value= attribute React would have to keep in step with the DOM read', () => {
    // `ocrPostBill()` reads `el.value` off the live DOM. A controlled port would need every keystroke
    // in React state, and any state it failed to update would post the ORIGINAL AI guess rather than
    // the correction the operator typed.
    expect(html).not.toContain('value=""');
    expect(html).toContain('id="ocr_lines"');
  });

  it('falls back GL account: the line guess, then the document suggestion, then 610-1000', () => {
    // app.html:7196. A line that landed on the wrong expense account is a mis-stated P&L, and the
    // order of these three is the whole rule.
    expect(html).toContain('value="429-1000"');   // the line's own guess wins
    expect(html).toContain('value="445-2000"');   // the document-level suggestion for the line without one
    const bare = renderToStaticMarkup(screen({ out: { kind: 'extracted', result: { line_items: [{ description: 'x' }] } } }));
    expect(bare).toContain('value="610-1000"');
  });

  it('says LOW CONFIDENCE out loud when the model said so', () => {
    // The operator is the last check before a bill enters Xero; a low-confidence read that looked the
    // same as a high-confidence one is how a mis-read total gets approved.
    expect(html).toContain('low — please review');
    expect(renderToStaticMarkup(screen({ out: { kind: 'extracted', result: { confidence: 'high' } } }))).toContain('high confidence');
    expect(renderToStaticMarkup(screen({ out: { kind: 'extracted', result: {} } }))).toContain('>medium<');
  });

  it('shows the AI notes when there are any, and nothing when there are not', () => {
    expect(html).toContain('Handwritten total');
    expect(renderToStaticMarkup(screen({ out: { kind: 'extracted', result: {} } }))).not.toContain('AI notes');
  });

  it('escapes what the model returned — the extraction is untrusted text', () => {
    const evil = renderToStaticMarkup(screen({ out: { kind: 'extracted', result: { vendor_name: '"><script>x</script>', notes: '<b>hi</b>' } } }));
    expect(evil).not.toContain('<script>');
    expect(evil).not.toContain('<b>hi</b>');
  });
});

describe('the two requests — no golden sees a request, and one of them writes to Xero', () => {
  it('extractBody() is exactly what ocrExtract() POSTs, read out of app.html rather than retyped', () => {
    const fn = APP.slice(APP.indexOf('async function ocrExtract(){'), APP.indexOf('function ocrRenderResult(){'));
    const legacy = [...fn.matchAll(/call\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(legacy).toEqual(["api:'ocr_extract', content_base64:OCR_FILE_B64, content_type:OCR_MIME"]);
    expect(extractBody('QUJD', 'image/png')).toEqual({ api: 'ocr_extract', content_base64: 'QUJD', content_type: 'image/png' });
    expect(Object.keys(extractBody('x', 'y')).sort()).toEqual(['api', 'content_base64', 'content_type']);
  });

  it('billBody() is exactly what ocrPostBill() POSTs', () => {
    const fn = APP.slice(APP.indexOf('async function ocrPostBill(){'), APP.indexOf("/* ── 📧 AP Email Agent ── */"));
    const legacy = [...fn.matchAll(/call\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(legacy).toEqual(["api:'create_bill_from_ocr', tenant, bill"]);
    expect(billBody('t1', { total: 1 })).toEqual({ api: 'create_bill_from_ocr', tenant: 't1', bill: { total: 1 } });
  });

  it('billBody() REFUSES a blank tenant rather than defaulting to a company', () => {
    // A bill posted with the wrong tenant files a supplier invoice against another entity's ledger and
    // nothing on screen looks wrong. Same reasoning as reconcileBody('') on the Bank Rec screen.
    expect(() => billBody('', { total: 1 })).toThrow(/Pick a company/);
  });

  it('confirmText() names the vendor and the total the server is about to be handed', () => {
    // The last thing between an operator and a document in Xero. `.toFixed(2)` is the legacy's own.
    expect(confirmText({ vendor_name: 'TNB', total: 106 })).toContain('Create DRAFT bill for TNB · Total: RM 106.00');
    expect(confirmText({ vendor_name: 'TNB', total: 106 })).toContain('will be DRAFT in Xero');
    expect(confirmText({})).toContain('for ? · Total: RM 0.00');
  });
});

describe('collectLines() — where a line silently leaves a real accounting document', () => {
  it('keeps a row with an amount but no description', () => {
    // app.html:7226's filter is `description || unit_amount || Number(quantity) > 0`. A port that
    // required a description would drop RM 15,000 off a draft bill with nothing on screen changing.
    expect(collectLines([{ description: '', unit_amount: 15000, quantity: 1 }])).toEqual([
      { description: '', quantity: 1, unit_amount: 15000, account_code_guess: '' },
    ]);
  });

  it('keeps a row with only a quantity, and drops a wholly blank one', () => {
    expect(collectLines([{ quantity: 2 }])).toHaveLength(1);
    expect(collectLines([{ description: '', quantity: 0, unit_amount: 0 }])).toEqual([]);
    expect(collectLines([{}])).toEqual([]);
  });

  it('coerces quantity and unit_amount to numbers, and never to NaN', () => {
    // The DOM hands back strings. A NaN total reaches Xero as a rejected or zeroed line.
    expect(collectLines([{ description: 'x', quantity: '3', unit_amount: '12.50' }])[0])
      .toEqual({ description: 'x', quantity: 3, unit_amount: 12.5, account_code_guess: '' });
    expect(collectLines([{ description: 'x', quantity: 'abc', unit_amount: 'abc' }])[0])
      .toEqual({ description: 'x', quantity: 0, unit_amount: 0, account_code_guess: '' });
  });

  it('preserves ROW ORDER — a bill\'s lines are not a set', () => {
    const got = collectLines([{ description: 'a' }, { description: 'b' }, { description: 'c' }]);
    expect(got.map((l) => l.description)).toEqual(['a', 'b', 'c']);
  });
});

describe('the permission gate — app.html:1427, and it is not any of its neighbours', () => {
  // The tab is hidden from EVERYONE: `el.classList.toggle('hide', true)`. Not `!canManage`, not a
  // feature flag. The comment on that line says why (Anthropic vision credits exhausted 2026-07-09)
  // and how to undo it (flip `true` → `!canManage`), and both halves are pinned here so neither the
  // state nor the instruction can be lost in the port.
  it('is closed for EVERY shape of permission, including a master admin', () => {
    for (const p of [null, undefined, {}, { features: [] }, { features: ['ocr'] }, { manage_users: true },
      { manage_users: true, features: ['ocr', 'overview'] }]) {
      expect(ocrReachable(p as never)).toBe(false);
    }
  });

  it('app.html still hides it from everyone, with the re-enable instruction attached', () => {
    // If someone re-enables the legacy tab, this fails and the React gate has to be reconsidered
    // deliberately rather than drifting out of step with the app it mirrors.
    expect(APP).toContain("else if(t==='ocr') el.classList.toggle('hide', true);");
    expect(APP).toMatch(/t==='ocr'\) el\.classList\.toggle\('hide', true\); \/\/ OCR HIDDEN[^\n]*flip true→!canManage to re-enable after a top-up/);
  });

  it('describes the INTENDED rule for after a credit top-up: admin-only, like its neighbours', () => {
    // Not what the app does today, and deliberately not what the route gates on. This keeps the
    // re-enable instruction executable instead of leaving it as a comment to be rediscovered.
    expect(ocrReachableAfterTopUp({ manage_users: true })).toBe(true);
    for (const p of [null, undefined, {}, { manage_users: false }, { features: ['ocr'] }]) {
      expect(ocrReachableAfterTopUp(p as never)).toBe(false);
    }
  });

  it('the route gates on ocrReachable(), not on the after-top-up rule', () => {
    // Guard the guard: the two predicates differ for a master admin, so a route that imported the
    // wrong one would silently re-open a tab that is off on purpose.
    const route = readFileSync(join(REPO, 'web', 'app', 'finance', 'ocr', 'page.tsx'), 'utf8');
    expect(route).toContain('ocrReachable(');
    expect(route).not.toContain('ocrReachableAfterTopUp');
    expect(ocrReachable({ manage_users: true })).not.toBe(ocrReachableAfterTopUp({ manage_users: true }));
  });

  it('is what the screen withholds: company ids, and a button that writes into Xero', () => {
    const html = renderToStaticMarkup(screen({ out: { kind: 'extracted', result: { total: 1 } } }));
    expect(html).toContain('11111111-1111-4111-8111-111111111111');
    expect(html).toContain('✓ Create DRAFT Bill in Xero');
  });
});
