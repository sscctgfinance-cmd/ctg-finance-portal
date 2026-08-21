// Finance OS · CTG Access — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.ctgaccess.html` was captured from `renderCtgAccess()` (app.html:4981) by the
// 40-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts, tests/parity.ts or tests/handlers.ts. The component is rendered with
// `renderToStaticMarkup` from the SAME fixture the golden was captured from — tests/render_fixtures.ts,
// imported directly.
//
// NO SEVENTH RELAXATION, and none was needed: ./parity.ts's six are reused unchanged, as twenty-three
// screens before this one did.
//
// ── THE ONE SCREEN-LOCAL RULE: CHARACTER REFERENCES ────────────────────────────────────────────────
// The legacy writes `&middot;`, `&hellip;`, `&mdash;` and `&#8635;` into its HTML strings, so the golden
// holds those characters SPELLED AS REFERENCES. React's text escaper emits only `& < > " '` as
// references — a `·` in JSX comes out as the character, and the literal string `"&middot;"` comes out as
// `&amp;middot;`. Neither side can be spelled into the other. `decodeRefs` below applies the parser's
// own rule to BOTH sides, in THIS file, held to parity.ts's bar and with its own "cannot hide" block.
//
// That is the THIRD screen of this kind (hr.payroll's named `&ldquo;`, finance.bankfeed's numeric
// `&#8599;`) and the first to need BOTH spellings in one file. CLAUDE.md already calls folding one
// reference rule into parity.ts the right next change; it is not made here because parity.ts is shared
// with in-flight sibling migrations and this brief forbids editing it.
//
// ── THE GOLDEN IS TWO SECTIONS, AND `#ctgaccess` IS AN INTERMEDIATE STATE ──────────────────────────
// CLAUDE.md's `finance.qinv` warning, in its sharpest form so far. `renderCtgAccess()` writes
// `#ctgaccess` — the panel with a LOADING SPINNER inside `#ctga_body` — and then calls `ctgaLoad()`,
// which awaits the fetch and overwrites `#ctga_body`. Those are two different element ids, so the
// harness keeps BOTH writes and the golden carries both. The `#ctgaccess` section is therefore the
// frame at t=0 and NOT the screen an operator sees; the screen an operator sees is that panel with the
// `#ctga_body` section substituted in. Both are diffed below, each against the state it was captured
// in, and `the golden's two sections` block proves the claim out of app.html rather than asserting it
// from memory.
//
// ── THIS SCREEN GRANTS AND REVOKES ACCESS TO THE PORTAL ────────────────────────────────────────────
// Four near-identical rows of a person's name, email and staff code, each with a role select and a
// grant/revoke button. R1 strips `on*=` from the string diff, so a control bound to the wrong `sub` is
// invisible above. A grant on the wrong row hands a colleague's account the ADMIN role — "can manage
// users, post to Xero and see every company", in `ctgaGrant()`'s own words; a revoke on the wrong row
// ends their session immediately. Those are what the mis-wire cases below are for.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES } from '../../tests/render_fixtures';
import FinanceCtgAccess, {
  Body, chips, CTGA_ROLES, ctgAccessReachable, grantBody, pickedRole, revokeBody, visibleRows,
  type Counts, type CtgRow, type Orphan,
} from '../src/finance-ctgaccess';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** The panel `render('ctgaccess')` writes — captured with the spinner still inside `#ctga_body`. */
const SHELL = goldenSection('finance.ctgaccess', 'ctgaccess');
/** What `ctgaLoad()` overwrites `#ctga_body` with once the directory resolves. */
const BODY = goldenSection('finance.ctgaccess', 'ctga_body');

const LIST = FIXTURES.ctg_access_list as { rows: CtgRow[]; orphans: Orphan[]; counts: Counts };
const ROWS = LIST.rows;

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');

const noop = () => {};

type Props = Parameters<typeof FinanceCtgAccess>[0];

function props(over: Partial<Props> = {}): Props {
  // The state the harness captured: the list resolved, no search, the "all" chip, nothing in flight.
  return {
    rows: ROWS, orphans: LIST.orphans, counts: LIST.counts, q: '', filter: 'all', busy: false, error: null,
    onFilter: noop, onSearch: noop, onGrant: noop, onRevoke: noop, onRefresh: noop, ...over,
  };
}

const screen = (over: Partial<Props> = {}) => <FinanceCtgAccess {...props(over)} />;
const body = (over: Partial<Props> = {}) => <Body {...props(over)} />;

/**
 * CHARACTER REFERENCES for the same character, decoded on BOTH sides.
 *
 * What it absorbs: `&mdash;` vs `—`, `&#8635;` vs `↻` — the SPELLING of a character an HTML parser reads
 * identically either way. What it cannot absorb: a different character (decodes to something else and
 * still diffs), a dropped one (nothing to decode on one side), a changed number, a renamed label, a lost
 * class or a missing attribute — none of those is a character reference.
 *
 * Deliberately narrow in three ways, each proven by the `still bites` block:
 *   • only the three NAMED references app.html actually writes on this screen, not the ~2000 HTML5
 *     names — a name this screen never uses is left alone, so it cannot quietly cover a later one;
 *   • it does NOT decode `&amp;mdash;`, which is what a React tree trying to emit the literal entity
 *     TEXT produces. That is a real defect (the operator sees `&mdash;` printed on the page) and keeps
 *     diffing;
 *   • it never decodes `"` or `'`, which parity.ts's R6 owns. Decoding a quote before R4 has parsed the
 *     attributes would inject one into an attribute value and break the parse — R6's own stated reason
 *     for running last.
 */
const NAMED: Record<string, string> = { mdash: '—', middot: '·', hellip: '…' };

function decodeRefs(html: string): string {
  return html
    .replace(/&(?!amp;)([a-z]+);/g, (m, name: string) => NAMED[name] ?? m)
    .replace(/&(?!amp;)#(\d+);|&(?!amp;)#[xX]([0-9a-fA-F]+);/g, (m, dec: string, hex: string) => {
      const cp = dec ? Number(dec) : parseInt(hex, 16);
      return cp === 34 || cp === 39 ? m : String.fromCodePoint(cp);
    });
}

/** Both sides read as the same document, then compared under ./parity.ts's six relaxations. */
const sameDocument = (html: string) => relax(decodeRefs(html));

const renderedShell = (over: Partial<Props> = {}) => sameDocument(renderToStaticMarkup(screen(over)));
const renderedBody = (over: Partial<Props> = {}) => sameDocument(renderToStaticMarkup(body(over)));

describe('Finance CTG Access — React vs the legacy golden', () => {
  it('renders the panel renderCtgAccess() writes, spinner and all', () => {
    // `rows: null` is the state the `#ctgaccess` write was taken in — before ctgaLoad() resolves.
    expect(renderedShell({ rows: null })).toBe(sameDocument(SHELL));
  });

  it('renders the same directory ctgaRender() writes into #ctga_body', () => {
    expect(renderedBody()).toBe(sameDocument(BODY));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertBodyHandlers();
    assertShellHandlers();
  });
});

describe("the golden's two sections — the intermediate state, proven out of app.html", () => {
  // CLAUDE.md: check what the legacy renderer does AFTER its innerHTML write before trusting a golden.
  // Here it calls a loader that overwrites a DIFFERENT id, so the two writes do not overwrite one
  // another and the golden holds a state no operator ever sees for longer than a network round trip.
  const fn = APP.slice(APP.indexOf('async function renderCtgAccess()'), APP.indexOf('function ctgaRender()'));

  it('renderCtgAccess() writes #ctgaccess with the spinner and then calls ctgaLoad()', () => {
    expect(fn).toContain("document.getElementById('ctgaccess').innerHTML =");
    expect(fn).toContain('Loading the CTG directory');
    expect(fn.slice(fn.indexOf('loaded.ctgaccess'))).toContain('ctgaLoad();');
  });

  it('ctgaLoad() overwrites a DIFFERENT element, which is why both writes survive', () => {
    expect(fn).toContain("var body = document.getElementById('ctga_body');");
    expect(SHELL).toContain('<div id="ctga_body">');
    expect(SHELL).toContain('Loading the CTG directory');
    expect(BODY).not.toContain('Loading the CTG directory');
  });

  it('so the #ctgaccess section is NOT the screen an operator sees — the two really differ', () => {
    expect(renderedShell({ rows: null })).not.toBe(renderedShell());
    expect(sameDocument(SHELL)).not.toContain('boss@ctg.test');
  });

  it('and the composed screen puts the loaded body inside the panel', () => {
    const html = renderToStaticMarkup(screen());
    expect(html).toContain('<div id="ctga_body">');
    expect(html).toContain('boss@ctg.test');
    expect(html).not.toContain('Loading the CTG directory');
  });

  it('the renderer does nothing else after its write — no appendChild, no .value=, no setTimeout', () => {
    // The finance.qinv trap in its other direction: an appendChild here would mean the SHELL golden was
    // missing a child every operator sees.
    const after = fn.slice(fn.indexOf('loaded.ctgaccess'));
    for (const s of ['appendChild', '.value=', 'setTimeout', 'classList']) expect(after).not.toContain(s);
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * The only defence this screen has against a control bound to the wrong person. `ctgaGrant('ctg-1',…)`
 * and `ctgaGrant('ctg-2',…)` are byte-identical once R1 has stripped them, and the rows differ on screen
 * only by a name an operator scanning a hundred-person directory will not cross-check.
 *
 * `identArgs()` is NOT copied here: no handler on this screen carries a bare integer, so
 * `goldenHandlers().args` — quoted literals — already collects every identifying argument
 * (`'ctg-1'`, `'boss@ctg.test'`, `'linked'`). Adding the widening would be noise.
 *
 * A golden-derived `LEGACY_TO_PROP` IS needed, in the shape hr-payroll and finance-wht established: two
 * handlers carry no identifying argument at all — `ctgaSearch(this.value)` (`this.value` is dropped by
 * design, see handlers.ts) and `ctgaLoad()` — so the argument sequence alone would let Search and
 * Refresh swap silently. Comparing the resolved PROP as well makes each of them nameable.
 *
 * That also breaks the shared guard-the-guard: `want.every(h => h.args.length > 0)` is unsatisfiable on
 * a screen with an argument-free handler. It is REPLACED, not dropped, with "every golden handler name
 * resolved to a known prop" — so a new legacy button cannot fall through `propFor()`'s `?? h.raw`.
 */
const LEGACY_TO_PROP: Record<string, string> = {
  ctgaFilter: 'filter',
  ctgaSearch: 'search',
  ctgaGrant: 'grant',
  ctgaRevoke: 'revoke',
  ctgaLoad: 'refresh',
};

const propFor = (raw: string) => LEGACY_TO_PROP[raw] ?? LEGACY_TO_PROP[raw.replace(/\(.*$/, '')] ?? raw;

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

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard. `args.length > 0` is unsatisfiable here (Search and Refresh carry none), so the
  // replacement is that every golden handler resolved to a prop this file names.
  expect(want.length).toBeGreaterThan(0);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
}

function assertBodyHandlers(over: Partial<Props> = {}) {
  assertParity(BODY, (record) => (
    <Body {...props({
      onFilter: record('filter') as never, onSearch: record('search') as never,
      onGrant: record('grant') as never, onRevoke: record('revoke') as never, ...over,
    })} />
  ));
}

function assertShellHandlers(over: Partial<Props> = {}) {
  assertParity(SHELL, (record) => screen({ rows: null, onRefresh: record('refresh') as never, ...over }));
}

describe('the comparison still bites', () => {
  const want = sameDocument(BODY);
  const withRow = (i: number, over: Partial<CtgRow>) =>
    renderedBody({ rows: ROWS.map((r, k) => (k === i ? { ...r, ...over } : r)) });

  it('the golden really holds four rows and every control this screen has', () => {
    // Guard the guard for the whole block: a golden that had captured the SPINNER would make every case
    // below vacuous, which is exactly the finance.qinv trap.
    expect((BODY.match(/<tr>/g) || []).length).toBe(7);        // 2 header rows + 4 directory rows + 1 orphan
    expect(BODY).not.toContain('spin');
    expect((BODY.match(/ctgaGrant\(/g) || []).length).toBe(3);
    expect((BODY.match(/ctgaRevoke\(/g) || []).length).toBe(2);
    expect((BODY.match(/<select/g) || []).length).toBe(4);
  });

  it('catches a person dropped out of the directory', () => {
    expect(renderedBody({ rows: ROWS.slice(0, 3) })).not.toBe(want);
  });

  it("catches a person's name, email or staff code changing", () => {
    expect(withRow(0, { name: 'B0SS' })).not.toBe(want);
    expect(withRow(1, { email: 'accts@ctg.test' })).not.toBe(want);
    expect(withRow(2, { employee_code: 'CTG-098' })).not.toBe(want);
  });

  it('catches the access badge lying about who is in', () => {
    // Four states share one column: has access / suspended / CTG inactive / no access. A row that said
    // "has access" when the account is suspended is a person an admin thinks can sign in and cannot.
    expect(withRow(1, { portal_active: true })).not.toBe(want);       // suspended → has access
    expect(withRow(0, { linked: false })).not.toBe(want);             // has access → —
    expect(withRow(3, { ctg_active: true })).not.toBe(want);          // CTG inactive → —
    expect(sameDocument(BODY.replace('pill ok', 'pill'))).not.toBe(want);
  });

  it("catches a row's ROLE select showing the wrong role", () => {
    // The select is what an admin reads to answer "what can this person do here?". BOSS is admin.
    expect(withRow(0, { role: 'viewer' })).not.toBe(want);
    expect(sameDocument(BODY.replace('<option value="admin" selected>', '<option value="admin">'))).not.toBe(want);
  });

  it('MIRRORS the legacy on an unknown role: no option marked, not a silent fall to viewer', () => {
    // The fixture gives ctg-2 the role `finance`, which is not one of the four this screen assigns. The
    // legacy marks nothing; a port that defaulted the select to `viewer` would tell an admin the person
    // is a viewer when the server says otherwise, and one careless change-event would MAKE it true.
    const html = renderToStaticMarkup(body({ rows: [ROWS[1]], orphans: [] }));
    expect(html).not.toContain('selected');
    expect(ROWS[1].role).toBe('finance');
  });

  it('offers exactly the four assignable roles, in order — ctgaRoleOpts(), app.html:5070', () => {
    const legacy = APP.slice(APP.indexOf('function ctgaRoleOpts('), APP.indexOf('function ctgaFilter('));
    expect(legacy).toContain("['viewer','employee','hr_admin','admin']");
    expect([...CTGA_ROLES]).toEqual(['viewer', 'employee', 'hr_admin', 'admin']);
  });

  it('catches the unlinked row losing its ctga_role_<sub> id — the select ctgaGrant() reads back', () => {
    // Without the id `ctgaGrant()` silently grants 'viewer' whatever the admin picked (app.html:5085).
    expect(sameDocument(BODY.replace('id="ctga_role_ctg-3"', ''))).not.toBe(want);
    expect(renderToStaticMarkup(body())).toContain('id="ctga_role_ctg-3"');
    expect(renderToStaticMarkup(body())).toContain('id="ctga_role_ctg-4"');
  });

  it('catches a chip COUNT drifting — including the one the client derives', () => {
    // "No access" is `ctg_total - linked` and is the only figure on the screen the server does not send.
    expect(renderedBody({ counts: { ctg_total: 5, linked: 2 } })).not.toBe(want);
    expect(renderedBody({ counts: { ctg_total: 4, linked: 3 } })).not.toBe(want);
    expect(chips({ ctg_total: 4, linked: 2 }).map((c) => c[1]))
      .toEqual(['All 4', 'Has access 2', 'No access 2', 'Inactive at CTG']);
    expect(chips({}).map((c) => c[1])).toEqual(['All 0', 'Has access 0', 'No access 0', 'Inactive at CTG']);
  });

  it('catches the active chip moving', () => {
    expect(renderedBody({ filter: 'linked' })).not.toBe(want);
  });

  it('catches an orphan dropped, or the orphan count drifting from the rows listed', () => {
    // The legacy comment is explicit: these are the people who would be locked out if SSO became the
    // only way in, so they must not be invisible.
    expect(renderedBody({ orphans: [] })).not.toBe(want);
    expect(sameDocument(BODY.replace('directory (1)', 'directory (2)'))).not.toBe(want);
    expect(renderedBody({ orphans: [{ ...LIST.orphans[0], role: 'admin' }] })).not.toBe(want);
  });

  it('catches an escaping hole: server text reaches the page as text, not markup', () => {
    const html = renderToStaticMarkup(body({ rows: [{ ...ROWS[0], name: '<script>x</script>' }] }));
    expect(html).not.toContain('<script>');
  });

  // ── the screen-local decode rule cannot hide anything ────────────────────────────────────────────
  it('decodeRefs decodes only the references app.html writes here, and only as characters', () => {
    expect(decodeRefs('a&mdash;b')).toBe('a—b');
    expect(decodeRefs('&middot;&hellip;&#8635;')).toBe('·…↻');
    expect(decodeRefs('&#x21bb;')).toBe('↻');
    // A name this screen does not use is left alone, so it cannot silently cover a later one.
    expect(decodeRefs('&ldquo;')).toBe('&ldquo;');
    expect(decodeRefs('&amp;')).toBe('&amp;');
    // The defect it must NOT absorb: the entity printed on the page as text.
    expect(decodeRefs('&amp;mdash;')).toBe('&amp;mdash;');
    expect(decodeRefs('&amp;#8635;')).toBe('&amp;#8635;');
    // R6 owns the quotes; decoding one here would break R4's attribute parse.
    expect(decodeRefs('&#39;&#34;&quot;')).toBe('&#39;&#34;&quot;');
  });

  it('a different character still diffs after decoding', () => {
    expect(sameDocument(BODY.replace('&mdash;', '&ndash;'))).not.toBe(want);
    expect(sameDocument(SHELL.replace('&#8635;', '&#8634;'))).not.toBe(sameDocument(SHELL));
    expect(sameDocument(SHELL.replace('&middot;', ''))).not.toBe(sameDocument(SHELL));
  });

  // ── mis-wired handlers ───────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=`, so every case here is invisible to the diff above. These are the defects that
  // hand the wrong person access, or take it from the wrong person.

  it('catches a GRANT bound to the wrong person — four near-identical rows', () => {
    expect(() => assertBodyHandlers({
      onGrant: ((_sub: string, role?: string) => misfire(ROWS[0].sub, role)) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches a REVOKE bound to the wrong person', () => {
    // `ctgaRevoke()` names the person in its confirmation and then ends their session immediately.
    expect(() => assertBodyHandlers({
      onRevoke: ((_s: string, email: string) => misfire(ROWS[1].sub, email)) as never,
    })).toThrow(/deeply equal/);
  });

  it("catches a revoke whose CONFIRMATION names a different person than the sub it posts", () => {
    // The email is what the admin reads in the confirm dialog; the sub is what the server acts on. A
    // pair that disagrees is a dialog that asks about one colleague and cuts off another.
    expect(() => assertBodyHandlers({
      onRevoke: ((sub: string) => misfire(sub, ROWS[0].email)) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches the Grant button quietly forcing a role instead of reading the row select', () => {
    // `ctgaGrant(sub)` with NO role means "read #ctga_role_<sub>". A port that passed 'admin' here
    // would give every newly granted person the admin role.
    expect(() => assertBodyHandlers({
      onGrant: ((sub: string, role?: string) => misfire(sub, role ?? 'admin')) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches a chip that filters by the wrong thing', () => {
    expect(() => assertBodyHandlers({ onFilter: (() => misfire('all')) as never })).toThrow(/deeply equal/);
  });

  it('catches Search and Refresh swapping — neither carries an identifying argument', () => {
    // Both record []; only the resolved PROP tells them apart, which is what LEGACY_TO_PROP is for.
    expect(() => assertBodyHandlers({ onSearch: (() => misfire()) as never })).toThrow(/deeply equal/);
    expect(() => assertShellHandlers({ onRefresh: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches a control that stopped calling anything at all', () => {
    expect(() => assertBodyHandlers({ onGrant: (() => {}) as never })).toThrow(/deeply equal/);
    expect(() => assertBodyHandlers({ onRevoke: (() => {}) as never })).toThrow(/deeply equal/);
  });
});

describe('the states no golden holds', () => {
  // `#ctga_body` carries four documents and the golden holds one. The other three are mirrored from
  // app.html:4993-4998 and 5026 and pinned here, because the diff cannot see them.

  it("paints the loading line while {api:'ctg_access_list'} is in flight — app.html:4993", () => {
    expect(renderToStaticMarkup(body({ rows: null })))
      .toBe('<div class="load"><span class="spin"></span>Loading the CTG directory…</div>');
  });

  it("shows the server's own message when the call fails — app.html:4996", () => {
    const html = renderToStaticMarkup(body({ error: 'CTG app secret rejected' }));
    expect(html).toBe('<div class="empty"><div class="empty-ic">🔒</div><h4>Could not load the CTG directory</h4><p>CTG app secret rejected</p></div>');
    // The directory must not leak past a failed load.
    expect(html).not.toContain('boss@ctg.test');
  });

  it('shows "Nobody matches" for a search that hits nothing — app.html:5026', () => {
    const html = renderToStaticMarkup(body({ q: 'zzz' }));
    expect(html).toContain('<div class="empty"><div class="empty-ic">🔍</div><h4>Nobody matches</h4><p>Try a different search or filter.</p></div>');
    // The chips and the box stay: the legacy writes them BEFORE the empty branch, so the operator can
    // clear the search. A port that returned early here would strand them.
    expect(html).toContain('id="ctga_q"');
    expect(html).toContain('All 4');
  });

  it('disables every write control while a grant or revoke is in flight — app.html:5044', () => {
    const html = renderToStaticMarkup(body({ busy: true }));
    expect((html.match(/disabled=""/g) || []).length).toBe(5);   // 2 selects, 2 Revoke, 1 Grant access
    expect(renderedBody({ busy: true })).not.toBe(sameDocument(BODY));
  });

  it('none of those states is the golden, so the diff above really is the loaded directory', () => {
    for (const s of [{ rows: null }, { error: 'x' }, { q: 'zzz' }, { busy: true }] as Partial<Props>[]) {
      expect(renderedBody(s)).not.toBe(sameDocument(BODY));
    }
  });
});

describe('the filter and the search — ctgaRender(), app.html:5005', () => {
  it('"all" shows everyone the server sent, in the server\'s own order', () => {
    expect(visibleRows(ROWS, 'all', '').map((r) => r.sub)).toEqual(['ctg-1', 'ctg-2', 'ctg-3', 'ctg-4']);
  });

  it('"linked" is exactly the people who can sign in, "unlinked" exactly those who cannot', () => {
    expect(visibleRows(ROWS, 'linked', '').map((r) => r.sub)).toEqual(['ctg-1', 'ctg-2']);
    expect(visibleRows(ROWS, 'unlinked', '').map((r) => r.sub)).toEqual(['ctg-3', 'ctg-4']);
    expect(visibleRows(ROWS, 'linked', '').every((r) => r.linked)).toBe(true);
    expect(visibleRows(ROWS, 'unlinked', '').every((r) => !r.linked)).toBe(true);
  });

  it('"inactive" is people deactivated at CTG — the ones still holding portal access are the point', () => {
    expect(visibleRows(ROWS, 'inactive', '').map((r) => r.sub)).toEqual(['ctg-4']);
  });

  it('searches name, email and staff code, case-insensitively, and nothing else', () => {
    expect(visibleRows(ROWS, 'all', 'azlina').map((r) => r.sub)).toEqual(['ctg-2']);
    expect(visibleRows(ROWS, 'all', 'INTERN@').map((r) => r.sub)).toEqual(['ctg-3']);
    expect(visibleRows(ROWS, 'all', 'ctg-052').map((r) => r.sub)).toEqual(['ctg-4']);
    // `sub` is not searchable in the legacy, and must not become so — it is an SSO subject id.
    expect(visibleRows(ROWS, 'all', 'ctg-1')).toEqual([]);
  });

  it('the filter and the search compose, as the legacy does', () => {
    expect(visibleRows(ROWS, 'linked', 'boss').map((r) => r.sub)).toEqual(['ctg-1']);
    expect(visibleRows(ROWS, 'unlinked', 'boss')).toEqual([]);
  });

  it('survives a row with no name or staff code rather than throwing', () => {
    const thin = [{ ...ROWS[0], name: null, employee_code: null }];
    expect(visibleRows(thin, 'all', 'boss@').length).toBe(1);
    expect(renderToStaticMarkup(body({ rows: thin, orphans: [] }))).toContain('<b>-</b>');
  });
});

describe('the requests this screen makes — no golden sees a body, and each changes who may sign in', () => {
  const fn = APP.slice(APP.indexOf('async function ctgaGrant('), APP.indexOf('function renderUsers()'));

  it('are exactly what ctgaGrant() and ctgaRevoke() POST, read out of app.html rather than retyped', () => {
    // A retyped expectation agrees with a widened port by construction.
    const legacy = [...fn.matchAll(/call\(\{([^}]*)\}\)/g)].map((m) => m[1].replace(/\s+/g, ''));
    expect(legacy).toEqual(["api:'ctg_access_grant',sub:sub,role:role", "api:'ctg_access_revoke',sub:sub"]);
    expect(grantBody('ctg-3', 'viewer')).toEqual({ api: 'ctg_access_grant', sub: 'ctg-3', role: 'viewer' });
    expect(revokeBody('ctg-3')).toEqual({ api: 'ctg_access_revoke', sub: 'ctg-3' });
  });

  it('carry the subject and nothing else that could redirect them', () => {
    expect(Object.keys(grantBody('s', 'r')).sort()).toEqual(['api', 'role', 'sub']);
    expect(Object.keys(revokeBody('s'))).toEqual(['api', 'sub']);
    // Never an email or a row index: the server resolves the person from the SSO subject, and a stale
    // list would otherwise decide about somebody else.
    expect(JSON.stringify(grantBody('s', 'r'))).not.toMatch(/email|index|\brow\b/);
  });

  it('refuse a blank subject rather than posting one — reconcileBody("")\'s rule', () => {
    expect(() => grantBody('', 'admin')).toThrow();
    expect(() => revokeBody('')).toThrow();
  });

  it("pickedRole() reads the row's own select, and falls back to viewer — app.html:5085", () => {
    const doc = { getElementById: (id: string) => (id === 'ctga_role_ctg-3' ? { value: 'hr_admin' } : null) };
    expect(pickedRole('ctg-3', doc)).toBe('hr_admin');
    expect(pickedRole('ctg-4', doc)).toBe('viewer');
    expect(fn).toContain("var sel=document.getElementById('ctga_role_'+sub); role = sel ? sel.value : 'viewer';");
  });

  it('the legacy asks before granting ADMIN, and before every revoke — both confirmations exist', () => {
    // Not migrated away: the route keeps both questions. `showConfirm()` is not migrated (CLAUDE.md), so
    // the browser's own confirm carries the same wording. Pinned here so a later "tidy-up" that drops a
    // question fails a test rather than a colleague's account.
    expect(fn).toContain("if(role==='admin' && !confirm('Give '");
    expect(fn).toContain("if(!confirm('Remove '+email+' access to this portal?");
  });
});

describe('the admin gate — app.html:1423', () => {
  // The withheld direction, asserted. `ctgaRender()` has no role check in it at all.
  it('opens only for a login that may manage users', () => {
    expect(ctgAccessReachable({ manage_users: true })).toBe(true);
  });

  it('is closed for every other shape of permission, including a missing one', () => {
    for (const p of [null, undefined, {}, { manage_users: false }, { manage_users: null }]) {
      expect(ctgAccessReachable(p as never)).toBe(false);
    }
  });

  it('is NOT the feature flag — and is NOT the `users` quirk one line above it either', () => {
    // Read out of app.html rather than from memory. `ctgaccess` is where the if/else-if chain RESTARTS,
    // so it takes its own branch and never reaches the final `else`. `users` is set by the standalone
    // `if` above and then overwritten by that final `else`. Copying either neighbour would be wrong.
    const block = APP.slice(APP.indexOf('const feats=PERMS.features||[]'), APP.indexOf('// Hide any category whose sub-tabs'));
    expect(block).toContain("if(t==='users') el.classList.toggle('hide', !canManage);\n    if(t==='ctgaccess') el.classList.toggle('hide', !canManage);\n    else if(t==='info')");
    expect(block).toContain("else el.classList.toggle('hide', feats.indexOf(t)<0)");
    // A login with every feature but no manage_users still cannot reach it.
    expect(ctgAccessReachable({ features: ['ctgaccess'] } as never)).toBe(false);
  });

  it('is what the route gates on — the screen is the whole staff directory plus live write buttons', () => {
    // Guard the guard: the gate exists because reaching this screen at all shows ~100 colleagues' names,
    // work emails and staff codes, and puts an operator one click from granting the admin role.
    const html = renderToStaticMarkup(body());
    expect(html).toContain('boss@ctg.test');
    expect(html).toContain('CTG-001');
    expect(html).toContain('>Grant access</button>');
    expect(html).toContain('>Revoke</button>');
    expect(html).toContain('leaver@ctg.test');
  });
});
