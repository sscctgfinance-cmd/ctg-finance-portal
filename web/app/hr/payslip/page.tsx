'use client';

// The route. Everything impure lives here — the session, the fetches, the jsPDF loading and the file
// save — so that src/hr-payslip.tsx stays a pure function of its props and can be diffed against the
// legacy golden. Same split as every migrated screen:
//
//   app/<area>/<screen>/page.tsx   'use client', loads, holds state, wires handlers   — not golden-tested
//   src/<screen>.tsx              pure, props in / markup out                         — golden-tested
//
// The PDF is DRAWN BY THE SHARED FILE, not re-expressed: `hrDrawPayslip` and `hrEmpView` are imported
// from ../../../../hr-docs.js — the same file hros.html loads as a classic script — so the payslip an
// employee downloads here cannot drift from the one the legacy screen produces. That is the same rule
// src/hr-expenses.tsx follows for the bank file and src/hr-payroll.tsx for the statutory maths.

import { useCallback, useEffect, useState } from 'react';

import HrPayslip, { type MyPayslips } from '../../../src/hr-payslip';
import { call, legacyUrl, token } from '../../../src/portal';
import { hrDrawPayslip, hrEmpView } from '../../../../hr-docs.js';

const HR_MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * `hrLoadJsPDF()` — hros.html:4432. The vendored UMD build is loaded on demand from the legacy app's
 * own path; it is one of the five vendored libraries and is not moving. Resolves either way rather than
 * rejecting, exactly as the legacy one fires its callbacks on error, so awaiting code fails visibly
 * instead of hanging.
 */
function loadJsPDF(): Promise<unknown> {
  const w = window as unknown as { jspdf?: { jsPDF?: unknown } };
  if (w.jspdf && w.jspdf.jsPDF) return Promise.resolve(w.jspdf.jsPDF);
  return new Promise((res) => {
    const s = document.createElement('script');
    s.src = legacyUrl('jspdf.umd.min.js');
    s.onload = () => res(w.jspdf && w.jspdf.jsPDF);
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });
}

export default function HrPayslipPage() {
  const [company, setCompany] = useState<string | null>(null);
  const [data, setData] = useState<MyPayslips | null>(null);
  const [employee, setEmployee] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
      const co = await call<{ companies?: { tenant_id: string; tenant_name: string }[] }>({ api: 'hr_companies' });
      const list = co.companies || [];
      setCompany((list.find((c) => c.tenant_id === saved) || list[0])?.tenant_name || '');
      // `RC.me.employee` — the employee record the PDF header is drawn from. `hrRCBoot()` (hros.html:1791)
      // is what puts it in scope on the legacy side; here the one call it needs is made directly.
      const me = await call<{ me?: { employee?: Record<string, unknown> } }>({ api: 'hr_rc_config' }).catch(() => ({} as never));
      setEmployee((me && me.me && me.me.employee) || null);
      setData(await call<MyPayslips>({ api: 'hr_my_payslips' }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (t) void load();
  }, [load]);

  /** `hrEmpPayslipDownload(i)` — hros.html:3220. Same order, same globals, same filename. */
  const onDownload = useCallback(async (i: number) => {
    const s = data && data.payslips && data.payslips[i];
    if (!s) return;
    if (!employee) { setErr('No employee profile linked'); return; }
    const jsPDF = await loadJsPDF() as (new (o: Record<string, unknown>) => { save: (n: string) => void }) | null;
    if (!jsPDF) { setErr('Could not load the PDF engine (jspdf.umd.min.js).'); return; }
    try {
      const e = hrEmpView(employee) as Record<string, unknown>;
      e.leaveBal = (data as { leaveBal?: unknown }).leaveBal || [];
      // hrDrawPayslip reads these two as globals; they stay in hros.html, and hr-docs.js's header says
      // so. Employee mode: the header is their OWN company, from the response.
      const g = window as unknown as { HR_EMPLOYER?: unknown; HR_COMPANY?: unknown };
      g.HR_EMPLOYER = (data as { employer?: { name?: string } }).employer || null;
      g.HR_COMPANY = ((data as { employer?: { name?: string } }).employer || {}).name || company || '';
      const per = { month: s.month, year: s.year, label: HR_MONTHS[s.month] + ' ' + s.year };
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      hrDrawPayslip(doc, e, s.p as unknown as Record<string, unknown>, per, (s.d || {}) as unknown as Record<string, unknown>);
      doc.save('Payslip_' + ((e.empNo as string) || 'EMP') + '_' + per.label.replace(' ', '') + '.pdf');
    } catch (x) {
      setErr('Could not generate PDF: ' + (x instanceof Error ? x.message : String(x)));
    }
  }, [company, data, employee]);

  const onRetry = useCallback(() => { setLoaded(false); void load(); }, [load]);

  return (
    <div id="app" style={{ display: 'flex', minHeight: '100vh', alignItems: 'stretch' }}>
      <main style={{ flex: 1, minWidth: 0, padding: '28px 34px 64px' }}>
        <Banner />
        {signedIn === false
          ? <Panel>
              Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
              the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
              already be signed in.
            </Panel>
          : !loaded || company === null
            ? <Panel><span className="spin"></span> Loading your payslips…</Panel>
            : (
              <HrPayslip
                data={data}
                err={err}
                companyName={company}
                onDownload={onDownload}
                onRetry={onRetry}
              />
            )}
      </main>
    </div>
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
        <a href={`${legacyUrl('hros.html')}#tab=payslip`}>hros.html · My Payslips</a>, unchanged. This page renders
        the same data from the same session and is diffed against the same golden. The PDF is drawn by the
        same shared <code>hr-docs.js</code> both apps load.
      </div>
    </div>
  );
}
