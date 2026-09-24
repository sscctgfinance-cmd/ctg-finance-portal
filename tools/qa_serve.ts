// Drive the two legacy apps in a REAL browser against the render fixtures, with no build step and no
// production credentials.
//
// WHY THIS IS NOT tools/serve_both.ts: that one serves the React export too and refuses to start until
// `web/out` exists, which is a full Next build. When the thing under test is a legacy button — and the
// documented blind spot of this repo is that "a golden never presses a button" — a several-minute build
// to reach hros.html is the reason the check does not get run.
//
// Two details that cost a diagnosis each when they were missing:
//   - The API constant is rewritten to a SAME-ORIGIN path. app.html ships a meta CSP with
//     `connect-src 'self'`, so an absolute http://127.0.0.1:PORT/... is refused and the app sits on its
//     login screen looking like a broken fixture server.
//   - Every `<script src>` gets a per-boot `?v=`, and responses are `no-store`. A stale common.js is
//     indistinguishable from a fix that did not work.
import { FIXTURES, COMPANIES } from "../tests/render_fixtures.ts";

const PORT = Number(Deno.env.get("QA_PORT") || 8791);
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const BOOT = Date.now().toString(36);
const PAGES = ["app.html", "hros.html", "index.html"];

/** Rewrite one page so it talks to us instead of to production. */
function patch(src: string): string {
  const before = src;
  src = src.replace(/(const|var|let)\s+API\s*=\s*["'][^"']+["']/g, '$1 API="/__fixtures/portal"');
  if (src === before) console.warn("  !! API constant not patched — the app will call production");
  return src.replace(/(<script src=")([^"?]+\.js)(")/g, `$1$2?v=${BOOT}$3`);
}

const unfixtured = new Set<string>();

Deno.serve({ port: PORT, hostname: "127.0.0.1" }, async (req) => {
  const p = new URL(req.url).pathname;

  if (p === "/__fixtures/portal") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const api = String(body.api || "");
    // An action nobody expected the screen to call is itself a finding, so it is answered `ok` (to let
    // the flow continue) and recorded rather than silently 404'd.
    let data = api === "hr_companies" ? { ok: true, companies: COMPANIES } : (FIXTURES as Record<string, unknown>)[api];
    if (!data) { unfixtured.add(api); data = { ok: true, _stub: true }; }
    console.log(`  POST ${api}${(data as { _stub?: boolean })._stub ? "   [stub]" : ""}`);
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  }

  const name = p === "/" ? "index.html" : p.slice(1);
  if (name.includes("..")) return new Response("no", { status: 400 });
  let body: Uint8Array | string;
  try {
    body = PAGES.includes(name)
      ? patch(await Deno.readTextFile(ROOT + name))
      : await Deno.readFile(ROOT + name);
  } catch { return new Response("not found: " + name, { status: 404 }); }

  const ext = name.slice(name.lastIndexOf("."));
  const type = ext === ".html" ? "text/html; charset=utf-8"
    : ext === ".js" ? "text/javascript; charset=utf-8"
    : ext === ".css" ? "text/css; charset=utf-8"
    : ext === ".png" ? "image/png"
    : "application/octet-stream";
  return new Response(body, { headers: { "content-type": type, "cache-control": "no-store" } });
});

console.log(`QA harness  http://127.0.0.1:${PORT}/app.html   and  /hros.html`);
addEventListener("unload", () => {
  if (unfixtured.size) console.log("actions with no fixture:", [...unfixtured].join(", "));
});
