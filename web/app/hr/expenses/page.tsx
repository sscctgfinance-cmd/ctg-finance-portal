'use client';

// The route. Everything impure lives here — the session, the fetches, the selection state, the CSV
// downloads, the DOM reads, the confirms and prompts — so that the three `src/hr-expenses*` components
// stay pure functions of their props and can be diffed against the legacy goldens.
//
//   app/<area>/<screen>/page.tsx   'use client', loads, holds state, wires handlers   — not golden-tested
//   src/<screen>.tsx              pure, props in / markup out                         — golden-tested
//
// ── v225: the SUBMIT half ───────────────────────────────────────────────────────────────────────────
// Until v225 only `RC.page === 'list'` was here and everything else did `window.location.href` back to
// hros.html — so NO EMPLOYEE COULD FILE A CLAIM FROM REACT AT ALL. `hrRC()` (hros.html:1783) is a tab
// bar over five bodies; three of them are now migrated (list, form, detail) and two are not (Dashboard
// and Settings, both admin-only, both their own screen's worth of markup). The banner at the bottom of
// this file says exactly that, and `onNav` still hands those two off.
//
// TWO SHAPES BEHIND ONE SCREEN, decided by role — `RC.me.isAdmin===false` (hros.html:1785) gives an
// employee two tabs (📋 Claims / ➕ Submit) and four different scopes. `app/hr/leave/page.tsx` is the
// precedent, and it exists because the same shape was missed there.
//
// ── TWO BUGS THIS ROUTE HAD, both of the kinds CLAUDE.md already names ──────────────────────────────
// 1. `hr_companies` (hr.ts:815) requires `hrCanView()` — admin / hr_admin / viewer — and this route
//    awaited it BEFORE anything else, so every plain `employee` got `⚠️ unauthorized` as the whole page.
//    That is `hr.leave`'s F2 and `finance.users`' "a gate downstream of the load" in one. `hr_rc_config`
//    is loaded FIRST now: it answers for an employee, and it is what says which shape to render.
// 2. The company list was kept by NAME and every call went out with no `tenant`. `hr_rc_list`'s admin
//    branch (hr.ts:2549) filters `.eq("tenant_id","")` and answers `ok` with an EMPTY list — loud
//    nowhere, exactly `hr.yearend`'s `hr_bootstrap` finding. The tenant_id is kept and carried now.

import { useCallback, useEffect, useRef, useState } from 'react';

import { showConfirm } from '../../../src/confirm';
import { toast } from '../../../src/toast';
import HrExpenses, { bankFile, listCsv, selectedIds, type RcClaim, type RcMe, type RcScope } from '../../../src/hr-expenses';
import HrExpensesForm, {
  blankItem, claimBody, DECLARATIONS, defaultRate, isMileage, itemAmount, keptItems, pickReceipts,
  saveRefusal, tooBigMessage, type RcConfig, type RcForm, type RcFormItem,
} from '../../../src/hr-expenses-form';
import HrExpensesDetail, {
  adjustConfirm, adjustPrompt, adjustRefusal, editForm, RESUBMIT_CONFIRM, RESUBMIT_DECLARATIONS,
  voucherHtml, type RcDetail,
} from '../../../src/hr-expenses-detail';
import { applyExtract, fileB64, pickBlankItem, prepImage, scanToast, type OcrExtract } from '../../../src/hr-rc-scan';
import { buildFormPdf, mergedFileName, mergeFormAndReceipts, mergeToast } from '../../../src/hr-rc-pdf';
import { mytISO } from '../../../../myt.js';
import { call, legacyUrl, token } from '../../../src/portal';
import { loadDocScanner, loadJsPDF, loadJsQR, loadPdfLib, type DocScannerResult } from './libs';
import ScanModal from './scan-modal';
import { uploadProgress, uploadReceipt } from './upload';

/**
 * `hrToday()` — hros.html:1846, which v224 made MALAYSIAN. Its comment already CLAIMED "local (MYT)"
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

interface Company { tenant_id: string; tenant_name: string }
type Page = 'list' | 'form' | 'detail';

const el = (id: string) => document.getElementById(id) as (HTMLInputElement | HTMLSelectElement | null);
const v = (id: string) => { const e = el(id); return e ? e.value : undefined; };

export default function HrExpensesPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [me, setMe] = useState<RcMe | null>(null);
  const [cfg, setCfg] = useState<RcConfig | null>(null);
  const [claims, setClaims] = useState<RcClaim[] | null>(null);
  const [scope, setScope] = useState<RcScope>('pending');
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [page, setPage] = useState<Page>('list');
  const [detail, setDetail] = useState<RcDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState<string | null>(null);
  /** The same synchronous guard the save has, for the detail's writes. See `savingRef`. */
  const detailBusyRef = useRef(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  /**
   * `RC.form` — hros.html:2000. Held in a REF as well as in state: `syncForm()` reads the uncontrolled
   * boxes back out of the DOM on every action, exactly as `hrRCSyncItems()` does, and a handler that
   * fired twice before React re-rendered would otherwise sync into a stale copy.
   */
  const form = useRef<RcForm>({});
  const files = useRef<File[]>([]);          // `RC.form._files`  — receipts from the plain input
  const scans = useRef<(File | Blob)[]>([]); // `RC.form._scanFiles` — cropped scans, attach on save
  /** Bumped only when something OUTSIDE the boxes changes a field — the sibling pages' re-mount key.
   *  Typing never bumps it, so the caret never moves. */
  const [gen, setGen] = useState(0);
  /**
   * `RC._saving` — hros.html:2083 — and it has to be a REF, not state.
   *
   * This was written with `useState` first and it did not hold: five synchronous taps all read the same
   * `false` out of one closure before React had re-rendered, and the browser recorded five `hr_rc_save`
   * and five `hr_rc_submit` calls. `disabled={saving}` does not help either — the attribute is applied
   * on the NEXT render, which is after the burst. A double-clicked claim submission is a duplicate
   * claim, and the legacy's plain mutable flag is what makes the guard synchronous. The state below is
   * only what the button READS; the ref is what refuses.
   */
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [scanImg, setScanImg] = useState<HTMLImageElement | null>(null);

  const isEmp = me ? me.isAdmin === false : false;
  const repaint = useCallback(() => setGen((g) => g + 1), []);

  // ── loading ──────────────────────────────────────────────────────────────────────────────────────

  /** `hrRCLoadList()` — hros.html:1818. The tenant is carried; see the header's finding 2. */
  const loadList = useCallback(async (s: RcScope, tenant: string | null) => {
    const r = await call<{ claims: RcClaim[] }>({ api: 'hr_rc_list', tenant, scope: s });
    setClaims(r.claims || []);
  }, []);

  /**
   * `hrRCBoot()` — hros.html:1797, reordered for the reason in the header. `hr_rc_config` answers for
   * an employee AND says whether they are an admin; only an admin then asks for the company list.
   */
  const load = useCallback(async (s: RcScope) => {
    setErr(null);
    try {
      const c = await call<{ me?: RcMe; tenant_name?: string } & RcConfig>({ api: 'hr_rc_config' });
      const who = c.me || {};
      setMe(who);
      setCfg(c);
      let tenant: Company | null = null;
      if (who.isAdmin) {
        const saved = (() => { try { return localStorage.getItem('hr_tenant') || ''; } catch { return ''; } })();
        const co = await call<{ companies?: Company[] }>({ api: 'hr_companies' }).catch(() => ({ companies: [] as Company[] }));
        const list = co.companies || [];
        tenant = list.find((x) => x.tenant_id === saved) || list[0] || null;
        // An admin reloads the config WITH the company, because its claim types, cost centres and
        // employee list are company-scoped (hr.ts:1925) and the first call sent no tenant.
        if (tenant) setCfg(await call<RcConfig>({ api: 'hr_rc_config', tenant: tenant.tenant_id }));
      } else {
        // An employee works in ONE company and never sees the picker (hros.html:1377). `hr_rc_config`
        // resolves their tenant server-side and sends back only its NAME, which is all the chip needs;
        // every call they make is pinned to `who.employee.tenant_id` on the server, not by the client.
        tenant = c.tenant_name ? { tenant_id: '', tenant_name: c.tenant_name } : { tenant_id: '', tenant_name: '' };
      }
      setCompany(tenant);
      const initial: RcScope = who.isAdmin === false ? 'all' : s;
      setScope(initial);
      await loadList(initial, tenant && tenant.tenant_id ? tenant.tenant_id : null);
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

  const tenantId = company && company.tenant_id ? company.tenant_id : null;
  const refreshList = useCallback((s: RcScope) => loadList(s, tenantId).catch((e) => setErr(String(e))), [loadList, tenantId]);

  // ── the list ─────────────────────────────────────────────────────────────────────────────────────

  /** `hrRCScope()` — hros.html:1817. The selection is cleared with the scope, deliberately: a tick made
   *  against a pending claim must not survive into the approved list and reach the payment run. */
  const onScope = useCallback((s: string) => {
    setScope(s as RcScope);
    setSel({});
    void refreshList(s as RcScope);
  }, [refreshList]);

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
      await refreshList(scope);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [refreshList, scope, sel]);

  /** `hrRCExportBank()` — hros.html:1855. The rows come out of the pure half; this is only the button. */
  const onExportBank = useCallback(() => {
    const f = bankFile(claims || [], selectedIds(sel), today());
    if (!f) return setErr('Select Approved claims first');
    download(f.name, f.text);
    setNote(`Bank file: ${f.count} claim(s) · RM${f.total.toFixed(2)}`);
  }, [claims, sel]);

  /** `hrRCExportCsv()` — hros.html:1869. */
  const onExportCsv = useCallback(() => {
    const f = listCsv(claims || [], scope, today());
    if (!f) return setErr('Nothing to export');
    download(f.name, f.text);
    setNote(`CSV exported (${f.count} claim(s))`);
  }, [claims, scope]);

  // ── the form ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * `hrRCSyncItems()` — hros.html:2062, id for id. The form is UNCONTROLLED and its `rc_*` ids are the
   * contract; this is the read. A field that loses its id syncs as `undefined` and saves as blank,
   * which on this form is a wiped amount or a dropped e-invoice UUID with no error anywhere — which is
   * why `web/tests/hr-expenses-form.parity.test.tsx` extracts the id set out of hros.html at run time.
   */
  const syncForm = useCallback(() => {
    const f = form.current;
    if (!Array.isArray(f.items)) f.items = [];
    if (v('rc_emp') != null) f.employee_id = v('rc_emp');
    if (v('rc_date') != null) f.claim_date = v('rc_date');
    if (v('rc_month') != null) f.claim_month = v('rc_month');
    if (v('rc_cc') != null) f.cost_center = v('rc_cc');
    if (v('rc_dept') != null) f.department = v('rc_dept');
    if (v('rc_project') != null) f.project = v('rc_project');
    if (v('rc_remarks') != null) f.remarks = v('rc_remarks');
    if (v('rc_desc') != null) f.description = v('rc_desc');
    f.items.forEach((it, i) => {
      const g = (s: string) => el('rc_it_' + i + '_' + s);
      const set = (s: string, k: keyof RcFormItem) => { const e = g(s); if (e) (it as any)[k] = e.value; };
      set('type', 'claim_type_id'); set('date', 'item_date'); set('desc', 'description');
      set('km', 'total_km'); set('rate', 'mileage_rate'); set('amt', 'amount');
      set('ven', 'vendor_name'); set('rno', 'receipt_no'); set('ino', 'invoice_no');
      set('stin', 'supplier_tin'); set('euuid', 'einvoice_uuid');
      const einv = g('einv') as HTMLInputElement | null; if (einv) it.is_einvoice = einv.checked;
      set('tax', 'tax_amount'); set('sst', 'sst_amount'); set('cc', 'cost_center');
      set('rem', 'remarks'); set('from', 'start_location'); set('to', 'end_location');
      set('pur', 'purpose'); set('park', 'parking_amount'); set('toll', 'toll_amount');
    });
  }, []);

  const items = (): RcFormItem[] => {
    const f = form.current;
    if (!Array.isArray(f.items) || !f.items.length) {
      f.items = [{ claim_type_id: '', item_date: f.claim_date || today(), description: '', amount: '', total_km: '', mileage_rate: defaultRate(cfg || {}) }];
    }
    return f.items;
  };

  /**
   * `hrRCItemCalc()` — hros.html:2080. Writes the two live figures straight into the DOM, exactly as the
   * legacy does, rather than through state: `oninput` on every keystroke is the one place a re-render
   * would move the caret out from under the person typing an amount.
   */
  const onItemCalc = useCallback(() => {
    syncForm();
    let total = 0;
    (form.current.items || []).forEach((it, i) => {
      const mile = isMileage(cfg || {}, it.claim_type_id);
      const amt = itemAmount(it, mile);
      total += amt;
      const lbl = document.getElementById('rc_it_' + i + '_amtL');
      if (lbl && mile) lbl.textContent = M(amt);
    });
    const t = document.getElementById('rc_total');
    if (t) t.textContent = M(total);
  }, [cfg, syncForm]);

  /** `hrRCNav('form')` — hros.html:1807. An in-progress form is never wiped without asking. */
  const openForm = useCallback(async () => {
    if (page === 'form') return;
    const f = form.current;
    const unsaved = !f.id && (
      (Array.isArray(f.items) && f.items.some((it) => it && (it.claim_type_id || (Number(it.amount) || 0) || (Number(it.total_km) || 0) || it.description || it.vendor_name)))
      || scans.current.length);
    if (unsaved && !await showConfirm('Unsaved reimbursement',
      'You have an unsaved reimbursement (with scanned receipts). Discard it and start a new blank form?', 'Discard', 'd')) {
      setPage('form');
      return;
    }
    form.current = {};
    files.current = [];
    scans.current = [];
    setScanStatus('');
    repaint();
    setPage('form');
  }, [page, repaint]);

  /** `hrRCSave()` — hros.html:2082. */
  const onSave = useCallback((submit: boolean) => {
    if (savingRef.current) return;            // `RC._saving` — a double-tap must not create two claims
    syncForm();
    const f = form.current;
    const decs = Object.fromEntries(DECLARATIONS.map(([id], i) => [
      (['business_purpose', 'not_claimed_before', 'receipts_valid', 'understand_disciplinary'] as const)[i],
      !!(document.getElementById('rc_' + id) as HTMLInputElement | null)?.checked,
    ])) as { business_purpose: boolean; not_claimed_before: boolean; receipts_valid: boolean; understand_disciplinary: boolean };

    const refusal = saveRefusal({ isEmp, employeeId: f.employee_id, items: f.items || [], submit, declarations: decs });
    if (refusal) { toast(refusal, true); return; }

    savingRef.current = true;
    setSaving(true);
    void (async () => {
      try {
        const r = await call<{ id: string }>({ api: 'hr_rc_save', tenant: tenantId, claim: claimBody(f, f.items || []) });
        const cid = r.id;
        f.id = cid;

        // Read from the REF, which survives re-renders — hros.html:2103's own lesson: the DOM input's
        // FileList is lost the moment the form is rebuilt, and a save then uploaded nothing while
        // submit failed with "A receipt is required", which points at the wrong thing entirely.
        const pend = files.current.slice();
        const fi = document.getElementById('rc_file') as HTMLInputElement | null;
        if (fi && fi.files && fi.files.length) {
          Array.prototype.slice.call(fi.files).forEach((x: File) => {
            if (!pend.some((y) => y.name === x.name && y.size === x.size && y.lastModified === x.lastModified)) pend.push(x);
          });
        }
        if (pend.length) {
          const failed: string[] = [];
          for (let i = 0; i < pend.length; i++) {
            toast(uploadProgress(i, pend.length, pend[i]));
            const prepped = await prepImage(pend[i]);
            const ur = await uploadReceipt(cid, (prepped || pend[i]) as File);
            if (!ur.ok) failed.push((pend[i].name || 'receipt') + (ur.error ? ' — ' + ur.error : ''));
          }
          if (failed.length) {
            toast('Could not attach: ' + failed.join('; '), true);
            return;                            // do not submit a claim whose receipt did not land
          }
          files.current = [];                  // uploaded — clear so a later save cannot double-attach
        }
        if (scans.current.length) {
          toast('Attaching scanned e-invoice…');
          for (const sf of scans.current) await uploadReceipt(cid, sf);
          scans.current = [];
        }
        if (submit) {
          const s = await call<{ status?: string; warnings?: string[] }>({ api: 'hr_rc_submit', tenant: tenantId, id: cid, declarations: decs });
          toast('Submitted → ' + s.status + ((s.warnings && s.warnings.length) ? ' · ' + s.warnings.length + ' warning(s)' : ''));
        } else {
          toast('Draft saved');
        }
        form.current = {};
        setPage('list');
        repaint();
        await refreshList(scope);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), true);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    })();
  }, [isEmp, refreshList, repaint, scope, syncForm, tenantId]);

  // ── the scanner ──────────────────────────────────────────────────────────────────────────────────

  /**
   * `hrRCScanProcess()` — hros.html:2455. OCR the image best-effort, fill the first blank line, let the
   * QR win the e-invoice identity, and queue the attachment. Works even when OCR is unavailable
   * (`hr_rc_ocr` is behind Claude vision credits) — the QR and the attachment still land.
   */
  const scanProcess = useCallback(async (attachFile: File | Blob | null, ocr: { b64?: string; file?: File | Blob | null; type?: string }, qr: { url: string; uuid: string } | null) => {
    setScanStatus('📷 Reading…');
    let b64 = ocr.b64 || '', type = ocr.type || 'image/jpeg';
    if (!b64 && ocr.file) {
      const small = await prepImage(ocr.file);
      b64 = await fileB64((small || ocr.file) as Blob);
      type = ((small || ocr.file) as File).type || type;
    }
    let x: OcrExtract = {}, claimTypeId: string | null = null, ocrErr = '';
    try {
      const r = await call<{ extracted?: OcrExtract; claim_type_id?: string }>({ api: 'hr_rc_ocr', file_b64: b64, file_type: type });
      x = r.extracted || {};
      claimTypeId = r.claim_type_id || null;
    } catch (e) { ocrErr = e instanceof Error ? e.message : String(e); }

    syncForm();
    const list = items();
    let idx = pickBlankItem(list);
    if (idx < 0) { list.push({}); idx = list.length - 1; }
    Object.assign(list[idx], applyExtract(x, claimTypeId, qr));
    if (attachFile) scans.current.push(attachFile);
    setScanStatus('');
    const t = scanToast(qr, x, ocrErr);
    toast(t.text, t.err);
    repaint();
  }, [repaint, syncForm]);

  /** `hrRCScanTrigger()` — hros.html:2246. The camera pipeline, or the file picker where it cannot run. */
  const onScanTrigger = useCallback(() => {
    syncForm();
    void loadDocScanner().then((ds) => {
      if (ds && navigator.mediaDevices) {
        ds.open({
          multi: true,
          title: '📷 Scan receipt / e-invoice',
          onDone: (res: DocScannerResult) => void fromScanner(res),
        });
        return;
      }
      onScanPickFile();
    });
  }, [syncForm]);

  /** `hrRCScanFromScanner()` — hros.html:2258. QR first on the UN-enhanced pages: B&W thresholding can
   *  eat a faint QR, and the QR is the only reading of the e-invoice identity with no model in the loop. */
  const fromScanner = useCallback(async (res: DocScannerResult) => {
    setScanStatus('📷 Reading QR…');
    try {
      let qr: { url: string; uuid: string } | null = null;
      const jsQR = await loadJsQR();
      if (jsQR) {
        const { qrOn } = await import('../../../src/hr-rc-scan');
        const cands = (res.rawCanvases || []).concat(res.pageCanvases || []);
        for (let i = 0; i < cands.length && !qr; i++) { try { qr = qrOn(jsQR, cands[i]); } catch { /* try the next page */ } }
      }
      let attach: File | Blob;
      try { attach = new File([res.pdfBlob], 'receipt.pdf', { type: 'application/pdf' }); }
      catch { attach = res.pdfBlob; }
      await scanProcess(attach, { b64: res.jpegB64, type: 'image/jpeg' }, qr);
    } catch (e) {
      setScanStatus('');
      toast('Scan failed: ' + (e instanceof Error ? e.message : String(e)), true);
    }
  }, [scanProcess]);

  const onScanPickFile = useCallback(() => {
    const e = document.getElementById('rc_scan_fi') as HTMLInputElement | null;
    if (e) { e.value = ''; e.click(); }
  }, []);

  /** `hrRCScanFile()` — hros.html:2278. A PDF skips the modal; an image goes through crop + QR first. */
  const onScanFile = useCallback((input: HTMLInputElement) => {
    const file = input.files && input.files[0];
    if (!file) return;
    syncForm();
    if (!/^image\//.test(file.type || '')) { void scanProcess(file, { file }, null); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); setScanImg(img); };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Could not open that image', true); };
    img.src = url;
  }, [scanProcess, syncForm]);

  // ── the detail ───────────────────────────────────────────────────────────────────────────────────

  /** `hrRCOpen()` — hros.html:2508. */
  const openDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    try {
      const r = await call<RcDetail>({ api: 'hr_rc_get', id });
      setDetail(r);
      setPage('detail');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const reopen = useCallback(async () => {
    if (detail) { await openDetail(detail.claim.id); await refreshList(scope); }
  }, [detail, openDetail, refreshList, scope]);

  /** Every detail write goes through here: one in-flight action at a time, released in `finally`, which
   *  is `runOnce()`'s contract (app.html:1367) and PRs 108/109's pattern. */
  const detailRun = useCallback(async (key: string, body: Record<string, unknown>, ok: (r: any) => string) => {
    if (detailBusyRef.current) return;
    detailBusyRef.current = true;
    setDetailBusy(key);
    try {
      const r = await call<any>(body);
      toast(ok(r));
      await reopen();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    } finally {
      detailBusyRef.current = false;
      setDetailBusy(null);
    }
  }, [reopen]);

  /** `hrRCDecide()` — hros.html:2569. */
  const onDecide = useCallback((dec: 'approve' | 'reject' | 'request_info') => {
    const com = (document.getElementById('rc_com') as HTMLTextAreaElement | null)?.value || '';
    if ((dec === 'reject' || dec === 'request_info') && !com.trim()) { toast('Please enter a reason / message', true); return; }
    void detailRun('decide', { api: 'hr_rc_decide', id: detail!.claim.id, decision: dec, comment: com }, (r) => 'Done → ' + (r.status || ''));
  }, [detail, detailRun]);

  /** `hrRCOverride()` — hros.html:2597. Two native prompts, as the legacy has them. */
  const onOverride = useCallback(() => {
    const amt = window.prompt('Override amount (RM):', String(detail!.claim.amount ?? ''));
    if (amt == null) return;
    const reason = window.prompt('Reason for override (required):');
    if (!reason || !reason.trim()) { toast('A reason is required', true); return; }
    const com = (document.getElementById('rc_com') as HTMLTextAreaElement | null)?.value || 'Amount overridden';
    void detailRun('decide', { api: 'hr_rc_decide', id: detail!.claim.id, decision: 'approve', override_amount: Number(amt), override_reason: reason, comment: com }, () => 'Overridden + approved');
  }, [detail, detailRun]);

  /** `hrRCMarkPaid()` — hros.html:2570. */
  const onMarkPaid = useCallback(() => {
    void detailRun('paid', {
      api: 'hr_rc_mark_paid', id: detail!.claim.id,
      payment_method: (document.getElementById('rc_pm') as HTMLInputElement | null)?.value || '',
      payment_reference: (document.getElementById('rc_pr') as HTMLInputElement | null)?.value || '',
    }, () => 'Marked paid ✓');
  }, [detail, detailRun]);

  /** `hrRCAdjustAmount()` — hros.html:2581. Every guard is `adjustRefusal()`; see its comment. */
  const onAdjustAmount = useCallback(() => {
    const c = detail!.claim;
    const cur = Number(c.amount) || 0;
    const amt = window.prompt(adjustPrompt(c.claim_no, cur), cur.toFixed(2));
    if (amt == null) return;
    const refusal = adjustRefusal(cur, amt);
    if (refusal) { toast(refusal, true); return; }
    const reason = window.prompt('Reason for the adjustment (required — it is written to the audit trail):');
    if (reason == null) return;
    if (!reason.trim()) { toast('A reason is required', true); return; }
    void (async () => {
      if (!await showConfirm('Adjust amount', adjustConfirm(c.claim_no, cur, Number(amt)), 'Adjust', 'd')) return;
      void detailRun('adjust', { api: 'hr_rc_adjust_amount', id: c.id, amount: Number(amt), reason: reason.trim() },
        (r) => 'Amount adjusted: RM ' + (Number(r.from) || 0).toFixed(2) + ' → RM ' + (Number(r.to) || 0).toFixed(2));
    })();
  }, [detail, detailRun]);

  /** `hrRCCancel()` — hros.html:2578. */

  const onCancel = useCallback(() => {
    void (async () => {
      if (!await showConfirm('Cancel claim', 'Cancel this claim?', 'Yes, cancel it', 'd')) return;
      void detailRun('cancel', { api: 'hr_rc_cancel', id: detail!.claim.id }, () => 'Cancelled');
    })();
  }, [detail, detailRun]);

  /** `hrRCResubmit()` — hros.html:2606. The four declarations are re-confirmed in one dialog. */
  const onResubmit = useCallback(() => {
    void (async () => {
      if (!await showConfirm('Resubmit claim', RESUBMIT_CONFIRM, 'I confirm all four', 'p')) return;
      void detailRun('resubmit', { api: 'hr_rc_submit', tenant: tenantId, id: detail!.claim.id, declarations: RESUBMIT_DECLARATIONS }, (r) => 'Submitted → ' + r.status);
    })();
  }, [detail, detailRun, tenantId]);

  /** `hrRCEdit()` — hros.html:2598. */
  const onEdit = useCallback(() => {
    form.current = editForm(detail!) as RcForm;
    files.current = [];
    scans.current = [];
    setScanStatus('');
    repaint();
    setPage('form');
  }, [detail, repaint]);

  /** `hrRCVoucher()` — hros.html:1870. The string is pure; this is the print. */
  const onVoucher = useCallback(() => {
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print the voucher', true); return; }
    w.document.write(voucherHtml(detail!, (company && company.tenant_name) || ''));
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch { /* the tab is still open and printable by hand */ } }, 350);
  }, [company, detail]);

  /** `hrRCFormAndReceipts()` — hros.html:1957. */
  const onFormAndReceipts = useCallback(() => {
    if (detailBusyRef.current) return;
    detailBusyRef.current = true;
    setDetailBusy('pdf');
    toast('Building form + merging receipts…');
    void (async () => {
      try {
        const [JsPDF, PDFLib] = await Promise.all([loadJsPDF(), loadPdfLib()]);
        if (!JsPDF) throw new Error('Could not load the PDF engine (jspdf.umd.min.js).');
        if (!PDFLib) throw new Error('Could not load the PDF merge engine (pdf-lib.min.js).');
        const formPdf = buildFormPdf(JsPDF, detail!, (company && company.tenant_name) || '');
        const out = await mergeFormAndReceipts({ PDFLib, formPdf, attachments: detail!.attachments || [], fetchFn: fetch });
        const url = URL.createObjectURL(new Blob([out.bytes as unknown as BlobPart], { type: 'application/pdf' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = mergedFileName(detail!.claim.claim_no);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast(mergeToast(out.added, out.failed));
      } catch (e) {
        toast('Could not build the PDF: ' + (e instanceof Error ? e.message : String(e)), true);
      } finally {
        detailBusyRef.current = false;
        setDetailBusy(null);
      }
    })();
  }, [company, detail]);

  // ── render ───────────────────────────────────────────────────────────────────────────────────────

  if (signedIn === false) {
    return (
      <>
        <Banner isEmp={false} />
        <Panel>
          Not signed in on this origin. <a href={legacyUrl('hros.html')}>Sign in to HR OS</a>, then come back —
          the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
          already be signed in.
        </Panel>
      </>
    );
  }

  return (
    <>
      <Banner isEmp={isEmp} />
      {err ? <Panel>⚠️ {err}</Panel>
        : !claims || !me || !cfg || company === null ? <Panel><span className="spin"></span> Loading claims…</Panel>
        : (
          <>
            {note ? <Panel>{note}</Panel> : null}
            <HrExpenses
              claims={claims}
              me={me}
              companyName={company.tenant_name}
              page={page}
              scope={scope}
              sel={sel}
              onNav={(pg) => {
                if (pg === 'list') { setPage('list'); void refreshList(scope); return; }
                if (pg === 'form') { void openForm(); return; }
                goLegacy(pg);                    // dashboard / settings — see the banner
              }}
              onScope={onScope}
              onOpen={(id) => void openDetail(id)}
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
                // The two `prompt()`s stay native — so are hros.html:1854's, and a text prompt is not one
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

            {page === 'form' ? (
              <HrExpensesForm
                key={gen}
                form={form.current}
                cfg={cfg}
                items={items()}
                pending={files.current}
                scans={scans.current}
                today={today()}
                saving={saving}
                scanStatus={scanStatus}
                onClose={() => { setPage('list'); void refreshList(scope); }}
                onItemType={() => { syncForm(); repaint(); }}
                onItemMore={(i) => { syncForm(); const it = items()[i]; it._open = !it._open; repaint(); }}
                onItemDel={(i) => {
                  syncForm();
                  const list = items();
                  list.splice(i, 1);
                  if (!list.length) list.push(blankItem(cfg, ''));
                  repaint();
                }}
                onItemAdd={() => { syncForm(); items().push(blankItem(cfg, form.current.claim_date || '')); repaint(); }}
                onItemCalc={onItemCalc}
                onScanTrigger={onScanTrigger}
                onScanPickFile={onScanPickFile}
                onScanFile={onScanFile}
                onScanPreview={(i) => {
                  const sf = scans.current[i];
                  if (!sf) return;
                  try {
                    const u = URL.createObjectURL(sf);
                    window.open(u, '_blank');
                    setTimeout(() => URL.revokeObjectURL(u), 60000);
                  } catch { toast('Preview failed', true); }
                }}
                onScanRemove={(i) => { syncForm(); scans.current.splice(i, 1); repaint(); }}
                onPickReceipts={(input) => {
                  const picked = input.files ? Array.prototype.slice.call(input.files) as File[] : [];
                  if (!picked.length) return;
                  const r = pickReceipts(files.current, picked);
                  files.current = r.files;
                  if (r.refused.length) toast(tooBigMessage(r.refused), true);
                  syncForm();
                  repaint();
                }}
                onReceiptRemove={(i) => { files.current.splice(i, 1); syncForm(); repaint(); }}
                onSave={onSave}
              />
            ) : null}

            {page === 'detail' ? (
              loadingDetail || !detail
                ? <Panel><span className="spin"></span> Loading…</Panel>
                : (
                  <HrExpensesDetail
                    detail={detail}
                    isAdmin={!!me.isAdmin}
                    isViewer={false}
                    busy={detailBusy}
                    onBack={() => { setPage('list'); void refreshList(scope); }}
                    onDecide={onDecide}
                    onOverride={onOverride}
                    onMarkPaid={onMarkPaid}
                    onGlEdit={() => goLegacy(detail.claim.id)}
                    onPostXero={() => goLegacy(detail.claim.id)}
                    onFormAndReceipts={onFormAndReceipts}
                    onVoucher={onVoucher}
                    onEdit={onEdit}
                    onResubmit={onResubmit}
                    onAdjustAmount={onAdjustAmount}
                    onCancel={onCancel}
                  />
                )
            ) : null}
          </>
        )}

      {scanImg ? (
        <ScanModal
          img={scanImg}
          onCancel={() => setScanImg(null)}
          onUse={(attach, cc, qr) => {
            setScanImg(null);
            void (async () => {
              const b64 = await new Promise<string>((res) => cc.toBlob((b) => { void fileB64(b!).then(res); }, 'image/jpeg', 0.85));
              await scanProcess(attach, { b64, type: 'image/jpeg' }, qr);
            })();
          }}
        />
      ) : null}
    </>
  );
}

/** `M()` — hros.html:1268. The route needs it for `onItemCalc`'s imperative writes. */
const M = (n: unknown) =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel"><div className="muted" style={{ padding: '18px' }}>{children}</div></div>;
}

/**
 * The strangler is explicitly "both versions reachable and comparable side by side" — nothing was
 * deleted from hros.html and the legacy screen is still the one staff use. This says so on the page
 * rather than only in a PR description, and it must stay HONEST: v225 moved Submit and a claim's detail
 * across, so the list of what is still legacy shrank and this line shrank with it. An employee sees a
 * shorter list because Dashboard, Settings and the accounting export are admin-only and are not on
 * their tab bar at all (hros.html:1785).
 */
function Banner({ isEmp }: { isEmp: boolean }) {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React migration.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('hros.html')}#tab=expenses`}>hros.html · Reimbursement</a>, unchanged. This page renders
        the same data from the same session and is diffed against the same goldens. Claims, Submit and a claim&apos;s
        detail are here.{' '}
        {isEmp
          ? 'Nothing else on this screen is yours to reach.'
          : 'Still on the legacy screen: 📊 Dashboard, ⚙ Settings, the 📒 Accounting CSV export, changing a line’s GL account, and posting a claim to Xero.'}
      </div>
    </div>
  );
}
