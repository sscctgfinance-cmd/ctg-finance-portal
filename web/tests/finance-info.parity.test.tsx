// Finance OS · Company Info — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.info.html` was captured from `infoRender()` (app.html:5937) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts,
// web/tests/parity.ts or web/tests/handlers.ts. The component is rendered with `renderToStaticMarkup`
// from the SAME fixture the golden was captured from, normalised by the harness's own normalise(),
// relaxed by the documented layer in ./parity.ts, and compared.
//
// NO SEVENTH RELAXATION IN parity.ts. This screen reuses its six unchanged, which is now what all
// thirty-six screens of both apps have done.
//
// ── ONE SCREEN-LOCAL RULE: `collapseEmptyDecl` ────────────────────────────────────────────────────
// app.html:5985 interpolates a conditional straight INTO a style attribute —
// `'<div style="font-size:13px;'+(filled?'':'color:var(--muted);opacity:.5')+';margin-top:2px;…"'` —
// so all eight filled Quick-view fields carry `style="font-size:13px;;margin-top:2px;…"`, with an EMPTY
// declaration in the middle. React's style serialiser emits nothing at all for an empty value, so
// neither side can be spelled into the other. `collapseEmptyDecl` below turns `;;` into `;` INSIDE a
// `style="…"` attribute value on BOTH sides, and nowhere else.
//
// This is the same KIND of finding as finance-close's `dropEmptyStyle`, hr-calculator's `dedupeAttrs`
// and hr-employees' `decodeAttrAmp`: legacy markup React's serialiser is incapable of producing. It
// stays in THIS file rather than moving into web/tests/parity.ts — the shared layer is not the place
// for a rule one screen in forty needs, and `tests/golden/finance.info.html` is the ONLY golden in the
// repo containing `;;` at all. What it cannot hide is in `the empty declaration rule still bites`.
//
// ── THE GOLDEN'S SHAPE, DECLARED ──────────────────────────────────────────────────────────────────
// TWO sections, and NEITHER is an intermediate state — see finance-info.tsx's header for the reasoning
// and `the golden's two sections` below for the proof, read out of app.html rather than asserted.
//   #info                  the loaded VIEW-mode screen (spin('info') written to the same id and lost)
//   #info-search-results   EMPTY — `infoRenderSearch()` writes '' on a blank query (app.html:5875)
// Inside `#info` there are FIVE regions: the toolbar, the search panel, the company tabs, `#info-form`
// (sidebar + right column: heading, updated line, Quick view, 19 section cards, save bar) and the
// responsive `<style>`. The golden covers ONE combination of the screen's modes; everything else —
// edit mode, `editable:false`, the four pre-render documents, a populated search, a non-root folder,
// all three document-expiry badges, an empty list section and an `updated_at` — is outside the diff
// and pinned by assertion below.
//
// ── WHAT THIS SCREEN RISKS ─────────────────────────────────────────────────────────────────────────
// It is a company's statutory identity: SSM numbers, tax and SST registrations, directors' ICs,
// shareholders, bank accounts and licence numbers. Nineteen visually similar cards and two dozen
// visually identical copy buttons is exactly where a wrong value is invisible. So: a copy button that
// copies its NEIGHBOUR's number, a company tab that switches to the wrong tenant, a fill badge whose
// colour threshold moved, a section marked filled that is empty, a document row wired to another
// document's id, an edit field that lost `data-k` (which saves as blank), a list row whose delete
// button carries the wrong index, and a save posted against the wrong company. Each has its own case.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES } from '../../tests/render_fixtures';
import FinanceInfo, {
  INFO_DOC_CATEGORIES, INFO_LIST_KEYS, INFO_SECTIONS, INFO_SUMMARY_KEYS, MY_STATES, SearchResults,
  inDaysLocalISO, infoCompanyProgress, infoDocBytes, infoDocIcon, infoFilled, infoFolderPath,
  infoReachable, infoSearchAll, infoSectionFilled, printDocHtml, progressColour, saveBody, savePatch,
  searchOpen, todayLocalISO,
  type InfoCompany, type InfoDoc, type InfoFolder,
} from '../src/finance-info';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');
const SRC = readFileSync(join(REPO, 'web', 'src', 'finance-info.tsx'), 'utf8');

/** `#info` is the tab div `render('info')` writes into — the loaded screen. */
const GOLDEN = goldenSection('finance.info', 'info');
/** `#info-search-results` is nested INSIDE it and written separately. Empty; see the header. */
const SEARCH_GOLDEN = goldenSection('finance.info', 'info-search-results');

const COMPANIES = (FIXTURES.company_info_get as { companies: InfoCompany[] }).companies;
const DOC_ROWS = (FIXTURES.company_doc_list as { documents: InfoDoc[] }).documents;
const FOLDER_ROWS = (FIXTURES.company_folder_list as { folders: InfoFolder[] }).folders;

/** `renderInfo()` groups both lists by tenant before rendering — app.html:5532-5533. */
function byTenant<T extends { tenant_id: string }>(rows: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[r.tenant_id] ||= []).push(r);
  return out;
}
const DOCS = byTenant(DOC_ROWS);
const FOLDERS = byTenant(FOLDER_ROWS);

/** The instant the fixture was captured at is irrelevant to the golden — no document has an expiry. */
const NOW = Date.parse('2026-08-21T02:00:00.000Z');

const noop = () => {};

type Props = Parameters<typeof FinanceInfo>[0];

function screen(over: Partial<Props> = {}) {
  return (
    <FinanceInfo
      companies={COMPANIES}
      // INFO_ACTIVE / INFO_MODE / INFO_SEARCH / INFO_DIRTY as renderInfo() leaves them on a first open:
      // the first company (app.html:5527), 'view' (app.html:5393), and the module's own blanks.
      active={COMPANIES[0].tenant_id}
      editable
      mode="view"
      search=""
      dirty={false}
      docs={DOCS}
      folders={FOLDERS}
      folderActive={{}}
      now={NOW}
      refused={null}
      failed={null}
      onSearchInput={noop}
      onSetMode={noop}
      onPrint={noop}
      onSwitch={noop}
      onJump={noop}
      onJumpHit={noop}
      onCopy={noop}
      onFolderOpen={noop}
      onFolderCreate={noop}
      onFolderDelete={noop}
      onDocMove={noop}
      onDocDownload={noop}
      onDocDelete={noop}
      onDocUpload={noop}
      onRowAdd={noop}
      onRowDel={noop}
      onSave={noop}
      {...over}
    />
  );
}

/**
 * ── THE SCREEN-LOCAL RULE ─────────────────────────────────────────────────────────────────────────
 *
 * `;;` → `;`, only inside a `style="…"` attribute value. An empty CSS declaration is discarded by every
 * CSS parser, so both spellings compute the same style; React cannot emit one, because its serialiser
 * skips a declaration whose value is empty. Applied to BOTH sides, so a genuine difference survives it.
 *
 * It cannot hide: a DROPPED declaration (the run either side of the `;;` still has to match), a CHANGED
 * value, an added declaration, an empty `style=""` (no `;;` in it), or a `;;` anywhere outside a style
 * attribute — including inside an `on*=` handler, which R1 has not stripped yet at this point.
 */
const collapseEmptyDecl = (html: string) =>
  html.replace(/ style="([^"]*)"/g, (_m, css: string) => ' style="' + css.replace(/;{2,}/g, ';') + '"');

/** Both sides read as the same document, then compared under ./parity.ts's six relaxations. */
const sameDocument = (html: string) => relax(collapseEmptyDecl(html));

const rendered = (over: Partial<Props> = {}) => sameDocument(renderToStaticMarkup(screen(over)));

const searchPanel = (search: string) =>
  sameDocument(renderToStaticMarkup(
    <SearchResults search={search} companies={COMPANIES} docs={DOCS} onJumpHit={noop} />,
  ));

describe('Finance Company Info — React vs the legacy golden', () => {
  it('renders the same document infoRender() writes into #info', () => {
    expect(rendered()).toBe(sameDocument(GOLDEN));
  });

  it('renders the same (empty) body infoRenderSearch() writes into #info-search-results', () => {
    expect(searchPanel('')).toBe(sameDocument(SEARCH_GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/* ══ Handler parity ════════════════════════════════════════════════════════════════════════════════
 *
 * R1 drops `on*=` from the string comparison, so `infoCopy("C 58427907080",this)` and
 * `infoCopy("C58427907",this)` are byte-identical in stripped output — and two dozen identical 📋
 * buttons sit next to two dozen statutory registration numbers. This puts the arguments back.
 *
 * THREE established widenings, all in this file and none of them touching web/tests/handlers.ts:
 *
 *  • `&quot;`-ENCODED string literals. `infoCopy()`'s argument is written with
 *    `JSON.stringify(v).replace(/"/g,'&quot;')` (app.html:5985), so it reaches the golden with no real
 *    quote characters in it and `goldenHandlers()`'s quoted-only extraction returns [] for EVERY copy
 *    button. Decoding `&quot;` first is strictly additive: it turns [] into the value being copied.
 *
 *  • BARE-WORD single arguments — `infoFolderOpen(f1)`, `infoFolderOpen(null)`, `infoDocDownload(d1)`.
 *    The legacy interpolates a folder/document id UNQUOTED (a live one is a bigint); the fixture's are
 *    strings, so the golden carries a bare identifier that is neither a quoted literal nor an integer.
 *    Without this, six folder buttons and one download button all extract [] and the check would pass
 *    with every folder opening the same one. This is the established bare-integer widening (nine
 *    screens now, CLAUDE.md) with the token class widened to cover an identifier and `null`.
 *
 *  • The SIDEBAR ANCHORS. Their handler calls no screen function at all: it is
 *    `event.preventDefault();document.getElementById('info-sec-X').scrollIntoView({behavior:'smooth',
 *    block:'start'})`, so the literals are the target id AND the two scroll options. The React port
 *    calls `onJump('info-sec-X')`, and the scroll options are constants of the mechanism — the same
 *    thing `this.value` is, and the same treatment finance-close's `stubArgs()` gives a ternary. The
 *    escape is POSITIONAL and pinned to the legacy text VERBATIM by `SCROLL`, so a link that jumped to
 *    a different section, or lost its preventDefault, still fails.
 */

const SCROLL = /^event\.preventDefault\(\);document\.getElementById\('(info-sec-[a-z]+)'\)\.scrollIntoView\(\{behavior:'smooth',block:'start'\}\)$/;
/** `this.style.background='…'` — the folder tree's hover repaints; hr-expenses'/pharm's case. */
const HOVER = /^this\.style\.background='[^']*'$/;

function identArgs(raw: string): string[] {
  const s = raw.replace(/&quot;/g, '"');
  return [...s.matchAll(/'([^']*)'|"([^"]*)"|\(\s*(null|-?\d+|[A-Za-z_]\w*)\s*\)/g)]
    .map((m) => m[1] ?? m[2] ?? m[3]);
}

/** What the golden says this handler identifies. */
function wantArgs(raw: string): string[] {
  const scroll = SCROLL.exec(raw);
  if (scroll) return [scroll[1]];
  if (HOVER.test(raw)) return [];
  return identArgs(raw);
}

function assertHandlerParity(over: Partial<Props> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args
        .filter((a) => a === null || ((typeof a === 'string' || typeof a === 'number') && a !== STUB_VALUE))
        .map(String),
    });
  misfire = record('misfire');

  const got = reactHandlers(screen({
    onSearchInput: record('search') as never,
    onSetMode: record('mode') as never,
    onPrint: record('print') as never,
    onSwitch: record('switch') as never,
    onJump: record('jump') as never,
    onCopy: record('copy') as never,
    onFolderOpen: record('folder') as never,
    onDocDownload: record('download') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));

  got.forEach((h, i) => {
    const before = calls.length;
    h.invoke();
    if (calls.length > before) return;
    // A handler that called nothing. On this screen exactly the six folder-tree hover repaints
    // legitimately do — they assign `this.style.background` and reach no screen function. The position
    // is checked against the golden's own text, so anything else landing here is a handler that
    // quietly stopped calling anything, and it still fails.
    expect(want[i].raw, `handler ${i} (${h.attr}) called nothing`).toMatch(HOVER);
    calls.push({ attr: h.attr, args: [] });
  });

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => wantArgs(h.raw)));

  // Guard the guard. Vacuous versions of the three assertions above are how R1 becomes the blind strip
  // it is not allowed to be, so each is required to have something to say.
  expect(want.length).toBeGreaterThan(60);
  expect(want.some((h) => SCROLL.test(h.raw))).toBe(true);
  expect(want.some((h) => HOVER.test(h.raw))).toBe(true);
  expect(want.filter((h) => wantArgs(h.raw).length > 0).length).toBeGreaterThan(30);
  // The `&quot;` decode must actually be doing work, or the copy buttons are unchecked.
  expect(want.some((h) => h.raw.includes('&quot;') && wantArgs(h.raw).length > 0)).toBe(true);
  // And so must the bare-word widening, or every folder button is unchecked.
  expect(want.some((h) => /^infoFolderOpen\(/.test(h.raw) && wantArgs(h.raw).length === 1)).toBe(true);
}

/**
 * Every HOST element in a rendered tree, with its props — a two-line walk, local to this file because
 * `reactHandlers()` deliberately hands back only `invoke()` and some of this screen's handlers have to
 * be called with an event the shared `{target:{value}}` stub cannot carry (`stopPropagation`).
 */
function collectHostHandlers(node: unknown): { type: string; props: Record<string, unknown> }[] {
  const out: { type: string; props: Record<string, unknown> }[] = [];
  const walk = (n: unknown): void => {
    if (n === null || n === undefined || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const el = n as { type?: unknown; props?: Record<string, unknown> };
    if (!('props' in el)) return;
    const props = el.props || {};
    if (typeof el.type === 'string') out.push({ type: el.type, props });
    if (typeof el.type === 'function') { walk((el.type as (p: unknown) => unknown)(props)); return; }
    walk(props.children);
  };
  walk(node);
  return out;
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

/* ══ The golden's two sections — proved out of app.html, not claimed ═══════════════════════════════ */

describe("the golden's two sections", () => {
  const renderInfo = APP.slice(APP.indexOf('async function renderInfo(){'), APP.indexOf('// ── Document helpers ──'));
  const infoRender = APP.slice(APP.indexOf('function infoRender(){'), APP.indexOf('// View-mode body:'));

  it('is #info and #info-search-results, and nothing else', () => {
    const text = readFileSync(join(REPO, 'tests', 'golden', 'finance.info.html'), 'utf8');
    expect([...text.matchAll(/^<!-- #(\S+) -->$/gm)].map((m) => m[1])).toEqual(['info', 'info-search-results']);
  });

  it('#info is the LOADED screen: spin() writes the SAME id and is overwritten', () => {
    // The finance.approvals case, not finance.close's — a skeleton written to `#info` and then
    // replaced leaves no trace, so the golden is the screen an operator sees.
    expect(renderInfo).toContain("spin('info')");
    expect(APP).toContain("function spin(id){document.getElementById(id).innerHTML=");
    expect(infoRender).toContain("document.getElementById('info').innerHTML=");
  });

  it('#info-search-results is a NESTED id infoRenderSearch() writes separately, and it is empty', () => {
    // finance.gateway's `#gw-ref` shape: an element with an id inside the section, written again.
    expect(infoRender).toContain('<div id="info-search-results"');
    expect(infoRender.trimEnd()).toMatch(/infoRenderSearch\(\);\s*}$/);
    expect(APP).toContain("if(!INFO_SEARCH.trim()){ box.innerHTML=''; box.style.display='none'; return; }");
    expect(SEARCH_GOLDEN.trim()).toBe('');
  });

  it('infoRender() does nothing VISIBLE after its #info write', () => {
    const after = infoRender.slice(infoRender.indexOf("<style>@media(max-width:880px)"));
    // The three statements app.html:6019-6027 really are: an addEventListener (edit mode only), a
    // setDirty (no DOM at all — app.html:1282) and infoRenderSearch(). No appendChild the way
    // finance.qinv has, no `.className=` the way finance.users has, no `.value=`.
    expect(after).not.toContain('appendChild');
    expect(after).not.toMatch(/\.className\s*=/);
    expect(after).not.toMatch(/\.value\s*=/);
    expect(after).toContain("setDirty('info', false)");
    expect(after).toContain('infoRenderSearch()');
    expect(APP.slice(APP.indexOf('function setDirty(name, v){'), APP.indexOf('function setDirty(name, v){') + 250)).not.toContain('innerHTML');
  });

  it('renderInfo() sets only loaded.info after infoRender()', () => {
    expect(renderInfo).toContain('infoRender();\n    loaded.info=true;');
  });
});

/* ══ The gate ══════════════════════════════════════════════════════════════════════════════════════ */

describe('the gate — app.html:1424, "always visible, gated server-side"', () => {
  const block = APP.slice(APP.indexOf("document.querySelectorAll('.tab').forEach"), APP.indexOf("document.querySelectorAll('.tab-cat')"));

  it('is unconditional in app.html — no role, no feature flag, and NOT the fall-through', () => {
    expect(block).toContain("else if(t==='info') el.classList.remove('hide');");
    expect(block).not.toMatch(/t==='info'[^\n]*canManage/);
    expect(block).not.toMatch(/t==='info'[^\n]*feats/);
    // It is inside the `if/else if` chain that RESTARTS at `ctgaccess`, so it never reaches
    // app.html:1439's `else el.classList.toggle('hide', feats.indexOf(t)<0)`. Copying a neighbour's
    // line — `wht`, `selfbill`, `gateway` are all `!canManage` — would hide it from everyone who needs it.
    expect(block.indexOf("t==='info'")).toBeGreaterThan(block.indexOf("t==='ctgaccess'"));
    expect(block).toContain("else el.classList.toggle('hide', feats.indexOf(t)<0);");
  });

  it('opens for every shape of permission, including none at all', () => {
    expect(infoReachable()).toBe(true);
  });

  it('the nav agrees — nav.ts:192 mirrors the same line', () => {
    const nav = readFileSync(join(REPO, 'web', 'src', 'nav.ts'), 'utf8');
    expect(nav).toContain("id === 'info' || id === 'pharm' || id === 'calendar'");
  });

  it('the SERVER is the boundary — company_info_save wants superAdmin', () => {
    const fin = readFileSync(join(REPO, 'supabase', 'functions', 'portal', 'finance.ts'), 'utf8');
    const at = fin.indexOf('if (api === "company_info_save")');
    expect(fin.slice(at, at + 200)).toContain('superAdmin(me)');
  });
});

/* ══ The refusal — the branch that carries this screen's security meaning ══════════════════════════ */

describe('the four pre-render documents are four DIFFERENT documents', () => {
  // `renderInfo()` (app.html:5520) has four exits before `infoRender()` and no golden holds any of
  // them. Collapsing any pair turns one into another, and the pair that matters is refusal → empty:
  // a refusal rendered as "no companies" reads as success on a screen whose gate IS the server.
  const html = (over: Partial<Props>) => renderToStaticMarkup(screen(over));

  it('a refusal is the 🔒 panel carrying the server\'s own message', () => {
    const out = html({ companies: null, refused: 'no access to any company' });
    expect(out).toContain('🔒');
    expect(out).toContain('no access to any company');
    expect(out).not.toContain('info-form');
    expect(out).not.toContain('🏢');
    expect(out).not.toContain('Quick view');
  });

  it('a refusal never leaks a previously loaded company past it', () => {
    // The route clears INFO_DATA, but the component must refuse on `refused` regardless of what else
    // it is holding — otherwise a re-open after a permission change paints the old record.
    const out = html({ refused: 'unauthorized' });
    expect(out).toContain('🔒');
    expect(out).not.toContain('SKINDAE SDN BHD');
    expect(out).not.toContain('201801012345');
  });

  it('an empty list is 🏢, not 🔒 — a different sentence and a different meaning', () => {
    const out = html({ companies: [] });
    expect(out).toContain('🏢');
    expect(out).toContain('No companies you can access yet.');
    expect(out).not.toContain('🔒');
  });

  it('null is the skeleton, NOT the empty list', () => {
    expect(html({ companies: null })).toContain('sk-card');
    expect(html({ companies: null })).not.toContain('🏢');
  });

  it('a thrown error is ⚠️, not a refusal', () => {
    const out = html({ companies: null, failed: 'Failed to fetch' });
    expect(out).toContain('⚠️');
    expect(out).toContain('Failed to fetch');
    expect(out).not.toContain('🔒');
  });

  it('mirrors renderInfo()\'s own four exits', () => {
    const renderInfo = APP.slice(APP.indexOf('async function renderInfo(){'), APP.indexOf('// ── Document helpers ──'));
    expect(renderInfo).toContain('<div class="empty-ico">🔒</div>');
    expect(renderInfo).toContain('<div class="empty-ico">🏢</div>');
    expect(renderInfo).toContain('<div class="empty-ico">⚠️</div>');
    expect(renderInfo).toContain("spin('info')");
  });
});

/* ══ The schema is app.html's, not a retyped copy ══════════════════════════════════════════════════ */

describe('the section schema, read out of app.html at run time', () => {
  // The `profileBody()` FIELD-SET rule. A retyped schema agrees with a widened or narrowed port by
  // construction, and here the field set decides what the EDIT form renders — which decides what
  // `infoCollect()` reads back and posts. A key that drifts saves a company's SSM number as ABSENT.
  const block = APP.slice(APP.indexOf('const INFO_SECTIONS = ['), APP.indexOf('// Document categories'));

  it('has the same 19 sections, in order, with the same ids, icons and titles', () => {
    const legacy = [...block.matchAll(/\{\s*id:'([a-z]+)',\s*icon:'([^']*)',\s*title:'([^']*)'/g)]
      .map((m) => ({ id: m[1], icon: m[2], title: m[3] }));
    expect(legacy.length).toBe(19);
    expect(INFO_SECTIONS.map((s) => ({ id: s.id, icon: s.icon, title: s.title }))).toEqual(legacy);
  });

  it('has the same field keys, in the same order, under the same sections', () => {
    // Split app.html's array on its own section boundaries so a key cannot be counted under a
    // neighbour, then compare each section's `{k:'…'}` sequence — fields OR columns.
    const starts = [...block.matchAll(/\{\s*id:'([a-z]+)',/g)];
    const perSection = starts.map((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index! : block.length;
      return [...block.slice(m.index!, end).matchAll(/\{k:'([a-z_]+)'/g)].map((k) => k[1]);
    });
    const ours = INFO_SECTIONS.map((s) => (s.fields ? s.fields.map((f) => f.k) : (s.cols || []).map((c) => c.k)));
    expect(ours).toEqual(perSection);
  });

  it('has the same eight Quick-view keys, with the same labels and copy flags', () => {
    const sum = APP.slice(APP.indexOf('const INFO_SUMMARY_KEYS = ['), APP.indexOf('function infoFilled'));
    const legacy = [...sum.matchAll(/\{k:'([a-z_]+)',l:'([^']*)'(,copy:true)?\}/g)]
      .map((m) => ({ k: m[1], l: m[2], copy: !!m[3] }));
    expect(legacy.length).toBe(8);
    expect(INFO_SUMMARY_KEYS.map((k) => ({ k: k.k, l: k.l, copy: !!k.copy }))).toEqual(legacy);
  });

  it('has the same document categories and the same Malaysian states', () => {
    const cats = /const INFO_DOC_CATEGORIES = \[([^\]]*)\]/.exec(APP)!;
    expect(INFO_DOC_CATEGORIES).toEqual(cats[1].split(',').map((s) => s.trim().slice(1, -1)));
    const states = /const MY_STATES=\[([^\]]*)\]/.exec(APP)!;
    expect(MY_STATES).toEqual(states[1].split(',').map((s) => s.trim().slice(1, -1)));
  });

  it('rewrites exactly the eight list keys infoCollect() does', () => {
    const collect = APP.slice(APP.indexOf('function infoCollect(){'), APP.indexOf('function infoRowAdd('));
    const keys = /\[([^\]]*)\]\.forEach\(key=>\{/.exec(collect)!;
    expect(INFO_LIST_KEYS).toEqual(keys[1].split(',').map((s) => s.trim().slice(1, -1)));
    // …and every one of them is a `list:` section, so the edit form actually renders a table for it.
    expect(INFO_SECTIONS.filter((s) => s.list).map((s) => s.list).sort()).toEqual([...INFO_LIST_KEYS].sort());
  });
});

/* ══ The string diff still bites ═══════════════════════════════════════════════════════════════════ */

describe('the comparison still bites', () => {
  const want = sameDocument(GOLDEN);
  const withCo = (i: number, over: Partial<InfoCompany>) =>
    rendered({ companies: COMPANIES.map((c, k) => (k === i ? { ...c, ...over } : c)) });

  it('catches a changed statutory number — the whole point of the screen', () => {
    expect(withCo(0, { ssm_new: '201801012346' })).not.toBe(want);
    expect(withCo(0, { income_tax_no: 'C 58427907081' })).not.toBe(want);
    expect(withCo(0, { epf_no: '13579247' })).not.toBe(want);
  });

  it('catches a field that emptied — the — placeholder is a different document', () => {
    expect(withCo(0, { sst_no: '' })).not.toBe(want);
  });

  it('catches a director dropped, renamed, or with a changed IC', () => {
    const d = COMPANIES[0].directors as Record<string, unknown>[];
    expect(withCo(0, { directors: d.slice(1) })).not.toBe(want);
    expect(withCo(0, { directors: [{ ...d[0], name: 'CALLUM YEO' }, d[1]] })).not.toBe(want);
    expect(withCo(0, { directors: [{ ...d[0], ic: '880202-10-5534' }, d[1]] })).not.toBe(want);
  });

  it('catches a bank account number that changed by one digit', () => {
    const b = COMPANIES[0].bank_accounts as Record<string, unknown>[];
    expect(withCo(0, { bank_accounts: [{ ...b[0], account_no: '512011223345' }, b[1]] })).not.toBe(want);
  });

  it('catches a capital figure that changed, and its RM formatting', () => {
    expect(withCo(0, { authorised_capital: 400001 })).not.toBe(want);
    // `money:true` is what makes it "RM 400,000.00" rather than "400000". A field that lost the flag
    // prints a bare integer on a document an auditor reads.
    expect(rendered()).toContain('RM 400,000.00');
  });

  it('catches the two companies swapping places', () => {
    expect(rendered({ companies: [COMPANIES[1], COMPANIES[0]] })).not.toBe(want);
  });

  it('catches the active company switching', () => {
    expect(rendered({ active: COMPANIES[1].tenant_id })).not.toBe(want);
  });

  it('highlights the ACTIVE company tab, not simply the first one', () => {
    // The golden's active company IS the first, so `x === list[0]` and `x.tenant_id === active` agree
    // on it byte for byte — found by introducing exactly that. The highlighted tab is the only thing
    // on screen saying whose SSM number, bank accounts and directors are being read.
    const tabClass = (html: string) => [...html.matchAll(/<button class="(btn(?: p)?)"[^>]*><span>([^<]*)</g)]
      .map((m) => [m[2], m[1]] as const);
    expect(tabClass(renderToStaticMarkup(screen())))
      .toEqual([['SKINDAE SDN BHD', 'btn p'], ['I PROCARE MALAYSIA SDN BHD', 'btn']]);
    expect(tabClass(renderToStaticMarkup(screen({ active: COMPANIES[1].tenant_id }))))
      .toEqual([['SKINDAE SDN BHD', 'btn'], ['I PROCARE MALAYSIA SDN BHD', 'btn p']]);
    // …and the body underneath follows it, so the highlight is never pointing at the wrong record.
    expect(renderToStaticMarkup(screen({ active: COMPANIES[1].tenant_id })))
      .toContain('<h2 style="margin:0 0 4px;font-size:20px;letter-spacing:-.02em">I PROCARE MALAYSIA SDN BHD</h2>');
  });

  it('forces https:// onto a website that has no scheme', () => {
    // The fixture's website already carries `https://`, so the OTHER branch of app.html:6036 is in no
    // golden — found by deleting it and watching every test stay green. A bare `skindae.test` in the
    // href is resolved RELATIVE to the page, so the operator clicks the company's website and lands on
    // /finance/info/skindae.test.
    const bare = renderToStaticMarkup(screen({ companies: [{ ...COMPANIES[0], website: 'skindae.test' }] }));
    expect(bare).toContain('href="https://skindae.test"');
    expect(bare).toContain('>skindae.test ↗<');
    // An absolute URL is left alone rather than double-prefixed.
    expect(renderToStaticMarkup(screen())).toContain('href="https://skindae.test"');
    expect(renderToStaticMarkup(screen())).not.toContain('https://https://');
    // http:// counts as a scheme too — app.html tests `indexOf('http') === 0`.
    expect(renderToStaticMarkup(screen({ companies: [{ ...COMPANIES[0], website: 'http://x.test' }] })))
      .toContain('href="http://x.test"');
  });

  it('catches a fill badge moving — 19/19 and 12/19 are the operator\'s to-do list', () => {
    // Emptying a whole section drops the count AND flips its sidebar dot.
    expect(withCo(0, { auditor: '', company_secretary: '', secretary_firm: '' })).not.toBe(want);
  });

  it('catches a document that vanished, or moved folder', () => {
    const docs = { ...DOCS, [COMPANIES[0].tenant_id]: DOCS[COMPANIES[0].tenant_id].slice(1) };
    expect(rendered({ docs })).not.toBe(want);
    const moved = DOCS[COMPANIES[0].tenant_id].map((d, i) => (i === 0 ? { ...d, folder_id: 'f1' } : d));
    expect(rendered({ docs: { ...DOCS, [COMPANIES[0].tenant_id]: moved } })).not.toBe(want);
  });

  it('catches a folder renamed, dropped, or re-parented', () => {
    const f = FOLDERS[COMPANIES[0].tenant_id];
    expect(rendered({ folders: { ...FOLDERS, [COMPANIES[0].tenant_id]: [{ ...f[0], name: 'Statutorie' }, f[1], f[2]] } })).not.toBe(want);
    expect(rendered({ folders: { ...FOLDERS, [COMPANIES[0].tenant_id]: f.slice(1) } })).not.toBe(want);
    expect(rendered({ folders: { ...FOLDERS, [COMPANIES[0].tenant_id]: [f[0], f[1], { ...f[2], parent_id: 'f1' }] } })).not.toBe(want);
  });

  it('catches the active folder moving off the root', () => {
    expect(rendered({ folderActive: { [COMPANIES[0].tenant_id]: 'f2' } })).not.toBe(want);
  });

  it('catches edit mode — a whole different body for all 19 sections', () => {
    expect(rendered({ mode: 'edit' })).not.toBe(want);
  });

  it('catches editable:false — the mode button and the save-bar sentence', () => {
    expect(rendered({ editable: false })).not.toBe(want);
    // …and `mode:'edit'` WITHOUT `editable` must render the VIEW body, exactly as app.html:5939 does.
    expect(rendered({ editable: false, mode: 'edit' })).toBe(rendered({ editable: false, mode: 'view' }));
  });

  it('catches a search that opened the results panel', () => {
    expect(rendered({ search: 'EPF' })).not.toBe(want);
  });

  it('catches an updated_at line appearing — a branch the fixture leaves out', () => {
    expect(withCo(0, { updated_at: '2026-08-20T09:15:00Z', updated_by_email: 'boss@ctg.test' })).not.toBe(want);
  });
});

describe('the empty declaration rule still bites', () => {
  // What collapseEmptyDecl absorbs and what it must not. `;;` → `;` inside a style value only.
  it('the golden really does carry `;;`, and only in the Quick-view card', () => {
    expect(GOLDEN.match(/;;/g)?.length).toBe(8);
    expect([...GOLDEN.matchAll(/style="([^"]*;;[^"]*)"/g)].map((m) => m[1])).toEqual(
      new Array(8).fill('font-size:13px;;margin-top:2px;display:flex;align-items:center;gap:6px'));
  });

  it('does not touch a style with content, so a changed declaration still diffs', () => {
    expect(collapseEmptyDecl('<i style="font-size:13px;margin-top:2px">')).toBe('<i style="font-size:13px;margin-top:2px">');
    expect(collapseEmptyDecl('<i style="a:1;;b:2">')).not.toBe(collapseEmptyDecl('<i style="a:1;;b:3">'));
  });

  it('does not absorb a DROPPED declaration', () => {
    expect(collapseEmptyDecl('<i style="a:1;;b:2">')).not.toBe(collapseEmptyDecl('<i style="a:1;;">'));
    // The Quick-view case itself: an unfilled field carries the muted colour, and it still diffs.
    expect(collapseEmptyDecl('<i style="font-size:13px;;margin-top:2px">'))
      .not.toBe(collapseEmptyDecl('<i style="font-size:13px;color:var(--muted);opacity:.5;margin-top:2px">'));
  });

  it('leaves an empty style="" alone — finance.close\'s finding is a different one', () => {
    expect(collapseEmptyDecl('<i style="">')).toBe('<i style="">');
  });

  it('never fires outside a style attribute — including inside a handler', () => {
    expect(collapseEmptyDecl('<i onclick="a();;b()">')).toBe('<i onclick="a();;b()">');
    expect(collapseEmptyDecl('<i>a;;b</i>')).toBe('<i>a;;b</i>');
  });

  it('is needed at all — the raw render and the raw golden disagree without it', () => {
    expect(relax(renderToStaticMarkup(screen()))).not.toBe(relax(GOLDEN));
  });
});

/* ══ Mis-wired handlers ════════════════════════════════════════════════════════════════════════════ */

describe('mis-wired handlers — invisible to the string diff above', () => {
  it('catches a copy button copying its neighbour\'s number', () => {
    expect(() => assertHandlerParity({ onCopy: (() => misfire('C 58427907080')) as never })).toThrow(/deeply equal/);
  });

  it('catches a copy button that copies nothing at all', () => {
    expect(() => assertHandlerParity({ onCopy: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches a company tab switching to the wrong tenant', () => {
    expect(() => assertHandlerParity({ onSwitch: (() => misfire(COMPANIES[0].tenant_id)) as never })).toThrow(/deeply equal/);
  });

  it('catches a folder button opening the wrong folder', () => {
    expect(() => assertHandlerParity({ onFolderOpen: (() => misfire('f1')) as never })).toThrow(/deeply equal/);
  });

  it('catches "All documents" losing its null — root and "no folder" are not the same', () => {
    expect(() => assertHandlerParity({ onFolderOpen: ((f: unknown) => (f === null ? misfire() : misfire(f))) as never })).toThrow(/deeply equal/);
  });

  it('catches a download wired to another document', () => {
    expect(() => assertHandlerParity({ onDocDownload: (() => misfire('d2')) as never })).toThrow(/deeply equal/);
  });

  it('catches a sidebar link jumping to the wrong section', () => {
    expect(() => assertHandlerParity({ onJump: (() => misfire('info-sec-notes')) as never })).toThrow(/deeply equal/);
  });

  it('catches a sidebar link that stopped preventing the default jump', () => {
    // The golden's handler starts `event.preventDefault();` and the anchor keeps its `href`, so
    // without it the browser hard-jumps to the fragment while the smooth scroll is still running —
    // and the fragment lands in the URL, which on this route is a second navigation scheme. The
    // recorded ARGUMENT is the same either way, so handler parity cannot see it (found by removing
    // it); each anchor is invoked directly with an event that can observe the call.
    // Two states, because the DOCUMENT BREADCRUMB's links only exist inside a folder — which is not
    // the golden's state, and not the sidebar's.
    const inFolder = screen({ folderActive: { [COMPANIES[0].tenant_id]: 'f3' } });
    for (const [label, tree, extra] of [['root', screen(), 0], ['in a folder', inFolder, 2]] as const) {
      const anchors = collectHostHandlers(tree).filter((t) => t.type === 'a' && typeof t.props.onClick === 'function');
      expect(anchors.length, label).toBe(INFO_SECTIONS.length + extra);
      for (const a of anchors) {
        let prevented = false;
        (a.props.onClick as (e: unknown) => void)({ preventDefault: () => { prevented = true; } });
        expect(prevented, `${label}: ${String(a.props.href)} must preventDefault`).toBe(true);
        // …and it still carries an href, which is what makes the link meaningful without JS.
        expect(String(a.props.href)).toMatch(/^(#info-sec-[a-z]+|#)$/);
      }
    }
    expect(GOLDEN).toContain("onclick=\"event.preventDefault();document.getElementById('info-sec-identity')");
  });

  it('catches the Edit-mode button that stopped setting a mode', () => {
    expect(() => assertHandlerParity({ onSetMode: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches any handler that stopped calling anything', () => {
    expect(() => assertHandlerParity({ onPrint: undefined as never })).toThrow();
    expect(() => assertHandlerParity({ onSearchInput: undefined as never })).toThrow();
  });
});

/* ══ Edit mode — the half no golden holds ══════════════════════════════════════════════════════════ */

describe('edit mode: the form contract infoCollect() reads back', () => {
  const html = renderToStaticMarkup(screen({ mode: 'edit' }));

  it('carries a data-k input for EVERY field key app.html declares', () => {
    // `infoCollect()` reads `#info-form [data-k]`. A field without it saves as ABSENT, which on this
    // form is a wiped SSM number, IC or bank account, with no error anywhere.
    const keys = INFO_SECTIONS.flatMap((s) => (s.fields || []).map((f) => f.k));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) expect(html, `data-k="${k}" missing`).toContain(`data-k="${k}"`);
    expect(APP.slice(APP.indexOf('function infoCollect(){'), APP.indexOf('function infoRowAdd(')))
      .toContain("document.querySelectorAll('#info-form [data-k]')");
  });

  it('carries a data-list table and data-sk inputs for every list section', () => {
    for (const key of INFO_LIST_KEYS) expect(html).toContain(`data-list="${key}"`);
    for (const s of INFO_SECTIONS.filter((x) => x.list)) {
      for (const col of s.cols || []) expect(html, `data-sk="${col.k}"`).toContain(`data-sk="${col.k}"`);
    }
  });

  it('populates each field from ITS OWN key, not a neighbour\'s', () => {
    // The `finance.ap` finding: a "carries every data-* name" check is NOT a check that each field
    // reads the right value. One distinct sentinel per field key, asserted back on its own input.
    const keys = INFO_SECTIONS.flatMap((s) => (s.fields || []).map((f) => f.k))
      .filter((k) => k !== 'notes');   // the textarea holds its value as a child, checked below
    const sentinels: Record<string, unknown> = {};
    keys.forEach((k, i) => { sentinels[k] = 'SENTINEL-' + i; });
    const out = renderToStaticMarkup(screen({
      mode: 'edit',
      companies: [{ ...COMPANIES[0], ...sentinels, reg_state: 'Perak', biz_state: 'Johor' } as InfoCompany],
      active: COMPANIES[0].tenant_id,
    }));
    for (const k of keys) {
      if (k === 'reg_state' || k === 'biz_state') continue;   // <select>, asserted separately
      expect(out, `${k} carries the wrong value`).toMatch(new RegExp(`data-k="${k}"[^>]*value="${sentinels[k]}"`));
    }
    // The two state dropdowns select their own company value, not the other one's.
    expect(out).toMatch(/data-k="reg_state"[\s\S]*?<option value="Perak" selected="">/);
    expect(out).toMatch(/data-k="biz_state"[\s\S]*?<option value="Johor" selected="">/);
  });

  it('renders the notes textarea with its value as a child, and rows from the schema', () => {
    expect(html).toMatch(/<textarea[^>]*data-k="notes"[^>]*rows="4"[^>]*>SST registered since Sep 2018/);
  });

  it('gives every list row its OWN delete index, and the add button its own key', () => {
    const del: [string, number][] = [];
    const add: [string, string[]][] = [];
    const out = screen({
      mode: 'edit',
      onRowDel: ((key: string, i: number) => del.push([key, i])) as never,
      onRowAdd: ((key: string, cols: string[]) => add.push([key, cols])) as never,
    });
    reactHandlers(out).forEach((h) => h.invoke());
    // Directors has two rows, shareholders two, the rest one each — every (key, index) pair distinct.
    expect(del).toContainEqual(['directors', 0]);
    expect(del).toContainEqual(['directors', 1]);
    expect(new Set(del.map((d) => d.join(':'))).size).toBe(del.length);
    expect(add.map((a) => a[0])).toEqual(INFO_LIST_KEYS);
    expect(add.find((a) => a[0] === 'directors')![1]).toEqual(['name', 'ic', 'role', 'appointed_on']);
  });

  it('shows the save bar, and its dirty warning only when dirty', () => {
    expect(html).toContain('id="info-save-btn"');
    expect(html).toContain('💾 Save changes');
    expect(html).not.toContain('⚠ unsaved changes');
    expect(renderToStaticMarkup(screen({ mode: 'edit', dirty: true }))).toContain('⚠ unsaved changes');
  });

  it('the folder delete button stops the click reaching the row underneath', () => {
    // app.html:5601 writes `onclick="event.stopPropagation();infoFolderDelete(id)"`. Without it the
    // 🗑 also fires the row's own `infoFolderOpen(id)`, so the operator is navigated INTO the folder
    // the confirm dialog is about to destroy. Edit-mode only, so no golden reaches it — found by
    // deleting the guard and watching every test stay green.
    const deleted: unknown[] = [];
    const el = screen({ mode: 'edit', onFolderDelete: ((id: unknown) => deleted.push(id)) as never });
    const buttons = collectHostHandlers(el).filter((t) => t.props.title === 'Delete folder');
    expect(buttons.length).toBe(FOLDER_ROWS.filter((f) => f.tenant_id === COMPANIES[0].tenant_id).length);
    for (const b of buttons) {
      let stopped = false;
      (b.props.onClick as (e: unknown) => void)({ stopPropagation: () => { stopped = true; } });
      expect(stopped, 'the 🗑 must stop the click reaching the folder row').toBe(true);
    }
    // …and each one deletes ITS OWN folder.
    expect(deleted).toEqual(FOLDER_ROWS.filter((f) => f.tenant_id === COMPANIES[0].tenant_id).map((f) => f.id));
  });

  it('shows the upload form and the folder delete buttons ONLY in edit mode', () => {
    expect(html).toContain('id="info-doc-file"');
    expect(html).toContain('id="info-doc-upload-btn"');
    expect(html).toContain('Attach a document');
    expect(html).toContain('+ New folder');
    const view = renderToStaticMarkup(screen());
    expect(view).not.toContain('info-doc-file');
    expect(view).not.toContain('+ New folder');
    expect(view).not.toContain('🗑');
  });

  it('carries the five upload-control ids infoDocUpload() reads back', () => {
    const up = APP.slice(APP.indexOf('async function infoDocUpload(){'), APP.indexOf('async function infoDocDownload('));
    const ids = [...up.matchAll(/getElementById\('(info-doc-[a-z]+)'\)/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBeGreaterThanOrEqual(5);
    for (const id of new Set(ids)) expect(html, `${id} missing`).toContain(`id="${id}"`);
  });
});

/* ══ Search — the second section's populated states ════════════════════════════════════════════════ */

describe('the search panel, which the golden only holds empty', () => {
  it('is closed on a blank query, and open on anything else', () => {
    expect(searchOpen('')).toBe(false);
    expect(searchOpen('   ')).toBe(false);
    expect(searchOpen('a')).toBe(true);
    // …and the panel's own display style follows it, which is the mutation the harness cannot record.
    expect(renderToStaticMarkup(screen())).toContain('overflow-y:auto;display:none');
    expect(renderToStaticMarkup(screen({ search: 'EPF' }))).toContain('overflow-y:auto;display:block');
  });

  it('says "No matches" rather than rendering nothing', () => {
    const out = searchPanel('zzzz-not-a-thing');
    expect(out).toContain('No matches for "zzzz-not-a-thing"');
  });

  it('finds a value, a field LABEL and a section TITLE — three different rules', () => {
    expect(infoSearchAll('58427907080', COMPANIES, DOCS).length).toBeGreaterThan(0);   // a value
    expect(infoSearchAll('MSIC code', COMPANIES, DOCS).length).toBeGreaterThan(0);     // a field label
    expect(infoSearchAll('MyInvois', COMPANIES, DOCS).length).toBeGreaterThan(0);      // a section title
  });

  it('searches EVERY company, not just the active one', () => {
    const hits = infoSearchAll('procare', COMPANIES, DOCS);
    expect(hits.some((h) => h.tenant_id === COMPANIES[1].tenant_id)).toBe(true);
  });

  it('scans list rows and labels them by 1-BASED index', () => {
    const hits = infoSearchAll('CTG HOLDINGS', COMPANIES, DOCS);
    expect(hits.some((h) => h.label === 'Shareholders #2')).toBe(true);
    expect(hits.some((h) => h.label === 'Shareholders #1')).toBe(false);
  });

  it('summarises a list row from its FIRST THREE columns', () => {
    const hit = infoSearchAll('CTG HOLDINGS', COMPANIES, DOCS).find((h) => h.label === 'Shareholders #2')!;
    expect(hit.value).toBe('CTG HOLDINGS SDN BHD · 201501099887 · 30000');
  });

  it('slices the COLUMNS, not the values — a blank column costs a slot', () => {
    // app.html:5860 is `(sec.cols||[]).slice(0,3).map(...).filter(Boolean)`. Mapping first and slicing
    // after would FILL the gap a blank column leaves by pulling the fourth column forward — so a
    // shareholder with no IC would be summarised with their PERCENTAGE where the IC should be, and the
    // operator reads "70" as an identification number. Every fixture row has three non-blank leading
    // columns, so that swap is invisible against the shipped data; this drives a row that has not.
    const blankMiddle: InfoCompany[] = [{
      tenant_id: 'tb', tenant_name: 'BLANK CO',
      shareholders: [{ name: 'ZQXJ NOMINEES', ic_or_no: '', shares: 100, percent: 100 }],
    }];
    const hit = infoSearchAll('ZQXJ', blankMiddle, {})[0];
    expect(hit.value).toBe('ZQXJ NOMINEES · 100');
    expect(hit.value).not.toContain('100 · 100');
    // …and the legacy really does slice the columns first.
    expect(APP).toContain("const summary=(sec.cols||[]).slice(0,3).map(col=>item[col.k]).filter(Boolean).join(' · ');");
  });

  it('caps the panel at 30 rows, and says how many there really are', () => {
    // A real cap: match 31 and the 31st is not shown, with nothing on screen saying so. Mirrored.
    const many: InfoCompany[] = Array.from({ length: 40 }, (_, i) => ({
      tenant_id: 't' + i, tenant_name: 'CO ' + i, legal_name: 'ZQXJ HOLDINGS ' + i,
    }));
    const hits = infoSearchAll('ZQXJ', many, {});
    expect(hits.length).toBe(40);
    const out = renderToStaticMarkup(<SearchResults search="ZQXJ" companies={many} docs={{}} onJumpHit={noop} />);
    expect(out).toContain('40 matches');
    expect(out).toContain('ZQXJ HOLDINGS 29');
    expect(out).not.toContain('ZQXJ HOLDINGS 30');
  });

  it('says "1 match", not "1 matches"', () => {
    const one: InfoCompany[] = [{ tenant_id: 't', tenant_name: 'CO', legal_name: 'ZQXJ' }];
    expect(renderToStaticMarkup(<SearchResults search="ZQXJ" companies={one} docs={{}} onJumpHit={noop} />))
      .toContain('1 match<');
  });

  it('jumps to the company AND the section of the row that was clicked', () => {
    const jumps: [string, string][] = [];
    const el = <SearchResults search="CTG HOLDINGS" companies={COMPANIES} docs={DOCS}
                              onJumpHit={(t, s) => jumps.push([t, s])} />;
    reactHandlers(el).forEach((h) => h.invoke());
    expect(jumps).toContainEqual([COMPANIES[0].tenant_id, 'sharehold']);
  });

  it('never renders a company the caller did not hand it', () => {
    expect(renderToStaticMarkup(<SearchResults search="EPF" companies={[COMPANIES[1]]} docs={DOCS} onJumpHit={noop} />))
      .not.toContain('SKINDAE');
  });
});

/* ══ Documents ═════════════════════════════════════════════════════════════════════════════════════ */

describe('the documents section — folders, counts and the expiry badge', () => {
  const at = (over: Partial<Props>) => renderToStaticMarkup(screen(over));

  it('counts files in the ACTIVE folder, and folders under it', () => {
    const root = at({});
    expect(root).toContain('3 total · 1 in root');
    expect(root).toContain('1 file<');
    const inF2 = at({ folderActive: { [COMPANIES[0].tenant_id]: 'f2' } });
    expect(inF2).toContain('1 file<');
    // Under Contracts the breadcrumb is a chain, not the root span.
    expect(inF2).toContain('Contracts');
    expect(inF2).not.toContain('all documents');
  });

  it('renders the empty-folder sentence, and its two variants', () => {
    const inF3 = at({ folderActive: { [COMPANIES[0].tenant_id]: 'f3' } });
    expect(inF3).toContain('No files in this folder. The files are in subfolders.');
    const noDocs = at({ docs: {} });
    expect(noDocs).toContain('No files.');
    expect(noDocs).not.toContain('in this folder');
  });

  it('marks the Documents section EMPTY for a company with no documents', () => {
    const out = at({ active: COMPANIES[1].tenant_id, docs: { [COMPANIES[0].tenant_id]: DOCS[COMPANIES[0].tenant_id] } });
    expect(out).toContain('No folders yet.');
    expect(infoSectionFilled(COMPANIES[1], INFO_SECTIONS[18], {})).toBe(false);
  });

  it('builds a folder path from the parent chain', () => {
    const f = FOLDERS[COMPANIES[0].tenant_id];
    expect(infoFolderPath(f, null)).toBe('/ (root)');
    expect(infoFolderPath(f, 'f2')).toBe('/ Contracts');
    expect(infoFolderPath(f, 'f3')).toBe('/ Contracts / Leases');
  });

  it('does not hang on a folder whose parent chain loops', () => {
    const loop: InfoFolder[] = [
      { id: 'a', tenant_id: 'x', parent_id: 'b', name: 'A' },
      { id: 'b', tenant_id: 'x', parent_id: 'a', name: 'B' },
    ];
    expect(infoFolderPath(loop, 'a').split(' / ').length).toBe(20);
  });

  it('picks the icon from the mime type, in the legacy\'s own order', () => {
    expect(infoDocIcon('application/pdf')).toBe('📕');
    expect(infoDocIcon('image/jpeg')).toBe('🖼');
    expect(infoDocIcon('application/msword')).toBe('📘');
    expect(infoDocIcon('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('📘');
    expect(infoDocIcon('application/vnd.ms-excel')).toBe('📗');
    expect(infoDocIcon(null)).toBe('📄');
    // `document` is tested BEFORE `spreadsheet`, so a modern .xlsx — whose mime contains
    // "officedocument" — gets the WORD icon, not the Excel one. That is app.html:5542's own branch
    // order, mirrored not fixed: reordering it is a visible change to every Excel row on the screen.
    expect(infoDocIcon('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('📘');
    expect(infoDocIcon('application/vnd.oasis.opendocument.spreadsheet')).toBe('📘');
  });

  it('formats bytes at both boundaries', () => {
    expect(infoDocBytes(0)).toBe('0 B');
    expect(infoDocBytes(1023)).toBe('1023 B');
    expect(infoDocBytes(1024)).toBe('1.0 KB');
    expect(infoDocBytes(1048575)).toBe('1024.0 KB');
    expect(infoDocBytes(1048576)).toBe('1.00 MB');
  });

  // ── The expiry badge: three branches, none of them in the golden ────────────────────────────────
  const withExpiry = (expiry: string) => at({
    docs: { [COMPANIES[0].tenant_id]: [{ ...DOCS[COMPANIES[0].tenant_id][0], expiry_date: expiry }] },
  });

  it('renders all three expiry states, at their boundaries', () => {
    const today = todayLocalISO(NOW);
    const soon = inDaysLocalISO(90, NOW);
    // Drive the THRESHOLD, not a value comfortably inside a branch — the CFO cockpit's finding.
    expect(withExpiry('2020-01-01')).toContain('⚠ expired 2020-01-01');
    expect(withExpiry(today)).not.toContain('⚠ expired');       // strictly `<` today
    expect(withExpiry(today)).toContain('⏳ expires ' + today);
    expect(withExpiry(soon)).not.toContain('⏳');                // strictly `<` the 90-day mark
    expect(withExpiry(soon)).toContain('expires ' + soon);
    expect(withExpiry('2099-12-31')).toContain('expires 2099-12-31');
    expect(withExpiry('2099-12-31')).not.toContain('⏳');
  });

  it('a document with no expiry carries no badge at all — which is the golden', () => {
    expect(at({})).not.toContain('expires');
    expect(at({})).not.toContain('expired');
  });

  it('gives every file row its OWN download id', () => {
    // The fixture puts ONE document in the root, so a row wired to `docs[0]` is indistinguishable from
    // one wired to itself — found by introducing exactly that. Three rows of near-identical file
    // metadata is where a wrong id is invisible, and the button hands back a signed URL to whatever
    // document it names.
    const three: InfoDoc[] = ['d1', 'd7', 'd9'].map((id, i) => ({
      id, tenant_id: COMPANIES[0].tenant_id, folder_id: null,
      title: 'Certificate ' + i, file_name: 'cert.pdf', mime_type: 'application/pdf', file_size: 100,
    }));
    const got: unknown[] = [];
    reactHandlers(screen({ docs: { [COMPANIES[0].tenant_id]: three }, onDocDownload: ((id: unknown) => got.push(id)) as never }))
      .forEach((h) => h.invoke());
    expect(got).toEqual(['d1', 'd7', 'd9']);
  });

  it('the Move-to dropdown never offers the folder the file is already in', () => {
    // Edit-mode only, so no golden reaches it. app.html:5650 filters the current folder out AND swaps
    // the placeholder: a filed document gets "Move…" plus an explicit "/ (root)" escape, a root
    // document gets "/ (root)" as the placeholder and no second one. Collapsing either leaves an
    // operator with no way to move a file back to the root, or with a destination that does nothing.
    const filed = renderToStaticMarkup(screen({
      mode: 'edit',
      docs: { [COMPANIES[0].tenant_id]: [{ ...DOCS[COMPANIES[0].tenant_id][0], folder_id: 'f2' }] },
      folderActive: { [COMPANIES[0].tenant_id]: 'f2' },
    }));
    const moveSelect = (html: string) => {
      const at = html.indexOf('title="Move to folder"');
      expect(at, 'no Move-to select rendered').toBeGreaterThan(-1);
      return html.slice(html.lastIndexOf('<select', at), html.indexOf('</select>', at));
    };
    const sel = moveSelect(filed);
    expect(sel).toContain('>Move…<');
    expect(sel).toContain('<option value="">/ (root)</option>');
    expect(sel).not.toContain('value="f2"');
    expect(sel).toContain('value="f1"');
    expect(sel).toContain('value="f3"');
    expect(sel).toContain('→ / Contracts / Leases');

    const root = renderToStaticMarkup(screen({ mode: 'edit' }));
    const rsel = moveSelect(root);
    expect(rsel).not.toContain('Move…');
    expect(rsel.match(/\/ \(root\)/g)?.length).toBe(1);
    expect(rsel).toContain('value="f1"');
  });

  it('a move posts the doc it belongs to, and the value the operator picked', () => {
    const moves: [unknown, unknown][] = [];
    reactHandlers(screen({ mode: 'edit', onDocMove: ((d: unknown, f: unknown) => moves.push([d, f])) as never }))
      .forEach((h) => h.invoke());
    // The stub event carries STUB_VALUE as the select's value; what matters is WHICH document moves.
    expect(moves.map((m) => m[0])).toEqual(['d1']);
    expect(moves[0][1]).toBe(STUB_VALUE);
  });
});

/* ══ Dates: the implementation is the guard, because no output can see it ══════════════════════════ */

describe('the two clocks are now ONE clock, pinned in the SOURCE', () => {
  // v224. This screen was where "two clocks in one comparison" was found: `todayLocalISO()` was MYT and
  // `inDaysLocalISO(90)` was the MACHINE's zone, and `expiryBadge()` compares them against each other in
  // one expression. Both now read Kuala Lumpur, through myt.js, in both apps.
  //
  // finance.calendar's finding still governs HOW that is checked: this machine and CI both sit at UTC+8,
  // so re-inlining either derivation with a local getter passes every output assertion in this file and
  // prints the wrong day for an operator west of Greenwich. Verified by breaking each one — see the PR.
  // Both spellings: v224 turned these two into one-line `export const … =>` arrow functions, which is
  // the shape a delegation takes. A helper that only found `export function` would report "not found",
  // and a "not found" that reads as a pass is how a guard stops guarding.
  const fn = (name: string) => {
    const decl = SRC.indexOf(`export function ${name}(`);
    const arrow = SRC.indexOf(`export const ${name} =`);
    const at = decl >= 0 ? decl : arrow;
    expect(at, `${name} not found in either spelling`).toBeGreaterThan(-1);
    const end = decl >= 0 ? SRC.indexOf('\n}', at) : SRC.indexOf('\n', at);
    return SRC.slice(at, end).replace(/\/\/[^\n]*/g, '');
  };

  it('todayLocalISO() is Malaysia time WITHOUT a timezone database, exactly as app.html:1264 is', () => {
    // Both sides delegate to myt.js now. Malaysia has no DST, so `+8h` read back with getUTC* needs no
    // timezone database — a browser without the tz data still agrees which day it is in Kuala Lumpur,
    // which is why this stayed arithmetic rather than becoming `timeZone: 'Asia/Kuala_Lumpur'`.
    expect(APP).toContain('function todayLocalISO(){ return mytISO(); }');
    expect(APP, 'app.html must load the file it now depends on').toContain('<script src="myt.js"></script>');
    const body = fn('todayLocalISO');
    expect(body).toContain('mytISO');
    expect(body).not.toMatch(/\.getFullYear\(|\.getMonth\(|\.getDate\(|toLocale|toISOString/);
  });

  it('todayLocalISO() gives the same MYT day whatever instant it is handed', () => {
    // 16:00Z on the 20th is already the 21st in Kuala Lumpur.
    expect(todayLocalISO(Date.parse('2026-08-20T16:00:00Z'))).toBe('2026-08-21');
    expect(todayLocalISO(Date.parse('2026-08-20T15:59:59Z'))).toBe('2026-08-20');
    expect(todayLocalISO(0)).toBe('1970-01-01');
  });

  it('inDaysLocalISO() is MALAYSIAN too, exactly as common.js:27-28 now is', () => {
    // common.js is loaded by BOTH apps, so this one changed HR OS as well as Finance. `inDaysLocalISO`
    // has one caller (this badge) and `localISO` has one caller (`inDaysLocalISO`), which is what made
    // the blast radius of the fix small enough to take.
    const common = readFileSync(join(REPO, 'common.js'), 'utf8');
    expect(common).toContain('function localISO(d){ return mytISO(d); }');
    expect(common).toContain('function inDaysLocalISO(days){ return mytISOPlusDays(days); }');
    expect(common, 'the machine-zone body came back')
      .not.toContain("return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }");
    const body = fn('inDaysLocalISO');
    expect(body).toContain('mytISO');
    expect(body).not.toMatch(/setDate|\.getFullYear\(|toLocale|toISOString/);
  });

  it('the two ARE the same clock now — and the badge is driven across the boundary to prove it', () => {
    // The whole point of the change. 16:00Z is already the NEXT day in Kuala Lumpur, so an implementation
    // that read the machine's zone for one half and Malaysia's for the other puts the ⚠ threshold and the
    // ⏳ window a day apart. Driven, not just read: at 16:00Z on 20 Aug, "today" is the 21st and "+90
    // days" must be exactly 90 days after THAT.
    const at = Date.parse('2026-08-20T16:00:00Z');
    expect(todayLocalISO(at)).toBe('2026-08-21');
    expect(inDaysLocalISO(90, at)).toBe('2026-11-19');
    expect(inDaysLocalISO(0, at), 'the two halves disagree about today').toBe(todayLocalISO(at));
    // …and at UTC+8 a machine-zone `inDaysLocalISO` returns the same strings, which is why the sources
    // above are pinned as well. Run this file under TZ=America/New_York to see the difference.
  });

  it('inDaysLocalISO() really moves 90 days', () => {
    const from = Date.parse('2026-01-01T04:00:00Z');
    expect(inDaysLocalISO(0, from).slice(0, 4)).toBe('2026');
    const d0 = new Date(from); const d90 = new Date(from); d90.setDate(d90.getDate() + 90);
    expect(inDaysLocalISO(90, from)).not.toBe(inDaysLocalISO(0, from));
    expect(Math.round((d90.getTime() - d0.getTime()) / 86400000)).toBe(90);
  });

  it('the component reads NO clock — every date is handed in', () => {
    // Comments stripped: the header EXPLAINS `Date.now()+8h` in prose, and a prose mention is not a
    // clock read. What must not appear is a CALL.
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
    expect(code).not.toContain('Date.now()');
    expect(code).not.toMatch(/new Date\(\s*\)/);
    expect(code).not.toContain('toISOString');
    // Every `new Date(...)` it does make takes the instant it was handed.
    for (const m of code.matchAll(/new Date\(([^)]*)\)/g)) expect(m[1]).toMatch(/^now/);
  });
});

/* ══ Progress and filled-ness ══════════════════════════════════════════════════════════════════════ */

describe('the fill badge and the sidebar dots', () => {
  it('counts sections, not fields — 19 is the total', () => {
    expect(infoCompanyProgress(COMPANIES[0], DOCS)).toEqual({ filled: 19, total: 19 });
    expect(infoCompanyProgress(COMPANIES[1], DOCS)).toEqual({ filled: 12, total: 19 });
  });

  it('drives the colour AT both thresholds, in both directions', () => {
    // A threshold no test crosses is a threshold a port can move — the CFO cockpit's finding. These
    // drive 79/80 and 39/40 exactly, so widening or narrowing either band fails.
    expect(progressColour(80, 100)).toBe('var(--green-soft)');
    expect(progressColour(79, 100)).toBe('var(--amber)');
    expect(progressColour(40, 100)).toBe('var(--amber)');
    expect(progressColour(39, 100)).toBe('var(--red-soft)');
    expect(progressColour(0, 100)).toBe('var(--red-soft)');
    // Math.round, not floor or ceil: 79.5% rounds UP into green, 79.4% stays amber.
    expect(progressColour(795, 1000)).toBe('var(--green-soft)');
    expect(progressColour(794, 1000)).toBe('var(--amber)');
    expect(progressColour(395, 1000)).toBe('var(--amber)');
    expect(progressColour(394, 1000)).toBe('var(--red-soft)');
  });

  it('marks each sidebar section ● or ○ by its OWN filled-ness', () => {
    // The golden's company has all 19 sections filled, so a sidebar hardcoded to ● is byte-identical
    // to it — found by introducing exactly that. The dots are the operator's to-do list for a company
    // record, and a section that reports complete when it is empty is a filing nobody chases.
    const marks = (html: string) => Object.fromEntries(
      [...html.matchAll(/href="#info-sec-([a-z]+)"[\s\S]*?>(●|○)</g)].map((m) => [m[1], m[2]]));
    for (const c of COMPANIES) {
      const got = marks(renderToStaticMarkup(screen({ active: c.tenant_id })));
      expect(Object.keys(got).length).toBe(19);
      for (const sec of INFO_SECTIONS) {
        expect(got[sec.id], `${c.tenant_name} · ${sec.id}`).toBe(infoSectionFilled(c, sec, DOCS) ? '●' : '○');
      }
    }
    // Guard the guard: the second company must really have unfilled sections, or the loop above is
    // asserting ● nineteen times and would pass with the rule removed.
    const second = marks(renderToStaticMarkup(screen({ active: COMPANIES[1].tenant_id })));
    expect(Object.values(second).filter((m) => m === '○').length).toBe(7);
    expect(Object.values(second).filter((m) => m === '●').length).toBe(12);
  });

  it('the golden really exercises two of the three bands', () => {
    expect(GOLDEN).toContain('color:var(--green-soft)">19/19');
    expect(GOLDEN).toContain('color:var(--amber)">12/19');
  });

  it('treats a numeric ZERO as empty, and whitespace as empty', () => {
    // app.html:5509 — `return v!==0`. A paid-up capital of 0 marks the section unfilled, which is the
    // legacy's own rule and is what the ○ next to "Capital & financial year" means.
    expect(infoFilled(0)).toBe(false);
    expect(infoFilled('  ')).toBe(false);
    expect(infoFilled([])).toBe(false);
    expect(infoFilled(null)).toBe(false);
    expect(infoFilled(undefined)).toBe(false);
    expect(infoFilled(1)).toBe(true);
    expect(infoFilled('x')).toBe(true);
    expect(infoFilled([1])).toBe(true);
  });

  it('a section is filled when ANY of its fields is', () => {
    const sec = INFO_SECTIONS.find((s) => s.id === 'stat')!;
    const bare = { tenant_id: 't', tenant_name: 'T' } as InfoCompany;
    expect(infoSectionFilled(bare, sec, {})).toBe(false);
    expect(infoSectionFilled({ ...bare, eis_no: 'X' }, sec, {})).toBe(true);
  });

  it('the DOCUMENTS section is filled by documents, not by a field', () => {
    const docsSec = INFO_SECTIONS.find((s) => s.custom === 'docs')!;
    expect(infoSectionFilled(COMPANIES[0], docsSec, DOCS)).toBe(true);
    expect(infoSectionFilled(COMPANIES[0], docsSec, {})).toBe(false);
  });
});

/* ══ What leaves the building ══════════════════════════════════════════════════════════════════════ */

describe('the save patch — no golden sees a request body', () => {
  it('posts a BLANK capital as null rather than zero', () => {
    // Posting 0 would overwrite a real paid-up capital on a record the operator never touched; posting
    // '' is rejected by the numeric column. null is the only honest reading of an empty box.
    expect(savePatch({ authorised_capital: '', paid_up_capital: '' }))
      .toEqual({ authorised_capital: null, paid_up_capital: null });
  });

  it('posts a capital as a NUMBER, not the input\'s string', () => {
    expect(savePatch({ authorised_capital: '400000' })).toEqual({ authorised_capital: 400000 });
    expect(savePatch({ paid_up_capital: '0' })).toEqual({ paid_up_capital: 0 });
  });

  it('posts EVERY blank date as null — "" is what broke the live save', () => {
    // The live failure: `invalid input syntax for type date: ""`, from a Compliance date nobody had
    // touched, and the form named no field. Walk the schema so a date added later is covered here too.
    const dates = INFO_SECTIONS.flatMap((s) => s.fields || []).filter((f) => f.type === 'date').map((f) => f.k);
    expect(dates.length).toBeGreaterThan(1);   // a hand-written guard list is what missed four of them
    for (const k of dates) expect(savePatch({ [k]: '' })).toEqual({ [k]: null });
    expect(savePatch({ incorporation_date: '2018-04-12' })).toEqual({ incorporation_date: '2018-04-12' });
    expect(savePatch({ incorporation_date: '   ' })).toEqual({ incorporation_date: null });
  });

  it('passes everything else through verbatim, including a CLEARED text field', () => {
    expect(savePatch({ ssm_new: '201801012345', directors: [{ name: 'A' }] }))
      .toEqual({ ssm_new: '201801012345', directors: [{ name: 'A' }] });
    // A blanked text box must still travel as '', or clearing a value becomes a silent no-op.
    expect(savePatch({ trade_name: '' })).toEqual({ trade_name: '' });
  });

  it('stays in step with app.html, which derives the same fields from the same schema', () => {
    // Pinned on the SHAPE of the legacy guard, not its old literal text: both sides now walk
    // INFO_SECTIONS, so neither can drift by having a field added to one list and not the other.
    const collect = APP.slice(APP.indexOf('function infoCollect(){'), APP.indexOf('function infoRowAdd('));
    expect(collect).toContain('INFO_SECTIONS.forEach(sec=>{ (sec.fields||[]).forEach(f=>{');
    expect(collect).toContain("if(f.type==='date'){ if(blank) out[f.k]=null; }");
    expect(collect).toContain("else if(f.type==='number'){ out[f.k] = blank ? null : Number(out[f.k]); }");
    // And the bug itself can never come back: no hand-written field list.
    expect(collect).not.toContain('delete out.incorporation_date');
  });

  it('refuses to post without a tenant', () => {
    // `company_info_save` takes the tenant from the REQUEST (finance.ts:2473). A patch posted without
    // one writes nowhere at best, and over another company's record at worst.
    expect(() => saveBody('', { ssm_new: 'x' })).toThrow();
    expect(saveBody('t1', { ssm_new: 'x' })).toEqual({ api: 'company_info_save', tenant: 't1', patch: { ssm_new: 'x' } });
  });
});

describe('the printed report — a document that leaves the building', () => {
  const out = printDocHtml(COMPANIES[0], DOCS, '2026-08-21');

  it('carries the company name, the report title and the print date', () => {
    expect(out).toContain('<h1>SKINDAE SDN BHD</h1>');
    expect(out).toContain('<title>SKINDAE SDN BHD — Company Info</title>');
    expect(out).toContain('Company Information Report · printed 2026-08-21');
  });

  it('carries every FILLED section and omits the empty ones', () => {
    for (const s of INFO_SECTIONS) {
      const has = out.includes('<h2>' + s.icon + ' ' + s.title.replace(/&/g, '&amp;') + '</h2>');
      expect(has, `${s.id} should be ${infoSectionFilled(COMPANIES[0], s, DOCS) ? 'present' : 'absent'}`)
        .toBe(infoSectionFilled(COMPANIES[0], s, DOCS));
    }
    // The second company has no bank accounts, so that heading must not appear on ITS report.
    expect(printDocHtml(COMPANIES[1], DOCS, '2026-08-21')).not.toContain('Bank accounts</h2>');
  });

  it('carries the statutory numbers, directors and bank accounts an auditor asks for', () => {
    expect(out).toContain('201801012345');
    expect(out).toContain('C 58427907080');
    expect(out).toContain('880202-10-5533');
    expect(out).toContain('512011223344');
  });

  it('escapes what it prints — a company name with a < in it must not become markup', () => {
    const evil = printDocHtml({ ...COMPANIES[0], tenant_name: '<script>x</script>' }, DOCS, '2026-08-21');
    expect(evil).not.toContain('<script>x</script>');
    expect(evil).toContain('&lt;script&gt;');
  });

  it('is dated in MALAYSIA, exactly as infoPrint() now is — v224 changed both halves together', () => {
    // It used to be `new Date().toISOString().slice(0,10)`, i.e. UTC: between midnight and 08:00 in
    // Kuala Lumpur a report claimed to have been printed the PREVIOUS day. A date ON a document, not a
    // figure IN one — nothing the report states about the company moved. The route hands the string in
    // so the boundary stays drivable.
    const print = APP.slice(APP.indexOf('function infoPrint(){'), APP.indexOf('function infoRender(){'));
    expect(print).toContain('todayLocalISO()');
    expect(print, 'the UTC stamp came back').not.toContain('toISOString()');
    // …and printDocHtml itself reads no clock.
    const at = SRC.indexOf('export function printDocHtml(');
    expect(SRC.slice(at, SRC.indexOf('\n}\n', at))).not.toContain('new Date(');
  });

  it('does NOT carry the screen\'s own chrome — it is a report, not a screenshot', () => {
    expect(out).not.toContain('info-sec-');
    expect(out).not.toContain('Quick view');
    expect(out).not.toContain('Jump to section');
  });
});

/* ══ Nothing was lifted, and here is the reason ════════════════════════════════════════════════════ */

describe('the arithmetic decision', () => {
  it('the server stores the patch verbatim — so the client owns what it POSTS', () => {
    const fin = readFileSync(join(REPO, 'supabase', 'functions', 'portal', 'finance.ts'), 'utf8');
    const at = fin.indexOf('if (api === "company_info_save")');
    const body = fin.slice(at, fin.indexOf('if (api === "totp_disable")', at));
    expect(body).toContain('p_patch: b.patch||{}');
    // No re-derivation of any figure: the handler forwards and returns.
    expect(body).not.toMatch(/Number\(|Math\./);
  });

  it('…but nothing this screen COMPUTES is posted', () => {
    // `savePatch()` is the operator's own typing, normalised. The numbers on screen — the fill badges,
    // their colour, the byte sizes — never leave. That is Quick Invoice's case, not wht.js's, and it
    // is why there is no info.js.
    expect(savePatch({ filled: undefined as unknown as string })).not.toHaveProperty('progress');
    const collect = APP.slice(APP.indexOf('function infoCollect(){'), APP.indexOf('function infoRowAdd('));
    expect(collect).not.toContain('infoCompanyProgress');
    expect(collect).not.toContain('infoDocBytes');
  });
});

/* ══ The withheld direction ════════════════════════════════════════════════════════════════════════ */

describe('the withheld direction', () => {
  it('a read-only login gets no edit affordance anywhere on the screen', () => {
    const out = renderToStaticMarkup(screen({ editable: false }));
    expect(out).toContain('🔒 Read-only — only Admin role can edit.');
    expect(out).not.toContain('✎ Edit mode');
    expect(out).not.toContain('info-save-btn');
    expect(out).not.toContain('data-k=');
    expect(out).not.toContain('info-doc-file');
    expect(out).not.toContain('+ New folder');
  });

  it('a read-only login cannot be talked into edit mode by the mode prop', () => {
    const out = renderToStaticMarkup(screen({ editable: false, mode: 'edit' }));
    expect(out).not.toContain('data-k=');
    expect(out).not.toContain('💾 Save changes');
  });

  it('never renders a company outside the list it was handed', () => {
    // Guard the guard: the fixture really does carry a second company's statutory numbers, so the
    // negative below is not vacuous.
    expect(JSON.stringify(COMPANIES[1])).toContain('C 11223344550');
    const out = renderToStaticMarkup(screen({ companies: [COMPANIES[0]], active: COMPANIES[0].tenant_id }));
    expect(out).not.toContain('I PROCARE');
    expect(out).not.toContain('C 11223344550');
  });

  it('never renders another tenant\'s documents or folders', () => {
    const out = renderToStaticMarkup(screen({ active: COMPANIES[0].tenant_id }));
    // d4 belongs to CO2; its folder list is empty. Neither may appear on CO1's screen.
    expect(DOC_ROWS.some((d) => d.tenant_id === COMPANIES[1].tenant_id)).toBe(true);
    expect(out).not.toContain('SST exemption letter');
  });
});
