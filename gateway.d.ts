// Types for gateway.js, so the React app in web/ can IMPORT the Gateway → Xero conversion rather than
// re-express it (see gateway.js's own header, and web/src/finance-gateway.tsx).
//
// Declarations only. This file must never grow a column name, a fee rate, a rounding step or a
// consolidation key: gateway.js is the single copy of the arithmetic and anything duplicated here would
// be a second copy that nothing checks. That matters more here than on o2o.js — this screen talks to no
// server at all, so the CSV gateway.js writes is imported straight into Xero and there is no second
// computation anywhere that could disagree and be noticed.
//
// It sits next to gateway.js, not inside web/, for the reason payroll.d.ts and o2o.d.ts do:
// `web/tsconfig.json` sets `allowJs: false` and TypeScript resolves a RELATIVE specifier on disk — an
// ambient wildcard module declaration does not apply to `../../gateway.js`. It is inert everywhere else:
// the browser loads gateway.js as a classic script and the Deno suite never looks at it.

/** The four gateways this converter knows. Each is a MODE of the one screen. */
export type GwProvider = 'payex' | 'atome' | 'hitpay' | 'nttdata';

/** One line of the Xero bank statement — what `gwCSV` writes and what the preview table shows. */
export interface GwRow {
  /** The parsed Date. Used for the sort and for the download's filename range; never printed. */
  d: Date;
  /** The date as the operator chose to format it (`ymd` | `dmy`). */
  date: string;
  amount: number;
  payee: string;
  desc: string;
  ref: string;
  /** 'in' = money-in (sales), 'out' = payout to bank, 'fee' = merchant fee. */
  kind: 'in' | 'out' | 'fee';
}

/** One loaded spreadsheet: its filename and its decoded rows. The XLSX decode stays out of gateway.js. */
export interface GwFile { name: string; rows: Record<string, unknown>[] }

/**
 * A provider's loaded files. Payex names the second one `set`; Atome and HitPay name it `payout`; NTT
 * Data has none — its payout and MDR are derived from `txn`.
 */
export interface GwFiles { txn?: GwFile | null; set?: GwFile | null; payout?: GwFile | null }

/** The counters the converters increment as they read. `gwAuditLines` turns it into the check block. */
export interface GwAudit {
  txnRead: number; txnConv: number; txnNoDate: number; txnZero: number;
  poRead: number; poConv: number; poNoDate: number;
  reconOk: number; reconTot: number; reconMax: number;
  pxSettled: number; pxUnsettled: number; pxUnsettledAmt: number;
  /** HitPay only: the effective fee rate the transaction report implied. */
  hpFeeRate?: number;
}

/** The Money-in Reference options, per provider — `[value, label]`, the first being the default. */
export declare const GW_REFOPTS: Record<GwProvider, [string, string][]>;

export declare function gwProvLabel(p: GwProvider | string): string;
export declare function gwMoney(n: number): string;
export declare function gwNum(v: unknown): number;
export declare function gwPick(row: Record<string, unknown>, name: string): unknown;
export declare function gwParseDate(v: unknown): Date | null;
export declare function gwFmtDate(d: Date | null, fmt: 'ymd' | 'dmy' | string): string;

/** Which provider and which slot a dropped sheet's lower-cased column names belong to, or null. */
export declare function gwDetect(keys: string[]): [GwProvider, 'txn' | 'set' | 'payout'] | null;

export declare function gwNewAudit(): GwAudit;

/** The dispatcher: the four converters plus the date sort that fixes the CSV's row order. */
export declare function gwConvertRows(
  provider: GwProvider, f: GwFiles, A: GwAudit,
  fmt: string, refField: string, wantPayout: boolean, wantFee: boolean,
): GwRow[];

export declare function gwConvertPayex(f: GwFiles, A: GwAudit, fmt: string, refField: string, wantPayout: boolean, wantFee: boolean): GwRow[];
export declare function gwConvertAtome(f: GwFiles, A: GwAudit, fmt: string, refField: string, wantPayout: boolean, wantFee: boolean): GwRow[];
export declare function gwConvertHitpay(f: GwFiles, A: GwAudit, fmt: string, refField: string, wantPayout: boolean, wantFee: boolean): GwRow[];
export declare function gwConvertNttData(f: GwFiles, A: GwAudit, fmt: string, refField: string, wantPayout: boolean, wantFee: boolean): GwRow[];

/** The four summary cards' figures. */
export interface GwTotals { sIn: number; sOut: number; sFee: number; cIn: number; cOut: number; net: number }
export declare function gwTotals(rows: GwRow[]): GwTotals;

/** The "only one file is loaded" warning, or '' when both halves are present. */
export declare function gwWarning(provider: GwProvider, f: GwFiles): string;

/** The data-check block: what was read, what became of it, and whether it all adds up. */
export declare function gwAuditLines(provider: GwProvider, A: GwAudit | null | undefined): { lines: string[]; allOk: boolean };

/** The Xero bank-statement CSV. CRLF, quoted where the field needs it. */
export declare function gwCSV(rows: GwRow[]): string;

/** The download's file name — `Xero_<Provider>_<Slice>_<first>_<last>.csv`. */
export declare function gwOutName(provider: GwProvider, which: 'all' | 'in' | 'out' | string, rows: GwRow[]): string;
