// Finance OS · Users → Xero sync — the six advanced tools below the webhook panel.
//
// The legacy originals are the six panels `xeroSyncLoad()` (app.html:4957-4988) appends below the
// webhook activity panel: `tenantsRefresh()` (:5024), `syncHealthLoad()` (:5198), `xeroDriftCheck()`
// (:5074), `syncAudit()` (:5108), `invoiceResync()` (:5164), `tenantRebuild()` (:5139),
// `arAgingLoad()` (:5251) and `arBucket()` (:5278).
//
// PURE FUNCTION OF ITS PROPS. Every fetch, POST, busy state and toast lives in the route.

import type { Company } from './finance-users';

// ── Types ──────────────────────────────────────────────────────────────────���─────────────────────────

export interface SyncHealthTenant {
  tenant_name?: string;
  cached_invoices?: number;
  cached_open_ar?: number;
  cache_last_updated?: string | null;
  last_full_sync_at?: string | null;
  last_delta_sync_at?: string | null;
  cache_drift_count?: number | null;
  last_error?: string | null;
  records_stale_24h?: number | null;
  oldest_record_synced_at?: string | null;
  webhook_last_event_at?: string | null;
}

export interface SyncHealthCron {
  cron_name?: string;
  last_run_at?: string | null;
  overdue?: boolean;
}

export interface SyncHealthResponse {
  ok?: boolean;
  error?: string;
  tenants?: SyncHealthTenant[];
  crons?: SyncHealthCron[];
  pending_events_total?: number;
  pending_events_failing?: number;
  pending_events_old?: number;
}

export interface DriftResult {
  tenant_name?: string;
  tenant?: string;
  error?: string;
  skipped?: boolean;
  drift?: number;
  missing?: number;
  extra?: number;
  xero_open?: number | null;
  cache_open?: number | null;
}

export interface DriftResponse {
  ok?: boolean;
  error?: string;
  results?: DriftResult[];
}

export interface AuditResult {
  tenant?: string;
  error?: string;
  ok?: boolean;
  cache_count?: number;
  cache_sum?: number;
  xero_count?: number;
  xero_sum?: number;
  count_diff?: number;
  delta_amount?: number;
}

export interface AuditResponse {
  ok?: boolean;
  error?: string;
  results?: AuditResult[];
  audited_at?: string;
}

export interface InvoiceResyncResponse {
  ok?: boolean;
  error?: string;
  action?: string;
  invoice?: { number?: string; id?: string; contact?: string; status?: string; total?: number; amount_due?: number };
}

export interface TenantRebuildResponse {
  ok?: boolean;
  error?: string;
  rows_deleted?: number;
}

export interface TenantsRefreshResponse {
  ok?: boolean;
  error?: string;
  total?: number;
  companies?: Company[];
  renamed?: { from: string; to: string }[];
  added?: { tenant_name: string }[];
  removed?: { tenant_name: string; tenant_id: string }[];
}

export interface ArItem {
  tenant_name?: string;
  contact?: string;
  number?: string;
  amount_due: number;
  due_date?: string;
  days_overdue?: number;
}

export interface ArAgingResponse {
  ok?: boolean;
  error?: string;
  count?: number;
  total?: number;
  buckets?: Record<string, number>;
  items?: ArItem[];
}

export interface ArBucketResponse {
  ok?: boolean;
  error?: string;
  items?: ArItem[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────

const RM = (n: number | null | undefined) =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `rel(iso)` — app.html:5203. Relative time, same idiom as the legacy. */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function staleness(iso: string | null | undefined): 'green' | 'amber' | 'red' {
  if (!iso) return 'red';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return 'green';
  if (s < 86400) return 'amber';
  return 'red';
}

const COLOR: Record<string, string> = { green: 'var(--green-soft)', amber: 'var(--amber)', red: 'var(--red-soft)' };

// ── POST body builders (pinned by test against app.html's own text) ──────────────────────────────────

export function tenantsRefreshBody(): Record<string, unknown> {
  return { api: 'tenants_refresh' };
}

export function driftCheckBody(): Record<string, unknown> {
  return { api: 'drift_check' };
}

export function syncAuditBody(): Record<string, unknown> {
  return { api: 'sync_audit' };
}

export function syncHealthBody(): Record<string, unknown> {
  return { api: 'sync_health' };
}

export function arAgingBody(): Record<string, unknown> {
  return { api: 'cached_receivables' };
}

export function arBucketBody(key: string): Record<string, unknown> {
  return { api: 'cached_receivables', bucket: key };
}

export function invoiceResyncBody(tenant: string, key: string): Record<string, unknown> {
  if (!tenant) throw new Error('Pick a company');
  const k = (key || '').trim();
  if (!k) throw new Error('Enter an invoice number or ID');
  const isUUID = /^[0-9a-f-]{36}$/i.test(k);
  const payload: Record<string, unknown> = { api: 'invoice_resync', tenant };
  if (isUUID) payload.invoice_id = k; else payload.number = k;
  return payload;
}

export function tenantRebuildBody(tenant: string): Record<string, unknown> {
  if (!tenant) throw new Error('Pick a company');
  return { api: 'tenant_rebuild', tenant, confirm: 'REBUILD' };
}

// ── AR aging bucket definitions — app.html:5258 ─────────────────────────────────────────────────��────

export const AR_BUCKETS: [string, string, string][] = [
  ['current', 'Current', 'var(--green-soft)'],
  ['d1_30', '1–30 days', 'var(--sky-soft)'],
  ['d31_60', '31–60 days', 'var(--amber)'],
  ['d61_90', '61–90 days', 'var(--coral-soft)'],
  ['d90p', '90+ days', 'var(--red-soft)'],
];

// ── Components ───────────────────────────────────────────────────────────────────────────────────────

// 1. 🏢 Company names — app.html:4957
export interface CompanyNamesProps {
  companies: Company[];
  busy: boolean;
  result: TenantsRefreshResponse | null;
  error: string | null;
  onRefresh: () => void;
}

export function CompanyNamesPanel(props: CompanyNamesProps) {
  return (
    <div className="panel" style={{ marginTop: '16px' }}>
      <div className="panel-hd">
        <h3>🏢 Company names · pull latest from Xero</h3>
        <button className="btn p sm" id="trefresh_btn" disabled={props.busy} onClick={props.onRefresh}>
          {props.busy ? 'Pulling from Xero…' : '↻ Refresh from Xero /connections'}
        </button>
      </div>
      <p className="muted" style={{ fontSize: '12.5px', margin: '0 0 12px', lineHeight: '1.55' }}>
        Click to fetch the latest company names from Xero. Renamed a company in Xero, or a name has stray invisible characters? This pulls the current names and updates every dropdown / header in the portal.
      </p>
      <div id="trefresh_out" className="muted" style={{ fontSize: '12.5px' }}>
        {props.error
          ? <div style={{ color: 'var(--red-soft)' }}>{props.error}</div>
          : props.result ? <RefreshResult r={props.result} />
          : <>Currently loaded: {props.companies.length} companies.</>}
      </div>
    </div>
  );
}

function RefreshResult({ r }: { r: TenantsRefreshResponse }) {
  return (
    <>
      <div style={{ color: 'var(--green-soft)', fontWeight: 600, marginBottom: '8px' }}>✓ Pulled {r.total} companies from Xero.</div>
      {r.renamed && r.renamed.length > 0 && (
        <>
          <div style={{ marginTop: '8px', fontWeight: 600 }}>Renamed ({r.renamed.length}):</div>
          {r.renamed.map((x, i) => <div key={i} style={{ fontSize: '12.5px', padding: '3px 0' }}><span className="muted">{x.from}</span> → <b>{x.to}</b></div>)}
        </>
      )}
      {r.added && r.added.length > 0 && (
        <>
          <div style={{ marginTop: '8px', fontWeight: 600 }}>Added ({r.added.length}):</div>
          {r.added.map((x, i) => <div key={i} style={{ fontSize: '12.5px', padding: '3px 0' }}>+ <b>{x.tenant_name}</b></div>)}
        </>
      )}
      {r.removed && r.removed.length > 0 && (
        <>
          <div style={{ marginTop: '8px', fontWeight: 600, color: 'var(--amber)' }}>No longer in Xero ({r.removed.length}):</div>
          {r.removed.map((x, i) => <div key={i} style={{ fontSize: '12.5px', padding: '3px 0' }}>− <b>{x.tenant_name}</b> <span className="muted">({x.tenant_id.slice(0, 8)}…)</span></div>)}
        </>
      )}
      {(!r.renamed || !r.renamed.length) && (!r.added || !r.added.length) && (!r.removed || !r.removed.length) && (
        <div className="muted" style={{ fontSize: '12.5px', marginTop: '4px' }}>No changes — your portal already had the latest names.</div>
      )}
    </>
  );
}

// 2. 🩺 Sync health — app.html:4961
export interface SyncHealthProps {
  health: SyncHealthResponse | null;
  healthErr: string | null;
  driftBusy: boolean;
  driftResult: DriftResponse | null;
  driftErr: string | null;
  onDriftCheck: () => void;
}

export function SyncHealthPanel(props: SyncHealthProps) {
  return (
    <div className="panel" style={{ marginTop: '16px' }}>
      <div className="panel-hd">
        <h3>🩺 Per-company sync health</h3>
        <button className="btn p sm" id="xdrift_btn" disabled={props.driftBusy} onClick={props.onDriftCheck}>
          {props.driftBusy ? 'Checking…' : '🔍 Reconcile vs Xero (live API)'}
        </button>
      </div>
      <div id="xdrift_out" style={{ marginBottom: '12px' }}>
        {props.driftBusy && (
          <div className="muted" style={{ fontSize: '12.5px', padding: '8px 0' }}>
            <span className="spin"></span> Calling the Xero API live and reconciling each company&apos;s open invoices (AR + AP) one by one…
          </div>
        )}
        {props.driftErr && <div style={{ color: 'var(--red-soft)' }}>{props.driftErr}</div>}
        {props.driftResult && !props.driftBusy && <DriftTable r={props.driftResult} />}
      </div>
      <div id="syncH_out">
        {props.healthErr
          ? <div style={{ color: 'var(--red-soft)' }}>{props.healthErr}</div>
          : props.health ? <HealthTable r={props.health} />
          : <div className="load"><span className="spin"></span>Loading…</div>}
      </div>
    </div>
  );
}

function DriftTable({ r }: { r: DriftResponse }) {
  const res = r.results || [];
  const checked = res.filter((x) => !x.error && !x.skipped).length;
  const allOk = checked > 0 && res.every((x) => x.skipped || (!x.error && Math.abs(x.drift || 0) === 0 && (x.missing || 0) === 0 && (x.extra || 0) === 0));
  return (
    <>
      {allOk ? (
        <div className="notif-item" style={{ borderLeftColor: 'var(--green-soft)', cursor: 'default', marginBottom: '10px' }}>
          <div className="nt">✓ {checked} companies fully match Xero · data accurate</div>
          <div className="nd">Live Xero API, reconciling every open invoice ID (AR + AP) — zero missing, zero extra. Checked at {new Date().toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      ) : (
        <div className="notif-item" style={{ borderLeftColor: 'var(--amber)', cursor: 'default', marginBottom: '10px' }}>
          <div className="nt">⚠ Drift detected (auto-repaired)</div>
          <div className="nd">Missing rows were re-fetched from Xero and extras removed. Click Reconcile again to confirm it is back to zero.</div>
        </div>
      )}
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead><tr><th>Company</th><th className="amt">Xero open (live)</th><th className="amt">Cache open</th><th className="amt">Missing</th><th className="amt">Extra</th><th>Verdict</th></tr></thead>
          <tbody>
            {res.map((x, i) => <DriftRow key={i} x={x} />)}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>&ldquo;Open&rdquo; = AUTHORISED / SUBMITTED AR + AP invoices. This reconciliation reads live Xero API data directly, bypassing the cache.</div>
    </>
  );
}

function DriftRow({ x }: { x: DriftResult }) {
  const nm = x.tenant_name || x.tenant || '';
  if (x.error) return (
    <tr><td><b>{nm}</b></td><td colSpan={4} style={{ color: 'var(--red-soft)', fontSize: '11.5px' }}>⚠ {x.error}</td><td><span className="pill" style={{ background: 'rgba(239,68,68,.16)', color: 'var(--red-soft)', fontSize: '9.5px' }}>error</span></td></tr>
  );
  if (x.skipped) return (
    <tr><td><b>{nm}</b></td><td colSpan={4} className="muted" style={{ fontSize: '11.5px' }}>⏳ Xero rate-limit cooldown — will auto-retry shortly</td><td><span className="pill" style={{ fontSize: '9.5px' }}>skipped</span></td></tr>
  );
  const miss = x.missing || 0;
  const ex = x.extra || 0;
  const okv = Math.abs(x.drift || 0) === 0 && miss === 0 && ex === 0;
  return (
    <tr>
      <td><b>{nm}</b></td>
      <td className="amt">{x.xero_open != null ? x.xero_open : '—'}</td>
      <td className="amt">{x.cache_open != null ? x.cache_open : '—'}</td>
      <td className="amt" style={{ color: miss ? 'var(--red-soft)' : 'var(--muted)' }}>{miss}</td>
      <td className="amt" style={{ color: ex ? 'var(--red-soft)' : 'var(--muted)' }}>{ex}</td>
      <td>
        {okv
          ? <span className="pill pill-green" style={{ fontSize: '9.5px' }}>✓ in sync</span>
          : <span className="pill" style={{ background: 'rgba(239,68,68,.16)', color: 'var(--red-soft)', fontSize: '9.5px' }}>✗ drift {(x.drift || 0) > 0 ? '+' : ''}{x.drift || 0}</span>}
      </td>
    </tr>
  );
}

function HealthTable({ r }: { r: SyncHealthResponse }) {
  const tenants = r.tenants || [];
  const crons = r.crons || [];
  const overdue = crons.filter((c) => c.overdue);
  const silentTenants = tenants.filter((t) => !t.webhook_last_event_at || (Date.now() - new Date(t.webhook_last_event_at).getTime()) > 24 * 3600 * 1000);
  const allSilent = silentTenants.length === tenants.length && tenants.length > 0;
  return (
    <>
      {(r.pending_events_total || 0) > 0 && (
        <div className="notif-item" style={{ borderLeftColor: (r.pending_events_failing || 0) > 0 ? 'var(--red-soft)' : 'var(--amber)', cursor: 'default', marginBottom: '12px' }}>
          <div className="nt">⚠ {r.pending_events_total} webhook event(s) pending</div>
          <div className="nd">{r.pending_events_old || 0} older than 15 min · {r.pending_events_failing || 0} have failed ≥3× (rate-limit or Xero error). Auto-retry runs every 5 min.</div>
        </div>
      )}
      {overdue.length > 0 && (
        <div className="notif-item" style={{ borderLeftColor: 'var(--red-soft)', cursor: 'default', marginBottom: '12px' }}>
          <div className="nt">⚠ {overdue.length} cron(s) appear overdue</div>
          <div className="nd">{overdue.map((c) => (c.cron_name || '') + ' (last ran ' + relTime(c.last_run_at) + ')').join(' · ')}. Check pg_cron logs.</div>
        </div>
      )}
      {!allSilent && silentTenants.length > 0 && (
        <div className="notif-item" style={{ borderLeftColor: 'var(--amber)', cursor: 'default', marginBottom: '12px' }}>
          <div className="nt">⚠ {silentTenants.length} company/companies received no webhook events in 24h</div>
          <div className="nd">{silentTenants.map((t) => t.tenant_name || '').join(' · ')}. Either no activity in Xero, OR the webhook subscription is broken. Check Xero developer portal → Webhooks → delivery history.</div>
        </div>
      )}
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead><tr><th>Company</th><th className="amt">Cached</th><th className="amt">Open AR</th><th>Cache age</th><th>Open AR freshness</th><th>Last sync (F=full, Δ=delta)</th><th>Drift</th><th>Last error</th></tr></thead>
          <tbody>
            {tenants.length ? tenants.map((t, i) => <HealthRow key={i} t={t} />) : (
              <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: '18px' }}>No companies</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: '11.5px', marginTop: '12px', lineHeight: '1.7' }}>
        Delta sync every 5 min (:01/:06/:11…). Daily full sync 02:00 MYT. Auto drift-repair 02:30 MYT. Webhook retry every 5 min (rate-limit-aware: skips invoices the delta already cached, capped fetches/run, honours cooldowns). Real-time push: INVOICE / CONTACT / PAYMENT / CREDITNOTE. <b>If you see drift &gt; 50 or stale records &gt; 100</b>, the cache likely missed events while Xero was rate-limited — try <b>Delta sync</b>, then <b>Drift check</b>.
      </div>
    </>
  );
}

function HealthRow({ t }: { t: SyncHealthTenant }) {
  const freshColor = COLOR[staleness(t.cache_last_updated)];
  const stale = Number(t.records_stale_24h || 0);
  const oldest = t.oldest_record_synced_at ? relTime(t.oldest_record_synced_at) : '—';
  const driftPill = (t.cache_drift_count === null || t.cache_drift_count === undefined)
    ? <span className="muted" style={{ fontSize: '11px' }}>not checked</span>
    : Math.abs(t.cache_drift_count) === 0
      ? <span className="pill pill-green" style={{ fontSize: '9px' }}>in sync</span>
      : <span className="pill" style={{ background: 'rgba(239,68,68,.16)', color: 'var(--red-soft)', fontSize: '9.5px' }}>drift {t.cache_drift_count > 0 ? '+' : ''}{t.cache_drift_count}</span>;
  const errCell = t.last_error
    ? <span style={{ color: 'var(--red-soft)', fontSize: '11px' }} title={t.last_error}>⚠ {(t.last_error || '').slice(0, 60)}…</span>
    : <span className="muted" style={{ fontSize: '11px' }}>—</span>;
  return (
    <tr>
      <td><b style={{ fontSize: '12.5px' }}>{t.tenant_name || ''}</b></td>
      <td className="amt muted" style={{ fontSize: '11.5px' }}>{(t.cached_invoices || 0).toLocaleString()}</td>
      <td className="amt" style={{ fontSize: '11.5px' }}>{(t.cached_open_ar || 0).toLocaleString()}</td>
      <td style={{ fontSize: '11.5px', color: freshColor }}>{relTime(t.cache_last_updated)}</td>
      <td style={{ fontSize: '11.5px' }}>
        {stale > 0
          ? <><span className="pill" style={{ background: 'rgba(245,158,11,.14)', color: 'var(--amber)', fontSize: '9.5px' }}>{stale} stale</span><div className="muted" style={{ fontSize: '10.5px', marginTop: '2px' }}>oldest: {oldest}</div></>
          : <><span className="pill pill-green" style={{ fontSize: '9.5px' }}>all fresh</span><div className="muted" style={{ fontSize: '10.5px', marginTop: '2px' }}>oldest: {oldest}</div></>}
      </td>
      <td style={{ fontSize: '11.5px' }}><span className="muted">F:</span> {relTime(t.last_full_sync_at)} · <span className="muted">Δ:</span> {relTime(t.last_delta_sync_at)}</td>
      <td>{driftPill}</td>
      <td>{errCell}</td>
    </tr>
  );
}

// 3. 🔬 Live AR audit — app.html:4963
export interface LiveAuditProps {
  busy: boolean;
  result: AuditResponse | null;
  error: string | null;
  onRun: () => void;
}

export function LiveAuditPanel(props: LiveAuditProps) {
  return (
    <div className="panel" style={{ marginTop: '16px' }}>
      <div className="panel-hd">
        <h3>🔬 Live AR audit <span className="muted" style={{ fontSize: '11px', textTransform: 'none', letterSpacing: '0' }}>· compares cache total vs live Xero query (proves zero drift)</span></h3>
        <button className="btn p sm" id="xaudit_btn" disabled={props.busy} onClick={props.onRun}>
          {props.busy ? 'Auditing…' : '⚖ Run audit now'}
        </button>
      </div>
      <div id="audit_out">
        {props.busy && <div className="muted" style={{ fontSize: '12.5px', padding: '8px 0' }}><span className="spin"></span>Querying Xero live for each company&apos;s open AR (10-60s)…</div>}
        {props.error && <div style={{ color: 'var(--red-soft)' }}>{props.error}</div>}
        {props.result && !props.busy && <AuditResultTable r={props.result} />}
        {!props.busy && !props.error && !props.result && (
          <div className="muted" style={{ fontSize: '12.5px', padding: '8px 0' }}>Click Run audit. The backend queries Xero live for each company&apos;s open AR and shows the RM-level delta. Anything &gt; RM 1.00 is flagged.</div>
        )}
      </div>
    </div>
  );
}

function AuditResultTable({ r }: { r: AuditResponse }) {
  const results = r.results || [];
  const allOk = results.every((x) => x.ok);
  const fmtRM = (n: number) => (n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <>
      {allOk ? (
        <div className="notif-item" style={{ borderLeftColor: 'var(--green-soft)', cursor: 'default', marginBottom: '10px' }}>
          <div className="nt">✓ All companies in sync</div>
          <div className="nd">Audited at {r.audited_at ? new Date(r.audited_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'} MYT</div>
        </div>
      ) : (
        <div className="notif-item" style={{ borderLeftColor: 'var(--red-soft)', cursor: 'default', marginBottom: '10px' }}>
          <div className="nt">⚠ Drift detected</div>
          <div className="nd">Run Delta sync, then Drift check. If still off, use Force resync on the specific invoices in the count_diff.</div>
        </div>
      )}
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead><tr><th>Company</th><th className="amt">Cache (count / sum)</th><th className="amt">Xero LIVE (count / sum)</th><th className="amt">Count Δ</th><th className="amt">RM Δ</th><th>Verdict</th></tr></thead>
          <tbody>
            {results.map((x, i) => {
              if (x.error) return <tr key={i}><td><b>{x.tenant}</b></td><td colSpan={5} style={{ color: 'var(--red-soft)', fontSize: '11.5px' }}>⚠ {x.error}</td></tr>;
              const deltaColor = Math.abs(x.delta_amount || 0) < 1 ? 'var(--green-soft)' : 'var(--red-soft)';
              const countColor = (x.count_diff || 0) === 0 ? 'var(--green-soft)' : 'var(--red-soft)';
              return (
                <tr key={i}>
                  <td><b>{x.tenant}</b></td>
                  <td className="amt">{x.cache_count} / RM {fmtRM(x.cache_sum || 0)}</td>
                  <td className="amt">{x.xero_count} / RM {fmtRM(x.xero_sum || 0)}</td>
                  <td className="amt" style={{ color: countColor }}>{(x.count_diff || 0) > 0 ? '+' : ''}{x.count_diff || 0}</td>
                  <td className="amt" style={{ color: deltaColor }}><b>RM {fmtRM(x.delta_amount || 0)}</b></td>
                  <td>{x.ok ? <span className="pill pill-green" style={{ fontSize: '9.5px' }}>✓ in sync</span> : <span className="pill" style={{ background: 'rgba(239,68,68,.16)', color: 'var(--red-soft)', fontSize: '9.5px' }}>✗ drift</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// 4. 🔧 Force resync — app.html:4965
export interface InvoiceResyncProps {
  companies: Company[];
  busy: boolean;
  result: InvoiceResyncResponse | null;
  error: string | null;
  onResync: () => void;
}

export function InvoiceResyncPanel(props: InvoiceResyncProps) {
  const iv = props.result && props.result.invoice;
  return (
    <div className="panel" style={{ marginTop: '16px' }}>
      <div className="panel-hd">
        <h3>🔧 Force resync one invoice <span className="muted" style={{ fontSize: '11px', textTransform: 'none', letterSpacing: '0' }}>· when a single invoice on screen doesn&apos;t match Xero</span></h3>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1', minWidth: '180px' }}>
          <label style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '4px' }}>Company</label>
          <select id="rsync_tenant" style={{ width: '100%' }}>
            {props.companies.map((c) => <option key={c.tenant_id} value={c.tenant_id}>{c.tenant_name}</option>)}
          </select>
        </div>
        <div style={{ flex: '2', minWidth: '200px' }}>
          <label style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '4px' }}>Invoice number OR Xero invoice ID</label>
          <input id="rsync_key" placeholder="INV-1183  or  abc-def-123…" style={{ width: '100%' }} />
        </div>
        <button className="btn p" id="rsync_btn" disabled={props.busy} onClick={props.onResync}>
          {props.busy ? 'Working…' : '⟲ Resync from Xero'}
        </button>
      </div>
      <div id="rsync_out" style={{ marginTop: '12px', fontSize: '13px' }}>
        {props.error && <div style={{ color: 'var(--red-soft)' }}>{props.error}</div>}
        {props.result && iv && (
          <>
            <div style={{ background: 'var(--panel-2)', border: '1px solid var(--green-soft)', borderRadius: '8px', padding: '12px', display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
              <span><b>✓ {props.result.action}:</b> {iv.number || iv.id || ''}</span>
              <span><b>Contact:</b> {iv.contact || '—'}</span>
              <span><b>Status:</b> {iv.status || '—'}</span>
              <span><b>Total:</b> {RM(iv.total)}</span>
              <span><b>Amount due:</b> {RM(iv.amount_due)}</span>
            </div>
            <div className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>Cache updated. Refresh the relevant tab to see new values.</div>
          </>
        )}
      </div>
    </div>
  );
}

// 5. 🧨 Emergency rebuild — app.html:4978
export interface RebuildProps {
  companies: Company[];
  busy: boolean;
  result: TenantRebuildResponse | null;
  error: string | null;
  confirmText: string;
  selectedTenant: string;
  onTenantChange: (v: string) => void;
  onConfirmChange: (v: string) => void;
  onRebuild: () => void;
}

export function RebuildPanel(props: RebuildProps) {
  const co = props.companies.find((c) => c.tenant_id === props.selectedTenant);
  const selectedName = co ? co.tenant_name : '';
  return (
    <div className="panel" style={{ marginTop: '16px', borderColor: 'rgba(239,68,68,.18)' }}>
      <div className="panel-hd">
        <h3>🧨 Emergency rebuild <span className="muted" style={{ fontSize: '11px', textTransform: 'none', letterSpacing: '0' }}>· when the cache is catastrophically out of sync</span></h3>
      </div>
      <div style={{ background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.18)', borderRadius: '8px', padding: '11px 14px', fontSize: '12.5px', color: 'var(--red-soft)', marginBottom: '12px', lineHeight: '1.6' }}>
        ⚠ This wipes one company&apos;s entire cached invoice history then re-pulls from Xero starting from 2015. Use ONLY when incremental drift repair can&apos;t catch up. The rebuild runs in the background (2–5 minutes). All operations are audited.
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1', minWidth: '200px' }}>
          <label style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '4px' }}>Company to rebuild</label>
          <select id="rebuild_tenant" style={{ width: '100%' }} value={props.selectedTenant} onChange={(e) => props.onTenantChange(e.target.value)}>
            {props.companies.map((c) => <option key={c.tenant_id} value={c.tenant_id}>{c.tenant_name}</option>)}
          </select>
        </div>
        <div style={{ flex: '2', minWidth: '200px' }}>
          <label style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '4px' }}>
            Type the company name exactly to confirm
          </label>
          <input id="rebuild_confirm" placeholder="Type company name to proceed" style={{ width: '100%' }}
                 value={props.confirmText} onChange={(e) => props.onConfirmChange(e.target.value)} />
        </div>
        <button className="btn d" id="rebuild_btn" disabled={props.busy || !props.confirmText || props.confirmText !== selectedName}
                onClick={props.onRebuild}>
          {props.busy ? 'Rebuilding…' : '🧨 Wipe + rebuild from Xero'}
        </button>
      </div>
      <div id="rebuild_out" style={{ marginTop: '10px', fontSize: '12.5px' }}>
        {props.error && <div style={{ color: 'var(--red-soft)' }}>{props.error}</div>}
        {props.result && props.result.ok && (
          <div style={{ background: 'rgba(126,224,160,.08)', border: '1px solid var(--green-soft)', borderRadius: '8px', padding: '10px 14px', color: 'var(--green-soft)' }}>
            ✓ Wiped {props.result.rows_deleted} rows. Backfill running in background. Check the sync health table above in 2-5 minutes.
          </div>
        )}
      </div>
    </div>
  );
}

// 6. 💰 AR aging — app.html:4988
export interface ArAgingProps {
  data: ArAgingResponse | null;
  error: string | null;
  drillBusy: boolean;
  drillLabel: string | null;
  drillData: ArBucketResponse | null;
  drillErr: string | null;
  onBucket: (key: string, label: string) => void;
  onCloseDrill: () => void;
}

export function ArAgingPanel(props: ArAgingProps) {
  return (
    <div className="panel" style={{ marginTop: '16px' }}>
      <div className="panel-hd">
        <h3>💰 AR aging snapshot <span className="muted" style={{ fontSize: '11px', textTransform: 'none', letterSpacing: '0' }}>· instant, from local cache (real-time synced)</span></h3>
      </div>
      <div id="ar_out">
        {props.error
          ? <div style={{ color: 'var(--red-soft)' }}>{props.error}</div>
          : props.data ? <ArContent data={props.data} drillBusy={props.drillBusy} drillLabel={props.drillLabel} drillData={props.drillData} drillErr={props.drillErr} onBucket={props.onBucket} onCloseDrill={props.onCloseDrill} />
          : <div className="load"><span className="spin"></span>Loading…</div>}
      </div>
    </div>
  );
}

function ArContent(props: { data: ArAgingResponse; drillBusy: boolean; drillLabel: string | null; drillData: ArBucketResponse | null; drillErr: string | null; onBucket: (key: string, label: string) => void; onCloseDrill: () => void }) {
  const { data } = props;
  if (!data.count) {
    return (
      <div className="empty"><div className="empty-ico">💤</div><div>No cached receivables yet — click <b>Full sync from Xero</b> above to populate, or wait for the next webhook.</div></div>
    );
  }
  const bk = data.buckets || {};
  const top = (data.items || []).slice(0, 10);
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
        <div className="muted" style={{ fontSize: '12px' }}>{data.count} open invoice(s)</div>
        <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text)' }}>{RM(data.total)} <span className="muted" style={{ fontSize: '11px', fontWeight: 600 }}>total outstanding</span></div>
      </div>
      <div className="cards">
        {AR_BUCKETS.map(([key, label, color]) => (
          <div key={key} className="card" style={{ cursor: 'pointer' }} onClick={() => props.onBucket(key, label)} title="Click to view invoices in this band">
            <div className="n" style={{ color, fontSize: '18px' }}>{RM(bk[key])}</div>
            <div className="l">{label} ▸</div>
          </div>
        ))}
      </div>
      <div id="ar_drill">
        {props.drillBusy && <div className="load"><span className="spin"></span>Loading {props.drillLabel}…</div>}
        {props.drillErr && <div style={{ color: 'var(--red-soft)' }}>{props.drillErr}</div>}
        {props.drillData && props.drillLabel && !props.drillBusy && <ArDrillTable data={props.drillData} label={props.drillLabel} onClose={props.onCloseDrill} />}
      </div>
      <h4 style={{ fontSize: '12.5px', margin: '18px 0 8px', color: 'var(--text)' }}>Top exposures</h4>
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead><tr><th>Company</th><th>Customer</th><th>Invoice</th><th className="amt">Amount</th><th>Due</th><th>Overdue</th></tr></thead>
          <tbody>
            {top.map((item, i) => <ArRow key={i} item={item} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ArDrillTable({ data, label, onClose }: { data: ArBucketResponse; label: string; onClose: () => void }) {
  const items = data.items || [];
  const sum = items.reduce((s, i) => s + i.amount_due, 0);
  return (
    <div className="panel" style={{ margin: '14px 0', borderColor: 'var(--coral-deep)' }}>
      <div className="panel-hd">
        <h3 style={{ fontSize: '13px' }}>{label} · {items.length} invoice(s) · {RM(sum)}</h3>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={onClose}>× Close</button>
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead><tr><th>Company</th><th>Customer</th><th>Invoice</th><th className="amt">Amount</th><th>Due</th><th>Overdue</th></tr></thead>
          <tbody>
            {items.length ? items.map((item, i) => <ArRow key={i} item={item} />) : (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '14px' }}>No invoices in this band</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ArRow({ item }: { item: ArItem }) {
  const col = (item.days_overdue || 0) > 60 ? 'var(--red-soft)' : (item.days_overdue || 0) > 0 ? 'var(--amber)' : 'var(--muted)';
  return (
    <tr>
      <td className="muted" style={{ fontSize: '11.5px' }}>{item.tenant_name || ''}</td>
      <td><b style={{ fontSize: '12.5px' }}>{item.contact || '?'}</b></td>
      <td className="muted" style={{ fontSize: '11.5px' }}>{item.number || ''}</td>
      <td className="amt" style={{ fontWeight: 700 }}>{RM(item.amount_due)}</td>
      <td className="muted" style={{ fontSize: '11.5px' }}>{item.due_date || ''}</td>
      <td style={{ color: col, fontWeight: 700, fontSize: '12px' }}>{(item.days_overdue || 0) > 0 ? item.days_overdue + 'd' : '—'}</td>
    </tr>
  );
}
