// Finance OS · Users — the four sub-views that had no React screen, and the two modals the list opens.
//
// ── THERE IS NO GOLDEN FOR ANY OF THIS, WHICH CHANGES WHAT THE TEST HAS TO BE ─────────────────────
// `tests/golden/finance.users.html` was captured through `renderUsers()`, which opens on
// `USERS_VIEW||'users'` (app.html:4678) — so the harness reached `usersLoad()` and none of the other
// four renderers. Nothing here regenerates, edits or adds a golden, and nothing here touches
// tests/render_surfaces.ts, tests/parity.ts or tests/handlers.ts.
//
// In place of a diff, three kinds of evidence, in descending order of strength:
//
//  1. LEGACY-LITERAL PARITY. Every complete markup fragment the legacy renderer writes is read out of
//     app.html AT RUN TIME, put through the SAME relax() the 36 golden diffs use, and required to appear
//     in the React render of the state that produces it. That is byte-level on everything the legacy
//     spells statically — a renamed label, a dropped class, a changed style, a lost `<br>` all fail —
//     and it also covers branches a golden could never hold, because the test renders each branch. What
//     it CANNOT see is two correct fragments emitted in the wrong ORDER, so (2) and (3) carry that.
//  2. THE STATES A FRAGMENT CANNOT REACH — every figure, every threshold, every derived string — driven
//     directly against the component.
//  3. HANDLER BINDING, per row, driven through the same `reactHandlers()` walker the golden screens use.
//     R1 strips `on*=` from every string comparison in this repo, so nothing else holds a button to the
//     record it sits next to, and on this screen those records are people's access.
//
// NO SEVENTH RELAXATION, and none was needed: parity.ts's six are reused unchanged, as all 36 shipped
// screens have. No screen-local decoding rule was needed either — none of these four renderers writes a
// named or numeric character reference, a duplicate attribute, an empty `style=""` or a bare `&`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES } from '../../tests/render_fixtures';
import type { Company } from '../src/finance-users';
import AuditTable, {
  ACT_META, AuditEmpty, AuditPanel, actMetaFor, auditDetail, auditWhen, type AuditEvent,
} from '../src/finance-users-audit';
import {
  DEFAULT_ROLE, UserModal, pwValid, roleOptionLabel, ufTenants, userSaveBody, type UserFormUser,
} from '../src/finance-users-form';
import RolesTable, {
  FEATURE_META, RoleModal, RolesPanel, featureLabel, roleDeleteBody, roleDeleteConfirm, roleKey,
  roleSaveBody, type RoleRow,
} from '../src/finance-users-roles';
import SessionsTable, {
  FRESH_MS, SessionsPanel, isFresh, relSec, revokeBody, revokeConfirm, sessionRolePillClass, whoSafe,
  type Session,
} from '../src/finance-users-sessions';
import XeroOut, {
  MIN_WEBHOOK_KEY, XERO_ACTIONS, XERO_HANDOFF_PANELS, XERO_ORDER, XeroPanel, cacheCount,
  eventPillClass, eventWhen, webhookKeyBody, xeroActionBody, type WebhookResponse, type XeroAction,
} from '../src/finance-users-xero';
import { relax, REPO } from './parity';
import { reactHandlers, STUB_VALUE } from './handlers';

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');
const ROUTE = readFileSync(join(REPO, 'web', 'app', 'finance', 'users', 'page.tsx'), 'utf8');

/**
 * The instant the fixtures are written against — tests/render_harness.ts:19's `FIXED_MS`, copied for the
 * same reason web/tests/finance-users.parity.test.tsx copies it (render_harness.ts is the Deno harness
 * and Node cannot load it). Not a relaxation: it changes the INPUT, not what counts as a match, and the
 * derivations stay under test because the cases below move it.
 */
const FIXED_MS = Date.parse('2026-08-18T09:30:00.000Z');

const noop = () => {};

// ── reading the legacy ─────────────────────────────────────────────────────────────────────────────

/** One legacy function's source, between two anchors that must both still exist. */
function legacy(from: string, to: string): string {
  const a = APP.indexOf(from);
  const b = APP.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error(`app.html no longer contains ${JSON.stringify(a < 0 ? from : to)}`);
  return APP.slice(a, b);
}

/**
 * Every single-quoted JS string literal in a chunk of app.html, `\'` and `\\` honoured.
 *
 * The legacy renderers build their markup by `'…'+expr+'…'` concatenation, so these ARE the fragments
 * the operator's browser receives, minus the interpolated values.
 */
function stringLiterals(src: string): string[] {
  const out: string[] = [];
  // Line by line, because app.html also contains REGEX literals whose `[' ]` character classes would
  // desync a whole-file quote scanner — `whoSafe`'s `.replace(/['\\]/g,'')` (app.html:4704) is exactly
  // that. A line whose quotes do not balance is dropped rather than half-read, and `no markup fragment
  // is dropped by the scanner` below asserts no DROPPED line carried markup.
  for (const line of src.split('\n')) {
    const got: string[] = [];
    let open = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== "'") continue;
      let j = i + 1;
      let lit = '';
      while (j < line.length && line[j] !== "'") {
        if (line[j] === '\\') { lit += line[j + 1]; j += 2; continue; }
        lit += line[j]; j++;
      }
      if (j >= line.length) { open = true; break; }
      got.push(lit); i = j;
    }
    if (!open) out.push(...got);
  }
  return out;
}

/** The lines `stringLiterals()` had to drop. Must never carry markup — asserted per renderer below. */
function droppedLines(src: string): string[] {
  return src.split('\n').filter((line) => {
    let open = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== "'") continue;
      let j = i + 1;
      while (j < line.length && line[j] !== "'") { j += line[j] === '\\' ? 2 : 1; }
      if (j >= line.length) { open = true; break; }
      i = j;
    }
    return open;
  });
}

/**
 * The literals that can be compared: a fragment that STARTS a tag and is truncated to its last COMPLETE
 * tag. A literal that begins mid-attribute (`'" value="'`) or ends mid-attribute
 * (`'<input type="checkbox" class="uf-comp" data-tid="'`) cannot survive relax()'s attribute SORT, so it
 * is dropped rather than compared under a rule that would make it pass either way.
 *
 * That drop is the one hole in check (1), and it is bounded: the attribute names those partial literals
 * carry are the DOM contract `userSave()` / `roleSave()` / `sessionRevoke()` read the form back out by,
 * and they are pinned separately and by name in `the form's DOM contract` and `the revoke button`.
 */
function comparableFragments(src: string): string[] {
  return stringLiterals(src)
    .filter((s) => s.startsWith('<'))
    .map((s) => s.slice(0, s.lastIndexOf('>') + 1))
    .filter((s) => s.length > 8);
}

/**
 * Check (1). Every comparable fragment of `src` must appear in `html`, both sides through relax().
 *
 * `min` is the guard-the-guard: a slice that stopped yielding fragments — because a function was renamed
 * or its markup moved into a template literal — would make this pass vacuously, so the count is asserted
 * too.
 */
function pinsLegacyMarkup(src: string, html: string, min: number) {
  const frags = comparableFragments(src);
  expect(frags.length).toBeGreaterThanOrEqual(min);
  // Guard the guard: no line the scanner had to drop may have carried markup.
  expect(droppedLines(src).filter((l) => l.includes("'<"))).toEqual([]);
  const got = relax(html);
  const missing = frags.filter((f) => !got.includes(relax(f)));
  expect(missing).toEqual([]);
}

/** The route's error box, which lives in the route (impure) and fills `#…_out` on a failed load. */
const ERR_BOX = <div style={{ color: 'var(--red-soft)' }}>failed</div>;

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────

const SESSIONS = (FIXTURES.sessions_list as { sessions: Session[] }).sessions;
const EVENTS = (FIXTURES.audit_list as { events: AuditEvent[] }).events;
const HOOKS = FIXTURES.webhook_events as WebhookResponse;
const ROLES = (FIXTURES.roles_list as { roles: RoleRow[] }).roles;
const COMPANIES = (FIXTURES.companies_list as { companies: Company[] }).companies;

/** `rolesLoad()` returns `is_system` for the three built-ins; the shipped fixture does not carry it. */
const ROLE_ROWS: RoleRow[] = ROLES.map((r) => ({ ...r, is_system: r.name !== 'finance' }));

// ═══ 1 · ROLES & PERMISSIONS ══════════════════════════════════════════════════════════════════════

describe('Roles & permissions — rolesLoad() / roleForm()', () => {
  const SRC = legacy('async function rolesLoad(){', 'var RF_NAME=null;');
  const FORM_SRC = legacy('function roleForm(i){', 'function rfClose(){');

  const table = (over: Partial<Parameters<typeof RolesTable>[0]> = {}) =>
    <RolesTable roles={ROLE_ROWS} onEdit={noop} onDelete={noop} {...over} />;

  it('renders every fragment rolesLoad() writes, in every state it writes one', () => {
    // The panel with its spinner, the panel with the table, and the panel with the route's error box —
    // three documents, so the "no features" branch and the error branch are covered too.
    const all = renderToStaticMarkup(
      <>
        <RolesPanel onNew={noop} />
        <RolesPanel onNew={noop}>{table()}</RolesPanel>
        <RolesPanel onNew={noop}>{ERR_BOX}</RolesPanel>
        {table({ roles: [{ name: 'empty_role', label: '', features: [], manage_users: false, is_system: false }] })}
      </>,
    );
    pinsLegacyMarkup(SRC, all, 14);
  });

  it('renders every fragment roleForm() writes, for a new role and for an edit', () => {
    const all = renderToStaticMarkup(
      <>
        <RoleModal role={null} onClose={noop} onSave={noop} />
        <RoleModal role={ROLE_ROWS[0]} onClose={noop} onSave={noop} />
      </>,
    );
    pinsLegacyMarkup(FORM_SRC, all, 10);
  });

  it('FEATURE_META is app.html:4846\'s list, in order, and is NOT nav.ts\'s 22 tabs', () => {
    // The permission vocabulary. A key added here is offered as grantable; a key removed can never be
    // granted through this form again. Read out of app.html rather than retyped.
    const block = legacy('var FEATURE_META=[', '];');
    const pairs = [...block.matchAll(/\['([a-z0-9]+)','([^']*)'\]/g)].map((m) => [m[1], m[2]]);
    expect(pairs.length).toBe(10);
    expect(FEATURE_META).toEqual(pairs);
    // Guard the guard, in the direction that matters: twelve Finance tabs are deliberately absent.
    for (const off of ['users', 'ctgaccess', 'wht', 'selfbill', 'gateway', 'bankfeed', 'salesrecon', 'ocr', 'ap', 'info', 'calendar', 'pharm']) {
      expect(FEATURE_META.some((m) => m[0] === off)).toBe(false);
    }
  });

  it('prints a feature chip by its label, and an UNKNOWN key raw rather than blank', () => {
    expect(featureLabel('pnl')).toBe('📑 P&L Analysis');
    expect(featureLabel('some_new_tab')).toBe('some_new_tab');
    const html = renderToStaticMarkup(table({ roles: [{ name: 'r', features: ['some_new_tab'] }] }));
    expect(html).toContain('some_new_tab');
  });

  it('shows the granted features of each role and no other role\'s', () => {
    const html = renderToStaticMarkup(table());
    // Viewer opens two tabs; Administrator opens ten. A row that rendered the wrong role's feature list
    // tells an operator a read-only account can open the whole app.
    const rows = html.split('<tr>').slice(2);      // [0] is the <thead> row
    expect(rows.length).toBe(ROLE_ROWS.length);
    expect(rows[2]).toContain('📊 Overview');
    expect(rows[2]).toContain('📑 P&amp;L Analysis');
    expect(rows[2]).not.toContain('🎯 CFO Cockpit');
    expect(rows[0]).toContain('🎯 CFO Cockpit');
  });

  it('shows the "manage users" pill only on a role that carries it', () => {
    const html = renderToStaticMarkup(table());
    expect((html.match(/manage users/g) || []).length).toBe(1);
    const rows = html.split('<tr>').slice(2);
    expect(rows[0]).toContain('manage users');
    expect(rows[1]).not.toContain('manage users');
  });

  it('offers Delete on a custom role and NOT on a system role', () => {
    // Deleting a system role is what the legacy is stopping; a Delete button that appeared on `admin`
    // would offer to remove the only role that always keeps user management.
    const html = renderToStaticMarkup(table());
    expect((html.match(/>Delete</g) || []).length).toBe(1);
    const rows = html.split('<tr>').slice(2);
    expect(rows[1]).toContain('>Delete<');    // finance — the only non-system row
    expect(rows[0]).not.toContain('>Delete<');
    expect(rows[2]).not.toContain('>Delete<');
  });

  it('binds Edit and Delete to the row they sit in — not to a neighbour', () => {
    const calls = record((rec) => table({ onEdit: rec('edit'), onDelete: rec('del') }));
    // Three Edits (one per row) and one Delete (only `finance` is deletable), in document order.
    expect(calls).toEqual([
      { attr: 'edit', args: [0] },
      { attr: 'edit', args: [1] }, { attr: 'del', args: [1] },
      { attr: 'edit', args: [2] },
    ]);
    // Which row index 1 IS — a Delete that fired on the right index against a re-ordered list is a
    // different role. `roleDeleteBody` keys on the NAME, which is what the server acts on.
    expect(ROLE_ROWS[1].name).toBe('finance');
  });

  it('the request a role save makes is exactly what roleSave() POSTs', () => {
    const fn = legacy('async function roleSave(){', 'async function roleDelete(i){');
    expect([...fn.matchAll(/call\(\{([^}]*)\}\)/g)].map((m) => m[1]))
      .toEqual(["api:'role_save',name:name,label:label||name,features:features,manage_users:manage_users"]);
    expect(roleSaveBody('billing_clerk', 'Billing Clerk', ['qinv'], false))
      .toEqual({ api: 'role_save', name: 'billing_clerk', label: 'Billing Clerk', features: ['qinv'], manage_users: false });
    // A blank label falls back to the key — app.html:4896 — so no role is stored with an empty name.
    expect(roleSaveBody('x', '', [], true).label).toBe('x');
    // And a blank key is refused rather than posted: `roleSave()` says "Role key is required".
    expect(() => roleSaveBody('', 'L', [], false)).toThrow();
    expect(fn).toContain("err.textContent='Role key is required'");
  });

  it('slugs a NEW role key and can never rename an existing one', () => {
    const fn = legacy('async function roleSave(){', 'async function roleDelete(i){');
    expect(fn).toContain("var name=(RF_NAME!=null)?RF_NAME:document.getElementById('rf_name').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'_');");
    expect(roleKey(null, '  Billing Clerk! ')).toBe('billing_clerk_');
    // The direction that matters: on an edit the typed value is IGNORED, so a role cannot be renamed out
    // from under every user holding it — `PERMS.role` would stop matching and they would lose every tab.
    expect(roleKey('finance', 'something_else')).toBe('finance');
  });

  it('the request a role delete makes carries the NAME, never the row index', () => {
    const fn = legacy('async function roleDelete(i){', '/* ---- Permission audit log ---- */');
    expect([...fn.matchAll(/call\(\{([^}]*)\}\)/g)].map((m) => m[1])).toEqual(["api:'role_delete',name:ro.name"]);
    expect(roleDeleteBody('billing_clerk')).toEqual({ api: 'role_delete', name: 'billing_clerk' });
    expect(JSON.stringify(roleDeleteBody('x'))).not.toMatch(/"i"|index|row/);
    expect(() => roleDeleteBody('')).toThrow();
  });

  it('asks before deleting, in the legacy\'s own words', () => {
    const fn = legacy('async function roleDelete(i){', '/* ---- Permission audit log ---- */');
    expect(fn).toContain("confirm('Delete role \"'+(ro.label||ro.name)+'\"? Users must be reassigned first.')");
    expect(roleDeleteConfirm({ name: 'x', label: 'Billing Clerk' }))
      .toBe('Delete role "Billing Clerk"? Users must be reassigned first.');
    expect(roleDeleteConfirm({ name: 'x' })).toBe('Delete role "x"? Users must be reassigned first.');
    // And the route actually asks. R1 sees nothing here; a dropped confirm() is one mis-click.
    // The control is the shell's ported dialog (src/confirm.tsx) rather than the browser's own — the
    // WORDS are still `roleDeleteConfirm()`'s, which is what this pins.
    expect(ROUTE).toContain("if (!await showConfirm('Delete role', roleDeleteConfirm(ro), 'Delete')) return;");
  });

  it('the role form\'s DOM contract is every id and class roleSave() reads back', () => {
    // The `qi_*` / `data-k` treatment: the names are extracted from app.html at run time, because a
    // retyped list agrees with a widened port by construction. A checkbox that lost `class="rf-feat"`
    // saves the role with that tab silently REMOVED for everyone holding it, and shows no error.
    const fn = legacy('async function roleSave(){', 'async function roleDelete(i){');
    const ids = [...fn.matchAll(/getElementById\('([a-z_]+)'\)/g)].map((m) => m[1]);
    const classes = [...fn.matchAll(/querySelectorAll\('\.([a-z-]+)/g)].map((m) => m[1]);
    expect(ids.sort()).toEqual(['rf_err', 'rf_label', 'rf_manage', 'rf_name', 'rf_save']);
    expect(classes).toEqual(['rf-feat']);
    const html = renderToStaticMarkup(<RoleModal role={ROLE_ROWS[1]} onClose={noop} onSave={noop} />);
    for (const id of ids) expect(html).toContain(`id="${id}"`);
    for (const c of classes) expect((html.match(new RegExp(`class="${c}"`, 'g')) || []).length).toBe(FEATURE_META.length);
  });

  it('ticks exactly the features the role already holds', () => {
    const html = renderToStaticMarkup(<RoleModal role={{ name: 'viewer', features: ['overview', 'pnl'] }} onClose={noop} onSave={noop} />);
    // React fixes `value` at the END of an <input> however the JSX orders it (parity.ts's R4 note), so
    // the tick is read from the whole tag rather than from a position inside it.
    const boxes = [...html.matchAll(/<input type="checkbox" class="rf-feat"[^>]*value="([a-z0-9]+)"[^>]*>/g)];
    expect(boxes.map((m) => m[1])).toEqual(FEATURE_META.map((m) => m[0]));
    expect(boxes.filter((m) => m[0].includes('checked')).map((m) => m[1])).toEqual(['overview', 'pnl']);
  });

  it('locks the key on an edit and on a system role, and locks manage_users on admin', () => {
    const src = legacy('function roleForm(i){', 'function rfClose(){');
    expect(src).toContain("(isSys||i!=null?'disabled':'')");
    expect(src).toContain("(ro.name==='admin'?'disabled':'')");
    const nw = renderToStaticMarkup(<RoleModal role={null} onClose={noop} onSave={noop} />);
    const edit = renderToStaticMarkup(<RoleModal role={ROLE_ROWS[1]} onClose={noop} onSave={noop} />);
    const admin = renderToStaticMarkup(<RoleModal role={ROLE_ROWS[0]} onClose={noop} onSave={noop} />);
    expect(nw).toContain('<input id="rf_name" placeholder="e.g. billing_clerk"');
    expect(nw).not.toMatch(/id="rf_name"[^>]*disabled/);
    expect(edit).toMatch(/id="rf_name"[^>]*disabled/);
    // The legacy keys the manage_users lock on the NAME, not on is_system; `finance` is not locked.
    expect(admin).toMatch(/id="rf_manage"[^>]*disabled/);
    expect(edit).not.toMatch(/id="rf_manage"[^>]*disabled/);
  });
});

// ═══ 2 · ACTIVE SESSIONS ═══════════════════════════════════════════════════════════════════════════

describe('Active sessions — sessionsLoad() / sessionRevoke()', () => {
  const SRC = legacy('async function sessionsLoad(){', 'async function sessionRevoke(sid, who){');

  const table = (over: Partial<Parameters<typeof SessionsTable>[0]> = {}) =>
    <SessionsTable sessions={SESSIONS} now={FIXED_MS} onRevoke={noop} {...over} />;

  it('renders every fragment sessionsLoad() writes, in every state it writes one', () => {
    const all = renderToStaticMarkup(
      <>
        <SessionsPanel onRefresh={noop} />
        <SessionsPanel onRefresh={noop}>{table()}</SessionsPanel>
        <SessionsPanel onRefresh={noop}>{ERR_BOX}</SessionsPanel>
        {table({ sessions: [] })}
      </>,
    );
    pinsLegacyMarkup(SRC, all, 16);
  });

  it('relSec renders every band the legacy has, and never reaches a locale date', () => {
    // A different ladder from the Users list's relTime(): no 30-day cutoff, so no toLocaleDateString and
    // no timezone anywhere on this sub-view.
    const at = (ms: number) => relSec(new Date(FIXED_MS - ms).toISOString(), FIXED_MS);
    expect(at(12_000)).toBe('12s ago');
    expect(at(19 * 60_000)).toBe('19m ago');
    expect(at(5 * 3_600_000)).toBe('5h ago');
    expect(at(400 * 86_400_000)).toBe('400d ago');
    expect(relSec(null, FIXED_MS)).toBe('—');
    expect(relSec('', FIXED_MS)).toBe('—');
    expect(SRC).not.toContain('toLocale');
  });

  it('turns the green dot on AT the five-minute boundary, not near it', () => {
    // CLAUDE.md's finance.cfo finding: a fixture on the safe side of a threshold proves the branch
    // exists, not where it is. Widening this to an hour paints "active now" beside an idle session.
    expect(SRC).toContain('< 5*60*1000');
    expect(FRESH_MS).toBe(5 * 60 * 1000);
    const at = (ms: number) => isFresh({ last_seen_at: new Date(FIXED_MS - ms).toISOString() }, FIXED_MS);
    expect(at(FRESH_MS - 1)).toBe(true);
    expect(at(FRESH_MS)).toBe(false);          // strictly less-than, as the legacy is
    expect(at(FRESH_MS + 1)).toBe(false);
    expect(isFresh({ last_seen_at: null }, FIXED_MS)).toBe(false);
    // And the two dots really are different markup, so the boundary is visible on screen.
    const green = renderToStaticMarkup(table({ sessions: [{ sid: 'a', last_seen_at: new Date(FIXED_MS - 1).toISOString() }] }));
    const grey = renderToStaticMarkup(table({ sessions: [{ sid: 'a', last_seen_at: new Date(FIXED_MS - FRESH_MS).toISOString() }] }));
    expect(green).toContain('class="dot-green"');
    expect(grey).not.toContain('dot-green');
    expect(grey).toContain('background:#445');
  });

  it('does not read the clock itself — the durations move when the instant does', () => {
    expect(renderToStaticMarkup(table({ now: FIXED_MS + 3_600_000 })))
      .not.toBe(renderToStaticMarkup(table()));
  });

  it('the revoke button on row i carries row i\'s session — attribute AND handler', () => {
    // `onclick="sessionRevoke(this.dataset.sid,this.dataset.who)"` carries no identifying argument at
    // all, so neither quoted-literal nor bare-integer extraction can tell one row's Revoke from
    // another's. What CAN be compared is that the sid rendered into the row equals the sid the row's
    // handler dispatches — a mismatch is one person signed out of the accounting system for another.
    const html = renderToStaticMarkup(table());
    const sids = [...html.matchAll(/data-sid="([^"]*)"/g)].map((m) => m[1]);
    const dispatched: string[] = [];
    reactHandlers(table({ onRevoke: ((s: Session) => dispatched.push(s.sid || '')) as never }))
      .forEach((h) => h.invoke());
    expect(sids).toEqual(['s2', 's3']);          // s1 is `is_self` and has no button
    expect(dispatched).toEqual(sids);
    // Guard the guard: an off-by-one really does fail this.
    const off: string[] = [];
    reactHandlers(table({ onRevoke: ((s: Session) => off.push(SESSIONS[SESSIONS.indexOf(s) - 1]?.sid || 'x')) as never }))
      .forEach((h) => h.invoke());
    expect(off).not.toEqual(sids);
  });

  it('never offers to revoke the operator\'s OWN session', () => {
    // app.html:4705 — `is_self` gets an em dash, not a button. A port that offered it lets an operator
    // sign themselves out mid-task, and on the only account that could sign back in.
    const html = renderToStaticMarkup(table());
    expect((html.match(/>Revoke</g) || []).length).toBe(SESSIONS.length - 1);
    const selfRow = html.split('<tr>').slice(2)[0];
    expect(selfRow).toContain('this device');
    expect(selfRow).not.toContain('Revoke');
    // And the reverse: a session that stopped being flagged self DOES get one.
    expect(renderToStaticMarkup(table({ sessions: [{ ...SESSIONS[0], is_self: false }] }))).toContain('>Revoke<');
  });

  it('strips the quote characters the legacy strips from the display name', () => {
    expect(whoSafe({ user_name: "O'BRIEN \\ CO" })).toBe('OBRIEN  CO');
    expect(whoSafe({ user_name: '', user_email: 'x@y.test' })).toBe('x@y.test');
    expect(whoSafe({})).toBe('');
    expect(SRC).toContain("String(s.user_name||s.user_email||'').replace(/['\\\\]/g,'')");
  });

  it('the request a revoke makes is exactly what sessionRevoke() POSTs, and refuses a blank sid', () => {
    const fn = legacy('async function sessionRevoke(sid, who){', 'function roleLabelFor(name)');
    expect([...fn.matchAll(/call\(\{([^}]*)\}\)/g)].map((m) => m[1])).toEqual(["api:'session_revoke', sid:sid"]);
    expect(revokeBody('s2')).toEqual({ api: 'session_revoke', sid: 's2' });
    expect(Object.keys(revokeBody('s2')).sort()).toEqual(['api', 'sid']);
    expect(() => revokeBody('')).toThrow();
    expect(fn).toContain("confirm('Revoke session for '+who+'? They will be signed out immediately.')");
    expect(revokeConfirm('AZLINA')).toBe('Revoke session for AZLINA? They will be signed out immediately.');
    // Ported dialog, legacy words — see the role-delete case above.
    expect(ROUTE).toContain("if (!await showConfirm('Revoke session', revokeConfirm(whoSafe(s)), 'Revoke')) return;");
  });

  it('colours the role pill from the role, and shows the token fingerprint not the token', () => {
    expect(sessionRolePillClass('admin')).toBe('pill-coral');
    expect(sessionRolePillClass('approver')).toBe('pill-blue');
    expect(sessionRolePillClass('viewer')).toBe('pill-draft');
    expect(sessionRolePillClass(null)).toBe('pill-draft');
    const html = renderToStaticMarkup(table());
    expect(html).toContain('a1b2…9f0');
    // WITHHELD DIRECTION, driven rather than observed. The first cut of this assertion only checked the
    // FIXTURE's own markup for a long string — and the fixture carries a short token, so it sat on the
    // safe side of the very branch it was meant to guard and passed with the component printing a full
    // token as well. CLAUDE.md's finance.info finding. So the session is handed something that MUST NOT
    // reach the screen, and the screen is checked for it: `sessions_list` is a row of the sessions table,
    // and a port that widened the token column to whatever else the server sends hands out live bearer
    // tokens for every logged-in account, from the one screen an administrator leaves open.
    const secret = 'FULLTOKEN' + 'x'.repeat(40);
    const leak = renderToStaticMarkup(table({
      sessions: [{ ...SESSIONS[1], token: secret, user_agent: 'Mozilla/5.0' } as Session],
    }));
    expect(leak).toContain('c3d4…1a2');
    expect(leak).not.toContain(secret);
    expect(leak).not.toContain('Mozilla');
    expect(leak).not.toMatch(/ctg_portal_token|Bearer|[A-Za-z0-9]{40}/);
  });
});

// ═══ 3 · AUDIT LOG ═════════════════════════════════════════════════════════════════════════════════

describe('Audit log — auditLoad()', () => {
  const SRC = legacy('async function auditLoad(){', '/* ---- Xero sync (live webhook activity + cache) ---- */');

  it('renders every fragment auditLoad() writes, including the empty state', () => {
    const all = renderToStaticMarkup(
      <>
        <AuditPanel onRefresh={noop} />
        <AuditPanel onRefresh={noop}><AuditTable events={EVENTS} /></AuditPanel>
        <AuditPanel onRefresh={noop}><AuditEmpty /></AuditPanel>
        <AuditPanel onRefresh={noop}>{ERR_BOX}</AuditPanel>
      </>,
    );
    pinsLegacyMarkup(SRC, all, 11);
  });

  it('IS NOT WRITABLE FROM THIS SCREEN — one control, and it only re-reads', () => {
    // The withheld direction, and the reason this sub-view exists: it is the record of who changed the
    // permissions the other three sub-views hand out, and five of the seven actions it names are this
    // screen's own. A control that could edit or delete a row would let the person being audited erase
    // it. The empty state is asserted too — "no events" must not become a place to add one.
    for (const tree of [<AuditTable events={EVENTS} />, <AuditEmpty />]) {
      const html = renderToStaticMarkup(tree);
      expect(reactHandlers(tree)).toEqual([]);
      expect(html).not.toMatch(/<input|<select|<textarea|<form|<button/);
    }
    // The panel's ONE handler is ↻ Refresh, and it takes no argument that could redirect it.
    const panel = <AuditPanel onRefresh={noop}><AuditTable events={EVENTS} /></AuditPanel>;
    expect(reactHandlers(panel).map((h) => h.attr)).toEqual(['onclick']);
    expect((SRC.match(/onclick="/g) || []).length).toBe(1);
    expect(SRC).toContain('onclick="auditLoad()"');
    // And the route asks the server for exactly one thing on this sub-view: a read.
    const load = ROUTE.slice(ROUTE.indexOf('const loadAudit'), ROUTE.indexOf('const loadXero'));
    expect([...load.matchAll(/api: '([a-z_]+)'/g)].map((m) => m[1])).toEqual(['audit_list']);
    expect(load).toContain('limit: 150');
    expect(SRC).toContain("{api:'audit_list',limit:150}");
  });

  it('ACT_META is app.html:4916\'s map, read out of app.html rather than retyped', () => {
    const m = SRC.slice(SRC.indexOf('var actMeta={'), SRC.indexOf('};', SRC.indexOf('var actMeta={')));
    const pairs = [...m.matchAll(/([a-z0-9_]+):\['([a-z-]+)','([^']*)'\]/g)];
    expect(pairs.length).toBe(7);
    expect(Object.fromEntries(pairs.map((p) => [p[1], [p[2], p[3]]]))).toEqual(ACT_META);
    // The label is the only place the action is named. `Reset password` shown as `Updated user` hides
    // the most sensitive act on the screen behind the most ordinary one.
    expect(actMetaFor('password_reset')).toEqual(['pill-coral', 'Reset password']);
  });

  it('prints an action the map does not name RAW, not as a blank cell', () => {
    expect(actMetaFor('totp_disable')).toEqual(['pill-draft', 'totp_disable']);
    expect(renderToStaticMarkup(<AuditTable events={EVENTS} />)).toContain('totp_disable');
    expect(actMetaFor(null)).toEqual(['pill-draft', '']);
  });

  it('collapses an ARRAY detail to a count and never names its members', () => {
    // app.html:4918. `tenants` on a user_update is the list of companies just granted; the legacy counts
    // them. Widening that to a list puts company grants into a log that today only counts them.
    expect(auditDetail({ role: 'viewer', tenants: ['a', 'b'] })).toBe('role: viewer · tenants: 2 item(s)');
    expect(auditDetail({ tenants: [] })).toBe('tenants: 0 item(s)');
    expect(auditDetail({})).toBe('');
    expect(auditDetail(null)).toBe('');
    const html = renderToStaticMarkup(<AuditTable events={EVENTS} />);
    expect(html).toContain('(role: viewer · tenants: 2 item(s))');
    expect(SRC).toContain("(Array.isArray(v)?(v.length+' item(s)'):esc(String(v)))");
  });

  it('rows print the actor and the target, and a missing actor as an em dash', () => {
    const rows = renderToStaticMarkup(<AuditTable events={EVENTS} />).split('<tr>').slice(2);
    expect(rows[0]).toContain('boss@ctg.test');
    expect(rows[0]).toContain('acct@ctg.test');       // the account whose password was reset
    expect(rows[3]).toContain('>—</td>');
    expect(rows.length).toBe(EVENTS.length);
  });

  it('THE TIMESTAMP READS THE MACHINE\'S ZONE, and that is pinned by SOURCE on both sides', () => {
    // CLAUDE.md's finance.calendar finding, in its fifth form. This fleet AND CI sit at UTC+8, so
    // ADDING `timeZone:'Asia/Kuala_Lumpur'` here — which would be an improvement, and which finance.ap
    // does — passes every output assertion this file can write while making the two renderers disagree
    // about when a password was reset. Verified by making that change: only this test went red.
    expect(SRC).toContain("var when=e.created_at?new Date(e.created_at).toLocaleString():'';");
    const mine = readFileSync(join(REPO, 'web', 'src', 'finance-users-audit.tsx'), 'utf8');
    const fn = mine.slice(mine.indexOf('export function auditWhen'), mine.indexOf('\n}', mine.indexOf('export function auditWhen')));
    expect(fn).toContain('new Date(iso).toLocaleString()');
    expect(fn).not.toMatch(/timeZone|'en-|toLocaleDateString|getMonth|getFullYear/);
    expect(auditWhen(null)).toBe('');
    expect(auditWhen('')).toBe('');
    expect(auditWhen('2026-08-18T09:12:00.000Z')).toBe(new Date('2026-08-18T09:12:00.000Z').toLocaleString());
  });

  it('LEGACY FINDING: the detail KEY is written unescaped and React cannot do that', () => {
    // app.html:4918 escapes the VALUE and not the KEY, then splices the whole string into innerHTML.
    // React escapes both. Same asymmetry the Users table's `nm`/`ov` carries; pinned, not papered over.
    expect(SRC).toContain('return k+\': \'+(Array.isArray(v)?');
    const html = renderToStaticMarkup(<AuditTable events={[{ action: 'x', ref: 'r', detail: { '<b>k</b>': 'v' } }]} />);
    expect(html).not.toContain('<b>k</b>');
    expect(html).toContain('&lt;b&gt;k&lt;/b&gt;');
  });
});

// ═══ 4 · XERO SYNC ═════════════════════════════════════════════════════════════════════════════════

describe('Xero sync — xeroSyncLoad() and its three actions', () => {
  // The FIRST panel only; the six below it hand off. Both halves of that claim are pinned below.
  const HEAD = legacy("async function xeroSyncLoad(){", '// v65: pull latest org NAMES from Xero /connections');
  const DEFERRED = legacy("'<div class=\"panel\" style=\"margin-top:16px\"><div class=\"panel-hd\"><h3>🏢 Company names", '  arAgingLoad();');
  const OUT = legacy('var cfg = r.configured', '}catch(e){ document.getElementById(\'xero_out\').innerHTML=');

  const out = (over: Partial<WebhookResponse> = {}) =>
    <XeroOut r={{ ...HOOKS, ...over }} apiUrl="https://example.test/functions/v1/portal"
             keyPanelOpen={false} onToggleKeyPanel={noop} onSaveKey={noop} />;

  it('renders every fragment of the webhook-activity panel, busy and idle', () => {
    const all = renderToStaticMarkup(
      <>
        <XeroPanel busy={null} onAction={noop} onRefresh={noop} />
        <XeroPanel busy={null} onAction={noop} onRefresh={noop}>{ERR_BOX}</XeroPanel>
      </>,
    );
    pinsLegacyMarkup(HEAD, all, 1);
  });

  it('renders every fragment of #xero_out, configured and not, with events and without', () => {
    const all = renderToStaticMarkup(
      <>
        {out()}
        {out({ configured: false })}
        {out({ events: [], pending: 0 })}
      </>,
    );
    pinsLegacyMarkup(OUT, all, 22);
  });

  it('SCOPE: the six panels below it are NOW ported — every handler is wired in the route', () => {
    // Previously the honest strangler edge; now all six tools render in React.
    for (const title of XERO_HANDOFF_PANELS) expect(DEFERRED).toContain(title);
    expect(XERO_HANDOFF_PANELS.length).toBe(6);
    // Guard the guard: the deferred slice really is six panels of app.html.
    expect((DEFERRED.match(/<div class="panel"/g) || []).length).toBe(6);
    // Their handlers ARE now wired in the React route…
    for (const h of ['onTenantsRefresh', 'onDriftCheck', 'onSyncAudit', 'onInvoiceResync', 'onTenantRebuild', 'onArBucket']) {
      expect(ROUTE).toContain(h);
    }
    // …and the handoff banner is gone.
    expect(ROUTE).not.toContain('Still on the legacy screen');
  });

  it('each of the three buttons posts what its LABEL says, and nothing else does', () => {
    // The transcription, read back out of app.html: the button id, the api and the busy caption must
    // agree three ways. A Delta button wired to `xero_backfill` re-pulls every invoice for every company
    // and looks identical while it does it.
    const bodies: Record<string, string> = {
      backfill: legacy('async function xeroBackfill(){', 'async function xeroDeltaNow(){'),
      delta: legacy('async function xeroDeltaNow(){', 'async function xeroDriftCheck(){'),
      queue: legacy('async function xeroSyncNow(){', '// v65: pull latest company names'),
    };
    for (const a of XERO_ORDER) {
      const spec = XERO_ACTIONS[a];
      expect(bodies[a]).toContain(`getElementById('${spec.id}')`);
      expect(bodies[a]).toContain(`call({api:'${spec.api}'})`);
      expect(bodies[a]).toContain(`btn.textContent='${spec.busyLabel}'`);
      expect(HEAD).toContain(`id="${spec.id}"`);
      expect(HEAD).toContain(`>${spec.label}<`);
      expect(xeroActionBody(a)).toEqual({ api: spec.api });
    }
    // Three distinct apis — a copy-paste that pointed two buttons at one endpoint fails here.
    expect(new Set(XERO_ORDER.map((a) => XERO_ACTIONS[a].api)).size).toBe(3);
    expect(() => xeroActionBody('nope' as XeroAction)).toThrow();
  });

  it('binds each button to its own action, in the legacy\'s order', () => {
    const calls = record((rec) => <XeroPanel busy={null} onAction={rec('act') as never} onRefresh={rec('refresh') as never} />);
    expect(calls).toEqual([
      { attr: 'act', args: ['backfill'] }, { attr: 'act', args: ['delta'] },
      { attr: 'act', args: ['queue'] }, { attr: 'refresh', args: [] },
    ]);
    // The order is the legacy's: ⤓ Full sync, ⚡ Delta, ⟳ Process queue, ↻ Refresh. A swap puts the
    // heaviest operation under the lightest caption.
    const html = renderToStaticMarkup(<XeroPanel busy={null} onAction={noop} onRefresh={noop} />);
    expect(html.indexOf('xbackfill_btn')).toBeLessThan(html.indexOf('xdelta_btn'));
    expect(html.indexOf('xdelta_btn')).toBeLessThan(html.indexOf('xsync_btn'));
  });

  it('NONE CAN FIRE TWICE — the button disables itself and the route refuses a repeat', () => {
    // Two halves, because the legacy only has the first. app.html disables ONLY the clicked button
    // (:4990, :5033, :5041), so a second, DIFFERENT sync can be started against a live Xero connection
    // while the first is still running. The markup mirrors that; the route closes it — finance.approvals'
    // treatment of the same gap.
    for (const a of XERO_ORDER) {
      const html = renderToStaticMarkup(<XeroPanel busy={a} onAction={noop} onRefresh={noop} />);
      expect(html).toMatch(new RegExp(`id="${XERO_ACTIONS[a].id}" disabled`));
      expect(html).toContain(`>${XERO_ACTIONS[a].busyLabel}<`);
      expect(html).not.toContain(`>${XERO_ACTIONS[a].label}<`);
      // …and the other two are NOT disabled in the markup, exactly as the legacy leaves them.
      for (const b of XERO_ORDER) if (b !== a) expect(html).not.toMatch(new RegExp(`id="${XERO_ACTIONS[b].id}" disabled`));
    }
    expect(renderToStaticMarkup(<XeroPanel busy={null} onAction={noop} onRefresh={noop} />)).not.toContain('disabled');
    // The route's guard, which is what actually stops the second dispatch.
    const fn = ROUTE.slice(ROUTE.indexOf('const onXeroAction'), ROUTE.indexOf('/** `saveWebhookKey()`'));
    expect(fn).toContain('if (xeroBusy) return;');
    expect(fn).toContain('setXeroBusy(a);');
    expect(fn).toContain('setXeroBusy(null)');
  });

  it('the webhook key panel is only offered where a key already exists, and the anchor preventDefaults', () => {
    // finance.info's finding: a `preventDefault` that disappears from an `<a href="#">` is invisible to
    // handler parity, because the recorded argument list is identical either way. It is what stops the
    // click navigating to `#` and losing the screen.
    expect(OUT).toContain("event.preventDefault();return false");
    const seen: string[] = [];
    const tree = <XeroOut r={HOOKS} apiUrl="x" keyPanelOpen={false}
                          onToggleKeyPanel={(e) => { if (e.preventDefault) seen.push('pd'); }} onSaveKey={noop} />;
    reactHandlers(tree).forEach((h) => h.invoke());
    expect(seen).toEqual([]);       // the shared stub carries no preventDefault
    const fn = ROUTE.slice(ROUTE.indexOf('const onToggleKeyPanel'), ROUTE.indexOf('// ── the body of #uv_body'));
    expect(fn).toContain('if (e && e.preventDefault) e.preventDefault();');
    // `hide` is the legacy's own initial state, and the panel only exists on the configured branch.
    expect(renderToStaticMarkup(out())).toContain('<div id="wk_change" class="hide"');
    expect(renderToStaticMarkup(<XeroOut r={HOOKS} apiUrl="x" keyPanelOpen onToggleKeyPanel={noop} onSaveKey={noop} />))
      .toContain('<div id="wk_change" class=""');
    expect(renderToStaticMarkup(out({ configured: false }))).not.toContain('wk_change');
    expect(renderToStaticMarkup(out({ configured: false }))).toContain('Webhook not activated yet');
  });

  it('the webhook key is a SECRET: type=password, never rendered back, minimum length enforced', () => {
    const fn = legacy('async function saveWebhookKey(){', 'async function arBucket(key,label){');
    expect(fn).toContain('if(v.length<10)');
    expect([...fn.matchAll(/call\(\{([^}]*)\}\)/g)].map((m) => m[1])).toEqual(["api:'set_webhook_key',key:v"]);
    expect(MIN_WEBHOOK_KEY).toBe(10);
    expect(() => webhookKeyBody('short')).toThrow();
    expect(() => webhookKeyBody('   ' + 'x'.repeat(9) + '   ')).toThrow();   // trimmed before measuring
    expect(webhookKeyBody('  ' + 'k'.repeat(12) + '  ')).toEqual({ api: 'set_webhook_key', key: 'k'.repeat(12) });
    for (const html of [renderToStaticMarkup(out()), renderToStaticMarkup(out({ configured: false }))]) {
      expect(html).toContain('id="wk_input" type="password"');
      expect(html).not.toMatch(/wk_input[^>]*value=/);          // never echoed back into the DOM
    }
  });

  it('the three stat cards read from the fields they are labelled with', () => {
    // Three near-identical cards. `Invoices cached` showing the contact count is a number that looks
    // right and is not, and nothing else on the screen contradicts it.
    const html = renderToStaticMarkup(out({ contact_cache: 12480, invoice_cache: 104233, pending: 3 }));
    const cards = html.split('<div class="card">').slice(1);
    expect(cards[0]).toContain(cacheCount(12480));
    expect(cards[0]).toContain('Contacts cached');
    expect(cards[1]).toContain(cacheCount(104233));
    expect(cards[1]).toContain('Invoices cached');
    expect(cards[2]).toContain('>3<');
    expect(cards[2]).toContain('Pending sync');
    expect(cacheCount(12480)).not.toBe(cacheCount(104233));
  });

  it('the pending card turns amber AT one, and pending is deliberately NOT grouped', () => {
    expect(OUT).toContain("(r.pending||0)>0?'var(--amber)':'var(--green-soft)'");
    const at = (p: number) => renderToStaticMarkup(out({ pending: p })).split('<div class="card">')[3];
    expect(at(0)).toContain('var(--green-soft)');
    expect(at(1)).toContain('var(--amber)');
    expect(at(0)).not.toContain('var(--amber)');
    // The legacy's own inconsistency, mirrored: the two cache counts are grouped and pending is not.
    expect(OUT).toContain('(r.contact_cache||0).toLocaleString()');
    expect(OUT).toContain("'\">'+(r.pending||0)+'</div>");
    expect(at(12480)).toContain('>12480<');
  });

  it('an event\'s pill follows its TYPE and its status follows `processed`', () => {
    expect(eventPillClass('CREATE')).toBe('pill-green');
    expect(eventPillClass('UPDATE')).toBe('pill-blue');
    expect(eventPillClass('DELETE')).toBe('pill-draft');
    expect(eventPillClass(null)).toBe('pill-draft');
    const rows = renderToStaticMarkup(out()).split('<tr>').slice(2);
    expect(rows[0]).toContain('INVOICE · UPDATE');
    expect(rows[0]).toContain('>synced<');
    expect(rows[1]).toContain('CONTACT · CREATE');
    expect(rows[1]).toContain('>queued<');       // processed:false — a queued event shown as synced is
    expect(rows[1]).not.toContain('>synced<');   // a sync problem that reads as no problem at all
  });

  it('the delivery URL printed for pasting into Xero is the one handed in', () => {
    const html = renderToStaticMarkup(out());
    expect(html).toContain('https://example.test/functions/v1/portal');
    expect(OUT).toContain('esc(API)');
    expect(ROUTE).toContain('apiUrl={API}');
  });

  it('the event timestamp is the audit log\'s finding, in the same screen', () => {
    expect(OUT).toContain("var when=e.received_at?new Date(e.received_at).toLocaleString():'';");
    const mine = readFileSync(join(REPO, 'web', 'src', 'finance-users-xero.tsx'), 'utf8');
    const fn = mine.slice(mine.indexOf('export function eventWhen'), mine.indexOf('\n}', mine.indexOf('export function eventWhen')));
    expect(fn).toContain('new Date(iso).toLocaleString()');
    expect(fn).not.toMatch(/timeZone|'en-|getMonth|getFullYear/);
    expect(eventWhen(null)).toBe('');
  });
});

// ═══ 5 · THE ADD / EDIT USER FORM ══════════════════════════════════════════════════════════════════

describe('userForm() — the widest grant on the screen', () => {
  const SRC = legacy('function userForm(u){', 'function ufToggleRow(cb){');
  const SAVE = legacy('async function userSave(){', '/* ---- Roles & permissions ---- */');

  const EDIT: UserFormUser = {
    id: 'u2', name: 'AZLINA BINTI OTHMAN', email: 'acct@ctg.test', role: 'finance', active: true,
    tenants: [{ tenant_id: COMPANIES[0].tenant_id, role: 'viewer' }],
  };
  const modal = (u: UserFormUser | null) =>
    <UserModal user={u} companies={COMPANIES} roles={ROLES} onClose={noop} onSave={noop} onCompToggle={noop} />;

  it('renders every fragment userForm() writes, for Add and for Edit', () => {
    pinsLegacyMarkup(SRC, renderToStaticMarkup(<>{modal(null)}{modal(EDIT)}</>), 17);
  });

  it('the form\'s DOM contract is every id and class userSave() reads back', () => {
    // A field that loses its id saves as BLANK. On this form that is a wiped role or a wiped company
    // list, and no error anywhere. Names extracted from app.html at run time, not retyped.
    const ids = [...SAVE.matchAll(/getElementById\('([a-z_]+)'\)/g)].map((m) => m[1]);
    const classes = [...SAVE.matchAll(/querySelector(?:All)?\('\.([a-z-]+)/g)].map((m) => m[1]);
    expect([...new Set(ids)].sort()).toEqual(['uf_active', 'uf_email', 'uf_err', 'uf_name', 'uf_pass', 'uf_role', 'uf_save']);
    expect([...new Set(classes)].sort()).toEqual(['uf-comp', 'uf-comp-role']);
    const both = renderToStaticMarkup(<>{modal(null)}{modal(EDIT)}</>);
    for (const id of ids) expect(both).toContain(`id="${id}"`);
    for (const c of classes) expect(both).toContain(`class="${c}"`);
    // `data-tid` is how userSave() pairs a checkbox with its per-company role select.
    expect(SAVE).toContain("cb.getAttribute('data-tid')");
    expect(SAVE).toContain(".uf-comp-role[data-tid=");
    expect((both.match(/data-tid="/g) || []).length).toBe(COMPANIES.length * 2 * 2);
    // And the route reads exactly the INPUT ids back out of the DOM, so the two halves cannot drift.
    // `uf_err` and `uf_save` are the two the legacy WRITES rather than reads — they are the error line
    // and the Save button — and the React port drives both by prop instead, which is why they are not
    // expected here. Every field whose VALUE is posted is.
    for (const id of ['uf_name', 'uf_role', 'uf_email', 'uf_pass', 'uf_active']) expect(ROUTE).toContain(id);
    for (const c of new Set(classes)) expect(ROUTE).toContain(c);
    expect(ROUTE).toContain('error={ufErr}');
    expect(ROUTE).toContain('saving={ufSaving}');
  });

  it('an EDIT can never change the email and never sets a password', () => {
    // app.html:4799 disables the email input on an edit; `userSave()`'s edit branch reads neither. A
    // port that sent them would let this form take over an existing login, bypassing the separately
    // audited `user_reset_password`.
    const html = renderToStaticMarkup(modal(EDIT));
    expect(html).toMatch(/id="uf_email"[^>]*disabled/);
    expect(html).not.toContain('id="uf_pass"');
    const body = userSaveBody({ editId: 'u2', name: 'A', role: 'finance', tenants: [], active: true, email: 'x@y.test', pass: 'Abcd1234' });
    expect(body).toEqual({ api: 'user_update', user_id: 'u2', name: 'A', role: 'finance', tenants: [], active: true });
    expect(Object.keys(body)).not.toContain('email');
    expect(Object.keys(body)).not.toContain('pass');
    // Read out of app.html rather than retyped, both branches.
    expect(SAVE).toContain("var body={api:'user_update',user_id:UF_EDIT_ID,name:name,role:role,tenants:tenants};");
    expect(SAVE).toContain("body.active=actEl.checked");
  });

  it('a CREATE carries email, password and no user_id, and enforces pwValid', () => {
    expect(SAVE).toContain("r=await call({api:'user_create',email:email,name:name||email,pass:pass,role:role,tenants:tenants});");
    const body = userSaveBody({ editId: null, name: '', role: 'viewer', tenants: [], email: ' new@ctg.test ', pass: 'Abcd1234' });
    expect(body).toEqual({ api: 'user_create', email: 'new@ctg.test', name: 'new@ctg.test', pass: 'Abcd1234', role: 'viewer', tenants: [] });
    expect(Object.keys(body)).not.toContain('user_id');
    // The password rules, app.html:2525. Eight characters AND a letter AND a digit; each dropped rule
    // is a weaker password on an account that can reach a live accounting system.
    expect(SAVE).toContain('if(!pwValid(pass))');
    expect(APP).toContain("function pwValid(p){ return (p||'').length>=8 && /[A-Za-z]/.test(p) && /[0-9]/.test(p); }");
    expect(pwValid('Abcd1234')).toBe(true);
    expect(pwValid('Abcd123')).toBe(false);      // 7 chars
    expect(pwValid('abcdefgh')).toBe(false);     // no digit
    expect(pwValid('12345678')).toBe(false);     // no letter
    expect(pwValid('')).toBe(false);
    expect(() => userSaveBody({ editId: null, name: '', role: 'viewer', tenants: [], email: 'a@b.test', pass: 'abcdefgh' })).toThrow(/letters and numbers/);
    expect(() => userSaveBody({ editId: null, name: '', role: 'viewer', tenants: [], email: '', pass: 'Abcd1234' })).toThrow(/required/);
  });

  it('sends only the TICKED companies, and an empty override as null', () => {
    // Two rules, both invisible in markup. Sending an unticked row grants the company it was meant to
    // remove — the server replaces the whole set. Sending `''` instead of `null` writes a per-company
    // role that matches no role, and `roleLabelFor()` prints an unmatched name raw.
    expect(SAVE).toContain("return ov ? { tenant_id:tid, role:ov } : { tenant_id:tid, role:null };");
    expect(SAVE).toContain("document.querySelectorAll('.uf-comp:checked')");
    expect(ufTenants([
      { tenant_id: 'a', checked: true, role: '' },
      { tenant_id: 'b', checked: false, role: 'admin' },
      { tenant_id: 'c', checked: true, role: 'viewer' },
    ])).toEqual([{ tenant_id: 'a', role: null }, { tenant_id: 'c', role: 'viewer' }]);
    expect(ufTenants([]).length).toBe(0);
  });

  it('ticks the companies the user already has, and only those', () => {
    const html = renderToStaticMarkup(modal(EDIT));
    const boxes = [...html.matchAll(/<input type="checkbox" class="uf-comp" data-tid="([^"]*)"[^>]*>/g)];
    expect(boxes.map((m) => m[1])).toEqual(COMPANIES.map((c) => c.tenant_id));
    expect(boxes.filter((m) => m[0].includes('checked')).map((m) => m[1])).toEqual([COMPANIES[0].tenant_id]);
    // An unticked row's role select is disabled — app.html:4791 — so it cannot carry an override.
    const sels = [...html.matchAll(/<select class="uf-comp-role" data-tid="([^"]*)"[^>]*?>/g)];
    expect(sels.map((m) => m[1])).toEqual(COMPANIES.map((c) => c.tenant_id));
    expect(sels.filter((m) => m[0].includes('disabled')).map((m) => m[1])).toEqual([COMPANIES[1].tenant_id]);
    // A brand-new user has nothing ticked and nothing enabled.
    const fresh = renderToStaticMarkup(modal(null));
    expect(fresh).not.toContain('checked');
    expect((fresh.match(/class="uf-comp-role"[^>]*disabled/g) || []).length).toBe(COMPANIES.length);
  });

  it('marks the stored per-company override, and falls back to "(inherit global)" when it no longer exists', () => {
    // The legacy marks it with a STRING replace (app.html:4791) which silently does nothing when the
    // stored override names a role `roles_list` no longer returns. `defaultValue` behaves the same way,
    // so the port neither fixes nor worsens it — driven rather than claimed.
    expect(SRC).toContain("perCoRoleOpts.replace('value=\"'+roleVal+'\"','value=\"'+roleVal+'\" selected')");
    const html = renderToStaticMarkup(modal(EDIT));
    const at = html.indexOf('class="uf-comp-role"');
    const sel = html.slice(at, html.indexOf('</select>', at));
    expect(sel).toContain('<option value="viewer" selected="">Viewer</option>');
    expect(sel).not.toMatch(/value=""[^>]*selected/);
    const gone = renderToStaticMarkup(<UserModal user={{ ...EDIT, tenants: [{ tenant_id: COMPANIES[0].tenant_id, role: 'deleted_role' }] }}
                                                 companies={COMPANIES} roles={ROLES} onClose={noop} onSave={noop} onCompToggle={noop} />);
    expect(gone).not.toContain('deleted_role');
    const gat = gone.indexOf('class="uf-comp-role"');
    expect(gone.slice(gat, gone.indexOf('</select>', gat))).not.toContain('selected');
  });

  it('opens on the user\'s OWN role, and on `viewer` for a new user', () => {
    // app.html:4806's `document.getElementById('uf_role').value=u.role||'viewer'` is the last statement
    // of userForm() and is INVISIBLE to an innerHTML-recording harness — the finance.qinv trap. There is
    // no golden here to be captured a moment too early, so the port renders the state an operator sees
    // and the legacy statement is pinned instead.
    expect(SRC).toContain("document.getElementById('uf_role').value=u.role||'viewer';");
    expect(DEFAULT_ROLE).toBe('viewer');
    const edit = renderToStaticMarkup(modal(EDIT));
    expect(edit.slice(edit.indexOf('id="uf_role"'), edit.indexOf('</select>'))).toMatch(/value="finance" selected/);
    const fresh = renderToStaticMarkup(modal(null));
    expect(fresh.slice(fresh.indexOf('id="uf_role"'), fresh.indexOf('</select>'))).toMatch(/value="viewer" selected/);
    // Least privilege: a new user must not default to the first role in the list, which is `admin`.
    expect(ROLES[0].name).toBe('admin');
  });

  it('labels each role option with how many TABS it opens and whether it manages users', () => {
    expect(SRC).toContain("var n=(r.features||[]).length; var d=r.manage_users?', manages users':'';");
    expect(roleOptionLabel(ROLES[0])).toBe('Administrator (10 features, manages users)');
    expect(roleOptionLabel({ name: 'x', label: 'X', features: ['a'], manage_users: false })).toBe('X (1 feature)');
    expect(roleOptionLabel({ name: 'y', features: [], manage_users: false })).toBe('y (0 features)');
    expect(renderToStaticMarkup(modal(null))).toContain('Administrator (10 features, manages users)');
  });

  it('shows "Active (can log in)" only on an edit, and reflects the account\'s real state', () => {
    expect(renderToStaticMarkup(modal(null))).not.toContain('uf_active');
    expect(renderToStaticMarkup(modal(EDIT))).toMatch(/id="uf_active"[^>]*checked/);
    expect(renderToStaticMarkup(modal({ ...EDIT, active: false }))).not.toMatch(/id="uf_active"[^>]*checked/);
  });

  it('ufToggleRow is ported, guarded against the shared stub, and left where the DOM is', () => {
    // hr-expenses' finding: `reactHandlers()` invokes every handler with a bare `{target:{value}}`, so a
    // handler that touched `e.currentTarget` unguarded would throw inside every other case in this file.
    const legacyFn = legacy('function ufToggleRow(cb){', 'function ufClose(){');
    expect(legacyFn).toContain('sel.disabled = !cb.checked;');
    expect(legacyFn).toContain("if(!cb.checked) sel.value='';");
    const fn = ROUTE.slice(ROUTE.indexOf('const onCompToggle'), ROUTE.indexOf('/** `userSave()`'));
    expect(fn).toContain('sel.disabled = !cb.checked;');
    expect(fn).toContain("if (!cb.checked) sel.value = '';");
    expect(fn).toContain('if (!cb || !cb.closest) return;');
    expect(() => reactHandlers(modal(EDIT)).forEach((h) => h.invoke())).not.toThrow();
  });

  it('WITHHELD DIRECTION: the form carries no other account\'s data and no password of any kind', () => {
    const html = renderToStaticMarkup(modal(EDIT));
    expect(html).not.toContain('boss@ctg.test');
    expect(html).not.toContain('audit@ctg.test');
    expect(html).not.toMatch(/type="password"[^>]*value=/);
    // Guard the guard: the fixture really does hold the other two accounts, so the absence means something.
    expect(JSON.stringify(FIXTURES.users_list)).toContain('boss@ctg.test');
  });
});

// ═══ 6 · THE SUB-VIEW SWITCH ═══════════════════════════════════════════════════════════════════════

describe('usersView() — one gate, five sub-views, and no handoff left in the middle of the screen', () => {
  it('the route loads the sub-view the legacy loads, for all five', () => {
    // app.html:4683-4687 — note `audit` is the FALL-THROUGH `else`, not a named branch, so a port that
    // matched on the name and defaulted to `users` would open the wrong screen for an unknown view.
    const fn = legacy('function usersView(v){', 'async function sessionsLoad(){');
    expect(fn).toContain("if(v==='users') usersLoad();");
    expect(fn).toContain("else if(v==='roles') rolesLoad();");
    expect(fn).toContain("else if(v==='sessions') sessionsLoad();");
    expect(fn).toContain("else if(v==='xero') xeroSyncLoad();");
    expect(fn).toContain('else auditLoad();');
    const mine = ROUTE.slice(ROUTE.indexOf('const loadFor'), ROUTE.indexOf('useEffect(()'));
    expect(mine).toContain("if (v === 'users') loadUsers();");
    expect(mine).toContain("else if (v === 'roles') loadRoles();");
    expect(mine).toContain("else if (v === 'sessions') loadSessions();");
    expect(mine).toContain("else if (v === 'xero')");
    expect(mine).toContain('loadXero()');
    expect(mine).toContain('loadSyncHealth()');
    expect(mine).toContain('loadArAging()');
    expect(mine).toContain('else loadAudit();');
  });

  it('no sub-view button navigates away any more', () => {
    // The seam this migration closes: four of the five used to send the operator back to app.html
    // mid-screen. `onView` now sets state and loads.
    expect(ROUTE).toContain('const onView = useCallback((v: UsersView) => { setView(v); loadFor(v); }, [loadFor]);');
    expect(ROUTE).not.toContain('window.location.href = legacyUsers');
  });

  it('every sub-view sits behind the SAME single gate, and nothing loads before it', () => {
    // The whole screen — five sub-views, both modals — is inside one `usersReachable(perms)` branch, and
    // the only load that runs before `my_perms` resolves is none. A sub-view that fetched on mount would
    // hand the audit log and the session list to a login the gate is about to refuse.
    const gated = ROUTE.slice(ROUTE.indexOf('{signedIn === false'));
    expect(gated).toContain('!usersReachable(perms)');
    expect(ROUTE).toContain('.then((p) => { setPerms(p); if (usersReachable(p)) loadFor(\'users\'); })');
    // There is exactly ONE mount effect, and every load inside it is on the FAR side of the gate.
    //
    // The first cut of this checked only that the effect existed and mentioned `my_perms` — and inserting
    // `loadAudit();` in front of that call passed, which is the whole defect: the audit log and the
    // session list would be fetched for a login `usersReachable()` is about to refuse. So the effect is
    // split at the gate and the part BEFORE it is required to contain no load at all.
    const mountEffects = [...ROUTE.matchAll(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g)].map((m) => m[0]);
    expect(mountEffects.length).toBe(1);
    const effect = mountEffects[0];
    expect(effect).toContain("call<Perms>({ api: 'my_perms' })");
    const [beforeGate, afterGate] = effect.split('if (usersReachable(p))');
    expect(afterGate).toBeDefined();
    expect(beforeGate).not.toMatch(/\bload[A-Za-z]*\(/);
    // …and `my_perms` is the only thing it asks the server for before the gate.
    expect([...beforeGate.matchAll(/api: '([a-z_]+)'/g)].map((m) => m[1])).toEqual(['my_perms']);
  });
});

// ── the recorder the handler-binding cases share ──────────────────────────────────────────────────

/**
 * Render `tree` with recording props and return every handler call in DOCUMENT order.
 *
 * The golden screens compare a recorded call list against handlers read out of a golden. There is no
 * golden here, so the expectation is written out explicitly per case — which is why every such case
 * below also states what a wrong binding would DO, and drives the wrong binding as its own assertion.
 */
function record(build: (rec: (attr: string) => (...a: unknown[]) => void) => React.ReactNode) {
  const calls: { attr: string; args: unknown[] }[] = [];
  const rec = (attr: string) => (...args: unknown[]) =>
    calls.push({ attr, args: args.filter((a) => a !== STUB_VALUE && (typeof a === 'string' || typeof a === 'number')) });
  reactHandlers(build(rec)).forEach((h) => h.invoke());
  return calls;
}
