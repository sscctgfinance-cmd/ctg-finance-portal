import type { ReactNode } from 'react';

import { BASE_PATH } from '../src/portal';
import { themeBootScript } from '../src/theme';

// NO legacy stylesheet is imported here, deliberately. Each legacy app has its own, and 38 of their
// selectors — `:root`, `body`, `.btn`, `.panel`, `.pill`, `.bigtable td` among them — carry different
// declarations, so one shared stylesheet would mean whichever loaded second silently restyled the other
// app's screens. They are scoped per route tree instead: app/hr/layout.tsx imports hros.html's,
// app/finance/layout.tsx imports app.html's. See scripts/sync-legacy-css.mjs's header.

export const metadata = {
  // Both apps are behind this shell now, so it is named for the portal rather than for HR OS.
  title: 'CTG Finance Portal · React',
  // The legacy files carry this and it is load-bearing: the portal is invite-only and there is no SEO
  // surface anywhere in it.
  robots: 'noindex',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // `data-theme="light"` matches hros.html:2, and it is right for Finance too: app.html carries no
  // attribute on <html> but its boot script (app.html:1012) resolves to 'light' as the CTG brand
  // default before paint. Both legacy stylesheets' light modes are additive and only active under this
  // attribute, so without it every migrated screen renders in dark on a light shell.
  //
  // The operator's SAVED preference is applied by the script below, before the first paint, exactly as
  // both legacy files do it in <head>. This layout used to leave that to a `useEffect` in each app's
  // layout, which meant a dark-mode operator saw one light frame on every load; the comment here said
  // the root layout could not know which of the two keys to read, and that was wrong — the URL says
  // which app the page belongs to, and src/theme.ts owns both key names so nothing is duplicated.
  return (
    <html lang="en" data-theme="light">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript(BASE_PATH) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
