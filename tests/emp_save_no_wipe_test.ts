// hr_emp_save must never null a column the caller did not send.
//
// WHY THIS FILE EXISTS: this is the third time the same bug has shipped.
//   v148 — Department became a dropdown that pre-selected blank, so every save wiped it.
//   v157 — address / manager_id / claim_role / shift times were written unconditionally, so editing a
//          salary erased the home address the employee had entered themselves (and which MyInvois uses),
//          broke the "direct manager" approval step, and dropped their approver role.
//   v196 — everything ELSE was still unconditional. A save that sent only {id, name, basic} nulled
//          date_of_birth (verified live), and with it the 60+ senior EPF rate and SOCSO Category 2. Same
//          for the EPF/SOCSO/LHDN member numbers the statutory upload files refuse to build without, the
//          bank account salaries are paid into, and a part-timer's hourly/daily rate.
//
// The boolean flags were worse than nullable: they used `f.epf !== false`, so an absent key did not clear
// them — it set them back to TRUE, silently re-enrolling an exempt employee into EPF, EIS or LINDUNG 24.
//
// The rule this file enforces: inside hr_emp_save, `patch` may only be assigned directly for `name`
// (validated as required on every call). Everything else must go through keepIfSent, which writes when the
// caller sent the key OR when the row is new.

import { assertEquals } from "jsr:@std/assert@1";

const ts = await Deno.readTextFile(new URL("../supabase/functions/portal/hr.ts", import.meta.url));

function empSaveBlock(): string {
  const at = ts.indexOf('api === "hr_emp_save"');
  assertEquals(at > 0, true, "hr_emp_save not found");
  const end = ts.indexOf('if (api === "', at + 20);
  return ts.slice(at, end > 0 ? end : at + 12000);
}

Deno.test("hr_emp_save writes no column unconditionally except name", () => {
  const block = empSaveBlock();

  // The initial literal.
  const lit = block.match(/const patch:\s*any\s*=\s*\{([^}]*)\}/);
  assertEquals(!!lit, true, "could not find the patch literal — was it restructured?");
  const keys = (lit![1].match(/(^|[,{\s])([a-z_0-9]+)\s*:/gi) || [])
    .map((k) => k.replace(/[,{\s:]/g, ""));
  assertEquals(keys.sort(), ["name"],
    `patch is seeded with ${JSON.stringify(keys)}; every column other than name must go through keepIfSent, ` +
    `or a caller that omits it will null (or, for a boolean, silently re-enable) that field`);

  // Direct `patch.x =` assignments are allowed only where the code has explicitly gated them first
  // (ytd_*, status/resign_date, dept, bank_*). Those live inside their own `if (f.… !== undefined)`.
  const direct = [...block.matchAll(/patch\.([a-z_0-9]+)\s*=/gi)].map((m) => m[1]);
  const GATED = ["ytd_year", "ytd_gross", "ytd_epf", "ytd_pcb", "ytd_months",  // behind `if (f.ytdYear !== undefined)`
    "status", "resign_date",          // behind `if (f.status !== undefined …)`
    "dept",                           // v148: behind its own sent-check
    "bank_code", "bank_name", "bank_account", "bank_holder",   // written as one unit only if any was sent
    "tenant_id", "emp_no"];           // insert-only: tenant pinning and the generated E### number
  const ungated = direct.filter((d) => GATED.indexOf(d) < 0);
  assertEquals(ungated, [],
    `patch.${ungated.join(", patch.")} is assigned directly. If it is genuinely gated, add it to GATED here ` +
    `with the reason; otherwise route it through keepIfSent.`);
});

Deno.test("the fields that cost real money are guarded by name", () => {
  const block = empSaveBlock();
  // Named explicitly so a future refactor that drops one fails loudly rather than quietly.
  const MUST_GUARD: [string, string][] = [
    ["dob", "date_of_birth — drives the 60+ senior EPF rate and SOCSO Category 2"],
    ["epfNo", "EPF member no — the KWSP upload file is blocked without it"],
    ["socsoNo", "SOCSO no — the PERKESO ASSIST file is blocked without it"],
    ["taxNo", "TIN — CP39 / CP8D"],
    ["epf", "epf_eligible — an absent key used to re-enrol an exempt employee"],
    ["socso", "socso_eligible"],
    ["eis", "eis_eligible"],
    ["lindung24", "LINDUNG 24 Jam eligibility"],
    ["resident", "tax residency — a non-resident is taxed at a flat 30%"],
    ["payType", "monthly / hourly / daily"],
    ["hourlyRate", "what a part-timer is actually paid"],
    ["dailyRate", "what a part-timer is actually paid"],
    ["epfEeRate", "employee EPF rate override"],
    ["epfErRate", "employer EPF rate override"],
    ["socsoCategory", "SOCSO category override"],
    ["joinDate", "join date — drives the statutory annual-leave floor"],
    ["numChildren", "PCB child relief"],
    ["maritalStatus", "PCB category"],
  ];
  const missing = MUST_GUARD.filter(([k]) =>
    !new RegExp(`keepIfSent\\(\\s*["']${k}["']`).test(block)).map(([k, why]) => `${k} (${why})`);
  assertEquals(missing, [], "not guarded by keepIfSent: " + missing.join("; "));
});

Deno.test("keepIfSent still writes on insert", () => {
  // A brand-new employee has no id, so every field must be written or the defaults never land.
  const m = ts.match(/const keepIfSent\s*=\s*\([^)]*\)\s*=>\s*\{([^}]*)\}/);
  assertEquals(!!m, true, "keepIfSent not found");
  assertEquals(/!f\.id/.test(m![1]), true,
    "keepIfSent no longer writes when f.id is absent — new employees would be created with nothing set");
});
