// HR OS · Access & Roles — the React screen against the legacy screen's committed golden.
//
// This is the pilot's actual claim. `tests/golden/hr.access.html` was captured from `hrAccessRender()`
// (hros.html:1576) by the 40-surface harness; nothing here regenerates or edits it, and nothing here
// touches tests/render_surfaces.ts. The React component is rendered with `renderToStaticMarkup` from the
// SAME fixture the golden was captured from — tests/render_fixtures.ts, imported directly, so there is
// no second copy of the data to drift — normalised by the harness's own normalise(), relaxed by the
// documented layer in ./parity.ts, and compared.
//
// A screen is "migrated" when its golden matches. Not when it looks right.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrAccess, { type HrUsersList } from '../src/hr-access';
import { goldenSection, relax } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `hrCompanyName()` (hros.html:4445) resolves the chip in the page head to the selected company. */
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;

/**
 * The `#hr` element is what `hrRender()` writes the page head and the screen body into (hros.html:1554).
 * `#hr_nav` — the other section in the same golden — is `hrSidebar()`, the app-wide nav. That is chrome
 * for all 18 HR views, not part of this screen, and report.md §3.5 puts it explicitly outside a
 * screen-by-screen strangler: keep it in the legacy files and re-implement it once in the Next shell.
 */
const GOLDEN = goldenSection('hr.access', 'hr');

/** `HRA`'s defaults at first paint — hros.html:1558. The golden is that state. */
const INVITE = { role: 'employee', emp: '', email: '', name: '' };

const noop = () => {};

function screen(spies: Partial<Parameters<typeof HrAccess>[0]> = {}) {
  return (
    <HrAccess
      data={FIXTURES.hr_users_list as HrUsersList}
      companyName={COMPANY_NAME}
      invite={INVITE}
      onRoleChange={noop}
      onInviteRoleChange={noop}
      onPickEmployee={noop}
      onInvite={noop}
      {...spies}
    />
  );
}

const rendered = () => relax(renderToStaticMarkup(screen()));

describe('HR Access — React vs the legacy golden', () => {
  it('renders the same document as hrAccessRender() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    // R1 drops `on*=` from the string comparison. This is the check that puts the arguments back.
    const want = goldenHandlers(GOLDEN);
    const calls: { attr: string; args: string[] }[] = [];
    const record = (attr: string) => (...args: unknown[]) =>
      calls.push({ attr, args: args.filter((a): a is string => typeof a === 'string' && a !== STUB_VALUE) });

    const tree = screen({
      onRoleChange: record('role') as never,
      onInviteRoleChange: record('inviteRole') as never,
      onPickEmployee: record('pickEmployee') as never,
      onInvite: record('invite') as never,
    });

    const got = reactHandlers(tree);
    expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));

    got.forEach((h) => h.invoke());
    expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));

    // Guard the guard: if the golden ever stops carrying handlers, the two `toEqual`s above pass
    // vacuously and R1 becomes the blind strip it is not allowed to be.
    expect(want.length).toBeGreaterThan(0);
    expect(want.some((h) => h.args.length > 0)).toBe(true);
  });
});

describe('the relaxation layer still bites', () => {
  // Relaxations are only defensible if they cannot absorb a real change. These render the component
  // wrong on purpose, four ways, and require the parity comparison to notice each one. Without this, a
  // relaxation that quietly widened — say `relax()` growing a rule that dropped whole attributes — would
  // leave a green suite and a screen that no longer matches.
  const wrong = (data: HrUsersList, name = COMPANY_NAME) =>
    relax(renderToStaticMarkup(
      <HrAccess data={data} companyName={name} invite={INVITE}
        onRoleChange={noop} onInviteRoleChange={noop} onPickEmployee={noop} onInvite={noop} />,
    ));

  const real = FIXTURES.hr_users_list as HrUsersList;
  const want = relax(GOLDEN);

  it('catches a dropped row', () => {
    expect(wrong({ ...real, users: real.users!.slice(0, 2) })).not.toBe(want);
  });

  it('catches a changed label', () => {
    expect(wrong({ ...real, users: real.users!.map((u) => ({ ...u, name: u.name + '!' })) })).not.toBe(want);
  });

  it('catches a changed role, which is only visible as a moved `selected`', () => {
    expect(wrong({ ...real, users: real.users!.map((u) => (u.self ? u : { ...u, role: 'approver' })) })).not.toBe(want);
  });

  it('catches a changed value in the page-head chrome', () => {
    expect(wrong(real, 'SKINDAE SDN BHD')).not.toBe(want);
  });
});
