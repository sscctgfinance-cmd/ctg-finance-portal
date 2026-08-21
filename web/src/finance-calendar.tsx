// Finance OS · Compliance Calendar — the fourteenth screen out of app.html.
//
// Legacy original: `renderCalendar()` (app.html:6897) and `calRender()` (app.html:6907). Both are STILL
// THERE and still shipping; nothing was deleted. `app.html#tab=calendar` and `/finance/calendar/` render
// the same data from the same session.
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, NO CLOCK READ. The fetch and the
// day-window state live in app/finance/calendar/page.tsx. See src/finance-wht.tsx's header for what a
// Finance screen differs on: no chrome in the golden, one section, gate upstream in `showApp()`.
//
// ── IT IS NOT A CALENDAR GRID ─────────────────────────────────────────────────────────────────────
// The migration brief flagged this screen as the one most likely to be left on legacy code, on the
// expectation of a hand-built month grid generated from date arithmetic. It is not one. `calRender()`
// writes four filter buttons, four count cards and ONE table of rows bucketed by `x.urgency` — a string
// the SERVER sends. There is no grid, no month, no week, no day-of-week maths, and no `new Date()`
// anywhere in it. It ports under the existing six relaxations like any other table screen.
//
// ── WHERE THE DATES COME FROM: THE SERVER, AND THAT IS THE WHOLE SAFETY ARGUMENT ───────────────────
// `compliance_calendar` returns `due_date` (a YYYY-MM-DD string), `days_until` (an integer) and
// `urgency` (one of five buckets). The client computes NEITHER the day count NOR the bucket. So there is
// no arithmetic to lift — this is Quick Invoice's case, not `wht.js`'s or `o2o.js`'s: the authoritative
// figure is the server's and the client only formats it. Inventing a `calendar.js` for one string split
// would be a larger change than the migration.
//
// The ONE derivation the client does own is `dueLabel()` below, and app.html's own comment says why it
// must not go through `new Date()`: `new Date('2026-07-30')` is parsed as UTC and prints 29 Jul in any
// browser west of Greenwich. On a compliance calendar a date that shifts by one day is a missed
// statutory filing, so it is a pure string split here, mirrored character for character, and it is the
// thing tests/finance-calendar.parity.test.tsx tests hardest.

import { Fragment } from 'react';

/**
 * `PERMS` — resolved by `showApp()` from `my_perms`. Calendar reads none of it (see below); the type is
 * here so the route can hold the same shape every other Finance route holds.
 */
export interface Perms {
  features?: string[] | null;
  manage_users?: boolean | null;
}

/**
 * app.html:1426 — `else if(t==='calendar') el.classList.remove('hide'); // gated server-side`.
 *
 * Read the WHOLE block (app.html:1420-1439) before trusting one line of it: `calendar` sits in the
 * `if/else if` chain that RESTARTS at `ctgaccess`, between `info` and `ocr`, and it takes its own
 * branch — so it never reaches the chain's final `else` and the feature flag never applies. Its
 * neighbours are three different rules (`ctgaccess` is `!canManage`, `ocr`/`ap` are hidden from
 * everyone, `selfbill`/`wht` are `!canManage`), so copying any of them would be wrong.
 *
 * The tab is visible to EVERY login and `portal_compliance_calendar` decides. `pharmReachable()` is the
 * same shape and its header carries the same reasoning: where the gate is server-side, the branch that
 * carries the security meaning is the REFUSAL, which is `Refused` below.
 */
export function calendarReachable(): boolean {
  return true;
}

/** One row of `r.deadlines` — every field as `calRender()` reads it. */
export interface Deadline {
  tenant_id?: string | null;
  tenant_name?: string | null;
  label?: string | null;
  detail?: string | null;
  /** YYYY-MM-DD, from the server. Never parsed as a Date — see `dueLabel()`. */
  due_date?: string | null;
  kind?: string | null;
  urgency?: string | null;
  /** Negative when overdue. The SERVER's count; the client never derives it. */
  days_until?: number | null;
}

/** The five buckets, in the order `calRender()` writes their sections. `distant` is the fallback. */
export const URGENCIES = ['overdue', 'critical', 'warning', 'upcoming', 'distant'] as const;
export type Urgency = (typeof URGENCIES)[number];

/**
 * `d.forEach(x => (by[x.urgency] || by.distant).push(x))` — app.html:6910.
 *
 * An urgency the client does not know falls into `distant`, which is LATER — the quietest bucket. That
 * is the legacy behaviour and it is mirrored, not "fixed": a port that guessed a louder bucket for an
 * unrecognised string would invent an urgency the server did not send.
 */
export function bucket(deadlines: Deadline[]): Record<Urgency, Deadline[]> {
  const by: Record<Urgency, Deadline[]> = { overdue: [], critical: [], warning: [], upcoming: [], distant: [] };
  deadlines.forEach((x) => {
    const u = String(x.urgency || '') as Urgency;
    (by[u] || by.distant).push(x);
  });
  return by;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * app.html:6929-6933, character for character, INCLUDING its refusal to touch `new Date`.
 *
 * `'2026-07-30'` → `'30 Jul 2026'`. The day is `String(Number(parts[2]))`, so `08` prints as `8`; the
 * YEAR is `parts[0]` verbatim, so it is NOT re-derived. Anything that is not three dash-separated parts
 * falls back to the raw string rather than to a guess — a malformed date printing as itself is a
 * visible defect; printing as a plausible wrong date is a missed filing.
 */
export function dueLabel(due: unknown): string {
  const parts = String(due == null ? '' : due).split('-');
  return parts.length === 3
    ? String(Number(parts[2])) + ' ' + MONTHS[Number(parts[1]) - 1] + ' ' + parts[0]
    : String(due == null ? '' : due);
}

/** `icon(kind)` — app.html:6912. */
export function icon(kind: unknown): string {
  return kind === 'statutory' ? '⚖' : kind === 'licence' ? '📜' : kind === 'lease' ? '🔑' : kind === 'insurance' ? '🛡' : '📌';
}

/** `urgPill(u, days)` — app.html:6913-6919. */
function UrgPill({ urgency, days }: { urgency: unknown; days: number }) {
  if (urgency === 'overdue') return <span className="pill" style={{ background: 'rgba(239,68,68,.18)', color: 'var(--red-soft)', fontSize: '10px' }}>{'⚠ ' + Math.abs(days) + 'd overdue'}</span>;
  if (urgency === 'critical') return <span className="pill" style={{ background: 'rgba(245,158,11,.18)', color: 'var(--amber)', fontSize: '10px' }}>{'⏰ ' + days + 'd'}</span>;
  if (urgency === 'warning') return <span className="pill" style={{ background: 'rgba(255,165,89,.16)', color: 'var(--coral-soft)', fontSize: '10px' }}>{days + 'd'}</span>;
  if (urgency === 'upcoming') return <span className="pill" style={{ background: 'rgba(91,155,213,.14)', color: 'var(--sky-soft)', fontSize: '10px' }}>{days + 'd'}</span>;
  return <span className="muted" style={{ fontSize: '10.5px' }}>{days + 'd'}</span>;
}

/** `[30,90,365,'all']` — app.html:6921. `'all'` is the sentinel 9999, which is what the POST carries. */
export const DAY_FILTERS: [string, number][] = [['Next 30d', 30], ['Next 90d', 90], ['Next 365d', 365], ['All', 9999]];

/** `renderCalendar()`'s body — app.html:6900, `{api:'compliance_calendar', days:CAL_DAYS}`. */
export function calendarBody(days: number): Record<string, unknown> {
  return { api: 'compliance_calendar', days };
}

/** `rows(arr)` — app.html:6927. */
function Rows({ items }: { items: Deadline[] }) {
  return (
    <>
      {items.map((x, i) => (
        <tr key={i}>
          <td><span style={{ fontSize: '16px' }}>{icon(x.kind)}</span></td>
          <td><b>{x.tenant_name || ''}</b></td>
          <td>{x.label || ''}{x.detail ? <div className="muted" style={{ fontSize: '11px', marginTop: '2px' }}>{x.detail}</div> : null}</td>
          <td className="muted" style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>{dueLabel(x.due_date)}</td>
          <td><UrgPill urgency={x.urgency} days={Number(x.days_until) || 0} /></td>
        </tr>
      ))}
    </>
  );
}

/** The five section headers — app.html:6944-6948. Each is only written when its bucket is non-empty. */
const SECTIONS: [Urgency, string, string, string][] = [
  ['overdue', 'rgba(239,68,68,.06)', 'var(--red-soft)', '⚠ OVERDUE'],
  ['critical', 'rgba(245,158,11,.06)', 'var(--amber)', '⏰ ≤ 14 DAYS'],
  ['warning', 'rgba(255,165,89,.05)', 'var(--coral-soft)', '≤ 30 DAYS'],
  ['upcoming', 'rgba(91,155,213,.05)', 'var(--sky-soft)', '≤ 90 DAYS'],
  ['distant', 'rgba(255,255,255,.02)', 'var(--muted)', 'LATER'],
];

export interface FinanceCalendarProps {
  /** `CAL_DATA` — `r.deadlines || []`. */
  deadlines: Deadline[];
  /** `CAL_DAYS` — module state, 365 at load (app.html:6898). Decides which filter button is `btn p`. */
  days: number;
  /** `CAL_DAYS=<n>;renderCalendar()` — app.html:6924. Sets the window AND re-fetches. */
  onDays: (days: number) => void;
}

/**
 * `renderCalendar()`'s `!r.ok` branch — app.html:6902. NO GOLDEN HOLDS THIS, and on a screen whose gate
 * is server-side it is the branch that carries the security meaning: rendering an empty table here would
 * turn "you may not see this" into "there is nothing to see", which reads as success. Pinned by
 * assertion in the screen's test.
 */
export function Refused({ error }: { error: string }) {
  return <div className="empty"><div className="empty-ico">🔒</div><div>{error}</div></div>;
}

/** `renderCalendar()`'s catch — app.html:6905. Also in no golden. */
export function Failed({ error }: { error: string }) {
  return <div className="empty"><div className="empty-ico">⚠️</div><div>{error}</div></div>;
}

/** `calRender()` — app.html:6907. This component is every byte of the `#calendar` tab div. */
export default function FinanceCalendar(props: FinanceCalendarProps) {
  const d = props.deadlines || [];
  const by = bucket(d);
  return (
    <>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' }}>
        {DAY_FILTERS.map(([label, v]) => (
          <button key={v} className={'btn' + (props.days === v ? ' p' : '')} style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => props.onDays(v)}>{label}</button>
        ))}
        <span className="muted" style={{ fontSize: '12px', marginLeft: 'auto' }}>Source: each company&apos;s <b>🏢 Company Info</b> → Compliance dates + licences + leases + insurance expiries.</span>
      </div>
      <div className="cards" style={{ marginBottom: '18px' }}>
        <div className="card"><div className="n" style={{ color: 'var(--red-soft)' }}>{by.overdue.length}</div><div className="l">⚠ Overdue</div></div>
        <div className="card"><div className="n" style={{ color: 'var(--amber)' }}>{by.critical.length}</div><div className="l">⏰ ≤ 14 days</div></div>
        <div className="card"><div className="n" style={{ color: 'var(--coral-soft)' }}>{by.warning.length}</div><div className="l">≤ 30 days</div></div>
        <div className="card"><div className="n" style={{ color: 'var(--sky-soft)' }}>{by.upcoming.length}</div><div className="l">≤ 90 days</div></div>
      </div>
      {d.length === 0
        ? (
          <div className="empty">
            <div className="empty-ico">📅</div>
            <div>No deadlines on file.</div>
            <div className="muted" style={{ fontSize: '12.5px', marginTop: '8px' }}>Fill in Compliance dates / Licences / Leases / Insurance under each company in Company Info to populate this calendar.</div>
          </div>
        )
        : (
          <div className="tbl-wrap">
            <table className="bigtable">
              <thead><tr><th style={{ width: '40px' }}></th><th>Company</th><th>Item</th><th>Due</th><th>Urgency</th></tr></thead>
              <tbody>
                {SECTIONS.map(([key, bg, color, title]) => (
                  by[key].length
                    ? (
                      <Fragment key={key}>
                        <tr><td colSpan={5} style={{ background: bg, fontSize: '10.5px', color, fontWeight: '700', letterSpacing: '.08em', padding: '7px 14px' }}>{title}</td></tr>
                        <Rows items={by[key]} />
                      </Fragment>
                    )
                    : null
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}
