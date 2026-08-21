// Finance OS · Overview — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.overview.html` was captured from `renderOverview()` (app.html:2081) by the
// 40-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts, tests/parity.ts or tests/handlers.ts. The components are rendered with
// `renderToStaticMarkup` from the SAME fixtures the golden was captured from — tests/render_fixtures.ts,
// imported directly — normalised by the harness's own normalise(), relaxed by the documented layer in
// ./parity.ts, and compared.
//
// NO SEVENTH SHARED RELAXATION. Two SCREEN-LOCAL rules, both of kinds already established in this repo
// and both held to parity.ts's own bar (see each one's comment and its "cannot hide" cases):
//   • `decodeTextAmp` — hr-payslip's rule verbatim. `ovTrendRender()` writes `monthly P&L` and
//     `Revenue vs Expenses · monthly P&L` with a bare `&`, which React's text escaper cannot emit.
//   • `decodeNamedRefs` — hr-payroll's / finance-selfbill's kind. `&divide;` is written into
//     app.html:2242's HTML string; React emits the character `÷`.
// Neither is in ./parity.ts: that file is shared with sibling migrations in flight and the brief puts it
// off limits.
//
// ── FOUR SECTIONS ─────────────────────────────────────────────────────────────────────────────────
// `#overview`, `#ov-trend`, `#ov-charts` and `#last-refresh` — four ids, four legacy statements, four
// components, four diffs. Handler parity runs PER SECTION; three of the four carry no handler at all,
// which is `finance.bankfeed`'s `expect(want).toEqual([])` case rather than a licence to skip the check.
//
// ── THE GOLDEN IS THE SCREEN, AND THAT WAS CHECKED ────────────────────────────────────────────────
// `renderOverview() does nothing invisible after its write` below reads the tail of the function out of
// app.html and asserts it contains no `.className=`, no `.value=`, no `appendChild` and no
// `classList.toggle` — the four mutations that made `finance.qinv`, `finance.users` and
// `finance.gateway`'s goldens hold states no operator sees. It has one `insertAdjacentHTML`, which the
// harness DOES record, which is why the two empty placeholder divs are in the `#overview` section.
//
// ── SEVENTEEN DOCUMENTS, ONE PER SECTION IN THE GOLDEN ────────────────────────────────────────────
// `#overview` has 8, `#ov-trend` 4, `#ov-charts` 5, `#last-refresh` 1 — the count is in the component
// file's header. Two data modes (`OV_RANGE === null` → `{api:'overview'}` WITH bank balances;
// `OV_RANGE !== null` → `{api:'overview_range'}` without) reachable through seven presets and a custom
// from/to. The golden holds the default "Current" YTD mode, loaded, no company filter, two companies.
// Every other document is mirrored from app.html and pinned by assertion below.
//
// ── TWO DEFECTS THIS FILE DID NOT CATCH ON THE FIRST TRY ──────────────────────────────────────────
// Both found by introducing the defect and watching for red, which is the only way to know:
//  • `okRows.reduce` → `cs.reduce` (counting a company whose live fetch failed) passed, because the
//    fixture's failed company had all-NULL figures and `+null` is 0. `7b` below drives the case that
//    actually moves the total — a row the server FLAGGED while still returning figures, which is what
//    app.html:2113's `c.error || c.income === null` is really about.
//  • re-rounding a chart coordinate passed, because `Number(x.toFixed(2)).toFixed(1)` is the same
//    string. `catches a CHART COORDINATE …` now drives the component's own output as well as a mutated
//    golden, so a precision change with every value intact fails.
//
// ── DATES ─────────────────────────────────────────────────────────────────────────────────────────
// `finance.calendar`'s finding: an output assertion cannot see a timezone defect on a fleet at UTC+8.
// Two kinds here, pinned two ways — `todayLocalISO()` / `ovDates()` by their SOURCE (the legacy is
// deliberately zone-safe and every output check for them passes in MYT either way), and `r.as_of` /
// `#last-refresh` under the harness's UTC override re-applied for this file, because there the legacy
// itself calls `toLocale*`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FIXTURES } from '../../tests/render_fixtures';
import FinanceOverview, {
  LastRefresh, OV_PALETTE, OV_PRESETS, OvCharts, OvChartsError, OvChartsLoading, OvHeader, OvTrend,
  OvTrendError, OvTrendLoading, activePreset, cfoMk, cfoShortName, overviewReachable, ovDates,
  todayLocalISO,
  type FinanceOverviewProps, type OvCompany, type OvMonth, type OvRange, type OvRangeCompany,
  type OvRangeData, type OvVendor, type OvYtd, type PnlReport,
} from '../src/finance-overview';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');
const SRC = readFileSync(join(REPO, 'web', 'src', 'finance-overview.tsx'), 'utf8');

/** tests/render_harness.ts:19's `FIXED_MS`, copied — Node cannot load the Deno harness. */
const FIXED_MS = Date.parse('2026-08-18T09:30:00.000Z');

/**
 * ── THE ZONE PIN — hr.clock's rule, not a relaxation ──────────────────────────────────────────────
 *
 * The goldens were captured under tests/render_harness.ts's UTC override on `Date.prototype.toLocale*`.
 * `r.as_of` (app.html:2104) and the `#last-refresh` clock (app.html:2141) are `toLocale*` calls IN
 * app.html, so the React port makes the same calls and would otherwise render in whatever zone the
 * machine sits in. This changes what BOTH sides are read under, not what counts as a match.
 */
const REAL = {
  s: Date.prototype.toLocaleString, d: Date.prototype.toLocaleDateString, t: Date.prototype.toLocaleTimeString,
};
const utc = (fn: (...a: never[]) => string) =>
  function (this: Date, locale?: unknown, opts?: Record<string, unknown>) {
    return (fn as unknown as (l: unknown, o: unknown) => string).call(this, locale, { ...(opts || {}), timeZone: 'UTC' });
  };
beforeAll(() => {
  Date.prototype.toLocaleString = utc(REAL.s as never) as never;
  Date.prototype.toLocaleDateString = utc(REAL.d as never) as never;
  Date.prototype.toLocaleTimeString = utc(REAL.t as never) as never;
});
afterAll(() => {
  Date.prototype.toLocaleString = REAL.s;
  Date.prototype.toLocaleDateString = REAL.d;
  Date.prototype.toLocaleTimeString = REAL.t;
});

/**
 * A bare `&` in TEXT and `&amp;` are the same text node — hr-payslip's rule, verbatim, and its reasoning
 * applies unchanged: `ovTrendRender()` writes `monthly P&L` straight into its HTML string without
 * `esc()`, and a `&` in JSX text always comes out `&amp;`. Narrowest form: only `&amp;`, only OUTSIDE a
 * tag, and never where it prefixes another reference, so a doubly-escaped entity stays visible.
 */
function decodeTextAmp(html: string): string {
  return html.split(/(<[a-zA-Z\/!][^>]*>)/).map((part, i) =>
    i % 2 === 1 ? part : part.replace(/&amp;(?![a-zA-Z]+;|#\d+;|#[xX][0-9a-fA-F]+;)/g, '&')).join('');
}

/**
 * A NAMED character reference and its character are the same text — hr-payroll's `decodeNamedRefs` and
 * finance-selfbill's `decodeRefs`, narrowed to the ONE name app.html writes on this screen.
 * `ovTrendRender()` writes `Net &divide; Revenue` (app.html:2242) as eight literal characters; React's
 * text escaper emits only `& < > " '` as references, so `÷` in JSX comes out as the character and the
 * literal string `"&divide;"` would come out as `&amp;divide;`. Applied to BOTH sides.
 *
 * Runs BEFORE decodeTextAmp so `&amp;divide;` — the doubly-escaped defect where the entity prints on
 * screen — is NOT silently repaired: decodeTextAmp's own negative lookahead leaves it alone, and this
 * rule only matches a bare `&divide;`.
 */
function decodeNamedRefs(html: string): string {
  return html.replace(/&divide;/g, '÷');
}

/** Both sides read as the document a parser builds, then compared under ./parity.ts's six relaxations. */
const sameDocument = (html: string) => relax(decodeTextAmp(decodeNamedRefs(html)));

const G_OVERVIEW = goldenSection('finance.overview', 'overview');
const G_TREND = goldenSection('finance.overview', 'ov-trend');
const G_CHARTS = goldenSection('finance.overview', 'ov-charts');
const G_REFRESH = goldenSection('finance.overview', 'last-refresh');

const YTD = FIXTURES.overview as unknown as OvYtd;
const GROUP = FIXTURES.group_dashboard as unknown as { monthly: OvMonth[]; top_vendors?: OvVendor[] };
const PNL = FIXTURES.pnl_report as unknown as PnlReport;

const noop = () => {};

function screen(over: Partial<FinanceOverviewProps> = {}) {
  return (
    <FinanceOverview
      range={null} now={FIXED_MS} filter="" ytd={YTD} rangeData={null} error={null}
      onPreset={noop} onApplyCustom={noop} {...over}
    />
  );
}

const rendered = (over: Partial<FinanceOverviewProps> = {}) => sameDocument(renderToStaticMarkup(screen(over)));
const want = sameDocument(G_OVERVIEW);

const trend = (over: Partial<Parameters<typeof OvTrend>[0]> = {}) =>
  <OvTrend monthly={GROUP.monthly} vendors={GROUP.top_vendors || []} {...over} />;
const charts = (over: Partial<Parameters<typeof OvCharts>[0]> = {}) =>
  <OvCharts report={PNL} filter="" {...over} />;

describe('Finance Overview — React vs the legacy golden', () => {
  it('renders the same #overview tab div renderOverview() does', () => {
    expect(rendered()).toBe(want);
  });

  it('renders the same #ov-trend ovTrendRender() does', () => {
    expect(sameDocument(renderToStaticMarkup(trend()))).toBe(sameDocument(G_TREND));
  });

  it('renders the same #ov-charts ovChartsRender() does', () => {
    expect(sameDocument(renderToStaticMarkup(charts()))).toBe(sameDocument(G_CHARTS));
  });

  it('renders the same #last-refresh renderOverview() writes into the shell', () => {
    expect(sameDocument(renderToStaticMarkup(<LastRefresh now={FIXED_MS} />))).toBe(sameDocument(G_REFRESH));
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * Run PER SECTION. Only `#overview` carries handlers at all — eight of them, `ovSetPreset('current')`
 * … `ovSetPreset('last_year')` and `ovApplyCustom()`. The other three sections carry NONE, which is
 * `finance.bankfeed`'s case: R1 strips `on*=` from the string diff, so a port that grew a button in
 * `#ov-trend` or turned the trend into something clickable would look identical. `expect(want).toEqual([])`
 * is the assertion there, not a reason to skip the check.
 *
 * ONE local widening, established and COPIED rather than pushed into the shared ./handlers.ts:
 *  • `LEGACY_TO_PROP` — `ovApplyCustom()` takes no arguments, so its argument list is legitimately empty
 *    and only its IDENTITY separates it from any of the seven preset buttons if one lost its argument.
 *    Keyed on the whole raw text first, finance.wht's shape.
 *
 * `identArgs()` is deliberately NOT copied here: every argument on this screen is a quoted string, so
 * `goldenHandlers()`'s own extraction is complete and widening it would only be noise.
 */
const LEGACY_TO_PROP: Record<string, string> = {
  'ovApplyCustom()': 'apply',
  ovSetPreset: 'preset',
};

const propFor = (raw: string) => LEGACY_TO_PROP[raw] ?? LEGACY_TO_PROP[raw.replace(/\(.*$/, '')] ?? raw;

function checkSection(golden: string, tree: React.ReactNode, calls: { attr: string; args: string[] }[]) {
  const wantH = goldenHandlers(golden);
  const got = reactHandlers(tree);
  expect(got.map((h) => h.attr)).toEqual(wantH.map((h) => h.attr));
  got.forEach((h) => h.invoke());
  expect(calls.map((c) => c.args)).toEqual(wantH.map((h) => [...h.raw.matchAll(/'([^']*)'/g)].map((m) => m[1])));
  expect(calls.map((c) => c.attr)).toEqual(wantH.map((h) => propFor(h.raw)));
  return wantH;
}

function assertHandlerParity(over: Partial<FinanceOverviewProps> = {}) {
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args.filter((a) => (typeof a === 'string' || typeof a === 'number') && a !== STUB_VALUE).map(String),
    });

  const h = checkSection(
    G_OVERVIEW,
    screen({ onPreset: record('preset') as never, onApplyCustom: record('apply') as never, ...over }),
    calls,
  );

  // Guard the guard: a golden that stopped carrying handlers would make the above pass vacuously and
  // turn R1 into the blind strip it is not allowed to be.
  expect(h.length).toBe(OV_PRESETS.length + 1);
  expect(h.every((x) => propFor(x.raw) !== x.raw)).toBe(true);
  expect(h.filter((x) => x.raw.indexOf("'") >= 0).length).toBe(OV_PRESETS.length);

  // The three sections that carry NO handler — finance.bankfeed's case, asserted rather than skipped.
  for (const [g, tree] of [[G_TREND, trend()], [G_CHARTS, charts()], [G_REFRESH, <LastRefresh now={FIXED_MS} />]] as const) {
    expect(goldenHandlers(g)).toEqual([]);
    expect(reactHandlers(tree)).toEqual([]);
  }
}

describe('handlers', () => {
  it('wires the same handlers, to the same periods, in the same order', () => {
    assertHandlerParity();
  });

  it('catches a preset button wired to the WRONG period', () => {
    // The whole screen changes meaning: "Last month" fetching this month's range shows the operator
    // figures for a period they did not ask for, with the pill still saying what they clicked.
    const swapped = OV_PRESETS.map((p) => p[0] === 'last_month' ? ['this_month', p[1]] as [string, string] : p);
    const calls: { attr: string; args: string[] }[] = [];
    const rec = (...a: unknown[]) => calls.push({ attr: 'preset', args: a.filter((x) => typeof x === 'string' && x !== STUB_VALUE).map(String) });
    const tree = (
      <div>
        {swapped.map((p) => <button key={p[0]} onClick={() => rec(p[0])}>{p[1]}</button>)}
        <button onClick={() => calls.push({ attr: 'apply', args: [] })}>Apply</button>
      </div>
    );
    reactHandlers(tree).forEach((x) => x.invoke());
    expect(calls.map((c) => c.args)).not.toEqual(
      goldenHandlers(G_OVERVIEW).map((h) => [...h.raw.matchAll(/'([^']*)'/g)].map((m) => m[1])),
    );
  });

  it('catches Apply and a preset button swapping identities', () => {
    // Both are argument-free once R1 has run, so only LEGACY_TO_PROP separates them. An Apply button
    // that ran a preset would silently discard whatever the operator typed into the date boxes.
    const raws = goldenHandlers(G_OVERVIEW).map((h) => h.raw);
    expect(raws.map(propFor)).toEqual([...OV_PRESETS.map(() => 'preset'), 'apply']);
    expect(propFor('ovSetPreset(\'ytd\')')).not.toBe(propFor('ovApplyCustom()'));
  });
});

/* ══ The golden is the screen an operator sees — checked, not assumed ══════════════════════════════ */

describe('renderOverview() does nothing invisible after its write', () => {
  const TAIL = APP.slice(APP.indexOf("const ovEl=document.getElementById('overview');"), APP.indexOf('var OV_TREND=null;'));

  it('appends the two placeholders with insertAdjacentHTML, which the harness DOES record', () => {
    expect(TAIL).toContain("ovEl.insertAdjacentHTML('beforeend','<div id=\"ov-trend\" style=\"margin-top:14px\"></div><div id=\"ov-charts\" style=\"margin-top:14px\"></div>')");
    expect(G_OVERVIEW).toContain('<div id="ov-trend" style="margin-top:14px">');
    expect(G_OVERVIEW).toContain('<div id="ov-charts" style="margin-top:14px">');
  });

  it('does NOT reassign a className, a value, a class list or append a node', () => {
    // The four mutations that made finance.qinv's, finance.users' and finance.gateway's goldens hold a
    // state no operator sees. If one is ever added, this fails instead of the diff silently rotting.
    for (const invisible of ['.className=', '.value=', 'appendChild', 'classList']) {
      expect(TAIL).not.toContain(invisible);
    }
  });

  it('so the #overview golden is the LOADED screen, not spin()\'s skeleton', () => {
    expect(G_OVERVIEW).not.toContain('sk-card');
    expect(G_OVERVIEW).toContain('Company Financials (YTD)');
  });

  it('and #ov-trend / #ov-charts are their LOADED states, not their spinners', () => {
    // Both loaders write their div twice — the spinner, then the result. Last write wins per id.
    expect(G_TREND).not.toContain('class="spinner"');
    expect(G_CHARTS).not.toContain('class="spinner"');
  });
});

/* ══ The two screen-local rules still bite ════════════════════════════════════════════════════════ */

describe('decodeTextAmp cannot hide a real change', () => {
  it('is why this screen needs a rule at all', () => {
    // app.html writes the bare `&`; React cannot.
    expect(G_TREND).toContain('monthly P&L');
    expect(renderToStaticMarkup(trend())).toContain('monthly P&amp;L');
  });

  it('only touches &amp; and only outside a tag', () => {
    expect(decodeTextAmp('<i title="a&amp;b">x&amp;y</i>')).toBe('<i title="a&amp;b">x&y</i>');
    expect(decodeTextAmp('&amp;lt;')).toBe('&amp;lt;');          // a doubly-escaped entity stays visible
    expect(decodeTextAmp('&amp;#8635;')).toBe('&amp;#8635;');
    expect(decodeTextAmp('&lt;b&gt;')).toBe('&lt;b&gt;');        // never invents a tag
  });

  it('cannot absorb a changed number, a renamed label or a dropped row', () => {
    expect(decodeTextAmp('RM 1,317,020.50')).toBe('RM 1,317,020.50');
    expect(sameDocument(G_TREND.replace('RM 1,317,020.50', 'RM 1,317,020.51'))).not.toBe(sameDocument(G_TREND));
    expect(sameDocument(G_TREND.replace('Revenue · 12mo', 'Revenue · 12 months'))).not.toBe(sameDocument(G_TREND));
    expect(sameDocument(G_TREND.replace('<circle cx="111.7" cy="196.9" r="2" fill="#5b9bd5">', ''))).not.toBe(sameDocument(G_TREND));
  });
});

describe('decodeNamedRefs cannot hide a real change', () => {
  it('is why this screen needs it', () => {
    expect(G_TREND).toContain('Net &divide; Revenue');
    expect(renderToStaticMarkup(trend())).toContain('Net ÷ Revenue');
  });

  it('decodes only &divide;, and leaves the doubly-escaped defect visible', () => {
    expect(decodeNamedRefs('&divide;')).toBe('÷');
    expect(decodeNamedRefs('&nbsp;')).toBe('&nbsp;');            // R2 owns that one, and needs the entity
    expect(sameDocument('&amp;divide;')).toBe(sameDocument('&amp;divide;'));
    expect(sameDocument('<i>&amp;divide;</i>')).not.toBe(sameDocument('<i>&divide;</i>'));
  });
});

/* ══ The permission gate ══════════════════════════════════════════════════════════════════════════ */

describe('the gate is the FEATURE flag, and it is app.html\'s own line', () => {
  const BLOCK = APP.slice(APP.indexOf("document.querySelectorAll('.tab').forEach(function(el){"), APP.indexOf("// Hide any category whose sub-tabs are all hidden"));

  it('overview is named in NO branch of showApp()\'s block', () => {
    // Read the block, do not copy a neighbour: the two standalone `if`s at the top and the `else if`
    // chain that restarts at `ctgaccess` mean adjacent tabs are gated by different rules.
    expect(BLOCK).toContain("t==='ctgaccess'");                  // guard the guard: this really is the block
    expect(BLOCK).toContain("el.classList.toggle('hide', feats.indexOf(t)<0)");
    expect(BLOCK).not.toContain("t==='overview'");
  });

  it('grants on the feature and refuses without it', () => {
    expect(overviewReachable({ features: ['overview', 'pnl'] })).toBe(true);
    expect(overviewReachable({ features: ['pnl'] })).toBe(false);
    expect(overviewReachable({ features: [] })).toBe(false);
    expect(overviewReachable({})).toBe(false);
    expect(overviewReachable(null)).toBe(false);
    expect(overviewReachable(undefined)).toBe(false);
  });

  it('is NOT the admin gate — manage_users grants nothing here', () => {
    // `wht`, `selfbill`, `gateway`, `bankfeed` and `salesrecon` ARE `!canManage`; copying one of them
    // would grant this screen's bank balances to every admin whose role lacks the feature, and refuse
    // it to the finance and viewer roles whose role DOES carry it.
    expect(overviewReachable({ features: [] } as never)).toBe(false);
    const roles = FIXTURES.roles_list as unknown as { roles: { name: string; features: string[]; manage_users: boolean }[] };
    const viewer = roles.roles.find((r) => r.name === 'viewer')!;
    expect(viewer.manage_users).toBe(false);
    expect(overviewReachable(viewer)).toBe(true);                // an admin-gated port would refuse this
  });

  it('the shipped fixture\'s own permission set reaches it', () => {
    expect(overviewReachable(FIXTURES.my_perms as never)).toBe(true);
  });
});

/* ══ Dates: the derivation is pinned in the SOURCE, the format under a zone override ═══════════════ */

describe('todayLocalISO() and ovDates() derive the MYT day without reading a zone', () => {
  // finance.calendar's finding: this machine and CI both sit at UTC+8, so EVERY output assertion below
  // passes whether the implementation is zone-safe or not. The source check is the one that bites.
  const body = (name: string) => {
    const at = SRC.indexOf('export function ' + name);
    expect(at).toBeGreaterThan(0);
    return SRC.slice(at, SRC.indexOf('\n}\n', at)).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  };

  it('neither calls toISOString or toLocale*', () => {
    for (const n of ['todayLocalISO', 'ovDates']) {
      expect(body(n)).not.toContain('toISOString');
      expect(body(n)).not.toContain('toLocale');
    }
  });

  it('todayLocalISO reads the MYT calendar day back with getUTC*, as app.html does', () => {
    const b = body('todayLocalISO');
    expect(b).toContain('now + 8 * 3600000');
    expect(b).toContain('getUTCFullYear');
    expect(b).toContain('getUTCMonth');
    expect(b).toContain('getUTCDate');
    // and its output rolls over at MYT midnight, not UTC midnight
    expect(todayLocalISO(Date.parse('2026-08-18T15:59:59Z'))).toBe('2026-08-18');
    expect(todayLocalISO(Date.parse('2026-08-18T16:00:00Z'))).toBe('2026-08-19');
  });

  it('ovDates builds YYYY-MM-DD by hand from LOCAL getters, as app.html does', () => {
    const b = body('ovDates');
    expect(b).toContain('getUTCFullYear');
    expect(b).toContain('d.getFullYear()');
    expect(b).toContain('d.getMonth() + 1');
    expect(b).toContain('d.getDate()');
  });

  it('is a pure function of the instant it is handed', () => {
    expect(ovDates(FIXED_MS)).toEqual(ovDates(FIXED_MS));
    expect(ovDates(FIXED_MS).this_month).not.toEqual(ovDates(FIXED_MS - 40 * 86400000).this_month);
  });

  it('produces the seven ranges app.html does, at the golden\'s instant', () => {
    const d = ovDates(FIXED_MS);
    expect(d.today).toEqual({ from: '2026-08-18', to: '2026-08-18', label: 'Today' });
    expect(d.this_month).toEqual({ from: '2026-08-01', to: '2026-08-31', label: 'This month' });
    expect(d.last_month).toEqual({ from: '2026-07-01', to: '2026-07-31', label: 'Last month' });
    expect(d.this_quarter).toEqual({ from: '2026-07-01', to: '2026-09-30', label: 'This quarter' });
    expect(d.last_quarter).toEqual({ from: '2026-04-01', to: '2026-06-30', label: 'Last quarter' });
    expect(d.ytd).toEqual({ from: '2026-01-01', to: '2026-08-18', label: 'Year to date' });
    expect(d.last_year).toEqual({ from: '2025-01-01', to: '2025-12-31', label: 'Last year' });
  });

  it('rolls last_quarter back a year in Q1 — app.html:1611\'s wrap', () => {
    expect(ovDates(Date.parse('2026-02-10T00:00:00Z')).last_quarter).toEqual({ from: '2025-10-01', to: '2025-12-31', label: 'Last quarter' });
  });

  it('the `max` ceiling on both custom boxes is that day', () => {
    expect(G_OVERVIEW).toContain('id="ov_from" value="" max="2026-08-18"');
    expect(G_OVERVIEW).toContain('id="ov_to" value="" max="2026-08-18"');
  });
});

describe('the two toLocale* formats are app.html\'s own, read under the harness\'s UTC override', () => {
  it('as_of prints the harness instant, not the machine\'s zone', () => {
    expect(G_OVERVIEW).toContain('Data as of 18 Aug 2026, 01:00 · Auto-refreshed hourly');
    expect(rendered()).toContain('Data as of 18 Aug 2026, 01:00');
  });

  it('#last-refresh prints the harness clock', () => {
    expect(G_REFRESH).toContain('Refreshed 09:30');
  });

  it('app.html really is where the toLocale* calls come from', () => {
    // If either were ever rewritten to a hand-built format in app.html, mirroring it with toLocale*
    // here would stop being right — and the zone override would stop being justified.
    expect(APP).toContain("d.toLocaleString('en-GB',{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'})");
    expect(APP).toContain("new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})");
  });

  it('a company with no as_of drops the status bar entirely — app.html:2104', () => {
    expect(rendered({ ytd: { ...YTD, as_of: null } })).not.toContain('Auto-refreshed hourly');
    expect(rendered({ ytd: { ...YTD, as_of: null } })).not.toBe(want);
  });
});

/* ══ The branches no golden holds ═════════════════════════════════════════════════════════════════ */

const YTD_CO = YTD.companies as OvCompany[];

/** `{api:'overview_range'}` has no fixture — the golden was captured in the default mode. Derived. */
const RANGE: OvRange = { from: '2026-07-01', to: '2026-07-31', label: 'Last month' };
const RANGE_DATA: OvRangeData = {
  companies: YTD_CO.map((c, i) => ({
    tenant_id: c.tenant_id, tenant_name: c.tenant_name,
    income: c.income, expenses: c.expenses, net_profit: c.net_profit,
    ar_count: 11 + i, ap_count: 4 + i,
  })),
  source: 'From cached invoices (AR + AP)',
};

describe('#overview — the seven documents outside the golden', () => {
  it('1 · spin()\'s skeleton, character for character (app.html:1539)', () => {
    const html = renderToStaticMarkup(screen({ ytd: null }));
    expect(html).toContain('<div class="cards"><div class="sk-card"></div><div class="sk-card"></div><div class="sk-card"></div><div class="sk-card"></div></div>');
    expect(html).toContain('<div class="sk-row"></div><div class="sk-row"></div><div class="sk-row" style="width:65%"></div>');
    // It still carries the period header — app.html rewrites the whole div, header included, after.
    expect(html).toContain('id="ov_from"');
    // and NOT the placeholders: they are appended only on the success path.
    expect(html).not.toContain('id="ov-trend"');
  });

  it('2 · the YTD ⚠️ branch (app.html:2086) shows the server\'s message', () => {
    const html = renderToStaticMarkup(screen({ error: 'Xero token expired' }));
    expect(html).toContain('<div class="empty"><div class="empty-ico">⚠️</div><div>Xero token expired</div></div>');
    expect(html).not.toContain('id="ov-trend"');       // app.html returns before appending them
    expect(html).toContain('id="ov_from"');            // ovHeader() is still written
  });

  it('3 · the YTD 📭 branch (app.html:2087) is a FIXED string, not the server\'s', () => {
    const html = renderToStaticMarkup(screen({ ytd: null, noData: true }));
    expect(html).toContain('<div class="empty-ico">📭</div><div>No data available</div>');
  });

  it('4 · a filter that matches no company drops the panel but keeps the cards at zero', () => {
    // app.html:2096 — `if(cs.length)`. Every card reads RM 0.00, which is the honest answer for a
    // company the operator selected and this response did not carry.
    const html = renderToStaticMarkup(screen({ filter: 'nobody' }));
    expect(html).not.toContain('Company Financials');
    expect((html.match(/RM 0\.00/g) || []).length).toBe(4);
  });

  it('5 · the range mode replaces Cash with an invoice COUNT and says bank is excluded', () => {
    const html = renderToStaticMarkup(screen({ range: RANGE, ytd: null, rangeData: RANGE_DATA }));
    expect(html).toContain('<div class="l">Invoices in period</div>');
    expect(html).not.toContain('Total Cash');
    expect(html).toContain('Bank balance excluded for period view.');
    expect(html).toContain('Company Financials · Last month');
    expect(html).toContain('2026-07-01 → 2026-07-31 · From cached invoices (AR + AP).');
    expect(html).toContain('11·AR / 4·AP');
    expect(html).toContain('12·AR / 5·AP');
    // 11+4+12+5 = 32 invoices
    expect(html).toContain('<div class="n">32</div>');
  });

  it('6 · the range 📭 branch prefers the server\'s message over the fixed one (app.html:2109)', () => {
    expect(renderToStaticMarkup(screen({ range: RANGE, ytd: null, noData: true })))
      .toContain('<div class="empty-ico">📭</div><div>No data in this period</div>');
    expect(renderToStaticMarkup(screen({ range: RANGE, ytd: null, error: 'Rate limited' })))
      .toContain('<div class="empty-ico">📭</div><div>Rate limited</div>');
  });

  it('7 · B4 — a company whose live fetch failed is NOT zero, and is NOT in the totals', () => {
    // app.html:2113. `+null` is 0, so counting it would silently UNDERSTATE the group and the operator
    // would have no way to tell. This is the most dangerous single defect on this screen.
    const broken: OvRangeData = {
      partial: true,
      unavailable: ['I PROCARE MALAYSIA SDN BHD'],
      companies: [
        RANGE_DATA.companies[0],
        { ...RANGE_DATA.companies[1], income: null, expenses: null, net_profit: null, error: 'timeout' },
      ],
    };
    const html = renderToStaticMarkup(screen({ range: RANGE, ytd: null, rangeData: broken }));
    expect(html).toContain('Live Xero data unavailable for 1 company(ies): I PROCARE MALAYSIA SDN BHD. Totals below EXCLUDE them — retry in a moment.');
    expect(html).toContain('⚠️ live data unavailable — not counted');
    // the surviving company's own figures, untouched — NOT the group total
    expect(html).toContain('<div class="n">RM 378,356.35</div>');
    expect(html).not.toContain('RM 310,664.45');
    // and the failed row still shows its invoice counts, because those did arrive
    expect(html).toContain('12·AR / 5·AP');
  });

  it('7b · a row flagged `error` is excluded even when it still carries FIGURES', () => {
    // The case an all-null fixture cannot prove: `+null` is 0, so counting a null row changes no total
    // and a port that reduced over `cs` instead of `okRows` would pass. A row the server flagged while
    // still returning stale figures is the one that moves the group total — and it is the row app.html
    // means, because `errRows` is `c.error || c.income === null`, not `income === null` alone.
    const stale: OvRangeData = {
      partial: true,
      companies: [RANGE_DATA.companies[0], { ...RANGE_DATA.companies[1], error: 'stale cache' }],
    };
    const html = renderToStaticMarkup(screen({ range: RANGE, ytd: null, rangeData: stale }));
    expect(html).toContain('<div class="n">RM 378,356.35</div>');      // SKINDAE alone
    expect(html).not.toContain('RM 310,664.45');                       // NOT the group net
    expect(html).not.toContain('RM 2,288,721.55');                     // NOT the group revenue
    expect(html).toContain('⚠️ live data unavailable — not counted');
    // the invoice-count card follows the same exclusion — 11 + 4, not 11 + 4 + 12 + 5
    expect(html).toContain('<div class="n">15</div>');
    // the dot turns coral on a partial response
    expect(html).toContain('<div class="dot-green" style="background:var(--coral)"></div>');
  });

  it('the unavailable NAMES come from the server when it sent them, and from the rows when it did not', () => {
    const rows: OvRangeCompany[] = [{ ...RANGE_DATA.companies[0], income: null, error: 'x' }];
    expect(renderToStaticMarkup(screen({ range: RANGE, ytd: null, rangeData: { companies: rows } })))
      .toContain('unavailable for 1 company(ies): SKINDAE SDN BHD');
    expect(renderToStaticMarkup(screen({ range: RANGE, ytd: null, rangeData: { companies: rows, unavailable: ['SERVER SAID THIS'] } })))
      .toContain('unavailable for 1 company(ies): SERVER SAID THIS');
  });
});

describe('#ov-trend and #ov-charts — the loading and failure documents', () => {
  it('the trend spinner is app.html:2149, character for character', () => {
    const html = renderToStaticMarkup(<OvTrendLoading />);
    expect(html).toContain('<div class="panel-hd"><h3>📊 Revenue vs Expenses · monthly P&amp;L</h3></div>');
    expect(html).toContain('<div class="muted" style="padding:22px;text-align:center"><div class="spinner" style="margin:0 auto 10px"></div>Loading analytics…</div>');
  });

  it('the charts spinner is app.html:2260, character for character', () => {
    const html = renderToStaticMarkup(<OvChartsLoading />);
    expect(html).toContain('<div class="panel-hd"><h3>💹 Profit &amp; Expense Analysis</h3></div>');
    expect(html).toContain('<div class="spinner" style="margin:0 auto 10px"></div>Pulling live Profit &amp; Loss from Xero… (a few seconds)');
  });

  it('both failure branches keep their own icon — 📉 for a refusal, ⚠️ for a thrown error', () => {
    expect(renderToStaticMarkup(<OvTrendError ico="📉" message="Could not load trend" />))
      .toBe('<div class="panel"><div class="empty"><div class="empty-ico">📉</div><div>Could not load trend</div></div></div>');
    expect(renderToStaticMarkup(<OvChartsError ico="⚠️" message="Failed to fetch" />))
      .toBe('<div class="panel"><div class="empty"><div class="empty-ico">⚠️</div><div>Failed to fetch</div></div></div>');
  });

  it('a trend with no monthly data says so instead of drawing an empty axis', () => {
    const html = renderToStaticMarkup(<OvTrend monthly={[]} vendors={[]} />);
    expect(html).toContain('<div class="muted" style="padding:16px">No monthly data.</div>');
    expect(html).not.toContain('<svg');       // ovMarginLine and ovCumNet both return '' at n===0
  });

  it('the vendor bars the golden could not reach — the fixture has no top_vendors', () => {
    expect(G_TREND).toContain('No vendor spend in period.');
    const html = renderToStaticMarkup(<OvTrend monthly={GROUP.monthly} vendors={[
      { vendor: 'SHOPEE MOBILE MALAYSIA SDN BHD', spend: 600 },
      { vendor: 'TENAGA NASIONAL BERHAD', spend: 300 },
    ]} />);
    expect(html).toContain('SHOPEE MOBILE MALAYSIA');
    expect(html).toContain('RM 600.00');
    expect(html).toContain('>67%</span>');                     // share of 900
    expect(html).toContain('width:100%;height:100%;background:#e85d3c');   // bar of the max
    expect(html).toContain('width:50%;height:100%;background:#f5a623');    // half of it, next colour
  });

  it('ovVendorBars keeps at most eight, in the order the server sent them', () => {
    const many: OvVendor[] = Array.from({ length: 11 }, (_, i) => ({ vendor: 'V' + i, spend: 100 - i }));
    const html = renderToStaticMarkup(<OvTrend monthly={GROUP.monthly} vendors={many} />);
    expect((html.match(/width:16px;font-size:11px/g) || []).length).toBe(8);
    expect(html).toContain('>V7<');
    expect(html).not.toContain('>V8<');
  });

  it('the per-company panel exists only above one company — app.html:2325', () => {
    expect(G_CHARTS).toContain('Net profit by company');
    const one = renderToStaticMarkup(charts({ filter: (PNL.companies[0] as never as { tenant_id: string }).tenant_id }));
    expect(one).not.toContain('Net profit by company');
    expect(one).toContain('RM 1,482,300.55');                  // and the one company's own figures
  });

  it('a P&L that failed for one company says so and shows the rest', () => {
    const withErr: PnlReport = { ...PNL, companies: [...PNL.companies, { tenant_id: 'z', tenant_name: 'THIRD SDN BHD', error: 'no consent' }] };
    const html = renderToStaticMarkup(charts({ report: withErr }));
    expect(html).toContain('⚠ 1 company P&amp;L failed to load (THIRD SDN BHD). Showing the rest.');
    expect(html).toContain('RM 2,288,721.55');                 // the other two still total correctly
  });

  it('a P&L with no expense accounts says so rather than drawing an empty donut legend', () => {
    const bare: PnlReport = { ...PNL, companies: PNL.companies.map((c) => ({ ...c, expenses: [] })) };
    const html = renderToStaticMarkup(charts({ report: bare }));
    expect(html).toContain('No expense data in this period.');
  });

  it('a zero total draws the empty ring, not a full-circle segment — app.html:2273', () => {
    const zero: PnlReport = { companies: [{ tenant_id: 'a', tenant_name: 'A', revenue_total: 0, expense_total: 0, net_profit: 0, expenses: [] }] };
    const html = renderToStaticMarkup(charts({ report: zero }));
    expect(html).toContain('<circle cx="85" cy="85" r="67.15" fill="none" stroke="var(--panel-2)" stroke-width="35.7"></circle>');
    expect(html).toContain('last 12 months');                  // no from/to → app.html:2311's label
  });
});

/* ══ The comparison still bites ═══════════════════════════════════════════════════════════════════ */

describe('the comparison still bites — #overview', () => {
  const withCo = (i: number, over: Partial<OvCompany>) =>
    rendered({ ytd: { ...YTD, companies: YTD_CO.map((c, k) => (k === i ? { ...c, ...over } : c)) } });

  it('the golden really holds two companies and four cards', () => {
    // Guard the guard for this whole block: a golden that had captured the SKELETON would make every
    // case below vacuous.
    expect(G_OVERVIEW).not.toContain('sk-card');
    expect((G_OVERVIEW.match(/class="card /g) || []).length).toBe(4);
    expect((G_OVERVIEW.match(/<tr>/g) || []).length).toBe(3);   // header row + two companies
  });

  it('catches a CARD reading the wrong total', () => {
    // The landing screen's four figures are what everyone trusts without checking. Total Cash showing
    // revenue is a number nobody would question and every downstream conversation would be wrong.
    expect(sameDocument(G_OVERVIEW.replace('RM 704,084.55', 'RM 2,288,721.55'))).not.toBe(want);
    expect(withCo(0, { bank: 612880.12 })).not.toBe(want);
  });

  it('catches a card LABEL drifting from its figure', () => {
    expect(sameDocument(G_OVERVIEW.replace('Net Profit (YTD)', 'Net Profit'))).not.toBe(want);
    expect(sameDocument(G_OVERVIEW.replace('>Total Expenses<', '>Total Costs<'))).not.toBe(want);
  });

  it('catches the Net Profit card going GREEN on a loss', () => {
    // app.html:2092 — `tot.np>=0?'green':'red'`. A group-level loss painted green is the screen lying
    // about the single figure it exists to show.
    const loss = rendered({ ytd: { ...YTD, companies: YTD_CO.map((c) => ({ ...c, net_profit: -1 })) } });
    expect(loss).toContain('<div class="card red">');
    expect(loss).not.toContain('<div class="card green"><div class="c-ico">📈</div>');
  });

  it('catches a ROW\'s colour drifting from the sign of its net profit', () => {
    // I PROCARE is the loss-making company in the fixture and its cell is `--red-soft`. Swapping the
    // two colour vars is invisible in a screenshot review and inverts what the table says.
    expect(sameDocument(G_OVERVIEW.replace('<td class="amt" style="color:var(--red-soft)">RM -67,691.90</td>', '<td class="amt" style="color:var(--green-soft)">RM -67,691.90</td>'))).not.toBe(want);
    expect(withCo(1, { net_profit: 1 })).not.toBe(want);
  });

  it('catches a COMPANY appearing, vanishing or being renamed', () => {
    expect(rendered({ ytd: { ...YTD, companies: [YTD_CO[0]] } })).not.toBe(want);
    expect(rendered({ ytd: { ...YTD, companies: [...YTD_CO, { ...YTD_CO[0], tenant_id: 'x3', tenant_name: 'THIRD SDN BHD' }] } })).not.toBe(want);
    expect(withCo(0, { tenant_name: 'SKINDAE BHD' })).not.toBe(want);
  });

  it('catches the company FILTER not being applied', () => {
    // `curCo()` is the company bar. A port that ignored it shows an operator scoped to one company the
    // WHOLE GROUP's revenue, expenses and bank balances, with the bar still saying one company.
    expect(rendered({ filter: YTD_CO[0].tenant_id })).not.toBe(want);
    expect(rendered({ filter: YTD_CO[0].tenant_id })).not.toContain('I PROCARE');
    expect(rendered({ filter: YTD_CO[0].tenant_id })).not.toContain('2 companies');
  });

  it('catches the company COUNT pill drifting from the rows', () => {
    expect(sameDocument(G_OVERVIEW.replace('>2 companies<', '>3 companies<'))).not.toBe(want);
    // and it is suppressed at one company — app.html:2098
    expect(rendered({ ytd: { ...YTD, companies: [YTD_CO[0]] } })).not.toContain('pill-coral');
  });

  it('catches the active PERIOD button moving', () => {
    // `class="btn sm p"` marks which period the figures on screen belong to. Marking the wrong one
    // means the cards and the highlight disagree about what the operator is looking at.
    expect(sameDocument(G_OVERVIEW.replace('<button class="btn sm p" onclick="ovSetPreset(\'current\')">Current</button>', '<button class="btn sm " onclick="ovSetPreset(\'current\')">Current</button>'))).not.toBe(want);
    for (const [key] of OV_PRESETS) {
      if (key === 'current') continue;
      const html = renderToStaticMarkup(<OvHeader range={ovDates(FIXED_MS)[key] || { from: 'x', to: 'y', label: 'z' }} now={FIXED_MS} onPreset={noop} onApplyCustom={noop} />);
      expect((html.match(/class="btn sm p"/g) || []).length).toBe(1);
    }
  });

  it('pre-fills the two date boxes ONLY for a custom range — app.html:1639', () => {
    const custom: OvRange = { from: '2026-02-03', to: '2026-04-05', label: '2026-02-03 → 2026-04-05' };
    expect(activePreset(custom, FIXED_MS)).toBe('');
    const html = renderToStaticMarkup(<OvHeader range={custom} now={FIXED_MS} onPreset={noop} onApplyCustom={noop} />);
    // React fixes `value` after `style` on an input whatever the JSX order — parity.ts's R4 absorbs
    // that in the diff, but a raw string check has to look for the attribute, not the pair.
    expect(html).toContain('id="ov_from"');
    expect(html).toContain('style="font-size:12px;padding:5px 8px;width:auto" value="2026-02-03"');
    expect(html).toContain('style="font-size:12px;padding:5px 8px;width:auto" value="2026-04-05"');
    expect(html).toContain('<span class="pill pill-coral" style="margin-left:6px">2026-02-03 → 2026-04-05</span>');
    expect((html.match(/class="btn sm p"/g) || []).length).toBe(0);
    // a PRESET range leaves them blank, even though OV_RANGE is set
    const preset = renderToStaticMarkup(<OvHeader range={ovDates(FIXED_MS).ytd} now={FIXED_MS} onPreset={noop} onApplyCustom={noop} />);
    expect(preset).toContain('id="ov_from" max="2026-08-18" style="font-size:12px;padding:5px 8px;width:auto" value=""');
  });

  it('keeps the two date inputs UNCONTROLLED, under the ids ovApplyCustom() reads', () => {
    // app.html:1624 reads them back out of the DOM by id — finance.recon's `rc_co` rule. A controlled
    // port would add an onChange the golden does not carry and break handler parity.
    expect(APP).toContain("document.getElementById('ov_from').value, t=document.getElementById('ov_to').value");
    const tree = <OvHeader range={null} now={FIXED_MS} onPreset={noop} onApplyCustom={noop} />;
    expect(reactHandlers(tree).filter((h) => h.attr === 'onchange')).toEqual([]);
  });
});

describe('the comparison still bites — #ov-trend', () => {
  it('the golden really holds the loaded charts', () => {
    expect(G_TREND).toContain('<svg width="100%" viewBox="0 0 780 270"');
    expect((G_TREND.match(/<rect /g) || []).length).toBe(12);   // six months × revenue + expenses
  });

  it('catches a CHART COORDINATE moving by a tenth, or gaining a decimal place', () => {
    // hr.dashboard's rule. Nothing in relax() touches an attribute value, which is what makes a
    // rounding change catchable rather than a silent visual lie. Both directions are driven: the
    // golden mutated (a coordinate that moved) and the component's own output re-rounded — a defect
    // that keeps every VALUE and changes only its precision, which a `toFixed`-inside-`Number()` port
    // would sail past.
    const mine = renderToStaticMarkup(trend());
    expect(mine).toContain('y="73.2"');
    expect(sameDocument(mine.replace(/y="(\d+)\.(\d)"/g, 'y="$1.$20"'))).not.toBe(sameDocument(G_TREND));
    expect(sameDocument(G_TREND.replace('y="73.2"', 'y="73.3"'))).not.toBe(sameDocument(G_TREND));
    expect(sameDocument(G_TREND.replace('M111.7 196.9', 'M111.8 196.9'))).not.toBe(sameDocument(G_TREND));
    expect(sameDocument(G_TREND.replace('opacity=".10"', 'opacity="0.1"'))).not.toBe(sameDocument(G_TREND));
  });

  it('catches a MONTH\'s bar carrying another month\'s figure', () => {
    // Every bar looks alike; the `<title>` is the only place the month and the money are stated
    // together, and a wrong pairing is invisible on screen.
    const swapped = GROUP.monthly.map((m, i) => i === 0 ? { ...m, revenue: GROUP.monthly[1].revenue } : m);
    expect(sameDocument(renderToStaticMarkup(<OvTrend monthly={swapped} vendors={[]} />))).not.toBe(sameDocument(G_TREND));
  });

  it('catches the KPI strip disagreeing with the bars it sits above', () => {
    expect(sameDocument(G_TREND.replace('RM 312,875.55', 'RM 312,875.56'))).not.toBe(sameDocument(G_TREND));
    expect(sameDocument(G_TREND.replace('>24%<', '>25%<'))).not.toBe(sameDocument(G_TREND));
  });

  it('turns the Net card red on a loss and keeps Margin on its own colour rule', () => {
    const loss = renderToStaticMarkup(<OvTrend monthly={GROUP.monthly.map((m) => ({ ...m, revenue: 1, bills: 100 }))} vendors={[]} />);
    expect(loss).toContain('<div class="card red">');
    expect(loss).toContain('color:var(--red-soft)">-9900%');   // margin negative → red, not sky
  });
});

describe('the comparison still bites — #ov-charts', () => {
  it('the golden really holds nine donut segments and nine legend rows', () => {
    expect((G_CHARTS.match(/<path d="M/g) || []).length).toBe(9);
    expect((G_CHARTS.match(/min-width:78px/g) || []).length).toBe(9);
  });

  it('catches an expense account MERGED to the wrong total across companies', () => {
    // Purchases is 601,330.10 + 500,112.90. A merge that dropped one company's share understates the
    // biggest slice of the pie and nothing else on screen changes.
    expect(sameDocument(G_CHARTS.replace('RM 1,101,443.00', 'RM 601,330.10'))).not.toBe(sameDocument(G_CHARTS));
    const dropped: PnlReport = { ...PNL, companies: [PNL.companies[0], { ...PNL.companies[1], expenses: [] }] };
    expect(sameDocument(renderToStaticMarkup(charts({ report: dropped })))).not.toBe(sameDocument(G_CHARTS));
  });

  it('catches the top-8 + Other fold dropping money', () => {
    // app.html:2308. Nine accounts merge to nine names here, so `Other` is exactly the ninth. A fold
    // that sliced instead of summing would silently lose the tail.
    expect(G_CHARTS).toContain('Other: RM 1,739.00');
    const many: PnlReport = {
      ...PNL,
      companies: [{ tenant_id: 'a', tenant_name: 'A', revenue_total: 100, expense_total: 100, net_profit: 0,
        expenses: Array.from({ length: 12 }, (_, i) => ({ name: 'E' + i, amount: 12 - i })) }],
    };
    const html = renderToStaticMarkup(charts({ report: many }));
    expect((html.match(/min-width:78px/g) || []).length).toBe(9);   // 8 + Other
    expect(html).toContain('Other: RM 10.00');                      // 4 + 3 + 2 + 1, not 4
  });

  it('catches the LEGEND percentage drifting from the amount beside it', () => {
    expect(sameDocument(G_CHARTS.replace('>55.7%<', '>55.8%<'))).not.toBe(sameDocument(G_CHARTS));
  });

  it('catches a segment COLOUR moving off the palette order', () => {
    // The donut and the legend are matched by colour alone; a shifted palette re-labels every slice.
    expect(OV_PALETTE.slice(0, 3)).toEqual(['#e85d3c', '#f5a623', '#3ddc97']);
    expect(sameDocument(G_CHARTS.replace('fill="#f5a623"', 'fill="#3ddc97"'))).not.toBe(sameDocument(G_CHARTS));
  });

  it('catches the Net bar turning blue on a loss — app.html:2340', () => {
    const loss: PnlReport = { ...PNL, companies: PNL.companies.map((c) => ({ ...c, net_profit: -1, revenue_total: 1, expense_total: 2 })) };
    const html = renderToStaticMarkup(charts({ report: loss }));
    expect(html).toContain('<rect x="246.2" y="100.0" width="62.3" height="66.0" rx="5" fill="#ef4444">');
    // `#5b9bd5` is also OV_PALETTE[3], so the check is on the Net rect, not on the colour appearing.
    expect(html).not.toContain('rx="5" fill="#5b9bd5"');
  });

  it('catches the margin and expense-ratio tiles disagreeing with the bars', () => {
    expect(sameDocument(G_CHARTS.replace('>13.6%<', '>13.7%<'))).not.toBe(sameDocument(G_CHARTS));
    expect(sameDocument(G_CHARTS.replace('>86.4%<', '>86.5%<'))).not.toBe(sameDocument(G_CHARTS));
  });

  it('catches the per-company bars sorted the wrong way round', () => {
    // app.html:2327 sorts net profit DESC, so the loss-making company is last and its bar is the short
    // one. Reversing it reads as "I PROCARE is the group's best performer".
    const rev = sameDocument(G_CHARTS
      .replace('SKINDAE SDN BHD', '@@1').replace('I PROCARE MALAYSIA SDN BHD', 'SKINDAE SDN BHD').replace('@@1', 'I PROCARE MALAYSIA SDN BHD'));
    expect(rev).not.toBe(sameDocument(G_CHARTS));
  });

  it('formats the compact axis label exactly as cfoMk() does', () => {
    expect(cfoMk(0)).toBe('RM0');
    expect(cfoMk(999)).toBe('RM999');
    expect(cfoMk(72000)).toBe('RM72k');
    expect(cfoMk(1.5e6)).toBe('RM1.5M');
    expect(cfoMk(1.5e7)).toBe('RM15M');
    expect(cfoMk(-72000)).toBe('-RM72k');
  });

  it('shortens a vendor name exactly as cfoShortName() does', () => {
    expect(cfoShortName('SHOPEE MOBILE MALAYSIA SDN BHD')).toBe('SHOPEE MOBILE MALAYSIA');
    expect(cfoShortName('CTG4U HOLDINGS')).toBe('HOLDINGS');
    expect(cfoShortName(null)).toBe('');
  });
});
