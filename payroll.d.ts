// Types for payroll.js, so the React app in web/ can IMPORT the statutory engine rather than re-express
// it (see payroll.js's own header, and web/src/hr-calculator.tsx).
//
// Declarations only. This file must never grow a rate, a table row or a rounding step: payroll.js is the
// single copy of the maths, pinned by tests/statutory_test.ts and tests/engine_parity_test.ts, and a
// number duplicated here would be a second copy that nothing checks.
//
// It sits next to payroll.js, not inside web/, because `web/tsconfig.json` sets `allowJs: false` and
// TypeScript resolves a RELATIVE specifier on disk — an ambient wildcard module declaration does not
// apply to `../../payroll.js`. It is inert everywhere else: the browser loads payroll.js as a classic
// script and the Deno suite never looks at it.
//
// Only the names web/ imports today are declared. Adding one is a line; do not describe the whole file
// speculatively.

/** One party's pair of contributions for a wage, in ringgit. */
export interface StatParts { ee: number; er: number }

/** A gazetted contribution table: `[wageUpperBound, employeeAmt, employerAmt]` per band. */
export type StatTable = [number, number, number][];

export const MY_SOCSO_CAT1: StatTable;
export const MY_SOCSO_CAT2: StatTable;
export const MY_EIS: StatTable;

export function myStatLookup(tbl: StatTable, wage: number): StatParts;
export function myLindung24(wage: number): number;
export function myLindungActive(period: { year?: number; month?: number } | null): boolean;
export function myPcbRoundUp5(n: number): number;
export function hrRound2(n: number): number;
export function hrEpfParts(wage: number, eeRate: number, erRate: number): StatParts;
export function hrProgTax(chargeable: number): number;
export function hrAge(dob: string | null | undefined, period?: { year?: number; month?: number } | null): number | null;
