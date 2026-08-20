// Finance OS · Withholding Tax — the React half of the FIRST Finance screen, and the pattern the other
// 21 Finance tabs follow.
//
// The legacy original is `renderWht()` at app.html:3387 (with `whtHead`, `whtListHtml`, `whtPayeesHtml`
// and `whtPayeeForm` below it) and it is STILL THERE and still shipping; nothing was deleted. Both are
// reachable side by side (`app.html#tab=wht` and `/finance/wht/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. That is what lets
// tests/finance-wht.parity.test.tsx render it with `renderToStaticMarkup` and diff the result against
// tests/golden/finance.wht.html. The session, the `wht_config` / `wht_list` loads and the payee POSTs
// live in app/finance/wht/page.tsx, on the other side of that line.
//
// The markup mirrors the legacy string concatenation element for element, including the inline `style`
// strings. It is not "better" — it is the SAME, because the golden is the contract.
//
// ── WHAT IS DIFFERENT ABOUT A FINANCE SCREEN, versus the fifteen HR ones ───────────────────────────
//
// 1. NO SHARED CHROME IN THE GOLDEN. `hrRender()` writes a page head (eyebrow / title / company chip)
//    into `#hr` before it calls the screen's renderer, so every HR golden carries chrome the component
//    had to reproduce. Finance's `render(t)` (app.html:1538) does not: it dispatches straight to
//    `renderWht()`, which owns every byte written into `#wht`. So this component is the WHOLE golden and
//    there is no chrome prop — no company name, no eyebrow. Finance's chrome (the tab rail, the company
//    picker, the bell) lives in app.html's static markup, outside every tab div and outside every
//    golden. That makes Finance screens SMALLER to port, not larger.
//
// 2. THE COMPUTATION IS IMPORTED, NOT RE-EXPRESSED. `whtCompute` was inline in app.html; it is now
//    wht.js, loaded by app.html as a classic script and imported here through wht.d.ts — the same
//    arrangement payroll.js has with hros.html and web/src/hr-payroll.tsx. The list's WHT column is a
//    statutory liability; two copies of that arithmetic is a wrong filing waiting for the day they
//    disagree.
//
// 3. THE PERMISSION GATE IS UPSTREAM OF THE RENDERER, and it is a different mechanism from HR's.
//    `renderWht()` has no role check in it at all. `showApp()` does, at app.html:1430, hiding the tab
//    unless `PERMS.manage_users`. So a React port that mirrored only the renderer would serve every
//    non-resident payee's name, TIN, treaty position and withheld amount — plus the rates that decide
//    what is remitted to LHDN — to anyone who typed the URL. `whtReachable()` below is the pure mirror
//    of that line; app/finance/wht/page.tsx refuses to load or render on a false, and the screen's own
//    test pins both directions. Check for such a gate before assuming a Finance renderer is the whole
//    screen: app.html:1420-1434 is the list, and eight of the 22 tabs carry one.
//
// ── WHAT THE GOLDEN DOES NOT HOLD ──────────────────────────────────────────────────────────────────
// `tests/golden/finance.wht.html` is `WHT.page==='list'` with `WHT.payees===false`, so the payees panel,
// the payee form and their handlers appear in NO golden and the parity test does not reach them. They
// are mirrored from app.html:3435-3475 anyway, because leaving them out would wire the "🏷 Payees &
// rates" button — which IS in the golden — to nothing. The payee form's `wp_*` element ids are the
// contract `whtSavePayee()` (app.html:3481) reads the form back out of the DOM by, so the test pins
// them against app.html's own text rather than trusting this file.
//
// `WHT.page==='doc'` — `whtDocHtml()`, the printable computation with its editable payment lines — is
// NOT ported. It is a sibling PAGE that `renderWht()` dispatches to, not a branch of this renderer, and
// it is its own screen's worth of work. `onOpen` / `onNew` hand off to the legacy tab; see the route.

import { WHT_TYPES, whtCompute, whtMoney, whtTypeLabel } from '../../wht.js';

/** One row of `wht_list.summaries` — tests/render_fixtures.ts:214. */
export interface WhtSummary {
  id: number;
  doc_no?: string | null;
  payee_name: string;
  payee_country?: string | null;
  /** Fraction, not percent. */
  wht_rate: number;
  basis?: string | null;
  period_label?: string | null;
  fee_total: number;
  /** 'filed' | 'final' | anything else → Draft. */
  status?: string | null;
  sst_rate?: number | null;
  penalty_pct?: number | null;
  penalty_on?: boolean | null;
}

/** One row of `wht_config.payees` — tests/render_fixtures.ts:210. */
export interface WhtPayee {
  id?: number;
  name?: string | null;
  tin?: string | null;
  country?: string | null;
  wht_rate?: number | null;
  statutory_rate?: number | null;
  wht_type?: string | null;
  treaty_relief?: boolean | null;
  has_cor?: boolean | null;
  notes?: string | null;
}

/**
 * `PERMS` — resolved by `showApp()` from `my_perms`, with `fallbackPerms()` (app.html:1398) standing in
 * when that call fails. Only `manage_users` decides this tab.
 */
export interface Perms {
  manage_users?: boolean | null;
}

/**
 * app.html:1430 — `el.classList.toggle('hide', !canManage)`, where `canManage = !!PERMS.manage_users`
 * (app.html:1419). Withholding tax is admin-only because it computes a statutory liability.
 *
 * Exported from the screen, not hidden in the route, so tests/finance-wht.parity.test.tsx can pin both
 * directions of it. A route-local predicate is a gate no test can reach.
 */
export function whtReachable(perms: Perms | null | undefined): boolean {
  return !!(perms && perms.manage_users);
}

/**
 * The `payee` object `whtSavePayee()` (app.html:3481) POSTs as `{api:'wht_payee_save', payee}`.
 *
 * Split out of the route for the same reason `bankFile()` and `profileBody()` were on the HR side: no
 * golden sees a request body, so the FIELD SET and the RATE UNITS are provable nowhere else. Both are
 * load-bearing here — `wp_rate` and `wp_stat` are typed as PERCENTS and stored as FRACTIONS, and a
 * missing `/100` would withhold 10,000% or 0.001% with the form looking perfectly normal. `isFinite`
 * guards the same way the legacy `pct()` does: a blank box sends null, not NaN.
 */
export function payeeBody(f: {
  id?: number;
  name: string; tin: string; country: string;
  rate: string; stat: string; type: string;
  treaty: boolean; cor: boolean; notes: string;
}): Record<string, unknown> {
  const pct = (x: string) => { const n = Number(x); return isFinite(n) ? n / 100 : null; };
  return {
    id: f.id || undefined, name: f.name, tin: f.tin, country: f.country,
    wht_rate: pct(f.rate), statutory_rate: pct(f.stat), wht_type: f.type,
    treaty_relief: f.treaty, has_cor: f.cor, notes: f.notes,
  };
}

export interface FinanceWhtProps {
  /** `WHT.list` — the computations table. */
  list: WhtSummary[];
  /** `WHT.cfg.payees`. Only read when `payees` is true. */
  payeeList: WhtPayee[];
  /** `WHT.payees` — whether the payees panel is open. FALSE in the golden. */
  payees: boolean;
  /** `WHT.editPayee` — null closes the payee form. NULL in the golden. */
  editPayee: WhtPayee | null;
  /** `whtOpen(id)` — app.html:3503. */
  onOpen: (id: number) => void;
  /** `whtNew()` — app.html:3497. */
  onNew: () => void;
  /** `WHT.payees=!WHT.payees;renderWht()` — app.html:3408. */
  onTogglePayees: () => void;
  /** `whtEditPayee(id)` — app.html:3477. `0` is the sentinel for "a blank record". */
  onEditPayee: (id: number) => void;
  /** `whtSavePayee()` — app.html:3481. */
  onSavePayee: () => void;
  /** `WHT.editPayee=null;renderWht()` — app.html:3474. */
  onCancelPayee: () => void;
  /** `whtDelPayee(id)` — app.html:3491. Only rendered for a payee that already exists. */
  onDelPayee: (id: number) => void;
}

/** app.html:3457 — the shared input style for the payee form. */
const S = 'padding:7px 9px;background:var(--panel-2,#141a22);border:1px solid var(--border,#243040);border-radius:7px;color:var(--text,#e8eef6);font-size:12.5px;width:100%';

/**
 * Every inline style is written as a STRING and parsed here, not as a React style object.
 *
 * The golden holds `style="display:flex;gap:8px;flex-wrap:wrap"` verbatim and nothing in parity.ts's
 * relaxation layer touches an attribute VALUE, so these are compared character for character — which is
 * the point. Writing them as objects would hand React two chances to change them silently: it appends
 * `px` to a bare number and it re-serialises `.15` as `0.15`. Keeping the legacy string as the source
 * and splitting it mechanically means the value in this file IS the value in app.html.
 */
function st(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of css.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    // React's style prop takes camelCase; a custom property (`--x`) is passed through as written, which
    // is also what React expects. The VALUE is never touched — that is the half the golden compares.
    const key = name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[key] = part.slice(at + 1).trim();
  }
  return out;
}

/** app.html:3458 — one labelled field of the payee form. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="muted" style={st('font-size:11px;display:block;margin-bottom:3px')}>{label}</label>
      {children}
    </div>
  );
}

/** `whtHead(sub)` — app.html:3401, in its `WHT.page!=='doc'` form (the only one this screen reaches). */
function Head({ sub, onNew, onTogglePayees }: { sub: string; onNew: () => void; onTogglePayees: () => void }) {
  return (
    <div style={st('display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px')}>
      <div><h2 style={st('margin:0;font-size:19px')}>🌏 Withholding Tax</h2>
        <div className="muted" style={st('font-size:12px')}>{sub}</div></div>
      <div style={st('display:flex;gap:8px;flex-wrap:wrap')}>
        <button className="btn sm" onClick={onTogglePayees}>🏷 Payees &amp; rates</button>
        <button className="btn p sm" onClick={onNew}>+ New computation</button>
      </div>
    </div>
  );
}

/**
 * `whtPayeesHtml()` — app.html:3435. NOT IN ANY GOLDEN: it is behind `WHT.payees`, which is false when
 * the surface is captured, so the parity test never renders this subtree. Mirrored from the legacy
 * source rather than left out, because the button that opens it IS in the golden.
 */
function Payees(p: Pick<FinanceWhtProps, 'payeeList' | 'editPayee' | 'onEditPayee' | 'onSavePayee' | 'onCancelPayee' | 'onDelPayee'>) {
  const rows = p.payeeList.map((x) => {
    const flag = x.treaty_relief && !x.has_cor;
    const rate = (Number(x.wht_rate) * 100).toFixed(2).replace(/\.00$/, '') + '%';
    const showStat = x.statutory_rate != null && Number(x.statutory_rate) !== Number(x.wht_rate);
    return (
      <tr key={x.id}>
        <td><b>{x.name}</b>
          {flag ? <div style={st('font-size:10.5px;color:var(--amber,#e0a800);margin-top:2px')}>⚠ Treaty rate applied with no Certificate of Residence on file</div> : ''}
          {x.notes ? <div className="muted" style={st('font-size:10.5px;margin-top:2px')}>{x.notes}</div> : ''}</td>
        <td className="muted">{x.tin || '—'}</td><td className="muted">{x.country || '—'}</td>
        <td className="amt" style={st('text-align:right')}><b>{rate}</b>
          {showStat ? <div className="muted" style={st('font-size:10.5px')}>{'statutory ' + (Number(x.statutory_rate) * 100).toFixed(0) + '%'}</div> : ''}</td>
        <td className="muted" style={st('font-size:11px')}>{whtTypeLabel(x.wht_type)}</td>
        <td><button className="btn xs" onClick={() => p.onEditPayee(x.id!)}>Edit</button></td>
      </tr>
    );
  });
  return (
    <div className="panel" style={st('margin-bottom:14px')}><div className="panel-hd"><h3>Payees &amp; rates</h3>
      <button className="btn sm" onClick={() => p.onEditPayee(0)}>+ Add payee</button></div>
      <div className="muted" style={st('font-size:11.5px;margin-bottom:8px')}>The rate here is what gets applied. A treaty rate is only valid while a current <b>Certificate of Residence</b> is held — without one LHDN can assess at the full domestic rate plus the 10% increase.</div>
      <div className="tbl-wrap"><table className="bigtable"><thead><tr><th>Payee</th><th>TIN</th><th>Country</th><th className="amt" style={st('text-align:right')}>Rate</th><th>Type</th><th></th></tr></thead><tbody>
        {rows.length ? rows : <tr><td colSpan={6} className="muted" style={st('text-align:center;padding:16px')}>No payees yet.</td></tr>}
      </tbody></table></div>
      {p.editPayee !== null ? <PayeeForm payee={p.editPayee} onSave={p.onSavePayee} onCancel={p.onCancelPayee} onDel={p.onDelPayee} /> : ''}</div>
  );
}

/**
 * `whtPayeeForm()` — app.html:3455. NOT IN ANY GOLDEN, for the same reason as `Payees` above.
 *
 * UNCONTROLLED, with the legacy `wp_*` element ids kept, because that is the contract: `whtSavePayee()`
 * reads the form back out of the DOM by exactly those ids, and the route does the same. A field that
 * loses its id here saves as blank — on this form that is a wiped TIN or a rate silently reset, with no
 * error anywhere. tests/finance-wht.parity.test.tsx extracts the id list from app.html at run time and
 * checks it against this markup, so the check cannot drift from the function it protects.
 */
function PayeeForm({ payee, onSave, onCancel, onDel }: { payee: WhtPayee; onSave: () => void; onCancel: () => void; onDel: (id: number) => void }) {
  const p = payee || {};
  return (
    <div style={st('margin-top:12px;padding:12px;background:var(--panel-2,#141a22);border:1px solid var(--border,#243040);border-radius:9px')}>
      <div style={st('display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px')}>
        <Field label="Payee name *"><input id="wp_name" defaultValue={p.name || ''} style={st(S)} /></Field>
        <Field label="TIN"><input id="wp_tin" defaultValue={p.tin || ''} style={st(S)} /></Field>
        <Field label="Country"><input id="wp_country" defaultValue={p.country || ''} style={st(S)} /></Field>
        <Field label="Rate applied (%)"><input id="wp_rate" type="number" step="0.01" min="0" max="99" defaultValue={p.wht_rate != null ? Number(p.wht_rate) * 100 : 10} style={st(S)} /></Field>
        <Field label="Statutory rate (%)"><input id="wp_stat" type="number" step="0.01" min="0" max="99" defaultValue={p.statutory_rate != null ? Number(p.statutory_rate) * 100 : 10} style={st(S)} /></Field>
        <Field label="Charging section"><select id="wp_type" defaultValue={p.wht_type || 'royalty'} style={st(S)}>
          {WHT_TYPES.map((t) => <option key={t[0]} value={t[0]}>{t[1]}</option>)}
        </select></Field>
      </div>
      <div style={st('display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:10px 0')}>
        <label style={st('display:inline-flex;gap:6px;align-items:center;font-size:12.5px')}><input type="checkbox" id="wp_treaty" defaultChecked={!!p.treaty_relief} /> Treaty rate (DTA relief)</label>
        <label style={st('display:inline-flex;gap:6px;align-items:center;font-size:12.5px')}><input type="checkbox" id="wp_cor" defaultChecked={!!p.has_cor} /> Certificate of Residence on file</label>
      </div>
      <Field label="Notes"><input id="wp_notes" defaultValue={p.notes || ''} style={st(S)} /></Field>
      <div style={st('display:flex;gap:8px;margin-top:10px')}><button className="btn p sm" onClick={onSave}>Save payee</button>
        <button className="btn sm" onClick={onCancel}>Cancel</button>
        {p.id ? <button className="btn sm d" style={st('margin-left:auto')} onClick={() => onDel(p.id!)}>Remove</button> : ''}</div>
    </div>
  );
}

/** `whtListHtml()` — app.html:3413. */
export default function FinanceWht(props: FinanceWhtProps) {
  const rows = props.list.map((s) => {
    // THE STATUTORY FIGURE. `whtCompute` is wht.js's, the same function app.html calls — a summary row
    // is computed from its own fee total, never read off a stored column.
    const c = whtCompute(s, [{ amount: s.fee_total }]);
    const pill = s.status === 'filed'
      ? <span className="pill" style={st('background:rgba(45,180,120,.15);color:#2db478')}>Filed</span>
      : s.status === 'final'
        ? <span className="pill" style={st('background:rgba(91,155,213,.15);color:#5b9bd5')}>Final</span>
        : <span className="pill">Draft</span>;
    // Built as ONE string, exactly as the legacy concatenation reads it: adjacent JSX text expressions
    // are two text nodes, and the legacy side is one.
    const sub = (s.payee_country || '') + ' · ' + (Number(s.wht_rate) * 100).toFixed(0) + '%' + (s.basis === 'net' ? ' · net basis' : '');
    return (
      <tr key={s.id} style={st('cursor:pointer')} onClick={() => props.onOpen(s.id)}>
        <td><b>{s.doc_no || '—'}</b></td>
        <td>{s.payee_name}<div className="muted" style={st('font-size:10.5px')}>{sub}</div></td>
        <td>{s.period_label || ''}</td>
        <td className="amt" style={st('text-align:right')}>{whtMoney(s.fee_total)}</td>
        <td className="amt" style={st('text-align:right')}><b>{whtMoney(c.wht)}</b></td>
        <td>{pill}</td>
      </tr>
    );
  });

  return (
    <>
      <Head sub="Compute and document WHT on payments to non-resident suppliers. Replaces the Excel summary."
        onNew={props.onNew} onTogglePayees={props.onTogglePayees} />
      {props.payees ? <Payees payeeList={props.payeeList} editPayee={props.editPayee} onEditPayee={props.onEditPayee}
        onSavePayee={props.onSavePayee} onCancelPayee={props.onCancelPayee} onDelPayee={props.onDelPayee} /> : ''}
      <div className="panel"><div className="panel-hd"><h3>Computations</h3></div>
        <div className="tbl-wrap"><table className="bigtable"><thead><tr><th>Doc no</th><th>Payee</th><th>Period</th>
          <th className="amt" style={st('text-align:right')}>Fee (excl. SST)</th><th className="amt" style={st('text-align:right')}>WHT</th><th>Status</th></tr></thead><tbody>
          {rows.length ? rows : <tr><td colSpan={6} className="muted" style={st('text-align:center;padding:20px')}>No computations yet — click <b>+ New computation</b>.</td></tr>}
        </tbody></table></div></div>
    </>
  );
}
