/**
 * The React half of ctg-finance-portal. See ../CLAUDE.md ("The React app lives in web/").
 *
 * `output: 'export'` is NOT forced any more — that was a GitHub Pages consequence and Pages is being
 * retired in favour of Vercel, which runs a server. It is kept because it costs one line and buys the
 * thing this pilot has to prove: an exported build is a plain directory of files, so `tools/serve_both.ts`
 * can serve it and the legacy `hros.html` from ONE origin, which is the arrangement the shared
 * `localStorage['ctg_portal_token']` session depends on — and the arrangement Vercel will have too
 * (`public/` + the built routes, one origin). Drop this line the day a screen genuinely needs a server;
 * nothing else in here assumes it. Response headers (`frame-ancestors`) go in vercel.json either way,
 * because `next.config` `headers()` is inert under `export`.
 *
 * Deliberately absent, and to stay absent: `app/api/`, server components, middleware. The backend is the
 * Supabase edge function `portal` and it is not moving — Xero webhooks, cron, inbound email and Web Push
 * all hold its URL. A second server in front of it buys nothing.
 */

// The ONE place a base path is configured. Vercel on a custom domain serves from `/` (the default here).
// A sub-path host — GitHub Pages at /ctg-finance-portal/, or a preview mounted under a prefix — sets
// NEXT_PUBLIC_BASE_PATH and nothing else changes: every internal link goes through next/link or
// `basePath()` in src/portal.ts, and there is not one root-absolute path written by hand.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** @type {import('next').NextConfig} */
export default {
  output: 'export',
  trailingSlash: true,   // → out/hr/access/index.html, which any plain static server resolves
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};
