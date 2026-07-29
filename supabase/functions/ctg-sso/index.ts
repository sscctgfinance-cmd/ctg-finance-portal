// CTG Portal SSO — OAuth 2.0 authorization code flow with PKCE (S256) against api.ctg-portal.com.
//
// Why this lives in an edge function rather than in the pages themselves: app.html / hros.html /
// index.html are static files on GitHub Pages. A static host cannot serve a `/sso/callback` route, and
// anything it does serve is public — so the PKCE code_verifier and the session mint would both be
// readable. The verifier is held server-side in portal_sso_flows and never reaches the browser.
//
// It is also a SEPARATE function from `portal` on purpose: the portal function's GET handler already
// claims `?code=&state=` for the Xero OAuth callback (portal_current.ts, xeroOAuthCallback). An SSO
// callback landing there would be swallowed by Xero's handler.
//
// INERT UNTIL CONFIGURED: with no app_id in portal_secrets every route degrades to a readable message
// and nothing else changes. The existing email/password login is untouched — the Notion spec's
// "keep both for the time being".

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Fixed for every CTG app per the SSO spec.
const PORTAL_ORIGIN = Deno.env.get("CTG_AUTH_PORTAL_ORIGIN") || "https://api.ctg-portal.com";
const SELF          = `${SUPABASE_URL}/functions/v1/ctg-sso`;
const REDIRECT_URI  = `${SELF}/callback`;

const PAGES = "https://sscctgfinance-cmd.github.io/ctg-finance-portal";
// Allow-list, not a parameter. A redirect target taken from the query string is an open redirect, and
// an open redirect on a login callback is a credential-stealing primitive.
const APPS: Record<string, string> = {
  hros:   `${PAGES}/hros.html`,
  portal: `${PAGES}/app.html`,
  index:  `${PAGES}/index.html`,
};

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ── helpers ───────────────────────────────────────────────────────────────────
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function randomVerifier(): string {
  // 96 random bytes → 128 base64url chars, the top of the RFC 7636 range.
  const b = new Uint8Array(96);
  crypto.getRandomValues(b);
  return b64url(b.buffer);
}

async function challengeOf(verifier: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function page(title: string, body: string, status = 200, backTo?: string): Response {
  // Matches the CTG dark theme so a failure does not look like a crashed server.
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1216;
      font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e6e9ef}
 .card{max-width:34rem;padding:2rem 2.25rem;background:#171b21;border:1px solid #262c35;border-radius:14px}
 h1{margin:0 0 .6rem;font-size:1.12rem;color:#fff}
 p{margin:.5rem 0;color:#9aa4b2}
 code{background:#0f1216;border:1px solid #262c35;border-radius:5px;padding:.1rem .4rem;font-size:.86em;color:#cbd3df}
 a{color:#f08a7a;text-decoration:none} a:hover{text-decoration:underline}
</style>
<div class="card"><h1>${esc(title)}</h1>${body}${
      backTo ? `<p><a href="${esc(backTo)}">← Back to sign in</a></p>` : ""}</div>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
    },
  });

async function appId(): Promise<string | null> {
  const { data } = await sb.from("portal_secrets").select("value").eq("key", "ctg_auth_app_id").maybeSingle();
  const v = data && typeof data.value === "string" ? data.value.trim() : "";
  return v ? v : null;
}

const NOT_CONFIGURED = `
 <p>CTG Portal SSO is wired up but not switched on yet — the <code>app_id</code> has not been issued.</p>
 <p>To finish: send this exact callback URL to the CTG SSO owner and ask for the app id —</p>
 <p><code>${REDIRECT_URI}</code></p>
 <p>then store it:<br><code>insert into portal_secrets(key,value) values('ctg_auth_app_id','&lt;id&gt;')
 on conflict (key) do update set value = excluded.value;</code></p>
 <p>Nothing else needs redeploying. The existing email &amp; password sign-in is unaffected.</p>`;

// ── routes ────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const url  = new URL(req.url);
  const path = url.pathname.replace(/^.*\/ctg-sso/, "") || "/";

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" },
    });
  }

  // Lets each page decide whether to render the SSO button at all, so nothing appears to staff until
  // the app id exists. Deliberately reveals only a boolean.
  if (path === "/status") {
    return json({ ok: true, enabled: !!(await appId()), redirect_uri: REDIRECT_URI });
  }

  // ── 1. begin login ──
  if (path === "/start" || path === "/") {
    const key = url.searchParams.get("app") || "";
    if (!APPS[key]) return page("Unknown app", `<p>No CTG app is registered under <code>${esc(key)}</code>.</p>`, 400);

    const id = await appId();
    if (!id) return page("SSO not configured yet", NOT_CONFIGURED, 503, APPS[key]);

    const verifier  = randomVerifier();
    const challenge = await challengeOf(verifier);
    const state     = b64url(crypto.getRandomValues(new Uint8Array(24)).buffer);

    const { error } = await sb.from("portal_sso_flows").insert({
      state, code_verifier: verifier, app_key: key, return_to: APPS[key],
      ip: req.headers.get("x-forwarded-for") || null,
    });
    // Fail closed: if the verifier could not be stored the callback can never complete, so send the
    // user nowhere rather than to a login that is guaranteed to dead-end.
    if (error) return page("Could not start sign-in", `<p>${esc(error.message)}</p>`, 500, APPS[key]);

    const auth = new URL(`${PORTAL_ORIGIN}/api/sso/authorize`);
    auth.searchParams.set("app_id", id);
    auth.searchParams.set("redirect_uri", REDIRECT_URI);
    auth.searchParams.set("state", state);
    auth.searchParams.set("code_challenge", challenge);
    auth.searchParams.set("code_challenge_method", "S256");
    return Response.redirect(auth.toString(), 302);
  }

  // ── 2. return from CTG Portal ──
  if (path === "/callback") {
    const code  = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err   = url.searchParams.get("error");
    if (err)            return page("Sign-in was declined", `<p>CTG Portal returned <code>${esc(err)}</code>.</p>`, 400, APPS.index);
    if (!code || !state) return page("Incomplete sign-in", `<p>The response was missing its code or state.</p>`, 400, APPS.index);

    // Single-use + unexpired, enforced in one atomic UPDATE so a replayed callback cannot succeed twice.
    const { data: flows } = await sb.rpc("portal_sso_consume", { p_state: state });
    const flow = Array.isArray(flows) ? flows[0] : flows;
    if (!flow) return page("This sign-in link has expired",
      `<p>It was already used, or more than 10 minutes passed. Please sign in again.</p>`, 400, APPS.index);

    const id = await appId();
    if (!id) return page("SSO not configured yet", NOT_CONFIGURED, 503, flow.return_to);

    // ── exchange the code (public client: PKCE proves possession, there is no client secret) ──
    let tok: any;
    try {
      const r = await fetch(`${PORTAL_ORIGIN}/api/sso/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, code_verifier: flow.code_verifier, app_id: id, redirect_uri: REDIRECT_URI }),
      });
      const body = await r.text();
      if (!r.ok) return page("CTG Portal rejected the sign-in", `<p><code>${esc(body.slice(0, 400))}</code></p>`, 502, flow.return_to);
      tok = JSON.parse(body);
    } catch (e: any) {
      return page("Could not reach CTG Portal", `<p>${esc(e?.message || String(e))}</p>`, 502, flow.return_to);
    }

    // The token response shape is not documented; accept the usual places these can appear rather than
    // guessing one. If neither is present the login fails loudly instead of logging someone in as nobody.
    const email = String(tok?.user?.email || tok?.email || tok?.profile?.email || "").trim().toLowerCase();
    const sub   = String(tok?.user?.sub || tok?.sub || tok?.profile?.sub || tok?.user?.id || "").trim();
    if (!email && !sub) {
      return page("No identity in the CTG response",
        `<p>The sign-in succeeded but carried neither a subject id nor an email, so it cannot be matched
          to a portal user.</p>
         <p>Response keys: <code>${esc(Object.keys(tok || {}).join(", ") || "none")}</code></p>`, 502, flow.return_to);
    }

    // ── match, never create ──
    // The spec offers auto-match on HR's verified email list or "Admin links each person first", and
    // recommends the latter — so access is granted deliberately in Admin → CTG Access, never here.
    // Match on `sub` FIRST: an email can be changed, or reassigned to a new joiner, and matching a
    // recycled address would hand over someone else's account.
    let user: any = null;
    if (sub) {
      const { data } = await sb.from("portal_users")
        .select("id,email,name,active,role,ctg_sub").eq("ctg_sub", sub).maybeSingle();
      user = data || null;
    }
    if (!user && email) {
      const { data } = await sb.from("portal_users")
        .select("id,email,name,active,role,ctg_sub").ilike("email", email).maybeSingle();
      user = data || null;
      // First SSO login for an account an admin linked by email — pin the subject id now so every later
      // login matches on the stable identifier.
      if (user && sub && !user.ctg_sub) {
        await sb.from("portal_users").update({ ctg_sub: sub }).eq("id", user.id);
      }
    }

    if (!user || user.active === false) {
      return page("No portal access for this account",
        `<p><code>${esc(email || sub)}</code> signed in to CTG Portal successfully, but it has not been
          granted access to this portal.</p>
         <p>Ask an admin to grant it under <strong>Admin → CTG Access</strong>, then sign in again.</p>`,
        403, flow.return_to);
    }

    // ── mint a session identical to the password login's ──
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const { error: se } = await sb.from("portal_sessions").insert({ token, user_id: user.id });
    if (se) return page("Could not create your session", `<p>${esc(se.message)}</p>`, 500, flow.return_to);

    await sb.from("portal_users")
      .update({ last_login_at: new Date().toISOString(), last_login_ip: req.headers.get("x-forwarded-for") || null })
      .eq("id", user.id);

    // Handed over in the URL fragment: fragments are not sent to servers and stay out of access logs,
    // Referer headers and the Supabase request log. The page stores it and strips it immediately.
    const dest = `${flow.return_to}#sso_token=${encodeURIComponent(token)}`;
    return Response.redirect(dest, 302);
  }

  return page("Not found", `<p>No such SSO route.</p>`, 404);
});
