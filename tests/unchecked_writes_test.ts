// A write whose error nobody reads is a change the operator was told happened.
//
// WHY THIS FILE EXISTS: v159 shipped exactly that — `hr_rc_save`'s update was unchecked, so a failed
// save returned ok:true and the UI toasted "Draft saved" over a claim that had not moved. The same
// shape is still spread across the handler chain, and counting it is the only way to stop it growing
// while nobody is looking.
//
// This is a RATCHET, not a clean bill of health. The baselines below are what the code has today; they
// are allowed to fall and not to rise. Two paths whose silent failure has a NAMED harm are pinned
// individually, because a count cannot tell you which ones matter:
//
//   · revoking CTG access deletes the person's live sessions. The legacy comment says why — "otherwise
//     a revoked person keeps working until their token ages out" — and unread, that failure told the
//     caller the revoke had succeeded and recorded nothing anywhere.
//   · the leave-compliance repair counted an entitlement as topped up to the statutory floor whether or
//     not the write landed, and reported that count to the operator AND to the audit log.
//
// Audit-log inserts are excluded on purpose: logging must never break the action it is logging.

import { assertEquals } from "jsr:@std/assert@1";

const read = (f: string) => Deno.readTextFile(new URL("../supabase/functions/portal/" + f, import.meta.url));
const FIN = await read("finance.ts");
const HR = await read("hr.ts");
const LIB = await read("lib.ts");

/** Tables whose write is a log line — a failed log must not fail the request it describes. */
const LOG_TABLES = new Set([
  "portal_audit", "hr_audit", "portal_ctg_access_log", "portal_client_errors",
  "hr_claim_audit_logs", "portal_cron_alerts",
]);

/** Every `await sb.from(t).insert|update|delete|upsert(...)` whose error is not captured on that line. */
function uncheckedWrites(src: string): { line: number; table: string; op: string }[] {
  const out: { line: number; table: string; op: string }[] = [];
  src.split("\n").forEach((l, i) => {
    const m = /await sb\.from\("([a-z_]+)"\)\.(insert|update|delete|upsert)\(/.exec(l);
    if (!m) return;
    if (LOG_TABLES.has(m[1])) return;
    // Captured either as `const { error } = ...` / `const { data, error } = ...`, or assigned to a
    // variable the next lines test (`res = await ...`, `const r = await ...`).
    if (/(const|let|var)\s*\{[^}]*error/.test(l)) return;
    if (/(const|let|var)?\s*\w+\s*=\s*await sb\.from/.test(l)) return;
    out.push({ line: i + 1, table: m[1], op: m[2] });
  });
  return out;
}

Deno.test("the number of writes whose failure nobody reads does not grow", () => {
  // Baselines as of the 2026-08-23 sweep: 14 + 77 + 29 = 120, set to the EXACT counts so that
  // slack cannot absorb new ones. LOWER them when you fix some; never raise them. Most of
  // hr.ts's are the claim approval state machine (a multi-write transition where a partial failure
  // leaves the claim between states) — worth a transaction rather than a scatter of error checks, so
  // it is recorded here rather than papered over.
  const fin = uncheckedWrites(FIN), hr = uncheckedWrites(HR), lib = uncheckedWrites(LIB);
  assertEquals(fin.length <= 14, true, `finance.ts: ${fin.length} unchecked writes (baseline 14)\n` + fin.map((x) => `  :${x.line} ${x.op} ${x.table}`).join("\n"));
  assertEquals(hr.length <= 77, true, `hr.ts: ${hr.length} unchecked writes (baseline 77)\n` + hr.slice(0, 12).map((x) => `  :${x.line} ${x.op} ${x.table}`).join("\n"));
  assertEquals(lib.length <= 29, true, `lib.ts: ${lib.length} unchecked writes (baseline 29)`);
});

Deno.test("revoking access CHECKS that the live sessions were actually ended", () => {
  // The whole point of that delete is the word "immediately". Unread, a failure left the revoked
  // person working while the caller was told the revoke had succeeded.
  const at = FIN.indexOf('action:"revoke"');
  assertEquals(at > -1, true, "the CTG revoke path no longer looks like this");
  const block = FIN.slice(at - 1400, at + 600);
  assertEquals(/const \{ error: serr \} = await sb\.from\("portal_sessions"\)\.delete\(\)/.test(block), true,
    "the session delete on revoke is unchecked again");
  // It must not fail the request — the link removal already succeeded — but it must SAY so, and the
  // access log is where a question about who still had access gets answered.
  assertEquals(block.includes("sessions_killed: !serr"), true, "the outcome is not recorded in the access log");
  assertEquals(block.includes("warning: serr ?"), true, "the caller is not told");
});

Deno.test("the leave-compliance repair counts what it WROTE, not what it tried", () => {
  // It reported a statutory top-up as done whether or not the write landed — to the operator and to
  // the audit log, which is the record somebody would later rely on.
  const at = FIN.indexOf("hr_leave_compliance_fix");
  assertEquals(at > -1, true);
  const block = FIN.slice(at - 2200, at + 400);
  assertEquals(block.includes("if(error) failed.push"), true, "a failed entitlement write is counted as a success again");
  assertEquals(/failed: failed\.length/.test(block), true, "the operator is not told how many failed");
  // A partial repair is still worth keeping — it must not throw the successful ones away.
  assertEquals(block.includes("ok:true"), true);
});
