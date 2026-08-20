// Finance OS · Bank Rec — the React half of `renderRecon()` (app.html:5958), the second Finance screen.
//
// The legacy original is STILL THERE and still shipping; nothing was deleted. Both are reachable side by
// side (`app.html#tab=recon` and `/finance/recon/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no FileReader, no clock read. The
// file read, the XLSX decode, the POST and the state live in app/finance/recon/page.tsx.
//
// ── WHAT THE GOLDEN HOLDS, AND WHAT IT DOES NOT ────────────────────────────────────────────────────
// `tests/golden/finance.recon.html` is `renderRecon()`'s output and nothing else: the panel, the company
// <select>, the file input, and an EMPTY `#rc_out`. Everything an operator actually reads on this screen
// — the three cards and the match table — is written later by `reconRun()` (app.html:5973) into that
// div, so NO golden reaches it. It is mirrored here anyway (leaving it out would wire the file input to
// nothing) and pinned in tests/finance-recon.parity.test.tsx instead of by the diff.
//
// ── MATCHING BY AMOUNT IS AMBIGUOUS, AND THE CLIENT DOES NOT RESOLVE IT ────────────────────────────
// Neither half of this screen matches anything. `bank_reconcile` (finance.ts:836) builds one `docs` list
// — every ACCREC with AmountDue > 0 FIRST, then every ACCPAY — and walks it per bank line taking the
// FIRST doc within 1 sen that is not already `used`, then marks it used. So when two invoices share a
// figure the earlier one in that order wins, the second bank line for the same figure gets the other,
// and a doc is never matched twice. That ordering is the server's, it arrives in `results` already
// decided, and this component renders `results[i].match` positionally — it does not re-match, re-order,
// group or de-duplicate. A port that sorted the rows, or filled a blank match from another row's
// candidate, would silently reconcile a payment against a different invoice; the screen's test pins the
// positional rendering in both directions (tie broken one way, and the same doc echoed on two rows).
//
// ── THE PERMISSION GATE, and how it differs from WHT's ─────────────────────────────────────────────
// `renderRecon()` has no role check. `showApp()` (app.html:1420-1434) gates the tab — but Bank Rec is
// NOT one of the seven `!canManage` tabs: it falls through to the chain's final `else`, so it is gated
// by the FEATURE list, `PERMS.features.indexOf('recon')`. `reconReachable()` below mirrors that line;
// the route refuses to load or render on a false and the screen's test pins both directions. The server
// is stricter (`bank_reconcile` wants isAdmin AND the tenant in `allowedTenants`, finance.ts:837-840),
// so this is tab visibility, not the boundary.

/** One parsed statement line — the shape `bank_reconcile` takes in `lines`. */
export interface ReconLine {
  date: string;
  amount: number;
  description: string;
}

/** `docs[i]` as the server hands it back — finance.ts:846. */
export interface ReconMatch {
  kind: string;
  contact?: string | null;
  number?: string | null;
}

/** One row of `bank_reconcile`'s `results` — finance.ts:849. */
export interface ReconRow {
  date: string;
  amount: number;
  description?: string | null;
  /** null = no outstanding doc within 1 sen was still unused. */
  match?: ReconMatch | null;
}

export interface ReconResponse {
  total: number;
  matched: number;
  results: ReconRow[];
}

/** `COMPANIES` — app.html:1253's company list, as `renderRecon()` reads it. */
export interface ReconCompany {
  tenant_id: string;
  tenant_name: string;
}

/** `PERMS` — resolved by `showApp()` (app.html:1416). Only `features` decides this tab. */
export interface Perms {
  features?: string[] | null;
}

/**
 * app.html:1434 — the final `else` of `showApp()`'s tab pass: `feats.indexOf(t)<0` hides the tab, and
 * `recon` is in `ALL_FEATURES` (app.html:1398) rather than in any of the `!canManage` branches above it.
 *
 * Exported from the screen, not hidden in the route, so the screen's own test can pin both directions.
 */
export function reconReachable(perms: Perms | null | undefined): boolean {
  return ((perms && perms.features) || []).indexOf('recon') >= 0;
}

/**
 * `bankParse()` — app.html:5934 — with the XLSX decode left in the route.
 *
 * Split out for the same reason `bankFile()` and `profileBody()` were on the HR side: no golden sees a
 * statement, so what this returns is provable nowhere else, and every figure it gets wrong is a payment
 * reconciled against the wrong invoice. `rows` is exactly what
 * `XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:null})` produces, so the route hands the sheet
 * over unchanged and the arithmetic below is the legacy's, line for line — including its quirks:
 *
 *   • only the first 18 rows are scanned for a header, and the FIRST row carrying a date column plus any
 *     of amount/debit/credit wins;
 *   • an Amount column takes precedence over Debit/Credit, and only falls back when the cell is null or
 *     blank — not when it is unparseable;
 *   • Debit/Credit becomes `credit - debit`, so a withdrawal is negative;
 *   • every non-numeric character is stripped before parseFloat, so `RM 1,234.50 CR` is 1234.50 and the
 *     CR is lost — the sign comes from the column, never from the text;
 *   • a row that parses to 0 is DROPPED, not sent as zero.
 */
export function bankLines(rows: unknown[][]): ReconLine[] {
  function find(row: unknown[], keys: string[]): number {
    for (let c = 0; c < row.length; c++) {
      const v = String(row[c] || '').trim().toLowerCase();
      for (let k = 0; k < keys.length; k++) { if (v.indexOf(keys[k]) >= 0) return c; }
    }
    return -1;
  }
  let hdr = -1;
  let map = { date: -1, amount: -1, debit: -1, credit: -1, desc: -1 };
  for (let r = 0; r < Math.min(rows.length, 18); r++) {
    const row = rows[r] || [];
    const di = find(row, ['date']);
    const ai = find(row, ['amount']);
    const debi = find(row, ['debit', 'withdraw']);
    const credi = find(row, ['credit', 'deposit']);
    const desci = find(row, ['desc', 'detail', 'narrat', 'particular', 'reference']);
    if (di >= 0 && (ai >= 0 || debi >= 0 || credi >= 0)) { hdr = r; map = { date: di, amount: ai, debit: debi, credit: credi, desc: desci }; break; }
  }
  if (hdr < 0) throw new Error('Could not detect columns. Statement needs headers like Date, Description, Amount (or Debit/Credit).');
  const out: ReconLine[] = [];
  for (let r = hdr + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const dt = row[map.date];
    if (dt == null || String(dt).trim() === '') continue;
    let amt = 0;
    if (map.amount >= 0 && row[map.amount] != null && String(row[map.amount]).trim() !== '') {
      amt = parseFloat(String(row[map.amount]).replace(/[^0-9.\-]/g, '')) || 0;
    } else {
      const deb = map.debit >= 0 ? parseFloat(String(row[map.debit] || '').replace(/[^0-9.\-]/g, '')) || 0 : 0;
      const cre = map.credit >= 0 ? parseFloat(String(row[map.credit] || '').replace(/[^0-9.\-]/g, '')) || 0 : 0;
      amt = cre - deb;
    }
    if (!amt) continue;
    out.push({ date: String(dt), amount: amt, description: map.desc >= 0 ? String(row[map.desc] || '') : '' });
  }
  return out;
}

/**
 * The body `reconRun()` (app.html:5973) POSTs.
 *
 * The TENANT is the whole point of pinning this. `reconRun()` reads it from the `rc_co` <select> and
 * refuses to run without one (`if(!t){toast('Pick a company',true);return;}`); the server then checks it
 * against `allowedTenants()` (finance.ts:840). A statement posted with the wrong tenant would be matched
 * against another company's outstanding invoices and every "✓" on the screen would be a lie, so the
 * throw below is deliberate: there is no default company and no fall-back to the first one.
 */
export function reconcileBody(tenant: string, lines: ReconLine[]): Record<string, unknown> {
  if (!tenant) throw new Error('Pick a company');
  return { api: 'bank_reconcile', tenant, lines };
}

/** What `#rc_out` holds. `null` is the golden's state — `renderRecon()` writes the div empty. */
export type ReconOut =
  | null
  /** `reconRun()`'s skeleton — app.html:5976. */
  | { kind: 'loading'; lines: number }
  /** `reconPick()`'s "No usable rows found in the statement." — app.html:5969. */
  | { kind: 'empty' }
  /** A parse error, a server `{ok:false}` or a thrown call — all three are the same red div. */
  | { kind: 'error'; message: string }
  | { kind: 'result'; data: ReconResponse };

export interface FinanceReconProps {
  /** `COMPANIES` — the `rc_co` options, in order. */
  companies: ReconCompany[];
  /** What `#rc_out` currently holds. NULL in the golden. */
  out: ReconOut;
  /** `reconPick(this)` — app.html:5966. The route reads `.files[0]` off the input. */
  onPick: (e: { target: unknown }) => void;
}

/** app.html:1253 — `M`. Mirrored rather than imported: it is inline in app.html, not in a shared file. */
const M = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Every inline style is the legacy STRING, split mechanically — same reason src/finance-wht.tsx gives:
 * nothing in parity.ts touches an attribute value, so these are compared character for character, and a
 * React style OBJECT would let React re-serialise a number or append `px` silently.
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

/** `reconRun()`'s results block — app.html:5978-5985. In NO golden; see the header. */
function Results({ data }: { data: ReconResponse }) {
  const rows = (data.results || []).map((x, i) => {
    const m = x.match;
    // ONE string, as the legacy concatenation reads it — `kind · contact number` with the legacy's own
    // spacing, including the trailing space when there is no number.
    const label = m ? m.kind + ' · ' + (m.contact || '') + ' ' + (m.number || '') : '';
    return (
      // Keyed by POSITION, not by amount or by doc number: two bank lines for the same figure are a
      // normal statement, and the server has already decided which doc each one took.
      <tr key={i}>
        <td>{x.date}</td>
        <td className="muted" style={st('font-size:11.5px')}>{(x.description || '').slice(0, 40)}</td>
        <td className="amt">{M(Math.abs(x.amount))}</td>
        <td>{m
          ? <><span className="pill pill-green">✓</span>{' ' + label}</>
          : <span className="pill pill-draft">no match</span>}</td>
      </tr>
    );
  });
  return (
    <>
      <div className="cards"><div className="card"><div className="n" style={st('color:var(--green-soft)')}>{data.matched}</div><div className="l">Matched</div></div>
        <div className="card"><div className="n" style={st('color:var(--amber)')}>{data.total - data.matched}</div><div className="l">Unmatched</div></div>
        <div className="card"><div className="n" style={st('color:var(--sky-soft)')}>{data.total}</div><div className="l">Bank lines</div></div></div>
      <div className="tbl-wrap"><table className="bigtable"><thead><tr><th>Date</th><th>Description</th><th className="amt">Amount</th><th>Xero match</th></tr></thead><tbody>{rows}</tbody></table></div>
    </>
  );
}

/** `renderRecon()` — app.html:5958. Owns every byte written into `#recon`. */
export default function FinanceRecon(props: FinanceReconProps) {
  const o = props.out;
  return (
    <div className="panel"><div className="panel-hd"><h3>🏦 Bank reconciliation <span className="pill pill-submit" style={st('font-size:9px')}>beta</span></h3></div>
      <p className="muted" style={st('font-size:12.5px;margin:0 0 12px')}>Upload a bank statement (CSV/Excel with Date, Description, Amount or Debit/Credit). Each line is matched by amount to your outstanding Xero invoices &amp; bills.</p>
      <div style={st('display:flex;gap:10px;flex-wrap:wrap;align-items:center')}>
        {/* UNCONTROLLED, and with the legacy `rc_co` id kept: `reconRun()` (app.html:5974) reads the
            chosen company back out of the DOM by that id, and so does the route. No `value` and no
            `defaultValue` — the legacy writes no `selected` either, so both sides land on the browser's
            default (the first option) and the golden is matched without leaning on relaxation R5. There
            is deliberately no onChange: adding one would be a handler the golden does not carry. */}
        <select id="rc_co" style={st('max-width:300px')}>
          {props.companies.map((c) => <option key={c.tenant_id} value={c.tenant_id}>{c.tenant_name}</option>)}
        </select>
        <input type="file" id="rc_file" accept=".csv,.xlsx,.xls" onChange={props.onPick} />
      </div>
      <div id="rc_out" style={st('margin-top:14px')}>
        {o === null ? null
          : o.kind === 'loading' ? <div className="load"><span className="spin"></span>{'Matching ' + o.lines + ' lines against Xero…'}</div>
          : o.kind === 'empty' ? <div style={st('color:var(--amber)')}>No usable rows found in the statement.</div>
          : o.kind === 'error' ? <div style={st('color:var(--red-soft)')}>{o.message}</div>
          : <Results data={o.data} />}
      </div></div>
  );
}
