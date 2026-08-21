// HR OS · My Payslips — the React screen against the legacy screen's committed golden.
//
// `tests/golden/hr.payslip.html` was captured from `hrEmpPayslipsRender()` (hros.html:3183) by the
// 40-surface harness IN EMPLOYEE MODE (`HR_EMP_MODE=true; hrRCBoot();` — see the EMP_MODE comment in
// tests/render_surfaces.ts, which records that an earlier cut captured a loading spinner as this
// screen's baseline by getting that wrong). Nothing here regenerates or edits it, and nothing here
// touches tests/render_surfaces.ts, tests/parity.ts or tests/handlers.ts. The component is rendered
// with `renderToStaticMarkup` from the SAME fixture the golden was captured from —
// tests/render_fixtures.ts, imported directly — normalised by the harness's own normalise(), relaxed by
// the documented layer in ./parity.ts, and compared.
//
// No seventh SHARED relaxation. This file adds one screen-local rule (`decodeTextAmp`, below) held to
// ./parity.ts's own bar, for the same reason hr-calculator's `dedupeAttrs`, hr-employees'
// `decodeAttrAmp` and hr-payroll's `decodeNamedRefs` live in their own files.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrPayslip, { dedTot, type HrPayslipProps, type MyPayslips, type Payslip } from '../src/hr-payslip';
import { goldenSection, relax } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `hrCompanyName()` (hros.html:4445) resolves the chip in the page head to the selected company. */
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

/**
 * The `#hr` element is what `hrRender()` writes the page head and the screen body into (hros.html:1554).
 * The golden's other two sections are chrome for every HR view, not this screen: `#hr_nav` is
 * `hrSidebar()` and `#emp-mobnav` is `hrRenderMobileChrome()`'s bottom tab bar. report.md §3.5 puts both
 * outside a screen-by-screen strangler — keep them in the legacy files, re-implement once in the shell.
 */
const GOLDEN = goldenSection('hr.payslip', 'hr');

const DATA = FIXTURES.hr_my_payslips as unknown as MyPayslips;

/**
 * A bare `&` in TEXT and `&amp;` are the same text node — the HTML parser produces the character `&`
 * from both, because `& deductions` is not a character reference. The footnote at hros.html:3216 is
 * written straight into the HTML string without `esc()`, so the golden carries the bare form; React's
 * text escaper has no way to emit it (a `&` in JSX text always comes out `&amp;`), exactly as it has no
 * way to emit hr-employees' bare `&` in an attribute value. Applying the parser's own rule to BOTH
 * sides compares the documents rather than the spelling.
 *
 * Deliberately the narrowest rule that covers it: only the five characters `&amp;`, only OUTSIDE a tag,
 * and only where they are not the prefix of another reference this could re-spell — `&amp;lt;` is left
 * alone, so hr-payroll's `&amp;ldquo;` case is untouched. It cannot hide a changed number, a dropped
 * row, a renamed label or a missing attribute: it rewrites five characters into one character in a
 * place where both are the same character, and it runs identically on both sides. `decodeTextAmp
 * cannot hide a real change` below is the test that fails if it ever widened.
 *
 * It lives HERE and not in ./parity.ts because parity.ts is shared with sibling migrations in flight and
 * the brief puts it off limits. It is also the second `&` rule in the repo but the FIRST in text —
 * hr-employees' is attribute-only — so folding either into the shared layer is still a decision for a
 * later pass, not something one screen's finding settles.
 */
export function decodeTextAmp(html: string): string {
  return html.split(/(<[a-zA-Z\/!][^>]*>)/).map((part, i) =>
    i % 2 === 1 ? part : part.replace(/&amp;(?![a-zA-Z]+;|#\d+;|#[xX][0-9a-fA-F]+;)/g, '&')).join('');
}

/** Both sides read as the document a parser builds, then compared under ./parity.ts's six relaxations. */
const sameDocument = (html: string) => relax(decodeTextAmp(html));

const noop = () => {};

function screen(over: Partial<HrPayslipProps> = {}) {
  return (
    <HrPayslip
      data={DATA}
      companyName={COMPANY_NAME}
      onDownload={noop}
      onRetry={noop}
      {...over}
    />
  );
}

const rendered = (over: Partial<HrPayslipProps> = {}) => sameDocument(renderToStaticMarkup(screen(over)));
const want = sameDocument(GOLDEN);

describe('HR My Payslips — React vs the legacy golden', () => {
  it('renders the same document as hrEmpPayslipsRender() does', () => {
    expect(rendered()).toBe(want);
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * Every quoted string literal AND every bare number in a golden handler body, in order.
 *
 * `goldenHandlers().args` in ./tests/handlers.ts collects QUOTED literals only, because on the first
 * screens a row is a quoted id (`'u9'`, `'out'`). Every handler on THIS screen is
 * `onclick="hrEmpPayslipDownload(0)"` — a bare integer indexing `EPS.data.payslips` — so quoted-only
 * extraction returns `[]` for every row and the check would pass with all three PDF buttons downloading
 * January's payslip. CLAUDE.md records five screens already carrying this identical local widening; this
 * is the sixth, and it is still a strict superset of `goldenHandlers().args`, so it can only tighten the
 * check. Folding it into handlers.ts is the single change to make there once the in-flight migrations
 * have landed.
 */
function identArgs(raw: string): string[] {
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/**
 * What makes relaxation R1 safe on THIS screen. R1 drops `on*=` from the string comparison, so the
 * golden's `onclick="hrEmpPayslipDownload(1)"` would otherwise compare equal to a button wired to `0` —
 * every row's markup is identical apart from its figures, so a swapped index is invisible in the
 * document and hands the employee the wrong month's payslip. This puts the argument back: same handler
 * kinds, same document order, same identifying arguments.
 *
 * Inline rather than in ./tests/handlers.ts because that file is shared with sibling migrations in
 * flight and the brief puts it off limits; it exports exactly the two halves this needs.
 */
function assertHandlerParity(over: Partial<HrPayslipProps> = {}) {
  const wantH = goldenHandlers(GOLDEN).map((h) => ({ attr: h.attr, args: identArgs(h.raw) }));
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args.filter((a) => (typeof a === 'string' && a !== STUB_VALUE) || typeof a === 'number').map(String),
    });

  const got = reactHandlers(screen({ onDownload: record('download') as never, ...over }));

  expect(got.map((h) => h.attr)).toEqual(wantH.map((h) => h.attr));
  got.forEach((h) => h.invoke());
  expect(calls.map((c) => c.args)).toEqual(wantH.map((h) => h.args));

  // Guard the guard: if the golden ever stops carrying handlers, the two `toEqual`s above pass
  // vacuously and R1 becomes the blind strip it is not allowed to be.
  expect(wantH.length).toBeGreaterThan(0);
  expect(wantH.some((h) => h.args.length > 0)).toBe(true);
}

describe('the comparison still bites', () => {
  // Relaxations are only defensible if they cannot absorb a real change. These render the screen wrong
  // on purpose and require the comparison to notice each one. Every figure here is someone's pay, so the
  // defects chosen are the ones that would actually cost an employee: a month that is not theirs, a
  // deduction that rounds away, a missing row.
  const slips = DATA.payslips!;

  it('catches a dropped month — a payslip the employee can no longer see', () => {
    expect(rendered({ data: { ...DATA, payslips: slips.slice(1) } })).not.toBe(want);
  });

  it('catches the wrong month label on a row', () => {
    const s: Payslip[] = [{ ...slips[0], month: 8 }, slips[1], slips[2]];
    expect(rendered({ data: { ...DATA, payslips: s } })).not.toBe(want);
  });

  it('catches the wrong YEAR on a row, which also moves the per-year totals', () => {
    const s: Payslip[] = [{ ...slips[0], year: 2025 }, slips[1], slips[2]];
    expect(rendered({ data: { ...DATA, payslips: s } })).not.toBe(want);
  });

  it('catches a deduction that silently rounds — one sen on one month', () => {
    const s: Payslip[] = [{ ...slips[0], p: { ...slips[0].p, pcb: 124.71 } }, slips[1], slips[2]];
    expect(rendered({ data: { ...DATA, payslips: s } })).not.toBe(want);
  });

  it('catches lindung dropped from dedTot — the v196 defect, where Gross − Deductions ≠ Net', () => {
    // The one-line regression this screen has actually shipped before (hros.html:3186). It changes no
    // other figure, so only the Deductions column and the footer total move.
    const s: Payslip[] = [{ ...slips[0], p: { ...slips[0].p, lindung: 30 } }, slips[1], slips[2]];
    expect(rendered({ data: { ...DATA, payslips: s } })).not.toBe(want);
    expect(dedTot(s[0])).toBe(dedTot(slips[0]) + 30);
  });

  it('catches an ad-hoc deduction dropped from a month', () => {
    const s: Payslip[] = [{ ...slips[0], d: { deductions: [] } }, slips[1], slips[2]];
    expect(rendered({ data: { ...DATA, payslips: s } })).not.toBe(want);
  });

  it('catches a footer total that stopped summing every month', () => {
    const s: Payslip[] = [slips[0], slips[1], { ...slips[2], p: { ...slips[2].p, net: 4820.11 } }];
    expect(rendered({ data: { ...DATA, payslips: s } })).not.toBe(want);
  });

  it('catches a changed value in the page-head chrome', () => {
    expect(rendered({ companyName: 'SKINDAE SDN BHD' })).not.toBe(want);
  });

  it('catches the error branch standing in for a loaded screen', () => {
    expect(rendered({ data: null, err: 'Not authorised' })).not.toBe(want);
  });

  it('catches a mis-wired download — every row handing over month 0', () => {
    // The mis-wiring R1 cannot see: the three rows are byte-identical apart from their figures, so a
    // button wired to the wrong index renders exactly the same and downloads the wrong month's pay.
    const calls: number[] = [];
    const got = reactHandlers(screen({ onDownload: ((i: number) => calls.push(i)) as never }));
    got.forEach((h) => h.invoke());
    expect(calls).toEqual([0, 1, 2]);
    // …and the golden agrees, via identArgs — which is exactly what quoted-only extraction would miss.
    expect(goldenHandlers(GOLDEN).map((h) => identArgs(h.raw))).toEqual([['0'], ['1'], ['2']]);
    expect(goldenHandlers(GOLDEN).map((h) => h.args)).toEqual([[], [], []]);
  });

  it('catches a dropped per-year panel, which no golden holds', () => {
    // The golden's fixture is a single year, so `years.length>1` never fires in it. Rendered against a
    // two-year history the panel must appear, with both years' totals — otherwise last year's earnings
    // silently vanish from the screen an employee checks them on.
    const twoYears: Payslip[] = [...slips, { ...slips[0], year: 2025 }];
    const html = renderToStaticMarkup(screen({ data: { ...DATA, payslips: twoYears } }));
    expect(html).toContain('Earnings by year');
    expect(html).toContain('>2025<');
    expect(html).toContain('>2026<');
    // …and it stays absent on the single-year fixture the golden holds.
    expect(renderToStaticMarkup(screen())).not.toContain('Earnings by year');
  });
});

describe('withholds what employee mode withholds', () => {
  // `payslip` is an HR_EMP_NAV view: one person's own pay, nothing else. These assert the gated
  // DIRECTION, so a future change that exposes something here fails in this file.
  const html = renderToStaticMarkup(screen());

  it('renders nothing but the caller\'s own months — no employee picker, no other person', () => {
    // Every legacy admin screen identifies a person with a `<select>` or an employee id; this screen has
    // neither, and `hr_my_payslips` is scoped to the caller by the server. If a picker ever appears
    // here, an employee could ask for someone else's pay.
    expect(html).not.toContain('<select');
    expect(html).not.toMatch(/hra_emp|emp_id|employee_id/);
    // The only names in the document are month names from the caller's own slips.
    const periods = [...html.matchAll(/<td><b>([A-Z][a-z]+ \d{4})<\/b><\/td>/g)].map((m) => m[1]);
    expect(periods).toEqual(['July 2026', 'June 2026', 'May 2026']);
  });

  it('renders no write control — the only buttons are the per-row PDF downloads', () => {
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(3);
    buttons.forEach((b) => expect(b).toContain('class="btn sm"'));
  });

  it('never renders the employer block the response carries for the PDF', () => {
    // `hr_my_payslips` returns `employer` (the company's statutory registration numbers, its address
    // and HR's contact details) and `leaveBal` for `hrEmpPayslipDownload()`'s PDF. The legacy screen
    // reads neither; rendering either would put data on screen that the screen this replaces withheld.
    // `name` is excluded because it is not withheld — it IS the company chip in the page head, which
    // `hrCompanyName()` puts there for every HR view.
    const employer = (FIXTURES.hr_my_payslips as unknown as { employer: Record<string, unknown> }).employer;
    const withheld = Object.entries(employer)
      .filter(([k, v]) => k !== 'name' && typeof v === 'string' && v.length > 3)
      .map(([, v]) => v as string);
    expect(withheld.length).toBeGreaterThan(4);          // the assertion below must not pass vacuously
    withheld.forEach((v) => expect(html).not.toContain(v));
    expect(html).not.toContain('Annual leave');          // leaveBal, the other PDF-only block
  });
});

describe('decodeTextAmp cannot hide a real change', () => {
  // The screen-local rule this file adds, held to ./parity.ts's own bar: it re-spells `&amp;` as `&` in
  // TEXT, and nothing else. Each case here fails if it ever widened.
  it('decodes only outside a tag', () => {
    expect(decodeTextAmp('<b title="a &amp; b">x &amp; y</b>')).toBe('<b title="a &amp; b">x & y</b>');
  });

  it('does not absorb a changed label', () => {
    expect(decodeTextAmp('EPF &amp; PCB')).not.toBe(decodeTextAmp('EPF &amp; EIS'));
  });

  it('does not absorb a dropped element', () => {
    expect(decodeTextAmp('a &amp; <b>x</b>')).not.toBe(decodeTextAmp('a &amp; '));
  });

  it('leaves hr-payroll\'s doubly-escaped named references alone', () => {
    expect(decodeTextAmp('&amp;ldquo;quoted&amp;rdquo; &amp;#39;')).toBe('&amp;ldquo;quoted&amp;rdquo; &amp;#39;');
  });

  it('is what the golden actually needs — without it, the two sides differ', () => {
    expect(relax(renderToStaticMarkup(screen()))).not.toBe(relax(GOLDEN));
  });
});
