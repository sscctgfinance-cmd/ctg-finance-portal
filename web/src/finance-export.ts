// ⬇ Export — the one-click Excel export behind the Finance company bar's Export control.
//
// A port of `exportCurrent()` (app.html:5275-5302). Until now the React control was an ANCHOR into
// app.html#tab=<id>, so an operator who wanted the spreadsheet left the app and re-loaded the screen.
//
// ── WHAT IS PURE HERE AND WHY ──────────────────────────────────────────────────────────────────────
// `exportCurrent()` is three things welded together: a DOM scrape, a workbook write, and the naming.
// The scrape and `XLSX.writeFile` stay in the route — they need a document and a 952 KB vendored library
// — and everything with ONE right answer is here: the sheet names, the file name, and the audit body.
// A file name is not cosmetic; it is what an operator files, mails and is later asked to produce.
//
// ── THE FILE NAME'S DATE WAS UTC, AND v224 MADE IT MALAYSIAN ───────────────────────────────────────
// app.html:5297 was `new Date().toISOString().slice(0,10)` — the UTC date — while this repo's own
// `todayLocalISO()` (app.html:1264) exists precisely because MYT is UTC+8 and the two disagree for the
// first eight hours of every day. So an export taken at 07:00 on the 1st was filed under the LAST day of
// the previous month, which on a month-end close is the difference between the right period and the
// wrong one. Both halves changed together (app.html and here), so the two renderers still agree.
//
// This is a DATE on a file, not a figure IN one: nothing inside the workbook moved. The statutory
// figures that genuinely must not change without finance sign-off are named in CLAUDE.md.
// `now` stays an ARGUMENT (hr.yearend's `taxYears(now)` rule) so the divergence is drivable on a
// UTC+8 machine rather than being a property of whichever machine ran the test.
//
// ── THE 952 KB xlsx BUNDLE IS SOMEONE ELSE'S CHANGE ────────────────────────────────────────────────
// Nothing here loads it. The route injects `xlsx.full.min.js` on first use, exactly as
// app/finance/recon/page.tsx and app/finance/gateway/page.tsx already do, so this port neither helps nor
// hinders the in-flight lazy-loading work; see the PR.

import { mytISO } from '../../myt.js';

/** `exportCurrent()`'s sheet name — app.html:5285. Excel refuses a sheet name over 31 characters. */
export function sheetName(tab: string, i: number, count: number): string {
  return (tab + (count > 1 ? '_' + (i + 1) : '')).slice(0, 31);
}

/** The company picker's own text, slugged — app.html:5289. */
export function companySlug(optionText: string): string {
  return (optionText || '').replace(/[^A-Za-z0-9]/g, '_');
}

/**
 * `exportCurrent()`'s file name — app.html:5290.
 *
 * `now` is an ARGUMENT, not a clock read, so the UTC-vs-MYT divergence above is testable rather than a
 * property of whichever machine ran it. The company is appended only when one is picked: the slug of
 * "— All Companies —" contains "All", which is what the legacy's `indexOf('All')<0` test is really
 * asking. A company literally named "Allied" would therefore be dropped from the name too — mirrored,
 * because a file name that changed under a migration is a filing that stops matching its neighbours.
 */
export function exportFileName(tab: string, companyText: string, now: Date): string {
  const co = companySlug(companyText);
  return 'CTG_' + tab + (co && co.indexOf('All') < 0 ? '_' + co : '') + '_' + mytISO(now) + '.xlsx';
}

/**
 * `{api:'export_log', …}` — app.html:5297, the fire-and-forget audit row.
 *
 * It is how an admin later sees WHO took a spreadsheet of the company's ledger off the platform
 * (`logAudit(me,"data_export",…)`, finance.ts:2308), so the row count and the file name are part of the
 * record, not decoration. `what` and `tab` are the same string in the legacy and stay that way.
 */
export function exportLogBody(tab: string, rows: number, filename: string): Record<string, unknown> {
  return { api: 'export_log', what: tab, tab, rows, filename };
}

/** `exportCurrent()`'s refusal — app.html:5279. No `.bigtable` on the screen means nothing to write. */
export const NOTHING_TO_EXPORT = 'Nothing to export on this tab';

/**
 * `exportCurrent()`'s one special case — app.html:5277.
 *
 * "The P&L grid isn't a .bigtable (sticky layout) — it has its own raw-number CSV writer." In React that
 * writer is the P&L screen's own ⬇ Export CSV button, so the screen registers it here on mount and the
 * chrome control calls it, which is the same dispatch the legacy makes by name. A registration is the
 * only honest option: the shell cannot reach a screen's model, and scraping the grid would export
 * FORMATTED cells where the legacy exports raw numbers — a spreadsheet whose figures cannot be summed.
 */
let screenExporter: (() => void) | null = null;

/** Called from a screen's route on mount; the returned function unregisters it. */
export function registerScreenExport(fn: () => void): () => void {
  screenExporter = fn;
  return () => { if (screenExporter === fn) screenExporter = null; };
}

export function screenExport(): (() => void) | null {
  return screenExporter;
}
