// The forwarding page for the OLD address (cutover/old-origin/forward.html).
//
// WHY THIS FILE EXISTS: the page's visible job is a redirect, and a redirect is trivially observable.
// Its real job is the part nobody can see — unregistering the old service worker and unsubscribing
// push on every device that ever opened HR OS's Time Clock screen. sw.js's `install` calls
// skipWaiting() and `activate` calls clients.claim() (sw.js:6-7), so that worker stays alive and stays
// subscribed whether or not anyone visits, and hr_push_subscriptions has no origin column, so nothing
// on the server can tell a stale row from a live one. An unregister that silently no-ops therefore
// looks exactly like success and is undiscoverable afterwards: the affected devices never report back.
//
// So every test below drives the cleanup and asserts what it CALLED, not what the page rendered. The
// page is evaluated the way tests/render_golden_test.ts evaluates the apps — its own inline <script>,
// through tools/extract.ts — so it cannot drift from the file the captain deploys.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { inlineScript } from "../tools/extract.ts";

const PAGE = new URL("../cutover/old-origin/forward.html", import.meta.url);
const html = await Deno.readTextFile(PAGE);
const script = inlineScript(html);
/** The script with comments blanked — a source pin must not be satisfiable by a comment. */
const code = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// deno-lint-ignore no-explicit-any
type Any = any;

/** Evaluate the page's script and hand back its top-level functions. */
function load(): Any {
  const fn = new Function(script + "\n;return {ctgTarget,ctgToken,ctgReport,ctgCleanup,ctgGo,CTG_API,CTG_NEW_ORIGIN};");
  return fn();
}

// ---------------------------------------------------------------- fakes

interface SubOpts { endpoint?: string; unsubscribe?: () => Any }
function fakeSub(o: SubOpts = {}) {
  const calls: string[] = [];
  return {
    calls,
    endpoint: o.endpoint ?? "https://fcm.googleapis.com/fcm/send/AAA",
    unsubscribe() { calls.push("unsubscribe"); return o.unsubscribe ? o.unsubscribe() : Promise.resolve(true); },
  };
}

interface RegOpts { sub?: Any; unregister?: () => Any; noPushManager?: boolean }
function fakeReg(o: RegOpts = {}) {
  const calls: string[] = [];
  return {
    calls,
    sub: o.sub,
    pushManager: o.noPushManager ? undefined : {
      getSubscription: () => { calls.push("getSubscription"); return Promise.resolve(o.sub ?? null); },
    },
    unregister() { calls.push("unregister"); return o.unregister ? o.unregister() : Promise.resolve(true); },
  };
}

function fakeNav(regs: Any[], beacons: Any[] = []) {
  return {
    beacons,
    serviceWorker: { getRegistrations: () => Promise.resolve(regs) },
    sendBeacon(url: string, blob: Any) { beacons.push({ url, blob }); return true; },
  };
}

async function beaconBody(b: Any) { return JSON.parse(await b.blob.text()); }

// ---------------------------------------------------------------- the destination

Deno.test("the #tab= fragment survives, so an email link lands on ITS screen", () => {
  const { ctgTarget, CTG_NEW_ORIGIN } = load();
  assertEquals(
    ctgTarget({ pathname: "/ctg-finance-portal/app.html", search: "", hash: "#tab=wht" }, CTG_NEW_ORIGIN),
    "https://os.ctg4u.com/app.html#tab=wht",
  );
  // sw.js's notificationclick target and hrEmpBoot()'s landing fragment are bare, not tab=.
  assertEquals(
    ctgTarget({ pathname: "/ctg-finance-portal/hros.html", search: "", hash: "#clock" }, CTG_NEW_ORIGIN),
    "https://os.ctg4u.com/hros.html#clock",
  );
  // The SSO handoff rides the fragment too — dropping it silently breaks sign-in from CTG Portal.
  assertEquals(
    ctgTarget({ pathname: "/ctg-finance-portal/hros.html", search: "", hash: "#sso_token=abc123" }, CTG_NEW_ORIGIN),
    "https://os.ctg4u.com/hros.html#sso_token=abc123",
  );
});

Deno.test("the repo path prefix is stripped and the query is kept", () => {
  const { ctgTarget, CTG_NEW_ORIGIN } = load();
  // index.html is the logout destination in four places and carries ?idle=1.
  assertEquals(
    ctgTarget({ pathname: "/ctg-finance-portal/index.html", search: "?idle=1", hash: "" }, CTG_NEW_ORIGIN),
    "https://os.ctg4u.com/index.html?idle=1",
  );
  assertEquals(
    ctgTarget({ pathname: "/ctg-finance-portal/", search: "", hash: "" }, CTG_NEW_ORIGIN),
    "https://os.ctg4u.com/",
  );
});

Deno.test("an unknown path goes to the root, not to a made-up file on the new origin", () => {
  const { ctgTarget, CTG_NEW_ORIGIN } = load();
  // GitHub Pages serves /ctg-finance-portal (no slash) by redirecting, but if this file is ever also
  // used as 404.html the path can be anything, and 'ctg-finance-portal' is not a page over there.
  assertEquals(ctgTarget({ pathname: "/ctg-finance-portal", search: "", hash: "" }, CTG_NEW_ORIGIN), "https://os.ctg4u.com/");
  assertEquals(ctgTarget({ pathname: "/ctg-finance-portal/logo.png", search: "", hash: "" }, CTG_NEW_ORIGIN), "https://os.ctg4u.com/");
});

// ---------------------------------------------------------------- the cleanup

Deno.test("every registration is unregistered and every subscription unsubscribed", async () => {
  const { ctgCleanup, ctgReport } = load();
  const a = fakeReg({ sub: fakeSub({ endpoint: "ep-a" }) });
  const b = fakeReg({ sub: fakeSub({ endpoint: "ep-b" }) });
  const nav = fakeNav([a, b]);
  const out = await ctgCleanup(nav, ctgReport(nav, "tok"));

  assertEquals(out, { registrations: 2, unsubscribed: 2, reported: 2, unregistered: 2 });
  assert(a.calls.includes("unregister"), "registration A was never unregistered");
  assert(b.calls.includes("unregister"), "registration B was never unregistered");
  assert(a.sub.calls.includes("unsubscribe"), "subscription A was never unsubscribed");
  assert(b.sub.calls.includes("unsubscribe"), "subscription B was never unsubscribed");
});

Deno.test("a worker with NO push subscription is still unregistered", async () => {
  // The population that matters: someone who opened Time Clock, got the worker installed by
  // pushInitSW(), and never pressed Enable. There is nothing to unsubscribe and the whole cleanup
  // would look successful having done nothing.
  const { ctgCleanup, ctgReport } = load();
  const reg = fakeReg({ sub: null });
  const nav = fakeNav([reg]);
  const out = await ctgCleanup(nav, ctgReport(nav, "tok"));

  assertEquals(out.unsubscribed, 0);
  assertEquals(out.unregistered, 1);
  assert(reg.calls.includes("unregister"), "a subscription-less worker was left registered");
});

Deno.test("a failing unsubscribe does not stop the unregister, or the NEXT registration", async () => {
  const { ctgCleanup, ctgReport } = load();
  const bad = fakeReg({ sub: fakeSub({ endpoint: "ep-bad", unsubscribe: () => Promise.reject(new Error("boom")) }) });
  const good = fakeReg({ sub: fakeSub({ endpoint: "ep-good" }) });
  const nav = fakeNav([bad, good]);
  const out = await ctgCleanup(nav, ctgReport(nav, "tok"));

  assert(bad.calls.includes("unregister"), "a rejected unsubscribe left its worker registered");
  assert(good.calls.includes("unregister"), "one bad registration aborted the rest of the loop");
  assertEquals(out.registrations, 2);
  assertEquals(out.unregistered, 2);
});

Deno.test("a failing unregister does not abort the rest of the loop", async () => {
  const { ctgCleanup, ctgReport } = load();
  const bad = fakeReg({ sub: null, unregister: () => Promise.reject(new Error("boom")) });
  const good = fakeReg({ sub: fakeSub() });
  const nav = fakeNav([bad, good]);
  const out = await ctgCleanup(nav, ctgReport(nav, "tok"));

  assert(good.calls.includes("unregister"), "one rejected unregister aborted the rest of the loop");
  assertEquals(out.unregistered, 1);
});

Deno.test("a browser with no service worker support resolves cleanly rather than throwing", async () => {
  const { ctgCleanup, ctgReport } = load();
  const nav = { sendBeacon: () => true };
  const out = await ctgCleanup(nav, ctgReport(nav, "tok"));
  assertEquals(out.registrations, 0);
});

// ---------------------------------------------------------------- the server row

Deno.test("the endpoint is reported to push_unsubscribe, with the token, as a beacon", async () => {
  const { ctgCleanup, ctgReport, CTG_API } = load();
  const nav = fakeNav([fakeReg({ sub: fakeSub({ endpoint: "https://fcm.googleapis.com/fcm/send/ZZZ" }) })]);
  await ctgCleanup(nav, ctgReport(nav, "tok-42"));

  assertEquals(nav.beacons.length, 1);
  assertEquals(nav.beacons[0].url, CTG_API);
  assertEquals(await beaconBody(nav.beacons[0]), {
    api: "push_unsubscribe",           // hr.ts:1831 — anything else deletes no row
    token: "tok-42",                   // meFromToken(b.token); without it the handler 401s
    endpoint: "https://fcm.googleapis.com/fcm/send/ZZZ",
  });
});

Deno.test("the endpoint reported is the one that was unsubscribed, not another row's", async () => {
  // Two devices' worth of registrations in one browser profile is rare but possible, and reporting
  // A's endpoint twice would delete the wrong row and leave the other buzzing forever.
  const { ctgCleanup, ctgReport } = load();
  const nav = fakeNav([
    fakeReg({ sub: fakeSub({ endpoint: "ep-one" }) }),
    fakeReg({ sub: fakeSub({ endpoint: "ep-two" }) }),
  ]);
  await ctgCleanup(nav, ctgReport(nav, "tok"));
  assertEquals(await Promise.all(nav.beacons.map(async (b: Any) => (await beaconBody(b)).endpoint)), ["ep-one", "ep-two"]);
});

Deno.test("with no session token the row is left to the 410 prune, and the endpoint still dies", async () => {
  const { ctgCleanup, ctgReport } = load();
  const sub = fakeSub();
  const reg = fakeReg({ sub });
  const nav = fakeNav([reg]);
  const out = await ctgCleanup(nav, ctgReport(nav, null));

  assertEquals(nav.beacons.length, 0, "posted push_unsubscribe with no token — that is a guaranteed 401");
  assert(sub.calls.includes("unsubscribe"), "no token must not skip the unsubscribe: it is what makes lib.ts:230 prune the row");
  assertEquals(out.unregistered, 1);
});

Deno.test("ctgToken reads the same key both legacy apps write", () => {
  const { ctgToken } = load();
  assertEquals(ctgToken({ localStorage: { getItem: (k: string) => (k === "ctg_portal_token" ? "T" : null) } }), "T");
  // A browser with localStorage blocked must not throw the whole cleanup away.
  assertEquals(ctgToken({ get localStorage(): never { throw new Error("blocked"); } }), null);
});

// ---------------------------------------------------------------- the order

function fakeWin(regs: Any[], token: string | null = "tok") {
  const replaced: string[] = [];
  const timers: Any[] = [];
  const nav = fakeNav(regs);
  return {
    replaced,
    timers,
    nav,
    location: { pathname: "/ctg-finance-portal/hros.html", search: "", hash: "#clock", replace: (u: string) => replaced.push(u) },
    document: { getElementById: () => null },
    navigator: nav,
    localStorage: { getItem: () => token },
    setTimeout: (f: () => void, ms: number) => { timers.push({ f, ms }); return 1; },
  };
}

Deno.test("the redirect waits for the cleanup — it does not race it", async () => {
  // THE defect this page exists to avoid. location.replace() unloads the document, which cancels an
  // in-flight unregister(); a page that redirects first cleans up nothing and looks perfect doing it.
  const { ctgGo } = load();
  let release!: () => void;
  const held = new Promise<boolean>((res) => { release = () => res(true); });
  const reg = fakeReg({ sub: null, unregister: () => held });
  const win = fakeWin([reg]);

  const done = ctgGo(win);
  // Drain microtasks only. `held` is still pending, so nothing here can advance the cleanup past
  // unregister() — a page that redirected first would already have replaced the location.
  for (let i = 0; i < 50; i++) await Promise.resolve();
  assert(reg.calls.includes("unregister"), "the cleanup never started");
  assertEquals(win.replaced, [], "redirected while unregister() was still in flight");

  release();
  await done;
  assertEquals(win.replaced, ["https://os.ctg4u.com/hros.html#clock"]);
});

Deno.test("the redirect happens exactly once, and the fallback timer is armed but not relied on", async () => {
  const { ctgGo } = load();
  const win = fakeWin([fakeReg({ sub: fakeSub() })]);
  await ctgGo(win);

  assertEquals(win.replaced.length, 1);
  assertEquals(win.timers.length, 1, "no fallback timer: a browser API that never settles strands the user here");
  assert(win.timers[0].ms >= 1000, "the fallback fires so soon it would cut the cleanup short");

  win.timers[0].f();   // the timer firing after the jump must not double-navigate
  assertEquals(win.replaced.length, 1);
});

Deno.test("a cleanup that throws outright still forwards", async () => {
  const { ctgGo } = load();
  const win = fakeWin([]);
  win.nav.serviceWorker = { getRegistrations: () => Promise.reject(new Error("boom")) };
  await ctgGo(win);
  assertEquals(win.replaced, ["https://os.ctg4u.com/hros.html#clock"]);
});

Deno.test("the visible Continue link is retargeted to the same destination", async () => {
  const { ctgGo } = load();
  const link: Any = { href: "https://os.ctg4u.com/" };
  const win = fakeWin([]);
  win.document = { getElementById: (id: string) => (id === "go" ? link : null) } as Any;
  await ctgGo(win);
  assertEquals(link.href, "https://os.ctg4u.com/hros.html#clock");
});

// ---------------------------------------------------------------- the page itself

Deno.test("the page BOOTS the cleanup — every test above is vacuous if it does not", () => {
  // ctgGo() is guarded on `document` so this suite can drive it; that guard is also the one line no
  // test can execute, and a page that defines the cleanup and never calls it renders identically.
  //
  // Comments are blanked first, and that is not tidiness: the first cut of this check read the raw
  // source, so COMMENTING THE BOOT LINE OUT still matched it and the whole suite stayed green on a
  // page that did nothing at all. Found by introducing exactly that.
  assert(
    /if\s*\(\s*typeof document !== ['"]undefined['"]\s*\)\s*ctgGo\(window\)/.test(code),
    "forward.html no longer calls ctgGo(window) at load — it renders, forwards nothing and cleans up nothing",
  );
});

Deno.test("the page is self-contained: no <script src=>, no shared file", () => {
  // It is deployed alone into the `publish` repo, with no common.js beside it.
  assertEquals(html.match(/<script[^>]*\bsrc=/g), null);
});

Deno.test("the API URL and token key match what the legacy apps use today", async () => {
  const { CTG_API } = load();
  const app = await Deno.readTextFile(new URL("../app.html", import.meta.url));
  const hros = await Deno.readTextFile(new URL("../hros.html", import.meta.url));
  assert(app.includes('const API="' + CTG_API + '"'), "app.html:1220's API URL no longer matches the forwarding page's");
  assert(hros.includes('const API="' + CTG_API + '"'), "hros.html:1146's API URL no longer matches the forwarding page's");
  assert(script.includes("'ctg_portal_token'"), "the token key drifted from common.js's storageGet('ctg_portal_token')");
});

Deno.test("the page names the new address in text a human can read without JS", () => {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  assert(/os\.ctg4u\.com/.test(text), "someone who lands here with the page open is told nothing");
  assert(/noscript/.test(html), "no JS-off fallback at all");
});
