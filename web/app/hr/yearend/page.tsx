'use client';

// The route. Everything impure lives here — the session, the fetch, the clock read, the jsPDF load and
// the file downloads — so that src/hr-yearend.tsx stays a pure function of its props and can be diffed
// against the legacy golden. Same split as the four screens before it:
//
//   app/<area>/<screen>/page.tsx   'use client', loads, holds state, wires handlers   — not golden-tested
//   src/<screen>.tsx              pure, props in / markup out                         — golden-tested

import { useCallback, useEffect, useRef, useState } from 'react';

import HrYearend, { defaultTaxYear, eaSelection, taxYears, type YeEmployee, type YeTotals } from '../../../src/hr-yearend';
import { call, legacyUrl, token } from '../../../src/portal';
import { hrCp8dFile, hrDrawEA, hrDrawFormE, hrEmpView, hrFormEStats, hrYePaid, HR_EA_ZERO } from '../../../../hr-docs.js';

interface Employer { name?: string; employer_no?: string; address?: string }
interface Annual { annual?: Record<string, YeTotals>; employer?: Employer | null }

/**
 * `hrLoadJsPDF()` — hros.html:4432. The vendored UMD build is loaded on demand from the legacy app's own
 * path, exactly as app/hr/payslip/page.tsx and app/finance/recon/page.tsx do. Resolves either way rather
 * than rejecting, so awaiting code fails visibly instead of hanging.
 */
function loadJsPDF(): Promise<(new (o: Record<string, unknown>) => { addPage: () => void; save: (n: string) => void }) | null> {
  const w = window as unknown as { jspdf?: { jsPDF?: unknown } };
  if (w.jspdf && w.jspdf.jsPDF) return Promise.resolve(w.jspdf.jsPDF as never);
  return new Promise((res) => {
    const s = document.createElement('script');
    s.src = legacyUrl('jspdf.umd.min.js');
    s.onload = () => res((w.jspdf && w.jspdf.jsPDF) as never);
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });
}

/** `hrDownload()` — hros.html:4447. Impure by definition, so it lives in the route, not in `src/`. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export default function HrYearendPage() {
  const [company, setCompany] = useState<string | null>(null);
  const [employees, setEmployees] = useState<YeEmployee[] | null>(null);
  const [year, setYear] = useState(() => defaultTaxYear(new Date()));
  const [years] = useState(() => taxYears(new Date()));
  const [data, setData] = useState<Annual | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    (async () => {
      try {
        const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
        const co = await call<{ companies?: { tenant_id: string; tenant_name: string }[] }>({ api: 'hr_companies' });
        const list = co.companies || [];
        setCompany((list.find((c) => c.tenant_id === saved) || list[0])?.tenant_name || '');
        setEmployees((await call<{ employees?: YeEmployee[] }>({ api: 'hr_bootstrap' })).employees || []);
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    })();
  }, []);

  /** `hrYeLoad()` — hros.html:4946. Re-runs whenever the Y/A changes, which is what Load does. */
  useEffect(() => {
    if (signedIn !== true) return;
    let live = true;
    setData(null);
    call<Annual>({ api: 'hr_annual', year })
      .then((r) => { if (live) setData({ annual: r.annual || {}, employer: r.employer || null }); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [signedIn, year]);

  /**
   * `hrYePick()` — hros.html:4945. Reads `#hr_yey` back out of the DOM exactly as the legacy one does,
   * because the component leaves the <select> uncontrolled for that reason. Scoped to this screen's
   * subtree rather than `document`, so it cannot pick up an id the shell happens to reuse.
   */
  const onPick = useCallback(() => {
    const v = rootRef.current?.querySelector<HTMLSelectElement>('#hr_yey')?.value;
    if (v) setYear(Number(v));
  }, []);

  /**
   * The three exports. The FIGURES they carry are `hr-docs.js`'s — `hrYePaid`, `hrFormEStats`,
   * `hrCp8dFile`, `hrDrawEA`, `hrDrawFormE` — the same file hros.html loads as a classic script, so a
   * form filed from React cannot disagree with the same form filed from the legacy screen. What lives
   * here is what the legacy screen keeps in its buttons too: loading jsPDF, saving the file, the notice.
   */
  const [note, setNote] = useState<string | null>(null);

  const onExpEA = useCallback(async (empId: string | 0) => {
    const ann = data?.annual || {};
    const sel = eaSelection(employees || [], ann, empId, year);
    if ('error' in sel) { setNote(sel.error); return; }
    const jsPDF = await loadJsPDF();
    if (!jsPDF) { setNote('Could not load the PDF engine (jspdf.umd.min.js).'); return; }
    // hros.html:4954's fallback employer, for a company with no hr_employer_info row yet.
    const emp = data?.employer || { name: company || '', employer_no: '', address: '' };
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    sel.list.forEach((e, i) => {
      if (i > 0) doc.addPage();
      hrDrawEA(doc, hrEmpView(e), (ann[e.id] as never) || HR_EA_ZERO, year, emp as Record<string, unknown>);
    });
    doc.save(sel.fileName);
    setNote('EA form(s) generated');
  }, [company, data, employees, year]);

  const onExpFormE = useCallback(async () => {
    const jsPDF = await loadJsPDF();
    if (!jsPDF) { setNote('Could not load the PDF engine (jspdf.umd.min.js).'); return; }
    const emp = data?.employer || { name: company || '', employer_no: '' };
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    hrDrawFormE(doc, emp as Record<string, unknown>, hrFormEStats(employees || [], (data?.annual || {}) as never, year), year);
    doc.save('FormE_YA' + year + '.pdf');
    setNote('Form E generated');
  }, [company, data, employees, year]);

  const onExpCp8d = useCallback((fmt: 'txt' | 'csv') => {
    const ann = data?.annual || {};
    const list = hrYePaid(employees || [], ann as never)
      .map((e) => ({ emp: hrEmpView(e) as Record<string, unknown>, tot: ann[e.id] as never }));
    if (!list.length) { setNote('No paid employees for ' + year); return; }
    const out = hrCp8dFile(list, data?.employer?.employer_no, year, fmt);
    download(out.name, out.text);
    setNote(fmt === 'txt' ? 'CP8D TXT generated' : 'CP8D CSV generated');
  }, [data, employees, year]);

  return (
    <div ref={rootRef}>
      <Banner />
      {/* `toast()` has no React equivalent yet (CLAUDE.md, "Still not done"), so the export refusals and
          confirmations the legacy screen toasts are shown here instead of being swallowed. */}
      {note ? <div className="panel" style={{ marginBottom: '14px' }}><div className="muted" style={{ padding: '10px 14px', fontSize: '12px' }}>{note}</div></div> : null}
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
        : !employees || company === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : (
          <HrYearend
            year={year}
            years={years}
            employees={employees}
            annual={data?.annual ?? null}
            employerNo={data?.employer?.employer_no || ''}
            companyName={company}
            onPick={onPick}
            onExpEA={onExpEA}
            onExpFormE={onExpFormE}
            onExpCp8d={onExpCp8d}
          />
        )}
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
        <a href={`${legacyUrl('hros.html')}#tab=yearend`}>hros.html · Year-end</a>, unchanged. This page renders
        the same data from the same session and is diffed against the same golden. The EA / Form E / CP8D
        forms are built by the same shared <code>hr-docs.js</code> both apps load, so a filing made here
        and one made there carry the same figures.
      </div>
    </div>
  );
}
