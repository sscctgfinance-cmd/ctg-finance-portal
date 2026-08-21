// HR OS · Time Clock — the React half of the strangler's second screen.
//
// The legacy original is `hrClockRender()` at hros.html:2926 (with `hrSchedCard()` at :2955 and the two
// `hrClkTime`/`hrClkNow` formatters at :2909-2910) and it is STILL THERE and still shipping; nothing was
// deleted. Both are reachable side by side (`hros.html#tab=clock` and `/hr/clock/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. That is what lets
// tests/hr-clock.parity.test.tsx render it with `renderToStaticMarkup` and diff the result against
// tests/golden/hr.clock.html. The loading, the session, the 1s tick and the geolocation live in
// app/hr/clock/page.tsx, on the other side of that line.
//
// The markup deliberately mirrors the legacy string concatenation element for element, including the
// inline `style` strings. It is not "better" — it is the SAME, because the golden is the contract.
//
// `hrPushCard()` (hros.html:3011) IS here now (v222), and it is the one part of this screen the golden
// cannot see: it renders nothing at all unless `PUSH.supported`, and the render harness has no
// ServiceWorker, so `tests/golden/hr.clock.html` holds no trace of it. It is mirrored from the legacy
// source and its four states are asserted in the screen's own test instead. The DEVICE half — the
// service-worker registration, the Notification permission prompt, the PushManager subscription — is in
// app/hr/clock/page.tsx, where the geolocation already lives; `PushCard` below is a pure function of
// what that half found out.

import type { CSSProperties } from 'react';

/** One row of `clock_status.today`. */
export interface Punch {
  id: string;
  /** The local calendar day the punch belongs to — only read for the stale-open warning. */
  work_date?: string | null;
  clock_in: string;
  clock_out?: string | null;
  hours?: number | null;
}

/** `clock_status.employee` — only the fields this screen reads. */
export interface ClockEmployee {
  pay_type?: string | null;
  hourly_rate?: number | null;
  employment_type?: string | null;
  shift_start?: string | null;
  shift_end?: string | null;
  work_days?: number[] | null;
}

/** The `clock_status` response, as the legacy screen consumes it. */
export interface ClockStatus {
  employee?: ClockEmployee | null;
  open?: Punch | null;
  stale_open?: boolean;
  week_hours?: number | null;
  today?: Punch[];
}

export interface HrClockProps {
  data: ClockStatus;
  /** `hrCompanyName()` — hros.html:4445. Chrome, so it is passed in rather than resolved here. */
  companyName: string;
  /** `#clk_elapsed`'s text. `hrClkTick()` (hros.html:2910) drives it; first paint is '00:00:00'. */
  elapsed: string;
  /** `hrClkNow()` (hros.html:2909) — the wall clock, shown only when NOT clocked in. A prop because
      reading the clock inside the component is the one thing that would stop it being a pure function. */
  now: string;
  /** `CLK.acting` (hros.html:2907) — disables the button while a punch is in flight. */
  acting?: boolean;
  onClockAction: (dir: 'in' | 'out') => void;
  onSchedSave: () => void;
  /**
   * `PUSH` — hros.html:2979. `null` means "this browser cannot do Web Push" (`PUSH.supported` false),
   * which is the state the golden was captured in and renders no card at all.
   */
  push?: PushState | null;
  onPushEnable?: () => void;
  onPushDisable?: () => void;
  onPushTest?: () => void;
}

/** `M()` — hros.html:1268. */
function M(n: number): string {
  return 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * `hrClkTime()` — hros.html:2908. Same call, so the same string: the punch is stored in UTC and shown in
 * the viewer's zone, which is what an operator checking their own punches expects.
 */
export function clkTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** `hrNeedsClock()` — hros.html:1503. The schedule card is for part-timers only. */
function needsClock(e?: ClockEmployee | null): boolean {
  const x = e || {};
  return x.employment_type === 'Part-time' || x.pay_type === 'hourly' || x.pay_type === 'daily';
}

/** The legacy `S` control style for the schedule card — hros.html:2964. */
const S: CSSProperties = {
  padding: '8px 10px',
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  color: 'var(--text)',
  fontSize: '13px',
};

const LABEL: CSSProperties = { fontSize: '11px', display: 'block', marginBottom: '3px' };

const DAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];

/**
 * What the device half found out. `on` is `!!PUSH.sub`; `iosNeedsInstall` is
 * `pushIsIOS() && !pushStandalone()` (hros.html:3013); `busy` is `PUSH.busy`.
 */
export interface PushState { on: boolean; busy: boolean; iosNeedsInstall: boolean }

export default function HrClock({ data, companyName, elapsed, now, acting = false, onClockAction, onSchedSave, push, onPushEnable, onPushDisable, onPushTest }: HrClockProps) {
  const open = data.open;
  const emp = data.employee || {};
  const today = data.today || [];
  // hros.html:2949 — the pay estimate is only shown for someone actually paid by the hour.
  const wkPay = (emp.pay_type === 'hourly' && emp.hourly_rate)
    ? ' · ≈ ' + M((Number(data.week_hours) || 0) * Number(emp.hourly_rate))
    : '';

  return (
    <>
      {/* The page head is built by hrRender(), not hrClockRender() — hros.html:1537. Shared chrome, and
          report.md §3.5 keeps chrome out of a screen-by-screen strangler, but it is inside the `#hr`
          element the golden holds, so leaving it out would mean diffing against an arbitrary slice. */}
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Me</div>
          <h2 className="page-title">Time Clock</h2>
          <div className="page-sub">Clock in / out and see your hours</div>
        </div>
        <div className="page-meta">
          <span className="page-chip"><span className="dot"></span>{companyName}</span>
        </div>
      </div>

      <div style={{ maxWidth: '520px' }}>
        {open ? (
          <div className="panel" style={{ textAlign: 'center', padding: '30px 20px' }}>
            {/* hros.html:2933 — a punch left open past its own work_date is almost always a forgotten
                clock-out, and it silently inflates the week's hours until someone notices. */}
            {data.stale_open
              ? <div className="pill pill-coral" style={{ marginBottom: '12px', fontSize: '11px' }}>⚠ Clocked in since {String(open.work_date)} — remember to clock out</div>
              : null}
            <div className="muted" style={{ fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '.06em' }}>Currently clocked in</div>
            <div id="clk_elapsed" style={{ fontSize: '42px', fontWeight: '800', letterSpacing: '-.02em', margin: '8px 0', color: 'var(--green-soft)' }}>{elapsed}</div>
            <div className="muted" style={{ fontSize: '12.5px' }}>since {clkTime(open.clock_in)}</div>
            <button className="btn p" disabled={acting} style={{ marginTop: '20px', fontSize: '16px', padding: '14px 42px', background: 'linear-gradient(135deg,#DC2626,#B23C1F)' }}
              onClick={() => onClockAction('out')}>⏹ Clock Out</button>
          </div>
        ) : (
          <div className="panel" style={{ textAlign: 'center', padding: '30px 20px' }}>
            <div className="muted" style={{ fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '.06em' }}>Not clocked in</div>
            <div style={{ fontSize: '36px', fontWeight: '800', margin: '10px 0', color: 'var(--text)' }}>{now}</div>
            <button className="btn p" disabled={acting} style={{ marginTop: '6px', fontSize: '16px', padding: '14px 46px' }}
              onClick={() => onClockAction('in')}>▶ Clock In</button>
          </div>
        )}

        <div style={{ height: '14px' }}></div>

        <div className="panel">
          <div className="panel-hd">
            <h3>Today</h3>
            <span className="muted" style={{ fontSize: '11.5px' }}>This week: <b>{Number(data.week_hours || 0).toFixed(2)} h</b>{wkPay}</span>
          </div>
          {today.length ? (
            <div className="tbl-wrap">
              <table className="bigtable">
                <thead><tr><th>In</th><th>Out</th><th className="amt">Hours</th></tr></thead>
                <tbody>
                  {today.map((p) => (
                    <tr key={p.id}>
                      <td>{clkTime(p.clock_in)}</td>
                      <td>{p.clock_out ? clkTime(p.clock_out) : <span className="pill pill-amber" style={{ fontSize: '9px' }}>OPEN</span>}</td>
                      <td className="amt">{p.hours != null ? Number(p.hours).toFixed(2) + 'h' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="muted" style={{ padding: '12px' }}>No punches today yet.</div>}
        </div>

        <SchedCard emp={emp} onSchedSave={onSchedSave} />

        <PushCard push={push} onEnable={onPushEnable} onDisable={onPushDisable} onTest={onPushTest} />

        <div className="muted" style={{ fontSize: '11.5px', marginTop: '12px', lineHeight: '1.6' }}>
          📲 <b>Tip:</b> add HR OS to your phone home screen (browser menu → <i>Add to Home Screen</i>) and bookmark <b>…/hros.html#clock</b> — then clocking in is one tap.
        </div>
      </div>
    </>
  );
}

/**
 * `hrPushCard()` — hros.html:3011.
 *
 * NOT IN THE GOLDEN, and not because of a state the fixture happened to be in: `PUSH.supported` reads
 * `'serviceWorker' in navigator`, and the offline render harness has no navigator at all, so this card
 * can never appear in a captured surface. Mirrored from the legacy source and asserted state by state
 * in the screen's own test.
 *
 * The iOS branch is the interesting one: Safari refuses Web Push to a page opened in the browser, so
 * the only path is Add to Home Screen first. It is copy, not code, and it must not be dropped — without
 * it an iPhone user taps Enable, is refused by the OS, and has nothing to act on.
 */
function PushCard({ push, onEnable, onDisable, onTest }: {
  push?: PushState | null;
  onEnable?: () => void;
  onDisable?: () => void;
  onTest?: () => void;
}) {
  if (!push) return null;   // `if(!PUSH.supported) return '';`
  return (
    <div className="panel" style={{ marginTop: '12px' }}>
      <div className="panel-hd"><h3>🔔 Clock-in reminders</h3></div>
      <div className="muted" style={{ fontSize: '12px', marginBottom: '10px' }}>Get a notification on this phone when it’s time to clock in. Set it up once on each phone you use.</div>
      {push.on ? (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="pill pill-ok" style={{ fontSize: '11px' }}>🔔 On for this device</span>
          <button className="btn sm" onClick={onTest}>Send test</button>
          <button className="btn sm d" onClick={onDisable}>Turn off</button>
        </div>
      ) : push.iosNeedsInstall ? (
        <div className="muted" style={{ fontSize: '12px', lineHeight: '1.5' }}>
          📱 <b>On iPhone</b>, first tap <b>Share → Add to Home Screen</b>, then open HR OS from that new icon and turn reminders on here.
        </div>
      ) : (
        <button className="btn p sm" disabled={push.busy} onClick={onEnable}>{push.busy ? 'Enabling…' : '🔔 Enable clock-in reminders'}</button>
      )}
    </div>
  );
}

/**
 * `hrSchedCard()` — hros.html:2955. The inputs are UNCONTROLLED, exactly as the legacy ones are: their
 * ids are the contract, because `hrSchedSave()` (hros.html:2971) reads the values straight back out of
 * the DOM by id. Controlling them here would mean a second source of truth for no gain.
 */
function SchedCard({ emp, onSchedSave }: { emp: ClockEmployee; onSchedSave: () => void }) {
  if (!emp || !needsClock(emp)) return null;
  const st = emp.shift_start ? String(emp.shift_start).slice(0, 5) : '';
  const en = emp.shift_end ? String(emp.shift_end).slice(0, 5) : '';
  const wd = Array.isArray(emp.work_days) ? emp.work_days.map(Number) : [];

  return (
    <div className="panel" style={{ marginTop: '12px' }}>
      <div className="panel-hd"><h3>🗓️ My work schedule</h3></div>
      <div className="muted" style={{ fontSize: '12px', marginBottom: '10px' }}>
        Set the days &amp; times you usually work. Reminders fire at your <b>Start time</b> (to clock in) and your <b>End time</b> (to clock out) on the ticked days — only if you haven’t already.
      </div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <div>
          <label className="muted" style={LABEL}>Start time (clock in)</label>
          <input type="time" id="sch_start" defaultValue={st} style={S} />
        </div>
        <div>
          <label className="muted" style={LABEL}>End time (clock out)</label>
          <input type="time" id="sch_end" defaultValue={en} style={S} />
        </div>
      </div>
      <div style={{ marginBottom: '12px' }}>
        <label className="muted" style={{ fontSize: '11px', display: 'block', marginBottom: '5px' }}>Work days</label>
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
          {DAYS.map(([n, label]) => (
            <label key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
              <input type="checkbox" id={`sch_wd${n}`} defaultChecked={wd.indexOf(n) >= 0} style={{ accentColor: 'var(--coral)' }} />{' '}{label}
            </label>
          ))}
        </div>
      </div>
      <button className="btn p sm" onClick={onSchedSave}>Save my schedule</button>
    </div>
  );
}
