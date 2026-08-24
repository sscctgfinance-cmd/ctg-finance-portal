// The dirty registry both unsaved-work guards read (browser beforeunload + in-app nav confirm).
// vitest is `environment: 'node'`, so the hook can't be mounted here — but the pure flag is the part a
// wrong key or a missed clear would silently break, so that is what this drives.

import { describe, expect, it, beforeEach } from 'vitest';

import { hasUnsaved, setUnsaved } from '../src/unsaved';

describe('unsaved registry', () => {
  beforeEach(() => { setUnsaved('a', false); setUnsaved('b', false); });

  it('is clean with nothing registered', () => {
    expect(hasUnsaved()).toBe(false);
  });

  it('is dirty while any key is set', () => {
    setUnsaved('a', true);
    expect(hasUnsaved()).toBe(true);
  });

  it('two screens do not clear each other', () => {
    setUnsaved('a', true);
    setUnsaved('b', true);
    setUnsaved('a', false);            // one screen saves/unmounts
    expect(hasUnsaved()).toBe(true);   // the other is still dirty
    setUnsaved('b', false);
    expect(hasUnsaved()).toBe(false);
  });
});
