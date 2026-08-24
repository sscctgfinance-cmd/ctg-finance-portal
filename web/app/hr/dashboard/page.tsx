'use client';

// The route. Everything impure lives here — the session, the fetches, the period walk, the snapshot
// refresh and the CSV download — so that src/hr-dashboard.tsx stays a pure function of its props and
// can be diffed against all five of the legacy goldens. Same split as the pilot:
//
//   app/<area>/<screen>/page.tsx   'use client', loads, holds state, wires handlers   — not golden-tested
//   src/<screen>.tsx              pure, props in / markup out                         — golden-tested

import { useCallback, useEffect, useRef, useState } from 'react';

import HrDashboard, { type DashData, type DashEmployee, type DashPage } from '../../../src/hr-dashboard';
import { mytYMD } from '../../../../myt.js';
import { call, legacyUrl, token } from '../../../src/portal';
import FailedLoad from '../../../src/failed-load';

/** hros.html:1410 — the fallback company when the account has no Xero orgs. */
const PROCARE = 'I PROCARE MALAYSIA SDN BHD';

interface Company { tenant_id: string; tenant_name: string }

/** `hrDashStepRaw` — hros.html:1743. Month walk with the year carry, kept as its own pure function. */
function stepRaw(month: number, year: number, delta: number): { month: number; year: number } {
  let m = month + delta, y = year;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  return { month: m, year: y };
}

/** `hrDashExportCsv`'s cell quoting — hros.html:1762. */
function csvLine(a: (string | number | null | undefined)[]): string {
  return (a || []).map((c) => {
    const s = String(c == null ? '' : c);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',');
}

/**
 * `hrDashExportCsv()` — hros.html:1760, verbatim in what it writes and in what order. It is a download
 * side effect with no markup, so no golden can hold it; the component's only obligation is to CALL it,
 * which tests/hr-dashboard.parity.test.tsx asserts. Everything it touches (Blob, URL, a click) is
 * browser API, which is exactly why it lives on this side of the line.
 */
function exportCsv(d: DashData, page: DashPage, companyName: string): void {
  const per = (d.period && d.period.label) || '';
  const rows: string[] = [];
  const push = (a: (string | number | null | undefined)[]) => rows.push(csvLine(a));
  push(['HR OS Dashboard — ' + page.toUpperCase(), per, companyName]);
  push([]);
  if (page === 'overview') {
    const o = d.overview;
    push(['Metric', 'Value']);
    Object.keys(o).forEach((k) => push([k, o[k]]));
    push([]);
    push(['Insight type', 'Title', 'Severity', 'Metric', 'Comparison', 'Suggested action']);
    (d.insights || []).forEach((x) => push([
      (x as unknown as Record<string, string>).insight_type, x.title, x.severity,
      (x as unknown as Record<string, string>).metric_value,
      (x as unknown as Record<string, string>).comparison_value, x.suggested_action,
    ]));
  } else if (page === 'headcount') {
    const h = d.headcount as unknown as Record<string, number>;
    push(['Metric', 'Value']);
    (['total', 'active', 'inactive', 'new_hires', 'resigned'] as const).forEach((k) => push([k, h[k]]));
    push([]); push(['By department']); d.headcount.by_dept.forEach((x) => push([x.label, x.value]));
    push([]); push(['By position']); d.headcount.by_position.forEach((x) => push([x.label, x.value]));
    push([]); push(['By employment type']); d.headcount.by_type.forEach((x) => push([x.label, x.value]));
  } else if (page === 'payroll') {
    const p = d.payroll as unknown as Record<string, number>;
    push(['Metric', 'Value']);
    (['gross', 'net', 'basic', 'allowance', 'claim', 'bonus', 'epf_ee', 'epf_er', 'socso_ee', 'socso_er',
      'eis_ee', 'eis_er', 'pcb'] as const).forEach((k) => push([k, p[k]]));
    push([]); push(['Employee', 'Gross', 'Net', 'Employer cost']);
    d.payroll.by_employee.forEach((x) => push([x.label, x.gross, x.net, x.cost]));
  } else if (page === 'attendance') {
    const a = d.attendance as unknown as Record<string, number>;
    push(['Metric', 'Value']);
    (['attendance_rate', 'late_rate', 'absenteeism_rate', 'missing_clock', 'ot_hours', 'ot_cost'] as const)
      .forEach((k) => push([k, a[k]]));
    push([]); push(['Department', 'Attendance %']); d.attendance.by_dept.forEach((x) => push([x.label, x.value]));
    push([]); push(['Late ranking']); d.attendance.late_rank.forEach((x) => push([x.label, x.value]));
    push([]); push(['Absence ranking']); d.attendance.absence_rank.forEach((x) => push([x.label, x.value]));
  } else if (page === 'cost') {
    const c = d.cost as unknown as Record<string, number>;
    push(['Metric', 'Value']);
    (['total_hr_cost', 'salary_cost', 'epf_er', 'socso_er', 'eis_er', 'claim_cost', 'ot_cost',
      'cost_per_employee'] as const).forEach((k) => push([k, c[k]]));
    push([]); push(['Employee', 'Employer cost']); d.cost.by_employee.forEach((x) => push([x.label, x.value]));
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a2 = document.createElement('a');
  a2.href = url;
  a2.download = 'HR_Dashboard_' + page + '_' + String(per).replace(/\s/g, '_') + '.csv';
  a2.click();
  URL.revokeObjectURL(url);
}

export default function HrDashboardPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [employees, setEmployees] = useState<DashEmployee[]>([]);
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<DashPage>('overview');
  const [period, setPeriod] = useState<{ month: number; year: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  /**
   * `HR_DASH.steps` — hros.html:1751. The auto-walk gives up after 6 empty months, and `hrDashStep()`
   * parks it at 99 so an explicit walk never triggers it. A ref rather than state: it is a loop guard,
   * not something the screen renders, and re-rendering on it would restart the very loop it bounds.
   */
  const steps = useRef(0);

  const load = useCallback(async (tenant: string | null, month: number, year: number, auto: boolean) => {
    setLoading(true);
    setErr(null);
    // `hrDashLoad`'s try/finally (hros.html:1746): an unhandled throw wedged loading=true forever and
    // froze the tab on the spinner until F5. Same guard, same reason.
    try {
      let m = month, y = year;
      for (;;) {
        const r = await call<{ data: DashData }>({ api: 'hr_dashboard', tenant, month: m, year: y });
        setPeriod({ month: m, year: y });
        setData(r.data);
        const o = r.data && r.data.overview;
        if (!(auto && o && (Number(o.gross) || 0) === 0 && (Number(o.attendance_rate) || 0) === 0 && steps.current < 6)) break;
        steps.current++;
        ({ month: m, year: y } = stepRaw(m, y, -1));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (!t) { setLoading(false); return; }
    void (async () => {
      try {
        const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
        const co = await call<{ companies?: Company[] }>({ api: 'hr_companies' });
        const list = co.companies || [];
        const pick = list.find((c) => c.tenant_id === saved) || list.find((c) => c.tenant_name === PROCARE) || list[0] || null;
        setCompany(pick);
        // `hrDashEmpTable()` reads the employee master, which the dashboard response does not carry.
        const boot = await call<{ employees?: DashEmployee[] }>({ api: 'hr_bootstrap', tenant: pick ? pick.tenant_id : null });
        setEmployees(boot.employees || []);
        // `hrDashboard()`'s own first-paint default — hros.html:1727, MALAYSIAN since v224.
        const now = mytYMD(Date.now())!;
        await load(pick ? pick.tenant_id : null, now.month, now.year, true);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
  }, [load]);

  const tenant = company ? company.tenant_id : null;

  /** `hrDashStep()` — hros.html:1757. */
  const onStep = useCallback((delta: number) => {
    if (!period) return;
    const next = stepRaw(period.month, period.year, delta);
    steps.current = 99;
    setPeriod(next);
    setData(null);
    void load(tenant, next.month, next.year, false);
  }, [period, tenant, load]);

  /** `hrDashRefresh()` — hros.html:1759. The toasts become this page's own notice line. */
  const onRefresh = useCallback(async () => {
    if (!period) return;
    setNotice('Refreshing + saving snapshot…');
    try {
      const r = await call<{ data: DashData; insights: number }>(
        { api: 'hr_dash_refresh', tenant, month: period.month, year: period.year });
      setData(r.data);
      setNotice('Snapshot saved · ' + r.insights + ' insight(s)');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }, [period, tenant]);

  const onExportCsv = useCallback(() => {
    if (!data) { setNotice('Nothing to export'); return; }
    exportCsv(data, page, company ? company.tenant_name : '');
  }, [data, page, company]);

  const onPrint = useCallback(() => window.print(), []);

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
        : err ? <FailedLoad message={err} />
        : (
          <HrDashboard
            data={data}
            loading={loading}
            page={page}
            employees={employees}
            companyName={company ? company.tenant_name : ''}
            month={period ? period.month : 0}
            year={period ? period.year : 0}
            onSetPage={setPage}
            onStep={onStep}
            onRefresh={onRefresh}
            onExportCsv={onExportCsv}
            onPrint={onPrint}
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
        <a href={`${legacyUrl('hros.html')}#tab=dashboard`}>hros.html · Dashboard</a>, unchanged. This page renders
        the same data from the same session and is diffed against the same five goldens.
      </div>
    </div>
  );
}
