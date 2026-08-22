// Boot the portal edge function in-process — network, clock and RNG stubbed — and record the exact
// response it gives an ANONYMOUS caller for every {api:"..."} action name.
//
// Why this exists: the portal is ~200 actions behind one URL, and until the v209 module split the only
// tests were payroll and the statutory tables. Nothing checked that an action still ROUTES, or that it
// still refuses a caller with no token. A handler that quietly stops matching is a dead feature nobody
// notices until a dept head phones; a handler that quietly loses its auth gate is every company's
// payroll readable without a session. Both show up here as a changed line.
//
// It is deliberately credential-free and offline: every fetch (Supabase REST/RPC, Xero, CTG, Resend,
// Google) is answered by the same canned stub, so the transcript depends only on the portal's own
// routing, auth and setup. It is NOT a functional test of what a handler does once past its gate —
// nothing here can see behind an auth check, by design.
//
// Regenerate the golden after a deliberate change:
//   deno run -A tools/route_probe.ts supabase/functions/portal/index.ts tests/route_parity.golden.jsonl

/** Every action name the portal routes, in sorted order. Excludes `typeof b.api === "string"`. */
export function actionNames(sources: string[]): string[] {
  const re = /(?<![.\w])api\s*===\s*"([a-z0-9_]+)"/g;
  const out = new Set<string>();
  for (const src of sources) for (const m of src.matchAll(re)) out.add(m[1]);
  return [...out].sort();
}

/** Source text of every .ts file in the edge function directory. */
export async function functionSources(dir: URL): Promise<string[]> {
  const out: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && e.name.endsWith(".ts")) out.push(await Deno.readTextFile(new URL(e.name, dir)));
  }
  return out;
}

/**
 * Import `moduleUrl`, POST {api:name} with no token for each name, and return one JSON line per probe.
 * All patched globals are restored before returning, so this is safe to run alongside other tests.
 */
export async function probeRoutes(moduleUrl: string, names: string[]): Promise<string[]> {
  const g = globalThis as any;
  const saved = { Date: g.Date, random: Math.random, fetch: g.fetch, serve: (Deno as any).serve,
                  grv: crypto.getRandomValues, uuid: (crypto as any).randomUUID, envGet: Deno.env.get };
  const FIXED = Date.parse("2026-01-02T03:04:05.000Z");
  const RealDate = g.Date;
  class FakeDate extends RealDate {
    constructor(...a: any[]) { super(...((a.length ? a : [FIXED]) as [])); }
    static now() { return FIXED; }
  }
  let handler: any = null;
  try {
    g.Date = FakeDate;
    Math.random = () => 0.42;
    (crypto as any).getRandomValues = (a: any) => { if (a && a.fill) a.fill(7); return a; };
    (crypto as any).randomUUID = () => "00000000-0000-4000-8000-000000000000";
    // Stubbed rather than set, so the test needs no --allow-env.
    Deno.env.get = ((k: string) =>
      k === "SUPABASE_URL" ? "https://stub.supabase.co"
      : k === "SUPABASE_SERVICE_ROLE_KEY" ? "stub-service-role-key"
      : undefined) as typeof Deno.env.get;
    g.fetch = (input: any) => {
      const url = String(typeof input === "string" ? input : (input && input.url) || input);
      // portal_me is answered the way PRODUCTION answers it for a bad token — `{ok:false}`, an OBJECT.
      // Returning `null` here (as every other RPC still does) made a whole class of broken auth gate
      // invisible: `if (!me)` passes on `{ok:false}` and fails on `null`, so a handler missing its
      // `.ok` test looked correct in this harness and let every anonymous caller through in production.
      // pnl_analysis was exactly that, and this probe replayed all 203 actions without seeing it.
      const body = url.includes("/rpc/portal_me") ? '{"ok":false}' : url.includes("/rpc/") ? "null" : "[]";
      return Promise.resolve(new Response(body, {
        status: 200, headers: { "content-type": "application/json", "content-range": "*/0" },
      }));
    };
    (Deno as any).serve = (a: any, b?: any) => {
      handler = typeof a === "function" ? a : b;
      return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {} };
    };

    await import(moduleUrl);
    if (!handler) throw new Error("module never called Deno.serve — the router did not boot");

    const out: string[] = [];
    for (const name of ["", ...names]) {
      const req = new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(name === "" ? {} : { api: name }),
      });
      let status: number, body: string;
      try {
        const res = await handler(req);
        status = res.status;
        body = await res.text();
      } catch (e) {
        status = -1;
        body = "THREW: " + String(e);
      }
      out.push(JSON.stringify({ api: name || "(empty)", status, body }));
    }
    return out;
  } finally {
    g.Date = saved.Date;
    Math.random = saved.random;
    g.fetch = saved.fetch;
    (Deno as any).serve = saved.serve;
    (crypto as any).getRandomValues = saved.grv;
    (crypto as any).randomUUID = saved.uuid;
    Deno.env.get = saved.envGet;
  }
}

if (import.meta.main) {
  const [mod, out] = Deno.args;
  const dir = new URL("./", new URL(mod, "file://" + Deno.cwd() + "/"));
  const names = actionNames(await functionSources(dir));
  const lines = await probeRoutes(new URL(mod, "file://" + Deno.cwd() + "/").href, names);
  await Deno.writeTextFile(out, lines.join("\n") + "\n");
  console.error(`wrote ${lines.length} probes (${names.length} actions) to ${out}`);
}
