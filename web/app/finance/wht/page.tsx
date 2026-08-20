'use client';

// The route. Everything impure lives here — the session, the fetches, the state — so that
// src/finance-wht.tsx stays a pure function of its props and can be diffed against the legacy golden.
// Same split as the HR screens: see app/hr/claims/page.tsx.
//
// ── THE FINANCE ROUTE CONVENTION, for the other 21 tabs ────────────────────────────────────────────
// `app/finance/<tab-id>/page.tsx`, where <tab-id> is the `data-t` value app.html gives the tab
// (app.html:1138) — the same string `render(t)` dispatches on, the same string `#tab=<id>` addresses,
// and the same string the golden is named for (`finance.wht`). One id, four places, no mapping table.
//
// ── `render(t)`'s ASYNC-TAB BEHAVIOUR IS NOT REPRODUCED, deliberately ──────────────────────────────
// app.html:1504 keeps a list of tabs that get `spin(t)` — a skeleton — painted before `render(t)` runs,
// because the legacy app has ONE div per tab that the renderer overwrites wholesale, so without a
// placeholder the operator stares at the previous tab's content while the fetch is in flight. That is a
// consequence of rendering by innerHTML into a shared element, not a feature of the screen: React
// renders the loading state as an ordinary branch of the component tree, which is what the panel below
// does. The `asyncTabs` list does not need porting — but note it is a useful INVENTORY: a tab on it
// fetches before it can paint, so its route needs a load step like this one, and a tab not on it (o2o,
// qinv, gateway, recon, upload, collections…) can render from what it already has.

import { useCallback, useEffect, useState } from 'react';

import FinanceWht, { payeeBody, whtReachable, type Perms, type WhtPayee, type WhtSummary } from '../../../src/finance-wht';
import { call, legacyUrl, token } from '../../../src/portal';

export default function FinanceWhtPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [list, setList] = useState<WhtSummary[] | null>(null);
  const [payeeList, setPayeeList] = useState<WhtPayee[]>([]);
  const [payees, setPayees] = useState(false);
  const [editPayee, setEditPayee] = useState<WhtPayee | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      // `renderWht()` — app.html:3387. Both calls, in the order it makes them.
      const cfg = await call<{ payees?: WhtPayee[] }>({ api: 'wht_config' });
      setPayeeList(cfg.payees || []);
      const l = await call<{ summaries?: WhtSummary[] }>({ api: 'wht_list' });
      setList(l.summaries || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE — app.html:1430, via `showApp()`'s `canManage` (app.html:1419). Withholding
    // tax is admin-only: the screen carries non-resident payees' names, TINs, treaty positions and the
    // tax withheld on returns already filed. `whtReachable()` is exported from the screen so the
    // screen's own test can pin both directions. The server is stricter still — every `wht_*` handler
    // requires superAdmin (finance.ts:1194) — so this is the tab-visibility rule, not the boundary.
    void call<Perms>({ api: 'my_perms' })
      .then((p) => {
        setPerms(p);
        if (whtReachable(p)) void load();
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [load]);

  /** `whtSavePayee()` — app.html:3481. Reads the form back out of the DOM by its `wp_*` ids, as it does. */
  const onSavePayee = useCallback(() => {
    const v = (i: string) => (document.getElementById(i) as HTMLInputElement | null)?.value ?? '';
    const ck = (i: string) => !!(document.getElementById(i) as HTMLInputElement | null)?.checked;
    void (async () => {
      try {
        await call({
          api: 'wht_payee_save',
          payee: payeeBody({
            id: editPayee?.id, name: v('wp_name'), tin: v('wp_tin'), country: v('wp_country'),
            rate: v('wp_rate'), stat: v('wp_stat'), type: v('wp_type'),
            treaty: ck('wp_treaty'), cor: ck('wp_cor'), notes: v('wp_notes'),
          }),
        });
        setNotice('Payee saved');
        setEditPayee(null);
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [editPayee, load]);

  /** `whtDelPayee()` — app.html:3491, confirm and all. */
  const onDelPayee = useCallback((id: number) => {
    if (!confirm('Remove this payee from the list?\n\nPast computations keep their own copy of the name, TIN and rate, so nothing already filed changes.')) return;
    void (async () => {
      try {
        await call({ api: 'wht_payee_delete', id });
        setNotice('Payee removed');
        setEditPayee(null);
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [load]);

  /** `whtEditPayee(id)` — app.html:3477. `0` is the sentinel for "a blank record". */
  const onEditPayee = useCallback((id: number) => {
    setEditPayee(id ? (payeeList.find((x) => x.id === id) || {}) : {});
    setPayees(true);
  }, [payeeList]);

  return (
    <main style={{ padding: '28px 34px 64px' }}>
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
        : !list ? <Panel><span className="spin"></span> Loading withholding tax…</Panel>
        : (
          <>
            {notice ? <Panel>{notice}</Panel> : null}
            <FinanceWht
              list={list}
              payeeList={payeeList}
              payees={payees}
              editPayee={editPayee}
              // `whtOpen(id)` and `whtNew()` open `WHT.page==='doc'` — `whtDocHtml()`, which is NOT
              // migrated. Handing off to the legacy tab is the honest strangler edge: same origin, same
              // session, and the operator lands on the screen that can actually draw the computation.
              onOpen={() => { location.href = `${legacyUrl('app.html')}#tab=wht`; }}
              onNew={() => { location.href = `${legacyUrl('app.html')}#tab=wht`; }}
              onTogglePayees={() => setPayees((x) => !x)}
              onEditPayee={onEditPayee}
              onSavePayee={onSavePayee}
              onCancelPayee={() => setEditPayee(null)}
              onDelPayee={onDelPayee}
            />
          </>
        )}
    </main>
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
        <a href={`${legacyUrl('app.html')}#tab=wht`}>app.html · Withholding Tax</a>, unchanged.
        This page renders the same data from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}
