// THE TIMEZONE AUDIT — every date read in `web/`, classified and pinned at the SOURCE.
//
// v224 — THE PORTAL IS NOW ALWAYS MALAYSIAN TIME, and this file changed with it. Before v224 this audit
// INVENTORIED four idioms and pinned each one where it stood, including the ones that were the machine's
// zone: its job was "nothing drifted", not "everything is right". The captain's decision made it
// "everything is Malaysian", so the LOCAL entries below are now MYT_SHARED — they delegate to `myt.js`,
// the single definition of Malaysian time this repo has, loaded by both legacy apps and imported here.
// What survived unchanged is the METHOD: pin the source, because on this fleet the output cannot tell
// you. What is deliberately still NOT Malaysian is listed under "WHAT IS DELIBERATELY LEFT" below.
//
// WHY THIS FILE EXISTS. The Calendar port rewrote `dueLabel()` with the `Date` constructor — the
// obvious way — and all 29 of that screen's tests still passed. They passed because this machine and
// CI both sit at UTC+8, where the defect is invisible: `new Date('2026-07-30')` is midnight UTC, and
// west of Greenwich it prints 29 Jul. On a compliance calendar that is a missed statutory filing.
// An OUTPUT assertion cannot see this class of defect on this fleet. The guard has to be on the
// implementation. `web/tests/finance-calendar.parity.test.tsx` established the shape; five screens
// carried one; the other thirty-one had never been checked. This file checks all of them.
//
// IT HAS TWO HALVES, AND BOTH ARE LOAD-BEARING.
//
// 1. THE INVENTORY (`INVENTORY` below). Every `.ts`/`.tsx` file under `web/src` and `web/app` is
//    scanned for date tokens IN CODE (comments stripped — several of these files QUOTE `new Date` in
//    prose to explain why they do not call it). Every hit must be accounted for by an entry here, and
//    the count must match exactly. That is what keeps this audit alive: a date read added to any screen
//    tomorrow fails here until somebody classifies it. Without the count, the audit is a snapshot of
//    2026-08-21 and nothing more.
//
// 2. THE PINS (`PINS` below). For each derivation whose REWRITE would be invisible on a UTC+8 runner,
//    the function body is read out of the source and checked for the tokens that make it right and
//    the tokens that would make it wrong. There are four kinds, and mixing them up is the defect:
//
//      MYT   `Date.now() + 8*3600000` read back with `getUTC*`. Malaysia time computed WITHOUT a
//            timezone database, so every browser agrees which day it is in Kuala Lumpur. Rewriting it
//            with `getFullYear()` is the machine's zone; with `toISOString()` it is UTC, which before
//            8am MYT is YESTERDAY. app.html:1263 is the original and says so.
//      MYT_SHARED  the same answer as MYT, delegated to `myt.js` instead of spelling the shift again.
//            Every derivation v224 converted is this kind. The body must MENTION a myt* helper and must
//            NOT carry a local getter, a `toISOString`, a `toLocale*` or its own `8 * 3600000` — a
//            "simplification" back to any of those is the defect this file exists to catch.
//      LOCAL the MACHINE's zone — `getFullYear/getMonth/getDate` on a bare `new Date()`. Two entries are
//            left, and both are a wall-clock date with NO zone to get wrong: `finance-qinv`'s `fmtDate`
//            (it parses `YYYY-MM-DD` at local midnight and reads it straight back, so it round-trips
//            identically everywhere) and `hr-payroll`'s `dueInfo`, whose two local midnights subtract to
//            a whole number of days in every zone — its "today" IS Malaysian now, via mytYMD().
//      UTC   `toISOString().slice(0,10)`. Deliberate in three places, all of them a stamp on a
//            document rather than a date an operator picks.
//      BARE  `toLocaleString()` with no locale and no `timeZone`. The legacy writes it that way, and it
//            renders an INSTANT rather than deriving a date, so it is outside "always Malaysian time"
//            as scoped. ADDING the zone would also move goldens: `tests/render_harness.ts` makes the
//            local getters read as UTC and forces `timeZone:'UTC'` on every `toLocale*`, so an 8-hour
//            shift is visible in the committed baseline. See "WHAT IS DELIBERATELY LEFT".
//
// WHAT IS DELIBERATELY LEFT, and why — name these before assuming something was missed:
//   · `hrFormEStats()` (hr-docs.js:267) — THE CAPTAIN'S EXPLICIT CARVE-OUT. `new Date(join_date)
//     .getFullYear()` drops a 1 January hire west of Greenwich, and it changes a figure FILED WITH LHDN.
//     Finance sign-off, not a code change. `tests/yearend_files_test.ts` pins it.
//   · `hrFmtDMY()` (hr-docs.js:229) — the same class, found by this sweep: a cessation DATE on an EA
//     form / CP8D, read with local getters off a midnight-UTC Date. `deno test` under a western zone
//     fails on it TODAY, before any change here. Raised for the captain, not converted.
//   · `myLindungActive()` (payroll.js:48) — its no-period fallback reads the UTC year/month, which
//     decides a statutory deduction. Same rule: a filed figure.
//   · every BARE `toLocale*` above — an instant displayed, and pinned by the goldens.
//   · dates typed into a spreadsheet cell (salesrecon.js, gateway.js) and every duration.
//
// WHAT THIS FILE IS NOT. It does not diff markup and it owns no golden. It does not touch
// `web/tests/parity.ts` or `web/tests/handlers.ts`. It duplicates a handful of pins that already live
// in a screen's own test (`finance-calendar`, `finance-cfo`, `finance-info`, `finance-overview`,
// `finance-ap`, `finance-users-subviews`); those stay where they are — this file's job is the
// thirty-one screens that had none, and the inventory that stops the list going stale.
//
// SEAM LEFT NAMED, NOT TAKEN: the inventory counts LINES, not expressions, so two date reads written
// on one line count as one. Every current site is one-per-line and the pins cover the derivations that
// matter; splitting the scanner per-expression is a bigger change than it buys.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO } from './parity';

const WEB = join(REPO, 'web');

/**
 * Every token that reads or derives a date. `Date.now()` is in here because the interesting question
 * is never "is this a Date object" but "does this line depend on when and WHERE it runs".
 */
const DATE_TOKEN =
  /\bnew Date\b|\bDate\.now\b|\bDate\.UTC\b|\.getFullYear\(|\.getMonth\(|\.getDate\(|\.getDay\(|\.getHours\(|\.getMinutes\(|\.getSeconds\(|\.getUTC[A-Za-z]*\(|\.setDate\(|\.setMonth\(|\.setFullYear\(|\.setHours\(|\.toISOString\(|\.toLocale[A-Za-z]*\(|\bIntl\.DateTimeFormat\b/;

/**
 * The money helper every screen carries — `'RM ' + (Number(n)||0).toLocaleString('en-MY', {…})`. It is
 * `toLocale*` on a NUMBER, not a date, and there are two dozen of them. Excluded from the inventory so
 * the counts track date handling; the exclusion is itself asserted below, so a date cannot hide behind
 * it.
 */
const MONEY = /minimumFractionDigits/;

/** Comments blanked (length preserved so line numbers survive) — prose that QUOTES `new Date` is not a call. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (m, p: string) => p + ' '.repeat(m.length - p.length));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'out' || e === '.next') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

type Hit = { file: string; line: number; text: string };

function scan(): { hits: Hit[]; money: Hit[] } {
  const hits: Hit[] = [];
  const money: Hit[] = [];
  for (const abs of [...walk(join(WEB, 'src')), ...walk(join(WEB, 'app'))].sort()) {
    const file = relative(WEB, abs).split(sep).join('/');
    codeOnly(readFileSync(abs, 'utf8')).split('\n').forEach((l, i) => {
      if (!DATE_TOKEN.test(l)) return;
      (MONEY.test(l) ? money : hits).push({ file, line: i + 1, text: l.trim() });
    });
  }
  return { hits, money };
}

const { hits: HITS, money: MONEY_HITS } = scan();

const countOf = (file: string) => HITS.filter((h) => h.file === file).length;

/**
 * WHAT: a date-handling file, how many date-token lines it holds, and the classification.
 *
 *   a — the legacy does the same thing at the same point. Mirrored; needs pinning, not fixing.
 *   b — the port introduced a `Date` the legacy did not have. A real defect. (None were found; see
 *       the PR. The letter is kept so a future one has somewhere to land.)
 *   c — genuinely safe: epoch arithmetic, a filename, or a value handed in as a prop.
 *
 * `legacy` is the line the behaviour was copied from, so the next reader can check the claim rather
 * than trust it.
 */
const INVENTORY: { file: string; n: number; cat: 'a' | 'b' | 'c'; legacy: string; note: string }[] = [
  // ---- Finance routes -------------------------------------------------------------------------
  { file: 'app/finance/cfo/page.tsx', n: 1, cat: 'a', legacy: 'app.html:1862', note: 'ytdYear(new Date()) — the clock read lifted out of the component' },
  { file: 'app/finance/close/page.tsx', n: 1, cat: 'a', legacy: 'app.html:5305', note: 'defaultPeriod(Date.now()) — MYT month' },
  { file: 'app/finance/info/page.tsx', n: 2, cat: 'a', legacy: 'app.html:5651, :5928', note: 'now for the expiry badge; printedOn is MYT since v224, as the legacy is' },
  { file: 'app/finance/layout.tsx', n: 1, cat: 'a', legacy: 'app.html:5297', note: '⬇ Export hands the clock to exportFileName; the derivation is in src/finance-export.ts' },
  { file: 'app/finance/o2o/page.tsx', n: 6, cat: 'a', legacy: 'app.html:2771-2772', note: 'o2oToday/o2oPlusDays read the clock at call time; the route does the same' },
  { file: 'app/finance/ocr/page.tsx', n: 1, cat: 'c', legacy: 'app.html:6568', note: 'Date.now() in a download filename' },
  { file: 'app/finance/overview/page.tsx', n: 3, cat: 'a', legacy: 'app.html:1606, :2143', note: 'ovDates and the refresh stamp take Date.now(); both derivations are in src/' },
  { file: 'app/finance/pnl/page.tsx', n: 2, cat: 'a', legacy: 'app.html:1263 via :4525', note: 'todayLocalISO for the CSV filename — MYT' },
  { file: 'app/finance/qinv/page.tsx', n: 5, cat: 'a', legacy: 'app.html:3207, :4237, :4328', note: 'date default + POST date are MYT; the preview stamp is MYT since v224; two are a cache TTL' },
  { file: 'app/finance/selfbill/page.tsx', n: 2, cat: 'a', legacy: 'app.html:3977', note: 'invoice-date default — MYT' },
  { file: 'app/finance/upload/page.tsx', n: 1, cat: 'c', legacy: 'app.html:2481', note: 'Date.now() in a scan filename' },
  { file: 'app/finance/users/page.tsx', n: 2, cat: 'c', legacy: 'app.html:4695, :4739', note: 'Date.now() handed to relSec/relTime as a prop — epoch arithmetic' },
  // ---- HR routes ------------------------------------------------------------------------------
  { file: 'app/hr/attendance/page.tsx', n: 3, cat: 'a', legacy: 'hros.html:3040, :3085', note: 'v224: month default and the punch READ-BACK are MYT; the punch is still POSTED as an instant' },
  { file: 'app/hr/calculator/page.tsx', n: 2, cat: 'a', legacy: 'hros.html:4897-4898, :4906-4907', note: 'v224: the payslip/audit-log period is MYT — the clock read is still lifted out of the component' },
  { file: 'app/hr/clock/page.tsx', n: 4, cat: 'a', legacy: 'hros.html:2909-2910', note: 'the ticking clock; elapsed is epoch arithmetic' },
  { file: 'app/hr/dashboard/page.tsx', n: 1, cat: 'a', legacy: 'hros.html:1727', note: 'v224: first-paint month/year default is MYT' },
  { file: 'app/hr/expenses/page.tsx', n: 2, cat: 'a', legacy: 'hros.html:1840 → :1271, :2684', note: 'v224: hrToday is MYT — the legacy comment already claimed it was and now it is. v226 adds one cat-c read: Date.now() handed to typeRow() for a NEW claim type\'s fallback CODE suffix (hros.html:2684), which is an id, not a date' },
  { file: 'app/hr/leave/page.tsx', n: 1, cat: 'a', legacy: 'hros.html:3437 → :1271', note: 'v224: the apply-on-behalf date default is MYT' },
  { file: 'app/hr/payroll/page.tsx', n: 3, cat: 'a', legacy: 'hros.html:4058, :4270, :3831', note: 'v224: month/year default and the resign-date default are MYT; dueInfo takes the instant' },
  { file: 'app/hr/yearend/page.tsx', n: 2, cat: 'a', legacy: 'hros.html:4921-4922', note: 'taxYears/defaultTaxYear — the clock read lifted out of the component' },
  // ---- Finance screens ------------------------------------------------------------------------
  { file: 'src/finance-ap.tsx', n: 2, cat: 'a', legacy: 'app.html:6821, :6913, :6960', note: 'the only screen whose legacy passes timeZone explicitly — pinned in its own test' },
  { file: 'src/finance-cfo.tsx', n: 2, cat: 'a', legacy: 'app.html:1862, :2080', note: 'ytdYear is MYT; the analytics stamp is a server instant' },
  { file: 'src/finance-close.tsx', n: 2, cat: 'a', legacy: 'app.html:5305 → :1263', note: 'defaultPeriod — MYT, and the legacy comment names the 8am trap' },
  { file: 'src/finance-overview.tsx', n: 15, cat: 'a', legacy: 'app.html:1606-1617, :2107, :2143', note: 'todayMY is MYT; ovDates reads the MYT day back through a LOCAL Date on purpose' },
  { file: 'src/finance-qinv.tsx', n: 4, cat: 'a', legacy: 'app.html:1263, :4238', note: 'todayLocalISO is MYT; fmtDate parses at LOCAL midnight and reads back local' },
  { file: 'src/finance-users-audit.tsx', n: 1, cat: 'a', legacy: 'app.html:4919', note: 'bare toLocaleString() — no locale, no zone' },
  { file: 'src/finance-users-sessions.tsx', n: 2, cat: 'c', legacy: 'app.html:4695, :4697', note: 'epoch arithmetic against a `now` prop' },
  { file: 'src/finance-users-xero.tsx', n: 2, cat: 'a', legacy: 'app.html:4973, :4978', note: 'bare toLocaleString() on an instant; one is a NUMBER formatter' },
  { file: 'src/finance-users.tsx', n: 2, cat: 'a', legacy: 'app.html:4739-4744', note: 'relTime — epoch arithmetic, then toLocaleDateString with no zone' },
  // ---- HR screens -----------------------------------------------------------------------------
  { file: 'src/hr-attendance.tsx', n: 2, cat: 'a', legacy: 'hros.html:2908', note: 'v224: only hhmm/clkTime are left — dtLocal now delegates to myt.js and reads no clock here' },
  { file: 'src/hr-clock.tsx', n: 2, cat: 'a', legacy: 'hros.html:2908', note: 'hrClkTime — toLocaleTimeString, read under the harness zone override in its test' },
  { file: 'src/hr-leave.tsx', n: 6, cat: 'a', legacy: 'hros.html:1246', note: 'hrDT — +8h then getUTC*, MYT without a timezone database' },
  { file: 'src/hr-payroll.tsx', n: 6, cat: 'a', legacy: 'hros.html:3831, :4303-4304, :4309', note: 'dueInfo subtracts two LOCAL midnights but anchors "today" in MYT; fmt is BARE toLocale*' },
  { file: 'src/hr-profile.tsx', n: 6, cat: 'a', legacy: 'hros.html:1246', note: 'hrDT again — the second copy, identical' },
  { file: 'src/hr-yearend.tsx', n: 2, cat: 'a', legacy: 'hros.html:4921-4922', note: 'taxYears/defaultTaxYear — pure functions of a Date they are handed' },
];

/**
 * Files that USED to be in the inventory and now hold no date token at all, because v224 moved their
 * derivation into `myt.js`. Listed rather than deleted: "it stopped appearing" and "somebody removed the
 * feature" look identical in a diff, and each of these is asserted below to still import the shared
 * helper. myt.js itself is pinned in its own describe block — it is outside `web/`, so the scanner above
 * cannot see it, which is exactly why that block exists.
 */
const DELEGATED: { file: string; uses: string; was: string }[] = [
  { file: 'src/finance-export.ts', uses: 'mytISO', was: "UTC — app.html:5297's toISOString() named a 07:00 KL export for yesterday" },
  { file: 'src/finance-info.tsx', uses: 'mytISO', was: 'TWO clocks in one comparison — MYT vs the machine, common.js:27-28' },
  { file: 'src/finance-o2o.tsx', uses: 'mytISO', was: "LOCAL — app.html:2771's o2oToday(), the date on a batch posted into Xero" },
  { file: 'src/hr-calculator.tsx', uses: 'mytYMD', was: 'LOCAL — hros.html:4898, the month printed on an ad-hoc payslip' },
];

/**
 * WHAT: a derivation whose REWRITE is invisible on a UTC+8 runner, and the tokens that decide it.
 * `kind` is the rule the function follows; `must`/`mustNot` are checked against the function BODY.
 */
type Kind = 'MYT' | 'MYT_SHARED' | 'LOCAL' | 'UTC' | 'BARE';

const KIND_RULES: Record<Kind, { must: RegExp[]; mustNot: RegExp[] }> = {
  // Malaysia time WITHOUT a timezone database. `getFullYear()` would be the machine's zone and
  // `toISOString()` would be UTC — before 8am MYT, the previous day.
  MYT: {
    must: [/8 \* 3600000/, /getUTC/],
    mustNot: [/\.getFullYear\(|\.getMonth\(|\.getDate\(|\.getHours\(|\.getMinutes\(/, /toISOString|toLocale/],
  },
  // v224's kind: the same answer as MYT, delegated to myt.js. The body must reach the shared helper and
  // must carry no clock idiom of its own — a "simplification" back to a local getter, a toISOString or a
  // second copy of the +8h shift is exactly the defect, and every one of them is invisible at UTC+8.
  MYT_SHARED: {
    must: [/\bmyt[A-Z]/],
    mustNot: [/\.getFullYear\(|\.getMonth\(|\.getDate\(|\.getHours\(|\.getMinutes\(/, /toISOString|toLocale/, /8 \* 3600000/],
  },
  // The MACHINE's zone, and only where there is no zone to get wrong — a wall-clock string reparsed and
  // read straight back. Adding the +8h shift to one of these SHIFTS a date that was never an instant.
  LOCAL: {
    must: [/\.getFullYear\(/],
    mustNot: [/getUTC/, /8 \* 3600000/, /toISOString|toLocale/],
  },
  // UTC on purpose — a stamp on a document, not a date anyone picks.
  UTC: { must: [/toISOString\(\)/], mustNot: [/getUTC|8 \* 3600000|\.getFullYear\(|toLocale/] },
  // No locale and no timeZone, because the legacy has none. Adding either is an improvement that makes
  // the two renderers disagree — and it passes every output check on this fleet.
  BARE: { must: [/toLocale/], mustNot: [/timeZone/, /'en-/] },
};

const PINS: { file: string; fn: string; kind: Kind; legacy: string; why: string }[] = [
  { file: 'src/finance-close.tsx', fn: 'defaultPeriod', kind: 'MYT', legacy: 'app.html:5305', why: 'before 8am on the 1st, UTC pre-selects LAST month and the operator closes the wrong one' },
  { file: 'src/finance-qinv.tsx', fn: 'todayLocalISO', kind: 'MYT', legacy: 'app.html:1263', why: 'the date on an invoice posted to a real Xero ledger' },
  { file: 'app/finance/pnl/page.tsx', fn: 'todayLocalISO', kind: 'MYT', legacy: 'app.html:1263', why: 'the date in the exported P&L filename' },
  { file: 'app/finance/selfbill/page.tsx', fn: 'todayLocalISO', kind: 'MYT', legacy: 'app.html:1263', why: 'the invoice date on a self-billed payment' },
  { file: 'src/hr-leave.tsx', fn: 'hrDT', kind: 'MYT', legacy: 'hros.html:1246', why: 'when a leave request was filed' },
  { file: 'src/hr-profile.tsx', fn: 'hrDT', kind: 'MYT', legacy: 'hros.html:1246', why: 'the second copy of the same function' },

  // ── v224: everything below WAS the machine's zone (or UTC) and is now Malaysian, via myt.js ───────
  { file: 'app/hr/attendance/page.tsx', fn: 'thisMonth', kind: 'MYT_SHARED', legacy: 'hros.html:3040 → :1271', why: 'which month of attendance an admin opens on — on the 1st, the machine zone opened LAST month' },
  { file: 'app/hr/expenses/page.tsx', fn: 'today', kind: 'MYT_SHARED', legacy: 'hros.html:1840 → :1271', why: 'the claim date an employee files, and the claim PERIOD it lands in' },
  { file: 'app/hr/leave/page.tsx', fn: 'todayLocalISO', kind: 'MYT_SHARED', legacy: 'hros.html:3437 → :1271', why: 'the first and last day of somebody\'s leave' },
  { file: 'app/hr/payroll/page.tsx', fn: 'todayLocalISO', kind: 'MYT_SHARED', legacy: 'hros.html:4270 → :1271', why: 'the last-working-day default on a resignation, which prorates the final month' },
  { file: 'src/finance-o2o.tsx', fn: 'todayLocal', kind: 'MYT_SHARED', legacy: 'app.html:2771', why: 'the invoice date on an O2O batch — o2o_issue forwards it into Xero untouched' },
  { file: 'src/finance-o2o.tsx', fn: 'plusDaysLocal', kind: 'MYT_SHARED', legacy: 'app.html:2772', why: 'the due date 30 days after it' },
  { file: 'src/finance-export.ts', fn: 'exportFileName', kind: 'MYT_SHARED', legacy: 'app.html:5297', why: 'the date on a workbook of the company ledger that leaves the building' },
  { file: 'src/finance-info.tsx', fn: 'todayLocalISO', kind: 'MYT_SHARED', legacy: 'app.html:1264', why: 'the ⚠ half of the document-expiry comparison' },
  { file: 'src/finance-info.tsx', fn: 'inDaysLocalISO', kind: 'MYT_SHARED', legacy: 'common.js:27-28', why: 'the ⏳ half — it used to be a DIFFERENT clock from the line above, in one comparison' },
  { file: 'src/hr-attendance.tsx', fn: 'dtLocal', kind: 'MYT_SHARED', legacy: 'hros.html:3038', why: 'the wall time in the punch editor — the box an admin corrects, i.e. somebody\'s paid hours' },
];

describe('The timezone audit — the inventory is complete', () => {
  it('every date-token line in web/src and web/app is classified', () => {
    const known = new Set(INVENTORY.map((e) => e.file));
    const stray = [...new Set(HITS.map((h) => h.file))].filter((f) => !known.has(f));
    // A file that grew its first date read. Classify it in INVENTORY above — a/b/c and the legacy line
    // it was copied from — rather than deleting this assertion.
    expect(stray, 'unclassified date handling').toEqual([]);
  });

  it('no inventory entry outlives the code it describes', () => {
    const gone = INVENTORY.filter((e) => countOf(e.file) === 0).map((e) => e.file);
    expect(gone, 'inventory entry with no date handling left').toEqual([]);
  });

  it('the per-file counts still match — a NEW date read fails here until it is classified', () => {
    const drift = INVENTORY
      .filter((e) => countOf(e.file) !== e.n)
      .map((e) => `${e.file}: inventory says ${e.n}, source has ${countOf(e.file)}`);
    expect(drift, 'date handling changed').toEqual([]);
  });

  it('the money-formatter exclusion cannot hide a date', () => {
    // Every line the scanner skipped is `toLocaleString` on a NUMBER. If one ever isn't, it stops being
    // excluded rather than being quietly waved through.
    expect(MONEY_HITS.length).toBeGreaterThan(15);
    for (const m of MONEY_HITS) {
      expect(m.text, `${m.file}:${m.line}`).toMatch(/toLocaleString\('en-MY'/);
      expect(m.text, `${m.file}:${m.line}`).not.toMatch(/new Date|getUTC|toISOString|\.getFullYear\(/);
    }
  });

  it('guard the guard — the scanner really reads these files, and really strips comments', () => {
    // v224 moved four files' derivations into myt.js, so the total fell from 105 to ~99. The floor is a
    // scanner check, not a target — it exists so a walk() that stopped descending reads as a failure.
    expect(HITS.length).toBeGreaterThan(80);
    expect(INVENTORY.length).toBeGreaterThan(30);
    // finance-calendar.tsx QUOTES `new Date` in prose three times to explain why it never calls it. A
    // scanner that did not strip comments would inventory it; one that stripped too much would miss
    // every real hit.
    const cal = readFileSync(join(WEB, 'src', 'finance-calendar.tsx'), 'utf8');
    expect(cal).toMatch(/new Date/);
    expect(codeOnly(cal)).not.toMatch(DATE_TOKEN);
    expect(HITS.some((h) => h.file === 'src/finance-calendar.tsx')).toBe(false);
  });
});

describe('The timezone audit — the derivations are pinned at the source', () => {
  const bodyOf = (file: string, fn: string) => {
    const src = readFileSync(join(WEB, ...file.split('/')), 'utf8');
    const at = src.search(new RegExp(`(function|const) ${fn}\\b`));
    expect(at, `${fn} not found in ${file}`).toBeGreaterThan(-1);
    const end = src.indexOf('\n}', at);
    expect(end, `${fn} in ${file} has no closing brace at column 0`).toBeGreaterThan(at);
    // Comments stripped: several of these carry a doc comment naming the token they must not use.
    return codeOnly(src.slice(at, end));
  };

  for (const p of PINS) {
    const r = KIND_RULES[p.kind];
    it(`${p.file} · ${p.fn}() is ${p.kind} — ${p.legacy}`, () => {
      const body = bodyOf(p.file, p.fn);
      for (const m of r.must) expect(body, `${p.fn}: ${p.why}`).toMatch(m);
      for (const m of r.mustNot) expect(body, `${p.fn}: ${p.why}`).not.toMatch(m);
    });
  }

  it('the two todayLocalISO() are now the SAME function — v224 made HR OS Malaysian', () => {
    // THE TRAP THIS FILE WAS WRITTEN AROUND, CLOSED. hros.html:1271 used to be the MACHINE's zone while
    // app.html:1264 was MYT: one name, two apps, two answers. Both now delegate to myt.js. Pinned by the
    // legacy text so a "tidy-up" that re-inlines either one surfaces here rather than on someone's date
    // box — and note that re-inlining hros.html's ORIGINAL body is invisible on this fleet.
    const hros = readFileSync(join(REPO, 'hros.html'), 'utf8');
    const app = readFileSync(join(REPO, 'app.html'), 'utf8');
    expect(hros).toContain('function todayLocalISO(){ return mytISO(); }');
    expect(app).toContain('function todayLocalISO(){ return mytISO(); }');
    expect(hros).not.toContain("return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }");
    // Both apps must actually LOAD the file those now depend on, or every date box is a ReferenceError.
    for (const html of [hros, app]) expect(html).toContain('<script src="myt.js"></script>');
    // And the React ports followed the apps.
    expect(bodyOf('app/hr/expenses/page.tsx', 'today')).toMatch(/mytISO/);
    expect(bodyOf('src/finance-qinv.tsx', 'todayLocalISO')).toMatch(/getUTC/);   // still its own inline MYT copy
  });

  it('finance-qinv fmtDate() parses at LOCAL midnight and reads back LOCAL — the pairing is the point', () => {
    // app.html:4238. `new Date('2026-07-30')` is midnight UTC; `new Date('2026-07-30T00:00:00')` is
    // midnight where the browser is, and local getters read it back unshifted. Dropping the suffix, or
    // switching to getUTC*, prints the day before in half the world. Both halves pinned: either alone
    // is right on this fleet.
    const body = bodyOf('src/finance-qinv.tsx', 'fmtDate');
    expect(body).toContain("'T00:00:00'");
    expect(body).toMatch(/\.getDate\(\)/);
    expect(body).toMatch(/\.getMonth\(\)/);
    expect(body).toMatch(/\.getFullYear\(\)/);
    expect(body).not.toMatch(/getUTC|toLocale|toISOString/);
    expect(readFileSync(join(REPO, 'app.html'), 'utf8')).toContain("var dt=new Date(iso+'T00:00:00')");
  });

  it('finance-o2o plusDaysLocal() adds whole days to the INSTANT, then formats in Malaysia', () => {
    // app.html:2772 used to be `d.setDate(d.getDate()+n)` on a LOCAL Date. v224 made both halves MYT.
    // Plain ms arithmetic is the same answer as setDate in a fixed-offset zone (Malaysia has no DST, so
    // no day is 23 or 25 hours long) and mytISO does the month/year carry — which the output assertion
    // below drives across a month end. What must not come back is a LOCAL read-back: it is the same
    // answer here and the previous day in London.
    const app = readFileSync(join(REPO, 'app.html'), 'utf8');
    expect(app).toContain('function o2oPlusDays(n){ return mytISOPlusDays(n); }');
    expect(app).toContain('function o2oToday(){ return mytISO(); }');
  });

  it('the document stamps are MALAYSIAN in both renderers — v224 changed BOTH halves together', () => {
    // A stamp on a document produced in Malaysia. `toISOString()` said YESTERDAY for the first eight
    // hours of every working morning. Both the legacy and the React port moved in the same commit, so
    // the two renderers still agree — that agreement is the thing being checked, in both directions.
    const app = readFileSync(join(REPO, 'app.html'), 'utf8');
    for (const [file, legacy] of [
      ['app/finance/info/page.tsx', "printed '+todayLocalISO()+"],
      ['app/finance/qinv/page.tsx', "Preview · '+todayLocalISO()+"],
    ] as const) {
      expect(app, legacy).toContain(legacy);
      const src = codeOnly(readFileSync(join(WEB, ...file.split('/')), 'utf8'));
      expect(src).toContain('mytISO(Date.now())');
      expect(src, 'a UTC stamp came back').not.toContain('toISOString().slice(0, 10)');
    }
    expect(app, 'the export workbook filename').toContain("'_'+todayLocalISO()+'.xlsx'");
    expect(app, "the O2O zip filename").toContain('var stamp = todayLocalISO();');

    // The one toISOString that STAYS: hros.html:3085 posts the punch as an INSTANT, which is correct and
    // zone-free. What changed is how the datetime-local box is READ — see the round-trip block below.
    expect(readFileSync(join(REPO, 'hros.html'), 'utf8')).toContain('(mytFromDtLocal(ci)||new Date(ci)).toISOString()');
    const att = codeOnly(readFileSync(join(WEB, 'app', 'hr', 'attendance', 'page.tsx'), 'utf8'));
    expect(att).toContain('(mytFromDtLocal(ci) ?? new Date(ci)).toISOString()');
  });

  it('the three BARE toLocale* calls gain neither a locale nor a zone', () => {
    // app.html:4919 / :4978 and hros.html:4303-4304. Passing `Asia/Kuala_Lumpur` would be an
    // improvement and would make React and the legacy disagree about when a password was reset — and
    // it passes every output assertion on a UTC+8 runner.
    const app = readFileSync(join(REPO, 'app.html'), 'utf8');
    const hros = readFileSync(join(REPO, 'hros.html'), 'utf8');
    expect(app).toContain("var when=e.created_at?new Date(e.created_at).toLocaleString():''");
    expect(app).toContain("var when=e.received_at?new Date(e.received_at).toLocaleString():''");
    expect(hros).toContain("d.toLocaleDateString(undefined,{day:'numeric',month:'short'})");

    for (const [file, fn] of [
      ['src/finance-users-audit.tsx', 'auditWhen'],
      ['src/finance-users-xero.tsx', 'eventWhen'],
    ] as const) {
      const body = bodyOf(file, fn);
      expect(body).toContain('toLocaleString()');
      expect(body).not.toMatch(/timeZone|'en-/);
    }
    // hr-payroll's `fmt` is nested inside gridState(), so it is read as a slice rather than a function.
    const pay = codeOnly(readFileSync(join(WEB, 'src', 'hr-payroll.tsx'), 'utf8'));
    expect(pay).toContain("toLocaleDateString(undefined, { day: 'numeric', month: 'short' })");
    expect(pay).toContain("toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })");
    expect(pay).not.toMatch(/timeZone/);
  });

  it('hr-payroll dueInfo() still subtracts two LOCAL midnights, but "today" is now MALAYSIAN', () => {
    // Both halves matter and they are different halves. The SUBTRACTION stays between two local
    // midnights, so it is a whole number of days in every zone — rewriting either side with Date.UTC, or
    // comparing against a raw `now`, turns "28 days left" into 27 or 29 depending on the time of day.
    // The ANCHOR changed: which day "today" is, is Malaysia's, because the EPF/SOCSO deadline is a
    // Malaysian date and the machine's zone made the countdown a day out west of Greenwich.
    expect(readFileSync(join(REPO, 'hros.html'), 'utf8'))
      .toContain('var due=new Date(p.year, p.month, 15); var ty=mytYMD(); var t=new Date(ty.year, ty.month-1, ty.day);');
    const body = bodyOf('src/hr-payroll.tsx', 'dueInfo');
    expect(body).toContain('new Date(year, month, 15)');
    expect(body).toContain('mytYMD(now)');
    expect(body).toContain('new Date(my.year, my.month - 1, my.day)');
    expect(body, 'the anchor must not go back to the machine').not.toMatch(/now\.getFullYear\(/);
    expect(body).not.toMatch(/Date\.UTC|getUTC|toISOString/);
  });

  it('hr-attendance dtLocal() fills the datetime-local box in MALAYSIAN wall time, as hros.html:3038 now does', () => {
    // A `datetime-local` input carries wall time and NO zone, so what fills it and what reads it back are
    // ONE contract. The old pair was the machine's clock on both sides: it round-tripped, so no test saw
    // it, while showing an admin outside Malaysia an hour the punch was never at — and any correction on
    // that form re-posted the shifted instant. Someone's paid hours.
    const hros = readFileSync(join(REPO, 'hros.html'), 'utf8');
    expect(hros).toContain('function hrDtLocal(iso){ return mytDtLocal(iso); }');
    expect(hros, 'the machine-zone body came back').not.toContain("+'T'+p(d.getHours())+':'+p(d.getMinutes());");
    const body = bodyOf('src/hr-attendance.tsx', 'dtLocal');
    expect(body).toMatch(/mytDtLocal/);
    expect(body).not.toMatch(/getHours|getUTC|toISOString|toLocale/);
  });

  it('the clock-derived screens take the instant as an argument, never read it', () => {
    // hr.yearend's rule, applied to the five other pure components that derive from "now". A component
    // that read the clock itself renders one thing today and another on 1 January, and no golden moves.
    for (const [file, fn] of [
      ['src/hr-yearend.tsx', 'taxYears'],
      ['src/hr-yearend.tsx', 'defaultTaxYear'],
      ['src/finance-cfo.tsx', 'ytdYear'],
      ['src/finance-overview.tsx', 'todayLocalISO'],
      ['src/finance-overview.tsx', 'ovDates'],
      ['src/finance-close.tsx', 'defaultPeriod'],
      ['src/finance-qinv.tsx', 'todayLocalISO'],
      ['src/hr-payroll.tsx', 'dueInfo'],
      ['src/finance-o2o.tsx', 'todayLocal'],
    ] as const) {
      expect(bodyOf(file, fn), `${file} · ${fn}`).not.toMatch(/new Date\(\s*\)|Date\.now\(\)/);
    }
  });
});

/**
 * WHAT: a date read written INLINE — in a `useState` initialiser, a JSX expression, a one-line arrow —
 * where there is no function body to slice out. `code` is the exact source text that must survive, and
 * `legacy` is the line it mirrors.
 *
 * These exist because the first cut of this file pinned only the named helpers, and SEVEN rewrites then
 * passed the whole suite. Every entry below is one of them, or its sibling. See the PR.
 */
const SNIPPETS: { file: string; code: string; legacy: string; why: string }[] = [
  { file: 'app/hr/clock/page.tsx', code: "new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })", legacy: 'hros.html:2909', why: 'the running clock an employee punches against' },
  { file: 'src/finance-users.tsx', code: "d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })", legacy: 'app.html:4744', why: 'when a user was last seen' },
  // v224 turned these five from the machine's zone into Malaysia's. They stay in SNIPPETS because they
  // are inline reads with no function body to slice — which is exactly the shape the first cut of this
  // file missed, and the shape a "tidy-up" back to `now.getMonth()` would take.
  { file: 'app/hr/dashboard/page.tsx', code: 'load(pick ? pick.tenant_id : null, now.month, now.year, true)', legacy: 'hros.html:1727', why: 'the period the HR dashboard opens on' },
  { file: 'app/hr/calculator/page.tsx', code: "HR_MONTHS[nowMy.month] + ' ' + nowMy.year", legacy: 'hros.html:4907', why: 'the period stamped on a logged calculation' },
  { file: 'app/hr/payroll/page.tsx', code: 'useState(now.month)', legacy: 'hros.html:4058', why: 'the payroll month the screen opens on' },
  { file: 'app/hr/payroll/page.tsx', code: 'useState(now.year)', legacy: 'hros.html:4058', why: 'the payroll year the screen opens on' },
  { file: 'src/hr-calculator.tsx', code: 'const { month, year } = mytYMD(now)!;', legacy: 'hros.html:4898', why: 'the month printed on the calculator payslip PDF' },
  { file: 'src/finance-overview.tsx', code: "new Date(data.as_of).toLocaleString('en-GB', {", legacy: 'app.html:2107', why: 'how fresh the consolidated figures are' },
  { file: 'src/finance-overview.tsx', code: "new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })", legacy: 'app.html:2143', why: 'the #last-refresh clock in the shell' },
  { file: 'src/finance-cfo.tsx', code: "new Date(r.generated_at).toLocaleString('en-GB', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })", legacy: 'app.html:2080', why: 'when the analytics cache was built' },
  { file: 'src/hr-attendance.tsx', code: "d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })", legacy: 'hros.html:2908', why: 'the clock-in time on the attendance table — BARE, and pinned by the golden; see the header' },
  { file: 'src/hr-clock.tsx', code: "d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })", legacy: 'hros.html:2908', why: 'the clock-in time on the employee clock' },
];

describe('The timezone audit — the inline reads are pinned too', () => {
  for (const s of SNIPPETS) {
    it(`${s.file} keeps ${s.legacy}'s derivation verbatim`, () => {
      const src = codeOnly(readFileSync(join(WEB, ...s.file.split('/')), 'utf8'));
      // A rewrite to getUTC* / toISOString / a different formatter is invisible in the output on this
      // fleet, so what is checked is that the expression is still the one the legacy writes.
      expect(src, s.why).toContain(s.code);
    });
  }

  it('NOTHING in web/ passes a timeZone except finance.ap, whose legacy passes one', () => {
    // The single strongest line in this file. Adding `timeZone: 'Asia/Kuala_Lumpur'` to any of the nine
    // zone-less `toLocale*` calls above is an IMPROVEMENT — and it makes React and the legacy disagree
    // about when something happened, while passing every output assertion on a UTC+8 runner. Three of
    // those additions passed the whole suite before this assertion existed.
    //
    // `finance.ap` is the exception because app.html:6821/:6913/:6960 pass the zone themselves; that
    // screen's own test pins all three. Anything else appearing here is a decision, not a tidy-up.
    const carriers = [...walk(join(WEB, 'src')), ...walk(join(WEB, 'app'))]
      .filter((f) => /timeZone/.test(codeOnly(readFileSync(f, 'utf8'))))
      .map((f) => relative(WEB, f).split(sep).join('/'))
      .sort();
    expect(carriers).toEqual(['src/finance-ap.tsx']);
    expect([...codeOnly(readFileSync(join(WEB, 'src', 'finance-ap.tsx'), 'utf8'))
      .matchAll(/timeZone: 'Asia\/Kuala_Lumpur'/g)].length).toBe(2);   // its two DATE toLocale* calls
    // (app.html writes the zone at four sites — :6710, :6854, :6867 on the AP screen, which the two
    // helpers here cover between them, and :5106 inside `xeroSyncLoad()`'s Live AR audit panel, which
    // is one of the six advanced Xero tools that still hand off to the legacy app and so has no React
    // equivalent to carry it. `finance-ap.parity.test.tsx` asserts every toLocale* in that component
    // carries the zone; this assertion is about everything ELSE not gaining one.)
  });

  it('guard the guard — the timeZone sweep really reads the routes', () => {
    // If `walk` ever stopped descending into app/, the assertion above would pass vacuously.
    const seen = [...walk(join(WEB, 'src')), ...walk(join(WEB, 'app'))]
      .map((f) => relative(WEB, f).split(sep).join('/'));
    expect(seen).toContain('app/hr/clock/page.tsx');
    expect(seen).toContain('src/finance-ap.tsx');
    expect(seen.filter((f) => f.startsWith('app/')).length).toBeGreaterThan(30);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
   v224 — MALAYSIAN TIME IS DEFINED ONCE, AND IT IS DRIVEN, NOT JUST READ

   Everything above pins a SOURCE, because on a UTC+8 runner the output of a zone-blind rewrite is
   identical. The block below is the other half, and the two are only a proof TOGETHER:

     · the source pins catch a rewrite that this fleet cannot observe;
     · the OUTPUT assertions below catch it the moment the suite runs anywhere else, which the PR does
       (`TZ=America/New_York npm test`). Every expected string here is what Kuala Lumpur says, so a
       function rewritten with a local getter passes at UTC+8 and fails in New York — which is the whole
       point. A test that only passes at UTC+8 proves nothing about a timezone fix.
   ══════════════════════════════════════════════════════════════════════════════════════════════════ */

import { mytDate, mytDtLocal, mytFromDtLocal, mytISO, mytISOPlusDays, mytYMD } from '../../myt.js';

/** 02:14 UTC. In Kuala Lumpur that is 10:14 the SAME day; in New York it is 22:14 the day BEFORE. */
const MORNING = Date.parse('2026-08-18T02:14:00.000Z');
/** 23:40 UTC on the last day of a month — 07:40 on the 1st in KL, 19:40 on the 31st in New York. */
const MONTH_END = Date.parse('2026-08-31T23:40:00.000Z');

describe('v224 · Malaysian time is one function, and it answers the same in every zone', () => {
  it('mytISO() is Kuala Lumpur, whatever the machine says', () => {
    // Both of these are the defect in its purest form: at UTC+8 a machine-zone implementation returns
    // exactly these strings too, so ONLY a run outside UTC+8 separates them. The CI matrix and the PR
    // both run this file under TZ=America/New_York for that reason.
    expect(mytISO(MORNING)).toBe('2026-08-18');
    expect(mytISO(MONTH_END), 'a Malaysian morning is already the NEXT month').toBe('2026-09-01');
  });

  it('mytYMD() reports the Malaysian month, which is what a payroll/dashboard picker opens on', () => {
    expect(mytYMD(MONTH_END)).toEqual({ year: 2026, month: 9, day: 1 });
    expect(mytYMD(MORNING)).toEqual({ year: 2026, month: 8, day: 18 });
  });

  it('mytISOPlusDays() carries the month and the year in Malaysian days', () => {
    expect(mytISOPlusDays(0)).toBe(mytISO(Date.now()));
    // 90 days from a Malaysian 1 September. Driven through the same arithmetic the expiry badge uses.
    expect(mytISO(MONTH_END + 90 * 86400000)).toBe('2026-11-30');
  });

  it('mytDate() refuses what it cannot parse instead of returning an Invalid Date', () => {
    // `hrDtLocal('')` and `hrDtLocal(null)` are both reachable — the punch editor renders with clock_out
    // unset on every OPEN punch. A NaN Date here would print "NaN-NaN-NaN" into the box.
    expect(mytDate('not a date')).toBeNull();
    expect(mytISO('not a date')).toBe('');
    expect(mytDtLocal(null)).toBe('');
    expect(mytDtLocal(undefined as unknown as null)).not.toBe('');   // no argument = now, not empty
  });
});

describe('v224 · the punch editor round-trips — the pair, not the halves', () => {
  // THE HARM THIS FIXES. `hrDtLocal` fills a <input type="datetime-local"> and `hrAttSave` reads it back.
  // Both used to be the MACHINE's clock, which round-tripped perfectly and was therefore invisible to
  // every test — while showing an admin outside Malaysia an hour the punch was never at. Saving anything
  // on that form (a note, a break) re-posted the value in the box, so a correction MOVED the punch by the
  // viewer's offset. That is somebody's paid hours and their overtime.

  const INSTANTS = [
    '2026-08-18T02:14:00.000Z',   // 10:14 in KL
    '2026-08-31T23:40:00.000Z',   // 07:40 on 1 Sep in KL — the month AND the day differ from UTC
    '2026-01-01T16:00:00.000Z',   // midnight, 2 Jan, in KL — the YEAR differs
    '2026-06-30T20:00:00.000Z',   // 04:00 in KL
  ];

  it('what the box shows is Malaysian wall time', () => {
    expect(mytDtLocal('2026-08-18T02:14:00.000Z')).toBe('2026-08-18T10:14');
    expect(mytDtLocal('2026-08-31T23:40:00.000Z')).toBe('2026-09-01T07:40');
    expect(mytDtLocal('2026-01-01T16:00:00.000Z')).toBe('2026-01-02T00:00');
  });

  it('what is posted back is the SAME instant the row came in as', () => {
    for (const iso of INSTANTS) {
      const shown = mytDtLocal(iso);
      const back = mytFromDtLocal(shown);
      expect(back, shown).not.toBeNull();
      expect(back!.toISOString(), 'the punch moved: ' + iso + ' → ' + shown).toBe(iso);
    }
  });

  it('a typed correction moves the punch by exactly what was typed, and nothing else', () => {
    // The operator drags 10:14 back to 09:00. In Malaysia that is 01:00 UTC — not 01:00 plus whatever
    // the viewer's offset happens to be.
    expect(mytFromDtLocal('2026-08-18T09:00')!.toISOString()).toBe('2026-08-18T01:00:00.000Z');
  });

  it('an unparseable box is null, so the caller can fall back rather than post NaN', () => {
    // hros.html:3085 and the React route both spell it `mytFromDtLocal(ci) || new Date(ci)`. A punch
    // posted as "Invalid Date" is a 500 the operator reads as "save failed" with no idea why.
    expect(mytFromDtLocal('')).toBeNull();
    expect(mytFromDtLocal('18/08/2026 10:14')).toBeNull();
    expect(mytFromDtLocal('2026-08-18T10:14:37')).not.toBeNull();   // some browsers add seconds
  });
});

describe('v224 · the +8h shift is written in a KNOWN set of places, and myt.js is the one to add to', () => {
  const SHIFT = /8\s*\*\s*3600000/;

  /**
   * The inline copies that predate myt.js and were already CORRECT, so v224 did not churn them. Each is
   * pinned individually above (kind MYT). The point of listing them is the count: a NEW derivation must
   * import myt.js rather than spell the shift a tenth time, and this is what makes that fail.
   */
  const INLINE_MYT = [
    'app/finance/pnl/page.tsx',
    'app/finance/selfbill/page.tsx',
    'src/finance-cfo.tsx',
    'src/finance-close.tsx',
    'src/finance-overview.tsx',
    'src/finance-qinv.tsx',
    'src/hr-leave.tsx',
    'src/hr-profile.tsx',
  ];

  it('no file under web/ spells the shift except the eight that already did', () => {
    const carriers = [...walk(join(WEB, 'src')), ...walk(join(WEB, 'app'))]
      .filter((f) => SHIFT.test(codeOnly(readFileSync(f, 'utf8'))))
      .map((f) => relative(WEB, f).split(sep).join('/'))
      .sort();
    expect(carriers, 'a ninth inline copy of Malaysian time — import myt.js instead').toEqual(INLINE_MYT);
  });

  it('myt.js is the definition, and it is the only one in the shared root scripts', () => {
    const myt = readFileSync(join(REPO, 'myt.js'), 'utf8');
    expect(SHIFT.test(myt)).toBe(true);
    // Malaysia has no DST, so a fixed offset is correct AND needs no timezone database — which is why
    // the whole portal can agree on the day without Intl. Rewriting this with `timeZone:` would change
    // what every browser that lacks the tz data answers.
    expect(myt).toContain("d.getUTCFullYear()");
    expect(myt, 'a local getter in the definition itself').not.toMatch(/\.getFullYear\(|\.getMonth\(|\.getDate\(|\.getHours\(|\.getMinutes\(/);
    expect(myt, 'myt.js must not depend on a timezone database').not.toMatch(/toLocale|timeZone|Intl\./);
    // common.js is the file BOTH apps load; its two date helpers must go through myt.js, not their own.
    const common = readFileSync(join(REPO, 'common.js'), 'utf8');
    expect(common).toContain('function localISO(d){ return mytISO(d); }');
    expect(common).toContain('function inDaysLocalISO(days){ return mytISOPlusDays(days); }');
    expect(SHIFT.test(common), 'common.js grew its own copy of the shift').toBe(false);
  });

  it('the four files whose derivation moved into myt.js still reach it', () => {
    // Their date-token count is now zero, so the INVENTORY above cannot see them. Without this they
    // could lose the import entirely and the audit would report a clean sweep.
    for (const d of DELEGATED) {
      const src = codeOnly(readFileSync(join(WEB, ...d.file.split('/')), 'utf8'));
      expect(src, d.file + ' was ' + d.was).toContain("from '../../myt.js'");
      expect(src, d.file + ' should use ' + d.uses).toContain(d.uses);
    }
  });
});

describe('v224 · the carve-outs are still carved out', () => {
  it('hrFormEStats() still reads the machine zone — the captain decided, it is a FILED figure', () => {
    // NOT a miss. `new Date(join_date).getFullYear()` drops a 1 January hire west of Greenwich, and the
    // number it moves is declared to LHDN on Form E. Changing it needs finance sign-off, not a sweep.
    // If this assertion ever fails because somebody "finished the job", that is the conversation.
    const docs = readFileSync(join(REPO, 'hr-docs.js'), 'utf8');
    expect(docs).toContain('return e.join_date&&new Date(e.join_date).getFullYear()===year;');
    expect(docs).toContain('return e.resign_date&&new Date(e.resign_date).getFullYear()===year;');
    expect(docs, 'the carve-out lost its explanation').toContain('Changing it changes a declared');
    expect(docs, 'a statutory figure must not quietly start using myt.js').not.toMatch(/\bmyt[A-Z]/);
  });

  it('hrFmtDMY() is the SAME class and is raised, not converted', () => {
    // Found by this sweep. A cessation DATE printed on an EA form and written into CP8D, read with local
    // getters off `new Date('YYYY-MM-DD')` — midnight UTC — so west of Greenwich it declares the previous
    // day. `deno test --allow-read tests/` under a western zone fails on it today, BEFORE v224 and after.
    // Left alone under the same rule as hrFormEStats: it leaves the building.
    expect(readFileSync(join(REPO, 'hr-docs.js'), 'utf8'))
      .toContain("return p(x.getDate())+'-'+p(x.getMonth()+1)+'-'+x.getFullYear(); }");
  });
});
