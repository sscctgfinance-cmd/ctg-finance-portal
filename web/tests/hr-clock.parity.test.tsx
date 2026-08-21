// HR OS · Time Clock — the React screen against the legacy screen's committed golden.
//
// `tests/golden/hr.clock.html` was captured from `hrClockRender()` (hros.html:2926) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts or
// tests/parity.ts. The component is rendered with `renderToStaticMarkup` from the SAME fixture the
// golden was captured from — tests/render_fixtures.ts, imported directly — normalised by the harness's
// own normalise(), relaxed by the documented layer in ./parity.ts, and compared.
//
// No seventh relaxation. The six the pilot argued cover this screen as it stands.

import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrClock, { type ClockStatus } from '../src/hr-clock';
import { goldenSection, relax } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `hrCompanyName()` (hros.html:4445) resolves the chip in the page head to the selected company. */
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

/**
 * The `#hr` element is what `hrRender()` writes the page head and the screen body into (hros.html:1554).
 * The golden's other two sections are chrome for every HR view, not this screen: `#hr_nav` is
 * `hrSidebar()` and `#emp-mobnav` is `hrRenderMobileChrome()`'s bottom tab bar. report.md §3.5 puts both
 * outside a screen-by-screen strangler — keep them in the legacy files, re-implement once in the shell.
 */
const GOLDEN = goldenSection('hr.clock', 'hr');

/**
 * THE TIMEZONE, PINNED — the one thing this screen needed that the pilot did not.
 *
 * `hrClkTime()` formats a stored UTC instant for the viewer, so its output depends on the machine's
 * zone; the golden's "01:10" is `2026-08-18T01:10:00.000Z` read in UTC. tests/render_harness.ts:62 pins
 * that for the Deno harness by overriding Date.prototype.toLocaleTimeString to force `timeZone: 'UTC'`.
 * This is the SAME override, applied for the length of this file and then restored, so the React side is
 * read in the same zone the golden was written in. It is not a relaxation: the comparison stays exact,
 * a wrong time still diffs, and it changes the INPUT both sides are read under rather than what counts
 * as a match. Pinning it here rather than in vitest.config.mts keeps it out of the siblings' way.
 */
const REAL_TIME = Date.prototype.toLocaleTimeString;
beforeAll(() => {
  Date.prototype.toLocaleTimeString = function (this: Date, l?: never, o?: Intl.DateTimeFormatOptions) {
    return REAL_TIME.call(this, l ?? 'en-GB', { timeZone: 'UTC', ...(o || {}) });
  } as typeof REAL_TIME;
});
afterAll(() => { Date.prototype.toLocaleTimeString = REAL_TIME; });

/** `CLK`'s state at first paint — hros.html:2907. The golden is that state: not acting, tick at zero. */
const FIRST_PAINT = { elapsed: '00:00:00', now: '09:41', acting: false };

const noop = () => {};

function screen(over: Partial<Parameters<typeof HrClock>[0]> = {}) {
  return (
    <HrClock
      data={FIXTURES.clock_status as ClockStatus}
      companyName={COMPANY_NAME}
      {...FIRST_PAINT}
      onClockAction={noop}
      onSchedSave={noop}
      {...over}
    />
  );
}

const rendered = () => relax(renderToStaticMarkup(screen()));

describe('HR Time Clock — React vs the legacy golden', () => {
  it('renders the same document as hrClockRender() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * What makes relaxation R1 safe on THIS screen. R1 drops `on*=` from the string comparison, so the
 * golden's `onclick="hrClockAction('out')"` would otherwise compare equal to a button wired to `'in'` —
 * which is the difference between ending your shift and starting a second one. This puts the argument
 * back: same handler kinds, same document order, same identifying arguments.
 *
 * Inline rather than in ./tests/handlers.ts because that file is shared with two sibling migrations in
 * flight and the brief puts it off limits; it exports exactly the two halves this needs.
 */
function assertHandlerParity(over: Partial<Parameters<typeof HrClock>[0]> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({ attr, args: args.filter((a): a is string => typeof a === 'string' && a !== STUB_VALUE) });

  const got = reactHandlers(screen({
    onClockAction: record('clockAction') as never,
    onSchedSave: record('schedSave') as never,
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
  const real = FIXTURES.clock_status as ClockStatus;
  const want = relax(GOLDEN);
  const wrong = (over: Partial<Parameters<typeof HrClock>[0]>) => relax(renderToStaticMarkup(screen(over)));

  it('catches a dropped row', () => {
    expect(wrong({ data: { ...real, today: [] } })).not.toBe(want);
  });

  it('catches a changed number — the week total', () => {
    expect(wrong({ data: { ...real, week_hours: 27.12 } })).not.toBe(want);
  });

  it('catches a changed time, which only moves if the zone pin holds', () => {
    const t = real.today![0];
    expect(wrong({ data: { ...real, today: [{ ...t, clock_in: '2026-08-18T02:10:00.000Z' }] } })).not.toBe(want);
  });

  it('catches a dropped tick on a work day — a bare boolean attribute', () => {
    const emp = { ...real.employee, work_days: [1, 2, 3, 4] };
    expect(wrong({ data: { ...real, employee: emp } })).not.toBe(want);
  });

  it('catches a changed value in the page-head chrome', () => {
    expect(wrong({ companyName: 'SKINDAE SDN BHD' })).not.toBe(want);
  });

  it('catches a disabled button, which R4 spells as a bare attribute either way', () => {
    expect(wrong({ acting: true })).not.toBe(want);
  });
});

/**
 * CLOCK-IN REMINDERS — RETIRED in v224 with the installable app and Web Push.
 *
 * `hrPushCard()` and its four states used to be asserted here, because `PUSH.supported` reads
 * `'serviceWorker' in navigator` and the offline harness has no navigator, so the card could never reach
 * `tests/golden/hr.clock.html`. That same fact is why removing it moved the golden by zero bytes — the
 * regenerated surface is byte-identical. These two negatives are what is left of that coverage: they
 * fail if the card comes back on either side, which is the only way this screen can now disagree with
 * the legacy one about push.
 */
describe('the clock-in reminders card is gone from BOTH sides', () => {
  it('renders nothing about push, whatever props it is handed', () => {
    const doc = renderToStaticMarkup(screen());
    expect(doc).not.toContain('Clock-in reminders');
    expect(doc).not.toContain('Enable clock-in reminders');
    expect(doc).not.toContain('On for this device');
  });

  it('the legacy screen it mirrors no longer builds one either', () => {
    // Read hros.html rather than trust this file: the two halves are only in step if the LEGACY one
    // stopped too. A card restored there would otherwise diverge silently, since no golden holds it.
    const legacy = readFileSync(new URL('../../hros.html', import.meta.url), 'utf8');
    expect(legacy).not.toContain('hrPushCard');
    expect(legacy).not.toContain('pushInitSW');
    expect(legacy).not.toContain('rel="manifest"');
    expect(legacy).not.toContain('name="apple-mobile-web-app-capable"');
    // …and the guard is not vacuous: the file really is the one this screen mirrors.
    expect(legacy).toContain('function hrClockRender(');
  });

  it('the EMAIL reminder — the reason retiring push was acceptable — is untouched', () => {
    const raw = readFileSync(new URL('../../supabase/functions/portal/hr.ts', import.meta.url), 'utf8');
    // Comments are blanked before the negative, the same reason web/tests/timezone-audit.test.tsx blanks
    // them: the v224 notes left in hr.ts NAME `pushToEmployee` to say it is gone, and a word-match on the
    // raw text would read that as the call still being there.
    const hr = raw.replace(/^\s*\/\/.*$/gm, '');
    expect(hr).toContain('if (api === "cron_clock_reminders")');
    expect(hr).toContain('[HR OS] Time to clock in');
    expect(hr).toContain('[HR OS] Don\u2019t forget to clock out');
    expect(hr).toContain('.eq("clock_reminder",true)');
    // The push sender is what went; the email sender is what stayed.
    expect(hr).not.toContain('pushToEmployee');
  });
});
