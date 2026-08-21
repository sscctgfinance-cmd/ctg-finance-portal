// Finance OS · P&L Analysis — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.pnl.html` was captured from `renderPnl()` / `pnlRender()` (app.html:4359) by the
// 40-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts, web/tests/parity.ts or web/tests/handlers.ts. The component is rendered with
// `renderToStaticMarkup` from the SAME fixture the golden was captured from — tests/render_fixtures.ts,
// imported directly.
//
// NO SEVENTH RELAXATION, and none was needed: ./parity.ts's six are reused unchanged, as thirty-one
// screens before this one did.
//
// ── SECTIONS AND MODES, DECLARED ──────────────────────────────────────────────────────────────────
// ONE golden section (`#pnl`), because `renderPnl()` and `pnlRender()` write the SAME element id — the
// spinner first, the screen second — and the harness's last-write-wins is per id. That makes this the
// `finance.approvals` case, NOT the `finance.qinv` one: the golden is the screen an operator sees, and
// `pnlRender()` really does nothing after its innerHTML write. `the golden is the LOADED screen` below
// proves both halves out of app.html rather than asserting them.
//
// The screen has THREE pre-load documents (spinner / `!r.ok` refusal / thrown error) and, once loaded,
// SIX independent binary modes: account grid vs monthly-totals fallback (`mdl.hasRows`), 6 vs 12
// months, show-zero off vs on, chart with cost blocks vs the "no cost-block data" line, consolidated vs
// company-scoped, and `generated_at` present vs absent. The golden covers ONE combination — loaded,
// grid, 6 months, show-zero off, NO blocks in the fixture so the chart's empty branch, consolidated, no
// `generated_at` — and none of the three pre-load documents. Everything the diff does not reach is
// pinned by assertion in `beyond the golden` below.
//
// ── THE ONE SCREEN-LOCAL RULE: AN EMPTY `style=""` ATTRIBUTE ───────────────────────────────────────
// `pnlCell()` interpolates a conditional straight into an attribute (app.html:4382,
// `'<td class="pnl-num '+(cls||'')+'" style="'+col+'">'`), so every NON-NEGATIVE figure reaches the
// golden carrying `style=""`. React cannot emit that at all — an empty style object, an empty
// declaration value and an undefined one all serialise to NO attribute. `dropEmptyStyle` below removes
// exactly ` style=""` from BOTH sides, held to parity.ts's bar and with its own "cannot hide" block.
// It is the same rule finance-close carries and it stays screen-local for that file's reason: parity.ts
// is shared with in-flight sibling migrations, and two screens is the point at which CLAUDE.md says to
// keep copying, not to widen the shared layer.
//
// ── WHAT THIS SCREEN RISKS ─────────────────────────────────────────────────────────────────────────
// Every figure here is a reported financial number. A line that stops summing into its subtotal, a
// subtotal that stops rolling into Total Operating Expenses, Gross Profit computed the wrong way round,
// Net Profit silently recomputed instead of taken from Xero, a % taken against the wrong month's
// revenue, a month header that does not match the column beneath it, a zero-value account that stops
// being filtered — each has its own case below.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { pnlBuild, pnlCsvLines, pnlCsvName } from '../../pnl.js';
import { FIXTURES } from '../../tests/render_fixtures';
import FinancePnl, {
  BlockChart, PnlFailure, PnlLoading, pnlReachable,
  type PnlData, type Props,
} from '../src/finance-pnl';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `#pnl` is the tab div `render('pnl')` writes into. It is the golden's ONLY section. */
const GOLDEN = goldenSection('finance.pnl', 'pnl');

const DATA = FIXTURES.pnl_analysis as PnlData;

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');
const SRC = readFileSync(join(REPO, 'web', 'src', 'finance-pnl.tsx'), 'utf8');

const noop = () => {};

function props(over: Partial<Props> = {}): Props {
  // The state the harness captured: consolidated, 6 months, zero-value accounts hidden.
  return {
    data: DATA, months: 6, showZero: false, scopeCo: null,
    onMonths: noop, onToggleZero: noop, onExport: noop, onRefresh: noop, ...over,
  };
}

const screen = (over: Partial<Props> = {}) => <FinancePnl {...props(over)} />;

/**
 * AN EMPTY `style=""` ATTRIBUTE, dropped from BOTH sides.
 *
 * What it absorbs: an attribute that declares nothing. `style=""` and no style attribute are the same
 * element to a parser, to the CSSOM and to a user — there is no declaration either way.
 *
 * What it cannot absorb, each proven by the `still bites` block below:
 *   • a style with ANY content — `style="color:var(--coral-soft)"` is not `style=""` and is left alone,
 *     so a negative figure that lost its coral, or a positive one that gained it, still diffs. On this
 *     screen that is the sign convention: a cost reading as income;
 *   • a changed number, a dropped row, a renamed label or a lost class — none of those is an empty
 *     attribute, and the rule matches nothing but the exact 9 characters ` style=""`;
 *   • any OTHER empty attribute — `class=""` is untouched, and this screen's account rows and its
 *     12-months button both carry one.
 */
const dropEmptyStyle = (html: string) => html.replace(/ style=""/g, '');

/** Both sides read as the same document, then compared under ./parity.ts's six relaxations. */
const sameDocument = (html: string) => relax(dropEmptyStyle(html));

const rendered = (over: Partial<Props> = {}) => sameDocument(renderToStaticMarkup(screen(over)));

describe('Finance P&L Analysis — React vs the legacy golden', () => {
  it('renders the same screen pnlRender() writes into #pnl', () => {
    expect(rendered()).toBe(sameDocument(GOLDEN));
  });

  it('wires the same handlers, to the same controls, in the same order', () => {
    assertHandlerParity();
  });
});

describe('the golden is the LOADED screen — proven out of app.html', () => {
  // CLAUDE.md: check what the legacy renderer does AFTER its innerHTML write before trusting a golden.
  const renderFn = APP.slice(APP.indexOf('async function renderPnl()'), APP.indexOf('function pnlSetMonths('));
  const pnlRenderFn = APP.slice(APP.indexOf('function pnlRender(){'), APP.indexOf('// CSV of the grid exactly as displayed'));

  it('renderPnl() writes #pnl with a spinner and then pnlRender() OVERWRITES the same id', () => {
    expect(renderFn).toContain("var el=document.getElementById('pnl')");
    expect(renderFn).toContain('<div class="spinner"');
    expect(renderFn).toContain('PNL_DATA=r; loaded.pnl=true; pnlRender();');
    // Same element, so last-write-wins keeps only the second — the finance.approvals case.
    expect(pnlRenderFn).toContain('el.innerHTML=controls+kpis+');
    expect(GOLDEN).not.toContain('spinner');
    expect(GOLDEN).toContain('pnl-kpis');
  });

  it('pnlRender() does nothing after its write — no appendChild, no .value=, no classList', () => {
    // The finance.qinv / finance.users / finance.gateway trap. The innerHTML assignment is pnlRender()'s
    // LAST statement, so there is no invisible mutation the golden could be missing.
    const after = pnlRenderFn.slice(pnlRenderFn.indexOf('el.innerHTML=controls+kpis+'));
    for (const s of ['appendChild', '.value=', 'setTimeout', 'classList', '.textContent', '.disabled']) {
      expect(after).not.toContain(s);
    }
  });

  it('#pnl is the only id either function writes — there is no second section', () => {
    const ids = [...(renderFn + pnlRenderFn).matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
    expect([...new Set(ids)].sort()).toEqual(['pnl']);
    expect(GOLDEN.match(/<!-- #/g)).toBe(null);   // goldenSection() strips the marker; there is one.
  });

  it('the golden covers ONE of this screen’s modes — the others are asserted, not diffed', () => {
    // Declared in the header. Each claim is checked against the fixture the golden was captured from.
    expect(DATA.scoped_tenant).toBe(null);          // consolidated, not company-scoped
    expect(DATA.generated_at).toBe(undefined);      // no "refreshed …" suffix
    expect(DATA.blocks).toBe(undefined);            // chart takes its empty branch
    expect((DATA.rows || []).length).toBeGreaterThan(0);  // grid, not the totals fallback
    expect((DATA.months || []).length).toBe(6);     // 6-month mode
    expect(GOLDEN).toContain('No cost-block data for this period.');
    expect(GOLDEN).not.toContain('<svg');
    expect(GOLDEN).not.toContain('needs account cache');
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * The only defence this screen has against a control bound to the wrong thing, since R1 strips every
 * `on*=` from the string diff. TWO widenings, both established, both COPIED into this file rather than
 * pushed into the shared ./handlers.ts, which sibling migrations share:
 *
 * 1. `identArgs()` — `goldenHandlers()` collects QUOTED literals; both month buttons carry a BARE
 *    INTEGER (`pnlSetMonths(6)` / `pnlSetMonths(12)`), so quoted-only extraction returns [] for both
 *    and the check would pass with 6 and 12 swapped — a screen whose header says "6 months" over twelve
 *    columns of figures. This is the ninth screen to need it.
 *
 * 2. `LEGACY_TO_PROP` — three of the five handlers carry no arguments at all (`pnlToggleZero()`,
 *    `pnlExportCsv()` and the inline statement `PNL_DATA=null;renderPnl()`), so argument parity alone
 *    cannot tell them apart and "⬇ Export CSV" wired to Refresh would pass. Same treatment hr-payroll,
 *    finance-wht and finance-close gave it: a map DERIVED FROM THE GOLDEN'S OWN TEXT, compared as a
 *    sequence. Keyed on the WHOLE raw text first, because the Refresh handler is a statement, not a call.
 */
function identArgs(raw: string): string[] {
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|\b(-?\d+)\b/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

const LEGACY_TO_PROP: Record<string, string> = {
  'PNL_DATA=null;renderPnl()': 'refresh',
  'pnlToggleZero()': 'toggleZero',
  'pnlExportCsv()': 'export',
  pnlSetMonths: 'months',
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
        .filter((a) => (typeof a === 'string' || typeof a === 'number') && a !== STUB_VALUE)
        .map(String),
    });
  misfire = record('misfire');

  const got = reactHandlers(screen({
    onMonths: record('months') as never,
    onToggleZero: record('toggleZero') as never,
    onExport: record('export') as never,
    onRefresh: record('refresh') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => identArgs(h.raw)));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard: if the golden ever stops carrying handlers, the assertions above pass vacuously
  // and R1 becomes the blind strip it is not allowed to be. Three clauses, because this screen mixes
  // argument-carrying and argument-free handlers and either half alone can go quiet.
  expect(want.length).toBe(5);
  expect(want.some((h) => identArgs(h.raw).length > 0)).toBe(true);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

describe('the comparison still bites', () => {
  const want = rendered();

  /** Replace one account row of the fixture, leaving everything else alone. */
  const withRow = (account: string, by_month: Record<string, { amount: number }>) =>
    rendered({
      data: {
        ...DATA,
        rows: (DATA.rows || []).map((r) => (r.account === account ? { ...r, by_month } : r)),
      },
    });

  const months = DATA.months as string[];
  const rowOf = (account: string) => (DATA.rows || []).filter((r) => r.account === account)[0];
  const bump = (account: string, m: string, by: number) => {
    const src = rowOf(account).by_month as Record<string, { amount: number }>;
    const out: Record<string, { amount: number }> = {};
    months.forEach((k) => { out[k] = { amount: src[k].amount + (k === m ? by : 0) }; });
    return out;
  };

  it('the golden really holds the whole statement — every band, subtotal and key row', () => {
    // Guard the guard for the block: a golden that had captured the SPINNER, or an empty grid, would
    // make every case below vacuous. That is the finance.qinv trap, checked rather than assumed.
    for (const label of ['Trading Income', 'Total Trading Income', 'Cost of Sales', 'Total Cost of Sales',
      'Gross Profit', 'Other Income', 'Total Other Income', 'Operating Expenses', 'Total STAFF Cost',
      'Total BD&amp;M Cost', 'Total G&amp;A Cost', 'Total FIN Cost', 'Total Operating Expenses', 'Net Profit']) {
      expect(GOLDEN).toContain('>' + label + '</td>');
    }
    // 28 rows carrying a class: 4 section bands + 4 cost-block headings + 10 accounts + 8 subtotals +
    // 2 key rows. The header row is a bare `<tr>` and is not counted.
    expect((GOLDEN.match(/<tr /g) || []).length).toBe(28);
    expect((GOLDEN.match(/pnl-kpi-n/g) || []).length).toBe(4);
  });

  it('catches one sen on one account in one month', () => {
    // The smallest real change: it moves the account, its subtotal, Gross Profit, the row total and
    // three percentages. Nothing in relax() or dropEmptyStyle touches an attribute or a text VALUE.
    expect(withRow('Purchases', bump('Purchases', '2026-06', 0.01))).not.toBe(want);
  });

  it('catches a cost line that stops summing into its subtotal', () => {
    // Utilities dropped from G&A: the account row goes, Total G&A Cost falls, Total Operating Expenses
    // falls, and the Operating Expenses KPI with it. The defect the brief names first.
    const noUtilities = rendered({ data: { ...DATA, rows: (DATA.rows || []).filter((r) => r.account !== 'Utilities') } });
    expect(noUtilities).not.toBe(want);
    expect(noUtilities).not.toContain('RM 8,866.40');
  });

  it('catches a block that stops rolling into Total Operating Expenses', () => {
    // Re-labelling FIN's account into a block of its own leaves the same money on screen but moves it
    // out of FIN — Total FIN Cost collapses and a new block appears. Total Operating Expenses is
    // computed over `oe` as a whole, so it must NOT move: that is the invariant, asserted both ways.
    const moved = rendered({
      data: { ...DATA, rows: (DATA.rows || []).map((r) => (r.account === 'Bank charges' ? { ...r, block: 'TREASURY' } : r)) },
    });
    expect(moved).not.toBe(want);
    expect(moved).toContain('Total TREASURY Cost');
    expect(moved).toContain('RM 291,313.05');    // Total Operating Expenses, unchanged
  });

  it('catches the sign convention inverting — a cost reading as income', () => {
    // A negative amount is a credit/reversal and gets `style="color:var(--coral-soft)"`. dropEmptyStyle
    // removes only the EMPTY attribute, so the coral survives on one side and not the other.
    const credited = withRow('Bank charges', bump('Bank charges', '2026-08', -622));
    expect(credited).not.toBe(want);
    expect(credited).toContain('color:var(--coral-soft)');
    expect(want).not.toContain('style="color:var(--coral-soft)"');
  });

  it('catches Gross Profit computed the wrong way round', () => {
    // Cost of Sales − Trading Income instead of the other way about: same magnitudes, inverted sign.
    const mdl = pnlBuild(DATA, 6, false);
    const gp = mdl.rows.filter((r) => r.label === 'Gross Profit')[0];
    expect(gp.vals[0].amt).toBe(120904 - 48221.10);
    expect(gp.total).not.toBe(-(gp.total as number));
  });

  it('catches Net Profit being recomputed instead of taken from Xero', () => {
    // The fixture carries no `net_profit`, so every Net Profit cell is "—" and the KPI is "—". A port
    // that derived it as revenue − expenses would print figures where the legacy prints em dashes.
    const mdl = pnlBuild(DATA, 6, false);
    expect(mdl.npVals.every((c) => c.amt === null)).toBe(true);
    expect((GOLDEN.match(/<span class="muted">—<\/span>/g) || []).length).toBe(7);
    const derived = rendered({
      data: { ...DATA, totals: { ...(DATA.totals || {}), '2026-08': { revenue: 120904, net_profit: 27612.70 } } },
    });
    expect(derived).not.toBe(want);
  });

  it('catches a % taken against the wrong month’s revenue', () => {
    // Total Cost of Sales for 2026-08 is 39.9% of that month's Total Trading Income and 38.3% of the
    // month before. Moving revenue in ONE month changes only that column's shares.
    const shifted = withRow('Sales — Retail (O2O)', bump('Sales — Retail (O2O)', '2026-08', 10000));
    expect(shifted).not.toBe(want);
    expect(want).toContain('<span class="pnl-pct">39.9%</span>');
    expect(shifted).not.toContain('<span class="pnl-pct">39.9%</span>');
  });

  it('catches a month header that does not match the column beneath it', () => {
    const reordered = rendered({ data: { ...DATA, months: [...months].reverse() } });
    expect(reordered).not.toBe(want);
  });

  it('catches a zero-value account that stops being filtered', () => {
    // "Sundry expenses" is all zeros, so it AND its whole OTHER block are absent from the golden —
    // `acctRows` drops the row and `if(!accts.length && !PNL_SHOW_ZERO) return;` drops the block.
    expect(want).not.toContain('Sundry expenses');
    const shown = rendered({ showZero: true });
    expect(shown).not.toBe(want);
    expect(shown).toContain('Sundry expenses');
    expect(shown).toContain('Total OTHER Cost');
  });

  it('catches the 6/12-month toggle losing its highlight, or its columns', () => {
    expect(want).toContain('<button class="on">6 months</button>');
    const twelve = rendered({ months: 12 });
    expect(twelve).not.toBe(want);
    expect(twelve).toContain('<button class="on">12 months</button>');
  });

  it('catches a KPI delta pill that changed direction or colour', () => {
    // Revenue fell 58.0% month on month, so the pill is ▼ in the BAD colour; Operating Expenses also
    // fell, and `inverse` makes that the GOOD colour. Swapping the two is a screen that reads as a good
    // month when it was not.
    expect(want).toContain('▼58.0%');
    expect(want).toContain('rgba(14,157,103,.13);border-color:rgba(14,157,103,.30);color:var(--green-soft)">▼16.9%');
    const flat = rendered({
      data: { ...DATA, rows: (DATA.rows || []).map((r) => (r.section === 'Trading Income' ? { ...r, by_month: bump(r.account as string, '2026-07', -100000) } : r)) },
    });
    expect(flat).not.toBe(want);
    expect(flat).not.toContain('▼58.0%');
  });

  it('catches a renamed label and a dropped class', () => {
    const renamed = rendered({ data: { ...DATA, rows: (DATA.rows || []).map((r) => (r.account === 'Purchases' ? { ...r, account: 'Cost of goods' } : r)) } });
    expect(renamed).not.toBe(want);
    expect(want).toContain('class="pnl-key gp"');
    expect(want).toContain('class="pnl-key pos"');
  });

  it('catches a control that is wired to the wrong prop', () => {
    // Each of these is what R1 would otherwise hide entirely.
    expect(() => assertHandlerParity({ onExport: misfire as never })).toThrow();
    expect(() => assertHandlerParity({ onRefresh: misfire as never })).toThrow();
    expect(() => assertHandlerParity({ onToggleZero: misfire as never })).toThrow();
    expect(() => assertHandlerParity({ onMonths: misfire as never })).toThrow();
  });
});

describe('beyond the golden — the modes the diff does not reach', () => {
  it('the loading document renderPnl() writes first', () => {
    const html = renderToStaticMarkup(<PnlLoading scopeCo={null} />);
    expect(html).toContain('📑 P&amp;L Analysis · all companies');
    expect(html).toContain('class="spinner"');
    expect(renderToStaticMarkup(<PnlLoading scopeCo="SKINDAE SDN BHD" />)).toContain('Loading profit &amp; loss for SKINDAE SDN BHD…');
  });

  it('the two failure documents stay two documents', () => {
    // `!r.ok` is the server refusing; a throw is the call itself failing. Collapsing them would report
    // a refusal as a network fault or the reverse.
    expect(renderToStaticMarkup(<PnlFailure kind="refused" message="no data" />)).toContain('📉');
    expect(renderToStaticMarkup(<PnlFailure kind="threw" message="boom" />)).toContain('⚠️');
  });

  it('the company-scoped header names the company and the refresh time', () => {
    const html = renderToStaticMarkup(screen({
      data: { ...DATA, scoped_tenant: 't1', generated_at: '2026-08-18T09:30:12.512Z' },
      scopeCo: 'SKINDAE SDN BHD',
    }));
    expect(html).toContain('P&amp;L · <b style="color:var(--text)">SKINDAE SDN BHD</b> · 6 months · refreshed 2026-08-18 09:30');
    // The consolidated branch, which the golden does hold, must NOT gain a company name.
    expect(renderToStaticMarkup(screen())).toContain('Consolidated P&amp;L · all companies · 6 months');
  });

  it('the `refreshed` label is sliced out of the string, never parsed as a date', () => {
    // THE TIMEZONE RULE. app.html:4477 formats generated_at with .replace('T',' ').slice(0,16) — no
    // Date at all — so the label is the server's own instant however the reader's clock is set. A port
    // rewritten with `new Date(...).toLocaleString()` passes every OUTPUT assertion on this fleet (CI
    // and this machine both sit at UTC+8) and prints a different minute, or a different DAY, west of
    // Greenwich. No output check can see that: it is a property of the environment, not of the value.
    // So the IMPLEMENTATION is pinned, on both sides.
    expect(APP).toContain("esc(String(d.generated_at).replace('T',' ').slice(0,16))");
    const body = SRC.slice(SRC.indexOf('const refreshed = d.generated_at'), SRC.indexOf('const mbtn ='));
    expect(body).toContain("String(d.generated_at).replace('T', ' ').slice(0, 16)");
    for (const s of ['new Date', 'getMonth', 'toLocale', 'Date.parse', 'Intl.']) expect(body).not.toContain(s);
    // And the whole component reads no clock, so nothing else can drift either.
    for (const s of ['Date.now', 'new Date', 'getFullYear']) expect(SRC).not.toContain(s);
  });

  it('the monthly-totals fallback, when the account cache is empty', () => {
    const html = renderToStaticMarkup(screen({ data: { ...DATA, rows: [] } }));
    expect(html).toContain('Account-level P&amp;L not cached yet');
    expect(html).toContain('needs account cache');           // the Gross Profit KPI's sub
    expect(html).toContain('<th class="amt">Net profit</th>');
    expect(html).not.toContain('pnl-grid');
    // Revenue still resolves, from totals.revenue — the fallback pnlBuild()'s `rev` map applies.
    expect(html).toContain('RM 120,904.00');
    expect(renderToStaticMarkup(screen({ data: { ...DATA, rows: [], months: [] } }))).toContain('No months returned.');
  });

  it('the stacked chart, which no golden holds', () => {
    // Ported coordinate for coordinate from pnlBlockChart (app.html:4392). Pinned here because the
    // fixture carries no `blocks` at all, so the diff above proves only the EMPTY branch.
    const blocks = [
      { block: 'STAFF', by_month: { '2026-08': 28115.40, '2026-07': 28115.40, '2026-06': 28115.40, '2026-05': 26442, '2026-04': 26442, '2026-03': 26442 } },
      { block: 'BD&M', by_month: { '2026-08': 9110.45, '2026-07': 18220, '2026-06': 16440.10, '2026-05': 12000, '2026-04': 14220, '2026-03': 11080 } },
    ];
    const html = renderToStaticMarkup(<BlockChart months={DATA.months as string[]} blocks={blocks} />);
    expect(html).toContain('viewBox="0 0 820 290"');
    // Bars run OLDEST → NEWEST (the months array is reversed), so 2026-03 is leftmost.
    expect(html.indexOf('>26-03<')).toBeLessThan(html.indexOf('>26-08<'));
    // Five gridlines, the top one at the max of the stacked totals (STAFF+BD&M for 2026-07 = 46,335.40).
    expect((html.match(/<line /g) || []).length).toBe(5);
    expect(html).toContain('>RM46k</text>');
    // The crown segment is a rounded path; the one below it a plain rect. Both carry the SIGNED figure.
    expect(html).toContain('<title>BD&amp;M · 2026-08 · RM 9,110.45</title>');
    expect(html).toContain('<title>STAFF · 2026-08 · RM 28,115.40</title>');
    expect((html.match(/<path /g) || []).length).toBe(6);
    expect((html.match(/<rect /g) || []).length).toBe(6);
    // The legend is in PNL_BLOCK_ORDER, with each block's own colour.
    expect(html).toContain('style="background:#5b9bd5"');
    expect(html.indexOf('#5b9bd5')).toBeLessThan(html.indexOf('#E0714E'));
    // A style value that React would re-serialise is a string on purpose (hr.dashboard's rule).
    expect(html).toContain('style="display:block"');
  });

  it('a negative block is clamped for the BAR HEIGHT only — the tooltip keeps the true figure', () => {
    const blocks = [{ block: 'FIN', by_month: { '2026-08': -500, '2026-07': 1000, '2026-06': 0, '2026-05': 0, '2026-04': 0, '2026-03': 0 } }];
    const html = renderToStaticMarkup(<BlockChart months={DATA.months as string[]} blocks={blocks} />);
    expect(html).not.toContain('height="-');            // no negative bar
    expect(html).toContain('<title>FIN · 2026-07 · RM 1,000.00</title>');
    expect(html).not.toContain('2026-08 ·');            // the negative month stacks nothing at all
    // AND the stacked TOTAL printed above the bar is clamped too — this is the half the first cut of
    // this test missed. Dropping `Math.max(0, …)` leaves every segment height untouched (only positive
    // blocks are drawn) and moves ONLY this label, so `height="-` can never catch it. 2026-08's total
    // must read RM0, not -RM500, and it must not drag the axis maximum negative either.
    expect(html).toContain('>RM0</text>');
    expect(html).not.toContain('-RM500');
    expect(html).not.toContain('-RM');
  });

  it('the CSV is pnl.js’s, and it is the grid — every row, raw numbers, band labels bare', () => {
    // A document that leaves the building: Excel reads it. Split out of the route for bankFile()'s
    // reason, and shared with app.html so the export and the screen cannot drift apart.
    const lines = pnlCsvLines(pnlBuild(DATA, 6, false), DATA.totals);
    expect(lines[0]).toBe('Account,2026-08,2026-07,2026-06,2026-05,2026-04,2026-03,Total');
    expect(lines).toContain('Trading Income');                              // band: a bare label
    expect(lines).toContain('Total Trading Income,120904,288112.05,265440.9,198220,233910.45,210433.1,1317020.5');
    expect(lines).toContain('Net Profit,,,,,,,');                           // nulls are empty cells
    expect(lines.some((l) => /^"/.test(l))).toBe(false);                    // nothing here needs quoting
    // Raw numbers, so the cells stay summable — never "RM 120,904.00".
    expect(lines.join('\n')).not.toContain('RM ');
    // The !hasRows branch is a DIFFERENT sheet.
    expect(pnlCsvLines(pnlBuild({ ...DATA, rows: [] }, 6, false), DATA.totals)[0]).toBe('Month,Income,Expenses,Net profit');
  });

  it('the CSV filename carries the company, the span and a date it is HANDED', () => {
    expect(pnlCsvName('All companies', 6, '2026-08-18')).toBe('CTG_PnL_6mo_2026-08-18.csv');
    expect(pnlCsvName('SKINDAE SDN BHD', 12, '2026-08-18')).toBe('CTG_PnL_SKINDAE_SDN_BHD_12mo_2026-08-18.csv');
    // pnl.js reads no clock; the MYT date is todayLocalISO()'s, from the caller. Same rule as above.
    expect(readFileSync(join(REPO, 'pnl.js'), 'utf8')).not.toContain('new Date');
  });
});

describe('the permission gate', () => {
  // app.html:1420-1439 is not uniform: read the block, do not copy a neighbour's line.
  const block = APP.slice(APP.indexOf("if(t==='users') el.classList.toggle('hide', !canManage);"),
    APP.indexOf('// Hide any category whose sub-tabs are all hidden'));

  it('`pnl` is named in NO branch, so it falls through to the FEATURE flag', () => {
    expect(block).not.toContain("'pnl'");
    expect(block).toContain("else el.classList.toggle('hide', feats.indexOf(t)<0);");
  });

  it('is NOT the admin gate its neighbours use', () => {
    // wht / selfbill / gateway / bankfeed / salesrecon are all !canManage. Copying that line would
    // over-grant (a manage_users role with no `pnl` feature) and under-grant (the reverse).
    expect(pnlReachable({ features: [], manage_users: true })).toBe(false);
    expect(pnlReachable({ features: ['pnl'], manage_users: false })).toBe(true);
  });

  it('refuses on absent, null, empty and unrelated feature lists', () => {
    expect(pnlReachable(null)).toBe(false);
    expect(pnlReachable(undefined)).toBe(false);
    expect(pnlReachable({})).toBe(false);
    expect(pnlReachable({ features: ['wht', 'close', 'pnl_report'] })).toBe(false);
  });

  it('and the shipped fixture, which is what the route will see', () => {
    expect(pnlReachable(FIXTURES.my_perms as { features?: string[] })).toBe(true);
  });

  it('the renderer itself has no role check — the gate is the only thing between the URL and the figures', () => {
    const fn = APP.slice(APP.indexOf('function pnlRender(){'), APP.indexOf('// CSV of the grid exactly as displayed'));
    for (const s of ['PERMS', 'canManage', 'manage_users', 'isViewer']) expect(fn).not.toContain(s);
  });
});
