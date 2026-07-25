import { agentCheckKey, agentReadinessForNight } from "./agentScoring";
import type { AgentIgnoreSettings, AgentReadinessSnapshot, Night } from "./types";

export interface AgentReadinessHistoryPoint {
  night: Night;
  snapshot: AgentReadinessSnapshot;
  fixedNames: string[];
  ignoredNames: string[];
}

/**
 * Build chart points and explain the two meaningful state transitions:
 * a previously failing check passing, or a check becoming newly ignored.
 */
export function agentReadinessHistoryPoints(
  history: Night[],
  ignores?: AgentIgnoreSettings,
  defaults?: AgentIgnoreSettings,
  restores?: AgentIgnoreSettings,
): AgentReadinessHistoryPoint[] {
  const recorded = history.flatMap((night) => {
    const snapshot = agentReadinessForNight(night, ignores, defaults, restores);
    return snapshot?.total ? [{ night, snapshot }] : [];
  });

  return recorded.map((point, index) => {
    const previous = recorded[index - 1];
    const ignoredKeys = new Set(point.snapshot.ignoredCheckKeys);
    const previousIgnoredKeys = new Set(previous?.snapshot.ignoredCheckKeys ?? []);
    const previousFailingKeys = new Set(
      (previous?.night.agent ?? [])
        .filter((check) => !check.pass && !check.unavailable && !previousIgnoredKeys.has(agentCheckKey(check)))
        .map(agentCheckKey),
    );
    const fixedKeys = new Set(
      (point.night.agent ?? [])
        .filter((check) => check.pass && previousFailingKeys.has(agentCheckKey(check)))
        .map(agentCheckKey),
    );
    const newlyIgnoredKeys = index === 0
      ? new Set<string>()
      : new Set([...ignoredKeys].filter((key) => !previousIgnoredKeys.has(key)));
    const checkNames = new Map(
      [...(previous?.night.agent ?? []), ...(point.night.agent ?? [])]
        .map((check) => [agentCheckKey(check), check.name] as const),
    );

    return {
      ...point,
      fixedNames: [...fixedKeys].map((key) => checkNames.get(key) ?? key),
      ignoredNames: [...newlyIgnoredKeys].map((key) => checkNames.get(key) ?? key),
    };
  });
}
