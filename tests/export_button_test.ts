// The export buttons actually produce a file — driven, not rendered.
//
// WHY THIS FILE EXISTS: ⬇ CSV on the Attendance screen threw
// `TypeError: arr.map is not a function` on its FIRST cell and downloaded nothing. It shipped that way
// and the operator found it. `hrCsv` (hr-docs.js:108) takes the WHOLE 2-D array and returns the finished
// CSV; hrAttExport called `rows.map(r => r.map(hrCsv).join(','))`, handing it one CELL at a time — a
// string, which has no `.map`.
//
// Nothing in this repo could see it. `deno lint` cannot see a runtime TypeError. The 51 render goldens
// capture each screen at t=0 and NEVER PRESS A BUTTON, so `tests/golden/hr.attendance.html` was green
// throughout — the same blind spot tests/xlsx_lazy_test.ts exists for, in a second place. The only
// witness was the error beacon, i.e. a real person clicking it in production.
//
// So this drives the export functions themselves, with `hrDownload` swapped for a recorder, and asserts
// what they hand it. An export that throws records nothing; an export that produces the wrong SHAPE
// records the wrong bytes. Both fail here.

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { loadApp } from "./render_harness.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** Load hros.html, replace hrDownload with a recorder, and hand back a driver. */
function withRecorder(seed: string) {
  const app = loadApp("hros.html");
  app.exec(`
    globalThis.__dl = [];
    hrDownload = function(name, text, mime){ globalThis.__dl.push({ name: name, text: text, mime: mime }); };
    ${seed}
  `);
  return {
    app,
    fire(code: string) { app.exec(code); },
    files(): { name: string; text: string }[] { return app.exec(`globalThis.__dl`) as Any; },
  };
}

const PUNCHES = `[
  { id:'p1', work_date:'2026-08-31', clock_in:'2026-08-31T12:30:00Z', clock_out:'2026-08-31T16:16:00Z',
    hours:3.76, break_minutes:0, source:'self', status:'ok', note:'',
    hr_employees:{ name:'KHOR SIEW CHIN', emp_no:'E010' } },
  { id:'p2', work_date:'2026-08-30', clock_in:'2026-08-30T02:00:00Z', clock_out:'2026-08-30T15:01:00Z',
    hours:13.01, break_minutes:30, source:'self', status:'ok', note:'late, traffic on the LDP',
    hr_employees:{ name:'AUWINGKEIKEI&KUEKMEIFONG', emp_no:'E007' } }
]`;

Deno.test("Attendance ⬇ CSV produces a file — the button that threw and downloaded nothing", () => {
  const d = withRecorder(`ATT.month = '2026-08'; ATT.data = { punches: ${PUNCHES} };`);
  d.fire(`hrAttExport()`);

  const files = d.files();
  assertEquals(files.length, 1,
    "hrAttExport() handed hrDownload nothing. It used to call hrCsv once per CELL — hrCsv takes the " +
    "whole 2-D array, so it threw `arr.map is not a function` on the first cell and the button did " +
    "nothing at all, while every golden stayed green.");
  assertEquals(files[0].name, "Attendance_2026-08.csv");

  const lines = files[0].text.trim().split(/\r?\n/);
  assertEquals(lines.length, 3, "one header + one row per punch");
  assertEquals(lines[0], "Date,Employee,Emp No,Clock In,Clock Out,Hours,Break (min),Source,Status,Note");
  assertStringIncludes(lines[1], "KHOR SIEW CHIN");
  assertStringIncludes(lines[1], "E010");
  assertStringIncludes(lines[1], "3.76");
  // A comma inside a cell must be quoted, or every column after it shifts by one in Excel and the
  // operator reconciles hours against the wrong employee.
  assertStringIncludes(files[0].text, '"late, traffic on the LDP"');
});

Deno.test("Attendance ⬇ CSV refuses an empty month instead of downloading a header-only file", () => {
  const d = withRecorder(`ATT.month = '2026-08'; ATT.data = { punches: [] };`);
  d.fire(`hrAttExport()`);
  assertEquals(d.files().length, 0, "an empty month must toast, not hand back a file with only a header");
});

Deno.test("Dashboard ⬇ CSV produces a file", () => {
  const d = withRecorder(`
    HR_DASH.page = 'headcount';
    HR_DASH.data = { period:{ label:'August 2026' },
      headcount:{ total:22, active:22, inactive:0, new_hires:1, resigned:0,
                  by_dept:[{label:'Sales',value:6}], by_position:[{label:'Director',value:2}],
                  by_type:[{label:'Full-time',value:22}] } };
  `);
  d.fire(`hrDashExportCsv()`);
  const files = d.files();
  assertEquals(files.length, 1, "hrDashExportCsv() handed hrDownload nothing");
  assertEquals(files[0].name, "HR_Dashboard_headcount_August_2026.csv");
  assertStringIncludes(files[0].text, "Sales,6");
});

Deno.test("no export hand-rolls the blob download — they all go through hrDownload()", async () => {
  const src = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
  // hrDownload appends the anchor before clicking and defers revokeObjectURL by 1500ms. Revoking in the
  // SAME TICK can invalidate the blob before the browser has fetched it, and a detached anchor does not
  // start a download in every browser — while the `toast('CSV exported')` beside it fires either way, so
  // the failure looks exactly like success. Both CSV buttons were written that way.
  const handRolled = [...src.matchAll(/\.click\(\);\s*URL\.revokeObjectURL/g)];
  assertEquals(handRolled.length, 0,
    "a download here clicks a detached anchor and revokes the blob URL in the same tick. Use " +
    "hrDownload(name, text) — it appends, clicks, removes and defers the revoke.");
  // Guard the guard: hrDownload must still be the shape this test is vouching for. It is written on a
  // single line, so take the line — a multi-line regex silently matches nothing and vouches for nothing.
  const fn = src.split("\n").find((l) => l.includes("function hrDownload(")) ?? "";
  assert(fn !== "", "hrDownload is gone — re-point this test rather than deleting it");
  assert(fn.includes("document.body.appendChild(a)"), "hrDownload no longer appends the anchor");
  assert(/setTimeout\(function\(\)\{URL\.revokeObjectURL/.test(fn), "hrDownload no longer defers the revoke");
});
