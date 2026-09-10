// Invoice NUMBERS — the one thing on the import screens that Xero will not let you take back.
//
// WHY THIS FILE EXISTS: `srApplySoSuffix` and `srApplyYrdz` (salesrecon.js) and `o2oInvoiceNumbers`
// (o2o.js) decide what a real Sales Invoice is called in a real ledger, and CLAUDE.md names the first
// of them as "the one to read before touching anything here — three branches, and collapsing any of
// them re-offers a number that already exists. Xero rejects the whole batch, or worse, the operator
// retries into a partial import." Nothing tested any of the three.
//
// What is asserted is the PROPERTY, not the branches: across every state the server can report a
// company's Xero to be in, does a batch ever propose a number that is already taken, or give two lines
// the same number? A per-branch test passes with the branches swapped; this does not.
//
// It found one defect, in the padding. `('000'+n).slice(-4)` is FIXED width, so the 10,000th YRDZ number
// in a period came out `_0000` and the 10,001st `_0001` — a duplicate, silently. o2o.js next door
// already grows the width instead (`while (s.length < pad) s = '0' + s`, 9998 → 9999 → 10000), so the
// right idiom was in the repo the whole time and the two files simply disagreed. v231 made them agree.

import { assertEquals } from "jsr:@std/assert@1";

// deno-lint-ignore no-explicit-any
async function load(file: string, names: string): Promise<any> {
  const src = await Deno.readTextFile(new URL("../" + file, import.meta.url));
  return await import("data:application/javascript," + encodeURIComponent(
    src.replace(/if \(typeof module[\s\S]*$/, `export { ${names} };`),
  ));
}
const { srApplySoSuffix, srApplyYrdz } = await load("salesrecon.js", "srApplySoSuffix, srApplyYrdz");
const { o2oInvoiceNumbers } = await load("o2o.js", "o2oInvoiceNumbers");

// deno-lint-ignore no-explicit-any
const soLines = (n: number, so = "SO-IP40466") => Array.from({ length: n }, () => ({ matched: true, inv: so, so, amt: 10 } as any));

Deno.test("a batch never proposes an invoice number Xero already has — every sr_so_suffix state", () => {
  // `sr_so_suffix` reports per base SO: `taken` (the bare number is already an invoice) and `max` (the
  // highest _N that exists). Sweep both, against one, two and three payments landing in one import.
  for (const taken of [false, true]) {
    for (const max of [0, 1, 2, 7]) {
      for (const payments of [1, 2, 3]) {
        const lines = soLines(payments);
        srApplySoSuffix(lines, { "SO-IP40466": { taken, max } });
        // deno-lint-ignore no-explicit-any
        const nums = lines.map((l: any) => l.inv);
        const where = `taken=${taken} max=${max} payments=${payments}`;

        assertEquals(new Set(nums).size, nums.length, `${where}: two lines in ONE batch got the same number — ${nums}`);

        const existing = new Set<string>(taken ? ["SO-IP40466"] : []);
        for (let i = 1; i <= max; i++) existing.add("SO-IP40466_" + i);
        assertEquals(nums.filter((n: string) => existing.has(n)), [],
          `${where}: re-offered a number already in Xero — ${nums}`);
      }
    }
  }
});

Deno.test("the three sr_so_suffix branches each produce the number they are for", () => {
  // The exact sequences, so a branch that is merely SHUFFLED (rather than colliding) still fails.
  // deno-lint-ignore no-explicit-any
  const run = (info: any, n = 3) => { const l = soLines(n); srApplySoSuffix(l, info ? { "SO-IP40466": info } : {}); return l.map((x: any) => x.inv); };
  // Fresh SO: the bare number first — suffixing a brand-new SO is its own defect.
  assertEquals(run(null), ["SO-IP40466", "SO-IP40466_1", "SO-IP40466_2"]);
  // Base already an invoice in Xero: never re-offer it; continue past the highest _N.
  assertEquals(run({ taken: true, max: 0 }), ["SO-IP40466_1", "SO-IP40466_2", "SO-IP40466_3"]);
  assertEquals(run({ taken: true, max: 2 }), ["SO-IP40466_3", "SO-IP40466_4", "SO-IP40466_5"]);
  // Base FREE but suffixes exist (the base was voided, or numbering started at _1): take the base
  // first, then continue past the highest _N — NOT _1, which is taken.
  assertEquals(run({ taken: false, max: 2 }), ["SO-IP40466", "SO-IP40466_3", "SO-IP40466_4"]);
});

Deno.test("two different SOs do not share one sequence", () => {
  const l = [
    { matched: true, inv: "SO-A", so: "SO-A", amt: 1 },
    { matched: true, inv: "SO-B", so: "SO-B", amt: 1 },
    { matched: true, inv: "SO-A", so: "SO-A", amt: 1 },
    // An UNMATCHED line is YRDZ's business and must not consume an SO suffix.
    { matched: false, per: "09'2026", amt: 1 },
  ];
  srApplySoSuffix(l, {});
  // deno-lint-ignore no-explicit-any
  assertEquals(l.slice(0, 3).map((x: any) => x.inv), ["SO-A", "SO-B", "SO-A_1"]);
  // deno-lint-ignore no-explicit-any
  assertEquals((l[3] as any).inv, undefined, "an unmatched line was given an SO number");
});

Deno.test("YRDZ continues from Xero and never wraps — the v231 padding defect", () => {
  // deno-lint-ignore no-explicit-any
  const run = (n: number, from: number) => {
    const lines = Array.from({ length: n }, () => ({ matched: false, per: "09'2026", amt: 1 } as any));
    const notes = srApplyYrdz(lines, from ? { "YRDZ_09'2026_": from } : {});
    return { nums: lines.map((l: any) => l.inv), notes };
  };
  // An empty base restarts at 0001; a base continues past it, and says so.
  assertEquals(run(2, 0).nums, ["YRDZ_09'2026_0001", "YRDZ_09'2026_0002"]);
  assertEquals(run(2, 0).notes, []);
  const cont = run(2, 41);
  assertEquals(cont.nums, ["YRDZ_09'2026_0042", "YRDZ_09'2026_0043"]);
  assertEquals(cont.notes, ["09'2026 continues from 0042"]);

  // THE DEFECT: fixed-width padding wrapped 10,000 to `_0000` and 10,001 to `_0001`, which is a
  // duplicate of that period's first invoice. The number must GROW past four digits instead.
  const roll = run(3, 9998);
  assertEquals(roll.nums, ["YRDZ_09'2026_9999", "YRDZ_09'2026_10000", "YRDZ_09'2026_10001"]);
  assertEquals(new Set(roll.nums).size, 3, "the YRDZ counter wrapped and produced a duplicate");
  // …and the "continues from" note must agree with the first number actually issued, or the operator
  // reconciles against a number that is not in the batch.
  assertEquals(run(1, 9999).notes, ["09'2026 continues from 10000"]);
  assertEquals(run(1, 9999).nums[0], "YRDZ_09'2026_10000");

  // Two periods in one import keep separate counters.
  const mixed = [
    { matched: false, per: "08'2026", amt: 1 }, { matched: false, per: "09'2026", amt: 1 },
    { matched: false, per: "08'2026", amt: 1 },
    // deno-lint-ignore no-explicit-any
  ] as any[];
  srApplyYrdz(mixed, {});
  assertEquals(mixed.map((l) => l.inv), ["YRDZ_08'2026_0001", "YRDZ_09'2026_0001", "YRDZ_08'2026_0002"]);
});

Deno.test("o2oInvoiceNumbers keeps its three states distinct", () => {
  // [] = let Xero number them · null = the operator typed something invalid, DO NOT POST · array = the
  // numbers. Collapsing null into [] posts an unnumbered batch the operator meant to control.
  assertEquals(o2oInvoiceNumbers(3, "", ""), [], "blank must mean 'let Xero number them'");
  for (const bad of ["abc", "-5", "1e3", "1.5", "12a", "1 2"]) {
    assertEquals(o2oInvoiceNumbers(3, "", bad), null, `"${bad}" must refuse to post, not fall back to []`);
  }
  // Whitespace is TRIMMED first, so a field holding only spaces is the same as an empty one — "the
  // operator left it blank", not "the operator typed something invalid". Pinned because the two answers
  // are one keystroke apart and mean opposite things to the poster.
  assertEquals(o2oInvoiceNumbers(3, " ", "  "), [], "a whitespace-only field is blank, not invalid");
  assertEquals(o2oInvoiceNumbers(3, "INV-", ""), null, "a prefix with no start is incomplete, not auto");
  // The literal width of what was typed is the padding — "001" is a format the operator chose.
  assertEquals(o2oInvoiceNumbers(3, "", "001"), ["001", "002", "003"]);
  assertEquals(o2oInvoiceNumbers(3, "INV-", "1"), ["INV-1", "INV-2", "INV-3"]);
  // And it GROWS rather than wraps — the property salesrecon.js was missing.
  assertEquals(o2oInvoiceNumbers(3, "", "9998"), ["9998", "9999", "10000"]);
  assertEquals(o2oInvoiceNumbers(2, "", "0"), ["0", "1"]);
});
