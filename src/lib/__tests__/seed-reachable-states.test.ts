import { describe, expect, it } from "vitest";
import { buildEmptySeedState, buildInitialState, buildSeedState } from "../seed";
import { groupByRemediation } from "../issue-case";
import { issueCasesFrom } from "../../components/store";

/**
 * Two states the demo seed could not previously produce.
 *
 * Both were reachable only from a unit test, which meant nobody had looked at
 * either one in a browser. A multi-member remediation group is a whole layout —
 * a header with its own worst-of figure and member rows beneath it — and an
 * empty project is five or six empty states across the app. Reviewing those as
 * assertions is not the same as reading them.
 */

describe("the seed can produce a multi-member remediation group", () => {
  const cases = issueCasesFrom(buildSeedState());
  const groups = groupByRemediation(cases, {});

  it("groups two cases under one shared remediation", () => {
    const multi = groups.filter((group) => group.cases.length > 1);
    expect(multi.length).toBeGreaterThan(0);
  });

  it("groups them because the steps match, not because the cause does", () => {
    const multi = groups.find((group) => group.cases.length > 1)!;
    // Different causes — otherwise `groupByCause` would have folded them first
    // and the remediation grouping would never have been exercised.
    const causes = new Set(multi.cases.map((item) => item.cause));
    expect(causes.size).toBeGreaterThan(1);
    // One remediation, shared.
    for (const member of multi.cases) {
      expect(member.remediation.steps).toEqual(multi.remediation.steps);
    }
    expect(multi.remediation.steps.length).toBeGreaterThan(0);
  });

  it("shows the worst member's reading at the header, never the sum", () => {
    // Rule 19, on real seeded data rather than a fixture.
    const multi = groups.find((group) => group.cases.length > 1)!;
    const readings = multi.cases.map((item) => item.impactMs);
    expect(multi.impactMs).toBe(Math.max(...readings));
    const total = readings.reduce((sum, value) => sum + value, 0);
    if (readings.length > 1 && readings.some((value) => value > 0)) {
      expect(multi.impactMs).toBeLessThan(total);
    }
  });
});

describe("the seed can produce a project with no pages", () => {
  it("builds an empty state on request", () => {
    const empty = buildEmptySeedState();
    expect(empty.pages).toEqual([]);
    expect(empty.recs).toEqual([]);
    expect(issueCasesFrom(empty)).toEqual([]);
  });

  it("is selectable by name rather than only by pointing at production", () => {
    // Before this, the only route to an empty project was DATASET_MODE=live,
    // which is a deploy-level switch and brings a lot else with it.
    expect(buildInitialState("empty").pages).toEqual([]);
    expect(buildInitialState("live").pages).toEqual([]);
    expect(buildInitialState("demo").pages.length).toBeGreaterThan(0);
    expect(buildInitialState(undefined).pages.length).toBeGreaterThan(0);
  });
});
