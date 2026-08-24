// The runtime-error beacon for the React half — the mirror of hros.html:1155-1186.
//
// ── Why this exists ────────────────────────────────────────────────────────────────────────────────
// The two legacy single-file apps were invisible when they threw: an employee saw a dead button, the
// operator heard about it on WhatsApp days later, if at all. hros.html installs a beacon that POSTs
// uncaught errors and rejections to the (deliberately unauthenticated) `client_error` endpoint. The
// React app shipped with NO global handler, no `error.tsx`, no `unhandledrejection` listener and never
// posted `client_error` — report.md §F5. This closes that gap.
//
// ── The one deviation from the legacy beacon: NO TOKEN ─────────────────────────────────────────────
// Captain's decision (2026-08-24): mirror message/stack/page/tenant but strip the user's email. The
// server derives `user_email` (and `user_id`) from the `token` in the body — supabase/functions/portal/
// index.ts:110 — so the way to keep the email out of the row is to not send the token at all. hros.html
// sends it; the React beacon deliberately does not. `tests/beacon.test.tsx` pins that the body carries
// no token/email.
//
// Fire-and-forget, capped and deduped, exactly as the legacy is: a beacon must never make a bad
// situation worse. `keepalive` so a boot-time crash's report survives the navigation that follows it.

import { API } from './portal';

const MAX_PER_LOAD = 8; // one bad render loop must not flood the endpoint

let installed = false;
let beaconApp = 'react';
let beaconTenant: string | null = null;
let sent = 0;
const seen = new Set<string>();

/** Set by each app's layout: which app fired, and the current tenant (best-effort, as HR.tenant is). */
export function setBeaconContext(app: string, tenant: string | null): void {
  beaconApp = app;
  beaconTenant = tenant || null;
}

/**
 * The POST body — pure, so the test can pin its shape. Mirrors hros.html:1163-1169 field for field,
 * MINUS `token` (see the header). Same 500/4000/300 caps the server applies anyway, applied here too so
 * a giant stack never rides the wire.
 */
export function beaconBody(kind: string, message: string, stack: string): Record<string, unknown> {
  return {
    api: 'client_error',
    app: beaconApp,
    kind,
    message: String(message).slice(0, 500),
    stack: String(stack || '').slice(0, 4000),
    page: location.pathname + location.hash,
    ua: navigator.userAgent,
    tenant: beaconTenant,
  };
}

function beacon(kind: string, message: string, stack: string): void {
  try {
    if (sent >= MAX_PER_LOAD) return;
    const key = String(message).slice(0, 200);
    if (seen.has(key)) return; // same error once per page load
    seen.add(key);
    sent++;
    void fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify(beaconBody(kind, message, stack)),
    }).catch(() => {}); // never surface a beacon failure to the user
  } catch { /* a beacon must never throw */ }
}

/** Install the two global listeners once. Idempotent — both layouts call it and it no-ops after the first. */
export function installBeacon(app: string): void {
  setBeaconContext(app, beaconTenant);
  if (installed) return;
  installed = true;
  addEventListener('error', (e) => {
    if (e && e.message) beacon('error', e.message, (e.error && e.error.stack) || '');
  });
  addEventListener('unhandledrejection', (e) => {
    const r = e && (e as PromiseRejectionEvent).reason;
    if (r) beacon('unhandledrejection', (r && r.message) || String(r), (r && r.stack) || '');
  });
}
