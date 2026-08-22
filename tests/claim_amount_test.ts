// A claim's amount is rounded to the sen ONCE, on both sides of the wire.
//
// WHY: hr_rc_save stores a per-item amount AND a header total, and the header is what hrRCExportBank
// pays. The mileage branch always rounded; the typed branch did not. So an amount entered with a third
// decimal was stored raw on the item, printed on the approval document through toFixed(2), and rolled
// into a header total computed with Math.round() over the SUM — three roundings of one figure, and the
// approver's document could not be made to cast against the amount that was paid.
//
// The two implementations are `amt` inside hr_rc_save (hr.ts) and hrRCItemAmt() (hros.html). They are
// the same line on either side of the wire, so this reads BOTH out of the shipped source: a fix applied
// to one and not the other is the drift that matters, and nothing else checks it.

import { assertEquals } from "jsr:@std/assert@1";
import { fnSource, inlineScript } from "../tools/extract.ts";

const HROS = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
const HR_TS = await Deno.readTextFile(new URL("../supabase/functions/portal/hr.ts", import.meta.url));

const mod = await import("data:application/typescript," + encodeURIComponent(
  fnSource(inlineScript(HROS), "hrRCItemAmt") + "\nexport { hrRCItemAmt };",
));
// deno-lint-ignore no-explicit-any
const { hrRCItemAmt } = mod as any;

Deno.test("a typed claim amount is stored to the sen, not raw", () => {
  assertEquals(hrRCItemAmt({ amount: 10.005 }, false), 10.01);
  assertEquals(hrRCItemAmt({ amount: 12.344 }, false), 12.34);
  assertEquals(hrRCItemAmt({ amount: "33.333" }, false), 33.33);
  assertEquals(hrRCItemAmt({ amount: 0 }, false), 0);
  assertEquals(hrRCItemAmt({}, false), 0);
});

Deno.test("the items a claim is made of add up to the header total that gets paid", () => {
  // Three roundings of one figure was the defect: this is the property that makes them one.
  const items = [{ amount: 10.005 }, { amount: 10.005 }, { amount: 0.004 }];
  const amts = items.map((it) => hrRCItemAmt(it, false));
  const header = Math.round(amts.reduce((s, a) => s + a, 0) * 100) / 100;
  assertEquals(amts, [10.01, 10.01, 0]);
  assertEquals(header, 20.02);
  // What the approval document prints per row must sum to what the bank file pays.
  assertEquals(Math.round(amts.reduce((s, a) => s + Number(a.toFixed(2)), 0) * 100) / 100, header);
});

Deno.test("a mileage line is still km x rate + parking + toll, to the sen", () => {
  assertEquals(hrRCItemAmt({ total_km: 13.7, mileage_rate: 0.30, parking_amount: 4.5, toll_amount: 3.2 }, true), 11.81);
  assertEquals(hrRCItemAmt({ total_km: 0, mileage_rate: 0.30 }, true), 0);
  // The typed `amount` is ignored on a mileage line — the distance is the claim.
  assertEquals(hrRCItemAmt({ amount: 999, total_km: 10, mileage_rate: 0.30 }, true), 3);
});

Deno.test("the server rounds the same way — the two sides of the wire cannot drift", () => {
  // Read out of hr.ts rather than described: hr_rc_save's stored item amount and hrRCItemAmt must be
  // the same arithmetic, or the approval document and the stored claim disagree by a sen.
  const at = HR_TS.indexOf("const amt = t.is_mileage");
  assertEquals(at > -1, true, "hr_rc_save's per-item amount no longer looks like this");
  const block = HR_TS.slice(at, at + 400);
  assertEquals(block.includes("Math.round((Number(it.amount)||0)*100)/100"), true,
    "the server stores a typed claim amount unrounded again");
  assertEquals(block.includes("(Number(it.total_km)||0)*(Number(it.mileage_rate)||0)"), true);
  // …and the single-claim (non-items) path too.
  assertEquals(HR_TS.includes("Math.round((Number(c.amount)||0)*100)/100"), true,
    "the single-claim path stores its amount unrounded");
});
