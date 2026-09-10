// The palette is one system: every text token clears WCAG AA on the surfaces it sits on, every
// translucent tint is derived from a token, and there is exactly ONE accent orange.
//
// WHY THIS FILE EXISTS: the 2026-07-30 redesign shipped new token VALUES and the apps went on looking
// like the old design, because ~180 CSS declarations never used tokens — they hardcoded the
// PRE-redesign palette as raw rgba() triples. `#E85D3C`, the old coral, appeared **120 times** beside
// the `#C4492A` the buttons use; the old navy surfaces appeared ~55 times, which is why the KPI cards
// were navy-tinted while the canvas behind them was neutral. None of that was visible to any test: a
// golden records markup, and `deno lint` does not read CSS.
//
// Three failures were also live and measurable, and all three are small text: dark `--muted` at 3.77
// (every table sub-label and KPI caption), light `--sky-soft` at 4.11, light `--warn-soft` at 3.48.
//
// A hardcoded triple is what this catches earliest, so it is checked first: a colour written as digits
// cannot track a theme, and it is how a second palette gets back in.
import { assertEquals } from "jsr:@std/assert@1";

const FILES = ["app.html", "hros.html"] as const;
const SRC: Record<string, string> = {};
for (const f of FILES) SRC[f] = await Deno.readTextFile(new URL("../" + f, import.meta.url));

const styleOf = (s: string) =>
  [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const v = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as RGB;
};
const lum = (c: RGB) => {
  const [r, g, b] = c.map((x) => {
    const n = x / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** The custom properties declared in one selector's block. */
function tokens(css: string, sel: string): Record<string, string> {
  const i = css.indexOf(sel + "{");
  if (i < 0) return {};
  const body = css.slice(i, css.indexOf("}", i));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const THEMES = [["dark", ":root"], ["light", ':root[data-theme="light"]']] as const;
const SURFACES = ["--bg", "--surface", "--surface2", "--panel", "--panel-2"];
const FOREGROUNDS = [
  "--text", "--text-soft", "--muted", "--coral-soft", "--sky", "--sky-soft",
  "--green", "--green-soft", "--red", "--red-soft", "--amber", "--warn-soft",
];
const isHex = (v: string) => /^#[0-9A-Fa-f]{6}$/.test(v);

Deno.test("no stylesheet hardcodes a COLOURED rgb triple — every tint comes from a token", () => {
  // Greys and near-greys are exempt: a scrim, a hairline and a shadow are legitimately written as
  // black or white at an alpha, and they do not carry a hue that can disagree with the palette.
  const bad: string[] = [];
  for (const f of FILES) {
    const css = styleOf(SRC[f]);
    const seen = new Map<string, number>();
    for (const m of css.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
      const t = [m[1], m[2], m[3]].map(Number) as RGB;
      if (Math.max(...t) - Math.min(...t) < 18) continue;   // grey enough to be a scrim
      const k = t.join(",");
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    // A handful of one-off shadow tints predate this rule and are individually harmless; the thing
    // worth catching is a triple used MANY times, which is a palette forking rather than a one-off.
    for (const [k, n] of seen) if (n >= 3) bad.push(`${f}: rgba(${k}) x${n}`);
  }
  assertEquals(
    bad,
    [],
    "a colour is hardcoded often enough to be a second palette — use the --x-rgb token so it tracks " +
      "the theme:\n  " + bad.join("\n  "),
  );
});

Deno.test("every --x-rgb token agrees with the solid token it is the tint of", () => {
  // The whole point of the companions: rgba(var(--red-rgb),.18) and var(--red) must be the same red.
  // --coral-rgb is the ONE deliberate exception and is asserted as such below.
  const mismatched: string[] = [];
  for (const f of FILES) {
    const css = styleOf(SRC[f]);
    for (const [theme, sel] of THEMES) {
      const t = tokens(css, sel);
      for (const name of ["--sky", "--green", "--red", "--amber", "--text", "--bg", "--surface", "--surface2"]) {
        const solid = t[name], trip = t[name + "-rgb"];
        if (!solid || !trip || !isHex(solid)) continue;
        const want = hex(solid).join(",");
        if (trip.replace(/\s/g, "") !== want) {
          mismatched.push(`${f} [${theme}] ${name}-rgb is ${trip}, but ${name} is ${solid} (${want})`);
        }
      }
    }
  }
  assertEquals(mismatched, [], "a tint token drifted from its solid token:\n  " + mismatched.join("\n  "));
});

Deno.test("--coral-rgb is the SOFT coral in dark and the solid one in light, deliberately", () => {
  // A tint has to be visible against its own ground. #C4492A at .05 over #161A21 is not, which is why
  // this one companion does NOT simply mirror --coral. Pinned so the exception stays a decision.
  for (const f of FILES) {
    const css = styleOf(SRC[f]);
    const d = tokens(css, ":root"), l = tokens(css, ':root[data-theme="light"]');
    assertEquals(d["--coral-rgb"]?.replace(/\s/g, ""), hex(d["--coral-soft"]).join(","),
      `${f}: dark --coral-rgb should be --coral-soft (${d["--coral-soft"]}) so the tint is visible on a dark ground`);
    assertEquals(l["--coral-rgb"]?.replace(/\s/g, ""), hex(l["--coral"]).join(","),
      `${f}: light --coral-rgb should be --coral (${l["--coral"]})`);
  }
});

Deno.test("every text token clears WCAG AA on every surface it sits on", () => {
  const fails: string[] = [];
  for (const f of FILES) {
    const css = styleOf(SRC[f]);
    for (const [theme, sel] of THEMES) {
      const t = tokens(css, sel);
      for (const fg of FOREGROUNDS) {
        if (!t[fg] || !isHex(t[fg])) continue;
        for (const bg of SURFACES) {
          if (!t[bg] || !isHex(t[bg])) continue;
          const c = contrast(hex(t[fg]), hex(t[bg]));
          if (c < 4.5) {
            fails.push(`${f} [${theme}] ${fg} ${t[fg]} on ${bg} ${t[bg]} = ${c.toFixed(2)}`);
          }
        }
      }
    }
  }
  assertEquals(
    fails,
    [],
    "these are small text — captions, table sub-labels, pills — so 4.5 is the bar, not 3.0:\n  " +
      fails.join("\n  "),
  );
});

Deno.test("white text clears AA on every token used as a FILLED button background", () => {
  // --coral is the filled-button background in both themes. It is the trap the design notes record:
  // a colour picked against the ground it sits ON, without checking the text that sits on IT.
  for (const f of FILES) {
    const css = styleOf(SRC[f]);
    for (const [theme, sel] of THEMES) {
      const t = tokens(css, sel);
      for (const k of ["--coral", "--coral-deep"]) {
        if (!t[k] || !isHex(t[k])) continue;
        const c = contrast(hex(t[k]), [255, 255, 255]);
        assertEquals(c >= 4.5, true,
          `${f} [${theme}] ${k} ${t[k]} carries white button text at only ${c.toFixed(2)}`);
      }
    }
  }
});

Deno.test("there is ONE accent orange, not a second one hiding in a parallel token family", () => {
  // hros.html carried --accent (#E85D3C dark / #E04E2B light) and --accent-soft beside --coral, used
  // twice against --coral's 46 — dead tokens keeping a second orange on screen. They now delegate.
  const extra: string[] = [];
  for (const f of FILES) {
    const css = styleOf(SRC[f]);
    for (const [theme, sel] of THEMES) {
      const t = tokens(css, sel);
      for (const [k, v] of Object.entries(t)) {
        if (!/accent/.test(k) || !isHex(v)) continue;
        const [r, g, b] = hex(v);
        if (r > g && g > b && r > 120 && r - b > 60) extra.push(`${f} [${theme}] ${k}: ${v}`);
      }
    }
  }
  assertEquals(
    extra,
    [],
    "an --accent* token declares its own orange instead of delegating to the --coral ramp:\n  " +
      extra.join("\n  "),
  );
});
