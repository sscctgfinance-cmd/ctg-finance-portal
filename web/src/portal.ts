// The session and the backend, for the React half.
//
// ── The session is NOT bridged, and must not be ────────────────────────────────────────────────────
// `app.html` and `hros.html` share a login today by both reading `localStorage['ctg_portal_token']` on
// one origin. This file reads THE SAME KEY. That is the whole mechanism: serve the React app from the
// same origin as the legacy files and it is already signed in, with no token passing, no cookie, no
// callback and nothing to keep in sync. If you find yourself adding an auth bridge here, the origin is
// wrong — fix that instead.
//
// ── The backend does not move ──────────────────────────────────────────────────────────────────────
// Everything is one authenticated POST to the Supabase edge function `portal`. There is no `app/api/`
// and there will not be: Xero webhooks, Supabase cron, inbound email and Web Push all hold that URL, so
// a second server in front of it would add a failure mode and buy nothing.

/** `API` — hros.html:1146. Overridable so a staging function can be pointed at without a code change. */
export const API = process.env.NEXT_PUBLIC_PORTAL_API
  || 'https://cmostxcjtbuhbzfojuid.supabase.co/functions/v1/portal';

/** The one place a base path is read; `next.config.mjs` is the one place it is set. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

/**
 * A URL for one of the legacy single-file apps. They keep their served paths forever — those are baked
 * into the SSO return allow-list, five staff-facing emails, the service worker's scope and every
 * bookmark — so this only ever prefixes the configured base path.
 */
export function legacyUrl(file: string): string {
  return `${BASE_PATH}/${file}`;
}

/**
 * `STORAGE_OK` — app.html:1226. Safari in private mode and a locked-down browser both make
 * `localStorage` throw, and `token()` below swallows exactly that into `''`: the operator signs in,
 * works, refreshes, and is signed out again with nothing on screen explaining why. app.html:1421 warns;
 * this is the same probe, so `app/finance/layout.tsx` can warn too.
 */
export function storageOk(): boolean {
  try {
    const k = '__ctg_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function token(): string {
  try {
    return localStorage.getItem('ctg_portal_token') || '';
  } catch {
    return '';   // Safari in private mode throws on localStorage; the legacy files guard the same way.
  }
}

/**
 * Session-expired path — the React equivalent of app.html:1378's `handleSessionExpired()`. There is no
 * modal to show from a pure module, so this does what the modal's one button does: clear the dead token
 * and send the operator back to sign in. Guarded so a burst of failing calls redirects once.
 * Deliberately still NO retry — see common.js's `call()` and tests/retry_safety_test.ts: a bad-gateway
 * or gateway-timeout status can mean the slow Xero-bound POST already ran, so repeating it is unsafe.
 */
let sessionExpiredShown = false;
function handleSessionExpired(): void {
  if (sessionExpiredShown) return;
  sessionExpiredShown = true;
  try { localStorage.removeItem('ctg_portal_token'); } catch { /* private mode */ }
  location.href = `${BASE_PATH}/index.html`;
}

/**
 * One POST to the edge function. Matches common.js's `call()` for its three resilience behaviours: a 30s
 * abort timeout, session-expired detection on 401/unauthorized, and friendly messages for timeout and
 * network failure. No retry and no toast queue — a migrated screen surfaces its own error.
 */
export async function call<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const reqToken = body.token !== undefined ? body.token : token();
  const isAuthExempt = body.api === 'login' || body.api === 'login_2fa';
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(API, {
      method: 'POST',
      body: JSON.stringify({ token: token(), ...body }),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => null);
    // Session expired: we sent a token and the server rejected it → the token died.
    const isUnauth = r.status === 401 || (data && data.ok === false && data.error === 'unauthorized');
    if (isUnauth && reqToken && !isAuthExempt) {
      handleSessionExpired();
      throw new Error('Session expired — please sign in again');
    }
    if (!r.ok || !data) throw new Error((data && data.error) || `Server returned ${r.status}`);
    if (data.ok === false) throw new Error(data.error || 'Request failed');
    return data as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('Request timed out — server or Xero is slow, please retry');
    }
    if (e instanceof TypeError) throw new Error('Network error — check your connection and retry');
    throw e;
  } finally {
    clearTimeout(tm);
  }
}
