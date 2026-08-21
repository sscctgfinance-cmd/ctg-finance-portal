// `ICONS` + `ic(n,s)` — hros.html:1219-1241, in ONE place.
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────────────────────────────
// The legacy sprite is twenty keys and one four-line helper, declared once in hros.html and reachable
// from every renderer in the file. On the React side it had been re-declared FOUR times — `hr-shell.tsx`
// carried the fifteen keys the chrome draws, and `hr-access.tsx`, `hr-payslip.tsx` and `hr-employees.tsx`
// two each — so six of the twenty keys existed in React at all, in four partial copies, and the next
// screen that wanted `bell` or `collapse` would have written a fifth. That is the shape a shared helper
// exists to prevent, and the sprite is chrome, so it lives here.
//
// The three SCREENS still carry their own two-key copies: they belong to other owners this run and
// changing them is a one-line import each with byte-identical output, so it is a seam left named rather
// than taken. The chrome's copy is gone — `hr-shell.tsx` imports this.
//
// ── THE PATH DATA IS THE LEGACY'S OWN STRING, NOT HAND-CONVERTED JSX ───────────────────────────────
// Each entry below is copied byte for byte out of hros.html's `ICONS` and rendered through
// `dangerouslySetInnerHTML`. That is deliberate: converting twenty <path>/<circle>/<rect> strings into
// JSX by hand is twenty chances to drop a digit off a coordinate, and a wrong coordinate is a wrong
// glyph no reviewer would catch. There is no interpolation and no caller-supplied text anywhere near it
// — the argument is a key into this frozen table, and an unknown key renders nothing.
//
// `web/tests/shell-chrome.test.tsx` parses hros.html's own `ICONS` declaration at run time and diffs
// `<Ic/>`'s markup against `ic()`'s string for EVERY key, so a glyph edited in hros.html and not here
// (or here and not there) is a red test rather than two apps drawing different icons.
//
// Finance has no equivalent: app.html declares no `ICONS` and no `ic()` — its tabs carry emoji in their
// labels. This is HR OS's sprite, drawn by HR OS's chrome.

/** hros.html:1219 — verbatim, keys and path data unchanged. */
export const ICONS: Record<string, string> = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z"/>',
  employees: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  leave: '<path d="M12 22s7-8 7-13a7 7 0 0 0-14 0c0 5 7 13 7 13z"/><path d="M12 6v6"/>',
  claims: '<path d="M14 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  expenses: '<rect x="2" y="7" width="20" height="13" rx="1.5"/><path d="M2 11h20M6 3h12"/>',
  payroll: '<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  payslip: '<path d="M6 2h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  flow: '<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="12" r="2.4"/><path d="M8.4 6H13a2.6 2.6 0 0 1 2.6 2.6V10M8.4 18H13a2.6 2.6 0 0 0 2.6-2.6V14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  calculator: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M8 19h4"/>',
  yearend: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  collapse: '<path d="M15 18l-6-6 6-6M20 6v12"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
};

/**
 * `ic(n,s)` — hros.html:1241. Same default size, the same attributes in the same order, and the same
 * behaviour for an unknown key: the legacy returns the empty string, so this renders nothing.
 */
export function Ic({ n, s = 18 }: { n?: string; s?: number }) {
  const d = n ? ICONS[n] : undefined;
  if (!d) return null;
  return (
    <svg className="ic" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: d }} />
  );
}
