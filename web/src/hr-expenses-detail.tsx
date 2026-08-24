// HR OS · Reimbursement — a claim's DETAIL, migrated.
//
// The legacy original is `hrRCDetail()` at hros.html:2513, the third of the five bodies `hrRC()`
// dispatches over. It is STILL THERE and still shipping. `tests/golden/hr.expenses.detail.html` is the
// 43rd surface: same reasoning as the form — `RC.page` puts a whole other screen behind one nav id, and
// the list's golden cannot see it.
//
// PURE FUNCTION OF ITS PROPS — no fetch, no window, no clock of its own. `hrDT()` is imported from
// src/hr-profile.tsx rather than copied: it is already the second copy in this repo and a third would
// be a third thing to keep in step (and a third entry in web/tests/timezone-audit.test.tsx).
//
// ── What this screen is allowed to DO, and what it deliberately hands off ───────────────────────────
// v225 migrates the EMPLOYEE half of Reimbursement. `hrRCDetail()` is one renderer whose panels are
// gated by flags the SERVER computes (`d.can_finance`, `d.can_post`, and the status), so the panels are
// mirrored in full — leaving one out would turn a refusal into "this claim has no lines". Two controls
// inside it belong to the admin half and are explicitly out of scope for v225: the per-line GL `edit`
// link and 📤 Post to Xero. Both are rendered exactly as the legacy renders them and both hand off to
// `hros.html#tab=expenses`, which is what a strangler edge is; `onGlEdit` / `onPostXero` are the seam.
// Neither appears in the golden — the fixture claim is `can_finance:false`, `can_post:false` — so the
// screen's own test pins both branches by assertion.
//
// ── A legacy gap, mirrored not fixed ────────────────────────────────────────────────────────────────
// `pending` (hros.html:2516) is derived from the STATUS alone, so the "Approver actions" panel — Approve
// / Reject / Request info / Override — renders for the claim's OWNER looking at their own Submitted
// claim. `hr_rc_decide` (hr.ts:2261) refuses them, so this is a button that errors on click rather than
// a hole; `hrClaims()` not wrapping its decisions in `hrRW()` is the same class of finding. Changing it
// is a behaviour change, not a migration detail, so it is mirrored and pinned.

import type { CSSProperties } from 'react';

import { hrDT } from './hr-profile';
import { st } from './hr-expenses-form';

/** `M()` — hros.html:1268. */
const M = (n: unknown) =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `esc()` — hros.html's own. Only `voucherHtml()` needs it; JSX escapes on its own. */
const esc = (x: unknown) =>
  (x == null ? '' : String(x)).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** `RC_SEL` — hros.html:1782. */
const RC_SEL = 'width:100%;padding:8px 10px;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px';

/** `rcStatusPill()` — hros.html:1781. The same table `src/hr-expenses.tsx` holds for the list. */
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

/** hros.html:2516 — the five statuses that mean "somebody still has to act". */
export const PENDING_STATUSES = ['Pending Manager Approval', 'Pending HR Approval', 'Pending Finance Approval', 'Pending Director Approval', 'Submitted'];
export const isPending = (status?: string | null) => PENDING_STATUSES.indexOf(String(status ?? '')) >= 0;

/** hros.html:2521 — when Finance may re-code a line's GL account. */
export const canEditGl = (d: RcDetail) =>
  !!d.can_finance && !d.claim.xero_bill_id && ['Approved', 'Paid', 'Pending Finance Approval', 'Pending Director Approval'].indexOf(String(d.claim.status ?? '')) >= 0;

// ── The shapes `hr_rc_get` (hr.ts:2563) returns ────────────────────────────────────────────────────

export interface RcDetailEmployee {
  emp_no?: string | null; name?: string | null; dept?: string | null; position?: string | null;
  bank_name?: string | null; bank_account?: string | null; ic_no?: string | null;
  email?: string | null; phone?: string | null; address?: string | null; tax_no?: string | null;
}
export interface RcDetailClaim {
  id: string;
  claim_no?: string | null;
  claim_date?: string | null;
  claim_month?: string | null;
  cost_center?: string | null;
  department?: string | null;
  project?: string | null;
  description?: string | null;
  status?: string | null;
  amount?: number | string | null;
  employee_id?: string | null;
  current_step?: number | null;
  warnings?: string[] | null;
  override_amount?: number | string | null;
  override_reason?: string | null;
  submitted_at?: string | null;
  xero_bill_id?: string | null;
  xero_reference?: string | null;
  xero_posted_at?: string | null;
  hr_employees?: RcDetailEmployee | null;
  hr_claim_types?: { name?: string | null; is_mileage?: boolean } | null;
}
export interface RcDetailItem {
  id: string;
  item_date?: string | null;
  description?: string | null;
  amount?: number | string | null;
  vendor_name?: string | null;
  receipt_no?: string | null;
  invoice_no?: string | null;
  gl_account?: string | null;
  cost_center?: string | null;
  remarks?: string | null;
  total_km?: number | string | null;
  mileage_rate?: number | string | null;
  parking_amount?: number | string | null;
  toll_amount?: number | string | null;
  start_location?: string | null;
  end_location?: string | null;
  is_einvoice?: boolean;
  supplier_tin?: string | null;
  einvoice_uuid?: string | null;
  tax_amount?: number | string | null;
  sst_amount?: number | string | null;
  hr_claim_types?: { name?: string | null; is_mileage?: boolean; gl_account?: string | null } | null;
}
export interface RcStep {
  step_order: number;
  name?: string | null;
  approver_role?: string | null;
  assignee_name?: string | null;
  status?: string | null;
  decision?: string | null;
  comment?: string | null;
  acted_by_name?: string | null;
  acted_by_name_sig?: string | null;
  acted_at?: string | null;
}
export interface RcAttachment { id?: string; file_name?: string | null; url?: string | null }
export interface RcComment { author_name?: string | null; created_at?: string | null; comment?: string | null }
export interface RcPayment { paid_date?: string | null; payment_method?: string | null; payment_reference?: string | null }
export interface RcBuyer {
  complete?: boolean; name?: string | null; tin?: string | null; tin_effective?: string | null;
  ic?: string | null; address?: string | null; email?: string | null; phone?: string | null;
}
export interface RcDeclarationRow {
  business_purpose?: boolean; not_claimed_before?: boolean; receipts_valid?: boolean;
  understand_disciplinary?: boolean; declared_at?: string | null;
}
export interface RcMileageDetail {
  start_location?: string | null; end_location?: string | null;
  total_km?: number | string | null; mileage_rate?: number | string | null; calculated_amount?: number | string | null;
}

/** The whole `hr_rc_get` response — `RC.detail`. */
export interface RcDetail {
  claim: RcDetailClaim;
  items?: RcDetailItem[];
  mileage?: RcMileageDetail | null;
  steps?: RcStep[];
  attachments?: RcAttachment[];
  comments?: RcComment[];
  payment?: RcPayment | null;
  buyer?: RcBuyer;
  declaration?: RcDeclarationRow | null;
  can_finance?: boolean;
  can_post?: boolean;
  employer?: { name?: string | null; logo?: string | null; reg_no?: string | null; employer_no?: string | null; address?: string | null; phone?: string | null; email?: string | null } | null;
  signer_sig?: string | null;
}

export interface HrExpensesDetailProps {
  detail: RcDetail;
  /** `RC.me.isAdmin` — the one thing on this screen that is NOT a server flag (hros.html:2565). */
  isAdmin: boolean;
  /** `HR_VIEWER` — `hrRW()`, hros.html:1380. A viewer sees no ✏️ Adjust amount. */
  isViewer: boolean;
  /** The two irreversible-ish writes disable their own button while in flight — PRs 108/109's pattern. */
  busy: string | null;

  onBack: () => void;
  onDecide: (decision: 'approve' | 'reject' | 'request_info') => void;
  onOverride: () => void;
  onMarkPaid: () => void;
  onGlEdit: (itemId: string | null) => void;
  onPostXero: () => void;
  onFormAndReceipts: () => void;
  onVoucher: () => void;
  onEdit: () => void;
  onResubmit: () => void;
  onAdjustAmount: () => void;
  onCancel: () => void;
}

export default function HrExpensesDetail(p: HrExpensesDetailProps) {
  const d = p.detail;
  const c = d.claim;
  const emp = c.hr_employees;
  const typ = c.hr_claim_types;
  const pending = isPending(c.status);
  const canGl = canEditGl(d);
  const items = d.items || [];

  return (
    <>
      {/* head — hros.html:2517 */}
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 750 }}>{c.claim_no}{' '}<StatusPill status={c.status} /></div>
            <div className="muted" style={{ fontSize: '12.5px', marginTop: '4px' }}>
              {((emp && emp.name) || '—') + ' · ' + ((typ && typ.name) || '—') + ' · ' + (c.claim_date || '')
                + (c.claim_month ? ' | month ' + c.claim_month : '')
                + (c.cost_center ? ' | CC ' + c.cost_center : '')
                + ((emp && emp.bank_name) ? ' | ' + emp.bank_name + ' ' + (emp.bank_account || '') : '')}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '24px', fontWeight: 750, color: 'var(--green-soft)' }}>{M(c.amount)}</div>
            {c.override_amount != null
              ? <div className="muted" style={{ fontSize: '10.5px' }}>{'overridden: ' + (c.override_reason || '')}</div>
              : null}
          </div>
        </div>
        <div style={{ marginTop: '9px', fontSize: '13px' }}>
          {c.description || ''}
          {c.department ? <>{' · '}<span className="muted">{c.department}</span></> : null}
          {c.project ? <>{' · '}<span className="muted">{c.project}</span></> : null}
        </div>
        <button className="btn sm" onClick={p.onBack} style={{ marginTop: '10px' }}>← Back to claims</button>
      </div>

      {/* warnings — hros.html:2518 */}
      {(c.warnings && c.warnings.length) ? (
        <div className="panel" style={{ borderColor: 'rgba(245,158,11,.4)' }}>
          <div style={{ fontWeight: 700, color: 'var(--amber)', fontSize: '13px', marginBottom: '6px' }}>⚠ Validation warnings</div>
          {c.warnings.map((w, i) => <div key={i} style={{ fontSize: '12.5px', color: 'var(--text-soft)' }}>{'• ' + w}</div>)}
        </div>
      ) : null}

      <BuyerPanel buyer={d.buyer || {}} />

      {items.length
        ? <ItemsPanel items={items} claim={c} canGl={canGl} onGlEdit={p.onGlEdit} />
        : d.mileage ? <MileagePanel m={d.mileage} /> : null}

      <DeclarationPanel dec={d.declaration} />

      {/* timeline — hros.html:2534 */}
      <div className="panel">
        <div className="panel-hd"><h3>Approval timeline</h3></div>
        {(d.steps && d.steps.length)
          ? d.steps.map((s) => <Step key={s.step_order} s={s} current={c.current_step === s.step_order && pending} />)
          : <div className="muted" style={{ fontSize: '12px', padding: '6px 0' }}>Not yet submitted</div>}
      </div>

      {/* receipts — hros.html:2543 */}
      {(d.attachments && d.attachments.length) ? (
        <div className="panel">
          <div className="panel-hd"><h3>{'Receipts (' + d.attachments.length + ')'}</h3></div>
          {d.attachments.map((a, i) => (
            <div key={i} style={{ fontSize: '12.5px', padding: '4px 0' }}>
              {'📎 '}
              {/* No `rel` — hros.html:2543 writes none, and this is a byte-for-byte port. Adding
                  `noopener noreferrer` would be an improvement that makes the two renderers disagree;
                  `finance.bankfeed` pins the opposite because ITS legacy anchor carries them. */}
              {a.url ? <a href={a.url} target="_blank" style={{ color: 'var(--sky-soft)' }}>{a.file_name}</a> : a.file_name}
            </div>
          ))}
        </div>
      ) : null}

      {/* comments — hros.html:2544 */}
      {(d.comments && d.comments.length) ? (
        <div className="panel">
          <div className="panel-hd"><h3>Comments</h3></div>
          {d.comments.map((x, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: '12.5px' }}>
              <b>{x.author_name || '—'}</b>{' '}
              <span className="muted" style={{ fontSize: '10.5px' }}>{String(x.created_at).slice(0, 16).replace('T', ' ')}</span>
              <div style={{ marginTop: '2px' }}>{x.comment}</div>
            </div>
          ))}
        </div>
      ) : null}

      <Actions p={p} pending={pending} />
      <XeroBlock p={p} />
      <EditRow p={p} />
    </>
  );
}

/** 🧾 e-Invoice buyer — hros.html:2520. */
function BuyerPanel({ buyer: by }: { buyer: RcBuyer }) {
  return (
    <div className="panel">
      <div className="panel-hd"><h3>🧾 e-Invoice buyer <span className="muted" style={{ fontWeight: 400, fontSize: '11px' }}>· the claimer, pulled from HR OS</span></h3></div>
      {by.complete ? null : (
        <div style={{ background: 'rgba(242,180,92,.1)', border: '1px solid rgba(242,180,92,.35)', borderRadius: '8px', padding: '8px 10px', fontSize: '12px', color: 'var(--amber)', marginBottom: '8px' }}>
          ⚠ Missing IC — update this employee’s HR OS profile so the e-invoice buyer is complete.
        </div>
      )}
      <div style={{ fontSize: '13px' }}>
        <b>{by.name || '—'}</b>{' · TIN '}
        {by.tin
          ? by.tin
          : <span title="employee has no personal TIN — IRBM general public TIN used">{(by.tin_effective || '')}{' '}<span className="muted">(general)</span></span>}
        {' · IC '}
        {by.ic ? by.ic : <span style={{ color: 'var(--amber)' }}>—</span>}
      </div>
      {by.address ? <div className="muted" style={{ fontSize: '11.5px', marginTop: '2px' }}>{by.address}</div> : null}
      {(by.email || by.phone)
        ? <div className="muted" style={{ fontSize: '11px', marginTop: '1px' }}>{(by.email || '') + (by.phone ? ' · ' + by.phone : '')}</div>
        : null}
    </div>
  );
}

/**
 * Expense lines — hros.html:2523-2532.
 *
 * The footer row is `M(c.amount)`, the HEADER amount the server stored — not a re-sum of the rows.
 * `hr_rc_save` (hr.ts:2019) and `hr_rc_submit` (hr.ts:2180) both recompute and store it, so re-deriving
 * it here would print a figure that can disagree with the one the bank file pays. CLAUDE.md's rule:
 * round where it is STORED.
 */
function ItemsPanel({ items, claim: c, canGl, onGlEdit }: {
  items: RcDetailItem[]; claim: RcDetailClaim; canGl: boolean; onGlEdit: (id: string | null) => void;
}) {
  return (
    <div className="panel">
      <div className="panel-hd">
        <h3>{'Expense lines (' + items.length + ')'}</h3>
        {canGl ? <button className="btn xs" onClick={() => onGlEdit(null)}>✎ Change GL (all lines)</button> : null}
      </div>
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead>
            <tr><th>Type</th><th>Date</th><th>Description</th><th>Vendor</th><th>Receipt/Inv #</th><th>GL</th><th>CC</th><th className="amt">Amount</th></tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const t = it.hr_claim_types || {};
              const gl = it.gl_account || t.gl_account || '';
              const tax = (Number(it.tax_amount) || 0) + (Number(it.sst_amount) || 0);
              const extra = t.is_mileage
                ? ' · ' + it.total_km + 'km × RM' + it.mileage_rate
                  + ((Number(it.parking_amount) || 0) ? ' + park ' + M(it.parking_amount) : '')
                  + ((Number(it.toll_amount) || 0) ? ' + toll ' + M(it.toll_amount) : '')
                  + (it.start_location ? ' · ' + it.start_location + '→' + (it.end_location || '') : '')
                : '';
              return (
                <tr key={it.id}>
                  <td>{t.name || '—'}</td>
                  <td className="muted">{String(it.item_date || '').slice(0, 10)}</td>
                  <td className="muted">
                    {(it.description || '') + extra}
                    {it.is_einvoice ? (
                      <div style={{ fontSize: '10.5px', color: 'var(--green-soft)' }}>
                        {'🧾 e-Invoice' + (it.supplier_tin ? ' · TIN ' + it.supplier_tin : '')
                          + (it.einvoice_uuid ? ' · ' + String(it.einvoice_uuid).slice(0, 20) + '…' : '')}
                      </div>
                    ) : null}
                    {it.remarks ? <div className="muted" style={{ fontSize: '10.5px' }}>{it.remarks}</div> : null}
                  </td>
                  <td className="muted">{it.vendor_name || '—'}</td>
                  <td className="muted">{it.receipt_no || it.invoice_no || '—'}</td>
                  <td>
                    {gl ? gl : <span style={{ color: 'var(--amber)' }}>—</span>}
                    {it.gl_account ? <>{' '}<span className="muted" title="changed by Finance" style={{ fontSize: '10px' }}>✎</span></> : null}
                    {canGl ? <>{' '}<a onClick={() => onGlEdit(it.id)} title="change GL (reason required)" style={{ cursor: 'pointer', fontSize: '11px', color: 'var(--sky-soft)' }}>edit</a></> : null}
                  </td>
                  <td className="muted">{it.cost_center || c.cost_center || '—'}</td>
                  <td className="amt">
                    {M(it.amount)}
                    {tax ? <div className="muted" style={{ fontSize: '10px' }}>{'incl tax ' + M(tax)}</div> : null}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={7} style={{ textAlign: 'right', fontWeight: 700 }}>Total</td>
              <td className="amt" style={{ fontWeight: 750, color: 'var(--green-soft)' }}>{M(c.amount)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The pre-items shape — hros.html:2533. A claim saved before expense lines existed. */
function MileagePanel({ m }: { m: RcMileageDetail }) {
  return (
    <div className="panel">
      <div className="panel-hd"><h3>🚗 Mileage</h3></div>
      <div style={{ fontSize: '13px' }}>
        {(m.start_location || '') + ' → ' + (m.end_location || '') + ' · ' + m.total_km + ' km × RM' + m.mileage_rate + ' = '}
        <b>{M(m.calculated_amount)}</b>
      </div>
    </div>
  );
}

/** hros.html:2560. */
function DeclarationPanel({ dec }: { dec?: RcDeclarationRow | null }) {
  if (!dec) return null;
  const rows: [keyof RcDeclarationRow, string][] = [
    ['business_purpose', 'Claim is for business purpose'],
    ['not_claimed_before', 'Not claimed before'],
    ['receipts_valid', 'Receipts / invoices are valid'],
    ['understand_disciplinary', 'Understands false claims → disciplinary action'],
  ];
  return (
    <div className="panel">
      <div className="panel-hd"><h3>Declaration</h3></div>
      {rows.map(([k, label]) => (
        <div key={k} style={{ fontSize: '12px', padding: '2px 0', color: dec[k] ? 'var(--green-soft)' : 'var(--coral-soft)' }}>
          {(dec[k] ? '✓' : '✗') + ' '}<span style={{ color: 'var(--text-soft)' }}>{label}</span>
        </div>
      ))}
      <div className="muted" style={{ fontSize: '10.5px', marginTop: '4px' }}>
        {'Declared ' + String(dec.declared_at || '').slice(0, 16).replace('T', ' ')}
      </div>
    </div>
  );
}

/** One approval step — hros.html:2535-2542. */
function Step({ s, current }: { s: RcStep; current: boolean }) {
  const col = s.status === 'Approved' ? 'var(--green-soft)'
    : s.status === 'Rejected' ? 'var(--coral-soft)'
    : s.status === 'Info Requested' ? 'var(--sky-soft)'
    : s.status === 'Pending' ? 'var(--amber)' : 'var(--muted)';
  return (
    <div style={{ display: 'flex', gap: '10px', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: col + '22', color: col, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>{s.step_order}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '13px', fontWeight: 600 }}>
          {s.name || s.approver_role}{' '}
          <span style={{ fontWeight: 400, color: col, fontSize: '11.5px' }}>{'· ' + s.status + (current ? ' ← now' : '')}</span>
        </div>
        <StepWho s={s} />
        {s.comment ? <div className="muted" style={{ fontSize: '11.5px', marginTop: '2px' }}>{'“' + s.comment + '”'}</div> : null}
      </div>
    </div>
  );
}

/**
 * hros.html:2536-2541. Never claim "any admin" for a step assigned to a ROLE nobody holds — the backend
 * refuses every admin and the old label made that look like a broken button.
 */
function StepWho({ s }: { s: RcStep }) {
  if (s.acted_at || s.acted_by_name) {
    const verb = s.decision === 'approve' ? '✓ Approved' : s.decision === 'reject' ? '✕ Rejected' : (s.status === 'Info Requested' ? 'ℹ Info requested' : 'Acted');
    const c2 = s.decision === 'approve' ? 'var(--green-soft)' : s.decision === 'reject' ? 'var(--coral-soft)' : 'var(--muted)';
    return (
      <div style={{ fontSize: '11px', marginTop: '2px', color: c2 }}>
        <b>{verb}</b>{(s.acted_by_name ? ' by ' + s.acted_by_name : '') + (s.acted_at ? ' · ' + hrDT(s.acted_at) : '')}
      </div>
    );
  }
  if (s.assignee_name) return <div className="muted" style={{ fontSize: '11px', marginTop: '2px' }}>{'👤 Approver: ' + s.assignee_name}</div>;
  if (s.approver_role) {
    return (
      <div style={{ fontSize: '11px', marginTop: '2px', color: 'var(--amber)' }}>
        {'⚠ Approver role “' + s.approver_role + '” has nobody assigned — assign someone in Claim settings, or an admin can approve to unblock it.'}
      </div>
    );
  }
  return <div className="muted" style={{ fontSize: '11px', marginTop: '2px' }}>👤 Approver: any admin</div>;
}

/** hros.html:2545-2548 — one of three panels, or none. */
function Actions({ p, pending }: { p: HrExpensesDetailProps; pending: boolean }) {
  const d = p.detail, c = d.claim;
  if (pending) {
    return (
      <div className="panel">
        <div className="panel-hd"><h3>Approver actions</h3></div>
        <textarea id="rc_com" placeholder="Comment / reason / message…" style={{ width: '100%', minHeight: '52px', padding: '8px 10px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '12.5px' }}></textarea>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
          <button className="btn p sm" disabled={p.busy === 'decide'} onClick={() => p.onDecide('approve')}>✓ Approve</button>
          <button className="btn sm d" disabled={p.busy === 'decide'} onClick={() => p.onDecide('reject')}>✕ Reject</button>
          <button className="btn sm" disabled={p.busy === 'decide'} onClick={() => p.onDecide('request_info')}>↩ Request info</button>
          <button className="btn xs" disabled={p.busy === 'decide'} onClick={p.onOverride}>Override amount</button>
        </div>
      </div>
    );
  }
  if (c.status === 'Approved') {
    return (
      <div className="panel">
        <div className="panel-hd"><h3>💵 Finance — mark as paid</h3></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '8px' }}>
          <div><label className="muted" style={{ fontSize: '11px' }}>Method</label><input id="rc_pm" placeholder="Bank Transfer" style={st(RC_SEL)} /></div>
          <div><label className="muted" style={{ fontSize: '11px' }}>Reference</label><input id="rc_pr" placeholder="TT / cheque ref" style={st(RC_SEL)} /></div>
        </div>
        <button className="btn p sm" disabled={p.busy === 'paid'} onClick={p.onMarkPaid}>Mark as Paid</button>
      </div>
    );
  }
  if (c.status === 'Paid' && d.payment) {
    const pay = d.payment;
    return (
      <div className="panel">
        <div style={{ fontSize: '13px', color: 'var(--green-soft)' }}>
          {'✓ Paid ' + (pay.paid_date || '') + (pay.payment_method ? ' · ' + pay.payment_method : '') + (pay.payment_reference ? ' · ' + pay.payment_reference : '')}
        </div>
      </div>
    );
  }
  return null;
}

/** hros.html:2549-2559. Out of v225's scope: `onPostXero` is the strangler edge back to hros.html. */
function XeroBlock({ p }: { p: HrExpensesDetailProps }) {
  const d = p.detail, c = d.claim;
  if (c.xero_bill_id) {
    return (
      <div className="panel">
        <div style={{ fontSize: '13px', color: 'var(--green-soft)', fontWeight: 650 }}>✓ Posted to Xero</div>
        <div className="muted" style={{ fontSize: '11.5px', marginTop: '3px' }}>
          {'ACCPAY bill · SUBMITTED (awaiting your payment approval in Xero) · ref ' + (c.xero_reference || c.claim_no || '')
            + (c.xero_posted_at ? ' · ' + String(c.xero_posted_at).slice(0, 16).replace('T', ' ') : '')}
        </div>
        {d.can_post ? <button className="btn xs" style={{ marginTop: '8px' }} onClick={p.onPostXero}>Re-sync reference</button> : null}
      </div>
    );
  }
  if (!d.can_post) return null;
  return (
    <div className="panel">
      <div className="panel-hd"><h3>📤 Post to Xero</h3></div>
      <div className="muted" style={{ fontSize: '12px', marginBottom: '8px' }}>
        Creates an ACCPAY bill (<b>SUBMITTED</b> — you still approve the payment inside Xero). Each line is coded to its claim type’s GL account, with receipts attached.
      </div>
      <button className="btn p sm" onClick={p.onPostXero}>Post to Xero →</button>
    </div>
  );
}

/** hros.html:2561-2567 — the row of document / lifecycle buttons under everything else. */
function EditRow({ p }: { p: HrExpensesDetailProps }) {
  const c = p.detail.claim;
  const status = String(c.status ?? '');
  const editable = ['Draft', 'Need More Info'].indexOf(status) >= 0;
  const live = ['Paid', 'Cancelled', 'Rejected'].indexOf(status) < 0;
  return (
    <div style={{ marginTop: '4px' }}>
      <button className="btn xs" disabled={p.busy === 'pdf'} onClick={p.onFormAndReceipts}>📄 Form + receipts (PDF)</button>{' '}
      <button className="btn xs" onClick={p.onVoucher}>🖨 Voucher</button>{' '}
      {editable ? (
        <>
          <button className="btn sm" onClick={p.onEdit}>Edit</button>{' '}
          <button className="btn p sm" disabled={p.busy === 'resubmit'} onClick={p.onResubmit}>{status === 'Need More Info' ? 'Resubmit →' : 'Submit →'}</button>{' '}
        </>
      ) : null}
      {/* v193 — hros.html:2565. Admin only, blocked once Paid or already a bill in Xero, and `hrRW()`
          hides it from a viewer. */}
      {(p.isAdmin && live && !c.xero_bill_id && !p.isViewer) ? (
        <>
          <button className="btn xs" disabled={p.busy === 'adjust'} onClick={p.onAdjustAmount} title="Correct the payable amount on this claim. A reason is required and is written to the audit trail.">✏️ Adjust amount</button>{' '}
        </>
      ) : null}
      {live ? <button className="btn xs d" disabled={p.busy === 'cancel'} onClick={p.onCancel}>Cancel claim</button> : null}
    </div>
  );
}

// ── The voucher — a DOCUMENT that leaves the building ──────────────────────────────────────────────

/**
 * `hrRCVoucher()` — hros.html:1870, minus the `window.open` / `print()`, which stay in the route.
 * `sbiInvoiceHTML()`'s treatment: the string is pure so the payment block, the TOTAL and the three
 * signature columns can be pinned by assertion (no golden sees a printed document).
 *
 * The TOTAL row here IS correct and IS the legacy's: a voucher is one payment, and the trailer is its
 * total — the opposite of the BANK FILE, where a TOTAL row is a second payment (v157) and of CP8D,
 * where it is one more employee (v222). Both of those are asserted absent elsewhere; this one is
 * asserted PRESENT, and it is `Number(c.amount)`, the stored header figure, never a re-sum of the rows.
 */
export function voucherHtml(d: RcDetail, tenantName: string): string {
  const c = d.claim;
  const emp = c.hr_employees || {};
  const items = d.items || [];
  const pay = d.payment || {};
  const rows = items.length
    ? items.map((it) => {
      const t = it.hr_claim_types || {};
      return '<tr><td>' + esc(t.name || '') + '</td><td>' + esc(String(it.item_date || '').slice(0, 10)) + '</td><td>'
        + esc(it.description || '') + '</td><td style="text-align:right">' + (Number(it.amount) || 0).toFixed(2) + '</td></tr>';
    }).join('')
    : '<tr><td colspan="3">' + esc(c.description || '') + '</td><td style="text-align:right">' + (Number(c.amount) || 0).toFixed(2) + '</td></tr>';

  return '<html><head><title>Voucher ' + esc(c.claim_no || '') + '</title><style>body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:32px;max-width:720px;margin:auto}h1{font-size:19px;margin:0 0 2px}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #ccc;padding:7px 9px;font-size:12.5px;text-align:left}th{background:#f3f4f6}.tot td{font-weight:bold}.muted{color:#666;font-size:12px}.sig{margin-top:54px;display:flex;justify-content:space-between}.sig div{width:30%;border-top:1px solid #333;padding-top:6px;font-size:11.5px;text-align:center}</style></head><body>'
    + '<h1>Reimbursement Payment Voucher</h1><div class="muted">' + esc(tenantName) + '</div>'
    + '<table><tr><td>Voucher No</td><td><b>' + esc(c.claim_no || '') + '</b></td><td>Date</td><td>' + esc(c.claim_date || '') + '</td></tr>'
    + '<tr><td>Employee</td><td>' + esc(emp.name || '') + ' (' + esc(emp.emp_no || '') + ')</td><td>Department</td><td>' + esc(emp.dept || '') + '</td></tr>'
    + '<tr><td>Status</td><td>' + esc(c.status || '') + '</td><td>Bank</td><td>' + esc(emp.bank_name || '') + ' ' + esc(emp.bank_account || '') + '</td></tr></table>'
    + '<table><thead><tr><th>Type</th><th>Date</th><th>Description</th><th style="text-align:right">Amount (RM)</th></tr></thead><tbody>' + rows
    + '<tr class="tot"><td colspan="3" style="text-align:right">TOTAL</td><td style="text-align:right">' + (Number(c.amount) || 0).toFixed(2) + '</td></tr></tbody></table>'
    + ((pay && pay.paid_date) ? '<div class="muted">Paid on ' + esc(pay.paid_date) + ' · ' + esc(pay.payment_method || '') + (pay.payment_reference ? ' · ref ' + esc(pay.payment_reference) : '') + '</div>' : '')
    + (c.xero_bill_id ? '<div class="muted">Posted to Xero · ref ' + esc(c.xero_reference || c.claim_no || '') + '</div>' : '')
    + '<div class="sig"><div>Prepared by</div><div>Approved by</div><div>Received by</div></div>'
    + '</body></html>';
}

/**
 * `hrRCEdit()` — hros.html:2598. The detail response turned back into a form. Pure, because getting it
 * wrong loses a vendor name or an e-invoice UUID off a claim that is being corrected, and no golden
 * sees a form's INITIAL state either.
 */
export function editForm(d: RcDetail): {
  id: string; employee_id?: string; claim_date: string; claim_month: string; cost_center: string;
  department?: string; project?: string; remarks?: string; description?: string;
  items: Record<string, unknown>[]; _existingAtts: RcAttachment[];
} {
  const c = d.claim;
  let items: Record<string, unknown>[] = (d.items || []).map((it) => ({
    claim_type_id: (it as RcDetailItem & { claim_type_id?: string }).claim_type_id,
    item_date: it.item_date ? String(it.item_date).slice(0, 10) : '',
    description: it.description, amount: it.amount, total_km: it.total_km, mileage_rate: it.mileage_rate,
    vendor_name: it.vendor_name, receipt_no: it.receipt_no, invoice_no: it.invoice_no,
    tax_amount: it.tax_amount, sst_amount: it.sst_amount, gl_account: it.gl_account,
    cost_center: it.cost_center, project: (it as RcDetailItem & { project?: string }).project, remarks: it.remarks,
    is_einvoice: it.is_einvoice, supplier_tin: it.supplier_tin, einvoice_uuid: it.einvoice_uuid,
    einvoice_validation_url: (it as RcDetailItem & { einvoice_validation_url?: string }).einvoice_validation_url,
    start_location: it.start_location, end_location: it.end_location,
    purpose: (it as RcDetailItem & { purpose?: string }).purpose,
    parking_amount: it.parking_amount, toll_amount: it.toll_amount,
  }));
  if (!items.length) {
    items = [{
      claim_type_id: (c as RcDetailClaim & { claim_type_id?: string }).claim_type_id || '',
      item_date: c.claim_date ? String(c.claim_date).slice(0, 10) : '',
      description: c.description, amount: c.amount,
      total_km: (d.mileage && d.mileage.total_km) || '', mileage_rate: (d.mileage && d.mileage.mileage_rate) || '',
    }];
  }
  return {
    id: c.id,
    employee_id: c.employee_id || undefined,
    claim_date: c.claim_date ? String(c.claim_date).slice(0, 10) : '',
    claim_month: c.claim_month || '',
    cost_center: c.cost_center || '',
    department: c.department ?? undefined,
    project: c.project ?? undefined,
    remarks: (c as RcDetailClaim & { remarks?: string }).remarks,
    description: c.description ?? undefined,
    items,
    _existingAtts: d.attachments || [],
  };
}

/**
 * `hrRCAdjustAmount()` — hros.html:2581. THE WHOLE OF IT except the two prompts and the POST, because
 * every line of it is a guard on a figure somebody already approved.
 *
 * `isFinite`, not `isNaN` — CLAUDE.md: `isNaN(Infinity)` is false and `Number('1e400')||0` is Infinity,
 * which is how a spreadsheet cell walked into a ledger once. And the same-amount check compares SEN
 * (`Math.round(n*100)`), not floats: `100.005` and `100.01` are the same payment and re-writing the row
 * for no change still lands an audit entry saying the amount was adjusted.
 */
export function adjustRefusal(current: number, typed: string): string | null {
  const n = Number(typed);
  if (!isFinite(n) || n <= 0) return 'Enter an amount greater than zero';
  if (Math.round(n * 100) === Math.round(current * 100)) return 'That is the same amount';
  return null;
}

/** hros.html:2584 — the prompt names the claim and the figure being replaced. */
export const adjustPrompt = (claimNo: string | null | undefined, current: number): string =>
  'Adjust the payable amount for ' + (claimNo || 'this claim') + '\n\nCurrent: RM ' + current.toFixed(2) + '\n\nNew amount (RM):';

/** hros.html:2592 — and the confirm names what the approvers actually signed off on. */
export const adjustConfirm = (claimNo: string | null | undefined, current: number, next: number): string =>
  'Change ' + (claimNo || 'this claim') + ' from RM ' + current.toFixed(2) + ' to RM ' + next.toFixed(2)
  + '?\n\nThe approvers already signed off on RM ' + current.toFixed(2) + '.';

/** `hrRCResubmit()`'s confirm — hros.html:2606. All four declarations, re-confirmed in one dialog. */
export const RESUBMIT_CONFIRM =
  'By resubmitting you re-confirm ALL of these:\n\n• This claim is for business purpose.\n• It has not been claimed before.\n• All receipts / invoices attached are valid.\n• False claims may result in disciplinary action.\n\nOK = I confirm all four.';

/** The declarations a resubmit sends — hros.html:2608. */
export const RESUBMIT_DECLARATIONS = {
  business_purpose: true, not_claimed_before: true, receipts_valid: true, understand_disciplinary: true,
} as const;

export type { CSSProperties };
