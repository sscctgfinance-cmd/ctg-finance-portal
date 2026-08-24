// The 41 rendered surfaces of the two apps, how to render each one offline, and how to normalise the
// result so a golden means something.
//
// The inventory was taken from the code, not from the migration spec:
//   Finance OS — 22 tabs, from the `render(t)` dispatcher at app.html:1512 and the tab divs at :1124.
//   HR OS      — 14 nav views, from `hrRender()` at hros.html:1683. One of them ("dashboard") is itself
//                a dispatcher over `HR_DASH.page` (hros.html:1879) with 5 sub-pages, so it contributes
//                5 surfaces rather than 1 → 13 + 5 = 18.
//   22 + 18 = 40, plus `hr.leave.emp` — the second screen behind the `leave` nav id (hros.html:1553
//   dispatches it by role) — = 41.
//

import { type AppHandle, loadApp } from "./render_harness.ts";
import { COMPANIES, FIXTURES, HR_TENANT } from "./render_fixtures.ts";

export interface Surface {
  /** Golden filename stem, and the test name. */
  id: string;
  app: "app.html" | "hros.html";
  /** What an operator would call this screen. */
  title: string;
  /** Run inside the app's scope after the shared setup, before `render`. */
  setup?: string;
  /** The expression that actually paints the screen. May be async. */
  render: string;
}

const FINANCE_TABS = [
  ["info", "Company Info"], ["o2o", "O2O Billing"], ["calendar", "Compliance Calendar"], ["ap", "AP Inbox"],
  ["cfo", "CFO Cockpit"], ["wht", "Withholding Tax"], ["overview", "Overview"], ["gateway", "Gateway → Xero"],
  ["salesrecon", "Sales Reconciliation"], ["pharm", "Pharmacies"], ["pnl", "P&L Analysis"], ["qinv", "Quick Invoice"],
  ["selfbill", "Personal Invoices"], ["recon", "Bank Rec"], ["users", "Users"], ["ocr", "Smart OCR"],
  ["ctgaccess", "CTG Access"], ["upload", "Upload"], ["approvals", "Approvals"], ["close", "Close"],
  ["bankfeed", "Bank Feed"], ["collections", "Collections"],
];

/**
 * `My Profile` and `Reimbursement` both hang off RC, the claims module's own state, loaded by
 * `hrRCBoot()` when Reimbursement is first opened. `hrSidebar` hides the Profile link until that has
 * happened, so priming it is what the app does, not a shortcut around it.
 */
const RC_PRIMED = "hrRCBoot();";

/**
 * `Time Clock` and `My Payslips` are in `HR_EMP_NAV` and NOT in `HR_NAV` — they are only reachable in
 * employee mode. `hrRender()` will still route to them for an admin, but the page head falls back to a
 * bare "HR OS / HR" and `hrEmpPayslipsLoad` refuses to repaint (`HR.view==='payslip' && HR_EMP_MODE`),
 * which is how the first cut of this file captured a loading spinner as the golden for a whole screen.
 * Captured in the mode they actually exist in.
 */
const EMP_MODE = "HR_EMP_MODE=true; " + RC_PRIMED;

/** HR nav views other than `dashboard`, which is expanded into its 5 sub-pages below. Third element = extra setup. */
const HR_VIEWS: [string, string, string?][] = [
  ["employees", "Employees"], ["attendance", "Attendance"], ["clock", "Time Clock", EMP_MODE], ["payroll", "Payroll"],
  ["calculator", "Salary Calculator"], ["yearend", "Year-end (EA / Form E)"], ["leave", "Leave"], ["claims", "Claims"],
  ["expenses", "Reimbursement", RC_PRIMED], ["payslip", "My Payslips", EMP_MODE], ["profile", "My Profile", RC_PRIMED],
  ["approvals", "Approvals"], ["access", "Access & Roles"],
];

const HR_DASH_PAGES = [
  ["overview", "Dashboard · Overview"], ["headcount", "Dashboard · Headcount"], ["payroll", "Dashboard · Payroll"],
  ["attendance", "Dashboard · Attendance"], ["cost", "Dashboard · Cost"],
];

export const SURFACES: Surface[] = [
  ...FINANCE_TABS.map(([t, title]) => ({
    id: "finance." + t, app: "app.html" as const, title,
    render: `render(${JSON.stringify(t)})`,
  })),
  ...HR_DASH_PAGES.map(([p, title]) => ({
    id: "hr.dashboard." + p, app: "hros.html" as const, title,
    setup: `HR.view='dashboard'; HR_DASH.page=${JSON.stringify(p)}; HR_DASH.month=8; HR_DASH.year=2026;`,
    render: "hrRender()",
  })),
  ...HR_VIEWS.map(([v, title, extra]) => ({
    id: "hr." + v, app: "hros.html" as const, title,
    setup: (extra ?? "") + `HR.view=${JSON.stringify(v)};`,
    render: "hrRender()",
  })),
  // `leave` is the ONE nav id hros.html:1553 dispatches to two different screens by role —
  // `HR_EMP_MODE?hrEmpLeave():hrLeave()`. `hr.leave` above is the admin one; this is the other, and it
  // is the whole of Leave for every non-admin employee. Captured as its own surface because a mode the
  // goldens never reach is a mode nothing protects: the React port of the employee branch was missing
  // entirely while `hr.leave` stayed green.
  {
    id: "hr.leave.emp", app: "hros.html" as const, title: "Leave (employee)",
    setup: EMP_MODE + "HR.view='leave';",
    render: "hrRender()",
  },
  // `expenses` is the OTHER nav id with more than one screen behind it, and it has FOUR. `hrRC()`
  // (hros.html:1783) is a tab bar over `RC.page` — list / form / detail / dashboard / settings — and
  // `hr.expenses` above only ever captured the list, because `RC.page` starts there. Two of the others
  // are the EMPLOYEE half of Reimbursement (Submit, and a claim's detail) and are the whole reason an
  // employee opens this screen at all; a golden cannot see a screen that is never mounted, which is how
  // the React route shipped for months sending every Submit click back to hros.html. Dashboard and
  // Settings are admin-only and are not migrated, so they get no surface here.
  {
    id: "hr.expenses.form", app: "hros.html" as const, title: "Reimbursement · Submit",
    setup: RC_PRIMED + "HR.view='expenses';",
    render: "(RC.page='form', hrRender())",
  },
  {
    // `hrRCOpen()` (hros.html:2508) fetches `hr_rc_get`, sets `RC.page='detail'` and renders — so the
    // render expression is the real navigation, not a state poke. It paints `#hr` twice (a spinner,
    // then the claim); last-write-wins per id keeps the loaded screen, `finance.approvals`' case.
    id: "hr.expenses.detail", app: "hros.html" as const, title: "Reimbursement · a claim",
    setup: RC_PRIMED + "HR.view='expenses';",
    render: "hrRCOpen('rc1')",
  },
  {
    // Employee mode. `RC.me.isAdmin===false` is what changes the shape (hros.html:1785, :1821): two
    // tabs instead of four, and "My claims / 🔔 Approvals / Approved / Paid" instead of the admin
    // scopes. It is set directly because `hr_rc_config` is one fixture and the admin surfaces need the
    // admin answer — the flag is the whole of the difference the renderer reads.
    id: "hr.expenses.emp", app: "hros.html" as const, title: "Reimbursement (employee)",
    setup: RC_PRIMED + "HR.view='expenses';",
    render: "(RC.me={isAdmin:false,is_manager:false,roles:[]}, RC.page='list', hrRender())",
  },
  // ── the ADMIN half, v226 ────────────────────────────────────────────────────────────────────────
  // `hrRCNav('dashboard')` is the real navigation (it sets RC.page AND fires hrRCLoadDash), so the
  // render expression is the click, not a state poke — `hr.expenses.detail`'s arrangement. The load is
  // not awaited by the legacy either; `app.settle()` is what lets it land.
  {
    id: "hr.expenses.dash", app: "hros.html" as const, title: "Reimbursement · Dashboard",
    setup: RC_PRIMED + "HR.view='expenses';",
    render: "hrRCNav('dashboard')",
  },
  // ⚙ Settings is FIVE tabs over `RC.setTab`, and each is a different table over a different slice of
  // RC.cfg — the `finance.gateway` case, where a screen's tabs are MODES. One golden covers one mode,
  // so all five get one: a golden per tab is one line here and byte-level, where an assertion written
  // against the same source agrees with a widened port by construction. `RC.typeEdit` is null on every
  // nav, so the claim-type EDITOR is in none of them and is pinned in the screen's own test.
  ...([["types", "Claim Types"], ["rates", "Mileage Rates"], ["costcenters", "Cost Centers"],
       ["workflows", "Approval Workflows"], ["approvers", "Role Approvers"]] as [string, string][])
    .map(([t, title]) => ({
      id: "hr.expenses.settings." + t, app: "hros.html" as const, title: "Reimbursement · Settings · " + title,
      setup: RC_PRIMED + "HR.view='expenses';",
      render: `(RC.setTab=${JSON.stringify(t)}, hrRCNav('settings'))`,
    })),
];

/** Seed the globals a signed-in operator would have, then hand back the live app. */
async function boot(s: Surface): Promise<AppHandle> {
  const app = loadApp(s.app, FIXTURES);
  if (s.app === "app.html") {
    app.exec("COMPANIES=" + JSON.stringify(COMPANIES));
    app.exec("ME={id:'u1',email:'boss@ctg.test',name:'BOSS',role:'admin'}");
    app.exec("PERMS={role:'admin',label:'Administrator',features:ALL_FEATURES.slice(),manage_users:true}");
  } else {
    app.exec("HR.tenant=" + JSON.stringify(HR_TENANT) + "; HR.companies=" + JSON.stringify(COMPANIES) +
      "; HR_MASTER=true; HR_VIEWER=false; HR_EMP_MODE=false;");
    await app.exec("renderHR()");            // the real bootstrap: hr_bootstrap → HR.data → hrRender()
    await app.settle();
  }
  return app;
}

/**
 * Render one surface and return its golden text. Throws if the renderer throws — which is the original
 * point of this harness, and not something a golden should be allowed to swallow.
 */
export async function renderSurface(s: Surface): Promise<string> {
  const app = await boot(s);
  try {
    // Settle AFTER setup and again after render. Setup may kick off a load the screen then reads
    // (hrRCBoot → RC.me → My Profile); rendering before it lands captured "your login isn't linked to
    // an employee profile" as the golden for a screen that has plenty to show.
    if (s.setup) { await app.exec(s.setup); await app.settle(); }
    await app.exec(s.render);
    await app.settle();
    const parts = app.writes().map(([id, html]) => "<!-- #" + id + " -->\n" + normalise(html));
    if (!parts.length) throw new Error(s.id + " wrote no HTML anywhere");
    const missing = [...new Set(app.missing)];
    if (missing.length) throw new Error(s.id + " asked for un-fixtured actions: " + missing.join(", "));
    return parts.join("\n") + "\n";
  } finally {
    app.restore();
  }
}

/**
 * ── Normalisation policy ────────────────────────────────────────────────────────────────────────
 *
 * Two transforms, both purely about how the SAME markup is laid out on the page:
 *
 *   1. one tag per line — the renderers build 60 KB strings by concatenation, so an un-split golden is a
 *      single line and every failure prints as "these two 60 KB strings differ". Splitting at the `><`
 *      boundary is what turns a failure into a readable four-line diff, which is the entire value of
 *      having goldens in CI rather than a length assertion.
 *   2. runs of whitespace collapse to one space, and blank lines go — a template re-indented across a
 *      `+` join renders differently to the byte and identically to the eye.
 *
 * What is deliberately NOT normalised, and why — this is the part that decides whether the harness is
 * worth anything:
 *
 *   • `on*=` handlers are KEPT. The spec suggests stripping them. That is right for the LATER job of
 *     comparing a migrated React screen against this baseline (where `onclick="hrRowDelete('e1')"`
 *     legitimately becomes an `onClick` prop), and wrong for the job this file is actually doing today:
 *     regression cover for the app as it stands. `onclick="sbiVoid(12)"` silently becoming
 *     `onclick="sbiVoid(11)"` is a real defect, and it is invisible in stripped output. When the
 *     migration comparison is built it can strip them on top of this — a looser view of a strict golden
 *     is easy; recovering detail a strict view already threw away is not.
 *   • class token order is KEPT, unsorted. Every class attribute in both files is a static string
 *     literal, so it cannot spontaneously reorder — sorting would only ever hide a hand edit, never
 *     absorb noise.
 *   • ids, inline `style`, numbers and text are KEPT verbatim. A changed total, a dropped column and a
 *     renamed label are exactly what this is for.
 *
 * Determinism does NOT come from normalising it away: the harness pins the clock and the timezone
 * (see render_harness.ts) and stubs Math.random, so today's date and a random id are stable inputs
 * rather than noise to be scrubbed out of the output.
 */
export function normalise(html: string): string {
  return String(html)
    .replace(/></g, ">\n<")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}
