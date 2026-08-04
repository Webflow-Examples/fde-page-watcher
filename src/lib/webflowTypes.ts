export type WebflowConnectionSyncStatus = "pending" | "running" | "succeeded" | "failed";
export type WebflowChangeDensity = "small" | "moderate" | "high-change";

export interface WebflowPublishSummary {
  id: string;
  publishedAt: string;
  previousPublishedAt: string;
  detectedAt: string;
  publisherName: string | null;
  domains: string[];
  activityCount: number;
  changeCount: number;
  pageCount: number;
  actorCount: number;
  resourceCount: number;
  changeDensity: WebflowChangeDensity;
}

export interface WebflowConnectionView {
  connected: true;
  siteId: string;
  displayName: string;
  shortName: string;
  domains: string[];
  timeZone: string;
  lastPublished: string | null;
  connectedAt: string;
  lastValidatedAt: string;
  lastSyncedAt: string | null;
  syncStatus: WebflowConnectionSyncStatus;
  syncError: string | null;
  activityEventCount: number;
  latestPublish: WebflowPublishSummary | null;
  latestActivity: {
    event: string;
    operation: string | null;
    actorName: string | null;
    createdOn: string;
    resourceName: string | null;
  } | null;
}

export interface WebflowDisconnectedView {
  connected: false;
}

export type WebflowConnectionStatus = WebflowConnectionView | WebflowDisconnectedView;

export interface WebflowSyncResult {
  ok: true;
  fetched: number;
  inserted: number;
  pages: number;
  syncedAt: string;
}
