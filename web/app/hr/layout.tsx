import type { ReactNode } from 'react';

// hros.html's own stylesheet, extracted at build time by scripts/sync-legacy-css.mjs. Generated, never
// edited, never committed — a migrated screen has to look like the screen it replaces, and a hand-copied
// stylesheet is a second source of truth that starts drifting the day it is written.
//
// It is imported HERE and not in the root layout because app.html ships a different stylesheet and 38 of
// its selectors — `:root`, `body`, `.btn`, `.panel`, `.pill`, `.bigtable td` among them — carry different
// declarations. One stylesheet for both apps means whichever loads second silently restyles the other's
// screens, and nothing would catch it (the parity tests compare markup, not CSS). Scoping it to this
// route tree means exactly one legacy stylesheet reaches any page. See the generator's header.
import './legacy.css';

export default function HrLayout({ children }: { children: ReactNode }) {
  return children;
}
