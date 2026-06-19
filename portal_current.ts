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
function timingSafeEqual(a, b){ if (typeof a!=="string" || typeof b!=="string" || a.length!==b.length) return false; let r=0; for (let i=0;i<a.length;i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r===0; }
async function sha256Hex(s){ const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return Array.from(new Uint8Array(buf)).map(x=>x.toString(16).padStart(2,"0")).join(""); }
function invToCacheRow(tenant, iv){ const now = new Date().toISOString(); return { tenant_id: tenant, invoice_id: iv.InvoiceID, number: iv.InvoiceNumber || null, type: iv.Type || null, status: iv.Status || null, contact_name: (iv.Contact||{}).Name || null, contact_id: (iv.Contact||{}).ContactID || null, total: Number(iv.Total||0), amount_due: Number(iv.AmountDue||0), currency: iv.CurrencyCode || null, inv_date: (String(iv.DateString||iv.Date||"").slice(0,10)) || null, due_date: (String(iv.DueDateString||iv.DueDate||"").slice(0,10)) || null, updated_at: now, last_synced_at: now }; }
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
async function processPendingDedup(limit){
  const { data: pend } = await sb.from("xero_webhook_events").select("id,tenant_id,event_category,resource_id,attempts").eq("processed", false).lt("attempts", 5).order("received_at", { ascending:true }).limit(limit||200);
  if (!pend || !pend.length){ const { count } = await sb.from("xero_webhook_events").select("id", { count:"exact", head:true }).eq("processed", false); return { processed: 0, deduplicated: 0, remaining: count||0 }; }
  const buckets = new Map();
  for (const row of pend){
    const key = row.tenant_id + "|" + row.event_category + "|" + row.resource_id;
    if (!buckets.has(key)) buckets.set(key, { ev:{ tenantId: row.tenant_id, eventCategory: row.event_category, resourceId: row.resource_id }, ids:[], maxAttempts:0 });
    const b = buckets.get(key); b.ids.push(row.id); if (row.attempts > b.maxAttempts) b.maxAttempts = row.attempts;
  }
  let processed = 0;
  for (const bucket of buckets.values()){
    try {
      await processOneEvent(bucket.ev);
      await sb.from("xero_webhook_events").update({ processed: true, last_attempt_at: new Date().toISOString() }).in("id", bucket.ids);
      processed += bucket.ids.length;
    } catch (e) {
      await sb.from("xero_webhook_events").update({ attempts: bucket.maxAttempts + 1, last_attempt_at: new Date().toISOString(), last_error: String(e).slice(0,500) }).in("id", bucket.ids);
    }
  }
  const { count } = await sb.from("xero_webhook_events").select("id", { count:"exact", head:true }).eq("processed", false);
  return { processed, deduplicated: pend.length - buckets.size, unique_resources: buckets.size, remaining: count||0 };
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
async function applyInvoiceBatch(tenant_id, arr){
  if (!arr || !arr.length) return { upserted: 0, deleted: 0 };
  const live = []; const dead = [];
  for (const iv of arr){
    const s = String(iv.Status || "").toUpperCase();
    if (s === "VOIDED" || s === "DELETED") dead.push(iv.InvoiceID); else live.push(iv);
  }
  let upserted = 0, deleted = 0;
  if (live.length){
    const rows = live.map((iv)=>invToCacheRow(tenant_id, iv));
    const { error } = await sb.from("xero_invoice_cache").upsert(rows, { onConflict:"tenant_id,invoice_id" });
    if (!error) upserted = rows.length;
  }
  if (dead.length){
    const { error } = await sb.from("xero_invoice_cache").delete().eq("tenant_id", tenant_id).in("invoice_id", dead);
    if (!error) deleted = dead.length;
  }
  return { upserted, deleted };
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
    const withIds = events.map((e,i)=>({ ev:e, id: inserted[i] && inserted[i].id }));
    try { const p = processWebhookEvents(withIds); if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p); else p.catch(()=>{}); } catch (_e) {}
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
      if (allowed.indexOf(SKINDAE_TENANT) < 0) return await denyTenant(me, "o2o_issue", SKINDAE_TENANT);
      const invs = Array.isArray(b.invoices) ? b.invoices : [];
      if (!invs.length) return j({ ok:false, error:"no invoices" });
      const period = String(b.period || "Skindae billing");
      // v28: prefer the frontend-formatted "O2O Sales DD/MM/YYYY - DD/MM/YYYY" reference; fall back to raw period.
      const reference = String(b.reference || period).slice(0, 255);
      const today = new Date().toISOString().slice(0,10);
      const due = new Date(Date.now() + 30*86400000).toISOString().slice(0,10);
      const built = [];
      for (const p of invs) {
        // v36: try the pharmacy master first — fastest, most accurate. Falls back to the contacts-cache name lookup.
        let cid = null; let masterSource = false;
        try {
          const { data: pm } = await sb.rpc("portal_pharmacy_resolve_by_name", { p_name: p.pharmacy });
          if (pm && pm.ok && pm.pharmacy && pm.pharmacy.xero_contact_id) { cid = pm.pharmacy.xero_contact_id; masterSource = true; }
        } catch (_e) {}
        if (!cid) cid = await resolveContact(SKINDAE_TENANT, p.pharmacy);
        // v28: forward ItemCode + DiscountRate when the frontend supplies them (per-SKU mode).
        const lineItems = (p.lines||[]).map((l)=>{
          const li = { Description:String(l.package||"Item").slice(0,4000), Quantity:Number(l.quantity)||1, UnitAmount:Number(l.unit_price)||0, AccountCode:O2O_REVENUE_CODE };
          if (l.item_code) li.ItemCode = String(l.item_code).slice(0,30);
          if (typeof l.discount_rate === "number" && l.discount_rate > 0) li.DiscountRate = Number(l.discount_rate);
          return li;
        });
        built.push({ matched: !!cid, masterSource, pharmacy: p.pharmacy, total: p.total, xero: { Type:"ACCREC", Contact: cid?{ ContactID:cid }:{ Name:String(p.pharmacy||"").slice(0,500) }, Date:today, DueDate:due, Reference:reference, Status:"AUTHORISED", LineAmountTypes:"Exclusive", LineItems: lineItems } });
      }
      if (b.dry_run !== false) return j({ ok:true, dry_run:true, issued:0, emailed:0, failed:0, results: built.map(x=>({ pharmacy:x.pharmacy, total:x.total, number:"", status:"dry_run", contact: x.matched?"existing":"new" })) });
      const access = await xeroAccessToken();
      const idem = await sha256Hex(JSON.stringify(built.map(x=>x.xero)) + "|" + period);
      const r = await fetch("https://api.xero.com/api.xro/2.0/Invoices?summarizeErrors=false", { method:"POST", headers:{ "Authorization":"Bearer " + access, "Xero-Tenant-Id":SKINDAE_TENANT, "Content-Type":"application/json", "Accept":"application/json", "Idempotency-Key": idem }, body: JSON.stringify({ Invoices: built.map(x=>x.xero) }) });
      const out = await r.json();
      if (!r.ok && !out.Invoices) return j({ ok:false, error: out.Detail || out.Message || JSON.stringify(out).slice(0,500) });
      const arr = out.Invoices || [];
      const results = built.map((p, i)=>{ const iv = arr[i]||{}; const hasErr = iv.HasErrors || (iv.ValidationErrors&&iv.ValidationErrors.length); return { pharmacy:p.pharmacy, total:p.total, number: iv.InvoiceNumber||"", contact: p.matched?"existing":"new", status: hasErr?"failed":(iv.InvoiceID?"issued":"failed"), error: hasErr?(iv.ValidationErrors||[]).map((e)=>e.Message).join("; "):undefined, contact_id: (iv.Contact && iv.Contact.ContactID) || undefined }; });
      // v36: write the resolved Xero ContactID back to the pharmacy master so future runs hit the fast path.
      for (let i=0; i<results.length; i++){
        const cid = results[i].contact_id;
        if (cid && results[i].status==="issued"){
          try { await sb.rpc("portal_pharmacy_remember_xero_contact", { p_name: results[i].pharmacy, p_contact_id: cid }); } catch(_e){}
        }
      }
      await logAudit(me, "o2o_issue", period, { issued: results.filter(x=>x.status==="issued").length, idem });
      return j({ ok:true, dry_run:false, issued: results.filter(x=>x.status==="issued").length, emailed:0, failed: results.filter(x=>x.status==="failed").length, results });
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
      const now = Date.now(); const items = [];
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
    return j({ ok:true, hint:"portal v28 ModifiedAfter+ID-reconcile+rate-limit-cooldown" });
  } catch (e) { return j({ ok:false, error: String(e) }, 500); }
});
