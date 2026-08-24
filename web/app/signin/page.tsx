'use client';

// The React sign-in page — its own top-level route, NOT under app/finance or app/hr (web/tests/
// shell.test.tsx:167-176 fails on any directory there that no nav.ts entry claims). The one auth surface
// React did not have: TOTP *enrolment* is ported (finance-security.tsx), but login-time password + 2FA
// verification lived only in common.js. This is doLogin()/submit2fa()/the SSO fragment consumer, ported.
//
// Everything impure is here — localStorage, the network, `location` — so src/signin.ts stays pure and
// unit-testable (signin.test.tsx). The markup mirrors app.html:1057-1086 / hros.html (byte-identical
// between the two apps), so one page's stylesheet serves both; app/signin/layout.tsx imports it.

import { useCallback, useEffect, useState } from 'react';

import PasswordHost from '../../src/password-modal';
import { BASE_PATH, call, token as readToken } from '../../src/portal';
import {
  CTG_SSO, loginBody, login2faBody, loginOutcome, normalize2faCode, parseSsoToken,
  routeForRole, ssoStartUrl, valid2faCode, type LoginResponse,
} from '../../src/signin';

/** The one write sign-in does — storageSet('ctg_portal_token', token), common.js:113/133. */
function storeToken(t: string): void {
  try { localStorage.setItem('ctg_portal_token', t); } catch { /* Safari private mode; login won't stick */ }
}

/** A full document navigation across the app boundary — /signin → /finance or /hr. spa-nav deliberately
 *  does not route between the two trees (they load different stylesheets), so this is never client-side. */
function go(route: string): void {
  location.assign(`${BASE_PATH}${route}`);
}

type Phase = 'form' | 'consuming' | 'changingpw';

export default function SignInPage() {
  const [phase, setPhase] = useState<Phase>('form');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  // The 2FA overlay — show2faPrompt()/submit2fa(), common.js:124.
  const [tfaToken, setTfaToken] = useState<string | null>(null);
  const [tfaCode, setTfaCode] = useState('');
  const [tfaErr, setTfaErr] = useState<string | null>(null);
  const [tfaBusy, setTfaBusy] = useState(false);

  // After a token lands, resolve the role (via `me` for SSO, or the login response for password) and
  // route on — unless the server said the password must change first.
  const [pendingRole, setPendingRole] = useState<string | undefined>(undefined);

  const routeOn = useCallback((role: string | undefined) => { go(routeForRole(role)); }, []);

  // ── SSO fragment consumer — app.html:1236-1243. Runs before anything reads storage. ──
  useEffect(() => {
    const t = parseSsoToken(location.hash);
    if (t) {
      storeToken(t);
      history.replaceState(null, '', location.pathname + location.search);
      setPhase('consuming');
      // No role in the fragment — ask the server, then route. must_change_pw is handled by the target
      // app's layout (both mount PasswordHost forced-on-mount), so SSO does not need to here.
      void call<{ user?: { role?: string } }>({ api: 'me' })
        .then((m) => routeOn(m?.user?.role))
        .catch(() => { setPhase('form'); setErr('Signed in, but could not load your account — please retry.'); });
      return;
    }
    // Already signed in (a bookmark straight to /signin) → skip the form.
    if (readToken()) {
      setPhase('consuming');
      void call<{ user?: { role?: string } }>({ api: 'me' })
        .then((m) => routeOn(m?.user?.role))
        .catch(() => setPhase('form'));
    }
  }, [routeOn]);

  // ── Reveal the SSO button only once CTG has issued an app_id — app.html:1245-1250. Any failure leaves
  //    it hidden; the password form is always the working path. ──
  useEffect(() => {
    fetch(`${CTG_SSO}/status`)
      .then((r) => r.json())
      .then((s) => { if (s && s.enabled) setSsoEnabled(true); })
      .catch(() => {});
  }, []);

  // ── Password login — doLogin(), common.js:107. ──
  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const r = await call<LoginResponse>(loginBody(email.trim(), pass));
      const o = loginOutcome(r);
      if (o.kind === 'ok') return finishToken(o.token, o.role, o.mustChangePw);
      if (o.kind === 'need_2fa') { setTfaToken(o.loginToken); setBusy(false); return; }
      if (o.kind === 'locked') {
        setErr(`🔒 Account locked after too many failed attempts. Try again in ${o.retryMinutes} min.`);
      } else {
        setErr('Incorrect email or password');
      }
    } catch {
      setErr('Connection failed, please retry');
    }
    setBusy(false);
  };

  // ── 2FA verify — submit2fa(), common.js:124. ──
  const submit2fa = async () => {
    setTfaErr(null);
    if (!valid2faCode(tfaCode)) { setTfaErr('Enter the 6-digit code from your authenticator app'); return; }
    setTfaBusy(true);
    try {
      const r = await call<LoginResponse>(login2faBody(tfaToken || '', normalize2faCode(tfaCode)));
      const o = loginOutcome(r);
      if (o.kind === 'ok') { setTfaToken(null); return finishToken(o.token, o.role, o.mustChangePw); }
      setTfaErr((r && r.error) || 'Incorrect code');
    } catch {
      setTfaErr('Network error, please retry');
    }
    setTfaBusy(false);
  };

  // Both success paths converge here — storeToken then either force the password change or route on.
  function finishToken(t: string, role: string | undefined, mustChangePw: boolean) {
    storeToken(t);
    if (mustChangePw) { setPendingRole(role); setPhase('changingpw'); return; }
    routeOn(role);
  }

  if (phase === 'consuming') {
    return (
      <div id="login">
        <div className="lbox"><div className="lbox-mark">CTG</div><p className="lbox-sub">Signing you in…</p></div>
      </div>
    );
  }

  return (
    <div id="login">
      {/* enterApp()'s forced branch — a one-time temporary password must be replaced before continuing.
          PasswordHost owns the changepw POST; onForcedDone routes on with the role we resolved at login. */}
      {phase === 'changingpw' ? (
        <PasswordHost
          forcedOnMount
          onSave={(oldp, neu) => call({ api: 'changepw', old: oldp, neu }).then(() => undefined)}
          onForcedDone={() => routeOn(pendingRole)}
        />
      ) : null}

      <form className="lbox" onSubmit={doLogin}>
        <div className="lbox-mark">CTG</div>
        <h1>Sign In to CTG Finance Portal</h1>
        <p className="lbox-sub">Strong Finances. Sharper Decisions.<br />Unstoppable Growth.</p>
        {err ? <div className="lerr" id="lerr">{err}</div> : null}
        <div className="lfield"><label>Email</label>
          <input type="email" id="email" placeholder="your@email.com" autoComplete="username" required
            value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="lfield"><label>Password</label>
          <input type="password" id="pass" placeholder="••••••••" autoComplete="current-password" required
            value={pass} onChange={(e) => setPass(e.target.value)} /></div>
        <button className="lbtn" type="submit" id="lbtn" disabled={busy}>{busy ? 'Signing in…' : 'Sign In'}</button>

        {ssoEnabled ? (
          <div id="ssoBox">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '16px 0 12px' }}>
              <span style={{ flex: 1, height: '1px', background: 'var(--border)' }}></span>
              <span style={{ color: 'var(--muted)', fontSize: '11px' }}>or</span>
              <span style={{ flex: 1, height: '1px', background: 'var(--border)' }}></span>
            </div>
            <button className="lbtn" type="button"
              style={{ background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--text)', boxShadow: 'none' }}
              onClick={() => { location.href = ssoStartUrl(); }}>Sign in with CTG Portal</button>
          </div>
        ) : null}

        <div className="lfoot"><b>CTG</b> &nbsp;·&nbsp; Invite-only · Contact your admin for access</div>
      </form>

      {/* show2faPrompt() — app.html:1395-1400, as a React overlay rather than insertAdjacentHTML. */}
      {tfaToken ? (
        <div className="overlay" id="tfa_overlay">
          <div className="modal" style={{ width: '380px' }}>
            <div className="modal-hd"><h3>🔐 Two-factor verification</h3></div>
            <p className="muted" style={{ fontSize: '12.5px', margin: '0 0 14px', lineHeight: 1.6 }}>
              Open your authenticator app (Google Authenticator, Authy, 1Password…) and enter the 6-digit
              code for <b>CTG Finance Portal</b>.</p>
            <div className="fld"><label>6-digit code</label>
              <input id="tfa_code" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={7}
                autoComplete="one-time-code" placeholder="000000" autoFocus
                style={{ textAlign: 'center', fontSize: '22px', letterSpacing: '8px', fontVariantNumeric: 'tabular-nums' }}
                value={tfaCode} onChange={(e) => setTfaCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit2fa(); }} /></div>
            {tfaErr ? <div className="lerr" id="tfa_err">{tfaErr}</div> : null}
            <div className="modal-ft">
              <button className="btn" type="button" onClick={() => { setTfaToken(null); setTfaCode(''); setTfaErr(null); }}>Cancel</button>
              <button className="btn p" id="tfa_btn" type="button" disabled={tfaBusy} onClick={submit2fa}>{tfaBusy ? 'Verifying…' : 'Verify'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
