---
name: extension-authoring
description: Author, validate, and promote a Webflow extension draft. Use when the user asks to create a reusable Studio skill, build or add a Studio View or extension, deliver an Extension Tool, define a webflow.json manifest, or understand the draft-to-promote lifecycle.
---

# Extension authoring and promotion

Use this skill for a Webflow extension package when the user explicitly asks to create a reusable Studio skill, create, build, or add a Studio View, asks for an extension, or a request is best delivered as an Extension Tool. Complete the full host-mediated lifecycle without waiting to be told the steps.

## Skill-only extensions

When the user asks to create a skill, call `scaffold_extension_skill_draft` with a short kebab-case skill name, a concise description of when to use it, and its complete Markdown instructions. The host creates a skill-only extension draft with a fixed `contributes.skills` declaration and `skills/<skill-name>/SKILL.md`; never write into `.webflow/skills`, invent another skill path, or hand-edit the manifest and no-op logic entrypoint. Call `validate_extension_draft`, repair only the returned `SKILL.md` body if needed, then ask for chat confirmation and call `promote_extension_draft`. The skill only becomes discoverable once extension binding is enabled and, on the next catalog load, an Agent is bound to the promoted extension. This does not make a custom extension ambient or change another extension's trust.

## Local site snapshots

When a requested View must show data found in the local site or project files rather than a connected Content Source, use `list` to inspect the workspace root and likely source directories, then `read` the identified UTF-8 text files before scaffolding. `search` is limited to a known extension draft and cannot discover normal project source. Read only what the snapshot needs, not an entire large file, and skip anything named or shaped like a secret, such as `.env` files, key material, `.ssh`, `.aws`, or other credential paths; never render that content into a View. Render only a fixed, bounded snapshot of data actually found in those files. Do not inspect Site Browser content, access a provider or network, request `content.*` capabilities, or add refresh behavior for this snapshot. If the data is unavailable locally, ask the user for a source path; never fabricate fallback data.

## Connected Content Views

A request that names a CMS or content platform, such as "show data from my Sanity CMS", asks for connected project Content rather than a local-file snapshot. Studio owns the provider connection and exposes provider-neutral `content.*` reads, so the same recipe serves every connected provider and no extension ever holds a provider SDK, a raw provider query such as GROQ, credentials, `fetch`, or network access.

Discover before scaffolding:

1. Call `list_content_sources` and match the platform the user named against each Source's `provider` value. When nothing matches, tell the user to connect that Content Source in Studio and stop; never fabricate items or ask for credentials.
2. Call `list_content_types` for the matched Source when the request names or implies a type. Ask one concise question when several Sources or Types plausibly match.
3. Call `list_extension_capabilities`, then `get_extension_capability` for every `content.*` method the extension will declare.

Declare the smallest sufficient reads. A list View needs `content.listSources`, `content.listTypes`, and `content.queryItems`. Add `content.getType` only when the UI is driven by the Type's field schema, and `content.getItem` only when the View shows an item's full fields, because `content.queryItems` returns bounded summaries and `content.getItem` is the only full-record read. Never declare a Content write or `selection.set` for this path.

Each read depends on refs returned by the previous call, so this is a multi-step intent: call `scaffold_extension_draft` with `workflows` rather than `operations`, pairing one lower-kebab-case intent id with those capability methods. The host writes the manifest, `src/intents.ts`, `src/extension.ts`, and a runnable View, and generates one agent-owned `src/workflows/<id>.ts` to implement. Keep every `content.*` call in that workflow: the View calls `view.intent(...)` and never touches a capability. Implement a `load-content` workflow like this, changing the provider, Type selection, and returned fields to fit the request.

<!-- connected-content-workflow:start -->

```ts
import { matchTypedCapabilityResult } from "@webflow/extension-sdk";
import type { LoadContentInput, LoadContentStudio, WorkflowResult } from "../intents";

/** The platform the user named. `list_content_sources` reports it as `provider`. */
const REQUESTED_PROVIDER = "sanity";

/**
 * Reads a connected Content Source through Studio's provider-neutral capabilities.
 * Every `content.*` call stays here in Extension Logic; the View sees only this result.
 */
export async function loadContent(
  input: LoadContentInput,
  studio: LoadContentStudio,
): Promise<WorkflowResult> {
  const sources = matchTypedCapabilityResult(await studio.content.listSources(), {
    ok: (outcome) => outcome.data.sources,
    needs_input: () => null,
    blocked: () => null,
    unknown: () => null,
  });
  if (!sources) return { status: "blocked", reason: "runtime" };

  // Fail closed on an ambiguous match instead of guessing: a project can have
  // more than one Source for the same provider, and silently reading the
  // first one would show real content from the wrong Source.
  const matchingSources = sources.filter((candidate) => candidate.provider === REQUESTED_PROVIDER);
  if (matchingSources.length === 0) {
    return {
      status: "needs_input",
      data: { prompt: `Connect a ${REQUESTED_PROVIDER} Content Source to this project first.` },
    };
  }
  const requestedSourceId = typeof input.sourceId === "string" ? input.sourceId : null;
  const source = requestedSourceId
    ? matchingSources.find((candidate) => candidate.id === requestedSourceId)
    : matchingSources.length === 1
      ? matchingSources[0]
      : null;
  if (!source) {
    return {
      status: "needs_input",
      data: {
        prompt:
          matchingSources.length > 1
            ? `More than one ${REQUESTED_PROVIDER} Content Source is connected: ${matchingSources
                .map((candidate) => candidate.title)
                .join(", ")}. Which one should this View read?`
            : `Choose a ${REQUESTED_PROVIDER} Content Source for this View.`,
        sourceChoices: matchingSources.map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
        })),
      },
    };
  }

  const types = matchTypedCapabilityResult(
    await studio.content.listTypes({ sourceId: source.id }),
    {
      ok: (outcome) => outcome.data.types,
      needs_input: () => null,
      blocked: () => null,
      unknown: () => null,
    },
  );
  if (!types) return { status: "blocked", reason: "runtime" };

  // Same rule for the Type: only skip asking when the caller named one or
  // exactly one candidate remains.
  const requestedTypeId = typeof input.typeId === "string" ? input.typeId : null;
  const type = requestedTypeId
    ? types.find((candidate) => candidate.id === requestedTypeId)
    : types.length === 1
      ? types[0]
      : null;
  if (!type) {
    return {
      status: "needs_input",
      data: {
        prompt:
          types.length > 1
            ? `Choose a Content Type in ${source.title}: ${types.map((candidate) => candidate.title).join(", ")}.`
            : `Choose a Content Type in ${source.title}.`,
        typeChoices: types.map((candidate) => ({ id: candidate.id, title: candidate.title })),
      },
    };
  }

  const cursor = typeof input.cursor === "string" ? input.cursor : undefined;
  const page = matchTypedCapabilityResult(
    await studio.content.queryItems({
      sourceId: source.id,
      typeId: type.id,
      sort: "updated-desc",
      limit: 20,
      cursor,
    }),
    {
      ok: (outcome) => outcome.data,
      needs_input: () => null,
      blocked: () => null,
      unknown: () => null,
    },
  );
  if (!page) return { status: "blocked", reason: "runtime" };

  return {
    status: "ok",
    data: {
      sourceTitle: source.title,
      typeTitle: type.title,
      items: page.items.map((item) => ({ id: item.ref.itemId, title: item.title })),
      nextCursor: page.nextCursor ?? null,
    },
  };
}
```

<!-- connected-content-workflow:end -->

The shape stays the same whether the Source is Sanity or any other connected provider. Give the View what it needs for its loading, empty, error, and needs-input states rather than only the happy path; a `needs_input` result carries the actionable message and candidate ids/titles that the View needs to let the user choose, such as which Content Source to connect.

A `workflows` draft always scaffolds `profile: "plain"`, so its View entry is `src/view.ts`, not the managed `src/view.tsx` default, and the host's generated `view.html` and `src/view.ts` are a generic JSON-input harness: a JSON textarea and a Run button that call the workflow with whatever object the user types. Replace both with the actual list, loading, empty, error, and needs-input UI before promoting; do not ship the JSON harness as the finished Content View.

## Composed operations

When an Extension View delegates Studio capabilities of one invocation mode, call `list_extension_capabilities`, then call `scaffold_extension_draft` with `operations`: one intent id and one capability method per operation. The host writes a complete manifest, shared intent map, typed logic, and runnable View. Request-response Views start with fixed, runtime-valid catalog example parameters; add Blueprint controls to the managed View when users need editable values. Stream and event-subscription Views include agent-owned `src/customize.ts` for live data. Validate that baseline before customizing presentation. Retry the same composed request when the host needs to refresh its generated contract; it preserves the customized View entry (`src/view.tsx` for the default managed React profile, or `src/view.ts` for an explicit `profile: "plain"` draft) and `view.html`. Do not use a retry to change the extension id, display name, or operations. Do not recreate its manifest, intent map, or logic by reading declarations and assembling them yourself. Use an untemplated draft only for behavior that cannot be expressed as one capability per intent, such as a domain-specific multi-step workflow.

## Required workflow

1. Call `list_admitted_extension_views` before inspecting or modifying a View that might already exist. This is the authoritative inventory of project Views that are live in Studio. Promotion intentionally retains drafts, so a matching or similarly named draft never proves that its bytes, UI profile, or design are live. For a returned View, inspect its promoted manifest and entrypoint under `.webflow/extensions/<extension-id>/` before reading any draft variants, and preserve that extension id for replacement.
2. Call `list_extension_capabilities` before choosing the smallest sufficient manifest grants. Call `get_extension_capability` for the complete parameter shape, results, scope behavior, review implications, examples, and UI hints of every API the extension will call.
3. Call `scaffold_extension_draft` with a short kebab-case `draftId`, intended extension id, display name, and `operations` whenever the requested behavior maps one intent to one capability of a single invocation mode. The host creates `.webflow/drafts/extensions/<draft-id>/` with typed starter files and host-owned SDK artifacts.
4. Validate a composed draft before editing it. Preserve its generated `webflow.json`, `src/intents.ts`, and `src/extension.ts`; customize only the scaffolded View entry and `view.html` unless the user explicitly needs behavior the composer cannot express. `scaffold_extension_draft` defaults every new View to the managed React profile, so that entry is `src/view.tsx` unless the draft explicitly requested `profile: "plain"`, in which case it is `src/view.ts`. Read the tool result's `profile` and `authoredFilesCreated` to confirm which file the draft actually has rather than assuming a filename.
   For a managed draft, call `list_managed_ui_components` to search compact admitted component cards, then call `get_managed_ui_components` once with every exact component name selected for the task. The batch result provides complete generated props, variants, composition, accessibility, and decision guidance while distinguishing admitted, not-admitted, and unknown names. Catalog guidance grants no Extension authority; `managed-import-surface` remains the admission gate. Read `.webflow/skills/extension-authoring/EXTENSION_UI_REFERENCE.md` for the matching recipe, semantic token names and CSS variables, lifecycle patterns, examples, and directly assignable responsive geometry that component lookups do not cover. Route styling through a semantic component prop first, a recipe value second, a generated semantic token third, and never a raw value.
   Keep three things true in a managed draft or its build fails: the scaffolded `data-webflow-extension-ui` element stays in the HTML, the entry keeps mounting its React root into that element, and the UI is built from `@webflow/extension-ui` components rather than bare markup. Studio injects Blueprint styles and theme state into that marked element only, so breaking any of them produces an unstyled surface instead of a visible error.
5. For an untemplated draft, call `get_extension_capability` before editing every SDK call. It is the host-owned source for capability parameters and outcomes. The vendored `types/*.d.ts` declaration chain remains useful editor support: `types/webflow-extension.d.ts` and `types/webflow-extension-view.d.ts` are entrypoints, while `types/extension.d.ts`, `types/intent-map.d.ts`, `types/capability-contracts.d.ts`, and `types/shared.d.ts` provide local type navigation. `types/metadata.json` records artifact versions and a content digest; it does not define capability shapes.
6. Call `validate_extension_draft`. Fix every returned diagnostic in authored source, then call it again. Repeat until diagnostics are clean. Managed diagnostic labels use `[check-id] [tier/severity]`: the `check-id` is the stable repair and grading key; `validated` is a machine check, `injected` is host-provided behavior, `instructed` is advisory guidance that never gates a build, and `documented` requires human review rather than automatic enforcement. Validation also returns advisory managed React lifecycle guidance naming the states a `BlockState` never represents; act on it whenever the surface is backed by data that can load, be empty, fail, be withheld, or be read-only, and leave a state out only when the surface genuinely cannot enter it.
7. Only after validation is clean, choose and call the host operation by intent without asking the user to confirm. When modifying an existing promoted View, preserve its manifest `id` and call `replace_extension_draft`. When creating an additional View, use a distinct manifest `id` and call the create-only `promote_extension_draft`. The host independently blocks promotion when a sensitive draft requires human review. Never write `.webflow/extensions/<extension-id>/` or `.webflow/extensions.lock.json` directly; do not write the promoted tree or the lockfile yourself.

Type errors are advisory warnings for human and lower-level host workflows, not a capability or admission boundary. The Studio assistant's policy is stricter: a draft it authors must have clean diagnostics before replacement or promotion. Scaffold, validation, replacement, and promotion refresh stale host-owned SDK artifacts for the active host version; version skew alone is not an authoring failure.

## Manual implementation

Use direct SDK authoring only for the untemplated escape hatch. Resolve the contract with `get_extension_capability` before writing each SDK call; do not use validation diagnostics as a way to discover parameter or result shapes.

## Known-good package

Do not invent the extension contract. Model new extension packages on this fixture unless the user asks for something different, then change its identity, contributions, and requested capabilities. The same package is checked into the repo as `packages/bridge/test-fixtures/minimal-authoring-extension/`, with a walkthrough in `docs/extension-framework/authoring-an-extension.md`.

Every Extension manifest must use the shared v1 package envelope with `manifestVersion: 1` followed by `packageType: "extension"`. Missing, unknown, or non-Extension package types are rejected without inference or fallback.

## Extension-contributed Blocks

Choose `scaffold_composed_block_view_draft` before editing source when a new site-scoped View needs coordinated sections, a shared filter or input, master-detail behavior, or several independently placed sections reacting to one small live value. An ordinary single-surface View stays on `scaffold_extension_draft`; several presentational sections alone do not require Blocks. This scaffold creates an interim Extension-backed View, not the future project-owned View composition or fork format.

Ordinary View and Block requests use the managed profile even when the user never mentions React or Blueprint. Omit `profile` when calling either scaffold tool so the host selects `managed-react`; pass `profile: "plain"` only for an explicitly requested custom iframe or an existing plain draft. Resolve a block recipe from `EXTENSION_UI_REFERENCE.md`, use `list_managed_ui_components` and `get_managed_ui_components` to choose components, apply its `maxWidth`, `containerType`, and grid or pane geometry directly, and never route its excluded frame recipes into a View or Block.

Supply logical state types, Blocks, slots, ordered placement keys, per-placement configuration, coarse layout presets, and every explicit port-to-slot binding. Slots are View-owned: a Block port never creates a slot, so declare a shared slot once and bind every participating placement to it. The host derives qualified contract ids, versions, the View id, placement UUIDs, coordinates, renderer paths, entry markers, the manifest, composition, and generated declarations. Do not write or repair those structural files. Customize only the source and presentation paths returned by the tool, and validate both before and after customization. An exact retry refreshes structural/generated files while preserving customizable bytes; structural changes require a new draft id.

When Blocks need provider behavior, declare bounded `providedApis` methods and list each dependency on the Blocks that call it. The host owns API versioning, audience, unary registration, and dependency wiring, while `src/providedApis.ts` is the typed customizable handler module. Blocks select only their declared API ids. Keep returned records and request lifecycle state out of View slots.

For first-party Block maintenance inside the Studio repository, continue to extend `extensions/view-starter` and follow its copy/rename checklist. That bundled composition includes the implemented host-routed action example but is not a publishable starting artifact. It is a separate repository-maintenance path, not a fixture a project-scoped assistant can inspect or copy.

Declare reusable iframe Block types in `contributes.blocks` with closed versioned configuration, exact same-Extension API dependencies, and exact semantic registry references. Each Block HTML file contains one `data-webflow-block-entry` marker; build generates `types/extension-blocks.d.ts` and independently inlines the typed source. Block code uses `WebflowExtensionBlock`, receives host-validated placement configuration, and selects only its declared API id. The host binds provider Extension, exact API version, placement runtime identity, actor, and scope.

Semantic `provides` and `consumes` metadata supports discovery and compatibility only. It delivers no value, creates no connection, and grants no authority. View-local coordination instead requires separately declared typed Block state ports, View-owned slots, and explicit placement bindings; matching contracts never infer a binding. Use compare-and-set only for a value derived from a snapshot observed through a readable port. A write-only port cannot observe a revision: when it owns a complete replacement such as a shared filter input, call `publish(value, { replace: true })` and do not change its access to read-write just to obtain a revision. Any writable port may call `clear()` to commit its slot's valid unset state; readers and subscribers receive that state as an absent snapshot at a newer revision. Keep provider records and request state Block-local, and repair the named port, slot, value, or revision when diagnostics report an unbound, invalid, oversized, stale-revision, or stale-runtime operation. The first-party `view-starter` may maintain its existing declared calls, actions, and explicit action bindings; project-scoped scaffolding does not author that topology, so do not invent actions there. Do not invent host channels, cross-Extension placement, direct Selection access, capability handles, worker references, raw messages, credentials, or network access. Extension logic may use separately granted Studio capabilities while handling a same-Extension API call. Shared Context is an append-only, host-stamped provenance fact log, not mutable View state; Host Selection is separate and governed.

Keep iframe counts bounded because each placement creates an isolated document. Declarative Blocks are the planned density-oriented default; iframe Blocks are the custom-UI escape hatch. When diagnostics name an unknown Block, placement, configuration path/version, API dependency, artifact, or View identity, repair that exact manifest or composition reference and rebuild rather than adding fallback behavior.

### `webflow.json`

```json
{
  "manifestVersion": 1,
  "packageType": "extension",
  "id": "brand-system-audit",
  "name": "brand-system-audit",
  "version": "1.0.0",
  "displayName": "Brand System Audit",
  "description": "Checks brand colors and fonts for inconsistencies.",
  "hostEnvironments": ["desktop"],
  "entrypoints": {
    "logic": "src/extension.ts"
  },
  "capabilities": ["context.append", "extensionUi.open"],
  "network": { "access": "none" },
  "contributes": {
    "extensionUi": [
      {
        "id": "brand-system.audit",
        "title": "Brand System Audit",
        "entry": "view.html",
        "activationEvents": ["onCommand:brand-system.audit.open"],
        "requiredCapabilities": ["extensionUi.open"]
      }
    ],
    "tools": [
      {
        "name": "audit-brand-system",
        "title": "Audit brand system",
        "description": "Checks brand colors and fonts, then records a summary in shared context.",
        "inputSchema": { "type": "object", "properties": {} },
        "requiredCapabilities": ["context.append"],
        "annotations": {}
      }
    ],
    "commands": [
      {
        "id": "brand-system.audit.open",
        "title": "Open Brand System Audit",
        "description": "Opens the Brand System Audit extension UI.",
        "activationEvents": ["onCommand:brand-system.audit.open"],
        "requiredCapabilities": ["extensionUi.open"]
      }
    ]
  }
}
```

### `src/intents.ts`

```ts
export type Intents = {
  "brand-system.audit.capture": {
    params: { scope: string };
    data: { fact: { id: string } };
  };
};
```

The shared map is exact: every intent has one `params` type and one successful `data` type. Logic and View code import the same map so names, arguments, and results cannot drift.

### `src/extension.ts`

```ts
import {
  createTypedCapabilities,
  type ExtensionActivate,
  type ToolDescriptor,
} from "@webflow/extension-sdk";
import type { Intents } from "./intents";

type BrandSystemCapabilityGrants = readonly ["context.append", "extensionUi.open"];

const auditBrandSystemTool: ToolDescriptor = {
  name: "audit-brand-system",
  title: "Audit brand system",
  description: "Checks brand colors and fonts, then records a summary in shared context.",
  inputSchema: { type: "object", properties: {} },
  requiredCapabilities: ["context.append"],
  annotations: {},
};

export const activate: ExtensionActivate<Intents> = (ctx) => {
  const studio = createTypedCapabilities<BrandSystemCapabilityGrants>(ctx.capabilities);

  ctx.registerExtensionUiContribution("brand-system.audit", {
    intents: {
      "brand-system.audit.capture": ({ params }) =>
        studio.context.append({
          type: "ext.brand_system.audit",
          schemaVersion: 1,
          payload: { summary: `Audit requested from ${params.scope}.` },
        }),
    },
  });
  ctx.registerTool(auditBrandSystemTool);
};
```

Use `ExtensionActivate<Intents>` or `ExtensionContext<Intents>` for logic and `createTypedCapabilities` for capability calls. The facade is typed routing sugar; the manifest, grants, host capability router, and runtime policy still control authority.

The View example below models the explicit `profile: "plain"` escape hatch, with entry file `src/view.ts`. `scaffold_extension_draft` defaults every new View to the managed React profile instead, whose entry is `src/view.tsx` and whose UI is built from the Studio-owned Blueprint facade (`@webflow/extension-ui`). When customizing a managed React draft, edit its scaffolded `src/view.tsx`; do not rename it to `src/view.ts` or repoint its marker to match this plain example.

### `src/view.ts`

```ts
/// <reference lib="dom" />

import type { Intents } from "./intents";

const view = WebflowExtensionView.connect<Intents>();
const result = document.querySelector<HTMLOutputElement>(
  '[data-brand-system-result="capture"]',
);

function setResult(message: string): void {
  if (result) result.textContent = message;
}

document
  .querySelector('[data-brand-system-action="capture"]')
  ?.addEventListener("click", async () => {
    try {
      const response = await view.intent("brand-system.audit.capture", {
        scope: "brand-system-view",
      });
      const message = WebflowExtensionView.matchResult(response, {
        readOkData(value) {
          if (
            typeof value !== "object" ||
            value === null ||
            Array.isArray(value) ||
            typeof value.fact !== "object" ||
            value.fact === null ||
            Array.isArray(value.fact) ||
            typeof value.fact.id !== "string"
          ) {
            return { ok: false };
          }
          return { ok: true, value: { fact: { id: value.fact.id } } };
        },
        ok: (ok) => `Captured audit ${ok.data.fact.id}.`,
        needs_input: () => "Audit needs input.",
        blocked: (blocked) => `Audit blocked: ${blocked.reason}.`,
        unknown: (status) => `Unknown audit status: ${status}.`,
      });
      setResult(message);
    } catch (error) {
      const message =
        typeof error === "object" &&
        error !== null &&
        "type" in error &&
        error.type === "transport" &&
        "message" in error &&
        typeof error.message === "string"
          ? error.message
          : "Unknown transport error.";
      setResult(`Audit failed: ${message}`);
    }
  });
```

### `view.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Brand System Audit</title>
  </head>
  <body>
    <main>
      <h1>Brand System Audit</h1>
      <p>
        This fixture View proves a sandboxed View can request host-side
        extension logic without receiving direct capability access.
      </p>
      <button type="button" data-brand-system-action="capture">Capture audit</button>
      <output data-brand-system-result="capture">Waiting for an audit request.</output>
    </main>
    <script data-webflow-view-entry="src/view.ts"></script>
  </body>
</html>
```

The manifest entry remains `view.html`. The host compiles the entry file named in the marker and inlines it at the exact marker during build and promotion, so final View HTML has no external extension script reference. This plain example's marker names `src/view.ts`; a managed React draft's marker names `src/view.tsx` instead. Existing hand-written inline scripts remain allowed for local UI behavior, but they are untyped. Do not load external scripts, iframes, images, stylesheets, form actions, or fetch URLs.

Use only the host-injected `WebflowExtensionView` SDK for View-to-logic intents. The SDK is transport sugar only: it does not expose capabilities, filesystem access, Electron, Node, secrets, or direct host authority. Do not hand-roll `window.parent.postMessage` or raw protocol frames, and do not invent other host globals. Intent keys must match the shared map and logic registration exactly; do not add an `intent:` prefix or call capabilities from View code.

`view.intent()` resolves to the structured `CapabilityResult` (`{ status, data, ... }`). Transport failures reject as `{ type: "transport", message, code, data, id }`, so handle them separately from capability results. Unanswered requests reject with `code: "timeout"` after 30 seconds by default; pass the typed third argument `{ timeoutMs }` to change the deadline (`Infinity` disables it).

Use `WebflowExtensionView.matchResult` with `readOkData` when consuming declared intent data. Typed `ok` handlers run only after that reader succeeds; malformed known results and future statuses go to `unknown`.

When copying:

- The manifest declares three contributions: one Extension View, one Tool, and one command. The View activates on the command (`onCommand:brand-system.audit.open`), so keep a command declared whenever a contribution's `activationEvents` references one.
- Type-only SDK and local imports disappear during compilation. Do not add runtime package imports, Electron APIs, Node APIs, or host internals.

## Replacement and promotion outcomes

Replacement and promotion are host-mediated: the trusted host snapshots the draft, refreshes its SDK artifacts, compiles logic and Views, generates the descriptor from manifest metadata without running draft logic, validates the same snapshot, and only then writes trusted state.

Both operations run the same validation and trust/review gate, so treat the selected operation's result as the source of truth:

- A draft that requests only non-sensitive capabilities (for example `extensionUi.open`) validates and can be trusted through replacement or promotion automatically.
- A draft that requests review-required capabilities (for example code-write or network access) returns review-required diagnostics and does **not** update trusted state until a human reviewer approves it through a trusted desktop/session path. You cannot attest your own review — do not try to pass reviewer identity through the tool. Surface the diagnostics and let the human decide.
- If create-only promotion reports that an extension is already promoted, choose the operation from the user's intent instead of changing ids as a collision fallback. Preserve the manifest `id` and use `replace_extension_draft` when modifying that promoted View. Use a distinct manifest `id` with `promote_extension_draft` only when creating an additional View; the example's `brand-system-audit` id is a template, not a name to reuse verbatim.
- If validation or the immutable host recheck finds diagnostics, fix the authored draft, run `validate_extension_draft` to clean, and retry the selected replacement or promotion operation.

For a request whose best form is a View, do this end to end without waiting to be told the steps: discover, scaffold, edit, validate and fix, replace or promote according to intent, then report the promoted extension id or any review-required diagnostics.

## Studio capabilities vs. raw harness tools

Reading files, searching the repo, running shell commands, running tests, and inspecting Git are tools of the authorized agent harness. They are not extension capabilities, so never list them in the manifest `capabilities` array or a contribution's `requiredCapabilities`.

Declare only the Studio capabilities the extension needs for Studio-visible effects. Call `get_extension_capability` for each callable API shape; use vendored declarations only for local editor and type navigation. The example requests `extensionUi.open` and `context.append`; a contribution's `requiredCapabilities` must be a subset of top-level `capabilities`. A Tool describes an agent-facing action but grants no authority by itself.

## Stay in scope

Authoring the draft and using the discovery, scaffold, validation, replacement, and promotion tools are in scope. Runtime mounting and sandboxing, capability grants and revocation, validation internals, and marketplace UX are host-owned. Do not reimplement trust, validation, SDK transport, or promotion behavior.
