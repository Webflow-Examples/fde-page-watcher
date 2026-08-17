import { describe, expect, it } from "vitest";
import { buildInitialState } from "../seed";
import { hydrateTableHistory, stateWithoutEmbeddedHistory } from "../store/historyState";

describe("table-backed history state", () => {
  it("keeps histories out of the compare-and-swap blob and hydrates them by tenant page", () => {
    const state = buildInitialState("demo");
    const expected = structuredClone(state.pages[0].history);
    const persisted = stateWithoutEmbeddedHistory(state);

    expect(persisted.historyStorageVersion).toBe(1);
    expect(persisted.pages.every((page) => page.history.length === 0)).toBe(true);

    const hydrated = hydrateTableHistory(persisted, expected.map((night) => ({
      page_id: state.pages[0].id,
      i: night.i,
      night_json: JSON.stringify(night),
    })));
    expect(hydrated.pages[0].history).toEqual(expected);
    expect(hydrated.pages.slice(1).every((page) => page.history.length === 0)).toBe(true);
  });

  it("rejects a row whose key and payload indices disagree", () => {
    const state = stateWithoutEmbeddedHistory(buildInitialState("demo"));
    const night = buildInitialState("demo").pages[0].history[0];
    expect(() => hydrateTableHistory(state, [{
      page_id: state.pages[0].id,
      i: night.i + 1,
      night_json: JSON.stringify(night),
    }])).toThrow("Invalid history row index");
  });
});
