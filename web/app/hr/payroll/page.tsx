'use client';

// The route. Everything impure lives here — the session, the fetch, the period, the grid the operator
// types into, the localStorage checklist and UOB settings, the clock the due date is derived from, and
// the save/finalise calls — so that src/hr-payroll.tsx stays a pure function of its props and can be
// diffed against the legacy golden. Same split as every migrated screen:
//
//   app/<area>/<screen>/page.tsx   'use client', loads, holds state, wires handlers   — not golden-tested
//   src/<screen>.tsx              pure, props in / markup out                         — golden-tested
//
// The statutory maths is NOT here and NOT in the component: it is `gridAll()`/`gridRowCompute()`, which
// call `hrCompute` in payroll.js. This file only decides when to run them.

import { useCallback, useEffect, useMemo, useState } from 'react';

import HrPayroll, {
  HR_MONTHS, dueInfo, gridAll, gridInit, gridState, tp1Body,
  type CellField, type GridRow, type HubKey, type LegacyPanel, type PayData, type PayEmployee,
  type StatFile, type Tp1Line, type Tp1State, type UobCfg,
} from '../../../src/hr-payroll';
import { showConfirm } from '../../../src/confirm';
import { call, legacyUrl, token } from '../../../src/portal';

/** hros.html:1410 — the fallback company when the account has no Xero orgs. */
const PROCARE = 'I PROCARE MALAYSIA SDN BHD';

interface Company { tenant_id: string; tenant_name: string }

/** `hrHubKey()` — hros.html:3826. Same key the legacy screen writes, so the ticks are shared. */
const hubKey = (tenant: string, month: number, year: number) => `hr_hub_${tenant}_${month}-${year}`;

function readJson<T>(key: string, fallback: T): T {
  try { return (JSON.parse(localStorage.getItem(key) || 'null') as T) || fallback; } catch { return fallback; }
}

/** `todayLocalISO()` — the row menu's resign-date default. */
function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function HrPayrollPage() {
  const now = new Date();
  const [company, setCompany] = useState<Company | null>(null);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<PayData | null>(null);
  const [grid, setGrid] = useState<Record<string, GridRow>>({});
  const [dirty, setDirty] = useState(false);
  const [ticks, setTicks] = useState<Partial<Record<HubKey, boolean>>>({});
  const [uob, setUob] = useState<UobCfg>({});
  const [dedEmp, setDedEmp] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [editFinal, setEditFinal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const load = useCallback(async (m: number, y: number) => {
    setErr(null); setData(null);
    try {
      const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
      const co = await call<{ companies?: Company[] }>({ api: 'hr_companies' });
      const list = co.companies || [];
      const pick = list.find((c) => c.tenant_id === saved) || list.find((c) => c.tenant_name === PROCARE) || list[0] || null;
      setCompany(pick);
      const tenant = pick ? pick.tenant_id : null;
      const d = await call<PayData>({ api: 'hr_payroll_data', tenant, month: m, year: y });
      setData(d);
      setGrid(gridInit(d));
      setDirty(false);
      setEditFinal(false);
      if (tenant) {
        setTicks(readJson(hubKey(tenant, m, y), {} as Partial<Record<HubKey, boolean>>));
        setUob(readJson(`hr_uob_${tenant}`, {} as UobCfg));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (t) void load(month, year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  /** `hrPickPeriod()` — reads the two selects by id, exactly as the legacy handler does. */
  const onPickPeriod = useCallback(async () => {
    if (dirty && !await showConfirm('Unsaved payroll entries',
      `You have unsaved payroll entries for ${HR_MONTHS[month]} ${year}.\n\nLeave without saving? The figures you typed will be lost.`, 'Discard')) return;
    const m = Number((document.getElementById('hr_pm') as HTMLSelectElement | null)?.value) || month;
    const y = Number((document.getElementById('hr_py') as HTMLSelectElement | null)?.value) || year;
    setMonth(m); setYear(y);
    void load(m, y);
  }, [dirty, month, year, load]);

  const mutate = useCallback((id: string, f: (g: GridRow) => GridRow) => {
    setGrid((g) => (g[id] ? { ...g, [id]: f(g[id]) } : g));
    setDirty(true);
  }, []);

  const onCell = useCallback((id: string, field: CellField, v: string) => {
    const n = (v === '' || v == null) ? 0 : Number(v);
    mutate(id, (g) => ({ ...g, [field]: isNaN(n) ? 0 : n }));
  }, [mutate]);

  // v195: blank goes back to the engine; 0 is a REAL override, so this stores '' rather than falsy.
  const onPcbCell = useCallback((id: string, v: string) => {
    mutate(id, (g) => ({ ...g, pcbSet: (v === '' || v == null) ? null : (isNaN(Number(v)) ? 0 : Number(v)) }));
  }, [mutate]);
  const onPcbAuto = useCallback((id: string) => mutate(id, (g) => ({ ...g, pcbSet: null })), [mutate]);

  const onDedAdd = useCallback((id: string, label?: string) =>
    mutate(id, (g) => ({ ...g, deductions: [...(g.deductions || []), { label: label || '', amount: 0 }] })), [mutate]);
  const onDedDel = useCallback((id: string, i: number) =>
    mutate(id, (g) => ({ ...g, deductions: (g.deductions || []).filter((_, j) => j !== i) })), [mutate]);
  const onDedLabel = useCallback((id: string, i: number, v: string) =>
    mutate(id, (g) => ({ ...g, deductions: (g.deductions || []).map((d, j) => (j === i ? { ...d, label: v } : d)) })), [mutate]);
  const onDedAmt = useCallback((id: string, i: number, v: string) => {
    const n = (v === '' || v == null) ? 0 : Number(v);
    mutate(id, (g) => ({ ...g, deductions: (g.deductions || []).map((d, j) => (j === i ? { ...d, amount: isNaN(n) ? 0 : n } : d)) }));
  }, [mutate]);

  /** v205: skip leaves somebody out of THIS month without touching their record. */
  const onSkip = useCallback(async (id: string, on: boolean) => {
    const e = (data?.employees || []).find((x) => x.id === id);
    if (on && !await showConfirm('Skip this employee',
      `Leave ${e?.name || 'this employee'} out of ${HR_MONTHS[month]} ${year}?\n\nThey get no payslip and drop out of the bank file and every statutory total for this month. Their profile and history are untouched, and you can put them back any time.`, 'Skip')) return;
    mutate(id, (g) => ({ ...g, skip: !!on }));
    setRowMenu(null);
  }, [data, month, year, mutate]);

  const post = useCallback(async (body: Record<string, unknown>, ok: string) => {
    try { await call({ ...body, tenant: company ? company.tenant_id : null }); setNotice(ok); }
    catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
  }, [company]);

  const entries = useCallback(() => (data?.employees || []).map((e) => ({ employee_id: e.id, ...grid[e.id] })), [data, grid]);

  const onGridSave = useCallback(async () => {
    await post({ api: 'hr_payroll_save_entries', month, year, entries: entries() }, 'Entries saved ✓');
    setDirty(false);
  }, [post, month, year, entries]);

  const onFinalise = useCallback(async () => {
    if (!await showConfirm('Finalise payroll',
      `Finalise ${HR_MONTHS[month]} ${year}? Payslips are written for every employee in the run.`, 'Finalise', 'p')) return;
    await post({ api: 'hr_payroll_finalise', month, year, entries: entries() }, 'Payroll finalised ✓');
    void load(month, year);
  }, [post, month, year, entries, load]);

  const onResign = useCallback(async (id: string) => {
    const e = (data?.employees || []).find((x) => x.id === id);
    const d = (document.getElementById('hr_rm_resign') as HTMLInputElement | null)?.value || '';
    if (!d) { setNotice('Pick their last working day'); return; }
    if (!await showConfirm('Mark as resigned', `Mark ${e?.name || 'this employee'} as resigned on ${d}?`, 'Mark resigned')) return;
    // Send only status + resign date: hr_emp_save leaves every field it was not given alone (v197).
    await post({ api: 'hr_emp_save', emp: { id, name: e?.name, status: 'resigned', resignDate: d } }, 'Marked resigned');
    setRowMenu(null);
    void load(month, year);
  }, [data, post, load, month, year]);

  const onEmpDelete = useCallback(async (id: string) => {
    if (!await showConfirm('Delete employee',
      'Delete this employee permanently? Their leave, claim and attendance records go too.', 'Delete')) return;
    await post({ api: 'hr_emp_delete', id }, 'Employee deleted');
    setRowMenu(null);
    void load(month, year);
  }, [post, load, month, year]);

  const onHubTick = useCallback((k: HubKey, on: boolean) => {
    setTicks((t) => {
      const next = { ...t, [k]: !!on };
      if (company) { try { localStorage.setItem(hubKey(company.tenant_id, month, year), JSON.stringify(next)); } catch { /* private mode */ } }
      return next;
    });
  }, [company, month, year]);

  const onUobSave = useCallback(() => {
    const acct = String((document.getElementById('hr_uob_acct') as HTMLInputElement | null)?.value || '').replace(/[^0-9]/g, '');
    const cd = (document.getElementById('hr_uob_cd') as HTMLInputElement | null)?.value || '';
    const cfg = { acct, cd };
    setUob(cfg);
    if (company) { try { localStorage.setItem(`hr_uob_${company.tenant_id}`, JSON.stringify(cfg)); } catch { /* private mode */ } }
    setNotice('UOB Infinity settings saved');
  }, [company]);

  /**
   * The exports and the four un-migrated panels. Every one of them is a file builder in hros.html
   * (`hrExpBank`, `hrExpKwsp`, `hrExpAssist`, `hrExpCp39`, `hrExpSummary`, `hrExpPayslips`, the jsPDF
   * payslip drawers in hr-docs.js) or a full record editor (⚙️ Rates, 🏢 Company, 🆔 Statutory numbers,
   * 🧾 TP1). None is migrated with this screen, and each is wired to a notice pointing at the legacy
   * screen rather than to nothing — the same choice hr-calculator's payslip button makes.
   */
  const toLegacy = useCallback((what: string) =>
    setNotice(`${what} is on the legacy screen — open HR OS · Payroll.`), []);
  const legacyPanel = useCallback((k: LegacyPanel) => toLegacy(
    { rates: 'The statutory rates editor', employer: 'The company details editor', statids: 'The statutory numbers editor' }[k],
  ), [toLegacy]);

  /* ── 🧾 TP1 relief declarations — hros.html:3844-3910 ─────────────────────────────────────────── */

  const [tp1, setTp1] = useState<Tp1State | null>(null);

  /** `hrTp1Open()` — hros.html:3844. */
  const onTp1Open = useCallback(() => {
    if (!company) { setNotice('Pick a company first'); return; }
    setTp1({ year: year, empId: null, lines: [], effMonth: 1, note: '', employees: data?.employees || [] });
  }, [company, data, year]);

  /**
   * `hrTp1Pick()` — hros.html:3851. A blank pick clears the form rather than leaving the previous
   * employee's declared reliefs on screen under a new name.
   */
  const onTp1Pick = useCallback(async (empId: string) => {
    setTp1((t) => (t ? { ...t, empId: empId || null, lines: [], effMonth: 1, note: '', loading: !!empId } : t));
    if (!empId) return;
    const blank: Tp1Line[] = [{ category: 'lifestyle', amount: 0, note: '' }];
    try {
      const r = await call<{ declaration?: { items?: Tp1Line[]; effective_month?: number; note?: string } }>(
        { api: 'hr_tp1_get', employee_id: empId, year: tp1?.year ?? year });
      const d = r.declaration;
      const lines = (d?.items || []).map((i) => ({ category: i.category || 'other', amount: Number(i.amount) || 0, note: i.note || '' }));
      setTp1((t) => (t && t.empId === empId
        ? { ...t, loading: false, lines: lines.length ? lines : blank, effMonth: Number(d?.effective_month) || 1, note: d?.note || '' }
        : t));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setTp1((t) => (t && t.empId === empId ? { ...t, loading: false, lines: blank } : t));
    }
  }, [tp1, year]);

  /** `hrTp1Line()` — hros.html:3865. An amount is a NUMBER; the other two fields are text. */
  const onTp1Line = useCallback((i: number, field: keyof Tp1Line, v: string) => {
    setTp1((t) => {
      if (!t || !t.lines[i]) return t;
      const lines = t.lines.slice();
      lines[i] = { ...lines[i], [field]: field === 'amount' ? (Number(v) || 0) : v };
      return { ...t, lines };
    });
  }, []);

  /** `hrTp1Add()` / `hrTp1Del()` — hros.html:3868-3869. Deleting the last line leaves a blank one, so
      the table never disappears with no way to add a row back. */
  const onTp1Add = useCallback(() => setTp1((t) => (t ? { ...t, lines: t.lines.concat([{ category: 'lifestyle', amount: 0, note: '' }]) } : t)), []);
  const onTp1Del = useCallback((i: number) => setTp1((t) => {
    if (!t) return t;
    const lines = t.lines.filter((_, k) => k !== i);
    return { ...t, lines: lines.length ? lines : [{ category: 'lifestyle', amount: 0, note: '' }] };
  }), []);

  /**
   * `hrTp1Save()` — hros.html:3870. The BODY is `tp1Body()` in src/, pinned by the parity test: this
   * declaration changes what is withheld from that employee every month from `effective_month`.
   * Reloads the month afterwards, exactly as the legacy `HR.pay.data=null` does, because the PCB on the
   * grid is now stale.
   */
  const onTp1Save = useCallback(async () => {
    if (!tp1) return;
    const body = tp1Body(tp1);
    if ('error' in body) { setNotice(body.error as string); return; }
    try {
      const r = await call<{ lines?: number; total?: number }>(body);
      setNotice(`TP1 saved -- ${r.lines ?? 0} relief line(s). PCB recalculates from month ${tp1.effMonth}.`);
      setTp1(null);
      await load(month, year);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [load, month, tp1, year]);

  const period = useMemo(() => ({ month, year }), [month, year]);
  const A = useMemo(() => (data ? gridAll(data, grid, period) : null), [data, grid, period]);
  const skipped = useMemo(() => (data?.employees || []).filter((e: PayEmployee) => grid[e.id]?.skip), [data, grid]);

  const run = data?.run || null;
  const finalised = !!run && run.status === 'finalised';
  const locked = finalised && !editFinal;

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
        : !data || !A ? <Panel><span className="spin"></span> Loading payroll…</Panel>
        : !data.rates ? <Panel>⚠️ No statutory rates configured (hr_statutory_rates)</Panel>
        : !(data.employees || []).length ? <Panel>👤 No active employees. Add employees first.</Panel>
        : (
          <HrPayroll
            companyName={company ? company.tenant_name : ''}
            month={month}
            year={year}
            grid={grid}
            rows={A.rows}
            tot={A.tot}
            skipped={skipped}
            locked={locked}
            finalised={finalised}
            runId={run?.id || null}
            state={gridState(run, dirty)}
            ticks={ticks}
            uob={uob}
            due={dueInfo(month, year, new Date())}
            dedEmp={dedEmp}
            rowMenu={rowMenu}
            today={todayLocalISO()}
            onPickPeriod={onPickPeriod}
            onLegacyPanel={legacyPanel}
            tp1={tp1}
            onTp1Open={onTp1Open}
            onTp1Close={() => setTp1(null)}
            onTp1Pick={onTp1Pick}
            onTp1Line={onTp1Line}
            onTp1Add={onTp1Add}
            onTp1Del={onTp1Del}
            onTp1EffMonth={(m) => setTp1((t) => (t ? { ...t, effMonth: Number(m) || 1 } : t))}
            onTp1Note={(v) => setTp1((t) => (t ? { ...t, note: v } : t))}
            onTp1Save={onTp1Save}
            onGridSave={onGridSave}
            onFinalise={onFinalise}
            onEditFinalised={() => setEditFinal(true)}
            onRowMenu={(id) => setRowMenu((c) => (c === id ? null : id))}
            onCell={onCell}
            onPcbCell={onPcbCell}
            onPcbAuto={onPcbAuto}
            onDedOpen={(id) => setDedEmp((c) => (c === id ? null : id))}
            onDedAdd={onDedAdd}
            onDedDel={onDedDel}
            onDedLabel={onDedLabel}
            onDedAmt={onDedAmt}
            onSkip={onSkip}
            onResign={onResign}
            onEmpDelete={onEmpDelete}
            onSubmitAll={() => toLegacy('The submission pack (ZIP of every statutory file)')}
            onUobSave={onUobSave}
            onExpBank={(b) => toLegacy(`The ${b} salary file`)}
            onExpGiro={() => toLegacy('The generic IBG CSV')}
            onExpKwsp={() => toLegacy('The KWSP i-Akaun file')}
            onExpAssist={() => toLegacy('The PERKESO ASSIST file')}
            onExpCp39={() => toLegacy('The CP39 / e-PCB file')}
            onPostXero={() => toLegacy('Posting the Xero journal')}
            onExpSummary={() => toLegacy('The payroll summary (Excel)')}
            onExpPayslips={() => toLegacy('The payslips PDF')}
            onEmailAll={() => toLegacy('Emailing payslips')}
            onExpStatutory={(f: StatFile) => toLegacy(`The raw ${f.toUpperCase()} csv`)}
            onHubTick={onHubTick}
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
        <a href={`${legacyUrl('hros.html')}#tab=payroll`}>hros.html · Payroll</a>, unchanged. This page runs the
        same statutory engine (<code>payroll.js</code>) from the same session and is diffed against the same golden.
        The statutory file exports and the rates / company / statutory-numbers editors are on the legacy
        screen only; 🧾 TP1 reliefs is migrated.
      </div>
    </div>
  );
}
