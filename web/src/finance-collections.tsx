// Finance OS · Collections — the smallest screen in the app, and the second one out of app.html.
//
// The legacy original is `renderCollections()` (app.html:2425) with `trigColl()` (app.html:2434) below
// it, and it is STILL THERE and still shipping; nothing was deleted. Both are reachable side by side
// (`app.html#tab=collections` and `/finance/collections/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. The POST and the
// button's busy state live in app/finance/collections/page.tsx, on the other side of that line. See
// src/finance-wht.tsx's header for what a Finance screen differs on: no chrome in the golden, one
// section, and a permission gate that sits upstream of the renderer in `showApp()`.
//
// ── THE GOLDEN IS THE PRE-ACTION STATE, AND THAT IS MOST OF THIS SCREEN'S OUTPUT ───────────────────
// `renderCollections()` writes a panel, a paragraph and one button, then an EMPTY `#collres`. Every
// figure this screen ever shows is written into that div by `trigColl()` after the action runs, so
// `tests/golden/finance.collections.html` holds none of it. The `Result` branch below is mirrored from
// app.html:2441-2447 and is pinned in tests/finance-collections.parity.test.tsx by its own assertions,
// not by the diff — a screen whose entire useful output is dynamic is exactly where a golden-only check
// gives false confidence.
//
// The BUSY state is the same kind of gap in the other direction: `trigColl()` mutates the button's
// `disabled` and `textContent` imperatively, so no golden holds it either.
//
// ── THE COPY IS LOAD-BEARING ───────────────────────────────────────────────────────────────────────
// "Preview mode only — it will NOT contact customers directly" is a promise about who receives mail.
// The action sends a real email, to the finance inbox (ssc.ctgfinance) and not to customers. It is
// reproduced character for character, and `previewBody()` below is the only request this screen can
// make, pinned against app.html's own text so the button cannot quietly become a customer-facing send.

/**
 * `PERMS` — resolved by `showApp()` from `my_perms`, with `fallbackPerms()` (app.html:1398) standing in
 * when that call fails. Collections is a FEATURE tab, so only `features` decides it.
 */
export interface Perms {
  features?: string[] | null;
}

/**
 * app.html:1434 — the chain's final `else`: `el.classList.toggle('hide', feats.indexOf(t)<0)`.
 * Collections carries no `canManage` branch of its own, so the rule is exactly "is it in this login's
 * feature list". `financeTabHidden('collections', …)` in src/nav.ts is the same line for the nav; this
 * one is the SCREEN's, exported from the screen so the screen's own test can pin both directions.
 * A route-local predicate is a gate no test can reach.
 */
export function collectionsReachable(perms: Perms | null | undefined): boolean {
  return !!(perms && (perms.features || []).indexOf('collections') >= 0);
}

/**
 * The body `trigColl()` POSTs — app.html:2436, `call({api:'collections'})`.
 *
 * Split out of the route for the same reason `payeeBody()` was on the WHT screen and `bankFile()` on
 * the HR side: no golden sees a request. Here it is the whole point of the screen. The action reaches
 * `portal_trigger_collections` (finance.ts:610), which composes and SENDS the chase list; the copy
 * above promises it goes to the finance inbox rather than to customers. A second key on this body, or a
 * different `api`, is a different send — so the test compares it against `trigColl()`'s own text in
 * app.html rather than against a retyped expectation.
 */
export function previewBody(): Record<string, unknown> {
  return { api: 'collections' };
}

/** What `trigColl()` reads off `r.result` — app.html:2441. Every field is optional there, and here. */
export interface CollPreview {
  reachable_due_count?: number | null;
  reachable_due_amount?: number | null;
  /** The inbox the preview was sent to. Falls back to the words "finance inbox". */
  to?: string | null;
  unreachable_count?: number | null;
}

/** `M()` — app.html:1253. One line, mirrored rather than imported: it is a currency FORMAT, not maths. */
const M = (n: unknown) =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface FinanceCollectionsProps {
  /** `btn.disabled` + the "Generating…" label — app.html:2435. NOT in any golden. */
  busy: boolean;
  /** What went into `#collres`. Null is the golden's state: the div is there and empty. */
  result: CollPreview | null;
  /** The failure branch — app.html:2446. `null` when there is none. */
  error: string | null;
  /** `trigColl(this)` — app.html:2430. */
  onGenerate: () => void;
}

/** app.html:2441-2447 — the two things `#collres` can hold. Neither is in a golden. */
function Result({ result, error }: { result: CollPreview | null; error: string | null }) {
  if (error !== null) {
    return (
      <div className="empty" style={{ padding: '18px' }}>
        <span style={{ color: 'var(--red-soft)' }}>⚠ Failed: {error}</span>
      </div>
    );
  }
  if (!result) return null;
  // Built as ONE string each, exactly as the legacy concatenation reads it: adjacent JSX text
  // expressions are separate text nodes where the legacy side is one.
  const n = (result.reachable_due_count || 0) + ' due · ' + M(result.reachable_due_amount);
  const l = 'Preview sent to ' + (result.to || 'finance inbox') + '; ' +
    (result.unreachable_count || 0) + " more couldn't be auto-chased (no customer email).";
  return (
    <div className="card green" style={{ maxWidth: '560px' }}>
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}

/** `renderCollections()` — app.html:2425. This component is every byte of the `#collections` tab div. */
export default function FinanceCollections(props: FinanceCollectionsProps) {
  return (
    <div className="panel">
      <div className="panel-hd"><h3>Collections Preview</h3></div>
      <p className="muted" style={{ fontSize: '13px', margin: '0 0 18px', lineHeight: '1.65' }}>Click below to instantly generate today's "who to chase" list and send it to the finance inbox (ssc.ctgfinance). Preview mode only — it will NOT contact customers directly.</p>
      <button className="btn p" disabled={props.busy} onClick={props.onGenerate}>{props.busy ? 'Generating…' : '📨 Generate Preview'}</button>
      <div id="collres" style={{ marginTop: '18px' }}><Result result={props.result} error={props.error} /></div>
    </div>
  );
}
