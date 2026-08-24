// The chrome the shell was missing: the toast, the confirm dialog, the credentials modal, the icon
// sprite, the theme's before-paint decision, and client-side navigation.
//
// ── WHY THIS FILE LOOKS DIFFERENT FROM THE 36 PARITY TESTS ─────────────────────────────────────────
// None of these six has a golden. They are chrome — outside the screen-by-screen strangler (report.md
// §3.5) — and three of them (`#toast`, `#cf-overlay`, `#pw-overlay`) live in markup the render harness
// never captured, because the harness records innerHTML writes by element id and none of these is ever
// written that way. So the contract is the legacy SOURCE, read out of hros.html / app.html at run time
// wherever it can be, and behaviour driven directly wherever it cannot.
//
// ── AND WHY THERE IS NO DOM HERE ───────────────────────────────────────────────────────────────────
// vitest runs `environment: 'node'` and all 36 parity tests depend on that staying true. Rather than add
// jsdom for one file, the impure halves are split out the way every migrated screen splits its own:
// `toastStyle`, `pwError`, `spaTarget` and `themeBootScript` are pure functions, and the two dialogs are
// pure components whose buttons are invoked through the small element walker below — the same trick
// `web/tests/handlers.ts` uses, kept local because that file is shared.
//
// NOT COVERED, and said out loud rather than implied: the toast QUEUE's timing (2400ms + 240ms) and the
// Escape listener both need real timers and a real document. Their inputs are pinned here; their
// scheduling is not.

import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ConfirmDialog } from '../src/confirm';
import FinanceShell from '../src/finance-shell';
import HrShell from '../src/hr-shell';
import { ICONS, Ic } from '../src/icons';
import { ALL_SCREENS, HR_NAV, href, hrNavFor, hrRole, financeNavFor, type Perms } from '../src/nav';
import { PasswordModal, pwError, pwMeter, pwScore, pwValid } from '../src/password-modal';
import { spaTarget, appOf } from '../src/spa-nav';
import { THEME_KEYS, asTheme, themeBootScript } from '../src/theme';
import { Toast, toastStyle } from '../src/toast';
import { REPO } from './parity';

const HROS = readFileSync(join(REPO, 'hros.html'), 'utf8');
const APP = readFileSync(join(REPO, 'app.html'), 'utf8');
const html = (n: ReactElement) => renderToStaticMarkup(n);

/**
 * Every `<button>` in a rendered tree, with its text and its click handler.
 *
 * `web/tests/handlers.ts` does the same walk and is shared by 36 screens' tests, which are told not to
 * touch it while migrations are in flight; this is the two-line local version, and it records the LABEL
 * as well as the handler, because on a confirm dialog which button is which is the whole question.
 */
function buttons(node: ReactNode): { text: string; onClick?: (e: unknown) => void; props: Record<string, unknown> }[] {
  const out: { text: string; onClick?: (e: unknown) => void; props: Record<string, unknown> }[] = [];
  const text = (n: ReactNode): string => {
    if (n === null || n === undefined || typeof n === 'boolean') return '';
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(text).join('');
    const el = n as ReactElement<Record<string, unknown>>;
    return el && typeof el === 'object' && 'props' in el ? text((el.props as { children?: ReactNode }).children) : '';
  };
  const walk = (n: ReactNode): void => {
    if (n === null || n === undefined || typeof n === 'boolean' || typeof n === 'string' || typeof n === 'number') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const el = n as ReactElement<Record<string, unknown>>;
    if (!el || typeof el !== 'object' || !('props' in el)) return;
    const props = (el.props || {}) as Record<string, unknown>;
    if (el.type === 'button') {
      out.push({ text: text(props.children as ReactNode), onClick: props.onClick as never, props });
    }
    if (typeof el.type === 'function') { walk((el.type as (p: Record<string, unknown>) => ReactNode)(props)); return; }
    walk(props.children as ReactNode);
  };
  walk(node);
  return out;
}

/**
 * Every `page.tsx` under `web/app/hr` and `web/app/finance`, at any depth.
 *
 * Two checks below hang off this — the alert/confirm scan and the client-side-nav rule — and both were
 * written when every route was one segment deep. `web/app/finance/wht/doc/` and
 * `web/app/finance/pharm/detail/` (#73) are the reason it walks.
 */
function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) walkRoutes(join(dir, d.name), out);
    // POSIX separators, because these paths are then SLICED as strings (`split('/app/')`). On Windows
    // `join` produces backslashes, `split('/app/')` returns [whole, undefined], and this whole guard
    // threw before it could assert anything — i.e. the check that a route added at a depth spaTarget()
    // does not reach must fail HERE was silently absent on every Windows clone.
    else if (d.name === 'page.tsx') out.push(join(dir, d.name).split(sep).join('/'));
  }
  return out;
}

const ROUTE_FILES = (['hr', 'finance'] as const)
  .flatMap((app) => walkRoutes(join(import.meta.dirname, '..', 'app', app)));

/** `/finance/wht/doc/` — the URL a route file's directory serves, relative to the base path. */
function routeUrl(file: string): string {
  return '/' + file.split('/app/')[1].replace(/\/page\.tsx$/, '') + '/';
}

// ══ 1. The icon sprite — `ICONS` / `ic(n,s)` ═══════════════════════════════════════════════════════

describe('ic() — one sprite, and it is hros.html’s', () => {
  /** hros.html's own `ICONS` object, parsed out of the file rather than retyped. */
  const legacyIcons = (): Record<string, string> => {
    const at = HROS.indexOf('var ICONS={');
    expect(at, 'hros.html no longer declares ICONS').toBeGreaterThan(-1);
    const block = HROS.slice(at, HROS.indexOf('\n};', at));
    const out: Record<string, string> = {};
    for (const m of block.matchAll(/^\s*([a-z]+):'(.*?)',?$/gm)) out[m[1]] = m[2];
    return out;
  };

  /** `ic(n,s)` — hros.html:1241, evaluated here rather than described. */
  const legacyIc = (d: string, s: number) =>
    `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor"`
    + ` stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

  it('carries every key hros.html declares, and no others', () => {
    const legacy = legacyIcons();
    expect(Object.keys(legacy).length).toBe(20);
    expect(Object.keys(ICONS).sort()).toEqual(Object.keys(legacy).sort());
  });

  it('draws each one byte for byte the way ic() does, at every size the chrome uses', () => {
    const legacy = legacyIcons();
    // 18 is `ic()`'s default; 19 / 22 / 15 are the sidebar, the mobile tab bar and the theme button.
    for (const s of [18, 19, 22, 15]) {
      for (const [k, d] of Object.entries(legacy)) {
        expect(html(<Ic n={k} s={s} />), `${k} @ ${s}`).toBe(legacyIc(d, s));
      }
    }
    expect(html(<Ic n="dashboard" />)).toBe(legacyIc(legacy.dashboard, 18));
  });

  it('renders nothing for an unknown key or none at all — ic() returns "" (hros.html:1241)', () => {
    expect(html(<Ic n="not-a-real-icon" />)).toBe('');
    expect(html(<Ic />)).toBe('');
  });

  // Guard the guard. The comparison above is only worth anything if a single wrong digit fails it, which
  // is the exact defect a hand-converted sprite would carry and nothing else in this repo would notice.
  it('the comparison still bites — one changed coordinate fails', () => {
    const legacy = legacyIcons();
    const bent = legacy.moon.replace('12.8', '12.9');
    expect(bent).not.toBe(legacy.moon);
    expect(html(<Ic n="moon" />)).not.toBe(legacyIc(bent, 18));
  });
});

// ══ 2. The toast ═══════════════════════════════════════════════════════════════════════════════════

describe('toast() — common.js:29', () => {
  it('renders the legacy #toast div, and `show` is the class that reveals it', () => {
    expect(html(<Toast msg="Saved" show={false} />)).toBe('<div class="toast" id="toast">Saved</div>');
    expect(html(<Toast msg="Saved" show />)).toBe('<div class="toast show" id="toast">Saved</div>');
    // `.toast.show{opacity:1}` — app.html:269 / hros.html:215. Without the class it is invisible, so a
    // port that forgot it would show nothing at all and no output assertion above would say why.
    expect(APP).toContain('.toast.show{opacity:1');
    expect(HROS).toContain('.toast.show{opacity:1');
  });

  it('an error toast is visibly an error — common.js:36-37', () => {
    expect(toastStyle(true)).toEqual({ borderColor: 'rgba(239,68,68,.45)', color: 'var(--red-soft)' });
    expect(toastStyle(false)).toEqual({ borderColor: '', color: '' });
    // THE defect this exists to catch: `isErr` silently dropped. "Failed: Xero rejected" would then be
    // rendered in exactly the same calm grey as "Saved", and every other assertion here would pass.
    expect(html(<Toast msg="Failed" isErr show />)).not.toBe(html(<Toast msg="Failed" show />));
    expect(html(<Toast msg="Failed" isErr show />)).toContain('color:var(--red-soft)');
    // …and a SUCCESS must carry no colour at all: React drops empty declarations, so there is no
    // `style` attribute rather than an empty one (which react-dom/server cannot emit anyway).
    expect(html(<Toast msg="Saved" show />)).not.toContain('style');
  });

  // A legacy defect, mirrored the other way round — see src/toast.tsx's header. hros.html's toast div
  // has no `class="toast"`, so in HR OS today the notice is unstyled text at the bottom of the document.
  // Both stylesheets carry the rule; neither carries an `#toast` selector. Pinned so that a fix in
  // hros.html shows up here as a disagreement rather than as two apps quietly differing.
  it('hros.html’s own toast div still carries no class — the defect this port does not copy', () => {
    expect(HROS).toContain('<div id="toast"></div>');
    expect(APP).toContain('<div class="toast" id="toast"></div>');
    expect(HROS).not.toContain('#toast{');
    expect(APP).not.toContain('#toast{');
  });
});

// ══ 3. The confirm dialog ══════════════════════════════════════════════════════════════════════════

describe('showConfirm() — app.html:2402', () => {
  const req = { title: 'Reject Bill', msg: 'Reject and void this bill? This action cannot be undone.', okTxt: 'Reject', okCls: 'd' };
  const noop = () => {};

  it('is app.html’s #cf-overlay, ids and all', () => {
    const out = html(<ConfirmDialog req={req} onResolve={noop} />);
    for (const id of ['cf-overlay', 'cf-title', 'cf-msg', 'cf-ok']) expect(out, id).toContain(`id="${id}"`);
    expect(out).toContain('class="modal-ft"');
    expect(out).toContain('Reject Bill');
    expect(out).toContain('Reject and void this bill? This action cannot be undone.');
    // The legacy element these mirror is still there and still shaped this way.
    expect(APP).toContain('<div class="overlay hide" id="cf-overlay">');
    expect(APP).toContain('<button class="btn" onclick="cfResolve(false)">Cancel</button>');
    expect(APP).toContain('<button class="btn d" id="cf-ok" onclick="cfResolve(true)">Confirm</button>');
  });

  it('Cancel resolves FALSE and OK resolves TRUE, in the legacy’s order', () => {
    const seen: boolean[] = [];
    const bs = buttons(<ConfirmDialog req={req} onResolve={(v) => seen.push(v)} />);
    expect(bs.map((b) => b.text)).toEqual(['Cancel', 'Reject']);
    bs[0].onClick!({});
    bs[1].onClick!({});
    // THE assertion. A dialog whose Cancel resolves true silently turns "are you sure?" into "yes" —
    // and on `finance.approvals` that VOIDS a supplier bill in a live Xero ledger.
    expect(seen).toEqual([false, true]);
  });

  it('defaults to Confirm / destructive, exactly as app.html:2405 does', () => {
    const out = html(<ConfirmDialog req={{ title: 'T', msg: 'M' }} onResolve={noop} />);
    expect(out).toContain('<button class="btn d" id="cf-ok"');
    expect(buttons(<ConfirmDialog req={{ title: 'T', msg: 'M' }} onResolve={noop} />).map((b) => b.text))
      .toEqual(['Cancel', 'Confirm']);
    // `okCls` chooses the styling; 'p' is the primary (non-destructive) button.
    expect(html(<ConfirmDialog req={{ title: 'T', msg: 'M', okCls: 'p' }} onResolve={noop} />))
      .toContain('<button class="btn p" id="cf-ok"');
  });

  it('keeps the paragraph breaks the ported messages carry', () => {
    // Every message moved here came from `window.confirm()`, where `\n\n` is a real break. Without
    // `pre-line` the warning runs into the question and the operator reads one sentence.
    const long = { title: 'Delete employee', msg: 'Delete X permanently?\n\nThis cannot be undone.' };
    expect(html(<ConfirmDialog req={long} onResolve={noop} />)).toContain('white-space:pre-line');
  });
});

// ══ 4. The credentials modal ═══════════════════════════════════════════════════════════════════════

describe('the credentials modal — app.html:1186 + hros.html:1317', () => {
  const base = {
    old: '', neu: '', cfm: '', err: null, saving: false,
    onField: () => {}, onSave: () => {}, onClose: () => {},
  };

  it('is a PASSWORD field three times over', () => {
    // The one defect on this form that is invisible in a screenshot taken by its author and obvious to
    // everyone standing behind the operator.
    const out = html(<PasswordModal {...base} forced={false} />);
    expect([...out.matchAll(/type="password"/g)].length).toBe(3);
    expect(out).not.toContain('type="text"');
    for (const id of ['pw-overlay', 'pw-old', 'pw-new', 'pw-cfm', 'pw-meter', 'pw-save']) {
      expect(out, id).toContain(`id="${id}"`);
    }
  });

  it('forced has NO way out — app.html:2615-2616', () => {
    const forced = html(<PasswordModal {...base} forced />);
    expect(forced).toContain('Set a new password');
    expect(forced).toContain('pw-forced-note');
    expect(forced).not.toContain('id="pw-cancel"');
    expect(forced).not.toContain('id="pw-close"');
    expect(buttons(<PasswordModal {...base} forced />).map((b) => b.text)).toEqual(['Save']);
    // …and the ordinary one does, with the legacy's own title.
    const open = html(<PasswordModal {...base} forced={false} />);
    expect(open).toContain('Change Password');
    expect(open).toContain('id="pw-cancel"');
    expect(open).toContain('id="pw-close"');
    expect(open).not.toContain('pw-forced-note');
    // The legacy lines this mirrors are still there.
    expect(APP).toContain("document.getElementById('pw-cancel').style.display=PW_FORCED?'none':'';");
    expect(APP).toContain('if(ME && ME.must_change_pw){');
    expect(HROS).toContain('if(ME && ME.must_change_pw){');
  });

  it('pwValid() is app.html:2525’s rule, at its boundaries', () => {
    expect(pwValid('abc12345')).toBe(true);      // 8, letters + digits
    expect(pwValid('abc1234')).toBe(false);      // 7 — one short
    expect(pwValid('abcdefgh')).toBe(false);     // no digit
    expect(pwValid('12345678')).toBe(false);     // no letter
    expect(pwValid('')).toBe(false);
  });

  it('the validation ladder keeps app.html:2628-2632’s ORDER', () => {
    expect(pwError('', '', '')).toBe('All fields required');
    expect(pwError('old', 'short1', 'short1')).toContain('at least 8 characters');
    expect(pwError('abc12345', 'abc12345', 'abc12345')).toBe('New password must be different from the current one');
    expect(pwError('old-one1', 'abc12345', 'abc99999')).toBe('Passwords do not match');
    expect(pwError('old-one1', 'abc12345', 'abc12345')).toBe(null);
    // THE case that makes the two rules distinguishable, and the reason it is here: the first cut of
    // this test asserted only the five above, and swapping the last two rules in pwError() left every
    // one of them passing. Both rules are TRUE for a reused-and-mistyped password — old === new AND
    // new !== confirm — so only an input that satisfies both can see which one the ladder reaches
    // first. app.html:2630 answers "must be different", which is the message that names what the user
    // actually did; "do not match" sends them to correct the wrong box.
    expect(pwError('abc12345', 'abc12345', 'abc99999')).toBe('New password must be different from the current one');
  });

  it('pwScore()/pwMeter() are app.html:2516 and :2526', () => {
    expect(pwScore('')).toBe(0);
    expect(pwScore('abc12345')).toBe(2);                       // >=8, has digit
    expect(pwScore('Abcdefgh123456!')).toBe(4);                // capped
    expect(pwMeter('').width).toBe('0%');
    expect(pwMeter('').hint).toBe('');
    expect(pwMeter('abc1234').hint).toBe('Need 8+ chars with letters and numbers');
    expect(pwMeter('abc12345').width).toBe('60%');             // (2+1)*20
  });
});

// ══ 5. Client-side navigation ══════════════════════════════════════════════════════════════════════

describe('spaTarget() — which clicks the app handles itself', () => {
  it('routes within one app', () => {
    expect(spaTarget('/hr/leave/', '/hr/payroll/')).toBe('/hr/payroll/');
    expect(spaTarget('/finance/wht/', '/finance/pnl/')).toBe('/finance/pnl/');
  });

  it('refuses to cross the app boundary — the two legacy stylesheets are why', () => {
    // app/hr/layout.tsx and app/finance/layout.tsx import DIFFERENT generated stylesheets that disagree
    // on 38 selectors. A client-side hop would have both alive at once and would silently restyle one
    // app with the other's `:root`. A document load is also what the legacy jump between two HTML files
    // has always been.
    expect(spaTarget('/hr/leave/', '/finance/wht/')).toBe(null);
    expect(spaTarget('/finance/wht/', '/hr/leave/')).toBe(null);
  });

  it('leaves every handoff, the landing page and anything unknown alone', () => {
    expect(spaTarget('/hr/leave/', '/hros.html')).toBe(null);
    expect(spaTarget('/finance/wht/', '/app.html')).toBe(null);
    expect(spaTarget('/finance/wht/', '/')).toBe(null);
    expect(spaTarget('/', '/finance/wht/')).toBe(null);          // the launcher is in neither tree
    expect(spaTarget('/finance/wht/', '/finance/wht/doc/deep/')).toBe(null);   // deeper than any route
    expect(spaTarget('/finance/wht/', '/finance/wht')).toBe(null);   // trailingSlash: true — not a route
    expect(appOf('/index.html')).toBe(null);
  });

  it('routes to a SIBLING PAGE, which is where an operator clicks most', () => {
    // `/finance/wht/doc/` and `/finance/pharm/detail/` (#73) are real routes one segment below their
    // screen. Until they existed the rule was one segment deep, which would have made the open-a-
    // computation / come-back / open-the-next loop a full document load each way.
    expect(spaTarget('/finance/wht/', '/finance/wht/doc/')).toBe('/finance/wht/doc/');
    expect(spaTarget('/finance/wht/doc/', '/finance/wht/')).toBe('/finance/wht/');
    expect(spaTarget('/finance/pharm/', '/finance/pharm/detail/')).toBe('/finance/pharm/detail/');
    expect(spaTarget('/hr/leave/', '/finance/pharm/detail/')).toBe(null);   // still no crossing
  });

  it('covers every route file on disk, and nothing deeper than one', () => {
    // Derived from `web/app/**`, not from a list here: a route added at a depth the rule does not reach
    // would otherwise be a silent full page load, which is exactly what #73's two sibling pages were
    // before this test walked. A three-deep route fails here rather than degrading quietly.
    expect(ROUTE_FILES.length).toBeGreaterThan(36);
    // Guard the guard, on the axis that actually broke it: these paths are sliced as strings, so a
    // Windows separator makes routeUrl() throw and this whole check assert nothing. It failed LOUDLY
    // rather than silently — and was ignored for exactly that reason, as one of "the two known
    // failures", which is the same outcome.
    for (const f of ROUTE_FILES) expect(f, 'route paths must be POSIX').not.toContain('\\');
    for (const f of ROUTE_FILES) {
      const url = routeUrl(f);
      const app = url.startsWith('/hr/') ? 'hr' : 'finance';
      if (url === '/hr/' || url === '/finance/') continue;          // each app's index, not a screen
      const same = app === 'hr' ? '/hr/dashboard/' : '/finance/cfo/';
      const other = app === 'hr' ? '/finance/cfo/' : '/hr/dashboard/';
      expect(spaTarget(same, url), `${url} is not client-routed`).toBe(url);
      expect(spaTarget(other, url), `${url} is routed across the app boundary`).toBe(null);
    }
  });

  it('agrees with href() for all 36 screens, in both directions', () => {
    // The rule has to be the same rule the nav uses, not a second regex that drifts from it. Every
    // migrated entry is routed from its own app and refused from the other; every entry's UNMIGRATED
    // href — the `#tab=` handoff — is refused from everywhere, which is the direction that would break
    // the strangler if it were wrong.
    for (const e of ALL_SCREENS) {
      const same = e.app === 'hr' ? '/hr/dashboard/' : '/finance/cfo/';
      const other = e.app === 'hr' ? '/finance/cfo/' : '/hr/dashboard/';
      expect(spaTarget(same, href(e)), e.id).toBe(href(e));
      expect(spaTarget(other, href(e)), e.id).toBe(null);
      expect(spaTarget(same, href({ ...e, migrated: false })), e.id).toBe(null);
      expect(spaTarget(other, href({ ...e, migrated: false })), e.id).toBe(null);
    }
  });
});

// ══ 6. The theme, before the first paint ═══════════════════════════════════════════════════════════

describe('the saved theme is applied before paint, not on mount', () => {
  /** Run the boot script against a fake document — no jsdom, and no globals touched. */
  function run(script: string, path: string, store: Record<string, string>): string | null {
    let attr: string | null = 'light';   // what app/layout.tsx server-renders
    const doc = {
      documentElement: {
        setAttribute: (k: string, v: string) => { if (k === 'data-theme') attr = v; },
        getAttribute: () => attr,
      },
    };
    const ls = { getItem: (k: string) => (k in store ? store[k] : null) };
    new Function('location', 'localStorage', 'document', script)({ pathname: path }, ls, doc);
    return attr;
  }

  const S = themeBootScript('');

  it('reads the HR key on an HR path and the Finance key on a Finance path', () => {
    expect(run(S, '/hr/leave/', { [THEME_KEYS.hr]: 'dark' })).toBe('dark');
    expect(run(S, '/finance/wht/', { [THEME_KEYS.finance]: 'dark' })).toBe('dark');
    // Cross-wired keys are the defect worth naming: someone who runs HR OS dark and Finance light gets
    // exactly that today, and reading the wrong key flips both.
    expect(run(S, '/hr/leave/', { [THEME_KEYS.finance]: 'dark' })).toBe('light');
    expect(run(S, '/finance/wht/', { [THEME_KEYS.hr]: 'dark' })).toBe('light');
  });

  it('leaves the server-rendered light theme alone for everything else', () => {
    expect(run(S, '/hr/leave/', {})).toBe('light');
    expect(run(S, '/hr/leave/', { [THEME_KEYS.hr]: 'light' })).toBe('light');
    expect(run(S, '/', { [THEME_KEYS.hr]: 'dark' })).toBe('light');
    expect(run(S, '/index.html', { [THEME_KEYS.finance]: 'dark' })).toBe('light');
    expect(asTheme(null)).toBe('light');
    expect(asTheme('DARK')).toBe('light');       // the legacy compares to the exact string
  });

  it('honours the base path', () => {
    expect(run(themeBootScript('/ctg-finance-portal'), '/ctg-finance-portal/hr/leave/',
      { [THEME_KEYS.hr]: 'dark' })).toBe('dark');
  });

  it('survives a localStorage that throws — Safari private mode', () => {
    const doc = { documentElement: { setAttribute: () => {}, getAttribute: () => 'light' } };
    const ls = { getItem: () => { throw new Error('SecurityError'); } };
    expect(() => new Function('location', 'localStorage', 'document', S)({ pathname: '/hr/x/' }, ls, doc))
      .not.toThrow();
  });

  // A FLASH IS INVISIBLE TO AN OUTPUT ASSERTION — the same finding `finance.calendar`'s `dueLabel()`
  // carries in its third form. Every check above would still pass if the script were moved out of
  // <head> into a `useEffect`, because the end state is identical; only WHEN it runs differs. So the
  // implementation is pinned: the root layout must render it, and both legacy files must still do the
  // same thing in <head> — if either stops, this claim has rotted and should fail here.
  it('runs from the root layout’s <head>, and writes nothing back', () => {
    const layout = readFileSync(join(import.meta.dirname, '..', 'app', 'layout.tsx'), 'utf8');
    expect(layout).toContain('<head>');
    expect(layout).toContain('themeBootScript(BASE_PATH)');
    expect(layout).toContain('data-theme="light"');
    // A boot script that WROTE the key would become a second source of truth for the theme, which is
    // exactly what the shell's toggle already owns.
    expect(S).not.toContain('setItem');
    expect(S).toContain('getItem');
    // Both legacy apps decide before paint, in <head>. hros.html carries the attribute on <html> itself.
    expect(HROS.slice(0, 400)).toContain('data-theme="light"');
    expect(APP.indexOf(THEME_KEYS.finance)).toBeLessThan(APP.indexOf('<body'));
  });
});

// ══ 7. The shell's own wiring ══════════════════════════════════════════════════════════════════════

const noop = () => {};

// The four chrome controls this file does not exercise, so a shell prop added for one of them is a
// mechanical addition here and not a change to anything asserted below. src/finance-alerts.tsx,
// src/finance-security.tsx and src/finance-export.ts own their own behaviour.
const CHROME = { onToggleAlerts: noop, alertBadge: null, onSecurity: noop, onExport: noop };

function hrShellHtml(): ReactElement {
  return (
    <HrShell view="dashboard" entries={hrNavFor(hrRole('admin'), true)} empMode={false} viewer={false}
      master companies={[{ tenant_id: 't1', tenant_name: 'CTG' }]} tenant="t1" companyName="CTG"
      theme="light" collapsed={false} onPickCompany={noop} onToggleTheme={noop} onToggleNav={noop}
      onChangePassword={noop} onSignOut={noop}>x</HrShell>
  );
}

function financeShellHtml(onChangePassword = noop): ReactElement {
  const perms: Perms = { manage_users: true, features: ['overview'] };
  return (
    <FinanceShell active="overview" tabs={financeNavFor(perms)} cats={[]} who="B" role="Admin"
      companies={[]} company="" online theme="light" onPickCompany={noop} onToggleTheme={noop}
      onRefresh={noop} onChangePassword={onChangePassword} {...CHROME} onSignOut={noop}>x</FinanceShell>
  );
}

describe('Change password is a control, not a handoff', () => {
  it('both shells open the ported dialog instead of sending the operator back to the legacy app', () => {
    for (const [name, node] of [['HR', hrShellHtml()], ['Finance', financeShellHtml()]] as const) {
      const out = html(node);
      const bs = buttons(node).filter((b) => /Change [Pp]assword/.test(b.text));
      expect(bs.length, `${name}: exactly one Change password control`).toBe(1);
      expect(bs[0].onClick, `${name}: it must be wired`).toBeTypeOf('function');
      // …and it is not ALSO still a link into the app this one replaces.
      expect(out, name).not.toMatch(/<a[^>]*>[^<]*🔑?\s*<span class="lbl">Change password/);
      expect(out, name).not.toMatch(/<a[^>]*>Change Password<\/a>/);
    }
  });

  it('the click reaches the prop', () => {
    let hit = 0;
    const bs = buttons(financeShellHtml(() => { hit++; }));
    bs.filter((b) => /Change Password/.test(b.text))[0].onClick!({});
    expect(hit).toBe(1);
  });

  // Was "Security and Alerts are still honest handoffs — neither was ported". Both ARE ported now
  // (src/finance-security.tsx, src/finance-alerts.tsx), along with ⬇ Export, so the assertion is
  // inverted rather than dropped: the three keep their labels and their positions, they are CONTROLS,
  // and — the half that matters — the Finance chrome no longer links into the app it replaces at all.
  it('Security, Alerts and Export are controls, and the chrome links into app.html nowhere', () => {
    const out = html(financeShellHtml());
    for (const label of ['🔐 Security', '🔔', '⬇ Export']) expect(out, label).toContain(label);
    expect(out).not.toMatch(/<a[^>]*href="\/app\.html/);
    const labelled = buttons(financeShellHtml()).filter((b) => /🔐 Security|🔔|⬇ Export/.test(b.text));
    expect(labelled.length).toBe(3);
    for (const b of labelled) expect(b.onClick, b.text).toBeTypeOf('function');
  });

  /**
   * All four of these controls take NO argument, so "it is wired" cannot tell one from another —
   * hr.payroll's `LEGACY_TO_PROP` finding, in the chrome. Introduced by wiring ⬇ Export to
   * `onSecurity` and watching every other assertion in this file still pass.
   */
  it('each argument-free chrome control reaches its OWN prop', () => {
    const hit: string[] = [];
    const perms: Perms = { manage_users: true, features: ['overview'] };
    const node = (
      <FinanceShell active="overview" tabs={financeNavFor(perms)} cats={[]} who="B" role="Admin"
        companies={[]} company="" online theme="light" onPickCompany={noop} onToggleTheme={() => hit.push('theme')}
        onRefresh={() => hit.push('refresh')} onChangePassword={() => hit.push('password')}
        onToggleAlerts={() => hit.push('alerts')} alertBadge={null}
        onSecurity={() => hit.push('security')} onExport={() => hit.push('export')}
        onSignOut={() => hit.push('signout')}>x</FinanceShell>);
    const by = (re: RegExp) => buttons(node).find((b) => re.test(b.text))!;
    by(/🔔/).onClick!({});
    by(/🔐 Security/).onClick!({});
    by(/⬇ Export/).onClick!({});
    by(/Change Password/).onClick!({});
    by(/Sign Out/).onClick!({});
    expect(hit).toEqual(['alerts', 'security', 'export', 'password', 'signout']);
  });

  // The HR sidebar's own destinations are unchanged by any of this — shell.test.tsx diffs them against
  // the goldens. This is only the count, so that a foot button added or lost here is visible.
  it('the HR foot is still four controls in the legacy’s order', () => {
    expect(buttons(hrShellHtml()).map((b) => b.text.replace(/\s+/g, ' ').trim()))
      .toEqual(['Dark mode', '↔', '🔑 Change password', 'Sign out']);
    expect(html(hrShellHtml())).toContain('Finance OS');   // the master-only jump, still an anchor
  });
});

// ══ 8. No route asks with the browser's own dialog any more ════════════════════════════════════════

describe('every React route asks with the app’s own controls', () => {
  // WALKED, not listed one level deep. The first cut of this read `app/<app>/*/page.tsx` only, and #73
  // then added `finance/wht/doc/` and `finance/pharm/detail/` — two route files carrying four
  // `confirm()`s between them that the scan could not see. A guard that only covers the shape the app
  // had on the day it was written is not a guard.
  const routes = ROUTE_FILES.concat(
    ['hr', 'finance'].map((app) => join(import.meta.dirname, '..', 'app', app, 'layout.tsx')));

  /** Comments out, so the prose ABOUT `confirm()` in half these files does not count as a call. */
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('finds no bare alert() or confirm() anywhere in app/', () => {
    expect(routes.length).toBeGreaterThan(30);
    const bad: string[] = [];
    for (const p of routes) {
      const src = code(readFileSync(p, 'utf8'));
      for (const m of src.matchAll(/(?<![\w.])(?:window\.)?(alert|confirm)\s*\(/g)) {
        bad.push(`${p.split('/app/')[1]}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  // Guard the guard: the scan has to be able to see one. `showConfirm(` must NOT trip it, and a real
  // `confirm(` must.
  it('the scan still bites', () => {
    const scan = (s: string) => [...code(s).matchAll(/(?<![\w.])(?:window\.)?(alert|confirm)\s*\(/g)].length;
    expect(scan('if (!confirm("x")) return;')).toBe(1);
    expect(scan('if (!window.confirm("x")) return;')).toBe(1);
    expect(scan('alert("x")')).toBe(1);
    expect(scan('if (!await showConfirm("t", "m")) return;')).toBe(0);
    expect(scan('// the legacy uses confirm() here')).toBe(0);
  });

  // `prompt()` is deliberately still the browser's, in both apps — see the headers of
  // app/finance/users/page.tsx and app/hr/expenses/page.tsx. Asserted so the choice is visible rather
  // than looking like an oversight next to the scan above.
  // v225 took the count from 7 to 11: `app/hr/expenses/page.tsx` ported `hrRCOverride()` (hros.html:2597)
  // and `hrRCAdjustAmount()` (hros.html:2581), two prompts each. Both ask for a FIGURE and a REASON, and
  // the legacy asks the same way; the confirm that follows the adjustment IS the app's own dialog.
  // v226 took it from 11 to 19, all eight in the same route and all eight in the legacy's own words:
  // the accounting export's month (hros.html:1857), `hrRCSetGl()`'s code + reason (:2572-2573),
  // `hrRCAddCC()`'s code + name (:2687), `hrRCAddRate()`'s rate + label (:2689) and
  // `hrRCAddApprover()`'s numbered picker (:2690). Each is a TEXT prompt, which is not one of the two
  // controls this shell ported — the three CONFIRMS those flows also ask (the cost-centre scope, the
  // deactivation, the Xero post) are all `showConfirm`, which is what the scan above enforces.
  it('prompt() is deliberately left native, and there are exactly the sites we know about', () => {
    const n = routes.reduce((a, p) => a + [...code(readFileSync(p, 'utf8')).matchAll(/(?<![\w.])(?:window\.)?prompt\s*\(/g)].length, 0);
    expect(n).toBe(19);
  });
});

// A last cross-check that the shell still names every screen — this file adds controls to the chrome and
// must not have quietly changed what it advertises. shell.test.tsx owns the detail; this is the count.
it('the nav still lists all 36 screens', () => {
  expect(ALL_SCREENS.length).toBe(36);
  expect(HR_NAV.length).toBe(12);
});
