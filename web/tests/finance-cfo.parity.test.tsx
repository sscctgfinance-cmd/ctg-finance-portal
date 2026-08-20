// Finance OS · CFO Cockpit — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.cfo.html` was captured from `renderCFO()` (app.html:1837) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts,
// web/tests/parity.ts or web/tests/handlers.ts. The component is rendered with `renderToStaticMarkup`
// from the SAME fixture the golden was captured from — tests/render_fixtures.ts, imported directly.
//
// NO SEVENTH RELAXATION, and none was needed: ./parity.ts's six are reused unchanged, as thirty-one
// screens before this one did — including on the largest surface either app has after `hr.payroll`.
//
// ── THE TWO SCREEN-LOCAL RULES, BOTH OF KINDS ALREADY ESTABLISHED ────────────────────────────────
// `decodeRefs` and `decodeTextAmp` below. Neither is new in kind: `decodeRefs` is finance.ctgaccess's
// (named + numeric character references in one function, here `&rarr; &divide; &times; &nbsp;` — note
// R2 in parity.ts canonicalises the nbsp to its ENTITY, so this must not decode it), and
// `decodeTextAmp` is hr.payslip's (a bare `&` written into text without `esc()`, here `P&L` at
// app.html:1885 and `P&L & position` at :1913). Both are applied to BOTH sides, both live in this file
// rather than in the shared layer, and both carry their own "cannot hide" cases below.
//
// ── THE GOLDEN STATE: TWO SECTIONS, BOTH LOADED — CHECKED, NOT ASSUMED ───────────────────────────
// CLAUDE.md's intermediate-state trap has caught finance.qinv, finance.users and finance.gateway, so
// the question was asked of both writes. It comes back clean both times, and the `the golden's two
// sections` block below proves that out of app.html rather than asserting it:
//
//   `#cfo`           — renderCFO() writes the SPINNER panel into it, then cfoRender() overwrites the
//                      SAME id. Last-write-wins is per id ⇒ the golden holds the loaded dashboard.
//   `#cfo-analytics` — nested inside cfoRender()'s markup, so the `#cfo` section holds it EMPTY;
//                      cfoAnalyticsLoad() writes the spinner into it and cfoAnalyticsRender()
//                      overwrites that ⇒ this section too is the loaded state.
//
// ── WHAT THE GOLDENS CANNOT REACH, AND IS THEREFORE PINNED BY ASSERTION ─────────────────────────
// Six states appear in no golden (two spinners, four error panels) and are asserted against app.html's
// own text. So are the three totals that are COMPUTED rather than transcribed — the P&L table footer,
// the cash-flow in/out/net line and the vendor share percentages — each against an input chosen so a
// transcription of one row would differ from the sum. Every number on this screen is one an executive
// acts on without cross-checking, so "it matched the golden" is not on its own enough for those.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES } from '../../tests/render_fixtures';
import FinanceCfo, {
  Analytics, AnalyticsLoading, cfoMk, cfoReachable, cfoShortName, ErrorPanel, Loading, OV_PALETTE, ytdYear,
  type CfoData, type FinData,
} from '../src/finance-cfo';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers } from './handlers';

/** What cfoRender() overwrites `#cfo` with once `{api:'group_dashboard'}` resolves. */
const SCREEN = goldenSection('finance.cfo', 'cfo');
/** What cfoAnalyticsRender() overwrites `#cfo-analytics` with once `{api:'fin_analytics'}` resolves. */
const STRIP = goldenSection('finance.cfo', 'cfo-analytics');

const CFO = FIXTURES.group_dashboard as unknown as CfoData;
const FIN = FIXTURES.fin_analytics as unknown as FinData;

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');
const SRC = readFileSync(join(REPO, 'web', 'src', 'finance-cfo.tsx'), 'utf8');

/** tests/render_harness.ts:19 — the instant every golden was captured at. */
const FIXED_MS = Date.parse('2026-08-18T09:30:00.000Z');

/**
 * THE TIMEZONE, PINNED — hr.clock's arrangement, for the analytics stamp.
 *
 * `cfoAnalyticsRender()`'s last line formats the server's `generated_at` with
 * `toLocaleString('en-GB', …)`, so its output depends on the machine's zone; the golden's
 * "18 Aug, 09:00" is `2026-08-18T09:00:00.000Z` read in UTC. tests/render_harness.ts:63 pins that for
 * the Deno harness by forcing `timeZone: 'UTC'`. This is the SAME override, applied for the length of
 * this file and then restored, so the React side is read in the zone the golden was written in.
 *
 * It is NOT a relaxation: the comparison stays exact and a wrong time still diffs. It changes what both
 * sides are READ under, not what counts as a match — which is also why it does not belong in parity.ts.
 */
const REAL_STRING = Date.prototype.toLocaleString;
beforeAll(() => {
  Date.prototype.toLocaleString = function (this: Date, l?: never, o?: Intl.DateTimeFormatOptions) {
    return REAL_STRING.call(this, l ?? 'en-GB', { timeZone: 'UTC', ...(o || {}) });
  } as typeof Date.prototype.toLocaleString;
});
afterAll(() => { Date.prototype.toLocaleString = REAL_STRING; });

const noop = () => {};

type Props = Parameters<typeof FinanceCfo>[0];

function props(over: Partial<Props> = {}): Props {
  // The state the harness captured: both responses resolved, no company selected (`scoped_tenant` is
  // null in the fixture, so the scope line takes its group branch), nothing composed into the strip.
  return { data: CFO, scopeName: null, ytdYear: ytdYear(new Date(FIXED_MS)), onRefresh: noop, ...over };
}

const screen = (over: Partial<Props> = {}) => <FinanceCfo {...props(over)} />;

/**
 * CHARACTER REFERENCES for the same character, decoded on BOTH sides.
 *
 * What it absorbs: `&rarr;` vs `→`, `&divide;` vs `÷` — the SPELLING of a character an HTML parser reads
 * identically either way. React's text escaper emits only `& < > " '` as references, so a `→` in JSX
 * comes out as the character and the literal string `"&rarr;"` comes out as `&amp;rarr;`; neither side
 * can be spelled into the other. What it cannot absorb: a different character (decodes to something
 * else and still diffs), a dropped one, a changed number, a renamed label, a lost class or a missing
 * attribute — none of those is a character reference.
 *
 * Narrow in four ways, each proven by the `still bites` block:
 *   • only the three NAMED references app.html writes on THIS screen, not the ~2000 HTML5 names;
 *   • it does NOT decode `&nbsp;` — parity.ts's R2 deliberately canonicalises the CHARACTER to that
 *     ENTITY before normalising, precisely so a dropped nbsp stays visible. Decoding it here would undo
 *     R2 and hand back the silent failure R2 exists to prevent;
 *   • it does NOT decode `&amp;`-prefixed text, which is what a React tree trying to emit the literal
 *     entity produces — a real defect that keeps diffing;
 *   • it never decodes `"` or `'`, which parity.ts's R6 owns and must run after R4's attribute parse.
 */
const NAMED: Record<string, string> = { rarr: '→', divide: '÷', times: '×' };

function decodeRefs(html: string): string {
  return html
    .replace(/&(?!amp;)([a-z]+);/g, (m, name: string) => NAMED[name] ?? m)
    .replace(/&(?!amp;)#(\d+);|&(?!amp;)#[xX]([0-9a-fA-F]+);/g, (m, dec: string, hex: string) => {
      const cp = dec ? Number(dec) : parseInt(hex, 16);
      return cp === 34 || cp === 39 ? m : String.fromCodePoint(cp);
    });
}

/**
 * A BARE `&` IN TEXT, decoded on both sides — hr.payslip's `decodeTextAmp`, second screen of the kind.
 *
 * `cfoRender()` writes `<h3>📅 Monthly P&L — revenue vs expenses</h3>` (app.html:1885) and
 * `<h3>🏢 Company scorecard — P&L & position</h3>` (:1913) into its HTML string without `esc()`, so the
 * golden holds a raw `&`. An HTML parser reads that and `&amp;` as the same character, but React's text
 * escaper can only ever emit the second. Decoding `&amp;` to `&` on both sides compares the text.
 *
 * Deliberately narrow: OUTSIDE tags only (so an attribute value's `&amp;` is untouched — that is
 * hr.employees' separate rule and this screen does not need it), and never where the `&amp;` prefixes
 * another reference, so a doubly-escaped `&amp;rarr;` — the defect where the entity prints on the page —
 * still diffs. Note the interaction with R2: R2 turns a real nbsp CHARACTER into `&nbsp;`, and this
 * rule leaves that alone because `&nbsp;` is a reference, not a bare `&amp;`.
 */
function decodeTextAmp(html: string): string {
  return html.split(/(<[^>]*>)/).map((part, i) =>
    (i % 2 ? part : part.replace(/&amp;(?![a-zA-Z]+;|#\d+;|#[xX][0-9a-fA-F]+;)/g, '&'))).join('');
}

/** Both sides read as the same document, then compared under ./parity.ts's six relaxations. */
const sameDocument = (html: string) => relax(decodeTextAmp(decodeRefs(html)));

const rendered = (over: Partial<Props> = {}) => sameDocument(renderToStaticMarkup(screen(over)));
const renderedStrip = (d: FinData = FIN) => sameDocument(renderToStaticMarkup(<Analytics data={d} />));

describe('Finance CFO Cockpit — React vs the legacy golden', () => {
  it('renders the dashboard cfoRender() writes into #cfo', () => {
    expect(rendered()).toBe(sameDocument(SCREEN));
  });

  it('renders the analytics strip cfoAnalyticsRender() writes into #cfo-analytics', () => {
    expect(renderedStrip()).toBe(sameDocument(STRIP));
  });

  it('wires the same handlers, to the same controls, in the same order', () => {
    assertScreenHandlers();
    assertStripHandlers();
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * This screen has exactly ONE handler in either section, and the analytics strip has none — so both
 * shapes CLAUDE.md warns about appear in one file.
 *
 * `#cfo`: `onclick="CFO_DATA=null;FIN_DATA=null;renderCFO()"` (app.html:1921) is an inline STATEMENT
 * rather than a call, and it carries no argument at all. `goldenHandlers()` therefore reports it as
 * `args: []`, which on its own would pass with the button wired to anything — so `finance.wht`'s
 * golden-derived `LEGACY_TO_PROP`, keyed on the WHOLE raw text (Finance writes several of these), is
 * what makes it nameable. `identArgs()` is NOT copied: no handler here carries a bare integer.
 *
 * `#cfo-analytics`: ZERO handlers, which is `finance.bankfeed`'s case — the EMPTY golden IS the
 * assertion. R1 strips handlers from the string diff, so a port that added a button to that strip would
 * look identical above. The shared guard-the-guard (`want.length > 0`) is unsatisfiable there; it is
 * REPLACED, not dropped, with `expect(want).toEqual([])` plus the count read out of the golden.
 */
const LEGACY_TO_PROP: Record<string, string> = {
  'CFO_DATA=null;FIN_DATA=null;renderCFO()': 'refresh',
};

const propFor = (raw: string) => LEGACY_TO_PROP[raw] ?? LEGACY_TO_PROP[raw.replace(/\(.*$/, '')] ?? raw;

function recorder(calls: { attr: string; args: string[] }[]) {
  return (attr: string) => () => calls.push({ attr, args: [] });
}

function assertScreenHandlers(over: Partial<Props> = {}) {
  const want = goldenHandlers(SCREEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = recorder(calls);
  const got = reactHandlers(screen({ onRefresh: record('refresh'), ...over }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());
  expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard. `args.length > 0` is unsatisfiable on a screen whose only handler is
  // argument-free, so the replacement is: the golden really has one, and this file names it.
  expect(want.length).toBe(1);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
}

function assertStripHandlers() {
  const want = goldenHandlers(STRIP);
  // finance.bankfeed's replacement for the shared guard: an empty expectation that a later legacy
  // button would FAIL rather than pass vacuously.
  expect(want).toEqual([]);
  expect(STRIP).not.toContain('on=');
  expect(reactHandlers(<Analytics data={FIN} />)).toEqual([]);
}

describe("the golden's two sections — checked against app.html, not assumed", () => {
  const renderFn = APP.slice(APP.indexOf('async function renderCFO()'), APP.indexOf('function cfoRender()'));
  const cfoRenderFn = APP.slice(APP.indexOf('function cfoRender()'), APP.indexOf('/* ── Financial-analyst toolkit'));
  const analyticsFn = APP.slice(APP.indexOf('function cfoAnalyticsRender()'), APP.indexOf('async function renderOverview()'));

  it('renderCFO() writes the SPINNER into #cfo and cfoRender() overwrites the SAME id', () => {
    expect(renderFn).toContain("var el=document.getElementById('cfo');");
    expect(renderFn).toContain('Computing analytics for ');
    expect(cfoRenderFn).toContain("var el=document.getElementById('cfo');");
    expect(cfoRenderFn).toContain('el.innerHTML =');
    // …so the spinner is NOT in the golden. finance.approvals' case, not finance.ctgaccess's.
    expect(SCREEN).not.toContain('Computing analytics for');
    expect(SCREEN).not.toContain('spinner');
  });

  it('after its write cfoRender() does only loaded.cfo=true and cfoAnalyticsLoad()', () => {
    // The finance.qinv trap, asked in its own direction: an appendChild, a `.value=`, a `.className=`
    // or a `.textContent` here would mean the golden was missing something every operator sees — which
    // is exactly what caught finance.qinv, finance.users and finance.gateway.
    const after = cfoRenderFn.slice(cfoRenderFn.indexOf('loaded.cfo=true'));
    expect(after).toContain('cfoAnalyticsLoad();');
    for (const s of ['appendChild', '.value=', 'setTimeout', 'classList', '.textContent', 'innerHTML'])
      expect(after).not.toContain(s);
  });

  it('#cfo-analytics is nested inside that write, which is why the golden holds it EMPTY', () => {
    expect(cfoRenderFn).toContain('<div id="cfo-analytics" style="margin-top:16px"></div>');
    expect(SCREEN).toContain('<div id="cfo-analytics" style="margin-top:16px">');
    expect(SCREEN).not.toContain('Financial Analytics');
    expect(SCREEN).not.toContain('Computing DSO/DPO');
  });

  it('cfoAnalyticsRender() overwrites that id and does nothing after its write', () => {
    expect(analyticsFn).toContain("var el=document.getElementById('cfo-analytics');");
    expect(analyticsFn.trimEnd().endsWith('+icHtml+stamp;\n}')).toBe(true);
    // …so the strip section is the LOADED analytics, not cfoAnalyticsLoad()'s spinner.
    expect(STRIP).not.toContain('Computing DSO/DPO');
    expect(STRIP).toContain('Financial Analytics');
  });

  it('and the route composes them: the strip renders inside #cfo-analytics', () => {
    const html = renderToStaticMarkup(screen({ analytics: <Analytics data={FIN} /> }));
    expect(html).toContain('<div id="cfo-analytics"');
    expect(html).toContain('Financial Analytics');
    expect(html.indexOf('Financial Analytics')).toBeGreaterThan(html.indexOf('id="cfo-analytics"'));
  });
});

describe('the permission gate — app.html:1420-1439, mirrored and pinned in both directions', () => {
  // Six screens have now found their gate was not their neighbours'; this reads the block rather than
  // copying a line, and asserts the SHAPE of the block so the predicate cannot quietly stop mirroring it.
  const block = APP.slice(APP.indexOf("document.querySelectorAll('.tab').forEach"), APP.indexOf("// Hide any category"));

  it('cfo is named in NO branch of showApp(), so it falls through to the feature-flag else', () => {
    expect(block).toContain("else el.classList.toggle('hide', feats.indexOf(t)<0);");
    expect(block).not.toMatch(/t===['"]cfo['"]/);
  });

  it('so the gate is the FEATURE FLAG and NOT manage_users', () => {
    expect(cfoReachable({ features: ['cfo'] })).toBe(true);
    expect(cfoReachable({ features: ['cfo'], manage_users: false })).toBe(true);
    // The admin gate its `selfbill`/`wht`/`gateway` neighbours use would grant this — it must not.
    expect(cfoReachable({ features: [], manage_users: true })).toBe(false);
    expect(cfoReachable({ features: ['overview', 'pnl', 'close'], manage_users: true })).toBe(false);
  });

  it('and refuses on nothing at all', () => {
    expect(cfoReachable(null)).toBe(false);
    expect(cfoReachable(undefined)).toBe(false);
    expect(cfoReachable({})).toBe(false);
  });

  it('the shipped fixture really carries the feature, so the true case is not vacuous', () => {
    const perms = FIXTURES.my_perms as { features?: string[] };
    expect(perms.features).toContain('cfo');
    expect(cfoReachable(perms)).toBe(true);
  });

  it('renderCFO() itself has no role check, which is why the route must carry one', () => {
    // A port that mirrored only the renderer would serve the group's revenue, net profit, working
    // capital, receivables aging and named customers with their credit risk to anyone who typed the URL.
    const fn = APP.slice(APP.indexOf('async function renderCFO()'), APP.indexOf('/* ── Financial-analyst toolkit'));
    for (const s of ['PERMS', 'canManage', 'manage_users', 'isAdmin']) expect(fn).not.toContain(s);
  });
});

describe('the YTD year is a derivation, so its IMPLEMENTATION is pinned — not just its output', () => {
  // finance.calendar's finding, in full: the Calendar worker rewrote a date derivation with the Date
  // constructor and all 29 of its output assertions still passed, because this machine and CI sit at
  // UTC+8 where the bug is invisible. West of Greenwich the same code prints the previous day.
  //
  // `ytdYear()` is the MYT calendar year computed as `+8h then getUTCFullYear()`. `getFullYear()` would
  // be the MACHINE's year — correct in Kuala Lumpur, wrong everywhere else — and no output check this
  // fleet can run would see the difference. So the source is asserted, comments stripped.
  const body = SRC.slice(SRC.indexOf('export function ytdYear'), SRC.indexOf('// ── Shared formatting'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('is computed with the +8h shift and getUTCFullYear(), never the local-clock accessors', () => {
    expect(body).toContain('8 * 3600000');
    expect(body).toContain('getUTCFullYear');
    expect(body).not.toContain('getFullYear()');
    expect(body).not.toContain('toLocale');
    expect(body).not.toContain('getMonth');
  });

  it('reads no clock of its own — the instant is handed in', () => {
    expect(body).not.toContain('Date.now');
    expect(body).not.toMatch(/new Date\(\s*\)/);
  });

  it('and the component never reads one either', () => {
    const comp = SRC.slice(SRC.indexOf('export default function FinanceCfo'));
    expect(comp).not.toContain('Date.now');
    expect(comp).not.toMatch(/new Date\(\s*\)/);
  });

  it('matches the golden at the instant the golden was captured', () => {
    expect(ytdYear(new Date(FIXED_MS))).toBe(2026);
    expect(SCREEN).toContain('Revenue · YTD 2026');
  });

  it('and the +8h shift is what it is FOR: 31 Dec 20:00 UTC is already 1 Jan in Kuala Lumpur', () => {
    expect(ytdYear(new Date(Date.parse('2026-12-31T20:00:00.000Z')))).toBe(2027);
    expect(ytdYear(new Date(Date.parse('2026-12-31T15:59:00.000Z')))).toBe(2026);
  });
});

describe('the totals are COMPUTED, and no golden proves a sum tracks its inputs', () => {
  // Every figure here is one an executive reads and acts on without cross-checking. Matching the golden
  // proves the transcription; these prove the arithmetic, each with an input where a transcribed value
  // and a summed one differ.
  const MON = CFO.monthly!;

  it('the P&L footer sums the MONTHS, not the group card above it', () => {
    // 1,317,020.50 over the 12-month window vs 2,288,721.55 calendar-YTD in the hero card. A port that
    // reused `g.revenue` for the footer would agree with the card and be wrong by a million.
    const sum = MON.reduce((s, m) => s + (Number(m.revenue) || 0), 0);
    expect(sum).toBeCloseTo(1317020.50, 2);
    expect(sum).not.toBeCloseTo(Number(CFO.group!.revenue), 2);
    expect(sameDocument(SCREEN)).toContain('RM 1,317,020.50');
    expect(rendered()).toContain('RM 1,317,020.50');
  });

  it('and the footer tracks a changed month rather than being transcribed', () => {
    const bumped = { ...CFO, monthly: MON.map((m, i) => (i === 0 ? { ...m, revenue: (m.revenue || 0) + 1000 } : m)) };
    expect(rendered({ data: bumped })).toContain('RM 1,318,020.50');
    expect(rendered({ data: bumped })).not.toContain('RM 1,317,020.50');
  });

  it('the P&L MoM column compares the PREVIOUS MONTH, not the row above it in the reversed table', () => {
    // Rows are rendered most-recent first, but `mom` is computed against `mon[i-1]` BEFORE the reverse.
    // 2026-08 vs 2026-07: (120904.00-288112.05)/288112.05 = -58%. The oldest row has no predecessor.
    const html = rendered();
    expect(html).toContain('▼58%');
    expect((html.match(/—<\/td>/g) || []).length).toBeGreaterThan(0);
  });

  it('the 13-week cash-flow line sums thirteen weeks of the server ROWS', () => {
    const wk = FIN.cashflow_13w!;
    const inflow = wk.reduce((s, x) => s + (Number(x.inflow) || 0), 0);
    const outflow = wk.reduce((s, x) => s + (Number(x.outflow) || 0), 0);
    expect(wk.length).toBe(13);
    expect(inflow).toBe(507000);
    expect(outflow).toBe(382200);
    const html = renderToStaticMarkup(<Analytics data={FIN} />);
    expect(html).toContain('RM 507,000.00');
    expect(html).toContain('RM 382,200.00');
    expect(html).toContain('RM 124,800.00');       // net = in − out, and 507000 ≠ 382200 ≠ 124800
  });

  it('and a dropped week changes all three, so they cannot be transcribed', () => {
    const short = { ...FIN, cashflow_13w: FIN.cashflow_13w!.slice(0, 12) };
    const html = renderToStaticMarkup(<Analytics data={short} />);
    expect(html).not.toContain('RM 507,000.00');
    expect(html).not.toContain('RM 124,800.00');
  });

  it("the vendor share is each vendor's spend over the SERVER's total, not over the rows shown", () => {
    // 601,330.10 / 1,978,057.10 = 30%. The three listed vendors sum to 791,770.20, so a port that
    // divided by the visible rows would print 76% — plausible, and wrong.
    const html = renderToStaticMarkup(<Analytics data={FIN} />);
    expect(html).toContain('width:30%');
    expect(html).not.toContain('width:76%');
    const rowsOnly = FIN.vendor_spend!.vendors!.reduce((s, v) => s + (Number(v.spend) || 0), 0);
    expect(Math.round(100 * 601330.10 / rowsOnly)).toBe(76);
  });

  it('the group margin and the per-company margins are derived from their OWN pair of figures', () => {
    // 310,664.45 / 2,288,721.55 = 14% for the group; 378,356.35 / 1,482,300.55 = 26% for SKINDAE and
    // -8% for the loss-making company. Three different answers, so a single transcription cannot pass.
    const html = rendered();
    expect(html).toContain('>14%<');
    expect(html).toContain('26% margin');
    expect(html).toContain('-8% margin');
  });

  it('the Overdue AR card carries its share of the open book', () => {
    // 88,420.00 / 412,008.20 = 21%.
    expect(rendered()).toContain('Overdue AR · 21%');
    const noOpen = { ...CFO, group: { ...CFO.group, ar_open: 0 } };
    // arOpen 0 ⇒ no share at all rather than a division by zero.
    expect(rendered({ data: noOpen })).toContain('>Overdue AR</div>');
  });
});

describe('the comparison still bites', () => {
  const want = sameDocument(SCREEN);
  const wantStrip = sameDocument(STRIP);

  it('the goldens really hold every panel and row this screen has', () => {
    // Guard the guard for the whole block: a golden that had captured a SPINNER, or a strip that had
    // captured cfoAnalyticsLoad()'s placeholder, would make every case below vacuous. That is exactly
    // how finance.qinv, finance.users and finance.gateway were caught.
    expect((SCREEN.match(/class="panel"/g) || []).length).toBe(10);  // alerts + 6 charts + scorecard + aging + customers
    expect((SCREEN.match(/class="card[ "]/g) || []).length).toBe(8); // two hero rows of four
    expect((SCREEN.match(/<svg/g) || []).length).toBe(7);   // 6 charts + the aging bar
    expect((SCREEN.match(/<table/g) || []).length).toBe(2);          // monthly P&L + company scorecard
    expect((STRIP.match(/class="panel"/g) || []).length).toBe(6);
    expect((STRIP.match(/<svg/g) || []).length).toBe(3);
    expect((STRIP.match(/<table/g) || []).length).toBe(3);           // risk + vendor + intercompany
  });

  it('catches a company dropped out of the scorecard and its charts', () => {
    const one = { ...CFO, companies: CFO.companies!.slice(0, 1), companies_monthly: CFO.companies_monthly!.slice(0, 1) };
    const html = rendered({ data: one });
    expect(html).not.toBe(want);
    // It survives ONLY where the server put it: inside an alert's own text. Every chart, legend and
    // scorecard row keyed off `companies`/`companies_monthly` has lost it.
    expect(html).not.toContain('<b>I PROCARE MALAYSIA SDN BHD</b>');
    expect(html).not.toContain('>I PROCARE MALAYSIA<');
    expect(want).toContain('>I PROCARE MALAYSIA<');
    expect(html).toContain('I PROCARE MALAYSIA SDN BHD is loss-making');
  });

  it('catches a changed hero figure', () => {
    const bumped = { ...CFO, group: { ...CFO.group, net_profit: 310664.46 } };
    expect(rendered({ data: bumped })).not.toBe(want);
  });

  it('catches a hero card that lost its sign — the green/red class and the icon both move', () => {
    const loss = { ...CFO, group: { ...CFO.group, net_profit: -1 } };
    const html = rendered({ data: loss });
    expect(html).toContain('card red');
    expect(html).toContain('📉');
    expect(want).toContain('card green');
  });

  it('catches the two hero rows swapped — they are DIFFERENT figures with the same shape', () => {
    // Four cards of money in a row twice over; the labels are the only thing telling them apart, and
    // relax() compares those, so this is really a check that the labels stayed with their values.
    // A card is value-then-label, so each pair is checked as one contiguous run of the golden.
    expect(want).toContain('RM 2,288,721.55</div>\n<div class="l">Revenue · YTD 2026</div>');
    expect(want).toContain('RM 412,008.20</div>\n<div class="l">Receivables (owed to us)</div>');
    expect(want).toContain('RM 233,190.75</div>\n<div class="l">Payables (we owe)</div>');
    expect(want.indexOf('Revenue · YTD')).toBeLessThan(want.indexOf('Receivables (owed to us)'));
  });

  it('catches the alerts panel disappearing, and renders none when the server sends none', () => {
    const quiet = { ...CFO, alerts: [] };
    expect(rendered({ data: quiet })).not.toBe(want);
    expect(rendered({ data: quiet })).not.toContain('Analyst alerts');
    expect(want).toContain('Analyst alerts');
    expect(want).toContain('🔴');       // severity high
    expect(want).toContain('🟠');       // anything else
  });

  it('catches an alert whose severity changed — the icon AND the colour move together', () => {
    const escalated = { ...CFO, alerts: CFO.alerts!.map((a) => ({ ...a, severity: 'high' })) };
    const html = rendered({ data: escalated });
    expect(html).not.toBe(want);
    expect(html).not.toContain('🟠');
  });

  it('catches a chart coordinate moving by a tenth of a pixel', () => {
    // Nothing in relax() touches an attribute VALUE, which is what makes the SVG maths catchable rather
    // than a silent visual lie (CLAUDE.md's hr.dashboard rule).
    const nudged = { ...CFO, monthly: CFO.monthly!.map((m, i) => (i === 3 ? { ...m, bills: (m.bills || 0) + 5 } : m)) };
    expect(rendered({ data: nudged })).not.toBe(want);
  });

  it('catches a company bound to the wrong palette colour', () => {
    // Every stacked band, every trend line and every revenue bar takes its colour from its INDEX. Two
    // companies swapped would keep every figure right and recolour the whole screen.
    const swapped = { ...CFO, companies_monthly: CFO.companies_monthly!.slice().reverse() };
    expect(rendered({ data: swapped })).not.toBe(want);
    expect(OV_PALETTE[0]).toBe('#e85d3c');
  });

  it('catches the revenue and expense bars swapped inside the monthly P&L combo', () => {
    // Both are `<rect rx="2">` of the same width; only the fill and the title tell them apart, and a
    // month where revenue exceeds expenses looks perfectly normal either way round.
    expect(want).toContain('fill="#0E9D67"');
    expect(want).toContain('fill="#E0714E"');
    const flipped = { ...CFO, monthly: CFO.monthly!.map((m) => ({ ...m, revenue: m.bills, bills: m.revenue })) };
    expect(rendered({ data: flipped })).not.toBe(want);
  });

  it('catches the MTD chip moving off the partial month', () => {
    expect(want).toContain('MTD');
    const trimmed = { ...CFO, monthly: CFO.monthly!.slice(0, 5) };
    const html = rendered({ data: trimmed });
    expect((html.match(/MTD/g) || []).length).toBe(1);
    // The chip is on the LAST element of `monthly`, so trimming it moves the chip AND drops the row.
    expect(html).not.toContain('<td>2026-08</td>');
    expect(want).toContain('<td>2026-08 <span');
    expect(html).toContain('<td>2026-07 <span');
  });

  it('catches the receivables aging reading a different bucket', () => {
    const aged = { ...CFO, ar_aging: { ...CFO.ar_aging, d90plus: 50000 } };
    expect(rendered({ data: aged })).not.toBe(want);
    expect(rendered({ data: aged })).toContain('90+d: RM 50,000.00');
  });

  it('catches a customer credit-risk row bound to the wrong customer', () => {
    const shuffled = { ...FIN, customer_risk: { ...FIN.customer_risk, customers: FIN.customer_risk!.customers!.slice().reverse() } };
    expect(renderedStrip(shuffled)).not.toBe(wantStrip);
  });

  it('catches the DSO and DPO bars swapped', () => {
    const swapped = { ...FIN, dso_dpo: { ...FIN.dso_dpo, companies: FIN.dso_dpo!.companies!.map((c) => ({ ...c, dso: c.dpo, dpo: c.dso })) } };
    expect(renderedStrip(swapped)).not.toBe(wantStrip);
  });

  it('catches the cash-gap sentence taking the wrong branch', () => {
    // Positive gap: money the group finances itself. Negative: supplier credit. Opposite meanings.
    const positive = renderedStrip();
    const negative = renderedStrip({ ...FIN, dso_dpo: { ...FIN.dso_dpo, group: { dso: 31, dpo: 47, cash_gap: -16 } } });
    expect(positive).toContain('cash gap you finance yourself');
    expect(negative).toContain('working capital is net-positive');
    expect(negative).not.toContain('cash gap you finance yourself');
    const none = renderedStrip({ ...FIN, dso_dpo: { ...FIN.dso_dpo, group: {} } });
    expect(none).toContain('Not enough data to compute the cash gap');
  });

  it('catches an intercompany difference that stopped being flagged, AT ITS BOUNDARY', () => {
    // The colour is the only thing on the row saying whether two companies' books agree, and the rule
    // is `Math.abs(difference) > 1` (app.html:2050) — one ringgit either way is rounding, more is a real
    // disagreement. A first draft of this case only moved the difference to 0.5, which is green under
    // ANY threshold ≥ 1; widening the threshold to 100 — hiding a RM 99 mismatch — passed every test in
    // this file. So it is driven at the boundary instead, from both directions and both signs.
    const withDiff = (d: number) =>
      renderToStaticMarkup(<Analytics data={{ ...FIN, intercompany: { ...FIN.intercompany, pairs: FIN.intercompany!.pairs!.map((p) => ({ ...p, difference: d })) } }} />);
    const RED = 'color:var(--red-soft);font-weight:700', GREEN = 'color:var(--green-soft);font-weight:700';
    expect(withDiff(1)).toContain(GREEN);          // exactly 1 is NOT flagged
    expect(withDiff(1.01)).toContain(RED);         // a sen more is
    expect(withDiff(-1)).toContain(GREEN);
    expect(withDiff(-1.01)).toContain(RED);        // the rule is on the ABSOLUTE difference
    expect(withDiff(0)).toContain(GREEN);
    expect(withDiff(99)).toContain(RED);           // the case a widened threshold would have hidden
    expect(wantStrip).toContain('var(--red-soft)');   // the fixture's 500 is flagged in the golden
  });

  it('catches the analytics stamp reading a different instant', () => {
    expect(wantStrip).toContain('18 Aug, 09:00');
    expect(renderedStrip({ ...FIN, generated_at: '2026-08-17T09:00:00.000Z' })).toContain('17 Aug, 09:00');
    expect(renderedStrip({ ...FIN, generated_at: null })).toContain('Analysis from the reliable invoice cache · <');
  });

  it('catches a mis-wired Refresh button', () => {
    // R1 strips the handler from the string diff entirely, so this is the ONLY thing standing between
    // the button and nothing. Its target clears BOTH caches: a refresh that dropped FIN_DATA would show
    // fresh headline figures beside a stale analyst strip.
    expect(() => assertScreenHandlers({ onRefresh: undefined as never })).toThrow();
    expect(goldenHandlers(SCREEN)[0].raw).toBe('CFO_DATA=null;FIN_DATA=null;renderCFO()');
  });

  it('catches a button added to the analytics strip, which carries none', () => {
    expect(goldenHandlers(STRIP)).toEqual([]);
    expect(reactHandlers(<Analytics data={FIN} />)).toEqual([]);
  });
});

describe("the two screen-local rules still bite", () => {
  it('decodeRefs decodes only the three names app.html writes here', () => {
    expect(decodeRefs('a &rarr; b &divide; c &times; d')).toBe('a → b ÷ c × d');
    expect(decodeRefs('&ldquo;quoted&rdquo;')).toBe('&ldquo;quoted&rdquo;');   // a name this screen never writes
  });

  it('decodeRefs does NOT touch &nbsp; — R2 canonicalises TO that entity on purpose', () => {
    // parity.ts's R2 turns a real U+00A0 into `&nbsp;` before normalising, precisely so a DROPPED nbsp
    // stays visible. Decoding it here would hand back the silent failure R2 exists to prevent.
    expect(decodeRefs('a &nbsp; b')).toBe('a &nbsp; b');
    expect(relax('a b')).toContain('&nbsp;');
    const noNbsp = sameDocument(STRIP.replace(/&nbsp;/g, ' '));
    expect(noNbsp).not.toBe(sameDocument(STRIP));
  });

  it('decodeRefs leaves a doubly-escaped entity alone, because that is a real defect', () => {
    // `&amp;rarr;` is what a React tree trying to emit the literal entity TEXT produces — the operator
    // sees `&rarr;` printed on the page.
    expect(decodeRefs('a &amp;rarr; b')).toBe('a &amp;rarr; b');
    expect(decodeRefs('&amp;rarr;')).not.toBe('→');
  });

  it('decodeRefs never decodes a quote — R6 owns those and must run after R4 parses attributes', () => {
    expect(decodeRefs('&#39;')).toBe('&#39;');
    expect(decodeRefs('&#x27;')).toBe('&#x27;');
    expect(decodeRefs('&#34;')).toBe('&#34;');
  });

  it('decodeTextAmp decodes a bare & in TEXT only, not inside an attribute value', () => {
    expect(decodeTextAmp('<h3>P&amp;L</h3>')).toBe('<h3>P&L</h3>');
    expect(decodeTextAmp('<a title="a &amp; b">x</a>')).toBe('<a title="a &amp; b">x</a>');
  });

  it('decodeTextAmp does not touch an &amp; that prefixes another reference', () => {
    expect(decodeTextAmp('<p>&amp;rarr;</p>')).toBe('<p>&amp;rarr;</p>');
    expect(decodeTextAmp('<p>&amp;#8635;</p>')).toBe('<p>&amp;#8635;</p>');
    expect(decodeTextAmp('<p>&amp;nbsp;</p>')).toBe('<p>&amp;nbsp;</p>');
  });

  it('neither rule can absorb a changed number, a dropped row or a renamed label', () => {
    expect(sameDocument('<td>RM 1.00</td>')).not.toBe(sameDocument('<td>RM 2.00</td>'));
    expect(sameDocument('<tr><td>a</td></tr><tr><td>b</td></tr>')).not.toBe(sameDocument('<tr><td>a</td></tr>'));
    expect(sameDocument('<div class="l">Net margin</div>')).not.toBe(sameDocument('<div class="l">Gross margin</div>'));
    expect(sameDocument('<rect fill="#0E9D67"></rect>')).not.toBe(sameDocument('<rect></rect>'));
  });

  it('and the golden really needs both — it holds a named reference AND a bare &', () => {
    expect(STRIP).toContain('&rarr;');
    expect(STRIP).toContain('&divide;');
    expect(SCREEN).toContain('P&L —');
    expect(SCREEN).toContain('P&L & position');
  });
});

describe('the six states neither golden holds', () => {
  // A golden is one state of one screen. These are the other six, mirrored from app.html anyway because
  // a route with nothing to render while a fetch is in flight is a blank screen. Said plainly: the
  // parity diff above does NOT reach any of them.
  const renderFn = APP.slice(APP.indexOf('async function renderCFO()'), APP.indexOf('function cfoRender()'));
  const loadFn = APP.slice(APP.indexOf('async function cfoAnalyticsLoad()'), APP.indexOf('function finDsoBars('));

  it('renderCFO()s spinner names the scope, and falls back to five companies', () => {
    expect(renderFn).toContain("var loadingWho = scopeCo ? esc(scopeCo) : ('all '+(((COMPANIES||[]).length)||5)+' companies');");
    const group = renderToStaticMarkup(<Loading scopeName={null} companyCount={COMPANIES.length} />);
    expect(group).toContain('CFO Cockpit · group financial position');
    expect(group).toContain('Computing analytics for all ' + COMPANIES.length + ' companies…');
    expect(renderToStaticMarkup(<Loading scopeName={null} companyCount={0} />)).toContain('all 5 companies');
    const scoped = renderToStaticMarkup(<Loading scopeName="SKINDAE SDN BHD" companyCount={2} />);
    expect(scoped).toContain('CFO Cockpit · SKINDAE SDN BHD');
    expect(scoped).toContain('Computing analytics for SKINDAE SDN BHD…');
  });

  it('both of renderCFO()s failure panels are mirrored, with their two different icons', () => {
    expect(renderFn).toContain("<div class=\"empty-ico\">📉</div>");
    expect(renderFn).toContain("<div class=\"empty-ico\">⚠️</div>");
    expect(renderFn).toContain("'Could not load analytics'");
    expect(renderToStaticMarkup(<ErrorPanel icon="📉" text="Could not load analytics" />))
      .toBe('<div class="panel"><div class="empty"><div class="empty-ico">📉</div><div>Could not load analytics</div></div></div>');
    expect(renderToStaticMarkup(<ErrorPanel icon="⚠️" text="boom" />)).toContain('⚠️');
  });

  it('cfoAnalyticsLoad()s spinner is a DIFFERENT document from the strip it is replaced by', () => {
    expect(loadFn).toContain('Computing DSO/DPO, customer risk, intercompany');
    const html = renderToStaticMarkup(<AnalyticsLoading />);
    expect(html).toContain('📐 Financial analytics');       // lower-case "analytics" — the strip says "Analytics"
    expect(html).toContain('Computing DSO/DPO, customer risk, intercompany…');
    expect(sameDocument(html)).not.toBe(wantStripDoc);
  });

  it('and a failure in ONE request must not blank the other — they are separate documents', () => {
    // Two independent fetches; the strip failing leaves the whole dashboard above it intact.
    const html = renderToStaticMarkup(screen({ analytics: <ErrorPanel icon="📉" text="Could not load analytics" /> }));
    expect(html).toContain('RM 2,288,721.55');
    expect(html).toContain('Could not load analytics');
  });
});

const wantStripDoc = sameDocument(STRIP);

describe('the colour thresholds and empty branches no golden reaches', () => {
  // A golden is one state of one screen, and this fixture happens to sit on ONE side of most of the
  // conditionals on the screen. Every one of them decides how an executive reads a number — a risk
  // percentage in muted grey and the same figure in red mean different things — so each is driven
  // directly here. The intercompany case above is why: a boundary that no test crosses is a boundary a
  // port can move.

  const strip = (over: Partial<FinData>) => renderToStaticMarkup(<Analytics data={{ ...FIN, ...over }} />);
  const riskWith = (risk: number, worst = 10) => strip({
    customer_risk: { ...FIN.customer_risk, customers: [{ cust: 'X', tenant_name: 'Y', ar_open: 1, overdue: 1, worst_days: worst, provision: 1, risk }] },
  });

  it('customer risk: muted under 15, amber from 15, red from 40 — the fixture is all muted', () => {
    expect(FIN.customer_risk!.customers!.every((c) => (c.risk || 0) < 15)).toBe(true);   // guard the guard
    expect(riskWith(14)).toContain('color:var(--muted);font-size:10px');
    expect(riskWith(15)).toContain('color:var(--amber);font-size:10px');
    expect(riskWith(39)).toContain('color:var(--amber);font-size:10px');
    expect(riskWith(40)).toContain('color:var(--red-soft);font-size:10px');
  });

  it('worst age: an em-dash at zero, amber above it, red past 60', () => {
    expect(riskWith(1, 0)).toContain('color:var(--muted)">—<');
    expect(riskWith(1, 1)).toContain('color:var(--amber)">1d<');
    expect(riskWith(1, 60)).toContain('color:var(--amber)">60d<');
    expect(riskWith(1, 61)).toContain('color:var(--red-soft)">61d<');
  });

  it('overdue is amber only when there IS one', () => {
    const none = strip({ customer_risk: { ...FIN.customer_risk, customers: [{ cust: 'X', ar_open: 1, overdue: 0, risk: 1 }] } });
    expect(none).toContain('color:var(--muted)">RM 0.00<');
  });

  it('the scorecard health dot has a THIRD state the fixture never shows', () => {
    const healths = CFO.companies!.map((c) => c.health);
    expect(healths).toContain('green');
    expect(healths).toContain('amber');
    expect(healths).not.toContain('red');                     // guard the guard
    // Asserted on the CELL, not on the character: a first draft looked for a bare '🔴' and passed with
    // the fall-through inverted, because the alerts panel above already prints one for a high-severity
    // alert. The scorecard cell is `<b>{name}</b> {dot}`, so that is what is matched.
    const dots = (h: string) => (h.match(/<\/b> (🟢|🟡|🔴)/g) || []).map((m) => m.slice(-2));
    expect(dots(rendered())).toEqual(['🟢', '🟡']);
    const pressured = { ...CFO, companies: CFO.companies!.map((c) => ({ ...c, health: 'red' })) };
    expect(dots(rendered({ data: pressured }))).toEqual(['🔴', '🔴']);
    // …and anything the server does NOT say is green or amber reads as cash pressure, which is the safe
    // direction and is the legacy's own fall-through (app.html:1897).
    const unknown = { ...CFO, companies: CFO.companies!.map((c) => ({ ...c, health: undefined })) };
    expect(dots(rendered({ data: unknown }))).toEqual(['🔴', '🔴']);
    expect(dots(rendered({ data: { ...CFO, companies: CFO.companies!.map((c) => ({ ...c, health: 'GREEN' })) } }))).toEqual(['🔴', '🔴']);
  });

  it('a company with no revenue gets no margin line rather than a division by zero', () => {
    const zero = { ...CFO, companies: CFO.companies!.map((c) => ({ ...c, revenue: 0 })) };
    const html = rendered({ data: zero });
    expect(html).not.toContain('% margin');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });

  it('a month with no revenue gets an em-dash margin, and a flat month no MoM', () => {
    const flat = { ...CFO, monthly: [{ month: '2026-07', revenue: 0, bills: 100 }, { month: '2026-08', revenue: 0, bills: 100 }] };
    const html = rendered({ data: flat });
    expect(html).not.toContain('NaN');
    expect((html.match(/<td class="amt">—<\/td>/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('the group margin falls back to 0, not NaN, on no revenue', () => {
    expect(rendered({ data: { ...CFO, group: { ...CFO.group, revenue: 0 } } })).toContain('>0%<');
  });

  it('every chart has an empty state, and none of them renders a blank SVG', () => {
    const bare = rendered({ data: { ...CFO, companies: [], companies_monthly: [], monthly: [], top_customers: [] } });
    expect(bare).toContain('No monthly data.');
    expect(bare).toContain('No revenue data.');
    expect(bare).toContain('No expense data.');
    expect(bare).toContain('No customer data.');
    expect(bare).not.toContain('<svg width="100%" viewBox="0 0 780 270"');   // no zero-bar chart
    const bareStrip = strip({ dso_dpo: { group: {}, companies: [] }, cashflow_13w: [], revenue_forecast: {}, vendor_spend: {}, intercompany: {}, customer_risk: {} });
    expect(bareStrip).toContain('Not enough data.');
    expect(bareStrip).toContain('No dated open invoices to forecast.');
    expect(bareStrip).toContain('Not enough history to forecast.');
    expect(bareStrip).toContain('No vendor spend.');
    expect(bareStrip).toContain('No open receivables.');
    expect(bareStrip).toContain('No material intercompany balances (group internal open total RM 0.00)');
  });

  it('the x-axis thins out past eight points, which this fixture never reaches', () => {
    // `if(n>8 && i%2) return ''` (app.html:1729) — six months here, so every label is drawn. A port
    // that dropped the condition looks identical on the golden and crowds a 12-month view illegibly.
    expect(CFO.companies_monthly![0].series.length).toBe(6);        // guard the guard
    const long = Array.from({ length: 12 }, (_, i) => ({ month: '2026-' + String(i + 1).padStart(2, '0'), revenue: 100 + i, bills: 50 }));
    const wide = { ...CFO, companies_monthly: CFO.companies_monthly!.map((s) => ({ ...s, series: long })) };
    const html = rendered({ data: wide });
    expect(html).toContain('>01</text>');       // month.slice(5) of '2026-01'
    expect(html).not.toContain('>02</text>');   // odd index, dropped
    expect(html).toContain('>03</text>');
  });

  it("the forecast's excluded-month note agrees in NUMBER with the months it names", () => {
    expect(strip({})).toContain('2026-08 looked incomplete and was excluded');
    expect(strip({ revenue_forecast: { ...FIN.revenue_forecast, excluded: ['2026-07', '2026-08'] } }))
      .toContain('2026-07, 2026-08 looked incomplete and were excluded');
    expect(strip({ revenue_forecast: { ...FIN.revenue_forecast, excluded: [] } })).not.toContain('excluded from the forecast');
  });

  it('cfoMk() drops a decimal past ten million, and keeps the sign', () => {
    // The on-chart labels. Every axis on this screen is written by it, so a wrong bucket relabels a
    // whole chart while every bar stays where it is.
    expect(cfoMk(999)).toBe('RM999');
    expect(cfoMk(1000)).toBe('RM1k');
    expect(cfoMk(999999)).toBe('RM1000k');
    expect(cfoMk(1e6)).toBe('RM1.0M');
    expect(cfoMk(9999999)).toBe('RM10.0M');
    expect(cfoMk(1e7)).toBe('RM10M');
    expect(cfoMk(-2500000)).toBe('-RM2.5M');
    expect(cfoMk(null)).toBe('RM0');
    expect(cfoMk('nonsense')).toBe('RM0');
  });

  it('cfoShortName() strips the suffix wherever it sits, and leaves the rest alone', () => {
    expect(cfoShortName('SKINDAE SDN BHD')).toBe('SKINDAE');
    expect(cfoShortName('I PROCARE MALAYSIA SDN BHD')).toBe('I PROCARE MALAYSIA');
    expect(cfoShortName('CTG4U HOLDINGS')).toBe('HOLDINGS');
    expect(cfoShortName('ACME BERHAD')).toBe('ACME BERHAD');
    expect(cfoShortName(null)).toBe('');
  });

  it('the MoM tail and the ▲▼ arrows only appear when there is a previous month to compare', () => {
    expect(rendered()).toContain('revenue this month ▼ 58% vs last');
    const noPrev = { ...CFO, group: { ...CFO.group, rev_prev: 0 } };
    expect(rendered({ data: noPrev })).not.toContain('revenue this month');
    const up = { ...CFO, group: { ...CFO.group, rev_cur: 400000, rev_prev: 200000 } };
    expect(rendered({ data: up })).toContain('revenue this month ▲ 100% vs last');
  });

  it('the scoped branch names the company, and falls back rather than printing nothing', () => {
    const scoped = { ...CFO, scoped_tenant: 'co1' };
    expect(rendered({ data: scoped, scopeName: 'SKINDAE SDN BHD' })).toContain('<b style="color:var(--text)">SKINDAE SDN BHD</b>');
    expect(rendered({ data: scoped, scopeName: null })).toContain('<b style="color:var(--text)">selected company</b>');
    expect(rendered({ data: scoped })).not.toContain('Group financial position');
  });
});
