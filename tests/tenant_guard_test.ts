// The central v95 tenant-isolation guard must see the company id the HANDLERS see.
//
// WHY THIS FILE EXISTS: the guard was gated on `typeof b.tenant === "string"`, so the same company id
// sent as a one-element array skipped it — while the handlers still resolved it, because they coerce
// with String(b.tenant||"") and String(["<uuid>"]) === "<uuid>". 14 tenant-scoped handlers do no
// company check of their own, and hr_dashboard passes no token to its RPC, so nothing downstream
// could re-pin the company either. An authenticated HR user assigned only company A could read
// company B. Against the pre-fix router the array case below returned:
//   200 {"ok":true,"data":null,"month":8,"year":2026}   and the RPC received company B.
//
// Offline and credential-free, like tools/route_probe.ts: every fetch is answered here, so the
// transcript depends only on the router's own guard.

import { assertEquals } from "jsr:@std/assert@1";

const FN = new URL("../supabase/functions/portal/index.ts", import.meta.url);
const A = "aaaaaaaa-0000-4000-8000-000000000001";   // the caller's only assigned company
const B = "bbbbbbbb-0000-4000-8000-000000000002";   // the company it is not assigned to

let handler: any = null;                            // the router, captured from its Deno.serve call
let rpcTenants: string[] = [];                      // company ids that reached the hr_dashboard RPC

/**
 * Run `fn` against the router with a stubbed backend: a valid hr_admin session allowed only company A,
 * and every fetch answered locally. All patched globals are restored before returning, so this is safe
 * to run alongside the other test files.
 */
async function withPortal(fn: (post: (tenant: unknown) => Promise<{ status: number; body: string }>) => Promise<void>) {
  const g = globalThis as any;
  const saved = { fetch: g.fetch, serve: (Deno as any).serve, envGet: Deno.env.get };
  rpcTenants = [];
  try {
    Deno.env.get = ((k: string) =>
      k === "SUPABASE_URL" ? "https://stub.supabase.co"
      : k === "SUPABASE_SERVICE_ROLE_KEY" ? "stub-service-role-key"
      : undefined) as typeof Deno.env.get;
    g.fetch = (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : (input && input.url) || input);
      let body: any = {}; try { body = JSON.parse(String((init && init.body) || "")); } catch { /* not JSON */ }
      let out = "null";
      if (url.endsWith("/rpc/portal_me")) {
        out = JSON.stringify({ ok: true, user: { id: "u1", email: "hr@example.com", role: "hr_admin" } });
      } else if (url.endsWith("/rpc/portal_allowed_tenants")) {
        out = JSON.stringify([A]);
      } else if (url.endsWith("/rpc/hr_dashboard")) {
        rpcTenants.push(String(body.p_tenant ?? ""));
      } else if (!url.includes("/rpc/")) {
        out = "[]";
      }
      return Promise.resolve(new Response(out, {
        status: 200, headers: { "content-type": "application/json", "content-range": "*/0" },
      }));
    };
    (Deno as any).serve = (a: any, c?: any) => {
      handler = typeof a === "function" ? a : c;
      return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {} };
    };
    await import(FN.href);   // only the first call actually evaluates it; `handler` is kept after that
    if (!handler) throw new Error("module never called Deno.serve — the router did not boot");
    await fn(async (tenant: unknown) => {
      const res = await handler(new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api: "hr_dashboard", token: "valid-session-token", tenant, month: 8, year: 2026 }),
      }));
      return { status: res.status, body: await res.text() };
    });
  } finally {
    g.fetch = saved.fetch;
    (Deno as any).serve = saved.serve;
    Deno.env.get = saved.envGet;
  }
}

Deno.test("a company the caller is not assigned to is refused — tenant as a string", async () => {
  await withPortal(async (post) => {
    const r = await post(B);
    assertEquals(r.status, 403);
    assertEquals(JSON.parse(r.body).error, "forbidden: you do not have access to this company");
    assertEquals(rpcTenants, [], "the handler ran anyway and queried the company it was refused");
  });
});

Deno.test("a company the caller is not assigned to is refused — tenant as a one-element array", async () => {
  await withPortal(async (post) => {
    const r = await post([B]);
    assertEquals(r.status, 403, "the guard was skipped: an array-wrapped company id bypassed tenant isolation");
    assertEquals(JSON.parse(r.body).error, "forbidden: you do not have access to this company");
    assertEquals(rpcTenants, [], "the handler read a company the caller is not assigned to");
  });
});

Deno.test("the caller's own company still works, string or one-element array", async () => {
  await withPortal(async (post) => {
    assertEquals((await post(A)).status, 200);
    assertEquals((await post([A])).status, 200);
    assertEquals(rpcTenants, [A, A], "the handler must resolve exactly the company the guard checked");
  });
});

Deno.test("a company id of any other shape is refused, not coerced into a lookup key", async () => {
  await withPortal(async (post) => {
    for (const bad of [[A, B], { id: A }, 42, [[A]]]) {
      const r = await post(bad);
      assertEquals(r.status, 400, `not refused: ${JSON.stringify(bad)}`);
      assertEquals(JSON.parse(r.body).error, "bad tenant");
    }
    assertEquals(rpcTenants, []);
  });
});
