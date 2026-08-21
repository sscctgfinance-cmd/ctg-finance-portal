// Types for wht.js, so the React app in web/ can IMPORT the withholding-tax computation rather than
// re-express it (see wht.js's own header, and web/src/finance-wht.tsx).
//
// Declarations only. This file must never grow a rate, a rounding step or a basis rule: wht.js is the
// single copy of the arithmetic, pinned by tests/wht_test.ts, and a number duplicated here would be a
// second copy that nothing checks.
//
// It sits next to wht.js, not inside web/, for the same reason payroll.d.ts sits next to payroll.js:
// `web/tsconfig.json` sets `allowJs: false` and TypeScript resolves a RELATIVE specifier on disk — an
// ambient wildcard module declaration does not apply to `../../wht.js`. It is inert everywhere else:
// the browser loads wht.js as a classic script and the Deno suite never looks at it.
//
// Only the names web/ imports today are declared. Adding one is a line; do not describe the whole file
// speculatively.

/** The fields of a computation `whtCompute` reads. A `wht_list` summary satisfies it, and so does a doc. */
export interface WhtDoc {
  /** Fraction, not percent: 0.10 is 10%. */
  wht_rate?: number | string | null;
  /** s.26A service tax rate, fraction. Outside the withholding base — see wht.js's header. */
  sst_rate?: number | string | null;
  /** s.109(2)/s.109B(2) increase, fraction. Applied only when `penalty_on`. */
  penalty_pct?: number | string | null;
  penalty_on?: boolean | null;
  /** `'net'` grosses the fee up before the rate is applied; anything else is the gross basis. */
  basis?: string | null;
}

/** One payment line. `whtCompute` reads only `amount`; `whtDueDate` reads only `payment_date`. */
export interface WhtLine {
  amount?: number | string | null;
  payment_date?: string | null;
}

/** One computation, in ringgit, every field already rounded to the sen. */
export interface WhtTotals {
  fee: number;
  sst: number;
  feeInclSst: number;
  gross: number;
  wht: number;
  penalty: number;
  total: number;
  netToPayee: number;
}

/** `n.toLocaleString('en-MY', {min/maxFractionDigits: 2})` — the sen-exact money string the screen prints. */
export function whtMoney(n: number | string | null | undefined): string;
export function whtRound2(n: number | string | null | undefined): number;
export function whtLineSst(amount: number | string | null | undefined, rate: number | string | null | undefined): number;
export function whtLineTotal(amount: number | string | null | undefined, rate: number | string | null | undefined): number;
export function whtCompute(doc: WhtDoc, lines: WhtLine[] | null | undefined): WhtTotals;
/** The statutory remittance deadline: one month after the last payment date, or null if there is none. */
export function whtDueDate(lines: WhtLine[] | null | undefined): string | null;

/** `[value, label]` per charging section, in the order the picker offers them. */
export const WHT_TYPES: [string, string][];
/** The label a charging section prints as; an unknown value prints as itself. */
export function whtTypeLabel(t: string | null | undefined): string;
