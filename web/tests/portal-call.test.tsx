// The three resilience behaviours portal.ts's `call()` mirrors from common.js's `call()`
// (data/finance-portal-cutover-gap-audit F6): a 30s abort → timeout message, a TypeError → network
// message, and a 401/unauthorized → the session-expired path (token cleared, redirect, throw). No golden
// sees any of this — it is error handling, not markup — so it is pinned here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call } from '../src/portal';

const removed: string[] = [];

beforeEach(() => {
  removed.length = 0;
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: () => 'tok-123',            // a live-looking token, so reqToken is truthy
    setItem: () => {},
    removeItem: (k: string) => { removed.push(k); },
  };
  (globalThis as Record<string, unknown>).location = { href: '' };
});

afterEach(() => { vi.restoreAllMocks(); });

describe("portal.ts call() resilience", () => {
  it('turns an AbortError into the timeout message', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(call({ api: 'x' })).rejects.toThrow('Request timed out — server or Xero is slow, please retry');
  });

  it('turns a TypeError into the network message', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(call({ api: 'x' })).rejects.toThrow('Network error — check your connection and retry');
  });

  it('takes the session-expired path on 401 with a token: clears the token and throws', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 401, ok: false, json: async () => ({ ok: false, error: 'unauthorized' }) });
    await expect(call({ api: 'x' })).rejects.toThrow('Session expired — please sign in again');
    expect(removed).toContain('ctg_portal_token');
  });

  it('does NOT take the session-expired path for a login probe', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 401, ok: false, json: async () => ({ ok: false, error: 'unauthorized' }) });
    // login is auth-exempt, so it surfaces the raw error rather than redirecting.
    await expect(call({ api: 'login', token: '' })).rejects.toThrow('unauthorized');
    expect(removed).not.toContain('ctg_portal_token');
  });
});
