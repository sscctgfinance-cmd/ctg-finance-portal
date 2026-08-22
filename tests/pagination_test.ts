// An aggregation that reads a large table must page, or it silently returns a SHORT total.
//
// WHY: PostgREST caps a select at 1000 rows. That ceiling has already bitten this codebase once — the
// AR drift check froze at cache_count 1000 for big tenants and raised permanent false "drift" alarms —
// and the comment recording it is still in finance.ts. What makes it dangerous is the failure shape: a
// truncated aggregation does not error, it returns a number that looks like a total.
//
// Two more were sitting behind ceilings nobody had reached yet:
//
//   wht_list       the fee total of up to 500 computations, each with its own lines. Past ~1000 lines
//                  the totals in the list come back short.
//   the YTD map    every payslip of every earlier run in the year, which is what the MTD calculation
//                  subtracts. The ceiling arrives at about 91 employees, and truncating it makes the
//                  month's PCB too LOW for everyone — on a figure that is remitted to LHDN.
//
// This pins that every aggregation over a growing table pages, by reading the shipped source: there is
// no way to drive a 1000-row response offline, and a test that could would not be the guard that matters.

import { assertEquals } from "jsr:@std/assert@1";

const FIN = await Deno.readTextFile(new URL("../supabase/functions/portal/finance.ts", import.meta.url));
const HR = await Deno.readTextFile(new URL("../supabase/functions/portal/hr.ts", import.meta.url));

/** The window of source around a marker, so an assertion names WHERE it is looking. */
const around = (src: string, marker: string, before = 200, after = 1200) => {
  const at = src.indexOf(marker);
  assertEquals(at > -1, true, `marker not found: ${marker}`);
  return src.slice(Math.max(0, at - before), at + after);
};

Deno.test("wht_list totals every line, not the first thousand", () => {
  const block = around(FIN, 'from("portal_wht_lines").select("summary_id,amount")');
  assertEquals(/\.range\(off, off\+999\)/.test(block), true, "the WHT line sum is unpaginated again");
  assertEquals(/if \(!lines \|\| lines\.length < 1000\) break;/.test(block), true,
    "the page loop has no terminating condition on a short page");
  // A page loop with no upper bound is its own defect — an unexpected response shape would spin.
  assertEquals(/off<\d+;/.test(block), true, "the page loop is unbounded");
});

Deno.test("the year-to-date map behind PCB reads every earlier payslip", () => {
  const block = around(HR, 'select("employee_id,gross,epf_ee,pcb,run_id")');
  assertEquals(/\.range\(off, off\+999\)/.test(block), true, "the YTD accumulator is unpaginated again");
  assertEquals(/if\(!pg \|\| pg\.length < 1000\) break;/.test(block), true, "no short-page break");
  // And it must still accumulate into the same shape the MTD calculation reads.
  assertEquals(block.includes("for(const p of (ps||[]))"), true, "the accumulation loop changed shape");
});

Deno.test("the AR drift check that taught this lesson still pages", () => {
  // The original. If this ever loses its loop the alarm goes back to crying wolf at 1000 rows.
  const block = around(FIN, 'eq("type","ACCREC").in("status",["AUTHORISED","SUBMITTED"])', 700, 700);
  assertEquals(/\.range\(off, off\+999\)/.test(block), true, "the AR cache sum is unpaginated again");
  assertEquals(/rows\.length < 1000/.test(block), true);
});

Deno.test("every paged loop in the backend breaks on a short page", () => {
  // A loop that pages but never stops early is a full table scan on every call; one that pages without
  // a bound can spin. Both files, every occurrence, no exceptions list.
  for (const [name, src] of [["finance.ts", FIN], ["hr.ts", HR]] as const) {
    const loops = [...src.matchAll(/for\s*\(\s*(?:let|const)\s+off\s*=\s*0[^)]*\)/g)];
    assertEquals(loops.length >= 3, true, `${name}: expected paged loops, found ${loops.length}`);
    for (const m of loops) {
      const body = src.slice(m.index!, m.index! + 900);
      assertEquals(/\.range\(/.test(body), true, `${name}: a paged loop with no .range()`);
      assertEquals(/length\s*<\s*1000\)\s*break/.test(body), true,
        `${name}: a paged loop that never breaks on a short page`);
    }
  }
});
