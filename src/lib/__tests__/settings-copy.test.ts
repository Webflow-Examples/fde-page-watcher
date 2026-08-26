import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MAX_DIGEST_RECIPIENTS,
  digestRecipientIsValid,
  formatDigestRecipients,
  normalizeDigestRecipients,
  parseDigestRecipients,
} from "../digestRecipients";
import { SENSITIVITY_LABEL, settingsMigrated, settingsSubtitle } from "../settings-copy";
import { APPLICABILITY_ACTION_LABEL, DESTINATION_LABEL } from "../vocabulary";

/**
 * The locked copy, verbatim, and the strings this module refuses to restate.
 *
 * The verbatim half is straightforward: the brief locked these words and a
 * paraphrase is a defect. The interesting half is the refusals — four of the
 * brief's strings are NOT in `settings-copy.ts`, because something else already
 * owns them, and a second copy would agree today and drift the first time
 * either was reworded (rule 20). This asserts the ownership rather than the
 * value, so the check survives a rewording of the thing it points at.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/**
 * Comments stripped first. The module explains at length why it does not carry
 * the four strings below, and a check that tripped over its own justification
 * would only teach the next editor to delete the paragraph.
 */
const copySource = readFileSync(path.resolve(moduleDir, "../settings-copy.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("the locked settings copy", () => {
  it("says exactly what the brief locked", () => {
    expect(settingsSubtitle("brandstudio.com"))
      .toBe("For brandstudio.com. Changes apply from the next nightly run.");
    expect(SENSITIVITY_LABEL.low).toBe("Only big moves");
    expect(SENSITIVITY_LABEL.normal).toBe("Normal");
    expect(SENSITIVITY_LABEL.high).toBe("Everything");
    expect(settingsMigrated(SENSITIVITY_LABEL.normal))
      .toBe("Your per-metric thresholds became the Normal setting. Change it in Settings.");
  });

  it("does not restate the title, which the registry names", () => {
    // "Settings" is `DESTINATION_LABEL.settings`. A screen does not name itself.
    expect(DESTINATION_LABEL.settings).toBe("Settings");
    expect(copySource).not.toMatch(/SETTINGS_TITLE|=\s*"Settings"/);
  });

  it("does not restate Include, which the applicability concept names", () => {
    expect(APPLICABILITY_ACTION_LABEL.include).toBe("Include");
    expect(copySource).not.toMatch(/"Include"/);
  });

  it("does not restate the limits, which the digest names", () => {
    // The value under the control comes from `digestLimit`. If a unit or a
    // number appeared in this module it would be a second spelling of a string
    // the digest already writes.
    expect(copySource).not.toMatch(/\bms"|\bms'|\b\d+\s?ms\b/);
  });
});

describe("who the digest goes to", () => {
  it("rejects the shapes that are certainly not addresses", () => {
    expect(digestRecipientIsValid("performance@example.com")).toBe(true);
    expect(digestRecipientIsValid("  performance@example.co.uk  ")).toBe(true);
    expect(digestRecipientIsValid("performance")).toBe(false);
    expect(digestRecipientIsValid("performance@example")).toBe(false);
    expect(digestRecipientIsValid("two people@example.com")).toBe(false);
    expect(digestRecipientIsValid("")).toBe(false);
  });

  it("reads a textarea as one address per line", () => {
    expect(parseDigestRecipients("a@example.com\n\n  b@example.com  \n"))
      .toEqual(["a@example.com", "b@example.com"]);
    expect(formatDigestRecipients(["a@example.com", "b@example.com"]))
      .toBe("a@example.com\nb@example.com");
  });

  it("stores one recipient per person, however they were typed", () => {
    // Two spellings of one address are one recipient. Sending twice would be
    // the product failing to read its own list.
    expect(normalizeDigestRecipients(["A@Example.com", "a@example.com", "b@example.com"]))
      .toEqual(["a@example.com", "b@example.com"]);
    expect(normalizeDigestRecipients(["not an address"])).toEqual([]);
    expect(normalizeDigestRecipients(undefined)).toEqual([]);
    expect(normalizeDigestRecipients("a@example.com")).toEqual([]);
  });

  it("caps the list rather than letting one site fan out without limit", () => {
    const many = Array.from({ length: MAX_DIGEST_RECIPIENTS + 5 }, (_, index) => `p${index}@example.com`);
    expect(normalizeDigestRecipients(many)).toHaveLength(MAX_DIGEST_RECIPIENTS);
  });
});
