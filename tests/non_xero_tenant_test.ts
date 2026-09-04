// `xero_tenants` is not only Xero's — it is how the whole group is enumerated.
//
// WHY THIS FILE EXISTS: HR OS's company picker reads `xero_tenants` directly (`hr_companies`, hr.ts),
// and NOTHING in the backend writes that table except the Xero OAuth flow. So a group entity whose
// books are not in Xero — Yuan Chuan Tang CTG4U SDN BHD, which runs on AutoCount — can only be used at
// all by holding a row there. That row then has to be invisible to every job that calls the Xero API,
// because Xero has never heard of its tenant id.
//
// Three crons iterate the table and call Xero once per company: `cron_sync` (nightly name refresh +
// backfill), `cron_drift_repair` and `cron_delta`. Unfiltered, each fails on that company on EVERY run,
// and cron_drift_repair writes its failure into `portal_audit` — a permanent daily error sitting in
// front of the cron health alarm, which is the one place a real failure has to be visible.
//
// The split this pins is the whole design:
//   • a handler that CALLS XERO per tenant  → must filter `xero_connected`
//   • a handler that LISTS companies for a human → must NOT filter, or the company disappears from the
//     picker it was added for
//
// Nothing fails at runtime when the filter is missing: the sync still "works" for the other companies
// and the failure is one line in an audit table nobody reads. That is why this is structural.

import { assertEquals, assertMatch } from "jsr:@std/assert@1";

const SRC = new URL("../supabase/functions/portal/", import.meta.url);
const FIN = await Deno.readTextFile(new URL("finance.ts", SRC));
const HR = await Deno.readTextFile(new URL("hr.ts", SRC));

/** One handler's body, from its `if (api === "x")` to the next one. */
function handler(src: string, api: string): string {
  const start = src.indexOf(`if (api === "${api}")`);
  if (start < 0) throw new Error(`handler ${api} is gone — re-point this test rather than deleting it`);
  const next = src.indexOf(`if (api === "`, start + 10);
  return src.slice(start, next < 0 ? src.length : next);
}

/** Handlers that iterate the tenant table and hand each id to the Xero API. */
const CALLS_XERO = ["cron_sync", "cron_drift_repair", "cron_delta"];

/**
 * A handler can reach the tenant list WITHOUT querying `xero_tenants` — and the first version of this
 * file could not see one that did.
 *
 * `cron_watchdog` loops `health.tenants` from the `portal_sync_health` RPC. v227 filtered the three
 * crons above and `tenants_refresh`, all of which query the table directly; this fifth consumer was
 * missed, so from the moment the non-Xero row was inserted the watchdog mailed
 * "Delta sync stalled: YUAN CHUAN TANG CTG4U SDN BHD (last ran never)" every 30 minutes — an alarm
 * that could never clear, in front of the one alarm that exists because a REAL outage went unnoticed
 * for 15 days (v71). A permanent false alarm is worse than no alarm: it teaches the operator to skip it.
 *
 * The rpc now filters too, but that is NOT what this test pins and must not be — it lives in the
 * database, applied directly (CLAUDE.md, "Things that are not covered by a push"), where nothing in
 * this repo can read it. So the handler repeats the check in TypeScript, and this is the copy that a
 * test can hold.
 */
const RPC_FED_TENANTS = ["cron_watchdog"];

Deno.test("every cron that calls Xero per company filters to Xero-connected ones", () => {
  const missing: string[] = [];
  for (const api of CALLS_XERO) {
    const body = handler(FIN, api);
    // Guard the guard: if the handler stopped reading the table at all, this test is asserting nothing.
    assertMatch(body, /from\("xero_tenants"\)/, api + " no longer reads xero_tenants — re-point this test");
    if (!/xero_connected/.test(body)) missing.push(api);
  }
  assertEquals(missing, [], "these iterate every row of xero_tenants and call the Xero API with each " +
    "tenant id, so a company that is not in Xero fails on every run — daily noise in portal_audit, in " +
    "front of the cron health alarm: " + missing.join(", "));
});

Deno.test("a handler fed tenants by an RPC still checks xero_connected itself", () => {
  for (const api of RPC_FED_TENANTS) {
    const body = handler(FIN, api);
    // Guard the guard, twice: this test means nothing if the handler stopped consuming the rpc's
    // tenant list, and nothing if it stopped looping it.
    assertMatch(body, /rpc\("portal_sync_health"\)/,
      api + " no longer calls portal_sync_health — re-point this test rather than deleting it");
    assertMatch(body, /health\.tenants/,
      api + " no longer reads health.tenants — re-point this test rather than deleting it");
    assertMatch(body, /from\("xero_tenants"\)[\s\S]{0,400}xero_connected/,
      api + " reads its tenant list from an RPC, so the `xero_connected` split is invisible to it. It " +
      "must resolve which companies are actually in Xero itself — the rpc is in the database, where no " +
      "test here can check it. Without this, a group company that is deliberately not in Xero trips " +
      "every staleness rule forever and the alarm can never clear.");
    // The skip must be NULL-safe in the same direction tenants_refresh (:1052) chose: a row whose flag
    // has not been set yet is a Xero company, so `=== true` would silently stop alarming for it.
    assertMatch(body, /xero_connected !== false/,
      api + " must treat a NULL xero_connected as connected (`!== false`), as tenants_refresh does. " +
      "`=== true` drops any tenant whose flag was never written from the alarm entirely.");
  }
});

Deno.test("the watchdog fails OPEN — a failed lookup must not silence the alarm", () => {
  const body = handler(FIN, "cron_watchdog");
  // The lookup that decides which tenants to skip can itself fail. If it does, the safe direction is
  // to keep alarming (noisy) rather than to skip every tenant (silent) — this alarm's whole purpose is
  // that a silent failure is the expensive one.
  assertMatch(body, /if \(conn && !xeroIds\.has\(/,
    "cron_watchdog must skip tenants only when the xero_tenants lookup actually returned. Written as a " +
    "bare `!xeroIds.has(t.tenant_id)`, a failed query leaves the set EMPTY and every tenant is skipped — " +
    "the watchdog reports 'ok' forever and the 15-day silent outage it exists to prevent becomes " +
    "invisible again, this time by design.");
});

Deno.test("the company PICKER does not filter — that is the point of the row", () => {
  const body = handler(HR, "hr_companies");
  assertMatch(body, /from\("xero_tenants"\)/, "hr_companies stopped reading xero_tenants — re-point this test");
  assertEquals(/xero_connected/.test(body), false,
    "hr_companies must list EVERY group company. Filtering here hides the non-Xero entity from the " +
    "HR OS picker, which is the one thing adding its row was for.");
});

Deno.test("a company that was never in Xero is not reported as having vanished from it", () => {
  const body = handler(FIN, "tenants_refresh");
  // Nothing deletes here — `removed` is reported only — but an admin pressing "refresh company names"
  // and being told a company disappeared is the alarm this panel exists to raise, spent on a false one.
  assertMatch(body, /const removed[\s\S]{0,220}xero_connected/,
    "tenants_refresh computes `removed` by absence from Xero's connection list alone, so a company that " +
    "is deliberately not in Xero is listed as removed every single time the panel is refreshed.");
  assertMatch(body, /select\("tenant_id,tenant_name,xero_connected"\)/,
    "the `removed` check reads xero_connected, so the row it judges has to carry it — otherwise every " +
    "row reads undefined and the filter silently passes everything through.");
});
