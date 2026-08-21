// Company Info — what the Save button actually puts on the wire.
//
// WHY THIS FILE EXISTS: saving SKINDAE failed with `invalid input syntax for type date: ""` and the
// form gave no clue which field was at fault. A blank <input type="date"> reads as "", Postgres rejects
// ""::date, and the whole 19-section form refused to save because of an untouched compliance date.
//
// The guard existed — but as a hand-written list of ONE field name (`incorporation_date`). The four
// Compliance dates were added to INFO_SECTIONS later and nobody remembered the other list. So the test
// below is deliberately written against the SCHEMA, not against today's field names: it walks every
// field INFO_SECTIONS declares and asserts the typing holds for each. Add a date field tomorrow and
// this test covers it without being edited.

import { assertEquals } from "jsr:@std/assert@1";
import { arrSource, fnSource, inlineScript } from "../tools/extract.ts";

const src = inlineScript(await Deno.readTextFile(new URL("../app.html", import.meta.url)));

// deno-lint-ignore no-explicit-any
function collectWith(values: Record<string, string>): Record<string, any> {
  const els = Object.keys(values).map((k) => ({ dataset: { k }, value: values[k] }));
  const fn = new Function(
    "document",
    arrSource(src, "INFO_SECTIONS") + "\n" + fnSource(src, "infoCollect") + "\nreturn infoCollect();",
  );
  return fn({
    querySelectorAll: () => els,
    querySelector: () => null, // no sub-tables in this fixture
  });
}

// deno-lint-ignore no-explicit-any
const SECTIONS: any[] = new Function(arrSource(src, "INFO_SECTIONS") + "\nreturn INFO_SECTIONS;")();
const fieldsOfType = (t: string) =>
  SECTIONS.flatMap((s) => s.fields || []).filter((f: { type?: string }) => f.type === t);

Deno.test("the form declares more than one date field — a hand-written guard list cannot keep up", () => {
  // If this ever drops to 1 the original bug is unreachable, but that is not the world we are in:
  // incorporation_date plus four Compliance dates.
  assertEquals(fieldsOfType("date").length > 1, true);
});

Deno.test("EVERY empty date leaves as null — never the empty string Postgres rejects", () => {
  const dates = fieldsOfType("date").map((f: { k: string }) => f.k);
  const blank: Record<string, string> = {};
  dates.forEach((k: string) => blank[k] = "");
  blank["legal_name"] = "SKINDAE SDN BHD";

  const patch = collectWith(blank);
  for (const k of dates) {
    assertEquals(patch[k], null, `${k} went out as ${JSON.stringify(patch[k])} — ""::date is a 500`);
  }
  // Whitespace typed into a date box is just as fatal as "".
  const spaced = collectWith({ [dates[0]]: "   " });
  assertEquals(spaced[dates[0]], null, "a whitespace-only date must normalise to null");
});

Deno.test("a real date is passed through untouched", () => {
  const k = fieldsOfType("date")[0].k;
  assertEquals(collectWith({ [k]: "2023-01-19" })[k], "2023-01-19");
});

Deno.test("empty numbers go out as null, and real ones as numbers not strings", () => {
  const nums = fieldsOfType("number").map((f: { k: string }) => f.k);
  assertEquals(nums.length > 0, true, "no number fields found — the extractor is not seeing the schema");
  const blank: Record<string, string> = {};
  nums.forEach((k: string) => blank[k] = "");
  const empty = collectWith(blank);
  for (const k of nums) assertEquals(empty[k], null, `${k} must not go out as ""`);

  const filled = collectWith({ [nums[0]]: "400000" });
  assertEquals(filled[nums[0]], 400000);
  assertEquals(typeof filled[nums[0]], "number", "a numeric column must not receive a string");
});

Deno.test("text fields are still sent when empty, so a value can be cleared", () => {
  // Only date/number are re-typed. Blanking a text box must still reach the server as a clear, not
  // silently keep the old value — that would be the opposite failure, and a quiet one.
  const patch = collectWith({ trade_name: "", legal_name: "SKINDAE SDN BHD" });
  assertEquals("trade_name" in patch, true);
  assertEquals(patch.trade_name, "");
  assertEquals(patch.legal_name, "SKINDAE SDN BHD");
});

Deno.test("nothing typed as date or number can reach the wire as an empty string", () => {
  // The blanket statement of the bug: fill the entire form with "" and inspect every key.
  const all: Record<string, string> = {};
  SECTIONS.flatMap((s) => s.fields || []).forEach((f: { k: string }) => all[f.k] = "");
  const patch = collectWith(all);
  for (const f of SECTIONS.flatMap((s) => s.fields || [])) {
    if (f.type === "date" || f.type === "number") {
      assertEquals(patch[f.k], null, `${f.k} (${f.type}) is "" — this is the exact save failure`);
    }
  }
});
