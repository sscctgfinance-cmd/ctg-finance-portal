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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import HrPayroll, {
  EMPLOYER_TEXT_FIELDS, HR_MONTHS, LOGO_JPEG_QUALITY, RATES_INPUT_IDS,
  dueInfo, employerBody, employerInit, finaliseRows, gridAll, gridInit, gridSaveAdjustments, gridState,
  logoDataRefusal, logoFileRefusal, logoScale, ratesBody, statIdsBody, statIdsRows, tp1Body,
  type CellField, type EmployerEdit, type GridRow, type HubKey, type PayData, type PayEmployee,
  type PayrollRun, type RatesCfg, type StatFile, type StatIdField, type StatIdRow, type StatIdsState,
  type SubmitPack, type Tp1Line, type Tp1State, type UobCfg,
} from '../../../src/hr-payroll';
import {
  statutoryExport, kwspExport, assistExport, cp39Export, giroExport, bankExport, submitAllAction,
  summaryExport, payslipEmp, payslipEmailBody, xeroPostBody, type FileAction,
} from '../../../src/hr-payroll-files';
import { showConfirm } from '../../../src/confirm';
import { toast } from '../../../src/toast';
import { useUnsavedGuard } from '../../../src/unsaved';
import { hrDrawPayslip, hrIcPassword, hrAbToB64 } from '../../../../hr-docs.js';
import { mytISO, mytYMD } from '../../../../myt.js';
import { call, legacyUrl, token } from '../../../src/portal';

/** Blob-and-anchor download — the impure half of every file export; `hrDownload()` (hros.html) + the ZIP anchor. */
function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** jsPDF, injected from this origin on first use — the same shape app/hr/calculator and app/hr/payslip use. */
interface JsPdfDoc { save: (n: string) => void; addPage: () => void; output: (t: string) => ArrayBuffer }
type JsPdfCtor = new (o: Record<string, unknown>) => JsPdfDoc;
function loadJsPDF(): Promise<JsPdfCtor | null> {
  const w = window as unknown as { jspdf?: { jsPDF?: JsPdfCtor } };
  if (w.jspdf && w.jspdf.jsPDF) return Promise.resolve(w.jspdf.jsPDF);
  return new Promise((res) => {
    const s = document.createElement('script');
    s.src = legacyUrl('jspdf.umd.min.js');
    s.onload = () => res((w.jspdf && w.jspdf.jsPDF) || null);
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });
}

/** hros.html:1410 — the fallback company when the account has no Xero orgs. */
const PROCARE = 'I PROCARE MALAYSIA SDN BHD';

interface Company { tenant_id: string; tenant_name: string }

/** `hrHubKey()` — hros.html:3826. Same key the legacy screen writes, so the ticks are shared. */
const hubKey = (tenant: string, month: number, year: number) => `hr_hub_${tenant}_${month}-${year}`;

function readJson<T>(key: string, fallback: T): T {
  try { return (JSON.parse(localStorage.getItem(key) || 'null') as T) || fallback; } catch { return fallback; }
}

/**
 * `todayLocalISO()` — hros.html:1271, which v224 made MALAYSIAN. The row menu's resign-date default,
 * i.e. an employee's last working day, which decides their final month's proration.
 */
const todayLocalISO = (): string => mytISO(Date.now());

export default function HrPayrollPage() {
  // v224: MALAYSIAN, as hros.html:4058 now is. Was the machine's zone, so on the 1st an operator west
  // of Greenwich opened LAST month's payroll run.
  const now = mytYMD(Date.now())!;
  const [company, setCompany] = useState<Company | null>(null);
  const [month, setMonth] = useState(now.month);
  const [year, setYear] = useState(now.year);
  const [data, setData] = useState<PayData | null>(null);
  const [grid, setGrid] = useState<Record<string, GridRow>>({});
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);            // beforeunload + nav-away confirm — HR.pay.dirty's React mirror
  const [ticks, setTicks] = useState<Partial<Record<HubKey, boolean>>>({});
  const [uob, setUob] = useState<UobCfg>({});
  const [dedEmp, setDedEmp] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [editFinal, setEditFinal] = useState(false);
  // `HR.pay.runs` / `HR.pay.runsFor` / `HR.pay.runsOpen`. `null` is "not read yet" and renders
  // nothing; `runsFor` is what stops a repaint refetching, and what makes a company switch refetch.
  const [runs, setRuns] = useState<PayrollRun[] | null>(null);
  const [runsFor, setRunsFor] = useState('');
  const [runsOpen, setRunsOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [submitPack, setSubmitPack] = useState<SubmitPack | null>(null);

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
      setSubmitPack(null);   // hrPickPeriod() resets HR.submitPack — hros.html:4375
      if (tenant) {
        setTicks(readJson(hubKey(tenant, m, y), {} as Partial<Record<HubKey, boolean>>));
        setUob(readJson(`hr_uob_${tenant}`, {} as UobCfg));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /**
   * `hrRunsLoad()` — one read per company, cached. The legacy kicks it from the RENDERER and guards
   * the repaint; here the effect is the guard, and `runsFor` is the same claim-it-first flag: without
   * it a re-render mid-flight fires a second read.
   *
   * A company switched while the read is in flight DROPS the answer rather than showing another
   * company's payroll history — the tenant hole v225 closed on the server, kept shut on the client.
   */
  useEffect(() => {
    const t = company ? company.tenant_id : '';
    if (!t || runsFor === t) return;
    setRunsFor(t);
    let live = true;
    void (async () => {
      try {
        const r = await call<{ ok?: boolean; runs?: PayrollRun[] }>({ api: 'hr_payroll_runs_list', tenant: t });
        if (live) setRuns(r && r.ok ? (r.runs || []) : []);
      } catch { if (live) setRuns([]); }
    })();
    return () => { live = false; };
  }, [company, runsFor]);

  const onRunsToggle = useCallback(() => setRunsOpen((o) => !o), []);

  /**
   * `hrRunOpen()` — the same discard guard `hrPickPeriod()` uses. A second way into the same state
   * change is a second way to lose entries the operator typed and has not saved.
   */
  const onRunOpen = useCallback(async (m: number, y: number) => {
    if ((m !== month || y !== year) && dirty && !await showConfirm('Unsaved payroll entries',
      `You have unsaved payroll entries for ${HR_MONTHS[month]} ${year}.\n\nLeave without saving? The figures you typed will be lost.`, 'Discard')) return;
    setRunsOpen(false);
    setMonth(m); setYear(y);
    void load(m, y);
  }, [dirty, month, year, load]);

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

  // `hrOnce()` — hros.html:4167. A SYNCHRONOUS ref, not `useState`: two rapid clicks both read the same
  // stale `false` out of a state closure and both fire the POST (five such holes were fixed in PRs
  // 108/109/112). The ref is set before any await and released in `finally` for every branch, exactly as
  // hrOnce's try/finally does — so a cancelled confirm or an early guard also frees it.
  const savingGrid = useRef(false);
  const finalising = useRef(false);

  /**
   * `hrGridSave()` — hros.html:4304. Posts a DELTA (`gridSaveAdjustments`), not a full row per employee,
   * to `hr_payroll_grid_save`. On success the legacy drops `HR.pay.data` and re-renders, which reloads
   * the month; here that is an explicit reload, so the saved adjustments come back and the grid recomputes
   * from the server's stored basis.
   */
  const onGridSave = useCallback(async () => {
    if (savingGrid.current) return;
    savingGrid.current = true;
    try {
      if (!data) return;
      await call({ api: 'hr_payroll_grid_save', month, year, adjustments: gridSaveAdjustments(data, grid), tenant: company ? company.tenant_id : null });
      setNotice('Payroll entries saved ✓ — not final until you finalise');
      setDirty(false);
      setRuns(null); setRunsFor('');     // the 📋 list still shows this month as "never saved"
      await load(month, year);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      savingGrid.current = false;
    }
  }, [data, grid, month, year, company, load]);

  /**
   * `hrFinalise()` — hros.html:4364. Posts the `rows` shape (`finaliseRows`): one entry per computed
   * grid row with its eleven statutory figures. The server recomputes from the SAVED adjustments and 409s
   * on any disagreement, so unsaved entries must be refused up-front with the real message (hros.html:4370)
   * rather than left to fail on a confusing stale-cache error.
   */
  const onFinalise = useCallback(async () => {
    if (finalising.current) return;
    finalising.current = true;
    try {
      const rows = data ? finaliseRows(gridAll(data, grid, { month, year }).rows) : [];
      if (!rows.length) { setNotice('No active employees'); return; }
      if (dirty) { setNotice('Save your entries first — click 💾 Save entries, then finalise'); return; }
      if (!await showConfirm('Finalise payroll',
        `Finalise ${HR_MONTHS[month]} ${year} (${rows.length} employees)? Payslips are written for every employee in the run.`, 'Finalise', 'p')) return;
      await call({ api: 'hr_payroll_finalise', month, year, rows, tenant: company ? company.tenant_id : null });
      setNotice('Payroll finalised ✓');
      setEditFinal(false);
      setRuns(null); setRunsFor('');     // draft → finalised, and every total in the 📋 list moves
      await load(month, year);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      finalising.current = false;
    }
  }, [data, grid, dirty, month, year, company, load]);

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
   * The statutory / bank FILE exports (v226) — `hrExpStatutory`, `hrExpKwsp`, `hrExpAssist`, `hrExpCp39`,
   * `hrExpGiro`, `hrExpBank` and the `hrSubmitAll` ZIP. The BYTES are built by `hr-docs.js` (the same
   * functions hros.html calls, so no fork — see `src/hr-payroll-files.ts`); each handler here runs that
   * pure descriptor and does the I/O: toast + blob-and-anchor. The Excel summary, the payslips PDF and its
   * email, and the Xero draft journal are wired further down (they need jsPDF and a POST loop).
   */
  const runFileAction = useCallback((a: FileAction) => {
    a.toasts.forEach((t) => toast(t.msg, t.isErr));
    if (a.download) downloadBlob(a.download.name, new Blob([a.download.text], { type: a.download.mime || 'text/csv;charset=utf-8;' }));
    if (a.zip) downloadBlob(a.zip.name, a.zip.blob);
    if (a.pack) setSubmitPack(a.pack);
  }, []);

  /* ── ⚙️ Rates · 🏢 Company · 🆔 Statutory numbers — the three record editors ──────────────────────
   *
   * All three keep the legacy's shape: the panel holds a working copy, the INPUTS are uncontrolled and
   * carry the legacy element ids, and the save reads them back out of the DOM and hands them to the
   * pure body builder in src/. Each save is guarded against a double-click by an in-flight flag, which
   * is React's spelling of `hrOnce()` (hros.html:4167) — the button is disabled and relabelled, and the
   * flag is released in `finally` so one network error does not strand the operator.
   */

  const [rates, setRates] = useState<RatesCfg | null>(null);
  const [savingRates, setSavingRates] = useState(false);
  const [employer, setEmployer] = useState<EmployerEdit | null>(null);
  const [employerLoading, setEmployerLoading] = useState(false);
  const [savingEmployer, setSavingEmployer] = useState(false);
  const [statIds, setStatIds] = useState<StatIdsState | null>(null);
  const [savingStatIds, setSavingStatIds] = useState(false);

  /** `hrRatesToggle()` — hros.html:4081. The cfg is already loaded: it is what drives the grid. */
  const onRatesToggle = useCallback(() =>
    setRates((r) => (r ? null : ((data?.rates as RatesCfg) || null))), [data]);

  /**
   * `hrRatesSave()` — hros.html:4172. ONE row, group-wide, so there is no tenant in the body and the
   * server wants a full-scope admin. On success the new rates go straight back into `data`, which is
   * what the grid computes from — the legacy's `HR.pay.data.rates=rates`, i.e. "applies immediately".
   */
  const onRatesSave = useCallback(async () => {
    if (savingRates || !rates) return;
    setSavingRates(true);
    try {
      const vals: Record<string, string> = {};
      RATES_INPUT_IDS.forEach((id) => { vals[id] = (document.getElementById(id) as HTMLInputElement | null)?.value ?? ''; });
      const body = ratesBody(vals, rates);
      await call(body);
      setData((d) => (d ? { ...d, rates: body.rates } : d));
      setRates(null);
      setNotice('Statutory rates saved ✓');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingRates(false);
    }
  }, [rates, savingRates]);

  /**
   * `hrEmployerToggle()` — hros.html:4084. The legacy already holds the employer record (it comes down
   * with `hr_bootstrap` into `HR.data`); this screen loads only `hr_payroll_data`, which does not carry
   * one (hr.ts:1749), so the panel fetches it on open from the same action the legacy got it from.
   */
  const onEmployerToggle = useCallback(async () => {
    if (employer || employerLoading) { setEmployer(null); setEmployerLoading(false); return; }
    if (!company) { setNotice('Pick a company first'); return; }
    setEmployerLoading(true);
    try {
      const r = await call<{ employer?: Partial<EmployerEdit> | null }>({ api: 'hr_bootstrap', tenant: company.tenant_id });
      setEmployer(employerInit(r.employer, company.tenant_name));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setEmployerLoading(false);
    }
  }, [company, employer, employerLoading]);

  /** `hrEmployerSyncInputs()` — hros.html:4110. The nine text boxes, read back by their legacy ids. */
  const employerFromDom = useCallback((e: EmployerEdit): EmployerEdit => {
    const out = { ...e };
    EMPLOYER_TEXT_FIELDS.forEach((k) => {
      const el = document.getElementById('emp_' + k) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) out[k] = el.value;
    });
    return out;
  }, []);

  /** `hrEmployerLogoClear()` — hros.html:4112. `null`, not absent: the server reads that as "clear it". */
  const onEmployerLogoClear = useCallback(() =>
    setEmployer((e) => (e ? { ...employerFromDom(e), logo: null } : e)), [employerFromDom]);

  /**
   * `hrEmployerLogoPick()` — hros.html:4113. The canvas is device code and stays here; every number it
   * uses (4 MB, 260px, 380,000 chars, JPEG 0.85) is a pure helper in src/ so it is under test.
   */
  const onEmployerLogoPick = useCallback((f: File | null) => {
    if (!f) return;
    const refusal = logoFileRefusal(f);
    if (refusal) { setNotice(refusal); return; }
    setEmployer((e) => (e ? employerFromDom(e) : e));
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const { w, h } = logoScale(img.width, img.height);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        if (!ctx) { setNotice('Could not read that image'); return; }
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
        let out = cv.toDataURL('image/png');
        if (logoDataRefusal(out)) out = cv.toDataURL('image/jpeg', LOGO_JPEG_QUALITY);
        const tooBig = logoDataRefusal(out);
        if (tooBig) { setNotice(tooBig); return; }
        setEmployer((e) => (e ? { ...e, logo: out } : e));
      };
      img.onerror = () => setNotice('Could not read that image');
      img.src = String(ev.target?.result || '');
    };
    reader.readAsDataURL(f);
  }, [employerFromDom]);

  /**
   * `hrEmployerSave()` — hros.html:4128. The logo travels in this one request, so the guard below IS
   * the upload's double-submit guard: a second click while the first POST is in flight would file the
   * same image again and race the two writes to `hr_employer_info`.
   */
  const onEmployerSave = useCallback(async () => {
    if (savingEmployer || !employer) return;
    const edit = employerFromDom(employer);
    const body = employerBody(edit, company ? company.tenant_id : null);
    if ('error' in body) { setEmployer(edit); setNotice(body.error as string); return; }
    setSavingEmployer(true);
    try {
      await call(body);
      setEmployer(null);
      setNotice('Company details saved ✓');
    } catch (e) {
      setEmployer(edit);
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEmployer(false);
    }
  }, [company, employer, employerFromDom, savingEmployer]);

  /** `hrStatIdsOpen()` — hros.html:3886. */
  const onStatIdsOpen = useCallback(async () => {
    if (!company) { setNotice('Pick a company first'); return; }
    setStatIds({ loading: true, rows: null });
    try {
      const r = await call<{ employees?: Record<string, unknown>[] }>({ api: 'hr_stat_ids_get', tenant: company.tenant_id });
      setStatIds({ loading: false, rows: statIdsRows(r.employees || []) });
    } catch (e) {
      setStatIds(null);
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }, [company]);

  /** `hrStatIdsCell()` — hros.html:3898. The value is TRIMMED as it is stored, as the legacy does. */
  const onStatIdsCell = useCallback((id: string, field: StatIdField, v: string) => {
    setStatIds((st) => (st && st.rows
      ? { ...st, rows: st.rows.map((r) => (r.id === id ? { ...r, [field]: String(v == null ? '' : v).trim() } : r)) }
      : st));
  }, []);

  /**
   * `hrStatIdsSave()` — hros.html:3913. The legacy drops `HR.pay.data` afterwards so the exports see
   * the new numbers; here that is a reload of the month.
   */
  const onStatIdsSave = useCallback(async () => {
    if (savingStatIds) return;
    const body = statIdsBody(company ? company.tenant_id : null, (statIds && statIds.rows) || ([] as StatIdRow[]));
    if ('error' in body) { setNotice(body.error as string); return; }
    setSavingStatIds(true);
    try {
      const r = await call<{ n?: number }>(body);
      setNotice(`Statutory numbers saved ✓ (${r.n || 0} staff)`);
      setStatIds(null);
      await load(month, year);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingStatIds(false);
    }
  }, [company, load, month, savingStatIds, statIds, year]);

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

  /* ── The statutory / bank file export handlers. Defined here, after `A` (the computed rows), because
   * every one feeds `A.rows`; the buttons are only rendered once `A` exists, and each guards on it too. ── */
  const onExpStatutory = useCallback((f: StatFile) => { if (A) runFileAction(statutoryExport(A.rows, month, year, f)); }, [A, month, year, runFileAction]);
  const onExpKwsp = useCallback(() => { if (A) runFileAction(kwspExport(A.rows, month, year)); }, [A, month, year, runFileAction]);
  const onExpAssist = useCallback(() => { if (A) runFileAction(assistExport(A.rows, month, year)); }, [A, month, year, runFileAction]);
  const onExpCp39 = useCallback(() => { if (A) runFileAction(cp39Export(A.rows, month, year)); }, [A, month, year, runFileAction]);
  const onExpGiro = useCallback(() => { if (A) runFileAction(giroExport(A.rows, month, year)); }, [A, month, year, runFileAction]);
  const onExpBank = useCallback((b: string) => { if (A) runFileAction(bankExport(A.rows, month, year, b === 'maybank' ? 'maybank' : 'uob', uob)); }, [A, month, year, uob, runFileAction]);

  /**
   * `hrSubmitAll()` — hros.html:4488. The "not finalised, generate anyway?" question is a modal and stays
   * here (`showConfirm`); the pack is built and named by `submitAllAction`. A blank tenant name falls back
   * to 'CTG', as the legacy's `hrCompanyName()` does.
   */
  const onSubmitAll = useCallback(async () => {
    if (!A) return;
    if (!A.rows.length) { toast('No payroll to submit — finalise the month first', true); return; }
    if (!finalised && !await showConfirm('Payroll not finalised',
      'This month is not finalised.\n\nThe files will use the figures currently on screen, which may differ from the payslips you issue after finalising.\n\nGenerate anyway?', 'Generate anyway')) return;
    runFileAction(submitAllAction(A.rows, month, year, company ? company.tenant_name : 'CTG', uob));
  }, [A, finalised, month, year, company, uob, runFileAction]);

  /** Payroll Summary (Excel + HRDF) — `hrExpSummary()`, hros.html:4516. */
  const onExpSummary = useCallback(() => { if (A) runFileAction(summaryExport(A.rows, month, year, company ? company.tenant_name : '')); }, [A, month, year, company, runFileAction]);

  /**
   * The payslip PDF and its email both DRAW with `hrDrawPayslip` (the shared file) and read the
   * `HR_EMPLOYER` / `HR_COMPANY` globals off `window`, exactly as app/hr/calculator does. `hr_payroll_data`
   * carries no employer (hr.ts:1751), so it is fetched from `hr_bootstrap` — the same source hros.html
   * boots it from — and cached per company.
   */
  const employerRef = useRef<{ tenant: string; employer: unknown } | null>(null);
  const setPayslipGlobals = useCallback(async () => {
    const g = window as unknown as { HR_EMPLOYER?: unknown; HR_COMPANY?: unknown };
    g.HR_COMPANY = company ? company.tenant_name : '';
    const tenant = company ? company.tenant_id : '';
    if (employerRef.current && employerRef.current.tenant === tenant) { g.HR_EMPLOYER = employerRef.current.employer; return; }
    try {
      const r = await call<{ employer?: unknown }>({ api: 'hr_bootstrap', tenant });
      employerRef.current = { tenant, employer: r.employer || null };
      g.HR_EMPLOYER = r.employer || null;
    } catch { g.HR_EMPLOYER = null; }   // the header just omits the employer's registration numbers
  }, [company]);

  /** `hrExpPayslips()` — hros.html:4410. One PDF, one page per employee. */
  const onExpPayslips = useCallback(async () => {
    if (!A || !A.rows.length) { toast('No payroll rows', true); return; }
    const JsPDF = await loadJsPDF();
    if (!JsPDF) { toast('Could not load the PDF engine (jspdf.umd.min.js).', true); return; }
    await setPayslipGlobals();
    const per = { month, year, label: HR_MONTHS[month] + ' ' + year };
    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    A.rows.forEach((r, i) => { if (i > 0) doc.addPage(); hrDrawPayslip(doc, payslipEmp(r, data?.leaveBalances), r.p as unknown as Record<string, unknown>, per, r.d); });
    doc.save('Payslips_' + per.label.replace(' ', '') + '.pdf');
    toast('Payslips PDF generated');
  }, [A, month, year, data, setPayslipGlobals]);

  /**
   * `hrEmailAll()` — hros.html:4560. One password-protected PDF per employee (locked with their IC),
   * POSTed to `hr_send_payslip` (admin / HR admin only — server enforces `hrManage`). Sends serially so a
   * transient failure counts against one employee and the rest still go, mirroring the legacy `next()` loop.
   */
  const emailingRef = useRef(false);
  const onEmailAll = useCallback(async () => {
    if (emailingRef.current || !A) return;
    if (!A.rows.length) { toast('No payroll rows', true); return; }
    const withEmail = A.rows.filter((r) => (r.e as { email?: string }).email);
    if (!withEmail.length) { toast('No employees have an email on file', true); return; }
    if (!await showConfirm('Email payslips',
      `Email password-protected payslips to ${withEmail.length} employee(s) for ${HR_MONTHS[month]} ${year}? Each PDF is locked with the employee's IC number.`, 'Email')) return;
    const JsPDF = await loadJsPDF();
    if (!JsPDF) { toast('Could not load the PDF engine (jspdf.umd.min.js).', true); return; }
    emailingRef.current = true;
    try {
      await setPayslipGlobals();
      const per = { month, year, label: HR_MONTHS[month] + ' ' + year };
      toast('Sending payslips…');
      let sent = 0, failed = 0;
      for (const r of withEmail) {
        const e = payslipEmp(r, data?.leaveBalances);
        let pdf: string;
        try {
          const doc = new JsPDF({ unit: 'mm', format: 'a4', encryption: { userPassword: hrIcPassword(e), ownerPassword: hrIcPassword(e) + '-o', userPermissions: ['print', 'copy'] } });
          hrDrawPayslip(doc, e, r.p as unknown as Record<string, unknown>, per, r.d);
          pdf = hrAbToB64(doc.output('arraybuffer'));
        } catch { failed++; continue; }
        try { await call(payslipEmailBody(e, per, company ? company.tenant_name : '', pdf)); sent++; } catch { failed++; }
      }
      toast('Payslips emailed — ' + sent + ' sent' + (failed ? (', ' + failed + ' failed') : '') + '.', failed > 0);
    } finally {
      emailingRef.current = false;
    }
  }, [A, month, year, data, company, setPayslipGlobals]);

  /**
   * `hrPostXero()` — hros.html:4707. Posts the finalised run to Xero as a DRAFT manual journal (never
   * auto-approved). `hr_post_xero` is admin / HR admin only (server `hrManage`), and refuses a tenant the
   * admin does not hold. Guarded by a synchronous ref so a double click cannot post two journals.
   */
  const postingXeroRef = useRef(false);
  const onPostXero = useCallback(async () => {
    if (postingXeroRef.current) return;
    const runId = run?.id;
    if (!runId) { toast('Finalise payroll first', true); return; }
    if (!await showConfirm('Post to Xero',
      'Post this payroll to Xero as a DRAFT manual journal? It will NOT be approved automatically — review and post it inside Xero.', 'Post draft')) return;
    postingXeroRef.current = true;
    try {
      toast('Posting draft journal to Xero…');
      await call(xeroPostBody(runId, company ? company.tenant_id : ''));
      toast('Xero draft journal created ✓ — review it in Xero.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Xero posting failed', true);
    } finally {
      postingXeroRef.current = false;
    }
  }, [run, company]);

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
            runs={runs}
            runsOpen={runsOpen}
            onPickPeriod={onPickPeriod}
            onRunsToggle={onRunsToggle}
            onRunOpen={onRunOpen}
            rates={rates}
            savingRates={savingRates}
            onRatesToggle={onRatesToggle}
            onRatesSave={onRatesSave}
            employer={employer}
            employerLoading={employerLoading}
            savingEmployer={savingEmployer}
            onEmployerToggle={onEmployerToggle}
            onEmployerLogoPick={onEmployerLogoPick}
            onEmployerLogoClear={onEmployerLogoClear}
            onEmployerSave={onEmployerSave}
            statIds={statIds}
            savingStatIds={savingStatIds}
            onStatIdsOpen={onStatIdsOpen}
            onStatIdsClose={() => setStatIds(null)}
            onStatIdsCell={onStatIdsCell}
            onStatIdsSave={onStatIdsSave}
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
            submitPack={submitPack}
            onSubmitAll={onSubmitAll}
            onUobSave={onUobSave}
            onExpBank={onExpBank}
            onExpGiro={onExpGiro}
            onExpKwsp={onExpKwsp}
            onExpAssist={onExpAssist}
            onExpCp39={onExpCp39}
            onPostXero={onPostXero}
            onExpSummary={onExpSummary}
            onExpPayslips={onExpPayslips}
            onEmailAll={onEmailAll}
            onExpStatutory={onExpStatutory}
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
        Every control is now migrated: the bank salary files (UOB / Maybank / IBG), the KWSP / PERKESO / CP39
        uploads, the raw statutory CSVs, the Excel summary, the payslips PDF and its email, the Xero draft
        journal, the submission-pack ZIP, and the ⚙️ Rates, 🏢 Company, 🆔 Statutory numbers and 🧾 TP1 editors.
      </div>
    </div>
  );
}
