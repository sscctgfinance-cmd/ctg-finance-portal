// HR OS · Reimbursement · SUBMIT — the React form against the legacy screen's committed golden.
//
// `tests/golden/hr.expenses.form.html` was captured from `hrRCForm()` (hros.html:2000) by the shared
// 44-surface harness; nothing here regenerates or edits it, and nothing here touches
// tests/render_surfaces.ts or tests/parity.ts. No seventh relaxation — the six the pilot argued cover
// this screen too.
//
// The golden is ONE state: a blank new form, `RC.form` empty. Everything else this file asserts is a
// branch no golden can hold (the `⋯` detail block, a mileage line, a queued receipt) or something no
// golden can see at all (the POST body, the refusals, the money).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrExpenses, { type RcMe } from '../src/hr-expenses';
import HrExpensesForm, {
  blankItem, claimBody, DECLARATIONS, defaultRate, formTotal, HR_RC_MAX_BYTES, isMileage, itemAmount,
  keptItems, pickReceipts, saveRefusal, sizeLabel, tooBigMessage, type RcConfig, type RcForm, type RcFormItem,
} from '../src/hr-expenses-form';
import { goldenSection, relax, REPO } from './parity';
import { goldenHandlers, reactHandlers, STUB_VALUE } from './handlers';

const HROS = readFileSync(join(REPO, 'hros.html'), 'utf8');
const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;
const GOLDEN = goldenSection('hr.expenses.form', 'hr');

const CFG = FIXTURES.hr_rc_config as RcConfig;
const ME = (FIXTURES.hr_rc_config as { me: RcMe }).me;

/** `tests/render_harness.ts`'s FIXED_MS is 2026-08-18T09:30:00Z; +8h is still the 18th in Malaysia. */
const TODAY = '2026-08-18';

/** What `hrRCForm()` (hros.html:2002) puts in `RC.form.items` when the form is opened blank. */
const BLANK: RcFormItem[] = [{ claim_type_id: '', item_date: TODAY, description: '', amount: '', total_km: '', mileage_rate: defaultRate(CFG) }];

const noop = () => {};

function form(over: Partial<Parameters<typeof HrExpensesForm>[0]> = {}) {
  return (
    <HrExpensesForm
      form={{}}
      cfg={CFG}
      items={BLANK}
      pending={[]}
      scans={[]}
      today={TODAY}
      saving={false}
      scanStatus=""
      onClose={noop}
      onItemType={noop}
      onItemMore={noop}
      onItemDel={noop}
      onItemAdd={noop}
      onItemCalc={noop}
      onScanTrigger={noop}
      onScanPickFile={noop}
      onScanFile={noop}
      onScanPreview={noop}
      onScanRemove={noop}
      onPickReceipts={noop}
      onReceiptRemove={noop}
      onSave={noop}
      {...over}
    />
  );
}

/**
 * The golden holds the whole `#hr` element, which is the page head + `hrRC()`'s tab bar + the form
 * body. The head and the tab bar are `hrRender()`'s and `hrRC()`'s, already migrated in
 * `src/hr-expenses.tsx`, so the comparison mounts the same two components the route mounts.
 */
function screen(over: Partial<Parameters<typeof HrExpensesForm>[0]> = {}, onNav: (p: string) => void = noop) {
  return (
    <>
      <HrExpenses
        claims={[]} me={ME} companyName={COMPANY_NAME} page="form" scope="pending" sel={{}}
        onNav={onNav} onScope={noop} onOpen={noop} onSelAll={noop} onSelToggle={noop} onSelClear={noop}
        onExportAcct={noop} onExportCsv={noop} onExportBank={noop} onBulkApprove={noop} onBulkReject={noop}
        onBulkInfo={noop} onBulkPay={noop}
      />
      {form(over)}
    </>
  );
}

/**
 * A NAMED character reference — hr-payroll's finding, in this screen's own file. `hrRCForm()` writes
 * `&rsquo;` straight into its HTML string (hros.html:2057), so the golden holds the eight characters;
 * React's text escaper emits only `& < > " '` as references, so a `’` in JSX comes out as the
 * character and the literal string `"&rsquo;"` comes out as `&amp;rsquo;`. Neither side can be spelled
 * into the other. Decoded on BOTH sides, narrowed to the one entity this screen actually writes.
 *
 * Cannot hide: it never touches `&amp;`, so the doubly-escaped defect (`&amp;rsquo;` printing on the
 * page) still diffs; and it must NOT decode `&nbsp;`, which R2 deliberately canonicalises the other way
 * so a dropped nbsp stays visible.
 */
const decodeNamedRefs = (s: string) => s.replace(/&rsquo;/g, '\u2019');

describe('HR Reimbursement · Submit — React vs the legacy golden', () => {
  it('renders the same document as hrRCForm() does', () => {
    expect(decodeNamedRefs(relax(renderToStaticMarkup(screen())))).toBe(decodeNamedRefs(relax(GOLDEN)));
  });

  it('wires the same handlers, to the same rows, in the same order', () => {
    assertHandlerParity();
  });
});

/**
 * R1 drops `on*=` from the string comparison, so the arguments have to come back some other way. Copied
 * per screen, not shared — `web/tests/handlers.ts` is off limits mid-migration — and widened with
 * `identArgs()` because this screen identifies a LINE by its bare integer index (`hrRCItemDel(0)`,
 * `hrRCItemMore(0)`): quoted-only extraction returns `[]` for every one of them and the check would
 * pass with the ✕ of line 2 deleting line 1.
 */
function identArgs(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(/'([^']*)'|"([^"]*)"|(?<![\w.])(-?\d+)(?![\w.])/g)) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

function assertHandlerParity(over: Partial<Parameters<typeof HrExpensesForm>[0]> = {}) {
  const want = goldenHandlers(GOLDEN).map((h) => ({ ...h, args: identArgs(h.raw) }));
  const calls: { attr: string; args: string[] }[] = [];
  const record = (attr: string) => (...args: unknown[]) =>
    calls.push({
      attr,
      args: args
        .filter((a) => (typeof a === 'string' && a !== STUB_VALUE) || typeof a === 'number')
        .map((a) => String(a)),
    });

  const got = reactHandlers(screen({
    // `✕ Close` is `hrRCNav('list')` in the legacy (hros.html:2048) and `onClose` here: the DESTINATION
    // moved out of the argument and into the prop's identity, so the recorder puts it back. That makes
    // the argument comparison meaningful again but says nothing about where `onClose` actually goes —
    // `web/tests/hr-expenses-route.test.ts` pins that against the route's own source.
    onClose: () => record('close')('list'),
    onItemType: record('itemType') as never,
    onItemMore: record('itemMore') as never,
    onItemDel: record('itemDel') as never,
    onItemAdd: record('itemAdd'),
    onItemCalc: record('itemCalc'),
    onScanTrigger: record('scanTrigger'),
    onScanPickFile: record('scanPick'),
    onScanFile: record('scanFile') as never,
    onPickReceipts: record('pickReceipts') as never,
    onSave: record('save') as never,
    ...over,
  }, record('nav') as never));

  expect(got.map((h) => h.attr)).toEqual(want.map((h) => h.attr));
  got.forEach((h) => { h.invoke(); });
  expect(calls.map((c) => c.args)).toEqual(want.map((h) => h.args));

  // Guard the guard: if the golden stops carrying handlers, both toEquals pass vacuously and R1 becomes
  // the blind strip it is not allowed to be. The bare-integer widening is what makes the second one
  // meaningful here, so assert an integer argument really is present.
  expect(want.length).toBeGreaterThan(0);
  expect(want.some((h) => h.args.some((a) => /^-?\d+$/.test(a)))).toBe(true);
}

describe('the comparison still bites', () => {
  const want = decodeNamedRefs(relax(GOLDEN));
  const wrong = (over: Partial<Parameters<typeof HrExpensesForm>[0]>) => decodeNamedRefs(relax(renderToStaticMarkup(screen(over))));

  it('is not decoding away the entity defect it exists to allow', () => {
    // `decodeNamedRefs` must leave `&amp;rsquo;` — the doubly-escaped spelling that prints the entity
    // on the page — visible, and must leave R2's `&nbsp;` canonicalisation alone.
    expect(decodeNamedRefs('&amp;rsquo;')).toBe('&amp;rsquo;');
    expect(decodeNamedRefs('&nbsp;')).toBe('&nbsp;');
    expect(decodeNamedRefs('&rsquo;')).toBe('\u2019');
  });

  it('catches an expense line disappearing', () => {
    expect(wrong({ items: [...BLANK, { ...BLANK[0] }] })).not.toBe(want);
  });

  it('catches the Submit button losing its guard', () => {
    // `saving` is what stops a double-tap becoming two claims. `disabled={false}` renders no attribute,
    // so the golden is the un-guarded state and this proves the attribute appears when it should.
    expect(wrong({ saving: true })).not.toBe(want);
    expect(renderToStaticMarkup(form({ saving: true }))).toMatch(/disabled/);
    expect(renderToStaticMarkup(form({ saving: false }))).not.toMatch(/disabled/);
  });

  it('catches a claim type vanishing from the picker', () => {
    const cfg = { ...CFG, claim_types: (CFG.claim_types || []).slice(1) };
    expect(wrong({ cfg })).not.toBe(want);
  });

  it('catches the form date being pre-filled from a different day', () => {
    expect(wrong({ today: '2026-08-19' })).not.toBe(want);
  });

  it('catches a queued receipt not being shown', () => {
    expect(wrong({ pending: [{ name: 'grab.pdf', size: 220000, type: 'application/pdf' }] })).not.toBe(want);
  });
});

/**
 * The `rc_*` element ids ARE the save. `hrRCSyncItems()` (hros.html:2062) reads this form back out of
 * the DOM by them, and so does `app/hr/expenses/page.tsx`'s `syncForm()`. An id that changed or went
 * missing syncs as `undefined` and saves as blank — a wiped amount or a dropped e-invoice UUID, with no
 * error anywhere. Extracted from hros.html at RUN TIME rather than retyped: a retyped list agrees with
 * a widened port by construction (CLAUDE.md, `whtSavePayee()`'s treatment).
 */
describe('the ids hrRCSyncItems() reads the form back by', () => {
  const sync = HROS.slice(HROS.indexOf('function hrRCSyncItems()'), HROS.indexOf('function hrRCItemAdd()'));

  it('found the legacy function', () => {
    expect(sync).toMatch(/getElementById\('rc_'\+id\)/);
    expect(sync).toMatch(/getElementById\('rc_it_'\+i\+'_'\+s\)/);
  });

  it('renders every top-level id the legacy reads', () => {
    const ids = [...sync.matchAll(/\bh\('([a-z]+)'\)/g)].map((m) => 'rc_' + m[1]);
    expect(new Set(ids).size).toBeGreaterThan(6);
    const html = renderToStaticMarkup(form());
    [...new Set(ids)].forEach((id) => expect(html, id).toContain(`id="${id}"`));
  });

  it('renders every per-line id the legacy reads, on the line that owns it', () => {
    const keys = [...sync.matchAll(/\bel\('([a-z]+)'\)/g)].map((m) => m[1]);
    expect(new Set(keys).size).toBeGreaterThan(18);
    // Both variants of the amount cell and the whole `⋯` block, on a MILEAGE line and a normal one,
    // because the legacy renders a different id set for each and the golden holds neither.
    const mileageId = (CFG.claim_types || []).find((t) => t.is_mileage)!.id;
    const normalId = (CFG.claim_types || []).find((t) => !t.is_mileage)!.id;
    const html = renderToStaticMarkup(form({
      items: [
        { claim_type_id: normalId, _open: true, amount: '86.40' },
        { claim_type_id: mileageId, _open: true, total_km: '60', mileage_rate: '0.6' },
      ],
    }));
    const seen = new Set([...html.matchAll(/id="rc_it_\d+_([a-z]+)"/g)].map((m) => m[1]));
    [...new Set(keys)].forEach((k) => expect(seen.has(k), k).toBe(true));
  });

  it('the declaration checkboxes carry the four ids hrRCDecs() reads', () => {
    const decs = HROS.slice(HROS.indexOf('function hrRCDecs()'), HROS.indexOf('async function hrRCSave('));
    const ids = [...decs.matchAll(/ck\('(dec\d)'\)/g)].map((m) => m[1]);
    expect(ids).toEqual(DECLARATIONS.map(([id]) => id));
    const html = renderToStaticMarkup(form());
    ids.forEach((id) => expect(html).toContain(`id="rc_${id}"`));
  });
});

/**
 * MONEY. `hrRCItemAmt()` (hros.html:1998) and `hr_rc_save`'s `amt` (hr.ts:2004) are the same line on the
 * two sides of the wire — the server recomputes every line and stores ITS answer — so a client that
 * rounds differently PRINTS one figure and FILES another.
 */
describe('the amounts', () => {
  it('rounds half-up at the sen, not toFixed', () => {
    // CLAUDE.md's rule: `(100.005).toFixed(2)` is "100.00" and `Math.round(100.005*100)/100` is 100.01.
    // Both idioms are in this codebase; only the second is the one the server stores.
    expect(itemAmount({ amount: '100.005' }, false)).toBe(100.01);
    expect(itemAmount({ amount: '100.005' }, false).toFixed(2)).not.toBe((100.005).toFixed(2));
  });

  it('a mileage line is km × rate + parking + toll, rounded once', () => {
    expect(itemAmount({ total_km: '60', mileage_rate: '0.6', parking_amount: '4', toll_amount: '2' }, true)).toBe(42);
    // The parking and the toll are NOT optional extras a tidier port could drop: without them the same
    // line pays 36.00 instead of 42.00.
    expect(itemAmount({ total_km: '60', mileage_rate: '0.6' }, true)).toBe(36);
  });

  it('the header total is the sum of the ROUNDED lines, never the rounding of the raw sum', () => {
    // Chosen to DIVERGE: 0.005 × 3 rounds to 0.01 each (0.03) but sums raw to 0.015 → 0.02. A fixture
    // that happened to agree would prove nothing (CLAUDE.md, finance.o2o).
    const cfg: RcConfig = { claim_types: [{ id: 'ct1', active: true, is_mileage: false }] };
    const items = [{ claim_type_id: 'ct1', amount: '0.005' }, { claim_type_id: 'ct1', amount: '0.005' }, { claim_type_id: 'ct1', amount: '0.005' }];
    expect(formTotal(items, cfg)).toBeCloseTo(0.03, 10);
    expect(Math.round(0.015 * 100) / 100).toBe(0.02);
  });

  it('a non-finite amount is not a number — isFinite, not isNaN', () => {
    // `Number('1e400')` is Infinity, `isNaN(Infinity)` is false, and `Infinity||0` is Infinity. The
    // legacy's `Number(x)||0` coercion is what keeps it out; mirrored, and pinned.
    expect(itemAmount({ amount: '1e400' }, false)).toBe(Infinity);
    expect(Number.isFinite(itemAmount({ amount: 'abc' }, false))).toBe(true);
    expect(itemAmount({ amount: 'abc' }, false)).toBe(0);
  });

  it('reads is_mileage off the claim type, not off the line', () => {
    expect(isMileage(CFG, (CFG.claim_types || []).find((t) => t.is_mileage)!.id)).toBe(true);
    expect(isMileage(CFG, (CFG.claim_types || []).find((t) => !t.is_mileage)!.id)).toBe(false);
    expect(isMileage(CFG, undefined)).toBe(false);
  });
});

/** No golden sees a request body. `hrRCSave()` — hros.html:2082. */
describe('what Save posts', () => {
  it('keeps only lines with a type AND an amount or a distance', () => {
    const items: RcFormItem[] = [
      { claim_type_id: 'ct1', amount: '10' },
      { claim_type_id: 'ct3', total_km: '5' },
      { claim_type_id: 'ct1', amount: '0' },        // typed a type, then nothing — not a claim line
      { claim_type_id: '', amount: '99' },          // an amount with no type — the server has no GL for it
      {},
    ];
    expect(keptItems(items)).toHaveLength(2);
  });

  it('carries every field hrRCSave() carries — read out of hros.html, not retyped', () => {
    const save = HROS.slice(HROS.indexOf('async function hrRCSave(submit)'), HROS.indexOf('function hrRCPickReceipts('));
    const claimSrc = save.slice(save.indexOf('var claim={'), save.indexOf('var r=await call({api:\'hr_rc_save\''));
    expect(claimSrc).toContain('items: items.map');

    const head = claimSrc.slice(0, claimSrc.indexOf('items: items.map'));
    const line = claimSrc.slice(claimSrc.indexOf('items: items.map'));
    const wantHead = [...head.matchAll(/([a-z_]+):\s*f\./g)].map((m) => m[1]);
    const wantLine = [...line.matchAll(/([a-z_]+):\s*(?:Number\()?!*it\./g)].map((m) => m[1]);
    expect(wantHead.length).toBeGreaterThan(6);
    expect(wantLine.length).toBeGreaterThan(18);

    const body = claimBody(
      { id: 'rc9', employee_id: 'e2', claim_date: '2026-08-18', claim_month: '2026-08', cost_center: 'SLS', department: 'Sales', project: 'P', remarks: 'R', description: 'D' } as RcForm,
      [{ claim_type_id: 'ct1', amount: '10', vendor_name: 'V', receipt_no: 'R1', invoice_no: 'I1', tax_amount: '1', sst_amount: '2', is_einvoice: true, supplier_tin: 'T', einvoice_uuid: 'U', einvoice_validation_url: 'W', gl_account: 'G', cost_center: 'C', project: 'PJ', remarks: 'RM', start_location: 'A', end_location: 'B', purpose: 'P', parking_amount: '3', toll_amount: '4', total_km: '5', mileage_rate: '0.6', item_date: '2026-08-17', description: 'X' }],
    );
    [...new Set(wantHead)].forEach((k) => expect(Object.keys(body), k).toContain(k));
    const l = (body.items as Record<string, unknown>[])[0];
    [...new Set(wantLine)].forEach((k) => expect(Object.keys(l), k).toContain(k));
  });

  it('sends the line date, falling back to the form date — never to today', () => {
    const body = claimBody({ claim_date: '2026-08-01' } as RcForm, [{ claim_type_id: 'ct1', amount: '5' }]);
    expect((body.items as Record<string, unknown>[])[0].item_date).toBe('2026-08-01');
  });

  it('sends employee_id as the form holds it and lets the SERVER decide', () => {
    // `hr_rc_save` (hr.ts:1978) pins a non-admin's claim to their own employee record and ignores this.
    // Re-implementing that rule client-side is how a refusal turns into a claim filed against the wrong
    // person; the client only has to not lie about what was typed.
    expect(claimBody({ employee_id: 'e2' } as RcForm, []).employee_id).toBe('e2');
    expect(claimBody({} as RcForm, []).employee_id).toBeUndefined();
  });

  it('omits id on a create and carries it on an edit', () => {
    expect(claimBody({} as RcForm, []).id).toBeUndefined();
    expect(claimBody({ id: 'rc9' } as RcForm, []).id).toBe('rc9');
  });
});

/** `hrRCSave()`'s refusals — hros.html:2085-2089. Order is the legacy's. */
describe('what Save refuses', () => {
  const ticked = { business_purpose: true, not_claimed_before: true, receipts_valid: true, understand_disciplinary: true };
  const line: RcFormItem[] = [{ claim_type_id: 'ct1', amount: '10' }];

  it('an ADMIN must pick an employee; an EMPLOYEE must not be asked to', () => {
    expect(saveRefusal({ isEmp: false, items: line, submit: false, declarations: ticked })).toBe('Select an employee');
    expect(saveRefusal({ isEmp: true, items: line, submit: false, declarations: ticked })).toBeNull();
  });

  it('refuses a form with no usable expense line', () => {
    expect(saveRefusal({ isEmp: true, items: [{}], submit: false, declarations: ticked }))
      .toBe('Add at least one expense line (type + amount)');
  });

  it('SUBMIT needs all four declarations; a DRAFT needs none', () => {
    const decs = { ...ticked, receipts_valid: false };
    expect(saveRefusal({ isEmp: true, items: line, submit: true, declarations: decs }))
      .toBe('Please tick all four declaration statements before submitting.');
    expect(saveRefusal({ isEmp: true, items: line, submit: false, declarations: decs })).toBeNull();
    // Each of the four on its own, so a port that checked only one still fails.
    (['business_purpose', 'not_claimed_before', 'receipts_valid', 'understand_disciplinary'] as const).forEach((k) => {
      expect(saveRefusal({ isEmp: true, items: line, submit: true, declarations: { ...ticked, [k]: false } })).not.toBeNull();
    });
  });
});

/** `hrRCPickReceipts()` — hros.html:2143. */
describe('picking receipts', () => {
  const f = (name: string, size: number, lastModified = 1) => ({ name, size, lastModified });

  it('refuses a file over the limit and says which, without losing the others', () => {
    const r = pickReceipts([], [f('ok.pdf', 1000), f('huge.pdf', HR_RC_MAX_BYTES + 1)]);
    expect(r.files.map((x) => x.name)).toEqual(['ok.pdf']);
    expect(r.refused).toEqual(['huge.pdf (45.0 MB)']);
    expect(tooBigMessage(r.refused)).toContain('Limit is 45 MB');
  });

  it('de-dupes on name+size+lastModified, so a re-render round trip cannot attach twice', () => {
    const a = f('grab.jpg', 500);
    expect(pickReceipts([a], [a]).files).toHaveLength(1);
    expect(pickReceipts([a], [f('grab.jpg', 501)]).files).toHaveLength(2);
  });

  it('the limit is the legacy constant, read out of hros.html', () => {
    expect(HROS).toContain('var HR_RC_MAX_BYTES = 45*1024*1024;');
    expect(HR_RC_MAX_BYTES).toBe(45 * 1024 * 1024);
  });

  it('sizes read the way hrRCPendingHtml() writes them', () => {
    expect(sizeLabel(0)).toBe('');
    expect(sizeLabel(1024)).toBe('1 KB');
    expect(sizeLabel(1048576)).toBe('1.0 MB');
    expect(sizeLabel(10)).toBe('1 KB');            // Math.max(1, …) — never "0 KB"
  });
});

/** Branches the golden cannot hold, mirrored from the legacy source. */
describe('the branches no golden reaches', () => {
  it('an EDIT says so in the title and lists what is already attached', () => {
    const html = renderToStaticMarkup(form({
      form: { id: 'rc9', _existingAtts: [{ file_name: 'grab.pdf', url: 'https://example.test/grab.pdf' }] },
    }));
    expect(html).toContain('Edit reimbursement form');
    expect(html).toContain('grab.pdf');
    expect(html).toContain('· saved');
  });

  it('a queued SCAN is offered for preview and removal, and says it attaches on save', () => {
    const html = renderToStaticMarkup(form({ scans: [{ name: 'receipt.pdf', size: 100 }] }));
    expect(html).toContain('Cropped receipt 1.pdf');
    expect(html).toContain('attaches on save');
  });

  it('a mileage line shows km × rate and the computed figure, not an amount box', () => {
    const mileageId = (CFG.claim_types || []).find((t) => t.is_mileage)!.id;
    const html = renderToStaticMarkup(form({ items: [{ claim_type_id: mileageId, total_km: '60', mileage_rate: '0.6' }] }));
    expect(html).toContain('id="rc_it_0_km"');
    expect(html).toContain('id="rc_it_0_amtL"');
    expect(html).not.toContain('id="rc_it_0_amt"');
    expect(html).toContain('RM 36.00');
  });

  it('an e-invoice line carries its pill', () => {
    expect(renderToStaticMarkup(form({ items: [{ claim_type_id: 'ct1', is_einvoice: true }] }))).toContain('e-Inv');
  });

  it('a blank line added by + Add takes the form date, and a deleted-to-empty one takes none', () => {
    expect(blankItem(CFG, '2026-08-01').item_date).toBe('2026-08-01');
    expect(blankItem(CFG, '').item_date).toBe('');
    // The default mileage rate is the one flagged `is_default`; this fixture flags none, so ''.
    expect(blankItem(CFG, '').mileage_rate).toBe('');
    expect(defaultRate({ mileage_rates: [{ rate: 0.6, active: true }, { rate: 0.9, active: true, is_default: true }] })).toBe(0.9);
  });
});
