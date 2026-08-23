// Finance OS · O2O Billing — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.o2o.html` was captured from `renderO2O()` (app.html:2848) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts,
// tests/parity.ts or tests/handlers.ts. The component is rendered with `renderToStaticMarkup` from the
// SAME fixture the golden was captured from — tests/render_fixtures.ts's COMPANIES, imported directly —
// normalised by the harness's own normalise(), relaxed by the documented layer in ./parity.ts, compared.
//
// NO SEVENTH RELAXATION. This reuses ./parity.ts's six unchanged, which is what nineteen screens have
// now done. Three things that looked like they might need one did not:
//   • the apostrophes in "company's Xero" and "don't post" are written by the legacy as raw `'` and by
//     React's text escaper as `&#x27;` — relaxation R6 already decodes both, and it was added for
//     exactly this;
//   • the company <select> carries `selected` on the FIRST option on both sides (the legacy writes it
//     for the current tenant, React writes it for a controlled value), so they match directly and R5 is
//     not leaned on either;
//   • the two date inputs carry a `value` attribute on both sides — `defaultValue` in JSX renders as
//     `value`, so no rule about "React's controlled spelling" was needed.
//
// ── WHAT THE GOLDEN DOES NOT REACH, and where that is pinned instead ───────────────────────────────
// The golden is the screen BEFORE a workbook is uploaded: `#o2o-out` holds one <p>. So the pharmacy
// cards, the per-SKU line tables, the Xero-contact badges and the results table are all outside the
// diff — and so, more importantly, is every number on this screen. THE ARITHMETIC IS THE INVOICE here:
// `o2o_issue` (finance.ts:626) forwards Quantity / UnitAmount / DiscountRate straight into the Xero
// payload without recomputing anything, so a wrong figure in `o2oParseRows` is a wrong bill sent to a
// real pharmacy. That is why it was lifted into the shared `o2o.js` this file imports (the same file
// app.html now loads) rather than re-expressed, and why the cases below are the bulk of this file.
//
// THE GOLDEN IS NOT AN INTERMEDIATE STATE, and that was CHECKED rather than assumed — `renderQinv()`
// writes its markup and then appends a line row, so Quick Invoice's golden holds an empty list while
// every operator sees one. `renderO2O()` does exactly one thing after its `innerHTML` write,
// `loaded.o2o=true`. A case below reads that out of app.html so it stays true.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CO1, CO2, COMPANIES } from '../../tests/render_fixtures';
import { o2oApplyMasterRate, o2oInvoiceNumbers, o2oParseRows } from '../../o2o.js';
import FinanceO2O, {
  initTenant, isSkindae, issueBody, o2oReachable, plusDaysLocal, previewNums, tenantName, todayLocal,
  type IssueResponse, type O2ODataView,
} from '../src/finance-o2o';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `#o2o` is the tab div `render('o2o')` writes into (app.html:1124ff) — the golden's only section. */
const GOLDEN = goldenSection('finance.o2o', 'o2o');

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');

/**
 * Noon in KUALA LUMPUR on the day the golden was captured (tests/render_harness.ts's FIXED_MS is
 * 2026-08-18T09:30Z, i.e. 17:30 MYT the same day).
 *
 * v224: this used to be `new Date(2026, 7, 18, 12, 0, 0)` — LOCAL parts — because `o2oToday()` read the
 * machine's `getFullYear/getMonth/getDate`. It is now an EPOCH INSTANT, because the function under test
 * is Malaysian and a fixture built from local parts is a different instant in every zone: under
 * TZ=America/New_York the old fixture was 16:00Z, which is already the 19th in Kuala Lumpur, and this
 * file failed. A fixture that moves with the runner cannot test a timezone fix.
 */
const NOW = new Date(Date.parse('2026-08-18T04:00:00.000Z'));

const noop = () => {};

type Props = Parameters<typeof FinanceO2O>[0];

function screen(over: Partial<Props> = {}) {
  return (
    <FinanceO2O
      companies={COMPANIES}
      // `o2oInitTenant()` picks Skindae when the operator has it — COMPANIES[0]. That is what the
      // surface was captured with, and it is why the golden's tenant note is EMPTY.
      tenant={CO1}
      today={todayLocal(NOW)}
      due={plusDaysLocal(NOW, 30)}
      out={{ kind: 'idle' }}
      nums={previewNums('', '', [], 0)}
      canIssue={false}
      openPharmacy={null}
      onTenantChange={noop}
      onResetDates={noop}
      onPreviewNums={noop}
      onPick={noop}
      onIssue={noop}
      onTogglePharmacy={noop}
      onLinkContact={noop}
      onSearchContacts={noop}
      onDownloadPdfs={noop}
      onDismissPdfPanel={noop}
      onAddPharmacy={noop}
      {...over}
    />
  );
}

const rendered = (over: Partial<Props> = {}) => relax(renderToStaticMarkup(screen(over)));

// ── Fixtures for the branches no golden holds ─────────────────────────────────────────────────────

/** A Skindae workbook sheet: two Basic A-3 rows, one Promo B, one unmapped, and a summary block. */
const SKINDAE_SHEET = {
  name: 'GUARDIAN KLCC',
  rows: [
    ['GUARDIAN HEALTH SDN BHD'],
    ['Skindae Overall Billing 21 Apr-20 May 2026'],
    [],
    ['Date', 'Package', 'Price'],
    [45800, 'Basic A-3 Ampoule', 100],
    [45801, 'Basic A-3 Ampoule', 100],
    [45802, 'Promo B Set', 250],
    [45803, 'Mystery Bundle', 60],
    [],
    ['Total Sales', 510],
    ['Billing', 411.92],
  ],
};

const PREVIEW = () => o2oParseRows([SKINDAE_SHEET], true) as O2ODataView;

const ISSUED: IssueResponse = {
  dry_run: false, issued: 2, emailed: 0, failed: 0,
  results: [
    { pharmacy: 'GUARDIAN KLCC', total: 411.92, number: 'SK-2606-001', status: 'issued', contact: 'existing', invoice_id: 'iv-1' },
    { pharmacy: 'CARING BANGSAR', total: 250.5, number: 'SK-2606-002', status: 'issued', contact: 'new', invoice_id: 'iv-2' },
  ],
};

describe('Finance O2O Billing — React vs the legacy golden', () => {
  it('renders the same document as renderO2O() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, in the same order, to the same props', () => {
    assertHandlerParity();
  });

  it('the golden really is what an operator sees — renderO2O() does nothing after its innerHTML write', () => {
    // Quick Invoice's golden is an INTERMEDIATE state because `renderQinv()` calls `qiAddLine()`
    // afterwards. This asserts the equivalent is not true here, out of app.html itself, so a future
    // change that adds an appendChild / .value= / setTimeout after the write fails HERE — where the
    // reason is written down — rather than silently making the golden a lie.
    const fn = APP.slice(APP.indexOf('function renderO2O(){'), APP.indexOf('/* ── O2O billing arithmetic'));
    const tail = fn.slice(fn.lastIndexOf("'<div id=\"o2o-out\""));
    expect(tail).not.toMatch(/appendChild|setTimeout|\.value\s*=|await |\.then\(/);
    expect(tail.replace(/[\s\S]*?;\n/, '').trim()).toBe('loaded.o2o=true;\n}');
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * EVERY handler in this golden is argument-free — `o2oOnTenantChange(this)` and `o2oPick(this)` pass
 * only the element, which `goldenHandlers()` correctly does not count as an identifying argument. So
 * argument parity alone is vacuous here, exactly as it is on hr-profile and finance-recon, and the
 * check that bites is a golden-DERIVED map from the legacy function name to the prop it became.
 *
 * That matters on this screen more than on most: six controls, four of them one click apart, and the
 * two that post are Reset (harmless) and Issue (creates real invoices in a real Xero organisation).
 * A port that wired the Reset button to `onIssue` would look identical in the diff.
 *
 * `identArgs()` is NOT copied here — nothing in this golden identifies a row by a bare integer.
 */
const LEGACY_TO_PROP: Record<string, string> = {
  'o2oOnTenantChange(this)': 'tenant',
  'o2oResetDates()': 'reset',
  'o2oPreviewNums()': 'nums',
  'o2oPick(this)': 'pick',
  'o2oIssue()': 'issue',
};

const propFor = (raw: string) => LEGACY_TO_PROP[raw] ?? raw;

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

  const got = reactHandlers(screen({
    onTenantChange: record('tenant') as never,
    onResetDates: record('reset') as never,
    onPreviewNums: record('nums') as never,
    onPick: record('pick') as never,
    onIssue: record('issue') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard: with no golden handler carrying an argument, the args comparison above passes
  // vacuously, so the identity half has to be the one that bites — and it only does while every golden
  // handler name is one LEGACY_TO_PROP knows. A new button in app.html falls through `?? raw` and fails
  // here rather than passing silently.
  expect(want.length).toBe(6);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

describe('the comparison still bites', () => {
  const want = relax(GOLDEN);

  it('catches a company dropped out of, or added to, the picker', () => {
    expect(rendered({ companies: COMPANIES.slice(0, 1) })).not.toBe(want);
    expect(rendered({ companies: [...COMPANIES, { tenant_id: 'x', tenant_name: 'OTHER' }] })).not.toBe(want);
  });

  it('catches a company option whose VALUE moved to the other tenant', () => {
    // The label still reads SKINDAE; the invoices would be posted into I PROCARE's Xero — another
    // company's ledger, under another company's contacts. An attribute value, which nothing in relax()
    // touches.
    expect(rendered({ companies: [{ ...COMPANIES[0], tenant_id: CO2 }, COMPANIES[1]] })).not.toBe(want);
  });

  it('catches the selected tenant moving to the other company', () => {
    // Two things change at once and both matter: the `selected` mark moves off the first option (R5
    // leaves it alone, by construction), and the tenant note appears because the target is no longer
    // Skindae — which is the operator's only warning that SKU codes will not be sent.
    expect(rendered({ tenant: CO2 })).not.toBe(want);
  });

  it('catches the non-Skindae warning going missing when it is due', () => {
    // The reverse of the above, stated on its own: with I PROCARE selected the note MUST render.
    const html = renderToStaticMarkup(screen({ tenant: CO2 }));
    expect(html).toContain('Non-Skindae target');
    expect(html).toContain('SKO2OB3');
    expect(renderToStaticMarkup(screen())).not.toContain('Non-Skindae target');
  });

  it('catches either date shifting by a day', () => {
    // The invoice date and the due date go straight to Xero (finance.ts:643-644) and the due date is
    // what a pharmacy is chased against. `plusDaysLocal(NOW,30)` is the legacy's own +30d.
    expect(rendered({ today: '2026-08-19' })).not.toBe(want);
    expect(rendered({ due: '2026-09-18' })).not.toBe(want);
    expect(rendered({ due: plusDaysLocal(NOW, 60) })).not.toBe(want);
  });

  it('catches Test mode losing its default check — the difference between a preview and a live post', () => {
    // `o2oIssue()` reads this checkbox and sends `dry_run`. Unchecked by default means the FIRST click
    // of Issue creates real invoices in a real Xero organisation.
    const off = renderToStaticMarkup(screen()).replace(' checked=""', '');
    expect(relax(off)).not.toBe(want);
  });

  it('catches the Issue button starting enabled', () => {
    // `renderO2O()` writes it `disabled`; only a successful preview enables it. Enabled with no data
    // loaded is a POST of an empty batch at best.
    expect(rendered({ canIssue: true })).not.toBe(want);
  });

  it('catches the numbering hint changing', () => {
    expect(rendered({ nums: previewNums('SK-', '001', o2oInvoiceNumbers(3, 'SK-', '001'), 3) })).not.toBe(want);
    expect(rendered({ nums: previewNums('', 'abc', null, 0) })).not.toBe(want);
  });

  it('catches the preview or the results appearing — branches no golden holds', () => {
    expect(rendered({ out: { kind: 'preview', data: PREVIEW() } })).not.toBe(want);
    expect(rendered({ out: { kind: 'issued', res: ISSUED, downloadable: [], failures: null, downloaded: 0 } })).not.toBe(want);
    expect(rendered({ out: { kind: 'error', message: 'Parse failed: boom' } })).not.toBe(want);
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────

  it('catches Reset wired to the Issue action', () => {
    // The one that costs real money on this screen: the two buttons sit in the same panel, and a diff
    // of the markup cannot tell them apart because R1 strips both handlers.
    expect(() => assertHandlerParity({ onResetDates: (() => misfire()) as never })).toThrow();
  });

  it('catches the file input and the company select swapping handlers', () => {
    expect(() => assertHandlerParity({
      onPick: (() => misfire()) as never,
    })).toThrow();
  });

  it('catches a handler handed an argument it never had', () => {
    expect(() => assertHandlerParity({ onIssue: (() => misfire('o2o-issue')) as never })).toThrow(/deeply equal/);
  });

  it('carries handlers on exactly the six controls the golden carries them on', () => {
    expect(reactHandlers(screen()).map((h) => h.attr))
      .toEqual(['onchange', 'onclick', 'oninput', 'oninput', 'onchange', 'onclick']);
    expect(goldenHandlers(GOLDEN).map((h) => h.attr))
      .toEqual(['onchange', 'onclick', 'oninput', 'oninput', 'onchange', 'onclick']);
  });

  it('keeps the legacy element ids the route and o2oIssue() read the form back out of', () => {
    // Extracted from app.html at run time rather than retyped: these ids ARE the contract between the
    // markup and the code that posts. An input that lost one posts a blank date, a blank prefix, or —
    // for `o2o-test` — a `dry` that defaults elsewhere.
    const issue = APP.slice(APP.indexOf('async function o2oIssue(){'), APP.indexOf('/* ---- Quick Invoice ---- */'));
    const nums = APP.slice(APP.indexOf('function o2oBuildInvoiceNumbers(count){'), APP.indexOf('function o2oPreviewNums(){'));
    const ids = [...new Set([...(issue + nums).matchAll(/getElementById\('(o2o[-_a-z]+)'\)/g)].map((m) => m[1]))];
    expect(ids).toEqual(expect.arrayContaining(['o2o-test', 'o2o-invdate', 'o2o-duedate', 'o2o-invprefix', 'o2o-invstart']));
    const html = renderToStaticMarkup(screen());
    for (const id of ids) expect(html).toContain(`id="${id}"`);
  });
});

describe('the feature gate — app.html:1434', () => {
  // The withheld direction, asserted. `renderO2O()` has no role check; `showApp()` falls O2O through to
  // `feats.indexOf(t)<0`, so it is the FEATURE list that decides — not `manage_users`, which is what
  // gates the seven admin-only tabs above it in the same chain.
  it('opens for a user whose features include o2o', () => {
    expect(o2oReachable({ features: ['overview', 'pnl', 'o2o'] })).toBe(true);
  });

  it('is closed for every other shape of permission, including a missing one', () => {
    for (const p of [null, undefined, {}, { features: [] }, { features: null }, { features: ['overview', 'pnl'] }]) {
      expect(o2oReachable(p as never)).toBe(false);
    }
  });

  it('is NOT the manage_users gate — an admin without the feature is still out', () => {
    // The mistake this catches is copying a neighbour's line. `wht`, `selfbill`, `gateway`, `bankfeed`
    // and `salesrecon` are all `!canManage`; O2O sits in none of those branches. Using `manage_users`
    // would both over-grant (every admin, including ones deliberately left off the list) and
    // under-grant (the billing staff who actually run this, who are not admins).
    expect(o2oReachable({ manage_users: true } as never)).toBe(false);
  });

  it('is the real line — app.html names o2o in none of showApp()\'s branches', () => {
    // Read out of app.html so the claim above cannot go stale: if someone adds an `else if(t==='o2o')`
    // branch, the predicate here stops mirroring the app and this fails.
    const block = APP.slice(APP.indexOf("document.querySelectorAll('.tab').forEach"), APP.indexOf("// Hide any category whose sub-tabs"));
    expect(block).not.toMatch(/t\s*===\s*'o2o'/);
    expect(block).toContain("else el.classList.toggle('hide', feats.indexOf(t)<0);");
  });

  it('is what the route gates on — the screen renders tenant ids, pharmacy names and money', () => {
    // Guard the guard: if the fixture stopped carrying the things the gate protects, the assertions
    // above would be about nothing.
    const html = renderToStaticMarkup(screen({ out: { kind: 'preview', data: PREVIEW() }, openPharmacy: 0 }));
    expect(html).toContain(CO1);                    // a tenant id, postable straight to o2o_issue
    expect(html).toContain('GUARDIAN HEALTH SDN BHD');
    expect(html).toContain('SKO2OB3');              // the Skindae SKU
    expect(html).toContain('RM 412.08');            // what the pharmacy is billed
  });
});

describe('the parse — every number on this screen, and none of them in a golden', () => {
  // `o2oParseRows` is the shared o2o.js this migration lifted the arithmetic into. These cases are
  // about the INVOICE, not about markup: `o2o_issue` forwards Quantity / UnitAmount / DiscountRate to
  // Xero verbatim (finance.ts:658-661), so each of these getting it wrong is a real bill for the wrong
  // amount.
  const d = () => o2oParseRows([SKINDAE_SHEET], true);

  it('groups Skindae rows by SKU — quantity is the ROW COUNT, unit price is the row price', () => {
    const basic = d().pharmacies[0].lines.find((l) => l.item_code === 'SKO2OB3')!;
    expect(basic).toMatchObject({ item_code: 'SKO2OB3', quantity: 2, unit_price: 100, discount_rate: 19.2 });
    // 200 gross less 19.2% = 161.60, to the sen.
    expect(basic.amount).toBe(161.6);
  });

  it('BILLS a row that matches no SKU rather than dropping it', () => {
    // The defect this replaced under-billed the pharmacy for everything it actually sold. The row is
    // billed at its raw Excel price with the Package text as the description, and surfaced as unmapped.
    const p = d().pharmacies[0];
    const raw = p.lines.find((l) => l.package === 'Mystery Bundle')!;
    expect(raw.item_code).toBeNull();
    expect(raw.quantity).toBe(1);
    expect(raw.unit_price).toBe(60);
    expect(p.unmatched.map((u) => u.pkg)).toEqual(['Mystery Bundle']);
  });

  it('refuses a summary row as an invoice line — the date guard', () => {
    // Total Sales / Commission / Insurans / Billing sit under the data and carry a label plus a number.
    // Without the guard they become billable lines and OVER-bill. `510` and `411.92` are in the sheet
    // above; neither may appear as a unit price.
    const p = d().pharmacies[0];
    expect(p.lines.map((l) => l.unit_price)).toEqual([100, 250, 60]);
    expect(p.lines.some((l) => /total|billing|commission|insurans/i.test(l.package))).toBe(false);
  });

  it('rejects a row whose Date column holds a rate rather than a date', () => {
    // 0.192 in the Date column is the commission rate on the summary block, not 1970-01-01.
    const sheet = { ...SKINDAE_SHEET, rows: [...SKINDAE_SHEET.rows, [0.192, 'Commission', 98.08]] };
    expect(o2oParseRows([sheet], true).pharmacies[0].lines).toHaveLength(3);
  });

  it('totals: gross before commission, billed after, and the difference to the sen', () => {
    const p = d().pharmacies[0];
    expect(p.total_sales).toBe(510);          // 100+100+250+60
    expect(p.total).toBe(412.08);             // each line discounted 19.2% AND ROUNDED, then summed
    expect(p.commission).toBe(97.92);
    expect(d().grand_total).toBe(412.08);
  });

  it('rounds EACH LINE to the sen and then SUMS — it never discounts the gross', () => {
    // The header total is the sum of the ROUNDED line amounts, not the rounded discount of the gross.
    // On the sheet above the two agree (510 × 0.808 is exactly 412.08), which is precisely why this
    // case also uses prices where they do NOT — 50.01 and 50.02 give 40.41 + 40.42 = 80.83 per line,
    // and 80.82 from the gross.
    //
    // Only one of those is what the pharmacy receives: `o2o_issue` forwards the LINE figures and Xero
    // re-totals the invoice from them (finance.ts:658-661), so the per-line answer is the invoice and
    // the header must agree with it. A port that "simplified" this into one gross calculation would
    // show a preview total the issued invoice disagreed with, by a sen or two, every month — small
    // enough to be dismissed as a rounding quirk and never chased.
    const p = d().pharmacies[0];
    expect(p.lines.map((l) => l.amount)).toEqual([161.6, 202, 48.48]);
    expect(Math.round(p.lines.reduce((s, l) => s + (l.amount || 0), 0) * 100) / 100).toBe(p.total);

    const odd = o2oParseRows([{
      name: 'ODD', rows: [['ODD PHARMACY'], ['Skindae Overall Billing 21 Apr-20 May 2026'], [],
        ['Date', 'Package', 'Price'], [45800, 'Basic A-3', 50.01], [45801, 'Promo B', 50.02]],
    }], true).pharmacies[0];
    expect(odd.lines.map((l) => l.amount)).toEqual([40.41, 40.42]);
    expect(odd.total).toBe(80.83);
    expect(odd.total).not.toBe(Math.round(odd.total_sales * (1 - 19.2 / 100) * 100) / 100);  // 80.82
    expect(odd.commission).toBe(Math.round((odd.total_sales - odd.total) * 100) / 100);
  });

  it('groups by Package + price in Package mode, and emits no SKU code', () => {
    // A non-Skindae target: SKO2OB3 and friends are Skindae-only inventory items in Xero, so the
    // Package text becomes the description instead.
    const p = o2oParseRows([SKINDAE_SHEET], false).pharmacies[0];
    expect(p.lines.every((l) => l.item_code === null)).toBe(true);
    expect(p.lines.map((l) => l.package)).toEqual(['Basic A-3 Ampoule', 'Promo B Set', 'Mystery Bundle']);
    expect(p.lines[0].quantity).toBe(2);
    expect(p.total).toBe(412.08);             // the same money, described differently
  });

  it('falls back to a single Total-Sales line plus a commission line when there is no data section', () => {
    const sheet = { name: 'CARING', rows: [['CARING BANGSAR'], ['Skindae Overall Billing 21 Apr-20 May 2026'], [], ['Total Sales', 1000], ['Billing', 808]] };
    const p = o2oParseRows([sheet], true).pharmacies[0];
    expect(p.fallback).toBe(true);
    expect(p.lines).toEqual([
      { package: 'Skindae products (21/04/2026 - 20/05/2026)', unit_price: 1000, quantity: 1, amount: 1000 },
      { package: 'Commission -19.2%', unit_price: -192, quantity: 1, amount: -192 },
    ]);
    expect(p.total).toBe(808);
  });

  it('skips the "sample" sheet, whatever its casing', () => {
    expect(o2oParseRows([{ name: 'Sample', rows: SKINDAE_SHEET.rows }], true).pharmacy_count).toBe(0);
  });

  it('formats the Xero Reference from the period, and keeps the raw text when it cannot', () => {
    // This string is what the pharmacy reads to know which month it is being billed for.
    expect(d().reference).toBe('O2O Sales 21/04/2026 - 20/05/2026');
    const odd = { name: 'X', rows: [['X'], ['some other wording'], [], ['Total Sales', 10], ['Billing', 10]] };
    expect(o2oParseRows([odd], true).reference).toBe('O2O Sales some other wording');
  });
});

describe('a master commission rate overrides 19.2% — or must not', () => {
  it('re-prices EVERY line, not just the header', () => {
    // The defect this replaced relabelled `discount_rate` while `amount` stayed at the 19.2% figure, so
    // the invoice showed one rate and billed another.
    const p = PREVIEW().pharmacies[0];
    expect(o2oApplyMasterRate(p, 25)).toBe(true);
    expect(p.lines.every((l) => l.discount_rate === 25)).toBe(true);
    expect(p.total_sales).toBe(510);
    expect(p.commission).toBe(127.5);
    expect(p.total).toBe(382.5);
    expect(Math.round(p.lines.reduce((s, l) => s + (l.amount || 0), 0) * 100) / 100).toBe(382.5);
  });

  it('a BLANK or missing master rate falls back to 19.2% — it does not zero the discount', () => {
    // `Number('') === 0` would leave the pharmacy invoiced at full gross price: 510 instead of 411.92.
    for (const raw of ['', null, undefined, 'n/a', 0, -5, 19.2]) {
      const p = PREVIEW().pharmacies[0];
      expect(o2oApplyMasterRate(p, raw)).toBe(false);
      expect(p.total).toBe(412.08);
      expect(p.lines[0].discount_rate).toBe(19.2);
    }
  });
});

describe('invoice numbering — three states that must not collapse into two', () => {
  it('empty fields mean "let Xero number them"', () => {
    expect(o2oInvoiceNumbers(3, '', '')).toEqual([]);
    expect(o2oInvoiceNumbers(3, '   ', '  ')).toEqual([]);
  });

  it('a non-digit start is NULL — not an empty list', () => {
    // The one that matters: `[]` posts an unnumbered batch, so collapsing `null` into it silently
    // ignores what the operator typed and lets Xero number invoices they meant to control.
    expect(o2oInvoiceNumbers(3, 'SK-', 'abc')).toBeNull();
    expect(o2oInvoiceNumbers(3, 'SK-', '1a')).toBeNull();
    expect(o2oInvoiceNumbers(3, 'SK-2606-', '')).toBeNull();   // prefix without a start
  });

  it('zero-pads to the literal width the operator typed, and increments', () => {
    expect(o2oInvoiceNumbers(3, 'SK-2606-', '001')).toEqual(['SK-2606-001', 'SK-2606-002', 'SK-2606-003']);
    expect(o2oInvoiceNumbers(3, '', '1183')).toEqual(['1183', '1184', '1185']);
    expect(o2oInvoiceNumbers(2, 'X', '9')).toEqual(['X9', 'X10']);   // overflows the pad rather than truncating
  });

  it('the hint under the fields says what will actually be generated', () => {
    expect(previewNums('', '', [], 0)).toEqual({ error: false, text: 'Leave empty → Xero auto-generates' });
    expect(previewNums('SK-', 'abc', null, 3).error).toBe(true);
    expect(previewNums('SK-', '001', o2oInvoiceNumbers(3, 'SK-', '001'), 3))
      .toEqual({ error: false, range: ['SK-001', 'SK-003'], count: 3 });
    expect(previewNums('SK-', '001', o2oInvoiceNumbers(1, 'SK-', '001'), 0))
      .toEqual({ error: false, start: 'SK-001' });
  });
});

describe('the POST body — what actually reaches Xero', () => {
  const base = () => ({
    tenant: CO1, data: PREVIEW(), invoiceDate: '2026-08-18', dueDate: '2026-09-17',
    dryRun: true, invNums: [] as string[], skindae: true,
  });

  it('carries the tenant, the dates, the reference and the period the operator is looking at', () => {
    const b = issueBody(base());
    expect(b).toMatchObject({
      api: 'o2o_issue', tenant: CO1, invoice_date: '2026-08-18', due_date: '2026-09-17',
      dry_run: true, send_email: false, reference: 'O2O Sales 21/04/2026 - 20/05/2026',
    });
  });

  it('refuses to build a body with no company — it does not default to the first one', () => {
    // A batch posted into the wrong Xero organisation invoices the wrong customers from the wrong
    // ledger, and every line on the preview would have looked correct.
    expect(() => issueBody({ ...base(), tenant: '' })).toThrow(/Pick a company/);
  });

  it('KEEPS ItemCode for a Skindae target and STRIPS it for every other', () => {
    const skin = issueBody(base()).invoices as { lines: { item_code?: string | null }[] }[];
    expect(skin[0].lines.some((l) => l.item_code === 'SKO2OB3')).toBe(true);
    const other = issueBody({ ...base(), tenant: CO2, skindae: false }).invoices as { lines: Record<string, unknown>[] }[];
    expect(other[0].lines.every((l) => !('item_code' in l))).toBe(true);
    // …and stripping must not disturb anything else on the line.
    expect(other[0].lines[0]).toMatchObject({ package: 'SKINDAE CELL LIFT, NMN AMPOULE 30ML - BASIC A-3', quantity: 2, unit_price: 100, discount_rate: 19.2, amount: 161.6 });
  });

  it('attaches invoice numbers BY POSITION, over the pharmacies in preview order', () => {
    const data = PREVIEW();
    data.pharmacies.push({ ...data.pharmacies[0], pharmacy: 'CARING BANGSAR' });
    data.pharmacy_count = 2;
    const invs = issueBody({ ...base(), data, invNums: ['SK-001', 'SK-002'] }).invoices as { pharmacy: string; invoice_number: string }[];
    expect(invs.map((i) => [i.pharmacy, i.invoice_number])).toEqual([
      ['GUARDIAN HEALTH SDN BHD', 'SK-001'], ['CARING BANGSAR', 'SK-002'],
    ]);
  });

  it('attaches NO invoice_number when the operator left the fields empty', () => {
    const invs = issueBody(base()).invoices as Record<string, unknown>[];
    expect('invoice_number' in invs[0]).toBe(false);
  });

  it('passes dry_run straight through — live is only ever an explicit false', () => {
    expect(issueBody(base()).dry_run).toBe(true);
    expect(issueBody({ ...base(), dryRun: false }).dry_run).toBe(false);
  });

  it('sends the parsed lines untouched — no rounding, no re-ordering, no re-grouping', () => {
    // The server does not recompute (finance.ts:658-661). Whatever is in these lines IS the invoice.
    const data = PREVIEW();
    const invs = issueBody({ ...base(), data }).invoices as { lines: unknown }[];
    expect(invs[0].lines).toBe(data.pharmacies[0].lines);
  });
});

describe('the preview and the results — what an operator reads before and after posting', () => {
  const html = renderToStaticMarkup(screen({ out: { kind: 'preview', data: PREVIEW() }, openPharmacy: 0 }));

  it('shows the pharmacy count, the grand total and the reference', () => {
    expect(html).toContain('>1</div><div class="l">Pharmacies</div>');
    expect(html).toContain('RM 412.08');
    expect(html).toContain('O2O Sales 21/04/2026 - 20/05/2026');
  });

  it('shows gross, commission and billed on the pharmacy header — all three, distinctly', () => {
    // The operator checks the three against the Excel. Showing the same figure twice, or dropping the
    // commission, is how a wrong discount ships unnoticed.
    expect(html).toContain('Full RM 510.00');
    expect(html).toContain('-RM 97.92');
    expect(html).toContain('<b>RM 412.08</b>');
  });

  it('warns that unmapped rows were BILLED, and names them', () => {
    expect(html).toContain('billed at their Excel price');
    expect(html).toContain('Mystery Bundle');
  });

  it('renders one line row per parsed line, in parse order, with the SKU pill', () => {
    const descs = [...html.matchAll(/<td>(?:<span[^>]*>([^<]*)<\/span>)?([^<]*)<\/td>/g)].map((m) => (m[1] || '') + m[2]);
    expect(descs).toContain('SKO2OB3SKINDAE CELL LIFT, NMN AMPOULE 30ML - BASIC A-3');
    expect(descs).toContain('SKO2OPBSKINDAE CELL LIFT, NMN AMPOULE 30ML - PROMO B');
    expect(descs).toContain('Mystery Bundle');
  });

  it('keeps a collapsed block collapsed — the expanded one is the one the operator opened', () => {
    const shut = renderToStaticMarkup(screen({ out: { kind: 'preview', data: PREVIEW() }, openPharmacy: null }));
    expect(shut).toContain('display:none;padding:0 14px 12px');
    expect(html).toContain('display:block;padding:0 14px 12px');
  });

  it('shows a Xero-contact suggestion as a SUGGESTION, never applied', () => {
    // A wrong contact invoices the wrong customer. The legacy shows the candidates and makes the
    // operator pick; a port that auto-linked the top score would be a silent behaviour change.
    const data = PREVIEW();
    data.pharmacies[0].__xero = { status: 'suggest', suggestions: [{ contact_id: 'c1', name: 'GUARDIAN HEALTH', score: 0.91 }] };
    const h = renderToStaticMarkup(screen({ out: { kind: 'preview', data }, openPharmacy: 0 }));
    expect(h).toContain('❓ confirm contact');
    expect(h).toContain('GUARDIAN HEALTH');
    expect(h).toContain('91%');
  });

  it('renders the results table positionally — a pharmacy keeps its OWN invoice number', () => {
    // `results[i]` is `invoices[i]` is `pharmacies[i]` (finance.ts:679). Sorting this table would print
    // one pharmacy's invoice number against another's name, and both would look plausible.
    const h = renderToStaticMarkup(screen({ out: { kind: 'issued', res: ISSUED, downloadable: [], failures: null, downloaded: 0 } }));
    expect(h.indexOf('SK-2606-001')).toBeGreaterThan(h.indexOf('GUARDIAN KLCC'));
    expect(h.indexOf('SK-2606-002')).toBeGreaterThan(h.indexOf('CARING BANGSAR'));
    expect(h.indexOf('CARING BANGSAR')).toBeGreaterThan(h.indexOf('SK-2606-001'));
    expect(h).toContain('⚠ new');       // CARING's contact was created, which the operator must see
    expect(h).toContain('✓ existing');
  });

  it('offers the PDF ZIP only when a LIVE post produced invoice ids', () => {
    // A dry run has no invoice_id, so there is nothing to fetch. Showing the button anyway would send
    // the operator to Xero for invoices that were never created.
    const dry: IssueResponse = { ...ISSUED, dry_run: true, results: ISSUED.results!.map((r) => ({ ...r, status: 'dry_run', invoice_id: undefined })) };
    expect(renderToStaticMarkup(screen({ out: { kind: 'issued', res: dry, downloadable: [], failures: null, downloaded: 0 } })))
      .not.toContain('id="o2o-dl"');
    expect(renderToStaticMarkup(screen({ out: { kind: 'issued', res: ISSUED, downloadable: [{ invoice_id: 'iv-1', pharmacy: 'GUARDIAN KLCC' }], failures: null, downloaded: 0 } })))
      .toContain('id="o2o-dl"');
  });

  it('lists the PDFs that failed, and offers a retry for just those', () => {
    const h = renderToStaticMarkup(screen({
      out: { kind: 'issued', res: ISSUED, downloadable: [{ invoice_id: 'iv-1', pharmacy: 'GUARDIAN KLCC' }], failures: [{ pharmacy: 'CARING BANGSAR', error: 'timeout' }], downloaded: 1 },
    }));
    expect(h).toContain('1 PDF failed · 1 downloaded');
    expect(h).toContain('CARING BANGSAR');
    expect(h).toContain('timeout');
    expect(h).toContain('Retry failed only');
  });
});

describe('the small pure helpers the route leans on', () => {
  it('initTenant prefers Skindae, keeps a still-valid choice, and copes with an empty list', () => {
    expect(initTenant(COMPANIES, null)).toBe(CO1);
    expect(initTenant([COMPANIES[1], COMPANIES[0]], null)).toBe(CO1);   // Skindae wherever it is
    expect(initTenant([COMPANIES[1]], null)).toBe(CO2);                 // no Skindae → first allowed
    expect(initTenant(COMPANIES, CO2)).toBe(CO2);                       // an explicit choice stands
    expect(initTenant(COMPANIES, 'gone')).toBe(CO1);                    // a stale one does not
    expect(initTenant([], null)).toBeNull();
  });

  it('isSkindae and tenantName read the company the operator picked', () => {
    expect(isSkindae(COMPANIES, CO1)).toBe(true);
    expect(isSkindae(COMPANIES, CO2)).toBe(false);
    expect(isSkindae(COMPANIES, null)).toBe(false);
    expect(tenantName(COMPANIES, CO2)).toBe('I PROCARE MALAYSIA SDN BHD');
    expect(tenantName(COMPANIES, null)).toBe('the selected company');   // the legacy's own fallback
  });

  it('the dates are MALAYSIAN, a pure function of the instant handed in, and roll over months', () => {
    expect(todayLocal(NOW)).toBe('2026-08-18');
    expect(plusDaysLocal(NOW, 30)).toBe('2026-09-17');
    expect(plusDaysLocal(new Date(Date.parse('2026-12-20T04:00:00Z')), 30)).toBe('2027-01-19');   // year roll-over
    expect(todayLocal(new Date(Date.parse('2026-01-05T04:00:00Z')))).toBe('2026-01-05');          // zero-padded
    // v224, and the case the whole change is for: 23:30Z is 07:30 the NEXT day in Kuala Lumpur. The old
    // machine-zone `o2oToday()` dated this batch 31 August for anyone west of Greenwich, and
    // `o2o_issue` (finance.ts:626) forwards that date into a real Xero ledger without recomputing it.
    const earlyMytFirst = new Date(Date.parse('2026-08-31T23:30:00.000Z'));
    expect(todayLocal(earlyMytFirst)).toBe('2026-09-01');
    expect(plusDaysLocal(earlyMytFirst, 30)).toBe('2026-10-01');
  });
});

/* ══ The double-submit guard ═══════════════════════════════════════════════════════════════════════
 *
 * `o2o_issue` (finance.ts:609) has no idempotency key and no dedupe, so a second click is a SECOND set
 * of real Xero invoices, one per pharmacy. The legacy never had the hole: `o2oIssue()` wraps the call in
 * `runOnce('o2o-issue','Issuing…')` (app.html:3172), which disables the button for the duration and
 * restores it in `finally`.
 *
 * Two halves, and the second is the one a golden cannot see. The component half is drivable — a false
 * `canIssue` must actually emit `disabled`. The ROUTE half is what decides when `canIssue` is false, and
 * there is no output to assert it through (the page is a client component and vitest runs `environment:
 * 'node'`), so it is pinned by SOURCE — `finance.calendar`'s rule, and `hr-emp-leave`'s treatment of a
 * route. Comments are blanked first: the paragraph above names `runOnce` while explaining the bug, and
 * a scan of raw source would match the prose and pass on a route that dropped the guard.
 */
describe('the Issue button cannot be clicked twice into two batches of real invoices', () => {
  const ROUTE = readFileSync(join(REPO, 'web/app/finance/o2o/page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('renders the button disabled whenever canIssue is false', () => {
    const off = renderToStaticMarkup(screen({ canIssue: false }));
    expect(off).toMatch(/<button[^>]*id="o2o-issue"[^>]*disabled=""/);
    // And enabled when it is true, so the assertion above is about the prop and not about the markup
    // always carrying the attribute.
    expect(renderToStaticMarkup(screen({ canIssue: true }))).not.toMatch(/id="o2o-issue"[^>]*disabled/);
  });

  it('the route clears canIssue while the POST is in flight', () => {
    // Not just "a flag exists" — the flag must be part of what canIssue is, or the button stays live.
    expect(ROUTE).toMatch(/canIssue=\{[^}]*!issuing[^}]*\}/);
  });

  it('the route sets the flag before the call and clears it in finally', () => {
    const at = ROUTE.indexOf('const onIssue');
    expect(at).toBeGreaterThan(-1);
    const body = ROUTE.slice(at, ROUTE.indexOf('const onDownloadPdfs', at));
    const lock = body.indexOf('setIssuing(true)');
    const post = body.indexOf('issueBody(');
    expect(lock).toBeGreaterThan(-1);
    // Locked BEFORE the request goes out, not after it resolves — the window the whole finding is about.
    expect(lock).toBeLessThan(post);
    // Released in `finally`, so one network error does not strand the operator on a dead button.
    expect(body).toMatch(/finally\s*\{[^}]*setIssuing\(false\)/);
    // And the handler itself refuses a re-entry, belt and braces over the attribute — salesrecon's
    // `if (posting)` and Quick Invoice's `if (busy)`, the two screens this one is matched to.
    expect(body).toMatch(/if\s*\(issuing\)\s*return/);
  });
});
