// Actually render the payroll screen. Nothing did, and that is how a ReferenceError reached production.
//
// WHY THIS FILE EXISTS: v205 shipped `hrPayroll()` referring to a `skipRows` variable whose declaration
// had been lost in a half-applied edit. Every check in the gate passed:
//   - deno lint sees no problem — an undeclared identifier is a RUNTIME ReferenceError, not a syntax error
//   - the HTML parses, so the fail-closed parse gate is green
//   - no test called hrPayroll(), because rendering needs a DOM and a payload
// And the app itself hid it: hrLoadPayroll wraps hrRender in try/catch, so the throw became a toast and the
// page sat on "Loading payroll…" for ever. Nothing reached portal_client_errors either, because a *caught*
// error never reaches window.onerror. The operator saw a spinner and had to ask whether it was broken.
//
// So: load the real inline script under a stub DOM, hand it a realistic payload, and call the renderer.
// If it throws, the test fails — which is the only signal that would have caught this.

import { assertEquals } from "jsr:@std/assert@1";
import { inlineScript } from "../tools/extract.ts";

const src = inlineScript(await Deno.readTextFile(new URL("../hros.html", import.meta.url)));

// ── the smallest DOM that lets a 500 KB single-file app finish evaluating ──
// deno-lint-ignore no-explicit-any
function stubDom(): any {
  // deno-lint-ignore no-explicit-any
  const el = (): any => ({
    value: "", checked: false, style: {}, textContent: "", innerHTML: "", outerHTML: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; }, querySelector() { return null; },
    querySelectorAll() { return []; }, scrollIntoView() {}, focus() {}, click() {},
    insertAdjacentHTML() {},
    getContext() { return { drawImage() {}, fillRect() {}, getImageData() { return { data: [] }; } }; },
  });
  // deno-lint-ignore no-explicit-any
  const g: any = {};
  g.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el(), body: el(), documentElement: el(), head: el(), addEventListener() {},
    cookie: "", activeElement: null, readyState: "complete" };
  g.location = { href: "https://x/hros.html", hash: "", search: "", pathname: "/hros.html", reload() {} };
  const store: Record<string, string> = {};
  g.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; } };
  g.sessionStorage = g.localStorage;
  g.navigator = { userAgent: "test", serviceWorker: { register: () => Promise.resolve() },
    clipboard: { writeText: () => Promise.resolve() } };
  g.alert = () => {}; g.confirm = () => true; g.prompt = () => null;
  g.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  g.requestAnimationFrame = (f: () => void) => setTimeout(f, 0);
  g.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }), text: () => Promise.resolve("{}") });
  return g;
}

// deno-lint-ignore no-explicit-any
function loadApp(): any {
  const g = stubDom();
  const prev: Record<string, unknown> = {};
  for (const k of Object.keys(g)) { prev[k] = (globalThis as never)[k as never]; (globalThis as never as Record<string, unknown>)[k] = g[k]; }
  (globalThis as never as Record<string, unknown>).window = globalThis;
  const mod = new Function(src + "\n;return { HR:(typeof HR!=='undefined'?HR:null), hrPayroll:(typeof hrPayroll!=='undefined'?hrPayroll:null)," +
    " HRA:(typeof HRA!=='undefined'?HRA:null), hrAccessRender:(typeof hrAccessRender!=='undefined'?hrAccessRender:null) };");
  return mod();
}

const RATES = {
  eis: { eeRate: 0.002, erRate: 0.002, ceiling: 6000 },
  epf: { eeRate: 0.11, eeSenior: 0, erSenior: 0.04, erRateLow: 0.13, threshold: 5000, erRateHigh: 0.12 },
  socso: { eeRate: 0.005, erRate: 0.0175, ceiling: 6000, erRate2: 0.0125 },
};
const emp = (n: number, over: Record<string, unknown> = {}) => ({
  id: "e" + n, emp_no: "E" + String(n).padStart(3, "0"), name: "TEST STAFF " + n,
  basic_salary: 3000 + n * 250, fixed_allowance: 0, status: "active", pay_type: "monthly",
  date_of_birth: "1995-01-01", citizen_status: "citizen", marital_status: "single", num_children: 0,
  resident: true, epf_eligible: true, socso_eligible: true, eis_eligible: true, lindung24: true,
  ic_no: "950101-07-500" + n, bank_code: "MAYBANK", bank_name: "Malayan Banking Berhad (Maybank)",
  bank_account: "15205043363" + n, bank_holder: "TEST STAFF " + n, tenant_id: "t1", ...over,
});

// deno-lint-ignore no-explicit-any
function render(payload: any, tweak?: (HR: any) => void): string {
  const app = loadApp();
  assertEquals(!!app.HR && !!app.hrPayroll, true, "hros.html did not expose HR / hrPayroll");
  app.HR.tenant = "t1";
  app.HR.pay = app.HR.pay || {};
  app.HR.pay.month = 8; app.HR.pay.year = 2026; app.HR.pay.grid = null; app.HR.pay.data = payload;
  if (tweak) tweak(app.HR);
  return app.hrPayroll();
}

const BASE = {
  ok: true, rates: RATES, adjustments: [], run: null, payslips: [], attendance: {}, leaveBalances: {}, ytd: {},
  employees: [emp(1), emp(2), emp(3, { basic_salary: 0, pay_type: "hourly", hourly_rate: 10 })],
};

Deno.test("the payroll grid renders", () => {
  const html = render({ ...BASE });
  assertEquals(html.length > 2000, true, "suspiciously short output — did it bail to an empty state?");
  assertEquals(html.indexOf("TEST STAFF 1") >= 0, true, "employees are missing from the grid");
  assertEquals(/Payroll grid/.test(html), true, "the grid panel did not render");
});

Deno.test("it renders with an employee skipped", () => {
  // The exact shape that broke: skipped staff leave A.rows and are re-added from their own list.
  const html = render({ ...BASE, adjustments: [{ employee_id: "e2", kind: "skip", amount: 0, period_month: 8, period_year: 2026 }] });
  assertEquals(/Skipped/.test(html), true, "the skipped row is not shown — an invisible exclusion");
  assertEquals(/1 skipped/.test(html), true, "the total row does not report the skipped count");
  assertEquals(html.indexOf("TEST STAFF 2") >= 0, true, "the skipped employee vanished entirely");
});

Deno.test("it renders with a PCB override", () => {
  const html = render({ ...BASE, adjustments: [{ employee_id: "e1", kind: "pcb_set", amount: 123.45, period_month: 8, period_year: 2026 }] });
  assertEquals(/123\.45/.test(html), true, "the PCB override is not on screen");
  assertEquals(/pcbu_e1/.test(html), true, "the ↺ revert control is missing for an overridden cell");
});

Deno.test("it renders a finalised, locked month", () => {
  const html = render({ ...BASE, run: { id: "r1", status: "finalised", period_month: 8, period_year: 2026 } });
  assertEquals(/Edit entries/.test(html), true, "a finalised month should offer the unlock button");
  assertEquals(/disabled/.test(html), true, "a finalised month should render disabled inputs");
});

Deno.test("it renders with the row menu open", () => {
  const html = render({ ...BASE }, (HR) => { HR.pay.rowMenu = "e1"; });
  assertEquals(/hr_rowmenu/.test(html), true, "the row action panel did not render");
  for (const s of ["Skip this month", "Mark resigned", "Delete"]) {
    assertEquals(html.indexOf(s) >= 0, true, `the row menu no longer offers "${s}"`);
  }
});

Deno.test("it renders with no employees at all", () => {
  const html = render({ ...BASE, employees: [] });
  assertEquals(/No active employees/.test(html), true, "an empty company should say so, not throw");
});

// ── Access & Roles ────────────────────────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
function renderAccess(data: any, role?: string): string {
  const app = loadApp();
  assertEquals(!!app.HRA && !!app.hrAccessRender, true, "hros.html did not expose HRA / hrAccessRender");
  app.HRA.data = data;
  if (role) app.HRA.role = role;
  return app.hrAccessRender();
}
const ACCESS = {
  ok: true, me_id: "u1", admin_count: 2, scoped_tenant: "t1",
  users: [{ id: "u1", email: "boss@x.test", name: "BOSS", role: "admin", self: true, company_count: 1, can_edit: true },
          { id: "u2", email: "staff@x.test", name: "STAFF", role: "employee", employee: "STAFF", company_count: 1, can_edit: true }],
  employee_candidates: [{ id: "e9", name: "NEW JOINER", emp_no: "E099", email: "joiner@x.test" },
                        { id: "e8", name: "NO EMAIL GUY", emp_no: "E098", email: null }],
};

Deno.test("Access & Roles offers an Employee login, and it is the default", () => {
  const html = renderAccess(ACCESS);
  assertEquals(/value="employee"/.test(html), true, "the invite form has no Employee role option");
  assertEquals(/hra_emp/.test(html), true, "picking Employee must offer the employee picker");
  assertEquals(html.indexOf("NEW JOINER") >= 0, true, "candidates without a login are not listed");
});

Deno.test("the picker only offers staff who do not already have a login", () => {
  const html = renderAccess({ ...ACCESS, employee_candidates: [] });
  assertEquals(/already has a login/.test(html), true,
    "with nobody left to invite it should say so, not show an empty dropdown");
  assertEquals(/hra_emp/.test(html), false, "an empty picker should not render at all");
});

Deno.test("an employee with no email on file is flagged in the picker", () => {
  const html = renderAccess(ACCESS);
  assertEquals(/no email on file/.test(html), true,
    "an employee with no address must be visibly flagged — the login cannot be delivered otherwise");
});

Deno.test("the other roles still render their plain email/name form", () => {
  const html = renderAccess(ACCESS, "hr_admin");
  assertEquals(/hra_emp/.test(html), false, "the employee picker should only appear for the Employee role");
  assertEquals(/hra_email/.test(html), true, "the email field vanished for admin roles");
});
