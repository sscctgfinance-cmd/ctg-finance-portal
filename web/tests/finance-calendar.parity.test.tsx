// Finance OS · Compliance Calendar — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.calendar.html` was captured from `calRender()` (app.html:6907) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts,
// tests/parity.ts or tests/handlers.ts. The component is rendered with `renderToStaticMarkup` from the
// SAME fixture the golden was captured from, normalised by the harness's own normalise(), relaxed by the
// documented layer in ./parity.ts, and compared.
//
// NO SEVENTH RELAXATION, and no screen-local rule either — not even one of the four kinds CLAUDE.md
// lists (duplicate attribute, bare `&`, named reference, numeric reference). `calRender()` writes one
// character that needed thinking about, the apostrophe in "each company's", and R6 already covers it:
// the legacy string carries the raw `'` and React's text escaper emits `&#x27;`, which is exactly the
// pair R6 was written for. That is now what twenty-eight screens have done.
//
// ── WHAT IS NEW ABOUT THIS SCREEN, AND WHAT TURNED OUT NOT TO BE ──────────────────────────────────
//
// 1. IT IS NOT A CALENDAR GRID. The brief flagged this screen as the likeliest in either app to be left
//    on legacy code, expecting a hand-built month grid generated from date arithmetic. There is none.
//    `calRender()` is four buttons, four count cards and one bucketed table, and the buckets and the day
//    counts are STRINGS AND INTEGERS THE SERVER SENDS. It ported under the existing six relaxations with
//    nothing new.
//
// 2. THE ONE PIECE OF DATE LOGIC IS A STRING SPLIT, AND IT IS TESTED HARDEST. `dueLabel()` mirrors
//    app.html:6929-6933 including its refusal to use `new Date`, which the legacy comment explains:
//    `new Date('2026-07-30')` parses as UTC and prints 29 Jul west of Greenwich. On a compliance
//    calendar that is a missed statutory filing, so the off-by-one direction is driven directly below
//    rather than left to the diff.
//
// 3. THE GOLDEN IS THE LOADED SCREEN — checked, not assumed. `renderCalendar()` calls `spin('calendar')`
//    and then `calRender()` overwrites the SAME id, so last-write-wins keeps the loaded table and the
//    skeleton reaches no golden. After the `innerHTML=` there is nothing at all: `calRender()` ends at
//    its assignment and `renderCalendar()` only sets `loaded.calendar=true`. No `appendChild`, no
//    `.value=`, no `.className=` — so this is `finance.upload`'s case, not `finance.qinv`'s or
//    `finance.users`'s. Asserted against app.html's own text below so a later line added to the renderer
//    fails a test instead of silently invalidating the diff.
//
// 4. ONE MODE, ONE SECTION, AND THE GOLDEN COVERS IT. The screen has no sub-views, no sibling page and
//    no modal. The day filter re-fetches the same view. What the golden does NOT hold is three BRANCHES
//    of that one mode — the 🔒 refusal, the ⚠️ failure and the "No deadlines on file" empty state — all
//    three pinned below by assertion.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES } from '../../tests/render_fixtures';
import FinanceCalendar, {
  bucket, calendarBody, calendarReachable, dueLabel, Failed, icon, Refused, type Deadline,
} from '../src/finance-calendar';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `#calendar` is the tab div `render('calendar')` writes into — the golden's only section. */
const GOLDEN = goldenSection('finance.calendar', 'calendar');

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');

const DEADLINES = (FIXTURES.compliance_calendar as { deadlines: Deadline[] }).deadlines;

const noop = () => {};

type Props = Parameters<typeof FinanceCalendar>[0];

function screen(over: Partial<Props> = {}) {
  // `CAL_DAYS` is 365 at load (app.html:6898), which is the state the harness captured.
  return <FinanceCalendar deadlines={DEADLINES} days={365} onDays={noop} {...over} />;
}

const rendered = (over: Partial<Props> = {}) => relax(renderToStaticMarkup(screen(over)));

describe('Finance Compliance Calendar — React vs the legacy golden', () => {
  it('renders the same document as calRender() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same day window, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * R1 drops `on*=` from the string comparison, so the four filter buttons — identical but for a number —
 * are byte-identical in stripped output once their handlers are stripped. Every one of them is an INLINE
 * STATEMENT rather than a call (`CAL_DAYS=90;renderCalendar()`), which is the shape CLAUDE.md flags as
 * common in app.html and rare in hros.html.
 *
 * `identArgs()` is the established local widening (CLAUDE.md: the tenth screen to copy it, and do not
 * edit the shared handlers.ts mid-flight). Every argument here is a BARE INTEGER, so `goldenHandlers()`'s
 * quoted-only extraction returns [] for all four buttons and the check would pass with every button
 * asking the server for the same window — including "All" quietly narrowing to 30 days, which HIDES
 * overdue statutory deadlines with nothing on screen looking wrong.
 *
 * No `LEGACY_TO_PROP` is needed: no handler on this screen is argument-free.
 */
function identArgs(raw: string): string[] {
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|\b(-?\d+)\b/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

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
  misfire = record('days');

  const got = reactHandlers(screen({ onDays: record('days') as never, ...over }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));

  got.forEach((h) => h.invoke());
  expect(calls.map((c) => c.args)).toEqual(want.map((h) => identArgs(h.raw)));

  // Guard the guard: if the golden ever stops carrying handlers, the assertions above pass vacuously
  // and R1 becomes the blind strip it is not allowed to be.
  expect(want.length).toBe(4);
  expect(want.every((h) => identArgs(h.raw).length > 0)).toBe(true);
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

describe('the date arithmetic — a day is a statutory filing', () => {
  // The legacy comment at app.html:6929 is the whole reason this is a string split. These cases drive
  // the direction it protects against: `new Date('2026-07-30')` is midnight UTC, which is 29 Jul in any
  // browser west of Greenwich, and 30 Jul in MYT. A port that used the Date constructor passes in KL and
  // reports a deadline a day early — or a day LATE — in London.
  it('formats a due date without going through Date', () => {
    expect(dueLabel('2026-07-30')).toBe('30 Jul 2026');
    expect(dueLabel('2027-03-31')).toBe('31 Mar 2027');
    expect(dueLabel('2026-01-01')).toBe('1 Jan 2026');   // leading zero dropped, as Number() does
    expect(dueLabel('2026-12-31')).toBe('31 Dec 2026');
  });

  it('cannot be a Date-based port at all — pinned in the SOURCE, not by the output', () => {
    // This one was found the hard way. A `dueLabel()` rewritten as
    // `new Date(due)` → getDate/getMonth/getFullYear passes every output assertion in this file on a
    // machine east of Greenwich, which is where this app is developed and where CI happens to run — and
    // then prints the day BEFORE for every operator in London. An output check simply cannot see that:
    // it is a property of the environment, not of the value. So the guard is on the implementation.
    const src = readFileSync(join(REPO, 'web', 'src', 'finance-calendar.tsx'), 'utf8');
    const at = src.indexOf('export function dueLabel(');
    expect(at).toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf('\n}', at));
    expect(body).not.toMatch(/new Date|Date\.|toLocale|getMonth|getDate|getFullYear/);
    // Nothing anywhere in the screen reads a clock either — the component is a pure function of its
    // props, and `days_until` is the server's integer. (Comments stripped: the file's own header
    // and dueLabel's own doc comment QUOTE `new Date` to explain why there isn't one.)
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/new Date|Date\.now/);
  });

  it('keeps the YEAR verbatim rather than re-deriving it', () => {
    expect(dueLabel('2027-01-01')).toBe('1 Jan 2027');
  });

  it('falls back to the raw string rather than to a plausible wrong date', () => {
    expect(dueLabel('')).toBe('');
    expect(dueLabel(null)).toBe('');
    expect(dueLabel('2026-07')).toBe('2026-07');
    expect(dueLabel('30/07/2026')).toBe('30/07/2026');
  });

  it('reads the month from the SECOND part — a swapped D/M would show here', () => {
    expect(dueLabel('2026-03-11')).toBe('11 Mar 2026');
    expect(dueLabel('2026-11-03')).toBe('3 Nov 2026');
  });

  it('mirrors app.html rather than being retyped: the legacy source really has no `new Date` in it', () => {
    const at = APP.indexOf('function calRender()');
    expect(at).toBeGreaterThan(0);
    const body = APP.slice(at, APP.indexOf('\n/* ──', at));
    // No `new Date(` CALL — the only occurrence of those words in there is the legacy comment saying
    // why there isn't one.
    expect(body).not.toMatch(/new Date\(/);
    expect(body).toContain('not via new Date which interprets as UTC');
    // …and the month table is the same twelve names, in the same order.
    expect(body).toContain("['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']");
  });
});

describe('the golden is the loaded screen — checked, not assumed', () => {
  it('renderCalendar() does nothing after calRender() writes the div', () => {
    const at = APP.indexOf('async function renderCalendar()');
    expect(at).toBeGreaterThan(0);
    const body = APP.slice(at, APP.indexOf('function calRender()', at));
    // spin() first, then calRender() overwrites the SAME id — last write wins, so no skeleton.
    expect(body).toContain("spin('calendar')");
    expect(body.indexOf("spin('calendar')")).toBeLessThan(body.indexOf('calRender()'));
    // Nothing after it that the harness cannot see (finance.qinv / finance.users' trap).
    expect(body.slice(body.indexOf('calRender()'))).not.toMatch(/appendChild|\.className\s*=|\.value\s*=/);
  });

  it('calRender() ends at its innerHTML assignment', () => {
    const at = APP.indexOf('function calRender()');
    const body = APP.slice(at, APP.indexOf('\n/* ──', at));
    expect(body).not.toMatch(/appendChild|\.className\s*=|setTimeout/);
    // The ONE element id it writes. A second id would mean a second golden section.
    expect([...body.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1])).toEqual(['calendar']);
  });
});

describe('the permission gate — always visible, gated server-side', () => {
  it('is reachable on every login', () => {
    expect(calendarReachable()).toBe(true);
  });

  it('mirrors app.html:1426 verbatim — not a neighbour’s rule', () => {
    expect(APP).toContain("else if(t==='calendar') el.classList.remove('hide'); // Compliance Calendar: gated server-side");
    // Read the whole block: `calendar` must not be named in any OTHER branch, or the effective rule
    // would be a different one. Four Finance screens have now found their gate was not their
    // neighbours'.
    const block = APP.slice(APP.indexOf("document.querySelectorAll('.tab').forEach"), APP.indexOf("document.querySelectorAll('.tab-cat')"));
    expect([...block.matchAll(/t==='calendar'/g)]).toHaveLength(1);
    // It is NOT the admin gate and NOT the feature flag: no `canManage`, no `feats.indexOf` on its line.
    const line = block.split('\n').find((l) => l.includes("t==='calendar'")) as string;
    expect(line).not.toMatch(/canManage|feats\.indexOf/);
  });

  it('renders the server’s refusal as a refusal, never as an empty table', () => {
    // The branch that carries the security meaning on a server-gated screen (finance.pharm's rule).
    const html = renderToStaticMarkup(<Refused error="Not permitted for this account" />);
    expect(html).toContain('🔒');
    expect(html).toContain('Not permitted for this account');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('No deadlines on file');
    // …and a failure is a DIFFERENT document from a refusal.
    expect(renderToStaticMarkup(<Failed error="network" />)).toContain('⚠️');
  });

  it('posts the day window the operator chose, and nothing else', () => {
    expect(calendarBody(365)).toEqual({ api: 'compliance_calendar', days: 365 });
    expect(calendarBody(9999)).toEqual({ api: 'compliance_calendar', days: 9999 });
    expect(APP).toContain("call({api:'compliance_calendar', days:CAL_DAYS})");
  });
});

describe('bucketing', () => {
  it('puts each deadline in the urgency the SERVER sent', () => {
    const by = bucket(DEADLINES);
    expect(by.overdue.map((x) => x.label)).toEqual(['Annual Return (SSM)']);
    expect(by.critical).toHaveLength(1);
    expect(by.warning).toHaveLength(1);
    expect(by.upcoming).toHaveLength(1);
    expect(by.distant).toHaveLength(1);
  });

  it('sends an unrecognised urgency to LATER, as the legacy does — it does not invent a louder one', () => {
    const by = bucket([{ urgency: 'imminent', label: 'x' }]);
    expect(by.distant.map((x) => x.label)).toEqual(['x']);
    expect(by.overdue).toEqual([]);
  });

  it('icons every kind, and falls back to 📌', () => {
    expect([icon('statutory'), icon('licence'), icon('lease'), icon('insurance')]).toEqual(['⚖', '📜', '🔑', '🛡']);
    expect(icon('something-else')).toBe('📌');
  });
});

describe('the comparison still bites', () => {
  // This SCREEN's real risks: a statutory deadline that vanishes, a date that shifted by a day, a count
  // card that stopped matching its bucket, a deadline demoted to a quieter urgency, a filter button
  // asking for the wrong window.
  const want = relax(GOLDEN);
  const withRow = (i: number, over: Partial<Deadline>) =>
    rendered({ deadlines: DEADLINES.map((x, k) => (k === i ? { ...x, ...over } : x)) });

  it('catches a deadline dropped off the calendar', () => {
    expect(rendered({ deadlines: DEADLINES.slice(1) })).not.toBe(want);
  });

  it('catches a due date that shifted by ONE DAY', () => {
    expect(withRow(0, { due_date: '2026-07-29' })).not.toBe(want);
    expect(withRow(0, { due_date: '2026-07-31' })).not.toBe(want);
  });

  it('catches a due date that shifted by a month or a year', () => {
    expect(withRow(0, { due_date: '2026-08-30' })).not.toBe(want);
    expect(withRow(0, { due_date: '2027-07-30' })).not.toBe(want);
  });

  it('catches a day count that changed — including the sign', () => {
    expect(withRow(0, { days_until: -18 })).not.toBe(want);
    expect(withRow(3, { days_until: 75 })).not.toBe(want);
  });

  it('MIRRORS the legacy Math.abs on an overdue pill rather than "fixing" it', () => {
    // app.html:6914 — the overdue pill is `Math.abs(days)+'d overdue'`, so a `days_until` whose SIGN
    // flipped while `urgency` stayed 'overdue' prints identically. That is a real gap in the legacy
    // screen and it is mirrored, not corrected: changing it is a behaviour change, not a migration
    // detail. It is bounded, because the SERVER sends both fields together and the bucket is what
    // decides the section — a genuinely-not-overdue row arrives with a different `urgency`, which the
    // case above catches.
    expect(withRow(0, { days_until: 19 })).toBe(want);
    expect(APP).toContain("'<span class=\"pill\" style=\"background:rgba(239,68,68,.18);color:var(--red-soft);font-size:10px\">⚠ '+Math.abs(days)+'d overdue</span>'");
  });

  it('catches a deadline demoted to a quieter urgency — and the count card that follows it', () => {
    expect(withRow(0, { urgency: 'distant' })).not.toBe(want);
    expect(withRow(1, { urgency: 'upcoming' })).not.toBe(want);
  });

  it('catches a renamed item, a lost detail line and a re-assigned company', () => {
    expect(withRow(0, { label: 'Annual Return' })).not.toBe(want);
    expect(withRow(0, { detail: null })).not.toBe(want);
    expect(withRow(0, { tenant_name: 'SKINDAE SDN BHD' })).not.toBe(want);
  });

  it('catches the wrong icon for a kind', () => {
    expect(withRow(0, { kind: 'licence' })).not.toBe(want);
  });

  it('catches the active filter button moving', () => {
    expect(rendered({ days: 30 })).not.toBe(want);
    expect(rendered({ days: 9999 })).not.toBe(want);
  });

  it('catches the empty state replacing the table — a branch no golden holds', () => {
    const empty = rendered({ deadlines: [] });
    expect(empty).not.toBe(want);
    expect(empty).toContain('No deadlines on file.');
    expect(empty).not.toContain('<table');
    // The four count cards survive an empty calendar, as the legacy writes them.
    expect(empty).toContain('⚠ Overdue');
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=` from the string comparison, so both of these are invisible to the diff above.

  it('catches a filter button asking for the wrong window', () => {
    // "All" quietly narrowing to 30 days hides every overdue statutory deadline past that window.
    expect(() => assertHandlerParity({ onDays: (() => misfire(30)) as never })).toThrow(/deeply equal/);
  });

  it('catches the filter buttons wired in the wrong order', () => {
    const swapped = [9999, 90, 365, 30];
    let i = 0;
    expect(() => assertHandlerParity({ onDays: (() => misfire(swapped[i++])) as never })).toThrow(/deeply equal/);
  });
});
