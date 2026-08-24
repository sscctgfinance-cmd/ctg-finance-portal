// HR OS · Reimbursement — the EMPLOYEE shape, and the route that decides which shape to render.
//
// Two halves, and the second is the one that matters most here.
//
// 1. `tests/golden/hr.expenses.emp.html` — `hrRC()` / `hrRCList()` with `RC.me.isAdmin === false`
//    (hros.html:1785, :1821). Two tabs instead of four, and four DIFFERENT scopes. A screen-level
//    parity test on the admin golden cannot see any of that, which is `hr.leave`'s F2 exactly.
//
// 2. A screen-level parity test cannot see a missing or mis-ordered ROUTE either, so the branch is
//    pinned by SOURCE — `web/tests/hr-emp-leave.parity.test.tsx`'s rule. Two real defects lived in this
//    route until v225 and BOTH are invisible to every golden:
//      • `hr_companies` (hr.ts:815 — `hrCanView`, i.e. admin / hr_admin / viewer) was awaited FIRST, so
//        a plain `employee` got `⚠️ unauthorized` as the whole page and could not even see their own
//        claims. `finance.users`' finding: a gate downstream of the load is not a gate.
//      • the company was kept by NAME, so every call went out with no `tenant`, and `hr_rc_list`'s admin
//        branch (hr.ts:2549) answers `ok` with an EMPTY list for a blank tenant — `hr.yearend`'s
//        `hr_bootstrap` finding, silent in exactly the same way.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { COMPANIES, FIXTURES, HR_TENANT } from '../../tests/render_fixtures';
import HrExpenses, { type RcClaim, type RcMe, type RcScope } from '../src/hr-expenses';
import { goldenSection, relax, REPO } from './parity';

const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;
const GOLDEN = goldenSection('hr.expenses.emp', 'hr');
const CLAIMS = (FIXTURES.hr_rc_list as { claims: RcClaim[] }).claims;

/** `hr_rc_config`'s `me` for a plain employee — hr.ts:1921 (`rcMe`). */
const EMP: RcMe = { isAdmin: false, is_manager: false, roles: [] };

const noop = () => {};

function screen(over: Partial<Parameters<typeof HrExpenses>[0]> = {}) {
  return (
    <HrExpenses
      claims={CLAIMS} me={EMP} companyName={COMPANY_NAME} page="list" scope="pending" sel={{}}
      onNav={noop} onScope={noop} onOpen={noop} onSelAll={noop} onSelToggle={noop} onSelClear={noop}
      onExportAcct={noop} onExportCsv={noop} onExportBank={noop} onBulkApprove={noop} onBulkReject={noop}
      onBulkInfo={noop} onBulkPay={noop}
      {...over}
    />
  );
}

describe('HR Reimbursement in employee mode — React vs the legacy golden', () => {
  it('renders the same document as hrRC() does for a non-admin', () => {
    expect(relax(renderToStaticMarkup(screen()))).toBe(relax(GOLDEN));
  });

  it('offers two tabs, not four', () => {
    const html = renderToStaticMarkup(screen());
    expect(html).toContain('📋 Claims');
    expect(html).toContain('➕ Submit');
    expect(html).not.toContain('📊 Dashboard');
    expect(html).not.toContain('⚙ Settings');
    // …and the admin shape still has all four, so this is not passing because the tab bar is broken.
    const admin = renderToStaticMarkup(screen({ me: { isAdmin: true } }));
    expect(admin).toContain('📊 Dashboard');
    expect(admin).toContain('⚙ Settings');
  });

  it('offers the employee scopes, not the admin ones', () => {
    const html = renderToStaticMarkup(screen());
    expect(html).toContain('My claims');
    expect(html).toContain('🔔 Approvals');
    // hros.html:1821 — an employee's first scope is "My claims"; the admin's is "Pending".
    expect(html).not.toMatch(/>Pending( \(\d+\))?</);
    expect(renderToStaticMarkup(screen({ me: { isAdmin: true } }))).toMatch(/>Pending/);
  });

  it('offers no accounting export and no bulk payment controls', () => {
    // `canFinance` is `isAdmin || roles.includes('finance')` (hros.html:1824), so a plain employee gets
    // neither the 📒 Accounting CSV button nor the approved-claims payment bar.
    const html = renderToStaticMarkup(screen());
    expect(html).not.toContain('Accounting CSV');
    expect(html).not.toContain('🏦 Bank file');
    expect(renderToStaticMarkup(screen({ me: EMP, scope: 'approved' as RcScope }))).not.toContain('🏦 Bank file');
  });

  it('shows the selection column only to an employee who can actually approve', () => {
    // A line manager IS a non-admin who approves (hros.html:1823), so the tick column has to appear for
    // them on the Approvals scope — and must not for everyone else.
    expect(renderToStaticMarkup(screen())).not.toContain('type="checkbox"');
    expect(renderToStaticMarkup(screen({ me: { isAdmin: false, is_manager: true, roles: [] } }))).toContain('type="checkbox"');
  });
});

// ── The route ──────────────────────────────────────────────────────────────────────────────────────

/** Comments blanked first — this file's own header quotes the action names while explaining the bug,
 *  which is `tests/forwarding_page_test.ts`'s lesson. */
const ROUTE = readFileSync(join(REPO, 'web', 'app', 'hr', 'expenses', 'page.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');

describe('the route decides the shape before it loads anything an employee may not have', () => {
  const load = ROUTE.slice(ROUTE.indexOf('const load = useCallback'), ROUTE.indexOf('useEffect(() => {'));

  it('found the loader', () => {
    expect(load).toContain("api: 'hr_rc_config'");
  });

  it('asks for hr_rc_config BEFORE hr_companies', () => {
    expect(load.indexOf("api: 'hr_rc_config'")).toBeLessThan(load.indexOf("api: 'hr_companies'"));
  });

  it('asks for hr_companies only inside the isAdmin branch', () => {
    const branch = load.slice(load.indexOf('if (who.isAdmin)'), load.indexOf('} else {'));
    expect(branch).toContain("api: 'hr_companies'");
    // …and nowhere else in the loader.
    expect(load.split("api: 'hr_companies'")).toHaveLength(2);
  });

  it('mounts nothing before the config answers — no other action is called first', () => {
    const before = load.slice(0, load.indexOf("api: 'hr_rc_config'"));
    expect(before).not.toMatch(/api:\s*'/);
  });
});

describe('every company-scoped call carries a tenant', () => {
  it('hr_rc_list is sent with the tenant, and the tenant is an id and not a name', () => {
    // Sending the NAME satisfies a naive "does it carry tenant" check and matches no row — hr.yearend.
    const list = ROUTE.slice(ROUTE.indexOf('const loadList = useCallback'), ROUTE.indexOf('const load = useCallback'));
    expect(list).toMatch(/api:\s*'hr_rc_list',\s*tenant,/);
    expect(ROUTE).toMatch(/const tenantId = company && company\.tenant_id \? company\.tenant_id : null;/);
  });

  it('hr_rc_save and hr_rc_submit carry it too', () => {
    expect(ROUTE).toMatch(/api:\s*'hr_rc_save',\s*tenant:\s*tenantId/);
    expect(ROUTE).toMatch(/api:\s*'hr_rc_submit',\s*tenant:\s*tenantId/);
  });

  it('the company object keeps the id, not only the name', () => {
    expect(ROUTE).toMatch(/interface Company \{ tenant_id: string; tenant_name: string \}/);
  });
});

describe('the submit button cannot be double-submitted', () => {
  const save = ROUTE.slice(ROUTE.indexOf('const onSave = useCallback'), ROUTE.indexOf('// ── the scanner'));

  it('returns early while a save is already in flight, reading a REF and not state', () => {
    // `hrRCSave()` opens with `if(RC._saving) return;` (hros.html:2083) — a plain mutable flag, set
    // SYNCHRONOUSLY. This was written with `useState` first and it did not hold: five taps in one tick
    // all read the same `false` out of one closure, and the browser recorded five `hr_rc_save` and five
    // `hr_rc_submit` calls. `disabled={saving}` does not help either — the attribute lands on the NEXT
    // render, which is after the burst. A `useState` guard here is a duplicate claim, so the shape is
    // pinned and not just its existence.
    expect(save).toMatch(/if \(savingRef\.current\) return;/);
    expect(save).not.toMatch(/if \(saving\) return;/);
    expect(save.indexOf('if (savingRef.current) return;')).toBeLessThan(save.indexOf("api: 'hr_rc_save'"));
  });

  it('sets the ref before the await and releases it in a finally', () => {
    expect(save.indexOf('savingRef.current = true;')).toBeLessThan(save.indexOf("api: 'hr_rc_save'"));
    expect(save).toMatch(/finally \{\s*savingRef\.current = false;\s*setSaving\(false\);\s*\}/);
  });

  it('the flag also reaches the buttons, so the operator sees it', () => {
    // Belt as well as braces: the ref refuses, the state greys the control out on the next render.
    expect(ROUTE).toMatch(/saving=\{saving\}/);
    expect(ROUTE).toMatch(/const savingRef = useRef\(false\);/);
  });

  it('every detail write goes through the same one-at-a-time guard', () => {
    const run = ROUTE.slice(ROUTE.indexOf('const detailRun = useCallback'), ROUTE.indexOf('const onDecide = useCallback'));
    expect(run).toMatch(/if \(detailBusyRef\.current\) return;/);
    expect(run).toMatch(/finally \{\s*detailBusyRef\.current = false;\s*setDetailBusy\(null\);\s*\}/);
    // The PDF build is the one write-ish action that does NOT go through detailRun (it posts nothing),
    // so it carries its own copy of the same guard — and the same ref, so a Voucher press cannot start
    // a second merge while the first is fetching every receipt.
    const pdf = ROUTE.slice(ROUTE.indexOf('const onFormAndReceipts = useCallback'));
    expect(pdf).toMatch(/if \(detailBusyRef\.current\) return;/);
    expect(pdf).toMatch(/finally \{\s*detailBusyRef\.current = false;\s*setDetailBusy\(null\);\s*\}/);
    // Nothing on this route may go back to the state flag for the decision.
    expect(ROUTE).not.toMatch(/if \(detailBusy\) return;/);
  });

  it('the modal that builds a scanned PDF carries the same synchronous guard', () => {
    const modal = readFileSync(join(REPO, 'web', 'app', 'hr', 'expenses', 'scan-modal.tsx'), 'utf8');
    expect(modal).toMatch(/if \(busyRef\.current\) return;/);
    expect(modal).not.toMatch(/if \(busy\) return;/);
  });

  it('a receipt that failed to upload stops the submit', () => {
    // hros.html:2124 — "do not submit a claim whose receipt did not land". Submitting anyway is a claim
    // that then fails validation with "A receipt is required", pointing at the wrong thing entirely.
    expect(save).toMatch(/if \(failed\.length\) \{[\s\S]*?return;/);
    expect(save.indexOf('if (failed.length)')).toBeLessThan(save.indexOf("api: 'hr_rc_submit'"));
  });
});

// ── v226: this block USED to pin what still handed off. Nothing does. ─────────────────────────────
//
// It read "what the route still hands off, and what it no longer does" and asserted the presence of
// `goLegacy(pg)`, `onGlEdit={() => goLegacy(…)}`, `onPostXero={() => goLegacy(…)}` and a banner
// sentence naming five legacy controls. All five were migrated, so those four assertions could not
// survive the change — they were the REGISTRY of what was left, the way `SURFACES.length` is, not a
// statement about behaviour. Inverted here rather than deleted, which is strictly stronger: the route
// is now required to contain NO handoff at all, so a future half-migration fails here.
describe('nothing on this screen hands off any more', () => {
  it('every tab of hrRC() is decided in React, and the fall-through goes nowhere', () => {
    const nav = ROUTE.slice(ROUTE.indexOf('onNav={(pg) => {'), ROUTE.indexOf('onScope={onScope}'));
    for (const pg of ['list', 'form', 'dashboard', 'settings']) expect(nav).toContain(`if (pg === '${pg}')`);
    expect(ROUTE).toMatch(/onOpen=\{\(id\) => void openDetail\(id\)\}/);
  });

  it('✕ Close goes back to the list, which is what hrRCNav(‘list’) does', () => {
    expect(ROUTE).toMatch(/onClose=\{\(\) => \{ setPage\('list'\); void refreshList\(scope\); \}\}/);
  });

  it('the detail’s two admin controls call handlers, not the legacy app', () => {
    expect(ROUTE).toMatch(/onGlEdit=\{onGlEdit\}/);
    expect(ROUTE).toMatch(/onPostXero=\{onPostXero\}/);
    expect(ROUTE).toMatch(/onExportAcct=\{onExportAcct\}/);
  });

  it('the route contains no route back to hros.html except the sign-in and the notice', () => {
    // Comments blanked first — this file's own header QUOTES `goLegacy` while explaining that it is
    // gone, which is tests/forwarding_page_test.ts's lesson.
    const code = ROUTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toContain('goLegacy');
    expect(code).not.toContain('window.location.href');
    // `legacyUrl('hros.html')` survives twice and only twice: the not-signed-in panel's "Sign in to
    // HR OS" link, and the notice's own link to the screen this one mirrors. Neither is a handoff of a
    // control on this screen.
    expect([...code.matchAll(/legacyUrl\(/g)].length).toBe(2);
  });

  it('the on-page notice names exactly what is left on the legacy screen — nothing', () => {
    // Criterion 5. The banner is the only place a user is told, so it has to stay honest as the
    // migration moves. v225's version listed five things; v226 migrated all five.
    const banner = ROUTE.slice(ROUTE.indexOf('function Banner('));
    expect(banner).toContain('Every part of it is here');
    expect(banner).toContain('Nothing on this screen sends you back to the legacy app');
    // …and it must not still name one of the five as elsewhere. The whole point of the sentence is
    // that it shrank; a stale list is the specific failure this project has hit repeatedly.
    expect(banner).not.toContain('Still on the legacy screen');
    for (const gone of ['📊 Dashboard,', '⚙ Settings,', '📒 Accounting CSV export']) {
      expect(banner).not.toContain(gone);
    }
  });
});
