'use client';

// The route. Everything impure lives here — the session, the two loads, the six posts, the three
// confirmations, the FileReader, the double-submit lock and the printable window — so that
// src/finance-selfbill.tsx stays a pure function of its props and can be diffed against the legacy
// golden. Same split as app/finance/approvals/page.tsx.
//
// `selfbill` IS on `render(t)`'s `asyncTabs` list (app.html:1504): `renderSelfbill()` cannot paint
// before `individuals_list` and `sbi_list` both resolve, so this route has a real load step and the
// screen's `list={null}` panel is what fills it.
//
// THE GATE IS THE ADMIN ONE — app.html:1429, `!canManage`, with the legacy's own comment saying why:
// this screen CREATES PAYMENTS. Not the feature flag four of its neighbours fall through to. The server
// is stricter still (every `sbi_*` / `individual_*` handler requires `superAdmin`), so this is tab
// visibility rather than the boundary — but the page refuses to LOAD on a false, not merely to render,
// because the payees list alone is a table of individuals' IC numbers and bank accounts.
//
// THE THREE CONFIRMATIONS are the browser's `confirm()` in the legacy (app.html:4418, :4419, :4421),
// not `showConfirm()`. They go through the ported dialog here anyway — one control for every question
// the app asks — with their wording copied verbatim: an operator who has learned "Void this draft?"
// should not meet a different question here.
//
// THE FORM IS READ BACK OUT OF THE DOM by the same `sbi_*` and `pf_*` ids the legacy uses, which is why
// src/ keeps them and keeps the inputs uncontrolled. `sbiPickCompany()` and `sbiPickPayee()` fill blank
// boxes only (`if(e&&!e.value)`), so they are mirrored here as direct DOM writes rather than as state —
// turning them into state would overwrite what the operator had already typed.

import { useCallback, useEffect, useRef, useState } from 'react';

import FinanceSelfbill, {
  invoiceBody, invoiceDocHtml, payeeBody, saveRefusal, selfbillReachable,
  type Account, type Company, type Invoice, type InvoiceRow, type Line, type LineKey,
  type Payee, type Perms,
} from '../../../src/finance-selfbill';
import { showConfirm } from '../../../src/confirm';
import { call, legacyUrl, token } from '../../../src/portal';

/** `todayLocalISO()` — app.html:1259. The +8h MYT date, as a pure read of the real clock. */
function todayLocalISO(): string {
  const d = new Date(Date.now() + 8 * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

const blankLine = (): Line => ({ description: '', qty: 1, unit_price: 0, amount: 0 });

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';

export default function FinanceSelfbillPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [list, setList] = useState<InvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [showPayees, setShowPayees] = useState(false);
  const [payeeForm, setPayeeForm] = useState<Partial<Payee> | null>(null);
  const [form, setForm] = useState<Invoice | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editSst, setEditSst] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [whtType, setWhtType] = useState('none');
  const [customRate, setCustomRate] = useState<string>('');
  const [saving, setSaving] = useState(false);

  /** `SBI.lines` is mutated in place by the legacy's `oninput`; a ref keeps the same read-at-save-time. */
  const linesRef = useRef<Line[]>([]);
  linesRef.current = lines;
  /** `sbi_class` / `sbi_wht`'s `dataset.touched` — app.html:3556. */
  const touched = useRef({ cls: false, wht: false });

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    void call<Perms & { companies?: Company[] }>({ api: 'my_perms' })
      .then((p) => {
        setPerms(p);
        if (!selfbillReachable(p)) return;
        // `COMPANIES` — app.html:7531, the Xero orgs `{api:'me'}` returns, which is also where the
        // chrome's company picker comes from (app/finance/layout.tsx). Fetched here rather than read
        // off the layout because the layout does not pass it down, and this screen needs the NAME for
        // the Company column and for the printable invoice's buyer block.
        return Promise.all([
          call<{ companies?: Company[] }>({ api: 'me' }).catch(() => ({ companies: [] })),
          call<{ individuals?: Payee[] }>({ api: 'individuals_list' }),
          call<{ invoices?: InvoiceRow[] }>({ api: 'sbi_list' }),
        ]).then(([c, a, b]) => {
          setCompanies(c?.companies || []);
          setPayees(a?.individuals || []);
          setList(b?.invoices || []);
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const reload = useCallback(async () => {
    const b = await call<{ invoices?: InvoiceRow[] }>({ api: 'sbi_list' });
    setList(b?.invoices || []);
    setForm(null); setEditId(null);
  }, []);

  const reloadPayees = useCallback(async () => {
    const a = await call<{ individuals?: Payee[] }>({ api: 'individuals_list' });
    setPayees(a?.individuals || []);
  }, []);

  // `sbiLoadAccounts()` — app.html:4453.
  const loadAccounts = useCallback(async (tenant: string) => {
    if (!tenant) return;
    try {
      const r = await call<{ ok?: boolean; accounts?: Account[] }>({ api: 'sbi_accounts', tenant });
      setAccounts((r && r.ok && r.accounts) || []);
    } catch { setAccounts([]); }
  }, []);

  // `sbiNewInvoice()` / `sbiEdit()` — app.html:4291-4292.
  const onNewInvoice = useCallback(() => {
    setEditId(null); setEditSst(0); setLines([blankLine()]); setAccounts([]);
    setWhtType('none'); setCustomRate(''); touched.current = { cls: false, wht: false };
    setForm({ invoice_date: todayLocalISO() });
  }, []);

  const onEdit = useCallback((id: number) => {
    void (async () => {
      const r = await call<{ invoice?: Invoice }>({ api: 'sbi_get', id });
      if (!r || !r.invoice) { setErr('Not found'); return; }
      const inv = r.invoice;
      setEditId(id); setEditSst(Number(inv.sst_amount) || 0);
      setLines(inv.line_items && inv.line_items.length ? inv.line_items : [blankLine()]);
      setWhtType(inv.wht_type || 'none');
      setCustomRate(inv.wht_type === 'custom' && inv.wht_rate != null ? String(inv.wht_rate) : '');
      touched.current = { cls: false, wht: false };
      setAccounts([]);
      setForm(inv);
      if (inv.tenant_id) void loadAccounts(inv.tenant_id);
    })();
  }, [loadAccounts]);

  // `sbiPickCompany()` — app.html:4344. Fills only what is still blank, exactly as the legacy does.
  const onPickCompany = useCallback(() => {
    const t = val('sbi_co');
    if (!t) return;
    void (async () => {
      const r = await call<{ buyer?: Record<string, string>; has_info?: boolean }>({ api: 'sbi_buyer', tenant: t });
      if (r && r.buyer) {
        const set = (id: string, v: string) => {
          const e = document.getElementById(id) as HTMLInputElement | null;
          if (e) e.value = v || '';
        };
        set('sbi_bname', r.buyer.name); set('sbi_bssm', r.buyer.ssm); set('sbi_btin', r.buyer.tin);
        set('sbi_bsst', r.buyer.sst); set('sbi_baddr', r.buyer.address);
      }
      await loadAccounts(t);
    })();
  }, [loadAccounts]);

  // `sbiPickPayee()` — app.html:4353. Blank boxes only: it must not overwrite a typed-over account.
  const onPickPayee = useCallback(() => {
    const id = parseInt(val('sbi_payee'), 10);
    if (!id) return;
    const p = payees.find((x) => x.id === id);
    if (!p) return;
    const set = (fid: string, v: unknown) => {
      const e = document.getElementById(fid) as HTMLInputElement | null;
      if (e && !e.value) e.value = v == null ? '' : String(v);
    };
    set('sbi_bank_name', p.bank_name); set('sbi_bank_holder', p.name); set('sbi_bank_acct', p.bank_account);
  }, [payees]);

  // `sbiPtypeChange()` — app.html:3554.
  const onPtypeChange = useCallback(() => {
    const pt = val('sbi_ptype');
    if (!touched.current.cls) {
      const cls = document.getElementById('sbi_class') as HTMLSelectElement | null;
      if (cls) cls.value = pt === 'commission' ? '037' : '036';
    }
    if (!touched.current.wht) setWhtType(pt === 'commission' ? 's107d_2' : 'none');
  }, []);

  const onWhtChange = useCallback(() => {
    touched.current.wht = true;
    setWhtType(val('sbi_wht'));
    setCustomRate(val('sbi_wht_rate'));
  }, []);

  const onLineChange = useCallback((i: number, k: LineKey, v: string) => {
    setLines((ls) => ls.map((l, x) => {
      if (x !== i) return l;
      if (k === 'description') return { ...l, description: v };
      // app.html:4361 — `parseFloat(this.value)||0`, and typing an Amount sets `manual`.
      const n = parseFloat(v) || 0;
      return k === 'amount' ? { ...l, amount: n, manual: true } : { ...l, [k]: n };
    }));
  }, []);

  const onAddLine = useCallback(() => setLines((ls) => ls.concat(blankLine())), []);
  const onRmLine = useCallback((i: number) => setLines((ls) => {
    const next = ls.filter((_l, x) => x !== i);
    return next.length ? next : [blankLine()];
  }), []);

  // `sbiFilesRead()` — app.html:4384, including `upTooBig()`'s 10 MB ceiling (app.html:4381).
  const readFiles = useCallback(async (): Promise<{ name: string; mime: string; b64: string }[] | null> => {
    const inp = document.getElementById('sbi_files') as HTMLInputElement | null;
    const files = inp && inp.files ? Array.from(inp.files) : [];
    if (!files.length) return [];
    const big = files.find((f) => f.size > 10 * 1024 * 1024);
    if (big) {
      setErr(big.name + ' is ' + (big.size / 1048576).toFixed(1) + ' MB — the attachment limit is 10 MB. Compress it or scan at a lower resolution.');
      return null;
    }
    return Promise.all(files.map((file) => new Promise<{ name: string; mime: string; b64: string }>((res) => {
      const rd = new FileReader();
      rd.onload = () => res({ name: file.name, mime: file.type, b64: String(rd.result).split(',')[1] });
      rd.onerror = () => res({ name: file.name, mime: file.type, b64: '' });
      rd.readAsDataURL(file);
    })));
  }, []);

  // `sbiSaveOnce()` — app.html:4413. The lock is real: a double-click created TWO invoices.
  const onSave = useCallback(() => {
    if (saving) return;
    const wt = val('sbi_wht');
    const rate = wt === 'custom'
      ? (parseFloat(val('sbi_wht_rate')) || 0)
      : ({ none: 0, s107d_2: 2, nr_10: 10 } as Record<string, number>)[wt] || 0;
    const f = {
      editId,
      tenant_id: val('sbi_co'), payee: val('sbi_payee'),
      buyer_name: val('sbi_bname'), buyer_ssm: val('sbi_bssm'), buyer_tin: val('sbi_btin'),
      buyer_sst: val('sbi_bsst'), buyer_address: val('sbi_baddr'),
      invoice_date: val('sbi_date'), due_date: val('sbi_due'),
      payment_type: val('sbi_ptype'), classification_code: val('sbi_class'),
      bank_name: val('sbi_bank_name'), bank_account: val('sbi_bank_acct'), bank_holder: val('sbi_bank_holder'),
      lines: linesRef.current,
      wht_type: wt, wht_rate: rate,
      gl_account: val('sbi_gl'), wht_gl_account: val('sbi_whtgl'),
      sst_amount: editSst, notes: val('sbi_notes'), new_attachments: [] as unknown[],
    };
    const refusal = saveRefusal(f);
    if (refusal) { setErr(refusal); return; }
    setSaving(true);
    void (async () => {
      try {
        const files = await readFiles();
        if (files === null) return;   // an attachment was over the limit; the message is already up
        const r = await call<{ ok?: boolean; error?: string; invoice?: InvoiceRow }>(
          invoiceBody({ ...f, new_attachments: files }));
        if (r && r.ok) { setErr(null); await reload(); }
        else setErr((r && r.error) || 'Save failed');
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally { setSaving(false); }
    })();
  }, [saving, editId, editSst, readFiles, reload]);

  const onSavePayee = useCallback(() => {
    const g = (k: string) => val('pf_' + k).trim();
    const p = {
      id: val('pf_id') ? Number(val('pf_id')) : null,
      name: g('name'), id_type: val('pf_id_type'), id_no: g('id_no'), tin: g('tin'),
      phone: g('phone'), email: g('email'), address: g('address'),
      bank_name: g('bank_name'), bank_account: g('bank_account'),
      default_payment_type: val('pf_ptype'),
    };
    if (!p.name) { setErr('Name is required'); return; }
    void (async () => {
      const r = await call<{ ok?: boolean; error?: string }>(payeeBody(p));
      if (r && r.ok) { setErr(null); setPayeeForm(null); await reloadPayees(); }
      else setErr((r && r.error) || 'Save failed');
    })();
  }, [reloadPayees]);

  const onDeletePayee = useCallback((id: number) => {
    void (async () => {
      if (!await showConfirm('Delete payee', 'Delete this payee?', 'Delete')) return;
      const r = await call<{ ok?: boolean; soft?: boolean; error?: string }>({ api: 'individual_delete', id });
      if (r && r.ok) { setErr(null); await reloadPayees(); } else setErr((r && r.error) || 'Failed');
    })();
  }, [reloadPayees]);

  const onApprove = useCallback((id: number) => {
    void (async () => {
      if (!await showConfirm('Approve for payment', 'Approve this invoice for payment?', 'Approve', 'p')) return;
      const r = await call<{ ok?: boolean; error?: string }>({ api: 'sbi_approve', id });
      if (r && r.ok) { setErr(null); await reload(); } else setErr((r && r.error) || 'Failed');
    })();
  }, [reload]);

  const onVoid = useCallback((id: number) => {
    void (async () => {
      if (!await showConfirm('Void draft', 'Void this draft?', 'Void')) return;
      const r = await call<{ ok?: boolean; error?: string }>({ api: 'sbi_void', id });
      if (r && r.ok) { setErr(null); await reload(); } else setErr((r && r.error) || 'Failed');
    })();
  }, [reload]);

  const onPostXero = useCallback((id: number, posted: boolean) => {
    // app.html:4421 — the two questions are different acts and the legacy asks the right one.
    const msg = posted
      ? 'Set the Reference and attach the invoice PDF to the existing Xero bill?'
      : 'Post this invoice to Xero as a SUBMITTED bill (Awaiting Approval)? Payment stays manual.';
    void (async () => {
      if (!await showConfirm(posted ? 'Attach PDF to the Xero bill' : 'Post to Xero', msg,
        posted ? 'Attach' : 'Post', 'p')) return;
      const r = await call<{ ok?: boolean; error?: string }>({ api: 'sbi_post_xero', id });
      if (r && r.ok) { setErr(null); await reload(); } else setErr((r && r.error) || 'Xero post failed');
    })();
  }, [reload]);

  // `sbiView()` — app.html:4431. The document is built in src/ so the test can pin it.
  const onView = useCallback((id: number) => {
    void (async () => {
      const r = await call<{ invoice?: Invoice }>({ api: 'sbi_get', id });
      if (!r || !r.invoice) { setErr('Not found'); return; }
      const w = window.open('', '_blank');
      if (!w) { setErr('Allow pop-ups to view/print'); return; }
      w.document.write(invoiceDocHtml(r.invoice, companies));
      w.document.close();
    })();
  }, [companies]);

  return (
    <>
      <Banner />
      {err ? <Panel>⚠️ {err}</Panel> : null}
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : perms !== null && !selfbillReachable(perms)
          ? <Panel>
              Personal (self-billed) invoices is administrators only — it creates payments to individuals and
              lists their bank accounts. Ask an administrator if you need access.
            </Panel>
        : perms === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : <FinanceSelfbill
            companies={companies} payees={payees} list={list} error={error}
            showPayees={showPayees} payeeForm={payeeForm} form={form} editId={editId}
            lines={lines} accounts={accounts} whtType={whtType} customRate={customRate} saving={saving}
            onTogglePayees={() => setShowPayees((v) => !v)}
            onNewInvoice={onNewInvoice}
            onView={onView} onEdit={onEdit} onApprove={onApprove} onPostXero={onPostXero} onVoid={onVoid}
            onPayeeForm={(id) => setPayeeForm(id ? (payees.find((p) => p.id === id) || {}) : {})}
            onDeletePayee={onDeletePayee} onSavePayee={onSavePayee} onClosePayeeForm={() => setPayeeForm(null)}
            onCloseForm={() => { setForm(null); setEditId(null); }}
            onPickCompany={onPickCompany} onPickPayee={onPickPayee} onPtypeChange={onPtypeChange}
            onClassTouched={() => { touched.current.cls = true; }}
            onWhtChange={onWhtChange}
            onLineChange={onLineChange} onAddLine={onAddLine} onRmLine={onRmLine} onSave={onSave}
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
        <a href={`${legacyUrl('app.html')}#tab=selfbill`}>app.html · Personal Invoices</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
