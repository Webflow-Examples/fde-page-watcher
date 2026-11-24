import { DEFAULT_AUTOMATIONS, type AutomationSettings, type IntegrationSettingsRecord } from "./types";
import type { IntegrationStore } from "./store";

/**
 * Read and write the four named automations and the webhook URL.
 *
 * A patch is validated field by field against the known booleans rather than
 * spread: an unknown key must not become a setting nobody can turn off, and a
 * string must not be read as truthy. The names are the sentences, so there is
 * no expression language to parse and no rule builder to maintain.
 */

export const AUTOMATION_KEYS = [
  "acceptCreatesTask",
  "dismissClosesTask",
  "reopenCommentsAndReopens",
  "taskCompletionOffersMarkFixed",
] as const satisfies ReadonlyArray<keyof AutomationSettings>;

export class AutomationSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationSettingsError";
  }
}

export function normalizeAutomations(value: unknown): AutomationSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    acceptCreatesTask: raw.acceptCreatesTask === true,
    dismissClosesTask: raw.dismissClosesTask === true,
    reopenCommentsAndReopens: raw.reopenCommentsAndReopens === true,
    taskCompletionOffersMarkFixed: raw.taskCompletionOffersMarkFixed === true,
  };
}

export function automationPatch(input: unknown): Partial<AutomationSettings> {
  if (!input || typeof input !== "object") throw new AutomationSettingsError("automations must be an object");
  const raw = input as Record<string, unknown>;
  const patch: Partial<AutomationSettings> = {};
  for (const key of AUTOMATION_KEYS) {
    if (key in raw) {
      if (typeof raw[key] !== "boolean") throw new AutomationSettingsError(`${key} must be true or false`);
      patch[key] = raw[key];
    }
  }
  if (Object.keys(patch).length === 0) throw new AutomationSettingsError("no known automation was named");
  return patch;
}

export async function updateAutomations(
  store: IntegrationStore,
  patch: Partial<AutomationSettings>,
  now: Date = new Date(),
): Promise<IntegrationSettingsRecord> {
  const current = await store.getSettings();
  return store.saveSettings({
    ...current,
    automations: { ...DEFAULT_AUTOMATIONS, ...current.automations, ...patch },
    updatedAt: now.toISOString(),
  });
}
