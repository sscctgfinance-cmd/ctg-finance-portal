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

export function token(): string {
  try {
    return localStorage.getItem('ctg_portal_token') || '';
  } catch {
    return '';   // Safari in private mode throws on localStorage; the legacy files guard the same way.
  }
}

/**
 * One POST to the edge function. Deliberately much smaller than common.js's `call()`: no retry, no
 * session-expired modal, no toast queue — those belong to the app shell, and the shell is still the
 * legacy one. A migrated screen surfaces its own error, which is what the caller does here.
 */
export async function call<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch(API, {
    method: 'POST',
    body: JSON.stringify({ token: token(), ...body }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data) throw new Error((data && data.error) || `Server returned ${r.status}`);
  if (data.ok === false) throw new Error(data.error || 'Request failed');
  return data as T;
}
