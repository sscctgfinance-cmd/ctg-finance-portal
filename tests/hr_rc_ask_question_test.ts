// "💬 Ask a question" on a reimbursement claim (2026-10-21).
//
// WHY THIS FILE EXISTS: the operator asked for a way to put a question to the claimant WITHOUT sending
// the claim back. "↩ Request info" already existed, but it moves the claim to Need More Info and makes the
// employee resubmit; a question must leave the claim exactly where it is. Every rule below fails silently
// if broken — the screen still shows a thread, the email still goes — so they are pinned by source:
//   - hr_rc_comment decides QUESTION vs REPLY from who is writing (the claimant replies), never from the
//     request, and writes no status.
//   - the Rejected tab's "reason" (rcWithRejectReason) must not pick up a question or a reply, or a claim
//     rejected after a conversation shows the last chat line as the reason it was refused.
//   - every hr_rc_list branch carries open_question, or the pill is missing on one of the tabs.
//   - both apps reach hr_rc_comment through a per-claim double-submit guard (it sends mail).

import { assert, assertEquals } from "jsr:@std/assert@1";

const HR = await Deno.readTextFile(new URL("../supabase/functions/portal/hr.ts", import.meta.url));
const HROS = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function handler(src: string, api: string): string {
  const i = src.indexOf(`if (api === "${api}")`);
  assert(i >= 0, api + " not found");
  const j = src.indexOf("\n    if (api === ", i + 10);
  return code(src.slice(i, j < 0 ? undefined : j));
}
function fn(src: string, name: string): string {
  const i = src.indexOf(name);
  assert(i >= 0, name + " not found");
  const rest = src.slice(i + name.length);
  const m = rest.search(/\n(export )?(async )?function /);
  return code(src.slice(i, m < 0 ? undefined : i + name.length + m));
}

Deno.test("hr_rc_comment: the claimant's words are a reply, anyone else's a question — decided server-side", () => {
  const h = handler(HR, "hr_rc_comment");
  assert(h.includes('const kind = isOwner ? "reply" : "question";'), "kind must come from isOwner");
  assert(!/b\.kind/.test(h), "the request must not choose the kind");
  assert(h.includes("cc.employee_id===who.employee.id"), "owner = the claim's own employee");
});

Deno.test("hr_rc_comment: a question never moves the claim", () => {
  const h = handler(HR, "hr_rc_comment");
  assert(!/hr_claim_requests"\)\.update/.test(h), "no write to the claim");
  assert(!/hr_claim_approval_(steps|instances)"\)\.update/.test(h), "no write to the approval chain");
  assert(!/status\s*:/.test(h.replace(/select\("[^"]*"\)/g, "")), "no status in any write");
});

Deno.test("hr_rc_comment: the insert is checked, and the other side is emailed", () => {
  const h = handler(HR, "hr_rc_comment");
  assert(/const \{ error: eIns \} = await sb\.from\("hr_claim_comments"\)\.insert/.test(h));
  assert(h.includes("if(eIns) return j({ ok:false"), "a failed save must not report success");
  assert(h.includes("rcEmpEmail(cc.employee_id)"), "a question emails the claimant");
  assert(h.includes('.eq("kind","question")'), "a reply emails whoever asked");
  // Still behind the same gates as before: tenant pin, then admin / claimant / step approver.
  assert(h.includes("allowedTenants(b.token)"));
  assert(h.includes("if(!isOwner&&!isAppr) return j({ ok:false, error:\"forbidden\" }, 403)"));
});

Deno.test("the Rejected tab's reason skips questions and replies", () => {
  const f = fn(HR, "export async function rcWithRejectReason");
  assert(f.includes('c.kind!=="question"') && f.includes('c.kind!=="reply"'));
});

Deno.test("every hr_rc_list branch carries open_question", () => {
  const h = handler(HR, "hr_rc_list");
  assertEquals((h.match(/rcWithQuestionState\(/g) || []).length, 3, "admin, approver queue, own claims");
  const f = fn(HR, "export async function rcWithQuestionState");
  assert(f.includes('.in("kind", ["question","reply"])'));
  assert(f.includes('l.kind==="question"'), "open only while the LATEST of the two is a question");
});

Deno.test("hr_rc_get offers the box to exactly who hr_rc_comment accepts", () => {
  const h = handler(HR, "hr_rc_get");
  assert(h.includes('cl.status!=="Draft" && (who.isAdmin || isOwner || isStepAppr)'));
  assert(h.includes("is_owner:isOwner, can_comment:canComment"));
});

Deno.test("hros.html: both ask buttons go through a per-claim double-submit guard", () => {
  const row = fn(HROS, "async function hrRCRowAsk(");
  const det = fn(HROS, "async function hrRCAsk(");
  assert(row.includes("hrOnce('hrRCAsk:'+id") && row.includes("api:'hr_rc_comment'"));
  assert(det.includes("hrOnce('hrRCAsk:'+c.id") && det.includes("api:'hr_rc_comment'"));
  // The list button sits on the pending queue beside ✕ Reject, and the thread box follows the server flag.
  assert(HROS.includes(`onclick="hrRCRowAsk(\\''+c.id+'\\')">💬 Ask</button>`));
  assert(fn(HROS, "function hrRCThread(").includes("if(d.can_comment){"));
});
