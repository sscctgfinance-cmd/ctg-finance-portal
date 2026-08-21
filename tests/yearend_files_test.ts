// The three files LHDN receives: Borang EA (C.P.8A), Form E (C.P.8) and the CP8D schedule.
//
// WHY THIS FILE EXISTS: hrDrawEA and hrDrawFormE have lived in hr-docs.js since v213, so the two PDFs
// could not fork — but the FIGURES they are drawn from, and the whole of CP8D, were assembled inside
// hros.html's export buttons. The React port therefore had a choice between re-expressing a statutory
// computation and handing off, and a second copy of a filed figure is a filing that eventually
// disagrees with itself. v222 lifted hrYePaid / hrFormEStats / hrCp8dFile into hr-docs.js; this file is
// the gate on the move, and on the two properties that make CP8D safe to upload:
//
//   1. NO TOTAL TRAILER, in either format. CP8D is one record per employee, and a trailing "TOTAL" line
//      is read by the uploader as one more employee — the same defect that was a duplicate payment for
//      the whole batch in the bank file (v157, hros.html:1849) and that this project has now hit twice.
//   2. The CSV a human reviews and the TXT that is uploaded must carry the SAME values. A review copy
//      that can disagree with the file proves nothing.
//
// It exercises the LEGACY path — hrExpCp8d as hros.html actually calls it — so it fails whether the
// defect is introduced in the shared module or in the button.

import { assertEquals } from "jsr:@std/assert@1";
import { fnSource, inlineScript } from "../tools/extract.ts";

const html = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
const src = inlineScript(html);
/** hros.html's OWN inline script, without the shared classic scripts it loads. */
const inlineOnly = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)!.join("\n");

const HELPERS = ["hrCsv", "hrEmpView", "hrCp8dCategory", "hrIntNoSen", "hrDec2", "hrFmtDMY",
  "hrYePaid", "hrFormEStats", "hrCp8dFile", "hrExpCp8d"];

// Three employees: one paid with a child and a resignation, one paid, one with an employee row but no
// finalised payslip in the year — who must not be filed at all.
const EMPS = [
  { id: "e1", emp_no: "T001", name: "TEST ONE", ic_no: "961008-02-6006", tax_no: "IG28765801050",
    marital_status: "married", spouse_working: false, num_children: 2, resign_date: "2026-09-30",
    join_date: "2019-04-01" },
  { id: "e2", emp_no: "T002", name: "TEST TWO", ic_no: "950608-07-5211", tax_no: "",
    marital_status: "single", num_children: 0, join_date: "2026-02-17" },
  { id: "e3", emp_no: "T003", name: "NOT PAID", ic_no: "900101-10-1111", marital_status: "single",
    num_children: 0, join_date: "2026-06-01" },
];
const ANNUAL: Record<string, Record<string, number>> = {
  e1: { months: 12, gross: 48000.5, epfEe: 5280.75, socsoEe: 207, lindung: 310.2, pcb: 532.4 },
  e2: { months: 6, gross: 24000, epfEe: 2640, socsoEe: 118.5, lindung: 177.9, pcb: 0 },
  e3: { months: 0, gross: 0, epfEe: 0, socsoEe: 0, lindung: 0, pcb: 0 },
};

const prelude = `
export const DOWNLOADS: {name:string,text:string}[] = [];
export const TOASTS: {msg:string,err:boolean}[] = [];
function hrDownload(name:string,text:string,_m?:any){ DOWNLOADS.push({name,text}); }
function toast(msg:string,err?:boolean){ TOASTS.push({msg:String(msg),err:!!err}); }
const HR:any = { data:{ employees:${JSON.stringify(EMPS)} } };
const HR_YE:any = { year:2026, annual:${JSON.stringify(ANNUAL)}, employer:{ employer_no:'E 1234567890' } };
`;
// deno-lint-ignore no-explicit-any
const m: any = await import("data:application/typescript," + encodeURIComponent(
  [prelude, ...HELPERS.map((f) => fnSource(src, f)), "export { " + HELPERS.join(", ") + " };"].join("\n")));

function emit(fmt: "txt" | "csv"): { name: string; text: string } {
  m.DOWNLOADS.length = 0; m.TOASTS.length = 0; m.hrExpCp8d(fmt);
  const f = m.DOWNLOADS[0];
  if (!f) throw new Error("CP8D did not build: " + m.TOASTS.map((t: { msg: string }) => t.msg).join(" / "));
  return f;
}

// The 23-column layout, by index. Named so an assertion below says what moved.
const COL = { name: 0, tin: 1, ic: 2, cat: 3, ceased: 5, children: 7, childRelief: 8, gross: 9,
  epf: 16, mtd: 18, socso: 21 };

Deno.test("CP8D has no TOTAL trailer — in either format", () => {
  for (const fmt of ["txt", "csv"] as const) {
    const f = emit(fmt);
    const lines = f.text.split("\r\n").filter(Boolean);
    // txt: one record per paid employee. csv: a header plus one record each.
    assertEquals(lines.length, fmt === "txt" ? 2 : 3, `${fmt}: wrong record count — ${f.text}`);
    for (const l of lines) {
      assertEquals(/total/i.test(l), false,
        `${fmt} carries a TOTAL row: "${l}" — the uploader reads it as one more employee`);
    }
  }
});

Deno.test("the CSV a human reviews carries the same values as the TXT that is uploaded", () => {
  const txt = emit("txt").text.split("\r\n").filter(Boolean).map((l) => l.split("|"));
  const csv = emit("csv").text.split("\r\n").filter(Boolean).slice(1).map((l) => l.split(","));
  assertEquals(txt.length, csv.length, "different number of employees in the two formats");
  for (let i = 0; i < txt.length; i++) {
    // The CSV prefixes a running "No" column, and the TXT clips name/IC to the layout width; every
    // other field must match character for character.
    const c = csv[i].slice(1);
    assertEquals(c.length, txt[i].length, `row ${i}: column count differs`);
    for (let k = 0; k < txt[i].length; k++) {
      if (k === COL.name || k === COL.ic) continue;
      assertEquals(c[k], txt[i][k], `row ${i}, column ${k}: csv "${c[k]}" vs txt "${txt[i][k]}"`);
    }
    assertEquals(txt[i][COL.name], c[COL.name].slice(0, 60), `row ${i}: name`);
    assertEquals(txt[i][COL.ic], c[COL.ic].slice(0, 12), `row ${i}: IC`);
  }
});

Deno.test("only employees with a finalised payslip are filed", () => {
  const txt = emit("txt").text;
  assertEquals(txt.includes("TEST ONE"), true);
  assertEquals(txt.includes("TEST TWO"), true);
  assertEquals(txt.includes("NOT PAID"), false,
    "an employee with months=0 reached CP8D — the employer declares remuneration of zero for someone " +
    "LHDN will then chase");
  // Guard the guard: the fixture really does carry a third employee, and the only thing keeping them
  // out is months=0 — otherwise the assertion above passes because there was nothing to leave out.
  assertEquals(EMPS.length, 3);
  assertEquals(ANNUAL.e3.months, 0);
  assertEquals(m.hrYePaid(EMPS, { ...ANNUAL, e3: { ...ANNUAL.e3, months: 1 } }).length, 3,
    "months>0 is what excludes them, not a missing annual row");
});

Deno.test("the SOCSO column is the Second-Schedule contribution PLUS LINDUNG 24", () => {
  // v196. tests/lindung_reporting_test.ts says what happened when it was not: money taken from the
  // employee, never declared, and the RM350 relief they can claim shrinks.
  const txt = emit("txt").text.split("\r\n").filter(Boolean).map((l) => l.split("|"));
  assertEquals(txt[0][COL.socso], "517", "207 + 310.20, truncated to the ringgit");
  assertEquals(txt[1][COL.socso], "296", "118.50 + 177.90");
});

Deno.test("the identifiers and reliefs are the ones the layout expects", () => {
  const [a, b] = emit("txt").text.split("\r\n").filter(Boolean).map((l) => l.split("|"));
  assertEquals(a[COL.tin], "28765801050", "the printed 'IG' prefix must be stripped to digits");
  assertEquals(b[COL.tin], "", "no TIN stays blank rather than becoming a plausible zero");
  assertEquals(a[COL.ic], "961008026006", "IC keeps its digits and loses its dashes");
  assertEquals(b[COL.ic], "950608075211");
  assertEquals(a[COL.cat], "2", "married, spouse not working");
  assertEquals(b[COL.cat], "1", "single, no children");
  assertEquals(a[COL.children], "2");
  assertEquals(a[COL.childRelief], "4000", "2 children x RM2,000");
  assertEquals(a[COL.ceased], "30-09-2026", "a resignation in the year is declared as DD-MM-YYYY");
  assertEquals(b[COL.ceased], "", "no resignation, no date");
  assertEquals(a[COL.gross], "48000", "gross is whole ringgit, truncated");
  assertEquals(a[COL.mtd], "532.40", "MTD keeps its sen");
});

Deno.test("the TXT is named for the employer's E-number and ends CRLF", () => {
  const f = emit("txt");
  assertEquals(f.name, "P1234567890_2026.txt", "non-digits are stripped from the E-number");
  assertEquals(f.text.endsWith("\r\n"), true, "several government uploaders drop the last record without it");
  assertEquals(emit("csv").name, "CP8D_YA2026.csv");
});

Deno.test("a missing employer E-number files under a placeholder rather than a blank", () => {
  const out = m.hrCp8dFile([{ emp: m.hrEmpView(EMPS[0]), tot: ANNUAL.e1 }], "", 2026, "txt");
  assertEquals(out.name, "P0000000000_2026.txt");
});

Deno.test("Form E's declared figures count the workforce, not only the paid", () => {
  const s = m.hrFormEStats(EMPS, ANNUAL, 2026);
  assertEquals(s.total, 3, "Form E part A declares every employee, including the unpaid one");
  assertEquals(s.subjectPcb, 1, "only TEST ONE had PCB deducted");
  assertEquals(Math.round(s.totalGross * 100) / 100, 72000.5);
  assertEquals(Math.round(s.totalPcb * 100) / 100, 532.4);
  assertEquals(s.newHires, 2, "TEST TWO and NOT PAID both joined in 2026 — Form E counts a hire with " +
    "no finalised payslip yet, which is exactly the employee CP8D above must leave out");
  assertEquals(s.ceased, 1, "TEST ONE resigned in 2026");
});

Deno.test("the year-end figures are computed ONCE, in hr-docs.js", () => {
  // The point of the lift. If a copy of any of this reappears inside hros.html's buttons, the two can
  // drift and only a hand-check of a filed form would find it.
  for (const [name, why] of [
    ["hrCp8dFile", "the CP8D layout"],
    ["hrFormEStats", "Form E's declared figures"],
    ["hrYePaid", "who gets filed"],
  ] as const) {
    assertEquals(new RegExp("function\\s+" + name + "\\s*\\(").test(inlineOnly), false,
      `${name} (${why}) is defined inside hros.html again — it belongs in hr-docs.js`);
  }
  assertEquals(/Zakat \(TP1\)/.test(inlineOnly), false, "the CP8D column list is back inside hros.html");
});

Deno.test("the two date derivations on a statutory form are pinned in the SOURCE, not by their output", () => {
  // NO OUTPUT ASSERTION CAN SEE THIS. Both of these read a bare `YYYY-MM-DD` through `new Date()`,
  // which is parsed as midnight UTC, and then ask a LOCAL getter for the answer. This machine and CI
  // both sit at UTC+8, so every case above passes either way; west of Greenwich the same data gives a
  // different filing — a 1 January hire drops out of Form E's `newHires`, and a resignation dated the
  // 1st is declared on CP8D as the previous day.
  //
  // Mirrored, NOT fixed: these are the figures hros.html has always filed, and changing one changes a
  // declared figure. The guard's job is to make any change to them deliberate and visible, which is the
  // same reason finance.calendar's `dueLabel()` is pinned by its source (CLAUDE.md).
  const stats = fnSource(src, "hrFormEStats");
  assertEquals(/new Date\(e\.join_date\)\.getFullYear\(\)/.test(stats), true,
    "hrFormEStats' hire-year derivation changed — that moves a figure declared on Form E");
  assertEquals(/new Date\(e\.resign_date\)\.getFullYear\(\)/.test(stats), true,
    "hrFormEStats' cessation-year derivation changed");
  const dmy = fnSource(src, "hrFmtDMY");
  assertEquals(/x\.getDate\(\)/.test(dmy) && /x\.getMonth\(\)/.test(dmy), true,
    "hrFmtDMY stopped reading the LOCAL date — the CP8D cessation date would shift for every employee");
});
