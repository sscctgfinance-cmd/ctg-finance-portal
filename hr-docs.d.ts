// Types for hr-docs.js, so the React app in web/ can IMPORT the file/format primitives rather than
// re-express them (see hr-docs.js's own header, and web/src/hr-expenses.tsx).
//
// Same reasoning, and the same rules, as payroll.d.ts next door: declarations ONLY. A bank code, a CSV
// quoting rule or a layout constant copied here would be a second copy of bytes that leave the building
// and that tests/statutory_files_test.ts does not see.
//
// It sits next to hr-docs.js, not inside web/, because `web/tsconfig.json` sets `allowJs: false` and
// TypeScript resolves a RELATIVE specifier on disk — an ambient wildcard module declaration does not
// apply to `../../hr-docs.js`. It is inert everywhere else: the browser loads hr-docs.js as a classic
// script and the Deno suite never looks at it.
//
// Only the names web/ imports today are declared. Adding one is a line; do not describe the whole file
// speculatively.

/** RFC4180-ish CSV: quotes a cell only when it holds `"`, `,`, CR or LF; CRLF rows, trailing CRLF. */
export function hrCsv(rows: (string | number)[][]): string;

/** Malaysian bank name → SWIFT/BIC, by substring match. `''` when nothing matches. */
export function hrBankCode(name: string | null | undefined): string;

/** One employee master record → the flat view the PDF drawers read. */
export function hrEmpView(e: Record<string, unknown>): Record<string, unknown>;

/** Draws one month's payslip into a jsPDF document. Reads the `HR_EMPLOYER` / `HR_COMPANY` globals. */
export function hrDrawPayslip(
  doc: unknown,
  e: Record<string, unknown>,
  p: Record<string, unknown>,
  period: { month: number; year: number; label: string },
  d: Record<string, unknown>,
): void;
