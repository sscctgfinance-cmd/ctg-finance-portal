// The Malaysian postcode table, and the address form that fills itself from it.
//
// WHY THIS FILE EXISTS: postcode.js is GENERATED (tools/gen_postcodes.ts) from a third-party dataset.
// A generator's checks run when somebody remembers to run it; these run on every push, against the
// COMMITTED file, so a hand-edit, a bad merge or a regeneration from a reshaped upstream is caught
// rather than discovered on a statutory address. The anchors are the same ones the generator refuses
// to write without — state capitals, both federal territories, the three postcode blocks that sit
// inside another state's range, and SKINDAE's own registered office.
//
// It also pins the two rules that make the feature safe rather than merely convenient:
//   · a PARTIAL postcode resolves to nothing, so typing "103" on the way to "10300" cannot flip the
//     state to whatever matched and then flip it again;
//   · every state name in the table is one the form's own <select> offers — a value with no matching
//     <option> selects NOTHING, so a rename upstream would BLANK the state instead of setting it, and
//     the form would look like the operator had left it empty.

import { assertEquals } from "jsr:@std/assert@1";
import { arrSource, fnSource, inlineScript } from "../tools/extract.ts";

const pcSrc = await Deno.readTextFile(new URL("../postcode.js", import.meta.url));
const appRaw = await Deno.readTextFile(new URL("../app.html", import.meta.url));
const appSrc = inlineScript(appRaw);

const mod = await import("data:application/typescript," + encodeURIComponent(
  [pcSrc.replace(/if \(typeof module[\s\S]*$/, ""),
   "export { MY_POSTCODES, myPostcodeFind, MY_STATES, MY_STATE_CODE, myStateName };"].join("\n"),
));
// deno-lint-ignore no-explicit-any
const { MY_POSTCODES, myPostcodeFind, MY_STATES, MY_STATE_CODE, myStateName } = mod as any;

/** The generator's own list. Duplicated here ON PURPOSE: this file must fail if the generator's copy
 *  is weakened, and a test that imports the thing it checks proves nothing. */
const ANCHORS: [string, string, string][] = [
  ["01000", "Perlis", "Kangar"],
  ["05000", "Kedah", "Alor Setar"],
  ["10300", "Pulau Pinang", "Pulau Pinang"],
  ["15000", "Kelantan", "Kota Bharu"],
  ["20000", "Terengganu", "Kuala Terengganu"],
  ["25000", "Pahang", "Kuantan"],
  ["30000", "Perak", "Ipoh"],
  ["39000", "Pahang", "Tanah Rata"],
  ["47301", "Selangor", "Petaling Jaya"],
  ["49000", "Pahang", "Bukit Fraser"],
  ["50000", "Wilayah Persekutuan Kuala Lumpur", "Kuala Lumpur"],
  ["62000", "Wilayah Persekutuan Putrajaya", "Putrajaya"],
  ["63000", "Selangor", "Cyberjaya"],
  ["68100", "Selangor", "Batu Caves"],
  ["69000", "Pahang", "Genting Highlands"],
  ["70000", "Negeri Sembilan", "Seremban"],
  ["75000", "Melaka", "Melaka"],
  ["80000", "Johor", "Johor Bahru"],
  ["87000", "Wilayah Persekutuan Labuan", "Labuan"],
  ["88000", "Sabah", "Kota Kinabalu"],
  ["93000", "Sarawak", "Kuching"],
];

Deno.test("the anchor postcodes resolve to the right state and locality", () => {
  for (const [pc, state, city] of ANCHORS) {
    const hit = myPostcodeFind(pc);
    assertEquals(hit?.state, state, `${pc} state`);
    assertEquals(hit?.cities.includes(city), true, `${pc} should offer ${city}, got ${JSON.stringify(hit?.cities)}`);
  }
});

Deno.test("three blocks sit inside another state's range and must not follow it", () => {
  // 39xxx is surrounded by Perak's 30000-36810, and 49xxx/69xxx by Selangor's and Negeri Sembilan's.
  // A derivation by numeric range — the obvious implementation — gets all three wrong.
  for (const pc of ["39000", "49000", "69000"]) {
    assertEquals(myPostcodeFind(pc)?.state, "Pahang", `${pc} is in Pahang`);
  }
  assertEquals(myPostcodeFind("36810")?.state, "Perak");
  assertEquals(myPostcodeFind("48300")?.state, "Selangor");
});

Deno.test("a partial or malformed postcode resolves to NOTHING", () => {
  // The state must not flip mid-keystroke. Everything short of five digits is "no answer yet".
  for (const bad of ["", "1", "10", "103", "1030", "103000", "abcde", "1030a", " 1030", null, undefined, {}]) {
    assertEquals(myPostcodeFind(bad), null, `${JSON.stringify(bad)} must not resolve`);
  }
  // Surrounding whitespace on a complete code is the operator's, not an error.
  assertEquals(myPostcodeFind(" 10300 ")?.state, "Pulau Pinang");
  // A code that is simply not allocated resolves to nothing rather than the nearest thing.
  assertEquals(myPostcodeFind("00000"), null);
  assertEquals(myPostcodeFind("99999"), null);
});

Deno.test("the dropdown is LHDN's state list, verbatim and complete", () => {
  // The IRBM e-Invoice state-code table (sdk.myinvois.hasil.gov.my/codes/state-codes). Typed out here
  // rather than imported from the thing under test, so a rename in postcode.js fails HERE rather than
  // agreeing with itself. Code 17 "Not Applicable" is for a foreign address and is deliberately absent.
  const OFFICIAL: [string, string][] = [
    ["01", "Johor"], ["02", "Kedah"], ["03", "Kelantan"], ["04", "Melaka"], ["05", "Negeri Sembilan"],
    ["06", "Pahang"], ["07", "Pulau Pinang"], ["08", "Perak"], ["09", "Perlis"], ["10", "Selangor"],
    ["11", "Terengganu"], ["12", "Sabah"], ["13", "Sarawak"],
    ["14", "Wilayah Persekutuan Kuala Lumpur"], ["15", "Wilayah Persekutuan Labuan"],
    ["16", "Wilayah Persekutuan Putrajaya"],
  ];
  assertEquals(MY_STATES, OFFICIAL.map(([, n]) => n));
  for (const [code, name] of OFFICIAL) assertEquals(MY_STATE_CODE[name], code, name);
  // The names the portal used before, which are NOT Malaysian state names, must be gone as options.
  for (const wrong of ["Pinang", "Kuala Lumpur", "Labuan", "Putrajaya", "Penang", "Malacca"]) {
    assertEquals(MY_STATES.includes(wrong), false, `"${wrong}" is not a state name and must not be offered`);
  }
});

Deno.test("a record stored under the OLD names still resolves — renaming an option renames nothing", () => {
  // This is the whole migration. `Pinang` is what SKINDAE's registered office is stored under, and a
  // stored value matching no <option> selects NOTHING — the field would read as never filled in.
  assertEquals(myStateName("Pinang"), "Pulau Pinang");
  assertEquals(myStateName("Kuala Lumpur"), "Wilayah Persekutuan Kuala Lumpur");
  assertEquals(myStateName("Labuan"), "Wilayah Persekutuan Labuan");
  assertEquals(myStateName("Putrajaya"), "Wilayah Persekutuan Putrajaya");
  // Colloquial and punctuation variants, since matching ignores everything but letters and digits.
  for (const s of ["Penang", "PULAU PINANG", "p. pinang", "  Pulau  Pinang "]) {
    assertEquals(myStateName(s), "Pulau Pinang", s);
  }
  for (const s of ["W.P. Kuala Lumpur", "WP KUALA LUMPUR", "KL", "wilayah persekutuan kuala lumpur"]) {
    assertEquals(myStateName(s), "Wilayah Persekutuan Kuala Lumpur", s);
  }
  assertEquals(myStateName("Malacca"), "Melaka");
  assertEquals(myStateName("Negri Sembilan"), "Negeri Sembilan");
  // Every official name resolves to itself — an alias must never redirect a correct value.
  for (const s of MY_STATES) assertEquals(myStateName(s), s, s);
});

Deno.test("an unrecognised state resolves to '' — never to itself", () => {
  // '' rather than the input: the caller is choosing a <select> option, and handing back an unknown
  // string sets the field to a value no option matches, which selects nothing and reads as unfilled.
  for (const s of ["Singapore", "Bangkok", "zzz", "", null, undefined, 42]) {
    assertEquals(myStateName(s), "", JSON.stringify(s));
  }
});

Deno.test("EVERY state in the table is one the form's own dropdown offers", () => {
  // MY_STATES is what <select> renders. A state the table names and the dropdown does not would set the
  // field to no option at all — the form would read as "state not filled in", which is worse than wrong
  // because it looks like the operator's omission.
  const states = MY_STATES as string[];
  // …and app.html must NOT declare its own. postcode.js is a classic script sharing the same global
  // lexical environment, so a second top-level declaration is a SyntaxError — a white screen for every
  // user, which the parse gate catches but which is worth naming where the cause lives.
  // Read the FILE, not inlineScript() — that concatenates the <script src> files too, postcode.js
  // among them, so it contains the one legitimate declaration by construction.
  assertEquals(/(?:const|let|var)\s+MY_STATES\s*=/.test(appRaw), false,
    "app.html declares MY_STATES again — that is a duplicate top-level declaration");
  const inTable = Object.keys(MY_POSTCODES).sort();
  assertEquals(inTable.length, 16);
  for (const s of inTable) {
    assertEquals(states.includes(s), true, `postcode.js names "${s}", which the State dropdown does not offer`);
  }
  // And the reverse, so a state can never become unreachable by postcode.
  for (const s of states) {
    assertEquals(inTable.includes(s), true, `the dropdown offers "${s}", which no postcode maps to`);
  }
});

Deno.test("the table is well formed — no empty locality, no malformed code, no duplicate", () => {
  let codes = 0;
  const seen = new Set<string>();
  for (const [state, cities] of Object.entries(MY_POSTCODES as Record<string, Record<string, string>>)) {
    assertEquals(Object.keys(cities).length > 0, true, `${state} has no localities`);
    for (const [city, list] of Object.entries(cities)) {
      assertEquals(city.trim(), city, `"${city}" has stray whitespace`);
      assertEquals(city.length > 0, true, `${state} has an empty locality name`);
      for (const p of list.split(" ")) {
        assertEquals(/^\d{5}$/.test(p), true, `${state}/${city} has a malformed code "${p}"`);
        assertEquals(seen.has(state + "|" + city + "|" + p), false, `${p} listed twice under ${state}/${city}`);
        seen.add(state + "|" + city + "|" + p);
        codes++;
      }
    }
  }
  assertEquals(codes > 2500, true, `only ${codes} postcodes — the table looks truncated`);
});

Deno.test("no postcode claims two states", () => {
  // The whole feature rests on this. If one code sat in two states the derivation would be a coin toss,
  // and the form would confidently file the wrong one.
  const owner: Record<string, string> = {};
  const clashes: string[] = [];
  for (const [state, cities] of Object.entries(MY_POSTCODES as Record<string, Record<string, string>>)) {
    for (const list of Object.values(cities)) {
      for (const p of list.split(" ")) {
        if (owner[p] && owner[p] !== state) clashes.push(`${p}: ${owner[p]} and ${state}`);
        owner[p] = state;
      }
    }
  }
  assertEquals(clashes, []);
});

/* ── The form's own decision — app.html's infoPostcode() ────────────────────────────────────────── */

Deno.test("opening the form fills the dropdown and CHANGES NOTHING ELSE", () => {
  // The dangerous direction. A stored address is what is filed with SSM; rewriting a field because a
  // page rendered is a change nobody made and nobody sees. Driven through the real function against a
  // stub DOM, so the guard is on the code the browser runs.
  const dom = mkForm({ reg_postcode: "10300", reg_city: "George Town", reg_state: "Melaka" });
  dom.run(false);
  assertEquals(dom.value("reg_state"), "Melaka", "an OPEN rewrote the stored state");
  assertEquals(dom.value("reg_city"), "George Town", "an OPEN rewrote the stored city");
  assertEquals(dom.options(), ["Pulau Pinang"], "the dropdown was not filled on open");
});

Deno.test("typing a postcode sets the state and offers the city", () => {
  const dom = mkForm({ reg_postcode: "47301", reg_city: "", reg_state: "" });
  dom.run(true);
  assertEquals(dom.value("reg_state"), "Selangor");
  assertEquals(dom.value("reg_city"), "Petaling Jaya", "a postcode with ONE locality fills the empty city");
  assertEquals(dom.options(), ["Petaling Jaya"]);
});

Deno.test("a city the operator already has is never overwritten", () => {
  // 10300's postal locality is "Pulau Pinang". SKINDAE's own record says "George Town", which is the
  // better answer and is not ours to replace.
  const dom = mkForm({ reg_postcode: "10300", reg_city: "George Town", reg_state: "" });
  dom.run(true);
  assertEquals(dom.value("reg_state"), "Pulau Pinang", "the state is still derived");
  assertEquals(dom.value("reg_city"), "George Town", "the typed city was replaced by the postal locality");
});

Deno.test("a postcode serving several localities offers them and picks none", () => {
  const many = Object.keys(indexCities()).find((p) => indexCities()[p].length > 1);
  assertEquals(typeof many, "string", "no multi-locality postcode found to test with");
  const dom = mkForm({ reg_postcode: many!, reg_city: "", reg_state: "" });
  dom.run(true);
  assertEquals(dom.value("reg_city"), "", "guessing one of several localities presents a guess as a fact");
  assertEquals(dom.options().length > 1, true);
});

Deno.test("an unknown postcode changes nothing and clears the stale dropdown", () => {
  const dom = mkForm({ reg_postcode: "00000", reg_city: "Ipoh", reg_state: "Perak" });
  dom.run(true);
  assertEquals(dom.value("reg_state"), "Perak");
  assertEquals(dom.value("reg_city"), "Ipoh");
  assertEquals(dom.options(), [], "a stale city list would offer another postcode's answer");
});

Deno.test("a state the dropdown does not offer is NOT set — it would blank the field", () => {
  // Guard the guard: the same postcode against a <select> missing that option must leave the field as
  // it was, rather than assigning a value no option matches (which selects nothing at all).
  const dom = mkForm({ reg_postcode: "47301", reg_city: "", reg_state: "Johor" }, ["Johor", "Melaka"]);
  dom.run(true);
  assertEquals(dom.value("reg_state"), "Johor", "the state was set to an option that does not exist");
});

// deno-lint-ignore no-explicit-any
let CITY_INDEX: Record<string, string[]> | null = null;
function indexCities(): Record<string, string[]> {
  if (CITY_INDEX) return CITY_INDEX;
  const ix: Record<string, string[]> = {};
  for (const cities of Object.values(MY_POSTCODES as Record<string, Record<string, string>>)) {
    for (const [city, list] of Object.entries(cities)) {
      for (const p of list.split(" ")) (ix[p] ??= []).push(city);
    }
  }
  return (CITY_INDEX = ix);
}

/**
 * A stub of just enough DOM for app.html's `infoPostcode()` — the real function, extracted from the
 * shipped file, so these assertions are about the code the browser runs and not a re-description of it.
 */
function mkForm(vals: Record<string, string>, stateOptions = ["", ...Object.keys(MY_POSTCODES).sort()]) {
  const fields: Record<string, { value: string; options?: { value: string }[] }> = {};
  for (const [k, v] of Object.entries(vals)) fields[k] = { value: v };
  fields.reg_state.options = stateOptions.map((value) => ({ value }));
  const pcEl = {
    value: vals.reg_postcode,
    getAttribute: (a: string) => (a === "data-city" ? "reg_city" : a === "data-state" ? "reg_state" : null),
  };
  const datalist = { innerHTML: "" };
  const doc = {
    getElementById: (id: string) => (id === "dl_reg_city" ? datalist : null),
    querySelector: (sel: string) => {
      const m = /\[data-k="([^"]+)"\]/.exec(sel);
      return m ? (fields[m[1]] ?? null) : null;
    },
  };
  const fn = new Function(
    "document",
    "esc",
    "myPostcodeFind",
    "el",
    fnSource(appSrc, "infoPostcode") + "\nreturn function(typed){ infoPostcode(el, typed); };",
  )(doc, (s: string) => String(s), myPostcodeFind, pcEl);
  return {
    run: (typed: boolean) => fn(typed),
    value: (k: string) => fields[k].value,
    options: () => [...datalist.innerHTML.matchAll(/value="([^"]*)"/g)].map((m) => m[1]),
  };
}
