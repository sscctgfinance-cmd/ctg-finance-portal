'use client';

// The route. Everything impure lives here — the session, the clock, the file read, the XLSX decode, the
// contact resolve, the POST, the JSZip download and all the state — so that src/finance-o2o.tsx stays a
// pure function of its props and can be diffed against the legacy golden. Same split as
// app/finance/recon/page.tsx.
//
// `o2o` is NOT on `render(t)`'s `asyncTabs` list (app.html:1504): the screen paints from the company
// list it already has and fetches nothing until a workbook is uploaded. So there is no load step here,
// only the permission resolve and the companies.
//
// XLSX and JSZip are the vendored `xlsx.full.min.js` / `jszip.min.js` app.html loads as classic scripts,
// pulled in from the same origin on first use — the same arrangement app/hr/payslip/page.tsx has with
// jspdf.umd.min.js. Together they are ~1 MB of parser for files the operator has not touched yet, so
// they are deliberately not imported.
//
// THE MONEY IS NOT COMPUTED HERE EITHER. `o2oParseRows`, `o2oApplyMasterRate`, `o2oGrandTotal` and
// `o2oInvoiceNumbers` are imported from the shared `o2o.js` that app.html loads — see its header.

import { useCallback, useEffect, useRef, useState } from 'react';

import FinanceO2O, {
  initTenant, isSkindae, issueBody, o2oReachable, plusDaysLocal, previewNums, tenantName, todayLocal,
  type IssueResponse, type IssuedInvoice, type O2OCompany, type O2ODataView, type O2OOut,
  type PdfFailure, type Perms, type PharmMaster,
} from '../../../src/finance-o2o';
import { o2oApplyMasterRate, o2oGrandTotal, o2oInvoiceNumbers, o2oParseRows } from '../../../../o2o.js';
import { showConfirm } from '../../../src/confirm';
import { toast } from '../../../src/toast';
import { call, legacyUrl, token } from '../../../src/portal';

/** The one place a base path is read in this route — src/portal.ts is the one place it is defined. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

interface Xlsx {
  read: (data: unknown, opts: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json: (ws: unknown, opts: Record<string, unknown>) => unknown[][] };
}
interface Zip { file: (n: string, d: string, o: Record<string, unknown>) => void; generateAsync: (o: Record<string, unknown>) => Promise<Blob> }

function loadScript<T>(file: string, prop: string): Promise<T | null> {
  const w = window as unknown as Record<string, unknown>;
  if (w[prop]) return Promise.resolve(w[prop] as T);
  return new Promise((res) => {
    const s = document.createElement('script');
    s.src = legacyUrl(file);
    s.onload = () => res((w[prop] as T) || null);
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });
}

/** `pharmNormalize` / `pharmFindByName` — app.html:6763-6764. */
const norm = (s: unknown) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value || '';

export default function FinanceO2OPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [companies, setCompanies] = useState<O2OCompany[] | null>(null);
  const [tenant, setTenant] = useState<string | null>(null);
  const [out, setOut] = useState<O2OOut>({ kind: 'idle' });
  const [open, setOpen] = useState<number | null>(null);
  const [nums, setNums] = useState(previewNums('', '', [], 0));
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  // The clock is read ONCE, on mount, and handed to the component — see src/finance-o2o.tsx's header.
  const [now] = useState(() => new Date());
  // The raw workbook bytes, so switching the target company re-parses under the right mode — `O2O_BUF`,
  // app.html:2765. A ref, not state: nothing renders from it.
  const buf = useRef<ArrayBuffer | null>(null);
  const masters = useRef<PharmMaster[] | null>(null);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE — app.html:1434, the chain's final `else`. O2O Billing is a FEATURE, not an
    // admin tab: see o2oReachable()'s doc comment. The server checks both the role and the tenant
    // (finance.ts:627-632), so this is tab visibility rather than the boundary.
    void call<Perms & { ok?: boolean }>({ api: 'my_perms' })
      .then((p) => {
        setPerms(p);
        if (o2oReachable(p)) {
          return call<{ companies?: O2OCompany[] }>({ api: 'companies_list' })
            .then((c) => {
              const list = c.companies || [];
              setCompanies(list);
              setTenant(initTenant(list, null));
            });
        }
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  /**
   * `o2oEnrichWithPharmacyMaster()` — app.html:3086. Both lookups are best-effort, exactly as the
   * legacy's two `try{}catch(_e){}` blocks are: a failed resolve must not stop the operator previewing.
   *
   * The contact resolve is redone on every parse ON PURPOSE (app.html:3096): each Xero organisation has
   * its own contact list and its own ContactIDs, so an id resolved for Skindae cannot invoice from
   * another org.
   */
  const enrich = useCallback(async (data: O2ODataView, forTenant: string | null): Promise<O2ODataView> => {
    try {
      if (!masters.current) {
        const r = await call<{ pharmacies?: PharmMaster[] }>({ api: 'pharmacy_list' });
        masters.current = r.pharmacies || [];
      }
    } catch { /* best-effort, as the legacy is */ }
    try {
      const names = data.pharmacies.map((x) => x.pharmacy).filter(Boolean);
      if (names.length && forTenant) {
        const rx = await call<{ rows?: { pharmacy?: string }[] }>({ api: 'o2o_contacts_resolve', tenant: forTenant, names });
        const byName: Record<string, unknown> = {};
        (rx.rows || []).forEach((row) => { byName[String(row.pharmacy || '').toUpperCase()] = row; });
        data.pharmacies.forEach((x) => { x.__xero = (byName[String(x.pharmacy || '').toUpperCase()] as never) || null; });
      }
    } catch { /* best-effort, as the legacy is */ }
    data.pharmacies.forEach((p) => {
      const m = (masters.current || []).find((x) => norm((x as { name?: string }).name) === norm(p.pharmacy)) || null;
      p.__master = m;
      // The "is this rate valid" rule lives in o2o.js with the arithmetic it guards — a blank master
      // rate must fall back to 19.2%, and Number('')===0 would invoice at full gross price.
      if (m) o2oApplyMasterRate(p, m.commission_rate);
    });
    data.grand_total = o2oGrandTotal(data.pharmacies);
    return data;
  }, []);

  /** `o2oPreviewNums()` — app.html:2791. The pharmacy count comes from the current preview, as there. */
  const refreshNums = useCallback((data?: O2ODataView | null) => {
    const prefix = val('o2o-invprefix');
    const start = val('o2o-invstart');
    const count = data ? data.pharmacy_count : (out.kind === 'preview' ? out.data.pharmacy_count : 0);
    setNums(previewNums(prefix, start, o2oInvoiceNumbers(count || 1, prefix, start), count));
  }, [out]);

  /** Parse the bytes we already hold under the CURRENT target company, then enrich and preview. */
  const reparse = useCallback(async (bytes: ArrayBuffer, forTenant: string | null, list: O2OCompany[]) => {
    try {
      const XLSX = await loadScript<Xlsx>('xlsx.full.min.js', 'XLSX');
      if (!XLSX) { setOut({ kind: 'error', message: 'Could not load the spreadsheet reader (xlsx.full.min.js).' }); return; }
      const wb = XLSX.read(new Uint8Array(bytes), { type: 'array' });
      const sheets = wb.SheetNames.map((sn) => ({ name: sn, rows: XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null }) }));
      const data = o2oParseRows(sheets, isSkindae(list, forTenant)) as O2ODataView;
      const enriched = await enrich(data, forTenant);
      setOut({ kind: 'preview', data: enriched });
      setOpen(null);
      refreshNums(enriched);
    } catch (e) {
      setOut({ kind: 'error', message: 'Parse failed: ' + (e instanceof Error ? e.message : String(e)) });
    }
  }, [enrich, refreshNums]);

  /** `o2oPick(input)` — app.html:3044. */
  const onPick = useCallback((e: { target: unknown }) => {
    const f = (e.target as HTMLInputElement | null)?.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = (ev) => {
      buf.current = ev.target?.result as ArrayBuffer;
      void reparse(buf.current, tenant, companies || []);
    };
    rd.readAsArrayBuffer(f);
  }, [reparse, tenant, companies]);

  /** `o2oOnTenantChange(sel)` — app.html:2831, including the re-parse of the last-loaded workbook. */
  const onTenantChange = useCallback((e: { target: unknown }) => {
    const v = (e.target as HTMLSelectElement).value;
    setTenant(v);
    if (buf.current) void reparse(buf.current, v, companies || []);
  }, [reparse, companies]);

  /** `o2oResetDates()` — app.html:2768. Writes the same two ids the legacy writes. */
  const onResetDates = useCallback(() => {
    const inv = document.getElementById('o2o-invdate') as HTMLInputElement | null;
    if (inv) inv.value = todayLocal(new Date());
    const due = document.getElementById('o2o-duedate') as HTMLInputElement | null;
    if (due) due.value = plusDaysLocal(new Date(), 30);
  }, []);

  /** `o2oIssue()` — app.html:3299. The body itself is `issueBody()`, in src/, and pinned by the test. */
  const onIssue = useCallback(async () => {
    if (out.kind !== 'preview') { toast('Preview first', true); return; }
    if (!tenant) { toast('Pick a company first', true); return; }
    const data = out.data;
    const dry = (document.getElementById('o2o-test') as HTMLInputElement | null)?.checked ?? true;
    const invDate = val('o2o-invdate') || todayLocal(new Date());
    const dueDate = val('o2o-duedate') || plusDaysLocal(new Date(), 30);
    if (dueDate && invDate && dueDate < invDate) { toast('Due date is before invoice date', true); return; }
    // `null` means the operator typed something that is not a digit run. It must NOT collapse into
    // "let Xero number them" — see o2o.js's header.
    const invNums = o2oInvoiceNumbers(data.pharmacy_count, val('o2o-invprefix'), val('o2o-invstart'));
    if (invNums === null) { toast('Invoice Start # must be digits (e.g. 001, 1183)', true); return; }
    const numsMsg = invNums.length ? (' · numbered ' + invNums[0] + ' → ' + invNums[invNums.length - 1]) : ' · Xero auto-numbering';
    const co = tenantName(companies, tenant);
    if (!await showConfirm(dry ? 'Preview (test mode)' : 'Create REAL Xero invoices',
      (dry ? 'TEST MODE — preview what would be created for ' : 'Create REAL Xero invoices for ')
      + data.pharmacy_count + ' pharmacies in ' + co + ' (dated ' + invDate + ', due ' + dueDate + numsMsg + ')?',
      dry ? 'Preview' : 'Create invoices', 'p')) return;
    try {
      const r = await call<IssueResponse>(issueBody({
        tenant, data, invoiceDate: invDate, dueDate, dryRun: dry, invNums,
        skindae: isSkindae(companies, tenant),
      }));
      // Dry-run has no invoice_id, so the ZIP button cannot appear until a real live post.
      const downloadable: IssuedInvoice[] = (r.results || [])
        .filter((x) => x.status === 'issued' && x.invoice_id)
        .map((x) => ({ invoice_id: x.invoice_id!, pharmacy: x.pharmacy, number: x.number, total: x.total }));
      setOut({ kind: 'issued', res: r, downloadable, failures: null, downloaded: 0 });
    } catch (e) {
      setOut({ kind: 'error', message: 'Failed: ' + (e instanceof Error ? e.message : String(e)) });
    }
  }, [out, tenant, companies]);

  /** `o2oDownloadPdfs(retryOnly)` — app.html:3216. */
  const onDownloadPdfs = useCallback(async (retryOnly: boolean) => {
    if (out.kind !== 'issued' || !out.downloadable.length) return;
    const JSZipCtor = await loadScript<new () => Zip>('jszip.min.js', 'JSZip');
    if (!JSZipCtor) { toast('ZIP library not loaded — refresh the page', true); return; }
    const byId: Record<string, IssuedInvoice> = {};
    out.downloadable.forEach((iv) => { byId[iv.invoice_id] = iv; });
    const toFetch = retryOnly && out.failures && out.failures.length
      ? out.downloadable.filter((iv) => (out.failures || []).some((f) => f.pharmacy === iv.pharmacy))
      : out.downloadable;
    try {
      const r = await call<{ pdfs?: { filename?: string; base64?: string; pharmacy?: string; error?: string; invoice_id?: string }[] }>(
        { api: 'o2o_pdfs', tenant, invoices: toFetch });
      const all = r.pdfs || [];
      const ok = all.filter((p) => p.base64);
      const bad = all.filter((p) => !p.base64);
      if (ok.length) {
        const zip = new JSZipCtor();
        ok.forEach((p) => zip.file(p.filename!, p.base64!, { base64: true }));
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'o2o_invoices_' + todayLocal(new Date()) + (retryOnly ? '_retry' : '') + '.zip';
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
      }
      setOut({ ...out, failures: bad as PdfFailure[], downloaded: ok.length });
    } catch (e) {
      toast('Failed: ' + (e instanceof Error ? e.message : String(e)), true);
    }
  }, [out, tenant]);

  return (
    <>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
        : perms !== null && !o2oReachable(perms)
          ? <Panel>
              O2O Billing is not on your feature list — it parses the monthly pharmacy workbook and issues
              real Xero invoices from it. Ask an administrator if you need access.
            </Panel>
        : !companies ? <Panel><span className="spin"></span> Loading companies…</Panel>
        : <FinanceO2O
            companies={companies}
            tenant={tenant}
            today={todayLocal(now)}
            due={plusDaysLocal(now, 30)}
            out={out}
            nums={nums}
            canIssue={out.kind === 'preview'}
            openPharmacy={open}
            onTenantChange={onTenantChange}
            onResetDates={onResetDates}
            onPreviewNums={() => refreshNums()}
            onPick={onPick}
            onIssue={() => void onIssue()}
            onTogglePharmacy={(i) => setOpen((cur) => (cur === i ? null : i))}
            onLinkContact={(pharmacy, contactId, contactName, source) => {
              void call({ api: 'o2o_contact_link', tenant, pharmacy, contact_id: contactId, contact_name: contactName, source })
                .then(() => { if (buf.current) return reparse(buf.current, tenant, companies); })
                .catch((e) => toast(e instanceof Error ? e.message : String(e), true));
            }}
            onSearchContacts={(pharmacy, q) => {
              // The legacy paints the hits into a `.o2o-sr` div next to the input. Rendering them is
              // React's job, so the results land in the pharmacy's own `__xero.suggestions` — which is
              // the same list the "closest matches" buttons already come from, and they link the same way.
              void call<{ contacts?: { contact_id: string; name: string }[] }>({ api: 'o2o_contacts_search', tenant, q })
                .then((r) => setOut((cur) => {
                  if (cur.kind !== 'preview') return cur;
                  const data = { ...cur.data, pharmacies: cur.data.pharmacies.map((p) => p.pharmacy !== pharmacy ? p
                    : { ...p, __xero: { ...(p.__xero || {}), status: p.__xero?.status || 'none', suggestions: (r.contacts || []).slice(0, 12) } }) };
                  return { kind: 'preview', data };
                }))
                .catch((e) => toast(e instanceof Error ? e.message : String(e), true));
            }}
            onDownloadPdfs={(retry) => void onDownloadPdfs(retry)}
            onDismissPdfPanel={() => setOut((cur) => (cur.kind === 'issued' ? { ...cur, failures: null } : cur))}
            // The legacy prefills the Pharmacies tab through a delegated click listener
            // (app.html:3129-3142): switch tab, start a new record, write the name into the field and
            // focus it. Pharmacies IS migrated, so this stays in the React app — `?new=1&name=` is the
            // detail route's spelling of exactly those three steps.
            onAddPharmacy={(name) => {
              window.location.href = `${BASE}/finance/pharm/detail/?new=1&name=${encodeURIComponent(name)}`;
            }}
          />}
    </>
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
        <a href={`${legacyUrl('app.html')}#tab=o2o`}>app.html · O2O Billing</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
