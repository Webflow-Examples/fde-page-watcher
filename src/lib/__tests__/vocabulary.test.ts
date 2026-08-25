import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTIONABILITIES,
  ACTIONABILITY_LABEL,
  ACTIONABILITY_MEANS,
  ACTIONABILITY_REQUIRES_REASON,
  acceptIsOffered,
  AGENT_RESULTS,
  AGENT_RESULT_LABEL,
  CHECKPOINT_EVALUATION,
  CHECKPOINT_RESULTS,
  CHECKPOINT_RESULT_LABEL,
  CHECKPOINT_RESULT_MEANS,
  EVIDENCE_SOURCES,
  EVIDENCE_SOURCE_LABEL,
  APPLICABILITIES,
  APPLICABILITY_ACTIONS,
  APPLICABILITY_ACTION_LABEL,
  APPLICABILITY_LABEL,
  APPLICABILITY_MEANS,
  APPLICABILITY_TRANSITIONS,
  EXCLUSION_REASONS,
  applicabilityActionFor,
  applicabilityActionLabel,
  AGENT_VERDICTS,
  AGENT_VERDICT_LABEL,
  CONFIDENCES,
  CONFIDENCE_LABEL,
  DESTINATIONS,
  DESTINATION_LABEL,
  DESTINATION_PATH,
  DISMISS_REASONS,
  HEALTHS,
  HEALTH_LABEL,
  ISSUE_ACTIONS,
  ISSUE_ACTION_LABEL,
  ISSUE_TRANSITIONS,
  QUEUES,
  QUEUE_HOLDS,
  QUEUE_LABEL,
  TONES,
  TRENDS,
  TREND_LABEL,
  WORK_STATES,
  WORK_STATE_LABEL,
  WORK_STATE_MEANS,
  WORK_STATE_QUEUE,
  WORK_STATE_TONE,
  actionsFromState,
  parseQueue,
  statesInQueue,
} from "../vocabulary";

/**
 * `src/lib/vocabulary.ts` mirrors `vocabulary.json` (chunk F1). These tests are
 * the mechanism that stops the two from drifting: the registry is the source of
 * truth, and every union, label, and tone name in the module is asserted
 * against it here.
 */

interface RegistryValue {
  key: string;
  label: string;
  tone?: string;
  means?: string;
  queue?: string;
  holds?: string[] | "*";
  from?: string[];
  to?: string;
  requires?: string;
  reasons?: string[];
  path?: string;
  actor?: string | string[];
  entered_by?: string;
}

interface RegistryConcept {
  values: RegistryValue[];
  actions?: RegistryValue[];
  reasons?: string[];
  evaluation?: string[];
  banned_as_label: string[];
}

interface Registry {
  version: number;
  concepts: Record<string, RegistryConcept>;
  banned_global: { terms: string[]; allowlist: Record<string, string> };
}

const registryPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../vocabulary.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Registry;

const concept = (name: string): RegistryValue[] => {
  const found = registry.concepts[name];
  if (!found) throw new Error(`vocabulary.json is missing the "${name}" concept`);
  return found.values;
};

const keys = (name: string): string[] => concept(name).map((value) => value.key);
const labels = (name: string): Record<string, string> =>
  Object.fromEntries(concept(name).map((value) => [value.key, value.label]));

describe("vocabulary registry parity", () => {
  it("exports the work states, labels, tones, and meanings from the registry", () => {
    expect([...WORK_STATES]).toEqual(keys("work_state"));
    expect(WORK_STATE_LABEL).toEqual(labels("work_state"));
    expect(WORK_STATE_TONE).toEqual(
      Object.fromEntries(concept("work_state").map((value) => [value.key, value.tone])),
    );
    expect(WORK_STATE_MEANS).toEqual(
      Object.fromEntries(concept("work_state").map((value) => [value.key, value.means])),
    );
  });

  it("uses only tone names that appear in the registry, and no colour values", () => {
    const registryTones = new Set(concept("work_state").map((value) => value.tone));
    expect(new Set(Object.values(WORK_STATE_TONE))).toEqual(registryTones);
    for (const tone of Object.values(WORK_STATE_TONE)) {
      expect([...TONES]).toContain(tone);
      expect(tone).not.toMatch(/#|rgb|hsl|var\(/i);
    }
  });

  it("keeps five tones across seven states", () => {
    expect(WORK_STATES).toHaveLength(7);
    expect(new Set(Object.values(WORK_STATE_TONE)).size).toBe(5);
  });

  it("exports the queues, labels, and the states each one holds", () => {
    expect([...QUEUES]).toEqual(keys("queue"));
    expect(QUEUE_LABEL).toEqual(labels("queue"));
    for (const value of concept("queue")) {
      const expected = value.holds === "*" ? [...WORK_STATES] : value.holds;
      expect([...QUEUE_HOLDS[value.key as keyof typeof QUEUE_HOLDS]]).toEqual(expected);
    }
  });

  it("agrees with the registry about which queue each state belongs to", () => {
    for (const value of concept("work_state")) {
      expect(WORK_STATE_QUEUE[value.key as keyof typeof WORK_STATE_QUEUE]).toBe(value.queue);
    }
  });

  it("exports the actions, labels, transitions, and reason requirement", () => {
    expect([...ISSUE_ACTIONS]).toEqual(keys("action"));
    expect(ISSUE_ACTION_LABEL).toEqual(labels("action"));
    for (const value of concept("action")) {
      const transition = ISSUE_TRANSITIONS[value.key as keyof typeof ISSUE_TRANSITIONS];
      expect([...transition.from]).toEqual(value.from);
      expect(transition.to).toBe(value.to);
      expect(transition.requiresReason).toBe(value.requires === "reason");
    }
  });

  it("exports the dismiss reasons from the registry", () => {
    const dismissed = concept("work_state").find((value) => value.key === "dismissed");
    expect([...DISMISS_REASONS]).toEqual(dismissed?.reasons);
  });

  it("exports the remaining concepts and their labels", () => {
    expect([...TRENDS]).toEqual(keys("trend"));
    expect(TREND_LABEL).toEqual(labels("trend"));
    expect([...HEALTHS]).toEqual(keys("health"));
    expect(HEALTH_LABEL).toEqual(labels("health"));
    expect([...CONFIDENCES]).toEqual(keys("confidence"));
    expect(CONFIDENCE_LABEL).toEqual(labels("confidence"));
    expect([...AGENT_RESULTS]).toEqual(keys("agent_result"));
    expect(AGENT_RESULT_LABEL).toEqual(labels("agent_result"));
    expect([...AGENT_VERDICTS]).toEqual(keys("agent_verdict"));
    expect(AGENT_VERDICT_LABEL).toEqual(labels("agent_verdict"));
  });

  it("exports the four destinations, in registry order, with their paths", () => {
    expect([...DESTINATIONS]).toEqual(keys("destination"));
    expect(DESTINATIONS).toHaveLength(4);
    expect(DESTINATION_LABEL).toEqual(labels("destination"));
    expect(DESTINATION_PATH).toEqual(
      Object.fromEntries(concept("destination").map((value) => [value.key, value.path])),
    );
  });

  /**
   * Rule 4: "No word carries two different meanings. The same word MAY label
   * the same condition on different objects."
   *
   * A shared label is fine when both concepts key it the same way — that is the
   * same condition on a different object, like health.needs_work and
   * agent_verdict.needs_work. A shared label under *different* keys would mean
   * one word carrying two meanings, which is what rule 4 forbids.
   */
  it("only reuses a label across concepts when it names the same condition", () => {
    const seen = new Map<string, { concept: string; key: string }>();
    const conflicts: string[] = [];
    for (const [name, { values }] of Object.entries(registry.concepts)) {
      for (const { label, key } of values) {
        const previous = seen.get(label);
        if (previous && previous.key !== key) {
          conflicts.push(`"${label}" means ${previous.concept}.${previous.key} and ${name}.${key}`);
        }
        seen.set(label, { concept: name, key });
      }
    }
    expect(conflicts).toEqual([]);
  });

  it("keeps Needs work on both the page and the origin", () => {
    expect(HEALTH_LABEL.needs_work).toBe("Needs work");
    expect(AGENT_VERDICT_LABEL.needs_work).toBe("Needs work");
  });
});

/* ── The invariant that would have caught Resolved ───────────────────────── */

describe("lifecycle reachability", () => {
  /**
   * Rules 12 and 14: every state needs a way in and a way out, and both live in
   * the registry rather than in an implementer's local patch.
   *
   * Before v5, `resolved` had no inbound transition at all — nothing could
   * produce it, so the passing-checkpoint path had nowhere to land. The exit
   * half of this was already a rule; the entry half was not, and that asymmetry
   * is exactly what let it through. Both directions are asserted here.
   */
  const transitions = () => registry.concepts.action.values;
  const states = () => registry.concepts.work_state.values.map((value) => value.key);

  /** `new` is where a case is born, so it needs no inbound transition. */
  const INITIAL_STATE = "new";

  it("gives every state a legal entry", () => {
    const entered = new Set(transitions().map((action) => action.to));
    const unreachable = states().filter((state) => state !== INITIAL_STATE && !entered.has(state));
    expect(unreachable, `no transition produces: ${unreachable.join(", ")}`).toEqual([]);
  });

  it("gives every state a legal exit", () => {
    const exited = new Set(transitions().flatMap((action) => action.from ?? []));
    const deadEnds = states().filter((state) => !exited.has(state));
    expect(deadEnds, `no transition leaves: ${deadEnds.join(", ")}`).toEqual([]);
  });

  it("matches the module to the registry on both counts", () => {
    for (const state of WORK_STATES) {
      const exits = ISSUE_ACTIONS.filter((action) => ISSUE_TRANSITIONS[action].from.includes(state));
      expect(exits.length, `${state} has no exit in the module`).toBeGreaterThan(0);
      if (state === INITIAL_STATE) continue;
      const entries = ISSUE_ACTIONS.filter((action) => ISSUE_TRANSITIONS[action].to === state);
      expect(entries.length, `${state} has no entry in the module`).toBeGreaterThan(0);
    }
  });

  it("reaches every state from new", () => {
    // A state with an inbound edge that is itself unreachable is still a dead
    // state, so walk the graph rather than trusting the edge lists.
    const seen = new Set([INITIAL_STATE]);
    for (let pass = 0; pass < states().length; pass += 1) {
      for (const action of transitions()) {
        if ((action.from ?? []).some((from) => seen.has(from))) seen.add(action.to as string);
      }
    }
    expect([...states()].filter((state) => !seen.has(state))).toEqual([]);
  });

  it("says who fires each transition, and keeps Resolve off the buttons", () => {
    for (const action of transitions()) {
      expect(action.actor, `${action.key} does not say who fires it`).toBeDefined();
    }
    const resolve = transitions().find((action) => action.key === "resolve");
    expect(resolve?.actor).toBe("system");
    expect(ISSUE_TRANSITIONS.resolve.actor).toEqual(["system"]);
    expect(ISSUE_TRANSITIONS.resolve.requires).toBe("checkpoint_agreement");
    // It has a label for history copy, but nothing offers it as an action.
    expect(actionsFromState("fixed")).toContain("resolve");
  });
});

describe("checkpoint", () => {
  const checkpoint = () => registry.concepts.checkpoint;

  it("exports the four results, labels, and meanings", () => {
    expect([...CHECKPOINT_RESULTS]).toEqual(checkpoint().values.map((value) => value.key));
    expect(CHECKPOINT_RESULT_LABEL).toEqual(
      Object.fromEntries(checkpoint().values.map((value) => [value.key, value.label])),
    );
    expect(CHECKPOINT_RESULT_MEANS).toEqual(
      Object.fromEntries(checkpoint().values.map((value) => [value.key, value.means])),
    );
  });

  it("carries the evaluation rules verbatim", () => {
    expect([...CHECKPOINT_EVALUATION]).toEqual(checkpoint().evaluation);
  });

  it("is not a check: it agrees or disagrees, never passes or fails", () => {
    // Rule 4 — passed/failed name a check's outcome, on a different object.
    for (const banned of ["passed", "failed", "pending"]) {
      expect([...CHECKPOINT_RESULTS]).not.toContain(banned);
    }
    // And it is not a work state either.
    for (const result of CHECKPOINT_RESULTS) {
      expect([...WORK_STATES]).not.toContain(result as never);
    }
  });
});

describe("evidence source", () => {
  const sources = () => registry.concepts.evidence_source.values;

  it("exports every slot and its label", () => {
    expect([...EVIDENCE_SOURCES]).toEqual(sources().map((value) => value.key));
    expect(EVIDENCE_SOURCE_LABEL).toEqual(
      Object.fromEntries(sources().map((value) => [value.key, value.label])),
    );
  });

  it("gives Page Watch and Ora separate slots, so they can disagree", () => {
    // One slot for two systems made confidenceFrom count them as one voice.
    expect([...EVIDENCE_SOURCES]).toContain("agent-readiness");
    expect([...EVIDENCE_SOURCES]).toContain("ora");
  });

  it("has no slot without a producer", () => {
    // Rule 15. is-agentic was defined ahead of its integration and removed.
    expect([...EVIDENCE_SOURCES]).not.toContain("is-agentic" as never);
  });
});

describe("actionability", () => {
  const values = () => registry.concepts.actionability.values;

  it("exports the four values, labels, and meanings", () => {
    expect([...ACTIONABILITIES]).toEqual(values().map((value) => value.key));
    expect(ACTIONABILITY_LABEL).toEqual(
      Object.fromEntries(values().map((value) => [value.key, value.label])),
    );
    expect(ACTIONABILITY_MEANS).toEqual(
      Object.fromEntries(values().map((value) => [value.key, value.means])),
    );
  });

  it("requires a reason only where the registry does — rule 17", () => {
    expect(ACTIONABILITY_REQUIRES_REASON).toEqual(
      Object.fromEntries(values().map((value) => [value.key, value.requires === "reason"])),
    );
    expect(ACTIONABILITY_REQUIRES_REASON.none).toBe(true);
  });

  it("blocks Accept only when there is no documented remediation", () => {
    expect(acceptIsOffered("none")).toBe(false);
    for (const value of ["direct", "workaround", "platform"] as const) {
      expect(acceptIsOffered(value)).toBe(true);
    }
  });
});

describe("applicability", () => {
  const applicability = () => {
    const found = registry.concepts.applicability;
    if (!found) throw new Error("vocabulary.json is missing the applicability concept");
    return found;
  };

  it("exports the two values, their labels, and their meanings", () => {
    expect([...APPLICABILITIES]).toEqual(applicability().values.map((value) => value.key));
    expect(APPLICABILITY_LABEL).toEqual(
      Object.fromEntries(applicability().values.map((value) => [value.key, value.label])),
    );
    expect(APPLICABILITY_MEANS).toEqual(
      Object.fromEntries(applicability().values.map((value) => [value.key, value.means])),
    );
  });

  it("exports the actions and their transitions, including the reason requirement", () => {
    const actions = applicability().actions ?? [];
    expect([...APPLICABILITY_ACTIONS]).toEqual(actions.map((action) => action.key));
    expect(APPLICABILITY_ACTION_LABEL).toEqual(
      Object.fromEntries(actions.map((action) => [action.key, action.label])),
    );
    for (const action of actions) {
      const transition = APPLICABILITY_TRANSITIONS[action.key as keyof typeof APPLICABILITY_TRANSITIONS];
      expect([...transition.from]).toEqual(action.from);
      expect(transition.to).toBe(action.to);
      expect(transition.requiresReason).toBe(action.requires === "reason");
    }
  });

  it("exports the exclusion reasons", () => {
    expect([...EXCLUSION_REASONS]).toEqual(applicability().reasons);
  });

  it("offers the opposite action for whatever something currently is", () => {
    expect(applicabilityActionFor("included")).toBe("exclude");
    expect(applicabilityActionFor("excluded")).toBe("include");
    expect(applicabilityActionLabel("included")).toBe("Exclude");
    expect(applicabilityActionLabel("excluded")).toBe("Include");
  });

  it("is not a lifecycle — it shares no label with the work states", () => {
    const workStateLabels = new Set(Object.values(WORK_STATE_LABEL));
    for (const label of Object.values(APPLICABILITY_LABEL)) {
      expect(workStateLabels.has(label), `"${label}" is both an applicability and a work state`).toBe(false);
    }
  });
});

describe("banned vocabulary", () => {
  /**
   * The allowlist may only shrink. This is the recorded set as of C1a; a chunk
   * that cleans a file removes its entry, and this test fails if anything new
   * is ever added instead of fixed.
   */
  const ALLOWLIST_BASELINE = new Set([
    "src/lib/guide.ts",
    "src/app/(app)/watchlist/page.tsx",
    "src/app/(app)/pages/[id]/page.tsx",
    "src/components/bits.tsx",
    "src/components/store.tsx",
    "src/components/agent-access.tsx",
  ]);

  const allowlistedFiles = () =>
    Object.keys(registry.banned_global.allowlist).filter((key) => !key.startsWith("$"));

  it("enforces exactly the fifteen globally banned terms", () => {
    expect(registry.banned_global.terms).toHaveLength(15);
  });

  it("never grows the allowlist — a new violation must be fixed, not excused", () => {
    const added = allowlistedFiles().filter((file) => !ALLOWLIST_BASELINE.has(file));
    expect(added, `these were added to the allowlist rather than fixed: ${added.join(", ")}`).toEqual([]);
  });

  it("gives every allowlisted file the chunk that clears it", () => {
    for (const file of allowlistedFiles()) {
      expect(registry.banned_global.allowlist[file], `${file} has no owning chunk`).toMatch(/\S/);
    }
  });

  it("keeps banned_as_label out of the globally enforced list where it is ordinary English", () => {
    // Rule 9: banned_as_label is per-concept, banned_global is prose-wide. These
    // words are legitimately unavoidable in code and copy.
    for (const ordinary of ["All", "Open", "Active", "Done", "Error", "Score"]) {
      expect(registry.banned_global.terms).not.toContain(ordinary);
    }
  });
});

describe("vocabulary helpers", () => {
  it("falls back to Decide for missing or unrecognised queue values", () => {
    expect(parseQueue("fix")).toBe("fix");
    expect(parseQueue("show_all")).toBe("show_all");
    expect(parseQueue(null)).toBe("decide");
    expect(parseQueue(undefined)).toBe("decide");
    expect(parseQueue("inbox")).toBe("decide");
  });

  it("puts New and Reopened in Decide, and everything in Show all", () => {
    expect([...statesInQueue("decide")]).toEqual(["new", "reopened"]);
    expect([...statesInQueue("show_all")]).toEqual([...WORK_STATES]);
  });

  it("offers Accept and Dismiss on the states Decide holds", () => {
    for (const state of statesInQueue("decide")) {
      expect([...actionsFromState(state)]).toEqual(["accept", "dismiss"]);
    }
    expect([...actionsFromState("todo")]).toEqual(["start"]);
    expect([...actionsFromState("in_progress")]).toEqual(["mark_fixed"]);
    expect([...actionsFromState("resolved")]).toEqual(["reopen"]);
  });
});
