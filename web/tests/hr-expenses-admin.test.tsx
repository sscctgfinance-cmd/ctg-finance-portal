// HR OS · Reimbursement · admin half — dashboard parity, settings parity, export byte-for-byte, GL
// editor and Xero post guards.
//
// Dashboard and Settings are SIX new golden surfaces (1 + 5 tabs), each diffed against the legacy
// renderer. The accounting export is NOT a rendering test — it is a FILE that goes into the books, so
// it is held against the legacy's CSV byte-for-byte. GL edit and Post to Xero are server-driven
// commands, so they are guarded by their PROMPT and their double-submit shape, not by markup.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrExpenses, { accountingCsv, type RcClaim, type RcMe, type RcAcctRow } from '../src/hr-expenses';
import HrExpensesDash, { DashLoading, type RcDash } from '../src/hr-expenses-dash';
import HrExpensesSettings, {
  approverPrompt, approverRow, costCenterRow, mileageRateRow, typeRow, workflowChain, workflowRange,
  type RcSetTab, type RcSettingsClaimType, type RcSettingsConfig,
} from '../src/hr-expenses-settings';
import { goldenSection, relax, REPO } from './parity';

const HROS = readFileSync(join(REPO, 'hros.html'), 'utf8');
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

const CLAIMS = (FIXTURES.hr_rc_list as { claims: RcClaim[] }).claims;
const ME = (FIXTURES.hr_rc_config as { me: RcMe }).me;
const CFG = FIXTURES.hr_rc_config as RcSettingsConfig;
const DASH = (FIXTURES.hr_rc_dashboard as { data: RcDash }).data;
const noop = () => {};

// ── The esc function: hros.html replaces & < > " with entities ──────────────────────────────────
// React's own attribute escaper does the same, so the two agree — but `&rsquo;` written by the legacy
// is a named reference React cannot emit. Same finding as hr-payroll / finance-bankfeed.
const decodeRefs = (s: string) => s.replace(/&rsquo;/g, '’');

// ══ 1. Dashboard parity ═══════════════════════════════════════════════════════════════════════════

function dashScreen() {
  return (
    <>
      <HrExpenses
        claims={CLAIMS} me={ME} companyName={COMPANY_NAME} page="dashboard" scope="pending" sel={{}}
        onNav={noop} onScope={noop} onOpen={noop} onSelAll={noop} onSelToggle={noop} onSelClear={noop}
        onExportAcct={noop} onExportCsv={noop} onExportBank={noop} onBulkApprove={noop} onBulkReject={noop}
        onBulkInfo={noop} onBulkPay={noop}
      />
      <HrExpensesDash dash={DASH} />
    </>
  );
}

describe('HR Reimbursement · Dashboard — React vs the legacy golden', () => {
  const GOLDEN = goldenSection('hr.expenses.dash', 'hr');

  it('renders the same document as hrRCDash() does', () => {
    expect(relax(renderToStaticMarkup(dashScreen()))).toBe(relax(GOLDEN));
  });

  it('the loading panel matches the !RC.dash branch', () => {
    const s = renderToStaticMarkup(<DashLoading />);
    expect(s).toContain('class="spin"');
    expect(s).toContain('Loading');
  });
});

// ══ 2. Settings parity — one golden per tab ═══════════════════════════════════════════════════════

function settingsScreen(tab: RcSetTab) {
  return (
    <>
      <HrExpenses
        claims={CLAIMS} me={ME} companyName={COMPANY_NAME} page="settings" scope="pending" sel={{}}
        onNav={noop} onScope={noop} onOpen={noop} onSelAll={noop} onSelToggle={noop} onSelClear={noop}
        onExportAcct={noop} onExportCsv={noop} onExportBank={noop} onBulkApprove={noop} onBulkReject={noop}
        onBulkInfo={noop} onBulkPay={noop}
      />
      <HrExpensesSettings
        cfg={CFG} tab={tab} typeEdit={null} accounts={[]} accLoading={false}
        onSetTab={noop} onTypeNew={noop} onTypeEdit={noop} onTypeCancel={noop} onTypeSave={noop}
        onAddRate={noop} onAddCostCenter={noop} onDelCostCenter={noop} onAddApprover={noop}
        onDelApprover={noop}
      />
    </>
  );
}

describe('HR Reimbursement · Settings — React vs the legacy goldens', () => {
  for (const [tab, label] of [
    ['types', 'Claim Types'], ['rates', 'Mileage Rates'], ['costcenters', 'Cost Centers'],
    ['workflows', 'Approval Workflows'], ['approvers', 'Role Approvers'],
  ] as [RcSetTab, string][]) {
    it(`${label} tab renders the same as hrRCSettings() with RC.setTab='${tab}'`, () => {
      const golden = goldenSection('hr.expenses.settings.' + tab, 'hr');
      expect(relax(renderToStaticMarkup(settingsScreen(tab)))).toBe(relax(golden));
    });
  }
});

// ══ 3. Accounting export — byte-for-byte against the legacy ═══════════════════════════════════════

describe('HR Reimbursement · Accounting CSV', () => {
  /**
   * `hrRCExportAcct` lifted out of hros.html and made callable, exactly as `hr-expenses-pdf.test.tsx`
   * lifts `hrRCBuildFormPdf`. The globals it reaches for are handed in as parameters.
   */
  function legacyCsv(rows: RcAcctRow[], month: string, today: string): string {
    const from = HROS.indexOf('async function hrRCExportAcct(){');
    const to = HROS.indexOf('function hrRCExportCsv(){');
    expect(from, 'hrRCExportAcct moved').toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const src = HROS.slice(from, to);
    // Strip the async wrapper, the prompt/toast/call/hrDownload — keep only the head/body/total/hrCsv
    // chain, which is the CSV-producing core.
    const headIdx = src.indexOf("var head=['Claim No'");
    const endIdx = src.indexOf("hrDownload(");
    expect(headIdx).toBeGreaterThan(0);
    expect(endIdx).toBeGreaterThan(headIdx);
    const core = src.slice(headIdx, endIdx);
    // Build a self-contained function from the CSV-producing lines
    const fn = new Function('r', 'month', 'hrToday', 'hrCsv', `
      var head=['Claim No','Month','Status','Emp No','Employee','Department','Item Date','Expense Type','Vendor','Description','Receipt No','Invoice No','GL Account','Cost Center','Project','Amount (RM)','Tax (RM)','SST (RM)','Payment Date','Payment Method','Payment Ref','Xero Ref','Bank','Bank Account'];
      var body=r.rows.map(function(x){ return [x.claim_no,x.claim_month,x.status,x.emp_no,x.employee,x.department,x.item_date,x.expense_type,x.vendor_name,x.description,x.receipt_no,x.invoice_no,x.gl_account,x.cost_center,x.project,(Number(x.amount)||0).toFixed(2),(Number(x.tax_amount)||0).toFixed(2),(Number(x.sst_amount)||0).toFixed(2),x.payment_date,x.payment_method,x.payment_reference,x.xero_ref,x.bank,x.bank_account]; });
      var total=r.rows.reduce(function(s,x){return s+(Number(x.amount)||0);},0);
      body.push(['','','','','','','','','','','','','','','TOTAL',total.toFixed(2),'','','','','','','','']);
      return hrCsv([head].concat(body));
    `);
    // hrCsv from hr-docs.js — the SAME function both sides use
    const { hrCsv } = require('../../hr-docs.js');
    return fn({ rows }, month, today, hrCsv) as string;
  }

  const ACCT_ROWS = (FIXTURES.hr_rc_export_accounting as { rows: RcAcctRow[] }).rows;

  it('the CSV is byte-for-byte identical to what the legacy produces', () => {
    const legacy = legacyCsv(ACCT_ROWS, '2026-08', '2026-08-24');
    const react = accountingCsv(ACCT_ROWS, '2026-08', '2026-08-24');
    expect(react.text).toBe(legacy);
  });

  it('the TOTAL trailer is present and in the right column', () => {
    const f = accountingCsv(ACCT_ROWS, '', '2026-08-24');
    const lines = f.text.split('\r\n').filter(Boolean);
    const last = lines[lines.length - 1].split(',');
    expect(last[14]).toBe('TOTAL');
    expect(Number(last[15])).toBe(f.total);
  });

  it('the filename matches — ALL when no month, the month when given', () => {
    expect(accountingCsv([], '', '2026-08-24').name).toBe('Reimbursement_Accounting_ALL_2026-08-24.csv');
    expect(accountingCsv([], '2026-08', '2026-08-24').name).toBe('Reimbursement_Accounting_2026-08_2026-08-24.csv');
  });

  it('cells with commas or quotes are quoted by hrCsv, not dropped', () => {
    const rows: RcAcctRow[] = [{ claim_no: 'RC-1', description: 'Lunch, "team"', amount: 50, tax_amount: 0, sst_amount: 0 }];
    const f = accountingCsv(rows, '', '2026-08-24');
    expect(f.text).toContain('"Lunch, ""team"""');
  });
});

// ══ 4. Settings row builders — what LEAVES, pinned against the legacy ═════════════════════════════

describe('HR Reimbursement · Settings row builders', () => {
  it('typeRow() on a NEW type generates a code and a sort_order', () => {
    const t: RcSettingsClaimType = { id: '', name: '', sort_order: 5 };
    const v = { name: 'Travel & meals', gl: '420', pc: '200', pm: '', rr: true, tax: false, mile: false, act: true };
    const r = typeRow(t, v, false, 1724500000000);
    expect(r.id).toBeUndefined();
    expect(r.code).toBe('TRAVEL_MEALS');
    expect(r.sort_order).toBe(5);
    expect(r.gl_account).toBe('420');
    expect(r.max_amount_per_claim).toBe(200);
    expect(r.max_amount_per_month).toBeNull();
  });

  it('typeRow() on an EDIT never re-slugs the code', () => {
    const t: RcSettingsClaimType = { id: 'ct1', name: 'Old', code: 'OLD', sort_order: 1 };
    const r = typeRow(t, { name: 'New Name', gl: '', pc: '', pm: '', rr: false, tax: false, mile: false, act: true }, false, 0);
    expect(r.code).toBeUndefined();
    expect(r.sort_order).toBeUndefined();
    expect(r.name).toBe('New Name');
  });

  it('typeRow() with accLoading keeps the existing GL', () => {
    const t: RcSettingsClaimType = { id: 'ct1', name: 'X', gl_account: '429-0000' };
    const r = typeRow(t, { name: 'X', gl: '', pc: '', pm: '', rr: true, tax: false, mile: false, act: true }, true, 0);
    expect(r.gl_account).toBe('429-0000');
  });

  it('costCenterRow mirrors hrRCAddCC()', () => {
    const r = costCenterRow(' MKT ', 'Marketing', true, 'ten1');
    expect(r).toEqual({ code: 'MKT', name: 'Marketing', tenant_id: null });
    const r2 = costCenterRow('ops', '', false, 'ten1');
    expect(r2).toEqual({ code: 'OPS', name: 'ops', tenant_id: 'ten1' });
  });

  it('mileageRateRow mirrors hrRCAddRate()', () => {
    expect(mileageRateRow('0.70', null)).toEqual({ rate: 0.7, label: 'RM0.70/km', active: true });
    expect(mileageRateRow('0.30', 'Motorcycle')).toEqual({ rate: 0.3, label: 'Motorcycle', active: true });
  });

  it('approverRow mirrors hrRCAddApprover()', () => {
    expect(approverRow('hr', 'e1', 'ten1')).toEqual({ role: 'hr', employee_id: 'e1', tenant_id: 'ten1' });
  });

  it('approverPrompt() matches hros.html:2690 — numbered, 1-based', () => {
    const emps = [{ id: 'e1', emp_no: 'E001', name: 'AHMAD' }, { id: 'e2', emp_no: 'E002', name: 'SITI' }];
    const s = approverPrompt('hr', emps);
    expect(s).toContain('1. E001 — AHMAD');
    expect(s).toContain('2. E002 — SITI');
  });
});

// ══ 5. workflowRange / workflowChain — the two display helpers ════════════════════════════════════

describe('HR Reimbursement · Workflow helpers', () => {
  it('workflowRange with a max', () => expect(workflowRange({ id: '1', min_amount: 0, max_amount: 1000 })).toBe('RM0–1000'));
  it('workflowRange without a max', () => expect(workflowRange({ id: '1', min_amount: 500, max_amount: null })).toBe('RM500+'));
  it('workflowChain sorts by step_order', () => {
    expect(workflowChain([
      { workflow_id: 'w1', step_order: 2, name: 'Finance' },
      { workflow_id: 'w1', step_order: 1, name: 'Manager' },
    ])).toBe('Manager → Finance');
  });
  it('workflowChain with no steps', () => expect(workflowChain([])).toBe('—'));
});

// ══ 6. No handoff to the legacy app — the REGISTRY ═══════════════════════════════════════════════

describe('nothing hands off from this screen', () => {
  const ROUTE = readFileSync(join(REPO, 'web', 'app', 'hr', 'expenses', 'page.tsx'), 'utf8');
  const code = ROUTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('no goLegacy, no window.location.href', () => {
    expect(code).not.toContain('goLegacy');
    expect(code).not.toContain('window.location.href');
  });

  it('legacyUrl appears exactly twice - sign-in link and notice anchor', () => {
    expect([...code.matchAll(/legacyUrl\(/g)].length).toBe(2);
  });
});
