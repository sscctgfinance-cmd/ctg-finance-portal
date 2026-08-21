// HR OS · Payroll Calculator — the React screen against the legacy screen's committed golden.
//
// `tests/golden/hr.calculator.html` was captured from `hrCalculator()` (hros.html:4870) by the
// 40-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts or tests/parity.ts. The component is rendered with `renderToStaticMarkup`
// from the SAME fixture the golden was captured from — tests/render_fixtures.ts, imported directly —
// normalised by the harness's own normalise(), relaxed by the documented layer in ./parity.ts, and
// compared.
//
// The result panel's figures are NOT hand-written into this test: it calls the real `calcCompute()`,
// which calls payroll.js. So the numbers in the golden are being produced by the statutory engine, not
// asserted against a transcription of it.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrCalculator, {
  CALC_INITIAL, calcCompute, calcPayslipDoc,
  type CalcEmployee, type CalcRates, type CalcState,
} from '../src/hr-calculator';
import { goldenSection, relax } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `hrCompanyName()` (hros.html:4445) resolves the chip in the page head to the selected company. */
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

/**
 * The `#hr` element is what `hrRender()` writes the page head and the screen body into (hros.html:1554).
 * The golden's other section, `#hr_nav`, is `hrSidebar()` — chrome for every HR view, not this screen.
 * report.md §3.5 puts it outside a screen-by-screen strangler.
 */
const GOLDEN = goldenSection('hr.calculator', 'hr');

/** `HR.data` — the bootstrap the harness loads before rendering any HR view. */
const BOOT = FIXTURES.hr_bootstrap as { employees: CalcEmployee[]; rates: CalcRates };

/** `HR_CALC` at first paint (hros.html:4752) — nothing typed, nothing picked, override closed. */
const STATE: CalcState = CALC_INITIAL;

const noop = () => {};

function screen(over: Partial<Parameters<typeof HrCalculator>[0]> = {}) {
  const state = over.state ?? STATE;
  return (
    <HrCalculator
      state={state}
      employees={BOOT.employees}
      result={calcCompute(state, BOOT.rates)}
      companyName={COMPANY_NAME}
      onPickEmp={noop}
      onInput={noop}
      onFlag={noop}
      onSetting={noop}
      onOverride={noop}
      onOvToggle={noop}
      onPayslip={noop}
      onSave={noop}
      onHistory={noop}
      {...over}
    />
  );
}

/**
 * ── THE ONE THING THIS SCREEN NEEDED THAT THE FOUR BEFORE IT DID NOT ────────────────────────────────
 *
 * `ln()` (hros.html:4837) writes TWO `style=` attributes onto the same amount span whenever a colour is
 * asked for:
 *
 *     <span style="font-size:13px" style="color:var(--coral-soft);font-size:13px">-RM 0.00</span>
 *
 * That is a duplicate attribute. The HTML tree-construction rules are explicit about it: it is a
 * parse error, and "the new attribute must be removed from the token" — the SECOND one never reaches the
 * DOM. So the colour on this panel has never been seen by an operator; every amount renders in the
 * default text colour. (That is the finding, and it is written up at src/hr-calculator.tsx's `Line`. It
 * is not fixed here: making the colour appear changes what the screen looks like, which is a separate,
 * visible change against hros.html, and the golden would move with it.)
 *
 * React cannot emit a duplicate attribute at all. So this applies the parser's own rule to BOTH sides
 * before comparing: on each start tag, an attribute whose name has already appeared is dropped. React's
 * side is unaffected — it has no duplicates to drop — so this is entirely about reading the legacy
 * string the way a browser reads it.
 *
 * WHAT IT CANNOT HIDE, which is the bar ./parity.ts sets for its own six:
 *   • a changed number — amounts are text content, untouched here;
 *   • a dropped row — rows are elements, untouched here;
 *   • a renamed label — text content, untouched here;
 *   • a missing attribute — the FIRST occurrence of every name survives on both sides and is compared
 *     verbatim. Only a REPEAT of a name already on the same tag is removed, and the browser removes it
 *     too. If React dropped `style` entirely, or emitted a different `style`, the golden's first one
 *     would still be there to diff against. `the comparison still bites` below proves exactly that.
 *
 * It lives HERE and not in ./tests/parity.ts because parity.ts is shared with sibling migrations in
 * flight and the brief puts it off limits. If a second screen hits a duplicate attribute, that is the
 * moment to move it — one screen is not evidence about the shared layer.
 */
function dedupeAttrs(html: string): string {
  return html.replace(/<([a-zA-Z][\w:.-]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>/g, (_m, tag: string, attrs: string, slash: string) => {
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const a of (attrs || '').matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) {
      const name = a[1].toLowerCase();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      kept.push(a[2] === undefined ? name : `${name}="${a[2]}"`);
    }
    return `<${tag}${kept.length ? ' ' + kept.join(' ') : ''}${slash}>`;
  });
}

/** Both sides read as the document a parser builds, then compared under ./parity.ts's six relaxations. */
const sameDocument = (html: string) => relax(dedupeAttrs(html));

const rendered = () => sameDocument(renderToStaticMarkup(screen()));

describe('HR Payroll Calculator — React vs the legacy golden', () => {
  it('renders the same document as hrCalculator() does', () => {
    expect(rendered()).toBe(sameDocument(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * What makes relaxation R1 safe on THIS screen. R1 drops `on*=` from the string comparison, so the
 * golden's `onchange="hrCF('bonus','socso',this.checked)"` would otherwise compare equal to a checkbox
 * wired to `('allowance','epf')` — which is the difference between excluding a bonus from SOCSO and
 * excluding a fixed allowance from EPF, on a screen whose whole job is deciding which pay item feeds
 * which statutory base. This puts the arguments back.
 *
 * Inline rather than in ./tests/handlers.ts because that file is shared with sibling migrations in
 * flight and the brief puts it off limits; it exports exactly the two halves this needs.
 */
function assertHandlerParity(over: Partial<Parameters<typeof HrCalculator>[0]> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({ attr, args: args.filter((a): a is string => typeof a === 'string' && a !== STUB_VALUE) });
  misfire = record('misfire');

  const got = reactHandlers(screen({
    onPickEmp: record('pickEmp') as never,
    onInput: record('input') as never,
    onFlag: record('flag') as never,
    onSetting: record('setting') as never,
    onOverride: record('override') as never,
    onOvToggle: record('ovToggle') as never,
    onPayslip: record('payslip') as never,
    onSave: record('save') as never,
    onHistory: record('history') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  // `onfocus="this.select()"` (hros.html:4872) is the one handler on this screen that calls no app
  // function — it is the browser selecting the field's own text, and it carries no row identity to get
  // wrong. It records nothing, so it is dropped from the ARGUMENT comparison. Its presence, its kind and
  // its position are still checked, by the attr-order assertion immediately above; dropping it there
  // instead would let a money input silently lose its select-on-focus.
  const wired = want.filter((h) => h.raw !== 'this.select()');
  expect(calls.map((c) => c.args)).toEqual(wired.map((h) => h.args));

  // Guard the guard: if the golden ever stops carrying handlers, the two `toEqual`s above pass
  // vacuously and R1 becomes the blind strip it is not allowed to be.
  expect(wired.length).toBeGreaterThan(0);
  expect(wired.some((h) => h.args.length > 0)).toBe(true);
}

describe('the comparison still bites', () => {
  // Relaxations are only defensible if they cannot absorb a real change. These are this SCREEN's real
  // risks — a statutory figure that is silently wrong, a base that quietly gains or loses a pay item,
  // a deduction row that disappears — not generic ones.
  const want = sameDocument(GOLDEN);
  const wrong = (over: Partial<Parameters<typeof HrCalculator>[0]>) => sameDocument(renderToStaticMarkup(screen(over)));
  const withState = (f: (s: CalcState) => CalcState) => wrong({ state: f(STATE) });

  it('catches a wrong statutory figure — one sen of EPF employee', () => {
    const res = calcCompute(STATE, BOOT.rates)!;
    expect(wrong({ result: { ...res, epfEe: 0.01 } })).not.toBe(want);
  });

  it('catches a wrong EPF employee RATE, which is only in the row label', () => {
    const res = calcCompute(STATE, BOOT.rates)!;
    expect(wrong({ result: { ...res, _eeRate: 0.09 } })).not.toBe(want);
  });

  it('catches a wrong SOCSO category, which is only in the row label', () => {
    const res = calcCompute(STATE, BOOT.rates)!;
    expect(wrong({ result: { ...res, _scat: 2 } })).not.toBe(want);
  });

  it('catches a statutory BASE that changed without any amount changing', () => {
    const res = calcCompute(STATE, BOOT.rates)!;
    expect(wrong({ result: { ...res, socsoWage: 3400 } })).not.toBe(want);
  });

  it('catches a deduction row that appeared — LINDUNG 24', () => {
    const res = calcCompute(STATE, BOOT.rates)!;
    expect(wrong({ result: { ...res, lindung: 22.85 } })).not.toBe(want);
  });

  it('catches a flag tick that flipped — bonus into the SOCSO base', () => {
    expect(withState((s) => ({ ...s, flags: { ...s.flags, bonus: { ...s.flags.bonus, socso: true } } }))).not.toBe(want);
  });

  it('catches a settings tick that flipped — EPF switched off', () => {
    expect(withState((s) => ({ ...s, settings: { ...s.settings, epfOn: false } }))).not.toBe(want);
  });

  it('catches a dropped row in the employee prefill picker', () => {
    expect(wrong({ employees: BOOT.employees.slice(0, 3) })).not.toBe(want);
  });

  it('catches a moved <select> selection, which R5 must not absorb', () => {
    expect(withState((s) => ({ ...s, settings: { ...s.settings, epfEeRate: '0.09' } }))).not.toBe(want);
  });

  it('catches a changed value in the page-head chrome', () => {
    expect(wrong({ companyName: 'SKINDAE SDN BHD' })).not.toBe(want);
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=` from the string comparison, so these are invisible to the diff above and are what
  // assertHandlerParity() exists for. Both are wrongs that cost money quietly: the markup is identical,
  // every tick is in the right place, and the wrong item's statutory base moves.

  it('catches a flag checkbox wired to the wrong pay item', () => {
    // Every cell in the grid reporting `allowance`: unticking "bonus → SOCSO" would exclude the fixed
    // ALLOWANCE from SOCSO instead, and the screen would look exactly right while doing it.
    expect(() => assertHandlerParity({
      onFlag: ((_item: string, flag: string) => misfire('allowance', flag)) as never,
    })).toThrow(/deeply equal/);   // the ARGUMENT assertion, not an incidental crash
  });

  it('catches a money input wired to the wrong field', () => {
    // `hrCI('zakat', …)` firing as `hrCI('basic', …)` would put a zakat figure into basic salary — which
    // feeds every statutory base on the screen.
    expect(() => assertHandlerParity({
      onInput: (() => misfire('basic')) as never,
    })).toThrow(/deeply equal/);
  });
});

/**
 * The recorder assertHandlerParity() installs, reached from the mis-wire cases above so they record the
 * WRONG arguments through the same path a real handler would. Assigned by assertHandlerParity on entry.
 */
let misfire: (...args: unknown[]) => void = () => {};

describe('the statutory figures come from payroll.js, not from a copy of it', () => {
  // The golden is captured with nothing typed, so every amount on it is RM 0.00 — the parity test above
  // would pass just as happily against arithmetic that is wrong for every real salary. These are the
  // gazetted anchors hros.html's own v159 comment cites as the reason this tab was made to share the
  // engine: the pre-v155 midpoint × rate formula gave 60.40 here and 60.35 on the payslip.
  const at = (basic: number) => calcCompute({ ...STATE, inp: { ...STATE.inp, basic } }, BOOT.rates)!;

  it('reads the PERKESO Second Schedule and the EIS table at RM3,500', () => {
    const r = at(3500);
    expect([r.socsoEe, r.socsoEr]).toEqual([17.25, 60.35]);
    expect([r.eisEe, r.eisEr]).toEqual([6.90, 6.90]);
  });

  it('rounds EPF the way hrEpfParts does — up to the ringgit, on the RM20-step wage', () => {
    const r = at(3500);
    expect([r.epfEe, r.epfEr]).toEqual([385, 455]);
    expect([r._eeRate, r._erRate]).toEqual([0.11, 0.13]);
  });

  it('refuses to quote anything at all until the statutory rates have loaded', () => {
    expect(calcCompute(STATE, null)).toBeNull();
  });
});

describe('dedupeAttrs cannot hide a real change', () => {
  // The seventh rule this screen adds, held to ./parity.ts's own bar: it drops a duplicate attribute
  // name, and NOTHING else. Each case here fails if it ever widened.
  it('drops only the SECOND attribute of a repeated name', () => {
    expect(dedupeAttrs('<span style="a" style="b">x</span>')).toBe('<span style="a">x</span>');
  });

  it('leaves a tag with no duplicates completely alone', () => {
    expect(dedupeAttrs('<input type="checkbox" checked style="c">')).toBe('<input type="checkbox" checked style="c">');
  });

  it('does not absorb a CHANGED first attribute', () => {
    expect(dedupeAttrs('<span style="a" style="b">')).not.toBe(dedupeAttrs('<span style="z" style="b">'));
  });

  it('does not absorb a MISSING attribute', () => {
    expect(dedupeAttrs('<span style="a" style="b">')).not.toBe(dedupeAttrs('<span>'));
  });

  it('does not absorb changed text', () => {
    expect(dedupeAttrs('<span style="a" style="b">-RM 0.00</span>'))
      .not.toBe(dedupeAttrs('<span style="a" style="b">-RM 1.00</span>'));
  });

  it('is load-bearing: the golden really does carry duplicate style attributes', () => {
    expect(relax(GOLDEN)).not.toBe(sameDocument(GOLDEN));
  });
});

/**
 * THE PAYSLIP THE CALCULATOR EXPORTS — no golden sees a PDF.
 *
 * `hrCalcPayslip()` (hros.html:4890) hands `hrDrawPayslip()` four objects built from the calculator's
 * own state. The parity diff above proves the 📄 Payslip button exists and is wired; it says nothing
 * about what is on the page. `calcPayslipDoc()` is that mapping as a pure function of a Date it is
 * HANDED — hr.yearend's rule, because the legacy one stamps the document with the month it is RUN in —
 * and these are the cases that fail if it drifts. The drawing itself is hr-docs.js's and is not
 * re-expressed on this side at all.
 */
describe('the payslip the calculator exports', () => {
  const EMP: CalcEmployee = { id: 'e9', emp_no: 'T009', name: 'TEST NINE', ic_no: '961008-02-6006', position: 'Pharmacist', dept: 'Retail' };
  const STATE_WITH = {
    ...STATE,
    empId: 'e9',
    inp: { ...STATE.inp, basic: '3500', allowance: '200', claim: '150', bonus: '1000', deduction: '80' },
  } as CalcState;
  const NOW = new Date('2026-08-18T09:30:00.000Z');
  const res = () => calcCompute(STATE_WITH, BOOT.rates)!;

  it('prints the SELECTED employee, not the ad-hoc placeholder', () => {
    const d = calcPayslipDoc(STATE_WITH, res(), EMP, NOW);
    expect(d.e).toMatchObject({ empNo: 'T009', name: 'TEST NINE', ic: '961008-02-6006', position: 'Pharmacist', dept: 'Retail' });
    expect(d.fileName).toBe('Payroll_Calc_T009.pdf');
  });

  it('an ad-hoc calculation is labelled as one and never carries a stale employee', () => {
    const d = calcPayslipDoc(STATE_WITH, res(), null, NOW);
    expect(d.e).toMatchObject({ empNo: 'CALC', name: 'Payroll Calculation', ic: '', position: '', dept: '' });
    expect(d.fileName).toBe('Payroll_Calc_adhoc.pdf');
  });

  it('the printed deductions explain the printed net — the invariant a payslip has to hold', () => {
    // tests/lindung_reporting_test.ts is the Deno half of this: a money component that reaches net pay
    // must reach the document. Here the risk is the OPPOSITE direction — `gross` is `res.gross +
    // res.claim` because the engine leaves a reimbursed claim out of gross, and dropping that `+ claim`
    // prints a gross the deductions no longer reconcile to.
    const r = res();
    const d = calcPayslipDoc(STATE_WITH, r, EMP, NOW);
    const gross = d.p.gross as number;
    const listed = r.epfEe + r.socsoEe + r.lindung + r.eisEe + r.pcb + r.deduction;
    // `net` already carries the claim back in (hr-calculator.tsx's `+ claim`), so the payslip's gross
    // minus its printed deductions IS the net — plus zakat, which reduces MTD and is then deducted
    // again from net rather than being one of the lines above.
    expect(Math.round((gross - listed) * 100) / 100).toBe(Math.round((r.net + r.zakat) * 100) / 100);
    // Guard the guard: the fixture really does carry a claim, so `+ res.claim` is load-bearing here.
    expect(r.claim).toBeGreaterThan(0);
    expect(gross).not.toBe(r.gross);
  });

  it('the claim is paid as an allowance and the calculator allowance is the header figure', () => {
    // Two different fields with confusable names, mirrored from hros.html:4896-4897. Swapping them
    // moves RM150 of reimbursement into the fixed-salary header and RM200 of salary into the payslip's
    // allowance line — the totals still add up, so nothing on screen looks wrong.
    const d = calcPayslipDoc(STATE_WITH, res(), EMP, NOW);
    expect(d.e.allowance).toBe(200);
    expect(d.d.allowance).toBe(150);
    expect(d.d.bonus).toBe(1000);
    expect(d.d.deductions).toEqual([{ label: 'Deduction', amount: 80 }]);
  });

  it('a zero deduction is NO deduction line, not a line reading zero', () => {
    const zero = { ...STATE_WITH, inp: { ...STATE_WITH.inp, deduction: '' } } as CalcState;
    expect(calcPayslipDoc(zero, calcCompute(zero, BOOT.rates)!, EMP, NOW).d.deductions).toEqual([]);
  });

  it('the period is the month the payslip is RUN in, and it is a parameter', () => {
    expect(calcPayslipDoc(STATE_WITH, res(), EMP, NOW).period).toEqual({ month: 8, year: 2026, label: 'August 2026' });
    expect(calcPayslipDoc(STATE_WITH, res(), EMP, new Date('2025-01-09T12:00:00.000Z')).period)
      .toEqual({ month: 1, year: 2025, label: 'January 2025' });
  });

  it('the statutory meta the drawer prints is the engine’s own, not re-derived', () => {
    const r = res();
    const meta = (calcPayslipDoc(STATE_WITH, r, EMP, NOW).p as { _meta: Record<string, unknown> })._meta;
    expect(meta.epfEeRate).toBe(r._eeRate);
    expect(meta.epfErRate).toBe(r._erRate);
    expect(meta.socsoCat).toBe(r._scat);
    // hros.html:4896 — a non-resident is PCB category 0, everyone else 1.
    expect(meta.pcbCat).toBe(1);
    const nonRes = { ...STATE_WITH, settings: { ...STATE_WITH.settings, resident: false } } as CalcState;
    expect((calcPayslipDoc(nonRes, calcCompute(nonRes, BOOT.rates)!, EMP, NOW).p as { _meta: { pcbCat: number } })._meta.pcbCat).toBe(0);
  });
});
