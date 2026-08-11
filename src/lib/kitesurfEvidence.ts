import type { KitesurfEvidence } from "./types";

const URL_PATTERN = /https?:\/\/\S+/gi;
const INTERACTIVE_ARIA_ROLE = /^\s*-?\s*(button|checkbox|combobox|link|menuitem|option|radio|searchbox|slider|spinbutton|switch|tab|textbox)\b/i;

export const KITESURF_WORKFLOW_STEP_CONFIG = {
  retries: { limit: 0, delay: "1 second" },
  timeout: "90 seconds",
} as const;

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

/** Keep the rendered browser probe optional even when the Workflow engine rejects the step itself. */
export async function withUnavailableKitesurfFallback<T>(
  capture: () => Promise<{ evidence: KitesurfEvidence; nativeElements?: T }>,
  onUnavailable?: (evidence: KitesurfEvidence) => void,
): Promise<{ evidence: KitesurfEvidence; nativeElements?: T }> {
  try {
    return await capture();
  } catch (error) {
    const evidence = unavailableKitesurfEvidence(error);
    onUnavailable?.(evidence);
    return { evidence };
  }
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
