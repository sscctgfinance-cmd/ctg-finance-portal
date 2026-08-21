// Finance OS · Approvals — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.approvals.html` was captured from `renderApprovals()` (app.html:2358) by the
// 40-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts, tests/parity.ts or tests/handlers.ts. The component is rendered with
// `renderToStaticMarkup` from the SAME fixture the golden was captured from — tests/render_fixtures.ts,
// imported directly — normalised by the harness's own normalise(), relaxed by the documented layer in
// ./parity.ts, and compared.
//
// NO SEVENTH RELAXATION, and none was needed. This is the twentieth screen to reuse the six unchanged.
// The markup is plain: no named or numeric character reference, no duplicate attribute, no unescaped
// `&`. R6 does fire, on the em-dashes' neighbours — nothing here — and the currency figures go through
// `toLocaleString('en-MY')` under Node exactly as they did under Deno, which `catches one sen` proves
// by moving one.
//
// ── ASYNC: WHAT THE GOLDEN ACTUALLY HOLDS, CHECKED RATHER THAN ASSUMED ─────────────────────────────
// `renderApprovals()` is `async` and writes `#approvals` TWICE: `spin('approvals')` first, then the
// result. CLAUDE.md's `finance.qinv` note is the warning to read here — a golden can hold an
// INTERMEDIATE state — so the renderer was read to the end. It does nothing after its final
// `innerHTML=`: no `appendChild`, no `.value=`, no `setTimeout`, no follow-up fetch. The harness records
// writes by element id and the last one wins, so the golden holds the LOADED table and the skeleton is
// simply outside it. The `states no golden holds` block below pins the skeleton and the three empty
// branches by assertion instead.
//
// ── THIS SCREEN APPROVES THINGS ────────────────────────────────────────────────────────────────────
// Every row is a company, a vendor and a figure, and they look alike. A row bound to the wrong
// `invoice_id` approves — or VOIDS — a different supplier's bill, in a real Xero ledger, and nothing on
// screen looks wrong. R1 strips `on*=` from the diff, so that defect is invisible above and is caught
// only by handler parity, which is why this file's mis-wire cases are the ones that matter most.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES } from '../../tests/render_fixtures';
import FinanceApprovals, {
  approvalsReachable, decideBody, visibleBills, type Bill,
} from '../src/finance-approvals';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `#approvals` is the tab div `render('approvals')` writes into — the golden's ONLY section. */
const GOLDEN = goldenSection('finance.approvals', 'approvals');

const BILLS = (FIXTURES.pending as { bills: Bill[] }).bills;

const noop = () => {};

type Props = Parameters<typeof FinanceApprovals>[0];

function screen(over: Partial<Props> = {}) {
  // The state the harness captured: `render('approvals')` resolves `{api:'pending'}` and the company
  // bar is on "— All Companies —", so `curCo()` is '' and all three bills are shown.
  return <FinanceApprovals bills={BILLS} filter="" error={null} onDecide={noop} {...over} />;
}

const rendered = (over: Partial<Props> = {}) => relax(renderToStaticMarkup(screen(over)));

describe('Finance Approvals — React vs the legacy golden', () => {
  it('renders the same document as renderApprovals() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * The only defence this screen has against a mis-bound row. `onclick="approve('…','inv-1','approve',0)"`
 * and `…'inv-2'…` are byte-identical once R1 has stripped them, and the two rows differ on screen only
 * by a vendor name that an operator scanning six near-identical rows will not cross-check. A reject
 * applied to the wrong row VOIDS a bill in Xero and cannot be undone.
 *
 * ONE local widening, already established on seven screens and COPIED here rather than pushed into the
 * shared ./handlers.ts, which sibling migrations share: `identArgs()`. `goldenHandlers()` collects
 * QUOTED literals only, and every row handler here ends in a BARE INTEGER (`…,'approve',0)`). The tenant
 * and invoice are quoted, so quoted-only extraction would not be fully vacuous — but the row INDEX,
 * which is what `approve()` uses to find and fade the row, would go unchecked, and it is the argument
 * most likely to be off by one. This is the eighth screen to need it; CLAUDE.md already calls folding it
 * into `goldenHandlers()` the next single change to make there, once the in-flight migrations land.
 *
 * No `LEGACY_TO_PROP` here: every handler on this screen carries arguments, and the two kinds are told
 * apart by the `'approve'` / `'reject'` literal that `identArgs()` already collects — a screen whose
 * Reject button posted `approve` fails on the argument sequence alone. `propFor()` is kept anyway, in
 * its established shape, so an argument-free button added later cannot fall through silently.
 */
function identArgs(raw: string): string[] {
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|\b(-?\d+)\b/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

const LEGACY_TO_PROP: Record<string, string> = {
  approve: 'decide',
};

/** The prop a golden handler stands for: keyed on the whole raw text first, then on the function name. */
const propFor = (raw: string) => LEGACY_TO_PROP[raw] ?? LEGACY_TO_PROP[raw.replace(/\(.*$/, '')] ?? raw;

function assertHandlerParity(over: Partial<Props> = {}) {
  const want = goldenHandlers(GOLDEN);
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args
        .filter((a) => (typeof a === 'string' || typeof a === 'number') && a !== STUB_VALUE)
        .map(String),
    });
  misfire = record('misfire');

  const got = reactHandlers(screen({ onDecide: record('decide') as never, ...over }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => identArgs(h.raw)));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard: if the golden ever stops carrying handlers, or stops carrying their arguments, the
  // assertions above pass vacuously and R1 becomes the blind strip it is not allowed to be.
  expect(want.length).toBeGreaterThan(0);
  expect(want.every((h) => identArgs(h.raw).length > 0)).toBe(true);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

describe('the comparison still bites', () => {
  // This SCREEN's real risks: a figure that moves, a row that vanishes, a status pill that lies about
  // whether a bill is still a draft, and — above all — a button bound to the wrong bill.
  const want = relax(GOLDEN);
  const withRow = (i: number, over: Partial<Bill>) =>
    rendered({ bills: BILLS.map((b, k) => (k === i ? { ...b, ...over } : b)) });

  it('the golden really holds three decidable rows, each with both buttons', () => {
    // Guard the guard for this whole block: a golden that had captured the SKELETON instead of the
    // table would make every case below vacuous, which is exactly the finance.qinv trap.
    expect(GOLDEN).toContain('3 pending');
    expect(GOLDEN).not.toContain('sk-card');
    expect((GOLDEN.match(/<tr id="bill/g) || []).length).toBe(3);
    expect((GOLDEN.match(/,'approve',/g) || []).length).toBe(3);
    expect((GOLDEN.match(/,'reject',/g) || []).length).toBe(3);
  });

  it('catches one sen on one bill', () => {
    // The figure an operator approves against the vendor's invoice.
    expect(withRow(0, { total: (BILLS[0].total || 0) + 0.01 })).not.toBe(want);
  });

  it('CASTS: the amount is formatted to the sen, thousands separated — never a raw float', () => {
    // `18320.55` printed raw reads as RM 18320.55; a 640.3 reads as RM 640.3, which is not a money
    // figure at all. M() (app.html:1253) is the format; this proves it is applied to this column.
    const html = renderToStaticMarkup(screen());
    expect(html).toContain('<b>RM 18,320.55</b>');
    expect(html).toContain('<b>RM 640.30</b>');
    expect(html).not.toContain('>640.3<');
    expect(renderToStaticMarkup(screen({ bills: [{ ...BILLS[0], total: 1234567.891 }] }))).toContain('RM 1,234,567.89');
    expect(renderToStaticMarkup(screen({ bills: [{ ...BILLS[0], total: null }] }))).toContain('RM 0.00');
  });

  it('catches a row dropped out of the table', () => {
    // A pending bill that stops being listed is a supplier who does not get paid, and nobody is told.
    expect(rendered({ bills: BILLS.slice(0, 2) })).not.toBe(want);
  });

  it('catches the pending COUNT drifting from the rows actually listed', () => {
    // The pill is what an operator reconciles against; a count that outran the table would hide the
    // dropped row above.
    expect(relax(GOLDEN.replace('>3 pending<', '>4 pending<'))).not.toBe(want);
  });

  it('catches a status pill that says DRAFT is SUBMITTED', () => {
    // The pill class is the only thing separating a draft from a bill already sent for approval.
    expect(withRow(1, { status: 'SUBMITTED' })).not.toBe(want);
    expect(relax(GOLDEN.replace('pill pill-draft', 'pill pill-submit'))).not.toBe(want);
  });

  it('catches the company or the vendor on a row changing', () => {
    expect(withRow(2, { tenant_name: 'SKINDAE SDN BHD' })).not.toBe(want);
    expect(withRow(0, { contact: 'GRAB HOLDINGS' })).not.toBe(want);
  });

  it('catches the bill reference or the due date changing', () => {
    expect(withRow(0, { number: 'BILL-2026-0999' })).not.toBe(want);
    expect(withRow(0, { due: '2026-09-30' })).not.toBe(want);
  });

  it('mirrors the legacy em-dash fallbacks rather than printing empty cells', () => {
    const html = renderToStaticMarkup(screen({ bills: [{ ...BILLS[0], contact: null, number: null, due: null }] }));
    expect((html.match(/—/g) || []).length).toBe(3);
  });

  it('catches a row losing its id — the element approve() fades and removes', () => {
    expect(relax(GOLDEN.replace('id="bill1"', ''))).not.toBe(want);
  });

  it('catches an escaping hole: server text reaches the page as text, not markup', () => {
    const html = renderToStaticMarkup(screen({ bills: [{ ...BILLS[0], contact: '<script>x</script>' }] }));
    expect(html).not.toContain('<script>');
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=` from the string comparison, so every case here is invisible to the diff above.
  // These are the defects that cost money on this screen.

  it('catches a decision bound to the WRONG BILL — three identical-looking rows', () => {
    // Every button posting the first row's invoice. On screen: nothing. In Xero: the wrong bill applied
    // or voided, twice over, and the right one still pending.
    expect(() => assertHandlerParity({
      onDecide: ((_t: string, _inv: string, a: string, i: number) => misfire(BILLS[0].tenant_id, BILLS[0].invoice_id, a, i)) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches an off-by-one row INDEX while the invoice is still right', () => {
    // `approve()` uses `i` to find the row it fades and removes (app.html:2410), so this leaves the
    // decided row on screen and fades an undecided one — the operator presses it again.
    expect(() => assertHandlerParity({
      onDecide: ((t: string, inv: string, a: string, i: number) => misfire(t, inv, a, i + 1)) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches Reject posting an approve — the two buttons swapped', () => {
    // The worst outcome available on this screen: pressing Reject pays the bill.
    expect(() => assertHandlerParity({
      onDecide: ((t: string, inv: string, _a: string, i: number) => misfire(t, inv, 'approve', i)) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches a decision sent to the wrong TENANT with the right invoice', () => {
    // The server resolves the Xero connection from the tenant; the wrong one is a cross-company post.
    expect(() => assertHandlerParity({
      onDecide: ((_t: string, inv: string, a: string, i: number) => misfire(BILLS[2].tenant_id, inv, a, i)) as never,
    })).toThrow(/deeply equal/);
  });

  it('catches a button that stopped calling anything at all', () => {
    expect(() => assertHandlerParity({ onDecide: (() => {}) as never })).toThrow(/deeply equal/);
  });
});

describe('the states no golden holds', () => {
  // `renderApprovals()` writes four different documents into `#approvals` and the harness captured one.
  // The other three are mirrored from app.html:2360-2369 and pinned here, because the diff cannot see
  // them — and because the two empty ones are what an operator sees on the day nothing is pending.

  it('paints spin()\'s skeleton while {api:\'pending\'} is in flight', () => {
    // app.html:1536, character for character. Without it the operator stares at the previous tab.
    const html = renderToStaticMarkup(screen({ bills: null }));
    expect(html).toBe(
      '<div class="cards"><div class="sk-card"></div><div class="sk-card"></div><div class="sk-card"></div><div class="sk-card"></div></div>' +
      '<div class="sk-row"></div><div class="sk-row"></div><div class="sk-row" style="width:65%"></div>',
    );
  });

  it('shows the server\'s own message when the call fails — app.html:2361', () => {
    const html = renderToStaticMarkup(screen({ error: 'Xero connection expired' }));
    expect(html).toBe('<div class="empty"><div class="empty-ico">⚠️</div><div>Xero connection expired</div></div>');
    expect(html).not.toContain('Pending Bills');
  });

  it('shows "No data" for a response that carried no bills array — app.html:2363', () => {
    expect(renderToStaticMarkup(screen({ noData: true })))
      .toBe('<div class="empty"><div class="empty-ico">📭</div><div>No data</div></div>');
  });

  it('shows "No pending approvals" — panelled, unlike the other two — app.html:2368', () => {
    // The legacy wraps this one in a `.panel` and the two failure branches in nothing. Mirrored as-is:
    // a difference an operator sees, and not ours to tidy.
    expect(renderToStaticMarkup(screen({ bills: [] })))
      .toBe('<div class="panel"><div class="empty"><div class="empty-ico">✅</div><div>No pending approvals</div></div></div>');
  });

  it('a row with a decision in flight cannot be pressed again — app.html:2411', () => {
    // `approve()` sets exactly these two declarations on the row. Without them the operator can press
    // Approve twice while the post is open, and the second one lands on a bill already applied.
    const html = renderToStaticMarkup(screen({ busy: [1] }));
    expect(html).toContain('<tr id="bill1" style="opacity:.5;pointer-events:none">');
    expect(html).toContain('<tr id="bill0">');
    expect(html).toContain('<tr id="bill2">');
  });

  it('the busy row is not in the golden, so the diff above really is the idle state', () => {
    expect(rendered({ busy: [0] })).not.toBe(relax(GOLDEN));
    expect(rendered({ bills: null })).not.toBe(relax(GOLDEN));
    expect(rendered({ bills: [] })).not.toBe(relax(GOLDEN));
  });
});

describe('the company filter — curCo(), app.html:2366', () => {
  // The chrome's select, read by the route. The golden was captured on "— All Companies —".
  it('shows every bill when no company is picked', () => {
    expect(visibleBills(BILLS, '').length).toBe(3);
  });

  it('shows only the picked company\'s bills, and never another company\'s', () => {
    const one = visibleBills(BILLS, BILLS[2].tenant_id);
    expect(one.length).toBe(1);
    expect(one[0].invoice_id).toBe('inv-3');
    expect(one.every((b) => b.tenant_id === BILLS[2].tenant_id)).toBe(true);
  });

  it('renumbers the row ids so approve()\'s index still matches the row on screen', () => {
    // The index is positional in the RENDERED list, not in the response, which is what the legacy
    // `bills.forEach((b,i)=>…)` does after filtering. Filtering to one company must not leave the row
    // carrying index 2.
    const html = renderToStaticMarkup(screen({ filter: BILLS[2].tenant_id }));
    expect(html).toContain('<tr id="bill0">');
    expect(html).not.toContain('id="bill2"');
    expect(html).toContain('1 pending');
  });

  it('falls to the panelled empty state when the picked company has nothing pending', () => {
    expect(renderToStaticMarkup(screen({ filter: 'no-such-tenant' }))).toContain('No pending approvals');
  });
});

describe('the request a decision makes — no golden sees it, and it changes a Xero ledger', () => {
  it('is exactly what approve() POSTs, read out of app.html rather than retyped', () => {
    // A retyped expectation agrees with a widened port by construction. This body applies or VOIDS a
    // supplier bill, so an extra key or a different api is a different act.
    const src = readFileSync(join(REPO, 'app.html'), 'utf8');
    const fn = src.slice(src.indexOf('async function approve('), src.indexOf('/* ── Collections ── */'));
    const legacy = [...fn.matchAll(/call\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(legacy).toEqual(["api:'approve',tenant,invoice,action"]);
    expect(decideBody('t1', 'inv-1', 'approve')).toEqual({ api: 'approve', tenant: 't1', invoice: 'inv-1', action: 'approve' });
  });

  it('carries the tenant and the invoice and nothing else that could redirect it', () => {
    expect(Object.keys(decideBody('t1', 'inv-1', 'reject')).sort()).toEqual(['action', 'api', 'invoice', 'tenant']);
    expect(decideBody('t1', 'inv-1', 'reject').action).toBe('reject');
  });

  it('never sends the row index — the server decides on the invoice, not on a position', () => {
    // Guard against a "helpful" widening: an index in the body would make a stale list decide the wrong
    // bill server-side, where nothing on this screen could catch it.
    expect(JSON.stringify(decideBody('t1', 'inv-1', 'approve'))).not.toMatch(/\bi\b|index|row/);
  });
});

describe('the feature gate — app.html:1434', () => {
  // The withheld direction, asserted. `renderApprovals()` has no role check in it at all; `showApp()`'s
  // final `else` hides the tab unless 'approvals' is in this login's feature list. A port that mirrored
  // only the renderer would serve every company's pending bills — vendor, reference and amount — plus
  // buttons that apply or void them, to anyone who typed the URL.
  it('opens for a login that carries the approvals feature', () => {
    expect(approvalsReachable({ features: ['overview', 'approvals'] })).toBe(true);
  });

  it('is closed for every other shape of permission, including a missing one', () => {
    for (const p of [null, undefined, {}, { features: [] }, { features: null }, { features: ['approval'] }, { features: ['overview'] }]) {
      expect(approvalsReachable(p as never)).toBe(false);
    }
  });

  it('is NOT the admin gate — approvals is not one of showApp()\'s named branches', () => {
    // Read out of app.html rather than asserted from memory. `wht`, `selfbill`, `gateway`, `bankfeed`
    // and `salesrecon` are `!canManage`; `approvals` is named nowhere and falls through to the final
    // `else`. Copying a neighbour's line would both over- and under-grant.
    const src = readFileSync(join(REPO, 'app.html'), 'utf8');
    const block = src.slice(src.indexOf("const feats=PERMS.features||[]"), src.indexOf('// Hide any category whose sub-tabs'));
    expect(block).toContain("else el.classList.toggle('hide', feats.indexOf(t)<0)");
    expect(block).not.toContain("t==='approvals'");
    // A login that manages users but has no feature list still cannot reach it.
    expect(approvalsReachable({ features: [] } as never)).toBe(false);
  });

  it('is what the route gates on — the screen is a row of live write buttons', () => {
    // Guard the guard: the gate exists because reaching this screen at all puts an operator one click
    // from applying or voiding a supplier bill in Xero.
    const html = renderToStaticMarkup(screen());
    expect(html).toContain('>Approve</button>');
    expect(html).toContain('>Reject</button>');
    expect(html).toContain('SHOPEE MOBILE MALAYSIA SDN BHD');
  });
});
