// HR OS · Payroll — the React screen against the legacy screen's committed golden.
//
// `tests/golden/hr.payroll.html` was captured from `hrPayroll()` (hros.html:4057) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts,
// tests/parity.ts or tests/handlers.ts. The component is rendered with `renderToStaticMarkup` from the
// SAME fixture the golden was captured from — tests/render_fixtures.ts, imported directly — normalised
// by the harness's own normalise(), relaxed by the documented layer in ./parity.ts, and compared.
//
// Every figure in the grid is produced by the real engine: this test calls `gridInit()` and `gridAll()`,
// which call `hrCompute` in payroll.js. Nothing is transcribed.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrPayroll, {
  HR_TP1_CATS, dueInfo, gridAll, gridInit, gridState, tp1Body,
  type GridRow, type HubKey, type PayData, type PayEmployee, type PayrollRun, type Tp1Line, type Tp1State,
} from '../src/hr-payroll';
import { goldenSection, relax } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `hrCompanyName()` (hros.html:4445) resolves the chip in the page head to the selected company. */
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

/**
 * The `#hr` element is what `hrRender()` writes the page head and the screen body into (hros.html:1554).
 * The golden's other section, `#hr_nav`, is `hrSidebar()` — chrome for every HR view, not this screen.
 */
const GOLDEN = goldenSection('hr.payroll', 'hr');

const DATA = FIXTURES.hr_payroll_data as PayData;
const PERIOD = { month: 8, year: 2026 };

/**
 * `hr_payroll_runs_list` — the same answer the golden was captured under, so the 📋 panel is built
 * from the fixture rather than hand-written. `HR.pay.runsOpen` is false on first paint, which is the
 * state in `tests/golden/hr.payroll.html`; the EXPANDED table is its own surface
 * (`tests/golden/hr.payroll_runs.html`) and is driven separately below.
 */
const RUNS = (FIXTURES.hr_payroll_runs_list as { runs: PayrollRun[] }).runs;

/**
 * THE CLOCK, PINNED. `hrDueInfo()` (hros.html:3831) computes "· 28 days left" from `new Date()`, so the
 * golden's due line is a function of the instant it was captured at (tests/render_harness.ts:19,
 * `FIXED_MS`). The component does not read the clock — `dueInfo()` is a pure function of a Date it is
 * handed — and this is that instant, copied rather than imported for the same reason ./parity.ts lifts
 * normalise() out by text: render_harness.ts is the Deno harness and Node cannot load it.
 *
 * Not a relaxation: it changes the INPUT the React side is built from, not what counts as a match, and
 * the derivation stays under test — `catches a due date that drifted` below moves it.
 */
const NOW = new Date('2026-08-18T09:30:00.000Z');

/** `hrGridInit()` and `hrGridAll()`, run exactly as the app runs them. */
const GRID: Record<string, GridRow> = gridInit(DATA);
const ALL = gridAll(DATA, GRID, PERIOD);

const noop = () => {};

type Props = Parameters<typeof HrPayroll>[0];

function screen(over: Partial<Props> = {}) {
  const grid = over.grid ?? GRID;
  const all = over.rows && over.tot ? { rows: over.rows, tot: over.tot } : gridAll(DATA, grid, PERIOD);
  return (
    <HrPayroll
      companyName={COMPANY_NAME}
      month={PERIOD.month}
      year={PERIOD.year}
      grid={grid}
      rows={all.rows}
      tot={all.tot}
      skipped={(DATA.employees || []).filter((e: PayEmployee) => grid[e.id]?.skip)}
      locked={false}
      finalised={false}
      state={gridState(DATA.run || null, false)}
      ticks={{}}
      runs={RUNS}
      uob={{}}
      due={dueInfo(PERIOD.month, PERIOD.year, NOW)}
      onPickPeriod={noop}
<<<<<<< HEAD
      onRatesToggle={noop}
      onRatesSave={noop}
      onEmployerToggle={noop}
      onEmployerLogoPick={noop}
      onEmployerLogoClear={noop}
      onEmployerSave={noop}
      onStatIdsOpen={noop}
      onStatIdsClose={noop}
      onStatIdsCell={noop}
      onStatIdsSave={noop}
=======
      onRunsToggle={noop}
      onRunOpen={noop}
      onLegacyPanel={noop}
>>>>>>> origin/main
      onGridSave={noop}
      onFinalise={noop}
      onEditFinalised={noop}
      onRowMenu={noop}
      onCell={noop}
      onPcbCell={noop}
      onPcbAuto={noop}
      onDedOpen={noop}
      onDedAdd={noop}
      onDedDel={noop}
      onDedLabel={noop}
      onDedAmt={noop}
      onSkip={noop}
      onResign={noop}
      onEmpDelete={noop}
      onSubmitAll={noop}
      onUobSave={noop}
      onExpBank={noop}
      onExpGiro={noop}
      onExpKwsp={noop}
      onExpAssist={noop}
      onExpCp39={noop}
      onPostXero={noop}
      onExpSummary={noop}
      onExpPayslips={noop}
      onEmailAll={noop}
      onExpStatutory={noop}
      onHubTick={noop}
      {...over}
    />
  );
}

/**
 * ── THE ONE THING THIS SCREEN NEEDED THAT THE EIGHT BEFORE IT DID NOT ───────────────────────────────
 *
 * The Payment & Statutory Hub quotes UOB's and LHDN's own wording, and hros.html writes the typographic
 * quotes as NAMED CHARACTER REFERENCES inside its HTML string (hros.html:4035, :4038, :4041):
 *
 *     file type <b>&ldquo;IBG Payroll with Payment Advice (Employee)&rdquo;</b>. … UOB&rsquo;s one-time
 *
 * so the golden carries the eight characters `&ldquo;` rather than the character “. React's text escaper
 * emits only `&`, `<`, `>`, `"` and `'` as references — a “ in JSX is written out as the character
 * itself, and writing the string "&ldquo;" would produce `&amp;ldquo;`. There is no way to make React
 * emit the golden's bytes for these three, and the shared normaliser does not decode entities.
 *
 * This is the same KIND of difference ./parity.ts's R6 already absorbs — one character, two spellings of
 * it — so it is handled the same way, by decoding to the character on BOTH sides. R6 itself is not
 * widened: ./parity.ts is shared with sibling migrations and the brief puts it off limits, and one
 * screen is not evidence about the shared layer. If a second screen quotes a portal, that is the moment
 * to move this.
 *
 * WHAT IT CANNOT HIDE, which is the bar ./parity.ts sets for its own six:
 *   • a changed number — `&ldquo;` `&rdquo;` `&rsquo;` are the only sequences touched, and no number is
 *     spelled with them;
 *   • a dropped row — rows are elements, untouched here;
 *   • a renamed label — every other character of the text survives verbatim, on both sides;
 *   • a missing attribute — attributes are untouched; this runs on the whole document as text, replacing
 *     one fixed literal with one fixed character, symmetrically.
 * The `decodeNamedRefs cannot hide a real change` block below fails if it ever widened.
 */
function decodeNamedRefs(html: string): string {
  return html.replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&rsquo;/g, '’');
}

/** Both sides read as the same document, then compared under ./parity.ts's six relaxations. */
const sameDocument = (html: string) => relax(decodeNamedRefs(html));

const rendered = (over: Partial<Props> = {}) => sameDocument(renderToStaticMarkup(screen(over)));

describe('HR Payroll — React vs the legacy golden', () => {
  it('renders the same document as hrPayroll() does', () => {
    expect(rendered()).toBe(sameDocument(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * What makes relaxation R1 safe on THIS screen — and it matters more here than on any screen so far.
 *
 * R1 drops `on*=` from the string comparison. Every editable cell in this grid is per-employee:
 * `oninput="hrGridCell('e2','bonus',this.value)"` and `oninput="hrGridPcbCell('e2',this.value)"` are
 * byte-identical in stripped output to the same cells wired to `'e1'`. That is a bonus typed against the
 * wrong person and a PCB override landing on the wrong employee's payslip — the markup looks perfect
 * while the money moves. `onclick="hrGRowMenu('e3')"` is the same defect with the remove/skip/resign
 * menu behind it. This puts the arguments back.
 *
 * It also compares the FUNCTION each handler stands for, derived from the golden's own text through
 * LEGACY_TO_PROP, because four of this screen's buttons (⚙️ Rates, 🏢 Company, 🆔 Statutory numbers,
 * 🧾 TP1) carry no arguments at all — argument parity alone cannot tell them apart, and the Company
 * button opening the rates editor would pass. Since v222 that also catches 🧾 TP1 reverting to the
 * legacy handoff: it maps to the real opener, not to `legacy:tp1`. That is a strict widening of ./tests/handlers.ts's
 * default, and it lives here rather than there because handlers.ts is shared with sibling migrations.
 *
 * Inline rather than in ./tests/handlers.ts for the same reason: that file exports exactly the two
 * halves this needs.
 */
const LEGACY_TO_PROP: Record<string, string> = {
  hrPickPeriod: 'pickPeriod',
<<<<<<< HEAD
  // v225: all three record editors are migrated, so these are real openers rather than handoffs — the
  // same change v222 made for TP1. A Company button that reverted to the notice, or that opened the
  // rates editor, fails here and nowhere else: neither carries an argument.
  hrEmployerToggle: 'employerToggle',
  hrRatesToggle: 'ratesToggle',
  hrStatIdsOpen: 'statIdsOpen',
=======
  hrRunsToggle: 'runsToggle',
  hrEmployerToggle: 'legacy:employer',
  hrRatesToggle: 'legacy:rates',
  hrStatIdsOpen: 'legacy:statids',
>>>>>>> origin/main
  hrTp1Open: 'tp1Open',   // v222: the TP1 panel is migrated, so this is no longer a legacy handoff
  hrGridSave: 'gridSave',
  hrFinalise: 'finalise',
  hrGRowMenu: 'rowMenu',
  hrGridCell: 'cell',
  hrDedOpen: 'dedOpen',
  hrGridPcbCell: 'pcbCell',
  hrGridPcbAuto: 'pcbAuto',
  hrSubmitAll: 'submitAll',
  hrUobCfgSave: 'uobSave',
  hrExpBank: 'expBank',
  hrExpGiro: 'expGiro',
  hrExpKwsp: 'expKwsp',
  hrExpAssist: 'expAssist',
  hrExpCp39: 'expCp39',
  hrHubTick: 'hubTick',
  hrExpSummary: 'expSummary',
  hrExpPayslips: 'expPayslips',
  hrEmailAll: 'emailAll',
  hrExpStatutory: 'expStatutory',
};

function assertHandlerParity(over: Partial<Props> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({ attr, args: args.filter((a): a is string => typeof a === 'string' && a !== STUB_VALUE) });
  misfire = record('misfire');

  const got = reactHandlers(screen({
    onPickPeriod: record('pickPeriod') as never,
<<<<<<< HEAD
    onRatesToggle: record('ratesToggle') as never,
    onEmployerToggle: record('employerToggle') as never,
    onStatIdsOpen: record('statIdsOpen') as never,
=======
    onRunsToggle: record('runsToggle') as never,
    onRunOpen: record('runOpen') as never,
    // The panel key travels in the ATTR, not the args: the golden's `hrEmployerToggle()` carries no
    // argument, so putting 'employer' in the args would be comparing against something that is not there.
    onLegacyPanel: ((k: string) => calls.push({ attr: 'legacy:' + k, args: [] })) as never,
>>>>>>> origin/main
    onGridSave: record('gridSave') as never,
    onFinalise: record('finalise') as never,
    onRowMenu: record('rowMenu') as never,
    onCell: record('cell') as never,
    onDedOpen: record('dedOpen') as never,
    onPcbCell: record('pcbCell') as never,
    onPcbAuto: record('pcbAuto') as never,
    onTp1Open: record('tp1Open') as never,
    onSubmitAll: record('submitAll') as never,
    onUobSave: record('uobSave') as never,
    onExpBank: record('expBank') as never,
    onExpGiro: record('expGiro') as never,
    onExpKwsp: record('expKwsp') as never,
    onExpAssist: record('expAssist') as never,
    onExpCp39: record('expCp39') as never,
    onHubTick: record('hubTick') as never,
    onExpSummary: record('expSummary') as never,
    onExpPayslips: record('expPayslips') as never,
    onEmailAll: record('emailAll') as never,
    onExpStatutory: record('expStatutory') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  // `onfocus="this.select()"` (hros.html:3768) is the one handler on this screen that calls no app
  // function — the browser selecting the field's own text. It records nothing, so it is dropped from the
  // comparisons below. Its presence, kind and position are still checked by the assertion above;
  // dropping it there instead would let a money cell silently lose its select-on-focus.
  const wired = want.filter((h) => h.raw !== 'this.select()');
  expect(calls.map((c) => c.args)).toEqual(wired.map((h) => h.args));
  expect(calls.map((c) => c.attr)).toEqual(wired.map((h) => LEGACY_TO_PROP[h.raw.replace(/\(.*$/, '')] ?? h.raw));

  // Guard the guard: if the golden ever stops carrying handlers, the assertions above pass vacuously
  // and R1 becomes the blind strip it is not allowed to be.
  expect(wired.length).toBeGreaterThan(0);
  expect(wired.some((h) => h.args.length > 0)).toBe(true);
}

/**
 * The recorder assertHandlerParity() installs, reached from the mis-wire cases below so they record the
 * WRONG arguments through the same path a real handler would. Assigned by assertHandlerParity on entry.
 */
let misfire: (...args: unknown[]) => void = () => {};

describe('the comparison still bites', () => {
  // This SCREEN's real risks, not generic ones: a statutory figure that is silently wrong, a row that
  // vanishes from a run, a total that stops agreeing with its rows, a due date that drifts.
  const want = sameDocument(GOLDEN);
  const withGrid = (f: (g: Record<string, GridRow>) => Record<string, GridRow>) =>
    rendered({ grid: f(structuredClone(GRID)) });

  it('catches one sen of EPF on one employee', () => {
    const all = gridAll(DATA, GRID, PERIOD);
    const rows = all.rows.map((r, i) => (i === 1 ? { ...r, p: { ...r.p, epfEe: r.p.epfEe + 0.01 } } : r));
    expect(rendered({ rows, tot: all.tot })).not.toBe(want);
  });

  it('catches a PCB figure that changed on one row only', () => {
    const all = gridAll(DATA, GRID, PERIOD);
    const rows = all.rows.map((r, i) => (i === 0 ? { ...r, p: { ...r.p, pcb: 126.9 } } : r));
    expect(rendered({ rows, tot: all.tot })).not.toBe(want);
  });

  it('catches a total that stopped agreeing with its rows', () => {
    const all = gridAll(DATA, GRID, PERIOD);
    expect(rendered({ rows: all.rows, tot: { ...all.tot, net: all.tot.net - 0.05 } })).not.toBe(want);
  });

  it('catches an employee dropped out of the run by a stray skip', () => {
    // v205's own failure mode: `skip` is silent by design, so a row that gains one loses its payslip,
    // its bank line and its statutory contribution with nothing in the markup shouting about it.
    expect(withGrid((g) => ({ ...g, e2: { ...g.e2, skip: true } }))).not.toBe(want);
  });

  it('catches a typed figure that changed in one cell', () => {
    expect(withGrid((g) => ({ ...g, e1: { ...g.e1, bonus: 100 } }))).not.toBe(want);
  });

  it('catches a PCB override appearing where the golden has none', () => {
    // A pinned PCB turns the cell amber, un-hides ↺ and freezes the figure — money, not decoration.
    expect(withGrid((g) => ({ ...g, e3: { ...g.e3, pcbSet: 55 } }))).not.toBe(want);
  });

  it('catches an itemised deduction that disappeared', () => {
    expect(withGrid((g) => ({ ...g, e1: { ...g.e1, deductions: [] } }))).not.toBe(want);
  });

  it('catches a statutory badge that changed — EPF rate or SOCSO category', () => {
    const all = gridAll(DATA, GRID, PERIOD);
    const rows = all.rows.map((r, i) => (i === 0 ? { ...r, p: { ...r.p, _meta: { ...r.p._meta, socsoCat: 2 } } } : r));
    expect(rendered({ rows, tot: all.tot })).not.toBe(want);
  });

  it('catches a due date that drifted — the derivation the clock feeds', () => {
    expect(rendered({ due: dueInfo(PERIOD.month, PERIOD.year, new Date('2026-09-10T09:30:00.000Z')) })).not.toBe(want);
  });

  it('catches the grid-state chip changing to a saved draft', () => {
    expect(rendered({ state: gridState({ status: 'draft', entries_saved_at: '2026-08-17T02:00:00.000Z' }, false) })).not.toBe(want);
  });

  it('catches a checklist tick that was already on', () => {
    expect(rendered({ ticks: { epf: true } as Partial<Record<HubKey, boolean>> })).not.toBe(want);
  });

  it('catches a changed value in the page-head chrome', () => {
    expect(rendered({ companyName: 'SKINDAE SDN BHD' })).not.toBe(want);
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=` from the string comparison, so every one of these is invisible to the diff above
  // and is what assertHandlerParity() exists for. All three cost money silently: the markup is perfect.

  it('catches a row action fired against the wrong employee', () => {
    // The brief's named risk. `hrGRowMenu('e3')` firing as `hrGRowMenu('e1')` puts the ⋯ menu — skip,
    // mark resigned, DELETE — behind the wrong person's row, with their name on the panel it opens.
    expect(() => assertHandlerParity({
      onRowMenu: (() => misfire('e1')) as never,
    })).toThrow(/deeply equal/);   // the ARGUMENT assertion, not an incidental crash
  });

  it('catches a PCB cell wired to the wrong employee', () => {
    // An edited PCB reaching `hrGridPcbCell('e1', …)` from row e2 overrides the wrong person's MTD, and
    // the server then recomputes to that figure and writes it onto their payslip.
    expect(() => assertHandlerParity({
      onPcbCell: (() => misfire('e1')) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches a money cell wired to the wrong field', () => {
    // `hrGridCell('e1','unpaid', …)` firing as `('e1','basic', …)` would type an unpaid-leave figure
    // into basic salary, which feeds every statutory base on the row.
    expect(() => assertHandlerParity({
      onCell: ((id: string) => misfire(id, 'basic')) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches a checklist tick wired to the wrong statutory file', () => {
    expect(() => assertHandlerParity({
      onHubTick: (() => misfire('epf')) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches the 🏢 Company button opening the rates editor instead', () => {
    // Neither button carries an argument in the golden, so this is invisible to argument parity — it is
    // the case LEGACY_TO_PROP was added for.
    expect(() => assertHandlerParity({
      onEmployerToggle: (() => misfire()) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches ⚙️ Rates or 🆔 Statutory numbers reverting to the legacy handoff', () => {
    // Same shape, for the other two editors: a button that stopped calling its own opener records a
    // different PROP under the same empty argument list.
    expect(() => assertHandlerParity({ onRatesToggle: (() => misfire()) as never })).toThrow(/deeply equal/);
    expect(() => assertHandlerParity({ onStatIdsOpen: (() => misfire()) as never })).toThrow(/deeply equal/);
  });
});

describe('the statutory figures come from payroll.js, not from a copy of it', () => {
  // The golden pins these to the sen, but only for this fixture. These are the gazetted anchors, read
  // straight off the PERKESO Second Schedule and the EIS table, through the engine the legacy screen
  // uses. If gridRowCompute() ever stopped calling hrCompute, these are what would notice.
  const row = (id: string) => ALL.rows.find((r) => r.e.id === id)!;

  it('quotes SITI (basic 3,400 + allow 250 + bonus 500) ex-bonus for SOCSO and EIS', () => {
    // v180: the Employees' Social Security Act 1969 wage definition excludes bonus; EIS shares it. So
    // SOCSO/EIS are read at 3,650 while EPF is read on the full 4,150.
    const r = row('e2').p;
    expect([r.socsoEe, r.eisEe]).toEqual([18.25, 7.30]);
    expect(r.epfEe).toBe(458);
  });

  it('applies LINDUNG 24 to SITI and not to the other two', () => {
    expect(row('e2').p.lindung).toBeGreaterThan(0);
    expect([row('e1').p.lindung, row('e3').p.lindung]).toEqual([0, 0]);
  });

  it('totals what the rows hold, to the sen', () => {
    const sum = (f: (n: typeof ALL.rows[number]) => number) => ALL.rows.reduce((s, r) => s + f(r), 0);
    expect(ALL.tot.net).toBeCloseTo(sum((r) => r.p.net), 10);
    expect(ALL.tot.pcb).toBeCloseTo(sum((r) => r.p.pcb), 10);
  });

  it('pins a typed PCB override to exactly the figure typed, not the computed one', () => {
    const g = structuredClone(GRID);
    g.e1.pcbSet = 1;
    const one = gridAll(DATA, g, PERIOD).rows.find((r) => r.e.id === 'e1')!.p;
    expect(one.pcb).toBe(1);
    expect(one.net).toBeCloseTo(row('e1').p.net + row('e1').p.pcb - 1, 10);
  });

  it('takes a skipped employee out of the totals entirely', () => {
    const g = structuredClone(GRID);
    g.e2.skip = true;
    const A2 = gridAll(DATA, g, PERIOD);
    expect(A2.rows.map((r) => r.e.id)).toEqual(['e1', 'e3']);
    expect(A2.tot.net).toBeCloseTo(ALL.tot.net - row('e2').p.net, 10);
  });
});

describe('decodeNamedRefs cannot hide a real change', () => {
  // The seventh rule this screen adds, held to ./parity.ts's own bar: it maps three named references to
  // the characters they denote, and NOTHING else. Each case here fails if it ever widened.
  it('decodes exactly the three references, on both sides alike', () => {
    expect(decodeNamedRefs('a&ldquo;b&rdquo;c&rsquo;d')).toBe('a“b”c’d');
  });

  it('leaves every other entity alone — &amp; in particular', () => {
    expect(decodeNamedRefs('Pay &amp; Transfer &lt;b&gt; &#39;')).toBe('Pay &amp; Transfer &lt;b&gt; &#39;');
  });

  it('does not absorb a changed number', () => {
    expect(decodeNamedRefs('&ldquo;RM 1.00&rdquo;')).not.toBe(decodeNamedRefs('&ldquo;RM 2.00&rdquo;'));
  });

  it('does not absorb a renamed label', () => {
    expect(decodeNamedRefs('&ldquo;EPF Payment&rdquo;')).not.toBe(decodeNamedRefs('&ldquo;EIS Payment&rdquo;'));
  });

  it('does not absorb a missing attribute or a dropped element', () => {
    expect(decodeNamedRefs('<b style="a">&ldquo;x&rdquo;</b>')).not.toBe(decodeNamedRefs('<b>&ldquo;x&rdquo;</b>'));
    expect(decodeNamedRefs('<b>&ldquo;x&rdquo;</b>')).not.toBe(decodeNamedRefs('&ldquo;x&rdquo;'));
  });

  it('is load-bearing: the golden really does carry named references', () => {
    expect(relax(GOLDEN)).not.toBe(sameDocument(GOLDEN));
  });
});

/**
 * 🧾 TP1 RELIEFS and the SUBMISSION-PACK TRACKER — the two regions of this screen no golden reaches.
 *
 * `hrTp1Panel()` returns `''` unless `HR_TP1.open` (hros.html:3879), and `HR.submitPack` is null until
 * Submit all has built the ZIP and is reset by every period change (hros.html:4375). Neither can appear
 * in a captured surface, so these cases are their whole coverage — and both matter beyond markup: a TP1
 * line changes what LHDN is paid for that person every month from its effective month, and the tracker
 * is what an operator reads to decide which files they still have to upload.
 */
describe('the TP1 relief panel', () => {
  const TP1 = {
    year: 2026,
    empId: null as string | null,
    lines: [] as Tp1Line[],
    effMonth: 1,
    note: '',
    employees: DATA.employees || [],
  };
  const html = (over: Partial<Tp1State> = {}) => renderToStaticMarkup(screen({ tp1: { ...TP1, ...over } }));

  it('is closed by default — which is why no golden holds it', () => {
    expect(renderToStaticMarkup(screen())).not.toContain('TP1 relief declarations');
    expect(html()).toContain('TP1 relief declarations -- 2026');
  });

  it('shows the picker and NOTHING else until an employee is chosen', () => {
    const shut = html();
    expect(shut).toContain('-- pick an employee --');
    expect(shut).not.toContain('+ Add relief');
    expect(shut).not.toContain('Save TP1');
    // Guard the guard: the fixture really does have employees to pick.
    expect(TP1.employees.length).toBeGreaterThan(0);
    expect(shut).toContain(String(TP1.employees[0].name));
  });

  it('offers every LHDN relief category, not a shortened list', () => {
    const open = html({ empId: TP1.employees[0].id, lines: [{ category: 'lifestyle', amount: 0, note: '' }] });
    // `&` is compared in its escaped form: hros.html:3889 interpolates the label without esc(), so the
    // legacy emits a bare `&` and React always emits `&amp;`. No golden covers this panel, so that is a
    // note rather than a relaxation — the same finding hr-payslip's decodeTextAmp exists for.
    for (const [, label] of HR_TP1_CATS) expect(open).toContain(label.replace('&', '&amp;'));
    expect(HR_TP1_CATS.length).toBe(12);
  });

  it('the total is the sum of the declared lines', () => {
    const open = html({
      empId: TP1.employees[0].id,
      lines: [{ category: 'lifestyle', amount: 2500, note: '' }, { category: 'sspn', amount: 800.5, note: 'ref' }],
    });
    expect(open).toContain('<b id="tp1_total">RM 3,300.50</b>');
  });

  it('the POST drops a zero line — an unfilled row is not a declaration of RM0', () => {
    const body = tp1Body({ ...TP1, empId: 'e1', lines: [
      { category: 'lifestyle', amount: 2500, note: 'receipt' },
      { category: 'medical', amount: 0, note: '' },
      { category: 'sspn', amount: -5, note: '' },
    ] }) as Record<string, unknown>;
    expect(body.items).toEqual([{ category: 'lifestyle', amount: 2500, note: 'receipt' }]);
    expect(body).toMatchObject({ api: 'hr_tp1_save', employee_id: 'e1', year: 2026, effective_month: 1 });
  });

  it('the POST names the employee and NOTHING that could aim it at another company', () => {
    const body = tp1Body({ ...TP1, empId: 'e1', lines: [{ category: 'lifestyle', amount: 1, note: '' }] }) as Record<string, unknown>;
    for (const k of Object.keys(body)) expect(k).not.toMatch(/tenant|company|org/i);
  });

  it('refuses to post with no employee picked', () => {
    expect(tp1Body({ ...TP1, empId: null })).toEqual({ error: 'Pick an employee first' });
  });

  it('the effective month is what the panel shows, and it is sent as a number', () => {
    const open = html({ empId: TP1.employees[0].id, effMonth: 7, lines: [{ category: 'lifestyle', amount: 1, note: '' }] });
    expect(open).toContain('<option value="7" selected="">July</option>');
    expect((tp1Body({ ...TP1, empId: 'e1', effMonth: 7, lines: [{ category: 'lifestyle', amount: 1, note: '' }] }) as Record<string, unknown>).effective_month).toBe(7);
  });
});

describe('the submission-pack tracker', () => {
  const PACK = {
    per: 'July 2026',
    items: [
      { key: 'salary' as HubKey, label: 'Salaries (UOB Infinity)', file: { name: 'CTG_UOB_July2026.csv', count: 3, total: 9450.25 } },
      { key: 'pcb' as HubKey, label: 'PCB — LHDN CP39', file: { name: 'CTG_CP39_July2026.txt', count: 2, total: 161.35 } },
    ],
  };
  const html = () => renderToStaticMarkup(screen({ submitPack: PACK }));

  it('is absent until Submit all has run — which is why no golden holds it', () => {
    expect(renderToStaticMarkup(screen())).not.toContain('Submission pack generated');
    expect(html()).toContain('✓ Submission pack generated — July 2026 (2 files in the ZIP)');
  });

  it('counts the files that were BUILT, not the four it tried', () => {
    // v157 (hros.html:4664): a generator that blocks returns `{error}` and is excluded from `items`, and
    // the pack used to say "✓ generated" while shipping three of four — the salary file the likeliest
    // to vanish. The heading must be items.length, so a short pack reads as short.
    expect(html()).toContain('(2 files in the ZIP)');
    expect(html()).not.toContain('(4 files in the ZIP)');
  });

  it('names each file and points at the portal it is uploaded to', () => {
    const out = html();
    expect(out).toContain('CTG_UOB_July2026.csv');
    expect(out).toContain('CTG_CP39_July2026.txt');
    expect(out).toContain('3 staff · RM 9,450.25');
    expect(out).toContain('Upload Bulk Files');
    expect(out).toContain('e-PCB / e-Data PCB');
    // Wrong destination = an operator uploading a bank file to LHDN. The salary row must not carry the
    // PCB path, and vice versa.
    const salaryRow = out.slice(out.indexOf('CTG_UOB_July2026.csv'), out.indexOf('CTG_CP39_July2026.txt'));
    expect(salaryRow).toContain('UOB Infinity');
    expect(salaryRow).not.toContain('e-PCB');
  });

  it('each row carries ITS OWN checklist tick', () => {
    const calls: string[] = [];
    const tree = screen({ submitPack: PACK, onHubTick: ((k: string) => calls.push(k)) as never });
    reactHandlers(tree).forEach((h) => h.invoke());
    // The pack's two ticks come first (the tracker is above the hub sections), then the hub's own five.
    expect(calls.slice(0, 2)).toEqual(['salary', 'pcb']);
  });
});
