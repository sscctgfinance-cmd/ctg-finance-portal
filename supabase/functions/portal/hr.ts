// HR OS — the hr_ / attendance_ / clock_ half of the portal edge function.
//
// Split out of the single-file index.ts unchanged: the reimbursement/claim/leave helpers, the Malaysian
// statutory payroll engine, and the 68-action HR handler chain. The chain below is the SAME first-match
// if-chain, in the SAME order, with the SAME bodies — index.ts calls it at the point it used to appear.
// Grouped guards (clock_status/in/out, hr_tp1_*, hr_stat_ids_*) move as whole blocks so the inner
// branches keep the outer block's auth and bindings.
//
// The payroll engine and its tables live here (not in lib.ts) because tests/ lift them out of this file
// by name — see tools/extract.ts.

import {
  sb, j, xeroAccessToken, meFromToken, isAdmin, superAdmin,
  hrManage, hrCanView, logAudit, NO_TENANT, allowedTenants, isFullScopeAdmin,
  userWriteAllowed, denyTenant, resolveModel, callVisionLLM,
  sendEmailTo,
} from "./lib.ts";


// The site's public address — the ONE place it is written in this function. The five links below all
// travel by EMAIL (leave approvals, claim approvals, employee credentials, admin credentials, clock
// reminders), which is how staff reach the app, so every one of them must stay ABSOLUTE: a relative
// path in a mail client resolves against nothing.
//
// Three runtimes hold this address and none can import from another (a `_shared/` module would sit
// outside the deploy workflow's `paths:` trigger and so would ship silently late), which makes three
// declarations the floor: this one, `SITE_URL` in common.js (the browser) and `SITE_URL` in
// supabase/functions/ctg-sso/index.ts (the sign-in allow-list). tests/site_url_test.ts fails if they
// stop agreeing, and fails if a fourth hardcoded copy appears anywhere in the shipped source.
const SITE_URL  = "https://os.ctg4u.com";
const HROS_URL  = SITE_URL + "/hros.html";
const APP_URL   = SITE_URL + "/app.html";
const CLOCK_URL = HROS_URL + "#clock";

// ===== Reimbursement / Claim engine helpers =====
export function rcStatusForRole(role){ return role==="manager"?"Pending Manager Approval":role==="hr"?"Pending HR Approval":role==="finance"?"Pending Finance Approval":role==="director"?"Pending Director Approval":"Submitted"; }
export async function rcAuditLog(claimId, action, me, fromS, toS, detail){ try{ await sb.from("hr_claim_audit_logs").insert({ claim_id:claimId, action, actor_id:(me&&me.user&&me.user.id)||null, actor_name:(me&&me.user&&me.user.email)||null, from_status:fromS||null, to_status:toS||null, details:detail||{} }); }catch(_e){} }
export async function rcMatchWorkflow(tenant, claim){
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
// v153: choose a fallback approver role that SOMEBODY actually holds in this company, so a claim with
// no matching workflow is still decidable. Order reflects who normally signs off a reimbursement.
// Returns role:null when nobody holds any role — the step is then left unassigned, which canActOrGap()
// lets an admin fill (better an admin than a claim nobody can ever touch).
export async function rcFallbackStep(tenant:string){
  const PREF=[["finance","Finance"],["hr","HR"],["director","Director / Boss"],["manager","Manager"]];
  for(const [role,label] of PREF){
    if(!(await stepHasNoApprover({ approver_role:role }, tenant))) return { role, name:label };
  }
  return { role:null, name:"Approval" };
}
// Validation engine (spec §10). Returns { errors, warnings }: errors BLOCK submission; warnings submit but surface to the approver.
export async function rcValidate(claim, type, empId){
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
export async function rcMe(me){
  const isAdmin = hrManage(me); let employee:any=null, roles:string[]=[], is_manager=false;   // admin OR hr_admin = full HR admin
  let roleRows:{role:string,tenant_id:any}[]=[];
  const uid = me && me.user && me.user.id;
  if(uid){ const { data:e } = await sb.from("hr_employees").select("*").eq("user_id",uid).maybeSingle(); employee=e||null; }
  if(employee){
    // v157: carry the tenant on each role. stepEligibleApprovers already honoured hr_claim_role_approvers
    // .tenant_id, but rcMe did not — so who.roles was a GROUP-WIDE set and rcCanActStep matched a step's
    // role by name alone. A "finance" approver of company A who also had company B in their portal
    // assignment could therefore approve B's claims/leave without being an approver there at all.
    const { data:ra } = await sb.from("hr_claim_role_approvers").select("role,tenant_id").eq("employee_id",employee.id);
    const set = new Set<string>(); (ra||[]).forEach((x:any)=>set.add(x.role)); if(employee.claim_role) set.add(employee.claim_role);
    roles = Array.from(set);
    roleRows = (ra||[]).map((x:any)=>({ role:String(x.role), tenant_id:x.tenant_id||null }));
    if(employee.claim_role) roleRows.push({ role:String(employee.claim_role), tenant_id:employee.tenant_id||null });
    const { count } = await sb.from("hr_employees").select("id",{count:"exact",head:true}).eq("manager_id",employee.id);
    is_manager = !!count;
  }
  return { isAdmin, employee, roles, roleRows, is_manager, uid: uid||null };
}
// v157: does this person hold `role` FOR THIS COMPANY? A row with no tenant_id is a deliberate group-wide
// approver and still counts (same rule stepEligibleApprovers uses). Falls back to the flat name match only
// when roleRows is absent, so older callers keep working.
export function rcHasRole(who:any, role:string, tenantId?:any){
  const r=String(role||"").trim(); if(!r) return false;
  const rows = who && who.roleRows;
  if(!Array.isArray(rows)) return ((who&&who.roles)||[]).indexOf(r)>=0;
  return rows.some((x:any)=> String(x.role)===r && (!x.tenant_id || !tenantId || String(x.tenant_id)===String(tenantId)));
}
// Only the person the step is actually assigned to may act on it. Being an admin does NOT satisfy a
// step: an admin who isn't the configured approver has no say (operator policy — strict segregation of
// duties, no override). Before v120 this began with `if(who.isAdmin) return true`, which let one admin
// approve every level of a chain, including levels belonging to somebody else.
export function rcCanActStep(who:any, step:any, tenantId?:any){ if(!step) return false; if(!who.employee) return false; if(step.approver_employee_id && step.approver_employee_id===who.employee.id) return true; if(step.approver_role && rcHasRole(who, step.approver_role, tenantId)) return true; return false; }
// A step nobody is assigned to: no chain configured at all, or a "manager" step for an employee with no
// manager_id. Left alone these can never be decided now that admin no longer satisfies every step, so an
// admin may act on them — that is filling a gap, not overriding somebody else's level.
export function stepUnassigned(step:any){ return !step || (!step.approver_employee_id && !step.approver_role); }
export function canActOrUnassigned(who:any, step:any){ return rcCanActStep(who, step) || (who.isAdmin && stepUnassigned(step)); }
// v152 DEADLOCK FIX. stepUnassigned() only covers a step with NO approver at all. A step assigned to a
// ROLE THAT NOBODY HOLDS is just as undecidable — rcCanActStep can never be satisfied and the admin
// escape doesn't apply — so the request is stuck forever with no way out (6 live ILADY claims sat on a
// "finance" step while only "hr" and "director" had holders). Treat a role with zero holders in the
// request's company as the same kind of gap an admin may fill. SoD still applies on top: the admin
// still cannot approve their own request, nor two levels of one request.
// v154 (H1). Who could ACTUALLY decide this step for THIS request? Not "is a field filled in" — a step
// is equally dead when its only approver is the requester themselves, has already acted on another
// level (SoD), has resigned, or has no portal login. With one holder per role that is not a corner
// case: HR's own claim stops on the HR step, the Director's own claim stops on the Director step, and
// nobody — not even an admin — can move it. Returns the count of eligible humans.
export async function stepEligibleApprovers(step:any, tenantId:any, excludeEmpIds?:any[], excludeUserIds?:any[]){
  if(!step) return 0;
  const exE = new Set((excludeEmpIds||[]).filter(Boolean).map(String));
  const exU = new Set((excludeUserIds||[]).filter(Boolean).map(String));
  let ids:string[] = [];
  if(step.approver_employee_id){ ids=[String(step.approver_employee_id)]; }
  else {
    const role = String(step.approver_role||"").trim();
    if(!role) return 0;                                   // plain unassigned
    // v157 FAIL-CLOSED. supabase-js returns {data:null,error} instead of throwing, and every result here
    // used to be consumed as (data||[]). A transient DB error therefore made this return 0 — which
    // canActOrGap reads as "nobody can decide this step", silently handing ANY admin an approval override
    // while the real approvers were alive and well. On error return -1 ("assume approvers exist"), so the
    // gap-fill stays shut; -1 !== 0 also stops rcFallbackStep from treating the step as unfillable.
    const { data: ras, error: eRas } = await sb.from("hr_claim_role_approvers").select("employee_id,tenant_id").eq("role",role);
    if(eRas) return -1;
    // A holder counts when it is global (no tenant) or belongs to this request's company.
    ids = (ras||[]).filter((r:any)=> !r.tenant_id || !tenantId || String(r.tenant_id)===String(tenantId))
                   .map((r:any)=>String(r.employee_id));
    let q = sb.from("hr_employees").select("id").eq("claim_role",role);   // role carried on the employee row
    if(tenantId) q = q.eq("tenant_id",tenantId);
    const { data: direct, error: eDir } = await q;
    if(eDir) return -1;
    (direct||[]).forEach((e:any)=>ids.push(String(e.id)));
  }
  ids = Array.from(new Set(ids)).filter((id)=>!exE.has(id));
  if(!ids.length) return 0;
  const { data: emps, error: eEmp } = await sb.from("hr_employees").select("id,user_id,status").in("id", ids);
  if(eEmp) return -1;
  return (emps||[]).filter((e:any)=>
    String(e.status||"active").toLowerCase()!=="resigned" &&   // a resigned approver can't act
    e.user_id && !exU.has(String(e.user_id))                   // must have a login, and not have acted already
  ).length;
}
// "Is this step unfillable at all?" — used when PICKING a fallback approver (no request context yet).
export async function stepHasNoApprover(step:any, tenantId:any){
  return (await stepEligibleApprovers(step, tenantId)) === 0;
}
// ctx carries the request so eligibility is judged for THIS request, not in the abstract.
export async function canActOrGap(who:any, step:any, tenantId:any, ctx?:any){
  if(rcCanActStep(who, step, tenantId)) return true;      // still subject to sodViolation() afterwards
  if(!who.isAdmin) return false;
  // v159: exclude by employee id too — an approver who already acted via the email link has no user id.
  const exE = ([] as any[]).concat(ctx && ctx.requesterEmpId ? [ctx.requesterEmpId] : [], (ctx && ctx.actedEmpIds) || []);
  const exU = (ctx && ctx.actedUserIds) || [];
  return (await stepEligibleApprovers(step, tenantId, exE, exU)) === 0;
}
// v157: resolve the leave approval chain FOR ONE COMPANY. A company that has configured its own chain
// uses it; otherwise it falls back to the legacy group-wide rows (tenant_id NULL), so behaviour is
// unchanged for every company until an admin saves a chain for it.
export async function leaveFlowFor(tenantId:any, activeOnly?:boolean){
  const run = async (scoped:boolean)=>{
    let q = sb.from("hr_leave_flow_steps").select("*");
    q = scoped ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null);
    if(activeOnly) q = q.eq("active", true);
    const { data } = await q.order("step_order");
    return data||[];
  };
  if(tenantId){ const own = await run(true); if(own.length) return own; }
  return await run(false);
}
// Segregation of duties: one human may not approve two levels of the same request, and nobody may
// approve their own. Returns an error string to refuse with, or null when the actor is clear.
// actorField is the step table's actor column ("acted_by" for claims, "decided_by" for leave).
// v159: empField is the step table's EMPLOYEE actor column ("acted_emp_id" / "decided_emp_id"). The check
// used to key only on the portal USER id, so an approver with no login deciding via the emailed link was
// stamped NULL and skipped the cross-level rule entirely — one person holding two roles could clear the
// whole chain by email. Match on either identity, so a missing login no longer disables SoD.
export async function sodViolation(table:string, idField:string, reqId:string, stepId:any, actorUserId:string, actorEmpId:any, requesterEmpId:any, actorField:string, empField?:string){
  if(actorEmpId && requesterEmpId && String(actorEmpId)===String(requesterEmpId)) return "You cannot approve your own request.";
  if(!actorUserId && !actorEmpId) return null;
  const hit = async (col:string, val:any)=>{
    if(!val) return null;
    let q = sb.from(table).select("step_order,name").eq(idField,reqId).eq(col,val);
    if(stepId) q = q.neq("id",stepId);   // re-deciding the same step (e.g. after Need More Info) is fine
    const { data } = await q;
    return (data && data.length) ? data[0] : null;
  };
  const prior = (await hit(actorField, actorUserId)) || (empField ? await hit(empField, actorEmpId) : null);
  if(prior) return "You already acted on step "+prior.step_order+" ("+(prior.name||"")+") of this request. A different person must approve this level.";
  return null;
}
// Resolve the portal-user id in each step's actor field → a display name (employee name preferred,
// else portal user name/email), attached as nameField. Used by the leave & reimbursement timelines.
// withSig also attaches the actor's signature image as <nameField>_sig. Opt-in: the leave list calls
// this for hundreds of requests at once, and repeating the same ~15 KB image per step would turn a
// small JSON response into megabytes. Only the single-claim view needs it.
export async function attachActorNames(steps:any[], idField:string, nameField:string, withSig?:boolean){
  const ids = Array.from(new Set((steps||[]).map((s:any)=>s[idField]).filter(Boolean)));
  if(!ids.length) return;
  const nameById:any={}; const sigById:any={};
  const { data: eA } = await sb.from("hr_employees").select("user_id,name"+(withSig?",signature":"")).in("user_id",ids);
  (eA||[]).forEach((e:any)=>{ if(e.user_id){ nameById[e.user_id]=e.name; if(withSig && e.signature) sigById[e.user_id]=e.signature; } });
  const missing = ids.filter((id:any)=>!nameById[id]);
  if(missing.length){ const { data: uA } = await sb.from("portal_users").select("id,name,email").in("id",missing); (uA||[]).forEach((u:any)=>{ nameById[u.id]=u.name||u.email; }); }
  // The actor's signature image rides along so the claim form can stamp it above the signature line.
  // Only for people who actually acted on this request — not a directory of everyone's signature.
  (steps||[]).forEach((s:any)=>{ if(s[idField]){ s[nameField]=nameById[s[idField]]||null; if(sigById[s[idField]]) s[nameField+"_sig"]=sigById[s[idField]]; } });
}
// Attach `assignee_name` = the EXPECTED approver of each step: the specific employee assigned
// (approver_employee_id, an hr_employees.id — also the resolved direct-manager), else whoever holds
// the step's role (hr_claim_role_approvers, shared by leave & reimbursement, tenant-scoped or global).
export async function attachAssignees(steps:any[], tenantId:any){
  if(!steps || !steps.length) return;
  const empIds = Array.from(new Set(steps.map((s:any)=>s.approver_employee_id).filter(Boolean)));
  const empName:any={};
  if(empIds.length){ const { data } = await sb.from("hr_employees").select("id,name").in("id",empIds); (data||[]).forEach((e:any)=>{ empName[e.id]=e.name; }); }
  const roles = Array.from(new Set(steps.filter((s:any)=>!s.approver_employee_id && s.approver_role).map((s:any)=>s.approver_role)));
  const roleNames:any={};
  if(roles.length){
    const { data: ras } = await sb.from("hr_claim_role_approvers").select("role,employee_id,tenant_id").in("role",roles as string[]);
    const scoped=(ras||[]).filter((r:any)=> r.tenant_id==null || tenantId==null || r.tenant_id===tenantId);
    const raEmpIds = Array.from(new Set(scoped.map((r:any)=>r.employee_id).filter(Boolean)));
    const raName:any={};
    if(raEmpIds.length){ const { data } = await sb.from("hr_employees").select("id,name").in("id",raEmpIds); (data||[]).forEach((e:any)=>{ raName[e.id]=e.name; }); }
    scoped.forEach((r:any)=>{ const nm=raName[r.employee_id]; if(nm){ (roleNames[r.role]=roleNames[r.role]||[]).push(nm); } });
  }
  steps.forEach((s:any)=>{
    if(s.approver_employee_id) s.assignee_name = empName[s.approver_employee_id]||null;
    else if(s.approver_role) s.assignee_name = ((roleNames[s.approver_role]||[]).join(" / "))||null;
  });
}
// Claim numbers are <COMPANY CODE>-YYYYMM-0001, restarting at 0001 each month for each company.
// The counter lives in Postgres (hr_next_doc_no, atomic upsert) rather than a max()+1 here, because
// claim_no is globally UNIQUE — two people submitting at the same moment would otherwise compute the
// same number and one of them would hit a duplicate-key error on insert.
export async function rcNextClaimNo(tenantId:string){
  const { data: ei } = await sb.from("hr_employer_info").select("doc_code").eq("tenant_id",tenantId).maybeSingle();
  const code = String((ei&&ei.doc_code)||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6) || "CLM";
  // Number by the Malaysian month, not UTC: a claim filed at 02:00 MYT on the 1st is still the
  // previous day in UTC and would otherwise be numbered into the month that just closed.
  const myt = new Date(Date.now() + 8*3600*1000);
  const period = myt.getUTCFullYear()+String(myt.getUTCMonth()+1).padStart(2,"0");
  const scope = code+"-"+period;
  const { data:n, error } = await sb.rpc("hr_next_doc_no",{ p_scope: scope });
  if(error || n==null) throw new Error("Could not allocate a claim number"+(error?(": "+error.message):"")+". Nothing was saved — try again.");
  return scope+"-"+String(n).padStart(4,"0");
}
export async function rcApproverQueue(tenant:string, who:any){
  const PEND=["Submitted","Pending Manager Approval","Pending HR Approval","Pending Finance Approval","Pending Director Approval","Need More Info"];
  const { data:claims } = await sb.from("hr_claim_requests").select("*, hr_claim_types(name,code,is_mileage), hr_employees(emp_no,name,dept)").eq("tenant_id",tenant).in("status",PEND).order("created_at",{ascending:false}).limit(500);
  const ids=(claims||[]).map((c:any)=>c.id); if(!ids.length) return [];
  const { data:steps } = await sb.from("hr_claim_approval_steps").select("claim_id,step_order,approver_role,approver_employee_id,status,acted_by").in("claim_id",ids);
  const byClaim:any={}; const actedOn:any={};
  (steps||[]).forEach((s:any)=>{ (byClaim[s.claim_id]=byClaim[s.claim_id]||{})[s.step_order]=s; if(s.acted_by) (actedOn[s.claim_id]=actedOn[s.claim_id]||[]).push(String(s.acted_by)); });
  // v152/v154: a step is an admin-fillable gap when NOBODY is eligible to decide it for THAT claim —
  // no holder at all, or every holder is the claimant / already acted / resigned / has no login.
  // Holders are resolved once (the filter below is sync), then judged per claim.
  const roles = Array.from(new Set((steps||[]).map((s:any)=>String(s.approver_role||"").trim()).filter(Boolean)));
  const roleHolders:any = {};
  for(const r of roles){
    const { data: ras } = await sb.from("hr_claim_role_approvers").select("employee_id,tenant_id").eq("role",r);
    const hid = (ras||[]).filter((x:any)=>!x.tenant_id||String(x.tenant_id)===String(tenant)).map((x:any)=>String(x.employee_id));
    const { data: direct } = await sb.from("hr_employees").select("id").eq("claim_role",r).eq("tenant_id",tenant);
    (direct||[]).forEach((e:any)=>hid.push(String(e.id)));
    roleHolders[r] = Array.from(new Set(hid));
  }
  const empIds:string[] = [];
  (steps||[]).forEach((s:any)=>{ if(s.approver_employee_id) empIds.push(String(s.approver_employee_id)); });
  roles.forEach((r:any)=>{ (roleHolders[r]||[]).forEach((id:string)=>empIds.push(id)); });
  const empInfo:any = {};
  const uniqEmp = Array.from(new Set(empIds));
  if(uniqEmp.length){ const { data: es } = await sb.from("hr_employees").select("id,user_id,status").in("id",uniqEmp);
    (es||[]).forEach((e:any)=>{ empInfo[String(e.id)]=e; }); }
  const eligibleCount=(st:any, c:any)=>{
    const acted = new Set((actedOn[c.id]||[]).map(String));
    const ids:string[] = st.approver_employee_id ? [String(st.approver_employee_id)]
                                                 : (roleHolders[String(st.approver_role||"").trim()]||[]);
    return ids.filter((id:string)=>{
      if(String(id)===String(c.employee_id)) return false;          // can't approve your own
      const e=empInfo[id]; if(!e||!e.user_id) return false;          // no login = can never act
      if(String(e.status||"active").toLowerCase()==="resigned") return false;
      return !acted.has(String(e.user_id));                          // already acted on another level
    }).length;
  };
  const canAct=(st:any,c:any)=> rcCanActStep(who, st, c&&c.tenant_id) || (who.isAdmin && eligibleCount(st,c)===0);
  return (claims||[]).filter((c:any)=>{
    const st=byClaim[c.id]&&byClaim[c.id][c.current_step];
    if(!(st && st.status==="Pending" && canAct(st,c))) return false;
    // Segregation of duties — same rule the decide path enforces, applied here so the queue never
    // offers something that would be refused on click.
    if(who.employee && String(c.employee_id)===String(who.employee.id)) return false;
    if(who.uid && (actedOn[c.id]||[]).indexOf(String(who.uid))>=0) return false;
    return true;
  });
}
// ── Reimbursement email notifications (best-effort; reuse Gmail SMTP / Resend like the AP module). ──
export async function rcSendEmail(toEmail:string, subject:string, body:string){
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
export async function rcEmpEmail(empId:any){ if(!empId) return null; const { data } = await sb.from("hr_employees").select("email,name").eq("id",empId).maybeSingle(); return data; }
export function rcMoney(n:any){ return "RM "+(Number(n)||0).toFixed(2); }
export async function rcNotifyEmployee(claim:any, subject:string, body:string){ try{ const e=await rcEmpEmail(claim && claim.employee_id); if(e&&e.email) await rcSendEmail(e.email, subject, body); }catch(_e){} }
export function rcFnBase(){ return (Deno.env.get("SUPABASE_URL")||"https://cmostxcjtbuhbzfojuid.supabase.co")+"/functions/v1/portal"; }
// ── Leave multi-level approval helpers ──
export async function leaveRoleApproverEmails(role:string){ const out:string[]=[]; try{ const { data: ras } = await sb.from("hr_claim_role_approvers").select("employee_id").eq("role",role); for(const ra of (ras||[])){ const e=await rcEmpEmail(ra.employee_id); if(e&&e.email) out.push(e.email); } }catch(_e){} return out; }
export async function leaveNotifyStep(reqId:any){ try{
  const { data: req } = await sb.from("hr_leave_requests").select("*").eq("id",reqId).maybeSingle(); if(!req) return;
  const { data: step } = await sb.from("hr_leave_approval_steps").select("*").eq("leave_request_id",reqId).eq("step_order",req.current_step||1).maybeSingle(); if(!step) return;
  const { data: emp } = await sb.from("hr_employees").select("name").eq("id",req.employee_id).maybeSingle();
  const recips:string[]=[];
  if(step.approver_employee_id){ const e=await rcEmpEmail(step.approver_employee_id); if(e&&e.email) recips.push(e.email); }
  else if(step.approver_role){ (await leaveRoleApproverEmails(step.approver_role)).forEach((x)=>recips.push(x)); }
  const seen:any={};
  for(const to of recips){ if(seen[to])continue; seen[to]=1;
    await rcSendEmail(to, "[HR OS] Leave request needs your approval",
      "Hi,\n\n"+((emp&&emp.name)||"An employee")+" requested "+req.leave_type+" leave "+req.date_from+" → "+req.date_to+" ("+req.days+" day(s)).\nReason: "+(req.reason||"—")+"\nApproval step: "+(step.name||step.approver_role)+"\n\nApprove / reject in HR OS → Leave:\n  "+HROS_URL+"\n\n— CTG HR OS (automated)");
  }
}catch(_e){} }
export async function rcNotifyStepApprover(claimId:any){ try{
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
    const body="Hi,\n\nA reimbursement claim is waiting for your approval:\n\n  Claim:    "+((claim&&claim.claim_no)||"")+"\n  Employee: "+nm+"\n  Amount:   "+rcMoney(claim&&claim.amount)+"\n\n"+(link?("Review & approve here (no login needed, link valid 14 days):\n  "+link+"\n\n"):"")+"Or log in to HR OS → Reimbursement → Pending:\n  "+HROS_URL+"\n\n— CTG HR OS (automated)";
    await rcSendEmail(r.email, subj, body);
    // v172 also buzzed their phone; v224 retired Web Push. The email above is the whole notification now.
  }
}catch(_e){} }
// Resolve an employee id into the {isAdmin:false, employee, roles} shape rcDecideOne/rcCanActStep expect (email-approval identity).
export async function rcWhoForEmp(empId:any){
  const { data: employee } = await sb.from("hr_employees").select("*").eq("id",empId).maybeSingle();
  if(!employee) return null;
  const { data: ra } = await sb.from("hr_claim_role_approvers").select("role").eq("employee_id",empId);
  const set=new Set<string>(); (ra||[]).forEach((x:any)=>set.add(x.role)); if(employee.claim_role) set.add(employee.claim_role);
  return { isAdmin:false, employee, roles:Array.from(set), is_manager:false };
}
// GET ?rc=<token> → self-contained approval page (view is idempotent; the decision is a JS POST so mail scanners can't trigger it).
export async function rcEmailActionPage(token:string){
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
// Confirm the caller is entitled to a leave request's company. The leave decide/cancel/list paths never
// got the tenant pin the claim path did (v103), so a scoped admin — or a role approver whose role name
// ("hr"/"manager"/…) collides with another company's flow — could act on another company's leave by id.
// Applies to EVERYONE (admins scoped by allowedTenants; a role approver's own tenant is their only entry).
export async function leaveTenantOk(token:string, req:any){
  if(!req) return false;
  let tid = req.tenant_id;
  if(!tid && req.employee_id){ const { data:e } = await sb.from("hr_employees").select("tenant_id").eq("id",req.employee_id).maybeSingle(); tid = e && e.tenant_id; }
  if(!tid) return true;                         // tenant unresolvable (shouldn't happen) — don't hard-block
  const alw = await allowedTenants(token);
  return alw.indexOf(String(tid)) >= 0;         // allowedTenants is fail-closed, so this denies by default
}
export async function rcDecideOne(who:any, me:any, id:any, decision:string, comment:string, overrideAmount:any, overrideReason:string, pinTenants:any=null){
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
  // Everyone who already acted on ANOTHER level of this request is ineligible here (SoD), so they don't
  // count when deciding whether the step still has a real approver.
  // v159: also collect the acting EMPLOYEE ids — an approver with no portal login (email-link approval)
  // has acted_by NULL, so a user-id-only exclusion counted them as still eligible here.
  const { data: actedRows } = await sb.from("hr_claim_approval_steps").select("acted_by,acted_emp_id,id").eq("instance_id",inst.id);
  const otherSteps = (actedRows||[]).filter((s:any)=> !step || s.id!==step.id);
  const actedUserIds = otherSteps.filter((s:any)=>s.acted_by).map((s:any)=>s.acted_by);
  const actedEmpIds  = otherSteps.filter((s:any)=>s.acted_emp_id).map((s:any)=>s.acted_emp_id);
  if(!(await canActOrGap(who, step, claim.tenant_id, { requesterEmpId: claim.employee_id, actedUserIds, actedEmpIds })))
    return { ok:false, error:"You are not the approver for this step"+(step&&step.approver_role?(" (\""+step.approver_role+"\")"):"")+". Ask that approver to act, or assign someone to the role in Claim settings.", forbidden:true };
  const fromS=claim.status; const actor=(me.user&&me.user.id)||null; const actorEmp=(who.employee&&who.employee.id)||null; const aname=(me.user&&me.user.email)||null; const nowIso=new Date().toISOString();
  const sodErr = await sodViolation("hr_claim_approval_steps","instance_id",inst.id,step&&step.id,actor,who.employee&&who.employee.id,claim.employee_id,"acted_by","acted_emp_id");
  if(sodErr) return { ok:false, error:sodErr, forbidden:true };
  // v159 (SoD, origination vs approval): sodViolation only compares the actor to the BENEFICIARY, so an
  // admin who raised a claim on someone else's behalf could then approve it — and if they also hold
  // "finance" they could mark it paid and edit the payee's bank account. One person, end to end.
  // Refuse only when somebody else could actually decide this step, so this can never deadlock a claim
  // (the v152/153/154 lesson: "assigned" is not the same as "actionable").
  if(decision==="approve" && claim.created_by && actor && String(claim.created_by)===String(actor)
     && !(claim.employee_id && actorEmp && String(claim.employee_id)===String(actorEmp))){
    const others = await stepEligibleApprovers(step, claim.tenant_id, [actorEmp].filter(Boolean), [actor].filter(Boolean));
    if(others > 0) return { ok:false, error:"You raised this claim, so you cannot also approve it. Another approver for this step must act.", forbidden:true };
  }
  if(decision==="reject"){
    if(!String(comment||"").trim()) return { ok:false, error:"a rejection reason is required" };
    if(step) await sb.from("hr_claim_approval_steps").update({status:"Rejected",decision:"reject",comment,acted_by:actor,acted_emp_id:actorEmp,acted_at:nowIso}).eq("id",step.id);
    await sb.from("hr_claim_approval_instances").update({status:"rejected"}).eq("id",inst.id);
    await sb.from("hr_claim_requests").update({status:"Rejected",decided_at:nowIso}).eq("id",id);
    await sb.from("hr_claim_comments").insert({claim_id:id,author_id:actor,author_name:aname,comment,kind:"comment"});
    await rcAuditLog(id,"reject",me,fromS,"Rejected",{comment});
    return { ok:true, status:"Rejected", claim };
  }
  if(decision==="request_info"){
    if(!String(comment||"").trim()) return { ok:false, error:"a message to the employee is required" };
    if(step) await sb.from("hr_claim_approval_steps").update({status:"Info Requested",comment,acted_by:actor,acted_emp_id:actorEmp,acted_at:nowIso}).eq("id",step.id);
    await sb.from("hr_claim_requests").update({status:"Need More Info"}).eq("id",id);
    await sb.from("hr_claim_comments").insert({claim_id:id,author_id:actor,author_name:aname,comment,kind:"info_request"});
    await rcAuditLog(id,"request_info",me,fromS,"Need More Info",{comment});
    return { ok:true, status:"Need More Info", claim, comment };
  }
  const override = (overrideAmount!=null && overrideAmount!=="") ? Number(overrideAmount) : null;
  if(override!=null){ if(!String(overrideReason||"").trim()) return { ok:false, error:"a reason is required to override the amount" }; await sb.from("hr_claim_requests").update({amount:override, override_amount:override, override_reason:overrideReason}).eq("id",id); await rcAuditLog(id,"override",me,fromS,fromS,{from:claim.amount,to:override,reason:overrideReason}); claim.amount=override; }
  if(step) await sb.from("hr_claim_approval_steps").update({status:"Approved",decision:"approve",comment,acted_by:actor,acted_emp_id:actorEmp,acted_at:nowIso}).eq("id",step.id);
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
export async function rcNotifyDecision(res:any){ try{
  const c=res && res.claim; if(!c) return;
  if(res.advanced){ await rcNotifyStepApprover(c.id); return; }
  if(res.status==="Approved") await rcNotifyEmployee(c, "[HR OS] Your reimbursement "+(c.claim_no||"")+" is approved", "Good news — your reimbursement claim "+(c.claim_no||"")+" ("+rcMoney(c.amount)+") has been fully approved and is now with Finance for payment.\n\n— CTG HR OS (automated)");
  else if(res.status==="Rejected") await rcNotifyEmployee(c, "[HR OS] Your reimbursement "+(c.claim_no||"")+" was rejected", "Your reimbursement claim "+(c.claim_no||"")+" ("+rcMoney(c.amount)+") was rejected.\n\nLog in to HR OS → Reimbursement to see the reason.\n\n— CTG HR OS (automated)");
  else if(res.status==="Need More Info") await rcNotifyEmployee(c, "[HR OS] More info needed on reimbursement "+(c.claim_no||""), "Your reimbursement claim "+(c.claim_no||"")+" needs more information before it can be approved:\n\n  \""+String(res.comment||"").slice(0,500)+"\"\n\nLog in to HR OS → Reimbursement, update it, and resubmit.\n\n— CTG HR OS (automated)");
}catch(_e){} }
// ── v151: SERVER-SIDE Malaysian payroll statutory engine (authoritative source of record) ──
// Faithful port of the audited frontend hrCompute(). Standards:
//   EPF (KWSP Third Schedule): wage ≤20k snapped to RM20 bands; each side rounded UP to next ringgit;
//     EE 11% (or override / 0% senior), ER 13% (wage ≤ threshold) / 12% (> threshold) / 4% senior.
//   SOCSO (PERKESO Second Schedule): contribution = RM100 wage-band midpoint × rate, rounded to nearest
//     5 sen, wage capped at ceiling. Cat 1 = EE+ER (under 60); Cat 2 = ER-only (60+).
//   EIS (SIP): same band/rounding, 18–60 only, capped at ceiling.
//   PCB/MTD (LHDN): normal remuneration annualised ×12 less reliefs (personal, spouse-if-not-working,
//     children, EPF up to cap) → progressive tax bands − s.6A rebate, /12; bonus taxed as ADDITIONAL
//     remuneration = tax(normal+bonus) − tax(normal), added once. Non-resident = flat 30%.
// ⚠️ TAX BANDS: default reflects the post-Budget-2023 M40-reduced schedule (6/11/19% for RM35k–100k) —
//     the same bands the live frontend uses. They are configurable via hr_statutory_rates.rates.taxBands
//     so a licensed tax agent can update them without a code change. VERIFY against the current LHDN
//     MTD schedule at filing time.
export const MY_DEFAULT_TAX_BANDS: [number,number][] = [[5000,0],[20000,0.01],[35000,0.03],[50000,0.06],[70000,0.11],[100000,0.19],[400000,0.25],[600000,0.26],[2000000,0.28],[Infinity,0.30]];
/* ══ v155: Official Malaysian statutory contribution tables (embedded verbatim). The earlier
   %-of-band-midpoint formula was 5 sen off on SOCSO EMPLOYER at every RM100 band and wrong on EIS
   above RM2,000 (EIS uses RM500 bands there) — so both are now EXACT table lookups, matching PERKESO
   to the sen. Row = [wageUpperBound, employeeAmt, employerAmt]. ══ */
// PERKESO Second Schedule, Category 1 (employee < 60), RM6,000 ceiling, effective 1 Oct 2024.
export const MY_SOCSO_CAT1:[number,number,number][]=[[30,0.10,0.40],[50,0.20,0.70],[70,0.30,1.10],[100,0.40,1.50],[140,0.60,2.10],[200,0.85,2.95],[300,1.25,4.35],[400,1.75,6.15],[500,2.25,7.85],[600,2.75,9.65],[700,3.25,11.35],[800,3.75,13.15],[900,4.25,14.85],[1000,4.75,16.65],[1100,5.25,18.35],[1200,5.75,20.15],[1300,6.25,21.85],[1400,6.75,23.65],[1500,7.25,25.35],[1600,7.75,27.15],[1700,8.25,28.85],[1800,8.75,30.65],[1900,9.25,32.35],[2000,9.75,34.15],[2100,10.25,35.85],[2200,10.75,37.65],[2300,11.25,39.35],[2400,11.75,41.15],[2500,12.25,42.85],[2600,12.75,44.65],[2700,13.25,46.35],[2800,13.75,48.15],[2900,14.25,49.85],[3000,14.75,51.65],[3100,15.25,53.35],[3200,15.75,55.15],[3300,16.25,56.85],[3400,16.75,58.65],[3500,17.25,60.35],[3600,17.75,62.15],[3700,18.25,63.85],[3800,18.75,65.65],[3900,19.25,67.35],[4000,19.75,69.15],[4100,20.25,70.85],[4200,20.75,72.65],[4300,21.25,74.35],[4400,21.75,76.15],[4500,22.25,77.85],[4600,22.75,79.65],[4700,23.25,81.35],[4800,23.75,83.15],[4900,24.25,84.85],[5000,24.75,86.65],[5100,25.25,88.35],[5200,25.75,90.15],[5300,26.25,91.85],[5400,26.75,93.65],[5500,27.25,95.35],[5600,27.75,97.15],[5700,28.25,98.85],[5800,28.75,100.65],[5900,29.25,102.35],[6000,29.75,104.15]];
// Category 2 (employee 60+): employment-injury only — employer pays, employee 0.
export const MY_SOCSO_CAT2:[number,number,number][]=[[30,0,0.30],[50,0,0.50],[70,0,0.80],[100,0,1.05],[140,0,1.50],[200,0,2.10],[300,0,3.10],[400,0,4.40],[500,0,5.60],[600,0,6.90],[700,0,8.10],[800,0,9.40],[900,0,10.60],[1000,0,11.90],[1100,0,13.10],[1200,0,14.40],[1300,0,15.60],[1400,0,16.90],[1500,0,18.10],[1600,0,19.40],[1700,0,20.60],[1800,0,21.90],[1900,0,23.10],[2000,0,24.40],[2100,0,25.60],[2200,0,26.90],[2300,0,28.10],[2400,0,29.40],[2500,0,30.60],[2600,0,31.90],[2700,0,33.10],[2800,0,34.40],[2900,0,35.60],[3000,0,36.90],[3100,0,38.10],[3200,0,39.40],[3300,0,40.60],[3400,0,41.90],[3500,0,43.10],[3600,0,44.40],[3700,0,45.60],[3800,0,46.90],[3900,0,48.10],[4000,0,49.40],[4100,0,50.60],[4200,0,51.90],[4300,0,53.10],[4400,0,54.40],[4500,0,55.60],[4600,0,56.90],[4700,0,58.10],[4800,0,59.40],[4900,0,60.60],[5000,0,61.90],[5100,0,63.10],[5200,0,64.40],[5300,0,65.60],[5400,0,66.90],[5500,0,68.10],[5600,0,69.40],[5700,0,70.60],[5800,0,71.90],[5900,0,73.10],[6000,0,74.40]];
// EIS / SIP (employee = employer), RM6,000 ceiling.
export const MY_EIS:[number,number,number][]=[[30,0.05,0.05],[50,0.10,0.10],[70,0.10,0.10],[100,0.15,0.15],[140,0.25,0.25],[200,0.35,0.35],[300,0.50,0.50],[400,0.70,0.70],[500,0.90,0.90],[600,1.10,1.10],[700,1.30,1.30],[800,1.50,1.50],[900,1.70,1.70],[1000,1.90,1.90],[1100,2.10,2.10],[1200,2.30,2.30],[1300,2.50,2.50],[1400,2.70,2.70],[1500,2.90,2.90],[1600,3.10,3.10],[1700,3.30,3.30],[1800,3.50,3.50],[1900,3.70,3.70],[2000,3.90,3.90],[2100,4.10,4.10],[2200,4.30,4.30],[2300,4.50,4.50],[2400,4.70,4.70],[2500,4.90,4.90],[2600,5.10,5.10],[2700,5.30,5.30],[2800,5.50,5.50],[2900,5.70,5.70],[3000,5.90,5.90],[3100,6.10,6.10],[3200,6.30,6.30],[3300,6.50,6.50],[3400,6.70,6.70],[3500,6.90,6.90],[3600,7.10,7.10],[3700,7.30,7.30],[3800,7.50,7.50],[3900,7.70,7.70],[4000,7.90,7.90],[4100,8.10,8.10],[4200,8.30,8.30],[4300,8.50,8.50],[4400,8.70,8.70],[4500,8.90,8.90],[4600,9.10,9.10],[4700,9.30,9.30],[4800,9.50,9.50],[4900,9.70,9.70],[5000,9.90,9.90],[5100,10.10,10.10],[5200,10.30,10.30],[5300,10.50,10.50],[5400,10.70,10.70],[5500,10.90,10.90],[5600,11.10,11.10],[5700,11.30,11.30],[5800,11.50,11.50],[5900,11.70,11.70],[6000,11.90,11.90]];
export function myStatLookup(tbl:[number,number,number][],wage:number){ if(!(wage>0)) return {ee:0,er:0}; for(let i=0;i<tbl.length;i++){ if(wage<=tbl[i][0]) return {ee:tbl[i][1],er:tbl[i][2]}; } const L=tbl[tbl.length-1]; return {ee:L[1],er:L[2]}; }
// ── PERKESO LINDUNG 24 Jam (SKBBK) — Act A1788, in force 1 June 2026 ────────────────────────────────
// Employee-only, banded like the rest of Act 4, RM6,000 ceiling. Phase 1 (1 Jun 2026 – 31 May 2028) is
// 0.75%; it rises to 1.00% and then 1.25% in later phases.
//
// DERIVED, not transcribed. PERKESO publishes this only as a scanned table, and the v155 disaster was
// exactly a hand-entered contribution table that was wrong for weeks. The gazetted schedule columns HR OS
// already holds are 0.5% (Cat 1 employee) and 1.25% (Cat 2 employer), and the published Phase-1 TOTAL
// employee contribution is 1.25% = 0.5% invalidity + 0.75% SKBBK. So:
//        SKBBK(phase 1) = Cat2_employer − Cat1_employee
// This reproduces BOTH published anchors exactly — RM44.65 at the RM6,000 ceiling and RM22.85 in the
// RM3,000.01–3,100 band — and is non-negative, a clean 5-sen multiple and monotonic across all 64 bands.
// A naive "band midpoint × 0.75% rounded to 5 sen" disagrees on 32 of those 64 bands, so the derivation
// is doing real work; do NOT "simplify" it to a percentage. See tests/statutory_test.ts.
export function myLindung24(wage:number){
  const a=myStatLookup(MY_SOCSO_CAT2,wage).er, b=myStatLookup(MY_SOCSO_CAT1,wage).ee;
  return Math.round((a-b)*100)/100;
}
// The scheme does not exist before June 2026 — deducting it from an earlier period would be inventing a
// liability. Phase 1's rate is only correct to 31 May 2028; after that this must be revisited.
export function myLindungActive(period?:any){
  const now=new Date();
  const y=Number(period&&period.year)||now.getUTCFullYear();
  const m=Number(period&&period.month)||(now.getUTCMonth()+1);
  return (y>2026) || (y===2026 && m>=6);
}
// LHDN MTD rounding: truncate to 2 dp, then round UP to the next 5 sen (123.02→123.05, 123.06→123.10).
export function myPcbRoundUp5(n:number){ n=Math.floor((Number(n)||0)*100)/100; return Math.round(Math.ceil(n/0.05-1e-9)*0.05*100)/100; }
// Months the employee is on payroll in the tax year — for MTD annualisation of a mid-year joiner/leaver.
export function myServiceMonths(emp:any,period:any){ if(!period||!period.year) return 12; const y=Number(period.year); let start=1,end=12;
  if(emp.join_date){ const d=new Date(emp.join_date); if(!isNaN(d.getTime())){ if(d.getUTCFullYear()>y) return 0; if(d.getUTCFullYear()===y) start=d.getUTCMonth()+1; } }
  if(emp.resign_date){ const d=new Date(emp.resign_date); if(!isNaN(d.getTime())){ if(d.getUTCFullYear()<y) return 0; if(d.getUTCFullYear()===y) end=d.getUTCMonth()+1; } }
  return Math.max(1,end-start+1); }
export function payRoundUp(n:number){ return Math.ceil(n-1e-9); }
export function payRound2(n:number){ return Math.round((Number(n)||0)*100)/100; }
export function payRound5(n:number){ return Math.round((Number(n)||0)*20)/20; }          // nearest 5 sen
export function payBandMid(w:number){ if(w<=0) return 0; const upper=Math.ceil((w-1e-9)/100)*100; return upper-50; }
// v157: age must be as at the END OF THE PAYROLL PERIOD, not "today". Malaysian practice is to process a
// month after it closes, so an employee who turned 60 in August used to have senior EPF/SOCSO/EIS applied
// retroactively to the July run (EPF employee 11%→0, employer 13%→4%, EIS→0: hundreds of ringgit wrong on
// a finalised payslip and EA record). It also made re-finalising an old month rewrite it differently.
export function payAge(dob:any, period?:any){ if(!dob) return null; const d=new Date(dob); if(isNaN(d.getTime())) return null;
  const t=(period&&period.year&&period.month) ? new Date(Date.UTC(Number(period.year),Number(period.month),0)) : new Date(Date.now()+8*3600*1000);
  let a=t.getUTCFullYear()-d.getUTCFullYear(); const m=t.getUTCMonth()-d.getUTCMonth(); if(m<0||(m===0&&t.getUTCDate()<d.getUTCDate())) a--; return a; }
export function payEpfParts(wage:number,eeRate:number,erRate:number){ const w=wage<=20000?Math.ceil(wage/20)*20:wage; return { ee:eeRate>0?payRoundUp(w*eeRate):0, er:erRate>0?payRoundUp(w*erRate):0 }; }
export function payTableParts(wage:number,ceiling:number,eeRate:number,erRate:number){ const w=Math.min(Math.max(wage,0),ceiling); if(w<=0) return {ee:0,er:0}; const mid=payBandMid(w); return { ee:eeRate>0?payRound5(mid*eeRate):0, er:erRate>0?payRound5(mid*erRate):0 }; }
export function payProgTax(chargeable:number, bands:[number,number][]){ let tax=0,prev=0; for(const [cap,rate] of bands){ if(chargeable>prev) tax+=(Math.min(chargeable,cap)-prev)*rate; prev=cap; if(chargeable<=cap) break; } return tax; }
// emp: static employee record; cfg: hr_statutory_rates.rates; adj: this period's hr_payroll_adjustments;
// baseOverride: for hourly/daily staff, the grid-derived basic pay (server can't re-derive hours rules).
export function computePayrollMY(emp:any, cfg:any, adj:any[], baseOverride?:number, period?:any, ytd?:any){
  adj = adj||[];
  // v157: this used to honour cfg.taxBands, but the FRONTEND engine has the bands hard-coded and cannot
  // read them — so the moment anyone wrote rates.taxBands the two engines disagreed and hr_payroll_finalise
  // rejected every run with 409 recompute_mismatch, group-wide, with an error blaming a stale cache.
  // A configurable-looking knob that silently bricks payroll is worse than no knob: tax bands now change
  // only by editing MY_DEFAULT_TAX_BANDS here AND HR_TAX_BANDS in hros.html, in the same commit.
  // (Also: Infinity in the top band cannot survive a JSON round-trip from the DB — it returns as null.)
  const bands = MY_DEFAULT_TAX_BANDS;
  const isEarn=(a:any)=> ['allowance','bonus','ot'].indexOf(a.kind)>=0;
  const earn=adj.filter(isEarn);
  const addEarn=earn.reduce((s:number,a:any)=>s+Number(a.amount||0),0);
  const addEarnStat=earn.filter((a:any)=>a.epf_subject!==false).reduce((s:number,a:any)=>s+Number(a.amount||0),0);
  const unpaid=adj.filter((a:any)=>a.kind==='unpaid_leave').reduce((s:number,a:any)=>s+Number(a.amount||0),0);
  const otherDed=adj.filter((a:any)=>a.kind==='deduction').reduce((s:number,a:any)=>s+Number(a.amount||0),0);
  // v157: the payroll grid lets an admin type a Basic / Allowance for THIS period only (pro-rated joiner,
  // mid-month salary change). The frontend persists those as basic_set / allow_set adjustments and computes
  // from them — but this engine never read either kind, so the server recompute produced the FULL monthly
  // salary and hr_payroll_finalise rejected the entire company's run with 409 recompute_mismatch, with no
  // way to clear it. Hourly/daily staff still arrive via baseOverride (already grid-derived).
  const lastAdjAmt=(k:string)=>{ const m=adj.filter((a:any)=>a.kind===k); return m.length ? Number(m[m.length-1].amount||0) : null; };
  const bSet=lastAdjAmt('basic_set'), aSet=lastAdjAmt('allow_set');
  const base = (baseOverride!=null) ? Number(baseOverride)
             : ((bSet!=null?bSet:Number(emp.basic_salary||0)) + (aSet!=null?aSet:Number(emp.fixed_allowance||0)));
  const gross=payRound2(base+addEarn-unpaid);
  const statWage=Math.max(0, base+addEarnStat-unpaid);
  const bonusStat=earn.filter((a:any)=>a.kind==='bonus' && a.epf_subject!==false).reduce((s:number,a:any)=>s+Number(a.amount||0),0);
  // v180: SOCSO and EIS were computed on statWage, which INCLUDES bonus — so a bonus month over-deducted
  // from the employee and over-contributed for the company. The Employees' Social Security Act 1969
  // definition of wages excludes bonus, and EIS (Act 800) uses the same definition. EPF is the opposite:
  // bonus IS EPF wages, so EPF keeps using statWage.
  // Cross-checked against payroll.my on 3,500 + 369 bonus: it charges SOCSO/EIS on 3,500 (EIS 6.90) while
  // charging EPF on 3,869 (EPF ee 427.00) — EPF already agreed to the sen; SOCSO/EIS did not.
  const statWageExBonus=Math.max(0, statWage - bonusStat);
  const age=payAge(emp.date_of_birth, period), senior=(age!=null&&age>=60);
  // v166: citizenship, which is NOT the same question as `resident` (that is tax residency, for PCB).
  // Permanent Residents follow the Malaysian rates; only a non-PR foreigner is on the 2% schedule.
  const nonCitizen=String(emp.citizen_status||'citizen')==='non_citizen';
  const over75=(age!=null && age>=75);          // EPF liability ceases at 75 for everyone
  const epfOn=emp.epf_eligible!==false && !over75;
  const ncEe=cfg.epf.nonCitizenEe!=null?cfg.epf.nonCitizenEe:0.02;
  const ncEr=cfg.epf.nonCitizenEr!=null?cfg.epf.nonCitizenEr:0.02;
  // A non-citizen pays the flat 2% (mandatory since 1 Oct 2025) regardless of the 60+ senior split.
  const eeRate=(emp.epf_ee_rate!=null&&emp.epf_ee_rate!=='') ? Number(emp.epf_ee_rate)
             : nonCitizen ? ncEe : (senior ? (cfg.epf.eeSenior!=null?cfg.epf.eeSenior:0) : cfg.epf.eeRate);
  // v183: an employer may contribute ABOVE the statutory minimum (common for directors / senior staff),
  // which HR OS could only derive. Same precedence as the employee override: an explicit rate wins over
  // everything, including the non-citizen and 60+ schedules.
  const erRate=(emp.epf_er_rate!=null&&emp.epf_er_rate!=='') ? Number(emp.epf_er_rate)
             : nonCitizen ? ncEr
             : (senior ? (cfg.epf.erSenior!=null?cfg.epf.erSenior:0.04) : (statWage<=cfg.epf.threshold?cfg.epf.erRateLow:cfg.epf.erRateHigh));
  const ep=epfOn?payEpfParts(statWage,eeRate,erRate):{ee:0,er:0}; const epfEe=ep.ee, epfEr=ep.er;
  // v155: SOCSO & EIS are now EXACT lookups against the official PERKESO Second Schedule / EIS table
  // (the old midpoint×rate formula was 5 sen off on SOCSO employer and wrong on EIS above RM2,000).
  const socsoOn=emp.socso_eligible!==false;
  const scat=(emp.socso_category!=null&&emp.socso_category!=='') ? Number(emp.socso_category) : (senior?2:1);
  const sp=socsoOn?myStatLookup(scat===2?MY_SOCSO_CAT2:MY_SOCSO_CAT1, statWageExBonus):{ee:0,er:0}; const socsoEe=sp.ee, socsoEr=sp.er;
  // v166: EIS (Act 800) covers Malaysian citizens and Permanent Residents ONLY. A foreign worker
  // contributes nothing and is entitled to nothing — they are covered by Act 4 instead.
  const eisOn=emp.eis_eligible!==false && !senior && !nonCitizen;
  const ip=eisOn?myStatLookup(MY_EIS, statWageExBonus):{ee:0,er:0}; const eisEe=ip.ee, eisEr=ip.er;
  // v184: PERKESO LINDUNG 24 Jam / SKBBK (Act A1788, in force 1 June 2026) — 24-hour cover for accidents
  // OUTSIDE work. 100% employee-borne, no employer share; same Act 4 wage definition as SOCSO, so bonus is
  // excluded and the RM6,000 ceiling applies.
  const lindungOn = myLindungActive(period) && (nonCitizen ? true : emp.lindung24!==false) && socsoOn;
  const lindung = lindungOn ? myLindung24(statWageExBonus) : 0;
  const statWageNormal=statWageExBonus;   // same quantity — one definition only

  // v155/v156: PCB per the LHDN MTD net formula. Annualise over the employee's ACTUAL service months
  // in the tax year (mid-year joiner taxed on months worked, not flat ×12), reconcile against income &
  // PCB ALREADY paid earlier this year (ytd = go-live opening balances + prior finalised HR payslips):
  //   MTD = [ annual net tax(projected chargeable) − PCB already paid ] / remaining months.
  // Then LHDN rounding: truncate to 2 dp → round UP to next 5 sen; a monthly MTD below RM10 is nil.
  const N=myServiceMonths(emp, period);
  const yg=Number(ytd&&ytd.gross)||0, ye=Number(ytd&&ytd.epf)||0, yp=Number(ytd&&ytd.pcb)||0, ym=Number(ytd&&ytd.months)||0;
  const remain=Math.max(1, N - ym);           // this month + remaining months of the year
  let pcb:number;
  if(emp.resident===false){ pcb=myPcbRoundUp5(statWage*0.30); }
  else {
    const ms=String(emp.marital_status||'single').toLowerCase();
    const cat2=(ms==='married' && emp.spouse_working===false);
    const rPers=cfg.reliefPersonal!=null?cfg.reliefPersonal:9000, rSp=cfg.reliefSpouse!=null?cfg.reliefSpouse:4000, rCh=cfg.reliefChild!=null?cfg.reliefChild:2000, rEpf=cfg.reliefEpfMax!=null?cfg.reliefEpfMax:4000;
    const kids=Number(emp.num_children||0);
    const projGross=yg + statWageNormal*remain;   // prior-actual + (current + future estimated) months
    const projEpf=ye + epfEe*remain;
    // v165: SOCSO + EIS employee contributions are an allowable MTD relief, capped at RM350 a year. Leaving
    // it out over-deducted PCB from every employee — small per month, but it is a rule LHDN's own
    // computerised-calculation spec applies and any commercial payroll system applies too.
    // v184: SKBBK is a contribution to PERKESO under Act 4, so it falls in the same MTD relief as SOCSO
    // and EIS (s.46(1)(h), RM350/yr combined cap). In practice it usually just pins the relief at the cap.
    const projSocsoEis=Number(ytd&&ytd.socsoEis||0) + (socsoEe+eisEe+lindung)*remain;
    const rSocsoEis=cfg.reliefSocsoEisMax!=null?cfg.reliefSocsoEisMax:350;
    // v167: TP1 — reliefs the employee declared to the employer (lifestyle, medical, education,
    // insurance, SSPN, childcare…). LHDN obliges the employer to apply them to MTD; without this the
    // employee over-paid PCB all year and waited for the assessment refund.
    const tp1=Math.max(0, Number(ytd&&ytd.tp1)||0);
    // v185: PCB method, operator-selectable. Both engines read cfg, so this is safe to make configurable
    // — unlike cfg.taxBands, which the frontend could not read and which therefore bricked payroll (v157).
    //
    //   "lhdn"       — LHDN's prescribed method (what HR OS did through v184).
    //   "payroll_my" — reproduces payroll.my, which the operator asked for. It differs in TWO ways, both
    //                  confirmed against payroll.my's own documentation and its output:
    //                    (a) SOCSO/EIS (and SKBBK) are NOT treated as tax relief.
    //                    (b) the bonus is charged the residual annual tax minus the normal MTD that will
    //                        ACTUALLY be deducted — and a normal MTD under RM10 is nil, so in a low-tax
    //                        month the entire year's tax lands in the bonus month.
    //                  On the operator's own case (RM3,500 + RM369) that is 31.10 against LHDN's 12.05.
    const pcbMy = String(cfg.pcbMethod||"payroll_my")==="payroll_my";
    const reliefs=rPers + (cat2?rSp:0) + kids*rCh + Math.min(projEpf, rEpf)
                + (pcbMy ? 0 : Math.min(projSocsoEis, rSocsoEis)) + tp1;
    const chargeable=Math.max(0, projGross - reliefs);
    const tax=payProgTax(chargeable, bands);
    const rebate=chargeable<=35000 ? (400 + (cat2?400:0)) : 0;
    const monthlyBase=Math.max(0, ((tax-rebate) - yp) / remain);   // spread the REMAINING annual tax over the remaining months
    const bonusAnnual=()=>{
      const chargeableB=Math.max(0, projGross + bonusStat - reliefs);
      const taxB=payProgTax(chargeableB, bands);
      const rebateB=chargeableB<=35000 ? (400 + (cat2?400:0)) : 0;
      return (taxB-rebateB);
    };
    if(pcbMy){
      // The normal part first, with the under-RM10 rule applied to IT, because that is the figure
      // payroll.my subtracts ("combined PCB − salary-only PCB").
      let norm=myPcbRoundUp5(monthlyBase); if(norm<10) norm=0;
      const addl = bonusStat>0 ? Math.max(0, (bonusAnnual() - yp) - norm*remain) : 0;
      pcb = payRound2(norm + (addl>0 ? myPcbRoundUp5(addl) : 0));
    } else {
      const addlTax = bonusStat>0 ? Math.max(0, bonusAnnual()-(tax-rebate)) : 0;
      const pcbR=myPcbRoundUp5(monthlyBase + addlTax);
      pcb = pcbR < 10 ? 0 : pcbR;   // LHDN: monthly MTD of less than RM10 is nil
    }
  }
  // v165: zakat reduces tax RINGGIT-FOR-RINGGIT, it is not an ordinary deduction — LHDN's rule is
  // net MTD = MTD for the month − zakat paid for the month. HR OS offered "Zakat" as a payroll deduction
  // but treated it as any other deduction, so the employee paid zakat AND the full PCB on top. It still
  // comes out of net pay below; the PCB it displaces is what makes the employee whole.
  const zakatMonth=adj.filter((a:any)=>a.kind==='deduction' && /^zakat/i.test(String(a.label||"")))
                      .reduce((s:number,a:any)=>s+Number(a.amount||0),0);
  if(zakatMonth>0) pcb = Math.max(0, payRound2(pcb - zakatMonth));
  // v195: an explicit PCB for this period overrides everything above. Used when migrating mid-year from an
  // outsourced payroll, where the true MTD depends on year-to-date figures this system does not hold.
  // Applied LAST so it also wins over the zakat adjustment — the entered figure is the final MTD.
  const pcbSet=lastAdjAmt('pcb_set'); if(pcbSet!=null) pcb=Math.max(0, payRound2(pcbSet));
  // LINDUNG 24 has no employer share, so it reduces net pay without changing employer cost.
  const net=payRound2(gross-epfEe-socsoEe-eisEe-lindung-pcb-otherDed);
  const employerCost=payRound2(gross+epfEr+socsoEr+eisEr);
  return { gross, epfEe, epfEr, socsoEe, socsoEr, eisEe, eisEr, lindung, pcb, net, employerCost };
}
// v156: PCB-YTD per employee for the current period — go-live opening balances (emp.ytd_* when ytd_year
// matches the payroll year) PLUS every finalised HR payslip earlier this tax year. Used IDENTICALLY by
// hr_payroll_data (on-screen preview) and hr_payroll_finalise (authoritative) so the recompute-guard agrees.
export async function payBuildYtd(tenant:string, mo:number, yr:number, emps:any[]){
  const out:any = {};
  for(const e of (emps||[])) out[String(e.id)] = (Number(e.ytd_year)===Number(yr))
    ? { gross:Number(e.ytd_gross)||0, epf:Number(e.ytd_epf)||0, pcb:Number(e.ytd_pcb)||0, months:Number(e.ytd_months)||0 }
    : { gross:0, epf:0, pcb:0, months:0 };
  const { data: runs } = await sb.from("hr_payroll_runs").select("id").eq("tenant_id",tenant).eq("period_year",yr).lt("period_month",mo);
  const runIds = (runs||[]).map((r:any)=>r.id);
  if(runIds.length){
    const { data: ps } = await sb.from("hr_payslips").select("employee_id,gross,epf_ee,pcb,run_id").in("run_id", runIds);
    const monthsSeen:any = {};
    for(const p of (ps||[])){ const id=String(p.employee_id); if(!out[id]) continue;
      out[id].gross += Number(p.gross)||0; out[id].epf += Number(p.epf_ee)||0; out[id].pcb += Number(p.pcb)||0;
      (monthsSeen[id]=monthsSeen[id]||new Set()).add(p.run_id);
    }
    for(const id of Object.keys(monthsSeen)) out[id].months += (monthsSeen[id] as Set<any>).size;
  }
  // v167: TP1 — reliefs the employee declared to the employer for this tax year. Applied from the month
  // the declaration takes effect, which is how LHDN expects it (a TP1 handed in mid-year does not
  // retrospectively change months already filed).
  const empIdsY = (emps||[]).map((e:any)=>String(e.id));
  if (empIdsY.length){
    const { data: tp1s } = await sb.from("hr_tp1_declarations")
      .select("employee_id,items,effective_month").eq("year", yr).in("employee_id", empIdsY);
    for(const d of (tp1s||[])){
      const id=String(d.employee_id); if(!out[id]) continue;
      if (Number(d.effective_month||1) > Number(mo)) continue;      // not in force yet for this month
      const items = Array.isArray(d.items) ? d.items : [];
      out[id].tp1 = items.reduce((s:number,it:any)=>s + Math.max(0, Number(it&&it.amount)||0), 0);
    }
  }
  return out;
}

/** HR OS handler chain. Returns undefined when no branch matched, exactly as falling off the
 *  end of this section of the original if-chain did. */
export async function hrRoutes(b: any, api: string): Promise<Response | undefined> {
    if (api === "hr_companies") {
      const me = await meFromToken(b.token); if (!hrCanView(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const alw = await allowedTenants(b.token); // admins with a partial company assignment only see their companies
      const { data } = await sb.from("xero_tenants").select("tenant_id,tenant_name").order("tenant_name");
      return j({ ok:true, companies:(data||[]).filter((c:any)=>!alw.length || alw.indexOf(c.tenant_id)>=0).map((c:any)=>({ tenant_id:c.tenant_id, tenant_name:String(c.tenant_name||"").replace(/[^\x20-\x7E]/g,"").trim() })) });
    }
    // ── Access & Roles (Master Admin only): list portal users, change roles, invite viewers ──
    if (api === "hr_users_list") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      // v142: scope Access & Roles to the selected company. It listed EVERY account in the group
      // to any Master Admin — and 4 of the Master Admins are themselves scoped to one company,
      // so they could read every other company's staff emails.
      const alw = await allowedTenants(b.token);
      if (b.tenant && alw.indexOf(String(b.tenant)) < 0) return j({ ok:false, error:"forbidden" }, 403);
      const { data: users } = await sb.from("portal_users").select("id,email,name,role,created_at").order("role").order("email").range(0,999);
      const { data: ucAll } = await sb.from("portal_user_companies").select("user_id,tenant_id");
      const { count: tenantTotal } = await sb.from("xero_tenants").select("tenant_id", { count:"exact", head:true });
      const cosByUser:any = {};
      (ucAll||[]).forEach((r:any)=>{ (cosByUser[r.user_id] = cosByUser[r.user_id] || []).push(String(r.tenant_id)); });
      const want = b.tenant ? String(b.tenant) : null;
      const visibleUsers = (users||[]).filter((u:any)=>{
        const cos = cosByUser[u.id] || [];
        if (!cos.length) return true;                                  // unassigned account — always surfaced so it can be fixed
        if (want) return cos.indexOf(want) >= 0;
        return cos.some((t:string)=> alw.indexOf(t) >= 0);             // no company picked: everything in the caller's scope
      });
      const ids=visibleUsers.map((u:any)=>u.id); const empByUser:any={};
      if(ids.length){ const { data: emps } = await sb.from("hr_employees").select("user_id,name,emp_no").in("user_id",ids); (emps||[]).forEach((e:any)=>{ if(e.user_id) empByUser[e.user_id]=e; }); }
      const rows=visibleUsers.map((u:any)=>{
        const cos = cosByUser[u.id] || [];
        return { id:u.id, email:u.email, name:u.name, role:u.role,
                 employee:(empByUser[u.id]?empByUser[u.id].name:null),
                 self:!!(me.user&&me.user.id===u.id),
                 company_count: cos.length,
                 all_companies: cos.length >= (tenantTotal||0) && cos.length > 0,
                 // a scoped admin may not edit an account that also lives in a company they can't see
                 can_edit: cos.length ? cos.every((t:string)=> alw.indexOf(t) >= 0) : false };
      });
      const adminCount=(users||[]).filter((u:any)=>u.role==="admin").length;   // group-wide count: the last-admin guard must not be fooled by filtering
      // v207: who could still be given an Employee login. An employee login is only useful when it is
      // LINKED to an hr_employees row — rcMe resolves the caller by hr_employees.user_id, so an unlinked
      // one just tells them "your login isn't linked to an employee profile yet". Offering the roster
      // here is what lets the invite form create a linked login instead of a broken account.
      let candidates:any[] = [];
      if (want){
        const { data: emps } = await sb.from("hr_employees")
          .select("id,name,emp_no,email,user_id").eq("tenant_id",want).eq("status","active").order("emp_no");
        candidates = (emps||[]).filter((e:any)=>!e.user_id)
          .map((e:any)=>({ id:e.id, name:e.name, emp_no:e.emp_no, email:e.email||null }));
      }
      return j({ ok:true, users: rows, me_id:(me.user&&me.user.id)||null, admin_count:adminCount, scoped_tenant: want,
                 employee_candidates: candidates });
    }
    if (api === "hr_user_role_set") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const uid=String(b.user_id||""); const role=String(b.role||"").toLowerCase();
      if(!uid) return j({ ok:false, error:"No user specified." });
      if(["admin","hr_admin","viewer","approver","employee"].indexOf(role)<0) return j({ ok:false, error:"Invalid role." });
      // v142: a company-scoped Master Admin must not be able to re-role an account that belongs to
      // (or also belongs to) a company outside their access — the role itself is group-wide.
      if(!(await userWriteAllowed(b.token, me.user.id, uid))) return j({ ok:false, error:"That account belongs to a company outside your access." }, 403);
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
      // v207: "employee" is a valid role, but NOT one this action can create. It builds a bare portal_users
      // row, and an employee login only works when hr_employees.user_id points at it — otherwise the person
      // signs in and is told their login isn't linked to a profile. hr_rc_enable_login does the link.
      if(role==="employee") return j({ ok:false, error:"Employee logins are created from the employee record so they are linked to it — use the Employee option, which picks the person." });
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
    if (api === "hr_send_logins") {
      // v146: reset + email login credentials to the employees of ONE company. superAdmin only,
      // tenant-scoped. `test:true` sends a single probe to the caller's own inbox and touches NO
      // passwords — always run that first to confirm SMTP before a real batch. The real run returns
      // every temp password in the response so a failed email never leaves anyone locked out with a
      // credential nobody has.
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = String(b.tenant||"");
      if (!tenant) return j({ ok:false, error:"tenant required" });
      const alw = await allowedTenants(b.token);
      if (alw.indexOf(tenant) < 0) return j({ ok:false, error:"forbidden: company outside your access" }, 403);
      const loginUrl = String(b.login_url||HROS_URL);
      const { data: tn } = await sb.from("xero_tenants").select("tenant_name").eq("tenant_id", tenant).maybeSingle();
      const coName = (tn && tn.tenant_name) || "your company";
      // v189: point the person at the app they can actually use. An admin sent to hros.html is not
      // wrong exactly, but the Finance Portal is their home screen and the HR-only URL looks like a
      // downgrade.
      const portalUrl = APP_URL;
      const mkBody = (name:string, email:string, pass:string, role:string)=>{
        const isEmp = String(role||"employee")==="employee";
        const url = isEmp ? loginUrl : portalUrl;
        const what = isEmp ? "HR OS" : "CTG Finance Portal";
        return (
        "Hi "+name+",\n\n"+
        "Your HR OS login for "+coName+" is ready.\n\n"+
        "Portal: "+loginUrl+"\n"+
        "Email: "+email+"\n"+
        "Temporary password: "+pass+"\n\n"+
        "For security you will be asked to set your own password on first login.\n\n"+
        "———\n"+
        "您好 "+name+",\n\n"+
        coName+" 的 HR OS 登入已开通。\n\n"+
        "网址："+loginUrl+"\n"+
        "登入邮箱："+email+"\n"+
        "临时密码："+pass+"\n\n"+
        "首次登入后系统会要求您设置自己的新密码。\n\n"+
        "— CTG HR OS"
      );};
      // TEST MODE — verify SMTP end-to-end without changing a single password.
      if (b.test === true){
        const probe = await sendEmailTo(me.user.email, "HR OS — test email (no action taken)",
          "This is a test from HR OS to confirm email delivery works before sending employee logins. No passwords were changed.\n\n这是一封测试信,确认发信功能正常后才会寄送员工登入资料。没有任何密码被更改。", "CTG HR OS");
        return j({ ok: probe.ok, test:true, sent_to: me.user.email, error: probe.error });
      }
      // REAL RUN — employees of this tenant only.
      const { data: uc } = await sb.from("portal_user_companies").select("user_id").eq("tenant_id", tenant);
      const ids = (uc||[]).map((r:any)=>r.user_id);
      if (!ids.length) return j({ ok:false, error:"no users assigned to this company" });
      // v189: the role filter exists so a BULK run cannot silently reset every admin's password. When the
      // caller names people explicitly it is not a bulk run, and admins forget passwords too — so the
      // filter applies only to the un-targeted case. Still scoped to this tenant's own user list.
      const named = Array.isArray(b.emails) && b.emails.length>0;
      let uq = sb.from("portal_users").select("id,email,name,role").in("id", ids);
      if (!named) uq = uq.eq("role","employee");
      const { data: users } = await uq.order("name");
      let targets = (users||[]).filter((u:any)=> u.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email));
      // v188: optional per-person targeting. Without it the only way to (re)invite ONE new joiner was to
      // reset the WHOLE company — including everyone already logged in, whose working password would be
      // silently replaced. The filter is applied to the tenant's own user list, so it cannot be used to
      // reach a user outside the caller's company.
      if (Array.isArray(b.emails) && b.emails.length){
        const want: string[] = b.emails.map((e:any)=>String(e||"").trim().toLowerCase()).filter(Boolean);
        const before: string[] = targets.map((u:any)=>String(u.email).toLowerCase());
        targets = targets.filter((u:any)=> want.indexOf(String(u.email).toLowerCase())>=0);
        const missing = want.filter((e:string)=> before.indexOf(e)<0);
        if (missing.length) return j({ ok:false, error:"not an employee login in this company: "+missing.join(", ") });
        if (!targets.length) return j({ ok:false, error:"no matching employee logins" });
      }
      const results:any[] = [];
      for (const u of targets){
        const pass = "Ctg"+Math.random().toString(36).slice(2,7)+Math.floor(Math.random()*90+10)+"!";
        const { data: rr, error: re } = await sb.rpc("portal_admin_reset_password", { p_user_id: u.id, p_new_pass: pass });
        if (re || !(rr && rr.ok)){ results.push({ name:u.name, email:u.email, reset:false, emailed:false, error: (re && re.message) || (rr && rr.error) || "reset failed" }); continue; }
        const em = await sendEmailTo(u.email, "Your "+(String(u.role||"employee")==="employee"?"HR OS":"CTG Finance Portal")+" login — "+coName,
                                    mkBody(u.name||u.email, u.email, pass, u.role), "CTG HR OS");
        results.push({ name:u.name, email:u.email, temp_password:pass, reset:true, emailed:em.ok, error: em.ok?undefined:em.error });
      }
      const emailedN = results.filter((r)=>r.emailed).length;
      const resetN = results.filter((r)=>r.reset).length;
      await logAudit(me, "hr_send_logins", tenant, { total:targets.length, reset:resetN, emailed:emailedN });
      return j({ ok:true, company:coName, total:targets.length, reset:resetN, emailed:emailedN, results });
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
      // Add / rename / (de)activate a bank — global reference list shared by every company.
      // v150 (F2): full-scope admin only (it affects all tenants' payroll bank pickers).
      const me = await meFromToken(b.token); if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized (group-wide bank list — full-scope admin only)" }, 403);
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
        // Every employee may punch attendance (matches the HR OS employee self-service Time Clock tab).
        // Payroll only auto-fills basic pay from clocked hours for hourly/daily staff, so a full-time
        // punch records attendance without affecting their monthly salary.
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
        // v150 (MED-2): a punch left open across midnight measures 20-30h of elapsed time and overpays
        // hourly/daily staff. If the open punch is from a previous day, cap it to the employee's shift
        // length (default 8h) and flag it so HR can correct.
        let capped = false;
        if (String(open.work_date) < mytToday){
          const hm = (t:any)=>{ const m=String(t||"").match(/^(\d{1,2}):(\d{2})/); return m? (Number(m[1])+Number(m[2])/60) : null; };
          const st=hm(emp.shift_start), en=hm(emp.shift_end);
          let shiftLen = (st!=null && en!=null) ? (en>st ? en-st : (en+24-st)) : 8;
          if (!(shiftLen>0 && shiftLen<=16)) shiftLen = 8;
          if (hrs > shiftLen){ hrs = Math.round(shiftLen*100)/100; capped = true; }
        }
        const { data: upd, error } = await sb.from("hr_timeclock").update({ clock_out: new Date(nowMs).toISOString(), hours: hrs, status:"complete",
          out_lat:(b.lat!=null?Number(b.lat):null), out_lng:(b.lng!=null?Number(b.lng):null),
          note: capped ? (String(open.note||"")+" [auto-capped: left open across midnight]").trim() : open.note,
          updated_at:new Date().toISOString() }).eq("id",open.id).select().single();
        if (error) return j({ ok:false, error: error.message });
        return j({ ok:true, punch: upd, capped });
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
        const clkBase=CLOCK_URL;
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
      // v150 (LOW-8): required-field / format validation before this touches payroll + bank files.
      if (!String(f.name||"").trim()) return j({ ok:false, error:"Employee name is required." });
      { const acc = String(f.bankAccount||"").replace(/\D/g,""); if (acc && (acc.length < 5 || acc.length > 20)) return j({ ok:false, error:"Bank account number looks invalid (5–20 digits)." });
        // Enforce the 12-digit MyKad format only when the value is numeric; a passport (contains letters) is exempt.
        const icRaw = String(f.ic||"").trim(); const icDigits = icRaw.replace(/[-\s]/g,"");
        if (icRaw && /^\d+$/.test(icDigits) && icDigits.length !== 12) return j({ ok:false, error:"IC number must be 12 digits (or use a passport number with letters)." }); }
      // Bank: store the master-list CODE as source of truth; resolve the canonical display name from it
      // (keeps the payroll BIC file + vouchers working). Legacy records with no code keep their typed name.
      let bankCode = String(f.bankCode||"").trim() || null;
      let bankName = String(f.bankName||"").trim() || null;
      if (bankCode){ const { data: bk } = await sb.from("hr_banks").select("name").eq("code",bankCode).maybeSingle(); if (bk) bankName = bk.name; else bankCode = null; }
      const bankAccount = String(f.bankAccount||"").replace(/\D/g,"").slice(0,20) || null; // digits only, max 20, trimmed
      const bankHolder = String(f.bankHolder||"").trim() || null;
      // v157 (data-loss fix, same class as the v148 dept bug). The employee form does NOT post address /
      // managerId / claimRole / shift times, so writing them unconditionally set them to null on EVERY save:
      // editing a salary silently erased the home address the employee entered in My Profile (which is the
      // MyInvois buyer address), broke the "manager" approval step, and dropped their approver role.
      // Only write each of these when the caller actually sent the key; a brand-new employee may set null.
      const patch: any = { name:f.name };   // name is validated above and always sent
      const keepIfSent = (key:string, col:string, val:any)=>{ if (f[key] !== undefined || !f.id) patch[col] = val; };
      // v196: the same guard now covers EVERY field, not just the four v157 caught. The rest were still
      // written unconditionally, so any caller that sent a subset — a partial update, a future bulk import,
      // an integration — silently nulled date_of_birth (which drives the 60+ senior EPF rate and SOCSO
      // Category 2), the EPF/SOCSO/LHDN member numbers the statutory upload files are blocked without, the
      // bank details salaries are paid to, and the hourly/daily rate a part-timer is paid by. Worse, the
      // boolean flags used `!== false`, so an absent key did not null them — it flipped them back ON,
      // quietly re-enrolling an exempt employee into EPF, EIS or LINDUNG.
      // Verified live: a two-field save wiped date_of_birth to null.
      keepIfSent("ic",       "ic_no",   f.ic||null);
      keepIfSent("email",    "email",   f.email||null);
      keepIfSent("position", "position",f.position||null);
      keepIfSent("employmentType","employment_type",
        (["Full-time","Part-time","Contract","Intern","Probation"].indexOf(String(f.employmentType))>=0 ? f.employmentType : "Full-time"));
      keepIfSent("basic",    "basic_salary",    Number(f.basic)||0);
      keepIfSent("allowance","fixed_allowance", Number(f.allowance)||0);
      // Bank details move as one unit — a caller that sends any one of them is editing the payment
      // instruction, and a caller that sends none must not blank an account salaries are paid into.
      if (f.bankCode!==undefined || f.bankName!==undefined || f.bankAccount!==undefined || f.bankHolder!==undefined || !f.id){
        patch.bank_code=bankCode; patch.bank_name=bankName; patch.bank_account=bankAccount; patch.bank_holder=bankHolder;
      }
      keepIfSent("epfNo",  "epf_no",  f.epfNo||null);
      keepIfSent("socsoNo","socso_no",f.socsoNo||null);
      keepIfSent("taxNo",  "tax_no",  f.taxNo||null);
      keepIfSent("resident","resident",f.resident!==false);
      keepIfSent("epf",  "epf_eligible",  f.epf!==false);
      keepIfSent("socso","socso_eligible",f.socso!==false);
      keepIfSent("eis",  "eis_eligible",  f.eis!==false);
      // v184: LINDUNG 24 Jam (SKBBK). Default true — mandatory from 1 Jun 2026, voluntary for Malaysians
      // only from 13 Jul 2026 and only on an explicit TIDAK MENYERTAI opt-out.
      keepIfSent("lindung24","lindung24",f.lindung24!==false);
      keepIfSent("maritalStatus","marital_status",f.maritalStatus||"single");
      keepIfSent("spouseWorking","spouse_working",!!f.spouseWorking);
      keepIfSent("numChildren",  "num_children",  Number(f.numChildren)||0);
      keepIfSent("dob",      "date_of_birth",f.dob||null);
      keepIfSent("joinDate", "join_date",    f.joinDate||null);
      keepIfSent("epfEeRate","epf_ee_rate",  (f.epfEeRate===""||f.epfEeRate==null)?null:Number(f.epfEeRate));
      keepIfSent("epfErRate","epf_er_rate",  (f.epfErRate===""||f.epfErRate==null)?null:Number(f.epfErRate));
      keepIfSent("socsoCategory","socso_category",(f.socsoCategory===""||f.socsoCategory==null)?null:Number(f.socsoCategory));
      keepIfSent("payType",  "pay_type",   (["monthly","hourly","daily"].indexOf(String(f.payType))>=0?f.payType:"monthly"));
      keepIfSent("hourlyRate","hourly_rate",(f.hourlyRate===""||f.hourlyRate==null)?null:Number(f.hourlyRate));
      keepIfSent("dailyRate", "daily_rate", (f.dailyRate===""||f.dailyRate==null)?null:Number(f.dailyRate));
      keepIfSent("clockReminder","clock_reminder",!!f.clockReminder);
      // v166: citizenship drives the EPF rate and EIS eligibility. Guarded like every other optional field.
  keepIfSent("citizenStatus","citizen_status",
    (["citizen","pr","non_citizen"].indexOf(String(f.citizenStatus))>=0 ? String(f.citizenStatus) : "citizen"));
  keepIfSent("phone",      "phone",      f.phone||null);
      keepIfSent("address",    "address",    f.address||null);
      keepIfSent("managerId",  "manager_id", f.managerId||null);
      keepIfSent("claimRole",  "claim_role", (f.claimRole===""||f.claimRole==null)?null:f.claimRole);
      keepIfSent("shiftStart", "shift_start",(String(f.shiftStart||"").trim()||null));
      keepIfSent("shiftEnd",   "shift_end",  (String(f.shiftEnd||"").trim()||null));
      // v156: PCB YTD opening balances for a mid-year go-live (income/EPF/PCB already paid this tax year
      // before HR OS took over). Only written when the form actually sends them, so other saves don't clobber.
      if (f.ytdYear !== undefined){
        patch.ytd_year   = (f.ytdYear===""||f.ytdYear==null) ? null : Number(f.ytdYear);
        patch.ytd_gross  = Math.max(0, Number(f.ytdGross)||0);
        patch.ytd_epf    = Math.max(0, Number(f.ytdEpf)||0);
        patch.ytd_pcb    = Math.max(0, Number(f.ytdPcb)||0);
        patch.ytd_months = Math.max(0, Math.min(12, Number(f.ytdMonths)||0));
      }
      // Status / resignation (only touched when the form sends it, so we never clobber an existing status on partial saves)
      if (f.status !== undefined && f.status !== null && String(f.status) !== "") {
        const st = String(f.status).toLowerCase()==="resigned" ? "resigned" : "active";
        patch.status = st;
        patch.resign_date = st==="resigned" ? (String(f.resignDate||"").slice(0,10) || new Date(Date.now()+8*3600*1000).toISOString().slice(0,10)) : null;
      }
      // v148 (data-loss fix): Department became a 2-option dropdown, which pre-selects BLANK for any legacy
      // value (e.g. "IPROCARE"). Writing dept unconditionally then wiped that value to null whenever an admin
      // saved an unrelated field. Guard it exactly like status: only write dept when a non-blank value is sent,
      // so editing salary/bank/etc never clears a department the admin didn't touch.
      if (f.dept !== undefined && String(f.dept).trim() !== "") patch.dept = String(f.dept).trim();
      else if (!f.id) patch.dept = null;   // a brand-new employee with no team selected → explicit null is fine
      let res:any;
      if (f.id){
        // v150 (BLOCKER F1): the edit-by-id branch had NO tenant pin — the central guard only sees
        // b.tenant (the attacker's own company), so a scoped admin passing a FOREIGN employee's f.id could
        // overwrite that person's salary / bank account / IC / statutory numbers / resignation. Pin the
        // target's tenant to allowedTenants first (same guard hr_emp_delete already uses).
        const { data: exEmp } = await sb.from("hr_employees").select("tenant_id").eq("id",f.id).maybeSingle();
        if (!exEmp) return j({ ok:false, error:"Employee not found." });
        const alwE = await allowedTenants(b.token);
        if (exEmp.tenant_id && alwE.indexOf(String(exEmp.tenant_id)) < 0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403);
        res = await sb.from("hr_employees").update(patch).eq("id",f.id).select().single();
      }
      else {
        const tenant = String(b.tenant||f.tenant||"");
        if (!tenant) return j({ ok:false, error:"no company selected" });
        // Numeric max, not lexicographic: order("emp_no" desc) on TEXT ranks "E999" above "E1000",
        // which would hand out an already-taken number once headcount passes 999.
        // v150 (LOW-6): emp_no is UNIQUE; two concurrent creates could pick the same E### and the loser got a
        // raw duplicate-key error. Retry a few times on a unique violation, recomputing the next number.
        patch.status="active"; patch.tenant_id=tenant;
        for (let attempt=0; attempt<5; attempt++){
          const { data:allNos } = await sb.from("hr_employees").select("emp_no").order("emp_no",{ ascending:false }).range(0,9999);
          let maxN=0; (allNos||[]).forEach((r:any)=>{ const m=String(r.emp_no||"").match(/^E(\d+)$/i); if(m){ const v=parseInt(m[1],10); if(v>maxN) maxN=v; } });
          patch.emp_no = "E"+String(maxN+1+attempt).padStart(3,"0");
          res = await sb.from("hr_employees").insert(patch).select().single();
          if (!res.error) break;
          if (!/duplicate key|unique/i.test(String(res.error.message||""))) break;   // a different error → surface it
        }
      }
      if (res.error) return j({ ok:false, error:res.error.message });
      await logAudit(me,"hr_emp_save",String(res.data&&res.data.id),{ name:f.name });
      return j({ ok:true, employee:res.data });
    }
    if (api === "hr_emp_delete") {
      // Permanently delete a RESIGNED employee. Most child rows CASCADE at the DB; hr_payslips is RESTRICT,
      // so an employee with payroll history is protected unless the caller explicitly forces it.
      // Master-Admin-only: this is destructive and (with force) wipes payslip history = EA / Form E source.
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
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
      if(reqIds.length){ const { data: allSteps } = await sb.from("hr_leave_approval_steps").select("*").in("leave_request_id",reqIds).order("step_order"); await attachActorNames(allSteps||[], "decided_by", "decided_by_name"); await attachAssignees(allSteps||[], who.employee&&who.employee.tenant_id); (allSteps||[]).forEach((s:any)=>{ (stepsByReq[s.leave_request_id]=stepsByReq[s.leave_request_id]||[]).push(s); }); }
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
          // v196: lindung was stored on the payslip but never returned, so the employee's own payslip
          // listed deductions that did not add up to their net pay — short by exactly the LINDUNG amount.
          p:{ gross:Number(s.gross)||0, epfEe:Number(s.epf_ee)||0, epfEr:Number(s.epf_er)||0, socsoEe:Number(s.socso_ee)||0, socsoEr:Number(s.socso_er)||0, eisEe:Number(s.eis_ee)||0, eisEr:Number(s.eis_er)||0, lindung:Number(s.lindung24)||0, pcb:Number(s.pcb)||0, net:Number(s.net)||0, employerCost:Number(s.employer_cost)||0, _meta:{} },
          d:{ bonus:sumK(adj,"bonus"), ot:sumK(adj,"ot"), allowance:sumK(adj,"allowance"), unpaid:sumK(adj,"unpaid_leave"), deductions:(adj.filter((a:any)=>a.kind==="deduction").map((a:any)=>({ label:a.label||"Deduction", amount:Number(a.amount)||0 }))) } };
      }).sort((a:any,b:any)=> (b.year-a.year) || (b.month-a.month));
      // paid-leave balances (current year) for the payslip footer
      const yr2 = new Date(Date.now()+8*3600*1000).getUTCFullYear();
      const { data: ltypes } = await sb.from("hr_leave_types").select("id,code,name,paid,default_days").eq("active",true).order("code");
      const { data: lbals } = await sb.from("hr_leave_balances").select("leave_type_id,entitled,taken").eq("employee_id",emp.id).eq("year",yr2);
      const lbMap:any={}; (lbals||[]).forEach((x:any)=>{ lbMap[x.leave_type_id]=x; });
      const leaveBal = (ltypes||[]).filter((t:any)=>t.paid).map((t:any)=>{ const bl=lbMap[t.id]||{}; const entitled=bl.entitled!=null?Number(bl.entitled):Number(t.default_days||0); const taken=Number(bl.taken||0); return { type:t.name, code:t.code, entitled, taken, remaining:Math.round((entitled-taken)*100)/100 }; });
      const { data: employer } = await sb.from("hr_employer_info").select("*").eq("tenant_id",emp.tenant_id).maybeSingle();
      return j({ ok:true, payslips, leaveBal, year:yr2, employer: employer||null });
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
      // v159: only touch the bank when the caller actually sent the key. The My Profile form renders before
      // hr_banks_list resolves, so the picker briefly holds only its placeholder — saving in that window
      // sent bankCode:"" and nulled a bank_code the employee never touched (the bank NAME survived, so
      // nothing looked wrong until a payment file came out with a blank SWIFT/BIC).
      if (f.bankCode !== undefined) {
        const bankCode = s(f.bankCode,20);
        if (bankCode){ const { data: bk } = await sb.from("hr_banks").select("name").eq("code",bankCode).maybeSingle(); if (bk){ upd.bank_code=bankCode; upd.bank_name=bk.name; } }
        else { upd.bank_code=null; upd.bank_name=old.bank_name||null; } // cleared code keeps any legacy typed name
      }
      // Same guard for every other field: an absent key must mean "unchanged", never "set to null".
      const PROF_KEYS:[string,string][] = [["phone","phone"],["address","address"],["emergencyName","emergency_name"],
        ["emergencyPhone","emergency_phone"],["ic","ic_no"],["gender","gender"],["nationality","nationality"],
        ["dob","date_of_birth"],["maritalStatus","marital_status"],["spouseWorking","spouse_working"],
        ["numChildren","num_children"],["epfNo","epf_no"],["socsoNo","socso_no"],["taxNo","tax_no"],
        ["bankHolder","bank_holder"],["bankAccount","bank_account"]];
      for (const [src,col] of PROF_KEYS) if (f[src] === undefined) delete upd[col];
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
      // v194: this inserted status:"Submitted", which the hr_leave_requests status CHECK does not allow
      // (it permits Pending / Pending * Approval / Approved / Rejected / Cancelled). So EVERY leave
      // application ever made was rejected by the database — hr_leave_requests had 0 rows, and the whole
      // module had never worked once. "Submitted" appears nowhere else in the leave code; it is only used
      // for claims, which have their own status set.
      // A moment later this row is updated to the real first step (e.g. "Pending HR Approval"), so the
      // initial value only has to be a legal placeholder — "Pending" is also the column default.
      const { data: ins, error } = await sb.from("hr_leave_requests").insert({ employee_id:empId, leave_type:typeName, date_from:from, date_to:to, days, reason:String(b.reason||"").slice(0,500)||null, status:"Pending", current_step:1 }).select().single();
      if (error) return j({ ok:false, error: "Could not save the leave request: "+error.message });
      // Build the multi-level approval chain (configurable in hr_leave_flow_steps: a specific employee, the
      // applicant's direct manager, or a role holder).
      let firstStatus = "Pending";
      try {
        const { data: empRow } = await sb.from("hr_employees").select("manager_id,tenant_id").eq("id",empId).maybeSingle();
        const flow = await leaveFlowFor(empRow&&empRow.tenant_id, true);   // v157: this applicant's company
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
        // v157 (SoD): this was the ONLY decide path with no segregation-of-duties check — it force-approves
        // every step regardless of current_step. An hr_admin/admin could therefore approve their OWN leave
        // and skip the whole configured chain. Recording leave on behalf of SOMEBODY ELSE stays allowed.
        if (who.employee && String(empId) === String(who.employee.id))
          return j({ ok:false, error:"You cannot auto-approve your own leave — submit it and let your approver decide." }, 403);
        const actor=(me.user&&me.user.id)||null; const nowIso=new Date().toISOString();
        await sb.from("hr_leave_approval_steps").update({ status:"Approved", decided_by:actor, decided_emp_id:(who.employee&&who.employee.id)||null, decided_at:nowIso, comment:"Recorded by admin" }).eq("leave_request_id",ins.id);
        await sb.from("hr_leave_requests").update({ status:"Approved" }).eq("id",ins.id);
        try {
          const year = new Date(from).getFullYear();
          const { data:lt2 } = await sb.from("hr_leave_types").select("id,paid,default_days").eq("name",typeName).maybeSingle();
          if (lt2 && lt2.paid) {
            // v150 (MED-3): atomic increment — no read-modify-write race across concurrent approvals.
            await sb.rpc("hr_leave_balance_bump", { p_employee:empId, p_leave_type:lt2.id, p_year:year, p_delta:Number(days) });
          }
        } catch(_e){}
        await logAudit(me,"hr_leave_apply",String(ins.id),{ on_behalf:true, auto_approve:true, days });
        return j({ ok:true, request:{...ins, status:"Approved"}, days, approved:true });
      }
      // v196: log every application, not just the admin-on-behalf branch. A request notified at 19:47 on
      // 2026-08-11 later could not be found in hr_leave_requests, and with no audit row there was no way to
      // tell whether it was created, by whom, or what removed it. An approval email that cannot be traced
      // back to a record is worse than no email.
      await logAudit(me,"hr_leave_apply",String(ins.id),{ employee_id:empId, type:typeName, from, to, days, status:firstStatus });
      try { await leaveNotifyStep(ins.id); } catch(_e){}
      return j({ ok:true, request: {...ins, status:firstStatus}, days });
    }
    if (api === "hr_leave_cancel") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      const { data: req } = await sb.from("hr_leave_requests").select("*").eq("id",String(b.id)).maybeSingle();
      if(!req) return j({ ok:false, error:"not found" });
      if(!who.isAdmin && (!who.employee || req.employee_id!==who.employee.id)) return j({ ok:false, error:"forbidden" }, 403);
      if(!await leaveTenantOk(b.token, req)) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403);
      if(["Approved","Rejected","Cancelled"].indexOf(String(req.status))>=0) return j({ ok:false, error:"This request is already "+req.status+" and can’t be cancelled." });
      await sb.from("hr_leave_requests").update({ status:"Cancelled" }).eq("id",String(b.id));
      await logAudit(me,"hr_leave_cancel",String(b.id),{ employee_id:req.employee_id, from:req.status, dates:req.date_from+"→"+req.date_to });
      return j({ ok:true });
    }
    if (api === "hr_leave_pending") {
      // Approver queue: leave requests whose CURRENT step is this caller's (manager / their role). An admin
      // only sees steps nobody is assigned to — since v120 admin no longer satisfies somebody else's level,
      // so listing the rest here would just hand them a 403 on click.
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      if(!who.employee && !who.isAdmin) return j({ ok:true, requests:[] });
      // Fail-closed tenant scope: only pending leave from companies the caller belongs to. Without this
      // the query spanned ALL tenants and leaked every company's pending leave + PII (names, MC reasons)
      // to any admin or role approver. allowedTenants is now fail-closed (sentinel on error/misconfig).
      const alwPend = await allowedTenants(b.token);
      const { data: scopeEmps } = await sb.from("hr_employees").select("id").in("tenant_id", alwPend);
      const scopeSet = new Set((scopeEmps||[]).map((e:any)=>String(e.id)));
      const { data: reqs } = await sb.from("hr_leave_requests").select("*, hr_employees(name,emp_no,dept)").order("date_from",{ascending:false}).limit(300);
      const pend=(reqs||[]).filter((r:any)=>["Approved","Rejected","Cancelled"].indexOf(String(r.status))<0 && scopeSet.has(String(r.employee_id)));
      const out:any[]=[];
      for(const r of pend){
        const { data: step } = await sb.from("hr_leave_approval_steps").select("*").eq("leave_request_id",r.id).eq("step_order",r.current_step||1).maybeSingle();
        if(!step) { if(who.isAdmin) out.push({ ...r, current_step_name:"(no chain)" }); continue; }
        // v154: judge eligibility for THIS request (requester + anyone who already acted are excluded).
        const { data: pActed } = await sb.from("hr_leave_approval_steps").select("decided_by,id").eq("leave_request_id",r.id);
        const pActedUsers = (pActed||[]).filter((s:any)=>s.decided_by && s.id!==step.id).map((s:any)=>s.decided_by);
        if(!(await canActOrGap(who, step, r.tenant_id, { requesterEmpId: r.employee_id, actedUserIds: pActedUsers }))) continue;
        // Hide what this caller already acted on earlier in the same chain, or raised themselves.
        if(await sodViolation("hr_leave_approval_steps","leave_request_id",r.id,step.id,(me.user&&me.user.id)||null,who.employee&&who.employee.id,r.employee_id,"decided_by","decided_emp_id")) continue;
        out.push({ ...r, current_step_name: step.name||step.approver_role||"(unassigned)" });
      }
      return j({ ok:true, requests: out });
    }
    if (api === "hr_leave_flow_get") {
      const me = await meFromToken(b.token); if (!hrCanView(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const flowG = await leaveFlowFor(String(b.tenant||"").trim()||null);   // v157: per-company chain
      return j({ ok:true, steps: flowG });
    }
    if (api === "hr_leave_admin") {
      // Admin Leave tab: this company's requests with their approval steps + the current flow config.
      const me = await meFromToken(b.token); if (!hrCanView(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = String(b.tenant||"");
      { const alw=await allowedTenants(b.token); if(tenant && alw.length && alw.indexOf(tenant)<0) return denyTenant(me,"hr_leave_admin",tenant); }
      // Scope requests to the selected company's employees (was leaking every company's leave to any viewer).
      let tenantEmpIds:string[]|null = null;
      if(tenant){ const { data: te } = await sb.from("hr_employees").select("id").eq("tenant_id",tenant); tenantEmpIds=(te||[]).map((e:any)=>e.id); }
      let reqs:any[]=[];
      if(!tenant || (tenantEmpIds && tenantEmpIds.length)){
        let q = sb.from("hr_leave_requests").select("*, hr_employees(name,emp_no,dept)").order("date_from",{ascending:false}).limit(400);
        if(tenantEmpIds) q = q.in("employee_id", tenantEmpIds);
        const { data } = await q; reqs = data||[];
      }
      const ids=(reqs||[]).map((r:any)=>r.id); const stepsByReq:any={};
      if(ids.length){ const { data: st } = await sb.from("hr_leave_approval_steps").select("*").in("leave_request_id",ids).order("step_order"); await attachActorNames(st||[], "decided_by", "decided_by_name"); await attachAssignees(st||[], tenant||null); (st||[]).forEach((s:any)=>{ (stepsByReq[s.leave_request_id]=stepsByReq[s.leave_request_id]||[]).push(s); }); }
      const requests=(reqs||[]).map((r:any)=>({ ...r, steps: stepsByReq[r.id]||[] }));
      const flow = await leaveFlowFor(tenant);   // v157: the chain shown is the SELECTED company's
      // Active employees of the selected company — powers the apply-on-behalf picker, balance editor & name-based flow.
      const empQ = tenant ? await sb.from("hr_employees").select("id,name,emp_no").eq("tenant_id",tenant).eq("status","active").order("emp_no")
                          : await sb.from("hr_employees").select("id,name,emp_no").eq("status","active").order("emp_no").limit(500);
      const { data: types } = await sb.from("hr_leave_types").select("id,code,name,paid,default_days").eq("active",true).order("code");
      return j({ ok:true, requests, flow: flow||[], employees: empQ.data||[], leave_types: types||[] });
    }
    if (api === "hr_leave_flow_save") {
      // v150 (F2): the leave approval chain is one global row rewritten for every company → full-scope only.
      const me = await meFromToken(b.token); if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized (group-wide leave flow — full-scope admin only)" }, 403);
      // v157: scope the chain to the selected company. It used to be one global row set that the UI
      // nonetheless labelled "...for every leave request in <company>" with a picker listing only that
      // company's staff — so configuring SKINDAE silently replaced every other company's chain with people
      // who don't work there. Rows with tenant_id NULL stay the group-wide default for companies that have
      // not configured their own, so existing behaviour is preserved until an admin saves per company.
      const flowTenant = String(b.tenant||"").trim() || null;
      if (flowTenant) { const alw=await allowedTenants(b.token); if(alw.length && alw.indexOf(flowTenant)<0) return denyTenant(me,"hr_leave_flow_save",flowTenant); }
      const steps = Array.isArray(b.steps) ? b.steps : [];
      const clean = steps.map((s:any,i:number)=>{
        const t = s.approver_type==="employee" ? "employee" : (s.approver_type==="manager" ? "manager" : "role");
        return {
          step_order:i+1,
          name:String(s.name||s.approver_role||"Step").slice(0,60),
          approver_type:t,
          approver_role:(t==="role" ? (String(s.approver_role||"").trim()||null) : null),
          approver_employee_id:(t==="employee" ? (String(s.approver_employee_id||"").trim()||null) : null),
          active:true, tenant_id: flowTenant,
        };
      }).filter((s:any)=> s.approver_type==="manager" || (s.approver_type==="role" && s.approver_role) || (s.approver_type==="employee" && s.approver_employee_id));
      // Delete ONLY this company's chain (or only the group-wide rows when saved without a company).
      const delQ = sb.from("hr_leave_flow_steps").delete();
      const { error: eDelFlow } = await (flowTenant ? delQ.eq("tenant_id",flowTenant) : delQ.is("tenant_id",null));
      if (eDelFlow) return j({ ok:false, error:eDelFlow.message });
      // v157: the insert used to be unchecked — a failure left ZERO approval levels while the UI said
      // "Saved", so every subsequent leave request skipped the chain entirely.
      if(clean.length){ const { error:eInsFlow } = await sb.from("hr_leave_flow_steps").insert(clean); if(eInsFlow) return j({ ok:false, error:eInsFlow.message }); }
      await logAudit(me,"hr_leave_flow_save",String(clean.length),{ tenant: flowTenant });
      const { data } = await sb.from("hr_leave_flow_steps").select("*").or("tenant_id.is.null,tenant_id.eq."+(flowTenant||NO_TENANT)).order("step_order");
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
      // v174: refuse to record less than the Employment Act floor. s.60E/s.60F are minimums an employer
      // cannot contract below, and the old flat 14/14 default was already short for 5 of 6 staff with a
      // recorded join date. Granting MORE is always allowed.
      try {
        const { data: lt } = await sb.from("hr_leave_types").select("code").eq("id",ltId).maybeSingle();
        const code = lt && String(lt.code);
        if (code === "AL" || code === "ML") {
          const { data: empRow } = await sb.from("hr_employees").select("join_date").eq("id",empId).maybeSingle();
          if (empRow && empRow.join_date) {
            const { data: mr } = await sb.rpc("hr_statutory_leave_min",
              { p_join_date: empRow.join_date, p_ref: year + "-12-31" });
            const m = Array.isArray(mr) ? mr[0] : mr;
            const floor = m ? (code === "AL" ? m.annual_min : m.sick_min) : null;
            if (floor != null && entitled < floor)
              return j({ ok:false, error:"Employment Act 1955 sets a minimum of " + floor + " days of " +
                (code==="AL" ? "annual" : "sick") + " leave for " + m.years +
                " years of service. You entered " + entitled + ". Grant at least " + floor + "." }, 400);
          }
        }
      } catch(_e){}
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
      if(!await leaveTenantOk(b.token, req)) return j({ ok:false, error:"You do not have access to this company's leave." }, 403);
      if(["Approved","Rejected","Cancelled"].indexOf(String(req.status))>=0) return j({ ok:false, error:"Already handled — this request is "+req.status+"." });
      const { data: step } = await sb.from("hr_leave_approval_steps").select("*").eq("leave_request_id",id).eq("step_order",req.current_step||1).maybeSingle();
      const { data: lActed } = await sb.from("hr_leave_approval_steps").select("decided_by,id").eq("leave_request_id",id);
      const lActedUsers = (lActed||[]).filter((s:any)=>s.decided_by && (!step || s.id!==step.id)).map((s:any)=>s.decided_by);
      if(!(await canActOrGap(who, step, req.tenant_id, { requesterEmpId: req.employee_id, actedUserIds: lActedUsers })))
        return j({ ok:false, error:"You are not the approver for this step"+(step&&step.approver_role?(" (\""+step.approver_role+"\")"):"")+". Ask that approver to act, or assign someone to the role in Leave settings." }, 403);
      const actor=(me.user&&me.user.id)||null; const nowIso=new Date().toISOString(); const comment=String(b.comment||"").slice(0,500);
      const sodErr = await sodViolation("hr_leave_approval_steps","leave_request_id",id,step&&step.id,actor,who.employee&&who.employee.id,req.employee_id,"decided_by","decided_emp_id");
      if(sodErr) return j({ ok:false, error:sodErr }, 403);
      const { data: emp } = await sb.from("hr_employees").select("name,email").eq("id",req.employee_id).maybeSingle();
      if(decision==="reject"){
        if(step) await sb.from("hr_leave_approval_steps").update({ status:"Rejected", decided_by:actor, decided_emp_id:(who.employee&&who.employee.id)||null, decided_at:nowIso, comment }).eq("id",step.id);
        await sb.from("hr_leave_requests").update({ status:"Rejected" }).eq("id",id);
        await logAudit(me,"hr_leave_decide",id,{ decision:"reject", step:step&&step.name });
        try{ if(emp&&emp.email) await rcSendEmail(emp.email, "[HR OS] Your leave request was not approved", "Hi "+((emp&&emp.name)||"")+",\n\nYour "+req.leave_type+" leave "+req.date_from+" → "+req.date_to+" was rejected"+(comment?(" — "+comment):".")+"\n\n— CTG HR OS (automated)"); }catch(_e){}
        return j({ ok:true, status:"Rejected" });
      }
      // approve current step
      if(step) await sb.from("hr_leave_approval_steps").update({ status:"Approved", decided_by:actor, decided_emp_id:(who.employee&&who.employee.id)||null, decided_at:nowIso, comment }).eq("id",step.id);
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
          // v150 (MED-3): atomic increment — concurrent approvals of the same employee's requests can't
          // clobber each other's balance write.
          await sb.rpc("hr_leave_balance_bump", { p_employee:req.employee_id, p_leave_type:lt.id, p_year:year, p_delta:Number(req.days) });
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
      // v156: PCB-YTD (opening balances + prior finalised months) so the on-screen MTD matches the server.
      const ytd = await payBuildYtd(tenant, mo, yr, emp.data||[]);
      return j({ ok:true, employees:emp.data||[], rates:(rt.data&&rt.data.rates)||null, adjustments:adj.data||[], run:run.data||null, payslips, attendance, leaveBalances, ytd });
    }
    if (api === "hr_adj_add") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const a=b.adj||{};
      { const { data: emp } = await sb.from("hr_employees").select("tenant_id").eq("id",String(a.employeeId)).maybeSingle();
        const alw=await allowedTenants(b.token); if(emp && alw.length && emp.tenant_id && alw.indexOf(emp.tenant_id)<0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }
      const { error } = await sb.from("hr_payroll_adjustments").insert({ employee_id:String(a.employeeId), period_month:Number(a.month), period_year:Number(a.year), kind:a.kind, label:a.label||null, amount:Number(a.amount)||0, epf_subject:a.epfSubject!==false });
      if (error) return j({ ok:false, error:error.message });
      await logAudit(me,"hr_adj_add",String(a.employeeId),{ kind:a.kind, amount:a.amount });
      return j({ ok:true });
    }
    if (api === "hr_adj_del") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data: row } = await sb.from("hr_payroll_adjustments").select("*").eq("id",String(b.id)).maybeSingle();
      if(row){ const { data: emp } = await sb.from("hr_employees").select("tenant_id").eq("id",row.employee_id).maybeSingle();
        const alw=await allowedTenants(b.token); if(emp && alw.length && emp.tenant_id && alw.indexOf(emp.tenant_id)<0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }
      const { error } = await sb.from("hr_payroll_adjustments").delete().eq("id",String(b.id));
      if (error) return j({ ok:false, error:error.message });
      if(row) await logAudit(me,"hr_adj_del",String(b.id),{ employee_id:row.employee_id, kind:row.kind, amount:row.amount, period:row.period_month+"/"+row.period_year });
      return j({ ok:true });
    }
    if (api === "hr_payroll_finalise") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const mo=Number(b.month), yr=Number(b.year), rows=Array.isArray(b.rows)?b.rows:[]; const tenant=String(b.tenant||"");
      if (!tenant) return j({ ok:false, error:"no company selected" });
      { const alw=await allowedTenants(b.token); if(alw.length && alw.indexOf(tenant)<0) return denyTenant(me,"hr_payroll_finalise",tenant); }
      // v150 (MED-5): reject an empty run — it would delete-then-insert-nothing and wipe finalised payslips
      // (the EA / Form-E source of record). v150 (HIGH-1): these figures are computed client-side and written
      // verbatim, so validate every figure is a finite non-negative number and every employee belongs to this
      // company, before they become the official statutory record.
      if (!rows.length) return j({ ok:false, error:"No payroll rows to finalise." });
      const NUMF=["gross","epfEe","epfEr","socsoEe","socsoEr","eisEe","eisEr","lindung","pcb","net","employerCost"];
      const empIds = rows.map((r:any)=>r.employeeId).filter(Boolean);
      // v151: SERVER-SIDE RECOMPUTE. The statutory figures used to be computed client-side and written
      // verbatim into hr_payslips (the EA/Form-E record). Now the server independently recomputes every
      // employee's EPF/SOCSO/EIS/PCB from the DB employee record + this period's stored adjustments + the
      // statutory rates, using the audited Malaysian engine (computePayrollMY). It then COMPARES to the
      // submitted figures: any >1-sen mismatch REJECTS the run (a stale cached frontend or tampering), and
      // the SERVER figures are what get written — so the official record is always authoritative.
      const { data: fullEmps } = await sb.from("hr_employees").select("*").eq("tenant_id",tenant).in("id", empIds.length?empIds:["00000000-0000-0000-0000-000000000000"]);
      const empById:any = {}; (fullEmps||[]).forEach((e:any)=>{ empById[String(e.id)]=e; });
      const { data: rateRow } = await sb.from("hr_statutory_rates").select("rates").eq("id",1).maybeSingle();
      const cfg = rateRow && rateRow.rates; if(!cfg || !cfg.epf || !cfg.socso || !cfg.eis) return j({ ok:false, error:"Statutory rates are not configured — set EPF/SOCSO/EIS rates before finalising." }, 400);
      const { data: allAdj } = await sb.from("hr_payroll_adjustments").select("*").eq("period_month",mo).eq("period_year",yr).in("employee_id", empIds.length?empIds:["00000000-0000-0000-0000-000000000000"]);
      const adjByEmp:any = {}; (allAdj||[]).forEach((a:any)=>{ (adjByEmp[String(a.employee_id)]=adjByEmp[String(a.employee_id)]||[]).push(a); });
      const ytdMap = await payBuildYtd(tenant, mo, yr, fullEmps||[]);   // v156: same YTD basis as the preview
      const server:any[] = []; const mism:string[] = [];
      for (const r of rows){
        const eid=String(r.employeeId||""); const emp=empById[eid];
        if (!eid || !emp) return j({ ok:false, error:"A payslip references an employee not in this company — refusing to finalise." }, 400);
        for (const k of NUMF){ const v=Number((r as any)[k]); if (!isFinite(v) || v < 0) return j({ ok:false, error:"A payslip figure ("+k+") is not a valid non-negative number — recompute and retry." }, 400); }
        const adjE = adjByEmp[eid]||[];
        // Monthly staff → base fully derived from the employee record. Hourly/daily → base comes from the
        // timeclock-driven grid (the one input the server can't re-derive); re-derive it from the submitted
        // gross so the STATUTORY deductions are still recomputed authoritatively from that wage.
        const payType=String(emp.pay_type||"monthly").toLowerCase();
        let baseOverride:number|undefined = undefined;
        if (payType==="hourly" || payType==="daily"){
          const earnSum=adjE.filter((a:any)=>['allowance','bonus','ot'].indexOf(a.kind)>=0).reduce((s:number,a:any)=>s+Number(a.amount||0),0);
          const unpaidSum=adjE.filter((a:any)=>a.kind==='unpaid_leave').reduce((s:number,a:any)=>s+Number(a.amount||0),0);
          baseOverride=Math.max(0, Number(r.gross||0) - earnSum + unpaidSum);
        }
        const c = computePayrollMY(emp, cfg, adjE, baseOverride, { month: mo, year: yr }, ytdMap[eid]);
        server.push({ eid, c });
        // compare every figure the client sent (skip gross for hourly/daily, whose base we took from them)
        const cmpKeys = (payType==="hourly"||payType==="daily") ? NUMF.filter(k=>k!=="gross") : NUMF;
        for (const k of cmpKeys){
          const cv=Number((r as any)[k]), sv=Number((c as any)[k]);
          if (Math.abs(cv-sv) > 0.01){ mism.push((emp.name||eid)+" · "+k+": screen "+cv.toFixed(2)+" vs server "+sv.toFixed(2)); }
        }
      }
      if (mism.length){
        return j({ ok:false, recompute_mismatch:true,
          error:"Server recomputation disagrees with the on-screen figures — refusing to finalise. This usually means the page is showing a stale/cached calculation, or the statutory rates changed. Reload HR OS, reopen Payroll for this month, and finalise again.",
          details: mism.slice(0,6) }, 409);
      }
      // v181: finalised_at is its own column, NOT updated_at — saving draft entries also touches the row,
      // so a shared timestamp could not answer "were the entries edited after the payslips were issued?".
      const { data:run, error:e1 } = await sb.from("hr_payroll_runs").upsert({ tenant_id:tenant, period_month:mo, period_year:yr, status:"finalised", finalised_at:new Date().toISOString(), updated_at:new Date().toISOString() }, { onConflict:"tenant_id,period_month,period_year" }).select().single();
      if (e1) return j({ ok:false, error:e1.message });
      await sb.from("hr_payslips").delete().eq("run_id",run.id);
      // Write the SERVER-recomputed figures (authoritative), not the client's.
      const payload = server.map((s:any)=>({ run_id:run.id, employee_id:s.eid, gross:s.c.gross, epf_ee:s.c.epfEe, epf_er:s.c.epfEr, socso_ee:s.c.socsoEe, socso_er:s.c.socsoEr, eis_ee:s.c.eisEe, eis_er:s.c.eisEr, lindung24:s.c.lindung, pcb:s.c.pcb, net:s.c.net, employer_cost:s.c.employerCost }));
      if (payload.length){ const { error:e2 } = await sb.from("hr_payslips").insert(payload); if (e2) return j({ ok:false, error:e2.message }); }
      await logAudit(me,"hr_payroll_finalise",String(run.id),{ month:mo, year:yr, n:payload.length, server_recomputed:true });
      return j({ ok:true, runId:run.id, server_recomputed:true });
    }
    // ===== Reimbursement / Claim module (hr_rc_*) =====
    // v224 — Web Push RETIRED. push_pubkey / push_subscribe / push_test are gone: nothing sends a push
    // any more, and leaving push_subscribe reachable would let a home-screen install of the OLD hros.html
    // (which still carries the enable button, because an installed copy never updates) create fresh rows
    // in a table nothing drains. push_unsubscribe below is kept for the opposite reason.
    if (api === "push_unsubscribe") {
      // KEPT past the v224 retirement, deliberately. The forwarding page on the old GitHub Pages origin
      // calls this while unregistering sw.js, and with the sender gone the 404/410 prune in
      // pushToEmployee() — previously the other way a row died — never runs again. This is now the only
      // path a subscription leaves hr_push_subscriptions short of a manual DELETE.
      const me = await meFromToken(b.token); if(!me||!me.ok) return j({ ok:false, error:"unauthorized" },401);
      const endpoint=String(b.endpoint||""); if(endpoint) await sb.from("hr_push_subscriptions").delete().eq("endpoint",endpoint);
      return j({ ok:true });
    }
    if (api === "hr_shift_save") {
      // A part-timer arranges their OWN timetable (shift start/end + work days) — drives the clock-in
      // AND clock-out reminders. Self-service by default; an admin (hrManage) may set another employee's
      // schedule, tenant-pinned. (It only affects reminders, no pay impact, so self-service is safe.)
      const me = await meFromToken(b.token); if(!me||!me.ok) return j({ ok:false, error:"unauthorized" },401);
      const who = await rcMe(me);
      let empId = String(b.employee_id||""); if(!empId) empId = (who.employee && who.employee.id) || "";
      if(!empId) return j({ ok:false, error:"Your login isn’t linked to an employee profile yet." });
      const isSelf = !!(who.employee && String(who.employee.id)===String(empId));
      if(!isSelf){
        if(!hrManage(me)) return j({ ok:false, error:"You can only set your own schedule." },403);
        const { data: te } = await sb.from("hr_employees").select("tenant_id").eq("id",empId).maybeSingle();
        if(!te) return j({ ok:false, error:"employee not found" });
        const alw=await allowedTenants(b.token); if(te.tenant_id && alw.indexOf(te.tenant_id)<0) return denyTenant(me,"hr_shift_save",te.tenant_id);
      }
      // v157: `undefined` used to fall through to String(undefined).slice(0,5) === "undef" — the employee
      // form calls this without shift_end, so the UPDATE either failed outright (work_days never persisted,
      // error swallowed by the caller) or stored the literal "undef" and killed the clock-out reminder.
      // Treat undefined as "not sent" and leave the stored value alone.
      const hhmm=(v:any)=> (v===null||v===undefined||v==="")?null:String(v).slice(0,5);   // 'HH:MM'
      const wd = Array.isArray(b.work_days) ? Array.from(new Set(b.work_days.map((x:any)=>Number(x)).filter((n:number)=>n>=1&&n<=7))) : null;
      const patch:any = { work_days: wd, reminders_on: b.reminders_on!==false };
      if (b.shift_start !== undefined) patch.shift_start = hhmm(b.shift_start);
      if (b.shift_end   !== undefined) patch.shift_end   = hhmm(b.shift_end);
      const { error } = await sb.from("hr_employees").update(patch).eq("id",empId);
      if(error) return j({ ok:false, error:error.message });
      await logAudit(me,"hr_shift_save",empId,{ shift_start:patch.shift_start, shift_end:patch.shift_end, work_days:wd, reminders_on:patch.reminders_on, self:isSelf });
      return j({ ok:true });
    }
    // v224 — `clockin_reminder_run` RETIRED with Web Push. It was push-only: it read
    // hr_employees.reminders_on, sent through pushToEmployee() and logged to hr_push_reminder_log, and
    // did nothing else. The EMAIL clock reminder is a DIFFERENT handler with a name one word away —
    // `cron_clock_reminders` (:1116), gated on hr_employees.clock_reminder — and it is untouched and must
    // stay scheduled. Unscheduling the pg_cron job that called THIS one is a captain action.
    if (api === "hr_signature_save") {
      // Your own handwritten signature, stamped on the reimbursement form next to your name.
      // Self-service only by default: a signature is forgeable by anyone who can print the form, so
      // one person must not be able to install another person's. hrManage may set one for an employee
      // with no login yet (E002/E009/E010/E011 etc) — that is audited as on_behalf.
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      let empId = who.employee && who.employee.id;
      let onBehalf = false;
      if (b.employee_id && String(b.employee_id)!==String(empId||"")) {
        if (!who.isAdmin) return j({ ok:false, error:"You can only set your own signature." }, 403);
        const { data: te } = await sb.from("hr_employees").select("id,tenant_id,user_id").eq("id",String(b.employee_id)).maybeSingle();
        if (!te) return j({ ok:false, error:"employee not found" });
        if (te.user_id) return j({ ok:false, error:"That employee has a login — they must add their own signature." }, 403);
        const alw = await allowedTenants(b.token); if (alw.length && te.tenant_id && alw.indexOf(te.tenant_id)<0) return denyTenant(me,"hr_signature_save",te.tenant_id);
        empId = te.id; onBehalf = true;
      }
      if (!empId) return j({ ok:false, error:"Your login isn’t linked to an employee profile yet." });
      let sig:any = undefined;
      if (b.signature===null) sig = null;
      else if (typeof b.signature==="string" && b.signature.indexOf("data:image/")===0) {
        if (b.signature.length>200000) return j({ ok:false, error:"Signature image is too large — draw it again or use a smaller file." });
        sig = b.signature;
      } else return j({ ok:false, error:"invalid signature image" });
      const { error } = await sb.from("hr_employees").update({ signature:sig, signature_updated_at:new Date().toISOString() }).eq("id",empId);
      if (error) return j({ ok:false, error:error.message });
      await logAudit(me,"hr_signature_save",String(empId),{ cleared: sig===null, on_behalf:onBehalf });
      return j({ ok:true, signature:sig });
    }
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
      // v150 (F3): an admin sets employee_id + tenant from the body. The central guard validates b.tenant
      // is theirs, but the referenced employee could belong to ANOTHER company — pin it. Also, on edit,
      // the existing claim must belong to this tenant (can't pull a foreign draft into your company).
      if (who.isAdmin){
        if (empId){
          const { data: rcEmp } = await sb.from("hr_employees").select("tenant_id").eq("id", empId).maybeSingle();
          if (!rcEmp || String(rcEmp.tenant_id) !== String(tenant)) return j({ ok:false, error:"forbidden: employee is not in this company" }, 403);
        }
        if (c.id){
          const { data: rcEx } = await sb.from("hr_claim_requests").select("tenant_id").eq("id", c.id).maybeSingle();
          if (rcEx){ const alwRc = await allowedTenants(b.token); if (alwRc.indexOf(String(rcEx.tenant_id)) < 0) return j({ ok:false, error:"forbidden: claim outside your access" }, 403); }
        }
      }
      const { data: allTypes } = await sb.from("hr_claim_types").select("id,is_mileage,taxable");
      const typeMap:any={}; (allTypes||[]).forEach((t:any)=>{ typeMap[t.id]=t; });
      const items:any[]|null = (Array.isArray(c.items)&&c.items.length) ? c.items : null;
      let amount=0, headerType:any=null, anyTaxable=false; const normItems:any[]=[];
      if(items){
        for(const it of items){
          const t=typeMap[it.claim_type_id]||{};
          // Mileage line (spec §4): final = km × rate + parking + toll. Other lines: entered amount.
          // Both branches to the sen. A mileage line always was; a typed line was not, so an amount
          // entered with a third decimal was STORED raw on the item, printed on the approval document
          // through toFixed(2), and rolled into a header total that Math.round()s the sum — three
          // roundings of one figure, and the header is what the bank file pays. Must stay identical to
          // hrRCItemAmt() in hros.html, which is the same line on the other side of the wire.
          const amt = t.is_mileage
            ? Math.round(((Number(it.total_km)||0)*(Number(it.mileage_rate)||0)+(Number(it.parking_amount)||0)+(Number(it.toll_amount)||0))*100)/100
            : Math.round((Number(it.amount)||0)*100)/100;
          amount+=amt; if(t.taxable) anyTaxable=true;
          normItems.push({ claim_type_id:it.claim_type_id||null, item_date:it.item_date||c.claim_date||null, amount:amt, description:it.description||"",
            vendor_name:it.vendor_name||null, receipt_no:(String(it.receipt_no||"").trim()||null), invoice_no:(String(it.invoice_no||"").trim()||null),
            is_einvoice:!!it.is_einvoice, supplier_tin:(String(it.supplier_tin||"").trim()||null), einvoice_uuid:(String(it.einvoice_uuid||"").trim()||null), einvoice_validation_url:(String(it.einvoice_validation_url||"").trim()||null),
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
        amount = (t.is_mileage && c.mileage) ? Math.round(((Number(c.mileage.total_km)||0)*(Number(c.mileage.mileage_rate)||0)+(Number(c.mileage.parking_amount)||0)+(Number(c.mileage.toll_amount)||0))*100)/100 : Math.round((Number(c.amount)||0)*100)/100;
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
        // v159: unchecked. A failed update returned ok:true and the UI toasted "Draft saved".
        { const { error:eUpd } = await sb.from("hr_claim_requests").update(row).eq("id",c.id); if(eUpd) return j({ ok:false, error:eUpd.message }); }
      } else {
        row.status="Draft"; row.created_by=(me.user&&me.user.id)||null;
        try { row.claim_no = await rcNextClaimNo(tenant); }
        catch(e:any){ return j({ ok:false, error:String((e&&e.message)||e) }); }
        const { data: ins, error } = await sb.from("hr_claim_requests").insert(row).select("id").single();
        if(error) return j({ ok:false, error:error.message });
        claimId=ins.id; await rcAuditLog(claimId,"create",me,null,"Draft",{});
      }
      if(items){
        // v159 made this failure visible; v163 makes it atomic. Delete-then-insert over two round trips
        // meant a failed insert left the claim header carrying the NEW amount with ZERO expense lines —
        // an amount with no supporting detail, heading into the approval chain. One transaction now.
        { const { error:eItems } = await sb.rpc("hr_claim_items_replace", { p_claim: claimId, p_rows: normItems });
          if(eItems) return j({ ok:false, error:"Expense lines could not be saved ("+eItems.message+"). Nothing was changed — please retry." }); }
        await sb.from("hr_mileage_claim_details").delete().eq("claim_id",claimId);
      } else if(headerType && typeMap[headerType] && typeMap[headerType].is_mileage && c.mileage){
        await sb.from("hr_mileage_claim_details").delete().eq("claim_id",claimId);
        await sb.from("hr_mileage_claim_details").insert({ claim_id:claimId, start_location:c.mileage.start_location||"", end_location:c.mileage.end_location||"", total_km:Number(c.mileage.total_km)||0, mileage_rate:Number(c.mileage.mileage_rate)||0, calculated_amount:amount });
      }
      return j({ ok:true, id:claimId, amount });
    }
    // v186: mint a one-shot signed URL so the browser PUTs the file straight to storage. Same permission
    // checks as hr_rc_attach — this hands out write access to a path, so it cannot be the loose one.
    if (api === "hr_rc_attach_sign") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      const claimId=b.claim_id; if(!claimId) return j({ ok:false, error:"claim_id required" });
      const { data: ac } = await sb.from("hr_claim_requests").select("tenant_id,status,employee_id").eq("id",claimId).maybeSingle();
      if(!ac) return j({ ok:false, error:"claim not found" });
      if(who.isAdmin && ac.tenant_id){
        const alwA=await allowedTenants(b.token);
        if(alwA.indexOf(String(ac.tenant_id))<0) return denyTenant(me,"hr_rc_attach_sign",String(ac.tenant_id));
      }
      const ATTACHABLE=["Draft","Need More Info","Submitted","Pending Manager Approval","Pending HR Approval","Pending Finance Approval","Pending Director Approval"];
      if(ATTACHABLE.indexOf(String(ac.status))<0) return j({ ok:false, error:"This claim is "+ac.status+" — receipts can no longer be changed." }, 403);
      if(!who.isAdmin){ if(!who.employee || ac.employee_id!==who.employee.id) return j({ ok:false, error:"forbidden" }, 403); }
      const name=String(b.file_name||"receipt").replace(/[^A-Za-z0-9._-]/g,"_");
      const path="claim/"+claimId+"/"+Date.now()+"_"+name;
      const { data: su, error: se } = await sb.storage.from("hr-claim-receipts").createSignedUploadUrl(path);
      if(se || !su) return j({ ok:false, error:"could not start the upload ("+((se&&se.message)||"storage error")+")" });
      return j({ ok:true, path, token:su.token, url:(Deno.env.get("SUPABASE_URL")||"")+"/storage/v1/object/upload/sign/hr-claim-receipts/"+path+"?token="+encodeURIComponent(su.token) });
    }
    if (api === "hr_rc_attach") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      const claimId=b.claim_id; if(!claimId) return j({ ok:false, error:"claim_id required" });
      // v159: admins previously skipped EVERY check here — no claim-existence, no company pin — so a
      // scoped admin could attach a file to another company's claim. And nobody had a status gate, so a
      // claimant could add "receipts" to an already Approved/Paid claim, changing the evidence the
      // approval was granted on.
      {
        const { data: ac } = await sb.from("hr_claim_requests").select("tenant_id,status,employee_id").eq("id",claimId).maybeSingle();
        if(!ac) return j({ ok:false, error:"claim not found" });
        if(who.isAdmin && ac.tenant_id){
          const alwA=await allowedTenants(b.token);
          if(alwA.indexOf(String(ac.tenant_id))<0) return denyTenant(me,"hr_rc_attach",String(ac.tenant_id));
        }
        const ATTACHABLE=["Draft","Need More Info","Submitted","Pending Manager Approval","Pending HR Approval","Pending Finance Approval","Pending Director Approval"];
        if(ATTACHABLE.indexOf(String(ac.status))<0) return j({ ok:false, error:"This claim is "+ac.status+" — receipts can no longer be changed." }, 403);
      }
      if(!who.isAdmin){ const { data:oc } = await sb.from("hr_claim_requests").select("employee_id").eq("id",claimId).maybeSingle(); if(!oc || !who.employee || oc.employee_id!==who.employee.id) return j({ ok:false, error:"forbidden" }, 403); }
      const name=String(b.file_name||"receipt");
      // v186: the file may already be in storage, uploaded straight from the browser via a signed URL
      // (hr_rc_attach_sign). That path exists because base64-through-JSON could not carry a real scan: a
      // 41.8 MB PDF becomes ~56 MB of base64 inside the request body, which blows past the edge function
      // and past the client's own 30-second abort — the submit button simply did nothing.
      if(b.file_path){
        const p=String(b.file_path);
        // The path must be inside THIS claim's folder, or a caller could point the row at someone else's
        // receipt (or at a file they never uploaded) and satisfy the receipt-required gate with it.
        if(p.indexOf("claim/"+claimId+"/")!==0) return j({ ok:false, error:"bad file path" }, 400);
        // Verify it actually landed. A rowed-but-not-stored receipt would let a claim through the
        // "receipt required" gate with nothing on file — the same trap the base64 branch guards below.
        const dir=p.slice(0, p.lastIndexOf("/")); const base=p.slice(p.lastIndexOf("/")+1);
        const { data: ls } = await sb.storage.from("hr-claim-receipts").list(dir, { search: base, limit: 100 });
        const found = (ls||[]).some((o:any)=>o.name===base);
        if(!found) return j({ ok:false, error:"Upload did not complete — please try again." });
        await sb.from("hr_claim_attachments").insert({ claim_id:claimId, file_name:name, file_path:p, file_type:b.file_type||null, file_size:Number(b.file_size)||null, receipt_hash:b.receipt_hash||null, uploaded_by:(me.user&&me.user.id)||null });
        return j({ ok:true, stored:true });
      }
      const b64=String(b.file_b64||""); let path:any=null; let upErr:any=null;
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
      const b64 = String(b.file_b64||b.content_base64||"").split(",").pop() || "";
      if (!b64) return j({ ok:false, error:"no image provided" });
      const mime = String(b.file_type||b.content_type||"image/jpeg");
      const isPdf = mime.indexOf("pdf")>=0;
      const { data: types } = await sb.from("hr_claim_types").select("id,name").eq("active",true).order("sort_order");
      const typeNames = (types||[]).map((t:any)=>t.name);
      const sys = "You are reading an employee EXPENSE RECEIPT or a Malaysian MyInvois e-invoice for a Malaysian company. Reply ONLY with a single JSON object — no prose, no markdown fences. Schema: { vendor: string, date: 'YYYY-MM-DD'|null, total: number, tax: number, sst: number, currency: 'MYR'|'USD'|'SGD'|string, description: string, category_guess: string, invoice_no: string|null, is_einvoice: boolean, supplier_tin: string|null, einvoice_uuid: string|null, einvoice_validation_url: string|null, confidence: 'high'|'medium'|'low' }. 'total' = final amount paid (include tax & service charge). 'tax' = GST/other tax shown (0 if none). 'sst' = Malaysian SST/service tax shown (0 if none). 'description' = short, e.g. 'Lunch — Starbucks KLCC'. 'invoice_no' = the receipt or invoice/e-invoice document number. 'category_guess' MUST be exactly one of these claim types: "+JSON.stringify(typeNames)+". E-INVOICE DETECTION: a validated Malaysian MyInvois e-invoice shows a Supplier TIN (e.g. 'C1234567890' or 'IG...'), a Unique Identifier / UUID (long alphanumeric ~26+ chars) and usually a QR code linking to myinvois.hasil.gov.my — if you see these set is_einvoice=true and extract supplier_tin, einvoice_uuid and any printed validation URL; otherwise is_einvoice=false and those three are null. If a value can't be read use null (strings), 0 (numbers), false (booleans). MYR (Ringgit) is the most common currency; dates in Malaysia are usually DD/MM/YYYY — normalise to YYYY-MM-DD.";
      // v133: multi-provider fallback so OCR keeps working without Anthropic credits — employees
      // shouldn't have to type. Order: anthropic (best) → gemini (free tier) → openai. A provider
      // with no key or an error (e.g. credit balance too low) falls through to the next.
      const neutral:any[] = [ isPdf? { kind:"pdf", b64:b64 } : { kind:"image", mime:mime, b64:b64 }, { kind:"text", text:"Extract the receipt fields per the schema. JSON only." } ];
      const tries:string[]=[]; let txt=""; let used="";
      for (const prov of ["anthropic","gemini","openai"]){
        const res = await callVisionLLM(prov, resolveModel(prov,""), sys, neutral, 800);
        if (res.ok && res.text){ txt=res.text; used=prov+(res.model?(" / "+res.model):""); tries.push(prov+": ok"); break; }
        tries.push(prov+": "+String(res.error||"failed").slice(0,240));
      }
      if (!txt) return j({ ok:false, error:"Receipt OCR unavailable — "+tries.join(" · ")+". Add credits or set GEMINI_API_KEY (free tier) as a Supabase Edge secret." });
      let parsed:any=null; const m=txt.match(/\{[\s\S]*\}/); if(m){ try{ parsed=JSON.parse(m[0]); }catch(_e){} }
      if(!parsed) return j({ ok:false, error:"Couldn’t read that receipt — try a clearer, well-lit photo." });
      let typeId:any=null;
      if(parsed.category_guess){ const hit=(types||[]).find((t:any)=>String(t.name).toLowerCase()===String(parsed.category_guess).toLowerCase()); if(hit) typeId=hit.id; }
      await logAudit(me,"hr_rc_ocr",String(parsed.vendor||"(receipt)"),{ total:parsed.total, confidence:parsed.confidence, provider:used });
      return j({ ok:true, extracted: parsed, claim_type_id: typeId, provider: used });
    }
    if (api === "hr_rc_submit") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me); if(!who.isAdmin && !who.employee) return j({ ok:false, error:"no employee profile" });
      const id=b.id;
      const { data: claim } = await sb.from("hr_claim_requests").select("*").eq("id",id).maybeSingle();
      if(!claim) return j({ ok:false, error:"claim not found" });
      if(!who.isAdmin && claim.employee_id!==who.employee.id) return j({ ok:false, error:"forbidden" }, 403);
      // v159: the admin branch fetched the claim by id with NO company check (hr_rc_save / _cancel / _get
      // all pin it), and then built the approval chain from b.tenant — so a scoped admin of company A
      // could submit company B's draft and have B's claim routed through A's workflow. Always pin to the
      // claim's own company, and use THAT for workflow matching.
      if(who.isAdmin && claim.tenant_id){
        const alwS=await allowedTenants(b.token);
        if(alwS.indexOf(String(claim.tenant_id))<0) return denyTenant(me,"hr_rc_submit",String(claim.tenant_id));
      }
      const tenant = who.isAdmin ? (String(claim.tenant_id||"") || String(b.tenant||"")) : who.employee.tenant_id;
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
      // v153. No workflow matched. The old code silently fabricated a single "finance" step, which did
      // two bad things: it QUIETLY DOWNGRADED a configured multi-level policy to one approver, and it
      // pointed at a role that may have no holder — deadlocking the claim (see v152). A financial
      // control must never invent a weaker policy in silence. Pick a role somebody actually holds; if
      // nobody holds any, leave the step unassigned so an admin can still act. Always warn, loudly.
      if(!steps.length){
        const pick = await rcFallbackStep(tenant);
        steps=[{ step_order:1, name:pick.name, approver_role:pick.role, approver_type:"role" }];
        warnings.push("No approval workflow matched this claim, so a single-approver fallback was used ("
          + (pick.role ? ("role “"+pick.role+"”") : "any admin")
          + "). If this claim needs more than one approver, activate an approval workflow in Claim settings.");
      }
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
      const pin = await allowedTenants(b.token);   // pin for EVERYONE — a non-admin role approver is scoped to their own tenant, closing cross-company decide by id
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
      const pin = await allowedTenants(b.token);   // pin for EVERYONE — a non-admin role approver is scoped to their own tenant, closing cross-company decide by id
      let done=0; const results:any[]=[];
      for(const id of ids){ const r=await rcDecideOne(who, me, id, decision, comment, null, "", pin); if(r.ok){ done++; try{ await rcNotifyDecision(r); }catch(_e){} } results.push({ id, ok:r.ok, status:r.status, error:r.error }); }
      return j({ ok:true, done, total:ids.length, results });
    }
    if (api === "hr_rc_set_gl") {
      // Finance/admin change an expense line's GL account — reason REQUIRED, audited (spec §5/§9/§15).
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me); if(!superAdmin(me) && who.roles.indexOf("finance")<0) return j({ ok:false, error:"Only Finance or admin can change the GL account." }, 403);
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
      const who = await rcMe(me); if(!superAdmin(me) && who.roles.indexOf("finance")<0) return j({ ok:false, error:"Only Finance or admin can export accounting data." }, 403);
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
      // Tenant pin: a scoped hr_admin (or a role-approver whose role name collides across companies) must
      // not comment on another company's claim by id. Same guard hr_rc_get uses.
      { const { data:cc } = await sb.from("hr_claim_requests").select("tenant_id").eq("id",b.id).maybeSingle(); if(!cc) return j({ ok:false, error:"claim not found" }); const alw = await allowedTenants(b.token); if(alw.length && alw.indexOf(cc.tenant_id)<0) return j({ ok:false, error:"forbidden" }, 403); }
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
    // v193: adjust the amount on a claim that is no longer awaiting approval.
    // "Override amount" already existed, but only inside the approver's pending-decision panel and it
    // approves at the same time — so once a claim was Approved there was no way to correct a wrong figure
    // short of cancelling and re-submitting the whole thing.
    if (api === "hr_rc_adjust_amount") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me);
      // Admin-only on purpose: this changes what gets paid AFTER the approvers signed off on a figure.
      if (!who.isAdmin) return j({ ok:false, error:"Only an admin can adjust an approved amount." }, 403);
      const { data:c } = await sb.from("hr_claim_requests")
        .select("status,amount,tenant_id,claim_no,xero_bill_id").eq("id", b.id).maybeSingle();
      if(!c) return j({ ok:false, error:"not found" });
      { const alw = await allowedTenants(b.token);
        if (alw.length && c.tenant_id && alw.indexOf(c.tenant_id) < 0) return denyTenant(me,"hr_rc_adjust_amount",String(c.tenant_id)); }

      if (c.status === "Paid")      return j({ ok:false, error:"This claim is already paid — adjust it with a separate correction instead." });
      if (c.status === "Cancelled") return j({ ok:false, error:"This claim is cancelled." });
      // Once it is a bill in Xero, silently changing the amount here would leave the two disagreeing with
      // nothing to reconcile against. Make the operator deal with the bill first.
      if (c.xero_bill_id) return j({ ok:false, error:"This claim is already posted to Xero as a bill. Void or edit the bill in Xero first, then adjust here." });

      const amt = Number(b.amount);
      if (!isFinite(amt) || amt <= 0) return j({ ok:false, error:"Enter an amount greater than zero." });
      const reason = String(b.reason||"").trim();
      if (!reason) return j({ ok:false, error:"A reason is required — it is written to the claim's audit trail." });
      if (Math.round(amt*100) === Math.round(Number(c.amount||0)*100)) return j({ ok:false, error:"That is the same amount." });

      await sb.from("hr_claim_requests")
        .update({ amount: amt, override_amount: amt, override_reason: reason }).eq("id", b.id);
      await rcAuditLog(b.id, "adjust_amount", me, c.status, c.status, { from: c.amount, to: amt, reason });
      await logAudit(me, "hr_rc_adjust_amount", String(b.id), { claim_no: c.claim_no, from: c.amount, to: amt, reason });
      return j({ ok:true, from: c.amount, to: amt });
    }
    if (api === "hr_rc_mark_paid") {
      const me = await meFromToken(b.token); if (!me||!me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const who = await rcMe(me); if(!superAdmin(me) && who.roles.indexOf("finance")<0) return j({ ok:false, error:"Only Finance or admin can mark claims paid." }, 403);
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
      const who = await rcMe(me); if(!superAdmin(me) && who.roles.indexOf("finance")<0) return j({ ok:false, error:"Only Finance or admin can mark claims paid." }, 403);
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
      const who = await rcMe(me); if(!superAdmin(me) && who.roles.indexOf("finance")<0) return j({ ok:false, error:"Only Finance or admin can post claims to Xero." }, 403);
      const id=b.id;
      const { data: c } = await sb.from("hr_claim_requests").select("*, hr_employees(name,emp_no,tax_no,ic_no,address)").eq("id",id).maybeSingle();
      if(!c) return j({ ok:false, error:"claim not found" });
      { const alw = await allowedTenants(b.token); if (alw.length && alw.indexOf(c.tenant_id) < 0) return j({ ok:false, error:"forbidden: you do not have access to this company" }, 403); }
      if(["Approved","Paid"].indexOf(c.status)<0) return j({ ok:false, error:"Post to Xero only after the claim is fully Approved." });
      const tenant = c.tenant_id;
      const empName = (c.hr_employees&&c.hr_employees.name) || "Employee";
      // claimer = e-invoice buyer. No personal TIN (e.g. E004) → IRBM general public TIN, so the buyer stays valid.
      const empTin = String((c.hr_employees&&c.hr_employees.tax_no)||"").trim() || "EI00000000010";
      // Build one Xero line per expense line, each coded to its claim type's GL account.
      const { data: items } = await sb.from("hr_claim_items").select("*, hr_claim_types(name,gl_account,is_mileage)").eq("claim_id",id).order("item_date");
      const missing:string[]=[]; const lines:any[]=[];
      if(items && items.length){
        for(const it of items){
          const t:any=it.hr_claim_types||{}; const gl=String(it.gl_account||t.gl_account||"").trim(); // per-line Finance override wins over the type default
          if(!gl){ const nm=t.name||"(unnamed type)"; if(missing.indexOf(nm)<0) missing.push(nm); continue; }
          const km = t.is_mileage ? (" · "+(it.total_km||0)+"km × RM"+(it.mileage_rate||0)+((Number(it.parking_amount)||0)||(Number(it.toll_amount)||0)?(" + parking/toll"):"")) : "";
          // Carry the supplier's e-invoice identifiers into the Xero line so the finance team (and Xero's
          // MyInvois submission) has the source e-invoice on record.
          const einv = it.is_einvoice ? (" · e-Invoice"+(it.invoice_no?(" "+it.invoice_no):"")+(it.supplier_tin?(" · Supplier TIN "+it.supplier_tin):"")+(it.einvoice_uuid?(" · UUID "+it.einvoice_uuid):"")) : (it.invoice_no?(" · Inv "+it.invoice_no):"");
          lines.push({ Description:String((it.description||t.name||"Expense")+km+einv).slice(0,4000), Quantity:1, UnitAmount:Number(it.amount)||0, AccountCode:gl });
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
        // Contact = the claimer; stamp their HR OS TIN so the e-invoice buyer identity flows to Xero/MyInvois.
        const contact:any = { Name:String(empName).slice(0,500) }; if(empTin) contact.TaxNumber = empTin.slice(0,50);
        // v191: DueDate was missing entirely, so EVERY attempt failed with
        // "Xero 400: Due Date cannot be empty" — reimbursements had never once posted. Xero tolerates a
        // missing due date on a DRAFT but rejects it on SUBMITTED, and this posts as SUBMITTED by design
        // (payment stays a human click inside Xero). Every other ACCPAY builder in this file already
        // passes one; this was the only one that did not.
        // Same 30-day term the rest of the file uses, MYT-adjusted, and editable in Xero before payment.
        const dueDate = new Date(Date.now() + 30*86400000 + 8*3600*1000).toISOString().slice(0,10);
        const inv:any = { Type:"ACCPAY", Contact:contact,
          Reference: reference, Date: c.claim_date||undefined, DueDate: dueDate, Status:"SUBMITTED", LineAmountTypes:"NoTax", LineItems: lines };
        // v192: the key used to be just claim id + reference, so it NEVER changed between attempts. Xero
        // remembers a key for 24 hours and rejects it if the body differs — so the moment a post failed
        // and the payload was then corrected (exactly what the missing-DueDate fix did), every retry died
        // with "Idempotency Key ... is used with a different request" and the claim was stuck for a day.
        // Hashing the payload keeps the real protection — an identical retry still dedupes — while a
        // corrected payload is allowed through.
        const idemBody = JSON.stringify(inv);
        let h = 5381; for (let i=0;i<idemBody.length;i++) h = ((h*33) ^ idemBody.charCodeAt(i)) >>> 0;
        const idem = ("rc-"+id+"-"+h.toString(36)).slice(0,128);

        // Because the key no longer blocks a changed payload, guard the duplicate case directly: if a
        // previous attempt actually reached Xero and we lost the response, the bill already exists under
        // this Reference. Adopt it instead of creating a second one.
        try {
          const q = 'Type=="ACCPAY" AND Reference=="' + reference.replace(/"/g,'') + '" AND Status!="VOIDED"';
          const ex = await fetch("https://api.xero.com/api.xro/2.0/Invoices?where="+encodeURIComponent(q), { headers: xh });
          if (ex.ok) {
            const exj = await ex.json();
            const hit = (exj.Invoices||[])[0];
            if (hit && hit.InvoiceID) {
              await sb.from("hr_claim_requests").update({ xero_bill_id: hit.InvoiceID, xero_posted_at:new Date().toISOString(), xero_reference: reference }).eq("id", id);
              return j({ ok:true, adopted:true, bill_id:hit.InvoiceID, invoice_number:hit.InvoiceNumber||null,
                         note:"This claim was already in Xero under "+reference+" — linked to it instead of creating a duplicate." });
            }
          }
        } catch(_e){ /* best-effort: a lookup failure must not block posting */ }

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
        sb.from("hr_claim_requests").select("*, hr_employees(emp_no,name,dept,position,bank_name,bank_account,tax_no,ic_no,address,email,phone), hr_claim_types(name,code,is_mileage,requires_receipt)").eq("id",id).maybeSingle(),
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
      await attachActorNames(allSteps, "acted_by", "acted_by_name", true);   // who approved each step (+ their signature)
      await attachAssignees(allSteps, cl&&cl.tenant_id);               // who is EXPECTED to approve each step
      if(cl){ const alw = await allowedTenants(b.token); if (alw.length && alw.indexOf(cl.tenant_id) < 0) return j({ ok:false, error:"forbidden" }, 403); }
      if(!who.isAdmin){
        if(!who.employee) return j({ ok:false, error:"forbidden" }, 403);
        const isOwner = cl && cl.employee_id===who.employee.id;
        const isAppr = allSteps.some((s:any)=>s.approver_employee_id===who.employee.id||who.roles.indexOf(s.approver_role)>=0);
        if(!isOwner && !isAppr) return j({ ok:false, error:"forbidden" }, 403);
      }
      const curStep = allSteps.find((s:any)=>cl && s.step_order===cl.current_step);
      // Mirror the decide-time segregation-of-duties rule here so the Approve button hides instead of
      // erroring on click for someone who already acted on an earlier level (or owns the claim).
      const sodOut = (curStep&&curStep.instance_id) ? await sodViolation("hr_claim_approval_steps","instance_id",curStep.instance_id,curStep.id,(me.user&&me.user.id)||null,who.employee&&who.employee.id,cl&&cl.employee_id,"acted_by","acted_emp_id") : null;
      const detActed = allSteps.filter((s:any)=>s.acted_by && (!curStep || s.id!==curStep.id)).map((s:any)=>s.acted_by);
      const canAct = (await canActOrGap(who, curStep, cl&&cl.tenant_id, { requesterEmpId: cl&&cl.employee_id, actedUserIds: detActed })) && !sodOut && ["Submitted","Pending Manager Approval","Pending HR Approval","Pending Finance Approval","Pending Director Approval"].indexOf(cl&&cl.status)>=0;
      // Finance capability must match the server-side money gates (superAdmin OR finance role), NOT
      // who.isAdmin (which folds in hr_admin) — otherwise an hr_admin sees Pay / Post-to-Xero buttons
      // that then 403 on click. hr_admin = "full HR write, NO finance".
      const canFinance = superAdmin(me) || who.roles.indexOf("finance")>=0;
      const canPost = canFinance && ["Approved","Paid"].indexOf(cl&&cl.status)>=0;
      const attsOut:any[]=[];
      for(const a of (atts.data||[])){ let url:any=null; if(a.file_path){ try{ const s=await sb.storage.from("hr-claim-receipts").createSignedUrl(a.file_path,3600); url=s.data&&s.data.signedUrl; }catch(_e){} } attsOut.push({...a, url}); }
      const { data: rcEmployer } = cl ? await sb.from("hr_employer_info").select("*").eq("tenant_id",cl.tenant_id).maybeSingle() : { data:null } as any;
      // The claimant's own signature — goes above "Prepared by" on the form.
      const { data: rcSigner } = cl ? await sb.from("hr_employees").select("signature").eq("id",cl.employee_id).maybeSingle() : { data:null } as any;
      // e-Invoice BUYER = the claimer, pulled live from their HR OS employee record (single source of
      // truth — never duplicated onto the claim). Every reimbursement carries it automatically.
      const rcEmp:any = (cl && cl.hr_employees) || {};
      // IRBM general public TIN — used for a Malaysian individual buyer who has no personal TIN
      // (e.g. E004). So a missing TIN is NOT an error; the buyer is still valid on the e-invoice.
      const GENERAL_TIN = "EI00000000010";
      const buyer = { name:rcEmp.name||"", tin:rcEmp.tax_no||"", tin_effective:(rcEmp.tax_no||GENERAL_TIN), tin_general:!rcEmp.tax_no, ic:rcEmp.ic_no||"", address:rcEmp.address||"", email:rcEmp.email||"", phone:rcEmp.phone||"", complete: !!(rcEmp.name && rcEmp.ic_no) };
      return j({ ok:true, claim:cl, buyer, employer: rcEmployer||null, signer_sig:(rcSigner&&rcSigner.signature)||null, mileage:mileage.data, items:itemsR.data||[], attachments:attsOut, steps:allSteps, comments:comments.data||[], payment:payment.data, audit:audit.data||[], declaration:(decR.data&&decR.data[0])||null, can_act:canAct, can_post:canPost, can_finance:canFinance, is_admin:who.isAdmin });
    }
    if (api === "hr_rc_admin_save") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const kind=String(b.kind||""); const row=b.row||{};
      // v150 (F2): scope claim/approval config. GLOBAL tables (claim types, mileage, policy) drive every
      // company → full-scope admin only. PER-TENANT config (cost centre, role approver, workflow) must pin
      // the affected company to allowedTenants — a scoped admin could otherwise plant or delete another
      // company's approval config by tenant_id or by id.
      {
        const GLOBAL_KINDS = ["claim_type","claim_type_del","mileage_rate","mileage_rate_del","policy"];
        if (GLOBAL_KINDS.indexOf(kind) >= 0){
          if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized (group-wide claim config — full-scope admin only)" }, 403);
        } else {
          const alwR = await allowedTenants(b.token);
          let tgtTenant:any = row.tenant_id || null;
          if (!tgtTenant && row.id){
            const tbl = kind.indexOf("cost_center")===0 ? "hr_cost_centers" : kind.indexOf("role_approver")===0 ? "hr_claim_role_approvers" : "hr_approval_workflows";
            const { data: tr } = await sb.from(tbl).select("tenant_id").eq("id", row.id).maybeSingle();
            tgtTenant = tr ? tr.tenant_id : null;
          }
          if (tgtTenant && alwR.indexOf(String(tgtTenant)) < 0) return j({ ok:false, error:"forbidden: company outside your access" }, 403);
          if (!tgtTenant && !(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"forbidden: a group-wide (no-company) config needs a full-scope admin" }, 403);
        }
      }
            // v159: every branch below awaited its write and then fell through to return ok:true, so a failed
      // save (bad GL account on a claim type, a workflow step insert that violates a constraint, a
      // cost-centre code collision) was reported to the operator as "Saved" / "Assigned" / "Added" while
      // nothing changed. ck() surfaces the DB error instead of swallowing it.
      const ck = (r:any)=>{ if(r && r.error) throw new Error(r.error.message || String(r.error)); return r; };
      try {
if(kind==="claim_type"){ if(row.id){ ck(await sb.from("hr_claim_types").update({...row, updated_at:new Date().toISOString()}).eq("id",row.id));} else { ck(await sb.from("hr_claim_types").insert(row));} }
      else if(kind==="claim_type_del"){ ck(await sb.from("hr_claim_types").update({active:false}).eq("id",row.id)); }
      else if(kind==="mileage_rate"){ if(row.id){ ck(await sb.from("hr_mileage_rates").update(row).eq("id",row.id));} else { ck(await sb.from("hr_mileage_rates").insert(row));} }
      else if(kind==="mileage_rate_del"){ ck(await sb.from("hr_mileage_rates").update({active:false}).eq("id",row.id)); }
      else if(kind==="policy"){ if(row.id){ ck(await sb.from("hr_claim_policy_rules").update(row).eq("id",row.id));} else { ck(await sb.from("hr_claim_policy_rules").insert(row));} }
      else if(kind==="cost_center"){ if(row.id){ ck(await sb.from("hr_cost_centers").update({code:row.code,name:row.name,active:row.active!==false,sort_order:Number(row.sort_order)||0}).eq("id",row.id));} else { ck(await sb.from("hr_cost_centers").insert({tenant_id:row.tenant_id||null,code:row.code,name:row.name,active:true,sort_order:Number(row.sort_order)||0}));} }
      else if(kind==="cost_center_del"){ ck(await sb.from("hr_cost_centers").update({active:false}).eq("id",row.id)); }
      else if(kind==="role_approver"){ ck(await sb.from("hr_claim_role_approvers").insert({tenant_id:row.tenant_id||null, role:row.role, employee_id:row.employee_id})); }
      else if(kind==="role_approver_del"){ ck(await sb.from("hr_claim_role_approvers").delete().eq("id",row.id)); }
      else if(kind==="workflow"){
        let wid=row.id;
        const wfRow:any={ tenant_id:row.tenant_id||null, name:row.name, description:row.description||"", active:row.active!==false, priority:Number(row.priority)||0, min_amount:(row.min_amount===""||row.min_amount==null)?0:Number(row.min_amount), max_amount:(row.max_amount===""||row.max_amount==null)?null:Number(row.max_amount), match_department:row.match_department||null, match_claim_type_id:row.match_claim_type_id||null, match_role:row.match_role||null, match_project:row.match_project||null, updated_at:new Date().toISOString() };
        if(wid){ ck(await sb.from("hr_approval_workflows").update(wfRow).eq("id",wid));} else { const ins=ck(await sb.from("hr_approval_workflows").insert(wfRow).select("id").single()); wid=ins.data&&ins.data.id; }
        if(wid && Array.isArray(row.steps)){ ck(await sb.from("hr_approval_workflow_steps").delete().eq("workflow_id",wid)); ck(await sb.from("hr_approval_workflow_steps").insert(row.steps.map((s:any,i:number)=>({workflow_id:wid,step_order:i+1,name:s.name,approver_type:s.approver_type||"role",approver_role:s.approver_role,approver_employee_id:s.approver_employee_id||null})))); }
      }
      else if(kind==="workflow_del"){ ck(await sb.from("hr_approval_workflows").update({active:false}).eq("id",row.id)); }
      else return j({ ok:false, error:"unknown kind" });
      } catch(eAdm:any){ return j({ ok:false, error:"Could not save: "+String((eAdm&&eAdm.message)||eAdm) }); }
      await logAudit(me,"hr_rc_admin_save",String(kind),{ id:row.id||null, name:row.name||row.role||row.code||null });   // track approval/claim config changes
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
      // v150 (F2): the single hr_statutory_rates row drives EVERY company's payroll → full-scope admin only.
      const me = await meFromToken(b.token); if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized (group-wide statutory rates — full-scope admin only)" }, 403);
      const rates = b.rates||{};
      // Guard: reject an empty/partial payload so a stray {} can never wipe EPF/SOCSO/EIS config.
      // v150 (MED-4): validate the FULL shape hrCompute needs — the old guard only checked the three eeRates,
      // so a payload missing socso.ceiling / epf.threshold / erRates passed and leaked NaN into every payslip.
      const num = (x:any)=> typeof x==="number" && isFinite(x);
      const e=rates&&rates.epf, s=rates&&rates.socso, i=rates&&rates.eis;
      const okShape = rates && typeof rates==="object"
        && e && typeof e==="object" && num(e.eeRate) && num(e.erRateLow) && num(e.erRateHigh) && num(e.threshold)
        && s && typeof s==="object" && num(s.eeRate) && num(s.erRate) && num(s.ceiling)
        && i && typeof i==="object" && num(i.eeRate) && num(i.erRate) && num(i.ceiling);
      if (!okShape) return j({ ok:false, error:"Rates payload is incomplete — every EPF/SOCSO/EIS rate, threshold and ceiling must be a number. No changes made." });
      const { data: prev } = await sb.from("hr_statutory_rates").select("rates").eq("id",1).maybeSingle();
      const { error } = await sb.from("hr_statutory_rates").upsert({ id:1, rates }, { onConflict:"id" });
      if (error) return j({ ok:false, error:error.message });
      await logAudit(me,"hr_rates_save","1",{ from:(prev&&prev.rates)||null, to:rates });   // audit the full before/after
      return j({ ok:true });
    }
    if (api === "hr_employer_save") {
      // Per-company profile (name, SSM reg no, LHDN/EPF/SOCSO nos, address, contact, LOGO) — printed on
      // payslips, the reimbursement form, and year-end (EA/E/CP8D).
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = String(b.tenant||""); if(!tenant) return j({ ok:false, error:"no company selected" });
      { const alw=await allowedTenants(b.token); if(alw.length && alw.indexOf(tenant)<0) return denyTenant(me,"hr_employer_save",tenant); }
      const e = b.employer||{};
      const s=(v:any,max:number)=>{ const t=String(v==null?"":v).trim(); return t?t.slice(0,max):null; };
      // logo: keep as a data URI; cap size so the generated PDFs stay light. undefined = keep existing, null = clear.
      let logo:any = undefined;
      if (e.logo===null) logo=null;
      else if (typeof e.logo==="string" && e.logo.indexOf("data:image/")===0){ if(e.logo.length>400000) return j({ ok:false, error:"Logo image is too large — use one under ~250 KB." }); logo=e.logo; }
      const patch:any = { tenant_id:tenant, name:s(e.name,200), employer_no:s(e.employer_no,40), reg_no:s(e.reg_no,60), address:s(e.address,400), phone:s(e.phone,60), email:s(e.email,120), epf_employer_no:s(e.epf_employer_no,40), socso_employer_no:s(e.socso_employer_no,40), updated_at:new Date().toISOString() };
      if (logo!==undefined) patch.logo = logo;
      // doc_code prefixes this company's claim numbers (IPC-202607-0001). Absent = keep the current one:
      // an older client that doesn't send the field must not blank it and silently reset numbering.
      // doc_code prefixes this company's claim numbers. Only overwrite when a non-empty value is sent —
      // a blank field means "keep the existing code", so it never blocks saving the other details.
      if (e.doc_code!==undefined) {
        const dc = String(e.doc_code||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
        if (dc) patch.doc_code = dc;
      }
      const { data: existing } = await sb.from("hr_employer_info").select("id").eq("tenant_id",tenant).maybeSingle();
      const res:any = existing ? await sb.from("hr_employer_info").update(patch).eq("id",existing.id).select().single()
                               : await sb.from("hr_employer_info").insert(patch).select().single();
      if (res.error) {
        if (String(res.error.message||"").indexOf("hr_employer_info_doc_code_key")>=0)
          return j({ ok:false, error:"Company code \""+patch.doc_code+"\" is already used by another company — codes must be unique." });
        return j({ ok:false, error:res.error.message });
      }
      await logAudit(me,"hr_employer_save",tenant,{ name:patch.name, doc_code:patch.doc_code, logo_changed: logo!==undefined });
      return j({ ok:true, employer: res.data });
    }
    if (api === "hr_tp1_get" || api === "hr_tp1_save") {
      // v167: TP1 relief declarations. LHDN obliges the employer to apply what the employee declares to
      // MTD, and to keep the form on file — so this records what was declared, when it takes effect and
      // who accepted it.
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const empId = String(b.employee_id||""); if(!empId) return j({ ok:false, error:"employee required" });
      const yr = Number(b.year)||new Date(Date.now()+8*3600*1000).getUTCFullYear();
      // Pin the employee to a company this caller may see — the same lesson as hr_payroll_grid_save (v157).
      const { data: te } = await sb.from("hr_employees").select("tenant_id,name").eq("id",empId).maybeSingle();
      if(!te) return j({ ok:false, error:"employee not found" });
      { const alw=await allowedTenants(b.token); if(te.tenant_id && alw.length && alw.indexOf(String(te.tenant_id))<0) return denyTenant(me,api,String(te.tenant_id)); }

      if (api === "hr_tp1_get"){
        const { data, error } = await sb.from("hr_tp1_declarations")
          .select("*").eq("employee_id",empId).eq("year",yr).maybeSingle();
        if(error) return j({ ok:false, error:error.message });
        return j({ ok:true, declaration: data||null, employee:{ id:empId, name:te.name }, year:yr });
      }

      const TP1_CATEGORIES = ["lifestyle","medical","education","insurance_life","insurance_medical",
        "sspn","childcare","disabled_person","disabled_spouse","parent_medical","donation","other"];
      const rawItems = Array.isArray(b.items) ? b.items : [];
      const items:any[] = [];
      for (const it of rawItems.slice(0,40)){
        const cat = String((it&&it.category)||"other");
        const amt = Math.max(0, Number((it&&it.amount))||0);
        if (!amt) continue;                                  // a zero line is just noise
        if (TP1_CATEGORIES.indexOf(cat) < 0) return j({ ok:false, error:"unknown relief category: "+cat }, 400);
        if (amt > 1000000) return j({ ok:false, error:"relief amount looks wrong: "+amt }, 400);
        items.push({ category:cat, amount:amt, note:String((it&&it.note)||"").slice(0,120)||null });
      }
      const effMonth = Math.min(12, Math.max(1, Number(b.effective_month)||1));
      const { error: eUp } = await sb.from("hr_tp1_declarations").upsert({
        employee_id: empId, year: yr, items, effective_month: effMonth,
        note: String(b.note||"").slice(0,300)||null,
        recorded_by: (me.user&&me.user.id)||null, updated_at: new Date().toISOString(),
      }, { onConflict: "employee_id,year" });
      if (eUp) return j({ ok:false, error:eUp.message });
      const total = items.reduce((s:number,i:any)=>s+i.amount, 0);
      await logAudit(me,"hr_tp1_save",empId,{ year:yr, lines:items.length, total, effective_month:effMonth });
      return j({ ok:true, total, lines:items.length });
    }
    if (api === "hr_stat_ids_get" || api === "hr_stat_ids_save") {
      // v161: bulk entry for the statutory identifiers the KWSP / PERKESO / LHDN files require. Since v158
      // those exports BLOCK on a missing member number rather than padding 000000000000, and filling them in
      // one employee form at a time is exactly the friction that made the old silent-zeros behaviour tempting.
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = String(b.tenant||""); if(!tenant) return j({ ok:false, error:"no company selected" });
      { const alw=await allowedTenants(b.token); if(alw.length && alw.indexOf(tenant)<0) return denyTenant(me,api,tenant); }
      if (api === "hr_stat_ids_get") {
        const { data, error } = await sb.from("hr_employees")
          .select("id,emp_no,name,ic_no,epf_no,socso_no,tax_no")
          .eq("tenant_id",tenant).eq("status","active").order("emp_no");
        if(error) return j({ ok:false, error:error.message });
        return j({ ok:true, employees: data||[] });
      }
      const rows = Array.isArray(b.rows) ? b.rows : [];
      if(!rows.length) return j({ ok:false, error:"nothing to save" });
      // Pin every id to this company before writing — same lesson as hr_payroll_grid_save (v157).
      const { data: mine } = await sb.from("hr_employees").select("id").eq("tenant_id",tenant);
      const allow = new Set((mine||[]).map((e:any)=>String(e.id)));
      if (rows.some((r:any)=>!allow.has(String(r.id)))) return j({ ok:false, error:"employee outside this company" }, 403);
      const cl = (v:any)=>{ const t=String(v==null?"":v).trim().slice(0,30); return t||null; };
      let n=0;
      for (const r of rows){
        const patch:any = {};
        if(r.ic      !== undefined) patch.ic_no    = cl(r.ic);
        if(r.epfNo   !== undefined) patch.epf_no   = cl(r.epfNo);
        if(r.socsoNo !== undefined) patch.socso_no = cl(r.socsoNo);
        if(r.taxNo   !== undefined) patch.tax_no   = cl(r.taxNo);
        if(!Object.keys(patch).length) continue;
        const { error:eU } = await sb.from("hr_employees").update(patch).eq("id",String(r.id));
        if(eU) return j({ ok:false, error:(r.emp_no||"row")+": "+eU.message });
        n++;
      }
      await logAudit(me,"hr_stat_ids_save",tenant,{ n });
      return j({ ok:true, n });
    }
    if (api === "hr_payroll_grid_save") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const mo=Number(b.month), yr=Number(b.year); const items=Array.isArray(b.adjustments)?b.adjustments:[]; const tenant=String(b.tenant||"");
      if (!tenant) return j({ ok:false, error:"no company selected" });
      { const alw=await allowedTenants(b.token); if(alw.length && alw.indexOf(tenant)<0) return denyTenant(me,"hr_payroll_grid_save",tenant); }
      // v163: one transaction. The delete used to commit before the insert was attempted, so a failed
      // insert destroyed the whole company-month of bonuses / OT / deductions / unpaid leave — v159 made
      // that at least VISIBLE, but the data was gone either way. The RPC re-pins every employee_id to the
      // tenant itself, so the guarantee does not depend on the checks below still being here.
      {
        const { error: eRpc } = await sb.rpc("hr_payroll_adjustments_replace", {
          p_tenant: tenant, p_month: mo, p_year: yr, p_rows: items,
        });
        if (eRpc) return j({ ok:false, error: eRpc.message });
        // v181: record the DRAFT. hr_payroll_runs.status already defaulted to 'draft' but no row was ever
        // written until finalise, so a saved-but-not-finalised month left no trace at all and the grid
        // could not tell the operator whether what was on screen had been saved. Never touch `status`
        // here — a save against an already-finalised month must not silently un-finalise it.
        //
        // Best-effort and non-fatal: the adjustments are ALREADY committed by the RPC above. Failing the
        // request now would tell the operator the save failed when their figures are safely stored, and
        // they would re-enter everything. Metadata must never be able to do that.
        let savedAt: string|null = null;
        try {
          const nowIso = new Date().toISOString();
          const { data: existing } = await sb.from("hr_payroll_runs").select("id")
            .eq("tenant_id",tenant).eq("period_month",mo).eq("period_year",yr).maybeSingle();
          if (existing) await sb.from("hr_payroll_runs").update({ entries_saved_at:nowIso, updated_at:nowIso }).eq("id",existing.id);
          else await sb.from("hr_payroll_runs").insert({ tenant_id:tenant, period_month:mo, period_year:yr, status:"draft", entries_saved_at:nowIso });
          savedAt = nowIso;
        } catch (_e) { /* draft stamp is cosmetic; the entries are already saved */ }
        await logAudit(me,"hr_payroll_grid_save",String(mo)+"/"+String(yr),{ n:items.length });
        return j({ ok:true, n:items.length, entries_saved_at: savedAt });
      }
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
        // v196: lindung was dropped here, so the EA form and CP8D under-reported the employee's PERKESO
        // contribution for the whole year — and with it the RM350 SOCSO/EIS relief they can claim.
        const t = map[k] || (map[k] = { gross:0, epfEe:0, epfEr:0, socsoEe:0, socsoEr:0, eisEe:0, eisEr:0, lindung:0, pcb:0, net:0, months:0 });
        t.gross+=Number(s.gross); t.epfEe+=Number(s.epf_ee); t.epfEr+=Number(s.epf_er);
        t.socsoEe+=Number(s.socso_ee); t.socsoEr+=Number(s.socso_er); t.lindung+=Number(s.lindung24)||0;
        t.eisEe+=Number(s.eis_ee); t.eisEr+=Number(s.eis_er);
        t.pcb+=Number(s.pcb); t.net+=Number(s.net); t.months+=1;
      });
      return j({ ok:true, annual:map, employer:ei.data||{ name:"I PROCARE MALAYSIA SDN BHD", employer_no:"", address:"" } });
    }
    if (api === "hr_post_xero") {
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const runId = String(b.runId||""); if (!runId) return j({ ok:false, error:"missing runId" });
      const tenantId = String(b.tenantId||"99911869-9e91-4572-b7dc-4db51b45b6a9");
      // This action reads b.tenantId (camelCase), so the central guard — which only inspects b.tenant —
      // never fired. Pin it: a scoped HR admin must not drive a payroll post into a company they don't hold.
      { const alw = await allowedTenants(b.token); if (alw.indexOf(tenantId) < 0) return denyTenant(me, "hr_post_xero", tenantId); }
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
  return undefined;
}
