// Finance OS · Approvals — the sixth screen out of app.html, and the first ASYNC one.
//
// The legacy original is `renderApprovals()` (app.html:2358) with `approve()` (app.html:2405) below it,
// and both are STILL THERE and still shipping; nothing was deleted. Both are reachable side by side
// (`app.html#tab=approvals` and `/finance/approvals/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. The `{api:'pending'}`
// load, the `{api:'approve'}` post, the reject confirmation and the in-flight bookkeeping all live in
// app/finance/approvals/page.tsx, on the other side of that line. See src/finance-wht.tsx's header for
// what a Finance screen differs on: no chrome in the golden, one section, and a permission gate that
// sits upstream of the renderer in `showApp()`.
//
// ── ASYNC, AND WHAT THE GOLDEN THEREFORE DOES AND DOES NOT HOLD ────────────────────────────────────
// `renderApprovals()` is `async`: it calls `spin('approvals')` (app.html:1536) FIRST, writing a skeleton
// into `#approvals`, then awaits `{api:'pending'}` and overwrites the div with the result. The harness
// records innerHTML writes by element id and the second write wins, so `tests/golden/finance.approvals.html`
// holds the LOADED table and no skeleton. That is the opposite of `finance.qinv`'s trap (CLAUDE.md: a
// golden capturing an INTERMEDIATE state) and it was checked, not assumed: the renderer does nothing
// after its final `innerHTML=` — no `appendChild`, no `.value=`, no `setTimeout`, no follow-up fetch.
// So the golden IS what an operator sees, and the loading branch is simply outside it. `Loading` below
// mirrors `spin()` character for character and is pinned by assertion in the screen's own test, the same
// treatment `finance.collections` gives its `#collres`.
//
// ── THE OTHER THREE BRANCHES ARE OUTSIDE THE GOLDEN TOO ────────────────────────────────────────────
// The golden was captured with three bills and no company filter, so the error branch (app.html:2361),
// the no-data branch (:2362) and the "No pending approvals" branch (:2367) never appear in it. All three
// are mirrored from the legacy source and pinned by assertion — leaving them out would wire the screen
// to a blank page on the day nothing is pending.
//
// ── THIS SCREEN APPROVES THINGS ────────────────────────────────────────────────────────────────────
// `approve()` posts `{api:'approve',tenant,invoice,action}`; a reject VOIDS the bill in Xero and the
// legacy copy says so ("This action cannot be undone"). Every row is visually near-identical — a
// company, a vendor, a figure — so a row bound to the WRONG invoice_id is invisible on screen and
// irreversible in Xero. `decideBody()` below is the only request this screen can make and is pinned
// against `approve()`'s own text in app.html; handler parity pins the row-to-action binding.
//
// The busy row is mirrored, not invented: `approve()` sets `opacity:.5; pointer-events:none` on the row
// (app.html:2411) so the buttons cannot be pressed twice while the post is in flight. NOTE that
// pointer-events does not stop a KEYBOARD activation, so the route also ignores a repeat decision on a
// row already in flight — that is belt and braces over a real legacy gap, not a behaviour change to the
// screen, and it is why `busy` is a prop rather than a local style trick.

/**
 * `PERMS` — resolved by `showApp()` from `my_perms`, with `fallbackPerms()` (app.html:1398) standing in
 * when that call fails. Approvals is a FEATURE tab, so only `features` decides it.
 */
export interface Perms {
  features?: string[] | null;
}

/**
 * app.html:1434 — the chain's final `else`: `el.classList.toggle('hide', feats.indexOf(t)<0)`.
 *
 * `approvals` is named NOWHERE in `showApp()`'s branches (app.html:1420-1434), so it falls through to
 * that line. Copying an admin-gated neighbour's rule (`wht`, `selfbill`, `gateway`, `bankfeed`,
 * `salesrecon` are all `!canManage`) would both over- and under-grant. The server is stricter — the
 * `approve` handler checks the role and the tenant — so this is tab visibility, not the boundary.
 */
export function approvalsReachable(perms: Perms | null | undefined): boolean {
  return !!(perms && (perms.features || []).indexOf('approvals') >= 0);
}

/** One row of `{api:'pending'}`.bills — app.html:2359, and the fixture at tests/render_fixtures.ts:45. */
export interface Bill {
  tenant_id: string;
  tenant_name: string;
  invoice_id: string;
  contact?: string | null;
  number?: string | null;
  total?: number | null;
  due?: string | null;
  status: string;
}

export type Decision = 'approve' | 'reject';

/**
 * The body `approve()` POSTs — app.html:2414, `call({api:'approve',tenant,invoice,action})`.
 *
 * Split out of the route for the same reason `previewBody()` was on Collections and `bankFile()` on the
 * HR side: no golden sees a request, and this one applies or VOIDS a bill in a real Xero ledger. The
 * tenant and the invoice come from the row, so a mis-bound row is a decision applied to someone else's
 * bill; the screen's test compares this against `approve()`'s own text in app.html rather than against a
 * retyped expectation.
 */
export function decideBody(tenant: string, invoice: string, action: Decision): Record<string, unknown> {
  return { api: 'approve', tenant, invoice, action };
}

/** `M()` — app.html:1253. One line, mirrored rather than imported: it is a currency FORMAT, not maths. */
const M = (n: unknown) =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `bills.filter(b=>!filter||b.tenant_id===filter)` — app.html:2366. `filter` is `curCo()`, '' for all. */
export function visibleBills(bills: Bill[], filter: string): Bill[] {
  return bills.filter((b) => !filter || b.tenant_id === filter);
}

export interface FinanceApprovalsProps {
  /** `{api:'pending'}`.bills. `null` is the pre-response state — `spin()`'s skeleton, not "No data". */
  bills: Bill[] | null;
  /** `curCo()` — app.html:1535, the company bar's select. '' is "— All Companies —". */
  filter: string;
  /** app.html:2361 — `r.ok===false`, or the server's own message. `null` when there is none. */
  error: string | null;
  /** app.html:2362 — a response that carried no `bills` array at all. */
  noData?: boolean;
  /** Row indices with a decision in flight — app.html:2411's `opacity:.5; pointer-events:none`. */
  busy?: number[];
  /** `approve(tenant, invoice, action, i)` — app.html:2402. */
  onDecide: (tenant: string, invoice: string, action: Decision, i: number) => void;
}

/** `spin('approvals')` — app.html:1536, character for character. In no golden; see the header. */
function Loading() {
  return (
    <>
      <div className="cards">
        <div className="sk-card"></div><div className="sk-card"></div><div className="sk-card"></div><div className="sk-card"></div>
      </div>
      <div className="sk-row"></div>
      <div className="sk-row"></div>
      <div className="sk-row" style={{ width: '65%' }}></div>
    </>
  );
}

/** app.html:2361-2363 — the two bare `.empty` blocks, neither wrapped in a panel. */
function Empty({ ico, children }: { ico: string; children: React.ReactNode }) {
  return <div className="empty"><div className="empty-ico">{ico}</div><div>{children}</div></div>;
}

/** `renderApprovals()` — app.html:2358. This component is every byte of the `#approvals` tab div. */
export default function FinanceApprovals(props: FinanceApprovalsProps) {
  if (props.error !== null) return <Empty ico="⚠️">{props.error}</Empty>;
  if (props.noData) return <Empty ico="📭">No data</Empty>;
  // `bills === null` is the pre-response state, NOT app.html:2362's "No data" — a response that arrived
  // and carried no `bills` array sets `noData`, and the two are different documents.
  if (!props.bills) return <Loading />;

  const bills = visibleBills(props.bills, props.filter);
  if (!bills.length) {
    return <div className="panel"><Empty ico="✅">No pending approvals</Empty></div>;
  }

  const busy = props.busy || [];
  return (
    <div className="panel">
      <div className="panel-hd">
        <h3>Pending Bills (Xero)</h3>
        <span className="pill pill-submit">{bills.length + ' pending'}</span>
      </div>
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead>
            <tr>
              <th>Company</th><th>Vendor</th><th>Ref</th>
              <th className="amt">Amount</th><th>Due</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b, i) => (
              // `pointerEvents: ''` is the legacy reset (app.html:2419) and React drops an empty style
              // value, so a row that is not busy carries no style attribute — which is the golden.
              <tr key={b.invoice_id} id={'bill' + i}
                  style={busy.indexOf(i) >= 0 ? { opacity: '.5', pointerEvents: 'none' } : undefined}>
                <td style={{ fontSize: '12px' }}>{b.tenant_name}</td>
                <td>{b.contact || '—'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--sky-soft)' }}>{b.number || '—'}</td>
                <td className="amt"><b>{M(b.total)}</b></td>
                <td className="muted">{b.due || '—'}</td>
                <td><span className={'pill ' + (b.status === 'DRAFT' ? 'pill-draft' : 'pill-submit')}>{b.status}</span></td>
                <td className="row-act">
                  <button className="btn sm p" onClick={() => props.onDecide(b.tenant_id, b.invoice_id, 'approve', i)}>Approve</button>
                  <button className="btn sm d" onClick={() => props.onDecide(b.tenant_id, b.invoice_id, 'reject', i)}>Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
