// Finance OS · Close (month-end close) — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.close.html` was captured from `renderClose()` (app.html:5738) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts,
// tests/parity.ts or tests/handlers.ts. The component is rendered with `renderToStaticMarkup` from the
// SAME fixture the golden was captured from — tests/render_fixtures.ts, imported directly.
//
// NO SEVENTH RELAXATION, and none was needed: ./parity.ts's six are reused unchanged, as twenty-seven
// screens before this one did.
//
// ── THE ONE SCREEN-LOCAL RULE: AN EMPTY `style=""` ATTRIBUTE ───────────────────────────────────────
// `closeLoad()` interpolates a conditional straight into an attribute — app.html:5754 writes
// `'<b style="'+(t.status==='done'?'opacity:.55':'')+'">'` — so a row that is NOT done reaches the
// golden carrying `style=""`. React cannot emit that at all: an empty style object, an empty declaration
// value and an undefined one all serialise to NO attribute (verified against react-dom/server), so
// neither side can be spelled into the other. `dropEmptyStyle` below removes exactly ` style=""` from
// BOTH sides, held to parity.ts's bar and with its own "cannot hide" block.
//
// This is the same KIND of finding as hr-calculator's `dedupeAttrs` and hr-employees' `decodeAttrAmp`:
// a legacy attribute React's serialiser is incapable of producing. It stays in THIS file rather than
// moving into web/tests/parity.ts — parity.ts is shared with in-flight sibling migrations, and one
// screen is not evidence about the shared layer.
//
// ── THE GOLDEN IS TWO SECTIONS, AND `#close` IS AN INTERMEDIATE STATE ──────────────────────────────
// `renderClose()` writes `#close` — the panel with a MUTED "Loading…" inside `#close_out` — sets
// `loaded.close=true`, and then calls `closeLoad()`, which overwrites `#close_out`. Two different
// element ids, so the harness keeps both writes and the golden carries both. The `#close` section is
// therefore the frame at t=0 and NOT the screen an operator sees. Both are diffed below, each against
// the state it was captured in, and `the golden's two sections` block proves the claim out of app.html.
//
// ── WHAT THIS SCREEN RISKS ─────────────────────────────────────────────────────────────────────────
// Five near-identical checklist rows, each with a checkbox, a status select and an assignee box, and
// R1 strips every `on*=` from the string diff. So: a checkbox bound to its NEIGHBOUR's task, a checkbox
// whose true/false mapping is inverted (a step that reports complete when it is not), a select posting
// the wrong status, a period label that does not match the rows underneath it, and a load that closes
// the wrong month. Each has its own case below.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES } from '../../tests/render_fixtures';
import FinanceClose, {
  Body, CLOSE_STATUSES, assignBody, closeReachable, defaultPeriod, progress, updateBody,
  type CloseTask,
} from '../src/finance-close';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** The panel `render('close')` writes — captured with the muted "Loading…" still inside `#close_out`. */
const SHELL = goldenSection('finance.close', 'close');
/** What `closeLoad()` overwrites `#close_out` with once the checklist resolves. */
const BODY = goldenSection('finance.close', 'close_out');

const TASKS = (FIXTURES.close_list as { tasks: CloseTask[] }).tasks;

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');

/** The instant tests/render_harness.ts pins the goldens to — 2026-08-18T09:30:00Z. */
const FIXED_MS = Date.parse('2026-08-18T09:30:00.000Z');

const noop = () => {};

type Props = Parameters<typeof FinanceClose>[0];

function props(over: Partial<Props> = {}): Props {
  // The state the harness captured: the checklist resolved, August 2026 in the picker.
  return {
    period: '2026-08', tasks: TASKS, initial: false, error: null,
    onLoad: noop, onSet: noop, onAssign: noop, ...over,
  };
}

const screen = (over: Partial<Props> = {}) => <FinanceClose {...props(over)} />;
const body = (over: Partial<Props> = {}) => <Body {...props(over)} />;

/**
 * AN EMPTY `style=""` ATTRIBUTE, dropped from BOTH sides.
 *
 * What it absorbs: an attribute that declares nothing. `style=""` and no style attribute are the same
 * element to a parser, to the CSSOM and to a user — there is no declaration either way.
 *
 * What it cannot absorb, each proven by the `still bites` block below:
 *   • a style with ANY content — `style="opacity:.55"` is not `style=""` and is left alone, so a row
 *     that lost its dimming, or gained it, still diffs;
 *   • a changed number, a dropped row, a renamed label or a lost class — none of those is an empty
 *     attribute, and the rule matches nothing but the exact 9 characters ` style=""`;
 *   • any OTHER empty attribute — `value=""` and `class=""` are untouched, so the assignee box losing
 *     its empty value still diffs.
 */
const dropEmptyStyle = (html: string) => html.replace(/ style=""/g, '');

/** Both sides read as the same document, then compared under ./parity.ts's six relaxations. */
const sameDocument = (html: string) => relax(dropEmptyStyle(html));

const renderedShell = (over: Partial<Props> = {}) => sameDocument(renderToStaticMarkup(screen(over)));
const renderedBody = (over: Partial<Props> = {}) => sameDocument(renderToStaticMarkup(body(over)));

describe('Finance Close — React vs the legacy golden', () => {
  it('renders the frame renderClose() writes, muted "Loading…" and all', () => {
    // `tasks: null, initial: true` is the state the `#close` write was taken in — before closeLoad().
    expect(renderedShell({ tasks: null, initial: true })).toBe(sameDocument(SHELL));
  });

  it('renders the same checklist closeLoad() writes into #close_out', () => {
    expect(renderedBody()).toBe(sameDocument(BODY));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertBodyHandlers();
    assertShellHandlers();
  });
});

describe("the golden's two sections — the intermediate state, proven out of app.html", () => {
  // CLAUDE.md: check what the legacy renderer does AFTER its innerHTML write before trusting a golden.
  const fn = APP.slice(APP.indexOf('function renderClose()'), APP.indexOf('async function closeSet('));
  const render = fn.slice(0, fn.indexOf('async function closeLoad()'));

  it('renderClose() writes #close with the muted Loading… and then calls closeLoad()', () => {
    expect(render).toContain("document.getElementById('close').innerHTML=");
    expect(render).toContain('<div id="close_out" class="muted">Loading…</div>');
    expect(render).toContain('loaded.close=true; closeLoad();');
  });

  it('closeLoad() overwrites a DIFFERENT element, which is why both writes survive', () => {
    expect(fn).toContain("document.getElementById('close_out').innerHTML=");
    expect(SHELL).toContain('<div id="close_out" class="muted">Loading…</div>');
    expect(BODY).not.toContain('close_out');
  });

  it('so the #close section is NOT the screen an operator sees — the two really differ', () => {
    expect(renderedShell({ tasks: null, initial: true })).not.toBe(renderedShell());
    expect(sameDocument(SHELL)).not.toContain('Payroll journal from HR OS');
  });

  it('and the composed screen puts the loaded checklist inside the frame', () => {
    const html = renderToStaticMarkup(screen());
    expect(html).toContain('<div id="close_out" class="muted">');
    expect(html).toContain('Payroll journal from HR OS');
    expect(html).toContain('id="close_period"');
  });

  it('the renderer does nothing else after its write — no appendChild, no .value=, no classList', () => {
    // The finance.qinv trap in its other direction: an appendChild here would mean the SHELL golden was
    // missing a child every operator sees. `close_period`'s value is written INSIDE the html string
    // (unlike qi_date's), which is why it DOES reach the golden.
    const after = render.slice(render.indexOf('loaded.close=true'));
    for (const s of ['appendChild', '.value=', 'setTimeout', 'classList']) expect(after).not.toContain(s);
    expect(SHELL).toContain('value="2026-08"');
  });

  it('#close_out is the only other id on this screen — there is no third section', () => {
    const ids = [...fn.matchAll(/getElementById\('([^']+)'\)\.innerHTML/g)].map((m) => m[1]);
    expect([...new Set(ids)].sort()).toEqual(['close', 'close_out']);
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * The only defence this screen has against a control bound to the wrong task. `closeSet('c3',…)` and
 * `closeSet('c4',…)` are byte-identical once R1 has stripped them, and the rows differ on screen only by
 * a title an operator ticking off a checklist reads once.
 *
 * TWO widenings, both established, both copied into this file rather than into web/tests/handlers.ts:
 *
 * 1. `LEGACY_TO_PROP` (hr-payroll, finance-wht, finance-ctgaccess). `closeLoad()` carries no identifying
 *    argument at all and appears TWICE in the shell — the month input's onchange and the ↻ Load button.
 *    Comparing the resolved PROP as well makes each handler nameable, and it also breaks the shared
 *    guard-the-guard (`want.every(h => h.args.length > 0)` is unsatisfiable here), which is REPLACED —
 *    not dropped — with "every golden handler name resolved to a known prop".
 *
 * 2. `stubArgs()` — NEW HERE, and strictly a TIGHTENING. The checkbox's golden text is
 *    `closeSet('c1',this.checked?'done':'pending')`, so `goldenHandlers().args` collects THREE quoted
 *    literals: the row id AND both branches of a ternary over the browser's live checked state.
 *    handlers.ts already drops `this.value` for exactly this reason — it is the browser handing the
 *    handler the control's value, which React spells `e.target.checked` — and `reactHandlers()` invokes
 *    with a bare `{target:{value}}` stub carrying no `checked`, so the React side takes the FALSE branch.
 *    `stubArgs()` applies that same stub semantics to the GOLDEN's text: `this.checked?'A':'B'` collapses
 *    to `'B'`. That is a mirror of the stub, not a loosening — a port that INVERTED the mapping records
 *    `'done'` where the golden-derived expectation is `'pending'` and fails, which is the case
 *    `catches the checkbox mapping inverting` drives. The TRUE branch is exercised separately below,
 *    because a stub that never sets `checked` cannot reach it.
 */
const LEGACY_TO_PROP: Record<string, string> = {
  closeSet: 'set',
  closeAssign: 'assign',
  closeLoad: 'load',
};

const propFor = (raw: string) => LEGACY_TO_PROP[raw] ?? LEGACY_TO_PROP[raw.replace(/\(.*$/, '')] ?? raw;

/**
 * The golden handler's arguments AS THE STUB EVENT WOULD PRODUCE THEM. See widening 2 above:
 * `this.checked?'done':'pending'` is collapsed to its false branch before the quoted literals are read,
 * because the shared stub carries no `checked` property.
 */
function stubArgs(raw: string): string[] {
  const collapsed = raw.replace(/this\.checked\?'([^']*)':'([^']*)'/g, (_m, _t: string, f: string) => `'${f}'`);
  return [...collapsed.matchAll(/'([^']*)'|"([^"]*)"/g)].map((a) => a[1] ?? a[2]);
}

/** The recorder, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

function recorder(calls: { attr: string; args: string[] }[]) {
  return (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args
        .filter((a) => (typeof a === 'string' || typeof a === 'number') && a !== STUB_VALUE)
        .map(String),
    });
}

function assertParity(golden: string, node: (rec: (a: string) => (...x: unknown[]) => void) => React.ReactElement) {
  const want = goldenHandlers(golden);
  const calls: { attr: string; args: string[] }[] = [];
  const record = recorder(calls);
  misfire = record('misfire');

  const got = reactHandlers(node(record));
  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => stubArgs(h.raw)));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard. `args.length > 0` is unsatisfiable here (both closeLoad() handlers carry none), so
  // the replacement is that every golden handler resolved to a prop this file names.
  expect(want.length).toBeGreaterThan(0);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
}

function assertBodyHandlers(over: Partial<Props> = {}) {
  assertParity(BODY, (record) => (
    <Body {...props({ onSet: record('set') as never, onAssign: record('assign') as never, ...over })} />
  ));
}

function assertShellHandlers(over: Partial<Props> = {}) {
  assertParity(SHELL, (record) =>
    screen({ tasks: null, initial: true, onLoad: record('load') as never, ...over }));
}

describe('the comparison still bites', () => {
  const want = sameDocument(BODY);
  const withTask = (i: number, over: Partial<CloseTask>) =>
    renderedBody({ tasks: TASKS.map((t, k) => (k === i ? { ...t, ...over } : t)) });

  it('the golden really holds five checklist rows and every control this screen has', () => {
    // Guard the guard for the whole block: a golden that had captured the SPINNER would make every case
    // below vacuous, which is exactly the finance.qinv trap.
    expect((BODY.match(/<tr>/g) || []).length).toBe(6);          // 1 header row + 5 task rows
    expect(BODY).not.toContain('spin');
    expect((BODY.match(/closeSet\(/g) || []).length).toBe(10);   // 5 checkboxes + 5 selects
    expect((BODY.match(/closeAssign\(/g) || []).length).toBe(5);
    expect((BODY.match(/<select/g) || []).length).toBe(5);
    expect(TASKS.length).toBe(5);
  });

  it('catches a step dropped out of the checklist, or one added', () => {
    expect(renderedBody({ tasks: TASKS.slice(0, 4) })).not.toBe(want);
    expect(renderedBody({ tasks: [...TASKS, { ...TASKS[0], id: 'c6' }] })).not.toBe(want);
  });

  it("catches a step's TITLE, category or assignee changing", () => {
    expect(withTask(0, { title: 'Bank rec' })).not.toBe(want);
    expect(withTask(1, { category: 'Bank' })).not.toBe(want);
    expect(withTask(3, { assignee: 'AZLINA' })).not.toBe(want);
    // The last task has NO category — the pill must not appear for it.
    expect(TASKS[4].category).toBe('');
    expect(withTask(4, { category: 'Reporting' })).not.toBe(want);
  });

  it('catches a step REPORTING COMPLETE when it is not — the checkbox, the dimming and the select', () => {
    // Three independent bits of markup say "done" on this screen, and all three must agree with the
    // server's status. Any one of them lying is a month-end step nobody goes back to.
    expect(withTask(2, { status: 'done' })).not.toBe(want);              // pending row → ticked
    expect(withTask(0, { status: 'pending' })).not.toBe(want);           // done row → unticked
    expect(sameDocument(BODY.replace(' checked', ''))).not.toBe(want);   // the tick alone
    expect(sameDocument(BODY.replace('opacity:.55', ''))).not.toBe(want); // the dimming alone
    expect(sameDocument(BODY.replace('<option value="done" selected>', '<option value="done">')))
      .not.toBe(want);                                                   // the select alone
  });

  it('catches the in_progress row being shown as either of its neighbours', () => {
    expect(TASKS[1].status).toBe('in_progress');
    expect(withTask(1, { status: 'pending' })).not.toBe(want);
    expect(withTask(1, { status: 'done' })).not.toBe(want);
  });

  it('catches the PROGRESS header or the bar drifting from the rows underneath it', () => {
    // 1 of 5 done → 20%. The bar's width IS the number, so a rounding change diffs to the last digit.
    expect(progress(TASKS)).toEqual({ done: 1, total: 5, pct: 20 });
    expect(BODY).toContain('1 / 5 tasks done');
    expect(BODY).toContain('width:20%');
    expect(withTask(2, { status: 'done' })).not.toBe(want);
    expect(sameDocument(BODY.replace('1 / 5', '2 / 5'))).not.toBe(want);
    expect(sameDocument(BODY.replace('width:20%', 'width:40%'))).not.toBe(want);
    expect(sameDocument(BODY.replace('>20%<', '>40%<'))).not.toBe(want);
  });

  it('turns the percentage GREEN only at exactly 100 — app.html:5752', () => {
    const all = TASKS.map((t) => ({ ...t, status: 'done' }));
    expect(progress(all).pct).toBe(100);
    const green = renderToStaticMarkup(body({ tasks: all }));
    expect(green).toContain('var(--green-soft)');
    expect(green).not.toContain('color:var(--coral-soft)');
    // 4 of 5 rounds to 80, not 100 — the bar must not go green a step early.
    const nearly = TASKS.map((t, i) => ({ ...t, status: i === 4 ? 'pending' : 'done' }));
    expect(progress(nearly)).toEqual({ done: 4, total: 5, pct: 80 });
    expect(renderToStaticMarkup(body({ tasks: nearly }))).toContain('var(--coral-soft)');
  });

  it('survives an empty checklist rather than dividing by zero — app.html:5751', () => {
    expect(progress([])).toEqual({ done: 0, total: 0, pct: 0 });
    const html = renderToStaticMarkup(body({ tasks: [] }));
    expect(html).toContain('0 / 0 tasks done');
    expect(html).toContain('width:0%');
    expect(html).not.toContain('NaN');
  });

  it('offers exactly the three statuses, in order — app.html:5757', () => {
    const legacy = [...APP.slice(APP.indexOf('function closeLoad()'), APP.indexOf('async function closeSet('))
      .matchAll(/<option value="([a-z_]+)"/g)].map((m) => m[1]);
    expect(legacy).toEqual(['pending', 'in_progress', 'done']);
    expect(CLOSE_STATUSES.map((s) => s[0])).toEqual(['pending', 'in_progress', 'done']);
    expect(CLOSE_STATUSES.map((s) => s[1])).toEqual(['Pending', 'In progress', 'Done']);
  });

  it('catches the PERIOD label drifting from the month that was loaded', () => {
    // The single most dangerous label on the screen: an operator ticking July's rows under an August
    // heading closes the wrong month, and `close_update` resolves the row by id without re-checking it.
    expect(renderedShell({ tasks: null, initial: true, period: '2026-07' })).not.toBe(sameDocument(SHELL));
    expect(renderToStaticMarkup(screen({ tasks: null, initial: true }))).toContain('value="2026-08"');
  });

  it('keeps close_period UNCONTROLLED and keeps its id — closeLoad() reads it back out of the DOM', () => {
    const html = renderToStaticMarkup(screen());
    expect(html).toContain('id="close_period"');
    expect(APP).toContain("var period=document.getElementById('close_period').value;");
    // A controlled input would carry an onInput/onChange pair the golden does not have; the golden's
    // only handler there is the onchange that reloads.
    expect(sameDocument(SHELL.replace('id="close_period"', ''))).not.toBe(sameDocument(SHELL));
  });

  it('catches an escaping hole: server text reaches the page as text, not markup', () => {
    const html = renderToStaticMarkup(body({ tasks: [{ ...TASKS[0], title: '<script>x</script>' }] }));
    expect(html).not.toContain('<script>');
    const a = renderToStaticMarkup(body({ tasks: [{ ...TASKS[0], assignee: '"><script>x</script>' }] }));
    expect(a).not.toContain('<script>');
  });

  // ── the screen-local empty-style rule cannot hide anything ───────────────────────────────────────
  it('dropEmptyStyle removes only an EMPTY style attribute, and nothing else', () => {
    expect(dropEmptyStyle('<b style="">x</b>')).toBe('<b>x</b>');
    // Any content survives, so gaining or losing the dimming still diffs.
    expect(dropEmptyStyle('<b style="opacity:.55">x</b>')).toBe('<b style="opacity:.55">x</b>');
    expect(dropEmptyStyle('<b style=" ">x</b>')).toBe('<b style=" ">x</b>');
    // Other empty attributes are NOT its business — the assignee box's value="" is load-bearing.
    expect(dropEmptyStyle('<input value="" class="">')).toBe('<input value="" class="">');
    // It is anchored on the space before the name, so `data-style=""` is untouched.
    expect(dropEmptyStyle('<b data-style="">x</b>')).toBe('<b data-style="">x</b>');
  });

  it('a row that gained or lost its dimming still diffs after the rule runs', () => {
    expect(sameDocument(BODY.replace('style="opacity:.55"', 'style=""'))).not.toBe(want);
    expect(sameDocument(BODY.replace('<b style="">Payroll', '<b style="opacity:.55">Payroll'))).not.toBe(want);
  });

  it('the golden really contains both spellings, so the rule is exercised on real bytes', () => {
    expect(BODY).toContain('<b style="opacity:.55">');
    expect((BODY.match(/<b style="">/g) || []).length).toBe(4);
  });

  // ── mis-wired handlers ───────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=`, so every case here is invisible to the diff above.

  it('catches a checkbox bound to the wrong task — five near-identical rows', () => {
    expect(() => assertBodyHandlers({
      onSet: ((_id: string, status: string) => misfire(TASKS[0].id, status)) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches an OFF-BY-ONE across the rows — every control shifted to its neighbour', () => {
    const shift: Record<string, string> = { c1: 'c2', c2: 'c3', c3: 'c4', c4: 'c5', c5: 'c1' };
    expect(() => assertBodyHandlers({
      onSet: ((id: string, s: string) => misfire(shift[id], s)) as never,
    })).toThrow(/deeply equal/);
    expect(() => assertBodyHandlers({
      onAssign: ((id: string, v: string) => misfire(shift[id], v)) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches the checkbox MAPPING inverting — a step that reports complete when it is not', () => {
    expect(() => assertBodyHandlers({
      onSet: ((id: string, s: string) => misfire(id, s === 'pending' ? 'done' : 'pending')) as never,
    })).toThrow(/deeply equal/);
  });

  it('and the TRUE branch of that mapping, which the stub event cannot reach', () => {
    // `reactHandlers()` invokes with `{target:{value}}` and no `checked`, so parity above only exercises
    // unticking. Ticking is driven directly here, against the legacy's own text.
    const seen: [string, string][] = [];
    const node = <Body {...props({ onSet: (id, s) => seen.push([id, s]) })} />;
    // 10 onchange handlers in all — checkbox then select, per row.
    expect(reactHandlers(node).filter((h) => h.attr === 'onchange').length).toBe(10);
    // Invoked directly rather than through the shared stub, which carries no `checked`.
    const rowHandlers = collectCheckboxHandlers(node);
    expect(rowHandlers.length).toBe(5);
    rowHandlers[2]({ target: { checked: true } });
    rowHandlers[0]({ target: { checked: false } });
    expect(seen).toEqual([['c3', 'done'], ['c1', 'pending']]);
    expect(APP).toContain("this.checked?\\'done\\':\\'pending\\'");
  });

  it('catches the status SELECT posting something other than what was picked', () => {
    expect(() => assertBodyHandlers({
      onSet: ((id: string, s: string) => misfire(id, s === STUB_VALUE ? 'done' : s)) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches the assignee box and the checkbox swapping — different props, same row id', () => {
    expect(() => assertBodyHandlers({ onAssign: ((id: string) => misfire(id, 'pending')) as never }))
      .toThrow(/deeply equal/);
  });

  it('catches the ↻ Load button and the month picker swapping — neither carries an argument', () => {
    expect(() => assertShellHandlers({ onLoad: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches a control that stopped calling anything at all', () => {
    expect(() => assertBodyHandlers({ onSet: (() => {}) as never })).toThrow(/deeply equal/);
    expect(() => assertBodyHandlers({ onAssign: (() => {}) as never })).toThrow(/deeply equal/);
    expect(() => assertShellHandlers({ onLoad: (() => {}) as never })).toThrow(/deeply equal/);
  });
});

/** Every checkbox's raw onChange, in document order — the true branch is unreachable via the stub. */
function collectCheckboxHandlers(node: React.ReactElement): ((e: unknown) => void)[] {
  const out: ((e: unknown) => void)[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const el = n as { type?: unknown; props?: Record<string, unknown> };
    if (!('props' in el)) return;
    const p = (el.props || {}) as Record<string, unknown>;
    if (el.type === 'input' && p.type === 'checkbox' && typeof p.onChange === 'function') {
      out.push(p.onChange as (e: unknown) => void);
    }
    if (typeof el.type === 'function') {
      walk((el.type as (q: Record<string, unknown>) => unknown)(p));
      return;
    }
    walk(p.children);
  };
  walk(node);
  return out;
}

describe('the states no golden holds', () => {
  // `#close_out` carries four documents and the golden holds one. The other three are mirrored from
  // app.html:5740, :5745, :5746 and :5761 and pinned here, because the diff cannot see them.

  it('paints the muted "Loading…" renderClose() writes, before closeLoad() has run — app.html:5740', () => {
    expect(renderToStaticMarkup(body({ tasks: null, initial: true }))).toBe('Loading…');
  });

  it("paints the spinner while {api:'close_list'} is in flight — app.html:5745, a DIFFERENT document", () => {
    expect(renderToStaticMarkup(body({ tasks: null })))
      .toBe('<div class="load"><span class="spin"></span>Loading…</div>');
    // The two must not be collapsed into one: the frame's is bare text inside the muted div.
    expect(renderToStaticMarkup(body({ tasks: null })))
      .not.toBe(renderToStaticMarkup(body({ tasks: null, initial: true })));
  });

  it("shows the server's own message when the call fails — app.html:5746 and :5761", () => {
    const html = renderToStaticMarkup(body({ error: 'unauthorized' }));
    expect(html).toBe('<div style="color:var(--red-soft)">unauthorized</div>');
    // A failed load must not leave last month's checklist on screen for someone to tick.
    expect(html).not.toContain('Payroll journal from HR OS');
    expect(html).not.toContain('tasks done');
  });

  it('none of those states is the golden, so the diff above really is the loaded checklist', () => {
    for (const s of [{ tasks: null }, { tasks: null, initial: true }, { error: 'x' }] as Partial<Props>[]) {
      expect(renderedBody(s)).not.toBe(sameDocument(BODY));
    }
  });
});

describe('the requests this screen makes — no golden sees a body, and each marks a month-end step', () => {
  const fn = APP.slice(APP.indexOf('async function closeSet('), APP.indexOf('/* ---- Bank reconciliation'));

  it('are exactly what closeSet() and closeAssign() POST, read out of app.html rather than retyped', () => {
    // A retyped expectation agrees with a widened port by construction.
    const legacy = [...fn.matchAll(/call\(\{([^}]*)\}\)/g)].map((m) => m[1].replace(/\s+/g, ''));
    expect(legacy).toEqual(["api:'close_update',id:id,status:status", "api:'close_update',id:id,assignee:assignee"]);
    expect(updateBody('c3', 'done')).toEqual({ api: 'close_update', id: 'c3', status: 'done' });
    expect(assignBody('c3', 'OPS')).toEqual({ api: 'close_update', id: 'c3', assignee: 'OPS' });
  });

  it('carry the task id and nothing else that could redirect them to another month', () => {
    expect(Object.keys(updateBody('i', 's')).sort()).toEqual(['api', 'id', 'status']);
    expect(Object.keys(assignBody('i', 'a')).sort()).toEqual(['api', 'assignee', 'id']);
    // `close_update` (finance.ts:826) resolves the row by id and never re-reads the period, so a body
    // that carried one would be ignored — and a body that carried a ROW INDEX would decide about
    // whatever the server's current ordering says, which is not what the operator clicked.
    expect(JSON.stringify(updateBody('i', 's'))).not.toMatch(/period|index|\brow\b/);
    expect(JSON.stringify(assignBody('i', 'a'))).not.toMatch(/period|index|\brow\b/);
  });

  it('never send a status and an assignee in one body — the legacy makes two separate calls', () => {
    // `close_update` writes only the keys it is given (finance.ts:831). One body carrying both would
    // overwrite an assignee an operator never touched.
    expect(updateBody('i', 's').assignee).toBeUndefined();
    expect(assignBody('i', 'a').status).toBeUndefined();
  });

  it('refuse a blank task id rather than posting one — reconcileBody("")\'s rule', () => {
    expect(() => updateBody('', 'done')).toThrow();
    expect(() => assignBody('', 'OPS')).toThrow();
  });
});

describe('the default period — a derivation from the clock, lifted out of the component', () => {
  it('is the MYT month, which is what the golden was captured under', () => {
    expect(defaultPeriod(FIXED_MS)).toBe('2026-08');
    expect(SHELL).toContain('value="2026-08"');
  });

  it('is +8h, not UTC — the legacy comment\'s own case, before 8am on the 1st', () => {
    // 2026-09-01T00:30 MYT is 2026-08-31T16:30 UTC. A UTC read pre-selects AUGUST and the operator
    // ticks last month's checklist.
    expect(defaultPeriod(Date.parse('2026-08-31T16:30:00.000Z'))).toBe('2026-09');
    expect(new Date(Date.parse('2026-08-31T16:30:00.000Z')).toISOString().slice(0, 7)).toBe('2026-08');
    expect(APP).toContain("var period=todayLocalISO().slice(0,7); // MYT, not UTC");
  });

  it('zero-pads the month, so January is 01 and not 1', () => {
    expect(defaultPeriod(Date.parse('2027-01-05T00:00:00.000Z'))).toBe('2027-01');
    expect(defaultPeriod(Date.parse('2027-12-05T00:00:00.000Z'))).toBe('2027-12');
  });
});

describe('the feature gate — app.html:1434, the chain\'s final else', () => {
  const block = APP.slice(APP.indexOf("document.querySelectorAll('.tab').forEach"), APP.indexOf("// Hide any category"));

  it('opens for a role whose feature list contains close', () => {
    expect(closeReachable({ features: ['overview', 'close'] })).toBe(true);
    expect(closeReachable(FIXTURES.my_perms as { features: string[] })).toBe(true);
  });

  it('is REFUSED for every login without it — including one that may manage users', () => {
    expect(closeReachable({ features: ['overview'] })).toBe(false);
    expect(closeReachable({ features: [] })).toBe(false);
    expect(closeReachable({})).toBe(false);
    expect(closeReachable(null)).toBe(false);
    expect(closeReachable(undefined)).toBe(false);
    // NOT the admin gate. A manage_users login with no `close` feature must still be refused, which is
    // what tells this apart from its `!canManage` neighbours (wht, selfbill, gateway, bankfeed…).
    expect(closeReachable({ manage_users: true } as never)).toBe(false);
  });

  it('really is the fall-through: `close` is named in NO branch of showApp()', () => {
    // Read the whole block, not one line. Four Finance screens have found their gate was not their
    // neighbours' — this asserts the shape rather than trusting the brief.
    expect(block).toContain("else el.classList.toggle('hide', feats.indexOf(t)<0);");
    expect(block).not.toMatch(/t==='close'/);
    // Guard the guard: the same read DOES find the tabs that have their own branch.
    for (const t of ['users', 'ctgaccess', 'info', 'pharm', 'ocr', 'ap', 'selfbill', 'wht', 'gateway', 'bankfeed', 'salesrecon']) {
      expect(block).toMatch(new RegExp(`t==='${t}'`));
    }
  });

  it('the fixture role the golden was captured under really carries the feature', () => {
    // Guard the guard for the positive case above: if the fixture ever dropped `close`, that test would
    // be asserting nothing.
    expect((FIXTURES.my_perms as { features: string[] }).features).toContain('close');
  });

  it('renderClose() itself has no role check, which is why the gate has to be ported', () => {
    const fn = APP.slice(APP.indexOf('function renderClose()'), APP.indexOf('async function closeLoad()'));
    for (const s of ['PERMS', 'canManage', 'manage_users', 'features']) expect(fn).not.toContain(s);
  });
});
