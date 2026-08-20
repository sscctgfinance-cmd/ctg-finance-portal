// Types for pnl.js, so the React app in web/ can IMPORT the P&L computation rather than re-express it
// (see pnl.js's own header, and web/src/finance-pnl.tsx).
//
// Declarations only. This file must never grow a subtotal, a sign rule, a block name or an ordering
// step: pnl.js is the single copy of the arithmetic and anything duplicated here would be a second copy
// that nothing checks. That matters here for gateway.d.ts's reason — `pnl_analysis` sends per-account
// rows and per-month totals and nothing else, so every subtotal on the screen is derived in the browser
// and no server or ledger re-derives it. PNL_BLOCK_ORDER and PNL_BLOCK_COLORS are declared, never
// spelled out.
//
// It sits next to pnl.js, not inside web/, for the reason payroll.d.ts, o2o.d.ts and gateway.d.ts do:
// `web/tsconfig.json` sets `allowJs: false` and TypeScript resolves a RELATIVE specifier on disk — an
// ambient wildcard module declaration does not apply to `../../pnl.js`. It is inert everywhere else:
// the browser loads pnl.js as a classic script and the Deno suite never looks at it.

/** One month's figure for one account, as `portal_pnl_analysis` sends it. A missing month is absent. */
export interface PnlCell { amount?: number | null; pct?: number | null }

/** One account row of the response. `block` is the CTG cost block; Operating Expenses rows carry it. */
export interface PnlRow {
  section?: string;
  account?: string;
  block?: string | null;
  by_month?: Record<string, PnlCell>;
}

/** Xero's own monthly figures. `net_profit` is authoritative and is never recomputed. */
export interface PnlTotals { revenue?: number | null; income?: number | null; expenses?: number | null; net_profit?: number | null }

/** One cost block's monthly spend, for the stacked chart. */
export interface PnlBlock { block?: string; by_month?: Record<string, number> }

/** The `{api:'pnl_analysis'}` response. */
export interface PnlData {
  ok?: boolean;
  error?: string;
  scoped_tenant?: string | null;
  generated_at?: string | null;
  months?: string[];
  totals?: Record<string, PnlTotals>;
  rows?: PnlRow[];
  blocks?: PnlBlock[];
}

/** One grid cell of the built model. `amt === null` prints as "—"; `pct === null` prints no share. */
export interface PnlVal { amt: number | null; pct: number | null }

/**
 * One grid row. `band` is a section heading, `blk` a cost-block heading (both carry no figures),
 * `acct` an account line, `sub` a subtotal and `key` Gross Profit / Net Profit.
 */
export interface PnlModelRow {
  kind: 'band' | 'blk' | 'acct' | 'sub' | 'key';
  label: string;
  vals: PnlVal[];
  total: number | null;
}

/** What `pnlBuild` returns: the grid, plus the handful of rows the KPI cards read back out of it. */
export interface PnlModel {
  months: string[];
  rows: PnlModelRow[];
  /** Per-month % basis — Total Trading Income, falling back to totals.revenue then totals.income. */
  rev: Record<string, number | null>;
  /** False when the account cache is empty; the screen then shows the monthly-totals table instead. */
  hasRows: boolean;
  tiRow: PnlModelRow;
  csRow: PnlModelRow;
  gpVals: PnlVal[];
  npVals: PnlVal[];
  opexRow?: PnlModelRow;
}

/** The CTG cost blocks, in the order the grid and the chart put them in. */
export declare const PNL_BLOCK_ORDER: string[];
/** Block → swatch colour, shared by the grid and the stacked chart. */
export declare const PNL_BLOCK_COLORS: Record<string, string>;

export declare function pnlAmt(row: PnlRow | null | undefined, m: string): number | null;
export declare function pnlPct(row: PnlRow | null | undefined, m: string): number | null;
export declare function pnlSecRows(d: PnlData | null | undefined, section: string): PnlRow[];
export declare function pnlSumAt(rows: PnlRow[] | null | undefined, m: string): number | null;
export declare function pnlRowTotal(row: PnlRow, months: string[]): number | null;

export declare function pnlBuild(data: PnlData | null | undefined, monthsN: number, showZero: boolean): PnlModel;

export declare function pnlCsvLines(mdl: PnlModel, totals: Record<string, PnlTotals> | null | undefined): string[];
export declare function pnlCsvName(coName: string | null | undefined, monthsLen: number, today: string): string;
