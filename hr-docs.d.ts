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

/** One employee's annual totals — `hr_annual`'s `annual` map, keyed by employee id. */
export interface HrAnnualTotals {
  months: number;
  gross: number;
  epfEe: number;
  socsoEe?: number | null;
  lindung?: number | null;
  pcb: number;
  [k: string]: unknown;
}

/** The totals row for an employee with no finalised payslip in the year. */
export const HR_EA_ZERO: HrAnnualTotals;

/** Who gets filed: employees with at least one finalised payslip in the year (`months > 0`). */
export function hrYePaid<T extends { id: string }>(
  employees: T[],
  annual: Record<string, HrAnnualTotals> | null | undefined,
): T[];

/** Form E (C.P.8) part B — the six declared figures. Counts every employee row, not only the paid. */
export function hrFormEStats(
  employees: { id: string; join_date?: string | null; resign_date?: string | null }[],
  annual: Record<string, HrAnnualTotals> | null | undefined,
  year: number,
): { total: number; newHires: number; ceased: number; subjectPcb: number; totalGross: number; totalPcb: number };

/** CP8D — the per-employee remuneration schedule. `'txt'` is uploaded, `'csv'` is reviewed; same values. */
export function hrCp8dFile(
  list: { emp: Record<string, unknown>; tot: HrAnnualTotals }[],
  employerNo: string | null | undefined,
  year: number,
  fmt: 'txt' | 'csv',
): { name: string; text: string };

/** Draws one Borang EA (C.P.8A) page into a jsPDF document. */
export function hrDrawEA(
  doc: unknown,
  e: Record<string, unknown>,
  t: HrAnnualTotals,
  year: number,
  emp: Record<string, unknown>,
): void;

/** Draws the Form E (C.P.8) working summary into a jsPDF document. */
export function hrDrawFormE(
  doc: unknown,
  employer: Record<string, unknown>,
  stats: ReturnType<typeof hrFormEStats>,
  year: number,
): void;

// ── The statutory / bank FILE builders (v226) ──────────────────────────────────────────────────────
// Pure functions of (rows, period, …); the file BYTES, so React (web/) emits the same thing hros.html
// does rather than a second copy. `rows` is hrCurRows()'s shape — the raw employee flattened through
// hrEmpView. tests/statutory_files_test.ts drives the file contents.

/** One row for the file builders: the employee flattened through hrEmpView, plus the computed quote and grid cell. */
export interface HrBuilderRow { e: Record<string, unknown>; p: Record<string, unknown>; d: Record<string, unknown> }
/** The payroll period the file names and headers are stamped with. */
export interface HrPeriod { month: number; year: number; label: string }
/** A built file, or null (nothing to file this period), or { error } (blocked — a value would go to the wrong place). */
export interface HrBuiltFile {
  name: string; text: string; mime: string;
  count?: number; total?: number; noAcct?: number; blockers?: string[]; tips?: string[];
}

/** EPF / SOCSO / EIS / PCB raw reconciliation CSV (a review copy, with a TOTAL row — not an upload). */
export function hrBuildStatutory(rows: HrBuilderRow[], period: HrPeriod, kind: 'epf' | 'socso' | 'eis' | 'pcb'): { name: string; text: string; mime: string };
/** EPF → KWSP i-Akaun bulk contribution text file (fixed-width, cents). */
export function hrBuildKwsp(rows: HrBuilderRow[], period: HrPeriod): HrBuiltFile | { error: string } | null;
/** SOCSO + EIS → PERKESO ASSIST combined contribution CSV. */
export function hrBuildAssist(rows: HrBuilderRow[], period: HrPeriod): HrBuiltFile | { error: string } | null;
/** PCB → LHDN CP39 / e-PCB text file (fixed-width, cents). */
export function hrBuildCp39(rows: HrBuilderRow[], period: HrPeriod): HrBuiltFile | { error: string } | null;
/** Generic IBG salary CSV (net pay). No blockers — the caller checks for empty rows. */
export function hrBuildGiro(rows: HrBuilderRow[], period: HrPeriod): HrBuiltFile;
/** Bank-specific salary bulk-payment file (net pay). `tips` are non-blocking UOB reminders the caller toasts. */
export function hrBuildBank(rows: HrBuilderRow[], period: HrPeriod, bank: string, uobCfg: { acct?: string; cd?: string } | null | undefined): HrBuiltFile | null;

/** CRC-32 of a byte array — the STORE-method ZIP's checksum. */
export function hrCrc32(bytes: Uint8Array): number;
/** Dependency-free STORE-method ZIP (no compression) of `{ name, text }` files → a Blob. */
export function hrZip(files: { name: string; text: string }[]): Blob;
/** Payroll Summary (styled .xls that opens in Excel). Also the ONLY place HRDF (1% of basic) is computed. */
export function hrBuildSummary(rows: HrBuilderRow[], period: HrPeriod, companyName: string): { name: string; text: string; mime: string };
/** ArrayBuffer → base64 (chunked, for the encrypted payslip PDF attachment). */
export function hrAbToB64(ab: ArrayBuffer): string;
/** The password an emailed payslip PDF is locked with — the employee's IC digits, or their emp no. */
export function hrIcPassword(e: Record<string, unknown>): string;
/** The `hr_send_payslip` email body HTML. `companyName` was the HR_COMPANY global. */
export function hrPayslipEmailHtml(e: Record<string, unknown>, period: HrPeriod, companyName: string): string;

/** The one-click submission pack: build every statutory + salary file, report got/failed, name the ZIP. */
export function hrSubmissionSpecs(
  rows: HrBuilderRow[], period: HrPeriod, companyName: string, uobCfg: { acct?: string; cd?: string } | null | undefined,
): {
  co: string;
  specs: { key: string; label: string; file: HrBuiltFile | { error: string } | null }[];
  got: { key: string; label: string; file: HrBuiltFile }[];
  failed: { key: string; label: string; file: { error: string } }[];
  files: { name: string; text: string }[];
  zipName: string;
};
