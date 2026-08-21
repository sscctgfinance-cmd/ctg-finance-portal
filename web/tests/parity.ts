// The parity layer: how a React screen is compared against the committed golden of the screen it replaces.
//
// This file is generic. Per-screen tests supply the component, the fixture and the golden id; everything
// about "why do these two renderers disagree, and which disagreements are allowed" lives here so screen
// 2..40 inherit it instead of re-arguing it.
//
// ── The rule ────────────────────────────────────────────────────────────────────────────────────────
// Comparison is: tests/render_surfaces.ts's OWN normalise(), unmodified, applied to both sides — then a
// relaxation layer ON TOP. The existing normaliser is deliberately strict (read its policy comment: it
// keeps on*= handlers, class token order, ids, styles, numbers and text verbatim, because it is
// regression cover for the legacy app as it stands). Loosening it in place would blunt it for the other
// 39 screens, so it is not touched — a looser view of a strict golden is easy, recovering detail a strict
// view already threw away is not, and that is its own stated reasoning.
//
// Every relaxation below is a difference in HOW THE SAME DOCUMENT IS SERIALISED. None of them can absorb
// a changed number, a dropped row, a renamed label, a lost class or a missing attribute — that claim is
// what makes them relaxations rather than bugs, and each one says why it holds. `npm test` includes a
// test that proves the layer still bites.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPO = join(import.meta.dirname, '..', '..');

/**
 * The SAME normalise() the golden harness used to write the goldens — lifted out of
 * tests/render_surfaces.ts at run time rather than copied.
 *
 * A copy would be six lines and would drift silently the first time someone tuned the original; the
 * goldens would be regenerated under the new rules and this side would quietly keep comparing under the
 * old ones. Reading the real source means there is exactly one definition. It is also why this does not
 * `import` the file: render_surfaces.ts pulls in the Deno harness (jsr: specifiers, Deno globals), which
 * Node cannot load — but the function itself is plain JS with no dependencies.
 *
 * If it ever stops being extractable this throws loudly, which is the correct failure: silently falling
 * back to a private copy is how the two sides start disagreeing about what "the same" means.
 */
function loadSharedNormalise(): (html: string) => string {
  const src = readFileSync(join(REPO, 'tests', 'render_surfaces.ts'), 'utf8');
  const at = src.indexOf('export function normalise(html: string): string {');
  if (at < 0) {
    throw new Error(
      'Could not find `export function normalise(html: string): string {` in tests/render_surfaces.ts.\n' +
      'The golden harness normaliser is the contract this parity test compares under. If it was renamed or\n' +
      'moved, point this loader at it — do not substitute a local copy, or the two sides stop meaning the same thing.',
    );
  }
  const body = src.slice(src.indexOf('{', at) + 1, src.lastIndexOf('}'));
  return new Function('html', body) as (html: string) => string;
}

export const normalise = loadSharedNormalise();

/** Read one committed golden and return only the block written to `#<elementId>`. */
export function goldenSection(id: string, elementId: string): string {
  const text = readFileSync(join(REPO, 'tests', 'golden', `${id}.html`), 'utf8');
  const open = `<!-- #${elementId} -->\n`;
  const at = text.indexOf(open);
  if (at < 0) throw new Error(`tests/golden/${id}.html has no <!-- #${elementId} --> section`);
  const rest = text.slice(at + open.length);
  const end = rest.indexOf('\n<!-- #');
  return (end < 0 ? rest : rest.slice(0, end + 1)).trimEnd();
}

/**
 * Elements that cannot have element content, so `<x/>`, `<x></x>` and `<x>` are the same document.
 * HTML void elements plus the SVG shape leaves. Collapsing them cannot hide a dropped child because
 * there is no position a child could occupy.
 */
const EMPTY_TAGS = 'area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr|path|circle|ellipse|line|polygon|polyline|rect|stop|use';

/** Attributes that are present-or-absent in HTML; `x` and `x=""` are the same attribute. */
const BOOLEAN_ATTRS = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls', 'default', 'defer',
  'disabled', 'formnovalidate', 'hidden', 'ismap', 'itemscope', 'loop', 'multiple', 'muted',
  'nomodule', 'novalidate', 'open', 'playsinline', 'readonly', 'required', 'reversed', 'selected',
]);

/** `<tag attr="v" attr2>` / `</tag>` — attribute values are always quoted here (both renderers quote). */
const TAG = /<([a-zA-Z][\w:.-]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>/g;
const ATTR = /([^\s=]+)(?:="([^"]*)")?/g;

/**
 * The relaxation layer. Applied identically to BOTH sides — the legacy golden and the React render — so
 * a genuine difference survives every transform below. Each numbered item says what it allows and why
 * allowing it cannot hide a real change.
 */
export function relax(html: string): string {
  // R2 — NON-BREAKING SPACE: entity vs character. RUNS FIRST, BEFORE normalise(), and that ordering is
  // the whole point. The legacy source writes the entity `&nbsp;` into its HTML string, so it reaches the
  // golden as six literal characters that normalise() leaves alone. JSX writes the character U+00A0 —
  // which `\s` matches, so normalise() would collapse it into an ordinary space and a DROPPED nbsp would
  // then pass silently. Canonicalising to the entity before normalising keeps it visible on both sides.
  let s = normalise(String(html).replace(/\u00a0/g, '&nbsp;'));

  // R1 — DROP `on*="..."` HANDLER ATTRIBUTES.
  // The one the brief names: `onclick="hrUserInvite()"` legitimately becomes an `onClick` prop, and React
  // emits no attribute at all for it. This is the only relaxation that could hide something real — an
  // onchange wired to the WRONG user id would vanish here, and that is exactly the defect
  // render_surfaces.ts's policy comment cites as its reason for keeping handlers. So it is not left
  // covered by argument: assertHandlerParity() below reads every handler call out of the golden and
  // checks the React tree calls the same function with the same arguments. That is strictly MORE than
  // the string comparison was checking, because it exercises the handler instead of matching its text.
  s = s.replace(/\s+on[a-z]+="[^"]*"/g, '');

  // R3 — EMPTY-ELEMENT SERIALISATION.
  // `ic()` writes `<path d="…"/>`; React writes `<path d="…"></path>`. React writes `<input …/>`; the
  // legacy string writes `<input …>`. All three spellings are the same element. Safe because EMPTY_TAGS
  // are exactly the elements that cannot contain an element child, so there is no position a dropped
  // child could have occupied. The `/` in `<x/>` is dropped by R4 below, which rebuilds every open tag.
  s = s.replace(new RegExp(`</(?:${EMPTY_TAGS})>`, 'gi'), '');

  // R4 — ATTRIBUTE NAME CASE, ATTRIBUTE ORDER, BOOLEAN ATTRIBUTE SPELLING.
  //   • name case: HTML attribute names are case-insensitive; React emits `colSpan`, the legacy string
  //     emits `colspan`. Lowercasing both sides compares the same attribute — a RENAMED attribute is a
  //     different name and still diffs.
  //   • order: attribute order is not observable, by a browser or a user or the DOM. React also fixes
  //     the position of a few props regardless of JSX order (`value` lands after `style` on an <input>
  //     however it is written), so matching the legacy order is not reachable by writing the JSX
  //     differently. Sorting cannot hide an added, dropped or changed attribute; only a reordering,
  //     which is not a change. Sorted BY NAME so a changed value cannot move an attribute.
  //   • boolean spelling: `selected` and `selected=""` are the same attribute; React emits the second.
  s = s.replace(TAG, (_m: string, tag: string, attrs: string) => {
    const parts: [string, string][] = [];
    for (const m of (attrs || '').matchAll(ATTR)) {
      const name = m[1].toLowerCase();
      if (!name) continue;
      if (m[2] === undefined) parts.push([name, name]);                              // already bare
      else if (BOOLEAN_ATTRS.has(name) && m[2] === '') parts.push([name, name]);     // x="" → x
      else parts.push([name, `${name}="${m[2]}"`]);
    }
    parts.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const rendered = parts.map((p) => p[1]).join(' ');
    return `<${tag.toLowerCase()}${rendered ? ' ' + rendered : ''}>`;
  });

  // R5 — A `<select>`'s DEFAULT SELECTION, declared vs implied.
  // React declares the selected option for every controlled <select>; the legacy string only writes
  // `selected` where it is tracking a value. So where the legacy leaves the first option unmarked and
  // lets the browser's default (select the first non-disabled option) apply — `hra_emp`'s
  // "— pick an employee —" — React writes `selected` on that same first option. Identical initial state,
  // different spelling of it.
  //
  // Deliberately the narrowest rule that covers it: `selected` is dropped from an option ONLY when it is
  // the FIRST option of its select AND no other option in that select carries it. So a selection that
  // moved to a different option still diffs (the mark is not on the first option, so it survives on one
  // side and not the other), and a select with two marked options — which is a real defect — is left
  // alone. What it does absorb is "one side marks the first option and the other relies on the default",
  // which is the same screen either way. The `catches a changed role` case below covers the moved-mark
  // direction, so this is not taken on trust.
  s = s.replace(/<select\b[\s\S]*?<\/select>/g, (block) => {
    const opts = [...block.matchAll(/<option\b[^>]*>/g)];
    const marked = opts.filter((o) => /\sselected(?=[\s>])/.test(o[0]));
    if (marked.length !== 1 || marked[0][0] !== opts[0]?.[0] || marked[0].index !== opts[0].index) return block;
    return block.slice(0, marked[0].index) +
      marked[0][0].replace(/\sselected(?=[\s>])/, '') +
      block.slice(marked[0].index! + marked[0][0].length);
  });

  // R6 — NUMERIC CHARACTER REFERENCES for the same character.
  // hros.html's esc() (hros.html:1267) emits `&#39;` for an apostrophe; React's text escaper emits
  // `&#x27;`. Decoding both compares the text rather than the spelling of the escape. Runs AFTER R4 on
  // purpose: decoding `&quot;` before the attributes are parsed would inject an unescaped `"` into an
  // attribute value and break the parse. (This screen's fixture contains no quotes, so nothing here
  // fires today — it is included because the difference between the two escapers is verified, not
  // speculative, and the next screen with an apostrophe in its data hits it.)
  s = s.replace(/&#0*39;|&#[xX]0*27;/g, "'").replace(/&#0*34;|&#[xX]0*22;|&quot;/g, '"');

  // R3 can leave a line that held nothing but a closing tag empty; the shared normaliser drops blank
  // lines, so re-run it to land in exactly the shape both sides are compared in.
  return normalise(s);
}
