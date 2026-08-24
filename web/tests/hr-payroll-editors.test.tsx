// HR OS · Payroll — the three RECORD EDITORS: ⚙️ Rates, 🏢 Company, 🆔 Statutory numbers.
//
// ── THERE IS NO GOLDEN FOR ANY OF THEM, WHICH DECIDES WHAT THIS FILE HAS TO BE ────────────────────
// `hrRatesPanel()` and `hrEmployerPanel()` render only on `HR.pay.showRates` / `HR.pay.showEmployer`
// (hros.html:4098-4099) and `hrStatIdsPanel()` returns '' unless `HR_STATIDS.open` (hros.html:3923).
// All three are false in every captured surface, so `tests/golden/hr.payroll.html` holds none of them
// and the screen's parity diff is unmoved by this whole migration. Nothing here regenerates, edits or
// adds a golden, and nothing here touches tests/render_surfaces.ts, tests/parity.ts or tests/handlers.ts.
//
// In place of a diff, four kinds of evidence:
//
//  1. THE POST BODY, driven directly. The Payroll screen is the one place in this repo where a control
//     looked live and did nothing (`hr_payroll_save_entries` is not an action the server implements), so
//     "it renders" is explicitly not enough here. Each of the three `*Body()` functions is pure and is
//     asserted against what the legacy sends — including the parts that are invisible in markup: the
//     % → decimal division, the keys that must SURVIVE a rates save, the doc_code rule, and `logo: null`
//     meaning CLEAR rather than "leave alone".
//  2. THE DOM CONTRACT, read out of hros.html AT RUN TIME. Every one of these forms is uncontrolled and
//     is read back by element id at save time, so an input that loses its id posts as blank — on this
//     screen that is a wiped EPF employer number or a statutory rate silently set to null. The id sets
//     are extracted from the legacy source rather than retyped, because a retyped list agrees with a
//     narrowed port by construction.
//  3. PER-ROW BINDING for the statutory-numbers grid. Four identical text boxes per row, N rows, and R1
//     strips every handler from a string comparison — a cell wired to the row above writes one
//     employee's EPF member number onto another's record with nothing on screen looking wrong.
//  4. THE DOUBLE-SUBMIT GUARD, both halves: the component must actually emit `disabled`, and the ROUTE
//     must set the flag BEFORE the request and clear it in `finally`. The route has no output to assert
//     through, so it is pinned by source with comments blanked — `finance-o2o`'s treatment.
//
// NO SEVENTH RELAXATION, and no screen-local decoding rule: none of these three renderers writes a
// named or numeric character reference, a duplicate attribute in a place React must match, an empty
// `style=""` or a bare `&` that reaches a comparison here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FIXTURES, COMPANIES, HR_TENANT } from '../../tests/render_fixtures';
import HrPayroll, {
  EMPLOYER_TEXT_FIELDS, LOGO_JPEG_QUALITY, LOGO_MAX_DATA_URI, LOGO_MAX_FILE_BYTES, LOGO_MAX_WIDTH,
  RATES_INPUT_IDS, STAT_ID_COLS,
  claimNumberSample, dueInfo, employerBody, employerInit, gridAll, gridInit, gridState,
  logoDataRefusal, logoFileRefusal, logoScale, ratesBody, rtPct, statIdsBody, statIdsRows,
  type EmployerEdit, type GridRow, type PayData, type RatesCfg, type StatIdField, type StatIdRow,
} from '../src/hr-payroll';
import { REPO } from './parity';
import { reactHandlers, STUB_VALUE } from './handlers';

const HROS = readFileSync(join(REPO, 'hros.html'), 'utf8');

/** Comments blanked, for the route pins — the prose below quotes the very tokens they look for. */
const ROUTE = readFileSync(join(REPO, 'web/app/hr/payroll/page.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/** A named slice of hros.html, so every claim about the legacy is read rather than remembered. */
function legacy(from: string, to: string): string {
  const a = HROS.indexOf(from);
  expect(a).toBeGreaterThan(-1);
  const b = HROS.indexOf(to, a + from.length);
  expect(b).toBeGreaterThan(a);
  return HROS.slice(a, b);
}

const COMPANY_NAME = COMPANIES.find((c) => c.tenant_id === HR_TENANT)!.tenant_name;
const DATA = FIXTURES.hr_payroll_data as PayData;
const RATES = DATA.rates as RatesCfg;
const PERIOD = { month: 8, year: 2026 };
const NOW = new Date('2026-08-18T09:30:00.000Z');
const GRID: Record<string, GridRow> = gridInit(DATA);
const ALL = gridAll(DATA, GRID, PERIOD);
const noop = () => {};

type Props = Parameters<typeof HrPayroll>[0];

function element(over: Partial<Props> = {}) {
  return (
    <HrPayroll
      companyName={COMPANY_NAME}
      month={PERIOD.month}
      year={PERIOD.year}
      grid={GRID}
      rows={ALL.rows}
      tot={ALL.tot}
      skipped={[]}
      locked={false}
      finalised={false}
      state={gridState(DATA.run || null, false)}
      ticks={{}}
      uob={{}}
      today="2026-08-18"
      due={dueInfo(PERIOD.month, PERIOD.year, NOW)}
      onPickPeriod={noop}
      onRatesToggle={noop}
      onRatesSave={noop}
      onEmployerToggle={noop}
      onEmployerLogoPick={noop}
      onEmployerLogoClear={noop}
      onEmployerSave={noop}
      onStatIdsOpen={noop}
      onStatIdsClose={noop}
      onStatIdsCell={noop}
      onStatIdsSave={noop}
      onGridSave={noop}
      onFinalise={noop}
      onEditFinalised={noop}
      onRowMenu={noop}
      onCell={noop}
      onPcbCell={noop}
      onPcbAuto={noop}
      onDedOpen={noop}
      onDedAdd={noop}
      onDedDel={noop}
      onDedLabel={noop}
      onDedAmt={noop}
      onSkip={noop}
      onResign={noop}
      onEmpDelete={noop}
      onSubmitAll={noop}
      onUobSave={noop}
      onExpBank={noop}
      onExpGiro={noop}
      onExpKwsp={noop}
      onExpAssist={noop}
      onExpCp39={noop}
      onPostXero={noop}
      onExpSummary={noop}
      onExpPayslips={noop}
      onEmailAll={noop}
      onExpStatutory={noop}
      onHubTick={noop}
      {...over}
    />
  );
}

const render = (over: Partial<Props> = {}): string => renderToStaticMarkup(element(over));

/* ═══════════════════════ 0 · all three are CLOSED unless asked for ═══════════════════════ */

describe('the three panels are closed by default — which is why no golden holds one', () => {
  it('renders none of them with no state for them', () => {
    const html = render();
    expect(html).not.toContain('Statutory rates &amp; reliefs');
    expect(html).not.toContain('🏢 Company details —');
    expect(html).not.toContain('Statutory numbers —');
    // …while the three buttons that OPEN them are on the screen, which is what the golden does hold.
    expect(html).toContain('⚙️ Rates');
    expect(html).toContain('🏢 Company');
    expect(html).toContain('🆔 Statutory numbers');
  });

  it('the legacy really does gate all three on a flag the harness never sets', () => {
    // Guard the guard: if hros.html ever renders one unconditionally, the golden WOULD hold it and the
    // "no golden" premise of this whole file would be false.
    expect(legacy('var ratesPanel = p.showRates', 'var sum=')).toContain('p.showEmployer ? hrEmployerPanel() : \'\'');
    expect(legacy('function hrStatIdsPanel(){', 'var rows=HR_STATIDS.rows;')).toContain("if(!HR_STATIDS.open) return '';");
  });
});

/* ═══════════════════════════════ 1 · ⚙️ STATUTORY RATES ═══════════════════════════════ */

describe('⚙️ Rates — the panel', () => {
  const panel = (over: Partial<Props> = {}) => render({ rates: RATES, ...over });

  it('renders every input the legacy save reads, by the legacy id', () => {
    // THE DOM CONTRACT. `hrRatesSave()` (hros.html:4172) reads the form back with getElementById, so an
    // id that changed or disappeared posts `''` → `null` → the server refuses the whole payload, and an
    // id the panel stopped rendering silently nulls a live statutory rate. Both id sets are extracted
    // from hros.html rather than retyped.
    const save = legacy('async function hrRatesSave(){', 'function hrGridCell(');
    const draw = legacy('function hrRatesPanel(cfg){', 'v159: single-flight guard');
    const ids = (s: string) => [...new Set([...s.matchAll(/rt_[a-z0-9_]+/g)].map((m) => m[0]))].sort();
    const read = ids(save);
    expect(read.length).toBe(15);
    expect(ids(draw)).toEqual(read);            // the panel draws exactly what the save reads
    expect([...RATES_INPUT_IDS].sort()).toEqual(read);
    const html = panel();
    for (const id of read) expect(html).toContain(`id="${id}"`);
  });

  it('shows a decimal rate as a percentage, and a ceiling as it stands', () => {
    // `pct()` — hros.html:4141. 0.11 → 11, and it is NOT re-rounded on the way back out.
    expect(rtPct(0.11)).toBe('11');
    expect(rtPct(0.0175)).toBe('1.75');
    expect(rtPct(0.002)).toBe('0.2');
    expect(rtPct(null)).toBe('');
    const html = panel();
    const box = (id: string) => html.match(new RegExp(`<input id="${id}"[^>]*>`))![0];
    expect(box('rt_epf_ee')).toContain('value="11"');
    expect(box('rt_soc_er')).toContain('value="1.75"');
    expect(box('rt_epf_thr')).toContain('value="5000"');
  });

  it('disables exactly the six reference-only fields and no others', () => {
    // v159: SOCSO and EIS come from the PERKESO contribution TABLES, not a percentage, so the panel
    // renders them un-editable. Disabling one more (or one fewer) changes what an operator may set.
    const html = panel();
    const disabled = [...html.matchAll(/id="(rt_[a-z0-9_]+)"[^>]*disabled/g)].map((m) => m[1]);
    expect(disabled.sort()).toEqual(['rt_eis', 'rt_eis_ceil', 'rt_soc_ceil', 'rt_soc_ee', 'rt_soc_er', 'rt_soc_er2']);
    const ro = legacy('var numRO=function', 'var row=function');
    expect(ro).toContain('disabled');
  });

  it('carries the Close button and the "applies immediately" note', () => {
    const html = panel();
    expect(html).toContain('✕ Close');
    expect(html).toContain('Applies immediately to the grid.');
  });
});

describe('⚙️ Rates — what Save posts', () => {
  /** Every box filled as the panel would show them for the shipped fixture. */
  const filled = (over: Record<string, string> = {}): Record<string, string> => ({
    rt_epf_ee: '11', rt_epf_erlow: '13', rt_epf_erhigh: '12', rt_epf_thr: '5000', rt_epf_ersen: '4',
    rt_soc_ee: '0.5', rt_soc_er: '1.75', rt_soc_er2: '1.25', rt_soc_ceil: '6000',
    rt_eis: '0.2', rt_eis_ceil: '6000',
    rt_r_pers: '9000', rt_r_sp: '4000', rt_r_ch: '2000', rt_r_epf: '4000', ...over,
  });

  it('posts hr_rates_save and nothing else', () => {
    const b = ratesBody(filled(), RATES);
    expect(b.api).toBe('hr_rates_save');
    // NO TENANT. `hr_statutory_rates` is ONE row for the whole group (hr.ts:2737) — a tenant here would
    // read as company-scoped and it is not.
    expect(Object.keys(b).sort()).toEqual(['api', 'rates']);
    expect(JSON.stringify(b)).not.toContain('tenant');
  });

  it('divides a percentage box by 100 and takes a ceiling as typed', () => {
    const r = ratesBody(filled(), RATES).rates as RatesCfg;
    expect(r.epf!.eeRate).toBe(0.11);
    expect(r.epf!.erRateLow).toBe(0.13);
    expect(r.epf!.threshold).toBe(5000);
    expect(r.socso!.erRate).toBe(0.0175);
    expect(r.eis!.ceiling).toBe(6000);
    expect(r.reliefPersonal).toBe(9000);
  });

  it('round-trips the shipped rates unchanged — every rate, every ceiling, every relief', () => {
    // The strongest single case here: the panel is opened and saved with nothing typed, and every
    // stored figure must come back identical. A `pct()`/`p2()` pair that disagreed by a rounding step
    // would over- or under-deduct from every employee in every company on the next rate edit.
    const vals: Record<string, string> = {};
    const e = RATES.epf!, s = RATES.socso!, i = RATES.eis!;
    Object.assign(vals, {
      rt_epf_ee: rtPct(e.eeRate), rt_epf_erlow: rtPct(e.erRateLow), rt_epf_erhigh: rtPct(e.erRateHigh),
      rt_epf_thr: String(e.threshold), rt_epf_ersen: rtPct(e.erSenior),
      rt_soc_ee: rtPct(s.eeRate), rt_soc_er: rtPct(s.erRate), rt_soc_er2: rtPct(s.erRate2), rt_soc_ceil: String(s.ceiling),
      rt_eis: rtPct(i.eeRate), rt_eis_ceil: String(i.ceiling),
      rt_r_pers: '', rt_r_sp: '', rt_r_ch: '', rt_r_epf: '',
    });
    const r = ratesBody(vals, RATES).rates as RatesCfg;
    expect(r.epf).toEqual(RATES.epf);
    expect(r.socso).toEqual(RATES.socso);
    expect(r.eis).toEqual(RATES.eis);
  });

  it('reads the DISABLED SOCSO/EIS boxes back, rather than nulling them', () => {
    // A disabled input still has a value, and the legacy reads it. A port that skipped them would send
    // socso/eis as all-null, which hr.ts:2745 refuses outright — the loud failure. Assert the values.
    const r = ratesBody(filled(), RATES).rates as RatesCfg;
    expect(r.socso).toEqual({ eeRate: 0.005, erRate: 0.0175, erRate2: 0.0125, ceiling: 6000 });
    expect(r.eis).toEqual({ eeRate: 0.002, erRate: 0.002, ceiling: 6000 });
  });

  it('an EMPTY box is null, not zero', () => {
    // hros.html:4174-4175. Zero would be a real rate — "deduct nothing" — quietly stored. `null` is what
    // makes hr.ts:2745 refuse the payload and tell the operator, which is the legacy's behaviour.
    const r = ratesBody(filled({ rt_epf_ee: '', rt_r_pers: '' }), RATES).rates as RatesCfg;
    expect(r.epf!.eeRate).toBeNull();
    expect(r.reliefPersonal).toBeNull();
  });

  it('starts from the CURRENT rates, so a key the panel does not render survives — v157', () => {
    // This object used to REPLACE the stored row wholesale, so anything the panel does not draw was
    // destroyed on the next rate edit. `epf.eeSenior` is the one that was hand-carried for exactly that
    // reason; `lindung` here stands for every key a future revision adds.
    const cur: RatesCfg = { ...RATES, epf: { ...RATES.epf, eeSenior: 0.055 }, lindung: { rate: 1.25 } } as RatesCfg;
    const r = ratesBody(filled(), cur).rates as RatesCfg;
    expect(r.lindung).toEqual({ rate: 1.25 });
    expect(r.epf!.eeSenior).toBe(0.055);
  });

  it('defaults eeSenior to 0 when the stored row has none — the legacy fallback', () => {
    const r = ratesBody(filled(), { ...RATES, epf: { ...RATES.epf, eeSenior: undefined } } as RatesCfg).rates as RatesCfg;
    expect(r.epf!.eeSenior).toBe(0);
  });

  it('EIS employee and employer are the SAME box — one rate, both sides', () => {
    // hros.html:4184: `eis:{ eeRate:p2('rt_eis'), erRate:p2('rt_eis'), … }`. Wiring erRate to any other
    // id gives EIS two different rates, which is not what the EIS table is.
    const r = ratesBody(filled({ rt_eis: '0.4' }), RATES).rates as RatesCfg;
    expect(r.eis!.eeRate).toBe(0.004);
    expect(r.eis!.erRate).toBe(0.004);
  });

  it('the body mirrors hrRatesSave() field for field, read out of hros.html', () => {
    const save = legacy('async function hrRatesSave(){', 'function hrGridCell(');
    for (const k of ['eeRate', 'erRateLow', 'erRateHigh', 'threshold', 'erSenior', 'eeSenior',
      'erRate2', 'ceiling', 'reliefPersonal', 'reliefSpouse', 'reliefChild', 'reliefEpfMax']) {
      expect(save).toContain(k);
    }
    const r = ratesBody(filled(), RATES).rates as RatesCfg;
    expect(Object.keys(r.epf!).sort()).toEqual(['eeRate', 'eeSenior', 'erRateHigh', 'erRateLow', 'erSenior', 'threshold']);
    expect(Object.keys(r.socso!).sort()).toEqual(['ceiling', 'eeRate', 'erRate', 'erRate2']);
  });
});

/* ══════════════════════════════ 2 · 🏢 COMPANY DETAILS ══════════════════════════════ */

const EMP: EmployerEdit = {
  name: 'I PROCARE MALAYSIA SDN BHD', reg_no: '202001033445', doc_code: 'IPC',
  employer_no: 'E 1122334455', epf_employer_no: '24681357', socso_employer_no: 'C11223344',
  address: 'No. 7, Jalan Molek 1/5, 81100 Johor Bahru, Johor', phone: '+607-351 7788',
  email: 'hr@iprocare.test', logo: null,
};

describe('🏢 Company — the panel', () => {
  const panel = (over: Partial<Props> = {}) => render({ employer: EMP, ...over });

  it('renders every field the legacy save reads back, by the legacy id', () => {
    // THE DOM CONTRACT again, and here the consequence is sharper: `hrEmployerSyncInputs()`
    // (hros.html:4110) only copies a field it can FIND, so an input that lost its id keeps whatever was
    // last stored — but a field that lost its id and was never stored saves blank, and on this record a
    // blank is the E-number missing from every EA form.
    const sync = legacy('function hrEmployerSyncInputs(){', 'function hrEmployerLogoClear');
    const fields = [...sync.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((f) => f !== 'emp_');
    expect(fields).toEqual([...EMPLOYER_TEXT_FIELDS]);
    expect(fields.length).toBe(9);
    const html = panel();
    for (const f of fields) expect(html).toContain(`id="emp_${f}"`);
    // The address is a TEXTAREA in the legacy, not an input — it holds a multi-line business address.
    expect(html).toMatch(/<textarea[^>]*id="emp_address"/);
  });

  it('fills each box with the stored value', () => {
    const html = panel();
    expect(html).toContain('value="I PROCARE MALAYSIA SDN BHD"');
    expect(html).toContain('value="E 1122334455"');
    expect(html).toContain('value="24681357"');
    expect(html).toContain('value="C11223344"');
    expect(html).toContain('No. 7, Jalan Molek 1/5, 81100 Johor Bahru, Johor');
  });

  it('shows the logo when there is one and offers to remove it', () => {
    const off = panel();
    expect(off).toContain('No logo set.');
    expect(off).not.toContain('Remove logo');
    const on = panel({ employer: { ...EMP, logo: 'data:image/png;base64,AAA' } });
    expect(on).toContain('src="data:image/png;base64,AAA"');
    expect(on).toContain('Remove logo');
    expect(on).not.toContain('No logo set.');
  });

  it('accepts only PNG and JPEG on the file input — the legacy accept list', () => {
    expect(panel()).toContain('accept="image/png,image/jpeg"');
    expect(legacy('id="emp_logo_file"', 'onchange="hrEmployerLogoPick')).toContain('accept="image/png,image/jpeg"');
  });

  it('opens with a working copy that falls back to the company name', () => {
    // `hrEmployerToggle()` — hros.html:4084. A company with no hr_employer_info row yet must not open
    // with a BLANK name box, because saving it that way is a payslip with no employer on it.
    expect(employerInit(null, 'ACME SDN BHD').name).toBe('ACME SDN BHD');
    expect(employerInit({ name: '' }, 'ACME SDN BHD').name).toBe('ACME SDN BHD');
    expect(employerInit({ name: 'STORED' }, 'ACME SDN BHD').name).toBe('STORED');
    // and every other field defaults to empty / no logo, never undefined.
    const blank = employerInit(null, 'X');
    for (const f of EMPLOYER_TEXT_FIELDS) if (f !== 'name') expect(blank[f]).toBe('');
    expect(blank.logo).toBeNull();
  });

  it('shows the claim number the company code produces, without reading a clock', () => {
    // hros.html:4098 builds this from `new Date()` — the MACHINE's zone. Here it is sliced out of the
    // MYT date the route already hands the screen, so the component reads no clock at all.
    expect(claimNumberSample('IPC', '2026-08-18')).toBe('IPC-202608-0001');
    expect(claimNumberSample('ipc', '2026-01-02')).toBe('IPC-202601-0001');
    expect(claimNumberSample('', '2026-08-18')).toBe('IPC-202608-0001');   // the legacy's placeholder
    expect(panel()).toContain('IPC-202608-0001');
    // Guard the guard: the panel must be showing the sample the CODE produces, not a constant.
    expect(render({ employer: { ...EMP, doc_code: 'zx9' } })).toContain('ZX9-202608-0001');
  });

  it('shows a loading panel while the company record is being fetched', () => {
    // The legacy already holds the record (`HR.data.employer`); this screen loads only
    // `hr_payroll_data`, which carries none (hr.ts:1749), so there is a state the legacy has no
    // equivalent of. It must not render a form full of blanks over a Save button.
    const html = render({ employerLoading: true });
    expect(html).toContain('Loading company details…');
    expect(html).not.toContain('id="emp_name"');
    expect(html).not.toContain('💾 Save company details');
  });
});

describe('🏢 Company — what Save posts', () => {
  it('posts hr_employer_save for THIS company, with the whole record', () => {
    const b = employerBody(EMP, HR_TENANT) as Record<string, unknown>;
    expect(b.api).toBe('hr_employer_save');
    expect(b.tenant).toBe(HR_TENANT);
    const emp = b.employer as EmployerEdit;
    for (const f of EMPLOYER_TEXT_FIELDS) expect(emp[f]).toBe(EMP[f]);
    expect(Object.keys(emp).sort()).toEqual([...EMPLOYER_TEXT_FIELDS, 'logo'].sort());
  });

  it('refuses a blank company name — the legacy check, no stricter', () => {
    expect(employerBody({ ...EMP, name: '' }, HR_TENANT)).toEqual({ error: 'Company name is required' });
    expect(employerBody({ ...EMP, name: '   ' }, HR_TENANT)).toEqual({ error: 'Company name is required' });
    // …and nothing else is required. Every other field may be blank, exactly as hros.html allows.
    const b = employerBody({ ...employerInit(null, 'ACME'), name: 'ACME' }, HR_TENANT);
    expect('error' in b).toBe(false);
  });

  it('upper-cases the company code and strips anything that is not A-Z0-9', () => {
    const emp = (b: unknown) => (b as { employer: EmployerEdit }).employer;
    expect(emp(employerBody({ ...EMP, doc_code: 'ip-c 1' }, HR_TENANT)).doc_code).toBe('IPC1');
    expect(emp(employerBody({ ...EMP, doc_code: 'abc' }, HR_TENANT)).doc_code).toBe('ABC');
  });

  it('refuses a code of 1 character or 7+, and lets a BLANK one through', () => {
    // hros.html:4131. Blank is not an error: the server reads an empty doc_code as "keep the current
    // one" (hr.ts:2774), so a company that never set a code can still save the rest of the form — and a
    // company that HAS one does not have its claim numbering reset by an untouched box.
    expect(employerBody({ ...EMP, doc_code: 'A' }, HR_TENANT)).toHaveProperty('error');
    expect(employerBody({ ...EMP, doc_code: 'ABCDEFG' }, HR_TENANT)).toHaveProperty('error');
    for (const ok of ['AB', 'ABCDEF', '12', 'IPC']) {
      expect(employerBody({ ...EMP, doc_code: ok }, HR_TENANT)).not.toHaveProperty('error');
    }
    const blank = employerBody({ ...EMP, doc_code: '  ' }, HR_TENANT) as { employer: EmployerEdit };
    expect(blank.employer.doc_code).toBe('');
    // …and a code that is ALL punctuation strips to blank rather than failing the 2–6 rule.
    expect(employerBody({ ...EMP, doc_code: '--' }, HR_TENANT)).not.toHaveProperty('error');
  });

  it('sends logo: null to CLEAR it, and the data URI to set it', () => {
    // hr.ts:2766-2769 distinguishes three cases, and only two of them are reachable from this form:
    // `null` clears the stored logo, a `data:image/…` string replaces it. Sending `undefined` (or
    // omitting the key) would mean "leave it alone" — i.e. the Remove button silently doing nothing on
    // the logo printed on every payslip.
    const cleared = employerBody({ ...EMP, logo: null }, HR_TENANT) as { employer: EmployerEdit };
    expect(cleared.employer.logo).toBeNull();
    expect('logo' in cleared.employer).toBe(true);
    const set = employerBody({ ...EMP, logo: 'data:image/png;base64,AAA' }, HR_TENANT) as { employer: EmployerEdit };
    expect(set.employer.logo).toBe('data:image/png;base64,AAA');
  });

  it('the legacy sends exactly these keys — read out of hrEmployerToggle()', () => {
    const init = legacy('function hrEmployerToggle(){', 'function hrEmployerPanel(){');
    const keys = [...init.matchAll(/(\w+):e\.\w+/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...EMPLOYER_TEXT_FIELDS, 'logo'].sort());
  });
});

describe('the company logo — the four numbers, all of them the legacy\'s', () => {
  it('refuses a file over 4 MB before decoding it', () => {
    expect(logoFileRefusal({ size: LOGO_MAX_FILE_BYTES })).toBeNull();
    expect(logoFileRefusal({ size: LOGO_MAX_FILE_BYTES + 1 })).toBe('Image too large — pick one under 4 MB');
    expect(logoFileRefusal(null)).toBeNull();
    expect(LOGO_MAX_FILE_BYTES).toBe(4 * 1024 * 1024);
  });

  it('scales down to 260px wide and never scales UP', () => {
    expect(LOGO_MAX_WIDTH).toBe(260);
    expect(logoScale(520, 200)).toEqual({ w: 260, h: 100 });
    expect(logoScale(1000, 333)).toEqual({ w: 260, h: 87 });
    // A logo already smaller than the cap keeps its own size — `Math.min(1, …)`. Scaling it up would
    // blur the mark printed at the top of every payslip.
    expect(logoScale(120, 40)).toEqual({ w: 120, h: 40 });
  });

  it('refuses a data URI over 380,000 characters — tighter than the server\'s 400,000', () => {
    expect(LOGO_MAX_DATA_URI).toBe(380000);
    expect(logoDataRefusal('x'.repeat(LOGO_MAX_DATA_URI))).toBeNull();
    expect(logoDataRefusal('x'.repeat(LOGO_MAX_DATA_URI + 1)))
      .toBe('Logo still too large after resize — try a simpler image');
    // The client cap must stay BELOW the server's, or the operator is told by a failed request.
    expect(LOGO_MAX_DATA_URI).toBeLessThan(400000);
    expect(legacy('async function hrEmployerSave', 'function hrRatesPanel')).toBeTruthy();
    expect(HROS).toContain('out.length>380000');
  });

  it('the route re-encodes as JPEG at the legacy quality before giving up', () => {
    expect(LOGO_JPEG_QUALITY).toBe(0.85);
    expect(HROS).toContain("cv.toDataURL('image/jpeg',0.85)");
    expect(ROUTE).toContain("cv.toDataURL('image/png')");
    expect(ROUTE).toContain("cv.toDataURL('image/jpeg', LOGO_JPEG_QUALITY)");
    // The white background fill — a transparent PNG flattened onto nothing prints black on a payslip.
    expect(ROUTE).toContain("ctx.fillStyle = '#ffffff'");
  });
});

/* ═══════════════════════════ 3 · 🆔 STATUTORY NUMBERS ═══════════════════════════ */

const SI_ROWS: StatIdRow[] = [
  { id: 'e1', emp_no: 'E001', name: 'AHMAD BIN ISMAIL', ic: '900314-10-5533', epfNo: '11112222', socsoNo: 'S1', taxNo: 'SG100' },
  { id: 'e2', emp_no: 'E002', name: 'SITI NURHALIZA BINTI OMAR', ic: '960722-01-1234', epfNo: '', socsoNo: 'S2', taxNo: '' },
  { id: 'e3', emp_no: 'E003', name: 'RAJESH A/L KUMAR', ic: '', epfNo: '33334444', socsoNo: '', taxNo: 'SG300' },
];

describe('🆔 Statutory numbers — the panel', () => {
  const panel = (over: Partial<Props> = {}) => render({ statIds: { rows: SI_ROWS }, ...over });

  it('shows a loading panel first, with no table and no Save', () => {
    const html = render({ statIds: { loading: true, rows: null } });
    expect(html).toContain('Loading employees…');
    expect(html).not.toContain('Save all');
    expect(html).not.toContain('EPF member no');
  });

  it('gives every employee a row and every row four boxes, each with its own id', () => {
    const html = panel();
    for (const r of SI_ROWS) {
      expect(html).toContain(r.emp_no);
      expect(html).toContain(r.name);
      for (const [f] of STAT_ID_COLS) expect(html).toContain(`id="si_${f}_${r.id}"`);
    }
    expect([...html.matchAll(/id="si_[a-zA-Z]+_e\d"/g)]).toHaveLength(12);
  });

  it('outlines a BLANK box in red and leaves a filled one alone', () => {
    // The whole point of the screen: an empty member number is what BLOCKS the KWSP / PERKESO / CP39
    // file for that employee, and the outline is the only thing that says which.
    const html = panel();
    const box = (id: string) => html.match(new RegExp(`<input id="${id}"[^>]*>`))![0];
    expect(box('si_epfNo_e1')).not.toContain('border-color');
    expect(box('si_epfNo_e2')).toContain('border-color:var(--danger,#e2604b)');
    expect(box('si_ic_e3')).toContain('border-color:var(--danger,#e2604b)');
    expect(box('si_ic_e1')).not.toContain('border-color');
  });

  it('counts filled-in numbers per column, and colours the count', () => {
    // `hrStatIdsSummary()` — hros.html:3904. 3 employees: IC 2/3, EPF 2/3, SOCSO 2/3, TIN 2/3.
    const html = panel();
    const sum = html.match(/<div id="si_summary"[\s\S]*?<\/div>/)![0];
    expect(sum).toContain('IC: ');
    for (const label of ['IC', 'EPF', 'SOCSO', 'TIN']) expect(sum).toContain(label);
    expect([...sum.matchAll(/>2\/3</g)]).toHaveLength(4);
    expect(sum).toContain('var(--danger,#e2604b)');
    // …and a complete column is green rather than red.
    const full = render({ statIds: { rows: SI_ROWS.map((r) => ({ ...r, epfNo: 'x' })) } });
    const fs = full.match(/<div id="si_summary"[\s\S]*?<\/div>/)![0];
    expect(fs).toContain('3/3');
    expect(fs).toContain('var(--ok,#3fb984)');
  });

  it('offers Save all at the top AND the bottom, as the legacy does', () => {
    expect([...panel().matchAll(/Save all/g)]).toHaveLength(2);
    expect(legacy('function hrStatIdsPanel(){', 'function hrPayHub(')
      .match(/hrStatIdsSave\(\)/g)).toHaveLength(2);
  });

  it('binds each box to ITS OWN row and ITS OWN field', () => {
    // Four identical text boxes per row, and R1 strips every handler from a string comparison — a cell
    // wired one row up writes somebody else's EPF member number onto this employee's record, and the
    // markup looks perfect. This is the only thing that holds a box to the person beside it. Driven
    // through the shared walker the golden screens use, rather than through a second stub of my own.
    const seen: string[] = [];
    reactHandlers(element({
      statIds: { rows: SI_ROWS },
      onStatIdsCell: (id: string, f: StatIdField) => seen.push(id + ':' + f),
    })).forEach((h) => h.invoke());
    expect(seen).toEqual([
      'e1:ic', 'e1:epfNo', 'e1:socsoNo', 'e1:taxNo',
      'e2:ic', 'e2:epfNo', 'e2:socsoNo', 'e2:taxNo',
      'e3:ic', 'e3:epfNo', 'e3:socsoNo', 'e3:taxNo',
    ]);
  });

  it('hands the cell the box\'s live value, which the route then trims', () => {
    // `hrStatIdsCell()` trims as it stores (hros.html:3900) — a member number pasted with a trailing
    // space is the same number. The TRIM is the route's, so this only pins that the value travels.
    const seen: string[] = [];
    reactHandlers(element({
      statIds: { rows: [SI_ROWS[0]] },
      onStatIdsCell: (_id: string, _f: StatIdField, v: string) => seen.push(v),
    })).forEach((h) => h.invoke());
    expect(seen).toEqual([STUB_VALUE, STUB_VALUE, STUB_VALUE, STUB_VALUE]);
    expect(ROUTE).toContain('.trim()');
  });
});

describe('🆔 Statutory numbers — what Save posts', () => {
  it('posts hr_stat_ids_save for THIS company, with every row', () => {
    const b = statIdsBody(HR_TENANT, SI_ROWS) as Record<string, unknown>;
    expect(b.api).toBe('hr_stat_ids_save');
    expect(b.tenant).toBe(HR_TENANT);
    expect(b.rows).toEqual(SI_ROWS);
    expect(Object.keys(b).sort()).toEqual(['api', 'rows', 'tenant']);
  });

  it('refuses an empty list rather than posting one', () => {
    // hros.html:3914. The server refuses it too (hr.ts:2850), but the legacy says so without a round
    // trip, and a body with no rows reads as "clear everything" to anyone reading the log.
    expect(statIdsBody(HR_TENANT, [])).toEqual({ error: 'Nothing to save' });
  });

  it('carries the four field names the server reads, and the row id it pins them by', () => {
    // hr.ts:2856-2860 keys on `ic` / `epfNo` / `socsoNo` / `taxNo` and pins `r.id` to the company. A
    // renamed key is read as ABSENT — "leave it alone" — so a typed-in EPF number silently vanishes.
    const b = statIdsBody(HR_TENANT, SI_ROWS) as { rows: StatIdRow[] };
    for (const r of b.rows) {
      for (const k of ['id', 'ic', 'epfNo', 'socsoNo', 'taxNo']) expect(r).toHaveProperty(k);
    }
  });

  it('maps the server\'s own column names, read out of hrStatIdsOpen()', () => {
    // `hr_stat_ids_get` returns `ic_no` / `epf_no` / `socso_no` / `tax_no`; the SAVE sends `ic` /
    // `epfNo` / `socsoNo` / `taxNo`. Two different vocabularies one function apart, and getting one
    // wrong shows every box blank on a company whose numbers are all filled in.
    const open = legacy('async function hrStatIdsOpen(){', 'function hrStatIdsClose(');
    for (const c of ['ic:e.ic_no', 'epfNo:e.epf_no', 'socsoNo:e.socso_no', 'taxNo:e.tax_no']) {
      expect(open.replace(/\s/g, '')).toContain(c);
    }
    const rows = statIdsRows([{ id: 'e9', emp_no: 'E009', name: 'X', ic_no: '1', epf_no: '2', socso_no: '3', tax_no: '4' }]);
    expect(rows).toEqual([{ id: 'e9', emp_no: 'E009', name: 'X', ic: '1', epfNo: '2', socsoNo: '3', taxNo: '4' }]);
    // A missing column is an empty string, never `undefined` — which the server would read as
    // "leave it alone" rather than as a blank the operator can see and fill in.
    expect(statIdsRows([{ id: 'e9' }])[0]).toEqual({ id: 'e9', emp_no: '', name: '', ic: '', epfNo: '', socsoNo: '', taxNo: '' });
  });
});

/* ═════════════════════════ 4 · THE DOUBLE-SUBMIT GUARD ═════════════════════════ */

describe('none of the three saves can be fired twice', () => {
  // `hrOnce()` (hros.html:4167) wraps all three legacy handlers. React does it inline per screen, as
  // Quick Invoice and Sales Recon do. Two halves: the component must emit `disabled`, and the route
  // must set the flag BEFORE the request and clear it in `finally`.

  it('disables each Save while its own request is in flight, and nothing else', () => {
    const saving = (html: string) => (html.match(/>Saving…</g) || []).length;
    const busy = render({ rates: RATES, employer: EMP, statIds: { rows: SI_ROWS }, savingRates: true });
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>Saving…<\/button>/);
    expect(saving(busy)).toBe(1);                              // the OTHER two stay live
    expect(busy).toContain('💾 Save company details');
    expect(busy).toContain('Save all');
    const idle = render({ rates: RATES, employer: EMP, statIds: { rows: SI_ROWS } });
    expect(saving(idle)).toBe(0);
    expect(idle).toContain('Save rates');
    expect(idle).toContain('💾 Save company details');
    expect(idle).toContain('Save all');
  });

  it('disables BOTH Save all buttons on the statutory-numbers panel', () => {
    // Two buttons, one action — guarding only the one that was clicked is app.html:4990's Xero gap.
    const busy = render({ statIds: { rows: SI_ROWS }, savingStatIds: true });
    expect(busy.match(/<button[^>]*disabled=""[^>]*>Saving…<\/button>/g)).toHaveLength(2);
    expect(busy).not.toContain('>Save all<');
  });

  it('the company Save is the LOGO\'s guard too — one request carries both', () => {
    const busy = render({ employer: { ...EMP, logo: 'data:image/png;base64,AAA' }, savingEmployer: true });
    expect(busy).toMatch(/<button[^>]*disabled=""/);
    expect(busy).not.toContain('💾 Save company details');
  });

  for (const [name, flag, body] of [
    ['onRatesSave', 'setSavingRates', 'ratesBody('],
    ['onEmployerSave', 'setSavingEmployer', 'call(body)'],
    ['onStatIdsSave', 'setSavingStatIds', 'call<{ n?: number }>(body)'],
  ] as [string, string, string][]) {
    it(`${name} refuses re-entry, locks before the POST and releases in finally`, () => {
      const at = ROUTE.indexOf(`const ${name} = useCallback`);
      expect(at).toBeGreaterThan(-1);
      // Bounded to THIS handler: the next `useCallback` starts the one after it. Without the bound a
      // guard belonging to a different save would satisfy the checks below.
      const end = ROUTE.indexOf('useCallback', at + 40);
      expect(end).toBeGreaterThan(at);
      const src = ROUTE.slice(at, end);
      expect(src).toMatch(new RegExp(`if \\(${flag.replace('setS', 's')}`));
      const lock = src.indexOf(`${flag}(true)`);
      const post = src.indexOf(body);
      expect(lock).toBeGreaterThan(-1);
      expect(post).toBeGreaterThan(-1);
      expect(lock).toBeLessThan(post);
      expect(src).toMatch(new RegExp(`finally \\{[\\s\\S]*?${flag}\\(false\\)`));
    });
  }
});
