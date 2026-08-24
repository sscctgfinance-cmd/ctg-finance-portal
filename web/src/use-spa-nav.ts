'use client';

// One delegated click listener that turns an in-app anchor into a client-side route change.
//
// The RULE — which clicks qualify — is `spaTarget()` in spa-nav.ts, which is pure and tested on its own.
// This file is only the wiring, and is deliberately the smallest thing that can hold it: it is separate
// from spa-nav.ts so the rule can be imported by a test without pulling `next/navigation` in with it.
//
// What is left alone, and why each one matters:
//   · a modified click (⌘ / ctrl / shift / alt) or anything but the primary button — those are the
//     user asking for a new tab or a new window, which is the thing anchors buy us;
//   · `target=` and `download=` anchors — Bank Feed's launcher is `target="_blank" rel="noopener"`
//     (app.html:4063) and the screens hand files to the browser this way;
//   · a click something has already handled (`defaultPrevented`) — several screens' rows call
//     `preventDefault()`/`stopPropagation()` and hijacking after them would undo the screen;
//   · any cross-origin or non-http URL, and every legacy handoff.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { spaTarget } from './spa-nav';
import { hasUnsaved } from './unsaved';
import { showConfirm } from './confirm';

export function useSpaNav(): void {
  const router = useRouter();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const t = e.target as Element | null;
      const a = t && typeof t.closest === 'function' ? t.closest('a') : null;
      if (!a || a.target || a.hasAttribute('download')) return;
      const raw = a.getAttribute('href');
      if (!raw || raw.startsWith('#')) return;
      let url: URL;
      try { url = new URL(a.href, location.href); } catch { return; }
      if (url.origin !== location.origin) return;
      const to = spaTarget(location.pathname, url.pathname);
      if (!to) return;
      e.preventDefault();
      const dest = to + url.search + url.hash;
      // A client-side route unmounts the current screen and drops its `useState` — the Payroll grid,
      // Company Info and Pharmacy detail forms lose typed work with no browser prompt (unlike a real
      // page unload, which `beforeunload` guards). Ask first when something is dirty.
      if (hasUnsaved()) {
        showConfirm('Unsaved changes', 'You have unsaved changes. Discard them and leave this screen?', 'Discard')
          .then((ok) => { if (ok) router.push(dest); });
        return;
      }
      router.push(dest);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [router]);
}
