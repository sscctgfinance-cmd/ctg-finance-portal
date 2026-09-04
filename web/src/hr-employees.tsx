// HR OS · Employees — the React half of the strangler's ninth screen.
//
// The legacy original is `hrEmployees()` at hros.html:2730 (the toolbar, the banner and the panel head),
// `hrEmpResultsHtml()` at :2722 with `hrEmpMatch()` at :2681 and `hrEmpCard()` at :2701 (the directory),
// and `hrEmpForm()` at :2814 (the profile editor), with `hrBankPicker()` at :4545 inside it. All of it is
// STILL THERE and still shipping; nothing was deleted. Both are reachable side by side
// (`hros.html#tab=employees` and `/hr/employees/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. That is what lets
// tests/hr-employees.parity.test.tsx render it with `renderToStaticMarkup` and diff the result against
// tests/golden/hr.employees.html. The loading, the session, the filter state, the save/delete calls and
// the bank-dropdown DOM live in app/hr/employees/page.tsx, on the other side of that line.
//
// ── TWO MODES, ONE ROUTE ───────────────────────────────────────────────────────────────────────────
// `HR.editEmp` is reset to `null` by `hrNav()` (hros.html:1457) and by every reload (:1429, :1454), and
// `hrRender()` (:1541) picks the body from it: `null` → the directory, anything else → the form. There
// is no route change between them, so this component carries both and `editEmp` selects. The golden was
// captured in the DIRECTORY mode (editEmp === null), so the form is NOT covered by the golden — the
// parity test covers it separately against the contract that actually matters for it: the `hr_*` element
// ids `hrSaveEmp()` (hros.html:2886) reads back out of the DOM. A field that silently loses its id there
// saves as blank, which on this screen means a wiped bank account or a wiped IC.
//
// ── IC AND BANK DETAILS ────────────────────────────────────────────────────────────────────────────
// An employee record carries `ic_no`, `bank_account` and `bank_holder`. The legacy DIRECTORY shows none
// of them — `hrEmpCard()` shows `bank_name` only, the human-readable bank, never the account number —
// and the FORM shows all of them, in their own inputs, because that is the screen you edit them on. This
// port reproduces exactly that split and widens nothing; `renders no IC or bank account number in the
// directory` in the parity test is the assertion that keeps it true.

import type { CSSProperties, ReactNode } from 'react';

/** An `hr_bootstrap` employee row, as this screen's two renderers consume it. */
export interface Employee {
  id: string;
  emp_no?: string | null;
  name?: string | null;
  dept?: string | null;
  position?: string | null;
  phone?: string | null;
  email?: string | null;
  employment_type?: string | null;
  status?: string | null;
  resign_date?: string | null;
  basic_salary?: number | null;
  fixed_allowance?: number | null;
  user_id?: string | null;
  ic_no?: string | null;
  bank_code?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  bank_holder?: string | null;
  epf_no?: string | null;
  socso_no?: string | null;
  tax_no?: string | null;
  date_of_birth?: string | null;
  join_date?: string | null;
  epf_ee_rate?: number | string | null;
  epf_er_rate?: number | string | null;
  socso_category?: number | string | null;
  citizen_status?: string | null;
  marital_status?: string | null;
  num_children?: number | null;
  epf_eligible?: boolean;
  socso_eligible?: boolean;
  eis_eligible?: boolean;
  lindung24?: boolean;
  resident?: boolean;
  spouse_working?: boolean;
  ytd_year?: number | string | null;
  ytd_months?: number | string | null;
  ytd_gross?: number | string | null;
  ytd_epf?: number | string | null;
  ytd_pcb?: number | string | null;
  pay_type?: string | null;
  hourly_rate?: number | string | null;
  daily_rate?: number | string | null;
  shift_start?: string | null;
  shift_end?: string | null;
  work_days?: number[] | null;
  reminders_on?: boolean;
}

/** One row of `HR.banks` — hros.html:1454. */
export interface Bank { code: string; name: string; active?: boolean }

/** `HR.empUI` — hros.html:2731. The directory's filter/sort state, defaulted by the route. */
export interface EmpUI { q: string; dept: string; type: string; status: string; sort: string }

export const EMP_UI_DEFAULT: EmpUI = { q: '', dept: '', type: '', status: 'active', sort: 'emp_no' };

export interface HrEmployeesProps {
  /** `HR.data.employees` — hros.html:2732. */
  employees: Employee[];
  /** `HR.banks` — the bank picker's master list. Only read in the form mode. */
  banks?: Bank[];
  /** `hrCompanyName()` — hros.html:4445. Chrome, so it is passed in rather than resolved here. */
  companyName: string;
  /** `HR.empUI`. */
  ui: EmpUI;
  /** `HR.editEmp` — `null` = the directory, `{}` = new employee, a record = edit. */
  editEmp?: Employee | Record<string, never> | null;
  /** `HR_VIEWER` — hros.html:1374. Hides every write control, and the form entirely (:1541). */
  viewer?: boolean;
  onFilter: (key: keyof EmpUI, value: string) => void;
  onReset: () => void;
  onEditEmp: (id: string | 0) => void;
  onDeleteEmp: (id: string) => void;
  onEnableLogin: (id: string) => void;
  onEnableLoginBulk: () => void;
  /** v228: email an existing login its credentials. RESETS the password — the route says so. */
  onSendLogin: (id: string) => void;
  /** v228: hr_send_logins' own `test:true` probe. Touches no passwords. */
  onSendLoginTest: () => void;
  onClose: () => void;
  onSave: () => void;
  onBankInput: (q: string) => void;
  onBankBlur: () => void;
}

/** `M()` — hros.html:1268. */
function M(n: unknown): string {
  return 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** `hrInitials()` — hros.html:1663. */
export function initials(n?: string | null): string {
  const p = String(n || '').trim().split(/\s+/);
  return (((p[0] || '')[0] || '') + ((p.length > 1 ? p[p.length - 1] : '')[0] || '')) || '?';
}

/** `hrAvatarHue()` — hros.html:1664. */
export function avatarHue(n?: string | null): number {
  let h = 0;
  const s = String(n || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/** `hrIsResigned()` — hros.html:2790. Status OR a resign date; either one means gone. */
export function isResigned(x?: Employee | null): boolean {
  const s = String((x && x.status) || '').toLowerCase();
  return s === 'resigned' || s === 'inactive' || s === 'terminated' || s === 'left' || !!(x && x.resign_date);
}

/**
 * `hrEmpMatch()` — hros.html:2681. Filter then sort, same predicates and same comparators.
 * Exported because it is the part of this screen a defect hides in most quietly: a filter that drops a
 * row, or a sort that reorders the directory, both look like ordinary data.
 */
export function matchEmployees(all: Employee[], ui: EmpUI): Employee[] {
  const q = (ui.q || '').trim().toLowerCase();
  const list = all.filter((x) => {
    const gone = isResigned(x);
    if (ui.status === 'active' && gone) return false;
    if (ui.status === 'resigned' && !gone) return false;
    if (ui.dept && String(x.dept || '') !== ui.dept) return false;
    if (ui.type && String(x.employment_type || 'Full-time') !== ui.type) return false;
    if (q) {
      const hay = ((x.name || '') + ' ' + (x.emp_no || '') + ' ' + (x.position || '') + ' ' + (x.dept || '') + ' ' + (x.email || '')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
  list.sort((a, b) => {
    if (ui.sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
    if (ui.sort === 'salary') return (Number(b.basic_salary) || 0) - (Number(a.basic_salary) || 0);
    if (ui.sort === 'dept') return (String(a.dept || '').localeCompare(String(b.dept || ''))) || String(a.emp_no || '').localeCompare(String(b.emp_no || ''));
    return String(a.emp_no || '').localeCompare(String(b.emp_no || ''));
  });
  return list;
}

/**
 * `HR_POSITIONS` + `hrPositionList()` — hros.html:2812-2813. The Position combobox's datalist: the
 * operator's default roster plus every position already on staff, deduped case-insensitively
 * (first-seen casing wins) and sorted.
 */
const HR_POSITIONS = ['Senior Executive', 'Senior Sales Advisor', 'Sales Executive', 'After Sales Service Representative', 'Customer Service', 'Channel Marketer', 'Content Creator', 'Graphic Designer', 'Multi Media Designer'];

export function positionList(employees: Employee[]): string[] {
  const seen: Record<string, number> = {};
  const out: string[] = [];
  const add = (raw?: string | null) => {
    const p = String(raw || '').trim();
    if (!p) return;
    const k = p.toLowerCase();
    if (seen[k]) return;
    seen[k] = 1;
    out.push(p);
  };
  HR_POSITIONS.forEach(add);
  employees.forEach((e) => add(e.position));
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * `ic(name, size)` — hros.html:1241, with the icon paths this screen uses (hros.html:1221, :1234).
 * `ic()` returns the EMPTY STRING for a name it does not know, and `hrEmpCard()` calls `ic('check',12)`
 * — which hros.html's ICONS does not define. So the golden's "login" pill carries a leading space and no
 * svg. Returning null here reproduces that exactly; do not "fix" it by inventing a check icon.
 */
const ICONS: Record<string, ReactNode> = {
  employees: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  search: <><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></>,
};

function Ic({ name, size = 18 }: { name: string; size?: number }) {
  const d = ICONS[name];
  if (!d) return null;
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
  );
}

/** The toolbar control style `SS` — hros.html:2734. Same declarations, same order, so the same string. */
const SS: CSSProperties = {
  padding: '8px 10px',
  background: 'var(--panel-2)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--r-sm)',
  color: 'var(--text)',
  fontSize: '12.5px',
};

/** The form control style — hros.html:2816 (`inp`) and :2819 (`sel`), which share it verbatim. */
const FS: CSSProperties = {
  width: '100%',
  padding: '7px 9px',
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text)',
  fontSize: '12.5px',
};

const GRID3: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' };
const SECTION: CSSProperties = { fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.04em', margin: '2px 0 8px' };

export default function HrEmployees(p: HrEmployeesProps) {
  const { companyName, editEmp, viewer } = p;
  return (
    <>
      {/* The page head is built by hrRender(), not hrEmployees() — hros.html:1537. Shared chrome, and
          report.md §3.5 keeps it re-implemented per world during the transition. Included because it is
          inside the `#hr` element the golden holds. */}
      <div className="page-head">
        <div>
          <div className="page-eyebrow">People</div>
          <h2 className="page-title">Employees</h2>
          <div className="page-sub">Your workforce master — profiles, pay &amp; statutory setup</div>
        </div>
        <div className="page-meta">
          <span className="page-chip"><span className="dot"></span>{companyName}</span>
        </div>
      </div>
      {/* hros.html:1541 — the form only when something is being edited AND the viewer gate is open. */}
      {editEmp != null && !viewer ? <EmpForm {...p} x={editEmp as Employee} /> : <Directory {...p} />}
    </>
  );
}

/** `hrEmployees()` — hros.html:2730. */
function Directory(p: HrEmployeesProps) {
  const { employees: all, ui, viewer } = p;
  const depts = Object.keys(all.reduce<Record<string, number>>((m, x) => { if (x.dept) m[x.dept] = 1; return m; }, {})).sort();
  const act = all.filter((x) => !isResigned(x));
  const noLogin = act.filter((x) => !x.user_id && x.email).length;
  const noEmail = act.filter((x) => !x.email).length;

  const sel = (k: keyof EmpUI, cur: string, opts: ReactNode) => (
    <select value={cur} onChange={(e) => p.onFilter(k, e.target.value)} style={SS}>{opts}</select>
  );

  return (
    <div className="panel">
      <div className="panel-hd">
        <h3>Workforce</h3>
        <div className="page-actions">
          {viewer ? null : (
            <>
              {noLogin ? <button className="btn sm hr-write" onClick={p.onEnableLoginBulk} title="Create HR OS logins for every active employee with an email but no login yet">Enable all logins</button> : null}
              <button className="btn sm" onClick={p.onSendLoginTest} title="Send a test email to your own inbox. Touches no passwords — run it first if delivery is in doubt.">{'\u2709\uFE0F Test email'}</button>
              <button className="btn p sm" onClick={() => p.onEditEmp(0)}>+ Add employee</button>
            </>
          )}
        </div>
      </div>

      {(noLogin || noEmail) ? (
        <div className="muted" style={{ fontSize: '11.5px', marginBottom: '12px', padding: '9px 12px', background: 'var(--surface-3)', borderRadius: 'var(--r-sm)', lineHeight: '1.5' }}>
          <Ic name="employees" size={14} />{' '}<b>{noLogin}</b>{' employee(s) have an email but '}<b>no HR OS login yet</b>{' — they can’t apply leave / claims / clock in until you enable one.'}
          {noEmail ? <>{' ·  '}<b>{noEmail}</b>{' have no email on file — add one first.'}</> : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ position: 'relative', flex: '1', minWidth: '200px' }}>
          <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }}><Ic name="search" size={15} /></span>
          <input id="hr_emp_search" defaultValue={ui.q || ''} onInput={(e) => p.onFilter('q', (e.target as HTMLInputElement).value)} placeholder="Search name, ID, role, department…" style={{ ...SS, width: '100%', paddingLeft: '34px' }} />
        </div>
        {sel('status', ui.status, <>
          <option value="active">Active</option>
          <option value="resigned">Resigned</option>
          <option value="">All statuses</option>
        </>)}
        {sel('dept', ui.dept, <>
          <option value="">All departments</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </>)}
        {sel('type', ui.type, <>
          <option value="">All types</option>
          {['Full-time', 'Part-time', 'Contract', 'Intern', 'Probation'].map((t) => <option key={t} value={t}>{t}</option>)}
        </>)}
        {sel('sort', ui.sort, <>
          <option value="emp_no">Sort: Employee ID</option>
          <option value="name">Sort: Name</option>
          <option value="dept">Sort: Department</option>
          <option value="salary">Sort: Salary (high→low)</option>
        </>)}
      </div>

      <div id="hr_emp_results"><Results {...p} /></div>
    </div>
  );
}

/** `hrEmpResultsHtml()` — hros.html:2722. The one block `hrEmpFilter()` re-renders on its own. */
function Results(p: HrEmployeesProps) {
  const list = matchEmployees(p.employees, p.ui);
  const count = <div className="muted" style={{ fontSize: '11px', marginBottom: '10px' }}>Showing <b>{list.length}</b>{' of ' + p.employees.length + ' employees'}</div>;
  if (!list.length) {
    // `hrEmpty()` — hros.html:1243. NOT covered by the golden (it was captured with three matches);
    // mirrored from the legacy source anyway, because leaving it out would render nothing at all when a
    // filter matches no one, and would leave "Clear filters" wired to nothing.
    return (
      <>
        {count}
        <div className="empty">
          <div className="empty-ico"><Ic name="employees" size={34} /></div>
          <div>No employees match your filters.</div>
          <div style={{ marginTop: '16px' }}><button className="btn sm" onClick={p.onReset}>Clear filters</button></div>
        </div>
      </>
    );
  }
  return <>{count}<div className="emp-list">{list.map((x) => <EmpCard key={x.id} x={x} p={p} />)}</div></>;
}

/** `hrEmpCard()` — hros.html:2701. */
function EmpCard({ x, p }: { x: Employee; p: HrEmployeesProps }) {
  const typeMap: Record<string, string> = { 'Full-time': 'pill-ok', Contract: 'pill-info', 'Part-time': 'pill-warn' };
  const t = x.employment_type || 'Full-time';
  const h = avatarHue(x.name || x.emp_no);
  const gone = isResigned(x);
  const rw = !p.viewer;
  return (
    <div className="emp-card" {...(gone ? { style: { opacity: '.62' } as CSSProperties } : {})}>
      <div className="emp-av" style={{ background: `hsl(${h},42%,26%)`, color: `hsl(${h},72%,78%)` }}>{initials(x.name)}</div>
      <div className="emp-main">
        <div className="emp-name">{x.name || '—'} <span className="emp-no">{x.emp_no || '—'}</span></div>
        <div className="emp-meta">
          {(x.position || '—') + ' · ' + (x.dept || '—') + (x.bank_name ? ' · ' + x.bank_name : '') + (gone && x.resign_date ? ' · left ' + String(x.resign_date).slice(0, 10) : '')}
        </div>
      </div>
      <span className={'pill ' + (typeMap[t] || 'pill-neu')}>{t}</span>
      <div className="emp-sal"><div className="v">{M(x.basic_salary)}</div><div className="l">{'+ ' + M(x.fixed_allowance) + ' allow'}</div></div>
      <span className={'pill ' + (x.status === 'active' ? 'pill-ok' : 'pill-neu')}>{x.status || '—'}</span>
      {gone ? null : (x.user_id
        ? <>
            <span className="pill pill-ok" style={{ fontSize: '9.5px' }} title="Has an HR OS login">{' login'}</span>
            {rw ? <button className="btn xs" onClick={() => p.onSendLogin(x.id)} title={'Email this person their sign-in details. It RESETS their password \u2014 right for someone who has never signed in, destructive for someone already using theirs.'}>{'\u2709\uFE0F Send login'}</button> : null}
          </>
        : (x.email
          ? (rw ? <button className="btn xs" onClick={() => p.onEnableLogin(x.id)} title={'Create an HR OS login so this employee can apply leave, submit claims & clock in'}>Enable login</button> : null)
          : <span className="pill pill-warn" style={{ fontSize: '9.5px' }} title="Add an email on the profile first">no email</span>))}
      {rw ? <button className="btn xs" onClick={() => p.onEditEmp(x.id)}>Edit</button> : null}
      {gone ? <>{' '}<button className="btn xs d" onClick={() => p.onDeleteEmp(x.id)} title="Delete this resigned employee">Delete</button></> : null}
    </div>
  );
}

const ET_OPTS: [string, string][] = [['Full-time', 'Full-time'], ['Part-time', 'Part-time'], ['Contract', 'Contract'], ['Intern', 'Intern'], ['Probation', 'Probation']];
const EPF_RATE_OPTS: [string, string][] = [['', 'Statutory default (11% / 0% if 60+)'], ['0.11', '11%'], ['0.09', '9%'], ['0.08', '8%'], ['0.07', '7%'], ['0.055', '5.5%'], ['0', '0% (exempt)']];
// v183: employers may contribute ABOVE the statutory minimum (directors / senior staff). Blank keeps the
// derived rate: 13% at or below the RM5,000 threshold, 12% above, 4% at 60+, 2% for a non-PR foreigner.
const EPF_ER_RATE_OPTS: [string, string][] = [['', 'Statutory default (13% / 12% / 4% / 2%)'], ['0.13', '13%'], ['0.12', '12%'], ['0.14', '14%'], ['0.15', '15%'], ['0.16', '16%'], ['0.17', '17%'], ['0.18', '18%'], ['0.19', '19%'], ['0.20', '20%'], ['0.04', '4%'], ['0', '0% (exempt)']];
const MS_OPTS: [string, string][] = [['single', 'Single'], ['married', 'Married'], ['divorced', 'Divorced'], ['widowed', 'Widowed']];
const SCAT_OPTS: [string, string][] = [['', 'Auto (Cat 1, or Cat 2 if 60+)'], ['1', 'Category 1 (EE + ER)'], ['2', 'Category 2 (ER only)']];
const DEPT_OPTS: [string, string][] = [['', '— Select team —'], ['Online Team', 'Online Team'], ['Offline Team', 'Offline Team']];
const CITIZEN_OPTS: [string, string][] = [['citizen', 'Malaysian citizen'], ['pr', 'Permanent Resident'], ['non_citizen', 'Non-citizen / foreign worker']];
const PAY_OPTS: [string, string][] = [['monthly', 'Monthly salary'], ['hourly', 'Hourly (part-time)'], ['daily', 'Daily (part-time)']];
const STATUS_OPTS: [string, string][] = [['active', 'Active'], ['resigned', 'Resigned']];
const WEEK: [string, string][] = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['7', 'Sun']];

/** `g(label, el)` — hros.html:2817. */
function G({ lbl, children }: { lbl: ReactNode; children: ReactNode }) {
  return <div><label className="muted" style={{ fontSize: '11px' }}>{lbl}</label>{children}</div>;
}

/**
 * `inp(k, ph, val, extra)` — hros.html:2816. UNCONTROLLED on purpose: `hrSaveEmp()` (hros.html:2886)
 * reads every field back out of the DOM by `hr_<k>`, so the value is the initial value and the id is the
 * contract. `defaultValue` is what makes React emit the same `value="…"` attribute for that.
 */
function Inp({ k, ph, val, ...rest }: { k: string; ph: string; val: unknown } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <input id={'hr_' + k} placeholder={ph} defaultValue={val == null ? '' : String(val)} {...rest} style={FS} />;
}

/** `ck(k, lbl, on)` — hros.html:2818. */
function Ck({ k, lbl, on }: { k: string; lbl: string; on: boolean }) {
  return <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><input type="checkbox" id={'hr_' + k} defaultChecked={on} style={{ accentColor: 'var(--coral)' }} />{' ' + lbl}</label>;
}

/** `sel(k, opts, val)` — hros.html:2819. */
function Sel({ k, opts, val }: { k: string; opts: [string, string][]; val: unknown }) {
  return (
    <select id={'hr_' + k} defaultValue={String(val == null ? '' : val)} style={FS}>
      {opts.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
    </select>
  );
}

/**
 * `hrBankPicker(x)` — hros.html:4545. The visible input shows the bank NAME; the hidden `hr_bankCode`
 * carries what is actually saved, and `hr_bankOrig` is what `hrSaveEmp()` compares typed text against so
 * a half-typed bank cannot be saved as a real one. The dropdown itself is filled by the route
 * (`hrBankFilter()`, hros.html:4558) — it writes into `#hr_bankList`, which is why that div is empty and
 * display:none here, exactly as the legacy renderer leaves it.
 */
function BankPicker({ x, banks, onBankInput, onBankBlur }: { x: Employee; banks: Bank[]; onBankInput: (q: string) => void; onBankBlur: () => void }) {
  const sorted = banks.filter((b) => b.active).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  let cur = x.bank_code ? sorted.find((b) => b.code === x.bank_code) : undefined;
  if (!cur && x.bank_name) {
    const nm = String(x.bank_name).toLowerCase();
    cur = sorted.find((b) => String(b.name).toLowerCase() === nm);
  }
  const dispName = cur ? cur.name : (x.bank_name || '');
  const codeVal = cur ? cur.code : '';
  return (
    <div style={{ position: 'relative' }}>
      <input id="hr_bankName" autoComplete="off" placeholder="Type to search bank…" defaultValue={dispName}
        onInput={(e) => onBankInput((e.target as HTMLInputElement).value)}
        onFocus={(e) => onBankInput((e.target as HTMLInputElement).value)}
        onBlur={onBankBlur} style={FS} />
      <input type="hidden" id="hr_bankCode" defaultValue={codeVal} />
      <input type="hidden" id="hr_bankOrig" defaultValue={dispName} />
      <div id="hr_bankList" style={{ display: 'none', position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 60, marginTop: '2px', maxHeight: '250px', overflow: 'auto', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: '0 10px 30px rgba(0,0,0,.45)' }}></div>
    </div>
  );
}

/**
 * `hrEmpForm()` — hros.html:2814. NOT covered by tests/golden/hr.employees.html: the golden was captured
 * with `HR.editEmp === null`, so it holds the directory only. It is mirrored from the legacy source
 * field for field anyway — leaving it out would wire "+ Add employee" and every "Edit" button to
 * nothing — and tests/hr-employees.parity.test.tsx checks it against the contract a golden could not
 * express for it: the `hr_*` ids `hrSaveEmp()` reads back.
 */
function EmpForm(p: HrEmployeesProps & { x: Employee }) {
  const { x } = p;
  const dob = x.date_of_birth ? String(x.date_of_birth).slice(0, 10) : '';
  const joinDate = x.join_date ? String(x.join_date).slice(0, 10) : '';
  const wdArr = Array.isArray(x.work_days) ? x.work_days.map(Number) : [];
  const NBSP = ' ';
  return (
    <div className="panel" style={{ maxWidth: '900px' }}>
      <div className="panel-hd"><h3>{(x.id ? 'Edit' : 'New') + ' employee'}</h3><button className="btn sm" onClick={p.onClose}>✕ Close</button></div>

      <div className="muted" style={SECTION}>Personal &amp; pay</div>
      <div style={{ ...GRID3, marginBottom: '14px' }}>
        <G lbl="Name *"><Inp k="name" ph="Full name" val={x.name} /></G>
        <G lbl="IC / Passport"><Inp k="ic" ph="" val={x.ic_no} /></G>
        <G lbl="Email"><Inp k="email" ph="" val={x.email} /></G>
        <G lbl="Department"><Sel k="dept" opts={DEPT_OPTS} val={(x.dept === 'Online Team' || x.dept === 'Offline Team') ? x.dept : ''} /></G>
        <G lbl="Position / role">
          <Inp k="position" ph="Select or type…" val={x.position} list="hr_pos_dl" />
          <datalist id="hr_pos_dl">{positionList(p.employees).map((q) => <option key={q} value={q}></option>)}</datalist>
        </G>
        <G lbl="Employment type"><Sel k="empType" opts={ET_OPTS} val={x.employment_type || 'Full-time'} /></G>
        <G lbl="Phone"><Inp k="phone" ph="" val={x.phone} /></G>
        <G lbl="Basic salary (RM) *"><Inp k="basic" ph="0" val={x.basic_salary} type="number" step="0.01" /></G>
        <G lbl="Fixed allowance (RM)"><Inp k="allowance" ph="0" val={x.fixed_allowance} type="number" step="0.01" /></G>
        <G lbl="Date of birth"><Inp k="dob" ph="" val={dob} type="date" /></G>
        <G lbl="Join date"><Inp k="joinDate" ph="" val={joinDate} type="date" /></G>
        <G lbl="Bank name *"><BankPicker x={x} banks={p.banks || []} onBankInput={p.onBankInput} onBankBlur={p.onBankBlur} /></G>
        <G lbl="Bank account no. *"><Inp k="bankAccount" ph="digits only" val={x.bank_account} inputMode="numeric" maxLength={20} onInput={(e) => { const el = e.currentTarget; el.value = el.value.replace(/[^0-9]/g, '').slice(0, 20); }} /></G>
        <G lbl="Account holder name *"><Inp k="bankHolder" ph="As per bank statement" val={x.bank_holder != null ? x.bank_holder : (x.name || '')} /></G>
        <G lbl="EPF no."><Inp k="epfNo" ph="" val={x.epf_no} /></G>
        <G lbl="SOCSO no."><Inp k="socsoNo" ph="" val={x.socso_no} /></G>
        <G lbl="Tax no. (TIN)"><Inp k="taxNo" ph="" val={x.tax_no} /></G>
        <G lbl="Status"><Sel k="status" opts={STATUS_OPTS} val={String(x.status || '').toLowerCase() === 'resigned' ? 'resigned' : 'active'} /></G>
        <G lbl="Resign date"><Inp k="resignDate" ph="" val={x.resign_date ? String(x.resign_date).slice(0, 10) : ''} type="date" /></G>
        <G lbl={NBSP}><div></div></G>
      </div>

      <div className="muted" style={SECTION}>Statutory &amp; tax</div>
      <div style={{ ...GRID3, marginBottom: '10px' }}>
        <G lbl="EPF employee rate"><Sel k="epfEeRate" opts={EPF_RATE_OPTS} val={x.epf_ee_rate == null ? '' : x.epf_ee_rate} /></G>
        <G lbl={<>EPF employer rate <span style={{ opacity: '.7' }}>(above-statutory)</span></>}><Sel k="epfErRate" opts={EPF_ER_RATE_OPTS} val={x.epf_er_rate == null ? '' : x.epf_er_rate} /></G>
        <G lbl="SOCSO category"><Sel k="socsoCategory" opts={SCAT_OPTS} val={x.socso_category == null ? '' : x.socso_category} /></G>
        <G lbl={<>Citizenship (EPF &amp; EIS)</>}><Sel k="citizenStatus" opts={CITIZEN_OPTS} val={x.citizen_status || 'citizen'} /></G>
        <G lbl="Marital status (for PCB)"><Sel k="maritalStatus" opts={MS_OPTS} val={x.marital_status || 'single'} /></G>
        <G lbl="Number of children"><Inp k="numChildren" ph="0" val={x.num_children == null ? 0 : x.num_children} type="number" step="1" min="0" /></G>
        <G lbl={NBSP}><div></div></G>
      </div>

      <div className="muted" style={{ fontSize: '11px', margin: '-6px 0 10px', lineHeight: '1.6' }}><b>Citizenship</b>{' sets the EPF rate and EIS cover: a non-citizen contributes '}<b>2% + 2%</b>{' (mandatory since 1 Oct 2025) and is '}<b>outside EIS</b>{'; a Permanent Resident is treated as Malaysian. SOCSO is the same either way. This is separate from '}<b>Resident</b>{' below, which is '}<i>tax</i>{' residency for PCB.'}</div>

      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginBottom: '14px', fontSize: '12.5px' }}>
        <Ck k="epf" lbl="EPF" on={x.epf_eligible !== false} />
        <Ck k="socso" lbl="SOCSO" on={x.socso_eligible !== false} />
        <Ck k="eis" lbl="EIS" on={x.eis_eligible !== false} />
        <Ck k="lindung24" lbl="LINDUNG 24 Jam" on={x.lindung24 !== false} />
        <Ck k="resident" lbl="Tax resident" on={x.resident !== false} />
        <Ck k="spouseWorking" lbl="Spouse working" on={!!x.spouse_working} />
      </div>

      {/* v156: mid-year go-live opening balances — income/EPF/PCB already paid THIS tax year before HR OS.
          Leave blank/0 for a full-year employee. */}
      <details style={{ margin: '0 0 14px' }}>
        <summary style={{ cursor: 'pointer', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)' }}>PCB opening balances (only if joined mid-year on another payroll)</summary>
        <div className="muted" style={{ fontSize: '11px', margin: '6px 0 8px' }}>If this employee was already paid earlier THIS tax year on a previous system, enter the totals so PCB trues-up correctly. Full-year employees: leave blank.</div>
        <div style={GRID3}>
          <G lbl="Tax year"><Inp k="ytdYear" ph="e.g. 2026" val={x.ytd_year == null ? '' : x.ytd_year} type="number" step="1" min="2020" /></G>
          <G lbl="Months already paid"><Inp k="ytdMonths" ph="0" val={x.ytd_months == null ? '' : x.ytd_months} type="number" step="1" min="0" max="12" /></G>
          <G lbl={NBSP}><div></div></G>
          <G lbl="YTD gross (RM)"><Inp k="ytdGross" ph="0.00" val={x.ytd_gross == null ? '' : x.ytd_gross} type="number" step="0.01" min="0" /></G>
          <G lbl="YTD EPF employee (RM)"><Inp k="ytdEpf" ph="0.00" val={x.ytd_epf == null ? '' : x.ytd_epf} type="number" step="0.01" min="0" /></G>
          <G lbl="YTD PCB paid (RM)"><Inp k="ytdPcb" ph="0.00" val={x.ytd_pcb == null ? '' : x.ytd_pcb} type="number" step="0.01" min="0" /></G>
        </div>
      </details>

      <div className="muted" style={{ fontSize: '11px', marginBottom: '12px' }}>EPF/SOCSO/EIS rates follow the Malaysian statutory tables. Age 60+ auto-switches to the senior EPF rate, SOCSO Category 2 and no EIS. PCB uses marital status + children + EPF relief; it is an estimate — verify against the LHDN MTD schedule before filing.</div>

      <div className="muted" style={SECTION}>Pay basis &amp; time clock</div>
      <div style={{ ...GRID3, marginBottom: '10px' }}>
        <G lbl="Pay basis"><Sel k="payType" opts={PAY_OPTS} val={x.pay_type || 'monthly'} /></G>
        <G lbl="Hourly rate (RM/hr)"><Inp k="hourlyRate" ph="0.00" val={x.hourly_rate} type="number" step="0.01" min="0" /></G>
        <G lbl="Daily rate (RM/day)"><Inp k="dailyRate" ph="0.00" val={x.daily_rate} type="number" step="0.01" min="0" /></G>
        <G lbl="Shift start (for reminder)"><Inp k="shiftStart" ph="" val={x.shift_start ? String(x.shift_start).slice(0, 5) : ''} type="time" /></G>
        <G lbl="Shift end"><Inp k="shiftEnd" ph="" val={x.shift_end ? String(x.shift_end).slice(0, 5) : ''} type="time" /></G>
        <G lbl={NBSP}><div></div></G>
      </div>

      <div style={{ marginBottom: '8px' }}>
        <label className="muted" style={{ fontSize: '11px', display: 'block', marginBottom: '5px' }}>Work days (for the reminder)</label>
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
          {WEEK.map((d) => (
            <label key={d[0]} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
              <input type="checkbox" id={'hr_wd' + d[0]} defaultChecked={wdArr.indexOf(Number(d[0])) >= 0} style={{ accentColor: 'var(--coral)' }} />{' ' + d[1]}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginBottom: '10px', fontSize: '12.5px' }}>
        <Ck k="clockReminder" lbl="🔔 Email a reminder to clock in at the shift start time" on={x.reminders_on !== false} />
      </div>

      <div className="muted" style={{ fontSize: '11px', marginBottom: '12px' }}>{'Hourly/Daily = part-timer: payroll auto-fills their Basic from clocked hours × rate that month. The clock-in reminder emails them at '}<b>Shift start</b>{' on the ticked '}<b>Work days</b>{', only if they haven’t clocked in yet. One email per day. (v224: the phone push that used to accompany it is retired.)'}</div>

      <button className="btn p sm" onClick={p.onSave}>{x.id ? 'Save changes' : 'Add employee'}</button>
    </div>
  );
}
