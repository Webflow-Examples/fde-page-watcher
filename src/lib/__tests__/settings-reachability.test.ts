import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DESTINATION_PATH } from "../vocabulary";

/**
 * The appearance control must be reachable at 320px.
 *
 * This is the assertion that makes the sidebar's collapse correct rather than
 * broken. The sidebar footer keeps a copy of the control as a shortcut and
 * hides it on a narrow viewport; that is fine — and only fine — because
 * `/settings` is canonical and survives to 320px. If this test ever fails, the
 * sidebar's collapse becomes a real defect the same day.
 *
 * Checked structurally rather than by rendering, because what would break it is
 * a CSS rule or a layout container, not a component's return value. The three
 * ways it could break are the three things asserted: the route stops being
 * reachable, the group stops fitting, or something hides it outright.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(path.resolve(moduleDir, file), "utf8");

const css = read("../../app/globals.css");
const sidebar = read("../../components/Sidebar.tsx");
const settings = read("../../app/(app)/settings/page.tsx");

/** Every `@media (max-width: N)` block in the stylesheet, with its width. */
function narrowBlocks(): Array<{ width: number; body: string }> {
  const blocks: Array<{ width: number; body: string }> = [];
  const opener = /@media\s*\(max-width:\s*(\d+)px\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(css)) !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < css.length && depth > 0) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push({ width: Number(match[1]), body: css.slice(start, index - 1) });
  }
  return blocks;
}

describe("the appearance control at 320px", () => {
  it("is on a destination the collapsed sidebar still links to", () => {
    // Below 760px the sidebar becomes a row of icons: the labels are hidden but
    // every link survives, so Settings is one tap away at any width.
    expect(sidebar).toContain(`destination: "settings"`);
    expect(DESTINATION_PATH.settings).toBe("/settings");
    expect(settings).toContain("AppearanceControl");
  });

  it("is a shortcut in the sidebar, and the shortcut is the copy that may collapse", () => {
    /**
     * The order matters: `AppearanceControl` appears in the sidebar AFTER the
     * `sidebar-admin` container opens, which is the block globals.css hides on
     * a narrow viewport. That is what makes the collapse a shortcut
     * disappearing rather than the only control disappearing.
     */
    const container = sidebar.indexOf(`className="sidebar-admin"`);
    const control = sidebar.indexOf("<AppearanceControl");
    expect(container).toBeGreaterThan(-1);
    expect(control).toBeGreaterThan(container);
    expect(narrowBlocks().some(({ body }) => /\.sidebar-admin[^{]*\{[^}]*display:\s*none/.test(body))).toBe(true);
  });

  it("is never hidden, at any width", () => {
    // Nothing in a narrow-viewport block may hide a settings container. A
    // `display: none` here would silently remove the canonical control and
    // leave only the shortcut that is already hidden.
    for (const { width, body } of narrowBlocks()) {
      const hidden = /\.settings-[a-z-]*(?:__[a-z-]+)?[^{]*\{[^}]*display:\s*none/.exec(body);
      expect(hidden?.[0], `a settings container is hidden at ${width}px`).toBeUndefined();
    }
  });

  it("stacks its group rather than squeezing the control into a corner", () => {
    /**
     * The appearance group is a heading beside a three-segment control. Side by
     * side at 320px the control gets roughly 90px, which is not a control — so
     * the head stacks. Asserted because it is the rule that does the work, and
     * because deleting it would leave a screen that technically renders and
     * cannot be used.
     */
    const narrow = narrowBlocks().find(({ body }) => body.includes(".settings-group__head"));
    expect(narrow, "no narrow-viewport rule for the settings group head").toBeDefined();
    expect(narrow!.body).toMatch(/\.settings-group__head\s*\{[^}]*flex-direction:\s*column/);
    // And the page's own padding comes down with it, so a 320px viewport is not
    // spending a quarter of its width on gutters.
    expect(narrow!.body).toMatch(/\.settings-page\s*\{[^}]*padding:/);
  });

  it("lays the page out as a stack with nothing that cannot narrow", () => {
    // No fixed width, no min-width, no multi-column grid: the failure mode this
    // rules out is a horizontal scrollbar rather than a hidden control.
    const page = /\.settings-page\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(page).toContain("flex-direction: column");
    expect(page).not.toMatch(/min-width|grid-template-columns/);
    const group = /\.settings-group\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(group).toContain("min-width: 0");
  });
});
