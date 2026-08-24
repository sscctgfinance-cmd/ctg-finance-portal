// The failed-load panel — the C2 gap. app.html:1574-1600 categorises a failed `render(t)` into
// session / network / server, shows tailored copy, and offers Retry + Go to Overview (session offers
// Sign in instead) plus a <details> with the technical message. Every React route used to render a
// bare `<Panel>⚠️ {err}</Panel>` whose only escape was a full browser reload — which discards typed
// work. This mirrors the legacy behaviour so a failed fetch is recoverable.
//
// The categorisation keys on the message text, which src/portal.ts's `call()` (#120) already normalises
// the way common.js does: "Session expired…" on a 401, "Network error…" on a fetch failure, "Request
// timed out…" on the 30s abort — so the legacy regexes below get a clean signal.

import { BASE_PATH, legacyUrl } from './portal';

/**
 * The Finance "Go to Overview" target. HR screens pass no `home` — the legacy HR side offers inline
 * retry and has no cross-app "Overview", so retry alone is the faithful HR behaviour.
 */
export const OVERVIEW_HOME = { href: `${BASE_PATH}/finance/overview/`, label: 'Go to Overview' };

/**
 * The retry every dead-end panel uses. In the ternary error state the screen is replaced wholesale, so
 * no form is mounted and there is nothing typed to lose; a route reload re-runs the ENTIRE mount
 * sequence — the token read, the `my_perms` gate and the data load — which a soft re-call of `load`
 * alone cannot. It is the per-route analogue of the legacy `reloadActive()` (app.html:1520), which
 * re-fetches the active tab, and it matches how the layouts already refresh (a tenant change reloads).
 */
export const retryReload = () => { location.reload(); };

export type FailKind = 'session' | 'network' | 'server';

export interface Failure {
  kind: FailKind;
  ico: string;
  head: string;
  body: string;
}

/** app.html:1577-1586, verbatim taxonomy. Pure, so the screen's test can pin every branch. */
export function categorizeFailure(msg: string): Failure {
  const isSession = /session expired/i.test(msg);
  // The legacy words `call()` produces, plus the browser's raw fetch wording ("Failed to fetch",
  // "Load failed") as a belt-and-braces for any error that reached here without going through `call()`.
  const isNetwork = /network|connection|timed out|offline|failed to fetch|load failed/i.test(msg);
  const kind: FailKind = isSession ? 'session' : isNetwork ? 'network' : 'server';
  return {
    kind,
    ico: isSession ? '🔒' : isNetwork ? '📡' : '⚠️',
    head: isSession ? 'Session expired'
      : isNetwork ? "Can't reach the server"
      : 'Something went wrong',
    body: isSession ? 'For your security, you have been signed out. Sign in again to continue.'
      : isNetwork ? 'Check your connection and try again. If the problem persists, the portal backend may be briefly unavailable.'
      : 'The portal had trouble loading this section. Try again, and if it keeps happening, send the technical detail below to support.',
  };
}

/**
 * `home` is the "Go to Overview" target. Finance routes pass the overview; HR routes pass their
 * dashboard (the legacy HR screens carry inline retry links and no cross-app "Overview"). Omit it to
 * show Retry only.
 */
export default function FailedLoad(
  { message, onRetry = retryReload, home }:
  { message: string; onRetry?: () => void; home?: { href: string; label: string } },
) {
  const f = categorizeFailure(message);
  return (
    <div className="empty" style={{ padding: '48px 24px' }}>
      <div className="empty-ico" style={{ fontSize: '42px' }}>{f.ico}</div>
      <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '8px', color: 'var(--text)' }}>{f.head}</div>
      <div style={{ fontSize: '13px', color: 'var(--text-soft)', maxWidth: '420px', margin: '8px auto 0', lineHeight: 1.55 }}>{f.body}</div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '18px' }}>
        {f.kind === 'session'
          ? <button className="btn p" onClick={() => { location.href = legacyUrl('index.html'); }}>Sign in</button>
          : (
            <>
              <button className="btn p" onClick={onRetry}>↻ Retry</button>
              {home ? <a className="btn" href={home.href}>{home.label}</a> : null}
            </>
          )}
      </div>
      {f.kind !== 'session'
        ? (
          <details style={{ marginTop: '18px', fontSize: '11.5px', color: 'var(--muted)', textAlign: 'left', maxWidth: '500px', marginLeft: 'auto', marginRight: 'auto' }}>
            <summary style={{ cursor: 'pointer' }}>Technical detail</summary>
            <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--panel-2)', padding: '10px', borderRadius: '6px', marginTop: '6px', color: 'var(--text-soft)' }}>{message}</pre>
          </details>
        )
        : null}
    </div>
  );
}
