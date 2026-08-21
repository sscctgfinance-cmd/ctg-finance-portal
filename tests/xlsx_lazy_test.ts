// `xlsx.full.min.js` is 952 KB and is NOT in Finance OS's <head> — every XLSX entry point loads it.
//
// WHY THIS FILE EXISTS: app.html used to carry `<script src="xlsx.full.min.js">` in the head, so every
// one of the 22 tabs paid 952 KB — 55% of the whole page — whether or not it could produce a
// spreadsheet. Five tabs touch XLSX; the rest never did. `gwLoadXlsx()` (app.html, in the Gateway
// section) already injected it on demand for Gateway and Sales Reconciliation, so the fix was to route
// the four remaining entry points through that same loader and drop the tag.
//
// The failure that fix can introduce is far worse than the slow page it removes: an export button that
// silently does nothing, because the callback never ran, or a ReferenceError on a cold page because a
// call site reaches `XLSX.` before anything asked for it. Nothing else in this repo would catch either —
// the render goldens capture a screen at t=0 and never press a button, and lint cannot see a runtime
// ReferenceError (which is the whole reason tests/render_harness.ts exists; read its header).
//
// So this file drives the four entry points through the real app under the stub DOM, on a page where
// XLSX is genuinely absent, and asserts the work COMPLETES once the script resolves — plus the two
// cases a hand-rolled second loader gets wrong: the first use on a fresh page, and two exports fired
// before the first fetch has landed.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { loadApp } from "./render_harness.ts";
import { inlineScript } from "../tools/extract.ts";

const HTML = await Deno.readTextFile(new URL("../app.html", import.meta.url));

// deno-lint-ignore no-explicit-any
type Any = any;

/** The <script> elements the app injected into <head>, in order. `makeEl().appendChild` records them. */
const injected = (): Any[] => ((globalThis as Any).document.head.children as Any[]);
const xlsxTags = () => injected().filter((s) => String(s.src || "").includes("xlsx"));

/**
 * A SheetJS stand-in. It records what was written, so "the export produced a file" is an assertion and
 * not an absence of errors — an export that silently does nothing throws nothing either.
 */
function stubXlsx(rows: unknown[][] = [["Date", "Description", "Amount"], ["2026-08-01", "PAYMENT", "125.50"]]) {
  const written: string[] = [];
  const sheets: unknown[] = [];
  return {
    written,
    sheets,
    api: {
      read: () => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } }),
      writeFile: (_wb: unknown, fn: string) => { written.push(fn); },
      utils: {
        book_new: () => ({}),
        table_to_sheet: (tb: unknown) => { sheets.push(tb); return {}; },
        aoa_to_sheet: () => ({}),
        book_append_sheet: () => {},
        sheet_to_json: () => rows,
      },
    },
  };
}

/** Resolve the pending injection the way the browser does: define the global, then fire onload. */
function resolveXlsx(api: unknown) {
  const tags = xlsxTags();
  assertEquals(tags.length, 1, "expected exactly one pending xlsx injection, saw " + tags.length);
  (globalThis as Any).XLSX = api;
  tags[0].onload();
}

/** A FileReader that hands the app a result synchronously — the harness's own stub never fires onload. */
function pinFileReader(result: unknown) {
  (globalThis as Any).FileReader = class {
    onload: Any = null;
    onerror: Any = null;
    result: unknown = result;
    readAsArrayBuffer() { this.onload?.({ target: { result } }); }
    readAsText() { this.onload?.({ target: { result } }); }
    readAsDataURL() { this.onload?.({ target: { result } }); }
  };
}

/**
 * Boot Finance OS with XLSX genuinely absent, run `body`, and put every global back afterwards.
 *
 * `settle()` before restore() is not tidiness: three of these entry points hand off to an async
 * continuation (`o2oEnrichWithPharmacyMaster`, `reconRun`, the `export_log` beacon), and a continuation
 * that resumes AFTER restore() paints into a globalThis with no `document` — an uncaught error that
 * fails the whole module rather than the test.
 */
async function withApp(body: (app: ReturnType<typeof loadApp>) => void, fixtures: Record<string, unknown> = {}) {
  delete (globalThis as Any).XLSX;
  const app = loadApp("app.html", fixtures);
  const realFR = (globalThis as Any).FileReader;
  try { body(app); await app.settle(); } finally {
    app.restore();
    (globalThis as Any).FileReader = realFR;
    delete (globalThis as Any).XLSX;
  }
}

Deno.test("Finance OS does not load the 952 KB spreadsheet engine on page load", async () => {
  // HTML comments stripped first — the head carries a comment SAYING the engine is not loaded there,
  // and a matcher that could not tell the two apart would be satisfied by the prose.
  assert(
    !/<script[^>]*\bsrc="xlsx\.full\.min\.js"/.test(HTML.replace(/<!--[\s\S]*?-->/g, "")),
    "app.html loads xlsx.full.min.js eagerly again — that is 952 KB on all 22 tabs, five of which use it",
  );
  await withApp((app) => {
    assertEquals(xlsxTags().length, 0, "booting app.html injected xlsx.full.min.js with no user action");
    assertEquals(app.exec("typeof XLSX"), "undefined", "XLSX is defined on a cold Finance page");
  });
});

Deno.test("⬇ Export loads the engine on first press, and the file is actually written", async () => {
  await withApp((app) => {
    // `exportCurrent()` reads the active tab's `table.bigtable`s and the company picker out of the DOM.
    app.seed("overview", { querySelectorAll: () => [{ tag: "table" }] });
    app.seed("company", { selectedIndex: 0, options: [{ text: "All companies" }] });

    app.exec("exportCurrent()");
    assertEquals(xlsxTags().length, 1, "the first Export press did not request the engine");
    assertEquals(app.exec("typeof XLSX"), "undefined", "Export ran before the engine had loaded");

    const x = stubXlsx();
    resolveXlsx(x.api);
    assertEquals(x.written.length, 1, "the engine loaded and the export produced NO file — a silent no-op");
    assert(/^CTG_overview_.*\.xlsx$/.test(x.written[0]), "unexpected export filename: " + x.written[0]);
    assertEquals(x.sheets.length, 1, "the table on screen did not reach the workbook");
  });
});

Deno.test("two exports fired before the engine lands share ONE fetch and BOTH produce a file", async () => {
  await withApp((app) => {
    app.seed("overview", { querySelectorAll: () => [{ tag: "table" }] });
    app.seed("company", { selectedIndex: 0, options: [{ text: "All companies" }] });

    app.exec("exportCurrent(); exportCurrent();");
    assertEquals(xlsxTags().length, 1, "the second press started a SECOND 952 KB download");

    const x = stubXlsx();
    resolveXlsx(x.api);
    assertEquals(x.written.length, 2, "a queued export was dropped — the second press did nothing at all");
  });
});

Deno.test("Bank Rec parses the statement after the engine loads, not before", async () => {
  await withApp((app) => {
    pinFileReader(new Uint8Array([1, 2, 3]).buffer);
    // A blank company stops reconRun() at its own guard, so this stays a test of the loader.
    app.seed("rc_co", { value: "" });
    app.exec("reconPick({files:[{name:'statement.xlsx'}]})");

    assertEquals(xlsxTags().length, 1, "picking a statement did not request the engine");
    assertEquals(app.exec("RECON_LINES"), null, "bankParse ran before the engine had loaded");

    resolveXlsx(stubXlsx().api);
    const lines = app.exec("RECON_LINES");
    assert(Array.isArray(lines) && lines.length === 1, "the statement was never parsed: " + JSON.stringify(lines));
  });
});

Deno.test("O2O parses the workbook after the engine loads, and re-parses on a company switch", async () => {
  await withApp((app) => {
    pinFileReader(new Uint8Array([1, 2, 3]).buffer);
    app.exec("O2O_TENANT='iprocare'");
    app.exec("o2oPick({files:[{name:'billing.xlsx'}]})");

    assertEquals(xlsxTags().length, 1, "picking a workbook did not request the engine");
    assertEquals(app.exec("O2O_DATA"), null, "o2oParse ran before the engine had loaded");

    // Rows shaped the way o2o.js's Package mode reads them, so a real parse produces a real pharmacy.
    const x = stubXlsx([
      ["Pharmacy", "Package", "Quantity", "Amount"],
      ["ALPHA PHARMACY", "PKG-A", 2, 100],
    ]);
    resolveXlsx(x.api);
    const parsed = app.exec("O2O_DATA");
    assert(parsed && typeof parsed === "object", "the workbook was never parsed: " + JSON.stringify(parsed));
    assert(
      !app.html("o2o-out").includes("Parse failed"),
      "the parse ran but failed: " + app.html("o2o-out"),
    );

    // Switching company re-parses the SAME buffer (SKU mode vs Package mode). The engine is cached now,
    // so this must NOT ask for a second copy — and must still re-parse.
    app.exec("O2O_DATA=null");
    app.exec("o2oOnTenantChange({value:'skindae'})");
    assertEquals(xlsxTags().length, 1, "the company switch downloaded the engine a second time");
    assert(app.exec("O2O_DATA") !== null, "the company switch did not re-parse — the preview is stale");
  });
});

Deno.test("a company switch loads the engine itself — the pick's own load can have failed", async () => {
  // This test exists because the obvious one does NOT cover this path. Reaching o2oOnTenantChange's
  // re-parse through o2oPick leaves the engine already cached, so unwrapping o2oOnTenantChange passes
  // every assertion above. The state that distinguishes them is O2O_BUF set while XLSX is absent, and it
  // is reachable: gwLoadXlsx's onerror clears the queue and toasts, so a workbook picked while the
  // network was down leaves exactly that. Unwrapped, the next company switch is a ReferenceError with
  // "Re-parse failed: XLSX is not defined" on screen instead of a second attempt at the download.
  await withApp((app) => {
    app.exec("O2O_TENANT='iprocare'; O2O_BUF=new Uint8Array([1,2,3]).buffer;");
    assertEquals(xlsxTags().length, 0, "seeding the buffer should not have loaded anything");

    app.exec("o2oOnTenantChange({value:'skindae'})");
    assertEquals(xlsxTags().length, 1, "the company switch did not request the engine");

    resolveXlsx(stubXlsx([["Pharmacy", "Package", "Quantity", "Amount"], ["ALPHA PHARMACY", "PKG-A", 2, 100]]).api);
    assert(app.exec("O2O_DATA") !== null, "the company switch never re-parsed");
    assert(!app.html("o2o-out").includes("Re-parse failed"), "re-parse failed: " + app.html("o2o-out"));
  });
});

Deno.test("Sales Reconciliation reads its files after the engine loads", async () => {
  await withApp((app) => {
    pinFileReader(new Uint8Array([1, 2, 3]).buffer);
    app.exec("srFiles([{name:'orders.xlsx'}])");
    assertEquals(xlsxTags().length, 1, "dropping a file did not request the engine");
    // Order Form headers, so the file is classified and the chip is filled in.
    const x = stubXlsx([["Order No", "Grand Total", "Package"], ["SO1", 100, "PKG-A"]]);
    resolveXlsx(x.api);
    assert(app.exec("!!SR.of"), "the engine loaded and the Order Form was never read");
  });
});

Deno.test("every XLSX call site in app.html is behind gwLoadXlsx", () => {
  // The runtime tests above cover the four entry points that exist TODAY. This is the guard against a
  // fifth: a bare `XLSX.` added to a function that nothing routes through the loader is a ReferenceError
  // on a cold page, and it will be found by an operator, not by a golden.
  //
  // Each name below is either wrapped in a `gwLoadXlsx(function(){…})` itself, or is a helper only
  // reachable from one that is. Adding a call site makes this fail: say which of the two it is.
  const REACHED_VIA: Record<string, string> = {
    o2oParse: "o2oPick / o2oOnTenantChange, both wrapped",
    srSheetRows: "srFiles (wrapped) and srBuild, which needs SR.of/SR.sf that only srFiles sets",
    srFiles: "wrapped",
    srBuild: "needs SR.of/SR.sf, which only srFiles' wrapped callback sets",
    srDownloadXlsx: "the #sr-result panel is .hide until srBuild has run",
    gwHandleFiles: "wrapped",
    exportCurrent: "wrapped",
    bankParse: "reconPick, wrapped",
  };

  const src = inlineScript(HTML);
  const found = new Set<string>();
  let fn = "(top level)";
  for (const line of src.split("\n")) {
    const m = /^(?:async\s+)?function\s+(\w+)\s*\(/.exec(line);
    if (m) fn = m[1];
    // Comment text only, dropped: three places in this file DESCRIBE `XLSX.utils…` in prose, and one of
    // them is the note on gwLoadXlsx itself. A `//` after a colon is a URL, not a comment.
    const code = line.replace(/^\s*\*.*$/, "").replace(/(^|[^:])\/\/.*$/, "$1");
    if (/\bXLSX\s*\./.test(code)) found.add(fn);
  }

  assertEquals(
    [...found].sort(),
    Object.keys(REACHED_VIA).sort(),
    "the set of functions touching XLSX changed — every one must be reachable only after gwLoadXlsx",
  );
});
