'use client';

// One process-wide "is there typed work at risk?" flag — the React mirror of the legacy apps'
// `UNSAVED_CHANGES` / `setDirty(name,v)` (app.html:1286) and `HR.pay.dirty` (hros.html:1404). Two
// consumers read it: the browser `beforeunload` guard installed here (closing the tab / reload /
// following a link OUT), and the in-app nav confirm in `use-spa-nav.ts` (a client-side route that would
// unmount the dirty screen and drop its `useState`). Legacy state was global so leaving a screen and
// coming back kept typed work; React unmounts, so the nav-away path has to ASK first.
//
// Keyed by an opaque id (like the legacy's named flags) so two dirty screens never clear each other, and
// a screen that unmounts clears its own key. `hasUnsaved()` / `setUnsaved()` are pure — the runnable
// check drives them directly, since vitest runs under `environment: 'node'` and cannot mount the hook.

import { useEffect, useId } from 'react';

const dirtyKeys = new Set<string>();

export function setUnsaved(key: string, on: boolean): void {
  if (on) dirtyKeys.add(key);
  else dirtyKeys.delete(key);
}

export function hasUnsaved(): boolean {
  return dirtyKeys.size > 0;
}

let installed = false;
function installBeforeUnload(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; }
  });
}

// A screen calls this with its own `dirty` boolean; it registers into the shared flag and, on unmount,
// clears its key so a discarded screen stops holding the guard open.
export function useUnsavedGuard(dirty: boolean): void {
  const key = useId();
  useEffect(() => { installBeforeUnload(); }, []);
  useEffect(() => {
    setUnsaved(key, dirty);
    return () => setUnsaved(key, false);
  }, [key, dirty]);
}
