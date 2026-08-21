'use client';

// The route for the WHT computation PAGE — `WHT.page === 'doc'` in the legacy, its own URL here.
//
// Everything impure lives here — the session, `wht_config` / `wht_get` / `wht_save` / `wht_delete`, the
// state and `window.open` — so that src/finance-wht-doc.tsx stays a pure function of its props.
//
// ── WHY A NESTED ROUTE AND NOT A `page` PROP ──────────────────────────────────────────────────────
// `whtDocHtml()` is a sibling PAGE, not a branch of `whtListHtml()`: the legacy swaps the whole of
// `#wht` between the two. Giving it `/finance/wht/doc/` keeps the list route a list route, keeps Back
// working, and — because it is NESTED under the tab's own directory — leaves `app/finance/`'s top-level
// directories exactly the 22 tab ids `web/tests/shell.test.tsx` checks against `nav.ts`. A sibling page
// is not a nav entry and must not become one.
//
// The record is addressed by `?id=`, read from `location.search` rather than `useSearchParams()`:
// `output: 'export'` (next.config.mjs) prerenders this file, and `useSearchParams` would need a
// Suspense boundary to do it. No `?id=` is `whtNew()` — a blank computation.
//
// ── THE FORM IS UNCONTROLLED AND THE ROUTE SYNCS IT, exactly as `whtSync()` does ───────────────────
// The component keeps every legacy `w_*` / `wl_*` id and the handlers below write the same fields
// `whtSync()` (app.html:3312) writes. What the legacy does with a wholesale `innerHTML=` — re-materialise
// every input from state after picking a payee, adding a row or deleting one — is done here by bumping
// `gen`, the component's React key. Typing never bumps it, so the caret is never moved.

import { useCallback, useEffect, useState } from 'react';

import { whtReachable, type Perms, type WhtPayee } from '../../../../src/finance-wht';
import FinanceWhtDoc, {
  printDocHtml, saveBody,
  type Company, type DocField, type LineField, type WhtDocLine, type WhtDocState, type WhtEntity,
} from '../../../../src/finance-wht-doc';
import { call, legacyUrl, token } from '../../../../src/portal';

/** `whtNew()` — app.html:3331, field for field. */
function blankDoc(tenant: string): WhtDocState {
  return {
    tenant_id: tenant, payee_name: '', wht_rate: 0.10, wht_type: 'royalty',
    basis: 'gross', sst_rate: 0.08, penalty_pct: 0.10, penalty_on: false, status: 'draft', period_label: '',
  };
}

/** `whtNew()` opens five blank rows; `whtOpen()` pads a shorter document up to five (app.html:3341). */
function padLines(lines: WhtDocLine[]): WhtDocLine[] {
  const out = lines.slice();
  while (out.length < 5) out.push({});
  return out;
}

export default function FinanceWhtDocPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [doc, setDoc] = useState<WhtDocState | null>(null);
  const [lines, setLines] = useState<WhtDocLine[]>([]);
  const [entities, setEntities] = useState<WhtEntity[]>([]);
  const [payees, setPayees] = useState<WhtPayee[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // The component's React key. Bumped where the legacy rewrites the form's innerHTML from state.
  const [gen, setGen] = useState(0);

  const open = useCallback(async (id: string) => {
    // `whtOpen(id)` — app.html:3336.
    const r = await call<{ summary: WhtDocState; lines?: WhtDocLine[] }>({ api: 'wht_get', id: Number(id) });
    setDoc(r.summary);
    setLines(padLines((r.lines || []).map((l) => ({
      payment_date: l.payment_date, receipt_no: l.receipt_no, description: l.description, amount: l.amount,
    }))));
    setGen((g) => g + 1);
  }, []);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    void (async () => {
      try {
        // Same gate as the list — app.html:1430. A computation carries a non-resident payee's TIN, the
        // treaty position claimed for them and the tax withheld on a filed return.
        const p = await call<Perms>({ api: 'my_perms' });
        setPerms(p);
        if (!whtReachable(p)) return;
        const cfg = await call<{ entities?: WhtEntity[]; payees?: WhtPayee[] }>({ api: 'wht_config' });
        setEntities(cfg.entities || []);
        setPayees(cfg.payees || []);
        // `COMPANIES` — app.html:7087 fills it from the login response; `{api:'me'}` is the same list,
        // and it is what `whtCoName()` resolves a display name from.
        const co = await call<{ companies?: Company[] }>({ api: 'me' }).catch(() => ({ companies: [] }));
        setCompanies(co.companies || []);
        const id = new URLSearchParams(location.search).get('id');
        if (id) await open(id);
        else { setDoc(blankDoc('')); setLines(padLines([])); setGen((g) => g + 1); }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [open]);

  /** `whtSync()`'s per-field write — app.html:3312. Percent boxes are stored as FRACTIONS, as it does. */
  const onField = useCallback((key: DocField, value: string | boolean) => {
    setDoc((d) => {
      if (!d) return d;
      if (key === 'wht_rate') return { ...d, wht_rate: (Number(value) || 0) / 100 };
      if (key === 'sst_rate') return { ...d, sst_rate: (Number(value) || 0) / 100 };
      if (key === 'penalty_on') return { ...d, penalty_on: !!value };
      return { ...d, [key]: value } as WhtDocState;
    });
  }, []);

  const onLineField = useCallback((i: number, key: LineField, value: string) => {
    setLines((ls) => ls.map((l, n) => (n === i
      ? { ...l, [key]: key === 'amount' ? (value === '' ? 0 : Number(value)) : value }
      : l)));
  }, []);

  /** `whtSetPayee(id)` — app.html:3323. The picked payee decides the rate AND the charging section. */
  const onPayee = useCallback((id: string) => {
    setDoc((d) => {
      if (!d) return d;
      const p = payees.find((x) => String(x.id) === String(id));
      if (!p) return { ...d, payee_id: null, payee_name: '', _payee: null };
      return {
        ...d, payee_id: p.id, payee_name: p.name || '', payee_tin: p.tin, payee_country: p.country,
        wht_rate: Number(p.wht_rate), wht_type: p.wht_type, _payee: p,
      };
    });
    setGen((g) => g + 1);   // the rate box is rewritten from state, as renderWht() does
  }, [payees]);

  const onAddLine = useCallback(() => { setLines((ls) => [...ls, {}]); setGen((g) => g + 1); }, []);
  /** `whtDelLine(i)` — app.html:3333. The last row is replaced, not removed. */
  const onDelLine = useCallback((i: number) => {
    setLines((ls) => { const out = ls.filter((_l, n) => n !== i); return out.length ? out : [{}]; });
    setGen((g) => g + 1);
  }, []);

  /** `whtSave(status)` — app.html:3461. */
  const onSave = useCallback((status: string) => {
    if (!doc) return;
    void (async () => {
      try {
        const body = saveBody(doc, lines, status, entities);
        const r = await call<{ id?: number }>({ api: 'wht_save', summary: body.summary, lines: body.lines });
        setNotice('Saved' + (status === 'final' ? ' — marked final' : ''));
        // The legacy re-opens the saved record so the server's doc_no and id land on screen.
        if (r.id) await open(String(r.id));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [doc, lines, entities, open]);

  /** `whtPrint()` — app.html:3483. The document is built pure; only the window is opened here. */
  const onPrint = useCallback(() => {
    if (!doc) return;
    const w = window.open('', '_blank');
    if (!w) { setErr('Allow pop-ups to print'); return; }
    w.document.write(printDocHtml(doc, lines, companies, entities));
    w.document.close();
    setTimeout(() => { try { w.print(); } catch { /* the operator can still print from the window */ } }, 350);
  }, [doc, lines, companies, entities]);

  /** `whtDelete()` — app.html:3476, confirm and all. */
  const onDelete = useCallback(() => {
    if (!doc || !doc.id) return;
    if (!confirm('Delete this computation?')) return;
    void (async () => {
      try {
        await call({ api: 'wht_delete', id: doc.id });
        location.href = `${BASE}/finance/wht/`;
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [doc]);

  const onBack = useCallback(() => { location.href = `${BASE}/finance/wht/`; }, []);

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
        : perms !== null && !whtReachable(perms)
          ? <Panel>
              Withholding Tax is an admin-only screen — it holds non-resident payees&apos; tax numbers and the tax
              withheld on filed returns. Ask an administrator if you need access.
            </Panel>
        : !doc ? <Panel><span className="spin"></span> Loading withholding tax…</Panel>
        : (
          <>
            {notice ? <Panel>{notice}</Panel> : null}
            <FinanceWhtDoc
              key={gen}
              doc={doc}
              lines={lines}
              entities={entities}
              payees={payees}
              companies={companies}
              onField={onField}
              onLineField={onLineField}
              onPayee={onPayee}
              onAddLine={onAddLine}
              onDelLine={onDelLine}
              onSave={onSave}
              onPrint={onPrint}
              onDelete={onDelete}
              onBack={onBack}
            />
          </>
        )}
    </>
  );
}

/** The one place a base path is read in this route — src/portal.ts is the one place it is defined. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel"><div className="muted" style={{ padding: '18px' }}>{children}</div></div>;
}

function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('app.html')}#tab=wht`}>app.html · Withholding Tax</a>, unchanged.
        This page renders the same computation from the same session, with the figures from the same{' '}
        <code>wht.js</code>.
      </div>
    </div>
  );
}
