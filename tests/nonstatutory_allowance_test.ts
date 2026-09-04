// An allowance that is NOT statutory wages must survive a trip through the payroll grid.
//
// WHY THIS FILE EXISTS: `hr_payroll_adjustments.epf_subject` has existed since the beginning and both
// engines honour it — but the grid summed every 'allowance' row into ONE field and wrote it back as
// `epf_subject:true`. So a non-EPF-able allowance could be READ and never REPRESENTED: opening a month
// that had one and saving it silently converted it into statutory wages, moving EPF, SOCSO and EIS.
//
// That is not hypothetical. The AutoCount import (Jan–Jun 2026) carries commission and reimbursed
// claims on five of six months, all non-statutory, and AutoCount charges no EPF/SOCSO/EIS on them:
// e.g. NG LAY JING 03/2026, basic 5,000 + claim 702.23, EPF still 550 = 11% of 5,000.
//
// The round trip is the property that matters, so that is what is asserted: split on read, and put back
// on save exactly what was there.

import { assertEquals } from "jsr:@std/assert@1";
import { fnSource } from "../tools/extract.ts";

// deno-lint-ignore no-explicit-any
async function load(file: string, names: string): Promise<any> {
  const src = await Deno.readTextFile(new URL("../" + file, import.meta.url));
  return await import("data:application/javascript," + encodeURIComponent(
    src.replace(/if \(typeof module[\s\S]*$/, `export { ${names} };`),
  ));
}
const { hrCompute } = await load("payroll.js", "hrCompute");

const CFG = { epf: { eeRate: 0.11, erRateLow: 0.13, erRateHigh: 0.12, threshold: 5000, eeSenior: 0, erSenior: 0.04 } };
const PERIOD = { year: 2026, month: 3 };
const EMP = {
  basic_salary: 5000, fixed_allowance: 0, date_of_birth: "1995-09-16", marital_status: "single",
  spouse_working: false, num_children: 0, resident: true, citizen_status: "citizen",
  lindung24: true, epf_eligible: true, socso_eligible: true, eis_eligible: true,
};
const sen = (n: number) => Math.round(n * 100) / 100;

Deno.test("a non-statutory allowance reaches gross but not EPF, SOCSO or EIS", () => {
  const plain = hrCompute(EMP, CFG, [], PERIOD, null);
  const withNs = hrCompute(EMP, CFG, [{ kind: "allowance", amount: 702.23, epf_subject: false }], PERIOD, null);

  assertEquals(sen(withNs.gross), sen(plain.gross + 702.23), "it must reach gross pay");
  for (const k of ["epfEe", "epfEr", "socsoEe", "socsoEr", "eisEe", "eisEr", "lindung"] as const) {
    assertEquals(sen(withNs[k]), sen(plain[k]), `${k} moved — a non-statutory allowance is not statutory wages`);
  }
  // NG LAY JING 03/2026 as AutoCount actually paid her: basic 5,000 + claim 702.23 -> EPF 550/650.
  assertEquals(sen(withNs.epfEe), 550, "EPF employee is 11% of the 5,000 basic only");
  assertEquals(sen(withNs.epfEr), 650, "EPF employer is 13% of the 5,000 basic only");
});

Deno.test("a STATUTORY allowance of the same size does move the statutory figures", () => {
  // The mirror of the test above — otherwise a bug that ignores allowances entirely would pass both.
  const plain = hrCompute(EMP, CFG, [], PERIOD, null);
  const withStat = hrCompute(EMP, CFG, [{ kind: "allowance", amount: 702.23, epf_subject: true }], PERIOD, null);
  assertEquals(withStat.epfEe > plain.epfEe, true, "a statutory allowance must raise EPF");
  assertEquals(withStat.socsoEe >= plain.socsoEe, true, "a statutory allowance must not lower SOCSO");
});

Deno.test("the payroll grid can represent both halves and puts them back unchanged", async () => {
  // Structural, against hros.html itself: the grid is 500 KB of inline script with no seam to import,
  // and the failure being guarded is precisely that one of these three sites gets forgotten.
  const html = await Deno.readTextFile(new URL("../hros.html", import.meta.url));

  // 1. READ — the two halves are split apart when the month is loaded.
  assertEquals(
    /allowance:\s*sumKe\('allowance',\s*true\)/.test(html) && /allowanceNs:\s*sumKe\('allowance',\s*false\)/.test(html),
    true,
    "hrGridInit must split 'allowance' rows on epf_subject (sumKe), not sum them with sumK",
  );
  // 2. COMPUTE — the on-screen figure uses the same distinction the server will.
  assertEquals(
    /adj\.push\(\{kind:'allowance',amount:Number\(g\.allowanceNs\),epf_subject:false\}\)/.test(html),
    true,
    "hrGridRowCompute must feed the non-statutory half to hrCompute with epf_subject:false",
  );
  // 3. WRITE — and it is what gets saved.
  assertEquals(
    /kind:'allowance',amount:Number\(g\.allowanceNs\),epf_subject:false/.test(html.split("async function hrGridSave")[1] || ""),
    true,
    "hrGridSave must persist the non-statutory half with epf_subject:false",
  );
  // 4. The operator can actually type into it.
  assertEquals(/hrGCell\(id,'allowanceNs'\)/.test(html), true, "the grid needs a column for it");
});

Deno.test("the two allowance columns sit inside the Earnings group and the totals row still lines up", async () => {
  // Column counts are the kind of thing that breaks silently: the table simply renders skewed, and every
  // figure appears under the wrong heading. Adding a column means two colspans have to move with it.
  const html = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
  // Anchor on grpHd — several screens have a "<tr><th>Employee</th>" and the first match is the
  // year-to-date summary, not the payroll grid.
  const hd = html.match(/grpHd\+'<tr><th>Employee<\/th>([\s\S]*?)<\/tr>/);
  assertEquals(hd !== null, true, "could not find the payroll grid header row");
  const headers = [...hd![1].matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
  // Employee + 7 editable earning/deduction columns before the statutory block.
  assertEquals(headers.slice(0, 7), ["Basic", "Allow", "Bonus", "OT", "Extra allow", "Non-EPF allow", "Deduct"]);
  assertEquals(/colspan="6"[^>]*>Earnings \(RM\)/.test(html), true, "the Earnings group header must span 6 columns");
  assertEquals(/<td colspan="8"[^>]*>variable items/.test(html), true, "the totals row must skip 8 input columns");
});

// ── The generalised guard: every earning the grid records must appear on the payslip ────────────────
//
// v196 fixed exactly this for LINDUNG 24 — computed, deducted from net, and printed by nobody, so the
// payslip's own lines did not add up to its own net pay. Adding a second allowance bucket reintroduced
// the same shape on the EARNINGS side within a day: `allowanceNs` reached gross and was on no line.
//
// So do not test for `allowanceNs`. Test the RULE: hrGridAll() builds one object (`d`) describing what
// the employee was paid, and hrDrawPayslip() is the thing that prints it. Any key of `d` the drawer
// never mentions is money that moved with no line item explaining it.
Deno.test("every earning the payroll grid records is printed on the payslip", async () => {
  const html = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
  const docs = await Deno.readTextFile(new URL("../hr-docs.js", import.meta.url));

  const dLit = html.match(/var d=\{([^;]*?)\};/);
  assertEquals(dLit !== null, true, "could not find the payslip breakdown object in hrGridAll()");
  const keys = [...dLit![1].matchAll(/([A-Za-z_][\w]*)\s*:/g)].map((m) => m[1]);
  assertEquals(keys.length > 5, true, "parsed too few keys from `d` — the regex has drifted");

  // Aggregates the drawer reaches by a different name, and the one field it takes from the employee
  // record rather than from `d`. Anything else must be named in hrDrawPayslip.
  const VIA_OTHER_NAME: Record<string, string> = {
    deduction: "printed line by line from d.deductions instead",
    allow: "printed as e.allowance, the employee's fixed allowance",
    basic: "printed as e.basic",
  };

  const drawer = fnSource(docs, "hrDrawPayslip");
  assertEquals(typeof drawer === "string" && drawer.length > 0, true, "hrDrawPayslip not found — renamed?");
  const missing = keys.filter((k) => !VIA_OTHER_NAME[k] && !(drawer as string).includes("d." + k));
  assertEquals(missing, [],
    "these fields of the payslip breakdown are never printed, so the payslip's lines will not add up to " +
    "its own gross:\n  " + missing.join("\n  ") +
    "\nPrint them in hrDrawPayslip, or add them to VIA_OTHER_NAME with the reason.");
});
