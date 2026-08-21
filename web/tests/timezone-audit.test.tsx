// THE TIMEZONE AUDIT — every date read in `web/`, classified and pinned at the SOURCE.
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
//      LOCAL the MACHINE's zone — `getFullYear/getMonth/getDate` on a bare `new Date()`. hros.html's
//            own `todayLocalISO()` (hros.html:1271) is this, NOT app.html's. Two functions, one name,
//            two apps, two answers. Making the HR one "consistent" with the Finance one is a change to
//            what an HR operator's date box says.
//      UTC   `toISOString().slice(0,10)`. Deliberate in three places, all of them a stamp on a
//            document rather than a date an operator picks.
//      BARE  `toLocaleString()` with no locale and no `timeZone`. The legacy writes it that way in
//            three places. ADDING the zone is an improvement that makes the two renderers disagree
//            about when something happened — and it passes every output check on this fleet.
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
  { file: 'app/finance/info/page.tsx', n: 2, cat: 'a', legacy: 'app.html:5641, :5918', note: 'now for the expiry badge; printedOn is UTC toISOString, as the legacy is' },
  { file: 'app/finance/layout.tsx', n: 1, cat: 'a', legacy: 'app.html:5297', note: '⬇ Export hands the clock to exportFileName; the derivation is in src/finance-export.ts' },
  { file: 'app/finance/o2o/page.tsx', n: 6, cat: 'a', legacy: 'app.html:2771-2772', note: 'o2oToday/o2oPlusDays read the clock at call time; the route does the same' },
  { file: 'app/finance/ocr/page.tsx', n: 1, cat: 'c', legacy: 'app.html:6568', note: 'Date.now() in a download filename' },
  { file: 'app/finance/overview/page.tsx', n: 3, cat: 'a', legacy: 'app.html:1606, :2143', note: 'ovDates and the refresh stamp take Date.now(); both derivations are in src/' },
  { file: 'app/finance/pnl/page.tsx', n: 2, cat: 'a', legacy: 'app.html:1263 via :4525', note: 'todayLocalISO for the CSV filename — MYT' },
  { file: 'app/finance/qinv/page.tsx', n: 5, cat: 'a', legacy: 'app.html:3204, :4230, :4315, :4161', note: 'date default + POST date are MYT; the preview stamp is UTC; two are a cache TTL' },
  { file: 'app/finance/selfbill/page.tsx', n: 2, cat: 'a', legacy: 'app.html:3977', note: 'invoice-date default — MYT' },
  { file: 'app/finance/upload/page.tsx', n: 1, cat: 'c', legacy: 'app.html:2481', note: 'Date.now() in a scan filename' },
  { file: 'app/finance/users/page.tsx', n: 2, cat: 'c', legacy: 'app.html:4695, :4739', note: 'Date.now() handed to relSec/relTime as a prop — epoch arithmetic' },
  // ---- HR routes ------------------------------------------------------------------------------
  { file: 'app/hr/attendance/page.tsx', n: 4, cat: 'a', legacy: 'hros.html:3040, :3085', note: 'month default is the MACHINE zone; the punch is toISOString, as the legacy posts it' },
  { file: 'app/hr/calculator/page.tsx', n: 3, cat: 'a', legacy: 'hros.html:4897-4898, :4906-4907', note: 'the payslip period — the clock read lifted out of the component' },
  { file: 'app/hr/clock/page.tsx', n: 4, cat: 'a', legacy: 'hros.html:2909-2910', note: 'the ticking clock; elapsed is epoch arithmetic' },
  { file: 'app/hr/dashboard/page.tsx', n: 2, cat: 'a', legacy: 'hros.html:1727', note: 'first-paint month/year default' },
  { file: 'app/hr/expenses/page.tsx', n: 2, cat: 'a', legacy: 'hros.html:1840 → :1271', note: 'hrToday — the MACHINE zone, and the legacy comment says why' },
  { file: 'app/hr/leave/page.tsx', n: 2, cat: 'a', legacy: 'hros.html:3437 → :1271', note: 'the apply-on-behalf date default — the MACHINE zone' },
  { file: 'app/hr/payroll/page.tsx', n: 6, cat: 'a', legacy: 'hros.html:4058, :4270, :3831', note: 'month/year default, the resign-date default, and dueInfo' },
  { file: 'app/hr/yearend/page.tsx', n: 2, cat: 'a', legacy: 'hros.html:4921-4922', note: 'taxYears/defaultTaxYear — the clock read lifted out of the component' },
  // ---- Finance screens ------------------------------------------------------------------------
  { file: 'src/finance-ap.tsx', n: 2, cat: 'a', legacy: 'app.html:6821, :6913, :6960', note: 'the only screen whose legacy passes timeZone explicitly — pinned in its own test' },
  { file: 'src/finance-cfo.tsx', n: 2, cat: 'a', legacy: 'app.html:1862, :2080', note: 'ytdYear is MYT; the analytics stamp is a server instant' },
  { file: 'src/finance-close.tsx', n: 2, cat: 'a', legacy: 'app.html:5305 → :1263', note: 'defaultPeriod — MYT, and the legacy comment names the 8am trap' },
  { file: 'src/finance-export.ts', n: 1, cat: 'a', legacy: 'app.html:5297', note: 'the export filename is UTC toISOString, as the legacy is — pinned in its own test' },
  { file: 'src/finance-info.tsx', n: 5, cat: 'a', legacy: 'app.html:1263, common.js:27-28', note: 'TWO clocks that are not the same one — pinned in its own test' },
  { file: 'src/finance-o2o.tsx', n: 3, cat: 'a', legacy: 'app.html:2771-2772', note: 'todayLocal/plusDaysLocal — the MACHINE zone' },
  { file: 'src/finance-overview.tsx', n: 15, cat: 'a', legacy: 'app.html:1606-1617, :2107, :2143', note: 'todayMY is MYT; ovDates reads the MYT day back through a LOCAL Date on purpose' },
  { file: 'src/finance-qinv.tsx', n: 4, cat: 'a', legacy: 'app.html:1263, :4238', note: 'todayLocalISO is MYT; fmtDate parses at LOCAL midnight and reads back local' },
  { file: 'src/finance-users-audit.tsx', n: 1, cat: 'a', legacy: 'app.html:4919', note: 'bare toLocaleString() — no locale, no zone' },
  { file: 'src/finance-users-sessions.tsx', n: 2, cat: 'c', legacy: 'app.html:4695, :4697', note: 'epoch arithmetic against a `now` prop' },
  { file: 'src/finance-users-xero.tsx', n: 2, cat: 'a', legacy: 'app.html:4973, :4978', note: 'bare toLocaleString() on an instant; one is a NUMBER formatter' },
  { file: 'src/finance-users.tsx', n: 2, cat: 'a', legacy: 'app.html:4739-4744', note: 'relTime — epoch arithmetic, then toLocaleDateString with no zone' },
  // ---- HR screens -----------------------------------------------------------------------------
  { file: 'src/hr-attendance.tsx', n: 4, cat: 'a', legacy: 'hros.html:2908, :3038', note: 'hhmm is toLocaleTimeString; dtLocal fills a datetime-local input in the MACHINE zone' },
  { file: 'src/hr-calculator.tsx', n: 1, cat: 'a', legacy: 'hros.html:4898', note: 'the payslip period, off a Date the component is HANDED' },
  { file: 'src/hr-clock.tsx', n: 2, cat: 'a', legacy: 'hros.html:2908', note: 'hrClkTime — toLocaleTimeString, read under the harness zone override in its test' },
  { file: 'src/hr-leave.tsx', n: 6, cat: 'a', legacy: 'hros.html:1246', note: 'hrDT — +8h then getUTC*, MYT without a timezone database' },
  { file: 'src/hr-payroll.tsx', n: 6, cat: 'a', legacy: 'hros.html:3831, :4303-4304, :4309', note: 'dueInfo at LOCAL midnight; fmt is toLocale* with locale `undefined`' },
  { file: 'src/hr-profile.tsx', n: 6, cat: 'a', legacy: 'hros.html:1246', note: 'hrDT again — the second copy, identical' },
  { file: 'src/hr-yearend.tsx', n: 2, cat: 'a', legacy: 'hros.html:4921-4922', note: 'taxYears/defaultTaxYear — pure functions of a Date they are handed' },
];

/**
 * WHAT: a derivation whose REWRITE is invisible on a UTC+8 runner, and the tokens that decide it.
 * `kind` is the rule the function follows; `must`/`mustNot` are checked against the function BODY.
 */
type Kind = 'MYT' | 'LOCAL' | 'UTC' | 'BARE';

const KIND_RULES: Record<Kind, { must: RegExp[]; mustNot: RegExp[] }> = {
  // Malaysia time WITHOUT a timezone database. `getFullYear()` would be the machine's zone and
  // `toISOString()` would be UTC — before 8am MYT, the previous day.
  MYT: {
    must: [/8 \* 3600000/, /getUTC/],
    mustNot: [/\.getFullYear\(|\.getMonth\(|\.getDate\(|\.getHours\(|\.getMinutes\(/, /toISOString|toLocale/],
  },
  // The MACHINE's zone, deliberately. Adding the +8h shift changes what an HR operator's date box says.
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

  { file: 'app/hr/attendance/page.tsx', fn: 'thisMonth', kind: 'LOCAL', legacy: 'hros.html:3040 → :1271', why: 'hros.html\'s todayLocalISO is LOCAL, not app.html\'s MYT — same name, different function' },
  { file: 'app/hr/expenses/page.tsx', fn: 'today', kind: 'LOCAL', legacy: 'hros.html:1840 → :1271', why: 'the claim date an employee files' },
  { file: 'app/hr/leave/page.tsx', fn: 'todayLocalISO', kind: 'LOCAL', legacy: 'hros.html:3437 → :1271', why: 'the apply-on-behalf date range' },
  { file: 'app/hr/payroll/page.tsx', fn: 'todayLocalISO', kind: 'LOCAL', legacy: 'hros.html:4270 → :1271', why: 'the last-working-day default on a resignation' },
  { file: 'src/finance-o2o.tsx', fn: 'todayLocal', kind: 'LOCAL', legacy: 'app.html:2771', why: 'the invoice date on an O2O batch' },

  // The first UTC landing. app.html:5297 names the exported workbook with `toISOString()`, so on a
  // Malaysian morning the file is stamped YESTERDAY — mirrored, because renaming an export changes what
  // staff have been filing. `exportFileName` takes the instant as an ARGUMENT so the divergence is
  // drivable here; the screen's own test drives it, and this pins the implementation the same way.
  { file: 'src/finance-export.ts', fn: 'exportFileName', kind: 'UTC', legacy: 'app.html:5297', why: 'the date on a workbook of the company ledger that leaves the building' },
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
    expect(HITS.length).toBeGreaterThan(100);
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

  it('the two todayLocalISO() are NOT the same function, and neither app was made consistent', () => {
    // hros.html:1271 is the MACHINE's zone; app.html:1263 is MYT by construction. Both are pinned by
    // their legacy text so a "tidy-up" in either app surfaces here rather than on someone's date box.
    const hros = readFileSync(join(REPO, 'hros.html'), 'utf8');
    const app = readFileSync(join(REPO, 'app.html'), 'utf8');
    expect(hros).toContain("function todayLocalISO(){ const d=new Date(); const p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }");
    expect(app).toContain("function todayLocalISO(){ const d=new Date(Date.now()+8*3600000); const p=n=>String(n).padStart(2,'0'); return d.getUTCFullYear()+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate()); }");
    // And the React ports followed each app, not each other.
    expect(bodyOf('app/hr/expenses/page.tsx', 'today')).not.toMatch(/getUTC/);
    expect(bodyOf('src/finance-qinv.tsx', 'todayLocalISO')).toMatch(/getUTC/);
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

  it('finance-o2o plusDaysLocal() moves the day THEN formats, and formats through todayLocal()', () => {
    // app.html:2772 is `d.setDate(d.getDate()+n)` on a LOCAL Date, then the same local read-back. The
    // React version delegates the read-back to `todayLocal`, which is why it carries no getters of its
    // own — so what is pinned here is that it neither shifts by +8h nor formats a second way. A second
    // formatter is a second answer, and on this fleet the two agree.
    expect(readFileSync(join(REPO, 'app.html'), 'utf8'))
      .toContain("function o2oPlusDays(n){ var d=new Date(); d.setDate(d.getDate()+n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }");
    const body = bodyOf('src/finance-o2o.tsx', 'plusDaysLocal');
    expect(body).toContain('setDate');
    expect(body).toContain('todayLocal(');
    expect(body).not.toMatch(/getUTC|8 \* 3600000|toISOString|toLocale/);
  });

  it('the three UTC stamps stay UTC, because the legacy stamps are UTC', () => {
    // A document stamp, not a date anyone picks. `todayLocalISO()` here would be an improvement that
    // silently changes what a printed report and a posted invoice claim about themselves.
    const app = readFileSync(join(REPO, 'app.html'), 'utf8');
    for (const [file, legacy] of [
      ['app/finance/info/page.tsx', "printed '+(new Date().toISOString().slice(0,10))"],
      ['app/finance/qinv/page.tsx', "Preview · '+new Date().toISOString().slice(0,10)"],
    ] as const) {
      expect(app, legacy).toContain(legacy);
      expect(codeOnly(readFileSync(join(WEB, ...file.split('/')), 'utf8'))).toContain("new Date().toISOString().slice(0, 10)");
    }
    // hros.html:3085 posts the punch as an instant, so the React route must too.
    expect(readFileSync(join(REPO, 'hros.html'), 'utf8')).toContain("clock_in:new Date(ci).toISOString()");
    const att = codeOnly(readFileSync(join(WEB, 'app', 'hr', 'attendance', 'page.tsx'), 'utf8'));
    expect(att).toContain('clock_in: new Date(ci).toISOString()');
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

  it('hr-payroll dueInfo() compares two LOCAL midnights, as hros.html:3831 does', () => {
    // `new Date(year, month, 15)` and `new Date(y, m, d)` are both local midnight, so the subtraction is
    // a whole number of days in every zone. Rewriting either with Date.UTC, or comparing against a raw
    // `now`, turns "28 days left" into 27 or 29 depending on the time of day.
    expect(readFileSync(join(REPO, 'hros.html'), 'utf8'))
      .toContain('var due=new Date(p.year, p.month, 15); var t=new Date(); t=new Date(t.getFullYear(),t.getMonth(),t.getDate());');
    const body = bodyOf('src/hr-payroll.tsx', 'dueInfo');
    expect(body).toContain('new Date(year, month, 15)');
    expect(body).toContain('new Date(now.getFullYear(), now.getMonth(), now.getDate())');
    expect(body).not.toMatch(/Date\.UTC|getUTC|toISOString/);
  });

  it('hr-attendance dtLocal() fills a datetime-local input in the MACHINE zone, as hros.html:3038 does', () => {
    // A `datetime-local` input has no zone, so the value must be wall time where the browser is. Reading
    // the server's instant back with getUTC* would show a punch in the wrong hour for everyone outside
    // Malaysia — and identically on this fleet.
    expect(readFileSync(join(REPO, 'hros.html'), 'utf8'))
      .toContain("return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());");
    const body = bodyOf('src/hr-attendance.tsx', 'dtLocal');
    expect(body).toMatch(/\.getHours\(\)/);
    expect(body).toMatch(/\.getMinutes\(\)/);
    expect(body).not.toMatch(/getUTC|toISOString|toLocale/);
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
  { file: 'app/hr/dashboard/page.tsx', code: 'now.getMonth() + 1, now.getFullYear()', legacy: 'hros.html:1727', why: 'the period the HR dashboard opens on' },
  { file: 'app/hr/calculator/page.tsx', code: "HR_MONTHS[now.getMonth() + 1] + ' ' + now.getFullYear()", legacy: 'hros.html:4907', why: 'the period stamped on a logged calculation' },
  { file: 'app/hr/payroll/page.tsx', code: 'useState(now.getMonth() + 1)', legacy: 'hros.html:4058', why: 'the payroll month the screen opens on' },
  { file: 'app/hr/payroll/page.tsx', code: 'useState(now.getFullYear())', legacy: 'hros.html:4058', why: 'the payroll year the screen opens on' },
  { file: 'src/hr-calculator.tsx', code: 'const month = now.getMonth() + 1, year = now.getFullYear();', legacy: 'hros.html:4898', why: 'the month printed on the calculator payslip PDF' },
  { file: 'src/finance-overview.tsx', code: "new Date(data.as_of).toLocaleString('en-GB', {", legacy: 'app.html:2107', why: 'how fresh the consolidated figures are' },
  { file: 'src/finance-overview.tsx', code: "new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })", legacy: 'app.html:2143', why: 'the #last-refresh clock in the shell' },
  { file: 'src/finance-cfo.tsx', code: "new Date(r.generated_at).toLocaleString('en-GB', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })", legacy: 'app.html:2080', why: 'when the analytics cache was built' },
  { file: 'src/hr-attendance.tsx', code: "d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })", legacy: 'hros.html:2908', why: 'the clock-in time on the attendance table' },
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
