// 🔐 Account security — the TOTP dialog, src/finance-security.tsx.
//
// ── NO GOLDEN, SO THE CONTRACT IS THE LEGACY SOURCE AND THE BEHAVIOUR ──────────────────────────────
// `openSecurityModal()` appends to `document.body` (app.html:2554); `tests/render_harness.ts` records
// innerHTML writes BY ELEMENT ID, so no golden holds one byte of this dialog. Same job as the three
// sibling PAGES: assert STRUCTURE, read every claim about the legacy out of app.html at run time, and
// drive the behaviour that the markup cannot show.
//
// ── AND THIS ONE GUARDS ACCOUNT SECURITY, SO THE ASSERTIONS THAT MATTER ARE THE NEGATIVES ─────────
// Three questions, each driven rather than observed: enable and disable are DIFFERENT acts reaching
// DIFFERENT server handlers, a failed verification enables nothing, and the shared secret appears only
// where app.html puts it. Each has a break-it case beside it — see the `still bites` blocks.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  SecurityModal, disableBody, enrollCode, enrollCodeError, qrSrc, submitDisable, submitEnroll,
  verifyBody, type SecStep,
} from '../src/finance-security';
import { REPO } from './parity';

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');
const HROS = readFileSync(join(REPO, 'hros.html'), 'utf8');
const html = (n: ReactElement) => renderToStaticMarkup(n);

const noop = () => {};

/** An enrol step mid-submit, i.e. what the host hands `submitEnroll()` — see that function's header. */
/** Every `<input …>` tag in a rendered string, whole, so "which box holds it" is answerable. */
const inputs = (out: string) => out.match(/<input\b[^>]*>/g) || [];

/**
 * The rendered string with every tag that may LEGITIMATELY carry a secret removed: the inputs, the QR
 * `<img>`, and react-dom 19's `<link rel="preload">` for it. What is left is every place a secret must
 * never appear — a title, an aria-label, a hint, an error line, ordinary text.
 */
const strip = (out: string) => out.replace(/<(?:input|img|link)\b[^>]*>/g, '');

const ENROL = (code: string) => ({ kind: 'enroll', secret: 'S', otpauthUrl: 'otpauth://x', code, err: null, verifying: true } as const);

function modal(step: SecStep, enabled = false, on: Partial<Record<string, (v?: unknown) => void>> = {}): ReactElement {
  return (
    <SecurityModal enabled={enabled} step={step}
      onEnroll={(on.onEnroll as () => void) || noop}
      onDisable={(on.onDisable as () => void) || noop}
      onCode={(on.onCode as (v: string) => void) || noop}
      onPassword={(on.onPassword as (v: string) => void) || noop}
      onVerify={(on.onVerify as () => void) || noop}
      onConfirmDisable={(on.onConfirmDisable as () => void) || noop}
      onClose={(on.onClose as () => void) || noop} />
  );
}

/** Every `<button>` in a rendered tree — the local walker web/tests/shell-chrome.test.tsx uses. */
function buttons(node: ReactNode): { text: string; onClick?: (e: unknown) => void; props: Record<string, unknown> }[] {
  const out: { text: string; onClick?: (e: unknown) => void; props: Record<string, unknown> }[] = [];
  const text = (n: ReactNode): string => {
    if (n === null || n === undefined || typeof n === 'boolean') return '';
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(text).join('');
    const el = n as ReactElement<Record<string, unknown>>;
    return el && typeof el === 'object' && 'props' in el ? text((el.props as { children?: ReactNode }).children) : '';
  };
  const walk = (n: ReactNode): void => {
    if (n === null || n === undefined || typeof n === 'boolean' || typeof n === 'string' || typeof n === 'number') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const el = n as ReactElement<Record<string, unknown>>;
    if (!el || typeof el !== 'object' || !('props' in el)) return;
    const props = (el.props || {}) as Record<string, unknown>;
    if (el.type === 'button') out.push({ text: text(props.children as ReactNode), onClick: props.onClick as never, props });
    if (typeof el.type === 'function') { walk((el.type as (p: Record<string, unknown>) => ReactNode)(props)); return; }
    walk(props.children as ReactNode);
  };
  walk(node);
  return out;
}

// ══ 1. The dialog is app.html's, sentence for sentence ═════════════════════════════════════════════

describe('the frame and the two status panels — app.html:2541-2554', () => {
  it('is the overlay, the head and #sec_body', () => {
    const out = html(modal({ kind: 'status' }));
    expect(out).toContain('id="sec_overlay"');
    expect(out).toContain('id="sec_body"');
    expect(out).toContain('🔐 Account security');
    expect(out).toContain('width:480px');
  });

  it('OFF offers only the setup path and ON only the teardown — app.html:2544-2549', () => {
    const off = html(modal({ kind: 'status' }, false));
    expect(off).toContain('⚠ Two-factor authentication is OFF');
    expect(off).toContain('Enable it to require a 6-digit code from an authenticator app at every login. Highly recommended for finance accounts.');
    expect(off).toContain('Set up two-factor authentication');
    expect(off).not.toContain('Disable two-factor authentication');
    expect(off).toContain('var(--amber)');

    const on = html(modal({ kind: 'status' }, true));
    expect(on).toContain('✓ Two-factor authentication is ON');
    expect(on).toContain('Your account requires a 6-digit code at login.');
    expect(on).toContain('Disable two-factor authentication');
    expect(on).not.toContain('Set up two-factor authentication');
    expect(on).toContain('var(--green-soft)');
  });

  // Each status panel offers exactly ONE act besides ×. A panel that offered both would let a
  // mis-click on an unprotected account walk into the disable flow and vice versa.
  it('each status panel has one act, and it is the right one', () => {
    const off = buttons(modal({ kind: 'status' }, false)).map((b) => b.text);
    expect(off).toEqual(['×', 'Set up two-factor authentication']);
    const on = buttons(modal({ kind: 'status' }, true)).map((b) => b.text);
    expect(on).toEqual(['×', 'Disable two-factor authentication']);
  });

  it('every sentence in the two panels is app.html’s own', () => {
    for (const s of ['✓ Two-factor authentication is ON', 'Your account requires a 6-digit code at login.',
      '⚠ Two-factor authentication is OFF', 'Set up two-factor authentication',
      'Disable two-factor authentication', '🔐 Account security']) {
      expect(APP, s).toContain(s);
    }
  });
});

// ══ 2. Enable and disable are DIFFERENT acts, on different handlers ════════════════════════════════

describe('the enable and disable paths are distinct', () => {
  it('they post to two different apis, and neither body carries the other’s field', () => {
    expect(verifyBody('123456')).toEqual({ api: 'totp_verify_enroll', code: '123456' });
    expect(disableBody('hunter2')).toEqual({ api: 'totp_disable', password: 'hunter2' });
    // The negatives: an enable must never carry a password, and a disable must never carry a code —
    // both handlers read only their own field (finance.ts:2318, :2480), so a body that carried the
    // other would be silently ignored and the operator would see the wrong act succeed.
    expect(Object.keys(verifyBody('123456'))).not.toContain('password');
    expect(Object.keys(disableBody('x'))).not.toContain('code');
    expect(APP).toContain("call({api:'totp_verify_enroll', code:code})");
    expect(APP).toContain("call({api:'totp_disable',password:pw})");
  });

  it('the OFF status button reaches the enrol step and the ON one reaches the disable step', () => {
    let enrolled = 0, disabling = 0;
    buttons(modal({ kind: 'status' }, false, { onEnroll: () => { enrolled++; }, onDisable: () => { disabling++; } }))
      .filter((b) => b.text !== '×')[0].onClick!({});
    expect([enrolled, disabling]).toEqual([1, 0]);
    enrolled = 0; disabling = 0;
    buttons(modal({ kind: 'status' }, true, { onEnroll: () => { enrolled++; }, onDisable: () => { disabling++; } }))
      .filter((b) => b.text !== '×')[0].onClick!({});
    expect([enrolled, disabling]).toEqual([0, 1]);
  });

  it('each submit calls only its OWN effect — neither can reach the other’s handler', async () => {
    const calls: string[] = [];
    await submitEnroll(ENROL('123456'), async () => { calls.push('verify'); });
    expect(calls).toEqual(['verify']);
    await submitDisable({ kind: 'disable', password: 'p', err: null, busy: true }, async () => { calls.push('disable'); });
    expect(calls).toEqual(['verify', 'disable']);
    // Opening the disable step is LOCAL: nothing is posted until the password is confirmed, which is
    // why the ON status button's prop is `onDisable` (a step change) and not `onConfirmDisable`.
    const b = buttons(modal({ kind: 'status' }, true, { onDisable: () => calls.push('step') }))
      .filter((x) => x.text !== '×')[0];
    b.onClick!({});
    expect(calls).toEqual(['verify', 'disable', 'step']);
  });
});

// ══ 3. A failed verification enables NOTHING ═══════════════════════════════════════════════════════

describe('a failed verification enables nothing', () => {
  it('a code that is not six digits never reaches the server — app.html:2584', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5', '00000a']) {
      expect(enrollCodeError(enrollCode(bad)), bad).toBe('Enter the 6-digit code from your app');
    }
    // …and the six-digit shapes that must pass, including the paste-friendly spellings app.html strips.
    for (const ok of ['123456', '000000', '123 456', '123-456', ' 123456 ']) {
      expect(enrollCodeError(enrollCode(ok)), ok).toBe(null);
    }
    expect(APP).toContain("er.textContent='Enter the 6-digit code from your app'");
    expect(APP).toContain("code=(document.getElementById('sec_code').value||'').replace(/\\s|-/g,'')");
  });

  it('the local refusal posts nothing and does not report success', async () => {
    let posted = 0;
    const r = await submitEnroll(ENROL('12'), async () => { posted++; });
    expect(posted).toBe(0);
    expect('enabled' in r).toBe(false);
    expect('step' in r && r.step.err).toBe('Enter the 6-digit code from your app');
    // Still on the enrol step and still carrying the secret, so the operator corrects the code rather
    // than starting a fresh enrolment against a NEW secret their authenticator does not have.
    expect('step' in r && r.step.kind).toBe('enroll');
    expect('step' in r && r.step.secret).toBe('S');
    expect(html(modal('step' in r ? r.step : ENROL('12')))).toContain('Verification code');
  });

  it('a REJECTED code shows the server’s own message and leaves 2FA off', async () => {
    const r = await submitEnroll(ENROL('999999'), async () => { throw new Error('Incorrect 6-digit code, try again'); });
    expect('enabled' in r).toBe(false);                                   // nothing was enabled
    expect('step' in r && r.step.err).toBe('Incorrect 6-digit code, try again');
    expect('step' in r && r.step.verifying).toBe(false);                  // the button came back
    expect(html(modal('step' in r ? r.step : ENROL('9')))).toContain('Incorrect 6-digit code, try again');
  });

  it('only a RESOLVED verification reports enabled — and it reports TRUE, not false', async () => {
    const r = await submitEnroll(ENROL('123456'), async () => {});
    expect(r).toEqual({ enabled: true });
    // The literal matters: the host does `onChanged(true)` off this branch and `onChanged(false)` off
    // submitDisable's, so a shared `{enabled}` carrying the wrong value would flip the account's state
    // in the shell while the server did the opposite.
    expect('enabled' in r && r.enabled).toBe(true);
  });

  it('a failed DISABLE leaves 2FA on, with the server’s refusal on screen', async () => {
    const step = { kind: 'disable', password: 'wrong', err: null, busy: true } as const;
    const r = await submitDisable(step, async () => { throw new Error('Enter your current password to turn off two-factor authentication.'); });
    expect('enabled' in r).toBe(false);
    expect('step' in r && r.step.err).toBe('Enter your current password to turn off two-factor authentication.');
    expect('step' in r && r.step.busy).toBe(false);
    expect(html(modal('step' in r ? r.step : step, true))).toContain('Enter your current password to turn off');
  });

  it('a resolved disable reports FALSE — the two directions are not one flag flipped blind', async () => {
    const r = await submitDisable({ kind: 'disable', password: 'right', err: null, busy: true }, async () => {});
    expect(r).toEqual({ enabled: false });
    expect('enabled' in r && r.enabled).toBe(false);
    // …and the password it sent is the one that was typed, not a stale or blank one.
    let sent = '';
    await submitDisable({ kind: 'disable', password: 'correct horse', err: null, busy: true }, async (pw) => { sent = pw; });
    expect(sent).toBe('correct horse');
  });
});

// ══ 4. The secret appears where app.html puts it, and nowhere else ═════════════════════════════════

describe('no secret is rendered where the legacy did not render it', () => {
  const S = 'JBSWY3DPEHPK3PXP';
  const step = (): SecStep => ({ kind: 'enroll', secret: S, otpauthUrl: 'otpauth://totp/CTG:a@b?secret=' + S, code: '', err: null, verifying: false });

  it('the enrol step shows it in the readonly manual-entry box, and the QR URL — app.html:2562, :2569', () => {
    const out = html(modal(step()));
    // React puts `value` LAST however the JSX orders it, so the whole tag is read rather than a
    // position inside it — web/tests/finance-users-subviews.test.tsx's rule.
    const box = inputs(out).find((t) => t.includes(S));
    expect(box).toBeTruthy();
    expect(box).toContain('readOnly=""');
    // Everything else is the negative: with every <input> and every image-bearing tag removed, the
    // secret is gone. That is stronger than an occurrence COUNT, which react-dom 19 already moved once
    // — it emits a `<link rel="preload" as="image">` for the QR alongside the `<img>`, so the
    // third-party URL carrying the secret appears TWICE where app.html writes it once.
    expect(strip(out)).not.toContain(S);
    // …and only ONE input carries it: the readonly one. The verification-code box must not be
    // pre-filled with the secret — it would look like a valid code and enable nothing.
    expect(inputs(out).filter((t) => t.includes(S)).length).toBe(1);
    
    expect(APP).toContain('scan? Enter this secret manually');
  });

  it('NO other step renders it — status, generating, failure and disable are all clean', () => {
    for (const s of [{ kind: 'status' } as SecStep, { kind: 'generating' } as SecStep,
      { kind: 'failed', message: 'nope' } as SecStep,
      { kind: 'disable', password: 'pw', err: null, busy: false } as SecStep]) {
      const out = html(modal(s, true));
      expect(out, s.kind).not.toContain(S);
      expect(out, s.kind).not.toContain('otpauth');
    }
  });

  it('the typed PASSWORD is masked and never lands in an attribute the legacy did not have', () => {
    const out = html(modal({ kind: 'disable', password: 'hunter2', err: null, busy: false }, true));
    // The one input is masked, and the typed password is nowhere BUT that input — not in a title, not
    // in an aria-label, not in the error line. React does serialise a controlled input's `value`, which
    // is the DOM the browser already holds; a copy anywhere else is a leak onto a shared screen.
    expect(inputs(out).length).toBe(1);
    expect(inputs(out)[0]).toContain('type="password"');
    expect(strip(out)).not.toContain('hunter2');
    // …and the legacy's own two sentences survived the move off `confirm()`/`prompt()`.
    expect(out).toContain('Disable two-factor authentication?');
    expect(out).toContain('Your account will only require a password.');
    expect(out).toContain('Confirm your current password to turn off two-factor authentication:');
    expect(APP).toContain("confirm('Disable two-factor authentication? Your account will only require a password.')");
    expect(APP).toContain("prompt('Confirm your current password to turn off two-factor authentication:')");
  });

  it('an ERROR on the disable step does not echo the password back', () => {
    const out = html(modal({ kind: 'disable', password: 'hunter2', err: 'Enter your current password to turn off two-factor authentication.', err2: undefined } as never, true));
    expect(strip(out)).not.toContain('hunter2');
  });

  it('there is no recovery-code surface at all, because the legacy has none', () => {
    // `totp_setup` returns `{secret, otpauth_url}` and nothing else (finance.ts:2311-2316). Inventing a
    // backup-code list here would be a security feature nobody reviewed, printed on a screen.
    for (const s of [{ kind: 'status' } as SecStep, step()]) {
      const out = html(modal(s, true)).toLowerCase();
      for (const word of ['recovery', 'backup code', 'one-time code list']) expect(out, word).not.toContain(word);
    }
    expect(APP).not.toMatch(/recovery[_ ]?code/i);
  });

  // The QR image hands the whole otpauth URL — which CONTAINS the secret — to api.qrserver.com. That is
  // app.html's own behaviour and is mirrored deliberately; pinned here so it is a visible decision
  // rather than something a reader has to notice.
  it('the QR is built exactly as app.html builds it, third party and all', () => {
    expect(qrSrc('otpauth://totp/x?secret=' + S))
      .toBe('https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=' + encodeURIComponent('otpauth://totp/x?secret=' + S));
    expect(APP).toContain("var qrSrc='https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data='+encodeURIComponent(r.otpauth_url);");
  });
});

// ══ 5. Where this control lives, and where it does NOT ═════════════════════════════════════════════

it('HR OS has no security control in either world — so neither shell grew one', () => {
  // app.html:1104 has the button; hros.html's sidebar foot has never had one, and the port did not
  // invent it. Read out of the legacy files so a button added to hros.html surfaces here.
  expect(APP).toContain('onclick="openSecurityModal()"');
  expect(HROS).not.toContain('openSecurityModal');
  expect(HROS).not.toContain('🔐 Security');
  // The HR shell imports nothing from the security dialog — the comment in its header naming this file
  // is prose, so the check is on the IMPORT.
  expect(readFileSync(join(import.meta.dirname, '..', 'src', 'hr-shell.tsx'), 'utf8'))
    .not.toMatch(/^import .*finance-security/m);
  expect(readFileSync(join(import.meta.dirname, '..', 'app', 'hr', 'layout.tsx'), 'utf8'))
    .not.toContain('finance-security');
});

// ══ 6. Guard the guards ═══════════════════════════════════════════════════════════════════════════

describe('the guards still bite', () => {
  it('a six-digit gate that accepted anything would fail §3', () => {
    const widened = (c: string) => (c.length ? null : 'Enter the 6-digit code from your app');
    expect(widened('12')).toBe(null);                       // the defect
    expect(enrollCodeError(enrollCode('12'))).not.toBe(null); // what is shipped
  });

  // The two pure submits are only half the path: the HOST is what turns their result into
  // `onChanged(true|false)` and a closed dialog. That wiring has no output to assert (vitest runs
  // `environment: 'node'`, so the host cannot be mounted), so it is pinned by SOURCE — the same
  // treatment finance.calendar's `dueLabel()` gets. Swapping the two literals is the defect.
  it('the host reports the RESULT of each submit, and the two are not the same literal', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'finance-security.tsx'), 'utf8');
    expect(src).toContain("const r = await submitEnroll(step, h.onVerify);");
    expect(src).toContain("if ('enabled' in r) { setOpen(false); h.onChanged(true); return; }");
    expect(src).toContain("const r = await submitDisable(step, h.onDisable);");
    expect(src).toContain("if ('enabled' in r) { setOpen(false); h.onChanged(false); return; }");
    // `onChanged` is reached from exactly those two places and nowhere else.
    expect(src.split('h.onChanged(').length - 1).toBe(2);
  });

  it('the strip() the leak checks rely on really removes only tags that may hold a secret', () => {
    // It must remove <input>, <img> and <link>, and NOTHING else — otherwise §4's negatives could pass
    // by deleting the very place a leak would land.
    expect(strip('<div title="S">x</div>')).toContain('S');
    expect(strip('<span aria-label="S"></span>')).toContain('S');
    expect(strip('<div class="nd">S</div>')).toContain('S');
    expect(strip('<input value="S"/>')).not.toContain('S');
    expect(strip('<img src="S"/>')).not.toContain('S');
    expect(strip('<link href="S"/>')).not.toContain('S');
  });
});

