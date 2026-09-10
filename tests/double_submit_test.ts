// Every outward-facing HR action goes through hrOnce(), and its key names the ROW.
//
// WHY THIS FILE EXISTS: CLAUDE.md records five double-submit holes fixed in PRs 108/109 — all on the
// REACT side, where `useState` looked identical to `useRef` until somebody tapped five times. The same
// question had never been asked of `hros.html`, which is what staff actually use. Driving a real browser
// answered it: five clicks in one tick on the claim and leave decisions produced FIVE requests each.
//
//     hrDecideClaim('c1','Approved') x5  ->  5 x hr_claim_decide
//     hrDecideLeave('lv1','approve') x5  ->  5 x hr_leave_decide
//
// `hr_leave_decide` EMAILS the employee, so that is five "your leave was approved" messages, five audit
// rows, and five concurrent reads of the same pre-decision status — the server's "Already handled"
// refusal cannot help, because all five read the row before any of them wrote it.
//
// TWO THINGS ARE PINNED, and the second is what keeps the fix usable:
//   1. every action below is wrapped in hrOnce()
//   2. its key ends in a ROW identifier, not just the function name — keying on the function alone
//      refuses a second claim approved a moment after the first, which is the operator's own rhythm.
//      Verified in the browser: same row x5 -> 1 request; two different rows -> 2.
//
// The list is deliberately explicit. A new action that sends mail, moves money or writes to Xero has to
// be added here by hand, which is the moment somebody decides whether it needs a guard.

import { assertEquals } from "jsr:@std/assert@1";

const SRC = await Deno.readTextFile(new URL("../hros.html", import.meta.url));

/** Outward-facing or irreversible: it emails someone, pays someone, or writes to a real ledger. */
const MUST_GUARD = [
  "hrDecideClaim", "hrDecideLeave", "hrEmpLeaveDecide", "hrEmpLeaveCancel",
  "hrRCDecide", "hrRCMarkPaid", "hrRCOverride", "hrRCCancel", "hrRCResubmit",
  "hrSendLogin", "hrEnableLogin", "hrEnableLoginBulk", "hrUserInvite", "hrEmpDelete",
  "hrLeaveApplyOnBehalf", "hrEmailAll", "hrPostXero",
  // the eight that already had it, so a REMOVAL is caught too
  "hrFinalise", "hrGridSave", "hrRatesSave", "hrEmployerSave", "hrStatIdsSave",
  "hrRCBulkPay", "hrRCPostXero", "hrRCAdjustAmount",
];

/** The body of a top-level function, brace-matched, strings and comments skipped. */
function bodyOf(name: string): string {
  const m = new RegExp("\\n(?:async )?function " + name + "\\([^)]*\\)\\s*\\{").exec(SRC);
  if (!m) return "";
  let i = SRC.indexOf("{", m.index + m[0].length - 2), depth = 0;
  const start = i;
  for (; i < SRC.length; i++) {
    const c = SRC[i];
    if (c === "'" || c === '"' || c === "`") {
      const q = c; i++;
      for (; i < SRC.length; i++) {
        if (SRC[i] === "\\") { i++; continue; }
        if (SRC[i] === q) break;
      }
    } else if (c === "/" && SRC[i + 1] === "/") {
      while (i < SRC.length && SRC[i] !== "\n") i++;
    } else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return SRC.slice(start, i + 1); }
  }
  return "";
}

Deno.test("every outward-facing action is wrapped in hrOnce()", () => {
  const missing: string[] = [];
  for (const fn of MUST_GUARD) {
    const body = bodyOf(fn);
    assertEquals(body !== "", true, `${fn} no longer exists — remove it from MUST_GUARD deliberately`);
    // The guard must be the FIRST thing, not buried after an await: a check that runs after the request
    // has already gone out guards nothing.
    if (!/^\{\s*(?:if\([^)]*\)\s*(?:return|\{[^}]*\})\s*;?\s*)?return hrOnce\(/.test(body.replace(/\n/g, " "))) {
      missing.push(fn);
    }
  }
  assertEquals(missing, [], `these send mail / move money / write to Xero with no double-submit guard: ${missing.join(", ")}`);
});

Deno.test("the guard key names the ROW, so a second row is not refused", () => {
  // Per-ROW actions. Keying on the function name alone blocks approving claim B a second after claim A —
  // which is exactly how an operator clears a queue, so the guard would be removed again within a week.
  const PER_ROW: [string, string][] = [
    ["hrDecideClaim", "id"], ["hrDecideLeave", "id"], ["hrEmpLeaveDecide", "id"], ["hrEmpLeaveCancel", "id"],
    ["hrSendLogin", "id"], ["hrEnableLogin", "id"], ["hrEmpDelete", "id"], ["hrPostXero", "runId"],
  ];
  for (const [fn, arg] of PER_ROW) {
    const body = bodyOf(fn);
    const key = /return hrOnce\((['"][^'"]*['"])\s*\+\s*\(([^)]*)\)/.exec(body);
    assertEquals(!!key, true, `${fn}'s hrOnce key is not of the form 'name:'+(row) — a constant key blocks the next row`);
    assertEquals(key![2].trim(), arg, `${fn} keys on "${key![2].trim()}", not the row identifier "${arg}"`);
  }
});

// ── The guard itself ──────────────────────────────────────────────────────────────────────────────
// v232: the implementation moved to common.js as ctgOnce() so app.html could use the same one, and
// hrOnce became a one-line delegate. This test used to pin hrOnce's SOURCE for the word `finally`, and
// that move turned it red while the behaviour was unchanged — the source-pin blind spot this repo keeps
// finding. It now DRIVES the function, which is both stronger and indifferent to which file it lives in.
const COMMON = await Deno.readTextFile(new URL("../common.js", import.meta.url));

function loadCtgOnce(): (k: string, fn: () => unknown) => Promise<unknown> {
  const m = /var CTG_INFLIGHT[\s\S]*?\nasync function ctgOnce\([\s\S]*?\n\}/.exec(COMMON);
  if (!m) throw new Error("common.js no longer defines ctgOnce — the shared single-flight guard is gone");
  // toast() is the only thing it reaches for; a stub keeps this hermetic.
  // deno-lint-ignore no-explicit-any
  return new Function("toast", m[0] + "; return ctgOnce;")(() => {}) as any;
}

Deno.test("ctgOnce refuses a second call while the first is in flight", async () => {
  const ctgOnce = loadCtgOnce();
  let ran = 0;
  let release!: () => void;
  const blocked = new Promise<void>((r) => { release = r; });
  const go = () => ctgOnce("k", async () => { ran++; await blocked; });

  const first = go();
  await go();                        // second click, same key, first still in flight
  await go();                        // third
  release();
  await first;
  assertEquals(ran, 1, "a burst on one key ran the action more than once — the guard does not hold");
});

Deno.test("ctgOnce releases after a THROW — a guard that sticks is a dead button", async () => {
  // The whole scheme rests on this. Without the `finally`, one failed fetch leaves the key set and that
  // control is dead for the rest of the session, with the toast saying "Still working on that" for ever.
  const ctgOnce = loadCtgOnce();
  let ran = 0;
  await ctgOnce("k", () => { ran++; throw new Error("network"); }).catch(() => {});
  await ctgOnce("k", () => { ran++; });
  assertEquals(ran, 2, "the key was not released after a failure — the button is now permanently dead");
});

Deno.test("ctgOnce keys are independent — a second ROW is not refused", async () => {
  const ctgOnce = loadCtgOnce();
  let ran = 0;
  let release!: () => void;
  const blocked = new Promise<void>((r) => { release = r; });
  const a = ctgOnce("row:1", async () => { ran++; await blocked; });
  const b = ctgOnce("row:2", async () => { ran++; await blocked; });
  release();
  await Promise.all([a, b]);
  assertEquals(ran, 2, "two different rows blocked each other — that is the operator's own rhythm refused");
});

Deno.test("hrOnce still delegates to the shared guard", () => {
  const body = bodyOf("hrOnce");
  assertEquals(body !== "", true, "hrOnce is gone — 17 call sites in hros.html name it");
  assertEquals(/ctgOnce\(/.test(body), true,
    "hrOnce no longer reaches ctgOnce — HR and Finance are back on two implementations of one rule");
});

// ── The Finance half ──────────────────────────────────────────────────────────────────────────────
// The same question asked of app.html, by clicking real DOM buttons five times in one tick on the
// signed-in app. runOnce() disables the trigger NODE, which covers a mouse click on a button it can
// find and nothing else — so the burst went through wherever the node was gone or was never the
// trigger:
//
//     sbiPostXero  ->  sbi_post_xero x5      closeSet  ->  close_update x5
//
// sbi_post_xero creates an ACCPAY SUBMITTED bill in a live Xero ledger, and its only dedupe is
// `if (v.xero_bill_id)` READ BEFORE THE WRITE (finance.ts) — five concurrent requests all read null and
// all create. o2o_issue and hr_rc_post_xero both query Xero for an existing non-VOIDED document first;
// this one does not. A duplicate SUBMITTED bill is the kind that gets approved and paid twice.
//
// Two false positives are worth recording, because both came from reading too little of a function:
// o2oIssue's runOnce sits 22 lines into its body, and ctgaGrant/ctgaRevoke use `if(CTGA.busy) return`.
// A guard ANYWHERE in the body is a guard.
const APP = await Deno.readTextFile(new URL("../app.html", import.meta.url));

Deno.test("every Finance action that creates, sends or revokes has an in-flight guard", () => {
  // Explicit, like MUST_GUARD above: a new action that writes to a ledger has to be added by hand,
  // which is the moment somebody decides whether it needs a guard.
  const MUST = [
    "sbiPostXero", "whtSave", "arRunCollections", "closeSet", "closeAssign",
    "pharmDelete", "roleDelete", "sessionRevoke",
  ];
  const missing: string[] = [];
  for (const fn of MUST) {
    const m = new RegExp("\\nasync function " + fn + "\\([^)]*\\)\\s*\\{([^\\n]*)").exec(APP);
    if (!m || !/ctgOnce\(/.test(m[1])) missing.push(fn);
  }
  assertEquals(missing, [], `these write to a ledger, send mail or revoke access with no in-flight guard: ${missing.join(", ")}`);
});

Deno.test("runOnce holds the shared flag too, not just the button", () => {
  // The measured gap: five clicks on a button runOnce had disabled still produced five requests, because
  // the row had re-rendered and the node runOnce disabled no longer existed. The flag does not care.
  const m = /async function runOnce\(idOrSelector[\s\S]*?\n\}/.exec(APP);
  assertEquals(!!m, true, "runOnce is gone — 16 call sites in app.html name it");
  assertEquals(/ctgOnce\(/.test(m![0]), true,
    "runOnce is back to disabling only the button node, which a keyboard activation and a re-rendered row both walk past");
});

Deno.test("the per-record Finance guards key on the RECORD, not the function", () => {
  // Same rule as the HR half above: a constant key refuses the next row, which is how an operator
  // clears a queue, so the guard would be removed again within a week.
  const PER_ROW: [string, string][] = [
    ["sbiPostXero", "id"], ["closeSet", "id"], ["closeAssign", "id"],
    ["roleDelete", "i"], ["sessionRevoke", "sid"],
  ];
  for (const [fn, arg] of PER_ROW) {
    const m = new RegExp("\\nasync function " + fn + "\\([^)]*\\)\\s*\\{[^\\n]*?ctgOnce\\('[^']*:'\\+([A-Za-z_$][\\w$]*)").exec(APP);
    assertEquals(!!m, true, `${fn}'s ctgOnce key is not 'name:'+<record> — a constant key blocks the next row`);
    assertEquals(m![1], arg, `${fn} keys on "${m![1]}", not the record identifier "${arg}"`);
  }
});

Deno.test("hrSendLoginTest is deliberately NOT guarded, and says why", () => {
  // The one exception, so the absence is a decision rather than an oversight. It sends a test email to
  // the operator's own inbox and changes no password — its own comment says so — and a guard there would
  // stop them re-sending while they hunt for it in a spam folder.
  const body = bodyOf("hrSendLoginTest");
  assertEquals(body.includes("hrOnce("), false, "hrSendLoginTest was guarded — if that was deliberate, update this test");
  assertEquals(/no passwords/i.test(SRC.slice(SRC.indexOf("function hrSendLoginTest") - 400, SRC.indexOf("function hrSendLoginTest"))), true,
    "the comment explaining why hrSendLoginTest needs no guard is gone");
});
