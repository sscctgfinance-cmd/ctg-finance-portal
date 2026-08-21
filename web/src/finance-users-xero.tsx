// Finance OS · Users → 🔗 Xero sync — the fourth sub-view, and the only one whose buttons reach OUT of
// the portal into a live accounting system.
//
// The legacy originals are `xeroSyncLoad()` (app.html:4928), `xeroSyncNow()` (:4989), `xeroBackfill()`
// (:5032), `xeroDeltaNow()` (:5040) and `saveWebhookKey()` (:5245). All are still there.
//
// PURE FUNCTION OF ITS PROPS. The `webhook_events` fetch, the three sync POSTs and the busy state live
// in app/finance/users/page.tsx.
//
// ── SCOPE: THE WEBHOOK-ACTIVITY PANEL, AND NOT THE SIX TOOLS BELOW IT ─────────────────────────────
// `xeroSyncLoad()` writes SEVEN panels into `#uv_body` in one statement. This port covers the FIRST —
// the webhook activity panel, its three sync actions and `#xero_out` — which is what this migration was
// scoped to. The six below it are separate tools with their own handlers and their own failure modes:
//   🏢 Company names (`tenantsRefresh`)      🩺 Per-company sync health (`syncHealthLoad`, `xeroDriftCheck`)
//   🔬 Live AR audit (`syncAudit`)           🔧 Force resync one invoice (`invoiceResync`)
//   🧨 Emergency rebuild (`tenantRebuild`)   💰 AR aging snapshot (`arAgingLoad`, `arBucket`)
// They HAND OFF to `app.html#tab=users` — the honest strangler edge `whtDocHtml()` established — rather
// than being half-drawn here. Emergency rebuild in particular WIPES one company's cached invoice history
// before re-pulling from 2015; re-expressing it with no golden and no ask is not a migration detail.
// `XERO_HANDOFF_PANELS` below is that list as data, so the handoff cannot silently stop naming one.
//
// ── THE THREE SYNC ACTIONS ARE THE REASON THIS FILE HAS A BUSY PROP ──────────────────────────────
// Each button calls a different `{api:…}` against a live Xero connection, and each takes minutes:
//   ⤓ Full sync from Xero   → `xero_backfill`  · re-pulls EVERY invoice for EVERY company
//   ⚡ Delta sync            → `delta_now`      · re-pulls what changed
//   ⟳ Process queue         → `sync_now`       · drains the webhook queue
// The legacy disables ONLY the button that was clicked (app.html:4990, :5033, :5041), so a second,
// different sync can be started while the first is still running. That gap is mirrored in the MARKUP —
// `busy` names one button, exactly as the legacy does — and closed in the ROUTE, which refuses a second
// dispatch while any of the three is in flight. Same treatment `finance.approvals` gave its busy row:
// belt and braces over a real legacy gap, not a change to the screen.

/** One row of `{api:'webhook_events'}`.events — app.html:4977. */
export interface WebhookEvent {
  received_at?: string | null;
  event_type?: string | null;
  event_category?: string | null;
  tenant_name?: string | null;
  processed?: boolean | null;
  resource_id?: string | null;
}

/** `{api:'webhook_events',limit:80}`'s envelope — app.html:4967-4976. */
export interface WebhookResponse {
  configured?: boolean | null;
  contact_cache?: number | null;
  invoice_cache?: number | null;
  pending?: number | null;
  events?: WebhookEvent[] | null;
}

/** The three sync actions, in the order the legacy renders them. `busy` names one of these, or null. */
export type XeroAction = 'backfill' | 'delta' | 'queue';

/**
 * What each button POSTs and what it says while it runs — app.html:4989-5046, transcribed.
 *
 * `label` is the resting caption, `busyLabel` the one the legacy assigns to `btn.textContent`. Kept
 * together so the screen's test can prove, for all three at once, that the button carrying a label is
 * the button that posts the matching api — a Delta button wired to `xero_backfill` re-pulls every
 * invoice for every company and looks identical while it does it.
 */
export const XERO_ACTIONS: Record<XeroAction, { id: string; api: string; label: string; busyLabel: string; cls: string }> = {
  backfill: { id: 'xbackfill_btn', api: 'xero_backfill', label: '⤓ Full sync from Xero', busyLabel: 'Syncing all invoices…', cls: 'btn p sm' },
  delta: { id: 'xdelta_btn', api: 'delta_now', label: '⚡ Delta sync (changes only)', busyLabel: 'Delta syncing…', cls: 'btn sm' },
  queue: { id: 'xsync_btn', api: 'sync_now', label: '⟳ Process queue', busyLabel: 'Syncing…', cls: 'btn sm' },
};

export const XERO_ORDER: XeroAction[] = ['backfill', 'delta', 'queue'];

/** The body one sync action POSTs. No golden sees a request body and these three reach a live ledger. */
export function xeroActionBody(a: XeroAction): Record<string, unknown> {
  const spec = XERO_ACTIONS[a];
  if (!spec) throw new Error('xeroActionBody: unknown action ' + a);
  return { api: spec.api };
}

/** `saveWebhookKey()` — app.html:5247-5248. The key is a SECRET, so the length rule guards a real post. */
export const MIN_WEBHOOK_KEY = 10;
export function webhookKeyBody(key: string): Record<string, unknown> {
  const v = (key || '').trim();
  if (v.length < MIN_WEBHOOK_KEY) throw new Error('Please paste the full signing key');
  return { api: 'set_webhook_key', key: v };
}

/** The six panels below the webhook one that hand off to app.html. See this file's header. */
export const XERO_HANDOFF_PANELS = [
  '🏢 Company names · pull latest from Xero',
  '🩺 Per-company sync health',
  '🔬 Live AR audit',
  '🔧 Force resync one invoice',
  '🧨 Emergency rebuild',
  '💰 AR aging snapshot',
];

/** `pill` — app.html:4979. CREATE green, UPDATE blue, everything else (DELETE) grey. */
export function eventPillClass(type: string | null | undefined): string {
  return type === 'CREATE' ? 'pill-green' : type === 'UPDATE' ? 'pill-blue' : 'pill-draft';
}

/**
 * `when` — app.html:4977, `new Date(e.received_at).toLocaleString()` with no options and no timeZone.
 *
 * Same finding as the audit log's, in the same screen: mirrored as-is and pinned BY SOURCE on both
 * sides, because this fleet and CI both sit at UTC+8 and no output assertion here can see the
 * difference between adding a zone and not adding one.
 */
export function eventWhen(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '';
}

/**
 * `(r.contact_cache||0).toLocaleString()` — app.html:4973. Grouped digits, NO locale argument, so the
 * separator follows the reader's browser. Mirrored; `pending` beside it is deliberately NOT grouped,
 * which is the legacy's own inconsistency and is pinned rather than tidied.
 */
export function cacheCount(n: number | null | undefined): string {
  return (n || 0).toLocaleString();
}

export interface XeroPanelProps {
  /** Which of the three sync actions is in flight, or `null`. Only that button is disabled — see the header. */
  busy: XeroAction | null;
  onAction: (a: XeroAction) => void;
  /** `xeroSyncLoad()` — the ↻ Refresh button re-runs the whole load. */
  onRefresh: () => void;
  /** `#xero_out`'s content. Absent is the spinner `xeroSyncLoad()` paints before its call lands. */
  children?: React.ReactNode;
}

/** `xeroSyncLoad()`'s FIRST panel — app.html:4929. `#uv_body`'s first child. */
export function XeroPanel(props: XeroPanelProps) {
  return (
    <div className="panel">
      <div className="panel-hd">
        <h3>Xero sync · real-time webhook activity</h3>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {XERO_ORDER.map((a) => (
            <button key={a} className={XERO_ACTIONS[a].cls} id={XERO_ACTIONS[a].id}
                    disabled={props.busy === a} onClick={() => props.onAction(a)}>
              {props.busy === a ? XERO_ACTIONS[a].busyLabel : XERO_ACTIONS[a].label}
            </button>
          ))}
          <button className="btn sm" onClick={props.onRefresh}>↻ Refresh</button>
        </div>
      </div>
      <div id="xero_out">
        {props.children ?? <div className="load"><span className="spin"></span>Loading…</div>}
      </div>
    </div>
  );
}

export interface XeroOutProps {
  r: WebhookResponse;
  /** The edge-function URL an operator pastes into Xero — `API` (app.html:1219), handed in by the route. */
  apiUrl: string;
  /** `#wk_change`'s `hide` class — toggled by the "Change key" anchor. Only shown when configured. */
  keyPanelOpen: boolean;
  /** The anchor's inline statement — app.html:4970. It must also preventDefault; see the screen's test. */
  onToggleKeyPanel: (e: { preventDefault?: () => void }) => void;
  /** `saveWebhookKey()` — app.html:5245. */
  onSaveKey: () => void;
}

/** `xeroSyncLoad()`'s second write — app.html:4984. Every byte of `#xero_out` on success. */
export default function XeroOut(props: XeroOutProps) {
  const r = props.r;
  const ev = r.events || [];
  return (
    <>
      {r.configured ? (
        <div className="notif-item" style={{ borderLeftColor: 'var(--green-soft)', cursor: 'default' }}>
          <div className="nt">✓ Webhook key configured — Xero can push live events</div>
          <div className="nd">
            Invoice &amp; Contact changes in Xero auto-sync into the local cache in real time.{' '}
            <a href="#" onClick={props.onToggleKeyPanel} style={{ color: 'var(--coral-soft)', textDecoration: 'underline', cursor: 'pointer' }}>Change key</a>
            {' (e.g. after rotating in Xero)'}
          </div>
          <div id="wk_change" className={props.keyPanelOpen ? '' : 'hide'} style={{ display: 'flex', gap: '8px', marginTop: '11px' }}>
            <input id="wk_input" type="password" placeholder="Paste new Xero webhook signing key" style={{ flex: '1' }} autoComplete="off" />
            <button className="btn p sm" onClick={props.onSaveKey}>Save new key</button>
          </div>
        </div>
      ) : (
        <div className="notif-item" style={{ borderLeftColor: 'var(--amber)', cursor: 'default' }}>
          <div className="nt">⚠ Webhook not activated yet</div>
          <div className="nd">
            ① In the Xero developer portal → <b>Webhooks</b>, set the delivery URL below &amp; subscribe to <b>Invoices + Contacts</b>. ② Paste the <b>Webhook signing key</b> Xero gives you here (saved securely server-side — no Supabase dashboard needed):
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '11px' }}>
            <input id="wk_input" type="password" placeholder="Xero webhook signing key" style={{ flex: '1' }} autoComplete="off" />
            <button className="btn p sm" onClick={props.onSaveKey}>Save key</button>
          </div>
        </div>
      )}

      <div className="cards" style={{ margin: '14px 0' }}>
        <div className="card"><div className="n" style={{ color: 'var(--sky-soft)' }}>{cacheCount(r.contact_cache)}</div><div className="l">Contacts cached</div></div>
        <div className="card"><div className="n" style={{ color: 'var(--sky-soft)' }}>{cacheCount(r.invoice_cache)}</div><div className="l">Invoices cached</div></div>
        <div className="card"><div className="n" style={{ color: (r.pending || 0) > 0 ? 'var(--amber)' : 'var(--green-soft)' }}>{r.pending || 0}</div><div className="l">Pending sync</div></div>
      </div>

      <div className="tbl-wrap">
        <table className="bigtable">
          <thead>
            <tr><th>Received</th><th>Event</th><th>Company</th><th>Status</th><th>Resource ID</th></tr>
          </thead>
          <tbody>
            {ev.length ? ev.map((e, i) => (
              <tr key={i}>
                <td className="muted" style={{ fontSize: '11.5px', whiteSpace: 'nowrap' }}>{eventWhen(e.received_at)}</td>
                <td><span className={'pill ' + eventPillClass(e.event_type)} style={{ fontSize: '9.5px' }}>{(e.event_category || '') + ' · ' + (e.event_type || '')}</span></td>
                <td className="muted" style={{ fontSize: '11.5px' }}>{e.tenant_name || ''}</td>
                <td>
                  {e.processed
                    ? <span className="pill pill-green" style={{ fontSize: '9px' }}>synced</span>
                    : <span className="pill pill-draft" style={{ fontSize: '9px' }}>queued</span>}
                </td>
                <td className="muted" style={{ fontSize: '10.5px', fontFamily: 'monospace' }}>{e.resource_id || ''}</td>
              </tr>
            )) : (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '18px' }}>No events received yet — they appear here the moment Xero pushes a change.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="muted" style={{ fontSize: '11.5px', marginTop: '12px', lineHeight: '1.7' }}>
        Webhook delivery URL (paste into Xero developer portal):<br />
        <code style={{ fontSize: '11px', color: 'var(--coral-soft)', wordBreak: 'break-all' }}>{props.apiUrl}</code>
      </div>
    </>
  );
}
