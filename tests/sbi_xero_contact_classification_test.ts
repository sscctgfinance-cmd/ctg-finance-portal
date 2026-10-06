// Self-billed invoice → Xero: payee contact details, Reference, MyInvois classification (2026-10-06).
//
// WHY THIS FILE EXISTS: Xero's Malaysian e-invoicing (Invoici) submits a self-billed bill to IRBM from
// what is ON the bill in Xero. Three things never got there: the bill named its contact by NAME only (no
// TIN, IC/ID, address on the Xero contact), the number sat in `Reference` (ACCREC-only; a bill's visible
// Reference is `InvoiceNumber` — #143), and the classification code never left the portal. Invoici reads
// the classification from a TRACKING CATEGORY, "MyInvois Classification", whose options are named
// "036 - Self-billed - Others" (read from the live ZEERO org, 2026-10-06).
//
// Driven through the real router against an in-memory PostgREST and a fake Xero that records every
// request, so the assertions are on what Xero is SENT.

import { assertEquals } from "jsr:@std/assert@1";

const FIN = await Deno.readTextFile(new URL("../supabase/functions/portal/finance.ts", import.meta.url));
const FN = new URL("../supabase/functions/portal/index.ts", import.meta.url);
const T = "99911869-9e91-4572-b7dc-4db51b45b6a9";

// The live category, trimmed to the options that matter here.
const MYINVOIS = { TrackingCategoryID: "cat-mi", Name: "MyInvois Classification", Status: "ACTIVE", Options: [
  { TrackingOptionID: "opt-022", Name: "022 - Others", Status: "ACTIVE" },
  { TrackingOptionID: "opt-036", Name: "036 - Self-billed - Others", Status: "ACTIVE" },
  { TrackingOptionID: "opt-037", Name: "037 - Self-billed - Monetary payment to agents, dealers or distributors", Status: "ACTIVE" },
] };
const CHANNEL = { TrackingCategoryID: "cat-ch", Name: "Channel", Status: "ACTIVE", Options: [{ TrackingOptionID: "opt-fb", Name: "Facebook", Status: "ACTIVE" }] };

type World = {
  inv: any; payee: any; categories: any[]; existingContact: string | null; existingBill?: any; refuseUpdate?: boolean;
  xero: { method: string; path: string; body: any }[];
};
let handler: any = null;

async function withPortal(w: World, fn: (post: (body: Record<string, unknown>) => Promise<any>) => Promise<void>) {
  const g = globalThis as any;
  const saved = { fetch: g.fetch, serve: (Deno as any).serve, envGet: Deno.env.get };
  try {
    Deno.env.get = ((k: string) => k === "SUPABASE_URL" ? "https://stub.supabase.co" : k === "SUPABASE_SERVICE_ROLE_KEY" ? "stub" : undefined) as typeof Deno.env.get;
    g.fetch = (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : (input && input.url) || input);
      const method = String((init && init.method) || "GET").toUpperCase();
      let body: any = null; try { body = JSON.parse(String((init && init.body) || "")); } catch { /* binary */ }
      const ok = (x: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } }));
      if (url.includes("api.xero.com")) {
        const u = new URL(url); const path = u.pathname.replace("/api.xro/2.0", "");
        w.xero.push({ method, path: path + (u.search ? decodeURIComponent(u.search) : ""), body });
        if (path === "/TrackingCategories") return ok({ TrackingCategories: w.categories });
        if (path === "/Contacts" && method === "GET") return ok({ Contacts: w.existingContact ? [{ ContactID: w.existingContact, Name: w.inv.payee_name }] : [] });
        if (path === "/Contacts" && method === "POST") return ok({ Contacts: [{ ContactID: (body.Contacts[0].ContactID || "new-contact") }] });
        if (path.startsWith("/Invoices/") && path.includes("/Attachments/")) return ok({});
        if (path.startsWith("/Invoices/") && method === "GET") return ok({ Invoices: [w.existingBill] });
        if (path === "/Invoices" && method === "POST") {
          if (w.refuseUpdate) return ok({ Elements: [{ ValidationErrors: [{ Message: "Invoice not of valid status for modification" }] }] }, 400);
          return ok({ Invoices: [{ InvoiceID: body.Invoices[0].InvoiceID || "new-bill" }] });
        }
        return ok({});
      }
      const u = new URL(url); const table = u.pathname.split("/").pop();
      const one = /vnd\.pgrst\.object/.test(new Headers((init && init.headers) || {}).get("accept") || "");
      const rows = (list: any[]) => one ? (list.length ? ok(list[0]) : ok({ code: "PGRST116" }, 406)) : ok(list);
      if (u.pathname.endsWith("/rpc/portal_me")) return ok({ ok: true, user: { id: "u1", email: "boss@ctg.test", role: "admin" } });
      if (u.pathname.endsWith("/rpc/portal_allowed_tenants")) return ok([T]);
      if (u.pathname.includes("/rpc/")) return ok(null);
      if (table === "portal_self_billed_invoices" && method === "GET") return rows([w.inv]);
      if (table === "portal_individuals") return rows([w.payee]);
      if (table === "xero_tokens") return rows([{ access_token: "x", access_token_expires_at: "2999-01-01T00:00:00Z" }]);
      return method === "GET" ? rows([]) : ok([], 201);
    };
    (Deno as any).serve = (a: any, c?: any) => { handler = typeof a === "function" ? a : c; return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {} }; };
    await import(FN.href);
    await fn(async (body) => {
      const res = await handler(new Request("http://localhost/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "t", ...body }) }));
      return JSON.parse(await res.text());
    });
  } finally { g.fetch = saved.fetch; (Deno as any).serve = saved.serve; Deno.env.get = saved.envGet; }
}

const world = (over: Partial<World> = {}): World => ({
  inv: { id: 7, tenant_id: T, status: "approved", invoice_no: "SB-ILADY-2026-0051", payee_name: "KOH JIA XUAN", individual_id: 3,
    payee_tin: "IG57973057030", payee_id_no: "990101-07-5566", payee_address: "12 Jalan Merbau, 13000 Butterworth, Pulau Pinang",
    payee_bank_account: "1103061658", classification_code: "036", gl_account: "903-0930", invoice_date: "2026-07-31", due_date: "2026-07-31",
    line_items: [{ description: "Casual Wages for YRDZ Event", qty: 2, unit_price: 150 }], gross_amount: 300, wht_amount: 0, xero_bill_id: null },
  payee: { id: 3, name: "KOH JIA XUAN", email: "koh@example.com", phone: "012-3456789", tin: "IG57973057030" },
  categories: [CHANNEL, MYINVOIS], existingContact: "c-koh", xero: [],
  ...over,
});
const sent = (w: World, m: string, p: string) => w.xero.filter((x) => x.method === m && x.path === p);

Deno.test("a new self-billed bill: linked contact, number in Reference, classification on every line", async () => {
  const w = world();
  await withPortal(w, async (post) => {
    const r = await post({ api: "sbi_post_xero", id: 7 });
    assertEquals([r.ok, r.classification, r.warnings], [true, "036 - Self-billed - Others", []], JSON.stringify(r));
    // The contact: the EXISTING one, by ID, with the payee's details written onto it.
    const c = sent(w, "POST", "/Contacts")[0].body.Contacts[0];
    assertEquals(c, { ContactID: "c-koh", TaxNumber: "IG57973057030", CompanyNumber: "990101-07-5566", EmailAddress: "koh@example.com",
      Phones: [{ PhoneType: "DEFAULT", PhoneNumber: "012-3456789" }],
      Addresses: [{ AddressType: "POBOX", AddressLine1: "12 Jalan Merbau, 13000 Butterworth, Pulau Pinang", Country: "Malaysia" }],
      BankAccountDetails: "1103061658" });
    const inv = sent(w, "POST", "/Invoices")[0].body.Invoices[0];
    assertEquals(inv.Contact, { ContactID: "c-koh" });
    assertEquals(inv.InvoiceNumber, "SB-ILADY-2026-0051");
    for (const l of inv.LineItems) {
      assertEquals(l.Tracking, [{ TrackingCategoryID: "cat-mi", Name: "MyInvois Classification", TrackingOptionID: "opt-036", Option: "036 - Self-billed - Others" }]);
    }
  });
});

Deno.test("a payee Xero has never seen is CREATED with the details, never posted as a bare name", async () => {
  const w = world({ existingContact: null });
  await withPortal(w, async (post) => {
    await post({ api: "sbi_post_xero", id: 7 });
    const c = sent(w, "POST", "/Contacts")[0].body.Contacts[0];
    assertEquals([c.Name, c.TaxNumber, c.ContactID], ["KOH JIA XUAN", "IG57973057030", undefined]);
    assertEquals(sent(w, "POST", "/Invoices")[0].body.Invoices[0].Contact, { ContactID: "new-contact" });
  });
});

Deno.test("a field the portal does not have is not sent — a sync never blanks what someone typed in Xero", async () => {
  const w = world({ payee: { id: 3, name: "KOH JIA XUAN" } });
  w.inv.payee_address = ""; w.inv.payee_bank_account = null;
  await withPortal(w, async (post) => {
    await post({ api: "sbi_post_xero", id: 7 });
    const c = sent(w, "POST", "/Contacts")[0].body.Contacts[0];
    assertEquals(Object.keys(c).sort(), ["CompanyNumber", "ContactID", "TaxNumber"]);
  });
});

Deno.test("an org without the MyInvois category still gets its bill — and is told the classification was not set", async () => {
  const w = world({ categories: [CHANNEL] });
  await withPortal(w, async (post) => {
    const r = await post({ api: "sbi_post_xero", id: 7 });
    assertEquals(r.ok, true);
    assertEquals(/no "MyInvois Classification" tracking category/.test(r.warnings.join(" ")), true, r.warnings.join(" "));
    assertEquals(sent(w, "POST", "/Invoices")[0].body.Invoices[0].LineItems.every((l: any) => !l.Tracking), true);
  });
});

Deno.test("syncing a bill already in Xero: lines re-sent BY ID, other tracking kept, nothing re-attached", async () => {
  const w = world({ existingBill: { InvoiceID: "old-bill", LineItems: [
    { LineItemID: "L1", Description: "Casual Wages", Quantity: 2, UnitAmount: 150, AccountCode: "903-0930", TaxType: "NONE",
      Tracking: [{ TrackingCategoryID: "cat-ch", Name: "Channel", Option: "Facebook" }] },
  ] } });
  w.inv.xero_bill_id = "old-bill";
  await withPortal(w, async (post) => {
    const r = await post({ api: "sbi_post_xero", id: 7, sync_only: true });
    assertEquals([r.ok, r.synced], [true, true], JSON.stringify(r));
    const upd = sent(w, "POST", "/Invoices")[0].body.Invoices[0];
    assertEquals([upd.InvoiceID, upd.InvoiceNumber, upd.Contact], ["old-bill", "SB-ILADY-2026-0051", { ContactID: "c-koh" }]);
    // A bill update that OMITS a line deletes it — so every line goes back with its LineItemID.
    assertEquals(upd.LineItems.map((l: any) => l.LineItemID), ["L1"]);
    assertEquals(upd.LineItems[0].Tracking.map((t: any) => t.Option || t.Name), ["Facebook", "036 - Self-billed - Others"]);
    assertEquals(w.xero.filter((x) => x.path.includes("/Attachments/")).length, 0, "a batch sync re-attached files");
  });
});

Deno.test("when Xero refuses the update (a paid bill), the caller is told the bill was not changed", async () => {
  const w = world({ refuseUpdate: true, existingBill: { InvoiceID: "paid", LineItems: [] } });
  w.inv.xero_bill_id = "paid";
  await withPortal(w, async (post) => {
    const r = await post({ api: "sbi_post_xero", id: 7, sync_only: true });
    assertEquals(r.ok, false);
    assertEquals(/not of valid status/.test(r.error) && /bill was not changed/.test(r.error), true, r.error);
  });
});

Deno.test("the classification option is matched by its CODE, never by a near miss", async () => {
  // The exported function itself (the module is TypeScript, so its source cannot be eval'd as JS). Loaded
  // inside withPortal so the module graph boots with the same stubbed environment as the router.
  // deno-lint-ignore no-explicit-any
  let pick: any = null;
  await withPortal(world(), async () => {
    pick = (await import(new URL("../supabase/functions/portal/finance.ts", import.meta.url).href)).sbiPickClassification;
  });
  assertEquals(typeof pick, "function", "finance.ts no longer exports sbiPickClassification");
  assertEquals(/export function sbiPickClassification/.test(FIN), true);
  assertEquals(pick([MYINVOIS], "036").tracking.Option, "036 - Self-billed - Others");
  assertEquals(pick([MYINVOIS], "037").tracking.TrackingOptionID, "opt-037");
  assertEquals(!!pick([MYINVOIS], "03").tracking, false, "a prefix of a code must not match 036/037");
  assertEquals(!!pick([MYINVOIS], "045").tracking, false);
  assertEquals(!!pick([MYINVOIS], "").tracking, false);
  // The category is found whatever Invoici calls it on a given org: "MyInvoisClassification" too.
  assertEquals(pick([{ ...MYINVOIS, Name: "MyInvoisClassification" }], "036").tracking.Name, "MyInvoisClassification");
});
