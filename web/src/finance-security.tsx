'use client';

// 🔐 Account security — the TOTP (Google Authenticator) self-service dialog.
//
// A port of `openSecurityModal()` / `start2faEnroll()` / `finish2faEnroll()` / `disable2fa()`
// (app.html:2538-2606), element for element. Until now the React shell rendered a `🔐 Security` ANCHOR
// into app.html: an operator who wanted to turn 2FA on left the app to do it.
//
// ── FINANCE ONLY, BECAUSE THAT IS WHERE THE LEGACY CONTROL IS ──────────────────────────────────────
// The brief said both shells carry this button. They do not: app.html:1104 has it and hros.html's
// sidebar foot (hros.html:1119-1123) has no security control at all — the React HR shell never rendered
// one either. TOTP is an ACCOUNT-level flag (`portal_users.totp_enabled`) and is enforced at both apps'
// login, so an HR-only member of staff cannot reach it in either world. Giving HR OS a button the legacy
// never had is a new feature, not a migration, so this is wired into the Finance shell only and the gap
// is named in the PR instead.
//
// ── THE PURE HALF IS THE WHOLE DIALOG; THE HOST OWNS ONLY THE STEP ─────────────────────────────────
// Same split as src/password-modal.tsx: `SecurityModal` is a pure function of its props so the three
// steps and every refusal can be driven without a browser, `SecurityHost` holds the step and calls the
// three async props the layout hands it, and `openSecurityModal()` is the legacy's own one-call opener.
//
// ── THE QR IMAGE SENDS THE SECRET TO A THIRD PARTY, AND THAT IS MIRRORED, NOT FIXED ────────────────
// app.html:2562 builds the QR by putting the whole `otpauth://` URL — which CONTAINS the shared secret —
// into a query string for `api.qrserver.com`. Every enrolment therefore hands one account's second
// factor to an unrelated host in plaintext. Fixing it means drawing the QR locally, i.e. a new vendored
// dependency, which is a decision above a migration; it is mirrored here so the two apps agree, and
// raised in the PR. `qrSrc()` is exported so the destination is pinned by a test rather than buried.

import { useEffect, useState } from 'react';

/** `start2faEnroll()`'s QR source — app.html:2562, verbatim including size and margin. */
export function qrSrc(otpauthUrl: string): string {
  return 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=' + encodeURIComponent(otpauthUrl);
}

/** `finish2faEnroll()` — app.html:2582. Spaces and dashes out, so a "123 456" reading pastes cleanly. */
export function enrollCode(raw: string): string {
  return (raw || '').replace(/\s|-/g, '');
}

/**
 * `finish2faEnroll()`'s local refusal — app.html:2584, with its exact wording.
 *
 * Returns the message, or null when the code may be POSTed. Pure because this is the gate that decides
 * whether `totp_verify_enroll` is called at all: a six-digit shape is the only thing worth a round trip,
 * and widening it would let a blank box enable nothing while looking like it tried.
 */
export function enrollCodeError(code: string): string | null {
  return /^\d{6}$/.test(code) ? null : 'Enter the 6-digit code from your app';
}

/** `{api:'totp_verify_enroll', code}` — app.html:2588. The code, and nothing else. */
export function verifyBody(code: string): Record<string, unknown> {
  return { api: 'totp_verify_enroll', code };
}

/**
 * `{api:'totp_disable', password}` — app.html:2604.
 *
 * The server re-authenticates (finance.ts:2482, `portal_verify_password`) so a borrowed session cannot
 * strip the second factor, which is why the password is in the body and not merely on the screen.
 */
export function disableBody(password: string): Record<string, unknown> {
  return { api: 'totp_disable', password };
}


/**
 * `finish2faEnroll()` — app.html:2581-2596 — as a function of its inputs and ONE injected effect.
 *
 * The host holds the step in `useState`; everything that DECIDES is here, so the property that matters
 * can be driven without a browser: `{ enabled: true }` is returned on exactly one path, after `verify`
 * has RESOLVED. A code that fails the six-digit shape never reaches `verify` at all, and a rejected one
 * comes back as an enrol step carrying the server's own message — never as success.
 */
export async function submitEnroll(
  step: Extract<SecStep, { kind: 'enroll' }>,
  verify: (code: string) => Promise<void>,
): Promise<{ enabled: true } | { step: Extract<SecStep, { kind: 'enroll' }> }> {
  const code = enrollCode(step.code);
  const bad = enrollCodeError(code);
  if (bad) return { step: { ...step, err: bad } };
  try {
    await verify(code);
    return { enabled: true };
  } catch (e) {
    return { step: { ...step, err: e instanceof Error && e.message ? e.message : 'Verification failed', verifying: false } };
  }
}

/**
 * `disable2fa()`'s second half — app.html:2599-2605 — the same shape as `submitEnroll` above.
 *
 * `{ enabled: false }` is reachable only after `disable` resolves, and `disable` is the ONLY caller of
 * `totp_disable`. The password is not validated here on purpose: `portal_verify_password`
 * (finance.ts:2482) is the authority, and a client-side length rule would refuse a correct password.
 */
export async function submitDisable(
  step: Extract<SecStep, { kind: 'disable' }>,
  disable: (password: string) => Promise<void>,
): Promise<{ enabled: false } | { step: Extract<SecStep, { kind: 'disable' }> }> {
  try {
    await disable(step.password);
    return { enabled: false };
  } catch (e) {
    return { step: { ...step, err: e instanceof Error && e.message ? e.message : 'Failed', busy: false } };
  }
}

/** The step the dialog is on. `status` is what `openSecurityModal()` opens on — app.html:2541. */
export type SecStep =
  | { kind: 'status' }
  | { kind: 'generating' }
  | { kind: 'failed'; message: string }
  | { kind: 'enroll'; secret: string; otpauthUrl: string; code: string; err: string | null; verifying: boolean }
  | { kind: 'disable'; password: string; err: string | null; busy: boolean };

export interface SecurityModalProps {
  /** `ME.totp_enabled` — app.html:2541. Decides which of the two status panels, and which button. */
  enabled: boolean;
  step: SecStep;
  onEnroll: () => void;
  onDisable: () => void;
  onCode: (v: string) => void;
  onPassword: (v: string) => void;
  onVerify: () => void;
  onConfirmDisable: () => void;
  onClose: () => void;
}

/** The two status panels — app.html:2544-2549. The ON one is green and offers only the OFF switch. */
function Status({ enabled, onEnroll, onDisable }: { enabled: boolean; onEnroll: () => void; onDisable: () => void }) {
  if (enabled) {
    return (
      <>
        <div className="notif-item" style={{ borderLeftColor: 'var(--green-soft)', cursor: 'default' }}>
          <div className="nt">✓ Two-factor authentication is ON</div>
          <div className="nd">Your account requires a 6-digit code at login.</div>
        </div>
        <div style={{ marginTop: '14px' }}>
          <button className="btn" id="sec_disable_btn" onClick={onDisable}>Disable two-factor authentication</button>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="notif-item" style={{ borderLeftColor: 'var(--amber)', cursor: 'default' }}>
        <div className="nt">⚠ Two-factor authentication is OFF</div>
        <div className="nd">Enable it to require a 6-digit code from an authenticator app at every login. Highly recommended for finance accounts.</div>
      </div>
      <div style={{ marginTop: '14px' }}>
        <button className="btn p" id="sec_enroll_btn" onClick={onEnroll}>Set up two-factor authentication</button>
      </div>
    </>
  );
}

/** `start2faEnroll()`'s second write — app.html:2563-2573. */
function Enroll(p: SecurityModalProps & { step: Extract<SecStep, { kind: 'enroll' }> }) {
  const s = p.step;
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '10px' }}>
        <img src={qrSrc(s.otpauthUrl)} alt="QR" width="180" height="180"
          style={{ borderRadius: '8px', background: '#fff', padding: '8px' }} />
      </div>
      <p className="muted" style={{ fontSize: '12.5px', lineHeight: '1.6' }}>
        {'1. Open '}<b>Google Authenticator</b>{' (or Authy / 1Password) on your phone.'}<br />
        {'2. Tap '}<b>+</b>{' → '}<b>Scan a QR code</b>{' and point at the code above.'}<br />
        {'3. Enter the 6-digit code your app shows below to confirm.'}
      </p>
      <div className="fld" style={{ marginTop: '12px' }}><label>{"Can't scan? Enter this secret manually"}</label>
        <input value={s.secret} readOnly onClick={(e) => (e.currentTarget as HTMLInputElement).select?.()}
          style={{ fontFamily: 'monospace', fontSize: '12.5px', letterSpacing: '1.5px' }} /></div>
      <div className="fld"><label>Verification code</label>
        <input id="sec_code" type="text" inputMode="numeric" maxLength={7} autoComplete="one-time-code" placeholder="000000"
          value={s.code} onChange={(e) => p.onCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') p.onVerify(); }}
          style={{ textAlign: 'center', fontSize: '22px', letterSpacing: '8px', fontVariantNumeric: 'tabular-nums' }} /></div>
      {s.err ? <div className="lerr" id="sec_err">{s.err}</div> : null}
      <div className="modal-ft">
        <button className="btn" onClick={p.onClose}>Cancel</button>
        <button className="btn p" id="sec_btn" disabled={s.verifying} onClick={p.onVerify}>{s.verifying ? 'Verifying…' : 'Enable two-factor'}</button>
      </div>
    </>
  );
}

/**
 * The turn-it-off step — `disable2fa()`, app.html:2598-2606, in one panel instead of two native dialogs.
 *
 * The legacy asks twice: `confirm('Disable two-factor authentication? …')` then
 * `prompt('Confirm your current password …')`. Neither is available here — no route may call the
 * browser's own dialogs (web/tests/shell-chrome.test.tsx §8) — and a `prompt()` types a password into a
 * plain text box in front of whoever is standing there. Both sentences are kept verbatim, the password
 * is masked, and the destructive button is `.btn d`; the deliberate act that used to be an OK click is
 * now typing the password, which is strictly more than the legacy required, not less.
 */
function Disable(p: SecurityModalProps & { step: Extract<SecStep, { kind: 'disable' }> }) {
  const s = p.step;
  return (
    <>
      <div className="notif-item" style={{ borderLeftColor: 'var(--red-soft)', cursor: 'default' }}>
        <div className="nt">Disable two-factor authentication?</div>
        <div className="nd">Your account will only require a password.</div>
      </div>
      <div className="fld" style={{ marginTop: '12px' }}><label>Confirm your current password to turn off two-factor authentication:</label>
        <input id="sec_pw" type="password" autoComplete="current-password" placeholder="••••••••"
          value={s.password} onChange={(e) => p.onPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') p.onConfirmDisable(); }} /></div>
      {s.err ? <div className="lerr" id="sec_err">{s.err}</div> : null}
      <div className="modal-ft">
        <button className="btn" onClick={p.onClose}>Cancel</button>
        <button className="btn d" id="sec_disable_go" disabled={s.busy} onClick={p.onConfirmDisable}>{s.busy ? 'Disabling…' : 'Disable two-factor'}</button>
      </div>
    </>
  );
}

/** app.html:2550-2554 — the overlay, the head and `#sec_body`, whose contents are the step. */
export function SecurityModal(p: SecurityModalProps) {
  const s = p.step;
  return (
    <div className="overlay" id="sec_overlay">
      <div className="modal" style={{ width: '480px' }}>
        <div className="modal-hd"><h3>🔐 Account security</h3>
          <button className="modal-close" id="sec_close" aria-label="Close" onClick={p.onClose}>×</button></div>
        <div id="sec_body">
          {s.kind === 'status' ? <Status enabled={p.enabled} onEnroll={p.onEnroll} onDisable={p.onDisable} /> : null}
          {s.kind === 'generating' ? <div className="load"><span className="spin"></span>Generating secret…</div> : null}
          {s.kind === 'failed' ? <div style={{ color: 'var(--red-soft)' }}>{s.message}</div> : null}
          {s.kind === 'enroll' ? <Enroll {...p} step={s} /> : null}
          {s.kind === 'disable' ? <Disable {...p} step={s} /> : null}
        </div>
      </div>
    </div>
  );
}

// One host per Finance layout — src/toast.tsx's arrangement, and for the same reason: the legacy opener
// is one call from a chrome button.
let sink: (() => void) | null = null;

/** `openSecurityModal()` — app.html:2539. */
export function openSecurityModal(): void {
  if (sink) sink();
}

export interface SecurityHostProps {
  /** `ME.totp_enabled` — app.html:2541. */
  enabled: boolean;
  /** `{api:'totp_setup'}` — app.html:2559. Resolves with the pending secret and its otpauth URL. */
  onSetup: () => Promise<{ secret: string; otpauth_url: string }>;
  /** `{api:'totp_verify_enroll'}` — app.html:2588. Throws with the server's own message on a bad code. */
  onVerify: (code: string) => Promise<void>;
  /** `{api:'totp_disable'}` — app.html:2600. Throws when the password does not re-authenticate. */
  onDisable: (password: string) => Promise<void>;
  /** `ME.totp_enabled=…` plus the toast — app.html:2586/2601. The layout owns both. */
  onChanged: (enabled: boolean) => void;
}

export default function SecurityHost(h: SecurityHostProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<SecStep>({ kind: 'status' });

  useEffect(() => {
    // `openSecurityModal()` removes any previous overlay and opens on the status panel — app.html:2540.
    sink = () => { setStep({ kind: 'status' }); setOpen(true); };
    return () => { sink = null; };
  }, []);

  if (!open) return null;

  const close = () => setOpen(false);   // `closeSecurityModal()` — app.html:2538.

  const enroll = async () => {
    setStep({ kind: 'generating' });
    try {
      const r = await h.onSetup();
      setStep({ kind: 'enroll', secret: r.secret, otpauthUrl: r.otpauth_url, code: '', err: null, verifying: false });
    } catch (e) {
      setStep({ kind: 'failed', message: e instanceof Error && e.message ? e.message : 'failed' });
    }
  };

  const verify = async () => {
    if (step.kind !== 'enroll' || step.verifying) return;
    setStep({ ...step, err: null, verifying: true });
    const r = await submitEnroll(step, h.onVerify);
    if ('enabled' in r) { setOpen(false); h.onChanged(true); return; }
    setStep(r.step);
  };

  const confirmDisable = async () => {
    if (step.kind !== 'disable' || step.busy) return;
    setStep({ ...step, err: null, busy: true });
    const r = await submitDisable(step, h.onDisable);
    if ('enabled' in r) { setOpen(false); h.onChanged(false); return; }
    setStep(r.step);
  };

  return (
    <SecurityModal enabled={h.enabled} step={step}
      onEnroll={enroll}
      onDisable={() => setStep({ kind: 'disable', password: '', err: null, busy: false })}
      onCode={(v) => setStep((s) => (s.kind === 'enroll' ? { ...s, code: v } : s))}
      onPassword={(v) => setStep((s) => (s.kind === 'disable' ? { ...s, password: v } : s))}
      onVerify={verify} onConfirmDisable={confirmDisable} onClose={close} />
  );
}
