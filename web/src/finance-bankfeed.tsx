// Finance OS · Bank Feed — the React half of the launcher that opens the external Fusioneta bank-feed.
//
// The legacy original is `renderBankFeed()` at app.html:4056 and it is STILL THERE and still shipping;
// nothing was deleted. Both are reachable side by side (`app.html#tab=bankfeed` and `/finance/bankfeed/`).
//
// PURE FUNCTION OF ITS PROPS — and it has none, because the legacy renderer reads nothing: no fetch, no
// module state, no clock, one hard-coded URL. That is what lets tests/finance-bankfeed.parity.test.tsx
// render it with `renderToStaticMarkup` and diff the result against tests/golden/finance.bankfeed.html.
//
// ── `loaded.bankfeed` IS NOT PORTED, AND IS ALREADY REDUNDANT IN THE LEGACY ────────────────────────
// `renderBankFeed()`'s first line sets `loaded.bankfeed=true`. That flag belongs to `tab()`
// (app.html:1503): `if(!loaded[t]) render(t)` — it stops a tab switch re-running an async fetch and
// re-painting the shared `#bankfeed` div by innerHTML. Two things follow. First, `render(t)` ALREADY
// sets `loaded[t]=true` at app.html:1539, before it dispatches, so the assignment inside the renderer
// is a no-op on every path that can reach it. Second, this screen is a constant string — re-running it
// costs nothing and can produce nothing different — so the flag is not guarding a cost here either.
// There is no React equivalent to write: a component is re-rendered as often as it likes and is a pure
// function of props, so a "have I rendered yet" flag in one would be state that can only go stale.
//
// ── THE PERMISSION GATE IS UPSTREAM OF THE RENDERER ────────────────────────────────────────────────
// `renderBankFeed()` has no role check in it at all. `showApp()` does, at app.html:1432, hiding the tab
// unless `canManage` (`PERMS.manage_users`, app.html:1419). `bankfeedReachable()` below is the pure
// mirror of that line, exported FROM THE SCREEN so the screen's own test can pin both directions; a
// route-local predicate is a gate no test can reach. See src/finance-wht.tsx's header — same mechanism,
// same file in app.html, and it is different from HR's, which gates inside `hrRender()`.

/**
 * `PERMS` — resolved by `showApp()` from `my_perms`, with `fallbackPerms()` (app.html:1398) standing in
 * when that call fails. Only `manage_users` decides this tab.
 */
export interface Perms {
  manage_users?: boolean | null;
}

/**
 * app.html:1432 — `el.classList.toggle('hide', !canManage)`, where `canManage = !!PERMS.manage_users`
 * (app.html:1419).
 *
 * What it withholds is not money on a screen: it is the existence and the address of the company's
 * bank-feed program, advertised to whoever asks. Mirrored exactly, including the shape of the falsy
 * check — `!!` means a missing `PERMS`, a missing key and an explicit `false` all read the same.
 */
export function bankfeedReachable(perms: Perms | null | undefined): boolean {
  return !!(perms && perms.manage_users);
}

/**
 * app.html:4058 — the ONLY piece of data on this screen, and it is written twice into the markup: once
 * as the anchor's `href` and once as visible text under the button, so an operator can read where they
 * are about to be sent before they click.
 *
 * Exported so the screen's test can pin it against app.html's own source rather than against a retyped
 * copy. A typo'd host here sends someone signing in with their real bank-feed credentials to whatever
 * that domain resolves to, and the screen would look completely normal.
 */
export const BANKFEED_URL = 'https://fusioneta.com.my/app/bank-feed/program.php';

/**
 * Every inline style is written as a STRING and parsed here, not as a React style object — same reason
 * as src/finance-wht.tsx's `st()`: nothing in parity.ts's relaxation layer touches an attribute VALUE,
 * so these are compared character for character, and a style object hands React two chances to change
 * one silently (it appends `px` to a bare number and re-serialises `.15` as `0.15`).
 */
function st(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of css.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const key = name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[key] = part.slice(at + 1).trim();
  }
  return out;
}

/**
 * `renderBankFeed()` — app.html:4056, element for element.
 *
 * The launch control is an `<a href target="_blank" rel="noopener noreferrer">`, NOT a button with a
 * handler, and that is deliberate rather than incidental: it is what makes the destination visible in
 * the status bar and openable in a new window, and `rel="noopener noreferrer"` is what stops the opened
 * program reaching back through `window.opener`. Turning it into an onClick would drop all three and
 * would be invisible to the string diff (parity.ts's R1 strips handlers) — so the screen's test pins the
 * anchor's attributes and asserts the React tree emits NO handler at all.
 */
export default function FinanceBankFeed() {
  return (
    <div className="panel" style={st('max-width:620px;margin:24px auto 0;text-align:center;padding:32px 26px')}>
      <div style={st('font-size:42px;line-height:1;margin-bottom:12px')}>🔗</div>
      <h2 style={st('margin:0 0 6px;font-size:20px')}>Bank Feed</h2>
      <div className="muted" style={st('font-size:13px;line-height:1.7;margin-bottom:22px')}>Opens the Fusioneta bank-feed program in a new secure tab. Sign in there with your own credentials — this is a launcher, no data is stored in the portal.</div>
      <a className="btn p" href={BANKFEED_URL} target="_blank" rel="noopener noreferrer" style={st('text-decoration:none;display:inline-block;padding:12px 28px;font-size:14px')}>Open Bank Feed ↗</a>
      <div className="muted" style={st('font-size:11px;margin-top:18px;word-break:break-all')}>{BANKFEED_URL}</div>
    </div>
  );
}
