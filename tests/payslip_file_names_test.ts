// Payslips: one file per employee, named "EMPLOYEE NAME_PAYROLL_MONTH_YEAR.pdf" (2026-11-04, operator).
//
// WHY THIS FILE EXISTS: the same month's payslip is produced in four places — the bulk export, the row-menu
// download, the email attachment and the employee's own download — and in two apps. They used to use two
// different names ("Payslips_November2026.pdf" for one combined file, "Payslip_E001_November2026.pdf" for
// one person). One rule now names all of them; these pin the rule, the batch's duplicate handling, the ZIP
// that carries the PDFs, and that every caller goes through the rule rather than spelling a name itself.

import { assert, assertEquals } from "jsr:@std/assert@1";

const docs = await Deno.readTextFile(new URL("../hr-docs.js", import.meta.url));
const html = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
// deno-lint-ignore no-explicit-any
const m: any = { exports: {} };
new Function("module", docs)(m);
const { hrPayslipFileName, hrPayslipFileNames, hrPayslipZipName } = m.exports;
const NOV = { month: 11, year: 2026, label: "November 2026" };

Deno.test("EMPLOYEE NAME_PAYROLL_MONTH_YEAR.pdf", () => {
  assertEquals(hrPayslipFileName("OOI YUIN ZHI", NOV), "OOI YUIN ZHI_PAYROLL_NOVEMBER_2026.pdf");
  assertEquals(hrPayslipFileName("TEST ONE", { month: 7, year: 2026 }), "TEST ONE_PAYROLL_JULY_2026.pdf");
  assertEquals(hrPayslipFileName("SITI NURHALIZA BINTI OMAR", { month: 1, year: 2027 }), "SITI NURHALIZA BINTI OMAR_PAYROLL_JANUARY_2027.pdf");
});

Deno.test("characters Windows refuses in a file name are dropped, never the name", () => {
  assertEquals(hrPayslipFileName("RAJESH A/L KUMAR", NOV), "RAJESH A L KUMAR_PAYROLL_NOVEMBER_2026.pdf");
  assertEquals(hrPayslipFileName('  A:B*C?"D<E>F|G\\H  ', NOV), "A B C D E F G H_PAYROLL_NOVEMBER_2026.pdf");
  assertEquals(hrPayslipFileName("", NOV), "EMPLOYEE_PAYROLL_NOVEMBER_2026.pdf");
  assertEquals(hrPayslipFileName("O'NEIL 陈", NOV), "O'NEIL 陈_PAYROLL_NOVEMBER_2026.pdf", "an apostrophe or Chinese name is legal and kept");
});

Deno.test("a batch: two staff with the same name do not overwrite each other in the ZIP", () => {
  const names = hrPayslipFileNames([
    { name: "TAN WEI", empNo: "E001" }, { name: "LIM AH KOW", empNo: "E002" }, { name: "Tan Wei", empNo: "E009" },
  ], NOV);
  assertEquals(names, [
    "TAN WEI (E001)_PAYROLL_NOVEMBER_2026.pdf", "LIM AH KOW_PAYROLL_NOVEMBER_2026.pdf", "Tan Wei (E009)_PAYROLL_NOVEMBER_2026.pdf",
  ]);
  assertEquals(new Set(names).size, names.length);
  assertEquals(hrPayslipZipName("YUAN CHUAN TANG CTG4U SDN. BHD.", NOV), "YUAN_CHUAN_TANG_CTG4U_SDN._BHD._PAYSLIPS_NOVEMBER_2026.zip");
});

Deno.test("the ZIP carries PDF bytes verbatim, with UTF-8 file names", async () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff, 0x80]);   // binary, not text
  const blob: Blob = m.exports.hrZip([{ name: "陈 TAN_PAYROLL_NOVEMBER_2026.pdf", bytes: pdf }, { name: "a.csv", text: "x,y" }]);
  const z = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(z.buffer);
  assertEquals(dv.getUint32(0, true), 0x04034b50);
  assertEquals(dv.getUint16(6, true) & 0x0800, 0x0800, "UTF-8 name flag");
  const nameLen = dv.getUint16(26, true), size = dv.getUint32(18, true);
  assertEquals(size, pdf.length);
  assertEquals([...z.slice(30 + nameLen, 30 + nameLen + size)], [...pdf], "a PDF must not be text-encoded into the ZIP");
  assertEquals(new TextDecoder().decode(z.slice(30, 30 + nameLen)), "陈 TAN_PAYROLL_NOVEMBER_2026.pdf");
});

Deno.test("every payslip caller names the file through the rule", () => {
  assert(html.includes("filename:hrPayslipFileName(r.e.name,per)"), "email attachment");
  assert(html.includes("doc.save(hrPayslipFileName(e.name,per));"), "employee's own download");
  assert(html.includes("var names=hrPayslipFileNames(rows.map(function(r){return r.e;}),per);"), "bulk export");
  assert(html.includes("onclick=\"hrExpPayslipOne(\\''+empId+'\\')\">⬇ Payslip PDF</button>"), "row-menu download");
  assertEquals(/'Payslips?_'\s*\+/.test(html), false, "an old hand-built payslip name is back");
});
