import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StatusChip } from "@/components/status-chip";
import { WORK_STATES } from "@/lib/vocabulary";

/**
 * Registry rule 8, checked against what actually renders.
 *
 * "A status chip is 12px, weight 600, and never smaller than 12px. Nothing
 * carrying meaning renders below 12px — the earlier 11px floor contradicted F3
 * and is withdrawn."
 *
 * The rule was decided in the registry and the numbers were then written out
 * again in `status-chip.tsx` as `DEFAULT_FONT_SIZE`, `MIN_FONT_SIZE` and a
 * literal `fontWeight`. Nothing read the rule, so the withdrawn 11px floor
 * could have come back one component at a time with every test still green.
 *
 * The figures below are parsed out of the rule itself rather than restated
 * here: a rule that changes its numbers changes this test with it.
 */

const registry = JSON.parse(
  readFileSync(join(process.cwd(), "vocabulary.json"), "utf8"),
) as { rules: string[] };

const CHIP_RULE = registry.rules.find((rule) => /status chip/i.test(rule));

/** The numbers the rule states, read off the rule. */
const FLOOR_PX = Number(/(\d+)px/.exec(CHIP_RULE ?? "")?.[1]);
const WEIGHT = Number(/weight (\d+)/.exec(CHIP_RULE ?? "")?.[1]);

/** `StatusChip` is a plain function returning an element — no DOM required. */
const chipStyle = (props: Parameters<typeof StatusChip>[0]) =>
  (StatusChip(props) as { props: { style: Record<string, unknown> } }).props.style;

describe("registry rule 8 — the 12px floor", () => {
  it("finds the rule and its figures", () => {
    // A discovery that matched nothing would make every assertion below vacuous.
    expect(CHIP_RULE, "vocabulary.json states no rule about the status chip").toBeDefined();
    expect(FLOOR_PX).toBeGreaterThan(0);
    expect(WEIGHT).toBeGreaterThan(0);
  });

  it("renders every work state at the size and weight the rule states", () => {
    for (const state of WORK_STATES) {
      const style = chipStyle({ state });
      expect(style.fontSize, `${state} does not render at the rule's size`).toBe(FLOOR_PX);
      expect(style.fontWeight, `${state} does not render at the rule's weight`).toBe(WEIGHT);
    }
  });

  it("clamps a caller asking for smaller, rather than obeying", () => {
    // "never smaller than 12px" is the half a default alone does not deliver.
    for (const asked of [1, 8, 11, 11.5]) {
      expect(chipStyle({ state: "new", fontSize: asked }).fontSize).toBe(FLOOR_PX);
    }
    // Larger is a layout choice and stays the caller's to make.
    expect(chipStyle({ state: "new", fontSize: 14 }).fontSize).toBe(14);
  });

  it("will not let a style prop push it back under the floor", () => {
    // The spread order is what stops this; assert the outcome, not the order.
    expect(chipStyle({ state: "new", style: { fontSize: 9 } }).fontSize).toBe(FLOOR_PX);
  });
});

describe("registry rule 8 — nothing meaningful renders below the floor", () => {
  /**
   * The rule is about the whole app, not only the chip. A size below the floor
   * is allowed only where the element carries no meaning to lose — a spacer
   * that is `aria-hidden` or painted `transparent`.
   */
  function undersized(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(full);
          continue;
        }
        if (!/\.tsx$/.test(entry.name)) continue;
        for (const line of readFileSync(full, "utf8").split("\n")) {
          const match = /fontSize:\s*(\d+(?:\.\d+)?)/.exec(line);
          if (!match || Number(match[1]) >= FLOOR_PX) continue;
          const exempt = line.includes("aria-hidden") || line.includes('color: "transparent"');
          if (!exempt) found.push(`${full.replace(/\\/g, "/")}: ${match[1]}px`);
        }
      }
    };
    ["src/components", "src/app"].forEach(walk);
    return found.sort();
  }

  it("finds no meaningful type under the floor", () => {
    expect(undersized(), "renders meaning below the registry's floor").toEqual([]);
  });
});
