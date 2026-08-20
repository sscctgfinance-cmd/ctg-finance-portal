// Types for ap.js, so the React app in web/ can IMPORT the GL-keyword derivation rather than
// re-express it (see ap.js's own header, and web/src/finance-ap.tsx).
//
// Declarations only. This file must never grow the stop-word set, the length floor or the tie-break:
// ap.js is the single copy and anything duplicated here would be a second copy that nothing checks.
// The server stores the derived word verbatim (finance.ts:1899), so a drift here is a Chart-of-Account
// silently taught wrong for every future bill that matches.
//
// It sits next to ap.js, not inside web/, for the reason payroll.d.ts and gateway.d.ts do:
// `web/tsconfig.json` sets `allowJs: false` and TypeScript resolves a RELATIVE specifier on disk — an
// ambient wildcard module declaration does not apply to `../../ap.js`. It is inert everywhere else:
// the browser loads ap.js as a classic script and the Deno suite never looks at it.

/**
 * The longest "significant" word of a line-item description, or `''` when there is none.
 *
 * `''` is meaningful: `apPostBill()`'s teach loop skips the rule entirely rather than saving a junk
 * keyword that would match half the ledger.
 */
export function apDeriveKeyword(desc: string | null | undefined): string;
