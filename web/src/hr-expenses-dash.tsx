// HR OS · Reimbursement · 📊 Dashboard — `hrRCDash()` (hros.html:2611), migrated.
//
// PURE FUNCTION OF ITS PROPS. The fetch (`hr_rc_dashboard`) lives in app/hr/expenses/page.tsx; this is
// six stat cards, four charts and the alerts panel, and nothing else. Diffed against
// tests/golden/hr.expenses.dash.html by web/tests/hr-expenses-dash.parity.test.tsx.
//
// ── NOTHING IS DERIVED HERE, AND THAT IS THE POINT ──────────────────────────────────────────────
// Ask CLAUDE.md's question — does the server re-derive this figure? — and on this screen the earlier
// question settles it (`finance.cfo`'s rule): nothing LEAVES. The dashboard posts nothing, exports
// nothing and creates nothing. `hr_rc_dashboard` (hr.ts:2665) owns every number on it, INCLUDING the
// rounding: `sumF`/`byKey`/`trend` all end in `Math.round(x*100)/100` server-side. So there is no
// arithmetic to lift and none to fork — a client-side `reduce` over the cards would be a second
// answer to a question the server has already answered, and the one that disagreed would be the one
// on screen.
//
// ── THE CHART BUILDERS ARE IMPORTED, NOT COPIED ─────────────────────────────────────────────────
// `hrDashLine` / `hrDashBars` / `hrDCard` / `hrCardGrid` / `hrPanel` are the SAME functions
// `src/hr-dashboard.tsx` renders the HR dashboard with — they are hros.html's own builders, ported
// coordinate for coordinate and already diffed to the last digit by the five `hr.dashboard.*` goldens.
// hros.html shares them between its two dashboards; so does this. A local copy would be a second set
// of coordinates that nothing keeps in step.
//
// NOT reachable from the golden, mirrored from the legacy source anyway:
//   • the loading panel (`!RC.dash`) — the surface is captured after `hrRCLoadDash()` resolved;
//   • `hrDashBars`' own "No data" branch, for a company with no claims of a given kind.
// The screen's own test drives both.

import { hrCardGrid, hrDCard, hrDashBars, hrDashLine, hrPanel, type Cat, type TrendRow } from './hr-dashboard';

/** `M()` — hros.html:1268. */
const M = (n: number): string =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One row of `data.alerts` — hr.ts:2679. `warnings` is the claim's own stored array. */
export interface RcAlert {
  claim_no?: string | null;
  name?: string | null;
  amount?: number | null;
  warnings?: string[] | null;
}

/** `RC.dash` — the `data` object `hr_rc_dashboard` returns (hr.ts:2691). */
export interface RcDash {
  total_claims: number;
  total_amount: number;
  pending: number;
  approved: number;
  rejected: number;
  paid: number;
  paid_amount: number;
  trend?: TrendRow[];
  by_type?: Cat[];
  by_department?: Cat[];
  by_employee?: Cat[];
  alerts?: RcAlert[];
}

/** The loading body `hrRC()` shows while `RC.dash` is null — hros.html:2612. */
export function DashLoading() {
  return (
    <div className="panel" style={{ padding: '40px', textAlign: 'center' }}>
      <span className="spin"></span> <span className="muted">Loading…</span>
    </div>
  );
}

export default function HrExpensesDash({ dash: d }: { dash: RcDash }) {
  const cards = hrCardGrid([
    hrDCard('Total Claims', d.total_claims, { icon: '🧾' }),
    hrDCard('Total Amount', M(d.total_amount), { color: 'var(--sky-soft)', icon: '💰' }),
    hrDCard('Pending', d.pending, { color: d.pending > 0 ? 'var(--amber)' : 'var(--text)', icon: '⏳' }),
    hrDCard('Approved', d.approved, { color: 'var(--green-soft)', icon: '✅' }),
    hrDCard('Rejected', d.rejected, { color: d.rejected > 0 ? 'var(--coral)' : 'var(--text)', icon: '✖' }),
    hrDCard('Paid', d.paid, { color: 'var(--green-soft)', icon: '💵', sub: M(d.paid_amount) }),
  ]);

  // `.slice(0,10)` on by_employee is the legacy's own cap — a company with 400 staff would otherwise
  // render 400 bars. It is a DISPLAY cap on a server-sorted list, not a filter on a figure.
  const charts = (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
      {hrPanel('Monthly claim trend', hrDashLine(d.trend || [], [{ k: 'value', color: 'var(--coral)', name: 'Claim RM' }]))}
      {hrPanel('By claim type', hrDashBars(d.by_type || [], { color: 'var(--sky-soft)', fmt: M }))}
      {hrPanel('By department', hrDashBars(d.by_department || [], { color: 'var(--coral)', fmt: M }))}
      {hrPanel('By employee', hrDashBars((d.by_employee || []).slice(0, 10), { color: 'var(--green-soft)', fmt: M }))}
    </div>
  );

  const list = d.alerts || [];
  const alerts = list.length
    ? hrPanel('⚠ Abnormal claim alerts (' + list.length + ')', list.map((a, i) => (
      <div key={i} style={{ borderLeft: '3px solid var(--amber)', background: 'var(--panel-2)', borderRadius: '0 8px 8px 0', padding: '8px 12px', marginBottom: '8px' }}>
        {/* Built as ONE string: adjacent `{a} · {b}` JSX expressions emit React's text separators and
            the golden holds a single run of text. hr.dashboard's rule. */}
        <div style={{ fontWeight: 700, fontSize: '12.5px' }}>{(a.claim_no || '') + ' · ' + (a.name || '') + ' · ' + M(Number(a.amount) || 0)}</div>
        {(a.warnings || []).map((w, k) => <div key={k} className="muted" style={{ fontSize: '11.5px' }}>{'• ' + w}</div>)}
      </div>
    )))
    : hrPanel('⚠ Abnormal claim alerts', <div className="muted" style={{ padding: '12px', fontSize: '12.5px' }}>No anomalies flagged ✓</div>);

  return <>{cards}{charts}{alerts}</>;
}
