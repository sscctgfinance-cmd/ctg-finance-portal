// Finance OS · CFO Cockpit — the eighteenth screen out of app.html, and the second largest surface in
// either app.
//
// The legacy original is `renderCFO()` (app.html:1837) with `cfoRender()`, `cfoAnalyticsLoad()`,
// `cfoAnalyticsRender()` and the ten chart builders above them. All of them are STILL THERE and still
// shipping; nothing was deleted. Both are reachable side by side (`app.html#tab=cfo` and `/finance/cfo/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, and NO CLOCK READ (see the YTD
// note below). The two `{api:'group_dashboard'}` / `{api:'fin_analytics'}` loads, the stale-response
// guard and the refresh live in app/finance/cfo/page.tsx, on the other side of that line.
//
// ── THE SHAPE, COUNTED BEFORE ANYTHING WAS WRITTEN ────────────────────────────────────────────────
// TWO golden sections, thirteen blocks in one and eight in the other, ONE mode, no sub-views, no tabs.
//
//   `#cfo` (this file's default export, `FinanceCfo`) — thirteen blocks in `cfoRender()`'s single
//   innerHTML write: the scope line + Refresh button, the P&L KPI row (4 cards), a 12px spacer, the
//   position KPI row (4 cards), a 16px spacer, the analyst-alerts panel (present only when the server
//   sent alerts), Monthly P&L (combo chart + month table), Revenue by company (bars), Revenue structure
//   (stacked), Revenue trend (lines), Expenses by company (bars), Expenses structure (stacked), the
//   company scorecard table, the AR-aging + Top-customers two-column grid, and the empty
//   `#cfo-analytics` div the analytics strip later fills.
//
//   `#cfo-analytics` (`Analytics`) — eight blocks in `cfoAnalyticsRender()`'s single write: the
//   "Financial Analytics" heading strip, DSO/DPO, Customer credit risk (3 cards + table), the 13-week
//   cash-flow forecast, the revenue forecast, vendor spend, intercompany, and the generated-at stamp.
//
// Six states are NOT in either golden and are mirrored here anyway, because leaving them out would wire
// a route to nothing: `renderCFO()`'s spinner panel, its `!r.ok` panel and its `catch` panel
// (`Loading` / `LoadError` / `CrashError`), and `cfoAnalyticsLoad()`'s three of the same shape
// (`AnalyticsLoading` / `AnalyticsError`). The screen's test says so where each is asserted.
//
// ── THE GOLDEN STATE: BOTH SECTIONS ARE LOADED, AND THAT WAS CHECKED, NOT ASSUMED ─────────────────
// CLAUDE.md's intermediate-state trap has now caught three screens (finance.qinv's missing line row,
// finance.users' unhighlighted sub-nav, finance.gateway's unselected provider), so the question was
// asked of both writes here. It comes back CLEAN in both, for two different reasons:
//
//   • `#cfo`: `renderCFO()` writes the spinner panel into `#cfo` and `cfoRender()` OVERWRITES THE SAME
//     id. Last-write-wins is per id, so the spinner is gone from the golden and `#cfo` holds the loaded
//     dashboard — `finance.approvals`' case, not `finance.ctgaccess`'s.
//   • `#cfo-analytics`: `cfoRender()`'s markup contains `<div id="cfo-analytics">`, so the golden's
//     `#cfo` section holds it EMPTY; `cfoAnalyticsLoad()` then writes the spinner into that id and
//     `cfoAnalyticsRender()` overwrites it. Different id from `#cfo`, so both survive as sections — but
//     within `#cfo-analytics` last-write-wins again, so that section too is the loaded state.
//
// After its innerHTML write `cfoRender()` does exactly two things: `loaded.cfo=true` (a no-op in React —
// CLAUDE.md) and `cfoAnalyticsLoad()`. No `appendChild`, no `.value=`, no `classList`, no `.textContent`.
// `cfoAnalyticsRender()` does nothing at all after its write. The screen's test proves both claims by
// reading app.html at run time rather than asserting them from memory.
//
// ── ARITHMETIC: NOTHING WAS LIFTED, AND THAT IS THE ANSWER TO THE STANDARD QUESTION ───────────────
// The question the repo asks is "does the server re-derive this figure?", and the sharper form
// `finance.gateway` added is "is there a second computation anywhere that could disagree and be
// noticed?". For `wht.js`, `o2o.js`, `salesrecon.js` and `gateway.js` the client owned a number that
// LEFT THE BUILDING — a posted invoice line, a CSV imported into a ledger. This screen posts nothing
// and exports nothing. Every authoritative figure arrives from `group_dashboard` / `fin_analytics`
// (finance.ts), which compute the group and per-company revenue, expenses, net profit, AR/AP, working
// capital, DSO/DPO, provisions and the forecast; what the client derives is the margin percentage, the
// MoM percentage, the P&L table's per-row net/margin/MoM and its totals row, the aging/vendor/customer
// bar widths and the chart geometry. Those are display echoes of server-owned rows — `finance.qinv`'s
// case and `finance.calendar`'s, not `finance.o2o`'s.
//
// So the maths is mirrored inline, character for character, and the goldens diff it to the last digit:
// nothing in relax() touches an attribute VALUE, so `d="M54.0 231.6 L…"` and `width:97%` are compared
// exactly (CLAUDE.md's hr.dashboard rule). A coordinate you believe is wrong here is a
// `needs-decision:`, not a fix. The totals the goldens cannot reach — the P&L table footer, the cash-flow
// in/out/net line, the vendor share percentages — are pinned by assertion in the screen's own test
// against inputs chosen so a transcription would differ from a sum.
//
// ── THE YTD YEAR IS A DERIVATION, SO IT IS A PROP ─────────────────────────────────────────────────
// `cfoRender()` reads the clock: `(new Date(Date.now()+8*3600000)).getUTCFullYear()` — the MYT year,
// with the +8h shift done by hand because a UTC-midnight instant would print the previous year for the
// first eight hours of 1 January. That is `hr.yearend`'s case exactly: a component that read the clock
// itself would render "YTD 2026" today and start failing on 1 Jan. `ytdYear(now)` below is that
// derivation as a pure function of a Date it is HANDED — the route hands it the real one, the test hands
// it the harness's fixed instant — so a shifted year diffs instead of hiding somewhere no golden looks.
// And per `finance.calendar`'s finding, the screen's test asserts the IMPLEMENTATION rather than only
// the output: on a machine west of Greenwich, dropping the +8h shift is invisible to every output check
// this fleet can run.
//
// The only other clock read on the screen is the analytics stamp, `new Date(r.generated_at)
// .toLocaleString('en-GB', …)`. That is `hr.clock`'s case, not this one: the instant is DATA, and what
// varies is the zone it is read in. It stays in the component, spelled exactly as the legacy spells it,
// and the screen's test re-applies tests/render_harness.ts's UTC override for the length of the file.

import * as React from 'react';

// ── The permission gate ───────────────────────────────────────────────────────────────────────────

/** `my_perms` — only the two fields `showApp()`'s visibility pass reads. */
export interface Perms { features?: string[]; manage_users?: boolean }

/**
 * `showApp()`'s rule for THIS tab — app.html:1420-1439, read as a whole rather than copied from a
 * neighbour.
 *
 * `cfo` is named in NO branch of that block, so it falls through to the chain's final
 * `else el.classList.toggle('hide', feats.indexOf(t)<0)` at app.html:1439. Its gate is therefore the
 * FEATURE FLAG, not `manage_users` — the same kind as `collections`, `recon`, `qinv`, `approvals`,
 * `o2o` and `close`, and NOT the admin gate its dashboard-category neighbours might suggest. Six screens
 * have now found their gate was not their neighbours', which is why this is transcribed from the block
 * and pinned in both directions in the screen's own test.
 *
 * `renderCFO()` itself has no role check at all, so a port that mirrored only the renderer would serve
 * the whole group's revenue, net profit, working capital, receivables aging, named customers and their
 * credit risk to anyone who typed the URL. The server is the boundary; this is tab visibility.
 */
export function cfoReachable(perms: Perms | null | undefined): boolean {
  const feats = (perms && perms.features) || [];
  return feats.indexOf('cfo') >= 0;
}

/**
 * `cfoRender()`'s `ytdYr` — app.html:1859, as a pure function of the instant it is handed.
 *
 * The `+8*3600000` then `getUTCFullYear()` is the MYT calendar year computed without a timezone
 * database. Do NOT rewrite it with `getFullYear()` or `toLocaleDateString`: `getFullYear()` is the
 * MACHINE's year, which is right in Kuala Lumpur and wrong for an operator anywhere else, and no output
 * assertion running on this fleet (UTC+8) can see the difference — finance.calendar's finding.
 */
export function ytdYear(now: Date): number {
  return new Date(now.getTime() + 8 * 3600000).getUTCFullYear();
}

// ── Shared formatting, copied per screen as every migrated Finance screen copies it ───────────────

/** `M()` — app.html:1256. */
const M = (n: unknown) =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `cfoMk()` — app.html:1683. Compact money for on-chart labels: RM3.6M / RM560k / RM1,200. */
export function cfoMk(v: unknown): string {
  let n = Number(v) || 0;
  const s = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n >= 1e6) return s + 'RM' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return s + 'RM' + Math.round(n / 1e3) + 'k';
  return s + 'RM' + Math.round(n);
}

/** `cfoShortName()` — app.html:1687. */
export function cfoShortName(n: unknown): string {
  return String(n == null ? '' : n).replace(/\s*(SDN\s*BHD|CTG4U)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** `OV_PALETTE` — app.html:2253. The order is the series-to-colour mapping; do not sort it. */
export const OV_PALETTE = ['#e85d3c', '#f5a623', '#3ddc97', '#5b9bd5', '#a479e2', '#f291b3', '#16a766', '#ff7537', '#4a86e8', '#cf8933', '#9aa7b8'];

/** `cfoExpBars()`'s own palette — app.html:1819. Deliberately NOT OV_PALETTE. */
const EXP_PALETTE = ['#E0714E', '#D9564B', '#E8894A', '#C2700A', '#B23C1F', '#CF4A28'];

// ── The two responses, typed by what the renderers actually read ──────────────────────────────────

export interface GroupTotals {
  revenue?: number; expenses?: number; net_profit?: number;
  ar_open?: number; ap_open?: number; working_capital?: number; ar_overdue?: number;
  rev_cur?: number; rev_prev?: number;
}
export interface CompanyRow {
  tenant_id?: string; tenant_name: string;
  revenue?: number; expenses?: number; net_profit?: number;
  rev_cur?: number; rev_prev?: number; exp_cur?: number; exp_prev?: number;
  ar_open?: number; ap_open?: number; working_capital?: number; health?: string;
}
export interface MonthPoint { month: string; revenue?: number; bills?: number }
export interface CompanyMonthly { tenant_id?: string; tenant_name: string; series: MonthPoint[] }
/** `cfoAgingBar()` reads these five keys and no others — app.html:1676. */
export interface Aging { current?: number; d1_30?: number; d31_60?: number; d61_90?: number; d90plus?: number }
/** `cfoRender()` reads `.contact` and `.revenue` — app.html:1917. */
export interface TopCustomer { contact?: string; revenue?: number }
export interface CfoAlert { severity?: string; text?: string }

export interface CfoData {
  scoped_tenant?: string | null;
  period_months?: number;
  group?: GroupTotals;
  companies?: CompanyRow[];
  monthly?: MonthPoint[];
  companies_monthly?: CompanyMonthly[];
  ar_aging?: Aging;
  top_customers?: TopCustomer[];
  alerts?: CfoAlert[];
}

export interface DsoRow { tenant_name: string; dso?: number | null; dpo?: number | null; cash_gap?: number | null }
export interface RiskRow {
  cust?: string; tenant_name?: string;
  ar_open?: number; overdue?: number; worst_days?: number; provision?: number; risk?: number;
}
export interface IcPair {
  creditor?: string; debtor?: string;
  creditor_says_owed?: number; debtor_says_payable?: number; difference?: number;
}
export interface CashWeek { week?: string; week_start?: string; inflow?: number; outflow?: number; net?: number }
export interface VendorRow { vendor?: string; spend?: number; ap_open?: number }
/** `finForecastChart()` reads `.revenue` on history and `.projected` on forecast — app.html:1980. */
export interface ForecastPoint { month: string; revenue?: number; projected?: number }

export interface FinData {
  generated_at?: string | null;
  scoped_tenant?: string | null;
  dso_dpo?: { group?: { dso?: number; dpo?: number; cash_gap?: number | null }; companies?: DsoRow[] };
  customer_risk?: { totals?: { total_ar_open?: number; total_overdue?: number; est_bad_debt?: number }; customers?: RiskRow[] };
  intercompany?: { total_intercompany_open?: number; pairs?: IcPair[] };
  cashflow_13w?: CashWeek[];
  vendor_spend?: { total_spend365?: number; vendors?: VendorRow[] };
  revenue_forecast?: { excluded?: string[]; history?: ForecastPoint[]; forecast?: ForecastPoint[] };
}

// ── The ten chart builders ────────────────────────────────────────────────────────────────────────
//
// Ported COORDINATE FOR COORDINATE from app.html. Every `.toFixed(1)`, every pad, every palette index
// and every `Math.max(0, …)` clamp is the legacy's. Two React spellings would quietly break them and are
// avoided throughout (CLAUDE.md's hr.dashboard rule): a NUMERIC style value (React renders `opacity: .10`
// as `0.1` and appends `px` to a bare `width`), and adjacent `{a} {b}` text expressions. Every style
// value below is a string and every text run is built once in JS.
//
// The legacy writes `fill`, `stroke`, `stroke-width`, `font-size`, `opacity` and `text-anchor` as
// ATTRIBUTES rather than in a `style=`, so they are attributes here too — React passes an attribute
// string through verbatim, which is what keeps `opacity=".5"` from becoming `opacity="0.5"`.

/** `cfoAgingBar()` — app.html:1675. A horizontal stacked bar plus its legend. */
export function AgingBar({ a }: { a: Aging }) {
  const segs: [string, number, string][] = [
    ['Current', Number(a.current) || 0, '#3ddc97'],
    ['1-30d', Number(a.d1_30) || 0, '#f5a623'],
    ['31-60d', Number(a.d31_60) || 0, '#ff7537'],
    ['61-90d', Number(a.d61_90) || 0, '#e85d3c'],
    ['90+d', Number(a.d90plus) || 0, '#c0392b'],
  ];
  const tot = segs.reduce((s, x) => s + x[1], 0) || 1;
  let x = 0;
  const w = 780, h = 30;
  const rects = segs.map((s, i) => {
    const bw = (s[1] / tot) * w;
    const r = (
      <rect key={i} x={x.toFixed(1)} y="0" width={Math.max(0, bw).toFixed(1)} height={h} fill={s[2]}>
        <title>{s[0] + ': ' + M(s[1])}</title>
      </rect>
    );
    x += bw;
    return r;
  });
  return (
    <>
      <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={{ display: 'block', borderRadius: '6px', overflow: 'hidden' }}>{rects}</svg>
      <div style={{ marginTop: '8px' }}>
        {segs.map((s, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginRight: '14px', fontSize: '11.5px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: s[2] }}></span>
            {s[0] + ' '}
            <b style={{ marginLeft: '2px' }}>{M(s[1])}</b>
          </span>
        ))}
      </div>
    </>
  );
}

/** The `<div class="muted">` a chart builder returns instead of an SVG when it has no data. */
function NoData({ text, padding }: { text: string; padding: string }) {
  return <div className="muted" style={{ padding }}>{text}</div>;
}

/** `cfoRevBars()` — app.html:1689. Revenue per company, sorted desc, with MoM. */
export function RevBars({ cos }: { cos: CompanyRow[] }) {
  const data = (cos || [])
    .map((c) => ({ name: c.tenant_name, rev: Number(c.revenue) || 0, cur: Number(c.rev_cur) || 0, prev: Number(c.rev_prev) || 0 }))
    .sort((a, b) => b.rev - a.rev);
  const n = data.length;
  if (!n) return <NoData text="No revenue data." padding="20px" />;
  const w = 780, h = 270, padL = 52, padR = 12, padB = 56, padT = 14;
  const max = Math.max.apply(null, ([1] as number[]).concat(data.map((d) => d.rev)));
  const slot = (w - padL - padR) / n, barW = Math.min(64, slot * 0.56);
  const yat = (v: number) => h - padB - (v / max) * (h - padB - padT);
  return (
    <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={{ display: 'block' }}>
      <Grid3 padL={padL} padR={padR} padT={padT} padB={padB} w={w} h={h} label={(k) => cfoMk(max * (3 - k) / 3)} />
      {data.map((d, i) => {
        const cx = padL + slot * i + slot / 2, x = cx - barW / 2, y = yat(d.rev), bh = (h - padB) - y;
        const col = OV_PALETTE[i % OV_PALETTE.length];
        const mom = d.prev > 0 ? Math.round((d.cur - d.prev) / d.prev * 100) : null;
        const momTxt = mom === null ? '' : (mom >= 0 ? ('▲' + mom + '%') : ('▼' + Math.abs(mom) + '%'));
        const momCol = mom === null ? 'var(--muted)' : (mom >= 0 ? '#3ddc97' : '#e85d3c');
        return (
          <React.Fragment key={i}>
            <rect x={x.toFixed(1)} y={y.toFixed(1)} width={barW.toFixed(1)} height={Math.max(0, bh).toFixed(1)} rx="3" fill={col}>
              <title>{d.name + ' — ' + M(d.rev)}</title>
            </rect>
            <text x={cx.toFixed(1)} y={(y - 5).toFixed(1)} textAnchor="middle" fontSize="10.5" fontWeight="800" fill="var(--text)">{cfoMk(d.rev)}</text>
            <text x={cx.toFixed(1)} y={h - padB + 16} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{cfoShortName(d.name).slice(0, 13)}</text>
            {momTxt ? <text x={cx.toFixed(1)} y={h - padB + 30} textAnchor="middle" fontSize="9" fill={momCol}>{momTxt}</text> : null}
          </React.Fragment>
        );
      })}
    </svg>
  );
}

/** `cfoExpBars()` — app.html:1812. Same shape as RevBars, its own palette, and MoM inverted. */
export function ExpBars({ cos }: { cos: CompanyRow[] }) {
  const data = (cos || [])
    .map((c) => ({ name: c.tenant_name, exp: Number(c.expenses) || 0, cur: Number(c.exp_cur) || 0, prev: Number(c.exp_prev) || 0 }))
    .sort((a, b) => b.exp - a.exp);
  const n = data.length;
  if (!n) return <NoData text="No expense data." padding="20px" />;
  const w = 780, h = 270, padL = 52, padR = 12, padB = 56, padT = 14;
  const max = Math.max.apply(null, ([1] as number[]).concat(data.map((d) => d.exp)));
  const slot = (w - padL - padR) / n, barW = Math.min(64, slot * 0.56);
  const yat = (v: number) => h - padB - (v / max) * (h - padB - padT);
  return (
    <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={{ display: 'block' }}>
      <Grid3 padL={padL} padR={padR} padT={padT} padB={padB} w={w} h={h} label={(k) => cfoMk(max * (3 - k) / 3)} />
      {data.map((d, i) => {
        const cx = padL + slot * i + slot / 2, x = cx - barW / 2, y = yat(d.exp), bh = (h - padB) - y;
        const col = EXP_PALETTE[i % EXP_PALETTE.length];
        const mom = d.prev > 0 ? Math.round((d.cur - d.prev) / d.prev * 100) : null;
        const momTxt = mom === null ? '' : (mom >= 0 ? ('▲' + mom + '%') : ('▼' + Math.abs(mom) + '%'));
        // Up is WORSE for spend, so the colours are the opposite way round from RevBars. Not a typo.
        const momCol = mom === null ? 'var(--muted)' : (mom >= 0 ? '#e85d3c' : '#3ddc97');
        return (
          <React.Fragment key={i}>
            <rect x={x.toFixed(1)} y={y.toFixed(1)} width={barW.toFixed(1)} height={Math.max(0, bh).toFixed(1)} rx="3" fill={col}>
              <title>{d.name + ' — ' + M(d.exp)}</title>
            </rect>
            <text x={cx.toFixed(1)} y={(y - 5).toFixed(1)} textAnchor="middle" fontSize="10.5" fontWeight="800" fill="var(--text)">{cfoMk(d.exp)}</text>
            <text x={cx.toFixed(1)} y={h - padB + 16} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{cfoShortName(d.name).slice(0, 13)}</text>
            {momTxt ? <text x={cx.toFixed(1)} y={h - padB + 30} textAnchor="middle" fontSize="9" fill={momCol}>{momTxt}</text> : null}
          </React.Fragment>
        );
      })}
    </svg>
  );
}

/**
 * The four-line gridded background `cfoRevBars`, `cfoExpBars`, `cfoRevLines` and `cfoStack` each write
 * with the same `for(var k=0;k<=3;k++)` loop. Extracted only because the four loops are byte-identical
 * apart from their label expression, which is the parameter — this is NOT a shared Finance abstraction,
 * it is one repeated literal inside one screen file.
 */
function Grid3(p: { padL: number; padR: number; padT: number; padB: number; w: number; h: number; label: (k: number) => string }) {
  const out = [];
  for (let k = 0; k <= 3; k++) {
    const gy = p.padT + (k / 3) * (p.h - p.padB - p.padT);
    out.push(
      <React.Fragment key={k}>
        <line x1={p.padL} y1={gy.toFixed(1)} x2={p.w - p.padR} y2={gy.toFixed(1)} stroke="var(--border)" strokeWidth="1" opacity=".5" />
        <text x={p.padL - 8} y={(gy + 3).toFixed(1)} textAnchor="end" fontSize="9" fill="var(--muted)">{p.label(k)}</text>
      </React.Fragment>,
    );
  }
  return <>{out}</>;
}

/** `cfoRevLines()` — app.html:1713. One line per company plus a legend. */
export function RevLines({ cm }: { cm: CompanyMonthly[] }) {
  const series = (cm || []).filter((s) => s.series && s.series.length);
  if (!series.length) return <NoData text="No monthly data." padding="20px" />;
  const months = series[0].series.map((p) => p.month), n = months.length;
  const w = 780, h = 250, padL = 48, padR = 12, padB = 30, padT = 12;
  let max = 1;
  series.forEach((s) => s.series.forEach((p) => { const v = Number(p.revenue) || 0; if (v > max) max = v; }));
  const xat = (i: number) => padL + (n <= 1 ? (w - padL - padR) / 2 : i * (w - padL - padR) / (n - 1));
  const yat = (v: number) => h - padB - (v / max) * (h - padB - padT);
  return (
    <>
      <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={{ display: 'block' }}>
        <Grid3 padL={padL} padR={padR} padT={padT} padB={padB} w={w} h={h} label={(k) => cfoMk(max * (3 - k) / 3)} />
        {series.map((s, idx) => {
          const col = OV_PALETTE[idx % OV_PALETTE.length];
          const d = s.series.map((p, i) => (i ? 'L' : 'M') + xat(i).toFixed(1) + ' ' + yat(Number(p.revenue) || 0).toFixed(1)).join(' ');
          return (
            <React.Fragment key={idx}>
              <path d={d} fill="none" stroke={col} strokeWidth="2" />
              {s.series.map((p, i) => (
                <circle key={i} cx={xat(i).toFixed(1)} cy={yat(Number(p.revenue) || 0).toFixed(1)} r="2" fill={col}>
                  <title>{cfoShortName(s.tenant_name) + ' ' + p.month + ' ' + M(p.revenue)}</title>
                </circle>
              ))}
            </React.Fragment>
          );
        })}
        {months.map((m, i) => (n > 8 && i % 2
          ? null
          : <text key={i} x={xat(i).toFixed(1)} y={h - padB + 15} textAnchor="middle" fontSize="9" fill="var(--muted)">{m.slice(5)}</text>))}
      </svg>
      <div style={{ marginTop: '8px' }}>
        {series.map((s, idx) => (
          <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginRight: '14px', fontSize: '11px' }}>
            <span style={{ width: '12px', height: '3px', borderRadius: '2px', background: OV_PALETTE[idx % OV_PALETTE.length] }}></span>
            {cfoShortName(s.tenant_name)}
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * `cfoStack()` — app.html:1785. Each company's monthly value stacked into the group total.
 *
 * `cum` is MUTATED across the map, exactly as the legacy loop mutates it: band k's lower edge is the
 * running total of bands 0..k-1. A port that recomputed the running total per band, or that copied the
 * array, would draw overlapping bands whose total height was no longer the group figure.
 */
export function Stack({ cm, dataKey }: { cm: CompanyMonthly[]; dataKey: 'revenue' | 'bills' }) {
  const series = (cm || []).filter((s) => s.series && s.series.length);
  if (!series.length) return <NoData text="No monthly data." padding="20px" />;
  const months = series[0].series.map((p) => p.month), n = months.length;
  const w = 820, h = 250, padL = 52, padR = 14, padB = 30, padT = 14;
  const totals = months.map((_x, i) => series.reduce((s, se) => s + (Number(se.series[i] && se.series[i][dataKey]) || 0), 0));
  const max = Math.max.apply(null, ([1] as number[]).concat(totals));
  const xat = (i: number) => padL + (n <= 1 ? (w - padL - padR) / 2 : i * (w - padL - padR) / (n - 1));
  const yat = (v: number) => h - padB - (v / max) * (h - padB - padT);
  let cum = months.map(() => 0);
  const areas = series.map((se, idx) => {
    const col = OV_PALETTE[idx % OV_PALETTE.length];
    const lower = cum.slice();
    const upper = months.map((_x, i) => lower[i] + (Number(se.series[i] && se.series[i][dataKey]) || 0));
    cum = upper.slice();
    let d = 'M' + xat(0).toFixed(1) + ' ' + yat(upper[0]).toFixed(1) + ' ' +
      upper.map((v, i) => 'L' + xat(i).toFixed(1) + ' ' + yat(v).toFixed(1)).join(' ');
    for (let i = n - 1; i >= 0; i--) d += ' L' + xat(i).toFixed(1) + ' ' + yat(lower[i]).toFixed(1);
    return <path key={idx} d={d + ' Z'} fill={col} opacity=".85"><title>{cfoShortName(se.tenant_name)}</title></path>;
  });
  return (
    <>
      <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={{ display: 'block' }}>
        <Grid3 padL={padL} padR={padR} padT={padT} padB={padB} w={w} h={h} label={(k) => cfoMk(max * (3 - k) / 3)} />
        {areas}
        {months.map((m, i) => (n > 8 && i % 2
          ? null
          : <text key={i} x={xat(i).toFixed(1)} y={h - padB + 15} textAnchor="middle" fontSize="9" fill="var(--muted)">{m.slice(5)}</text>))}
      </svg>
      <div style={{ marginTop: '8px' }}>
        {series.map((se, idx) => (
          <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginRight: '14px', fontSize: '11px' }}>
            <span style={{ width: '11px', height: '11px', borderRadius: '2px', background: OV_PALETTE[idx % OV_PALETTE.length] }}></span>
            {cfoShortName(se.tenant_name)}
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * `cfoPnlCombo()` — app.html:1734. Grouped revenue/expense bars plus a net-profit line.
 *
 * The only chart on the screen with a SIGNED axis: `vmin` is clamped to 0 so a profitable period still
 * baselines at zero, and `zeroY` is drawn as its own heavier rule. A loss month's net dot falls below it.
 */
export function PnlCombo({ mon }: { mon: MonthPoint[] }) {
  const n = (mon || []).length;
  if (!n) return <NoData text="No monthly data." padding="20px" />;
  const rev = mon.map((m) => Number(m.revenue) || 0);
  const exp = mon.map((m) => Number(m.bills) || 0);
  const net = mon.map((m) => (Number(m.revenue) || 0) - (Number(m.bills) || 0));
  const w = 820, h = 290, padL = 54, padR = 14, padB = 52, padT = 18;
  const vmax = Math.max.apply(null, ([1] as number[]).concat(rev, exp, net));
  const vmin = Math.min.apply(null, ([0] as number[]).concat(net));
  const span = (vmax - vmin) || 1;
  const yat = (v: number) => padT + (vmax - v) / span * (h - padB - padT);
  const slot = (w - padL - padR) / n, grp = Math.min(46, slot * 0.62), bw = grp / 2, zeroY = yat(0);
  const grid = [];
  for (let k = 0; k <= 4; k++) {
    const gv = vmax - (k / 4) * span, gy = yat(gv);
    grid.push(
      <React.Fragment key={k}>
        <line x1={padL} y1={gy.toFixed(1)} x2={w - padR} y2={gy.toFixed(1)} stroke="var(--border)" strokeWidth="1" opacity=".5" />
        <text x={padL - 8} y={(gy + 3).toFixed(1)} textAnchor="end" fontSize="9" fill="var(--muted)">{cfoMk(gv)}</text>
      </React.Fragment>,
    );
  }
  const netLine = net.map((v, i) => { const cx = padL + slot * i + slot / 2; return (i ? 'L' : 'M') + cx.toFixed(1) + ' ' + yat(v).toFixed(1); }).join(' ');
  return (
    <>
      <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={{ display: 'block' }}>
        {grid}
        <line x1={padL} y1={zeroY.toFixed(1)} x2={w - padR} y2={zeroY.toFixed(1)} stroke="var(--muted)" strokeWidth="1.2" opacity=".55" />
        {mon.map((m, i) => {
          const cx = padL + slot * i + slot / 2, rY = yat(rev[i]), eY = yat(exp[i]);
          return (
            <React.Fragment key={i}>
              <rect x={(cx - bw - 1).toFixed(1)} y={rY.toFixed(1)} width={bw.toFixed(1)} height={Math.max(0, zeroY - rY).toFixed(1)} rx="2" fill="#0E9D67">
                <title>{m.month + ' · revenue ' + M(rev[i])}</title>
              </rect>
              <rect x={(cx + 1).toFixed(1)} y={eY.toFixed(1)} width={bw.toFixed(1)} height={Math.max(0, zeroY - eY).toFixed(1)} rx="2" fill="#E0714E">
                <title>{m.month + ' · expenses ' + M(exp[i])}</title>
              </rect>
            </React.Fragment>
          );
        })}
        <path d={netLine} fill="none" stroke="var(--text)" strokeWidth="2" />
        {net.map((v, i) => {
          const cx = padL + slot * i + slot / 2;
          return (
            <circle key={i} cx={cx.toFixed(1)} cy={yat(v).toFixed(1)} r="2.6" fill="var(--text)" stroke="var(--surface)" strokeWidth="1">
              <title>{mon[i].month + ' · net ' + M(v)}</title>
            </circle>
          );
        })}
        {mon.map((m, i) => {
          if (n > 10 && i % 2) return null;
          const cx = padL + slot * i + slot / 2;
          return <text key={i} x={cx.toFixed(1)} y={h - padB + 16} textAnchor="middle" fontSize="9" fill="var(--muted)">{m.month.slice(2)}</text>;
        })}
      </svg>
      <div style={{ marginTop: '6px', fontSize: '11.5px' }}>
        <span style={{ marginRight: '16px' }}>
          <span style={{ display: 'inline-block', width: '11px', height: '11px', borderRadius: '2px', background: '#0E9D67', verticalAlign: 'middle' }}></span>
          {' Revenue'}
        </span>
        <span style={{ marginRight: '16px' }}>
          <span style={{ display: 'inline-block', width: '11px', height: '11px', borderRadius: '2px', background: '#E0714E', verticalAlign: 'middle' }}></span>
          {' Expenses (bills)'}
        </span>
        <span>
          <span style={{ display: 'inline-block', width: '15px', height: '3px', background: 'var(--text)', verticalAlign: 'middle' }}></span>
          {' Net profit'}
        </span>
      </div>
    </>
  );
}

/**
 * `cfoPnlTable()` — app.html:1761. Month-by-month, MOST RECENT FIRST, plus a totals row.
 *
 * Two things here are computed and not transcribed, and neither golden can see them go wrong on its own:
 * the MoM column compares against the row BEFORE reversal (so it is the previous month, not the row
 * above), and the footer sums the un-reversed rows. Both are pinned by assertion in the screen's test.
 * The last month carries an MTD chip — it is a partial month, which is why its row is dimmed and why the
 * hero cards above deliberately show YTD figures instead.
 */
export function PnlTable({ mon }: { mon: MonthPoint[] }) {
  if (!(mon || []).length) return null;
  const rows = mon.map((m, i) => {
    const rev = Number(m.revenue) || 0, exp = Number(m.bills) || 0, net = rev - exp;
    const prev = i > 0 ? (Number(mon[i - 1].revenue) || 0) : null;
    return {
      month: m.month, rev, exp, net,
      margin: rev > 0 ? Math.round(net / rev * 100) : null,
      mom: (prev && prev > 0) ? Math.round((rev - prev) / prev * 100) : null,
      mtd: (i === mon.length - 1),
    };
  });
  const tr = rows.reduce((s, r) => s + r.rev, 0), te = rows.reduce((s, r) => s + r.exp, 0), tn = tr - te;
  return (
    <div className="tbl-wrap" style={{ marginTop: '12px' }}>
      <table className="bigtable">
        <thead><tr>
          <th>Month</th><th className="amt">Revenue</th><th className="amt">Expenses</th>
          <th className="amt">Net profit</th><th className="amt">Margin</th><th className="amt">Rev MoM</th>
        </tr></thead>
        <tbody>
          {rows.slice().reverse().map((r, i) => {
            const momTxt = r.mom === null ? '—' : ((r.mom >= 0 ? '▲' : '▼') + Math.abs(r.mom) + '%');
            const momCol = r.mom === null ? 'var(--muted)' : (r.mom >= 0 ? 'var(--green)' : 'var(--red)');
            return (
              <tr key={i} style={r.mtd ? { opacity: '.72' } : undefined}>
                <td>
                  {r.month}
                  {r.mtd
                    ? <>{' '}<span style={{ fontSize: '9px', fontWeight: '700', color: 'var(--muted)', border: '1px solid var(--border-strong)', borderRadius: '4px', padding: '0 4px', verticalAlign: 'middle' }}>MTD</span></>
                    : null}
                </td>
                <td className="amt" style={{ color: 'var(--green)' }}>{M(r.rev)}</td>
                <td className="amt" style={{ color: 'var(--coral)' }}>{M(r.exp)}</td>
                <td className="amt" style={{ fontWeight: '700', color: r.net >= 0 ? 'var(--green)' : 'var(--red)' }}>{M(r.net)}</td>
                <td className="amt">{r.margin === null ? '—' : r.margin + '%'}</td>
                <td className="amt" style={{ color: momCol }}>{momTxt}</td>
              </tr>
            );
          })}
          <tr style={{ borderTop: '2px solid var(--border-strong)', fontWeight: '800' }}>
            <td>Total</td>
            <td className="amt" style={{ color: 'var(--green)' }}>{M(tr)}</td>
            <td className="amt" style={{ color: 'var(--coral)' }}>{M(te)}</td>
            <td className="amt" style={{ color: tn >= 0 ? 'var(--green)' : 'var(--red)' }}>{M(tn)}</td>
            <td className="amt">{(tr > 0 ? Math.round(tn / tr * 100) : 0) + '%'}</td>
            <td className="amt">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** `finDsoBars()` — app.html:1946. DSO vs DPO per company, with the cash-gap note under each pair. */
export function DsoBars({ cos }: { cos: DsoRow[] }) {
  const data = (cos || []).filter((c) => c.dso != null || c.dpo != null);
  const n = data.length;
  if (!n) return <NoData text="Not enough data." padding="16px" />;
  const w = 780, h = 250, padL = 40, padR = 12, padB = 52, padT = 14;
  const max = Math.max.apply(null, ([10] as number[]).concat(data.map((c) => Math.max(Number(c.dso) || 0, Number(c.dpo) || 0))));
  const slot = (w - padL - padR) / n, bw = Math.min(26, slot * 0.28);
  const yat = (v: number) => h - padB - (v / max) * (h - padB - padT);
  const grid = [];
  for (let k = 0; k <= 3; k++) {
    const gy = padT + (k / 3) * (h - padB - padT);
    grid.push(
      <React.Fragment key={k}>
        <line x1={padL} y1={gy.toFixed(1)} x2={w - padR} y2={gy.toFixed(1)} stroke="var(--border)" strokeWidth="1" opacity=".5" />
        <text x={padL - 6} y={(gy + 3).toFixed(1)} textAnchor="end" fontSize="9" fill="var(--muted)">{Math.round(max * (3 - k) / 3) + 'd'}</text>
      </React.Fragment>,
    );
  }
  return (
    <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={{ display: 'block' }}>
      {grid}
      {data.map((c, i) => {
        const cx = padL + slot * i + slot / 2;
        const dso = Number(c.dso) || 0, dpo = Number(c.dpo) || 0;
        const x1 = cx - bw - 2, x2 = cx + 2;
        return (
          <React.Fragment key={i}>
            <rect x={x1.toFixed(1)} y={yat(dso).toFixed(1)} width={bw} height={Math.max(0, (h - padB) - yat(dso)).toFixed(1)} rx="2" fill="#5b9bd5">
              <title>{'DSO ' + dso + 'd'}</title>
            </rect>
            <text x={(x1 + bw / 2).toFixed(1)} y={(yat(dso) - 3).toFixed(1)} textAnchor="middle" fontSize="8.5" fill="#5b9bd5">{dso}</text>
            <rect x={x2.toFixed(1)} y={yat(dpo).toFixed(1)} width={bw} height={Math.max(0, (h - padB) - yat(dpo)).toFixed(1)} rx="2" fill="#f5a623">
              <title>{'DPO ' + dpo + 'd'}</title>
            </rect>
            <text x={(x2 + bw / 2).toFixed(1)} y={(yat(dpo) - 3).toFixed(1)} textAnchor="middle" fontSize="8.5" fill="#f5a623">{dpo}</text>
            <text x={cx.toFixed(1)} y={h - padB + 16} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{cfoShortName(c.tenant_name).slice(0, 12)}</text>
            {c.cash_gap != null
              ? <text x={cx.toFixed(1)} y={h - padB + 30} textAnchor="middle" fontSize="9" fill={c.cash_gap > 0 ? '#e85d3c' : '#3ddc97'}>{'gap ' + (c.cash_gap > 0 ? '+' : '') + c.cash_gap + 'd'}</text>
              : null}
          </React.Fragment>
        );
      })}
    </svg>
  );
}

/**
 * `finCashflowChart()` — app.html:1968. Inflow up, outflow down, cumulative net across.
 *
 * `cum` accumulates `x.net` — a field the SERVER sends. It is deliberately not re-derived from
 * `inflow - outflow` here: where the two disagree the server's number is the one the rest of the
 * analytics is built from, and silently substituting a locally computed one would put a different line
 * on the chart from the one the figures under it describe.
 */
export function CashflowChart({ wks }: { wks: CashWeek[] }) {
  if (!wks || !wks.length) return <NoData text="No dated open invoices to forecast." padding="16px" />;
  const w = 780, h = 250, padL = 46, padR = 12, padT = 16, padB = 38, n = wks.length;
  let cum = 0;
  const cums = wks.map((x) => { cum += Number(x.net) || 0; return cum; });
  const vals: number[] = [];
  wks.forEach((x) => { vals.push(Number(x.inflow) || 0); vals.push(Number(x.outflow) || 0); });
  cums.forEach((c) => vals.push(Math.abs(c)));
  const maxV = Math.max.apply(null, ([1] as number[]).concat(vals));
  const mid = (padT + (h - padB)) / 2;
  const y = (v: number) => mid - (v / maxV) * ((h - padT - padB) / 2);
  const zy = y(0), slot = (w - padL - padR) / n, bw = Math.min(16, slot * 0.42);
  const linePts = cums.map((c, i) => (i ? 'L' : 'M') + (padL + slot * i + slot / 2).toFixed(1) + ' ' + y(c).toFixed(1)).join(' ');
  return (
    <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={{ display: 'block' }}>
      <line x1={padL} y1={zy.toFixed(1)} x2={w - padR} y2={zy.toFixed(1)} stroke="var(--border)" strokeWidth="1" />
      {wks.map((x, i) => {
        const cx = padL + slot * i + slot / 2, inf = Number(x.inflow) || 0, outf = Number(x.outflow) || 0;
        return (
          <React.Fragment key={i}>
            {inf > 0
              ? <rect x={(cx - bw - 1).toFixed(1)} y={y(inf).toFixed(1)} width={bw} height={Math.abs(zy - y(inf)).toFixed(1)} fill="#3ddc97" opacity=".85">
                  <title>{'Wk' + x.week + ' Inflow ' + M(inf)}</title>
                </rect>
              : null}
            {outf > 0
              ? <rect x={(cx + 1).toFixed(1)} y={zy.toFixed(1)} width={bw} height={Math.abs(y(outf) - zy).toFixed(1)} fill="#e85d3c" opacity=".85">
                  <title>{'Wk' + x.week + ' Outflow ' + M(outf)}</title>
                </rect>
              : null}
            {n <= 13
              ? <text x={cx.toFixed(1)} y={h - padB + 13} textAnchor="middle" fontSize="8" fill="var(--muted)">{x.week_start}</text>
              : null}
          </React.Fragment>
        );
      })}
      <path d={linePts} fill="none" stroke="#5b9bd5" strokeWidth="2"><title>Cumulative net cash</title></path>
    </svg>
  );
}

/** `finForecastChart()` — app.html:1980. Solid blue history, dashed amber projection. */
export function ForecastChart({ hist, fc }: { hist?: ForecastPoint[]; fc?: ForecastPoint[] }) {
  const all = (hist || []).map((p) => ({ m: p.month, v: Number(p.revenue) || 0, f: false }))
    .concat((fc || []).map((p) => ({ m: p.month, v: Number(p.projected) || 0, f: true })));
  const n = all.length;
  if (n < 2) return <NoData text="Not enough history to forecast." padding="16px" />;
  const w = 780, h = 240, padL = 48, padR = 12, padT = 14, padB = 30, hi = (hist || []).length;
  const max = Math.max.apply(null, ([1] as number[]).concat(all.map((p) => p.v)));
  const xat = (i: number) => padL + i * (w - padL - padR) / (n - 1);
  const yat = (v: number) => h - padB - (v / max) * (h - padB - padT);
  const grid = [];
  for (let k = 0; k <= 3; k++) {
    const gy = padT + (k / 3) * (h - padB - padT);
    grid.push(
      <React.Fragment key={k}>
        <line x1={padL} y1={gy.toFixed(1)} x2={w - padR} y2={gy.toFixed(1)} stroke="var(--border)" strokeWidth="1" opacity=".5" />
        <text x={padL - 6} y={(gy + 3).toFixed(1)} textAnchor="end" fontSize="9" fill="var(--muted)">{cfoMk(max * (3 - k) / 3)}</text>
      </React.Fragment>,
    );
  }
  const hp = all.slice(0, hi).map((p, i) => (i ? 'L' : 'M') + xat(i).toFixed(1) + ' ' + yat(p.v).toFixed(1)).join(' ');
  // The forecast path RESTARTS at the last historical point (hi-1), so the two lines join rather than
  // leaving a gap. Starting it at `hi` would detach the projection from the history it extrapolates.
  const fp = all.slice(Math.max(0, hi - 1)).map((p, i) => { const idx = Math.max(0, hi - 1) + i; return (i ? 'L' : 'M') + xat(idx).toFixed(1) + ' ' + yat(p.v).toFixed(1); }).join(' ');
  return (
    <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={{ display: 'block' }}>
      {grid}
      <path d={hp} fill="none" stroke="#5b9bd5" strokeWidth="2.5" />
      <path d={fp} fill="none" stroke="#f5a623" strokeWidth="2.5" strokeDasharray="5 4" />
      {all.map((p, i) => (
        <circle key={i} cx={xat(i).toFixed(1)} cy={yat(p.v).toFixed(1)} r="2.5" fill={p.f ? '#f5a623' : '#5b9bd5'}>
          <title>{p.m + ' ' + (p.f ? 'Forecast ' : '') + M(p.v)}</title>
        </circle>
      ))}
      {all.map((p, i) => (n > 10 && i % 2
        ? null
        : <text key={i} x={xat(i).toFixed(1)} y={h - padB + 14} textAnchor="middle" fontSize="8.5" fill={p.f ? '#f5a623' : 'var(--muted)'}>{p.m.slice(2)}</text>))}
    </svg>
  );
}

// ── `#cfo` — the thirteen blocks of cfoRender()'s single innerHTML write ──────────────────────────

export interface CfoProps {
  data: CfoData;
  /**
   * `cfoScopeName()` (app.html:1836) — the selected company's name, or null for the whole group. It
   * resolves `curCo()` against `COMPANIES`, both of which live in the chrome, so it is a prop rather
   * than a read: a screen that reached into the shell's DOM would not be a pure function of its props.
   */
  scopeName: string | null;
  /** `ytdYear(new Date())`. A PROP, not a clock read — see this file's header. */
  ytdYear: number;
  /** `onclick="CFO_DATA=null;FIN_DATA=null;renderCFO()"` — app.html:1921. */
  onRefresh: () => void;
  /**
   * Whatever is currently inside `#cfo-analytics`. The legacy fills that div by a SECOND innerHTML
   * write (`cfoAnalyticsLoad()`), which is why the golden holds it empty and holds the strip as its own
   * section; here the route composes the two, as app/finance/ctgaccess/page.tsx composes Screen + Body.
   */
  analytics?: React.ReactNode;
}

export default function FinanceCfo(p: CfoProps) {
  const r = p.data;
  const g = r.group || {}, cos = r.companies || [], mon = r.monthly || [];
  const aging = r.ar_aging || {}, top = r.top_customers || [], alerts = r.alerts || [];
  const cm = r.companies_monthly || [];
  const wc = Number(g.working_capital) || 0;
  const overdue = Number(g.ar_overdue) || 0, arOpen = Number(g.ar_open) || 0;
  const revCur = Number(g.rev_cur) || 0, revPrev = Number(g.rev_prev) || 0;
  const momPct = revPrev > 0 ? Math.round((revCur - revPrev) / revPrev * 100) : null;
  const pm = r.period_months || 12;
  const expense = Number(g.expenses) || 0, net = Number(g.net_profit) || 0, revenue = Number(g.revenue) || 0;
  const margin = revenue > 0 ? Math.round(net / revenue * 100) : 0;

  // app.html:1919. The scope line is one text run with an optional <b> in the middle and an optional MoM
  // tail; built as strings so the two halves cannot pick up a stray separator.
  const momTail = momPct != null ? (' · revenue this month ' + (momPct >= 0 ? '▲' : '▼') + ' ' + Math.abs(momPct) + '% vs last') : '';
  const maxRev = Math.max.apply(null, ([1] as number[]).concat(cos.map((c) => Number(c.revenue) || 0)));
  const maxCust = Math.max.apply(null, ([1] as number[]).concat(top.map((c) => Number(c.revenue) || 0)));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '2px 0 14px', flexWrap: 'wrap', gap: '8px' }}>
        <div className="muted" style={{ fontSize: '12.5px' }}>
          {r.scoped_tenant
            ? <>{'Financial position · '}<b style={{ color: 'var(--text)' }}>{p.scopeName || 'selected company'}</b>{' · from live invoice data' + momTail}</>
            : ('Group financial position across all ' + cos.length + ' companies · from live invoice data' + momTail)}
        </div>
        <button className="btn sm" onClick={p.onRefresh}>↻ Refresh</button>
      </div>

      {/* Hero KPIs, row 1 — the P&L figures. Labelled YTD on purpose (app.html:1856): they are the
          RPC's calendar-year-to-date sums tied to Xero, NOT the 12-month window the table below uses.
          Dropping the year off the label puts two different numbers on one screen with nothing to tell
          them apart. */}
      <div className="cards" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="card">
          <div className="c-ico">💵</div>
          <div className="n" style={{ color: 'var(--green-soft)' }}>{M(revenue)}</div>
          <div className="l">{'Revenue · YTD ' + p.ytdYear}</div>
        </div>
        <div className="card">
          <div className="c-ico">🧾</div>
          <div className="n" style={{ color: 'var(--coral)' }}>{M(expense)}</div>
          <div className="l">{'Expenses · YTD ' + p.ytdYear}</div>
        </div>
        <div className={'card ' + (net >= 0 ? 'green' : 'red')}>
          <div className="c-ico">{net >= 0 ? '📈' : '📉'}</div>
          <div className="n" style={{ color: net >= 0 ? 'var(--green-soft)' : 'var(--red-soft)' }}>{M(net)}</div>
          <div className="l">{'Net profit · YTD ' + p.ytdYear}</div>
        </div>
        <div className="card">
          <div className="c-ico">📊</div>
          <div className="n" style={{ color: margin >= 0 ? 'var(--text)' : 'var(--red-soft)' }}>{margin + '%'}</div>
          <div className="l">Net margin</div>
        </div>
      </div>
      <div style={{ height: '12px' }}></div>
      {/* Hero KPIs, row 2 — the financial position. */}
      <div className="cards" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="card">
          <div className="c-ico">📥</div>
          <div className="n" style={{ color: 'var(--sky-soft)' }}>{M(g.ar_open)}</div>
          <div className="l">Receivables (owed to us)</div>
        </div>
        <div className="card">
          <div className="c-ico">📤</div>
          <div className="n" style={{ color: 'var(--amber)' }}>{M(g.ap_open)}</div>
          <div className="l">Payables (we owe)</div>
        </div>
        <div className={'card ' + (wc >= 0 ? 'green' : 'red')}>
          <div className="c-ico">⚖️</div>
          <div className="n" style={{ color: wc >= 0 ? 'var(--green-soft)' : 'var(--red-soft)' }}>{M(wc)}</div>
          <div className="l">Net working capital</div>
        </div>
        <div className="card">
          <div className="c-ico">⏰</div>
          <div className="n" style={{ color: overdue > 0 ? 'var(--red-soft)' : 'var(--muted)' }}>{M(overdue)}</div>
          <div className="l">{'Overdue AR' + (arOpen > 0 ? (' · ' + Math.round(overdue / arOpen * 100) + '%') : '')}</div>
        </div>
      </div>

      <div style={{ height: '16px' }}></div>

      {/* Analyst alerts — absent entirely when the server sent none, which is what the empty-alerts
          case in the screen's test pins. */}
      {alerts.length
        ? <div className="panel" style={{ marginBottom: '16px', borderColor: 'rgba(245,158,11,.25)' }}>
            <div className="panel-hd"><h3>⚠ Analyst alerts</h3></div>
            {alerts.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: '9px', padding: '7px 0', fontSize: '13px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: a.severity === 'high' ? 'var(--red-soft)' : 'var(--amber)' }}>{a.severity === 'high' ? '🔴' : '🟠'}</span>
                <span>{a.text}</span>
              </div>
            ))}
          </div>
        : null}

      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="panel-hd">
          <h3>📅 Monthly P&L — revenue vs expenses</h3>
          <span className="muted" style={{ fontSize: '11px' }}>{pm + ' months · net = revenue − supplier bills'}</span>
        </div>
        <PnlCombo mon={mon} />
        <PnlTable mon={mon} />
      </div>

      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="panel-hd">
          <h3>🏆 Revenue by company</h3>
          <span className="muted" style={{ fontSize: '11px' }}>{pm + '-month total · ▲▼ this month vs last'}</span>
        </div>
        <RevBars cos={cos} />
      </div>

      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="panel-hd">
          <h3>📈 Revenue structure — monthly, stacked by company</h3>
          <span className="muted" style={{ fontSize: '11px' }}>each band = one company · total height = group revenue</span>
        </div>
        <Stack cm={cm} dataKey="revenue" />
      </div>

      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="panel-hd">
          <h3>📊 Revenue trend — each company</h3>
          <span className="muted" style={{ fontSize: '11px' }}>one line per company</span>
        </div>
        <RevLines cm={cm} />
      </div>

      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="panel-hd">
          <h3>🧾 Expenses by company</h3>
          <span className="muted" style={{ fontSize: '11px' }}>{'supplier bills · ' + pm + '-month total · ▲▼ this month vs last'}</span>
        </div>
        <ExpBars cos={cos} />
      </div>

      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="panel-hd">
          <h3>📉 Expenses structure — monthly, stacked by company</h3>
          <span className="muted" style={{ fontSize: '11px' }}>each band = one company · total height = group bills</span>
        </div>
        <Stack cm={cm} dataKey="bills" />
      </div>

      {/* Company scorecard. Every row's revenue BAR is a percentage of the largest revenue in the
          list — a relative figure with no units on screen, so a row bound to the wrong company shows a
          plausible bar. The per-row margin is derived the same way as the group's. */}
      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="panel-hd">
          <h3>🏢 Company scorecard — P&L &amp; position</h3>
          <span className="muted" style={{ fontSize: '11px' }}>🟢 healthy · 🟡 watch · 🔴 cash pressure</span>
        </div>
        <div className="tbl-wrap">
          <table className="bigtable">
            <thead><tr>
              <th>Company</th><th>{'Revenue (' + pm + 'mo)'}</th><th className="amt">Expenses</th>
              <th className="amt">Net profit</th><th className="amt">AR (owed us)</th>
              <th className="amt">AP (we owe)</th><th className="amt">Working capital</th>
            </tr></thead>
            <tbody>
              {cos.map((c, i) => {
                const dot = c.health === 'green' ? '🟢' : c.health === 'amber' ? '🟡' : '🔴';
                const cwc = Number(c.working_capital) || 0;
                const crev = Number(c.revenue) || 0, cexp = Number(c.expenses) || 0, cnet = Number(c.net_profit) || 0;
                const cmargin = crev > 0 ? Math.round(cnet / crev * 100) : null;
                const revBar = Math.round(crev / maxRev * 100);
                return (
                  <tr key={i}>
                    <td><b>{c.tenant_name}</b>{' ' + dot}</td>
                    <td style={{ minWidth: '110px' }}>
                      <div style={{ background: 'var(--panel-2)', borderRadius: '4px', height: '7px', overflow: 'hidden' }}>
                        <div style={{ width: revBar + '%', height: '100%', background: 'var(--coral)' }}></div>
                      </div>
                      <div className="muted" style={{ fontSize: '10.5px', marginTop: '2px' }}>{M(crev)}</div>
                    </td>
                    <td className="amt" style={{ color: 'var(--coral)' }}>{M(cexp)}</td>
                    <td className="amt" style={{ fontWeight: '700', color: cnet >= 0 ? 'var(--green-soft)' : 'var(--red-soft)' }}>
                      {M(cnet)}
                      {cmargin !== null ? <div className="muted" style={{ fontSize: '10px', fontWeight: '400' }}>{cmargin + '% margin'}</div> : null}
                    </td>
                    <td className="amt" style={{ color: 'var(--sky-soft)' }}>{M(c.ar_open)}</td>
                    <td className="amt" style={{ color: 'var(--amber)' }}>{M(c.ap_open)}</td>
                    <td className="amt" style={{ color: cwc >= 0 ? 'var(--green-soft)' : 'var(--red-soft)', fontWeight: '700' }}>{M(cwc)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
        <div className="panel">
          <div className="panel-hd"><h3>📊 Receivables aging</h3></div>
          <AgingBar a={aging} />
        </div>
        <div className="panel">
          <div className="panel-hd"><h3>👑 Top customers · revenue</h3></div>
          {top.length
            ? top.map((c, i) => {
                const bar = Math.round((Number(c.revenue) || 0) / maxCust * 100);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0' }}>
                    <span className="muted" style={{ width: '16px', fontSize: '11px' }}>{i + 1}</span>
                    <span style={{ flex: '1', fontSize: '12.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.contact}</span>
                    <div style={{ width: '120px', background: 'var(--panel-2)', borderRadius: '4px', height: '7px', overflow: 'hidden' }}>
                      <div style={{ width: bar + '%', height: '100%', background: OV_PALETTE[i % OV_PALETTE.length] }}></div>
                    </div>
                    <span className="amt" style={{ width: '90px', fontSize: '12px' }}>{M(c.revenue)}</span>
                  </div>
                );
              })
            : <div className="muted" style={{ padding: '14px' }}>No customer data.</div>}
        </div>
      </div>

      {/* The analytics strip's own element. Empty in the `#cfo` golden by construction: the harness
          records innerHTML by id, and `cfoAnalyticsLoad()` writes THIS id afterwards, which is what
          gives the golden its second section. */}
      <div id="cfo-analytics" style={{ marginTop: '16px' }}>{p.analytics}</div>
    </>
  );
}

// ── `#cfo-analytics` — the eight blocks of cfoAnalyticsRender()'s single write ────────────────────

export interface AnalyticsProps { data: FinData }

/**
 * `cfoAnalyticsRender()` — app.html:2004. Six panels, a heading strip and a stamp; NO handlers at all,
 * which is itself the assertion the screen's test makes (`finance.bankfeed`'s case: the empty handler
 * list IS the check, because R1 would make a stray button invisible in the string diff).
 *
 * The block ORDER is dso · risk · cashflow · forecast · vendor · intercompany — note that this is NOT
 * the order the `var` declarations are written in above it (intercompany is built third and rendered
 * last). Follow the concatenation at app.html:2081, not the declarations.
 */
export function Analytics({ data }: AnalyticsProps) {
  const r = data;
  const dd = r.dso_dpo || {}, g = dd.group || {}, cos = dd.companies || [];
  const cr = r.customer_risk || {}, ct = cr.totals || {}, custs = cr.customers || [];
  const ic = r.intercompany || {};
  const pairs = ic.pairs || [];
  const cf = r.cashflow_13w || [];
  const cfIn = cf.reduce((s, x) => s + (Number(x.inflow) || 0), 0);
  const cfOut = cf.reduce((s, x) => s + (Number(x.outflow) || 0), 0);
  const cfNet = cfIn - cfOut;
  const vs = r.vendor_spend || {};
  const vtot = Number(vs.total_spend365) || 0;
  const fc = r.revenue_forecast || {};
  const fcEx = fc.excluded || [];

  return (
    <>
      <div style={{ borderTop: '2px solid var(--border)', margin: '8px 0 16px', paddingTop: '16px' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '15px' }}>📐 Financial Analytics</h3>
        <div className="muted" style={{ fontSize: '12px', marginBottom: '14px' }}>
          Collection &amp; payment cycle, credit risk, cash-flow forecast, vendor spend, revenue forecast, intercompany — an analyst&#39;s view.
        </div>
      </div>

      {/* ① DSO / DPO. The sentence under the chart changes SHAPE, not just its number, on the sign of
          the cash gap — a positive gap is money the group finances itself and a negative one is
          supplier credit. Collapsing the two would state the opposite for half the group's companies. */}
      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="panel-hd">
          <h3>⏱️ Collection &amp; payment cycle · DSO / DPO</h3>
          <div className="muted" style={{ fontSize: '11.5px' }}>
            <span style={{ color: '#5b9bd5' }}>■</span>{' DSO (days to collect)   '}
            <span style={{ color: '#f5a623' }}>■</span>{' DPO (days to pay)'}
          </div>
        </div>
        <DsoBars cos={cos} />
        <div className="muted" style={{ fontSize: '12.5px', marginTop: '10px', lineHeight: '1.7' }}>
          {g.cash_gap != null
            ? (g.cash_gap > 0
                ? <>{'On average you collect from customers in '}<b>{g.dso}</b>{' days but must pay suppliers in '}<b>{g.dpo}</b>{' days → a '}<b style={{ color: 'var(--red-soft)' }}>{g.cash_gap + '-day'}</b>{' cash gap you finance yourself.'}</>
                : <>{'On average you collect in '}<b>{g.dso}</b>{' days and pay in '}<b>{g.dpo}</b>{' days → supplier terms run '}<b style={{ color: 'var(--green-soft)' }}>{Math.abs(g.cash_gap) + ' days'}</b>{' longer than customer terms, so working capital is net-positive.'}</>)
            : 'Not enough data to compute the cash gap.'}
          {' '}
          <span style={{ opacity: '.75' }}>DSO = AR ÷ avg daily revenue; DPO = AP ÷ avg daily purchases (trailing 12 months). Lower DSO is better; moderately higher DPO helps cash.</span>
        </div>
      </div>

      {/* ② Customer credit risk. Every row names a real customer and puts a number on how likely they
          are not to pay; the three cards are the server's totals, NOT sums of the rows below them. */}
      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="panel-hd">
          <h3>🎯 Customer credit risk</h3>
          <span className="muted" style={{ fontSize: '11px' }}>Sorted by overdue exposure · Risk% = est. bad debt ÷ that customer&#39;s AR</span>
        </div>
        <div className="cards" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: '12px' }}>
          <div className="card">
            <div className="c-ico">📥</div>
            <div className="n" style={{ color: 'var(--sky-soft)' }}>{M(ct.total_ar_open)}</div>
            <div className="l">Open AR</div>
          </div>
          <div className="card">
            <div className="c-ico">⏰</div>
            <div className="n" style={{ color: 'var(--amber)' }}>{M(ct.total_overdue)}</div>
            <div className="l">Overdue</div>
          </div>
          <div className="card">
            <div className="c-ico">⚠️</div>
            <div className="n" style={{ color: 'var(--red-soft)' }}>{M(ct.est_bad_debt)}</div>
            <div className="l">Est. bad-debt provision</div>
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="bigtable">
            <thead><tr>
              <th>Customer</th><th className="amt">AR</th><th className="amt">Overdue</th>
              <th className="amt">Worst age</th><th className="amt">Provision</th><th>Risk</th>
            </tr></thead>
            <tbody>
              {custs.length
                ? custs.map((c, i) => {
                    const risk = Number(c.risk) || 0;
                    const rc = risk >= 40 ? 'var(--red-soft)' : risk >= 15 ? 'var(--amber)' : 'var(--muted)';
                    const wd = Number(c.worst_days) || 0;
                    return (
                      <tr key={i}>
                        <td>
                          <b style={{ fontSize: '12.5px' }}>{c.cust}</b>
                          <div className="muted" style={{ fontSize: '10.5px' }}>{cfoShortName(c.tenant_name)}</div>
                        </td>
                        <td className="amt" style={{ color: 'var(--sky-soft)' }}>{M(c.ar_open)}</td>
                        <td className="amt" style={{ color: Number(c.overdue) > 0 ? 'var(--amber)' : 'var(--muted)' }}>{M(c.overdue)}</td>
                        <td className="amt" style={{ fontSize: '11.5px', color: wd > 60 ? 'var(--red-soft)' : wd > 0 ? 'var(--amber)' : 'var(--muted)' }}>{wd > 0 ? wd + 'd' : '—'}</td>
                        <td className="amt" style={{ color: 'var(--red-soft)' }}>{M(c.provision)}</td>
                        <td><span className="pill" style={{ background: 'rgba(232,93,60,.14)', color: rc, fontSize: '10px' }}>{risk + '%'}</span></td>
                      </tr>
                    );
                  })
                : <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '16px' }}>No open receivables.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>Provision estimate: 30–60 days ×10% · 60–90 days ×25% · 90+ days ×50%.</div>
      </div>

      {/* ④ in the legacy's own numbering, third in its output order. */}
      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="panel-hd">
          <h3>💧 13-week cash flow forecast</h3>
          <div className="muted" style={{ fontSize: '11.5px' }}>
            <span style={{ color: '#3ddc97' }}>■</span>{' Inflow  '}
            <span style={{ color: '#e85d3c' }}>■</span>{' Outflow  '}
            <span style={{ color: '#5b9bd5' }}>━</span>{' Cumulative net'}
          </div>
        </div>
        <CashflowChart wks={cf} />
        <div className="muted" style={{ fontSize: '12px', marginTop: '10px', lineHeight: '1.7' }}>
          {'Next 13 weeks: expected inflow '}
          <b style={{ color: 'var(--green-soft)' }}>{M(cfIn)}</b>
          {' · outflow '}
          <b style={{ color: 'var(--red-soft)' }}>{M(cfOut)}</b>
          {' · net '}
          <b style={{ color: cfNet >= 0 ? 'var(--green-soft)' : 'var(--red-soft)' }}>{M(cfNet)}</b>
          {'. '}
          <span style={{ opacity: '.75' }}>Placed by open AR/AP due dates; overdue items fall into week 1 (now).</span>
        </div>
      </div>

      {/* ⑥ in the legacy's numbering, fourth in its output order. */}
      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="panel-hd">
          <h3>🔮 Revenue forecast</h3>
          <div className="muted" style={{ fontSize: '11.5px' }}>
            <span style={{ color: '#5b9bd5' }}>━</span>{' Actual  '}
            <span style={{ color: '#f5a623' }}>╌</span>{' Forecast (next 3 mo)'}
          </div>
        </div>
        <ForecastChart hist={fc.history} fc={fc.forecast} />
        <div className="muted" style={{ fontSize: '11.5px', marginTop: '8px' }}>
          Linear trend extrapolation from the last 6 complete months — indicative only.
          {fcEx.length
            ? <span style={{ color: 'var(--amber)' }}>{' ⚠ ' + fcEx.join(', ') + ' looked incomplete and ' + (fcEx.length > 1 ? 'were' : 'was') + ' excluded from the forecast.'}</span>
            : null}
        </div>
      </div>

      {/* ⑤ in the legacy's numbering, fifth in its output order. The share bar is derived from the
          server's own total, so a vendor whose row is right and whose share is wrong means the total
          moved — which is why the two are pinned together in the screen's test. */}
      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="panel-hd">
          <h3>🏭 Vendor spend</h3>
          <span className="muted" style={{ fontSize: '11px' }}>{'Trailing 12 months · total ' + M(vtot)}</span>
        </div>
        <div className="tbl-wrap">
          <table className="bigtable">
            <thead><tr>
              <th>Vendor</th><th>Share</th><th className="amt">Spend (12mo)</th><th className="amt">%</th><th className="amt">Open AP</th>
            </tr></thead>
            <tbody>
              {(vs.vendors || []).length
                ? (vs.vendors || []).map((vv, i) => {
                    const share = vtot > 0 ? Math.round(100 * (Number(vv.spend) || 0) / vtot) : 0;
                    return (
                      <tr key={i}>
                        <td><b style={{ fontSize: '12.5px' }}>{cfoShortName(vv.vendor)}</b></td>
                        <td style={{ minWidth: '110px' }}>
                          <div style={{ background: 'var(--panel-2)', borderRadius: '4px', height: '7px', overflow: 'hidden' }}>
                            <div style={{ width: share + '%', height: '100%', background: 'var(--coral)' }}></div>
                          </div>
                        </td>
                        <td className="amt" style={{ fontWeight: '700' }}>{M(vv.spend)}</td>
                        <td className="amt muted" style={{ fontSize: '11.5px' }}>{share + '%'}</td>
                        <td className="amt" style={{ color: 'var(--amber)' }}>{M(vv.ap_open)}</td>
                      </tr>
                    );
                  })
                : <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '14px' }}>No vendor spend.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ③ in the legacy's numbering, LAST in its output order. */}
      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="panel-hd">
          <h3>🔗 Intercompany</h3>
          <span className="muted" style={{ fontSize: '11px' }}>One side&#39;s AR should equal the other side&#39;s AP</span>
        </div>
        {pairs.length
          ? <div className="tbl-wrap">
              <table className="bigtable">
                <thead><tr>
                  <th>Creditor (records AR)</th><th>Debtor (records AP)</th>
                  <th className="amt">AR booked</th><th className="amt">AP booked</th><th className="amt">Difference</th>
                </tr></thead>
                <tbody>
                  {pairs.map((pr, i) => {
                    const diff = Number(pr.difference) || 0;
                    return (
                      <tr key={i}>
                        <td><b>{cfoShortName(pr.creditor || '')}</b></td>
                        <td>{cfoShortName(pr.debtor || '')}</td>
                        <td className="amt">{M(pr.creditor_says_owed)}</td>
                        <td className="amt">{M(pr.debtor_says_payable)}</td>
                        {/* One sen either way is rounding; more than that is two sets of books that
                            disagree, which is why the threshold is 1 and not 0. */}
                        <td className="amt" style={{ color: Math.abs(diff) > 1 ? 'var(--red-soft)' : 'var(--green-soft)', fontWeight: '700' }}>{M(diff)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          : <div className="muted" style={{ padding: '14px', fontSize: '12.5px' }}>
              {'No material intercompany balances (group internal open total ' + M(ic.total_intercompany_open || 0) + '). Once the 5 entities start invoicing each other, this lists who owes whom and whether both sides' + "'" + ' books agree.'}
            </div>}
      </div>

      {/* The stamp. `toLocaleString` on an instant the SERVER sent — hr.clock's case, not hr.yearend's:
          the value is data and only the zone it is read in varies, so it stays here, spelled as the
          legacy spells it, and the screen's test re-applies the harness's UTC override. */}
      <div className="muted" style={{ fontSize: '11px', textAlign: 'right', marginTop: '6px' }}>
        {'Analysis from the reliable invoice cache · ' +
          (r.generated_at ? new Date(r.generated_at).toLocaleString('en-GB', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')}
      </div>
    </>
  );
}

// ── The six states neither golden holds ───────────────────────────────────────────────────────────
//
// A golden is one state of one screen (CLAUDE.md), and these are the other six. They are mirrored from
// app.html anyway because leaving them out would leave the route with nothing to render while a fetch
// is in flight or after it fails — and this screen makes TWO independent requests, so a failure in one
// must not blank the other. The screen's own test pins each against app.html's text and says plainly
// that the parity diff does not reach them.

/** `renderCFO()`'s first write — app.html:1841. */
export function Loading({ scopeName, companyCount }: { scopeName: string | null; companyCount: number }) {
  const loadingWho = scopeName ? scopeName : ('all ' + (companyCount || 5) + ' companies');
  return (
    <div className="panel">
      <div className="panel-hd"><h3>{'🎯 CFO Cockpit · ' + (scopeName || 'group financial position')}</h3></div>
      <div className="muted" style={{ padding: '26px', textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 10px' }}></div>
        {'Computing analytics for ' + loadingWho + '…'}
      </div>
    </div>
  );
}

/** `renderCFO()`'s `!r.ok` branch (app.html:1845) and its `catch` (app.html:1847). */
export function ErrorPanel({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="panel">
      <div className="empty">
        <div className="empty-ico">{icon}</div>
        <div>{text}</div>
      </div>
    </div>
  );
}

/** `cfoAnalyticsLoad()`'s first write — app.html:1936. */
export function AnalyticsLoading() {
  return (
    <div className="panel">
      <div className="panel-hd"><h3>📐 Financial analytics</h3></div>
      <div className="muted" style={{ padding: '22px', textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 10px' }}></div>
        Computing DSO/DPO, customer risk, intercompany…
      </div>
    </div>
  );
}
