// HR OS · Claims — the React screen against the legacy screen's committed golden.
//
// `tests/golden/hr.claims.html` was captured from `hrClaims()` (hros.html:3699) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts or
// tests/parity.ts. The component is rendered with `renderToStaticMarkup` from the SAME fixture the
// golden was captured from — tests/render_fixtures.ts, imported directly — normalised by the harness's
// own normalise(), relaxed by the documented layer in ./parity.ts, and compared.
//
// No seventh relaxation, and no screen-local rule either: this screen writes every cell through `esc()`
// with no named references, no duplicate attributes and no bare `&`, and its row ids are quoted
// literals, so `goldenHandlers()`'s default extraction covers them and the bare-integer widening five
// sibling screens carry is not needed here.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrClaims, { claimsReachable, isEmpMode, type Claim } from '../src/hr-claims';
import { goldenSection, relax } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `hrCompanyName()` (hros.html:4445) resolves the chip in the page head to the selected company. */
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

/**
 * The `#hr` element is what `hrRender()` writes the page head and the screen body into (hros.html:1554).
 * The golden's other two sections are chrome for every HR view, not this screen: `#hr_nav` is
 * `hrSidebar()` and `#emp-mobnav` is `hrRenderMobileChrome()`'s bottom tab bar. report.md §3.5 puts both
 * outside a screen-by-screen strangler.
 */
const GOLDEN = goldenSection('hr.claims', 'hr');

/** `HR.data.claims` as the harness fed it — tests/render_fixtures.ts:353. */
const CLAIMS = FIXTURES.hr_bootstrap.claims as Claim[];

const noop = () => {};

function screen(over: Partial<Parameters<typeof HrClaims>[0]> = {}) {
  return <HrClaims claims={CLAIMS} companyName={COMPANY_NAME} onDecide={noop} {...over} />;
}

describe('HR Claims — React vs the legacy golden', () => {
  it('renders the same document as hrClaims() does', () => {
    expect(relax(renderToStaticMarkup(screen()))).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * What makes relaxation R1 safe on THIS screen. R1 drops `on*=` from the string comparison, so the
 * golden's `onclick="hrDecideClaim('cl1','Approved')"` would otherwise compare equal to a button wired
 * to `'cl3'`, or to `'Rejected'` — approving a different person's claim, or rejecting the one in front
 * of you while the label still says Approve. This puts the arguments back: same handler kinds, same
 * document order, same identifying arguments.
 *
 * Inline rather than in ./tests/handlers.ts because that file is shared with sibling migrations in
 * flight and the brief puts it off limits; it exports exactly the two halves this needs.
 */
function assertHandlerParity(over: Partial<Parameters<typeof HrClaims>[0]> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({ attr, args: args.filter((a): a is string => typeof a === 'string' && a !== STUB_VALUE) });

  const got = reactHandlers(screen({ onDecide: record('decide') as never, ...over }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());
  expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));

  // Guard the guard: if the golden ever stops carrying handlers, the two `toEqual`s above pass
  // vacuously and R1 becomes the blind strip it is not allowed to be.
  expect(want.length).toBeGreaterThan(0);
  expect(want.some((h) => h.args.length > 0)).toBe(true);
}

describe('the permission boundary', () => {
  // Claims is an admin screen: every row is someone else's name, category and amount, and the buttons
  // decide their money. hros.html:1531 keeps employee mode out of it entirely; these pin BOTH halves of
  // that so a future change that lets an employee in fails here rather than in production.
  it('is not reachable in employee mode', () => {
    expect(isEmpMode('employee')).toBe(true);
    expect(isEmpMode('approver')).toBe(true);
    expect(claimsReachable('employee')).toBe(false);
    expect(claimsReachable('approver')).toBe(false);
  });

  it('is reachable by exactly the three roles hros.html:1368 keeps out of employee mode', () => {
    for (const r of ['admin', 'hr_admin', 'viewer']) expect(claimsReachable(r)).toBe(true);
  });

  it('offers no decision on a claim that is already decided', () => {
    // A stray Approve/Reject on a decided row is a silent reversal: hrDecideClaim() POSTs
    // unconditionally. The golden's own Approved and Rejected rows have empty action cells.
    const decided = CLAIMS.filter((c) => c.status !== 'Pending');
    expect(decided.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(screen({ claims: decided }));
    expect(html).not.toContain('Approve<');
    expect(html).not.toContain('Reject<');
  });
});

describe('the comparison still bites', () => {
  // Relaxations are only defensible if they cannot absorb a real change. These render the screen wrong
  // on purpose and require the comparison to notice each one — named from what would actually hurt
  // someone on THIS screen, where every row is another person's reimbursement.
  const want = relax(GOLDEN);
  const wrong = (over: Partial<Parameters<typeof HrClaims>[0]>) => relax(renderToStaticMarkup(screen(over)));
  const edit = (i: number, patch: Partial<Claim>) => CLAIMS.map((c, n) => (n === i ? { ...c, ...patch } : c));

  it('catches a dropped claim — the row that never gets reimbursed', () => {
    expect(wrong({ claims: CLAIMS.slice(1) })).not.toBe(want);
  });

  it('catches a changed amount, to the sen', () => {
    expect(wrong({ claims: edit(0, { amount: 128.41 }) })).not.toBe(want);
  });

  it('catches a claim attributed to the wrong employee', () => {
    expect(wrong({ claims: edit(0, { employee: { name: 'AHMAD BIN ISMAIL' } }) })).not.toBe(want);
  });

  it('catches a status pill whose colour no longer matches its word', () => {
    // The pill's colour is an inline style VALUE, which nothing in relax() touches — a Rejected claim
    // rendered in the Approved green is the whole signal an approver reads at a glance.
    expect(wrong({ claims: edit(2, { status: 'Approved' }) })).not.toBe(want);
  });

  it('catches an action cell appearing on an already-decided claim', () => {
    expect(wrong({ claims: edit(1, { status: 'Pending' }) })).not.toBe(want);
  });

  it('catches a dropped note', () => {
    expect(wrong({ claims: edit(0, { note: '' }) })).not.toBe(want);
  });

  it('catches a changed value in the page-head chrome', () => {
    expect(wrong({ companyName: 'SKINDAE SDN BHD' })).not.toBe(want);
  });

  it('catches a mis-wired handler — Approve pointed at the wrong claim', () => {
    // R1 strips the attribute, so ONLY assertHandlerParity() can see this. Proving it fails is what
    // makes R1 a relaxation rather than a hole.
    const calls: string[][] = [];
    const got = reactHandlers(
      <HrClaims
        claims={CLAIMS}
        companyName={COMPANY_NAME}
        onDecide={(_id, status) => calls.push([CLAIMS[2].id, status])}
      />,
    );
    got.forEach((h) => h.invoke());
    expect(calls).not.toEqual(goldenHandlers(GOLDEN).map((h) => h.args));
  });

  it('catches Approve wired to Rejected', () => {
    const calls: string[][] = [];
    const got = reactHandlers(
      <HrClaims claims={CLAIMS} companyName={COMPANY_NAME} onDecide={(id) => calls.push([id, 'Rejected'])} />,
    );
    got.forEach((h) => h.invoke());
    expect(calls).not.toEqual(goldenHandlers(GOLDEN).map((h) => h.args));
  });
});
