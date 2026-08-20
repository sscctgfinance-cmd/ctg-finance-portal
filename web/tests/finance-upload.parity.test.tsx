// Finance OS · Upload — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.upload.html` was captured from `renderUpload()` (app.html:2450) by the
// 40-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts, web/tests/parity.ts or web/tests/handlers.ts.
//
// ── NO SEVENTH RELAXATION ─────────────────────────────────────────────────────────────────────────
// This reuses ./parity.ts's six UNCHANGED and adds no screen-local rule either — the sixth Finance
// screen and the twentieth overall to do so. Nothing on this screen needed one: every arrow, emoji and
// dash the legacy writes is a literal character in the HTML string, not a named or numeric reference,
// so React spells them the same way.
//
// ── THE GOLDEN REALLY IS THIS SCREEN, and that was checked, not assumed ───────────────────────────
// CLAUDE.md's `finance.qinv` note says to look at what a legacy renderer does after its innerHTML write
// before trusting its golden. `renderUpload()` does one thing: `UP_SCAN=null`. No appendChild, no
// `.value=`, no setTimeout, no follow-up fetch, and `upload` is not on `asyncTabs`. `proves the golden
// is the whole initial screen` below pins that against app.html's own text so a later `qiAddLine`-style
// line added to the renderer makes this file fail rather than quietly invalidating the diff.
//
// ── WHAT THE GOLDEN DOES NOT REACH, and how each is covered instead ───────────────────────────────
// The golden is a BLANK FORM with `#up_scan_note` and `#upres` empty. So this file also:
//   1. pins the DOM contract (`up_*` ids) against app.html's own text at run time, because that is what
//      `doUpload()` reads the form back out by — and one of those reads decides WHICH COMPANY the
//      document is filed against;
//   2. pins `chooseUpload()` — the rule deciding which bytes get sent, and which get refused;
//   3. pins `uploadBody()` — the request, field for field, against app.html's own list.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { COMPANIES } from '../../tests/render_fixtures';
import FinanceUpload, {
  CATEGORIES, MAX_BYTES, chooseUpload, uploadBody, uploadReachable,
} from '../src/finance-upload';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `#upload` is the tab div `render('upload')` writes into (app.html:1545). The golden's only section. */
const GOLDEN = goldenSection('finance.upload', 'upload');

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');

/** `renderUpload()`'s own source — from the function header to the `UP_SCAN` module variable after it. */
const RENDER_SRC = APP.slice(APP.indexOf('function renderUpload(){'), APP.indexOf('let UP_SCAN=null;'));

const noop = () => {};

type Props = Parameters<typeof FinanceUpload>[0];

function screen(over: Partial<Props> = {}) {
  return (
    <FinanceUpload
      companies={COMPANIES}
      // As the harness captured it: `renderUpload()` sets `UP_SCAN=null` on the way out, so the scan
      // note is empty, and `#upres` is only ever written by `doUpload()`, which has not run.
      scan={null}
      out={null}
      busy={false}
      onClearScan={noop}
      onScan={noop}
      onUpload={noop}
      {...over}
    />
  );
}

const rendered = (over: Partial<Props> = {}) => relax(renderToStaticMarkup(screen(over)));

describe('Finance Upload — React vs the legacy golden', () => {
  it('renders the same document as renderUpload() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same controls, in the same order', () => {
    assertHandlerParity();
  });

  it('proves the golden is the whole initial screen — nothing runs after the innerHTML write', () => {
    // The `finance.qinv` trap, checked rather than assumed. If someone later appends a row, sets a
    // `.value`, schedules a timeout or kicks off a fetch from this renderer, the golden stops being the
    // screen an operator sees and this file must be the thing that says so.
    for (const after of ['appendChild', 'setTimeout', 'requestAnimationFrame', 'call({', '.value=']) {
      expect(RENDER_SRC).not.toContain(after);
    }
    expect(RENDER_SRC.trimEnd().endsWith('UP_SCAN=null;\n}')).toBe(true);
    // and it is not repainted later by the async-tab loader either.
    const asyncTabs = APP.slice(APP.indexOf('asyncTabs'), APP.indexOf('\n', APP.indexOf('asyncTabs')));
    expect(asyncTabs).not.toContain('upload');
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * EVERY handler in this golden is argument-free — `upClearScan()`, `upScan()`, `doUpload(this)` (the
 * `this` is not a quoted literal, so `goldenHandlers().args` is `[]` for it too). Argument parity alone
 * therefore cannot tell any of them apart, and the file picker's onchange wired to `doUpload` — picking
 * a file uploading it immediately, with no company chosen — would pass. That is the `hr.profile` /
 * `finance.qinv` shape and it gets the treatment CLAUDE.md prescribes for it, COPIED here rather than
 * pushed into the shared ./handlers.ts:
 *
 *   • `LEGACY_TO_PROP` — a map DERIVED FROM THE GOLDEN'S OWN TEXT from the legacy function name to the
 *     prop it became, compared as a sequence.
 *   • the guard-the-guard is "every golden handler name resolved to a known prop", NOT
 *     `want.some(args.length > 0)` — unsatisfiable on a screen with no arguments anywhere, and a
 *     passing-because-unsatisfiable guard is not a guard.
 *
 * No `identArgs()` widening: this screen has no rows and no ids in any handler. `[]` here is the truth,
 * not an extraction gap.
 */
const LEGACY_TO_PROP: Record<string, string> = {
  'upClearScan()': 'clearScan',
  'upScan()': 'scan',
  'doUpload(this)': 'upload',
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
    onClearScan: record('clearScan') as never,
    onScan: record('scan') as never,
    onUpload: record('upload') as never,
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
  // This SCREEN's real risks. This screen takes files IN, so every one of them ends as a document filed
  // against the wrong company, or a file the operator believes was sent and was not.
  const want = relax(GOLDEN);

  it('catches a company dropped out of the picker', () => {
    // An operator who cannot see their company files the bill against whichever one is first — and the
    // first option is selected by default, so there is no empty state to warn them.
    expect(rendered({ companies: COMPANIES.slice(0, 1) })).not.toBe(want);
  });

  it('catches a company renamed or re-pointed at another tenant id', () => {
    // The label is what the operator reads; the value is what gets filed. Both must diff.
    expect(rendered({ companies: [{ ...COMPANIES[0], tenant_name: 'SKINDAE HOLDINGS' }, COMPANIES[1]] })).not.toBe(want);
    expect(rendered({ companies: [{ ...COMPANIES[0], tenant_id: COMPANIES[1].tenant_id }, COMPANIES[1]] })).not.toBe(want);
  });

  it('catches the company options being reordered', () => {
    // There is no placeholder option, so option ONE is the default upload target. Swapping the order
    // silently changes which company an operator who never touches the dropdown files against.
    expect(rendered({ companies: [COMPANIES[1], COMPANIES[0]] })).not.toBe(want);
  });

  it('catches a category dropped, renamed or reordered', () => {
    // The category is what routes a document to the right finance queue; "Bank Statement" filed as
    // "AP Supplier Bill" lands in the payables inbox and gets chased as an unpaid invoice.
    const html = renderToStaticMarkup(screen());
    expect(relax(html.replace('<option>Bank Statement</option>', ''))).not.toBe(want);
    expect(relax(html.replace('Reimbursement', 'Expense Claim'))).not.toBe(want);
    expect(relax(html.replace('<option>Reimbursement</option><option>Bank Statement</option>',
      '<option>Bank Statement</option><option>Reimbursement</option>'))).not.toBe(want);
  });

  it('catches the file input losing its accept list or its type', () => {
    const html = renderToStaticMarkup(screen());
    expect(relax(html.replace(' accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv"', ''))).not.toBe(want);
    expect(relax(html.replace('type="file"', 'type="text"'))).not.toBe(want);
  });

  it('catches any of the four ids doUpload() reads the form back by going missing', () => {
    for (const id of ['up_tenant', 'up_cat', 'up_file', 'up_note']) {
      expect(relax(renderToStaticMarkup(screen()).replace(` id="${id}"`, ''))).not.toBe(want);
    }
  });

  it('catches the scan preview appearing — a branch no golden holds', () => {
    expect(rendered({ scan: { jpegDataUrl: 'data:image/jpeg;base64,AA', pageCount: 2 } })).not.toBe(want);
  });

  it('catches anything at all landing in #upres', () => {
    expect(rendered({ out: { kind: 'ok' } })).not.toBe(want);
    expect(rendered({ out: { kind: 'error', text: 'File too large (max 15MB)' } })).not.toBe(want);
  });

  it('catches the Upload button being stuck disabled', () => {
    expect(rendered({ busy: true })).not.toBe(want);
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=` from the string comparison, so every one of these is invisible to the diff above.

  it('catches the file picker uploading on selection instead of clearing the scan', () => {
    // The defect this screen cannot afford: choosing a file fires the upload, before a company or a
    // category has been picked. Both handlers are argument-free, so only LEGACY_TO_PROP can see it.
    expect(() => assertHandlerParity({ onClearScan: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches the "Scan document" button wired to the uploader', () => {
    expect(() => assertHandlerParity({ onScan: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches the Upload button wired to the scanner', () => {
    expect(() => assertHandlerParity({ onUpload: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches the picker gaining an argument it never had', () => {
    expect(() => assertHandlerParity({ onClearScan: (() => misfire('up_file')) as never })).toThrow(/deeply equal/);
  });
});

describe('the feature gate — app.html:1434', () => {
  // The withheld direction, asserted. `upload` is named NOWHERE in `showApp()`'s if/else chain, so it
  // falls through to the final `else` and the gate is the FEATURE flag, not `manage_users`.
  it('mirrors the line it claims to mirror — `upload` is in no named branch of showApp()', () => {
    const gate = APP.slice(APP.indexOf("document.querySelectorAll('.tab').forEach"), APP.indexOf("document.querySelectorAll('.tab-cat')"));
    expect(gate).toContain("el.classList.toggle('hide', feats.indexOf(t)<0)");
    expect(gate).not.toContain("t==='upload'");
  });

  it('opens for a login whose features include upload', () => {
    expect(uploadReachable({ features: ['overview', 'upload'] })).toBe(true);
  });

  it('is closed for every other shape of permission, including a missing one', () => {
    for (const p of [null, undefined, {}, { features: [] }, { features: null }, { features: ['overview', 'pnl'] }]) {
      expect(uploadReachable(p as never)).toBe(false);
    }
  });

  it('is NOT the admin gate — manage_users alone does not open it', () => {
    // The trap this screen sits next to: `wht`, `selfbill`, `gateway`, `bankfeed` and `salesrecon` ARE
    // `!canManage`. Copying that line here would hand Upload to every administrator whether or not the
    // feature is licensed to their login — and take it away from a non-admin who has it.
    expect(uploadReachable({ manage_users: true } as never)).toBe(false);
  });

  it('is what the route gates on — the screen renders the Xero tenant ids', () => {
    // Guard the guard: if the props stopped carrying what the gate exists to protect, the assertions
    // above would be about nothing.
    const html = renderToStaticMarkup(screen());
    expect(html).toContain(COMPANIES[0].tenant_id);
    expect(html).toContain(COMPANIES[1].tenant_name);
  });
});

describe('the DOM contract — the ids doUpload() reads a filled form back out by', () => {
  // No golden holds a filled form, so this is the contract that actually governs it, extracted from
  // app.html at run time rather than retyped: a retyped list agrees with a widened port by construction.
  // A field that loses its id reads back BLANK — and on this form the blank one is the company, which
  // is a supplier bill filed into the wrong tenant's inbox with nothing on screen saying so.
  const upSrc = APP.slice(APP.indexOf('async function doUpload(btn)'), APP.indexOf('/* ── Password strength ── */'));
  const scanSrc = APP.slice(APP.indexOf('function upScan(){'), APP.indexOf('async function doUpload(btn)'));
  const ids = [...new Set([...(upSrc + scanSrc).matchAll(/getElementById\('(up[_a-z]*)'\)/g)].map((m) => m[1]))].sort();
  const html = renderToStaticMarkup(screen({ scan: { jpegDataUrl: 'data:image/jpeg;base64,AA', pageCount: 1 } }));

  it('finds the ids in the legacy read path at all', () => {
    expect(ids).toEqual(['up_cat', 'up_file', 'up_note', 'up_scan_note', 'up_tenant', 'upres']);
  });

  for (const id of ids) it(`renders #${id}`, () => expect(html).toContain(`id="${id}"`));

  it('leaves every control UNCONTROLLED, as the legacy markup is', () => {
    // A controlled React input emits `value=""`, which diffs against the golden and, more to the point,
    // would mean the route stopped reading the DOM the way `doUpload()` does.
    const blank = renderToStaticMarkup(screen());
    expect(blank).not.toContain('value=""');
    expect(blank).not.toContain('selected');
  });

  it('offers exactly the categories the legacy <select> does, in the same order', () => {
    const legacy = [...APP.slice(APP.indexOf("'<div class=\"fld\"><label>Category</label><select id=\"up_cat\">'"), APP.indexOf('<label>File')).matchAll(/<option>([^<]+)<\/option>/g)].map((m) => m[1]);
    expect(legacy).toEqual(CATEGORIES);
  });
});

describe('chooseUpload() — which bytes actually get sent', () => {
  const file = { name: 'march-rent.pdf', type: 'application/pdf', size: 1000 };
  const scanned = { name: 'scan_1.pdf', type: 'application/pdf', size: 2000 };

  it('refuses when nothing is selected, rather than sending an empty document', () => {
    expect(chooseUpload(null, null)).toEqual({ ok: false, error: 'Please select a file or scan a document' });
  });

  it('sends the picked file when there is no scan', () => {
    expect(chooseUpload(null, file)).toEqual({ ok: true, source: 'file', fileName: 'march-rent.pdf', contentType: 'application/pdf', size: 1000 });
  });

  it('gives a SCANNED PDF precedence over a picked file, never the other way round', () => {
    // Getting this backwards uploads a stale picked file while the operator watches their scan preview
    // sitting on screen — the wrong document filed, and the screen agreeing it went well.
    const r = chooseUpload(scanned, file);
    expect(r).toEqual({ ok: true, source: 'scan', fileName: 'scan_1.pdf', contentType: 'application/pdf', size: 2000 });
  });

  it('always types a scan as application/pdf, whatever it is handed', () => {
    expect(chooseUpload({ ...scanned, type: 'image/jpeg' }, null)).toMatchObject({ contentType: 'application/pdf' });
  });

  it("passes a picked file's own content type through untouched, including a blank one", () => {
    // A `.csv` reports `''` on some platforms and the legacy sends it as such (app.html:2494). Inventing
    // a type here would be a guess the server then trusts.
    expect(chooseUpload(null, { ...file, name: 'statement.csv', type: '' })).toMatchObject({ contentType: '' });
    expect(chooseUpload(null, { ...file, type: 'image/png' })).toMatchObject({ contentType: 'image/png' });
  });

  it('refuses over 15MB, on the boundary the legacy uses', () => {
    // `blob.size > 15*1024*1024` — app.html:2496. Exactly at the limit is allowed; one byte over is not.
    expect(MAX_BYTES).toBe(15728640);
    expect(APP).toContain('blob.size>15*1024*1024');
    expect(chooseUpload(null, { ...file, size: MAX_BYTES })).toMatchObject({ ok: true });
    expect(chooseUpload(null, { ...file, size: MAX_BYTES + 1 })).toEqual({ ok: false, error: 'File too large (max 15MB)' });
    // and the same limit applies to a scan, which is where a multi-page capture lands.
    expect(chooseUpload({ ...scanned, size: MAX_BYTES + 1 }, file)).toEqual({ ok: false, error: 'File too large (max 15MB)' });
  });

  it('keeps the file NAME the operator picked — it is what finance sees in the inbox', () => {
    expect(chooseUpload(null, { ...file, name: 'TNB bill Aug 2026.pdf' })).toMatchObject({ fileName: 'TNB bill Aug 2026.pdf' });
  });
});

describe('the upload POST body — no golden sees a request', () => {
  const f = {
    tenant: COMPANIES[0].tenant_id, category: 'AP Supplier Bill', fileName: 'march-rent.pdf',
    contentBase64: 'data:application/pdf;base64,AAA', contentType: 'application/pdf', note: 'March rent invoice',
  };

  it('files against the tenant it is handed, and carries it verbatim', () => {
    expect(uploadBody(f)).toMatchObject({ api: 'upload', tenant: COMPANIES[0].tenant_id });
    expect(uploadBody({ ...f, tenant: COMPANIES[1].tenant_id }).tenant).toBe(COMPANIES[1].tenant_id);
  });

  it('REFUSES a blank tenant rather than defaulting to the first company', () => {
    // The one that costs money quietly: a document filed against the wrong company sits in another
    // company's payables inbox and is reconciled against another company's ledger. Throwing is the
    // point — a silent default is invisible until a month-end that does not balance.
    expect(() => uploadBody({ ...f, tenant: '' })).toThrow(/wrong tenant/);
  });

  it('sends an empty note as an empty string, as the legacy does — not as a missing key', () => {
    expect(uploadBody({ ...f, note: '' }).note).toBe('');
  });

  it('carries exactly the fields doUpload() sends, and no others', () => {
    // Read out of app.html at run time rather than retyped: an extra field on this body is something the
    // legacy screen never let anyone attach to a document.
    const at = APP.indexOf("const r=await call({api:'upload'");
    expect(at).toBeGreaterThan(0);
    // `[a-z_0-9]` and not `[a-z_]`: `content_base64` ends in DIGITS, and the narrower class silently
    // drops exactly the key that carries the document — an omission that would leave this assertion
    // passing while the field it exists to protect went unchecked.
    const legacy = [...new Set([...APP.slice(at, APP.indexOf('});', at)).matchAll(/([a-z_0-9]+)\s*:/g)].map((m) => m[1]))].sort();
    expect(legacy).toContain('content_base64');
    expect(Object.keys(uploadBody(f)).sort()).toEqual(legacy);
  });
});
