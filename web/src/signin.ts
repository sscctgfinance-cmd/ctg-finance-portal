// React sign-in — the pure half. Everything with one right answer lives here so it can be driven
// without a browser (the bankFile()/profileBody() split the repo uses everywhere); the impure route is
// app/signin/page.tsx.
//
// Two ways in, one shared write, exactly as the legacy apps do it in common.js:
//   · PASSWORD — doLogin() (common.js:107) → {api:'login'}, with submit2fa() (common.js:124) →
//     {api:'login_2fa'} for the need_2fa branch.
//   · SSO — ctgSsoSignIn() (common.js:34) → ctg-sso/start?app=<key>; the callback returns the session
//     token in the URL fragment (#sso_token=), which app.html:1236 consumes and strips.
// Both end at storageSet('ctg_portal_token', token). React writes exactly that one key (portal.ts).

import { API } from './portal';
import { isHrOnly } from './finance-hr-only-gate';

/**
 * The SSO app key. The signin button navigates to `ctg-sso/start?app=<this>`, and the ctg-sso `APPS`
 * allow-list (supabase/functions/ctg-sso/index.ts) maps it to `${SITE_URL}/signin/` — so the callback
 * returns here with the token in the fragment. The two must name the same string; this const is the one
 * place the React side spells it.
 */
export const SSO_APP_KEY = 'finance-portal-react';

/**
 * `CTG_SSO` — the ctg-sso function base. app.html:1235 hard-codes the Supabase host; here it is derived
 * from `API` (`.../functions/v1/portal` → `.../functions/v1/ctg-sso`) so the host is written nowhere in
 * web/ — tests/site_url_test.ts fails on a fourth hardcoded copy, and this keeps that promise.
 */
export const CTG_SSO = API.replace(/\/portal$/, '/ctg-sso');

/** `ctgSsoSignIn(app)` — common.js:34. A real document navigation; it leaves the origin. */
export function ssoStartUrl(appKey: string = SSO_APP_KEY): string {
  return `${CTG_SSO}/start?app=${encodeURIComponent(appKey)}`;
}

/**
 * The fragment consumer — app.html:1236-1243, as a pure function. Given a URL hash, returns the token to
 * store, or null if there is no `#sso_token=`. Decoding matches the legacy regex exactly.
 */
export function parseSsoToken(hash: string): string | null {
  const m = /[#&]sso_token=([^&]+)/.exec(hash || '');
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Where a signed-in user lands. The two legacy files are two URLs, so a user self-selects Finance vs HR
 * by which page they opened; one React signin page must choose. Routes by role against `isHrOnly`
 * (finance-hr-only-gate.tsx, the C6 predicate) — HR-only roles to HR OS, everyone else to Finance.
 *
 * `/hr/` and `/finance/` have no index route, so a concrete landing screen is named. `/finance/overview/`
 * is Finance's default tab (app.html's `showApp()`); `/hr/clock/` is the one HR screen every HR-only role
 * can use. ponytail: universal HR landing; the HR shell nav takes admins onward from there.
 */
export function routeForRole(role: string | undefined): string {
  return isHrOnly(role) ? '/hr/clock/' : '/finance/overview/';
}

/** `doLogin()`'s POST — common.js:112, `{api:'login', email, pass, token:''}`. The empty token is what
 *  makes `call()` treat it as auth-exempt and send no session token (portal.ts, common.js:59). */
export function loginBody(email: string, pass: string): Record<string, unknown> {
  return { api: 'login', email, pass, token: '' };
}

/** `submit2fa()`'s POST — common.js:130, `{api:'login_2fa', login_token, code, token:''}`. */
export function login2faBody(loginToken: string, code: string): Record<string, unknown> {
  return { api: 'login_2fa', login_token: loginToken, code, token: '' };
}

/** `submit2fa()`'s pre-flight — common.js:127. Strips spaces/dashes, requires exactly six digits. */
export function normalize2faCode(raw: string): string {
  return (raw || '').replace(/\s|-/g, '');
}
export function valid2faCode(raw: string): boolean {
  return /^\d{6}$/.test(normalize2faCode(raw));
}

/** The shape `portal_login` (finance.ts:542) can return. */
export interface LoginResponse {
  ok?: boolean;
  token?: string;
  user?: { name?: string; email?: string; role?: string; must_change_pw?: boolean };
  companies?: unknown[];
  need_2fa?: boolean;
  login_token?: string;
  locked?: boolean;
  retry_minutes?: number;
  error?: string;
}

export type LoginOutcome =
  | { kind: 'ok'; token: string; role: string | undefined; mustChangePw: boolean }
  | { kind: 'need_2fa'; loginToken: string }
  | { kind: 'locked'; retryMinutes: number }
  | { kind: 'error' };

/**
 * `doLogin()`'s branch ladder — common.js:113-117 — as a pure classifier. Order is load-bearing:
 * success first, then need_2fa, then locked, else wrong-credentials. `login_2fa` success reuses the 'ok'
 * branch (submit2fa, common.js:132-137).
 */
export function loginOutcome(r: LoginResponse | null): LoginOutcome {
  if (r && r.ok && r.token) {
    return { kind: 'ok', token: r.token, role: r.user?.role, mustChangePw: !!r.user?.must_change_pw };
  }
  if (r && r.need_2fa && r.login_token) return { kind: 'need_2fa', loginToken: r.login_token };
  if (r && r.locked) return { kind: 'locked', retryMinutes: r.retry_minutes || 15 };
  return { kind: 'error' };
}
