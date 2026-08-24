// HR OS · Reimbursement · a claim's DETAIL — React against the legacy screen's committed golden.
//
// `tests/golden/hr.expenses.detail.html` was captured from `hrRCDetail()` (hros.html:2513) by the
// shared 44-surface harness. Nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts or tests/parity.ts.
//
// The golden is ONE claim in ONE state — Pending Manager Approval, `can_finance:false`,
// `can_post:false`, unpaid, not in Xero. Every other panel this renderer can produce is asserted here:
// the Approved / Paid actions, the Xero block, the per-line GL editor, the mileage-only shape and the
// "not yet submitted" timeline. And the voucher, which is a DOCUMENT and is in no golden at all.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES } from '../../tests/render_fixtures';
import HrExpensesDetail, {
  adjustConfirm, adjustPrompt, adjustRefusal, canEditGl, editForm, isPending, PENDING_STATUSES,
  RESUBMIT_DECLARATIONS, voucherHtml, type RcDetail,
} from '../src/hr-expenses-detail';
import HrExpenses, { type RcMe } from '../src/hr-expenses';
import { COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

const HROS = readFileSync(join(REPO, 'hros.html'), 'utf8');
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;
const GOLDEN = goldenSection('hr.expenses.detail', 'hr');

const D = FIXTURES.hr_rc_get as RcDetail;
const ME = (FIXTURES.hr_rc_config as { me: RcMe }).me;
const noop = () => {};

/**
 * hros.html:2554 writes `&rsquo;` into the Post-to-Xero copy and hros.html:2520 into the buyer warning;
 * the golden holds the eight characters and React can only emit the character. hr-payroll's finding, in
 * this screen's own file, narrowed to the entities this renderer actually writes. It never touches
 * `&amp;` (so the doubly-escaped defect still diffs) and never `&nbsp;` (which R2 canonicalises the
 * other way on purpose).
 */
const decodeNamedRefs = (s: string) => s.replace(/&rsquo;/g, '’').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”');

function detail(over: Partial<Parameters<typeof HrExpensesDetail>[0]> = {}) {
  return (
    <HrExpensesDetail
      detail={D}
      isAdmin={!!ME.isAdmin}
      isViewer={false}
      busy={null}
      onBack={noop}
      onDecide={noop}
      onOverride={noop}
      onMarkPaid={noop}
      onGlEdit={noop}
      onPostXero={noop}
      onFormAndReceipts={noop}
      onVoucher={noop}
      onEdit={noop}
      onResubmit={noop}
      onAdjustAmount={noop}
      onCancel={noop}
      {...over}
    />
  );
}

/** The golden holds the whole `#hr`: the page head, `hrRC()`'s tab bar (with `list` still highlighted
 *  while `RC.page==='detail'` — hros.html:1786) and the detail body. */
function screen(over: Partial<Parameters<typeof HrExpensesDetail>[0]> = {}, onNav: (p: string) => void = noop) {
  return (
    <>
      <HrExpenses
        claims={[]} me={ME} companyName={COMPANY_NAME} page="detail" scope="pending" sel={{}}
        onNav={onNav} onScope={noop} onOpen={noop} onSelAll={noop} onSelToggle={noop} onSelClear={noop}
        onExportAcct={noop} onExportCsv={noop} onExportBank={noop} onBulkApprove={noop} onBulkReject={noop}
        onBulkInfo={noop} onBulkPay={noop}
      />
      {detail(over)}
    </>
  );
}

const rendered = (over: Partial<Parameters<typeof HrExpensesDetail>[0]> = {}) =>
  decodeNamedRefs(relax(renderToStaticMarkup(screen(over))));

describe('HR Reimbursement · detail — React vs the legacy golden', () => {
  it('renders the same document as hrRCDetail() does', () => {
    expect(rendered()).toBe(decodeNamedRefs(relax(GOLDEN)));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * This screen's handlers are almost all ARGUMENT-FREE (`hrRCVoucher()`, `hrRCCancel()`,
 * `hrRCFormAndReceipts()`), so comparing arguments alone would let 🖨 Voucher build the merged PDF and
 * ✕ Reject approve. `hr.payroll`'s `LEGACY_TO_PROP` is the answer: a golden-DERIVED map from the legacy
 * function CALL to the prop it became, compared as a sequence. `identArgs()` is copied in too for the
 * three that DO carry one (`hrRCDecide('approve')`).
 */
function identArgs(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(/'([^']*)'|"([^"]*)"|(?<![\w.])(-?\d+)(?![\w.])/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Keyed on the WHOLE raw text where the destination lives in the prop rather than in an argument. */
const LEGACY_TO_PROP: Record<string, string> = {
  hrRCNav: 'nav-or-back',
  'hrRCDecide': 'decide',
  'hrRCOverride()': 'override',
  'hrRCMarkPaid()': 'markPaid',
  'hrRCSetGl': 'glEdit',
  'hrRCPostXero()': 'postXero',
  'hrRCFormAndReceipts()': 'pdf',
  'hrRCVoucher()': 'voucher',
  'hrRCEdit()': 'edit',
  'hrRCResubmit()': 'resubmit',
  'hrRCAdjustAmount()': 'adjust',
  'hrRCCancel()': 'cancel',
};
const propFor = (raw: string) => LEGACY_TO_PROP[raw] ?? LEGACY_TO_PROP[raw.replace(/\(.*/, '')] ?? raw;

function assertHandlerParity(over: Partial<Parameters<typeof HrExpensesDetail>[0]> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { prop: string; args: string[] }[] = [];
  const record = (prop: string) => (...args: unknown[]) =>
    calls.push({
      prop,
      args: args.filter((a) => (typeof a === 'string' && a !== STUB_VALUE) || typeof a === 'number').map(String),
    });

  const got = reactHandlers(screen({
    // The back button and the tab bar's 📋 Claims are both `hrRCNav('list')`; both are "go to the list".
    onBack: () => record('nav-or-back')('list'),
    onDecide: record('decide') as never,
    onOverride: record('override'),
    onMarkPaid: record('markPaid'),
    onGlEdit: record('glEdit') as never,
    onPostXero: record('postXero'),
    onFormAndReceipts: record('pdf'),
    onVoucher: record('voucher'),
    onEdit: record('edit'),
    onResubmit: record('resubmit'),
    onAdjustAmount: record('adjust'),
    onCancel: record('cancel'),
    ...over,
  }, (p: string) => record('nav-or-back')(p)));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => { h.invoke(); });

  // IDENTITY first — which control is wired to which action — then the arguments.
  expect(calls.map((c) => c.prop)).toEqual(want.map((h) => propFor(h.raw)));
  expect(calls.map((c) => c.args)).toEqual(want.map((h) => identArgs(h.raw)));

  // Guard the guard. Every golden handler must have resolved to a KNOWN prop, so a legacy button added
  // later is a failure rather than a silent fall-through of `propFor`'s `?? h.raw` — hr.profile's rule,
  // and the one that has to replace `some(args.length > 0)` on an argument-free screen.
  expect(want.length).toBeGreaterThan(0);
  want.forEach((h) => expect(Object.values(LEGACY_TO_PROP), h.raw).toContain(propFor(h.raw)));
}

describe('the comparison still bites', () => {
  const want = decodeNamedRefs(relax(GOLDEN));

  it('catches a changed claim amount', () => {
    expect(rendered({ detail: { ...D, claim: { ...D.claim, amount: 129.40 } } })).not.toBe(want);
  });

  it('catches a changed LINE amount even when the header stays put', () => {
    const items = [{ ...D.items![0], amount: 87.40 }, D.items![1]];
    expect(rendered({ detail: { ...D, items } })).not.toBe(want);
  });

  it('catches a dropped expense line', () => {
    expect(rendered({ detail: { ...D, items: D.items!.slice(1) } })).not.toBe(want);
  });

  it('catches the status drifting', () => {
    expect(rendered({ detail: { ...D, claim: { ...D.claim, status: 'Approved' } } })).not.toBe(want);
  });

  it('catches a receipt disappearing', () => {
    expect(rendered({ detail: { ...D, attachments: D.attachments!.slice(1) } })).not.toBe(want);
  });

  it('catches an approval step losing its assignee', () => {
    const steps = [{ ...D.steps![0], assignee_name: null }, D.steps![1]];
    expect(rendered({ detail: { ...D, steps } })).not.toBe(want);
  });

  it('catches the ✎ GL editor appearing for someone who may not use it', () => {
    expect(rendered({ detail: { ...D, can_finance: true, claim: { ...D.claim, status: 'Approved' } } })).not.toBe(want);
  });
});

/**
 * MONEY. The footer of the lines table is the STORED header amount, not a re-sum of the rows — that is
 * the figure `hr_rc_save` (hr.ts:2019) and `hr_rc_submit` (hr.ts:2180) computed and wrote, and the one
 * the bank file pays. A port that re-derived it would silently disagree the moment an admin used
 * ✏️ Adjust amount, which changes the header and leaves the lines alone.
 */
describe('the total on the detail is the stored one', () => {
  it('prints the header amount, not the sum of the rows', () => {
    const d = { ...D, claim: { ...D.claim, amount: 99.99 } };            // deliberately ≠ 86.40 + 42.00
    const html = renderToStaticMarkup(detail({ detail: d }));
    expect(html).toContain('RM 99.99');
    expect(html).not.toContain('RM 128.40');
  });

  it('the golden fixture is nevertheless self-consistent, so nothing is being papered over', () => {
    const sum = Math.round(D.items!.reduce((s, i) => s + Number(i.amount), 0) * 100) / 100;
    expect(sum).toBe(Number(D.claim.amount));
  });

  it('a line prints incl-tax only when there is tax or SST on it', () => {
    const html = renderToStaticMarkup(detail());
    expect(html).toContain('incl tax RM 5.18');                          // ri1 carries sst_amount 5.18
    expect(html.match(/incl tax/g)).toHaveLength(1);                     // ri2 carries neither
  });
});

/** `hrRCVoucher()` — hros.html:1870. A document that leaves the building; no golden sees it. */
describe('the printable voucher', () => {
  const html = voucherHtml(D, COMPANY_NAME);

  it('names the claim, the employee, the company and the bank account it will be paid into', () => {
    expect(html).toContain('RC-2026-0031');
    expect(html).toContain('SITI NURHALIZA BINTI OMAR');
    expect(html).toContain(COMPANY_NAME);
    expect(html).toContain('8001234567');
  });

  it('DOES end with a TOTAL row — a voucher is one payment and that IS its total', () => {
    // The opposite call to the bank file (v157) and to CP8D (v222), where a trailer is a second payment
    // and one more employee respectively. Both of those are asserted ABSENT elsewhere; this one is
    // asserted PRESENT, and it is the stored header figure.
    expect(html).toContain('>TOTAL</td>');
    expect(html).toContain('>128.40</td>');
  });

  it('prints one row per expense line, in order', () => {
    const rows = [...html.matchAll(/<tr><td>Travel &amp; transport|<tr><td>Mileage/g)];
    expect(rows).toHaveLength(2);
  });

  it('falls back to the claim description when there are no lines', () => {
    const one = voucherHtml({ ...D, items: [] }, COMPANY_NAME);
    expect(one).toContain('colspan="3"');
    expect(one).toContain('Client visit — Grab + mileage');
  });

  it('shows the payment block only once paid, and the Xero ref only once posted', () => {
    expect(html).not.toContain('Paid on');
    expect(html).not.toContain('Posted to Xero');
    const paid = voucherHtml({ ...D, payment: { paid_date: '2026-08-20', payment_method: 'Bank Transfer', payment_reference: 'TT-9911' } }, COMPANY_NAME);
    expect(paid).toContain('Paid on 2026-08-20 · Bank Transfer · ref TT-9911');
  });

  it('escapes what it interpolates', () => {
    const nasty = voucherHtml({ ...D, claim: { ...D.claim, claim_no: '<script>x</script>' } }, COMPANY_NAME);
    expect(nasty).not.toContain('<script>x</script>');
    expect(nasty).toContain('&lt;script&gt;');
  });

  it('keeps the three signature columns', () => {
    expect(html).toContain('Prepared by');
    expect(html).toContain('Approved by');
    expect(html).toContain('Received by');
  });
});

/** `hrRCAdjustAmount()` — hros.html:2581. Every guard, because each one protects an approved figure. */
describe('adjusting an approved amount', () => {
  it('refuses zero, negative and non-numeric', () => {
    expect(adjustRefusal(128.4, '0')).toBe('Enter an amount greater than zero');
    expect(adjustRefusal(128.4, '-5')).toBe('Enter an amount greater than zero');
    expect(adjustRefusal(128.4, 'abc')).toBe('Enter an amount greater than zero');
  });

  it('refuses Infinity — isFinite, not isNaN', () => {
    // `isNaN(Infinity)` is false, so an isNaN-based guard lets `1e400` through. CLAUDE.md's rule.
    expect(adjustRefusal(128.4, '1e400')).toBe('Enter an amount greater than zero');
  });

  it('refuses the same amount, compared in SEN', () => {
    expect(adjustRefusal(128.4, '128.40')).toBe('That is the same amount');
    expect(adjustRefusal(128.4, '128.401')).toBe('That is the same amount');   // same sen
    expect(adjustRefusal(128.4, '128.41')).toBeNull();
  });

  it('names the claim and the figure the approvers signed off on', () => {
    expect(adjustPrompt('RC-2026-0031', 128.4)).toContain('Current: RM 128.40');
    const c = adjustConfirm('RC-2026-0031', 128.4, 99);
    expect(c).toContain('from RM 128.40 to RM 99.00');
    expect(c).toContain('already signed off on RM 128.40');
  });
});

/** Panels the golden cannot hold, mirrored from the legacy source. */
describe('the branches no golden reaches', () => {
  it('Approved shows the mark-as-paid form and nothing else', () => {
    const html = renderToStaticMarkup(detail({ detail: { ...D, claim: { ...D.claim, status: 'Approved' } } }));
    expect(html).toContain('id="rc_pm"');
    expect(html).toContain('id="rc_pr"');
    expect(html).not.toContain('id="rc_com"');
  });

  it('Paid shows the payment line and no write control at all', () => {
    const d = { ...D, claim: { ...D.claim, status: 'Paid' }, payment: { paid_date: '2026-08-20', payment_method: 'Bank Transfer', payment_reference: 'TT-9911' } };
    const html = renderToStaticMarkup(detail({ detail: d }));
    expect(html).toContain('✓ Paid 2026-08-20 · Bank Transfer · TT-9911');
    expect(html).not.toContain('id="rc_pm"');
    expect(html).not.toContain('Cancel claim');            // Paid is terminal — hros.html:2567
    expect(html).not.toContain('Adjust amount');           // and blocked from adjustment — hros.html:2565
  });

  it('Draft and Need More Info are the only statuses that offer Edit / Submit', () => {
    ['Draft', 'Need More Info'].forEach((status) => {
      const html = renderToStaticMarkup(detail({ detail: { ...D, claim: { ...D.claim, status } } }));
      expect(html, status).toContain('>Edit</button>');
      expect(html, status).toContain(status === 'Need More Info' ? 'Resubmit →' : 'Submit →');
    });
    ['Submitted', 'Approved', 'Paid', 'Rejected', 'Cancelled'].forEach((status) => {
      const html = renderToStaticMarkup(detail({ detail: { ...D, claim: { ...D.claim, status } } }));
      expect(html, status).not.toContain('>Edit</button>');
    });
  });

  it('✏️ Adjust amount is admin-only, hidden from a viewer, and blocked once in Xero', () => {
    const has = (over: Partial<Parameters<typeof HrExpensesDetail>[0]>) =>
      renderToStaticMarkup(detail(over)).includes('Adjust amount');
    expect(has({})).toBe(true);
    expect(has({ isAdmin: false })).toBe(false);
    expect(has({ isViewer: true })).toBe(false);
    expect(has({ detail: { ...D, claim: { ...D.claim, xero_bill_id: 'xb1' } } })).toBe(false);
  });

  it('the Xero panels appear only for a caller the SERVER said may post', () => {
    expect(renderToStaticMarkup(detail())).not.toContain('Post to Xero');
    const can = renderToStaticMarkup(detail({ detail: { ...D, can_post: true } }));
    expect(can).toContain('Post to Xero →');
    const posted = renderToStaticMarkup(detail({ detail: { ...D, can_post: true, claim: { ...D.claim, xero_bill_id: 'xb1', xero_reference: 'REF-1' } } }));
    expect(posted).toContain('✓ Posted to Xero');
    expect(posted).toContain('Re-sync reference');
  });

  it('the per-line GL editor follows the server flag AND the status, not the role', () => {
    expect(canEditGl(D)).toBe(false);
    expect(canEditGl({ ...D, can_finance: true })).toBe(false);                                        // wrong status
    expect(canEditGl({ ...D, can_finance: true, claim: { ...D.claim, status: 'Approved' } })).toBe(true);
    expect(canEditGl({ ...D, can_finance: true, claim: { ...D.claim, status: 'Approved', xero_bill_id: 'xb1' } })).toBe(false);
  });

  it('a claim with no lines falls back to the mileage panel', () => {
    const d = { ...D, items: [], mileage: { start_location: 'Office', end_location: 'Client KL', total_km: 60, mileage_rate: 0.6, calculated_amount: 36 } };
    const html = renderToStaticMarkup(detail({ detail: d }));
    expect(html).toContain('🚗 Mileage');
    expect(html).toContain('Office → Client KL · 60 km × RM0.6 = ');
    expect(html).toContain('RM 36.00');
  });

  it('a claim with no steps says so rather than rendering an empty timeline', () => {
    expect(renderToStaticMarkup(detail({ detail: { ...D, steps: [] } }))).toContain('Not yet submitted');
  });

  it('a step with a role nobody holds warns instead of claiming "any admin"', () => {
    const html = renderToStaticMarkup(detail());
    expect(html).toContain('has nobody assigned');
    const anyAdmin = renderToStaticMarkup(detail({
      detail: { ...D, steps: [{ step_order: 1, name: 'Manager', status: 'Pending' }] },
    }));
    expect(anyAdmin).toContain('👤 Approver: any admin');
  });

  it('an acted step names who and when, in Malaysian time', () => {
    const steps = [{ ...D.steps![0], status: 'Approved', decision: 'approve', acted_by_name: 'AHMAD BIN ISMAIL', acted_at: '2026-08-11T01:15:00.000Z' }, D.steps![1]];
    const html = renderToStaticMarkup(detail({ detail: { ...D, steps } }));
    // hrDT() is +8h arithmetic, so this is the same string in every machine timezone.
    expect(html).toContain('by AHMAD BIN ISMAIL · 11 Aug 2026, 9:15am');
  });

  it('the busy flag disables exactly the control that is in flight', () => {
    const approver = renderToStaticMarkup(detail({ busy: 'decide' }));
    expect(approver).toMatch(/<button class="btn p sm" disabled[^>]*>✓ Approve/);
    expect(renderToStaticMarkup(detail({ busy: null }))).not.toMatch(/disabled/);
  });
});

/** `hrRCEdit()` — hros.html:2598. No golden sees a form's INITIAL state either. */
describe('turning a claim back into a form', () => {
  it('carries every field hrRCEdit() carries — read out of hros.html, not retyped', () => {
    const src = HROS.slice(HROS.indexOf('function hrRCEdit()'), HROS.indexOf('async function hrRCResubmit()'));
    const wantLine = [...src.matchAll(/([a-z_]+):\s*it\./g)].map((m) => m[1]);
    expect(wantLine.length).toBeGreaterThan(18);
    const f = editForm(D);
    [...new Set(wantLine)].forEach((k) => expect(Object.keys(f.items[0]), k).toContain(k));
  });

  it('slices dates to the day and keeps the saved attachments so they are not re-uploaded', () => {
    const f = editForm(D);
    expect(f.claim_date).toBe('2026-08-09');
    expect(f.items[0].item_date).toBe('2026-08-09');
    expect(f._existingAtts).toHaveLength(2);
    expect(f.id).toBe('rc1');
  });

  it('a claim with no lines becomes one line built from the header', () => {
    const f = editForm({ ...D, items: [], mileage: { total_km: 60, mileage_rate: 0.6 } });
    expect(f.items).toHaveLength(1);
    expect(f.items[0].amount).toBe(128.40);
    expect(f.items[0].total_km).toBe(60);
  });
});

/** Mirrored legacy behaviour that is worth pinning because it looks like a bug and is not being fixed. */
describe('the legacy gaps this port mirrors rather than fixes', () => {
  it('renders the approver panel from the STATUS alone, so a claim owner sees it too', () => {
    // hros.html:2516. `hr_rc_decide` (hr.ts:2261) refuses them, so it is a button that errors on click
    // rather than a hole — `hrClaims()` not wrapping its decisions in `hrRW()` is the same class. Fixing
    // it is a behaviour change, not a migration detail.
    const src = HROS.slice(HROS.indexOf('function hrRCDetail()'), HROS.indexOf('async function hrRCDecide('));
    expect(src).toContain("var pending=['Pending Manager Approval','Pending HR Approval','Pending Finance Approval','Pending Director Approval','Submitted'].indexOf(c.status)>=0;");
    expect(src).toMatch(/if\(pending\)\{ actions=/);
    expect(PENDING_STATUSES).toEqual(['Pending Manager Approval', 'Pending HR Approval', 'Pending Finance Approval', 'Pending Director Approval', 'Submitted']);
    expect(isPending('Submitted')).toBe(true);
    expect(isPending('Approved')).toBe(false);
    expect(renderToStaticMarkup(detail())).toContain('Approver actions');
  });

  it('a resubmit re-confirms all four declarations in one dialog, and sends all four', () => {
    expect(RESUBMIT_DECLARATIONS).toEqual({
      business_purpose: true, not_claimed_before: true, receipts_valid: true, understand_disciplinary: true,
    });
    // `hr_rc_submit` (hr.ts:2185) refuses unless all four are true, so a port that sent three would 400
    // on every resubmit. Read out of hros.html rather than retyped.
    const src = HROS.slice(HROS.indexOf('async function hrRCResubmit()'), HROS.indexOf('async function hrRCLoadDash()'));
    expect(src).toContain('var dec={business_purpose:true,not_claimed_before:true,receipts_valid:true,understand_disciplinary:true};');
  });
});
