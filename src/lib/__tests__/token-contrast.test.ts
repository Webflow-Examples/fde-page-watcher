import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contrast contract for the F3 token layer (chunk F3, AC7).
 *
 * Page Watch renders status at 12px, which is why the light health and status
 * steps run darker than Blueprint's own `--text-danger` / `--text-warning` /
 * `--text-success` roles — those measure 4.34:1, 3.81:1, and 3.36:1 on white
 * and would fail here. This test is what stops someone "correcting" them back.
 *
 * It reads the real stylesheet rather than a copy of the values, so a token
 * edited in `globals.css` is checked on the next run. Both themes are covered:
 * the dark block only overrides some tokens, so anything it omits is inherited
 * from `:root` exactly as the cascade would.
 */

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** WCAG 2.1 minimum for normal-size text. Every pairing below is 12px. */
const AA_NORMAL = 4.5;

function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector + " {");
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const body = CSS.slice(start, CSS.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) {
    out[name] = value.trim();
  }
  return out;
}

const LIGHT = block(":root");
const DARK_OVERRIDES = block('[data-surface="dark"]');
/** The dark block overrides a subset; the rest cascades from `:root`. */
const DARK = { ...LIGHT, ...DARK_OVERRIDES };

const THEMES: Array<[string, Record<string, string>]> = [
  ["light", LIGHT],
  ["dark", DARK],
];

function rgb(theme: Record<string, string>, token: string, seen = new Set<string>()): [number, number, number] {
  if (seen.has(token)) throw new Error(`circular token reference at ${token}`);
  seen.add(token);

  const raw = theme[token];
  if (!raw) throw new Error(`token ${token} is not defined in this theme`);

  const varRef = /^var\((--[a-z0-9-]+)\)$/.exec(raw);
  if (varRef) return rgb(theme, varRef[1], seen);

  const hex = /^#([0-9a-f]{6})$/i.exec(raw);
  if (!hex) throw new Error(`token ${token} resolves to ${raw}, which is not a plain hex`);
  const n = parseInt(hex[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(theme: Record<string, string>, fg: string, bg: string): number {
  const a = luminance(rgb(theme, fg));
  const b = luminance(rgb(theme, bg));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every tone in `vocabulary.ts`. A missing one here means a chip has no colour. */
const TONES = ["information", "neutral", "warning", "success", "danger"] as const;
const HEALTHS = ["good", "warn", "poor", "none"] as const;

/** The grounds any piece of app text can land on. */
const SURFACES = ["--surface-page", "--surface-card", "--surface-input", "--surface-raised"] as const;

/**
 * Tokens the app actually paints TEXT with, discovered by reading the source
 * rather than listed by hand.
 *
 * A hand-written list is what let a fill token (`--action-primary-bg`, tuned to
 * carry white, 3.02:1 as ink on a dark raised surface) and a 1.4px hairline
 * token (`--series-anomaly-edge`, 1.77:1 as 12px type) both ship as body text.
 * Deriving the list means a new ink token is covered the moment it is used, and
 * reusing a fill or a border as ink fails here instead of in someone's eyes.
 *
 * Deliberately excluded: `--action-primary-text` (white — it only ever sits on
 * `--action-primary-bg`, checked separately below) and `--text-disabled-app`
 * (disabled controls, which WCAG 1.4.3 exempts).
 */
const INK_EXEMPT = new Set(["--action-primary-text", "--text-disabled-app"]);

function discoverInkTokens(): string[] {
  const found = new Set<string>();
  const roots = ["src/components", "src/app", "src/lib"];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const src = readFileSync(full, "utf8");
      // `color: "var(--x)"` in a style object. A ternary is still ink on both arms.
      for (const [, token] of src.matchAll(/(?<![-\w])color:\s*(?:[^",]*\?\s*)?"var\((--[a-z0-9-]+)\)"/g)) {
        found.add(token);
      }
      // `fill:` is ink only on an SVG <text>. On a <path>, <rect>, or <polygon>
      // it paints a shape, where a hairline or band value is exactly right.
      for (const [element] of src.matchAll(/<text\b[\s\S]*?>/g)) {
        for (const [, token] of element.matchAll(/fill:\s*"var\((--[a-z0-9-]+)\)"/g)) {
          found.add(token);
        }
      }
    }
  };
  roots.forEach(walk);
  // `color: var(--x)` in the stylesheet body — not `border-color`, not `background-color`.
  const body = CSS.slice(CSS.indexOf("@theme inline"));
  for (const [, token] of body.matchAll(/(?<![-\w])color:\s*var\((--[a-z0-9-]+)\)/g)) {
    found.add(token);
  }
  // Locally-scoped pass-throughs (e.g. `--segment-tone`, set inline per element
  // from a closed role map) carry no value of their own. The tokens they forward
  // to are in this list on their own account, so they are checked there.
  return [...found].filter((t) => !INK_EXEMPT.has(t) && t in LIGHT).sort();
}

const INK_TOKENS = discoverInkTokens();

/** Every token the app paints a SURFACE with, discovered the same way. */
function discoverFillTokens(): string[] {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const src = readFileSync(full, "utf8");
      for (const [, token] of src.matchAll(/(?<![-\w])background(?:Color)?:\s*(?:[^",]*\?\s*)?"var\((--[a-z0-9-]+)\)"/g)) {
        found.add(token);
      }
    }
  };
  ["src/components", "src/app", "src/lib"].forEach(walk);
  const body = CSS.slice(CSS.indexOf("@theme inline"));
  for (const [, token] of body.matchAll(/(?<![-\w])background(?:-color)?:\s*var\((--[a-z0-9-]+)\)/g)) {
    found.add(token);
  }
  return [...found].filter((t) => t in LIGHT).sort();
}

const FILL_TOKENS = discoverFillTokens();

/**
 * A token's role, read off its name.
 *
 * Registry rule 13: a token is named for its role, and a fill value used as ink
 * or a hairline value used as type is a bug even though the token resolves.
 * Only the unambiguous suffixes and prefixes are classified — `--series-marker`
 * and `--series-axis` legitimately paint both a mark and its label, and a
 * name-shaped guess about those would be a false positive rather than a rule.
 */
type TokenRole = "fill" | "line" | "elevation" | "ink-capable";

function roleOf(token: string): TokenRole {
  if (/-(bg|fill)$/.test(token) || token.startsWith("--surface-")) return "fill";
  if (/-(border|edge|grid)$/.test(token) || token.startsWith("--border-") || token === "--focus-ring") return "line";
  if (token.startsWith("--shadow-") || token.startsWith("--overlay-")) return "elevation";
  return "ink-capable";
}

/** Tokens that name a text colour and nothing else. */
const INK_ONLY = (token: string) =>
  /-(text|ink)$/.test(token) ||
  token.startsWith("--text-") ||
  ["--trend-glyph", "--magnitude-value", "--magnitude-unit", "--confidence-strong", "--confidence-weak"].includes(token);

describe("token roles", () => {
  // Registry rule 13. These two assertions are the ones that would have caught
  // `--action-primary-bg` painting the active nav label (a fill tuned to carry
  // white, 3.02:1 as ink) and `--series-anomaly-edge` painting "PSI anomaly ·
  // excluded" (a 1.4px hairline value, 1.77:1 as 12px type). Both resolved
  // fine; both were the wrong role.
  it("never paints text with a fill, hairline, or elevation token", () => {
    const misused = INK_TOKENS.filter((token) => roleOf(token) !== "ink-capable").map(
      (token) => `${token} (${roleOf(token)})`,
    );
    expect(misused, `used as ink despite naming a ${misused.length === 1 ? "non-text" : "non-text"} role`).toEqual([]);
  });

  it("never paints a surface with a text-only token", () => {
    const misused = FILL_TOKENS.filter(INK_ONLY);
    expect(misused, "used as a background despite naming a text colour").toEqual([]);
  });
});

describe("contrast coverage", () => {
  // The coverage list must stay DERIVED. A hand-maintained list is what let both
  // rule-13 bugs ship: the tokens were simply not on it, so 841 green tests said
  // nothing. If this ever needs relaxing, the answer is to fix the token, not
  // the test.
  const OWN_SOURCE = readFileSync(fileURLToPath(import.meta.url), "utf8");

  it("derives the checked tokens from the source, never a maintained list", () => {
    expect(OWN_SOURCE).toContain("const INK_TOKENS = discoverInkTokens();");
    expect(OWN_SOURCE).toContain("const FILL_TOKENS = discoverFillTokens();");
    // A literal array of token names assigned to either list means someone
    // replaced discovery with a list.
    expect(OWN_SOURCE).not.toMatch(/const (INK|FILL)_TOKENS\s*(:[^=]+)?=\s*\[/);
  });

  it("actually finds the app's ink tokens", () => {
    // A discovery that silently matches nothing would pass every assertion
    // above it. These are load-bearing and must always be found.
    for (const token of ["--text-body", "--text-muted", "--health-poor-text", "--status-danger-text", "--magnitude-value", "--trend-glyph"]) {
      expect(INK_TOKENS, `${token} should be discovered as ink`).toContain(token);
    }
    expect(INK_TOKENS.length).toBeGreaterThanOrEqual(15);
    expect(FILL_TOKENS.length).toBeGreaterThanOrEqual(5);
  });
});

describe("token contrast", () => {
  describe.each(THEMES)("%s theme", (name, theme) => {
    it.each(HEALTHS)("health-%s text clears AA on its own background", (band) => {
      const r = ratio(theme, `--health-${band}-text`, `--health-${band}-bg`);
      expect(r, `--health-${band}-text on --health-${band}-bg in ${name} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it.each(TONES)("status-%s chip clears AA", (tone) => {
      const r = ratio(theme, `--status-${tone}-text`, `--status-${tone}-bg`);
      expect(r, `--status-${tone}-text on --status-${tone}-bg in ${name} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it.each(HEALTHS)("health-%s text also clears AA as bare text on a card", (band) => {
      // Health reads as bare coloured text as well as inside a chip.
      const r = ratio(theme, `--health-${band}-text`, "--surface-card");
      expect(r, `--health-${band}-text on --surface-card in ${name} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it.each(INK_TOKENS)("%s clears AA on every app surface", (token) => {
      for (const surface of SURFACES) {
        const r = ratio(theme, token, surface);
        expect(r, `${token} on ${surface} in ${name} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    });

    it("primary action text clears AA on the primary fill", () => {
      const r = ratio(theme, "--action-primary-text", "--action-primary-bg");
      expect(r, `primary button in ${name} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  });

  it("defines every tone StatusChip can ask for, in both themes", () => {
    // StatusChip builds `var(--status-<tone>-text)` from the vocabulary registry.
    // An undefined tone renders an invisible pill with no error, so assert the
    // whole set resolves rather than trusting the chip to fail loudly.
    for (const [, theme] of THEMES) {
      for (const tone of TONES) {
        expect(() => rgb(theme, `--status-${tone}-text`)).not.toThrow();
        expect(() => rgb(theme, `--status-${tone}-bg`)).not.toThrow();
      }
    }
  });

  it("names colour values only inside the two token blocks", () => {
    const afterTokens = CSS.slice(CSS.indexOf("@theme inline"));
    expect(afterTokens.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  /**
   * AC3. One file is carved out by name: a web app manifest is JSON read by the
   * browser's install UI, where a custom property cannot resolve. The carve-out
   * is conditional on the file saying which tokens its two values mirror, so a
   * later token edit has something to find.
   */
  const HEX_CARVE_OUT = "src/app/manifest.ts";

  it("names colour values nowhere else in src/, except the carved-out manifest", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|css)$/.test(entry.name)) continue;
        const rel = full.replace(/\\/g, "/");
        if (rel === HEX_CARVE_OUT || rel.endsWith("src/app/globals.css")) continue;
        const src = readFileSync(full, "utf8");
        for (const [hex] of src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
          // `&#8212;` and friends are HTML entities in fixture strings.
          if (/&#\d+;/.test(src.slice(Math.max(0, src.indexOf(hex) - 1), src.indexOf(hex) + hex.length + 1))) continue;
          offenders.push(`${rel}: ${hex}`);
        }
      }
    };
    walk("src");
    expect(offenders, "a colour value outside the token blocks").toEqual([]);
  });

  it("makes the manifest carve-out say which tokens its values mirror", () => {
    const manifest = readFileSync(join(process.cwd(), HEX_CARVE_OUT), "utf8");
    expect(manifest, "the carve-out must name --surface-page").toContain("--surface-page");
    expect(manifest, "the carve-out must name --action-primary-bg").toContain("--action-primary-bg");
    // And the values must still match the tokens they claim to mirror.
    expect(manifest).toContain(LIGHT["--surface-page"]);
    expect(manifest).toContain(LIGHT["--action-primary-bg"]);
  });
});
