import { describe, expect, it } from "vitest";
import { agentCheckKey } from "../agentScoring";
import { pendingPage } from "../mutations";
import { normalizeState } from "../store/normalize";
import type { AppState } from "../types";

describe("state normalization", () => {
  it("adds empty global defaults and page restore overrides to legacy state", () => {
    const page = pendingPage("page", "Page", "https://example.com", "priority");
    const checkKey = agentCheckKey({ group: "API / Auth / MCP", name: "WebMCP" });
    page.agentIgnores = { checks: [checkKey], groups: [] };
    delete page.agentIgnoreRestores;
    const legacy = { pages: [page], recs: [] } as AppState;

    const normalized = normalizeState(legacy);

    expect(normalized.agentIgnoreDefaults).toEqual({ checks: [], groups: [] });
    expect(normalized.pages[0].agentIgnores).toEqual({ checks: [checkKey], groups: [] });
    expect(normalized.pages[0].agentIgnoreRestores).toEqual({ checks: [], groups: [] });
  });
});
