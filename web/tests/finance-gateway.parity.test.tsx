// Finance OS · Gateway → Xero — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.gateway.html` was captured from `renderGateway()` (app.html:3769) by the
// 40-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts, tests/parity.ts or tests/handlers.ts.
//
// NO SEVENTH RELAXATION. This reuses ./parity.ts's six unchanged, which is what thirty screens
// have now done. Nothing on this screen needed a screen-local rule either — the one `&` in the header
// blurb is written `&amp;` by the legacy string AND by React's text escaper, and every other special
// character on the screen (🔁 ⬇ ↑ ↓ · − → ✓ ⚠) is a literal character on both sides, not a reference.
//
// ── THE GOLDEN IS TWO SECTIONS, AND THE FIRST IS AN INTERMEDIATE STATE ─────────────────────────────
// Both facts are PROVEN below out of app.html's own text rather than asserted, because they decide what
// this file is allowed to compare. See src/finance-gateway.tsx's header for the full list of what
// `gwSetProv('payex')` mutates after the innerHTML write.
//
// ── FOUR GATEWAYS, ONE MODE IN THE GOLDEN ──────────────────────────────────────────────────────────
// The four provider buttons are four MODES of this screen. The golden covers Payex, at t=0, with no
// files loaded and `#gw-result` hidden. Atome, HitPay and NTT Data — and the loaded state of all four,
// which is every figure the screen exists to produce — are outside the diff and are pinned here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  gwConvertRows, gwCSV, gwNewAudit, gwOutName,
  type GwAudit, type GwFiles, type GwProvider, type GwRow,
} from '../../gateway.js';
import FinanceGateway, {
  chipBFile, chipBTitle, convertDisabled, downloadRows, dropTitle, gatewayReachable, GW_PROVIDERS,
  type GwResult,
} from '../src/finance-gateway';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');

/** `#gateway` is the tab div `render('gateway')` writes into — the golden's first section. */
const GOLDEN = goldenSection('finance.gateway', 'gateway');
/** `#gw-ref` is `gwSetProv()`'s own innerHTML write, recorded as its own section by the harness. */
const GOLDEN_REF = goldenSection('finance.gateway', 'gw-ref');

const noop = () => {};

type Props = Parameters<typeof FinanceGateway>[0];

function screen(over: Partial<Props> = {}) {
  return (
    <FinanceGateway
      // `null` is the t=0 frame: `renderGateway()` has written its markup and `gwSetProv('payex')` has
      // not run yet. The route always passes a real provider — see the "intermediate state" block below.
      provider={null}
      files={null}
      result={null}
      onProvider={noop}
      onReset={noop}
      onBrowse={noop}
      onConvert={noop}
      onDownload={noop}
      {...over}
    />
  );
}

const rendered = (over: Partial<Props> = {}) => relax(renderToStaticMarkup(screen(over)));

/** The innerHTML of one element of a React render — the same slice the harness records per id. */
function innerOf(html: string, id: string, tag: string): string {
  const at = html.indexOf(`id="${id}"`);
  expect(at).toBeGreaterThan(-1);
  const open = html.indexOf('>', at) + 1;
  return html.slice(open, html.indexOf(`</${tag}>`, open));
}

// ── FIXTURES ────────────────────────────────────────────────────────────────────────────────────────
// Raw export rows, in the shape `XLSX.utils.sheet_to_json` hands the converters. Deliberately small and
// deliberately awkward: two rows on one settlement date, a refund, a zero, a row with no date.

const PAYEX_TXN = [
  { Date: '01/07/2026', Amount: 1000, RefundAmount: 0, TransactionId: 'PX1', ReferenceNumber: 'R1', CustomerName: 'GUARDIAN HEALTH', TransactionType: 'fpx', SettlementDate: '02/07/2026' },
  { Date: '01/07/2026', Amount: 250.55, RefundAmount: 0.55, TransactionId: 'PX2', ReferenceNumber: 'R2', CustomerName: '', TransactionType: 'card', SettlementDate: '' },
  { Date: '', Amount: 99, RefundAmount: 0, TransactionId: 'PX3', CustomerName: 'NO DATE' },
  { Date: '03/07/2026', Amount: 40, RefundAmount: 40, TransactionId: 'PX4', CustomerName: 'ZERO' },
];
const PAYEX_SET = [
  { SettlementDate: '02/07/2026', NetPayex: 600, NetOthers: 0, MDR: 12, SettledBy: 'Payex' },
  { SettlementDate: '02/07/2026', NetPayex: 0, NetOthers: 400, MDR: 8, SettledBy: 'Others' },
];

const ATOME_TXN = [
  { 'Transaction Time': '2026-07-01 10:00:00', 'Transaction Amount': 300, 'Atome Order ID': 'AO1', "Customer's Payment Plan": '3 months' },
];
const ATOME_PAYOUT = [
  { 'Payout Date': '2026-07-05', 'Payout Amount': 270, 'Total Sales': 300, 'All Atome Fees': -28, 'All Atome Fees SST': -2, 'All Rebates': 0, 'All Rebates SST': 0 },
];

const HITPAY_TXN = [
  { 'Completed Date': '2026-07-01', 'Converted Amount in MYR': 200, 'Refunded Amount': 0, 'All Inclusive Fee Amount in MYR': 4, ID: 'HP1', 'Order ID': 'O1', 'Payment Details': 'PayNow' },
];
const HITPAY_PAYOUT = [{ 'Payout Date': '2026-07-03', 'Net Payout Amount': 196 }];

const NTT_TXN = [
  { tx_create_date: '2026-07-01', tx_amount: 500, merchant_mdr_amount: -10, net_amount: 490, product_commission_amount: 0, vat_amount: 0, gateway_tx_id: "'NT1", mah_ref: 'M1', product_itemname: 'DuitNow QR/EDC' },
];

const FILES: Record<GwProvider, GwFiles> = {
  payex: { txn: { name: 'px-txn.xlsx', rows: PAYEX_TXN }, set: { name: 'px-set.xlsx', rows: PAYEX_SET } },
  atome: { txn: { name: 'at-txn.xlsx', rows: ATOME_TXN }, payout: { name: 'at-po.xlsx', rows: ATOME_PAYOUT } },
  hitpay: { txn: { name: 'hp-txn.xlsx', rows: HITPAY_TXN }, payout: { name: 'hp-po.xlsx', rows: HITPAY_PAYOUT } },
  nttdata: { txn: { name: 'ntt.xlsx', rows: NTT_TXN } },
};

/** Convert one provider's fixture exactly as the screen does, and hand back what the screen renders. */
function convert(provider: GwProvider, over: { fmt?: string; ref?: string; payout?: boolean; fee?: boolean; files?: GwFiles } = {}) {
  const files = over.files ?? FILES[provider];
  const audit: GwAudit = gwNewAudit();
  const rows = gwConvertRows(provider, files, audit, over.fmt ?? 'ymd', over.ref ?? '', over.payout ?? true, over.fee ?? true);
  return { provider, rows, audit, files } as GwResult;
}

describe('Finance Gateway → Xero — React vs the legacy golden', () => {
  it('renders the same document as renderGateway() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('renders the same Money-in Reference options gwSetProv() writes', () => {
    // The golden's SECOND section. It is the innerHTML of `#gw-ref` and nothing else, so it is compared
    // against the innerHTML of the React select — the same slice, taken the same way.
    const html = renderToStaticMarkup(screen({ provider: 'payex' }));
    expect(relax(innerOf(html, 'gw-ref', 'select'))).toBe(relax(GOLDEN_REF));
  });

  it('wires the same handlers, to the same buttons, in the same order', () => {
    assertHandlerParity();
  });
});

describe('the golden is an INTERMEDIATE state — proven out of app.html, not asserted', () => {
  const src = APP.slice(APP.indexOf('function renderGateway(){'), APP.indexOf('function gwOutFile('));
  const setProv = APP.slice(APP.indexOf('function gwSetProv(p){'), APP.indexOf('function gwRefreshBtn('));

  it('renderGateway() calls gwSetProv() AFTER its innerHTML write', () => {
    // This is the whole reason `provider` has a `null` value the route never passes. If someone deletes
    // that call, the golden becomes the screen an operator sees and this file should be revisited.
    expect(src.indexOf("gwSetProv('payex')")).toBeGreaterThan(src.indexOf("el.innerHTML="));
  });

  it('gwSetProv() mutates FOUR things the harness cannot record, and writes ONE it can', () => {
    expect(setProv).toContain("b.classList.toggle('p',p===x)");          // the highlighted provider tab
    expect(setProv).toContain("getElementById('gw-drop-title').textContent");
    expect(setProv).toContain("getElementById('gw-chip-b-t').textContent");
    expect(setProv).toContain("getElementById('gw-ref').innerHTML=");    // ← the one the golden holds
  });

  it('so the golden shows NO highlighted provider, while every operator sees Payex highlighted', () => {
    expect(GOLDEN).toContain('<button class="btn sm" id="gw-pt-payex"');
    expect(GOLDEN).not.toContain('btn sm p');
    expect(renderToStaticMarkup(screen({ provider: 'payex' }))).toContain('class="btn sm p" id="gw-pt-payex"');
  });

  it('so the golden shows the WRONG chip-B heading for Payex', () => {
    // finance.users' `.className=` trap in a second spelling. The golden says "fees"; the live Payex
    // screen says "MDR", because gwSetProv() overwrites it with a per-provider string.
    expect(GOLDEN).toContain('>Settlements (payout + fees)<');
    expect(chipBTitle(null)).toBe('Settlements (payout + fees)');
    expect(chipBTitle('payex')).toBe('Settlements (payout + MDR)');
    expect(renderToStaticMarkup(screen({ provider: 'payex' }))).toContain('>Settlements (payout + MDR)<');
  });

  it('so the golden shows an EMPTY reference select, while every operator sees four options', () => {
    expect(GOLDEN).toMatch(/<select id="gw-ref"[^>]*>\s*<\/select>/);
    expect(GOLDEN_REF).toContain('TransactionId (unique per sale)');
  });
});

describe('the four gateways are four MODES, and the golden covers one of them', () => {
  it('the golden is the PAYEX mode', () => {
    expect(dropTitle(null)).toBe('1 · Drop Payex files');
    expect(GOLDEN).toContain('>1 · Drop Payex files<');
  });

  it('mirrors the per-provider drop-zone heading, including NTT Data being SINGLE-file', () => {
    expect(dropTitle('atome')).toBe('1 · Drop Atome files');
    expect(dropTitle('hitpay')).toBe('1 · Drop HitPay files');
    expect(dropTitle('nttdata')).toBe('1 · Drop NTT Data file');   // "file", not "files"
  });

  it('mirrors the per-provider chip-B heading', () => {
    expect(chipBTitle('atome')).toBe('Payout list (payout + fees)');
    expect(chipBTitle('hitpay')).toBe('Payout list (net payout)');
    expect(chipBTitle('nttdata')).toBe('Payout + MDR (auto-derived, no 2nd file)');
  });

  it('shows NTT Data its own transaction file in chip B — payout and MDR are derived from it', () => {
    // A port that read `f.payout` here would show "not loaded" beside the file the operator just
    // dropped, on the one provider that has no second file to drop.
    expect(chipBFile('nttdata', FILES.nttdata)?.name).toBe('ntt.xlsx');
    expect(chipBFile('payex', FILES.payex)?.name).toBe('px-set.xlsx');
    expect(chipBFile('atome', FILES.atome)?.name).toBe('at-po.xlsx');
    expect(chipBFile('hitpay', FILES.hitpay)?.name).toBe('hp-po.xlsx');
    expect(chipBFile('payex', { txn: FILES.payex.txn })).toBeNull();
  });

  it('renders each provider its own reference options', () => {
    for (const [p, first] of [['atome', 'Atome Order ID'], ['hitpay', 'Payment ID (unique per sale)'], ['nttdata', 'Gateway Txn ID (unique per sale)']] as [GwProvider, string][]) {
      const inner = innerOf(renderToStaticMarkup(screen({ provider: p })), 'gw-ref', 'select');
      expect(inner).toContain(first);
      expect(inner).not.toContain('CollectionReferenceNumber');   // Payex's, and only Payex's
    }
  });

  it('enables Convert as soon as EITHER half is loaded, per provider', () => {
    // `gwRefreshBtn()` — app.html:3837. Not "both": the screen deliberately converts a half-batch and
    // warns about what is missing, and a port that required both would silently block that.
    expect(convertDisabled(null, null)).toBe(true);
    expect(convertDisabled('payex', {})).toBe(true);
    expect(convertDisabled('payex', { txn: FILES.payex.txn })).toBe(false);
    expect(convertDisabled('payex', { set: FILES.payex.set })).toBe(false);
    expect(convertDisabled('payex', { payout: FILES.atome.payout })).toBe(true);   // Payex's is `set`
    expect(convertDisabled('atome', { payout: FILES.atome.payout })).toBe(false);
    expect(convertDisabled('nttdata', { txn: FILES.nttdata.txn })).toBe(false);
  });
});

// ── HANDLER PARITY ──────────────────────────────────────────────────────────────────────────────────
//
// `identArgs()` is NOT copied here: nothing on this screen identifies anything by a bare integer, and
// `goldenHandlers()`'s quoted-literal extraction already reads `gwSetProv('payex')` and
// `gwDownload('in')` correctly — which is the half that matters, because those arguments choose the
// gateway whose parsing rules run and which slice of rows leaves as a CSV.
//
// Two things need adding on top, both established elsewhere:
//   • `LEGACY_TO_PROP` (hr-profile, finance-recon) — `gwReset()` and `gwConvert()` are both
//     argument-free, so argument parity alone would let the Clear button run the conversion.
//   • a POSITIONAL escape (hr-expenses, finance-pharm) for the drop zone's
//     `onclick="document.getElementById('gw_fi').click()"`, which calls no screen function. The React
//     equivalent (`onBrowse`) records nothing, so the two lists would fall out of step. The escape is
//     allowed ONLY where the golden's own text at that position is that exact statement, so a handler
//     that quietly stopped calling anything still fails.

const BROWSE_RAW = "document.getElementById('gw_fi').click()";

const LEGACY_TO_PROP: Record<string, string> = {
  gwSetProv: 'provider',
  gwReset: 'reset',
  gwConvert: 'convert',
  gwDownload: 'download',
};

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

  const got = reactHandlers(screen({
    onProvider: record('provider') as never,
    onReset: record('reset') as never,
    // NOT recorded: see the positional escape below. `onBrowse` calls no screen function on either
    // side, so recording it would put a call on the React list that the golden's list cannot carry.
    onBrowse: noop,
    onConvert: record('convert') as never,
    onDownload: record('download') as never,
    ...over,
  }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  // The positional escape: the drop zone's handler calls no screen function, so it records nothing on
  // the React side while the golden reads `['gw_fi']` out of its text. Both lists are collapsed at
  // exactly the positions where the GOLDEN's raw text is that statement — nowhere else.
  const keep = want.map((h) => h.raw !== BROWSE_RAW);
  expect(want.filter((_h, i) => !keep[i]).map((h) => h.raw)).toEqual([BROWSE_RAW]);
  expect(calls.map((c) => c.args)).toEqual(want.filter((_h, i) => keep[i]).map((h) => h.args));
  expect(calls.map((c) => c.attr)).toEqual(want.filter((_h, i) => keep[i]).map((h) => propFor(h.raw)));

  // Guard the guard: several handlers here are argument-free, so the identity half has to bite, and it
  // only does while every golden handler is a name LEGACY_TO_PROP knows. A new button in app.html falls
  // through `?? h.raw` and fails here rather than passing silently.
  expect(want.length).toBeGreaterThan(0);
  expect(want.some((h) => h.args.length > 0)).toBe(true);
  expect(want.filter((_h, i) => keep[i]).every((h) => propFor(h.raw) !== h.raw)).toBe(true);
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

describe('the comparison still bites', () => {
  const want = relax(GOLDEN);

  it('catches a provider tab dropped, renamed or re-ordered', () => {
    const html = (list: typeof GW_PROVIDERS) =>
      relax(renderToStaticMarkup(screen()).replace(/<div style="display:flex;gap:8px;margin-bottom:14px">[\s\S]*?<\/div>/,
        '<div style="display:flex;gap:8px;margin-bottom:14px">' +
        list.map((x) => `<button class="btn sm" id="gw-pt-${x.id}">${x.label}</button>`).join('') + '</div>'));
    expect(html(GW_PROVIDERS.slice(0, 3))).not.toBe(want);
    expect(html([GW_PROVIDERS[1], GW_PROVIDERS[0], GW_PROVIDERS[2], GW_PROVIDERS[3]])).not.toBe(want);
  });

  it('catches the provider highlight appearing — the state the golden does NOT hold', () => {
    expect(rendered({ provider: 'payex' })).not.toBe(want);
  });

  it('catches a loaded file chip — the state the golden does NOT hold', () => {
    expect(rendered({ provider: 'payex', files: FILES.payex })).not.toBe(want);
  });

  it('catches the result panel appearing', () => {
    expect(rendered({ provider: 'payex', files: FILES.payex, result: convert('payex') })).not.toBe(want);
  });

  it('catches the Convert button losing its disabled attribute', () => {
    // With no file loaded, an enabled Convert runs the converters over `{}` and writes an empty CSV the
    // operator may well import.
    expect(rendered({ provider: 'payex', files: { txn: FILES.payex.txn } })).not.toBe(want);
  });

  it('catches the file input losing its accept list or its multiple flag', () => {
    const strip = (attr: string) => relax(renderToStaticMarkup(screen()).replace(attr, ''));
    expect(strip(' accept=".xlsx,.xls,.csv"')).not.toBe(want);
    expect(strip(' multiple=""')).not.toBe(want);
  });

  it('catches either checkbox losing its default', () => {
    // Both default to CHECKED. Unchecked by default, an operator converts and gets money-in lines only
    // — a statement whose balance never comes back to the bank, and nothing on screen says why.
    expect(relax(renderToStaticMarkup(screen()).replace(' checked=""', ''))).not.toBe(want);
    expect(relax(renderToStaticMarkup(screen()).replace('id="gw-fee" style="accent-color:var(--coral)" checked=""', 'id="gw-fee" style="accent-color:var(--coral)"'))).not.toBe(want);
  });

  it('catches the date format default moving to DD/MM/YYYY', () => {
    // The golden marks `ymd` — "recommended for Xero import". R5 only absorbs a mark on the FIRST
    // option, so a default that moved to the second one survives the relaxation and diffs.
    const moved = renderToStaticMarkup(screen())
      .replace('<option value="ymd" selected="">', '<option value="ymd">')
      .replace('<option value="dmy">', '<option value="dmy" selected="">');
    expect(relax(moved)).not.toBe(want);
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────

  it('catches a provider tab wired to the WRONG gateway', () => {
    // The defect this exists for: HitPay's button calling gwSetProv('atome'). Both are two-file
    // providers with a Payout Date column, so the screen would look entirely normal and would parse the
    // dropped files with the wrong gateway's column names and the wrong fee model.
    expect(() => assertHandlerParity({ onProvider: ((p: string) => misfire(p === 'hitpay' ? 'atome' : p)) as never }))
      .toThrow(/deeply equal/);
  });

  it('catches a download button wired to the wrong slice', () => {
    // `gwDownload('out')` on the combined button hands the operator a CSV with every sale missing.
    expect(() => assertHandlerParity({ onDownload: ((w: string) => misfire(w === 'all' ? 'out' : w)) as never }))
      .toThrow(/deeply equal/);
  });

  it('catches Clear and Convert swapped — both are argument-free', () => {
    // Argument parity is blind to this: both record `[]`. Only LEGACY_TO_PROP's identity comparison
    // catches it, and pressing Clear when you meant Convert throws away both loaded files.
    expect(() => assertHandlerParity({ onReset: (() => misfire()) as never })).toThrow();
  });

  it('catches the drop zone quietly ceasing to call anything', () => {
    // The positional escape allows a handler that records nothing ONLY at the drop zone's position. A
    // second such handler — a Convert button that stopped calling `onConvert`, say — falls out of step.
    expect(() => assertHandlerParity({ onConvert: (() => {}) as never })).toThrow();
  });

  it('carries handlers on exactly the elements the golden does', () => {
    expect(reactHandlers(screen()).map((h) => h.attr)).toEqual(goldenHandlers(GOLDEN).map((h) => h.attr));
    // The realistic port mistake: adding onDragOver/onDrop props, or an onChange on the file input.
    // Both belong on the ROUTE's addEventListener, as they do in app.html, and both would fail above.
    expect(goldenHandlers(GOLDEN).map((h) => h.attr)).toEqual(['onclick', 'onclick', 'onclick', 'onclick', 'onclick', 'onclick', 'onclick', 'onclick', 'onclick', 'onclick']);
  });
});

describe('the admin gate — app.html:1434', () => {
  it('opens for a user who can manage users', () => {
    expect(gatewayReachable({ manage_users: true })).toBe(true);
  });

  it('is closed for every other shape of permission, including a missing one', () => {
    for (const p of [null, undefined, {}, { manage_users: false }, { manage_users: null }]) {
      expect(gatewayReachable(p as never)).toBe(false);
    }
  });

  it('is NOT the feature gate its o2o / recon / qinv neighbours fall through to', () => {
    // The mistake this catches is copying `collectionsReachable()`. `gateway` is NAMED in showApp()'s
    // if/else if chain, so it never reaches the final `else feats.indexOf(t)<0`.
    expect(gatewayReachable({ features: ['gateway'] } as never)).toBe(false);
  });

  it('mirrors app.html:1434 verbatim, so the predicate cannot quietly stop matching the app', () => {
    const block = APP.slice(APP.indexOf("document.querySelectorAll('.tab').forEach"), APP.indexOf("// Hide any category"));
    expect(block).toContain("else if(t==='gateway') el.classList.toggle('hide', !canManage);");
    // And it is inside the chain, not the standalone `if`s that make `users`/`ctgaccess` special.
    expect(block.indexOf("t==='gateway'")).toBeGreaterThan(block.indexOf("else if(t==='selfbill')"));
  });

  it('is what the route gates on — the screen renders customer names, ids, fees and payout dates', () => {
    // Guard the guard: if the fixture stopped carrying what the gate protects, the cases above would be
    // about nothing. There is no server-side gate to fall back on — this screen posts nothing.
    const html = renderToStaticMarkup(screen({ provider: 'payex', files: FILES.payex, result: convert('payex') }));
    expect(html).toContain('GUARDIAN HEALTH');       // a paying customer, by name
    expect(html).toContain('PX1');                   // their transaction id
    expect(html).toContain('Payex MDR fee - NetPayex');
    expect(html).toContain('2026-07-02');            // when the money reached the bank
  });
});

describe('the result panel — every figure the screen exists to produce, and no golden sees any of it', () => {
  const html = (p: GwProvider, over?: Parameters<typeof convert>[1]) =>
    renderToStaticMarkup(screen({ provider: p, files: over?.files ?? FILES[p], result: convert(p, over) }));

  it('is hidden until a conversion happens, and the golden holds it hidden', () => {
    expect(GOLDEN).toContain('<div class="panel hide" id="gw-result">');
    expect(renderToStaticMarkup(screen())).toContain('class="panel hide" id="gw-result"');
    expect(html('payex')).toContain('class="panel" id="gw-result"');
  });

  it('names the provider the rows came from', () => {
    expect(html('payex')).toContain('>· PAYEX</span>');
    expect(html('nttdata')).toContain('>· NTTDATA</span>');
  });

  it('renders one preview row per converted row, in the converter\'s own date order', () => {
    const dates = [...html('payex').matchAll(/<tr><td>(\d{4}-\d\d-\d\d)<\/td>/g)].map((m) => m[1]);
    expect(dates).toEqual([...dates].sort());
    expect(dates[0]).toBe('2026-07-01');
  });

  it('caps the preview at 200 rows and says so — the download still carries all of them', () => {
    const many = Array.from({ length: 205 }, (_x, i) => ({ ...PAYEX_TXN[0], TransactionId: 'PX' + i, Date: '01/07/2026' }));
    const r = convert('payex', { files: { txn: { name: 'big.xlsx', rows: many } } });
    const h = renderToStaticMarkup(screen({ provider: 'payex', files: { txn: { name: 'big.xlsx', rows: many } }, result: r }));
    expect(h).toContain('Preview shows first 200 of 205 rows; download includes all.');
    expect([...h.matchAll(/<tr><td>/g)]).toHaveLength(200);
    expect(gwCSV(r.rows).split('\r\n')).toHaveLength(206);    // header + 205
  });

  it('warns when only one half of a two-file gateway is loaded, and does not when both are', () => {
    expect(html('payex', { files: { txn: FILES.payex.txn } }))
      .toContain('Only the Transaction file is loaded — payout + fee lines need the settlement file.');
    expect(html('payex', { files: { set: FILES.payex.set } }))
      .toContain('Only the settlement/payout file is loaded — money-in lines need the Transaction file.');
    expect(html('hitpay', { files: { set: null, payout: FILES.hitpay.payout } }))
      .toContain('money-in + fee lines need the Transaction file.');   // HitPay derives its fee from the txn file
    expect(html('payex')).not.toContain('⚠ Only the');
  });

  it('passes the data check when every input row is accounted for, and fails it when one is skipped', () => {
    // The check block is the ONLY thing telling an operator the CSV is complete. Payex's fixture skips
    // two rows on purpose (one with no date, one netting to zero), so it must NOT read as passed.
    expect(html('payex')).toContain('⚠ Data check — please review below');
    expect(html('payex')).toContain('skipped 2 (1 no date, 1 zero amount)');
    expect(html('atome')).toContain('✓ Data check passed — every input row accounted for');
  });

  it('reports the Payex unsettled float, which is the screen\'s own explanation of its balance', () => {
    expect(html('payex')).toContain('1 settled + 1 not yet settled (RM250.00 unsettled float');
  });
});

describe('per-gateway parsing — the golden covers none of it, and each gateway is different', () => {
  // Every case here is a place a port silently diverges: a column read from the wrong position, a fee
  // treated as gross, a date format assumed. The arithmetic is gateway.js's — imported by both the
  // legacy app and the React screen — so these pin the CONTRACT that neither may fork.
  const rowsFor = (p: GwProvider, over?: Parameters<typeof convert>[1]) => convert(p, over).rows;
  const find = (rows: GwRow[], ref: string) => rows.find((r) => r.ref === ref);

  it('PAYEX: money-in is Amount MINUS RefundAmount, per transaction', () => {
    const rows = rowsFor('payex', { ref: 'TransactionId' });
    expect(find(rows, 'PX1')).toMatchObject({ amount: 1000, payee: 'GUARDIAN HEALTH', desc: 'Payex fpx', kind: 'in' });
    expect(find(rows, 'PX2')).toMatchObject({ amount: 250, payee: 'Payex customer', desc: 'Payex card' });
    expect(find(rows, 'PX3')).toBeUndefined();       // no date
    expect(find(rows, 'PX4')).toBeUndefined();       // nets to zero
  });

  it('PAYEX: NetPayex and NetOthers stay SEPARATE payout AND fee lines, and MDR follows the stream', () => {
    // The one that is invisible if it goes wrong: summing the two streams gives the same grand total
    // and the same bank balance, but every line codes to the wrong Xero account.
    const rows = rowsFor('payex');
    expect(find(rows, 'PAYOUT-PAYEX-2026-07-02')).toMatchObject({ amount: -600, kind: 'out' });
    expect(find(rows, 'PAYOUT-OTHERS-2026-07-02')).toMatchObject({ amount: -400, kind: 'out' });
    expect(find(rows, 'MDR-PAYEX-2026-07-02')).toMatchObject({ amount: -12, kind: 'fee' });
    expect(find(rows, 'MDR-OTHERS-2026-07-02')).toMatchObject({ amount: -8, kind: 'fee' });
  });

  it('PAYEX: the Money-in Reference control really chooses the column', () => {
    expect(find(rowsFor('payex', { ref: 'ReferenceNumber' }), 'R1')).toBeDefined();
    expect(find(rowsFor('payex', { ref: 'TransactionId' }), 'R1')).toBeUndefined();
  });

  it('ATOME: one payout line and one fee line per Payout Date, the fee being payout MINUS Total Sales', () => {
    const rows = rowsFor('atome');
    expect(find(rows, 'ATOME-PAYOUT-2026-07-05')).toMatchObject({ amount: -270, kind: 'out' });
    expect(find(rows, 'ATOME-MDR-2026-07-05')).toMatchObject({ amount: -30, kind: 'fee' });
    expect(rows.find((r) => r.kind === 'in')).toMatchObject({ amount: 300, payee: 'Atome', desc: 'Atome 3 months' });
  });

  it('HITPAY: the MDR fee is DERIVED — the settlement report has no fee column', () => {
    // fee rate = 4 / 200 = 2%; gross-up of the 196 net = 200, so the fee is 4.00 on the PAYOUT date.
    const rows = rowsFor('hitpay');
    expect(find(rows, 'HITPAY-PAYOUT-2026-07-03')).toMatchObject({ amount: -196, kind: 'out' });
    expect(find(rows, 'HITPAY-MDR-2026-07-03')).toMatchObject({ amount: -4, kind: 'fee' });
    expect(find(rows, 'HITPAY-MDR-2026-07-03')?.desc).toBe('HitPay MDR fee (2.00% of settled gross)');
  });

  it('HITPAY: with no transaction file it falls back to 1.5%, rather than booking no fee at all', () => {
    const rows = rowsFor('hitpay', { files: { payout: FILES.hitpay.payout } });
    expect(find(rows, 'HITPAY-MDR-2026-07-03')?.desc).toBe('HitPay MDR fee (1.50% of settled gross)');
  });

  it('NTT DATA: ONE file, and payout + MDR are derived from the transaction rows', () => {
    const rows = rowsFor('nttdata');
    expect(rows.find((r) => r.kind === 'in')).toMatchObject({ amount: 500, payee: 'NTT Data', desc: 'NTT Data DuitNow QR' });
    expect(find(rows, 'NTT-PAYOUT-2026-07-01')).toMatchObject({ amount: -490, kind: 'out' });
    expect(find(rows, 'NTT-MDR-2026-07-01')).toMatchObject({ amount: -10, kind: 'fee' });
  });

  it('NTT DATA: strips the leading apostrophe Excel puts on a text id', () => {
    // `'NT1` is what the export contains. Left in, every reference in Xero carries a stray quote and
    // never matches the gateway's own record.
    expect(rowsFor('nttdata').find((r) => r.kind === 'in')?.ref).toBe('NT1');
  });

  it('the date format control changes the printed date and nothing else', () => {
    const ymd = rowsFor('payex')[0];
    const dmy = rowsFor('payex', { fmt: 'dmy' })[0];
    expect(ymd.date).toBe('2026-07-01');
    expect(dmy.date).toBe('01/07/2026');
    expect(dmy.amount).toBe(ymd.amount);
    // The consolidation key stays ymd whatever the operator picked — otherwise two dates would merge.
    expect(rowsFor('payex', { fmt: 'dmy' }).some((r) => r.ref === 'PAYOUT-PAYEX-2026-07-02')).toBe(true);
  });

  it('the two checkboxes drop exactly the lines they name, and nothing else', () => {
    expect(rowsFor('payex', { payout: false }).some((r) => r.kind === 'out')).toBe(false);
    expect(rowsFor('payex', { payout: false }).some((r) => r.kind === 'fee')).toBe(true);
    expect(rowsFor('payex', { fee: false }).some((r) => r.kind === 'fee')).toBe(false);
    expect(rowsFor('payex', { fee: false }).some((r) => r.kind === 'out')).toBe(true);
  });
});

describe('the CSV and its filename — the file that leaves the building, which no golden sees', () => {
  const r = convert('payex', { ref: 'TransactionId' });

  it('writes Xero\'s five columns, CRLF, one row per converted line', () => {
    const lines = gwCSV(r.rows).split('\r\n');
    expect(lines[0]).toBe('Date,Amount,Payee,Description,Reference');
    expect(lines).toHaveLength(r.rows.length + 1);
    expect(lines).toContain('2026-07-01,1000.00,GUARDIAN HEALTH,Payex fpx,PX1');
  });

  it('writes every amount to the sen, signed as the row is', () => {
    // Xero reads the sign as the direction of the money. A payout written positive turns a settlement
    // into a second sale, and the account never balances.
    expect(gwCSV(r.rows)).toContain(',-600.00,Payex,Payex settlement payout - NetPayex,');
  });

  it('quotes a field containing a comma, a quote or a newline, and doubles an embedded quote', () => {
    const row: GwRow = { d: new Date(2026, 6, 1), date: '2026-07-01', amount: 1, payee: 'A, B "C"', desc: 'x\ny', ref: 'plain', kind: 'in' };
    const line = gwCSV([row]).split('\r\n')[1];
    expect(line).toContain('"A, B ""C"""');
    expect(line).toContain('"x\ny"');
    expect(line.endsWith(',plain')).toBe(true);
  });

  it('names the file for the provider, the slice and the date range it actually covers', () => {
    expect(gwOutName('payex', 'all', r.rows)).toBe('Xero_Payex_Clearing_2026-07-01_2026-07-02.csv');
    expect(gwOutName('payex', 'in', downloadRows('in', r.rows))).toBe('Xero_Payex_MoneyIn_2026-07-01_2026-07-01.csv');
    expect(gwOutName('nttdata', 'out', downloadRows('out', convert('nttdata').rows))).toBe('Xero_Nttdata_Settlements_2026-07-01_2026-07-01.csv');
  });

  it('the "settlements only" slice is everything that is NOT money-in — fees included', () => {
    // `r.kind!=='in'`, not `r.kind==='out'`. A slice that dropped the fee lines would hand Xero a
    // statement whose payouts never reconcile against the gross.
    const out = downloadRows('out', r.rows);
    expect(out.some((x) => x.kind === 'fee')).toBe(true);
    expect(out.some((x) => x.kind === 'out')).toBe(true);
    expect(downloadRows('in', r.rows).every((x) => x.kind === 'in')).toBe(true);
    expect(downloadRows('all', r.rows)).toBe(r.rows);
  });
});

describe('the arithmetic is IMPORTED, not re-expressed', () => {
  it('finance-gateway.tsx imports gateway.js and does no money arithmetic of its own', () => {
    // The rule this migration lifted the computation for: this screen posts to no server, so the CSV it
    // writes is the only copy of these figures that exists. A second expression of them in TSX would be
    // a fork of a bank-statement engine with nothing checking that the copies agree.
    const src = readFileSync(join(REPO, 'web', 'src', 'finance-gateway.tsx'), 'utf8');
    expect(src).toContain("from '../../gateway.js'");
    const body = src.slice(src.indexOf('export default function FinanceGateway'));
    // `toFixed(2)` is allowed: it is `gwRenderResult()`'s own formatting of a figure gateway.js already
    // decided (app.html:3885), not a second computation of it.
    expect(body).not.toMatch(/Math\.round|\* *100|\/ *100/);
  });

  it('app.html calls the SAME file, so the two screens cannot diverge', () => {
    expect(APP).toContain('<script src="gateway.js"></script>');
    expect(APP).toContain('GW.out=gwConvertRows(GW.provider,GW[GW.provider],GW.audit,fmt,refField,wantPayout,wantFee);');
    expect(APP).toContain('var name=gwOutName(GW.provider,which,rows);');
    // and no longer carries its own copy of any of it
    expect(APP).not.toContain('function gwConvertPayex(');
    expect(APP).not.toContain('function gwCSV(');
  });
});
