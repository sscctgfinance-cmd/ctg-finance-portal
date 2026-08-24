// HR OS · Dashboard — the React half of the strangler's ninth screen.
//
// The legacy original is `hrDashboard()` at hros.html:1726 together with the `hrDash*` helper family
// (`hrKfmt` at :1662 through `hrDashExportCsv` at :1760), and it is STILL THERE and still shipping;
// nothing was deleted. Both are reachable side by side (`hros.html#tab=dashboard` and `/hr/dashboard/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. That is what lets
// tests/hr-dashboard.parity.test.tsx render it with `renderToStaticMarkup` and diff the result against
// all FIVE of tests/golden/hr.dashboard.{overview,headcount,payroll,attendance,cost}.html. The loading,
// the period walk and the CSV download live in app/hr/dashboard/page.tsx, on the other side of that line.
//
// ── THE TWO CHART BUILDERS ARE PORTED ARITHMETIC, NOT REWRITTEN ARITHMETIC ────────────────────────
// `hrDashLine` (hros.html:1678) and `hrDashBars` (:1674) emit coordinates and percentages COMPUTED FROM
// THE DATA. `width:97.31958762886599%` and `d="M42.0 15.5 L142.8 15.5 …"` are in the goldens verbatim,
// so a "tidier" `Math.round`, a different `toFixed` or an off-by-one in the padding is a silent visual
// lie that the comparison does not absorb — and it is the reason every number below is spelled the way
// the legacy spells it, including `pt+(h-pt-pb)*gi/3` written out rather than folded into a constant.
// Every style value is a STRING, never a number: React appends `px` to a numeric `width` and renders
// `opacity: .10` as `0.1`, both of which would diff against the golden's own spelling.
//
// NOT covered by any golden, and mirrored from the legacy source anyway (see CLAUDE.md's rule on
// branches a golden does not hold):
//   • the loading panel (`HR_DASH.loading || !d`, hros.html:1735). All five goldens were captured with
//     `HR_DASH.data` loaded, so the spinner never appears in one. Leaving it out would make the route's
//     first paint a blank screen.
//   • the "No data" / "No employees" / "None 🎉" empty branches of the five table and chart helpers.
//     The fixture fills every list.
//   • `hrDashExportCsv()` (hros.html:1760) builds a Blob and clicks an <a> — a download side effect with
//     no markup at all. It is covered by the handler-parity assertion, not by a golden, and the CSV
//     itself is built in the route.

import type { CSSProperties, ReactNode } from 'react';

/** `M` — hros.html:1268. */
function M(n: number): string {
  return 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** `HR_MONTHS` — hros.html:1445. Read only by the period-label fallback. */
const HR_MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

export type DashPage = 'overview' | 'headcount' | 'payroll' | 'attendance' | 'cost';

/** One `{label,value}` row of a bar chart or a ranking table. */
export interface Cat { label: string; value: number }

/** One point of a trend line. The keys read out of it are named by the caller (`gross`, `net`, `value`). */
export interface TrendRow { label: string; [k: string]: string | number }

export interface Insight {
  title: string;
  severity: string;
  description: string;
  suggested_action: string;
}

/** The `hr_dashboard` response's `data`, as the legacy screen consumes it. */
export interface DashData {
  period?: { label?: string } | null;
  overview: Record<string, number>;
  headcount: {
    total: number; active: number; inactive: number; new_hires: number; resigned: number;
    trend: TrendRow[]; by_dept: Cat[]; by_position: Cat[]; by_type: Cat[];
  };
  payroll: {
    gross: number; net: number; basic: number; allowance: number; claim: number; bonus: number;
    epf_ee: number; epf_er: number; socso_ee: number; socso_er: number; eis_ee: number; eis_er: number; pcb: number;
    variance: { pct: number; delta: number };
    trend: TrendRow[];
    by_dept: { label: string; cost: number }[];
    by_employee: { label: string; gross: number; net: number; cost: number }[];
  };
  attendance: {
    attendance_rate: number; late_rate: number; absenteeism_rate: number;
    missing_clock: number; ot_hours: number; ot_cost: number;
    trend: TrendRow[]; by_dept: Cat[]; late_rank: Cat[]; absence_rank: Cat[];
  };
  cost: {
    total_hr_cost: number; salary_cost: number; epf_er: number; socso_er: number; eis_er: number;
    claim_cost: number; ot_cost: number; cost_per_employee: number;
    variance: { pct: number; delta: number };
    trend: TrendRow[]; by_dept: Cat[]; by_employee: Cat[];
  };
  insights: Insight[];
}

/** `HR.data.employees` — the ONLY thing on this screen that is not in the `hr_dashboard` response.
    `hrDashEmpTable()` (hros.html:1695) reads the bootstrap's employee master directly; here it is a
    prop, because reading a module global is the thing that would stop this being a pure function. */
export interface DashEmployee {
  emp_no?: string | null;
  name?: string | null;
  dept?: string | null;
  position?: string | null;
  employment_type?: string | null;
  basic_salary?: number | null;
  status?: string | null;
}

export interface HrDashboardProps {
  /** null while `hrDashLoad()` is in flight — the spinner branch. */
  data: DashData | null;
  loading: boolean;
  page: DashPage;
  employees: DashEmployee[];
  /** `hrCompanyName()` — hros.html:4445. Chrome, so it is passed in rather than resolved here. */
  companyName: string;
  /** `HR_DASH.month` / `HR_DASH.year` — only read for the period label's fallback. */
  month: number;
  year: number;
  onSetPage: (p: DashPage) => void;
  onStep: (delta: number) => void;
  onRefresh: () => void;
  onExportCsv: () => void;
  /** `window.print()` in the legacy inline handler; a prop so the component never touches `window`. */
  onPrint: () => void;
}

// ── the small formatters ───────────────────────────────────────────────────────────────────────────

/** `hrKfmt` — hros.html:1662. Only the y-axis labels of hrDashLine use it. */
function hrKfmt(v: number): string {
  v = Number(v) || 0;
  const a = Math.abs(v);
  if (a >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (a >= 1000) return (v / 1000).toFixed(0) + 'k';
  return (Math.round(v * 10) / 10).toString();
}

export interface Delta { pct: number; goodUp: boolean | null }

/** `hrTrendDelta` — hros.html:1666. null when there is no previous point or it was zero. */
function hrTrendDelta(trend: TrendRow[] | undefined, key: string, goodUp: boolean | null): Delta | null {
  if (!trend || trend.length < 2) return null;
  const a = Number(trend[trend.length - 1][key]) || 0;
  const b = Number(trend[trend.length - 2][key]) || 0;
  if (!b) return null;
  return { pct: Math.round((a - b) / b * 1000) / 10, goodUp };
}

// ── hrDCard / hrCardGrid / hrPanel — hros.html:1667-1673 ───────────────────────────────────────────

const CARD: CSSProperties = { padding: '13px 14px', margin: '0' };
const CARD_TOP: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' };
const CARD_LABEL: CSSProperties = { fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.03em', lineHeight: '1.35', paddingTop: '4px' };
const CARD_ICO: CSSProperties = {
  fontSize: '13.5px', width: '26px', height: '26px', borderRadius: '8px', background: 'rgba(255,255,255,.05)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0',
};
const CARD_VALROW: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: '7px', marginTop: '5px', flexWrap: 'wrap' };
const CARD_SUB: CSSProperties = { fontSize: '10px', marginTop: '2px' };

export interface CardOpt { color?: string; icon?: string; delta?: Delta | null; sub?: string }

export function hrDCard(label: string, value: ReactNode, opt: CardOpt = {}) {
  let tr: ReactNode = null;
  if (opt.delta) {
    const dd = opt.delta, up = dd.pct >= 0;
    const good = (dd.goodUp == null) ? null : (up === !!dd.goodUp);
    const col = (good == null) ? 'var(--text-soft)' : (good ? 'var(--green-soft)' : 'var(--coral-soft)');
    tr = (
      <span style={{ fontSize: '10.5px', fontWeight: '700', color: col, whiteSpace: 'nowrap' }}>
        {(up ? '▲' : '▼') + ' ' + Math.abs(dd.pct) + '%'}
      </span>
    );
  }
  return (
    <div className="panel" style={CARD}>
      <div style={CARD_TOP}>
        <div className="muted" style={CARD_LABEL}>{label}</div>
        {opt.icon ? <span style={CARD_ICO}>{opt.icon}</span> : null}
      </div>
      <div style={CARD_VALROW}>
        <span style={{ fontSize: '19px', fontWeight: '700', color: opt.color || 'var(--text)' }}>{value}</span>
        {tr}
      </div>
      {opt.sub ? <div className="muted" style={CARD_SUB}>{opt.sub}</div> : null}
    </div>
  );
}

export function hrCardGrid(cards: ReactNode[]) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(148px,1fr))', gap: '10px', marginBottom: '15px' }}>
      {cards.map((c, i) => <Frag key={i}>{c}</Frag>)}
    </div>
  );
}

export function hrPanel(title: ReactNode, inner: ReactNode) {
  return (
    <div className="panel">
      <div className="panel-hd"><h3>{title}</h3></div>
      {inner}
    </div>
  );
}

/** The two-column chart row `hrDashOverview`/`Headcount`/`Payroll`/`Attendance`/`Cost` all open with. */
function ChartRow({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>{children}</div>;
}

/** A keyed pass-through, so a list of already-built nodes can be spread without React inventing keys. */
function Frag({ children }: { children: ReactNode }) { return <>{children}</>; }

// ── hrDashBars — hros.html:1674 ───────────────────────────────────────────────────────────────────

const BARS: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '6px', padding: '2px 0' };
const BAR_ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' };
const BAR_LABEL: CSSProperties = { width: '96px', textAlign: 'right', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const BAR_TRACK: CSSProperties = { flex: '1', background: 'var(--panel-2)', borderRadius: '5px', height: '15px' };
const BAR_VALUE: CSSProperties = { width: '80px', textAlign: 'right', fontWeight: '600' };

export function hrDashBars(items: Cat[] | undefined, opt: { color?: string; fmt?: (v: number) => string } = {}) {
  if (!items || !items.length) {
    return <div className="muted" style={{ padding: '14px', fontSize: '12px', textAlign: 'center' }}>No data</div>;
  }
  const max = Math.max.apply(null, items.map((x) => Number(x.value) || 0).concat([1]));
  const col = opt.color || 'var(--coral)';
  const fmt = opt.fmt || ((v: number) => String(v));
  return (
    <div style={BARS}>
      {items.map((x, i) => {
        // The legacy `Math.max(2, …)` floor: a zero-value row still shows a 2% sliver rather than nothing.
        const pct = Math.max(2, (Number(x.value) || 0) / max * 100);
        return (
          <div key={i} style={BAR_ROW}>
            <div style={BAR_LABEL} title={x.label}>{x.label}</div>
            <div style={BAR_TRACK}>
              <div style={{ width: pct + '%', height: '100%', background: col, borderRadius: '5px', opacity: '.85' }}></div>
            </div>
            <div style={BAR_VALUE}>{fmt(x.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── hrDashLine — hros.html:1678 ───────────────────────────────────────────────────────────────────

export interface LineKey { k: string; color: string; name: string }

/**
 * Ported coordinate for coordinate from the legacy builder. `w/h/pl/pr/pt/pb`, the `xf`/`yf` mappings,
 * the four grid lines and every `.toFixed(1)` are the legacy's own; the goldens hold the resulting
 * numbers verbatim, so this is the one function on the screen where "the same output" means the same
 * arithmetic and not merely the same shape.
 */
export function hrDashLine(rows: TrendRow[] | undefined, keys: LineKey[]) {
  const w = 560, h = 168, pl = 42, pr = 14, pt = 14, pb = 24;
  if (!rows || !rows.length) {
    return <div className="muted" style={{ padding: '20px', fontSize: '12px', textAlign: 'center' }}>No data</div>;
  }
  const all: number[] = [];
  rows.forEach((r) => { keys.forEach((k) => { all.push(Number(r[k.k]) || 0); }); });
  let max = Math.max.apply(null, all.concat([1]));
  let min = Math.min.apply(null, all.concat([0]));
  if (min > 0) min = 0;
  if (max === min) max = min + 1;
  const n = rows.length;
  const xf = (i: number) => pl + (n <= 1 ? (w - pl - pr) / 2 : i * (w - pl - pr) / (n - 1));
  const yf = (v: number) => pt + (h - pt - pb) * (1 - (v - min) / (max - min));

  const grid: ReactNode[] = [];
  for (let gi = 0; gi <= 3; gi++) {
    const yy = pt + (h - pt - pb) * gi / 3, val = max - (max - min) * gi / 3;
    grid.push(
      <Frag key={'g' + gi}>
        <line x1={pl} y1={yy.toFixed(1)} x2={w - pr} y2={yy.toFixed(1)} style={{ stroke: 'var(--border)', strokeWidth: '1' }} />
        <text x={pl - 5} y={(yy + 3).toFixed(1)} textAnchor="end" style={{ fill: 'var(--muted)', fontSize: '9px' }}>{hrKfmt(val)}</text>
      </Frag>,
    );
  }

  const series = keys.map((k, ki) => {
    const line = rows.map((r, i) => (i ? 'L' : 'M') + xf(i).toFixed(1) + ' ' + yf(Number(r[k.k]) || 0).toFixed(1)).join(' ');
    const area = 'M' + xf(0).toFixed(1) + ' ' + yf(min).toFixed(1) + ' ' +
      rows.map((r, i) => 'L' + xf(i).toFixed(1) + ' ' + yf(Number(r[k.k]) || 0).toFixed(1)).join(' ') +
      ' L' + xf(n - 1).toFixed(1) + ' ' + yf(min).toFixed(1) + ' Z';
    return (
      <Frag key={'s' + ki}>
        <path d={area} style={{ fill: k.color, opacity: '.10' }} />
        <path d={line} style={{ fill: 'none', stroke: k.color, strokeWidth: '2' }} />
        {rows.map((r, i) => (
          <circle key={i} cx={xf(i).toFixed(1)} cy={yf(Number(r[k.k]) || 0).toFixed(1)} r="2.6" style={{ fill: k.color }} />
        ))}
      </Frag>
    );
  });

  const xl = rows.map((r, i) => (
    <text key={i} x={xf(i).toFixed(1)} y={h - 7} textAnchor="middle" style={{ fill: 'var(--muted)', fontSize: '9px' }}>{r.label}</text>
  ));

  return (
    <>
      <svg viewBox={'0 0 ' + w + ' ' + h} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {grid}{series}{xl}
      </svg>
      {keys.length > 1 ? (
        <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', marginTop: '2px', fontSize: '11px' }}>
          {keys.map((k, i) => (
            <span className="muted" key={i}>
              <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: k.color, verticalAlign: 'middle', marginRight: '4px' }}></span>
              {k.name}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

// ── hrDashInsights — hros.html:1691 ───────────────────────────────────────────────────────────────

const SEV: Record<string, string> = { high: 'var(--coral)', medium: 'var(--amber)', low: 'var(--sky-soft)' };

function hrDashInsights(list: Insight[] | undefined) {
  if (!list || !list.length) {
    return hrPanel('💡 Insights',
      <div className="muted" style={{ padding: '14px', fontSize: '12.5px' }}>
        No anomalies detected for this period — all metrics within normal range. ✓
      </div>);
  }
  return hrPanel('💡 Insights (' + list.length + ')', list.map((x, i) => {
    const c = SEV[x.severity] || 'var(--muted)';
    return (
      <div key={i} style={{ borderLeft: '3px solid ' + c, background: 'var(--panel-2)', borderRadius: '0 8px 8px 0', padding: '9px 12px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: '700', fontSize: '13px' }}>{x.title}</span>
          <span className="pill" style={{ fontSize: '9px', color: c, textTransform: 'uppercase' }}>{x.severity}</span>
        </div>
        <div style={{ fontSize: '12px', marginTop: '3px' }}>{x.description}</div>
        <div className="muted" style={{ fontSize: '11px', marginTop: '4px' }}>{'→ ' + x.suggested_action}</div>
      </div>
    );
  }));
}

// ── the four tables — hros.html:1695-1702 ─────────────────────────────────────────────────────────

function Wrap({ children }: { children: ReactNode }) {
  return <div className="tbl-wrap"><table className="bigtable">{children}</table></div>;
}

/** `hrDashEmpTable` — reads the employee master, not the dashboard response. */
function hrDashEmpTable(e: DashEmployee[]) {
  if (!e.length) return <div className="muted" style={{ padding: '14px' }}>No employees</div>;
  return (
    <Wrap>
      <thead><tr>
        <th>No</th><th>Name</th><th>Dept</th><th>Position</th><th>Type</th><th className="amt">Basic</th><th>Status</th>
      </tr></thead>
      <tbody>
        {e.map((x, i) => (
          <tr key={i}>
            <td><b>{x.emp_no || ''}</b></td>
            <td>{x.name || ''}</td>
            <td className="muted">{x.dept || ''}</td>
            <td className="muted">{x.position || ''}</td>
            <td className="muted">{x.employment_type || 'Full-time'}</td>
            <td className="amt">{M(x.basic_salary as number)}</td>
            <td><span className="pill" style={{ fontSize: '10px' }}>{x.status || ''}</span></td>
          </tr>
        ))}
      </tbody>
    </Wrap>
  );
}

function hrDashPayEmpTable(list: DashData['payroll']['by_employee']) {
  if (!list || !list.length) return <div className="muted" style={{ padding: '14px' }}>No finalised payroll for this month</div>;
  return (
    <Wrap>
      <thead><tr><th>Employee</th><th className="amt">Gross</th><th className="amt">Net</th><th className="amt">Employer cost</th></tr></thead>
      <tbody>
        {list.map((x, i) => (
          <tr key={i}>
            <td>{x.label}</td>
            <td className="amt">{M(x.gross)}</td>
            <td className="amt">{M(x.net)}</td>
            <td className="amt">{M(x.cost)}</td>
          </tr>
        ))}
      </tbody>
    </Wrap>
  );
}

function hrDashValTable(list: Cat[], hd: string) {
  if (!list || !list.length) return <div className="muted" style={{ padding: '14px' }}>No data</div>;
  return (
    <Wrap>
      <thead><tr><th>Employee</th><th className="amt">{hd}</th></tr></thead>
      <tbody>{list.map((x, i) => <tr key={i}><td>{x.label}</td><td className="amt">{M(x.value)}</td></tr>)}</tbody>
    </Wrap>
  );
}

function hrDashRankTable(list: Cat[], hd: string) {
  if (!list || !list.length) return <div className="muted" style={{ padding: '14px', fontSize: '12px' }}>None 🎉</div>;
  return (
    <Wrap>
      <thead><tr><th>#</th><th>Employee</th><th className="amt">{hd}</th></tr></thead>
      <tbody>
        {list.map((x, i) => (
          <tr key={i}><td className="muted">{i + 1}</td><td>{x.label}</td><td className="amt">{x.value}</td></tr>
        ))}
      </tbody>
    </Wrap>
  );
}

// ── the five sub-views — hros.html:1703-1725 ──────────────────────────────────────────────────────

function hrDashOverview(d: DashData) {
  const o = d.overview;
  const gD = hrTrendDelta(d.payroll.trend, 'gross', null), nD = hrTrendDelta(d.payroll.trend, 'net', null);
  const cD = hrTrendDelta(d.cost.trend, 'value', false), aD = hrTrendDelta(d.attendance.trend, 'value', true);
  return (
    <>
      {hrCardGrid([
        hrDCard('Total Employees', o.total_employees, { color: 'var(--sky-soft)', icon: '👥' }),
        hrDCard('Active Employees', o.active_employees, { color: 'var(--green-soft)', icon: '✅' }),
        hrDCard('New Hires (mo)', o.new_hires, { icon: '➕' }),
        hrDCard('Resigned (mo)', o.resigned, { color: o.resigned > 0 ? 'var(--coral)' : 'var(--text)', icon: '🚪' }),
        hrDCard('Monthly Gross', M(o.gross), { color: 'var(--sky-soft)', icon: '💵', delta: gD }),
        hrDCard('Monthly Net', M(o.net), { color: 'var(--green-soft)', icon: '💰', delta: nD }),
        hrDCard('Employer Statutory', M(o.employer_statutory), { icon: '🏛️' }),
        hrDCard('Total HR Cost', M(o.total_hr_cost), { color: 'var(--coral-soft)', icon: '📊', delta: cD }),
        hrDCard('Attendance Rate', o.attendance_rate + '%', { color: 'var(--green-soft)', icon: '🕐', delta: aD }),
        hrDCard('Late Rate', o.late_rate + '%', { color: o.late_rate > 15 ? 'var(--amber)' : 'var(--text)', icon: '⏰' }),
        hrDCard('Absenteeism', o.absenteeism_rate + '%', { color: o.absenteeism_rate > 10 ? 'var(--coral)' : 'var(--text)', icon: '🚫' }),
        hrDCard('OT Cost', M(o.ot_cost), { icon: '⏱️' }),
      ])}
      <ChartRow>
        {hrPanel('📈 Payroll trend (6 mo)', hrDashLine(d.payroll.trend, [
          { k: 'gross', color: 'var(--sky-soft)', name: 'Gross' }, { k: 'net', color: 'var(--green-soft)', name: 'Net' }]))}
        {hrPanel('🏢 Headcount by department', hrDashBars(d.headcount.by_dept, { color: 'var(--coral)' }))}
      </ChartRow>
      {hrDashInsights(d.insights)}
    </>
  );
}

function hrDashHeadcount(d: DashData, employees: DashEmployee[]) {
  const h = d.headcount;
  return (
    <>
      {hrCardGrid([
        hrDCard('Total', h.total, { icon: '👥' }),
        hrDCard('Active', h.active, { color: 'var(--green-soft)', icon: '✅' }),
        hrDCard('Inactive', h.inactive, { icon: '💤' }),
        hrDCard('New Hires', h.new_hires, { icon: '➕' }),
        hrDCard('Resigned', h.resigned, { color: h.resigned > 0 ? 'var(--coral)' : 'var(--text)', icon: '🚪' }),
      ])}
      <ChartRow>
        {hrPanel('Monthly headcount trend', hrDashLine(h.trend, [{ k: 'value', color: 'var(--sky-soft)', name: 'Headcount' }]))}
        {hrPanel('By department', hrDashBars(h.by_dept, { color: 'var(--coral)' }))}
        {hrPanel('By position', hrDashBars(h.by_position, { color: 'var(--sky-soft)' }))}
        {hrPanel('By employment type', hrDashBars(h.by_type, { color: 'var(--green-soft)' }))}
      </ChartRow>
      {hrPanel('Employees', hrDashEmpTable(employees))}
      {hrDashInsights(d.insights)}
    </>
  );
}

function hrDashPayroll(d: DashData) {
  const p = d.payroll, vp = p.variance.pct, vc = vp > 0 ? 'var(--coral)' : 'var(--green-soft)';
  const gD = hrTrendDelta(p.trend, 'gross', null), nD = hrTrendDelta(p.trend, 'net', null);
  return (
    <>
      {hrCardGrid([
        hrDCard('Gross', M(p.gross), { color: 'var(--sky-soft)', icon: '💵', delta: gD }),
        hrDCard('Net', M(p.net), { color: 'var(--green-soft)', icon: '💰', delta: nD }),
        hrDCard('Basic', M(p.basic), { icon: '🧾' }),
        hrDCard('Allowance', M(p.allowance), { icon: '➕' }),
        hrDCard('Claim', M(p.claim), { icon: '🧾' }),
        hrDCard('Bonus / Comm', M(p.bonus), { icon: '🎁' }),
        hrDCard('EPF EE', M(p.epf_ee), { icon: '🏦' }),
        hrDCard('EPF ER', M(p.epf_er), { icon: '🏦' }),
        hrDCard('SOCSO EE', M(p.socso_ee), { icon: '🛡️' }),
        hrDCard('SOCSO ER', M(p.socso_er), { icon: '🛡️' }),
        hrDCard('EIS EE', M(p.eis_ee), { icon: '🧯' }),
        hrDCard('EIS ER', M(p.eis_er), { icon: '🧯' }),
        hrDCard('PCB', M(p.pcb), { icon: '🧮' }),
        hrDCard('vs Last Month', (vp > 0 ? '+' : '') + vp + '%', { color: vc, icon: '📈', sub: 'Δ ' + M(p.variance.delta) }),
      ])}
      <ChartRow>
        {hrPanel('Payroll trend (Gross vs Net)', hrDashLine(p.trend, [
          { k: 'gross', color: 'var(--sky-soft)', name: 'Gross' }, { k: 'net', color: 'var(--green-soft)', name: 'Net' }]))}
        {hrPanel('Payroll cost by department', hrDashBars(p.by_dept.map((x) => ({ label: x.label, value: x.cost })), { color: 'var(--coral)', fmt: M }))}
      </ChartRow>
      {hrPanel('Payroll by employee', hrDashPayEmpTable(p.by_employee))}
      {hrDashInsights(d.insights)}
    </>
  );
}

function hrDashAttendance(d: DashData) {
  const a = d.attendance;
  const aD = hrTrendDelta(a.trend, 'value', true);
  return (
    <>
      {hrCardGrid([
        hrDCard('Attendance Rate', a.attendance_rate + '%', { color: 'var(--green-soft)', icon: '🕐', delta: aD }),
        hrDCard('Late Rate', a.late_rate + '%', { color: a.late_rate > 15 ? 'var(--amber)' : 'var(--text)', icon: '⏰' }),
        hrDCard('Absenteeism', a.absenteeism_rate + '%', { color: a.absenteeism_rate > 10 ? 'var(--coral)' : 'var(--text)', icon: '🚫' }),
        hrDCard('Missing Clock In/Out', a.missing_clock, { icon: '❓' }),
        hrDCard('Total OT Hours', a.ot_hours, { icon: '⏱️' }),
        hrDCard('OT Cost', M(a.ot_cost), { icon: '💸' }),
      ])}
      <ChartRow>
        {hrPanel('Monthly attendance trend', hrDashLine(a.trend, [{ k: 'value', color: 'var(--green-soft)', name: 'Attendance %' }]))}
        {hrPanel('Department attendance rate', hrDashBars(a.by_dept, { color: 'var(--sky-soft)', fmt: (v) => v + '%' }))}
        {hrPanel('Late ranking', hrDashRankTable(a.late_rank, 'Late days'))}
        {hrPanel('Absence ranking', hrDashRankTable(a.absence_rank, 'Absent days'))}
      </ChartRow>
      {hrDashInsights(d.insights)}
    </>
  );
}

function hrDashCost(d: DashData) {
  const c = d.cost, vp = c.variance.pct, vc = vp > 0 ? 'var(--coral)' : 'var(--green-soft)';
  const cD = hrTrendDelta(c.trend, 'value', false);
  return (
    <>
      {hrCardGrid([
        hrDCard('Total HR Cost', M(c.total_hr_cost), { color: 'var(--coral-soft)', icon: '📊', delta: cD }),
        hrDCard('Salary Cost', M(c.salary_cost), { icon: '💵' }),
        hrDCard('Employer EPF', M(c.epf_er), { icon: '🏦' }),
        hrDCard('Employer SOCSO', M(c.socso_er), { icon: '🛡️' }),
        hrDCard('Employer EIS', M(c.eis_er), { icon: '🧯' }),
        hrDCard('Claim Cost', M(c.claim_cost), { icon: '🧾' }),
        hrDCard('OT Cost', M(c.ot_cost), { icon: '⏱️' }),
        hrDCard('Cost / Employee', M(c.cost_per_employee), { color: 'var(--sky-soft)', icon: '👤' }),
        hrDCard('vs Last Month', (vp > 0 ? '+' : '') + vp + '%', { color: vc, icon: '📈', sub: 'Δ ' + M(c.variance.delta) }),
      ])}
      <ChartRow>
        {hrPanel('Monthly cost trend', hrDashLine(c.trend, [{ k: 'value', color: 'var(--coral)', name: 'Employer cost' }]))}
        {hrPanel('Cost by department', hrDashBars(c.by_dept, { color: 'var(--coral)', fmt: M }))}
      </ChartRow>
      {hrPanel('Cost by employee', hrDashValTable(c.by_employee, 'Employer cost'))}
      {hrDashInsights(d.insights)}
    </>
  );
}

// ── the screen — hros.html:1726 ───────────────────────────────────────────────────────────────────

const SUBNAV: [DashPage, string][] = [
  ['overview', '📋 Overview'], ['headcount', '👥 Headcount'], ['payroll', '💰 Payroll'],
  ['attendance', '🕐 Attendance'], ['cost', '💵 Cost'],
];

export default function HrDashboard(p: HrDashboardProps) {
  const d = p.data;
  const perLabel = (d && d.period && d.period.label) || ((HR_MONTHS[p.month] || p.month) + ' ' + p.year);

  let content: ReactNode;
  if (p.loading || !d) {
    // Not in any golden — all five were captured with the data loaded. Mirrored from hros.html:1735
    // so the route's first paint is the legacy screen's first paint and not a blank page.
    content = (
      <div className="panel" style={{ padding: '44px', textAlign: 'center' }}>
        <span className="spin"></span> <span className="muted">Loading analytics…</span>
      </div>
    );
  } else if (p.page === 'headcount') content = hrDashHeadcount(d, p.employees);
  else if (p.page === 'payroll') content = hrDashPayroll(d);
  else if (p.page === 'attendance') content = hrDashAttendance(d);
  else if (p.page === 'cost') content = hrDashCost(d);
  else content = hrDashOverview(d);

  return (
    <>
      {/* The page head is built by hrRender(), not hrDashboard() — hros.html:1537. Shared chrome, and
          report.md §3.5 keeps it re-implemented per world during the transition. Included because it is
          inside the `#hr` element the golden holds. Its three strings are HR_NAV's dashboard row
          (hros.html:1459). */}
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Insights</div>
          <h2 className="page-title">Dashboard</h2>
          <div className="page-sub">Company-wide people, payroll, attendance &amp; cost analytics</div>
        </div>
        <div className="page-meta">
          <span className="page-chip"><span className="dot"></span>{p.companyName}</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button className="btn xs" onClick={() => p.onStep(-1)}>‹</button>
          <span style={{ fontWeight: '700', fontSize: '14px', minWidth: '130px', textAlign: 'center' }}>{perLabel}</span>
          <button className="btn xs" onClick={() => p.onStep(1)}>›</button>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button className="btn xs" onClick={() => p.onRefresh()}>🔄 Refresh</button>
          <button className="btn xs" onClick={() => p.onExportCsv()}>⬇ Export CSV</button>
          <button className="btn xs" onClick={() => p.onPrint()}>🖨 PDF</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {SUBNAV.map((s) => (
          <button key={s[0]} className={'btn ' + (p.page === s[0] ? 'p ' : '') + 'sm'} onClick={() => p.onSetPage(s[0])}>{s[1]}</button>
        ))}
      </div>

      {content}
    </>
  );
}
