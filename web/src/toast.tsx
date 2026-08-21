'use client';

// `toast()` / `_playNextToast()` — common.js:29-40, ported.
//
// ── WHY IT IS AN IMPERATIVE FUNCTION AND NOT A HOOK ────────────────────────────────────────────────
// The legacy signature is `toast(msg, isErr)`, called from ~200 places across both apps, most of them
// inside an async handler halfway down a save. Keeping that signature means a migrated route swaps one
// call for one call — `window.alert('Preview first')` becomes `toast('Preview first', true)` — instead
// of threading a context value through every screen this run does not own. There is exactly one host
// mounted (each app's layout mounts one), which is the same arrangement the legacy `#toast` div has.
//
// ── THE QUEUE IS THE POINT ─────────────────────────────────────────────────────────────────────────
// app.html:1265 says why it exists: two toasts fired back-to-back ("saved" + "loaded") used to overwrite
// each other and the first was never seen. So messages queue, one shows for 2400ms, and the next starts
// 240ms after it fades — common.js's own numbers.
//
// Messages posted BEFORE a host mounts are buffered and flushed when one does, rather than dropped. A
// toast is often the only report of a FAILURE ("Failed: Xero rejected"), and a failure that reports
// nothing at all is worse than one that reports late.
//
// ── ONE LEGACY DEFECT, MIRRORED THE OTHER WAY, AND SAID OUT LOUD ───────────────────────────────────
// app.html:1184 is `<div class="toast" id="toast">`; hros.html:1139 is `<div id="toast">` — no class. Both
// stylesheets carry the identical `.toast` / `.toast.show` rules (app.html:268, hros.html:214) and
// neither carries an `#toast` selector, so in HR OS today a toast is unstyled body text at the very
// bottom of the document and the `.show` transition never runs. This renders the class in BOTH apps, i.e.
// the toast hros.html's own stylesheet describes. That is a deliberate difference from the live HR
// screen and not a migration slip; the shell is outside the screen-by-screen strangler (report.md §3.5),
// no golden holds it, and shipping the broken half would have been a choice too. The legacy markup is
// pinned in the screen-chrome test so that fixing hros.html shows up here as a disagreement.

import { useEffect, useRef, useState } from 'react';

export interface ToastMsg { msg: string; isErr?: boolean }

/** common.js:39 — visible for 2400ms, then 240ms of quiet before the next one starts. */
export const TOAST_MS = 2400;
export const TOAST_GAP_MS = 240;

/**
 * `_playNextToast()`'s two style writes — common.js:36-37.
 *
 * The ONLY thing that distinguishes a failure from a success on this control, so it is a named function
 * with its own test: a port that dropped `isErr` would report "Failed: Xero rejected" in the same calm
 * grey as "Saved", and nothing about the markup would look wrong.
 */
export function toastStyle(isErr?: boolean): { borderColor: string; color: string } {
  return { borderColor: isErr ? 'rgba(239,68,68,.45)' : '', color: isErr ? 'var(--red-soft)' : '' };
}

/** The `#toast` div itself. Pure: props in, markup out, so it can be diffed without a browser. */
export function Toast({ msg, isErr, show }: { msg: string; isErr?: boolean; show: boolean }) {
  return <div className={'toast' + (show ? ' show' : '')} id="toast" style={toastStyle(isErr)}>{msg}</div>;
}

// The single host, addressed the way the legacy addresses `document.getElementById('toast')`.
let sink: ((m: ToastMsg) => void) | null = null;
const buffered: ToastMsg[] = [];

/** `toast(msg, isErr)` — common.js:29. Same signature, same queueing. */
export function toast(msg: string, isErr?: boolean): void {
  if (sink) sink({ msg, isErr });
  else buffered.push({ msg, isErr });
}

/** Mounted once per app layout. Renders the legacy `#toast` div and drives the legacy queue. */
export default function ToastHost() {
  const [queue, setQueue] = useState<ToastMsg[]>([]);
  const [show, setShow] = useState(false);
  const head = queue[0];
  // What the div keeps saying while it fades out: clearing the text on the same tick as `show` would
  // blank the message mid-transition, which the legacy never does (it only ever sets textContent when a
  // toast STARTS).
  const last = useRef<ToastMsg>({ msg: '' });
  if (head) last.current = head;

  useEffect(() => {
    sink = (m) => setQueue((q) => [...q, m]);
    if (buffered.length) { setQueue((q) => [...q, ...buffered]); buffered.length = 0; }
    return () => { sink = null; };
  }, []);

  useEffect(() => {
    if (!head) return;
    setShow(true);
    const a = setTimeout(() => setShow(false), TOAST_MS);
    const b = setTimeout(() => setQueue((q) => q.slice(1)), TOAST_MS + TOAST_GAP_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [head]);

  return <Toast msg={last.current.msg} isErr={last.current.isErr} show={show} />;
}
