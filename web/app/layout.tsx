import type { ReactNode } from 'react';

// hros.html's own stylesheet, extracted at build time by scripts/sync-legacy-css.mjs. Generated, never
// edited, never committed — a migrated screen has to look like the screen it replaces, and a hand-copied
// stylesheet is a second source of truth that starts drifting the day it is written.
import './legacy.css';

export const metadata = {
  title: 'HR OS · CTG',
  // The legacy files carry this and it is load-bearing: the portal is invite-only and there is no SEO
  // surface anywhere in it.
  robots: 'noindex',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // `data-theme="light"` matches hros.html:2. The legacy stylesheet's light mode is additive and only
  // active under this attribute, so without it every migrated screen renders in dark on a light shell.
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
