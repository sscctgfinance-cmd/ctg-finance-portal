// "Skip this month" has to hold together across four places or it does the opposite of what it says.
//
// WHY THIS FILE EXISTS: excluding someone from a payroll run is a four-legged thing —
//   hrGridInit   reads the stored `skip` adjustment back into the grid
//   hrGridAll    drops those employees, which is what keeps them out of the totals AND out of HR.pay._rows
//   hrFinalise   sends _rows, and hr_payroll_finalise writes a payslip for every row it receives
//   hrGridSave   persists the flag so a reload does not silently put them back in
// Break the second leg and a skipped employee is paid anyway. Break the fourth and the exclusion vanishes
// on refresh — after the operator has already moved on. Neither failure looks like a failure on screen.

import { assertEquals } from "jsr:@std/assert@1";
import { fnSource, inlineScript } from "../tools/extract.ts";

const src = inlineScript(await Deno.readTextFile(new URL("../hros.html", import.meta.url)));

Deno.test("hrGridAll excludes skipped employees from the run", () => {
  const body = fnSource(src, "hrGridAll");
  assertEquals(/\.skip/.test(body), true,
    "hrGridAll no longer filters on skip — a skipped employee would be totalled, banked and paid");
  // The filter has to happen on the employee list the rows are built from, not merely on the totals.
  assertEquals(/employees\s*\|\|\s*\[\]\)\.filter/.test(body), true,
    "the skip filter moved off the employee list, so HR.pay._rows would still carry them into finalise");
});

Deno.test("finalise sends exactly the rows hrGridAll produced", () => {
  // This is the link that turns "not in the grid" into "no payslip". hr_payroll_finalise writes one
  // payslip per row it is given, so anything else here re-pays the skipped employee.
  const body = fnSource(src, "hrFinalise");
  assertEquals(/HR\.pay\._rows/.test(body), true,
    "hrFinalise no longer builds its payload from HR.pay._rows, so the grid's exclusions stop applying");
});

Deno.test("the skip flag is loaded and saved, so it survives a reload", () => {
  assertEquals(/skip:\s*mine\.some\(/.test(fnSource(src, "hrGridInit")), true,
    "hrGridInit does not read the stored skip back — the exclusion would disappear on refresh");
  const save = fnSource(src, "hrGridSave");
  assertEquals(/kind:\s*'skip'/.test(save), true, "hrGridSave does not persist skip");
  // basic_set / allow_set / pcb_set / skip must all still be written, or a saved month silently loses one.
  for (const k of ["basic_set", "allow_set", "pcb_set", "skip", "bonus", "ot", "allowance", "deduction", "unpaid_leave"]) {
    assertEquals(save.indexOf("'" + k + "'") >= 0, true, `hrGridSave stopped persisting ${k}`);
  }
});

Deno.test("skipping is confirmed, and the three removal paths stay distinct", () => {
  const skip = fnSource(src, "hrGridSkip");
  assertEquals(/confirm\(/.test(skip), true, "skipping someone no longer asks first");
  // Skip must never touch the employee record — that is what makes it reversible.
  assertEquals(/hr_emp_save|hr_emp_delete/.test(skip), false,
    "hrGridSkip is writing to the employee record; skip is supposed to be a per-period flag only");

  const panel = fnSource(src, "hrGRowMenuPanel");
  assertEquals(/hrGridSkip/.test(panel) && /hrGRowResign/.test(panel) && /hrEmpDelete/.test(panel), true,
    "the row menu no longer offers all three of skip / resign / delete");
  // Delete stays behind "resigned first" in the UI as well as the server, because the server's own guard
  // is the only thing standing between a misclick and a destroyed EA form.
  assertEquals(/gone\s*\?/.test(panel), true, "delete is no longer gated on the employee being resigned");
});

Deno.test("resigning from the grid sends a partial save, which v197 made safe", () => {
  const fn = fnSource(src, "hrGRowResign");
  assertEquals(/status:\s*'resigned'/.test(fn), true, "resign no longer sets the status");
  assertEquals(/resignDate/.test(fn), true, "resign no longer sends the last working day");
  // It deliberately sends only id/name/status/resignDate. Before v197 that would have nulled the DOB,
  // bank account and statutory numbers — so this test is also a tripwire on that fix.
  assertEquals(/basic|allowance|epfNo|socsoNo|bankAccount/.test(fn), false,
    "hrGRowResign started sending pay fields — it should send status and date only");
});
