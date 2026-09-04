'use client';

// The route. Everything impure lives here — the session, the fetches, the month state, the modal, the
// CSV download — so that src/hr-attendance.tsx stays a pure function of its props and can be diffed
// against the legacy golden. Same split as the pilot:
//
//   app/<area>/<screen>/page.tsx   'use client', loads, holds state, wires handlers   — not golden-tested
//   src/<screen>.tsx              pure, props in / markup out                         — golden-tested

import { useCallback, useEffect, useState } from 'react';

import { hrCsv } from '../../../../hr-docs.js';
import { showConfirm } from '../../../src/confirm';
import HrAttendance, { type AttendanceList, type AttEmployee, type AttPunch } from '../../../src/hr-attendance';
import { mytFromDtLocal, mytISO } from '../../../../myt.js';
import { call, legacyUrl, token } from '../../../src/portal';
import FailedLoad from '../../../src/failed-load';

/** hros.html:1410 — the fallback company when the account has no Xero orgs. */
const PROCARE = 'I PROCARE MALAYSIA SDN BHD';

interface Company { tenant_id: string; tenant_name: string }

/**
 * `todayLocalISO().slice(0,7)` — hros.html:3040, :1271, which v224 made MALAYSIAN.
 *
 * Which month of attendance an admin opens on. It was the MACHINE's zone: on the 1st, an admin west of
 * Greenwich opened LAST month's timesheet and saw an empty screen for a company that had been clocking
 * in all morning.
 */
const thisMonth = (): string => mytISO(Date.now()).slice(0, 7);

/** `hrNeedsClock()` — hros.html:1503. Who the punch editor may be pointed at. */
function needsClock(e: { employment_type?: string | null; pay_type?: string | null }): boolean {
  return e.employment_type === 'Part-time' || e.pay_type === 'hourly' || e.pay_type === 'daily';
}

/*
 * The local `toCsv` that used to sit here was a character-for-character retype of `hrCsv`
 * (hr-docs.js:108). Its comment recorded, correctly, that the legacy `hrAttExport()` called `hrCsv`
 * per CELL — `r.map(hrCsv)`, where `hrCsv` opens with `arr.map(...)` — so it threw
 * `arr.map is not a function` on the first string and the legacy "⬇ CSV" button had NEVER produced a
 * file. It then said "hros.html is untouched — see the PR", and that PR never landed: the legacy app
 * is the one staff use, so the operator kept clicking a dead button while this note sat in a file
 * nobody opens. hros.html:3173 is fixed now, so the fork has nothing left to work around and
 * `hrCsv` is imported — the quoting rule is bytes that leave the building, and CLAUDE.md's rule for
 * those is import, never retype.
 */
export default function HrAttendancePage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<AttendanceList | null>(null);
  const [employees, setEmployees] = useState<AttEmployee[]>([]);
  const [editRow, setEditRow] = useState<AttPunch | Record<string, never> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const load = useCallback(async (mo: string) => {
    setErr(null);
    setData(null);
    try {
      // The selected company is `localStorage['hr_tenant']` (hros.html:1412) — same origin, so it is
      // already there, exactly like the token.
      const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
      const co = await call<{ companies?: Company[] }>({ api: 'hr_companies' });
      const list = co.companies || [];
      const pick = list.find((c) => c.tenant_id === saved) || list.find((c) => c.tenant_name === PROCARE) || list[0] || null;
      setCompany(pick);
      const tenant = pick ? pick.tenant_id : null;
      setData(await call<AttendanceList>({ api: 'attendance_list', tenant, month: mo }));
      // The modal's picker is `HR.data.employees` (hros.html:3066), which the legacy app already has
      // from its bootstrap. This screen loads on its own, so it asks for the same payload.
      const boot = await call<{ employees?: (AttEmployee & { employment_type?: string; pay_type?: string; status?: string })[] }>(
        { api: 'hr_bootstrap', tenant });
      setEmployees((boot.employees || []).filter(needsClock));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (t) void load(month);
  }, [load, month]);

  const onEdit = useCallback((id: string) => {
    setEditRow((data?.punches || []).find((p) => p.id === id) || {});
  }, [data]);

  const onSave = useCallback(async () => {
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value || '';
    const emp = v('att_emp');
    if (!emp) { setErr('Select an employee'); return; }
    const ci = v('att_in');
    if (!ci) { setErr('Clock-in time is required'); return; }
    const co = v('att_out');
    try {
      await call({
        api: 'attendance_save',
        punch: {
          id: (editRow as AttPunch | null)?.id || undefined,
          employee_id: emp,
          // v224: the box carries MALAYSIAN wall time (`dtLocal` → `mytDtLocal`), so it is read back as
          // Malaysian. `new Date(value)` here would read it in the browser's zone — the exact pairing
          // failure that moved a punch by the viewer's offset. hros.html:3085 does the same.
          clock_in: (mytFromDtLocal(ci) ?? new Date(ci)).toISOString(),
          clock_out: co ? (mytFromDtLocal(co) ?? new Date(co)).toISOString() : null,
          break_minutes: Number(v('att_break')) || 0,
          note: v('att_note') || null,
        },
      });
      setEditRow(null);
      setNotice('Saved ✓');
      await load(month);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [editRow, load, month]);

  const onDelete = useCallback(async (id: string) => {
    // hros.html:3090 keeps the confirm. A punch is what someone is paid from; deleting one silently
    // is not a thing to improve away.
    if (!await showConfirm('Delete punch record', 'Delete this punch record?', 'Delete')) return;
    try {
      await call({ api: 'attendance_delete', id });
      setNotice('Deleted');
      await load(month);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [load, month]);

  const onExport = useCallback(() => {
    const punches = data?.punches || [];
    if (!punches.length) { setErr('Nothing to export'); return; }
    const rows: (string | number)[][] = [['Date', 'Employee', 'Emp No', 'Clock In', 'Clock Out', 'Hours', 'Break (min)', 'Source', 'Status', 'Note']];
    punches.forEach((p) => {
      const e = p.hr_employees || {};
      rows.push([p.work_date || '', e.name || '', e.emp_no || '', p.clock_in || '', p.clock_out || '',
        p.hours != null ? Number(p.hours).toFixed(2) : '', p.break_minutes || 0, p.source || '',
        (p as { status?: string }).status || '', p.note || '']);
    });
    // Append before clicking and defer the revoke, as hros.html's hrDownload() (hros.html:4606) does.
    // A detached anchor does not start a download in every browser, and revoking in the same tick can
    // invalidate the blob before it has been fetched — while setNotice('CSV exported') below fires
    // either way, so that failure looks exactly like success.
    const url = URL.createObjectURL(new Blob([hrCsv(rows)], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Attendance_' + month + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setNotice('CSV exported');
  }, [data, month]);

  return (
    <>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <FailedLoad message={err} />
        : !company && !data ? <Panel><span className="spin"></span> Loading attendance…</Panel>
        : (
          <>
            {notice ? <Panel>{notice}</Panel> : null}
            <HrAttendance
              data={data}
              companyName={company ? company.tenant_name : ''}
              month={month}
              editRow={editRow}
              employees={employees}
              onMonthChange={setMonth}
              onAdd={() => setEditRow({})}
              onExport={onExport}
              onEdit={onEdit}
              onDelete={onDelete}
              onCloseModal={() => setEditRow(null)}
              onSave={onSave}
            />
          </>
        )}
    </>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel"><div className="muted" style={{ padding: '18px' }}>{children}</div></div>;
}

/**
 * The strangler is explicitly "both versions reachable and comparable side by side" — nothing was
 * deleted from hros.html and the legacy screen is still the one staff use. This says so on the page
 * rather than only in a PR description, and links straight at the original.
 */
function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React migration.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('hros.html')}#tab=attendance`}>hros.html · Attendance</a>, unchanged. This page
        renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
