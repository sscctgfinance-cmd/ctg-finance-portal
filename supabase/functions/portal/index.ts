// CTG portal edge function — the router.
//
// One URL, one function name (`portal`), one POST protocol: {api:"..."} — four external systems hold
// this URL (Supabase cron, Xero webhooks, inbound email, service-worker push), so none of that may
// change. What changed in this file is only WHERE the handler bodies live:
//
//   lib.ts      shared library (Supabase client, auth/tenant guards, Xero, OCR, AP pipeline, cron)
//   hr.ts       HR OS helpers + the hr_ / attendance_ / clock_ handler chain
//   finance.ts  Finance OS + platform handler chain
//
// The dispatch below is still a single first-match if-chain in the ORIGINAL ORDER. That order is
// load-bearing: the HR viewer write gate between the two chains only sees actions that no earlier
// branch answered, so finance.ts must be consulted before it and hr.ts after it.

import {
  sb, CORS, j, clientIp, xeroOAuthStart, xeroOAuthCallback,
  meFromToken, hrViewer, HR_VIEWER_READS, HR_ONLY_ROLES, isHrNamespace, AUTH_BASIC_ACTIONS,
  allowedTenants, denyTenant, handleWebhook,
} from "./lib.ts";

import {
  rcEmailActionPage, hrRoutes,
} from "./hr.ts";
import { financeRoutes } from "./finance.ts";

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
  // v149: an UNEXPECTED throw here (e.g. req.text() fails) used to ACK 200 → Xero considered the batch
  // delivered and never redelivered, silently losing it. Return 500 so Xero retries. handleWebhook's own
  // paths (401 bad-sig, 500 persist-fail, 200 accepted) are explicit returns and are preserved.
  if (xsig !== null) { try { return await handleWebhook(req, xsig); } catch (e) { try { console.error("webhook top-level threw:", e); } catch(_){} return new Response("err", { status: 500 }); } }
  const ip = clientIp(req);
  let b; try { b = await req.json(); } catch { return j({ error:"bad json" }, 400); }
  // Inbound email webhook detection: Postmark / Resend / SendGrid POST the raw email payload
  // without our {api,payload} wrapper. If we see the secret header AND no `api` field, auto-wrap.
  const apInboundSecret = req.headers.get("x-ap-inbound-secret");
  if (apInboundSecret && !b.api) {
    // Pass the secret through `b.secret` as well so the handler's existing check works.
    b = { api: "ap_inbound", payload: b, secret: apInboundSecret };
  }
  // v168: normalise to a string. A request with no `api` (an empty POST {}, a health probe, a malformed
  // client call) used to leave this undefined, and the HR viewer gate below does api.indexOf("hr_") —
  // which threw "Cannot read properties of undefined (reading 'indexOf')". That crash is why the deploy
  // workflow's post-deploy health check has failed on EVERY release since v154, emailing a red build each
  // time even though the function itself deployed fine. An empty api falls through to the friendly banner.
  const api = (typeof b.api === "string") ? b.api : "";
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
    { const r = await financeRoutes(b, api, ip, req); if (r) return r; }
    // ===== HR / Payroll (Wave 1: employees, leave, claims) — reads hr_* via service role, gated by portal admin =====
    // Access role: a Viewer (read-only) may call HR read actions only; hard-block every mutating HR/RC/attendance action.
    if ((api.indexOf("hr_")===0 || api.indexOf("attendance_")===0 || api.indexOf("clock_")===0) && !HR_VIEWER_READS.has(api)){
      const _v = await meFromToken(b.token);
      if (hrViewer(_v)) return j({ ok:false, error:"Your HR access is view-only — changes are disabled." }, 403);
    }
    { const r = await hrRoutes(b, api); if (r) return r; }
    if (api === "client_error") {
      // v162: landing point for the browser beacon. hros.html / app.html are ~500 KB single-file apps with
      // no build step and no error capture, so until now a runtime error was invisible — the employee saw a
      // dead button and, at best, sent a WhatsApp message. Deliberately does NOT require auth: the errors
      // most worth seeing are the ones that happen during boot, before a session exists.
      const cut = (v:any, n:number)=> String(v==null?"":v).slice(0,n) || null;
      const msg = cut(b.message, 500);
      if (!msg) return j({ ok:true, ignored:true });
      // Group by message + first stack frame so a repeat does not create a new row every time.
      const frame = String(b.stack||"").split("\n").map((s:string)=>s.trim()).find((s:string)=>s.startsWith("at ")) || "";
      const fingerprint = (msg + "|" + frame).slice(0, 300);
      let who:any = null;
      try { if (b.token) { const m = await meFromToken(b.token); if (m && m.ok) who = m; } } catch(_e){}
      const { data: prior } = await sb.from("portal_client_errors")
        .select("id,seen_count").eq("fingerprint",fingerprint)
        .gte("at", new Date(Date.now() - 6*3600*1000).toISOString())   // collapse within a 6-hour window
        .order("at",{ascending:false}).limit(1).maybeSingle();
      if (prior) {
        await sb.from("portal_client_errors").update({ seen_count:(prior.seen_count||1)+1, at:new Date().toISOString() }).eq("id",prior.id);
        return j({ ok:true, grouped:true });
      }
      await sb.from("portal_client_errors").insert({
        app: cut(b.app,20), kind: cut(b.kind,30), message: msg, stack: cut(b.stack,4000),
        page: cut(b.page,300), user_agent: cut(b.ua,300), fingerprint,
        user_id: (who && who.user && who.user.id) || null,
        user_email: (who && who.user && who.user.email) || null,
        tenant_id: cut(b.tenant,40),
      });
      return j({ ok:true });
    }
    // v163 FAIL-CLOSED. This fallthrough used to answer every unrecognised action with ok:true, so a
    // typo'd or removed action name looked like a success to the caller — the frontend would carry on
    // as though the save had happened. Found by a CI smoke test that probed a non-existent action and
    // got ok:true back. Only __ping__ keeps the friendly banner; anything else is now an error.
    if (api === "__ping__" || !api) return j({ ok:true, hint:"portal v178: CTG Portal SSO admin access. New ctg_access_list / ctg_access_grant / ctg_access_revoke actions proxy the CTG staff directory so the app secret never reaches a browser, and an Admin -> CTG Access page grants or revokes portal access per person. Users are matched on the stable CTG subject id, never created implicitly; an SSO-only account gets an unusable random bcrypt because pass_hash is NOT NULL. Revoking kills live sessions, and you cannot revoke yourself or the last admin. Also includes v177: the health alarm was manufacturing its own alerts — sending mail took longer than pg_net s 5s default, so every alerting run logged a timeout that the next run reported as a failed HTTP call, and since that count is part of the de-dupe key it sent another email. The send now runs in the background and the cron allows 30s." });
    return j({ ok:false, error:"unknown action: "+String(api).slice(0,60) }, 400);
  } catch (e) { return j({ ok:false, error: String(e) }, 500); }
});

// deploy retrigger 2026-07-10 (CI run 49 failed transiently)

// v142 deploy trigger — first run after SUPABASE_ACCESS_TOKEN was added to the CTG-Business repo.
