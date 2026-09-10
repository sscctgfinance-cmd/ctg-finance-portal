// Every BUTTON that reaches an outward-facing action must have a double-submit guard.
//
// WHY THIS FILE EXISTS: `tests/double_submit_test.ts` holds two hand-typed lists of function names. Both
// were correct when written and neither can stay correct: a button added tomorrow is not in them, and
// nothing goes red. That is the same shape as the gap CLAUDE.md already names — "a golden never presses
// a button" — one level up. This file types no function names at all. It reads every `onclick=` out of
// both apps, follows the call chain to the `{api:"..."}` the click actually sends, and asks for a guard
// wherever that set touches something outward-facing.
//
// The two rounds that produced it, both by clicking real DOM buttons five times in one tick on the
// signed-in apps:
//
//     hrDecideLeave('lv1','approve') x5  ->  5 x hr_leave_decide   (five "your leave was approved" emails)
//     sbiPostXero(12,false)          x5  ->  5 x sbi_post_xero     (five ACCPAY bills in a live ledger)
//
// The server cannot save either one. `sbi_post_xero`'s dedupe is `if (v.xero_bill_id)` READ BEFORE THE
// WRITE, so five concurrent requests all read null and all create; `hr_leave_decide`'s "Already handled"
// refusal loses the same race. `o2o_issue` (finance.ts) and `hr_rc_post_xero` (hr.ts) are the two that
// do it properly — they ask XERO for an existing non-VOIDED document first. The client guard is the
// first line either way, not a substitute.
//
// WHAT IS AND IS NOT AUTOMATED. The BUTTON→function→api map is derived, so a new control is covered the
// day it is written. The OUTWARD list below is a judgement — "does this leave the building?" — and stays
// explicit on purpose: that is the moment a person decides, and an api added to the server without being
// classified fails `every server action is classified` rather than passing silently.
import { assertEquals } from "jsr:@std/assert@1";

const APPS = {
  "app.html": await Deno.readTextFile(new URL("../app.html", import.meta.url)),
  "hros.html": await Deno.readTextFile(new URL("../hros.html", import.meta.url)),
};
// Shared root scripts are in scope from both apps — a handler can call straight into one.
const SHARED = (await Promise.all(
  ["common.js", "hr-docs.js", "payroll.js", "wht.js", "o2o.js", "salesrecon.js", "gateway.js", "pnl.js", "ap.js", "myt.js"]
    .map((f) => Deno.readTextFile(new URL("../" + f, import.meta.url))),
)).join("\n");

/**
 * Outward-facing: it creates or voids a document in a real ledger, moves money, sends mail, or takes
 * somebody's access away. A repeat of one of these is a thing a human has to undo.
 *
 * NOT here, deliberately: reads (`*_list`, `*_get`, `pnl_analysis`, `bank_reconcile` — which matches and
 * returns, writing nothing), and idempotent settings writes where a repeat is the same end state.
 */
const OUTWARD = new Set([
  // creates or voids in Xero
  "o2o_issue", "sr_post_invoices", "sbi_post_xero", "ap_post", "quick_invoice", "approve",
  "hr_post_xero", "hr_rc_post_xero", "tenant_rebuild", "sbi_approve", "sbi_void",
  // pays or files
  "hr_payroll_finalise", "hr_rc_mark_paid", "hr_rc_mark_paid_bulk",
  // sends mail
  "collections", "hr_send_payslip", "hr_leave_decide", "hr_claim_decide", "hr_rc_decide",
  "hr_rc_decide_bulk", "hr_send_logins", "hr_rc_enable_login", "hr_rc_enable_login_bulk",
  // removes access or records
  "session_revoke", "role_delete", "pharmacy_delete", "hr_emp_delete", "ctg_access_revoke",
  "wht_payee_delete",
  // inserts a document a second copy of is a second document
  "wht_save", "sbi_save", "close_update",
]);

/**
 * Deliberately unguarded, with the reason. An entry here is a decision somebody made; an action that
 * is merely awkward to guard does not belong in it.
 */
const EXEMPT: Record<string, string> = {
  hrSendLoginTest:
    "sends a test email to the operator's OWN inbox and changes no password (hros.html's own comment " +
    "says so). A guard there stops them re-sending while they hunt for the first one in a spam folder.",
};

/** Guards this repo recognises. Any ONE of them anywhere in the chain is enough. */
const GUARD = new RegExp([
  "\\b(?:ctgOnce|hrOnce|runOnce)\\s*\\(",                                   // the shared single-flight guard
  "\\bif\\s*\\(\\s*[A-Za-z_$][\\w$.]*\\.(?:busy|_saving|_posting|saving|posting)\\s*\\)\\s*(?:return|\\{)", // CTGA.busy, SR._posting
  "\\bif\\s*\\(\\s*[A-Z][A-Z0-9_]*(?:SAVING|POSTING|BUSY|_SAVING|_POSTING|_BUSY)\\s*\\)\\s*(?:return|\\{)",   // SBI_SAVING
].join("|"));

/**
 * Where the token starting at `i` ends: a string, template literal, comment or REGEX LITERAL.
 * Returns the index of its last character, or -1 if `i` is ordinary code.
 *
 * The regex case is the one that matters and the one a naive scanner gets wrong. srCsv
 * (salesrecon.js) writes /[",\n\r]/ — read as a string start, that ONE quote desyncs the rest of
 * the file, and this sweep reported the CSV download button as posting invoices to Xero. app.html's
 * /['\\]/g is the same rock, already recorded in CLAUDE.md against finance-users-subviews.test.tsx.
 *
 * Regex-or-division is decided by the previous non-space character, which is the ordinary heuristic:
 * a literal can only start where a value is expected. Inside one, `/` in a [...] class is not the
 * terminator.
 */
/** Is `/` at `i` the start of a literal rather than a division? */
function regexHere(src: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  const c = src[j];
  if ("(,=:[!&|?{};+-*%~^<>".includes(c)) return true;
  // A KEYWORD can precede one too, and `return /[",\n\r]/` is the case that started this: the
  // previous character is the `n` of return, which reads as the end of a value, so the literal was
  // scanned as a division and its `"` desynced the rest of the file.
  if (/[A-Za-z_$]/.test(c)) {
    let k = j;
    while (k >= 0 && /[\w$]/.test(src[k])) k--;
    return ["return", "typeof", "case", "in", "of", "new", "delete", "void", "do", "else", "yield", "await", "instanceof"]
      .includes(src.slice(k + 1, j + 1));
  }
  return false;
}

function tokenEnd(src: string, i: number, _prev: string): number {
  const c = src[i];
  if (c === "'" || c === '"' || c === "`") {
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === "\\") { j++; continue; }
      if (src[j] === c) return j;
    }
    return src.length - 1;
  }
  if (c === "/" && src[i + 1] === "/") {
    const nl = src.indexOf("\n", i);
    return nl < 0 ? src.length - 1 : nl - 1;
  }
  if (c === "/" && src[i + 1] === "*") {
    const e = src.indexOf("*/", i + 2);
    return e < 0 ? src.length - 1 : e + 1;
  }
  if (c === "/" && regexHere(src, i)) {
    let cls = false;
    for (let j = i + 1; j < src.length; j++) {
      const d = src[j];
      if (d === "\\") { j++; continue; }
      if (d === "\n") return i;                 // not a literal after all — leave it as code
      if (d === "[") cls = true;
      else if (d === "]") cls = false;
      else if (d === "/" && !cls) return j;
    }
    return i;
  }
  return -1;
}

/** Top-level function bodies, brace-matched, with strings, regex literals and comments skipped. */
function functionBodies(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\n(?:async )?function ([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = src.indexOf("{", m.index + m[0].length - 2);
    const start = i;
    let depth = 0, prev = "(";
    for (; i < src.length; i++) {
      const c = src[i];
      const end = tokenEnd(src, i, prev);
      if (end >= i) { i = end; prev = "x"; continue; }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { out.set(m[1], src.slice(start, i + 1)); break; }
      }
      if (!/\s/.test(c)) prev = c;
    }
  }
  return out;
}

const BODIES: Record<string, Map<string, string>> = {};
for (const [f, src] of Object.entries(APPS)) {
  const b = functionBodies(src + "\n" + SHARED);
  BODIES[f] = b;
}

/** Every function name an `onclick="..."` expression names. */
function handlerNames(expr: string): string[] {
  return [...expr.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
}

/**
 * Blank the CONTENTS of every string and template literal, keeping the quotes so offsets survive.
 * Both apps build their markup by concatenation, so `'<button onclick="sbiSave()">'` is a call to
 * sbiSave as far as any regex is concerned — and attributing the form's Save action to the button
 * that merely OPENS the form is a false positive that would get this whole file switched off.
 */
function stripStrings(src: string): string {
  let out = "", i = 0, prev = "(";
  while (i < src.length) {
    const c = src[i];
    const end = tokenEnd(src, i, prev);
    if (end >= i) { out += " ".repeat(end - i + 1); i = end + 1; prev = "x"; continue; }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/** The api strings reachable from `fn`, following calls, and the source of everything walked. */
function reach(app: string, fn: string, depth = 4): { apis: Set<string>; chain: string } {
  const bodies = BODIES[app];
  const apis = new Set<string>();
  const seen = new Set<string>();
  let chain = "";
  const walk = (name: string, d: number) => {
    if (d < 0 || seen.has(name)) return;
    seen.add(name);
    const body = bodies.get(name);
    if (!body) return;
    chain += body;
    for (const m of body.matchAll(/api\s*:\s*['"]([a-z0-9_]+)['"]/g)) apis.add(m[1]);
    for (const m of stripStrings(body).matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (bodies.has(m[1])) walk(m[1], d - 1);
    }
  };
  walk(fn, depth);
  return { apis, chain };
}

Deno.test("every button that reaches an outward-facing action has a double-submit guard", () => {
  const unguarded: string[] = [];
  for (const [app, src] of Object.entries(APPS)) {
    const seen = new Set<string>();
    for (const m of src.matchAll(/on(?:click|change)\s*=\s*"([^"]*)"/g)) {
      for (const fn of handlerNames(m[1])) {
        if (seen.has(fn) || !BODIES[app].has(fn)) continue;
        seen.add(fn);
        const { apis, chain } = reach(app, fn);
        const outward = [...apis].filter((a) => OUTWARD.has(a));
        if (outward.length && !GUARD.test(chain) && !EXEMPT[fn]) {
          unguarded.push(`${app}: ${fn}() -> ${outward.sort().join(", ")}`);
        }
      }
    }
  }
  assertEquals(
    unguarded,
    [],
    "these controls send mail, move money or write to a real ledger, and a second click fires a second " +
      "request:\n  " + unguarded.join("\n  "),
  );
});

Deno.test("the OUTWARD list still names actions the server implements", async () => {
  // A renamed or retired handler would silently stop being checked — the same failure as a stale list of
  // function names, in the one list this file keeps by hand.
  const server = [
    await Deno.readTextFile(new URL("../supabase/functions/portal/finance.ts", import.meta.url)),
    await Deno.readTextFile(new URL("../supabase/functions/portal/hr.ts", import.meta.url)),
  ].join("\n");
  const implemented = new Set(
    [...server.matchAll(/api\s*===\s*"([a-z0-9_]+)"/g)].map((m) => m[1]),
  );
  const gone = [...OUTWARD].filter((a) => !implemented.has(a));
  assertEquals(gone, [], `OUTWARD names actions the server no longer has: ${gone.join(", ")}`);
});

Deno.test("the derived sweep reaches the buttons the hand-written list was built from", () => {
  // Guard the guard. If the onclick scan or the call-chain walk quietly stopped resolving anything, the
  // test above would pass with nothing to say. These are the two controls the five-click rounds actually
  // caught, so the sweep must be able to see both — and see what they send.
  const sbi = reach("app.html", "sbiPostXero");
  assertEquals(sbi.apis.has("sbi_post_xero"), true, "the walk no longer reaches sbiPostXero's api");
  const leave = reach("hros.html", "hrDecideLeave");
  assertEquals(leave.apis.has("hr_leave_decide"), true, "the walk no longer reaches hrDecideLeave's api");

  // and it must find a useful NUMBER of buttons, not one
  let handlers = 0;
  for (const [app, src] of Object.entries(APPS)) {
    const seen = new Set<string>();
    for (const m of src.matchAll(/on(?:click|change)\s*=\s*"([^"]*)"/g)) {
      for (const fn of handlerNames(m[1])) {
        if (!seen.has(fn) && BODIES[app].has(fn)) { seen.add(fn); handlers++; }
      }
    }
  }
  assertEquals(handlers > 150, true, `only ${handlers} handlers resolved — the onclick scan has broken`);
});
