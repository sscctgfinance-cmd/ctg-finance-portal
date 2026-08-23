// HR OS · Leave, EMPLOYEE MODE — the React screen against the legacy screen's committed golden.
//
// `tests/golden/hr.leave.emp.html` is the 41st surface, added with this port. It had to be added:
// hros.html:1553 dispatches ONE nav id to two screens (`HR_EMP_MODE?hrEmpLeave():hrLeave()`), the
// harness only ever captured the admin one, and so `hr.leave` stayed green for the whole time the
// employee branch did not exist in React at all. A mode no golden reaches is a mode nothing protects.
//
// Same shape as web/tests/hr-leave.parity.test.tsx: render the pure component with the SAME fixture the
// golden was captured from, normalise with the harness's own normalise(), relax with the documented
// layer in ./parity.ts, compare. No seventh relaxation, and neither ./parity.ts nor ./handlers.ts is
// touched.
//
// NO TIMEZONE PINNING, for the same reason: the one formatted timestamp goes through `hrDT()`
// (hros.html:1246), fixed +8h then `getUTC*`, never `toLocale*`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrEmpLeave, { applyBody, type LeaveBalance, type PendingRequest } from '../src/hr-emp-leave';
import type { LeaveRequest, LeaveType } from '../src/hr-leave';
import { HR_EMP_NAV, hrNavFor, hrRole } from '../src/nav';
import { REPO, goldenSection, relax } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

/** `#hr` — what `hrRender()` writes the page head and the screen body into (hros.html:1560). */
const GOLDEN = goldenSection('hr.leave.emp', 'hr');

const MY = FIXTURES.hr_leave_my as {
  types: LeaveType[]; balances: LeaveBalance[]; requests: LeaveRequest[]; year: number;
};
const PENDING = (FIXTURES.hr_leave_pending as { requests: PendingRequest[] }).requests;

/** `todayLocalISO()` under tests/render_harness.ts's pinned clock (FIXED_MS = 2026-08-18T09:30Z, MYT). */
const TODAY = '2026-08-18';

const noop = () => {};

function screen(over: Partial<Parameters<typeof HrEmpLeave>[0]> = {}) {
  return (
    <HrEmpLeave
      companyName={COMPANY_NAME}
      types={MY.types}
      balances={MY.balances}
      requests={MY.requests}
      pending={PENDING}
      today={TODAY}
      onApply={noop}
      onCancel={noop}
      onDecide={noop}
      {...over}
    />
  );
}

const render = (over: Partial<Parameters<typeof HrEmpLeave>[0]> = {}) => relax(renderToStaticMarkup(screen(over)));

describe('HR Leave (employee) — React vs the legacy golden', () => {
  it('renders the same document as hrEmpLeaveRender() does', () => {
    expect(render()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * The navigation's own claim. `nav.ts:67` says `leave` is migrated, and `href()` therefore points BOTH
 * the employee sidebar and the phone bottom tab at `/hr/leave/`. That flag was false for every employee
 * until this screen existed — the route loaded `hr_leave_admin`, which `hrCanView()` (lib.ts:131)
 * refuses an `employee`, and the 401 became the whole page.
 *
 * This is the assertion that ties the two together: if the employee branch is ever removed, the nav
 * entry it backs must go with it.
 */
describe('the navigation does not promise a screen that refuses', () => {
  it('routes employee-mode Leave into React, and this component is what is there', () => {
    const emp = hrRole('employee');
    expect(emp.empMode).toBe(true);
    const entry = hrNavFor(emp, true).find((e) => e.id === 'leave');
    expect(entry).toBeDefined();
    expect(entry!.migrated).toBe(true);
    // The bottom tab bar is the same list — HR_EMP_NAV (hros.html:1490), not a second one.
    expect(HR_EMP_NAV.find((e) => e.id === 'leave')!.short).toBe('Leave');
    // And the screen it lands on is this one, painted with the employee page head (hros.html:1491),
    // not the admin screen's ("People / Review and approve leave requests").
    expect(render()).toContain('Apply for leave and check your balance');
    expect(render()).not.toContain('Review and approve leave requests');
  });
});

/**
 * ── The guard the gap actually slipped through ────────────────────────────────────────────────────
 *
 * The parity test above proves the COMPONENT. F2 was not a broken component — it was a route with no
 * employee branch at all, and `tests/golden/hr.leave.html` (the admin screen) stayed green throughout.
 * A golden diff cannot see a screen that is never mounted, so the route is pinned by SOURCE, the same
 * way `finance.calendar`'s `dueLabel()` and the chrome's theme script are.
 *
 * Three properties, and the third is `finance.users`' finding: it is not enough that a gate EXISTS, the
 * load must sit on the far side of it. `hr_leave_admin` fired before the role was known would give an
 * employee the same 401 screen with the branch present.
 */
describe('the route mounts the employee screen, and loads nothing before it knows', () => {
  // COMMENTS BLANKED FIRST. The file's own header explains F2 and names `hr_leave_admin` while doing
  // so, and `tests/forwarding_page_test.ts` learned the same lesson the other way round: a scan of raw
  // source matches prose, so it passes on a page that does nothing and fails on one that works.
  const ROUTE = readFileSync(join(REPO, 'web/app/hr/leave/page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('imports and renders the employee screen', () => {
    expect(ROUTE).toContain("from '../../../src/hr-emp-leave'");
    expect(ROUTE).toContain('<HrEmpLeave');
  });

  it('decides by hrRole().empMode — nav.ts:150, not a second notion of employee mode', () => {
    expect(ROUTE).toMatch(/hrRole\([^)]*\)\.empMode/);
    expect(ROUTE).toContain('empMode ? <EmpLeavePage /> : <AdminLeavePage />');
    // And nowhere else: a second, hand-rolled notion of employee mode is what nav.ts:150 exists to stop.
    expect(ROUTE).not.toMatch(/HR_EMP_MODE|role\s*===\s*'employee'/);
  });

  it('asks the server for nothing but `me` before the gate', () => {
    // Everything up to the branch. `hr_leave_admin` in here is the F2 defect with the branch present:
    // an employee still eats the 401, because the refused call already went out.
    const before = ROUTE.slice(0, ROUTE.indexOf('function AdminLeavePage'));
    expect(before).toContain("api: 'me'");
    expect(before).not.toContain('hr_leave_admin');
    expect(before).not.toContain('hr_leave_my');
  });

  it('falls back to employee mode when `me` fails — the safe direction, and the legacy default', () => {
    // An admin who loses the call sees the personal screen; an employee never sees the admin one. The
    // admin screen is a table of everyone's leave plus the approval-chain editor, so this direction is
    // the one that cannot leak. Inverting it is a real defect, so the fallback is pinned.
    expect(ROUTE).toContain('.catch(() => setEmpMode(true))');
    // `hrRole()` is the rule for a role that IS known; an unrecognised one is employee mode already.
    expect(hrRole('approver').empMode).toBe(true);
    expect(hrRole('employee').empMode).toBe(true);
    expect(hrRole('admin').empMode).toBe(false);
    expect(hrRole('hr_admin').empMode).toBe(false);
    expect(hrRole('viewer').empMode).toBe(false);
    // NOTE, and it is why the route does not lean on hrRole() for the failure case: an EMPTY role is
    // not employee mode — `hrRole()` is `!!r && …` (nav.ts:150), so `hrRole('')` is all three flags
    // false and `hrNavFor()` hands it the ADMIN nav. nav.ts's own doc comment above that function says
    // the opposite. Mirrored, not "fixed": changing it moves the nav for every login with no role.
    expect(hrRole('').empMode).toBe(false);
  });

  it('reaches all three employee actions, and only the employee ones', () => {
    const emp = ROUTE.slice(ROUTE.indexOf('function EmpLeavePage'));
    // The two loads and the two decisions live in the route; `hr_leave_apply` is inside applyBody().
    for (const api of ['hr_leave_my', 'hr_leave_pending', 'hr_leave_cancel', 'hr_leave_decide']) {
      expect(emp).toContain(api);
    }
    expect(ok3()).toHaveProperty('api', 'hr_leave_apply');
    // And nothing the server would refuse an employee: all three want `hrCanView()` (hr.ts:1541).
    expect(emp).not.toContain('hr_leave_admin');
    expect(emp).not.toContain('hr_leave_flow_save');
    expect(emp).not.toContain('hr_leave_balance_save');
  });
});

/**
 * `hrEmpLeaveApply()`'s body — hros.html:3104. No golden sees a request body.
 */
const OK_APPLY = { leave_type_id: 'lt1', date_from: '2026-09-01', date_to: '2026-09-03', half_day: false, reason: 'Family' };

/** applyBody() returns a body OR a refusal; every caller below wants the body half. */
function body(over: Partial<typeof OK_APPLY> = {}): Record<string, unknown> {
  const r = applyBody({ ...OK_APPLY, ...over });
  if ('error' in r) throw new Error('expected a body, got: ' + r.error);
  return r as Record<string, unknown>;
}
const ok3 = () => body();

describe('the apply body', () => {
  const ok = OK_APPLY;

  it('posts what the legacy posts', () => {
    expect(body()).toEqual({
      api: 'hr_leave_apply', leave_type_id: 'lt1', date_from: '2026-09-01', date_to: '2026-09-03',
      half_day: false, reason: 'Family',
    });
  });

  it('names NO employee and NO tenant — hr_leave_apply resolves the employee from the token', () => {
    // hr.ts:1420. The proof is the negative: a key that is or contains an id would let one employee file
    // leave against another, and nothing on the screen would say so.
    // The exact key set IS the assertion — a widened body is exactly what this is guarding against, and
    // `leave_type_id` shows why a bare /_id$/ would be the wrong shape of check.
    const b = body();
    expect(Object.keys(b).sort()).toEqual(['api', 'date_from', 'date_to', 'half_day', 'leave_type_id', 'reason']);
    for (const k of Object.keys(b)) {
      expect(k).not.toMatch(/employee|emp_no|person|user|tenant/);
    }
  });

  it('refuses in the legacy order — hros.html:3105-3108', () => {
    // A range typed backwards with no type picked must complain about the TYPE first, which is the only
    // input that distinguishes the order from a set of independent checks.
    expect(applyBody({ ...ok, leave_type_id: '', date_to: '2026-08-01' })).toEqual({ error: 'Select a leave type' });
    expect(applyBody({ ...ok, date_from: '', date_to: '2026-08-01' })).toEqual({ error: 'Pick the dates' });
    expect(applyBody({ ...ok, date_to: '' })).toEqual({ error: 'Pick the dates' });
    expect(applyBody({ ...ok, date_to: '2026-08-31' })).toEqual({ error: 'End date can\u2019t be before start' });
    // The boundary, both sides: a single-day request is legal, one day earlier is not.
    expect(applyBody({ ...ok, date_to: ok.date_from })).not.toHaveProperty('error');
  });

  it('sends the half-day flag as typed — it halves the day count the balance is deducted by', () => {
    expect(body({ half_day: true }).half_day).toBe(true);
  });
});

/**
 * `identArgs()` — the established bare-integer widening, copied per CLAUDE.md rather than folded into
 * the shared `handlers.ts` mid-flight. This screen's row ids are quoted (`hrEmpLeaveCancel('lv3')`),
 * but `hrEmpLeaveDecide('lv1','approve')` is the quoted case too; the widening is kept because it is a
 * strict superset of `goldenHandlers().args` and so can only tighten the check.
 */
function identArgs(raw: string): string[] {
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|\b(\d+)\b/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

type Recorded = { attr: string; args: string[] };

function recordedHandlers(over: Partial<Parameters<typeof HrEmpLeave>[0]> = {}): Recorded[] {
  const calls: Recorded[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args.filter((a) => (typeof a === 'string' && a !== STUB_VALUE) || typeof a === 'number').map(String),
    });

  const got = reactHandlers(screen({
    onApply: record('apply') as never,
    onCancel: record('cancel') as never,
    onDecide: record('decide') as never,
    ...over,
  }));
  got.forEach((h) => h.invoke());
  return calls.map((c, i) => ({ attr: got[i] ? got[i].attr : '?', args: c.args }));
}

function assertHandlerParity(over: Partial<Parameters<typeof HrEmpLeave>[0]> = {}) {
  const want = goldenHandlers(GOLDEN);
  const got = reactHandlers(screen(over));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  expect(recordedHandlers(over).map((c) => c.args)).toEqual(want.map((h) => identArgs(h.raw)));

  // Guard the guard: a golden that stopped carrying handlers would make both `toEqual`s vacuous, and
  // R1 (which strips `on*=` from the string diff) would become the blind strip it is not allowed to be.
  expect(want.length).toBeGreaterThan(0);
  expect(want.filter((h) => identArgs(h.raw).length > 0).length).toBeGreaterThan(2);
}

describe('the comparison still bites', () => {
  const want = relax(GOLDEN);

  it('catches the whole approver queue disappearing — team leave approval, silently gone', () => {
    // The defect this port exists to prevent, one level down: a manager who is not HR approves their
    // team here and NOWHERE else. An empty `pending` renders no card at all, exactly as the legacy does.
    expect(render({ pending: [] })).not.toBe(want);
  });

  it('catches a dropped balance card', () => {
    expect(render({ balances: MY.balances.slice(0, 1) })).not.toBe(want);
  });

  it('catches an unpaid type reaching the balance cards', () => {
    // hros.html:3080's `.filter(b => b.paid)`. Dropping it puts a "0 left / 0" card on every screen.
    expect(render({ balances: MY.balances.map((b) => ({ ...b, paid: true })) })).not.toBe(want);
  });

  it('catches a changed remaining figure — the number an employee plans their year on', () => {
    expect(render({ balances: MY.balances.map((b) => ({ ...b, remaining: (b.remaining || 0) + 1 })) })).not.toBe(want);
  });

  it('catches a dropped leave type option — a type nobody could apply for', () => {
    expect(render({ types: MY.types.slice(0, 2) })).not.toBe(want);
  });

  it('catches the (unpaid) suffix going missing', () => {
    expect(render({ types: MY.types.map((t) => ({ ...t, paid: true })) })).not.toBe(want);
  });

  it('catches a moved default date — the first day of somebody’s leave', () => {
    expect(render({ today: '2026-08-17' })).not.toBe(want);
  });

  it('catches a request quietly becoming final — the row would lose its cancel link', () => {
    expect(render({ requests: MY.requests.map((r) => ({ ...r, status: 'Approved' })) })).not.toBe(want);
  });

  it('catches a cancel link appearing on a decided request', () => {
    expect(render({ requests: MY.requests.map((r) => ({ ...r, status: 'Pending' })) })).not.toBe(want);
  });

  it('catches a changed day count — the number the balance is deducted by', () => {
    expect(render({ requests: MY.requests.map((r) => ({ ...r, days: (r.days || 0) + 1 })) })).not.toBe(want);
  });

  it('catches a step pill losing who it is waiting on', () => {
    expect(render({ requests: MY.requests.map((r) => ({ ...r, steps: (r.steps || []).map((s) => ({ ...s, assignee_name: null })) })) })).not.toBe(want);
  });

  it('catches a shifted timestamp, which is why hrDT() may not use toLocale*', () => {
    const shifted = MY.requests.map((r) => ({
      ...r,
      steps: (r.steps || []).map((s) => (s.decided_at ? { ...s, decided_at: '2026-08-04T03:00:00.000Z' } : s)),
    }));
    expect(render({ requests: shifted })).not.toBe(want);
  });

  it('catches a changed value in the page-head chrome', () => {
    expect(render({ companyName: 'SKINDAE SDN BHD' })).not.toBe(want);
  });

  it('catches a mis-wired Approve button — R1 drops the attribute, so this is the only cover', () => {
    const want2 = goldenHandlers(GOLDEN).map((h) => identArgs(h.raw));
    expect(recordedHandlers().map((c) => c.args)).toEqual(want2);
    expect(miswired('decide').map((c) => c.args)).not.toEqual(want2);
  });

  it('catches a mis-wired cancel link — cancelling somebody else’s request', () => {
    const want2 = goldenHandlers(GOLDEN).map((h) => identArgs(h.raw));
    expect(miswired('cancel').map((c) => c.args)).not.toEqual(want2);
  });

  it('catches Approve and Reject being swapped', () => {
    const want2 = goldenHandlers(GOLDEN).map((h) => identArgs(h.raw));
    const calls: Recorded[] = [];
    const record = (attr: string) => (...args: unknown[]) =>
      calls.push({ attr, args: args.filter((a) => (typeof a === 'string' && a !== STUB_VALUE) || typeof a === 'number').map(String) });
    const decide = record('decide');
    const got = reactHandlers(screen({
      onApply: record('apply') as never,
      onCancel: record('cancel') as never,
      onDecide: ((id: string, d: string) => decide(id, d === 'approve' ? 'reject' : 'approve')) as never,
    }));
    got.forEach((h) => h.invoke());
    expect(calls.map((c) => c.args)).not.toEqual(want2);
  });
});

/** The tree with every `which` handler pointing at the FIRST row's id. */
function miswired(which: 'decide' | 'cancel'): Recorded[] {
  const calls: Recorded[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({ attr, args: args.filter((a) => (typeof a === 'string' && a !== STUB_VALUE) || typeof a === 'number').map(String) });
  const decide = record('decide');
  const cancel = record('cancel');
  const firstReq = MY.requests[0].id;
  const firstPend = PENDING[0].id;
  const got = reactHandlers(screen({
    onApply: record('apply') as never,
    onCancel: (which === 'cancel' ? (() => cancel(firstReq)) : cancel) as never,
    onDecide: (which === 'decide' ? ((_id: string, d: string) => decide(firstPend, d)) : decide) as never,
  }));
  got.forEach((h) => h.invoke());
  return calls;
}
