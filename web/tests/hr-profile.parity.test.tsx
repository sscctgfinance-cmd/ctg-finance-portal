// HR OS · My Profile — the React screen against the legacy screen's committed golden.
//
// `tests/golden/hr.profile.html` was captured from `hrEmpProfile()` (hros.html:3243) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts or
// tests/parity.ts. The component is rendered with `renderToStaticMarkup` from the SAME fixture the
// golden was captured from — tests/render_fixtures.ts, imported directly — normalised by the harness's
// own normalise(), relaxed by the documented layer in ./parity.ts, and compared.
//
// No seventh relaxation. The six the pilot argued cover this screen as it stands.
//
// This screen is the first migrated one that WRITES the employee's own master record, so the file
// carries two blocks the earlier screens did not need, both below the parity diff:
//   • "the write side is a whitelist" — pins the POST body key for key against the LEGACY SOURCE.
//   • "employee mode is a permission boundary" — pins what the screen must NOT show or let through.

import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrProfile, { profileBody, PROFILE_KEYS, type Bank, type ProfileEmployee } from '../src/hr-profile';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `hrCompanyName()` (hros.html:4445) resolves the chip in the page head to the selected company. */
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

/**
 * The `#hr` element is what `hrRender()` writes the page head and the screen body into (hros.html:1554).
 * The golden's other section is `#hr_nav` — `hrSidebar()`, chrome for every HR view, which report.md
 * §3.5 puts outside a screen-by-screen strangler.
 */
const GOLDEN = goldenSection('hr.profile', 'hr');

/**
 * The surface entry for `hr.profile` is `RC_PRIMED` = `hrRCBoot();` (tests/render_surfaces.ts:41,56).
 * That is not a test shortcut: `hrEmpProfile()` reads `RC.me.employee` (hros.html:3244) and
 * `hrSidebar()` hides the Profile link entirely until `hrRCBoot()` has run (hros.html:1508). So the
 * employee this screen is ABOUT is `hr_rc_config`'s `me.employee`, and that is what is passed here.
 * Reading it out of the fixture rather than restating it means a fixture change moves both sides.
 */
const ME = FIXTURES.hr_rc_config.me.employee as ProfileEmployee & Record<string, unknown>;

/** `EPRO.banks` after `hr_banks_list` resolves — hros.html:3247, active ones only. */
const BANKS = (FIXTURES.hr_banks_list.banks as (Bank & { active?: boolean })[])
  .filter((b) => b.active !== false);

const noop = () => {};

function screen(over: Partial<Parameters<typeof HrProfile>[0]> = {}) {
  return (
    <HrProfile
      employee={ME}
      companyName={COMPANY_NAME}
      banks={BANKS}
      onSave={noop}
      onSigStart={noop}
      onSigClearSaved={noop}
      onPwModal={noop}
      {...over}
    />
  );
}

const rendered = (over: Partial<Parameters<typeof HrProfile>[0]> = {}) =>
  relax(renderToStaticMarkup(screen(over)));

describe('HR My Profile — React vs the legacy golden', () => {
  it('renders the same document as hrEmpProfile() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, in the same order, to the same functions', () => {
    assertHandlerParity();
  });
});

/**
 * What makes relaxation R1 safe on THIS screen.
 *
 * R1 drops `on*=` from the string comparison. Every handler on My Profile is ARGUMENT-FREE —
 * `hrEmpProfileSave()`, `hrSigStart()`, `hrPwModal(false)` — so `goldenHandlers().args` is `[]` for all
 * three and argument parity alone is vacuous here: the Save button wired to `hrSigStart` would pass, and
 * so would "Change password" wired to the save. That is not a hypothetical on a form holding an IC
 * number and a bank account.
 *
 * So this compares handler IDENTITY, the way hr-payroll's test does: a golden-DERIVED map from the
 * legacy function name to the prop it became, asserted as a sequence alongside the arguments. Strictly
 * more than the string comparison was checking. `hrPwModal(false)` keys on the function name, not the
 * whole call text, because `false` is not a quoted literal and never reaches `args`.
 *
 * Inline rather than in ./tests/handlers.ts because that file is shared with two sibling migrations in
 * flight and the brief puts it off limits; it exports exactly the two halves this needs.
 */
const LEGACY_TO_PROP: Record<string, string> = {
  hrEmpProfileSave: 'save',
  hrSigStart: 'sigStart',
  hrSigClearSaved: 'sigClearSaved',
  hrPwModal: 'pwModal',
};

function assertHandlerParity(over: Partial<Parameters<typeof HrProfile>[0]> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({ attr, args: args.filter((a): a is string => typeof a === 'string' && a !== STUB_VALUE) });

  const got = reactHandlers(screen({
    onSave: record('save') as never,
    onSigStart: record('sigStart') as never,
    onSigClearSaved: record('sigClearSaved') as never,
    onPwModal: record('pwModal') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());
  expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => LEGACY_TO_PROP[h.raw.replace(/\(.*$/, '')] ?? h.raw));

  // Guard the guard. hr-clock's version of this asserts some handler carries an argument; on this screen
  // none does, which is exactly why the identity comparison above exists. What is asserted instead is
  // that the golden still carries handlers AND that every one of them resolved to a known prop — so a
  // new legacy button appearing in the golden fails here rather than falling through `?? h.raw` into a
  // comparison against a name no prop can ever produce being quietly satisfied by a matching miss.
  expect(want.length).toBeGreaterThan(0);
  expect(want.map((h) => h.raw.replace(/\(.*$/, '')).filter((n) => !(n in LEGACY_TO_PROP))).toEqual([]);
}

/**
 * ── THE WRITE SIDE IS A WHITELIST ───────────────────────────────────────────────────────────────────
 *
 * No golden sees a POST body, so `profileBody()` (src/hr-profile.tsx) is a pure function split out of the
 * route for the same reason `bankFile()` was split out of hr-expenses. The brief asks for two things to
 * be PROVEN rather than assumed, and each has a test below:
 *
 *   • the save targets the signed-in employee and cannot be aimed at another id. The legacy sends no id
 *     at all — `hr_my_profile_save` resolves the target from the token (hr.ts:1362-1364). So the proof
 *     is a negative: no key in the body is or contains an id.
 *   • the field set is exactly what the legacy form allowed, no wider. The proof reads the LEGACY SOURCE
 *     — hros.html itself — rather than a list retyped here, because a list retyped here would agree with
 *     a widened port by construction.
 */
const HROS = readFileSync(join(REPO, 'hros.html'), 'utf8');

/**
 * The `profile:{…}` object literal inside `hrEmpProfileSave()`, straight out of hros.html.
 *
 * `//` comment lines are dropped first: the v159 note inside the literal (hros.html:3396-3398) contains
 * `v159:` and `bankCode:'' and`, which the key scan below would otherwise read as fields.
 */
function legacyProfileSource(): string {
  const at = HROS.indexOf('async function hrEmpProfileSave()');
  expect(at).toBeGreaterThan(0);
  const body = HROS.slice(at, HROS.indexOf("\n}", at));
  const open = body.indexOf('profile:{');
  expect(open).toBeGreaterThan(0);
  return body.slice(open, body.indexOf('}});', open)).replace(/^\s*\/\/.*$/gm, '');
}

/** Every `key:` at the top level of that literal, in source order. */
function legacyProfileKeys(): string[] {
  return [...legacyProfileSource().matchAll(/(?:^|[,{\s])([A-Za-z][A-Za-z0-9_]*)\s*:/g)]
    .map((m) => m[1])
    .filter((k) => k !== 'profile');
}

/**
 * The reader `profileBody()` is handed. Each id echoes its own name, so a field wired to the WRONG
 * control shows up as the wrong marker rather than as an equal-looking empty string. `pf_acct` is real
 * digits because the legacy refuses a non-numeric account number outright (hros.html:3386).
 */
const v = (id: string) => (id === 'pf_acct' ? '162011223344' : `<${id}>`);

describe('the save is the employee’s own record, and nothing wider', () => {
  it('sends exactly the fields hrEmpProfileSave() sends — read out of hros.html, not retyped', () => {
    const got = profileBody(v, false, true);
    expect('profile' in got).toBe(true);
    const keys = Object.keys((got as { profile: Record<string, unknown> }).profile).sort();
    expect(keys).toEqual([...legacyProfileKeys()].sort());
  });

  it('PROFILE_KEYS is the legacy list minus the conditional bankCode, so the doc cannot drift', () => {
    expect([...PROFILE_KEYS].sort()).toEqual(legacyProfileKeys().filter((k) => k !== 'bankCode').sort());
  });

  it('carries no employee id — the server resolves the target from the token', () => {
    const got = profileBody(v, false, true) as { api: string; profile: Record<string, unknown> };
    expect(got.api).toBe('hr_my_profile_save');
    expect(Object.keys(got)).toEqual(['api', 'profile']);
    for (const k of Object.keys(got.profile)) expect(k.toLowerCase()).not.toMatch(/(^|_)id$|employee/);
  });

  it('lets through no HR-managed field — a widened port is a privilege escalation', () => {
    const { profile } = profileBody(v, false, true) as { profile: Record<string, unknown> };
    // The Employment card's eight fields plus the pay ones. Every name here is a real hr_employees
    // column that hr_emp_save writes and hr_my_profile_save must not.
    for (const k of ['name', 'empNo', 'emp_no', 'dept', 'position', 'employmentType', 'employment_type',
      'joinDate', 'email', 'basicSalary', 'basic_salary', 'payType', 'fixedAllowance', 'status',
      'managerId', 'claimRole', 'userId', 'role', 'tenant', 'tenantId', 'signature']) {
      expect(profile).not.toHaveProperty(k);
    }
  });

  it('omits bankCode until the bank list has loaded — v159, the silently nulled bank_code', () => {
    // hros.html:3398 and hr.ts:1384: an ABSENT key means "unchanged"; `bankCode:''` means "clear it".
    // The form paints before hr_banks_list resolves, so sending the placeholder wipes a bank the
    // employee never touched — invisible, because the bank NAME survives, until a payment file goes out
    // with a blank SWIFT/BIC.
    expect(profileBody(v, false, false)).not.toHaveProperty('profile.bankCode');
    expect(profileBody(v, false, true)).toHaveProperty('profile.bankCode', '<pf_bank>');
  });

  it('strips the account number to digits, and refuses one that has none', () => {
    const read = (id: string) => (id === 'pf_acct' ? '1620-1122 3344' : '');
    expect(profileBody(read, false, true)).toHaveProperty('profile.bankAccount', '162011223344');
    expect(profileBody((id) => (id === 'pf_acct' ? 'my maybank one' : ''), false, true))
      .toEqual({ error: 'Account number should be digits' });
  });

  it('sends the spouse tick as a boolean, which is what drives the PCB relief', () => {
    expect(profileBody(v, true, true)).toHaveProperty('profile.spouseWorking', true);
    expect(profileBody(v, false, true)).toHaveProperty('profile.spouseWorking', false);
  });
});

/**
 * ── EMPLOYEE MODE IS A PERMISSION BOUNDARY ──────────────────────────────────────────────────────────
 *
 * This screen is one of the three ordinary staff see. The component is handed the WHOLE `hr_employees`
 * row, and the legacy screen shows eight of its fields as read-only text and its pay fields not at all.
 * These assert the withheld direction, so a future change that exposes something fails HERE rather than
 * on someone's payslip.
 */
describe('nothing the legacy screen withheld becomes visible', () => {
  const html = renderToStaticMarkup(screen());

  it('shows no pay figure, though the record it is handed carries them', () => {
    // The fixture employee earns 5200 basic + 400 allowance. Guard the guard: assert the record really
    // does carry them, or this passes because the numbers were never there to leak.
    expect(ME.basic_salary).toBe(5200);
    expect(ME.fixed_allowance).toBe(400);
    expect(html).not.toContain('5200');
    expect(html).not.toContain('5,200');
    expect(html).not.toContain('400');
    // The word "salary" appears exactly once, in the sentence under the Save button — no figure with it.
    expect(html.toLowerCase().match(/salary/g)).toEqual(['salary']);
    expect(html).toContain('used for salary payment');
  });

  it('makes the HR-managed Employment card read-only — no input, select or textarea in it', () => {
    const card = html.slice(html.indexOf('HR-managed'), html.indexOf('My details'));
    expect(card).toContain('AHMAD BIN ISMAIL');           // it really is the card
    expect(card).not.toMatch(/<(input|select|textarea|button)\b/);
  });

  it('offers no admin action — no other employee, and no approve/pay/delete control', () => {
    // hr_rc_config also hands the route every colleague. None of them belongs on a self-service screen.
    for (const other of FIXTURES.hr_rc_config.employees as { name: string }[]) {
      if (other.name !== ME.name) expect(html).not.toContain(other.name);
    }
    expect(html).not.toMatch(/hrEmpSave|hrEditEmp|hrDecide|hrApv|hrFinalise|hrRCPay/);
  });

  it('writes no id, holder-of-record or session value into a URL or an exported string', () => {
    // Bank and IC data is on this form. Nothing may echo it into an href, an image or a data: URI.
    expect(html).not.toMatch(/href="[^"]*(?:900314|162011223344)/);
    expect(html).not.toMatch(/src="[^"]*(?:900314|162011223344)/);
  });
});

/**
 * ── BRANCHES THE GOLDEN DOES NOT HOLD ───────────────────────────────────────────────────────────────
 * A golden is one state of one screen. These three are real states of this one that it never captured,
 * so they are checked here instead of being left to the diff.
 */
describe('the states no golden reached', () => {
  it('an unlinked login gets the legacy sentence, not a blank screen', () => {
    const html = renderToStaticMarkup(screen({ employee: null }));
    expect(html).toContain('ask HR to enable your access');
    expect(html).not.toContain('pf_save');
  });

  it('a saved signature shows it, with Re-sign and Remove wired', () => {
    const signed = { ...ME, signature: 'data:image/png;base64,AAA', signature_updated_at: '2026-07-17T06:30:00.000Z' };
    const html = renderToStaticMarkup(screen({ employee: signed }));
    expect(html).toContain('alt="Your signature"');
    expect(html).toContain('Re-sign');
    expect(html).toContain('Remove');
    // hrDT() is UTC+8 arithmetic, not a zone lookup, so this does not depend on the machine's timezone.
    expect(html).toContain('Saved 17 Jul 2026, 2:30pm');
    expect(html).not.toContain('No signature saved');
  });

  it('the bank picker holds only its placeholder while the list is loading', () => {
    const html = renderToStaticMarkup(screen({ banks: null }));
    expect(html).toContain('— select bank —');
    expect(html).not.toContain('Malayan Banking');
  });
});

describe('the comparison still bites', () => {
  // Relaxations are only defensible if they cannot absorb a real change. These render the screen wrong
  // on purpose and require the comparison to notice each one. Every defect named here is one that would
  // actually hurt the employee whose screen this is.
  const want = relax(GOLDEN);
  const wrong = (over: Partial<Parameters<typeof HrProfile>[0]>) => rendered(over);

  it('catches a changed IC number — the number every statutory file is keyed on', () => {
    expect(wrong({ employee: { ...ME, ic_no: '900314-10-5534' } })).not.toBe(want);
  });

  it('catches a changed account number — a digit here is someone else’s salary', () => {
    expect(wrong({ employee: { ...ME, bank_account: '162011223345' } })).not.toBe(want);
  });

  it('catches the bank selection moving, which R5 must not absorb', () => {
    // R5 only forgives a mark on the FIRST option that no other option carries. Moving it to CIMB puts
    // it on the third, so it survives on one side and not the other.
    expect(wrong({ employee: { ...ME, bank_code: 'CIMB' } })).not.toBe(want);
  });

  it('catches a dropped bank from the picker — a bank nobody can select is a claim nobody gets paid', () => {
    expect(wrong({ banks: BANKS.filter((b) => b.code !== 'CIMB') })).not.toBe(want);
  });

  it('catches marital status moving, which changes the monthly PCB', () => {
    expect(wrong({ employee: { ...ME, marital_status: 'single' } })).not.toBe(want);
  });

  it('catches a changed child count, which changes the monthly PCB', () => {
    expect(wrong({ employee: { ...ME, num_children: 3 } })).not.toBe(want);
  });

  it('catches the spouse tick appearing — a bare boolean attribute R4 spells the same either way', () => {
    expect(wrong({ employee: { ...ME, spouse_working: true } })).not.toBe(want);
  });

  it('catches a gender that stopped being blank — the first option’s mark moving off it', () => {
    expect(wrong({ employee: { ...ME, gender: 'Female' } })).not.toBe(want);
  });

  it('catches a dropped read-only field on the HR-managed card', () => {
    expect(wrong({ employee: { ...ME, position: '' } })).not.toBe(want);
  });

  it('catches a changed value in the page-head chrome', () => {
    expect(wrong({ companyName: 'SKINDAE SDN BHD' })).not.toBe(want);
  });

  it('catches the signature panel flipping to its saved branch', () => {
    expect(wrong({ employee: { ...ME, signature: 'data:image/png;base64,AAA' } })).not.toBe(want);
  });

  it('catches a mis-wired Save button, which the string diff cannot see at all', () => {
    // The whole reason for LEGACY_TO_PROP: swap Save's handler for the signature one and the markup is
    // byte-identical under R1. Assert both — the diff passes, the handler check fails.
    const swapped = (
      <HrProfile
        employee={ME}
        companyName={COMPANY_NAME}
        banks={BANKS}
        onSave={noop}
        onSigStart={noop}
        onSigClearSaved={noop}
        onPwModal={noop}
      />
    );
    expect(relax(renderToStaticMarkup(swapped))).toBe(want);
    // Feed the recorder a Save that reports itself as the signature button: the sequence goes
    // ['sigStart','sigStart','pwModal'] where the golden says ['save','sigStart','pwModal'].
    const calls: string[] = [];
    const got = reactHandlers(screen({
      onSave: (() => calls.push('sigStart')) as never,        // the mis-wire
      onSigStart: (() => calls.push('sigStart')) as never,
      onSigClearSaved: (() => calls.push('sigClearSaved')) as never,
      onPwModal: (() => calls.push('pwModal')) as never,
    }));
    got.forEach((h) => h.invoke());
    const expected = goldenHandlers(GOLDEN).map((h) => LEGACY_TO_PROP[h.raw.replace(/\(.*$/, '')]);
    expect(calls).not.toEqual(expected);
  });
});
