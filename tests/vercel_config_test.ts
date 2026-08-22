// vercel.json is the ONE origin, and it is the one file in this repo whose defects surface only in
// front of staff, on cutover day, all at once.
//
// WHY ONE ORIGIN IS THE WHOLE POINT: the sign-in session is `localStorage['ctg_portal_token']`, which is
// scoped per ORIGIN. Serve the two legacy single-file apps and the built React routes from two hosts and
// they become two separate logins on two live copies of the same data-entry UI — an employee clocks in on
// one and the other does not reflect it. That is what this config exists to prevent, and it is the same
// reason `tools/serve_both.ts` exists as the local rig: repo-root files first, `web/out` for the rest.
// The deploy reproduces that ordering by COPYING the legacy files over the export AFTER the build, so
// the legacy file wins the same collisions it wins locally (`/` is index.html's redirect, not the
// React landing page).
//
// Nothing here can prove what Vercel's CDN does — that is a preview-deploy check, listed in CLAUDE.md.
// What IS provable offline is that the file still says what it was written to say, and the two things
// most likely to rot are pinned against the legacy apps' OWN text rather than a retyped list.

import { assert, assertEquals } from "jsr:@std/assert@1";

const root = (p: string) => new URL("../" + p, import.meta.url);
const cfg = JSON.parse(await Deno.readTextFile(root("vercel.json")));
const HTML = ["app.html", "hros.html", "index.html"];

/** The shell globs `buildCommand` copies into the export, as `*.html *.js *.png` → matchers. */
function copyGlobs(): RegExp[] {
  const cp = cfg.buildCommand.match(/\bcp\s+([^&|]+?)\s+web\/out\/?/);
  assert(cp, "buildCommand no longer contains a `cp ... web/out/` step:\n  " + cfg.buildCommand);
  return cp[1].trim().split(/\s+/).map((g: string) =>
    new RegExp("^" + g.replace(/[.]/g, "\\.").replace(/\*/g, "[^/]*") + "$")
  );
}

Deno.test("the export directory is what Vercel serves, and the legacy files are copied in AFTER it", () => {
  assertEquals(cfg.outputDirectory, "web/out");
  const b: string = cfg.buildCommand;
  const build = b.indexOf("npm run build");
  const copy = b.search(/\bcp\b/);
  assert(build >= 0, "the build no longer builds the React app: " + b);
  assert(copy > build, "the legacy copy must run AFTER `npm run build` — the export wipes web/out, so a\n" +
    "copy that ran first would be deleted and every legacy URL would 404:\n  " + b);
});

Deno.test("the copy is by GLOB, so a new shared .js file ships without anyone editing this file", () => {
  // The lesson is ci.yml's `cp common.js` step, which is by NAME and covers exactly one file — CLAUDE.md
  // calls that a gap. Nine root .js files have been added since (payroll, hr-docs, wht, o2o, salesrecon,
  // gateway, pnl, ap …). A by-name list here would mean the tenth one 404s in production only.
  const globs = copyGlobs();
  assert(globs.some((g) => g.test("a-file-nobody-has-written-yet.js")),
    "the copy step no longer covers *.js by glob — a shared file added later would not ship");
});

Deno.test("every root asset the legacy apps load is covered by the copy step", async () => {
  // Read out of the apps' own markup at run time: a retyped list agrees with a broken config by
  // construction. Only same-directory relative refs are ours to ship (no scheme, no /, no #, no data:).
  const globs = copyGlobs();
  const missing: string[] = [];
  let seen = 0;
  for (const f of HTML) {
    const html = await Deno.readTextFile(root(f));
    for (const m of html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
      const ref = m[1];
      if (!/^[\w.-]+\.[a-z0-9]+$/i.test(ref)) continue;   // skips http(s):, //, /, #, data:, ?, sub/dirs
      seen++;
      if (!globs.some((g) => g.test(ref))) missing.push(f + " loads " + ref);
    }
  }
  assert(seen > 10, "the reference matcher found almost nothing (" + seen + ") — it is broken, and\n" +
    "'nothing to check' would read as a pass while xlsx.full.min.js sat unshipped");
  assertEquals([...new Set(missing)], [], "these are loaded by a legacy app but are not copied into the export");
});

Deno.test("nothing unhashed may be cached immutably, and the hashed assets must be", () => {
  // The legacy files are served BY FILENAME with no content hash: `app.html` and `common.js` keep their
  // names across every deploy. Cache one immutably and staff keep running the previous copy with no way
  // to tell and nothing to clear. The React build's own assets are the opposite case — the filename
  // contains the hash, so a changed file is a changed URL and a year is correct.
  const rules: any[] = cfg.headers;
  for (const r of rules) {
    const cc = r.headers.find((h: any) => h.key.toLowerCase() === "cache-control");
    if (!cc) continue;
    if (/immutable|max-age=(?!0\b)/.test(cc.value)) {
      assert(r.source.startsWith("/_next/static/"),
        "long-lived caching on `" + r.source + "` — only content-hashed paths may carry it: " + cc.value);
    }
  }
  const hashed = rules.find((r) => r.source.startsWith("/_next/static/"));
  assert(hashed, "the hashed React assets have lost their immutable rule — every deploy re-downloads them");
  const broad = rules.find((r) => r.source === "/(.*)");
  const bcc = broad?.headers.find((h: any) => h.key.toLowerCase() === "cache-control");
  assert(bcc && /must-revalidate/.test(bcc.value),
    "the catch-all rule must make the browser revalidate, or a deploy does not reach an open tab");
});

Deno.test("frame-ancestors is delivered as a RESPONSE header, which is the only way it works", () => {
  // app.html:14 already declares `frame-ancestors 'none'` — inside a <meta http-equiv> CSP, where the
  // spec says it is IGNORED. So the Finance app has never actually been frame-protected, and hros.html
  // and the React routes declare nothing at all. One response header delivers it for all three.
  const broad = cfg.headers.find((r: any) => r.source === "/(.*)");
  const csp = broad?.headers.find((h: any) => h.key.toLowerCase() === "content-security-policy");
  assert(csp && /frame-ancestors\s+'none'/.test(csp.value), "frame-ancestors 'none' is gone from the headers");
  // Deliberately frame-ancestors ONLY. app.html's meta CSP is tuned to app.html; hros.html and the React
  // app were never built under one. Sending app.html's full policy to all three would be a cutover-day
  // white screen on the two that have never run under it. Widening this is a decision, not a tidy-up.
  assertEquals(csp.value.trim(), "frame-ancestors 'none'");
});

Deno.test("no rewrite, redirect or function may sit in front of the backend", () => {
  // The backend is the Supabase edge function `portal` and it is not moving: Xero webhooks, Supabase
  // cron and inbound email all hold its URL. A proxy here would be a second server in front of it,
  // buying nothing and adding a failure mode — and `output: 'export'` has no server to run one on.
  for (const k of ["rewrites", "redirects", "functions", "crons", "regions"]) {
    assert(!(k in cfg), "vercel.json has grown `" + k + "` — see web/next.config.mjs's header");
  }
  assert(!/supabase|functions\/v1/.test(JSON.stringify(cfg)), "vercel.json names the backend");
});
