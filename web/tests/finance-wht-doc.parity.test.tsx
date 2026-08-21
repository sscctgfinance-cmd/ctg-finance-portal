// Finance OS · Withholding Tax — the COMPUTATION PAGE, against the legacy source it replaces.
//
// ── THERE IS NO GOLDEN FOR THIS PAGE, AND THAT CHANGES THE JOB ────────────────────────────────────
// `tests/golden/finance.wht.html` was captured at `WHT.page === 'list'`. `whtDocHtml()` (app.html:3381)
// is the OTHER page `renderWht()` dispatches to, and the 40-surface harness never reached it. So there
// is no byte-level baseline and no `relax()` comparison here: every claim below is either a STRUCTURAL
// assertion about what this port renders, or a claim about the legacy READ OUT OF `app.html` at run
// time so it cannot drift from the function it protects.
//
// Nothing here regenerates or edits a golden, and nothing here touches tests/parity.ts,
// tests/handlers.ts or tests/render_surfaces.ts.
//
// ── WHAT IS WORTH GUARDING, IN ORDER ──────────────────────────────────────────────────────────────
// 1. THE FIGURES. This page prints what a real company remits to LHDN. Every number must come from
//    wht.js and no other place; the test drives that against `whtCompute` directly and separately
//    against a fixture chosen so the gross and net bases DISAGREE.
// 2. THE FIELD IDS. `whtSync()` reads the form back out of the DOM by id. A field that loses its id
//    syncs as blank — a wiped period, a rate silently reset to 0, or a payment line that never reaches
//    the filing — and nothing on screen says so.
// 3. THE POST BODY. No golden sees a request; `saveBody()`'s field set, its `entity_tin` lookup and
//    its three refusals are provable nowhere else.
// 4. THE PRINTED DOCUMENT. It leaves the building. Its figures, its basis note, its due date and the
//    LHDN form number it names are asserted here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { whtCompute, whtDueDate, whtMoney } from '../../wht.js';
import { whtReachable } from '../src/finance-wht';
import FinanceWhtDoc, {
  printDocHtml, saveBody, saveLines, whtCoName, whtFormNo,
  type Company, type WhtDocLine, type WhtDocState, type WhtEntity,
} from '../src/finance-wht-doc';
import { FIXTURES } from '../../tests/render_fixtures';
import { REPO } from './parity';

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');
const SRC = readFileSync(join(REPO, 'web', 'src', 'finance-wht-doc.tsx'), 'utf8');

const CFG = FIXTURES.wht_config as { entities: WhtEntity[]; payees: { id: number; name: string; tin?: string; country?: string; wht_rate: number; statutory_rate?: number; wht_type?: string; treaty_relief?: boolean; has_cor?: boolean }[] };
const COMPANIES: Company[] = CFG.entities.map((e) => ({ tenant_id: e.tenant_id, tenant_name: String(e.name) }));

/**
 * A computation built from the shipped `wht_config`, with figures chosen so the two bases differ by
 * more than rounding and so the SST is a non-round number. A fixture whose gross and net answers happen
 * to agree proves nothing about which one this page prints.
 */
const DOC: WhtDocState = {
  id: 7, doc_no: 'WHT-202608-0002', tenant_id: CFG.entities[0].tenant_id,
  payee_id: 2, payee_name: 'META PLATFORMS IRELAND LIMITED', payee_tin: 'C29806901060', payee_country: 'IRELAND',
  wht_rate: 0.08, wht_type: 'royalty', basis: 'gross', sst_rate: 0.08,
  penalty_pct: 0.10, penalty_on: false, status: 'draft', period_label: 'August 2026', notes: '',
};
const LINES: WhtDocLine[] = [
  { payment_date: '2026-08-03', receipt_no: 'INV-9911', description: 'Ad credits', amount: 1234.56 },
  { payment_date: '2026-08-21', receipt_no: 'INV-9912', description: 'Ad credits', amount: 887.44 },
  {},
  {},
  {},
];

const noop = () => {};
type Props = Parameters<typeof FinanceWhtDoc>[0];

function screen(over: Partial<Props> = {}) {
  return (
    <FinanceWhtDoc
      doc={DOC}
      lines={LINES}
      entities={CFG.entities}
      payees={CFG.payees}
      companies={COMPANIES}
      onField={noop}
      onLineField={noop}
      onPayee={noop}
      onAddLine={noop}
      onDelLine={noop}
      onSave={noop}
      onPrint={noop}
      onDelete={noop}
      onBack={noop}
      {...over}
    />
  );
}
const html = (over: Partial<Props> = {}) => renderToStaticMarkup(screen(over));

describe('the figures come from wht.js, and from nowhere else', () => {
  // The whole reason wht.js exists (its own header, and CLAUDE.md): a tax computation with two copies
  // is a wrong filing waiting for the day the copies disagree. These assertions are written against
  // `whtCompute`'s OWN output rather than against typed-in expected strings, so a port that re-derived
  // a figure — even correctly, today — would only pass while the two happened to agree.
  const c = whtCompute(DOC, LINES);

  it('prints the subtotal, the SST, the tax, the total and the net the shared engine produces', () => {
    const out = html();
    for (const [id, want] of [
      ['w_fee', c.fee], ['w_sstt', c.sst], ['w_incl', c.feeInclSst],
      ['w_grossbase', c.fee], ['w_wht', c.wht], ['w_pena', c.penalty],
      ['w_total', c.total], ['w_netpay', c.netToPayee],
    ] as [string, number][]) {
      expect(out, id).toContain(`id="${id}"`);
      expect(out, id).toContain(whtMoney(want));
    }
  });

  it('never re-derives one: this file rounds nothing and applies no rate', () => {
    // The guard against a helpful "just multiply it here" edit. Every figure on this page is a
    // `whtMoney(c.…)`; there is no arithmetic on money in this file at all.
    const body = SRC.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    expect(body).not.toMatch(/Math\.round/);
    expect(body).not.toMatch(/\/\s*\(\s*1\s*-/);          // a gross-up
    expect(body).not.toMatch(/\*\s*(rate|wht_rate)\b/);   // a rate applied
  });

  it('reads no clock — no date is derived here, and the due date is wht.js\'s', () => {
    // finance.calendar's finding: a date defect that only shows west of Greenwich cannot be seen by an
    // output assertion on this fleet (this machine and CI are both UTC+8). So the SOURCE is pinned.
    // `whtDueDate()` builds its instant in UTC (wht.js:71) and is covered by tests/wht_test.ts.
    const body = SRC.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    expect(body).not.toMatch(/new Date\b/);
    expect(body).not.toMatch(/Date\.now\b/);
    expect(body).not.toMatch(/toLocale/);
  });

  it('excludes the s.26A service tax from the withholding base — the workbook defect wht.js exists for', () => {
    // A fixture-independent statement of the rule this page must not quietly undo: raising the SST rate
    // changes the SST column and the fee+SST total, and moves the tax NOT AT ALL.
    const more = whtCompute({ ...DOC, sst_rate: 0.5 }, LINES);
    expect(more.sst).not.toBe(c.sst);
    expect(more.wht).toBe(c.wht);
    const out = html({ doc: { ...DOC, sst_rate: 0.5 } });
    expect(out).toContain(whtMoney(more.sst));
    expect(out).toContain(whtMoney(c.wht));
  });

  it('prints the NET basis differently from the gross one — on a fixture where they disagree', () => {
    const net = whtCompute({ ...DOC, basis: 'net' }, LINES);
    expect(net.wht).not.toBe(c.wht);
    expect(net.gross).not.toBe(c.fee);
    const out = html({ doc: { ...DOC, basis: 'net' } });
    expect(out).toContain(whtMoney(net.wht));
    expect(out).toContain('Grossed-up amount');
    expect(out).toContain('(before gross-up)');
    // ...and the gross basis says so instead, with the gross-up row present but hidden (app.html:3444).
    const gross = html();
    expect(gross).not.toContain('Grossed-up amount');
    expect(gross).toContain('display:none');
    expect(gross).toContain('id="w_gross"');
  });

  it('adds the s.109(2) increase only when the box is ticked, and shows it in the total', () => {
    const late = whtCompute({ ...DOC, penalty_on: true }, LINES);
    expect(late.penalty).toBeGreaterThan(0);
    expect(late.total).toBeCloseTo(late.wht + late.penalty, 2);
    const out = html({ doc: { ...DOC, penalty_on: true } });
    expect(out).toMatch(/id="w_pen"[^>]*\schecked/);
    expect(out).toContain(whtMoney(late.total));
    expect(html()).not.toMatch(/id="w_pen"[^>]*\schecked/);
  });

  it('foots the column the way it is PRINTED — sen-rounded per line, not on the aggregate', () => {
    // wht.js's own comment (wht.js:55): applying the rate to the aggregate leaves a subtotal the
    // visible rows do not add up to. Driven with three lines that do exactly that.
    const odd: WhtDocLine[] = [{ amount: 50.005 }, { amount: 50.005 }, { amount: 50.005 }];
    const printed = whtCompute(DOC, odd);
    const out = html({ lines: odd });
    expect(out).toContain(whtMoney(printed.fee));
    // Each row's own SST and total are the shared engine's too, so the column casts.
    expect(out).toContain('id="wl_s0"');
    expect(out).toContain('id="wl_t0"');
  });
});

describe('the form ids — the contract whtSync() reads this page back by', () => {
  // Extracted from app.html at run time, not retyped: a retyped list agrees with a narrowed port by
  // construction. `whtSync()` (app.html:3312) is the function these ids belong to.
  const sync = APP.slice(APP.indexOf('function whtSync(){'), APP.indexOf('function whtSetPayee('));

  it('found whtSync() in app.html at all', () => {
    expect(sync).toContain("d.tenant_id=v('w_entity')");
    expect(sync.length).toBeGreaterThan(200);
  });

  it('renders every document-level id whtSync() reads', () => {
    const ids = [...new Set([...sync.matchAll(/'(w_[a-z]+)'/g)].map((m) => m[1]))];
    expect(ids.sort()).toEqual(['w_basis', 'w_entity', 'w_notes', 'w_pen', 'w_period', 'w_rate', 'w_sst']);
    const out = html();
    for (const id of ids) expect(out, id).toContain(`id="${id}"`);
  });

  it('renders every per-line id whtSync() reads, for every line, in index order', () => {
    const prefixes = [...new Set([...sync.matchAll(/'(wl_[a-z])'\s*\+\s*i/g)].map((m) => m[1]))];
    expect(prefixes.sort()).toEqual(['wl_a', 'wl_d', 'wl_r', 'wl_x']);
    const out = html();
    for (let i = 0; i < LINES.length; i++) {
      for (const p of prefixes) expect(out, p + i).toContain(`id="${p}${i}"`);
    }
    // ...and NO id for a line that does not exist, which would sync a phantom payment.
    for (const p of prefixes) expect(out).not.toContain(`id="${p}${LINES.length}"`);
  });

  it('renders every derived cell id whtRecalc() writes', () => {
    const recalc = APP.slice(APP.indexOf('function whtRecalc(){'), APP.indexOf('function whtDocHtml(){'));
    const ids = [...new Set([...recalc.matchAll(/set\('(w_[a-z]+)'/g)].map((m) => m[1]))];
    expect(ids.length).toBeGreaterThan(5);
    const out = html();
    for (const id of ids) expect(out, id).toContain(`id="${id}"`);
    // Per-line derived cells, same source.
    const linePrefixes = [...new Set([...recalc.matchAll(/set\('(wl_[a-z])'\s*\+\s*i/g)].map((m) => m[1]))];
    expect(linePrefixes.sort()).toEqual(['wl_s', 'wl_t']);
    for (let i = 0; i < LINES.length; i++) for (const p of linePrefixes) expect(out).toContain(`id="${p}${i}"`);
  });

  it('keeps the form UNCONTROLLED — no React `value=` that would fight the DOM read', () => {
    // A controlled port would emit `value=""` on an empty box and the route's `document.getElementById`
    // read would still work, but the caret would jump on every keystroke that changes a derived cell.
    // The rendered markup carries `value=` from defaultValue only; what is asserted is that nothing is
    // rendered with an empty React-controlled value where the legacy renders none.
    expect(html()).toMatch(/id="w_period"[^>]*value="August 2026"/);
  });

  it('pins the payee sub-line to the DOC\'s TIN, not the picker\'s', () => {
    // The TIN printed under the picker is `d.payee_tin` (app.html:3428) — the copy the computation
    // carries. Reading it off the payee list instead would show today's TIN on a return filed under an
    // old one.
    expect(html()).toContain('TIN C29806901060 · IRELAND');
    expect(html({ doc: { ...DOC, payee_tin: null } })).not.toContain('TIN C29806901060');
  });
});

describe('the Certificate of Residence warning — the one thing on this page LHDN can reassess', () => {
  // Payee 2 in the shipped fixture is the case: an 8% treaty rate with NO COR on file, against a 10%
  // statutory rate.
  const p2 = CFG.payees.find((p) => p.id === 2)!;
  const p3 = CFG.payees.find((p) => p.id === 3)!;

  it('warns when a treaty rate is applied with no COR, naming the payee and the statutory rate', () => {
    const out = html({ doc: { ...DOC, _payee: p2 } });
    expect(out).toContain('Certificate of Residence is recorded');
    expect(out).toContain('META PLATFORMS IRELAND LIMITED');
    expect(out).toContain('(10%)');
  });

  it('is silent for a payee holding a COR, and for one claiming no treaty relief', () => {
    expect(html({ doc: { ...DOC, _payee: p3 } })).not.toContain('Certificate of Residence is recorded');
    expect(html({ doc: { ...DOC, _payee: { ...p2, treaty_relief: false } } })).not.toContain('Certificate of Residence is recorded');
  });

  it('reads the payee out of the CONFIG when the doc carries only an id', () => {
    // `whtOpen()` (app.html:3336) restores a saved computation with `payee_id` and no `_payee`, so a
    // port that only looked at `_payee` would drop the warning on every REOPENED document — which is
    // every document an operator reviews before filing.
    const out = html({ doc: { ...DOC, _payee: null, payee_id: 2 } });
    expect(out).toContain('Certificate of Residence is recorded');
  });
});

describe('whtFormNo() — the LHDN return this computation is remitted on', () => {
  // Pinned against app.html's own expression rather than retyped, because a payee filed under the wrong
  // section is remitted on the wrong return. See the note in src/finance-wht-doc.tsx on why this stayed
  // out of wht.js.
  it('matches app.html\'s mapping, in both places app.html writes it', () => {
    const hits = [...APP.matchAll(/wht_type==='s4a_special'\)\?'([^']+)':\(d\.wht_type==='contract'\?'([^']+)':'([^']+)'\)/g)];
    expect(hits.length).toBe(2);   // the on-screen note and the printed document
    for (const [, special, contract, other] of hits) {
      expect(whtFormNo('s4a_special')).toBe(special);
      expect(whtFormNo('contract')).toBe(contract);
      expect(whtFormNo('royalty')).toBe(other);
      expect(whtFormNo('interest')).toBe(other);
      expect(whtFormNo(null)).toBe(other);
    }
  });

  it('names the form and the deadline on screen, once there is a payment date', () => {
    const out = html();
    expect(out).toContain(String(whtDueDate(LINES)));
    expect(out).toContain('CP37, paid via ByrHASiL / e-TT.');
    expect(html({ doc: { ...DOC, wht_type: 's4a_special' } })).toContain('CP37D');
  });

  it('says nothing about a deadline when no line carries a payment date', () => {
    expect(html({ lines: [{ amount: 100 }] })).not.toContain('Remittance due');
  });
});

describe('saveBody() — the POST no golden can see', () => {
  it('carries the summary and the KEPT lines, with the payer\'s TIN resolved from the config', () => {
    const body = saveBody(DOC, LINES, 'draft', CFG.entities);
    expect(body.summary.entity_tin).toBe(CFG.entities[0].tax_no);
    expect(body.summary.status).toBe('draft');
    expect(body.lines).toHaveLength(2);
    expect(body.lines.map((l) => l.receipt_no)).toEqual(['INV-9911', 'INV-9912']);
  });

  it('files under the TIN of the company PICKED, not the first one', () => {
    const other = saveBody({ ...DOC, tenant_id: CFG.entities[1].tenant_id }, LINES, 'draft', CFG.entities);
    expect(other.summary.entity_tin).toBe(CFG.entities[1].tax_no);
    expect(CFG.entities[1].tax_no).not.toBe(CFG.entities[0].tax_no);
  });

  it('sends a NULL tin rather than another company\'s when the entity is unknown', () => {
    expect(saveBody({ ...DOC, tenant_id: 'nope' }, LINES, 'draft', CFG.entities).summary.entity_tin).toBeNull();
  });

  it('marks final only when asked, and keeps the existing status otherwise', () => {
    expect(saveBody(DOC, LINES, 'final', CFG.entities).summary.status).toBe('final');
    expect(saveBody({ ...DOC, status: 'filed' }, LINES, '', CFG.entities).summary.status).toBe('filed');
  });

  it('refuses a computation with no company, no payee, or no line', () => {
    expect(() => saveBody({ ...DOC, tenant_id: '' }, LINES, 'draft', CFG.entities)).toThrow(/paying company/);
    expect(() => saveBody({ ...DOC, payee_name: '' }, LINES, 'draft', CFG.entities)).toThrow(/payee/);
    expect(() => saveBody(DOC, [{}, {}, {}], 'draft', CFG.entities)).toThrow(/payment line/);
  });

  it('keeps a line with a date or a receipt but no amount yet — and drops a truly blank one', () => {
    // app.html:3467's filter, which also decides the DUE DATE: dropping a dated row with no amount
    // shortens the period the deadline is computed from.
    expect(saveLines([{ payment_date: '2026-08-01' }])).toHaveLength(1);
    expect(saveLines([{ receipt_no: 'X' }])).toHaveLength(1);
    expect(saveLines([{ receipt_no: '   ' }])).toHaveLength(0);
    expect(saveLines([{ amount: 0 }])).toHaveLength(0);
    expect(saveLines([{}])).toHaveLength(0);
  });

  it('is the SAME filter the legacy uses for saving and for printing', () => {
    const save = APP.slice(APP.indexOf('async function whtSave(status){'), APP.indexOf('async function whtDelete(){'));
    const print = APP.slice(APP.indexOf('function whtPrint(){'), APP.indexOf('/* ── Personal (Self-Billed)'));
    const rule = "(Number(l.amount)||0)>0 || (l.receipt_no||'').trim() || l.payment_date";
    expect(save).toContain(rule);
    expect(print).toContain(rule);
  });
});

describe('printDocHtml() — the document that leaves the building', () => {
  const doc = printDocHtml(DOC, LINES, COMPANIES, CFG.entities);
  const c = whtCompute(DOC, LINES);

  it('names the payer, its TIN, the payee, its TIN, the country and the period', () => {
    expect(doc).toContain(whtCoName(COMPANIES, DOC.tenant_id));
    expect(doc).toContain(String(CFG.entities[0].tax_no));
    expect(doc).toContain('META PLATFORMS IRELAND LIMITED');
    expect(doc).toContain('C29806901060');
    expect(doc).toContain('IRELAND');
    expect(doc).toContain('August 2026');
  });

  it('prints the same figures the screen prints — the shared engine\'s', () => {
    for (const n of [c.fee, c.sst, c.feeInclSst, c.wht, c.total]) expect(doc).toContain(whtMoney(n));
  });

  it('prints only the KEPT lines, numbered from 1', () => {
    expect(doc).toContain('<td>INV-9911</td>');
    expect(doc).toContain('<td>INV-9912</td>');
    // Five rows are on screen; three are BLANK and must not appear on a statutory document. Counting
    // the descriptions is not enough — a blank row carries no description either, so the guard has to
    // count ROWS. (This assertion was written the weaker way first and passed on the defect.)
    const body = doc.slice(doc.indexOf('<tbody>', doc.indexOf('<th>Payment date')), doc.indexOf('</tbody>', doc.indexOf('<th>Payment date')));
    expect((body.match(/<tr>/g) || []).length).toBe(saveLines(LINES).length);
    expect(body).toContain('<tr><td>1</td>');
    expect(body).toContain('<tr><td>2</td>');
    expect(body).not.toContain('<tr><td>3</td>');
  });

  it('states the basis, and adds the gross-up sentence ONLY on the net basis', () => {
    expect(doc).toContain('withholding tax is charged on the fee excluding Malaysian service tax');
    expect(doc).not.toContain('grossed up because the tax is borne by the payer');
    const net = printDocHtml({ ...DOC, basis: 'net' }, LINES, COMPANIES, CFG.entities);
    expect(net).toContain('grossed up because the tax is borne by the payer');
    expect(net).toContain('Grossed-up amount');
    expect(net).toContain(whtMoney(whtCompute({ ...DOC, basis: 'net' }, LINES).gross));
  });

  it('states the deadline and the form number', () => {
    expect(doc).toContain('Remittance due ' + whtDueDate(LINES));
    expect(doc).toContain('form CP37.');
    expect(printDocHtml({ ...DOC, wht_type: 'contract' }, LINES, COMPANIES, CFG.entities)).toContain('form CP37A / CP37F.');
  });

  it('shows the 10% increase row only when it applies', () => {
    expect(doc).not.toContain('Increase 10% (s.109(2))');
    expect(printDocHtml({ ...DOC, penalty_on: true }, LINES, COMPANIES, CFG.entities)).toContain('Increase 10% (s.109(2))');
  });

  it('prints the SST rate in the column header, as a percentage of the rate on the doc', () => {
    expect(doc).toContain('SST 8%');
    expect(printDocHtml({ ...DOC, sst_rate: 0.06 }, LINES, COMPANIES, CFG.entities)).toContain('SST 6%');
  });

  it('escapes what an operator typed — a note is not markup', () => {
    const evil = printDocHtml({ ...DOC, notes: '<script>x</script>' }, LINES, COMPANIES, CFG.entities);
    expect(evil).not.toContain('<script>x</script>');
    expect(evil).toContain('&lt;script&gt;');
  });

  it('is a string — the window is opened by the route, not here', () => {
    expect(typeof doc).toBe('string');
    expect(SRC.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')).not.toContain('window.open');
  });
});

describe('the legacy defects this port mirrors rather than fixes', () => {
  // Both are the `ln()` finding (hros.html:4837) in a second app: React cannot emit a duplicate
  // attribute, and a parser drops the second one anyway — so the DOM this port produces is the DOM the
  // legacy actually has. Pinned against app.html so a legacy fix shows up here as a failing test
  // rather than as a silent divergence.
  it('app.html writes TWO style= attributes on the "Fee (RM)" header, so its min-width never applied', () => {
    expect(APP).toContain('<th class="amt" style="text-align:right" style="min-width:110px">Fee (RM)</th>');
    const out = html();
    expect(out).toContain('>Fee (RM)</th>');
    expect(out).not.toContain('min-width:110px');
  });

  it('app.html writes TWO style= attributes on the LHDN total, so it has never been coral', () => {
    expect(APP).toContain('id="w_total" style="color:var(--coral,#e2604b)"');
    const out = html();
    expect(out).toContain('id="w_total"');
    expect(out).not.toContain('e2604b');
  });

  it('whtRecalc() never updates w_grossbase — the row this port cannot leave stale', () => {
    const recalc = APP.slice(APP.indexOf('function whtRecalc(){'), APP.indexOf('function whtDocHtml(){'));
    expect(recalc).toContain("set('w_fee'");
    expect(recalc).not.toContain('w_grossbase');
    // Here it is derived in the same pass as everything else, so the two rows cannot disagree.
    const c = whtCompute(DOC, LINES);
    const out = html();
    expect(out).toContain(`id="w_grossbase"`);
    expect(out.indexOf(whtMoney(c.fee))).toBeGreaterThan(0);
  });
});

describe('the wiring — every control bound to the thing it sits next to', () => {
  // No golden means no `assertHandlerParity()` to lean on, so the bindings are driven directly. A row's
  // ✕ deleting the wrong payment line silently changes what is filed.
  function record() {
    const calls: [string, unknown[]][] = [];
    const on = (n: string) => (...a: unknown[]) => { calls.push([n, a]); };
    return { calls, on };
  }

  it('binds each line\'s ✕ to its own index, and each input to its own index and field', () => {
    const { calls, on } = record();
    const node = screen({ onDelLine: on('del') as never, onLineField: on('line') as never });
    // Walk the tree and invoke every handler, recording what each one reports.
    const seen: [string, unknown[]][] = [];
    walk(node, (props) => {
      for (const [k, v] of Object.entries(props)) {
        if (!/^on[A-Z]/.test(k) || typeof v !== 'function') continue;
        calls.length = 0;
        (v as (e: unknown) => void)({ target: { value: 'V', checked: true } });
        for (const c of calls) seen.push(c);
      }
    });
    const dels = seen.filter(([n]) => n === 'del').map(([, a]) => a[0]);
    expect(dels).toEqual([0, 1, 2, 3, 4]);
    const lineCalls = seen.filter(([n]) => n === 'line').map(([, a]) => [a[0], a[1]]);
    // Four inputs per row, in the legacy's column order.
    expect(lineCalls.slice(0, 4)).toEqual([[0, 'payment_date'], [0, 'receipt_no'], [0, 'description'], [0, 'amount']]);
    expect(lineCalls.slice(4, 8)).toEqual([[1, 'payment_date'], [1, 'receipt_no'], [1, 'description'], [1, 'amount']]);
    expect(lineCalls).toHaveLength(LINES.length * 4);
  });

  it('binds Save draft and Mark final to their own statuses — not to each other', () => {
    const { calls, on } = record();
    const node = screen({ onSave: on('save') as never });
    walk(node, (props) => {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'onClick' && typeof v === 'function') (v as () => void)();
      }
    });
    expect(calls.filter(([n]) => n === 'save').map(([, a]) => a[0])).toEqual(['draft', 'final']);
  });

  it('binds each document field to its own key, and the percent boxes to the rate keys', () => {
    const { calls, on } = record();
    const node = screen({ onField: on('field') as never });
    walk(node, (props) => {
      for (const [k, v] of Object.entries(props)) {
        if ((k === 'onInput' || k === 'onChange') && typeof v === 'function') (v as (e: unknown) => void)({ target: { value: 'V', checked: true } });
      }
    });
    expect(calls.filter(([n]) => n === 'field').map(([, a]) => a[0]))
      .toEqual(['tenant_id', 'period_label', 'wht_rate', 'basis', 'sst_rate', 'penalty_on', 'notes']);
  });

  it('shows Delete only for a computation that exists', () => {
    expect(html()).toContain('Delete');
    expect(html({ doc: { ...DOC, id: null } })).not.toContain('>Delete<');
  });
});

describe('the gate', () => {
  // The doc page reaches the SAME data the list does — payees' names, TINs, treaty positions and the
  // tax withheld — so it uses the same predicate rather than a second copy of app.html:1430.
  it('is the list screen\'s predicate, not a second one', () => {
    expect(whtReachable({ manage_users: true })).toBe(true);
    expect(whtReachable({ manage_users: false })).toBe(false);
    expect(whtReachable(null)).toBe(false);
    const route = readFileSync(join(REPO, 'web', 'app', 'finance', 'wht', 'doc', 'page.tsx'), 'utf8');
    expect(route).toContain('whtReachable');
    expect(route).toContain("from '../../../../src/finance-wht'");
  });

  it('the list screen no longer hands this page off to app.html', () => {
    const list = readFileSync(join(REPO, 'web', 'app', 'finance', 'wht', 'page.tsx'), 'utf8');
    expect(list).toContain('/finance/wht/doc/');
    expect(list).not.toMatch(/onOpen=\{\(\)\s*=>\s*\{\s*location\.href\s*=\s*`\$\{legacyUrl\('app\.html'\)\}#tab=wht`/);
  });
});

/** Walk a rendered element tree, handing every element's props to `fn`, deepest-last. */
function walk(node: unknown, fn: (props: Record<string, unknown>) => void): void {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, fn); return; }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (!el.props) return;
  if (typeof el.type === 'function') {
    walk((el.type as (p: unknown) => unknown)(el.props), fn);
    return;
  }
  fn(el.props);
  walk(el.props.children, fn);
}
