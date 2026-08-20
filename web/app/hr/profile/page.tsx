'use client';

// The route. Everything impure lives here — the session, the fetches, the DOM read-back, the POST — so
// that src/hr-profile.tsx stays a pure function of its props and can be diffed against the legacy
// golden. Same split as the pilot:
//
//   app/<area>/<screen>/page.tsx   'use client', loads, holds state, wires handlers   — not golden-tested
//   src/<screen>.tsx              pure, props in / markup out                         — golden-tested
//
// TWO handlers hand off to the legacy screen rather than being re-implemented, and both are shell or
// device work rather than screen work:
//   • `hrSigStart()` (hros.html:3326) opens a <canvas> and binds mouse/touch listeners to draw on it.
//     Imperative device code, no golden, and `hrSigSave()` reads `toDataURL()` back off the canvas.
//   • `hrPwModal()` (hros.html:1316) is the app shell's modal, which `web/` does not have yet
//     (report.md §3.5 — re-implement the chrome once in the Next shell, not per screen).
// Handing off is honest: the legacy screen is still the one staff use and it does both properly.

import { useCallback, useEffect, useRef, useState } from 'react';

import HrProfile, { profileBody, type Bank, type ProfileEmployee } from '../../../src/hr-profile';
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
  const formRef = useRef<HTMLElement>(null);

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

  /** `hrSigClearSaved()` — hros.html:3377. Destructive, so it keeps the legacy confirm. */
  const onSigClearSaved = useCallback(async () => {
    if (!confirm('Remove your signature? Claim forms will print a blank line for you to sign by hand.')) return;
    try {
      await call({ api: 'hr_signature_save', signature: null });
      setNote('Signature removed');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [load]);

  const toLegacy = useCallback(() => { window.location.href = LEGACY(); }, []);

  return (
    <div id="app" style={{ display: 'flex', minHeight: '100vh', alignItems: 'stretch' }}>
      <main ref={formRef} style={{ flex: 1, minWidth: 0, padding: '28px 34px 64px' }}>
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
                onSigStart={toLegacy}
                onSigClearSaved={onSigClearSaved}
                onPwModal={toLegacy}
              />
            </>
          )}
      </main>
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
        same session and is diffed against the same golden. Drawing a signature and changing your
        password open the legacy screen.
      </div>
    </div>
  );
}
