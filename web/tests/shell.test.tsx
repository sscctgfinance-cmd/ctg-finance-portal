// The app shell — the chrome that turns sixteen individually-correct screens into an application.
//
// Three things are proven here, and they are the three that make a nav either useful or a liability:
//
//   1. IT LOOKS LIKE THE NAV IT REPLACES. The 18 HR goldens each carry a `#hr_nav` section (and two
//      carry `#emp-mobnav`) — the app-wide sidebar, captured alongside the screen. The chrome is
//      explicitly outside the screen-by-screen strangler (report.md §3.5; see tests/hr-access.parity's
//      header), so those sections are not its CONTRACT — but they are a byte-level record of what
//      `hrSidebar()` renders in three distinct permission states, and they are used as such.
//   2. IT DOES NOT LIE ABOUT WHAT EXISTS. All 36 screens of both apps are in the nav, the ids come out
//      of hros.html and app.html AT RUN TIME rather than being retyped here, and the `migrated` flag is
//      checked against the routes actually on disk. A screen added to either legacy app, or a React
//      route added without a nav entry, fails here.
//   3. THE PERMISSION RULES HOLD IN THE WITHHELD DIRECTION. `canManage`, `HR_MASTER`, `HR_VIEWER` and
//      `HR_EMP_MODE` each get both directions asserted. A nav that renders an admin entry an
//      unauthorised person can click is a real defect even when the destination also refuses: it
//      advertises the existence and the location of things they cannot use.
//
// Nothing here touches a golden, a screen component, a screen's parity test, or the shared parity /
// handlers layers.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import FinanceShell from '../src/finance-shell';
import HrShell, { HrEmpMobNav, HrSideNav } from '../src/hr-shell';
import {
  ALL_SCREENS, FINANCE_NAV, HR_EMP_NAV, HR_NAV, financeCatsFor, financeNavFor, financeTabHidden,
  href, hrNavFor, hrRole, type NavEntry, type Perms,
} from '../src/nav';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';
import { goldenSection, relax, REPO } from './parity';

const HROS = readFileSync(join(REPO, 'hros.html'), 'utf8');
const APP = readFileSync(join(REPO, 'app.html'), 'utf8');

/**
 * THE ONE ALLOWANCE, and why it cannot hide anything.
 *
 * The legacy nav item is `<button onclick="hrNav('leave')">`, because there was one page and every
 * destination was a state change. Half of this nav's destinations are React routes and half are handoffs
 * into hros.html, and both are URLs — so every item is `<a href>`, which is also what makes middle-click
 * and hover-to-see-target work. This unifies the interactive tag on BOTH sides and drops `href`, so the
 * diff below compares everything else byte for byte: a renamed label, a reordered entry, a dropped group
 * heading, a wrong icon path, a moved `on` highlight and a missing `title` all still fail.
 *
 * What it deliberately cannot see is the href itself — which is why `href()` is asserted separately, for
 * all 36 screens, in "every screen is reachable" below. An item that lost its href entirely is caught
 * there, not here.
 */
function unifyNavTag(html: string): string {
  return html
    .replace(/<a(\s)/g, '<button$1')
    .replace(/<\/a>/g, '</button>')
    .replace(/\s+href="[^"]*"/g, '');
}

const navHtml = (node: React.ReactElement) => relax(unifyNavTag(renderToStaticMarkup(node)));
const navGolden = (id: string, section: string) => relax(unifyNavTag(goldenSection(id, section)));

/** The three permission states the committed goldens happen to hold, and what each one is. */
const MASTER = hrRole('admin');
const VIEWER = hrRole('viewer');
const HR_ADMIN = hrRole('hr_admin');
const EMPLOYEE = hrRole('employee');

describe('HR sidebar — React vs the nav the goldens captured', () => {
  // `hr.access` was captured without RC_PRIMED, so `RC.me.employee` is falsy and My Profile is absent —
  // eleven entries. `hr.profile` was captured WITH it — twelve. Both are the same rule at hros.html:1508
  // in its two states, which is why both are pinned rather than just the fuller one.
  it('renders hrSidebar() for a Master Admin with no employee record (11 entries)', () => {
    expect(navHtml(<HrSideNav entries={hrNavFor(MASTER, false)} view="access" />))
      .toBe(navGolden('hr.access', 'hr_nav'));
  });

  it('renders hrSidebar() for a Master Admin who has one (12 entries, My Profile last)', () => {
    expect(navHtml(<HrSideNav entries={hrNavFor(MASTER, true)} view="profile" />))
      .toBe(navGolden('hr.profile', 'hr_nav'));
  });

  it('renders HR_EMP_NAV in employee mode, on both goldens that hold it', () => {
    expect(navHtml(<HrSideNav entries={hrNavFor(EMPLOYEE, true)} view="clock" />))
      .toBe(navGolden('hr.clock', 'hr_nav'));
    expect(navHtml(<HrSideNav entries={hrNavFor(EMPLOYEE, true)} view="payslip" />))
      .toBe(navGolden('hr.payslip', 'hr_nav'));
  });

  it('renders the employee mobile tab bar', () => {
    expect(navHtml(<HrEmpMobNav entries={hrNavFor(EMPLOYEE, true)} view="clock" />))
      .toBe(navGolden('hr.clock', 'emp-mobnav'));
    expect(navHtml(<HrEmpMobNav entries={hrNavFor(EMPLOYEE, true)} view="payslip" />))
      .toBe(navGolden('hr.payslip', 'emp-mobnav'));
  });

  // Guard the guard: the diff above must be capable of failing. A nav rendered for the WRONG screen puts
  // the `on` class on a different item, and that has to be visible — otherwise the highlight could be
  // wired to anything at all and every assertion above would still pass.
  it('the comparison still bites — a highlight on the wrong entry fails', () => {
    expect(navHtml(<HrSideNav entries={hrNavFor(MASTER, false)} view="payroll" />))
      .not.toBe(navGolden('hr.access', 'hr_nav'));
    expect(navHtml(<HrSideNav entries={hrNavFor(MASTER, true)} view="profile" />))
      .not.toBe(navGolden('hr.access', 'hr_nav'));   // and so does an entry that should not be there
  });
});

describe('HR sidebar — the destination of every item', () => {
  // R1 in relax() drops `on*=` attributes, and unifyNavTag drops `href`, so the diffs above compare
  // everything about a nav item EXCEPT where it goes. This is the check that puts that back: the golden's
  // own `hrNav('<id>')` arguments, in document order, against the anchors the React nav renders.
  it('goes where the golden goes, in the same order', () => {
    const want = goldenHandlers(goldenSection('hr.access', 'hr_nav'))
      .map((h) => h.args.filter((a) => a !== STUB_VALUE))
      .filter((a) => a.length);
    const html = renderToStaticMarkup(<HrSideNav entries={hrNavFor(MASTER, false)} view="access" />);
    const got = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(want.length).toBe(11);
    expect(got.length).toBe(want.length);
    want.forEach((args, i) => {
      const id = args[0];
      const entry = HR_NAV.find((e) => e.id === id)!;
      expect(entry, `hros.html has a nav id the React nav does not: ${id}`).toBeTruthy();
      expect(got[i]).toBe(href(entry));
    });
  });

  // `reactHandlers()` reads handler PROPS; a nav of anchors has none, which is the point — navigation is
  // a URL, not a click handler. Asserting that keeps a future "improvement" from quietly turning the nav
  // back into buttons, which would take middle-click and Back with it.
  it('wires no click handlers — the nav is anchors', () => {
    expect(reactHandlers(<HrSideNav entries={hrNavFor(MASTER, true)} view="profile" />)).toEqual([]);
    expect(reactHandlers(<HrEmpMobNav entries={hrNavFor(EMPLOYEE, true)} view="clock" />)).toEqual([]);
  });
});

describe('every screen in both apps is in the nav', () => {
  /** `HR_NAV` / `HR_EMP_NAV` read out of hros.html itself, so this cannot drift from the app it mirrors. */
  function legacyHrIds(varName: string): string[] {
    const at = HROS.indexOf(`var ${varName}=[`);
    expect(at, `hros.html no longer declares ${varName}`).toBeGreaterThan(-1);
    const block = HROS.slice(at, HROS.indexOf('\n];', at));
    return [...block.matchAll(/^\s*\['([a-z]+)'/gm)].map((m) => m[1]);
  }

  /** Every tab's `data-t`, read out of app.html's own markup (app.html:1127). */
  const legacyFinanceIds = [...APP.matchAll(/<div class="tab[^"]*"\s+data-t="([a-z0-9]+)"/g)].map((m) => m[1]);

  it('carries every HR view hros.html declares, in its order', () => {
    expect(HR_NAV.map((e) => e.id)).toEqual(legacyHrIds('HR_NAV'));
    expect(HR_EMP_NAV.map((e) => e.id)).toEqual(legacyHrIds('HR_EMP_NAV'));
  });

  it('carries every Finance tab app.html declares, in its order', () => {
    expect(legacyFinanceIds.length).toBe(22);
    expect(FINANCE_NAV.map((e) => e.id)).toEqual(legacyFinanceIds);
  });

  it('is 36 screens, and every one of them resolves somewhere', () => {
    expect(ALL_SCREENS.length).toBe(36);
    for (const e of ALL_SCREENS) expect(href(e), e.id).toBeTruthy();
  });

  // The whole point of one declarative list: `migrated` cannot be a claim, it has to be a fact. A route
  // added without a nav entry and a nav entry that promises a route that is not there both fail here.
  it('agrees with the routes that actually exist on disk', () => {
    const routes = (app: string) => new Set(
      readdirSync(join(import.meta.dirname, '..', 'app', app), { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name));
    for (const app of ['hr', 'finance'] as const) {
      const onDisk = routes(app);
      const claimed = new Set(ALL_SCREENS.filter((e) => e.app === app && e.migrated).map((e) => e.id));
      expect([...claimed].filter((id) => !onDisk.has(id)), `${app}: nav claims a route that is not there`).toEqual([]);
      expect([...onDisk].filter((id) => !claimed.has(id)), `${app}: a route no nav entry points at`).toEqual([]);
    }
  });

  it('sends an unmigrated screen to its legacy tab, and a migrated one to its route', () => {
    expect(href(FINANCE_NAV.find((e) => e.id === 'overview')!)).toBe('/app.html#tab=overview');
    expect(href(FINANCE_NAV.find((e) => e.id === 'wht')!)).toBe('/finance/wht/');
    expect(href(HR_NAV.find((e) => e.id === 'payroll')!)).toBe('/hr/payroll/');
    // The `#tab=` scheme is what makes a handoff land on the right SCREEN rather than the app's default
    // view (v213). Every legacy destination must carry it, or the nav is 21 links to Overview.
    for (const e of ALL_SCREENS.filter((x) => !x.migrated)) expect(href(e)).toContain(`#tab=${e.id}`);
  });
});

describe('the permission rules, in the direction that matters', () => {
  const ids = (r: ReturnType<typeof hrRole>, hasEmployee = true) => hrNavFor(r, hasEmployee).map((e) => e.id);

  it('HR_MASTER — only the Master Admin is shown Access & Roles', () => {
    expect(ids(MASTER)).toContain('access');
    expect(ids(HR_ADMIN)).not.toContain('access');
    expect(ids(VIEWER)).not.toContain('access');
  });

  it('HR_VIEWER — a viewer is not shown the approval-flow editor', () => {
    expect(ids(HR_ADMIN)).toContain('approvals');
    expect(ids(VIEWER)).not.toContain('approvals');
  });

  it('HR_VIEWER — and the shell puts `viewer-mode` on #app, which is what hides write controls', () => {
    // hros.html:958 — `.viewer-mode .btn.p, .viewer-mode .btn.d, .viewer-mode .hr-write { display:none }`.
    // The class is the mechanism; asserting the rule is still in the stylesheet keeps this from becoming
    // a class nothing acts on.
    expect(HROS).toContain('.viewer-mode .btn.p,.viewer-mode .btn.d,.viewer-mode .hr-write{ display:none !important; }');
    expect(shell(VIEWER)).toContain('viewer-mode');
    expect(shell(HR_ADMIN)).not.toContain('viewer-mode');
  });

  it('HR_MASTER — only the Master Admin is offered the jump to Finance OS', () => {
    // hros.html:1365: an HR-only role following it lands on the "HR OS access only" gate.
    expect(shell(MASTER)).toContain('Finance OS');
    expect(shell(HR_ADMIN)).not.toContain('Finance OS');
    expect(shell(VIEWER)).not.toContain('Finance OS');
  });

  it('HR_EMP_MODE — an employee sees five personal screens and no admin screen anywhere', () => {
    const emp = ids(EMPLOYEE);
    expect(emp).toEqual(['clock', 'leave', 'expenses', 'payslip', 'profile']);
    for (const id of ['dashboard', 'employees', 'attendance', 'claims', 'payroll', 'calculator', 'yearend', 'approvals', 'access']) {
      expect(emp, `employee mode must not advertise ${id}`).not.toContain(id);
    }
    // Not just the sidebar: the whole rendered shell must not name an admin screen or its route.
    const html = shell(EMPLOYEE);
    for (const id of ['employees', 'payroll', 'access']) {
      expect(html, `employee shell leaks ${id}`).not.toContain(`/hr/${id}/`);
    }
    // And the company picker is gone — an employee works in one company (hros.html:1380).
    expect(html).not.toContain('id="hr_company"');
    expect(shell(HR_ADMIN)).toContain('id="hr_company"');
  });

  it('HR_EMP_MODE is the default for an unrecognised role, not the admin nav', () => {
    // hros.html:1368 fails safe: anything that is not admin / hr_admin / viewer is self-service.
    expect(hrRole('approver').empMode).toBe(true);
    expect(hrRole('').empMode).toBe(false);       // no role at all → no nav is rendered; see the layout
    expect(ids(hrRole('approver'))).toEqual(['clock', 'leave', 'expenses', 'payslip', 'profile']);
  });

  it('canManage — the admin-only Finance tabs are absent for a non-manager', () => {
    const manager: Perms = { manage_users: true, features: ['overview', 'cfo', 'users'] };
    const staff: Perms = { manage_users: false, features: ['overview', 'cfo', 'users'] };
    for (const id of ['selfbill', 'wht', 'gateway', 'bankfeed', 'salesrecon', 'ctgaccess']) {
      expect(financeTabHidden(id, manager), id).toBe(false);
      expect(financeTabHidden(id, staff), id).toBe(true);
    }
    const html = renderToStaticMarkup(
      <FinanceShell active="" tabs={financeNavFor(staff)} cats={financeCatsFor(staff)} who="A" role="Viewer"
        companies={[]} company="" online theme="light" onPickCompany={noop} onToggleTheme={noop} onRefresh={noop} onSignOut={noop}>x</FinanceShell>);
    for (const id of ['selfbill', 'wht', 'gateway', 'bankfeed', 'salesrecon', 'ctgaccess']) {
      expect(html, `Finance shell advertises ${id} to a non-manager`).not.toContain(`data-t="${id}"`);
    }
    expect(html).toContain('data-t="overview"');
  });

  it('canManage — with no permission set, only the server-gated tabs remain', () => {
    // app.html has fallbackPerms() so a signed-in operator is not locked out of a page they are already
    // inside; the layout deliberately has no equivalent, because failing that way would ADVERTISE tabs.
    // What is left is exactly the three the legacy pass shows unconditionally — Company Info,
    // Pharmacies and the Compliance Calendar, each `el.classList.remove('hide')` with a comment saying
    // it is gated server-side (app.html:1424-1426). Every admin-only tab is gone.
    expect(financeNavFor(null).map((e) => e.id)).toEqual(['calendar', 'info', 'pharm']);
    expect(financeCatsFor(null).map((c) => c.id)).toEqual(['operations', 'data']);
  });

  it('a feature-gated tab follows the feature list', () => {
    const feats: Perms = { manage_users: false, features: ['overview', 'pnl'] };
    // The three server-gated tabs come along regardless; nothing else does, and the order is the tab
    // strip's own (app.html:1127) rather than the feature list's.
    expect(financeNavFor(feats).map((e) => e.id)).toEqual(['overview', 'pnl', 'calendar', 'info', 'pharm']);
  });

  it('ocr and ap stay hidden from everyone — Claude vision credits, app.html:1427', () => {
    const manager: Perms = { manage_users: true, features: FINANCE_NAV.map((e) => e.id) };
    expect(financeTabHidden('ocr', manager)).toBe(true);
    expect(financeTabHidden('ap', manager)).toBe(true);
    // If those legacy lines are ever flipped back on, this is the reminder that the nav has its own copy.
    expect(APP).toContain("else if(t==='ocr') el.classList.toggle('hide', true);");
  });

  it("`users` follows its FEATURE flag, not manage_users — app.html's own control flow", () => {
    // app.html:1422 is a STANDALONE `if`, and the `if/else if` chain restarts at `ctgaccess`, so `users`
    // falls through to the chain's final `else` and `feats.indexOf('users')<0` overwrites the
    // `!canManage` toggle above it. CLAUDE.md flags this and leaves it to whoever ports the Users tab;
    // the nav mirrors the effective behaviour rather than the apparent intent. Pinned so that a later
    // fix in app.html is a visible disagreement here rather than a silent divergence.
    expect(APP).toContain("if(t==='users') el.classList.toggle('hide', !canManage);\n    if(t==='ctgaccess')");
    expect(financeTabHidden('users', { manage_users: true, features: [] })).toBe(true);
    expect(financeTabHidden('users', { manage_users: false, features: ['users'] })).toBe(false);
  });

  it('an empty category is not rendered — app.html:1437', () => {
    const staff: Perms = { manage_users: false, features: ['overview'] };
    // No Admin category at all: both its tabs are manage_users-only. Operations survives on Calendar
    // alone, which app.html shows to everyone and gates server-side.
    expect(financeCatsFor(staff).map((c) => c.id)).toEqual(['dashboard', 'operations', 'data']);
    expect(financeNavFor(staff).map((e) => e.id)).toEqual(['overview', 'calendar', 'info', 'pharm']);
  });
});

describe('the shell wraps the screen without becoming one', () => {
  it('renders the screen inside the HR sidebar layout, once', () => {
    const html = shell(MASTER, <p id="screen">the screen</p>);
    expect(html).toContain('<p id="screen">the screen</p>');
    expect(html.match(/id="app"/g)?.length).toBe(1);
    expect(html.match(/<main/g)?.length).toBe(1);
    expect(html).toContain('id="hr_nav"');
  });

  it('renders the screen inside the Finance chrome, once', () => {
    const perms: Perms = { manage_users: true, features: ['overview'] };
    const html = renderToStaticMarkup(
      <FinanceShell active="wht" tabs={financeNavFor(perms)} cats={financeCatsFor(perms)} who="BOSS" role="Admin"
        companies={[{ tenant_id: 't1', tenant_name: 'CTG SDN BHD' }]} company="t1" online theme="light"
        onPickCompany={noop} onToggleTheme={noop} onRefresh={noop} onSignOut={noop}><p id="screen">the screen</p></FinanceShell>);
    expect(html).toContain('<p id="screen">the screen</p>');
    expect(html.match(/id="app"/g)?.length).toBe(1);
    expect(html).toContain('class="tab active" data-t="wht"');
    // `syncCompanyScope()` — app.html:1531. Picking one org is a different kind of act from reading the
    // aggregate, and the control looked identical in both states.
    expect(html).toContain('data-scope="one"');
    expect(html).toContain('Posting into this company');
  });

  it('the Finance tab strip shows one category at a time — tabCat(), app.html:1459', () => {
    const perms: Perms = { manage_users: true, features: FINANCE_NAV.map((e) => e.id) };
    const html = renderToStaticMarkup(
      <FinanceShell active="wht" tabs={financeNavFor(perms)} cats={financeCatsFor(perms)} who="B" role="Admin"
        companies={[]} company="" online theme="light" onPickCompany={noop} onToggleTheme={noop} onRefresh={noop} onSignOut={noop}>x</FinanceShell>);
    // The active tab's own category is on screen; the others are `cat-hide`, which app.html:618 hides.
    expect(html).toMatch(/class="tab active" data-t="wht" data-cat="operations"/);
    expect(html).toMatch(/class="tab cat-hide" data-t="overview"/);
    expect(html).toMatch(/class="tab-cat active" data-cat="operations"/);
  });
});

const noop = () => {};

/** The whole HR shell for one role, as markup. `hasEmployee` on, so My Profile is in every case. */
function shell(role: ReturnType<typeof hrRole>, children: React.ReactNode = 'x'): string {
  const entries: NavEntry[] = hrNavFor(role, true);
  return renderToStaticMarkup(
    <HrShell view="" entries={entries} empMode={role.empMode} viewer={role.viewer} master={role.master}
      companies={[{ tenant_id: 't1', tenant_name: 'CTG SDN BHD' }]} tenant="t1" companyName="CTG SDN BHD"
      theme="light" collapsed={false} onPickCompany={noop} onToggleTheme={noop} onToggleNav={noop}
      onSignOut={noop}>{children}</HrShell>);
}
