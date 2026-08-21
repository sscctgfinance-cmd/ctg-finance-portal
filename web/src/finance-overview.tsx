// Finance OS · Overview — the React half of `renderOverview()` (app.html:2081), the eighteenth Finance
// screen out of app.html and the finance LANDING screen: the one people look at first and trust without
// checking, which is why a wrong summary figure here is worse than a wrong figure on a screen someone is
// actively working in.
//
// The legacy original is STILL THERE and still shipping; nothing was deleted from app.html. Both screens
// are reachable side by side (`app.html#tab=overview` and `/finance/overview/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. The three loads
// (`overview` / `overview_range`, `group_dashboard`, `pnl_report`), the stale-response guards and the
// range state live in app/finance/overview/page.tsx, on the other side of that line.
//
// ── FOUR SECTIONS, FOUR DIFFS ─────────────────────────────────────────────────────────────────────
// `tests/golden/finance.overview.html` has FOUR `<!-- #id -->` blocks, because `renderOverview()` writes
// four different element ids and the harness's last-write-wins is per id:
//
//   #overview     ← the tab div: the period header, the cards, the company table, the status bar, and
//                   the two EMPTY placeholder divs `insertAdjacentHTML` appends (app.html:2139).
//   #ov-trend     ← `ovTrendRender()` (app.html:2230) — four panels of invoice-cache analytics.
//   #ov-charts    ← `ovChartsRender()` (app.html:2294) — live Xero P&L, donut, legend, per-company bars.
//   #last-refresh ← the SHELL's chrome div (app.html:1117 / finance-shell.tsx:127), which this renderer
//                   reaches out and fills (app.html:2140).
//
// Each gets its own component and its own diff; handler parity runs per section for the same reason
// `finance.users` runs it per section.
//
// ── THE GOLDEN IS NOT AN INTERMEDIATE STATE — CHECKED, NOT ASSUMED ────────────────────────────────
// CLAUDE.md's `finance.qinv` / `finance.users` / `finance.gateway` trap does NOT bite here, and this was
// checked rather than assumed. After its final `#overview` innerHTML write `renderOverview()` does
// exactly three things (app.html:2138-2141): one `insertAdjacentHTML` (which the harness DOES record —
// render_harness.ts:104 appends to the same recorded string, which is why the two empty placeholder divs
// are in the golden), the two lazy loaders that write OTHER ids, and the `#last-refresh` write. No
// `.className=`, no `.value=`, no `appendChild`, no `classList.toggle`. So all four sections hold the
// LOADED screen an operator sees, and the skeleton/loading/error branches are simply outside the golden.
// `renderOverview() does nothing invisible after its write` in the screen's test pins that out of
// app.html's own text, so the claim fails a test rather than silently rotting.
//
// ── SEVENTEEN DOCUMENTS ACROSS FOUR SECTIONS; THE GOLDEN HOLDS ONE PER SECTION ────────────────────
// Counted rather than estimated, because this is where the Users tab's five sub-views went unnoticed:
//   #overview     8 — spin()'s skeleton, the YTD ⚠️ and 📭 branches, the YTD table (GOLDEN), the YTD
//                     table with a filter that matched nothing, the period table, its partial-failure
//                     banner, and its 📭 branch.
//   #ov-trend     4 — the spinner, the 📉 refusal, the ⚠️ throw, the four panels (GOLDEN).
//   #ov-charts    5 — the spinner, the 📉 refusal, the ⚠️ throw, the analysis (GOLDEN), and the same
//                     analysis with the per-company panel suppressed at one company.
//   #last-refresh 1 — the clock (GOLDEN).
// PLUS nine header states: seven presets, a custom range and "Current". Only "Current" is in the golden,
// and only it leaves both date boxes blank.
//
// This screen has TWO DATA MODES behind one route, selected by `OV_RANGE`:
//   • `OV_RANGE === null` — "Current": `{api:'overview'}`, YTD, WITH bank balances. THIS is the golden.
//   • `OV_RANGE !== null` — a period: `{api:'overview_range'}`, income/expenses/net/invoice-counts only,
//     bank deliberately excluded (it is point-in-time). Seven presets plus a custom from/to reach it.
// Neither mode's error, empty or loading branch appears in the golden, nor does the range mode's
// partial-failure banner or its per-company "live data unavailable" row. All are mirrored from the
// legacy source and pinned by assertion in the screen's own test — see its header for the full list.
//
// ── THE ARITHMETIC WAS NOT LIFTED, AND HERE IS THE TEST THAT DECIDED IT ───────────────────────────
// The standard question is "does the server re-derive this figure?". On this screen the sharper question
// is the one `finance.gateway` asks — does anything LEAVE the building? — and the answer is no. Overview
// posts nothing, exports no file and creates nothing in Xero; every figure is either a sum of
// server-supplied per-company values (`overview.companies[].income`, `pnl_report.companies[].revenue_total`)
// or an SVG coordinate. That puts it with `finance.qinv` and `finance.calendar`, not with `wht.js` /
// `o2o.js` / `salesrecon.js` / `gateway.js`.
//
// It is also not mechanically liftable: `ovPnlBars`, `ovMarginLine`, `ovVendorBars`, `ovCumNet`,
// `ovDonut` and `ovBars` fuse the maths to HTML STRING building — the coordinate and the `<rect>` are
// written in the same expression — so a shared module would have to return markup, which React cannot
// use. `hr.dashboard`'s two hand-rolled SVG builders were the same shape and were ported coordinate for
// coordinate rather than lifted; that is the precedent followed here. Every `.toFixed(1)`, every raw
// `padL-6`, every `Math.round` is character for character, and nothing in `relax()` touches an attribute
// VALUE, so the golden diffs them to the last digit. A coordinate that looks wrong is a `needs-decision`,
// not a tidy-up.
//
// ── DATES: TWO KINDS, PINNED TWO DIFFERENT WAYS ───────────────────────────────────────────────────
// `finance.calendar`'s finding is that an output assertion CANNOT see a timezone defect on a fleet that
// sits at UTC+8. Both kinds appear on this screen and they need opposite treatment:
//
//  • DERIVED, and the legacy is deliberately zone-safe. `todayLocalISO()` (app.html:1261) and `ovDates()`
//    (app.html:1601) build `YYYY-MM-DD` by hand — `Date.now()+8h` read back with `getUTC*` for the MYT
//    calendar day, then LOCAL `new Date(y,m,d)` read back with local `getFullYear/getMonth/getDate`, both
//    of which round-trip in any zone. `ovDates()` even carries the comment saying why `toISOString()` is
//    wrong here. Ported character for character, taking the instant as an ARGUMENT (hr.yearend's rule),
//    and the screen's test asserts the SOURCE of both contains no `toISOString` / `toLocale` — because
//    every output assertion for them passes in MYT whether the port is right or not.
//  • FORMATTED, and the legacy uses `toLocaleString` ITSELF. `r.as_of` (app.html:2104) and the
//    `#last-refresh` clock (app.html:2141) are `toLocale*` calls in app.html, so mirroring them means
//    writing `toLocale*` too. Those are read under the harness's UTC override, which the screen's test
//    re-applies for one file exactly as `hr.clock` does. That changes what both sides are READ under, not
//    what counts as a match, so it is not a relaxation.

import { Fragment } from 'react';

/**
 * `PERMS` — resolved by `showApp()` from `my_perms`, with `fallbackPerms()` (app.html:1398) standing in
 * when that call fails.
 */
export interface Perms {
  features?: string[] | null;
}

/**
 * app.html:1434 — the chain's final `else`: `el.classList.toggle('hide', feats.indexOf(t)<0)`.
 *
 * `overview` is named in NO branch of `showApp()`'s block (app.html:1420-1434), so it falls through to
 * that line: a FEATURE flag, not `manage_users`. Read the whole block before copying a neighbour — the
 * two standalone `if`s at the top (`users`, `ctgaccess`) and the `else if` chain that restarts at
 * `ctgaccess` mean adjacent tabs are gated by different rules, and five screens have now found their gate
 * was not their neighbours'. `renderOverview()` itself has no role check at all, so a port that mirrored
 * only the renderer would serve every company's revenue, expenses, net profit and BANK BALANCE to anyone
 * who typed the URL.
 */
export function overviewReachable(perms: Perms | null | undefined): boolean {
  return !!(perms && (perms.features || []).indexOf('overview') >= 0);
}

/* ══ Dates ═════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * `todayLocalISO()` — app.html:1261, character for character, taking the instant as an argument.
 *
 * Zone-safe BY CONSTRUCTION and it must stay that way: `Date.now()+8h` read back with `getUTC*` is the
 * MYT calendar day whatever zone the browser sits in. `new Date().toISOString().slice(0,10)` would print
 * the day before for an operator west of Greenwich, and on this screen that silently shifts the `max=`
 * ceiling of both custom-range inputs. The screen's test asserts this function's SOURCE, not its output —
 * see the header.
 */
export function todayLocalISO(now: number): string {
  const d = new Date(now + 8 * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

/** One period — `OV_RANGE`'s shape (app.html:1600). */
export interface OvRange {
  from: string;
  to: string;
  label: string;
}

/**
 * `ovDates()` — app.html:1601, character for character, taking the instant as an argument.
 *
 * Note `last_quarter` is in here but NOT in `OV_PRESETS`: no button produces it, but `activePreset()`
 * still scans it, so a CUSTOM range that happens to be last quarter resolves to a key no button carries
 * and the header highlights nothing and blanks both date boxes. That is app.html's behaviour and it is
 * mirrored, not fixed.
 */
export function ovDates(now: number): Record<string, OvRange> {
  // H6: base the period presets on MYT wall-clock, not the browser's timezone.
  const myt = new Date(now + 8 * 3600000);
  const y = myt.getUTCFullYear(), m = myt.getUTCMonth();
  const n = new Date(y, m, myt.getUTCDate());   // local Date carrying the MYT calendar day, so p() reads it back correctly
  // Build local-date YYYY-MM-DD (toISOString would shift by timezone — MYT is UTC+8 so midnight Jun 1 became May 31).
  const p = (d: Date) => {
    const yy = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return yy + '-' + mm + '-' + dd;
  };
  const q = Math.floor(m / 3);
  let lq = q - 1, lqy = y;
  if (lq < 0) { lq = 3; lqy = y - 1; }
  return {
    today: { from: p(n), to: p(n), label: 'Today' },
    this_month: { from: p(new Date(y, m, 1)), to: p(new Date(y, m + 1, 0)), label: 'This month' },
    last_month: { from: p(new Date(y, m - 1, 1)), to: p(new Date(y, m, 0)), label: 'Last month' },
    this_quarter: { from: p(new Date(y, q * 3, 1)), to: p(new Date(y, q * 3 + 3, 0)), label: 'This quarter' },
    last_quarter: { from: p(new Date(lqy, lq * 3, 1)), to: p(new Date(lqy, lq * 3 + 3, 0)), label: 'Last quarter' },
    ytd: { from: p(new Date(y, 0, 1)), to: p(n), label: 'Year to date' },
    last_year: { from: p(new Date(y - 1, 0, 1)), to: p(new Date(y - 1, 11, 31)), label: 'Last year' },
  };
}

/** `ovHeader()`'s `presets` — app.html:1631. `current` is the null range, not an entry in `ovDates()`. */
export const OV_PRESETS: [string, string][] = [
  ['current', 'Current'], ['today', 'Today'], ['this_month', 'This month'], ['last_month', 'Last month'],
  ['this_quarter', 'This quarter'], ['ytd', 'YTD'], ['last_year', 'Last year'],
];

/**
 * `ovHeader()`'s `active` — app.html:1632-1636. `''` means "a custom range", which is the ONLY state in
 * which the two date boxes are pre-filled.
 */
export function activePreset(range: OvRange | null, now: number): string {
  if (!range) return 'current';
  const d = ovDates(now);
  for (const k in d) {
    if (d[k].from === range.from && d[k].to === range.to) return k;
  }
  return '';
}

/* ══ Formatters ════════════════════════════════════════════════════════════════════════════════════ */

/** `M()` — app.html:1256. Mirrored rather than imported: a currency FORMAT, not maths. */
const M = (n: unknown) =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `cfoMk()` — app.html:1683, the compact axis label. */
export function cfoMk(v: unknown): string {
  let x = Number(v) || 0;
  const s = x < 0 ? '-' : '';
  x = Math.abs(x);
  if (x >= 1e6) return s + 'RM' + (x / 1e6).toFixed(x >= 1e7 ? 0 : 1) + 'M';
  if (x >= 1e3) return s + 'RM' + Math.round(x / 1e3) + 'k';
  return s + 'RM' + Math.round(x);
}

/** `cfoShortName()` — app.html:1687. */
export function cfoShortName(n: unknown): string {
  return String(n || '').replace(/\s*(SDN\s*BHD|CTG4U)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** `OV_PALETTE` — app.html:2256. */
export const OV_PALETTE = ['#e85d3c', '#f5a623', '#3ddc97', '#5b9bd5', '#a479e2', '#f291b3', '#16a766', '#ff7537', '#4a86e8', '#cf8933', '#9aa7b8'];

/**
 * Every inline style is written as a STRING and split here, not as a React style object — finance.wht's
 * `st()`, copied. Nothing in `relax()` touches an attribute VALUE, so `style=` is compared character for
 * character; a React style OBJECT hands the serialiser two chances to change it silently (it appends
 * `px` to a bare number and re-serialises `.10` as `0.1`, which is exactly what `hr.dashboard`'s SVG
 * areas would have hit). Keeping the legacy string as the source means the value here IS app.html's.
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

/* ══ #overview ═════════════════════════════════════════════════════════════════════════════════════ */

/** One row of `{api:'overview'}`.companies — app.html:2087. */
export interface OvCompany {
  tenant_id: string;
  tenant_name: string;
  income: number;
  expenses: number;
  net_profit: number;
  bank: number;
}

/** `{api:'overview'}` — app.html:2086. */
export interface OvYtd {
  companies: OvCompany[];
  as_of?: string | null;
}

/** One row of `{api:'overview_range'}`.companies. A failed company carries `error` / a null `income`. */
export interface OvRangeCompany {
  tenant_id: string;
  tenant_name: string;
  income: number | null;
  expenses: number | null;
  net_profit: number | null;
  ar_count?: number | null;
  ap_count?: number | null;
  error?: string | null;
}

/** `{api:'overview_range'}` — app.html:2108. */
export interface OvRangeData {
  companies: OvRangeCompany[];
  partial?: boolean;
  unavailable?: string[] | null;
  source?: string | null;
}

/** `mkCard()` — app.html:1597. */
function Card({ cls, ico, n, l }: { cls: string; ico: string; n: string; l: string }) {
  return (
    <div className={'card ' + cls}>
      <div className="c-ico">{ico}</div>
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}

/** `spin('overview')` — app.html:1539, character for character. In no golden; see the header. */
function Loading() {
  return (
    <>
      <div className="cards">
        <div className="sk-card"></div><div className="sk-card"></div><div className="sk-card"></div><div className="sk-card"></div>
      </div>
      <div className="sk-row"></div>
      <div className="sk-row"></div>
      <div className="sk-row" style={st('width:65%')}></div>
    </>
  );
}

/** app.html:2086/2087/2109 — the bare `.empty` blocks, none of them wrapped in a panel. */
function Empty({ ico, children }: { ico: string; children: React.ReactNode }) {
  return <div className="empty"><div className="empty-ico">{ico}</div><div>{children}</div></div>;
}

export interface OvHeaderProps {
  /** `OV_RANGE` — app.html:1600. `null` is "Current" (the YTD action). */
  range: OvRange | null;
  /** The instant `todayLocalISO()` and `ovDates()` are read from. Never read from the clock in here. */
  now: number;
  /** `ovSetPreset(key)` — app.html:1618. */
  onPreset: (key: string) => void;
  /** `ovApplyCustom()` — app.html:1623. Reads `#ov_from` / `#ov_to` back out of the DOM; see below. */
  onApplyCustom: () => void;
}

/**
 * `ovHeader()` — app.html:1630. Rendered in EVERY branch, including the error and empty ones.
 *
 * The two date inputs stay UNCONTROLLED and keep their legacy ids, because `ovApplyCustom()`
 * (app.html:1624) reads `document.getElementById('ov_from').value` — `finance.recon`'s `rc_co` rule.
 * Making them controlled would add an `onChange` the golden does not carry (handler parity fails) and a
 * `value` React re-emits on every keystroke.
 */
export function OvHeader({ range, now, onPreset, onApplyCustom }: OvHeaderProps) {
  const active = activePreset(range, now);
  const today = todayLocalISO(now);
  const fromV = (range && active === '') ? range.from : '';
  const toV = (range && active === '') ? range.to : '';
  return (
    <div className="panel" style={st('padding:14px 16px;margin-bottom:14px')}>
      <div style={st('display:flex;flex-wrap:wrap;align-items:center;gap:10px')}>
        <span className="muted" style={st('font-size:11px;text-transform:uppercase;letter-spacing:.6px;font-weight:700')}>Period</span>
        <div style={st('display:flex;flex-wrap:wrap;gap:6px')}>
          {/* `.join(' ')` in app.html:1637 — the single space between buttons is part of the golden. */}
          {OV_PRESETS.map((p, i) => (
            <Fragment key={p[0]}>
              {i > 0 ? ' ' : null}
              <button className={'btn sm ' + (active === p[0] ? 'p' : '')} onClick={() => onPreset(p[0])}>{p[1]}</button>
            </Fragment>
          ))}
        </div>
        <span className="muted" style={st('font-size:11px')}>·</span>
        <span className="muted" style={st('font-size:11.5px')}>Custom:</span>
        <input type="date" id="ov_from" defaultValue={fromV} max={today} style={st('font-size:12px;padding:5px 8px;width:auto')} />
        <span className="muted">→</span>
        <input type="date" id="ov_to" defaultValue={toV} max={today} style={st('font-size:12px;padding:5px 8px;width:auto')} />
        <button className="btn sm" onClick={onApplyCustom}>Apply</button>
        {range ? <span className="pill pill-coral" style={st('margin-left:6px')}>{range.label}</span> : null}
      </div>
    </div>
  );
}

export interface FinanceOverviewProps extends OvHeaderProps {
  /** `curCo()` — app.html:1538. '' is "— All Companies —". */
  filter: string;
  /** `{api:'overview'}`'s payload when `range === null`. `null` is the pre-response state — `spin()`. */
  ytd: OvYtd | null;
  /** `{api:'overview_range'}`'s payload when `range !== null`. `null` is the pre-response state. */
  rangeData: OvRangeData | null;
  /** app.html:2086 — `r.ok===false`'s message (YTD), or `r.error` (range). `null` when there is none. */
  error: string | null;
  /** app.html:2087 / :2109 — a response that carried no `companies` array at all. */
  noData?: boolean;
  /** `#ov-trend`'s content. Absent in an error branch, because app.html returns before appending it. */
  trend?: React.ReactNode;
  /** `#ov-charts`'s content. Same. */
  charts?: React.ReactNode;
}

/**
 * `renderOverview()` — app.html:2081. This component is every byte of the `#overview` tab div, including
 * the two placeholder divs `insertAdjacentHTML` appends (app.html:2139) — which are in the golden, empty,
 * because the harness records that append into the same string (render_harness.ts:104).
 */
export default function FinanceOverview(props: FinanceOverviewProps) {
  const header = <OvHeader range={props.range} now={props.now} onPreset={props.onPreset} onApplyCustom={props.onApplyCustom} />;

  // app.html:2086 / :2109 — BOTH modes return before appending the trend and charts placeholders, so an
  // error screen carries neither. Collapsing that would paint two empty divs under an error message.
  if (props.range === null) {
    if (props.error !== null) return <>{header}<Empty ico="⚠️">{props.error}</Empty></>;
    if (props.noData) return <>{header}<Empty ico="📭">No data available</Empty></>;
  } else {
    if (props.error !== null || props.noData) {
      return <>{header}<Empty ico="📭">{props.error || 'No data in this period'}</Empty></>;
    }
  }

  const payload = props.range === null ? props.ytd : props.rangeData;
  if (!payload) return <>{header}<Loading /></>;

  return (
    <>
      {header}
      {props.range === null
        ? <YtdBody data={props.ytd as OvYtd} filter={props.filter} />
        : <RangeBody data={props.rangeData as OvRangeData} filter={props.filter} range={props.range} />}
      <div id="ov-trend" style={st('margin-top:14px')}>{props.trend}</div>
      <div id="ov-charts" style={st('margin-top:14px')}>{props.charts}</div>
    </>
  );
}

/**
 * app.html:2088-2105 — the DEFAULT mode, and the only one the golden holds.
 *
 * Note what this mode shows that the range mode deliberately does not: BANK BALANCES. Every figure here
 * is a sum of the server's own per-company values; nothing is re-derived. See the header on why nothing
 * was lifted.
 */
function YtdBody({ data, filter }: { data: OvYtd; filter: string }) {
  const cs = (data.companies || []).filter((c) => !filter || c.tenant_id === filter);
  const tot = cs.reduce(
    (a, c) => ({ inc: a.inc + +c.income, exp: a.exp + +c.expenses, np: a.np + +c.net_profit, bank: a.bank + +c.bank }),
    { inc: 0, exp: 0, np: 0, bank: 0 },
  );
  return (
    <>
      <div className="cards">
        <Card cls="blue" ico="🏦" n={M(tot.bank)} l="Total Cash" />
        <Card cls={tot.np >= 0 ? 'green' : 'red'} ico="📈" n={M(tot.np)} l="Net Profit (YTD)" />
        <Card cls="green" ico="💰" n={M(tot.inc)} l="Total Revenue" />
        <Card cls="amber" ico="📤" n={M(tot.exp)} l="Total Expenses" />
      </div>
      {cs.length ? (
        <div className="panel">
          <div className="panel-hd">
            <h3>Company Financials (YTD)</h3>
            {cs.length > 1 ? <span className="pill pill-coral">{cs.length + ' companies'}</span> : null}
          </div>
          <div className="tbl-wrap">
            <table className="bigtable">
              <thead>
                <tr>
                  <th>Company</th><th className="amt">Revenue</th><th className="amt">Expenses</th>
                  <th className="amt">Net Profit</th><th className="amt">Cash</th>
                </tr>
              </thead>
              <tbody>
                {cs.map((c) => (
                  <tr key={c.tenant_id}>
                    <td><b>{c.tenant_name}</b></td>
                    <td className="amt" style={st('color:var(--green-soft)')}>{M(c.income)}</td>
                    <td className="amt" style={st('color:var(--red-soft)')}>{M(c.expenses)}</td>
                    <td className="amt" style={{ color: +c.net_profit >= 0 ? 'var(--green-soft)' : 'var(--red-soft)' }}>{M(c.net_profit)}</td>
                    <td className="amt">{M(c.bank)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {data.as_of ? (
        <div className="status-bar">
          <div className="dot-green"></div>
          {/* app.html:2104 — `toLocaleString` in app.html, so `toLocaleString` here. See the header on
              why this is read under a zone override in the test rather than rewritten. */}
          {'Data as of ' + new Date(data.as_of).toLocaleString('en-GB', {
            year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
          }) + ' · Auto-refreshed hourly'}
        </div>
      ) : null}
    </>
  );
}

/**
 * app.html:2110-2135 — the PERIOD mode. Outside the golden entirely; pinned by assertion.
 *
 * B4 (app.html:2113): a company whose live fetch failed comes back with NULL figures and an `error`. It
 * is NOT zero. It is excluded from the totals — `+null` is 0 and would silently understate the group —
 * and rendered as "unavailable" rather than RM 0.00. Do not collapse the two.
 */
function RangeBody({ data, filter, range }: { data: OvRangeData; filter: string; range: OvRange }) {
  const cs = (data.companies || []).filter((c) => !filter || c.tenant_id === filter);
  const errRows = cs.filter((c) => c.error || c.income === null);
  const okRows = cs.filter((c) => !(c.error || c.income === null));
  const tot = okRows.reduce(
    (a, c) => ({
      inc: a.inc + +(c.income as number), exp: a.exp + +(c.expenses as number), np: a.np + +(c.net_profit as number),
      ar: a.ar + (+(c.ar_count || 0) || 0), ap: a.ap + (+(c.ap_count || 0) || 0),
    }),
    { inc: 0, exp: 0, np: 0, ar: 0, ap: 0 },
  );
  const counts = (c: OvRangeCompany) => (+(c.ar_count || 0) || 0) + '·AR / ' + (+(c.ap_count || 0) || 0) + '·AP';
  return (
    <>
      {(data.partial || errRows.length) ? (
        <div className="status-bar" style={st('background:rgba(224,113,78,.12);border-color:var(--coral)')}>
          <div style={st('color:var(--coral)')}>⚠️</div>
          {'Live Xero data unavailable for ' + errRows.length + ' company(ies): ' +
            (data.unavailable || errRows.map((c) => c.tenant_name)).join(', ') +
            '. Totals below EXCLUDE them — retry in a moment.'}
        </div>
      ) : null}
      <div className="cards">
        <Card cls={tot.np >= 0 ? 'green' : 'red'} ico="📈" n={M(tot.np)} l="Net (in period)" />
        <Card cls="green" ico="💰" n={M(tot.inc)} l="Revenue (in period)" />
        <Card cls="amber" ico="📤" n={M(tot.exp)} l="Expenses (in period)" />
        <Card cls="blue" ico="📄" n={(tot.ar + tot.ap).toLocaleString()} l="Invoices in period" />
      </div>
      <div className="panel">
        <div className="panel-hd">
          <h3>{'Company Financials · ' + range.label}</h3>
          {cs.length > 1 ? <span className="pill pill-coral">{cs.length + ' companies'}</span> : null}
        </div>
        <div className="tbl-wrap">
          <table className="bigtable">
            <thead>
              <tr>
                <th>Company</th><th className="amt">Revenue</th><th className="amt">Expenses</th>
                <th className="amt">Net</th><th className="amt">Invoices</th>
              </tr>
            </thead>
            <tbody>
              {cs.map((c) => (c.error || c.income === null) ? (
                <tr key={c.tenant_id}>
                  <td><b>{c.tenant_name}</b></td>
                  <td className="amt muted" colSpan={3} style={st('text-align:center;color:var(--coral)')}>⚠️ live data unavailable — not counted</td>
                  <td className="amt muted" style={st('font-size:11.5px')}>{counts(c)}</td>
                </tr>
              ) : (
                <tr key={c.tenant_id}>
                  <td><b>{c.tenant_name}</b></td>
                  <td className="amt" style={st('color:var(--green-soft)')}>{M(c.income)}</td>
                  <td className="amt" style={st('color:var(--red-soft)')}>{M(c.expenses)}</td>
                  <td className="amt" style={{ color: +(c.net_profit as number) >= 0 ? 'var(--green-soft)' : 'var(--red-soft)' }}>{M(c.net_profit)}</td>
                  <td className="amt muted" style={st('font-size:11.5px')}>{counts(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="status-bar">
        <div className="dot-green" style={data.partial ? st('background:var(--coral)') : undefined}></div>
        {range.from + ' → ' + range.to + ' · ' + (data.source || 'From cached invoices (AR + AP)') + '. Bank balance excluded for period view.'}
      </div>
    </>
  );
}

/* ══ #ov-trend ═════════════════════════════════════════════════════════════════════════════════════ */

/** One month of `{api:'group_dashboard'}`.monthly — app.html:2232. */
export interface OvMonth {
  month: string;
  revenue?: number | null;
  bills?: number | null;
}

/** One row of `{api:'group_dashboard'}`.top_vendors — app.html:2233. */
export interface OvVendor {
  vendor: string;
  spend?: number | null;
}

/**
 * `ovPnlBars()` — app.html:2158, coordinate for coordinate.
 *
 * `hr.dashboard`'s rule: the computed numbers go straight into attribute VALUES, nothing in `relax()`
 * touches an attribute value, so every `.toFixed(1)` here is diffed to the last digit against the golden.
 * A coordinate that looks wrong is a `needs-decision`, not a fix. Note the two React spellings that would
 * quietly break it and are avoided throughout: a NUMERIC style value (React appends `px` and re-writes
 * `.10` as `0.1`) and adjacent `{a} {b}` text expressions — every string is built in JS and interpolated
 * once.
 */
function OvPnlBars({ mon }: { mon: OvMonth[] }) {
  const n = (mon || []).length;
  if (!n) return <div className="muted" style={st('padding:16px')}>No monthly data.</div>;
  const w = 780, h = 270, padL = 52, padR = 12, padT = 16, padB = 42;
  const nets = mon.map((m) => (Number(m.revenue) || 0) - (Number(m.bills) || 0));
  const top = Math.max.apply(null, [1].concat(mon.map((m) => Math.max(Number(m.revenue) || 0, Number(m.bills) || 0))));
  const bot = Math.min.apply(null, [0].concat(nets));
  const rng = (top - bot) || 1;
  const y = (v: number) => padT + (top - v) / rng * (h - padT - padB);
  const zy = y(0), slot = (w - padL - padR) / n, bw = Math.min(13, slot * 0.32);
  const grid = [];
  for (let k = 0; k <= 4; k++) {
    const gv = top - (k / 4) * rng, gy = y(gv);
    grid.push(
      <Fragment key={k}>
        <line x1={padL} y1={gy.toFixed(1)} x2={w - padR} y2={gy.toFixed(1)} stroke="var(--border)" strokeWidth="1" opacity=".5" />
        <text x={padL - 6} y={(gy + 3).toFixed(1)} textAnchor="end" fontSize="8.5" fill="var(--muted)">{cfoMk(gv)}</text>
      </Fragment>,
    );
  }
  return (
    <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={st('display:block')}>
      {grid}
      <line x1={padL} y1={zy.toFixed(1)} x2={w - padR} y2={zy.toFixed(1)} stroke="var(--border)" strokeWidth="1.5" />
      {mon.map((m, i) => {
        const cx = padL + slot * i + slot / 2, rev = Number(m.revenue) || 0, exp = Number(m.bills) || 0;
        return (
          <Fragment key={i}>
            <rect x={(cx - bw - 1).toFixed(1)} y={y(rev).toFixed(1)} width={String(bw)} height={Math.abs(zy - y(rev)).toFixed(1)} fill="#3ddc97" opacity=".9">
              <title>{m.month + ' Revenue ' + M(rev)}</title>
            </rect>
            <rect x={(cx + 1).toFixed(1)} y={y(exp).toFixed(1)} width={String(bw)} height={Math.abs(zy - y(exp)).toFixed(1)} fill="#e85d3c" opacity=".85">
              <title>{m.month + ' Expenses ' + M(exp)}</title>
            </rect>
            {(n > 8 && i % 2) ? null : (
              <text x={cx.toFixed(1)} y={h - padB + 13} textAnchor="middle" fontSize="8.5" fill="var(--muted)">{m.month.slice(5)}</text>
            )}
          </Fragment>
        );
      })}
      <path d={nets.map((v, i) => (i ? 'L' : 'M') + (padL + slot * i + slot / 2).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ')} fill="none" stroke="#5b9bd5" strokeWidth="2" />
      {nets.map((v, i) => (
        <circle key={i} cx={(padL + slot * i + slot / 2).toFixed(1)} cy={y(v).toFixed(1)} r="2" fill="#5b9bd5">
          <title>{mon[i].month + ' Net ' + M(v)}</title>
        </circle>
      ))}
    </svg>
  );
}

/** `ovMarginLine()` — app.html:2180, coordinate for coordinate. */
function OvMarginLine({ mon }: { mon: OvMonth[] }) {
  const pts = (mon || []).map((m) => {
    const r = Number(m.revenue) || 0;
    return { month: m.month, pct: r > 0 ? ((r - (Number(m.bills) || 0)) / r * 100) : 0 };
  });
  const n = pts.length;
  if (!n) return null;
  const w = 780, h = 170, padL = 46, padR = 12, padT = 14, padB = 28;
  const vals = pts.map((p) => p.pct);
  let top = Math.max.apply(null, [10].concat(vals));
  const bot = Math.min.apply(null, [0].concat(vals));
  if (top === bot) top = bot + 10;
  const rng = top - bot;
  const xat = (i: number) => padL + (n <= 1 ? (w - padL - padR) / 2 : i * (w - padL - padR) / (n - 1));
  const y = (v: number) => padT + (top - v) / rng * (h - padT - padB);
  const grid = [];
  for (let k = 0; k <= 2; k++) {
    const gv = top - (k / 2) * rng, gy = y(gv);
    grid.push(
      <Fragment key={k}>
        <line x1={padL} y1={gy.toFixed(1)} x2={w - padR} y2={gy.toFixed(1)} stroke="var(--border)" strokeWidth="1" opacity=".5" />
        <text x={padL - 6} y={(gy + 3).toFixed(1)} textAnchor="end" fontSize="8.5" fill="var(--muted)">{Math.round(gv) + '%'}</text>
      </Fragment>,
    );
  }
  const zy = (bot < 0 && top > 0) ? y(0) : null;
  return (
    <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={st('display:block')}>
      {grid}
      {zy != null ? <line x1={padL} y1={zy.toFixed(1)} x2={w - padR} y2={zy.toFixed(1)} stroke="var(--border)" strokeWidth="1" /> : null}
      <path d={pts.map((p, i) => (i ? 'L' : 'M') + xat(i).toFixed(1) + ' ' + y(p.pct).toFixed(1)).join(' ')} fill="none" stroke="#a479e2" strokeWidth="2.5" />
      {pts.map((p, i) => (
        <circle key={i} cx={xat(i).toFixed(1)} cy={y(p.pct).toFixed(1)} r="2.5" fill={p.pct >= 0 ? '#3ddc97' : '#e85d3c'}>
          <title>{p.month + ' ' + Math.round(p.pct) + '%'}</title>
        </circle>
      ))}
      {pts.map((p, i) => (n > 8 && i % 2) ? null : (
        <text key={i} x={xat(i).toFixed(1)} y={h - padB + 13} textAnchor="middle" fontSize="8.5" fill="var(--muted)">{p.month.slice(5)}</text>
      ))}
    </svg>
  );
}

/** `ovVendorBars()` — app.html:2199. The golden holds its EMPTY branch: the fixture has no top_vendors. */
function OvVendorBars({ vendors }: { vendors: OvVendor[] }) {
  const vs = (vendors || []).slice(0, 8);
  if (!vs.length) return <div className="muted" style={st('padding:14px')}>No vendor spend in period.</div>;
  const tot = vs.reduce((s, v) => s + (Number(v.spend) || 0), 0) || 1;
  const max = Math.max.apply(null, [1].concat(vs.map((v) => Number(v.spend) || 0)));
  return (
    <div style={st('padding:2px 0')}>
      {vs.map((v, i) => {
        const sp = Number(v.spend) || 0, barW = Math.round(sp / max * 100), share = Math.round(sp / tot * 100);
        const col = OV_PALETTE[i % OV_PALETTE.length];
        return (
          <div key={i} style={st('display:flex;align-items:center;gap:10px;padding:5px 0')}>
            <span className="muted" style={st('width:16px;font-size:11px')}>{String(i + 1)}</span>
            <span style={st('flex:1;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{cfoShortName(v.vendor)}</span>
            <div style={st('width:130px;background:var(--panel-2);border-radius:4px;height:8px;overflow:hidden')}>
              <div style={st('width:' + barW + '%;height:100%;background:' + col)}></div>
            </div>
            <span className="amt" style={st('width:92px;font-size:12px')}>{M(sp)}</span>
            <span className="muted" style={st('width:34px;text-align:right;font-size:11px')}>{share + '%'}</span>
          </div>
        );
      })}
    </div>
  );
}

/** `ovCumNet()` — app.html:2218, coordinate for coordinate. */
function OvCumNet({ mon }: { mon: OvMonth[] }) {
  const n = (mon || []).length;
  if (!n) return null;
  let cum = 0;
  const pts = mon.map((m) => { cum += (Number(m.revenue) || 0) - (Number(m.bills) || 0); return { month: m.month, v: cum }; });
  const w = 780, h = 200, padL = 52, padR = 12, padT = 14, padB = 28;
  const vals = pts.map((p) => p.v);
  const top = Math.max.apply(null, [1].concat(vals)), bot = Math.min.apply(null, [0].concat(vals));
  const rng = (top - bot) || 1;
  const xat = (i: number) => padL + (n <= 1 ? (w - padL - padR) / 2 : i * (w - padL - padR) / (n - 1));
  const y = (v: number) => padT + (top - v) / rng * (h - padT - padB);
  const grid = [];
  for (let k = 0; k <= 3; k++) {
    const gv = top - (k / 3) * rng, gy = y(gv);
    grid.push(
      <Fragment key={k}>
        <line x1={padL} y1={gy.toFixed(1)} x2={w - padR} y2={gy.toFixed(1)} stroke="var(--border)" strokeWidth="1" opacity=".5" />
        <text x={padL - 6} y={(gy + 3).toFixed(1)} textAnchor="end" fontSize="8.5" fill="var(--muted)">{cfoMk(gv)}</text>
      </Fragment>,
    );
  }
  const zy = (bot < 0 && top > 0) ? y(0) : null, baseY = (zy != null ? zy : (h - padB));
  const area = 'M' + xat(0).toFixed(1) + ' ' + baseY.toFixed(1) + ' ' +
    pts.map((p, i) => 'L' + xat(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ') +
    ' L' + xat(n - 1).toFixed(1) + ' ' + baseY.toFixed(1) + ' Z';
  return (
    <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={st('display:block')}>
      {grid}
      {zy != null ? <line x1={padL} y1={zy.toFixed(1)} x2={w - padR} y2={zy.toFixed(1)} stroke="var(--border)" strokeWidth="1" /> : null}
      {/* `opacity=".10"` is an ATTRIBUTE, not a style — a React style object would print `0.1`. */}
      <path d={area} fill="#3ddc97" opacity=".10" />
      <path d={pts.map((p, i) => (i ? 'L' : 'M') + xat(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ')} fill="none" stroke="#3ddc97" strokeWidth="2.5" />
      {pts.map((p, i) => (
        <circle key={i} cx={xat(i).toFixed(1)} cy={y(p.v).toFixed(1)} r="2.2" fill="#3ddc97">
          <title>{p.month + ' Cumulative ' + M(p.v)}</title>
        </circle>
      ))}
      {pts.map((p, i) => (n > 8 && i % 2) ? null : (
        <text key={i} x={xat(i).toFixed(1)} y={h - padB + 13} textAnchor="middle" fontSize="8.5" fill="var(--muted)">{p.month.slice(5)}</text>
      ))}
    </svg>
  );
}

/** `ovTrendLoad()`'s first write — app.html:2149. In no golden; pinned by assertion. */
export function OvTrendLoading() {
  return (
    <div className="panel">
      <div className="panel-hd"><h3>📊 Revenue vs Expenses · monthly P&amp;L</h3></div>
      <div className="muted" style={st('padding:22px;text-align:center')}>
        <div className="spinner" style={st('margin:0 auto 10px')}></div>Loading analytics…
      </div>
    </div>
  );
}

/** `ovTrendLoad()`'s failure branches — app.html:2153 / :2156. In no golden; pinned by assertion. */
export function OvTrendError({ ico, message }: { ico: string; message: string }) {
  return <div className="panel"><Empty ico={ico}>{message}</Empty></div>;
}

/**
 * `ovTrendRender()` — app.html:2230. Every byte of `#ov-trend`.
 *
 * The four KPI figures are sums over `monthly[]` and one `Math.round` of a ratio — a display echo of
 * figures the server owns, `finance.qinv`'s case, not a second copy of a formula. See the header.
 */
export function OvTrend({ monthly, vendors }: { monthly: OvMonth[]; vendors: OvVendor[] }) {
  const mon = monthly || [];
  const totRev = mon.reduce((s, m) => s + (Number(m.revenue) || 0), 0);
  const totExp = mon.reduce((s, m) => s + (Number(m.bills) || 0), 0);
  const net = totRev - totExp, margin = totRev > 0 ? Math.round(net / totRev * 100) : 0;
  return (
    <>
      <div className="panel">
        <div className="panel-hd">
          <h3>📊 Revenue vs Expenses · monthly P&L</h3>
          <div className="muted" style={st('font-size:11.5px')}>
            <span style={st('color:#3ddc97')}>■</span>{' Revenue \u00a0'}
            <span style={st('color:#e85d3c')}>■</span>{' Expenses \u00a0'}
            <span style={st('color:#5b9bd5')}>━</span>{' Net'}
          </div>
        </div>
        <div className="cards" style={st('grid-template-columns:repeat(4,1fr);margin-bottom:12px')}>
          <div className="card">
            <div className="c-ico">💰</div>
            <div className="n" style={st('color:var(--green-soft)')}>{M(totRev)}</div>
            <div className="l">Revenue · 12mo</div>
          </div>
          <div className="card">
            <div className="c-ico">📤</div>
            <div className="n" style={st('color:var(--red-soft)')}>{M(totExp)}</div>
            <div className="l">Expenses (bills)</div>
          </div>
          <div className={'card ' + (net >= 0 ? 'green' : 'red')}>
            <div className="c-ico">📈</div>
            <div className="n" style={{ color: net >= 0 ? 'var(--green-soft)' : 'var(--red-soft)' }}>{M(net)}</div>
            <div className="l">Net</div>
          </div>
          <div className="card">
            <div className="c-ico">📊</div>
            <div className="n" style={{ color: margin >= 0 ? 'var(--sky-soft)' : 'var(--red-soft)' }}>{margin + '%'}</div>
            <div className="l">Margin</div>
          </div>
        </div>
        <OvPnlBars mon={mon} />
        <div className="muted" style={st('font-size:11px;margin-top:8px')}>From the reliable invoice cache: Revenue = AR invoicing, Expenses = supplier bills (AP). Excludes payroll/depreciation and other non-billed costs — not a full accounting P&L.</div>
      </div>
      <div className="panel" style={st('margin-top:14px')}>
        <div className="panel-hd">
          <h3>📉 Net margin % trend</h3>
          <span className="muted" style={st('font-size:11px')}>{'Net ÷ Revenue'}</span>
        </div>
        <OvMarginLine mon={mon} />
      </div>
      <div className="panel" style={st('margin-top:14px')}>
        <div className="panel-hd">
          <h3>🏭 Expense breakdown · top vendors</h3>
          <span className="muted" style={st('font-size:11px')}>Trailing 12 months · who spent the most</span>
        </div>
        <OvVendorBars vendors={vendors || []} />
      </div>
      <div className="panel" style={st('margin-top:14px')}>
        <div className="panel-hd">
          <h3>💵 Cumulative operating net</h3>
          <span className="muted" style={st('font-size:11px')}>Revenue − bills, cumulated monthly</span>
        </div>
        <OvCumNet mon={mon} />
        <div className="muted" style={st('font-size:11px;margin-top:8px')}>Cumulative operating net (AR − AP bills), showing the trend of retained funds — <b>not a bank balance</b>. For a true bank-balance history I can add a monthly snapshot job that builds the real trend over time.</div>
      </div>
    </>
  );
}

/* ══ #ov-charts ════════════════════════════════════════════════════════════════════════════════════ */

/** One expense account of `{api:'pnl_report'}`.companies[].expenses — app.html:2305. */
export interface PnlExpense {
  name: string;
  amount?: number | null;
}

/** One company of `{api:'pnl_report'}` — app.html:2298. */
export interface PnlCompany {
  tenant_id: string;
  tenant_name: string;
  revenue_total?: number | null;
  expense_total?: number | null;
  net_profit?: number | null;
  expenses?: PnlExpense[] | null;
  error?: string | null;
}

/** `{api:'pnl_report'}` — app.html:2262. */
export interface PnlReport {
  companies: PnlCompany[];
  from?: string | null;
  to?: string | null;
}

interface Seg { label: string; value: number; color: string }

/**
 * `ovDonut()` — app.html:2271, coordinate for coordinate, including the empty-total ring.
 *
 * The arc string is built with the same `.toFixed(1)` on the point coordinates and the RAW `r` / `inner`
 * on the radii, in that exact mix — `A85 85 0 1 1 …` next to `L67.8 131.2`. Normalising that to one
 * precision would be a silent visual change with nothing to catch it but this golden.
 */
function OvDonut({ segs, total, size }: { segs: Seg[]; total: number; size: number }) {
  const r = size / 2, cx = r, cy = r, inner = r * 0.58;
  if (total <= 0) {
    return (
      <svg viewBox={'0 0 ' + size + ' ' + size} width={String(size)} height={String(size)}>
        <circle cx={String(cx)} cy={String(cy)} r={String((r + inner) / 2)} fill="none" stroke="var(--panel-2)" strokeWidth={String(r - inner)} />
      </svg>
    );
  }
  let a0 = -Math.PI / 2;
  const arcs = segs.map((s, i) => {
    const frac = Math.max(0, s.value) / total, a1 = a0 + frac * 2 * Math.PI, large = (a1 - a0) > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const xi1 = cx + inner * Math.cos(a1), yi1 = cy + inner * Math.sin(a1), xi0 = cx + inner * Math.cos(a0), yi0 = cy + inner * Math.sin(a0);
    const p = 'M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
      ' L' + xi1.toFixed(1) + ' ' + yi1.toFixed(1) + ' A' + inner + ' ' + inner + ' 0 ' + large + ' 0 ' + xi0.toFixed(1) + ' ' + yi0.toFixed(1) + ' Z';
    a0 = a1;
    return <path key={i} d={p} fill={s.color}><title>{s.label + ': ' + M(s.value)}</title></path>;
  });
  return <svg viewBox={'0 0 ' + size + ' ' + size} width={String(size)} height={String(size)}>{arcs}</svg>;
}

/** `ovBars()` — app.html:2285, coordinate for coordinate. */
function OvBars({ items, w, h }: { items: Seg[]; w: number; h: number }) {
  const pad = 34, max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  const bw = (w - 2 * pad) / items.length;
  return (
    <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={st('display:block')}>
      {items.map((it, i) => {
        const bh = Math.max(2, (Math.abs(it.value) / max) * (h - 2 * pad));
        const x = pad + i * bw + bw * 0.18, bwid = bw * 0.64, y = h - pad - bh;
        return (
          <Fragment key={i}>
            <rect x={x.toFixed(1)} y={y.toFixed(1)} width={bwid.toFixed(1)} height={bh.toFixed(1)} rx="5" fill={it.color}>
              <title>{it.label + ': ' + M(it.value)}</title>
            </rect>
            <text x={(x + bwid / 2).toFixed(1)} y={(y - 6).toFixed(1)} textAnchor="middle" fontSize="12" fill="var(--text)" fontWeight="600">{M(it.value)}</text>
            <text x={(x + bwid / 2).toFixed(1)} y={h - pad + 16} textAnchor="middle" fontSize="11" fill="var(--muted)">{it.label}</text>
          </Fragment>
        );
      })}
    </svg>
  );
}

/** `ovChartsLoad()`'s first write — app.html:2260. In no golden; pinned by assertion. */
export function OvChartsLoading() {
  return (
    <div className="panel">
      <div className="panel-hd"><h3>💹 Profit &amp; Expense Analysis</h3></div>
      <div className="muted" style={st('padding:24px;text-align:center')}>
        <div className="spinner" style={st('margin:0 auto 10px')}></div>Pulling live Profit &amp; Loss from Xero… (a few seconds)
      </div>
    </div>
  );
}

/** `ovChartsLoad()`'s failure branches — app.html:2267 / :2269. In no golden; pinned by assertion. */
export function OvChartsError({ ico, message }: { ico: string; message: string }) {
  return <div className="panel"><Empty ico={ico}>{message}</Empty></div>;
}

/**
 * `ovChartsRender()` — app.html:2294. Every byte of `#ov-charts`.
 *
 * The consolidation here — sum the per-company totals, merge expense accounts BY NAME across companies,
 * sort desc, keep the top 8 and fold the rest into "Other" — is display aggregation of figures Xero's own
 * Profit & Loss produced. Nothing is posted and nothing is exported, so there is no second computation to
 * fork from; see the header on why nothing was lifted.
 */
export function OvCharts({ report, filter }: { report: PnlReport; filter: string }) {
  let cos = (report.companies || []).filter((c) => !filter || c.tenant_id === filter);
  const errs = cos.filter((c) => c.error);
  cos = cos.filter((c) => !c.error);
  const rev = cos.reduce((s, c) => s + Number(c.revenue_total || 0), 0);
  const exp = cos.reduce((s, c) => s + Number(c.expense_total || 0), 0);
  const net = cos.reduce((s, c) => s + Number(c.net_profit || 0), 0);
  const expMap: Record<string, number> = {};
  cos.forEach((c) => (c.expenses || []).forEach((e) => { expMap[e.name] = (expMap[e.name] || 0) + Number(e.amount || 0); }));
  let expList = Object.keys(expMap).map((k) => ({ name: k, amount: expMap[k] })).sort((a, b) => b.amount - a.amount);
  const TOP = 8;
  if (expList.length > TOP) {
    const top = expList.slice(0, TOP);
    const others = expList.slice(TOP).reduce((s, x) => s + x.amount, 0);
    top.push({ name: 'Other', amount: others });
    expList = top;
  }
  const segs: Seg[] = expList.map((e, i) => ({ label: e.name, value: e.amount, color: OV_PALETTE[i % OV_PALETTE.length] }));
  const margin = rev > 0 ? (net / rev * 100) : 0;
  const periodLbl = report.from && report.to ? (report.from + ' → ' + report.to) : 'last 12 months';

  const legend = segs.length ? segs.map((s, i) => (
    <div key={i} style={st('display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0')}>
      <span style={st('width:11px;height:11px;border-radius:3px;background:' + s.color + ';flex:none')}></span>
      <span style={st('flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{s.label}</span>
      <span className="muted" style={st('font-size:11px')}>{exp > 0 ? (s.value / exp * 100).toFixed(1) + '%' : ''}</span>
      <span className="amt" style={st('min-width:78px')}>{M(s.value)}</span>
    </div>
  )) : <div className="muted" style={st('font-size:12px')}>No expense data in this period.</div>;

  // app.html:2325 — the per-company panel exists ONLY with more than one company in view. A company
  // filter that narrows to one makes it vanish, which is app.html's behaviour.
  const maxAbs = Math.max(1, ...cos.map((c) => Math.abs(Number(c.net_profit || 0))));
  const perCo = cos.length > 1 ? (
    <div className="panel" style={st('margin-top:14px')}>
      <div className="panel-hd"><h3>📊 Net profit by company</h3></div>
      {cos.slice().sort((a, b) => Number(b.net_profit || 0) - Number(a.net_profit || 0)).map((c, i) => {
        const v = Number(c.net_profit || 0), pct = Math.abs(v) / maxAbs * 100;
        const col = v >= 0 ? 'var(--green-soft)' : 'var(--red-soft)';
        return (
          <div key={i} style={st('margin:8px 0')}>
            <div style={st('display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px')}>
              <span>{c.tenant_name}</span>
              <span className="amt" style={{ color: col }}>{M(v)}</span>
            </div>
            <div style={st('background:var(--panel-2);border-radius:6px;height:14px;overflow:hidden')}>
              <div style={st('height:100%;width:' + pct.toFixed(1) + '%;background:' + col + ';border-radius:6px')}></div>
            </div>
          </div>
        );
      })}
    </div>
  ) : null;

  return (
    <>
      <div className="panel">
        <div className="panel-hd">
          <h3>💹 Profit &amp; Expense Analysis</h3>
          <span className="pill pill-coral" style={st('font-size:11px')}>{periodLbl}</span>
        </div>
        <div style={st('display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start')}>
          <div>
            <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px')}>Revenue · Expenses · Net Profit</div>
            <OvBars items={[
              { label: 'Revenue', value: rev, color: '#3ddc97' },
              { label: 'Expenses', value: exp, color: '#e85d3c' },
              { label: 'Net', value: net, color: net >= 0 ? '#5b9bd5' : '#ef4444' },
            ]} w={360} h={200} />
            <div style={st('display:flex;gap:10px;margin-top:10px;flex-wrap:wrap')}>
              <div style={st('flex:1;min-width:120px;background:var(--panel-2);border-radius:10px;padding:12px')}>
                <div className="muted" style={st('font-size:10.5px;text-transform:uppercase')}>Net margin</div>
                <div style={{ fontSize: '20px', fontWeight: '700', color: margin >= 0 ? 'var(--green-soft)' : 'var(--red-soft)' }}>{margin.toFixed(1) + '%'}</div>
              </div>
              <div style={st('flex:1;min-width:120px;background:var(--panel-2);border-radius:10px;padding:12px')}>
                <div className="muted" style={st('font-size:10.5px;text-transform:uppercase')}>Expense ratio</div>
                <div style={st('font-size:20px;font-weight:700;color:var(--amber)')}>{(rev > 0 ? (exp / rev * 100).toFixed(1) : '0') + '%'}</div>
              </div>
            </div>
          </div>
          <div>
            <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px')}>Expense breakdown</div>
            <div style={st('display:flex;gap:16px;align-items:center;flex-wrap:wrap')}>
              <div style={st('position:relative;flex:none')}>
                <OvDonut segs={segs} total={exp} size={170} />
                <div style={st('position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none')}>
                  <div className="muted" style={st('font-size:10px;text-transform:uppercase')}>Total exp</div>
                  <div style={st('font-size:15px;font-weight:700')}>{M(exp)}</div>
                </div>
              </div>
              <div style={st('flex:1;min-width:200px')}>{legend}</div>
            </div>
          </div>
        </div>
        {errs.length ? (
          <div className="muted" style={st('font-size:11px;margin-top:10px;color:var(--amber)')}>
            {'⚠ ' + errs.length + ' company P&L failed to load (' + errs.map((e) => e.tenant_name).join(', ') + '). Showing the rest.'}
          </div>
        ) : null}
        <div className="status-bar" style={st('margin-top:12px')}>
          <div className="dot-green"></div>{'Live from Xero Profit & Loss · ' + periodLbl}
        </div>
      </div>
      {perCo}
    </>
  );
}

/* ══ #last-refresh ═════════════════════════════════════════════════════════════════════════════════ */

/**
 * app.html:2140 — the ONE thing this renderer writes outside its own tab div: the shell's chrome clock
 * (app.html:1117, and `finance-shell.tsx:127`, which renders that same id EMPTY).
 *
 * It is in the golden as its own section, so it is diffed rather than taken on trust — the same use the
 * shell test makes of the HR goldens' `#hr_nav`. `toLocaleTimeString` is app.html's own call, so it is
 * mirrored and the test re-applies the harness's UTC override for one file (hr.clock's rule). The route
 * portals this into the shell's div; the shell itself is not touched.
 */
export function LastRefresh({ now }: { now: number }) {
  return (
    <>
      <div className="dot-green"></div>
      {'Refreshed ' + new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
    </>
  );
}
