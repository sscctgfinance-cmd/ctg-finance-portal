// HR OS's chrome: the sidebar, and employee mode's mobile top bar + bottom tab bar.
//
// A PORT, not a redesign. Element for element from hros.html:1105-1137 (the static shell), :1508
// (`hrSidebar()`) and :1520 (`hrRenderMobileChrome()`), down to the class names, the icon sizes and the
// order of the foot buttons. Nothing here is improved: the shell has to look like the app it wraps, or
// the side-by-side comparison the whole strangler rests on stops meaning anything.
//
// ── PURE, like every migrated screen ───────────────────────────────────────────────────────────────
// Props in, markup out. No fetch, no localStorage, no window — app/hr/layout.tsx holds all of that, the
// same split every `src/<screen>.tsx` uses. That is what lets `HrSideNav` and `HrEmpMobNav` below be
// rendered on their own and diffed against the `#hr_nav` and `#emp-mobnav` sections the 18 HR goldens
// already carry (tests/shell.test.tsx). The chrome is explicitly outside the screen-by-screen strangler
// (report.md §3.5, and the header of tests/hr-access.parity.test.tsx says so), so those sections are not
// its contract — but they are free evidence of what the nav renders, and they are used as such.
//
// ── THE NAV IS ANCHORS, NOT BUTTONS ────────────────────────────────────────────────────────────────
// The legacy nav is `<button onclick="hrNav('leave')">`, because there was one page. Here half the
// destinations are React routes and half are handoffs into hros.html, and both are URLs — so both are
// `<a href>`. That also means middle-click, hover-to-see-target and Back all work, which they did not
// before. Everything else about the element is identical, which is why the golden diff in the shell test
// only has to unify the tag name.

import { Fragment, type ReactNode } from 'react';

import { href, type NavEntry } from './nav';
import { BASE_PATH } from './portal';

/** `ICONS` — hros.html:1219. Only the keys this chrome draws; the path data is verbatim. */
const ICONS: Record<string, ReactNode> = {
  dashboard: <path d="M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z" />,
  employees: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  leave: <><path d="M12 22s7-8 7-13a7 7 0 0 0-14 0c0 5 7 13 7 13z" /><path d="M12 6v6" /></>,
  claims: <><path d="M14 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  expenses: <><rect x="2" y="7" width="20" height="13" rx="1.5" /><path d="M2 11h20M6 3h12" /></>,
  payroll: <><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
  payslip: <><path d="M6 2h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" /><path d="M14 2v6h6M9 13h6M9 17h4" /></>,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  flow: <><circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="12" r="2.4" /><path d="M8.4 6H13a2.6 2.6 0 0 1 2.6 2.6V10M8.4 18H13a2.6 2.6 0 0 0 2.6-2.6V14" /></>,
  calculator: <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M8 19h4" /></>,
  yearend: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />,
};

/** `ic(n,s)` — hros.html:1241. Returns nothing for an unknown key, exactly as the legacy one does. */
function Ic({ n, s = 18 }: { n?: string; s?: number }) {
  const d = n ? ICONS[n] : undefined;
  if (!d) return null;
  return (
    <svg className="ic" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
  );
}

/**
 * `hrSidebar()`'s inner HTML — hros.html:1508. A group heading is emitted when the group CHANGES, not
 * once per distinct group, which is why it is tracked positionally here rather than grouped up front:
 * `HR_EMP_NAV` is five entries all in "Me" and gets exactly one heading.
 */
export function HrSideNav({ entries, view }: { entries: NavEntry[]; view: string }) {
  let lastG: string | null = null;
  return (
    <>
      {entries.map((e) => {
        const head = e.group && e.group !== lastG ? e.group : null;
        if (head) lastG = e.group;
        return (
          // A keyed Fragment, not a wrapper element: `hrSidebar()` emits the group heading and the
          // link as SIBLINGS, and any real element around them would be a node the legacy nav has not
          // got — which the golden diff in the shell test would (correctly) fail on.
          <Fragment key={e.id}>
            {head ? <div className="side-group">{head}</div> : null}
            <a className={'side-link' + (view === e.id ? ' on' : '')} href={href(e)} title={e.label}>
              <Ic n={e.icon} s={19} /><span className="lbl">{e.label}</span>
            </a>
          </Fragment>
        );
      })}
    </>
  );
}

/** `hrRenderMobileChrome()`'s inner HTML — hros.html:1523. Employee mode only. */
export function HrEmpMobNav({ entries, view }: { entries: NavEntry[]; view: string }) {
  return (
    <>
      {entries.map((e) => (
        <a key={e.id} className={'mob-tab' + (view === e.id ? ' on' : '')} href={href(e)} aria-label={e.label}>
          <span className="mt-ic"><Ic n={e.icon} s={22} /></span>{e.short || e.label}
        </a>
      ))}
    </>
  );
}

export interface Company { tenant_id: string; tenant_name: string }

export interface HrShellProps {
  /** The active nav id — the route's own screen. '' on the HR index. */
  view: string;
  /** Already filtered by `hrNavFor()`; the shell does not decide who sees what. */
  entries: NavEntry[];
  /** `HR_EMP_MODE` — swaps to `HR_EMP_NAV`, hides the company box, shows the mobile chrome. */
  empMode: boolean;
  /** `HR_VIEWER` — puts `viewer-mode` on `#app`, which is what hides `.btn.p`/`.btn.d`/`.hr-write`. */
  viewer: boolean;
  /** `HR_MASTER` — the only role that also has the Finance Portal, so the only one shown the jump. */
  master: boolean;
  companies: Company[];
  tenant: string;
  companyName: string;
  theme: 'light' | 'dark';
  collapsed: boolean;
  onPickCompany: (tenantId: string) => void;
  onToggleTheme: () => void;
  onToggleNav: () => void;
  onSignOut: () => void;
  children: ReactNode;
}

/**
 * The whole HR shell — hros.html:1105-1137.
 *
 * ── WHAT COULD NOT BE PORTED, and why it is a link rather than a button that lies ──────────────────
 * "Change password" opens `hrPwModal()`, which is legacy-only; there is no React password modal and
 * building one is not this task. It keeps its label and its position and hands off to hros.html, the
 * same treatment the 21 unmigrated nav entries get. Removing it would be the bigger lie: an operator
 * looking for where they change their password would find nothing.
 */
export default function HrShell(p: HrShellProps) {
  return (
    <div id="app" className={p.viewer ? 'viewer-mode' : undefined}
      style={{ display: 'flex', minHeight: '100vh', alignItems: 'stretch' }}>
      <aside id="hr_side" className={'side' + (p.collapsed ? ' collapsed' : '')}>
        <div className="side-brand">
          <div className="side-brand-mark">👥</div>
          <div><div className="side-brand-name">HR OS</div><div className="side-brand-sub">CTG Payroll Suite</div></div>
        </div>
        {/* `hrEmpBoot()` hides the whole box, not just the select — hiding only the select left a
            dangling "COMPANY" heading (hros.html:1380). Employees work in one company. */}
        {p.empMode ? null : (
          <div className="side-company"><label htmlFor="hr_company">Company</label>
            <select id="hr_company" title="Xero company" value={p.tenant}
              onChange={(e) => p.onPickCompany((e.target as HTMLSelectElement).value)}>
              {p.companies.map((c) => <option key={c.tenant_id} value={c.tenant_id}>{c.tenant_name}</option>)}
            </select>
          </div>
        )}
        <nav id="hr_nav" className="side-nav"><HrSideNav entries={p.entries} view={p.view} /></nav>
        <div className="side-foot">
          <div className="side-tools">
            <button className="side-foot-btn" id="hr_theme_btn" onClick={p.onToggleTheme} title="Switch light / dark theme">
              <Ic n={p.theme === 'dark' ? 'sun' : 'moon'} s={15} />
              <span className="lbl">{p.theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <button className="side-foot-btn" onClick={p.onToggleNav} title="Collapse / expand the sidebar">↔</button>
          </div>
          {/* Only the Master Admin has the Finance Portal; an HR-only role following this would land on
              the "HR OS access only" gate (hros.html:1365). */}
          {p.master ? (
            <a className="side-foot-btn accent" href={`${BASE_PATH}/app.html`} title="Back to Finance OS (same login)">← <span className="lbl">Finance OS</span></a>
          ) : null}
          <a className="side-foot-btn" href={`${BASE_PATH}/hros.html`} title="Change your sign-in password — opens HR OS, which has the password dialog">🔑 <span className="lbl">Change password</span></a>
          <button className="side-foot-btn" onClick={p.onSignOut}><span className="lbl">Sign out</span></button>
        </div>
      </aside>
      <main id="hr_main" style={{ flex: 1, minWidth: 0, padding: '28px 34px 64px' }}>{p.children}</main>
      {/* Employee mobile chrome — hros.html:1129. Shown only on small screens, and only in employee
          mode: `body.hr-emp` plus a @media rule (hros.html:333) do the gating, which is why it is
          rendered unconditionally in that mode and never for an admin. */}
      {p.empMode ? (
        <>
          <header id="emp-mobtop">
            <div className="emp-mobtop-brand"><span className="emp-mobtop-mark">👥</span><span id="emp-mobtop-co">{p.companyName}</span></div>
            <div className="emp-mobtop-actions">
              <button id="emp-mobtop-theme" onClick={p.onToggleTheme} title="Light / dark">{p.theme === 'dark' ? '☀️' : '🌙'}</button>
              <button onClick={p.onSignOut} title="Sign out">⎋</button>
            </div>
          </header>
          <nav id="emp-mobnav"><HrEmpMobNav entries={p.entries} view={p.view} /></nav>
        </>
      ) : null}
    </div>
  );
}
