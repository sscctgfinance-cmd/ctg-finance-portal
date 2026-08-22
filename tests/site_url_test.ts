// The site's public address is ONE value, declared in three places because three runtimes hold it and
// none of them can import from another: common.js (the browser half of the legacy apps),
// supabase/functions/portal/hr.ts (the five emails staff reach the app by) and
// supabase/functions/ctg-sso/index.ts (the sign-in redirect allow-list). A `_shared/` module cannot
// collapse the last two: it would sit outside deploy-supabase-portal.yml's `paths:` trigger, so a
// change to it would ship silently late — the exact failure that file's own comment warns about.
//
// So this file is what makes "one constant" mean something. It:
//   1. EVALUATES each declaration and requires the three to agree,
//   2. requires every URL derived from them to be ABSOLUTE (these travel by email; a relative path in
//      a mail client resolves against nothing),
//   3. pins each of the five emails to the constant it must use — a clock reminder pointing at app.html
//      is a working absolute URL and still the wrong screen, and
//   4. fails if a FOURTH hardcoded copy of the host appears anywhere in the shipped source. That is the
//      guard the consolidation exists for: the sixth edit nobody makes during a cutover is the one in
//      an email template nobody opens for a week.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (p: string) => Deno.readTextFile(new URL("../" + p, import.meta.url));

/** The source line declaring `const NAME = …;`, verbatim. */
function declLine(src: string, name: string): string {
  const m = src.match(new RegExp("^[ \\t]*(?:export[ \\t]+)?const[ \\t]+" + name + "[ \\t]*=.*$", "m"));
  if (!m) throw new Error("no `const " + name + " = …` declaration found");
  return m[0];
}

/** Evaluate those declarations for real, so a concatenation that lost a `/` is a failing value. */
async function evalConsts(src: string, names: string[]): Promise<Record<string, string>> {
  const body = names.map((n) => declLine(src, n).replace(/^\s*export\s+/, "")).join("\n") +
    "\nexport { " + names.join(", ") + " };";
  return await import("data:application/typescript," + encodeURIComponent(body)) as Record<string, string>;
}

const COMMON = await read("common.js");
const HR = await read("supabase/functions/portal/hr.ts");
const SSO = await read("supabase/functions/ctg-sso/index.ts");

Deno.test("the three declarations are ONE value", async () => {
  const browser = (await evalConsts(COMMON, ["SITE_URL"])).SITE_URL;
  const portal = (await evalConsts(HR, ["SITE_URL"])).SITE_URL;
  const sso = (await evalConsts(SSO, ["SITE_URL"])).SITE_URL;
  assertEquals(portal, browser, "portal/hr.ts and common.js disagree about where the site is");
  assertEquals(sso, browser, "ctg-sso and common.js disagree about where the site is");
  // Shape: an absolute origin with no trailing slash, because every use appends "/page.html".
  assert(/^https:\/\/[a-z0-9.\-\/]+$/.test(browser), "not a plain https URL: " + browser);
  assert(!browser.endsWith("/"), "SITE_URL must not end in a slash — every use appends one: " + browser);
});

Deno.test("every URL the emails carry is absolute, and points where it says", async () => {
  const c = await evalConsts(HR, ["SITE_URL", "HROS_URL", "APP_URL", "CLOCK_URL"]);
  assertEquals(c.HROS_URL, c.SITE_URL + "/hros.html");
  assertEquals(c.APP_URL, c.SITE_URL + "/app.html");
  assertEquals(c.CLOCK_URL, c.SITE_URL + "/hros.html#clock");
  for (const [k, v] of Object.entries(c)) {
    assert(v.startsWith("https://"), k + " is not absolute: " + v);
    // A lost separator ("…portalhros.html") is still absolute and still broken.
    assert(!/[^:]\/\//.test(v.slice(8)), k + " has a doubled slash: " + v);
    assert(!/\.com[a-z]/.test(v) && !/portalhros|portalapp/.test(v), k + " lost its path separator: " + v);
  }
});

// Each of the five. The anchor is the email's own wording, so a link moved to another mail fails here.
const EMAIL_SITES: [string, string, string][] = [
  ["leave approvals", "Approve / reject in HR OS → Leave:", "HROS_URL"],
  ["claim approvals", "Or log in to HR OS → Reimbursement → Pending:", "HROS_URL"],
  ["employee credentials", "b.login_url", "HROS_URL"],
  ["admin credentials", "const portalUrl", "APP_URL"],
  ["clock reminders", "const clkBase", "CLOCK_URL"],
];

Deno.test("each of the five emails is wired to the right constant", () => {
  for (const [what, anchor, want] of EMAIL_SITES) {
    const line = HR.split("\n").find((l) => l.includes(anchor));
    assert(line, what + ": anchor " + JSON.stringify(anchor) + " is gone from hr.ts");
    assertStringIncludes(line!, want, what + " no longer uses " + want);
    for (const other of ["SITE_URL", "HROS_URL", "APP_URL", "CLOCK_URL"]) {
      if (other === want) continue;
      assert(!new RegExp("\\b" + other + "\\b").test(line!), what + " also mentions " + other);
    }
  }
});

Deno.test("the credential emails actually put the URL in the body", () => {
  // hr_send_logins builds its body by concatenation, so the constant existing proves nothing on its own.
  assertStringIncludes(HR, '"Portal: "+loginUrl+"\\n"');
  assertStringIncludes(HR, '"网址："+loginUrl+"\\n"');
  // ...and the clock reminder's two bodies each embed theirs.
  assertEquals(HR.split("clkBase").length - 1, 3, "expected clkBase declared once and used in both reminder bodies");
});

Deno.test("the browser half references the constant rather than spelling the host", async () => {
  // hrShowCreds() (hros.html) prints the sign-in address on the one-time password sheet an admin hands
  // out. No golden holds it — the modal is appended to document.body — so this is where it is pinned.
  const hros = await read("hros.html");
  assertStringIncludes(hros, "var url=SITE_URL+'/hros.html';");
});

Deno.test("ctg-sso's redirect allow-list is built from the constant, not from a literal", async () => {
  for (const app of ["hros.html", "app.html", "index.html"]) {
    assertStringIncludes(SSO, "${SITE_URL}/" + app);
  }
  const { SITE_URL } = await evalConsts(SSO, ["SITE_URL"]);
  assert(SITE_URL.startsWith("https://"), "an SSO redirect target must be absolute: " + SITE_URL);
});

Deno.test("no FOURTH copy of the host is hardcoded anywhere in the shipped source", async () => {
  // NOT scanned: cutover/old-origin/forward.html. It is served from the OLD origin and deployed by hand
  // into the `publish` repo, so it cannot import this constant from anywhere and must name both hosts
  // literally. tests/forwarding_page_test.ts is what pins that file.
  const files = [
    "common.js", "hros.html", "app.html", "index.html", "sw.js", "manifest.json", "vercel.json",
    "payroll.js", "hr-docs.js", "wht.js", "o2o.js", "salesrecon.js", "gateway.js", "pnl.js", "ap.js",
    "supabase/functions/portal/index.ts", "supabase/functions/portal/lib.ts",
    "supabase/functions/portal/hr.ts", "supabase/functions/portal/finance.ts",
    "supabase/functions/ctg-sso/index.ts",
  ];
  files.push(...await walk("web/src"), ...await walk("web/app"));

  const host = (await evalConsts(COMMON, ["SITE_URL"])).SITE_URL.replace(/^https:\/\//, "");
  // Both the current address and the one being moved away from: an edit that re-pastes the old Pages
  // URL into a new email is the same defect as one that re-pastes the new one.
  const needles = [host, "sscctgfinance-cmd.github.io"];
  const offenders: string[] = [];
  for (const f of files) {
    const src = await read(f);
    src.split("\n").forEach((line, i) => {
      if (!needles.some((n) => line.includes(n))) return;
      if (/^[ \t]*(?:export[ \t]+)?const[ \t]+SITE_URL[ \t]*=/.test(line)) return; // the three declarations
      offenders.push(f + ":" + (i + 1) + " " + line.trim().slice(0, 100));
    });
  }
  assertEquals(offenders, [], "the host is hardcoded outside the SITE_URL declarations:\n" + offenders.join("\n"));
});

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const e of Deno.readDir(new URL("../" + dir, import.meta.url))) {
    if (e.isDirectory) out.push(...await walk(dir + "/" + e.name));
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(dir + "/" + e.name);
  }
  return out;
}
