// A retry must not repeat a POST that may already have run.
//
// WHY: common.js's call() is the ONE network path both legacy apps use, for all 204 actions, and it
// retried on 502, 503 and 504 alike. Two of those three mean the request may have been processed:
//
//   503 Service Unavailable   refused before it ran — nothing happened, a retry repeats nothing
//   502 Bad Gateway           the function answered with something unusable; it may already have run
//   504 Gateway Timeout       the function did not answer in time; it is most likely STILL RUNNING
//
// And the actions most likely to hit a gateway timeout are the slow ones, because they are waiting on
// Xero — which is the same list as the ones that create money: o2o_issue, sr_post_invoices,
// sbi_post_xero, ap_post, hr_payroll_finalise, hr_rc_mark_paid. A duplicated invoice or a twice-posted
// payroll is far worse than the error message this now falls through to, which already says "retry".

import { assertEquals } from "jsr:@std/assert@1";

const COMMON = await Deno.readTextFile(new URL("../common.js", import.meta.url));
const PORTAL_TS = await Deno.readTextFile(new URL("../web/src/portal.ts", import.meta.url));

/** call()'s body, comments stripped — a status named only in prose must not count. */
const callBody = (() => {
  const at = COMMON.indexOf("async function call(body)");
  const src = COMMON.slice(at, COMMON.indexOf("\n}", at));
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
})();

Deno.test("call() retries 503 and nothing else", () => {
  assertEquals(callBody.length > 200, true, "call() was not found in common.js");
  assertEquals(/r\.status===503\s*&&\s*attempt===0/.test(callBody), true, "the 503 retry is gone");
  for (const status of ["502", "504"]) {
    assertEquals(callBody.includes(status), false,
      `call() still branches on ${status} — that status can mean the POST already ran`);
  }
});

Deno.test("it retries at most once, and never after the response was read", () => {
  // A second attempt is bounded by the loop, not by a condition somebody can widen by accident.
  assertEquals(/attempt<2/.test(callBody), true, "the retry is no longer bounded to one extra attempt");
  assertEquals((callBody.match(/continue;/g) || []).length, 1, "there is more than one retry path");
});

Deno.test("the React client still does not retry at all", () => {
  // The evidence that narrowing this is safe: web/ has shipped with no retry and nothing has been
  // reported against it. If a retry is ever added there, this file is where the reasoning lives.
  for (const status of ["502", "503", "504"]) {
    assertEquals(PORTAL_TS.includes(status), false, `web/src/portal.ts has grown a ${status} retry`);
  }
});
