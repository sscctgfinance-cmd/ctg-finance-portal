// The router still routes — all 203 actions, unchanged.
//
// WHY THIS FILE EXISTS: v209 split a 7,563-line single-file edge function into a router plus three
// modules. Nothing in this repo covered the ~200 actions the portal serves; a handler that stopped
// matching, or one that lost the auth gate at the top of its body, would have deployed straight to
// production (there is no staging) and surfaced as a phone call.
//
// The golden was captured from the PRE-split file and is the contract: for every action name, what an
// anonymous POST {api:"<name>"} gets back. Three failure modes it catches, all verified by deliberately
// breaking a scratch copy before this was committed:
//   - a dropped handler      → 400 "unknown action: <name>" instead of its real refusal
//   - a removed auth gate    → 200 instead of 401/403
//   - an inner branch lifted out of a grouped guard (ctg_access_*, clock_*, hr_tp1_*, hr_stat_ids_*)
//     → 500 ReferenceError, because it lost the outer block's bindings AND its auth
//
// It cannot see behind an auth gate — that is by design, and why it needs no credentials.
//
// If you change an anonymous response ON PURPOSE, regenerate:
//   deno run -A tools/route_probe.ts supabase/functions/portal/index.ts tests/route_parity.golden.jsonl

import { assertEquals } from "jsr:@std/assert@1";
import { actionNames, functionSources, probeRoutes } from "../tools/route_probe.ts";

const FN_DIR = new URL("../supabase/functions/portal/", import.meta.url);
const golden = (await Deno.readTextFile(new URL("./route_parity.golden.jsonl", import.meta.url)))
  .split("\n").filter(Boolean);
const names = actionNames(await functionSources(FN_DIR));

Deno.test("every action name in the golden is still routed, and none were added", () => {
  const goldNames = golden.map((l) => JSON.parse(l).api).filter((a: string) => a !== "(empty)");
  assertEquals(names, goldNames,
    "the set of {api:\"...\"} names the edge function routes has changed — a dropped name is a dead " +
    "feature, an added one needs a golden regenerated on purpose");
});

Deno.test("anonymous callers get the same answer from every action as before the split", async () => {
  const actual = await probeRoutes(new URL("./index.ts", FN_DIR).href, names);
  assertEquals(actual.length, golden.length);
  const diffs = actual.map((a, i) => [a, golden[i]] as const).filter(([a, g]) => a !== g);
  assertEquals(diffs.map(([a, g]) => `\n  now: ${a}\n  was: ${g}`).join(""), "",
    "an action changed how it answers an unauthenticated caller");
});
