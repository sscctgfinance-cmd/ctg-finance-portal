// The ONE list of every screen in both apps, and the rules that decide who may see each one.
//
// ── WHY ONE LIST ───────────────────────────────────────────────────────────────────────────────────
// 36 screens exist: 14 HR OS views (`HR_NAV` + the two `HR_EMP_NAV`-only ones, hros.html:1475) and 22
// Finance OS tabs (the `data-t` values at app.html:1127). Fifteen have React routes; the other 21 do
// not, and they are reached by handing off to the legacy file at `#tab=<id>` (v213 — the fragment
// scheme exists precisely so a link can land on a specific screen).
//
// A nav that listed only the migrated screens would be worse than the developer link list it replaces:
// it would tell an operator that two thirds of their app had disappeared. So both navs are driven from
// this one array, with `migrated` as the only per-entry difference, and `href()` below turning that flag
// into either a React route or a legacy fragment. Adding a screen later is ONE line here, and
// tests/shell.test.tsx fails if this list and the routes on disk disagree — so it cannot be forgotten.
//
// ── WHY THE PREDICATES ARE HERE AND NOT IN THE LAYOUTS ─────────────────────────────────────────────
// Same reason `whtReachable()` lives in src/finance-wht.tsx and `claimsReachable()` in src/hr-claims.tsx:
// a permission rule that lives in a route is a rule no test can reach. These are pure mirrors of
// hros.html:1361-1368 + :1508 and app.html:1420-1439, and the shell test pins the WITHHELD direction of
// each one. They gate what the nav ADVERTISES; the server is the boundary (every `wht_*` handler wants
// superAdmin, finance.ts:1194), and each migrated screen carries its own gate as well.

import { BASE_PATH } from './portal';

export interface NavEntry {
  app: 'hr' | 'finance';
  /** The screen's id: an HR `HR_NAV` view name, or a Finance tab's `data-t`. */
  id: string;
  /** HR: the `ICONS` key (hros.html:1219). Finance tabs carry an emoji in their label instead. */
  icon?: string;
  label: string;
  /** HR: the `side-group` heading. Finance: the `data-cat` category. */
  group: string;
  /** HR: the page-head sub-line, also the entry's `title=`. Finance has none. */
  sub?: string;
  /** HR employee mode: the short label the mobile tab bar uses (`HR_MOB_SHORT`, hros.html:1519). */
  short?: string;
  /** Has a React route at `/<app>/<id>/`. False → hand off to the legacy file at `#tab=<id>`. */
  migrated: boolean;
}

/** `HR_NAV` — hros.html:1475. Order, labels, icons, groups and sub-lines verbatim. */
export const HR_NAV: NavEntry[] = [
  { app: 'hr', id: 'dashboard', icon: 'dashboard', label: 'Dashboard', group: 'Insights', sub: 'Company-wide people, payroll, attendance & cost analytics', migrated: true },
  { app: 'hr', id: 'employees', icon: 'employees', label: 'Employees', group: 'People', sub: 'Your workforce master — profiles, pay & statutory setup', migrated: true },
  { app: 'hr', id: 'attendance', icon: 'clock', label: 'Attendance', group: 'People', sub: 'Clock-in records, hours & timesheet corrections', migrated: true },
  { app: 'hr', id: 'leave', icon: 'leave', label: 'Leave', group: 'People', sub: 'Review and approve leave requests', migrated: true },
  { app: 'hr', id: 'claims', icon: 'claims', label: 'Claims', group: 'People', sub: 'Review and approve expense claims', migrated: true },
  { app: 'hr', id: 'expenses', icon: 'expenses', label: 'Reimbursement', group: 'People', sub: 'Employee expense claims, receipts & multi-level approval', migrated: true },
  { app: 'hr', id: 'payroll', icon: 'payroll', label: 'Payroll', group: 'Payroll', sub: 'Run monthly payroll, statutory files & payslips', migrated: true },
  { app: 'hr', id: 'calculator', icon: 'calculator', label: 'Calculator', group: 'Payroll', sub: 'Quick Malaysia salary & statutory calculator', migrated: true },
  { app: 'hr', id: 'yearend', icon: 'yearend', label: 'Year-end', group: 'Payroll', sub: 'Borang EA, Form E and CP8D statements', migrated: true },
  { app: 'hr', id: 'approvals', icon: 'flow', label: 'Approvals', group: 'Admin', sub: 'Configure the multi-level approval chain for leave & reimbursement', migrated: true },
  { app: 'hr', id: 'access', icon: 'shield', label: 'Access & Roles', group: 'Admin', sub: 'Manage who can sign in to HR OS and their access level', migrated: true },
  { app: 'hr', id: 'profile', icon: 'user', label: 'My Profile', group: 'Me', sub: 'Your own details, password and signature', short: 'Profile', migrated: true },
];

/** `HR_EMP_NAV` — hros.html:1490. `short` is `HR_MOB_SHORT` (hros.html:1519). */
export const HR_EMP_NAV: NavEntry[] = [
  { app: 'hr', id: 'clock', icon: 'clock', label: 'Time Clock', group: 'Me', sub: 'Clock in / out and see your hours', short: 'Clock', migrated: true },
  { app: 'hr', id: 'leave', icon: 'leave', label: 'Leave', group: 'Me', sub: 'Apply for leave and check your balance', short: 'Leave', migrated: true },
  { app: 'hr', id: 'expenses', icon: 'expenses', label: 'Reimbursement', group: 'Me', sub: 'Submit and track your expense claims', short: 'Claims', migrated: true },
  { app: 'hr', id: 'payslip', icon: 'payslip', label: 'Payslip', group: 'Me', sub: 'View and download your monthly payslips', short: 'Payslip', migrated: true },
  { app: 'hr', id: 'profile', icon: 'user', label: 'My Profile', group: 'Me', sub: 'View and update your personal details', short: 'Profile', migrated: true },
];

/** The four `.tab-cat` buttons — app.html:1119. `id` is the `data-cat` every tab below keys off. */
export const FINANCE_CATS = [
  { id: 'dashboard', label: '📊 Dashboard' },
  { id: 'operations', label: '🧠 Finance OS' },
  { id: 'data', label: '🏢 Master Data' },
  { id: 'admin', label: '⚙ Admin' },
];

/** The 22 `.tab` divs — app.html:1127. Order, emoji and labels verbatim. */
export const FINANCE_NAV: NavEntry[] = [
  { app: 'finance', id: 'cfo', label: '🎯 CFO Cockpit', group: 'dashboard', migrated: false },
  { app: 'finance', id: 'overview', label: '📊 Overview', group: 'dashboard', migrated: false },
  { app: 'finance', id: 'pnl', label: '📑 P&L Analysis', group: 'dashboard', migrated: true },
  { app: 'finance', id: 'approvals', label: '✅ Approvals', group: 'operations', migrated: true },
  { app: 'finance', id: 'collections', label: '📨 Collections', group: 'operations', migrated: true },
  { app: 'finance', id: 'upload', label: '⬆ Upload', group: 'operations', migrated: true },
  { app: 'finance', id: 'ocr', label: '🤖 Smart OCR', group: 'operations', migrated: true },
  { app: 'finance', id: 'o2o', label: '💊 O2O Billing', group: 'operations', migrated: true },
  { app: 'finance', id: 'qinv', label: '🧾 Quick Invoice', group: 'operations', migrated: true },
  { app: 'finance', id: 'selfbill', label: '🧑 Personal Invoices', group: 'operations', migrated: true },
  { app: 'finance', id: 'wht', label: '🌏 Withholding Tax', group: 'operations', migrated: true },
  { app: 'finance', id: 'recon', label: '🏦 Bank Rec', group: 'operations', migrated: true },
  { app: 'finance', id: 'gateway', label: '🔁 Gateway → Xero', group: 'operations', migrated: true },
  { app: 'finance', id: 'bankfeed', label: '🔗 Bank Feed', group: 'operations', migrated: true },
  { app: 'finance', id: 'salesrecon', label: '📊 Sales Reconciliation', group: 'operations', migrated: true },
  { app: 'finance', id: 'close', label: '📋 Close', group: 'operations', migrated: true },
  { app: 'finance', id: 'calendar', label: '📅 Calendar', group: 'operations', migrated: true },
  { app: 'finance', id: 'ap', label: '📧 AP Inbox', group: 'operations', migrated: false },
  { app: 'finance', id: 'info', label: '🏢 Company Info', group: 'data', migrated: false },
  { app: 'finance', id: 'pharm', label: '🏪 Pharmacies', group: 'data', migrated: true },
  { app: 'finance', id: 'users', label: '👥 Users', group: 'admin', migrated: true },
  { app: 'finance', id: 'ctgaccess', label: '🔐 CTG Access', group: 'admin', migrated: true },
];

/** Every screen in both apps, migrated or not. */
export const ALL_SCREENS: NavEntry[] = [
  ...HR_NAV,
  ...HR_EMP_NAV.filter((e) => !HR_NAV.some((a) => a.id === e.id)),   // clock + payslip are employee-only
  ...FINANCE_NAV,
];

/**
 * Where an entry goes.
 *
 * Migrated → the React route, which is `/<app>/<id>/` and nothing else: the id is the `data-t` / view
 * name, the route segment, the `#tab=` fragment and the golden's name, all one string (CLAUDE.md).
 * Not migrated → the legacy file at that screen's fragment, which is exactly what `#tab=<id>` was added
 * for. Both go through BASE_PATH, so there is still not one root-absolute path written by hand.
 */
export function href(e: NavEntry): string {
  if (e.migrated) return `${BASE_PATH}/${e.app}/${e.id}/`;
  return `${BASE_PATH}/${e.app === 'hr' ? 'hros.html' : 'app.html'}#tab=${e.id}`;
}

// ── HR OS: the role flags ──────────────────────────────────────────────────────────────────────────

export interface HrRole {
  /** `HR_MASTER` — hros.html:1362. The only role that may reach Access & Roles. */
  master: boolean;
  /** `HR_VIEWER` — hros.html:1361. Read-only: no write controls, no approval config. */
  viewer: boolean;
  /** `HR_EMP_MODE` — hros.html:1368. Swaps the whole nav for the five personal screens. */
  empMode: boolean;
}

/**
 * `enterApp()` — hros.html:1361-1368. One role string in, the three flags out.
 *
 * Note the shape: employee mode is the DEFAULT for anything that is not one of the three admin roles,
 * so an unknown or empty role lands in employee mode rather than in the admin nav. That is the safe
 * direction and it is the legacy behaviour; keep it that way.
 */
export function hrRole(role: string | null | undefined): HrRole {
  const r = role || '';
  return {
    master: r === 'admin',
    viewer: r === 'viewer',
    empMode: !!r && r !== 'admin' && r !== 'hr_admin' && r !== 'viewer',
  };
}

/**
 * `hrSidebar()`'s filter — hros.html:1508. The entries this login may see, in order.
 *
 * `hasEmployee` is `RC.me && RC.me.employee`: My Profile hangs a signature on an employee record, so it
 * is hidden for a login that has none. In the legacy app that is also a timing artefact — RC is not
 * loaded until Reimbursement is first opened, which is why `tests/golden/hr.access.html` holds a nav of
 * eleven entries and `hr.profile.html` one of twelve. The React shell asks for it up front; the RULE is
 * the same and both states are pinned in the shell test against those two goldens.
 */
export function hrNavFor(role: HrRole, hasEmployee: boolean): NavEntry[] {
  if (role.empMode) return HR_EMP_NAV;
  return HR_NAV.filter((t) =>
    (t.id !== 'access' || role.master) &&
    (t.id !== 'approvals' || !role.viewer) &&
    (t.id !== 'profile' || hasEmployee));
}

// ── Finance OS: the permission set ─────────────────────────────────────────────────────────────────

export interface Perms {
  role?: string;
  label?: string;
  features?: string[];
  manage_users?: boolean;
}

/**
 * `showApp()`'s per-tab visibility pass — app.html:1420-1434, transcribed branch for branch.
 *
 * READ THE SHAPE, not the intent: `users` is a STANDALONE `if`, and the `if/else if` chain restarts at
 * `ctgaccess`. So `users` is toggled by `!canManage` and then falls through to the chain's final `else`,
 * where `feats.indexOf('users')<0` OVERWRITES it. The effective rule for `users` is therefore its
 * feature flag, not `manage_users`. CLAUDE.md flags this and says whoever ports the Users tab owns it;
 * this is the nav, so it is mirrored as-is and pinned in the shell test. Changing it is a behaviour
 * change, not a migration detail.
 *
 * `ocr` and `ap` are hidden unconditionally (Claude vision credits, 2026-07-09) — the legacy comments
 * say to flip `true` → `!canManage` to re-enable, and the same flip applies here.
 */
export function financeTabHidden(id: string, perms: Perms | null | undefined): boolean {
  const feats = (perms && perms.features) || [];
  const canManage = !!(perms && perms.manage_users);
  let hidden = false;
  if (id === 'users') hidden = !canManage;                                       // app.html:1422
  if (id === 'ctgaccess') hidden = !canManage;                                   // app.html:1423 — new chain
  else if (id === 'info' || id === 'pharm' || id === 'calendar') hidden = false; // gated server-side
  else if (id === 'ocr' || id === 'ap') hidden = true;                           // credits exhausted
  else if (id === 'selfbill' || id === 'wht' || id === 'gateway' || id === 'bankfeed' || id === 'salesrecon') hidden = !canManage;
  else hidden = feats.indexOf(id) < 0;                                           // ← 'users' lands here too
  return hidden;
}

/** The Finance tabs this login may see, in order. */
export function financeNavFor(perms: Perms | null | undefined): NavEntry[] {
  return FINANCE_NAV.filter((t) => !financeTabHidden(t.id, perms));
}

/** `showApp()`'s category pass — app.html:1437. A category with no visible tab is hidden. */
export function financeCatsFor(perms: Perms | null | undefined): typeof FINANCE_CATS {
  const visible = financeNavFor(perms);
  return FINANCE_CATS.filter((c) => visible.some((t) => t.group === c.id));
}

/**
 * `showApp()`'s landing tab — app.html:1447. Overview if this login has it, else its first feature,
 * else Users for a manager. Used by the Finance shell's index to point at somewhere reachable rather
 * than at a tab the operator would be refused.
 */
export function financeLandingTab(perms: Perms | null | undefined): string {
  const feats = (perms && perms.features) || [];
  const canManage = !!(perms && perms.manage_users);
  return feats.indexOf('overview') >= 0 ? 'overview' : (feats[0] || (canManage ? 'users' : 'overview'));
}
