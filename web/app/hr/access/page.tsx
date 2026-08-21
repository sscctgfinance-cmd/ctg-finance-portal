'use client';

// The route. Everything impure lives here — the session, the fetches, the state — so that
// src/hr-access.tsx stays a pure function of its props and can be diffed against the legacy golden.
// That split is the pilot's actual shape, and it is what the next 39 screens should copy:
//
//   app/<area>/<screen>/page.tsx   'use client', loads, holds state, wires handlers   — not golden-tested
//   src/<screen>.tsx              pure, props in / markup out                         — golden-tested
//
// No server component, no `app/api/`, no middleware. See next.config.mjs for why.

import { useCallback, useEffect, useState } from 'react';

import { showConfirm } from '../../../src/confirm';
import HrAccess, { type HrUsersList, type InviteState } from '../../../src/hr-access';
import { call, legacyUrl, token } from '../../../src/portal';

/** hros.html:1410 — the fallback company when the account has no Xero orgs. */
const PROCARE = 'I PROCARE MALAYSIA SDN BHD';

interface Company { tenant_id: string; tenant_name: string }

export default function HrAccessPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [data, setData] = useState<HrUsersList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [invite, setInvite] = useState<InviteState>({ role: 'employee', emp: '', email: '', name: '' });
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      // The selected company is `localStorage['hr_tenant']` (hros.html:1412) — same origin, so it is
      // already there, exactly like the token. Reading it means the React screen opens on the company
      // the operator was already looking at instead of resetting them to the first one.
      const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
      const co = await call<{ companies?: Company[] }>({ api: 'hr_companies' });
      const list = co.companies || [];
      const pick = list.find((c) => c.tenant_id === saved)
        || list.find((c) => c.tenant_name === PROCARE)
        || list[0]
        || null;
      setCompany(pick);
      setData(await call<HrUsersList>({ api: 'hr_users_list', tenant: pick ? pick.tenant_id : null }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (t) void load();
  }, [load]);

  const onRoleChange = useCallback(async (userId: string, role: string) => {
    // hros.html:1625 keeps the confirm. Changing someone's access silently is not a thing to improve away.
    if (!await showConfirm('Change access role', `Change this user to ${role}?`, 'Change', 'p')) return;
    try {
      await call({ api: 'hr_user_role_set', user_id: userId, role });
      setNotice('Access role updated');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [load]);

  const onPickEmployee = useCallback((employeeId: string) => {
    const e = (data?.employee_candidates || []).find((c) => c.id === employeeId);
    setInvite((s) => ({ ...s, emp: employeeId, email: e?.email || '', name: e?.name || '' }));
  }, [data]);

  const onInvite = useCallback(async () => {
    const email = (document.getElementById('hra_email') as HTMLInputElement | null)?.value.trim() || '';
    const name = (document.getElementById('hra_name') as HTMLInputElement | null)?.value.trim() || '';
    try {
      // hros.html:1637 — an Employee login goes through hr_rc_enable_login, which creates the account AND
      // points the hr_employees row at it; hr_user_invite deliberately refuses that role because it can
      // only make an unlinked account, and an unlinked employee signs in to "not linked to a profile".
      const r = invite.role === 'employee'
        ? await call<{ email: string; temp_password?: string; already?: boolean }>(
          { api: 'hr_rc_enable_login', employee_id: invite.emp, email: email || undefined })
        : await call<{ email: string; temp_password?: string }>(
          { api: 'hr_user_invite', email, name, role: invite.role });
      setNotice(r.temp_password
        ? `Login created for ${r.email} — one-time password: ${r.temp_password}`
        : `${r.email} already has a login`);
      setInvite({ role: invite.role, emp: '', email: '', name: '' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [invite, load]);

  return (
    <>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
        : !data || !company ? <Panel><span className="spin"></span> Loading users…</Panel>
        : (
          <>
            {notice ? <Panel>{notice}</Panel> : null}
            <HrAccess
              data={data}
              companyName={company.tenant_name}
              invite={invite}
              onRoleChange={onRoleChange}
              onInviteRoleChange={(role) => setInvite((s) => ({ ...s, role }))}
              onPickEmployee={onPickEmployee}
              onInvite={onInvite}
            />
          </>
        )}
    </>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel"><div className="muted" style={{ padding: '18px' }}>{children}</div></div>;
}

/**
 * The pilot is explicitly "both versions reachable and comparable side by side" — nothing was deleted
 * from hros.html and the legacy screen is still the one staff use. This says so on the page rather than
 * only in a PR description, and links straight at the original.
 */
function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React pilot.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('hros.html')}#tab=access`}>hros.html · Access &amp; Roles</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
