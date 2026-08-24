// Shared library for the portal edge function: the Supabase client, the JSON/CORS response helper,
// auth + role + tenant-isolation guards, TOTP, Web Push, the Xero OAuth/REST client and cache, the
// P&L parser, the OCR / Document AI / vision-LLM layer, the AP inbound-email pipeline, and the cron
// internals. Moved verbatim out of the single-file index.ts; only `export` was added.
//
// Everything here is used by BOTH halves of the portal. HR-only helpers live in hr.ts instead.

import { createClient } from "jsr:@supabase/supabase-js@2";
export const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
export const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
export function j(x, status=200){ return new Response(JSON.stringify(x), { status, headers: { "content-type":"application/json", ...CORS } }); }
export const SKINDAE_TENANT = "6a4194ca-42f4-45ec-a44c-f9c8f01071a7";
export const O2O_REVENUE_CODE = "500-0100";
export const XERO_SCOPES = "offline_access accounting.contacts accounting.settings accounting.invoices accounting.payments accounting.banktransactions accounting.attachments";
export const PORTAL_PUBLIC_URL = "https://cmostxcjtbuhbzfojuid.supabase.co/functions/v1/portal";
export const CLOSE_TEMPLATE = [
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
export function escHtml(s){ return String(s==null?"":s).replace(/[<>&]/g, function(c){ return c==="<"?"&lt;":c===">"?"&gt;":"&amp;"; }); }
export function htmlResp(inner, status){ return new Response("<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body style='font-family:system-ui,Arial;background:#0C1421;color:#e8eef7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0'><div style='max-width:540px;padding:32px;border:1px solid #2a3a52;border-radius:16px;background:#131c2d;line-height:1.7;font-size:15px'>" + inner + "</div></body></html>", { status: status||200, headers: { "content-type":"text/html; charset=utf-8", ...CORS } }); }
export function clientIp(req){ const h = req.headers; const xff = (h.get("x-forwarded-for")||"").split(",")[0].trim(); return xff || h.get("cf-connecting-ip") || h.get("x-real-ip") || null; }
export const B32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(bytes){ let bits=0, value=0, out=""; for (const b of bytes){ value=(value<<8)|b; bits+=8; while (bits>=5){ out+=B32_CHARS[(value>>>(bits-5))&31]; bits-=5; } } if (bits>0) out+=B32_CHARS[(value<<(5-bits))&31]; return out; }
export function base32Decode(s){ s=String(s||"").toUpperCase().replace(/=+$/,"").replace(/\s/g,""); let bits=0, value=0; const out=[]; for (const ch of s){ const idx=B32_CHARS.indexOf(ch); if (idx<0) continue; value=(value<<5)|idx; bits+=5; if (bits>=8){ out.push((value>>>(bits-8))&0xff); bits-=8; } } return new Uint8Array(out); }
export function genTotpSecret(){ const buf=new Uint8Array(20); crypto.getRandomValues(buf); return base32Encode(buf); }
export async function totpVerify(secretB32, code, win=1){
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
export function otpAuthUrl(label, secret, issuer){ return "otpauth://totp/" + encodeURIComponent(issuer + ":" + label) + "?secret=" + secret + "&issuer=" + encodeURIComponent(issuer) + "&algorithm=SHA1&digits=6&period=30"; }
export async function xeroOAuthStart(qp){
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
export async function xeroOAuthCallback(qp){
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
    // v129: insert NEW tenants only (ignoreDuplicates) — the /connections tenantName is a stale
    // connect-time snapshot; overwriting here would clobber the Organisation-endpoint names that
    // tenants_refresh / the nightly cron maintain.
    if (Array.isArray(conns)) { tenantsMsg = conns.map((c)=>c.tenantName).join(", "); for (const c of conns) { try { await sb.from("xero_tenants").upsert({ tenant_id:c.tenantId, tenant_name:c.tenantName }, { onConflict:"tenant_id", ignoreDuplicates:true }); } catch(_e){} } }
  } catch (_e) {}
  try { await sb.from("portal_secrets").delete().eq("key","oauth_state"); } catch(_e){}
  try { await sb.from("portal_audit").insert({ action:"xero_reconnect", ref:"oauth", detail:{ tenants: tenantsMsg } }); } catch(_e){}
  return htmlResp("<b style='color:#7ee0a0;font-size:19px'>âœ“ Xero reconnected</b><br><br>Connected organisations: " + (escHtml(tenantsMsg)||"(none returned)") + ".<br><br>You can close this tab and return to the portal, then open <b>Users â†’ Xero sync</b> and click <b>Full sync from Xero</b> to refill the cache.", 200);
}
// v129: org display names. The /connections tenantName is a connect-time snapshot — renaming the
// organisation in Xero never propagates to it (that is how an invisible-char/stale name got stuck).
// GET /Organisation per tenant is the authority; called from tenants_refresh and the nightly cron.
export async function xeroOrgName(access: string, tenantId: string): Promise<string> {
  try {
    const r = await fetch("https://api.xero.com/api.xro/2.0/Organisation", { headers:{ "Authorization":"Bearer "+access, "xero-tenant-id":tenantId, "Accept":"application/json" } });
    if (!r.ok) return "";
    const jj = await r.json();
    const nm = String((jj.Organisations && jj.Organisations[0] && jj.Organisations[0].Name) || "");
    return nm.replace(/[​‌‍⁠﻿]/g, "").trim();  // strip zero-width chars (v67 lesson: \u escapes, never literals)
  } catch(_e){ return ""; }
}
export async function xeroAccessToken(){
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
export async function meFromToken(token){
  const { data } = await sb.rpc("portal_me", { p_token: token||"" });
  if (data && data.ok && token){ try { sb.rpc("portal_touch_session", { p_token: token }).then(()=>{}, ()=>{}); } catch (_e) {} }
  return data;
}
// isAdmin gates Finance-Portal operational actions. 'approver' was folded in here, which silently made
// any portal_users.role='approver' a full Finance admin (could issue AUTHORISED Xero invoices, reconcile
// banks). The HR approver model is separate (hr_claim_role_approvers), so a Finance super-user was never
// intended — admin only. (No 'approver' accounts exist, so this is zero-impact today, closes it for launch.)
export function isAdmin(me){ const r = me && me.user && me.user.role; return me && me.ok && r==="admin"; }
export function superAdmin(me){ return me && me.ok && me.user && me.user.role==="admin"; }
export function hrViewer(me){ return me && me.ok && me.user && me.user.role==="viewer"; }        // read-only HR access
export function hrManage(me){ return superAdmin(me) || (me && me.ok && me.user && me.user.role==="hr_admin"); } // full HR write (admin or hr_admin), NO finance
export function hrCanView(me){ return hrManage(me) || hrViewer(me); }                            // may READ hr data (admin / hr_admin / viewer)
// HR actions a read-only Viewer is allowed to call; every other hr_/attendance_/clock_ action is blocked for viewers.
export const HR_VIEWER_READS = new Set(["hr_companies","hr_bootstrap","hr_banks_list","attendance_list","hr_dashboard","hr_payroll_data","hr_payroll_runs_list","hr_leave_admin","hr_leave_pending","hr_leave_flow_get","hr_rc_config","hr_rc_list","hr_rc_get","hr_rc_dashboard","hr_annual","hr_calc_history","sbi_accounts"]);
// HR-only roles have NO Finance Portal access; every action outside this set is blocked for them.
export const HR_ONLY_ROLES = new Set(["employee","viewer","hr_admin"]);
export function isHrNamespace(a){ return a.indexOf("hr_")===0 || a.indexOf("attendance_")===0 || a.indexOf("clock_")===0 || a==="sbi_accounts"; }
export const AUTH_BASIC_ACTIONS = new Set(["me","login","logout","__ping__","client_error","totp_setup","totp_verify","totp_disable","totp_status","changepw","push_unsubscribe"]); // changepw: every role may change its own password (RPC re-verifies the old one). push_unsubscribe: the last survivor of the retired Web Push feature (v224) — the old origin's forwarding page calls it to clear a device.
export async function logAudit(me, action, ref, detail){ try{ await sb.from("portal_audit").insert({ user_id:(me&&me.user&&me.user.id)||null, user_email:(me&&me.user&&me.user.email)||null, action:action, ref:String(ref||""), detail:detail||{} }); }catch(_e){} }
// Returns the tenant_ids this caller may touch. FAIL-CLOSED: the RPC returns a non-matching sentinel
// UUID (not []) for an invalid token or a user with no company assignment, and on any error here we
// return that same sentinel — so a guard `alw.indexOf(realTenant) < 0` denies rather than opening up.
// A genuine full-scope admin gets the full real tenant list from the RPC, never the sentinel.
export const NO_TENANT = "00000000-0000-0000-0000-000000000000";
export async function allowedTenants(token){ try{ const { data } = await sb.rpc("portal_allowed_tenants", { p_token: token||"" }); return (Array.isArray(data) && data.length) ? data : [NO_TENANT]; } catch (_e) { return [NO_TENANT]; } }
// v148 (security audit): a FULL-SCOPE admin is one whose allowed tenants cover EVERY company. superAdmin()
// alone is not tenant-aware, and 4 of 5 admins are scoped to a single company — so group-wide admin actions
// (all-session list, group audit log, RBAC config, group-wide payee PII, group cache rebuilds) must gate on
// this, not on superAdmin(), or a single-company admin reads/writes every company's data.
export async function isFullScopeAdmin(me:any, token:string){
  if (!superAdmin(me)) return false;
  const alw = await allowedTenants(token);
  if (!alw.length || alw.indexOf(NO_TENANT) >= 0) return false;
  const { count } = await sb.from("xero_tenants").select("tenant_id", { count:"exact", head:true });
  return (count||0) > 0 && alw.length >= (count||0);
}
// Tenant pin for by-id actions (v103): the central guard only sees b.tenant in the request body, so an
// action that takes only an id could act on another company's record. Call with the FETCHED record's
// tenant_id; returns false when the caller's allowed list doesn't include it. Apply on admin paths —
// employee self-service flows are already record-pinned by their own ownership/approver checks.
// v142: account-management scope. superAdmin alone was the only gate on user_update /
// user_reset_password, so a COMPANY-SCOPED Master Admin could change the role, deactivate, or
// reset the password of any account in the group — including a full-scope admin's.
// Rule: the target's company set must be non-empty and a SUBSET of the caller's allowed set.
// Subset, not intersection — portal_users.role is global, so editing a user who also belongs to
// a company you can't see would silently change their access there too.
// A target with NO company rows is group-wide (full-scope admin) and only another group-wide
// admin may touch it.
export async function userWriteAllowed(token, callerId, targetUserId){
  if (!targetUserId) return false;
  const { data: tRows } = await sb.from("portal_user_companies").select("tenant_id").eq("user_id", targetUserId);
  const { data: cRows } = await sb.from("portal_user_companies").select("tenant_id").eq("user_id", callerId);
  const callerGroupWide = !((cRows||[]).length);
  const targetTenants = (tRows||[]).map((r)=> String(r.tenant_id));
  if (!targetTenants.length) return callerGroupWide;
  if (callerGroupWide) return true;
  const alw = await allowedTenants(token);
  return targetTenants.every((t)=> alw.indexOf(t) >= 0);
}
// Companies a caller is allowed to ASSIGN someone to (blocks widening a user's scope past your own).
export async function tenantsAssignable(token, callerId, tenantIds){
  const ids = (tenantIds||[]).map((t)=> String(t)).filter(Boolean);
  if (!ids.length) return true;
  const { data: cRows } = await sb.from("portal_user_companies").select("tenant_id").eq("user_id", callerId);
  if (!((cRows||[]).length)) return true;                 // group-wide admin may assign anywhere
  const alw = await allowedTenants(token);
  return ids.every((t)=> alw.indexOf(t) >= 0);
}
export async function tenantPinned(token, tenantId){
  if(!tenantId) return true;
  const allowed = await allowedTenants(token);
  return allowed.indexOf(String(tenantId)) >= 0;
}
export async function denyTenant(me, action, tenant){ await logAudit(me, "tenant_access_denied", String(tenant||""), { action }); return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }

// ===== Web Push (clock-in reminders) — RETIRED v224 =====
// The VAPID stack (vapidConfig / vapidJwt / webPushSend / pushToEmployee) and pendingForEmployee lived
// here. The captain retired the installable HR app and Web Push at the new-domain cutover: every push
// reminder already went out by email as well, so nothing is lost. Nothing in this function SENDS a push
// any more. `push_unsubscribe` (hr.ts) is deliberately the one handler kept — the forwarding page on the
// old GitHub Pages origin calls it to clear a device, and with the sender gone the 404/410 prune that
// used to be the other way a row died never runs again, so it is now the ONLY path. Dropping
// hr_push_subscriptions / hr_push_reminder_log / hr_push_config, and unscheduling the two pg_cron jobs,
// are captain actions — see the PR.
// â”€â”€ Xero GET with proper 429 rate-limit handling (Retry-After header). â”€â”€
// Previous behaviour: silent fail on 429 â†’ break upstream loops â†’ cache silently stale.
// New behaviour: honour Retry-After (cap at 90s), retry up to 3 times, then throw.
export async function xeroGet(access, tenant, path, extraHeaders){
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
export async function xeroInvoicesAll(access, tenant, type){
  const out:any[] = [];
  // A mid-pagination failure (e.g. daily 429 cap on page 3) used to silently return a PARTIAL list that
  // callers treated as complete — the collections screen would show a fraction of overdue AR as "all".
  // Surface truncation via a non-enumerable-ish marker the callers pass through to the UI.
  (out as any).__partial = false;
  for (let page=1; page<=100; page++){
    let d; try { d = await xeroGet(access, tenant, "Invoices?Statuses=AUTHORISED,SUBMITTED&page=" + page + "&where=" + encodeURIComponent('Type=="' + type + '"')); }
    catch (e) { (out as any).__partial = true; (out as any).__error = String(e).slice(0,200); break; }
    const arr = d.Invoices || [];
    if (!arr.length) break;
    for (const iv of arr) out.push(iv);
    if (arr.length < 100) break;
  }
  return out;
}
// v143: paginate an arbitrary Invoices?where= query. The AP duplicate cross-check used to fetch
// ONE page (Xero caps at 100 with no pageSize) — under full-autonomy AP a duplicate bill sitting
// past record 100 was invisible, so a repeat supplier invoice could be auto-posted (double pay).
// pageSize=1000 makes one page enough for a single-vendor filter; the loop covers a no-vendor
// 90-day scan. __partial is set if we hit the page ceiling or a mid-scan error, so callers can
// refuse to treat an incomplete scan as "no duplicate found".
export async function xeroInvoicesWhere(access, tenant, whereClause){
  const out:any[] = [];
  (out as any).__partial = false;
  for (let page=1; page<=50; page++){
    let d;
    try { d = await xeroGet(access, tenant, "Invoices?pageSize=1000&page=" + page + "&where=" + encodeURIComponent(whereClause)); }
    catch (e) { (out as any).__partial = true; (out as any).__error = String(e).slice(0,200); break; }
    const arr = d.Invoices || [];
    for (const iv of arr) out.push(iv);
    if (arr.length < 1000) return out;          // fewer than a full page ⇒ genuinely exhausted
  }
  (out as any).__partial = true;                // exited via the page ceiling ⇒ possibly truncated
  return out;
}
// ilike special chars must be literal: a vendor named "100% Wellness" must not wildcard-match
// "100 PLUS WELLNESS" — with AP autonomy ON that posts the bill to the wrong supplier contact.
export function ilikeEscape(s){ return String(s).replace(/([%_\\])/g, "\\$1"); }
export async function resolveContact(tenant, name){ if(!name) return null; const { data } = await sb.from("xero_contacts_cache").select("contact_id,name").eq("tenant_id", tenant).ilike("name", ilikeEscape(String(name).trim())).limit(1); return (data && data.length) ? data[0].contact_id : null; }
export async function getWebhookKey(){ try{ const { data } = await sb.from("portal_secrets").select("value").eq("key","xero_webhook").single(); if (data && data.value) return data.value; }catch(_e){} return Deno.env.get("XERO_WEBHOOK_KEY") || ""; }
export async function hmacSha256B64(key, msg){
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
// v69 (Wave 1c, spec §E): record every successful AP post into vendor_coding_history so the
// cascade (Wave 2) can learn from real decisions. Best-effort — failures never block posting.
export async function recordVendorCodingHistory(
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
export function timingSafeEqual(a, b){ if (typeof a!=="string" || typeof b!=="string" || a.length!==b.length) return false; let r=0; for (let i=0;i<a.length;i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r===0; }
export async function sha256Hex(s){ const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return Array.from(new Uint8Array(buf)).map(x=>x.toString(16).padStart(2,"0")).join(""); }
// v68 (Wave 3): SHA-256 of raw bytes — used to fingerprint AP attachment files at intake.
export async function sha256HexBytes(bytes){ const buf = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(buf)).map((x)=>x.toString(16).padStart(2,"0")).join(""); }
// Parse a Xero ProfitAndLoss report into income[] / expenses[] account breakdowns + totals.
// Xero report shape: Reports[0].Rows = [Header, Section{Title, Rows:[Row|SummaryRow]}, ...].
// Each data Row's Cells = [accountName, ..., amount]; SummaryRow holds section totals.
export function parsePnl(rep){
  const income = [], expenses = [], sections = [];
  // v140: keep Xero's SIGN. Expense sections are normally positive (a cost), but in a
  // reversal/credit month Xero returns them negative. Math.abs() used to flip those credits
  // into charges — the error was exactly 2x the credit balance and broke revenue-expenses=net.
  // sawRev/sawExp/sawNet distinguish "Xero reported 0" from "no total row found".
  let revTotal = 0, expTotal = 0, net = 0;
  let sawRev = false, sawExp = false, sawNet = false;
  const num = (s)=>{ const n = parseFloat(String(s==null?"":s).replace(/[(,\s]/g,"").replace(/\)/g,"")); return isNaN(n) ? 0 : (String(s).indexOf("(")>=0 ? -n : n); };
  let rowSeq = 0;   // v147: monotonic order accounts appear in the Xero report, so the grid can match the export row order (not alphabetical)
  if (rep && Array.isArray(rep.Rows)){
    for (const section of rep.Rows){
      if (section.RowType !== "Section") continue;
      const rawTitle = String(section.Title||"");
      const title = rawTitle.toLowerCase();
      const isIncome  = /income|revenue|turnover|trading/.test(title);
      const isExpense = /expense|cost of sales|overhead|operating|less /.test(title);
      const secRows = [];   // v141: every account row in this section, for the P&L Analysis grid
      for (const row of (section.Rows||[])){
        const cells = row.Cells || [];
        const name = cells[0] ? cells[0].Value : "";
        const amt = num(cells.length ? cells[cells.length-1].Value : 0);
        if (/net profit|net income|profit for the/i.test(String(name))) { net = amt; sawNet = true; continue; }
        if (row.RowType === "SummaryRow"){
          if (isIncome) { revTotal += amt; sawRev = true; }
          else if (isExpense) { expTotal += amt; sawExp = true; }
          continue;
        }
        if (row.RowType === "Row" && name){
          secRows.push({ name: String(name), amount: amt, seq: rowSeq++ });
          if (amt !== 0){
            if (isIncome) income.push({ name, amount: amt });
            else if (isExpense) expenses.push({ name, amount: amt });
          }
        }
      }
      if (secRows.length && rawTitle) sections.push({ title: rawTitle, rows: secRows });
    }
  }
  if (!sawRev) revTotal = income.reduce((s,x)=>s+x.amount,0);
  if (!sawExp) expTotal = expenses.reduce((s,x)=>s+x.amount,0);
  if (!sawNet) net = revTotal - expTotal;
  income.sort((a,b)=>b.amount-a.amount);
  expenses.sort((a,b)=>b.amount-a.amount);
  return { revenue_total: Math.round(revTotal*100)/100, expense_total: Math.round(expTotal*100)/100, net_profit: Math.round(net*100)/100, income, expenses, sections };
}
// Cache the REAL Xero P&L per tenant per CALENDAR month. Xero's multi-period report (periods+timeframe)
// returns rolling windows ending on toDate's day-of-month (NOT calendar months) — so we call the proven
// single-period ProfitAndLoss once per calendar month (fromDate=1st..toDate=month end / today) and parse
// with parsePnl. Verified to match Xero exactly (ZEERO Jun income 396,682 / net 61,835.59).
export async function refreshPnlCache(access:any, tenants:any[], monthsBack?:number){
  const nMonths = Math.max(1, Math.min(monthsBack||12, 24));
  const myNow = new Date(Date.now()+8*3600*1000);
  const today = myNow.toISOString().slice(0,10);
  const periods:any[] = [];
  for(let k=nMonths-1; k>=0; k--){
    const y = myNow.getUTCFullYear(), m = myNow.getUTCMonth()-k;   // m may be negative → Date normalises
    const start = new Date(Date.UTC(y, m, 1));
    const endD  = new Date(Date.UTC(y, m+1, 0));                   // last day of that month
    const from = start.toISOString().slice(0,10);
    let to = endD.toISOString().slice(0,10); if(to > today) to = today;   // current month: cap at today
    periods.push({ key: from.slice(0,7), from, to });
  }
  const results:any[] = [];
  for(const t of (tenants||[])){
    let okN=0, lastErr="";
    for(const p of periods){
      try{
        const d = await xeroGet(access, t.tenant_id, "Reports/ProfitAndLoss?fromDate="+p.from+"&toDate="+p.to);
        const rep = (d.Reports||[])[0];
        const pl = parsePnl(rep);   // { revenue_total, expense_total, net_profit }
        await sb.from("xero_pnl_cache").upsert({ tenant_id:t.tenant_id, period:p.key, income:pl.revenue_total, cost_of_sales:0, expenses:pl.expense_total, net_profit:pl.net_profit, refreshed_at:new Date().toISOString() }, { onConflict:"tenant_id,period" });
        // v141: account-level rows for the P&L Analysis grid.
        // v148: was delete-then-insert (two non-atomic calls) — if the insert failed after the delete
        // succeeded, that tenant-month showed ZERO account rows under non-zero totals (blank grid).
        // Now UPSERT the fresh rows first (grid never goes empty), then delete only the STALE rows from
        // this month (refreshed_at older than this run) to drop accounts Xero no longer reports. A failed
        // upsert leaves last-good data; a failed delete just leaves a stale row that self-heals next run.
        try{
          const runStamp = new Date().toISOString();
          const accRows:any[] = [];
          for (const s of (pl.sections||[])){
            for (const r of (s.rows||[])){
              accRows.push({ tenant_id:t.tenant_id, period:p.key, section:s.title, account:r.name, amount:r.amount, seq:r.seq, refreshed_at:runStamp });
            }
          }
          if (accRows.length){
            const { error: upErr } = await sb.from("xero_pnl_accounts").upsert(accRows, { onConflict:"tenant_id,period,section,account" });
            if (upErr) throw upErr;
            await sb.from("xero_pnl_accounts").delete().eq("tenant_id", t.tenant_id).eq("period", p.key).lt("refreshed_at", runStamp);
          } else {
            // genuinely no accounts this month (e.g. dormant) — safe to clear.
            await sb.from("xero_pnl_accounts").delete().eq("tenant_id", t.tenant_id).eq("period", p.key);
          }
        }catch(e){ lastErr = lastErr || String(e).slice(0,120); }
        okN++;
      }catch(e){ lastErr=String(e).slice(0,120); }
    }
    // v139: also store YTD from ONE Xero range report. Summing 12 monthly reports differs from Xero's own
    // YTD report by a ringgit or two (Xero rounds each monthly report; FX-revaluation / depreciation are
    // period-dependent) and finance ties to the cent. Kept in its OWN table — putting a 'YTD-2026' key in
    // xero_pnl_cache would be double-counted by the unbounded `period >= '2026-01'` month sums.
    try{
      const yFrom = myNow.getUTCFullYear()+"-01-01";
      const dY = await xeroGet(access, t.tenant_id, "Reports/ProfitAndLoss?fromDate="+yFrom+"&toDate="+today);
      const plY = parsePnl((dY.Reports||[])[0]);
      await sb.from("xero_pnl_ytd").upsert({ tenant_id:t.tenant_id, year:myNow.getUTCFullYear(), income:plY.revenue_total, expenses:plY.expense_total, net_profit:plY.net_profit, refreshed_at:new Date().toISOString() }, { onConflict:"tenant_id,year" });
    }catch(e){ lastErr=lastErr||String(e).slice(0,120); }
    results.push({ tenant:t.tenant_id, months:okN, error:lastErr||undefined });
  }
  return results;
}
// Xero may return dates in two formats: ISO "2026-06-15T00:00:00" (DateString)
// or legacy Microsoft "/Date(1718409600000+0000)/" (Date). slicing the latter to 10 chars
// yields "/Date(1718" which Postgres rejects → the WHOLE batch upsert fails silently.
// xDate handles both and returns null on anything unparseable.
export function xDate(s){
  if (!s) return null;
  const str = String(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0,10);
  const m = str.match(/\/Date\((-?\d+)/);
  if (m){ const d = new Date(parseInt(m[1],10)); if (!isNaN(d.getTime())) return d.toISOString().slice(0,10); }
  const d = new Date(str); if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
  return null;
}
export function invToCacheRow(tenant, iv){ const now = new Date().toISOString(); return { tenant_id: tenant, invoice_id: iv.InvoiceID, number: iv.InvoiceNumber || null, type: iv.Type || null, status: iv.Status || null, contact_name: (iv.Contact||{}).Name || null, contact_id: (iv.Contact||{}).ContactID || null, total: Number(iv.Total||0), amount_due: Number(iv.AmountDue||0), currency: iv.CurrencyCode || null, /* Xero CurrencyRate is FOREIGN PER BASE (a USD bill on an MYR org carries ~0.2522, i.e. 1 USD = RM3.97), so the base amount is amount / rate — the generated columns total_base / amount_due_base do the division. Multiplying shrinks FX balances ~4x. */ currency_rate: (Number(iv.CurrencyRate) > 0 ? Number(iv.CurrencyRate) : 1), inv_date: xDate(iv.DateString||iv.Date), due_date: xDate(iv.DueDateString||iv.DueDate), updated_at: now, last_synced_at: now }; }
// v144 (H4): supabase-js does NOT throw on a DB error — it returns { error }. processOneEvent used to
// ignore that, so a failed cache write still returned true and the caller marked the webhook event
// processed:true. The lost write is exactly a PAYMENT/CREDITNOTE AmountDue change — a paid invoice
// kept its old balance and collections chased a customer who had already paid. sbMust throws on error
// so the caller's catch increments attempts and the event is retried instead of silently dropped.
export async function sbMust(op:any, what:string){ const { error } = await op; if (error) throw new Error(what+": "+(error.message||String(error))); }
// v37+: also handle PAYMENT and CREDITNOTE events — both change Invoice.AmountDue.
// Without this, Xero payments don't reflect in the cache until next delta cron (up to 1h lag).
export async function processOneEvent(ev){
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
        await sbMust(sb.from("xero_contacts_cache").delete().eq("tenant_id", tenant).eq("contact_id", c.ContactID), "contact delete");
      } else {
        await sbMust(sb.from("xero_contacts_cache").upsert({ tenant_id: tenant, contact_id: c.ContactID, name: c.Name || "", email: c.EmailAddress || null, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,contact_id" }), "contact upsert");
      }
    }
  } else if (cat === "INVOICE"){
    const d = await xeroGet(access, tenant, "Invoices/" + rid);
    const iv = (d.Invoices || [])[0];
    if (iv){
      if (iv.Status === "VOIDED" || iv.Status === "DELETED"){
        await sbMust(sb.from("xero_invoice_cache").delete().eq("tenant_id", tenant).eq("invoice_id", iv.InvoiceID), "invoice delete");
      } else {
        await sbMust(sb.from("xero_invoice_cache").upsert(invToCacheRow(tenant, iv), { onConflict: "tenant_id,invoice_id" }), "invoice upsert");
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
          await sbMust(sb.from("xero_invoice_cache").delete().eq("tenant_id", tenant).eq("invoice_id", iv.InvoiceID), "payment→invoice delete");
        } else {
          await sbMust(sb.from("xero_invoice_cache").upsert(invToCacheRow(tenant, iv), { onConflict: "tenant_id,invoice_id" }), "payment→invoice upsert");
        }
      }
    }
  } else if (cat === "CREDITNOTE"){
    // Credit notes can apply to invoices via Allocations[] — refresh each allocated invoice.
    const d = await xeroGet(access, tenant, "CreditNotes/" + rid);
    const cn = (d.CreditNotes || [])[0];
    const allocs = (cn && cn.Allocations) || [];
    const seen = new Set();
    let firstErr:any = null;
    for (const a of allocs){
      const id = a && a.Invoice && a.Invoice.InvoiceID; if (!id || seen.has(id)) continue; seen.add(id);
      try {
        const di = await xeroGet(access, tenant, "Invoices/" + id);
        const iv = (di.Invoices || [])[0];
        if (iv){
          if (iv.Status === "VOIDED" || iv.Status === "DELETED"){
            await sbMust(sb.from("xero_invoice_cache").delete().eq("tenant_id", tenant).eq("invoice_id", iv.InvoiceID), "creditnote→invoice delete");
          } else {
            await sbMust(sb.from("xero_invoice_cache").upsert(invToCacheRow(tenant, iv), { onConflict: "tenant_id,invoice_id" }), "creditnote→invoice upsert");
          }
        }
      } catch (e){ firstErr = firstErr || e; }   // don't swallow: a lost allocation write is a wrong AmountDue
    }
    // Rethrow so the event is retried rather than marked processed with a stale balance.
    if (firstErr) throw firstErr;
  }
  return true;
}
export async function processWebhookEvents(list){
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
export async function fetchInvoiceIdsBatch(access, tenant, ids){
  // Returns { applied, deleted, error }. IDs requested but NOT returned by Xero are treated as
  // gone (VOIDED/DELETED) and pruned from cache so the cache mirrors Xero exactly.
  const d = await xeroGet(access, tenant, "Invoices?IDs=" + ids.join(","));
  const arr = (d && d.Invoices) || [];
  const r = await applyInvoiceBatch(tenant, arr);
  let deleted = r.deleted || 0;
  const returned = new Set(arr.map((iv)=>iv.InvoiceID));
  const missing = ids.filter((id)=> !returned.has(id));
  let pruneErr:any = null;
  // v148: the prune of Xero-gone invoices used to swallow its error — a failed delete left a VOIDED/PAID
  // invoice lingering in AR/AP with a stale amount_due forever, while the webhook events were still marked
  // processed. Surface it so the caller holds the watermark / retries instead of dropping it silently.
  if (missing.length){
    const { error } = await sb.from("xero_invoice_cache").delete().eq("tenant_id", tenant).in("invoice_id", missing);
    if (error) pruneErr = "prune: " + String(error.message||error).slice(0,160); else deleted += missing.length;
  }
  return { applied: r.upserted || 0, deleted, error: r.error || pruneErr || null };
}
export async function processPendingDedup(limit){
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
        if (r.error){
          // The Xero fetch worked but the cache upsert reported an error — do NOT drain these events as
          // "processed" (the invoice would silently stay stale). Leave them for retry with the error recorded.
          for (const bk of chunk){ await sb.from("xero_webhook_events").update({ attempts: bk.maxAttempts + 1, last_attempt_at: new Date().toISOString(), last_error: ("batch-upsert: " + String(r.error)).slice(0,500) }).in("id", bk.ids); }
        } else {
          await sb.from("xero_webhook_events").update({ processed: true, last_attempt_at: new Date().toISOString() }).in("id", rowIds);
          processed += rowIds.length;
        }
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
export async function syncStateUpdate(tenant_id, patch){ try{ await sb.from("xero_sync_state").upsert({ tenant_id, ...patch }, { onConflict: "tenant_id" }); } catch(_e){} }
// ── v28: per-tenant rate-limit guard. Skip syncing tenants currently in cooldown.
export async function isRateLimited(tenant_id){
  try{ const { data } = await sb.from("xero_sync_state").select("rate_limited_until").eq("tenant_id", tenant_id).maybeSingle();
    if (data && data.rate_limited_until && new Date(data.rate_limited_until).getTime() > Date.now()) return data.rate_limited_until;
  }catch(_e){}
  return null;
}
// ── v28: when a 429 with high Retry-After fires, persist a cooldown so other tenants/calls don't keep hammering the same dead budget.
export function parseRateLimitMessage(msg){
  const m = String(msg||"").match(/Retry-After=(\d+)s/);
  return m ? Math.min(parseInt(m[1],10), 24*3600) : null;
}
export async function recordRateLimit(tenant_id, errMsg){
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
export function resolveModel(provider, aiModel){
  provider = String(provider||"anthropic").toLowerCase();
  const m = String(aiModel||"");
  if (provider === "openai") return /^(gpt|o\d|chatgpt)/i.test(m) ? m : "gpt-4o-mini";
  if (provider === "gemini") return /^gemini/i.test(m) ? m : "gemini-flash-latest";
  return /^claude/i.test(m) ? m : "claude-haiku-4-5-20251001";
}
export async function callVisionLLM(provider, model, systemPrompt, neutral, maxTokens){
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
      // Model availability, free-tier quota AND the accepted generationConfig all shift over time, and
      // `gemini-flash-latest` is an ALIAS Google re-points — so a request that worked in July can start
      // returning 400 with nothing on our side having changed. That is exactly what happened: receipt OCR
      // last succeeded on 2026-07-20 and then every scan failed, because
      //   (a) the first candidate began answering 400 INVALID_ARGUMENT, and
      //   (b) the loop treated any non-404/429 as fatal and returned WITHOUT trying the other five models.
      // One alias moving took the whole ladder down. Now: a bad request is per-model, not fatal.
      // Probed live against this key on 2026-08-11. Every DATED model id is gone:
      //   gemini-2.5-flash        404 no longer available
      //   gemini-2.5-flash-lite   404 no longer available
      //   gemini-2.0-flash-001    404 no longer available
      //   gemini-2.0-flash        404 "no longer available. Please update your code to use a newer model"
      //   gemini-1.5-flash        404 not found for API version v1beta
      // Only the *-latest aliases still resolve, which is the point of them: Google retires the dated ids
      // and keeps the aliases pointing at something current. Pinning a dated id here buys nothing except a
      // dead entry in six months — so the ladder is aliases only, cheapest first.
      const candidates = [model, "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest"]
        .filter((v,i,a)=>v && a.indexOf(v)===i);
      const gemBody = (mdl:string, thinking:boolean)=>{
        const gc:any = { maxOutputTokens: Math.max(maxTokens, 2048), responseMimeType:"application/json" };
        // thinkingBudget:0 disables 2.5-series "thinking", which otherwise eats the whole output-token
        // budget and returns empty text. But not every model accepts the field — the ones that don't reply
        // 400 INVALID_ARGUMENT rather than ignoring it, so it can only ever be an attempt, never a given.
        if (thinking) gc.thinkingConfig = { thinkingBudget: 0 };
        return JSON.stringify({ system_instruction:{ parts:[{ text: systemPrompt }] }, contents:[{ role:"user", parts }], generationConfig: gc });
      };
      // v202: report EVERY attempt, not just the last one. With only the final error visible, a ladder that
      // died on "quota exceeded" at the first model looked identical to one where all six are retired —
      // and telling those apart is the whole diagnosis. The trail is short: "model:status, model:status".
      const trail:string[] = [];
      let lastErr = "";
      for (const mdl of candidates){
        // Try with the thinking switch, then without it. An empty answer is also a failure worth retrying:
        // a thinking model that swallowed the budget returns 200 with no text at all.
        for (const thinking of [true, false]){
          const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(mdl)+":generateContent?key="+encodeURIComponent(key), { method:"POST", headers:{ "Content-Type":"application/json" }, body: gemBody(mdl, thinking) });
          const out = await r.json();
          if (r.ok){
            const txt = (out.candidates && out.candidates[0] && out.candidates[0].content && out.candidates[0].content.parts && out.candidates[0].content.parts[0] && out.candidates[0].content.parts[0].text) || "";
            if (txt) return { ok:true, text: txt, model: mdl };
            lastErr = "Gemini 200 but empty ("+mdl+(thinking?", thinking off":", thinking default")+")";
            trail.push(mdl+":empty");
            continue;
          }
          lastErr = "Gemini "+r.status+" ("+mdl+"): "+JSON.stringify(out.error||out).slice(0,160);
          trail.push(mdl+":"+r.status);
          // 401/403 is the key itself — no other model will help, so stop. Everything else (400 bad
          // argument, 404 unknown model, 429 quota, 5xx) is specific to this attempt: move on.
          if (r.status === 401 || r.status === 403) return { ok:false, error: "["+trail.join(" ")+"] "+lastErr };
          if (r.status !== 400) break;   // not an argument problem → retrying without thinking won't help
        }
      }
      return { ok:false, error: "["+trail.join(" ")+"] "+(lastErr || "Gemini: no available model") };
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
export let __docaiTok: any = null;
export function b64urlJson(obj: any){ return btoa(JSON.stringify(obj)).replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_"); }
export async function docaiAccessToken(){
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
export async function callDocAI(b64: string, mime: string, kind: string){
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
export function docaiEntitiesToText(doc: any){
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

export async function processApEmail(inboxId, route){
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
  } else if (dupHit && (dupLayer === "L2_invoice_no" || (dupLayer === "L3_vendor_total" && parsed.invoice_no && dupHit.number && String(parsed.invoice_no).trim().toLowerCase() === String(dupHit.number).trim().toLowerCase()))){
    // CERTAIN duplicate: same invoice number already recorded (directly, or the L3 hit carries the same number).
    decision = "duplicate_rejected";
    reasoning = "Duplicate (same invoice number already recorded): " + (dupHit.number||dupHit.invoice_id||"") + " [" + (dupHit.status||"") + (dupHit.inv_date?(", "+dupHit.inv_date):"") + ", total " + (dupHit.total!=null?dupHit.total:"?") + "]";
    issues.push("Duplicate — same invoice number already recorded.");
  } else if (dupHit){
    // HEURISTIC duplicate (L3 vendor+amount / L4 claimant+amount+date): a monthly recurring bill with a fixed
    // amount (rent, subscriptions) legitimately matches last month's — never auto-reject + auto-reply on a
    // heuristic. Gate to needs_review so a human confirms.
    const dupWhat = dupLayer === "L4_reimbursement" ? "same claimant + amount + date already claimed"
                  : "same vendor + amount within the dedup window";
    decision = "needs_review";
    reasoning = "Possible duplicate (" + (dupLayer||"L3") + " — " + dupWhat + "): " + (dupHit.number||dupHit.invoice_id||"") + " [" + (dupHit.status||"") + (dupHit.inv_date?(", "+dupHit.inv_date):"") + ", total " + (dupHit.total!=null?dupHit.total:"?") + "] — could be a recurring bill; confirm before posting.";
    issues.push("Possible duplicate — " + dupWhat + ". Confirm it is not a recurring bill before posting.");
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

export async function logDecision(inboxId, decision, reasoning, dupOf, ruleVersions){
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
export function apXeroTypeGate(verdict){
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
export function buildAuditPdf(titleLines){
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

// Build a compliant SELF-BILLED INVOICE PDF (uppercase English, MY tax/audit format) to attach to the Xero bill.
export function buildSelfBilledInvoicePdf(v: any){
  const U = (s: any)=> String(s==null?"":s).toUpperCase();
  const money = (x: any)=> "RM " + (Number(x)||0).toFixed(2);
  const items = Array.isArray(v.line_items) ? v.line_items : [];
  const rows: string[] = [];
  rows.push("SELF-BILLED INVOICE");
  rows.push("(ISSUED BY THE BUYER ON BEHALF OF THE PAYEE — MALAYSIA E-INVOICE)");
  rows.push("");
  rows.push("INVOICE NO:   " + U(v.invoice_no || ("SB-" + v.id)));
  rows.push("INVOICE DATE: " + U(v.invoice_date || "-") + "        DUE DATE: " + U(v.due_date || "-"));
  rows.push("CLASSIFICATION: " + U(v.classification_code || "-") + "     PAYMENT TYPE: " + U(v.payment_type || "-"));
  rows.push("");
  rows.push("BUYER (COMPANY — THE PAYER)");
  rows.push("  NAME:    " + U(v.buyer_name));
  rows.push("  SSM NO:  " + U(v.buyer_ssm || "-") + "     TIN: " + U(v.buyer_tin || "-") + "     SST: " + U(v.buyer_sst || "-"));
  rows.push("  ADDRESS: " + U(v.buyer_address || "-"));
  rows.push("");
  rows.push("PAYEE (INDIVIDUAL — THE SUPPLIER)");
  rows.push("  NAME:    " + U(v.payee_name));
  rows.push("  ID/PASSPORT: " + U((v.payee_id_type ? (v.payee_id_type + " ") : "") + (v.payee_id_no || "-")) + "     TIN: " + U(v.payee_tin || "-"));
  rows.push("  ADDRESS: " + U(v.payee_address || "-"));
  rows.push("");
  rows.push("DESCRIPTION" + " ".repeat(46) + "QTY   UNIT       AMOUNT");
  rows.push("-".repeat(84));
  if (items.length){
    for (const l of items){
      const desc = U(l.description || ("PAYMENT TO " + v.payee_name)).slice(0, 44);
      const qty = String(Number(l.qty) || 1);
      const up = (Number(l.unit_price) || 0).toFixed(2);
      const amt = (Number(l.amount) || 0).toFixed(2);
      rows.push(desc.padEnd(46) + qty.padStart(3) + "  " + up.padStart(9) + "  " + amt.padStart(11));
    }
  } else {
    rows.push(U("PAYMENT TO " + v.payee_name).slice(0,44).padEnd(46) + "  1  " + (Number(v.gross_amount)||0).toFixed(2).padStart(9) + "  " + (Number(v.gross_amount)||0).toFixed(2).padStart(11));
  }
  rows.push("-".repeat(84));
  rows.push("GROSS AMOUNT:".padEnd(66) + money(v.gross_amount).padStart(18));
  if (Number(v.wht_amount) > 0){
    rows.push(("LESS: WITHHOLDING TAX " + (v.wht_rate || 0) + "% (TO REMIT TO LHDN):").padEnd(66) + ("- " + money(v.wht_amount)).padStart(18));
  }
  rows.push("NET PAYABLE:".padEnd(66) + money(v.net_payable).padStart(18));
  rows.push("");
  rows.push("PAYMENT DETAILS (BANK)");
  rows.push("  BANK:    " + U(v.payee_bank_name || "-"));
  rows.push("  HOLDER:  " + U(v.payee_bank_holder || v.payee_name || "-"));
  rows.push("  ACCOUNT: " + U(v.payee_bank_account || "-"));
  rows.push("");
  rows.push("DECLARATION");
  rows.push("  THIS IS A SELF-BILLED INVOICE ISSUED BY THE BUYER ON BEHALF OF THE PAYEE.");
  if (Number(v.wht_amount) > 0) rows.push("  WITHHOLDING TAX SHOWN ABOVE IS RETAINED BY THE BUYER AND REMITTED TO LHDN.");
  rows.push("  E-INVOICE SUBMISSION TO IRBM IS HANDLED VIA XERO ONCE THIS BILL IS PROCESSED.");
  rows.push("");
  rows.push("GENERATED BY CTG FINANCE PORTAL · " + new Date(Date.now()+8*3600*1000).toISOString().slice(0,19).replace("T"," ") + " MYT");
  return buildAuditPdf(rows);
}

export async function apAutoPostBill(inboxId, item, verdict, lines){
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
export async function apAutoReply(inboxId, item, subject, body, route){
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

export async function getStatus(inboxId){
  const { data } = await sb.from("portal_ap_inbox").select("status").eq("id", inboxId).single();
  return data ? data.status : null;
}

export async function applyInvoiceBatch(tenant_id, arr){
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
export async function runBackfill(access, list, opts){
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
      // v145 (B10): pageSize=1000 (was default 100) and MAX_PAGES=100 → 100k ceiling. Crucially, if we exit
      // by hitting the page bound (not by a short/empty page), the fetch is INCOMPLETE — treat that as an
      // error so last_full_sync_at is NOT advanced past pages we never read (UpdatedDateUTC ASC means the
      // dropped rows are the most recently modified — exactly the ones that matter).
      const MAX_PAGES = 100, PAGE_SIZE = 1000;
      let complete = false;
      for (let page=1; page<=MAX_PAGES; page++){
        let d;
        try { d = await xeroGet(access, t.tenant_id, "Invoices?pageSize=" + PAGE_SIZE + "&page=" + page + "&order=UpdatedDateUTC%20ASC", { "If-Modified-Since": sinceHeader }); }
        catch (e) { tErr = String(e); break; }
        if (d.__notModified) { complete = true; break; }
        const arr = d.Invoices || []; if (!arr.length) { complete = true; break; }
        fetched += arr.length;
        const r = await applyInvoiceBatch(t.tenant_id, arr);
        upserted += r.upserted; deleted += r.deleted; tCount += r.upserted; tDel += r.deleted;
        // Per-batch upsert/delete failures used to be swallowed silently — surface them now.
        if (r.error){ tErr = (tErr ? tErr + " | " : "") + "batch p" + page + ": " + r.error; }
        if (arr.length < PAGE_SIZE) { complete = true; break; }
      }
      if (!tErr && !complete) tErr = "incomplete: hit " + MAX_PAGES + "-page ceiling (" + (MAX_PAGES*PAGE_SIZE) + " invoices) — watermark held so the rest is refetched next run";
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
export async function runDelta(access, list, sinceISO){
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
export async function processPending(limit){ return processPendingDedup(limit); }
// v71 (watchdog): send an operator alert via Gmail SMTP. Recipient = portal_secrets 'alert_email'
// if set, else the finance mailbox itself. Best-effort — never throws.
export async function sendAlertEmail(subject, body){
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
// v146: general one-off email to an arbitrary recipient (login credentials etc). Reuses the same
// Gmail SMTP as the watchdog. Best-effort — returns {ok,error}, never throws, so a bulk caller can
// report per-recipient success without one failure aborting the batch.
export async function sendEmailTo(to, subject, body, fromName){
  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!gmailUser || !gmailPass) return { ok:false, error:"no gmail creds (set GMAIL_USER + GMAIL_APP_PASSWORD edge secrets)" };
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to))) return { ok:false, error:"invalid recipient" };
  let smtpClient: any = null;
  try {
    const { SMTPClient } = await import("https://deno.land/x/denomailer@1.6.0/mod.ts");
    smtpClient = new SMTPClient({ connection:{ hostname:"smtp.gmail.com", port:465, tls:true, auth:{ username: gmailUser, password: gmailPass } } });
    await smtpClient.send({ from: (fromName||"CTG HR OS") + " <" + gmailUser + ">", to, subject, content: body });
    return { ok:true, to };
  } catch(e){ return { ok:false, error:String(e).slice(0,300) }; }
  finally { if (smtpClient){ try { await smtpClient.close(); } catch(_e){} } }
}
export async function handleWebhook(req, sig){
  const key = await getWebhookKey();
  const raw = await req.text();
  if (!key) return new Response("webhook key not configured", { status: 500 });
  let expected; try { expected = await hmacSha256B64(key, raw); } catch (_e) { return new Response("err", { status: 500 }); }
  if (!timingSafeEqual(expected, sig)) return new Response("unauthorized", { status: 401 });
  let payload; try { payload = JSON.parse(raw || "{}"); } catch { payload = {}; }
  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length){
    const rows = events.map((e)=>({ tenant_id:e.tenantId||null, event_category:e.eventCategory||null, event_type:e.eventType||null, resource_id:e.resourceId||null, resource_url:e.resourceUrl||null, event_date:e.eventDateUtc||null, raw:e }));
    // v144 (H3): the insert used to be swallowed, then we ACK'd 200 regardless — a failed insert
    // meant Xero considered the event delivered and NEVER redelivered it, so the payment/invoice
    // change was lost for good. Now: if durable persistence fails, return 500 so Xero retries
    // (Xero redelivers on any non-2xx). supabase-js returns { error } rather than throwing.
    let inserted:any[] = [];
    try {
      const { data, error } = await sb.from("xero_webhook_events").insert(rows).select("id");
      if (error) { try { console.error("webhook insert failed:", error.message); } catch(_){} return new Response("persist failed", { status: 500 }); }
      inserted = data || [];
    } catch (e) { try { console.error("webhook insert threw:", e); } catch(_){} return new Response("persist failed", { status: 500 }); }
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
export async function runDriftCheck(access, tenant_id, opts){
  opts = opts || {};
  const blocked = await isRateLimited(tenant_id);
  if (blocked) return { tenant_id, skipped: true, rate_limited_until: blocked };
  // 1. Fetch every open invoice from Xero (ID + Status), both types.
  const xeroOpen = new Map(); // invoice_id -> { id, status, type }
  let xeroSeen = 0;
  // v145 (B10): pageSize=1000 (was 100) → 100k ceiling. If EITHER type exits via the page bound the
  // xeroOpen set is incomplete, which would make valid cache rows look like "extras" — skip the
  // extra-pruning in that case so we never burn the 50-cap re-querying invoices that are actually fine.
  let xeroComplete = true;
  const MAX_PAGES = 100, PAGE_SIZE = 1000;
  try {
    for (const ty of ["ACCREC","ACCPAY"]){
      let tyComplete = false;
      for (let page=1; page<=MAX_PAGES; page++){
        const d = await xeroGet(access, tenant_id, "Invoices?Statuses=AUTHORISED,SUBMITTED&pageSize=" + PAGE_SIZE + "&page=" + page + "&where=" + encodeURIComponent('Type=="' + ty + '"'));
        const arr = d.Invoices || []; if (!arr.length) { tyComplete = true; break; }
        for (const iv of arr){ xeroOpen.set(iv.InvoiceID, { id: iv.InvoiceID, status: iv.Status, type: iv.Type, full: iv }); }
        xeroSeen += arr.length;
        if (arr.length < PAGE_SIZE) { tyComplete = true; break; }
      }
      if (!tyComplete) xeroComplete = false;
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
  // Only prune extras when the Xero snapshot was COMPLETE — otherwise a valid open invoice on an
  // unfetched page looks like an extra and would waste the 50-cap (and the drift count is meaningless).
  if (extra.length && !opts.skipExtraRepair && xeroComplete){
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
