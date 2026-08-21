'use client';

// The credentials modal — app.html:1186-1204 + `openPwModal()` / `doChangePw()` (app.html:2608-2642),
// with hros.html's `hrPwModal()` / `hrPwSave()` (hros.html:1315-1352) as the second witness.
//
// ── TWO LEGACY DIALOGS, ONE PORT, AND THE REASON ───────────────────────────────────────────────────
// The two apps' dialogs do the same thing, post the same `{api:'changepw', old, neu}`, and enforce the
// same rule (`pwValid` at app.html:2525 and `hrPwValid` at hros.html:1315 are the same predicate written
// twice). They differ only in trim: Finance has a × and a strength meter, HR does not; Finance's button
// says "Save", HR's "Save password". Both stylesheets already carry `.pw-meter`, `.pw-forced-note`,
// `.lerr` and `.fld` (app.html:246-250, hros.html:192-196), so the richer one renders correctly in both.
// Shipping two components to preserve that cosmetic difference is the over-building this migration has
// avoided everywhere else, so this is Finance's dialog, used by both. HR OS staff gain the meter.
//
// ── THE FORCED BRANCH IS THE SECURITY-CARRYING ONE, AND IT WAS MISSING ENTIRELY ────────────────────
// `enterApp()` hides the whole app and opens this modal with no Cancel and no × when the server says
// `must_change_pw` — app.html:2665-2668 and hros.html:1356. That is how a staff member who was handed a
// one-time temporary password is made to replace it. The React shell did not have it: an operator on a
// temporary password could use every migrated screen and would never be asked. So both `forced` and the
// route-level refusal to render anything else are part of this port, and are pinned in the shell-chrome
// test in both directions.
//
// ── PURE COMPONENT, IMPERATIVE OPENER ──────────────────────────────────────────────────────────────
// `PasswordModal` is a pure function of its props — same split as every migrated screen — so the
// validation ladder and the forced branch can be driven without a browser. `openPasswordModal()` is the
// legacy `openPwModal()`: one call, from a chrome button or from the layout's boot check.

import { useEffect, useRef, useState } from 'react';

/** `pwScore(p)` — app.html:2516, verbatim. 0-4, and the meter is `(sc+1)*20` percent of the bar. */
export function pwScore(p: string): number {
  p = p || '';
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/[0-9]/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 4);
}

/** `pwValid(p)` — app.html:2525 (and `hrPwValid`, hros.html:1315). >=8 chars, a letter AND a digit. */
export function pwValid(p: string): boolean {
  return (p || '').length >= 8 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);
}

const METER_COLS = ['#EF4444', '#EF4444', '#F59E0B', '#5B9BD5', '#22C55E'];
const METER_LABS = ['Too weak', 'Too weak', 'Fair', 'Good', 'Strong'];

/** `pwMeter()` — app.html:2526. The bar's width and colour, and the hint under it. */
export function pwMeter(p: string): { width: string; color: string; hint: string; hintColor: string } {
  const sc = pwScore(p);
  return {
    width: (p ? (sc + 1) * 20 : 0) + '%',
    color: METER_COLS[sc],
    hint: p ? (pwValid(p) ? METER_LABS[sc] + ' password' : 'Need 8+ chars with letters and numbers') : '',
    hintColor: p ? METER_COLS[sc] : 'var(--muted)',
  };
}

/**
 * `doChangePw()`'s validation ladder — app.html:2628-2632, in order and with its exact wording.
 *
 * Returns the message to show, or null when the form may be posted. It is a pure function because the
 * ORDER is load-bearing: "must be different from the current one" has to be reached before "do not
 * match", or a user who typed their old password into both new fields is told the wrong thing.
 */
export function pwError(oldp: string, neu: string, cfm: string): string | null {
  if (!oldp || !neu) return 'All fields required';
  if (!pwValid(neu)) return 'New password must be at least 8 characters and include letters and numbers';
  if (neu === oldp) return 'New password must be different from the current one';
  if (neu !== cfm) return 'Passwords do not match';
  return null;
}

export interface PasswordModalProps {
  /** `PW_FORCED` — app.html:2607. No ×, no Cancel, and a note saying why. */
  forced: boolean;
  old: string;
  neu: string;
  cfm: string;
  /** The `.lerr` line: a validation message or the server's own error. */
  err: string | null;
  saving: boolean;
  onField: (k: 'old' | 'neu' | 'cfm', v: string) => void;
  onSave: () => void;
  onClose: () => void;
}

/** app.html:1186-1204, element for element. */
export function PasswordModal(p: PasswordModalProps) {
  const m = pwMeter(p.neu);
  return (
    <div className="overlay" id="pw-overlay">
      <div className="modal" style={{ width: '380px' }}>
        <div className="modal-hd">
          <h3 id="pw-title">{p.forced ? 'Set a new password' : 'Change Password'}</h3>
          {p.forced ? null : <button className="modal-close" id="pw-close" aria-label="Close" onClick={p.onClose}>×</button>}
        </div>
        {p.forced ? <div className="pw-forced-note" id="pw-forced-note">🔒 For your security, please set a new password before continuing.</div> : null}
        <div className="fld"><label>Current Password</label>
          <input type="password" id="pw-old" placeholder="••••••••" autoComplete="current-password"
            value={p.old} onChange={(e) => p.onField('old', e.target.value)} /></div>
        <div className="fld"><label>New Password <span style={{ color: 'var(--muted)', textTransform: 'none', letterSpacing: '0' }}>(min 8 chars, letters + numbers)</span></label>
          <input type="password" id="pw-new" placeholder="••••••••" autoComplete="new-password"
            value={p.neu} onChange={(e) => p.onField('neu', e.target.value)} />
          <div className="pw-meter" id="pw-meter"><span style={{ width: m.width, background: m.color }}></span></div>
          <div className="pw-hint" id="pw-hint" style={{ color: m.hintColor }}>{m.hint}</div></div>
        <div className="fld"><label>Confirm Password</label>
          <input type="password" id="pw-cfm" placeholder="••••••••" autoComplete="new-password"
            value={p.cfm} onChange={(e) => p.onField('cfm', e.target.value)} /></div>
        {p.err ? <div className="lerr" id="pw-err">{p.err}</div> : null}
        <div className="modal-ft">
          {p.forced ? null : <button className="btn" id="pw-cancel" onClick={p.onClose}>Cancel</button>}
          <button className="btn p" id="pw-save" disabled={p.saving} onClick={p.onSave}>{p.saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// One host per app layout.
let sink: ((forced: boolean) => void) | null = null;

/** `openPwModal(forced)` — app.html:2608. */
export function openPasswordModal(forced = false): void {
  if (sink) sink(forced);
}

export interface PasswordHostProps {
  /** `call({api:'changepw', old, neu})` — the layout owns the network, as every route does. */
  onSave: (oldp: string, neu: string) => Promise<void>;
  /** Opened forced on mount, i.e. the server said `must_change_pw`. */
  forcedOnMount?: boolean;
  /** `PW_FORCED` cleared after a successful save — app.html:2638 calls `showApp()`. */
  onForcedDone?: () => void;
}

export default function PasswordHost({ onSave, forcedOnMount, onForcedDone }: PasswordHostProps) {
  const [open, setOpen] = useState(!!forcedOnMount);
  const [forced, setForced] = useState(!!forcedOnMount);
  const [old, setOld] = useState('');
  const [neu, setNeu] = useState('');
  const [cfm, setCfm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    sink = (f) => {
      // `openPwModal()` clears the three fields and the error line every time — app.html:2610-2611.
      setOld(''); setNeu(''); setCfm(''); setErr(null); setForced(f); setOpen(true);
    };
    return () => { sink = null; };
  }, []);

  useEffect(() => { if (forcedOnMount) { setForced(true); setOpen(true); } }, [forcedOnMount]);

  if (!open) return null;

  const close = () => { if (!forced) setOpen(false); };   // `closePwModal()` — app.html:2620.

  const save = async () => {
    const bad = pwError(old, neu, cfm);
    if (bad) { setErr(bad); return; }
    if (busy.current) return;
    busy.current = true;
    setErr(null); setSaving(true);
    try {
      await onSave(old, neu);
      setOpen(false);
      if (forced) { setForced(false); onForcedDone?.(); }
    } catch (e) {
      setErr('Failed: ' + (e instanceof Error && e.message ? e.message : 'network issue'));
    } finally {
      setSaving(false);
      busy.current = false;
    }
  };

  return (
    <PasswordModal forced={forced} old={old} neu={neu} cfm={cfm} err={err} saving={saving}
      onField={(k, v) => { if (k === 'old') setOld(v); else if (k === 'neu') setNeu(v); else setCfm(v); }}
      onSave={save} onClose={close} />
  );
}
