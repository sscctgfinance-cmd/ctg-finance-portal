// The saved theme, and the one script that has to run before the first paint.
//
// ── THE FLASH ──────────────────────────────────────────────────────────────────────────────────────
// Both legacy apps decide the theme in a BLOCKING inline script in <head> (hros.html:2, app.html:1012),
// so a dark-mode operator never sees a light pixel. The React shell read the same keys in a `useEffect`
// instead, which runs after hydration — one full light frame, on every navigation, for everyone who has
// chosen dark. It is the kind of thing nobody files a bug about and everybody notices.
//
// `themeBootScript()` is that <head> script, rendered by app/layout.tsx into every exported page. It is
// NOT a second source of truth: the keys below are the only place either name is written, the layouts
// read the same constants, and the shells' toggles write them. The script's only job is to apply, before
// paint, what the toggle already stored.
//
// ── WHY THE ROOT LAYOUT CAN DECIDE AT ALL ──────────────────────────────────────────────────────────
// It could not before, and the comment it carried said so: two apps, two keys, and a root layout that
// does not know which app the page belongs to. It does know the URL, though — `/hr/…` and `/finance/…`
// are the two route trees, one per legacy app — so the script reads the path and picks the key. That is
// the same mapping `app/hr/layout.tsx` and `app/finance/layout.tsx` apply by being where they are.
//
// Client-side navigation does not re-run it, and does not need to: `spaTarget()` only ever routes within
// one app, so the key that applies cannot change without a document load.

export type Theme = 'light' | 'dark';

/**
 * The legacy keys, and the ONLY place either string is written.
 *
 * `hros_theme` — hros.html:1250 (`hrToggleTheme`). `ctg-theme` — app.html:1036 (`toggleTheme`).
 * They are deliberately different: the two apps are separate installs to their users, and someone who
 * runs HR OS dark and Finance light gets exactly that today.
 */
export const THEME_KEYS = { hr: 'hros_theme', finance: 'ctg-theme' } as const;

/** app.html:1014 — the CTG brand default, and what hros.html:2 hard-codes on <html>. */
export const DEFAULT_THEME: Theme = 'light';

/** Anything that is not the string 'dark' is light, which is how both legacy readers behave. */
export function asTheme(saved: string | null | undefined): Theme {
  return saved === 'dark' ? 'dark' : DEFAULT_THEME;
}

/**
 * The blocking <head> script. Upgrades `data-theme` to dark when this app's key says so; a saved
 * 'light', an unreadable localStorage (Safari private mode) and a path in neither route tree all leave
 * the server-rendered `data-theme="light"` exactly as it is.
 */
export function themeBootScript(basePath: string): string {
  const b = JSON.stringify(basePath || '');
  const hr = JSON.stringify(THEME_KEYS.hr);
  const fin = JSON.stringify(THEME_KEYS.finance);
  return `(function(){try{var p=location.pathname,b=${b};`
    + `if(b&&p.indexOf(b)===0)p=p.slice(b.length);`
    + `var k=p.indexOf("/hr/")===0?${hr}:p.indexOf("/finance/")===0?${fin}:"";`
    + `if(k&&localStorage.getItem(k)==="dark")document.documentElement.setAttribute("data-theme","dark");`
    + `}catch(e){}})();`;
}
