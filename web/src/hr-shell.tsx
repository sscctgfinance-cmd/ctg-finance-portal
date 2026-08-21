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

import { Ic } from './icons';
import { href, type NavEntry } from './nav';
import { BASE_PATH } from './portal';

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
  /** `hrPwModal()` — hros.html:1317. Opens the ported credentials modal; see src/password-modal.tsx. */
  onChangePassword: () => void;
  onSignOut: () => void;
  children: ReactNode;
}

/**
 * The whole HR shell — hros.html:1105-1137.
 *
 * "Change password" used to hand off to hros.html, because there was no React password dialog. There is
 * one now (src/password-modal.tsx), so it is a button that opens it — the same control the legacy foot
 * has, in the same place. Security / 2FA has no equivalent yet and is still a handoff on the Finance
 * side; HR OS's foot never had one.
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
          <button className="side-foot-btn" id="hr_pw_btn" onClick={p.onChangePassword} title="Change your sign-in password">🔑 <span className="lbl">Change password</span></button>
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
