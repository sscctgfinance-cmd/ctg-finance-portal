// Types for salesrecon.js, so the React app in web/ can IMPORT the Sales Reconciliation computation
// rather than re-express it (see salesrecon.js's own header, and web/src/finance-salesrecon.tsx).
//
// Declarations only. This file must never grow an account code, a channel mapping, a rounding step, a
// numbering rule or a column list: salesrecon.js is the single copy of the arithmetic and anything
// duplicated here would be a second copy that nothing checks. That matters as much here as on o2o.js —
// `sr_post_invoices` (finance.ts:853) forwards this file's number / date / amount / account straight
// into the Xero payload, so there is no server figure to fall back on.
//
// It sits next to salesrecon.js, not inside web/, for the same reason o2o.d.ts sits next to o2o.js:
// `web/tsconfig.json` sets `allowJs: false` and TypeScript resolves a RELATIVE specifier on disk — an
// ambient wildcard module declaration does not apply to `../../salesrecon.js`. It is inert everywhere
// else: the browser loads salesrecon.js as a classic script and the Deno suite never looks at it.

/** One Xero Sales Invoice line, as `srBuildLines` builds it and `sr_post_invoices` forwards it. */
export interface SrLine {
  /** Always 'DATABEES'. */
  contact: string;
  /** The invoice number. NULL until pass 2 (unmatched) or unsuffixed until pass 3 (matched). */
  inv: string | null;
  /** The matched SO, kept separately from `inv` because pass 3 suffixes `inv` and the tally keys on this. */
  so: string | null;
  /** `MM'YYYY` — the YRDZ numbering period. Null on a matched line. */
  per: string | null;
  /** DD-MM-YYYY. The payment-gateway transaction date. */
  date: string;
  due: string;
  /** The invoice line Description — the order's Package, or `YRDZ_Package_<amount>`. */
  desc: string;
  qty: number;
  /** What was actually received. Not rounded here; posted as-is. */
  amt: number;
  /** The Xero revenue account code. */
  acc: string;
  tax: string;
  /** The sales channel, cleaned. `YRDZ (unmatched)` when no order matched. */
  ch: string;
  /** The Sales-file sheet this row came from. */
  gw: string;
  matched: boolean;
}

/** One Order Form row, keyed by its canonical SO. */
export interface SrOrder {
  ch?: unknown;
  pkg: string;
  odate: Date | null;
  gt: number;
}

export interface SrLookup {
  lookup: Record<string, SrOrder>;
  /** False → pass 4 does not run; the screen says the tally was skipped. */
  hasGrandTotal: boolean;
}

/** One decoded Sales-file sheet. `rows` is `srSheetRows(ws)`'s output — objects keyed by header. */
export interface SrSheet {
  name: string;
  rows: Record<string, unknown>[];
}

export interface SrBuilt {
  lines: SrLine[];
  /** Sheets whose serial dates were Excel-swapped and were repaired. */
  swapNote: string[];
  /** Sheets that produced no lines — reported, never silently dropped. */
  skipped: string[];
  /** Sheets whose columns were recognised by content rather than by a known layout. */
  smartNote: string[];
}

/** `sr_so_suffix`'s `existing` entry — finance.ts:961. */
export interface SrSoInfo {
  taken: boolean;
  max: number;
  prev_total?: number;
}

/** One row of the Order-Form tally. `st` is 'tally' | 'short' | 'over' | 'no-total'. */
export interface SrTallyRow {
  so: string;
  ch: string;
  order: number;
  prev: number;
  file: number;
  total: number;
  diff: number;
  st: string;
}

export interface SrSummary {
  tot: number;
  matched: number;
  unmatched: number;
  unmatchedAmt: number;
  byAcc: Record<string, { n: number; amt: number; ch: Record<string, number> }>;
}

/** One invoice as `sr_post_invoices` takes it — finance.ts:870. */
export interface SrPostItem {
  number: string | null;
  date: string;
  due: string;
  desc: string;
  qty: number;
  amount: number;
  account: string;
  contact: string;
}

export declare const SR_CHAN2ACC: Record<string, string>;
export declare const SR_ACCNAME: Record<string, string>;
export declare const SR_CFG: Record<string, { id: string; date: string; amt: string }>;
export declare const SR_COLS: string[];
export declare const SR_XERO_COLS: string[];
/** I PROCARE. Not a preference — the YRDZ/SO lookups were asked about THIS company's Xero. */
export declare const SR_TENANT: string;
export declare const SR_POST_CHUNK: number;

export declare function srAcc(ch: unknown): string;
export declare function srCanonSO(v: unknown): string | null;
export declare function srClean(s: unknown): string;
export declare function srNum(v: unknown): number;
export declare function srAnyDate(v: unknown): Date | null;
export declare function srSmartCols(rows: Record<string, unknown>[]): { id: string | null; date: string; amt: string } | null;
export declare function srDetectTextOrder(rows: Record<string, unknown>[], col: string): string | null;
export declare function srDetectSwap(rows: Record<string, unknown>[], col: string): boolean;
export declare function srFixDate(v: unknown, sheet: string, swap: boolean, ord: string | null): Date | null;
export declare function srDmy(d: unknown): string;
export declare function srPer(d: unknown): string;

export declare function srOrderLookup(aoa: unknown[][]): SrLookup;
export declare function srBuildLines(lookup: Record<string, SrOrder>, sheets: SrSheet[]): SrBuilt;
export declare function srYrdzPeriods(lines: SrLine[]): string[];
/** MUTATES `lines[i].inv`. Returns the "continues from" notes. */
export declare function srApplyYrdz(lines: SrLine[], base: Record<string, number> | null): string[];
export declare function srSoBases(lines: SrLine[]): string[];
/** MUTATES `lines[i].inv`. Returns how many repeat payments were suffixed. */
export declare function srApplySoSuffix(lines: SrLine[], soInfo: Record<string, SrSoInfo> | null): number;
export declare function srTally(lines: SrLine[], lookup: Record<string, SrOrder> | null, soInfo: Record<string, SrSoInfo> | null): SrTallyRow[];
export declare function srSummary(lines: SrLine[]): SrSummary;

export declare function srRowArr(l: SrLine): unknown[];
export declare function srTag(lines: SrLine[]): string;
export declare function srXeroRow(l: SrLine): string[];
/** The whole Xero Sales CSV, BOM and CRLF included. */
export declare function srCsv(lines: SrLine[]): string;
export declare function srPostChunks(lines: SrLine[]): SrPostItem[][];
export declare function srPostBody(tenant: string, chunk: SrPostItem[]): Record<string, unknown>;
export declare function srReportSheets(lines: SrLine[], tally: SrTallyRow[] | null): { name: string; rows: unknown[][] }[];
