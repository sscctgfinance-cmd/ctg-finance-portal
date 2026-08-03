// Golden tests for the Malaysian statutory contribution tables.
//
// WHY THIS FILE EXISTS: v155 shipped a MY_EIS and a MY_SOCSO_CAT2 that were wrong in both values and band
// structure. EIS was 5 sen high on every band from RM200 up, so every employee was over-deducted, every
// month, silently — and the PERKESO filing never reconciled. Nothing failed, nothing alerted; it was found
// only by a line-by-line audit weeks later. These assertions are the officially published figures. If a
// table is ever regenerated or "corrected" by formula, this test fails before it reaches a payslip.
//
// Anchors are gazetted values, not computed ones — do not derive them from a rate.

import { assertEquals } from "jsr:@std/assert@1";
import { arrSource, fnSource, inlineScript } from "../tools/extract.ts";

const html = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
const ts = await Deno.readTextFile(new URL("../portal_current.ts", import.meta.url));
const fe = inlineScript(html);

type Row = [number, number, number];
const parse = (src: string, name: string): Row[] =>
  eval(arrSource(src, name).replace(/^const\s+\w+\s*=\s*/, "").replace(/;$/, ""));

const feCat1 = parse(fe, "MY_SOCSO_CAT1"), beCat1 = parse(ts, "MY_SOCSO_CAT1");
const feCat2 = parse(fe, "MY_SOCSO_CAT2"), beCat2 = parse(ts, "MY_SOCSO_CAT2");
const feEis = parse(fe, "MY_EIS"), beEis = parse(ts, "MY_EIS");

// eslint-disable-next-line no-eval
const lookup = eval("(" + fnSource(fe, "myStatLookup") + ")");
const at = (tbl: Row[], wage: number) => lookup(tbl, wage) as { ee: number; er: number };

Deno.test("tables are byte-identical between hros.html and portal_current.ts", () => {
  // The server recomputes payroll and rejects any >1-sen difference (409 recompute_mismatch). If these
  // two copies ever drift, payroll cannot be finalised at all — for the whole company.
  assertEquals(JSON.stringify(feCat1), JSON.stringify(beCat1), "MY_SOCSO_CAT1 drifted");
  assertEquals(JSON.stringify(feCat2), JSON.stringify(beCat2), "MY_SOCSO_CAT2 drifted");
  assertEquals(JSON.stringify(feEis), JSON.stringify(beEis), "MY_EIS drifted");
});

Deno.test("all three tables use the official 64 RM100 bands to the RM6,000 ceiling", () => {
  // The wrong v155 tables gave themselves away here first: 24 and 32 rows on RM500 bands.
  for (const [name, tbl] of [["CAT1", feCat1], ["CAT2", feCat2], ["EIS", feEis]] as const) {
    assertEquals(tbl.length, 64, name + " should have 64 bands");
    assertEquals(tbl[tbl.length - 1][0], 6000, name + " should top out at the RM6,000 ceiling");
  }
  assertEquals(feCat1.map((r) => r[0]), feCat2.map((r) => r[0]), "CAT2 bands must match CAT1");
  assertEquals(feCat1.map((r) => r[0]), feEis.map((r) => r[0]), "EIS bands must match CAT1");
});

Deno.test("SOCSO Category 1 — gazetted anchors", () => {
  assertEquals(at(feCat1, 6000), { ee: 29.75, er: 104.15 }, "ceiling band");
  assertEquals(at(feCat1, 3500), { ee: 17.25, er: 60.35 }, "RM3,400.01-3,500 (the band that first exposed the formula bug)");
  assertEquals(at(feCat1, 1000), { ee: 4.75, er: 16.65 });
  assertEquals(at(feCat1, 9999), { ee: 29.75, er: 104.15 }, "above the ceiling must clamp, not fall through to 0");
});

Deno.test("SOCSO Category 2 (age 60+) — gazetted anchors", () => {
  assertEquals(at(feCat2, 6000).er, 74.40, "ceiling band");
  assertEquals(at(feCat2, 1050).er, 13.10, "RM1,000-1,100: midpoint x 1.25% would wrongly give 13.15");
  assertEquals(at(feCat2, 1450).er, 18.10, "the wrong v155 table gave 14.40 here");
  assertEquals(at(feCat2, 6000).ee, 0, "employees aged 60+ do not contribute");
  assertEquals(feCat2.every((r) => r[1] === 0), true, "no Cat 2 band may charge the employee");
});

Deno.test("LINDUNG 24 Jam (SKBBK) — published anchors, and the naive formula is NOT good enough", () => {
  // PERKESO publishes this table only as a scanned image, so it is DERIVED from two gazetted columns HR OS
  // already holds: Phase-1 total employee contribution is 1.25% (0.5% invalidity + 0.75% SKBBK), the 1.25%
  // column is MY_SOCSO_CAT2's employer side and the 0.5% column is MY_SOCSO_CAT1's employee side.
  //     SKBBK = Cat2_employer − Cat1_employee
  // If either source column is ever edited, these anchors are what catches it.
  const lin = (w: number) => Math.round((at(feCat2, w).er - at(feCat1, w).ee) * 100) / 100;

  assertEquals(lin(6000), 44.65, "published maximum at the RM6,000 ceiling");
  assertEquals(lin(3050), 22.85, "published figure for the RM3,000.01–3,100 band");
  assertEquals(at(feCat2, 6000).er, 74.40, "the 1.25% column this is derived from");
  assertEquals(lin(9999), lin(6000), "above the ceiling must clamp, not fall through to zero");
  assertEquals(lin(0), 0, "no wage, no contribution");

  // Whole schedule must behave: never negative, always a clean 5 sen, never decreasing as wages rise.
  let prev = -1;
  for (const [cap] of feCat1) {
    const v = lin(cap);
    assertEquals(v >= 0, true, `negative SKBBK at ${cap}: ${v}`);
    assertEquals(Math.round(v * 100) % 5, 0, `SKBBK at ${cap} is not a 5-sen multiple: ${v}`);
    assertEquals(v >= prev, true, `SKBBK went down at ${cap}: ${v} < ${prev}`);
    prev = v;
  }

  // The reason this is derived rather than computed: a naive "band midpoint × 0.75%, round to 5 sen"
  // disagrees on half the schedule. If someone ever "simplifies" the code to that formula, it would look
  // reasonable and be wrong for 32 of 64 wage bands — the v155 failure exactly.
  const midOf = (i: number) => ((i === 0 ? 0 : feCat1[i - 1][0]) + feCat1[i][0]) / 2;
  let disagree = 0;
  feCat1.forEach((_r, i) => {
    const naive = Math.round(midOf(i) * 0.0075 * 20) / 20;
    if (Math.abs(naive - lin(feCat1[i][0])) > 0.001) disagree++;
  });
  assertEquals(disagree > 20, true, `expected the naive formula to be widely wrong, it differed on ${disagree}/64`);
});

Deno.test("EIS / SIP — gazetted anchors", () => {
  assertEquals(at(feEis, 6000).ee, 11.90, "published maximum is RM11.90 each side; the wrong table said 11.95");
  assertEquals(at(feEis, 2050).ee, 4.10, "the wrong table's RM500 bands gave 4.95 here");
  assertEquals(at(feEis, 2000).ee, 3.90);
  assertEquals(at(feEis, 1000).ee, 1.90);
  assertEquals(at(feEis, 300).ee, 0.50);
  assertEquals(feEis.every((r) => r[1] === r[2]), true, "EIS employee and employer shares are always equal");
});

Deno.test("no table has a gap, a negative, or a non-5-sen amount", () => {
  for (const [name, tbl] of [["CAT1", feCat1], ["CAT2", feCat2], ["EIS", feEis]] as const) {
    let prev = 0;
    for (const [upper, ee, er] of tbl) {
      assertEquals(upper > prev, true, name + ": bands must ascend at " + upper);
      prev = upper;
      for (const v of [ee, er]) {
        assertEquals(v >= 0, true, name + ": negative amount at band " + upper);
        assertEquals(Math.round(v * 100) % 5, 0, name + ": " + v + " at band " + upper + " is not a whole 5 sen");
      }
    }
  }
});

Deno.test("PCB rounding follows LHDN — truncate to 2dp, then round UP to 5 sen", () => {
  const r5 = eval("(" + fnSource(fe, "myPcbRoundUp5") + ")");
  assertEquals(r5(10.01), 10.05, "rounds up to the next 5 sen");
  assertEquals(r5(10.00), 10.00, "an exact 5-sen multiple is left alone");
  assertEquals(r5(10.06), 10.10, "10.06 -> 10.10");
  assertEquals(r5(10.051), 10.05, "truncate to 2dp happens FIRST, so the trailing 1 is dropped before rounding");
  assertEquals(r5(0), 0);
});
