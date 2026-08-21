// Types for o2o.js, so the React app in web/ can IMPORT the O2O billing computation rather than
// re-express it (see o2o.js's own header, and web/src/finance-o2o.tsx).
//
// Declarations only. This file must never grow a rate, a SKU code, a rounding step or a grouping rule:
// o2o.js is the single copy of the arithmetic and a number duplicated here would be a second copy that
// nothing checks. That matters more here than on wht.js — `o2o_issue` (finance.ts:626) forwards this
// file's Quantity / UnitAmount / DiscountRate straight into the Xero payload, so there is no server
// figure to fall back on.
//
// It sits next to o2o.js, not inside web/, for the same reason payroll.d.ts sits next to payroll.js:
// `web/tsconfig.json` sets `allowJs: false` and TypeScript resolves a RELATIVE specifier on disk — an
// ambient wildcard module declaration does not apply to `../../o2o.js`. It is inert everywhere else:
// the browser loads o2o.js as a classic script and the Deno suite never looks at it.

/** One invoice line, as `o2oParseRows` builds it and `o2o_issue` forwards it to Xero. */
export interface O2OLine {
  /** The Skindae SKU. Null in Package mode, and stripped by the client for a non-Skindae target. */
  item_code?: string | null;
  /** The invoice line Description. Named `package` because that is the Excel column it comes from. */
  package: string;
  quantity: number;
  unit_price: number;
  /** Percent, not a fraction: 19.2 is 19.2%. Absent on the fallback single-line model. */
  discount_rate?: number;
  /** Gross less the commission, to the sen. What the pharmacy is actually billed for this line. */
  amount?: number;
}

/** A row of the Excel that matched no SKU and is billed at its raw price. Surfaced, never silent. */
export interface O2OUnmatched {
  pkg: string;
  price: number;
}

/** One pharmacy = one Xero invoice. One sheet of the workbook produces one of these. */
export interface O2OPharmacy {
  pharmacy: string;
  line_count: number;
  /** What is invoiced, after commission. */
  total: number;
  /** Gross before commission. */
  total_sales: number;
  commission: number;
  lines: O2OLine[];
  unmatched: O2OUnmatched[];
  /** True when the sheet had no per-row data and a single Total-Sales line was used instead. */
  fallback: boolean;
}

export interface O2OData {
  /** The raw period text from the workbook, verbatim. */
  period: string;
  /** The Xero invoice Reference — `o2oFormatReference(period)`. */
  reference: string;
  pharmacy_count: number;
  grand_total: number;
  pharmacies: O2OPharmacy[];
}

/** One decoded worksheet. `rows` is `sheet_to_json(ws,{header:1,raw:true,defval:null})`. */
export interface O2OSheet {
  name: string;
  rows: unknown[][];
}

/** One entry of the fixed Skindae SKU map. The regexes and codes live in o2o.js, never here. */
export interface O2OSku {
  match: RegExp;
  code: string;
  desc: string;
  label: string;
}

export declare const O2O_SKU_MAP: O2OSku[];
export declare const O2O_DISCOUNT_RATE: number;
export declare function o2oMatchSku(pkgName: unknown): O2OSku | null;
export declare function o2oFormatReference(periodRaw: unknown): string;
export declare function o2oParseRows(sheets: O2OSheet[], useSkuMode: boolean): O2OData;
/** Mutates `p` in place and returns whether the override applied. Mirrors the legacy's own mutation. */
export declare function o2oApplyMasterRate(p: O2OPharmacy, rawRate: unknown): boolean;
export declare function o2oGrandTotal(pharmacies: O2OPharmacy[]): number;
/** `[]` = let Xero number them. `null` = the operator typed something invalid. Never collapse the two. */
export declare function o2oInvoiceNumbers(count: number, prefix: unknown, startRaw: unknown): string[] | null;
