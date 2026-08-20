'use client';

// HR OS's route tree: the stylesheet scoping, and the shell every HR screen now sits inside.
//
// ── THE STYLESHEET SCOPING IS UNCHANGED, AND MUST STAY THAT WAY ────────────────────────────────────
// hros.html's own stylesheet, extracted at build time by scripts/sync-legacy-css.mjs. Generated, never
// edited, never committed — a migrated screen has to look like the screen it replaces, and a hand-copied
// stylesheet is a second source of truth that starts drifting the day it is written.
//
// It is imported HERE and not in the root layout because app.html ships a different stylesheet and 38 of
// its selectors — `:root`, `body`, `.btn`, `.panel`, `.pill`, `.bigtable td` among them — carry different
// declarations. One stylesheet for both apps means whichever loads second silently restyles the other's
// screens, and nothing would catch it (the parity tests compare markup, not CSS). Scoping it to this
// route tree means exactly one legacy stylesheet reaches any page. See the generator's header.
//
// ── EVERYTHING IMPURE LIVES HERE ───────────────────────────────────────────────────────────────────
// Same split the fourteen migrated screens use: session, fetches and browser APIs in the route, pure
// markup in `src/`. `src/hr-shell.tsx` is a pure function of its props for exactly that reason — it is
// what the shell test diffs against the `#hr_nav` and `#emp-mobnav` sections of the committed goldens.
import './legacy.css';
import '../../src/shell.css';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import HrShell, { type Company } from '../../src/hr-shell';
import { hrNavFor, hrRole, type HrRole, type NavEntry } from '../../src/nav';
import { BASE_PATH, call, token } from '../../src/portal';

/** hros.html:1410 — the fallback company when the account has no Xero orgs. */
const PROCARE = 'I PROCARE MALAYSIA SDN BHD';
const HR_PROCARE_TENANT = '99911869-9e91-4572-b7dc-4db51b45b6a9';

const read = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export default function HrLayout({ children }: { children: ReactNode }) {
  // `/hr/leave/` → 'leave'. The route segment IS the `HR_NAV` view id — one string, no mapping table.
  const view = (usePathname() || '').split('/').filter(Boolean)[1] || '';

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [role, setRole] = useState<HrRole | null>(null);
  const [hasEmployee, setHasEmployee] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tenant, setTenant] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // `enterApp()` — hros.html:1359-1360. The saved theme and collapse state are applied to the shell
    // on entry. They are applied on MOUNT here rather than before paint, so a dark-mode operator sees
    // one light frame first; the legacy app avoids that with a blocking inline script in <head>, which
    // the root layout cannot write because it does not know which of the two apps' keys to read.
    const t = read('hros_theme') === 'dark' ? 'dark' : 'light';
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
    setCollapsed(read('hros_nav_collapsed') === '1');

    const signed = !!token();
    setSignedIn(signed);
    if (!signed) return;

    void (async () => {
      // `enterApp()` — hros.html:1361-1368. One role string decides the whole nav.
      const me = await call<{ user?: { role?: string } }>({ api: 'me' }).catch(() => null);
      const r = hrRole(me?.user?.role);
      setRole(r);

      // `hrEmpBoot()` (hros.html:1377) vs `hrBootCompanies()` (hros.html:1409): an employee works in one
      // company and never sees the picker, so only the admin path asks for the list.
      if (!r.empMode) {
        const co = await call<{ companies?: Company[] }>({ api: 'hr_companies' }).catch(() => null);
        const list = (co?.companies || []).length ? co!.companies! : [{ tenant_id: HR_PROCARE_TENANT, tenant_name: PROCARE }];
        const saved = read('hr_tenant');
        const pick = list.find((c) => c.tenant_id === saved) || list.find((c) => c.tenant_id === HR_PROCARE_TENANT) || list[0];
        setCompanies(list);
        setTenant(pick.tenant_id);
        setCompanyName(pick.tenant_name);
      }

      // `RC.me && RC.me.employee` — the condition `hrSidebar()` shows My Profile on (hros.html:1508).
      // The legacy app only knows the answer once Reimbursement has been opened, because that is when
      // `hrRCBoot()` runs; asking up front applies the same RULE without the timing artefact.
      const rc = await call<{ me?: { employee?: unknown }; tenant_name?: string }>({ api: 'hr_rc_config' }).catch(() => null);
      setHasEmployee(!!rc?.me?.employee);
      if (r.empMode) {
        setCompanies([{ tenant_id: '', tenant_name: rc?.tenant_name || 'My company' }]);
        setCompanyName(rc?.tenant_name || 'My company');
      }
    })();
  }, []);

  // `hrRenderMobileChrome()`'s first line — hros.html:1519. The whole employee mobile chrome hangs off
  // a class on BODY (hros.html:331-342): it hides the sidebar, shows the top bar and the bottom tab bar,
  // and re-pads `#hr_main` past both. `body` belongs to the root layout, so this is the one thing the
  // shell cannot express as markup and the route has to do to the document.
  useEffect(() => {
    const on = !!role?.empMode;
    document.body.classList.toggle('hr-emp', on);
    return () => document.body.classList.remove('hr-emp');
  }, [role]);

  // Both toggles write to localStorage and to <html>, so neither can live inside a state updater —
  // an updater must be pure, and React may run it twice.

  /** `hrToggleTheme()` — hros.html:1250. Same key, same two values. */
  const onToggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    write('hros_theme', next);
    document.documentElement.setAttribute('data-theme', next);
  }, [theme]);

  /** `hrToggleNav()` — hros.html:1251. Same key, same '1' / '' values. */
  const onToggleNav = useCallback(() => {
    setCollapsed(!collapsed);
    write('hros_nav_collapsed', collapsed ? '' : '1');
  }, [collapsed]);

  /**
   * `hrPickCompany()` — hros.html:1419. The legacy one wipes every per-company cache by hand, because
   * everything lives in one long-lived page; here each screen fetches its own data keyed on the same
   * `hr_tenant` key, so writing the key and reloading is the same thing with nothing left to forget.
   * The legacy unsaved-payroll guard (`hrGridConfirmDiscard`) belongs to the legacy payroll grid.
   */
  const onPickCompany = useCallback((tid: string) => {
    if (!tid || tid === tenant) return;
    write('hr_tenant', tid);
    location.reload();
  }, [tenant]);

  /** `logout()` — hros.html. Same key, same destination. */
  const onSignOut = useCallback(() => {
    try { localStorage.removeItem('ctg_portal_token'); } catch { /* private mode */ }
    location.href = `${BASE_PATH}/index.html`;
  }, []);

  // Not signed in (or still finding out): NO chrome. The nav names every screen in the app and which
  // ones an operator may reach, so it is not something to paint for a visitor who has not proved who
  // they are — each screen already renders its own "sign in on this origin" panel underneath.
  if (!signedIn) return <main style={{ padding: '28px 34px 64px' }}>{children}</main>;

  const entries: NavEntry[] = role ? hrNavFor(role, hasEmployee) : [];
  return (
    <HrShell
      view={view}
      entries={entries}
      empMode={!!role?.empMode}
      viewer={!!role?.viewer}
      master={!!role?.master}
      companies={companies}
      tenant={tenant}
      companyName={companyName}
      theme={theme}
      collapsed={collapsed}
      onPickCompany={onPickCompany}
      onToggleTheme={onToggleTheme}
      onToggleNav={onToggleNav}
      onSignOut={onSignOut}
    >{children}</HrShell>
  );
}
