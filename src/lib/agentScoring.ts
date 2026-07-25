import type {
  AgentCheck,
  AgentIgnoreOverrideMode,
  AgentIgnoreScope,
  AgentIgnoreSettings,
  AgentReadinessSnapshot,
  Night,
} from "./types";

const CHECK_KEY_SEPARATOR = "\u001f";

export interface AgentScoreSummary {
  pass: number;
  fail: number;
  total: number;
  unavailable: number;
  ignored: number;
  percent: number;
}

export function agentCheckKey(check: Pick<AgentCheck, "group" | "name">): string {
  return `${check.group}${CHECK_KEY_SEPARATOR}${check.name}`;
}

export function normalizeAgentIgnoreSettings(settings?: AgentIgnoreSettings): AgentIgnoreSettings {
  const checks = Array.isArray(settings?.checks) ? settings.checks : [];
  const groups = Array.isArray(settings?.groups) ? settings.groups : [];
  return {
    checks: [...new Set(checks.filter((value) => typeof value === "string" && value.length > 0))].sort(),
    groups: [...new Set(groups.filter((value) => typeof value === "string" && value.length > 0))].sort(),
  };
}

export function updateAgentIgnoreSettings(
  settings: AgentIgnoreSettings | undefined,
  scope: AgentIgnoreScope,
  value: string,
  ignored: boolean,
): AgentIgnoreSettings {
  const normalized = normalizeAgentIgnoreSettings(settings);
  const key = scope === "group" ? "groups" : "checks";
  const values = new Set(normalized[key]);
  if (ignored) values.add(value);
  else values.delete(value);
  return { ...normalized, [key]: [...values].sort() };
}

export function agentIgnoreOverrideMode(
  ignores: AgentIgnoreSettings | undefined,
  restores: AgentIgnoreSettings | undefined,
  scope: AgentIgnoreScope,
  value: string,
): AgentIgnoreOverrideMode {
  const ignoreSettings = normalizeAgentIgnoreSettings(ignores);
  const restoreSettings = normalizeAgentIgnoreSettings(restores);
  const key = scope === "group" ? "groups" : "checks";
  if (ignoreSettings[key].includes(value)) return "ignore";
  if (restoreSettings[key].includes(value)) return "restore";
  return "inherit";
}

export function updateAgentIgnoreOverride(
  ignores: AgentIgnoreSettings | undefined,
  restores: AgentIgnoreSettings | undefined,
  scope: AgentIgnoreScope,
  value: string,
  mode: AgentIgnoreOverrideMode,
): { ignores: AgentIgnoreSettings; restores: AgentIgnoreSettings } {
  let nextIgnores = updateAgentIgnoreSettings(ignores, scope, value, false);
  let nextRestores = updateAgentIgnoreSettings(restores, scope, value, false);
  if (mode === "ignore") nextIgnores = updateAgentIgnoreSettings(nextIgnores, scope, value, true);
  if (mode === "restore") nextRestores = updateAgentIgnoreSettings(nextRestores, scope, value, true);
  return { ignores: nextIgnores, restores: nextRestores };
}

export function isAgentGroupIgnored(
  group: string,
  ignores?: AgentIgnoreSettings,
  defaults?: AgentIgnoreSettings,
  restores?: AgentIgnoreSettings,
): boolean {
  const pageIgnores = normalizeAgentIgnoreSettings(ignores);
  const pageRestores = normalizeAgentIgnoreSettings(restores);
  if (pageRestores.groups.includes(group)) return false;
  if (pageIgnores.groups.includes(group)) return true;
  return normalizeAgentIgnoreSettings(defaults).groups.includes(group);
}

export function isAgentCheckIgnored(
  check: Pick<AgentCheck, "group" | "name">,
  ignores?: AgentIgnoreSettings,
  defaults?: AgentIgnoreSettings,
  restores?: AgentIgnoreSettings,
): boolean {
  const pageIgnores = normalizeAgentIgnoreSettings(ignores);
  const pageRestores = normalizeAgentIgnoreSettings(restores);
  const checkKey = agentCheckKey(check);
  if (pageRestores.checks.includes(checkKey)) return false;
  if (pageIgnores.checks.includes(checkKey)) return true;
  if (pageRestores.groups.includes(check.group)) return false;
  if (pageIgnores.groups.includes(check.group)) return true;
  const globalDefaults = normalizeAgentIgnoreSettings(defaults);
  return globalDefaults.groups.includes(check.group) || globalDefaults.checks.includes(checkKey);
}

export function summarizeAgentChecks(
  checks: AgentCheck[],
  ignores?: AgentIgnoreSettings,
  defaults?: AgentIgnoreSettings,
  restores?: AgentIgnoreSettings,
): AgentScoreSummary {
  let pass = 0;
  let fail = 0;
  let unavailable = 0;
  let ignored = 0;

  for (const check of checks) {
    if (isAgentCheckIgnored(check, ignores, defaults, restores)) ignored += 1;
    else if (check.unavailable) unavailable += 1;
    else if (check.pass) pass += 1;
    else fail += 1;
  }

  const total = pass + fail;
  return {
    pass,
    fail,
    total,
    unavailable,
    ignored,
    percent: total ? Math.round((pass / total) * 100) : 0,
  };
}

/** Freeze one run's score together with the exact checks ignored for that run. */
export function captureAgentReadiness(
  checks: AgentCheck[],
  ignores?: AgentIgnoreSettings,
  defaults?: AgentIgnoreSettings,
  restores?: AgentIgnoreSettings,
): AgentReadinessSnapshot {
  const summary = summarizeAgentChecks(checks, ignores, defaults, restores);
  const ignoredCheckKeys = checks
    .filter((check) => isAgentCheckIgnored(check, ignores, defaults, restores))
    .map(agentCheckKey)
    .sort();
  return { ...summary, ignoredCheckKeys };
}

/**
 * Read a historical score without reinterpreting it through today's settings.
 * Older records fall back to their raw checks until state normalization freezes
 * them into the new snapshot shape.
 */
export function agentReadinessForNight(
  night: Pick<Night, "agent" | "agentReadiness">,
  ignores?: AgentIgnoreSettings,
  defaults?: AgentIgnoreSettings,
  restores?: AgentIgnoreSettings,
): AgentReadinessSnapshot | null {
  if (night.agentReadiness) {
    return {
      ...night.agentReadiness,
      ignoredCheckKeys: [...(night.agentReadiness.ignoredCheckKeys ?? [])],
    };
  }
  if (!Array.isArray(night.agent)) return null;
  return captureAgentReadiness(night.agent, ignores, defaults, restores);
}
