'use client';

// The route. Everything impure lives here — the session, the fetches, the filter/edit state, the
// confirms, and the two places the legacy screen reads the DOM back by id — so that
// src/hr-employees.tsx stays a pure function of its props and can be diffed against the legacy golden.
// Same split as the pilot: see app/hr/access/page.tsx.

import { useCallback, useEffect, useRef, useState } from 'react';

import { showConfirm } from '../../../src/confirm';
import HrEmployees, { EMP_UI_DEFAULT, credsText, type Bank, type Cred, type CredSkip, type EmpUI, type Employee } from '../../../src/hr-employees';
import { call, legacyUrl, token } from '../../../src/portal';
import FailedLoad from '../../../src/failed-load';
import { toast } from '../../../src/toast';

/** hros.html:1410 — the fallback company when the account has no Xero orgs. */
const PROCARE = 'I PROCARE MALAYSIA SDN BHD';
const HR_PROCARE_TENANT = '99911869-9e91-4572-b7dc-4db51b45b6a9';

interface Company { tenant_id: string; tenant_name: string }

export default function HrEmployeesPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [ui, setUi] = useState<EmpUI>(EMP_UI_DEFAULT);
  const [editEmp, setEditEmp] = useState<Employee | Record<string, never> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ rows: Cred[]; skipped: CredSkip[] } | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async (tenant?: string | null) => {
    setErr(null);
    try {
      const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
      const co = await call<{ companies?: Company[] }>({ api: 'hr_companies' }).catch(() => ({ companies: [] }));
      const list = (co.companies || []).length ? co.companies! : [{ tenant_id: HR_PROCARE_TENANT, tenant_name: PROCARE }];
      const pick = list.find((c) => c.tenant_id === (tenant || saved))
        || list.find((c) => c.tenant_name === PROCARE)
        || list[0];
      setCompany(pick);
      const r = await call<{ employees?: Employee[]; banks?: Bank[] }>({ api: 'hr_bootstrap', tenant: pick.tenant_id });
      setEmployees(r.employees || []);
      setBanks(r.banks || []);
      // hros.html:1454 — a reload always drops back to the directory. Keeping a stale `editEmp` across a
      // reload would leave the form showing the record as it was BEFORE the save.
      setEditEmp(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (t) void load();
  }, [load]);

  /** `v()` / `chk()` — hros.html:2887. Scoped to this screen's subtree, not `document`. */
  const v = (id: string) => root.current?.querySelector<HTMLInputElement>('#hr_' + id)?.value ?? '';
  const chk = (id: string) => !!root.current?.querySelector<HTMLInputElement>('#hr_' + id)?.checked;

  /** `hrEditEmp()` — hros.html:2789. `0` is the sentinel for a blank record. */
  const onEditEmp = useCallback((id: string | 0) => {
    setNotice(null);
    setEditEmp(id ? ((employees || []).find((x) => x.id === id) || {}) : {});
  }, [employees]);

  /** `hrSaveEmp()` — hros.html:2886. Same required checks, same payload, same follow-up shift save. */
  const onSave = useCallback(() => {
    const name = v('name').trim();
    if (!name) { setErr('Name is required'); return; }
    const bankCode = v('bankCode'), bankName = v('bankName').trim(), bankOrig = v('bankOrig');
    if (!bankCode) {
      if (!bankName) { setErr('Bank name is required — pick a bank from the list'); return; }
      if (bankName !== bankOrig) { setErr('Please pick a bank from the dropdown list'); return; }
    }
    const holder = v('bankHolder').trim();
    if (!holder) { setErr('Account holder name is required'); return; }
    const acct = String(v('bankAccount') || '').replace(/[^0-9]/g, '').slice(0, 20);
    if (!acct) { setErr('Bank account number is required (digits only)'); return; }
    const emp = {
      id: (editEmp && (editEmp as Employee).id) || undefined, name, ic: v('ic'), email: v('email'), dept: v('dept'),
      position: v('position'), phone: v('phone'), employmentType: v('empType') || 'Full-time',
      basic: v('basic'), allowance: v('allowance'), bankCode, bankName, bankHolder: holder, bankAccount: acct,
      epfNo: v('epfNo'), socsoNo: v('socsoNo'), taxNo: v('taxNo'), dob: v('dob') || null, joinDate: v('joinDate') || null,
      epfEeRate: v('epfEeRate'), epfErRate: v('epfErRate'), socsoCategory: v('socsoCategory'),
      maritalStatus: v('maritalStatus'), numChildren: v('numChildren'),
      ytdYear: v('ytdYear'), ytdMonths: v('ytdMonths'), ytdGross: v('ytdGross'), ytdEpf: v('ytdEpf'), ytdPcb: v('ytdPcb'),
      payType: v('payType') || 'monthly', hourlyRate: v('hourlyRate'), dailyRate: v('dailyRate'),
      shiftStart: v('shiftStart') || null, shiftEnd: v('shiftEnd') || null, clockReminder: chk('clockReminder'),
      status: v('status') || 'active', resignDate: v('resignDate') || null,
      epf: chk('epf'), socso: chk('socso'), eis: chk('eis'), lindung24: chk('lindung24'),
      resident: chk('resident'), spouseWorking: chk('spouseWorking'),
      citizenStatus: v('citizenStatus') || 'citizen',
    };
    const shiftStart = v('shiftStart') || null;
    const wdays = [1, 2, 3, 4, 5, 6, 7].filter((n) => !!root.current?.querySelector<HTMLInputElement>('#hr_wd' + n)?.checked);
    const reminders = chk('clockReminder');
    void (async () => {
      try {
        const r = await call<{ id?: string; employee_id?: string }>({ api: 'hr_emp_save', emp, tenant: company?.tenant_id });
        const eid = r.id || r.employee_id || (editEmp && (editEmp as Employee).id);
        if (eid) {
          await call({ api: 'hr_shift_save', tenant: company?.tenant_id, employee_id: eid, shift_start: shiftStart, work_days: wdays, reminders_on: reminders });
        }
        setNotice('Employee saved ✓');
        await load(company?.tenant_id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [company, editEmp, load]);

  /** `hrEmpDelete()` — hros.html:2792. Resigned-only, then confirmed, then confirmed again for payslips. */
  const onDeleteEmp = useCallback((id: string) => {
    const e = (employees || []).find((x) => x.id === id) || {} as Employee;
    void (async () => {
      if (!await showConfirm('Delete employee',
        `Delete ${e.name || 'this employee'} permanently?\n\nRemoves their profile plus leave / claim / attendance records. This cannot be undone.`, 'Delete')) return;
      try {
        const r = await call<{ payslips?: number; needs_confirm?: boolean; error?: string }>({ api: 'hr_emp_delete', id, tenant: company?.tenant_id });
        if (r.needs_confirm) {
          if (!await showConfirm('Delete payroll history too',
            `⚠️ ${r.error || ''}\n\nDelete anyway and permanently erase ${r.payslips} payslip record(s)? Payroll history / EA source data will be lost.`, 'Delete anyway')) return;
          await call({ api: 'hr_emp_delete', id, tenant: company?.tenant_id, force: true });
          setNotice('Employee + payroll history deleted');
        } else {
          setNotice('Employee deleted' + (r.payslips ? ` (+ ${r.payslips} payslip records)` : ''));
        }
        await load(company?.tenant_id);
      } catch (er) {
        setErr(er instanceof Error ? er.message : String(er));
      }
    })();
  }, [company, employees, load]);

  /** `hrEnableLogin()` — hros.html:2751. */
  const onEnableLogin = useCallback((id: string) => {
    const e = (employees || []).find((x) => x.id === id) || {} as Employee;
    if (!e.email) { setErr('Add an email on this employee first'); return; }
    void (async () => {
      if (!await showConfirm('Create HR OS login',
        `Create an HR OS login for ${e.name || 'this employee'} (${e.email})?\n\nThey’ll use it to apply leave, submit claims & clock in. You’ll get a one-time temporary password to share with them.`, 'Create', 'p')) return;
      try {
        const r = await call<{ already?: boolean; name?: string; email?: string; temp_password?: string }>({ api: 'hr_rc_enable_login', employee_id: id });
        if (r.already) setNotice(`${e.name || 'Employee'} already has a login`);
        else setCreds({ rows: [{ name: r.name || e.name || '', email: r.email, temp_password: r.temp_password }], skipped: [] });
        await load(company?.tenant_id);
      } catch (er) {
        setErr(er instanceof Error ? er.message : String(er));
      }
    })();
  }, [company, employees, load]);

  /** `hrEnableLoginBulk()` — hros.html:2762. */
  const onEnableLoginBulk = useCallback(() => {
    void (async () => {
      if (!await showConfirm('Create HR OS logins in bulk',
        'Create HR OS logins for ALL active employees who have an email but no login yet?\n\nEmployees without an email are skipped. You’ll get a list of one-time temporary passwords to share.', 'Create logins', 'p')) return;
      try {
        const r = await call<{ created?: Cred[]; skipped?: CredSkip[] }>({ api: 'hr_rc_enable_login_bulk', tenant: company?.tenant_id });
        if (!(r.created && r.created.length)) setNotice('No new logins created' + (r.skipped?.length ? ` · ${r.skipped.length} skipped` : ''));
        // The skipped list travels WITH the created one — hros.html:2778 passes both. Dropping it means
        // 5 of 40 staff quietly have no login and nothing on screen says which five.
        else setCreds({ rows: r.created, skipped: r.skipped || [] });
        await load(company?.tenant_id);
      } catch (er) {
        setErr(er instanceof Error ? er.message : String(er));
      }
    })();
  }, [company, load]);

  /**
   * `hrBankFilter()` — hros.html:4558. The one bit of imperative DOM this screen keeps: the picker's
   * dropdown is written into `#hr_bankList` and its rows set `#hr_bankCode`, which is the value
   * `hrSaveEmp()` actually saves. Kept out of the component because the component is the golden-diffed
   * half and the legacy renderer leaves that div empty too.
   */
  const onBankInput = useCallback((q: string) => {
    const box = root.current?.querySelector<HTMLDivElement>('#hr_bankList');
    if (!box) return;
    const sorted = banks.filter((b) => b.active).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const codeEl = root.current?.querySelector<HTMLInputElement>('#hr_bankCode');
    if (codeEl) {
      const exact = sorted.find((b) => String(b.name).toLowerCase() === String(q || '').toLowerCase());
      codeEl.value = exact ? exact.code : '';
    }
    const s = String(q || '').toLowerCase().trim();
    const list = sorted.filter((b) => !s || String(b.name).toLowerCase().indexOf(s) >= 0 || String(b.code).toLowerCase().indexOf(s) >= 0);
    box.replaceChildren();
    if (!list.length) {
      const d = document.createElement('div');
      d.style.cssText = 'padding:8px 10px;font-size:12px;color:var(--muted)';
      d.textContent = 'No matching bank';
      box.appendChild(d);
    } else {
      for (const b of list.slice(0, 80)) {
        const d = document.createElement('div');
        d.style.cssText = 'padding:7px 10px;font-size:12.5px;cursor:pointer;border-bottom:1px solid var(--border)';
        d.textContent = b.name;
        // textContent + a listener, not innerHTML with the code interpolated — a bank name is server data.
        d.addEventListener('mousedown', () => {
          const ni = root.current?.querySelector<HTMLInputElement>('#hr_bankName');
          const oi = root.current?.querySelector<HTMLInputElement>('#hr_bankOrig');
          if (ni) ni.value = b.name;
          if (oi) oi.value = b.name;
          if (codeEl) codeEl.value = b.code;
          box.style.display = 'none';
        });
        box.appendChild(d);
      }
    }
    box.style.display = 'block';
  }, [banks]);

  /** `hrBankBlur()` — hros.html:4570. Delayed so a click on a row lands first. */
  const onBankBlur = useCallback(() => {
    setTimeout(() => {
      const box = root.current?.querySelector<HTMLDivElement>('#hr_bankList');
      if (box) box.style.display = 'none';
    }, 150);
  }, []);

  return (
    <div ref={root}>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <FailedLoad message={err} />
        : !employees || !company ? <Panel><span className="spin"></span> Loading employees…</Panel>
        : (
          <>
            {notice ? <Panel>{notice}</Panel> : null}
            {creds ? <Creds rows={creds.rows} skipped={creds.skipped} onClose={() => setCreds(null)} /> : null}
            <HrEmployees
              employees={employees}
              banks={banks}
              companyName={company.tenant_name}
              ui={ui}
              editEmp={editEmp}
              onFilter={(k, value) => setUi((u) => ({ ...u, [k]: value }))}
              onReset={() => setUi(EMP_UI_DEFAULT)}
              onEditEmp={onEditEmp}
              onDeleteEmp={onDeleteEmp}
              onEnableLogin={onEnableLogin}
              onEnableLoginBulk={onEnableLoginBulk}
              onClose={() => setEditEmp(null)}
              onSave={onSave}
              onBankInput={onBankInput}
              onBankBlur={onBankBlur}
            />
          </>
        )}
    </div>
  );
}

/**
 * `hrShowCreds()` — hros.html:2773, as a panel rather than the legacy's `document.body`-appended modal:
 * the modal belongs to the app shell, and the shell is still the legacy one (report.md §3.5). Same
 * exposure as the legacy — the passwords are shown once, on this screen, to the admin who asked for
 * them — and nothing else about the employee record is added to it.
 */
function Creds({ rows, skipped, onClose }: { rows: Cred[]; skipped: CredSkip[]; onClose: () => void }) {
  // `SITE_URL+'/hros.html'` — hros.html:2783. There is no SITE_URL on this side, and the whole point of
  // one origin is that this page's own is the right one.
  const url = (typeof location === 'undefined' ? '' : location.origin) + legacyUrl('hros.html');
  const onCopy = () => {
    void navigator.clipboard.writeText(credsText(url, rows))
      .then(() => toast('Copied ✓'))
      .catch(() => toast('Copy failed — select manually', true));
  };
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="panel-hd">
        <h3>🔑 HR OS logins created ({rows.length})</h3>
        <button className="btn sm" onClick={onClose}>✕</button>
      </div>
      <div className="muted" style={{ fontSize: '12px', padding: '0 14px 10px', lineHeight: 1.5 }}>
        Give each person their <b>email + temporary password</b>. They sign in at <b>{url}</b> and should
        change the password after. <b style={{ color: 'var(--coral-soft)' }}>Passwords are shown only once — copy or print now.</b>
      </div>
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead><tr><th>Name</th><th>Email (login)</th><th>Temp password</th></tr></thead>
          <tbody>{rows.map((c, i) => (
            <tr key={i}><td>{c.name || ''}</td><td>{c.email || ''}</td><td style={{ fontFamily: 'monospace' }}><b>{c.temp_password || ''}</b></td></tr>
          ))}</tbody>
        </table>
      </div>
      {skipped.length ? (
        <div className="muted" style={{ fontSize: '11px', padding: '8px 14px 0' }}>
          Skipped ({skipped.length}): {skipped.map((sk) => `${sk.name || ''} — ${sk.reason || ''}`).join('; ')}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: '8px', padding: '12px 14px 14px' }}>
        <button className="btn p sm" onClick={onCopy}>📋 Copy all</button>
        <button className="btn sm" onClick={() => window.print()}>🖨 Print</button>
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel"><div className="muted" style={{ padding: '18px' }}>{children}</div></div>;
}

function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('hros.html')}#tab=employees`}>hros.html · Employees</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
