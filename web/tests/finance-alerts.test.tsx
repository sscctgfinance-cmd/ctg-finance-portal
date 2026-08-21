// 🔔 Alerts — the bell's panel, src/finance-alerts.tsx.
//
// NO GOLDEN: `renderNotifPanel()` writes `#notif-panel`, a div that lives OUTSIDE `#app`
// (app.html:1185) and is never reached by any tab renderer, so `tests/render_harness.ts` never recorded
// it. The contract is therefore app.html's own source, read at run time, plus the four alert rules
// driven directly — which is where the interesting failures are: every rule's boundary, and the feature
// filter that decides whether a supplier's name and a bill's amount reach this login at all.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import FinanceShell from '../src/finance-shell';
import AlertsPanel, {
  SEV_COL, alertFeeds, alertHref, alertsFor, badgeText, computeAlerts, type Alert,
} from '../src/finance-alerts';
import { FINANCE_NAV, financeNavFor, type Perms } from '../src/nav';
import { REPO } from './parity';

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');
const html = (n: ReactElement) => renderToStaticMarkup(n);
const noop = () => {};

/** Every `<button>` in a rendered tree, with its text and its click handler — the local walker
    web/tests/shell-chrome.test.tsx uses, kept per-file because handlers.ts is shared. */
function buttons(node: ReactNode): { text: string; onClick?: (e: unknown) => void }[] {
  const out: { text: string; onClick?: (e: unknown) => void }[] = [];
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
    if (el.type === 'button') out.push({ text: text(props.children as ReactNode), onClick: props.onClick as never });
    if (typeof el.type === 'function') { walk((el.type as (p: Record<string, unknown>) => ReactNode)(props)); return; }
    walk(props.children as ReactNode);
  };
  walk(node);
  return out;
}

const bill = (contact: string, total: number) => ({ contact, total });
const ALL = ['overview', 'approvals'];

// ══ 1. The four rules, each at its own boundary ════════════════════════════════════════════════════

describe('computeAlerts() — app.html:2707-2720', () => {
  it('no data is no alerts, and neither is an empty feed', () => {
    expect(computeAlerts(null, null)).toEqual([]);
    expect(computeAlerts({ companies: [] }, { bills: [] })).toEqual([]);
  });

  it('the pending-bills rule counts every bill and sums every total', () => {
    const a = computeAlerts(null, { bills: [bill('A', 100), bill('B', 250.5)] });
    expect(a[0].t).toBe('2 bill(s) awaiting approval');
    expect(a[0].d).toBe('RM 350.50 total pending your review');
    expect(a[0].sev).toBe('med');
    expect(a[0].tab).toBe('approvals');
  });

  // AT the boundary, both sides: `> 5000` is app.html:2713's own test, and a bill of exactly RM 5,000
  // is NOT large. Moving that line is invisible to a fixture that sits well clear of it.
  it('the large-bill rule is strictly over 5000', () => {
    const at = computeAlerts(null, { bills: [bill('A', 5000)] });
    expect(at.some((x) => /large bill/.test(x.t))).toBe(false);
    const over = computeAlerts(null, { bills: [bill('A', 5000.01)] });
    expect(over.some((x) => /large bill/.test(x.t))).toBe(true);
  });

  it('the large-bill rule names the LARGEST, which is what sorting it is for', () => {
    const a = computeAlerts(null, { bills: [bill('Small', 6000), bill('Huge', 90000), bill('Mid', 7000)] });
    const big = a.find((x) => /large bill/.test(x.t))!;
    expect(big.t).toBe('3 large bill(s) over RM 5,000');
    expect(big.d).toBe('Largest: Huge RM 90,000.00');
  });

  // The duplicate key is contact + the total to two decimals (app.html:2716). Same supplier, same
  // figure, twice, is the shape of a bill paid twice — which is the one `high` alert on the screen.
  it('the duplicate rule keys on contact AND amount, and fires per REPEAT', () => {
    const same = computeAlerts(null, { bills: [bill('Acme', 120), bill('Acme', 120)] });
    const dups = same.filter((x) => x.t === 'Possible duplicate bill');
    expect(dups.length).toBe(1);
    expect(dups[0].sev).toBe('high');
    expect(dups[0].d).toBe('Acme RM 120.00 appears more than once');
    // Three identical bills push TWO, exactly as `seen[k]` does — a de-duplicating port would say one.
    expect(computeAlerts(null, { bills: [bill('Acme', 120), bill('Acme', 120), bill('Acme', 120)] })
      .filter((x) => x.t === 'Possible duplicate bill').length).toBe(2);
    // Same amount, different supplier: not a duplicate. Same supplier, a sen apart: not a duplicate.
    expect(computeAlerts(null, { bills: [bill('Acme', 120), bill('Beta', 120)] })
      .some((x) => x.t === 'Possible duplicate bill')).toBe(false);
    expect(computeAlerts(null, { bills: [bill('Acme', 120), bill('Acme', 120.01)] })
      .some((x) => x.t === 'Possible duplicate bill')).toBe(false);
  });

  // `< 0` at app.html:2718. Zero is not a loss, and a company whose net_profit is missing is not one
  // either — `Number(undefined)||0` is 0, so an absent figure must not raise an alarm on a real company.
  it('the loss rule is strictly negative, and a missing figure is not a loss', () => {
    expect(computeAlerts({ companies: [{ tenant_name: 'X', net_profit: 0 }] }, null)).toEqual([]);
    expect(computeAlerts({ companies: [{ tenant_name: 'X', net_profit: null }] }, null)).toEqual([]);
    expect(computeAlerts({ companies: [{ tenant_name: 'X' }] }, null)).toEqual([]);
    const a = computeAlerts({ companies: [{ tenant_name: 'CTG SDN BHD', net_profit: -1234.5 }] }, null);
    expect(a[0].t).toBe('Running at a loss: CTG SDN BHD');
    expect(a[0].d).toBe('Net profit RM -1,234.50 YTD');
    expect(a[0].tab).toBe('overview');
  });

  it('the ORDER is app.html’s — pending, large, duplicates, losses', () => {
    const a = computeAlerts(
      { companies: [{ tenant_name: 'L', net_profit: -1 }] },
      { bills: [bill('Acme', 9000), bill('Acme', 9000)] });
    expect(a.map((x) => x.t)).toEqual([
      '2 bill(s) awaiting approval',
      '2 large bill(s) over RM 5,000',
      'Possible duplicate bill',
      'Running at a loss: L',
    ]);
  });

  it('every sentence is app.html’s own', () => {
    for (const frag of ['bill(s) awaiting approval', 'total pending your review',
      'large bill(s) over RM 5,000', 'Largest: ', 'Possible duplicate bill',
      'appears more than once', 'Running at a loss: ', 'Net profit ']) {
      expect(APP, frag).toContain(frag);
    }
  });
});

// ══ 2. The feature filter is a permission boundary, in BOTH halves ═════════════════════════════════

describe('an alert never names data this login may not see', () => {
  it('alertsFor() drops an alert whose tab is not granted — app.html:2727', () => {
    const all = computeAlerts(
      { companies: [{ tenant_name: 'L', net_profit: -1 }] },
      { bills: [bill('Secret Supplier Sdn Bhd', 91234)] });
    expect(all.length).toBe(3);   // pending + large + loss
    // The alert TEXT is the data — supplier, amount, company name — so filtering it is not tidying.
    const viewer = alertsFor(all, ['overview']);
    expect(viewer.map((x) => x.tab)).toEqual(['overview']);
    expect(JSON.stringify(viewer)).not.toContain('Secret Supplier Sdn Bhd');
    expect(JSON.stringify(viewer)).not.toContain('91,234');
    expect(alertsFor(all, [])).toEqual([]);
    expect(alertsFor(all, null)).toEqual([]);
    expect(alertsFor(all, undefined)).toEqual([]);
  });

  it('alertFeeds() does not even ASK for a feed the login cannot see — app.html:2724', () => {
    expect(alertFeeds(ALL)).toEqual(['overview', 'pending']);
    expect(alertFeeds(['overview'])).toEqual(['overview']);
    expect(alertFeeds(['approvals'])).toEqual(['pending']);
    expect(alertFeeds([])).toEqual([]);
    expect(alertFeeds(null)).toEqual([]);
    expect(APP).toContain("feats.indexOf('overview')>=0?call({api:'overview'}):Promise.resolve(null)");
    expect(APP).toContain("feats.indexOf('approvals')>=0?call({api:'pending'}):Promise.resolve(null)");
    expect(APP).toContain("NOTIFS=computeAlerts(ov,pend).filter(function(x){return feats.indexOf(x.tab)>=0;});");
  });

  // Both halves are needed. The FETCH gate alone leaves the loss rule reachable by anyone granted
  // `overview`… which is correct; the FILTER alone would fetch two feeds this login may not read.
  it('the two halves guard different things, and neither substitutes for the other', () => {
    // A login with `overview` only: `pending` is never requested, so no bill data exists to leak.
    expect(alertFeeds(['overview'])).not.toContain('pending');
    // A login granted BOTH feeds but not the approvals TAB cannot exist through nav.ts, but if the
    // server ever sent one, the filter still drops the bill alerts.
    const all = computeAlerts(null, { bills: [bill('A', 9000)] });
    expect(alertsFor(all, ['overview'])).toEqual([]);
  });

  it('the panel links only to tabs this login can open', () => {
    const admin: Perms = { manage_users: true, features: FINANCE_NAV.map((e) => e.id) };
    expect(alertHref(financeNavFor(admin), 'approvals')).toBe('/finance/approvals/');
    // A tab the permission pass hid has no destination, so the row does not navigate at all rather
    // than landing the operator on a screen the shell says does not exist for them.
    const viewer: Perms = { manage_users: false, features: ['overview'] };
    expect(alertHref(financeNavFor(viewer), 'approvals')).toBe(null);
    expect(alertHref(financeNavFor(viewer), 'nope')).toBe(null);
  });
});

// ══ 3. The badge ══════════════════════════════════════════════════════════════════════════════════

it('badgeText() — app.html:2732-2736, including the 9+ cap and the hidden state', () => {
  expect(badgeText(0)).toBe(null);
  expect(badgeText(1)).toBe('1');
  expect(badgeText(9)).toBe('9');
  expect(badgeText(10)).toBe('9+');
  expect(badgeText(99)).toBe('9+');
  expect(APP).toContain("if(n>0){ b.textContent=n>9?'9+':String(n); b.style.display='flex'; }");
});

// ══ 4. The panel ══════════════════════════════════════════════════════════════════════════════════

describe('renderNotifPanel() — app.html:2737-2743', () => {
  const three: Alert[] = [
    { sev: 'high', t: 'Possible duplicate bill', d: 'Acme RM 120.00 appears more than once', tab: 'approvals' },
    { sev: 'med', t: '2 bill(s) awaiting approval', d: 'RM 350.50 total pending your review', tab: 'approvals' },
    { sev: 'low', t: 'Low one', d: 'detail', tab: 'overview' },
  ];
  const admin: Perms = { manage_users: true, features: FINANCE_NAV.map((e) => e.id) };
  const panel = (open: boolean, alerts: Alert[]) =>
    html(<AlertsPanel open={open} alerts={alerts} tabs={financeNavFor(admin)} onRefresh={noop} onGo={noop} />);

  it('closed is the `hide` class and NO alert text — the div exists, the data does not', () => {
    const out = panel(false, three);
    expect(out).toContain('class="notif-panel hide"');
    expect(out).not.toContain('Acme');
    expect(out).not.toContain('🔔 Alerts');
  });

  it('open carries the count in the heading and one row per alert', () => {
    const out = panel(true, three);
    expect(out).toContain('class="notif-panel"');
    expect(out).toContain('<h4>🔔 Alerts (3)</h4>');
    expect((out.match(/class="notif-item"/g) || []).length).toBe(3);
    expect(out).toContain('Possible duplicate bill');
  });

  it('each row is painted by its OWN severity — app.html:2706', () => {
    const out = panel(true, three);
    // Scoped to the row, not the document: a colour assertion over the whole panel passes when every
    // row is the same colour, which is the defect. (finance.cfo's finding.)
    const rows = out.match(/<div class="notif-item"[^>]*>/g) || [];
    expect(rows.length).toBe(3);
    expect(rows[0]).toContain(SEV_COL.high);
    expect(rows[1]).toContain(SEV_COL.med);
    expect(rows[2]).toContain(SEV_COL.low);
    expect(SEV_COL.high).not.toBe(SEV_COL.med);
    expect(APP).toContain("var SEV_COL={high:'var(--red-soft)',med:'var(--amber)',low:'var(--sky-soft)'};");
  });

  it('empty is the all-clear line, with no count in the heading', () => {
    const out = panel(true, []);
    expect(out).toContain('<h4>🔔 Alerts</h4>');
    expect(out).toContain('✓ All clear — nothing needs your attention');
    expect(out).not.toContain('notif-item');
    expect(APP).toContain('✓ All clear — nothing needs your attention');
  });

  it('row i dispatches index i — three visually similar rows is where an off-by-one hides', () => {
    const seen: number[] = [];
    const el = <AlertsPanel open alerts={three} tabs={financeNavFor(admin)} onRefresh={noop} onGo={(i) => seen.push(i)} />;
    const out = AlertsPanel(el.props as never) as ReactElement;
    // Walk the rendered children and click each row in order.
    const rows: ((e: unknown) => void)[] = [];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      const e = n as ReactElement<Record<string, unknown>>;
      if (!e || typeof e !== 'object' || !('props' in e)) return;
      const p = e.props as Record<string, unknown>;
      if (p.className === 'notif-item' && typeof p.onClick === 'function') rows.push(p.onClick as never);
      walk(p.children);
    };
    walk((out.props as { children?: unknown }).children);
    expect(rows.length).toBe(3);
    rows.forEach((f) => f({}));
    expect(seen).toEqual([0, 1, 2]);
  });

  it('the refresh control is one button and it is wired', () => {
    let hit = 0;
    const el = AlertsPanel({ open: true, alerts: three, tabs: financeNavFor(admin), onRefresh: () => { hit++; }, onGo: noop }) as ReactElement;
    const found: ((e: unknown) => void)[] = [];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      const e = n as ReactElement<Record<string, unknown>>;
      if (!e || typeof e !== 'object' || !('props' in e)) return;
      const p = e.props as Record<string, unknown>;
      if (e.type === 'button') found.push(p.onClick as never);
      walk(p.children);
    };
    walk((el.props as { children?: unknown }).children);
    expect(found.length).toBe(1);
    found[0]({});
    expect(hit).toBe(1);
  });
});

// ══ 5. The bell itself — found by breaking it, because nothing here reached it ═════════════════════
//
// Both of these were introduced deliberately and passed EVERY assertion above. They are the
// `finance.info` class: `stopPropagation` disappearing changes no argument and no text, and an empty
// badge renders as an empty span either way. What they change is whether the panel opens at all, and
// whether an operator with nothing to read carries a permanent red dot.

describe('the bell — src/finance-shell.tsx', () => {
  const perms: Perms = { manage_users: true, features: ['overview'] };
  const shell = (alertBadge: string | null, onToggleAlerts = noop) => (
    <FinanceShell active="overview" tabs={financeNavFor(perms)} cats={[]} who="B" role="Admin"
      companies={[]} company="" online theme="light" onPickCompany={noop} onToggleTheme={noop}
      onRefresh={noop} onChangePassword={noop} onToggleAlerts={onToggleAlerts} alertBadge={alertBadge}
      onSecurity={noop} onExport={noop} onSignOut={noop}>x</FinanceShell>
  );

  /**
   * `toggleNotif(e)` — app.html:2744, `if(e) e.stopPropagation();`.
   *
   * Load-bearing, not defensive: the document-level listener at app.html:2748 closes the panel on any
   * click that is neither the panel nor the bell — and the click that OPENS it is on the bell, which
   * bubbles to that listener in the same tick. Without this the panel opens and closes instantly and
   * the bell appears dead. Nothing in the markup or the handler's arguments changes, which is why this
   * is driven with a spy event rather than observed.
   */
  it('the bell stops the click from reaching the document listener that closes the panel', () => {
    let stopped = 0, toggled = 0;
    const bell = buttons(shell(null, () => { toggled++; })).find((b) => /🔔/.test(b.text))!;
    bell.onClick!({ stopPropagation: () => { stopped++; } });
    expect(stopped, 'the bell must call stopPropagation()').toBe(1);
    expect(toggled).toBe(1);
    expect(APP).toContain('function toggleNotif(e){ if(e) e.stopPropagation();');
    // …and it survives an event with no such method, which is how the shared walkers invoke handlers.
    expect(() => bell.onClick!({})).not.toThrow();
  });

  /** `renderNotifBadge()` — app.html:2735, `else b.style.display='none'`. */
  it('the badge is HIDDEN at zero and shown otherwise — an always-on dot is a standing false alarm', () => {
    const empty = html(shell(null));
    expect(empty).toMatch(/id="notif-badge"[^>]*display:none/);
    expect(empty).not.toMatch(/id="notif-badge"[^>]*display:flex/);
    const three = html(shell('3'));
    expect(three).toMatch(/id="notif-badge"[^>]*display:flex[^>]*>3</);
    expect(APP).toContain("else b.style.display='none';");
  });

  it('the bell is one control and the panel is not inside the shell', () => {
    const out = html(shell('3'));
    expect((out.match(/id="notif-btn"/g) || []).length).toBe(1);
    // app.html:1185 puts `#notif-panel` outside `#app`; the layout renders it as a sibling, so a
    // `position:fixed` panel is not clipped by the shell's own stacking context.
    expect(out).not.toContain('notif-panel');
    expect(APP).toContain('<div class="notif-panel hide" id="notif-panel"></div>');
  });
});

// ══ 6. Nothing is asked for before the permission set resolves ════════════════════════════════════
//
// finance.users' finding: the first cut of "every sub-view sits behind the same gate" passed with a
// load inserted in front of it. `alertFeeds()` DERIVES the two requests from the feature list, so a
// load that ran before `my_perms` resolved would ask for both feeds — including `pending`, a list of
// suppliers and amounts — on behalf of a login that may read neither.

it('the alert load happens only inside my_perms’ resolution, never before it', () => {
  const layout = readFileSync(join(import.meta.dirname, '..', 'app', 'finance', 'layout.tsx'), 'utf8');
  expect(layout).toContain("void call<Perms>({ api: 'my_perms' }).then((pp) => { setPerms(pp); void loadAlerts(pp); })");
  // `loadAlerts` is reached from exactly three places: that resolution, the bell, and ↻ Refresh — and
  // every one of them is handed the resolved permission set rather than reading a default.
  const sites = [...layout.matchAll(/loadAlerts\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => a !== 'pp: Perms | null');
  expect(sites).toEqual(['pp', 'perms', 'perms']);
  // A failed `my_perms` loads nothing at all — the safe direction, matching the shell's own
  // "an unresolved permission set shows no tabs".
  expect(layout).toContain('.catch(() => setPerms(null));');
});

// ══ 7. Guard the guards ═══════════════════════════════════════════════════════════════════════════

describe('the guards still bite', () => {
  it('a de-duplicating duplicate rule fails §1', () => {
    const deduped = (bills: { contact: string; total: number }[]) => {
      const keys = new Set(bills.map((b) => b.contact + '|' + b.total.toFixed(2)));
      return bills.length - keys.size > 0 ? 1 : 0;           // the defect: one alert however many repeats
    };
    expect(deduped([bill('A', 1), bill('A', 1), bill('A', 1)])).toBe(1);
    expect(computeAlerts(null, { bills: [bill('A', 1), bill('A', 1), bill('A', 1)] })
      .filter((x) => x.t === 'Possible duplicate bill').length).toBe(2);
  });

  it('a `>=` large-bill rule fails §1’s boundary case', () => {
    expect(5000 >= 5000).toBe(true);                          // the defect
    expect(computeAlerts(null, { bills: [bill('A', 5000)] }).some((x) => /large bill/.test(x.t))).toBe(false);
  });

  it('a panel that rendered its rows while closed fails §4', () => {
    expect(panelClosedHasNoData()).toBe(true);
  });

  it('a bell without stopPropagation fails §5 — the case that found the gap', () => {
    let stopped = 0;
    const naked = (_e: { stopPropagation?: () => void }) => {};      // the defect
    naked({ stopPropagation: () => { stopped++; } });
    expect(stopped).toBe(0);
    // …and what is shipped does stop it.
    const perms: Perms = { manage_users: true, features: ['overview'] };
    const bell = buttons(
      <FinanceShell active="overview" tabs={financeNavFor(perms)} cats={[]} who="B" role="Admin"
        companies={[]} company="" online theme="light" onPickCompany={noop} onToggleTheme={noop}
        onRefresh={noop} onChangePassword={noop} onToggleAlerts={noop} alertBadge={null}
        onSecurity={noop} onExport={noop} onSignOut={noop}>x</FinanceShell>).find((b) => /🔔/.test(b.text))!;
    bell.onClick!({ stopPropagation: () => { stopped++; } });
    expect(stopped).toBe(1);
  });
});

function panelClosedHasNoData(): boolean {
  const admin: Perms = { manage_users: true, features: FINANCE_NAV.map((e) => e.id) };
  const out = html(<AlertsPanel open={false} tabs={financeNavFor(admin)} onRefresh={noop} onGo={noop}
    alerts={[{ sev: 'high', t: 'SENSITIVE', d: 'x', tab: 'approvals' }]} />);
  return !out.includes('SENSITIVE');
}
