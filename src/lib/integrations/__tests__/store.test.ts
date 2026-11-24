import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createD1IntegrationStore,
  createFsIntegrationStore,
  createMemoryIntegrationStore,
  type IntegrationStore,
} from "../store";
import { connectionAad, sealSecret } from "../crypto";
import type { IntegrationConnectionRecord, IntegrationEventRecord, TaskLinkRecord } from "../types";
import { createSqliteD1 } from "./d1-sqlite";

const KEY = "test-integration-key-that-is-long-enough";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pw-integrations-"));
  dirs.push(dir);
  return dir;
}

function connection(projectId = "brand-studio", provider: "asana" | "linear" = "asana"): IntegrationConnectionRecord {
  const sealed = sealSecret("provider-token-plain", KEY, connectionAad(projectId, provider));
  return {
    id: `conn-${provider}`,
    projectId,
    provider,
    workspaceId: "ws-1",
    workspaceName: "Brand Studio",
    defaultDestinationId: "dest-1",
    defaultDestinationName: "Engineering",
    encryptedToken: sealed.ciphertext,
    tokenNonce: sealed.nonce,
    scopes: ["tasks:write"],
    installedBy: "rae@webflow.com",
    installedAt: "2026-11-01T10:00:00.000Z",
    status: "connected",
  };
}

function link(id: string, remediationKey: string, projectId = "brand-studio"): TaskLinkRecord {
  return {
    id,
    projectId,
    remediationKey,
    provider: "asana",
    connectionId: "conn-asana",
    externalId: `ext-${id}`,
    externalUrl: `https://app.asana.com/0/1/${id}`,
    externalState: "open",
    assignee: "Rae",
    lastSyncedAt: "2026-11-01T11:00:00.000Z",
    createdBy: "rae@webflow.com",
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
  };
}

function event(id: string, eventId: string, projectId = "brand-studio"): IntegrationEventRecord {
  return {
    id,
    projectId,
    provider: "page_watch",
    eventId,
    type: "page_watch.case_decided",
    payloadDigest: "abc",
    receivedAt: "2026-11-01T12:00:00.000Z",
  };
}

/**
 * The same script against both adapters. The results are returned rather than
 * asserted inside, so the parity test can compare the two JSON trees.
 */
async function runScript(store: IntegrationStore) {
  const saved = await store.saveConnection(connection(store.projectId));
  const savedAgain = await store.saveConnection({ ...connection(store.projectId), defaultDestinationName: "Renamed" });
  const firstLink = await store.createLink(link("link-1", "steps:direct:[\"fix it\"]", store.projectId));
  const duplicateLink = await store.createLink({ ...link("link-2", "steps:direct:[\"fix it\"]", store.projectId), externalId: "ext-other" });
  const updatedLink = await store.updateLink({ ...firstLink.record, externalState: "completed", updatedAt: "2026-11-02T00:00:00.000Z" });
  const firstEvent = await store.recordEvent(event("event-1", "decision:1", store.projectId));
  const duplicateEvent = await store.recordEvent(event("event-2", "decision:1", store.projectId));
  await store.markEventProcessed("page_watch", "decision:1", "2026-11-01T12:01:00.000Z", "delivered:200");
  const settings = await store.saveSettings({
    projectId: store.projectId,
    automations: {
      acceptCreatesTask: true,
      dismissClosesTask: false,
      reopenCommentsAndReopens: true,
      taskCompletionOffersMarkFixed: false,
    },
    webhookUrl: "https://hooks.example.test/pw",
    updatedAt: "2026-11-01T13:00:00.000Z",
  });
  await store.deleteLink("asana", "steps:direct:[\"fix it\"]");
  const afterDelete = await store.listLinks();
  const events = await store.listEvents();
  const connections = await store.listConnections();
  return {
    saved: { id: saved.id, provider: saved.provider, defaultDestinationName: saved.defaultDestinationName },
    savedAgain: { id: savedAgain.id, defaultDestinationName: savedAgain.defaultDestinationName },
    firstLink: { created: firstLink.created, id: firstLink.record.id, externalId: firstLink.record.externalId },
    duplicateLink: {
      created: duplicateLink.created,
      id: duplicateLink.record.id,
      externalId: duplicateLink.record.externalId,
    },
    updatedLink: { externalState: updatedLink.externalState, updatedAt: updatedLink.updatedAt },
    firstEvent: { created: firstEvent.created, id: firstEvent.record.id },
    duplicateEvent: { created: duplicateEvent.created, id: duplicateEvent.record.id },
    settings: settings.automations,
    afterDelete,
    events: events.map((entry) => ({ eventId: entry.eventId, processedAt: entry.processedAt, result: entry.result })),
    connections: connections.map((entry) => ({ id: entry.id, provider: entry.provider })),
  };
}

describe("integration store", () => {
  it("behaves the same on the filesystem and in D1", async () => {
    const root = await tempRoot();
    const fsStore = createFsIntegrationStore("brand-studio", root);
    const d1Store = createD1IntegrationStore("brand-studio", createSqliteD1());
    const [fsResult, d1Result] = await Promise.all([runScript(fsStore), runScript(d1Store)]);
    expect(d1Result).toEqual(fsResult);
  });

  it("keeps one link per project, provider and remediation", async () => {
    const store = createMemoryIntegrationStore("brand-studio");
    const first = await store.createLink(link("link-1", "steps:x"));
    const second = await store.createLink({ ...link("link-2", "steps:x"), externalId: "ext-second" });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.externalId).toBe("ext-link-1");
    expect(await store.listLinks()).toHaveLength(1);
  });

  it("allows the same remediation key for a different provider", async () => {
    const store = createMemoryIntegrationStore("brand-studio");
    await store.createLink(link("link-1", "steps:x"));
    const linear = await store.createLink({ ...link("link-2", "steps:x"), provider: "linear", connectionId: "conn-linear" });
    expect(linear.created).toBe(true);
  });

  it("scopes every collection to its project", async () => {
    const db = createSqliteD1();
    const a = createD1IntegrationStore("project-a", db);
    const b = createD1IntegrationStore("project-b", db);
    await a.saveConnection(connection("project-a"));
    await a.createLink(link("link-a", "steps:x", "project-a"));
    await a.saveSettings({ ...(await a.getSettings()), webhookUrl: "https://a.test" });
    expect(await b.listConnections()).toEqual([]);
    expect(await b.listLinks()).toEqual([]);
    expect((await b.getLink("asana", "steps:x"))).toBeNull();
    expect((await b.getSettings()).webhookUrl).toBeUndefined();
    expect(await a.listConnections()).toHaveLength(1);
  });

  it("never writes a plaintext token to the filesystem store", async () => {
    const root = await tempRoot();
    const store = createFsIntegrationStore("brand-studio", root);
    await store.saveConnection(connection("brand-studio"));
    const raw = await readFile(path.join(root, ".data", "integrations", "brand-studio", "integrations.json"), "utf8");
    expect(raw).not.toContain("provider-token-plain");
    expect(raw).toContain("encryptedToken");
  });

  it("rejects a project id that could escape its directory", () => {
    expect(() => createFsIntegrationStore("../escape")).toThrow(/projectId/);
    expect(() => createMemoryIntegrationStore("bad/id")).toThrow(/projectId/);
  });

  it("returns defaults for a project with no settings yet", async () => {
    const store = createMemoryIntegrationStore("brand-studio");
    const settings = await store.getSettings();
    expect(settings.projectId).toBe("brand-studio");
    expect(settings.automations.acceptCreatesTask).toBe(false);
  });
});
