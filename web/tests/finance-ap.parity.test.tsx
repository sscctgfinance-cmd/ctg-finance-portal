// Finance OS · AP Inbox — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.ap.html` was captured from `renderAp()` / `apRender()` (app.html:6753) by the
// 40-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts, tests/parity.ts or tests/handlers.ts. The component is rendered with
// `renderToStaticMarkup`, normalised by the harness's own normalise(), relaxed by the documented layer
// in ./parity.ts, and compared.
//
// NO SEVENTH RELAXATION, and no screen-local rule either. This screen writes a lot of non-ASCII —
// ✅ ✉ 🚫 ⚠ ⏱ 📧 🗺 📨 📎 🧾 📄 ↻ ▼ — but every one of them is a literal character in app.html's HTML
// string, not a character reference, so React emits the identical bytes. The only entities in the whole
// golden come from `esc()` on the data, and R6 already covers the one spelling difference there.
//
// ── THE SHAPE, DECLARED ───────────────────────────────────────────────────────────────────────────
// ONE golden section (`#ap`), FOUR regions inside it, and the golden reaches inside exactly one:
//   1. stat banner            — in the golden
//   2. inbox panel            — in the golden, with AP_DETAIL null (so `apRenderDetail()` is NOT)
//   3. GL coding rules panel  — HEADER only; AP_SHOW_RULES is false
//   4. Automation settings    — HEADER only; AP_SHOW_SETTINGS is false
// plus `#ap_preview_modal`, which `apShowPreviewModal()` appends to document.body — outside `#ap`
// entirely and in no golden. All four uncovered bodies are pinned by assertion below.
//
// ── THE ZONE ──────────────────────────────────────────────────────────────────────────────────────
// This screen needs no `hr.clock`-style zone pin: all three legacy `toLocale*` calls pass
// `timeZone:'Asia/Kuala_Lumpur'` explicitly, and the harness's UTC default spreads the caller's options
// LAST, so the explicit zone wins on both sides. What it DOES need is the Compliance Calendar's guard —
// the source pin below — because dropping that option is invisible on any machine at UTC+8 and prints
// the previous day west of Greenwich.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import FinanceAp, {
  ApDetailPane, ApPreviewModal, ApRulesBody, ApSettingsBody, AP_INBOUND_MAILBOX, AP_STATUS_LABELS,
  apCounts, apDeriveKeyword, apMinutesSaved, apReachable, apReachableAfterTopUp, apReceived, apWhen,
  collectLines, inboundEmail, parseKeywords, postBody, postConfirmText, previewAnyFail, previewBody,
  rejectBody, replyBody, replyConfirmText, ruleSaveBody, settingsBody,
  type ApDetail, type ApItem, type ApRule, type ApSetting,
} from '../src/finance-ap';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `#ap` is the tab div `render('ap')` writes into — the golden's ONLY section. */
const GOLDEN = goldenSection('finance.ap', 'ap');

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');
const SRC = readFileSync(join(REPO, 'web', 'src', 'finance-ap.tsx'), 'utf8');

const noop = () => {};

type Props = Parameters<typeof FinanceAp>[0];

/** tests/render_fixtures.ts's two companies — the ones the harness rendered the golden under. */
const COMPANIES = [
  { tenant_id: '11111111-1111-4111-8111-111111111111', tenant_name: 'SKINDAE SDN BHD' },
  { tenant_id: '22222222-2222-4222-8222-222222222222', tenant_name: 'I PROCARE MALAYSIA SDN BHD' },
];

/** tests/render_fixtures.ts's `ap_inbox_list` — four rows, four different statuses. */
const INBOX: ApItem[] = [
  { id: 101, tenant_id: COMPANIES[0].tenant_id, tenant_name: 'SKINDAE SDN BHD', status: 'auto_posted', received_at: '2026-08-17T02:14:00.000Z',
    from_name: 'TENAGA NASIONAL BERHAD', from_email: 'ebill@tnb.com.my', subject: 'Electricity bill for August 2026',
    attachments: [{ name: 'tnb-aug.pdf' }], ai_verdict: { doc_type: 'invoice', total: 2044.00 } },
  { id: 102, tenant_id: COMPANIES[0].tenant_id, tenant_name: 'SKINDAE SDN BHD', status: 'needs_review', received_at: '2026-08-17T06:41:00.000Z',
    from_name: 'SITI NURHALIZA', from_email: 'siti@ctg.test', subject: 'Reimbursement — client entertainment',
    attachments: [{ name: 'form.pdf' }, { name: 'receipt.jpg' }], ai_verdict: { doc_type: 'reimbursement', total: 388.50 } },
  { id: 103, tenant_id: COMPANIES[1].tenant_id, tenant_name: 'I PROCARE MALAYSIA SDN BHD', status: 'duplicate_rejected_replied', received_at: '2026-08-16T23:02:00.000Z',
    from_name: 'GRAB HOLDINGS', from_email: 'billing@grab.com', subject: 'Your July statement', attachments: [], ai_verdict: { doc_type: 'invoice', total: 640.30 } },
  { id: 104, tenant_id: COMPANIES[1].tenant_id, tenant_name: 'I PROCARE MALAYSIA SDN BHD', status: 'compliance_rejected', received_at: '2026-08-16T10:00:00.000Z',
    from_name: null, from_email: 'noreply@unknown.test', subject: '', attachments: [], ai_verdict: null },
];

/** tests/render_fixtures.ts's `ap_settings_get`. */
const SETTINGS: ApSetting[] = [
  { tenant_id: COMPANIES[0].tenant_id, tenant_name: 'SKINDAE SDN BHD', routing_slug: 'skindae', max_auto_post_amount: 1000, auto_post_when_compliant: true,
    auto_reply_when_rejected: true, require_4item_reimbursement: true, require_known_vendor_for_autopost: true, ai_provider: 'anthropic', duplicate_check_days: 90, enabled: true },
  { tenant_id: COMPANIES[1].tenant_id, tenant_name: 'I PROCARE MALAYSIA SDN BHD', routing_slug: 'iprocare', max_auto_post_amount: 99999999, auto_post_when_compliant: false,
    auto_reply_when_rejected: true, require_4item_reimbursement: false, require_known_vendor_for_autopost: false, ai_provider: 'openai', duplicate_check_days: 30, enabled: false },
];

function screen(over: Partial<Props> = {}) {
  // The state the harness captured: loaded inbox, nothing opened, no filter, both panels collapsed.
  return (
    <FinanceAp
      companies={COMPANIES}
      inbox={INBOX}
      settings={SETTINGS}
      rules={[]}
      detail={null}
      decisions={[]}
      activeId={null}
      filterTenant=""
      filterStatus=""
      rulesTenant=""
      showRules={false}
      showSettings={false}
      onFilterTenant={noop}
      onFilterStatus={noop}
      onOpen={noop}
      onRefresh={noop}
      onToggleRules={noop}
      onToggleSettings={noop}
      onRulesTenant={noop}
      onDeleteRule={noop}
      onAddRule={noop}
      onSaveSettings={noop}
      onCopyEmail={noop}
      onSendReply={noop}
      onRerun={noop}
      onReject={noop}
      onPreview={noop}
      onPostBill={noop}
      {...over}
    />
  );
}

const rendered = (over: Partial<Props> = {}) => relax(renderToStaticMarkup(screen(over)));

describe('Finance AP Inbox — React vs the legacy golden', () => {
  it('renders the same document as apRender() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * This screen needs BOTH established widenings in one file, the `finance.wht` combination:
 *
 *  • `identArgs()` — a row is `apOpen(101)`, a BARE INTEGER. `goldenHandlers()` collects QUOTED
 *    literals only, so every one of the four rows extracts as `[]` and the check would pass with all
 *    four rows opening the same email — on an accounts-payable queue, that is the operator reviewing
 *    and posting a bill under another supplier's row. The ninth screen to need it; still copied here
 *    rather than folded into the shared file while migrations are in flight.
 *
 *  • `LEGACY_TO_PROP` — five of the nine golden handlers are argument-free, and three of those are
 *    INLINE STATEMENTS rather than calls (`AP_FILTER_TENANT=this.value;renderAp()`,
 *    `AP_SHOW_RULES=!AP_SHOW_RULES;renderAp()`, and the same for settings). Without an identity check,
 *    the two filter selects, Refresh and the two panel toggles are all `[]` and swapping any pair
 *    passes. Keyed on the WHOLE raw text first, as finance-wht's is, because that is the only thing
 *    that separates the three inline statements from each other.
 */
const identArgs = (raw: string): string[] =>
  [...raw.matchAll(/'([^']*)'|"([^"]*)"|(?<![\w'"-])(-?\d+)(?![\w'"])/g)].map((m) => m[1] ?? m[2] ?? m[3]);

const LEGACY_TO_PROP: Record<string, string> = {
  'AP_FILTER_TENANT=this.value;renderAp()': 'filterTenant',
  'AP_FILTER_STATUS=this.value;renderAp()': 'filterStatus',
  'renderAp()': 'refresh',
  'AP_SHOW_RULES=!AP_SHOW_RULES;renderAp()': 'toggleRules',
  'AP_SHOW_SETTINGS=!AP_SHOW_SETTINGS;renderAp()': 'toggleSettings',
  apOpen: 'open',
};

const propFor = (raw: string) => LEGACY_TO_PROP[raw] ?? LEGACY_TO_PROP[raw.replace(/\(.*$/, '')] ?? raw;

function assertHandlerParity(over: Partial<Props> = {}) {
  const want = goldenHandlers(GOLDEN).map((h) => ({ ...h, args: identArgs(h.raw) }));
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args
        .filter((a) => (typeof a === 'string' || typeof a === 'number') && a !== STUB_VALUE)
        .map(String),
    });
  misfire = record('misfire');

  const got = reactHandlers(screen({
    onFilterTenant: record('filterTenant') as never,
    onFilterStatus: record('filterStatus') as never,
    onRefresh: record('refresh') as never,
    onToggleRules: record('toggleRules') as never,
    onToggleSettings: record('toggleSettings') as never,
    onOpen: record('open') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard, both directions. hr-clock's "some handler carries an argument" clause holds here
  // (the four rows do), and hr-profile's "every golden handler resolves to a KNOWN prop" catches a new
  // legacy button falling through `propFor()`'s `?? raw`.
  expect(want.length).toBe(9);
  expect(want.filter((h) => h.args.length > 0).length).toBe(4);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

describe('the comparison still bites', () => {
  const want = relax(GOLDEN);

  it('apRender() is the WHOLE paint — nothing runs after the innerHTML write that changes the DOM', () => {
    // CLAUDE.md's `finance.qinv` / `finance.users` / `finance.gateway` finding, applied rather than
    // assumed. `renderAp()` calls `spin('ap')` FIRST and `apRender()` overwrites the same id, so
    // last-write-wins leaves the golden holding the loaded screen and no skeleton — the
    // `finance.approvals` case. Then `apRender()` must stop at its write, or the golden would be a
    // screen no operator ever sees and every assertion in this file would be about the wrong document.
    const fn = APP.slice(APP.indexOf('function apRender(){'), APP.indexOf('function apRenderSettings(){'));
    expect(fn).toContain("document.getElementById('ap').innerHTML=");
    const tail = fn.slice(fn.lastIndexOf("apRenderSettings():''"));
    for (const forbidden of ['appendChild', 'setTimeout', '.value=', 'classList', '.textContent', 'call({', 'insertAdjacent']) {
      expect(tail).not.toContain(forbidden);
    }
    // And renderAp() itself does nothing after apRender() but set the loaded flag.
    const outer = APP.slice(APP.indexOf('async function renderAp(){'), APP.indexOf('function apStatusPill('));
    expect(outer.slice(outer.indexOf('apRender();') + 'apRender();'.length, outer.indexOf('} catch(e)')).trim())
      .toBe('loaded.ap = true;');
    expect(outer.indexOf("spin('ap')")).toBeLessThan(outer.indexOf('apRender();'));
  });

  // ── the diff catches the money and the binding ─────────────────────────────────────────────────

  it('catches an AI total changing', () => {
    const bad = INBOX.map((m, i) => (i === 0 ? { ...m, ai_verdict: { ...m.ai_verdict, total: 2144 } } : m));
    expect(rendered({ inbox: bad })).not.toBe(want);
  });

  it('catches a row losing its total to the — dash, and a dash gaining a total', () => {
    // `aiTotal ? M(aiTotal) : '—'` — a bill whose figure disappeared reads as "the AI found nothing",
    // and one that gained a figure reads as reviewed. Both are wrong in opposite directions.
    expect(rendered({ inbox: INBOX.map((m, i) => (i === 0 ? { ...m, ai_verdict: { doc_type: 'invoice' } } : m)) })).not.toBe(want);
    expect(rendered({ inbox: INBOX.map((m, i) => (i === 3 ? { ...m, ai_verdict: { total: 1 } } : m)) })).not.toBe(want);
  });

  it('catches a row bound to another supplier — the from/subject pair moving', () => {
    const swapped = [INBOX[1], INBOX[0], INBOX[2], INBOX[3]];
    expect(rendered({ inbox: swapped })).not.toBe(want);
  });

  it('catches a status pill changing colour or wording', () => {
    // "🚫 Dup — replied" and "❌ Missing docs" are the difference between "we already paid this" and
    // "we never got the paperwork". They also drive the stat banner's buckets.
    expect(rendered({ inbox: INBOX.map((m, i) => (i === 2 ? { ...m, status: 'duplicate_rejected' } : m)) })).not.toBe(want);
  });

  it('catches a dropped row, and an extra one', () => {
    expect(rendered({ inbox: INBOX.slice(0, 3) })).not.toBe(want);
    expect(rendered({ inbox: [...INBOX, { ...INBOX[0], id: 105 }] })).not.toBe(want);
  });

  it('catches the stat banner miscounting', () => {
    // Four different buckets in the fixture, so any bucketing change moves at least two cards.
    expect(rendered({ inbox: INBOX.map((m) => ({ ...m, status: 'posted' })) })).not.toBe(want);
  });

  it('catches the active-row highlight appearing on the wrong row, or at all', () => {
    // `AP_ACTIVE_ID===m.id` paints a background. With a detail pane open it is the only thing on screen
    // saying WHICH email the Post button belongs to.
    expect(rendered({ activeId: 101 })).not.toBe(want);
    expect(rendered({ activeId: 102 })).not.toBe(want);
  });

  it('catches a filter select losing an option or its id', () => {
    expect(rendered({ companies: [COMPANIES[0]] })).not.toBe(want);
    expect(relax(GOLDEN.replace('id="ap_filter_status"', ''))).not.toBe(want);
    expect(relax(GOLDEN.replace('id="ap_filter_tenant"', ''))).not.toBe(want);
  });

  it('catches the status filter losing a status, or reordering them', () => {
    // The option order IS `AP_STATUS_LABELS`' key order; the golden holds all fifteen.
    for (const s of Object.keys(AP_STATUS_LABELS)) expect(GOLDEN).toContain(`<option value="${s}">`);
    expect([...GOLDEN.matchAll(/<option value="[a-z_]+">/g)].length).toBe(15);
  });

  it('catches a filter select carrying a NON-EMPTY value — the golden is the unfiltered queue', () => {
    // R5 only absorbs "first option marked vs implied". A selection that moved still diffs, which is
    // what stops a screen that silently shows one company's queue passing as the whole inbox.
    expect(rendered({ filterTenant: COMPANIES[1].tenant_id })).not.toBe(want);
    expect(rendered({ filterStatus: 'needs_review' })).not.toBe(want);
  });

  it('catches a collapsible panel opening, or its chevron flipping', () => {
    expect(rendered({ showRules: true })).not.toBe(want);
    expect(rendered({ showSettings: true })).not.toBe(want);
    expect(GOLDEN).toContain('Show ▼');
    expect(GOLDEN).not.toContain('Hide ▲');
  });

  it('catches the detail pane appearing when the golden holds the placeholder', () => {
    // Proves the golden really is the AP_DETAIL===null state, so the detail assertions below are
    // genuinely untested by the diff rather than accidentally included in it.
    expect(rendered({ detail: { id: 101, status: 'needs_review' } })).not.toBe(want);
    expect(GOLDEN).toContain('<div class="empty-ico">📨</div>');
  });

  it('catches the empty-inbox message replacing a loaded queue', () => {
    expect(rendered({ inbox: [] })).not.toBe(want);
    expect(renderToStaticMarkup(screen({ inbox: [] }))).toContain('No emails in this queue yet.');
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────
  // R1 strips `on*=` from the string comparison, so every one of these is invisible to the diff above.

  it('catches a row opening ANOTHER email — the off-by-one that reviews the wrong bill', () => {
    expect(() => assertHandlerParity({ onOpen: ((id: number) => misfire(id === 101 ? 102 : id)) as never })).toThrow(/deeply equal/);
  });

  it('catches every row opening the same email', () => {
    expect(() => assertHandlerParity({ onOpen: (() => misfire(101)) as never })).toThrow(/deeply equal/);
  });

  it('catches a row losing its id entirely — which quoted-only extraction would have PASSED', () => {
    // The reason identArgs() is here. Without the bare-integer widening every row's expectation is `[]`
    // and this passes.
    expect(() => assertHandlerParity({ onOpen: (() => misfire()) as never })).toThrow(/deeply equal/);
    expect(goldenHandlers(GOLDEN).every((h) => h.args.length === 0)).toBe(true);
  });

  it('catches the two filter selects swapped — company filter driving the status filter', () => {
    expect(() => assertHandlerParity({ onFilterTenant: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches the two panel toggles swapped', () => {
    expect(() => assertHandlerParity({ onToggleRules: (() => misfire()) as never })).toThrow(/deeply equal/);
    expect(() => assertHandlerParity({ onToggleSettings: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches Refresh wired to a panel toggle', () => {
    expect(() => assertHandlerParity({ onRefresh: (() => misfire()) as never })).toThrow(/deeply equal/);
  });

  it('catches a row losing its click handler', () => {
    expect(() => assertHandlerParity({ onOpen: undefined as never })).toThrow();
  });
});

describe('dates — the zone is pinned in the SOURCE, because no output check on this fleet can see it', () => {
  it('every toLocale* in the component carries timeZone: Asia/Kuala_Lumpur', () => {
    // The Compliance Calendar's finding, in its other form. Here the legacy DOES use `new Date` and
    // `toLocaleString` — with an explicit zone. Drop that one option and the fixture's
    // 2026-08-17T02:14Z prints "16 Aug, 22:14" in London and "17 Aug, 10:14" here and on CI, so a
    // wrong DAY on an accounts-payable queue would ship green. This reads the shipped source rather
    // than trusting the output.
    const body = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const calls = [...body.matchAll(/toLocale(?:Date|Time)?String\(([^;]*?)\)\s*;/gs)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) {
      // M()'s currency format is the one legitimate exception: it formats a NUMBER, not an instant.
      if (!/Date/.test(c) && /minimumFractionDigits/.test(c)) continue;
      expect(c).toContain("timeZone: 'Asia/Kuala_Lumpur'");
    }
    // And the legacy still says the same thing, so the two cannot drift apart silently.
    expect([...APP.matchAll(/toLocaleString\('en-MY',\{timeZone:'Asia\/Kuala_Lumpur'/g)].length).toBeGreaterThanOrEqual(3);
  });

  it('formats an instant in MYT, not in the machine zone', () => {
    // 02:14Z is 10:14 MYT the SAME day and 22:14 the PREVIOUS day in New York. This assertion is the
    // half that fails on a machine west of Greenwich if the zone is dropped; the source pin above is
    // the half that fails here.
    expect(apWhen('2026-08-17T02:14:00.000Z')).toBe('17 Aug, 10:14');
    expect(apWhen('2026-08-16T10:00:00.000Z')).toBe('16 Aug, 18:00');
    expect(apReceived('2026-08-17T02:14:00.000Z')).toContain('17/08/2026');
  });

  it('mirrors the legacy on a missing date rather than blanking the cell', () => {
    // `new Date(undefined)` is an Invalid Date in both. A blank cell would read as "no date"; "Invalid
    // Date" reads as a data problem, which is what it is.
    expect(apWhen(undefined)).toBe('Invalid Date');
  });
});

describe('the permission gate — app.html:1428, hidden from EVERYONE', () => {
  it('is closed for every shape of permission, including a master admin', () => {
    for (const p of [null, undefined, {}, { features: [] }, { features: ['ap'] }, { manage_users: true },
      { manage_users: true, features: ['ap', 'overview'] }]) {
      expect(apReachable(p as never)).toBe(false);
    }
  });

  it('app.html still hides it from everyone, with the re-enable instruction attached', () => {
    expect(APP).toContain("else if(t==='ap') el.classList.toggle('hide', true);");
    expect(APP).toMatch(/t==='ap'\) el\.classList\.toggle\('hide', true\);\s+\/\/ AP Inbox HIDDEN[^\n]*flip true→!canManage to re-enable after a top-up/);
  });

  it('is NOT the feature-flag fall-through, and NOT !canManage — it is its own branch', () => {
    // app.html:1420-1439 is not uniform. `ap` sits in the `if/else if` chain that restarts at
    // `ctgaccess`, so it never reaches the final `else`'s `feats.indexOf(t)<0`. Copying a neighbour's
    // line would both over- and under-grant.
    const block = APP.slice(APP.indexOf("document.querySelectorAll('.tab').forEach"), APP.indexOf("document.querySelectorAll('.tab-cat')"));
    expect(block).toMatch(/else if\(t==='ap'\)/);
    expect(block).not.toMatch(/t==='ap'\)[^\n]*canManage\)/);
    expect(block).not.toMatch(/t==='ap'\)[^\n]*feats\.indexOf/);
  });

  it('describes the INTENDED rule for after a credit top-up: admin-only, like its neighbours', () => {
    expect(apReachableAfterTopUp({ manage_users: true })).toBe(true);
    for (const p of [null, undefined, {}, { manage_users: false }, { features: ['ap'] }]) {
      expect(apReachableAfterTopUp(p as never)).toBe(false);
    }
  });

  it('the route gates on apReachable(), not on the after-top-up rule', () => {
    // Guard the guard: the two differ for a master admin, so a route importing the wrong one would
    // silently re-open a tab that is off on purpose.
    const route = readFileSync(join(REPO, 'web', 'app', 'finance', 'ap', 'page.tsx'), 'utf8');
    expect(route).toContain('apReachable(');
    expect(route).not.toContain('apReachableAfterTopUp');
    expect(apReachable({ manage_users: true })).not.toBe(apReachableAfterTopUp({ manage_users: true }));
  });

  it('is what the screen withholds: every supplier, every figure, every company id', () => {
    // Guard the guard on the other side — the fixture really does carry what must not leak.
    const html = renderToStaticMarkup(screen());
    expect(html).toContain('ebill@tnb.com.my');
    expect(html).toContain('RM 2,044.00');
    expect(html).toContain('11111111-1111-4111-8111-111111111111');
  });
});

describe('the stat banner — a display echo, and its bucketing is the whole content', () => {
  it('buckets each status exactly as apRender() does', () => {
    expect(apCounts(INBOX)).toEqual({ posted: 1, replied: 1, rejected: 1, review: 1, total: 4 });
    expect(apCounts([{ id: 1, status: 'posted' }, { id: 2, status: 'auto_posted' }]).posted).toBe(2);
    expect(apCounts([{ id: 1, status: 'reply_sent' }, { id: 2, status: 'duplicate_rejected_replied' }]).replied).toBe(2);
    expect(apCounts([{ id: 1, status: 'duplicate_rejected' }, { id: 2, status: 'compliance_rejected' }, { id: 3, status: 'rejected' }]).rejected).toBe(3);
    // Not double-counted: the chain is else-if, so `auto_posted` never also lands in `replied`.
    expect(apCounts([{ id: 1, status: 'auto_posted' }])).toEqual({ posted: 1, replied: 0, rejected: 0, review: 1 - 1, total: 1 });
    // Anything unrecognised falls out of every bucket but still counts in `total`.
    expect(apCounts([{ id: 1, status: 'processing' }])).toEqual({ posted: 0, replied: 0, rejected: 0, review: 0, total: 1 });
  });

  it('switches from minutes to hours at exactly one hour', () => {
    // 9 handled × 6 = 54m; 10 × 6 = 60m = 1.0h. One item apart and very differently worded.
    const at = (handled: number) => apMinutesSaved({ posted: handled, replied: 0, rejected: 0, review: 0, total: handled });
    expect(at(3)).toBe('18m');
    expect(at(9)).toBe('54m');
    expect(at(10)).toBe('1.0h');
    expect(at(25)).toBe('2.5h');
  });
});

describe('#ap_preview_modal — the last thing an operator reads before a bill enters Xero', () => {
  const base = { payload: { Type: 'ACCPAY' }, tenant_id: '11111111-1111-4111-8111-111111111111', idempotency_key: 'abc123' };
  const modal = (r: Parameters<typeof ApPreviewModal>[0]['r']) =>
    renderToStaticMarkup(<ApPreviewModal r={r} onClose={noop} onPostAnyway={noop} />);

  it('says "Looks good" only when nothing failed and Xero has no candidate duplicate', () => {
    expect(previewAnyFail({ ...base, checks: [{ pass: true, name: 'x' }] })).toBe(false);
    expect(previewAnyFail({ ...base, checks: [{ pass: false, name: 'x' }] })).toBe(true);
    expect(previewAnyFail({ ...base, checks: [{ pass: true, name: 'x' }], xero_dupes: [{ invoice_number: 'INV-1' }] })).toBe(true);
    expect(modal({ ...base, checks: [{ pass: true, name: 'x' }] })).toContain('✓ Looks good — Post to Xero');
    expect(modal({ ...base, checks: [{ pass: false, name: 'x' }] })).toContain('⚠ Post anyway');
  });

  it('a Xero duplicate alone flips the button, even with every check passing', () => {
    // The defect that pays a supplier twice. `xero_dupes` is a SEPARATE signal from `checks`, and
    // collapsing the two would let a green button sit above a duplicate.
    const html = modal({ ...base, checks: [{ pass: true, name: 'Vendor resolved' }], xero_dupes: [{ match_type: 'exact', invoice_number: 'INV-9', contact_name: 'TNB', total: 2044, date: '2026-08-01', status: 'AUTHORISED' }] });
    expect(html).toContain('⚠ Post anyway');
    expect(html).toContain('🚨 Xero already has 1 bill that may be duplicates:');
    expect(html).toContain('RM 2044.00');
    expect(html).toContain('INV-9');
  });

  it('pluralises the duplicate count', () => {
    expect(modal({ ...base, xero_dupes: [{ invoice_number: 'a' }, { invoice_number: 'b' }] })).toContain('has 2 bills that may be duplicates');
  });

  it('shows the EXACT payload, wrapped as Xero receives it', () => {
    const html = modal({ ...base, checks: [] });
    expect(html).toContain('&quot;Invoices&quot;');
    expect(html).toContain('This is the EXACT JSON that will POST to Xero. Nothing has been sent yet.');
    expect(html).toContain('Idempotency-Key: ');
    expect(html).toContain('abc123');
    expect(html).toContain('tenant 11111111…');
  });

  it('marks each sanity check pass or fail, and never silently drops one', () => {
    const html = modal({ ...base, checks: [{ pass: true, name: 'Vendor resolved', detail: 'TNB' }, { pass: false, name: 'Total matches lines', detail: 'off by 12.00' }] });
    expect(html).toContain('Vendor resolved');
    expect(html).toContain('Total matches lines');
    expect(html).toContain('off by 12.00');
    expect([...html.matchAll(/>✓</g)].length).toBe(1);
    expect([...html.matchAll(/>✗</g)].length).toBe(1);
  });

  it('escapes what the server returned — a check name is untrusted text', () => {
    expect(modal({ ...base, checks: [{ pass: true, name: '<script>x</script>' }] })).not.toContain('<script>');
  });
});

describe('the detail pane — the largest renderer on the screen, and in no golden', () => {
  const detail = (over: Partial<ApDetail> = {}, decisions: Parameters<typeof ApDetailPane>[0]['decisions'] = []) =>
    renderToStaticMarkup(
      <ApDetailPane
        detail={{ id: 101, status: 'needs_review', from_name: 'TNB', from_email: 'ebill@tnb.com.my', subject: 'Aug bill',
          received_at: '2026-08-17T02:14:00.000Z', tenant_name: 'SKINDAE SDN BHD', text_body: 'Please find attached.',
          ai_verdict: { doc_type: 'invoice', vendor_name: 'TENAGA NASIONAL BERHAD', invoice_no: 'INV-9', invoice_date: '2026-08-01',
            due_date: '2026-08-31', total: 2044, line_items: [{ description: 'Electricity', quantity: 1, unit_amount: 2044, gl_matched_keyword: 'electric' }] },
          ...over } as ApDetail}
        decisions={decisions}
        onSendReply={noop} onRerun={noop} onReject={noop} onPreview={noop} onPostBill={noop}
      />,
    );

  it('carries every [data-bk] name apCollectBill() reads, extracted from app.html at run time', () => {
    // A retyped list agrees with a widened or narrowed port by construction. A header field that lost
    // its `data-bk` posts as ABSENT — a vendor, a date or a total silently missing from an override set
    // the server then fills from the AI verdict instead of from what the operator typed.
    const fn = APP.slice(APP.indexOf('function apRenderDetail(){'), APP.indexOf('async function apOpen('));
    const keys = [...fn.matchAll(/fld\('[^']*','([^']+)'/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(['due_date', 'invoice_date', 'invoice_no', 'total', 'vendor_name']);
    const html = detail();
    for (const k of keys) expect(html).toContain(`data-bk="${k}"`);
    expect([...html.matchAll(/data-bk="/g)].length).toBe(keys.length);
  });

  it('reads each bill field from the RIGHT field of the extracted document', () => {
    // Found by breaking the shipped component: swapping `Total`'s source to `ai.invoice_no` passed
    // every other check in this file, because the name check above proves the ATTRIBUTES are present
    // and says nothing about what sits beside them. That defect posts `Number('INV-9')||0` — a bill
    // for RM 0.00 in a real Xero ledger, with the invoice number nowhere on it.
    //
    // The label→key→SOURCE triples are read out of app.html's own `fld(...)` calls rather than retyped,
    // so a retyped list cannot agree with a widened port by construction.
    const fn = APP.slice(APP.indexOf('function apRenderDetail(){'), APP.indexOf('async function apOpen('));
    const triples = [...fn.matchAll(/fld\('([^']*)','([^']+)',ai\.(\w+)(?:,'(\w+)')?\)/g)]
      .map((m) => ({ label: m[1], key: m[2], source: m[3], type: m[4] || 'text' }));
    expect(triples.length).toBe(5);

    // One distinct sentinel per verdict field, so a field reading its neighbour's value is visible.
    const sources = [...new Set(triples.map((t) => t.source))];
    const verdict: Record<string, unknown> = { doc_type: 'invoice', line_items: [{ description: 'x' }] };
    sources.forEach((k, i) => { verdict[k] = 'SENTINEL' + i; });
    const html = detail({ ai_verdict: verdict as never });

    for (const t of triples) {
      const at = html.indexOf(`data-bk="${t.key}"`);
      expect(at, `no data-bk="${t.key}"`).toBeGreaterThan(-1);
      const tag = html.slice(html.lastIndexOf('<input', at), html.indexOf('>', at) + 1);
      expect(tag, `${t.key} reads the wrong verdict field`).toContain(`value="${verdict[t.source]}"`);
      expect(tag, `${t.key} has the wrong input type`).toContain(`type="${t.type}"`);
      // And the label the operator reads sits with it.
      expect(html.slice(0, at)).toContain(`>${t.label}</label>`);
    }
  });

  it('reads each line-item cell from the RIGHT field of the line', () => {
    // The same defect one level down: `data-li-k="quantity"` carrying `l.unit_amount` multiplies a
    // bill by its own price. Distinct sentinels again.
    const html = detail({ ai_verdict: { doc_type: 'invoice', line_items: [{ description: 'DESC', quantity: 7, unit_amount: 13, account_code: 'CODE' }] } as never });
    const cell = (k: string) => {
      const at = html.indexOf(`data-li-k="${k}"`);
      return html.slice(html.lastIndexOf('<input', at), html.indexOf('>', at) + 1);
    };
    expect(cell('description')).toContain('value="DESC"');
    expect(cell('quantity')).toContain('value="7"');
    expect(cell('unit_amount')).toContain('value="13"');
    expect(cell('account_code')).toContain('value="CODE"');
  });

  it('carries every [data-li-k] name, and one [data-li-i] per row', () => {
    const fn = APP.slice(APP.indexOf('function apRenderDetail(){'), APP.indexOf('async function apOpen('));
    const liKeys = [...new Set([...fn.matchAll(/data-li-k="([^"]+)"/g)].map((m) => m[1]))];
    expect(liKeys.sort()).toEqual(['account_code', 'description', 'quantity', 'unit_amount']);
    const html = detail();
    for (const k of liKeys) expect(html).toContain(`data-li-k="${k}"`);
    expect([...html.matchAll(/data-li-i="0"/g)].length).toBe(4);
  });

  it('is UNCONTROLLED — the route reads el.value off the live DOM, as apCollectBill() does', () => {
    // Every bill field carries the AI's value, never a controlled empty string: a controlled port would
    // need every keystroke in React state, and any state it failed to update would post the ORIGINAL AI
    // guess rather than the correction the operator typed.
    const html = detail();
    for (const m of html.matchAll(/<input[^>]*data-(?:bk|li-k)="[^"]*"[^>]*>/g)) expect(m[0]).not.toContain('value=""');
    expect(html).toContain('id="ap_lines"');
    expect(html).toContain('id="ap_bill_form"');
    // The reply subject IS `value=""` when there is no draft — app.html:6994 writes exactly that, so
    // mirroring it is right and a bare "no empty value anywhere" check would be wrong.
    expect(APP).toContain('<input id="ap_reply_subject" value="');
    expect(html).toContain('id="ap_reply_subject"');
  });

  it('falls back GL account: the line code, then the document suggestion, then 904-2200', () => {
    // app.html:6902. Wrong here is a mis-stated P&L, and the ORDER is the whole rule. Note this default
    // is 904-2200, NOT Smart OCR's 610-1000 — the two screens differ and copying either is wrong.
    expect(detail()).toContain('value="904-2200"');
    expect(detail({ ai_verdict: { doc_type: 'invoice', suggested_gl_account: '445-2000', line_items: [{ description: 'x' }] } })).toContain('value="445-2000"');
    expect(detail({ ai_verdict: { doc_type: 'invoice', suggested_gl_account: '445-2000', line_items: [{ description: 'x', account_code: '429-1000' }] } })).toContain('value="429-1000"');
    expect(APP).toContain("l.account_code||ai.suggested_gl_account||'904-2200'");
  });

  it('says which keyword coded a line, and says so LOUDLY when none did', () => {
    // "no rule — set manually" in amber is the only thing telling an operator the GL code is a guess.
    expect(detail()).toContain('via &quot;electric&quot;');
    expect(detail({ ai_verdict: { doc_type: 'invoice', line_items: [{ description: 'x' }] } })).toContain('no rule — set manually');
  });

  it('shows the Post button ONLY on needs_review / auto_posted, and only with line items', () => {
    // app.html:6971. A Post button on a `duplicate_rejected` email is a second bill for money already
    // owed once; a Post button with no lines posts nothing and the server rejects the whole call.
    expect(detail()).toContain('✓ Post to Xero');
    expect(detail({ status: 'auto_posted' })).not.toContain('✓ Post to Xero');   // isDone wins first
    expect(detail({ status: 'duplicate_rejected' })).not.toContain('✓ Post to Xero');
    expect(detail({ ai_verdict: { doc_type: 'invoice', line_items: [] } })).not.toContain('✓ Post to Xero');
  });

  it('shows the reply draft on the four statuses that can still be answered', () => {
    for (const s of ['reply_drafted', 'needs_review', 'compliance_rejected', 'duplicate_rejected']) {
      expect(detail({ status: s })).toContain('✉ Send reply');
    }
    expect(detail({ status: 'received' })).not.toContain('✉ Send reply');
    expect(detail({ status: 'reply_sent' })).not.toContain('✉ Send reply');
  });

  it('hides Re-run AI once the bill is in Xero', () => {
    // `canRerun` is `status!=='posted' && status!=='auto_posted'`. Re-running after a post would
    // overwrite the verdict of a document that already exists in the ledger.
    expect(detail()).toContain('🔁 Re-run AI');
    expect(detail({ status: 'posted' })).not.toContain('🔁 Re-run AI');
  });

  it('a done email offers NO write control at all', () => {
    for (const s of ['posted', 'auto_posted', 'reply_sent', 'duplicate_rejected_replied', 'rejected']) {
      const html = detail({ status: s });
      expect(html).not.toContain('✓ Post to Xero');
      expect(html).not.toContain('✉ Send reply');
      expect(html).not.toContain('🔍 Preview payload');
    }
    expect(detail({ status: 'posted', xero_invoice_number: 'BILL-31' })).toContain('<b>✅ Posted to Xero</b> as BILL-31');
    expect(detail({ status: 'rejected' })).toContain('Rejected. No further action.');
  });

  it('shows the duplicate warning with the bill it matched, not just "duplicate"', () => {
    // Which existing bill, on what date, for how much, in what state — an operator cannot decide
    // "post anyway" without it.
    const html = detail({ ai_verdict: { doc_type: 'invoice', server_duplicate: { number: 'INV-9', inv_date: '2026-07-01', total: '640.30', status: 'PAID', amount_due: '0' } } });
    expect(html).toContain('🚫 Duplicate detected');
    expect(html).toContain('INV-9');
    expect(html).toContain('2026-07-01');
    expect(html).toContain('RM 640.30');
    expect(html).toContain('PAID');
    expect(html).toContain('amount due RM 0');
  });

  it('runs the right compliance checklist for the doc type, and none for neither', () => {
    expect(detail()).toContain('Supplier invoice compliance (MFRS/SST)');
    expect(detail({ ai_verdict: { doc_type: 'reimbursement' } })).toContain('Reimbursement compliance (MFRS)');
    expect(detail({ ai_verdict: { doc_type: 'reimbursement' } })).toContain('Payment proof (card/bank receipt)');
    expect(detail({ ai_verdict: {} })).not.toContain('compliance (MFRS');
  });

  it('a MISSING consistency flag reads as OK, and only an explicit false reads as failed', () => {
    // `ai.amount_consistent !== false` — the AI omitting the field must not paint a red ✗ on a bill
    // that is fine, and an explicit false must not be softened into a ✓.
    expect(detail({ ai_verdict: { doc_type: 'invoice', amount_consistent: false } })).toContain('var(--red-soft);font-weight:700;width:14px">✗');
    const ok = detail({ ai_verdict: { doc_type: 'invoice' } });
    expect(ok).toContain('var(--green-soft);font-weight:700;width:14px">✓');
  });

  it('surfaces routing, tax review, audit notes, issues and the decision log only when present', () => {
    expect(detail()).not.toContain('Company routing');
    expect(detail({ ai_verdict: { company_routing_status: 'company_conflict', company_conflict_reason: 'Buyer is I PROCARE' } })).toContain('company conflict');
    expect(detail({ ai_verdict: { company_routing_status: 'company_conflict', company_conflict_reason: 'Buyer is I PROCARE' } })).toContain('Buyer is I PROCARE');
    expect(detail({ ai_verdict: { tax_review: { wht_risk: 'high', sst_risk: 'none' } } })).toContain('wht risk: high');
    expect(detail({ ai_verdict: { tax_review: { sst_risk: 'none' } } })).not.toContain('Tax/accounting review');
    expect(detail({ ai_verdict: { audit_notes: ['check the period'] } })).toContain('check the period');
    expect(detail({ ai_verdict: { issues: ['no SST number', 'date unclear'] } })).toContain('no SST number · date unclear');
    expect(detail({}, [{ created_at: '2026-08-17T02:14:00.000Z', decision: 'auto_posted', reasoning: 'compliant' }])).toContain('Decision audit log (1)');
    expect(detail({}, [{ created_at: '2026-08-17T02:14:00.000Z', decision: 'auto_posted' }])).toContain('17 Aug, 10:14');
  });

  it('escapes what arrived by email — every field here came from outside', () => {
    const evil = detail({ from_name: '<script>a</script>', subject: '<img onerror=x>', text_body: '<b>hi</b>',
      ai_verdict: { doc_type: 'invoice', vendor_name: '"><script>b</script>', line_items: [{ description: '<i>x</i>' }] } });
    expect(evil).not.toContain('<script>');
    expect(evil).not.toContain('<img onerror');
    expect(evil).not.toContain('<b>hi</b>');
  });

  it('truncates the email body and the sent reply at the legacy limits', () => {
    expect(detail({ text_body: 'x'.repeat(4000) })).toContain('x'.repeat(3000) + '<');
    expect(detail({ status: 'reply_sent', reply_body: 'y'.repeat(600) })).toContain('y'.repeat(500) + '<');
  });
});

describe('the two collapsed panels — headers in the golden, bodies in none', () => {
  const rules = (rs: ApRule[], tenant = '') =>
    renderToStaticMarkup(<ApRulesBody companies={COMPANIES} rules={rs} rulesTenant={tenant} onRulesTenant={noop} onRefresh={noop} onDeleteRule={noop} onAddRule={noop} />);
  const settings = (ss: ApSetting[]) =>
    renderToStaticMarkup(<ApSettingsBody settings={ss} onSaveSettings={noop} onCopyEmail={noop} />);

  it('the rules body keeps the four ids apAddRule() reads back out of the DOM', () => {
    const html = rules([]);
    for (const id of ['ap_rule_tenant', 'ap_rule_keywords', 'ap_rule_code', 'ap_rule_prio']) {
      expect(html).toContain(`id="${id}"`);
      expect(APP).toContain(`getElementById('${id}')`);
    }
    expect(html).toContain('id="ap_rule_add_btn"');
  });

  it('the rules body says "no rules" rather than showing an empty table', () => {
    expect(rules([])).toContain('No rules loaded. Pick a company filter or add one below.');
  });

  it('a rule row shows its keywords, its GL code and its priority', () => {
    // The GL code IS the rule's effect. A row that lost it looks like a rule doing nothing.
    const html = rules([{ id: 7, tenant_id: COMPANIES[0].tenant_id, pattern_keywords: ['grab', 'taxi'], account_code: '903-0100', notes: 'e-hailing', priority: 200 }]);
    expect(html).toContain('grab');
    expect(html).toContain('taxi');
    expect(html).toContain('903-0100');
    expect(html).toContain('>200<');
    expect(html).toContain('SKINDAE SDN BHD'.slice(0, 18));
  });

  it('a rule with no priority reads as 100, the legacy default', () => {
    expect(rules([{ id: 7, pattern_keywords: ['x'], account_code: '1' }])).toContain('>100<');
  });

  it('the settings body builds the inbound address from the slug, and refuses to invent one', () => {
    // This address is what a supplier is told to mail. A wrong one silently routes a company's bills
    // into another company's queue; a missing slug must read as missing, not as a plausible address.
    expect(inboundEmail('skindae')).toBe('ssc.ctgfinance+skindae@gmail.com');
    expect(inboundEmail('')).toBe('— set a slug —');
    expect(inboundEmail(null)).toBe('— set a slug —');
    expect(AP_INBOUND_MAILBOX).toBe('ssc.ctgfinance');
    expect(APP).toContain("const AP_INBOUND_MAILBOX = 'ssc.ctgfinance'");
    const html = settings(SETTINGS);
    expect(html).toContain('ssc.ctgfinance+skindae@gmail.com');
    expect(html).toContain('ssc.ctgfinance+iprocare@gmail.com');
  });

  it('the settings rows carry data-ten AND data-k on every control apSaveSettings() reads', () => {
    // `apSaveSettings(tid)` collects `[data-ten="<tid>"]`. A control that lost `data-ten` is never
    // saved; one that carried the WRONG tenant saves another company's automation limits.
    const html = settings(SETTINGS);
    const fn = APP.slice(APP.indexOf('function apRenderSettings(){'), APP.indexOf('function apRenderRules(){'));
    const keys = [...new Set([...fn.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1]))];
    expect(keys.sort()).toEqual(['ai_provider', 'auto_post_when_compliant', 'auto_reply_when_rejected',
      'duplicate_check_days', 'enabled', 'max_auto_post_amount', 'require_4item_reimbursement', 'require_known_vendor_for_autopost']);
    for (const k of keys) expect(html).toContain(`data-k="${k}"`);
    for (const s of SETTINGS) expect([...html.matchAll(new RegExp(`data-ten="${s.tenant_id}"`, 'g')).toString().length ? [1] : []].length).toBe(1);
    expect([...html.matchAll(/data-ten="11111111-1111-4111-8111-111111111111"/g)].length).toBe(keys.length);
    expect([...html.matchAll(/data-ten="22222222-2222-4222-8222-222222222222"/g)].length).toBe(keys.length);
  });

  it('a MISSING auto-post flag defaults ON, and only an explicit false turns it off', () => {
    // `s.auto_post_when_compliant!==false` — the four gates default to ON, and `enabled` does NOT
    // (`s.enabled` plain). Flipping either default silently changes whether a company's bills post
    // themselves into Xero.
    const html = settings([{ tenant_id: 't', tenant_name: 'X', routing_slug: 'x' }]);
    expect([...html.matchAll(/checked=""/g)].length).toBe(4);
    expect(html).toContain('data-k="enabled" type="checkbox"');
    expect(html).not.toMatch(/data-k="enabled"[^>]*checked/);
    expect(APP).toContain("s.auto_post_when_compliant!==false?' checked':''");
    expect(APP).toContain("(s.enabled?' checked':'')");
  });

  it('shows "no cap" only at or above 99999999, and the cap default is 1000', () => {
    // Narrowed to the ROW's marker: the panel's own prose says "for no cap." whatever the data is.
    const noCapNote = (n: number) => settings([{ tenant_id: 't', max_auto_post_amount: n }]).includes('font-size:9.5px">no cap<');
    expect(noCapNote(99999999)).toBe(true);
    expect(noCapNote(99999998)).toBe(false);
    expect(settings([{ tenant_id: 't' }])).toContain('value="1000"');
    expect(settings([{ tenant_id: 't' }])).toContain('value="90"');
  });

  it('offers the three AI providers and preselects the company\'s own', () => {
    const html = settings(SETTINGS);
    expect(html).toContain('>Claude<');
    expect(html).toContain('>OpenAI<');
    expect(html).toContain('>Gemini<');
    expect(html).toContain('<option value="openai" selected="">OpenAI</option>');
    expect(html).toContain('<option value="anthropic" selected="">Claude</option>');   // the other company
    expect(settings([{ tenant_id: 't' }])).toContain('<option value="anthropic" selected="">Claude</option>');
  });
});

describe('the requests — no golden sees one, and four of them change a real ledger or mailbox', () => {
  it('postBody() is exactly what apPostBill() POSTs, read out of app.html rather than retyped', () => {
    const fn = APP.slice(APP.indexOf('async function apPostBill(){'), APP.indexOf('async function apReject('));
    expect([...fn.matchAll(/call\(\{api:'([a-z_]+)'/g)].map((m) => m[1])).toEqual(['ap_post', 'ap_rule_save']);
    expect(postBody(101, { vendor_name: 'TNB' })).toEqual({ api: 'ap_post', id: 101, bill: { vendor_name: 'TNB' } });
  });

  it('every write body REFUSES a missing id rather than acting on whatever is loaded', () => {
    // `AP_ACTIVE_ID` is the only thing binding a Post, a Preview, a Reply or a Reject to a document.
    // A null one posting "the current bill" is a bill filed against another supplier's email.
    for (const f of [() => postBody(null, {}), () => previewBody(null, {}), () => replyBody(null, 's', 'b'), () => rejectBody(null, 'x')]) {
      expect(f).toThrow(/No email selected/);
    }
  });

  it('replyBody() refuses an empty body — an email with no text still reaches the supplier', () => {
    expect(() => replyBody(101, 'Subject', '   ')).toThrow(/Reply body required/);
    expect(replyBody(101, 'Re: bill', 'We need the invoice.')).toEqual({ api: 'ap_reply_send', id: 101, subject: 'Re: bill', body: 'We need the invoice.' });
  });

  it('rejectBody() keeps the legacy default reason rather than sending a blank', () => {
    expect(rejectBody(101, '')).toEqual({ api: 'ap_reject', id: 101, reason: 'manually rejected' });
    expect(rejectBody(101, 'wrong company')).toEqual({ api: 'ap_reject', id: 101, reason: 'wrong company' });
  });

  it('settingsBody() refuses a blank tenant — it would save nobody\'s automation limits', () => {
    expect(() => settingsBody('', {})).toThrow(/Pick a company/);
    expect(settingsBody('t1', { enabled: 'true' })).toEqual({ api: 'ap_settings_save', tenant: 't1', patch: { enabled: 'true' } });
  });

  it('ruleSaveBody() refuses an incomplete rule, and matches apAddRule()\'s own check', () => {
    expect(() => ruleSaveBody('', ['grab'], '903-0100', 200)).toThrow(/required/);
    expect(() => ruleSaveBody('t', [], '903-0100', 200)).toThrow(/required/);
    expect(() => ruleSaveBody('t', ['grab'], '', 200)).toThrow(/required/);
    expect(ruleSaveBody('t', ['grab'], '903-0100', 200)).toEqual({ api: 'ap_rule_save', tenant: 't', keywords: ['grab'], account_code: '903-0100', priority: 200 });
    expect(ruleSaveBody('t', ['grab'], '903-0100', 200, 'taught from bill review').notes).toBe('taught from bill review');
    expect(APP).toContain("notes:'taught from bill review'");
  });

  it('parseKeywords() trims and lowercases — an untrimmed keyword never matches anything', () => {
    expect(parseKeywords(' Grab , TAXI ,, e-hailing ')).toEqual(['grab', 'taxi', 'e-hailing']);
    expect(parseKeywords('')).toEqual([]);
  });

  it('postConfirmText() names the vendor the server will resolve, and the total', () => {
    expect(postConfirmText({ vendor_name: 'TNB', total: 2044 })).toBe('Create Bill in Xero for TNB · Total: RM 2044.00?');
    expect(postConfirmText({})).toBe('Create Bill in Xero for ? · Total: RM 0.00?');
    expect(replyConfirmText('ebill@tnb.com.my')).toBe('Send reply to ebill@tnb.com.my?');
  });
});

describe('collectLines() — where a line silently leaves a real accounting document', () => {
  it('keeps a row with an amount but no description', () => {
    expect(collectLines([{ description: '', unit_amount: 15000, quantity: 1 }])).toEqual([
      { description: '', quantity: 1, unit_amount: 15000, account_code: '' },
    ]);
  });

  it('keeps a row with only a quantity, and drops a wholly blank one', () => {
    expect(collectLines([{ quantity: 2 }])).toHaveLength(1);
    expect(collectLines([{ description: '', quantity: 0, unit_amount: 0 }])).toEqual([]);
    expect(collectLines([{}])).toEqual([]);
  });

  it('coerces to numbers and never to NaN', () => {
    expect(collectLines([{ description: 'x', quantity: '3', unit_amount: '12.50' }])[0])
      .toEqual({ description: 'x', quantity: 3, unit_amount: 12.5, account_code: '' });
    expect(collectLines([{ description: 'x', quantity: 'abc', unit_amount: 'abc' }])[0])
      .toEqual({ description: 'x', quantity: 0, unit_amount: 0, account_code: '' });
  });

  it('preserves ROW ORDER — a bill\'s lines are not a set', () => {
    expect(collectLines([{ description: 'a' }, { description: 'b' }, { description: 'c' }]).map((l) => l.description))
      .toEqual(['a', 'b', 'c']);
  });
});

describe('apDeriveKeyword() — IMPORTED from ap.js, not re-expressed', () => {
  it('is the shared file the browser loads, not a copy in this repo\'s TypeScript', () => {
    // The server stores the derived word verbatim (`ap_rule_save`, finance.ts:1899), so a drifted copy
    // teaches a different Chart-of-Account for every future bill matching it. app.html must load the
    // same file this module imports.
    expect(APP).toContain('<script src="ap.js"></script>');
    expect(SRC).toContain("from '../../ap.js'");
    expect(readFileSync(join(REPO, 'ap.js'), 'utf8')).toContain('function apDeriveKeyword(desc){');
    // And app.html no longer carries its own copy.
    expect(APP).not.toContain('function apDeriveKeyword(desc){');
    expect(APP).toContain('apDeriveKeyword(l.description)');
  });

  it('picks the longest significant word', () => {
    expect(apDeriveKeyword('Grab e-hailing charge')).toBe('hailing');
    expect(apDeriveKeyword('TENAGA NASIONAL electricity')).toBe('electricity');
  });

  it('returns \'\' rather than a junk rule that would match half the ledger', () => {
    // `apPostBill()`'s teach loop skips on '' — so a description of nothing but filler teaches nothing.
    expect(apDeriveKeyword('Invoice for August 2026')).toBe('');
    expect(apDeriveKeyword('')).toBe('');
    expect(apDeriveKeyword(null)).toBe('');
    expect(apDeriveKeyword('the and for fee')).toBe('');
    expect(apDeriveKeyword('ABC 123')).toBe('');   // digit-bearing and too short
  });
});
