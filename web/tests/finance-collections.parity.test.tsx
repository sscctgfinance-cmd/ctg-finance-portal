// Finance OS · Collections — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.collections.html` was captured from `renderCollections()` (app.html:2425) by the
// 40-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts, tests/parity.ts or tests/handlers.ts. The component is rendered with
// `renderToStaticMarkup`, normalised by the harness's own normalise(), relaxed by the documented layer
// in ./parity.ts, and compared.
//
// NO SEVENTH RELAXATION, and none was close. The paragraph carries an apostrophe (`today's`) and a pair
// of double quotes (`"who to chase"`) that the legacy string writes as bare characters and React's text
// escaper writes as `&#x27;` / `&quot;` — which is precisely what R6 exists for, verified rather than
// speculative for the first time on a Finance screen. Everything else is plain.
//
// ── WHAT THE GOLDEN DOES NOT HOLD, WHICH ON THIS SCREEN IS ALMOST EVERYTHING ───────────────────────
// `renderCollections()` writes an EMPTY `#collres`; every figure the screen ever shows is written there
// by `trigColl()` after the action runs. So the diff below proves the panel, the promise and the button
// and nothing else, and the `#collres` describe block carries its own assertions for the two states the
// div can hold. The busy button is the same gap in the other direction — `trigColl()` mutates
// `disabled` and `textContent` imperatively and no golden sees it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import FinanceCollections, { collectionsReachable, previewBody, type CollPreview } from '../src/finance-collections';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `#collections` is the tab div `render('collections')` writes into — the golden's ONLY section. */
const GOLDEN = goldenSection('finance.collections', 'collections');

const noop = () => {};

type Props = Parameters<typeof FinanceCollections>[0];

function screen(over: Partial<Props> = {}) {
  // The state the harness captured: `render('collections')` runs no setup, so the button is idle and
  // `#collres` is empty.
  return <FinanceCollections busy={false} result={null} error={null} onGenerate={noop} {...over} />;
}

const rendered = (over: Partial<Props> = {}) => relax(renderToStaticMarkup(screen(over)));

describe('Finance Collections — React vs the legacy golden', () => {
  it('renders the same document as renderCollections() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * This screen has exactly ONE handler and it carries no identifying argument: `trigColl(this)`, where
 * `this` is the button itself. So argument parity is vacuous here and cannot be the check — which is
 * the case hr-payroll and hr-profile added `LEGACY_TO_PROP` for, and this is the third screen to need
 * that shape. A map DERIVED FROM THE GOLDEN'S OWN TEXT is compared as a sequence, so a button wired to
 * anything but `onGenerate` fails.
 *
 * It matters more here than on those screens: that one button SENDS MAIL. The paragraph above it
 * promises the send is a preview to the finance inbox and not a customer chase, and this is what proves
 * the button in the React port reaches the same single action and no other. `previewBody()` below pins
 * the other half — what that action actually asks the server to do.
 */
const LEGACY_TO_PROP: Record<string, string> = {
  'trigColl(this)': 'generate',
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

  const got = reactHandlers(screen({ onGenerate: record('generate') as never, ...over }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard. hr-clock's clause — "some handler carries an argument" — is unsatisfiable on a
  // screen whose only handler is argument-free, so it is REPLACED, not dropped, with hr-profile's:
  // every golden handler must resolve to a KNOWN prop, so a new legacy button falls through
  // `propFor()`'s `?? raw` and fails here rather than passing silently.
  expect(want.length).toBeGreaterThan(0);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

describe('the comparison still bites', () => {
  // This SCREEN's real risks. It has no table and no figures in the golden, so the defect that costs
  // someone here is not a moved number — it is the PROMISE in the copy going stale while the button
  // keeps sending, or the button ceasing to be the only thing on the screen.
  const want = relax(GOLDEN);
  const html = renderToStaticMarkup(screen());

  it('the promise about who receives mail is in the golden, character for character', () => {
    // Guard the guard for the whole block below: if the golden stopped carrying this sentence, the
    // comparison would be about nothing. The words that carry the promise are named individually
    // because each one alone is the difference between a preview and a customer-facing chase.
    expect(GOLDEN).toContain('Preview mode only — it will NOT contact customers directly.');
    expect(GOLDEN).toContain('send it to the finance inbox (ssc.ctgfinance)');
  });

  it('catches the word NOT dropped out of the promise', () => {
    // "it will contact customers directly" is the same screen minus one word, and the operator presses
    // the same button. This is the defect this screen can actually cause.
    const weakened = GOLDEN.replace('will NOT contact', 'will contact');
    expect(relax(weakened)).not.toBe(want);
  });

  it('catches the finance inbox being renamed', () => {
    expect(relax(GOLDEN.replace('ssc.ctgfinance', 'ssc.ctgsales'))).not.toBe(want);
  });

  it('catches the whole promise sentence dropped', () => {
    expect(relax(GOLDEN.replace(' Preview mode only — it will NOT contact customers directly.', ''))).not.toBe(want);
  });

  it('catches the button label changing', () => {
    expect(relax(GOLDEN.replace('📨 Generate Preview', 'Send'))).not.toBe(want);
  });

  it('catches #collres losing its id — the div the action writes into', () => {
    // The legacy `trigColl()` looks the results div up by id and the route's DOM does not, but a lost
    // id here means the two renderers no longer describe the same document, and a copy-paste of this
    // screen into the legacy app would silently show nothing after the send.
    expect(relax(GOLDEN.replace('id="collres"', ''))).not.toBe(want);
  });

  it('catches the results branch appearing when the golden holds none', () => {
    // Proves the golden really is the empty-#collres state, so the assertions below are genuinely
    // untested by the diff rather than accidentally included in it.
    expect(rendered({ result: {} })).not.toBe(want);
    expect(rendered({ error: 'boom' })).not.toBe(want);
    expect(rendered({ busy: true })).not.toBe(want);
  });

  it('the golden state paints an EMPTY #collres and an ENABLED button', () => {
    expect(html).toContain('<div id="collres" style="margin-top:18px"></div>');
    expect(html).not.toContain('disabled');
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=` from the string comparison, so both of these are invisible to the diff above.

  it('catches the one button wired to something other than the send', () => {
    expect(() => assertHandlerParity({ onGenerate: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches a second handler appearing on the screen', () => {
    // A screen with one button that grows a second one is a second thing that can send.
    const two = reactHandlers(
      <div><button onClick={noop}>a</button><button onClick={noop}>b</button></div>,
    );
    expect(two.length).toBe(2);
    expect(goldenHandlers(GOLDEN).length).toBe(1);
  });
});

describe('#collres — the two states no golden holds', () => {
  // Every figure this screen shows is written here after the action. Mirrored from app.html:2441-2447
  // and pinned by assertion, because the diff above cannot reach it.
  const ok = (over: Partial<CollPreview> = {}) => renderToStaticMarkup(screen({
    result: { reachable_due_count: 7, reachable_due_amount: 128450.5, to: 'ssc.ctgfinance@ctg.com.my', unreachable_count: 3, ...over },
  }));

  it('states the count, the amount and the inbox it went to', () => {
    const html = ok();
    expect(html).toContain('<div class="n">7 due · RM 128,450.50</div>');
    expect(html).toContain('Preview sent to ssc.ctgfinance@ctg.com.my; 3 more couldn');
  });

  it('CASTS: the amount is formatted to the sen, thousands separated — never a raw float', () => {
    // `128450.5` printed raw reads as RM 128450.5, which an operator reconciling against Xero would
    // take for a different figure. M() (app.html:1253) is the format; this proves it is applied.
    expect(ok()).not.toContain('128450.5<');
    expect(ok({ reachable_due_amount: 0 })).toContain('RM 0.00');
    expect(ok({ reachable_due_amount: 1234567.891 })).toContain('RM 1,234,567.89');
  });

  it('does not silently drop the customers that could NOT be chased', () => {
    // The unreachable count is the whole reason this is a preview: those invoices need a human. A
    // screen that showed "7 due" and nothing else would read as complete coverage.
    expect(ok({ unreachable_count: 12 })).toContain('; 12 more couldn');
    expect(ok({ unreachable_count: null })).toContain('; 0 more couldn');
  });

  it('mirrors the legacy fallbacks: a missing field is 0, a missing recipient is "finance inbox"', () => {
    const html = renderToStaticMarkup(screen({ result: {} }));
    expect(html).toContain('0 due · RM 0.00');
    expect(html).toContain('Preview sent to finance inbox;');
  });

  it('shows the failure branch instead of a result, with the legacy wording', () => {
    const html = renderToStaticMarkup(screen({ error: 'no permission or network issue' }));
    expect(html).toContain('Failed: no permission or network issue');
    expect(html).not.toContain('class="card green"');
  });

  it('escapes what the server put in the recipient — it reaches the page as text', () => {
    const html = renderToStaticMarkup(screen({ result: { to: '<script>x</script>' } }));
    expect(html).not.toContain('<script>');
  });

  it('the busy button says so and cannot be pressed twice', () => {
    // `trigColl()` disables the button for the duration (app.html:2435). Pressing it twice sends the
    // chase list twice, to a human inbox.
    const html = renderToStaticMarkup(screen({ busy: true }));
    expect(html).toContain('disabled');
    expect(html).toContain('Generating…');
  });
});

describe('the request the button makes — no golden sees it, and it sends mail', () => {
  it('is exactly what trigColl() POSTs, read out of app.html rather than retyped', () => {
    // A retyped expectation agrees with a widened port by construction. This screen's single action
    // composes and sends the chase list (finance.ts:610 → portal_trigger_collections), so an extra key
    // or a different api is a different send — and the copy above the button is a promise about it.
    const src = readFileSync(join(REPO, 'app.html'), 'utf8');
    const trig = src.slice(src.indexOf('async function trigColl('), src.indexOf('/* ── Upload ── */'));
    const legacy = [...trig.matchAll(/call\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(legacy).toEqual(["api:'collections'"]);
    expect(previewBody()).toEqual({ api: 'collections' });
  });

  it('carries no recipient, no customer list and no send flag', () => {
    // The negative is the proof: the server resolves everything from the token, so there is nothing on
    // this body that could redirect the mail.
    expect(Object.keys(previewBody())).toEqual(['api']);
  });
});

describe('the feature gate — app.html:1434', () => {
  // The withheld direction, asserted. `renderCollections()` has no role check in it; `showApp()`'s
  // final `else` hides the tab unless 'collections' is in this login's feature list.
  it('opens for a login that carries the collections feature', () => {
    expect(collectionsReachable({ features: ['overview', 'collections'] })).toBe(true);
  });

  it('is closed for every other shape of permission, including a missing one', () => {
    for (const p of [null, undefined, {}, { features: [] }, { features: null }, { features: ['collection'] }, { features: ['overview'] }]) {
      expect(collectionsReachable(p as never)).toBe(false);
    }
  });

  it('is what the route gates on — the screen is a live send button, not a read-only page', () => {
    // Guard the guard: the gate exists because reaching this screen at all puts an operator one click
    // from mailing the chase list out of the finance inbox.
    const html = renderToStaticMarkup(screen());
    expect(html).toContain('📨 Generate Preview');
    expect(html).toContain('ssc.ctgfinance');
  });
});
