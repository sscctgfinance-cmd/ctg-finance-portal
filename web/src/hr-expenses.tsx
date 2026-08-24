// HR OS · Reimbursement (Expenses) — the claims list, migrated.
//
// The legacy original is `hrRC()` at hros.html:1777 (with `hrRCList()` at :1813, `rcStatusPill()` at
// :1775 and the `hrRCSel*` selection helpers at :1841-1844) and it is STILL THERE and still shipping;
// nothing was deleted. Both are reachable side by side (`hros.html#tab=expenses` and `/hr/expenses/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read — which is what lets
// tests/hr-expenses.parity.test.tsx render it with `renderToStaticMarkup` and diff the result against
// tests/golden/hr.expenses.html. The loading, the session and the state live in
// app/hr/expenses/page.tsx, on the other side of that line.
//
// The markup mirrors the legacy string concatenation element for element, inline `style` strings
// included. It is not "better" — it is the SAME, because the golden is the contract.
//
// ── SCOPE: the list sub-page only ────────────────────────────────────────────────────────────────
// `hrRC()` is a tab bar over five bodies — list, detail, form, dashboard, settings. This file is the
// page head, the tab bar and the LIST; `page` selects which, and any value other than 'list' (and
// 'detail', which highlights the list tab exactly as the legacy does) renders no body HERE. v225 added
// the other two the employee needs as their own components and their own goldens —
// `src/hr-expenses-form.tsx` (`hr.expenses.form`) and `src/hr-expenses-detail.tsx`
// (`hr.expenses.detail`) — which `app/hr/expenses/page.tsx` mounts alongside this one. Dashboard and
// Settings are admin-only and still hand off.
//
// NOT reachable from the golden, mirrored from the legacy source anyway (see CLAUDE.md — "a branch the
// golden does not hold is not covered, say so where you write it"):
//   • the loading panel (`RC.loading && !RC.cfg`) — RC_PRIMED runs hrRCBoot() before the capture;
//   • the empty-list row — the fixture has three claims;
//   • the bulk action bar's buttons and the `clear` link — the golden was captured with `RC.sel` empty,
//     so the bar renders only its prompt. Left out, the bulk buttons would be wired to nothing.
//   • the `⇢X` Xero badge — no fixture claim carries `xero_bill_id`.
// This file's parity test does not reach any of them. Employee mode (`RC.me.isAdmin === false`), which
// changes BOTH the tab list and the scope list, used to be on that list and is now its own golden —
// `hr.expenses.emp`, diffed in `web/tests/hr-expenses-emp.parity.test.tsx`.
//
// ── The bank file is NOT markup, and it is the dangerous part of this screen ─────────────────────
// `bankFile()` below is `hrRCExportBank()` (hros.html:1849) moved across verbatim, minus the download
// and the toast, which are the button and live in the route. It is exported as a pure function
// precisely so the parity test can assert what is in the file — see its own comment, and the v157
// incident it carries.

import type { CSSProperties } from 'react';

import { hrBankCode, hrCsv } from '../../hr-docs.js';

/** One row of `hr_rc_list` — only the fields `hrRCList()` and `hrRCExportBank()` actually read. */
export interface RcClaim {
  id: string;
  claim_no?: string | null;
  claim_date?: string | null;
  amount?: number | string | null;
  status?: string | null;
  xero_bill_id?: string | null;
  hr_employees?: {
    name?: string | null;
    bank_name?: string | null;
    bank_code?: string | null;
    bank_account?: string | null;
    ic_no?: string | null;
    email?: string | null;
  } | null;
  hr_claim_types?: { name?: string | null } | null;
}

/** `RC.me` — what `hr_rc_config` returns about the viewer (hros.html:1814-1819). */
export interface RcMe {
  isAdmin?: boolean;
  is_manager?: boolean;
  roles?: string[];
}

export type RcScope = 'pending' | 'approved' | 'paid' | 'all';
export type RcPage = 'list' | 'detail' | 'form' | 'dashboard' | 'settings';

export interface HrExpensesProps {
  /** `RC.list` — hros.html:1812. */
  claims: RcClaim[];
  /** `RC.me`. */
  me: RcMe;
  /** `RC.scope` and `RC.page`. */
  scope: RcScope;
  page: RcPage;
  /** `RC.sel` — id → selected. The map, not a list, exactly as the legacy keeps it. */
  sel: Record<string, boolean>;
  /** `hrCompanyName()` — hros.html:4445. Chrome, so it is passed in rather than resolved here. */
  companyName: string;
  onNav: (page: string) => void;
  onScope: (scope: string) => void;
  onOpen: (id: string) => void;
  onSelAll: (on: boolean) => void;
  onSelToggle: (id: string, on: boolean) => void;
  onSelClear: () => void;
  onExportAcct: () => void;
  /** `exportRef` in the route — greys the 📒 button while its export is in flight. The REFUSAL is the
   *  route's synchronous ref; this is only what the button reads. `false` renders no attribute, so no
   *  golden moves. */
  exportingAcct?: boolean;
  onExportCsv: () => void;
  onExportBank: () => void;
  onBulkApprove: () => void;
  onBulkReject: () => void;
  onBulkInfo: () => void;
  onBulkPay: () => void;
}

/** `M()` — hros.html:1268. UI money formatting, so it lives with the UI. */
const M = (n: unknown) =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `rcStatusPill()` — hros.html:1775. `[colour, background]` per status; anything unknown falls to muted. */
const STATUS: Record<string, [string, string]> = {
  'Draft': ['#95a3ba', 'rgba(107,122,147,.18)'],
  'Submitted': ['var(--sky-soft)', 'rgba(91,155,213,.16)'],
  'Pending Manager Approval': ['var(--amber)', 'rgba(245,158,11,.16)'],
  'Pending HR Approval': ['var(--amber)', 'rgba(245,158,11,.16)'],
  'Pending Finance Approval': ['var(--amber)', 'rgba(245,158,11,.16)'],
  'Pending Director Approval': ['var(--amber)', 'rgba(245,158,11,.16)'],
  'Approved': ['var(--green-soft)', 'rgba(22,185,122,.16)'],
  'Paid': ['var(--green-soft)', 'rgba(22,185,122,.24)'],
  'Rejected': ['var(--coral-soft)', 'rgba(232,93,60,.16)'],
  'Need More Info': ['var(--sky-soft)', 'rgba(91,155,213,.18)'],
  'Cancelled': ['var(--muted)', 'rgba(107,122,147,.14)'],
};

function StatusPill({ status }: { status?: string | null }) {
  const c = STATUS[String(status ?? '')] || ['var(--muted)', 'rgba(255,255,255,.06)'];
  return <span className="pill" style={{ color: c[0], background: c[1] }}>{status}</span>;
}

const BAR: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: 'var(--panel-2)',
  border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 11px', marginBottom: '10px',
};

const ADMIN_TABS: [string, string][] = [['list', '📋 Claims'], ['form', '➕ Submit'], ['dashboard', '📊 Dashboard'], ['settings', '⚙ Settings']];
const EMP_TABS: [string, string][] = [['list', '📋 Claims'], ['form', '➕ Submit']];

const ADMIN_SCOPES: [string, string][] = [['pending', 'Pending'], ['approved', 'Approved'], ['paid', 'Paid'], ['all', 'All']];
const EMP_SCOPES: [string, string][] = [['all', 'My claims'], ['pending', '🔔 Approvals'], ['approved', 'Approved'], ['paid', 'Paid']];

/**
 * The click on a selection cell must not also open the claim — `onclick="event.stopPropagation()"` on
 * the `<td>` (hros.html:1834). `?.` because tests/handlers.ts's `reactHandlers()` invokes every handler
 * with a bare `{target:{value}}` stub; a real React SyntheticEvent always has the method.
 */
const stopRowClick = (e: { stopPropagation?: () => void }) => e.stopPropagation?.();

export default function HrExpenses(p: HrExpensesProps) {
  const isEmpMode = p.me.isAdmin === false;
  const tabs = isEmpMode ? EMP_TABS : ADMIN_TABS;

  return (
    <>
      {/* The page head is built by hrRender(), not hrRC() — hros.html:1538. Shared chrome, included
          because it is inside the `#hr` element the golden holds. */}
      <div className="page-head">
        <div>
          <div className="page-eyebrow">People</div>
          <h2 className="page-title">Reimbursement</h2>
          <div className="page-sub">Employee expense claims, receipts &amp; multi-level approval</div>
        </div>
        <div className="page-meta">
          <span className="page-chip"><span className="dot"></span>{p.companyName}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {tabs.map(([id, label]) => {
          const on = p.page === id || (id === 'list' && p.page === 'detail');
          return <button key={id} className={'btn ' + (on ? 'p ' : '') + 'sm'} onClick={() => p.onNav(id)}>{label}</button>;
        })}
      </div>
      {p.page === 'list' ? <ClaimsList {...p} /> : null}
    </>
  );
}

/** `hrRCList()` — hros.html:1813. */
function ClaimsList(p: HrExpensesProps) {
  const me = p.me;
  const list = p.claims;
  const scopes = me.isAdmin === false ? EMP_SCOPES : ADMIN_SCOPES;
  const canApprove = !!(me.isAdmin || me.is_manager || (me.roles && me.roles.length));
  const canFinance = !!(me.isAdmin || (me.roles && me.roles.indexOf('finance') >= 0));
  const selecting = (p.scope === 'pending' && canApprove) || (p.scope === 'approved' && canFinance);
  const n = Object.keys(p.sel).filter((k) => p.sel[k]).length;
  const colspan = selecting ? 7 : 6;

  return (
    <div className="panel">
      <div className="panel-hd"><h3>Claims</h3></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', gap: '5px' }}>
          {scopes.map(([id, label]) => {
            const on = p.scope === id;
            return (
              <button key={id} className={'btn xs' + (on ? ' p' : '')} onClick={() => p.onScope(id)}>
                {label}{on && id === 'pending' ? ' (' + list.length + ')' : ''}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {canFinance ? (
            <button className="btn xs" disabled={!!p.exportingAcct} onClick={p.onExportAcct} title="Approved/Paid lines with GL · tax · SST · cost center — for accounting">📒 Accounting CSV</button>
          ) : null}
          <button className="btn xs" onClick={p.onExportCsv} title="Export this list to CSV">⬇ CSV</button>
          <button className="btn p sm" onClick={() => p.onNav('form')}>➕ New claim</button>
        </div>
      </div>

      {selecting ? (
        <div style={BAR}>
          <span style={{ fontSize: '12px', fontWeight: 600 }}>
            {n ? n + ' selected' : p.scope === 'pending' ? 'Select claims to approve in bulk' : 'Select approved claims to pay'}
          </span>
          {n ? <BulkButtons {...p} n={n} /> : null}
          {n ? <>{' '}<a onClick={p.onSelClear} style={{ cursor: 'pointer', fontSize: '11px', color: 'var(--muted)' }}>clear</a></> : null}
        </div>
      ) : null}

      <div className="tbl-wrap">
        <table className="bigtable">
          <thead>
            <tr>
              {selecting ? <th style={{ width: '26px' }}><input type="checkbox" onChange={(e) => p.onSelAll(e.target.checked)} /></th> : null}
              <th>Claim #</th>
              <th>Employee</th>
              <th>Type</th>
              <th>Date</th>
              <th className="amt">Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.length ? list.map((c) => (
              <tr key={c.id} onClick={() => p.onOpen(c.id)} style={{ cursor: 'pointer' }}>
                {selecting ? (
                  <td style={{ width: '26px' }} onClick={stopRowClick}>
                    <input type="checkbox" checked={!!p.sel[c.id]} onChange={(e) => p.onSelToggle(c.id, e.target.checked)} />
                  </td>
                ) : null}
                <td>
                  <b>{c.claim_no || ''}</b>
                  {c.xero_bill_id ? <>{' '}<span title="Posted to Xero" style={{ color: 'var(--green-soft)' }}>⇢X</span></> : null}
                </td>
                <td>{(c.hr_employees && c.hr_employees.name) || '—'}</td>
                <td className="muted">{(c.hr_claim_types && c.hr_claim_types.name) || '—'}</td>
                <td className="muted">{c.claim_date || ''}</td>
                <td className="amt">{M(c.amount)}</td>
                <td><StatusPill status={c.status} /></td>
              </tr>
            )) : (
              <tr>
                <td colSpan={colspan} className="muted" style={{ textAlign: 'center', padding: '24px' }}>
                  {'No claims' + (p.scope !== 'all' ? ' — ' + p.scope : '') + ' yet'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** hros.html:1826-1828 — which bulk actions the bar offers depends on the scope, not on the role. */
function BulkButtons(p: HrExpensesProps & { n: number }) {
  return p.scope === 'pending' ? (
    <>
      <button className="btn p xs" onClick={p.onBulkApprove}>✓ Approve ({p.n})</button>{' '}
      <button className="btn xs d" onClick={p.onBulkReject}>✕ Reject</button>{' '}
      <button className="btn xs" onClick={p.onBulkInfo}>↩ Request info</button>
    </>
  ) : (
    <>
      <button className="btn p xs" onClick={p.onExportBank}>🏦 Bank file ({p.n})</button>{' '}
      <button className="btn xs" onClick={p.onBulkPay}>💵 Mark paid ({p.n})</button>
    </>
  );
}

/**
 * `hrRCSelIds()` — hros.html:1841. The selected ids, in `RC.sel` insertion order, which is the order the
 * bank file's rows come out in once the list is filtered by them.
 */
export function selectedIds(sel: Record<string, boolean>): string[] {
  return Object.keys(sel).filter((k) => sel[k]);
}

/** What `bankFile()` produces: the payment file itself, plus the two numbers the toast reports. */
export interface BankFile {
  name: string;
  text: string;
  count: number;
  total: number;
}

/**
 * `hrRCExportBank()` — hros.html:1849, moved across verbatim. The download and the toast stay in the
 * route (they are the button, not the format); `today` is handed in rather than read from the clock, so
 * the filename is testable and the component stays a pure function — same rule hr-yearend follows.
 *
 * Returns `null` where the legacy raises "Select Approved claims first" and emits nothing.
 *
 * TWO THINGS HERE ARE LOAD-BEARING AND MUST NOT BE "TIDIED":
 *
 *  1. Only `status === 'Approved'` claims are ever written, and an EMPTY selection means "all of them",
 *     not "none" — `!ids.length || ids.indexOf(c.id) >= 0`. Inverting that pays people who were not
 *     selected.
 *
 *  2. NO TOTAL TRAILER. `total` is computed and RETURNED so the toast can report it, and it is
 *     deliberately NOT appended to the rows — the v157 comment sitting on that line in the body below
 *     is the incident, kept verbatim. Every other statutory export in this repo ends with a TOTAL line
 *     (see hrExpStatutory, hros.html:4448); a bank file is a list of payments, so that line is a second
 *     payment for the whole batch. tests/hr-expenses.parity.test.tsx asserts no row of this file
 *     carries the word TOTAL.
 */
export function bankFile(claims: RcClaim[], ids: string[], today: string): BankFile | null {
  const list = claims.filter((c) => c.status === 'Approved' && (!ids.length || ids.indexOf(c.id) >= 0));
  if (!list.length) return null;
  const head = ['No', 'Payee Name', 'Bank', 'SWIFT/BIC', 'Account No', 'IC', 'Amount (RM)', 'Payment Ref', 'Email'];
  const body = list.map((c, i) => {
    const e = c.hr_employees || {};
    return [
      i + 1, e.name || '', e.bank_name || '', (e.bank_code || hrBankCode(e.bank_name)),
      e.bank_account || '', e.ic_no || '', (Number(c.amount) || 0).toFixed(2), c.claim_no || '', e.email || '',
    ];
  });
  const total = list.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  /* v157 CRITICAL: no TOTAL trailer in a BANK file — it was a payment row (Payee "TOTAL", full amount). */
  return {
    name: 'Reimbursement_Payments_' + today + '.csv',
    text: hrCsv(([head] as (string | number)[][]).concat(body)),
    count: list.length,
    total,
  };
}

/** `hrRCExportCsv()` — hros.html:1863. Same split as bankFile(): rows here, download in the route. */
export function listCsv(claims: RcClaim[], scope: string, today: string): { name: string; text: string; count: number } | null {
  if (!claims.length) return null;
  const head = ['Claim No', 'Employee', 'Type', 'Date', 'Amount (RM)', 'Status', 'Department', 'Project', 'In Xero'];
  const body = claims.map((c) => {
    const e = c.hr_employees || {};
    const t = c.hr_claim_types || {};
    const x = c as RcClaim & { department?: string; project?: string };
    return [
      c.claim_no || '', e.name || '', t.name || '', c.claim_date || '', (Number(c.amount) || 0).toFixed(2),
      c.status || '', x.department || '', x.project || '', c.xero_bill_id ? 'Yes' : '',
    ];
  });
  return {
    name: 'Reimbursements_' + scope + '_' + today + '.csv',
    text: hrCsv(([head] as (string | number)[][]).concat(body)),
    count: claims.length,
  };
}

/** One row of `hr_rc_export_accounting` — hr.ts:2304 builds exactly these keys, one per expense LINE. */
export interface RcAcctRow {
  claim_no?: string; claim_month?: string; status?: string; emp_no?: string; employee?: string; department?: string;
  item_date?: string; expense_type?: string; vendor_name?: string; description?: string; receipt_no?: string;
  invoice_no?: string; gl_account?: string; cost_center?: string; project?: string;
  amount?: number; tax_amount?: number; sst_amount?: number;
  payment_date?: string; payment_method?: string; payment_reference?: string; xero_ref?: string;
  bank?: string; bank_account?: string;
}

/**
 * `hrRCExportAcct()` — hros.html:1856, moved across verbatim minus the prompt, the fetch, the download
 * and the toast (those are the button; they live in the route). `month` is the operator's own string,
 * already trimmed, `''` meaning ALL.
 *
 * THIS FILE GOES INTO THE BOOKS, so it is held byte-for-byte against the legacy rather than
 * "equivalently": `web/tests/hr-expenses-admin.test.tsx` EXTRACTS `hrRCExportAcct` out of hros.html at
 * run time, runs both against the same rows and diffs the two CSV strings. Three things that diff would
 * catch and a shape assertion would not:
 *
 *  1. THE TRAILER IS DELIBERATE, and it is the opposite call to `bankFile()`'s. A bank file is a list of
 *     PAYMENTS, so a TOTAL row there is a payment for the whole batch (the v157 incident). This is an
 *     accounting report an operator reconciles, the legacy ends it with a total, and whatever consumes
 *     it downstream is expecting that line. `'TOTAL'` sits in the PROJECT column (index 14) with the
 *     figure beside it in `Amount (RM)`; the row is padded to the full 24 columns.
 *  2. THE TOTAL IS THE SUM OF THE RAW AMOUNTS, rounded ONCE at the end — not the sum of the printed
 *     `.toFixed(2)` cells. The two can differ by a sen where a stored amount carries more than two
 *     decimals. They do not here (`hr_rc_save` rounds each line at the store, which is this repo's
 *     rule), so the legacy's arithmetic is mirrored exactly rather than "corrected" — changing a filed
 *     figure is a decision, not a migration detail.
 *  3. EVERY OTHER CELL IS PASSED THROUGH RAW, as the legacy passes it: `hrCsv()` only stringifies a
 *     cell it has to quote, so coercing a value here (`x.vendor_name || ''`) would change bytes for
 *     any row the server sent without that key.
 */
export function accountingCsv(rows: RcAcctRow[], month: string, today: string): { name: string; text: string; total: number } {
  const head = ['Claim No', 'Month', 'Status', 'Emp No', 'Employee', 'Department', 'Item Date', 'Expense Type', 'Vendor', 'Description', 'Receipt No', 'Invoice No', 'GL Account', 'Cost Center', 'Project', 'Amount (RM)', 'Tax (RM)', 'SST (RM)', 'Payment Date', 'Payment Method', 'Payment Ref', 'Xero Ref', 'Bank', 'Bank Account'];
  // `as` and not `|| ''`: the cells are passed through EXACTLY as the legacy passes them (see 3 above),
  // so the cast is about the type only — the runtime value, undefined included, is untouched.
  const body = rows.map((x) => [
    x.claim_no, x.claim_month, x.status, x.emp_no, x.employee, x.department, x.item_date, x.expense_type,
    x.vendor_name, x.description, x.receipt_no, x.invoice_no, x.gl_account, x.cost_center, x.project,
    (Number(x.amount) || 0).toFixed(2), (Number(x.tax_amount) || 0).toFixed(2), (Number(x.sst_amount) || 0).toFixed(2),
    x.payment_date, x.payment_method, x.payment_reference, x.xero_ref, x.bank, x.bank_account,
  ] as unknown as (string | number)[]);
  const total = rows.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  body.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', 'TOTAL', total.toFixed(2), '', '', '', '', '', '', '', '']);
  return {
    name: 'Reimbursement_Accounting_' + (month || 'ALL') + '_' + today + '.csv',
    text: hrCsv(([head] as (string | number)[][]).concat(body)),
    total,
  };
}
