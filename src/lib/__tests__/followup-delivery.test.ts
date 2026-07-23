import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFsStore } from "../store/fsStore";
import { pendingPage } from "../mutations";
import { processFollowUps } from "../collector";
import { scheduleFollowUps } from "../followups";
import type { CategoryScore, ChangeMarker, NightScores, StrategyScores } from "../types";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const cat = (m: number): CategoryScore => ({ m, lo: m, hi: m });
const nightScores = (m: number): NightScores => ({ perf: cat(m), a11y: cat(m), bp: cat(m), seo: cat(m) });
const strategyScores = (m: number): StrategyScores => ({ mobile: nightScores(m), desktop: nightScores(m) });

describe("follow-up attempt commits", () => {
  it("keeps a Slack 500 pending and records one bounded diagnostic attempt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fde-followup-"));
    roots.push(root);
    const dataStore = createFsStore("test", root);
    const marker: ChangeMarker = { id: "marker", i: 0, date: "2026-07-16", text: "Deployment" };
    const followUp = scheduleFollowUps("page", marker)[0];
    followUp.dueISO = "2026-07-18T00:00:00.000Z";
    await dataStore.updateState((state) => {
      const page = pendingPage("page", "Page", "https://example.com", "priority");
      page.history = [
        { i: 0, date: "Jul 14", iso: "2026-07-14T03:00:00.000Z", scores: strategyScores(70) },
        { i: 1, date: "Jul 18", iso: "2026-07-18T03:00:00.000Z", scores: strategyScores(75) },
      ];
      page.current = { mobile: { perf: 75, a11y: 75, bp: 75, seo: 75 }, desktop: { perf: 75, a11y: 75, bp: 75, seo: 75 } };
      page.markers = [marker];
      state.pages = [page];
      state.recs = [];
      state.followUps = [followUp];
    });

    const now = new Date("2026-07-20T03:00:00.000Z");
    const diagnostics = "x".repeat(700);
    await processFollowUps({ dataStore, now: () => now, followupFn: async () => ({ sent: false, status: 500, error: diagnostics }) });
    await processFollowUps({ dataStore, now: () => now, followupFn: async () => ({ sent: true, status: 200 }) });

    const stored = (await dataStore.getState()).followUps![0];
    expect(stored.sent).toBe(false);
    expect(stored.attempts).toBe(1);
    expect(stored.lastAttemptISO).toBe(now.toISOString());
    expect(stored.lastHttpStatus).toBe(500);
    expect(stored.lastError).toHaveLength(500);
  });

  it("leaves due follow-ups pending while their page is paused", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fde-followup-paused-"));
    roots.push(root);
    const dataStore = createFsStore("test", root);
    const marker: ChangeMarker = { id: "marker", i: 0, date: "2026-07-16", text: "Deployment" };
    const followUp = scheduleFollowUps("page", marker)[0];
    followUp.dueISO = "2026-07-18T00:00:00.000Z";
    await dataStore.updateState((state) => {
      const page = pendingPage("page", "Page", "https://example.com", "paused");
      page.history = [{ i: 0, date: "Jul 14", iso: "2026-07-14T03:00:00.000Z", scores: strategyScores(70) }];
      page.current = { mobile: { perf: 70, a11y: 70, bp: 70, seo: 70 }, desktop: { perf: 70, a11y: 70, bp: 70, seo: 70 } };
      page.markers = [marker];
      state.pages = [page];
      state.recs = [];
      state.followUps = [followUp];
    });
    let deliveries = 0;

    await processFollowUps({
      dataStore,
      now: () => new Date("2026-07-20T03:00:00.000Z"),
      followupFn: async () => {
        deliveries += 1;
        return { sent: true, status: 200 };
      },
    });

    const stored = (await dataStore.getState()).followUps![0];
    expect(deliveries).toBe(0);
    expect(stored.sent).toBe(false);
    expect(stored.attempts).toBe(0);

    await dataStore.updateState((state) => {
      state.pages[0].flag = "watching";
    });
    await processFollowUps({
      dataStore,
      now: () => new Date("2026-07-20T03:00:00.000Z"),
      followupFn: async () => {
        deliveries += 1;
        return { sent: true, status: 200 };
      },
    });

    const resumed = (await dataStore.getState()).followUps![0];
    expect(deliveries).toBe(1);
    expect(resumed.sent).toBe(true);
    expect(resumed.attempts).toBe(1);
  });
});
