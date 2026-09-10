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

const HROS_JS = inlineScript(HROS);
const mod = await import("data:application/typescript," + encodeURIComponent(
  [fnSource(HROS_JS, "hrRCAmt"), fnSource(HROS_JS, "hrRCItemAmt"), "export { hrRCAmt, hrRCItemAmt };"].join("\n"),
));
// deno-lint-ignore no-explicit-any
const { hrRCAmt, hrRCItemAmt } = mod as any;

// v231: the SERVER's copy, lifted out of hr.ts the same way — so the two are compared by what they
// RETURN rather than by whether one line of source still reads the same. The old check was a substring
// match on `Math.round((Number(it.amount)||0)*100)/100`, which went red the moment the shared helper
// landed even though the arithmetic was unchanged and now also clamps. Behaviour is the contract here
// because both sides are drivable; a source pin is for a property with no output.
const srv = await import("data:application/typescript," + encodeURIComponent(
  fnSource(HR_TS, "rcAmt") + "\nexport { rcAmt };",
));
// deno-lint-ignore no-explicit-any
const { rcAmt } = srv as any;

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
  // Both implementations, over the same inputs. A fix applied to one and not the other is the drift this
  // file exists for, and comparing RETURN VALUES catches it however either one is spelled.
  const CASES: unknown[] = [10.005, 12.344, "33.333", 0, "", null, undefined, 0.004, 1234.567, -0, 1e-9];
  for (const v of CASES) {
    assertEquals(rcAmt(v), hrRCAmt(v), `client and server disagree on ${JSON.stringify(v)}`);
  }
  // And the two call sites still route through it — the arithmetic can be shared, but only if it IS.
  const at = HR_TS.indexOf("const amt = t.is_mileage");
  assertEquals(at > -1, true, "hr_rc_save's per-item amount no longer looks like this");
  const block = HR_TS.slice(at, at + 400);
  assertEquals(block.includes("rcAmt(Number(it.amount))"), true, "the typed item path bypasses rcAmt");
  assertEquals(block.includes("(Number(it.total_km)||0)*(Number(it.mileage_rate)||0)"), true);
  assertEquals(HR_TS.includes("rcAmt(c.amount)"), true, "the single-claim path bypasses rcAmt");
});

Deno.test("a claim line can never be negative or non-finite — it is paid by a bank file", () => {
  // v231, found by driving hr_rc_save's inputs. `Number('1e400')||0` is Infinity (isNaN(Infinity) is
  // FALSE), and a claim amount reaches hrRCExportBank / bankFile() — the reimbursement payment file. A
  // negative line there is a CREDIT, and an Infinity is stored as NULL and silently pays RM 0.00.
  // Same class as the payroll grid's hrGridCell, in the second place it appears.
  for (const impl of [rcAmt, hrRCAmt] as ((n: unknown) => number)[]) {
    assertEquals(impl(-500), 0, "a negative claim line reached a bank payment file");
    assertEquals(impl("-0.01"), 0);
    assertEquals(impl("1e400"), 0, "Infinity reached a claim amount");
    assertEquals(impl(Infinity), 0);
    assertEquals(impl(NaN), 0);
    assertEquals(impl("abc"), 0);
    // …and the guard must not touch anything legitimate.
    assertEquals(impl(10.005), 10.01);
    assertEquals(impl(0), 0);
  }
  // The mileage branch goes through the same helper, so a negative distance cannot invert a line either.
  assertEquals(hrRCItemAmt({ total_km: -100, mileage_rate: 0.30 }, true), 0);
});
