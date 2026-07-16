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
function hrViewer(me){ return me && me.ok && me.user && me.user.role==="viewer"; }        // read-only HR access
function hrManage(me){ return superAdmin(me) || (me && me.ok && me.user && me.user.role==="hr_admin"); } // full HR write (admin or hr_admin), NO finance
function hrCanView(me){ return hrManage(me) || hrViewer(me); }                            // may READ hr data (admin / hr_admin / viewer)
// HR actions a read-only Viewer is allowed to call; every other hr_/attendance_/clock_ action is blocked for viewers.
const HR_VIEWER_READS = new Set(["hr_companies","hr_bootstrap","hr_banks_list","attendance_list","hr_dashboard","hr_payroll_data","hr_leave_admin","hr_leave_pending","hr_leave_flow_get","hr_rc_config","hr_rc_list","hr_rc_get","hr_rc_dashboard","hr_annual","hr_calc_history","sbi_accounts"]);
// HR-only roles have NO Finance Portal access; every action outside this set is blocked for them.
const HR_ONLY_ROLES = new Set(["employee","viewer","hr_admin"]);
function isHrNamespace(a){ return a.indexOf("hr_")===0 || a.indexOf("attendance_")===0 || a.indexOf("clock_")===0 || a==="sbi_accounts"; }
const AUTH_BASIC_ACTIONS = new Set(["me","login","logout","__ping__","totp_setup","totp_verify","totp_disable","totp_status"]);
async function logAudit(me, action, ref, detail){ try{ await sb.from("portal_audit").insert({ user_id:(me&&me.user&&me.user.id)||null, user_email:(me&&me.user&&me.user.email)||null, action:action, ref:String(ref||""), detail:detail||{} }); }catch(_e){} }
async function allowedTenants(token){ try{ const { data } = await sb.rpc("portal_allowed_tenants", { p_token: token||"" }); return Array.isArray(data) ? data : []; } catch (_e) { return []; } }
// Tenant pin for by-id actions (v103): the central guard only sees b.tenant in the request body, so an
// action that takes only an id could act on another company's record. Call with the FETCHED record's
// tenant_id; returns false when the caller's allowed list doesn't include it. Apply on admin paths —
// employee self-service flows are already record-pinned by their own ownership/approver checks.
async function tenantPinned(token, tenantId){
  if(!tenantId) return true;
  const allowed = await allowedTenants(token);
  return allowed.indexOf(String(tenantId)) >= 0;
}
async function denyTenant(me, action, tenant){ await logAudit(me, "tenant_access_denied", String(tenant||""), { action }); return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }

// ===== Reimbursement / Claim engine helpers =====
function rcStatusForRole(role){ return role==="manager"?"Pending Manager Approval":role==="hr"?"Pending HR Approval":role==="finance"?"Pending Finance Approval":role==="director"?"Pending Director Approval":"Submitted"; }
async function rcAuditLog(claimId, action, me, fromS, toS, detail){ try{ await sb.from("hr_claim_audit_logs").insert({ claim_id:claimId, action, actor_id:(me&&me.user&&me.user.id)||null, actor_name:(me&&me.user&&me.user.email)||null, from_status:fromS||null, to_status:toS||null, details:detail||{} }); }catch(_e){} }
async function rcMatchWorkflow(tenant, claim){
  const { data: wfs } = await sb.from("hr_approval_workflows").select("*").eq("active",true).order("priority",{ascending:false});
  const amt = Number(claim.amount)||0;
  for(const w of (wfs||[])){
    if(w.tenant_id!=null && w.tenant_id!==tenant) continue;
    if(w.min_amount!=null && amt < Number(w.min_amount)) continue;
    if(w.max_amount!=null && amt > Number(w.max_amount)) continue;
    if(w.match_department && String(w.match_department)!==String(claim.department||"")) continue;
    if(w.match_claim_type_id && String(w.match_claim_type_id)!==String(claim.claim_type_id||"")) continue;
    if(w.match_project && String(w.match_project)!==String(claim.project||"")) continue;
    return w;
  }
  return null;
}
// Validation engine (spec §10). Returns { errors, warnings }: errors BLOCK submission; warnings submit but surface to the approver.
async function rcValidate(claim, type, empId){
  const warns:string[]=[]; const errs:string[]=[]; const amt=Number(claim.amount)||0;
  try {
    const { data: vItems } = await sb.from("hr_claim_items").select("amount,total_km,mileage_rate,parking_amount,toll_amount,receipt_no,invoice_no,vendor_name,item_date,gl_account,cost_center, hr_claim_types(name,is_mileage,requires_receipt,max_amount_per_claim,gl_account)").eq("claim_id",claim.id);
    const { count: attCount } = await sb.from("hr_claim_attachments").select("id",{count:"exact",head:true}).eq("claim_id",claim.id);
    if(vItems && vItems.length){
      let needReceipt=false; const missGL:string[]=[]; let missCC=false;
      for(const it of vItems){ const t:any=it.hr_claim_types||{}; if(t.requires_receipt) needReceipt=true;
        const ia = t.is_mileage ? Math.round(((Number(it.total_km)||0)*(Number(it.mileage_rate)||0)+(Number(it.parking_amount)||0)+(Number(it.toll_amount)||0))*100)/100 : (Number(it.amount)||0);
        if(t.max_amount_per_claim!=null && ia > Number(t.max_amount_per_claim)) warns.push((t.name||"Item")+" RM"+ia.toFixed(2)+" exceeds its per-claim limit RM"+Number(t.max_amount_per_claim).toFixed(2)+".");
        if(!String(it.gl_account||t.gl_account||"").trim() && missGL.indexOf(t.name||"item")<0) missGL.push(t.name||"item");
        if(!String(it.cost_center||claim.cost_center||"").trim()) missCC=true;
      }
      if(needReceipt && !attCount) errs.push("A receipt is required for at least one expense line — attach it before submitting.");
      if(missGL.length) warns.push("No GL account set for: "+missGL.join(", ")+" (Finance must set it before posting to Xero).");
      if(missCC) warns.push("Cost center is empty on some lines.");
      // BLOCK on duplicate receipt_no / invoice_no already used by another active claim (spec §10).
      const rnos=vItems.map((x:any)=>String(x.receipt_no||"").trim()).filter(Boolean);
      const inos=vItems.map((x:any)=>String(x.invoice_no||"").trim()).filter(Boolean);
      const dupNo=async(col:string,vals:string[])=>{
        if(!vals.length) return null;
        const { data: hits } = await sb.from("hr_claim_items").select(col+",claim_id, hr_claim_requests(claim_no,status)").in(col,vals).neq("claim_id",claim.id).limit(20);
        const live=(hits||[]).find((h:any)=>h.hr_claim_requests && ["Cancelled","Rejected"].indexOf(h.hr_claim_requests.status)<0);
        return live?{ no:live[col], claim_no:(live.hr_claim_requests&&live.hr_claim_requests.claim_no)||"another claim" }:null;
      };
      const dr=await dupNo("receipt_no",rnos); if(dr) errs.push("Receipt no. \""+dr.no+"\" was already claimed on "+dr.claim_no+".");
      const di=await dupNo("invoice_no",inos); if(di) errs.push("Invoice no. \""+di.no+"\" was already claimed on "+di.claim_no+".");
      // duplicate date+amount+vendor across other claims' items → warning
      for(const it of vItems.slice(0,20)){
        if(!it.vendor_name || !it.item_date) continue;
        const { data: dv } = await sb.from("hr_claim_items").select("claim_id, hr_claim_requests(claim_no,status,employee_id)").eq("item_date",it.item_date).eq("amount",it.amount).eq("vendor_name",it.vendor_name).neq("claim_id",claim.id).limit(5);
        const hit=(dv||[]).find((h:any)=>h.hr_claim_requests && ["Cancelled","Rejected"].indexOf(h.hr_claim_requests.status)<0 && h.hr_claim_requests.employee_id===empId);
        if(hit){ warns.push("Possible duplicate line: same date + amount + vendor ("+it.vendor_name+") as "+((hit.hr_claim_requests&&hit.hr_claim_requests.claim_no)||"another claim")+"."); break; }
      }
    } else {
      if(type && type.requires_receipt && !attCount) errs.push("Receipt required for "+type.name+" but none attached.");
      if(type && type.max_amount_per_claim!=null && amt > Number(type.max_amount_per_claim)) warns.push("Amount RM"+amt.toFixed(2)+" exceeds the per-claim limit RM"+Number(type.max_amount_per_claim).toFixed(2)+".");
    }
    if(type && type.max_amount_per_month!=null && claim.claim_date && empId){
      const mo=String(claim.claim_date).slice(0,7);
      const { data: same } = await sb.from("hr_claim_requests").select("amount,claim_date,id").eq("employee_id",empId).eq("claim_type_id",claim.claim_type_id).neq("status","Cancelled").neq("status","Rejected");
      let s=0; (same||[]).forEach(r=>{ if(String(r.claim_date||"").slice(0,7)===mo && r.id!==claim.id) s+=Number(r.amount)||0; });
      if(s+amt > Number(type.max_amount_per_month)) warns.push("Monthly total RM"+(s+amt).toFixed(2)+" would exceed the "+type.name+" monthly limit RM"+Number(type.max_amount_per_month).toFixed(2)+".");
    }
    if(empId && claim.claim_date){
      const { data: dup } = await sb.from("hr_claim_requests").select("id,claim_no").eq("employee_id",empId).eq("claim_date",claim.claim_date).eq("amount",amt).neq("id",claim.id).neq("status","Cancelled").neq("status","Rejected").limit(1);
      if(dup&&dup.length) warns.push("Possible duplicate: same date + amount as "+dup[0].claim_no+".");
    }
    const { data: att } = await sb.from("hr_claim_attachments").select("receipt_hash").eq("claim_id",claim.id);
    const hashes=(att||[]).map(a=>a.receipt_hash).filter(Boolean);
    if(hashes.length){ const { data: other } = await sb.from("hr_claim_attachments").select("claim_id").in("receipt_hash",hashes).neq("claim_id",claim.id).limit(1); if(other&&other.length) warns.push("Duplicate receipt — the same file is already attached to another claim."); }
    if(type && type.is_mileage){ const { data: md } = await sb.from("hr_mileage_claim_details").select("*").eq("claim_id",claim.id).maybeSingle(); if(md){ const calc=Math.round(((Number(md.total_km)||0)*(Number(md.mileage_rate)||0)+(Number(md.parking_amount)||0)+(Number(md.toll_amount)||0))*100)/100; if(Math.abs(calc-amt)>0.01) warns.push("Mileage amount RM"+amt.toFixed(2)+" ≠ km×rate + parking + toll (= RM"+calc.toFixed(2)+")."); } }
    const { data: pol } = await sb.from("hr_claim_policy_rules").select("num_value").eq("rule_type","max_age_days").eq("active",true).limit(1);
    const maxAge=(pol&&pol[0]&&Number(pol[0].num_value))||90;
    if(claim.claim_date){ const days=Math.floor((Date.now()-new Date(claim.claim_date).getTime())/86400000); if(days>maxAge) warns.push("Claim date is "+days+" days old (policy limit "+maxAge+" days)."); }
  } catch(_e){}
  return { errors: errs, warnings: warns };
}
async function rcMe(me){
  const isAdmin = hrManage(me); let employee:any=null, roles:string[]=[], is_manager=false;   // admin OR hr_admin = full HR admin
  const uid = me && me.user && me.user.id;
  if(uid){ const { data:e } = await sb.from("hr_employees").select("*").eq("user_id",uid).maybeSingle(); employee=e||null; }
  if(employee){
    const { data:ra } = await sb.from("hr_claim_role_approvers").select("role").eq("employee_id",employee.id);
    const set = new Set<string>(); (ra||[]).forEach((x:any)=>set.add(x.role)); if(employee.claim_role) set.add(employee.claim_role);
    roles = Array.from(set);
    const { count } = await sb.from("hr_employees").select("id",{count:"exact",head:true}).eq("manager_id",employee.id);
    is_manager = !!count;
  }
  return { isAdmin, employee, roles, is_manager };
}
function rcCanActStep(who:any, step:any){ if(!step) return false; if(who.isAdmin) return true; if(!who.employee) return false; if(step.approver_employee_id && step.approver_employee_id===who.employee.id) return true; if(step.approver_role && who.roles.indexOf(step.approver_role)>=0) return true; return false; }
async function rcApproverQueue(tenant:string, who:any){
  const PEND=["Submitted","Pending Manager Approval","Pending HR Approval","Pending Finance Approval","Pending Director Approval","Need More Info"];
  const { data:claims } = await sb.from("hr_claim_requests").select("*, hr_claim_types(name,code,is_mileage), hr_employees(emp_no,name,dept)").eq("tenant_id",tenant).in("status",PEND).order("created_at",{ascending:false}).limit(500);
  const ids=(claims||[]).map((c:any)=>c.id); if(!ids.length) return [];
  const { data:steps } = await sb.from("hr_claim_approval_steps").select("claim_id,step_order,approver_role,approver_employee_id,status").in("claim_id",ids);
  const byClaim:any={}; (steps||[]).forEach((s:any)=>{ (byClaim[s.claim_id]=byClaim[s.claim_id]||{})[s.step_order]=s; });
  return (claims||[]).filter((c:any)=>{ const st=byClaim[c.id]&&byClaim[c.id][c.current_step]; return st && st.status==="Pending" && rcCanActStep(who, st); });
}
// ── Reimbursement email notifications (best-effort; reuse Gmail SMTP / Resend like the AP module). ──
async function rcSendEmail(toEmail:string, subject:string, body:string){
  if(!toEmail || !subject || !body) return false;
  const gmailUser = Deno.env.get("GMAIL_USER"); const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD"); const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromName = "CTG HR OS";
  try {
    if(gmailUser && gmailPass){
      const { SMTPClient } = await import("https://deno.land/x/denomailer@1.6.0/mod.ts");
      const c:any = new SMTPClient({ connection:{ hostname:"smtp.gmail.com", port:465, tls:true, auth:{ username:gmailUser, password:gmailPass } } });
      try { await c.send({ from: fromName+" <"+gmailUser+">", to: toEmail, subject, content: body }); } finally { try{ await c.close(); }catch(_e){} }
      return true;
    } else if(resendKey){
      const r = await fetch("https://api.resend.com/emails", { method:"POST", headers:{ "Authorization":"Bearer "+resendKey, "Content-Type":"application/json" }, body: JSON.stringify({ from: fromName+" <onboarding@resend.dev>", to:[toEmail], subject, text: body }) });
      return r.ok;
    }
  } catch(_e){}
  return false;
}
async function rcEmpEmail(empId:any){ if(!empId) return null; const { data } = await sb.from("hr_employees").select("email,name").eq("id",empId).maybeSingle(); return data; }
function rcMoney(n:any){ return "RM "+(Number(n)||0).toFixed(2); }
async function rcNotifyEmployee(claim:any, subject:string, body:string){ try{ const e=await rcEmpEmail(claim && claim.employee_id); if(e&&e.email) await rcSendEmail(e.email, subject, body); }catch(_e){} }
function rcFnBase(){ return (Deno.env.get("SUPABASE_URL")||"https://cmostxcjtbuhbzfojuid.supabase.co")+"/functions/v1/portal"; }
// ── Leave multi-level approval helpers ──
async function leaveRoleApproverEmails(role:string){ const out:string[]=[]; try{ const { data: ras } = await sb.from("hr_claim_role_approvers").select("employee_id").eq("role",role); for(const ra of (ras||[])){ const e=await rcEmpEmail(ra.employee_id); if(e&&e.email) out.push(e.email); } }catch(_e){} return out; }
async function leaveNotifyStep(reqId:any){ try{
  const { data: req } = await sb.from("hr_leave_requests").select("*").eq("id",reqId).maybeSingle(); if(!req) return;
  const { data: step } = await sb.from("hr_leave_approval_steps").select("*").eq("leave_request_id",reqId).eq("step_order",req.current_step||1).maybeSingle(); if(!step) return;
  const { data: emp } = await sb.from("hr_employees").select("name").eq("id",req.employee_id).maybeSingle();
  const recips:string[]=[];
  if(step.approver_employee_id){ const e=await rcEmpEmail(step.approver_employee_id); if(e&&e.email) recips.push(e.email); }
  else if(step.approver_role){ (await leaveRoleApproverEmails(step.approver_role)).forEach((x)=>recips.push(x)); }
  const seen:any={};
  for(const to of recips){ if(seen[to])continue; seen[to]=1;
    await rcSendEmail(to, "[HR OS] Leave request needs your approval",
      "Hi,\n\n"+((emp&&emp.name)||"An employee")+" requested "+req.leave_type+" leave "+req.date_from+" → "+req.date_to+" ("+req.days+" day(s)).\nReason: "+(req.reason||"—")+"\nApproval step: "+(step.name||step.approver_role)+"\n\nApprove / reject in HR OS → Leave:\n  https://sscctgfinance-cmd.github.io/ctg-finance-portal/hros.html\n\n— CTG HR OS (automated)");
  }
}catch(_e){} }
async function rcNotifyStepApprover(claimId:any){ try{
  const { data: inst } = await sb.from("hr_claim_approval_instances").select("*").eq("claim_id",claimId).maybeSingle(); if(!inst) return;
  const { data: step } = await sb.from("hr_claim_approval_steps").select("*").eq("instance_id",inst.id).eq("step_order",inst.current_step).maybeSingle(); if(!step) return;
  const { data: claim } = await sb.from("hr_claim_requests").select("claim_no,amount, hr_employees(name)").eq("id",claimId).maybeSingle();
  const recips:any[]=[];
  if(step.approver_employee_id){ const e=await rcEmpEmail(step.approver_employee_id); if(e&&e.email) recips.push({ empId:step.approver_employee_id, email:e.email }); }
  else if(step.approver_role){ const { data: ras } = await sb.from("hr_claim_role_approvers").select("employee_id").eq("role",step.approver_role); for(const ra of (ras||[])){ const e=await rcEmpEmail(ra.employee_id); if(e&&e.email) recips.push({ empId:ra.employee_id, email:e.email }); } }
  const nm=(claim&&claim.hr_employees&&claim.hr_employees.name)||"an employee";
  const subj="[HR OS] Reimbursement "+((claim&&claim.claim_no)||"")+" needs your approval";
  const seen:any={};
  for(const r of recips){
    if(seen[r.email]) continue; seen[r.email]=1;
    // Per-recipient one-time action token → approve/reject from the email without logging in.
    let link="";
    try {
      const tok=crypto.randomUUID().replace(/-/g,"")+crypto.randomUUID().replace(/-/g,"");
      const ins=await sb.from("hr_claim_email_actions").insert({ token:tok, claim_id:claimId, step_order:inst.current_step, approver_employee_id:r.empId, approver_email:r.email, expires_at:new Date(Date.now()+14*86400000).toISOString() });
      if(!ins.error) link=rcFnBase()+"?rc="+tok;
    } catch(_e){}
    const body="Hi,\n\nA reimbursement claim is waiting for your approval:\n\n  Claim:    "+((claim&&claim.claim_no)||"")+"\n  Employee: "+nm+"\n  Amount:   "+rcMoney(claim&&claim.amount)+"\n\n"+(link?("Review & approve here (no login needed, link valid 14 days):\n  "+link+"\n\n"):"")+"Or log in to HR OS → Reimbursement → Pending:\n  https://sscctgfinance-cmd.github.io/ctg-finance-portal/hros.html\n\n— CTG HR OS (automated)";
    await rcSendEmail(r.email, subj, body);
  }
}catch(_e){} }
// Resolve an employee id into the {isAdmin:false, employee, roles} shape rcDecideOne/rcCanActStep expect (email-approval identity).
async function rcWhoForEmp(empId:any){
  const { data: employee } = await sb.from("hr_employees").select("*").eq("id",empId).maybeSingle();
  if(!employee) return null;
  const { data: ra } = await sb.from("hr_claim_role_approvers").select("role").eq("employee_id",empId);
  const set=new Set<string>(); (ra||[]).forEach((x:any)=>set.add(x.role)); if(employee.claim_role) set.add(employee.claim_role);
  return { isAdmin:false, employee, roles:Array.from(set), is_manager:false };
}
// GET ?rc=<token> → self-contained approval page (view is idempotent; the decision is a JS POST so mail scanners can't trigger it).
async function rcEmailActionPage(token:string){
  const eh=(s:any)=>String(s==null?"":s).replace(/[&<>"']/g,(c:string)=>(({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"} as any)[c]));
  const page=(title:string,inner:string)=>new Response("<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>"+eh(title)+"</title><style>body{font-family:Segoe UI,system-ui,Arial,sans-serif;background:#0d1420;color:#e8edf5;margin:0;padding:24px;display:flex;justify-content:center}main{max-width:560px;width:100%}.card{background:#141d2e;border:1px solid #24304a;border-radius:12px;padding:20px 22px;margin-bottom:14px}h1{font-size:17px;margin:0 0 4px}.muted{color:#94a3bc;font-size:12.5px}table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px}td,th{padding:6px 8px;border-bottom:1px solid #24304a;text-align:left}th{color:#94a3bc;font-weight:600;font-size:11px;text-transform:uppercase}.amt{text-align:right}.tot{font-weight:700;color:#4ade9b}.btn{border:0;border-radius:8px;padding:10px 18px;font-size:13.5px;font-weight:700;cursor:pointer}.ap{background:#16b97a;color:#04140c}.rj{background:#33202a;color:#ff8f7a;border:1px solid #5a2e33}textarea{width:100%;box-sizing:border-box;background:#0d1420;border:1px solid #24304a;border-radius:8px;color:#e8edf5;padding:8px 10px;font-size:13px;min-height:56px;margin-top:8px}.warn{color:#f5b04b;font-size:12px}.ok{color:#4ade9b}.err{color:#ff8f7a}</style></head><body><main>"+inner+"</main></body></html>",{status:200,headers:{"Content-Type":"text/html; charset=utf-8"}});
  const { data: row } = await sb.from("hr_claim_email_actions").select("*").eq("token",String(token||"")).maybeSingle();
  if(!row) return page("Invalid link","<div class='card'><h1>Link not valid</h1><div class='muted'>This approval link doesn’t exist. It may have been revoked.</div></div>");
  if(row.used_at) return page("Already used","<div class='card'><h1>Already actioned ✓</h1><div class='muted'>You already responded to this claim from this link.</div></div>");
  if(new Date(row.expires_at).getTime()<Date.now()) return page("Expired","<div class='card'><h1>Link expired</h1><div class='muted'>This link was valid for 14 days. Please act on the claim in HR OS instead.</div></div>");
  const { data: c } = await sb.from("hr_claim_requests").select("*, hr_employees(emp_no,name,dept), hr_claim_types(name)").eq("id",row.claim_id).maybeSingle();
  if(!c) return page("Not found","<div class='card'><h1>Claim not found</h1></div>");
  const PENDING=["Submitted","Pending Manager Approval","Pending HR Approval","Pending Finance Approval","Pending Director Approval"];
  if(PENDING.indexOf(c.status)<0 || Number(c.current_step)!==Number(row.step_order))
    return page("Already handled","<div class='card'><h1>Already handled</h1><div class='muted'>This claim has moved on — current status: <b>"+eh(c.status)+"</b>. Nothing left for you to do here.</div></div>");
  const { data: items } = await sb.from("hr_claim_items").select("*, hr_claim_types(name,is_mileage)").eq("claim_id",row.claim_id).order("item_date");
  const rowsHtml=(items||[]).map((it:any)=>{ const t=it.hr_claim_types||{}; const km=t.is_mileage?(" · "+(it.total_km||0)+"km"):""; return "<tr><td>"+eh(t.name||"—")+"</td><td class='muted'>"+eh(String(it.item_date||"").slice(0,10))+"</td><td>"+eh(it.description||"")+km+(it.vendor_name?("<div class='muted'>"+eh(it.vendor_name)+"</div>"):"")+"</td><td class='amt'>"+(Number(it.amount)||0).toFixed(2)+"</td></tr>"; }).join("");
  const warns=Array.isArray(c.warnings)&&c.warnings.length?("<div class='card'><div class='warn'>⚠ "+c.warnings.map((w:string)=>eh(w)).join("<br>⚠ ")+"</div></div>"):"";
  const emp=c.hr_employees||{};
  const inner="<div class='card'><h1>Reimbursement approval — "+eh(c.claim_no)+"</h1><div class='muted'>"+eh(emp.name||"")+" ("+eh(emp.emp_no||"")+") · "+eh(emp.dept||c.department||"—")+" · "+eh(c.claim_date||"")+"</div><div class='muted' style='margin-top:2px'>"+eh(c.description||"")+"</div>"+
    "<table><thead><tr><th>Type</th><th>Date</th><th>Description</th><th class='amt'>RM</th></tr></thead><tbody>"+rowsHtml+"<tr><td colspan='3' class='amt' style='font-weight:700'>Total</td><td class='amt tot'>"+(Number(c.amount)||0).toFixed(2)+"</td></tr></tbody></table></div>"+warns+
    "<div class='card'><div class='muted' style='margin-bottom:8px'>Acting as <b>"+eh(row.approver_email||"approver")+"</b> · step "+eh(row.step_order)+" ("+eh(c.status)+")</div>"+
    "<textarea id='cm' placeholder='Comment (optional for approve, REQUIRED for reject)'></textarea>"+
    "<div style='display:flex;gap:10px;margin-top:12px'><button class='btn ap' onclick='act(\"approve\")'>✓ Approve</button><button class='btn rj' onclick='act(\"reject\")'>✕ Reject</button></div>"+
    "<div id='out' style='margin-top:12px;font-size:13.5px'></div></div>"+
    "<script>async function act(d){var cm=document.getElementById('cm').value||'';if(d==='reject'&&!cm.trim()){document.getElementById('out').innerHTML=\"<span class='err'>A reason is required to reject.</span>\";return;}var o=document.getElementById('out');o.textContent='Working…';try{var r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api:'hr_rc_email_action',rc_token:'"+eh(row.token)+"',do:d,comment:cm})});var x=await r.json();o.innerHTML=x.ok?(\"<span class='ok'>✓ Done — claim is now: <b>\"+(x.status||'')+\"</b>. You can close this page.</span>\"):(\"<span class='err'>\"+(x.error||'Failed')+\"</span>\");if(x.ok){document.querySelectorAll('.btn').forEach(function(b){b.disabled=true;b.style.opacity=.4;});}}catch(e){o.innerHTML=\"<span class='err'>Network error — try again.</span>\";}}</script>";
  return page("Approve "+c.claim_no, inner);
}
// ── Factored single-claim decision (used by hr_rc_decide + hr_rc_decide_bulk). Returns {ok,status,error,claim,advanced,final}. ──
async function rcDecideOne(who:any, me:any, id:any, decision:string, comment:string, overrideAmount:any, overrideReason:string, pinTenants:any=null){
  const { data: claim } = await sb.from("hr_claim_requests").select("*").eq("id",id).maybeSingle();
  if(!claim) return { ok:false, error:"claim not found" };
  // Tenant pin (v103): an admin restricted to company A must not decide company B's claims by id.
  // pinTenants is the caller's allowed list (null = caller isn't an admin / path is token-scoped).
  if(Array.isArray(pinTenants) && claim.tenant_id && pinTenants.indexOf(String(claim.tenant_id))<0)
    return { ok:false, error:"You do not have access to this company's claims.", forbidden:true };
  // Status gate: only actionable claims can be decided. Without this, a stale bulk-approve list could
  // regress a Paid claim back to Approved (re-enabling a second payment) or reject an already-paid claim.
  const RC_ACTIONABLE=["Submitted","Pending Manager Approval","Pending HR Approval","Pending Finance Approval","Pending Director Approval","Need More Info"];
  if(RC_ACTIONABLE.indexOf(claim.status)<0) return { ok:false, error:"Already handled — claim is now "+claim.status+"." };
  const { data: inst } = await sb.from("hr_claim_approval_instances").select("*").eq("claim_id",id).maybeSingle();
  if(!inst) return { ok:false, error:"no approval in progress" };
  const { data: step } = await sb.from("hr_claim_approval_steps").select("*").eq("instance_id",inst.id).eq("step_order",inst.current_step).maybeSingle();
  if(!rcCanActStep(who, step)) return { ok:false, error:"You are not the approver for this step.", forbidden:true };
  const fromS=claim.status; const actor=(me.user&&me.user.id)||null; const aname=(me.user&&me.user.email)||null; const nowIso=new Date().toISOString();
  if(decision==="reject"){
    if(!String(comment||"").trim()) return { ok:false, error:"a rejection reason is required" };
    if(step) await sb.from("hr_claim_approval_steps").update({status:"Rejected",decision:"reject",comment,acted_by:actor,acted_at:nowIso}).eq("id",step.id);
    await sb.from("hr_claim_approval_instances").update({status:"rejected"}).eq("id",inst.id);
    await sb.from("hr_claim_requests").update({status:"Rejected",decided_at:nowIso}).eq("id",id);
    await sb.from("hr_claim_comments").insert({claim_id:id,author_id:actor,author_name:aname,comment,kind:"comment"});
    await rcAuditLog(id,"reject",me,fromS,"Rejected",{comment});
    return { ok:true, status:"Rejected", claim };
  }
  if(decision==="request_info"){
    if(!String(comment||"").trim()) return { ok:false, error:"a message to the employee is required" };
    if(step) await sb.from("hr_claim_approval_steps").update({status:"Info Requested",comment,acted_by:actor,acted_at:nowIso}).eq("id",step.id);
    await sb.from("hr_claim_requests").update({status:"Need More Info"}).eq("id",id);
    await sb.from("hr_claim_comments").insert({claim_id:id,author_id:actor,author_name:aname,comment,kind:"info_request"});
    await rcAuditLog(id,"request_info",me,fromS,"Need More Info",{comment});
    return { ok:true, status:"Need More Info", claim, comment };
  }
  const override = (overrideAmount!=null && overrideAmount!=="") ? Number(overrideAmount) : null;
  if(override!=null){ if(!String(overrideReason||"").trim()) return { ok:false, error:"a reason is required to override the amount" }; await sb.from("hr_claim_requests").update({amount:override, override_amount:override, override_reason:overrideReason}).eq("id",id); await rcAuditLog(id,"override",me,fromS,fromS,{from:claim.amount,to:override,reason:overrideReason}); claim.amount=override; }
  if(step) await sb.from("hr_claim_approval_steps").update({status:"Approved",decision:"approve",comment,acted_by:actor,acted_at:nowIso}).eq("id",step.id);
  const { data: allSteps } = await sb.from("hr_claim_approval_steps").select("*").eq("instance_id",inst.id).order("step_order");
  const next=(allSteps||[]).find((s:any)=>s.step_order>inst.current_step);
  if(next){
    await sb.from("hr_claim_approval_instances").update({current_step:next.step_order}).eq("id",inst.id);
    const st=rcStatusForRole(next.approver_role);
    await sb.from("hr_claim_requests").update({status:st,current_step:next.step_order}).eq("id",id);
    await rcAuditLog(id,"approve",me,fromS,st,{step:step&&step.name});
    return { ok:true, status:st, advanced:true, claim };
  }
  await sb.from("hr_claim_approval_instances").update({status:"approved"}).eq("id",inst.id);
  await sb.from("hr_claim_requests").update({status:"Approved",decided_at:nowIso}).eq("id",id);
  await rcAuditLog(id,"approve",me,fromS,"Approved",{step:step&&step.name});
  return { ok:true, status:"Approved", final:true, claim };
}
async function rcNotifyDecision(res:any){ try{
  const c=res && res.claim; if(!c) return;
  if(res.advanced){ await rcNotifyStepApprover(c.id); return; }
  if(res.status==="Approved") await rcNotifyEmployee(c, "[HR OS] Your reimbursement "+(c.claim_no||"")+" is approved", "Good news — your reimbursement claim "+(c.claim_no||"")+" ("+rcMoney(c.amount)+") has been fully approved and is now with Finance for payment.\n\n— CTG HR OS (automated)");
  else if(res.status==="Rejected") await rcNotifyEmployee(c, "[HR OS] Your reimbursement "+(c.claim_no||"")+" was rejected", "Your reimbursement claim "+(c.claim_no||"")+" ("+rcMoney(c.amount)+") was rejected.\n\nLog in to HR OS → Reimbursement to see the reason.\n\n— CTG HR OS (automated)");
  else if(res.status==="Need More Info") await rcNotifyEmployee(c, "[HR OS] More info needed on reimbursement "+(c.claim_no||""), "Your reimbursement claim "+(c.claim_no||"")+" needs more information before it can be approved:\n\n  \""+String(res.comment||"").slice(0,500)+"\"\n\nLog in to HR OS → Reimbursement, update it, and resubmit.\n\n— CTG HR OS (automated)");
}catch(_e){} }
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
// ilike special chars must be literal: a vendor named "100% Wellness" must not wildcard-match
// "100 PLUS WELLNESS" — with AP autonomy ON that posts the bill to the wrong supplier contact.
function ilikeEscape(s){ return String(s).replace(/([%_\\])/g, "\\$1"); }
async function resolveContact(tenant, name){ if(!name) return null; const { data } = await sb.from("xero_contacts_cache").select("contact_id,name").eq("tenant_id", tenant).ilike("name", ilikeEscape(String(name).trim())).limit(1); return (data && data.length) ? data[0].contact_id : null; }
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

// Build a compliant SELF-BILLED INVOICE PDF (uppercase English, MY tax/audit format) to attach to the Xero bill.
function buildSelfBilledInvoicePdf(v: any){
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
    if (qp.get("rc")) return await rcEmailActionPage(qp.get("rc") as string);
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
  // ── Central tenant-isolation guard (v95): ANY tenant-scoped call must target a company on the
  // caller's allowed list. Admins with a partial company assignment are restricted to it (see
  // portal_allowed_tenants). Invalid tokens yield an empty list here and fall through to each
  // action's own auth (which 401s), so this never masks the real error.
  if (typeof b.token === "string" && b.token && typeof b.tenant === "string" && b.tenant) {
    try {
      const _allowed = await allowedTenants(b.token);
      if (Array.isArray(_allowed) && _allowed.length && _allowed.indexOf(b.tenant) < 0) {
        const _me = await meFromToken(b.token);
        return await denyTenant(_me, String(api || ""), b.tenant);
      }
    } catch (_e) {}
  }
  try {
    // App separation: HR-only roles (employee / viewer / hr_admin) have NO Finance Portal access — block every non-HR action.
    if (typeof b.token === "string" && b.token && !isHrNamespace(api) && !AUTH_BASIC_ACTIONS.has(api)) {
      const _u = await meFromToken(b.token);
      if (_u && _u.ok && _u.user && HR_ONLY_ROLES.has(_u.user.role)) {
        return j({ ok:false, error:"This login is HR-only — it has no access to the Finance Portal." }, 403);
      }
    }
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
            // Delta runs every 5 min, so >25 min without a delta = ~5 consecutive misses = real problem.
            const deltaMin = t.last_delta_sync_at ? (nowMs - new Date(t.last_delta_sync_at).getTime())/60000 : 99999;
            if (deltaMin > 25) problems.push("Delta sync stalled: " + t.tenant_name + " (last ran " + (t.last_delta_sync_at ? Math.round(deltaMin)+"m ago" : "never") + ")");
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
        // 5-min cadence: only write an audit row when something actually changed (heartbeat below always records the run).
        if (totalUp + totalDel > 0) await sb.from("portal_audit").insert({ action:"cron_delta", ref:"5min", detail:{ upserted:totalUp, deleted:totalDel, per } });
        try { await sb.rpc("portal_cron_heartbeat", { p_name:"cron_delta", p_status:"ok", p_detail:{ upserted:totalUp, deleted:totalDel } }); } catch (_e) {}
      } catch (e) { try { await sb.from("portal_audit").insert({ action:"cron_delta_error", ref:"5min", detail:{ error:String(e) } }); } catch (_e) {} } })();
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
      // Paginated: .limit(5000) still caps at 1000 — contacts past #1000 vanished from the picker and
      // were re-created as DUPLICATE Xero contacts on invoice issue.
      let contacts:any[] = [];
      for (let off=0; off<20000; off+=1000){
        const { data: pg } = await sb.from("xero_contacts_cache").select("contact_id,name,email").eq("tenant_id", b.tenant).order("name").range(off, off+999);
        contacts = contacts.concat(pg||[]); if (!pg || pg.length < 1000) break;
      }
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
      const inv = { Type:"ACCREC", Contact: contact, Date: b.date||new Date(Date.now()+8*3600*1000).toISOString().slice(0,10), Status: b.status||"AUTHORISED", LineAmountTypes: b.line_amount_types||"Exclusive", LineItems: li };
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
      const now = Date.now() + 8*3600*1000; const items = []; const partialTenants:string[]=[];
      for (const t of list) {
        try { const invs = await xeroInvoicesAll(access, t.tenant_id, "ACCREC");
          if ((invs as any).__partial) partialTenants.push(t.tenant_name);
          for (const iv of invs) { const due = Number(iv.AmountDue||0); if (due <= 0) continue; const dd = String(iv.DueDateString || iv.DueDate || "").slice(0,10); const days = dd ? Math.floor((now - new Date(dd).getTime())/86400000) : 0; items.push({ tenant_name:t.tenant_name, contact:(iv.Contact||{}).Name, email:(iv.Contact||{}).EmailAddress, number:iv.InvoiceNumber, amount_due:Math.round(due*100)/100, currency:iv.CurrencyCode||"MYR", due_date:dd, days_overdue:days }); }
        } catch (e) { partialTenants.push(t.tenant_name + " (" + String(e).slice(0,80) + ")"); }
      }
      items.sort((a,b2)=>b2.days_overdue - a.days_overdue);
      return j({ ok:true, count: items.length, total: Math.round(items.reduce((s,x)=>s+x.amount_due,0)*100)/100, items: items.slice(0,1000),
        partial: partialTenants.length>0, partial_tenants: partialTenants,
        warning: partialTenants.length ? ("Xero fetch was INCOMPLETE for: " + partialTenants.join(", ") + " — totals below may be missing invoices (likely rate-limited). Retry later or use the cached AR aging.") : undefined });
    }
    if (api === "cached_receivables") {
      const me = await meFromToken(b.token); if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data, error } = await sb.rpc("portal_ar_aging", { p_token: b.token||"", p_tenant: b.tenant||null, p_bucket: b.bucket||null });
      if (error) return j({ ok:false, error: error.message });
      return j(data || { ok:true, count:0, total:0, buckets:{}, items:[] });
    }
    if (api === "close_list") {
      const me = await meFromToken(b.token); if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const period = String(b.period || new Date(Date.now()+8*3600*1000).toISOString().slice(0,7));
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
      const docs = []; let reconPartial=false;
      for (const ty of ["ACCREC","ACCPAY"]) {
        try { const invs = await xeroInvoicesAll(access, tenant, ty); if((invs as any).__partial) reconPartial=true; for (const iv of invs) { const due = Number(iv.AmountDue||0); if (due>0) docs.push({ kind: ty==="ACCREC"?"AR (money in)":"AP (money out)", amount: Math.round(due*100)/100, contact:(iv.Contact||{}).Name, number: iv.InvoiceNumber, date:(iv.DateString||iv.Date||"").slice(0,10) }); } } catch (_e) { reconPartial=true; }
      }
      const used = {};
      const results = lines.map((l)=>{ const amt = Math.round(Math.abs(Number(l.amount)||0)*100)/100; let match = null; for (let i=0;i<docs.length;i++){ if(used[i]) continue; if(Math.abs(docs[i].amount-amt)<0.01){ match=docs[i]; used[i]=true; break; } } return { date:l.date, amount:l.amount, description:l.description, match }; });
      return j({ ok:true, total: results.length, matched: results.filter(r=>r.match).length, outstanding_docs: docs.length, results,
        partial: reconPartial, warning: reconPartial ? "Xero fetch was INCOMPLETE — unmatched lines may actually have a match (likely rate-limited). Retry later." : undefined });
    }
    if (api === "sr_post_invoices") {
      // Sales Recon → create the Sales Invoices in Xero DIRECTLY (no CSV import step).
      // Safety: Status=DRAFT (operator approves in Xero); ACCREC numbers are unique-enforced by Xero,
      // so a re-post of the same batch reports per-invoice "already existed" instead of duplicating.
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = String(b.tenant||""); if (!tenant) return j({ ok:false, error:"tenant required" });
      const items:any[] = (Array.isArray(b.invoices)? b.invoices : []).slice(0,2000);
      if (!items.length) return j({ ok:false, error:"no invoices" });
      const dISO = (s:any)=>{ const m=String(s||"").match(/^(\d{2})-(\d{2})-(\d{4})$/); return m ? (m[3]+"-"+m[2]+"-"+m[1]) : String(s||""); };
      if (b.dry_run){ return j({ ok:true, dry_run:true, count: items.length, sample: items.slice(0,3).map((it:any)=>({ number:it.number, date:dISO(it.date), amount:it.amount, account:it.account })) }); }
      let access; try { access = await xeroAccessToken(); } catch(e){ return j({ ok:false, error:"Xero auth: "+String(e).slice(0,150) }); }
      // Tax: use the org's "exempt"-named rate when it exists (matches the CSV import's 'Tax Exempt'), else NONE.
      let taxType = "NONE";
      try { const tr = await xeroGet(access, tenant, "TaxRates"); const ex=(tr.TaxRates||[]).find((t:any)=>/exempt/i.test(String(t.Name||"")) && t.Status==="ACTIVE"); if (ex && ex.TaxType) taxType = ex.TaxType; } catch(_e){}
      const results:any[]=[]; let posted=0, dup=0, fail=0;
      for (let i=0; i<items.length; i+=50){
        const chunk = items.slice(i, i+50);
        const payload = { Invoices: chunk.map((it:any)=>({
          Type:"ACCREC", Contact:{ Name:String(it.contact||"DATABEES").slice(0,500) },
          InvoiceNumber:String(it.number||"").slice(0,255), Reference:String(it.number||"").slice(0,255),
          Date:dISO(it.date), DueDate:dISO(it.due||it.date), Status:"DRAFT", LineAmountTypes:"Exclusive",
          LineItems:[{ Description:String(it.desc||"Sales").slice(0,4000), Quantity:Number(it.qty)||1, UnitAmount:Number(it.amount)||0, AccountCode:String(it.account||"500-1000"), TaxType:taxType }]
        })) };
        let r = await fetch("https://api.xero.com/api.xro/2.0/Invoices?summarizeErrors=false", { method:"POST", headers:{ "Authorization":"Bearer "+access, "Xero-Tenant-Id":tenant, "Content-Type":"application/json", "Accept":"application/json" }, body: JSON.stringify(payload) });
        if (r.status === 429){
          const ra = Number(r.headers.get("Retry-After"))||60;
          if (ra <= 90){ await new Promise(res=>setTimeout(res, ra*1000));
            r = await fetch("https://api.xero.com/api.xro/2.0/Invoices?summarizeErrors=false", { method:"POST", headers:{ "Authorization":"Bearer "+access, "Xero-Tenant-Id":tenant, "Content-Type":"application/json", "Accept":"application/json" }, body: JSON.stringify(payload) });
          } else return j({ ok:false, error:"Xero daily rate limit hit (retry in "+Math.ceil(ra/60)+" min)", posted, dup, fail, results: results.filter((x:any)=>!x.ok) });
        }
        const out = await r.json().catch(()=>({}));
        const arr = out.Invoices || [];
        if (!arr.length && !r.ok) return j({ ok:false, error:"Xero "+r.status+": "+JSON.stringify(out.Message||out).slice(0,300), posted, dup, fail, results: results.filter((x:any)=>!x.ok) });
        arr.forEach((iv:any, k:number)=>{
          const it = chunk[k]||{};
          const errs = (iv.ValidationErrors||[]).map((e:any)=>e.Message).join("; ");
          if (iv.InvoiceID && !errs){ posted++; results.push({ number:it.number, ok:true }); }
          else { const isDup = /must be unique/i.test(errs); if (isDup) dup++; else fail++; results.push({ number:it.number, ok:false, dup:isDup, error:String(errs||"unknown").slice(0,140) }); }
        });
      }
      await logAudit(me, "sr_post_invoices", tenant, { total: items.length, posted, dup, fail, tax_type: taxType });
      return j({ ok:true, posted, dup, fail, tax_type: taxType, failures: results.filter((x:any)=>!x.ok && !x.dup).slice(0,50) });
    }
    if (api === "sr_yrdz_next") {
      // Sales Recon: highest YRDZ_MM'YYYY_#### already used in Xero per month-prefix, so a new
      // build continues the numbering instead of restarting at 0001 (duplicate import protection).
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = String(b.tenant||""); if (!tenant) return j({ ok:false, error:"tenant required" });
      const prefixes: string[] = (Array.isArray(b.prefixes)? b.prefixes : []).slice(0,24).map((x:any)=>String(x||"")).filter((x:string)=>x.length>6 && x.length<40);
      if (!prefixes.length) return j({ ok:false, error:"prefixes required" });
      const maxOut:any = {}; const srcOut:any = {};
      let access:any = null; try { access = await xeroAccessToken(); } catch(_e){ access = null; }
      for (const p of prefixes){
        let maxN = 0; let src = "cache";
        // zero-padded suffix → lexicographic DESC = numeric DESC, so the max sits in the first rows (1000-row select cap safe)
        const { data: rows } = await sb.from("xero_invoice_cache").select("number").eq("tenant_id",tenant).like("number", p+"%").order("number",{ascending:false}).limit(1000);
        for (const r of (rows||[])){ const m = String(r.number||"").slice(p.length).match(/^(\d{1,6})$/); if (m){ const n = parseInt(m[1],10); if (n>maxN) maxN = n; } }
        // Live check too — the cache (delta every 5 min) can lag a CSV the operator imported moments ago.
        if (access){
          try {
            const where = encodeURIComponent('InvoiceNumber!=null&&InvoiceNumber.StartsWith("'+p.replace(/["\\]/g,"")+'")');
            const r2 = await fetch("https://api.xero.com/api.xro/2.0/Invoices?where="+where+"&page=1&pageSize=1000", { headers:{ "Authorization":"Bearer "+access, "Xero-Tenant-Id":tenant, "Accept":"application/json" } });
            if (r2.ok){ const d = await r2.json(); for (const iv of (d.Invoices||[])){ const st=String(iv.Status||""); if (st==="DELETED"||st==="VOIDED") continue; const m = String(iv.InvoiceNumber||"").slice(p.length).match(/^(\d{1,6})$/); if (m){ const n = parseInt(m[1],10); if (n>maxN) maxN = n; } } src = "cache+live"; }
          } catch(_e){}
        }
        maxOut[p] = maxN; srcOut[p] = src;
      }
      await logAudit(me, "sr_yrdz_next", tenant, { max: maxOut, source: srcOut });
      return j({ ok:true, max: maxOut, source: srcOut });
    }
    if (api === "sr_so_suffix") {
      // Sales Recon: which of these SO invoice numbers (and their _N suffixes) already exist in Xero?
      // Lets the build suffix repeat payments as SO-XXXX_1, _2 … instead of colliding on import.
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = String(b.tenant||""); if (!tenant) return j({ ok:false, error:"tenant required" });
      const bases: string[] = (Array.isArray(b.bases)? b.bases : []).slice(0,2000).map((x:any)=>String(x||"").trim()).filter((x:string)=>x.length>2 && x.length<60);
      if (!bases.length) return j({ ok:false, error:"bases required" });
      const takenSet = new Set<string>();
      const amtMap: any = {}; // invoice number -> total already invoiced in Xero (for the Order-Form tally)
      // 1) cache: exact base hits (any format) + the whole SO- family for suffix scanning
      const CHUNK = 400;
      for (let i=0; i<bases.length; i+=CHUNK){
        const { data: ex } = await sb.from("xero_invoice_cache").select("number,total").eq("tenant_id",tenant).in("number", bases.slice(i,i+CHUNK));
        for (const r of (ex||[])) if (r.number){ takenSet.add(String(r.number)); amtMap[String(r.number)] = Number(r.total)||0; }
      }
      // Supabase caps every select at 1000 rows regardless of .limit() — paginate the SO- family (IPROCARE has ~3.7k+).
      for (let from=0; from<40000; from+=1000){
        const { data: fam } = await sb.from("xero_invoice_cache").select("number,total").eq("tenant_id",tenant).like("number","SO-%").order("number").range(from, from+999);
        if (!fam || !fam.length) break;
        for (const r of fam) if (r.number){ takenSet.add(String(r.number)); amtMap[String(r.number)] = Number(r.total)||0; }
        if (fam.length < 1000) break;
      }
      // 2) live: everything modified in the last 48h — catches an import done moments ago that the cache hasn't seen
      let liveOk = false;
      try {
        const access = await xeroAccessToken();
        const sinceHeader = new Date(Date.now() - 48*3600*1000).toUTCString();
        for (let page=1; page<=12; page++){
          const d = await xeroGet(access, tenant, "Invoices?page="+page+"&order=UpdatedDateUTC%20ASC", { "If-Modified-Since": sinceHeader });
          if (d.__notModified) break;
          const arr = d.Invoices || []; if (!arr.length) break;
          for (const iv of arr){ const st = String(iv.Status||""); if (st==="DELETED" || st==="VOIDED") continue; if (iv.InvoiceNumber){ takenSet.add(String(iv.InvoiceNumber)); amtMap[String(iv.InvoiceNumber)] = Number(iv.Total)||0; } } // deleted/voided numbers are reusable
          liveOk = true;
          if (arr.length < 100) break;
        }
      } catch(_e){}
      // per base: base taken? highest _N suffix already used? how much already invoiced (base + _N)?
      const existing:any = {};
      for (const base of bases) existing[base] = { taken: takenSet.has(base), max: 0, prev_total: 0 };
      for (const num of takenSet){
        let basePart = num;
        const i = num.lastIndexOf("_");
        if (i > 0 && /^\d{1,3}$/.test(num.slice(i+1))){
          basePart = num.slice(0,i);
          if (existing[basePart]){ const n = parseInt(num.slice(i+1),10); if (n > existing[basePart].max) existing[basePart].max = n; }
        }
        if (existing[basePart]) existing[basePart].prev_total = Math.round((existing[basePart].prev_total + (Number(amtMap[num])||0))*100)/100;
      }
      await logAudit(me, "sr_so_suffix", tenant, { bases: bases.length, taken: bases.filter(bs=>existing[bs].taken).length, live: liveOk });
      return j({ ok:true, existing, live: liveOk });
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
    if (api === "docai_test") {
      // Diagnostic: verify Google Document AI auth + processor reachability without touching real docs.
      // Callable with the cron secret (server-side trigger) OR a super-admin token.
      const { data: csec } = await sb.from("portal_secrets").select("value").eq("key","cron").single();
      const bySecret = csec && csec.value && b.cron_secret === csec.value;
      if (!bySecret){ const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401); }
      let auth = "?";
      try { const tok = await docaiAccessToken(); auth = tok ? "ok" : "no-token"; }
      catch(e){ return j({ ok:false, verdict:"auth_failed", where:"service-account JWT / GOOGLE_DOCAI_SA", detail: String((e&&e.message)||e).slice(0,300) }); }
      if (b.inbox_id){
        // Read-only extraction demo: run Doc AI on a real inbox attachment, return the fields it extracts.
        const { data: item } = await sb.from("portal_ap_inbox").select("attachments,subject").eq("id", Number(b.inbox_id)).single();
        const atts = (item && item.attachments) || [];
        const results = [];
        for (const a of atts){
          if (!a.storage_path){ continue; }
          const { data: f } = await sb.storage.from("portal-ap-uploads").download(a.storage_path);
          if (!f){ results.push({ file:a.name, error:"download failed" }); continue; }
          const buf = new Uint8Array(await f.arrayBuffer());
          let bin=""; const ch=8192; for (let i=0;i<buf.length;i+=ch) bin += String.fromCharCode.apply(null, buf.subarray(i, Math.min(i+ch, buf.length)));
          const res = await callDocAI(btoa(bin), a.mime || "application/pdf", "invoice");
          if (!res.ok){ results.push({ file:a.name, error:res.error }); continue; }
          const ents = (res.doc && res.doc.entities) || [];
          const fields = {};
          for (const e of ents){ const t=String(e.type||""); if (t && t!=="line_item"){ fields[t] = { value:(((e.normalizedValue&&e.normalizedValue.text)||e.mentionText||"")+"").replace(/\s+/g," ").trim(), conf: e.confidence!=null?Math.round(Number(e.confidence)*100):null }; } }
          const lineItems = ents.filter((e)=>e.type==="line_item").map((e)=> (e.properties||[]).reduce((o,p)=>{ o[String(p.type||"").replace("line_item/","")]=(((p.normalizedValue&&p.normalizedValue.text)||p.mentionText||"")+"").replace(/\s+/g," ").trim(); return o; }, {}));
          results.push({ file:a.name, entity_count:ents.length, fields, line_items:lineItems.slice(0,25) });
        }
        return j({ ok:true, verdict:"extraction", auth, subject:(item&&item.subject)||"", results });
      }
      const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";
      const res = await callDocAI(png1x1, "image/png", "invoice");
      if (res.ok) return j({ ok:true, verdict:"fully_working", auth, process:"ok", entities:(res.doc&&res.doc.entities?res.doc.entities.length:0) });
      const err = String(res.error||"");
      if (/\b400\b|INVALID_ARGUMENT|invalid|too small|dimension/i.test(err))
        return j({ ok:true, verdict:"config_ok", auth, note:"Processor reachable — the 1x1 test image was rejected as expected. Real invoices will process fine.", detail: err.slice(0,200) });
      const where = /\b403\b|PERMISSION_DENIED/i.test(err) ? "IAM role (Document AI API User) on the service account"
                  : /\b404\b|NOT_FOUND/i.test(err) ? "GOOGLE_DOCAI_PROJECT / _LOCATION / _INVOICE_PROCESSOR (id or region mismatch)"
                  : "Doc AI process call";
      return j({ ok:false, verdict:"process_failed", auth, where, detail: err.slice(0,300) });
    }
    if (api === "audit_list") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.from("portal_audit").select("*").order("created_at", { ascending:false }).limit(Math.min(Number(b.limit)||120, 300));
      return j({ ok:true, events: data||[] });
    }
    // ── Self-Billed Invoices — companies issue invoices on individuals' behalf, for payment (MY tax/audit) ──
    if (api === "individuals_list") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.from("portal_individuals").select("*").eq("active", true).order("name");
      return j({ ok:true, individuals: data||[] });
    }
    if (api === "individual_save") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const p = b.payee || {};
      if (!String(p.name||"").trim()) return j({ ok:false, error:"Name is required" });
      const row: any = { name:String(p.name).trim(), id_type:p.id_type||'ic', id_no:p.id_no||null, tin:p.tin||null,
        address:p.address||null, phone:p.phone||null, email:p.email||null, bank_name:p.bank_name||null,
        bank_account:p.bank_account||null, default_payment_type:p.default_payment_type||'service', notes:p.notes||null,
        updated_at:new Date().toISOString() };
      let res: any;
      if (p.id){ res = await sb.from("portal_individuals").update(row).eq("id", Number(p.id)).select().single(); }
      else { row.created_by = (me.user&&me.user.email)||null; res = await sb.from("portal_individuals").insert(row).select().single(); }
      if (res.error) return j({ ok:false, error:res.error.message });
      await logAudit(me, p.id?"individual_update":"individual_create", String(res.data&&res.data.id), { name: row.name });
      return j({ ok:true, individual: res.data });
    }
    if (api === "individual_delete") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.id) return j({ ok:false, error:"id required" });
      const { count } = await sb.from("portal_self_billed_invoices").select("id",{count:"exact",head:true}).eq("individual_id", Number(b.id));
      if (count && count>0){ await sb.from("portal_individuals").update({ active:false }).eq("id", Number(b.id)); return j({ ok:true, soft:true }); }
      await sb.from("portal_individuals").delete().eq("id", Number(b.id));
      await logAudit(me, "individual_delete", String(b.id), {});
      return j({ ok:true });
    }
    if (api === "sbi_list") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      let q = sb.from("portal_self_billed_invoices").select("id,invoice_no,tenant_id,payee_name,invoice_date,payment_type,gross_amount,wht_amount,net_payable,status,xero_bill_id,created_at").order("created_at",{ascending:false}).limit(Math.min(Number(b.limit)||200,500));
      { const alw = await allowedTenants(b.token); if (alw.length) q = q.in("tenant_id", alw); }
      if (b.tenant) q = q.eq("tenant_id", b.tenant);
      if (b.status) q = q.eq("status", b.status);
      const { data } = await q;
      return j({ ok:true, invoices: data||[] });
    }
    if (api === "sbi_get") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.from("portal_self_billed_invoices").select("*").eq("id", Number(b.id)).single();
      { const alw = await allowedTenants(b.token); if (data && alw.length && data.tenant_id && alw.indexOf(data.tenant_id) < 0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }
      if (data && Array.isArray(data.attachments)){
        for (const a of data.attachments){ if (a && a.storage_path){ try{ const { data:s } = await sb.storage.from("portal-ap-uploads").createSignedUrl(a.storage_path,300); if (s) a.download_url = s.signedUrl; }catch(_e){} } }
      }
      return j({ ok:true, invoice: data });
    }
    if (api === "sbi_buyer") {
      // fetch buyer (company) details for the form auto-fill
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data: ci } = await sb.from("portal_company_info").select("legal_name,ssm_new,myinvois_tin,sst_no,reg_address,reg_postcode,reg_city,reg_state,bank_accounts").eq("tenant_id", b.tenant).maybeSingle();
      const { data: tn } = await sb.from("xero_tenants").select("tenant_name").eq("tenant_id", b.tenant).maybeSingle();
      const addr = ci ? [ci.reg_address, ci.reg_postcode, ci.reg_city, ci.reg_state].filter(Boolean).join(", ") : "";
      return j({ ok:true, buyer: { name:(ci&&ci.legal_name)||(tn&&tn.tenant_name)||"", ssm:(ci&&ci.ssm_new)||"", tin:(ci&&ci.myinvois_tin)||"", sst:(ci&&ci.sst_no)||"", address:addr }, has_info: !!(ci&&ci.legal_name) });
    }
    if (api === "sbi_accounts") {
      // Live Xero chart of accounts for the paying company → GL-account + WHT-payable dropdowns.
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.tenant) return j({ ok:false, error:"tenant required" });
      let access; try { access = await xeroAccessToken(); } catch(e){ return j({ ok:false, error:"Xero auth: "+String(e).slice(0,150) }); }
      const r = await fetch("https://api.xero.com/api.xro/2.0/Accounts?where=" + encodeURIComponent('Status=="ACTIVE"'), { headers:{ "Authorization":"Bearer "+access, "Xero-Tenant-Id": b.tenant, "Accept":"application/json" } });
      const d = await r.json();
      if (!r.ok) return j({ ok:false, error:"Xero "+r.status+": "+JSON.stringify(d.Message||d).slice(0,200) });
      const accts = (d.Accounts||[]).filter((a: any)=>a && a.Code).map((a: any)=>({ code:a.Code, name:a.Name, cls:a.Class, type:a.Type }));
      accts.sort((a: any,b2: any)=> String(a.code).localeCompare(String(b2.code)));
      return j({ ok:true, accounts: accts });
    }
    if (api === "sbi_save") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const inv = b.invoice || {};
      if (!inv.tenant_id) return j({ ok:false, error:"Paying company is required" });
      { const alw = await allowedTenants(b.token); if (alw.length && alw.indexOf(inv.tenant_id) < 0) return await denyTenant(me, "sbi_save", inv.tenant_id); }
      if (!inv.individual_id) return j({ ok:false, error:"Payee is required" });
      const { data: payee } = await sb.from("portal_individuals").select("*").eq("id", Number(inv.individual_id)).single();
      if (!payee) return j({ ok:false, error:"Payee not found" });
      // Bank details are mandatory for payment.
      const bankName = String(inv.payee_bank_name || payee.bank_name || "").trim();
      const bankAcct = String(inv.payee_bank_account || payee.bank_account || "").trim();
      if (!bankName || !bankAcct) return j({ ok:false, error:"Bank name and account number are required for payment" });
      const { data: ci } = await sb.from("portal_company_info").select("legal_name,ssm_new,myinvois_tin,sst_no,reg_address,reg_postcode,reg_city,reg_state").eq("tenant_id", inv.tenant_id).maybeSingle();
      const { data: tn } = await sb.from("xero_tenants").select("tenant_name").eq("tenant_id", inv.tenant_id).maybeSingle();
      const buyerAddr = ci ? [ci.reg_address, ci.reg_postcode, ci.reg_city, ci.reg_state].filter(Boolean).join(", ") : "";
      const items = Array.isArray(inv.line_items) ? inv.line_items : [];
      const gross = items.reduce((s: number, it: any)=> s + (Number(it.amount) || (Number(it.qty||1)*Number(it.unit_price||0))), 0);
      const sst = Number(inv.sst_amount||0);
      const whtType = String(inv.wht_type||"none");
      const whtRate = whtType==="none" ? 0 : Number(inv.wht_rate||0);
      const whtAmount = Math.round(gross * whtRate/100 * 100)/100;
      const net = Math.round((gross + sst - whtAmount)*100)/100;
      // attachments: keep existing + upload any new base64 docs
      let atts: any[] = Array.isArray(inv.attachments) ? inv.attachments.filter((a: any)=>a && a.storage_path) : [];
      if (Array.isArray(inv.new_attachments)){
        for (const a of inv.new_attachments){
          try{ const b64=String(a.b64||"").replace(/^data:[^,]+,/,""); if(!b64) continue;
            const bytes=Uint8Array.from(atob(b64), (c)=>c.charCodeAt(0));
            const nm=String(a.name||"doc").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120);
            const path=inv.tenant_id+"/sbi/"+Date.now()+"_"+Math.random().toString(36).slice(2,7)+"_"+nm;
            const up=await sb.storage.from("portal-ap-uploads").upload(path, bytes, { contentType:a.mime||"application/octet-stream" });
            if(!up.error) atts.push({ name:nm, mime:a.mime||"", size:bytes.length, storage_path:path });
          }catch(_e){}
        }
      }
      const row: any = {
        tenant_id: inv.tenant_id, individual_id: Number(inv.individual_id),
        payee_name: payee.name, payee_id_type: payee.id_type, payee_id_no: payee.id_no, payee_tin: payee.tin,
        payee_address: payee.address, payee_bank_name: bankName, payee_bank_account: bankAcct,
        payee_bank_holder: String(inv.payee_bank_holder || payee.name || "").trim() || null,
        buyer_name: (inv.buyer_name||(ci&&ci.legal_name)||(tn&&tn.tenant_name)||""), buyer_ssm: (inv.buyer_ssm||(ci&&ci.ssm_new)||""),
        buyer_tin: (inv.buyer_tin||(ci&&ci.myinvois_tin)||""), buyer_sst: (inv.buyer_sst||(ci&&ci.sst_no)||""), buyer_address: (inv.buyer_address||buyerAddr),
        invoice_date: inv.invoice_date || null, due_date: inv.due_date || null,
        payment_type: inv.payment_type||'service', classification_code: inv.classification_code||null,
        currency: inv.currency||'MYR', line_items: items, gross_amount: gross, sst_amount: sst,
        wht_type: whtType, wht_rate: whtRate, wht_amount: whtAmount, net_payable: net,
        gl_account: inv.gl_account||null, wht_gl_account: inv.wht_gl_account||null, attachments: atts,
        notes: inv.notes||null, updated_at: new Date().toISOString()
      };
      let res: any;
      if (inv.id){ res = await sb.from("portal_self_billed_invoices").update(row).eq("id", Number(inv.id)).select().single(); }
      else {
        const nm = String((tn&&tn.tenant_name)||"").replace(/CTG4U|SDN BHD|MALAYSIA|HOLDING|WHITENING|SKINCARE/gi,"").replace(/[^A-Za-z]/g,"").toUpperCase().slice(0,7) || "CO";
        const yr = String((inv.invoice_date? new Date(inv.invoice_date): new Date()).getFullYear());
        const { count } = await sb.from("portal_self_billed_invoices").select("id",{count:"exact",head:true}).eq("tenant_id", inv.tenant_id).gte("invoice_date", yr+"-01-01").lte("invoice_date", yr+"-12-31");
        row.invoice_no = "SB-"+nm+"-"+yr+"-"+String((count||0)+1).padStart(4,"0");
        row.created_by = (me.user&&me.user.email)||null; row.status='draft';
        res = await sb.from("portal_self_billed_invoices").insert(row).select().single();
      }
      if (res.error) return j({ ok:false, error:res.error.message });
      await logAudit(me, inv.id?"sbi_update":"sbi_create", String(res.data&&res.data.id), { invoice_no: res.data&&res.data.invoice_no, net });
      return j({ ok:true, invoice: res.data });
    }
    if (api === "sbi_approve") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      { const { data: rec } = await sb.from("portal_self_billed_invoices").select("tenant_id").eq("id", Number(b.id)).maybeSingle();
        const alw = await allowedTenants(b.token); if (rec && alw.length && rec.tenant_id && alw.indexOf(rec.tenant_id) < 0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }
      const { data } = await sb.from("portal_self_billed_invoices").update({ status:'approved', approved_by:(me.user&&me.user.email)||null, approved_at:new Date().toISOString() }).eq("id", Number(b.id)).select().single();
      await logAudit(me, "sbi_approve", String(b.id), {});
      return j({ ok:true, invoice: data });
    }
    if (api === "sbi_void") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      { const { data: rec } = await sb.from("portal_self_billed_invoices").select("tenant_id").eq("id", Number(b.id)).maybeSingle();
        const alw = await allowedTenants(b.token); if (rec && alw.length && rec.tenant_id && alw.indexOf(rec.tenant_id) < 0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }
      await sb.from("portal_self_billed_invoices").update({ status:'void', updated_at:new Date().toISOString() }).eq("id", Number(b.id));
      await logAudit(me, "sbi_void", String(b.id), {});
      return j({ ok:true });
    }
    if (api === "sbi_post_xero") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data: v } = await sb.from("portal_self_billed_invoices").select("*").eq("id", Number(b.id)).single();
      if (!v) return j({ ok:false, error:"not found" });
      { const alw = await allowedTenants(b.token); if (alw.length && alw.indexOf(v.tenant_id) < 0) return await denyTenant(me, "sbi_post_xero", v.tenant_id); }
      if (v.status==="void") return j({ ok:false, error:"Invoice is void" });
      let access; try { access = await xeroAccessToken(); } catch(e){ return j({ ok:false, error:"Xero auth: "+String(e).slice(0,150) }); }
      const reference = String(v.invoice_no || ("SB-"+v.id)).slice(0,255);
      const xh = { "Authorization":"Bearer "+access, "Xero-Tenant-Id": v.tenant_id, "Content-Type":"application/json", "Accept":"application/json" };

      let billId = v.xero_bill_id || null;
      if (billId){
        // Already posted — don't error; sync the Reference onto the existing (editable) bill so it's never blank.
        try { await fetch("https://api.xero.com/api.xro/2.0/Invoices", { method:"POST", headers: xh, body: JSON.stringify({ Invoices:[{ InvoiceID: billId, Reference: reference }] }) }); } catch(_e){}
      } else {
        const gl = String(v.gl_account||"").trim();
        if(!gl) return j({ ok:false, error:"No expense account (GL) is set on this invoice. Open it → choose the GL account for the payment → Save, then post to Xero." });
        const items = Array.isArray(v.line_items)? v.line_items : [];
        const lines: any[] = items.map((l: any)=>{
          const up=Number(l.unit_price)||0;
          return up>0
            ? { Description:String(l.description||("Payment to "+v.payee_name)).slice(0,4000), Quantity:Number(l.qty)||1, UnitAmount:up, AccountCode: gl }
            : { Description:String(l.description||("Payment to "+v.payee_name)).slice(0,4000), Quantity:1, UnitAmount:Number(l.amount)||0, AccountCode: gl };
        });
        if (!lines.length) lines.push({ Description:"Payment to "+v.payee_name, Quantity:1, UnitAmount:Number(v.gross_amount)||0, AccountCode: gl });
        if (Number(v.wht_amount)>0){ lines.push({ Description:"Less: Withholding tax "+(v.wht_rate||0)+"% — to remit to LHDN", Quantity:1, UnitAmount:-(Number(v.wht_amount)||0), AccountCode: v.wht_gl_account || gl }); }
        // Safety red line: SUBMITTED (Awaiting Approval), never AUTHORISED — payment stays a human click in Xero.
        const inv: any = { Type:"ACCPAY", Contact:{ Name:String(v.payee_name||"Individual").slice(0,500) },
          Reference: reference, Date: v.invoice_date||undefined, DueDate: v.due_date||undefined,
          Status:"SUBMITTED", LineAmountTypes:"Exclusive", LineItems: lines };
        const idem = "sbi-"+v.id+"-"+reference.replace(/[^A-Za-z0-9-]/g,"");
        const r = await fetch("https://api.xero.com/api.xro/2.0/Invoices", { method:"POST", headers:{ ...xh, "Idempotency-Key": idem }, body: JSON.stringify({ Invoices:[inv] }) });
        const out = await r.json();
        if (!r.ok){
          let msg = "";
          const el = (out.Elements||[])[0];
          if (el && Array.isArray(el.ValidationErrors) && el.ValidationErrors.length) msg = el.ValidationErrors.map((e:any)=>e.Message).join(" · ");
          else if (Array.isArray(out.ValidationErrors) && out.ValidationErrors.length) msg = out.ValidationErrors.map((e:any)=>e.Message).join(" · ");
          else msg = out.Message || JSON.stringify(out);
          return j({ ok:false, error:"Xero "+r.status+": "+String(msg).slice(0,400) });
        }
        const bill = (out.Invoices||[])[0]; billId = bill && bill.InvoiceID;
        await sb.from("portal_self_billed_invoices").update({ xero_bill_id: billId||null, status:(v.status==='draft'?'approved':v.status), approved_by:(me.user&&me.user.email)||v.approved_by||null, approved_at: v.approved_at||new Date().toISOString(), updated_at:new Date().toISOString() }).eq("id", v.id);
      }

      // Attach the compliant self-billed invoice PDF + any supporting docs to the Xero bill (best-effort).
      let attachedPdf = false, attachedDocs = 0;
      if (billId){
        try {
          const pdfName = ("SelfBilledInvoice_"+reference).replace(/[^A-Za-z0-9._-]/g,"_").slice(0,116)+".pdf";
          const pdf = buildSelfBilledInvoicePdf(v);
          const ar = await fetch("https://api.xero.com/api.xro/2.0/Invoices/"+billId+"/Attachments/"+encodeURIComponent(pdfName), { method:"POST", headers:{ "Authorization":"Bearer "+access, "Xero-Tenant-Id": v.tenant_id, "Content-Type":"application/pdf" }, body: pdf });
          attachedPdf = ar.ok;
        } catch(_e){}
        if (Array.isArray(v.attachments)){
          for (const a of v.attachments){
            try {
              if (!a || !a.storage_path) continue;
              const { data: fileData } = await sb.storage.from("portal-ap-uploads").download(a.storage_path);
              if (fileData){
                const buf = await fileData.arrayBuffer();
                const dr = await fetch("https://api.xero.com/api.xro/2.0/Invoices/"+billId+"/Attachments/"+encodeURIComponent(String(a.name||"support").replace(/[^A-Za-z0-9._-]/g,"_").slice(0,116)), { method:"POST", headers:{ "Authorization":"Bearer "+access, "Xero-Tenant-Id": v.tenant_id, "Content-Type": a.mime||"application/octet-stream" }, body: buf });
                if (dr.ok) attachedDocs++;
              }
            } catch(_e){}
          }
        }
      }
      await logAudit(me, "sbi_post_xero", String(v.id), { xero_bill_id: billId, net: v.net_payable, reference, attached_pdf: attachedPdf, attached_docs: attachedDocs });
      return j({ ok:true, xero_bill_id: billId, reference, attached_pdf: attachedPdf, attached_docs: attachedDocs });
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
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401); // AP module is admin-only
      const { data, error } = await sb.rpc("portal_ap_settings_get", { p_token: b.token||"" });
      if (error) return j({ ok:false, error:"ap_settings_get failed: "+String(error.message||error) }, 500);
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
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401); // AP module is admin-only
      const alwAp = await allowedTenants(b.token);
      if (!b.tenant && alwAp.length){ // no explicit tenant filter → still restrict a partially-assigned admin to their companies
        const { data, error } = await sb.rpc("portal_ap_inbox_list", { p_token: b.token||"", p_tenant: null, p_status: b.status||null, p_limit: Math.min(Number(b.limit)||100, 500) });
        if (error) return j({ ok:false, error:"ap_inbox_list failed: "+String(error.message||error) }, 500);
        if (data && Array.isArray(data.items)) data.items = data.items.filter((it:any)=>!it.tenant_id || alwAp.indexOf(it.tenant_id)>=0);
        return j(data || { ok:true, items:[] });
      }
      const { data, error } = await sb.rpc("portal_ap_inbox_list", { p_token: b.token||"", p_tenant: b.tenant||null, p_status: b.status||null, p_limit: Math.min(Number(b.limit)||100, 500) });
      if (error) return j({ ok:false, error:"ap_inbox_list failed: "+String(error.message||error) }, 500);
      return j(data || { ok:true, items:[] });
    }
    if (api === "ap_inbox_get") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401); // AP module is admin-only
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
      const { data: _cs } = await sb.from("portal_secrets").select("value").eq("key","cron").single();
      const _bySecret = _cs && _cs.value && b.cron_secret === _cs.value;
      if (!_bySecret){ const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401); }
      if (!b.id) return j({ ok:false, error:"id required" });
      let itemTenant;
      if (_bySecret){
        const { data: it } = await sb.from("portal_ap_inbox").select("tenant_id").eq("id", Number(b.id)).single();
        if (!it) return j({ ok:false, error:"not found" });
        itemTenant = it.tenant_id;
      } else {
        const { data: getRes } = await sb.rpc("portal_ap_inbox_get", { p_token: b.token||"", p_id: Number(b.id) });
        if (!getRes || !getRes.ok || !getRes.item) return j({ ok:false, error:"not found" });
        itemTenant = getRes.item.tenant_id;
      }
      const { data: settings } = await sb.from("portal_ap_settings").select("*").eq("tenant_id", itemTenant).single();
      const route = {
        tenant_id: itemTenant,
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
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401); // AP module is admin-only
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
      const { data, error } = await sb.rpc("portal_compliance_calendar", { p_token: b.token||"", p_days: Number(b.days)||365 });
      if (error) return j({ ok:false, error:"compliance_calendar failed: "+String(error.message||error) }, 500);
      return j(data || { ok:true, deadlines:[] });
    }
    if (api === "cashflow_forecast") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data, error } = await sb.rpc("portal_cashflow_forecast", { p_token: b.token||"", p_days: Number(b.days)||90, p_tenant: b.tenant||null });
      if (error) return j({ ok:false, error:"cashflow_forecast failed: "+String(error.message||error) }, 500);
      return j(data || { ok:true });
    }
    if (api === "group_dashboard") {
      // CFO Cockpit — group analytics from the invoice cache (reliable), not the Xero P&L.
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data, error } = await sb.rpc("portal_group_dashboard", { p_token: b.token||"", p_months: Number(b.months)||12, p_tenant: b.tenant||null });
      if (error) return j({ ok:false, error:"group_dashboard failed: "+String(error.message||error) }, 500);
      return j(data || { ok:true });
    }
    if (api === "fin_analytics") {
      // Financial-analyst toolkit — DSO/DPO + cash-conversion, customer AR credit risk, intercompany matrix.
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data, error } = await sb.rpc("portal_fin_analytics", { p_token: b.token||"", p_months: Number(b.months)||12, p_tenant: b.tenant||null });
      if (error) return j({ ok:false, error:"fin_analytics failed: "+String(error.message||error) }, 500);
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
          // Cache side — open ACCREC (AUTHORISED + SUBMITTED). Paginated: a single select caps at 1000
          // rows, which froze cache_count at 1000 for big tenants → permanent false "drift" alarms.
          let cacheSum = 0, cacheCount = 0;
          for (let off=0; off<50000; off+=1000){
            const { data: rows } = await sb.from("xero_invoice_cache").select("amount_due").eq("tenant_id", t.tenant_id).eq("type","ACCREC").in("status",["AUTHORISED","SUBMITTED"]).order("invoice_id").range(off, off+999);
            (rows||[]).forEach((r)=>{ cacheSum += Number(r.amount_due||0); cacheCount++; });
            if (!rows || rows.length < 1000) break;
          }
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
        // Cache side — every invoice for this tenant updated since the same window (paginated past the
        // 1000-row select cap; an unpaginated read reported phantom "missing" ids on busy windows).
        const cacheIds = new Set(); const cacheByStatus = {};
        for (let off=0; off<50000; off+=1000){
          const { data: cacheRows } = await sb.from("xero_invoice_cache").select("invoice_id,type,status").eq("tenant_id", b.tenant).gte("updated_at", sinceISO).order("invoice_id").range(off, off+999);
          for (const r of (cacheRows||[])){ cacheIds.add(r.invoice_id); const k = (r.type||"?") + "/" + (r.status||"?"); cacheByStatus[k] = (cacheByStatus[k]||0) + 1; }
          if (!cacheRows || cacheRows.length < 1000) break;
        }
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
      // Reset the sync watermark AT WIPE TIME: if the background backfill dies mid-run (daily rate cap,
      // token expiry), the nightly sync must NOT resume from the stale pre-wipe last_full_sync_at — that
      // would leave the wiped history permanently missing. Null forces the next backfill to run deep.
      try { await syncStateUpdate(b.tenant, { last_full_sync_at: null, last_delta_sync_at: null }); } catch(_e){}
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
      const { data, error } = await sb.rpc("portal_pharmacy_list", { p_token: b.token||"" });
      if (error) return j({ ok:false, error:"pharmacy_list failed: "+String(error.message||error) }, 500);
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
      let pxc:any[] = [];
      for (let off=0; off<20000; off+=1000){
        const { data: pg } = await sb.from("xero_contacts_cache").select("contact_id,name,email").eq("tenant_id", SKINDAE_TENANT).order("name").range(off, off+999);
        pxc = pxc.concat(pg||[]); if (!pg || pg.length < 1000) break;
      }
      return j({ ok:true, contacts: pxc });
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
      const { data, error } = await sb.rpc("portal_company_folder_list", { p_token: b.token||"", p_tenant: b.tenant||null });
      if (error) return j({ ok:false, error:"company_folder_list failed: "+String(error.message||error) }, 500);
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
      const { data, error } = await sb.rpc("portal_company_doc_list", { p_token: b.token||"", p_tenant: b.tenant||null });
      if (error) return j({ ok:false, error:"company_doc_list failed: "+String(error.message||error) }, 500);
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
    // ===== HR / Payroll (Wave 1: employees, leave, claims) — reads hr_* via service role, gated by portal admin =====
    // Access role: a Viewer (read-only) may call HR read actions only; hard-block every mutating HR/RC/attendance action.
    if ((api.indexOf("hr_")===0 || api.indexOf("attendance_")===0 || api.indexOf("clock_")===0) && !HR_VIEWER_READS.has(api)){
      const _v = await meFromToken(b.token);
      if (hrViewer(_v)) return j({ ok:false, error:"Your HR access is view-only — changes are disabled." }, 403);
    }
    if (api === "hr_companies") {
      const me = await meFromToken(b.token); if (!hrCanView(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const alw = await allowedTenants(b.token); // admins with a partial company assignment only see their companies
      const { data } = await sb.from("xero_tenants").select("tenant_id,tenant_name").order("tenant_name");
      return j({ ok:true, companies:(data||[]).filter((c:any)=>!alw.length || alw.indexOf(c.tenant_id)>=0).map((c:any)=>({ tenant_id:c.tenant_id, tenant_name:String(c.tenant_name||"").replace(/[^\x20-\x7E]/g,"").trim() })) });
    }
    // ── Access & Roles (Master Admin only): list portal users, change roles, invite viewers ──
    if (api === "hr_users_list") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data: users } = await sb.from("portal_users").select("id,email,name,role,created_at").order("role").order("email").range(0,999);
      const ids=(users||[]).map((u:any)=>u.id); const empByUser:any={};
      if(ids.length){ const { data: emps } = await sb.from("hr_employees").select("user_id,name,emp_no").in("user_id",ids); (emps||[]).forEach((e:any)=>{ if(e.user_id) empByUser[e.user_id]=e; }); }
      const rows=(users||[]).map((u:any)=>({ id:u.id, email:u.email, name:u.name, role:u.role, employee:(empByUser[u.id]?empByUser[u.id].name:null), self:!!(me.user&&me.user.id===u.id) }));
      const adminCount=(users||[]).filter((u:any)=>u.role==="admin").length;
      return j({ ok:true, users: rows, me_id:(me.user&&me.user.id)||null, admin_count:adminCount });
    }
    if (api === "hr_user_role_set") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const uid=String(b.user_id||""); const role=String(b.role||"").toLowerCase();
      if(!uid) return j({ ok:false, error:"No user specified." });
      if(["admin","hr_admin","viewer","approver","employee"].indexOf(role)<0) return j({ ok:false, error:"Invalid role." });
      const { data: target } = await sb.from("portal_users").select("id,role,email").eq("id",uid).maybeSingle();
      if(!target) return j({ ok:false, error:"User not found." });
      if(target.role==="admin" && role!=="admin"){ // never leave the org without a Master Admin
        const { count } = await sb.from("portal_users").select("id",{count:"exact",head:true}).eq("role","admin");
        if((count||0)<=1) return j({ ok:false, error:"You can’t change the last Master Admin — promote someone else first." });
      }
      const { error } = await sb.from("portal_users").update({ role }).eq("id",uid);
      if(error) return j({ ok:false, error:error.message });
      await logAudit(me,"hr_user_role_set",uid,{ from:target.role, to:role, email:target.email });
      return j({ ok:true });
    }
    if (api === "hr_user_invite") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const email=String(b.email||"").trim().toLowerCase(); const name=String(b.name||"").trim()||email; const role=String(b.role||"viewer").toLowerCase();
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j({ ok:false, error:"Enter a valid email address." });
      if(["admin","hr_admin","viewer"].indexOf(role)<0) return j({ ok:false, error:"Invalid role." });
      const { data: existing } = await sb.from("portal_users").select("id").eq("email",email).maybeSingle();
      if(existing) return j({ ok:false, error:"A user with that email already exists — change their role in the list instead." });
      const pass = "Ctg"+Math.random().toString(36).slice(2,7)+Math.floor(Math.random()*90+10)+"!";
      const alw = await allowedTenants(b.token);
      const { data:uid, error } = await sb.rpc("portal_create_user", { p_email:email, p_name:name, p_pass:pass, p_role:role, p_tenants:(alw&&alw.length?alw:[]) });
      if(error) return j({ ok:false, error:error.message });
      await logAudit(me,"hr_user_invite",email,{ role });
      return j({ ok:true, email, temp_password:pass, role });
    }
    if (api === "hr_bootstrap") {
      const me = await meFromToken(b.token); if (!hrCanView(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = String(b.tenant||"");
      if (!tenant) return j({ ok:true, employees:[], leaveTypes:[], leaves:[], claims:[], employer:null });
      const emp = await sb.from("hr_employees").select("*").eq("tenant_id",tenant).order("emp_no");
      const empIds = (emp.data||[]).map((e:any)=>e.id);
      const [lt, lv, cl, ei, rt, bk] = await Promise.all([
        sb.from("hr_leave_types").select("*").eq("active",true).order("code"),
        empIds.length? sb.from("hr_leave_requests").select("*, employee:hr_employees(name,dept)").in("employee_id",empIds).order("date_from",{ascending:false}) : Promise.resolve({data:[]} as any),
        empIds.length? sb.from("hr_claims").select("*, employee:hr_employees(name,dept)").in("employee_id",empIds).order("claim_date",{ascending:false}) : Promise.resolve({data:[]} as any),
        sb.from("hr_employer_info").select("*").eq("tenant_id",tenant).maybeSingle(),
        sb.from("hr_statutory_rates").select("rates").eq("id",1).single(),
        sb.from("hr_banks").select("code,name,active").eq("active",true).order("name"),
      ]);
      return j({ ok:true, employees:emp.data||[], leaveTypes:lt.data||[], leaves:lv.data||[], claims:cl.data||[], employer:ei.data||null, rates:(rt.data&&rt.data.rates)||null, banks:bk.data||[] });
    }
    if (api === "hr_banks_list") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.from("hr_banks").select("code,name,active").order("name");
      return j({ ok:true, banks:data||[] });
    }
    if (api === "hr_banks_save") {
      // Add / rename / (de)activate a bank — future additions are data-only, no code change (spec).
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const row = b.row||{};
      const code = String(row.code||"").trim().toUpperCase().replace(/[^A-Z0-9_]/g,"_");
      const name = String(row.name||"").trim();
      if (!code) return j({ ok:false, error:"code is required" });
      if (row.delete){ await sb.from("hr_banks").update({ active:false, updated_at:new Date().toISOString() }).eq("code",code); }
      else {
        if (!name) return j({ ok:false, error:"name is required" });
        await sb.from("hr_banks").upsert({ code, name, active: row.active!==false, updated_at:new Date().toISOString() }, { onConflict:"code" });
      }
      await logAudit(me, "hr_banks_save", code, { name, active: row.active!==false, deleted: !!row.delete });
      return j({ ok:true });
    }
    // ═══ Time clock / attendance (part-time & hourly staff) ═══════════════════
    // Employees clock in/out from their phone; admins view + correct punches; hours feed payroll.
    if (api === "clock_status" || api === "clock_in" || api === "clock_out") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      // Target: the logged-in employee, or (admin only) an employee_id passed in the body.
      let empId = who.employee ? who.employee.id : null;
      if (who.isAdmin && b.employee_id) empId = String(b.employee_id);
      if (!empId) return j({ ok:false, error:"Your login isn’t linked to an employee profile yet — ask HR to enable your access.", need_profile:true });
      const { data: emp } = await sb.from("hr_employees").select("id,name,tenant_id,pay_type,hourly_rate,daily_rate,shift_start,shift_end,employment_type").eq("id",empId).maybeSingle();
      if (!emp) return j({ ok:false, error:"employee not found" });
      if (who.isAdmin){ const alw = await allowedTenants(b.token); if (alw.length && emp.tenant_id && alw.indexOf(emp.tenant_id) < 0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }
      const nowMs = Date.now();
      const mytToday = new Date(nowMs+8*3600*1000).toISOString().slice(0,10);
      const { data: open } = await sb.from("hr_timeclock").select("*").eq("employee_id",empId).eq("status","open").maybeSingle();

      if (api === "clock_in") {
        // Time clock is only for part-timers (Part-time employment OR hourly/daily pay). Full-time
        // monthly staff don't punch. clock_out/clock_status stay open so an existing punch can be closed.
        const needsClock = String(emp.employment_type||"")==="Part-time" || ["hourly","daily"].indexOf(String(emp.pay_type||""))>=0;
        if (!needsClock) return j({ ok:false, error:"Time clock is only for part-time / hourly staff. Full-time staff don’t need to clock in." });
        if (open) return j({ ok:false, error:"You are already clocked in.", open });
        const { data: ins, error } = await sb.from("hr_timeclock").insert({ tenant_id: emp.tenant_id, employee_id: empId, work_date: mytToday,
          clock_in: new Date(nowMs).toISOString(), status:"open", source:(who.isAdmin && b.employee_id)?"admin":"self",
          in_lat: (b.lat!=null?Number(b.lat):null), in_lng:(b.lng!=null?Number(b.lng):null), note: b.note||null }).select().single();
        if (error) return j({ ok:false, error: error.message });
        return j({ ok:true, punch: ins });
      }
      if (api === "clock_out") {
        if (!open) return j({ ok:false, error:"You are not clocked in." });
        const inMs = new Date(open.clock_in).getTime();
        let hrs = (nowMs - inMs)/3600000 - (Number(open.break_minutes)||0)/60;
        hrs = Math.max(0, Math.round(hrs*100)/100);
        const { data: upd, error } = await sb.from("hr_timeclock").update({ clock_out: new Date(nowMs).toISOString(), hours: hrs, status:"complete",
          out_lat:(b.lat!=null?Number(b.lat):null), out_lng:(b.lng!=null?Number(b.lng):null), updated_at:new Date().toISOString() }).eq("id",open.id).select().single();
        if (error) return j({ ok:false, error: error.message });
        return j({ ok:true, punch: upd });
      }
      // clock_status: current open punch (+ whether it's stale from a previous day), today's punches, week hours.
      const { data: todayRows } = await sb.from("hr_timeclock").select("*").eq("employee_id",empId).eq("work_date",mytToday).order("clock_in");
      const mytNow = new Date(nowMs+8*3600*1000);
      const dow = (mytNow.getUTCDay()+6)%7; // 0=Mon
      const wkFrom = new Date(mytNow.getTime()-dow*86400000).toISOString().slice(0,10);
      const { data: wkRows } = await sb.from("hr_timeclock").select("hours").eq("employee_id",empId).gte("work_date",wkFrom).eq("status","complete");
      const weekHours = Math.round(((wkRows||[]).reduce((s,r)=>s+(Number(r.hours)||0),0))*100)/100;
      const staleOpen = open && String(open.work_date) < mytToday;
      return j({ ok:true, employee:{ id:emp.id, name:emp.name, pay_type:emp.pay_type||"monthly", hourly_rate:emp.hourly_rate, daily_rate:emp.daily_rate, employment_type:emp.employment_type },
        open: open||null, stale_open: !!staleOpen, today: todayRows||[], week_hours: weekHours, server_now: new Date(nowMs).toISOString() });
    }
    if (api === "attendance_list") {
      const me = await meFromToken(b.token); if (!hrCanView(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = String(b.tenant||""); if (!tenant) return j({ ok:false, error:"no company selected" });
      { const alw = await allowedTenants(b.token); if (alw.length && alw.indexOf(tenant) < 0) return j({ ok:false, error:"forbidden" }, 403); }
      const month = String(b.month||"").trim(); // YYYY-MM optional
      let from = month ? month+"-01" : new Date(Date.now()+8*3600*1000 - 30*86400000).toISOString().slice(0,10);
      let to; if(month){ const [yy,mm]=month.split("-").map(Number); to = (mm===12)?((yy+1)+"-01-01"):(yy+"-"+String(mm+1).padStart(2,"0")+"-01"); } else { to = new Date(Date.now()+8*3600*1000 + 86400000).toISOString().slice(0,10); }
      let rows:any[]=[];
      for(let off=0; off<20000; off+=1000){
        const { data: pg } = await sb.from("hr_timeclock").select("*, hr_employees(emp_no,name,pay_type,hourly_rate,daily_rate,employment_type)").eq("tenant_id",tenant).gte("work_date",from).lt("work_date",to).order("work_date",{ascending:false}).order("clock_in",{ascending:false}).range(off,off+999);
        rows=rows.concat(pg||[]); if(!pg || pg.length<1000) break;
      }
      if (b.employee_id) rows = rows.filter((r:any)=>r.employee_id===b.employee_id);
      // per-employee summary for the window
      const sum:any = {};
      for(const r of rows){ const e=r.hr_employees||{}; const k=r.employee_id;
        const s = sum[k] || (sum[k] = { employee_id:k, emp_no:e.emp_no, name:e.name, pay_type:e.pay_type, hourly_rate:e.hourly_rate, daily_rate:e.daily_rate, hours:0, days:new Set(), open:0 });
        if(r.status==="complete"){ s.hours += Number(r.hours)||0; s.days.add(r.work_date); }
        if(r.status==="open") s.open++;
      }
      const summary = Object.values(sum).map((s:any)=>({ employee_id:s.employee_id, emp_no:s.emp_no, name:s.name, pay_type:s.pay_type,
        hourly_rate:s.hourly_rate, daily_rate:s.daily_rate, hours:Math.round(s.hours*100)/100, days:s.days.size, open:s.open,
        est_pay: s.pay_type==="hourly" ? Math.round((s.hours*(Number(s.hourly_rate)||0))*100)/100 : (s.pay_type==="daily" ? Math.round((s.days.size*(Number(s.daily_rate)||0))*100)/100 : null) }))
        .sort((a:any,b2:any)=> String(a.name||"").localeCompare(String(b2.name||"")));
      return j({ ok:true, punches: rows, summary });
    }
    if (api === "attendance_save") {
      // Admin add/correct a punch. Computes hours from in/out.
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const p = b.punch||{}; const empId = String(p.employee_id||"");
      if(!empId) return j({ ok:false, error:"employee required" });
      const { data: emp } = await sb.from("hr_employees").select("id,tenant_id").eq("id",empId).maybeSingle();
      if(!emp) return j({ ok:false, error:"employee not found" });
      { const alw = await allowedTenants(b.token); if (alw.length && emp.tenant_id && alw.indexOf(emp.tenant_id) < 0) return j({ ok:false, error:"forbidden" }, 403); }
      const ci = p.clock_in? new Date(p.clock_in): null; const co = p.clock_out? new Date(p.clock_out): null;
      if(!ci || isNaN(+ci)) return j({ ok:false, error:"valid clock-in time required" });
      let hrs:any=null, status="open";
      if(co && !isNaN(+co)){ if(+co < +ci) return j({ ok:false, error:"clock-out must be after clock-in" }); hrs = Math.max(0, Math.round(((+co - +ci)/3600000 - (Number(p.break_minutes)||0)/60)*100)/100); status="complete"; }
      const wd = p.work_date || new Date(+ci+8*3600*1000).toISOString().slice(0,10);
      const rowData:any = { tenant_id:emp.tenant_id, employee_id:empId, work_date:wd, clock_in:ci.toISOString(), clock_out:co?co.toISOString():null, hours:hrs, break_minutes:Number(p.break_minutes)||0, status, source:"admin", note:p.note||null, updated_at:new Date().toISOString() };
      let res:any;
      if(p.id){ res = await sb.from("hr_timeclock").update(rowData).eq("id",p.id).select().single(); }
      else { res = await sb.from("hr_timeclock").insert(rowData).select().single(); }
      if(res.error) return j({ ok:false, error:res.error.message });
      await logAudit(me,"attendance_save",String(res.data&&res.data.id),{ employee_id:empId, hours:hrs });
      return j({ ok:true, punch: res.data });
    }
    if (api === "attendance_delete") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data: rec } = await sb.from("hr_timeclock").select("tenant_id").eq("id",String(b.id)).maybeSingle();
      if(rec){ const alw = await allowedTenants(b.token); if (alw.length && rec.tenant_id && alw.indexOf(rec.tenant_id) < 0) return j({ ok:false, error:"forbidden" }, 403); }
      await sb.from("hr_timeclock").delete().eq("id",String(b.id));
      await logAudit(me,"attendance_delete",String(b.id),{});
      return j({ ok:true });
    }
    if (api === "cron_clock_reminders") {
      // Email part-timers with a shift + reminder ON: nudge to clock IN near shift_start, and warn if still
      // clocked in past shift_end (forgot to clock out). Idempotent per 15-min window via portal_secrets marker.
      const { data: sec } = await sb.from("portal_secrets").select("value").eq("key","cron").single();
      if (!sec || !sec.value || b.cron_secret !== sec.value) return j({ ok:false, error:"forbidden" }, 403);
      const work = (async ()=>{ try {
        const mytNow = new Date(Date.now()+8*3600*1000);
        const hhmm = mytNow.toISOString().slice(11,16); // "HH:MM" MYT
        const today = mytNow.toISOString().slice(0,10);
        const { data: emps } = await sb.from("hr_employees").select("id,name,email,shift_start,shift_end,tenant_id,clock_remind_in_date,clock_remind_out_date").eq("status","active").eq("clock_reminder",true);
        let sent=0;
        const clkBase="https://sscctgfinance-cmd.github.io/ctg-finance-portal/hros.html#clock";
        for(const e of (emps||[])){
          if(!e.email) continue;
          const { data: open } = await sb.from("hr_timeclock").select("id,work_date").eq("employee_id",e.id).eq("status","open").maybeSingle();
          const near = (a:string,b2:string)=>{ if(!a||!b2) return false; const m=(t:string)=>parseInt(t.slice(0,2))*60+parseInt(t.slice(3,5)); return Math.abs(m(a)-m(b2))<=7; };
          // clock-in reminder: shift_start ~now, not already reminded today, no open punch, nothing completed today
          if(e.shift_start && String(e.clock_remind_in_date||"")!==today && near(hhmm, String(e.shift_start).slice(0,5)) && !open){
            const { count } = await sb.from("hr_timeclock").select("id",{count:"exact",head:true}).eq("employee_id",e.id).eq("work_date",today);
            if(!count){ await rcSendEmail(e.email, "[HR OS] Time to clock in", "Hi "+(e.name||"")+",\n\nYour shift is starting. Please clock in:\n  "+clkBase+"\n\n(Tip: add HR OS to your phone home screen for one-tap clock-in.)\n\n— CTG HR OS (automated)");
              await sb.from("hr_employees").update({ clock_remind_in_date: today }).eq("id",e.id); sent++; }
          }
          // clock-out reminder: shift_end ~now, still open, not already reminded today
          if(e.shift_end && String(e.clock_remind_out_date||"")!==today && near(hhmm, String(e.shift_end).slice(0,5)) && open){
            await rcSendEmail(e.email, "[HR OS] Don’t forget to clock out", "Hi "+(e.name||"")+",\n\nYour shift is ending and you’re still clocked in. Please clock out:\n  "+clkBase+"\n\n— CTG HR OS (automated)");
            await sb.from("hr_employees").update({ clock_remind_out_date: today }).eq("id",e.id); sent++;
          }
        }
        try { await sb.from("portal_audit").insert({ action:"cron_clock_reminders", ref:hhmm, detail:{ sent } }); } catch(_e){}
      } catch(e){ try { await sb.from("portal_audit").insert({ action:"cron_clock_reminders_error", detail:{ error:String(e) } }); } catch(_e){} } })();
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else work.catch(()=>{});
      return j({ ok:true, started:true });
    }
    if (api === "hr_emp_save") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const f = b.emp||{};
      // Bank: store the master-list CODE as source of truth; resolve the canonical display name from it
      // (keeps the payroll BIC file + vouchers working). Legacy records with no code keep their typed name.
      let bankCode = String(f.bankCode||"").trim() || null;
      let bankName = String(f.bankName||"").trim() || null;
      if (bankCode){ const { data: bk } = await sb.from("hr_banks").select("name").eq("code",bankCode).maybeSingle(); if (bk) bankName = bk.name; else bankCode = null; }
      const bankAccount = String(f.bankAccount||"").replace(/\D/g,"").slice(0,20) || null; // digits only, max 20, trimmed
      const bankHolder = String(f.bankHolder||"").trim() || null;
      const patch: any = {
        name:f.name, ic_no:f.ic||null, email:f.email||null, dept:f.dept||null, position:f.position||null,
        employment_type: (["Full-time","Part-time","Contract","Intern","Probation"].indexOf(String(f.employmentType))>=0 ? f.employmentType : "Full-time"),
        basic_salary:Number(f.basic)||0, fixed_allowance:Number(f.allowance)||0,
        bank_code:bankCode, bank_name:bankName, bank_account:bankAccount, bank_holder:bankHolder,
        epf_no:f.epfNo||null, socso_no:f.socsoNo||null, tax_no:f.taxNo||null,
        phone:f.phone||null, address:f.address||null, resident:f.resident!==false,
        epf_eligible:f.epf!==false, socso_eligible:f.socso!==false, eis_eligible:f.eis!==false,
        marital_status:f.maritalStatus||"single", spouse_working:!!f.spouseWorking, num_children:Number(f.numChildren)||0,
        date_of_birth:f.dob||null,
        join_date:f.joinDate||null,
        epf_ee_rate:(f.epfEeRate===""||f.epfEeRate==null)?null:Number(f.epfEeRate),
        socso_category:(f.socsoCategory===""||f.socsoCategory==null)?null:Number(f.socsoCategory),
        manager_id:f.managerId||null,
        claim_role:(f.claimRole===""||f.claimRole==null)?null:f.claimRole,
        pay_type:(["monthly","hourly","daily"].indexOf(String(f.payType))>=0?f.payType:"monthly"),
        hourly_rate:(f.hourlyRate===""||f.hourlyRate==null)?null:Number(f.hourlyRate),
        daily_rate:(f.dailyRate===""||f.dailyRate==null)?null:Number(f.dailyRate),
        shift_start:(String(f.shiftStart||"").trim()||null),
        shift_end:(String(f.shiftEnd||"").trim()||null),
        clock_reminder:!!f.clockReminder,
      };
      // Status / resignation (only touched when the form sends it, so we never clobber an existing status on partial saves)
      if (f.status !== undefined && f.status !== null && String(f.status) !== "") {
        const st = String(f.status).toLowerCase()==="resigned" ? "resigned" : "active";
        patch.status = st;
        patch.resign_date = st==="resigned" ? (String(f.resignDate||"").slice(0,10) || new Date(Date.now()+8*3600*1000).toISOString().slice(0,10)) : null;
      }
      let res:any;
      if (f.id){ res = await sb.from("hr_employees").update(patch).eq("id",f.id).select().single(); }
      else {
        const tenant = String(b.tenant||f.tenant||"");
        if (!tenant) return j({ ok:false, error:"no company selected" });
        // Numeric max, not lexicographic: order("emp_no" desc) on TEXT ranks "E999" above "E1000",
        // which would hand out an already-taken number once headcount passes 999.
        const { data:allNos } = await sb.from("hr_employees").select("emp_no").range(0,4999);
        let maxN=0; (allNos||[]).forEach((r:any)=>{ const m=String(r.emp_no||"").match(/^E(\d+)$/i); if(m){ const v=parseInt(m[1],10); if(v>maxN) maxN=v; } });
        patch.emp_no = "E"+String(maxN+1).padStart(3,"0"); patch.status="active"; patch.tenant_id=tenant;
        res = await sb.from("hr_employees").insert(patch).select().single();
      }
      if (res.error) return j({ ok:false, error:res.error.message });
      await logAudit(me,"hr_emp_save",String(res.data&&res.data.id),{ name:f.name });
      return j({ ok:true, employee:res.data });
    }
    if (api === "hr_emp_delete") {
      // Permanently delete a RESIGNED employee. Most child rows CASCADE at the DB; hr_payslips is RESTRICT,
      // so an employee with payroll history is protected unless the caller explicitly forces it.
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const id = String(b.id||""); if (!id) return j({ ok:false, error:"No employee specified." });
      const { data: emp } = await sb.from("hr_employees").select("id,name,status,resign_date,tenant_id").eq("id",id).maybeSingle();
      if (!emp) return j({ ok:false, error:"Employee not found." });
      const alw = await allowedTenants(b.token);
      if (emp.tenant_id && alw.length && alw.indexOf(emp.tenant_id) < 0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403);
      const stat = String(emp.status||"").toLowerCase();
      const resigned = stat==="resigned" || ["inactive","terminated","left","ex-staff"].indexOf(stat) >= 0 || !!emp.resign_date;
      if (!resigned) return j({ ok:false, error:"Only a resigned employee can be deleted — set their status to Resigned first." });
      const { count: pc } = await sb.from("hr_payslips").select("*",{ count:"exact", head:true }).eq("employee_id",id);
      const payslips = pc||0;
      if (payslips > 0 && !b.force) {
        return j({ ok:false, needs_confirm:true, payslips, error:"This employee has "+payslips+" payslip(s) on record. Deleting permanently erases their payroll history (EA / Form E source data)." });
      }
      try { await sb.from("hr_employees").update({ manager_id:null }).eq("manager_id",id); } catch(_e){} // release any staff reporting to them
      if (payslips > 0) { const pd = await sb.from("hr_payslips").delete().eq("employee_id",id); if (pd.error) return j({ ok:false, error:pd.error.message }); }
      const del = await sb.from("hr_employees").delete().eq("id",id); // cascades leave/claims/balances/attendance/timeclock/adjustments/approval-steps
      if (del.error) return j({ ok:false, error:del.error.message });
      await logAudit(me,"hr_emp_delete",id,{ name:emp.name, payslips, forced:!!b.force });
      return j({ ok:true, payslips });
    }
    if (api === "hr_leave_my") {
      // Employee self-service: their leave types, balances (this year), and requests.
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      let empId = who.employee ? who.employee.id : null;
      if (who.isAdmin && b.employee_id) empId = String(b.employee_id);
      if (!empId) return j({ ok:false, error:"Your login isn’t linked to an employee profile yet — ask HR to enable your access.", need_profile:true });
      if (who.isAdmin && b.employee_id){ const { data: te } = await sb.from("hr_employees").select("tenant_id").eq("id",empId).maybeSingle(); const alw=await allowedTenants(b.token); if(te && te.tenant_id && alw.length && alw.indexOf(te.tenant_id)<0) return denyTenant(me,"hr_leave_my",te.tenant_id); }
      const [typesR, reqR] = await Promise.all([
        sb.from("hr_leave_types").select("id,code,name,paid,color,default_days").eq("active",true).order("code"),
        sb.from("hr_leave_requests").select("*").eq("employee_id",empId).order("date_from",{ascending:false}).limit(200),
      ]);
      const yr = new Date(Date.now()+8*3600*1000).getUTCFullYear();
      const { data: bals } = await sb.from("hr_leave_balances").select("leave_type_id,entitled,taken").eq("employee_id",empId).eq("year",yr);
      const balMap:any = {}; (bals||[]).forEach((x:any)=>{ balMap[x.leave_type_id]=x; });
      const balances = (typesR.data||[]).map((t:any)=>{ const bl=balMap[t.id]||{}; const entitled = bl.entitled!=null?Number(bl.entitled):Number(t.default_days||0); const taken=Number(bl.taken||0); return { type:t.name, code:t.code, paid:t.paid, color:t.color, entitled, taken, remaining: Math.round((entitled-taken)*100)/100 }; });
      // attach the approval progress to each request
      const reqIds=(reqR.data||[]).map((r:any)=>r.id); const stepsByReq:any={};
      if(reqIds.length){ const { data: allSteps } = await sb.from("hr_leave_approval_steps").select("*").in("leave_request_id",reqIds).order("step_order"); (allSteps||[]).forEach((s:any)=>{ (stepsByReq[s.leave_request_id]=stepsByReq[s.leave_request_id]||[]).push(s); }); }
      const requests = (reqR.data||[]).map((r:any)=>({ ...r, steps: stepsByReq[r.id]||[] }));
      return j({ ok:true, types: typesR.data||[], requests, balances, year: yr });
    }
    if (api === "hr_my_payslips") {
      // Employee self-service: their own FINALISED payslips (figures from hr_payslips snapshot),
      // plus each period's adjustment breakdown and this year's leave balances → renders the PDF client-side.
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      let emp = who.employee;
      if (who.isAdmin && b.employee_id){ const { data: te } = await sb.from("hr_employees").select("*").eq("id",String(b.employee_id)).maybeSingle(); if(te){ const alw=await allowedTenants(b.token); if(te.tenant_id && alw.length && alw.indexOf(te.tenant_id)<0) return denyTenant(me,"hr_my_payslips",te.tenant_id); emp=te; } }
      if (!emp) return j({ ok:false, error:"Your login isn’t linked to an employee profile yet — ask HR to enable your access.", need_profile:true });
      // finalised runs for the employee's company (newest first)
      const { data: runs } = await sb.from("hr_payroll_runs").select("id,period_month,period_year,run_date,status").eq("tenant_id",emp.tenant_id).eq("status","finalised").order("period_year",{ascending:false}).order("period_month",{ascending:false});
      const runById:any={}; (runs||[]).forEach((r:any)=>{ runById[r.id]=r; });
      const runIds=(runs||[]).map((r:any)=>r.id);
      let slips:any[]=[];
      if (runIds.length){ const { data: ps } = await sb.from("hr_payslips").select("*").eq("employee_id",emp.id).in("run_id",runIds); slips=ps||[]; }
      // this employee's adjustments across the payslip periods → earnings/deduction breakdown
      const { data: adjAll } = await sb.from("hr_payroll_adjustments").select("*").eq("employee_id",emp.id);
      const adjByPeriod:any={}; (adjAll||[]).forEach((a:any)=>{ const k=a.period_year+"-"+a.period_month; (adjByPeriod[k]=adjByPeriod[k]||[]).push(a); });
      const sumK=(list:any[],k:string)=> (list||[]).filter((a:any)=>a.kind===k).reduce((s:number,a:any)=>s+(Number(a.amount)||0),0);
      const payslips = slips.map((s:any)=>{ const r=runById[s.run_id]||{}; const key=r.period_year+"-"+r.period_month; const adj=adjByPeriod[key]||[];
        return { month:r.period_month, year:r.period_year, run_date:r.run_date,
          p:{ gross:Number(s.gross)||0, epfEe:Number(s.epf_ee)||0, epfEr:Number(s.epf_er)||0, socsoEe:Number(s.socso_ee)||0, socsoEr:Number(s.socso_er)||0, eisEe:Number(s.eis_ee)||0, eisEr:Number(s.eis_er)||0, pcb:Number(s.pcb)||0, net:Number(s.net)||0, employerCost:Number(s.employer_cost)||0, _meta:{} },
          d:{ bonus:sumK(adj,"bonus"), ot:sumK(adj,"ot"), allowance:sumK(adj,"allowance"), unpaid:sumK(adj,"unpaid_leave"), deductions:(adj.filter((a:any)=>a.kind==="deduction").map((a:any)=>({ label:a.label||"Deduction", amount:Number(a.amount)||0 }))) } };
      }).sort((a:any,b:any)=> (b.year-a.year) || (b.month-a.month));
      // paid-leave balances (current year) for the payslip footer
      const yr2 = new Date(Date.now()+8*3600*1000).getUTCFullYear();
      const { data: ltypes } = await sb.from("hr_leave_types").select("id,code,name,paid,default_days").eq("active",true).order("code");
      const { data: lbals } = await sb.from("hr_leave_balances").select("leave_type_id,entitled,taken").eq("employee_id",emp.id).eq("year",yr2);
      const lbMap:any={}; (lbals||[]).forEach((x:any)=>{ lbMap[x.leave_type_id]=x; });
      const leaveBal = (ltypes||[]).filter((t:any)=>t.paid).map((t:any)=>{ const bl=lbMap[t.id]||{}; const entitled=bl.entitled!=null?Number(bl.entitled):Number(t.default_days||0); const taken=Number(bl.taken||0); return { type:t.name, code:t.code, entitled, taken, remaining:Math.round((entitled-taken)*100)/100 }; });
      return j({ ok:true, payslips, leaveBal, year:yr2 });
    }
    if (api === "hr_my_profile_save") {
      // Employee self-service: update their OWN personal details on the hr_employees MASTER record.
      // Whitelisted personal fields only — employment/pay fields (name, dept, position, salary, status…)
      // stay HR-managed via hr_emp_save. Every change is audit-logged with old → new values.
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      if (!who.employee) return j({ ok:false, error:"Your login isn’t linked to an employee profile yet — ask HR to enable your access.", need_profile:true });
      const old:any = who.employee; const f = b.profile||{};
      const s = (v:any, max=120)=>{ const t=String(v==null?"":v).trim().slice(0,max); return t||null; };
      const upd:any = {
        phone: s(f.phone,30), address: s(f.address,300),
        emergency_name: s(f.emergencyName,80), emergency_phone: s(f.emergencyPhone,30),
        ic_no: s(f.ic,30), gender: s(f.gender,20), nationality: s(f.nationality,40),
        date_of_birth: (String(f.dob||"").slice(0,10) || null),
        marital_status: (["single","married","divorced","widowed"].indexOf(String(f.maritalStatus||"").toLowerCase())>=0 ? String(f.maritalStatus).toLowerCase() : "single"),
        spouse_working: !!f.spouseWorking,
        num_children: Math.max(0, Math.min(20, Number(f.numChildren)||0)),
        epf_no: s(f.epfNo,30), socso_no: s(f.socsoNo,30), tax_no: s(f.taxNo,30),
        bank_holder: s(f.bankHolder,80),
        bank_account: (String(f.bankAccount||"").replace(/\D/g,"").slice(0,20) || null),
      };
      // Bank: same convention as hr_emp_save — the master-list CODE is the source of truth, name resolved from it.
      let bankCode = s(f.bankCode,20);
      if (bankCode){ const { data: bk } = await sb.from("hr_banks").select("name").eq("code",bankCode).maybeSingle(); if (bk){ upd.bank_code=bankCode; upd.bank_name=bk.name; } }
      else { upd.bank_code=null; upd.bank_name=old.bank_name||null; } // cleared code keeps any legacy typed name
      // Diff against the current row → audit only what actually changed; no-op saves don't touch the record.
      const changed:any = {};
      for (const k in upd){ const a=old[k]==null?"":String(old[k]); const bv=upd[k]==null?"":String(upd[k]); if (a!==bv) changed[k]={ from:old[k]??null, to:upd[k]??null }; }
      if (!Object.keys(changed).length) return j({ ok:true, unchanged:true, employee: old });
      upd.updated_at = new Date().toISOString();
      const res = await sb.from("hr_employees").update(upd).eq("id",old.id).select().single();
      if (res.error) return j({ ok:false, error:res.error.message });
      await logAudit(me,"hr_my_profile_save",String(old.id),{ name:old.name, changed });
      return j({ ok:true, employee: res.data, changed: Object.keys(changed) });
    }
    if (api === "hr_leave_apply") {
      // Employee submits a leave request → status Pending; admin approves in the Leave tab.
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      let empId = who.employee ? who.employee.id : null;
      if (who.isAdmin && b.employee_id) empId = String(b.employee_id);
      if (!empId) return j({ ok:false, error:"Your login isn’t linked to an employee profile yet — ask HR to enable your access." });
      if (who.isAdmin && b.employee_id){ const { data: te } = await sb.from("hr_employees").select("tenant_id").eq("id",empId).maybeSingle(); const alw=await allowedTenants(b.token); if(te && te.tenant_id && alw.length && alw.indexOf(te.tenant_id)<0) return denyTenant(me,"hr_leave_apply",te.tenant_id); }
      const from = String(b.date_from||"").slice(0,10), to = String(b.date_to||"").slice(0,10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return j({ ok:false, error:"Pick a start and end date." });
      if (to < from) return j({ ok:false, error:"End date can’t be before start date." });
      let typeName = String(b.leave_type||"").trim();
      if (b.leave_type_id){ const { data: lt } = await sb.from("hr_leave_types").select("name").eq("id",String(b.leave_type_id)).maybeSingle(); if(lt) typeName = lt.name; }
      if (!typeName) return j({ ok:false, error:"Select a leave type." });
      // Working days (Mon–Fri) inclusive; half-day only for a single date. Public holidays not auto-deducted.
      let days:number;
      if (b.half_day && from===to) days = 0.5;
      else { let d=new Date(from+"T00:00:00Z"); const end=new Date(to+"T00:00:00Z"); let n=0, guard=0; while(d<=end && guard<400){ const dow=d.getUTCDay(); if(dow!==0&&dow!==6) n++; d=new Date(d.getTime()+86400000); guard++; } days=n; }
      if (days<=0) return j({ ok:false, error:"That range has no working days (weekends are excluded)." });
      const { data: ins, error } = await sb.from("hr_leave_requests").insert({ employee_id:empId, leave_type:typeName, date_from:from, date_to:to, days, reason:String(b.reason||"").slice(0,500)||null, status:"Submitted", current_step:1 }).select().single();
      if (error) return j({ ok:false, error: error.message });
      // Build the multi-level approval chain (configurable in hr_leave_flow_steps: a specific employee, the
      // applicant's direct manager, or a role holder).
      let firstStatus = "Pending";
      try {
        const { data: flow } = await sb.from("hr_leave_flow_steps").select("*").eq("active",true).order("step_order");
        const { data: empRow } = await sb.from("hr_employees").select("manager_id").eq("id",empId).maybeSingle();
        const stepStatus = (s:any)=> s.approver_type==="employee" ? "Pending Approval" : rcStatusForRole(s.approver_role);
        const steps = (flow||[]).map((s:any,i:number)=>({
          leave_request_id: ins.id, step_order: i+1, name: s.name,
          approver_role: (s.approver_type==="employee" ? null : s.approver_role),
          approver_employee_id: (s.approver_type==="employee" ? (s.approver_employee_id||null) : (s.approver_type==="manager" ? ((empRow&&empRow.manager_id)||null) : null)),
          status:"Pending",
        }));
        if(steps.length){ await sb.from("hr_leave_approval_steps").insert(steps); firstStatus = stepStatus(flow[0]); }
        await sb.from("hr_leave_requests").update({ status:firstStatus, current_step:1 }).eq("id",ins.id);
      } catch(_e){}
      // Admin "record / apply on behalf" with immediate approval — used to log MC / leave that already happened.
      if (who.isAdmin && b.auto_approve) {
        const actor=(me.user&&me.user.id)||null; const nowIso=new Date().toISOString();
        await sb.from("hr_leave_approval_steps").update({ status:"Approved", decided_by:actor, decided_at:nowIso, comment:"Recorded by admin" }).eq("leave_request_id",ins.id);
        await sb.from("hr_leave_requests").update({ status:"Approved" }).eq("id",ins.id);
        try {
          const year = new Date(from).getFullYear();
          const { data:lt2 } = await sb.from("hr_leave_types").select("id,paid,default_days").eq("name",typeName).maybeSingle();
          if (lt2 && lt2.paid) {
            const { data:bal } = await sb.from("hr_leave_balances").select("id,taken").eq("employee_id",empId).eq("leave_type_id",lt2.id).eq("year",year).maybeSingle();
            if (bal) await sb.from("hr_leave_balances").update({ taken:Number(bal.taken||0)+Number(days) }).eq("id",bal.id);
            else await sb.from("hr_leave_balances").insert({ employee_id:empId, leave_type_id:lt2.id, year, entitled:Number(lt2.default_days||0), taken:Number(days) });
          }
        } catch(_e){}
        await logAudit(me,"hr_leave_apply",String(ins.id),{ on_behalf:true, auto_approve:true, days });
        return j({ ok:true, request:{...ins, status:"Approved"}, days, approved:true });
      }
      try { await leaveNotifyStep(ins.id); } catch(_e){}
      return j({ ok:true, request: {...ins, status:firstStatus}, days });
    }
    if (api === "hr_leave_cancel") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      const { data: req } = await sb.from("hr_leave_requests").select("*").eq("id",String(b.id)).maybeSingle();
      if(!req) return j({ ok:false, error:"not found" });
      if(!who.isAdmin && (!who.employee || req.employee_id!==who.employee.id)) return j({ ok:false, error:"forbidden" }, 403);
      if(["Approved","Rejected","Cancelled"].indexOf(String(req.status))>=0) return j({ ok:false, error:"This request is already "+req.status+" and can’t be cancelled." });
      await sb.from("hr_leave_requests").update({ status:"Cancelled" }).eq("id",String(b.id));
      return j({ ok:true });
    }
    if (api === "hr_leave_pending") {
      // Approver queue: leave requests whose CURRENT step is this caller's (manager / their role), or all for admin.
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      if(!who.employee && !who.isAdmin) return j({ ok:true, requests:[] });
      const { data: reqs } = await sb.from("hr_leave_requests").select("*, hr_employees(name,emp_no,dept)").order("date_from",{ascending:false}).limit(300);
      const pend=(reqs||[]).filter((r:any)=>["Approved","Rejected","Cancelled"].indexOf(String(r.status))<0);
      const out:any[]=[];
      for(const r of pend){
        const { data: step } = await sb.from("hr_leave_approval_steps").select("*").eq("leave_request_id",r.id).eq("step_order",r.current_step||1).maybeSingle();
        if(!step) { if(who.isAdmin) out.push({ ...r, current_step_name:"(no chain)" }); continue; }
        const mine = who.isAdmin || (step.approver_employee_id && who.employee && step.approver_employee_id===who.employee.id) || (step.approver_role && who.roles && who.roles.indexOf(step.approver_role)>=0);
        if(mine) out.push({ ...r, current_step_name: step.name||step.approver_role });
      }
      return j({ ok:true, requests: out });
    }
    if (api === "hr_leave_flow_get") {
      const me = await meFromToken(b.token); if (!hrCanView(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.from("hr_leave_flow_steps").select("*").order("step_order");
      return j({ ok:true, steps: data||[] });
    }
    if (api === "hr_leave_admin") {
      // Admin Leave tab: all requests with their approval steps + the current flow config.
      const me = await meFromToken(b.token); if (!hrCanView(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data: reqs } = await sb.from("hr_leave_requests").select("*, hr_employees(name,emp_no,dept)").order("date_from",{ascending:false}).limit(400);
      const ids=(reqs||[]).map((r:any)=>r.id); const stepsByReq:any={};
      if(ids.length){ const { data: st } = await sb.from("hr_leave_approval_steps").select("*").in("leave_request_id",ids).order("step_order"); (st||[]).forEach((s:any)=>{ (stepsByReq[s.leave_request_id]=stepsByReq[s.leave_request_id]||[]).push(s); }); }
      const requests=(reqs||[]).map((r:any)=>({ ...r, steps: stepsByReq[r.id]||[] }));
      const { data: flow } = await sb.from("hr_leave_flow_steps").select("*").order("step_order");
      // Employees of the selected company — powers the apply-on-behalf picker, balance editor & name-based flow.
      const tenant = String(b.tenant||"");
      const empQ = tenant ? await sb.from("hr_employees").select("id,name,emp_no").eq("tenant_id",tenant).eq("status","active").order("emp_no")
                          : await sb.from("hr_employees").select("id,name,emp_no").eq("status","active").order("emp_no").limit(500);
      const { data: types } = await sb.from("hr_leave_types").select("id,code,name,paid,default_days").eq("active",true).order("code");
      return j({ ok:true, requests, flow: flow||[], employees: empQ.data||[], leave_types: types||[] });
    }
    if (api === "hr_leave_flow_save") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const steps = Array.isArray(b.steps) ? b.steps : [];
      const clean = steps.map((s:any,i:number)=>{
        const t = s.approver_type==="employee" ? "employee" : (s.approver_type==="manager" ? "manager" : "role");
        return {
          step_order:i+1,
          name:String(s.name||s.approver_role||"Step").slice(0,60),
          approver_type:t,
          approver_role:(t==="role" ? (String(s.approver_role||"").trim()||null) : null),
          approver_employee_id:(t==="employee" ? (String(s.approver_employee_id||"").trim()||null) : null),
          active:true,
        };
      }).filter((s:any)=> s.approver_type==="manager" || (s.approver_type==="role" && s.approver_role) || (s.approver_type==="employee" && s.approver_employee_id));
      await sb.from("hr_leave_flow_steps").delete().gte("step_order",0);
      if(clean.length) await sb.from("hr_leave_flow_steps").insert(clean);
      await logAudit(me,"hr_leave_flow_save",String(clean.length),{});
      const { data } = await sb.from("hr_leave_flow_steps").select("*").order("step_order");
      return j({ ok:true, steps: data||[] });
    }
    if (api === "hr_leave_balance_save") {
      // Admin adjusts an employee's leave entitlement / taken for a given year & type (Annual, Medical/MC, …).
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const empId = String(b.employee_id||""); const ltId = String(b.leave_type_id||"");
      const year = Number(b.year)|| new Date(Date.now()+8*3600*1000).getUTCFullYear();
      if (!empId || !ltId) return j({ ok:false, error:"employee and leave type are required" });
      // tenant guard
      const { data: emp } = await sb.from("hr_employees").select("tenant_id").eq("id",empId).maybeSingle();
      if (!emp) return j({ ok:false, error:"Employee not found." });
      const alw = await allowedTenants(b.token);
      if (emp.tenant_id && alw.length && alw.indexOf(emp.tenant_id) < 0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403);
      const entitled = Math.max(0, Number(b.entitled)||0);
      const taken = Math.max(0, Number(b.taken)||0);
      const { data: existing } = await sb.from("hr_leave_balances").select("id").eq("employee_id",empId).eq("leave_type_id",ltId).eq("year",year).maybeSingle();
      let res:any;
      if (existing) res = await sb.from("hr_leave_balances").update({ entitled, taken }).eq("id",existing.id);
      else res = await sb.from("hr_leave_balances").insert({ employee_id:empId, leave_type_id:ltId, year, entitled, taken });
      if (res.error) return j({ ok:false, error:res.error.message });
      await logAudit(me,"hr_leave_balance_save",empId,{ leave_type_id:ltId, year, entitled, taken });
      return j({ ok:true });
    }
    if (api === "hr_leave_decide") {
      // Step-aware: the current step's approver (manager / role) or an admin acts; advances or finalises.
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      const id=String(b.id);
      let decision = String(b.decision||"").toLowerCase();
      if(!decision && b.status){ const s=String(b.status); decision = s==="Approved"?"approve":(s==="Rejected"?"reject":""); }
      if(["approve","reject"].indexOf(decision)<0) return j({ ok:false, error:"invalid decision" });
      const { data:req } = await sb.from("hr_leave_requests").select("*").eq("id",id).maybeSingle();
      if (!req) return j({ ok:false, error:"not found" });
      if(["Approved","Rejected","Cancelled"].indexOf(String(req.status))>=0) return j({ ok:false, error:"Already handled — this request is "+req.status+"." });
      const { data: step } = await sb.from("hr_leave_approval_steps").select("*").eq("leave_request_id",id).eq("step_order",req.current_step||1).maybeSingle();
      const canAct = who.isAdmin || (step && ((step.approver_employee_id && who.employee && step.approver_employee_id===who.employee.id) || (step.approver_role && who.roles && who.roles.indexOf(step.approver_role)>=0)));
      if(!canAct) return j({ ok:false, error:"You are not the approver for this step." }, 403);
      const actor=(me.user&&me.user.id)||null; const nowIso=new Date().toISOString(); const comment=String(b.comment||"").slice(0,500);
      const { data: emp } = await sb.from("hr_employees").select("name,email").eq("id",req.employee_id).maybeSingle();
      if(decision==="reject"){
        if(step) await sb.from("hr_leave_approval_steps").update({ status:"Rejected", decided_by:actor, decided_at:nowIso, comment }).eq("id",step.id);
        await sb.from("hr_leave_requests").update({ status:"Rejected" }).eq("id",id);
        await logAudit(me,"hr_leave_decide",id,{ decision:"reject", step:step&&step.name });
        try{ if(emp&&emp.email) await rcSendEmail(emp.email, "[HR OS] Your leave request was not approved", "Hi "+((emp&&emp.name)||"")+",\n\nYour "+req.leave_type+" leave "+req.date_from+" → "+req.date_to+" was rejected"+(comment?(" — "+comment):".")+"\n\n— CTG HR OS (automated)"); }catch(_e){}
        return j({ ok:true, status:"Rejected" });
      }
      // approve current step
      if(step) await sb.from("hr_leave_approval_steps").update({ status:"Approved", decided_by:actor, decided_at:nowIso, comment }).eq("id",step.id);
      const { data: allSteps } = await sb.from("hr_leave_approval_steps").select("*").eq("leave_request_id",id).order("step_order");
      const next=(allSteps||[]).find((s:any)=>s.step_order>(req.current_step||1));
      if(next){
        const st=(next.approver_role?rcStatusForRole(next.approver_role):"Pending Approval"); // employee-type step has null role
        await sb.from("hr_leave_requests").update({ status:st, current_step:next.step_order }).eq("id",id);
        await logAudit(me,"hr_leave_decide",id,{ decision:"approve", advanced:true, to:st });
        try{ await leaveNotifyStep(id); }catch(_e){}
        return j({ ok:true, status:st, advanced:true });
      }
      // final approval → mark Approved + deduct the paid-type balance once
      await sb.from("hr_leave_requests").update({ status:"Approved" }).eq("id",id);
      try{
        const year = new Date(req.date_from).getFullYear();
        const { data:lt } = await sb.from("hr_leave_types").select("id,paid,default_days").eq("name",req.leave_type).maybeSingle();
        if (lt && lt.paid){
          const { data:bal } = await sb.from("hr_leave_balances").select("id,taken").eq("employee_id",req.employee_id).eq("leave_type_id",lt.id).eq("year",year).maybeSingle();
          if (bal) await sb.from("hr_leave_balances").update({ taken: Number(bal.taken||0)+Number(req.days) }).eq("id",bal.id);
          else await sb.from("hr_leave_balances").insert({ employee_id:req.employee_id, leave_type_id:lt.id, year, entitled:Number(lt.default_days||0), taken:Number(req.days) });
        }
      }catch(_e){}
      await logAudit(me,"hr_leave_decide",id,{ decision:"approve", final:true });
      try{ if(emp&&emp.email) await rcSendEmail(emp.email, "[HR OS] Your leave request is approved ✓", "Hi "+((emp&&emp.name)||"")+",\n\nYour "+req.leave_type+" leave "+req.date_from+" → "+req.date_to+" ("+req.days+" day(s)) is fully approved.\n\n— CTG HR OS (automated)"); }catch(_e){}
      return j({ ok:true, status:"Approved", final:true });
    }
    if (api === "hr_claim_decide") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      { const { data: rec } = await sb.from("hr_claims").select("tenant_id").eq("id",String(b.id)).maybeSingle();
        const alw = await allowedTenants(b.token); if (rec && alw.length && rec.tenant_id && alw.indexOf(rec.tenant_id) < 0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }
      const { error } = await sb.from("hr_claims").update({ status:String(b.status||"") }).eq("id",String(b.id));
      if (error) return j({ ok:false, error:error.message });
      await logAudit(me,"hr_claim_decide",String(b.id),{ status:b.status });
      return j({ ok:true });
    }
    if (api === "hr_payroll_data") {
      const me = await meFromToken(b.token); if (!hrCanView(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const mo=Number(b.month), yr=Number(b.year); const tenant=String(b.tenant||"");
      if (!tenant) return j({ ok:false, error:"no company selected" });
      { const alw=await allowedTenants(b.token); if(alw.length && alw.indexOf(tenant)<0) return denyTenant(me,"hr_payroll_data",tenant); }
      const emp = await sb.from("hr_employees").select("*").eq("status","active").eq("tenant_id",tenant).order("emp_no");
      const empIds = (emp.data||[]).map((e:any)=>e.id);
      const [rt, adj, run] = await Promise.all([
        sb.from("hr_statutory_rates").select("rates").eq("id",1).single(),
        empIds.length? sb.from("hr_payroll_adjustments").select("*").eq("period_month",mo).eq("period_year",yr).in("employee_id",empIds).order("created_at") : Promise.resolve({data:[]} as any),
        sb.from("hr_payroll_runs").select("*").eq("tenant_id",tenant).eq("period_month",mo).eq("period_year",yr).maybeSingle(),
      ]);
      let payslips:any[]=[];
      if (run.data){ const ps=await sb.from("hr_payslips").select("*").eq("run_id",run.data.id); payslips=ps.data||[]; }
      // Attendance hours/days this month per employee → the grid auto-fills hourly/daily part-timers' basic.
      const attendance:any = {};
      if (empIds.length){
        const mFrom = yr+"-"+String(mo).padStart(2,"0")+"-01";
        const mTo = (mo===12)?((yr+1)+"-01-01"):(yr+"-"+String(mo+1).padStart(2,"0")+"-01");
        let arows:any[]=[];
        for(let off=0; off<20000; off+=1000){
          const { data: pg } = await sb.from("hr_timeclock").select("employee_id,hours,work_date,status").eq("tenant_id",tenant).gte("work_date",mFrom).lt("work_date",mTo).eq("status","complete").order("work_date").range(off,off+999);
          arows=arows.concat(pg||[]); if(!pg || pg.length<1000) break;
        }
        for(const r of arows){ const a=attendance[r.employee_id]||(attendance[r.employee_id]={hours:0,days:new Set()}); a.hours+=Number(r.hours)||0; a.days.add(r.work_date); }
        for(const k in attendance){ attendance[k]={ hours:Math.round(attendance[k].hours*100)/100, days:attendance[k].days.size }; }
      }
      // Paid-leave balances (this payroll year) per employee → printed on the payslip.
      const leaveBalances:any = {};
      if (empIds.length){
        const { data: ltypes } = await sb.from("hr_leave_types").select("id,code,name,paid,default_days").eq("active",true).order("code");
        const { data: lbals } = await sb.from("hr_leave_balances").select("employee_id,leave_type_id,entitled,taken").in("employee_id",empIds).eq("year",yr);
        const balByEmp:any={}; (lbals||[]).forEach((x:any)=>{ (balByEmp[x.employee_id]=balByEmp[x.employee_id]||{})[x.leave_type_id]=x; });
        for(const id of empIds){
          leaveBalances[id]=(ltypes||[]).filter((t:any)=>t.paid).map((t:any)=>{ const bl=(balByEmp[id]||{})[t.id]||{}; const entitled=bl.entitled!=null?Number(bl.entitled):Number(t.default_days||0); const taken=Number(bl.taken||0); return { type:t.name, code:t.code, entitled, taken, remaining:Math.round((entitled-taken)*100)/100 }; });
        }
      }
      return j({ ok:true, employees:emp.data||[], rates:(rt.data&&rt.data.rates)||null, adjustments:adj.data||[], run:run.data||null, payslips, attendance, leaveBalances });
    }
    if (api === "hr_adj_add") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const a=b.adj||{};
      const { error } = await sb.from("hr_payroll_adjustments").insert({ employee_id:String(a.employeeId), period_month:Number(a.month), period_year:Number(a.year), kind:a.kind, label:a.label||null, amount:Number(a.amount)||0, epf_subject:a.epfSubject!==false });
      if (error) return j({ ok:false, error:error.message });
      await logAudit(me,"hr_adj_add",String(a.employeeId),{ kind:a.kind, amount:a.amount });
      return j({ ok:true });
    }
    if (api === "hr_adj_del") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { error } = await sb.from("hr_payroll_adjustments").delete().eq("id",String(b.id));
      if (error) return j({ ok:false, error:error.message });
      return j({ ok:true });
    }
    if (api === "hr_payroll_finalise") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const mo=Number(b.month), yr=Number(b.year), rows=Array.isArray(b.rows)?b.rows:[]; const tenant=String(b.tenant||"");
      if (!tenant) return j({ ok:false, error:"no company selected" });
      { const alw=await allowedTenants(b.token); if(alw.length && alw.indexOf(tenant)<0) return denyTenant(me,"hr_payroll_finalise",tenant); }
      const { data:run, error:e1 } = await sb.from("hr_payroll_runs").upsert({ tenant_id:tenant, period_month:mo, period_year:yr, status:"finalised" }, { onConflict:"tenant_id,period_month,period_year" }).select().single();
      if (e1) return j({ ok:false, error:e1.message });
      await sb.from("hr_payslips").delete().eq("run_id",run.id);
      const payload = rows.map((r:any)=>({ run_id:run.id, employee_id:r.employeeId, gross:r.gross, epf_ee:r.epfEe, epf_er:r.epfEr, socso_ee:r.socsoEe, socso_er:r.socsoEr, eis_ee:r.eisEe, eis_er:r.eisEr, pcb:r.pcb, net:r.net, employer_cost:r.employerCost }));
      if (payload.length){ const { error:e2 } = await sb.from("hr_payslips").insert(payload); if (e2) return j({ ok:false, error:e2.message }); }
      await logAudit(me,"hr_payroll_finalise",String(run.id),{ month:mo, year:yr, n:payload.length });
      return j({ ok:true, runId:run.id });
    }
    // ===== Reimbursement / Claim module (hr_rc_*) =====
    if (api === "hr_rc_config") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      if(!who.isAdmin && !who.employee) return j({ ok:false, error:"Your login isn’t linked to an employee profile yet. Ask HR to enable your access." });
      // Own record in FULL: self-service (My Profile prefill, payslip PDF basic/IC/bank) needs the whole
      // master row — it's the caller's own hr_employees data, nothing about anyone else.
      const meOut = { isAdmin:who.isAdmin, roles:who.roles, is_manager:who.is_manager, employee: who.employee||null };
      if(who.isAdmin){
        const tenant = String(b.tenant||"");
        const [types, rates, wfs, steps, policy, roleApprovers, emps, ccs] = await Promise.all([
          sb.from("hr_claim_types").select("*").order("sort_order"),
          sb.from("hr_mileage_rates").select("*").order("rate"),
          sb.from("hr_approval_workflows").select("*").order("priority",{ascending:false}),
          sb.from("hr_approval_workflow_steps").select("*").order("step_order"),
          sb.from("hr_claim_policy_rules").select("*"),
          sb.from("hr_claim_role_approvers").select("*"),
          sb.from("hr_employees").select("id,emp_no,name,dept,position,manager_id,claim_role,email,user_id").eq("tenant_id",tenant).eq("status","active").order("emp_no"),
          sb.from("hr_cost_centers").select("*").order("sort_order")
        ]);
        return j({ ok:true, me:meOut, claim_types:types.data||[], mileage_rates:rates.data||[], workflows:wfs.data||[], workflow_steps:steps.data||[], policy_rules:policy.data||[], role_approvers:roleApprovers.data||[], employees:emps.data||[], cost_centers:ccs.data||[] });
      }
      const [types, rates, ccs] = await Promise.all([ sb.from("hr_claim_types").select("*").eq("active",true).order("sort_order"), sb.from("hr_mileage_rates").select("*").eq("active",true).order("rate"), sb.from("hr_cost_centers").select("*").eq("active",true).order("sort_order") ]);
      let tenantName:any=null;
      if(who.employee){ try{ const { data:tn } = await sb.from("xero_tenants").select("tenant_name").eq("tenant_id",who.employee.tenant_id).maybeSingle(); tenantName=tn&&tn.tenant_name; }catch(_e){} }
      return j({ ok:true, me:meOut, tenant_name:tenantName, claim_types:types.data||[], mileage_rates:rates.data||[], cost_centers:ccs.data||[], employees: who.employee?[{id:who.employee.id,emp_no:who.employee.emp_no,name:who.employee.name}]:[] });
    }
    if (api === "hr_rc_enable_login") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data:e } = await sb.from("hr_employees").select("*").eq("id",b.employee_id).maybeSingle();
      if(!e) return j({ ok:false, error:"employee not found" });
      { const alw=await allowedTenants(b.token); if(alw.length && e.tenant_id && alw.indexOf(e.tenant_id)<0) return denyTenant(me,"hr_rc_enable_login",e.tenant_id); }
      if(e.user_id) return j({ ok:true, already:true, email:e.email, name:e.name }); // already has a login — don't create a duplicate
      const email=String(b.email||e.email||"").trim().toLowerCase(); if(!email) return j({ ok:false, error:"This employee has no email — add one on their profile first.", no_email:true });
      const pass = String(b.password||"").trim() || ("Ctg"+Math.random().toString(36).slice(2,7)+Math.floor(Math.random()*90+10)+"!");
      const { data:uid, error } = await sb.rpc("portal_create_user", { p_email:email, p_name:e.name||email, p_pass:pass, p_role:"employee", p_tenants:[e.tenant_id] });
      if(error) return j({ ok:false, error:error.message });
      await sb.from("hr_employees").update({ user_id: uid, email: email }).eq("id", b.employee_id);
      await logAudit(me, "hr_claim_enable_login", email, { employee_id:b.employee_id });
      return j({ ok:true, email, temp_password:pass, name:e.name });
    }
    if (api === "hr_rc_enable_login_bulk") {
      // Enable an HR OS login for EVERY active employee of a company that has an email but no login yet.
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant=String(b.tenant||""); if(!tenant) return j({ ok:false, error:"no company selected" });
      { const alw=await allowedTenants(b.token); if(alw.length && alw.indexOf(tenant)<0) return denyTenant(me,"hr_rc_enable_login_bulk",tenant); }
      const { data:emps } = await sb.from("hr_employees").select("id,name,email,user_id,tenant_id").eq("tenant_id",tenant).eq("status","active").order("emp_no");
      const created:any[]=[]; const skipped:any[]=[];
      for(const e of (emps||[])){
        if(e.user_id){ skipped.push({ name:e.name, reason:"already enabled" }); continue; }
        const email=String(e.email||"").trim().toLowerCase();
        if(!email){ skipped.push({ name:e.name, reason:"no email" }); continue; }
        const pass = "Ctg"+Math.random().toString(36).slice(2,7)+Math.floor(Math.random()*90+10)+"!";
        const { data:uid, error } = await sb.rpc("portal_create_user", { p_email:email, p_name:e.name||email, p_pass:pass, p_role:"employee", p_tenants:[e.tenant_id] });
        if(error){ skipped.push({ name:e.name, reason:error.message }); continue; }
        await sb.from("hr_employees").update({ user_id: uid, email: email }).eq("id", e.id);
        created.push({ name:e.name, email, temp_password:pass });
      }
      await logAudit(me, "hr_rc_enable_login_bulk", tenant, { created:created.length, skipped:skipped.length });
      return j({ ok:true, created, skipped });
    }
    if (api === "hr_rc_save") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me); if(!who.isAdmin && !who.employee) return j({ ok:false, error:"no employee profile" });
      const c = b.claim||{};
      const empId = who.isAdmin ? (c.employee_id||null) : who.employee.id;
      const tenant = who.isAdmin ? String(b.tenant||"") : who.employee.tenant_id;
      const { data: allTypes } = await sb.from("hr_claim_types").select("id,is_mileage,taxable");
      const typeMap:any={}; (allTypes||[]).forEach((t:any)=>{ typeMap[t.id]=t; });
      const items:any[]|null = (Array.isArray(c.items)&&c.items.length) ? c.items : null;
      let amount=0, headerType:any=null, anyTaxable=false; const normItems:any[]=[];
      if(items){
        for(const it of items){
          const t=typeMap[it.claim_type_id]||{};
          // Mileage line (spec §4): final = km × rate + parking + toll. Other lines: entered amount.
          const amt = t.is_mileage
            ? Math.round(((Number(it.total_km)||0)*(Number(it.mileage_rate)||0)+(Number(it.parking_amount)||0)+(Number(it.toll_amount)||0))*100)/100
            : (Number(it.amount)||0);
          amount+=amt; if(t.taxable) anyTaxable=true;
          normItems.push({ claim_type_id:it.claim_type_id||null, item_date:it.item_date||c.claim_date||null, amount:amt, description:it.description||"",
            vendor_name:it.vendor_name||null, receipt_no:(String(it.receipt_no||"").trim()||null), invoice_no:(String(it.invoice_no||"").trim()||null),
            tax_amount:Number(it.tax_amount)||0, sst_amount:Number(it.sst_amount)||0, gl_account:(String(it.gl_account||"").trim()||null),
            cost_center:(String(it.cost_center||"").trim()||null), project:it.project||null, remarks:it.remarks||null,
            start_location:t.is_mileage?(it.start_location||null):null, end_location:t.is_mileage?(it.end_location||null):null,
            total_km:t.is_mileage?(Number(it.total_km)||0):null, mileage_rate:t.is_mileage?(Number(it.mileage_rate)||0):null,
            parking_amount:t.is_mileage?(Number(it.parking_amount)||0):0, toll_amount:t.is_mileage?(Number(it.toll_amount)||0):0, purpose:t.is_mileage?(it.purpose||null):null });
        }
        amount=Math.round(amount*100)/100;
        const distinct=Array.from(new Set(normItems.map((x:any)=>x.claim_type_id).filter(Boolean)));
        headerType = distinct.length===1 ? distinct[0] : null;
      } else {
        const t=typeMap[c.claim_type_id]||{}; headerType=c.claim_type_id||null; anyTaxable=!!t.taxable;
        amount = (t.is_mileage && c.mileage) ? Math.round(((Number(c.mileage.total_km)||0)*(Number(c.mileage.mileage_rate)||0)+(Number(c.mileage.parking_amount)||0)+(Number(c.mileage.toll_amount)||0))*100)/100 : (Number(c.amount)||0);
      }
      const row:any = { tenant_id:tenant, employee_id:empId, claim_type_id:headerType, claim_date:c.claim_date||null, amount, description:c.description||"", project:c.project||"", department:c.department||"", remarks:c.remarks||"", taxable:anyTaxable, payroll_applicable:false,
        claim_month:(String(c.claim_month||"").trim() || String(c.claim_date||"").slice(0,7) || null), cost_center:(String(c.cost_center||"").trim()||null), updated_at:new Date().toISOString() };
      let claimId=c.id;
      if(c.id){
        const { data: ex } = await sb.from("hr_claim_requests").select("status,employee_id").eq("id",c.id).maybeSingle();
        if(!ex) return j({ ok:false, error:"claim not found" });
        if(!who.isAdmin && ex.employee_id!==who.employee.id) return j({ ok:false, error:"forbidden" }, 403);
        if(!who.isAdmin) row.employee_id=ex.employee_id;
        if(ex && !["Draft","Need More Info"].includes(ex.status)) return j({ ok:false, error:"Claim can only be edited while Draft or Need More Info." });
        await sb.from("hr_claim_requests").update(row).eq("id",c.id);
      } else {
        row.status="Draft"; row.created_by=(me.user&&me.user.id)||null;
        const now=new Date(); row.claim_no="CLM-"+now.getUTCFullYear()+String(now.getUTCMonth()+1).padStart(2,"0")+"-"+String(Date.now()).slice(-6);
        const { data: ins, error } = await sb.from("hr_claim_requests").insert(row).select("id").single();
        if(error) return j({ ok:false, error:error.message });
        claimId=ins.id; await rcAuditLog(claimId,"create",me,null,"Draft",{});
      }
      if(items){
        await sb.from("hr_claim_items").delete().eq("claim_id",claimId);
        if(normItems.length) await sb.from("hr_claim_items").insert(normItems.map((x:any)=>({ ...x, claim_id:claimId })));
        await sb.from("hr_mileage_claim_details").delete().eq("claim_id",claimId);
      } else if(headerType && typeMap[headerType] && typeMap[headerType].is_mileage && c.mileage){
        await sb.from("hr_mileage_claim_details").delete().eq("claim_id",claimId);
        await sb.from("hr_mileage_claim_details").insert({ claim_id:claimId, start_location:c.mileage.start_location||"", end_location:c.mileage.end_location||"", total_km:Number(c.mileage.total_km)||0, mileage_rate:Number(c.mileage.mileage_rate)||0, calculated_amount:amount });
      }
      return j({ ok:true, id:claimId, amount });
    }
    if (api === "hr_rc_attach") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      const claimId=b.claim_id; if(!claimId) return j({ ok:false, error:"claim_id required" });
      if(!who.isAdmin){ const { data:oc } = await sb.from("hr_claim_requests").select("employee_id").eq("id",claimId).maybeSingle(); if(!oc || !who.employee || oc.employee_id!==who.employee.id) return j({ ok:false, error:"forbidden" }, 403); }
      const name=String(b.file_name||"receipt"); const b64=String(b.file_b64||""); let path:any=null; let upErr:any=null;
      if(b64){ try{ const bytes=Uint8Array.from(atob(b64.split(",").pop()), (ch)=>ch.charCodeAt(0)); path="claim/"+claimId+"/"+Date.now()+"_"+name.replace(/[^A-Za-z0-9._-]/g,"_"); const up=await sb.storage.from("hr-claim-receipts").upload(path, bytes, { contentType:b.file_type||"application/octet-stream", upsert:true }); if(up.error){ upErr=up.error.message||String(up.error); path=null; } }catch(e){ upErr=String(e).slice(0,200); path=null; } }
      // A failed upload must NOT leave a phantom attachment row — the "receipt required" gate counts rows,
      // so a rowed-but-not-stored receipt would let a claim through with no receipt on file.
      if(b64 && !path) return j({ ok:false, error:"Receipt upload failed — please try again ("+(upErr||"storage error")+")." });
      await sb.from("hr_claim_attachments").insert({ claim_id:claimId, file_name:name, file_path:path, file_type:b.file_type||null, file_size:Number(b.file_size)||null, receipt_hash:b.receipt_hash||null, uploaded_by:(me.user&&me.user.id)||null });
      return j({ ok:true, stored:!!path });
    }
    if (api === "hr_rc_ocr") {
      // Read an employee expense receipt with Claude vision → prefill an expense line. Available to any logged-in employee/admin.
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me); if(!who.isAdmin && !who.employee) return j({ ok:false, error:"Your login isn’t linked to an employee profile yet." });
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) return j({ ok:false, error:"Receipt OCR isn’t enabled yet — set ANTHROPIC_API_KEY as a Supabase Edge secret." });
      const b64 = String(b.file_b64||b.content_base64||"").split(",").pop() || "";
      if (!b64) return j({ ok:false, error:"no image provided" });
      const mime = String(b.file_type||b.content_type||"image/jpeg");
      const isPdf = mime.indexOf("pdf")>=0;
      const { data: types } = await sb.from("hr_claim_types").select("id,name").eq("active",true).order("sort_order");
      const typeNames = (types||[]).map((t:any)=>t.name);
      const sys = "You are reading an employee EXPENSE RECEIPT for a Malaysian company. Reply ONLY with a single JSON object — no prose, no markdown fences. Schema: { vendor: string, date: 'YYYY-MM-DD'|null, total: number, currency: 'MYR'|'USD'|'SGD'|string, description: string, category_guess: string, confidence: 'high'|'medium'|'low' }. 'total' = final amount paid (include tax & service charge). 'description' = short, e.g. 'Lunch — Starbucks KLCC'. 'category_guess' MUST be exactly one of these claim types: "+JSON.stringify(typeNames)+". If a value can't be read use null (strings) or 0 (total). MYR (Ringgit) is the most common currency; dates in Malaysia are usually DD/MM/YYYY — normalise to YYYY-MM-DD.";
      const media = isPdf ? { type:"document", source:{ type:"base64", media_type:"application/pdf", data:b64 } } : { type:"image", source:{ type:"base64", media_type:mime, data:b64 } };
      const body = { model:"claude-haiku-4-5-20251001", max_tokens:800, system:sys, messages:[{ role:"user", content:[ media, { type:"text", text:"Extract the receipt fields per the schema. JSON only." } ] }] };
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", { method:"POST", headers:{ "x-api-key":apiKey, "anthropic-version":"2023-06-01", "Content-Type":"application/json" }, body: JSON.stringify(body) });
        if (!r.ok){ const t=await r.text(); return j({ ok:false, error:"Vision API "+r.status+": "+t.slice(0,300) }); }
        const out = await r.json(); const txt=(out.content&&out.content[0]&&out.content[0].text)||"";
        let parsed:any=null; const m=txt.match(/\{[\s\S]*\}/); if(m){ try{ parsed=JSON.parse(m[0]); }catch(_e){} }
        if(!parsed) return j({ ok:false, error:"Couldn’t read that receipt — try a clearer, well-lit photo." });
        let typeId:any=null;
        if(parsed.category_guess){ const hit=(types||[]).find((t:any)=>String(t.name).toLowerCase()===String(parsed.category_guess).toLowerCase()); if(hit) typeId=hit.id; }
        await logAudit(me,"hr_rc_ocr",String(parsed.vendor||"(receipt)"),{ total:parsed.total, confidence:parsed.confidence });
        return j({ ok:true, extracted: parsed, claim_type_id: typeId });
      } catch(e){ return j({ ok:false, error:String(e).slice(0,300) }); }
    }
    if (api === "hr_rc_submit") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me); if(!who.isAdmin && !who.employee) return j({ ok:false, error:"no employee profile" });
      const id=b.id;
      const { data: claim } = await sb.from("hr_claim_requests").select("*").eq("id",id).maybeSingle();
      if(!claim) return j({ ok:false, error:"claim not found" });
      if(!who.isAdmin && claim.employee_id!==who.employee.id) return j({ ok:false, error:"forbidden" }, 403);
      const tenant = who.isAdmin ? String(b.tenant||"") : who.employee.tenant_id;
      if(!["Draft","Need More Info"].includes(claim.status)) return j({ ok:false, error:"Only Draft or Need More Info claims can be submitted." });
      const { data: type } = await sb.from("hr_claim_types").select("*").eq("id",claim.claim_type_id).maybeSingle();
      const { data: sItems } = await sb.from("hr_claim_items").select("amount").eq("claim_id",id);
      if(sItems && sItems.length){
        // Item amounts are server-computed at save time (mileage = km×rate + parking + toll), so the stored
        // amount IS the truth — recomputing km×rate here would silently drop parking/toll and underpay.
        let tot=0; for(const it of sItems){ tot += (Number(it.amount)||0); }
        tot=Math.round(tot*100)/100; if(tot!==Number(claim.amount)){ await sb.from("hr_claim_requests").update({amount:tot}).eq("id",id); claim.amount=tot; }
      } else if(type&&type.is_mileage){ const { data: md } = await sb.from("hr_mileage_claim_details").select("*").eq("claim_id",id).maybeSingle(); if(md){ const calc=Math.round(((Number(md.total_km)||0)*(Number(md.mileage_rate)||0)+(Number(md.parking_amount)||0)+(Number(md.toll_amount)||0))*100)/100; if(calc!==Number(claim.amount)){ await sb.from("hr_claim_requests").update({amount:calc}).eq("id",id); claim.amount=calc; } } }
      // Declaration gate (spec §6): all four statements must be ticked on EVERY submit/resubmit — no ticks, no submit.
      const dec = b.declarations||{};
      if(!(dec.business_purpose && dec.not_claimed_before && dec.receipts_valid && dec.understand_disciplinary))
        return j({ ok:false, error:"You must tick all four declaration statements before submitting." });
      const v = await rcValidate(claim, type, claim.employee_id);
      const warnings = v.warnings;
      if(v.errors && v.errors.length) return j({ ok:false, error:"Cannot submit:\n• "+v.errors.join("\n• "), errors:v.errors, warnings });
      await sb.from("hr_claim_declarations").insert({ claim_id:id, business_purpose:true, not_claimed_before:true, receipts_valid:true, understand_disciplinary:true, declared_by:(me.user&&me.user.id)||null });
      if(claim.status==="Need More Info"){
        const { data: inst } = await sb.from("hr_claim_approval_instances").select("*").eq("claim_id",id).maybeSingle();
        if(inst){
          const { data: step } = await sb.from("hr_claim_approval_steps").select("*").eq("instance_id",inst.id).eq("step_order",inst.current_step).maybeSingle();
          if(step) await sb.from("hr_claim_approval_steps").update({status:"Pending",decision:null,comment:null,acted_by:null,acted_at:null}).eq("id",step.id);
          const st=rcStatusForRole(step&&step.approver_role);
          await sb.from("hr_claim_requests").update({status:st, warnings, submitted_at:new Date().toISOString()}).eq("id",id);
          await rcAuditLog(id,"resubmit",me,"Need More Info",st,{});
          try{ await rcNotifyStepApprover(id); }catch(_e){}
          return j({ ok:true, status:st, warnings, resumed:true });
        }
      }
      const wf = await rcMatchWorkflow(tenant, claim);
      let steps:any[] = wf ? ((await sb.from("hr_approval_workflow_steps").select("*").eq("workflow_id",wf.id).order("step_order")).data||[]) : [];
      if(!steps.length){ steps=[{step_order:1,name:"Finance",approver_role:"finance",approver_type:"role"}]; }
      const emp=(await sb.from("hr_employees").select("manager_id").eq("id",claim.employee_id).maybeSingle()).data;
      const { data: inst } = await sb.from("hr_claim_approval_instances").upsert({ claim_id:id, workflow_id:wf?wf.id:null, current_step:1, status:"in_progress" }, {onConflict:"claim_id"}).select("id").single();
      await sb.from("hr_claim_approval_steps").delete().eq("instance_id",inst.id);
      await sb.from("hr_claim_approval_steps").insert(steps.map((s:any)=>({ instance_id:inst.id, claim_id:id, step_order:s.step_order, name:s.name, approver_role:s.approver_role, approver_employee_id:(s.approver_type==="manager"?(emp&&emp.manager_id):(s.approver_type==="user"?s.approver_employee_id:null)), status:"Pending" })));
      const st=rcStatusForRole(steps[0].approver_role);
      await sb.from("hr_claim_requests").update({ status:st, current_step:1, workflow_id:wf?wf.id:null, warnings, submitted_at:new Date().toISOString() }).eq("id",id);
      await rcAuditLog(id,"submit",me,claim.status,st,{ workflow: wf?wf.name:"(fallback Finance)", warnings });
      try{ await rcNotifyStepApprover(id); }catch(_e){}
      return j({ ok:true, status:st, warnings, workflow: wf?wf.name:"Finance only" });
    }
    if (api === "hr_rc_email_action") {
      // Tokenless portal-session-wise — gated ONLY by the one-time email action token.
      const tok=String(b.rc_token||"").trim(); const decision=String(b.do||""); const comment=String(b.comment||"");
      if(!tok || tok.length<40) return j({ ok:false, error:"invalid link" });
      if(["approve","reject"].indexOf(decision)<0) return j({ ok:false, error:"invalid action" });
      const { data: row } = await sb.from("hr_claim_email_actions").select("*").eq("token",tok).maybeSingle();
      if(!row) return j({ ok:false, error:"This link is not valid." });
      if(row.used_at) return j({ ok:false, error:"You already responded from this link." });
      if(new Date(row.expires_at).getTime()<Date.now()) return j({ ok:false, error:"This link has expired — please act in HR OS." });
      const { data: c } = await sb.from("hr_claim_requests").select("id,status,current_step,claim_no").eq("id",row.claim_id).maybeSingle();
      if(!c) return j({ ok:false, error:"claim not found" });
      const PENDING=["Submitted","Pending Manager Approval","Pending HR Approval","Pending Finance Approval","Pending Director Approval"];
      if(PENDING.indexOf(c.status)<0 || Number(c.current_step)!==Number(row.step_order)) return j({ ok:false, error:"Already handled — claim is now "+c.status+"." });
      const who = await rcWhoForEmp(row.approver_employee_id);
      if(!who) return j({ ok:false, error:"approver profile not found" });
      const meE = { user: { id: (who.employee&&who.employee.user_id)||null, email: String(row.approver_email||who.employee.email||"approver")+" (via email)" } };
      const res = await rcDecideOne(who, meE, row.claim_id, decision, comment, null, "");
      if(!res.ok) return j({ ok:false, error:res.error });
      await sb.from("hr_claim_email_actions").update({ used_at:new Date().toISOString() }).eq("id",row.id);
      await rcAuditLog(row.claim_id,"email_action",meE,null,res.status,{ decision, via:"email", approver: row.approver_email });
      try{ await rcNotifyDecision(res); }catch(_e){}
      return j({ ok:true, status:res.status });
    }
    if (api === "hr_rc_decide") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      const pin = who.isAdmin ? await allowedTenants(b.token) : null;
      const res = await rcDecideOne(who, me, b.id, String(b.decision||""), String(b.comment||""), b.override_amount, String(b.override_reason||""), pin);
      if(!res.ok) return j({ ok:false, error:res.error }, res.forbidden?403:200);
      await rcNotifyDecision(res);
      return j({ ok:true, status:res.status, advanced:res.advanced, final:res.final });
    }
    if (api === "hr_rc_decide_bulk") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      const decision=String(b.decision||"approve"); const comment=String(b.comment||"");
      const ids:any[] = Array.isArray(b.ids) ? b.ids.slice(0,200) : [];
      if(!ids.length) return j({ ok:false, error:"no claims selected" });
      if((decision==="reject"||decision==="request_info") && !comment.trim()) return j({ ok:false, error:"a reason / message is required for reject or request-info" });
      const pin = who.isAdmin ? await allowedTenants(b.token) : null;
      let done=0; const results:any[]=[];
      for(const id of ids){ const r=await rcDecideOne(who, me, id, decision, comment, null, "", pin); if(r.ok){ done++; try{ await rcNotifyDecision(r); }catch(_e){} } results.push({ id, ok:r.ok, status:r.status, error:r.error }); }
      return j({ ok:true, done, total:ids.length, results });
    }
    if (api === "hr_rc_set_gl") {
      // Finance/admin change an expense line's GL account — reason REQUIRED, audited (spec §5/§9/§15).
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me); if(!who.isAdmin && who.roles.indexOf("finance")<0) return j({ ok:false, error:"Only Finance or admin can change the GL account." }, 403);
      const reason=String(b.reason||"").trim(); if(!reason) return j({ ok:false, error:"A reason is required to change the GL account." });
      const gl=String(b.gl_account||"").trim(); if(!gl) return j({ ok:false, error:"gl_account required" });
      const { data: c } = await sb.from("hr_claim_requests").select("id,claim_no,status,xero_bill_id,tenant_id").eq("id",b.id).maybeSingle();
      if(!c) return j({ ok:false, error:"claim not found" });
      { const alw = await allowedTenants(b.token); if (alw.length && c.tenant_id && alw.indexOf(c.tenant_id) < 0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }
      if(c.xero_bill_id) return j({ ok:false, error:"Already posted to Xero — change the account on the Xero bill instead." });
      let q:any = sb.from("hr_claim_items").select("id,gl_account, hr_claim_types(name)").eq("claim_id",b.id);
      if(b.item_id) q=q.eq("id",b.item_id);
      const { data: its } = await q;
      if(!its || !its.length) return j({ ok:false, error:"no expense lines found" });
      for(const it of its){ await sb.from("hr_claim_items").update({ gl_account: gl }).eq("id",it.id); }
      const fromGls=Array.from(new Set(its.map((x:any)=>x.gl_account||((x.hr_claim_types&&x.hr_claim_types.gl_account)||"(type default)"))));
      await rcAuditLog(b.id,"gl_change",me,c.status,c.status,{ item_id:b.item_id||"all", from:fromGls, to:gl, reason });
      await sb.from("hr_claim_comments").insert({ claim_id:b.id, author_id:(me.user&&me.user.id)||null, author_name:(me.user&&me.user.email)||null, comment:"GL account changed to "+gl+(b.item_id?" (1 line)":" (all lines)")+" — "+reason, kind:"comment" });
      return j({ ok:true, updated: its.length, gl_account: gl });
    }
    if (api === "hr_rc_export_accounting") {
      // Finance accounting export (spec §5/§12): one row per expense LINE with GL / tax / SST / CC / payment — CSV-ready.
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me); if(!who.isAdmin && who.roles.indexOf("finance")<0) return j({ ok:false, error:"Only Finance or admin can export accounting data." }, 403);
      const tenant=String(b.tenant||""); const month=String(b.month||"").trim(); // 'YYYY-MM' optional
      let mFrom="", mTo="";
      if(month){
        // claim_date is a Postgres DATE — "YYYY-02-31" is a hard error Postgres rejects. Use an exclusive next-month bound.
        const [yy,mm]=month.split("-").map(Number);
        const nextMonth=(mm===12)?((yy+1)+"-01"):(yy+"-"+String(mm+1).padStart(2,"0"));
        mFrom=month+"-01"; mTo=nextMonth+"-01";
      }
      const buildQ=()=>{ let x:any=sb.from("hr_claim_requests").select("*, hr_employees(emp_no,name,dept,bank_name,bank_account), hr_claim_types(name)").eq("tenant_id",tenant).in("status",["Approved","Paid"]).order("claim_date"); if(month) x=x.gte("claim_date",mFrom).lt("claim_date",mTo); return x; };
      // Paginate — PostgREST caps every select at 1000 rows regardless of .limit(), which silently dropped claims from the export.
      let claims:any[]=[];
      for(let off=0; off<50000; off+=1000){ const { data: pg, error } = await buildQ().range(off,off+999); if(error) return j({ ok:false, error:"export query failed: "+String(error.message||error) }, 500); claims=claims.concat(pg||[]); if(!pg || pg.length<1000) break; }
      const ids=claims.map((x:any)=>x.id);
      // Items + payments — chunk claim_ids (avoid over-long .in() URLs) AND paginate (the 1000-item cap dropped line coding).
      const itemsBy:any={}, payBy:any={};
      for(let i=0;i<ids.length;i+=300){ const chunk=ids.slice(i,i+300);
        for(let off=0; off<50000; off+=1000){ const { data: pg } = await sb.from("hr_claim_items").select("*, hr_claim_types(name,gl_account)").in("claim_id",chunk).range(off,off+999); (pg||[]).forEach((it:any)=>{ (itemsBy[it.claim_id]=itemsBy[it.claim_id]||[]).push(it); }); if(!pg || pg.length<1000) break; }
        const { data: pp } = await sb.from("hr_claim_payments").select("*").in("claim_id",chunk); (pp||[]).forEach((p:any)=>{ payBy[p.claim_id]=p; });
      }
      const rows:any[]=[];
      for(const c of (claims||[])){
        const emp=c.hr_employees||{}; const pay=payBy[c.id]||{};
        const its=itemsBy[c.id]||[];
        const base={ claim_no:c.claim_no, claim_month:c.claim_month||String(c.claim_date||"").slice(0,7), status:c.status,
          emp_no:emp.emp_no||"", employee:emp.name||"", department:c.department||emp.dept||"",
          payment_date:pay.paid_date||"", payment_method:pay.payment_method||"", payment_reference:pay.payment_reference||"",
          xero_ref:c.xero_reference||(c.xero_bill_id?c.claim_no:""), bank:emp.bank_name||"", bank_account:emp.bank_account||"" };
        if(its.length){ for(const it of its){ const t=it.hr_claim_types||{};
          rows.push({ ...base, item_date:String(it.item_date||"").slice(0,10), expense_type:t.name||"", vendor_name:it.vendor_name||"", description:it.description||"",
            receipt_no:it.receipt_no||"", invoice_no:it.invoice_no||"", gl_account:it.gl_account||t.gl_account||"", cost_center:it.cost_center||c.cost_center||"", project:it.project||c.project||"",
            amount:Number(it.amount)||0, tax_amount:Number(it.tax_amount)||0, sst_amount:Number(it.sst_amount)||0 }); } }
        else rows.push({ ...base, item_date:c.claim_date||"", expense_type:(c.hr_claim_types&&c.hr_claim_types.name)||"", vendor_name:"", description:c.description||"", receipt_no:"", invoice_no:"", gl_account:"", cost_center:c.cost_center||"", project:c.project||"", amount:Number(c.amount)||0, tax_amount:0, sst_amount:0 });
      }
      await logAudit(me, "hr_rc_export_accounting", tenant, { month, rows: rows.length });
      return j({ ok:true, rows, count: rows.length });
    }
    if (api === "hr_rc_comment") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      if(!String(b.comment||"").trim()) return j({ ok:false, error:"empty comment" });
      if(!who.isAdmin){ if(!who.employee) return j({ ok:false, error:"forbidden" }, 403); const { data:oc } = await sb.from("hr_claim_requests").select("employee_id").eq("id",b.id).maybeSingle(); const { data:st } = await sb.from("hr_claim_approval_steps").select("approver_role,approver_employee_id").eq("claim_id",b.id); const isAppr=(st||[]).some((s:any)=>s.approver_employee_id===who.employee.id||who.roles.indexOf(s.approver_role)>=0); if(!(oc&&oc.employee_id===who.employee.id)&&!isAppr) return j({ ok:false, error:"forbidden" }, 403); }
      await sb.from("hr_claim_comments").insert({claim_id:b.id,author_id:(me.user&&me.user.id)||null,author_name:(me.user&&me.user.email)||null,comment:b.comment,kind:"comment"});
      await rcAuditLog(b.id,"comment",me,null,null,{});
      return j({ ok:true });
    }
    if (api === "hr_rc_cancel") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      const {data:c}=await sb.from("hr_claim_requests").select("status,employee_id,tenant_id").eq("id",b.id).maybeSingle();
      if(!c) return j({ ok:false, error:"not found" });
      if(!who.isAdmin && (!who.employee || c.employee_id!==who.employee.id)) return j({ ok:false, error:"forbidden" }, 403);
      if(who.isAdmin){ const alw = await allowedTenants(b.token); if (alw.length && c.tenant_id && alw.indexOf(c.tenant_id) < 0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }
      if(c.status==="Paid") return j({ ok:false, error:"A paid claim cannot be cancelled." });
      await sb.from("hr_claim_requests").update({status:"Cancelled"}).eq("id",b.id);
      await rcAuditLog(b.id,"cancel",me,c&&c.status,"Cancelled",{});
      return j({ ok:true });
    }
    if (api === "hr_rc_mark_paid") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me); if(!who.isAdmin && who.roles.indexOf("finance")<0) return j({ ok:false, error:"Only Finance or admin can mark claims paid." }, 403);
      const {data:c}=await sb.from("hr_claim_requests").select("*").eq("id",b.id).maybeSingle();
      if(!c) return j({ ok:false, error:"not found" });
      { const alw = await allowedTenants(b.token); if (alw.length && c.tenant_id && alw.indexOf(c.tenant_id) < 0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }
      if(c.status!=="Approved") return j({ ok:false, error:"Only Approved claims can be marked paid." });
      await sb.from("hr_claim_payments").upsert({ claim_id:b.id, paid_date:b.paid_date||new Date(Date.now()+8*3600*1000).toISOString().slice(0,10), amount:c.amount, payment_method:b.payment_method||"", payment_reference:b.payment_reference||"", paid_by:(me.user&&me.user.id)||null }, {onConflict:"claim_id"});
      await sb.from("hr_claim_requests").update({status:"Paid"}).eq("id",b.id);
      await rcAuditLog(b.id,"mark_paid",me,"Approved","Paid",{method:b.payment_method,ref:b.payment_reference});
      try{ await rcNotifyEmployee(c, "[HR OS] Your reimbursement "+(c.claim_no||"")+" has been paid", "Your reimbursement claim "+(c.claim_no||"")+" ("+rcMoney(c.amount)+") has been paid"+(b.payment_reference?(" (ref "+b.payment_reference+")"):"")+".\n\n— CTG HR OS (automated)"); }catch(_e){}
      return j({ ok:true, status:"Paid" });
    }
    if (api === "hr_rc_mark_paid_bulk") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me); if(!who.isAdmin && who.roles.indexOf("finance")<0) return j({ ok:false, error:"Only Finance or admin can mark claims paid." }, 403);
      const ids:any[] = Array.isArray(b.ids) ? b.ids.slice(0,500) : [];
      if(!ids.length) return j({ ok:false, error:"no claims selected" });
      const paidDate = b.paid_date||new Date(Date.now()+8*3600*1000).toISOString().slice(0,10);
      const method = b.payment_method||"Bank Transfer"; const ref = b.payment_reference||"";
      const alwPaid = await allowedTenants(b.token);
      let done=0; const results:any[]=[];
      for(const id of ids){
        const {data:c}=await sb.from("hr_claim_requests").select("*").eq("id",id).maybeSingle();
        if(!c){ results.push({ id, ok:false, error:"not found" }); continue; }
        if(alwPaid.length && c.tenant_id && alwPaid.indexOf(c.tenant_id)<0){ results.push({ id, ok:false, error:"no access to this company" }); continue; }
        if(c.status!=="Approved"){ results.push({ id, ok:false, error:"not Approved" }); continue; }
        await sb.from("hr_claim_payments").upsert({ claim_id:id, paid_date:paidDate, amount:c.amount, payment_method:method, payment_reference:ref, paid_by:(me.user&&me.user.id)||null }, {onConflict:"claim_id"});
        await sb.from("hr_claim_requests").update({status:"Paid"}).eq("id",id);
        await rcAuditLog(id,"mark_paid",me,"Approved","Paid",{method,ref,batch:true});
        try{ await rcNotifyEmployee(c, "[HR OS] Your reimbursement "+(c.claim_no||"")+" has been paid", "Your reimbursement claim "+(c.claim_no||"")+" ("+rcMoney(c.amount)+") has been paid"+(ref?(" (ref "+ref+")"):"")+".\n\n— CTG HR OS (automated)"); }catch(_e){}
        done++; results.push({ id, ok:true });
      }
      return j({ ok:true, done, total:ids.length, results });
    }
    if (api === "hr_rc_post_xero") {
      // Post an approved reimbursement to Xero as an ACCPAY bill (SUBMITTED, never AUTHORISED — payment stays a human click in Xero).
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me); if(!who.isAdmin && who.roles.indexOf("finance")<0) return j({ ok:false, error:"Only Finance or admin can post claims to Xero." }, 403);
      const id=b.id;
      const { data: c } = await sb.from("hr_claim_requests").select("*, hr_employees(name,emp_no)").eq("id",id).maybeSingle();
      if(!c) return j({ ok:false, error:"claim not found" });
      { const alw = await allowedTenants(b.token); if (alw.length && alw.indexOf(c.tenant_id) < 0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }
      if(["Approved","Paid"].indexOf(c.status)<0) return j({ ok:false, error:"Post to Xero only after the claim is fully Approved." });
      const tenant = c.tenant_id;
      const empName = (c.hr_employees&&c.hr_employees.name) || "Employee";
      // Build one Xero line per expense line, each coded to its claim type's GL account.
      const { data: items } = await sb.from("hr_claim_items").select("*, hr_claim_types(name,gl_account,is_mileage)").eq("claim_id",id).order("item_date");
      const missing:string[]=[]; const lines:any[]=[];
      if(items && items.length){
        for(const it of items){
          const t:any=it.hr_claim_types||{}; const gl=String(it.gl_account||t.gl_account||"").trim(); // per-line Finance override wins over the type default
          if(!gl){ const nm=t.name||"(unnamed type)"; if(missing.indexOf(nm)<0) missing.push(nm); continue; }
          const km = t.is_mileage ? (" · "+(it.total_km||0)+"km × RM"+(it.mileage_rate||0)+((Number(it.parking_amount)||0)||(Number(it.toll_amount)||0)?(" + parking/toll"):"")) : "";
          lines.push({ Description:String((it.description||t.name||"Expense")+km).slice(0,4000), Quantity:1, UnitAmount:Number(it.amount)||0, AccountCode:gl });
        }
      } else {
        const { data: t } = await sb.from("hr_claim_types").select("name,gl_account").eq("id",c.claim_type_id).maybeSingle();
        const gl=String((t&&t.gl_account)||"").trim();
        if(!gl) missing.push((t&&t.name)||"(claim type)");
        else lines.push({ Description:String(c.description||"Reimbursement").slice(0,4000), Quantity:1, UnitAmount:Number(c.amount)||0, AccountCode:gl });
      }
      if(missing.length) return j({ ok:false, error:"No GL account set for claim type(s): "+missing.join(", ")+". Set it in Reimbursement → Settings → Claim Types, then post again." });
      if(!lines.length) return j({ ok:false, error:"Nothing to post — no expense lines with an amount." });
      let access; try { access = await xeroAccessToken(); } catch(e){ return j({ ok:false, error:"Xero auth: "+String(e).slice(0,150) }); }
      const reference = String(c.claim_no || ("RC-"+id)).slice(0,255);
      const xh = { "Authorization":"Bearer "+access, "Xero-Tenant-Id": tenant, "Content-Type":"application/json", "Accept":"application/json" };
      let billId = c.xero_bill_id || null;
      if(billId){
        // Already posted — refresh the Reference on the existing (editable) bill so it never goes blank.
        try { await fetch("https://api.xero.com/api.xro/2.0/Invoices", { method:"POST", headers: xh, body: JSON.stringify({ Invoices:[{ InvoiceID: billId, Reference: reference }] }) }); } catch(_e){}
      } else {
        const inv:any = { Type:"ACCPAY", Contact:{ Name:String(empName).slice(0,500) },
          Reference: reference, Date: c.claim_date||undefined, Status:"SUBMITTED", LineAmountTypes:"NoTax", LineItems: lines };
        const idem = "rc-"+id+"-"+reference.replace(/[^A-Za-z0-9-]/g,"");
        const r = await fetch("https://api.xero.com/api.xro/2.0/Invoices", { method:"POST", headers:{ ...xh, "Idempotency-Key": idem }, body: JSON.stringify({ Invoices:[inv] }) });
        const out = await r.json();
        if (!r.ok){
          let msg = ""; const el = (out.Elements||[])[0];
          if (el && Array.isArray(el.ValidationErrors) && el.ValidationErrors.length) msg = el.ValidationErrors.map((e:any)=>e.Message).join(" · ");
          else if (Array.isArray(out.ValidationErrors) && out.ValidationErrors.length) msg = out.ValidationErrors.map((e:any)=>e.Message).join(" · ");
          else msg = out.Message || JSON.stringify(out);
          return j({ ok:false, error:"Xero "+r.status+": "+String(msg).slice(0,400) });
        }
        const bill = (out.Invoices||[])[0]; billId = bill && bill.InvoiceID;
        await sb.from("hr_claim_requests").update({ xero_bill_id: billId||null, xero_posted_at:new Date().toISOString(), xero_reference: reference }).eq("id", id);
      }
      // Attach receipts to the Xero bill (best-effort).
      let attached=0;
      if(billId){
        const { data: atts } = await sb.from("hr_claim_attachments").select("*").eq("claim_id",id);
        for(const a of (atts||[])){
          try{
            if(!a.file_path) continue;
            const { data: fileData } = await sb.storage.from("hr-claim-receipts").download(a.file_path);
            if(fileData){ const buf=await fileData.arrayBuffer(); const nm=String(a.file_name||"receipt").replace(/[^A-Za-z0-9._-]/g,"_").slice(0,116);
              const dr=await fetch("https://api.xero.com/api.xro/2.0/Invoices/"+billId+"/Attachments/"+encodeURIComponent(nm), { method:"POST", headers:{ "Authorization":"Bearer "+access, "Xero-Tenant-Id": tenant, "Content-Type": a.file_type||"application/octet-stream" }, body: buf });
              if(dr.ok) attached++; }
          }catch(_e){}
        }
      }
      await rcAuditLog(id,"post_xero",me,c.status,c.status,{ xero_bill_id:billId, reference, attached });
      return j({ ok:true, xero_bill_id:billId, reference, attached });
    }
    if (api === "hr_rc_list") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me); const scope=String(b.scope||"all");
      const pend=["Submitted","Pending Manager Approval","Pending HR Approval","Pending Finance Approval","Pending Director Approval","Need More Info"];
      if(who.isAdmin){
        const tenant=String(b.tenant||"");
        let q:any = sb.from("hr_claim_requests").select("*, hr_claim_types(name,code,is_mileage), hr_employees(emp_no,name,dept,bank_name,bank_account,ic_no,email)").eq("tenant_id",tenant).order("created_at",{ascending:false}).limit(500);
        if(scope==="pending") q=q.in("status",pend);
        else if(scope==="approved") q=q.eq("status","Approved");
        else if(scope==="paid") q=q.eq("status","Paid");
        else if(scope==="mine" && b.employee_id) q=q.eq("employee_id",b.employee_id);
        const { data } = await q; return j({ ok:true, claims:data||[] });
      }
      if(!who.employee) return j({ ok:false, error:"no employee profile" });
      const tenant=who.employee.tenant_id;
      if(scope==="approvals"||scope==="pending"){ const claims=await rcApproverQueue(tenant, who); return j({ ok:true, claims }); }
      let q:any = sb.from("hr_claim_requests").select("*, hr_claim_types(name,code,is_mileage), hr_employees(emp_no,name,dept)").eq("tenant_id",tenant).eq("employee_id",who.employee.id).order("created_at",{ascending:false}).limit(500);
      if(scope==="approved") q=q.eq("status","Approved"); else if(scope==="paid") q=q.eq("status","Paid");
      const { data } = await q; return j({ ok:true, claims:data||[] });
    }
    if (api === "hr_rc_get") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      const id=b.id;
      const [claimR, mileage, atts, steps, comments, payment, audit, itemsR, decR] = await Promise.all([
        sb.from("hr_claim_requests").select("*, hr_employees(emp_no,name,dept,position,bank_name,bank_account), hr_claim_types(name,code,is_mileage,requires_receipt)").eq("id",id).maybeSingle(),
        sb.from("hr_mileage_claim_details").select("*").eq("claim_id",id).maybeSingle(),
        sb.from("hr_claim_attachments").select("*").eq("claim_id",id),
        sb.from("hr_claim_approval_steps").select("*").eq("claim_id",id).order("step_order"),
        sb.from("hr_claim_comments").select("*").eq("claim_id",id).order("created_at"),
        sb.from("hr_claim_payments").select("*").eq("claim_id",id).maybeSingle(),
        sb.from("hr_claim_audit_logs").select("*").eq("claim_id",id).order("created_at"),
        sb.from("hr_claim_items").select("*, hr_claim_types(name,code,is_mileage,gl_account)").eq("claim_id",id).order("item_date"),
        sb.from("hr_claim_declarations").select("*").eq("claim_id",id).order("declared_at",{ascending:false}).limit(1)
      ]);
      const cl:any=claimR.data; const allSteps:any[]=steps.data||[];
      if(cl){ const alw = await allowedTenants(b.token); if (alw.length && alw.indexOf(cl.tenant_id) < 0) return j({ ok:false, error:"forbidden" }, 403); }
      if(!who.isAdmin){
        if(!who.employee) return j({ ok:false, error:"forbidden" }, 403);
        const isOwner = cl && cl.employee_id===who.employee.id;
        const isAppr = allSteps.some((s:any)=>s.approver_employee_id===who.employee.id||who.roles.indexOf(s.approver_role)>=0);
        if(!isOwner && !isAppr) return j({ ok:false, error:"forbidden" }, 403);
      }
      const curStep = allSteps.find((s:any)=>cl && s.step_order===cl.current_step);
      const canAct = rcCanActStep(who, curStep) && ["Submitted","Pending Manager Approval","Pending HR Approval","Pending Finance Approval","Pending Director Approval"].indexOf(cl&&cl.status)>=0;
      const canPost = (who.isAdmin || who.roles.indexOf("finance")>=0) && ["Approved","Paid"].indexOf(cl&&cl.status)>=0;
      const attsOut:any[]=[];
      for(const a of (atts.data||[])){ let url:any=null; if(a.file_path){ try{ const s=await sb.storage.from("hr-claim-receipts").createSignedUrl(a.file_path,3600); url=s.data&&s.data.signedUrl; }catch(_e){} } attsOut.push({...a, url}); }
      return j({ ok:true, claim:cl, mileage:mileage.data, items:itemsR.data||[], attachments:attsOut, steps:allSteps, comments:comments.data||[], payment:payment.data, audit:audit.data||[], declaration:(decR.data&&decR.data[0])||null, can_act:canAct, can_post:canPost, can_finance:(who.isAdmin||who.roles.indexOf("finance")>=0), is_admin:who.isAdmin });
    }
    if (api === "hr_rc_admin_save") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const kind=String(b.kind||""); const row=b.row||{};
      if(kind==="claim_type"){ if(row.id){ await sb.from("hr_claim_types").update({...row, updated_at:new Date().toISOString()}).eq("id",row.id);} else { await sb.from("hr_claim_types").insert(row);} }
      else if(kind==="claim_type_del"){ await sb.from("hr_claim_types").update({active:false}).eq("id",row.id); }
      else if(kind==="mileage_rate"){ if(row.id){ await sb.from("hr_mileage_rates").update(row).eq("id",row.id);} else { await sb.from("hr_mileage_rates").insert(row);} }
      else if(kind==="mileage_rate_del"){ await sb.from("hr_mileage_rates").update({active:false}).eq("id",row.id); }
      else if(kind==="policy"){ if(row.id){ await sb.from("hr_claim_policy_rules").update(row).eq("id",row.id);} else { await sb.from("hr_claim_policy_rules").insert(row);} }
      else if(kind==="cost_center"){ if(row.id){ await sb.from("hr_cost_centers").update({code:row.code,name:row.name,active:row.active!==false,sort_order:Number(row.sort_order)||0}).eq("id",row.id);} else { await sb.from("hr_cost_centers").insert({tenant_id:row.tenant_id||null,code:row.code,name:row.name,active:true,sort_order:Number(row.sort_order)||0});} }
      else if(kind==="cost_center_del"){ await sb.from("hr_cost_centers").update({active:false}).eq("id",row.id); }
      else if(kind==="role_approver"){ await sb.from("hr_claim_role_approvers").insert({tenant_id:row.tenant_id||null, role:row.role, employee_id:row.employee_id}); }
      else if(kind==="role_approver_del"){ await sb.from("hr_claim_role_approvers").delete().eq("id",row.id); }
      else if(kind==="workflow"){
        let wid=row.id;
        const wfRow:any={ tenant_id:row.tenant_id||null, name:row.name, description:row.description||"", active:row.active!==false, priority:Number(row.priority)||0, min_amount:(row.min_amount===""||row.min_amount==null)?0:Number(row.min_amount), max_amount:(row.max_amount===""||row.max_amount==null)?null:Number(row.max_amount), match_department:row.match_department||null, match_claim_type_id:row.match_claim_type_id||null, match_role:row.match_role||null, match_project:row.match_project||null, updated_at:new Date().toISOString() };
        if(wid){ await sb.from("hr_approval_workflows").update(wfRow).eq("id",wid);} else { const ins=await sb.from("hr_approval_workflows").insert(wfRow).select("id").single(); wid=ins.data&&ins.data.id; }
        if(wid && Array.isArray(row.steps)){ await sb.from("hr_approval_workflow_steps").delete().eq("workflow_id",wid); await sb.from("hr_approval_workflow_steps").insert(row.steps.map((s:any,i:number)=>({workflow_id:wid,step_order:i+1,name:s.name,approver_type:s.approver_type||"role",approver_role:s.approver_role,approver_employee_id:s.approver_employee_id||null}))); }
      }
      else if(kind==="workflow_del"){ await sb.from("hr_approval_workflows").update({active:false}).eq("id",row.id); }
      else return j({ ok:false, error:"unknown kind" });
      return j({ ok:true });
    }
    if (api === "hr_rc_dashboard") {
      const me = await meFromToken(b.token); if (!hrCanView(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant=String(b.tenant||"");
      { const alw=await allowedTenants(b.token); if(alw.length && tenant && alw.indexOf(tenant)<0) return denyTenant(me,"hr_rc_dashboard",tenant); }
      let rows:any[]=[];
      for(let off=0; off<20000; off+=1000){
        const { data: pg } = await sb.from("hr_claim_requests").select("id,claim_no,amount,status,claim_date,department,warnings, hr_claim_types(name), hr_employees(name,dept)").eq("tenant_id",tenant).neq("status","Draft").neq("status","Cancelled").order("id").range(off, off+999);
        rows=rows.concat(pg||[]); if(!pg || pg.length<1000) break;
      }
      const isPending=(s:string)=>["Submitted","Pending Manager Approval","Pending HR Approval","Pending Finance Approval","Pending Director Approval","Need More Info"].includes(s);
      const sumF=(f:any)=>Math.round(rows.filter(f).reduce((s,r)=>s+(Number(r.amount)||0),0)*100)/100;
      const cntF=(f:any)=>rows.filter(f).length;
      const byKey=(kf:any)=>{ const m:any={}; rows.forEach(r=>{ const k=kf(r)||"—"; m[k]=(m[k]||0)+(Number(r.amount)||0); }); return Object.keys(m).map(k=>({label:k,value:Math.round(m[k]*100)/100})).sort((a,b)=>b.value-a.value); };
      const now=new Date(); const trend:any[]=[];
      for(let i=5;i>=0;i--){ const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1)); const ym=d.toISOString().slice(0,7); const lbl=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]; const amt=rows.filter(r=>String(r.claim_date||"").slice(0,7)===ym).reduce((s,r)=>s+(Number(r.amount)||0),0); trend.push({label:lbl,value:Math.round(amt*100)/100}); }
      const alerts=rows.filter(r=>Array.isArray(r.warnings)&&r.warnings.length).slice(0,20).map(r=>({claim_no:r.claim_no, amount:Number(r.amount)||0, warnings:r.warnings, name:r.hr_employees&&r.hr_employees.name}));
      // by claim type — aggregate from line items (falls back to header type for item-less claims)
      const cids=rows.map((r:any)=>r.id);
      // Chunk claim_ids (a multi-thousand .in() list blows the PostgREST URL limit → the query errored + was
      // silently dropped, making by_type wrong) AND paginate past the 1000-item cap.
      const dItems:any[]=[];
      for(let i=0;i<cids.length;i+=300){ const chunk=cids.slice(i,i+300);
        for(let off=0; off<50000; off+=1000){ const { data: pg } = await sb.from("hr_claim_items").select("claim_id,amount, hr_claim_types(name,is_mileage)").in("claim_id",chunk).range(off,off+999); dItems.push(...(pg||[])); if(!pg || pg.length<1000) break; }
      }
      const withItems=new Set((dItems||[]).map((x:any)=>x.claim_id)); const tm:any={};
      // it.amount is server-computed at save (mileage = km×rate + parking + toll) — recomputing km×rate here dropped parking/toll.
      (dItems||[]).forEach((it:any)=>{ const t=it.hr_claim_types||{}; const a=Number(it.amount)||0; const k=t.name||"—"; tm[k]=(tm[k]||0)+a; });
      rows.filter((r:any)=>!withItems.has(r.id)).forEach((r:any)=>{ const k=(r.hr_claim_types&&r.hr_claim_types.name)||"—"; tm[k]=(tm[k]||0)+(Number(r.amount)||0); });
      const byType=Object.keys(tm).map(k=>({label:k,value:Math.round(tm[k]*100)/100})).sort((a,b)=>b.value-a.value);
      return j({ ok:true, data:{ total_claims:rows.length, total_amount:sumF(()=>true), pending:cntF((r:any)=>isPending(r.status)), approved:cntF((r:any)=>r.status==="Approved"), rejected:cntF((r:any)=>r.status==="Rejected"), paid:cntF((r:any)=>r.status==="Paid"), paid_amount:sumF((r:any)=>r.status==="Paid"), by_department:byKey((r:any)=>r.department||(r.hr_employees&&r.hr_employees.dept)), by_type:byType, by_employee:byKey((r:any)=>r.hr_employees&&r.hr_employees.name), trend, alerts } });
    }
    if (api === "hr_dashboard") {
      const me = await meFromToken(b.token); if (!hrCanView(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const now = new Date(); const mo = Number(b.month)||(now.getMonth()+1); const yr = Number(b.year)||now.getFullYear();
      const { data, error } = await sb.rpc("hr_dashboard", { p_tenant:String(b.tenant||""), p_month:mo, p_year:yr });
      if (error) return j({ ok:false, error:error.message });
      return j({ ok:true, data, month:mo, year:yr });
    }
    if (api === "hr_dash_refresh") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const now = new Date(); const mo = Number(b.month)||(now.getMonth()+1); const yr = Number(b.year)||now.getFullYear();
      const tenant = String(b.tenant||"");
      const { data, error } = await sb.rpc("hr_dashboard", { p_tenant:tenant, p_month:mo, p_year:yr });
      if (error) return j({ ok:false, error:error.message });
      await sb.from("hr_dashboard_snapshots").insert({ tenant_id:tenant, period_month:mo, period_year:yr, payload:data });
      await sb.from("hr_dashboard_insights").delete().eq("tenant_id",tenant).eq("period_month",mo).eq("period_year",yr);
      const ins = (data && (data as any).insights) || [];
      if (ins.length) {
        await sb.from("hr_dashboard_insights").insert(ins.map((x:any)=>({ tenant_id:tenant, period_month:mo, period_year:yr,
          insight_type:x.insight_type, title:x.title, description:x.description, metric_value:x.metric_value,
          comparison_value:x.comparison_value, severity:x.severity, suggested_action:x.suggested_action })));
      }
      await logAudit(me,"hr_dash_refresh",tenant,{ month:mo, year:yr, insights:ins.length });
      return j({ ok:true, data, insights:ins.length, refreshedAt:new Date().toISOString() });
    }
    if (api === "hr_calc_log") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (b.overridden && !String(b.reason||"").trim()) return j({ ok:false, error:"a reason is required for an override" });
      const row = {
        tenant_id:String(b.tenant||""), employee_id:b.employeeId?String(b.employeeId):null, employee_name:b.employeeName||null,
        period:b.period||null, inputs:b.inputs||{}, flags:b.flags||{}, settings:b.settings||{}, result:b.result||{},
        overridden:!!b.overridden, override:b.override||null, reason:b.reason||null, created_by:(me.user&&me.user.email)||null,
      };
      const { data, error } = await sb.from("hr_calc_audit").insert(row).select("id").single();
      if (error) return j({ ok:false, error:error.message });
      await logAudit(me,"hr_calc_log",String(data&&data.id),{ tenant:b.tenant, employee:b.employeeName, net:(b.result&&b.result.net), overridden:!!b.overridden });
      return j({ ok:true, id:data&&data.id });
    }
    if (api === "hr_calc_history") {
      const me = await meFromToken(b.token); if (!hrCanView(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data, error } = await sb.from("hr_calc_audit").select("*").eq("tenant_id",String(b.tenant||"")).order("created_at",{ascending:false}).limit(60);
      if (error) return j({ ok:false, error:error.message });
      return j({ ok:true, rows:data||[] });
    }
    if (api === "hr_rates_save") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const rates = b.rates||{};
      const { error } = await sb.from("hr_statutory_rates").upsert({ id:1, rates }, { onConflict:"id" });
      if (error) return j({ ok:false, error:error.message });
      await logAudit(me,"hr_rates_save","1",{});
      return j({ ok:true });
    }
    if (api === "hr_payroll_grid_save") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const mo=Number(b.month), yr=Number(b.year); const items=Array.isArray(b.adjustments)?b.adjustments:[]; const tenant=String(b.tenant||"");
      if (!tenant) return j({ ok:false, error:"no company selected" });
      { const alw=await allowedTenants(b.token); if(alw.length && alw.indexOf(tenant)<0) return denyTenant(me,"hr_payroll_grid_save",tenant); }
      // Bulk-replace THIS company's month entries only (scope delete to the tenant's employees).
      const empT = await sb.from("hr_employees").select("id").eq("tenant_id",tenant);
      const empTIds = (empT.data||[]).map((e:any)=>e.id);
      if (empTIds.length){
        const { error:eDel } = await sb.from("hr_payroll_adjustments").delete().eq("period_month",mo).eq("period_year",yr).in("employee_id",empTIds);
        if (eDel) return j({ ok:false, error:eDel.message });
      }
      if (items.length){
        const rows = items.map((a:any)=>({ employee_id:String(a.employee_id), period_month:mo, period_year:yr, kind:String(a.kind), label:a.label||null, amount:Number(a.amount)||0, epf_subject:a.epf_subject!==false }));
        const { error:eIns } = await sb.from("hr_payroll_adjustments").insert(rows);
        if (eIns) return j({ ok:false, error:eIns.message });
      }
      await logAudit(me,"hr_payroll_grid_save",String(mo)+"/"+String(yr),{ n:items.length });
      return j({ ok:true, n:items.length });
    }
    if (api === "hr_annual") {
      const me = await meFromToken(b.token); if (!hrCanView(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const yr = Number(b.year); const tenant=String(b.tenant||"");
      if (!tenant) return j({ ok:false, error:"no company selected" });
      // Filter server-side via the run ids (an unfiltered hr_payslips select silently caps at 1000 rows —
      // at 5 companies × 12 months that understates EA-form annual totals once headcount grows).
      const { data: yrRuns } = await sb.from("hr_payroll_runs").select("id").eq("tenant_id",tenant).eq("period_year",yr);
      const runIds=(yrRuns||[]).map((r:any)=>r.id);
      let slips:any[]=[];
      for(let off=0; runIds.length && off<20000; off+=1000){
        const { data: pg } = await sb.from("hr_payslips").select("*").in("run_id",runIds).order("id").range(off,off+999);
        slips=slips.concat(pg||[]); if(!pg || pg.length<1000) break;
      }
      const ei = await sb.from("hr_employer_info").select("*").eq("tenant_id",tenant).maybeSingle();
      const map:any = {};
      slips.forEach((s:any)=>{
        const k = s.employee_id;
        const t = map[k] || (map[k] = { gross:0, epfEe:0, epfEr:0, socsoEe:0, socsoEr:0, eisEe:0, eisEr:0, pcb:0, net:0, months:0 });
        t.gross+=Number(s.gross); t.epfEe+=Number(s.epf_ee); t.epfEr+=Number(s.epf_er);
        t.socsoEe+=Number(s.socso_ee); t.socsoEr+=Number(s.socso_er);
        t.eisEe+=Number(s.eis_ee); t.eisEr+=Number(s.eis_er);
        t.pcb+=Number(s.pcb); t.net+=Number(s.net); t.months+=1;
      });
      return j({ ok:true, annual:map, employer:ei.data||{ name:"I PROCARE MALAYSIA SDN BHD", employer_no:"", address:"" } });
    }
    if (api === "hr_post_xero") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const runId = String(b.runId||""); if (!runId) return j({ ok:false, error:"missing runId" });
      const tenantId = String(b.tenantId||"99911869-9e91-4572-b7dc-4db51b45b6a9");
      // Safety: portal only ever posts payroll journals as DRAFT (never auto-POSTED), mirroring the
      // "Xero stops at SUBMITTED / human authorises" rule for AP bills.
      const base = Deno.env.get("SUPABASE_URL")!; const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      let r:any;
      try {
        const resp = await fetch(base+"/functions/v1/xero-post-payroll", {
          method:"POST", headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+srk, "apikey":srk },
          body: JSON.stringify({ runId, status:"DRAFT", tenantId }),
        });
        r = await resp.json().catch(()=>({}));
        if (!resp.ok) return j({ ok:false, error:(r&&(r.error||r.detail))||("HTTP "+resp.status) });
      } catch(e){ return j({ ok:false, error:String(e) }); }
      if (r && r.error) return j({ ok:false, error:r.detail? (r.error+" — "+r.detail):r.error });
      await logAudit(me,"hr_post_xero",String(runId),{ tenantId, status:"DRAFT" });
      return j({ ok:true, result:r });
    }
    if (api === "hr_send_payslip") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const p = b.payload||{};
      if (!p.to || !p.pdfBase64) return j({ ok:false, error:"missing recipient or attachment" });
      const base = Deno.env.get("SUPABASE_URL")!; const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      let r:any;
      try {
        const resp = await fetch(base+"/functions/v1/send-payslip-email", {
          method:"POST", headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+srk, "apikey":srk },
          body: JSON.stringify({ to:p.to, subject:p.subject, html:p.html, filename:p.filename, pdfBase64:p.pdfBase64 }),
        });
        r = await resp.json().catch(()=>({}));
        if (!resp.ok) return j({ ok:false, error:(r&&(r.error||r.detail))||("HTTP "+resp.status) });
      } catch(e){ return j({ ok:false, error:String(e) }); }
      if (r && r.error) return j({ ok:false, error:r.detail? (r.error+" — "+r.detail):r.error });
      await logAudit(me,"hr_send_payslip",String(p.empNo||p.to),{ to:p.to });
      return j({ ok:true, result:r });
    }
    return j({ ok:true, hint:"portal v113 employee-profile-self-service (b: hr_rc_config meOut.employee now the FULL own master row — was 5-field trim, which blanked My Profile prefill AND zeroed basic/IC/bank on the employee payslip PDF): new hr_my_profile_save action — any linked employee updates their OWN hr_employees MASTER record, whitelisted personal fields only (phone/address/emergency, ic/dob/gender/nationality, marital_status+spouse_working+num_children [PCB], bank_code→name resolved from hr_banks master + holder + account digits-only, epf/socso/tax no). Employment/pay fields stay hr_emp_save (HR) only. Diffs vs current row → audit-logs {changed:{field:{from,to}}}; no-op returns unchanged:true. hros.html: 5th employee tab 'My Profile' (read-only Employment card + editable Personal/Contact/Bank&statutory form, bank dropdown from hr_banks master, saves refresh RC.me.employee); employee-mode view whitelist now clock/leave/expenses/payslip/profile. prior v112 employee-payslip-self-service: new hr_my_payslips action (auth: any logged-in employee via rcMe.employee; admin can pass employee_id, tenant-guarded) returns the caller's FINALISED payslips (figures snapshotted from hr_payslips joined to finalised hr_payroll_runs) + per-period adjustment breakdown (bonus/ot/allowance/unpaid/deductions from hr_payroll_adjustments) + current-year paid-leave balances. hros.html employee self-service now has 4 tabs — Time Clock (now shown to ALL employees, not just part-timers), Leave (apply+balance), Reimbursement, and NEW Payslip (list finalised months + download PDF via reused hrDrawPayslip; HR_COMPANY set from own tenant name). prior v111 app-separation: HR-only roles (employee|viewer|hr_admin) are BLOCKED from the Finance Portal — a top-of-dispatch guard 403s every non-HR/non-auth action for them (isHrNamespace+AUTH_BASIC_ACTIONS allow-list). NEW role hr_admin ('HR Admin') = full HR write (hrManage=admin||hr_admin) across all hr_/attendance_ mutations (banks/emp/attendance/leave-flow/leave-balance/claim-decide/adj/payroll-finalise/grid/rates/enable-login/dash-refresh/calc-log/rc-admin/post-xero/send-payslip) but CANNOT manage users (hr_users_list/hr_user_role_set/hr_user_invite stay superAdmin=Master-Admin-only) and has NO Finance Portal. Viewer features now [] (HR-only, read via hrCanView). hr_user_invite/role_set accept hr_admin. app.html shows an 'HR OS access only' gate + link to hros.html for these roles; hros.html routes admin|hr_admin|viewer to full HR views (HR_MASTER=admin gates Access&Roles nav/view, HR_VIEWER=viewer read-only). prior v110 access-roles: Viewer (role='viewer') read-only HR OS — dispatch guard blocks every mutating hr_/attendance_/clock_ action for viewers (403), read actions accept hrCanView(admin|viewer); new hr_users_list/hr_user_role_set(last-admin guard)/hr_user_invite (Master Admin role manager). + Form E join_date persisted in hr_emp_save. prior v109 employee-login: hr_rc_enable_login now guards double-enable + tenant-pin + returns name; new hr_rc_enable_login_bulk (create HR OS logins for all active employees with an email, per company, returns credentials + skipped). Fixes the gap where NO employee could apply leave (0/19 linked, action was orphaned/unwired). Frontend: Employees page has per-card 'Enable login' / '✓ login' / '⚠ no email' + 'Enable all logins' + a credentials modal (copy/print, one-time passwords). prior v108 audit-hardening: tenant-pin payroll(finalise/grid_save/data)+leave-on-behalf(apply/my)+rc_dashboard (partial-company admins can no longer touch other cos) + hr_rc_export_accounting/hr_rc_dashboard paginate+chunk claims&items (1000-row cap silently dropped export lines & by_type) + leave-decide employee-step status label. frontend: removed duplicate hrDecideLeave (admin approve/reject was broken) + LVA/RC.cfg/HR_CALC reset on company switch + loader err-guards (no infinite retry) + O2O custom-commission line re-pricing + Today/Smart honest group scope + CFO feature grantable + tenantsRefresh rebuilds company dropdown + overview/approvals surface errors. prior v107 leave-admin-tools: hr_leave_apply admin apply-on-behalf + auto_approve(record MC, deduct once); hr_leave_flow_steps.approver_employee_id → approval levels can name a specific employee (approver_type employee|manager|role); hr_leave_balance_save(admin adjust entitled/taken per type incl Medical/MC); hr_payroll_data returns leaveBalances→payslip prints remaining paid-leave days; hr_leave_admin returns employees+leave_types. prior v106 emp-lifecycle: hr_emp_save persists status(active|resigned)+resign_date; hr_emp_delete(superAdmin, tenant-guarded, resigned-only) hard-deletes an employee — DB cascades leave/claims/balances/attendance/timeclock/adjustments; hr_payslips is RESTRICT so payroll history blocks delete unless {force:true} (then payslips wiped first). prior v105 leave-approval-chain: hr_leave multi-level workflow (hr_leave_flow_steps config manager→HR→director; per-request hr_leave_approval_steps; apply builds chain+notifies step1; decide step-aware advance/finalise+balance-deduct-once+reject; hr_leave_pending approver queue; hr_leave_admin all+steps+flow; hr_leave_flow_get/save superAdmin; hr_leave_my attaches steps; cancel allows in-progress; email at each step) — prior v104 time-clock: clock_in/out/status(self, geo, one-open-guard) + attendance_list/save/delete(admin punch log + hours summary + est pay) + hr_attendance table + employee pay_type/hourly_rate/daily_rate/shift + payroll auto-fills hourly/daily basic from clocked hours + cron_clock_reminders(shift-time email, per-day dedup) + employment-type selector. prior v103 audit-wave: sync-5min(delta cron every 5m, watchdog 25m stall + 15m cadence, quiet cron_delta audit) + rc-fixes(mileage amount keeps parking/toll, decide status-gate no Paid-regression, export month-end Feb-safe + error surfaced, attach no-phantom-receipt, paid_date MYT) + tenant-pin(by-id: rc decide/paid/cancel/set_gl, sbi list/get/approve/void, leave/claim decide) + dedup-policy(L3/L4 heuristic → needs_review not auto-reject; only same-invoice-no rejects) + pagination(hr_annual, sync_audit, xero_diagnose, rc_dashboard, inv_meta+pharmacy contacts past 1000-row cap) + rpc-errors-surfaced(group_dashboard/fin_analytics/ap_inbox/calendar/cashflow/pharmacy/company_docs 500 not silent-empty) + ilike-escape(resolveContact) + partial-fetch-flag(receivables/bank_reconcile warn on truncation) + rebuild-watermark-reset + batch-upsert-error-retry + emp_no-numeric — prior: v102 sr-suite + tenant-isolation + HR suite + self-billed + fin-analytics" });
  } catch (e) { return j({ ok:false, error: String(e) }, 500); }
});

// deploy retrigger 2026-07-10 (CI run 49 failed transiently)
