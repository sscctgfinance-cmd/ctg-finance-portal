// HR OS · Employees — the React screen against the legacy screen's committed golden.
//
// `tests/golden/hr.employees.html` was captured from `hrEmployees()` (hros.html:2730) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts or
// tests/parity.ts. The component is rendered with `renderToStaticMarkup` from the SAME fixture the
// golden was captured from — tests/render_fixtures.ts, imported directly — normalised by the harness's
// own normalise(), relaxed by the documented layer in ./parity.ts, and compared.
//
// ── ONE SCREEN-LOCAL RULE, `decodeAttrAmp` ─────────────────────────────────────────────────────────
// Held to ./parity.ts's own bar, and argued at the bottom of this file. Same shape as
// hr-calculator's `dedupeAttrs`: a legacy renderer emitting markup React cannot emit is a finding, and
// it belongs in the screen that found it — not in the shared layer three siblings depend on.
//
// ── THE MODE THE GOLDEN DOES NOT HOLD ──────────────────────────────────────────────────────────────
// `HR.editEmp` is `null` on every `hrNav()` (hros.html:1457), so the harness captured the DIRECTORY.
// The form is reached without a route change and is therefore not in any golden. `the edit mode the
// golden does not hold` below covers it against the contract that actually governs it: the `hr_*`
// element ids `hrSaveEmp()` (hros.html:2886) reads the form back out of the DOM by, extracted from
// hros.html at run time so the check cannot drift from the function it protects.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrEmployees, { EMP_UI_DEFAULT, matchEmployees, type Bank, type Employee } from '../src/hr-employees';
import { REPO, goldenSection, relax } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `hrCompanyName()` (hros.html:4445) resolves the chip in the page head to the selected company. */
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;
const EMPLOYEES = FIXTURES.hr_bootstrap.employees as Employee[];
const BANKS = FIXTURES.hr_bootstrap.banks as Bank[];

/**
 * The `#hr` element is what `hrRender()` writes the page head and the screen body into (hros.html:1554).
 * The golden's other section is chrome for every HR view, not this screen: `#hr_nav` is `hrSidebar()`.
 * report.md §3.5 puts it outside a screen-by-screen strangler — keep it in the legacy files,
 * re-implement once in the shell.
 */
const GOLDEN = goldenSection('hr.employees', 'hr');

const noop = () => {};

/** The whole opening tag of the element with this id — React does not fix attribute order the way the
 *  legacy string concatenation does, so an assertion about one attribute must not assume its position. */
function tagById(html: string, id: string): string {
  const m = html.match(new RegExp(`<[a-zA-Z][^>]*\\bid="${id}"[^>]*>`));
  expect(m, `no element with id="${id}"`).not.toBeNull();
  return m![0];
}

function screen(over: Partial<Parameters<typeof HrEmployees>[0]> = {}) {
  return (
    <HrEmployees
      employees={EMPLOYEES}
      banks={BANKS}
      companyName={COMPANY_NAME}
      ui={EMP_UI_DEFAULT}
      editEmp={null}
      onFilter={noop}
      onReset={noop}
      onEditEmp={noop}
      onDeleteEmp={noop}
      onEnableLogin={noop}
      onEnableLoginBulk={noop}
      onClose={noop}
      onSave={noop}
      onBankInput={noop}
      onBankBlur={noop}
      {...over}
    />
  );
}

/**
 * `&amp;` and a bare `&` inside an ATTRIBUTE VALUE are the same attribute — the HTML parser produces the
 * character `&` from both, because `& clock` is not a character reference. `hrEmpCard()` (hros.html:2712)
 * writes that title without `esc()`, so the golden carries the bare form; React's attribute escaper has
 * no way to emit it, exactly as it has no way to emit hr-calculator's duplicate `style=`. Applying the
 * parser's own rule to BOTH sides compares the documents rather than the spelling.
 *
 * Deliberately the narrowest rule that covers it: only `&amp;`, only inside a double-quoted attribute
 * value, only inside a tag. It cannot hide a changed number, a dropped row, a renamed label or a missing
 * attribute — it rewrites five characters into one character in a place where both are the same
 * character, and it runs identically on both sides. `decodeAttrAmp cannot hide a real change` below is
 * the test that fails if it ever widened.
 *
 * It lives HERE and not in ./parity.ts because parity.ts is shared with sibling migrations in flight and
 * the brief puts it off limits. If a second screen hits a bare `&` in an attribute, that is the moment
 * to move it — one screen is not evidence about the shared layer.
 */
export function decodeAttrAmp(html: string): string {
  return html.replace(/<[a-zA-Z][^>]*>/g, (tag) => tag.replace(/="[^"]*"/g, (v) => v.replace(/&amp;/g, '&')));
}

/** Both sides read as the document a parser builds, then compared under ./parity.ts's six relaxations. */
const sameDocument = (html: string) => relax(decodeAttrAmp(html));

const rendered = (over: Partial<Parameters<typeof HrEmployees>[0]> = {}) => sameDocument(renderToStaticMarkup(screen(over)));

describe('HR Employees — React vs the legacy golden', () => {
  it('renders the same document as hrEmployees() does', () => {
    expect(rendered()).toBe(sameDocument(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * The golden identifies most rows by a quoted id (`hrEditEmp('e2')`) but identifies the "+ Add employee"
 * button by a BARE INTEGER — `hrEditEmp(0)`, where `0` is `hrEditEmp()`'s (hros.html:2789) sentinel for
 * "a blank record, not an existing employee". `goldenHandlers().args` collects quoted literals only, so
 * that call reads as `[]` and a + Add button wired to `hrEditEmp('e1')` — which opens a REAL employee's
 * IC and bank details under a form headed "New employee" — would compare equal. `identArgs()` takes
 * quoted literals AND bare integers, a strict superset of `goldenHandlers().args`, so it can only
 * tighten the check. Fifth screen to need it (hr.approvals, hr.leave, hr.yearend, hr.dashboard); still
 * in the screen's own file, because tests/handlers.ts is shared and off limits (CLAUDE.md).
 */
function identArgs(raw: string): string[] {
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|\b(\d+)\b/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/**
 * What makes relaxation R1 safe on THIS screen. R1 drops `on*=` from the string comparison, so the
 * golden's `onclick="hrEditEmp('e2')"` would otherwise compare equal to a button wired to `'e1'` — which
 * on the employee directory means opening one person's IC, bank account and salary while believing you
 * are editing another's, and saving it over theirs. This puts the argument back: same handler kinds,
 * same document order, same identifying arguments.
 *
 * Inline rather than in ./tests/handlers.ts because that file is shared with sibling migrations in
 * flight and the brief puts it off limits; it exports exactly the two halves this needs.
 */
function assertHandlerParity(over: Partial<Parameters<typeof HrEmployees>[0]> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args
        .filter((a) => (typeof a === 'string' && a !== STUB_VALUE) || typeof a === 'number')
        .map(String),
    });

  const got = reactHandlers(screen({
    onFilter: record('filter') as never,
    onEditEmp: record('editEmp') as never,
    onEnableLogin: record('enableLogin') as never,
    onEnableLoginBulk: record('enableLoginBulk') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());
  expect(calls.map((c) => c.args)).toEqual(want.map((h) => identArgs(h.raw)));

  // Guard the guard: if the golden ever stops carrying handlers, the two `toEqual`s above pass
  // vacuously and R1 becomes the blind strip it is not allowed to be.
  expect(want.length).toBeGreaterThan(0);
  expect(want.some((h) => identArgs(h.raw).length > 0)).toBe(true);
}

describe('the comparison still bites', () => {
  // Relaxations are only defensible if they cannot absorb a real change. These render the screen wrong
  // on purpose, from the defects that would actually hurt on the employee master, and require the
  // comparison to notice each one.
  const want = sameDocument(GOLDEN);

  it('catches a dropped employee — one who would then never be paid', () => {
    expect(rendered({ employees: EMPLOYEES.filter((e) => e.id !== 'e2') })).not.toBe(want);
  });

  it('catches a changed salary', () => {
    expect(rendered({ employees: EMPLOYEES.map((e) => e.id === 'e1' ? { ...e, basic_salary: 5300 } : e) })).not.toBe(want);
  });

  it('catches a leaver leaking into the active directory', () => {
    // e4 is the golden's one leaver and is absent from it. A status filter that stopped excluding them
    // would put a former employee back on the roster the payroll run is built from.
    expect(rendered({ employees: EMPLOYEES.map((e) => e.id === 'e4' ? { ...e, status: 'active' } : e) })).not.toBe(want);
  });

  it('catches `resign_date` alone stopping being enough to mean "gone" — hros.html:2790', () => {
    // `hrIsResigned()` treats EITHER a resigned status OR a resign date as gone. A port that read only
    // `status` would leave this employee — dated out but not yet re-statused — in the active roster, and
    // offer them an HR OS login on their way out. The golden holds three cards; this must not add a
    // fourth.
    const dated = EMPLOYEES.map((e) => e.id === 'e4' ? { ...e, status: 'active', resign_date: '2026-07-31' } : e);
    expect(rendered({ employees: dated })).toBe(want);
    expect(matchEmployees(dated, EMP_UI_DEFAULT).map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('catches a login pill turning into an "Enable login" button', () => {
    // e1 already has `user_id`. Dropping it re-offers a login that exists — `hr_rc_enable_login` would be
    // called against someone who is already signed in, and the operator would hand out a password reset
    // they did not intend.
    expect(rendered({ employees: EMPLOYEES.map((e) => e.id === 'e1' ? { ...e, user_id: null } : e) })).not.toBe(want);
  });

  it('catches the "no HR OS login yet" count drifting off the roster it counts', () => {
    expect(rendered({ employees: EMPLOYEES.map((e) => e.id === 'e3' ? { ...e, email: null } : e) })).not.toBe(want);
  });

  it('catches a changed sort — the same three rows in a different order', () => {
    expect(rendered({ ui: { ...EMP_UI_DEFAULT, sort: 'salary' } })).not.toBe(want);
  });

  it('catches a filter that stopped filtering', () => {
    expect(rendered({ ui: { ...EMP_UI_DEFAULT, status: '' } })).not.toBe(want);
  });

  it('catches the write controls appearing for a view-only user', () => {
    // hros.html:1374 — `hrRW()` returns '' for a viewer. The golden was captured with HR_VIEWER=false
    // (tests/render_surfaces.ts:91), so this is the direction that must differ.
    expect(rendered({ viewer: true })).not.toBe(want);
  });

  it('catches a mis-wired Edit button — the wrong employee opened for editing', () => {
    const bent: string[][] = [];
    const record = (...args: unknown[]) => { bent.push(args.filter((a) => typeof a === 'string' || typeof a === 'number').map(String)); };
    // Every "Edit" fires against e1 instead of its own row: the defect R1 alone cannot see.
    const got = reactHandlers(screen({ onEditEmp: (() => record('e1')) as never, onFilter: (() => record()) as never, onEnableLogin: (() => record()) as never, onEnableLoginBulk: (() => record()) as never }));
    got.forEach((h) => h.invoke());
    expect(bent).not.toEqual(goldenHandlers(GOLDEN).map((h) => identArgs(h.raw)));
  });

  it('catches the + Add button opening a real employee instead of a blank record', () => {
    // `hrEditEmp(0)` vs `hrEditEmp('e1')`: only identArgs() sees this, because `0` is not quoted.
    expect(() => assertHandlerParity({ onEditEmp: ((id: string | 0) => id) as never })).toThrow();
  });
});

describe('IC and bank details stay where the legacy screen put them', () => {
  // The employee master is the one screen that holds an IC number and a bank account. `hrEmpCard()`
  // (hros.html:2701) shows `bank_name` and nothing else; a port that added `bank_account` or `ic_no` to
  // the card — or to a `title=`, or to a data attribute — would widen where they appear without anyone
  // noticing, because the directory would still "look right". These assert the legacy split directly.
  const markup = renderToStaticMarkup(screen());

  it('renders no IC number in the directory', () => {
    for (const e of EMPLOYEES) expect(markup).not.toContain(e.ic_no!);
  });

  it('renders no bank account number, and no account holder name field, in the directory', () => {
    for (const e of EMPLOYEES) expect(markup).not.toContain(e.bank_account!);
  });

  it('renders the bank NAME, which the legacy card does show', () => {
    expect(markup).toContain('Malayan Banking Berhad (Maybank)');
  });

  it('puts the IC and the account number in their own inputs in the form, and nowhere else', () => {
    const form = renderToStaticMarkup(screen({ editEmp: EMPLOYEES[0] }));
    expect(tagById(form, 'hr_ic')).toContain(`value="${EMPLOYEES[0].ic_no}"`);
    expect(tagById(form, 'hr_bankAccount')).toContain(`value="${EMPLOYEES[0].bank_account}"`);
    // Once each, in that input and nowhere else — not in a title, not in a data attribute, not in text.
    expect(form.split(EMPLOYEES[0].ic_no!).length - 1).toBe(1);
    expect(form.split(EMPLOYEES[0].bank_account!).length - 1).toBe(1);
  });
});

describe('the edit mode the golden does not hold', () => {
  /**
   * The ids `hrSaveEmp()` (hros.html:2886) reads the form back out of the DOM by, read out of hros.html
   * at run time rather than listed here. A field that loses its id, or is renamed, saves as BLANK — on
   * this form that is a wiped bank account, a wiped IC or a silently reset statutory rate, and no error
   * anywhere. Extracting them from the live source means this check cannot drift from the function it
   * protects.
   */
  const SAVE_IDS = (() => {
    const src = readFileSync(join(REPO, 'hros.html'), 'utf8');
    const at = src.indexOf('async function hrSaveEmp(){');
    expect(at).toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf('\n}', at));
    const ids = new Set<string>([...body.matchAll(/\b(?:v|chk)\('([^']+)'\)/g)].map((m) => 'hr_' + m[1]));
    // `'hr_wd'+n` for the work-day ticks — built by concatenation, so the regex above cannot see them.
    expect(body).toContain("document.getElementById('hr_wd'+n)");
    for (let n = 1; n <= 7; n++) ids.add('hr_wd' + n);
    return [...ids];
  })();

  const form = renderToStaticMarkup(screen({ editEmp: EMPLOYEES[0] }));

  it('reads more than 40 ids out of hrSaveEmp(), so the check below is not vacuous', () => {
    expect(SAVE_IDS.length).toBeGreaterThan(40);
  });

  it('renders every field hrSaveEmp() reads back', () => {
    expect(SAVE_IDS.filter((id) => !form.includes(`id="${id}"`))).toEqual([]);
  });

  it('shows the directory, not the form, when nothing is being edited', () => {
    expect(renderToStaticMarkup(screen())).toContain('id="hr_emp_results"');
    expect(renderToStaticMarkup(screen())).not.toContain('id="hr_bankAccount"');
  });

  it('heads a blank record "New employee" and an existing one "Edit employee"', () => {
    expect(renderToStaticMarkup(screen({ editEmp: {} }))).toContain('<h3>New employee</h3>');
    expect(form).toContain('<h3>Edit employee</h3>');
    expect(renderToStaticMarkup(screen({ editEmp: {} }))).toContain('>Add employee</button>');
    expect(form).toContain('>Save changes</button>');
  });

  it('never shows the form to a view-only user — hros.html:1541', () => {
    const viewer = renderToStaticMarkup(screen({ editEmp: EMPLOYEES[0], viewer: true }));
    expect(viewer).not.toContain('id="hr_bankAccount"');
    expect(viewer).toContain('id="hr_emp_results"');
  });

  it('defaults the account holder to the employee name when the record has none', () => {
    // hros.html:2836 — a blank holder fails `hrSaveEmp()`'s required check, so the legacy pre-fills it.
    const f = renderToStaticMarkup(screen({ editEmp: { ...EMPLOYEES[0], bank_holder: null } }));
    expect(tagById(f, 'hr_bankHolder')).toContain(`value="${EMPLOYEES[0].name}"`);
  });

  it('resolves the bank code from the master list, which is what actually gets saved', () => {
    // `hrBankPicker()` (hros.html:4545): the visible input shows the NAME, `hr_bankCode` carries the code.
    // A picker that showed the right bank while leaving the code blank would silently drop the bank.
    expect(tagById(form, 'hr_bankCode')).toContain('value="MAYBANK"');
    expect(form).toContain('id="hr_bankName"');
  });

  it('offers the employee\'s own position in the datalist, deduped against the default roster', () => {
    // hros.html:2813 — "Senior Executive" is both a default AND e1's position; it must appear once.
    expect(form.split('<option value="Senior Executive">').length - 1).toBe(1);
    expect(form).toContain('<option value="Customer Service">');
  });
});

describe('the filter and sort are the legacy ones', () => {
  // `hrEmpMatch()` is where a row goes missing without the markup looking wrong. The golden only proves
  // the default state; these prove the branches it does not reach.
  it('finds a person by email, not only by name', () => {
    expect(matchEmployees(EMPLOYEES, { ...EMP_UI_DEFAULT, q: 'rajesh@ctg.test' }).map((e) => e.id)).toEqual(['e3']);
  });

  it('treats a missing employment_type as Full-time, as the type filter does', () => {
    const noType = EMPLOYEES.map((e) => e.id === 'e1' ? { ...e, employment_type: null } : e);
    expect(matchEmployees(noType, { ...EMP_UI_DEFAULT, type: 'Full-time' }).map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('lists only leavers under the Resigned filter', () => {
    expect(matchEmployees(EMPLOYEES, { ...EMP_UI_DEFAULT, status: 'resigned' }).map((e) => e.id)).toEqual(['e4']);
  });

  it('sorts by salary high→low, not low→high', () => {
    expect(matchEmployees(EMPLOYEES, { ...EMP_UI_DEFAULT, status: '', sort: 'salary' }).map((e) => e.id)).toEqual(['e4', 'e1', 'e2', 'e3']);
  });
});

describe('decodeAttrAmp cannot hide a real change', () => {
  // The seventh rule this screen adds, held to ./parity.ts's own bar: it re-spells `&amp;` as `&` inside
  // a double-quoted attribute value, and NOTHING else. Each case here fails if it ever widened.
  it('decodes only inside an attribute value', () => {
    expect(decodeAttrAmp('<b title="a &amp; b">x &amp; y</b>')).toBe('<b title="a & b">x &amp; y</b>');
  });

  it('does not absorb a changed attribute value', () => {
    expect(decodeAttrAmp('<b title="a &amp; b">')).not.toBe(decodeAttrAmp('<b title="a &amp; c">'));
  });

  it('does not absorb a dropped attribute', () => {
    expect(decodeAttrAmp('<b title="a &amp; b" id="q">')).not.toBe(decodeAttrAmp('<b title="a &amp; b">'));
  });

  it('leaves every other entity alone', () => {
    expect(decodeAttrAmp('<b title="&nbsp;&lt;&#39;">')).toBe('<b title="&nbsp;&lt;&#39;">');
  });

  it('is what the golden actually needs — without it, the two sides differ', () => {
    expect(relax(renderToStaticMarkup(screen()))).not.toBe(relax(GOLDEN));
  });
});
