'use client';

// The route. Everything impure lives here — the session, the fetches, the DOM read-back, the POST — so
// that src/hr-profile.tsx stays a pure function of its props and can be diffed against the legacy
// golden. Same split as the pilot:
//
//   app/<area>/<screen>/page.tsx   'use client', loads, holds state, wires handlers   — not golden-tested
//   src/<screen>.tsx              pure, props in / markup out                         — golden-tested
//
// ONE handler still hands off, and it is shell work rather than screen work: `hrPwModal()`
// (hros.html:1316) is the app shell's modal, which `web/` does not have yet (report.md §3.5 —
// re-implement the chrome once in the Next shell, not per screen).
//
// THE SIGNATURE PAD lives here now (v222). `hrSigBind()` (hros.html:3327) is imperative device code —
// mouse and touch listeners on a <canvas>, and `toDataURL()` read back off it — so it belongs on this
// side of the line, exactly like the geolocation in app/hr/clock. What it CAPTURES and what it STORES
// is not device code and is not here: `sigTrimBox()`, `sigUploadSize()`, `sigStoreRefusal()` and
// `sigFileRefusal()` are pure functions in src/hr-profile.tsx, pinned by the screen's own test, because
// a signature is stamped on a reimbursement claim form and a blank or wrong one is a document defect
// that nothing downstream would catch.

import { useCallback, useEffect, useRef, useState } from 'react';

import { showConfirm } from '../../../src/confirm';
import HrProfile, {
  profileBody, sigFileRefusal, sigStoreRefusal, sigTrimBox, sigUploadSize,
  type Bank, type ProfileEmployee,
} from '../../../src/hr-profile';
import { openPasswordModal } from '../../../src/password-modal';
import { call, legacyUrl, token } from '../../../src/portal';

const LEGACY = () => `${legacyUrl('hros.html')}#tab=profile`;

interface RcConfig { me?: { employee?: ProfileEmployee | null } | null }

export default function HrProfilePage() {
  const [company, setCompany] = useState<string | null>(null);
  const [emp, setEmp] = useState<ProfileEmployee | null | undefined>(undefined);
  // `EPRO.banks` — hros.html:3247. `null` is "still loading", and that distinction reaches the POST
  // (see profileBody()'s banksLoaded), so it is kept rather than collapsed into an empty array.
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
      const co = await call<{ companies?: { tenant_id: string; tenant_name: string }[] }>({ api: 'hr_companies' });
      const list = co.companies || [];
      const tenant = (list.find((c) => c.tenant_id === saved) || list[0]);
      setCompany(tenant?.tenant_name || '');
      // `hrRCBoot()` — hros.html:1791. My Profile hangs off RC, the claims module's state; this is the
      // same call that primes it, and `RC.me.employee` is the employee the screen is about.
      const rc = await call<RcConfig>({ api: 'hr_rc_config', tenant: tenant?.tenant_id || null });
      setEmp((rc.me && rc.me.employee) || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    void load();
    // hros.html:3247 — the bank list loads alongside the form, not before it.
    call<{ banks?: (Bank & { active?: boolean })[] }>({ api: 'hr_banks_list' })
      .then((r) => setBanks((r.banks || []).filter((b) => b.active !== false)))
      .catch(() => setBanks([]));
  }, [load]);

  /**
   * `hrEmpProfileSave()` — hros.html:3383. Reads the controls back out of the DOM by their legacy ids,
   * exactly as the legacy one does, because the component leaves them uncontrolled for that reason.
   * Scoped to this screen's subtree rather than `document`, so it cannot pick up an id the shell reuses.
   *
   * The BODY is built by `profileBody()`, which lives in src/ and is pinned field-for-field against
   * hros.html by the parity test. Nothing about the target is decided here: there is no employee id in
   * the request, and the server resolves it from the token.
   */
  const onSave = useCallback(async () => {
    if (saving) return;
    const root = formRef.current;
    const v = (id: string) => root?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('#' + id)?.value || '';
    const sw = !!root?.querySelector<HTMLInputElement>('#pf_sw')?.checked;
    const body = profileBody(v, sw, (banks || []).length > 0);
    if ('error' in body) { setErr(body.error); return; }
    setSaving(true);
    setErr(null);
    setNote(null);
    try {
      const r = await call<{ employee?: ProfileEmployee; changed?: string[]; unchanged?: boolean }>(body);
      if (r.employee) setEmp(r.employee);
      const n = (r.changed || []).length;
      setNote(r.unchanged ? 'No changes to save' : `Profile updated ✓ (${n} field${n === 1 ? '' : 's'})`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [saving, banks]);

  /* ── the signature pad — `SIG`, hros.html:3313 ────────────────────────────────────────────────── */

  const [sigOpen, setSigOpen] = useState(false);
  /** `SIG.dirty` — a ref, not state: it is set from a pointer handler on every stroke. */
  const sigDirty = useRef(false);

  const sigCanvas = useCallback(() => formRef.current?.querySelector<HTMLCanvasElement>('#sigpad') || null, []);

  /** `hrSigPut()` — hros.html:3372. */
  const sigPut = useCallback(async (uri: string) => {
    try {
      await call({ api: 'hr_signature_save', signature: uri });
      setSigOpen(false);
      sigDirty.current = false;
      setNote('Signature saved ✓');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [load]);

  /**
   * `hrSigBind()` — hros.html:3327, as an effect rather than a `setTimeout(…, 30)` after a re-render.
   *
   * `pos()` maps a client coordinate onto the canvas's BACKING store (`cv.width / rect.width`), which is
   * why the canvas keeps its intrinsic 600x180 in the component: the element is laid out at whatever
   * width the panel gives it, and without that ratio the ink lands somewhere other than the pointer.
   * `preventDefault` on down/move is what stops a finger scrolling the page instead of signing.
   */
  useEffect(() => {
    if (!sigOpen) return;
    const cv = sigCanvas();
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    let drawing = false;
    const pos = (e: MouseEvent | TouchEvent) => {
      const r = cv.getBoundingClientRect();
      const t = ('touches' in e && e.touches[0]) || (e as MouseEvent);
      return { x: (t.clientX - r.left) * (cv.width / r.width), y: (t.clientY - r.top) * (cv.height / r.height) };
    };
    const down = (e: MouseEvent | TouchEvent) => {
      e.preventDefault(); drawing = true; sigDirty.current = true;
      const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
    };
    const move = (e: MouseEvent | TouchEvent) => {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
    };
    const up = () => { drawing = false; };
    cv.addEventListener('mousedown', down);
    cv.addEventListener('mousemove', move);
    cv.addEventListener('touchstart', down, { passive: false });
    cv.addEventListener('touchmove', move, { passive: false });
    cv.addEventListener('touchend', up);
    window.addEventListener('mouseup', up);
    return () => {
      cv.removeEventListener('mousedown', down);
      cv.removeEventListener('mousemove', move);
      cv.removeEventListener('touchstart', down);
      cv.removeEventListener('touchmove', move);
      cv.removeEventListener('touchend', up);
      window.removeEventListener('mouseup', up);
    };
  }, [sigOpen, sigCanvas]);

  /** `hrSigTrim()` — hros.html:3335. `sigTrimBox()` decides WHERE; the canvas work is here. */
  const sigTrim = useCallback((cv: HTMLCanvasElement): string | null => {
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    const box = sigTrimBox(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
    if (!box) return null;
    const out = document.createElement('canvas');
    out.width = box.w; out.height = box.h;
    out.getContext('2d')!.drawImage(cv, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    return out.toDataURL('image/png');   // PNG keeps the transparent background
  }, []);

  /** `hrSigSave()` — hros.html:3344. */
  const onSigSave = useCallback(async () => {
    const cv = sigCanvas();
    if (!cv) return;
    if (!sigDirty.current) { setNote('Draw your signature first'); return; }
    const uri = sigTrim(cv);
    if (!uri) { setNote('Draw your signature first'); return; }
    const refusal = sigStoreRefusal('draw', uri.length);
    if (refusal) { setNote(refusal); return; }
    await sigPut(uri);
  }, [sigCanvas, sigPut, sigTrim]);

  /** `hrSigWipe()` — hros.html:3333. */
  const onSigWipe = useCallback(() => {
    const cv = sigCanvas();
    if (!cv) return;
    cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
    sigDirty.current = false;
  }, [sigCanvas]);

  /** `hrSigCancel()` — hros.html:3327. */
  const onSigCancel = useCallback(() => { setSigOpen(false); sigDirty.current = false; }, []);

  /** `hrSigUpload()` — hros.html:3352. */
  const onSigUpload = useCallback((input: HTMLInputElement) => {
    const f = input && input.files && input.files[0];
    if (!f) return;
    const tooBig = sigFileRefusal(f.size);
    if (tooBig) { setNote(tooBig); return; }
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = sigUploadSize(img.width, img.height);
        const cv = document.createElement('canvas');
        cv.width = size.w; cv.height = size.h;
        cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
        let uri = cv.toDataURL('image/png');
        if (sigStoreRefusal('upload', uri.length)) uri = cv.toDataURL('image/jpeg', 0.85);
        const refusal = sigStoreRefusal('upload', uri.length);
        if (refusal) { setNote(refusal); return; }
        void sigPut(uri);
      };
      img.onerror = () => setNote('That file isn’t a readable image');
      img.src = String(rd.result);
    };
    rd.readAsDataURL(f);
  }, [sigPut]);

  /** `hrSigClearSaved()` — hros.html:3377. Destructive, so it keeps the legacy confirm. */
  const onSigClearSaved = useCallback(async () => {
    if (!await showConfirm('Remove signature', 'Remove your signature? Claim forms will print a blank line for you to sign by hand.', 'Remove')) return;
    try {
      await call({ api: 'hr_signature_save', signature: null });
      setNote('Signature removed');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [load]);

  return (
    <div ref={formRef}>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
        : emp === undefined || company === null ? <Panel><span className="spin"></span> Loading your profile…</Panel>
        : (
          <>
            {note ? <Panel>{note}</Panel> : null}
            <HrProfile
              employee={emp}
              companyName={company}
              banks={banks}
              onSave={onSave}
              sigOpen={sigOpen}
              onSigStart={() => setSigOpen(true)}
              onSigClearSaved={onSigClearSaved}
              onSigSave={onSigSave}
              onSigWipe={onSigWipe}
              onSigCancel={onSigCancel}
              onSigUpload={onSigUpload}
              onPwModal={() => openPasswordModal(false)}
            />
          </>
        )}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel"><div className="muted" style={{ padding: '18px' }}>{children}</div></div>;
}

/**
 * The strangler is explicitly "both versions reachable and comparable side by side" — nothing was
 * deleted from hros.html and the legacy screen is still the one staff use.
 */
function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React migration.</b> The screen staff use is still{' '}
        <a href={LEGACY()}>hros.html · My Profile</a>, unchanged. This page renders the same data from the
        same session and is diffed against the same golden. The signature pad and the change-password
        dialog are ported and run here.
      </div>
    </div>
  );
}
