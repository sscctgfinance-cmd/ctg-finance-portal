// Finance OS's chrome: the top bar, the company bar and the two-level tab nav.
//
// A PORT, not a redesign — element for element from app.html:1083-1152, with the category row, the tab
// order, the emoji and the labels exactly as they are there. Pure: props in, markup out, with the
// session, the fetches and the browser APIs in app/finance/layout.tsx.
//
// ── FINANCE CHROME IS NOT HR CHROME, AND IS NOT SHARED WITH IT ─────────────────────────────────────
// The two apps' chrome genuinely differs — a sticky 248px sidebar with grouped links against a top bar
// with a category row and an underlined tab strip — and they disagree on 38 CSS selectors besides
// (scripts/sync-legacy-css.mjs's header). report.md §3.5 says to duplicate the bar of static markup
// rather than build a mechanism for sharing it, and that is right: the ONE thing the two shells share is
// src/nav.ts, the list of screens, because that is the thing that must not fall out of step.
//
// ── NOTHING IN THIS BAR HANDS OFF ANY MORE ─────────────────────────────────────────────────────────
// Alerts (`toggleNotif`), Security (`openSecurityModal`), Export (`exportCurrent`) and Change Password
// (`openPwModal`) were all anchors into app.html, because none of the four had a React equivalent. All
// four are ported — src/finance-alerts.tsx, src/finance-security.tsx, src/finance-export.ts and
// src/password-modal.tsx — so every control in the top bar is a control, and this shell renders no link
// back into the app it replaces. The six advanced Xero tools inside `finance.users` are what is left.

import type { ReactNode } from 'react';

import { FINANCE_CATS, href, type NavEntry } from './nav';
import { BASE_PATH } from './portal';

/** `roleLabel(r)` — app.html:1396. `PERMS.label` wins when the server sent one (app.html:1418). */
export function roleLabel(role: string | null | undefined): string {
  return role === 'admin' ? 'Admin' : role === 'approver' ? 'Approver' : 'Viewer';
}

export interface Company { tenant_id: string; tenant_name: string }

export interface FinanceShellProps {
  /** The active tab's `data-t`. '' on the Finance index, which belongs to no tab. */
  active: string;
  /** Already filtered by `financeNavFor()`; the shell does not decide who sees what. */
  tabs: NavEntry[];
  /** Already filtered by `financeCatsFor()`. */
  cats: typeof FINANCE_CATS;
  who: string;
  role: string;
  companies: Company[];
  /** '' is the "— All Companies —" option, which is what puts the bar in `data-scope="all"`. */
  company: string;
  /** `navigator.onLine` — app.html:1341. */
  online: boolean;
  /** Decides the theme button's glyph and label — `syncThemeBtn()`, app.html:1023. */
  theme: 'light' | 'dark';
  onPickCompany: (tenantId: string) => void;
  onToggleTheme: () => void;
  onRefresh: () => void;
  /** `openPwModal()` — app.html:2608. Opens the ported credentials modal. */
  onChangePassword: () => void;
  /** `toggleNotif(event)` — app.html:2744. The panel itself is rendered by the layout, at body level. */
  onToggleAlerts: () => void;
  /** `renderNotifBadge()` — app.html:2732. null hides the badge; '9+' is the legacy's own cap. */
  alertBadge: string | null;
  /** `openSecurityModal()` — app.html:2539. */
  onSecurity: () => void;
  /** `exportCurrent()` — app.html:5275. */
  onExport: () => void;
  onSignOut: () => void;
  children: ReactNode;
}

/** The category an entry belongs to decides which tabs are on screen — `tabCat()`, app.html:1459. */
function catOf(tabs: NavEntry[], active: string, cats: typeof FINANCE_CATS): string {
  return tabs.find((t) => t.id === active)?.group || cats[0]?.id || 'dashboard';
}

/** Where a category button goes: its first VISIBLE tab — `tabCat()`'s `firstVisible`, app.html:1466. */
function catHref(tabs: NavEntry[], cat: string): string {
  const first = tabs.find((t) => t.group === cat);
  return first ? href(first) : `${BASE_PATH}/app.html`;
}

export default function FinanceShell(p: FinanceShellProps) {
  const cat = catOf(p.tabs, p.active, p.cats);
  // `syncCompanyScope()` — app.html:1531. '' is the all-companies option; reading a five-company
  // aggregate and posting into ONE org are different kinds of act and the control looked identical.
  const one = !!p.company.trim();
  return (
    <div id="app"><div className="wrap">

      <div className="top">
        <div className="brand">
          {/* app.html inlines this as a ~32 KB base64 data URI. Decoded into web/public/ctg-logo.png
              once rather than re-encoded here: a 43 KB string literal in a source file is unreadable and
              unreviewable, and the CTG mark is not a thing that drifts. */}
          <img className="brand-logo" src={`${BASE_PATH}/ctg-logo.png`} alt="CTG" />
          <div>
            <h1>CTG Finance Portal</h1>
            <div className="sub">Live from Xero · Shown by your permissions</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span id="conn-indicator" aria-label="Connection status"
              title={p.online ? 'Online' : 'Offline — changes will be queued until connection returns'}
              style={{
                display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
                background: p.online ? 'var(--green-soft)' : 'var(--red-soft)',
                boxShadow: p.online ? '0 0 0 3px rgba(126,224,160,.12)' : '0 0 0 3px rgba(239,68,68,.18)',
                transition: 'background .2s,box-shadow .2s',
              }} />
            <span className="who" id="who-name"><b>{p.who}</b></span>
            <span className="role-chip" id="who-role">{p.role}</span>
          </div>
          {/* `syncThemeBtn()` — app.html:1023. The glyph is the mode you would switch TO, and the
              label says so; a static ☀️ is wrong half the time. */}
          <button className="btn theme-btn" id="theme-btn" onClick={p.onToggleTheme} style={{ padding: '8px 11px' }}
            aria-label={p.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            title={p.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >{p.theme === 'light' ? '🌙' : '☀️'}</button>
          {/* app.html:1103. `stopPropagation` is load-bearing: the document-level listener at
              app.html:2748 closes the panel on any click outside it, and the bell is outside it. */}
          <button className="btn bell" id="notif-btn" aria-label="Notifications" title="Alerts"
            onClick={(e) => { e.stopPropagation?.(); p.onToggleAlerts(); }}
          >🔔<span className="bell-badge" id="notif-badge"
            style={p.alertBadge ? { display: 'flex' } : { display: 'none' }}>{p.alertBadge}</span></button>
          <button className="btn" id="sec-btn" onClick={p.onSecurity} title="Two-factor authentication">🔐 Security</button>
          <button className="btn" id="pw-btn" onClick={p.onChangePassword} title="Change your sign-in password">Change Password</button>
          <button className="btn d" onClick={p.onSignOut}>Sign Out</button>
        </div>
      </div>

      {/* The bar carries data-scope="all" | "one". Reading a five-company aggregate and posting into
          ONE company's Xero are different kinds of act, and the control looked identical in both
          states — the expensive mistake here is issuing into the wrong organisation. */}
      <div className="bar" id="cobar" data-scope={one ? 'one' : 'all'}>
        <span className="co-label">Company</span>
        <select id="company" value={p.company} style={{ flex: 1, maxWidth: '320px' }}
          onChange={(e) => p.onPickCompany((e.target as HTMLSelectElement).value)}>
          <option value="">— All Companies —</option>
          {p.companies.map((c) => <option key={c.tenant_id} value={c.tenant_id}>{c.tenant_name}</option>)}
        </select>
        <span id="co_scope" className="co-scope">{one ? 'Posting into this company' : 'All companies · read only'}</span>
        <button className="btn p" onClick={p.onRefresh}>↺ Refresh</button>
        <button className="btn" id="export-btn" onClick={p.onExport} title="Export this view to Excel">⬇ Export</button>
        <div id="last-refresh" className="status-bar" style={{ margin: 0 }}></div>
      </div>

      {/* Two-level nav: category row → sub-tabs row. Grouping keeps 22 destinations from looking scattered. */}
      <div className="tab-cats">
        {p.cats.map((c) => (
          <a key={c.id} className={'tab-cat' + (c.id === cat ? ' active' : '')} data-cat={c.id}
            href={catHref(p.tabs, c.id)}>{c.label}</a>
        ))}
        {/* No data-cat — a launcher, always visible (app.html:1440). */}
        <a className="tab-cat" href={`${BASE_PATH}/hros.html`}
          title="Open HR OS — payroll, leave & claims (separate app, same login)"
          style={{ marginLeft: 'auto', color: '#8FB8DC', boxShadow: '0 0 0 1px rgba(91,155,213,.32) inset' }}>👥 HR OS →</a>
      </div>
      <div className="tabs" id="sub-tabs">
        {p.tabs.map((t) => (
          <a key={t.id} className={'tab' + (t.id === p.active ? ' active' : '') + (t.group === cat ? '' : ' cat-hide')}
            data-t={t.id} data-cat={t.group} href={href(t)}>{t.label}</a>
        ))}
      </div>

      {p.children}
    </div></div>
  );
}
