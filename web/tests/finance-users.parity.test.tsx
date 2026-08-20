// Finance OS · Users — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.users.html` was captured from `renderUsers()` (app.html:5102) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts,
// tests/parity.ts or tests/handlers.ts. The components are rendered with `renderToStaticMarkup` from the
// SAME fixture the golden was captured from — tests/render_fixtures.ts, imported directly — normalised
// by the harness's own normalise(), relaxed by the documented layer in ./parity.ts, and compared.
//
// NO SEVENTH RELAXATION, and none was needed. This is the twenty-fourth screen to reuse the six
// unchanged. The `&` in "who can log in & what they see" is written as `&amp;` in app.html's own string
// and React's text escaper emits `&amp;` too, so this is NOT hr-payslip's `decodeTextAmp` case; there is
// no named or numeric reference, no duplicate attribute and no unescaped `&`.
//
// ── THREE SECTIONS, THREE DIFFS ───────────────────────────────────────────────────────────────────
// This is the first Finance golden with three `<!-- #id -->` blocks and they are three different nested
// elements, each written by a different legacy statement. Each gets its own component and its own diff:
// `#users` ← UsersSubnav, `#uv_body` ← UsersPanel (children absent = the spinner it paints first),
// `#users_out` ← FinanceUsersTable. Handler parity runs per section for the same reason.
//
// ── THE GOLDEN HOLDS AN INTERMEDIATE STATE ────────────────────────────────────────────────────────
// CLAUDE.md's `finance.qinv` warning, and here it bites. `renderUsers()` does not stop after its
// `innerHTML=`: it calls `usersView()`, which REASSIGNS every sub-nav button's `.className` — invisible
// to a harness that records innerHTML writes. The golden therefore holds `class="btn sm"` on all five
// buttons while every operator sees `uv_users` highlighted as `btn sm p`. `the golden is not the screen
// an operator sees` below pins that out of app.html's own text, so the day someone moves the highlight
// into the HTML string this test fails rather than the claim silently rotting.
//
// ── THIS SCREEN HANDS OUT ACCESS ──────────────────────────────────────────────────────────────────
// Three rows of a name, a role pill and a company list, and they look alike. `Edit` and `🔑 Reset` both
// carry a bare POSITIONAL INDEX (`userEdit(1)`, `userReset(1)`) which the legacy resolves against
// `USERS_LIST[i]`, so an off-by-one Reset sets a DIFFERENT person's password to whatever the operator
// just typed for this one — and nothing on screen looks wrong. R1 strips `on*=` from the diff, so
// handler parity is the only thing holding that binding. Those are this file's most important cases.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES } from '../../tests/render_fixtures';
import FinanceUsersTable, {
  MIN_PASSWORD, USERS_VIEWS, UsersPanel, UsersSubnav, relTime, resetBody, roleLabelFor,
  rolePillClass, usersReachable, type Company, type Role, type User, type UserCompany, type UsersView,
} from '../src/finance-users';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');

/**
 * THE INSTANT THE GOLDEN WAS CAPTURED AT — tests/render_harness.ts:19's `FIXED_MS`.
 *
 * `relTime()` (app.html:5172) turns `last_login_at` into "19 min ago" / "2 d ago", so the golden holds
 * durations measured from this moment. hr.yearend's rule applies: the component does NOT read the clock
 * — `relTime()` is a pure function of an instant it is handed — and this value is COPIED rather than
 * imported, because render_harness.ts is the Deno harness and Node cannot load it (the same reason
 * tests/parity.ts lifts normalise() out by text).
 *
 * Not a relaxation: it changes the INPUT the React side is built from, not what counts as a match, and
 * the derivation stays under test — `does not read the clock itself` below moves it by an hour.
 */
const FIXED_MS = Date.parse('2026-08-18T09:30:00.000Z');

const G_USERS = goldenSection('finance.users', 'users');
const G_BODY = goldenSection('finance.users', 'uv_body');
const G_OUT = goldenSection('finance.users', 'users_out');

const USERS = (FIXTURES.users_list as { users: User[] }).users;
const UC = (FIXTURES.users_list as { user_companies: UserCompany[] }).user_companies;
const COMPANIES = (FIXTURES.companies_list as { companies: Company[] }).companies;
const ROLES = (FIXTURES.roles_list as { roles: Role[] }).roles;

const noop = () => {};

type TableProps = Parameters<typeof FinanceUsersTable>[0];

function table(over: Partial<TableProps> = {}) {
  return (
    <FinanceUsersTable
      users={USERS} userCompanies={UC} companies={COMPANIES} roles={ROLES}
      now={FIXED_MS} onEdit={noop} onReset={noop} {...over}
    />
  );
}

// `renderUsers()` writes the sub-nav BEFORE `usersView()` marks one button active, which is the state
// the harness captured. `active={null}` is that state and no operator's — see the header.
const subnav = (over: Partial<Parameters<typeof UsersSubnav>[0]> = {}) =>
  <UsersSubnav active={null} onView={noop} {...over} />;

const panel = (over: Partial<Parameters<typeof UsersPanel>[0]> = {}) => <UsersPanel onAdd={noop} {...over} />;

const rendered = (over: Partial<TableProps> = {}) => relax(renderToStaticMarkup(table(over)));

describe('Finance Users — React vs the legacy golden', () => {
  it('renders the same #users sub-nav renderUsers() does', () => {
    expect(relax(renderToStaticMarkup(subnav()))).toBe(relax(G_USERS));
  });

  it('renders the same #uv_body panel usersLoad() paints first', () => {
    expect(relax(renderToStaticMarkup(panel()))).toBe(relax(G_BODY));
  });

  it('renders the same #users_out table usersLoad() paints second', () => {
    expect(rendered()).toBe(relax(G_OUT));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * Run per SECTION, because the golden's three blocks are three different elements and the React tree
 * that owns each is a different component. Concatenating them would compare a sub-nav handler against a
 * row handler if either list ever shifted.
 *
 * TWO local widenings, both established and COPIED here rather than pushed into the shared
 * ./handlers.ts, which sibling migrations share:
 *
 *  • `identArgs()` — bare integers as well as quoted literals. `userEdit(0)` / `userReset(0)` carry
 *    NOTHING ELSE, so quoted-only extraction returns `[]` for all six row handlers and this check would
 *    pass with every row wired to user 0. This is the ninth screen to need it; CLAUDE.md already calls
 *    folding it into `goldenHandlers()` the next single change to make there.
 *  • `LEGACY_TO_PROP` — for `userForm(null)`, whose only argument is a bare `null` that neither
 *    extractor collects, so its argument list is legitimately empty and only its IDENTITY separates it
 *    from any other argument-free button. Keyed on the whole raw text first (finance.wht's shape).
 */
function identArgs(raw: string): string[] {
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|\b(-?\d+)\b/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

const LEGACY_TO_PROP: Record<string, string> = {
  'userForm(null)': 'add',
  usersView: 'view',
  userEdit: 'edit',
  userReset: 'reset',
};

const propFor = (raw: string) => LEGACY_TO_PROP[raw] ?? LEGACY_TO_PROP[raw.replace(/\(.*$/, '')] ?? raw;

/** The recorders, reachable from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

function checkSection(golden: string, tree: React.ReactNode, calls: { attr: string; args: string[] }[]) {
  const want = goldenHandlers(golden);
  const got = reactHandlers(tree);
  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());
  expect(calls.map((c) => c.args)).toEqual(want.map((h) => identArgs(h.raw)));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard: a golden that stopped carrying handlers would make the above pass vacuously and
  // turn R1 into the blind strip it is not allowed to be.
  expect(want.length).toBeGreaterThan(0);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
  return want;
}

function assertHandlerParity(over: { subnav?: Partial<Parameters<typeof UsersSubnav>[0]>; panel?: Partial<Parameters<typeof UsersPanel>[0]>; table?: Partial<TableProps> } = {}) {
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args
        .filter((a) => (typeof a === 'string' || typeof a === 'number') && a !== STUB_VALUE)
        .map(String),
    });
  misfire = record('misfire');

  const nav = checkSection(G_USERS, subnav({ onView: record('view') as never, ...over.subnav }), calls);
  // The sub-nav's five buttons each carry a quoted view id; that is what makes this section non-vacuous.
  expect(nav.every((h) => identArgs(h.raw).length > 0)).toBe(true);

  calls.length = 0;
  checkSection(G_BODY, panel({ onAdd: record('add') as never, ...over.panel }), calls);

  calls.length = 0;
  const rows = checkSection(G_OUT, table({ onEdit: record('edit') as never, onReset: record('reset') as never, ...over.table }), calls);
  // Every row handler's ONLY argument is the bare index, so identArgs() is the whole check here.
  expect(rows.length).toBe(USERS.length * 2);
  expect(rows.every((h) => identArgs(h.raw).length === 1)).toBe(true);
}

describe('the golden is not the screen an operator sees — usersView() repaints the sub-nav', () => {
  // CLAUDE.md's finance.qinv trap, and this screen falls into it. Asserted against app.html's own text
  // rather than left as a claim in a comment.
  it('renderUsers() calls usersView() AFTER its innerHTML write', () => {
    const fn = APP.slice(APP.indexOf('function renderUsers(){'), APP.indexOf('function usersView(v){'));
    expect(fn.trimEnd().endsWith("loaded.users=true; usersView(USERS_VIEW||'users');\n}")).toBe(true);
  });

  it('usersView() reassigns className, which no innerHTML-recording harness can see', () => {
    const fn = APP.slice(APP.indexOf('function usersView(v){'), APP.indexOf('async function sessionsLoad(){'));
    expect(fn).toContain("b.className='btn sm'+(k===v?' p':'')");
  });

  it('so the golden carries NO active button, and the screen an operator sees carries one', () => {
    expect(G_USERS).not.toContain('btn sm p');
    expect((G_USERS.match(/class="btn sm"/g) || []).length).toBe(5);
    const live = renderToStaticMarkup(subnav({ active: 'users' }));
    expect(live).toContain('<button class="btn sm p" id="uv_users"');
    expect(relax(live)).not.toBe(relax(G_USERS));
  });

  it('marks exactly one button, and the right one, for every sub-view', () => {
    for (const v of USERS_VIEWS) {
      const html = renderToStaticMarkup(subnav({ active: v }));
      expect((html.match(/class="btn sm p"/g) || []).length).toBe(1);
      expect(html).toContain(`<button class="btn sm p" id="uv_${v}"`);
    }
  });
});

describe('the comparison still bites', () => {
  // This SCREEN's real risks: a role that reads as something else, a company list that grants more than
  // it should, a status pill that says a disabled account is live, and a login trail that lies.
  const want = relax(G_OUT);
  const withUser = (i: number, over: Partial<User>) =>
    rendered({ users: USERS.map((u, k) => (k === i ? { ...u, ...over } : u)) });

  it('the golden really holds three users, each with both buttons', () => {
    // Guard the guard for this whole block: a golden that had captured the SPINNER instead of the table
    // would make every case below vacuous.
    expect(G_OUT).not.toContain('class="load"');
    expect((G_OUT.match(/<tr>/g) || []).length).toBe(4);      // header row + three users
    expect((G_OUT.match(/userEdit\(/g) || []).length).toBe(3);
    expect((G_OUT.match(/userReset\(/g) || []).length).toBe(3);
  });

  it('catches a ROLE that reads as a different role', () => {
    // The pill is the only place the role is shown. `viewer` printed as `Administrator` is the whole
    // screen lying about who can do what.
    expect(withUser(2, { role: 'admin' })).not.toBe(want);
    expect(relax(G_OUT.replace('>Viewer<', '>Administrator<'))).not.toBe(want);
    expect(relax(G_OUT.replace('pill pill-draft">Viewer', 'pill pill-coral">Viewer'))).not.toBe(want);
  });

  it('resolves the role LABEL from roles_list and falls back to the raw name', () => {
    expect(roleLabelFor('finance', ROLES)).toBe('Finance');
    expect(roleLabelFor('nosuchrole', ROLES)).toBe('nosuchrole');
    expect(roleLabelFor('admin', [{ name: 'admin', label: null }])).toBe('admin');
    // A label that stopped resolving would print the raw name, which is a different screen.
    expect(rendered({ roles: [] })).not.toBe(want);
  });

  it('catches the role PILL COLOUR drifting from the role', () => {
    expect(rolePillClass('admin')).toBe('pill-coral');
    expect(rolePillClass('approver')).toBe('pill-blue');
    expect(rolePillClass('viewer')).toBe('pill-draft');
    expect(rolePillClass('finance')).toBe('pill-draft');
  });

  it('catches a company APPEARING in a user\'s access list', () => {
    // The most consequential silent change on this screen: a row that grants a company it should not.
    expect(rendered({ userCompanies: UC.concat([{ user_id: 'u3', tenant_id: COMPANIES[0].tenant_id, role: '' }]) })).not.toBe(want);
    expect(rendered({ userCompanies: UC.filter((x) => x.user_id !== 'u2') })).not.toBe(want);
  });

  it('catches a per-company ROLE OVERRIDE being dropped or changed', () => {
    // `(viewer)` beside a company is a role that OVERRIDES the global one for that company. Losing it
    // silently promotes the user there to whatever their global role is.
    expect(G_OUT).toContain('>(viewer)</span>');
    expect(rendered({ userCompanies: UC.map((x) => (x.user_id === 'u3' ? { ...x, role: '' } : x)) })).not.toBe(want);
    expect(rendered({ userCompanies: UC.map((x) => (x.user_id === 'u3' ? { ...x, role: 'admin' } : x)) })).not.toBe(want);
  });

  it('distinguishes "All companies (admin)" from "— none assigned —"', () => {
    // Same blank assignment, opposite meanings. An admin with no rows sees EVERY company.
    expect(G_OUT).toContain('All companies (admin)');
    expect(withUser(0, { role: 'finance' })).not.toBe(want);
    const html = renderToStaticMarkup(table({ users: [{ ...USERS[0], role: 'finance' }] }));
    expect(html).toContain('— none assigned —');
    expect(html).not.toContain('All companies');
  });

  it('joins several companies with ", " and never merges two names', () => {
    const html = renderToStaticMarkup(table({
      users: [USERS[1]],
      userCompanies: COMPANIES.map((c) => ({ user_id: 'u2', tenant_id: c.tenant_id, role: '' })),
    }));
    expect(html).toContain('SKINDAE SDN BHD, I PROCARE MALAYSIA SDN BHD');
  });

  it('falls back to the raw tenant_id when a company is not in companies_list', () => {
    // app.html:5188 — `var nm=c?c.tenant_name:tid`. Printing nothing would read as "no access".
    const html = renderToStaticMarkup(table({ users: [USERS[1]], userCompanies: [{ user_id: 'u2', tenant_id: 'ghost-tenant', role: '' }] }));
    expect(html).toContain('ghost-tenant');
  });

  it('catches an account that is disabled being shown as active', () => {
    expect(withUser(2, { active: true })).not.toBe(want);
    expect(relax(G_OUT.replace('pill pill-draft">disabled', 'pill pill-green">active'))).not.toBe(want);
  });

  it('catches the 2FA badge appearing on, or vanishing from, the wrong account', () => {
    // The badge says this login is protected by a second factor. On the wrong row it is a lie in the
    // direction that matters.
    expect(withUser(0, { totp_enabled: false })).not.toBe(want);
    expect(withUser(1, { totp_enabled: true })).not.toBe(want);
    expect((G_OUT.match(/🔐 2FA/g) || []).length).toBe(1);
  });

  it('catches the email under a name changing', () => {
    expect(withUser(1, { email: 'someone.else@ctg.test' })).not.toBe(want);
  });

  it('catches the last-login trail changing — time, IP or count', () => {
    expect(withUser(0, { last_login_at: '2026-08-18T09:29:59.000Z' })).not.toBe(want);
    expect(withUser(0, { last_login_ip: '203.0.113.9' })).not.toBe(want);
    expect(withUser(0, { login_count: 413 })).not.toBe(want);
  });

  it('catches an escaping hole: server text reaches the page as text, not markup', () => {
    const html = renderToStaticMarkup(table({ users: [{ ...USERS[0], name: '<script>x</script>' }] }));
    expect(html).not.toContain('<script>');
  });

  it('LEGACY FINDING: app.html writes the company NAME unescaped and React cannot', () => {
    // app.html:5188-5190 interpolates `nm` with no esc() while escaping `ov` on the same line. React
    // escapes text always. The fixture's company names are plain, so nothing diverges in the diff above;
    // this pins the asymmetry rather than papering over it, and React is the safer of the two.
    const legacy = APP.slice(APP.indexOf('var comps=(USERS_UC[u.id]||[])'), APP.indexOf('var compTxt='));
    expect(legacy).toContain("var nm=c?c.tenant_name:tid;");
    expect(legacy).toContain("esc(ov)");
    expect(legacy).not.toContain('esc(nm)');
    expect(COMPANIES.every((c) => !/[<>&"']/.test(c.tenant_name))).toBe(true);
    const html = renderToStaticMarkup(table({ users: [USERS[1]], userCompanies: [{ user_id: 'u2', tenant_id: 't', role: '' }], companies: [{ tenant_id: 't', tenant_name: 'A & B <b>' }] }));
    expect(html).toContain('A &amp; B &lt;b&gt;');
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=` from the string comparison, so every case here is invisible to the diff above.
  // These are the defects that hand someone the wrong access.

  it('catches 🔑 Reset bound to a NEIGHBOURING row', () => {
    // `userReset(i)` resolves `USERS_LIST[i]` and sets that account's password to what the operator
    // typed. Off by one and a different person's account is handed over; on screen, nothing.
    expect(() => assertHandlerParity({ table: { onReset: ((i: number) => misfire(i + 1)) as never } }))
      .toThrow(/deeply equal/);
  });

  it('catches Edit bound to a neighbouring row', () => {
    // `userEdit(i)` opens the form over `USERS_LIST[i]`; saving it writes that user's role and company
    // grants. Editing the wrong row rewrites the wrong person's access.
    expect(() => assertHandlerParity({ table: { onEdit: ((i: number) => misfire(i + 1)) as never } }))
      .toThrow(/deeply equal/);
  });

  it('catches every row wired to the SAME user — the defect quoted-only extraction would miss', () => {
    expect(() => assertHandlerParity({ table: { onEdit: (() => misfire(0)) as never, onReset: (() => misfire(0)) as never } }))
      .toThrow(/deeply equal/);
  });

  it('catches Edit wired to something other than the edit path', () => {
    // Handler IDENTITY, not just its arguments: `userEdit(1)` and `userReset(1)` carry the SAME single
    // argument, so an Edit button that opened the password prompt (or the reverse) is invisible in the
    // argument sequence and is caught only by the prop each call is recorded under.
    expect(() => assertHandlerParity({ table: { onEdit: ((i: number) => misfire(i)) as never } }))
      .toThrow(/deeply equal/);
    expect(() => assertHandlerParity({ table: { onReset: ((i: number) => misfire(i)) as never } }))
      .toThrow(/deeply equal/);
  });

  it('catches a sub-nav button that opens the WRONG sub-view', () => {
    // "Active sessions" opening the audit log is a wrong screen; "Roles & permissions" opening Users is
    // an operator who thinks they checked the roles and did not.
    expect(() => assertHandlerParity({ subnav: { onView: ((_v: UsersView) => misfire('users')) as never } }))
      .toThrow(/deeply equal/);
  });

  it('catches a button that stopped calling anything at all', () => {
    expect(() => assertHandlerParity({ table: { onEdit: (() => {}) as never } })).toThrow(/deeply equal/);
    expect(() => assertHandlerParity({ panel: { onAdd: (() => {}) as never } })).toThrow(/deeply equal/);
    expect(() => assertHandlerParity({ subnav: { onView: (() => {}) as never } })).toThrow(/deeply equal/);
  });
});

describe('relTime — the clock is handed in, never read', () => {
  // hr.yearend's rule. The golden was captured at tests/render_harness.ts's FIXED_MS; a component that
  // called Date.now() itself would render "19 min ago" today and "3 months ago" in November, and the
  // diff above would start failing on a calendar, not on a change.
  it('renders every band the legacy has', () => {
    const at = (ms: number) => renderToStaticMarkup(<>{relTime(new Date(FIXED_MS - ms).toISOString(), FIXED_MS)}</>);
    expect(at(30_000)).toBe('just now');
    expect(at(19 * 60_000)).toBe('19 min ago');
    expect(at(5 * 3_600_000)).toBe('5 h ago');
    expect(at(2 * 86_400_000)).toBe('2 d ago');
    // Beyond 30 days the legacy falls back to `toLocaleDateString('en-GB',…)` with NO timeZone, so the
    // calendar day it prints follows the operator's browser zone — and the test machine's. Asserted as
    // the FORMAT rather than a fixed day for that reason. This band appears in no golden (the fixture's
    // three logins are 19 minutes, 3 days and never), so nothing in the diff above depends on it.
    expect(at(60 * 86_400_000)).toMatch(/^\d{2} [A-Z][a-z]{2} 26$/);
  });

  it('renders "never" as the legacy does, for null and for an empty string', () => {
    for (const v of [null, undefined, '']) {
      expect(renderToStaticMarkup(<>{relTime(v as never, FIXED_MS)}</>)).toBe('<span class="muted">never</span>');
    }
    expect(G_OUT).toContain('<span class="muted">never</span>');
  });

  it('does not read the clock itself — the golden pins one instant', () => {
    expect(rendered({ now: FIXED_MS + 3_600_000 })).not.toBe(relax(G_OUT));
  });
});

describe('the request a password reset makes — no golden sees it, and it hands over an account', () => {
  it('is exactly what userReset() POSTs, read out of app.html rather than retyped', () => {
    // A retyped expectation agrees with a widened port by construction.
    const fn = APP.slice(APP.indexOf('async function userReset(i){'), APP.indexOf('var UF_EDIT_ID=null;'));
    const legacy = [...fn.matchAll(/call\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(legacy).toEqual(["api:'user_reset_password',user_id:u.id,new_pass:pw"]);
    expect(resetBody('u2', 'hunter2')).toEqual({ api: 'user_reset_password', user_id: 'u2', new_pass: 'hunter2' });
  });

  it('carries the user id and the password and nothing else that could redirect it', () => {
    expect(Object.keys(resetBody('u2', 'x')).sort()).toEqual(['api', 'new_pass', 'user_id']);
  });

  it('never sends the row index — the server must decide on the id, not on a position', () => {
    expect(JSON.stringify(resetBody('u2', 'x'))).not.toMatch(/"i"|index|row/);
  });

  it('keeps the legacy minimum length, read out of app.html', () => {
    const fn = APP.slice(APP.indexOf('async function userReset(i){'), APP.indexOf('var UF_EDIT_ID=null;'));
    expect(fn).toContain('if(pw.length<' + MIN_PASSWORD + ')');
  });
});

describe('the permission gate — app.html:1420-1439, and it is NOT the line it looks like', () => {
  it('opens for a login that carries the users feature', () => {
    expect(usersReachable({ features: ['overview', 'users'], manage_users: false })).toBe(true);
  });

  it('is closed for every other shape of permission, including a missing one', () => {
    for (const p of [null, undefined, {}, { features: [] }, { features: null }, { features: ['user'] }, { features: ['overview'] }]) {
      expect(usersReachable(p as never)).toBe(false);
    }
  });

  it('is NOT manage_users — that toggle is OVERWRITTEN by the chain\'s final else', () => {
    // The finding. `users` is a STANDALONE `if` and the `if/else if` chain RESTARTS at `ctgaccess`, so
    // `users` matches no branch of it and falls through to `feats.indexOf(t)<0`, which runs afterwards
    // and overwrites the admin toggle. Copying app.html:1422 as if it decided the tab would grant it to
    // every administrator, including the one the goldens were captured as.
    const block = APP.slice(APP.indexOf("const feats=PERMS.features||[]"), APP.indexOf('// Hide any category whose sub-tabs'));
    expect(block).toContain("if(t==='users') el.classList.toggle('hide', !canManage);");
    expect(block).toContain("if(t==='ctgaccess') el.classList.toggle('hide', !canManage);");
    expect(block).toContain("else el.classList.toggle('hide', feats.indexOf(t)<0)");
    // No `else if` names 'users', so nothing stops it reaching the final else.
    expect(block).not.toContain("else if(t==='users')");
    expect(usersReachable({ manage_users: true, features: [] })).toBe(false);
    expect(usersReachable({ manage_users: false, features: ['users'] })).toBe(true);
  });

  it('matches the shipped fixture: the Administrator the goldens were captured as cannot see this tab', () => {
    // tests/render_fixtures.ts:27 — ALL_FEATURES does not contain 'users'. Reproduced, not adjusted.
    expect(usersReachable(FIXTURES.my_perms as never)).toBe(false);
    expect((FIXTURES.my_perms as { manage_users: boolean }).manage_users).toBe(true);
  });

  it('is what the route gates on — the screen lists every login and its access', () => {
    // Guard the guard: reaching this screen at all exposes every account, its role, its company grants,
    // its 2FA state and its last login IP, plus a button that resets a password.
    const html = renderToStaticMarkup(table());
    expect(html).toContain('boss@ctg.test');
    expect(html).toContain('203.0.113.7');
    expect(html).toContain('>🔑 Reset</button>');
  });
});
