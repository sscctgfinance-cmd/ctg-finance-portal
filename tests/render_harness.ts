// Boot app.html / hros.html in-process, under a stub DOM, and capture the HTML a screen renders.
//
// WHY THIS EXISTS: see the header of render_smoke_test.ts. v205 shipped `hrPayroll()` referring to an
// identifier whose declaration had been lost in a half-applied edit, and every gate was green — lint
// cannot see a runtime ReferenceError, the HTML still parsed, and no test had ever CALLED a renderer.
// render_smoke_test.ts fixed that for two screens by hand-rolling a stub DOM; wht_test.ts did it again
// for a third. This is that stub DOM and that function-lifting, factored out once so every screen in
// both apps can be rendered, not just the three somebody remembered to write a test for.
//
// Everything here is offline and credential-free, exactly like tools/route_probe.ts: `fetch` is answered
// from a fixture table keyed by the {api:"..."} name, so a render depends only on the app's own code and
// the payload it is handed. Nothing reaches the live database or the live edge function.

// deno-lint-ignore-file no-explicit-any

import { inlineScript } from "../tools/extract.ts";

/** Frozen wall clock. Every golden is captured at this instant. */
export const FIXED_MS = Date.parse("2026-08-18T09:30:00.000Z");

/**
 * Date, pinned to a fixed instant AND to UTC.
 *
 * The instant alone is not enough. These screens print local dates (`new Date().getFullYear()`,
 * `localISO()`, calendar grids), and V8 reads the host timezone for those. A golden captured in
 * Asia/Kuala_Lumpur would then fail in CI's UTC — a red build caused by the machine, not the code,
 * which is the fastest way to teach everyone to ignore a failing golden. So the local getters delegate
 * to their UTC twins, component construction is read as UTC, and the offset is zero.
 *
 * The `toLocale*` overrides pin the timezone the same way, and supply "en-GB" only when the caller named
 * no locale at all — the host default would otherwise vary too. Where the app DOES name a locale and a
 * timezone (renderAp prints `en-MY` in `Asia/Kuala_Lumpur`) its own options win: they are spread last.
 */
function pinDate(): any {
  const Real = Date;
  const NEEDS_Z = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;   // date+time with no zone → would be read as local
  const pinArgs = (a: any[]): any[] => {
    if (a.length === 0) return [FIXED_MS];
    if (a.length === 1 && typeof a[0] === "string" && NEEDS_Z.test(a[0]) && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(a[0])) return [a[0].replace(" ", "T") + "Z"];
    if (a.length >= 2) return [Real.UTC(a[0], a[1], a[2] ?? 1, a[3] ?? 0, a[4] ?? 0, a[5] ?? 0, a[6] ?? 0)];
    return a;
  };
  class Pinned extends Real {
    constructor(...a: any[]) {
      super(...(pinArgs(a) as []));
    }
    static override now() { return FIXED_MS; }
    override getFullYear() { return this.getUTCFullYear(); }
    override getMonth() { return this.getUTCMonth(); }
    override getDate() { return this.getUTCDate(); }
    override getDay() { return this.getUTCDay(); }
    override getHours() { return this.getUTCHours(); }
    override getMinutes() { return this.getUTCMinutes(); }
    override getSeconds() { return this.getUTCSeconds(); }
    override getMilliseconds() { return this.getUTCMilliseconds(); }
    override getTimezoneOffset() { return 0; }
    override setFullYear(...a: any[]) { return (this as any).setUTCFullYear(...a); }
    override setMonth(...a: any[]) { return (this as any).setUTCMonth(...a); }
    override setDate(...a: any[]) { return (this as any).setUTCDate(...a); }
    override setHours(...a: any[]) { return (this as any).setUTCHours(...a); }
    override toLocaleDateString(l?: any, o?: any) { return Real.prototype.toLocaleDateString.call(this, l ?? "en-GB", { timeZone: "UTC", ...(o || {}) }); }
    override toLocaleTimeString(l?: any, o?: any) { return Real.prototype.toLocaleTimeString.call(this, l ?? "en-GB", { timeZone: "UTC", ...(o || {}) }); }
    override toLocaleString(l?: any, o?: any) { return Real.prototype.toLocaleString.call(this, l ?? "en-GB", { timeZone: "UTC", ...(o || {}) }); }
  }
  return Pinned;
}

/** One stub element. `innerHTML` is recorded so a renderer that writes into the page can be read back. */
function makeEl(id?: string): any {
  const el: any = {
    id: id || "", value: "", checked: false, disabled: false, textContent: "", innerText: "",
    style: {}, dataset: {}, files: [], options: [], children: [], selectedIndex: 0,
    offsetWidth: 960, offsetHeight: 600, clientWidth: 960, clientHeight: 600, scrollTop: 0, scrollHeight: 600,
    tagName: "DIV", nodeName: "DIV", parentNode: null, _classes: new Set<string>(),
  };
  el.classList = {
    add: (...c: string[]) => c.forEach((x) => el._classes.add(x)),
    remove: (...c: string[]) => c.forEach((x) => el._classes.delete(x)),
    toggle: (c: string, f?: boolean) => { const on = f === undefined ? !el._classes.has(c) : f; on ? el._classes.add(c) : el._classes.delete(c); },
    contains: (c: string) => el._classes.has(c),
  };
  let html = "";
  Object.defineProperty(el, "innerHTML", { get: () => html, set: (v) => { html = v == null ? "" : String(v); el._written = true; }, configurable: true });
  Object.defineProperty(el, "outerHTML", { get: () => `<div id="${el.id}">${html}</div>`, configurable: true });
  el.appendChild = (c: any) => { el.children.push(c); return c; };
  el.removeChild = (c: any) => c;
  el.insertBefore = (c: any) => c;
  el.remove = () => {};
  el.addEventListener = () => {};
  el.removeEventListener = () => {};
  el.setAttribute = (k: string, v: any) => { if (k === "data-theme") el._theme = v; el[k] = v; };
  el.getAttribute = (k: string) => (k === "data-theme" ? (el._theme ?? "light") : (el[k] ?? null));
  el.removeAttribute = () => {};
  el.hasAttribute = () => false;
  el.querySelector = () => null;
  el.querySelectorAll = () => [];
  el.closest = () => null;
  el.scrollIntoView = () => {};
  el.focus = () => {};
  el.blur = () => {};
  el.click = () => {};
  el.select = () => {};
  el.submit = () => {};
  el.insertAdjacentHTML = (_pos: string, s: string) => { html += s; el._written = true; };
  el.getBoundingClientRect = () => ({ top: 0, left: 0, right: 960, bottom: 600, width: 960, height: 600 });
  el.getContext = () => ({
    drawImage() {}, fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    fill() {}, arc() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, closePath() {},
    setTransform() {}, putImageData() {}, measureText: () => ({ width: 10 }), fillText() {}, createLinearGradient: () => ({ addColorStop() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  });
  el.toDataURL = () => "data:image/png;base64,";
  return el;
}

export interface AppHandle {
  /** Evaluate `code` INSIDE the app's own scope. The apps' top-level `let`/`var` are function-scoped
   *  under `new Function`, so this is the only way to seed or read them. */
  exec(code: string): any;
  /** Whatever the last write to `#id`.innerHTML left behind. */
  html(id: string): string;
  /** Every element the render wrote into, id → final innerHTML, sorted by id. */
  writes(): [string, string][];
  /** Drain the microtask queue so deferred loads and their re-renders finish. */
  settle(): Promise<void>;
  /** Seed a form control the renderer reads back out of the DOM (`document.getElementById('company').value`). */
  seed(id: string, props: Record<string, unknown>): void;
  /** {api:"..."} names the render asked for that had no fixture. */
  missing: string[];
  /** Every {api:"..."} the render asked for, in order. */
  asked: string[];
  restore(): void;
}

const SRC_CACHE = new Map<string, string>();
function source(file: string): string {
  let s = SRC_CACHE.get(file);
  if (!s) { s = inlineScript(Deno.readTextFileSync(new URL("../" + file, import.meta.url))); SRC_CACHE.set(file, s); }
  return s;
}

/**
 * Evaluate one of the single-file apps under a stub DOM and hand back a handle onto its scope.
 *
 * `fixtures` answers `call({api:"..."})`. A name with no entry still returns a well-formed refusal
 * (`{ok:false}`) rather than throwing, so a screen that asks for something we did not fixture degrades
 * the way it would against a permission error — and the name is recorded in `.missing` so the gap is
 * visible instead of silently becoming the golden.
 */
export function loadApp(file: "app.html" | "hros.html", fixtures: Record<string, unknown> = {}): AppHandle {
  const els = new Map<string, any>();
  const getEl = (id: string) => { let e = els.get(id); if (!e) { e = makeEl(id); els.set(id, e); } return e; };
  const asked: string[] = [];
  const missing: string[] = [];

  const g: any = {};
  const body = makeEl("body");
  const docEl = makeEl("html");
  g.document = {
    getElementById: getEl, querySelector: () => null, querySelectorAll: () => [],
    createElement: (t: string) => { const e = makeEl(); e.tagName = String(t).toUpperCase(); return e; },
    createElementNS: () => makeEl(), createTextNode: (t: string) => ({ textContent: t }),
    body, documentElement: docEl, head: makeEl("head"), addEventListener() {}, removeEventListener() {},
    cookie: "", activeElement: null, readyState: "complete", title: "", hidden: false, visibilityState: "visible",
    execCommand: () => true, getSelection: () => ({ toString: () => "", removeAllRanges() {} }),
  };
  g.location = { href: "https://x/" + file, hash: "", search: "", pathname: "/" + file, origin: "https://x", reload() {}, assign() {}, replace() {} };
  g.history = { pushState() {}, replaceState() {}, back() {} };
  const store: Record<string, string> = {};
  g.localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; }, clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
  g.sessionStorage = g.localStorage;
  g.navigator = {
    userAgent: "harness", onLine: true, language: "en-GB", maxTouchPoints: 0,
    serviceWorker: { register: () => Promise.resolve({ addEventListener() {} }), ready: Promise.resolve({}), addEventListener() {}, controller: null },
    clipboard: { writeText: () => Promise.resolve() }, mediaDevices: { getUserMedia: () => Promise.reject(new Error("no camera")) },
    sendBeacon: () => true, permissions: { query: () => Promise.resolve({ state: "prompt" }) },
  };
  g.alert = () => {}; g.confirm = () => true; g.prompt = () => null;
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  // Timers: `setTimeout(fn, 0)` runs on the microtask queue, everything else is inert.
  //
  // Both apps defer their data load exactly one tick — `if(!X.data && !X.loading){ X.loading=true;
  // setTimeout(hrXLoad,0); }` — so a fully inert setTimeout would freeze every one of those screens on
  // its spinner and the golden would record a loading state, not a screen. Running the zero-delay ones
  // lets the real loader run against the stubbed fetch, which is the point: the fixture is the server's
  // answer, and the app's own load → state → re-render path is under test rather than bypassed.
  //
  // Delayed timers stay inert on purpose: they are toasts, poll loops, idle timers and the 1s clock tick,
  // none of which belong in a golden, and a real pending timer outlives the test and trips Deno's
  // async-op sanitizer. `pumped` is a runaway guard — a render→load→render cycle would otherwise spin.
  //
  // `live` is dropped by restore(): a render that queued more work must not run against the next test's
  // globals. Without it a leftover continuation from surface N repaints into surface N+1's stub DOM and
  // the golden silently belongs to the wrong screen.
  let pumped = 0;
  let live = true;
  g.setTimeout = (fn: any, ms?: number) => { if (!ms && typeof fn === "function" && pumped++ < 400) queueMicrotask(() => { if (live) fn(); }); return 0; };
  g.clearTimeout = () => {}; g.setInterval = () => 0; g.clearInterval = () => {};
  g.requestAnimationFrame = () => 0; g.cancelAnimationFrame = () => {};
  g.requestIdleCallback = () => 0;
  g.Notification = { permission: "default", requestPermission: () => Promise.resolve("default") };
  g.Image = class { onload: any; onerror: any; src = ""; width = 1; height = 1; };
  g.FileReader = class { onload: any; onerror: any; result: any = ""; readAsDataURL() {} readAsText() {} readAsArrayBuffer() {} };
  g.XMLHttpRequest = class { open() {} send() {} setRequestHeader() {} addEventListener() {} };
  g.print = () => {};
  g.open = () => null;
  g.scrollTo = () => {};
  g.getComputedStyle = () => ({ getPropertyValue: () => "" });

  g.fetch = (input: any, init: any) => {
    let api = "";
    try { api = JSON.parse(String(init?.body ?? "{}")).api || ""; } catch { /* not our POST */ }
    if (api) {
      asked.push(api);
      if (!(api in fixtures)) missing.push(api);
    }
    const payload = api && api in fixtures ? fixtures[api] : { ok: false, error: "no fixture for " + (api || String(input)) };
    if (!live) return new Promise<Response>(() => {});   // torn down — never resume a dead render
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
  };

  const gt = globalThis as any;
  const saved: Record<string, unknown> = { Date: gt.Date, random: Math.random };
  for (const k of Object.keys(g)) { saved[k] = gt[k]; gt[k] = g[k]; }
  gt.window = globalThis;
  gt.Date = pinDate();
  Math.random = () => 0.42;

  const mod = new Function(
    source(file) + "\n;return function(__c){ return eval(__c); };",
  )();

  return {
    exec: (code: string) => mod(code),
    html: (id: string) => (els.get(id)?.innerHTML ?? ""),
    writes: () => [...els.entries()].filter(([, e]) => e._written).map(([k, e]) => [k, e.innerHTML] as [string, string])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    async settle() { for (let i = 0; i < 60; i++) await null; },
    seed: (id: string, props: Record<string, unknown>) => Object.assign(getEl(id), props),
    missing,
    asked,
    restore() {
      live = false;
      for (const k of Object.keys(g)) gt[k] = saved[k];
      gt.Date = saved.Date; Math.random = saved.random as typeof Math.random;
    },
  };
}
