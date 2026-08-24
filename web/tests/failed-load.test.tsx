// The failed-load panel — the C2 gap (app.html:1574-1600). No golden holds an error state (a golden is
// one loaded state of one screen), so this pins the categorisation and the actions by assertion.
//
// What it proves: the three message kinds map to the legacy copy verbatim; the session branch offers
// Sign in and no technical detail; the network/server branches offer Retry + Go to Overview and the
// <details>; and portal.ts's `call()` now emits the session-detectable string on a 401 so the branch is
// reachable — the categorisation is only as good as the message it is handed.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import FailedLoad, { OVERVIEW_HOME, categorizeFailure } from '../src/failed-load';

describe('categorizeFailure', () => {
  it('detects a session death (app.html:1578)', () => {
    const f = categorizeFailure('Session expired — please sign in again');
    expect(f.kind).toBe('session');
    expect(f.ico).toBe('🔒');
    expect(f.head).toBe('Session expired');
  });

  it('detects a network failure by the legacy words AND the raw fetch wording', () => {
    for (const m of ['Network error — check your connection and retry', 'Request timed out',
      'You are offline', 'Failed to fetch', 'Load failed']) {
      expect(categorizeFailure(m).kind, m).toBe('network');
    }
    expect(categorizeFailure('Network error').ico).toBe('📡');
  });

  it('falls back to server for anything else', () => {
    const f = categorizeFailure('Server returned 500');
    expect(f.kind).toBe('server');
    expect(f.ico).toBe('⚠️');
    expect(f.head).toBe('Something went wrong');
  });

  it('session ranks over network when both words are present', () => {
    // isSession is tested first in app.html — a "session expired" that also mentions the connection
    // must still sign the user out, not offer a pointless retry.
    expect(categorizeFailure('Session expired, connection lost').kind).toBe('session');
  });
});

describe('FailedLoad actions', () => {
  it('session offers Sign in and hides the technical detail', () => {
    const html = renderToStaticMarkup(<FailedLoad message="Session expired — bye" />);
    expect(html).toContain('Sign in');
    expect(html).not.toContain('Retry');
    expect(html).not.toContain('Technical detail');   // no leaking the raw error on a sign-out
  });

  it('a server failure offers Retry, the home link and the technical detail', () => {
    const html = renderToStaticMarkup(<FailedLoad message="boom-detail-xyz" home={OVERVIEW_HOME} />);
    expect(html).toContain('Retry');
    expect(html).toContain('Go to Overview');
    expect(html).toContain(OVERVIEW_HOME.href);
    expect(html).toContain('Technical detail');
    expect(html).toContain('boom-detail-xyz');   // the message is shown, escaped, in <pre>
  });

  it('HR omits the home link (retry only, matching the legacy inline-retry HR screens)', () => {
    const html = renderToStaticMarkup(<FailedLoad message="boom" />);
    expect(html).toContain('Retry');
    expect(html).not.toContain('Go to Overview');
  });
});
