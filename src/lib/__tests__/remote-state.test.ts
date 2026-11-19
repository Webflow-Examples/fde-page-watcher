import { describe, expect, it } from "vitest";
import { buildInitialState } from "../seed";
import { historyWriteFrom } from "../store/remoteState";

describe("state write history member", () => {
  it("accepts a writer that says history did not move", () => {
    expect(historyWriteFrom("unchanged")).toBe("unchanged");
  });

  it("accepts a delta of nights to write and remove", () => {
    const night = buildInitialState("demo").pages[0].history[0];
    expect(historyWriteFrom({
      upserts: [{ pageId: "home", night }],
      deletes: [{ pageId: "home", i: 1 }],
    })).toEqual({
      upserts: [{ pageId: "home", night }],
      deletes: [{ pageId: "home", i: 1 }],
    });
  });

  it("distinguishes an absent member from a malformed one", () => {
    expect(historyWriteFrom(undefined)).toBeUndefined();
    expect(historyWriteFrom(null)).toBeNull();
    expect(historyWriteFrom("everything")).toBeNull();
    expect(historyWriteFrom({ upserts: [], deletes: [] })).toEqual({ upserts: [], deletes: [] });
    expect(historyWriteFrom({ upserts: [{ pageId: "home" }], deletes: [] })).toBeNull();
    expect(historyWriteFrom({ upserts: [], deletes: [{ pageId: "home", i: 1.5 }] })).toBeNull();
    expect(historyWriteFrom({ upserts: "none", deletes: [] })).toBeNull();
  });
});
