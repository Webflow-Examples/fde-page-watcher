# Webflow Enterprise activity and verification

## Product contract

Page Watch treats Webflow activity as evidence around published frontend
changes, not as a generic audit-log feed and not as proof of causation.

The first release is intentionally constrained:

- Enterprise Webflow workspaces only.
- One Webflow site per Page Watch tenant.
- Customer-provided site token rather than OAuth.
- Required read scopes: `sites:read`, `site_activity:read`, `pages:read`,
  `assets:read`, and `cms:read`.
- Actor display names are retained and shown.
- Priority and Watching pages participate in automatic post-publish checks;
  Paused pages do not.
- Static and CMS-backed pages receive the same verification treatment.
- Verification flags a completed task but never changes its workflow state.

## Evidence model

The primary unit of correlation is a publish change set: activity since the
previous publish, the user who published it, affected pages/resources, related
completed tasks, and trusted Page Watch collections before and after it.

The product must distinguish:

- **Verified**: the targeted Lighthouse finding or agent-readiness failure is
  resolved in trusted post-publish evidence and remains resolved on
  confirmation.
- **Partially verified**: only part of the target improved, such as one device
  or one acceptance signal.
- **Not observed**: trusted checks completed and the original finding remains.
- **Regressed**: the targeted evidence worsened outside the configured noise
  band.
- **Inconclusive**: evidence is insufficient, anomalous, failed, or conflicting.

Timing alone must never be presented as causation. Regression explanations use
confidence labels and list the evidence supporting them.

## Connection and ingestion foundation

Implemented in the first slice:

- Settings connection form and safe status surface.
- Site ID/token validation against every required capability.
- AES-GCM token encryption inside the collector before D1 persistence.
- Tenant and site bound authenticated encryption.
- Normalized `webflow_connections` and `webflow_events` D1 tables.
- Raw activity payload retention in R2.
- Event deduplication by Webflow event ID.
- Actor, resource, page, branch, source, and modification-count extraction.
- Manual activity sync and automatic sync on the existing 15-minute schedule.
- Webflow sync failures recorded separately so they cannot block PSI.
- Idempotent publish detection from consecutive `lastPublished` timestamps.
- Publish-scoped event membership that refreshes to include delayed log entries.
- Publisher attribution when Webflow supplies a named publish event.
- Descriptive small, moderate, and high-change density bands.
- Latest publish evidence in the Settings connection surface.

The encryption key is a collector secret named
`WEBFLOW_TOKEN_ENCRYPTION_KEY`. Generate a base64-encoded 32-byte key with:

```bash
openssl rand -base64 32
```

Site tokens, ciphertext, IVs, and raw event payloads are never included in
`AppState` or returned to browser code.

## Planned phases

### Automatic post-publish collection

- Wait for a short propagation window after publication.
- Queue every Priority and Watching page.
- Reuse existing job coalescing so nightly/manual work is not duplicated.
- Link each collection job and trusted result to its initiating publish.

### Timeline experience

- Add Webflow publish markers to page history.
- Collapse raw activity under each publish marker.
- Show actor-aware evidence drawers and high-change descriptors.
- Keep raw event detail behind an Activity filter.

### Task verification

- Separate task completion from frontend verification.
- Match completed tasks to plausible publishes.
- Compare original Lighthouse IDs and agent-check keys before and after.
- Surface verified, partial, unchanged, regressed, and inconclusive flags.
- Require user review when more than one publish is plausible.

### Diagnostic enrichment

- Snapshot asset metadata and identify large or newly introduced assets.
- Associate CMS item activity with watched URLs.
- Add content-heavy, asset-heavy, and site-wide change summaries.
- Rank likely contributors without claiming unsupported causation.

## Operational acceptance criteria

- A tenant cannot connect two different sites without disconnecting first.
- Invalid, revoked, non-Enterprise, and insufficiently scoped tokens return
  actionable errors.
- Scheduled sync is idempotent and does not duplicate activity events.
- Actor names and affected resources survive ingestion.
- Raw payloads remain outside browser-readable state.
- Webflow outages never block scheduled PSI collection.
- Provider anomalies can never produce verified or regressed task outcomes.
