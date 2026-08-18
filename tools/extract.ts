// Pull named top-level declarations out of hros.html / the portal edge function so the payroll engines can be
// exercised in a test without a browser, a DOM, or a build step.
//
// Why by name and not "just import the file": both are single-file apps. hros.html is one 5,000-line
// inline <script> full of DOM code, and the backend engine ships in a module that opens a Supabase client at import. The
// statutory engine inside each is pure, so we lift exactly those symbols and nothing else.

const BS = "\\";
const QUOTES = ['"', "'", "`"];

/** Keywords after which a `/` starts a regex literal rather than a division. */
const REGEX_KEYWORDS = [
  "return", "typeof", "case", "in", "of", "do", "else", "void", "delete", "instanceof", "new", "yield",
  "throw", "await",
];

/** True when the `/` at index k opens a regex literal rather than being a division operator. */
function regexStartsHere(s: string, k: number): boolean {
  let j = k - 1;
  while (j >= 0 && /\s/.test(s[j])) j--;
  if (j < 0) return true;                                  // start of input
  if (/[({[,;:!?&|=+\-*%<>~^]/.test(s[j])) return true;    // after an operator or opener
  if (!/[A-Za-z_$]/.test(s[j])) return false;              // after ) ] . digit → division
  let i = j;                                               // collect the identifier / keyword
  while (i >= 0 && /[A-Za-z_$0-9]/.test(s[i])) i--;
  return REGEX_KEYWORDS.indexOf(s.slice(i + 1, j + 1)) >= 0;
}

/**
 * Index of the brace/bracket that closes the one at `open`, skipping strings, comments and regex literals.
 *
 * Regex literals must be skipped as a unit, not scanned character by character: hrCsv contains
 * `/[",\r\n]/`, whose `"` was read as the start of a string, which then swallowed the rest of the file and
 * failed with "unbalanced". A regex can only appear where a value can, so the character before it decides —
 * after an operator, `(`, `,`, `[`, `{`, `;`, `:`, `!`, `?`, `&`, `|`, `=`, `return` etc. it is a regex;
 * after an identifier, `)`, `]` or a literal it is division.
 */
function closeIdx(s: string, open: number): number {
  const openCh = s[open];
  const closeCh = openCh === "{" ? "}" : openCh === "[" ? "]" : ")";
  let depth = 1;
  let k = open + 1;
  while (depth > 0) {
    if (k >= s.length) throw new Error("unbalanced from index " + open);
    const c = s[k];
    if (QUOTES.includes(c)) {
      const q = c; k++;
      while (s[k] !== q) k += s[k] === BS ? 2 : 1;
      k++; continue;
    }
    if (c === "/" && s[k + 1] === "/") { k = s.indexOf("\n", k); if (k < 0) k = s.length; continue; }
    if (c === "/" && s[k + 1] === "*") { k = s.indexOf("*/", k) + 2; continue; }
    if (c === "/" && regexStartsHere(s, k)) {
      k++;                                   // past the opening slash
      let inClass = false;
      while (k < s.length) {
        const d = s[k];
        if (d === BS) { k += 2; continue; }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) { k++; break; }
        else if (d === "\n") break;          // not a regex after all — bail rather than run away
        k++;
      }
      while (/[a-z]/.test(s[k] || "")) k++;  // flags
      continue;
    }
    if (c === openCh) depth++;
    else if (c === closeCh) depth--;
    k++;
  }
  return k - 1;
}

/**
 * Source text of `function NAME(...){...}` — or `async function NAME(...)` — at column 0.
 *
 * The `async` form was not matched at all, which quietly put every async top-level function out of reach
 * of the tests: hrFinalise, hrGridSave, hrGRowResign and the rest of the save/submit paths. "Function not
 * found" reads like a rename, not like a gap in the extractor, so it was easy to shrug at.
 */
export function fnSource(src: string, name: string): string {
  // `export ` is optional: the backend engine lives in a module that exports its symbols, the
  // frontend one in an inline <script> that does not. The slice starts AFTER the keyword either
  // way, so what comes back is always a bare declaration the caller can re-export itself.
  const re = new RegExp("^(export\\s+)?(?:async\\s+)?function\\s+" + name + "\\s*\\(", "m");
  const m = re.exec(src);
  if (!m) throw new Error("function not found: " + name);
  const start = m.index + (m[1] ? m[1].length : 0);
  const paren = src.indexOf("(", start);
  const bodyOpen = src.indexOf("{", closeIdx(src, paren));
  return src.slice(start, closeIdx(src, bodyOpen) + 1);
}

/** Source text of a `var NAME=[...]` / `const NAME:T=[...]` array literal at column 0. */
export function arrSource(src: string, name: string): string {
  const re = new RegExp("^(?:export\\s+)?(?:var|const)\\s+" + name + "\\s*(?::[^=]+)?=\\s*\\[", "m");
  const m = re.exec(src);
  if (!m) throw new Error("array not found: " + name);
  // The regex ends at the literal's own "[", so use the match end — indexOf("[") would find the "[" inside
  // the backend's `:[number,number,number][]` type annotation instead of the array.
  const open = m.index + m[0].length - 1;
  return "const " + name + " = " + src.slice(open, closeIdx(src, open) + 1) + ";";
}

/**
 * The script a page actually runs: common.js (shared by both apps, loaded first) plus the inline
 * <script> bodies.
 *
 * common.js has to be included or render_smoke_test would stop seeing the class of bug it exists for:
 * toast/call/storage* now live there, so evaluating the inline script alone would make them undeclared
 * and a ReferenceError in a renderer would read as "the browser will be fine".
 */
export function inlineScript(html: string): string {
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!blocks.length) throw new Error("no inline <script> found");
  const common = Deno.readTextFileSync(new URL("../common.js", import.meta.url));
  return common + "\n;\n" + blocks.join("\n;\n");
}

export const FRONTEND_ENGINE = [
  "myStatLookup", "myPcbRoundUp5", "myServiceMonths", "myLindung24", "myLindungActive",
  "hrRoundUp", "hrRound2", "hrRound5", "hrBandMid",
  "hrEpfParts", "hrTableParts", "hrProgTax", "hrAge", "hrCompute",
];
export const FRONTEND_TABLES = ["MY_SOCSO_CAT1", "MY_SOCSO_CAT2", "MY_EIS", "HR_TAX_BANDS"];

export const BACKEND_ENGINE = [
  "myStatLookup", "myPcbRoundUp5", "myServiceMonths", "myLindung24", "myLindungActive",
  "payRoundUp", "payRound2", "payRound5", "payBandMid",
  "payEpfParts", "payTableParts", "payProgTax", "payAge", "computePayrollMY",
];
export const BACKEND_TABLES = ["MY_SOCSO_CAT1", "MY_SOCSO_CAT2", "MY_EIS", "MY_DEFAULT_TAX_BANDS"];

/** Build a runnable module exposing the named symbols, then import it. */
export async function loadEngine(
  src: string,
  fns: string[],
  tables: string[],
  exposed: string[],
  // Extra source prepended to the module. Needed for functions that read app-level globals rather than
  // taking them as arguments — hrCalcCompute reads HR_CALC and HR — so a test can stand those up without
  // test-only hooks having to exist in the shipped app.
  prelude?: string,
): Promise<Record<string, unknown>> {
  const parts = [
    ...(prelude ? [prelude] : []),
    ...tables.map((t) => arrSource(src, t)),
    // No annotation stripping: the module is served as TypeScript, so the backend's `adj:any[]` is valid
    // as-is and the frontend's plain JS is valid TypeScript too. (Stripping by regex turned `tbl:any[]`
    // into `tbl:` and broke the parse.)
    ...fns.map((f) => fnSource(src, f)),
    "export { " + exposed.join(", ") + " };",
  ];
  const url = "data:application/typescript," + encodeURIComponent(parts.join("\n"));
  return await import(url);
}
