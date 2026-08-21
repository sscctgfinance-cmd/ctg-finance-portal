// Finance OS · Users → 🖥 Active sessions — the second of the five sub-views `usersView()` dispatches
// over (app.html:4680), and the first of the four this migration closes.
//
// The legacy original is `sessionsLoad()` (app.html:4689) and `sessionRevoke()` (:4717). Both are STILL
// THERE and still shipping; nothing was deleted.
//
// PURE FUNCTION OF ITS PROPS — no fetch, no window, NO CLOCK READ. `sessionsLoad()` calls `Date.now()`
// twice per row (`fresh`, and `relSec()` for both timestamps); hr.yearend's rule says a component that
// read the clock itself renders one thing now and another in five minutes, so the instant is handed in.
//
// ── NO GOLDEN, SO THE TEST CARRIES THE WHOLE WEIGHT ───────────────────────────────────────────────
// `tests/golden/finance.users.html` holds the `users` sub-view only — `renderUsers()` opens on
// `USERS_VIEW||'users'`, so the harness never reached this renderer. There is nothing to diff against,
// which is why `web/tests/finance-users-subviews.test.tsx` pins this markup against the STRING LITERALS
// of `sessionsLoad()` itself, read out of app.html at run time. That is weaker than a golden in one way
// (it cannot see a fragment rendered in the wrong ORDER) and stronger in another (it fails on a branch
// the golden never captured), so the test also asserts the assembled document per state.
//
// ── THE REVOKE BUTTON CARRIES NO IDENTIFYING ARGUMENT ─────────────────────────────────────────────
// `onclick="sessionRevoke(this.dataset.sid,this.dataset.who)"` — the legacy passes the session through
// DATA ATTRIBUTES rather than interpolating the sid into the handler, so `goldenHandlers()`-style
// extraction returns `[]` for every row and could never tell one row's Revoke from another's. The React
// port keeps both attributes (they are markup, and the legacy-literal pin above requires them) and hands
// the SESSION to the handler, and the test asserts row i's rendered `data-sid` is the sid row i's
// handler dispatches. Revoking the wrong row signs the wrong person out of the accounting system.

/** One row of `{api:'sessions_list'}`.sessions — app.html:4693. */
export interface Session {
  sid?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  user_role?: string | null;
  token_short?: string | null;
  created_at?: string | null;
  last_seen_at?: string | null;
  is_self?: boolean | null;
}

/**
 * `relSec()` — app.html:4697, as a pure function of the instant it is handed.
 *
 * Note it is a DIFFERENT ladder from `relTime()` on the Users sub-view: `s`/`m`/`h`/`d` with no space
 * and no 30-day cutoff, so it never reaches a locale date and never touches a timezone.
 */
export function relSec(iso: string | null | undefined, now: number): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const s = Math.floor((now - d.getTime()) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/**
 * "active in the last 5 minutes" — app.html:4699, and it is a THRESHOLD.
 *
 * CLAUDE.md's `finance.cfo` finding: a fixture that sits well clear of a boundary proves the branch
 * exists, not where the boundary is. Widening this to an hour would paint a green dot beside a session
 * that has been idle for 50 minutes, and every output assertion built from a 30-second-old fixture
 * would still pass. The test drives it AT 5 minutes, both sides.
 */
export const FRESH_MS = 5 * 60 * 1000;
export function isFresh(s: Session, now: number): boolean {
  return !!(s.last_seen_at && now - new Date(s.last_seen_at).getTime() < FRESH_MS);
}

/** `rolePill` — app.html:4702. The same three classes the Users table uses. */
export function sessionRolePillClass(role: string | null | undefined): string {
  return role === 'admin' ? 'pill-coral' : role === 'approver' ? 'pill-blue' : 'pill-draft';
}

/**
 * `whoSafe` — app.html:4704. The legacy strips `'` and `\` because the name is about to be written into
 * an HTML attribute that a JS handler then reads back; mirrored so the confirm() wording matches.
 */
export function whoSafe(s: Session): string {
  return String(s.user_name || s.user_email || '').replace(/['\\]/g, '');
}

/**
 * The body `sessionRevoke()` POSTs — app.html:4719, `call({api:'session_revoke', sid:sid})`.
 *
 * Split out of the route for the same reason `resetBody()` was: no golden sees a request body, and this
 * one signs somebody out. It throws on a blank sid rather than posting one — `reconcileBody('')`'s rule.
 * A revoke that reached the server with no sid is a request whose target the server would have to guess.
 */
export function revokeBody(sid: string): Record<string, unknown> {
  if (!sid) throw new Error('revokeBody: refusing to revoke with no session id');
  return { api: 'session_revoke', sid };
}

/** `confirm()`'s wording — app.html:4718. Ported, not dropped: it is the only thing before a sign-out. */
export function revokeConfirm(who: string): string {
  return 'Revoke session for ' + who + '? They will be signed out immediately.';
}

export interface SessionsPanelProps {
  /** `sessionsLoad()` — the ↻ Refresh button re-runs the whole load. */
  onRefresh: () => void;
  /** `#sess_out`'s content. Absent is the spinner `sessionsLoad()` paints before its call lands. */
  children?: React.ReactNode;
}

/** `sessionsLoad()`'s first write — app.html:4690. Every byte of `#uv_body`. */
export function SessionsPanel(props: SessionsPanelProps) {
  return (
    <div className="panel">
      <div className="panel-hd">
        <h3>Active sessions · who is currently logged in</h3>
        <button className="btn sm" onClick={props.onRefresh}>↻ Refresh</button>
      </div>
      <div id="sess_out">
        {props.children ?? <div className="load"><span className="spin"></span>Loading…</div>}
      </div>
    </div>
  );
}

export interface SessionsTableProps {
  sessions: Session[];
  /** The instant `relSec()` and `isFresh()` measure against — `Date.now()` in the route. */
  now: number;
  /** `sessionRevoke(this.dataset.sid, this.dataset.who)` — app.html:4707. */
  onRevoke: (s: Session) => void;
}

/** `sessionsLoad()`'s second write — app.html:4715. Every byte of `#sess_out` on success. */
export default function SessionsTable(props: SessionsTableProps) {
  return (
    <>
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead>
            <tr>
              <th>User</th><th>Role</th><th>Token</th><th>Started</th><th>Last seen</th><th></th>
            </tr>
          </thead>
          <tbody>
            {props.sessions.length === 0
              ? <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '18px' }}>No active sessions</td></tr>
              : props.sessions.map((s, i) => (
                <tr key={s.sid || i}>
                  <td>
                    {isFresh(s, props.now)
                      ? <span className="dot-green" style={{ display: 'inline-block', marginRight: '6px' }}></span>
                      : <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#445', marginRight: '6px', verticalAlign: '1px' }}></span>}
                    <b>{s.user_name || s.user_email || ''}</b>
                    {s.is_self ? ' ' : ''}
                    {s.is_self ? <span className="pill pill-coral" style={{ fontSize: '9px' }}>this device</span> : null}
                    <br />
                    <span className="muted" style={{ fontSize: '11px' }}>{s.user_email || ''}</span>
                  </td>
                  <td><span className={'pill ' + sessionRolePillClass(s.user_role)}>{s.user_role || ''}</span></td>
                  <td className="muted" style={{ fontSize: '11.5px', fontFamily: 'monospace' }}>{s.token_short || ''}</td>
                  <td className="muted" style={{ fontSize: '11.5px' }}>{relSec(s.created_at, props.now)}</td>
                  <td className="muted" style={{ fontSize: '11.5px' }}>{relSec(s.last_seen_at, props.now)}</td>
                  <td>
                    {s.is_self
                      ? <span className="muted" style={{ fontSize: '11px' }}>—</span>
                      : <button className="btn sm" data-sid={s.sid || ''} data-who={whoSafe(s)}
                                onClick={() => props.onRevoke(s)}>Revoke</button>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: '11.5px', marginTop: '12px', lineHeight: '1.7' }}>
        Green dot = active in the last 5 minutes. Revoking a session logs that user out immediately. Sessions auto-expire after 30 days, or 14 days of inactivity.
      </div>
    </>
  );
}
