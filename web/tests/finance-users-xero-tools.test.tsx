// Finance OS · Users → the six advanced Xero tools — parity coverage.
//
// No golden holds any of these panels (they render only inside the Xero sub-view, and
// tests/golden/finance.users.html was captured with the Users list active). In place of a diff:
//
//  1. BODY BUILDERS pinned against app.html's own text.
//  2. COMPONENT STRUCTURE assertions — each panel renders its element ids and classes.
//  3. EMERGENCY REBUILD — the typed-name guard, the only thing the captain decided above the migration.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  AR_BUCKETS, ArAgingPanel, CompanyNamesPanel, InvoiceResyncPanel, LiveAuditPanel,
  RebuildPanel, SyncHealthPanel,
  arAgingBody, arBucketBody, driftCheckBody, invoiceResyncBody, relTime,
  syncAuditBody, syncHealthBody, tenantRebuildBody, tenantsRefreshBody,
  type ArAgingResponse, type AuditResponse, type DriftResponse, type SyncHealthResponse,
  type TenantsRefreshResponse,
} from '../src/finance-users-xero-tools';
import { REPO } from './parity';

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');

function legacy(from: string, to: string): string {
  const a = APP.indexOf(from);
  const b = APP.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('legacy slice not found: ' + from + ' → ' + to);
  return APP.slice(a, b);
}

// ═══ 1 · BODY BUILDERS ═══════════════════════════════════════════════════════════════════════════════

describe('POST body builders match app.html', () => {
  it('tenantsRefreshBody → {api:"tenants_refresh"}', () => {
    const body = tenantsRefreshBody();
    expect(body).toEqual({ api: 'tenants_refresh' });
    const src = legacy('async function tenantsRefresh(){', 'async function xeroBackfill(){');
    expect(src).toContain("call({api:'tenants_refresh'})");
  });

  it('driftCheckBody → {api:"drift_check"}', () => {
    const body = driftCheckBody();
    expect(body).toEqual({ api: 'drift_check' });
    const src = legacy('async function xeroDriftCheck(){', 'async function syncAudit(){');
    expect(src).toContain("call({api:'drift_check'})");
  });

  it('syncAuditBody → {api:"sync_audit"}', () => {
    const body = syncAuditBody();
    expect(body).toEqual({ api: 'sync_audit' });
    const src = legacy('async function syncAudit(){', 'async function tenantRebuild(){');
    expect(src).toContain("call({api:'sync_audit'})");
  });

  it('syncHealthBody → {api:"sync_health"}', () => {
    const body = syncHealthBody();
    expect(body).toEqual({ api: 'sync_health' });
    const src = legacy('async function syncHealthLoad(){', 'async function arAgingLoad(){');
    expect(src).toContain("call({api:'sync_health'})");
  });

  it('arAgingBody → {api:"cached_receivables"}', () => {
    const body = arAgingBody();
    expect(body).toEqual({ api: 'cached_receivables' });
    const src = legacy('async function arAgingLoad(){', 'async function saveWebhookKey(){');
    expect(src).toContain("call({api:'cached_receivables'})");
  });

  it('arBucketBody → {api:"cached_receivables",bucket}', () => {
    const body = arBucketBody('d1_30');
    expect(body).toEqual({ api: 'cached_receivables', bucket: 'd1_30' });
    const idx = APP.indexOf('async function arBucket(');
    const slice = APP.slice(idx, idx + 500);
    expect(slice).toContain("call({api:'cached_receivables',bucket:key})");
  });

  it('invoiceResyncBody splits UUID from number — app.html:5175-5177', () => {
    const uuid = invoiceResyncBody('t1', 'abcdef01-1234-5678-9012-123456789abc');
    expect(uuid).toEqual({ api: 'invoice_resync', tenant: 't1', invoice_id: 'abcdef01-1234-5678-9012-123456789abc' });
    const num = invoiceResyncBody('t1', 'INV-1183');
    expect(num).toEqual({ api: 'invoice_resync', tenant: 't1', number: 'INV-1183' });
    expect(() => invoiceResyncBody('', 'INV-1')).toThrow('Pick a company');
    expect(() => invoiceResyncBody('t1', '')).toThrow('Enter an invoice number or ID');
    const src = legacy('async function invoiceResync(){', 'async function syncHealthLoad(){');
    expect(src).toContain("var isUUID = /^[0-9a-f-]{36}$/i.test(lookup_key);");
    expect(src).toContain("if(isUUID) payload.invoice_id = lookup_key; else payload.number = lookup_key;");
  });

  it('tenantRebuildBody → {api:"tenant_rebuild",tenant,confirm:"REBUILD"}', () => {
    const body = tenantRebuildBody('t1');
    expect(body).toEqual({ api: 'tenant_rebuild', tenant: 't1', confirm: 'REBUILD' });
    expect(() => tenantRebuildBody('')).toThrow('Pick a company');
    const src = legacy('async function tenantRebuild(){', 'async function invoiceResync(){');
    expect(src).toContain("call({api:'tenant_rebuild', tenant:tenant, confirm:'REBUILD'})");
  });
});

// ═══ 2 · COMPONENT STRUCTURE ═════════════════════════════════════════════════════════════════════════

const COMPANIES = [
  { tenant_id: 'tid1', tenant_name: 'Acme Sdn Bhd' },
  { tenant_id: 'tid2', tenant_name: 'Beta Corp' },
];

describe('CompanyNamesPanel', () => {
  it('renders the refresh button and company count in initial state', () => {
    const html = renderToStaticMarkup(
      <CompanyNamesPanel companies={COMPANIES} busy={false} result={null} error={null} onRefresh={() => {}} />,
    );
    expect(html).toContain('id="trefresh_btn"');
    expect(html).toContain('id="trefresh_out"');
    expect(html).toContain('Currently loaded: 2 companies.');
    expect(html).toContain('🏢 Company names');
  });

  it('shows result when refresh completes', () => {
    const r: TenantsRefreshResponse = { ok: true, total: 2, renamed: [{ from: 'Old', to: 'New' }], added: [], removed: [] };
    const html = renderToStaticMarkup(
      <CompanyNamesPanel companies={COMPANIES} busy={false} result={r} error={null} onRefresh={() => {}} />,
    );
    expect(html).toContain('Pulled 2 companies from Xero');
    expect(html).toContain('Renamed (1)');
    expect(html).toContain('Old');
    expect(html).toContain('New');
  });
});

describe('SyncHealthPanel', () => {
  it('shows spinner before health loads', () => {
    const html = renderToStaticMarkup(
      <SyncHealthPanel health={null} healthErr={null} driftBusy={false} driftResult={null} driftErr={null} onDriftCheck={() => {}} />,
    );
    expect(html).toContain('id="syncH_out"');
    expect(html).toContain('id="xdrift_btn"');
    expect(html).toContain('Loading');
    expect(html).toContain('🩺 Per-company sync health');
  });

  it('shows health table when loaded', () => {
    const r: SyncHealthResponse = {
      ok: true,
      tenants: [{ tenant_name: 'Acme', cached_invoices: 100, cached_open_ar: 50, cache_last_updated: new Date().toISOString() }],
      crons: [],
    };
    const html = renderToStaticMarkup(
      <SyncHealthPanel health={r} healthErr={null} driftBusy={false} driftResult={null} driftErr={null} onDriftCheck={() => {}} />,
    );
    expect(html).toContain('Acme');
    expect(html).toContain('100');
    expect(html).toContain('50');
  });
});

describe('LiveAuditPanel', () => {
  it('shows instructions before running', () => {
    const html = renderToStaticMarkup(
      <LiveAuditPanel busy={false} result={null} error={null} onRun={() => {}} />,
    );
    expect(html).toContain('id="xaudit_btn"');
    expect(html).toContain('Click Run audit');
    expect(html).toContain('🔬 Live AR audit');
  });

  it('shows results when audit completes', () => {
    const r: AuditResponse = {
      ok: true, audited_at: '2026-08-24T10:00:00Z',
      results: [{ tenant: 'Acme', ok: true, cache_count: 10, cache_sum: 5000, xero_count: 10, xero_sum: 5000, count_diff: 0, delta_amount: 0 }],
    };
    const html = renderToStaticMarkup(
      <LiveAuditPanel busy={false} result={r} error={null} onRun={() => {}} />,
    );
    expect(html).toContain('All companies in sync');
    expect(html).toContain('Acme');
  });
});

describe('InvoiceResyncPanel', () => {
  it('renders form controls with legacy element ids', () => {
    const html = renderToStaticMarkup(
      <InvoiceResyncPanel companies={COMPANIES} busy={false} result={null} error={null} onResync={() => {}} />,
    );
    expect(html).toContain('id="rsync_tenant"');
    expect(html).toContain('id="rsync_key"');
    expect(html).toContain('id="rsync_btn"');
    expect(html).toContain('🔧 Force resync one invoice');
    expect(html).toContain('Acme Sdn Bhd');
  });
});

describe('RebuildPanel — typed confirmation guard', () => {
  it('renders form controls with legacy element ids', () => {
    const html = renderToStaticMarkup(
      <RebuildPanel companies={COMPANIES} busy={false} result={null} error={null}
                    confirmText="" selectedTenant="tid1" onTenantChange={() => {}} onConfirmChange={() => {}} onRebuild={() => {}} />,
    );
    expect(html).toContain('id="rebuild_tenant"');
    expect(html).toContain('id="rebuild_btn"');
    expect(html).toContain('id="rebuild_confirm"');
    expect(html).toContain('🧨 Emergency rebuild');
    expect(html).toContain('Type the company name exactly to confirm');
    expect(html).toContain('disabled');
  });

  it('button is disabled when confirmText does not match the selected company name', () => {
    const html = renderToStaticMarkup(
      <RebuildPanel companies={COMPANIES} busy={false} result={null} error={null}
                    confirmText="wrong name" selectedTenant="tid1" onTenantChange={() => {}} onConfirmChange={() => {}} onRebuild={() => {}} />,
    );
    expect(html).toContain('disabled');
  });

  it('shows success state after rebuild', () => {
    const html = renderToStaticMarkup(
      <RebuildPanel companies={COMPANIES} busy={false} result={{ ok: true, rows_deleted: 500 }} error={null}
                    confirmText="" selectedTenant="tid1" onTenantChange={() => {}} onConfirmChange={() => {}} onRebuild={() => {}} />,
    );
    expect(html).toContain('Wiped 500 rows');
    expect(html).toContain('Backfill running in background');
  });

  it('the legacy uses prompt() to require typing the company name — app.html:5144', () => {
    const src = legacy('async function tenantRebuild(){', 'async function invoiceResync(){');
    expect(src).toContain("if(confirm1 !== tenantName)");
    expect(src).toContain("type the company name exactly");
  });
});

describe('ArAgingPanel', () => {
  it('shows spinner before data loads', () => {
    const html = renderToStaticMarkup(
      <ArAgingPanel data={null} error={null} drillBusy={false} drillLabel={null} drillData={null} drillErr={null} onBucket={() => {}} onCloseDrill={() => {}} />,
    );
    expect(html).toContain('id="ar_out"');
    expect(html).toContain('Loading');
    expect(html).toContain('💰 AR aging snapshot');
  });

  it('shows bucket cards when data arrives', () => {
    const data: ArAgingResponse = {
      ok: true, count: 5, total: 10000,
      buckets: { current: 3000, d1_30: 2000, d31_60: 1500, d61_90: 2000, d90p: 1500 },
      items: [{ tenant_name: 'Acme', contact: 'Customer A', number: 'INV-1', amount_due: 5000, due_date: '2026-07-01', days_overdue: 54 }],
    };
    const html = renderToStaticMarkup(
      <ArAgingPanel data={data} error={null} drillBusy={false} drillLabel={null} drillData={null} drillErr={null} onBucket={() => {}} onCloseDrill={() => {}} />,
    );
    expect(html).toContain('5 open invoice(s)');
    expect(html).toContain('RM 10,000.00');
    expect(html).toContain('Customer A');
    for (const [, label] of AR_BUCKETS) {
      expect(html).toContain(label);
    }
  });

  it('AR bucket definitions match app.html:5258', () => {
    const src = legacy("var defs=[['current'", "var cards='<div");
    for (const [key, label] of AR_BUCKETS) {
      expect(src).toContain("'" + key + "'");
      expect(src).toContain("'" + label + "'");
    }
  });
});

// ═══ 3 · HELPERS ═════════════════════════════════════════════════════════════════════════════════════

describe('relTime', () => {
  it('matches the legacy rel() — app.html:5203', () => {
    const now = Date.now();
    expect(relTime(null)).toBe('never');
    expect(relTime(new Date(now - 30000).toISOString())).toMatch(/^\d+s ago$/);
    expect(relTime(new Date(now - 120000).toISOString())).toMatch(/^\d+m ago$/);
    expect(relTime(new Date(now - 7200000).toISOString())).toMatch(/^\d+h ago$/);
    expect(relTime(new Date(now - 172800000).toISOString())).toMatch(/^\d+d ago$/);
  });
});
