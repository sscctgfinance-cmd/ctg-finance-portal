'use client';

// The route. Everything impure lives here — the session, the fetches, the selection state, the CSV
// downloads, the confirms and prompts — so that src/hr-expenses.tsx stays a pure function of its props
// and can be diffed against the legacy golden. Same split as the pilot:
//
//   app/<area>/<screen>/page.tsx   'use client', loads, holds state, wires handlers   — not golden-tested
//   src/<screen>.tsx              pure, props in / markup out                         — golden-tested
//
// SCOPE, said out loud: only `RC.page === 'list'` is migrated. The tab bar navigates, but Submit /
// Dashboard / Settings / a claim's detail hand off to the legacy screen rather than render half a form
// — see `goLegacy()`. That is the strangler working, not a gap: each of those is its own screen.

import { useCallback, useEffect, useState } from 'react';

import { showConfirm } from '../../../src/confirm';
import HrExpenses, { bankFile, listCsv, selectedIds, type RcClaim, type RcMe, type RcScope } from '../../../src/hr-expenses';
import { mytISO } from '../../../../myt.js';
import { call, legacyUrl, token } from '../../../src/portal';

/**
 * `hrToday()` — hros.html:1840, which v224 made MALAYSIAN. Its comment already CLAIMED "local (MYT)"
 * while reading the machine's zone; now the claim is true. This is the date an employee's expense claim
 * is filed under, so west of Greenwich a claim filed on the 1st was dated into the previous month —
 * a different claim period, on a form somebody approves.
 */
const today = (): string => mytISO(Date.now());

/** `hrDownload()` — hros.html:4447. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const goLegacy = (page: string) => { window.location.href = `${legacyUrl('hros.html')}#tab=expenses&rc=${page}`; };

export default function HrExpensesPage() {
  const [company, setCompany] = useState<string | null>(null);
  const [me, setMe] = useState<RcMe | null>(null);
  const [claims, setClaims] = useState<RcClaim[] | null>(null);
  const [scope, setScope] = useState<RcScope>('pending');
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  /** `hrRCLoadList()` — hros.html:1812. */
  const loadList = useCallback(async (s: RcScope) => {
    const r = await call<{ claims: RcClaim[] }>({ api: 'hr_rc_list', scope: s });
    setClaims(r.claims || []);
  }, []);

  /** `hrRCBoot()` — hros.html:1791. */
  const load = useCallback(async (s: RcScope) => {
    setErr(null);
    try {
      const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
      const co = await call<{ companies?: { tenant_id: string; tenant_name: string }[] }>({ api: 'hr_companies' });
      const list = co.companies || [];
      setCompany((list.find((c) => c.tenant_id === saved) || list[0])?.tenant_name || '');
      const cfg = await call<{ me: RcMe }>({ api: 'hr_rc_config' });
      setMe(cfg.me || {});
      await loadList(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [loadList]);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (t) void load('pending');
  }, [load]);

  /** `hrRCScope()` — hros.html:1811. The selection is cleared with the scope, deliberately: a tick made
   *  against a pending claim must not survive into the approved list and reach the payment run. */
  const onScope = useCallback((s: string) => {
    setScope(s as RcScope);
    setSel({});
    void loadList(s as RcScope).catch((e) => setErr(String(e)));
  }, [loadList]);

  /** `hrRCSelToggle()` / `hrRCSelAll()` / `hrRCSelClear()` — hros.html:1842-1844. */
  const onSelToggle = useCallback((id: string, on: boolean) => {
    setSel((s) => { const n = { ...s }; if (on) n[id] = true; else delete n[id]; return n; });
  }, []);
  const onSelAll = useCallback((on: boolean) => {
    setSel(on ? Object.fromEntries((claims || []).map((c) => [c.id, true])) : {});
  }, [claims]);

  const bulk = useCallback(async (body: Record<string, unknown>, verb: string) => {
    const ids = selectedIds(sel);
    if (!ids.length) return setErr('Select claims first');
    try {
      const r = await call<{ done: number; total: number }>({ ...body, ids });
      setNote(`${verb} ${r.done} / ${r.total}`);
      setSel({});
      await loadList(scope);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [loadList, scope, sel]);

  /** `hrRCExportBank()` — hros.html:1849. The rows come out of the pure half; this is only the button. */
  const onExportBank = useCallback(() => {
    const f = bankFile(claims || [], selectedIds(sel), today());
    if (!f) return setErr('Select Approved claims first');
    download(f.name, f.text);
    setNote(`Bank file: ${f.count} claim(s) · RM${f.total.toFixed(2)}`);
  }, [claims, sel]);

  /** `hrRCExportCsv()` — hros.html:1863. */
  const onExportCsv = useCallback(() => {
    const f = listCsv(claims || [], scope, today());
    if (!f) return setErr('Nothing to export');
    download(f.name, f.text);
    setNote(`CSV exported (${f.count} claim(s))`);
  }, [claims, scope]);

  return (
    <>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
        : !claims || !me || company === null ? <Panel><span className="spin"></span> Loading claims…</Panel>
        : (
          <>
            {note ? <Panel>{note}</Panel> : null}
            <HrExpenses
              claims={claims}
              me={me}
              companyName={company}
              page="list"
              scope={scope}
              sel={sel}
              onNav={(pg) => { if (pg !== 'list') goLegacy(pg); }}
              onScope={onScope}
              onOpen={(id) => { window.location.href = `${legacyUrl('hros.html')}#tab=expenses&rc=${id}`; }}
              onSelAll={onSelAll}
              onSelToggle={onSelToggle}
              onSelClear={() => setSel({})}
              onExportAcct={() => goLegacy('list')}
              onExportCsv={onExportCsv}
              onExportBank={onExportBank}
              onBulkApprove={() => void bulk({ api: 'hr_rc_decide_bulk', decision: 'approve' }, 'Approved')}
              onBulkReject={() => {
                const reason = window.prompt(`Reason for rejecting ${selectedIds(sel).length} claim(s):`);
                if (reason && reason.trim()) void bulk({ api: 'hr_rc_decide_bulk', decision: 'reject', comment: reason }, 'Rejected');
              }}
              onBulkInfo={() => {
                const msg = window.prompt(`Message to employee(s) for ${selectedIds(sel).length} claim(s):`);
                if (msg && msg.trim()) void bulk({ api: 'hr_rc_decide_bulk', decision: 'request_info', comment: msg }, 'Sent back');
              }}
              onBulkPay={() => {
                // The two `prompt()`s stay native — so are hros.html:1848's, and a text prompt is not one
                // of the two controls this shell ported. The CONFIRM is the app's own dialog now.
                const method = window.prompt('Payment method (applies to all):', 'Bank Transfer');
                if (method === null) return;
                const ref = window.prompt('Payment reference (optional, same for all):', '') ?? '';
                void (async () => {
                  if (!await showConfirm('Mark claims paid', `Mark ${selectedIds(sel).length} claim(s) as PAID?`, 'Mark paid', 'p')) return;
                  void bulk({ api: 'hr_rc_mark_paid_bulk', payment_method: method || 'Bank Transfer', payment_reference: ref }, 'Marked paid');
                })();
              }}
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
        <a href={`${legacyUrl('hros.html')}#tab=expenses`}>hros.html · Reimbursement</a>, unchanged. This page renders
        the same data from the same session and is diffed against the same golden. Only the claims LIST is
        here — Submit, Dashboard, Settings and a claim&apos;s detail hand back to the legacy screen.
      </div>
    </div>
  );
}
