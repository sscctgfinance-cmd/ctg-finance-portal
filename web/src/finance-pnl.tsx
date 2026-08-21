// Finance OS · P&L Analysis — the pure screen. `renderPnl()` / `pnlRender()` (app.html:4359) is the
// legacy it mirrors, and tests/golden/finance.pnl.html is the contract.
//
// Pure by construction, like every migrated screen: no fetch, no localStorage, no window, no clock. The
// load, the company scope, the 6/12 toggle, the show-zero flag and the CSV download live in
// app/finance/pnl/page.tsx.
//
// ── THE ARITHMETIC IS NOT HERE ────────────────────────────────────────────────────────────────────
// Every subtotal, every total and every % on this screen comes from `pnlBuild()` in ../../pnl.js — the
// same file app.html loads as a classic script. `pnl_analysis` (finance.ts:2034) is a pass-through to
// the `portal_pnl_analysis` RPC, which sends per-account rows and per-month totals and re-derives
// NOTHING; the screen posts nothing back. So there is no second computation anywhere that could
// disagree and be noticed, which is gateway.js's case exactly — a P&L with two implementations is a P&L
// that will eventually disagree with itself. Read pnl.js's header before changing a figure.
//
// What IS mirrored here is DRAWING, not arithmetic: `pnlBlockChart`'s SVG geometry and `pnlChip`'s
// delta pill. hr.dashboard's rule — port such maths character for character, strings for every style
// value, and never a bare `{a} {b}` pair of text expressions. The chart is NOT in the golden (the
// fixture carries no `blocks`), so it is pinned by assertion in the screen's own test instead.

import { Fragment } from 'react';

import {
  PNL_BLOCK_COLORS, PNL_BLOCK_ORDER, pnlBuild,
  type PnlBlock, type PnlData, type PnlModelRow, type PnlVal,
} from '../../pnl.js';

export type { PnlBlock, PnlData, PnlModelRow, PnlVal };
export { pnlBuild };

export interface Perms { features?: string[]; manage_users?: boolean }

/**
 * THE PERMISSION GATE — app.html:1434's final `else`, `feats.indexOf(t)<0`.
 *
 * `pnl` is named in NO branch of showApp()'s block (app.html:1420-1439), so it falls through to the
 * chain's final else and its rule is the FEATURE FLAG, not `manage_users`. Copying an admin-gated
 * neighbour's line (`wht`, `selfbill`, `gateway`, `bankfeed`, `salesrecon` are all `!canManage`) would
 * both over- and under-grant. `pnlRender()` itself has no role check at all, so a port that mirrored
 * only the renderer would serve every company's revenue, cost base, margins and net profit to anyone
 * who typed the URL. The route refuses to load or render on a false; the screen's test pins both
 * directions and that this is NOT the admin gate.
 */
export function pnlReachable(perms: Perms | null | undefined): boolean {
  return ((perms && perms.features) || []).indexOf('pnl') >= 0;
}

/** app.html:1256. */
const M = (n: unknown) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** app.html:1683 — the chart's axis labels. */
function cfoMk(v: unknown): string {
  let n = Number(v) || 0;
  const s = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n >= 1e6) return s + 'RM' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return s + 'RM' + Math.round(n / 1e3) + 'k';
  return s + 'RM' + Math.round(n);
}

/** `pnlNum()` — a null figure is an em dash, never RM 0.00. */
const pnlNum = (v: number | null | undefined) => (v === null || v === undefined ? '—' : M(v));

export interface Props {
  /** The `{api:'pnl_analysis'}` response, exactly as it arrived. */
  data: PnlData;
  /** PNL_MONTHS — 6 or 12. */
  months: number;
  /** PNL_SHOW_ZERO. */
  showZero: boolean;
  /** `cfoScopeName()` (app.html:1836) — the selected company's name, or null for all companies. */
  scopeCo: string | null;
  onMonths: (n: number) => void;
  onToggleZero: () => void;
  onExport: () => void;
  onRefresh: () => void;
}

/**
 * `pnlCell()` — one figure cell.
 *
 * The empty `style=""` is the legacy's, not an accident: it interpolates a conditional straight into the
 * attribute, so a non-negative amount reaches the golden carrying `style=""`. React cannot emit that at
 * all, which is finance.close's finding; the screen's test drops it from BOTH sides.
 */
function Cell({ c }: { c: PnlVal | null | undefined }) {
  if (!c || c.amt === null || c.amt === undefined) {
    return <td className="pnl-num "><span className="muted">—</span></td>;
  }
  const style = c.amt < 0 ? { color: 'var(--coral-soft)' } : {};
  return (
    <td className="pnl-num " style={style}>
      {M(c.amt)}
      {c.pct === null || c.pct === undefined
        ? null
        : <span className="pnl-pct">{(c.pct * 100).toFixed(1) + '%'}</span>}
    </td>
  );
}

/**
 * `pnlChip()` — the +/-% delta pill. `inverse` flips the colour for cost lines, where "up" is bad.
 *
 * Mirrored rather than lifted: it is a presentation delta between two figures pnl.js already owns, and
 * the golden pins three of them (Revenue ▼58.0%, Gross Profit ▼59.1%, Operating Expenses ▼16.9% in the
 * GOOD colour), so a divergence diffs against the baseline rather than hiding.
 */
function Chip({ cur, prev, inverse }: { cur: number | null; prev: number | null; inverse?: boolean }) {
  if (cur === null || prev === null || cur === undefined || prev === undefined || !prev) return null;
  const p = (cur - prev) / Math.abs(prev) * 100;
  if (!isFinite(p)) return null;
  const up = p >= 0, good = inverse ? !up : up;
  const bg = good ? 'rgba(14,157,103,.13)' : 'rgba(232,93,60,.13)';
  const bd = good ? 'rgba(14,157,103,.30)' : 'rgba(232,93,60,.30)';
  const fg = good ? 'var(--green-soft)' : 'var(--coral-soft)';
  return (
    <span className="pnl-chip" style={{ background: bg, borderColor: bd, color: fg }}>
      {(up ? '▲' : '▼') + Math.abs(p).toFixed(1) + '%'}
    </span>
  );
}

/**
 * `pnlBlockChart()` — stacked bars, cost blocks per month, chronological left→right.
 *
 * Ported coordinate for coordinate (hr.dashboard's rule): every style value is a STRING and every
 * attribute value is built in JS and interpolated once, because React renders a numeric style value
 * differently and splits adjacent text expressions. Negative (credit/reversal) blocks cannot stack
 * upward — they are clamped for the bar HEIGHT only; the tooltip and the grid still show the true
 * signed figure, exactly as the legacy does.
 */
export function BlockChart({ months, blocks }: { months: string[]; blocks: PnlBlock[] }) {
  const ms = months.slice().reverse(), n = ms.length;
  const list = (blocks || []).filter((b) => b && b.block);
  if (!n || !list.length) return <div className="muted" style={{ padding: '20px' }}>No cost-block data for this period.</div>;
  const order: string[] = []; const seen: Record<string, number> = {};
  PNL_BLOCK_ORDER.forEach((b) => { if (list.some((x) => x.block === b)) { order.push(b); seen[b] = 1; } });
  list.forEach((x) => { if (!seen[x.block as string]) { seen[x.block as string] = 1; order.push(x.block as string); } });
  const val = (b: string, m: string) => {
    const e = list.filter((x) => x.block === b)[0];
    if (!e || !e.by_month) return 0;
    const v = Number(e.by_month[m]);
    return isFinite(v) ? v : 0;
  };
  const w = 820, h = 290, padL = 56, padR = 14, padB = 46, padT = 18;
  const stackTot = ms.map((m) => order.reduce((s, b) => s + Math.max(0, val(b, m)), 0));
  const max = Math.max.apply(null, [1].concat(stackTot));
  const slot = (w - padL - padR) / n, barW = Math.min(52, slot * 0.56);
  const yat = (v: number) => h - padB - (v / max) * (h - padB - padT);
  const grid: React.ReactElement[] = [];
  for (let k = 0; k <= 4; k++) {
    const gv = max * (4 - k) / 4, gy = padT + (k / 4) * (h - padB - padT);
    grid.push(
      <Fragment key={'g' + k}>
        <line x1={String(padL)} y1={gy.toFixed(1)} x2={String(w - padR)} y2={gy.toFixed(1)}
          stroke="var(--border)" strokeWidth="1" opacity={k === 4 ? '.7' : '.28'} />
        <text x={String(padL - 8)} y={(gy + 3).toFixed(1)} textAnchor="end" fontSize="8.5" fill="var(--muted)">{cfoMk(gv)}</text>
      </Fragment>,
    );
  }
  const bars = ms.map((m, i) => {
    const cx = padL + slot * i + slot / 2, x = cx - barW / 2;
    let base = h - padB;
    const seg: React.ReactElement[] = [];
    // Only positive blocks stack; the topmost of them gets rounded top corners.
    const pos = order.filter((b) => val(b, m) > 0);
    pos.forEach((b, pi) => {
      const raw = val(b, m), v = raw, bh = (v / max) * (h - padB - padT), y = base - bh;
      base = y;
      const fill = PNL_BLOCK_COLORS[b] || '#8892a6';
      const title = <title>{b + ' · ' + m + ' · ' + M(raw)}</title>;
      if (pi === pos.length - 1) { // rounded top on the crown segment
        const r = Math.min(4, barW / 2, bh / 2), xr = x + barW;
        const d = 'M' + x.toFixed(1) + ' ' + (y + bh).toFixed(1) + ' L' + x.toFixed(1) + ' ' + (y + r).toFixed(1) +
          ' Q' + x.toFixed(1) + ' ' + y.toFixed(1) + ' ' + (x + r).toFixed(1) + ' ' + y.toFixed(1) +
          ' L' + (xr - r).toFixed(1) + ' ' + y.toFixed(1) + ' Q' + xr.toFixed(1) + ' ' + y.toFixed(1) + ' ' + xr.toFixed(1) + ' ' + (y + r).toFixed(1) +
          ' L' + xr.toFixed(1) + ' ' + (y + bh).toFixed(1) + ' Z';
        seg.push(<path key={b} d={d} fill={fill}>{title}</path>);
      } else {
        seg.push(<rect key={b} x={x.toFixed(1)} y={y.toFixed(1)} width={barW.toFixed(1)} height={bh.toFixed(1)} fill={fill}>{title}</rect>);
      }
    });
    return (
      <Fragment key={m}>
        {seg}
        <text x={cx.toFixed(1)} y={String(h - padB + 17)} textAnchor="middle" fontSize="9" fill="var(--muted)">{m.slice(2)}</text>
        <text x={cx.toFixed(1)} y={(yat(stackTot[i]) - 6).toFixed(1)} textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--text-soft)">{cfoMk(stackTot[i])}</text>
      </Fragment>
    );
  });
  return (
    <>
      <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={{ display: 'block' }}>{grid}{bars}</svg>
      <div className="pnl-legend">
        {order.map((b) => (
          <span className="it" key={b}>
            <span className="sw" style={{ background: PNL_BLOCK_COLORS[b] || '#8892a6' }}></span>{b}
          </span>
        ))}
      </div>
    </>
  );
}

/** `renderPnl()`'s first write — the spinner panel, before the fetch resolves. Not in any golden. */
export function PnlLoading({ scopeCo }: { scopeCo: string | null }) {
  const who = scopeCo || 'all companies';
  return (
    <div className="panel">
      <div className="panel-hd"><h3>{'📑 P&L Analysis · ' + who}</h3></div>
      <div className="muted" style={{ padding: '26px', textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 10px' }}></div>{'Loading profit & loss for ' + who + '…'}
      </div>
    </div>
  );
}

/**
 * `renderPnl()`'s two failure writes. `📉` is the server saying no (`!r.ok`); `⚠️` is the call itself
 * throwing. Two different documents in the legacy, kept as two here — collapsing them would report a
 * refusal as a network fault or the reverse. Neither is in any golden.
 */
export function PnlFailure({ kind, message }: { kind: 'refused' | 'threw'; message: string }) {
  return (
    <div className="panel">
      <div className="empty">
        <div className="empty-ico">{kind === 'refused' ? '📉' : '⚠️'}</div>
        <div>{message}</div>
      </div>
    </div>
  );
}

/** The loaded screen — `pnlRender()` (app.html:4437), which is what the golden holds. */
export default function FinancePnl({ data, months: monthsN, showZero, scopeCo, onMonths, onToggleZero, onExport, onRefresh }: Props) {
  const d = data;
  const mdl = pnlBuild(d, monthsN, showZero);
  const months = mdl.months, totals = d.totals || {};
  const cur = months[0] || null, prv = months[1] || null;
  const at = (vals: PnlVal[] | undefined, i: number) => ((i >= 0 && vals && vals[i]) ? vals[i].amt : null);
  // KPI figures: prefer the row-derived subtotals, fall back to `totals` when the cache is empty.
  const tcur = (cur !== null && totals[cur]) || {}, tprv = (prv !== null && totals[prv]) || {};
  // mdl.rev already resolves rows-first, then totals.revenue, then totals.income.
  const revC = (cur !== null && mdl.rev[cur] !== undefined) ? mdl.rev[cur] : null;
  const revP = (prv !== null && mdl.rev[prv] !== undefined) ? mdl.rev[prv] : null;
  const gpC = mdl.hasRows ? at(mdl.gpVals, 0) : null, gpP = mdl.hasRows ? at(mdl.gpVals, 1) : null;
  const opC = mdl.hasRows ? at(mdl.opexRow && mdl.opexRow.vals, 0) : (tcur.expenses != null ? Number(tcur.expenses) : null);
  const opP = mdl.hasRows ? at(mdl.opexRow && mdl.opexRow.vals, 1) : (tprv.expenses != null ? Number(tprv.expenses) : null);
  const npC = at(mdl.npVals, 0), npP = at(mdl.npVals, 1);
  const col = (v: number | null) => (v === null ? 'var(--muted)' : (v < 0 ? 'var(--coral-soft)' : 'var(--text)'));
  const npAccent = npC === null ? 'var(--border-strong)' : (npC < 0 ? 'var(--coral)' : 'var(--green)');

  // A KPI card: thin coloured top-accent bar, uppercase label + delta pill, quiet number, muted sub.
  const kpi = (accent: string, label: string, numColor: string, numText: string, chip: React.ReactNode, subText: string) => (
    <div className="pnl-kpi" style={{ '--kpi-accent': accent } as React.CSSProperties} key={label}>
      <div className="pnl-kpi-top"><span className="pnl-kpi-lbl">{label}</span>{chip}</div>
      <div className="pnl-kpi-n" style={{ color: numColor }}>{numText}</div>
      <div className="pnl-kpi-sub">{subText}</div>
    </div>
  );

  // The refresh stamp is SLICED out of the server's own string — never parsed as a date. See the
  // screen's test: a Date-based rewrite prints a different minute, or a different day, west of
  // Greenwich, and no output assertion on this fleet can see it.
  const refreshed = d.generated_at ? (' · refreshed ' + String(d.generated_at).replace('T', ' ').slice(0, 16)) : '';
  const tail = ' · ' + months.length + ' months' + refreshed;
  const scoped = d.scoped_tenant
    ? <>{'P&L · '}<b style={{ color: 'var(--text)' }}>{scopeCo || 'selected company'}</b>{tail}</>
    : <>{'Consolidated P&L · all companies' + tail}</>;

  const mbtn = (n: number) => (
    <button className={monthsN === n ? 'on' : ''} onClick={() => onMonths(n)} key={n}>{n + ' months'}</button>
  );

  return (
    <>
      <div className="pnl-ctrls">
        <div className="muted" style={{ fontSize: '12.5px' }}>{scoped}</div>
        <div className="pnl-ctrls-r">
          <div className="pnl-seg">{mbtn(6)}{mbtn(12)}</div>
          <label className="pnl-zero"><input type="checkbox" checked={showZero} onChange={onToggleZero} /> Show zero-value accounts</label>
          <button className="btn sm" onClick={onExport}>⬇ Export CSV</button>
          <button className="btn sm" onClick={onRefresh}>↻ Refresh</button>
        </div>
      </div>
      <div className="pnl-kpis">
        {kpi('var(--border-strong)', 'Revenue', revC === null ? 'var(--muted)' : (revC < 0 ? 'var(--coral-soft)' : 'var(--green-soft)'),
          pnlNum(revC), <Chip cur={revC} prev={revP} />, cur ? cur : '—')}
        {kpi('var(--sky)', 'Gross Profit', col(gpC), pnlNum(gpC), <Chip cur={gpC} prev={gpP} />,
          gpC === null ? (mdl.hasRows ? '—' : 'needs account cache') : (revC ? ((gpC / revC * 100).toFixed(1) + '% GP margin') : '—'))}
        {kpi('var(--coral)', 'Operating Expenses', opC === null ? 'var(--muted)' : 'var(--coral)', pnlNum(opC),
          <Chip cur={opC} prev={opP} inverse />, opC !== null && revC ? ((opC / revC * 100).toFixed(1) + '% of revenue') : '—')}
        {kpi(npAccent, 'Net Profit', npC === null ? 'var(--muted)' : (npC < 0 ? 'var(--coral-soft)' : 'var(--green-soft)'),
          pnlNum(npC), <Chip cur={npC} prev={npP} />, npC !== null && revC ? ((npC / revC * 100).toFixed(1) + '% net margin') : '—')}
      </div>
      <div style={{ height: '16px' }}></div>
      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="panel-hd">
          <h3>🧱 Operating expenses by cost block</h3>
          <span className="muted" style={{ fontSize: '11px' }}>stacked per month · oldest → newest</span>
        </div>
        <BlockChart months={months} blocks={d.blocks || []} />
      </div>
      <div className="panel">
        <div className="panel-hd">
          <h3>{'📑 Profit & Loss — months across, accounts down'}</h3>
          <span className="muted" style={{ fontSize: '11px' }}>newest month first</span>
        </div>
        {mdl.hasRows ? <Grid months={months} rows={mdl.rows} /> : <TotalsFallback months={months} totals={totals} />}
      </div>
    </>
  );
}

/** The account grid — months across, accounts down. What the golden holds. */
function Grid({ months, rows }: { months: string[]; rows: PnlModelRow[] }) {
  return (
    <>
      <div className="pnl-wrap">
        <table className="pnl-grid">
          <thead>
            <tr>
              <th className="pnl-acc">Account</th>
              {months.map((m) => <th key={m}>{m}</th>)}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              let cls = r.kind === 'band' ? 'pnl-band' : r.kind === 'sub' ? 'pnl-sub' : r.kind === 'key' ? 'pnl-key' : r.kind === 'blk' ? 'pnl-blk' : '';
              // Key rows carry a sign-aware accent: Gross Profit is neutral; Net Profit greens when
              // positive, corals when negative. Presentation only — the number/model are untouched.
              if (r.kind === 'key') cls += /gross/i.test(r.label) ? ' gp' : ((r.total !== null && r.total !== undefined && r.total < 0) ? ' neg' : ' pos');
              if (r.kind === 'band' || r.kind === 'blk') {
                return (
                  <tr className={cls} key={i}>
                    <td className="pnl-acc">{r.label}</td>
                    {months.map((m) => <td className="pnl-num" key={m}></td>)}
                    <td className="pnl-num"></td>
                  </tr>
                );
              }
              return (
                <tr className={cls} key={i}>
                  <td className="pnl-acc">{r.label}</td>
                  {r.vals.map((c, k) => <Cell c={c} key={k} />)}
                  <Cell c={{ amt: r.total, pct: null }} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>
        Small figures under each amount are that account&apos;s share of the month&apos;s Total Trading Income. Negative amounts are credits/reversals as posted in Xero.
      </div>
    </>
  );
}

/**
 * The `!mdl.hasRows` branch — the account cache is empty, so only Xero's monthly totals are known.
 * NOT in the golden (the fixture carries eleven account rows); pinned by assertion in the screen's test.
 */
function TotalsFallback({ months, totals }: { months: string[]; totals: Record<string, { income?: number | null; expenses?: number | null; net_profit?: number | null }> }) {
  return (
    <>
      <div className="empty" style={{ padding: '34px 20px' }}>
        <div className="empty-ico">🗂</div>
        <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text)' }}>{'Account-level P&L not cached yet — run a P&L refresh.'}</div>
        <div className="muted" style={{ fontSize: '12.5px', marginTop: '6px' }}>Monthly totals below are live; the account breakdown appears once the backend cache job has run.</div>
      </div>
      <div className="tbl-wrap" style={{ marginTop: '14px' }}>
        <table className="bigtable">
          <thead><tr><th>Month</th><th className="amt">Income</th><th className="amt">Expenses</th><th className="amt">Net profit</th></tr></thead>
          <tbody>
            {months.length === 0
              ? <tr><td colSpan={4} className="muted">No months returned.</td></tr>
              : months.map((m) => {
                const t = totals[m] || {};
                const inc = t.income != null ? Number(t.income) : null;
                const exp = t.expenses != null ? Number(t.expenses) : null;
                const np = t.net_profit != null ? Number(t.net_profit) : null;
                return (
                  <tr key={m}>
                    <td>{m}</td>
                    <td className="amt">{pnlNum(inc)}</td>
                    <td className="amt" style={{ color: 'var(--coral)' }}>{pnlNum(exp)}</td>
                    <td className="amt" style={{ fontWeight: '700', color: np === null ? 'var(--muted)' : (np < 0 ? 'var(--coral-soft)' : 'var(--green-soft)') }}>{pnlNum(np)}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </>
  );
}
