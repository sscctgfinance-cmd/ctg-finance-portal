// Serve the legacy single-file apps AND the built React app from ONE origin.
//
//   deno run -A tools/serve_both.ts            # http://127.0.0.1:8765
//   deno run -A tools/serve_both.ts 9000
//
// Build the React side first:
//
//   cd web && npm install && npm run build                       # talks to the real edge function
//   cd web && NEXT_PUBLIC_PORTAL_API=http://127.0.0.1:8765/__fixtures/portal npm run build
//                                                                 # talks to the fixtures below instead
//
// WHY ONE SERVER AND NOT TWO: the session is `localStorage['ctg_portal_token']`, which is per-origin.
// Two ports are two origins, so a second server would mean signing in twice and would "prove" nothing
// about the property the whole strangler rests on. Sign in once on /hros.html and /hr/access/ is already
// signed in — that is the thing to check, and it only means anything on one port.
//
// LEGACY FILES WIN. A path that exists at the repo root is served from the repo root; only what is left
// falls through to web/out. That ordering is deliberate and it mirrors Vercel, where `public/` is served
// ahead of the app's routes — so `public/index.html` will shadow the React root route there too, once the
// hosting move puts the legacy files in `public/`. Better to find that out here than in production.
//
// This is a development tool. It is not the deploy: Vercel builds the app from the repo on push.

// It also answers POSTs at /__fixtures/portal from tests/render_fixtures.ts — the same canned responses
// the 40 goldens were captured from. That exists so the React app can be driven end to end WITHOUT
// production credentials and without pointing a browser at the live edge function: point the app at it
// with NEXT_PUBLIC_PORTAL_API and the screen renders exactly the data its golden holds, which also makes
// a screenshot of it directly comparable to a screenshot of the legacy screen. It echoes back the token
// it was sent, which is what turns "the React app is signed in" from an assumption into a check.
// It is NOT a backend: no auth, no writes, no persistence. Nothing outside this dev tool references it.

import { serveDir } from "jsr:@std/http@1/file-server";
import { COMPANIES, FIXTURES } from "../tests/render_fixtures.ts";

const REPO = new URL("..", import.meta.url).pathname;
const OUT = REPO + "web/out";

const port = Number(Deno.args[0] || 8765);

async function fixtureReply(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { api?: string; token?: string };
  const api = body.api || "";
  // `hr_companies` has no golden fixture — no surface renders it, the company picker is chrome — so it is
  // answered from the same COMPANIES list every other HR fixture is scoped against. Still not new data.
  const data = api === "hr_companies"
    ? { ok: true, companies: COMPANIES }
    : FIXTURES[api];
  if (!data) return Response.json({ ok: false, error: `no fixture for api "${api}"` }, { status: 404 });
  // `saw_token` is the point of this endpoint: it reports which session token the caller actually sent.
  return Response.json({ ...data, saw_token: body.token || "" });
}

try {
  Deno.statSync(OUT);
} catch {
  console.error(`No build at ${OUT}\n  cd web && npm install && npm run build`);
  Deno.exit(1);
}

Deno.serve({ port, hostname: "127.0.0.1" }, async (req) => {
  if (new URL(req.url).pathname === "/__fixtures/portal") {
    if (req.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*" } });
    return await fixtureReply(req);
  }
  const legacy = await serveDir(req, { fsRoot: REPO, quiet: true });
  if (legacy.status !== 404) return legacy;
  return await serveDir(req, { fsRoot: OUT, quiet: true });
});

console.log(`  legacy  http://127.0.0.1:${port}/hros.html      (and app.html, index.html, the vendored libs)`);
console.log(`  react   http://127.0.0.1:${port}/hr/access/     — same origin, so the same session`);
