'use client';

// The route. Everything impure lives here — the session, the fetches, the DOM reads, the state — so
// that src/finance-qinv.tsx stays a pure function of its props and can be diffed against the legacy
// golden. Same split as app/finance/wht/page.tsx; the Finance route convention is documented there.
//
// `qinv` is NOT on `render(t)`'s `asyncTabs` list (app.html:1504) — it paints from what it already has
// and only fetches when a company is picked — so, unlike the WHT route, there is no load step in front
// of the screen. `my_perms` is still awaited, because that is the gate.
//
// THE FORM IS READ OUT OF THE DOM, exactly as `qiCollect()` and `qiCreate()` do, by the same ids and
// classes. That is not laziness: those names ARE the contract (the screen's test pins them against
// app.html at run time), and mirroring the read keeps the React screen's behaviour identical to the
// legacy one it sits beside rather than subtly different in what counts as a blank line.

import { useCallback, useEffect, useRef, useState } from 'react';

import FinanceQinv, {
  collect, invoiceBody, qinvReachable, todayLocalISO,
  type Company, type Perms, type QinvMeta, type QinvOut, type RawLine,
} from '../../../src/finance-qinv';
import { showConfirm } from '../../../src/confirm';
import { mytISO } from '../../../../myt.js';
import { registerScreenSave } from '../../../src/finance-save';
import { call, legacyUrl, token } from '../../../src/portal';

/** `QINV_META_CACHE` / `QINV_META_TTL` — app.html:4661. Per tenant, because Xero's Items call is slow. */
const META_TTL = 5 * 60 * 1000;

export default function FinanceQinvPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [meta, setMeta] = useState<QinvMeta>({});
  const [lines, setLines] = useState(1);            // `renderQinv()` calls qiAddLine() once — app.html:3369
  const [out, setOut] = useState<QinvOut | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const cache = useRef<Record<string, { data: QinvMeta; ts: number }>>({});
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    void call<Perms & { companies?: Company[] }>({ api: 'my_perms' })
      .then((p) => setPerms(p))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    // `COMPANIES` — app.html fills it from `me`; the picker is useless without it.
    void call<{ companies?: Company[] }>({ api: 'me' })
      .then((r) => setCompanies(r.companies || []))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const val = (id: string) => el<HTMLInputElement>(id)?.value ?? '';

  // `renderQinv()`'s last line but one — the date is a DOM PROPERTY, not an attribute, which is why the
  // component renders no `value` and this sets it after paint. `todayLocalISO` is the screen's, so the
  // MYT boundary is the one under test rather than the browser's zone.
  useEffect(() => {
    const d = el<HTMLInputElement>('qi_date');
    if (d && !d.value) d.value = todayLocalISO(Date.now());
  }, [signedIn, perms]);

  /** `qiCollect()`'s DOM half — app.html:4693. The rule it applies lives in the screen. */
  const readForm = useCallback(() => {
    const rows: RawLine[] = [...(root.current?.querySelectorAll('#qi_lines > div') || [])].map((row) => ({
      description: (row.querySelector('.qi-desc') as HTMLInputElement | null)?.value ?? '',
      qty: (row.querySelector('.qi-qty') as HTMLInputElement | null)?.value ?? '',
      amount: (row.querySelector('.qi-amt') as HTMLInputElement | null)?.value ?? '',
      account_code: (row.querySelector('.qi-acct') as HTMLSelectElement | null)?.value ?? '',
    }));
    return collect({ tenant: val('qi_co'), customer: val('qi_cust'), rows, contacts: meta.contacts });
  }, [meta]);

  /** `qiMeta()` — app.html:4663, cache and all. */
  const onMeta = useCallback(() => {
    const t = val('qi_co');
    if (!t) return;
    const hit = cache.current[t];
    if (hit && Date.now() - hit.ts < META_TTL) {
      setMeta(hit.data);
      setOut({ kind: 'meta', contacts: (hit.data.contacts || []).length, items: (hit.data.items || []).length, accounts: (hit.data.accounts || []).length, cached: true });
      return;
    }
    setOut({ kind: 'loading', text: 'Loading Xero contacts, products & accounts…' });
    void call<QinvMeta>({ api: 'inv_meta', tenant: t })
      .then((r) => {
        cache.current[t] = { data: r, ts: Date.now() };
        setMeta(r);
        setOut({ kind: 'meta', contacts: (r.contacts || []).length, items: (r.items || []).length, accounts: (r.accounts || []).length, cached: false });
      })
      .catch((e) => setOut({ kind: 'failed', error: e instanceof Error ? e.message : String(e) }));
  }, []);

  /** `qiFillProduct(sel)` — app.html:4636. Writes into THIS row, never a global one. */
  const onFillProduct = useCallback((sel: HTMLSelectElement) => {
    const ix = sel.value;
    if (ix === '') return;
    const it = (meta.items || [])[Number(ix)];
    if (!it) return;
    const row = sel.parentNode as HTMLElement;
    (row.querySelector('.qi-desc') as HTMLInputElement).value = it.description || it.name || '';
    (row.querySelector('.qi-amt') as HTMLInputElement).value = String(it.price || 0);
    if (it.account) {
      const acct = row.querySelector('.qi-acct') as HTMLSelectElement | null;
      if (acct && acct.querySelector(`option[value="${it.account}"]`)) acct.value = it.account;
    }
  }, [meta]);

  /** `qiPreview()` — app.html:4732. */
  const onPreview = useCallback(() => {
    const d = readForm();
    if (d.errors.length) { setOut({ kind: 'errors', errors: d.errors }); return; }
    setOut({
      kind: 'preview',
      data: {
        companyName: companies.filter((c) => c.tenant_id === d.tenant)[0]?.tenant_name || d.tenant,
        customer: d.customer, contactMatch: !!d.contactMatch, lines: d.lines,
        date: val('qi_date') || todayLocalISO(Date.now()), due: val('qi_due'), ref: val('qi_ref'),
        test: !!el<HTMLInputElement>('qi_test')?.checked,
        // v224: MALAYSIAN, as app.html:4328 now is — the preview watermark said yesterday before 8am.
        stamp: mytISO(Date.now()),
      },
    });
  }, [companies, readForm]);

  /** `qiCreate()` — app.html:4838, confirm and all. `runOnce` becomes the `busy` flag. */
  const onCreate = useCallback(() => {
    const d = readForm();
    if (d.errors.length) { setOut({ kind: 'errors', errors: d.errors }); return; }
    const test = !!el<HTMLInputElement>('qi_test')?.checked;
    if (busy) return;
    void (async () => {
      // Last-chance confirm before posting a LIVE invoice — protects against accidental clicks.
      if (!test && !await showConfirm('Create a live invoice',
        'Create a LIVE invoice in Xero for ' + d.customer + '? This cannot be undone via this app.', 'Create', 'p')) return;
      setBusy(true);
      setOut({ kind: 'loading', text: 'Working…' });
      try {
        const r = await call<{ dry_run?: boolean; total?: number; number?: string; contact?: string }>(
          invoiceBody({
            tenant: d.tenant, customer: d.customer, lines: d.lines, contactMatch: d.contactMatch,
            date: val('qi_date'), due: val('qi_due'), ref: val('qi_ref'), test,
          }),
        );
        setOut(r.dry_run
          ? { kind: 'test', total: r.total || 0, existing: r.contact === 'existing' }
          : { kind: 'created', number: r.number || '', total: r.total || 0 });
      } catch (e) {
        setOut({ kind: 'failed', error: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, readForm]);

  /** `this.parentNode.remove()` — app.html:4655. React removes the LAST row, not the clicked index,
   *  when an earlier one is removed: the rows are uncontrolled, so their typed values live in the DOM
   *  and re-keying would shuffle them. Removing by index and letting React drop the tail keeps every
   *  surviving row's own numbers with it. */
  const onRemoveLine = useCallback((i: number) => {
    const rows = [...(root.current?.querySelectorAll('#qi_lines > div') || [])];
    const keep = rows.filter((_r, k) => k !== i).map((row) => ({
      desc: (row.querySelector('.qi-desc') as HTMLInputElement).value,
      qty: (row.querySelector('.qi-qty') as HTMLInputElement).value,
      amt: (row.querySelector('.qi-amt') as HTMLInputElement).value,
      acct: (row.querySelector('.qi-acct') as HTMLSelectElement).value,
    }));
    setLines(keep.length);
    // Repaint has not happened yet; write the surviving values back once it has.
    queueMicrotask(() => {
      const after = [...(root.current?.querySelectorAll('#qi_lines > div') || [])];
      after.forEach((row, k) => {
        if (!keep[k]) return;
        (row.querySelector('.qi-desc') as HTMLInputElement).value = keep[k].desc;
        (row.querySelector('.qi-qty') as HTMLInputElement).value = keep[k].qty;
        (row.querySelector('.qi-amt') as HTMLInputElement).value = keep[k].amt;
        (row.querySelector('.qi-acct') as HTMLSelectElement).value = keep[k].acct;
      });
    });
  }, []);

  // Ctrl/Cmd+S → qiPreview() — app.html:1308, "safer than Create".
  useEffect(() => registerScreenSave(onPreview), [onPreview]);

  return (
    <div ref={root}>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
        : perms === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : !qinvReachable(perms)
          ? <Panel>
              Quick Invoice is not enabled for your login — it creates real invoices in Xero from the company&apos;s
              customer and price lists. Ask an administrator if you need access.
            </Panel>
        : (
          <FinanceQinv
            companies={companies}
            meta={meta}
            lines={lines}
            out={out}
            onMeta={onMeta}
            onAddLine={() => setLines((n) => n + 1)}
            onPreview={onPreview}
            onCreate={onCreate}
            onRemoveLine={onRemoveLine}
            onFillProduct={onFillProduct}
            onBackToEdit={() => setOut(null)}
            // `qiPrintPdf()` — app.html:4835. Same window.open + document.write as the legacy.
            onPrintPdf={() => {
              const node = document.getElementById('qi-pdf');
              if (!node) return;
              const w = window.open('', '_blank', 'width=900,height=1100');
              if (!w) return;
              w.document.write('<!doctype html><html><head><title>Invoice Preview</title><style>body{font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;background:#fff;margin:30px;color:#202632}@media print{body{margin:0}}</style></head><body>'
                + node.outerHTML.replace('box-shadow:0 8px 32px rgba(0,0,0,.4);', '') + '</body></html>');
              w.document.close();
              setTimeout(() => w.print(), 250);
            }}
          />
        )}
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
        <a href={`${legacyUrl('app.html')}#tab=qinv`}>app.html · Quick Invoice</a>, unchanged.
        This page renders the same form from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
