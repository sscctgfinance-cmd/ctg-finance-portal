// Finance OS · Close (month-end close) — the fourteenth screen out of app.html.
//
// The legacy original is `renderClose()` (app.html:5738) with `closeLoad()`, `closeSet()` and
// `closeAssign()` below it. All of them are STILL THERE and still shipping; nothing was deleted. Both
// are reachable side by side (`app.html#tab=close` and `/finance/close/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. The
// `{api:'close_list'}` load, the `{api:'close_update'}` posts and the period the operator picks live in
// app/finance/close/page.tsx, on the other side of that line.
//
// ── THE GOLDEN IS TWO SECTIONS, AND `#close` IS AN INTERMEDIATE STATE ──────────────────────────────
// CLAUDE.md's finance.qinv / finance.ctgaccess trap, in ctgaccess's exact shape. `renderClose()` writes
// `#close` ONCE — the panel, with `<div id="close_out" class="muted">Loading…</div>` inside it — sets
// `loaded.close=true`, and then calls `closeLoad()`, which overwrites `#close_out`. Those are two
// DIFFERENT element ids, so the harness's last-write-wins is per id and both survive:
// `tests/golden/finance.close.html` carries `<!-- #close -->` holding the frame with that muted
// "Loading…" still in it, and `<!-- #close_out -->` holding the loaded checklist.
//
// So the `#close` section is the frame at t=0, NOT the screen an operator sees. This file renders both
// halves — `Screen` (the panel) composing `Body` (whatever is currently inside `#close_out`) — so each
// golden section is diffed against the state it was actually captured in. The screen's own test proves
// that claim by reading `renderClose()` out of app.html rather than asserting it from memory.
//
// Note there are TWO different "Loading…" documents on this screen and they are not interchangeable:
// the one `renderClose()` writes is bare text inside the muted `#close_out` div, and the one
// `closeLoad()` writes while the fetch is in flight is `<div class="load"><span class="spin">…`. That is
// what `initial` below distinguishes.
//
// ── ARITHMETIC ─────────────────────────────────────────────────────────────────────────────────────
// `finance.qinv`'s case, not `finance.o2o`'s — nothing is lifted. The only computation is the progress
// header: `done = tasks.filter(status==='done').length` and `pct = Math.round(done/total*100)`. The
// server (`close_list`, finance.ts:819) sends the task rows and no percentage, and `close_update`
// (finance.ts:826) writes ONE task's status by id — it never reads or re-derives a completion figure.
// So the percentage is a display echo of rows the server owns, not a formula anything is posted
// against, and inventing a `close.js` for one `Math.round` would be a larger change than the migration.
// Mirrored inline and pinned by assertion in the screen's test.

import * as React from 'react';

/** One row of `{api:'close_list'}`.tasks — `portal_close_tasks`, finance.ts:821. */
export interface CloseTask {
  id: string;
  period?: string;
  title: string;
  category?: string | null;
  status: string;
  assignee?: string | null;
}

/** `{api:'my_perms'}`, as far as this screen reads it. */
export interface Perms { features?: string[] | null }

/**
 * THE PERMISSION GATE — app.html:1420-1439, and it is the FEATURE FLAG.
 *
 * `close` is named in NO branch of `showApp()`'s pass over the tabs: not the two standalone `if`s
 * (`users`, `ctgaccess`), not `info` / `pharm` / `calendar` (always visible, gated server-side), not
 * `ocr` / `ap` (hidden from everyone), and not the six `!canManage` branches (`selfbill`, `wht`,
 * `gateway`, `bankfeed`, `salesrecon`). So it falls through to the chain's final
 * `else el.classList.toggle('hide', feats.indexOf(t)<0)` — the same kind of gate `collections`, `recon`,
 * `qinv`, `approvals` and `o2o` have, and NOT the admin gate its Operations neighbours might suggest.
 * The screen's test reads that whole block out of app.html and asserts `close` is named in none of it,
 * so this predicate cannot quietly stop mirroring the app.
 *
 * `renderClose()` itself has no role check at all, so a port that mirrored only the renderer would show
 * every company's month-end checklist — and live controls that mark a statutory step complete — to
 * anyone who typed the URL.
 *
 * The SERVER is stricter: both `close_list` and `close_update` require `isAdmin(me)` (finance.ts:820,
 * :827). This is tab visibility, not the boundary — same relationship `finance.wht` has.
 */
export function closeReachable(perms: Perms | null | undefined): boolean {
  return ((perms && perms.features) || []).indexOf('close') >= 0;
}

/**
 * `renderClose()`'s default period — app.html:5739, `todayLocalISO().slice(0,7)`.
 *
 * A derivation from the CLOCK, so it is lifted out of the component as a pure function of the instant
 * it is handed (the hr.yearend rule). The +8h is Malaysia and the legacy's own comment says why it
 * matters here specifically: before 8am on the 1st, a UTC read pre-selects LAST month, and a checklist
 * labelled August whose rows are July's is exactly the "period label that does not match the data
 * underneath it" defect. The route hands it the real clock; the test hands it the harness's FIXED_MS.
 *
 * ponytail: three lines mirroring app.html:1259 rather than a shared `close.js` — see the header on
 * why nothing was lifted. src/finance-qinv.tsx carries the same mirror; that is the seam, left alone.
 */
export function defaultPeriod(nowMs: number): string {
  const d = new Date(nowMs + 8 * 3600000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

/** The progress header's two figures — app.html:5750. See the header: a display echo, not lifted. */
export function progress(tasks: CloseTask[]): { done: number; total: number; pct: number } {
  const done = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** The three statuses the select offers, in order — app.html:5757. */
export const CLOSE_STATUSES: [string, string][] = [
  ['pending', 'Pending'], ['in_progress', 'In progress'], ['done', 'Done'],
];

/**
 * `closeSet()` — app.html:5764. No golden sees a request body, and this one marks a month-end step
 * complete: a step that reports done when it is not is the whole risk on this screen.
 *
 * `close_update` (finance.ts:826) resolves the row by `id` alone and never re-checks the period, so the
 * id IS the month. A blank one is refused rather than posted, for the same reason `reconcileBody('')`
 * throws — a status written against the wrong row is invisible on screen.
 */
export function updateBody(id: string, status: string): Record<string, string> {
  if (!id) throw new Error('close_update needs the task it is updating');
  return { api: 'close_update', id, status };
}

/** `closeAssign()` — app.html:5765. Carries the task and the name, and nothing that could redirect it. */
export function assignBody(id: string, assignee: string): Record<string, string> {
  if (!id) throw new Error('close_update needs the task it is assigning');
  return { api: 'close_update', id, assignee };
}

/**
 * The legacy inline styles, split mechanically rather than retyped as objects.
 * See src/finance-wht.tsx:166 for why the STRING is the source: React appends `px` to a bare number and
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

export interface BodyProps {
  /** null while nothing has resolved. `initial` tells the two null states apart — see the header. */
  tasks: CloseTask[] | null;
  /** True only for the frame `renderClose()` writes, before `closeLoad()` has painted its own spinner. */
  initial?: boolean;
  /** Set when `{api:'close_list'}` came back not-ok, or threw — app.html:5746, :5761. */
  error?: string | null;
  /** `closeSet(id, status)` — the checkbox and the select both call it. */
  onSet: (id: string, status: string) => void;
  /** `closeAssign(id, assignee)` — the assignee box, on blur. */
  onAssign: (id: string, assignee: string) => void;
}

export type ScreenProps = BodyProps & {
  /** `close_period`'s value. UNCONTROLLED below — `closeLoad()` reads it back out of the DOM. */
  period: string;
  /** `closeLoad()` — both the input's onchange and the ↻ Load button. */
  onLoad: () => void;
};

/**
 * Whatever is currently inside `#close_out`. FOUR documents live here and the golden holds one:
 *   • the muted "Loading…" `renderClose()` itself writes (app.html:5740) — the `#close` golden section;
 *   • the in-flight spinner `closeLoad()` writes (app.html:5745) — a DIFFERENT document;
 *   • the load failure (app.html:5746 for `{ok:false}`, :5761 for a throw);
 *   • the checklist (app.html:5759), which is the `#close_out` golden.
 * The three the golden does not hold are pinned by assertion in the screen's own test.
 */
export function Body(p: BodyProps): React.JSX.Element {
  if (p.error) return <div style={st('color:var(--red-soft)')}>{p.error}</div>;
  if (p.tasks === null) {
    return p.initial
      ? <>Loading…</>
      : <div className="load"><span className="spin"></span>Loading…</div>;
  }
  const { done, total, pct } = progress(p.tasks);
  return (
    <>
      <div style={st('margin-bottom:16px')}>
        <div style={st('display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px')}>
          <span className="muted">{done + ' / ' + total + ' tasks done'}</span>
          <span style={st('font-weight:800;color:' + (pct === 100 ? 'var(--green-soft)' : 'var(--coral-soft)'))}>{pct + '%'}</span>
        </div>
        <div style={st('height:9px;border-radius:6px;background:rgba(7,13,23,.6);overflow:hidden')}>
          <div style={st('height:100%;width:' + pct + '%;background:linear-gradient(90deg,var(--coral),var(--green-soft));transition:width .3s')}></div>
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="bigtable">
          <thead><tr><th></th><th>Task</th><th>Status</th><th>Assignee</th></tr></thead>
          <tbody>{p.tasks.map((t) => <Row key={t.id} t={t} onSet={p.onSet} onAssign={p.onAssign} />)}</tbody>
        </table>
      </div>
    </>
  );
}

/**
 * One checklist row — app.html:5753. Every control on it carries THIS row's `id`.
 *
 * All four controls are left UNCONTROLLED (`defaultChecked` / `defaultValue`), which is both what
 * matches the golden byte for byte and what the legacy actually is: `closeSet()` re-runs `closeLoad()`,
 * so the row is rebuilt from the server rather than from local state, and `closeAssign()` fires on BLUR
 * — a controlled input would have to add an onChange the golden does not carry.
 *
 * The checkbox's `checked ? 'done' : 'pending'` is the mapping that decides whether a month-end step
 * reports complete. Inverting it is invisible to the string diff (R1 strips the handler) and is driven
 * from both directions in the screen's test.
 */
function Row({ t, onSet, onAssign }: { t: CloseTask; onSet: BodyProps['onSet']; onAssign: BodyProps['onAssign'] }) {
  const isDone = t.status === 'done';
  return (
    <tr>
      <td style={st('width:34px;text-align:center')}>
        <input type="checkbox" defaultChecked={isDone}
          onChange={(e) => onSet(t.id, (e.target as HTMLInputElement).checked ? 'done' : 'pending')}
          style={st('width:auto;cursor:pointer')} />
      </td>
      <td>
        {/* The legacy interpolates a conditional straight into the attribute, so a not-done row carries
            an EMPTY `style=""`. React cannot emit an empty style attribute at all — see the screen's
            test for the rule that reads both sides as the same document. */}
        <b style={st(isDone ? 'opacity:.55' : '')}>{t.title}</b>
        {t.category ? <> <span className="pill pill-coral" style={st('font-size:9px')}>{t.category}</span></> : null}
      </td>
      <td>
        <select defaultValue={t.status} onChange={(e) => onSet(t.id, e.target.value)}
          style={st('font-size:11.5px;padding:5px 9px')}>
          {CLOSE_STATUSES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </td>
      <td>
        <input defaultValue={t.assignee || ''} placeholder="assign…"
          onBlur={(e) => onAssign(t.id, e.target.value)}
          style={st('font-size:11.5px;padding:5px 9px;width:120px')} />
      </td>
    </tr>
  );
}

/** `renderClose()` — app.html:5738. The panel, with whatever `#close_out` currently holds inside. */
export default function FinanceClose(p: ScreenProps): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-hd">
        <h3>📋 Month-end close</h3>
        <div style={st('display:flex;gap:8px;align-items:center')}>
          {/* UNCONTROLLED and keeps its legacy id: `closeLoad()` reads
              `document.getElementById('close_period').value`, and the route reads the same id. */}
          <input type="month" id="close_period" defaultValue={p.period} onChange={() => p.onLoad()} />
          <button className="btn p" onClick={() => p.onLoad()}>↻ Load</button>
        </div>
      </div>
      <div id="close_out" className="muted"><Body {...p} /></div>
    </div>
  );
}
