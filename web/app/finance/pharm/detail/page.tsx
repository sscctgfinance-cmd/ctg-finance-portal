'use client';

// The route for the pharmacy PROFILE PAGE — `PHARM_ACTIVE !== null || PHARM_NEW` in the legacy, its
// own URL here. Everything impure lives here so src/finance-pharm-detail.tsx stays a pure function of
// its props.
//
// NESTED under the tab's own directory, like app/finance/wht/doc/: a sibling page is not a nav entry,
// and `web/tests/shell.test.tsx` checks `app/finance/`'s TOP-LEVEL directories against nav.ts's 22 tab
// ids. `?id=` opens a record; `?new=1` is `pharmNewStart()`, and `&name=` is the O2O preview's
// "add this pharmacy to the master" prefill (app.html:3134-3141).
//
// ── THE REFUSAL ───────────────────────────────────────────────────────────────────────────────────
// This page loads `pharmacy_list` itself — the legacy could rely on `PHARM_DATA` already being in
// memory, a URL cannot. So it inherits the same server-side gate the list has, and the SAME split the
// list route makes: portal.ts's `call()` throws on both a returned `{ok:false}` and a transport
// failure, so a `TypeError` (which only `fetch` itself raises) is the ⚠️ branch and everything else is
// the 🔒 refusal. Over-stating a refusal is the safe direction; rendering a refusal as a blank form
// with a Save button is not.
//
// ── THE FORM IS UNCONTROLLED AND READ BACK BY `data-k`, exactly as `pharmCollect()` does ──────────

import { useCallback, useEffect, useRef, useState } from 'react';

import { showConfirm } from '../../../../src/confirm';
import { pharmReachable } from '../../../../src/finance-pharm';
import FinancePharmDetail, {
  PharmLinkModal, pharmPatch, saveBody,
  type PharmacyDetail, type PharmField, type XeroContact,
} from '../../../../src/finance-pharm-detail';
import { call, legacyUrl, token } from '../../../../src/portal';

/** The one place a base path is read in this route — src/portal.ts is the one place it is defined. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export default function FinancePharmDetailPage() {
  const [all, setAll] = useState<PharmacyDetail[] | null>(null);
  const [editable, setEditable] = useState(false);
  const [id, setId] = useState<number | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [dirty, setDirty] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** `runOnce('pharm-save-btn','Saving…')` — app.html:6527. Last-write-wins, but a live button under a
   *  request in flight is the same shape the O2O Issue guard closes. */
  const [saving, setSaving] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // `PHARM_XERO_CONTACTS` — app.html:6681, cached for the session. `null` is "not fetched yet".
  const [contacts, setContacts] = useState<XeroContact[] | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [gen, setGen] = useState(0);
  /** `?name=` — the pharmacy the O2O preview could not find in the master list. */
  const [prefillName, setPrefillName] = useState('');
  const done = useRef(false);
  const linkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadList = useCallback(async () => {
    const r = await call<{ pharmacies?: PharmacyDetail[]; editable?: boolean }>({ api: 'pharmacy_list' });
    setAll(r.pharmacies || []);
    setEditable(!!r.editable);
    return r.pharmacies || [];
  }, []);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t || !pharmReachable()) return;
    const q = new URLSearchParams(location.search);
    const raw = q.get('id');
    setIsNew(q.get('new') === '1' || !raw);
    setId(raw ? Number(raw) : null);
    // `pharmNewStart()` opens straight into edit mode — app.html:6668.
    if (q.get('new') === '1' || !raw) setMode('edit');
    setPrefillName(q.get('name') || '');
    void loadList().catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof TypeError) setFailed(msg); else setRefused(msg || 'Failed to load');
    });
  }, [loadList]);

  // app.html:3134-3141 — the delegated `data-add-pharm` listener starts a new record and then writes
  // the name straight into the field and focuses it. The form is UNCONTROLLED and read back by
  // `data-k`, so seeding it the same way is what keeps `pharmCollect()` the only reader.
  //
  // `editable` is the load-bearing half of the gate: it is false until `pharmacy_list` returns, and
  // until then `isEdit` is false and the field is DISABLED — `.value` would stick (uncontrolled) but
  // `.focus()` silently no-ops on a disabled element, losing the legacy's focus step with nothing to
  // show for it. `done` runs it once, so a later render cannot overwrite what the operator has typed.
  useEffect(() => {
    if (!isNew || !prefillName || !editable || done.current) return;
    const n = document.querySelector<HTMLInputElement>('#pharm-form [data-k=name]');
    if (!n) return;
    done.current = true;
    n.value = prefillName;
    n.focus();
  }, [isNew, prefillName, editable]);

  const pharmacy = all && id != null ? (all.find((x) => x.id === id) || null) : null;
  const notFound = !!all && id != null && !pharmacy;

  /** `pharmCollect()` — app.html:6413. Reads `#pharm-form [data-k]`, checkbox as a 'true'/'false' STRING. */
  const collect = useCallback(() => {
    const fields: PharmField[] = [];
    document.querySelectorAll<HTMLInputElement>('#pharm-form [data-k]').forEach((el) => {
      fields.push({ k: el.dataset.k as string, type: el.type, value: el.value, checked: !!el.checked });
    });
    return pharmPatch(fields);
  }, []);

  /** `pharmSave()` — app.html:6422. */
  const onSave = useCallback(() => {
    if (saving) return;
    if (!editable) { setNotice('Admins only'); return; }
    setSaving(true);
    void (async () => {
      try {
        const body = saveBody(collect(), isNew ? null : id);
        const r = await call<{ id?: number }>({ api: 'pharmacy_save', id: body.id, patch: body.patch });
        setNotice('✓ Saved');
        setDirty(false);
        const list = await loadList();
        const next = r.id || id;
        setIsNew(false);
        setId(next ?? null);
        setMode('view');
        setGen((g) => g + 1);
        void list;
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    })();
  }, [editable, collect, isNew, id, loadList, saving]);

  /** `pharmDelete()` — app.html:6443. */
  const onDelete = useCallback(() => {
    if (!editable || id == null || !pharmacy) return;
    void (async () => {
      if (!await showConfirm('Delete pharmacy',
        'Delete pharmacy "' + (pharmacy.name || '') + '"? Any past O2O invoices in Xero are unaffected, but this pharmacy will no longer appear in the master list.',
        'Delete')) return;
      try {
        await call({ api: 'pharmacy_delete', id });
        location.href = `${BASE}/finance/pharm/`;
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [editable, id, pharmacy]);

  /** `pharmSetMode(mode)` — app.html:6674, including the discard confirm. */
  const onSetMode = useCallback(async (m: 'view' | 'edit') => {
    if (!editable && m === 'edit') return;
    if (mode === 'edit' && dirty && m === 'view') {
      if (!await showConfirm('Unsaved changes', 'You have unsaved changes. Discard?', 'Discard')) return;
      setDirty(false);
    }
    setMode(m);
    setGen((g) => g + 1);   // the form is re-materialised from state, as pharmRender() does
  }, [editable, mode, dirty]);

  /** `pharmCloseDetail()` — app.html:6669. */
  const onBack = useCallback(async () => {
    if (dirty && !await showConfirm('Unsaved changes', 'Discard unsaved changes?', 'Discard')) return;
    location.href = `${BASE}/finance/pharm/`;
  }, [dirty]);

  /** `pharmOpenLinkModal()` — app.html:6683. The contact list is fetched once, then cached. */
  const onLink = useCallback(() => {
    if (!editable) { setNotice('Admins only'); return; }
    if (id == null) { setNotice('Save the pharmacy first'); return; }
    void (async () => {
      try {
        if (!contacts) {
          const r = await call<{ contacts?: XeroContact[] }>({ api: 'pharmacy_xero_contacts' });
          setContacts(r.contacts || []);
        }
        setLinkSearch('');
        setLinkOpen(true);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [editable, id, contacts]);

  /** `pharmDoLink(contactId)` — app.html:6721. `null` unlinks; the legacy posts '' for it. */
  const onPick = useCallback((contactId: string | null) => {
    if (id == null) return;
    void (async () => {
      try {
        await call({ api: 'pharmacy_link_xero', id, contact_id: contactId || '' });
        setNotice(contactId ? '✓ Linked' : '✓ Unlinked');
        setLinkOpen(false);
        await loadList();
        setGen((g) => g + 1);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [id, loadList]);

  /** `_pharmLinkDebounced` — app.html:6719, the same 180ms. */
  const onLinkSearch = useCallback((v: string) => {
    if (linkTimer.current) clearTimeout(linkTimer.current);
    linkTimer.current = setTimeout(() => setLinkSearch(v), 180);
  }, []);

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
      {notice ? <div className="panel" style={{ marginBottom: '14px' }}><div className="muted" style={{ padding: '18px' }}>{notice}</div></div> : null}
      <FinancePharmDetail
        key={gen}
        pharmacy={pharmacy}
        isNew={isNew}
        mode={mode}
        editable={editable}
        refused={refused}
        failed={failed}
        notFound={notFound}
        onBack={onBack}
        onSetMode={onSetMode}
        onSave={onSave}
        saving={saving}
        onDelete={onDelete}
        onLink={onLink}
        onDirty={() => setDirty(true)}
      />
      {linkOpen ? (
        <PharmLinkModal
          pharmacyName={pharmacy?.name || ''}
          currentId={pharmacy?.xero_contact_id || null}
          contacts={contacts || []}
          search={linkSearch}
          onSearch={onLinkSearch}
          onPick={onPick}
          onClose={() => setLinkOpen(false)}
        />
      ) : null}
    </>
  );
}

function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('app.html')}#tab=pharm`}>app.html · Pharmacies</a>, unchanged.
        This page edits the same master record from the same session.
      </div>
    </div>
  );
}
