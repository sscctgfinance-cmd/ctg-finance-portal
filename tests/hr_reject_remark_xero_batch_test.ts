// Reject + remark, sending an approved claim back, and the Xero batch's skip rule (2026-10-06).
//
// WHY THIS FILE EXISTS: the operator asked for a remark on every rejection and for approved claims to be
// postable to Xero in bulk. Three server rules carry the weight, and each has a failure that looks fine
// on screen:
//   - hr_leave_decide refuses a rejection with no reason. No screen ever sent one, so every employee was
//     told "was rejected." — and a caller that skips the prompt must not be able to bring that back.
//   - hr_rc_reject_approved returns an APPROVED claim to the employee — but never one already PAID (that
//     is a refund) or already a bill in Xero (re-posting would silently adopt the old bill), and only with
//     a remark, and only for Finance/admin. Its status write is conditional, so a payment that lands in
//     the same moment wins.
//   - hr_rc_post_xero reports a company with no Xero organisation as SKIPPED before it calls Xero at all;
//     the batch lists those apart from real failures.
// Driven through the real router against an in-memory PostgREST (tests/user_scope_escalation_test.ts).

import { assertEquals } from "jsr:@std/assert@1";

const FN = new URL("../supabase/functions/portal/index.ts", import.meta.url);
const T_XERO = "99911869-9e91-4572-b7dc-4db51b45b6a9";   // CTG4U ILADY — connected to Xero
const T_NONX = "cfd38e40-ace3-4c9f-849b-3c864b01d3f2";   // JOURISH — no Xero

type Claim = { id: string; tenant_id: string; status: string; xero_bill_id: string | null; claim_no: string; amount: number; claim_type_id?: string };
type World = {
  role: string; finance: boolean; claims: Claim[];
  writes: { table: string; method: string; params: string; body: any }[];
  xeroCalls: number; leave?: any;
  /** Every request our server sent to Xero, in order. */
  xeroLog?: { method: string; url: string; body: any }[];
  /** Make Xero refuse the next update (a paid bill is not editable). */
  xeroRefuse?: boolean;
};

let handler: any = null;

function matches(row: Record<string, any>, params: URLSearchParams): boolean {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "columns"].includes(k)) continue;
    const val = row[k];
    if (v.startsWith("eq.")) { if (String(val) !== v.slice(3)) return false; }
    else if (v === "is.null") { if (val !== null && val !== undefined) return false; }
    else if (v.startsWith("in.(")) { if (!v.slice(4, -1).split(",").map((x) => x.replace(/"/g, "")).includes(String(val))) return false; }
    else return false;
  }
  return true;
}

async function withPortal(w: World, fn: (post: (body: Record<string, unknown>) => Promise<any>) => Promise<void>) {
  const g = globalThis as any;
  const saved = { fetch: g.fetch, serve: (Deno as any).serve, envGet: Deno.env.get };
  try {
    Deno.env.get = ((k: string) =>
      k === "SUPABASE_URL" ? "https://stub.supabase.co" : k === "SUPABASE_SERVICE_ROLE_KEY" ? "stub" : undefined) as typeof Deno.env.get;
    g.fetch = (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : (input && input.url) || input);
      if (url.includes("xero.com")) {
        w.xeroCalls++;
        const m = String((init && init.method) || "GET").toUpperCase();
        let xb: any = null; try { xb = JSON.parse(String((init && init.body) || "")); } catch { /* binary / none */ }
        (w.xeroLog ||= []).push({ method: m, url, body: xb });
        if (m === "GET") return Promise.resolve(new Response(JSON.stringify({ Invoices: [] }), { status: 200 }));
        if (w.xeroRefuse) return Promise.resolve(new Response(JSON.stringify({ Elements: [{ ValidationErrors: [{ Message: "Invoice not of valid status for modification" }] }] }), { status: 400 }));
        return Promise.resolve(new Response(JSON.stringify({ Invoices: [{ InvoiceID: "new-bill" }] }), { status: 200 }));
      }
      const u = new URL(url);
      const method = String((init && init.method) || "GET").toUpperCase();
      const one = /vnd\.pgrst\.object/.test(new Headers((init && init.headers) || {}).get("accept") || "");
      let body: any = null; try { body = JSON.parse(String((init && init.body) || "")); } catch { /* none */ }
      const reply = (x: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(x), {
        status, headers: { "content-type": "application/json", "content-range": "*/" + (Array.isArray(x) ? x.length : 0) } }));
      const rows = (list: any[]) => one ? (list.length ? reply(list[0]) : reply({ code: "PGRST116", message: "0 rows" }, 406)) : reply(list);
      const p = u.pathname, table = p.split("/").pop()!;
      if (p.endsWith("/rpc/portal_me")) return reply({ ok: true, user: { id: "u1", email: "me@ctg.test", role: w.role } });
      if (p.endsWith("/rpc/portal_allowed_tenants")) return reply([T_XERO, T_NONX]);
      if (p.includes("/rpc/")) return reply(null);
      if (method !== "GET") w.writes.push({ table, method, params: u.searchParams.toString(), body });
      if (table === "hr_employees" && method === "GET") return rows(w.finance ? [{ id: "e9", user_id: "u1", tenant_id: T_XERO, name: "FIN" }] : []);
      if (table === "hr_claim_role_approvers") return rows(w.finance ? [{ role: "finance", tenant_id: T_XERO }] : []);
      if (table === "xero_tenants") {
        const id = (u.searchParams.get("tenant_id") || "").slice(3);
        return rows([{ tenant_id: id, tenant_name: id === T_NONX ? "JOURISH WELLNESS & NUTRITION SDN BHD" : "CTG4U ILADY SDN BHD", xero_connected: id !== T_NONX }]);
      }
      if (table === "hr_claim_requests") {
        if (method === "GET") return rows(w.claims.filter((c) => matches(c, u.searchParams)));
        if (method === "PATCH") {
          const hit = w.claims.filter((c) => matches(c, u.searchParams));
          hit.forEach((c) => Object.assign(c, body));
          return reply(hit);
        }
      }
      if (table === "hr_leave_requests" && method === "GET") return rows(w.leave ? [w.leave] : []);
      if (table === "xero_tokens") return rows([{ access_token: "x", access_token_expires_at: "2999-01-01T00:00:00Z" }]);
      if (table === "hr_claim_items") return rows([{ id: "i1", amount: 120, description: "Grab", item_date: "2026-10-01", hr_claim_types: { name: "Travel", gl_account: "903-0900" } }]);
      if (table === "hr_claim_attachments") return rows([{ id: "a1", file_path: "t/r.jpg", file_name: "r.jpg" }]);
      return method === "GET" ? rows([]) : reply([], 201);
    };
    (Deno as any).serve = (a: any, c?: any) => { handler = typeof a === "function" ? a : c; return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {} }; };
    await import(FN.href);
    if (!handler) throw new Error("router did not boot");
    await fn(async (body) => {
      const res = await handler(new Request("http://localhost/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "t", ...body }) }));
      return { status: res.status, ...JSON.parse(await res.text()) };
    });
  } finally {
    g.fetch = saved.fetch; (Deno as any).serve = saved.serve; Deno.env.get = saved.envGet;
  }
}

const world = (over: Partial<World> = {}): World => ({
  role: "admin", finance: false, writes: [], xeroCalls: 0,
  claims: [{ id: "c1", tenant_id: T_XERO, status: "Approved", xero_bill_id: null, claim_no: "IPC-202610-0001", amount: 120 }],
  ...over,
});
const statusWrites = (w: World) => w.writes.filter((x) => x.table === "hr_claim_requests" && x.method === "PATCH");

Deno.test("an approved, unpaid, not-in-Xero claim is sent back — with its remark, conditionally", async () => {
  const w = world();
  await withPortal(w, async (post) => {
    const r = await post({ api: "hr_rc_reject_approved", id: "c1", comment: "  Receipt is for a different date  " });
    assertEquals([r.ok, r.status], [true, "Rejected"], JSON.stringify(r));
    assertEquals(w.claims[0].status, "Rejected");
    const sw = statusWrites(w)[0];
    // The write is conditional on everything that was checked, so a payment or a post landing in the same
    // instant makes it match no row instead of overwriting it.
    assertEquals(/status=eq\.Approved/.test(sw.params) && /xero_bill_id=is\.null/.test(sw.params), true, sw.params);
    const com = w.writes.find((x) => x.table === "hr_claim_comments");
    assertEquals(com && com.body.comment, "Receipt is for a different date");
  });
});

Deno.test("sending back is refused without a remark, once paid, or once in Xero — and nothing is written", async () => {
  const cases: [Partial<Claim>, string, RegExp][] = [
    [{}, "", /reason/],
    [{ status: "Paid" }, "x", /Only an Approved, unpaid claim/],
    [{ xero_bill_id: "bill-1" }, "x", /Void that bill in Xero first/],
  ];
  for (const [over, comment, err] of cases) {
    const w = world();
    Object.assign(w.claims[0], over);
    await withPortal(w, async (post) => {
      const r = await post({ api: "hr_rc_reject_approved", id: "c1", comment });
      assertEquals(r.ok, false, JSON.stringify(over));
      assertEquals(err.test(String(r.error)), true, `${JSON.stringify(over)} → ${r.error}`);
      assertEquals(statusWrites(w).length, 0, "a refused send-back still wrote the claim");
    });
  }
});

Deno.test("only Finance or an admin may send an approved claim back", async () => {
  const w = world({ role: "employee" });
  await withPortal(w, async (post) => {
    const r = await post({ api: "hr_rc_reject_approved", id: "c1", comment: "x" });
    assertEquals([r.status, r.ok], [403, false]);
    assertEquals(statusWrites(w).length, 0);
  });
  const f = world({ role: "employee", finance: true });
  await withPortal(f, async (post) => {
    const r = await post({ api: "hr_rc_reject_approved", id: "c1", comment: "x" });
    assertEquals(r.ok, true, "a Finance approver was refused: " + JSON.stringify(r));
  });
});

Deno.test("a claim of a company with no Xero is SKIPPED, before anything is sent to Xero", async () => {
  const w = world({ claims: [{ id: "c2", tenant_id: T_NONX, status: "Approved", xero_bill_id: null, claim_no: "JRS-202610-0001", amount: 80 }] });
  await withPortal(w, async (post) => {
    const r = await post({ api: "hr_rc_post_xero", id: "c2" });
    assertEquals([r.ok, r.skipped], [false, true], JSON.stringify(r));
    assertEquals(/not connected to Xero/.test(r.error), true, r.error);
    assertEquals(w.xeroCalls, 0, "the skip still called Xero");
  });
});

Deno.test("a leave rejection without a reason is refused before the request is even read", async () => {
  const w = world({ leave: { id: "lv1", status: "Pending Approval", employee_id: "e1", tenant_id: T_XERO, current_step: 1 } });
  await withPortal(w, async (post) => {
    for (const comment of [undefined, "", "   "]) {
      const r = await post({ api: "hr_leave_decide", id: "lv1", decision: "reject", comment });
      assertEquals(r.ok, false, `comment=${JSON.stringify(comment)}`);
      assertEquals(/reason/.test(String(r.error)), true, String(r.error));
    }
    assertEquals(w.writes.length, 0, "a refused rejection wrote something");
  });
});

// ── The claim number reaches the bill's REFERENCE column (2026-10-06) ─────────────────────────────────
// Xero's own OpenAPI spec: `Reference` is "ACCREC only"; on a bill the visible Reference column is
// `InvoiceNumber`. Every claim bill posted before this carried its number only in the dropped field.
const xeroPosts = (w: World) => (w.xeroLog || []).filter((x) => x.method === "POST" && /\/Invoices$/.test(x.url));

Deno.test("a new claim bill carries its claim number as InvoiceNumber — the bill's Reference column", async () => {
  const w = world();
  await withPortal(w, async (post) => {
    const r = await post({ api: "hr_rc_post_xero", id: "c1" });
    assertEquals(r.ok, true, JSON.stringify(r));
    const inv = xeroPosts(w)[0].body.Invoices[0];
    assertEquals([inv.Type, inv.InvoiceNumber], ["ACCPAY", "IPC-202610-0001"]);
    // …and the duplicate guard looks where the number actually is.
    const q = decodeURIComponent((w.xeroLog || []).find((x) => x.method === "GET")!.url);
    assertEquals(/InvoiceNumber=="IPC-202610-0001"/.test(q), true, q);
  });
});

Deno.test("a claim already in Xero gets ONLY its reference written — no second bill, no receipts re-uploaded", async () => {
  const w = world(); w.claims[0].xero_bill_id = "old-bill";
  await withPortal(w, async (post) => {
    const r = await post({ api: "hr_rc_post_xero", id: "c1" });
    assertEquals([r.ok, r.resynced], [true, true], JSON.stringify(r));
    const sent = w.xeroLog || [];
    assertEquals(sent.length, 1, "re-sync sent more than the one update: " + sent.map((x) => x.method + " " + x.url).join(" | "));
    assertEquals(sent[0].body.Invoices[0], { InvoiceID: "old-bill", InvoiceNumber: "IPC-202610-0001", Reference: "IPC-202610-0001" });
  });
});

Deno.test("when Xero refuses the reference update, the screen is told — not 'updated ✓'", async () => {
  const w = { ...world(), xeroRefuse: true }; w.claims[0].xero_bill_id = "paid-bill";
  await withPortal(w, async (post) => {
    const r = await post({ api: "hr_rc_post_xero", id: "c1" });
    assertEquals(r.ok, false);
    assertEquals(/not of valid status/.test(r.error) && /Reference was not changed/.test(r.error), true, r.error);
  });
});
