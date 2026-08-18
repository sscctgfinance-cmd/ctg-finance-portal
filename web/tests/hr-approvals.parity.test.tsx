// HR OS · Approvals — the React screen against the legacy screen's committed golden.
//
// `tests/golden/hr.approvals.html` was captured from `hrApprovalsRender()` (hros.html:3558) by the
// 40-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts or tests/parity.ts. The component is rendered with `renderToStaticMarkup`
// from the SAME fixture the golden was captured from — tests/render_fixtures.ts, imported directly —
// normalised by the harness's own normalise(), relaxed by the documented layer in ./parity.ts, compared.
//
// No seventh relaxation. The six the pilot argued cover this screen as it stands.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrApprovals, { type ApvEmployee, type ApvStep } from '../src/hr-approvals';
import { goldenSection, relax } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `hrCompanyName()` (hros.html:4445) resolves the chip in the page head to the selected company. */
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

/**
 * The `#hr` element is what `hrRender()` writes the page head and the screen body into (hros.html:1538).
 * `#hr_nav` — the other section in this golden — is `hrSidebar()`, chrome for all 18 HR views, which
 * report.md §3.5 puts outside a screen-by-screen strangler.
 */
const GOLDEN = goldenSection('hr.approvals', 'hr');

const ADMIN = FIXTURES.hr_leave_admin as { flow: ApvStep[]; employees: ApvEmployee[] };

/** `APV`'s state at first paint — hros.html:3535. The golden is that state: the leave tab. */
const FLOW = ADMIN.flow.map((s) => ({
  name: s.name, approver_type: s.approver_type, approver_role: s.approver_role, approver_employee_id: s.approver_employee_id,
}));

const noop = () => {};

function screen(over: Partial<Parameters<typeof HrApprovals>[0]> = {}) {
  return (
    <HrApprovals
      flow={FLOW}
      employees={ADMIN.employees}
      companyName={COMPANY_NAME}
      tab="leave"
      onTab={noop}
      onLevelSet={noop}
      onLevelDel={noop}
      onLevelAdd={noop}
      onSave={noop}
      {...over}
    />
  );
}

const render = (over: Partial<Parameters<typeof HrApprovals>[0]> = {}) => relax(renderToStaticMarkup(screen(over)));

describe('HR Approvals — React vs the legacy golden', () => {
  it('renders the same document as hrApprovalsRender() does', () => {
    expect(render()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * What makes relaxation R1 safe on THIS screen. R1 drops `on*=` from the string comparison, so the
 * golden's `onclick="hrApvLeaveDel(0)"` would otherwise compare equal to a link wired to level 1 —
 * which is the difference between removing the manager and removing HR from every future request.
 *
 * ── The one thing this screen needed that the pilot's version of this check did not ────────────────
 * `goldenHandlers()` collects QUOTED literals, because on hr.access and hr.clock the thing that
 * identifies a row is a quoted id (`'u9'`, `'out'`). Here the identifying argument is a bare integer:
 * `hrApvLeaveSet(0,this.value)`. Quoted-only extraction returns `[]` for every row handler on this
 * screen, so the two `toEqual`s below would pass with every row wired to level 0 — exactly the defect
 * they exist to catch, and it would be silent.
 *
 * So the golden side is read here with `identArgs()`, which takes quoted literals AND bare integers in
 * source order. That is strictly MORE than `goldenHandlers().args` and a superset of it, so it cannot
 * weaken the check; `handlers.ts` is untouched (it is shared with two siblings in flight). The React
 * side records numbers as well as strings to match. `catches a mis-wired row index` below fails without
 * this, which is the proof that the widening is doing work rather than decorating.
 */
function identArgs(raw: string): string[] {
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|\b(\d+)\b/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

function assertHandlerParity(over: Partial<Parameters<typeof HrApprovals>[0]> = {}) {
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
    onTab: record('tab') as never,
    onLevelSet: record('levelSet') as never,
    onLevelDel: record('levelDel') as never,
    onLevelAdd: record('levelAdd') as never,
    onSave: record('save') as never,
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
  // on purpose and require the comparison to notice each one.
  const want = relax(GOLDEN);

  it('catches a dropped level', () => {
    expect(render({ flow: FLOW.slice(0, 1) })).not.toBe(want);
  });

  it('catches a renamed label — the chain summary is derived from the flow', () => {
    expect(render({ flow: FLOW.map((s) => ({ ...s, name: s.name + '!' })) })).not.toBe(want);
  });

  it('catches a dropped employee option', () => {
    expect(render({ employees: ADMIN.employees.slice(0, 2) })).not.toBe(want);
  });

  it('catches a moved `selected`, which R5 must not absorb', () => {
    // The golden's selects mark NOTHING: step 0 is `manager` and step 1 is `role:hr_admin`, and neither
    // is an option this select offers. Point a step at an option that IS offered and React marks it.
    expect(render({ flow: FLOW.map((s) => ({ ...s, approver_type: 'role', approver_role: 'hr' })) })).not.toBe(want);
  });

  it('catches a changed value in the page-head chrome', () => {
    expect(render({ companyName: 'SKINDAE SDN BHD' })).not.toBe(want);
  });

  it('catches a mis-wired row index — the check `goldenHandlers` alone would miss', () => {
    // The whole reason identArgs() exists. Every level's remove link wired to level 0.
    const tree = screen({ onLevelDel: ((_i: number) => {}) as never });
    expect(() => {
      const want2 = goldenHandlers(GOLDEN);
      const calls: string[][] = [];
      const record = (...args: unknown[]) =>
        calls.push(args.filter((a) => typeof a === 'number' || (typeof a === 'string' && a !== STUB_VALUE)).map(String));
      const got = reactHandlers(screen({
        onTab: record as never, onLevelSet: record as never,
        onLevelDel: (() => record(0)) as never,   // ← mis-wired: always level 0
        onLevelAdd: record as never, onSave: record as never,
      }));
      got.forEach((h) => h.invoke());
      expect(calls).toEqual(want2.map((h) => identArgs(h.raw)));
    }).toThrow();
    expect(tree).toBeTruthy();
  });
});
