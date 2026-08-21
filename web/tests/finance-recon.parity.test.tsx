// Finance OS · Bank Rec — the React screen against the legacy screen's committed golden.
//
// `tests/golden/finance.recon.html` was captured from `renderRecon()` (app.html:5958) by the 40-surface
// harness; nothing here regenerates or edits it, and nothing here touches tests/render_surfaces.ts,
// tests/parity.ts or tests/handlers.ts. The component is rendered with `renderToStaticMarkup` from the
// SAME fixture the golden was captured from — tests/render_fixtures.ts's COMPANIES, imported directly —
// normalised by the harness's own normalise(), relaxed by the documented layer in ./parity.ts, compared.
//
// NO SEVENTH RELAXATION. This reuses ./parity.ts's six unchanged, which is what seventeen screens have
// now done. Two things that looked like they might need one did not:
//   • the `&` in "invoices &amp; bills" is written as `&amp;` by the legacy string AND by React's text
//     escaper, so it matches byte for byte — hr-payslip's `decodeTextAmp` is not needed here;
//   • the company <select> carries no `selected` on either side, because the component is deliberately
//     uncontrolled (see src/finance-recon.tsx), so relaxation R5 is not leaned on either.
//
// ── WHAT THE GOLDEN DOES NOT REACH, and where that is pinned instead ───────────────────────────────
// The golden is the screen BEFORE a statement is uploaded: `#rc_out` is empty. So the three cards and
// the whole match table — every figure an operator reads on this screen — are outside the diff, and so
// is `bankParse()`, which turns the uploaded file into the lines that get matched. Both are pinned by
// their own cases below, against app.html's own text where a contract exists to read.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CO1, CO2, COMPANIES } from '../../tests/render_fixtures';
import FinanceRecon, {
  bankLines, reconcileBody, reconReachable,
  type ReconLine, type ReconResponse,
} from '../src/finance-recon';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

/** `#recon` is the tab div `render('recon')` writes into (app.html:1167) — the golden's only section. */
const GOLDEN = goldenSection('finance.recon', 'recon');

const noop = () => {};

type Props = Parameters<typeof FinanceRecon>[0];

function screen(over: Partial<Props> = {}) {
  return (
    <FinanceRecon
      companies={COMPANIES}
      // `renderRecon()` writes `#rc_out` EMPTY — it runs no fetch and reads no file. That is the state
      // the surface was captured in.
      out={null}
      onPick={noop}
      {...over}
    />
  );
}

const rendered = (over: Partial<Props> = {}) => relax(renderToStaticMarkup(screen(over)));

/** A `bank_reconcile` answer — finance.ts:850. Two lines carrying the SAME amount, on purpose. */
const TIED: ReconResponse = {
  total: 3,
  matched: 2,
  results: [
    { date: '2026-07-01', amount: 1250, description: 'FPX TRANSFER SKINDAE', match: { kind: 'AR (money in)', contact: 'GUARDIAN HEALTH', number: 'INV-1041' } },
    { date: '2026-07-02', amount: 1250, description: 'FPX TRANSFER SKINDAE', match: { kind: 'AR (money in)', contact: 'CARING PHARMACY', number: 'INV-1077' } },
    { date: '2026-07-03', amount: -880.5, description: 'IBG PAYMENT TO SUPPLIER', match: null },
  ],
};

describe('Finance Bank Rec — React vs the legacy golden', () => {
  it('renders the same document as renderRecon() does', () => {
    expect(rendered()).toBe(relax(GOLDEN));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * ── HANDLER PARITY ────────────────────────────────────────────────────────────────────────────────
 *
 * This screen carries exactly ONE handler in the golden — `onchange="reconPick(this)"` on the file
 * input — and it takes no identifying argument, so argument parity alone is vacuous here. Same shape as
 * hr-profile: a golden-DERIVED `LEGACY_TO_PROP` compares handler IDENTITY, and the guard-the-guard
 * clause is "every golden handler name resolved to a known prop" rather than hr-clock's
 * `some(args.length > 0)`, which is unsatisfiable on an argument-free screen.
 *
 * `identArgs()` is NOT copied here: nothing on this screen identifies a row by a bare integer, and
 * `goldenHandlers()`'s quoted-literal extraction is already the right answer for `reconPick(this)`.
 */
const LEGACY_TO_PROP: Record<string, string> = {
  'reconPick(this)': 'pick',
  reconPick: 'pick',
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

  const got = reactHandlers(screen({ onPick: record('pick') as never, ...over }));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => h.invoke());

  expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));
  expect(calls.map((c) => c.attr)).toEqual(want.map((h) => propFor(h.raw)));

  // Guard the guard: with the golden carrying no argument anywhere, the args comparison above passes
  // vacuously, so the identity half has to be the one that bites — and it only does while every golden
  // handler is a name LEGACY_TO_PROP knows. A new button in app.html falls through `?? h.raw` and fails
  // here rather than passing silently.
  expect(want.length).toBeGreaterThan(0);
  expect(want.every((h) => propFor(h.raw) !== h.raw)).toBe(true);
}

/** The recorder assertHandlerParity() installs, reached from the mis-wire cases below. */
let misfire: (...args: unknown[]) => void = () => {};

describe('the comparison still bites', () => {
  const want = relax(GOLDEN);

  it('catches a company dropped out of the picker', () => {
    // The operator would reconcile the remaining company's statement, or silently the wrong one.
    expect(rendered({ companies: COMPANIES.slice(0, 1) })).not.toBe(want);
  });

  it('catches a company option whose VALUE moved to the other tenant', () => {
    // The label still reads SKINDAE; the posted tenant is I PROCARE. Every ✓ on the screen would then
    // be a match against another company's ledger. The label is what the operator checks, so the value
    // is the half that can go wrong in silence — and it is an attribute value, which nothing in relax()
    // touches.
    expect(rendered({ companies: [{ ...COMPANIES[0], tenant_id: CO2 }, COMPANIES[1]] })).not.toBe(want);
  });

  it('catches a renamed or re-ordered company', () => {
    expect(rendered({ companies: [{ ...COMPANIES[0], tenant_name: 'SKINDAE SDN. BHD.' }, COMPANIES[1]] })).not.toBe(want);
    expect(rendered({ companies: [COMPANIES[1], COMPANIES[0]] })).not.toBe(want);
  });

  it('catches the beta pill going missing', () => {
    // This screen is labelled beta in the live app and the label is load-bearing: it is what tells an
    // operator not to trust a ✓ without opening Xero.
    expect(relax(renderToStaticMarkup(screen()).replace(/<span class="pill pill-submit"[^>]*>beta<\/span>/, ''))).not.toBe(want);
  });

  it('catches results appearing — a branch no golden holds', () => {
    // Proves the golden really is the pre-upload state, so everything pinned below is genuinely outside
    // the diff rather than accidentally inside it.
    expect(rendered({ out: { kind: 'result', data: TIED } })).not.toBe(want);
    expect(rendered({ out: { kind: 'loading', lines: 12 } })).not.toBe(want);
  });

  // ── mis-wired handlers ────────────────────────────────────────────────────────────────────────────

  it('catches the file input handed an argument it never had', () => {
    expect(() => assertHandlerParity({ onPick: (() => misfire('rc_file')) as never })).toThrow(/deeply equal/);
  });

  it('carries the handler on the file input and NOWHERE else', () => {
    // The realistic port mistake here is making the company <select> controlled — an onChange React
    // would emit and the golden does not carry. It fails the attr-sequence assertion above; this states
    // it directly so the reason is on the record.
    expect(reactHandlers(screen()).map((h) => h.attr)).toEqual(['onchange']);
    expect(goldenHandlers(GOLDEN).map((h) => h.attr)).toEqual(['onchange']);
  });
});

describe('the feature gate — app.html:1434', () => {
  // The withheld direction, asserted. `renderRecon()` has no role check; `showApp()` falls Bank Rec
  // through to `feats.indexOf(t)<0`, so it is the FEATURE list that decides — not `manage_users`, which
  // is what gates the seven admin-only tabs above it in the same chain.
  it('opens for a user whose features include recon', () => {
    expect(reconReachable({ features: ['overview', 'pnl', 'recon'] })).toBe(true);
  });

  it('is closed for every other shape of permission, including a missing one', () => {
    for (const p of [null, undefined, {}, { features: [] }, { features: null }, { features: ['overview', 'pnl'] }]) {
      expect(reconReachable(p as never)).toBe(false);
    }
  });

  it('is NOT the manage_users gate — an admin without the feature is still out', () => {
    // The mistake this catches is copying finance-wht's `whtReachable()`. `manage_users` says nothing
    // about Bank Rec, and a port that used it would open the screen to admins who were deliberately
    // left off the feature list and close it to the approvers who reconcile the bank.
    expect(reconReachable({ manage_users: true } as never)).toBe(false);
  });

  it('is what the route gates on — the screen renders tenant ids, contacts and money', () => {
    // Guard the guard: if the fixture stopped carrying the things the gate protects, the assertions
    // above would be about nothing.
    const html = renderToStaticMarkup(screen({ out: { kind: 'result', data: TIED } }));
    expect(html).toContain(CO1);                    // a tenant id, postable straight to bank_reconcile
    expect(html).toContain('GUARDIAN HEALTH');      // a customer name
    expect(html).toContain('INV-1041');             // an open invoice number
    expect(html).toContain('RM 1,250.00');          // what is outstanding on it
  });
});

describe('matching by amount is ambiguous, and the client does not resolve it', () => {
  // The rule is the SERVER's: bank_reconcile (finance.ts:849) walks one docs list — every ACCREC with
  // AmountDue > 0 first, then every ACCPAY — takes the first doc within 1 sen that is not already
  // `used`, and marks it used. So two invoices for the same figure are separated only by that order,
  // and this component must render the answer positionally rather than re-deriving it.
  const html = renderToStaticMarkup(screen({ out: { kind: 'result', data: TIED } }));
  const cells = [...html.matchAll(/<td>(?:<span[^>]*>[^<]*<\/span>)?([^<]*)<\/td>/g)].map((m) => m[1]);

  it('keeps each row with the doc the SERVER gave that row, when two lines tie on amount', () => {
    // Both rows are RM 1,250.00. Swapping them puts GUARDIAN HEALTH's payment against CARING
    // PHARMACY's invoice — two customers' ledgers wrong at once, and nothing on screen looks odd.
    const first = html.indexOf('INV-1041');
    const second = html.indexOf('INV-1077');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(cells).toContain(' AR (money in) · GUARDIAN HEALTH INV-1041');
    expect(cells).toContain(' AR (money in) · CARING PHARMACY INV-1077');
  });

  it('does NOT de-duplicate when the server echoes one doc on two lines', () => {
    // Not reachable through the live handler (`used[i]` stops it), but a port that "tidied" duplicates
    // would be inventing an unmatched line the server said was matched — and the Matched card would
    // stop agreeing with the table. The counts come from the server too, never from the rows.
    const dup: ReconResponse = {
      total: 2, matched: 2,
      results: [TIED.results[0], { ...TIED.results[1], match: TIED.results[0].match }],
    };
    const h = renderToStaticMarkup(screen({ out: { kind: 'result', data: dup } }));
    expect([...h.matchAll(/INV-1041/g)]).toHaveLength(2);
    expect(h).toContain('>2</div><div class="l">Matched</div>');
    expect(h).toContain('>0</div><div class="l">Unmatched</div>');
  });

  it('leaves an unmatched line unmatched — it never borrows a neighbour\'s candidate', () => {
    expect(html).toContain('<span class="pill pill-draft">no match</span>');
    expect([...html.matchAll(/pill-green/g)]).toHaveLength(2);
  });

  it('renders one row per bank line, in the order the server returned them', () => {
    const dates = [...html.matchAll(/<td>(2026-07-\d\d)<\/td>/g)].map((m) => m[1]);
    expect(dates).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
  });

  it('shows the money out as a positive figure, to the sen, thousands separated', () => {
    // `M(Math.abs(x.amount))` — app.html:5979. The -880.50 line is a payment out; the sign lives in the
    // Xero match column ("AP (money out)"), not in the amount.
    expect(html).toContain('RM 880.50');
    expect(html).not.toContain('RM -880.50');
    expect(html).toContain('RM 1,250.00');
  });

  it('truncates a long description at 40 characters, as the legacy does', () => {
    const long = 'IBG TRANSFER FROM GUARDIAN HEALTH SDN BHD REF 99887766';
    const h = renderToStaticMarkup(screen({ out: { kind: 'result', data: { total: 1, matched: 0, results: [{ date: '2026-07-01', amount: 10, description: long, match: null }] } } }));
    expect(h).toContain(long.slice(0, 40));
    expect(h).not.toContain(long);
  });
});

describe('bankParse — the lines that get matched, which no golden sees', () => {
  // Every figure this gets wrong reconciles a payment against the wrong invoice, or drops it from the
  // statement entirely. `bankLines()` is app.html:5934 with only the XLSX decode lifted out, so `rows`
  // here is exactly what `sheet_to_json(ws,{header:1,raw:false,defval:null})` hands it.
  const HDR = ['Date', 'Description', 'Amount'];

  it('reads a Date/Description/Amount statement', () => {
    expect(bankLines([HDR, ['01/07/2026', 'FPX GUARDIAN', '1250.00']])).toEqual([
      { date: '01/07/2026', amount: 1250, description: 'FPX GUARDIAN' },
    ]);
  });

  it('keeps the SIGN from the Debit/Credit columns — credit minus debit', () => {
    // The one that costs money: a withdrawal read as +880.50 is matched against a customer INVOICE
    // instead of a supplier bill, so an unpaid receivable is marked settled by a payment that left the
    // account.
    const rows = [['Date', 'Particulars', 'Debit', 'Credit'], ['02/07/2026', 'IBG SUPPLIER', '880.50', null]];
    expect(bankLines(rows)[0].amount).toBe(-880.5);
    expect(bankLines([rows[0], ['02/07/2026', 'FPX IN', null, '1250.00']])[0].amount).toBe(1250);
  });

  it('prefers the Amount column over Debit/Credit when it holds anything', () => {
    const rows = [['Date', 'Desc', 'Amount', 'Debit', 'Credit'], ['03/07/2026', 'X', '-99.99', '880.50', null]];
    expect(bankLines(rows)[0].amount).toBe(-99.99);
  });

  it('falls back to Debit/Credit only when the Amount cell is null or blank', () => {
    const rows = [['Date', 'Desc', 'Amount', 'Debit', 'Credit'], ['03/07/2026', 'X', '   ', '880.50', null]];
    expect(bankLines(rows)[0].amount).toBe(-880.5);
  });

  it('strips currency and thousands separators, and does NOT read CR/DR as a sign', () => {
    // Mirrored deliberately: the legacy takes the sign from the COLUMN, never from the text, so
    // "1,234.50 CR" in an Amount column is +1234.50 whatever the CR meant. Changing that here would be
    // an invisible behaviour change riding along with a migration; raised in the PR, pinned here.
    expect(bankLines([HDR, ['04/07/2026', 'X', 'RM 1,234.50 CR']])[0].amount).toBe(1234.5);
  });

  it('drops a row that parses to zero rather than sending it', () => {
    expect(bankLines([HDR, ['05/07/2026', 'BALANCE B/F', '0.00'], ['06/07/2026', 'REAL', '10']])).toHaveLength(1);
  });

  it('drops a row with no date, and stops at nothing else', () => {
    expect(bankLines([HDR, [null, 'ORPHAN', '10'], ['07/07/2026', 'KEPT', '20']])).toEqual([
      { date: '07/07/2026', amount: 20, description: 'KEPT' },
    ]);
  });

  it('finds the header below preamble rows, within the first 18', () => {
    const pre = Array.from({ length: 6 }, () => ['MAYBANK BERHAD', null, null]);
    expect(bankLines([...pre, HDR, ['08/07/2026', 'X', '5']])).toHaveLength(1);
    const deep = Array.from({ length: 18 }, () => ['MAYBANK BERHAD', null, null]);
    expect(() => bankLines([...deep, HDR, ['08/07/2026', 'X', '5']])).toThrow(/Could not detect columns/);
  });

  it('throws the legacy message when no header is detectable', () => {
    expect(() => bankLines([['Ref', 'Narrative'], ['a', 'b']]))
      .toThrow('Could not detect columns. Statement needs headers like Date, Description, Amount (or Debit/Credit).');
  });

  it('accepts the header synonyms the legacy accepts', () => {
    expect(bankLines([['Txn Date', 'Narrative', 'Withdrawal', 'Deposit'], ['09/07/2026', 'X', null, '7.25']])[0])
      .toEqual({ date: '09/07/2026', amount: 7.25, description: 'X' });
  });

  it('sends an empty description rather than dropping the line when there is no desc column', () => {
    expect(bankLines([['Date', 'Amount'], ['10/07/2026', '3']])[0].description).toBe('');
  });
});

describe('the POST body — a statement cannot be reconciled against the wrong company', () => {
  const lines: ReconLine[] = [{ date: '01/07/2026', amount: 1250, description: 'FPX' }];

  it('carries the tenant the operator picked, verbatim', () => {
    expect(reconcileBody(CO2, lines)).toEqual({ api: 'bank_reconcile', tenant: CO2, lines });
    expect(reconcileBody(CO1, lines).tenant).toBe(CO1);
  });

  it('refuses to build a body with no company — it does not default to the first one', () => {
    // `reconRun()` (app.html:5974) toasts "Pick a company" and returns. A port that fell back to
    // COMPANIES[0] would match one company's statement against another's ledger, and the screen would
    // look completely normal doing it.
    expect(() => reconcileBody('', lines)).toThrow(/Pick a company/);
  });

  it('reads the company from the same element id the legacy save path reads', () => {
    // Extracted from app.html at run time rather than retyped: the select's id IS the contract between
    // this markup and the route, exactly as the `wp_*` ids are on the WHT form. A select that lost it
    // would post an empty tenant — or, with a fallback, the wrong one.
    const src = readFileSync(join(REPO, 'app.html'), 'utf8');
    const run = src.slice(src.indexOf('async function reconRun()'), src.indexOf('/* ── Auto-login on load ── */'));
    const ids = [...new Set([...run.matchAll(/getElementById\('(rc_[a-z]+)'\)/g)].map((m) => m[1]))];
    expect(ids).toContain('rc_co');
    for (const id of ids) expect(renderToStaticMarkup(screen())).toContain(`id="${id}"`);
  });

  it('sends the lines untouched — no rounding, no re-ordering, no re-signing', () => {
    // The server rounds to the sen itself (finance.ts:849) and matches on the absolute value; a client
    // that pre-rounded or flipped a sign would change which invoice wins before the server ever saw it.
    const many: ReconLine[] = [
      { date: '01/07/2026', amount: -880.505, description: 'B' },
      { date: '02/07/2026', amount: 1250, description: 'A' },
    ];
    expect(reconcileBody(CO1, many).lines).toBe(many);
  });
});
