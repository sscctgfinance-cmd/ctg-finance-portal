// The payroll draft/finalised state badge (v181).
//
// WHY THIS FILE EXISTS: this badge is the only thing telling the operator whether the figures on screen
// are saved, and whether a finalised month has been edited since its payslips were written. A state that
// silently never renders is worse than no badge at all — they would trust "Finalised" while the entries
// underneath had changed. The "edited after finalising" branch in particular can only fire on a specific
// timestamp ordering, so it is exactly the kind of thing that ships broken and is never noticed.
//
// hrGridStateHtml touches no DOM, so it can be exercised directly with stubbed globals.

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { fnSource, inlineScript } from "../tools/extract.ts";

const fe = inlineScript(await Deno.readTextFile(new URL("../hros.html", import.meta.url)));

// esc() is the app's HTML escaper; the badge builds a title attribute from it.
const src = `
  const esc = (s) => String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const HR = { pay: {} };
  ${fnSource(fe, "hrGridStateHtml")}
  return { HR, hrGridStateHtml };
`;
const { HR, hrGridStateHtml } = new Function(src)() as {
  // deno-lint-ignore no-explicit-any
  HR: any;
  hrGridStateHtml: () => string;
};

const render = (pay: Record<string, unknown>) => {
  HR.pay = pay;
  return hrGridStateHtml();
};

const FINALISED = "2026-08-01T10:00:00Z";
const BEFORE = "2026-08-01T09:00:00Z";
const AFTER = "2026-08-02T09:00:00Z";

Deno.test("nothing saved yet reads as an unsaved draft", () => {
  assertStringIncludes(render({ month: 7, year: 2026, data: { run: null } }), "not saved yet");
});

Deno.test("typed-but-unsaved beats every other state", () => {
  // Whatever the stored run says, if the operator has typed since, THAT is the urgent fact.
  for (
    const run of [
      null,
      { status: "draft", entries_saved_at: BEFORE },
      { status: "finalised", finalised_at: FINALISED },
    ]
  ) {
    const html = render({ month: 7, year: 2026, dirty: true, data: { run } });
    assertStringIncludes(html, "Unsaved changes");
    assertStringIncludes(html, "pill-amber");
  }
});

Deno.test("saved draft shows as saved, and is NOT reported as finalised", () => {
  const html = render({ month: 7, year: 2026, data: { run: { status: "draft", entries_saved_at: BEFORE } } });
  assertStringIncludes(html, "Draft saved");
  assertEquals(html.includes("Finalised"), false, "a draft must never read as finalised");
});

Deno.test("finalised with no later edit is clean green", () => {
  const html = render({
    month: 7,
    year: 2026,
    data: { run: { status: "finalised", finalised_at: FINALISED, entries_saved_at: BEFORE } },
  });
  assertStringIncludes(html, "Finalised");
  assertStringIncludes(html, "pill-green");
  assertEquals(html.includes("Edited after"), false);
});

Deno.test("entries saved AFTER finalising must warn — the payslips no longer match", () => {
  // The whole reason entries_saved_at and finalised_at are separate columns.
  const html = render({
    month: 7,
    year: 2026,
    data: { run: { status: "finalised", finalised_at: FINALISED, entries_saved_at: AFTER } },
  });
  assertStringIncludes(html, "Edited after finalising");
  assertStringIncludes(html, "pill-amber");
  assertStringIncludes(html, "re-finalise");
});

Deno.test("a finalised run with no timestamps does not fall through to a false warning", () => {
  // Rows finalised before these columns existed have nulls. Comparing nulls must not read as "edited".
  const html = render({ month: 7, year: 2026, data: { run: { status: "finalised" } } });
  assertStringIncludes(html, "Finalised");
  assertEquals(html.includes("Edited after"), false, "missing timestamps must not manufacture a warning");
});

Deno.test("a garbage timestamp degrades to the plain state instead of rendering 'Invalid Date'", () => {
  const html = render({
    month: 7,
    year: 2026,
    data: { run: { status: "draft", entries_saved_at: "not-a-date" } },
  });
  assertEquals(html.includes("Invalid Date"), false, "an unparseable timestamp must not reach the operator");
  assertStringIncludes(html, "Draft saved");
});

Deno.test("the badge always carries the id the in-place repaint targets", () => {
  // hrGridStatePaint() replaces this node by id while the operator is typing. If the id is ever dropped,
  // the badge silently freezes on a stale state instead of erroring.
  for (
    const pay of [
      { month: 7, year: 2026, data: { run: null } },
      { month: 7, year: 2026, dirty: true, data: { run: null } },
      { month: 7, year: 2026, data: { run: { status: "finalised", finalised_at: FINALISED } } },
    ]
  ) {
    assertStringIncludes(render(pay), 'id="hr_paystate"');
  }
});
