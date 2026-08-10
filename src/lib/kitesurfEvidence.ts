import type { KitesurfEvidence } from "./types";

const URL_PATTERN = /https?:\/\/\S+/gi;
const INTERACTIVE_ARIA_ROLE = /^\s*-?\s*(button|checkbox|combobox|link|menuitem|option|radio|searchbox|slider|spinbutton|switch|tab|textbox)\b/i;

export function safeKitesurfDetail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(URL_PATTERN, "[url]")
    .slice(0, 200);
}

export function unavailableKitesurfEvidence(
  error: unknown,
  capturedAt = new Date().toISOString(),
): KitesurfEvidence {
  return {
    schemaVersion: 1,
    engine: "kitesurf",
    status: "unavailable",
    capturedAt,
    reason: safeKitesurfDetail(error),
  };
}
export function summarizeAriaSnapshot(snapshot: string): NonNullable<KitesurfEvidence["accessibility"]> {
  const nodes = snapshot
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    nodes: nodes.length,
    interactiveNodes: nodes.filter((line) => INTERACTIVE_ARIA_ROLE.test(line)).length,
  };
}
