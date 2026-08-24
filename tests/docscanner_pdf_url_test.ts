// `DocScanner`'s lazy jsPDF loader must resolve the vendored build from ANY page depth.
//
// WHY THIS FILE EXISTS: `s.src = './jspdf.umd.min.js'` is resolved against the DOCUMENT, not against
// common.js. app.html and hros.html are files at the root, so it was correct there and nothing ever
// caught it — but the React routes are directories (`trailingSlash: true`, web/next.config.mjs), so
// from /finance/upload/ the browser asked for /finance/upload/jspdf.umd.min.js and got a 404.
// `buildPdf()` runs on EVERY completed scan and common.js swallows the rejection into
// `toast('Failed to build document')` + `close()`: the overlay shuts, no file appears, the page looks
// fine. Nothing else in this repo can see it. The render goldens capture a screen at t=0 and never
// press a button; `vercel.json` has no rewrites, so production behaves exactly like the local build;
// and it is the only relative asset path in any shared root `.js`, so no sweep was looking for it.
//
// The loader is INSIDE the DocScanner IIFE, so tools/extract.ts's `fnSource()` cannot reach it — that
// one anchors at column 0. It is sliced out by name here and driven with a stub document, once per
// world common.js is loaded in.

import { assert, assertEquals } from "jsr:@std/assert@1";

const SRC = await Deno.readTextFile("common.js");

/** The source of an INDENTED `function NAME(` plus its body, by brace matching. */
function indentedFn(src: string, name: string): string {
  const i = src.indexOf("function " + name + "(");
  assert(i > -1, "function not found: " + name);
  let depth = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}" && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error("unbalanced: " + name);
}

/** The `const SELF_URL = …` line, so what is driven is the real expression and not a retyped one. */
function selfUrlLine(src: string): string {
  const m = /^\s*const SELF_URL\s*=.*$/m.exec(src);
  assert(m, "SELF_URL not found in common.js — the loader stopped resolving against its own script");
  return m[0].trim();
}

/**
 * Runs common.js's own `loadJsPDF()` with common.js loaded from `scriptSrc`, and returns the URL the
 * injected <script> would fetch. Everything driven here is text lifted out of common.js.
 */
function injectedSrc(scriptSrc: string | null): string {
  const el: Record<string, unknown> = {};
  const document = {
    currentScript: scriptSrc ? { src: scriptSrc } : null,
    createElement: () => el,
    head: { appendChild() {} },
  };
  const window = {} as Record<string, unknown>;
  const body = `
    ${selfUrlLine(SRC)}
    let jspdfLoading = null;
    ${indentedFn(SRC, "loadJsPDF")}
    loadJsPDF();
    return SELF_URL;
  `;
  new Function("document", "window", body)(document, window);
  return String(el.src);
}

Deno.test("the scanner's PDF engine resolves from a NESTED React route, not relative to the page", () => {
  // The exact failure: /finance/upload/jspdf.umd.min.js and /finance/ocr/jspdf.umd.min.js are 404s.
  for (const route of ["finance/upload", "finance/ocr"]) {
    const got = injectedSrc(`https://os.ctg4u.com/${route}/../../common.js`);
    assertEquals(got, "https://os.ctg4u.com/jspdf.umd.min.js");
  }
  // And as the routes actually load it — legacyUrl() gives common.js the deployment's own prefix, so
  // the sibling resolves beside THAT, wherever it is. A page-relative src cannot produce either line.
  assertEquals(
    injectedSrc("https://os.ctg4u.com/common.js"),
    "https://os.ctg4u.com/jspdf.umd.min.js",
  );
  assertEquals(
    injectedSrc("https://example.test/base/common.js"),
    "https://example.test/base/jspdf.umd.min.js",
  );
});

Deno.test("both legacy apps still fetch the root copy, byte for byte", () => {
  // app.html and hros.html each load `<script src="common.js">` from the root, so this is the URL the
  // live site has always fetched. The whole risk of this change is moving that.
  for (const page of ["app.html", "hros.html"]) {
    assertEquals(
      injectedSrc(`https://sscctgfinance-cmd.github.io/ctg-finance-portal/common.js`),
      "https://sscctgfinance-cmd.github.io/ctg-finance-portal/jspdf.umd.min.js",
      page,
    );
  }
  for (const page of ["app.html", "hros.html"]) {
    const html = Deno.readTextFileSync(page);
    assert(html.includes('<script src="common.js"></script>'), page + " no longer loads common.js");
  }
});

Deno.test("no shared root script asks for an asset relative to the DOCUMENT", () => {
  // The general form. `./x.js` and `'x.js'` in a `.src =` are both page-relative; a nested route makes
  // either one a 404. This is the sweep that was not being run.
  for (const f of [...Deno.readDirSync(".")].filter((e) => e.isFile && e.name.endsWith(".js"))) {
    if (f.name.endsWith(".min.js")) continue;   // vendored
    const src = Deno.readTextFileSync(f.name);
    const bad = [...src.matchAll(/\.src\s*=\s*(['"])(\.?\/?[\w.-]+\.(?:js|css|png))\1/g)]
      .filter((m) => !m[2].startsWith("/"));
    assertEquals(bad.map((m) => m[2]), [], f.name + " sets a page-relative asset src");
  }
});

Deno.test("the loader still memoises, so two scans share one download", () => {
  // Guard the guard: the URL change must not have moved the `jspdfLoading` early return, which is what
  // stops a second scan injecting a second tag (the same failure CLAUDE.md describes for gwLoadXlsx).
  const fn = indentedFn(SRC, "loadJsPDF");
  assert(fn.includes("if (jspdfLoading) return jspdfLoading;"), "the in-flight memo is gone");
  assert(fn.includes("window.jspdf && window.jspdf.jsPDF"), "the already-loaded check is gone");
});
