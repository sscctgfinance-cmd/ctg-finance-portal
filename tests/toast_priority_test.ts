// The outcome of an action must not queue behind advice about it.
//
// WHY THIS FILE EXISTS: `toast()` is the ONLY way either app reports whether anything worked, and the
// queue is strictly FIFO at 2400ms + 240ms per message. Driving the salary export measured what that
// costs in practice:
//
//     0.0s   "Tip: set the UOB debit account (Payment Hub → Save) so the file carries it."
//     2.6s   "Tip: pick a Crediting date — UOB needs the date salaries reach staff."
//     5.3s   "UOB Infinity salary file blocked — 1 staff have a net pay of zero or less …"
//
// Five seconds after the click, behind two hints, comes the line that says the file was NOT produced.
// v231 made that worse before it made it better: the blocked-file message is itself a v231 addition.
//
// The rule: an ERROR goes ahead of every advisory message; errors keep their own order among themselves
// (a first failure usually explains the second); advice queues behind everything. What is NOT done is
// equally deliberate — the message already on screen is never displaced, because a toast that changes
// under the operator's eyes is a different kind of unreliable.
//
// `_toastInsertAt` is lifted out of common.js and driven, so the rule is pinned rather than described,
// and `web/tests/shell-chrome.test.tsx` pins the React half against the same cases.

import { assertEquals } from "jsr:@std/assert@1";

const SRC = await Deno.readTextFile(new URL("../common.js", import.meta.url));
const fn = /function _toastInsertAt\([\s\S]*?\n\}/.exec(SRC);
if (!fn) throw new Error("common.js no longer defines _toastInsertAt");
// deno-lint-ignore no-explicit-any
const insertAt = new Function(fn[0] + "; return _toastInsertAt;")() as (q: any[], i: any) => number;

type T = { msg: string; isErr: boolean };
const err = (m: string): T => ({ msg: m, isErr: true });
const tip = (m: string): T => ({ msg: m, isErr: false });

/** What the queue becomes — the operation common.js performs with the returned index. */
function push(q: T[], item: T): T[] {
  const out = q.slice();
  out.splice(insertAt(out, item), 0, item);
  return out;
}
const names = (q: T[]) => q.map((x) => x.msg);

Deno.test("an error goes ahead of advice that has not been shown yet", () => {
  // The measured case, in order: two tips are queued, then the failure arrives.
  let q: T[] = [];
  q = push(q, tip("tip A"));
  q = push(q, tip("tip B"));
  q = push(q, err("blocked"));
  assertEquals(names(q), ["blocked", "tip A", "tip B"],
    "the failure still queues behind the advice — that is the 5.3-second wait this exists to remove");
});

Deno.test("errors keep their own order — a first failure explains the second", () => {
  let q: T[] = [];
  q = push(q, err("first"));
  q = push(q, tip("advice"));
  q = push(q, err("second"));
  assertEquals(names(q), ["first", "second", "advice"]);
  q = push(q, err("third"));
  assertEquals(names(q), ["first", "second", "third", "advice"],
    "errors were reordered — the newest failure must not overtake the one that caused it");
});

Deno.test("advice is still first-in, first-out", () => {
  let q: T[] = [];
  for (const m of ["one", "two", "three"]) q = push(q, tip(m));
  assertEquals(names(q), ["one", "two", "three"]);
});

Deno.test("a lone message of either kind goes straight to the front", () => {
  assertEquals(names(push([], err("boom"))), ["boom"]);
  assertEquals(names(push([], tip("fyi"))), ["fyi"]);
});

Deno.test("the message ON SCREEN is not in this queue, so it cannot be displaced", () => {
  // common.js shifts the playing message OFF the queue before displaying it (`_playNextToast`), which is
  // what makes a plain splice safe here. If that ever changes, an error would jump in front of the toast
  // the operator is mid-way through reading. The React host has no such luck — its queue[0] IS the one
  // showing — which is why it holds index 0 back and inserts into the rest; see web/src/toast.tsx.
  const play = /function _playNextToast\(\)\{[\s\S]*?\n\}/.exec(SRC);
  assertEquals(!!play, true, "could not read _playNextToast");
  assertEquals(/_toastQueue\.shift\(\)/.test(play![0]), true,
    "the playing message is no longer shifted off the queue — a priority insert can now displace it");
});
