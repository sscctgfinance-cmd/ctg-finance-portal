// HR OS · Year-end — the React screen against the legacy screen's committed golden.
//
// `tests/golden/hr.yearend.html` was captured from `hrYearend()` (hros.html:4920) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts or
// tests/parity.ts. The component is rendered with `renderToStaticMarkup` from the SAME fixture the
// golden was captured from — tests/render_fixtures.ts, imported directly — normalised by the harness's
// own normalise(), relaxed by the documented layer in ./parity.ts, and compared.
//
// No seventh relaxation. The six the pilot argued cover this screen as it stands.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrYearend, { defaultTaxYear, taxYears, type YeEmployee, type YeTotals } from '../src/hr-yearend';
import { goldenSection, relax } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `hrCompanyName()` (hros.html:4445) resolves the chip in the page head to the selected company. */
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

/**
 * The `#hr` element is what `hrRender()` writes the page head and the screen body into (hros.html:1538).
 * `#hr_nav` — the other section in this golden — is `hrSidebar()`, chrome for all 18 HR views, which
 * report.md §3.5 puts outside a screen-by-screen strangler.
 */
const GOLDEN = goldenSection('hr.yearend', 'hr');

/**
 * THE CLOCK, PINNED — the one thing this screen needed that the previous four did not.
 *
 * `hrYearend()` reads `new Date().getFullYear()` twice (hros.html:4921-4922): once for the Y/A default
 * and once for the five-year dropdown. The golden therefore hard-codes 2026…2022 with 2025 selected,
 * and a component that read the clock itself would start failing on 1 Jan.
 *
 * So the component does NOT read the clock — `taxYears()` and `defaultTaxYear()` are pure functions of a
 * Date they are handed — and this is the instant the golden was captured at (tests/render_harness.ts:19,
 * `FIXED_MS`). It is copied rather than imported because render_harness.ts is the Deno harness and Node
 * cannot load it, which is the same reason tests/parity.ts lifts normalise() out by text.
 *
 * This is not a relaxation: it changes the INPUT the React side is built from, not what counts as a
 * match, and the derivation itself stays under test — `catches a changed tax year` below moves it. The
 * instant is 09:30 UTC, so `getFullYear()` reads 2026 in every zone on earth; no zone override needed.
 */
const NOW = new Date('2026-08-18T09:30:00.000Z');

const ANNUAL = (FIXTURES.hr_annual as { annual: Record<string, YeTotals> }).annual;
const EMPLOYER = (FIXTURES.hr_annual as { employer: { employer_no: string } }).employer;
const EMPLOYEES = (FIXTURES.hr_bootstrap as { employees: YeEmployee[] }).employees;

const noop = () => {};

function screen(over: Partial<Parameters<typeof HrYearend>[0]> = {}) {
  return (
    <HrYearend
      year={defaultTaxYear(NOW)}
      years={taxYears(NOW)}
      employees={EMPLOYEES}
      annual={ANNUAL}
      employerNo={EMPLOYER.employer_no}
      companyName={COMPANY_NAME}
      onPick={noop}
      onExpEA={noop}
      onExpFormE={noop}
      onExpCp8d={noop}
      {...over}
    />
  );
}

const render = (over: Partial<Parameters<typeof HrYearend>[0]> = {}) => relax(renderToStaticMarkup(screen(over)));

describe('HR Year-end — React vs the legacy golden', () => {
  it('renders the same document as hrYearend() does', () => {
    expect(render()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });

  it('derives the Y/A dropdown and default the way the legacy renderer does', () => {
    expect(taxYears(NOW)).toEqual([2026, 2025, 2024, 2023, 2022]);
    expect(defaultTaxYear(NOW)).toBe(2025);
  });
});

/**
 * What makes relaxation R1 safe on THIS screen. R1 drops `on*=` from the string comparison, so the
 * golden's `onclick="hrExpEA('e2')"` would otherwise compare equal to a row button wired to `'e1'` —
 * and the visible result of that is Ahmad's income and PCB printed on Siti's Borang EA, filed with
 * LHDN, under her name. This puts the argument back.
 *
 * ── Widened the way hr-approvals widened it, and for the same reason ───────────────────────────────
 * `goldenHandlers()` collects QUOTED literals. This screen's bulk export is `hrExpEA(0)` — a BARE
 * INTEGER, and `0` is the sentinel that means "every paid employee" rather than one. Quoted-only
 * extraction returns `[]` for it, so `hrExpEA(1)` would compare equal: the bulk button would stop
 * producing the whole batch and start looking up an employee whose id is the number 1, which does not
 * exist, and the only symptom is a toast. `identArgs()` takes quoted literals AND bare integers, which
 * is a strict superset of `goldenHandlers().args` and so can only tighten the check. It lives here, in
 * this screen's own file, because tests/handlers.ts is shared and off limits (CLAUDE.md).
 * `catches a mis-wired bulk export` below fails without it.
 */
function identArgs(raw: string): string[] {
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|\b(\d+)\b/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

function assertHandlerParity(over: Partial<Parameters<typeof HrYearend>[0]> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args
        .filter((a) => (typeof a === 'string' && a !== STUB_VALUE) || typeof a === 'number')
        .map(String),
    });

  const got = reactHandlers(screen({
    onPick: record('pick') as never,
    onExpEA: record('expEA') as never,
    onExpFormE: record('expFormE') as never,
    onExpCp8d: record('expCp8d') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());
  expect(calls.map((c) => c.args)).toEqual(want.map((h) => identArgs(h.raw)));

  // Guard the guard: if the golden ever stops carrying handlers, the two `toEqual`s above pass
  // vacuously and R1 becomes the blind strip it is not allowed to be.
  expect(want.length).toBeGreaterThan(0);
  expect(want.some((h) => identArgs(h.raw).length > 0)).toBe(true);
}

describe('the comparison still bites', () => {
  // Relaxations are only defensible if they cannot absorb a real change. These render the screen wrong
  // on purpose, from the defects that would actually hurt on a year-end filing screen, and require the
  // comparison to notice each one.
  const want = relax(GOLDEN);

  it('catches a dropped employee — one who is owed an EA form and would never get one', () => {
    expect(render({ employees: EMPLOYEES.filter((e) => e.id !== 'e2') })).not.toBe(want);
  });

  it('catches SOCSO losing LINDUNG 24 — the v196 rule this column exists to carry', () => {
    // e2 is the only employee with a LINDUNG contribution: 219.00 + 120.00 = the golden's RM 339.00.
    // Rendering `socsoEe` alone under-reports SOCSO on the EA form and on the CP8D line beside it.
    const noLindung = Object.fromEntries(Object.entries(ANNUAL).map(([k, t]) => [k, { ...t, lindung: 0 }]));
    expect(render({ annual: noLindung })).not.toBe(want);
  });

  it('catches an unpaid employee leaking into the list — months>0, not merely having a row', () => {
    // e3 has no finalised payslip in 2025. Giving him a zero-month row must change nothing: he appears
    // on no EA form and is not counted in "Employees paid in 2025".
    const withZero = { ...ANNUAL, e3: { months: 0, gross: 0, epfEe: 0, socsoEe: 0, lindung: 0, pcb: 0 } };
    expect(render({ annual: withZero })).toBe(want);
    // …and the same row with a month on it must diff, so the assertion above is a filter working and
    // not the row being dropped for some other reason.
    const withOne = { ...ANNUAL, e3: { months: 1, gross: 1200, epfEe: 132, socsoEe: 6, lindung: 0, pcb: 0 } };
    expect(render({ annual: withOne })).not.toBe(want);
  });

  it('catches a changed tax year — the heading, the card label and the selected option all move', () => {
    expect(render({ year: 2024 })).not.toBe(want);
  });

  it('catches a shifted Y/A dropdown, which only holds because the clock is pinned', () => {
    expect(render({ years: taxYears(new Date('2027-08-18T09:30:00.000Z')) })).not.toBe(want);
  });

  it('catches "Subject to MTD" counting the wrong employees', () => {
    // The golden says 2 of 3: Siti's PCB is zero. An employee wrongly counted as subject to MTD is one
    // LHDN expects a monthly deduction from.
    const allPcb = Object.fromEntries(Object.entries(ANNUAL).map(([k, t]) => [k, { ...t, pcb: t.pcb || 1 }]));
    expect(render({ annual: allPcb })).not.toBe(want);
  });

  it('catches a changed number — the gross that totals onto Form E', () => {
    expect(render({ annual: { ...ANNUAL, e1: { ...ANNUAL.e1, gross: 67300 } } })).not.toBe(want);
  });

  it('catches the missing-E-number banner appearing, a branch the golden does not hold', () => {
    // The fixture's employer has an E-number, so the golden has no banner. Without one every EA / Form E
    // / CP8D prints a placeholder and is rejected at filing — the banner must be real markup, not a
    // comment in the legacy source.
    expect(render({ employerNo: '' })).not.toBe(want);
  });

  it('catches a changed value in the page-head chrome', () => {
    expect(render({ companyName: 'SKINDAE SDN BHD' })).not.toBe(want);
  });

  const WANT_ARGS = goldenHandlers(GOLDEN).map((h) => identArgs(h.raw));

  /** What the React tree actually calls, with `onExpEA`'s argument bent by `bend`. */
  function calledWith(bend: (id: string | 0) => string | 0 | 1): string[][] {
    const calls: string[][] = [];
    const record = (...args: unknown[]) =>
      calls.push(args.filter((a) => typeof a === 'number' || (typeof a === 'string' && a !== STUB_VALUE)).map(String));
    const got = reactHandlers(screen({
      onPick: record as never,
      onExpEA: ((id: string | 0) => record(bend(id))) as never,
      onExpFormE: record as never,
      onExpCp8d: record as never,
    }));
    got.forEach((h) => h.invoke());
    return calls;
  }

  it('catches a mis-wired row export — every EA PDF button firing against the first employee', () => {
    // The defect R1 would otherwise hide, and the one that puts Ahmad's income and PCB on Siti's Borang
    // EA. It is invisible in the markup — all three buttons still read "EA PDF" and the string
    // comparison stays green. Only the handler check sees it.
    expect(calledWith((id) => (id === 0 ? 0 : 'e1'))).not.toEqual(WANT_ARGS);
    // …and the correctly-wired tree is what that is being measured against, so the assertion above is
    // the mis-wire failing and not the harness failing.
    expect(calledWith((id) => id)).toEqual(WANT_ARGS);
  });

  it('catches a mis-wired bulk export — the case quoted-only extraction reads as a match', () => {
    // `hrExpEA(0)` becoming `hrExpEA(1)`: the bulk button stops producing the whole batch and starts
    // looking up an employee whose id is the number 1, which does not exist. The only symptom is a toast.
    expect(calledWith((id) => (id === 0 ? 1 : id))).not.toEqual(WANT_ARGS);
    // The proof that identArgs() is load-bearing rather than decoration: `goldenHandlers().args`
    // collects QUOTED literals only, so the golden's sentinel reads as no arguments at all and there
    // would be nothing on the golden side to compare the React side's `0` against.
    expect(goldenHandlers(GOLDEN).find((h) => h.raw === 'hrExpEA(0)')!.args).toEqual([]);
    expect(identArgs('hrExpEA(0)')).toEqual(['0']);
  });
});
