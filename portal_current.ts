import { createClient } from "jsr:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
function j(x, status=200){ return new Response(JSON.stringify(x), { status, headers: { "content-type":"application/json", ...CORS } }); }
const SKINDAE_TENANT = "6a4194ca-42f4-45ec-a44c-f9c8f01071a7";
const O2O_REVENUE_CODE = "500-0100";
const XERO_SCOPES = "offline_access accounting.contacts accounting.settings accounting.invoices accounting.payments accounting.banktransactions accounting.attachments";
const PORTAL_PUBLIC_URL = "https://cmostxcjtbuhbzfojuid.supabase.co/functions/v1/portal";
const CLOSE_TEMPLATE = [
  {category:"Bank", title:"Import & reconcile all bank accounts"},
  {category:"AP", title:"Process & approve all supplier bills"},
  {category:"AR", title:"Issue all sales invoices (incl. O2O billing)"},
  {category:"AR", title:"Run collections on overdue receivables"},
  {category:"Adjustments", title:"Record accruals & prepayments"},
  {category:"Group", title:"Reconcile intercompany balances"},
  {category:"Payroll", title:"Review & post payroll (EPF/SOCSO/EIS/PCB)"},
  {category:"Tax", title:"Compute & file SST return"},
  {category:"Review", title:"Review P&L and balance sheet"},
  {category:"Close", title:"Lock the period in Xero"}
];
function escHtml(s){ return String(s==null?"":s).replace(/[<>&]/g, function(c){ return c==="<"?"&lt;":c===">"?"&gt;":"&amp;"; }); }
function htmlResp(inner, status){ return new Response("<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body style='font-family:system-ui,Arial;background:#0C1421;color:#e8eef7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0'><div style='max-width:540px;padding:32px;border:1px solid #2a3a52;border-radius:16px;background:#131c2d;line-height:1.7;font-size:15px'>" + inner + "</div></body></html>", { status: status||200, headers: { "content-type":"text/html; charset=utf-8", ...CORS } }); }
function clientIp(req){ const h = req.headers; const xff = (h.get("x-forwarded-for")||"").split(",")[0].trim(); return xff || h.get("cf-connecting-ip") || h.get("x-real-ip") || null; }
const B32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(bytes){ let bits=0, value=0, out=""; for (const b of bytes){ value=(value<<8)|b; bits+=8; while (bits>=5){ out+=B32_CHARS[(value>>>(bits-5))&31]; bits-=5; } } if (bits>0) out+=B32_CHARS[(value<<(5-bits))&31]; return out; }
function base32Decode(s){ s=String(s||"").toUpperCase().replace(/=+$/,"").replace(/\s/g,""); let bits=0, value=0; const out=[]; for (const ch of s){ const idx=B32_CHARS.indexOf(ch); if (idx<0) continue; value=(value<<5)|idx; bits+=5; if (bits>=8){ out.push((value>>>(bits-8))&0xff); bits-=8; } } return new Uint8Array(out); }
function genTotpSecret(){ const buf=new Uint8Array(20); crypto.getRandomValues(buf); return base32Encode(buf); }
async function totpVerify(secretB32, code, win=1){
  if (!secretB32 || !code) return false;
  const cleaned = String(code).replace(/\s|-/g,"");
  if (!/^\d{6}$/.test(cleaned)) return false;
  const key = base32Decode(secretB32);
  if (!key.length) return false;
  const k = await crypto.subtle.importKey("raw", key, { name:"HMAC", hash:"SHA-1" }, false, ["sign"]);
  const time = Math.floor(Date.now()/1000/30);
  for (let off=-win; off<=win; off++){
    const t = time + off;
    const buf = new ArrayBuffer(8); const view = new DataView(buf);
    view.setUint32(0, Math.floor(t/0x100000000), false);
    view.setUint32(4, t>>>0, false);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, buf));
    const offset = sig[sig.length-1] & 0xf;
    const trunc = ((sig[offset]&0x7f)<<24) | ((sig[offset+1]&0xff)<<16) | ((sig[offset+2]&0xff)<<8) | (sig[offset+3]&0xff);
    const expected = String(trunc % 1000000).padStart(6, "0");
    let r=0; for (let i=0;i<6;i++) r |= expected.charCodeAt(i) ^ cleaned.charCodeAt(i);
    if (r===0) return true;
  }
  return false;
}
function otpAuthUrl(label, secret, issuer){ return "otpauth://totp/" + encodeURIComponent(issuer + ":" + label) + "?secret=" + secret + "&issuer=" + encodeURIComponent(issuer) + "&algorithm=SHA1&digits=6&period=30"; }
async function xeroOAuthStart(qp){
  const { data: sec } = await sb.from("portal_secrets").select("value").eq("key","oauth_setup").single();
  if (!sec || !sec.value || qp.get("k") !== sec.value) return htmlResp("<b>Forbidden</b> â€” invalid or missing setup key.", 403);
  const { data: tok } = await sb.from("xero_tokens").select("client_id").limit(1).single();
  if (!tok || !tok.client_id) return htmlResp("<b>Setup error</b> â€” no Xero client_id on file.", 500);
  const state = crypto.randomUUID();
  await sb.from("portal_secrets").upsert({ key:"oauth_state", value:state, updated_at:new Date().toISOString() }, { onConflict:"key" });
  const auth = "https://login.xero.com/identity/connect/authorize?response_type=code"
    + "&client_id=" + encodeURIComponent(tok.client_id) + "&redirect_uri=" + encodeURIComponent(PORTAL_PUBLIC_URL)
    + "&scope=" + encodeURIComponent(XERO_SCOPES) + "&state=" + encodeURIComponent(state);
  return new Response(null, { status: 302, headers: { Location: auth, ...CORS } });
}
async function xeroOAuthCallback(qp){
  const { data: st } = await sb.from("portal_secrets").select("value").eq("key","oauth_state").single();
  if (!st || !st.value || qp.get("state") !== st.value) return htmlResp("<b>State mismatch</b> â€” please reopen the connect link and try again.", 400);
  const { data: tok } = await sb.from("xero_tokens").select("*").limit(1).single();
  if (!tok) return htmlResp("<b>Setup error</b> â€” no Xero credentials row.", 500);
  const basic = btoa(tok.client_id + ":" + tok.client_secret);
  const body = "grant_type=authorization_code&code=" + encodeURIComponent(qp.get("code")||"") + "&redirect_uri=" + encodeURIComponent(PORTAL_PUBLIC_URL);
  const r = await fetch("https://identity.xero.com/connect/token", { method:"POST", headers:{ "Authorization":"Basic "+basic, "Content-Type":"application/x-www-form-urlencoded" }, body });
  const t = await r.json();
  if (!r.ok || !t.refresh_token) return htmlResp("<b>Token exchange failed</b><br><pre style='white-space:pre-wrap;font-size:12px;color:#f0a'>" + escHtml(JSON.stringify(t).slice(0,400)) + "</pre>", 400);
  await sb.from("xero_tokens").update({ access_token: t.access_token, refresh_token: t.refresh_token, access_token_expires_at: new Date(Date.now() + (t.expires_in??1800)*1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", tok.id);
  let tenantsMsg = "";
  try {
    const cr = await fetch("https://api.xero.com/connections", { headers:{ "Authorization":"Bearer "+t.access_token, "Content-Type":"application/json" } });
    const conns = await cr.json();
    if (Array.isArray(conns)) { tenantsMsg = conns.map((c)=>c.tenantName).join(", "); for (const c of conns) { try { await sb.from("xero_tenants").upsert({ tenant_id:c.tenantId, tenant_name:c.tenantName }, { onConflict:"tenant_id" }); } catch(_e){} } }
  } catch (_e) {}
  try { await sb.from("portal_secrets").delete().eq("key","oauth_state"); } catch(_e){}
  try { await sb.from("portal_audit").insert({ action:"xero_reconnect", ref:"oauth", detail:{ tenants: tenantsMsg } }); } catch(_e){}
  return htmlResp("<b style='color:#7ee0a0;font-size:19px'>âœ“ Xero reconnected</b><br><br>Connected organisations: " + (escHtml(tenantsMsg)||"(none returned)") + ".<br><br>You can close this tab and return to the portal, then open <b>Users â†’ Xero sync</b> and click <b>Full sync from Xero</b> to refill the cache.", 200);
}
async function xeroAccessToken(){
  const { data: tok, error } = await sb.from("xero_tokens").select("*").limit(1).single();
  if (error || !tok) throw new Error("No Xero token on file");
  const exp = tok.access_token_expires_at ? new Date(tok.access_token_expires_at).getTime() : 0;
  if (Date.now() < exp - 60000 && tok.access_token) return tok.access_token;
  const basic = btoa(tok.client_id + ":" + tok.client_secret);
  const r = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(tok.refresh_token) });
  if (!r.ok) throw new Error("Xero token refresh failed: " + (await r.text()));
  const t = await r.json();
  await sb.from("xero_tokens").update({ access_token: t.access_token, refresh_token: t.refresh_token ?? tok.refresh_token, access_token_expires_at: new Date(Date.now() + (t.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", tok.id);
  return t.access_token;
}
async function meFromToken(token){
  const { data } = await sb.rpc("portal_me", { p_token: token||"" });
  if (data && data.ok && token){ try { sb.rpc("portal_touch_session", { p_token: token }).then(()=>{}, ()=>{}); } catch (_e) {} }
  return data;
}
function isAdmin(me){ const r = me && me.user && me.user.role; return me && me.ok && (r==="admin" || r==="approver"); }
function superAdmin(me){ return me && me.ok && me.user && me.user.role==="admin"; }
async function logAudit(me, action, ref, detail){ try{ await sb.from("portal_audit").insert({ user_id:(me&&me.user&&me.user.id)||null, user_email:(me&&me.user&&me.user.email)||null, action:action, ref:String(ref||""), detail:detail||{} }); }catch(_e){} }
async function allowedTenants(token){ try{ const { data } = await sb.rpc("portal_allowed_tenants", { p_token: token||"" }); return Array.isArray(data) ? data : []; } catch (_e) { return []; } }
async function denyTenant(me, action, tenant){ await logAudit(me, "tenant_access_denied", String(tenant||""), { action }); return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }
// â”€â”€ Xero GET with proper 429 rate-limit handling (Retry-After header). â”€â”€
// Previous behaviour: silent fail on 429 â†’ break upstream loops â†’ cache silently stale.
// New behaviour: honour Retry-After (cap at 90s), retry up to 3 times, then throw.
async function xeroGet(access, tenant, path, extraHeaders){
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++){
    const h = { "Authorization":"Bearer "+access, "Xero-Tenant-Id":tenant, "Accept":"application/json" };
    if (extraHeaders) for (const k in extraHeaders) h[k] = extraHeaders[k];
    const r = await fetch("https://api.xero.com/api.xro/2.0/" + path, { headers: h });
    if (r.status === 304) return { __notModified: true };
    if (r.status === 429){
      // Xero rate limit hit. Retry-After in seconds (typically 60 for minute-rate, up to 86400 for daily).
      const retryAfter = parseInt(r.headers.get("Retry-After") || r.headers.get("retry-after") || "60", 10);
      if (retryAfter > 300) { // > 5 min suggests daily-cap hit; abort early rather than block the function for hours
        throw new Error("Xero rate limit (daily?) for " + path + ": Retry-After=" + retryAfter + "s");
      }
      if (attempt >= 4) throw new Error("Xero rate limited (429) after 4 attempts on " + path);
      const waitMs = Math.min(retryAfter * 1000 + 500, 90 * 1000);
      await new Promise((res)=>setTimeout(res, waitMs));
      continue;
    }
    if (!r.ok){
      lastErr = "Xero " + path + ": " + r.status + " " + (await r.text()).slice(0, 200);
      throw new Error(lastErr);
    }
    return await r.json();
  }
  throw new Error(lastErr || "Xero retries exhausted on " + path);
}
async function xeroInvoicesAll(access, tenant, type){
  const out = [];
  for (let page=1; page<=100; page++){
    let d; try { d = await xeroGet(access, tenant, "Invoices?Statuses=AUTHORISED,SUBMITTED&page=" + page + "&where=" + encodeURIComponent('Type=="' + type + '"')); } catch (_e) { break; }
    const arr = d.Invoices || [];
    if (!arr.length) break;
    for (const iv of arr) out.push(iv);
    if (arr.length < 100) break;
  }
  return out;
}
async function resolveContact(tenant, name){ if(!name) return null; const { data } = await sb.from("xero_contacts_cache").select("contact_id,name").eq("tenant_id", tenant).ilike("name", String(name).trim()).limit(1); return (data && data.length) ? data[0].contact_id : null; }
async function getWebhookKey(){ try{ const { data } = await sb.from("portal_secrets").select("value").eq("key","xero_webhook").single(); if (data && data.value) return data.value; }catch(_e){} return Deno.env.get("XERO_WEBHOOK_KEY") || ""; }
async function hmacSha256B64(key, msg){
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
// v69 (Wave 1c, spec §E): record every successful AP post into vendor_coding_history so the
// cascade (Wave 2) can learn from real decisions. Best-effort — failures never block posting.
async function recordVendorCodingHistory(
  tenant_id: string,
  vendor_name: string,
  lines: any[],
  source: string,
  opts: { operator_id?: string; invoice_id?: string; invoice_number?: string; invoice_amount?: number; invoice_date?: string; ai_verdict?: any } = {}
){
  try {
    if (!tenant_id || !vendor_name || !Array.isArray(lines) || !lines.length) return;
    const rows = lines
      .filter((l:any)=> l && l.account_code)
      .map((l:any)=>({
        tenant_id,
        vendor_name: String(vendor_name).slice(0,500),
        line_description: String(l.description || "").slice(0,500),
        account_code: String(l.account_code),
        tax_type: l.tax_type || null,
        tracking_category_id: l.tracking_category_id || null,
        tracking_option_id: l.tracking_option_id || null,
        source,
        operator_id: opts.operator_id || null,
        invoice_id: opts.invoice_id || null,
        invoice_number: opts.invoice_number || null,
        invoice_amount: opts.invoice_amount ?? null,
        invoice_date: opts.invoice_date || null,
        ai_verdict: opts.ai_verdict || null,
      }));
    if (!rows.length) return;
    await sb.from("vendor_coding_history").insert(rows);
  } catch (e) {
    try { console.error("recordVendorCodingHistory failed:", e && ((e as any).message || e)); } catch (_) {}
  }
}
function timingSafeEqual(a, b){ if (typeof a!=="string" || typeof b!=="string" || a.length!==b.length) return false; let r=0; for (let i=0;i<a.length;i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r===0; }
async function sha256Hex(s){ const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return Array.from(new Uint8Array(buf)).map(x=>x.toString(16).padStart(2,"0")).join(""); }
// v68 (Wave 3): SHA-256 of raw bytes — used to fingerprint AP attachment files at intake.
async function sha256HexBytes(bytes){ const buf = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(buf)).map((x)=>x.toString(16).padStart(2,"0")).join(""); }
// Parse a Xero ProfitAndLoss report into income[] / expenses[] account breakdowns + totals.
// Xero report shape: Reports[0].Rows = [Header, Section{Title, Rows:[Row|SummaryRow]}, ...].
// Each data Row's Cells = [accountName, ..., amount]; SummaryRow holds section totals.
function parsePnl(rep){
  const income = [], expenses = [];
  let revTotal = 0, expTotal = 0, net = 0;
  const num = (s)=>{ const n = parseFloat(String(s==null?"":s).replace(/[(,\s]/g,"").replace(/\)/g,"")); return isNaN(n) ? 0 : (String(s).indexOf("(")>=0 ? -n : n); };
  if (rep && Array.isArray(rep.Rows)){
    for (const section of rep.Rows){
      if (section.RowType !== "Section") continue;
      const title = String(section.Title||"").toLowerCase();
      const isIncome  = /income|revenue|turnover|trading/.test(title);
      const isExpense = /expense|cost of sales|overhead|operating|less /.test(title);
      for (const row of (section.Rows||[])){
        const cells = row.Cells || [];
        const name = cells[0] ? cells[0].Value : "";
        const amt = num(cells.length ? cells[cells.length-1].Value : 0);
        if (/net profit|net income|profit for the/i.test(String(name))) { net = amt; continue; }
        if (row.RowType === "SummaryRow"){
          if (isIncome) revTotal += amt; else if (isExpense) expTotal += Math.abs(amt);
          continue;
        }
        if (row.RowType === "Row" && name && amt !== 0){
          if (isIncome) income.push({ name, amount: amt });
          else if (isExpense) expenses.push({ name, amount: Math.abs(amt) });
        }
      }
    }
  }
  if (!revTotal) revTotal = income.reduce((s,x)=>s+x.amount,0);
  if (!expTotal) expTotal = expenses.reduce((s,x)=>s+x.amount,0);
  if (!net) net = revTotal - expTotal;
  income.sort((a,b)=>b.amount-a.amount);
  expenses.sort((a,b)=>b.amount-a.amount);
  return { revenue_total: Math.round(revTotal*100)/100, expense_total: Math.round(expTotal*100)/100, net_profit: Math.round(net*100)/100, income, expenses };
}
// Xero may return dates in two formats: ISO "2026-06-15T00:00:00" (DateString)
// or legacy Microsoft "/Date(1718409600000+0000)/" (Date). slicing the latter to 10 chars
// yields "/Date(1718" which Postgres rejects → the WHOLE batch upsert fails silently.
// xDate handles both and returns null on anything unparseable.
function xDate(s){
  if (!s) return null;
  const str = String(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0,10);
  const m = str.match(/\/Date\((-?\d+)/);
  if (m){ const d = new Date(parseInt(m[1],10)); if (!isNaN(d.getTime())) return d.toISOString().slice(0,10); }
  const d = new Date(str); if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
  return null;
}
function invToCacheRow(tenant, iv){ const now = new Date().toISOString(); return { tenant_id: tenant, invoice_id: iv.InvoiceID, number: iv.InvoiceNumber || null, type: iv.Type || null, status: iv.Status || null, contact_name: (iv.Contact||{}).Name || null, contact_id: (iv.Contact||{}).ContactID || null, total: Number(iv.Total||0), amount_due: Number(iv.AmountDue||0), currency: iv.CurrencyCode || null, inv_date: xDate(iv.DateString||iv.Date), due_date: xDate(iv.DueDateString||iv.DueDate), updated_at: now, last_synced_at: now }; }
// v37+: also handle PAYMENT and CREDITNOTE events — both change Invoice.AmountDue.
// Without this, Xero payments don't reflect in the cache until next delta cron (up to 1h lag).
async function processOneEvent(ev){
  const tenant = ev.tenantId || ev.tenant_id;
  const cat = ev.eventCategory || ev.event_category;
  const rid = ev.resourceId || ev.resource_id;
  if (!tenant || !rid) return true;
  const access = await xeroAccessToken();
  if (cat === "CONTACT"){
    const d = await xeroGet(access, tenant, "Contacts/" + rid);
    const c = (d.Contacts || [])[0];
    if (c){
      if (c.ContactStatus === "ARCHIVED" || c.ContactStatus === "DELETED"){
        await sb.from("xero_contacts_cache").delete().eq("tenant_id", tenant).eq("contact_id", c.ContactID);
      } else {
        await sb.from("xero_contacts_cache").upsert({ tenant_id: tenant, contact_id: c.ContactID, name: c.Name || "", email: c.EmailAddress || null, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,contact_id" });
      }
    }
  } else if (cat === "INVOICE"){
    const d = await xeroGet(access, tenant, "Invoices/" + rid);
    const iv = (d.Invoices || [])[0];
    if (iv){
      if (iv.Status === "VOIDED" || iv.Status === "DELETED"){
        await sb.from("xero_invoice_cache").delete().eq("tenant_id", tenant).eq("invoice_id", iv.InvoiceID);
      } else {
        await sb.from("xero_invoice_cache").upsert(invToCacheRow(tenant, iv), { onConflict: "tenant_id,invoice_id" });
      }
    }
  } else if (cat === "PAYMENT"){
    // Fetch payment → find linked invoice → refresh invoice (AmountDue changed).
    const d = await xeroGet(access, tenant, "Payments/" + rid);
    const pay = (d.Payments || [])[0];
    const linkedInvoiceId = pay && pay.Invoice && pay.Invoice.InvoiceID;
    if (linkedInvoiceId){
      const di = await xeroGet(access, tenant, "Invoices/" + linkedInvoiceId);
      const iv = (di.Invoices || [])[0];
      if (iv){
        if (iv.Status === "VOIDED" || iv.Status === "DELETED"){
          await sb.from("xero_invoice_cache").delete().eq("tenant_id", tenant).eq("invoice_id", iv.InvoiceID);
        } else {
          await sb.from("xero_invoice_cache").upsert(invToCacheRow(tenant, iv), { onConflict: "tenant_id,invoice_id" });
        }
      }
    }
  } else if (cat === "CREDITNOTE"){
    // Credit notes can apply to invoices via Allocations[] — refresh each allocated invoice.
    const d = await xeroGet(access, tenant, "CreditNotes/" + rid);
    const cn = (d.CreditNotes || [])[0];
    const allocs = (cn && cn.Allocations) || [];
    const seen = new Set();
    for (const a of allocs){
      const id = a && a.Invoice && a.Invoice.InvoiceID; if (!id || seen.has(id)) continue; seen.add(id);
      try {
        const di = await xeroGet(access, tenant, "Invoices/" + id);
        const iv = (di.Invoices || [])[0];
        if (iv){
          if (iv.Status === "VOIDED" || iv.Status === "DELETED"){
            await sb.from("xero_invoice_cache").delete().eq("tenant_id", tenant).eq("invoice_id", iv.InvoiceID);
          } else {
            await sb.from("xero_invoice_cache").upsert(invToCacheRow(tenant, iv), { onConflict: "tenant_id,invoice_id" });
          }
        }
      } catch (_e){}
    }
  }
  return true;
}
async function processWebhookEvents(list){
  for (const it of list){
    try { await processOneEvent(it.ev); if (it.id) await sb.from("xero_webhook_events").update({ processed: true, last_attempt_at: new Date().toISOString() }).eq("id", it.id); }
    catch (e) { if (it.id){ const { data: cur } = await sb.from("xero_webhook_events").select("attempts").eq("id", it.id).single(); const a = (cur && cur.attempts) || 0; try { await sb.from("xero_webhook_events").update({ attempts: a+1, last_attempt_at: new Date().toISOString(), last_error: String(e).slice(0,500) }).eq("id", it.id); } catch(_e){} } }
  }
}
// v71 (Tier-1 accuracy+speed): BATCH-BY-IDS. Instead of one Xero GET per changed invoice,
// group all pending INVOICE resource-ids per tenant and fetch up to 50 in a single
// `Invoices?IDs=g1,g2,...` call — cutting API usage 50–100× so the daily cap is never the
// bottleneck. Non-invoice events (CONTACT/PAYMENT/CREDITNOTE) stay individual (rare).
// Retains the v70 discipline: skip-if-cached (0 calls), cooldown-aware, per-run budget, no perma-stick.
async function fetchInvoiceIdsBatch(access, tenant, ids){
  // Returns { applied, deleted, error }. IDs requested but NOT returned by Xero are treated as
  // gone (VOIDED/DELETED) and pruned from cache so the cache mirrors Xero exactly.
  const d = await xeroGet(access, tenant, "Invoices?IDs=" + ids.join(","));
  const arr = (d && d.Invoices) || [];
  const r = await applyInvoiceBatch(tenant, arr);
  let deleted = r.deleted || 0;
  const returned = new Set(arr.map((iv)=>iv.InvoiceID));
  const missing = ids.filter((id)=> !returned.has(id));
  if (missing.length){ try { await sb.from("xero_invoice_cache").delete().eq("tenant_id", tenant).in("invoice_id", missing); deleted += missing.length; } catch(_e){} }
  return { applied: r.upserted || 0, deleted, error: r.error || null };
}
async function processPendingDedup(limit){
  const MAX_CALLS = 30;   // Xero API calls per run (one call = up to 50 invoices batched)
  const BATCH = 50;       // invoice ids per Xero call
  const { data: pend } = await sb.from("xero_webhook_events")
    .select("id,tenant_id,event_category,resource_id,attempts,event_date,received_at")
    .eq("processed", false).lt("attempts", 12)
    .order("attempts", { ascending:true }).order("received_at", { ascending:true })
    .limit(limit||600);
  if (!pend || !pend.length){ const { count } = await sb.from("xero_webhook_events").select("id", { count:"exact", head:true }).eq("processed", false); return { processed: 0, deduplicated: 0, remaining: count||0 }; }
  // Dedup identical (tenant|category|resource) events into one bucket; track newest event time.
  const buckets = new Map();
  for (const row of pend){
    const key = row.tenant_id + "|" + row.event_category + "|" + row.resource_id;
    if (!buckets.has(key)) buckets.set(key, { ev:{ tenantId: row.tenant_id, eventCategory: row.event_category, resourceId: row.resource_id }, ids:[], maxAttempts:0, eventTs:0 });
    const b = buckets.get(key); b.ids.push(row.id); if (row.attempts > b.maxAttempts) b.maxAttempts = row.attempts;
    const ts = new Date(row.event_date || row.received_at || 0).getTime(); if (ts > b.eventTs) b.eventTs = ts;
  }
  // Pre-load cache freshness for every INVOICE resource in bulk → skip-if-cached with no API calls.
  const invIds = [...buckets.values()].filter((b)=>b.ev.eventCategory === "INVOICE").map((b)=>b.ev.resourceId);
  const cacheFresh = new Map();
  for (let i=0; i<invIds.length; i+=300){
    const chunk = invIds.slice(i, i+300);
    const { data: rows } = await sb.from("xero_invoice_cache").select("invoice_id,updated_at").in("invoice_id", chunk);
    for (const r of (rows||[])) cacheFresh.set(r.invoice_id, new Date(r.updated_at || 0).getTime());
  }
  let processed = 0, skippedCached = 0, calls = 0, cooldownSkipped = 0, deleted = 0;
  const tenantBlocked = new Map();
  // Partition: invoice buckets that genuinely need a fetch (grouped per tenant) vs misc buckets.
  const invByTenant = new Map(); // tenant_id -> [bucket,...]
  const miscBuckets = [];
  for (const bucket of buckets.values()){
    if (bucket.ev.eventCategory === "INVOICE"){
      const cachedTs = cacheFresh.get(bucket.ev.resourceId);
      if (cachedTs !== undefined && cachedTs + 5000 >= bucket.eventTs){ // delta already covered it → free drain
        await sb.from("xero_webhook_events").update({ processed: true, last_attempt_at: new Date().toISOString(), last_error: "covered-by-delta" }).in("id", bucket.ids);
        processed += bucket.ids.length; skippedCached += bucket.ids.length; continue;
      }
      if (!invByTenant.has(bucket.ev.tenantId)) invByTenant.set(bucket.ev.tenantId, []);
      invByTenant.get(bucket.ev.tenantId).push(bucket);
    } else {
      miscBuckets.push(bucket);
    }
  }
  const access = (invByTenant.size || miscBuckets.length) ? await xeroAccessToken() : null;
  // ── Batched invoice fetches, per tenant, 50 ids/call.
  for (const [tid, tbuckets] of invByTenant){
    if (await isRateLimited(tid)){ tenantBlocked.set(tid, true); cooldownSkipped += tbuckets.reduce((n,b)=>n+b.ids.length,0); continue; }
    for (let i=0; i<tbuckets.length; i+=BATCH){
      if (calls >= MAX_CALLS){ cooldownSkipped += tbuckets.slice(i).reduce((n,b)=>n+b.ids.length,0); break; }
      const chunk = tbuckets.slice(i, i+BATCH);
      const rowIds = chunk.flatMap((b)=>b.ids);
      try {
        calls++;
        const r = await fetchInvoiceIdsBatch(access, tid, chunk.map((b)=>b.ev.resourceId));
        deleted += r.deleted;
        await sb.from("xero_webhook_events").update({ processed: true, last_attempt_at: new Date().toISOString() }).in("id", rowIds);
        processed += rowIds.length;
      } catch (e) {
        const msg = String(e);
        if (/rate limit/i.test(msg)){ await recordRateLimit(tid, msg); tenantBlocked.set(tid, true); }
        for (const b of chunk){ await sb.from("xero_webhook_events").update({ attempts: b.maxAttempts + 1, last_attempt_at: new Date().toISOString(), last_error: msg.slice(0,500) }).in("id", b.ids); }
        break; // stop this tenant's remaining batches for the run
      }
    }
  }
  // ── Misc (contact/payment/creditnote): individual, with remaining budget.
  for (const bucket of miscBuckets){
    const tid = bucket.ev.tenantId;
    if (calls >= MAX_CALLS){ cooldownSkipped += bucket.ids.length; continue; }
    if (tenantBlocked.get(tid)){ cooldownSkipped += bucket.ids.length; continue; }
    if (await isRateLimited(tid)){ tenantBlocked.set(tid, true); cooldownSkipped += bucket.ids.length; continue; }
    try {
      calls++;
      await processOneEvent(bucket.ev);
      await sb.from("xero_webhook_events").update({ processed: true, last_attempt_at: new Date().toISOString() }).in("id", bucket.ids);
      processed += bucket.ids.length;
    } catch (e) {
      const msg = String(e);
      if (/rate limit/i.test(msg)){ await recordRateLimit(tid, msg); tenantBlocked.set(tid, true); }
      await sb.from("xero_webhook_events").update({ attempts: bucket.maxAttempts + 1, last_attempt_at: new Date().toISOString(), last_error: msg.slice(0,500) }).in("id", bucket.ids);
    }
  }
  const { count } = await sb.from("xero_webhook_events").select("id", { count:"exact", head:true }).eq("processed", false);
  return { processed, skipped_cached: skippedCached, xero_calls: calls, deleted, cooldown_skipped: cooldownSkipped, deduplicated: pend.length - buckets.size, unique_resources: buckets.size, remaining: count||0 };
}
async function syncStateUpdate(tenant_id, patch){ try{ await sb.from("xero_sync_state").upsert({ tenant_id, ...patch }, { onConflict: "tenant_id" }); } catch(_e){} }
// ── v28: per-tenant rate-limit guard. Skip syncing tenants currently in cooldown.
async function isRateLimited(tenant_id){
  try{ const { data } = await sb.from("xero_sync_state").select("rate_limited_until").eq("tenant_id", tenant_id).maybeSingle();
    if (data && data.rate_limited_until && new Date(data.rate_limited_until).getTime() > Date.now()) return data.rate_limited_until;
  }catch(_e){}
  return null;
}
// ── v28: when a 429 with high Retry-After fires, persist a cooldown so other tenants/calls don't keep hammering the same dead budget.
function parseRateLimitMessage(msg){
  const m = String(msg||"").match(/Retry-After=(\d+)s/);
  return m ? Math.min(parseInt(m[1],10), 24*3600) : null;
}
async function recordRateLimit(tenant_id, errMsg){
  const sec = parseRateLimitMessage(errMsg);
  if (sec && sec > 300){
    const until = new Date(Date.now() + sec*1000).toISOString();
    await syncStateUpdate(tenant_id, { rate_limited_until: until, last_error: String(errMsg).slice(0,500), last_error_at: new Date().toISOString() });
    return until;
  }
  return null;
}
// ── v28: write rows + delete VOIDED/DELETED so cache mirrors Xero status exactly.
// AI Agent: read an inbox item, look at the email + attached invoices/receipts via Claude vision,
// decide whether to (a) post as-is, (b) flag for human review, or (c) reply asking for missing info.
// ─────────────────────────────────────────────────────────────────────
// AP Email Agent — full automation pipeline.
// ─────────────────────────────────────────────────────────────────────
// Flow:
//   1. Build multimodal content from email body + attached images/PDFs.
//   2. Claude vision extracts structured data + classifies (invoice|reimbursement)
//      and performs the compliance audit (signatures, supporting docs, ...).
//   3. Server-side DUPLICATE CHECK against xero_invoice_cache.
//   4. Server-side GL MAPPING via portal_gl_rules (learned patterns).
//   5. Decision tree → status + (auto-post | auto-reply) without human intervention.
// Every decision is logged to portal_ap_decisions for audit.
// Wave 5 (CTG Finance OS Principle 5 — AI Provider swappable):
// Provider-agnostic vision LLM call. Business logic builds a NEUTRAL content list
// ([{kind:"text"|"image"|"pdf", ...}]) and this adapter converts it to whichever provider
// the tenant picked. Switching provider never touches extraction/dedup/coding logic.
// Returns { ok, text, error }.
function resolveModel(provider, aiModel){
  provider = String(provider||"anthropic").toLowerCase();
  const m = String(aiModel||"");
  if (provider === "openai") return /^(gpt|o\d|chatgpt)/i.test(m) ? m : "gpt-4o-mini";
  if (provider === "gemini") return /^gemini/i.test(m) ? m : "gemini-2.0-flash";
  return /^claude/i.test(m) ? m : "claude-haiku-4-5-20251001";
}
async function callVisionLLM(provider, model, systemPrompt, neutral, maxTokens){
  provider = String(provider||"anthropic").toLowerCase();
  maxTokens = maxTokens || 2500;
  try {
    if (provider === "openai"){
      const key = Deno.env.get("OPENAI_API_KEY");
      if (!key) return { ok:false, error:"OPENAI_API_KEY not set" };
      const content = neutral.map((b)=>{
        if (b.kind === "text")  return { type:"text", text: b.text };
        if (b.kind === "image") return { type:"image_url", image_url:{ url:"data:"+b.mime+";base64,"+b.b64 } };
        if (b.kind === "pdf")   return { type:"file", file:{ filename:"invoice.pdf", file_data:"data:application/pdf;base64,"+b.b64 } };
        return { type:"text", text:"" };
      });
      const r = await fetch("https://api.openai.com/v1/chat/completions", { method:"POST", headers:{ "Authorization":"Bearer "+key, "Content-Type":"application/json" }, body: JSON.stringify({ model, max_completion_tokens: maxTokens, response_format:{ type:"json_object" }, messages:[ { role:"system", content: systemPrompt }, { role:"user", content } ] }) });
      const out = await r.json();
      if (!r.ok) return { ok:false, error:"OpenAI "+r.status+": "+JSON.stringify(out.error||out).slice(0,300) };
      const txt = (out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content) || "";
      return { ok:true, text: txt };
    }
    if (provider === "gemini"){
      const key = Deno.env.get("GEMINI_API_KEY");
      if (!key) return { ok:false, error:"GEMINI_API_KEY not set" };
      const parts = neutral.map((b)=>{
        if (b.kind === "text")  return { text: b.text };
        if (b.kind === "image") return { inline_data:{ mime_type: b.mime, data: b.b64 } };
        if (b.kind === "pdf")   return { inline_data:{ mime_type:"application/pdf", data: b.b64 } };
        return { text:"" };
      });
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(key), { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ system_instruction:{ parts:[{ text: systemPrompt }] }, contents:[{ role:"user", parts }], generationConfig:{ maxOutputTokens: maxTokens, responseMimeType:"application/json" } }) });
      const out = await r.json();
      if (!r.ok) return { ok:false, error:"Gemini "+r.status+": "+JSON.stringify(out.error||out).slice(0,300) };
      const txt = (out.candidates && out.candidates[0] && out.candidates[0].content && out.candidates[0].content.parts && out.candidates[0].content.parts[0] && out.candidates[0].content.parts[0].text) || "";
      return { ok:true, text: txt };
    }
    // default: anthropic
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return { ok:false, error:"ANTHROPIC_API_KEY not set" };
    const content = neutral.map((b)=>{
      if (b.kind === "text")  return { type:"text", text: b.text };
      if (b.kind === "image") return { type:"image", source:{ type:"base64", media_type: b.mime, data: b.b64 } };
      if (b.kind === "pdf")   return { type:"document", source:{ type:"base64", media_type:"application/pdf", data: b.b64 } };
      return { type:"text", text:"" };
    });
    const r = await fetch("https://api.anthropic.com/v1/messages", { method:"POST", headers:{ "x-api-key": key, "anthropic-version":"2023-06-01", "Content-Type":"application/json" }, body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages:[{ role:"user", content }] }) });
    const out = await r.json();
    if (!r.ok) return { ok:false, error:"Claude API "+r.status+": "+JSON.stringify(out.error||out).slice(0,300) };
    const txt = (out.content && out.content[0] && out.content[0].text) || "";
    return { ok:true, text: txt };
  } catch(e){ return { ok:false, error: String((e&&e.message)||e).slice(0,300) }; }
}

// ─────────────────────────────────────────────────────────────────────
// Google Document AI — high-precision OCR for invoices/receipts.
// Two-stage AP path (opt-in per tenant via portal_ap_settings.ocr_provider='docai'):
//   Document AI extracts structured fields (with confidence) → GPT-5.4 does the reasoning.
// Auth is a service-account JWT (RS256) exchanged for a short-lived access token.
// Config lives in Supabase Edge secrets: GOOGLE_DOCAI_SA (full service-account JSON),
// GOOGLE_DOCAI_PROJECT, GOOGLE_DOCAI_LOCATION (us|eu), GOOGLE_DOCAI_INVOICE_PROCESSOR,
// GOOGLE_DOCAI_EXPENSE_PROCESSOR (optional; falls back to the invoice processor).
// ─────────────────────────────────────────────────────────────────────
let __docaiTok: any = null;
function b64urlJson(obj: any){ return btoa(JSON.stringify(obj)).replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_"); }
async function docaiAccessToken(){
  const now = Math.floor(Date.now()/1000);
  if (__docaiTok && __docaiTok.exp > now + 60) return __docaiTok.token;
  const saRaw = Deno.env.get("GOOGLE_DOCAI_SA");
  if (!saRaw) throw new Error("GOOGLE_DOCAI_SA not set");
  const sa = JSON.parse(saRaw);
  const aud = sa.token_uri || "https://oauth2.googleapis.com/token";
  const unsigned = b64urlJson({ alg:"RS256", typ:"JWT" }) + "." +
    b64urlJson({ iss: sa.client_email, scope:"https://www.googleapis.com/auth/cloud-platform", aud, iat: now, exp: now+3600 });
  const pemBody = String(sa.private_key||"").replace(/-----BEGIN PRIVATE KEY-----/,"").replace(/-----END PRIVATE KEY-----/,"").replace(/\s+/g,"");
  const der = Uint8Array.from(atob(pemBody), (c)=>c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name:"RSASSA-PKCS1-v1_5", hash:"SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");
  const jwt = unsigned + "." + sigB64;
  const r = await fetch(aud, { method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + encodeURIComponent(jwt) });
  const d = await r.json();
  if (!d.access_token) throw new Error("DocAI token exchange failed: " + JSON.stringify(d).slice(0,200));
  __docaiTok = { token: d.access_token, exp: now + (Number(d.expires_in)||3600) };
  return d.access_token;
}
async function callDocAI(b64: string, mime: string, kind: string){
  const project = Deno.env.get("GOOGLE_DOCAI_PROJECT");
  const location = Deno.env.get("GOOGLE_DOCAI_LOCATION") || "us";
  const proc = kind === "expense"
    ? (Deno.env.get("GOOGLE_DOCAI_EXPENSE_PROCESSOR") || Deno.env.get("GOOGLE_DOCAI_INVOICE_PROCESSOR"))
    : Deno.env.get("GOOGLE_DOCAI_INVOICE_PROCESSOR");
  if (!project || !proc) return { ok:false, error:"Doc AI project/processor not configured" };
  try {
    const token = await docaiAccessToken();
    const url = "https://" + location + "-documentai.googleapis.com/v1/projects/" + project + "/locations/" + location + "/processors/" + proc + ":process";
    const r = await fetch(url, { method:"POST", headers:{ "Authorization":"Bearer "+token, "Content-Type":"application/json" },
      body: JSON.stringify({ rawDocument:{ content:b64, mimeType:mime }, skipHumanReview:true }) });
    if (!r.ok) return { ok:false, error:"Doc AI "+r.status+": "+(await r.text()).slice(0,220) };
    const d = await r.json();
    return { ok:true, doc: d.document || null };
  } catch(e){ return { ok:false, error: String((e&&e.message)||e).slice(0,220) }; }
}
// Turn Doc AI's entity graph into a compact, GPT-readable extraction block with confidences.
function docaiEntitiesToText(doc: any){
  if (!doc) return "";
  const ents = doc.entities || [];
  const fields: string[] = []; const lines: string[] = [];
  for (const e of ents){
    const t = String(e.type||"");
    const conf = (e.confidence!=null) ? ("  (conf "+Math.round(Number(e.confidence)*100)+"%)") : "";
    if (t === "line_item"){
      const parts = (e.properties||[]).map((p: any)=> String(p.type||"").replace("line_item/","") + "=" + (((p.normalizedValue&&p.normalizedValue.text)||p.mentionText||"").toString().replace(/\s+/g," ").trim()));
      lines.push("  · " + parts.join(", "));
    } else {
      const v = ((e.normalizedValue&&e.normalizedValue.text)||e.mentionText||"").toString().replace(/\s+/g," ").trim();
      fields.push("  - " + t + ": " + v + conf);
    }
  }
  let out = "GOOGLE DOCUMENT AI — HIGH-PRECISION STRUCTURED EXTRACTION\n" +
    "(Fields below were OCR-extracted by Google's purpose-built invoice/receipt parser, each with a confidence score. " +
    "Trust these exact values over your own reading of the image; explicitly flag any field with confidence < 70% as an issue.)\n\nFIELDS:\n" +
    (fields.length ? fields.join("\n") : "  (none extracted)");
  if (lines.length) out += "\n\nLINE ITEMS:\n" + lines.join("\n");
  if (doc.text) out += "\n\nFULL OCR TEXT:\n" + String(doc.text).slice(0, 6000);
  return out;
}

async function processApEmail(inboxId, route){
  const { data: item } = await sb.from("portal_ap_inbox").select("*").eq("id", inboxId).single();
  if (!item) throw new Error("inbox item not found");
  await sb.from("portal_ap_inbox").update({ status:"processing" }).eq("id", inboxId);
  let routedTenantName = "";
  let knownCompanyText = "";
  try {
    const { data: tenantRows } = await sb.from("xero_tenants").select("tenant_id,tenant_name").order("tenant_name");
    const rows = Array.isArray(tenantRows) ? tenantRows : [];
    const cur = rows.find((t)=>t.tenant_id === item.tenant_id);
    routedTenantName = (cur && cur.tenant_name) || "";
    knownCompanyText = rows.map((t)=>"- " + (t.tenant_name || t.tenant_id) + " [" + t.tenant_id + "]").join("\n");
  } catch(_e){}
  // Wave 5: which LLM provider this tenant uses (default anthropic). Key presence is
  // checked inside callVisionLLM so a missing key routes to needs_review, not a crash.
  const aiProvider = String(route.ai_provider || "anthropic").toLowerCase();
  const aiModelResolved = resolveModel(aiProvider, route.ai_model);

  // ── Step 1: build NEUTRAL multimodal content (provider-agnostic) ────
  const contentBlocks = [];
  contentBlocks.push({ kind:"text", text:
    "ROUTED XERO TENANT ID: " + (item.tenant_id||"") + "\n" +
    "ROUTED COMPANY NAME: " + (routedTenantName || "(unknown)") + "\n\n" +
    "KNOWN GROUP COMPANIES:\n" + (knownCompanyText || "(not loaded)") + "\n\n" +
    "EMAIL FROM: " + (item.from_name||"") + " <" + (item.from_email||"") + ">\n" +
    "SUBJECT: " + (item.subject||"") + "\n\n" +
    "RAW PAYLOAD / SOURCE METADATA:\n" + JSON.stringify(item.raw_payload || {}).slice(0, 4000) + "\n\n" +
    "BODY:\n" + (item.text_body || item.html_body || "(empty)")
  });
  for (const a of (item.attachments||[])){
    const mime = String(a.mime||"");
    if (mime.startsWith("image/")){
      try {
        const { data: f } = await sb.storage.from("portal-ap-uploads").download(a.storage_path);
        if (f){
          const buf = new Uint8Array(await f.arrayBuffer());
          let bin = ""; const chunk = 8192;
          for (let i=0; i<buf.length; i+=chunk) bin += String.fromCharCode.apply(null, buf.subarray(i, Math.min(i+chunk, buf.length)));
          contentBlocks.push({ kind:"image", mime, b64: btoa(bin) });
        }
      } catch(_e){}
    } else if (mime === "application/pdf"){
      try {
        const { data: f } = await sb.storage.from("portal-ap-uploads").download(a.storage_path);
        if (f){
          const buf = new Uint8Array(await f.arrayBuffer());
          let bin = ""; const chunk = 8192;
          for (let i=0; i<buf.length; i+=chunk) bin += String.fromCharCode.apply(null, buf.subarray(i, Math.min(i+chunk, buf.length)));
          contentBlocks.push({ kind:"pdf", b64: btoa(bin) });
        }
      } catch(_e){}
    }
  }

  // ── Step 1b (opt-in): Google Document AI high-precision OCR → GPT-5.4 reasoning ──
  // Only runs when this tenant's portal_ap_settings.ocr_provider = 'docai'. Otherwise the
  // effective provider stays whatever the tenant picked (default vision-LLM) — zero change.
  let effProvider = aiProvider, effModel = aiModelResolved;
  let ocrProvider = String(route.ocr_provider || "").toLowerCase();
  if (!ocrProvider){
    try {
      const { data: apc } = await sb.from("portal_ap_settings").select("ocr_provider,ai_model").eq("tenant_id", item.tenant_id).maybeSingle();
      if (apc){ ocrProvider = String(apc.ocr_provider || "vision-llm").toLowerCase(); if (!route.ai_model && apc.ai_model) route.ai_model = apc.ai_model; }
    } catch(_e){}
  }
  if (!ocrProvider) ocrProvider = "vision-llm";
  if (ocrProvider === "docai"){
    const isReimb = /reimburse|claim|expense|report|报销|申请|索赔/i.test(String(item.subject||"") + " " + String(item.text_body||""));
    const docaiTexts = []; let docaiOk = false;
    for (const blk of contentBlocks){
      if (blk.kind === "pdf" || blk.kind === "image"){
        const res = await callDocAI(blk.b64, blk.mime || "application/pdf", isReimb ? "expense" : "invoice");
        if (res.ok && res.doc){ const txt = docaiEntitiesToText(res.doc); if (txt){ docaiTexts.push(txt); docaiOk = true; } }
        else docaiTexts.push("(Document AI could not read this file: " + (res.error||"empty") + ")");
      }
    }
    if (docaiOk){
      // Prepend the structured extraction so GPT-5.4 reasons over exact fields.
      contentBlocks.splice(1, 0, { kind:"text", text: docaiTexts.join("\n\n---- next document ----\n\n") });
      // Invoices: Doc AI already read everything precisely → drop heavy image/pdf blocks (text-only GPT-5.4 = cheaper).
      // Reimbursements: KEEP the images so GPT-5.4 can visually verify signatures / stamps / payment proof.
      if (!isReimb){ for (let i=contentBlocks.length-1; i>=0; i--){ if (contentBlocks[i].kind === "image" || contentBlocks[i].kind === "pdf") contentBlocks.splice(i,1); } }
      effProvider = "openai";
      effModel = resolveModel("openai", route.ai_model || "gpt-5.4");
      try { await logDecision(inboxId, "processing", "Doc AI OCR ok (" + docaiTexts.length + " doc[s]) → reasoning with " + effModel + (isReimb?" +image":" text-only")); } catch(_e){}
    } else {
      // Doc AI unavailable/failed → fall back to the tenant's normal vision provider (never silently lose the doc).
      try { await logDecision(inboxId, "processing", "Doc AI unavailable, fell back to " + aiProvider + " vision: " + String(docaiTexts[0]||"").slice(0,120)); } catch(_e){}
    }
  }

  // ── Step 2: Claude — extract + classify + audit ────────────────────
  const cap = Number(route.max_auto_post_amount||1000);
  const sys = `You are CTG Finance Operation Automation Controller, acting as a senior AP accountant, finance operations reviewer, and Xero bookkeeping automation engine for a Malaysia multi-company group.

You review finance documents before Xero posting. Behave like a careful AP accountant: identify the correct company, validate the document, detect issues, decide whether correction is needed, classify Chart of Account, prepare a Xero bill/spend-money draft, generate sender reply if required, and produce audit-ready notes.

Return ONE valid JSON object only. No prose. No markdown fences.

Processing order:
1. Identify target company.
2. Identify document type.
3. Extract fields from email body, attachments, OCR text, and Google Drive metadata/links.
4. Validate document completeness.
5. Validate company name/address.
6. Validate supplier/vendor information.
7. Validate invoice date, invoice number, currency, subtotal, tax, and total.
8. Check approval/signature requirements.
9. Check duplicate risk signals.
10. Assess Malaysia tax/SST/WHT/imported service tax risk.
11. Classify Xero transaction type.
12. Select company-specific COA if enough evidence exists.
13. Decide final action.
14. Draft correction reply if needed.

Company routing rules:
- This portal may receive AP files for multiple companies.
- Use these signals in priority order: email subject company code/name, Google Drive folder/path/link metadata, file name, sender/vendor mapping, and buyer company name/address extracted from the invoice.
- The backend already routed this email to a Xero tenant. You must verify that the document buyer/company matches that routed company.
- If subject or Drive folder indicates one company but invoice buyer name indicates another, set company_routing_status="company_conflict".
- If the company is unknown or conflicted, do not approve posting.
- Do not use a global default COA when company is unknown or conflicted.

Google Drive rules:
- If the email contains a Google Drive link but the invoice file is not accessible/attached/readable, set server_decision="google_drive_access_issue".
- Ask the sender to grant access to the finance/AP account or resend the invoice/claim as PDF.
- Preserve any Drive link/folder hints in audit_notes.

Valid supplier invoice requirements:
- Formal invoice/tax invoice, not quotation, proforma, statement, or payment reminder only.
- Supplier name is present.
- Supplier registration/SST/business number is present when expected.
- Buyer company name matches the routed company.
- Invoice number exists.
- Invoice date exists.
- Currency exists or can be clearly inferred.
- Subtotal, tax, discount, and total reconcile.
- Line items are understandable.
- Required approval/supporting document exists if indicated by policy/email.

Valid reimbursement/staff claim requirements:
- Claimant name exists.
- Business purpose exists.
- Claim form or approval evidence exists.
- Receipts/invoices are attached for each claim item.
- Payment proof is attached where required.
- Claimant and approver signature/approval evidence exist where required.
- Amounts match across claim form, receipts, and payment proof.

Malaysia accounting and tax review:
- Flag for review if SST treatment is unclear.
- Flag for review if foreign vendor/service may trigger withholding tax.
- Flag for review if imported service tax risk exists.
- Flag capitalisation risk for assets/equipment or useful life > 1 year.
- Flag prepayment risk for annual/advance services, rent, insurance, or subscriptions.
- If uncertain, lower confidence and set needs_review or reply_drafted.

Decision values:
- approved_for_posting
- needs_review
- reply_drafted
- compliance_rejected
- duplicate_rejected
- company_conflict
- company_unknown
- google_drive_access_issue

Auto-post eligible only when all are true:
- company_routing_status is company_matched_high_confidence
- known vendor or complete vendor details
- known/high-confidence GL rule
- amount is normal and below policy cap
- no duplicate risk
- approval/signature requirements are met
- tax treatment is clear
- OCR confidence is high
- buyer company name/address match
- no WHT/SST/imported service uncertainty

Required JSON schema:
{
  "doc_type": "invoice|reimbursement|receipt|credit_note|po|do|statement|unknown",
  "confidence": "high|medium|low",
  "company_routing_status": "company_matched_high_confidence|company_matched_medium_confidence|company_conflict|company_unknown",
  "company_code": string,
  "company_name": string,
  "company_conflict_reason": string,
  "vendor_name": string,
  "supplier_registration_no": string|null,
  "supplier_sst_no": string|null,
  "buyer_name_on_document": string|null,
  "buyer_address_on_document": string|null,
  "invoice_no": string|null,
  "invoice_date": "YYYY-MM-DD"|null,
  "due_date": "YYYY-MM-DD"|null,
  "currency": string,
  "subtotal": number,
  "tax_amount": number,
  "discount_amount": number,
  "claimant": string|null,
  "total": number,
  "line_items": [{"description": string, "quantity": number, "unit_amount": number, "account_code": string|null, "tax_type": string|null, "gl_confidence": "high|medium|low", "gl_reason": string, "gl_matched_keyword": string|null}],
  "bill_to_company": string|null,
  "inv_is_formal": boolean,
  "inv_has_supplier_id": boolean,
  "inv_bill_to_correct": boolean,
  "reimb_has_claim_form": boolean,
  "reimb_claimant_signed": boolean,
  "reimb_approver_signed": boolean,
  "reimb_all_invoices_attached": boolean,
  "reimb_payment_proof_attached": boolean,
  "amount_consistent": boolean,
  "date_consistent": boolean,
  "duplicate_risk": "none|possible|confirmed",
  "tax_review": {
    "sst_risk": "none|unclear|applicable",
    "wht_risk": "none|unclear|applicable",
    "imported_service_tax_risk": "none|unclear|applicable",
    "capitalisation_risk": "none|possible",
    "prepayment_risk": "none|possible"
  },
  "suggested_xero_type": "ACCPAY|SPEND|EXPENSE_CLAIM|APCREDIT|NONE",
  "suggested_gl_account": string,
  "suggested_tax_type": string,
  "tracking_category": string,
  "issues": [string],
  "server_decision": "approved_for_posting|needs_review|reply_drafted|compliance_rejected|duplicate_rejected|company_conflict|company_unknown|google_drive_access_issue",
  "server_reasoning": string,
  "reply_subject": string,
  "reply_body": string,
  "audit_notes": [string]
}

Important:
- Do not guess missing invoice number, date, amount, or company.
- Do not approve if buyer company name is wrong.
- Do not approve if approval/signature is required but missing.
- Do not approve if Google Drive file is inaccessible.
- Put every problem in issues.
- Keep reply_body empty if no reply is needed.
- Use Malaysia context and MYR unless another currency is clearly shown.`;
  // Wave 5 + Doc AI: call the effective provider (Doc AI mode forces openai/GPT-5.4; else tenant's pick).
  let parsed = null;
  const llm = await callVisionLLM(effProvider, effModel, sys, contentBlocks, 2500);
  if (!llm.ok){
    await logDecision(inboxId, "needs_review", "LLM (" + effProvider + ") error: " + llm.error);
    await sb.from("portal_ap_inbox").update({ status:"needs_review", status_detail:"AI (" + effProvider + ") error: " + String(llm.error).slice(0,200) }).eq("id", inboxId);
    return;
  }
  {
    const m = String(llm.text||"").match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch(_e){} }
  }
  if (!parsed){
    await logDecision(inboxId, "needs_review", "Could not parse " + aiProvider + " JSON output");
    await sb.from("portal_ap_inbox").update({ status:"needs_review", status_detail:"Could not parse AI (" + aiProvider + ") response" }).eq("id", inboxId);
    return;
  }
  parsed.issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  parsed.audit_notes = Array.isArray(parsed.audit_notes) ? parsed.audit_notes : [];
  parsed.line_items = Array.isArray(parsed.line_items) ? parsed.line_items : [];
  parsed.tax_review = parsed.tax_review || {};
  if (!parsed.currency) parsed.currency = "MYR";

  // ── Step 3: layered DUPLICATE detection (Wave 3, spec §D) ───────────
  // Layer 1 (message-id + attachment SHA-256) already ran at intake in ap_inbound.
  // Here we run the content-based layers against Claude's extracted fields.
  let dupHit = null;
  let dupLayer = null;
  const dupVendor = parsed.vendor_name || (item.from_name || item.from_email || "");
  // Layer 3: vendor + total within N days (already-posted bills in Xero cache).
  try {
    const { data: dupRows } = await sb.rpc("portal_ap_find_duplicate", {
      p_tenant: item.tenant_id,
      p_vendor: dupVendor,
      p_total: Number(parsed.total||0),
      p_days: Number(route.duplicate_check_days || 90),
    });
    if (Array.isArray(dupRows) && dupRows.length > 0){ dupHit = dupRows[0]; dupLayer = "L3_vendor_total"; }
  } catch (_e) {}
  // Layer 2: hard key (vendor + invoice_no) — same invoice number even if total/date drifted.
  if (!dupHit && parsed.invoice_no){
    try {
      const { data: r2 } = await sb.rpc("portal_ap_find_dup_invoice_no", { p_tenant: item.tenant_id, p_vendor: dupVendor, p_invoice_no: String(parsed.invoice_no) });
      if (Array.isArray(r2) && r2.length > 0){ dupHit = { invoice_id: r2[0].ref, number: String(parsed.invoice_no), status: r2[0].status, total: r2[0].total, source: r2[0].source }; dupLayer = "L2_invoice_no"; }
    } catch (_e) {}
  }
  // Layer 4: reimbursement fuzzy — same claimant + amount + date(±3d).
  if (!dupHit && String(parsed.doc_type||"").toLowerCase() === "reimbursement"){
    try {
      const claimant = parsed.claimant || parsed.vendor_name || "";
      const rdate = /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.invoice_date||"")) ? String(parsed.invoice_date) : null;
      const { data: r4 } = await sb.rpc("portal_ap_find_dup_reimbursement", { p_tenant: item.tenant_id, p_claimant: claimant, p_total: Number(parsed.total||0), p_date: rdate, p_exclude_inbox: inboxId });
      if (Array.isArray(r4) && r4.length > 0){ dupHit = { invoice_id: String(r4[0].inbox_id), number: "", status: r4[0].status, total: r4[0].total, source: "reimbursement_claim" }; dupLayer = "L4_reimbursement"; }
    } catch (_e) {}
  }

  // ── Step 4: GL coding cascade for each line item (Wave 2, spec §E) ──
  // Cascade: learned vendor+line → learned vendor → keyword rule → LLM suggestion → default.
  // High-confidence learned/keyword matches let us keep the audit trail rich AND flag
  // pure-LLM-guess lines (new vendor, no rule) so they never silently auto-post.
  const vendorForCoding = parsed.vendor_name || item.from_name || item.from_email || "";
  const enrichedLines = [];
  let unmappedLines = 0;     // no code at all after all fallbacks (should be ~0 with default)
  let newVendorLines = 0;    // relied only on the raw LLM guess — no learned history, no keyword rule
  for (const li of (parsed.line_items||[])){
    let acc = null, gl_conf = null, gl_reason = null, gl_match = null;
    try {
      const { data: casRows } = await sb.rpc("portal_ap_gl_cascade", { p_tenant: item.tenant_id, p_vendor: vendorForCoding, p_description: li.description || "" });
      if (Array.isArray(casRows) && casRows.length > 0){
        acc = casRows[0].account_code;
        gl_conf = Number(casRows[0].gl_confidence);
        gl_reason = casRows[0].gl_reason;
        gl_match = casRows[0].match_type;
      }
    } catch (_e) {}
    if (!acc){
      // Cascade found nothing → keep the LLM's own suggestion if it gave one.
      if (li.account_code){ acc = li.account_code; gl_match = "llm"; gl_conf = 0.40; gl_reason = "LLM suggestion (no learned history or keyword rule)"; newVendorLines++; }
      else { newVendorLines++; }
    }
    if (!acc){ acc = route.default_gl_account || "904-2200"; gl_match = "default"; gl_conf = 0.20; gl_reason = "Fell back to default GL — no match anywhere"; unmappedLines++; }
    enrichedLines.push({ ...li, account_code: acc, gl_confidence: gl_conf, gl_reason, gl_match_type: gl_match, gl_matched_keyword: gl_match==="keyword" ? (gl_reason||"") : null });
  }

  // ── Step 5: COMPLIANCE GATING ──────────────────────────────────────
  const issues = Array.isArray(parsed.issues) ? [...parsed.issues] : [];
  const total = Number(parsed.total||0);
  let decision = null; // duplicate_rejected | compliance_rejected | company_conflict | company_unknown | google_drive_access_issue | auto_authorised | needs_review
  let reasoning = "";

  const aiDecision = String(parsed.server_decision || "");
  const routingStatus = String(parsed.company_routing_status || "");
  const taxReview = parsed.tax_review || {};
  const hasTaxRisk =
    taxReview.sst_risk === "unclear" || taxReview.sst_risk === "applicable" ||
    taxReview.wht_risk === "unclear" || taxReview.wht_risk === "applicable" ||
    taxReview.imported_service_tax_risk === "unclear" || taxReview.imported_service_tax_risk === "applicable" ||
    taxReview.capitalisation_risk === "possible" ||
    taxReview.prepayment_risk === "possible";

  if (aiDecision === "google_drive_access_issue"){
    decision = "google_drive_access_issue";
    reasoning = parsed.server_reasoning || "Google Drive invoice/claim link is not accessible or readable";
    issues.push("Google Drive access issue: ask sender to grant AP/finance access or resend as PDF");
  } else if (routingStatus === "company_conflict" || aiDecision === "company_conflict"){
    decision = "company_conflict";
    reasoning = parsed.company_conflict_reason || parsed.server_reasoning || "Company in subject/Drive route does not match buyer company on document";
    issues.push("Company conflict: " + reasoning);
  } else if (routingStatus === "company_unknown" || aiDecision === "company_unknown"){
    decision = "company_unknown";
    reasoning = parsed.server_reasoning || "Could not identify the correct company from subject, Drive path, sender mapping, or invoice buyer name";
    issues.push("Company unknown: cannot post to Xero until company is confirmed");
  } else if (routingStatus && routingStatus !== "company_matched_high_confidence" && routingStatus !== "company_matched_medium_confidence"){
    decision = "company_unknown";
    reasoning = "Company routing status is not postable: " + routingStatus;
    issues.push(reasoning);
  } else if (dupHit){
    decision = "duplicate_rejected";
    const dupWhat = dupLayer === "L2_invoice_no" ? "same invoice number already recorded"
                  : dupLayer === "L4_reimbursement" ? "same claimant + amount + date already claimed"
                  : "same vendor + amount within the dedup window";
    reasoning = "Duplicate (" + (dupLayer||"L3") + " — " + dupWhat + "): " + (dupHit.number||dupHit.invoice_id||"") + " [" + (dupHit.status||"") + (dupHit.inv_date?(", "+dupHit.inv_date):"") + ", total " + (dupHit.total!=null?dupHit.total:"?") + "]";
    issues.push("Possible duplicate — " + dupWhat + ". Review before posting.");
  } else if (parsed.doc_type === "reimbursement" && route.require_4item_reimbursement !== false){
    const miss = [];
    if (!parsed.reimb_has_claim_form) miss.push("a formal claim form");
    if (!parsed.reimb_claimant_signed) miss.push("claimant signature");
    if (!parsed.reimb_approver_signed) miss.push("approver/manager signature (second signature)");
    if (!parsed.reimb_all_invoices_attached) miss.push("formal invoices for every line item (app screenshots are not acceptable)");
    if (!parsed.reimb_payment_proof_attached) miss.push("payment proof (card statement or bank receipt showing you already paid)");
    if (miss.length){
      decision = "compliance_rejected";
      reasoning = "Reimbursement is missing: " + miss.join("; ");
      for (const m of miss) issues.push("Missing: " + m);
    }
  } else if (parsed.doc_type === "invoice"){
    const miss = [];
    if (!parsed.inv_is_formal) miss.push("a formal invoice (not a receipt/quotation/statement)");
    if (!parsed.inv_has_supplier_id) miss.push("supplier SST registration no. OR business registration no.");
    if (!parsed.inv_bill_to_correct) miss.push("correct bill-to (must be one of our 5 Sdn Bhd)");
    if (miss.length){
      decision = "compliance_rejected";
      reasoning = "Invoice is missing: " + miss.join("; ");
      for (const m of miss) issues.push("Missing: " + m);
    }
  }
  if (!parsed.amount_consistent) issues.push("Amounts don't match across the email body / form / supporting documents");
  if (!parsed.date_consistent) issues.push("Period dates are inconsistent (subject vs filename vs form vs receipts)");
  if (hasTaxRisk) issues.push("Tax/accounting review needed: SST/WHT/imported service tax/capitalisation/prepayment risk detected");

  // Wave 3 spec §C: deterministic AMOUNT RECONCILIATION (never trust the LLM's arithmetic).
  // Sum the line items ourselves and compare to the claimed total. Tolerate small rounding,
  // and allow the gap to be explained by a stated tax/discount figure when present.
  let reconcileFail = false;
  const lineSum = (parsed.line_items||[]).reduce((s, l) => s + (Number(l.quantity)||1) * (Number(l.unit_amount)||0), 0);
  const roundedLineSum = Math.round(lineSum * 100) / 100;
  if (total > 0 && roundedLineSum > 0){
    const tax = Number(parsed.tax_amount || parsed.sst_amount || 0);
    const disc = Number(parsed.discount_amount || 0);
    const expected = Math.round((roundedLineSum + tax - disc) * 100) / 100;
    const gap = Math.abs(expected - total);
    // tolerance: 1 cent per line (rounding) or 0.5% of total, whichever is larger, min RM0.02
    const tol = Math.max(0.02, (parsed.line_items||[]).length * 0.01, Math.min(total * 0.005, 25));
    if (gap > tol){
      reconcileFail = true;
      issues.push("Amount reconciliation failed: lines(" + roundedLineSum.toFixed(2) + ") + tax(" + tax.toFixed(2) + ") − discount(" + disc.toFixed(2) + ") = " + expected.toFixed(2) + " ≠ stated total " + total.toFixed(2) + " (gap " + gap.toFixed(2) + " MYR)");
    }
  }

  // Wave 2 spec §E: "New vendor / low confidence → never auto-post."
  // A line coded only by the raw LLM guess (no learned vendor history, no keyword rule)
  // means we haven't seen this vendor/line before — route to human review so the operator's
  // decision is captured into vendor_coding_history and future bills auto-code confidently.
  const requireKnownVendor = route.require_known_vendor_for_autopost !== false; // default true
  const newVendorBlock = requireKnownVendor && newVendorLines > 0;
  if (newVendorBlock) issues.push(newVendorLines + " line(s) coded only by AI (new vendor / no learned rule) — review to teach the system");

  // Wave 4 spec §G: Xero transaction-type gate. Credit notes / already-paid docs must NOT
  // auto-post as a bill — route to human review with the reason.
  const typeGate = apXeroTypeGate(parsed);
  if (!typeGate.autoPostable) issues.push(typeGate.reason);

  // If still no decision (i.e. passed compliance) → route on amount + confidence
  if (!decision){
    const compliant = (parsed.amount_consistent !== false) && (parsed.date_consistent !== false);
    if (!typeGate.autoPostable){
      decision = "needs_review";
      reasoning = typeGate.reason;
    } else if (!compliant || reconcileFail || parsed.confidence === "low" || unmappedLines > 0 || newVendorBlock || routingStatus === "company_matched_medium_confidence" || hasTaxRisk){
      decision = "needs_review";
      reasoning = "Compliant but " + (reconcileFail ? "line amounts don't reconcile to the stated total" : unmappedLines>0 ? unmappedLines + " line(s) need a GL code" : newVendorBlock ? newVendorLines + " line(s) coded only by AI (new vendor) — review to teach the system" : "low confidence / consistency / company-routing / tax issues") + " — DRAFT for human review";
    } else if (total > cap){
      decision = "needs_review";
      reasoning = "Amount " + total + " > auto-post cap " + cap + " — DRAFT for approver";
    } else if (route.auto_post_when_compliant === false){
      decision = "needs_review";
      reasoning = "Compliant but auto-post is disabled for this tenant — DRAFT for human review";
    } else {
      decision = "auto_authorised";
      reasoning = "All compliance checks passed, total " + total + " <= cap " + cap + " — auto-posting AUTHORISED";
    }
  }

  // ── Step 6: write enriched verdict + status to DB ─────────────────
  const aiVerdict = {
    ...parsed,
    line_items: enrichedLines,
    server_duplicate: dupHit,
    server_decision: decision,
    server_reasoning: reasoning,
  };
  let nextStatus;
  switch (decision){
    case "duplicate_rejected": nextStatus = "duplicate_rejected"; break;
    case "compliance_rejected": nextStatus = "reply_drafted"; break;
    case "company_conflict": nextStatus = "reply_drafted"; break;
    case "company_unknown": nextStatus = "reply_drafted"; break;
    case "google_drive_access_issue": nextStatus = "reply_drafted"; break;
    case "auto_authorised": nextStatus = "auto_posting"; break; // updated again post-post
    default: nextStatus = "needs_review";
  }

  // Draft reply for correction cases and duplicate_rejected.
  let replySubject = null, replyBody = null;
  if (parsed.reply_subject || parsed.reply_body){
    replySubject = parsed.reply_subject || ("Re: " + (item.subject || ""));
    replyBody = parsed.reply_body || "";
  }
  if (decision === "duplicate_rejected"){
    replySubject = "Re: " + (item.subject || "") + " — DUPLICATE CLAIM, not processed";
    {
      // Defensive: Layer 2/4 duplicate hits don't carry inv_date/amount_due, so only show
      // the fields we actually have.
      const exLines = ["  • Existing record: " + (dupHit.number || dupHit.invoice_id || "(on file)")];
      if (dupHit.inv_date) exLines.push("  • Date: " + dupHit.inv_date);
      if (dupHit.total != null) exLines.push("  • Total: MYR " + dupHit.total);
      if (dupHit.status) exLines.push("  • Status: " + dupHit.status + (dupHit.amount_due != null ? (" (amount due: MYR " + dupHit.amount_due + ")") : ""));
      replyBody = "Hi " + (item.from_name || "team") + ",\n\nThank you for the submission. After review, this appears to be a duplicate of a submission we have already recorded:\n\n" + exLines.join("\n") + "\n\nThe new submission for MYR " + total + " matches an earlier one on the same key details.\n\nIf you believe this is a different, separate transaction, please reply with:\n  1. The reason this is a separate transaction\n  2. Distinct supporting invoices and a fresh payment receipt that has NOT been claimed before\n\nNo bill has been created in Xero for this submission.\n\nBest regards,\nCTG Finance AP";
    }
  } else if (decision === "compliance_rejected"){
    replySubject = "Re: " + (item.subject || "") + " — supporting documents needed";
    replyBody = "Hi " + (item.from_name || "team") + ",\n\nThank you for your submission. To process this " + (parsed.doc_type||"claim") + " for MYR " + total + ", we need the following items added/corrected:\n\n" + issues.map(i => "  • " + i).join("\n") + "\n\nOnce you reply with the corrected/additional documents, we'll process it. Until then, no bill has been created in Xero.\n\nBest regards,\nCTG Finance AP";
  } else if ((decision === "company_conflict" || decision === "company_unknown" || decision === "google_drive_access_issue") && !replyBody){
    replySubject = "Re: " + (item.subject || "") + " — correction needed before processing";
    replyBody = "Hi " + (item.from_name || "team") + ",\n\nThank you for your submission. We cannot process it yet for Xero because:\n\n" + issues.map(i => "  • " + i).join("\n") + "\n\nPlease reply with the corrected invoice/claim, confirm the correct company, or grant access to the shared Google Drive file if applicable.\n\nNo bill has been created in Xero for this submission.\n\nBest regards,\nCTG Finance AP";
  }
  if (replySubject) aiVerdict.suggested_reply_subject = replySubject;
  if (replyBody) aiVerdict.suggested_reply_body = replyBody;

  await sb.from("portal_ap_inbox").update({
    status: nextStatus,
    ai_verdict: aiVerdict,
    status_detail: (decision + " — " + reasoning).slice(0, 400),
    reply_subject: replySubject,
    reply_body: replyBody,
  }).eq("id", inboxId);

  await logDecision(inboxId, decision, reasoning, dupHit ? (dupHit.invoice_id||null) : null, { rule_pack:"ap-controller-v5-provider", ai_provider: aiProvider, ai_model: aiModelResolved, cap, dup_layer: dupLayer, reconcile_fail: reconcileFail, line_sum: roundedLineSum, gl_unmapped: unmappedLines, gl_new_vendor_lines: newVendorLines, gl_match_types: enrichedLines.map((l)=>l.gl_match_type), gl_min_confidence: enrichedLines.reduce((m,l)=>Math.min(m, Number(l.gl_confidence||1)), 1), require_known_vendor: requireKnownVendor, company_routing_status: routingStatus, tax_review: taxReview });

  // ── Step 7: take action automatically per decision ────────────────
  if (decision === "auto_authorised"){
    try {
      await apAutoPostBill(inboxId, item, parsed, enrichedLines);
    } catch(e){
      await sb.from("portal_ap_inbox").update({ status:"needs_review", status_detail:("auto-post failed: " + String(e).slice(0,200)) }).eq("id", inboxId);
      await logDecision(inboxId, "auto_post_failed", String(e).slice(0,500));
    }
  } else if ((decision === "duplicate_rejected" || decision === "compliance_rejected" || decision === "company_conflict" || decision === "company_unknown" || decision === "google_drive_access_issue") && route.auto_reply_when_rejected !== false){
    try {
      await apAutoReply(inboxId, item, replySubject, replyBody, route);
    } catch(e){
      await sb.from("portal_ap_inbox").update({ status_detail:("auto-reply failed: " + String(e).slice(0,200)) }).eq("id", inboxId);
      await logDecision(inboxId, "auto_reply_failed", String(e).slice(0,500));
    }
  }
}

async function logDecision(inboxId, decision, reasoning, dupOf, ruleVersions){
  try {
    await sb.from("portal_ap_decisions").insert({
      inbox_id: inboxId, decision, reasoning: String(reasoning||"").slice(0,2000),
      duplicate_of: dupOf || null, rule_versions: ruleVersions || null,
    });
  } catch(_e){}
}

// Auto-post the bill to Xero as AUTHORISED, attach source files, update status.
// Wave 4 (spec §G): decide the Xero transaction type. Only normal payables (ACCPAY),
// incl. reimbursements (billed to the claimant as a contact), are safe to auto-post as a
// bill. Credit notes and already-paid (spend) documents post to DIFFERENT Xero endpoints —
// auto-posting them as a bill would double what we owe or mis-record cash, so we refuse to
// auto-post and route to human review with a clear reason instead.
function apXeroTypeGate(verdict){
  const t = String(verdict.suggested_xero_type||"").toUpperCase();
  const doc = String(verdict.doc_type||"").toLowerCase();
  if (t === "APCREDIT" || doc === "credit_note" || doc === "creditnote"){
    return { autoPostable:false, xeroType:"ACCPAYCREDIT", reason:"This is a supplier CREDIT NOTE — it must be entered as a Xero credit note (reduces what we owe), not as a bill. Handle manually." };
  }
  if (t === "SPEND"){
    return { autoPostable:false, xeroType:"SPEND", reason:"Document indicates it is ALREADY PAID — record it as a spend/bank transaction against the paying account, not as an unpaid bill. Handle manually." };
  }
  // ACCPAY (default) and EXPENSE_CLAIM (reimbursement billed to the claimant) → normal bill.
  return { autoPostable:true, xeroType:"ACCPAY", reason:null };
}

// Wave 4: build a minimal, always-valid single-page PDF (Helvetica, Latin-1 text) with the
// AP audit summary, so Xero has a human-readable cover sheet alongside the source files.
// Hand-rolled (no dependency) with runtime-computed xref offsets so it is always well-formed.
function buildAuditPdf(titleLines){
  const esc = (s) => String(s==null?"":s).split("").map(function(ch){return ch.charCodeAt(0)>255?" ":ch;}).join("").replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");
  // Wrap long lines to ~92 chars so nothing runs off the page.
  const wrapped = [];
  for (const raw of titleLines){
    const s = String(raw==null?"":raw);
    if (s.length <= 92){ wrapped.push(s); continue; }
    let rest = s;
    while (rest.length > 92){ wrapped.push(rest.slice(0,92)); rest = rest.slice(92); }
    if (rest) wrapped.push(rest);
  }
  const body = wrapped.slice(0, 60); // one page
  const content = "BT /F1 10 Tf 40 800 Td 13 TL\n" + body.map((l,i)=> (i===0? "" : "T* ") + "(" + esc(l) + ") Tj").join("\n") + "\nET";
  const enc = new TextEncoder();
  const objs = [];
  objs.push("<</Type/Catalog/Pages 2 0 R>>");
  objs.push("<</Type/Pages/Kids[3 0 R]/Count 1>>");
  objs.push("<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>");
  objs.push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>");
  objs.push("<</Length " + enc.encode(content).length + ">>\nstream\n" + content + "\nendstream");
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (let i=0;i<objs.length;i++){ offsets.push(enc.encode(pdf).length); pdf += (i+1) + " 0 obj\n" + objs[i] + "\nendobj\n"; }
  const xrefStart = enc.encode(pdf).length;
  pdf += "xref\n0 " + (objs.length+1) + "\n0000000000 65535 f \n";
  for (const off of offsets){ pdf += String(off).padStart(10,"0") + " 00000 n \n"; }
  pdf += "trailer\n<</Size " + (objs.length+1) + "/Root 1 0 R>>\nstartxref\n" + xrefStart + "\n%%EOF";
  return enc.encode(pdf);
}

async function apAutoPostBill(inboxId, item, verdict, lines){
  const vendor = verdict.vendor_name || item.from_name || item.from_email || "Unknown";
  const access = await xeroAccessToken();
  const cid = await resolveContact(item.tenant_id, vendor);
  const now = new Date(Date.now() + 8*3600*1000);
  const today = now.toISOString().slice(0,10);
  const inv = {
    Type:"ACCPAY",
    Contact: cid ? { ContactID: cid } : { Name: String(vendor).slice(0,500) },
    Date: verdict.invoice_date || today,
    DueDate: verdict.due_date || new Date(Date.now() + 30*86400000 + 8*3600*1000).toISOString().slice(0,10),
    // v64: post as SUBMITTED (Awaiting Approval), NOT AUTHORISED. Operator explicitly chose
    // this per CLAUDE.md safety red line "Xero永远停在SUBMITTED, 绝不 Authorise / 不付款".
    // Auto-post still runs autonomously — this just keeps a human approval gate before payment.
    Status: "SUBMITTED",
    LineAmountTypes: "Exclusive",
    LineItems: lines.map((l)=>({
      Description: String(l.description||"Item").slice(0,4000),
      Quantity: Number(l.quantity)||1,
      UnitAmount: Number(l.unit_amount)||0,
      AccountCode: l.account_code,
    })),
  };
  if (verdict.invoice_no) inv.InvoiceNumber = String(verdict.invoice_no).slice(0,255);
  if (verdict.currency) inv.CurrencyCode = String(verdict.currency);
  const idem = await sha256Hex(JSON.stringify(inv) + "|inbox:" + inboxId + "|auto");
  const r = await fetch("https://api.xero.com/api.xro/2.0/Invoices", {
    method:"POST",
    headers:{ "Authorization":"Bearer "+access, "Xero-Tenant-Id": item.tenant_id, "Content-Type":"application/json", "Accept":"application/json", "Idempotency-Key": idem },
    body: JSON.stringify({ Invoices:[inv] }),
  });
  const out = await r.json();
  const iv = (out.Invoices||[])[0] || {};
  if (!r.ok && !iv.InvoiceID) throw new Error(out.Detail || out.Message || JSON.stringify(out).slice(0,400));
  if (iv.HasErrors) throw new Error((iv.ValidationErrors||[]).map((e)=>e.Message).join("; "));

  await sb.from("portal_ap_inbox").update({
    status:"posted",
    xero_invoice_id: iv.InvoiceID,
    xero_invoice_number: iv.InvoiceNumber,
    posted_at: new Date().toISOString(),
  }).eq("id", inboxId);
  // v69 (Wave 1c): every successful auto-post seeds the vendor coding history for future cascade.
  await recordVendorCodingHistory(item.tenant_id, vendor, lines, "auto_post", {
    invoice_id: iv.InvoiceID,
    invoice_number: iv.InvoiceNumber,
    invoice_amount: Number(iv.Total || 0),
    invoice_date: inv.Date,
    ai_verdict: verdict || null,
  });

  // Wave 4 (spec §G/§77): attach a machine-generated AUDIT COVER SHEET (PDF) first, then the
  // original source files. The cover sheet gives Xero a self-contained audit record of how the
  // AI reached this bill — best-effort, never blocks the post.
  try {
    const coverPdf = buildAuditPdf([
      "CTG FINANCE — AP AUTO-POST AUDIT COVER SHEET",
      "",
      "Xero Bill:     " + (iv.InvoiceNumber||"") + "   (" + (iv.InvoiceID||"") + ")",
      "Vendor:        " + vendor,
      "Bill total:    MYR " + (Number(iv.Total||verdict.total||0)).toFixed(2),
      "Invoice no:    " + (verdict.invoice_no||"(Xero auto)"),
      "Invoice date:  " + (inv.Date||""),
      "Due date:      " + (inv.DueDate||""),
      "Status posted: SUBMITTED (Awaiting Approval — payment requires a human)",
      "",
      "Source email:  " + (item.subject||""),
      "From:          " + (item.from_name||"") + " <" + (item.from_email||"") + ">",
      "Doc type:      " + (verdict.doc_type||""),
      "",
      "Line items + GL coding:",
      ...lines.map((l,i)=> "  " + (i+1) + ". " + String(l.description||"").slice(0,60) + "  x" + (Number(l.quantity)||1) + " @ " + (Number(l.unit_amount)||0).toFixed(2) + "  -> GL " + (l.account_code||"?") + (l.gl_reason? ("  ("+String(l.gl_reason).slice(0,50)+")") : "")),
      "",
      "AI verdict:    " + (verdict.server_decision||"auto_authorised"),
      "Reasoning:     " + (verdict.server_reasoning||""),
      "Confidence:    " + (verdict.confidence||"n/a"),
      "",
      "Generated by CTG Finance Portal · " + new Date(Date.now()+8*3600*1000).toISOString().slice(0,19).replace("T"," ") + " MYT",
    ]);
    await fetch("https://api.xero.com/api.xro/2.0/Invoices/" + iv.InvoiceID + "/Attachments/" + encodeURIComponent("AP_Audit_CoverSheet.pdf"), {
      method:"POST",
      headers:{ "Authorization":"Bearer "+access, "Xero-Tenant-Id": item.tenant_id, "Content-Type":"application/pdf" },
      body: coverPdf,
    });
  } catch(_e){}

  // Attach source files to the Xero invoice (best-effort)
  if (item.attachments && Array.isArray(item.attachments)){
    for (const a of item.attachments){
      try {
        const { data: fileData } = await sb.storage.from("portal-ap-uploads").download(a.storage_path);
        if (fileData){
          const buf = await fileData.arrayBuffer();
          await fetch("https://api.xero.com/api.xro/2.0/Invoices/" + iv.InvoiceID + "/Attachments/" + encodeURIComponent(a.name), {
            method:"POST",
            headers:{ "Authorization":"Bearer "+access, "Xero-Tenant-Id": item.tenant_id, "Content-Type": a.mime||"application/octet-stream" },
            body: buf,
          });
        }
      } catch(_e){}
    }
  }
  await logDecision(inboxId, "auto_posted", "Posted to Xero as " + iv.InvoiceNumber + " (" + iv.InvoiceID + ") · type " + (verdict._xero_type||"ACCPAY") + " · cover sheet + " + ((item.attachments||[]).length) + " file(s) attached");
}

// Auto-reply via Gmail SMTP (preferred) or Resend.
async function apAutoReply(inboxId, item, subject, body, route){
  if (!subject || !body) return;
  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = (route && route.reply_from_email) || gmailUser || "ap@ctgfinance.local";
  const fromName  = (route && route.reply_from_name)  || "CTG Finance AP";
  const toEmail   = item.from_email;
  const inReplyTo = item.message_id || "";

  if (gmailUser && gmailPass){
    let smtpClient: any = null;
    try {
      const { SMTPClient } = await import("https://deno.land/x/denomailer@1.6.0/mod.ts");
      smtpClient = new SMTPClient({ connection:{ hostname:"smtp.gmail.com", port:465, tls:true, auth:{ username: gmailUser, password: gmailPass } } });
      const headers: any = {};
      if (inReplyTo) { headers["In-Reply-To"] = inReplyTo; headers["References"] = inReplyTo; }
      await smtpClient.send({ from: fromName + " <" + gmailUser + ">", to: toEmail, subject, content: body, headers });
    } finally {
      if (smtpClient){ try { await smtpClient.close(); } catch(_e){} }
    }
  } else if (resendKey){
    const r = await fetch("https://api.resend.com/emails", {
      method:"POST",
      headers:{ "Authorization":"Bearer "+resendKey, "Content-Type":"application/json" },
      body: JSON.stringify({ from: fromName + " <" + fromEmail + ">", to:[toEmail], subject, text: body, headers: inReplyTo ? { "In-Reply-To": inReplyTo, "References": inReplyTo } : undefined }),
    });
    if (!r.ok){ throw new Error("Resend " + r.status + " " + (await r.text()).slice(0,300)); }
  } else {
    throw new Error("No mail transport configured (need GMAIL_USER+GMAIL_APP_PASSWORD or RESEND_API_KEY)");
  }

  await sb.from("portal_ap_inbox").update({
    status: (await getStatus(inboxId)) === "duplicate_rejected" ? "duplicate_rejected_replied" : "reply_sent",
    reply_sent_at: new Date().toISOString(),
  }).eq("id", inboxId);
  await logDecision(inboxId, "auto_replied", "Replied to " + toEmail);
}

async function getStatus(inboxId){
  const { data } = await sb.from("portal_ap_inbox").select("status").eq("id", inboxId).single();
  return data ? data.status : null;
}

async function applyInvoiceBatch(tenant_id, arr){
  if (!arr || !arr.length) return { upserted: 0, deleted: 0, error: null };
  const live = []; const dead = [];
  for (const iv of arr){
    const s = String(iv.Status || "").toUpperCase();
    if (s === "VOIDED" || s === "DELETED") dead.push(iv.InvoiceID); else live.push(iv);
  }
  let upserted = 0, deleted = 0, batchErr = null;
  if (live.length){
    const rows = live.map((iv)=>invToCacheRow(tenant_id, iv));
    const { error } = await sb.from("xero_invoice_cache").upsert(rows, { onConflict:"tenant_id,invoice_id" });
    if (error){
      // Try per-row fallback so ONE bad invoice doesn't blackhole the whole batch.
      let ok = 0; const bad = [];
      for (const r of rows){
        const { error: e2 } = await sb.from("xero_invoice_cache").upsert(r, { onConflict:"tenant_id,invoice_id" });
        if (e2) bad.push({ invoice_id: r.invoice_id, number: r.number, err: String(e2.message||e2).slice(0,200) }); else ok++;
      }
      upserted = ok;
      batchErr = "upsert: " + String(error.message||error).slice(0,200) + (bad.length ? " | " + bad.length + " rows failed individually (first: " + bad[0].invoice_id + " " + bad[0].err + ")" : "");
      console.error("applyInvoiceBatch upsert error", tenant_id, batchErr);
    } else {
      upserted = rows.length;
    }
  }
  if (dead.length){
    const { error } = await sb.from("xero_invoice_cache").delete().eq("tenant_id", tenant_id).in("invoice_id", dead);
    if (error){
      const msg = "delete: " + String(error.message||error).slice(0,200);
      batchErr = batchErr ? batchErr + " | " + msg : msg;
      console.error("applyInvoiceBatch delete error", tenant_id, msg);
    } else {
      deleted = dead.length;
    }
  }
  return { upserted, deleted, error: batchErr };
}
// ── v28: backfill using ModifiedAfter — one endpoint catches every status transition.
// Strategy: pull every invoice modified since `sinceISO` (no Statuses filter).
// Default sinceISO for a true full sync = epoch-ish (2015-01-01) on first run, else last_full_sync_at - 7d overlap.
async function runBackfill(access, list, opts){
  opts = opts || {};
  let fetched=0, upserted=0, deleted=0; const per=[];
  for (const t of list){
    let tCount=0, tDel=0, tErr=null;
    const blocked = await isRateLimited(t.tenant_id);
    if (blocked){ per.push({ tenant: t.tenant_name, invoices: 0, error: "skipped: rate-limit cooldown until " + blocked }); continue; }
    // Pick a "since" cutoff:
    //   - explicit opts.sinceISO wins
    //   - else last_full_sync_at minus 7-day overlap (safety)
    //   - else 2015-01-01 (first-ever sync)
    let sinceISO = opts.sinceISO || null;
    if (!sinceISO){
      try{ const { data: st } = await sb.from("xero_sync_state").select("last_full_sync_at").eq("tenant_id", t.tenant_id).maybeSingle();
        if (st && st.last_full_sync_at) sinceISO = new Date(new Date(st.last_full_sync_at).getTime() - 7*24*3600*1000).toISOString();
      }catch(_e){}
      if (!sinceISO) sinceISO = "2015-01-01T00:00:00Z";
    }
    const sinceHeader = new Date(sinceISO).toUTCString();
    try {
      // page through ALL modified invoices, no status filter → captures AUTHORISED/SUBMITTED/PAID/VOIDED/DELETED.
      for (let page=1; page<=100; page++){
        let d;
        try { d = await xeroGet(access, t.tenant_id, "Invoices?page=" + page + "&order=UpdatedDateUTC%20ASC", { "If-Modified-Since": sinceHeader }); }
        catch (e) { tErr = String(e); break; }
        if (d.__notModified) break;
        const arr = d.Invoices || []; if (!arr.length) break;
        fetched += arr.length;
        const r = await applyInvoiceBatch(t.tenant_id, arr);
        upserted += r.upserted; deleted += r.deleted; tCount += r.upserted; tDel += r.deleted;
        // Per-batch upsert/delete failures used to be swallowed silently — surface them now.
        if (r.error){ tErr = (tErr ? tErr + " | " : "") + "batch p" + page + ": " + r.error; }
        if (arr.length < 100) break;
      }
      if (tErr){
        await recordRateLimit(t.tenant_id, tErr);
        await syncStateUpdate(t.tenant_id, { last_error: tErr.slice(0,500), last_error_at: new Date().toISOString() });
      } else {
        await syncStateUpdate(t.tenant_id, { last_full_sync_at: new Date().toISOString(), last_full_sync_invoices: tCount, last_error: null, last_error_at: null, rate_limited_until: null });
      }
    } catch (e) {
      await recordRateLimit(t.tenant_id, e);
      await syncStateUpdate(t.tenant_id, { last_error: String(e).slice(0,500), last_error_at: new Date().toISOString() });
      tErr = String(e);
    }
    per.push({ tenant: t.tenant_name, invoices: tCount, deleted: tDel, error: tErr });
  }
  return { fetched, upserted, deleted, per };
}
// ── v28: delta sync uses ModifiedAfter (no Statuses filter) so VOIDED/DELETED transitions reach the cache.
async function runDelta(access, list, sinceISO){
  let fetched=0, upserted=0, deleted=0; const per=[];
  const sinceHeader = sinceISO ? new Date(sinceISO).toUTCString() : null;
  for (const t of list){
    let tCount=0, tDel=0, tErr=null;
    const blocked = await isRateLimited(t.tenant_id);
    if (blocked){ per.push({ tenant: t.tenant_name, invoices: 0, error: "skipped: rate-limit cooldown until " + blocked }); continue; }
    try {
      for (let page=1; page<=50; page++){
        const path = "Invoices?page=" + page + "&order=UpdatedDateUTC%20ASC";
        let d;
        try { d = await xeroGet(access, t.tenant_id, path, sinceHeader ? { "If-Modified-Since": sinceHeader } : undefined); }
        catch (e) { tErr = String(e); break; }
        if (d.__notModified) break;
        const arr = d.Invoices || []; if (!arr.length) break;
        fetched += arr.length;
        const r = await applyInvoiceBatch(t.tenant_id, arr);
        upserted += r.upserted; deleted += r.deleted; tCount += r.upserted; tDel += r.deleted;
        if (r.error){ tErr = (tErr ? tErr + " | " : "") + "delta-batch p" + page + ": " + r.error; }
        if (arr.length < 100) break;
      }
      if (tErr){
        await recordRateLimit(t.tenant_id, tErr);
        await syncStateUpdate(t.tenant_id, { last_error: tErr.slice(0,500), last_error_at: new Date().toISOString() });
      } else {
        await syncStateUpdate(t.tenant_id, { last_delta_sync_at: new Date().toISOString(), last_delta_sync_invoices: tCount, last_error: null, last_error_at: null, rate_limited_until: null });
      }
    } catch (e) {
      await recordRateLimit(t.tenant_id, e);
      await syncStateUpdate(t.tenant_id, { last_error: String(e).slice(0,500), last_error_at: new Date().toISOString() });
      tErr = String(e);
    }
    per.push({ tenant: t.tenant_name, invoices: tCount, deleted: tDel, error: tErr });
  }
  return { fetched, upserted, deleted, per };
}
async function processPending(limit){ return processPendingDedup(limit); }
// v71 (watchdog): send an operator alert via Gmail SMTP. Recipient = portal_secrets 'alert_email'
// if set, else the finance mailbox itself. Best-effort — never throws.
async function sendAlertEmail(subject, body){
  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!gmailUser || !gmailPass) return { ok:false, error:"no gmail creds" };
  let to = gmailUser;
  try { const { data } = await sb.from("portal_secrets").select("value").eq("key","alert_email").maybeSingle(); if (data && data.value) to = data.value; } catch(_e){}
  let smtpClient: any = null;
  try {
    const { SMTPClient } = await import("https://deno.land/x/denomailer@1.6.0/mod.ts");
    smtpClient = new SMTPClient({ connection:{ hostname:"smtp.gmail.com", port:465, tls:true, auth:{ username: gmailUser, password: gmailPass } } });
    await smtpClient.send({ from: "CTG Sync Watchdog <" + gmailUser + ">", to, subject, content: body });
    return { ok:true, to };
  } catch(e){ return { ok:false, error:String(e).slice(0,300) }; }
  finally { if (smtpClient){ try { await smtpClient.close(); } catch(_e){} } }
}
async function handleWebhook(req, sig){
  const key = await getWebhookKey();
  const raw = await req.text();
  if (!key) return new Response("webhook key not configured", { status: 500 });
  let expected; try { expected = await hmacSha256B64(key, raw); } catch (_e) { return new Response("err", { status: 500 }); }
  if (!timingSafeEqual(expected, sig)) return new Response("unauthorized", { status: 401 });
  let payload; try { payload = JSON.parse(raw || "{}"); } catch { payload = {}; }
  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length){
    const rows = events.map((e)=>({ tenant_id:e.tenantId||null, event_category:e.eventCategory||null, event_type:e.eventType||null, resource_id:e.resourceId||null, resource_url:e.resourceUrl||null, event_date:e.eventDateUtc||null, raw:e }));
    let inserted = [];
    try { const { data } = await sb.from("xero_webhook_events").insert(rows).select("id"); inserted = data || []; } catch (_e) {}
    // v71: process INLINE on receipt (seconds, not the 5-min cron) via the BATCHED processor —
    // it picks up the rows just inserted, batches invoice fetches, and is skip-if-cached +
    // cooldown + budget aware. Fire-and-forget after the 200 so Xero's "intent to receive" stays healthy.
    // v64: still log errors instead of swallowing them — earlier regressions were masked by .catch(()=>{}).
    try {
      const p = processPendingDedup(150).catch((e)=>{ try { console.error("inline processPendingDedup failed:", e && (e.stack || e.message || e)); } catch (_) {} });
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p);
    } catch (e) { try { console.error("inline webhook dispatch threw:", e); } catch (_) {} }
  }
  return new Response(null, { status: 200 });
}
// ── v28: ID-level drift reconciliation. Fetches every open AR/AP invoice ID from Xero,
// compares to cache's open IDs, then ACTUALLY REPAIRS the diff (auto-prune extras, fetch missing).
// "Open" = AUTHORISED + SUBMITTED, the only statuses that should appear in OPEN AR/AP. PAID/VOIDED
// are excluded from the comparison (they're allowed to linger in cache for history).
async function runDriftCheck(access, tenant_id, opts){
  opts = opts || {};
  const blocked = await isRateLimited(tenant_id);
  if (blocked) return { tenant_id, skipped: true, rate_limited_until: blocked };
  // 1. Fetch every open invoice from Xero (ID + Status), both types.
  const xeroOpen = new Map(); // invoice_id -> { id, status, type }
  let xeroSeen = 0;
  try {
    for (const ty of ["ACCREC","ACCPAY"]){
      for (let page=1; page<=100; page++){
        const d = await xeroGet(access, tenant_id, "Invoices?Statuses=AUTHORISED,SUBMITTED&page=" + page + "&where=" + encodeURIComponent('Type=="' + ty + '"'));
        const arr = d.Invoices || []; if (!arr.length) break;
        for (const iv of arr){ xeroOpen.set(iv.InvoiceID, { id: iv.InvoiceID, status: iv.Status, type: iv.Type, full: iv }); }
        xeroSeen += arr.length;
        if (arr.length < 100) break;
      }
    }
  } catch (e) {
    await recordRateLimit(tenant_id, e);
    throw e;
  }
  // 2. Read every open ID from cache.
  const cacheOpen = new Map(); // invoice_id -> status
  let cursor = 0; const PAGE = 1000;
  while (true){
    const { data, error } = await sb.from("xero_invoice_cache").select("invoice_id,status").eq("tenant_id", tenant_id).in("status", ["AUTHORISED","SUBMITTED"]).range(cursor, cursor + PAGE - 1);
    if (error || !data || !data.length) break;
    for (const r of data) cacheOpen.set(r.invoice_id, r.status);
    if (data.length < PAGE) break;
    cursor += PAGE;
  }
  // 3. Compute diff.
  const missing = []; // in xero, not in cache
  const extra = [];   // in cache, not in xero (must re-query to discover actual current status)
  for (const [id, info] of xeroOpen){ if (!cacheOpen.has(id)) missing.push(info); }
  for (const id of cacheOpen.keys()){ if (!xeroOpen.has(id)) extra.push(id); }
  // 4. Repair missing: upsert directly from the data we already pulled.
  let repaired = 0;
  if (missing.length){
    const r = await applyInvoiceBatch(tenant_id, missing.map(m => m.full));
    repaired += r.upserted;
  }
  // 5. Repair extras: re-query each by ID, apply real status (PAID/VOIDED/DELETED → upsert or delete).
  //    Cap at 50 per drift run to avoid rate-limit blowup on a stale cache; rest waits for next cron.
  let repairedExtras = 0;
  if (extra.length && !opts.skipExtraRepair){
    const cap = Math.min(extra.length, 50);
    for (let i=0; i<cap; i++){
      try {
        const d = await xeroGet(access, tenant_id, "Invoices/" + extra[i]);
        const iv = (d.Invoices || [])[0];
        if (iv){ const r = await applyInvoiceBatch(tenant_id, [iv]); repairedExtras += r.upserted + r.deleted; }
        else { // Xero says invoice no longer exists → delete from cache.
          await sb.from("xero_invoice_cache").delete().eq("tenant_id", tenant_id).eq("invoice_id", extra[i]); repairedExtras++;
        }
      } catch (e) { await recordRateLimit(tenant_id, e); break; }
    }
  }
  const driftAfter = (cacheOpen.size + missing.length - repaired) - xeroOpen.size;
  await syncStateUpdate(tenant_id, {
    last_drift_check_at: new Date().toISOString(),
    cache_drift_count: cacheOpen.size - xeroOpen.size,
    last_drift_extra: extra.length,
    last_drift_missing: missing.length,
    last_repair_at: (repaired + repairedExtras) > 0 ? new Date().toISOString() : null,
    last_repair_count: repaired + repairedExtras,
  });
  return {
    tenant_id, xero_open: xeroOpen.size, cache_open: cacheOpen.size,
    drift: cacheOpen.size - xeroOpen.size,
    missing: missing.length, extra: extra.length,
    repaired_missing: repaired, repaired_extras: repairedExtras,
    remaining_extras: Math.max(0, extra.length - 50),
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method === "GET") {
    const u = new URL(req.url); const qp = u.searchParams;
    if (qp.get("code") && qp.get("state")) return await xeroOAuthCallback(qp);
    if (qp.get("xero_oauth") === "start") return await xeroOAuthStart(qp);
    return new Response("portal up", { status: 200, headers: CORS });
  }
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  const xsig = req.headers.get("x-xero-signature");
  if (xsig !== null) { try { return await handleWebhook(req, xsig); } catch (_e) { return new Response("err", { status: 200 }); } }
  const ip = clientIp(req);
  let b; try { b = await req.json(); } catch { return j({ error:"bad json" }, 400); }
  // Inbound email webhook detection: Postmark / Resend / SendGrid POST the raw email payload
  // without our {api,payload} wrapper. If we see the secret header AND no `api` field, auto-wrap.
  const apInboundSecret = req.headers.get("x-ap-inbound-secret");
  if (apInboundSecret && !b.api) {
    // Pass the secret through `b.secret` as well so the handler's existing check works.
    b = { api: "ap_inbound", payload: b, secret: apInboundSecret };
  }
  const api = b.api;
  try {
    if (api === "cron_sync") {
      const { data: sec } = await sb.from("portal_secrets").select("value").eq("key","cron").single();
      if (!sec || !sec.value || b.cron_secret !== sec.value) return j({ ok:false, error:"forbidden" }, 403);
      const work = (async ()=>{ try { const access = await xeroAccessToken(); const { data: tenants } = await sb.from("xero_tenants").select("tenant_id,tenant_name"); const bf = await runBackfill(access, tenants||[]); const pr = await processPending(500); // v28: auto drift-repair after nightly backfill; up to 50 extras/tenant per run
        const driftResults = []; for (const t of (tenants||[])){ try { const dr = await runDriftCheck(access, t.tenant_id); driftResults.push({ tenant: t.tenant_name, ...dr }); } catch (e) { driftResults.push({ tenant: t.tenant_name, error: String(e).slice(0,200) }); } }
        await sb.from("portal_audit").insert({ action:"cron_sync", ref:"daily", detail:{ upserted:bf.upserted, deleted:bf.deleted, processed:pr.processed, remaining:pr.remaining, drift: driftResults } });
        try { await sb.rpc("portal_cron_heartbeat", { p_name:"cron_sync", p_status:"ok", p_detail:{ upserted:bf.upserted, deleted:bf.deleted } }); } catch (_e) {}
      } catch (e) { try { await sb.from("portal_audit").insert({ action:"cron_sync_error", ref:"daily", detail:{ error:String(e) } }); } catch (_e) {} try { await sb.rpc("portal_cron_heartbeat", { p_name:"cron_sync", p_status:"error", p_detail:{ error:String(e).slice(0,400) } }); } catch (_e) {} } })();
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else work.catch(()=>{});
      return j({ ok:true, started:true });
    }
    if (api === "cron_retry") {
      const { data: sec } = await sb.from("portal_secrets").select("value").eq("key","cron").single();
      if (!sec || !sec.value || b.cron_secret !== sec.value) return j({ ok:false, error:"forbidden" }, 403);
      const work = (async ()=>{ try { const pr = await processPending(300); if (pr.processed > 0 || pr.remaining > 0) await sb.from("portal_audit").insert({ action:"cron_retry", ref:"every5min", detail: pr });
        try { await sb.rpc("portal_cron_heartbeat", { p_name:"cron_retry", p_status:"ok", p_detail:{ processed:pr.processed, remaining:pr.remaining } }); } catch (_e) {}
      } catch (e) { try { await sb.from("portal_audit").insert({ action:"cron_retry_error", ref:"every5min", detail:{ error:String(e) } }); } catch (_e) {} try { await sb.rpc("portal_cron_heartbeat", { p_name:"cron_retry", p_status:"error", p_detail:{ error:String(e).slice(0,400) } }); } catch (_e) {} } })();
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else work.catch(()=>{});
      return j({ ok:true, started:true });
    }
    if (api === "cron_watchdog") {
      // v71 (Tier-1 reliability): the SILENT-FAILURE alarm. The real damage last time wasn't that
      // sync broke — it's that nobody knew for 15 days. This cron reads portal_sync_health and
      // emails the operator (throttled) the moment backlog / stuck events / an overdue cron / a
      // stale cache appears, so a silent regression can never hide again.
      const { data: sec } = await sb.from("portal_secrets").select("value").eq("key","cron").single();
      if (!sec || !sec.value || b.cron_secret !== sec.value) return j({ ok:false, error:"forbidden" }, 403);
      const work = (async ()=>{
        try {
          const { data: h } = await sb.rpc("portal_sync_health");
          const health = h || {};
          const problems = [];
          const backlog = Number(health.pending_events_total||0);
          const failing = Number(health.pending_events_failing||0);
          if (backlog > 200) problems.push("Webhook backlog: " + backlog + " events pending");
          if (failing > 0) problems.push(failing + " webhook event(s) failing (rate-limit / Xero error)");
          for (const c of (health.crons||[])){ if (c && c.overdue) problems.push("Cron overdue: " + c.cron_name + " (last ran " + (c.last_run_at||"never") + ")"); }
          const nowMs = Date.now();
          for (const t of (health.tenants||[])){
            // Staleness = the sync MECHANISM stopped running (last_delta_sync_at), NOT "no data changed".
            // A quiet tenant legitimately has an old cache_last_updated — that is normal, not a fault.
            // Delta runs every 20 min, so >90 min without a delta = ~4 consecutive misses = real problem.
            const deltaMin = t.last_delta_sync_at ? (nowMs - new Date(t.last_delta_sync_at).getTime())/60000 : 99999;
            if (deltaMin > 90) problems.push("Delta sync stalled: " + t.tenant_name + " (last ran " + (t.last_delta_sync_at ? Math.round(deltaMin)+"m ago" : "never") + ")");
            if (t.last_error) problems.push("Sync error: " + t.tenant_name + " — " + String(t.last_error).slice(0,80));
          }
          const signature = problems.slice().sort().join(" || ");
          let state: any = {};
          try { const { data: st } = await sb.from("portal_secrets").select("value").eq("key","watchdog_state").maybeSingle(); if (st && st.value) state = JSON.parse(st.value); } catch(_e){}
          let emailed: any = null;
          if (problems.length){
            // Throttle: re-email only when the problem set CHANGES, or >6h since the last alert.
            const changed = signature !== (state.signature || "");
            const stale6h = (nowMs - (state.alerted_at ? new Date(state.alerted_at).getTime() : 0)) > 6*3600*1000;
            if (changed || stale6h){
              const bodyTxt = "CTG Finance — Xero sync watchdog flagged " + problems.length + " issue(s):\n\n" +
                problems.map((p,i)=>(i+1)+". "+p).join("\n") +
                "\n\nOpen the portal → Users tab → Xero Sync Health for details.\nChecked at: " + new Date().toISOString();
              emailed = await sendAlertEmail("⚠ CTG Xero sync — " + problems.length + " issue(s) detected", bodyTxt);
            }
            const newState = { signature, alerted_at: (emailed && emailed.ok) ? new Date().toISOString() : (state.alerted_at||null), last_check: new Date().toISOString(), problems };
            await sb.from("portal_secrets").upsert({ key:"watchdog_state", value: JSON.stringify(newState), updated_at:new Date().toISOString() }, { onConflict:"key" });
          } else {
            // Healthy — reset the signature so the next problem alerts immediately (recovery = clean slate).
            await sb.from("portal_secrets").upsert({ key:"watchdog_state", value: JSON.stringify({ signature:"", alerted_at: state.alerted_at||null, last_check: new Date().toISOString(), problems:[] }), updated_at:new Date().toISOString() }, { onConflict:"key" });
          }
          await sb.from("portal_audit").insert({ action: problems.length ? "cron_watchdog_alert" : "cron_watchdog_ok", ref:"every30min", detail:{ problems, emailed } });
          try { await sb.rpc("portal_cron_heartbeat", { p_name:"cron_watchdog", p_status:"ok", p_detail:{ problems: problems.length } }); } catch(_e){}
        } catch (e) { try { await sb.from("portal_audit").insert({ action:"cron_watchdog_error", ref:"every30min", detail:{ error:String(e) } }); } catch(_e){} }
      })();
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else work.catch(()=>{});
      return j({ ok:true, started:true });
    }
    if (api === "cron_drift_repair") {
      const { data: sec } = await sb.from("portal_secrets").select("value").eq("key","cron").single();
      if (!sec || !sec.value || b.cron_secret !== sec.value) return j({ ok:false, error:"forbidden" }, 403);
      const work = (async ()=>{
        try {
          const access = await xeroAccessToken();
          const { data: tenants } = await sb.from("xero_tenants").select("tenant_id,tenant_name");
          const results = [];
          for (const t of (tenants||[])){
            try { const dr = await runDriftCheck(access, t.tenant_id); results.push({ tenant: t.tenant_name, ...dr }); }
            catch (e) { results.push({ tenant: t.tenant_name, error: String(e).slice(0,200) }); }
          }
          await sb.from("portal_audit").insert({ action:"cron_drift_repair", ref:"daily", detail:{ results } });
          try { await sb.rpc("portal_cron_heartbeat", { p_name:"cron_drift_repair", p_status:"ok", p_detail:{ tenants:results.length } }); } catch (_e) {}
        } catch (e) { try { await sb.from("portal_audit").insert({ action:"cron_drift_repair_error", ref:"daily", detail:{ error:String(e) } }); } catch (_e) {} }
      })();
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else work.catch(()=>{});
      return j({ ok:true, started:true });
    }
    if (api === "cron_delta") {
      const { data: sec } = await sb.from("portal_secrets").select("value").eq("key","cron").single();
      if (!sec || !sec.value || b.cron_secret !== sec.value) return j({ ok:false, error:"forbidden" }, 403);
      const work = (async ()=>{ try { const access = await xeroAccessToken(); const { data: tenants } = await sb.from("xero_tenants").select("tenant_id,tenant_name");
        // v28: per-tenant since = max(last_delta_sync_at, last_full_sync_at) - 15-min overlap. Falls back to 6h if no state yet — long enough to absorb one missed cycle.
        const { data: states } = await sb.from("xero_sync_state").select("tenant_id,last_delta_sync_at,last_full_sync_at").in("tenant_id", (tenants||[]).map(t=>t.tenant_id));
        const stMap = {}; (states||[]).forEach(s=>{ stMap[s.tenant_id] = s; });
        let totalUp=0, totalDel=0; const per=[];
        for (const t of (tenants||[])){
          const st = stMap[t.tenant_id]||{}; const base = st.last_delta_sync_at || st.last_full_sync_at;
          const since = base ? new Date(new Date(base).getTime() - 15*60*1000).toISOString() : new Date(Date.now() - 6*3600*1000).toISOString();
          const d = await runDelta(access, [t], since); totalUp += d.upserted; totalDel += d.deleted; per.push({ tenant: t.tenant_name, since, ...d.per[0] });
        }
        await sb.from("portal_audit").insert({ action:"cron_delta", ref:"hourly", detail:{ upserted:totalUp, deleted:totalDel, per } });
        try { await sb.rpc("portal_cron_heartbeat", { p_name:"cron_delta", p_status:"ok", p_detail:{ upserted:totalUp, deleted:totalDel } }); } catch (_e) {}
      } catch (e) { try { await sb.from("portal_audit").insert({ action:"cron_delta_error", ref:"hourly", detail:{ error:String(e) } }); } catch (_e) {} } })();
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else work.catch(()=>{});
      return j({ ok:true, started:true });
    }
    if (api === "login") { const { data } = await sb.rpc("portal_login", { p_email: b.email||"", p_pass: b.pass||"", p_ip: ip }); return j(data); }
    if (api === "login_2fa") {
      const lt = String(b.login_token||""); const code = String(b.code||"");
      const { data: secret } = await sb.rpc("portal_totp_secret_for_verify", { p_login_token: lt });
      if (!secret) return j({ ok:false, error:"invalid or expired login session" });
      const ok = await totpVerify(secret, code, 1);
      if (!ok) { await sb.from("portal_audit").insert({ action:"login_failed", ref:"2fa", detail:{ reason:"bad_totp", ip } }); return j({ ok:false, error:"Incorrect 6-digit code" }); }
      const { data } = await sb.rpc("portal_login_2fa_complete", { p_login_token: lt });
      return j(data);
    }
    if (api === "me") { const { data } = await sb.rpc("portal_me", { p_token: b.token||"" }); return j(data); }
    if (api === "my_perms") { const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401); const role=(me.user&&me.user.role)||"viewer"; const { data: r } = await sb.from("portal_roles").select("features,manage_users,label").eq("name", role).single(); return j({ ok:true, role, label:(r&&r.label)||role, features:(r&&r.features)||[], manage_users:!!(r&&r.manage_users) }); }
    if (api === "overview") { const { data } = await sb.rpc("portal_overview", { p_token: b.token||"" }); return j(data); }
    if (api === "overview_range") { const { data, error } = await sb.rpc("portal_overview_range", { p_token: b.token||"", p_from: b.from, p_to: b.to }); if (error) return j({ ok:false, error: error.message }); return j(data); }
    if (api === "pending") { const { data } = await sb.rpc("portal_pending_bills", { p_token: b.token||"" }); return j(data); }
    if (api === "approve") { const { data } = await sb.rpc("portal_approve_bill", { p_token: b.token||"", p_tenant: b.tenant, p_invoice: b.invoice, p_action: b.action }); return j(data); }
    if (api === "collections") { const { data } = await sb.rpc("portal_trigger_collections", { p_token: b.token||"" }); return j(data); }
    if (api === "changepw") { const { data } = await sb.rpc("portal_change_password", { p_token: b.token||"", p_old: b.old||"", p_new: b.neu||"" }); return j(data); }
    if (api === "upload") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.tenant) return j({ ok:false, error:"no tenant" });
      const allowed = await allowedTenants(b.token);
      if (allowed.indexOf(b.tenant) < 0) return await denyTenant(me, "upload", b.tenant);
      const raw = (b.content_base64||"").split(",").pop() || "";
      let bytes; try { bytes = Uint8Array.from(atob(raw), c=>c.charCodeAt(0)); } catch { return j({ ok:false, error:"bad file" }); }
      const safe = (b.file_name||"file").replace(/[^a-zA-Z0-9._-]/g,"_");
      const path = b.tenant + "/" + Date.now() + "_" + safe;
      const up = await sb.storage.from("portal-uploads").upload(path, bytes, { contentType: b.content_type||"application/octet-stream", upsert:false });
      if (up.error) return j({ ok:false, error: up.error.message });
      const { data } = await sb.rpc("portal_record_upload", { p_token: b.token||"", p_tenant: b.tenant, p_category: b.category, p_file: safe, p_note: b.note||"", p_link: path });
      return j(data);
    }
    if (api === "o2o_issue") {
      const me = await meFromToken(b.token); if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const allowed = await allowedTenants(b.token);
      // v60: target tenant is now selectable. Falls back to SKINDAE for backward compatibility.
      const targetTenant = String(b.tenant || SKINDAE_TENANT);
      const isSkindaeTarget = targetTenant === SKINDAE_TENANT;
      if (allowed.indexOf(targetTenant) < 0) return await denyTenant(me, "o2o_issue", targetTenant);
      const invs = Array.isArray(b.invoices) ? b.invoices : [];
      if (!invs.length) return j({ ok:false, error:"no invoices" });
      const period = String(b.period || "O2O billing");
      // v28: prefer the frontend-formatted "O2O Sales DD/MM/YYYY - DD/MM/YYYY" reference; fall back to raw period.
      const reference = String(b.reference || period).slice(0, 255);
      // v61: operator-picked invoice + due dates. Falls back to today / +30d if unset or malformed.
      // v64: defaults use MYT (UTC+8) so operators in Malaysia don't get yesterday's date
      // after 4pm-midnight local time (when UTC is still on the previous day).
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      const nowMyt = Date.now() + 8*3600*1000;
      const today = dateRe.test(String(b.invoice_date||"")) ? String(b.invoice_date) : new Date(nowMyt).toISOString().slice(0,10);
      const due = dateRe.test(String(b.due_date||"")) ? String(b.due_date) : new Date(nowMyt + 30*86400000).toISOString().slice(0,10);
      const built = [];
      for (const p of invs) {
        // v36: try the pharmacy master first — fastest, most accurate. Falls back to the contacts-cache name lookup.
        // v60: the master's xero_contact_id is SKINDAE-scoped; only use it when SKINDAE is the target.
        let cid = null; let masterSource = false;
        if (isSkindaeTarget) {
          try {
            const { data: pm } = await sb.rpc("portal_pharmacy_resolve_by_name", { p_name: p.pharmacy });
            if (pm && pm.ok && pm.pharmacy && pm.pharmacy.xero_contact_id) { cid = pm.pharmacy.xero_contact_id; masterSource = true; }
          } catch (_e) {}
        }
        if (!cid) cid = await resolveContact(targetTenant, p.pharmacy);
        // v28: forward ItemCode + DiscountRate when the frontend supplies them (per-SKU mode).
        // v60: ItemCode is SKU-scoped to each Xero org — only send it when SKINDAE is the target.
        const lineItems = (p.lines||[]).map((l)=>{
          const li = { Description:String(l.package||"Item").slice(0,4000), Quantity:Number(l.quantity)||1, UnitAmount:Number(l.unit_price)||0, AccountCode:O2O_REVENUE_CODE };
          if (isSkindaeTarget && l.item_code) li.ItemCode = String(l.item_code).slice(0,30);
          if (typeof l.discount_rate === "number" && l.discount_rate > 0) li.DiscountRate = Number(l.discount_rate);
          return li;
        });
        // v66: operator-picked invoice number (optional). When present it's forwarded to Xero;
        // Xero rejects duplicates → handled by the existing per-invoice HasErrors detection.
        const invoiceNumber = String(p.invoice_number||"").trim().slice(0,255);
        const xeroPayload: any = { Type:"ACCREC", Contact: cid?{ ContactID:cid }:{ Name:String(p.pharmacy||"").slice(0,500) }, Date:today, DueDate:due, Reference:reference, Status:"AUTHORISED", LineAmountTypes:"Exclusive", LineItems: lineItems };
        if (invoiceNumber) xeroPayload.InvoiceNumber = invoiceNumber;
        built.push({ matched: !!cid, masterSource, pharmacy: p.pharmacy, total: p.total, xero: xeroPayload });
      }
      if (b.dry_run !== false) return j({ ok:true, dry_run:true, tenant: targetTenant, issued:0, emailed:0, failed:0, results: built.map((x:any,i:number)=>({ pharmacy:x.pharmacy, total:x.total, number: x.xero.InvoiceNumber || "(Xero auto)", status:"dry_run", contact: x.matched?"existing":"new" })) });
      const access = await xeroAccessToken();
      const idem = await sha256Hex(JSON.stringify(built.map(x=>x.xero)) + "|" + period + "|" + targetTenant);
      const r = await fetch("https://api.xero.com/api.xro/2.0/Invoices?summarizeErrors=false", { method:"POST", headers:{ "Authorization":"Bearer " + access, "Xero-Tenant-Id":targetTenant, "Content-Type":"application/json", "Accept":"application/json", "Idempotency-Key": idem }, body: JSON.stringify({ Invoices: built.map(x=>x.xero) }) });
      const out = await r.json();
      if (!r.ok && !out.Invoices) return j({ ok:false, error: out.Detail || out.Message || JSON.stringify(out).slice(0,500) });
      const arr = out.Invoices || [];
      const results = built.map((p, i)=>{ const iv = arr[i]||{}; const hasErr = iv.HasErrors || (iv.ValidationErrors&&iv.ValidationErrors.length); return { pharmacy:p.pharmacy, total:p.total, number: iv.InvoiceNumber||"", contact: p.matched?"existing":"new", status: hasErr?"failed":(iv.InvoiceID?"issued":"failed"), error: hasErr?(iv.ValidationErrors||[]).map((e)=>e.Message).join("; "):undefined, contact_id: (iv.Contact && iv.Contact.ContactID) || undefined, invoice_id: iv.InvoiceID || undefined }; });
      // v36: write the resolved Xero ContactID back to the pharmacy master so future runs hit the fast path.
      // v60: pharmacy master's contact_id is SKINDAE-scoped — only remember when SKINDAE is the target
      //      (otherwise we'd overwrite Skindae's cached ID with another tenant's ID for the same pharmacy name).
      if (isSkindaeTarget) {
        for (let i=0; i<results.length; i++){
          const cid = results[i].contact_id;
          if (cid && results[i].status==="issued"){
            try { await sb.rpc("portal_pharmacy_remember_xero_contact", { p_name: results[i].pharmacy, p_contact_id: cid }); } catch(_e){}
          }
        }
      }
      await logAudit(me, "o2o_issue", period, { tenant: targetTenant, issued: results.filter(x=>x.status==="issued").length, idem });
      return j({ ok:true, dry_run:false, tenant: targetTenant, issued: results.filter(x=>x.status==="issued").length, emailed:0, failed: results.filter(x=>x.status==="failed").length, results });
    }
    if (api === "o2o_pdfs") {
      // v61: bulk-fetch Xero invoice PDFs for the freshly issued O2O batch.
      // Frontend passes { tenant, invoices:[{invoice_id, pharmacy, number, total}] } and
      // gets back { pdfs:[{invoice_id, pharmacy, filename, base64, error?}] } which it zips locally.
      // v63: throttle to batches of 8 with a 500ms breather to stay well under Xero's
      //      60 req/min rate limit; retry once on 429 / 5xx; include pharmacy + invoice_id
      //      on every result row so the UI can list failures and offer a targeted retry.
      const me = await meFromToken(b.token); if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const allowed = await allowedTenants(b.token);
      const pdfTenant = String(b.tenant || SKINDAE_TENANT);
      if (allowed.indexOf(pdfTenant) < 0) return await denyTenant(me, "o2o_pdfs", pdfTenant);
      const list = Array.isArray(b.invoices) ? b.invoices : [];
      if (!list.length) return j({ ok:false, error:"no invoices" });
      const pdfAccess = await xeroAccessToken();
      // Filenames: {Pharmacy}_{Number}_MYR{amount}.pdf; strip filesystem-hostile chars only.
      const safe = (s: string) => String(s||"").replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim();
      async function fetchOne(iv: any) {
        const invoice_id = safe(iv.invoice_id||"");
        const pharmName = String(iv.pharmacy||"");
        if (!invoice_id) return { invoice_id: null, pharmacy: pharmName, filename: null, base64: null, error: "no invoice_id" };
        const pharm = safe(iv.pharmacy) || "invoice";
        const num = safe(iv.number) || invoice_id.slice(0, 8);
        const amt = (Number(iv.total) || 0).toFixed(2);
        const filename = pharm + "_" + num + "_MYR" + amt + ".pdf";
        async function attempt(): Promise<Response> {
          return await fetch("https://api.xero.com/api.xro/2.0/Invoices/" + encodeURIComponent(invoice_id), { headers: { "Authorization":"Bearer " + pdfAccess, "Xero-Tenant-Id": pdfTenant, "Accept":"application/pdf" } });
        }
        try {
          let rr = await attempt();
          if (!rr.ok && (rr.status === 429 || rr.status >= 500)) {
            // retry once after a 3s wait — enough for Xero's rolling-minute window
            await new Promise((r) => setTimeout(r, 3000));
            rr = await attempt();
          }
          if (!rr.ok) return { invoice_id, pharmacy: pharmName, filename, base64: null, error: "HTTP " + rr.status };
          const buf = new Uint8Array(await rr.arrayBuffer());
          // base64 in chunks to avoid stack overflow on large PDFs
          let bin = "";
          for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 8192)) as any);
          const b64 = btoa(bin);
          return { invoice_id, pharmacy: pharmName, filename, base64: b64 };
        } catch (e: any) {
          return { invoice_id, pharmacy: pharmName, filename, base64: null, error: String((e && e.message) || e).slice(0, 200) };
        }
      }
      const CHUNK = 8;
      const pdfs: any[] = [];
      for (let i = 0; i < list.length; i += CHUNK) {
        const batch = list.slice(i, i + CHUNK);
        const chunkResults = await Promise.all(batch.map(fetchOne));
        pdfs.push(...chunkResults);
        if (i + CHUNK < list.length) await new Promise((r) => setTimeout(r, 500));
      }
      await logAudit(me, "o2o_pdfs", "download", { count: pdfs.filter((p)=>p.base64).length, failed: pdfs.filter((p)=>!p.base64).length, tenant: pdfTenant });
      return j({ ok:true, pdfs });
    }
    if (api === "inv_meta") {
      const me = await meFromToken(b.token); if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.tenant) return j({ ok:false, error:"no tenant" });
      const allowed = await allowedTenants(b.token);
      if (allowed.indexOf(b.tenant) < 0) return await denyTenant(me, "inv_meta", b.tenant);
      const { data: contacts } = await sb.from("xero_contacts_cache").select("contact_id,name,email").eq("tenant_id", b.tenant).order("name").limit(5000);
      const { data: accounts } = await sb.from("xero_accounts").select("code,name").eq("type","REVENUE").eq("status","ACTIVE").order("code");
      let items = [];
      try { const access = await xeroAccessToken(); const d = await xeroGet(access, b.tenant, "Items"); items = (d.Items||[]).filter((it)=> it.IsSold !== false).map((it)=>({ code: it.Code, name: it.Name || it.Code, price: (it.SalesDetails && it.SalesDetails.UnitPrice) || 0, account: (it.SalesDetails && it.SalesDetails.AccountCode) || "", description: (it.SalesDetails && it.SalesDetails.Description) || it.Name || "" })); } catch (_e) { items = []; }
      return j({ ok:true, contacts: contacts||[], accounts: accounts||[], items });
    }
    if (api === "quick_invoice") {
      const me = await meFromToken(b.token); if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = b.tenant; if (!tenant) return j({ ok:false, error:"no tenant" });
      const allowed = await allowedTenants(b.token);
      if (allowed.indexOf(tenant) < 0) return await denyTenant(me, "quick_invoice", tenant);
      const li = (b.line_items||[]).map((l)=>({ Description:String(l.description||"Item").slice(0,4000), Quantity:Number(l.quantity)||1, UnitAmount:Number(l.unit_amount)||0, AccountCode:l.account_code||O2O_REVENUE_CODE }));
      if (!li.length) return j({ ok:false, error:"no line items" });
      let contact;
      if (b.contact_id) { contact = { ContactID: b.contact_id }; }
      else { const cid = await resolveContact(tenant, b.contact_name); contact = cid ? { ContactID: cid } : { Name: String(b.contact_name||"").slice(0,500) }; }
      const inv = { Type:"ACCREC", Contact: contact, Date: b.date||new Date().toISOString().slice(0,10), Status: b.status||"AUTHORISED", LineAmountTypes: b.line_amount_types||"Exclusive", LineItems: li };
      if (b.due_date) inv.DueDate = b.due_date;
      if (b.reference) inv.Reference = String(b.reference).slice(0,255);
      if (b.dry_run !== false) { const tot = li.reduce((s,x)=>s+x.Quantity*x.UnitAmount,0); return j({ ok:true, dry_run:true, total: Math.round(tot*100)/100, contact: contact.ContactID?"existing":"new", invoice: inv }); }
      const access = await xeroAccessToken();
      const idem = await sha256Hex(JSON.stringify(inv));
      const r = await fetch("https://api.xero.com/api.xro/2.0/Invoices", { method:"POST", headers:{ "Authorization":"Bearer " + access, "Xero-Tenant-Id":tenant, "Content-Type":"application/json", "Accept":"application/json", "Idempotency-Key": idem }, body: JSON.stringify({ Invoices:[inv] }) });
      const out = await r.json(); const iv = (out.Invoices||[])[0] || {};
      if (!r.ok && !iv.InvoiceID) return j({ ok:false, error: out.Detail || out.Message || JSON.stringify(out).slice(0,400) });
      if (iv.HasErrors) return j({ ok:false, error: (iv.ValidationErrors||[]).map((e)=>e.Message).join("; ") });
      await logAudit(me, "quick_invoice", iv.InvoiceNumber||"", { total: iv.Total, tenant, idem });
      return j({ ok:true, dry_run:false, invoice_id: iv.InvoiceID, number: iv.InvoiceNumber, total: iv.Total, contact: contact.ContactID?"existing":"new" });
    }
    if (api === "receivables") {
      const me = await meFromToken(b.token); if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const allowed = await allowedTenants(b.token);
      if (!allowed.length) return j({ ok:true, count:0, total:0, items:[] });
      let listTenantIds;
      if (b.tenant) { if (allowed.indexOf(b.tenant) < 0) return await denyTenant(me, "receivables", b.tenant); listTenantIds = [b.tenant]; }
      else { listTenantIds = allowed; }
      const { data: tn } = await sb.from("xero_tenants").select("tenant_id,tenant_name").in("tenant_id", listTenantIds);
      const list = tn || [];
      const access = await xeroAccessToken();
      // v64: age receivables using MYT so days_overdue matches the operator's local calendar.
      const now = Date.now() + 8*3600*1000; const items = [];
      for (const t of list) {
        try { const invs = await xeroInvoicesAll(access, t.tenant_id, "ACCREC");
          for (const iv of invs) { const due = Number(iv.AmountDue||0); if (due <= 0) continue; const dd = String(iv.DueDateString || iv.DueDate || "").slice(0,10); const days = dd ? Math.floor((now - new Date(dd).getTime())/86400000) : 0; items.push({ tenant_name:t.tenant_name, contact:(iv.Contact||{}).Name, email:(iv.Contact||{}).EmailAddress, number:iv.InvoiceNumber, amount_due:Math.round(due*100)/100, currency:iv.CurrencyCode||"MYR", due_date:dd, days_overdue:days }); }
        } catch (_e) {}
      }
      items.sort((a,b2)=>b2.days_overdue - a.days_overdue);
      return j({ ok:true, count: items.length, total: Math.round(items.reduce((s,x)=>s+x.amount_due,0)*100)/100, items: items.slice(0,1000) });
    }
    if (api === "cached_receivables") {
      const me = await meFromToken(b.token); if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data, error } = await sb.rpc("portal_ar_aging", { p_token: b.token||"", p_tenant: b.tenant||null, p_bucket: b.bucket||null });
      if (error) return j({ ok:false, error: error.message });
      return j(data || { ok:true, count:0, total:0, buckets:{}, items:[] });
    }
    if (api === "close_list") {
      const me = await meFromToken(b.token); if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const period = String(b.period || new Date().toISOString().slice(0,7));
      let { data: tasks } = await sb.from("portal_close_tasks").select("*").eq("period", period).order("sort");
      if (!tasks || !tasks.length) { const seed = CLOSE_TEMPLATE.map((t,i)=>({ period, title:t.title, category:t.category, sort:i, status:"pending" })); await sb.from("portal_close_tasks").insert(seed); const r2 = await sb.from("portal_close_tasks").select("*").eq("period", period).order("sort"); tasks = r2.data || []; }
      return j({ ok:true, period, tasks: tasks||[] });
    }
    if (api === "close_update") {
      const me = await meFromToken(b.token); if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.id) return j({ ok:false, error:"no id" });
      const upd = { updated_at: new Date().toISOString(), updated_by: (me.user&&me.user.email)||null };
      if (b.status!==undefined) upd.status = b.status;
      if (b.assignee!==undefined) upd.assignee = b.assignee;
      const { error } = await sb.from("portal_close_tasks").update(upd).eq("id", b.id);
      if (error) return j({ ok:false, error: error.message });
      return j({ ok:true });
    }
    if (api === "bank_reconcile") {
      const me = await meFromToken(b.token); if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = b.tenant; if (!tenant) return j({ ok:false, error:"no tenant" });
      const allowed = await allowedTenants(b.token);
      if (allowed.indexOf(tenant) < 0) return await denyTenant(me, "bank_reconcile", tenant);
      const lines = Array.isArray(b.lines) ? b.lines : [];
      if (!lines.length) return j({ ok:false, error:"no bank lines" });
      const access = await xeroAccessToken();
      const docs = [];
      for (const ty of ["ACCREC","ACCPAY"]) {
        try { const invs = await xeroInvoicesAll(access, tenant, ty); for (const iv of invs) { const due = Number(iv.AmountDue||0); if (due>0) docs.push({ kind: ty==="ACCREC"?"AR (money in)":"AP (money out)", amount: Math.round(due*100)/100, contact:(iv.Contact||{}).Name, number: iv.InvoiceNumber, date:(iv.DateString||iv.Date||"").slice(0,10) }); } } catch (_e) {}
      }
      const used = {};
      const results = lines.map((l)=>{ const amt = Math.round(Math.abs(Number(l.amount)||0)*100)/100; let match = null; for (let i=0;i<docs.length;i++){ if(used[i]) continue; if(Math.abs(docs[i].amount-amt)<0.01){ match=docs[i]; used[i]=true; break; } } return { date:l.date, amount:l.amount, description:l.description, match }; });
      return j({ ok:true, total: results.length, matched: results.filter(r=>r.match).length, outstanding_docs: docs.length, results });
    }
    if (api === "companies_list") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.from("xero_tenants").select("tenant_id,tenant_name").order("tenant_name");
      return j({ ok:true, companies: data||[] });
    }
    if (api === "tenants_refresh") {
      // v65: refresh org names from Xero's /connections. Nightly cron already syncs invoices,
      // but org NAMES only ever changed on OAuth reconnect — so a rename in Xero (or an
      // invisible unicode char accidentally slipping in earlier) never propagated. Now the
      // operator can force a resync from the Users tab.
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const access = await xeroAccessToken();
      const cr = await fetch("https://api.xero.com/connections", { headers:{ "Authorization":"Bearer "+access, "Content-Type":"application/json" } });
      if (!cr.ok) return j({ ok:false, error: "Xero /connections returned HTTP " + cr.status });
      const conns = await cr.json();
      if (!Array.isArray(conns)) return j({ ok:false, error: "Xero /connections returned unexpected shape" });
      // Strip invisible chars (word joiner, zero-width space, BOM etc.) that sometimes creep in
      // via copy-paste on the Xero side and would otherwise render as an off-by-one indent.
      // v67: use explicit \u escapes — the previous literal invisible chars in the regex
      // range broke the Supabase deploy build silently (each attempt fast-failed at ~19s).
      const clean = (s: string) => String(s||"").replace(/[​‌‍⁠﻿]/g, "").trim();
      const { data: existing } = await sb.from("xero_tenants").select("tenant_id,tenant_name");
      const before = new Map((existing||[]).map((r: any)=>[r.tenant_id, r.tenant_name]));
      const seen = new Set<string>();
      const renamed: any[] = []; const added: any[] = [];
      for (const c of conns) {
        const id = String(c.tenantId||""); if (!id) continue;
        const name = clean(String(c.tenantName||""));
        if (!name) continue;
        seen.add(id);
        const prev = before.get(id);
        if (prev === undefined) added.push({ tenant_id:id, tenant_name:name });
        else if (prev !== name) renamed.push({ tenant_id:id, from:prev, to:name });
        try { await sb.from("xero_tenants").upsert({ tenant_id:id, tenant_name:name }, { onConflict:"tenant_id" }); } catch(_e){}
      }
      const removed = (existing||[]).filter((r: any)=>!seen.has(r.tenant_id)).map((r: any)=>({ tenant_id:r.tenant_id, tenant_name:r.tenant_name }));
      await logAudit(me, "tenants_refresh", "xero_connections", { total: conns.length, renamed: renamed.length, added: added.length, removed: removed.length });
      const { data: after } = await sb.from("xero_tenants").select("tenant_id,tenant_name").order("tenant_name");
      return j({ ok:true, total: conns.length, renamed, added, removed, companies: after||[] });
    }
    if (api === "users_list") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data: users } = await sb.from("portal_users").select("id,email,name,role,active,created_at,last_login_at,last_login_ip,login_count,totp_enabled").order("created_at");
      const { data: uc } = await sb.from("portal_user_companies").select("user_id,tenant_id,role");
      return j({ ok:true, users: users||[], user_companies: uc||[] });
    }
    if (api === "user_create") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.email || !b.pass) return j({ ok:false, error:"email and password required" });
      const tenantIds = Array.isArray(b.tenants) ? b.tenants.map((t)=> typeof t==="string" ? t : (t&&t.tenant_id)).filter(Boolean) : [];
      const { data, error } = await sb.rpc("portal_create_user", { p_email: b.email, p_name: b.name||b.email, p_pass: b.pass, p_role: b.role||"viewer", p_tenants: tenantIds });
      if (error) return j({ ok:false, error: error.message });
      if (Array.isArray(b.tenants) && b.tenants.length && typeof b.tenants[0] === "object"){
        const uid = (data && (typeof data==="object" ? data.id : null)) || null;
        if (uid){ for (const t of b.tenants){ if (t && t.role) await sb.from("portal_user_companies").update({ role: t.role }).eq("user_id", uid).eq("tenant_id", t.tenant_id); } }
      }
      await logAudit(me, "user_create", b.email, { role: b.role, tenants: tenantIds });
      return j((data && typeof data==="object") ? data : { ok:true, result:data });
    }
    if (api === "user_update") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.user_id) return j({ ok:false, error:"no user_id" });
      const upd = {}; if (b.role!==undefined) upd.role=b.role; if (b.active!==undefined) upd.active=b.active; if (b.name!==undefined) upd.name=b.name;
      if (Object.keys(upd).length){ const { error } = await sb.from("portal_users").update(upd).eq("id", b.user_id); if (error) return j({ ok:false, error:error.message }); }
      if (Array.isArray(b.tenants)){ await sb.from("portal_user_companies").delete().eq("user_id", b.user_id); if (b.tenants.length){ const rows = b.tenants.map((t)=> typeof t==="string" ? { user_id:b.user_id, tenant_id:t, role:null } : { user_id:b.user_id, tenant_id:t.tenant_id, role:t.role||null }); const { error:e2 } = await sb.from("portal_user_companies").insert(rows); if (e2) return j({ ok:false, error:e2.message }); } }
      await logAudit(me, "user_update", b.user_id, { role: b.role, active: b.active, tenants: b.tenants });
      return j({ ok:true });
    }
    if (api === "user_reset_password") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.user_id || !b.new_pass) return j({ ok:false, error:"user_id and new_pass required" });
      const { data, error } = await sb.rpc("portal_admin_reset_password", { p_user_id: b.user_id, p_new_pass: b.new_pass });
      if (error) return j({ ok:false, error: error.message });
      await logAudit(me, "password_reset", b.user_id, {});
      return j(data || { ok:true });
    }
    if (api === "roles_list") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.from("portal_roles").select("*").order("is_system", { ascending:false }).order("name");
      return j({ ok:true, roles: data||[] });
    }
    if (api === "role_save") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const name = String(b.name||"").trim().toLowerCase().replace(/[^a-z0-9_]/g,"_"); if (!name) return j({ ok:false, error:"name required" });
      const row = { name, label: b.label||name, features: Array.isArray(b.features)?b.features:[], manage_users: !!b.manage_users };
      if (name==="admin") row.manage_users = true;
      const { error } = await sb.from("portal_roles").upsert(row, { onConflict:"name" });
      if (error) return j({ ok:false, error: error.message });
      await logAudit(me, "role_save", name, { features: row.features, manage_users: row.manage_users });
      return j({ ok:true });
    }
    if (api === "role_delete") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const name = String(b.name||""); if (!name) return j({ ok:false, error:"name required" });
      const { data: sys } = await sb.from("portal_roles").select("is_system").eq("name", name).single();
      if (sys && sys.is_system) return j({ ok:false, error:"cannot delete a system role" });
      const { count } = await sb.from("portal_users").select("id", { count:"exact", head:true }).eq("role", name);
      if (count && count>0) return j({ ok:false, error:"role is in use by "+count+" user(s)" });
      const { error } = await sb.from("portal_roles").delete().eq("name", name);
      if (error) return j({ ok:false, error: error.message });
      await logAudit(me, "role_delete", name, {});
      return j({ ok:true });
    }
    if (api === "audit_list") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.from("portal_audit").select("*").order("created_at", { ascending:false }).limit(Math.min(Number(b.limit)||120, 300));
      return j({ ok:true, events: data||[] });
    }
    if (api === "set_webhook_key") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const key = String(b.key||"").trim();
      if (key.length < 10) return j({ ok:false, error:"That key looks too short" });
      const { error } = await sb.from("portal_secrets").upsert({ key:"xero_webhook", value:key, updated_at:new Date().toISOString() }, { onConflict:"key" });
      if (error) return j({ ok:false, error: error.message });
      await logAudit(me, "set_webhook_key", "xero_webhook", {});
      return j({ ok:true });
    }
    if (api === "webhook_events") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.from("xero_webhook_events").select("*").order("received_at", { ascending:false }).limit(Math.min(Number(b.limit)||60, 200));
      const { data: tn } = await sb.from("xero_tenants").select("tenant_id,tenant_name");
      const nameByTenant = {}; (tn||[]).forEach((t)=>{ nameByTenant[t.tenant_id]=t.tenant_name; });
      const events = (data||[]).map((e)=>({ ...e, tenant_name: nameByTenant[e.tenant_id] || e.tenant_id }));
      const wk = await getWebhookKey(); const configured = !!wk;
      const { count: contactN } = await sb.from("xero_contacts_cache").select("contact_id", { count:"exact", head:true });
      const { count: invN } = await sb.from("xero_invoice_cache").select("invoice_id", { count:"exact", head:true });
      const { count: pendN } = await sb.from("xero_webhook_events").select("id", { count:"exact", head:true }).eq("processed", false);
      const { count: failN } = await sb.from("xero_webhook_events").select("id", { count:"exact", head:true }).eq("processed", false).gte("attempts", 3);
      return j({ ok:true, configured, events, contact_cache: contactN||0, invoice_cache: invN||0, pending: pendN||0, failing: failN||0 });
    }
    if (api === "sync_now") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const pr = await processPending(300);
      await logAudit(me, "xero_sync_now", String(pr.processed), { remaining: pr.remaining, deduplicated: pr.deduplicated, unique_resources: pr.unique_resources });
      return j({ ok:true, ...pr });
    }
    if (api === "xero_backfill") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const access = await xeroAccessToken();
      const { data: tenants } = await sb.from("xero_tenants").select("tenant_id,tenant_name");
      const list = (b.tenant ? (tenants||[]).filter((t)=>t.tenant_id===b.tenant) : (tenants||[]));
      const bf = await runBackfill(access, list, { sinceISO: b.sinceISO || null });
      await logAudit(me, "xero_backfill", String(list.length) + " tenant(s)", { fetched: bf.fetched, upserted: bf.upserted, deleted: bf.deleted });
      return j({ ok:true, tenants: list.length, fetched: bf.fetched, upserted: bf.upserted, deleted: bf.deleted, per: bf.per });
    }
    if (api === "delta_now") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const access = await xeroAccessToken();
      const { data: tenants } = await sb.from("xero_tenants").select("tenant_id,tenant_name");
      const list = (b.tenant ? (tenants||[]).filter((t)=>t.tenant_id===b.tenant) : (tenants||[]));
      const { data: states } = await sb.from("xero_sync_state").select("tenant_id,last_delta_sync_at,last_full_sync_at").in("tenant_id", list.map(t=>t.tenant_id));
      const sinceMap = {}; (states||[]).forEach((s)=>{ sinceMap[s.tenant_id] = s.last_delta_sync_at || s.last_full_sync_at; });
      const overall = { fetched:0, upserted:0, deleted:0, per:[] };
      for (const t of list){
        const base = sinceMap[t.tenant_id];
        const since = base ? new Date(new Date(base).getTime() - 15*60*1000).toISOString() : new Date(Date.now() - 24*3600*1000).toISOString();
        const d = await runDelta(access, [t], since);
        overall.fetched += d.fetched; overall.upserted += d.upserted; overall.deleted += d.deleted; overall.per.push(...d.per);
      }
      await logAudit(me, "delta_now", String(list.length), { fetched: overall.fetched, upserted: overall.upserted, deleted: overall.deleted });
      return j({ ok:true, tenants: list.length, fetched: overall.fetched, upserted: overall.upserted, deleted: overall.deleted, per: overall.per });
    }
    if (api === "sync_health") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.rpc("portal_sync_health");
      return j({ ok:true, ...(data||{}) });
    }
    /* ── AP Email Agent ── */
    if (api === "ap_settings_get") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.rpc("portal_ap_settings_get", { p_token: b.token||"" });
      return j(data || { ok:true, settings:[] });
    }
    if (api === "ap_settings_save") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.tenant) return j({ ok:false, error:"tenant required" });
      const { data, error } = await sb.rpc("portal_ap_settings_save", { p_token: b.token||"", p_tenant: b.tenant, p_patch: b.patch || {} });
      if (error) return j({ ok:false, error: error.message });
      return j(data || { ok:true });
    }
    if (api === "ap_inbox_list") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.rpc("portal_ap_inbox_list", { p_token: b.token||"", p_tenant: b.tenant||null, p_status: b.status||null, p_limit: Math.min(Number(b.limit)||100, 500) });
      return j(data || { ok:true, items:[] });
    }
    if (api === "ap_inbox_get") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.rpc("portal_ap_inbox_get", { p_token: b.token||"", p_id: Number(b.id) });
      // Generate signed download URLs for each attachment so the frontend can fetch them.
      if (data && data.ok && data.item && data.item.attachments) {
        const atts = data.item.attachments;
        for (const a of atts) {
          if (a.storage_path) {
            try { const { data: signed } = await sb.storage.from("portal-ap-uploads").createSignedUrl(a.storage_path, 300); if (signed) a.download_url = signed.signedUrl; } catch(_e){}
          }
        }
      }
      return j(data || { ok:false });
    }
    // Inbound webhook from Postmark / Resend / SendGrid Inbound. Verifies a shared-secret header.
    if (api === "ap_inbound") {
      const sec = req.headers.get("x-ap-inbound-secret") || b.secret || "";
      const { data: secRow } = await sb.from("portal_secrets").select("value").eq("key","ap_inbound").single();
      if (!secRow || !secRow.value || sec !== secRow.value) return j({ ok:false, error:"forbidden" }, 403);
      // Normalize payload across providers — accept any of: Postmark, Resend Inbound, SendGrid.
      const p = b.payload || b;
      const fromEmail = p.From || p.from || (p.envelope && p.envelope.from) || "";
      const fromName  = p.FromName || (p.from_name) || "";
      const toEmail   = p.OriginalRecipient || p.To || p.to || (p.envelope && p.envelope.to && p.envelope.to[0]) || "";
      const subject   = p.Subject || p.subject || "";
      const textBody  = p.TextBody || p.text || "";
      const htmlBody  = p.HtmlBody || p.html || "";
      const messageId = p.MessageID || p.MessageId || p["message-id"] || "";
      const attachments = p.Attachments || p.attachments || [];
      const { data: route } = await sb.rpc("portal_ap_resolve_routing", { p_to: toEmail });
      if (!route || !route.ok) {
        // Still record it (with no tenant) so admin can see rejected mails — actually just log & drop for now.
        return j({ ok:false, error: (route&&route.error)||"routing failed" });
      }
      // Layer 1a dedup — by Gmail message-id (skip re-delivery of the exact same email).
      if (messageId) {
        const { data: existing } = await sb.from("portal_ap_inbox").select("id").eq("message_id", messageId).maybeSingle();
        if (existing) return j({ ok:true, deduped:true, reason:"message_id", id: existing.id });
      }
      // Store attachments + compute a SHA-256 per file (Layer 1b — same bytes = same document).
      const storedAtts = [];
      let attachmentDupOf = null; // inbox_id of a prior non-rejected case that had an identical file
      for (const a of attachments) {
        try {
          const name = String(a.Name || a.filename || "file").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,180);
          const mime = a.ContentType || a.contentType || a.type || "application/octet-stream";
          const b64 = String(a.Content || a.content || "").replace(/^data:[^,]+,/,"");
          if (!b64) continue;
          const bytes = Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
          const sha = await sha256HexBytes(bytes);
          if (!attachmentDupOf){
            try { const { data: dupRows } = await sb.rpc("portal_ap_attachment_dup", { p_tenant: route.tenant_id, p_sha: sha }); if (Array.isArray(dupRows) && dupRows.length > 0) attachmentDupOf = dupRows[0].inbox_id; } catch(_e){}
          }
          const path = route.tenant_id + "/" + Date.now() + "_" + Math.random().toString(36).slice(2,8) + "_" + name;
          const up = await sb.storage.from("portal-ap-uploads").upload(path, bytes, { contentType: mime });
          if (!up.error) storedAtts.push({ name, mime, size: bytes.length, storage_path: path, sha256: sha });
        } catch(_e){}
      }
      const { data: inserted } = await sb.from("portal_ap_inbox").insert({ tenant_id: route.tenant_id, message_id: messageId, from_email: fromEmail, from_name: fromName, to_email: toEmail, subject, text_body: textBody, html_body: htmlBody, attachments: storedAtts, raw_payload: p, status: "received" }).select("id").single();
      const inboxId = inserted && inserted.id;
      // Record each attachment hash against this case so future identical files are caught.
      if (inboxId){
        for (const a of storedAtts){ if (a.sha256){ try { await sb.rpc("portal_ap_record_attachment_hash", { p_tenant: route.tenant_id, p_sha: a.sha256, p_inbox: inboxId, p_filename: a.name }); } catch(_e){} } }
      }
      // Layer 1b short-circuit: an identical file was already processed → mark duplicate and
      // skip Claude entirely (saves the vision cost on obvious resends).
      if (inboxId && attachmentDupOf){
        await sb.from("portal_ap_inbox").update({ status:"duplicate", status_detail:"Identical attachment already processed in case #" + attachmentDupOf }).eq("id", inboxId);
        try { await logDecision(inboxId, "duplicate_rejected", "Layer-1b: identical file bytes as case #" + attachmentDupOf, null, { dedup_layer:"attachment_sha256", duplicate_of_inbox: attachmentDupOf }); } catch(_e){}
        return j({ ok:true, id: inboxId, deduped:true, reason:"attachment_sha256", duplicate_of: attachmentDupOf });
      }
      // Hydrate full settings for the AP automation pipeline (duplicate-check window, 4-item gate, auto-post toggle, reply identity).
      const { data: fullSettings } = await sb.from("portal_ap_settings").select("*").eq("tenant_id", route.tenant_id).maybeSingle();
      const fullRoute = {
        ...route,
        duplicate_check_days: fullSettings?.duplicate_check_days ?? 90,
        require_4item_reimbursement: fullSettings?.require_4item_reimbursement ?? true,
        require_known_vendor_for_autopost: fullSettings?.require_known_vendor_for_autopost ?? true,
        ai_provider: fullSettings?.ai_provider || 'anthropic',
        auto_post_when_compliant: fullSettings?.auto_post_when_compliant ?? true,
        auto_reply_when_rejected: fullSettings?.auto_reply_when_rejected ?? true,
        reply_from_email: fullSettings?.reply_from_email || null,
        reply_from_name: fullSettings?.reply_from_name || null,
      };
      // Trigger AI processing in background.
      if (inboxId) {
        const work = (async ()=>{ try { await processApEmail(inboxId, fullRoute); } catch(_e){} })();
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else work.catch(()=>{});
      }
      return j({ ok:true, id: inboxId });
    }
    if (api === "ap_process") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.id) return j({ ok:false, error:"id required" });
      const { data: getRes } = await sb.rpc("portal_ap_inbox_get", { p_token: b.token||"", p_id: Number(b.id) });
      if (!getRes || !getRes.ok || !getRes.item) return j({ ok:false, error:"not found" });
      const { data: settings } = await sb.from("portal_ap_settings").select("*").eq("tenant_id", getRes.item.tenant_id).single();
      const route = {
        tenant_id: getRes.item.tenant_id,
        default_gl_account: settings?.default_gl_account || "904-2200",
        max_auto_post_amount: settings?.max_auto_post_amount || 1000,
        ai_model: settings?.ai_model || "claude-haiku-4-5-20251001",
        duplicate_check_days: settings?.duplicate_check_days ?? 90,
        require_4item_reimbursement: settings?.require_4item_reimbursement ?? true,
        require_known_vendor_for_autopost: settings?.require_known_vendor_for_autopost ?? true,
        ai_provider: settings?.ai_provider || 'anthropic',
        auto_post_when_compliant: settings?.auto_post_when_compliant ?? true,
        auto_reply_when_rejected: settings?.auto_reply_when_rejected ?? true,
        reply_from_email: settings?.reply_from_email || null,
        reply_from_name: settings?.reply_from_name || null,
      };
      try { await processApEmail(Number(b.id), route); return j({ ok:true }); }
      catch(e){ return j({ ok:false, error: String(e).slice(0,400) }); }
    }
    if (api === "ap_post_preview") {
      // v67: dry-run preview of the exact Xero payload that ap_post would send.
      // Spec §F/§69: operator sees the exact JSON + sanity checks before authorising the live POST.
      // No Xero call happens here — read-only.
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.id) return j({ ok:false, error:"id required" });
      const { data: getRes } = await sb.rpc("portal_ap_inbox_get", { p_token: b.token||"", p_id: Number(b.id) });
      if (!getRes || !getRes.ok || !getRes.item) return j({ ok:false, error:"not found" });
      const item = getRes.item;
      const overrides = b.bill || {};
      const verdict = item.ai_verdict || {};
      const vendor = overrides.vendor_name || verdict.vendor_name || item.from_name || item.from_email;
      const lines = overrides.line_items || verdict.line_items || [];
      const warnings: string[] = [];
      const checks: { name: string; pass: boolean; detail?: string }[] = [];
      if (!vendor) warnings.push("Missing vendor name");
      if (!lines.length) warnings.push("No line items");
      const now = new Date(Date.now() + 8*3600*1000);
      const today = now.toISOString().slice(0,10);
      const due = overrides.due_date || verdict.due_date || new Date(Date.now() + 30*86400000 + 8*3600*1000).toISOString().slice(0,10);
      const invDate = overrides.invoice_date || verdict.invoice_date || today;
      const cid = await resolveContact(item.tenant_id, vendor);
      const inv: any = { Type:"ACCPAY", Contact: cid?{ContactID:cid}:{Name:String(vendor||"").slice(0,500)}, Date: invDate, DueDate: due, Status:"DRAFT", LineAmountTypes: "Exclusive", LineItems: lines.map((l:any)=>({ Description:String(l.description||"Item").slice(0,4000), Quantity:Number(l.quantity)||1, UnitAmount:Number(l.unit_amount)||0, AccountCode: l.account_code || verdict.suggested_gl_account || "610-1000" })) };
      if (verdict.invoice_no || overrides.invoice_no) inv.InvoiceNumber = String(overrides.invoice_no || verdict.invoice_no).slice(0,255);
      if (verdict.currency || overrides.currency) inv.CurrencyCode = String(overrides.currency || verdict.currency);
      // Sanity checks
      checks.push({ name:"Vendor contact resolved in Xero", pass: !!cid, detail: cid ? "Existing contact ID matched" : "Will create new contact by Name" });
      checks.push({ name:"Vendor name present", pass: !!vendor });
      checks.push({ name:"At least one line item", pass: lines.length > 0, detail: `${lines.length} line(s)` });
      const missingCodes = lines.filter((l:any)=>!l.account_code && !verdict.suggested_gl_account).length;
      checks.push({ name:"Every line has an account code", pass: missingCodes === 0, detail: missingCodes ? `${missingCodes} line(s) will fall back to 610-1000` : "OK" });
      const lineTotal = lines.reduce((s:number,l:any)=>s+(Number(l.quantity)||1)*(Number(l.unit_amount)||0), 0);
      const roundedLineTotal = Math.round(lineTotal*100)/100;
      const claimedTotal = Number(verdict.total||0);
      const tolerance = 0.02;
      if (claimedTotal > 0) {
        checks.push({ name:"Subtotal reconciliation (line-sum vs claimed total)", pass: Math.abs(roundedLineTotal - claimedTotal) <= tolerance, detail: `line-sum=${roundedLineTotal.toFixed(2)} vs claimed=${claimedTotal.toFixed(2)} MYR` });
      }
      checks.push({ name:"Invoice date is valid ISO date", pass: /^\d{4}-\d{2}-\d{2}$/.test(invDate) });
      checks.push({ name:"Due date ≥ invoice date", pass: due >= invDate, detail: `Date=${invDate}, DueDate=${due}` });
      checks.push({ name:"Invoice number present", pass: !!inv.InvoiceNumber, detail: inv.InvoiceNumber || "(Xero auto-generates on post)" });

      // v68 (Wave 1b, spec §D): live Xero cross-check for existing bills from this vendor.
      // Catches human-entered bills that AP dedup fingerprint misses. Bounded to last 90 days.
      // Set { check_xero:false } in the request body to skip this if you're rapid-previewing.
      const xero_dupes: any[] = [];
      if (b.check_xero !== false) {
        try {
          const accessCheck = await xeroAccessToken();
          const ninetyDaysAgo = new Date(Date.now() - 90*86400000);
          const dateStr = "DateTime(" + ninetyDaysAgo.getUTCFullYear() + "," + (ninetyDaysAgo.getUTCMonth()+1) + "," + ninetyDaysAgo.getUTCDate() + ")";
          let whereClause = 'Type=="ACCPAY" AND Status!="VOIDED" AND Date>=' + dateStr;
          if (cid) whereClause += ' AND Contact.ContactID==GUID("' + cid + '")';
          const d = await xeroGet(accessCheck, item.tenant_id, "Invoices?where=" + encodeURIComponent(whereClause));
          const existing = (d.Invoices || []) as any[];
          // If we don't have a contact_id, filter locally on vendor-name match to keep results relevant.
          const filtered = cid ? existing : existing.filter((iv:any)=>{
            const cname = String((iv.Contact||{}).Name||"").toLowerCase();
            return cname && cname.indexOf(String(vendor||"").toLowerCase()) >= 0;
          });
          const targetInvNo = String(inv.InvoiceNumber||"").trim().toLowerCase();
          const targetTotal = Number(inv.LineItems.reduce((s:number,l:any)=>s+(Number(l.Quantity)||1)*(Number(l.UnitAmount)||0),0));
          const targetDateMs = Date.parse(inv.Date+"T00:00:00Z") || Date.now();
          for (const iv of filtered) {
            const ivNo = String(iv.InvoiceNumber||"").trim().toLowerCase();
            const ivTotal = Number(iv.Total||0);
            const ivDateMs = Date.parse(String(iv.DateString||iv.Date||"").slice(0,10)+"T00:00:00Z");
            const numMatch = targetInvNo && ivNo && ivNo === targetInvNo;
            const totalDelta = ivDateMs ? Math.abs(ivDateMs - targetDateMs)/86400000 : 999;
            const amountMatch = targetTotal > 0 && ivTotal > 0 && Math.abs(targetTotal - ivTotal) <= 0.02 && totalDelta <= 7;
            if (numMatch || amountMatch) {
              xero_dupes.push({
                match_type: numMatch ? "invoice_number" : "amount+date",
                invoice_id: iv.InvoiceID,
                invoice_number: iv.InvoiceNumber,
                contact_name: (iv.Contact||{}).Name || "",
                total: ivTotal,
                date: String(iv.DateString||iv.Date||"").slice(0,10),
                status: iv.Status
              });
            }
          }
          checks.push({ name:"No existing Xero bill with the same invoice number for this vendor", pass: !xero_dupes.some(d=>d.match_type==="invoice_number"), detail: xero_dupes.length ? xero_dupes.length + " potential dup(s) found in Xero" : "OK" });
          checks.push({ name:"No existing Xero bill with same amount + date within 7 days", pass: !xero_dupes.some(d=>d.match_type==="amount+date"), detail: "" });
        } catch (e: any) {
          checks.push({ name:"Xero cross-check", pass: false, detail: "Xero API error: " + String(e.message||e).slice(0,120) + " — proceed with caution" });
        }
      }

      const idem = await sha256Hex(JSON.stringify(inv) + "|inbox:" + b.id);
      return j({ ok:true, dry_run:true, payload: inv, idempotency_key: idem, warnings, checks, xero_dupes, tenant_id: item.tenant_id });
    }
    if (api === "ap_post") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.id) return j({ ok:false, error:"id required" });
      const { data: getRes } = await sb.rpc("portal_ap_inbox_get", { p_token: b.token||"", p_id: Number(b.id) });
      if (!getRes || !getRes.ok || !getRes.item) return j({ ok:false, error:"not found" });
      const item = getRes.item;
      const overrides = b.bill || {};
      const verdict = item.ai_verdict || {};
      // Build the bill: prefer admin overrides, then AI verdict, then sensible defaults.
      const vendor = overrides.vendor_name || verdict.vendor_name || item.from_name || item.from_email;
      const lines = overrides.line_items || verdict.line_items || [];
      if (!vendor || !lines.length) return j({ ok:false, error:"vendor + at least one line item required" });
      const now = new Date(Date.now() + 8*3600*1000);
      const today = now.toISOString().slice(0,10);
      const due = overrides.due_date || verdict.due_date || new Date(Date.now() + 30*86400000 + 8*3600*1000).toISOString().slice(0,10);
      let cid = await resolveContact(item.tenant_id, vendor);
      const inv = { Type:"ACCPAY", Contact: cid?{ContactID:cid}:{Name:String(vendor).slice(0,500)}, Date: overrides.invoice_date || verdict.invoice_date || today, DueDate: due, Status:"DRAFT", LineAmountTypes: "Exclusive", LineItems: lines.map((l)=>({ Description:String(l.description||"Item").slice(0,4000), Quantity:Number(l.quantity)||1, UnitAmount:Number(l.unit_amount)||0, AccountCode: l.account_code || verdict.suggested_gl_account || "610-1000" })) };
      if (verdict.invoice_no || overrides.invoice_no) inv.InvoiceNumber = String(overrides.invoice_no || verdict.invoice_no).slice(0,255);
      if (verdict.currency || overrides.currency) inv.CurrencyCode = String(overrides.currency || verdict.currency);
      const access = await xeroAccessToken();
      const idem = await sha256Hex(JSON.stringify(inv) + "|inbox:" + b.id);
      const r = await fetch("https://api.xero.com/api.xro/2.0/Invoices", { method:"POST", headers:{ "Authorization":"Bearer "+access, "Xero-Tenant-Id": item.tenant_id, "Content-Type":"application/json", "Accept":"application/json", "Idempotency-Key": idem }, body: JSON.stringify({ Invoices:[inv] }) });
      const out = await r.json(); const iv = (out.Invoices||[])[0] || {};
      if (!r.ok && !iv.InvoiceID) return j({ ok:false, error: out.Detail || out.Message || JSON.stringify(out).slice(0,400) });
      if (iv.HasErrors) return j({ ok:false, error:(iv.ValidationErrors||[]).map((e)=>e.Message).join("; ") });
      await sb.rpc("portal_ap_inbox_update", { p_token: b.token||"", p_id: Number(b.id), p_patch: { status:"posted", xero_invoice_id: iv.InvoiceID, xero_invoice_number: iv.InvoiceNumber, posted_at: new Date().toISOString() } });
      await logAudit(me, "ap_post", iv.InvoiceNumber||iv.InvoiceID||"", { inbox_id:b.id, vendor, total: iv.Total });
      // v69 (Wave 1c): learn vendor → account_code from every successful manual post.
      // If a human edited the verdict before posting, that's a human_override signal.
      const overrodeCoding = Array.isArray(overrides.line_items) && overrides.line_items.some((ol:any, i:number)=>{
        const orig = (verdict.line_items||[])[i];
        return orig && ol && ol.account_code && orig.account_code && ol.account_code !== orig.account_code;
      });
      await recordVendorCodingHistory(item.tenant_id, vendor, lines, overrodeCoding ? "human_override" : "manual_post", {
        operator_id: me && me.user && me.user.id ? String(me.user.id) : undefined,
        invoice_id: iv.InvoiceID,
        invoice_number: iv.InvoiceNumber,
        invoice_amount: Number(iv.Total || 0),
        invoice_date: inv.Date,
        ai_verdict: verdict || null,
      });
      // Attach the source files to the Xero invoice (best-effort).
      if (item.attachments && Array.isArray(item.attachments)) {
        for (const a of item.attachments){ try { const { data: fileData } = await sb.storage.from("portal-ap-uploads").download(a.storage_path); if (fileData){ const buf = await fileData.arrayBuffer(); await fetch("https://api.xero.com/api.xro/2.0/Invoices/" + iv.InvoiceID + "/Attachments/" + encodeURIComponent(a.name), { method:"POST", headers:{ "Authorization":"Bearer "+access, "Xero-Tenant-Id": item.tenant_id, "Content-Type": a.mime||"application/octet-stream" }, body: buf }); } } catch(_e){} }
      }
      return j({ ok:true, invoice_id: iv.InvoiceID, number: iv.InvoiceNumber });
    }
    if (api === "ap_decision_log") {
      // Show what the rule engine decided about an inbox item (audit trail).
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.id) return j({ ok:false, error:"id required" });
      const { data } = await sb.from("portal_ap_decisions").select("*").eq("inbox_id", Number(b.id)).order("created_at", { ascending:false }).limit(20);
      return j({ ok:true, decisions: data || [] });
    }
    if (api === "ap_rules_list") {
      // GL coding pattern rules — admin can review + add patterns to teach the engine.
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.from("portal_gl_rules").select("*").eq("enabled", true).order("priority", { ascending:false }).order("id");
      const filtered = b.tenant ? (data||[]).filter((r)=>r.tenant_id === b.tenant) : (data||[]);
      return j({ ok:true, rules: filtered });
    }
    if (api === "ap_rule_save") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.tenant || !Array.isArray(b.keywords) || !b.keywords.length || !b.account_code) return j({ ok:false, error:"tenant, keywords[], account_code required" });
      const row = { tenant_id: String(b.tenant), pattern_keywords: b.keywords.map((k)=>String(k).toLowerCase().trim()).filter(Boolean), account_code: String(b.account_code), priority: Number(b.priority)||100, notes: b.notes||null, updated_at: new Date().toISOString() };
      if (b.id){
        const { error } = await sb.from("portal_gl_rules").update(row).eq("id", Number(b.id));
        if (error) return j({ ok:false, error: error.message });
        await logAudit(me, "ap_rule_update", String(b.id), { account_code: b.account_code });
        return j({ ok:true, id: b.id });
      } else {
        const { data, error } = await sb.from("portal_gl_rules").insert(row).select("id").single();
        if (error) return j({ ok:false, error: error.message });
        await logAudit(me, "ap_rule_create", String(data.id), { account_code: b.account_code, keywords: b.keywords });
        return j({ ok:true, id: data.id });
      }
    }
    if (api === "ap_rule_delete") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.id) return j({ ok:false, error:"id required" });
      const { error } = await sb.from("portal_gl_rules").update({ enabled: false }).eq("id", Number(b.id));
      if (error) return j({ ok:false, error: error.message });
      await logAudit(me, "ap_rule_delete", String(b.id), {});
      return j({ ok:true });
    }
    if (api === "ap_reject") {
      // Mark an inbox item as rejected — no Xero post, no reply. Audit logged.
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.id) return j({ ok:false, error:"id required" });
      const reason = String(b.reason||"manually rejected").slice(0,300);
      await sb.rpc("portal_ap_inbox_update", { p_token: b.token||"", p_id: Number(b.id), p_patch: { status:"rejected", status_detail: reason } });
      await logAudit(me, "ap_reject", String(b.id), { reason });
      return j({ ok:true });
    }
    if (api === "ap_reply_send") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.id) return j({ ok:false, error:"id required" });
      const { data: getRes } = await sb.rpc("portal_ap_inbox_get", { p_token: b.token||"", p_id: Number(b.id) });
      if (!getRes || !getRes.ok || !getRes.item) return j({ ok:false, error:"not found" });
      const item = getRes.item;
      const { data: settings } = await sb.from("portal_ap_settings").select("reply_from_email,reply_from_name").eq("tenant_id", item.tenant_id).single();
      const gmailUser = Deno.env.get("GMAIL_USER");
      const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");
      const resendKey = Deno.env.get("RESEND_API_KEY");
      const fromEmail = (settings && settings.reply_from_email) || gmailUser || "ap@ctgfinance.com";
      const fromName  = (settings && settings.reply_from_name)  || "CTG Finance AP";
      const subject = b.subject || item.reply_subject || ("Re: " + (item.subject || ""));
      const body    = b.body    || item.reply_body    || "";
      const toEmail = item.from_email;
      const inReplyTo = item.message_id || "";
      // Prefer Gmail SMTP (works without owning a domain). Fall back to Resend if Gmail not configured.
      if (gmailUser && gmailPass){
        let smtpClient: any = null;
        try {
          const { SMTPClient } = await import("https://deno.land/x/denomailer@1.6.0/mod.ts");
          smtpClient = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: gmailUser, password: gmailPass } } });
          const headers: any = {};
          if (inReplyTo) { headers["In-Reply-To"] = inReplyTo; headers["References"] = inReplyTo; }
          await smtpClient.send({ from: fromName + " <" + gmailUser + ">", to: toEmail, subject, content: body, headers });
        } catch (e) {
          // Always try to close even on error (resource leak fix).
          if (smtpClient){ try { await smtpClient.close(); } catch(_e){} }
          return j({ ok:false, error: "Gmail SMTP: " + String(e).slice(0,300) });
        }
        try { await smtpClient.close(); } catch(_e){}
      } else if (resendKey){
        const r = await fetch("https://api.resend.com/emails", { method:"POST", headers:{ "Authorization":"Bearer "+resendKey, "Content-Type":"application/json" }, body: JSON.stringify({ from: fromName + " <" + fromEmail + ">", to: [toEmail], subject, text: body, headers: inReplyTo ? { "In-Reply-To": inReplyTo, "References": inReplyTo } : undefined }) });
        if (!r.ok){ const t = await r.text(); return j({ ok:false, error: "Resend: " + r.status + " " + t.slice(0,300) }); }
      } else {
        return j({ ok:false, error:"Configure Gmail SMTP (GMAIL_USER + GMAIL_APP_PASSWORD) OR Resend (RESEND_API_KEY) as Supabase Edge secrets to enable replies" });
      }
      await sb.rpc("portal_ap_inbox_update", { p_token: b.token||"", p_id: Number(b.id), p_patch: { status:"reply_sent", reply_subject: subject, reply_body: body, reply_sent_at: new Date().toISOString() } });
      await logAudit(me, "ap_reply_sent", String(b.id), { to: toEmail, via: gmailUser && gmailPass ? "gmail-smtp" : "resend" });
      return j({ ok:true });
    }
    if (api === "compliance_calendar") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.rpc("portal_compliance_calendar", { p_token: b.token||"", p_days: Number(b.days)||365 });
      return j(data || { ok:true, deadlines:[] });
    }
    if (api === "cashflow_forecast") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.rpc("portal_cashflow_forecast", { p_token: b.token||"", p_days: Number(b.days)||90, p_tenant: b.tenant||null });
      return j(data || { ok:true });
    }
    if (api === "group_dashboard") {
      // CFO Cockpit — group analytics from the invoice cache (reliable), not the Xero P&L.
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.rpc("portal_group_dashboard", { p_token: b.token||"", p_months: Number(b.months)||12 });
      return j(data || { ok:true });
    }
    if (api === "fin_analytics") {
      // Financial-analyst toolkit — DSO/DPO + cash-conversion, customer AR credit risk, intercompany matrix.
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.rpc("portal_fin_analytics", { p_token: b.token||"", p_months: Number(b.months)||12 });
      return j(data || { ok:true });
    }
    if (api === "pnl_report") {
      // Live Profit & Loss from Xero per tenant → revenue/expense account breakdown for the dashboard charts.
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const allowed = await allowedTenants(b.token);
      if (!allowed.length) return j({ ok:true, companies:[] });
      let tenantIds = allowed;
      if (b.tenant) { if (allowed.indexOf(b.tenant) < 0) return await denyTenant(me, "pnl_report", b.tenant); tenantIds = [b.tenant]; }
      // MYT today; default period = first day of current month-11 (≈ this FY-to-date) or explicit range.
      const myNow = new Date(Date.now() + 8*3600*1000);
      const to = b.to || myNow.toISOString().slice(0,10);
      const from = b.from || new Date(myNow.getFullYear(), myNow.getMonth()-11, 1).toISOString().slice(0,10);
      const { data: tn } = await sb.from("xero_tenants").select("tenant_id,tenant_name").in("tenant_id", tenantIds);
      const access = await xeroAccessToken();
      const companies = [];
      for (const t of (tn||[])){
        try {
          const d = await xeroGet(access, t.tenant_id, "Reports/ProfitAndLoss?fromDate=" + from + "&toDate=" + to);
          const rep = (d.Reports||[])[0];
          companies.push({ tenant_id: t.tenant_id, tenant_name: t.tenant_name, ...parsePnl(rep) });
        } catch (e) {
          companies.push({ tenant_id: t.tenant_id, tenant_name: t.tenant_name, error: String(e).slice(0,200), revenue_total:0, expense_total:0, net_profit:0, income:[], expenses:[] });
        }
      }
      return j({ ok:true, from, to, companies });
    }
    if (api === "ocr_extract") {
      const me = await meFromToken(b.token); if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) return j({ ok:false, error:"ANTHROPIC_API_KEY not configured — set it as a Supabase Edge secret to enable receipt OCR" });
      const b64 = String(b.content_base64||"").split(",").pop() || "";
      if (!b64) return j({ ok:false, error:"no image provided" });
      const mime = String(b.content_type||"image/jpeg");
      const sys = "You are an expert bookkeeper for a Malaysian accounting practice. Extract structured data from a supplier invoice / receipt / bill image. Reply ONLY with a single JSON object — no prose, no markdown fences. Schema: { vendor_name: string, invoice_no: string|null, invoice_date: 'YYYY-MM-DD'|null, due_date: 'YYYY-MM-DD'|null, currency: 'MYR'|'USD'|'SGD', subtotal: number, tax_amount: number, total: number, line_items: [{ description: string, quantity: number, unit_amount: number, account_code_guess: string }], suggested_gl_account: string, confidence: 'high'|'medium'|'low', notes: string }. If a value can't be read, use null (string fields) or 0 (numeric). MYR (Malaysian Ringgit) is the most common currency. Common GL accounts in this org: 200-1000 Sales — Retail, 400-1000 Consulting Revenue, 500-0100 Retail Sales (O2O), 600-1000 Inventory, 610-1000 Office Supplies, 620-1000 Rent, 630-1000 Utilities, 640-1000 Professional Fees, 650-1000 Marketing, 660-1000 Software/Subscriptions, 670-1000 Bank Charges, 800-1000 Travel & Entertainment.";
      const body = { model: "claude-haiku-4-5-20251001", max_tokens: 1500, system: sys, messages: [ { role: "user", content: [ { type: "image", source: { type: "base64", media_type: mime, data: b64 } }, { type: "text", text: "Extract the structured fields per the schema. Reply with JSON only." } ] } ] };
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", { method:"POST", headers:{ "x-api-key": apiKey, "anthropic-version":"2023-06-01", "Content-Type":"application/json" }, body: JSON.stringify(body) });
        if (!r.ok) { const t = await r.text(); return j({ ok:false, error: "Claude API: " + r.status + " " + t.slice(0,400) }); }
        const out = await r.json();
        const txt = (out.content && out.content[0] && out.content[0].text) || "";
        // Extract JSON from response — strip any fence/prose if model didn't comply.
        let parsed = null; const m = txt.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch(_e){} }
        if (!parsed) return j({ ok:false, error:"Could not parse JSON from Claude response", raw: txt.slice(0,500) });
        await logAudit(me, "ocr_extract", String((parsed && parsed.vendor_name) || "(unknown)"), { total: parsed && parsed.total, confidence: parsed && parsed.confidence });
        return j({ ok:true, extracted: parsed });
      } catch (e) { return j({ ok:false, error: String(e).slice(0,400) }); }
    }
    if (api === "create_bill_from_ocr") {
      const me = await meFromToken(b.token); if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.tenant) return j({ ok:false, error:"tenant required" });
      const allowed = await allowedTenants(b.token);
      if (allowed.indexOf(b.tenant) < 0) return await denyTenant(me, "create_bill_from_ocr", b.tenant);
      const x = b.bill || {};
      const lines = Array.isArray(x.line_items) ? x.line_items : [];
      if (!lines.length || !x.vendor_name) return j({ ok:false, error:"vendor_name and at least one line_item required" });
      // Edge functions run in UTC; convert to MYT (UTC+8) for accurate "today"
      const now = new Date(Date.now() + 8*3600*1000);
      const today = now.toISOString().slice(0,10);
      const due = x.due_date || new Date(Date.now() + 30*86400000 + 8*3600*1000).toISOString().slice(0,10);
      // Resolve or auto-create contact
      let contact;
      const cid = await resolveContact(b.tenant, x.vendor_name);
      contact = cid ? { ContactID: cid } : { Name: String(x.vendor_name).slice(0,500) };
      const inv = { Type:"ACCPAY", Contact: contact, Date: x.invoice_date || today, DueDate: due, Status: "DRAFT", LineAmountTypes: x.line_amount_types || "Exclusive", LineItems: lines.map((l)=>({ Description: String(l.description||"Item").slice(0,4000), Quantity: Number(l.quantity)||1, UnitAmount: Number(l.unit_amount)||0, AccountCode: l.account_code_guess || l.account_code || "610-1000" })) };
      if (x.invoice_no) inv.InvoiceNumber = String(x.invoice_no).slice(0,255);
      if (x.currency) inv.CurrencyCode = String(x.currency);
      const access = await xeroAccessToken();
      const idem = await sha256Hex(JSON.stringify(inv));
      const r = await fetch("https://api.xero.com/api.xro/2.0/Invoices", { method:"POST", headers:{ "Authorization":"Bearer "+access, "Xero-Tenant-Id": b.tenant, "Content-Type":"application/json", "Accept":"application/json", "Idempotency-Key": idem }, body: JSON.stringify({ Invoices:[inv] }) });
      const out = await r.json(); const iv = (out.Invoices||[])[0] || {};
      if (!r.ok && !iv.InvoiceID) return j({ ok:false, error: out.Detail || out.Message || JSON.stringify(out).slice(0,400) });
      if (iv.HasErrors) return j({ ok:false, error: (iv.ValidationErrors||[]).map((e)=>e.Message).join("; ") });
      await logAudit(me, "ocr_create_bill", iv.InvoiceNumber||iv.InvoiceID||"", { vendor: x.vendor_name, total: iv.Total, tenant: b.tenant });
      return j({ ok:true, invoice_id: iv.InvoiceID, number: iv.InvoiceNumber, total: iv.Total, status: iv.Status, contact: cid ? "existing" : "new" });
    }
    if (api === "sync_audit") {
      // Live AR audit: pull current open AR total from Xero (server-side) per tenant, compare to cache.
      // Surfaces any RM-level mismatch immediately. Admin only.
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const access = await xeroAccessToken();
      const { data: tenants } = await sb.from("xero_tenants").select("tenant_id,tenant_name");
      const list = (b.tenant ? (tenants||[]).filter((t)=>t.tenant_id===b.tenant) : (tenants||[]));
      const results = [];
      for (const t of list){
        try {
          // Cache side — open ACCREC (AUTHORISED + SUBMITTED).
          const { data: rows } = await sb.from("xero_invoice_cache").select("amount_due").eq("tenant_id", t.tenant_id).eq("type","ACCREC").in("status",["AUTHORISED","SUBMITTED"]);
          const cacheSum = (rows||[]).reduce((s,r)=>s+Number(r.amount_due||0),0);
          const cacheCount = (rows||[]).length;
          // Xero side — page through AUTHORISED+SUBMITTED ACCREC, sum AmountDue live.
          let xeroSum = 0, xeroCount = 0;
          for (let page=1; page<=100; page++){
            const d = await xeroGet(access, t.tenant_id, "Invoices?Statuses=AUTHORISED,SUBMITTED&page=" + page + "&where=" + encodeURIComponent('Type=="ACCREC"'));
            const arr = d.Invoices || []; if (!arr.length) break;
            for (const iv of arr){ xeroSum += Number(iv.AmountDue||0); xeroCount++; }
            if (arr.length < 100) break;
          }
          const delta = Math.round((cacheSum - xeroSum) * 100) / 100;
          const ok = Math.abs(delta) < 1.0 && cacheCount === xeroCount;
          results.push({
            tenant: t.tenant_name, tenant_id: t.tenant_id,
            cache_count: cacheCount, cache_sum: Math.round(cacheSum*100)/100,
            xero_count: xeroCount,  xero_sum:  Math.round(xeroSum*100)/100,
            delta_amount: delta, count_diff: cacheCount - xeroCount,
            ok
          });
        } catch (e) {
          results.push({ tenant: t.tenant_name, tenant_id: t.tenant_id, error: String(e).slice(0, 300) });
        }
      }
      await logAudit(me, "sync_audit", String(list.length), { results });
      return j({ ok:true, results, audited_at: new Date().toISOString() });
    }
    if (api === "xero_diagnose") {
      // Deep gap check: pull EVERY invoice id+status modified in last N days from Xero (no Statuses filter),
      // compare against cache, return what's missing + what's stale. Catches silent batch-upsert failures
      // that sync_audit can miss (it only checks open AR totals).
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.tenant) return j({ ok:false, error:"tenant required" });
      const days = Math.min(Math.max(parseInt(b.days||"30",10)||30, 1), 730);
      const sinceISO = new Date(Date.now() - days*24*3600*1000).toISOString();
      const sinceHeader = new Date(sinceISO).toUTCString();
      try {
        const access = await xeroAccessToken();
        const xeroByStatus = {}; const xeroIds = new Set(); let xeroTotal = 0;
        for (let page=1; page<=100; page++){
          const d = await xeroGet(access, b.tenant, "Invoices?page=" + page + "&order=UpdatedDateUTC%20ASC", { "If-Modified-Since": sinceHeader });
          if (d.__notModified) break;
          const arr = d.Invoices || []; if (!arr.length) break;
          for (const iv of arr){
            xeroTotal++; xeroIds.add(iv.InvoiceID);
            const k = (iv.Type||"?") + "/" + (iv.Status||"?");
            xeroByStatus[k] = (xeroByStatus[k]||0) + 1;
          }
          if (arr.length < 100) break;
        }
        // Cache side — every invoice for this tenant updated since the same window
        const { data: cacheRows } = await sb.from("xero_invoice_cache").select("invoice_id,type,status").eq("tenant_id", b.tenant).gte("updated_at", sinceISO);
        const cacheIds = new Set((cacheRows||[]).map((r)=>r.invoice_id));
        const cacheByStatus = {};
        for (const r of (cacheRows||[])){ const k = (r.type||"?") + "/" + (r.status||"?"); cacheByStatus[k] = (cacheByStatus[k]||0) + 1; }
        // Missing = in Xero but not in cache (THE BUG WE'RE HUNTING)
        const missing = [];
        for (const id of xeroIds){ if (!cacheIds.has(id)) missing.push(id); }
        // Extras = in cache but not returned by Xero (VOIDED/DELETED that we didn't get notified about)
        const extras = [];
        for (const id of cacheIds){ if (!xeroIds.has(id)) extras.push(id); }
        await logAudit(me, "xero_diagnose", b.tenant, { days, xero_total: xeroTotal, cache_total: cacheIds.size, missing: missing.length, extras: extras.length });
        return j({
          ok: true,
          tenant_id: b.tenant,
          days,
          xero_total: xeroTotal,
          cache_total: cacheIds.size,
          missing_count: missing.length,
          extras_count: extras.length,
          xero_by_status: xeroByStatus,
          cache_by_status: cacheByStatus,
          missing_ids_sample: missing.slice(0, 25),
          extra_ids_sample: extras.slice(0, 25),
          note: missing.length > 0 ? "GAPS FOUND — run invoice_resync per id, or tenant_rebuild for full repair." : "Cache is consistent with Xero for this window.",
        });
      } catch (e) {
        return j({ ok:false, error: String(e).slice(0,500) });
      }
    }
    if (api === "tenant_rebuild") {
      // Nuclear option: wipe cache + trigger an unrestricted backfill from 2015. Admin only, confirm-gated.
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.tenant) return j({ ok:false, error:"tenant required" });
      if (b.confirm !== "REBUILD") return j({ ok:false, error:"set confirm='REBUILD' to proceed (this wipes the cache for that tenant)" });
      const { data: wipe, error: wErr } = await sb.rpc("portal_tenant_rebuild_wipe", { p_token: b.token||"", p_tenant: b.tenant });
      if (wErr || !wipe || !wipe.ok) return j(wipe || { ok:false, error: (wErr&&wErr.message)||"wipe failed" });
      const access = await xeroAccessToken();
      const { data: tenants } = await sb.from("xero_tenants").select("tenant_id,tenant_name").eq("tenant_id", b.tenant);
      const work = (async ()=>{ try { const bf = await runBackfill(access, tenants||[], { sinceISO: "2015-01-01T00:00:00Z" }); await logAudit(me, "tenant_rebuild_done", b.tenant, { rows_deleted: wipe.rows_deleted, bf }); } catch (e) { await logAudit(me, "tenant_rebuild_error", b.tenant, { error: String(e).slice(0,500) }); } })();
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else work.catch(()=>{});
      return j({ ok:true, started:true, rows_deleted: wipe.rows_deleted, note: "Rebuild running in background — check sync_health in 2-5 min." });
    }
    if (api === "invoice_resync") {
      // Force-refresh a single invoice by ID or InvoiceNumber. Admin only. Tenant-scoped.
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.tenant) return j({ ok:false, error:"tenant required" });
      const allowed = await allowedTenants(b.token);
      if (allowed.indexOf(b.tenant) < 0) return await denyTenant(me, "invoice_resync", b.tenant);
      const key = String(b.invoice_id || b.number || "").trim();
      if (!key) return j({ ok:false, error:"invoice_id or number required" });
      try {
        const access = await xeroAccessToken();
        // Xero accepts either GUID or InvoiceNumber in this path.
        const d = await xeroGet(access, b.tenant, "Invoices/" + encodeURIComponent(key));
        const iv = (d.Invoices || [])[0];
        if (!iv) return j({ ok:false, error:"not found in Xero" });
        let action = "upserted";
        if (iv.Status === "VOIDED" || iv.Status === "DELETED"){
          await sb.from("xero_invoice_cache").delete().eq("tenant_id", b.tenant).eq("invoice_id", iv.InvoiceID);
          action = "deleted";
        } else {
          await sb.from("xero_invoice_cache").upsert(invToCacheRow(b.tenant, iv), { onConflict: "tenant_id,invoice_id" });
        }
        await logAudit(me, "invoice_resync", iv.InvoiceNumber || iv.InvoiceID, { tenant: b.tenant, key, action, status: iv.Status, amount_due: Number(iv.AmountDue||0) });
        return j({ ok:true, action, invoice: { id: iv.InvoiceID, number: iv.InvoiceNumber, status: iv.Status, total: Number(iv.Total||0), amount_due: Number(iv.AmountDue||0), contact: (iv.Contact||{}).Name } });
      } catch (e) {
        return j({ ok:false, error: String(e).slice(0,500) });
      }
    }
    if (api === "drift_check") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const access = await xeroAccessToken();
      const { data: tenants } = await sb.from("xero_tenants").select("tenant_id,tenant_name");
      const list = (b.tenant ? (tenants||[]).filter((t)=>t.tenant_id===b.tenant) : (tenants||[]));
      const results = [];
      for (const t of list){ try { const r = await runDriftCheck(access, t.tenant_id); results.push({ tenant_name: t.tenant_name, ...r }); } catch (e) { results.push({ tenant_name: t.tenant_name, error: String(e).slice(0,200) }); } }
      await logAudit(me, "drift_check", String(list.length), { results });
      return j({ ok:true, results });
    }
    if (api === "sessions_list") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.from("portal_sessions").select("token,user_id,created_at,last_seen_at").order("last_seen_at", { ascending:false, nullsFirst:false });
      const { data: users } = await sb.from("portal_users").select("id,email,name,role");
      const u = {}; (users||[]).forEach((x)=>{ u[x.id]=x; });
      const sessions = (data||[]).map((s)=>({ token_short: (s.token||"").slice(0,10) + "â€¦", token_full: s.token, user_email: (u[s.user_id]||{}).email, user_name: (u[s.user_id]||{}).name, user_role: (u[s.user_id]||{}).role, created_at: s.created_at, last_seen_at: s.last_seen_at, is_self: s.token === b.token }));
      return j({ ok:true, sessions });
    }
    if (api === "session_revoke") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.session_token) return j({ ok:false, error:"session_token required" });
      const { error } = await sb.from("portal_sessions").delete().eq("token", b.session_token);
      if (error) return j({ ok:false, error: error.message });
      await logAudit(me, "session_revoke", String(b.session_token||"").slice(0,10)+"â€¦", {});
      return j({ ok:true });
    }
    if (api === "export_log") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      await logAudit(me, "data_export", String(b.what||"unknown"), { rows: Number(b.rows)||0, filename: String(b.filename||""), tab: String(b.tab||"") });
      return j({ ok:true });
    }
    if (api === "totp_setup") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const secret = genTotpSecret();
      await sb.rpc("portal_totp_set_secret", { p_token: b.token||"", p_secret: secret });
      const url = otpAuthUrl(me.user.email, secret, "CTG Finance Portal");
      return j({ ok:true, secret, otpauth_url: url });
    }
    if (api === "totp_verify_enroll") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data: secret } = await sb.rpc("portal_totp_secret_for_me", { p_token: b.token||"" });
      if (!secret) return j({ ok:false, error:"no pending secret â€” start enrollment again" });
      const ok = await totpVerify(secret, String(b.code||""), 1);
      if (!ok) return j({ ok:false, error:"Incorrect 6-digit code, try again" });
      const { data } = await sb.rpc("portal_totp_enable", { p_token: b.token||"" });
      await logAudit(me, "totp_enable", me.user.email, {});
      return j(data);
    }
    if (api === "pharmacy_list") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.rpc("portal_pharmacy_list", { p_token: b.token||"" });
      return j(data || { ok:true, pharmacies:[] });
    }
    if (api === "pharmacy_get") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.id) return j({ ok:false, error:"id required" });
      const { data } = await sb.rpc("portal_pharmacy_get", { p_token: b.token||"", p_id: Number(b.id) });
      return j(data || { ok:false });
    }
    if (api === "pharmacy_save") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data, error } = await sb.rpc("portal_pharmacy_save", { p_token: b.token||"", p_id: b.id || null, p_patch: b.patch || {} });
      if (error) return j({ ok:false, error: error.message });
      return j(data || { ok:true });
    }
    if (api === "pharmacy_xero_contacts") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      // Read SKINDAE contacts from the cache; this is what the picker shows.
      const allowed = await allowedTenants(b.token);
      if (allowed.indexOf(SKINDAE_TENANT) < 0) return j({ ok:false, error:"forbidden" }, 403);
      const { data } = await sb.from("xero_contacts_cache").select("contact_id,name,email").eq("tenant_id", SKINDAE_TENANT).order("name").limit(5000);
      return j({ ok:true, contacts: data || [] });
    }
    if (api === "pharmacy_link_xero") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.id) return j({ ok:false, error:"id required" });
      const { data, error } = await sb.rpc("portal_pharmacy_link_xero", { p_token: b.token||"", p_id: Number(b.id), p_contact_id: b.contact_id || "" });
      if (error) return j({ ok:false, error: error.message });
      return j(data || { ok:true });
    }
    if (api === "pharmacy_delete") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.id) return j({ ok:false, error:"id required" });
      const { data, error } = await sb.rpc("portal_pharmacy_delete", { p_token: b.token||"", p_id: Number(b.id) });
      if (error) return j({ ok:false, error: error.message });
      return j(data || { ok:true });
    }
    if (api === "company_folder_list") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.rpc("portal_company_folder_list", { p_token: b.token||"", p_tenant: b.tenant||null });
      return j(data || { ok:true, folders:[] });
    }
    if (api === "company_folder_create") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.tenant || !b.name) return j({ ok:false, error:"tenant and name required" });
      const { data, error } = await sb.rpc("portal_company_folder_create", { p_token: b.token||"", p_tenant: b.tenant, p_parent_id: b.parent_id || null, p_name: String(b.name) });
      if (error) return j({ ok:false, error: error.message });
      return j(data || { ok:true });
    }
    if (api === "company_folder_delete") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.folder_id) return j({ ok:false, error:"folder_id required" });
      // If cascading, also delete the storage files for any docs inside (recursively).
      if (b.cascade){
        // Gather all descendant folder ids + their docs to wipe storage.
        const { data: fams } = await sb.rpc("portal_company_folder_list", { p_token: b.token||"", p_tenant: null });
        const folders = (fams && fams.folders) || [];
        const descendants = new Set([Number(b.folder_id)]);
        let added = true;
        while (added){
          added = false;
          for (const f of folders){ if (descendants.has(Number(f.parent_id)) && !descendants.has(Number(f.id))){ descendants.add(Number(f.id)); added = true; } }
        }
        const { data: docs } = await sb.from("portal_company_documents").select("file_path").in("folder_id", Array.from(descendants));
        const paths = (docs||[]).map((d)=>d.file_path).filter(Boolean);
        if (paths.length){ try { await sb.storage.from("portal-company-docs").remove(paths); } catch(_e){} }
      }
      const { data, error } = await sb.rpc("portal_company_folder_delete", { p_token: b.token||"", p_folder_id: Number(b.folder_id), p_cascade: !!b.cascade });
      if (error) return j({ ok:false, error: error.message });
      return j(data || { ok:true });
    }
    if (api === "company_doc_move") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.doc_id) return j({ ok:false, error:"doc_id required" });
      const { data, error } = await sb.rpc("portal_company_doc_move", { p_token: b.token||"", p_doc_id: Number(b.doc_id), p_folder_id: b.folder_id ? Number(b.folder_id) : null });
      if (error) return j({ ok:false, error: error.message });
      return j(data || { ok:true });
    }
    if (api === "company_doc_list") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.rpc("portal_company_doc_list", { p_token: b.token||"", p_tenant: b.tenant||null });
      return j(data || { ok:true, documents:[], editable:false });
    }
    if (api === "company_doc_upload") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.tenant) return j({ ok:false, error:"tenant required" });
      const allowed = await allowedTenants(b.token);
      if (allowed.indexOf(b.tenant) < 0) return await denyTenant(me, "company_doc_upload", b.tenant);
      const raw = (b.content_base64||"").split(",").pop() || "";
      let bytes; try { bytes = Uint8Array.from(atob(raw), c=>c.charCodeAt(0)); } catch { return j({ ok:false, error:"bad file" }); }
      if (bytes.length > 20 * 1024 * 1024) return j({ ok:false, error:"file too large (max 20 MB)" });
      const safe = (b.file_name||"file").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,180);
      const path = b.tenant + "/" + Date.now() + "_" + safe;
      const up = await sb.storage.from("portal-company-docs").upload(path, bytes, { contentType: b.content_type||"application/octet-stream", upsert:false });
      if (up.error) return j({ ok:false, error: up.error.message });
      const meta = { category: b.category||"Other", title: b.title||safe, description: b.description||"", related_section: b.related_section||null, folder_id: b.folder_id||null, file_path: path, file_name: safe, file_size: bytes.length, mime_type: b.content_type||null, expiry_date: b.expiry_date||"", tags: Array.isArray(b.tags)?b.tags:[] };
      const { data, error } = await sb.rpc("portal_company_doc_save", { p_token: b.token||"", p_tenant: b.tenant, p_meta: meta });
      if (error) {
        // Roll back storage upload if the metadata insert failed.
        try { await sb.storage.from("portal-company-docs").remove([path]); } catch(_e){}
        return j({ ok:false, error: error.message });
      }
      return j(data || { ok:true });
    }
    if (api === "company_doc_download") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.doc_id) return j({ ok:false, error:"doc_id required" });
      const { data, error } = await sb.rpc("portal_company_doc_get_path", { p_token: b.token||"", p_doc_id: Number(b.doc_id) });
      if (error || !data || !data.ok) return j(data || { ok:false, error: (error&&error.message)||"failed" });
      const path = String(data.file_path||"");
      const { data: signed, error: sErr } = await sb.storage.from("portal-company-docs").createSignedUrl(path, 300);
      if (sErr || !signed) return j({ ok:false, error: (sErr&&sErr.message)||"could not sign URL" });
      return j({ ok:true, url: signed.signedUrl, meta: data.meta||{} });
    }
    if (api === "company_doc_delete") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.doc_id) return j({ ok:false, error:"doc_id required" });
      const { data, error } = await sb.rpc("portal_company_doc_delete", { p_token: b.token||"", p_doc_id: Number(b.doc_id) });
      if (error || !data || !data.ok) return j(data || { ok:false, error: (error&&error.message)||"failed" });
      try { await sb.storage.from("portal-company-docs").remove([String(data.file_path||"")]); } catch(_e){}
      return j({ ok:true });
    }
    if (api === "company_info_get") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.rpc("portal_company_info_get", { p_token: b.token||"", p_tenant: b.tenant||null });
      return j(data || { ok:true, companies:[], editable:false });
    }
    if (api === "company_info_save") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.tenant) return j({ ok:false, error:"tenant required" });
      const { data, error } = await sb.rpc("portal_company_info_save", { p_token: b.token||"", p_tenant: b.tenant, p_patch: b.patch||{} });
      if (error) return j({ ok:false, error: error.message });
      return j(data || { ok:true });
    }
    if (api === "totp_disable") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.rpc("portal_totp_disable", { p_token: b.token||"" });
      await logAudit(me, "totp_disable", me.user.email, {});
      return j(data);
    }
    return j({ ok:true, hint:"portal v73 AP: opt-in Google Document AI OCR -> GPT-5.4 reasoning (ocr_provider=docai); fin-analytics; sync-fast" });
  } catch (e) { return j({ ok:false, error: String(e) }, 500); }
});
