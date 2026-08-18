// What makes relaxation R1 (dropping `on*=` attributes) safe rather than blind.
//
// The legacy golden carries `onchange="hrUserRoleSet('u9',this.value)"` — the function AND the argument.
// React carries a closure and emits no attribute, so a plain string comparison loses the argument. That
// is exactly the defect class render_surfaces.ts's policy comment warns about: `onclick="sbiVoid(12)"`
// silently becoming `onclick="sbiVoid(11)"` is a real defect and is invisible in stripped output.
//
// So instead of comparing handler TEXT, this compares handler BEHAVIOUR: read every handler out of the
// golden, render the React tree, invoke each of its handlers with a stub event, and check that the same
// kind of handler appears in the same document order carrying the same identifying arguments. A row
// wired to the wrong user id fails here, and so does a change handler that became a click handler.

import type { ReactElement, ReactNode } from 'react';

/** One `on*="..."` attribute found in a golden. */
export interface GoldenHandler {
  /** 'onchange' | 'onclick' | … */
  attr: string;
  /**
   * The quoted string literals in the handler body, in order — `['u9']` for
   * `hrUserRoleSet('u9',this.value)`.
   *
   * `this.value` is dropped: it is the browser handing the handler the control's live value, which in
   * React is `e.target.value` — the same thing said differently, and not something a component can be
   * asked to reproduce as text. What is kept is what identifies the ROW, which is the part that can go
   * wrong silently.
   */
  args: string[];
  /** The attribute value verbatim, for the failure message. */
  raw: string;
}

export function goldenHandlers(golden: string): GoldenHandler[] {
  return [...golden.matchAll(/\son([a-z]+)="([^"]*)"/g)].map((m) => ({
    attr: 'on' + m[1],
    args: [...m[2].matchAll(/'([^']*)'|"([^"]*)"/g)].map((a) => a[1] ?? a[2]),
    raw: m[2],
  }));
}

/**
 * The value the stub event carries. Recorded arguments equal to it are the React equivalent of the
 * legacy `this.value`, and are dropped before comparing — see GoldenHandler.args.
 */
export const STUB_VALUE = '<stub-event-value>';

export interface ReactHandler {
  /** Lower-cased to line up with the golden's attribute name: onChange → onchange. */
  attr: string;
  invoke: () => void;
}

/**
 * Every handler prop in a rendered React tree, in document order.
 *
 * Function components are invoked as it walks, which is what turns `<UserRow/>` into the `<select>`
 * inside it. That is a two-line renderer, and it is enough BECAUSE every component in a migrated screen
 * is a pure function of its props by construction — the data loading and the state live in the page
 * component on the other side of that line (see src/hr-access.tsx's header). If a screen ever needs a
 * hook inside the presentational tree, this walk is where that shows up, and the answer is to move the
 * hook out rather than to teach this file about hooks.
 */
export function reactHandlers(node: ReactNode): ReactHandler[] {
  const out: ReactHandler[] = [];
  const walk = (n: ReactNode): void => {
    if (n === null || n === undefined || typeof n === 'boolean' || typeof n === 'string' || typeof n === 'number') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const el = n as ReactElement<Record<string, unknown>>;
    if (!el || typeof el !== 'object' || !('props' in el)) return;
    const props = (el.props || {}) as Record<string, unknown>;

    // Only HOST elements (`type` is a string: 'select', 'button', …). A function component's `onRoleChange`
    // prop is plumbing between components — it is not a handler the browser will ever fire, and counting it
    // would compare this component's internal wiring against the golden's DOM attributes.
    if (typeof el.type === 'string') {
      for (const k of Object.keys(props)) {
        if (/^on[A-Z]/.test(k) && typeof props[k] === 'function') {
          const fn = props[k] as (e: unknown) => void;
          out.push({ attr: k.toLowerCase(), invoke: () => fn({ target: { value: STUB_VALUE } }) });
        }
      }
    }

    if (typeof el.type === 'function') {
      const C = el.type as (p: Record<string, unknown>) => ReactNode;
      walk(C(props));
      return;
    }
    walk(props.children as ReactNode);
  };
  walk(node);
  return out;
}
