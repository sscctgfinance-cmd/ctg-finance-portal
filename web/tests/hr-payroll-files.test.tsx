// HR OS · Payroll — the statutory / bank FILE exports (v226, part of F1 in the cutover-gap audit).
//
// These 11 controls (UOB / Maybank / IBG salary files, KWSP / PERKESO / CP39 uploads, the four raw
// statutory CSVs, and the submission-pack ZIP) used to toast "open HR OS · Payroll". Now they build the
// same BYTES the legacy does, because `src/hr-payroll-files.ts` calls the builders in `hr-docs.js` — the
// SAME functions hros.html's wrappers call. There is no second copy of a statutory layout; the byte-level
// correctness is `tests/statutory_files_test.ts`'s job on the Deno side.
//
// A downloaded file is in NO golden (CLAUDE.md's rule for `bankFile()` / `profileBody()`), so this file
// pins the two things that ARE this port's own:
//
//  1. THE GLUE. `builderRows()` must feed the builders the `hrEmpView` shape — `taxNo`, `bankName`,
//     `epfNo` — not the raw `tax_no` / `bank_name`. Getting that wrong is invisible in the Deno byte test
//     (which builds its own rows) and would ship a CP39 with a blank TIN and a bank file with no BIC. Each
//     export's descriptor (which toasts, which file, the ZIP's got/failed) is driven directly.
//  2. NO FORK, pinned by source. The module imports the builders from `hr-docs.js`; the route wires the
//     real handlers, not `toLegacy`. Both are read at run time so a regression fails here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  builderRows, statutoryExport, kwspExport, assistExport, cp39Export, giroExport, bankExport, submitAllAction,
  summaryExport, payslipEmp, payslipEmailBody, xeroPostBody,
} from '../src/hr-payroll-files';
import type { PayRow, UobCfg } from '../src/hr-payroll';
import { REPO } from './parity';

/** Two employees, one at an Islamic subsidiary whose name contains the parent's — so the BIC mapping is tested. */
const emp = (o: Record<string, unknown>) => ({
  id: 'x', emp_no: 'T', name: 'N', ic_no: '', tax_no: '', epf_no: '', socso_no: '',
  bank_name: '', bank_code: '', bank_holder: '', bank_account: '', email: '',
  basic_salary: 0, fixed_allowance: 0, marital_status: 'single', num_children: 0, ...o,
}) as unknown as PayRow['e'];

const P = (o: Record<string, number>): PayRow['p'] => ({
  gross: 0, epfEe: 0, epfEr: 0, socsoEe: 0, socsoEr: 0, eisEe: 0, eisEr: 0, lindung: 0, pcb: 0, net: 0,
  employerCost: 0, ...o,
});

const d = (o: Record<string, unknown> = {}) => ({ basic: 0, allow: 0, bonus: 0, ot: 0, allowance: 0, unpaid: 0, deductions: [], ...o });

const ROWS: PayRow[] = [
  { e: emp({ emp_no: 'T001', name: 'TEST ONE', ic_no: '961008-02-6006', tax_no: 'IG28765801050', epf_no: '12345678',
      socso_no: '961008026006', bank_name: 'Malayan Banking Berhad (Maybank)', bank_holder: 'TEST ONE',
      bank_account: '152050433633', email: 't1@example.invalid', basic_salary: 3500 }),
    p: P({ gross: 3500, epfEe: 385, epfEr: 455, socsoEe: 17.25, socsoEr: 60.35, eisEe: 6.9, eisEr: 6.9, lindung: 25.85, pcb: 44.35, net: 3019.65 }),
    d: d({ basic: 3500 }) },
  { e: emp({ emp_no: 'T002', name: 'TEST TWO', ic_no: '950608-07-5211', tax_no: 'IG27380252060', epf_no: '87654321',
      socso_no: '950608075211', bank_name: 'Maybank Islamic Berhad', bank_holder: 'TEST TWO',
      bank_account: '164258594821', email: 't2@example.invalid', basic_salary: 4000 }),
    p: P({ gross: 4000, epfEe: 440, epfEr: 520, socsoEe: 19.75, socsoEr: 69.15, eisEe: 7.9, eisEr: 7.9, lindung: 29.65, pcb: 117, net: 3385.70 }),
    d: d({ basic: 4000 }) },
];
const UOB: UobCfg = { acct: '1234567890', cd: '2026-07-31' };
const M = 7, Y = 2026;   // July 2026 → "July2026" in every file name

describe('builderRows — hrCurRows()\'s hrEmpView flattening (the integration risk)', () => {
  it('maps the raw employee to the hrEmpView shape the builders read', () => {
    const [r] = builderRows(ROWS);
    expect(r.e.taxNo).toBe('IG28765801050');   // NOT tax_no — a blank here files a CP39 with no TIN
    expect(r.e.epfNo).toBe('12345678');
    expect(r.e.socsoNo).toBe('961008026006');
    expect(r.e.bankName).toBe('Malayan Banking Berhad (Maybank)');
    expect(r.e.ic).toBe('961008-02-6006');
    expect(r.p).toBe(ROWS[0].p);   // the computed quote is passed through untouched — never re-derived
  });
});

describe('the file descriptors — name, toast, and whether a file downloads', () => {
  it('KWSP i-Akaun: downloads a .txt named for the period, with a member count', () => {
    const a = kwspExport(ROWS, M, Y);
    expect(a.download?.name).toBe('KWSP_iAkaun_July2026.txt');
    expect(a.toasts[0].msg).toBe('KWSP i-Akaun file — 2 members. Do one test upload to confirm layout.');
  });

  it('CP39: the TIN mapping reaches the file — the first record starts with the 11-digit number', () => {
    const a = cp39Export(ROWS, M, Y);
    expect(a.download?.name).toBe('LHDN_CP39_July2026.txt');
    expect(a.download!.text.split('\r\n')[0].slice(0, 11)).toBe('28765801050');   // not "IG287658010"
  });

  it('PERKESO ASSIST: downloads a .csv with a LINDUNG 24 column', () => {
    const a = assistExport(ROWS, M, Y);
    expect(a.download?.name).toBe('PERKESO_ASSIST_July2026.csv');
    expect(a.download!.text.split('\r\n')[0]).toMatch(/LINDUNG 24/);
  });

  it('UOB salary file: real BIC per employee (Islamic subsidiary is not the parent BIC)', () => {
    const a = bankExport(ROWS, M, Y, 'uob', UOB);
    expect(a.download?.name).toBe('UOB_Infinity_IBG_Payroll_July2026.csv');
    const bic = a.download!.text.split('\r\n').filter(Boolean).slice(1).map((l) => l.split(',')[4]);
    expect(bic).toEqual(['MBBEMYKL', 'MBISMYKL']);   // hrSwift resolves the real BIC from the name
    expect(a.toasts.at(-1)!.msg).toContain('UOB Infinity salary file — 2 staff');
  });

  it('Maybank M2E: distinct file name and no TOTAL trailer', () => {
    const a = bankExport(ROWS, M, Y, 'maybank', UOB);
    expect(a.download?.name).toBe('Maybank_M2E_Salary_July2026.csv');
    expect(/TOTAL/i.test(a.download!.text)).toBe(false);
  });

  it('Generic IBG: net-pay total in the toast', () => {
    const a = giroExport(ROWS, M, Y);
    expect(a.download?.name).toBe('Bank_Giro_July2026.csv');
    expect(a.toasts[0].msg).toMatch(/Bank giro CSV — 2 staff, RM 6,405\.35/);
  });

  it('raw statutory CSVs: one per kind, each downloaded', () => {
    for (const [kind, name] of [['epf', 'EPF_KWSP_July2026.csv'], ['socso', 'SOCSO_PERKESO_July2026.csv'],
      ['eis', 'EIS_SIP_July2026.csv'], ['pcb', 'PCB_CP39_July2026.csv']] as const) {
      const a = statutoryExport(ROWS, M, Y, kind);
      expect(a.download?.name).toBe(name);
      expect(a.toasts[0].msg).toBe(kind.toUpperCase() + ' CSV downloaded');
    }
  });
});

describe('the empty / blocked paths — a toast and NO download', () => {
  it('KWSP with no EPF contributions: a toast, no file', () => {
    const a = kwspExport([{ ...ROWS[0], p: P({ epfEe: 0, epfEr: 0, net: 100 }) }], M, Y);
    expect(a.download).toBeUndefined();
    expect(a.toasts).toEqual([{ msg: 'No EPF contributions this period', isErr: true }]);
  });

  it('CP39 blocks (does not download) when a required TIN is missing', () => {
    const noTin = [{ ...ROWS[0], e: emp({ ...({ tax_no: '', ic_no: '961008-02-6006', name: 'NO TIN', epf_no: '1' }) }), p: P({ pcb: 50 }) }];
    const a = cp39Export(noTin, M, Y);
    expect(a.download).toBeUndefined();
    expect(a.toasts[0].isErr).toBe(true);
    expect(a.toasts[0].msg).toMatch(/CP39 blocked — missing TIN/);
  });

  it('a bank file with a blank beneficiary account still downloads, but the toast warns', () => {
    const noAcct = [{ ...ROWS[0], e: emp({ ...ROWS[0].e as object, bank_account: '' }) as PayRow['e'] }];
    const a = bankExport(noAcct, M, Y, 'uob', UOB);
    expect(a.download).toBeDefined();
    expect(a.toasts.at(-1)!.msg).toContain('1 missing bank a/c');
    expect(a.toasts.at(-1)!.isErr).toBe(true);
  });
});

describe('submitAllAction — the one-click ZIP', () => {
  it('builds a ZIP blob, names it for the company + period, and lists the got files in the tracker', () => {
    const a = submitAllAction(ROWS, M, Y, 'I PROCARE MALAYSIA SDN BHD', UOB);
    expect(a.zip?.name).toBe('CTG_Payroll_Submissions_I_PROCARE_MALAYSIA_SDN_BHD_July2026.zip');
    expect(a.zip?.blob).toBeInstanceOf(Blob);
    expect(a.pack?.per).toBe('July 2026');
    expect(a.pack?.items.map((i) => i.key)).toEqual(['salary', 'epf', 'perkeso', 'pcb']);
    expect(a.toasts.at(-1)!.msg).toContain('✓ 4 submission files generated');
  });

  it('a blank beneficiary account FAILS the salary file in the pack rather than shipping it silently (v157)', () => {
    const noAcct = ROWS.map((r) => ({ ...r, e: emp({ ...r.e as object, bank_account: '' }) as PayRow['e'] }));
    const a = submitAllAction(noAcct, M, Y, 'CO', UOB);
    // salary is now an error, so the pack is partial and the tracker excludes it.
    expect(a.pack?.items.some((i) => i.key === 'salary')).toBe(false);
    expect(a.toasts.some((t) => /blocked — .*Salaries/.test(t.msg))).toBe(true);
    expect(a.toasts.at(-1)!.msg).toContain('partial pack — 3 of 4');
  });

  it('no payroll rows: a single toast, no ZIP', () => {
    const a = submitAllAction([], M, Y, 'CO', UOB);
    expect(a.zip).toBeUndefined();
    expect(a.toasts).toEqual([{ msg: 'No payroll to submit — finalise the month first', isErr: true }]);
  });
});

describe('Payroll Summary (Excel + HRDF)', () => {
  it('downloads a .xls named for the period, with the HRDF column and its 1%-of-basic value', () => {
    const a = summaryExport(ROWS, M, Y, 'I PROCARE MALAYSIA SDN BHD');
    expect(a.download?.name).toBe('Payroll_Summary_July2026.xls');
    expect(a.download!.mime).toBe('application/vnd.ms-excel');
    expect(a.download!.text).toContain('>HRDF<');           // the column exists
    expect(a.download!.text).toContain('>35.00<');          // 1% of basic 3,500 = 35.00 (the only place HRDF is computed)
    expect(a.download!.text).toContain('LINDUNG 24');
    expect(a.download!.text).toContain('I PROCARE MALAYSIA SDN BHD');
  });

  it('no payroll rows: a toast, no file', () => {
    expect(summaryExport([], M, Y, 'CO')).toEqual({ toasts: [{ msg: 'No payroll rows', isErr: true }] });
  });
});

describe('payslipEmp — the leave-balance mapping (an id mismatch prints the wrong person)', () => {
  it('attaches THIS employee\'s leave balances and the hrEmpView shape', () => {
    const rowA: PayRow = { ...ROWS[0], e: { ...(ROWS[0].e as object), id: 'e1' } as PayRow['e'] };
    const bals = { e1: [{ type: 'Annual', remaining: 8 }], e2: [{ type: 'Annual', remaining: 3 }] };
    const e = payslipEmp(rowA, bals);
    expect(e.leaveBal).toEqual([{ type: 'Annual', remaining: 8 }]);
    expect(e.taxNo).toBe('IG28765801050');
    expect(e.empNo).toBe('T001');
  });

  it('an employee with no balances gets an empty list, not another employee\'s', () => {
    const rowA: PayRow = { ...ROWS[0], e: { ...(ROWS[0].e as object), id: 'zzz' } as PayRow['e'] };
    expect(payslipEmp(rowA, { e1: [{ x: 1 }] }).leaveBal).toEqual([]);
  });
});

describe('payslipEmailBody — the hr_send_payslip payload shape (no golden sees a request)', () => {
  it('carries to / subject / filename / empNo, and the html from hrPayslipEmailHtml', () => {
    const e = { name: 'TEST ONE', empNo: 'T001', email: 't1@example.invalid', ic: '961008026006' };
    const b = payslipEmailBody(e, { month: 7, year: 2026, label: 'July 2026' }, 'I PROCARE MALAYSIA SDN BHD', 'BASE64PDF');
    expect(b.api).toBe('hr_send_payslip');
    expect(b.payload.to).toBe('t1@example.invalid');
    expect(b.payload.subject).toBe('Payslip — July 2026');
    expect(b.payload.filename).toBe('Payslip_T001_July2026.pdf');
    expect(b.payload.empNo).toBe('T001');
    expect(b.payload.pdfBase64).toBe('BASE64PDF');
    expect(b.payload.html).toContain('Hi TEST,');                    // first name only
    expect(b.payload.html).toContain('I PROCARE MALAYSIA SDN BHD');  // the company footer
    expect(b.payload.html).toMatch(/IC number/);
  });
});

describe('xeroPostBody — the hr_post_xero DRAFT-journal body', () => {
  it('is the runId and tenantId, so the server refuses a company the admin does not hold', () => {
    expect(xeroPostBody('run-9', 'tenant-1')).toEqual({ api: 'hr_post_xero', runId: 'run-9', tenantId: 'tenant-1' });
  });
});

describe('no fork — pinned by source', () => {
  const files = readFileSync(join(REPO, 'web/src/hr-payroll-files.ts'), 'utf8');
  const route = readFileSync(join(REPO, 'web/app/hr/payroll/page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('the builders come from hr-docs.js, not a reimplementation', () => {
    expect(files).toMatch(/from '\.\.\/\.\.\/hr-docs\.js'/);
    expect(files).toMatch(/hrBuildKwsp|hrBuildBank|hrSubmissionSpecs/);
    expect(files).toMatch(/hrBuildSummary|hrPayslipEmailHtml/);
  });

  it('the payslip PDF is drawn by the shared hr-docs.js file, not re-expressed', () => {
    expect(route).toMatch(/from '\.\.\/\.\.\/\.\.\/\.\.\/hr-docs\.js'/);
    expect(route).toMatch(/hrDrawPayslip/);
    expect(route).toMatch(/hrIcPassword/);   // the IC password comes from the shared file too
  });

  it('every export handler is wired to a real handler, not toLegacy', () => {
    for (const h of ['onExpKwsp={onExpKwsp}', 'onExpAssist={onExpAssist}', 'onExpCp39={onExpCp39}',
      'onExpBank={onExpBank}', 'onExpGiro={onExpGiro}', 'onExpStatutory={onExpStatutory}', 'onSubmitAll={onSubmitAll}',
      'onExpSummary={onExpSummary}', 'onExpPayslips={onExpPayslips}', 'onEmailAll={onEmailAll}', 'onPostXero={onPostXero}']) {
      expect(route).toContain(h);
    }
    expect(route).not.toContain('toLegacy');   // nothing hands off to the legacy screen any more
  });
});
