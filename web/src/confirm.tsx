'use client';

// `showConfirm()` / `cfResolve()` — app.html:2402-2409, ported.
//
// ── WHAT THIS REPLACES, AND WHY IT MATTERS MORE THAN IT LOOKS ──────────────────────────────────────
// Until now every migrated route asked with the browser's own `window.confirm()`. Two of them void a
// supplier bill in a live Xero ledger and one creates real invoices; the rest delete employees, wipe
// signatures and mark claims paid. A native modal is not merely uglier than the app's own dialog — it is
// unmistakably NOT the app, it cannot say which button is the destructive one, and on the phones the
// employee screens are used on it renders as a system sheet with the origin printed above it.
//
// ── SAME SIGNATURE AS THE LEGACY, AND SAME DEFAULTS ────────────────────────────────────────────────
// `showConfirm(title, msg, okTxt, okCls)` → `Promise<boolean>`. `okTxt` defaults to 'Confirm' and
// `okCls` to 'd' — app.html:2405 is `'btn '+(okCls||'d')`, so the DESTRUCTIVE styling is what a caller
// gets by not choosing, which is the safe direction for a control whose whole job is to be the last
// thing before an irreversible act.
//
// ── THE ONE ADDITION TO THE LEGACY MARKUP, AND WHY ─────────────────────────────────────────────────
// `white-space: pre-line` on the message. app.html's `cf-msg` is a `<p>` written with `textContent` and
// every legacy `showConfirm()` call passes one line, so it never needed it. The messages being ported
// here came from `window.confirm()`, where a `\n\n` is a real paragraph break — "Reject this leave
// request?" is one line, but "Delete X permanently?\n\nRemoves their profile plus leave / claim /
// attendance records. This cannot be undone." is two, and collapsing them runs the warning into the
// question. Nothing else about the element moves.
//
// ── ESC ────────────────────────────────────────────────────────────────────────────────────────────
// app.html:1307 handles Escape app-wide by clicking the first `.modal-ft` button of any visible overlay,
// which for this dialog is Cancel. Ported as the same outcome — Escape resolves FALSE — rather than as a
// global keydown handler that hunts for buttons in the DOM.

import { useEffect, useRef, useState } from 'react';

export interface ConfirmRequest {
  title: string;
  msg: string;
  /** app.html:2405 — `okTxt||'Confirm'`. */
  okTxt?: string;
  /** app.html:2405 — `okCls||'d'`, i.e. destructive unless the caller says otherwise. */
  okCls?: string;
}

/**
 * The dialog itself — app.html:1207-1216, element for element. Pure, so the wiring below can be driven
 * without a browser: `onResolve` is what the two buttons call, exactly as they call `cfResolve()`.
 */
export function ConfirmDialog({ req, onResolve }: { req: ConfirmRequest; onResolve: (v: boolean) => void }) {
  return (
    <div className="overlay" id="cf-overlay">
      <div className="modal" style={{ width: '340px' }}>
        <div className="modal-hd"><h3 id="cf-title">{req.title}</h3></div>
        <p id="cf-msg" style={{ color: 'var(--text-soft)', fontSize: '13.5px', margin: '0', whiteSpace: 'pre-line' }}>{req.msg}</p>
        <div className="modal-ft">
          <button className="btn" onClick={() => onResolve(false)}>Cancel</button>
          <button className={'btn ' + (req.okCls || 'd')} id="cf-ok" onClick={() => onResolve(true)}>{req.okTxt || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}

// One host per app layout, addressed the way the legacy addresses `#cf-overlay`.
let sink: ((r: ConfirmRequest, res: (v: boolean) => void) => void) | null = null;

/**
 * `showConfirm(title,msg,okTxt,okCls)` — app.html:2402. Resolves true for the OK button and false for
 * Cancel or Escape.
 *
 * With no host mounted it resolves FALSE rather than throwing or defaulting to true: every caller reads
 * it as "may I do the irreversible thing", so the only safe answer to "there is no dialog" is no.
 */
export function showConfirm(title: string, msg: string, okTxt?: string, okCls?: string): Promise<boolean> {
  if (!sink) return Promise.resolve(false);
  return new Promise<boolean>((res) => sink!({ title, msg, okTxt, okCls }, res));
}

export default function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  // `_cfRes` — app.html:2401. Held in a ref, not in state: resolving is a side effect on a promise
  // nobody re-renders for, and it must happen exactly once.
  const res = useRef<((v: boolean) => void) | null>(null);

  const resolve = (v: boolean) => {
    setReq(null);
    const f = res.current;
    res.current = null;
    if (f) f(v);
  };

  useEffect(() => {
    sink = (r, f) => {
      // A second request while one is open would strand the first caller's promise for ever. The legacy
      // overwrites `_cfRes` and does exactly that; answering the outstanding one NO first is the same
      // safe direction the no-host case takes.
      if (res.current) { const prev = res.current; res.current = null; prev(false); }
      res.current = f;
      setReq(r);
    };
    return () => { sink = null; };
  }, []);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') resolve(false); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [req]);

  if (!req) return null;
  return <ConfirmDialog req={req} onResolve={resolve} />;
}
