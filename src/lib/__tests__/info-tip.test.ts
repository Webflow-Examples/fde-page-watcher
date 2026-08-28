import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(moduleDir, "../../components/info-tip.tsx"), "utf8");
const styles = readFileSync(path.resolve(moduleDir, "../../app/globals.css"), "utf8");

/**
 * The tip's accessibility contract, asserted from its source.
 *
 * These are properties of the markup rather than of a render, which is the same
 * shape as the object-header tests in `case-applicability.test.ts` and the same
 * reason: there is no DOM in this suite, and the things worth protecting here
 * are structural. Each one is a way the tip has already been built wrong once,
 * or a way the next edit could quietly break it.
 */
describe("the information tip", () => {
  it("activates from the keyboard because it is a real button, not because of a key handler", () => {
    /**
     * Space and Enter on a `<button>` are the browser's job. Every hand-rolled
     * alternative — a `div` with `role="button"`, or a `keydown` switch on the
     * two keys — is a reimplementation that starts out equivalent and drifts:
     * it misses Space's scroll suppression, or the keyup/keydown asymmetry
     * between the two keys, or `:focus-visible`.
     */
    expect(source).toMatch(/<button\b[\s\S]*?type="button"/);
    expect(source).not.toMatch(/role="button"/);
  });

  it("swallows no key that the button needs", () => {
    // `preventDefault` on a keydown is how a button stops responding to Space,
    // and the symptom — "the icon does nothing for keyboard users" — is invisible
    // to everyone testing with a mouse.
    expect(source).not.toMatch(/preventDefault/);
    // Escape is the only key this component has an opinion about. A second one
    // appearing here means the button's own keys are being second-guessed.
    const handled = [...source.matchAll(/event\.key !== "([^"]+)"/g)].map((match) => match[1]);
    expect(handled).toEqual(["Escape"]);
  });

  it("dismisses on Escape without moving focus", () => {
    // WCAG 1.4.13. A reader who escapes a tip has not asked to go anywhere, so
    // the Escape path may close state and nothing else.
    expect(source).toMatch(/event\.key !== "Escape"/);
    expect(source).not.toMatch(/\.focus\(\)/);
    expect(source).not.toMatch(/\.blur\(\)/);
  });

  it("puts the text in a live region, so opening it announces something", () => {
    /**
     * `aria-expanded` reports that something opened and never says what it
     * said. The panel is mounted inside a `role="status"` that is always
     * present — a live region added at the same moment as its content is a
     * region screen readers were not yet watching.
     */
    expect(source).toMatch(/role="status"/);
    const region = source.indexOf('role="status"');
    const panel = source.indexOf('className="info-tip__panel"');
    expect(region).toBeGreaterThan(-1);
    expect(panel).toBeGreaterThan(region);
  });

  it("never points aria-controls at an id that is not in the document", () => {
    // The panel only exists while open, so the reference has to come and go
    // with it. A dangling IDREF is a broken relationship, not an empty one.
    expect(source).toMatch(/aria-controls=\{open \? tipId : undefined\}/);
  });

  it("keeps its own name still while its state changes", () => {
    // The state is on `aria-expanded`. A name that changes as you operate the
    // control is a name a voice user cannot say twice.
    expect(source).toMatch(/aria-label=\{`Diagnosis for \$\{label\}`\}/);
    expect(source).toMatch(/aria-expanded=\{open\}/);
  });

  it("caps its width at a named measure rather than a number at the use site", () => {
    // The app had no tooltip width to inherit; this is the first. Naming it is
    // what stops the second tip picking a different one.
    expect(styles).toMatch(/--info-tip-max-width:\s*20rem;/);
    expect(styles).toMatch(/max-width:\s*var\(--info-tip-max-width\)/);
  });

  it("survives the pointer travelling from the icon to the panel", () => {
    // The panel is `position: fixed`, so the trip between the two crosses
    // elements belonging to neither and `pointerleave` fires on the way. Hover
    // content that cannot be hovered fails WCAG 1.4.13.
    expect(source).toMatch(/CLOSE_DELAY_MS/);
    expect(source).toMatch(/onPointerEnter=\{holdOpen\}[\s\S]*onPointerEnter=\{holdOpen\}/);
  });
});
