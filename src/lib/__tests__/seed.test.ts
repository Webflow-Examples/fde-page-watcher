import { describe, expect, it } from "vitest";
import { visitorExperienceTrend } from "../visitorExperience";
import { normalizeState } from "../store/normalize";
import {
  buildInitialState,
  buildSeedCruxEvidence,
  buildSeedState,
  buildSeedWebflowConnectionStatus,
  DEMO_DATA_VERSION,
} from "../seed";

const NOW = new Date("2026-08-20T18:00:00.000Z");

describe("scenario-rich demo data", () => {
  it("covers monitoring, history, incident, and independent collection states", () => {
    const state = buildSeedState(NOW);
    const page = (id: string) => state.pages.find((candidate) => candidate.id === id)!;

    expect(state.demoDataVersion).toBe(DEMO_DATA_VERSION);
    expect(new Set(state.pages.map(({ flag }) => flag))).toEqual(new Set(["priority", "watching", "paused"]));
    expect(page("localization")).toMatchObject({ status: "pending", history: [] });
    expect(page("localization").baseline).toBeUndefined();
    expect(page("pricing").history).toHaveLength(45);
    expect(page("pricing").history.every((night) => Number.isFinite(Date.parse(night.iso!)))).toBe(true);
    expect(page("home").markers.filter((item) => item.i === page("home").markers[0].i)).toHaveLength(2);
    expect(page("designer").markers.some((item) => item.source === "task" && !!item.recKey)).toBe(true);

    const anomalies = state.pages.flatMap(({ history }) => history.filter((night) => night.evidenceStatus === "provider-anomaly"));
    expect(anomalies).toHaveLength(8);
    expect(new Set(anomalies.map(({ cohortId }) => cohortId))).toEqual(new Set(["nightly:demo-psi-outage"]));
    expect(state.measurementIncident).toMatchObject({ status: "verified", affectedPages: 4 });

    expect(page("ai").history.at(-2)).toMatchObject({ availableStrategies: ["mobile"], samples: { mobile: 3 } });
    expect(page("enterprise").history.at(-3)).toMatchObject({ availableStrategies: [], samples: {} });
    expect(page("templates")).toMatchObject({ flag: "paused", runState: "failed", lastCollectionStatus: "inconclusive" });
    expect(page("pricing").history.at(-1)?.collectionQuality?.mobile?.status).toBe("reliable");
    expect(page("pricing").history.at(-1)?.diagnostics?.mobile?.[0]).toMatchObject({ promoted: true, confidence: "high" });
    expect(page("hosting").history.at(-1)?.nativeElements?.variationRisk?.source).toBe("webflow-optimize");
    expect(page("ai").history.at(-1)?.kitesurf?.status).toBe("unavailable");

    const normalized = normalizeState(structuredClone(state));
    expect(Object.fromEntries(normalized.pages.map(({ id, status }) => [id, status]))).toMatchObject({
      home: "stable",
      pricing: "regressing",
      designer: "improving",
      hosting: "improving",
      templates: "regressing",
      localization: "pending",
    });
  });

  it("covers recommendation sources, task states, field lifecycles, and workspace settings", () => {
    const state = buildSeedState(NOW);
    expect(new Set(state.recs.map(({ source }) => source))).toEqual(new Set(["lighthouse", "native-elements", "crux-field-only"]));
    expect(new Set(state.recs.map(({ status }) => status))).toEqual(new Set(["inbox", "task", "ignored"]));
    expect(new Set(state.recs.filter(({ source }) => source === "crux-field-only").flatMap(({ fieldLifecycle }) =>
      Object.values(fieldLifecycle ?? {}).map(({ status }) => status),
    ))).toEqual(new Set(["active", "verifying"]));
    expect(state.visitorExperienceVisible).toBe(true);
    expect(state.collectionSchedule).toMatchObject({ timeZone: "America/Chicago", overridden: true });
    expect(state.followUps?.some(({ sent }) => sent)).toBe(true);
    expect(state.followUps?.some(({ retryAfterISO }) => !!retryAfterISO)).toBe(true);
    expect(state.watcherNote?.text).toContain("provider incident");
  });

  it("keeps live mode empty and free of demo-only metadata", () => {
    const state = buildInitialState("live");
    expect(state).toMatchObject({ pages: [], recs: [] });
    expect(state.demoDataVersion).toBeUndefined();
  });
});

describe("separately stored demo evidence", () => {
  it("covers URL and origin CrUX, all availability states, and different trends", () => {
    const evidence = buildSeedCruxEvidence(NOW);
    const item = (pageId: string, formFactor: "PHONE" | "DESKTOP") =>
      evidence.find((candidate) => candidate.pageId === pageId && candidate.formFactor === formFactor)!;

    expect(item("home", "PHONE").snapshots).toHaveLength(4);
    expect(item("designer", "PHONE").status?.effectiveScope).toBe("origin");
    expect(item("pricing", "DESKTOP").status?.status).toBe("partial");
    expect(item("enterprise", "PHONE")).toMatchObject({ snapshots: [], status: { status: "insufficient" } });
    expect(item("ai", "DESKTOP")).toMatchObject({ snapshots: [], status: { status: "error" } });
    expect(visitorExperienceTrend(item("home", "PHONE"))).toBe("stable");
    expect(visitorExperienceTrend(item("pricing", "PHONE"))).toBe("worsening");
    expect(visitorExperienceTrend(item("designer", "PHONE"))).toBe("improving");
  });

  it("includes a connected Webflow activity and publish scenario", () => {
    const status = buildSeedWebflowConnectionStatus(NOW);
    expect(status).toMatchObject({
      connected: true,
      syncStatus: "succeeded",
      latestPublish: { changeDensity: "high-change", pageCount: 6 },
      latestActivity: { event: "page_updated", resourceName: "Pricing" },
    });
  });
});
