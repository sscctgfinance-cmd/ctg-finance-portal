// A capability the server computes for the client must actually be READ by the client.
//
// WHY THIS FILE EXISTS: `hr_rc_get` has returned `can_act` since the claims module shipped, and its own
// comment in hr.ts says it exists "so the Approve button hides instead of erroring on click". No client
// ever read it. `hrRCDetail()` decided whether to draw ✓ Approve / ✕ Reject / ↩ Request info / Override
// from `pending`, which is nothing but the claim's STATUS string — so every viewer who could open a
// claim got four live-looking buttons, and `hr_rc_decide` refused on click.
//
// That is what the operator hit: CHEAH YONG SING (portal admin, holds the "hr" claim role) opening ONG
// SOO FANG's claims, whose step 1 is assigned BY NAME to ONG SOO CHEEN. The refusal was correct — an
// admin is deliberately not an override (v120 segregation of duties) — but the screen advertised the
// action anyway and named nobody, so it read as a broken button rather than as somebody else's step.
//
// The general rule this pins: a `can_*` flag in `hr_rc_get`'s response is a GATE. Adding one the client
// ignores re-creates the same defect, and nothing fails at runtime when it happens — the button simply
// works for the wrong person until someone presses it.

import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { fnSource, inlineScript } from "../tools/extract.ts";

const HR_TS = await Deno.readTextFile(new URL("../supabase/functions/portal/hr.ts", import.meta.url));
const HROS = inlineScript(await Deno.readTextFile(new URL("../hros.html", import.meta.url)));

/** `hr_rc_get`'s return statement — where the response shape is declared. */
function rcGetReturn(): string {
  const at = HR_TS.indexOf('if (api === "hr_rc_get")');
  if (at < 0) throw new Error("hr_rc_get is gone — this test is now lying about what the server sends");
  const ret = HR_TS.indexOf("return j({ ok:true", at);
  const end = HR_TS.indexOf("\n", ret);
  return HR_TS.slice(ret, end);
}

Deno.test("hr_rc_get still tells the client whether this viewer may act", () => {
  assertMatch(rcGetReturn(), /can_act:/, "hr_rc_get stopped sending can_act — hrRCDetail's gate now reads undefined, which is falsy, so NOBODY can approve from the screen");
});

Deno.test("every can_* capability hr_rc_get returns is read by hros.html", () => {
  const flags = [...rcGetReturn().matchAll(/\b(can_[a-z_]+):/g)].map((m) => m[1]);
  // Guard the guard: if the extraction stops finding flags this test passes vacuously.
  assertEquals(flags.length > 0, true, "found no can_* flags in hr_rc_get's response — the extraction broke");
  const unread = flags.filter((f) => !HROS.includes("d." + f));
  assertEquals(unread, [], "hr_rc_get computes these and the screen ignores them, so the control they " +
    "are meant to gate is drawn for people the server will refuse: " + unread.join(", "));
});

Deno.test("the approver buttons are gated on can_act, not on the claim's status", () => {
  const body = fnSource(HROS, "hrRCDetail");
  // The panel that carries ✓ Approve must be behind can_act. Matching the CONDITION rather than merely
  // "does the file mention can_act" — the first cut of this test passed with the flag read somewhere
  // else in the function and the button still drawn on `pending` alone.
  const gate = body.match(/if\s*\(([^)]*)\)\s*\{\s*actions\s*=\s*'<div class="panel"><div class="panel-hd"><h3>Approver actions/);
  assertEquals(!!gate, true, "could not find the Approver-actions branch in hrRCDetail — if it was renamed, re-point this test rather than deleting it");
  assertMatch(gate![1], /can_act/, "the Approver actions panel is drawn on the claim's STATUS alone. " +
    "Status says the claim is open; it does not say THIS viewer may act on it. hr_rc_decide will refuse " +
    "on click, which is how a correct segregation-of-duties refusal came to look like a broken button.");
});

Deno.test("a viewer who cannot act is told whose step it is", () => {
  const body = fnSource(HROS, "hrRCDetail");
  assertMatch(body, /assignee_name/, "hrRCDetail no longer shows the step's assignee. Hiding the button " +
    "without naming the approver leaves the operator with no way to find out who to chase — the step can " +
    "be assigned to a named employee, and the server's refusal names a ROLE only.");
});

Deno.test("the server's refusal names the human, not just the role", () => {
  const decide = fnSource(HR_TS, "rcDecideOne");
  const at = decide.indexOf("You are not the approver for this step");
  assertEquals(at >= 0, true, "the not-the-approver refusal is gone — re-point this test");
  // A step assigned by NAME has no approver_role, which is exactly the shape the amount-band workflows
  // produce, so a role-only message tells that operator nothing at all.
  const around = decide.slice(Math.max(0, at - 700), at + 200);
  assertMatch(around, /approver_employee_id/, "the refusal only handles approver_role. A step assigned to " +
    "a named employee then refuses without saying who it belongs to.");
});
