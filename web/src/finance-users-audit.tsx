// Finance OS · Users → 📜 Audit log — the third sub-view, and the RECORD of who changed everything the
// other four decide. The legacy original is `auditLoad()` (app.html:4910); it is still there.
//
// PURE FUNCTION OF ITS PROPS. One fetch, `{api:'audit_list',limit:150}`, lives in the route.
//
// ── READ ONLY, AND THAT IS THE POINT ──────────────────────────────────────────────────────────────
// The whole sub-view has ONE control — ↻ Refresh — and no write of any kind: no edit, no delete, no
// filter that posts, no form. An audit log a screen can rewrite is not an audit log, and this is the
// screen whose own actions it records (`user_create`, `user_update`, `password_reset`, `role_save`,
// `role_delete` are five of the seven actions `actMeta` names). The test asserts the WITHHELD direction
// — that the rendered markup carries no second handler, no input, no select and no form — rather than
// only asserting that what is there looks right.
//
// ── THE TIMESTAMP READS THE MACHINE'S ZONE, AND THAT IS MIRRORED, NOT FIXED ───────────────────────
// app.html:4917 is `new Date(e.created_at).toLocaleString()` with NO options and NO timeZone — unlike
// `finance.ap`, which passes `timeZone:'Asia/Kuala_Lumpur'` to all three of its date calls. So the day
// and hour an audit entry prints follow the operator's browser, and two people reading the same log in
// KL and London disagree about when a password was reset. Mirrored as-is (changing it is a behaviour
// change, not a migration detail) and pinned BY SOURCE on both sides in the screen's test — CLAUDE.md's
// `finance.calendar` finding: this fleet sits at UTC+8, so no output assertion here can see the
// difference between adding a zone and not adding one.

/** One row of `{api:'audit_list'}`.events — app.html:4914. */
export interface AuditEvent {
  action?: string | null;
  created_at?: string | null;
  user_email?: string | null;
  ref?: string | null;
  detail?: Record<string, unknown> | null;
}

/**
 * `actMeta` — app.html:4916, character for character: [pill class, label].
 *
 * An action the map does not name falls back to `['pill-draft', e.action]` — the RAW action string, so a
 * new server-side action still prints something identifiable rather than a blank cell.
 */
export const ACT_META: Record<string, [string, string]> = {
  user_create: ['pill-green', 'Created user'],
  user_update: ['pill-blue', 'Updated user'],
  password_reset: ['pill-coral', 'Reset password'],
  role_save: ['pill-blue', 'Saved role'],
  role_delete: ['pill-coral', 'Deleted role'],
  o2o_issue: ['pill-draft', 'Issued O2O invoices'],
  quick_invoice: ['pill-draft', 'Quick invoice'],
};

export function actMetaFor(action: string | null | undefined): [string, string] {
  return ACT_META[action || ''] || ['pill-draft', (action || '') as string];
}

/**
 * `when` — app.html:4917. `toLocaleString()` with no arguments, exactly as the legacy writes it.
 *
 * DO NOT add a locale or a timeZone here without changing app.html in the same commit: the two would
 * then disagree about the same event, and on this fleet (and on CI) both sit at UTC+8 so nothing would
 * fail. See the header. `''` for a missing timestamp is the legacy's own answer.
 */
export function auditWhen(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '';
}

/**
 * `det` — app.html:4918. `k: v` pairs joined by ` · `, with an ARRAY collapsed to its length.
 *
 * The collapse is not cosmetic: `tenants` on a `user_update` is the list of companies just granted, and
 * the legacy prints "2 item(s)" rather than naming them. Mirrored — widening it to list the tenants
 * would put company grants into a log that today only counts them.
 *
 * LEGACY FINDING, mirrored not fixed: the KEY is interpolated with no `esc()` while the VALUE beside it
 * is escaped, and the whole string is then spliced into `audit_out`'s HTML raw. React escapes both. Same
 * shape as the `nm`/`ov` asymmetry the Users table carries; pinned in the test.
 */
export function auditDetail(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) return '';
  return Object.keys(detail)
    .map((k) => k + ': ' + (Array.isArray(detail[k]) ? (detail[k] as unknown[]).length + ' item(s)' : String(detail[k])))
    .join(' · ');
}

export interface AuditPanelProps {
  /** `auditLoad()` — the ↻ Refresh button, and the ONLY control on this sub-view. */
  onRefresh: () => void;
  /** `#audit_out`'s content. Absent is the spinner `auditLoad()` paints before its call lands. */
  children?: React.ReactNode;
}

/** `auditLoad()`'s first write — app.html:4911. Every byte of `#uv_body`. */
export function AuditPanel(props: AuditPanelProps) {
  return (
    <div className="panel">
      <div className="panel-hd">
        <h3>Audit log · recent admin &amp; permission changes</h3>
        <button className="btn sm" onClick={props.onRefresh}>↻ Refresh</button>
      </div>
      <div id="audit_out">
        {props.children ?? <div className="load"><span className="spin"></span>Loading…</div>}
      </div>
    </div>
  );
}

/** `auditLoad()`'s empty state — app.html:4915. A separate document from the table, not a table with no rows. */
export function AuditEmpty() {
  return (
    <div className="empty">
      <div className="empty-ico">📜</div>
      <div>No audit events yet</div>
    </div>
  );
}

export interface AuditTableProps { events: AuditEvent[] }

/** `auditLoad()`'s second write — app.html:4922. Every byte of `#audit_out` when there are events. */
export default function AuditTable(props: AuditTableProps) {
  return (
    <div className="tbl-wrap">
      <table className="bigtable">
        <thead>
          <tr><th>When</th><th>Action</th><th>By</th><th>Detail</th></tr>
        </thead>
        <tbody>
          {props.events.map((e, i) => {
            const m = actMetaFor(e.action);
            const det = auditDetail(e.detail);
            return (
              <tr key={i}>
                <td className="muted" style={{ fontSize: '11.5px', whiteSpace: 'nowrap' }}>{auditWhen(e.created_at)}</td>
                <td><span className={'pill ' + m[0]} style={{ fontSize: '9.5px' }}>{m[1]}</span></td>
                <td className="muted" style={{ fontSize: '11.5px' }}>{e.user_email || '—'}</td>
                <td className="muted" style={{ fontSize: '11px' }}>
                  {e.ref || ''}
                  {det ? ' ' : ''}
                  {det ? <span style={{ opacity: '.7' }}>{'(' + det + ')'}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
