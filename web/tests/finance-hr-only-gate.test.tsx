// The "HR OS access only" gate — the C6 gap. No golden holds it (chrome, never captured, like the
// shell), so this pins the predicate against app.html's own `HR_ONLY_ROLES_FE` and asserts both
// directions plus the rendered panel's load-bearing parts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import HrOnlyGate, { isHrOnly } from '../src/finance-hr-only-gate';
import { REPO } from './parity';

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');

describe('finance HR-only gate', () => {
  it('the gated set is exactly app.html HR_ONLY_ROLES_FE, both directions', () => {
    expect(APP).toContain("HR_ONLY_ROLES_FE=['employee','viewer','hr_admin']");
    for (const r of ['employee', 'viewer', 'hr_admin']) expect(isHrOnly(r)).toBe(true);
    // Everyone with real Finance access is NOT gated — the withheld direction.
    for (const r of ['admin', 'superadmin', 'manager', 'approver', undefined, '']) expect(isHrOnly(r)).toBe(false);
  });

  it('renders the branded refusal, the HR OS link and a sign-out', () => {
    let signedOut = false;
    const html = renderToStaticMarkup(<HrOnlyGate name="Aisha" onSignOut={() => { signedOut = true; }} />);
    expect(html).toContain('HR OS access only');
    expect(html).toContain('Aisha');            // greeted by name
    expect(html).toContain('hros.html');        // the jump to HR OS
    expect(html).toContain('Go to HR OS');
    expect(html).toContain('Sign out');
    // A missing name falls back to "there", exactly as app.html:2657 does.
    expect(renderToStaticMarkup(<HrOnlyGate onSignOut={() => {}} />)).toContain('Hi there');
    expect(signedOut).toBe(false);
  });
});
