// A company-scoped admin must not be able to make ANY account — least of all their own — group-wide.
//
// WHY THIS FILE EXISTS: zero `portal_user_companies` rows is not "no access" for an admin. Since
// 2026-09-07 `portal_allowed_tenants` reads it as FULL SCOPE (CLAUDE.md, "adding a company demotes every
// full-scope admin" — the fix for that trap). That made an empty company set a GRANT of every company,
// and `user_update` never learned it:
//
//   {api:"user_update", token:<scoped admin>, user_id:<themselves>, tenants:[]}
//
//   - userWriteAllowed  passed — the target (self) sits inside the caller's own scope;
//   - tenantsAssignable passed — `[]` is vacuously a subset of anything;
//   - then the handler DELETED every row and inserted none.
//
// One request, and a single-company admin (four of them exist) was a full-scope admin of the whole group:
// every company's payroll, bank accounts and Xero ledgers. `user_create` already had the rule — "no
// companies at all = group-wide; only a group-wide admin may mint one" — `user_update` did not.
//
// A second route to the same place: an entry with no tenant_id was dropped from the CHECK but kept for the
// INSERT, which then failed AFTER the delete had run — leaving the target with zero rows. So the write is
// also add-then-remove now: a failure part-way leaves a superset, never an empty set.
//
// Offline and credential-free (tools/route_probe.ts's technique): the router boots in-process and every
// Supabase call is answered by the small in-memory PostgREST below, so the assertions are about what the
// handler actually WROTE, not about its source text.

import { assertEquals } from "jsr:@std/assert@1";

const FN = new URL("../supabase/functions/portal/index.ts", import.meta.url);
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const C = "cccccccc-0000-4000-8000-00000000000c";
const ALL = [A, B, C];

type Row = { user_id: string; tenant_id: string; role: string | null };
type State = { users: Record<string, { role: string; active: boolean }>; companies: Row[]; token: Record<string, string>; failInsert?: boolean };

let handler: any = null;

/** The subset of PostgREST's filter grammar the handlers under test use. */
function matches(row: Record<string, any>, params: URLSearchParams): boolean {
  for (const [k, v] of params) {
    if (["select", "on_conflict", "order", "limit", "columns"].includes(k)) continue;
    const val = String(row[k]);
    if (v.startsWith("eq.")) { if (val !== v.slice(3)) return false; }
    else if (v.startsWith("not.in.(")) {
      const set = v.slice(8, -1).split(",").map((s) => s.replace(/^"|"$/g, ""));
      if (set.includes(val)) return false;
    } else if (v.startsWith("in.(")) {
      const set = v.slice(4, -1).split(",").map((s) => s.replace(/^"|"$/g, ""));
      if (!set.includes(val)) return false;
    } else throw new Error(`fake PostgREST: unsupported filter ${k}=${v}`);
  }
  return true;
}

function allowed(st: State, uid: string): string[] {
  const u = st.users[uid]; if (!u) return ["00000000-0000-0000-0000-000000000000"];
  const mine = st.companies.filter((r) => r.user_id === uid).map((r) => r.tenant_id);
  if (u.role === "admin" && (!mine.length || mine.length >= ALL.length)) return [...ALL];
  return mine.length ? mine : ["00000000-0000-0000-0000-000000000000"];
}

async function withPortal(st: State, fn: (post: (who: string, body: Record<string, unknown>) => Promise<{ status: number; json: any }>) => Promise<void>) {
  const g = globalThis as any;
  const saved = { fetch: g.fetch, serve: (Deno as any).serve, envGet: Deno.env.get };
  try {
    Deno.env.get = ((k: string) =>
      k === "SUPABASE_URL" ? "https://stub.supabase.co"
      : k === "SUPABASE_SERVICE_ROLE_KEY" ? "stub-service-role-key"
      : undefined) as typeof Deno.env.get;
    g.fetch = (input: any, init?: any) => {
      const u = new URL(String(typeof input === "string" ? input : (input && input.url) || input));
      const method = String((init && init.method) || "GET").toUpperCase();
      let body: any = null; try { body = JSON.parse(String((init && init.body) || "")); } catch { /* none */ }
      const reply = (x: unknown, status = 200) => Promise.resolve(new Response(x === undefined ? "" : JSON.stringify(x), {
        status, headers: { "content-type": "application/json", "content-range": "*/" + (Array.isArray(x) ? x.length : 0) },
      }));
      const p = u.pathname;
      if (p.endsWith("/rpc/portal_me")) {
        const uid = st.token[String(body && body.p_token)];
        return reply(uid ? { ok: true, user: { id: uid, email: uid + "@example.com", role: st.users[uid].role } } : { ok: false });
      }
      if (p.endsWith("/rpc/portal_allowed_tenants")) return reply(allowed(st, st.token[String(body && body.p_token)] || ""));
      if (p.includes("/rpc/")) return reply(null);
      const table = p.split("/").pop();
      if (table === "xero_tenants") return reply(ALL.map((t) => ({ tenant_id: t })));
      if (table === "portal_audit") return reply([], 201);
      if (table === "portal_users" && method === "PATCH") {
        for (const [uid, row] of Object.entries(st.users)) if (matches({ id: uid }, u.searchParams)) Object.assign(row, body);
        return reply([]);
      }
      if (table === "portal_user_companies") {
        if (method === "GET" || method === "HEAD") return reply(st.companies.filter((r) => matches(r, u.searchParams)));
        if (method === "DELETE") { st.companies = st.companies.filter((r) => !matches(r, u.searchParams)); return reply([]); }
        if (method === "POST") {
          const rows: Row[] = Array.isArray(body) ? body : [body];
          if (st.failInsert || rows.some((r) => !r.tenant_id)) return reply({ message: "null value in column \"tenant_id\"" }, 400);
          for (const r of rows) {
            const i = st.companies.findIndex((x) => x.user_id === r.user_id && x.tenant_id === r.tenant_id);
            if (i >= 0) st.companies[i] = { ...st.companies[i], ...r };
            else st.companies.push({ user_id: r.user_id, tenant_id: r.tenant_id, role: r.role ?? null });
          }
          return reply([], 201);
        }
      }
      return reply([]);
    };
    (Deno as any).serve = (a: any, c?: any) => {
      handler = typeof a === "function" ? a : c;
      return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {} };
    };
    await import(FN.href);
    if (!handler) throw new Error("module never called Deno.serve — the router did not boot");
    await fn(async (who, body) => {
      const tok = Object.keys(st.token).find((t) => st.token[t] === who)!;
      const res = await handler(new Request("http://localhost/", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ api: "user_update", token: tok, ...body }),
      }));
      return { status: res.status, json: JSON.parse(await res.text()) };
    });
  } finally {
    g.fetch = saved.fetch;
    (Deno as any).serve = saved.serve;
    Deno.env.get = saved.envGet;
  }
}

/** A scoped admin on company A, a staff member on A, and a group-wide admin (zero rows). */
function world(): State {
  return {
    users: { scoped: { role: "admin", active: true }, staff: { role: "employee", active: true }, boss: { role: "admin", active: true } },
    companies: [
      { user_id: "scoped", tenant_id: A, role: null },
      { user_id: "staff", tenant_id: A, role: null },
    ],
    token: { "tok-scoped": "scoped", "tok-staff": "staff", "tok-boss": "boss" },
  };
}
const rowsOf = (st: State, uid: string) => st.companies.filter((r) => r.user_id === uid).map((r) => r.tenant_id).sort();

Deno.test("a scoped admin cannot make THEMSELVES group-wide by clearing their companies", async () => {
  const st = world();
  await withPortal(st, async (post) => {
    const r = await post("scoped", { user_id: "scoped", tenants: [] });
    assertEquals(r.status, 403, `refused? ${JSON.stringify(r.json)}`);
    assertEquals(rowsOf(st, "scoped"), [A], "the caller's own company rows were wiped — zero rows is FULL SCOPE for an admin");
    assertEquals(allowed(st, "scoped"), [A]);
  });
});

Deno.test("a scoped admin cannot promote a colleague to a group-wide admin in one request", async () => {
  const st = world();
  await withPortal(st, async (post) => {
    const r = await post("scoped", { user_id: "staff", role: "admin", tenants: [] });
    assertEquals(r.status, 403);
    assertEquals(rowsOf(st, "staff"), [A]);
    assertEquals(st.users.staff.role, "employee", "the role was written before the company check refused the request");
  });
});

Deno.test("an entry naming no company is refused BEFORE anything is written", async () => {
  const st = world();
  await withPortal(st, async (post) => {
    const r = await post("scoped", { user_id: "scoped", tenants: [A, {}] });
    assertEquals(r.status, 400);
    assertEquals(rowsOf(st, "scoped"), [A], "the delete ran and the failed insert left zero rows");
  });
});

Deno.test("a failed insert leaves the old companies in place, never an empty set", async () => {
  const st = world();
  st.companies.push({ user_id: "scoped", tenant_id: B, role: null });   // scoped on A+B
  st.failInsert = true;
  await withPortal(st, async (post) => {
    const r = await post("scoped", { user_id: "staff", tenants: [B] });
    assertEquals(r.json.ok, false);
    assertEquals(rowsOf(st, "staff"), [A], "remove-then-add: a failure between the two leaves the target with no rows");
  });
});

Deno.test("ordinary reassignment inside the caller's scope still works, and replaces the set", async () => {
  const st = world();
  st.companies.push({ user_id: "scoped", tenant_id: B, role: null });
  await withPortal(st, async (post) => {
    const r = await post("scoped", { user_id: "staff", tenants: [{ tenant_id: B, role: "viewer" }, B] });
    assertEquals(r.status, 200, JSON.stringify(r.json));
    assertEquals(rowsOf(st, "staff"), [B], "an unticked company must be removed — the server replaces the whole set");
    assertEquals(st.companies.find((x) => x.user_id === "staff")!.role, "viewer");
    // …and a company outside the caller's scope is still refused.
    assertEquals((await post("scoped", { user_id: "staff", tenants: [C] })).status, 403);
    assertEquals(rowsOf(st, "staff"), [B]);
  });
});

Deno.test("a group-wide admin may still leave an account group-wide (the 2026-09-07 design)", async () => {
  const st = world();
  await withPortal(st, async (post) => {
    const r = await post("boss", { user_id: "scoped", tenants: [] });
    assertEquals(r.status, 200, JSON.stringify(r.json));
    assertEquals(rowsOf(st, "scoped"), []);
    assertEquals(allowed(st, "scoped"), ALL);
  });
});
