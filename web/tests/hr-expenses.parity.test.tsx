// HR OS · Reimbursement — the React screen against the legacy screen's committed golden.
//
// `tests/golden/hr.expenses.html` was captured from `hrRC()` (hros.html:1777) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts or
// tests/parity.ts. The component is rendered with `renderToStaticMarkup` from the SAME fixture the
// golden was captured from — tests/render_fixtures.ts, imported directly — normalised by the harness's
// own normalise(), relaxed by the documented layer in ./parity.ts, and compared.
//
// No seventh relaxation. The six the pilot argued cover this screen as it stands.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrExpenses, { bankFile, listCsv, selectedIds, type RcClaim, type RcMe } from '../src/hr-expenses';
import { goldenSection, relax } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `hrCompanyName()` (hros.html:4445) resolves the chip in the page head to the selected company. */
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

/**
 * The `#hr` element is what `hrRender()` writes the page head and the screen body into (hros.html:1538).
 * `#hr_nav` — the other section in this golden — is `hrSidebar()`, chrome for all 18 HR views, which
 * report.md §3.5 puts outside a screen-by-screen strangler.
 */
const GOLDEN = goldenSection('hr.expenses', 'hr');

const CLAIMS = (FIXTURES.hr_rc_list as { claims: RcClaim[] }).claims;
const ME = (FIXTURES.hr_rc_config as { me: RcMe }).me;

/**
 * `RC`'s state when the harness captured this screen — hros.html:1811/1813 plus RC_PRIMED
 * (tests/render_surfaces.ts:41), which runs `hrRCBoot()` so the config and the list are loaded.
 * `RC.page` and `RC.scope` are at their declared defaults and nothing is selected.
 */
const FIRST_PAINT = { page: 'list', scope: 'pending', sel: {} } as const;

const noop = () => {};

function screen(over: Partial<Parameters<typeof HrExpenses>[0]> = {}) {
  return (
    <HrExpenses
      claims={CLAIMS}
      me={ME}
      companyName={COMPANY_NAME}
      {...FIRST_PAINT}
      onNav={noop}
      onScope={noop}
      onOpen={noop}
      onSelAll={noop}
      onSelToggle={noop}
      onSelClear={noop}
      onExportAcct={noop}
      onExportCsv={noop}
      onExportBank={noop}
      onBulkApprove={noop}
      onBulkReject={noop}
      onBulkInfo={noop}
      onBulkPay={noop}
      {...over}
    />
  );
}

const rendered = () => relax(renderToStaticMarkup(screen()));

describe('HR Reimbursement — React vs the legacy golden', () => {
  it('renders the same document as hrRC() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * What makes relaxation R1 safe on THIS screen. R1 drops `on*=` from the string comparison, so the
 * golden's `onchange="hrRCSelToggle('rc2',this.checked)"` would otherwise compare equal to a checkbox
 * wired to `'rc3'` — and `RC.sel` is what decides which claims land in the bank payment file, so that
 * is the difference between paying one person and paying another. This puts the argument back: same
 * handler kinds, same document order, same identifying arguments.
 *
 * Inline rather than in ./tests/handlers.ts because that file is shared with sibling migrations in
 * flight and the brief puts it off limits; it exports exactly the two halves this needs.
 */
function assertHandlerParity(over: Partial<Parameters<typeof HrExpenses>[0]> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({ attr, args: args.filter((a): a is string => typeof a === 'string' && a !== STUB_VALUE) });

  const got = reactHandlers(screen({
    onNav: record('nav') as never,
    onScope: record('scope') as never,
    onOpen: record('open') as never,
    onSelAll: record('selAll') as never,
    onSelToggle: record('selToggle') as never,
    onExportAcct: record('exportAcct') as never,
    onExportCsv: record('exportCsv') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));

  got.forEach((h, i) => {
    const before = calls.length;
    h.invoke();
    if (calls.length > before) return;
    // A handler that called nothing. Exactly one on this screen legitimately does: the selection cell's
    // `onclick="event.stopPropagation()"`, which keeps a checkbox click from also opening the claim and
    // calls no screen function at all. Anything else landing here is a handler that quietly stopped
    // calling anything, and the position is checked against the golden's own text so it cannot spread.
    expect(want[i].raw).toBe('event.stopPropagation()');
    calls.push({ attr: h.attr, args: [] });
  });

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));

  // Guard the guard: if the golden ever stops carrying handlers, the two `toEqual`s above pass
  // vacuously and R1 becomes the blind strip it is not allowed to be.
  expect(want.length).toBeGreaterThan(0);
  expect(want.some((h) => h.args.length > 0)).toBe(true);
}

describe('the comparison still bites', () => {
  // Relaxations are only defensible if they cannot absorb a real change. These render the screen wrong
  // on purpose and require the comparison to notice each one — chosen from what would actually hurt on
  // a claims list that feeds a payment run, not from a generic list.
  const want = relax(GOLDEN);
  const wrong = (over: Partial<Parameters<typeof HrExpenses>[0]>) => relax(renderToStaticMarkup(screen(over)));

  it('catches a dropped claim', () => {
    expect(wrong({ claims: CLAIMS.slice(1) })).not.toBe(want);
  });

  it('catches a claim whose status silently changed — pending_approval reading as Approved', () => {
    // The one that matters: `Approved` is the status hrRCExportBank() pays on, and it also repaints the
    // pill. A claim that drifted into it would be picked up by the next bank file.
    const c = [{ ...CLAIMS[0], status: 'Approved' }, ...CLAIMS.slice(1)];
    expect(wrong({ claims: c })).not.toBe(want);
  });

  it('catches a changed amount', () => {
    const c = [{ ...CLAIMS[0], amount: 128.40 }, ...CLAIMS.slice(1)];
    expect(wrong({ claims: c })).not.toBe(want);
  });

  it('catches a claim silently gaining a tick in the selection column', () => {
    // `checked` is a bare boolean attribute on one side and `checked=""` on the other, which is exactly
    // the shape R4 rewrites — so this proves R4 rewrites the spelling and not the presence. A claim
    // pre-ticked on load is a claim in the payment run nobody chose.
    expect(wrong({ sel: { rc1: true } })).not.toBe(want);
  });

  it('catches the selection column disappearing altogether', () => {
    // `selecting` is false for a viewer with no approval rights; the checkboxes AND the bulk bar go, and
    // the header colspan changes with them.
    expect(wrong({ me: { isAdmin: false, is_manager: false, roles: [] } })).not.toBe(want);
  });

  it('catches the pending count drifting away from the row count', () => {
    // "Pending (3)" is rendered from `list.length`, so it can only disagree with the table if the label
    // is hardcoded. Rendering four rows must move it.
    expect(wrong({ claims: [...CLAIMS, { ...CLAIMS[0], id: 'rc4', claim_no: 'RC-2026-0032' }] })).not.toBe(want);
  });

  it('catches a changed value in the page-head chrome', () => {
    expect(wrong({ companyName: 'SKINDAE SDN BHD' })).not.toBe(want);
  });

  it('catches a mis-wired row: the checkbox of claim 2 pointing at claim 3', () => {
    // The defect R1 cannot see in the string comparison, and the one this screen is most exposed to.
    // Mis-wiring is simulated by feeding the component two claims that share an id, which is the shape a
    // row wired to the wrong record produces: the same identifying argument twice.
    const dup = [CLAIMS[0], { ...CLAIMS[1], id: CLAIMS[2].id }, CLAIMS[2]];
    expect(() => assertHandlerParity({ claims: dup })).toThrow();
  });

  it('catches a handler that stopped calling anything', () => {
    // The `event.stopPropagation()` escape hatch in assertHandlerParity is positional, so a DIFFERENT
    // handler going silent must not slip through it.
    expect(() => assertHandlerParity({ onOpen: undefined as never })).toThrow();
  });
});

describe('the bank payment file', () => {
  // hrRCExportBank() (hros.html:1849) writes money out of the building. tests/golden cannot see it — it
  // is not markup — so it is pinned here.
  const APPROVED: RcClaim[] = [
    { id: 'rc2', claim_no: 'RC-2026-0030', status: 'Approved', amount: 88, hr_employees: { name: 'AHMAD BIN ISMAIL', bank_name: 'Maybank', bank_account: '512345678901', ic_no: '880101-14-5501', email: 'ahmad@ctg.my' } },
    { id: 'rc9', claim_no: 'RC-2026-0028', status: 'Approved', amount: 42, hr_employees: { name: 'RAJESH A/L KUMAR', bank_name: 'CIMB Bank', bank_account: '7001234567', ic_no: '900202-10-5123', email: 'rajesh@ctg.my' } },
    { id: 'rc1', claim_no: 'RC-2026-0031', status: 'pending_approval', amount: 128.4, hr_employees: { name: 'SITI NURHALIZA BINTI OMAR' } },
  ];
  const rows = (f: { text: string }) => f.text.trim().split('\r\n');

  it('NEVER writes a TOTAL trailer — v157, a payment row for the whole batch', () => {
    // The required deliverable. A trailer would be a duplicate payment for the full amount, made to a
    // payee literally called TOTAL. This fails the moment one reappears, wherever in the file it lands.
    const f = bankFile(APPROVED, [], '2026-08-19')!;
    expect(f.text).not.toMatch(/TOTAL/i);
    expect(rows(f)).toHaveLength(3);            // header + the two Approved claims, and nothing else
    expect(f.total).toBe(130);                  // computed, reported in the toast, never written
  });

  it('pays only Approved claims, and an empty selection means all of them', () => {
    const f = bankFile(APPROVED, [], '2026-08-19')!;
    expect(rows(f).slice(1).map((r) => r.split(',')[1])).toEqual(['AHMAD BIN ISMAIL', 'RAJESH A/L KUMAR']);
  });

  it('pays exactly the selected claims — a selection cannot reach a claim it does not name', () => {
    const f = bankFile(APPROVED, selectedIds({ rc9: true, rc2: false }), '2026-08-19')!;
    expect(rows(f).slice(1).map((r) => r.split(','))).toEqual([
      ['1', 'RAJESH A/L KUMAR', 'CIMB Bank', 'CIBBMYKL', '7001234567', '900202-10-5123', '42.00', 'RC-2026-0028', 'rajesh@ctg.my'],
    ]);
  });

  it('resolves the SWIFT/BIC from the bank name via hr-docs.js, not a copy of the table', () => {
    const f = bankFile(APPROVED, ['rc2'], '2026-08-19')!;
    expect(rows(f)[1].split(',')[3]).toBe('MBBEMYKL');
  });

  it('emits nothing when no Approved claim is in scope', () => {
    expect(bankFile(APPROVED, ['rc1'], '2026-08-19')).toBeNull();
    expect(bankFile([], [], '2026-08-19')).toBeNull();
  });

  it('dates the filename from the day it is handed, not from the machine clock', () => {
    expect(bankFile(APPROVED, [], '2026-08-19')!.name).toBe('Reimbursement_Payments_2026-08-19.csv');
  });

  it('the list CSV is a different file and DOES cover every claim, Approved or not', () => {
    const f = listCsv(APPROVED, 'pending', '2026-08-19')!;
    expect(f.count).toBe(3);
    expect(f.name).toBe('Reimbursements_pending_2026-08-19.csv');
    expect(f.text).not.toMatch(/TOTAL/i);
  });
});
