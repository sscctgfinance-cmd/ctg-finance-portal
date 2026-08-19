// HR OS · Leave — the React screen against the legacy screen's committed golden.
//
// `tests/golden/hr.leave.html` was captured from `hrLeaveAdminRender()` (hros.html:3426) by the
// 40-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts or tests/parity.ts. The component is rendered with `renderToStaticMarkup`
// from the SAME fixture the golden was captured from — tests/render_fixtures.ts, imported directly —
// normalised by the harness's own normalise(), relaxed by the documented layer in ./parity.ts, compared.
//
// No seventh relaxation. The six the pilot argued cover this screen as it stands.
//
// NO TIMEZONE PINNING, deliberately: this screen's only formatted timestamp goes through `hrDT()`
// (hros.html:1246), which adds a fixed +8h and then reads `getUTC*`. It never calls `toLocale*`, so the
// "4 Aug 2026, 10:00am" in the golden is the same string in every zone. `catches a shifted timestamp`
// below is what keeps that claim honest rather than assumed.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrLeave, {
  type LeaveEmployee, type LeaveFlowStep, type LeaveRequest, type LeaveType,
} from '../src/hr-leave';
import { goldenSection, relax } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `hrCompanyName()` (hros.html:4445) resolves the chip in the page head to the selected company. */
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

/**
 * The `#hr` element is what `hrRender()` writes the page head and the screen body into (hros.html:1538).
 * `#hr_nav` — the other section in this golden — is `hrSidebar()`, chrome for all 18 HR views, which
 * report.md §3.5 puts outside a screen-by-screen strangler.
 */
const GOLDEN = goldenSection('hr.leave', 'hr');

const ADMIN = FIXTURES.hr_leave_admin as {
  requests: LeaveRequest[]; employees: LeaveEmployee[]; leave_types: LeaveType[]; flow: LeaveFlowStep[];
};

/** hros.html:3420 keeps its own editable copy of the saved chain — `LVA.flowEdit`. */
const FLOW = ADMIN.flow.map((s) => ({
  name: s.name, approver_type: s.approver_type, approver_role: s.approver_role, approver_employee_id: s.approver_employee_id,
}));

/** `LVA`'s state at first paint — hros.html:3411. The golden is that state: both panels closed. */
const FIRST_PAINT = {
  applyOpen: false,
  balOpen: false,
  balEmp: '',
  balLoading: false,
  balData: null,
  balEdit: {},
  viewer: false,
} as const;

const APPLY = {
  employee_id: '', leave_type_id: '', date_from: '', date_to: '', reason: '', half_day: false, auto_approve: true,
};

const noop = () => {};

function screen(over: Partial<Parameters<typeof HrLeave>[0]> = {}) {
  return (
    <HrLeave
      requests={ADMIN.requests}
      employees={ADMIN.employees}
      leaveTypes={ADMIN.leave_types}
      flow={FLOW}
      companyName={COMPANY_NAME}
      {...FIRST_PAINT}
      myEmpId="e1"
      today="2026-08-19"
      apply={APPLY}
      onApplyToggle={noop}
      onApplyClose={noop}
      onApplyChange={noop}
      onApplySubmit={noop}
      onBalToggle={noop}
      onBalClose={noop}
      onBalPick={noop}
      onBalEdit={noop}
      onBalSave={noop}
      onFlowSet={noop}
      onFlowDel={noop}
      onFlowAdd={noop}
      onFlowSave={noop}
      onRefresh={noop}
      onDecide={noop}
      {...over}
    />
  );
}

const render = (over: Partial<Parameters<typeof HrLeave>[0]> = {}) => relax(renderToStaticMarkup(screen(over)));

describe('HR Leave — React vs the legacy golden', () => {
  it('renders the same document as hrLeaveAdminRender() does', () => {
    expect(render()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * What makes relaxation R1 safe on THIS screen. R1 drops `on*=` from the string comparison, so the
 * golden's `onclick="hrDecideLeave('lv1','approve')"` would otherwise compare equal to an Approve button
 * wired to lv2 — one operator click approving the wrong person's leave, and the markup identical.
 *
 * ── Why the golden side is read with `identArgs()` and not `goldenHandlers().args` ─────────────────
 * Same reason hr-approvals gives: this screen identifies a FLOW LEVEL by a bare integer
 * (`hrLeaveFlowSet(0,this.value)`, `hrLeaveFlowDel(1)`), and `goldenHandlers()` collects quoted literals
 * only — so every level would compare as `[]` and a remove link wired to level 0 for every row would
 * pass. `identArgs()` takes quoted literals AND bare integers in source order; that is a superset of
 * `goldenHandlers().args`, so it can only tighten the check. `handlers.ts` is shared and untouched.
 *
 * The row buttons are the quoted case and the flow rows are the integer case, so this screen needs BOTH
 * in one comparison — the first migrated screen that does. `catches a mis-wired Approve button` and
 * `catches a mis-wired flow level` below fail without it.
 */
function identArgs(raw: string): string[] {
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|\b(\d+)\b/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

type Recorded = { attr: string; args: string[] };

function recordedHandlers(over: Partial<Parameters<typeof HrLeave>[0]> = {}): Recorded[] {
  const calls: Recorded[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args
        .filter((a) => (typeof a === 'string' && a !== STUB_VALUE) || typeof a === 'number')
        .map(String),
    });

  const got = reactHandlers(screen({
    onApplyToggle: record('applyToggle') as never,
    onBalToggle: record('balToggle') as never,
    onFlowSet: record('flowSet') as never,
    onFlowDel: record('flowDel') as never,
    onFlowAdd: record('flowAdd') as never,
    onFlowSave: record('flowSave') as never,
    onRefresh: record('refresh') as never,
    onDecide: record('decide') as never,
    ...over,
  }));
  got.forEach((h) => h.invoke());
  // The attribute names come out of the tree; the arguments out of invoking it. Both are needed, so the
  // attr list is stapled onto the calls the invocation produced.
  return calls.map((c, i) => ({ attr: got[i] ? got[i].attr : '?', args: c.args }));
}

function assertHandlerParity(over: Partial<Parameters<typeof HrLeave>[0]> = {}) {
  const want = goldenHandlers(GOLDEN);
  const got = reactHandlers(screen(over));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  expect(recordedHandlers(over).map((c) => c.args)).toEqual(want.map((h) => identArgs(h.raw)));

  // Guard the guard: if the golden ever stops carrying handlers, the two `toEqual`s above pass
  // vacuously and R1 becomes the blind strip it is not allowed to be.
  expect(want.length).toBeGreaterThan(0);
  expect(want.filter((h) => identArgs(h.raw).length > 0).length).toBeGreaterThan(3);
}

describe('the comparison still bites', () => {
  // Relaxations are only defensible if they cannot absorb a real change. These render the screen wrong
  // on purpose and require the comparison to notice each one. The defects chosen are this screen's:
  // a decision fired against the wrong request, a request that quietly stops being actionable, a day
  // count that drifts, a step pill that loses who it is waiting on, and a shifted timestamp.
  const want = relax(GOLDEN);

  it('catches a dropped leave request', () => {
    expect(render({ requests: ADMIN.requests.slice(0, 1) })).not.toBe(want);
  });

  it('catches a changed day count — the number the balance is deducted by', () => {
    expect(render({ requests: ADMIN.requests.map((r) => ({ ...r, days: (r.days || 0) + 1 })) })).not.toBe(want);
  });

  it('catches a request silently becoming final — the row would lose Approve/Reject', () => {
    // `FINAL` is capitalised ('Approved'), the fixture's statuses are not, so both rows are still open in
    // the golden. Capitalise one and its two buttons vanish, which is a pending request nobody can act on.
    expect(render({ requests: ADMIN.requests.map((r, i) => (i ? r : { ...r, status: 'Approved' })) })).not.toBe(want);
  });

  it('catches a step pill losing who it is waiting on', () => {
    // The `(AHMAD BIN ISMAIL)` sub-caption AND the tooltip both come from `assignee_name`. Losing it
    // leaves an amber "⏳ Manager" that names nobody — the pill still looks fine.
    expect(render({ requests: ADMIN.requests.map((r) => ({ ...r, steps: (r.steps || []).map((s) => ({ ...s, assignee_name: null })) })) })).not.toBe(want);
  });

  it('catches a shifted timestamp, which is why hrDT() may not use toLocale*', () => {
    // `hrDT()` is +8h then getUTC*. If it were ever rewritten onto the machine's zone this test would be
    // luck-dependent; shifting the instant by an hour must diff, in every zone this ever runs in.
    const shifted = ADMIN.requests.map((r) => ({
      ...r,
      steps: (r.steps || []).map((s) => (s.decided_at ? { ...s, decided_at: '2026-08-04T03:00:00.000Z' } : s)),
    }));
    expect(render({ requests: shifted })).not.toBe(want);
  });

  it('catches a dropped flow level', () => {
    expect(render({ flow: FLOW.slice(0, 1) })).not.toBe(want);
  });

  it('catches a dropped employee option in the flow selects', () => {
    expect(render({ employees: ADMIN.employees.slice(0, 2) })).not.toBe(want);
  });

  it('catches a moved `selected`, which R5 must not absorb', () => {
    // The golden's selects mark NOTHING: level 0 is `manager` and level 1 is `role:hr_admin`, and neither
    // is an option these selects offer. Point a level at an option that IS offered and React marks it —
    // R5 only forgives a mark on the FIRST option when nothing else is marked, so this still diffs.
    expect(render({ flow: FLOW.map((s) => ({ ...s, approver_type: 'role', approver_role: 'director' })) })).not.toBe(want);
  });

  it('catches the viewer branch appearing — a read-only account must lose the write controls', () => {
    expect(render({ viewer: true })).not.toBe(want);
  });

  it('catches a changed value in the page-head chrome', () => {
    expect(render({ companyName: 'SKINDAE SDN BHD' })).not.toBe(want);
  });

  it('catches a mis-wired Approve button — R1 drops the attribute, so this is the only cover', () => {
    // Every Approve/Reject wired to the FIRST request: `hrDecideLeave('lv2','reject')` becomes
    // `hrDecideLeave('lv1','reject')`, and the rendered markup is byte-identical.
    const want2 = goldenHandlers(GOLDEN).map((h) => identArgs(h.raw));
    // Sanity: correctly wired, the same comparison passes — so the throw below is the mis-wiring and
    // not some unrelated mismatch in this harness.
    expect(recordedHandlers().map((c) => c.args)).toEqual(want2);
    expect(recordedHandlersMiswiredDecide(ADMIN.requests[0].id).map((c) => c.args)).not.toEqual(want2);
  });

  it('catches a mis-wired flow level — the check `goldenHandlers` alone would miss', () => {
    // The whole reason identArgs() exists. Every level's remove link wired to level 0.
    const want2 = goldenHandlers(GOLDEN).map((h) => identArgs(h.raw));
    expect(recordedHandlers().map((c) => c.args)).toEqual(want2);
    expect(recordedHandlersMiswiredFlowDel().map((c) => c.args)).not.toEqual(want2);

    // And the widening is what does it: with quoted-only extraction (`goldenHandlers().args`) the
    // mis-wired levels compare EQUAL, which is the silent pass identArgs() exists to close.
    const quotedOnly = goldenHandlers(GOLDEN).map((h) => h.args);
    const stripInts = (a: string[]) => a.filter((v) => !/^\d+$/.test(v));
    expect(recordedHandlersMiswiredFlowDel().map((c) => stripInts(c.args))).toEqual(quotedOnly);
  });
});

/** The tree with every decision button pointing at one request id. */
function recordedHandlersMiswiredDecide(id: string): Recorded[] {
  const calls: Recorded[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({ attr, args: args.filter((a) => (typeof a === 'string' && a !== STUB_VALUE) || typeof a === 'number').map(String) });
  const decide = record('decide');
  const got = reactHandlers(screen({
    onApplyToggle: record('applyToggle') as never,
    onBalToggle: record('balToggle') as never,
    onFlowSet: record('flowSet') as never,
    onFlowDel: record('flowDel') as never,
    onFlowAdd: record('flowAdd') as never,
    onFlowSave: record('flowSave') as never,
    onRefresh: record('refresh') as never,
    onDecide: ((_id: string, d: string) => decide(id, d)) as never,   // ← mis-wired: always the first request
  }));
  got.forEach((h) => h.invoke());
  return calls;
}

/** The tree with every flow remove link pointing at level 0. */
function recordedHandlersMiswiredFlowDel(): Recorded[] {
  const calls: Recorded[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({ attr, args: args.filter((a) => (typeof a === 'string' && a !== STUB_VALUE) || typeof a === 'number').map(String) });
  const del = record('flowDel');
  const got = reactHandlers(screen({
    onApplyToggle: record('applyToggle') as never,
    onBalToggle: record('balToggle') as never,
    onFlowSet: record('flowSet') as never,
    onFlowDel: (() => del(0)) as never,   // ← mis-wired: always level 0
    onFlowAdd: record('flowAdd') as never,
    onFlowSave: record('flowSave') as never,
    onRefresh: record('refresh') as never,
    onDecide: record('decide') as never,
  }));
  got.forEach((h) => h.invoke());
  return calls;
}
