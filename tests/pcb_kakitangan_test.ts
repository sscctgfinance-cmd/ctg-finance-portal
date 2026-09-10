// PCB agrees with Kakitangan, to the sen.
//
// WHY THIS FILE EXISTS: the operator runs DrSmile Whitening Sdn Bhd's payroll on Kakitangan.com and
// asked for HR OS to compute the same way. Reading Kakitangan's own August/September 2026 figures
// showed that every gazetted item ALREADY matched — the KWSP Third Schedule banding, the SOCSO and EIS
// tables at the RM6,000 ceiling, SKBBK, and HRDF at 1% — and that PCB sat exactly FIVE SEN low on every
// clean case:
//
//     Loong Ming Haow  15,000/mo   Kakitangan 2,179.25   HR OS 2,179.20
//     Elaine Lam       13,000/mo   Kakitangan 1,679.25   HR OS 1,679.20
//
// Five sen, identical on both, is not noise. Working back from the figures, Kakitangan's annual tax was
// exactly RM1 higher, i.e. RM4 LESS relief — and RM4 is `4,000 − 333 × 12`. LHDN's MTD specification
// caps the EPF relief at **RM333 a month**, not RM4,000 a year. v230 changed the cap to `333 × N` and
// both figures reproduce exactly.
//
// The third case is the one that proves it is the cap and not a fudge factor. Song Huey Yu's September
// PCB is 68.80, which HR OS does NOT reproduce — because her salary rose mid-year and she had earnings
// in earlier months, so a flat-salary model is the wrong input, not the wrong formula. Her MARCH payroll
// (basic 3,000 + additional 1,000 = 4,000, no year-to-date behind it) is the comparable one, and
// Kakitangan paid 50.05 — which is what HR OS returns for that input after v230 and NOT before it
// (it returned 16.70). Three independent points, one change.
//
// These are real figures from a real payroll. If this file goes red, HR OS and the system the operator
// reconciles against have diverged, and somebody's PCB is being remitted wrong.

import { assertEquals } from "jsr:@std/assert@1";

// deno-lint-ignore no-explicit-any
async function load(file: string, names: string): Promise<any> {
  const src = await Deno.readTextFile(new URL("../" + file, import.meta.url));
  return await import("data:application/javascript," + encodeURIComponent(
    src.replace(/if \(typeof module[\s\S]*$/, `export { ${names} };`),
  ));
}
const { hrCompute } = await load("payroll.js", "hrCompute");

// hr_statutory_rates.rates as production holds it: the four relief keys are NULL, so the engine
// defaults apply — including the RM333/month EPF relief cap this file exists to pin.
const CFG = {
  eis: { eeRate: 0.002, erRate: 0.002, ceiling: 6000 },
  epf: { eeRate: 0.11, eeSenior: 0, erSenior: 0.04, erRateLow: 0.13, threshold: 5000, erRateHigh: 0.12 },
  socso: { eeRate: 0.005, erRate: 0.0175, ceiling: 6000, erRate2: 0.0125 },
  pcbMethod: "payroll_my",
};
const emp = (basic: number) => ({
  basic_salary: basic, fixed_allowance: 0, date_of_birth: "1990-01-01", join_date: "2020-01-01",
  resign_date: null, marital_status: "single", spouse_working: false, num_children: 0,
  resident: true, citizen_status: "citizen", lindung24: true,
});
const P = { year: 2026, month: 9 };

Deno.test("PCB matches Kakitangan on a flat-salary employee — 15,000 and 13,000", () => {
  // Both are Single, no additional earnings in any month of 2026, so a full-year projection with no
  // year-to-date is the same calculation Kakitangan is doing. That is what makes them comparable at all.
  assertEquals(hrCompute(emp(15000), CFG, [], P, null).pcb, 2179.25, "Loong Ming Haow, DrSmile, Sept 2026");
  assertEquals(hrCompute(emp(13000), CFG, [], P, null).pcb, 1679.25, "Elaine Lam, DrSmile, Sept 2026");
});

Deno.test("PCB matches Kakitangan on a 4,000 employee — Song Huey Yu, March 2026", () => {
  // 3,000 basic + 1,000 additional, her first months on that package, so no meaningful YTD behind it.
  // Kakitangan paid 50.05. Before v230 HR OS returned 16.70 — the RM400 s.6A rebate applies at exactly
  // RM35,000 chargeable, and the extra RM4 of income the tighter EPF cap creates pushes her past it.
  // That threshold is why the error was 5 sen for the two above and RM33 for her: the SAME RM4 of
  // relief, landing on the wrong side of a rebate cliff.
  assertEquals(hrCompute(emp(4000), CFG, [], { year: 2026, month: 3 }, null).pcb, 50.05);
});

Deno.test("PCB matches Kakitangan when a TAXABLE additional earning is present", () => {
  // The question this answers: does Kakitangan charge an additional earning ONCE (LHDN's additional-
  // remuneration treatment) or fold it into the base and ANNUALISE it? Read off two real months where
  // the extra was demonstrably statutory — it moved EPF and SOCSO in the same report row — the answer
  // is that Kakitangan ANNUALISES it, and HR OS reproduces both to the sen.
  //
  //   Song Huey Yu  Feb 2026  3,000 basic + 1,000 additional  ->  50.05
  //   Tan Zi Hui    Jan 2026  4,000 basic +   500 additional  ->  80.05
  //
  // Both land just past the RM35,000 chargeable line where s.6A's RM400 rebate stops, which is why the
  // RM4 the monthly EPF cap removes is worth RM33 to one of them and 5 sen to the two big salaries.
  assertEquals(hrCompute(emp(4000), CFG, [], { year: 2026, month: 2 }, null).pcb, 50.05, "Song Huey Yu, Feb");
  assertEquals(hrCompute(emp(4500), CFG, [], { year: 2026, month: 1 }, null).pcb, 80.05, "Tan Zi Hui, Jan");

  // The same figures via the ADJUSTMENT path rather than a raised basic — an `allowance` is normal
  // remuneration, so the two must agree. If they ever diverge, an operator typing the extra into the
  // grid gets a different tax to one whose basic was raised by the same amount.
  const viaAllowance = hrCompute(emp(3000), CFG, [{ kind: "allowance", amount: 1000 }], { year: 2026, month: 2 }, null);
  assertEquals(viaAllowance.pcb, 50.05, "1,000 as an allowance must tax the same as 1,000 of basic");

  // And the contrast that makes it a real finding: filed as a BONUS it is charged once instead, which
  // is a different number. Kakitangan's own report shows both behaviours on the same company, because
  // the treatment is a per-earning-type flag there, not a global rule — see
  // data/decisions/kakitangan-replacement.md.
  const viaBonus = hrCompute(emp(3000), CFG, [{ kind: "bonus", amount: 1000 }], { year: 2026, month: 2 }, null);
  assertEquals(viaBonus.pcb !== 50.05, true, "a bonus must NOT annualise — that is what makes it a choice");
});

Deno.test("PCB matches Kakitangan across the salary range — six real months", () => {
  // Every one of these is a month DrSmile actually paid, with no additional earnings, so the projection
  // Kakitangan runs and the one HR OS runs are the same calculation on the same input.
  const CASES: [number, number, number, string][] = [
    [12000, 1, 1429.25, "Loong Ming Haow, Jan"],
    [15000, 9, 2179.25, "Loong Ming Haow, Sept"],
    [10000, 1,  929.25, "Elaine Lam, Jan"],
    [13000, 9, 1679.25, "Elaine Lam, Sept"],
  ];
  for (const [basic, month, want, who] of CASES) {
    assertEquals(hrCompute(emp(basic), CFG, [], { year: 2026, month }, null).pcb, want, who);
  }
});

Deno.test("the cap is RM333 A MONTH, and it scales with service months", () => {
  // The distinction the whole change turns on. A full year is 333 x 12 = 3,996 — four ringgit under the
  // annual figure it replaced. A mid-year joiner gets proportionally less, which is the point of
  // expressing it per month: someone who starts in July cannot have accrued a full year's relief.
  const full = hrCompute(emp(15000), CFG, [], P, null);
  const joiner = hrCompute({ ...emp(15000), join_date: "2026-07-01" }, CFG, [], P, null);
  assertEquals(full.pcb, 2179.25);
  // Six service months -> the cap is 333 x 6, so the joiner's relief is smaller AND his projection is
  // shorter. Assert only that the engine treats them differently; the figure itself is pinned above.
  assertEquals(joiner.pcb !== full.pcb, true, "a mid-year joiner must not get a full year's EPF relief");

  // An explicit annual override still wins, so a company that has pinned a figure keeps it.
  const pinned = hrCompute(emp(15000), { ...CFG, reliefEpfMax: 4000 }, [], P, null);
  assertEquals(pinned.pcb, 2179.20, "reliefEpfMax:4000 reproduces the pre-v230 figure exactly");
  // And the monthly cap itself is configurable.
  const custom = hrCompute(emp(15000), { ...CFG, reliefEpfMonthlyMax: 500 }, [], P, null);
  assertEquals(custom.pcb < full.pcb, true, "a larger monthly cap must give more relief, so less tax");
});

Deno.test("everything that already matched Kakitangan still does", () => {
  // Guard the guard: v230 touched the PCB relief only. If a statutory figure moves, this file is the
  // first place it should be visible, because these are the numbers actually remitted for DrSmile.
  const r = hrCompute(emp(15000), CFG, [], P, null);
  assertEquals([r.epfEe, r.epfEr], [1650, 1800], "EPF ee/er — Kakitangan 1,650.00 / 1,800.00");
  assertEquals([r.socsoEe, r.socsoEr], [29.75, 104.15], "SOCSO — Kakitangan 29.75 / 104.15");
  assertEquals([r.eisEe, r.eisEr], [11.90, 11.90], "EIS — Kakitangan 11.90 / 11.90");
  assertEquals(r.lindung, 44.65, "SKBBK — Kakitangan 44.65");

  // The RM1,548.39 case off Kakitangan's own calculator, which exercises the RM20 EPF band step.
  const s = hrCompute(emp(1548.39), CFG, [], P, null);
  assertEquals([s.epfEe, s.epfEr], [172, 203], "EPF on 1,548.39 bands up to 1,560 — Kakitangan 172 / 203");
  assertEquals([s.socsoEe, s.eisEe, s.lindung], [7.75, 3.10, 11.65], "Kakitangan 7.75 / 3.10 / 11.65");
  assertEquals(s.pcb, 0, "below the MTD threshold, as Kakitangan shows");
});
