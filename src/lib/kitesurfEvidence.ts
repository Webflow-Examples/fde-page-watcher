import type { KitesurfEvidence } from "./types";

const URL_PATTERN = /https?:\/\/\S+/gi;
const INTERACTIVE_ARIA_ROLE = /^\s*-?\s*(button|checkbox|combobox|link|menuitem|option|radio|searchbox|slider|spinbutton|switch|tab|textbox)\b/i;

export const KITESURF_WORKFLOW_STEP_CONFIG = {
  retries: { limit: 0, delay: "1 second" },
  timeout: "90 seconds",
} as const;

export const KITESURF_OPERATION_TIMEOUTS = {
  launch: 15_000,
  context: 10_000,
  page: 10_000,
  navigation: 50_000,
  networkIdle: 12_000,
  settle: 2_000,
  metrics: 20_000,
  title: 15_000,
  renderedHtml: 20_000,
  accessibility: 12_000,
  store: 20_000,
  close: 5_000,
} as const;

export interface KitesurfOperationEvent {
  operation: string;
  outcome: "succeeded" | "failed";
  durationMs: number;
  error?: string;
}

export function safeKitesurfDetail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(URL_PATTERN, "[url]")
    .slice(0, 200);
}

/** Bound one browser operation independently so experimental APIs cannot consume the whole Workflow step. */
export async function runKitesurfOperation<T>(
  operation: string,
  timeoutMs: number,
  capture: () => Promise<T>,
  onEvent?: (event: KitesurfOperationEvent) => void,
): Promise<T> {
  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(capture),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Kitesurf ${operation} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    onEvent?.({ operation, outcome: "succeeded", durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    onEvent?.({
      operation,
      outcome: "failed",
      durationMs: Date.now() - startedAt,
      error: safeKitesurfDetail(error),
    });
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
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
