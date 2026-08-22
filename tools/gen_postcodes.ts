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

/**
 * THE state list — LHDN/IRBM e-Invoice state codes, https://sdk.myinvois.hasil.gov.my/codes/state-codes/
 * verbatim, in their code order. This is the Malaysian government's own list of state names, which is
 * what a form that also holds a MyInvois TIN should be spelling.
 *
 * It is TYPED HERE, not derived from the postcode dataset: the dataset is a third party's convenience
 * spelling ("Wp Kuala Lumpur", "Pulau Pinang"), and reference data that ends up on a filed document is
 * not something to infer from whatever an upstream JSON happened to call it. The mapping below is the
 * bridge, and the run aborts if the dataset ever names a state this list does not.
 *
 * Code 17 "Not Applicable" is deliberately absent: it exists for a NON-Malaysian address, and every
 * company on this form is a Sdn Bhd. Add it the day the form has to hold a foreign registered office.
 */
const STATES: [string, string][] = [
  ["01", "Johor"],
  ["02", "Kedah"],
  ["03", "Kelantan"],
  ["04", "Melaka"],
  ["05", "Negeri Sembilan"],
  ["06", "Pahang"],
  ["07", "Pulau Pinang"],
  ["08", "Perak"],
  ["09", "Perlis"],
  ["10", "Selangor"],
  ["11", "Terengganu"],
  ["12", "Sabah"],
  ["13", "Sarawak"],
  ["14", "Wilayah Persekutuan Kuala Lumpur"],
  ["15", "Wilayah Persekutuan Labuan"],
  ["16", "Wilayah Persekutuan Putrajaya"],
];

/** The upstream dataset's spelling -> the official one. Anything not named here is already official. */
const STATE_NAME: Record<string, string> = {
  "Wp Kuala Lumpur": "Wilayah Persekutuan Kuala Lumpur",
  "Wp Labuan": "Wilayah Persekutuan Labuan",
  "Wp Putrajaya": "Wilayah Persekutuan Putrajaya",
};

/**
 * Every OTHER spelling that must still resolve — because renaming the dropdown's options does not
 * rename what is already in the database, and a stored value with no matching <option> selects NOTHING.
 * `Pinang` is the one that matters today: it is what the portal called Penang until now, it is not a
 * Malaysian state name, and SKINDAE's registered office is stored under it.
 *
 * Matching is on letters and digits only, lower-cased, so "W.P. Kuala Lumpur", "WP KUALA LUMPUR" and
 * "wpkualalumpur" all arrive at the same key and do not need listing separately.
 */
const ALIASES: Record<string, string> = {
  "pinang": "Pulau Pinang",
  "penang": "Pulau Pinang",
  "ppinang": "Pulau Pinang",
  "malacca": "Melaka",
  "negrisembilan": "Negeri Sembilan",
  "trengganu": "Terengganu",
  "kualalumpur": "Wilayah Persekutuan Kuala Lumpur",
  "kl": "Wilayah Persekutuan Kuala Lumpur",
  "wpkualalumpur": "Wilayah Persekutuan Kuala Lumpur",
  "wilayahpersekutuan": "Wilayah Persekutuan Kuala Lumpur",
  "labuan": "Wilayah Persekutuan Labuan",
  "wplabuan": "Wilayah Persekutuan Labuan",
  "putrajaya": "Wilayah Persekutuan Putrajaya",
  "wpputrajaya": "Wilayah Persekutuan Putrajaya",
};

/** postcode -> [state, city]. Not negotiable; a miss aborts the run. */
const ANCHORS: Record<string, [string, string]> = {
  "01000": ["Perlis", "Kangar"],
  "05000": ["Kedah", "Alor Setar"],
  "10300": ["Pulau Pinang", "Pulau Pinang"],    // SKINDAE's own registered office
  "15000": ["Kelantan", "Kota Bharu"],
  "20000": ["Terengganu", "Kuala Terengganu"],
  "25000": ["Pahang", "Kuantan"],
  "30000": ["Perak", "Ipoh"],
  "39000": ["Pahang", "Tanah Rata"],            // Cameron Highlands sits in a 39xxx block, not Perak's
  "47301": ["Selangor", "Petaling Jaya"],
  "49000": ["Pahang", "Bukit Fraser"],          // 49xxx and 69xxx are Pahang islands inside other blocks
  "50000": ["Wilayah Persekutuan Kuala Lumpur", "Kuala Lumpur"],
  "62000": ["Wilayah Persekutuan Putrajaya", "Putrajaya"],
  "63000": ["Selangor", "Cyberjaya"],
  "68100": ["Selangor", "Batu Caves"],
  "69000": ["Pahang", "Genting Highlands"],
  "70000": ["Negeri Sembilan", "Seremban"],
  "75000": ["Melaka", "Melaka"],
  "80000": ["Johor", "Johor Bahru"],
  "87000": ["Wilayah Persekutuan Labuan", "Labuan"],
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

// The dataset and the official list must name the SAME sixteen states. A state on one side only means
// either an unmapped upstream spelling (postcodes that can never resolve) or a dropdown option no
// postcode reaches — and the second is how an operator ends up typing a state name by hand again.
{
  const official = STATES.map(([, n]) => n).sort();
  const extra = states.filter((s) => !official.includes(s));
  const missing = official.filter((s) => !states.includes(s));
  if (extra.length) throw new Error(`dataset names states the official list does not: ${extra.join(", ")}`);
  if (missing.length) throw new Error(`no postcode maps to: ${missing.join(", ")}`);
}
// An alias must resolve to a real state, and must not shadow one. "Selangor" as an alias of anything
// would quietly redirect a correct value.
for (const [k, v] of Object.entries(ALIASES)) {
  if (!STATES.some(([, n]) => n === v)) throw new Error(`alias "${k}" points at "${v}", which is not a state`);
  if (STATES.some(([, n]) => n.toLowerCase().replace(/[^a-z0-9]/g, "") === k)) {
    throw new Error(`alias "${k}" shadows an official state name`);
  }
}

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
// the whole answer: Pulau Pinang, and one city to confirm. Before this, the operator picked all three by
// hand on a form that is filed with SSM, where a postcode and a state that disagree is a defect in a
// statutory record.
//
// THE STATE NAMES ARE LHDN's — the IRBM e-Invoice state-code table, verbatim, in its code order:
// https://sdk.myinvois.hasil.gov.my/codes/state-codes/ . This form also holds a MyInvois TIN, so the
// government's own spelling is the one it should carry. The portal previously offered "Pinang", which
// is not a Malaysian state name at all.
//
// Renaming an option does NOT rename what is already stored, and a stored value matching no <option>
// selects NOTHING — the field reads as unfilled. myStateName() is what stops that: every historical and
// colloquial spelling still resolves, so an old record displays correctly and is written back official
// the next time it is saved.
//
// GENERATED by tools/gen_postcodes.ts — do not hand-edit; run that and commit the diff.
//   source   ${SOURCE}
//   contains ${codes.length} postcodes across ${cityCount} localities in ${states.length} states
//
// The city names are Pos Malaysia's POSTAL localities, which are not always the name a person would
// write: 10300 is "Pulau Pinang", not "George Town". So these are OFFERED, never forced — see
// myPostcodeFind()'s callers, which fill an EMPTY city and otherwise only populate the dropdown.
//
// The upstream dataset's "Wp ..." spellings are mapped to the official ones at generation time, and the
// generator refuses to write unless the dataset and MY_STATES name exactly the same sixteen states.

/** The dropdown, in IRBM code order. 13 states then the 3 federal territories. */
var MY_STATES = ${JSON.stringify(STATES.map(([, n]) => n), null, 2).replace(/\n/g, "\n")};

/** The IRBM e-Invoice code for each state, for the day an e-invoice needs one. */
var MY_STATE_CODE = {
${STATES.map(([c, n]) => `  ${JSON.stringify(n)}: ${JSON.stringify(c)},`).join("\n")}
};

/** Historical and colloquial spellings -> the official name. Keys are letters and digits only. */
var MY_STATE_ALIASES = {
${Object.entries(ALIASES).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n")}
};

/**
 * The official state name for anything an operator or an old record might hold, or '' if unrecognised.
 *
 * '' rather than the input, deliberately: the caller is choosing a <select> option, and echoing back an
 * unknown string would set the field to a value no option matches — which selects NOTHING and reads on
 * screen as "the operator did not fill this in".
 */
function myStateName(s){
  var k = String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!k) return '';
  for (var i = 0; i < MY_STATES.length; i++) {
    if (MY_STATES[i].toLowerCase().replace(/[^a-z0-9]/g, '') === k) return MY_STATES[i];
  }
  return MY_STATE_ALIASES[k] || '';
}

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
  MY_POSTCODES: MY_POSTCODES, myPostcodeFind: myPostcodeFind,
  MY_STATES: MY_STATES, MY_STATE_CODE: MY_STATE_CODE, MY_STATE_ALIASES: MY_STATE_ALIASES,
  myStateName: myStateName
};
`;

await Deno.writeTextFile(new URL("../postcode.js", import.meta.url), out);
console.log(`postcode.js written — ${codes.length} postcodes, ${cityCount} localities, ${states.length} states`);
console.log(`anchors verified: ${Object.keys(ANCHORS).length}`);
