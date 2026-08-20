'use client';

// The route. Everything impure lives here — the session, the fetches, the calculator's own state, the
// audit-log save and reload — so that src/hr-calculator.tsx stays a pure function of its props and can
// be diffed against the legacy golden. Same split as the pilot:
//
//   app/<area>/<screen>/page.tsx   'use client', loads, holds state, wires handlers   — not golden-tested
//   src/<screen>.tsx              pure, props in / markup out                         — golden-tested
//
// The statutory maths is NOT here and NOT in the component: it is `calcCompute()`, which calls
// payroll.js. This file only decides when to run it.

import { useCallback, useEffect, useState } from 'react';

import HrCalculator, {
  CALC_INITIAL, calcCompute,
  type CalcAuditRow, type CalcEmployee, type CalcHistoryState, type CalcInputs, type CalcRates,
  type CalcSettings, type CalcState, type FlagItem, type FlagKey, type OverrideKey,
} from '../../../src/hr-calculator';
import { call, legacyUrl, token } from '../../../src/portal';
import { hrAge } from '../../../../payroll.js';

/** hros.html:1410 — the fallback company when the account has no Xero orgs. */
const PROCARE = 'I PROCARE MALAYSIA SDN BHD';

/** `HR_MONTHS` — hros.html:1445. */
const HR_MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface Company { tenant_id: string; tenant_name: string }

/** The employee fields `hrCalcPickEmp()` (hros.html:4861) prefills from. */
interface BootEmployee extends CalcEmployee {
  basic_salary?: number | null;
  fixed_allowance?: number | null;
  date_of_birth?: string | null;
  epf_ee_rate?: number | null;
  epf_er_rate?: number | null;
  socso_category?: number | null;
  resident?: boolean;
  marital_status?: string | null;
  spouse_working?: boolean;
  num_children?: number | null;
  epf_eligible?: boolean;
  socso_eligible?: boolean;
  eis_eligible?: boolean;
}

export default function HrCalculatorPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [employees, setEmployees] = useState<BootEmployee[]>([]);
  const [rates, setRates] = useState<CalcRates | null>(null);
  const [state, setState] = useState<CalcState>(CALC_INITIAL);
  const [history, setHistory] = useState<CalcHistoryState>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      // The selected company is `localStorage['hr_tenant']` (hros.html:1412) — same origin, so it is
      // already there, exactly like the token.
      const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
      const co = await call<{ companies?: Company[] }>({ api: 'hr_companies' });
      const list = co.companies || [];
      const pick = list.find((c) => c.tenant_id === saved) || list.find((c) => c.tenant_name === PROCARE) || list[0] || null;
      setCompany(pick);
      // One payload, exactly as the legacy app's own bootstrap (hros.html:1451): the picker's employees
      // and `rates`, which is what `calcCompute()` refuses to run without.
      const boot = await call<{ employees?: BootEmployee[]; rates?: CalcRates }>(
        { api: 'hr_bootstrap', tenant: pick ? pick.tenant_id : null });
      setEmployees(boot.employees || []);
      setRates(boot.rates || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (t) void load();
  }, [load]);

  /** `hrCalcPickEmp()` — hros.html:4861. Replaces the whole settings block, exactly as the legacy does. */
  const onPickEmp = useCallback((id: string) => {
    setState((s) => {
      const e = id ? employees.find((x) => x.id === id) : null;
      if (!e) return { ...s, empId: id };
      const age = hrAge(e.date_of_birth);
      return {
        ...s,
        empId: id,
        inp: { ...s.inp, basic: Number(e.basic_salary) || '', allowance: Number(e.fixed_allowance) || '' },
        settings: {
          epfEeRate: e.epf_ee_rate != null ? String(e.epf_ee_rate) : '',
          epfErRate: e.epf_er_rate != null ? String(e.epf_er_rate) : '',
          socsoCat: e.socso_category != null ? String(e.socso_category) : '',
          resident: e.resident !== false,
          married: String(e.marital_status || '') === 'married',
          spouseWorking: !!e.spouse_working,
          children: Number(e.num_children) || 0,
          senior: (age != null && age >= 60),
          epfOn: e.epf_eligible !== false,
          socsoOn: e.socso_eligible !== false,
          eisOn: e.eis_eligible !== false,
          // DELIBERATE DIVERGENCE, and the only one on this screen. `hrCalcPickEmp` (hros.html:4865)
          // assigns a settings object with NO `lindungOn`, so after a prefill the legacy screen shows the
          // LINDUNG 24 box unticked while `s.lindungOn !== false` still reads true and the deduction is
          // still taken — the tick and the money disagree. Carrying the current value keeps them in step.
          // Not covered by the golden either way (it is captured before any prefill).
          lindungOn: s.settings.lindungOn,
        },
      };
    });
  }, [employees]);

  /** `hrCI` / `hrCS` / `hrCF` / `hrCO` — hros.html:4856-4859. */
  const onInput = useCallback((k: keyof CalcInputs, v: string) => setState((s) => ({ ...s, inp: { ...s.inp, [k]: v } })), []);
  const onSetting = useCallback((k: keyof CalcSettings, v: string | boolean) => setState((s) => ({ ...s, settings: { ...s.settings, [k]: v } })), []);
  const onFlag = useCallback((item: FlagItem, flag: FlagKey, on: boolean) =>
    setState((s) => ({ ...s, flags: { ...s.flags, [item]: { ...s.flags[item], [flag]: !!on } } })), []);
  const onOverride = useCallback((k: OverrideKey, v: string) => setState((s) => ({ ...s, ov: { ...s.ov, [k]: v } })), []);
  const onOvToggle = useCallback(() => setState((s) => ({ ...s, ov: { ...s.ov, on: !s.ov.on } })), []);

  /** `hrCalcHistory()` — hros.html:4910. */
  const onHistory = useCallback(async () => {
    setHistory({ loading: true });
    try {
      const r = await call<{ rows?: CalcAuditRow[] }>({ api: 'hr_calc_history', tenant: company ? company.tenant_id : null });
      setHistory({ rows: r.rows || [] });
    } catch (e) {
      setHistory({ error: e instanceof Error ? e.message : String(e) });
    }
  }, [company]);

  /** `hrCalcSave()` — hros.html:4902. */
  const onSave = useCallback(async () => {
    const res = calcCompute(state, rates);
    if (!res) { setNotice('Enter figures first'); return; }
    if (res.overridden && !String(state.ov.reason || '').trim()) { setNotice('A reason is required to save an override'); return; }
    const e = state.empId ? employees.find((x) => x.id === state.empId) : null;
    const now = new Date();
    try {
      await call({
        api: 'hr_calc_log', tenant: company ? company.tenant_id : null,
        employeeId: state.empId || null, employeeName: e ? e.name : 'Ad-hoc',
        period: HR_MONTHS[now.getMonth() + 1] + ' ' + now.getFullYear(),
        inputs: state.inp, flags: state.flags, settings: state.settings, result: res,
        overridden: res.overridden, override: res.overridden ? state.ov : null,
        reason: res.overridden ? state.ov.reason : null,
      });
      setNotice('Calculation saved to audit log ✓');
      void onHistory();
    } catch (err2) {
      setNotice(err2 instanceof Error ? err2.message : String(err2));
    }
  }, [state, rates, employees, company, onHistory]);

  /**
   * `hrCalcPayslip()` — hros.html:4890 — is NOT migrated. It draws the PDF with `hrDrawPayslip`
   * (hr-docs.js), and that function is the one documented exception to "the shared scripts read no app
   * state": it reads `HR_EMPLOYER` and `HR_COMPANY`, which are still in hros.html. Wiring it here would
   * mean lifting the employer chrome out too, which is a bigger change than one screen. The button says
   * so instead of failing silently.
   */
  const onPayslip = useCallback(() => setNotice('The payslip PDF is on the legacy screen — open HR OS · Calculator.'), []);

  const result = calcCompute(state, rates);

  return (
    <>
      <Banner />
      {notice ? <Panel>{notice}</Panel> : null}
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
        : !rates || company === null ? <Panel><span className="spin"></span> Loading the statutory rates…</Panel>
        : (
          <HrCalculator
            state={state}
            employees={employees}
            result={result}
            companyName={company ? company.tenant_name : ''}
            history={history}
            onPickEmp={onPickEmp}
            onInput={onInput}
            onFlag={onFlag}
            onSetting={onSetting}
            onOverride={onOverride}
            onOvToggle={onOvToggle}
            onPayslip={onPayslip}
            onSave={onSave}
            onHistory={onHistory}
          />
        )}
    </>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel"><div className="muted" style={{ padding: '18px' }}>{children}</div></div>;
}

/**
 * The strangler is explicitly "both versions reachable and comparable side by side" — nothing was
 * deleted from hros.html and the legacy screen is still the one staff use.
 */
function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React migration.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('hros.html')}#tab=calculator`}>hros.html · Calculator</a>, unchanged. This page runs the
        same statutory engine (<code>payroll.js</code>) from the same session and is diffed against the same golden.
        The payslip PDF is on the legacy screen only.
      </div>
    </div>
  );
}
