// Finance OS · Pharmacies — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.pharm.html` was captured from `pharmRender()` (app.html:6611) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts,
// tests/parity.ts or tests/handlers.ts. The component is rendered with `renderToStaticMarkup` from the
// SAME fixture the golden was captured from, normalised by the harness's own normalise(), relaxed by
// the documented layer in ./parity.ts, and compared.
//
// NO SEVENTH RELAXATION. This screen reuses ./parity.ts's six unchanged, which is now what
// twenty-three screens have done.
//
// ── WHAT IS NEW ABOUT THIS SCREEN ─────────────────────────────────────────────────────────────────
//
// 1. THE GATE IS "ALWAYS VISIBLE, SERVER-SIDE". app.html:1425 is `el.classList.remove('hide')` — no
//    role, no feature flag. So the interesting direction is not who may open the tab (everyone) but
//    what the screen shows when `portal_pharmacy_list` refuses: the 🔒 panel naming SKINDAE. No golden
//    holds it, so it is pinned below, along with the negative that matters — a refusal must never
//    render as an empty table.
//
// 2. THE FIRST SCREEN WITH HOVER HANDLERS. Each row carries `onmouseover`/`onmouseout` that assign
//    `this.style.background` and call no screen function at all. That is the same shape hr-expenses'
//    `event.stopPropagation()` has, and it gets the same treatment: a POSITIONAL escape checked against
//    the golden's own text, so a handler that quietly stopped calling anything cannot hide behind it.
//    The colour each one paints is asserted separately, out of the golden, below.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES } from '../../tests/render_fixtures';
import FinancePharm, { pharmReachable, visiblePharmacies, type Pharmacy } from '../src/finance-pharm';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `#pharm` is the tab div `render('pharm')` writes into (app.html:1172) — the golden's only section. */
const GOLDEN = goldenSection('finance.pharm', 'pharm');

const LIST = (FIXTURES.pharmacy_list as { pharmacies: Pharmacy[] }).pharmacies;

const noop = () => {};

type Props = Parameters<typeof FinancePharm>[0];

function screen(over: Partial<Props> = {}) {
  return (
    <FinancePharm
      pharmacies={LIST}
      // PHARM_SEARCH / PHARM_EDITABLE as the harness captured them: the module's initial state
      // (app.html:6585) and a fixture response carrying no `editable` flag.
      search=""
      editable={false}
      refused={null}
      failed={null}
      onSearch={noop}
      onOpen={noop}
      onNew={noop}
      {...over}
    />
  );
}

const rendered = (over: Partial<Props> = {}) => relax(renderToStaticMarkup(screen(over)));

describe('Finance Pharmacies — React vs the legacy golden', () => {
  it('renders the same document as pharmRender() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * R1 drops `on*=` from the string comparison, so `onclick="pharmOpen(1)"` and `onclick="pharmOpen(3)"`
 * are byte-identical in stripped output. Three rows of pharmacy / location / phone that look alike is
 * exactly where a wrong id is invisible, and the row opens a master record whose commission rate prices
 * that pharmacy's invoices. This puts the arguments back.
 *
 * `identArgs()` is the established local widening (the ninth screen to copy it — see CLAUDE.md): every
 * row id here is a BARE INTEGER, so `goldenHandlers()`'s quoted-only extraction returns [] for all
 * three rows and the check would pass with every row opening pharmacy 1.
 */
function identArgs(raw: string): string[] {
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|\b(-?\d+)\b/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** The two hover statements, verbatim from app.html:6656 — the only handlers that call nothing. */
const HOVER = /^this\.style\.background='(?:rgba\(255,255,255,\.03\)|transparent)'$/;

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
    onSearch: record('search') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));

  got.forEach((h, i) => {
    const before = calls.length;
    h.invoke();
    if (calls.length > before) return;
    // A handler that called nothing. On this screen exactly two per row legitimately do — the hover
    // repaints, which assign `this.style.background` and reach no screen function. The position is
    // checked against the golden's own text, so anything else landing here is a handler that quietly
    // stopped calling anything and still fails.
    expect(want[i].raw).toMatch(HOVER);
    calls.push({ attr: h.attr, args: [] });
  });

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => (HOVER.test(h.raw) ? [] : identArgs(h.raw))));

  // Guard the guard: if the golden ever stops carrying handlers, the assertions above pass vacuously
  // and R1 becomes the blind strip it is not allowed to be.
  expect(want.length).toBeGreaterThan(0);
  expect(want.some((h) => !HOVER.test(h.raw) && identArgs(h.raw).length > 0)).toBe(true);
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

describe('the comparison still bites', () => {
  // This SCREEN's real risks: a pharmacy that vanishes from the master list, a commission rate that
  // changed, an inactive pharmacy reading as active (it is what O2O bills), a row opening the wrong
  // record.
  const want = relax(GOLDEN);
  const withRow = (i: number, over: Partial<Pharmacy>) =>
    rendered({ pharmacies: LIST.map((p, k) => (k === i ? { ...p, ...over } : p)) });

  it('catches a pharmacy dropped out of the master list', () => {
    expect(rendered({ pharmacies: LIST.slice(1) })).not.toBe(want);
  });

  it('catches a commission rate that changed on one row only', () => {
    // 19.2% → 15.0% is a 4.2pt swing on every invoice this pharmacy is billed.
    expect(withRow(0, { commission_rate: 15 })).not.toBe(want);
  });

  it('catches a rate that changed by a tenth', () => {
    expect(withRow(0, { commission_rate: 19.3 })).not.toBe(want);
  });

  it('catches an inactive pharmacy shown as Active — the O2O eligibility flag', () => {
    expect(withRow(2, { active: true })).not.toBe(want);
  });

  it('catches the Active/Inactive counts moving', () => {
    expect(withRow(0, { active: false })).not.toBe(want);
  });

  it('catches a renamed pharmacy, a moved location and a lost phone', () => {
    expect(withRow(0, { name: 'FARMASI SIHAT (KL) SDN BHD' })).not.toBe(want);
    expect(withRow(0, { city: 'Klang' })).not.toBe(want);
    expect(withRow(0, { phone: null })).not.toBe(want);
  });

  it('catches the PIC columns appearing — a branch the fixture leaves empty', () => {
    expect(withRow(0, { pic_name: 'Lim Mei Ling', pic_role: 'Outlet Manager' })).not.toBe(want);
    // pic_phone WINS over phone (app.html:6659); a port that preferred the main line would show the
    // wrong number to call about a disputed invoice.
    expect(withRow(0, { pic_phone: '+6012-333 4444' })).not.toBe(want);
  });

  it('catches the outlet-count badge appearing, and its threshold', () => {
    expect(withRow(0, { outlet_count: 3 })).not.toBe(want);
    // `>1` — a single-outlet pharmacy carries no badge, which is the golden.
    expect(withRow(0, { outlet_count: 1 })).toBe(want);
  });

  it('catches the admin button appearing — a branch no golden holds', () => {
    // Proves the golden really is the PHARM_EDITABLE===false state.
    expect(rendered({ editable: true })).not.toBe(want);
  });

  it('catches a search that filtered the list — including the Matches card', () => {
    expect(rendered({ search: 'alpha' })).not.toBe(want);
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=` from the string comparison, so every one of these is invisible to the diff above.

  it('catches a row opening the wrong pharmacy', () => {
    expect(() => assertHandlerParity({ onOpen: (() => misfire(1)) as never })).toThrow(/deeply equal/);
  });

  it('catches a row wired to no id at all', () => {
    expect(() => assertHandlerParity({ onOpen: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches a row that stopped calling anything — the hover escape is positional', () => {
    expect(() => assertHandlerParity({ onOpen: undefined as never })).toThrow();
  });

  it('catches the search box losing its handler', () => {
    expect(() => assertHandlerParity({ onSearch: undefined as never })).toThrow();
  });
});

describe('the hover repaint — a handler that calls no screen function', () => {
  // The two `this.style.background=` statements are escaped positionally in handler parity, so the
  // COLOUR each one paints is proved here instead: taken out of the golden and required to appear in
  // the component. A repaint that lost its colour, or painted the hover colour on mouse-OUT, is a row
  // that stays highlighted after the pointer leaves.
  const src = readFileSync(join(REPO, 'web', 'src', 'finance-pharm.tsx'), 'utf8');
  const colours = [...GOLDEN.matchAll(/\son(mouseover|mouseout)="this\.style\.background='([^']*)'"/g)];

  it('finds both hover statements in the golden at all', () => {
    expect(colours.length).toBe(LIST.length * 2);
  });

  it('paints the colours the golden paints, on the events the golden paints them', () => {
    for (const [, ev, colour] of colours) {
      expect(src).toContain(`onMouse${ev === 'mouseover' ? 'Over' : 'Out'}={paint('${colour}')}`);
    }
  });
});

describe('the gate — app.html:1425, "always visible, gated server-side"', () => {
  // A shape no migrated screen has had: the client shows the tab to EVERYONE and the server decides
  // what comes back. Pinned against app.html's own text so the predicate cannot quietly stop mirroring
  // it — a `!canManage` copied from a neighbour would hide the tab from every non-admin who uses it.
  const src = readFileSync(join(REPO, 'app.html'), 'utf8');
  const block = src.slice(src.indexOf("document.querySelectorAll('.tab').forEach"), src.indexOf("document.querySelectorAll('.tab-cat')"));

  it('is unconditional in app.html — no role, no feature flag', () => {
    expect(block).toContain("else if(t==='pharm') el.classList.remove('hide');");
    expect(block).not.toMatch(/t==='pharm'[^\n]*canManage/);
    expect(block).not.toMatch(/t==='pharm'[^\n]*feats/);
  });

  it('opens for every shape of permission, including none at all', () => {
    expect(pharmReachable()).toBe(true);
  });
});

describe('the refusal — the branch that carries this screen\'s security meaning', () => {
  // The server refusing SKINDAE access is the ONLY thing standing between a login and the master list,
  // and no golden holds the panel it produces. A port that rendered an empty table there would turn a
  // refusal into "this company has no pharmacies", which reads as success.
  const refusal = renderToStaticMarkup(screen({ pharmacies: null, refused: 'forbidden' }));

  it('renders the legacy 🔒 panel, naming SKINDAE, with the server\'s own message', () => {
    expect(refusal).toContain('🔒');
    expect(refusal).toContain('forbidden');
    expect(refusal).toContain('Pharmacies require SKINDAE access.');
  });

  it('renders NO table, NO search box and NO counts — a refusal is not an empty success', () => {
    expect(refusal).not.toContain('<table');
    expect(refusal).not.toContain('pharm-search');
    expect(refusal).not.toContain('Total pharmacies');
    expect(refusal).not.toContain('No pharmacies yet');
  });

  it('refuses even when a list is somehow already in hand', () => {
    // Order matters: the refusal branch is checked FIRST, so a stale list cannot leak past a refusal.
    const html = renderToStaticMarkup(screen({ refused: 'forbidden' }));
    expect(html).not.toContain('FARMASI SIHAT');
  });

  it('keeps a transport failure distinct — ⚠️, and no SKINDAE sentence', () => {
    // app.html:6609's catch. Saying "requires SKINDAE access" after a dropped connection sends the
    // operator to ask for access they already have.
    const html = renderToStaticMarkup(screen({ pharmacies: null, failed: 'Network error' }));
    expect(html).toContain('⚠️');
    expect(html).toContain('Network error');
    expect(html).not.toContain('SKINDAE');
  });

  it('shows the skeleton, not "No pharmacies yet", while the list is in flight', () => {
    // `pharmacies === null` is the pre-response state. Collapsing it into the empty state paints
    // "No pharmacies yet" during every load.
    const html = renderToStaticMarkup(screen({ pharmacies: null }));
    expect(html).toContain('sk-card');
    expect(html).not.toContain('No pharmacies yet');
  });
});

describe('the empty and search states — branches outside the golden', () => {
  it('offers the first-pharmacy button only to an editor, and only with no search', () => {
    expect(renderToStaticMarkup(screen({ pharmacies: [], editable: true }))).toContain('+ Add your first pharmacy');
    expect(renderToStaticMarkup(screen({ pharmacies: [], editable: false }))).not.toContain('+ Add your first');
    expect(renderToStaticMarkup(screen({ pharmacies: [], editable: true, search: 'zzz' }))).not.toContain('+ Add your first');
  });

  it('quotes what was typed when nothing matches', () => {
    expect(renderToStaticMarkup(screen({ search: 'zzz' }))).toContain('No pharmacies match');
  });

  it('searches every field pharmRender() searches, and no fewer', () => {
    // A field dropped from the filter makes a pharmacy unfindable by the thing the operator typed,
    // while the screen says "No pharmacies match" and looks perfectly normal. The field list is read
    // out of app.html at run time rather than retyped: a retyped list agrees with a narrowed port by
    // construction.
    const src = readFileSync(join(REPO, 'app.html'), 'utf8');
    const at = src.indexOf('const visible = q ? PHARM_DATA.filter(');
    expect(at).toBeGreaterThan(0);
    const decl = src.slice(at, src.indexOf(') : PHARM_DATA.slice()', at));
    const fields = [...new Set([...decl.matchAll(/pharmNormalize\(p\.([a-z_]+)/g)].map((m) => m[1]))];
    expect(fields.length).toBe(6);
    for (const f of fields) {
      const one = [{ id: 9, name: 'X', active: true, [f]: 'needle' } as Pharmacy];
      expect(visiblePharmacies(one, 'needle')).toHaveLength(1);
    }
  });

  it('normalises case and runs of whitespace, as pharmNormalize() does', () => {
    expect(visiblePharmacies(LIST, '  farmasi   sihat ')).toHaveLength(1);
    expect(visiblePharmacies(LIST, '')).toHaveLength(LIST.length);
  });
});

describe('the commission default comes from o2o.js, not from a copy of it', () => {
  // The rate shown here is a display echo — the figure that bills a pharmacy is computed in o2o.js and
  // posted by `o2o_issue` (finance.ts:626) without the server re-deriving it. So there is no formula to
  // lift; the DEFAULT is the one number both sides must agree on, and it is imported.
  it('shows the same default rate app.html and o2o.js price at', () => {
    expect(renderToStaticMarkup(screen())).toContain('19.2%');
    const o2o = readFileSync(join(REPO, 'o2o.js'), 'utf8');
    expect(o2o).toContain('var O2O_DISCOUNT_RATE = 19.2;');
    // ...and the legacy screen's own fallback is that same number.
    const app = readFileSync(join(REPO, 'app.html'), 'utf8');
    expect(app).toContain("Number(p.commission_rate||19.2)");
  });

  it('mirrors the legacy edge: a rate of 0 or blank falls back to the default, it does not bill at 0%', () => {
    const html = renderToStaticMarkup(screen({ pharmacies: [{ id: 1, name: 'X', active: true, commission_rate: 0 }] }));
    expect(html).toContain('19.2%');
  });
});
