// The 2026-09-26 multi-role authorization audit — the fixes that are not user_update's
// (tests/user_scope_escalation_test.ts carries that one, behaviourally).
//
// Each block below was a real gap found by reading a handler as each role in turn. They are pinned by
// SOURCE, because none of them changes an output a test here can observe without a live database: a
// race needs two requests in flight, and a tenant pin needs a second company's row to refuse.
//
//   1. DECISION RACES. hr_leave_decide and rcDecideOne read "is this still pending?" and then wrote
//      unconditionally, so two decisions in flight both passed — on a leave's FINAL step each one
//      deducted the balance again. hr_rc_email_action marked its link used AFTER deciding, so a
//      double-click (or a mail scanner plus the human) decided twice. Each now CLAIMS first with a
//      conditional UPDATE whose WHERE only one request can satisfy.
//   2. ap_rule_delete disabled any company's GL-coding rule by id; ap_rules_list with no tenant returned
//      every company's rules. The central tenant guard only sees a tenant that is SENT.
//   3. collections is a group-wide dunning run (every company's overdue AR, one email). The RPC checks
//      the role, not the scope — so a single-company admin could send it. v148's rule: full scope.
//   4. cron_health had no auth gate (its pg_cron job sent no cron_secret), and it returned the whole
//      health report — job names, their last error lines, failing HTTP targets — to anyone. The job was
//      rebuilt to send the key on 2026-09-27, and the handler now demands it like every other cron_*.

import { assertEquals } from "jsr:@std/assert@1";

const DIR = new URL("../supabase/functions/portal/", import.meta.url);
const HR = await Deno.readTextFile(new URL("hr.ts", DIR));
const FIN = await Deno.readTextFile(new URL("finance.ts", DIR));

/** Code only — a comment that QUOTES the fix must not satisfy the pin. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");

function handler(src: string, api: string): string {
  const at = src.indexOf(`api === "${api}"`);
  if (at < 0) throw new Error(`${api} not found`);
  const end = src.indexOf('if (api === "', at + 20);
  return code(src.slice(at, end > 0 ? end : undefined));
}
function fn(src: string, name: string): string {
  const at = src.indexOf(`async function ${name}(`);
  if (at < 0) throw new Error(`${name} not found`);
  // Up to the next top-level function, exported or not — slicing further reads OTHER handlers' writes
  // (hr_rc_submit's reset of a step back to Pending is exactly such a write).
  const next = /\n(export )?(async )?function /g;
  next.lastIndex = at + 20;
  const m = next.exec(src);
  return code(src.slice(at, m ? m.index : undefined));
}

Deno.test("hr_leave_decide claims the step (or the request) with a conditional update before anything else", () => {
  const h = handler(HR, "hr_leave_decide");
  const claimStep = h.search(/hr_leave_approval_steps"\)\.update\([^;]*\.eq\("status","Pending"\)\.select\(/);
  const claimReq = h.search(/hr_leave_requests"\)\.update\([^;]*\.eq\("status",String\(req\.status\)\)\.select\(/);
  assertEquals(claimStep > 0, true, "the step is no longer claimed with status='Pending' in the WHERE");
  assertEquals(claimReq > 0, true, "a request with no approval chain is no longer claimed on its own status");
  // …and nothing observable happens before the claim: no email, no balance, no audit.
  for (const side of ["rcSendEmail(", "hr_leave_balances", "logAudit(", "leaveNotifyStep("]) {
    const at = h.indexOf(side);
    if (at >= 0) assertEquals(at > Math.min(claimStep, claimReq), true, `${side} runs before the decision is claimed`);
  }
  // The old unconditional step writes must not come back alongside the claim.
  assertEquals(/hr_leave_approval_steps"\)\.update\(\{ *status:"(Approved|Rejected)"[^;]*\.eq\("id",step\.id\);/.test(h), false,
    "an unconditional step write is back — the losing request would overwrite the winner's decision");
});

Deno.test("rcDecideOne claims its step before rejecting, requesting info, overriding or approving", () => {
  const f = fn(HR, "rcDecideOne");
  const def = f.search(/const claimStep\s*=\s*async[\s\S]*?\.eq\("status","Pending"\)\.select\(/);
  assertEquals(def > 0, true, "claimStep no longer conditions on status='Pending'");
  for (const status of ["Rejected", "Info Requested", "Approved"]) {
    assertEquals(new RegExp(`if\\(!\\(await claimStep\\(\\{status:"${status}"`).test(f), true, `the ${status} path does not claim`);
  }
  assertEquals(/if\(step\) await sb\.from\("hr_claim_approval_steps"\)\.update\(/.test(f), false,
    "an unconditional step write is back in rcDecideOne");
  // The amount override is written only by the request that WON the claim.
  const claimApprove = f.indexOf('claimStep({status:"Approved"');
  const override = f.indexOf("override_amount:override");
  assertEquals(claimApprove > 0 && override > claimApprove, true,
    "the override amount is written before the approval is claimed — a losing request could change the figure");
});

Deno.test("an email approval link is claimed atomically BEFORE the decision, and released if it fails", () => {
  const h = handler(HR, "hr_rc_email_action");
  const claim = h.search(/hr_claim_email_actions"\)\.update\(\{ *used_at:new Date\(\)\.toISOString\(\) *\}\)\.eq\("id",row\.id\)\.is\("used_at",null\)\.select\(/);
  const decide = h.indexOf("rcDecideOne(");
  assertEquals(claim > 0, true, "the link is not claimed with `used_at is null` in the WHERE");
  assertEquals(claim < decide, true, "the link is claimed after deciding — two clicks both decide");
  assertEquals(/if\(!res\.ok\)\{[^}]*used_at:null/.test(h), true,
    "a refused decision no longer releases the link — the approver would be locked out of a still-valid link");
});

Deno.test("ap_rule_delete pins the RULE's company; ap_rules_list is scoped to the caller's companies", () => {
  const del = handler(FIN, "ap_rule_delete");
  const pin = del.search(/tenantPinned\(b\.token, *String\(rule\.tenant_id\)\)/);
  const write = del.indexOf('.update({ enabled: false })');
  assertEquals(pin > 0 && pin < write, true, "ap_rule_delete disables a rule without checking whose it is");
  const list = handler(FIN, "ap_rules_list");
  assertEquals(/allowedTenants\(b\.token\)/.test(list) && /alw\.indexOf\(String\(r\.tenant_id\)\)/.test(list), true,
    "ap_rules_list returns every company's rules when no tenant is sent");
});

Deno.test("collections is a group-wide run, so it needs a FULL-SCOPE admin before the RPC", () => {
  const h = handler(FIN, "collections");
  const gate = h.indexOf("isFullScopeAdmin(me, b.token)");
  const rpc = h.indexOf("portal_trigger_collections");
  assertEquals(gate > 0 && gate < rpc, true, "a single-company admin can trigger the group-wide dunning email again");
});

Deno.test("cron_health refuses a caller without the cron secret, before it reads or writes anything", () => {
  // 2026-09-27: the pg_cron job now sends the key (read from portal_secrets at run time), so the interim
  // "withhold only the detail" arrangement is replaced by the gate every other cron_* has.
  const h = handler(FIN, "cron_health");
  const gate = h.search(/if \(!sec \|\| !sec\.value \|\| b\.cron_secret !== sec\.value\) return j\(\{ ok:false, error:"forbidden" \}, 403\);/);
  assertEquals(gate > 0, true, "cron_health no longer refuses a caller without the cron secret");
  for (const side of ['rpc("portal_cron_health"', "portal_cron_alerts", "sendAlertEmail("]) {
    const at = h.indexOf(side);
    assertEquals(at > gate, true, `${side} runs before the secret is checked — an anonymous caller reaches it`);
  }
});
