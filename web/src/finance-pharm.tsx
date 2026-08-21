// Finance OS · Pharmacies — the O2O master-data list, the tenth Finance screen out of app.html.
//
// The legacy original is `renderPharm()` (app.html:6598) and its renderer `pharmRender()`
// (app.html:6611). Both are STILL THERE and still shipping; nothing was deleted, and both screens are
// reachable side by side (`app.html#tab=pharm` and `/finance/pharm/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. The
// `{api:'pharmacy_list'}` load, the search debounce and the hand-off live in app/finance/pharm/page.tsx.
//
// ── THE GATE IS A SHAPE NO MIGRATED SCREEN HAS HAD YET ─────────────────────────────────────────────
// app.html:1425 is `el.classList.remove('hide')` — the tab is shown to EVERYONE, unconditionally, and
// the server decides what comes back (`portal_pharmacy_list` refuses a login without SKINDAE access).
// So `pharmReachable()` is `true`, and the branch that carries the security meaning is the OTHER one:
// what the screen renders when the server refuses. `renderPharm()` writes a 🔒 panel naming SKINDAE;
// a React port that rendered an empty table there would turn a refusal into "this company has no
// pharmacies", which reads as success. `Refused` below is that panel, mirrored character for character,
// and the screen's test pins it — no golden holds it.
//
// ── WHAT THE GOLDEN DOES NOT HOLD ─────────────────────────────────────────────────────────────────
// `tests/golden/finance.pharm.html` was captured from the fixture's `pharmacy_list`, which carries no
// `editable` flag — so PHARM_EDITABLE is false and the "+ New pharmacy" button, the empty state and the
// "Matches" card (search is empty) appear in NO golden. They are mirrored from app.html anyway, because
// leaving them out would drop the only way an admin creates a record, and they are asserted in the
// screen's own test instead of by the diff.
//
// `PHARM_ACTIVE !== null || PHARM_NEW` — `pharmRenderDetail()`, the seven-section profile form with its
// save, delete and Xero-contact-link modal — is a sibling PAGE that `pharmRender()` dispatches to
// (app.html:6622), not a branch of the list renderer. It IS ported now, in src/finance-pharm-detail.tsx
// + app/finance/pharm/detail/, and `onOpen`/`onNew` go there. `Refused` and `Failed` below are exported
// so that page renders the SAME refusal: it loads `pharmacy_list` too, and a refusal on a FORM must not
// read as "a pharmacy with no details".
//
// ── ARITHMETIC ────────────────────────────────────────────────────────────────────────────────────
// There is none to lift. The only number this screen computes is `(Number(p.commission_rate||19.2))
// .toFixed(1)` — a display echo of a stored rate; the figure that bills a pharmacy is computed in
// o2o.js and posted by `o2o_issue` (finance.ts:626). The DEFAULT is not retyped, though: `19.2` is
// o2o.js's `O2O_DISCOUNT_RATE`, the same constant that prices the invoice, so it is imported. A second
// literal here would be a screen quietly claiming a rate the biller does not use.

import { O2O_DISCOUNT_RATE } from '../../o2o.js';

/** One row of `pharmacy_list.pharmacies` — tests/render_fixtures.ts:88. */
export interface Pharmacy {
  id: number;
  name: string;
  city?: string | null;
  state?: string | null;
  pic_name?: string | null;
  pic_role?: string | null;
  pic_phone?: string | null;
  phone?: string | null;
  commission_rate?: number | string | null;
  outlet_count?: number | null;
  active?: boolean | null;
}

/**
 * app.html:1425 — `else if(t==='pharm') el.classList.remove('hide')`. Unconditional: no role, no
 * feature flag. Exported from the screen rather than hidden in the route so the screen's own test can
 * pin it against app.html's own text, exactly as `whtReachable()` is — a predicate that always returns
 * true is still the rule, and the day someone adds a client gate here the test is where it shows up.
 */
export function pharmReachable(): boolean {
  return true;
}

/** `pharmNormalize()` — app.html:6595. The search key for every field the box matches on. */
export function pharmNormalize(s: unknown): string {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * `pharmRender()`'s filter — app.html:6612-6619, field for field and in the same order.
 *
 * Split out because it decides which pharmacies an operator can see: a field dropped from this list
 * makes a pharmacy unfindable by the thing the operator typed, and the screen looks perfectly normal
 * while saying "No pharmacies match".
 */
export function visiblePharmacies(all: Pharmacy[], search: string): Pharmacy[] {
  const q = pharmNormalize(search);
  if (!q) return all.slice();
  return all.filter((p) =>
    pharmNormalize(p.name).indexOf(q) >= 0 ||
    pharmNormalize(p.city || '').indexOf(q) >= 0 ||
    pharmNormalize(p.state || '').indexOf(q) >= 0 ||
    pharmNormalize(p.pic_name || '').indexOf(q) >= 0 ||
    pharmNormalize(p.pic_phone || '').indexOf(q) >= 0 ||
    pharmNormalize(p.phone || '').indexOf(q) >= 0,
  );
}

export interface FinancePharmProps {
  /** `PHARM_DATA` — null is the pre-response state (`spin('pharm')`), not "no pharmacies". */
  pharmacies: Pharmacy[] | null;
  /** `PHARM_SEARCH`. */
  search: string;
  /** `PHARM_EDITABLE` — `r.editable`. FALSE in the golden. */
  editable: boolean;
  /** app.html:6603 — the server said `ok:false`. The SKINDAE refusal; see the header. */
  refused: string | null;
  /** app.html:6609 — `renderPharm()`'s catch: a transport failure, not a refusal. */
  failed: string | null;
  /** `_pharmSearchDebounced(this.value)` — app.html:6592. */
  onSearch: (v: string) => void;
  /** `pharmOpen(id)` — app.html:6667. */
  onOpen: (id: number) => void;
  /** `pharmNewStart()` — app.html:6668. */
  onNew: () => void;
}

/**
 * Every inline style is written as a STRING and split mechanically — the same `st()` the WHT pilot
 * introduced and for the same reason: nothing in parity.ts touches an attribute VALUE, so these are
 * compared character for character, and a style OBJECT hands React two chances to change one silently
 * (it appends `px` to a bare number and re-serialises `.03` as `0.03`).
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

/** `spin('pharm')` — app.html:1537, character for character. In no golden; see the route. */
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

/**
 * app.html:6603 — the server refused. THE branch this screen's gate lives in; see the header.
 *
 * Exported so the DETAIL page (src/finance-pharm-detail.tsx) renders the SAME refusal from the same
 * source rather than a second copy that can drift. Both pages load `pharmacy_list`, and a refusal on
 * either must read as a refusal — never as an empty form or an empty table.
 */
export function Refused({ message }: { message: string }) {
  return (
    <div className="empty">
      <div className="empty-ico">🔒</div>
      <div>{message}</div>
      <div className="muted" style={st('font-size:12px;margin-top:6px')}>Pharmacies require SKINDAE access.</div>
    </div>
  );
}

/** app.html:6609 — `renderPharm()`'s catch. No SKINDAE sentence: it is not a refusal. Exported for the
 * detail page, for the same reason `Refused` is. */
export function Failed({ message }: { message: string }) {
  return <div className="empty"><div className="empty-ico">⚠️</div><div>{message}</div></div>;
}

/** app.html:6630 — one summary card. */
function Card({ colour, n, label }: { colour: string; n: number; label: string }) {
  return <div className="card"><div className="n" style={st('color:' + colour)}>{String(n)}</div><div className="l">{label}</div></div>;
}

/**
 * `pharmRender()` — app.html:6611. This component is every byte written into the `#pharm` tab div.
 */
export default function FinancePharm(props: FinancePharmProps) {
  if (props.refused !== null) return <Refused message={props.refused} />;
  if (props.failed !== null) return <Failed message={props.failed} />;
  // `pharmacies === null` is the pre-response state, NOT app.html:6640's "No pharmacies yet" — a list
  // that arrived empty is a different document from one that has not arrived.
  if (!props.pharmacies) return <Loading />;

  const all = props.pharmacies;
  const q = pharmNormalize(props.search);
  const visible = visiblePharmacies(all, props.search);
  const activeCount = all.filter((p) => p.active).length;

  return (
    <>
      <div style={st('display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px')}>
        <div style={st('flex:1;min-width:240px;max-width:520px')}>
          {/* UNCONTROLLED, keeping the legacy id: `pharm-search` is what the legacy DOM writes back into
              on every re-render, and a controlled input would add an attribute the golden does not have. */}
          <input id="pharm-search" defaultValue={props.search}
                 onInput={(e) => props.onSearch((e.target as HTMLInputElement).value)}
                 placeholder="🔍 Search pharmacy / city / PIC / phone…"
                 style={st('width:100%;background:var(--panel-2);border:1px solid var(--panel-border);color:var(--text);padding:9px 12px;border-radius:8px;font-size:13px')} />
        </div>
        {props.editable ? <button className="btn p" onClick={props.onNew}>+ New pharmacy</button> : null}
      </div>
      <div className="cards" style={st('margin-bottom:14px')}>
        <Card colour="var(--coral-soft)" n={all.length} label="Total pharmacies" />
        <Card colour="var(--green-soft)" n={activeCount} label="Active" />
        <Card colour="var(--muted)" n={all.length - activeCount} label="Inactive" />
        {q ? <Card colour="var(--sky-soft)" n={visible.length} label="Matches" /> : null}
      </div>
      {visible.length === 0
        ? (
          <div className="empty" style={st('padding:40px 24px')}>
            <div className="empty-ico">🏪</div>
            <div style={st('font-size:15px;margin-top:8px')}>{q ? 'No pharmacies match "' + props.search + '"' : 'No pharmacies yet'}</div>
            {props.editable && !q
              ? <div style={st('margin-top:14px')}><button className="btn p" onClick={props.onNew}>+ Add your first pharmacy</button></div>
              : null}
          </div>
        )
        : (
          <div style={st('background:var(--panel);border:1px solid var(--panel-border);border-radius:12px;overflow:hidden')}>
            <table className="bigtable" style={st('width:100%;border-collapse:collapse')}>
              <thead>
                <tr>
                  <th style={st('text-align:left;padding:10px 14px')}>Pharmacy</th>
                  <th style={st('text-align:left;padding:10px 14px')}>Location</th>
                  <th style={st('text-align:left;padding:10px 14px')}>PIC</th>
                  <th style={st('text-align:left;padding:10px 14px')}>Phone</th>
                  <th style={st('text-align:right;padding:10px 14px')}>Commission</th>
                  <th style={st('text-align:center;padding:10px 14px')}>Status</th>
                  <th style={st('width:80px')}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => <Row key={p.id} p={p} onOpen={props.onOpen} />)}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}

/**
 * One pharmacy row — app.html:6656.
 *
 * The hover handlers are the legacy's own `this.style.background=` statements, which repaint the row
 * rather than call a screen function. `currentTarget` is guarded because the shared handler walker
 * (tests/handlers.ts) invokes every handler with a bare `{target:{value}}` stub — the same reason
 * hr-expenses writes `e.stopPropagation?.()`.
 */
function Row({ p, onOpen }: { p: Pharmacy; onOpen: (id: number) => void }) {
  const loc = [p.city, p.state].filter(Boolean).join(', ') || '—';
  const phone = p.pic_phone || p.phone;
  const paint = (colour: string) => (e: { currentTarget?: { style?: { background: string } } }) => {
    if (e && e.currentTarget && e.currentTarget.style) e.currentTarget.style.background = colour;
  };
  return (
    <tr onClick={() => onOpen(p.id)}
        style={st('cursor:pointer;border-top:1px solid var(--panel-border)')}
        onMouseOver={paint('rgba(255,255,255,.03)')}
        onMouseOut={paint('transparent')}>
      <td style={st('padding:10px 14px')}>
        <b>{p.name}</b>
        {p.outlet_count && p.outlet_count > 1 ? <> <span className="muted" style={st('font-size:11px')}>{'×' + p.outlet_count}</span></> : null}
      </td>
      <td style={st('padding:10px 14px')}>{loc}</td>
      <td style={st('padding:10px 14px')}>
        {p.pic_name
          ? <>{p.pic_name}{p.pic_role ? <div className="muted" style={st('font-size:11px')}>{p.pic_role}</div> : null}</>
          : <span className="muted">—</span>}
      </td>
      <td style={st('padding:10px 14px')}>{phone ? phone : <span className="muted">—</span>}</td>
      <td style={st('padding:10px 14px;text-align:right')}>{Number(p.commission_rate || O2O_DISCOUNT_RATE).toFixed(1) + '%'}</td>
      <td style={st('padding:10px 14px;text-align:center')}>
        {p.active
          ? <span className="pill pill-green" style={st('font-size:10px')}>Active</span>
          : <span className="pill" style={st('background:rgba(255,255,255,.06);color:var(--muted);font-size:10px')}>Inactive</span>}
      </td>
      <td style={st('padding:10px 14px;text-align:right')}><span className="muted">›</span></td>
    </tr>
  );
}
