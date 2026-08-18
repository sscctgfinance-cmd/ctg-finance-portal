// HR OS · Attendance — the React screen against the legacy screen's committed golden.
//
// `tests/golden/hr.attendance.html` was captured from `hrAttendance()` + `hrAttRender()`
// (hros.html:3039, :3055) by the 40-surface harness; nothing here regenerates or edits it, and nothing
// here touches tests/render_surfaces.ts or web/tests/parity.ts. The component is rendered with
// `renderToStaticMarkup` from the SAME fixture the golden was captured from — tests/render_fixtures.ts,
// imported directly — normalised by the harness's own normalise(), relaxed by the documented layer in
// ./parity.ts, and compared.
//
// No seventh relaxation. The six the pilot argued cover this screen as it stands.

import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrAttendance, { type AttendanceList } from '../src/hr-attendance';
import { goldenSection, relax } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `hrCompanyName()` (hros.html:4445) resolves the chip in the page head to the selected company. */
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

/**
 * The `#hr` element is what `hrRender()` writes the page head and the screen body into (hros.html:1554).
 * `#hr_nav` — the other section in this golden — is `hrSidebar()`, chrome for all 18 HR views, which
 * report.md §3.5 puts outside a screen-by-screen strangler.
 */
const GOLDEN = goldenSection('hr.attendance', 'hr');

/**
 * THE TIMEZONE, PINNED — the punch log prints `hrClkTime()` (hros.html:2908), which formats a stored UTC
 * instant for the viewer, so its output depends on the machine's zone; the golden's "01:02" is
 * `2026-08-17T01:02:00.000Z` read in UTC. tests/render_harness.ts:62 pins that for the Deno harness by
 * overriding Date.prototype.toLocaleTimeString. This is the SAME override, applied for the length of
 * this file and then restored, exactly as web/tests/hr-clock.parity.test.tsx does it. It is not a
 * relaxation: the comparison stays exact, a wrong time still diffs, and it changes the INPUT both sides
 * are read under rather than what counts as a match.
 */
const REAL_TIME = Date.prototype.toLocaleTimeString;
beforeAll(() => {
  Date.prototype.toLocaleTimeString = function (this: Date, l?: never, o?: Intl.DateTimeFormatOptions) {
    return REAL_TIME.call(this, l ?? 'en-GB', { timeZone: 'UTC', ...(o || {}) });
  } as typeof REAL_TIME;
});
afterAll(() => { Date.prototype.toLocaleTimeString = REAL_TIME; });

/**
 * `ATT.month` at first paint — `todayLocalISO().slice(0,7)` (hros.html:3040) under the harness's frozen
 * clock (tests/render_harness.ts:19, 2026-08-18T09:30Z). The golden is that month.
 */
const MONTH = '2026-08';

const noop = () => {};

function screen(over: Partial<Parameters<typeof HrAttendance>[0]> = {}) {
  return (
    <HrAttendance
      data={FIXTURES.attendance_list as AttendanceList}
      companyName={COMPANY_NAME}
      month={MONTH}
      editRow={null}
      onMonthChange={noop}
      onAdd={noop}
      onExport={noop}
      onEdit={noop}
      onDelete={noop}
      onCloseModal={noop}
      onSave={noop}
      {...over}
    />
  );
}

const rendered = () => relax(renderToStaticMarkup(screen()));

describe('HR Attendance — React vs the legacy golden', () => {
  it('renders the same document as hrAttendance() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * What makes relaxation R1 safe on THIS screen. R1 drops `on*=` from the string comparison, so the
 * golden's `onclick="hrAttDel('p2')"` — the open punch — would otherwise compare equal to a row wired to
 * `'p1'`, and the operator would delete a completed shift instead of the one they clicked. This puts the
 * argument back: same handler kinds, same document order, same identifying arguments.
 *
 * Inline rather than in ./handlers.ts because that file is shared with two sibling migrations in flight
 * and the brief puts it off limits; it exports exactly the two halves this needs.
 */
function assertHandlerParity(over: Partial<Parameters<typeof HrAttendance>[0]> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({ attr, args: args.filter((a): a is string => typeof a === 'string' && a !== STUB_VALUE) });

  const got = reactHandlers(screen({
    onMonthChange: record('monthChange') as never,
    onAdd: record('add') as never,
    onExport: record('export') as never,
    onEdit: record('edit') as never,
    onDelete: record('delete') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());
  expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));

  // Guard the guard: if the golden ever stops carrying handlers, the two `toEqual`s above pass
  // vacuously and R1 becomes the blind strip it is not allowed to be.
  expect(want.length).toBeGreaterThan(0);
  expect(want.some((h) => h.args.length > 0)).toBe(true);
}

describe('the comparison still bites', () => {
  // Relaxations are only defensible if they cannot absorb a real change. These render the screen wrong
  // on purpose and require the comparison to notice each one. Without this, a relaxation that quietly
  // widened would leave a green suite and a screen that no longer matches.
  const real = FIXTURES.attendance_list as AttendanceList;
  const want = relax(GOLDEN);
  const wrong = (over: Partial<Parameters<typeof HrAttendance>[0]>) => relax(renderToStaticMarkup(screen(over)));

  it('catches a dropped punch row', () => {
    expect(wrong({ data: { ...real, punches: real.punches!.slice(0, 2) } })).not.toBe(want);
  });

  it('catches a dropped summary row', () => {
    expect(wrong({ data: { ...real, summary: real.summary!.slice(0, 1) } })).not.toBe(want);
  });

  it('catches a changed number — the estimated pay', () => {
    const s = real.summary!;
    expect(wrong({ data: { ...real, summary: [{ ...s[0], est_pay: 1206.26 }, s[1]] } })).not.toBe(want);
  });

  it('catches a changed time, which only moves if the zone pin holds', () => {
    const p = real.punches![0];
    expect(wrong({ data: { ...real, punches: [{ ...p, clock_in: '2026-08-17T02:02:00.000Z' }, ...real.punches!.slice(1)] } })).not.toBe(want);
  });

  it('catches a lost OPEN pill — a punch that silently gained a clock-out', () => {
    const p = real.punches![1];
    expect(wrong({ data: { ...real, punches: [real.punches![0], { ...p, clock_out: '2026-08-18T10:00:00.000Z' }, real.punches![2]] } })).not.toBe(want);
  });

  it('catches a changed label — the month in the summary heading', () => {
    expect(wrong({ month: '2026-07' })).not.toBe(want);
  });

  it('catches a changed value in the page-head chrome', () => {
    expect(wrong({ companyName: 'SKINDAE SDN BHD' })).not.toBe(want);
  });
});
