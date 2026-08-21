'use client';

// 🔔 Alerts — the in-app alert centre behind the Finance top bar's bell.
//
// A port of `computeAlerts()` / `loadNotifs()` / `renderNotifBadge()` / `renderNotifPanel()` /
// `toggleNotif()` / `notifGo()` (app.html:2704-2751), element for element. Until now the React bell was
// an ANCHOR into app.html, so the badge was always empty and the panel did not exist.
//
// ── NOTHING IS LIFTED, AND THE QUESTION THAT DECIDED IT ────────────────────────────────────────────
// CLAUDE.md's rule for a screen with arithmetic on it is to ask what LEAVES the building first. The
// alert centre posts nothing, exports nothing and creates nothing: `computeAlerts()` reads `overview`
// and `pending` — both server-owned — and produces sentences. That is `finance.qinv`'s case, not
// `gateway.js`'s, so the derivation is mirrored here rather than moved into a shared root `.js`.
//
// ── THE FEATURE FILTER IS A PERMISSION BOUNDARY, NOT A TIDY-UP ─────────────────────────────────────
// `loadNotifs()` (app.html:2723-2727) does the same test TWICE: it skips the `overview`/`pending` FETCH
// unless the feature is granted, and then filters the produced alerts by `feats.indexOf(x.tab)>=0`.
// Both halves are ported. Dropping the second would put a supplier's name and a bill's amount in the
// bell for an operator whose permission set hides the Approvals tab — the alert text is the data, not a
// pointer to it — so `alertsFor()` is exported and pinned in both directions.

import type { NavEntry } from './nav';
import { href } from './nav';

/** `SEV_COL` — app.html:2706. The left border of a `.notif-item`. */
export const SEV_COL: Record<string, string> = {
  high: 'var(--red-soft)',
  med: 'var(--amber)',
  low: 'var(--sky-soft)',
};

export interface Alert { sev: 'high' | 'med' | 'low'; t: string; d: string; tab: string }

export interface OverviewLite { companies?: { tenant_name?: string; net_profit?: number | null }[] }
export interface PendingLite { bills?: { contact?: string; total?: number | null }[] }

/** `M(n)` — common.js's money format, as app.html's alert strings use it. */
function M(n: unknown): string {
  const v = Number(n) || 0;
  return 'RM ' + v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * `computeAlerts(ov, pend)` — app.html:2707-2720, rule for rule and in the same order.
 *
 * Four rules, and the order is what the panel shows top to bottom. The duplicate-bill rule is the only
 * `high` one and it is deliberately per-REPEAT, not per-key: two identical bills push one alert, three
 * push two, exactly as the legacy's `seen[k]` does.
 */
export function computeAlerts(ov: OverviewLite | null, pend: PendingLite | null): Alert[] {
  const companies = (ov && ov.companies) || [];
  const bills = (pend && pend.bills) || [];
  const a: Alert[] = [];

  const payDue = bills.reduce((s, b) => s + (Number(b.total) || 0), 0);
  if (bills.length) a.push({ sev: 'med', t: bills.length + ' bill(s) awaiting approval', d: M(payDue) + ' total pending your review', tab: 'approvals' });

  const big = bills.filter((b) => (Number(b.total) || 0) > 5000);
  if (big.length) {
    big.sort((x, y) => (Number(y.total) || 0) - (Number(x.total) || 0));
    a.push({ sev: 'med', t: big.length + ' large bill(s) over RM 5,000', d: 'Largest: ' + (big[0].contact || '?') + ' ' + M(big[0].total), tab: 'approvals' });
  }

  const seen: Record<string, boolean> = {};
  bills.forEach((b) => {
    const k = (b.contact || '') + '|' + (Number(b.total) || 0).toFixed(2);
    if (seen[k]) a.push({ sev: 'high', t: 'Possible duplicate bill', d: (b.contact || '?') + ' ' + M(b.total) + ' appears more than once', tab: 'approvals' });
    seen[k] = true;
  });

  companies.filter((c) => (Number(c.net_profit) || 0) < 0).forEach((c) => {
    a.push({ sev: 'med', t: 'Running at a loss: ' + (c.tenant_name || ''), d: 'Net profit ' + M(c.net_profit) + ' YTD', tab: 'overview' });
  });

  return a;
}

/** `loadNotifs()`'s final filter — app.html:2727. An alert whose tab this login cannot see is dropped. */
export function alertsFor(all: Alert[], features: string[] | null | undefined): Alert[] {
  const f = features || [];
  return all.filter((x) => f.indexOf(x.tab) >= 0);
}

/** `loadNotifs()`'s two conditional fetches — app.html:2724-2725. */
export function alertFeeds(features: string[] | null | undefined): ('overview' | 'pending')[] {
  const f = features || [];
  const out: ('overview' | 'pending')[] = [];
  if (f.indexOf('overview') >= 0) out.push('overview');
  if (f.indexOf('approvals') >= 0) out.push('pending');
  return out;
}

/** `renderNotifBadge()` — app.html:2732-2736. `null` is the hidden badge (`display:none`). */
export function badgeText(n: number): string | null {
  return n > 0 ? (n > 9 ? '9+' : String(n)) : null;
}

/** `notifGo(i)` — app.html:2746. The panel closes, then the alert's own tab opens. */
export function alertHref(tabs: NavEntry[], tab: string): string | null {
  const e = tabs.find((t) => t.id === tab);
  return e ? href(e) : null;
}

export interface AlertsPanelProps {
  open: boolean;
  alerts: Alert[];
  /** Already filtered by `financeNavFor()`, so an alert cannot link to a tab the login cannot open. */
  tabs: NavEntry[];
  onRefresh: () => void;
  onGo: (i: number) => void;
}

/** `renderNotifPanel()` — app.html:2737-2743, plus the `hide` class `toggleNotif()` moves. */
export default function AlertsPanel(p: AlertsPanelProps) {
  return (
    <div className={'notif-panel' + (p.open ? '' : ' hide')} id="notif-panel">
      {p.open ? (
        <>
          <div className="notif-hd"><h4>{'🔔 Alerts' + (p.alerts.length ? ' (' + p.alerts.length + ')' : '')}</h4>
            <button className="btn sm" id="notif-refresh" onClick={p.onRefresh}>↻</button></div>
          {p.alerts.length
            ? p.alerts.map((a, i) => (
              <div key={i} className="notif-item" style={{ borderLeftColor: SEV_COL[a.sev] }} onClick={() => p.onGo(i)}>
                <div className="nt">{a.t}</div><div className="nd">{a.d}</div>
              </div>
            ))
            : <div className="muted" style={{ fontSize: '12.5px', padding: '14px 4px', textAlign: 'center' }}>✓ All clear — nothing needs your attention</div>}
        </>
      ) : null}
    </div>
  );
}
