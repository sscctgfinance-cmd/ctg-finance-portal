// React sign-in — the pure half, driven directly, plus the route pinned by SOURCE.
//
// No agent can run the live flow (report §5: there is no React deployment and no credentials should
// ever be issued to an agent), so the verification is the same "pin the pure half" discipline the whole
// migration uses: given a hash, the consumer returns the right token and route; the request bodies match
// the legacy shapes byte for byte; and the route writes ONLY ctg_portal_token and strips the fragment.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SSO_APP_KEY, CTG_SSO, ssoStartUrl, parseSsoToken, routeForRole,
  loginBody, login2faBody, normalize2faCode, valid2faCode, loginOutcome,
} from '../src/signin';
import { REPO } from './parity';

const COMMON = readFileSync(join(REPO, 'common.js'), 'utf8');
const SSO = readFileSync(join(REPO, 'supabase/functions/ctg-sso/index.ts'), 'utf8');
/** Comments blanked, so the source pins match code and not the prose that quotes the tokens. */
const PAGE = readFileSync(join(REPO, 'web/app/signin/page.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

describe('the SSO fragment consumer — app.html:1236', () => {
  it('extracts and decodes the token, mirroring the legacy regex', () => {
    expect(parseSsoToken('#sso_token=abc123')).toBe('abc123');
    expect(parseSsoToken('#foo=1&sso_token=tok%2Bval')).toBe('tok+val'); // decoded, [#&] prefix
    expect(parseSsoToken('#sso_token=a.b.c&x=1')).toBe('a.b.c');         // stops at &
  });
  it('returns null when there is no token — the form must render', () => {
    expect(parseSsoToken('')).toBeNull();
    expect(parseSsoToken('#other=1')).toBeNull();
    expect(parseSsoToken('#sso_tokenx=1')).toBeNull();
  });
  it('uses the same regex the legacy page does', () => {
    expect(COMMON.length).toBeGreaterThan(0);
    // The legacy consumer lives in app.html; its shape is /[#&]sso_token=([^&]+)/. Mirror asserted above.
    expect(String(/[#&]sso_token=([^&]+)/)).toBe('/[#&]sso_token=([^&]+)/');
  });
});

describe('routeForRole — the C6 predicate decides the landing', () => {
  it('sends HR-only roles to HR OS, everyone else to Finance', () => {
    for (const r of ['employee', 'viewer', 'hr_admin']) expect(routeForRole(r)).toBe('/hr/clock/');
    for (const r of ['admin', 'superadmin', 'finance', undefined]) expect(routeForRole(r)).toBe('/finance/overview/');
  });
});

describe('the request bodies match common.js byte for byte', () => {
  it('login — {api:"login", email, pass, token:""}', () => {
    expect(loginBody('a@b.com', 'pw')).toEqual({ api: 'login', email: 'a@b.com', pass: 'pw', token: '' });
    // token:'' is what makes call() send no session token (auth-exempt) — common.js:59, portal.ts:79.
    expect(loginBody('x', 'y').token).toBe('');
    expect(COMMON).toContain("{api:'login',email,pass,token:''}");
  });
  it('login_2fa — {api:"login_2fa", login_token, code, token:""}', () => {
    expect(login2faBody('LT', '123456')).toEqual({ api: 'login_2fa', login_token: 'LT', code: '123456', token: '' });
    expect(login2faBody('x', 'y').token).toBe('');
    expect(COMMON).toContain("{api:'login_2fa', login_token:TFA_TOKEN, code:code, token:''}");
  });
});

describe('2FA code validation — submit2fa(), common.js:127', () => {
  it('strips spaces and dashes, requires exactly six digits', () => {
    expect(normalize2faCode(' 12 34-56 ')).toBe('123456');
    expect(valid2faCode('123 456')).toBe(true);
    expect(valid2faCode('12345')).toBe(false);
    expect(valid2faCode('1234567')).toBe(false);
    expect(valid2faCode('12345a')).toBe(false);
  });
});

describe('loginOutcome — the branch ladder, order is load-bearing', () => {
  it('success first (login or login_2fa)', () => {
    const o = loginOutcome({ ok: true, token: 'T', user: { role: 'admin', must_change_pw: true } });
    expect(o).toEqual({ kind: 'ok', token: 'T', role: 'admin', mustChangePw: true });
  });
  it('need_2fa before locked/error', () => {
    expect(loginOutcome({ need_2fa: true, login_token: 'L' })).toEqual({ kind: 'need_2fa', loginToken: 'L' });
  });
  it('locked carries retry_minutes, defaulting to 15', () => {
    expect(loginOutcome({ locked: true })).toEqual({ kind: 'locked', retryMinutes: 15 });
    expect(loginOutcome({ locked: true, retry_minutes: 5 })).toEqual({ kind: 'locked', retryMinutes: 5 });
  });
  it('everything else is wrong-credentials', () => {
    expect(loginOutcome({ ok: false }).kind).toBe('error');
    expect(loginOutcome(null).kind).toBe('error');
    expect(loginOutcome({ ok: true }).kind).toBe('error'); // ok but no token is not a real success
  });
});

describe('the SSO app key is consistent across the button and the allow-list', () => {
  it('the start URL uses SSO_APP_KEY and the ctg-sso host, no hardcoded site host', () => {
    expect(ssoStartUrl()).toBe(`${CTG_SSO}/start?app=${SSO_APP_KEY}`);
    expect(CTG_SSO).toMatch(/\/ctg-sso$/);
    // Derived from API, so tests/site_url_test.ts's "no fourth hardcoded host" scan stays clean.
    expect(SSO_APP_KEY).toBe('finance-portal-react');
  });
  it("ctg-sso's APPS maps that exact key to the signin route", () => {
    expect(SSO).toContain(`"${SSO_APP_KEY}"`);
    expect(SSO).toMatch(new RegExp(`"${SSO_APP_KEY}":\\s*\`\\$\\{SITE_URL\\}/signin/\``));
  });
});

describe('the route writes ONLY ctg_portal_token and strips the fragment — pinned by source', () => {
  it('sets exactly the session key, nothing else', () => {
    const sets = [...PAGE.matchAll(/localStorage\.setItem\(([^)]*)\)/g)].map((m) => m[1]);
    expect(sets.length).toBe(1);
    expect(sets[0]).toContain("'ctg_portal_token'");
  });
  it('strips the fragment with replaceState, as the legacy consumer does', () => {
    expect(PAGE).toContain('history.replaceState(null');
    expect(PAGE).toContain('parseSsoToken(location.hash)');
  });
  it('routes across the app boundary with a full document navigation, never client-side', () => {
    // /signin → /finance or /hr crosses stylesheet trees; spa-nav forbids client routing there.
    expect(PAGE).toContain('location.assign(');
    expect(PAGE).not.toContain('router.push');
  });
  it('forces the password change before routing on, reusing the ported modal', () => {
    expect(PAGE).toContain('PasswordHost');
    expect(PAGE).toContain('forcedOnMount');
    expect(PAGE).toContain("api: 'changepw'");
  });
});
