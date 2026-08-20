// Finance OS · Withholding Tax — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.wht.html` was captured from `renderWht()` (app.html:3387) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts,
// tests/parity.ts or tests/handlers.ts. The component is rendered with `renderToStaticMarkup` from the
// SAME fixture the golden was captured from — tests/render_fixtures.ts, imported directly — normalised
// by the harness's own normalise(), relaxed by the documented layer in ./parity.ts, and compared.
//
// ── THE FIRST FINANCE SCREEN. What was different, and what was not ─────────────────────────────────
//
// NOT different: the comparison. This reuses ./parity.ts's six relaxations UNCHANGED and adds no
// seventh, which is what fifteen HR screens have now done. Finance markup turned out to need nothing
// new — no named character reference, no duplicate attribute, no unescaped `&`. The one Finance-shaped
// worry, `whtMoney`'s `toLocaleString('en-MY')`, produces the same bytes under Node as it does under
// Deno because both read the same ICU data, and `catches one sen` below moves the figure to prove the
// comparison is actually looking at it.
//
// Different: there is NO CHROME. Every HR golden carries the page head `hrRender()` writes into `#hr`
// before the screen's renderer runs, so every HR component had to reproduce it. Finance's `render(t)`
// dispatches straight to `renderWht()`, which owns every byte of `#wht` — so the component IS the whole
// golden and there is no companyName to pass. See src/finance-wht.tsx's header.
//
// Different: the handler set. This screen has both kinds at once, so it carries BOTH established local
// widenings — `identArgs()` for bare-integer row ids (`whtOpen(1)`), and a golden-derived
// LEGACY_TO_PROP for the two argument-free buttons. Neither is new; see the two blocks below.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES } from '../../tests/render_fixtures';
import FinanceWht, { payeeBody, whtReachable, type WhtPayee, type WhtSummary } from '../src/finance-wht';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/**
 * `#wht` is the tab div `render('wht')` writes into (app.html:1172). It is the golden's ONLY section —
 * a Finance surface writes one element, where an HR surface writes `#hr` and `#hr_nav`.
 */
const GOLDEN = goldenSection('finance.wht', 'wht');

const LIST = (FIXTURES.wht_list as { summaries: WhtSummary[] }).summaries;
const PAYEES = (FIXTURES.wht_config as { payees: WhtPayee[] }).payees;

const noop = () => {};

type Props = Parameters<typeof FinanceWht>[0];

function screen(over: Partial<Props> = {}) {
  return (
    <FinanceWht
      list={LIST}
      payeeList={PAYEES}
      // `WHT.payees` / `WHT.editPayee` as the harness captured them: the module's initial state
      // (app.html:3384), untouched, because `render('wht')` runs no setup.
      payees={false}
      editPayee={null}
      onOpen={noop}
      onNew={noop}
      onTogglePayees={noop}
      onEditPayee={noop}
      onSavePayee={noop}
      onCancelPayee={noop}
      onDelPayee={noop}
      {...over}
    />
  );
}

const rendered = (over: Partial<Props> = {}) => relax(renderToStaticMarkup(screen(over)));

describe('Finance WHT — React vs the legacy golden', () => {
  it('renders the same document as renderWht() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * R1 drops `on*=` from the string comparison, so `onclick="whtOpen(1)"` and `onclick="whtOpen(2)"` are
 * byte-identical in stripped output. Opening the wrong computation shows one non-resident payee's
 * withheld tax under another's doc number — and the "Filed" one is a return already submitted to LHDN.
 * This puts the arguments back.
 *
 * TWO local widenings, both already established on the HR side and both COPIED here rather than pushed
 * into the shared ./handlers.ts, which sibling migrations share:
 *
 * 1. `identArgs()` — `goldenHandlers()` collects QUOTED literals, because on the first screens a row was
 *    a quoted id. Every row on this screen is a BARE INTEGER (`whtOpen(1)`), so quoted-only extraction
 *    returns [] for every row and the check would pass with both rows opening the same computation. This
 *    is the seventh screen to need it; CLAUDE.md already calls folding it into `goldenHandlers()` the
 *    next single change to make there, once the in-flight migrations have landed.
 *
 * 2. `LEGACY_TO_PROP` — two of this screen's three non-row handlers carry NO arguments
 *    (`whtNew()` and the inline `WHT.payees=!WHT.payees;renderWht()`), so argument parity alone cannot
 *    tell them apart and "+ New computation" opening the payees panel would pass. Same treatment
 *    hr-payroll and hr-profile gave it: a map DERIVED FROM THE GOLDEN'S OWN TEXT, compared as a
 *    sequence. Note the toggle's raw text is a statement, not a call — it is keyed whole.
 */
function identArgs(raw: string): string[] {
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|\b(-?\d+)\b/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

const LEGACY_TO_PROP: Record<string, string> = {
  'WHT.payees=!WHT.payees;renderWht()': 'togglePayees',
  'whtNew()': 'new',
  whtOpen: 'open',
};

/** The prop a golden handler stands for: keyed on the whole raw text first, then on the function name. */
const propFor = (raw: string) => LEGACY_TO_PROP[raw] ?? LEGACY_TO_PROP[raw.replace(/\(.*$/, '')] ?? raw;

function assertHandlerParity(over: Partial<Props> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args
        .filter((a) => (typeof a === 'string' || typeof a === 'number') && a !== STUB_VALUE)
        .map(String),
    });
  misfire = record('misfire');

  const got = reactHandlers(screen({
    onOpen: record('open') as never,
    onNew: record('new') as never,
    onTogglePayees: record('togglePayees') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => identArgs(h.raw)));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard: if the golden ever stops carrying handlers, the assertions above pass vacuously
  // and R1 becomes the blind strip it is not allowed to be. Two clauses, because this screen mixes
  // argument-carrying and argument-free handlers and either half alone can go quiet.
  expect(want.length).toBeGreaterThan(0);
  expect(want.some((h) => identArgs(h.raw).length > 0)).toBe(true);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

describe('the comparison still bites', () => {
  // This SCREEN's real risks: a statutory figure that rounds away, a line total that stops summing, a
  // row that vanishes, a rate or a basis that changed.
  const want = relax(GOLDEN);
  const withRow = (i: number, over: Partial<WhtSummary>) =>
    rendered({ list: LIST.map((s, k) => (k === i ? { ...s, ...over } : s)) });

  it('catches one sen on one computation', () => {
    // The WHT column is `whtCompute`'s output, so a sen on the fee moves the withheld figure too.
    expect(withRow(0, { fee_total: LIST[0].fee_total + 0.01 })).not.toBe(want);
  });

  it('catches a rate that changed on one row only', () => {
    // 10% → 8% on the OpenAI row is RM 74.54 under-withheld and a wrong CP37.
    expect(withRow(0, { wht_rate: 0.08 })).not.toBe(want);
  });

  it('catches the basis flipping from net to gross', () => {
    // The Meta row is net-of-tax: gross-up gives WHT 80.00, the gross basis gives 73.60. That is the
    // exact defect Malaysia_WHT_Summary.xlsx shipped with (tests/wht_test.ts), and it is worth 6.40 a
    // month on this one row alone.
    expect(withRow(1, { basis: 'gross' })).not.toBe(want);
  });

  it('catches a computation dropped out of the list', () => {
    expect(rendered({ list: LIST.slice(0, 1) })).not.toBe(want);
  });

  it('catches a status pill that changed — a draft shown as filed', () => {
    expect(withRow(1, { status: 'filed' })).not.toBe(want);
  });

  it('catches a renamed payee, a moved period and a lost doc number', () => {
    expect(withRow(0, { payee_name: 'OPENAI IRELAND LTD' })).not.toBe(want);
    expect(withRow(0, { period_label: 'June 2026' })).not.toBe(want);
    expect(withRow(0, { doc_no: null })).not.toBe(want);
  });

  it('catches the payees panel opening — a branch no golden holds', () => {
    // Proves the golden really is the `WHT.payees===false` state, so the panel below is genuinely
    // untested by the diff rather than accidentally included in it.
    expect(rendered({ payees: true })).not.toBe(want);
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=` from the string comparison, so every one of these is invisible to the diff above.

  it('catches a row opening the wrong computation', () => {
    expect(() => assertHandlerParity({ onOpen: (() => misfire(1)) as never })).toThrow(/deeply equal/);
  });

  it('catches a row wired to no id at all', () => {
    expect(() => assertHandlerParity({ onOpen: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches "+ New computation" opening the payees panel instead', () => {
    // Neither button carries an argument in the golden, so this is invisible to argument parity — it is
    // the case LEGACY_TO_PROP was added for.
    expect(() => assertHandlerParity({ onNew: (() => misfire()) as never })).toThrow(/deeply equal/);
  });
});

describe('the admin gate — app.html:1430', () => {
  // The withheld direction, asserted. `renderWht()` has no role check in it; `showApp()` hides the tab
  // unless PERMS.manage_users. A port that mirrored only the renderer would serve every non-resident
  // payee's name, TIN, treaty position and withheld tax to anyone who typed the URL.
  it('opens only for a user who may manage users', () => {
    expect(whtReachable({ manage_users: true })).toBe(true);
  });

  it('is closed for every other shape of permission, including a missing one', () => {
    for (const p of [null, undefined, {}, { manage_users: false }, { manage_users: null }]) {
      expect(whtReachable(p as never)).toBe(false);
    }
  });

  it('is what the route gates on — the screen renders payee identity and money', () => {
    // Guard the guard: if the fixture stopped carrying the things the gate exists to protect, the two
    // assertions above would be about nothing.
    const html = renderToStaticMarkup(screen({ payees: true }));
    expect(html).toContain('C57831485010');                 // a payee's TIN
    expect(html).toContain('372.68');                        // tax withheld on a filed return
    expect(html).toContain('Certificate of Residence');      // the treaty position
  });
});

describe('the statutory figures come from wht.js, not from a copy of it', () => {
  // The golden pins these to the sen, but only for this fixture. These are the two bases the module
  // exists to get right, read through the same function app.html calls. If the component ever stopped
  // calling whtCompute, these are what would notice.
  const html = renderToStaticMarkup(screen());

  it('withholds 10% of the fee on the gross-basis row — not 10% of fee+SST', () => {
    // 3,726.82 × 10% = 372.68. The SST-inclusive figure would be 402.50, which is the workbook's bug.
    expect(html).toContain('<b>372.68</b>');
    expect(html).not.toContain('402.50');
  });

  it('grosses up the net-basis row before applying the rate', () => {
    // 920 ÷ (1 − 0.08) = 1,000; WHT = 80.00. Charging 8% of 920 would be 73.60 and under-withheld.
    expect(html).toContain('<b>80.00</b>');
    expect(html).not.toContain('73.60');
  });

  it('prints the fee to the sen, thousands separated', () => {
    expect(html).toContain('3,726.82');
  });

  it('CASTS: the WHT column tracks the fee column, it is not transcribed', () => {
    // The workbook's defect class — a total that stops agreeing with the rows above it. On this screen
    // the equivalent is a WHT column read off a stored figure instead of computed from the fee shown
    // next to it, which looks perfect and is a wrong return. Move the fee by exactly RM 100 on the 10%
    // row and the withheld figure must move by exactly RM 10.00.
    const moved = renderToStaticMarkup(screen({
      list: LIST.map((s, k) => (k === 0 ? { ...s, fee_total: s.fee_total + 100 } : s)),
    }));
    expect(html).toContain('<b>372.68</b>');
    expect(moved).toContain('<b>382.68</b>');
    expect(moved).toContain('3,826.82');
  });
});

describe('the payee POST body — no golden sees a request', () => {
  // Same rule as the HR side's bankFile()/profileBody(): the body a screen SENDS is markup nowhere, so
  // it is pinned here or nowhere. Two things are load-bearing.
  const form = {
    id: 2, name: 'META PLATFORMS IRELAND LIMITED', tin: 'C29806901060', country: 'IRELAND',
    rate: '8', stat: '10', type: 'royalty', treaty: true, cor: false, notes: '',
  };

  it('sends rates as FRACTIONS, from a form that types PERCENTS', () => {
    // The whole liability scales with this. A missing /100 withholds 800% of the fee.
    const b = payeeBody(form);
    expect(b.wht_rate).toBe(0.08);
    expect(b.statutory_rate).toBe(0.10);
  });

  it('sends null, never NaN, for a rate box that is not a number', () => {
    // `pct()` (app.html:3484) is `isFinite(n) ? n/100 : null`, so a box holding text sends null and the
    // server keeps what it had. Mirrored exactly, including the edge below.
    expect(payeeBody({ ...form, rate: 'abc' }).wht_rate).toBeNull();
  });

  it('mirrors the legacy edge: a BLANK rate box sends 0, not null', () => {
    // `Number('')` is 0 and `isFinite(0)` is true, so an emptied rate box saves the payee at 0% —
    // withhold nothing — rather than leaving the rate alone. That is app.html's behaviour today and the
    // port keeps it: changing it here would be an invisible behaviour change riding along with a
    // migration. Raised in the PR; pinned here so it cannot drift in either direction unnoticed.
    expect(payeeBody({ ...form, rate: '' }).wht_rate).toBe(0);
  });

  it('carries exactly the fields whtSavePayee() sends, and no others', () => {
    // Read out of app.html at run time rather than retyped: a retyped list agrees with a widened port by
    // construction, and an extra field on a payee is a rate or a treaty flag the legacy screen never let
    // anyone set from here.
    const src = readFileSync(join(REPO, 'app.html'), 'utf8');
    const at = src.indexOf('var payee={');
    expect(at).toBeGreaterThan(0);
    const decl = src.slice(at, src.indexOf('};', at));
    const legacy = [...decl.matchAll(/([a-z_]+)\s*:/g)].map((m) => m[1]).sort();
    expect(Object.keys(payeeBody(form)).sort()).toEqual(legacy);
  });

  it('omits the id for a new payee, so the server inserts rather than overwrites', () => {
    expect(payeeBody({ ...form, id: undefined }).id).toBeUndefined();
    expect(payeeBody({ ...form, id: 0 }).id).toBeUndefined();
  });
});

describe('the payee form keeps the element ids whtSavePayee() reads', () => {
  // No golden holds this form (it is behind WHT.payees + WHT.editPayee, both off when the surface was
  // captured), so the parity diff never reaches it. The contract that DOES govern it is the set of ids
  // the legacy save path looks up — extracted from app.html at run time so the check cannot drift from
  // the function it protects. A field that loses its id here saves as blank: a wiped TIN, or a rate
  // silently reset to whatever the box last held.
  const src = readFileSync(join(REPO, 'app.html'), 'utf8');
  const save = src.slice(src.indexOf('async function whtSavePayee()'), src.indexOf('async function whtDelPayee'));
  const ids = [...new Set([...save.matchAll(/[vc]k?\('(wp_[a-z]+)'\)/g)].map((m) => m[1]))];
  const html = renderToStaticMarkup(screen({ payees: true, editPayee: PAYEES[1] }));

  it('finds the ids in the legacy save path at all', () => {
    expect(ids.length).toBeGreaterThanOrEqual(8);
  });

  for (const id of ids) {
    it(`renders #${id}`, () => {
      expect(html).toContain(`id="${id}"`);
    });
  }
});
