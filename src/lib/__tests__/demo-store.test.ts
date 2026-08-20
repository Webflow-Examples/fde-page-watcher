import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFsStore } from "../store/fsStore";
import { DEMO_DATA_VERSION } from "../seed";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("filesystem demo fixture", () => {
  it("upgrades the disposable legacy sample namespace and exposes separate CrUX evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fde-demo-store-"));
    roots.push(root);
    const dir = path.join(root, ".data", "brand-studio");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "state.json"), JSON.stringify({
      tenant: "brand-studio",
      updatedAt: "2026-07-01T00:00:00.000Z",
      state: { pages: [], recs: [] },
    }));

    const dataStore = createFsStore("brand-studio", root);
    const state = await dataStore.getState();
    const crux = await dataStore.getCruxEvidence();

    expect(state.demoDataVersion).toBe(DEMO_DATA_VERSION);
    expect(state.pages.length).toBeGreaterThan(1);
    expect(crux.some(({ snapshots }) => snapshots.length > 1)).toBe(true);
    expect(crux.some(({ status }) => status?.status === "insufficient")).toBe(true);
  });

  it("does not leak demo CrUX into arbitrary tenant stores", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fde-demo-store-"));
    roots.push(root);
    expect(await createFsStore("customer-live", root).getCruxEvidence()).toEqual([]);
  });
});
