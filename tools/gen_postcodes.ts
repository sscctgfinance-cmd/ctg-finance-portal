// Regenerates postcode.js from the upstream Pos Malaysia dataset.
//
//   deno run -A tools/gen_postcodes.ts
//
// The data is BAKED IN, not fetched at runtime: the portal must fill an SSM address on a laptop with no
// network as readily as one with, and a third-party endpoint that goes away must not take the address
// form with it. This script is the provenance — run it to refresh, read the diff, commit it.
//
// It refuses to write a file that fails the anchor check below. Those postcodes are ones whose answer is
// not in doubt (the state capitals, the two federal territories, the company's own registered address),
// so a dataset that has been reshaped, truncated or had its state names renamed cannot land silently.
// tests/postcode_test.ts re-checks the same anchors against the COMMITTED file on every CI run.

const SOURCE = "https://raw.githubusercontent.com/AsyrafHussin/malaysia-postcodes/main/all.json";

/** Upstream names the federal territories "Wp X" and Penang by its full name; the portal's dropdown
 *  (MY_STATES, app.html) does not. Map into the portal's vocabulary or every lookup misses. */
const STATE_NAME: Record<string, string> = {
  "Wp Kuala Lumpur": "Kuala Lumpur",
  "Wp Labuan": "Labuan",
  "Wp Putrajaya": "Putrajaya",
  "Pulau Pinang": "Pinang",
};

/** postcode -> [state, city]. Not negotiable; a miss aborts the run. */
const ANCHORS: Record<string, [string, string]> = {
  "01000": ["Perlis", "Kangar"],
  "05000": ["Kedah", "Alor Setar"],
  "10300": ["Pinang", "Pulau Pinang"],          // SKINDAE's own registered office
  "15000": ["Kelantan", "Kota Bharu"],
  "20000": ["Terengganu", "Kuala Terengganu"],
  "25000": ["Pahang", "Kuantan"],
  "30000": ["Perak", "Ipoh"],
  "39000": ["Pahang", "Tanah Rata"],            // Cameron Highlands sits in a 39xxx block, not Perak's
  "47301": ["Selangor", "Petaling Jaya"],
  "49000": ["Pahang", "Bukit Fraser"],          // 49xxx and 69xxx are Pahang islands inside other blocks
  "50000": ["Kuala Lumpur", "Kuala Lumpur"],
  "62000": ["Putrajaya", "Putrajaya"],
  "63000": ["Selangor", "Cyberjaya"],
  "68100": ["Selangor", "Batu Caves"],
  "69000": ["Pahang", "Genting Highlands"],
  "70000": ["Negeri Sembilan", "Seremban"],
  "75000": ["Melaka", "Melaka"],
  "80000": ["Johor", "Johor Bahru"],
  "87000": ["Labuan", "Labuan"],
  "88000": ["Sabah", "Kota Kinabalu"],
  "93000": ["Sarawak", "Kuching"],
};

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE} -> HTTP ${res.status}`);
const raw = await res.json() as { state: { name: string; city: { name: string; postcode: string[] }[] }[] };

const byState: Record<string, Record<string, Set<string>>> = {};
const index: Record<string, [string, string][]> = {};
for (const s of raw.state) {
  const st = STATE_NAME[s.name] ?? s.name;
  for (const c of s.city) {
    for (const p of c.postcode) {
      if (!/^\d{5}$/.test(p)) continue;
      ((byState[st] ??= {})[c.name] ??= new Set()).add(p);
      (index[p] ??= []).push([st, c.name]);
    }
  }
}

const states = Object.keys(byState).sort();
const codes = Object.keys(index);
const cityCount = states.reduce((n, s) => n + Object.keys(byState[s]).length, 0);

// Sanity before anchors: a postcode belongs to exactly ONE state. If upstream ever breaks that, the
// state cannot be derived at all and the whole feature is a coin toss.
const split = codes.filter((p) => new Set(index[p].map((x) => x[0])).size > 1);
if (split.length) throw new Error(`${split.length} postcode(s) claim two states, e.g. ${split[0]}`);
if (states.length !== 16) throw new Error(`expected 16 states, got ${states.length}: ${states.join(", ")}`);
if (codes.length < 2500) throw new Error(`only ${codes.length} postcodes — the dataset looks truncated`);

const missed: string[] = [];
for (const [p, [st, city]] of Object.entries(ANCHORS)) {
  const got = index[p];
  if (!got || !got.some(([s, c]) => s === st && c === city)) {
    missed.push(`${p}: expected ${st}/${city}, got ${got ? JSON.stringify(got) : "nothing"}`);
  }
}
if (missed.length) throw new Error(`anchor check failed — NOT written:\n  ${missed.join("\n  ")}`);

const body = states.map((st) => {
  const cities = Object.keys(byState[st]).sort();
  return `  ${JSON.stringify(st)}: {\n` +
    cities.map((c) => `    ${JSON.stringify(c)}: ${JSON.stringify([...byState[st][c]].sort().join(" "))},`).join("\n") +
    `\n  },`;
}).join("\n");

const out = `// Malaysian postcodes, in ONE place — loaded by app.html, imported by web/.
// (Not hros.html: HR OS has no address form. Add the <script> tag there the day it grows one.)
//
// WHY: the state is NOT something anyone should be hunting for in a 16-item dropdown. A Malaysian
// postcode determines its state outright, and narrows the city to a handful, so typing 10300 is already
// the whole answer: Pinang, and one city to confirm. Before this, the operator picked all three by hand
// on a form that is filed with SSM, where a postcode and a state that disagree is a defect in a
// statutory record.
//
// GENERATED by tools/gen_postcodes.ts — do not hand-edit; run that and commit the diff.
//   source   ${SOURCE}
//   contains ${codes.length} postcodes across ${cityCount} localities in ${states.length} states
//
// The city names are Pos Malaysia's POSTAL localities, which are not always the name a person would
// write: 10300 is "Pulau Pinang", not "George Town". So these are OFFERED, never forced — see
// myPostcodeFind()'s callers, which fill an EMPTY city and otherwise only populate the dropdown.
//
// State names here are the portal's own (MY_STATES): "Pinang", "Kuala Lumpur", "Labuan", "Putrajaya" —
// upstream's "Pulau Pinang" / "Wp ..." are mapped at generation time, because a name that does not
// match the <select>'s options would set the field to nothing at all.

var MY_POSTCODES = {
${body}
};

/** Lazy reverse index. 2,900 entries is not worth building on a page that never opens the address form. */
var MY_POSTCODE_INDEX = null;
function myPostcodeIndex(){
  if (MY_POSTCODE_INDEX) return MY_POSTCODE_INDEX;
  var ix = {};
  for (var st in MY_POSTCODES) {
    for (var city in MY_POSTCODES[st]) {
      var list = MY_POSTCODES[st][city].split(' ');
      for (var i = 0; i < list.length; i++) {
        var e = ix[list[i]] || (ix[list[i]] = { state: st, cities: [] });
        if (e.cities.indexOf(city) < 0) e.cities.push(city);
      }
    }
  }
  for (var p in ix) ix[p].cities.sort();
  MY_POSTCODE_INDEX = ix;
  return ix;
}

/**
 * { state, cities[] } for a 5-digit Malaysian postcode, or null.
 *
 * null for anything that is not exactly five digits — including a PARTIAL one. Typing "103" on the way
 * to "10300" must not flip the state to whatever 103xx-something happens to match, and then flip again.
 */
function myPostcodeFind(pc){
  var s = String(pc == null ? '' : pc).trim();
  if (!/^\\d{5}$/.test(s)) return null;
  return myPostcodeIndex()[s] || null;
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
  MY_POSTCODES: MY_POSTCODES, myPostcodeFind: myPostcodeFind
};
`;

await Deno.writeTextFile(new URL("../postcode.js", import.meta.url), out);
console.log(`postcode.js written — ${codes.length} postcodes, ${cityCount} localities, ${states.length} states`);
console.log(`anchors verified: ${Object.keys(ANCHORS).length}`);
