// The beacon's one novel property vs the legacy: it carries NO token, so the server (index.ts:110) has
// nothing to resolve `user_email`/`user_id` from — the captain's 2026-08-24 decision. Everything else is
// a near-verbatim copy of hros.html's already-trusted beacon; this pins the part that is different.
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { beaconBody, setBeaconContext } from '../src/beacon';

beforeAll(() => {
  // vitest runs `environment: 'node'`, so the browser globals the pure body reads must be stubbed.
  // `navigator` is a read-only getter in node, hence stubGlobal rather than assignment.
  vi.stubGlobal('location', { pathname: '/finance/wht/', hash: '#tab=wht' });
  vi.stubGlobal('navigator', { userAgent: 'test-ua' });
});

describe('beaconBody', () => {
  it('mirrors message/stack/page/tenant and carries NO token or email', () => {
    setBeaconContext('app', 't-123');
    const body = beaconBody('error', 'boom', 'at f (x.js:1:1)');

    expect(body).toMatchObject({
      api: 'client_error',
      app: 'app',
      kind: 'error',
      message: 'boom',
      stack: 'at f (x.js:1:1)',
      page: '/finance/wht/#tab=wht',
      ua: 'test-ua',
      tenant: 't-123',
    });
    // The whole point: no way for the server to attach the user's identity.
    expect('token' in body).toBe(false);
    expect('email' in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain('token');
  });

  it('caps message at 500 and stack at 4000, and blank tenant becomes null', () => {
    setBeaconContext('hros', '');
    const body = beaconBody('unhandledrejection', 'm'.repeat(600), 's'.repeat(5000));
    expect((body.message as string).length).toBe(500);
    expect((body.stack as string).length).toBe(4000);
    expect(body.tenant).toBeNull();
    expect(body.app).toBe('hros');
  });
});
