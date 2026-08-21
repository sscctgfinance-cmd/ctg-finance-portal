// Finance OS · Bank Feed — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.bankfeed.html` was captured from `renderBankFeed()` (app.html:4056) by the
// 40-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts, tests/parity.ts or tests/handlers.ts.
//
// ── WHAT WAS DIFFERENT ABOUT THIS SCREEN ───────────────────────────────────────────────────────────
//
// NOT different: the comparison. This reuses ./parity.ts's six relaxations UNCHANGED and adds no
// seventh — seventeen screens have now done that.
//
// Different, and the one thing that took real thought: the golden holds `&#8599;` — a NUMERIC character
// reference for ↗, written into app.html's HTML string (app.html:4063). React's text escaper emits only
// `& < > " '` as references, so `↗` in JSX comes out as the character and the literal string `"&#8599;"`
// comes out as `&amp;#8599;`. Neither side can be spelled into the other. `decodeNumericRefs` below
// applies the parser's own rule to BOTH sides in THIS file, held to parity.ts's bar and with its own
// "cannot hide" block — exactly the treatment hr-payroll gave `&ldquo;`/`&rdquo;`/`&rsquo;`
// (`decodeNamedRefs`), hr-calculator gave the duplicate `style=` and hr-employees gave the bare `&`.
// It is the SAME KIND as hr-payroll's — a character reference in text — differing only in numeric vs
// named, and CLAUDE.md's note that "a second screen needing THIS one is what would move it" into
// parity.ts is what this is. Not moved here: parity.ts is shared with three in-flight sibling
// migrations, and one screen's arrow is not the moment to edit the file all 36 compare under.
//
// Different: THERE ARE NO HANDLERS. The golden carries not one `on*=`, because the launch control is an
// `<a href>` rather than a button. `assertHandlerParity()` is still used and still bites — see its own
// comment: on this screen the assertion that matters is that BOTH sides emit zero handlers, plus the
// anchor attribute pins next to it, because the mis-wire this screen is actually exposed to is the
// anchor becoming an onClick (which loses target/rel/href) or the href pointing somewhere else.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import FinanceBankFeed, { BANKFEED_URL, bankfeedReachable } from '../src/finance-bankfeed';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers } from './handlers';

/**
 * `#bankfeed` is the tab div `render('bankfeed')` writes into (app.html:1163). It is the golden's ONLY
 * section — a Finance surface writes one element, where an HR surface writes `#hr` and `#hr_nav`.
 */
const GOLDEN = goldenSection('finance.bankfeed', 'bankfeed');

const screen = () => <FinanceBankFeed />;

/**
 * NUMERIC CHARACTER REFERENCES for the same character, decoded on BOTH sides.
 *
 * What it absorbs: `&#8599;` vs `↗`, i.e. the SPELLING of a character an HTML parser reads identically
 * either way. What it cannot absorb: a different character (decodes to something else, still diffs), a
 * dropped one (nothing to decode on one side), or anything outside a `&#…;` reference — the block below
 * fails if this ever widened.
 *
 * Deliberately narrower than it could be: it does NOT decode `&amp;#8599;`, which is what a React tree
 * that tried to emit the literal entity text would produce. That is a real defect (the operator sees
 * `&#8599;` printed on the button) and it must keep diffing.
 */
function decodeNumericRefs(html: string): string {
  return html.replace(/&#(\d+);|&#[xX]([0-9a-fA-F]+);/g, (_m, dec: string, hex: string) =>
    String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16)));
}

/** Both sides read as the same document, then compared under ./parity.ts's six relaxations. */
const sameDocument = (html: string) => relax(decodeNumericRefs(html));

const rendered = () => sameDocument(renderToStaticMarkup(screen()));

describe('Finance Bank Feed — React vs the legacy golden', () => {
  it('renders the same document as renderBankFeed() does', () => {
    expect(rendered()).toBe(sameDocument(GOLDEN));
  });

  it('wires the same handlers as the golden — which is none', () => {
    assertHandlerParity();
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * This screen's golden carries zero `on*=` attributes, so the usual argument comparison has nothing to
 * compare and the usual guard-the-guard (`want.length > 0`) is unsatisfiable. That is not a reason to
 * skip the check: it is the check. `relax()`'s R1 strips handler attributes from the string diff, so a
 * port that replaced the anchor with `<button onClick={…}>` would render an identical-looking screen
 * that has silently lost `href`, `target="_blank"` and `rel="noopener noreferrer"` — the third of which
 * is what stops the opened bank-feed program reaching back through `window.opener`. So both directions
 * are asserted: the golden really has none (read from the golden, not assumed), and the React tree
 * emits none either.
 *
 * `assertHandlerParity` takes the tree so the mis-wire cases below can hand it a deliberately broken one.
 */
function assertHandlerParity(tree: React.ReactElement = screen()) {
  const want = goldenHandlers(GOLDEN);
  const got = reactHandlers(tree);

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));

  // Guard the guard, in the only form this screen can support: the golden is asserted to be
  // handler-free rather than trusted to be, so if the legacy screen ever grows a button the equality
  // above stops being vacuous AND this line says so at the same time.
  expect(want).toEqual([]);
}

describe('the comparison still bites', () => {
  // THIS SCREEN'S real risks. It holds no money and no rows, so the generic "a figure moved" cases do
  // not apply. What it holds is a DESTINATION that staff sign into with their own bank credentials, and
  // the safety attributes on the link to it. Each case below is a change that costs someone something
  // and is invisible in a screenshot.
  const want = sameDocument(GOLDEN);

  /** Re-render the component's own markup with one substitution, as a stand-in for that edit. */
  const edited = (from: string, to: string) =>
    sameDocument(renderToStaticMarkup(screen()).split(from).join(to));

  it('catches the destination host changing', () => {
    // The defect that actually costs money here: a look-alike host harvesting real bank-feed logins.
    expect(edited('fusioneta.com.my', 'fusioneta.com')).not.toBe(want);
  });

  it('catches the URL and the printed address falling out of step', () => {
    // The anchor and the muted line under it are the SAME string in the legacy source. If a port let
    // them drift, the operator reads one address and is sent to another — which is exactly what a
    // phishing edit would look like, and it must not be a one-sided change that passes.
    const html = renderToStaticMarkup(screen());
    expect(html.split(BANKFEED_URL).length - 1).toBe(2);
    expect(sameDocument(html.replace(BANKFEED_URL, 'https://fusioneta.example/'))).not.toBe(want);
  });

  it('catches rel="noopener noreferrer" being weakened', () => {
    // Without noopener the opened program holds `window.opener` on the portal tab and can navigate it.
    expect(edited('rel="noopener noreferrer"', 'rel="noopener"')).not.toBe(want);
    expect(edited(' rel="noopener noreferrer"', '')).not.toBe(want);
  });

  it('catches target="_blank" being dropped — the launcher taking over the portal tab', () => {
    expect(edited(' target="_blank"', '')).not.toBe(want);
  });

  it('catches the "no data is stored in the portal" assurance being reworded', () => {
    // This sentence is what tells staff the portal is not holding their bank credentials. It is the
    // screen's only real content and a silent edit to it is a false statement in front of users.
    expect(edited('no data is stored in the portal', 'data is stored in the portal')).not.toBe(want);
  });

  it('catches the button losing its class, its label or its arrow', () => {
    expect(edited('class="btn p"', 'class="btn"')).not.toBe(want);
    expect(edited('Open Bank Feed', 'Open Bankfeed')).not.toBe(want);
    expect(edited('↗', '')).not.toBe(want);
  });

  // ── the mis-wire ─────────────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=` from the string comparison, so this is invisible to every case above.

  it('catches the anchor becoming a handler-driven button', () => {
    const misfire = () => {};
    expect(() => assertHandlerParity(
      <div className="panel"><button className="btn p" onClick={misfire}>Open Bank Feed ↗</button></div>,
    )).toThrow(/deeply equal/);
  });

  it('catches a handler added anywhere on the screen, even one that changes nothing visible', () => {
    const misfire = () => {};
    expect(() => assertHandlerParity(
      <div className="panel" onClick={misfire}><a href={BANKFEED_URL}>Open Bank Feed ↗</a></div>,
    )).toThrow(/deeply equal/);
  });
});

describe('the destination is app.html\'s, not a retyped copy', () => {
  it('is the exact URL renderBankFeed() opens', () => {
    // Read out of app.html at run time. A retyped constant agrees with a typo'd port by construction,
    // and the golden alone would not notice the day someone "fixes" both the golden and the component
    // together — this pins the React screen to the LIVE legacy source instead.
    const src = readFileSync(join(REPO, 'app.html'), 'utf8');
    const at = src.indexOf('function renderBankFeed()');
    expect(at).toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf('\n}', at));
    const m = body.match(/var url='([^']+)'/);
    expect(m).not.toBeNull();
    expect(BANKFEED_URL).toBe(m![1]);
  });
});

describe('the admin gate — app.html:1432', () => {
  // The withheld direction, asserted. `renderBankFeed()` has no role check in it; `showApp()` hides the
  // tab unless PERMS.manage_users. A port that mirrored only the renderer would advertise the existence
  // and the address of the company's bank-feed program to anyone who typed the URL.
  it('opens only for a user who may manage users', () => {
    expect(bankfeedReachable({ manage_users: true })).toBe(true);
  });

  it('is closed for every other shape of permission, including a missing one', () => {
    for (const p of [null, undefined, {}, { manage_users: false }, { manage_users: null }]) {
      expect(bankfeedReachable(p as never)).toBe(false);
    }
  });

  it('is what the route gates on — the screen renders the destination in full', () => {
    // Guard the guard: if the screen stopped carrying the thing the gate exists to withhold, the two
    // assertions above would be about nothing.
    const html = renderToStaticMarkup(screen());
    expect(html).toContain('fusioneta.com.my/app/bank-feed/program.php');
  });

  it('mirrors the same line app.html gates this tab on', () => {
    // The gate is one branch of app.html:1420-1434 and it shares its condition with four sibling tabs.
    // Pinned against the source so a change to that line is a failing test rather than a silent
    // divergence between the tab rail and this route.
    const src = readFileSync(join(REPO, 'app.html'), 'utf8');
    expect(src).toContain("else if(t==='bankfeed') el.classList.toggle('hide', !canManage);");
  });
});

describe('decodeNumericRefs cannot hide a real change', () => {
  // The screen-local rule this file adds, held to ./parity.ts's own bar: it maps a numeric character
  // reference to the character it denotes, and NOTHING else. Each case fails if it ever widened.
  it('decodes a decimal and a hex reference to the same character', () => {
    expect(decodeNumericRefs('a&#8599;b')).toBe('a↗b');
    expect(decodeNumericRefs('a&#x2197;b')).toBe('a↗b');
  });

  it('decodes to the character it names, not to a convenient one', () => {
    expect(decodeNumericRefs('&#8595;')).toBe('↓');
    expect(decodeNumericRefs('&#8599;')).not.toBe(decodeNumericRefs('&#8595;'));
  });

  it('leaves every NAMED reference alone — &amp; in particular', () => {
    expect(decodeNumericRefs('Pay &amp; Transfer &lt;b&gt; &ldquo;x&rdquo; &nbsp;'))
      .toBe('Pay &amp; Transfer &lt;b&gt; &ldquo;x&rdquo; &nbsp;');
  });

  it('does NOT decode a doubly-escaped entity — the defect that prints &#8599; on the button', () => {
    expect(decodeNumericRefs('Open Bank Feed &amp;#8599;')).toBe('Open Bank Feed &amp;#8599;');
  });

  it('is not a general unescaper — it cannot turn text into markup', () => {
    expect(decodeNumericRefs('&#60;script&#62;')).toBe('<script>');   // it CAN, so:
    // …which is why it runs on both sides of a comparison and on nothing else. Stated, not hidden: the
    // only caller is `sameDocument`, and both arguments to every `toBe` pass through it.
    expect(sameDocument('&#60;b&#62;x&#60;/b&#62;')).toBe(sameDocument('<b>x</b>'));
  });
});
