// Finance OS · Gateway → Xero — the React half of `renderGateway()` (app.html:3769), the seventeenth
// Finance screen out of app.html.
//
// The legacy original is STILL THERE and still shipping; nothing was deleted from it except the
// arithmetic, which moved into `gateway.js` and is now loaded by BOTH. Both screens are reachable side
// by side (`app.html#tab=gateway` and `/finance/gateway/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no FileReader, no clock read. The
// file drop, the XLSX decode, the provider detection, the CSV download and the state live in
// app/finance/gateway/page.tsx, on the other side of that line.
//
// ── THE ARITHMETIC IS IMPORTED, NOT RE-EXPRESSED ───────────────────────────────────────────────────
// `gwConvertRows`, `gwTotals`, `gwWarning`, `gwAuditLines`, `gwMoney`, `gwCSV` and `gwOutName` come from
// `../../gateway.js` — the same classic script `app.html` now loads. They were lifted out of app.html by
// this migration for o2o.js's reason, only sharper: O2O at least posts through `o2o_issue`, whereas this
// screen talks to NO SERVER AT ALL. The CSV is written in the browser and imported straight into Xero,
// so there is no second computation anywhere that could disagree and be noticed. Contrast Quick Invoice,
// which correctly declined to lift its one `reduce` because Xero's own `iv.Total` is the authority
// there. Nothing in this file does money arithmetic; it renders what gateway.js returned.
//
// ── THE GOLDEN IS TWO SECTIONS, AND THE FIRST IS AN INTERMEDIATE STATE ─────────────────────────────
// CLAUDE.md's trap, and this screen falls into it TWICE over. `renderGateway()` writes `#gateway` once
// and then, after the drop listeners, calls `gwSetProv('payex')` (app.html:3822). That does four things
// the harness cannot see and one it can:
//   • `classList.toggle('p', …)` on the four provider buttons — INVISIBLE, so the golden carries
//     `class="btn sm"` on all four while every operator sees Payex highlighted as `btn sm p`;
//   • `#gw-drop-title`.textContent — INVISIBLE (and for `payex` it happens to equal the string already
//     written, so only the other three providers differ);
//   • `#gw-chip-b-t`.textContent — INVISIBLE and it DOES differ: the golden holds "Settlements (payout +
//     fees)" and an operator on the Payex tab reads "Settlements (payout + MDR)";
//   • `gwRefreshBtn()` sets `#gw-convert`.disabled — invisible, and it agrees with the `disabled` the
//     string already wrote;
//   • `#gw-ref`.innerHTML = the provider's reference options — an innerHTML write to an element WITH an
//     id, so the harness records it as its own section. `tests/golden/finance.gateway.html` therefore
//     carries `<!-- #gateway -->` with an EMPTY `<select id="gw-ref">` and `<!-- #gw-ref -->` holding
//     the four Payex options.
// So `provider` here is `GwProvider | null`, where `null` is the t=0 frame the `#gateway` section was
// captured in and the route always passes a real provider — the same shape `UsersSubnav`'s `active` prop
// has on finance.users. The screen's own test proves the claim by reading `renderGateway()` and
// `gwSetProv()` out of app.html rather than asserting it.
//
// ── FOUR GATEWAYS, ONE GOLDEN ──────────────────────────────────────────────────────────────────────
// The provider buttons are FOUR MODES of this screen and the golden covers exactly one of them, Payex,
// and only its t=0 frame at that. Every other mode — Atome, HitPay, NTT Data, and the whole `#gw-result`
// panel in all four — is outside the diff. Each is mirrored here and pinned by assertion in
// web/tests/finance-gateway.parity.test.tsx instead.

import * as React from 'react';

import {
  GW_REFOPTS, gwAuditLines, gwMoney, gwProvLabel, gwTotals, gwWarning,
  type GwAudit, type GwFiles, type GwProvider, type GwRow,
} from '../../gateway.js';

export type { GwAudit, GwFile, GwFiles, GwProvider, GwRow } from '../../gateway.js';

/** `{api:'my_perms'}`, as far as this screen reads it. */
export interface Perms { manage_users?: boolean | null }

/**
 * THE PERMISSION GATE — app.html:1434.
 *
 *   else if(t==='gateway') el.classList.toggle('hide', !canManage); // Gateway→Xero converter: admin-only
 *
 * INSIDE `showApp()`'s `if/else if` chain, so it never reaches the chain's final
 * `else el.classList.toggle('hide', feats.indexOf(t)<0)` — the FEATURE gate that `approvals`,
 * `collections`, `recon`, `qinv` and `o2o` fall through to. It is `manage_users` and only that, the same
 * kind of gate `selfbill`, `wht`, `bankfeed` and `salesrecon` carry on the lines around it. Read
 * app.html:1422-1441 as a whole before copying any one line of it: the block is not uniform, and the
 * `users` line two above is set by `!canManage` and then OVERWRITTEN by the final `else`.
 *
 * `renderGateway()` itself has no role check at all, so a port that mirrored only the renderer would
 * hand anyone who typed the URL a tool that reads a company's full gateway settlement history —
 * customer names, transaction ids, merchant fees and payout dates — and writes it out as a CSV.
 * There is no server side to be stricter here: this screen posts nothing, so the tab gate IS the gate.
 */
export function gatewayReachable(perms: Perms | null | undefined): boolean {
  return !!(perms && perms.manage_users);
}

/** The four provider tabs, in `gwSetProv()`'s own order (app.html:3826). */
export const GW_PROVIDERS: { id: GwProvider; label: string }[] = [
  { id: 'payex', label: 'Payex' },
  { id: 'atome', label: 'Atome' },
  { id: 'hitpay', label: 'HitPay' },
  { id: 'nttdata', label: 'NTT Data' },
];

/** `gwSetProv()`'s drop-zone heading — app.html:3828. `null` is the string `renderGateway()` wrote. */
export function dropTitle(p: GwProvider | null): string {
  if (!p) return '1 · Drop Payex files';
  return '1 · Drop ' + gwProvLabel(p) + (p === 'nttdata' ? ' file' : ' files');
}

/** `gwSetProv()`'s second-chip heading — app.html:3829. `null` is the string `renderGateway()` wrote. */
export function chipBTitle(p: GwProvider | null): string {
  if (!p) return 'Settlements (payout + fees)';
  return p === 'payex' ? 'Settlements (payout + MDR)'
    : p === 'hitpay' ? 'Payout list (net payout)'
    : p === 'nttdata' ? 'Payout + MDR (auto-derived, no 2nd file)'
    : 'Payout list (payout + fees)';
}

/**
 * `gwSetProv()`'s chip-B slot — app.html:3833. NTT Data is single-file, so chip B MIRRORS the
 * transaction file because payout + MDR are derived from it; Payex's second file is `set`, everyone
 * else's is `payout`. Getting this wrong shows "not loaded" next to a file the operator just dropped.
 */
export function chipBFile(p: GwProvider | null, f: GwFiles | null | undefined): { name: string; rows: unknown[] } | null {
  if (!p || !f) return null;
  const got = p === 'payex' ? f.set : p === 'nttdata' ? f.txn : f.payout;
  return got ? { name: got.name, rows: got.rows } : null;
}

/** `gwRefreshBtn()` — app.html:3837. Convert is enabled once EITHER half is loaded, not both. */
export function convertDisabled(p: GwProvider | null, f: GwFiles | null | undefined): boolean {
  if (!p || !f) return true;
  const out = p === 'payex' ? f.set : f.payout;
  return !(f.txn || out);
}

/**
 * `gwDownload()`'s slice — app.html:3890. The CSV is the thing that leaves the building, so which rows
 * it carries is split out of the route and pinned by assertion, the same way `bankFile()` is on
 * hr-expenses: no golden sees a downloaded file.
 *
 * Note `'out'` is `kind !== 'in'`, NOT `kind === 'out'`. "Settlements only" includes the fee lines;
 * a slice that dropped them hands Xero payouts that never reconcile against the gross.
 */
export function downloadRows(which: 'all' | 'in' | 'out', rows: GwRow[]): GwRow[] {
  if (which === 'in') return rows.filter((r) => r.kind === 'in');
  if (which === 'out') return rows.filter((r) => r.kind !== 'in');
  return rows;
}

/**
 * The legacy inline styles, split mechanically rather than retyped as objects.
 * See src/finance-wht.tsx for why the STRING is the source: React appends `px` to a bare number and
 * re-serialises `.15` as `0.15`, and no relaxation touches an attribute value.
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

const SELECT_CSS = 'width:100%;padding:8px;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;color:var(--text)';
const CHIP_CSS = 'display:flex;align-items:center;gap:10px;background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px';

/** What `gwConvert()` produced, plus what it needs to describe itself. `null` = `#gw-result` is hidden. */
export interface GwResult {
  provider: GwProvider;
  rows: GwRow[];
  audit: GwAudit;
  /** The files that were converted — `gwWarning()` reads them to say what the CSV is missing. */
  files: GwFiles;
}

export interface GatewayProps {
  /** `null` is the t=0 frame the `#gateway` golden section holds — see this file's header. */
  provider: GwProvider | null;
  /** That provider's loaded files. Drives both chips and the Convert button's disabled state. */
  files: GwFiles | null;
  result: GwResult | null;
  /** `gwSetProv(p)` — the four provider tabs. */
  onProvider: (p: GwProvider) => void;
  /** `gwReset()` — the Clear button. */
  onReset: () => void;
  /**
   * The drop zone's `onclick="document.getElementById('gw_fi').click()"`. It calls no screen function,
   * so the screen's test escapes it POSITIONALLY against the golden's own text — the same treatment
   * hr-expenses gives `event.stopPropagation()` and finance-pharm gives its row hover handlers.
   */
  onBrowse: () => void;
  /** `gwConvert()` — the Convert button. */
  onConvert: () => void;
  /** `gwDownload(which)` — the three result buttons. */
  onDownload: (which: 'all' | 'in' | 'out') => void;
}

export default function FinanceGateway(p: GatewayProps): React.JSX.Element {
  const refOpts = p.provider ? GW_REFOPTS[p.provider] : [];
  return (
    <>
      <div style={st('margin-bottom:14px')}>
        <h2 style={st('margin:0;font-size:19px')}>🔁 Gateway → Xero</h2>
        <div className="muted" style={st('font-size:12px')}>Convert Payex / Atome / HitPay / NTT Data Transaction &amp; Settlement exports into a Xero bank-statement CSV. Everything runs in your browser — no data leaves this page.</div>
      </div>
      <div style={st('display:flex;gap:8px;margin-bottom:14px')}>
        {GW_PROVIDERS.map((x) => (
          <button key={x.id} className={'btn sm' + (p.provider === x.id ? ' p' : '')} id={'gw-pt-' + x.id}
            onClick={() => p.onProvider(x.id)}>{x.label}</button>
        ))}
      </div>
      <div className="panel">
        <div className="panel-hd">
          <h3 id="gw-drop-title">{dropTitle(p.provider)}</h3>
          <button className="btn sm" onClick={() => p.onReset()}>Clear</button>
        </div>
        <div id="gw-drop" style={st('border:1.5px dashed var(--border);border-radius:12px;padding:22px;text-align:center;cursor:pointer;background:var(--panel-2)')} onClick={() => p.onBrowse()}>
          Drop the <b style={st('color:var(--coral-soft)')}>Transaction</b> and <b style={st('color:var(--coral-soft)')}>Settlement / Payout</b> files (.xlsx / .csv) here, or click to choose.<br />
          <span className="muted" style={st('font-size:12px')}>The tool auto-detects which file is which.</span>
          <input type="file" id="gw_fi" multiple accept=".xlsx,.xls,.csv" style={st('display:none')} />
        </div>
        <div style={st('display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px')}>
          <Chip slot="a" title="Transactions (money in)" arrow="↑" file={p.files?.txn ?? null} />
          <Chip slot="b" title={chipBTitle(p.provider)} arrow="↓" file={chipBFile(p.provider, p.files)} />
        </div>
      </div>
      <div className="panel">
        <div className="panel-hd"><h3>2 · Options</h3></div>
        <div style={st('display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px')}>
          <div>
            <label className="muted" style={st('font-size:11px')}>Date format</label>
            <select id="gw-datefmt" style={st(SELECT_CSS)} defaultValue="ymd">
              <option value="ymd">YYYY-MM-DD (recommended for Xero import)</option>
              <option value="dmy">DD/MM/YYYY</option>
            </select>
          </div>
          <div>
            <label className="muted" style={st('font-size:11px')}>Money-in Reference</label>
            {/*
              UNCONTROLLED, and it keeps the legacy id, because the route reads it back out of the DOM
              exactly as `gwConvert()` does (`document.getElementById('gw-ref').value`). `key` remounts
              it when the provider changes, which is what the legacy `innerHTML=` assignment does to the
              selection — without it the operator's previous choice would survive into a provider whose
              reference fields are entirely different columns.
            */}
            <select key={p.provider ?? 'none'} id="gw-ref" style={st(SELECT_CSS)} defaultValue={refOpts[0]?.[0]}>
              {refOpts.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
            </select>
          </div>
          <div>
            <label className="muted" style={st('font-size:11px')}>Settlement / payout lines</label>
            <div style={st('display:flex;align-items:center;gap:8px;font-size:13px;padding:5px 0')}>
              <input type="checkbox" id="gw-payout" defaultChecked style={st('accent-color:var(--coral)')} />
              <span>Payout to bank (−net)</span>
            </div>
            <div style={st('display:flex;align-items:center;gap:8px;font-size:13px')}>
              <input type="checkbox" id="gw-fee" defaultChecked style={st('accent-color:var(--coral)')} />
              <span>Merchant fees (MDR / Atome)</span>
            </div>
          </div>
        </div>
        <button className="btn p" id="gw-convert" style={st('margin-top:14px')} onClick={() => p.onConvert()}
          disabled={convertDisabled(p.provider, p.files)}>Convert →</button>
        <div className="muted" style={st('font-size:11px;margin-top:10px;line-height:1.6')}>Clearing-account model: each transaction = one money-in line (gross); each settlement/payout = one payout line (net, reconcile in Xero as a <b>Transfer</b> to your real bank) + one fee line (code to bank/merchant-fee expense). The account balance is the unsettled float — that is normal.</div>
      </div>
      <Result result={p.result} onDownload={p.onDownload} />
    </>
  );
}

/**
 * One file chip — `gwSetChip()` (app.html:3839). The border colour is the only thing that says a file
 * arrived, so the loaded branch overrides `borderColor` and the empty one leaves the shorthand alone:
 * emitting `border-color:var(--border)` alongside the shorthand would diff against the golden while
 * meaning the same thing, which is exactly the kind of tidy-up a migration must not make.
 */
function Chip({ slot, title, arrow, file }: {
  slot: 'a' | 'b'; title: string; arrow: string; file: { name: string; rows: unknown[] } | null;
}) {
  const style = file ? { ...st(CHIP_CSS), borderColor: 'var(--green-soft)' } : st(CHIP_CSS);
  return (
    <div className="fchip" id={'gw-chip-' + slot} style={style}>
      <div style={st('font-size:16px')}>{arrow}</div>
      <div>
        <div style={st('font-weight:600;font-size:13px')} id={'gw-chip-' + slot + '-t'}>{title}</div>
        <div className="muted" style={st('font-size:11.5px;word-break:break-all')} id={'gw-chip-' + slot + '-s'}>
          {file ? file.name + ' · ' + file.rows.length + ' rows' : 'not loaded'}
        </div>
      </div>
    </div>
  );
}

/**
 * `#gw-result` — hidden until `gwRenderResult()` (app.html:3873) fills it, which is why the golden
 * holds `class="panel hide"` and four empty divs. EVERY figure this screen produces lives in here, so
 * the diff proves the frame and nothing else; the states below are pinned by assertion in the screen's
 * own test. Same shape as `finance.collections`' `#collres`.
 */
function Result({ result, onDownload }: { result: GwResult | null; onDownload: GatewayProps['onDownload'] }) {
  const T = result ? gwTotals(result.rows) : null;
  const rows = result ? result.rows : [];
  const show = rows.slice(0, 200);
  const cards: [string, string, string, string][] = T && result
    ? [
        ['Money-in (sales)', T.cIn + ' lines', gwMoney(T.sIn), 'var(--green-soft)'],
        ['Payout to bank', T.cOut + ' lines', gwMoney(T.sOut), 'var(--coral-soft)'],
        ['Merchant fees', '', gwMoney(T.sFee), 'var(--amber)'],
        ['Net movement', rows.length + ' rows', gwMoney(T.net), T.net >= 0 ? 'var(--green-soft)' : 'var(--coral-soft)'],
      ]
    : [];
  const chk = result ? gwAuditLines(result.provider, result.audit) : null;
  const warn = result ? gwWarning(result.provider, result.files) : '';
  return (
    <div className={'panel' + (result ? '' : ' hide')} id="gw-result">
      <div className="panel-hd">
        <h3>3 · Result <span className="muted" id="gw-result-prov" style={st('font-size:12px')}>{result ? '· ' + result.provider.toUpperCase() : ''}</span></h3>
        <div style={st('display:flex;gap:8px')}>
          <button className="btn sm" onClick={() => onDownload('all')}>⬇ Xero CSV (combined)</button>
          <button className="btn sm" onClick={() => onDownload('in')}>money-in only</button>
          <button className="btn sm" onClick={() => onDownload('out')}>settlements only</button>
        </div>
      </div>
      <div className="cards" id="gw-cards" style={st('display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px')}>
        {cards.map((c) => (
          <div key={c[0]} style={st('background:var(--panel-2);border:1px solid var(--border);border-radius:11px;padding:12px 14px')}>
            <div className="muted" style={st('font-size:11px')}>{c[0] + (c[1] ? ' · ' + c[1] : '')}</div>
            <div style={{ ...st('font-size:18px;font-weight:700;margin-top:2px'), color: c[3] }}>{c[2]}</div>
          </div>
        ))}
      </div>
      <div id="gw-balbox">
        {chk ? (
          <div style={{
            ...st('border-radius:10px;padding:10px 12px;font-size:12px;margin-bottom:10px;color:var(--text-soft)'),
            background: chk.allOk ? 'rgba(61,220,151,.08)' : 'rgba(242,180,92,.1)',
            border: '1px solid ' + (chk.allOk ? 'rgba(61,220,151,.3)' : 'rgba(242,180,92,.35)'),
          }}>
            <b style={{ color: chk.allOk ? 'var(--green-soft)' : 'var(--amber)' }}>{chk.allOk ? '✓ Data check passed — every input row accounted for' : '⚠ Data check — please review below'}</b>
            <div style={st('margin-top:4px;line-height:1.65')}>
              {chk.lines.map((x, i) => <React.Fragment key={x}>{i ? <br /> : null}{x}</React.Fragment>)}
            </div>
          </div>
        ) : null}
        {warn ? (
          <div style={st('background:rgba(242,180,92,.1);border:1px solid rgba(242,180,92,.35);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--amber);margin-bottom:10px')}>{'⚠ ' + warn}</div>
        ) : null}
      </div>
      <div className="tbl-wrap" style={st('max-height:420px;overflow:auto')}>
        <table className="bigtable">
          <thead><tr>
            <th>Date</th><th>Type</th><th>Payee</th><th>Description</th><th>Reference</th>
            <th className="amt" style={st('text-align:right')}>Amount</th>
          </tr></thead>
          <tbody id="gw-tbody">
            {show.map((r, i) => {
              const col = r.kind === 'in' ? 'var(--green-soft)' : r.kind === 'fee' ? 'var(--amber)' : 'var(--coral-soft)';
              return (
                <tr key={i}>
                  <td>{r.date}</td>
                  <td><span className="pill" style={{ ...st('font-size:10px;text-transform:uppercase'), color: col }}>{r.kind}</span></td>
                  <td>{r.payee}</td>
                  <td className="muted">{r.desc}</td>
                  <td className="muted">{r.ref}</td>
                  <td className="amt" style={{ ...st('text-align:right;font-weight:600'), color: col }}>{r.amount.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="muted" style={st('font-size:11px;margin-top:10px')} id="gw-prevnote">
        {result ? 'Preview shows first ' + show.length + ' of ' + rows.length + ' rows; download includes all.' : ''}
      </div>
    </div>
  );
}
