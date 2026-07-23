import type { AgentCheck, AgentIgnoreScope, AgentIgnoreSettings } from "./types";

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

export function isAgentCheckIgnored(
  check: Pick<AgentCheck, "group" | "name">,
  settings?: AgentIgnoreSettings,
): boolean {
  const normalized = normalizeAgentIgnoreSettings(settings);
  return normalized.groups.includes(check.group) || normalized.checks.includes(agentCheckKey(check));
}

export function summarizeAgentChecks(
  checks: AgentCheck[],
  settings?: AgentIgnoreSettings,
): AgentScoreSummary {
  let pass = 0;
  let fail = 0;
  let unavailable = 0;
  let ignored = 0;

  for (const check of checks) {
    if (isAgentCheckIgnored(check, settings)) ignored += 1;
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
