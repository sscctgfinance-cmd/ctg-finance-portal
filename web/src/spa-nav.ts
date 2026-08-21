// Which anchor clicks the app may handle itself, and which have to stay real page loads.
//
// ── THE PROBLEM ────────────────────────────────────────────────────────────────────────────────────
// Both legacy apps are ONE page: `hrNav('leave')` and `tab('wht')` swap an innerHTML and the screen is
// there. The React nav is anchors (which is what made middle-click, hover-to-see-target and Back work),
// and a plain anchor click is a full document load — new HTML, new JS, re-fetch `me` / `my_perms`, a
// white flash and the sidebar redrawn from scratch. On the app staff actually use, switching screens is
// instant. That is the whole of this file's reason to exist.
//
// ── WHY THE RULE IS "SAME APP", NOT "ANY REACT ROUTE" ──────────────────────────────────────────────
// `app/hr/layout.tsx` and `app/finance/layout.tsx` import DIFFERENT generated stylesheets, because the
// two legacy apps disagree on 38 selectors including the whole `:root` token set (CLAUDE.md, and
// scripts/sync-legacy-css.mjs's header). Two stylesheets alive at once means whichever wins silently
// restyles the other app's screens, and nothing would catch it — the parity tests compare markup, not
// CSS. A client-side hop from `/hr/…` to `/finance/…` is exactly that situation.
//
// It is also not a downgrade to refuse it: HR OS and Finance OS are two different HTML FILES today, so
// the jump between them has always been a full page load. This keeps it one.
//
// ── AND WHY IT IS A DECISION FUNCTION RATHER THAN A LINK COMPONENT ─────────────────────────────────
// The nav's anchors are rendered by `hr-shell.tsx` / `finance-shell.tsx`, which are PURE components with
// no handler props — `web/tests/shell.test.tsx` asserts that, because a nav of buttons loses
// middle-click and Back. One delegated listener on the document (see use-spa-nav.ts) upgrades every
// anchor in the app, including the ones inside migrated screens, and leaves the markup untouched.
//
// This half is pure and has no React and no browser in it, so the rule can be driven directly: the
// cases that MUST come back null are what the shell-chrome test spends most of its assertions on.

import { BASE_PATH } from './portal';

/**
 * `/hr/leave/`, `/finance/wht/` — what `href()` produces for a screen — and ONE nested segment below
 * it, which is what a SIBLING PAGE is: `/finance/wht/doc/`, `/finance/pharm/detail/`.
 *
 * The nested form was added when those pages landed (#73). A screen dispatching to its own sibling page
 * is the most navigation-heavy thing an operator does here — open a computation, come back, open the
 * next — and leaving it at one segment quietly made exactly that a full document load while everything
 * around it was instant.
 *
 * It stops at two segments on purpose: this decides what to hand `router.push()`, and a path that is
 * not a route lands the operator on the app's 404 instead of on the browser navigation they asked for.
 * Two is the depth `web/app/` actually has, and the screen-chrome test asserts that by walking
 * `web/app/**` for real `page.tsx` files rather than trusting this comment — so a three-deep route
 * added later fails there rather than silently falling back to a page load.
 */
const REACT_ROUTE = /^\/(hr|finance)\/[a-z0-9]+(\/[a-z0-9]+)?\/$/;

function strip(path: string): string {
  return BASE_PATH && path.startsWith(BASE_PATH) ? path.slice(BASE_PATH.length) : path;
}

/** 'hr' | 'finance' | null for a path in neither route tree (the landing page, a legacy file, …). */
export function appOf(path: string): 'hr' | 'finance' | null {
  const p = strip(path);
  if (p.startsWith('/hr/')) return 'hr';
  if (p.startsWith('/finance/')) return 'finance';
  return null;
}

/**
 * The path to hand to the router, or null to let the browser navigate normally.
 *
 * Both arguments are pathnames as the browser reports them, i.e. including any configured base path.
 * Null is returned for: a legacy handoff (`/app.html`, `/hros.html`), the landing page, a path deeper
 * than a sibling page, a cross-app hop, and anything reached from outside either route tree.
 */
export function spaTarget(fromPath: string, toPath: string): string | null {
  const from = appOf(fromPath);
  if (!from) return null;
  if (!REACT_ROUTE.test(strip(toPath))) return null;
  return appOf(toPath) === from ? toPath : null;
}
