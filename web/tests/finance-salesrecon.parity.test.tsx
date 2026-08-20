// Finance OS · Sales Reconciliation — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.salesrecon.html` was captured from `renderSalesRecon()` (app.html:3568) by the
// 40-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts, tests/parity.ts or tests/handlers.ts.
//
// NO SEVENTH RELAXATION. This reuses ./parity.ts's six unchanged, which is what twenty-seven screens
// have now done. One SCREEN-LOCAL rule is needed and it is an established KIND, not a new one:
// `decodeTextAmp`, hr-payslip's rule, because `renderSalesRecon()` writes a bare `&` into text without
// `esc()` ("SO numbers, date & amount columns", app.html:3583) and React's text escaper always emits
// `&amp;`. It lives here rather than in parity.ts for the reason hr-employees' `decodeAttrAmp` and
// hr-payroll's `decodeNamedRefs` do — one screen is not evidence about the shared layer — and it carries
// its own "cannot hide" block below. It is the SECOND screen of the bare-`&`-in-text kind.
//
// ── ONE MODE, AND THE GOLDEN COVERS IT ─────────────────────────────────────────────────────────────
// No sub-views, no sub-nav, no sibling page: `render('salesrecon')` dispatches to `renderSalesRecon()`
// and that function owns every byte of `#salesrecon`. Both panels are in the golden and nothing hands
// off to app.html. Contrast `finance.users` (five sub-views, one golden) and `finance.wht`
// (`whtDocHtml()` is a sibling page).
//
// ── WHAT THE GOLDEN DOES NOT REACH, and where that is pinned instead ───────────────────────────────
// `#sr-result` is captured as `class="panel hide"` with `#sr-cards`, `#sr-acctbody`, `#sr-tally`,
// `#sr-tbody` and `#sr-note` empty — so every figure an operator reads before pressing "Create in Xero"
// is outside the diff, as are the file chips' names and their green borders. Those are pinned by their
// own cases below, and so is the whole of salesrecon.js, which no golden can see at all and which
// decides what a real Xero ledger says.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  SR_ACCNAME, SR_POST_CHUNK, SR_TENANT, SR_XERO_COLS,
  srApplySoSuffix, srApplyYrdz, srBuildLines, srCsv, srOrderLookup, srPostBody, srPostChunks,
  srReportSheets, srSoBases, srSummary, srTally, srYrdzPeriods,
  type SrLine, type SrOrder, type SrSoInfo,
} from '../../salesrecon.js';
import FinanceSalesRecon, { salesreconReachable, type SrResult } from '../src/finance-salesrecon';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `#salesrecon` is the tab div `render('salesrecon')` writes into (app.html:1166) — the only section. */
const GOLDEN = goldenSection('finance.salesrecon', 'salesrecon');

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');

/**
 * SCREEN-LOCAL RULE — a bare `&` written into TEXT without `esc()`.
 *
 * hr-payslip's `decodeTextAmp`, copied rather than shared: `renderSalesRecon()`'s help paragraph writes
 * "SO numbers, date & amount columns" straight into its HTML string, so the golden holds one `&`
 * character. React's text escaper ALWAYS emits `&amp;` and there is no JSX spelling that produces a bare
 * `&` in text, so neither side can be written into the other. Applied identically to both sides.
 *
 * Narrow on purpose:
 *   • OUTSIDE tags only, so an attribute value is untouched (`decodeAttrAmp` is a different screen's rule);
 *   • never where `&amp;` PREFIXES another reference, so a doubly-escaped `&amp;lt;` — the defect where
 *     the entity itself prints on screen — stays visible;
 *   • it decodes nothing else, so `&lt;amount&gt;` (which BOTH sides spell identically) is left alone.
 * It cannot absorb a changed number, a dropped row, a renamed label or a missing attribute: it rewrites
 * six characters into one, in text, on both sides.
 */
function decodeTextAmp(html: string): string {
  return html.replace(/(^|>)([^<]*)/g, (_m, lead: string, text: string) =>
    lead + text.replace(/&amp;(?!(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#[xX][0-9a-fA-F]+);)/g, '&'));
}

const cmp = (html: string) => decodeTextAmp(relax(html));

type Props = Parameters<typeof FinanceSalesRecon>[0];

const noop = () => {};

function screen(over: Partial<Props> = {}) {
  return (
    <FinanceSalesRecon
      // The golden's state: `renderSalesRecon()` writes both chips as "not loaded", the build button
      // disabled and `#sr-result` hidden with every body div empty.
      ofName={null}
      sfName={null}
      canBuild={false}
      posting={false}
      result={null}
      onReset={noop}
      onOpenPicker={noop}
      onBuild={noop}
      onPostXero={noop}
      onDownloadCsv={noop}
      onDownloadXlsx={noop}
      {...over}
    />
  );
}

const rendered = (over: Partial<Props> = {}) => cmp(renderToStaticMarkup(screen(over)));

// ── FIXTURES ──────────────────────────────────────────────────────────────────────────────────────
// An Order Form and a Sales sheet chosen so the arithmetic has something to get wrong: one SO paid in
// two instalments (pass 3 must suffix the second), one SO short-paid (pass 4 must report it), one
// payment with no SO at all (pass 2 must number it YRDZ).

const OF_AOA: unknown[][] = [
  ['Order No', 'Channel', 'Package', 'Order Date', 'Grand Total'],
  ['SO-IP40466', 'SHOPEE', 'Repurchase Package', '2026-06-30', 900],
  ['SO-IP40477', 'WEBSTORE', 'Standard Offer', '2026-07-01', 500],
];

const SALES_ROWS: Record<string, unknown>[] = [
  { 'PIC Name': 'SO-IP40466', 'Transaction Date': '01/07/2026', 'Transaction Amount': 400 },
  { 'PIC Name': 'SO-IP40466', 'Transaction Date': '15/07/2026', 'Transaction Amount': 500 },
  { 'PIC Name': 'SO-IP40477', 'Transaction Date': '02/07/2026', 'Transaction Amount': 300 },
  { 'PIC Name': 'walk-in', 'Transaction Date': '03/07/2026', 'Transaction Amount': 120.5 },
];

function build(soInfo: Record<string, SrSoInfo> = {}, base: Record<string, number> = {}) {
  const lk = srOrderLookup(OF_AOA);
  const LK: Record<string, SrOrder> = lk.lookup;
  const out = srBuildLines(LK, [{ name: 'ATOME', rows: SALES_ROWS }]).lines;
  srApplyYrdz(out, base);
  srApplySoSuffix(out, soInfo);
  return { lines: out, LK, tally: lk.hasGrandTotal ? srTally(out, LK, soInfo) : null };
}

function result(): SrResult {
  const b = build();
  return { lines: b.lines, summary: srSummary(b.lines), tally: b.tally };
}

describe('Finance Sales Reconciliation — React vs the legacy golden', () => {
  it('renders the same document as renderSalesRecon() does', () => {
    expect(rendered()).toBe(cmp(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

describe('the golden is the screen on tab open — not an intermediate state', () => {
  // `finance.qinv`'s baseline is missing a row every operator sees (`qiAddLine()` after the write), and
  // `finance.users`'s shows no highlighted sub-tab (a `.className=` after the write). This asserts the
  // opposite for this screen against app.html's own text, so a `qiAddLine`-style line added later fails
  // a test instead of silently invalidating the diff.
  const fn = APP.slice(APP.indexOf('function renderSalesRecon()'), APP.indexOf('function srReset()'));
  const after = fn.slice(fn.indexOf("<div class=\"muted\" style=\"font-size:11px;margin-top:10px\" id=\"sr-note\"></div></div>';"));

  it('does nothing after its innerHTML write except attach listeners', () => {
    expect(after).toContain('addEventListener');
    for (const forbidden of ['appendChild', '.className=', 'innerHTML', 'setTimeout', 'classList', 'await ']) {
      expect(after).not.toContain(forbidden);
    }
    // `.value=''` inside the change listener is a reset of the file input, which carries no value in any
    // markup; the only assignments left are the drag-hover border colours.
    expect([...after.matchAll(/\.style\.borderColor=/g)].length).toBeGreaterThan(0);
  });

  it('is not on render(t)\'s asyncTabs list, so nothing is fetched before it paints', () => {
    const list = APP.slice(APP.indexOf('const asyncTabs='), APP.indexOf('\n', APP.indexOf('const asyncTabs=')));
    expect(list).not.toContain('salesrecon');
  });

  it('has exactly one mode — no sub-view is dispatched inside the tab', () => {
    // `finance.users` turned out to hold five. This screen's renderer writes one document and the tab
    // dispatch reaches it directly.
    expect(APP).toContain("if(t==='salesrecon') return renderSalesRecon();");
    expect(fn).not.toMatch(/SR\.(page|view|sub)\b/);
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * Six handlers in the golden, all `onclick`, none of which identifies a row: five are argument-free
 * calls and one is an inline DOM statement. So argument parity alone is close to vacuous here and a
 * golden-DERIVED `LEGACY_TO_PROP` compares handler IDENTITY as well — hr-payroll's widening, keyed on
 * the WHOLE raw text first because app.html writes inline statements, as finance-wht's is.
 *
 * `identArgs()` is NOT copied: nothing on this screen identifies a row by a bare integer.
 *
 * The POSITIONAL ESCAPE is hr-expenses' `event.stopPropagation()` case and finance-pharm's hover case:
 * the drop zone's `onclick="document.getElementById('sr-fi').click()"` calls no screen function, so
 * `goldenHandlers()` reads an argument (`'sr-fi'`) that the React equivalent cannot record. It is
 * allowed to record nothing ONLY at the position where the golden's own text is exactly that statement,
 * so a handler that quietly stopped calling anything still fails.
 */
const LEGACY_TO_PROP: Record<string, string> = {
  "document.getElementById('sr-fi').click()": 'openPicker',
  'srReset()': 'reset',
  'srBuild()': 'build',
  'srPostXero()': 'postXero',
  'srDownloadCSV()': 'downloadCsv',
  'srDownloadXlsx()': 'downloadXlsx',
};

const DOM_ONLY = "document.getElementById('sr-fi').click()";

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
    onReset: record('reset') as never,
    onOpenPicker: record('openPicker') as never,
    onBuild: record('build') as never,
    onPostXero: record('postXero') as never,
    onDownloadCsv: record('downloadCsv') as never,
    onDownloadXlsx: record('downloadXlsx') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  // The positional escape: only where the golden's own text is the DOM-only statement may the React
  // side record nothing.
  expect(calls.map((c) => c.args)).toEqual(want.map((h) => (h.raw === DOM_ONLY ? [] : h.args)));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard: every golden handler resolved to a KNOWN prop. A new button in app.html falls
  // through `?? raw` and fails here rather than passing silently.
  expect(want.length).toBe(6);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
  expect(want.filter((h) => h.raw === DOM_ONLY)).toHaveLength(1);
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

describe('the comparison still bites', () => {
  const want = cmp(GOLDEN);

  it('catches the result panel un-hiding — a branch no golden holds', () => {
    // Proves the golden really is the pre-build state, so everything pinned below is genuinely outside
    // the diff rather than accidentally inside it.
    expect(rendered({ result: result() })).not.toBe(want);
  });

  it('catches a loaded file chip', () => {
    expect(rendered({ ofName: 'Order Form July.xlsx' })).not.toBe(want);
    expect(rendered({ sfName: 'Sales.xlsx · 5 sheets' })).not.toBe(want);
  });

  it('catches the Reconcile button losing its disabled attribute', () => {
    // It is disabled until BOTH files are loaded. A port that enabled it early would let an operator
    // build from one file and post half an import.
    expect(rendered({ canBuild: true })).not.toBe(want);
  });

  it('catches the file input losing multiple or its accept list', () => {
    expect(cmp(renderToStaticMarkup(screen()).replace(' multiple', ''))).not.toBe(want);
    expect(cmp(renderToStaticMarkup(screen()).replace('.xlsx,.xls', '.xlsx'))).not.toBe(want);
  });

  it('catches the drop zone losing its id — the route attaches the drag listeners by it', () => {
    expect(cmp(renderToStaticMarkup(screen()).replace('id="sr-drop"', ''))).not.toBe(want);
    expect(cmp(renderToStaticMarkup(screen()).replace('id="sr-fi"', ''))).not.toBe(want);
  });

  it('catches the help paragraph losing the YRDZ numbering promise', () => {
    // That sentence is the operator's assurance that a re-import will not duplicate a month.
    expect(cmp(renderToStaticMarkup(screen()).replace('continues from the highest YRDZ number already in Xero', 'starts at 0001'))).not.toBe(want);
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────

  it('catches Create-in-Xero and the CSV download swapped', () => {
    expect(() => assertHandlerParity({ onPostXero: (() => misfire()) as never })).toThrow();
  });

  it('catches Clear wired to the build action', () => {
    expect(() => assertHandlerParity({ onReset: (() => misfire()) as never })).toThrow();
  });

  it('catches the drop zone handed an argument it never had, or none of the six going missing', () => {
    expect(() => assertHandlerParity({ onOpenPicker: (() => misfire('sr-fi')) as never })).toThrow();
  });

  it('carries six click handlers and nothing else — no drag or change props', () => {
    // The realistic port mistake: turning the four addEventListener calls into React props. They are not
    // attributes in the golden, so they would show up here as extra handlers.
    expect(reactHandlers(screen()).map((h) => h.attr)).toEqual(Array(6).fill('onclick'));
    expect(goldenHandlers(GOLDEN).map((h) => h.attr)).toEqual(Array(6).fill('onclick'));
  });
});

describe('decodeTextAmp cannot hide a real change', () => {
  const base = renderToStaticMarkup(screen());

  it('leaves &lt; / &gt; alone, so the YRDZ package template still diffs', () => {
    expect(base).toContain('YRDZ_Package_&lt;amount&gt;');
    expect(decodeTextAmp(base)).toContain('YRDZ_Package_&lt;amount&gt;');
    expect(cmp(base.replace('YRDZ_Package_&lt;amount&gt;', 'YRDZ_Package_&lt;total&gt;'))).not.toBe(cmp(GOLDEN));
  });

  it('does NOT decode a doubly-escaped entity — the defect where it prints on screen', () => {
    expect(decodeTextAmp('<p>&amp;lt;x&amp;gt;</p>')).toBe('<p>&amp;lt;x&amp;gt;</p>');
    expect(decodeTextAmp('<p>&amp;#8599;</p>')).toBe('<p>&amp;#8599;</p>');
  });

  it('does not touch attribute values', () => {
    expect(decodeTextAmp('<a href="?a=1&amp;b=2">x</a>')).toBe('<a href="?a=1&amp;b=2">x</a>');
  });

  it('still catches a dropped word around the ampersand it decodes', () => {
    expect(cmp(base.replace('date &amp; amount columns', 'amount columns'))).not.toBe(cmp(GOLDEN));
  });
});

describe('the admin gate — app.html:1433, and it is NOT its neighbours\' gate', () => {
  it('opens for an administrator', () => {
    expect(salesreconReachable({ manage_users: true })).toBe(true);
  });

  it('is closed for every other shape of permission, including a missing one', () => {
    for (const p of [null, undefined, {}, { manage_users: false }, { features: ['salesrecon'] }]) {
      expect(salesreconReachable(p as never)).toBe(false);
    }
  });

  it('is NOT the feature flag — the feature list alone does not open it', () => {
    // The mistake this catches is copying `reconReachable()` / `collectionsReachable()`. Sales Recon is
    // NAMED in showApp()'s chain and takes the `!canManage` branch, so it never reaches the final
    // `else`. Four screens have now found their gate was not their neighbours'.
    expect(salesreconReachable({ features: ['salesrecon', 'recon', 'o2o'] } as never)).toBe(false);
    expect(salesreconReachable({ manage_users: true, features: [] } as never)).toBe(true);
  });

  it('mirrors the legacy line verbatim, so the predicate cannot quietly stop matching app.html', () => {
    const block = APP.slice(APP.indexOf("document.querySelectorAll('.tab').forEach"), APP.indexOf('// Hide any category'));
    expect(block).toContain("else if(t==='salesrecon') el.classList.toggle('hide', !canManage);");
    // and it is inside the if/else if chain, so it never falls through to the feature flag
    expect(block.indexOf("t==='salesrecon'")).toBeLessThan(block.indexOf('feats.indexOf(t)<0'));
  });

  it('is what the route gates on — the screen names an admin-only import target', () => {
    // Guard the guard. The server wants superAdmin on all three sr_* handlers (finance.ts:857/899/926),
    // so this is tab visibility; but the screen still tells anyone who reaches it how a real ledger is
    // filled, and the buttons on it create draft invoices in it.
    const html = renderToStaticMarkup(screen({ result: result() }));
    expect(html).toContain('SO-IP40466');
    expect(html).toContain('Create in Xero (DRAFT)');
  });
});

describe('the four passes — what no golden can see, and what a wrong answer costs', () => {
  it('matches each payment to ITS order, and takes the order\'s channel account and package', () => {
    const { lines } = build();
    expect(lines.map((l) => l.so)).toEqual(['SO-IP40466', 'SO-IP40466', 'SO-IP40477', null]);
    // SHOPEE → 500-0400, WEBSTORE → 500-0200. A row matched to the wrong sale lands the money in the
    // wrong revenue account AND on the wrong customer's order.
    expect(lines.map((l) => l.acc)).toEqual(['500-0400', '500-0400', '500-0200', '500-1000']);
    expect(lines.map((l) => l.desc)).toEqual(['Repurchase Package', 'Repurchase Package', 'Standard Offer', 'YRDZ_Package_120.50']);
  });

  it('invoices the amount RECEIVED, never the order total', () => {
    // SO-IP40477's order is 500 and only 300 was paid. Invoicing 500 would bill a customer for money
    // they have not sent; the shortfall is a tally row, not an invoice line.
    const { lines } = build();
    expect(lines.map((l) => l.amt)).toEqual([400, 500, 300, 120.5]);
  });

  it('dates each line by the payment transaction date, DD-MM-YYYY', () => {
    const { lines } = build();
    expect(lines.map((l) => l.date)).toEqual(['01-07-2026', '15-07-2026', '02-07-2026', '03-07-2026']);
    expect(lines.every((l) => l.due === l.date)).toBe(true);
  });

  it('suffixes the SECOND payment on one SO, and leaves the first bare', () => {
    const { lines } = build();
    expect(lines.map((l) => l.inv)).toEqual(['SO-IP40466', 'SO-IP40466_1', 'SO-IP40477', "YRDZ_07'2026_0001"]);
  });

  it('does NOT re-offer a number already imported into Xero', () => {
    // The brief's "already-imported row still offering its import action". `sr_so_suffix` says the base
    // is taken; both payments must move past it, or the import collides in Xero and the batch fails.
    const taken: Record<string, SrSoInfo> = { 'SO-IP40466': { taken: true, max: 0, prev_total: 900 } };
    expect(build(taken).lines.map((l) => l.inv).slice(0, 2)).toEqual(['SO-IP40466_1', 'SO-IP40466_2']);
    // base free but _1 already exists → base first, then continue PAST _1
    const gap: Record<string, SrSoInfo> = { 'SO-IP40466': { taken: false, max: 1, prev_total: 0 } };
    expect(build(gap).lines.map((l) => l.inv).slice(0, 2)).toEqual(['SO-IP40466', 'SO-IP40466_2']);
  });

  it('continues YRDZ numbering from what is already in Xero, rather than restarting at 0001', () => {
    // Restarting duplicates a month that was already imported — the single reason sr_yrdz_next exists.
    const notes = (() => {
      const lk = srOrderLookup(OF_AOA);
      const out = srBuildLines(lk.lookup, [{ name: 'ATOME', rows: SALES_ROWS }]).lines;
      const n = srApplyYrdz(out, { "YRDZ_07'2026_": 42 });
      expect(out[3].inv).toBe("YRDZ_07'2026_0043");
      return n;
    })();
    expect(notes).toEqual(["07'2026 continues from 0043"]);
    expect(srYrdzPeriods(build().lines)).toEqual(["07'2026"]);
  });

  it('asks about exactly the periods and SO bases it needs, deduplicated', () => {
    const { lines } = build();
    expect(srYrdzPeriods(lines)).toEqual(["07'2026"]);
    // srSoBases runs BEFORE the suffixing in the real flow; here the lines are already suffixed, so
    // rebuild the un-suffixed state to pin what is asked.
    const lk = srOrderLookup(OF_AOA);
    const raw = srBuildLines(lk.lookup, [{ name: 'ATOME', rows: SALES_ROWS }]).lines;
    expect(srSoBases(raw)).toEqual(['SO-IP40466', 'SO-IP40477']);
  });

  it('reports a short payment instead of hiding it, and calls a one-sen difference a tally', () => {
    const t = build().tally!;
    const short = t.find((x) => x.so === 'SO-IP40477')!;
    expect(short.st).toBe('short');
    expect(short.order).toBe(500);
    expect(short.file).toBe(300);
    expect(short.diff).toBe(-200);
    expect(t.find((x) => x.so === 'SO-IP40466')!.st).toBe('tally');
  });

  it('counts money ALREADY invoiced in Xero towards the order total', () => {
    // Without prev_total a second-instalment file reads as short-paid on every SO in it.
    const soInfo: Record<string, SrSoInfo> = { 'SO-IP40477': { taken: true, max: 0, prev_total: 200 } };
    const t = build(soInfo).tally!;
    expect(t.find((x) => x.so === 'SO-IP40477')!.st).toBe('tally');
  });

  it('skips the tally entirely when the Order Form has no Grand Total column', () => {
    const noGt = OF_AOA.map((r) => r.slice(0, 4));
    expect(srOrderLookup(noGt).hasGrandTotal).toBe(false);
    expect(srOrderLookup(OF_AOA).hasGrandTotal).toBe(true);
  });

  it('reports an unrecognisable sheet rather than silently dropping it', () => {
    const built = srBuildLines(srOrderLookup(OF_AOA).lookup, [
      { name: 'ATOME', rows: SALES_ROWS },
      { name: 'NOTES', rows: [] },
      { name: 'JUNK', rows: [{ a: 'x', b: 'y' }] },
    ]);
    expect(built.skipped).toEqual(['NOTES (empty)', 'JUNK (no date/amount columns recognised)']);
    expect(built.lines).toHaveLength(4);
  });
});

describe('the totals — a sum that stops summing', () => {
  it('adds up every line, matched and unmatched', () => {
    const s = srSummary(build().lines);
    expect(s.tot).toBeCloseTo(1320.5, 10);
    expect(s.matched).toBe(3);
    expect(s.unmatched).toBe(1);
    expect(s.unmatchedAmt).toBe(120.5);
  });

  it('groups by Xero account, with the channels that fed each one', () => {
    const s = srSummary(build().lines);
    expect(Object.keys(s.byAcc).sort()).toEqual(['500-0200', '500-0400', '500-1000']);
    expect(s.byAcc['500-0400']).toMatchObject({ n: 2, amt: 900 });
    expect(Object.keys(s.byAcc['500-0400'].ch)).toEqual(['SHOPEE']);
  });

  it('renders those figures, not re-derived ones', () => {
    const html = renderToStaticMarkup(screen({ result: result() }));
    expect(html).toContain('>4</div>');                       // Sales invoice lines
    expect(html).toContain('RM 1,320.50');                    // Total (actual received)
    expect(html).toContain('1 · RM 120.50');                  // Unmatched (YRDZ)
    expect(html).toContain(SR_ACCNAME['500-0400']);           // the account NAME, from salesrecon.js
  });

  it('a row dropped from the preview does not change the totals or the note', () => {
    // The preview is capped at 150 and the cards are computed from ALL lines — mixing the two would
    // under-report the batch an operator is about to create.
    const r = result();
    const html = renderToStaticMarkup(screen({ result: r }));
    expect(html).toContain('Preview shows first 4 of 4 lines.');
    const many: SrLine[] = Array.from({ length: 160 }, (_v, i) => ({ ...r.lines[0], inv: 'SO-X' + i }));
    const h2 = renderToStaticMarkup(screen({ result: { lines: many, summary: srSummary(many), tally: null } }));
    expect(h2).toContain('Preview shows first 150 of 160 lines.');
    expect([...h2.matchAll(/<tr>/g)].length).toBeLessThan(160);
  });
});

describe('what leaves the building — the CSV and the POST body', () => {
  it('writes the exact 29-column Xero Sales Invoices template, in order', () => {
    const csv = srCsv(build().lines);
    const head = csv.replace(/^﻿/, '').split('\r\n')[0];
    expect(head).toBe(SR_XERO_COLS.join(','));
    expect(SR_XERO_COLS).toHaveLength(29);
  });

  it('puts the number, the date, the amount and the account where Xero reads them', () => {
    const rows = srCsv(build().lines).replace(/^﻿/, '').split('\r\n');
    expect(rows[1]).toContain('SO-IP40466');
    expect(rows[1]).toContain('01-07-2026');
    expect(rows[1]).toContain('400.00');
    expect(rows[1]).toContain('500-0400');
    expect(rows).toHaveLength(5);   // header + four lines, nothing dropped
  });

  it('carries the BOM and CRLF, and quotes a field containing a comma', () => {
    const lines = build().lines;
    lines[0].desc = 'Package, large';
    const csv = srCsv(lines);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv).toContain('"Package, large"');
  });

  it('ends with no TOTAL row — the CSV is invoices, and a total would import as one', () => {
    const rows = srCsv(build().lines).replace(/^﻿/, '').trim().split('\r\n');
    expect(rows[rows.length - 1]).not.toMatch(/TOTAL/i);
  });

  it('posts each line once, in batches of 150, with the fields the server forwards', () => {
    const lines = build().lines;
    const chunks = srPostChunks(lines);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(4);
    expect(chunks[0][0]).toEqual({ number: 'SO-IP40466', date: '01-07-2026', due: '01-07-2026', desc: 'Repurchase Package', qty: 1, amount: 400, account: '500-0400', contact: 'DATABEES' });
    const many = Array.from({ length: 310 }, (_v, i) => ({ ...lines[0], inv: 'SO-Y' + i }));
    expect(srPostChunks(many).map((c) => c.length)).toEqual([150, 150, 10]);
    expect(SR_POST_CHUNK).toBe(150);
    // every line reaches exactly one chunk
    expect(new Set(srPostChunks(many).flat().map((x) => x.number)).size).toBe(310);
  });

  it('refuses to build a post body with no tenant — it does not default to one', () => {
    // These invoices go into a named company's ledger. A batch posted against the wrong tenant is a set
    // of real draft invoices in the wrong Xero org, and nothing on screen would say so.
    expect(() => srPostBody('', [])).toThrow(/tenant/);
    expect(srPostBody(SR_TENANT, [])).toEqual({ api: 'sr_post_invoices', tenant: SR_TENANT, invoices: [] });
    expect(SR_TENANT).toBe('99911869-9e91-4572-b7dc-4db51b45b6a9');
  });

  it('builds the xlsx report from the same lines, tally sheet only when there is a tally', () => {
    const b = build();
    expect(srReportSheets(b.lines, b.tally).map((s) => s.name)).toEqual(['Sales Import', 'Xero Summary', 'Unmatched (YRDZ)', 'SO Tally']);
    expect(srReportSheets(b.lines, null).map((s) => s.name)).toEqual(['Sales Import', 'Xero Summary', 'Unmatched (YRDZ)']);
    const un = srReportSheets(b.lines, null)[2].rows;
    expect(un).toHaveLength(2);   // header + the one unmatched line
  });
});

describe('the import cannot fire twice from one press', () => {
  it('disables the Create-in-Xero button while a post is in flight', () => {
    expect(renderToStaticMarkup(screen({ result: result(), posting: true }))).toContain('id="sr-post-btn" disabled=""');
    expect(renderToStaticMarkup(screen({ result: result(), posting: false }))).not.toContain('id="sr-post-btn" disabled=""');
  });

  it('keeps the legacy re-entrancy guard in app.html, which the route mirrors', () => {
    // The disabled attribute does not stop a keyboard activation, so the state guard is the real one.
    expect(APP).toContain("if(SR._posting){ toast('Already posting…',true); return; }");
  });
});
