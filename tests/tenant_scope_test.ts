// An action that takes a COMPANY from the request body must check the caller is allowed to touch it.
//
// WHY THIS FILE EXISTS: `hrCanView()` answers "may this person read HR data" — it does not answer
// "WHOSE". Ten HR actions took `b.tenant` verbatim, so any admin/hr_admin/viewer could read a company
// they were deliberately not assigned by editing one field of the request: `hr_bootstrap` (every
// employee's name, IC, salary and bank account), `hr_annual` (EA / Form E / CP8D), the payroll
// dashboard, the claim list (joins ic_no and bank_account), and two of them WROTE. Six of the ten
// HR-capable accounts are full-scope; the other four are scoped to exactly one of five companies, so
// this was live exposure, not a theoretical one.
//
// It is the same bug class v190 fixed on the finance side — `portal_company_info_save` trusted the body
// while its `_get` twin checked it. Fixing it twice by hand and hoping is not a control. The test is
// structural on purpose: nothing fails at runtime when the check is missing, so the only moment it can
// be caught is while the code is being written.
//
// Adding an action that takes `b.tenant`? Either guard it, or add it to EXEMPT with the reason.

import { assertEquals } from "jsr:@std/assert@1";

const SRC = new URL("../supabase/functions/portal/", import.meta.url);
const START = /^\s*if \(api === "([a-z0-9_]+)"/gm;

/** A guard in the handler's own body … */
const GUARDS = /tenantPinned|allowedTenants|denyTenant|userWriteAllowed|isFullScopeAdmin/;
/** … or the check happens inside Postgres, because the RPC was handed the caller's token. */
const RPC_TOKEN = /p_token/;

/**
 * Actions that legitimately read a company from the body without checking it.
 * Every entry needs a reason. "It is probably fine" is not one.
 */
const EXEMPT: Record<string, string> = {
  // Unauthenticated by design: the browser's own crash beacon, posted before there is a session to
  // check. `tenant_id` on the row is a label for triage, not an access decision, and the table holds
  // no company data — only a stack trace.
  client_error: "unauthenticated crash beacon; tenant is a label, not an access decision",
};

function actions(file: string): { api: string; body: string }[] {
  const src = Deno.readTextFileSync(new URL(file, SRC));
  const hits = [...src.matchAll(START)];
  return hits.map((m, i) => ({
    api: m[1],
    body: src.slice(m.index!, i + 1 < hits.length ? hits[i + 1].index! : src.length),
  }));
}

Deno.test("every HR action that takes a company from the body checks the caller may touch it", () => {
  const unguarded: string[] = [];
  for (const { api, body } of actions("hr.ts")) {
    if (!/b\.tenant\b/.test(body)) continue;
    if (EXEMPT[api]) continue;
    if (GUARDS.test(body) || RPC_TOKEN.test(body)) continue;
    unguarded.push(api);
  }
  assertEquals(
    unguarded,
    [],
    "these HR actions read a company id from the request body and never check the caller is allowed it:\n  " +
      unguarded.join("\n  ") +
      "\nAdd `if (!(await tenantPinned(b.token, tenant))) return denyTenant(me, \"<api>\", tenant);` " +
      "or list it in EXEMPT with a reason.",
  );
});

Deno.test("the guard helpers still exist and still fail closed", async () => {
  const lib = Deno.readTextFileSync(new URL("lib.ts", SRC));
  // tenantPinned is the helper the HR handlers call. If it stops consulting allowedTenants, every one
  // of those call sites silently becomes a no-op that still reads like a security check.
  const pinned = lib.match(/export async function tenantPinned[\s\S]*?\n}/);
  assertEquals(pinned !== null, true, "tenantPinned() is gone — the HR handlers call it");
  assertEquals(/allowedTenants/.test(pinned![0]), true, "tenantPinned() no longer consults allowedTenants");

  // allowedTenants must return the deny-all sentinel — NOT [] — when it cannot answer. A [] would make
  // `alw.indexOf(t) < 0` still deny, but `alw.length && …` guards elsewhere would fall open.
  const allowed = lib.match(/export async function allowedTenants[\s\S]*?\n(?=\/\/|export)/);
  assertEquals(allowed !== null, true, "allowedTenants() is gone");
  assertEquals(
    /NO_TENANT/.test(allowed![0]) && /catch/.test(allowed![0]),
    true,
    "allowedTenants() must fall back to the NO_TENANT sentinel on any failure, including a thrown error",
  );
  await Promise.resolve();
});
