// ⬇ Export — the one-click Excel export, src/finance-export.ts.
//
// NO GOLDEN, and no markup at all: `exportCurrent()` (app.html:5275) renders nothing. It reads the DOM,
// writes a workbook and downloads a FILE. A file that leaves the building is the `bankFile()` case, so
// what is pinned here is what an operator ends up holding — the sheet names, the file name and the
// audit row — read against app.html's own text at run time, plus the route's scrape and dispatch pinned
// by SOURCE where they have no output to assert.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NOTHING_TO_EXPORT, companySlug, exportFileName, exportLogBody, registerScreenExport, screenExport,
  sheetName,
} from '../src/finance-export';
import { REPO } from './parity';

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');
const LAYOUT = readFileSync(join(import.meta.dirname, '..', 'app', 'finance', 'layout.tsx'), 'utf8');
const SRC = readFileSync(join(import.meta.dirname, '..', 'src', 'finance-export.ts'), 'utf8');

// ══ 1. The sheet names ════════════════════════════════════════════════════════════════════════════

describe('sheetName() — app.html:5285', () => {
  it('a single table is named for the tab, with no suffix', () => {
    expect(sheetName('approvals', 0, 1)).toBe('approvals');
  });

  it('several tables are numbered from 1', () => {
    expect(sheetName('ap', 0, 3)).toBe('ap_1');
    expect(sheetName('ap', 1, 3)).toBe('ap_2');
    expect(sheetName('ap', 2, 3)).toBe('ap_3');
  });

  // Excel refuses a sheet name over 31 characters and the whole workbook fails to write, so the slice
  // is not cosmetic. Driven AT the boundary rather than with a short name that proves nothing.
  it('is capped at 31 characters, suffix included', () => {
    const long = 'x'.repeat(40);
    expect(sheetName(long, 0, 1).length).toBe(31);
    expect(sheetName('y'.repeat(30), 4, 9)).toBe(('y'.repeat(30) + '_5').slice(0, 31));
    expect(sheetName('y'.repeat(30), 4, 9).length).toBe(31);
    expect(APP).toContain("(t+(tables.length>1?('_'+(i+1)):'')).slice(0,31)");
  });
});

// ══ 2. The file name ══════════════════════════════════════════════════════════════════════════════

describe('exportFileName() — app.html:5289-5290', () => {
  const D = new Date('2026-08-21T04:00:00.000Z');   // 12:00 MYT on the 21st

  it('is CTG_<tab>_<date>.xlsx with no company on the all-companies scope', () => {
    expect(exportFileName('approvals', '— All Companies —', D)).toBe('CTG_approvals_2026-08-21.xlsx');
    expect(exportFileName('approvals', '', D)).toBe('CTG_approvals_2026-08-21.xlsx');
  });

  it('carries the picked company, slugged', () => {
    expect(exportFileName('ap', 'CTG Nutrition (M) Sdn Bhd', D)).toBe('CTG_ap_CTG_Nutrition__M__Sdn_Bhd_2026-08-21.xlsx');
    expect(companySlug('CTG Nutrition (M) Sdn Bhd')).toBe('CTG_Nutrition__M__Sdn_Bhd');
    expect(APP).toContain("co.options[co.selectedIndex].text.replace(/[^A-Za-z0-9]/g,'_')");
  });

  // A legacy gap, mirrored not fixed: the "is this the all-companies option?" test is a substring
  // search for "All" on the SLUG, so a company whose name contains those three letters is dropped from
  // the file name too. Named here so a reader does not mistake it for a bug introduced by the port.
  it('any company whose slug contains "All" is dropped — app.html’s own test, mirrored', () => {
    expect(exportFileName('ap', 'Allied Holdings', D)).toBe('CTG_ap_2026-08-21.xlsx');
    expect(APP).toContain("coName.indexOf('All')<0");
  });

  /**
   * The date is UTC, which in MYT is the PREVIOUS day for the first eight hours of every morning.
   *
   * finance.calendar's finding: this cannot be caught by an output assertion taken on this machine or
   * on CI, both of which sit at UTC+8 — every figure agrees. It is driven by handing the function an
   * instant on the wrong side of midnight UTC, which is the only thing that distinguishes the two.
   */
  it('the date is UTC — an 07:00 MYT export is filed under YESTERDAY', () => {
    const earlyMyt = new Date('2026-09-01T00:30:00.000Z');   // 08:30 MYT on 1 Sep
    expect(exportFileName('pnl', '', earlyMyt)).toContain('2026-09-01');
    const beforeUtcMidnight = new Date('2026-08-31T23:30:00.000Z');   // 07:30 MYT on 1 Sep
    expect(exportFileName('pnl', '', beforeUtcMidnight)).toContain('2026-08-31');
    // …which is app.html's own behaviour, and the reason the instant is an ARGUMENT: a port that read
    // the clock with a LOCAL getter would "fix" it invisibly here and change what staff file.
    expect(APP).toContain("new Date().toISOString().slice(0,10)+'.xlsx'");
    expect(SRC).toContain("now.toISOString().slice(0, 10)");
    const body = SRC.slice(SRC.indexOf('export function exportFileName'));
    const fn = body.slice(0, body.indexOf('\n}'));
    for (const banned of ['Date.now', 'new Date', 'getFullYear', 'getMonth', 'getDate', 'toLocale']) {
      expect(fn, banned).not.toContain(banned);
    }
  });
});

// ══ 3. The audit row ══════════════════════════════════════════════════════════════════════════════

describe('exportLogBody() — app.html:5297', () => {
  it('is what an admin later reads to see who took a spreadsheet off the platform', () => {
    expect(exportLogBody('ap', 42, 'CTG_ap_2026-08-21.xlsx'))
      .toEqual({ api: 'export_log', what: 'ap', tab: 'ap', rows: 42, filename: 'CTG_ap_2026-08-21.xlsx' });
    // `what` and `tab` are the same string in the legacy; the server logs `what` as the audit TARGET
    // (finance.ts:2308) and keeps `tab` in the detail, so dropping either loses half the record.
    expect(APP).toContain("call({api:'export_log', what:t, tab:t, rows:rowsTotal, filename:fn})");
  });

  it('the row count is the tbody rows, and the route counts them per table', () => {
    expect(APP).toContain("rowsTotal += Math.max(0, tb.querySelectorAll('tbody tr').length);");
    expect(LAYOUT).toContain("tables.reduce((a, tb) => a + Math.max(0, tb.querySelectorAll('tbody tr').length), 0)");
  });
});

// ══ 4. The P&L special case ═══════════════════════════════════════════════════════════════════════

describe('the P&L dispatch — app.html:5277', () => {
  it('a registered screen exporter wins, and unregisters cleanly', () => {
    expect(screenExport()).toBe(null);
    let hits = 0;
    const off = registerScreenExport(() => { hits++; });
    screenExport()!();
    expect(hits).toBe(1);
    off();
    expect(screenExport()).toBe(null);
    // A stale unregister must not clear someone else's registration — a route unmounting after another
    // has mounted would otherwise leave the chrome scraping the P&L grid.
    const offA = registerScreenExport(() => {});
    registerScreenExport(() => { hits += 10; });
    offA();
    expect(screenExport()).not.toBe(null);
    screenExport()!();
    expect(hits).toBe(11);
    registerScreenExport(() => {})();
  });

  it('the P&L route registers its OWN CSV writer, not a generic one', () => {
    const pnl = readFileSync(join(import.meta.dirname, '..', 'app', 'finance', 'pnl', 'page.tsx'), 'utf8');
    expect(pnl).toContain('registerScreenExport(onExport)');
    // …and it is the same `onExport` the screen's own ⬇ Export CSV button uses, so the two controls
    // cannot produce different files.
    expect(pnl).toContain('onExport={onExport}');
    expect(APP).toContain("if(t==='pnl'){ pnlExportCsv(); return; }");
  });

  it('no OTHER route registers one — the dispatch is a single legacy special case', () => {
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (d.isDirectory()) walk(join(dir, d.name));
        else if (d.name === 'page.tsx') routes.push(join(dir, d.name));
      }
    };
    walk(join(import.meta.dirname, '..', 'app'));
    const registering = routes.filter((p) => readFileSync(p, 'utf8').includes('registerScreenExport'));
    expect(registering.map((p) => p.split('/app/')[1])).toEqual(['finance/pnl/page.tsx']);
  });
});

// ══ 5. The route's half, pinned by source ═════════════════════════════════════════════════════════

describe('the scrape and the refusal', () => {
  it('only `table.bigtable` is exported, and an empty screen refuses', () => {
    expect(NOTHING_TO_EXPORT).toBe('Nothing to export on this tab');
    expect(APP).toContain("toast('Nothing to export on this tab',true)");
    expect(APP).toContain("panel.querySelectorAll('table.bigtable')");
    expect(LAYOUT).toContain("querySelectorAll('table.bigtable')");
    expect(LAYOUT).toContain('toast(NOTHING_TO_EXPORT, true)');
  });

  // The scrape is scoped to the CURRENT screen. Widening it to `document` would put the chrome — and,
  // once another screen had rendered, another company's figures — into the workbook. app.html scopes it
  // to the active tab's own panel div; the React equivalent is the element the screen renders into.
  it('the scrape is scoped to the screen, not the document', () => {
    expect(LAYOUT).toContain('screen.current ? Array.from(screen.current.querySelectorAll');
    expect(LAYOUT).not.toContain('document.querySelectorAll(\'table.bigtable\')');
    expect(LAYOUT).toContain('<div ref={screen}>{children}</div>');
  });

  // The company is read back out of the picker, not from layout state — the same contract
  // app/finance/pnl/page.tsx relies on, and the reason the shell keeps the id `company`.
  it('the company name comes from the picker the operator can see', () => {
    expect(LAYOUT).toContain("document.getElementById('company') as HTMLSelectElement | null");
    expect(readFileSync(join(import.meta.dirname, '..', 'src', 'finance-shell.tsx'), 'utf8'))
      .toContain('<select id="company"');
  });

  // Nothing here loads xlsx eagerly: the layout injects the vendored file on first use, exactly as
  // app/finance/recon/page.tsx and app/finance/gateway/page.tsx already do. Pinned so this port does
  // not quietly become the thing that pulls 952 KB into every Finance page load.
  it('xlsx is injected on first use, never imported', () => {
    expect(LAYOUT).toContain("legacyUrl('xlsx.full.min.js')");
    expect(LAYOUT).not.toMatch(/^import .*xlsx/m);
    expect(LAYOUT).toContain('if (w.XLSX) return Promise.resolve(w.XLSX);');
  });

  /**
   * The refusal comes BEFORE the load, in both worlds.
   *
   * app.html's `exportCurrent()` was rewritten by #76 to go through `gwLoadXlsx()`, and it kept the
   * "Nothing to export" check above that call (app.html:5288-5289). A port that loaded first would
   * pull 952 KB in order to then say there is nothing to export — on the seventeen tabs that have no
   * `.bigtable` at all, which is most of them.
   */
  it('an empty screen refuses without downloading the engine', () => {
    const fn = LAYOUT.slice(LAYOUT.indexOf('const onExport = useCallback'));
    const body = fn.slice(0, fn.indexOf('}, [active]);'));
    expect(body.indexOf('NOTHING_TO_EXPORT')).toBeGreaterThan(-1);
    expect(body.indexOf('loadXlsx()')).toBeGreaterThan(-1);
    expect(body.indexOf('NOTHING_TO_EXPORT')).toBeLessThan(body.indexOf('loadXlsx()'));
    // …and the legacy agrees, after #76 moved that function behind the on-demand loader.
    const legacy = APP.slice(APP.indexOf('function exportCurrent()'));
    const lbody = legacy.slice(0, legacy.indexOf('\n}'));
    expect(lbody.indexOf("Nothing to export on this tab")).toBeLessThan(lbody.indexOf('gwLoadXlsx('));
  });

  /**
   * The layout's loader memoises the IN-FLIGHT promise, so two exports fired before the fetch lands
   * share one download and both produce a file — the property #76's `gwLoadXlsx()` queue exists for.
   * Note that `app/finance/o2o/page.tsx`'s `loadScript` does NOT have it; see CLAUDE.md.
   */
  it('two exports before the fetch lands share one download', () => {
    expect(LAYOUT).toContain('let xlsxPromise: Promise<Xlsx | null> | null = null;');
    expect(LAYOUT).toContain('if (!xlsxPromise) {');
    expect(LAYOUT).toContain('return xlsxPromise;');
    // A failed load clears the memo, so a retry after a dropped connection can succeed.
    expect(LAYOUT).toContain('s.onerror = () => { xlsxPromise = null; res(null); };');
  });
});

// ══ 6. Guard the guards ═══════════════════════════════════════════════════════════════════════════

describe('the guards still bite', () => {
  it('a local-getter date would pass every output check on this machine but fail the source pin', () => {
    const local = (now: Date) => now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const d = new Date('2026-08-31T23:30:00.000Z');
    // At UTC+8 the two disagree — which is exactly the divergence §2 drives.
    const differs = local(d) !== d.toISOString().slice(0, 10);
    const tzIsPlus8 = -new Date().getTimezoneOffset() === 480;
    if (tzIsPlus8) expect(differs).toBe(true);
    // And the source pin catches it regardless of where the test runs.
    const body = SRC.slice(SRC.indexOf('export function exportFileName'));
    expect(body.slice(0, body.indexOf('\n}'))).not.toContain('getDate');
  });

  it('a sheet-name cap of 32 would fail §1', () => {
    expect(('x'.repeat(40)).slice(0, 32).length).toBe(32);   // the defect
    expect(sheetName('x'.repeat(40), 0, 1).length).toBe(31);
  });
});
