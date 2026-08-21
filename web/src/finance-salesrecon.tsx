// Finance OS · Sales Reconciliation — the React half of `renderSalesRecon()` (app.html:3568), the
// fourteenth Finance screen.
//
// The legacy original is STILL THERE and still shipping; nothing was deleted from it except the
// arithmetic, which moved into `salesrecon.js` and is now loaded back into `app.html` as a classic
// script. Both screens are reachable side by side (`app.html#tab=salesrecon` and `/finance/salesrecon/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no FileReader, no clock read. The
// file read, the XLSX decode, the two Xero lookups, the POST, the CSV/xlsx downloads and the state all
// live in app/finance/salesrecon/page.tsx.
//
// ── THE ARITHMETIC IS IMPORTED, NOT RE-EXPRESSED ───────────────────────────────────────────────────
// `srOrderLookup`, `srBuildLines`, `srApplyYrdz`, `srApplySoSuffix`, `srTally`, `srSummary`, `srCsv`,
// `srPostChunks`, `srPostBody` and `srReportSheets` come from `../../salesrecon.js` — the same classic
// script `app.html` now loads. They were lifted out of app.html by this migration for o2o.js's reason,
// measured rather than assumed: `sr_post_invoices` (finance.ts:853) recomputes NOTHING. It forwards
// `it.number`, `it.date`, `it.due`, `it.desc`, `it.qty`, `it.amount` and `it.account` straight into the
// Xero `Invoices` payload (finance.ts:870-875), reformatting only DD-MM-YYYY → ISO and resolving the
// org's exempt tax rate. So these numbers ARE the draft invoices and there is no server figure to fall
// back on. (Contrast Quick Invoice, which correctly declined to lift its one `reduce` because Xero's own
// `iv.Total` is the authority there, and Personal Invoices, where `sbi_save` re-derives its own figures.)
// Nothing in this file does money arithmetic; it renders what salesrecon.js returned.
//
// ── ONE MODE, AND THE GOLDEN COVERS IT ─────────────────────────────────────────────────────────────
// This screen has no sub-views, no sub-nav and no second page — unlike `finance.users` (five sub-views,
// one golden) or `finance.wht` (a sibling `whtDocHtml()` page). `render('salesrecon')` dispatches to
// `renderSalesRecon()` and that function owns every byte of `#salesrecon`; there is nothing behind it to
// hand off to. Both panels — "1 · Drop the two files" and "2 · Result" — are in the golden.
//
// THE GOLDEN IS NOT AN INTERMEDIATE STATE. `renderQinv()` writes its markup and THEN calls `qiAddLine()`,
// and `renderUsers()` then reassigns a sub-nav className, so both goldens hold a document no operator
// sees. `renderSalesRecon()` was checked for the same: after its single `innerHTML=` it does exactly
// four `addEventListener` calls (dragover/dragenter/dragleave/drop on `#sr-drop`, change on `#sr-fi`)
// and nothing else — no appendChild, no `.value=`, no `.className=`, no setTimeout, no fetch, and
// `salesrecon` is not on `render(t)`'s `asyncTabs` list (app.html:1504). Listeners are invisible to the
// harness AND to the DOM, so the golden really is the screen on tab open. The screen's test asserts that
// against app.html's own text rather than leaving it as a claim.
//
// ── WHAT THE GOLDEN HOLDS, AND WHAT IT DOES NOT ────────────────────────────────────────────────────
// `#sr-result` is in the golden as `class="panel hide"` with `#sr-cards`, `#sr-acctbody`, `#sr-tally`,
// `#sr-tbody` and `#sr-note` all EMPTY. So every figure an operator reads before pressing "Create in
// Xero" — the four cards, the revenue-by-account table, the SO tally and the 150-row preview — is
// written later by `srRenderResult()` (app.html:3671) and is outside the diff, exactly as Bank Rec's
// `#rc_out` is. So are the two file chips' names and their green borders (`srFiles()`, app.html:3599).
// All of it is mirrored here anyway — leaving it out would wire four buttons to nothing — and pinned by
// assertion in web/tests/finance-salesrecon.parity.test.tsx.
//
// ── THE DRAG/DROP AND FILE LISTENERS ARE NOT PROPS, BECAUSE THEY ARE NOT ATTRIBUTES ────────────────
// `renderSalesRecon()` attaches them with `addEventListener` after the write, so the golden carries no
// `ondrop=` and no `onchange=`. The route does the same, by the same element ids (`sr-drop`, `sr-fi`).
// Adding them as React props here would be five handlers the golden does not carry, and handler parity
// would fail — correctly. The drop zone's `onclick` IS an attribute and IS a prop.
//
// ── THE PERMISSION GATE ────────────────────────────────────────────────────────────────────────────
// `renderSalesRecon()` has no role check at all. `showApp()` (app.html:1420-1439) gates the tab, and
// Sales Recon is NAMED in that chain — `else if(t==='salesrecon') el.classList.toggle('hide',
// !canManage)`, app.html:1433 — so it is the ADMIN gate, `PERMS.manage_users`, and NOT the feature-flag
// fall-through that `collections`, `recon`, `qinv`, `approvals` and `o2o` land in. The whole block has
// to be read before trusting one line of it: `users` is set by `!canManage` and then OVERWRITTEN by the
// final `else`, and `pharm`/`info`/`calendar` are always visible and gated server-side. The legacy
// comment on 1433 says why this one is admin: "Sales Reconciliation → Xero import". The server is
// stricter still — all three `sr_*` handlers require `superAdmin` (finance.ts:857, 899, 926) — so this
// is tab visibility, not the boundary. `salesreconReachable()` mirrors the line; the route refuses to
// load or render on a false and the screen's test pins both directions plus the withheld one.

import { SR_ACCNAME, type SrLine, type SrSummary, type SrTallyRow } from '../../salesrecon.js';

/** `PERMS` — resolved by `showApp()` (app.html:1416). Only `manage_users` decides this tab. */
export interface Perms {
  manage_users?: boolean;
  features?: string[] | null;
}

/**
 * app.html:1433 — `else if(t==='salesrecon') el.classList.toggle('hide', !canManage)`, where
 * `canManage` is `!!PERMS.manage_users` (app.html:1420).
 *
 * Exported from the screen, not hidden in the route, so the screen's own test can pin both directions —
 * including that it is NOT the feature flag its neighbours in the chain's final `else` use.
 */
export function salesreconReachable(perms: Perms | null | undefined): boolean {
  return !!(perms && perms.manage_users);
}

/** app.html:1253 — `M`. Mirrored rather than imported: it is inline in app.html, not in a shared file. */
const M = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Every inline style is the legacy STRING, split mechanically — same reason src/finance-wht.tsx gives:
 * nothing in parity.ts touches an attribute value, so these are compared character for character, and a
 * React style OBJECT with a numeric value would let React re-serialise it or append `px` silently.
 */
function st(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of css.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const key = name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[key] = part.slice(at + 1).trim();
  }
  return out;
}

/** What `srRenderResult()` (app.html:3671) paints. `null` is the golden's state: `#sr-result` is `hide`. */
export interface SrResult {
  lines: SrLine[];
  summary: SrSummary;
  /** `SR.tally` — null when the Order Form carried no "Grand Total" column. */
  tally: SrTallyRow[] | null;
}

export interface FinanceSalesReconProps {
  /** `#sr-chip-of-s`'s text. NULL → "not loaded", which is the golden. */
  ofName: string | null;
  /** `#sr-chip-sf-s`'s text, already carrying the ` · N sheets` suffix the legacy appends. */
  sfName: string | null;
  /** `#sr-build`'s `disabled` — the legacy sets it to `!(SR.of&&SR.sf)`. */
  canBuild: boolean;
  /** `#sr-post-btn`'s `disabled` — `SR._posting` (app.html:3777). */
  posting: boolean;
  result: SrResult | null;
  onReset: () => void;
  /** The drop zone's `onclick="document.getElementById('sr-fi').click()"`. */
  onOpenPicker: () => void;
  onBuild: () => void;
  onPostXero: () => void;
  onDownloadCsv: () => void;
  onDownloadXlsx: () => void;
}

/** `srRenderResult()`'s four cards — app.html:3675. */
function Cards({ lines, summary }: SrResult) {
  const cards: [string, string, string][] = [
    ['Sales invoice lines', lines.length + '', ''],
    ['Matched to SO', summary.matched + '', 'var(--green-soft)'],
    ['Unmatched (YRDZ)', summary.unmatched + ' · ' + M(summary.unmatchedAmt), 'var(--amber)'],
    ['Total (actual received)', M(summary.tot), 'var(--coral-soft)'],
  ];
  return (
    <>{cards.map((c) => (
      <div key={c[0]} style={st('background:var(--panel-2);border:1px solid var(--border);border-radius:11px;padding:12px 14px')}>
        <div className="muted" style={st('font-size:11px')}>{c[0]}</div>
        <div style={st('font-size:18px;font-weight:700;margin-top:2px;' + (c[2] ? ('color:' + c[2]) : ''))}>{c[1]}</div>
      </div>
    ))}</>
  );
}

/**
 * `srRenderResult()`'s revenue-by-account rows — app.html:3676.
 *
 * `SR_ACCNAME` is salesrecon.js's own table, IMPORTED rather than retyped — a copied account name here
 * would be a second copy of the chart of accounts. The codes are sorted exactly as the legacy sorts
 * `Object.keys(byAcc)`; nothing else is re-derived.
 */
function AcctRows({ summary }: { summary: SrSummary }) {
  return (
    <>{Object.keys(summary.byAcc).sort().map((code) => {
      const a = summary.byAcc[code];
      return (
        <tr key={code}>
          <td><b>{code}</b></td>
          <td className="muted">{SR_ACCNAME[code] || ''}</td>
          <td className="muted" style={st('font-size:11px')}>{Object.keys(a.ch).join(' / ')}</td>
          <td className="amt" style={st('text-align:right')}>{a.n}</td>
          <td className="amt" style={st('text-align:right;font-weight:600')}>{M(a.amt)}</td>
        </tr>
      );
    })}</>
  );
}

/** `srRenderResult()`'s SO tally block — app.html:3679-3700. */
function Tally({ tally }: { tally: SrTallyRow[] | null }) {
  if (!tally) return <div className="muted" style={st('font-size:11px')}>SO amount tally skipped — no &quot;Grand Total&quot; column found in the Order Form.</div>;
  let ok = 0, sh = 0, ov = 0, nt = 0;
  tally.forEach((x) => { if (x.st === 'tally') ok++; else if (x.st === 'short') sh++; else if (x.st === 'over') ov++; else nt++; });
  const pill = (txt: string, col: string, bg: string) => (
    <span style={st('padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:700;color:' + col + ';background:' + bg)}>{txt}</span>
  );
  const mism = tally.filter((x) => x.st === 'short' || x.st === 'over');
  return (
    <>
      <div style={st('font-size:12px;font-weight:600;margin:6px 0')}>SO amount tally — Order Form (Grand Total) vs payments received</div>
      <div style={st('display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px')}>
        {pill('✓ Tally: ' + ok, 'var(--green-soft)', 'rgba(22,185,122,.14)')}
        {pill('⚠ Short-paid: ' + sh, 'var(--amber)', 'rgba(245,158,11,.14)')}
        {pill('⚠ Over-paid: ' + ov, 'var(--coral-soft)', 'rgba(232,93,60,.14)')}
        {nt ? pill('No order total: ' + nt, 'var(--muted)', 'rgba(255,255,255,.05)') : null}
      </div>
      {!mism.length
        ? <div style={st('font-size:12.5px;color:var(--green-soft)')}>✓ Every matched SO’s payments equal its Order Form Grand Total.</div>
        : <>
            <div className="tbl-wrap" style={st('max-height:300px;overflow:auto')}>
              <table className="bigtable">
                <thead><tr><th>SO</th><th>Channel</th><th className="amt" style={st('text-align:right')}>Order total</th><th className="amt" style={st('text-align:right')}>Already in Xero</th><th className="amt" style={st('text-align:right')}>This file</th><th className="amt" style={st('text-align:right')}>Total paid</th><th className="amt" style={st('text-align:right')}>Diff</th><th></th></tr></thead>
                <tbody>{mism.slice(0, 200).map((x, i) => {
                  const col = x.st === 'short' ? 'var(--amber)' : 'var(--coral-soft)';
                  // Keyed by POSITION: the legacy renders `mism` in its own sorted order (worst diff
                  // first) and this must not re-sort, re-group or de-duplicate it.
                  return (
                    <tr key={i}>
                      <td><b>{x.so}</b></td>
                      <td className="muted">{x.ch}</td>
                      <td className="amt" style={st('text-align:right')}>{x.order.toFixed(2)}</td>
                      <td className="amt" style={st('text-align:right')}>{x.prev.toFixed(2)}</td>
                      <td className="amt" style={st('text-align:right')}>{x.file.toFixed(2)}</td>
                      <td className="amt" style={st('text-align:right;font-weight:600')}>{x.total.toFixed(2)}</td>
                      <td className="amt" style={st('text-align:right;font-weight:700;color:' + col)}>{(x.diff > 0 ? '+' : '') + x.diff.toFixed(2)}</td>
                      <td><span style={st('color:' + col + ';font-size:11px;font-weight:700')}>{x.st === 'short' ? 'SHORT' : 'OVER'}</span></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            {mism.length > 200 ? <div className="muted" style={st('font-size:11px;margin-top:4px')}>{'Showing worst 200 of ' + mism.length + ' — full list in the xlsx report (SO Tally sheet).'}</div> : null}
          </>}
      <div className="muted" style={st('font-size:11px;margin-top:6px')}>Short-paid can be a legit instalment (balance next month). &quot;Already in Xero&quot; = invoices previously imported for that SO (base + _N) — if this file’s own import is still sitting in Xero as drafts, delete them before rebuilding or amounts double-count.</div>
    </>
  );
}

/** `renderSalesRecon()` — app.html:3568. Owns every byte written into `#salesrecon`. */
export default function FinanceSalesRecon(props: FinanceSalesReconProps) {
  const r = props.result;
  const show = r ? r.lines.slice(0, 150) : [];
  return (
    <>
      <div style={st('margin-bottom:14px')}><h2 style={st('margin:0;font-size:19px')}>📊 Sales Reconciliation → Xero</h2>
        <div className="muted" style={st('font-size:12px')}>Match each collected payment to its order (via SO in PIC Name / Databees Order ID), tag Channel + Package, and build a Xero Sales Invoice import. Runs in your browser.</div></div>
      <div className="panel"><div className="panel-hd"><h3>1 · Drop the two files</h3><button className="btn sm" onClick={props.onReset}>Clear</button></div>
        {/* The drag listeners are attached by the ROUTE with addEventListener, by this id, exactly as
            renderSalesRecon() does — see the header. Only the click is an attribute in the golden. */}
        <div id="sr-drop" style={st('border:1.5px dashed var(--border);border-radius:12px;padding:22px;text-align:center;cursor:pointer;background:var(--panel-2)')} onClick={props.onOpenPicker}>
          Drop the <b style={st('color:var(--coral-soft)')}>Order Form</b> and the <b style={st('color:var(--coral-soft)')}>Sales (all gateways)</b> .xlsx here, or click.<br />
          <span className="muted" style={st('font-size:12px')}>Auto-detects which is which.</span>
          <input type="file" id="sr-fi" multiple accept=".xlsx,.xls" style={st('display:none')} /></div>
        <div style={st('display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px')}>
          {/* `srFiles()` (app.html:3599) repaints the chip border green on a recognised file. Outside
              every golden; mirrored so the operator can still see which file landed where. */}
          <div className="fchip" id="sr-chip-of" style={{ ...st('display:flex;gap:10px;align-items:center;background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px'), ...(props.ofName ? { borderColor: 'var(--green-soft)' } : {}) }}><div style={st('font-size:16px')}>📋</div><div><div style={st('font-weight:600;font-size:13px')}>Order Form</div><div className="muted" style={st('font-size:11.5px')} id="sr-chip-of-s">{props.ofName || 'not loaded'}</div></div></div>
          <div className="fchip" id="sr-chip-sf" style={{ ...st('display:flex;gap:10px;align-items:center;background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px'), ...(props.sfName ? { borderColor: 'var(--green-soft)' } : {}) }}><div style={st('font-size:16px')}>💰</div><div><div style={st('font-weight:600;font-size:13px')}>Sales (gateways)</div><div className="muted" style={st('font-size:11.5px')} id="sr-chip-sf-s">{props.sfName || 'not loaded'}</div></div></div>
        </div>
        <button className="btn p" id="sr-build" style={st('margin-top:14px')} onClick={props.onBuild} disabled={!props.canBuild}>Reconcile → Build Xero Import</button>
        <div className="muted" style={st('font-size:11px;margin-top:10px;line-height:1.6')}>Recognition is <b>content-based</b>: SO numbers, date & amount columns are detected from the data itself (any sheet/column naming works; known layouts are just a fast path; unrecognisable sheets are reported, never silently skipped). Basis = actual cash received. Matched → real SO no. + Channel account + Package — repeat payments on the same SO are suffixed <b>SO-XXXXX_1, _2 …</b> (checked against Xero so numbers never collide). After building: <b>🚀 Create in Xero</b> makes the DRAFT Sales Invoices directly (no CSV import needed — you approve them in Xero), or download the CSV as before. Unmatched (no SO) → auto <b>{"YRDZ_MM'YYYY_####"}</b> — numbering <b>continues from the highest YRDZ number already in Xero</b> for that month (checked live on build, no duplicates), Package <b>{'YRDZ_Package_<amount>'}</b>, account 500-1000. ContactName = DATABEES · TaxType = Tax Exempt · <b>InvoiceDate = payment-gateway transaction date (DD-MM-YYYY)</b> · DueDate = InvoiceDate. Swapped-date files are auto-detected per sheet and corrected — correct files are left untouched.</div>
      </div>
      <div className={r ? 'panel' : 'panel hide'} id="sr-result">
        <div className="panel-hd">
          <h3>2 · Result</h3>
          <div style={st('display:flex;gap:8px')}>
            <button className="btn p sm" id="sr-post-btn" onClick={props.onPostXero} disabled={props.posting}>🚀 Create in Xero (DRAFT)</button>
            <button className="btn sm" onClick={props.onDownloadCsv}>⬇ Xero Sales CSV</button>
            <button className="btn sm" onClick={props.onDownloadXlsx}>⬇ Full report (xlsx)</button>
          </div>
        </div>
        <div className="cards" id="sr-cards" style={st('display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px')}>{r ? <Cards {...r} /> : null}</div>
        <div style={st('font-size:12px;font-weight:600;margin:6px 0')}>Revenue by Account (Xero)</div>
        <div className="tbl-wrap" style={st('margin-bottom:14px')}><table className="bigtable"><thead><tr><th>Account</th><th>Name</th><th>Channels</th><th className="amt" style={st('text-align:right')}>Lines</th><th className="amt" style={st('text-align:right')}>Amount (MYR)</th></tr></thead>
          <tbody id="sr-acctbody">{r ? <AcctRows summary={r.summary} /> : null}</tbody></table></div>
        <div id="sr-tally" style={st('margin-bottom:14px')}>{r ? <Tally tally={r.tally} /> : null}</div>
        <div style={st('font-size:12px;font-weight:600;margin:6px 0')}>Sales Import preview (first 150)</div>
        <div className="tbl-wrap" style={st('max-height:360px;overflow:auto')}><table className="bigtable"><thead><tr><th>Contact</th><th>Invoice No</th><th>Date</th><th>Description</th><th className="amt" style={st('text-align:right')}>Amount</th><th>Acct</th><th>Gateway</th></tr></thead>
          <tbody id="sr-tbody">{show.map((l, i) => (
            // Keyed by POSITION. Two payment rows can carry the same SO, the same amount and the same
            // date and be different invoices; the invoice number is decided by pass 3's ORDER.
            <tr key={i}>
              <td className="muted">{l.contact}</td>
              <td style={st('color:' + (l.matched ? 'var(--text)' : 'var(--amber)'))}>{l.inv}</td>
              <td>{l.date}</td>
              <td className="muted">{l.desc}</td>
              <td className="amt" style={st('text-align:right;font-weight:600')}>{l.amt.toFixed(2)}</td>
              <td>{l.acc}</td>
              <td className="muted">{l.gw}</td>
            </tr>
          ))}</tbody></table></div>
        <div className="muted" style={st('font-size:11px;margin-top:10px')} id="sr-note">{r ? 'Preview shows first ' + show.length + ' of ' + r.lines.length + ' lines. Download includes all. Xero Sales CSV = ContactName/InvoiceNumber/InvoiceDate/DueDate/Description/Quantity/UnitAmount/AccountCode/TaxType.' : null}</div>
      </div>
    </>
  );
}
