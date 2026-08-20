// Finance OS · CTG Access — the tenth screen out of app.html.
//
// The legacy original is `renderCtgAccess()` (app.html:4981) with `ctgaLoad()`, `ctgaRender()`,
// `ctgaRoleOpts()`, `ctgaGrant()` and `ctgaRevoke()` below it. All of them are STILL THERE and still
// shipping; nothing was deleted. Both are reachable side by side (`app.html#tab=ctgaccess` and
// `/finance/ctgaccess/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. The
// `{api:'ctg_access_list'}` load, the grant/revoke posts, the two confirmations and the busy flag live
// in app/finance/ctgaccess/page.tsx, on the other side of that line.
//
// ── THE GOLDEN IS TWO SECTIONS, AND ONE OF THEM IS AN INTERMEDIATE STATE ───────────────────────────
// `renderCtgAccess()` is `async` and writes `#ctgaccess` ONCE — the panel, with a LOADING skeleton
// inside `#ctga_body` — and then calls `ctgaLoad()`, which awaits the fetch and overwrites `#ctga_body`.
// The harness records innerHTML writes BY ELEMENT ID, and those are two different ids, so both survive:
// `tests/golden/finance.ctgaccess.html` carries `<!-- #ctgaccess -->` holding the panel with the
// SPINNER still in it, and `<!-- #ctga_body -->` holding the loaded directory.
//
// So the `#ctgaccess` section is exactly CLAUDE.md's INTERMEDIATE-state trap: it is the frame at t=0,
// not the screen an operator sees. The screen an operator sees is the `#ctgaccess` panel with the
// `#ctga_body` section's content substituted in. This file therefore renders BOTH halves — `Screen`
// (the panel) composing `Body` (whatever is currently inside `#ctga_body`) — so each golden section is
// diffed against the state it was actually captured in, and neither is mistaken for the other. The
// screen's own test asserts that this is really what the legacy does, read out of app.html.
//
// ── THIS SCREEN GRANTS AND REVOKES PORTAL ACCESS ───────────────────────────────────────────────────
// Every row is a person and a control that gives or removes their entry to this portal, and the rows
// look alike — four cells of text and a select. R1 strips `on*=` from the string diff, so a select bound
// to the wrong `sub` would be invisible above and is caught only by handler parity. A grant bound to the
// wrong person hands someone else's account the admin role; a revoke bound to the wrong person ends a
// colleague's session immediately (`ctgaRevoke()`'s own wording). Those are the cases the test file
// spends most of its length on.
//
// ── ARITHMETIC ─────────────────────────────────────────────────────────────────────────────────────
// The only computation here is the "No access" chip: `(c.ctg_total||0)-(c.linked||0)` — a figure the
// server does NOT send and the client derives. That is `finance.qinv`'s case, not `finance.o2o`'s: it
// is a display echo of two authoritative counts, not a formula anything is posted against. Lifting one
// subtraction into a shared `.js` would be a larger change than the migration. Mirrored inline and
// pinned by assertion instead.

import * as React from 'react';

/** One row of `{api:'ctg_access_list'}`.rows — a CTG Portal staff member, joined to this portal. */
export interface CtgRow {
  sub: string;
  name?: string | null;
  email: string;
  employee_code?: string | number | null;
  ctg_active: boolean;
  linked: boolean;
  portal_active?: boolean | null;
  role?: string | null;
}

/** A portal account with no CTG counterpart — `.orphans`. */
export interface Orphan { name?: string | null; email: string; role: string }

/** `.counts` — both figures come from the server. */
export interface Counts { ctg_total?: number; linked?: number }

export type Filter = 'all' | 'linked' | 'unlinked' | 'inactive';

/** `{api:'my_perms'}`, as far as this screen reads it. */
export interface Perms { manage_users?: boolean | null }

/**
 * THE PERMISSION GATE — app.html:1423, and it is NOT a feature flag.
 *
 *   if(t==='users')     el.classList.toggle('hide', !canManage);
 *   if(t==='ctgaccess') el.classList.toggle('hide', !canManage);
 *   else if(t==='info') …
 *
 * The second `if` is where the `if/else if` chain RESTARTS, so `ctgaccess` takes its own branch and
 * never reaches the chain's final `else el.classList.toggle('hide', feats.indexOf(t)<0)`. It is
 * `manage_users` and only `manage_users` — the opposite of `approvals`, `collections`, `recon`, `qinv`
 * and `o2o`, whose gate IS that final `else`. (`users`, one line above, is the quirk CLAUDE.md flags:
 * it is set by `!canManage` and then falls through to the final `else`, which overwrites it. Copying
 * that neighbour's behaviour here would be wrong in both directions.)
 *
 * `ctgaRender()` itself has no role check in it at all, so a port that mirrored only the renderer would
 * serve the whole CTG staff directory — names, work emails, staff codes and portal roles — plus live
 * buttons granting and revoking access, to anyone who typed the URL. The server is stricter (the
 * `ctg_access_*` group does its own auth), so this is tab visibility rather than the boundary, but it
 * is the boundary the operator can see.
 */
export function ctgAccessReachable(perms: Perms | null | undefined): boolean {
  return !!(perms && perms.manage_users);
}

/** `ctgaRoleOpts()` — app.html:5070. The four roles this screen can assign, in order. */
export const CTGA_ROLES = ['viewer', 'employee', 'hr_admin', 'admin'] as const;

/**
 * `ctgaRender()`'s filter — app.html:5005, mirrored predicate for predicate.
 *
 * Note what it does NOT do: it never sorts, groups or de-duplicates. The row an operator presses is
 * `rows[i]` of the server's own list, and every control on it carries that row's `sub`.
 */
export function visibleRows(rows: CtgRow[], filter: Filter, q: string): CtgRow[] {
  const needle = (q || '').toLowerCase();
  return rows.filter((x) => {
    if (filter === 'linked' && !x.linked) return false;
    if (filter === 'unlinked' && x.linked) return false;
    if (filter === 'inactive' && x.ctg_active) return false;
    if (!needle) return true;
    return (x.name || '').toLowerCase().indexOf(needle) >= 0
      || (x.email || '').toLowerCase().indexOf(needle) >= 0
      || String(x.employee_code ?? '').toLowerCase().indexOf(needle) >= 0;
  });
}

/** The four chips and their labels — app.html:5015. `unlinked` is the only derived figure on the screen. */
export function chips(counts: Counts): [Filter, string][] {
  const total = counts.ctg_total || 0;
  const linked = counts.linked || 0;
  return [
    ['all', 'All ' + total],
    ['linked', 'Has access ' + linked],
    ['unlinked', 'No access ' + (total - linked)],
    ['inactive', 'Inactive at CTG'],
  ];
}

/** `{api:'ctg_access_grant'}` — app.html:5089. No golden sees a request body. */
export function grantBody(sub: string, role: string): Record<string, string> {
  if (!sub) throw new Error('ctg_access_grant needs the subject it is granting to');
  return { api: 'ctg_access_grant', sub, role };
}

/** `{api:'ctg_access_revoke'}` — app.html:5100. Carries the subject and nothing else. */
export function revokeBody(sub: string): Record<string, string> {
  if (!sub) throw new Error('ctg_access_revoke needs the subject it is revoking');
  return { api: 'ctg_access_revoke', sub };
}

/**
 * `ctgaGrant()`'s default role — app.html:5085: with no role argument it reads the row's own
 * `#ctga_role_<sub>` select, falling back to 'viewer' if the element is gone. The select is left
 * UNCONTROLLED and keeps that id for exactly this reason, so the route reads it the same way.
 */
export function pickedRole(sub: string, doc: { getElementById(id: string): { value: string } | null }): string {
  const sel = doc.getElementById('ctga_role_' + sub);
  return sel ? sel.value : 'viewer';
}

/**
 * The legacy inline styles, split mechanically rather than retyped as objects.
 * See src/finance-wht.tsx:166 for why the STRING is the source: React appends `px` to a bare number and
 * re-serialises `.15` as `0.15`, and no relaxation touches an attribute value.
 */
function st(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of css.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const key = name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[key] = part.slice(at + 1).trim();
  }
  return out;
}

export interface BodyProps {
  rows: CtgRow[] | null;
  orphans: Orphan[];
  counts: Counts;
  q: string;
  filter: Filter;
  busy: boolean;
  /** Set when `{api:'ctg_access_list'}` came back not-ok — app.html:4996. */
  error?: string | null;
  onFilter: (f: Filter) => void;
  onSearch: (v: string) => void;
  /** `ctgaGrant(sub)` from the button, `ctgaGrant(sub, role)` from the select. */
  onGrant: (sub: string, role?: string) => void;
  onRevoke: (sub: string, email: string) => void;
}

export type ScreenProps = BodyProps & { onRefresh: () => void };

/** `ctgaRoleOpts(sel)` — app.html:5070. */
function RoleOpts() {
  return <>{CTGA_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</>;
}

/**
 * Whatever is currently inside `#ctga_body`. FOUR documents live here and the golden holds one of them:
 *   • the loading skeleton (`rows === null`, no error) — app.html:4993, and also what
 *     `renderCtgAccess()` itself writes, which is why the `#ctgaccess` golden section holds it;
 *   • the load failure — app.html:4996;
 *   • "Nobody matches" — app.html:5026, reachable from every login by typing in the search box;
 *   • the directory — app.html:5028, which is the `#ctga_body` golden.
 * The three the golden does not hold are pinned by assertion in the screen's own test.
 */
export function Body(p: BodyProps): React.JSX.Element {
  if (p.error) {
    return (
      <div className="empty"><div className="empty-ic">🔒</div><h4>Could not load the CTG directory</h4>
        <p>{p.error}</p></div>
    );
  }
  if (p.rows === null) {
    return <div className="load"><span className="spin"></span>Loading the CTG directory…</div>;
  }
  const rows = visibleRows(p.rows, p.filter, p.q);
  return (
    <>
      <div style={st('display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px')}>
        {chips(p.counts).map(([k, label]) => (
          <button key={k} className={'btn sm' + (p.filter === k ? ' p' : '')} onClick={() => p.onFilter(k)}>{label}</button>
        ))}
        <input id="ctga_q" placeholder="Search name, email or staff code" defaultValue={p.q}
          onInput={(e) => p.onSearch((e.target as HTMLInputElement).value)}
          style={st('flex:1;min-width:220px;padding:7px 10px')} />
      </div>
      {rows.length === 0
        ? <div className="empty"><div className="empty-ic">🔍</div><h4>Nobody matches</h4><p>Try a different search or filter.</p></div>
        : (
          <div style={st('overflow-x:auto')}>
            <table className="tbl">
              <thead><tr>
                <th>Name</th><th>Email</th><th>Staff code</th><th>Portal access</th><th>Role</th>
                <th style={st('text-align:right')}>Action</th>
              </tr></thead>
              <tbody>
                {rows.map((x) => <Row key={x.sub} x={x} busy={p.busy} onGrant={p.onGrant} onRevoke={p.onRevoke} />)}
              </tbody>
            </table>
          </div>
        )}
      {p.orphans.length > 0 ? <Orphans orphans={p.orphans} /> : null}
    </>
  );
}

/** One directory row — app.html:5035. Every control on it carries THIS row's `sub`. */
function Row({ x, busy, onGrant, onRevoke }: {
  x: CtgRow; busy: boolean;
  onGrant: BodyProps['onGrant']; onRevoke: BodyProps['onRevoke'];
}) {
  const badge = !x.ctg_active
    ? <span className="pill" title="Deactivated in CTG Portal">CTG inactive</span>
    : x.linked
      ? (x.portal_active === false ? <span className="pill">suspended</span> : <span className="pill ok">has access</span>)
      : <span className="muted">—</span>;

  // Two DIFFERENT selects. The linked one posts on change and carries no id; the unlinked one carries
  // `ctga_role_<sub>` and is READ BACK by `ctgaGrant()` when the Grant button fires — so it stays
  // uncontrolled and keeps the id, the same contract the WHT payee form's `wp_*` ids carry.
  const roleSel = x.linked
    ? <select onChange={(e) => onGrant(x.sub, e.target.value)} disabled={busy} defaultValue={x.role ?? ''}><RoleOpts /></select>
    : <select id={'ctga_role_' + x.sub} defaultValue="viewer"><RoleOpts /></select>;

  const act = x.linked
    ? <button className="btn sm danger" onClick={() => onRevoke(x.sub, x.email)} disabled={busy}>Revoke</button>
    : x.ctg_active
      ? <button className="btn sm p" onClick={() => onGrant(x.sub)} disabled={busy}>Grant access</button>
      : <span className="muted" title="Reactivate them in CTG Portal first">n/a</span>;

  return (
    <tr>
      <td><b>{x.name || '-'}</b></td>
      <td>{x.email}</td>
      <td>{x.employee_code || '-'}</td>
      <td>{badge}</td>
      <td>{roleSel}</td>
      <td style={st('text-align:right')}>{act}</td>
    </tr>
  );
}

/**
 * Portal accounts with no CTG counterpart — app.html:5062. The legacy comment says why they must not be
 * invisible: they are exactly the people who would be locked out if SSO became the only way in.
 */
function Orphans({ orphans }: { orphans: Orphan[] }) {
  return (
    <div className="panel" style={st('margin-top:16px')}>
      <div className="panel-hd"><h3>{'Portal accounts not in the CTG directory (' + orphans.length + ')'}</h3></div>
      <p className="muted" style={st('font-size:12.5px;margin:0 0 10px')}>These sign in with a password only. If CTG SSO ever becomes the sole login, they lose access — give them a CTG account, or keep password sign-in enabled.</p>
      <div style={st('overflow-x:auto')}>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
          <tbody>
            {orphans.map((o, i) => (
              <tr key={o.email + i}><td>{o.name || '-'}</td><td>{o.email}</td><td>{o.role}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** `renderCtgAccess()` — app.html:4982. The panel, with whatever `#ctga_body` currently holds inside. */
export default function FinanceCtgAccess(p: ScreenProps): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-hd">
        <h3>CTG Access · who from CTG Portal may sign in here</h3>
        <button className="btn sm" onClick={() => p.onRefresh()}>↻ Refresh</button>
      </div>
      <div id="ctga_body"><Body {...p} /></div>
    </div>
  );
}
