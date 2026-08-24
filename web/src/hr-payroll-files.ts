// The payroll statutory / bank FILE exports — the React half of hros.html's hrExp* buttons.
//
// ── NOT A FORK ──────────────────────────────────────────────────────────────────────────────────────
// Every file's BYTES are built by `hr-docs.js` (hrBuildStatutory / hrBuildKwsp / hrBuildAssist /
// hrBuildCp39 / hrBuildGiro / hrBuildBank / hrSubmissionSpecs / hrZip) — the SAME functions hros.html's
// wrappers call, so the two apps cannot disagree about a statutory upload, a bank payment file, or the
// ZIP. That is the whole point of lifting them (CLAUDE.md's "seam still open"). Nothing here re-derives a
// figure; `tests/statutory_files_test.ts` is the gate on the bytes.
//
// This module is the pure GLUE: it maps the React grid's `PayRow[]` into the `{e,p,d}` shape the builders
// consume (the employee flattened through `hrEmpView`, exactly as `hrCurRows()` does), and it turns a
// build result into a DESCRIPTOR — which toasts to show and which file/ZIP to download — so the route's
// only job is the blob-and-anchor and the toast host. The descriptor is what `web/tests/hr-payroll-files.test.tsx`
// drives, because a downloaded file is in no golden (CLAUDE.md's rule for `bankFile()` / `profileBody()`).

import {
  hrEmpView, hrBuildStatutory, hrBuildKwsp, hrBuildAssist, hrBuildCp39, hrBuildGiro, hrBuildBank,
  hrSubmissionSpecs, hrZip, hrBuildSummary, hrPayslipEmailHtml,
  type HrBuilderRow, type HrPeriod, type HrBuiltFile,
} from '../../hr-docs.js';
import { HR_MONTHS, type PayRow, type StatFile, type UobCfg, type SubmitPack } from './hr-payroll';

export interface FileToast { msg: string; isErr?: boolean }
export interface DownloadFile { name: string; text: string; mime: string }
/** What the route does with a build: show these toasts, download this file / this ZIP, set this tracker. */
export interface FileAction {
  toasts: FileToast[];
  download?: DownloadFile;
  zip?: { name: string; blob: Blob };
  pack?: SubmitPack;
}

/** `hrCurRows()` — hros.html:4405. The raw employee flattened through hrEmpView, plus quote and grid cell. */
export function builderRows(rows: PayRow[]): HrBuilderRow[] {
  return rows.map((r) => ({
    e: hrEmpView(r.e as unknown as Record<string, unknown>),
    p: r.p as unknown as Record<string, unknown>,
    d: r.d,
  }));
}

/** `hrPeriod()` — hros.html:4406. */
export function payrollPeriod(month: number, year: number): HrPeriod {
  return { month, year, label: HR_MONTHS[month] + ' ' + year };
}

/** EPF / SOCSO / EIS / PCB raw reconciliation CSV — `hrExpStatutory()`, hros.html:4412. */
export function statutoryExport(rows: PayRow[], month: number, year: number, kind: StatFile): FileAction {
  if (!rows.length) return { toasts: [{ msg: 'No payroll rows', isErr: true }] };
  const f = hrBuildStatutory(builderRows(rows), payrollPeriod(month, year), kind);
  return { toasts: [{ msg: kind.toUpperCase() + ' CSV downloaded' }], download: f };
}

/** KWSP i-Akaun — `hrExpKwsp()`, hros.html:4421. */
export function kwspExport(rows: PayRow[], month: number, year: number): FileAction {
  const f = hrBuildKwsp(builderRows(rows), payrollPeriod(month, year));
  if (!f) return { toasts: [{ msg: 'No EPF contributions this period', isErr: true }] };
  if ('error' in f) return { toasts: [{ msg: f.error, isErr: true }] };
  return { toasts: [{ msg: 'KWSP i-Akaun file — ' + f.count + ' members. Do one test upload to confirm layout.' }], download: f };
}

/** PERKESO ASSIST — `hrExpAssist()`, hros.html:4445. */
export function assistExport(rows: PayRow[], month: number, year: number): FileAction {
  const f = hrBuildAssist(builderRows(rows), payrollPeriod(month, year));
  if (!f) return { toasts: [{ msg: 'No SOCSO/EIS contributions this period', isErr: true }] };
  if ('error' in f) return { toasts: [{ msg: f.error, isErr: true }] };
  return { toasts: [{ msg: 'PERKESO ASSIST file (SOCSO+EIS) — ' + f.count + ' staff. Confirm columns on ASSIST.' }], download: f };
}

/** LHDN CP39 / e-PCB — `hrExpCp39()`, hros.html:4466. */
export function cp39Export(rows: PayRow[], month: number, year: number): FileAction {
  const f = hrBuildCp39(builderRows(rows), payrollPeriod(month, year));
  if (!f) return { toasts: [{ msg: 'No PCB payable this period', isErr: true }] };
  if ('error' in f) return { toasts: [{ msg: f.error, isErr: true }] };
  return { toasts: [{ msg: 'LHDN CP39 file — ' + f.count + ' staff. Do one test upload on e-PCB to confirm.' }], download: f };
}

/** Generic IBG CSV — `hrExpGiro()`, hros.html:4476. */
export function giroExport(rows: PayRow[], month: number, year: number): FileAction {
  if (!rows.length) return { toasts: [{ msg: 'No payroll rows', isErr: true }] };
  const f = hrBuildGiro(builderRows(rows), payrollPeriod(month, year)) as HrBuiltFile;
  return { toasts: [{ msg: 'Bank giro CSV — ' + f.count + ' staff, ' + money(f.total) }], download: f };
}

/** UOB Infinity / Maybank M2E salary file — `hrExpBank()`, hros.html:4487. */
export function bankExport(rows: PayRow[], month: number, year: number, bank: 'uob' | 'maybank', uob: UobCfg): FileAction {
  const f = hrBuildBank(builderRows(rows), payrollPeriod(month, year), bank, uob) as HrBuiltFile | null;
  if (!f) return { toasts: [{ msg: bank === 'maybank' ? 'No payroll rows' : 'No positive net pay to disburse', isErr: true }] };
  const toasts: FileToast[] = (f.tips || []).map((t) => ({ msg: t, isErr: true }));
  toasts.push({
    msg: (bank === 'maybank' ? 'Maybank' : 'UOB Infinity') + ' salary file — ' + f.count + ' staff, ' + money(f.total) +
      (f.noAcct ? (' · ⚠ ' + f.noAcct + ' missing bank a/c') : ''),
    isErr: !!f.noAcct,
  });
  return { toasts, download: f };
}

/**
 * Submission pack ZIP — `hrSubmitAll()`, hros.html:4488. The "not finalised, generate anyway?" confirm
 * is a modal and stays in the route; by the time this runs the operator has agreed. Mirrors the legacy's
 * toasts and the `HR.submitPack` tracker (returned as `pack`).
 */
export function submitAllAction(
  rows: PayRow[], month: number, year: number, companyName: string, uob: UobCfg,
): FileAction {
  if (!rows.length) return { toasts: [{ msg: 'No payroll to submit — finalise the month first', isErr: true }] };
  const per = payrollPeriod(month, year);
  const pk = hrSubmissionSpecs(builderRows(rows), per, companyName, uob);
  const toasts: FileToast[] = [];
  if (pk.failed.length) {
    toasts.push({ msg: '⚠ ' + pk.failed.length + ' file(s) blocked — ' + pk.failed.map((s) => s.label + ': ' + s.file.error).join(' | '), isErr: true });
  }
  if (!pk.got.length) {
    if (!pk.failed.length) toasts.push({ msg: 'Nothing to generate for this month', isErr: true });
    return { toasts };
  }
  toasts.push({
    msg: (pk.failed.length ? ('⚠ partial pack — ' + pk.got.length + ' of ' + pk.specs.length + ' files') : ('✓ ' + pk.got.length + ' submission files generated')) + ' — see the upload steps below',
    isErr: pk.failed.length > 0,
  });
  const pack: SubmitPack = {
    per: per.label,
    items: pk.got.map((s) => ({ key: s.key as SubmitPack['items'][number]['key'], label: s.label, file: { name: s.file.name, count: s.file.count || 0, total: s.file.total || 0 } })),
  };
  return { toasts, zip: { name: pk.zipName, blob: hrZip(pk.files) }, pack };
}

/** Payroll Summary (Excel) — `hrExpSummary()`, hros.html:4516. Also the only place HRDF is computed. */
export function summaryExport(rows: PayRow[], month: number, year: number, companyName: string): FileAction {
  if (!rows.length) return { toasts: [{ msg: 'No payroll rows', isErr: true }] };
  const f = hrBuildSummary(builderRows(rows), payrollPeriod(month, year), companyName);
  return { toasts: [{ msg: 'Payroll summary (Excel) exported' }], download: f };
}

/**
 * `hrCurRows()`'s payslip row — `hrEmpView(emp)` plus the year's leave balances, which `hrDrawPayslip`
 * prints (hros.html:4405 sets `ev.leaveBal`). A blank `leaveBal` just drops that section; getting the id
 * mapping wrong prints someone else's balances, which no golden sees.
 */
export function payslipEmp(row: PayRow, leaveBalances: Record<string, unknown[]> | undefined): Record<string, unknown> {
  const ev = hrEmpView(row.e as unknown as Record<string, unknown>);
  ev.leaveBal = (leaveBalances || {})[(row.e as { id: string }).id] || [];
  return ev;
}

/**
 * The `hr_send_payslip` POST body — `hrEmailAll()`, hros.html:4572. Split out so the payload SHAPE is
 * pinned by a test (no golden sees a request); the PDF itself is drawn in the route (it needs jsPDF).
 * `e` is a `payslipEmp` row, so `e.empNo` / `e.email` are the hrEmpView names.
 */
export function payslipEmailBody(e: Record<string, unknown>, period: HrPeriod, companyName: string, pdfBase64: string) {
  return {
    api: 'hr_send_payslip',
    payload: {
      to: e.email,
      subject: 'Payslip — ' + period.label,
      html: hrPayslipEmailHtml(e, period, companyName),
      filename: 'Payslip_' + e.empNo + '_' + period.label.replace(' ', '') + '.pdf',
      pdfBase64,
      empNo: e.empNo,
    },
  };
}

/** The `hr_post_xero` POST body — `hrPostXero()`, hros.html:4707. DRAFT journal only; the server refuses a tenant the admin doesn't hold. */
export function xeroPostBody(runId: string, tenantId: string) {
  return { api: 'hr_post_xero', runId, tenantId };
}

/** `M()` — the two toasts above show a ringgit total; matches hros.html's `M(n)`. */
function money(n: number | undefined): string {
  return 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
