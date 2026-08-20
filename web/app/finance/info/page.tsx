'use client';

// The route. Everything impure lives here — the session, the three loads, the save, the uploads, the
// clipboard, the print window and the scroll — so that src/finance-info.tsx stays a pure function of
// its props and can be diffed against the legacy golden. Same split as the other 21 Finance screens;
// see app/finance/wht/page.tsx for the convention.
//
// ── THE GATE ──────────────────────────────────────────────────────────────────────────────────────
// app.html:1424 shows this tab to EVERYONE and the server decides (`portal_company_info_get` returns
// the companies this login may see and an `editable` flag; `company_info_save` wants `superAdmin`,
// finance.ts:2474). So `infoReachable()` is `true` and the branch carrying the security meaning is the
// REFUSAL — see below, and `finance.pharm`'s route for the same reasoning.
//
// ── THE ONE PLACE THIS ROUTE IS NOT BYTE-EXACT ────────────────────────────────────────────────────
// `renderInfo()` distinguishes a RETURNED `{ok:false}` (→ 🔒) from a THROW (→ ⚠️), because common.js's
// `call()` only throws on a non-2xx. `web/src/portal.ts` throws on both and this route may not edit
// it, so the split is made on what is still distinguishable: a transport failure surfaces as the
// TypeError `fetch` itself raises. A non-2xx carrying a server message lands as 🔒 rather than ⚠️,
// which is the safe direction — it can only over-state a refusal, never render one as an empty screen.
//
// ── WHAT IS MIRRORED RATHER THAN "IMPROVED" ───────────────────────────────────────────────────────
// The two `confirm()`s (discarding unsaved edits, deleting a folder or a document) and the `prompt()`
// for a new folder name are the browser's own, exactly as app.html uses them: `showConfirm()` is one of
// the four legacy modals that were not migrated, and silently dropping the only thing between a
// mis-click and a deleted folder is not a migration detail. Same call `finance.approvals` made.

import { useCallback, useEffect, useRef, useState } from 'react';

import FinanceInfo, {
  infoFolderById, infoFolderPath, infoReachable, printDocHtml, saveBody, savePatch,
  type FolderId, type InfoCompany, type InfoDoc, type InfoFolder,
} from '../../../src/finance-info';
import { call, legacyUrl, token } from '../../../src/portal';

/** `renderInfo()` groups both lists by tenant before rendering — app.html:5532-5533. */
function byTenant<T extends { tenant_id: string }>(rows: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[r.tenant_id] ||= []).push(r);
  return out;
}

export default function FinanceInfoPage() {
  const [companies, setCompanies] = useState<InfoCompany[] | null>(null);
  const [editable, setEditable] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const [docs, setDocs] = useState<Record<string, InfoDoc[]>>({});
  const [folders, setFolders] = useState<Record<string, InfoFolder[]>>({});
  const [folderActive, setFolderActive] = useState<Record<string, FolderId | null>>({});
  const [refused, setRefused] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  /** `now` is read ONCE per mount and handed to the component — it never reads the clock itself. */
  const [now] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const form = useRef<HTMLDivElement | null>(null);

  const loadDocs = useCallback(async () => {
    // app.html:5531 — both lists for ALL accessible tenants, so the sidebar indicator and the
    // cross-company search work. Failures here are swallowed, exactly as the legacy's try/catch does:
    // the company record is still worth showing without its attachments.
    try {
      const [dr, fr] = await Promise.all([
        call<{ documents?: InfoDoc[] }>({ api: 'company_doc_list' }),
        call<{ folders?: InfoFolder[] }>({ api: 'company_folder_list' }),
      ]);
      setDocs(byTenant(dr.documents || []));
      setFolders(byTenant(fr.folders || []));
    } catch (_e) { /* app.html:5535 — the same empty catch */ }
  }, []);

  const loadInfo = useCallback(async () => {
    const r = await call<{ companies?: InfoCompany[]; editable?: boolean }>({ api: 'company_info_get' });
    const list = r.companies || [];
    setCompanies(list);
    setEditable(!!r.editable);
    if (!r.editable) setMode('view');          // app.html:5525
    setActive((a) => (a && list.some((c) => c.tenant_id === a) ? a : (list[0]?.tenant_id ?? null)));
    return list;
  }, []);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t || !infoReachable()) return;
    void loadInfo()
      .then((list) => { if (list.length) void loadDocs(); })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof TypeError) setFailed(msg); else setRefused(msg || 'Failed to load');
      });
  }, [loadInfo, loadDocs]);

  /** `_infoSearchRender` — app.html:5871, the same 180ms debounce. */
  const onSearchInput = useCallback((v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSearch(v), 180);
  }, []);

  /** `infoSetMode()` — app.html:5896, including the discard confirmation. */
  const onSetMode = useCallback((m: 'view' | 'edit') => {
    if (!editable && m === 'edit') return;
    if (mode === 'edit' && dirty && m === 'view') {
      if (!confirm('You have unsaved changes. Discard?')) return;
      setDirty(false);
    }
    setMode(m);
  }, [editable, mode, dirty]);

  /** `infoSwitch()` — app.html:6089. */
  const onSwitch = useCallback((tid: string) => {
    if (mode === 'edit' && dirty) {
      if (!confirm('You have unsaved changes on this company. Switch and discard?')) return;
      setDirty(false);
    }
    setActive(tid);
  }, [mode, dirty]);

  /** `infoCopy()` — app.html:5904, including the ✓ flash on the button that was clicked. */
  const onCopy = useCallback((text: string, btn: unknown) => {
    void navigator.clipboard.writeText(String(text || '')).then(() => {
      const el = btn as HTMLElement | null;
      if (!el) return;
      const old = el.textContent;
      el.textContent = '✓'; el.style.color = 'var(--green-soft)';
      setTimeout(() => { el.textContent = old; el.style.color = ''; }, 1000);
    });
  }, []);

  const scrollTo = useCallback((elementId: string) => {
    document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  /** `infoJump()` — app.html:5889: switch company, clear the box, then highlight the section. */
  const onJumpHit = useCallback((tid: string, sectionId: string) => {
    setActive(tid);
    setSearch('');
    const box = document.getElementById('info-search') as HTMLInputElement | null;
    if (box) box.value = '';
    setTimeout(() => {
      const el = document.getElementById('info-sec-' + sectionId);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.style.boxShadow = '0 0 0 2px var(--coral-soft)';
      setTimeout(() => { el.style.boxShadow = ''; }, 1800);
    }, 80);
  }, []);

  /** `infoPrint()` — app.html:5911. The document itself is printDocHtml(); this is only the window. */
  const onPrint = useCallback(() => {
    const c = companies?.find((x) => x.tenant_id === active);
    if (!c) return;
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) { alert('Pop-up blocked'); return; }
    // `new Date().toISOString().slice(0,10)` — UTC, exactly as app.html:5914. NOT todayLocalISO().
    w.document.write(printDocHtml(c, docs, new Date().toISOString().slice(0, 10)));
    w.document.close();
    setTimeout(() => w.print(), 250);
  }, [companies, active, docs]);

  /** `infoFolderOpen()` — app.html:5693. */
  const onFolderOpen = useCallback((fid: FolderId | null) => {
    if (!active) return;
    setFolderActive((m) => ({ ...m, [active]: fid || null }));
  }, [active]);

  /** `infoFolderCreate()` — app.html:5694. */
  const onFolderCreate = useCallback((parentId: FolderId | null) => {
    if (!editable || !active) { alert('Admins only'); return; }
    const all = folders[active] || [];
    const name = prompt(parentId
      ? 'New folder name (inside "' + infoFolderPath(all, parentId).replace(/^\/ /, '') + '"):'
      : 'New top-level folder name:');
    if (name === null) return;
    const trimmed = String(name || '').trim();
    if (!trimmed) { alert('Name required'); return; }
    void call<{ id?: FolderId }>({ api: 'company_folder_create', tenant: active, parent_id: parentId || undefined, name: trimmed })
      .then(async (r) => {
        await loadDocs();
        if (r.id != null) setFolderActive((m) => ({ ...m, [active]: r.id as FolderId }));
      })
      .catch((e) => alert(e instanceof Error ? e.message : String(e)));
  }, [editable, active, folders, loadDocs]);

  /**
   * `infoFolderDelete()` — app.html:5711, including the two DIFFERENT confirmations.
   *
   * The counting question is asked of FRESH data (the legacy re-fetches first, app.html:5715): another
   * admin may have uploaded into this folder since the page loaded, and a cascade delete decided from a
   * stale count destroys files the operator was never warned about.
   */
  const onFolderDelete = useCallback((fid: FolderId) => {
    if (!editable || !active) return;
    void (async () => {
      let fs = folders[active] || [];
      let ds = docs[active] || [];
      try {
        const [fr, dr] = await Promise.all([
          call<{ folders?: InfoFolder[] }>({ api: 'company_folder_list' }),
          call<{ documents?: InfoDoc[] }>({ api: 'company_doc_list' }),
        ]);
        const nf = byTenant(fr.folders || []); const nd = byTenant(dr.documents || []);
        setFolders(nf); setDocs(nd);
        fs = nf[active] || []; ds = nd[active] || [];
      } catch (_e) { /* app.html:5721 — the same empty catch */ }
      const folder = infoFolderById(fs, fid);
      if (!folder) return;
      const subfolders = fs.filter((f) => f.parent_id === fid).length;
      const filesInside = ds.filter((d) => d.folder_id === fid).length;
      let cascade = false;
      if (subfolders > 0 || filesInside > 0) {
        if (!confirm('Folder "' + folder.name + '" contains ' + filesInside + ' file(s) and ' + subfolders + ' subfolder(s). Delete it AND everything inside? This cannot be undone.')) return;
        cascade = true;
      } else if (!confirm('Delete folder "' + folder.name + '"?')) return;
      try {
        await call({ api: 'company_folder_delete', folder_id: fid, cascade });
        setFolderActive((m) => (m[active] === fid ? { ...m, [active]: folder.parent_id || null } : m));
        await loadDocs();
      } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    })();
  }, [editable, active, folders, docs, loadDocs]);

  /** `infoDocMove()` — app.html:5742. A blank value means "/ (root)". */
  const onDocMove = useCallback((docId: FolderId, folderIdStr: string) => {
    if (!editable) return;
    const folderId = folderIdStr ? Number(folderIdStr) : null;
    void call({ api: 'company_doc_move', doc_id: docId, folder_id: folderId })
      .then(() => loadDocs())
      .catch((e) => alert(e instanceof Error ? e.message : String(e)));
  }, [editable, loadDocs]);

  /** `infoDocDownload()` — app.html:5806. The server hands back a signed URL. */
  const onDocDownload = useCallback((docId: FolderId) => {
    void call<{ url?: string }>({ api: 'company_doc_download', doc_id: docId })
      .then((r) => { if (r.url) window.open(r.url, '_blank'); else alert('Could not download'); })
      .catch((e) => alert(e instanceof Error ? e.message : String(e)));
  }, []);

  /** `infoDocDelete()` — app.html:5818. */
  const onDocDelete = useCallback((docId: FolderId) => {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    void call({ api: 'company_doc_delete', doc_id: docId })
      .then(() => loadDocs())
      .catch((e) => alert(e instanceof Error ? e.message : String(e)));
  }, [loadDocs]);

  /**
   * `infoDocUpload()` — app.html:5766, reading the same five control ids the component writes.
   *
   * The 20 MB refusal and the "pick a file first" refusal both happen BEFORE the FileReader, exactly as
   * the legacy's do — the same shape `chooseUpload()` has on finance.upload.
   */
  const onDocUpload = useCallback(() => {
    if (!active) return;
    const status = document.getElementById('info-doc-status');
    const say = (text: string, colour: string) => { if (status) { status.textContent = text; status.style.color = colour; } };
    const fileEl = document.getElementById('info-doc-file') as HTMLInputElement | null;
    const file = fileEl?.files?.[0];
    if (!file) { say('Pick a file first', 'var(--red-soft)'); return; }
    if (file.size > 20 * 1024 * 1024) { say('File too large (max 20 MB)', 'var(--red-soft)'); return; }
    const category = (document.getElementById('info-doc-category') as HTMLSelectElement).value;
    const title = (document.getElementById('info-doc-title') as HTMLInputElement).value.trim();
    const expiry = (document.getElementById('info-doc-expiry') as HTMLInputElement).value;
    const folderEl = document.getElementById('info-doc-folder') as HTMLSelectElement | null;
    const folder_id = folderEl && folderEl.value ? Number(folderEl.value) : undefined;
    say('Uploading…', 'var(--text-soft)');
    void (async () => {
      try {
        const b64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result || '').split(',').pop() || '');
          r.onerror = () => rej(new Error('Read failed'));
          r.readAsDataURL(file);
        });
        await call({
          api: 'company_doc_upload', tenant: active,
          file_name: file.name, content_type: file.type || 'application/octet-stream',
          content_base64: b64, category, title, expiry_date: expiry || undefined, folder_id,
        });
        say('✓ Uploaded', 'var(--green-soft)');
        await loadDocs();
        if (folder_id) setFolderActive((m) => ({ ...m, [active]: folder_id }));
        setTimeout(() => scrollTo('info-sec-docs'), 50);
      } catch (e) {
        say('✗ ' + (e instanceof Error ? e.message : String(e)), 'var(--red-soft)');
      }
    })();
  }, [active, loadDocs, scrollTo]);

  /** `infoRowAdd()` / `infoRowDel()` — app.html:6116/:6121. Both mutate the loaded record in place. */
  const editRows = useCallback((key: string, fn: (rows: Record<string, unknown>[]) => Record<string, unknown>[]) => {
    setCompanies((list) => (list || []).map((c) =>
      (c.tenant_id === active ? { ...c, [key]: fn(((c[key] as Record<string, unknown>[]) || []).slice()) } : c)));
  }, [active]);

  const onRowAdd = useCallback((key: string, colKeys: string[]) => {
    const blank: Record<string, unknown> = {};
    colKeys.forEach((k) => { blank[k] = ''; });
    editRows(key, (rows) => [...rows, blank]);
  }, [editRows]);

  const onRowDel = useCallback((key: string, idx: number) => {
    editRows(key, (rows) => { rows.splice(idx, 1); return rows; });
  }, [editRows]);

  /**
   * `infoSave()` — app.html:6126, with `infoCollect()` (app.html:6097) reading the form back out of the
   * DOM by the same `data-k` / `data-sk` / `data-list` attributes the component writes.
   *
   * That read cannot be lifted into `src/` — it IS the DOM — but what it produces can be, and is:
   * `savePatch()` normalises the two capital fields and the incorporation date, and `saveBody()`
   * refuses a blank tenant. Both are pinned in the screen's test, where no golden could reach them.
   */
  const onSave = useCallback(() => {
    if (!editable || !active) return;
    const root = form.current;
    if (!root) return;
    const raw: Record<string, unknown> = {};
    root.querySelectorAll<HTMLInputElement>('#info-form [data-k]').forEach((el) => { raw[el.dataset.k as string] = el.value; });
    root.querySelectorAll<HTMLTableElement>('#info-form [data-list]').forEach((tbl) => {
      const rows: Record<string, string>[] = [];
      tbl.querySelectorAll('tbody tr').forEach((tr) => {
        const obj: Record<string, string> = {};
        tr.querySelectorAll<HTMLInputElement>('input[data-sk]').forEach((inp) => {
          const v = inp.value.trim();
          if (v) obj[inp.dataset.sk as string] = v;
        });
        if (Object.keys(obj).length) rows.push(obj);
      });
      raw[tbl.dataset.list as string] = rows;
    });
    const status = document.getElementById('info-save-status');
    if (status) status.textContent = '';
    void call(saveBody(active, savePatch(raw)))
      .then(async () => {
        if (status) { status.textContent = '✓ Saved'; status.style.color = 'var(--green-soft)'; }
        setDirty(false);
        await loadInfo();
      })
      .catch((e) => {
        if (status) { status.textContent = '✗ ' + (e instanceof Error ? e.message : String(e)); status.style.color = 'var(--red-soft)'; }
      });
  }, [editable, active, loadInfo]);

  /** app.html:6021 — the first keystroke anywhere in the form arms the unsaved-changes warning. */
  const onInput = useCallback(() => {
    if (dirty) return;
    setDirty(true);
    const status = document.getElementById('info-save-status');
    if (status) status.textContent = '⚠ unsaved changes';
  }, [dirty]);

  if (signedIn === false) {
    return (
      <>
        <Banner />
        <div className="panel"><div className="muted" style={{ padding: '18px' }}>
          Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
          the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
          already be signed in.
        </div></div>
      </>
    );
  }

  return (
    <>
      <Banner />
      {/* A plain div, not a <main>: the shell owns that. It is what `onSave` reads the form back out of. */}
      <div ref={form} onInput={mode === 'edit' && editable ? onInput : undefined}>
        <FinanceInfo
          companies={companies}
          active={active}
          editable={editable}
          mode={mode}
          search={search}
          dirty={dirty}
          docs={docs}
          folders={folders}
          folderActive={folderActive}
          now={now}
          refused={refused}
          failed={failed}
          onSearchInput={onSearchInput}
          onSetMode={onSetMode}
          onPrint={onPrint}
          onSwitch={onSwitch}
          onJump={scrollTo}
          onJumpHit={onJumpHit}
          onCopy={onCopy}
          onFolderOpen={onFolderOpen}
          onFolderCreate={onFolderCreate}
          onFolderDelete={onFolderDelete}
          onDocMove={onDocMove}
          onDocDownload={onDocDownload}
          onDocDelete={onDocDelete}
          onDocUpload={onDocUpload}
          onRowAdd={onRowAdd}
          onRowDel={onRowDel}
          onSave={onSave}
        />
      </div>
    </>
  );
}

function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('app.html')}#tab=info`}>app.html · Company Info</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
