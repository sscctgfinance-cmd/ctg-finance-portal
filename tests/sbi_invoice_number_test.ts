// A new self-billed invoice gets a number nobody holds — whatever happened to the invoices before it.
//
// WHY THIS FILE EXISTS: on 2026-09-30 no CTG4U ILADY self-billed invoice could be created at all —
// "duplicate key value violates unique constraint portal_self_billed_invoices_invoice_no_key". The number
// was "this company's invoices dated this year" + 1. Invoice 85 had been created as SB-ILADY-2026-0050
// and then moved to CTG4U JEEROUL (an edit keeps the number), so ILADY was left with 49 rows, every new
// ILADY invoice computed 0050, and the globally-UNIQUE invoice_no refused it. JEEROUL was one invoice
// away from the same wall (12 rows, highest 0013, 0010 missing).
//
// The number is now the highest in its series across the WHOLE table + 1, with a retry when two
// invoices are created in the same instant. Driven end to end through the real handler against an
// in-memory PostgREST (tests/user_scope_escalation_test.ts's technique), with the live data's shape.

import { assertEquals } from "jsr:@std/assert@1";

const FN = new URL("../supabase/functions/portal/index.ts", import.meta.url);
const ILADY = "99911869-9e91-4572-b7dc-4db51b45b6a9";
const JEEROUL = "61908473-c252-4a55-9d9e-6e36a80ad749";
const NAMES: Record<string, string> = { [ILADY]: "CTG4U ILADY SDN BHD", [JEEROUL]: "CTG4U JEEROUL SDN BHD" };

type Inv = { id: number; tenant_id: string; invoice_no: string; invoice_date: string };
type State = { invoices: Inv[]; raceOnce?: string; inserted: string[] };

let handler: any = null;

function matches(row: Record<string, any>, params: URLSearchParams): boolean {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "columns", "on_conflict"].includes(k)) continue;
    const val = String(row[k]);
    if (v.startsWith("eq.")) { if (val !== v.slice(3)) return false; }
    else if (v.startsWith("like.")) {
      const re = new RegExp("^" + v.slice(5).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$");
      if (!re.test(val)) return false;
    } else throw new Error(`fake PostgREST: unsupported filter ${k}=${v}`);
  }
  return true;
}

async function withPortal(st: State, fn: (save: (tenant: string, date: string) => Promise<any>) => Promise<void>) {
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
      const hdr = new Headers((init && init.headers) || {});
      const one = /vnd\.pgrst\.object/.test(hdr.get("accept") || "");
      let body: any = null; try { body = JSON.parse(String((init && init.body) || "")); } catch { /* none */ }
      const reply = (x: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(x), {
        status, headers: { "content-type": "application/json", "content-range": "*/" + (Array.isArray(x) ? x.length : 0) },
      }));
      const rows = (list: any[]) => one ? (list.length ? reply(list[0]) : reply({ code: "PGRST116", message: "0 rows" }, 406)) : reply(list);
      const p = u.pathname;
      if (p.endsWith("/rpc/portal_me")) return reply({ ok: true, user: { id: "u1", email: "boss@ctg.test", role: "admin" } });
      if (p.endsWith("/rpc/portal_allowed_tenants")) return reply([ILADY, JEEROUL]);
      if (p.includes("/rpc/")) return reply(null);
      const table = p.split("/").pop();
      if (table === "portal_individuals") return rows([{ id: 7, name: "KOH JIA XUAN", id_type: "ic", id_no: "x", tin: "IG1", address: "", bank_name: "UOB BANK", bank_account: "1103061658" }]);
      if (table === "xero_tenants") return rows([{ tenant_name: NAMES[u.searchParams.get("tenant_id")!.slice(3)] }]);
      if (table === "portal_company_info") return rows([]);
      if (table === "portal_audit") return reply([], 201);
      if (table === "portal_self_billed_invoices") {
        if (method === "GET") return rows(st.invoices.filter((r) => matches(r, u.searchParams)));
        if (method === "POST") {
          const r = Array.isArray(body) ? body[0] : body;
          // A second user creating an invoice in the same instant takes this number first.
          if (st.raceOnce && r.invoice_no === st.raceOnce) {
            st.invoices.push({ id: 9000, tenant_id: r.tenant_id, invoice_no: st.raceOnce, invoice_date: r.invoice_date });
            st.raceOnce = undefined;
          }
          if (st.invoices.some((x) => x.invoice_no === r.invoice_no)) {
            return reply({ code: "23505", message: 'duplicate key value violates unique constraint "portal_self_billed_invoices_invoice_no_key"' }, 409);
          }
          const saved = { ...r, id: st.invoices.length + 1 };
          st.invoices.push(saved); st.inserted.push(r.invoice_no);
          return one ? reply(saved, 201) : reply([saved], 201);
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
    await fn(async (tenant, date) => {
      const res = await handler(new Request("http://localhost/", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ api: "sbi_save", token: "t", invoice: {
          tenant_id: tenant, individual_id: 7, invoice_date: date, due_date: date,
          line_items: [{ description: "Casual Wages for YRDZ Event", qty: 2, unit_price: 150 }],
        } }),
      }));
      return JSON.parse(await res.text());
    });
  } finally {
    g.fetch = saved.fetch;
    (Deno as any).serve = saved.serve;
    Deno.env.get = saved.envGet;
  }
}

/** The live shape on 2026-09-30: ILADY 0001–0049, plus ILADY-0050 now belonging to JEEROUL; JEEROUL 0001–0013 without 0010. */
function live(): State {
  const inv: Inv[] = [];
  let id = 1;
  for (let n = 1; n <= 49; n++) inv.push({ id: id++, tenant_id: ILADY, invoice_no: "SB-ILADY-2026-" + String(n).padStart(4, "0"), invoice_date: "2026-09-23" });
  inv.push({ id: 85, tenant_id: JEEROUL, invoice_no: "SB-ILADY-2026-0050", invoice_date: "2026-06-29" });
  for (let n = 1; n <= 13; n++) if (n !== 10) inv.push({ id: id++, tenant_id: JEEROUL, invoice_no: "SB-JEEROUL-2026-" + String(n).padStart(4, "0"), invoice_date: "2026-08-01" });
  return { invoices: inv, inserted: [] };
}

Deno.test("an ILADY invoice can be created although its old 0050 now sits on a JEEROUL invoice", async () => {
  const st = live();
  await withPortal(st, async (save) => {
    const r = await save(ILADY, "2026-07-31");
    assertEquals(r.ok !== false, true, `refused: ${JSON.stringify(r)}`);
    assertEquals(st.inserted, ["SB-ILADY-2026-0051"]);
  });
});

Deno.test("a series with a gap continues after its HIGHEST number, not after its row count", async () => {
  const st = live();
  await withPortal(st, async (save) => {
    const r = await save(JEEROUL, "2026-09-30");
    assertEquals(r.ok !== false, true, `refused: ${JSON.stringify(r)}`);
    assertEquals(st.inserted, ["SB-JEEROUL-2026-0014"], "JEEROUL has 12 rows but 0013 is taken — count+1 collides");
  });
});

Deno.test("two invoices created in the same instant both succeed, with different numbers", async () => {
  const st = { ...live(), raceOnce: "SB-ILADY-2026-0051" };
  await withPortal(st, async (save) => {
    const r = await save(ILADY, "2026-07-31");
    assertEquals(r.ok !== false, true, `the losing request surfaced the duplicate-key error: ${JSON.stringify(r)}`);
    assertEquals(st.inserted, ["SB-ILADY-2026-0052"]);
  });
});

Deno.test("a company's first invoice of a year starts at 0001", async () => {
  const st = live();
  await withPortal(st, async (save) => {
    await save(ILADY, "2027-01-05");
    assertEquals(st.inserted, ["SB-ILADY-2027-0001"]);
  });
});
