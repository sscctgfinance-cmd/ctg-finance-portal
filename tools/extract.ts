// Pull named top-level declarations out of hros.html / portal_current.ts so the payroll engines can be
// exercised in a test without a browser, a DOM, or a build step.
//
// Why by name and not "just import the file": both are single-file apps. hros.html is one 5,000-line
// inline <script> full of DOM code, and portal_current.ts opens a Supabase client at module scope. The
// statutory engine inside each is pure, so we lift exactly those symbols and nothing else.

const BS = "\\";
const QUOTES = ['"', "'", "`"];

/** Index of the brace/bracket that closes the one at `open`, skipping strings, comments and regex-ish text. */
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
    if (c === openCh) depth++;
    else if (c === closeCh) depth--;
    k++;
  }
  return k - 1;
}

/** Source text of `function NAME(...){...}` at column 0. */
export function fnSource(src: string, name: string): string {
  const re = new RegExp("^function\\s+" + name + "\\s*\\(", "m");
  const m = re.exec(src);
  if (!m) throw new Error("function not found: " + name);
  const start = m.index;
  const paren = src.indexOf("(", start);
  const bodyOpen = src.indexOf("{", closeIdx(src, paren));
  return src.slice(start, closeIdx(src, bodyOpen) + 1);
}

/** Source text of a `var NAME=[...]` / `const NAME:T=[...]` array literal at column 0. */
export function arrSource(src: string, name: string): string {
  const re = new RegExp("^(?:var|const)\\s+" + name + "\\s*(?::[^=]+)?=\\s*\\[", "m");
  const m = re.exec(src);
  if (!m) throw new Error("array not found: " + name);
  // The regex ends at the literal's own "[", so use the match end — indexOf("[") would find the "[" inside
  // the backend's `:[number,number,number][]` type annotation instead of the array.
  const open = m.index + m[0].length - 1;
  return "const " + name + " = " + src.slice(open, closeIdx(src, open) + 1) + ";";
}

/** The single inline <script> body of an HTML file. */
export function inlineScript(html: string): string {
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!blocks.length) throw new Error("no inline <script> found");
  return blocks.join("\n;\n");
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
