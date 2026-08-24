// The credentials panel — `hrShowCreds()`, hros.html:2782.
//
// No golden holds it: it renders only after a bulk create, and every surface was captured with none.
// So the pure half is driven and the route half is pinned by SOURCE, the treatment
// finance-o2o/hr-emp-leave use for a route with no output to assert through.
//
// What this exists to stop: `setCreds(r.created)` alone. Create 40 logins, get 35, and the 5 the server
// SKIPPED — no email, already enabled, a database error — vanish with nothing on screen saying so.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { credsText } from '../src/hr-employees';

const ROUTE = readFileSync(join(__dirname, '../app/hr/employees/page.tsx'), 'utf8')
  // Comments first — this file's own header quotes `setCreds(r.created)` while explaining the bug.
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('the bulk create keeps the people it could not create', () => {
  it('the route carries `skipped` into the panel, not just `created`', () => {
    const call = /setCreds\(\{[^}]*r\.created[^}]*\}\)/.exec(ROUTE);
    expect(call, 'the bulk handler must set the panel from r.created').not.toBeNull();
    expect(call![0]).toMatch(/skipped:\s*r\.skipped/);
  });

  it('the panel renders the skipped list, and only when there is one', () => {
    expect(ROUTE).toMatch(/skipped\.length\s*\?/);
    expect(ROUTE).toMatch(/Skipped \(\{skipped\.length\}\)/);
    // The REASON is the whole value of the list — "5 skipped" without it is the toast we already had.
    expect(ROUTE).toMatch(/sk\.reason/);
  });

  it('the three conveniences hros.html:2793 offers are all here', () => {
    expect(ROUTE).toMatch(/📋 Copy all/);
    expect(ROUTE).toMatch(/🖨 Print/);
    expect(ROUTE).toMatch(/window\.print\(\)/);
    // The sign-in URL sentence — hros.html:2790.
    expect(ROUTE).toMatch(/They sign in at/);
  });
});

describe('credsText — the block 📋 Copy all puts on the clipboard', () => {
  const ROWS = [
    { name: 'Aisyah Rahman', email: 'aisyah@ctg.my', temp_password: 'Tmp-7f2a' },
    { name: 'Lim Wei', email: 'lim@ctg.my', temp_password: 'Tmp-9c1b' },
  ];

  it('is the legacy layout: the URL, a blank line, then tab-separated rows', () => {
    expect(credsText('https://x.test/hros.html', ROWS)).toBe(
      'HR OS login: https://x.test/hros.html\n\n'
      + 'Aisyah Rahman\taisyah@ctg.my\tTmp-7f2a\n'
      + 'Lim Wei\tlim@ctg.my\tTmp-9c1b',
    );
  });

  it('separates with TABS, so it pastes into a mail client as three columns', () => {
    // A comma or a space here silently turns the block an admin pastes into one unreadable line.
    expect(credsText('u', ROWS).split('\n')[2].split('\t')).toHaveLength(3);
  });

  it('a missing field is an empty cell, never `undefined` in somebody’s email', () => {
    expect(credsText('u', [{ email: 'a@b.c' }])).toBe('HR OS login: u\n\n\ta@b.c\t');
  });
});
