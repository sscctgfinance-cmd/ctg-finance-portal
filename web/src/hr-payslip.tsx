// HR OS · My Payslips — the React half of the strangler's thirteenth screen.
//
// The legacy original is `hrEmpPayslips()` / `hrEmpPayslipsRender()` at hros.html:3177 and it is STILL
// THERE and still shipping; nothing was deleted. Both are reachable side by side (`hros.html#tab=payslip`
// and `/hr/payslip/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no jsPDF. That is what lets
// tests/hr-payslip.parity.test.tsx render it with `renderToStaticMarkup` and diff the result against
// tests/golden/hr.payslip.html. The load, the session and the PDF drawing live in
// app/hr/payslip/page.tsx, on the other side of that line.
//
// ── THIS SCREEN ONLY EXISTS IN EMPLOYEE MODE ───────────────────────────────────────────────────────
// `payslip` is in `HR_EMP_NAV` and not in `HR_NAV` (hros.html:1517), and `hrEmpPayslipsLoad()` refuses
// to repaint unless `HR.view==='payslip' && HR_EMP_MODE`. It is one person's own pay and nothing else:
// every figure comes from `hr_my_payslips`, which the server scopes to the caller. There is no employee
// picker, no other person's row and no write control on this screen — and there must not be one here
// either. See the `withholds what employee mode withholds` block in the test.
//
// The response ALSO carries `employer` and `leaveBal`; the legacy renderer reads neither. They exist for
// `hrEmpPayslipDownload()`'s PDF (the employer statutory header and the leave balances printed on a
// payslip), so they are typed here as opaque pass-through and deliberately never rendered.

import type { CSSProperties, ReactNode } from 'react';

/** `HR_MONTHS` — hros.html:1445. Index 0 is the empty string, so `HR_MONTHS[7]` is 'July'. */
const HR_MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `M()` — hros.html:1268. */
function M(n: unknown): string {
  return 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The statutory half of one month's computed pay — `s.p`, as `hrCompute()` returns it. */
export interface PayFigures {
  gross?: number | null;
  epfEe?: number | null;
  socsoEe?: number | null;
  lindung?: number | null;
  eisEe?: number | null;
  pcb?: number | null;
  net?: number | null;
}

/** The adjustments half — `s.d`. Only `deductions` is read on this screen. */
export interface PayDetail {
  deductions?: { label?: string; amount?: number | null }[] | null;
}

export interface Payslip {
  month: number;
  year: number;
  p: PayFigures;
  d?: PayDetail | null;
}

export interface MyPayslips {
  payslips?: Payslip[];
  /** Read by the PDF drawer only — never rendered. See the header. */
  employer?: unknown;
  leaveBal?: unknown;
}

export interface HrPayslipProps {
  /** `EPS.data` (hros.html:3176) — null when the load failed, which is the error branch. */
  data: MyPayslips | null;
  /** `EPS.err`. */
  err?: string | null;
  /** `hrCompanyName()` — hros.html:4445. Chrome, so it is passed in rather than resolved here. */
  companyName: string;
  /** `hrEmpPayslipDownload(i)` — hros.html:3220. `i` indexes `data.payslips`. */
  onDownload: (i: number) => void;
  /** The retry link's `EPS.data=null;EPS.err=null;EPS.loading=false;hrRender()`. */
  onRetry: () => void;
}

/**
 * `dedTot()` — hros.html:3186. Character for character, INCLUDING `lindung`: v196 omitted it, so
 * Gross − Deductions did not equal Net on the employee's own screen. A figure this line gets wrong is a
 * deduction the employee cannot account for.
 */
export function dedTot(s: Payslip): number {
  return (Number(s.p.epfEe) || 0) + (Number(s.p.socsoEe) || 0) + (Number(s.p.lindung) || 0) +
    (Number(s.p.eisEe) || 0) + (Number(s.p.pcb) || 0) +
    ((s.d && s.d.deductions) || []).reduce((a, x) => a + (Number(x.amount) || 0), 0);
}

/** `ic()` — hros.html:1241, with only the two paths this screen draws. */
const ICONS: Record<string, ReactNode> = {
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5M12 15V3" /></>,
  payslip: <><path d="M6 2h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" /><path d="M14 2v6h6M9 13h6M9 17h4" /></>,
};

function Ic({ name, size = 18 }: { name: string; size?: number }) {
  const d = ICONS[name];
  if (!d) return null;
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
  );
}

const RED: CSSProperties = { color: 'var(--red-soft)' };
const GREEN: CSSProperties = { color: 'var(--green-soft)' };

/** The page head hrRender() writes for this view — hros.html:1479. */
function PageHead({ companyName }: { companyName: string }) {
  return (
    <div className="page-head">
      <div>
        <div className="page-eyebrow">Me</div>
        <h2 className="page-title">Payslip</h2>
        <div className="page-sub">View and download your monthly payslips</div>
      </div>
      <div className="page-meta">
        <span className="page-chip"><span className="dot"></span>{companyName}</span>
      </div>
    </div>
  );
}

export default function HrPayslip({ data, err, companyName, onDownload, onRetry }: HrPayslipProps) {
  const head = <PageHead companyName={companyName} />;

  // hros.html:3184. NOT in the golden — the golden is one loaded state — so mirrored from the legacy
  // source rather than diffed. The parity test does not reach this branch; `renders the error branch`
  // pins its shape instead.
  if (!data) {
    return (
      <>
        {head}
        <div className="panel">
          <div className="empty">
            <div className="empty-ico"><Ic name="payslip" size={34} /></div>
            <div>{(err || 'Could not load payslips') + ' — '}<a onClick={onRetry} style={{ cursor: 'pointer', color: 'var(--sky)' }}>retry</a></div>
          </div>
        </div>
      </>
    );
  }

  const slips = data.payslips || [];

  // hros.html:3188 — also outside the golden, for the same reason.
  if (!slips.length) {
    return (
      <>
        {head}
        <div className="empty">
          <div className="empty-ico"><Ic name="payslip" size={34} /></div>
          <div>No payslips yet — they’ll appear here once a month’s payroll is finalised by HR.</div>
        </div>
      </>
    );
  }

  // ── totals: how much has this employee actually earned (per year + all-time) ──
  const byYear: Record<number, { year: number; gross: number; ded: number; net: number; n: number }> = {};
  slips.forEach((s) => {
    const o = byYear[s.year] || (byYear[s.year] = { year: s.year, gross: 0, ded: 0, net: 0, n: 0 });
    o.gross += Number(s.p.gross) || 0; o.ded += dedTot(s); o.net += Number(s.p.net) || 0; o.n++;
  });
  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
  const curY = years[0], cur = byYear[curY];
  const allGross = slips.reduce((a, s) => a + (Number(s.p.gross) || 0), 0);
  const allNet = slips.reduce((a, s) => a + (Number(s.p.net) || 0), 0);
  const allDed = slips.reduce((a, s) => a + dedTot(s), 0);
  const months = (n: number) => n + ' month' + (n === 1 ? '' : 's');

  return (
    <>
      {head}

      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', marginBottom: '14px' }}>
        <div className="card">
          <div className="n" style={GREEN}>{M(cur.net)}</div>
          <div className="l">{'Take-home ' + curY + ' '}<span className="muted">{'· ' + cur.n + ' mth'}</span></div>
        </div>
        <div className="card">
          <div className="n">{M(cur.gross)}</div>
          <div className="l">{'Gross pay ' + curY}</div>
        </div>
        <div className="card">
          <div className="n" style={GREEN}>{M(allNet)}</div>
          <div className="l">{'Total take-home '}<span className="muted">· all time</span></div>
        </div>
        <div className="card">
          <div className="n">{slips.length}</div>
          <div className="l">{'Payslip' + (slips.length === 1 ? '' : 's') + ' available'}</div>
        </div>
      </div>

      {/* per-year breakdown (only worth showing when the history spans more than one year) — hros.html:3208.
          The golden's fixture is a single year, so this panel is absent from it; `catches a dropped
          per-year panel` in the test covers it against the legacy source instead. */}
      {years.length > 1 ? (
        <div className="panel" style={{ marginBottom: '14px' }}>
          <div className="panel-hd"><h3>Earnings by year</h3></div>
          <div className="tbl-wrap">
            <table className="bigtable">
              <thead><tr><th>Year</th><th className="amt">Gross</th><th className="amt">Deductions</th><th className="amt">Take-home</th></tr></thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y}>
                    <td><b>{y}</b>{' '}<span className="muted">{'· ' + byYear[y].n + ' mth'}</span></td>
                    <td className="amt">{M(byYear[y].gross)}</td>
                    <td className="amt" style={RED}>{M(byYear[y].ded)}</td>
                    <td className="amt"><b style={GREEN}>{M(byYear[y].net)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-hd"><h3>My payslips</h3></div>
        <div className="tbl-wrap">
          <table className="bigtable pay-tbl">
            <thead><tr><th>Period</th><th className="amt">Gross</th><th className="amt">Deductions</th><th className="amt">Net pay</th><th></th></tr></thead>
            <tbody>
              {slips.map((s, i) => (
                <tr key={s.year + '-' + s.month}>
                  <td><b>{HR_MONTHS[s.month] + ' ' + s.year}</b></td>
                  <td className="amt">{M(s.p.gross)}</td>
                  <td className="amt" style={RED}>{M(dedTot(s))}</td>
                  <td className="amt"><b style={GREEN}>{M(s.p.net)}</b></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {/* The index is the identity of the record: `hrEmpPayslipDownload(i)` reads
                        `EPS.data.payslips[i]`, so a row wired to the wrong index downloads someone
                        else's month. R1 cannot see that — the test's handler parity is what does. */}
                    <button className="btn sm" onClick={() => onDownload(i)}><Ic name="download" size={13} />{' PDF'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border-strong)' }}>
                <td><b>{'Total (' + months(slips.length) + ')'}</b></td>
                <td className="amt"><b>{M(allGross)}</b></td>
                <td className="amt" style={RED}><b>{M(allDed)}</b></td>
                <td className="amt"><b style={GREEN}>{M(allNet)}</b></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="muted" style={{ fontSize: '11px', padding: '10px 2px 0' }}>
          {'Totals are your finalised monthly payroll (take-home = net pay after EPF/SOCSO/EIS/PCB & deductions). Tap '}
          <b>PDF</b>{' to download or print any month’s full payslip.'}
        </div>
      </div>
    </>
  );
}
