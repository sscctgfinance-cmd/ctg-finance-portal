// Finance OS + platform — everything that is not HR OS.
//
// Split out of the single-file index.ts unchanged: cron, login/session/2FA, users & roles, CTG SSO
// access, o2o, Xero sync/diagnostics, AP inbox, WHT, SBI, P&L, close, collections, company documents.
// The chain below is the SAME first-match if-chain, in the SAME order, with the SAME bodies — index.ts
// calls it at the point it used to appear. The ctg_access_* group keeps its outer guard intact.

import {
  sb, j, SKINDAE_TENANT, O2O_REVENUE_CODE, CLOSE_TEMPLATE, genTotpSecret,
  totpVerify, otpAuthUrl, xeroOrgName, xeroAccessToken, meFromToken, isAdmin,
  superAdmin, hrManage, logAudit, allowedTenants, isFullScopeAdmin, userWriteAllowed,
  tenantsAssignable, denyTenant, tenantPinned, xeroGet, xeroInvoicesAll,
  xeroInvoicesWhere, resolveContact, getWebhookKey, recordVendorCodingHistory, sha256Hex, sha256HexBytes,
  parsePnl, refreshPnlCache, invToCacheRow, processPendingDedup, syncStateUpdate, docaiAccessToken,
  callDocAI, processApEmail, logDecision, buildSelfBilledInvoicePdf, runBackfill, runDelta,
  processPending, sendAlertEmail, runDriftCheck,
} from "./lib.ts";

import {
  rcMoney,
} from "./hr.ts";


/** Finance/platform handler chain. Returns undefined when no branch matched, exactly as falling
 *  off the end of this section of the original if-chain did. */
export async function financeRoutes(b: any, api: string, ip: any, req: Request): Promise<Response | undefined> {
    if (api === "cron_sync") {
      const { data: sec } = await sb.from("portal_secrets").select("value").eq("key","cron").single();
      if (!sec || !sec.value || b.cron_secret !== sec.value) return j({ ok:false, error:"forbidden" }, 403);
      const work = (async ()=>{ try { const access = await xeroAccessToken(); const { data: tenants } = await sb.from("xero_tenants").select("tenant_id,tenant_name");
        // v129: keep display names tracking the live Xero Organisation Name (renames propagate overnight)
        try { for (const t of (tenants||[])) { const on = await xeroOrgName(access, t.tenant_id); if (on && on !== t.tenant_name) await sb.from("xero_tenants").update({ tenant_name: on }).eq("tenant_id", t.tenant_id); } } catch(_e){}
        const bf = await runBackfill(access, tenants||[]); const pr = await processPending(500); // v28: auto drift-repair after nightly backfill; up to 50 extras/tenant per run
        // v136: refresh the REAL P&L cache (18 calendar months → covers This/Last month, quarter, YTD, Last year).
        try { await refreshPnlCache(access, tenants||[], 18); await sb.rpc("refresh_overview_cache"); } catch(_e){}
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
    if (api === "hr_leave_compliance") {
      // v174: Employment Act 1955 s.60E / s.60F set FLOORS on annual and sick leave that rise with
      // continuous service. HR OS granted a flat 14/14, which silently under-grants everyone past two
      // years. This lists who is currently short, and can top them up.
      const me = await meFromToken(b.token); if (!hrManage(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = String(b.tenant||""); if(!tenant) return j({ ok:false, error:"no company selected" });
      { const alw=await allowedTenants(b.token); if(alw.length && alw.indexOf(tenant)<0) return denyTenant(me,api,tenant); }
      const yr = Number(b.year) || new Date(Date.now()+8*3600*1000).getUTCFullYear();

      const { data: emps } = await sb.from("hr_employees")
        .select("id,emp_no,name,join_date").eq("tenant_id",tenant).eq("status","active").order("emp_no");
      const { data: types } = await sb.from("hr_leave_types").select("id,code").in("code",["AL","ML"]);
      const typeBy:any = {}; for(const t of (types||[])) typeBy[t.code] = t.id;
      const empIds = (emps||[]).map((e:any)=>e.id);
      const { data: bals } = empIds.length
        ? await sb.from("hr_leave_balances").select("employee_id,leave_type_id,entitled").eq("year",yr).in("employee_id",empIds)
        : { data: [] as any[] };
      const balBy:any = {}; for(const x of (bals||[])) balBy[String(x.employee_id)+"|"+String(x.leave_type_id)] = Number(x.entitled)||0;

      const REF = yr + "-12-31";                 // entitlement is judged on service within the leave year
      const short:any[] = [], noJoin:any[] = [];
      for(const e of (emps||[])){
        if(!e.join_date){ noJoin.push({ emp_no:e.emp_no, name:e.name }); continue; }
        const { data: minRows } = await sb.rpc("hr_statutory_leave_min", { p_join_date: e.join_date, p_ref: REF });
        const m = Array.isArray(minRows) ? minRows[0] : minRows;
        if(!m) continue;
        const alHave = balBy[String(e.id)+"|"+String(typeBy.AL)];
        const slHave = balBy[String(e.id)+"|"+String(typeBy.ML)];
        const row:any = { employee_id:e.id, emp_no:e.emp_no, name:e.name, years:m.years };
        let bad = false;
        if(alHave === undefined || alHave < m.annual_min){ row.annual = { required:m.annual_min, granted: alHave===undefined?null:alHave }; bad = true; }
        if(slHave === undefined || slHave < m.sick_min){   row.sick   = { required:m.sick_min,   granted: slHave===undefined?null:slHave };   bad = true; }
        if(bad) short.push(row);
      }

      if (b.fix === true) {
        // Top up to the statutory floor only — never reduce anyone who has been granted more.
        if(!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"topping up leave entitlements needs a full-scope admin" }, 403);
        // n counts what was WRITTEN, not what was attempted. It used to increment either way, so a
        // failed write was reported to the operator — and recorded in the audit log — as an entitlement
        // that had been topped up to the statutory floor when it had not. Failures are collected and
        // returned rather than thrown: a partial repair is worth keeping, and the operator needs to see
        // which employees still need one.
        let n = 0; const failed: string[] = [];
        for(const r of short){
          for(const [code, want] of [["AL", r.annual && r.annual.required], ["ML", r.sick && r.sick.required]] as any[]){
            if(!want) continue;
            const tid = typeBy[code]; if(!tid) continue;
            const { data: ex } = await sb.from("hr_leave_balances")
              .select("id,entitled").eq("employee_id",r.employee_id).eq("leave_type_id",tid).eq("year",yr).maybeSingle();
            if(ex){
              if(Number(ex.entitled) < want){
                const { error } = await sb.from("hr_leave_balances").update({ entitled: want }).eq("id",ex.id);
                if(error) failed.push(String(r.employee_id)+"/"+code+": "+error.message); else n++;
              }
            } else {
              const { error } = await sb.from("hr_leave_balances").insert({ employee_id:r.employee_id, leave_type_id:tid, year:yr, entitled:want, taken:0 });
              if(error) failed.push(String(r.employee_id)+"/"+code+": "+error.message); else n++;
            }
          }
        }
        await logAudit(me,"hr_leave_compliance_fix",tenant,{ year:yr, adjusted:n, employees:short.length, failed:failed.length });
        return j({ ok:true, fixed:n, employees:short.length, year:yr, failed: failed.length, failures: failed.slice(0,20) });
      }

      return j({ ok:true, year:yr, checked:(emps||[]).length, short, no_join_date:noJoin,
        basis:"Employment Act 1955 s.60E (annual 8/12/16) and s.60F (sick 14/18/22) by completed years of continuous service" });
    }
    // v224 — `push_pending` and `approval_reminders` RETIRED with Web Push.
    //
    // `push_pending` existed only because a payloadless push cannot carry text, so sw.js called back to
    // ask what to display. Nothing sends a push now, so nothing ever calls it. `approval_reminders` was
    // the daily approver nudge; the approval EMAIL that always accompanied it (rcNotifyStepApprover /
    // rcNotifyLeaveApprover, hr.ts:361/380) is untouched, which is what made retiring the push
    // acceptable. Unscheduling the pg_cron job that called `approval_reminders` is a captain action.
    // ── O2O pharmacy → Xero contact, PER ORGANISATION (v179) ────────────────────────────────────
    // Each Xero org keeps its own contact list with its own ContactIDs, and all five companies issue
    // O2O invoices — so the link is keyed by (pharmacy, tenant). Verified against the live data: the
    // same six pharmacies resolve 6/6 exact in Skindae and Zeero but only 1/6 in Scale Holding, which
    // a single xero_contact_id column could never have represented.
    if (api === "o2o_contacts_resolve") {
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = String(b.tenant || "");
      if (!tenant) return j({ ok:false, error:"tenant required" });
      const alw = await allowedTenants(b.token);
      if (alw.indexOf(tenant) < 0) return denyTenant(me, "o2o_contacts_resolve", tenant);
      const names = Array.isArray(b.names) ? b.names.map((x:any)=>String(x||"")).filter(Boolean).slice(0, 500) : [];
      if (!names.length) return j({ ok:true, rows: [] });
      const { data, error } = await sb.rpc("o2o_resolve_contacts", { p_tenant: tenant, p_names: names });
      if (error) return j({ ok:false, error: error.message });
      return j({ ok:true, rows: data || [] });
    }
    if (api === "o2o_contact_link") {
      const me = await meFromToken(b.token); if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = String(b.tenant || "");
      if (!tenant) return j({ ok:false, error:"tenant required" });
      const alw = await allowedTenants(b.token);
      if (alw.indexOf(tenant) < 0) return denyTenant(me, "o2o_contact_link", tenant);
      const { data, error } = await sb.rpc("o2o_link_contact", {
        p_tenant: tenant, p_name: String(b.pharmacy||""), p_contact_id: String(b.contact_id||""),
        p_contact_name: String(b.contact_name||""), p_source: String(b.source||"manual"),
        p_by: (me.user && me.user.email) || null,
      });
      if (error) return j({ ok:false, error: error.message });
      return j(data || { ok:false, error:"no result" });
    }
    if (api === "o2o_contacts_search") {
      // Type-ahead for the manual picker. Scoped to ONE organisation — offering another org's
      // contacts would invite storing a ContactID that cannot work.
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const tenant = String(b.tenant || "");
      if (!tenant) return j({ ok:false, error:"tenant required" });
      const alw = await allowedTenants(b.token);
      if (alw.indexOf(tenant) < 0) return denyTenant(me, "o2o_contacts_search", tenant);
      const q = String(b.q || "").trim();
      let qy = sb.from("xero_contacts_cache").select("contact_id,name").eq("tenant_id", tenant);
      if (q) qy = qy.ilike("name", "%" + q + "%");
      const { data, error } = await qy.order("name").limit(40);
      if (error) return j({ ok:false, error: error.message });
      return j({ ok:true, contacts: data || [] });
    }
    // ── CTG Portal SSO: admin access management (v178) ──────────────────────────────────────────
    // The CTG app secret is a directory-wide read credential — it lists all 100 staff. It must NEVER
    // reach a browser, so every call to CTG goes through here and the frontend only ever sees the
    // resulting rows.
    if (api === "ctg_access_list" || api === "ctg_access_grant" || api === "ctg_access_revoke") {
      const me = await meFromToken(b.token);
      if (!isAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const actor = (me.user && me.user.email) || null;

      const { data: secRow } = await sb.from("portal_secrets").select("value").eq("key","ctg_auth_app_secret").maybeSingle();
      const ctgSecret = secRow && typeof secRow.value === "string" ? secRow.value.trim() : "";
      if (!ctgSecret) return j({ ok:false, error:"CTG app secret is not configured yet." });

      const CTG = "https://api.ctg-portal.com";
      async function ctgDirectory(): Promise<any[]> {
        const r = await fetch(`${CTG}/api/sso/users`, { headers: { Authorization: `Bearer ${ctgSecret}` } });
        if (!r.ok) throw new Error(`CTG directory returned ${r.status}`);
        const d = await r.json();
        return Array.isArray(d && d.users) ? d.users : [];
      }

      if (api === "ctg_access_list") {
        let dir: any[];
        try { dir = await ctgDirectory(); }
        catch (e:any) { return j({ ok:false, error: String(e && e.message || e) }); }

        const { data: pus } = await sb.from("portal_users")
          .select("id,email,name,role,active,ctg_sub,auth_source,last_login_at");
        const bySub = new Map<string,any>(), byEmail = new Map<string,any>();
        for (const u of (pus||[])) {
          if (u.ctg_sub) bySub.set(String(u.ctg_sub), u);
          if (u.email)   byEmail.set(String(u.email).toLowerCase(), u);
        }
        const rows = dir.map((u:any)=>{
          const email = String(u.email||"").toLowerCase();
          // sub first: an email can be changed or reassigned, the subject id cannot.
          const linked = bySub.get(String(u.sub)) || byEmail.get(email) || null;
          return {
            sub: String(u.sub), email, name: u.display_name || "", employee_code: u.employee_code || null,
            ctg_active: u.is_active !== false,
            linked: !!linked,
            linked_by: linked ? (bySub.has(String(u.sub)) ? "sub" : "email") : null,
            portal_user_id: linked ? linked.id : null,
            role: linked ? linked.role : null,
            portal_active: linked ? linked.active !== false : null,
            auth_source: linked ? linked.auth_source : null,
            last_login_at: linked ? linked.last_login_at : null,
          };
        }).sort((a:any,b:any)=> (a.name||a.email).localeCompare(b.name||b.email));

        // Portal accounts with no CTG counterpart — they can only ever sign in with a password, so they
        // are exactly the accounts that will be stranded if SSO ever becomes the only door.
        const ctgEmails = new Set(rows.map((r:any)=>r.email));
        const orphans = (pus||[]).filter((u:any)=> u.active !== false && !ctgEmails.has(String(u.email||"").toLowerCase()))
          .map((u:any)=>({ id:u.id, email:u.email, name:u.name, role:u.role, auth_source:u.auth_source }));

        return j({ ok:true, rows, orphans, counts:{
          ctg_total: rows.length,
          ctg_active: rows.filter((r:any)=>r.ctg_active).length,
          linked: rows.filter((r:any)=>r.linked).length,
          portal_orphans: orphans.length,
        }});
      }

      if (api === "ctg_access_grant") {
        const sub  = String(b.sub||"").trim();
        const role = String(b.role||"viewer").trim();
        if (!sub) return j({ ok:false, error:"sub is required" });

        const { data: roleRow } = await sb.from("portal_roles").select("name").eq("name", role).maybeSingle();
        if (!roleRow) return j({ ok:false, error:"unknown role: "+role });

        // Always re-read the directory rather than trusting the email/name the browser sent — otherwise a
        // crafted request could attach any address it liked to a real CTG subject id.
        let dir: any[];
        try { dir = await ctgDirectory(); }
        catch (e:any) { return j({ ok:false, error: String(e && e.message || e) }); }
        const person = dir.find((u:any)=> String(u.sub) === sub);
        if (!person) return j({ ok:false, error:"no such CTG user" });
        if (person.is_active === false) return j({ ok:false, error:"that CTG account is inactive" });
        const email = String(person.email||"").toLowerCase();
        const name  = person.display_name || email;

        const { data: existing } = await sb.from("portal_users")
          .select("id,email,role,active,ctg_sub,auth_source").or(`ctg_sub.eq.${sub},email.ilike.${email}`).maybeSingle();

        let userId: string, action: string;
        if (existing) {
          // Existing portal account: link it and widen how it can sign in. Its password keeps working —
          // the spec's "keep both for the time being".
          const { error } = await sb.from("portal_users").update({
            ctg_sub: sub, ctg_employee_code: person.employee_code || null,
            role, active: true,
            auth_source: existing.auth_source === "ctg_sso" ? "ctg_sso" : "both",
          }).eq("id", existing.id);
          if (error) return j({ ok:false, error:error.message });
          userId = existing.id; action = existing.ctg_sub ? "role_change" : "relink";
        } else {
          // New SSO-only account. pass_hash is NOT NULL, so it gets a random bcrypt nobody can produce —
          // see portal_unusable_password(). This account can only ever be entered through CTG.
          const { data: ph } = await sb.rpc("portal_unusable_password");
          const { data: ins, error } = await sb.from("portal_users").insert({
            email, name, role, active: true, pass_hash: ph,
            ctg_sub: sub, ctg_employee_code: person.employee_code || null, auth_source: "ctg_sso",
          }).select("id").single();
          if (error) return j({ ok:false, error:error.message });
          userId = ins.id; action = "grant";
        }

        await sb.from("portal_ctg_access_log").insert({
          actor_email: actor, action, ctg_sub: sub, ctg_email: email,
          portal_user_id: userId, ip, detail: { role, employee_code: person.employee_code || null },
        });
        return j({ ok:true, portal_user_id:userId, email, role, action });
      }

      // ctg_access_revoke
      const sub = String(b.sub||"").trim();
      if (!sub) return j({ ok:false, error:"sub is required" });
      const { data: target } = await sb.from("portal_users")
        .select("id,email,role,auth_source").eq("ctg_sub", sub).maybeSingle();
      if (!target) return j({ ok:false, error:"that CTG user is not linked to a portal account" });

      // Lockout guards. Revoking yourself, or the last admin, would leave nobody able to undo it — and
      // the only way back would be direct SQL.
      if (actor && String(target.email).toLowerCase() === String(actor).toLowerCase())
        return j({ ok:false, error:"You cannot revoke your own access." });
      if (target.role === "admin") {
        const { count } = await sb.from("portal_users").select("id", { count:"exact", head:true })
          .eq("role","admin").eq("active", true);
        if ((count||0) <= 1) return j({ ok:false, error:"That is the last active admin — grant another admin first." });
      }

      // An SSO-only account has no usable password, so unlinking it alone would strand it: still active,
      // no way in. Deactivate those; accounts that also have a password just lose the SSO link.
      const ssoOnly = target.auth_source === "ctg_sso";
      const { error: uerr } = await sb.from("portal_users").update({
        ctg_sub: null,
        active: ssoOnly ? false : true,
        auth_source: ssoOnly ? "ctg_sso" : "password",
      }).eq("id", target.id);
      if (uerr) return j({ ok:false, error:uerr.message });

      // Kill live sessions immediately — otherwise a revoked person keeps working until their token ages
      // out. That sentence is the reason this delete is now CHECKED: unread, a failure here left the
      // revoked person working while the caller was told the revoke had succeeded, and nothing anywhere
      // recorded it. The link removal above already succeeded, so this does not fail the request — it
      // reports, and it writes the failure into the access log, which is where a question about who
      // still had access gets answered later.
      const { error: serr } = await sb.from("portal_sessions").delete().eq("user_id", target.id);

      await sb.from("portal_ctg_access_log").insert({
        actor_email: actor, action:"revoke", ctg_sub: sub, ctg_email: target.email,
        portal_user_id: target.id, ip, detail: { deactivated: ssoOnly, sessions_killed: !serr, session_error: serr ? String(serr.message).slice(0,200) : null },
      });
      return j({ ok:true, deactivated: ssoOnly, email: target.email, sessions_killed: !serr,
        warning: serr ? "Access was removed, but live sessions could not be ended — that person may keep working until their token expires. Revoke again." : undefined });
    }
    if (api === "cron_health") {
      // v169: nothing watched the scheduled jobs. poll-gmail returned 500 every 5 minutes for four weeks
      // (dead Gmail refresh token) while the AP inbox received nothing, and three of the bookkeeping crons
      // have been failing on EVERY run against columns that no longer exist. All of it silent. This is the
      // alarm: one email when something breaks, one when it recovers, and nothing in between.
      const win = Math.max(15, Math.min(1440, Number(b.window_min) || 60));
      const { data: h, error: eH } = await sb.rpc("portal_cron_health", { p_window_min: win });
      if (eH) return j({ ok:false, error:eH.message });

      const jobs = (h && h.jobs) || [];
      const httpErr = (h && h.http_errors) || { count: 0, samples: [] };
      const fresh = (h && h.freshness) || {};
      const problems: string[] = [];

      for (const jb of jobs) problems.push(
        `cron "${jb.jobname}": ${jb.failures}/${jb.runs} runs failed — ${String(jb.last_message||"").split("\n")[0]}`);
      if (Number(httpErr.count) > 0) problems.push(
        `${httpErr.count} failed HTTP call(s) from scheduled jobs. Most common:\n` +
        (httpErr.samples||[]).map((s:any)=>`      x${s.n}  ${s.msg}`).join("\n"));
      // v175: an integration that stops on a dead credential now returns 200 "paused" instead of hammering
      // a 500 every five minutes — correct, but it would drop off an error-counting alarm entirely. Report
      // it explicitly so the quieter behaviour never turns into an unnoticed one.
      const paused = (h && h.paused) || [];
      // The timestamp is when the pause was DETECTED, not when the outage began — the pipeline-age line
      // below carries the real duration. Saying "stopped for 0 days" about a month-old outage was worse
      // than saying nothing.
      for (const p of paused) problems.push(
        `PAUSED — ${p.integration} is stopped awaiting re-authorisation (detected ${p.detected_at}).\n      ${p.reason}`);
      // Outcome checks — these are what would have caught the dead Gmail token on day one.
      // v175b: the two AP intake paths fail INDEPENDENTLY and must never be blamed on each other.
      // `documents` comes from poll-gmail (the paused OAuth token); `portal_ap_inbox` comes from the Apps
      // Script bridge, which runs on its own Google account and its own trigger.
      const docDays = Number(fresh.documents_age_days);
      if (isFinite(docDays) && docDays >= 3) problems.push(
        `Gmail → Drive intake has produced no document for ${docDays} day(s) (${fresh.documents_rows} row(s) all-time).` +
        (paused.length ? ` Cause: ${paused[0].integration} is paused (above).` : ""));
      const apDays = Number(fresh.ap_inbox_age_days);
      if (isFinite(apDays) && apDays >= 3) problems.push(
        `AP inbox has received nothing for ${apDays} day(s) (${fresh.ap_inbox_rows} row(s) all-time). This is the ` +
        `Apps Script ap_inbound bridge — a SEPARATE path from the Gmail/Drive intake above, with its own ` +
        `Google account and trigger. Check the Apps Script project's time-driven trigger is still installed and authorised.`);
      // v175c: this used to read xero_cache_age_min — when invoice DATA last changed. On any quiet night
      // that crossed 3 hours and reported a perfectly healthy system as broken, every night. Measure
      // whether the delta sync RAN instead; it is scheduled every 5 minutes, so 45 means it has missed ~9.
      const deltaMin = Number(fresh.xero_delta_age_min);
      if (isFinite(deltaMin) && deltaMin >= 45) problems.push(
        `Xero delta sync has not run for ${deltaMin} minute(s) (it is scheduled every 5).`);
      if (fresh.xero_sync_error) problems.push(
        `Xero sync recorded an error: ${fresh.xero_sync_error}`);

      const summary = problems.join("\n\n");
      const { data: st } = await sb.from("portal_cron_alerts").select("*").eq("id",1).maybeSingle();
      const prevState   = (st && st.state) || "ok";
      const prevSummary = (st && st.last_summary) || "";
      const streak = problems.length ? ((st && st.fail_streak) || 0) + 1 : 0;
      // "alerting" must mean "we have SENT mail about this", not merely "a problem exists". The first cut
      // set the state on the very first bad check, so by the time the streak reached 2 the de-dupe saw
      // itself as already alerting and suppressed the opening alert — the alarm could never fire once.
      // Caught by running it three times instead of trusting it.
      const alreadyAlerted = prevState === "alerting" && summary === prevSummary;
      const shouldAlert = problems.length > 0 && streak >= 2 && !alreadyAlerted;   // 2 checks = no blips
      const recovered   = problems.length === 0 && prevState === "alerting";

      // v177: THE ALARM WAS MANUFACTURING ITS OWN ALERTS. sendAlertEmail opens an SMTP connection to
      // Gmail, which routinely took longer than pg_net's 5 s default timeout — so every run that emailed
      // was recorded in net._http_response as a timed-out call, which the NEXT run then dutifully
      // reported as "N failed HTTP call(s) from scheduled jobs". And because that count is part of the
      // de-dupe key, a changing count looked like a changed problem set and sent ANOTHER email. A
      // self-sustaining loop, at :07 and :37, for as long as anything was wrong.
      //
      // The send and the state write move into the background so the handler returns in milliseconds.
      // Ordering inside `work` is unchanged, so the v170 invariant still holds: `alerting` is only ever
      // written after the mail has actually been sent.
      const work = (async () => {
        let mailed:any = null;
        if (shouldAlert) {
          mailed = await sendAlertEmail(
            "CTG portal — " + problems.length + " scheduled-job problem(s)",
            "The scheduled-job health check found the following in the last " + win + " minutes:\n\n" +
            summary + "\n\n--\nYou will not get another email about the same problems until they change or clear.");
        } else if (recovered) {
          mailed = await sendAlertEmail("CTG portal — scheduled jobs recovered",
            "All scheduled jobs and freshness checks are clean again over the last " + win + " minutes.");
        }
        await sb.from("portal_cron_alerts").upsert({
          id: 1,
          // Only an actual send flips the state, and last_summary records WHAT WAS ALERTED — so a changed
          // problem set produces a fresh alert while an unchanged one stays silent.
          state: shouldAlert ? "alerting" : (recovered ? "ok" : prevState),
          fail_streak: streak,
          last_summary: shouldAlert ? summary : (recovered ? null : (prevSummary || null)),
          last_alerted_at: (shouldAlert || recovered) ? new Date().toISOString() : (st && st.last_alerted_at) || null,
          updated_at: new Date().toISOString(),
        });
        return mailed;
      })();
      // Without waitUntil (local runs, manual probes) keep the old blocking behaviour so the caller
      // still sees the outcome.
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work);
      else await work;
      return j({ ok:true, problems: problems.length, streak, will_email: !!(shouldAlert||recovered), health: h });
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
          // H8: events at >=12 attempts are ABANDONED — processPendingDedup only retries `attempts<12`,
          // so these never self-heal and need a manual resync. Flag them distinctly from transient failures.
          try {
            const { count: dead } = await sb.from("xero_webhook_events").select("id",{count:"exact",head:true}).eq("processed",false).gte("attempts",12);
            if ((dead||0) > 0) problems.push((dead||0) + " webhook event(s) PERMANENTLY STUCK (>=12 attempts, no longer retried) — run a manual resync for the affected tenant");
          } catch(_e){}
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
          // H5: alerting must not fail SILENTLY. If we found problems but the email didn't send (creds
          // unset / SMTP down), record a distinct action so it's greppable and the Sync Health surface
          // can show "alerting is DOWN" — otherwise a real regression + a broken alert channel = 15 more
          // silent days, the exact failure this watchdog exists to prevent.
          const alertUndelivered = problems.length > 0 && (emailed === null ? false : !(emailed && emailed.ok));
          const auditAction = problems.length ? (alertUndelivered ? "cron_watchdog_alert_undelivered" : "cron_watchdog_alert") : "cron_watchdog_ok";
          await sb.from("portal_audit").insert({ action: auditAction, ref:"every30min", detail:{ problems, emailed, alert_channel: alertUndelivered ? "DOWN" : "ok" } });
          try { await sb.rpc("portal_cron_heartbeat", { p_name:"cron_watchdog", p_status: alertUndelivered ? "alert_channel_down" : "ok", p_detail:{ problems: problems.length, alert_undelivered: alertUndelivered } }); } catch(_e){}
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
        // v136: keep this-month/last-month P&L fresh so dashboard revenue/expenses/net track intraday.
        // Throttled: only when the P&L cache is >30 min old, so the 5-min delta doesn't hammer Xero reports.
        try { const { data: pf } = await sb.from("xero_pnl_cache").select("refreshed_at").order("refreshed_at",{ascending:false}).limit(1);
          const lastPnl = (pf && pf[0]) ? new Date(pf[0].refreshed_at).getTime() : 0;
          if (Date.now() - lastPnl > 30*60*1000) { await refreshPnlCache(access, tenants||[], 2); await sb.rpc("refresh_overview_pnl"); } } catch(_e){}
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
    if (api === "overview_range") {
      const from = String(b.from||""), to = String(b.to||"");
      if(!from||!to) return j({ ok:false, error:"date range required" });
      const { data, error } = await sb.rpc("portal_overview_range", { p_token: b.token||"", p_from: from, p_to: to });
      if (error) return j({ ok:false, error: error.message });
      // The cache holds whole calendar months → exact for month-aligned presets (This/Last month, quarter,
      // YTD). For a custom PARTIAL range, or one extending before the cache window, fetch the exact range
      // live from Xero's ProfitAndLoss so the numbers are always right.
      const myToday = new Date(Date.now()+8*3600*1000).toISOString().slice(0,10);
      const toD = new Date(to+"T00:00:00Z");
      const lastDay = new Date(Date.UTC(toD.getUTCFullYear(), toD.getUTCMonth()+1, 0)).toISOString().slice(0,10);
      const monthAligned = /^\d{4}-\d{2}-01$/.test(from) && (to===lastDay || to===myToday);
      if (monthAligned && data && Number(data.missing_months||0)===0) return j(data);
      try {
        const alw = await allowedTenants(b.token);
        const { data: tn } = await sb.from("xero_tenants").select("tenant_id,tenant_name").in("tenant_id", alw);
        const cntMap:any = {}; for(const c of ((data&&data.companies)||[])) cntMap[c.tenant_id]={ ar_count:c.ar_count, ap_count:c.ap_count };
        const access = await xeroAccessToken();
        const comps:any[] = [];
        for (const t of (tn||[])){
          try { const d = await xeroGet(access, t.tenant_id, "Reports/ProfitAndLoss?fromDate="+from+"&toDate="+to);
            const pl = parsePnl((d.Reports||[])[0]); const cc = cntMap[t.tenant_id]||{};
            comps.push({ tenant_id:t.tenant_id, tenant_name:t.tenant_name, income:pl.revenue_total, expenses:pl.expense_total, net_profit:pl.net_profit, ar_count:cc.ar_count||0, ap_count:cc.ap_count||0 });
          } catch(e){
            // B4: a failed/rate-limited fetch must NOT render as RM0 — that is indistinguishable from a
            // genuinely dormant company. Flag the row as errored (null figures) so the UI can show
            // "unavailable" and the response carries partial:true.
            const cc=cntMap[t.tenant_id]||{};
            comps.push({ tenant_id:t.tenant_id, tenant_name:t.tenant_name, income:null, expenses:null, net_profit:null, ar_count:cc.ar_count||0, ap_count:cc.ap_count||0, error:String(e).slice(0,120) });
          }
        }
        comps.sort((a,b)=>String(a.tenant_name).localeCompare(String(b.tenant_name)));
        const failed = comps.filter((c)=>c.error).map((c)=>c.tenant_name);
        return j({ ok:true, from, to, companies:comps, as_of:new Date().toISOString(), source:"live Xero P&L (exact range)", partial: failed.length>0, unavailable: failed });
      } catch(_e){ return j(data); }   // last resort: the month-sum approximation from cache
    }
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
      // v67: server-side idempotency. The Xero Idempotency-Key below is a 24h backstop, but it is void
      // the moment the payload differs between attempts (a retry that resolves a contact id the first run
      // cached changes the body — see the hr_rc post_xero comment, hr.ts:2492), so a racing retry or a
      // second operator could still create a whole second batch of real invoices. Guard it directly, the
      // way hr_rc does: the frontend-formatted per-batch reference IS the batch identity, so if any
      // non-VOIDED ACCREC invoice already exists under it, this batch was already issued — adopt those
      // instead of posting again. Only runs when a real (non-default) reference is supplied.
      if (b.reference && String(b.reference).trim()) {
        try {
          const q = 'Type=="ACCREC" AND Reference=="' + reference.replace(/"/g,'') + '" AND Status!="VOIDED"';
          const ex = await fetch("https://api.xero.com/api.xro/2.0/Invoices?where="+encodeURIComponent(q), { headers:{ "Authorization":"Bearer " + access, "Xero-Tenant-Id":targetTenant, "Accept":"application/json" } });
          if (ex.ok) {
            const exj = await ex.json();
            const existing = (exj.Invoices||[]).slice();
            if (existing.length) {
              const results = built.map((p:any)=>{
                const pcid = p.xero.Contact && p.xero.Contact.ContactID;
                let hit = -1;
                for (let k=0;k<existing.length;k++){ const iv=existing[k]; if (!iv) continue;
                  if ((pcid && iv.Contact && iv.Contact.ContactID===pcid) ||
                      (iv.Contact && String(iv.Contact.Name||"").toLowerCase()===String(p.pharmacy||"").toLowerCase())) { hit=k; break; } }
                const iv = hit>=0 ? existing[hit] : null; if (hit>=0) existing[hit]=null;
                return { pharmacy:p.pharmacy, total:p.total, number: iv?(iv.InvoiceNumber||""):"", contact: p.matched?"existing":"new",
                         status: iv&&iv.InvoiceID?"issued":"failed", error: iv?undefined:"already issued under "+reference+" but no matching invoice found",
                         contact_id: (iv&&iv.Contact&&iv.Contact.ContactID)||undefined, invoice_id: (iv&&iv.InvoiceID)||undefined };
              });
              await logAudit(me, "o2o_issue", period, { tenant: targetTenant, adopted:true, existing: (exj.Invoices||[]).length });
              return j({ ok:true, dry_run:false, adopted:true, tenant: targetTenant,
                         note:"This batch was already issued in Xero under "+reference+" — returned the existing invoices instead of creating duplicates.",
                         issued: results.filter(x=>x.status==="issued").length, emailed:0, failed: results.filter(x=>x.status==="failed").length, results });
            }
          }
        } catch(_e){ /* best-effort: a lookup failure must not block a legitimate first issue */ }
      }
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
      // v225: superAdmin() is not tenant-aware; this POSTS draft Sales Invoices into the company named in
      // the body, so a single-company admin could create invoices in another company's Xero. See sbi_buyer.
      if (!(await tenantPinned(b.token, tenant))) return denyTenant(me, "sr_post_invoices", tenant);
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
      // v225: reads another company's Xero invoice numbers by body tenant, superAdmin-only. See sbi_buyer.
      if (!(await tenantPinned(b.token, tenant))) return denyTenant(me, "sr_yrdz_next", tenant);
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
      // v225: reads another company's Xero invoice numbers by body tenant, superAdmin-only. See sbi_buyer.
      if (!(await tenantPinned(b.token, tenant))) return denyTenant(me, "sr_so_suffix", tenant);
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
        // v129: prefer the live Organisation Name — /connections tenantName is a connect-time
        // snapshot that never tracks a rename done inside Xero. Fallback to it only if the
        // Organisation call fails.
        let name = clean(await xeroOrgName(access, id));
        if (!name) name = clean(String(c.tenantName||""));
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
      // v142: Access & Roles is now tenant-scoped. It used to return EVERY user and EVERY company
      // assignment to any Master Admin — so a company-scoped Master Admin could read the names,
      // emails and login history of staff in companies they have no access to.
      // Model: a user with >=1 portal_user_companies row belongs to exactly those companies;
      // a user with NO rows is group-wide (a full-scope admin) and shows under every company.
      const alw = await allowedTenants(b.token);   // fail-closed sentinel when scope is broken
      if (b.tenant && alw.indexOf(String(b.tenant)) < 0) return j({ ok:false, error:"forbidden" }, 403);
      const { data: users } = await sb.from("portal_users").select("id,email,name,role,active,created_at,last_login_at,last_login_ip,login_count,totp_enabled").order("created_at");
      const { data: ucAll } = await sb.from("portal_user_companies").select("user_id,tenant_id,role");
      // Never expose assignments outside the caller's scope, even for a user they can legitimately see.
      const uc = (ucAll||[]).filter((r)=> alw.indexOf(String(r.tenant_id)) >= 0);
      const assignedAnywhere = new Set((ucAll||[]).map((r)=> r.user_id));
      const inCallerScope    = new Set(uc.map((r)=> r.user_id));
      const want = b.tenant ? String(b.tenant) : null;
      const inCompany = want ? new Set(uc.filter((r)=> String(r.tenant_id) === want).map((r)=> r.user_id)) : null;
      const visible = (users||[]).filter((u)=>{
        if (!assignedAnywhere.has(u.id)) return true;          // group-wide account
        return want ? inCompany.has(u.id) : inCallerScope.has(u.id);
      }).map((u)=> ({ ...u, all_companies: !assignedAnywhere.has(u.id) }));
      return j({ ok:true, users: visible, user_companies: uc, scoped_tenant: want });
    }
    if (api === "user_create") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.email || !b.pass) return j({ ok:false, error:"email and password required" });
      const tenantIds = Array.isArray(b.tenants) ? b.tenants.map((t)=> typeof t==="string" ? t : (t&&t.tenant_id)).filter(Boolean) : [];
      // A scoped Master Admin may only create accounts inside their own companies.
      if (!(await tenantsAssignable(b.token, me.user.id, tenantIds))) return j({ ok:false, error:"forbidden: company outside your access" }, 403);
      // No companies at all = a group-wide account; only a group-wide admin may mint one.
      if (!tenantIds.length){
        const { data: myCos } = await sb.from("portal_user_companies").select("tenant_id").eq("user_id", me.user.id);
        if ((myCos||[]).length) return j({ ok:false, error:"forbidden: assign at least one of your companies" }, 403);
      }
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
      if (!(await userWriteAllowed(b.token, me.user.id, b.user_id))) return j({ ok:false, error:"forbidden: that account belongs to a company outside your access" }, 403);
      // Reassigning companies must not widen a user past the caller's own scope.
      if (Array.isArray(b.tenants)){
        const reqIds = b.tenants.map((t)=> typeof t==="string" ? t : (t&&t.tenant_id)).filter(Boolean);
        if (!(await tenantsAssignable(b.token, me.user.id, reqIds))) return j({ ok:false, error:"forbidden: company outside your access" }, 403);
      }
      const upd = {}; if (b.role!==undefined) upd.role=b.role; if (b.active!==undefined) upd.active=b.active; if (b.name!==undefined) upd.name=b.name;
      if (Object.keys(upd).length){ const { error } = await sb.from("portal_users").update(upd).eq("id", b.user_id); if (error) return j({ ok:false, error:error.message }); }
      if (Array.isArray(b.tenants)){ await sb.from("portal_user_companies").delete().eq("user_id", b.user_id); if (b.tenants.length){ const rows = b.tenants.map((t)=> typeof t==="string" ? { user_id:b.user_id, tenant_id:t, role:null } : { user_id:b.user_id, tenant_id:t.tenant_id, role:t.role||null }); const { error:e2 } = await sb.from("portal_user_companies").insert(rows); if (e2) return j({ ok:false, error:e2.message }); } }
      await logAudit(me, "user_update", b.user_id, { role: b.role, active: b.active, tenants: b.tenants });
      return j({ ok:true });
    }
    if (api === "user_reset_password") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.user_id || !b.new_pass) return j({ ok:false, error:"user_id and new_pass required" });
      if (!(await userWriteAllowed(b.token, me.user.id, b.user_id))) return j({ ok:false, error:"forbidden: that account belongs to a company outside your access" }, 403);
      const { data, error } = await sb.rpc("portal_admin_reset_password", { p_user_id: b.user_id, p_new_pass: b.new_pass });
      if (error) return j({ ok:false, error: error.message });
      await logAudit(me, "password_reset", b.user_id, {});
      return j(data || { ok:true });
    }
    if (api === "roles_list") {
      const me = await meFromToken(b.token); if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized (full-scope admin only)" }, 401);  // v148: group-wide action — not a single-company admin
      const { data } = await sb.from("portal_roles").select("*").order("is_system", { ascending:false }).order("name");
      return j({ ok:true, roles: data||[] });
    }
    if (api === "role_save") {
      const me = await meFromToken(b.token); if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized (full-scope admin only)" }, 401);  // v148: group-wide action — not a single-company admin
      const name = String(b.name||"").trim().toLowerCase().replace(/[^a-z0-9_]/g,"_"); if (!name) return j({ ok:false, error:"name required" });
      const row = { name, label: b.label||name, features: Array.isArray(b.features)?b.features:[], manage_users: !!b.manage_users };
      if (name==="admin") row.manage_users = true;
      const { error } = await sb.from("portal_roles").upsert(row, { onConflict:"name" });
      if (error) return j({ ok:false, error: error.message });
      await logAudit(me, "role_save", name, { features: row.features, manage_users: row.manage_users });
      return j({ ok:true });
    }
    if (api === "role_delete") {
      const me = await meFromToken(b.token); if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized (full-scope admin only)" }, 401);  // v148: group-wide action — not a single-company admin
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
      const me = await meFromToken(b.token); if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized (full-scope admin only)" }, 401);  // v148: group-wide action — not a single-company admin
      const { data } = await sb.from("portal_audit").select("*").order("created_at", { ascending:false }).limit(Math.min(Number(b.limit)||120, 300));
      return j({ ok:true, events: data||[] });
    }
    // ── Self-Billed Invoices — companies issue invoices on individuals' behalf, for payment (MY tax/audit) ──
    if (api === "individuals_list") {
      const me = await meFromToken(b.token); if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized (full-scope admin only)" }, 401);  // v148: group-wide action — not a single-company admin
      const { data } = await sb.from("portal_individuals").select("*").eq("active", true).order("name");
      return j({ ok:true, individuals: data||[] });
    }
    if (api === "individual_save") {
      const me = await meFromToken(b.token); if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized (full-scope admin only)" }, 401);  // v148: group-wide action — not a single-company admin
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
      const me = await meFromToken(b.token); if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized (full-scope admin only)" }, 401);  // v148: group-wide action — not a single-company admin
      if (!b.id) return j({ ok:false, error:"id required" });
      const { count } = await sb.from("portal_self_billed_invoices").select("id",{count:"exact",head:true}).eq("individual_id", Number(b.id));
      if (count && count>0){ await sb.from("portal_individuals").update({ active:false }).eq("id", Number(b.id)); return j({ ok:true, soft:true }); }
      await sb.from("portal_individuals").delete().eq("id", Number(b.id));
      await logAudit(me, "individual_delete", String(b.id), {});
      return j({ ok:true });
    }
    // ═══ Withholding tax on payments to non-residents (ITA 1967 s.109 / s.109B) ═══════════════════
    // Replaces Malaysia_WHT_Summary.xlsx. The rule that matters, and that the spreadsheet got right while
    // most do not: WHT is charged on the FEE, never on the fee plus Malaysian service tax. Service tax on
    // imported taxable services is the payer's own self-accounted liability under s.26A Service Tax Act
    // 2018 — it is shown for completeness and deliberately kept out of the WHT base.
    if (api === "wht_config") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const alw = await allowedTenants(b.token);
      const { data: payees } = await sb.from("portal_wht_payees").select("*").eq("active",true).order("name");
      // Companies come from xero_tenants, which is always populated; the TIN is joined in from Company
      // Info, which may not be. Driving the list off Company Info instead gave an EMPTY dropdown — the
      // rows exist for all five companies but every field in them is still null.
      let tq = sb.from("xero_tenants").select("tenant_id,tenant_name").order("tenant_name");
      if (alw.length) tq = tq.in("tenant_id", alw);
      const { data: tens } = await tq;
      const { data: infos } = await sb.from("portal_company_info").select("tenant_id,legal_name,income_tax_no,myinvois_tin");
      const byTenant:any = {}; (infos||[]).forEach((c:any)=>{ byTenant[c.tenant_id]=c; });
      const entities = (tens||[]).map((t:any)=>{
        const ci = byTenant[t.tenant_id]||{};
        return { tenant_id:t.tenant_id, name: ci.legal_name || t.tenant_name,
                 tax_no: ci.income_tax_no || ci.myinvois_tin || null };
      });
      return j({ ok:true,
        payees: (payees||[]).filter((p:any)=> !p.tenant_id || !alw.length || alw.indexOf(p.tenant_id)>=0),
        entities });
    }
    if (api === "wht_payee_save") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const p = b.payee||{};
      const name = String(p.name||"").trim(); if(!name) return j({ ok:false, error:"Payee name is required." });
      const rate = Number(p.wht_rate);
      // A net-basis gross-up divides by (1 - rate), so 100% is both unreal and a division by zero.
      if(!isFinite(rate) || rate < 0 || rate >= 1) return j({ ok:false, error:"The WHT rate must be between 0 and 1 (0.10 = 10%)." });
      const row:any = { name, tin:String(p.tin||"").trim()||null, country:String(p.country||"").trim()||null,
        wht_rate:rate, wht_type:(["royalty","s4a_special","interest","contract","other"].indexOf(String(p.wht_type))>=0?String(p.wht_type):"royalty"),
        statutory_rate:(p.statutory_rate===""||p.statutory_rate==null)?null:Number(p.statutory_rate),
        treaty_relief:!!p.treaty_relief, has_cor:!!p.has_cor, notes:String(p.notes||"").trim()||null,
        active:p.active!==false, updated_at:new Date().toISOString() };
      let out:any;
      if(p.id){ const r=await sb.from("portal_wht_payees").update(row).eq("id",Number(p.id)).select().single();
                if(r.error) return j({ ok:false, error:r.error.message }); out=r.data; }
      else { const r=await sb.from("portal_wht_payees").insert(row).select().single();
             if(r.error) return j({ ok:false, error:r.error.message }); out=r.data; }
      await logAudit(me,"wht_payee_save",String(out.id),{ name, rate });
      return j({ ok:true, payee: out });
    }
    if (api === "wht_payee_delete") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      // Never hard-delete: filed computations reference the payee and the FK is RESTRICT.
      const { error } = await sb.from("portal_wht_payees").update({ active:false, updated_at:new Date().toISOString() }).eq("id",Number(b.id));
      if(error) return j({ ok:false, error:error.message });
      await logAudit(me,"wht_payee_delete",String(b.id),{});
      return j({ ok:true });
    }
    if (api === "wht_list") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      let q = sb.from("portal_wht_summaries").select("*").order("created_at",{ascending:false}).limit(Math.min(Number(b.limit)||200,500));
      { const alw = await allowedTenants(b.token); if (alw.length) q = q.in("tenant_id", alw); }
      if (b.tenant) q = q.eq("tenant_id", String(b.tenant));
      const { data } = await q;
      const ids = (data||[]).map((r:any)=>r.id);
      const sums:any = {};
      // Paginated: a single select caps at 1000 rows, and this asks for the lines of up to 500
      // computations at once. Past that ceiling the fee totals in the list quietly come back SHORT —
      // the same silent truncation that froze the AR drift check at 1000 and produced permanent false
      // alarms. A wrong total that looks like a total is worse than an error.
      for (let off=0; ids.length && off<200000; off+=1000){
        const { data: lines } = await sb.from("portal_wht_lines").select("summary_id,amount")
          .in("summary_id", ids).order("id").range(off, off+999);
        (lines||[]).forEach((l:any)=>{ sums[l.summary_id]=(sums[l.summary_id]||0)+Number(l.amount||0); });
        if (!lines || lines.length < 1000) break;
      }
      return j({ ok:true, summaries: (data||[]).map((r:any)=>({ ...r, fee_total: Math.round((sums[r.id]||0)*100)/100 })) });
    }
    if (api === "wht_get") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.from("portal_wht_summaries").select("*").eq("id",Number(b.id)).maybeSingle();
      if(!data) return j({ ok:false, error:"Not found." });
      { const alw = await allowedTenants(b.token); if (alw.length && data.tenant_id && alw.indexOf(data.tenant_id)<0)
          return denyTenant(me,"wht_get",data.tenant_id); }
      const { data: lines } = await sb.from("portal_wht_lines").select("*").eq("summary_id",data.id).order("line_no");
      return j({ ok:true, summary: data, lines: lines||[] });
    }
    if (api === "wht_save") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const s = b.summary||{}; const lines = Array.isArray(b.lines)?b.lines:[];
      const tenant = String(s.tenant_id||b.tenant||"").trim();
      if(!tenant) return j({ ok:false, error:"Pick the paying company." });
      { const alw = await allowedTenants(b.token); if (alw.length && alw.indexOf(tenant)<0) return denyTenant(me,"wht_save",tenant); }
      if(!String(s.payee_name||"").trim()) return j({ ok:false, error:"Pick the payee." });
      const rate = Number(s.wht_rate);
      if(!isFinite(rate) || rate < 0 || rate >= 1) return j({ ok:false, error:"The WHT rate must be between 0 and 1 (0.10 = 10%)." });
      const basis = (String(s.basis)==="net") ? "net" : "gross";
      // Validate every amount BEFORE writing anything. A NaN here silently becomes 0 and understates the
      // tax due — the computation still looks complete on screen, which is the worst possible failure.
      for (const l of lines){
        const a = Number(l.amount);
        if(!isFinite(a) || a < 0) return j({ ok:false, error:"Every line amount must be a number of 0 or more." });
      }
      const head:any = {
        tenant_id: tenant, payee_id: s.payee_id?Number(s.payee_id):null,
        payee_name: String(s.payee_name).trim(), payee_tin: String(s.payee_tin||"").trim()||null,
        payee_country: String(s.payee_country||"").trim()||null, entity_tin: String(s.entity_tin||"").trim()||null,
        period_label: String(s.period_label||"").trim()||null,
        period_from: s.period_from||null, period_to: s.period_to||null,
        wht_rate: rate, wht_type: String(s.wht_type||"royalty"), basis,
        sst_rate: (s.sst_rate==null||s.sst_rate==="")?0.08:Number(s.sst_rate),
        penalty_pct: (s.penalty_pct==null||s.penalty_pct==="")?0.10:Number(s.penalty_pct),
        penalty_on: !!s.penalty_on, paid_on: s.paid_on||null,
        status: (["draft","final","filed"].indexOf(String(s.status))>=0?String(s.status):"draft"),
        notes: String(s.notes||"").trim()||null, updated_at: new Date().toISOString(),
      };
      let id = s.id ? Number(s.id) : null;
      if(id){
        const { data: prev } = await sb.from("portal_wht_summaries").select("tenant_id,status").eq("id",id).maybeSingle();
        if(!prev) return j({ ok:false, error:"Not found." });
        { const alw = await allowedTenants(b.token); if (alw.length && prev.tenant_id && alw.indexOf(prev.tenant_id)<0)
            return denyTenant(me,"wht_save",prev.tenant_id); }
        if(prev.status==="filed" && !b.force) return j({ ok:false, error:"This computation is marked as filed — reopen it before editing." });
        const { error } = await sb.from("portal_wht_summaries").update(head).eq("id",id);
        if(error) return j({ ok:false, error:error.message });
      } else {
        head.created_by = (me.user&&me.user.id)||null;
        // Same atomic counter the claim numbers use — a max()+1 here would collide under concurrent saves,
        // and doc_no is UNIQUE. Numbered by the Malaysian month, not UTC, for the same reason as claims.
        try{
          const myt = new Date(Date.now() + 8*3600*1000);
          const scope = "WHT-"+myt.getUTCFullYear()+String(myt.getUTCMonth()+1).padStart(2,"0");
          const { data:n } = await sb.rpc("hr_next_doc_no",{ p_scope: scope });
          if(n!=null) head.doc_no = scope+"-"+String(n).padStart(4,"0");
        }catch(_e){}
        const { data, error } = await sb.from("portal_wht_summaries").insert(head).select("id,doc_no").single();
        if(error) return j({ ok:false, error:error.message });
        id = data.id;
      }
      // Replace the lines wholesale. Surface a failed insert rather than leaving the computation with a
      // deleted line set and a total that still looked right on the last screen the operator saw.
      const del = await sb.from("portal_wht_lines").delete().eq("summary_id", id);
      if(del.error) return j({ ok:false, error:del.error.message });
      const rows = lines.filter((l:any)=> Number(l.amount)>0 || String(l.receipt_no||"").trim() || l.payment_date)
        .map((l:any,i:number)=>({ summary_id:id, line_no:i+1, payment_date:l.payment_date||null,
          receipt_no:String(l.receipt_no||"").trim()||null, description:String(l.description||"").trim()||null,
          amount: Math.round((Number(l.amount)||0)*100)/100 }));
      if(rows.length){ const ins = await sb.from("portal_wht_lines").insert(rows); if(ins.error) return j({ ok:false, error:ins.error.message }); }
      await logAudit(me,"wht_save",String(id),{ tenant, payee:head.payee_name, lines:rows.length, basis, rate });
      return j({ ok:true, id, lines: rows.length });
    }
    if (api === "wht_delete") {
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.from("portal_wht_summaries").select("tenant_id,status,doc_no").eq("id",Number(b.id)).maybeSingle();
      if(!data) return j({ ok:false, error:"Not found." });
      { const alw = await allowedTenants(b.token); if (alw.length && data.tenant_id && alw.indexOf(data.tenant_id)<0)
          return denyTenant(me,"wht_delete",data.tenant_id); }
      if(data.status==="filed") return j({ ok:false, error:"A filed computation can't be deleted — it is the record of what was submitted to LHDN." });
      const { error } = await sb.from("portal_wht_summaries").delete().eq("id",Number(b.id));   // lines cascade
      if(error) return j({ ok:false, error:error.message });
      await logAudit(me,"wht_delete",String(b.id),{ doc_no:data.doc_no });
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
      // v225: superAdmin() is not tenant-aware and 4 of 10 admins are scoped to a single company, so this
      // returned another company's TIN, SST number, registered address and BANK ACCOUNTS to an admin who
      // was deliberately not given that company. Same class as portal_company_info_save (v190).
      if (!(await tenantPinned(b.token, String(b.tenant||"")))) return denyTenant(me, "sbi_buyer", String(b.tenant||""));
      const { data: ci } = await sb.from("portal_company_info").select("legal_name,ssm_new,myinvois_tin,sst_no,reg_address,reg_postcode,reg_city,reg_state,bank_accounts").eq("tenant_id", b.tenant).maybeSingle();
      const { data: tn } = await sb.from("xero_tenants").select("tenant_name").eq("tenant_id", b.tenant).maybeSingle();
      const addr = ci ? [ci.reg_address, ci.reg_postcode, ci.reg_city, ci.reg_state].filter(Boolean).join(", ") : "";
      return j({ ok:true, buyer: { name:(ci&&ci.legal_name)||(tn&&tn.tenant_name)||"", ssm:(ci&&ci.ssm_new)||"", tin:(ci&&ci.myinvois_tin)||"", sst:(ci&&ci.sst_no)||"", address:addr }, has_info: !!(ci&&ci.legal_name) });
    }
    if (api === "sbi_accounts") {
      // Live Xero chart of accounts for the paying company → GL-account + WHT-payable dropdowns.
      const me = await meFromToken(b.token); if (!superAdmin(me)) return j({ ok:false, error:"unauthorized" }, 401);
      if (!b.tenant) return j({ ok:false, error:"tenant required" });
      // v225: returns another company's Xero chart of accounts by body tenant, superAdmin-only. See sbi_buyer.
      if (!(await tenantPinned(b.token, String(b.tenant||"")))) return denyTenant(me, "sbi_accounts", String(b.tenant||""));
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
      // Each line to the sen, then the sum of the ROUNDED lines — so gross - wht + sst == net exactly,
      // and the self-billed invoice (which carries an LHDN declaration and goes to the payee) casts.
      // Must mirror sbiRecalc() in app.html and recalc() in web/src/finance-selfbill.tsx.
      const sbiLine = (it: any)=> Math.round((Number(it.amount) || (Number(it.qty||1)*Number(it.unit_price||0)))*100)/100;
      const gross = Math.round(items.reduce((s: number, it: any)=> s + sbiLine(it), 0)*100)/100;
      const sst = Math.round((Number(inv.sst_amount||0))*100)/100;
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
          // v191: `|| undefined` dropped the field entirely when due_date was blank, and Xero rejects a
          // SUBMITTED bill with no due date ("Due Date cannot be empty") — same failure the reimbursement
          // path hit on every single attempt. Fall back rather than omit.
          Reference: reference, Date: v.invoice_date||undefined,
          DueDate: v.due_date || new Date(Date.now() + 30*86400000 + 8*3600*1000).toISOString().slice(0,10),
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
          const existing = await xeroInvoicesWhere(accessCheck, item.tenant_id, whereClause);
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
          const scanPartial = !!(existing as any).__partial;
          checks.push({ name:"No existing Xero bill with the same invoice number for this vendor", pass: !xero_dupes.some(d=>d.match_type==="invoice_number"), detail: xero_dupes.length ? xero_dupes.length + " potential dup(s) found in Xero" : "OK" });
          checks.push({ name:"No existing Xero bill with same amount + date within 7 days", pass: !xero_dupes.some(d=>d.match_type==="amount+date"), detail: "" });
          // A truncated scan is NOT a clean scan — fail the check so the operator can't read
          // "no duplicate" from an incomplete search. Only relevant if the scan actually hit the ceiling.
          if (scanPartial) checks.push({ name:"Xero duplicate scan was COMPLETE", pass:false, detail:"Xero returned a partial result (rate-limit or >50k bills) — duplicates beyond the scanned set may exist. Verify manually before posting." });
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
      // v225: this rule decides how another company's bills get GL-coded from then on. superAdmin() alone
      // is not tenant-aware — see the note on sbi_buyer.
      if (!(await tenantPinned(b.token, String(b.tenant)))) return denyTenant(me, "ap_rule_save", String(b.tenant));
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
    if (api === "pnl_refresh") {
      // Refresh the real-P&L cache from Xero for all tenants (used by the dashboard for accurate numbers).
      const me = await meFromToken(b.token); if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized (full-scope admin only)" }, 401);  // v148: group-wide action — not a single-company admin
      let access; try { access = await xeroAccessToken(); } catch(e){ return j({ ok:false, error:"Xero auth: "+String(e).slice(0,150) }); }
      const { data: tn } = await sb.from("xero_tenants").select("tenant_id,tenant_name");
      const results = await refreshPnlCache(access, tn||[], Number(b.months)||12);
      try { await sb.rpc("refresh_overview_pnl"); } catch(_e){}
      await logAudit(me, "pnl_refresh", "all", { tenants:(tn||[]).length });
      return j({ ok:true, results });
    }
    if (api === "pnl_analysis") {
      // v141: account-level P&L grid (months across, accounts down) for the P&L Analysis tab.
      // The RPC re-validates the token and pins p_tenant to the caller's allowed set.
      // `!me` alone is not a gate: portal_me answers an invalid token with `{ok:false}`, which is an
      // OBJECT and therefore truthy, so every anonymous caller walked through this line and reached the
      // RPC. The RPC's own token check held (it returned an empty P&L, not somebody's figures), but this
      // was the only handler of the 100+ here written that way — the rest test `.ok`, directly or through
      // superAdmin/isAdmin/hrManage. Verified against production before and after.
      const me = await meFromToken(b.token); if (!me || !me.ok) return j({ ok:false, error:"unauthorized" }, 401);
      const { data, error } = await sb.rpc("portal_pnl_analysis", { p_token: b.token, p_tenant: b.tenant||null, p_months: Number(b.months)||6 });
      if (error) return j({ ok:false, error: String(error.message).slice(0,200) });   // never swallow: an empty {ok:true} renders as zeros
      return j(data || { ok:false, error:"no data" });
    }
    if (api === "fx_backfill") {
      // v140 one-shot: historical rows were cached before currency_rate existed, so every FX
      // invoice sits at rate 1 and its base-currency amount equals its foreign amount.
      // Re-fetch just the non-MYR invoices from Xero and store the real CurrencyRate.
      // total_base / amount_due_base are generated columns, so they correct themselves.
      const me = await meFromToken(b.token); if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized (full-scope admin only)" }, 401);  // v148: group-wide action — not a single-company admin
      let access; try { access = await xeroAccessToken(); } catch(e){ return j({ ok:false, error:"Xero auth: "+String(e).slice(0,150) }); }
      const { data: rows, error: selErr } = await sb.from("xero_invoice_cache")
        .select("tenant_id,invoice_id").neq("currency","MYR").limit(5000);
      if (selErr) return j({ ok:false, error:"select: "+String(selErr.message).slice(0,150) });
      const byTenant: any = {};
      for (const r of (rows||[])) { (byTenant[r.tenant_id] = byTenant[r.tenant_id] || []).push(r.invoice_id); }
      let updated = 0, seen = 0; const errs: string[] = [];
      for (const tid of Object.keys(byTenant)){
        const ids = byTenant[tid];
        for (let i=0; i<ids.length; i+=40){
          const chunk = ids.slice(i, i+40);
          try {
            const d = await xeroGet(access, tid, "Invoices?IDs=" + chunk.join(","));
            for (const iv of (d.Invoices||[])){
              seen++;
              const rate = Number(iv.CurrencyRate) > 0 ? Number(iv.CurrencyRate) : 1;
              const { error } = await sb.from("xero_invoice_cache")
                .update({ currency_rate: rate }).eq("tenant_id", tid).eq("invoice_id", iv.InvoiceID);
              if (error) errs.push(String(error.message).slice(0,80)); else updated++;
            }
          } catch(e){ errs.push(String(e).slice(0,120)); }
        }
      }
      await logAudit(me, "fx_backfill", "all", { requested:(rows||[]).length, seen, updated, errors: errs.length });
      return j({ ok: errs.length===0, requested:(rows||[]).length, seen, updated, errors: errs.slice(0,5) });
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
      // v225: pulls another company's Xero invoices by body tenant, superAdmin-only. See sbi_buyer.
      if (!(await tenantPinned(b.token, String(b.tenant||"")))) return denyTenant(me, "xero_diagnose", String(b.tenant||""));
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
      // v148 (BLOCKER fix): this used to return token_full — the real bearer token for EVERY user in EVERY
      // company — to any admin. A single-company admin could lift a full-scope admin's token and replay it
      // (total account takeover). Now: full-scope admins only, NO token is ever returned, and the revoke
      // handle is a SHA-256 of the token (opaque, can't be replayed as a bearer).
      const me = await meFromToken(b.token); if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized" }, 401);
      const { data } = await sb.from("portal_sessions").select("token,user_id,created_at,last_seen_at").order("last_seen_at", { ascending:false, nullsFirst:false });
      const { data: users } = await sb.from("portal_users").select("id,email,name,role");
      const u = {}; (users||[]).forEach((x)=>{ u[x.id]=x; });
      const sessions = [];
      for (const s of (data||[])){
        const sid = await sha256Hex(String(s.token||""));
        sessions.push({ sid, token_short: (String(s.token||"").slice(0,10)) + "…", user_email: (u[s.user_id]||{}).email, user_name: (u[s.user_id]||{}).name, user_role: (u[s.user_id]||{}).role, created_at: s.created_at, last_seen_at: s.last_seen_at, is_self: s.token === b.token });
      }
      return j({ ok:true, sessions });
    }
    if (api === "session_revoke") {
      // Revoke by the opaque sid (SHA-256 of the token) — the caller never holds the real token. Full-scope
      // admins only; a caller can always revoke their OWN session via b.token.
      const me = await meFromToken(b.token); if (!(await isFullScopeAdmin(me, b.token))) return j({ ok:false, error:"unauthorized" }, 401);
      const sid = String(b.sid||"");
      if (!sid) return j({ ok:false, error:"sid required" });
      const { data: rows } = await sb.from("portal_sessions").select("token");
      let target: string|null = null;
      for (const r of (rows||[])){ if (await sha256Hex(String(r.token||"")) === sid){ target = r.token; break; } }
      if (!target) return j({ ok:false, error:"session not found" });
      const { error } = await sb.from("portal_sessions").delete().eq("token", target);
      if (error) return j({ ok:false, error: error.message });
      await logAudit(me, "session_revoke", sid.slice(0,10)+"…", {});
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
      // v149: enforce tenant scope BEFORE touching storage. Previously the cascade wiped storage files
      // (line below) and only then called the scope-enforcing RPC — so a scoped admin passing another
      // company's folder_id could destroy that company's files before the reject. Pin the target's tenant
      // to allowedTenants up front.
      {
        const alwF = await allowedTenants(b.token);
        const { data: fldr } = await sb.from("portal_company_folders").select("tenant_id").eq("id", Number(b.folder_id)).maybeSingle();
        if (!fldr || alwF.indexOf(String(fldr.tenant_id)) < 0) return j({ ok:false, error:"forbidden: folder outside your access" }, 403);
      }
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
      // Re-auth: require the account password so a borrowed/stolen session can't silently strip 2FA.
      const { data: okPw } = await sb.rpc("portal_verify_password", { p_token: b.token||"", p_pass: String(b.password||"") });
      if (okPw !== true) return j({ ok:false, error:"Enter your current password to turn off two-factor authentication." });
      const { data } = await sb.rpc("portal_totp_disable", { p_token: b.token||"" });
      await logAudit(me, "totp_disable", me.user.email, {});
      return j(data);
    }
  return undefined;
}
