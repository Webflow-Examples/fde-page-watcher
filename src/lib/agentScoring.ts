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

/**
 * Reasons as stored: a plain map of strings, checked for shape and nothing
 * else.
 *
 * Deliberately NOT checked against the registry here. This module decides
 * whether a check applies, and it imports no vocabulary — narrowing a stored
 * string to a decided reason is one job with one owner, and that owner is
 * `agentCheckExclusionReason` in `agent-access.ts`. A second check here would
 * be a second validator that could come to disagree with it.
 *
 * A reason whose key is no longer excluded is kept rather than pruned. It is a
 * decision somebody made, and the resolver reports that it does not apply
 * today; dropping it here would make "does not apply" indistinguishable from
 * "was never recorded".
 */
function storedReasons(settings?: AgentIgnoreSettings): Record<string, string> | undefined {
  const raw = settings?.reasons;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw)
    .filter(([key, value]) => typeof key === "string" && key.length > 0
      && typeof value === "string" && value.length > 0);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function normalizeAgentIgnoreSettings(settings?: AgentIgnoreSettings): AgentIgnoreSettings {
  const checks = Array.isArray(settings?.checks) ? settings.checks : [];
  const groups = Array.isArray(settings?.groups) ? settings.groups : [];
  const reasons = storedReasons(settings);
  return {
    checks: [...new Set(checks.filter((value) => typeof value === "string" && value.length > 0))].sort(),
    groups: [...new Set(groups.filter((value) => typeof value === "string" && value.length > 0))].sort(),
    ...(reasons ? { reasons } : {}),
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

/** The record that excluded a check, and the key it was excluded under. */
export interface AgentExclusionSource {
  /** The settings record that decided it — where its reason, if any, is kept. */
  settings: AgentIgnoreSettings;
  /** The key inside that record: a check key, or a group name. */
  key: string;
  scope: AgentIgnoreScope;
}

/**
 * Which record excluded this check, or null if nothing did.
 *
 * The precedence — page restore, page ignore, group restore, group ignore, then
 * the workspace defaults — is stated here and only here. `isAgentCheckIgnored`
 * asks this question and throws the answer away; the reason resolver asks the
 * same question and keeps it. Two walks over the same five rules would be the
 * defect rule 20 names: they agree today and the day they stop, a check reads
 * as excluded for a reason belonging to a record that did not exclude it.
 */
export function agentCheckExclusionSource(
  check: Pick<AgentCheck, "group" | "name">,
  ignores?: AgentIgnoreSettings,
  defaults?: AgentIgnoreSettings,
  restores?: AgentIgnoreSettings,
): AgentExclusionSource | null {
  const pageIgnores = normalizeAgentIgnoreSettings(ignores);
  const pageRestores = normalizeAgentIgnoreSettings(restores);
  const checkKey = agentCheckKey(check);
  if (pageRestores.checks.includes(checkKey)) return null;
  if (pageIgnores.checks.includes(checkKey)) {
    return { settings: pageIgnores, key: checkKey, scope: "check" };
  }
  if (pageRestores.groups.includes(check.group)) return null;
  if (pageIgnores.groups.includes(check.group)) {
    return { settings: pageIgnores, key: check.group, scope: "group" };
  }
  const globalDefaults = normalizeAgentIgnoreSettings(defaults);
  if (globalDefaults.groups.includes(check.group)) {
    return { settings: globalDefaults, key: check.group, scope: "group" };
  }
  if (globalDefaults.checks.includes(checkKey)) {
    return { settings: globalDefaults, key: checkKey, scope: "check" };
  }
  return null;
}

export function isAgentCheckIgnored(
  check: Pick<AgentCheck, "group" | "name">,
  ignores?: AgentIgnoreSettings,
  defaults?: AgentIgnoreSettings,
  restores?: AgentIgnoreSettings,
): boolean {
  return agentCheckExclusionSource(check, ignores, defaults, restores) !== null;
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
