// HR OS · Dashboard — the React screen against the legacy screen's FIVE committed goldens.
//
// `tests/golden/hr.dashboard.{overview,headcount,payroll,attendance,cost}.html` were captured from
// `hrDashboard()` (hros.html:1726) by the 40-surface harness, one per `HR_DASH.page`; nothing here
// regenerates or edits them, and nothing here touches tests/render_surfaces.ts or tests/parity.ts. The
// component is rendered with `renderToStaticMarkup` from the SAME fixture the goldens were captured
// from — tests/render_fixtures.ts, imported directly — normalised by the harness's own normalise(),
// relaxed by the documented layer in ./parity.ts, and compared. Five assertions, one per sub-view.
//
// No seventh relaxation. The six the pilot argued cover this screen as it stands — including the two
// hand-rolled SVG builders, whose `d="M42.0 15.5 …"` path strings and `width:97.31958762886599%` bar
// percentages are compared verbatim, because nothing in relax() touches an attribute VALUE.
//
// NO TIMEZONE PINNING, deliberately, and no clock read at all: this screen shows a period label that
// comes from the response (`data.period.label`), and its only date-derived fallback is
// `HR_MONTHS[month] + ' ' + year` from props the route hands it. There is no `toLocale*` call and no
// `new Date()` anywhere in src/hr-dashboard.tsx, so there is nothing for a zone to shift.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrDashboard, {
  type DashData, type DashEmployee, type DashPage, type HrDashboardProps,
} from '../src/hr-dashboard';
import { goldenSection, relax } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `hrCompanyName()` (hros.html:4445) resolves the chip in the page head to the selected company. */
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

const DATA = (FIXTURES.hr_dashboard as { data: DashData }).data;

/** `HR.data.employees` — what `hrDashEmpTable()` reads, and the only input not in `hr_dashboard`. */
const EMPLOYEES = (FIXTURES.hr_bootstrap as { employees: DashEmployee[] }).employees;

/**
 * `tests/render_surfaces.ts:72` sets `HR_DASH.month=8; HR_DASH.year=2026` before capturing each of the
 * five. Both are only read by the period-label FALLBACK — the fixture supplies `period.label`, so the
 * goldens show "August 2026" from the response. Passed anyway, at the captured values, so this side has
 * the same inputs; `catches a period label that fell back to the wrong month` below reaches the branch.
 */
const PERIOD = { month: 8, year: 2026 };

/**
 * The `#hr` element is what `hrRender()` writes the page head and the screen body into (hros.html:1538).
 * The goldens' other section, `#hr_nav`, is `hrSidebar()` — chrome for all 18 HR views, which
 * report.md §3.5 puts outside a screen-by-screen strangler.
 */
const GOLDEN: Record<DashPage, string> = {
  overview: goldenSection('hr.dashboard.overview', 'hr'),
  headcount: goldenSection('hr.dashboard.headcount', 'hr'),
  payroll: goldenSection('hr.dashboard.payroll', 'hr'),
  attendance: goldenSection('hr.dashboard.attendance', 'hr'),
  cost: goldenSection('hr.dashboard.cost', 'hr'),
};

const PAGES = Object.keys(GOLDEN) as DashPage[];

const noop = () => {};

function screen(page: DashPage, over: Partial<HrDashboardProps> = {}) {
  return (
    <HrDashboard
      data={DATA}
      loading={false}
      page={page}
      employees={EMPLOYEES}
      companyName={COMPANY_NAME}
      {...PERIOD}
      onSetPage={noop}
      onStep={noop}
      onRefresh={noop}
      onExportCsv={noop}
      onPrint={noop}
      {...over}
    />
  );
}

const rendered = (page: DashPage, over: Partial<HrDashboardProps> = {}) =>
  relax(renderToStaticMarkup(screen(page, over)));

describe('HR Dashboard — React vs the legacy goldens', () => {
  it.each(PAGES)('renders the same document as hrDashboard() does on %s', (page) => {
    expect(rendered(page)).toBe(relax(GOLDEN[page]));
  });

  it.each(PAGES)('wires the same handlers, to the same rows, in the same order on %s', (page) => {
    assertHandlerParity(page);
  });
});

/**
 * Every quoted string literal AND every bare number in a golden handler body, in order.
 *
 * `goldenHandlers().args` in ./tests/handlers.ts collects QUOTED literals only, because on the first
 * screens a row is a quoted id (`'u9'`, `'out'`). This screen's period walk is
 * `onclick="hrDashStep(-1)"` / `hrDashStep(1)` — bare integers — so quoted-only extraction returns `[]`
 * for BOTH arrows and the check would pass with ‹ and › wired the same way round, which is a month of
 * analytics pointing at the wrong month. Bare numbers are added here, in this screen's own file, exactly
 * as `hr.approvals` and `hr.yearend` did; that is a strict superset of `goldenHandlers().args`, so it can
 * only tighten the check. CLAUDE.md notes this is the third screen to need it — the shared default is
 * now the minority, and folding it back into handlers.ts is the next single change to make there.
 *
 * `-1` matters as much as the digits: the sign is the direction of travel.
 */
function identArgs(raw: string): string[] {
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/**
 * What makes relaxation R1 safe on THIS screen. R1 drops `on*=` from the string comparison, so the
 * golden's `onclick="hrDashSetPage('cost')"` would otherwise compare equal to a tab wired to
 * `'headcount'`, and `hrDashStep(-1)` to `hrDashStep(1)`. This puts the arguments back: same handler
 * kinds, same document order, same identifying arguments.
 *
 * Inline rather than in ./tests/handlers.ts because that file is shared with sibling migrations in
 * flight and the brief puts it off limits; it exports exactly the two halves this needs.
 */
function assertHandlerParity(page: DashPage, over: Partial<HrDashboardProps> = {}) {
  const want = goldenHandlers(GOLDEN[page]).map((h) => ({ attr: h.attr, args: identArgs(h.raw) }));
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args
        .filter((a) => (typeof a === 'string' && a !== STUB_VALUE) || typeof a === 'number')
        .map(String),
    });

  const got = reactHandlers(screen(page, {
    onSetPage: record('setPage') as never,
    onStep: record('step') as never,
    onRefresh: record('refresh') as never,
    // The CSV is a download side effect with no markup — a golden cannot hold it, so this assertion is
    // the only cover it has. It must fire, exactly once, from the third button of the right-hand group.
    onExportCsv: record('exportCsv') as never,
    onPrint: record('print') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());
  expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));

  // The export is the one handler with no golden markup of its own — name it explicitly rather than
  // trusting it to be covered by the positional comparison above.
  expect(calls.filter((c) => c.attr === 'exportCsv')).toHaveLength(1);

  // Guard the guard: if a golden ever stops carrying handlers, the two `toEqual`s above pass vacuously
  // and R1 becomes the blind strip it is not allowed to be.
  expect(want.length).toBeGreaterThan(0);
  expect(want.some((h) => h.args.length > 0)).toBe(true);
}

describe('the comparison still bites', () => {
  // Relaxations are only defensible if they cannot absorb a real change. These render the screen wrong
  // on purpose and require the comparison to notice each one. They are this screen's REAL risks — the
  // two hand-rolled chart builders that compute coordinates from data, the delta arrows whose direction
  // and colour are derived, and the two arrows that walk the period — not a generic checklist.
  const want = (page: DashPage) => relax(GOLDEN[page]);

  it('catches a rounded SVG coordinate — toFixed(1) becoming toFixed(0)', () => {
    // The defect this screen exists to be afraid of: the line chart still draws, still has six points,
    // still has the right colours, and every y is off by up to half a unit. Simulated by nudging one
    // trend point by an amount too small to change any card, but large enough to move a path vertex.
    const trend = DATA.payroll.trend.map((r, i) => (i === 2 ? { ...r, gross: (r.gross as number) + 40 } : r));
    const data = { ...DATA, payroll: { ...DATA.payroll, trend } };
    expect(rendered('overview', { data })).not.toBe(want('overview'));
    // …and the numbers a human reads are untouched, which is what makes it silent without this test.
    expect(rendered('overview', { data })).toContain('RM 16,050.00');
  });

  it('catches a bar percentage that lost its precision', () => {
    // `width:97.31958762886599%` in hr.dashboard.attendance.html is Sales/Operations to 14 places. A
    // "tidy-up" to a rounded width is invisible to every card on the page and visible here.
    const by_dept = DATA.attendance.by_dept.map((x, i) => (i === 1 ? { ...x, value: 94.0 } : x));
    expect(rendered('attendance', { data: { ...DATA, attendance: { ...DATA.attendance, by_dept } } }))
      .not.toBe(want('attendance'));
  });

  it('catches a delta arrow that flipped direction', () => {
    // `hrTrendDelta` reads the LAST TWO points. Swapping them turns every ▼ into ▲ and recolours it,
    // while leaving the line chart's own point set identical — so only the card text moves.
    const t = DATA.cost.trend.slice();
    [t[t.length - 1], t[t.length - 2]] = [t[t.length - 2], t[t.length - 1]];
    expect(rendered('cost', { data: { ...DATA, cost: { ...DATA.cost, trend: t } } })).not.toBe(want('cost'));
  });

  it('catches a delta whose goodUp sense was inverted — colour only, same number', () => {
    // Attendance is `goodUp:true` and cost is `goodUp:false`; getting that backwards prints a fall in
    // attendance in green. Same ▼, same 1.1%, different colour, and nothing else on the page changes.
    const html = rendered('attendance');
    expect(html).toContain('color:var(--coral-soft)');
    expect(html).not.toContain('▼ 1.1%</span><span');
  });

  it('catches a dropped row in the employee master', () => {
    expect(rendered('headcount', { employees: EMPLOYEES.slice(0, 3) })).not.toBe(want('headcount'));
  });

  it('catches a changed number — the monthly gross', () => {
    const data = { ...DATA, overview: { ...DATA.overview, gross: 16051 } };
    expect(rendered('overview', { data })).not.toBe(want('overview'));
  });

  it('catches a dropped insight, and the count in its panel title', () => {
    const data = { ...DATA, insights: DATA.insights.slice(0, 1) };
    expect(rendered('overview', { data })).not.toBe(want('overview'));
    expect(rendered('overview', { data })).toContain('💡 Insights (1)');
  });

  it('catches a sub-view rendering the wrong page', () => {
    // Five goldens, five bodies: proof that the switch is real and not five copies of one body.
    PAGES.forEach((a) => PAGES.forEach((b) => {
      if (a !== b) expect(rendered(a)).not.toBe(want(b));
    }));
  });

  it('catches the loading spinner standing in for a loaded screen', () => {
    expect(rendered('overview', { loading: true })).not.toBe(want('overview'));
  });

  it('catches a period label that fell back to the wrong month', () => {
    const data = { ...DATA, period: null };
    expect(rendered('overview', { data, month: 7 })).not.toBe(want('overview'));
    expect(rendered('overview', { data, month: 8, year: 2026 })).toBe(want('overview'));
  });

  it('catches a mis-wired handler — the two period arrows swapped', () => {
    // The mis-wiring R1 cannot see and this screen would suffer from: ‹ and › both still render "‹"
    // and "›", the markup is byte-identical, and every load walks the wrong way through the calendar.
    const calls: number[] = [];
    const got = reactHandlers(screen('overview', { onStep: ((d: number) => calls.push(d)) as never }));
    got.forEach((h) => h.invoke());
    expect(calls).toEqual([-1, 1]);
    // …and the golden agrees, via identArgs — which is exactly what quoted-only extraction would miss.
    expect(goldenHandlers(GOLDEN.overview).slice(0, 2).map((h) => identArgs(h.raw))).toEqual([['-1'], ['1']]);
  });

  it('catches a tab wired to the wrong sub-view', () => {
    const calls: string[] = [];
    const got = reactHandlers(screen('overview', { onSetPage: ((p: string) => calls.push(p)) as never }));
    got.forEach((h) => h.invoke());
    expect(calls).toEqual(['overview', 'headcount', 'payroll', 'attendance', 'cost']);
  });
});
