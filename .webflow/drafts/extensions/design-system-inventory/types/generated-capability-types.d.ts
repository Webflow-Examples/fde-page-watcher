import type { AnyCapabilityOutcome, CapabilityOkOutcome, CapabilityOutcome, JsonObject, JsonValue, ReviewableChangeRef } from "./shared";
export type CapabilityScopeString = string;
export type ContextRetention = "session" | "retained";
export interface ContextRef {
    type: string;
    id: string;
    uri?: string;
    range?: JsonObject;
    metadata?: JsonObject;
}
export interface ContextRefReader {
    type: string;
    id: string;
    uri?: string;
    range?: JsonObject;
    metadata?: JsonObject;
    [key: string]: unknown;
}
export interface ContextActor {
    type: string;
    id?: string;
    displayName?: string;
    metadata?: JsonValue;
}
export interface ContextActorReader {
    type: string;
    id?: string;
    displayName?: string;
    metadata?: JsonValue;
    [key: string]: unknown;
}
export interface ContextSource {
    type: string;
    id?: string;
    capability?: string;
    extensionId?: string;
    toolName?: string;
    commandId?: string;
    metadata?: JsonValue;
}
export interface ContextSourceReader {
    type: string;
    id?: string;
    capability?: string;
    extensionId?: string;
    toolName?: string;
    commandId?: string;
    metadata?: JsonValue;
    [key: string]: unknown;
}
export interface ContextFact {
    id: string;
    seq: number;
    type: string;
    schemaVersion: number;
    scope: CapabilityScopeString;
    actor: ContextActor;
    source: ContextSource;
    onBehalfOf?: ContextActor;
    causedBy?: ContextRef;
    refs: ContextRef[];
    retention: ContextRetention;
    createdAt: string;
    payload: JsonObject;
}
export interface ContextFactReader {
    id: string;
    seq: number;
    type: string;
    schemaVersion: number;
    scope: CapabilityScopeString;
    actor: ContextActorReader;
    source: ContextSourceReader;
    onBehalfOf?: ContextActorReader;
    causedBy?: ContextRefReader;
    refs: ContextRefReader[];
    retention: ContextRetention;
    createdAt: string;
    payload: JsonObject;
    [key: string]: unknown;
}
export interface SelectedSelectionReader {
    state: "selected";
    selectionKind: string;
    selectionId?: string;
    scope: CapabilityScopeString;
    refs: ContextRefReader[];
    metadata?: JsonObject;
    observedAt: string;
    [key: string]: unknown;
}
export interface EmptySelectionReader {
    state: "empty";
    scope: CapabilityScopeString;
    refs: ContextRefReader[];
    metadata?: JsonObject;
    observedAt: string;
    [key: string]: unknown;
}
export interface UnavailableSelectionReader {
    state: "unavailable";
    scope: CapabilityScopeString;
    refs: ContextRefReader[];
    reason?: string;
    metadata?: JsonObject;
    observedAt: string;
    [key: string]: unknown;
}
export type SelectionState = {
    state: "selected";
    selectionKind: string;
    selectionId?: string;
    scope: CapabilityScopeString;
    refs: ContextRef[];
    metadata?: JsonObject;
    observedAt: string;
} | {
    state: "empty";
    scope: CapabilityScopeString;
    refs: ContextRef[];
    metadata?: JsonObject;
    observedAt: string;
} | {
    state: "unavailable";
    scope: CapabilityScopeString;
    refs: ContextRef[];
    reason?: string;
    metadata?: JsonObject;
    observedAt: string;
};
export type SelectionStateReader = SelectedSelectionReader | EmptySelectionReader | UnavailableSelectionReader;
export interface SelectionSetResultData {
    outcome: "selected" | "cleared" | "conflict";
    selection: SelectionState;
    token?: string;
}
export interface SelectionSetResultDataReader {
    outcome: string;
    selection: SelectionStateReader;
    token?: string;
    [key: string]: unknown;
}
export interface SelectionPageNode {
    elementRef: string;
    elementSignature: string;
    tagName: string;
    elementId: string | null;
    className: string | null;
    textHint: string | null;
    sourceKind: "static" | "component";
    componentName?: string;
    children: SelectionPageNode[];
}
export interface SelectionPageNodeReader {
    elementRef: string;
    elementSignature: string;
    tagName: string;
    elementId: string | null;
    className: string | null;
    textHint: string | null;
    sourceKind: "static" | "component";
    componentName?: string;
    children: SelectionPageNodeReader[];
    [key: string]: unknown;
}
export interface CodeSourceRange {
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
    [key: string]: unknown;
}
export interface CodeSourceLocationReader {
    file: string;
    range?: CodeSourceRange;
    metadata?: JsonObject;
    [key: string]: unknown;
}
export type CodeFileEdit = {
    replace: string;
    create?: never;
    siteBrowser?: never;
} | {
    create: string;
    replace?: never;
    siteBrowser?: never;
} | {
    siteBrowser: {
        kind: "style";
        elementRef: string;
        elementSignature?: string;
        declarations: {
            property: string;
            value: string;
        }[];
    } | {
        kind: "text";
        elementRef: string;
        elementSignature?: string;
        previousTextContent?: string;
        textContent: string;
    } | {
        kind: "node";
        mutation: {
            kind: "create";
            pageUrl: string;
            pageRevision: string;
            parentRef: string;
            parentSignature: string;
            tagName: string;
            textContent?: string;
            index?: number;
        } | {
            kind: "update";
            pageUrl: string;
            pageRevision: string;
            elementRef: string;
            elementSignature: string;
            textContent: string;
        } | {
            kind: "move";
            pageUrl: string;
            pageRevision: string;
            elementRef: string;
            elementSignature: string;
            parentRef: string;
            parentSignature: string;
            index: number;
        } | {
            kind: "delete";
            pageUrl: string;
            pageRevision: string;
            elementRef: string;
            elementSignature: string;
        };
    };
    replace?: never;
    create?: never;
};
export interface ContentItemRef {
    kind: "content-item";
    sourceId: string;
    typeId: string;
    itemId: string;
}
export interface ContentSource {
    id: string;
    title: string;
    provider?: string;
}
export interface ContentSourceReader {
    id: string;
    title: string;
    provider?: string;
    [key: string]: unknown;
}
export interface ContentTypeSummary {
    sourceId: string;
    id: string;
    title: string;
    description?: string;
    itemCount?: number;
    schemaState: "known" | "observed-only";
}
export interface ContentTypeSummaryReader {
    sourceId: string;
    id: string;
    title: string;
    description?: string;
    itemCount?: number;
    schemaState: string;
    [key: string]: unknown;
}
export interface ContentType {
    sourceId: string;
    id: string;
    typeVersion: string;
    title: string;
    description?: string;
    schemaState: "known" | "observed-only";
    fields: {
        id: string;
        title: string;
        description?: string;
        required: boolean;
        valueKinds: ("string" | "number" | "boolean" | "null" | "slug" | "url" | "date" | "datetime" | "object" | "list" | "content-item-reference" | "asset" | "rich-text" | "unknown")[];
    }[];
}
export interface ContentTypeReader {
    sourceId: string;
    id: string;
    typeVersion: string;
    title: string;
    description?: string;
    schemaState: string;
    fields: {
        id: string;
        title: string;
        description?: string;
        required: boolean;
        valueKinds: string[];
        [key: string]: unknown;
    }[];
    [key: string]: unknown;
}
export interface ContentItemSummary {
    ref: ContentItemRef;
    title: string;
    subtitle?: string;
    slug?: string;
    publishedAt?: string;
    updatedAt?: string;
    thumbnail?: {
        dataUrl: string;
        mimeType: string;
        width: number;
        height: number;
    };
}
export interface ContentItemSummaryReader {
    ref: ContentItemRef;
    title: string;
    subtitle?: string;
    slug?: string;
    publishedAt?: string;
    updatedAt?: string;
    thumbnail?: {
        dataUrl: string;
        mimeType: string;
        width: number;
        height: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
export interface ContentItem {
    ref: ContentItemRef;
    writeVersion: string;
    title: string;
    subtitle?: string;
    publishedAt?: string;
    updatedAt?: string;
    schemaState: "known" | "observed-only";
    fields: {
        id: string;
        title: string;
        value: ContentValue;
    }[];
}
export interface ContentItemReader {
    ref: ContentItemRef;
    writeVersion: string;
    title: string;
    subtitle?: string;
    publishedAt?: string;
    updatedAt?: string;
    schemaState: string;
    fields: {
        id: string;
        title: string;
        value: ContentValueReader;
        [key: string]: unknown;
    }[];
    [key: string]: unknown;
}
export type ContentValue = {
    kind: "string";
    value: string;
} | {
    kind: "number";
    value: number;
} | {
    kind: "boolean";
    value: boolean;
} | {
    kind: "null";
} | {
    kind: "slug";
    value: string;
} | {
    kind: "url";
    value: string;
} | {
    kind: "date";
    value: string;
} | {
    kind: "datetime";
    value: string;
} | {
    kind: "object";
    fields: {
        key: string;
        value: ContentValue;
    }[];
} | {
    kind: "list";
    items: ContentValue[];
} | {
    kind: "content-item-reference";
    ref: ContentItemRef;
    title?: string;
} | {
    kind: "asset";
    assetKind: "image" | "file";
    id: string;
    filename?: string;
    mimeType?: string;
    sizeBytes?: number;
    altText?: string;
    thumbnail?: {
        dataUrl: string;
        mimeType: string;
        width: number;
        height: number;
    };
} | {
    kind: "rich-text";
    blocks: ContentValue[];
} | {
    kind: "unknown";
    value: JsonValue;
};
export type ContentValueReader = {
    kind: "string";
    value: string;
    [key: string]: unknown;
} | {
    kind: "number";
    value: number;
    [key: string]: unknown;
} | {
    kind: "boolean";
    value: boolean;
    [key: string]: unknown;
} | {
    kind: "null";
    [key: string]: unknown;
} | {
    kind: "slug";
    value: string;
    [key: string]: unknown;
} | {
    kind: "url";
    value: string;
    [key: string]: unknown;
} | {
    kind: "date";
    value: string;
    [key: string]: unknown;
} | {
    kind: "datetime";
    value: string;
    [key: string]: unknown;
} | {
    kind: "object";
    fields: {
        key: string;
        value: ContentValueReader;
        [key: string]: unknown;
    }[];
    [key: string]: unknown;
} | {
    kind: "list";
    items: ContentValueReader[];
    [key: string]: unknown;
} | {
    kind: "content-item-reference";
    ref: ContentItemRef;
    title?: string;
    [key: string]: unknown;
} | {
    kind: "asset";
    assetKind: string;
    id: string;
    filename?: string;
    mimeType?: string;
    sizeBytes?: number;
    altText?: string;
    thumbnail?: {
        dataUrl: string;
        mimeType: string;
        width: number;
        height: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
} | {
    kind: "rich-text";
    blocks: ContentValueReader[];
    [key: string]: unknown;
} | {
    kind: "unknown";
    value: JsonValue;
    [key: string]: unknown;
};
export type ContentScalarValue = {
    kind: "string";
    value: string;
} | {
    kind: "number";
    value: number;
} | {
    kind: "boolean";
    value: boolean;
};
export type ContentScalarValueReader = {
    kind: "string";
    value: string;
    [key: string]: unknown;
} | {
    kind: "number";
    value: number;
    [key: string]: unknown;
} | {
    kind: "boolean";
    value: boolean;
    [key: string]: unknown;
};
export interface ContentFieldAssignment {
    fieldId: string;
    value: ContentScalarValue;
}
export interface ContentFieldAssignmentReader {
    fieldId: string;
    value: ContentScalarValueReader;
    [key: string]: unknown;
}
export type ContentMutationFailure = {
    outcome: "validation_failed";
    action: "correct";
    correlationId: string;
    message?: string;
} | {
    outcome: "missing";
    action: "refresh";
    correlationId: string;
    message?: string;
} | {
    outcome: "item_conflict";
    action: "refresh";
    correlationId: string;
    message?: string;
} | {
    outcome: "schema_conflict";
    action: "refresh";
    correlationId: string;
    message?: string;
} | {
    outcome: "connection_required";
    action: "reconnect";
    correlationId: string;
    message?: string;
} | {
    outcome: "permission_denied";
    action: "reconnect";
    correlationId: string;
    message?: string;
} | {
    outcome: "temporarily_unavailable";
    action: "retry";
    correlationId: string;
    message?: string;
} | {
    outcome: "unknown_outcome";
    action: "verify-state";
    correlationId: string;
    message?: string;
};
export type ContentMutationFailureReader = {
    outcome: "validation_failed";
    action: "correct";
    correlationId: string;
    message?: string;
    [key: string]: unknown;
} | {
    outcome: "missing";
    action: "refresh";
    correlationId: string;
    message?: string;
    [key: string]: unknown;
} | {
    outcome: "item_conflict";
    action: "refresh";
    correlationId: string;
    message?: string;
    [key: string]: unknown;
} | {
    outcome: "schema_conflict";
    action: "refresh";
    correlationId: string;
    message?: string;
    [key: string]: unknown;
} | {
    outcome: "connection_required";
    action: "reconnect";
    correlationId: string;
    message?: string;
    [key: string]: unknown;
} | {
    outcome: "permission_denied";
    action: "reconnect";
    correlationId: string;
    message?: string;
    [key: string]: unknown;
} | {
    outcome: "temporarily_unavailable";
    action: "retry";
    correlationId: string;
    message?: string;
    [key: string]: unknown;
} | {
    outcome: "unknown_outcome";
    action: "verify-state";
    correlationId: string;
    message?: string;
    [key: string]: unknown;
};
export interface ContentNormalizationLimits {
    maxItemBytes: 1048576;
    maxDepth: 20;
    maxListEntries: 500;
    maxThumbnailBytes: 262144;
    maxThumbnailWidth: 512;
    maxThumbnailHeight: 512;
}
export interface ContentNormalizationLimitsReader {
    maxItemBytes: 1048576;
    maxDepth: 20;
    maxListEntries: 500;
    maxThumbnailBytes: 262144;
    maxThumbnailWidth: 512;
    maxThumbnailHeight: 512;
    [key: string]: unknown;
}
export interface PreviewArtifactTarget {
    kind: "browser";
    panelId?: string;
    focus?: boolean;
}
export interface RuntimeHealth {
    state: "healthy" | "booting" | "unavailable" | "failed";
    scope: CapabilityScopeString;
    detail?: string;
    previewId?: string;
    metadata?: JsonObject;
    observedAt: string;
}
export interface RuntimeHealthResultDataReader {
    state: string;
    scope: CapabilityScopeString;
    detail?: string;
    previewId?: string;
    metadata?: JsonObject;
    observedAt: string;
    [key: string]: unknown;
}
export interface ContextAppendParams {
    scope?: CapabilityScopeString;
    type: string;
    schemaVersion: number;
    refs?: ContextRef[];
    retention?: ContextRetention;
    causedBy?: ContextRef;
    payload: JsonObject;
}
export interface ContextAppendResultData {
    fact: ContextFactReader;
    [key: string]: unknown;
}
export interface ContextGetParams {
    scope?: CapabilityScopeString;
    id: string;
}
export interface ContextGetResultData {
    fact: ContextFactReader | null;
    [key: string]: unknown;
}
export interface ContextQueryParams {
    scope?: CapabilityScopeString;
    scopePrefix?: CapabilityScopeString;
    types?: string[];
    refs?: ContextRef[];
    sinceSeq?: number;
    limit?: number;
}
export interface ContextQueryResultData {
    facts: ContextFactReader[];
    nextSeq: number;
    [key: string]: unknown;
}
export interface ContextFactAppendedParams {
    id: string;
    seq: number;
    type: string;
    scope: CapabilityScopeString;
    actor: ContextActorReader;
    source: ContextSourceReader;
    onBehalfOf?: ContextActorReader;
    causedBy?: ContextRefReader;
    refs: ContextRefReader[];
    retention: ContextRetention;
    createdAt: string;
    [key: string]: unknown;
}
export interface CodeReadFileParams {
    scope?: CapabilityScopeString;
    file: string;
}
export interface CodeReadFileResultDataReader {
    file: string;
    content: string;
    encoding?: string;
    version?: string;
    [key: string]: unknown;
}
export interface CodeListDirectoryParams {
    scope?: CapabilityScopeString;
    path?: string;
    limit?: number;
}
export interface CodeListDirectoryResultData {
    path?: string;
    entries: {
        path: string;
        name: string;
        kind: "file" | "directory" | "other";
        [key: string]: unknown;
    }[];
    truncated: boolean;
    filtered?: boolean;
    [key: string]: unknown;
}
export interface CodeListDirectoryResultDataReader {
    path?: string;
    entries: {
        path: string;
        name: string;
        kind: string;
        [key: string]: unknown;
    }[];
    truncated: boolean;
    filtered?: boolean;
    [key: string]: unknown;
}
export interface CodeMapNodeToSourceParams {
    scope?: CapabilityScopeString;
    nodeRef: ContextRef;
    file?: string;
    hints?: JsonObject;
}
export interface CodeMapNodeToSourceResultDataReader {
    locations: CodeSourceLocationReader[];
    [key: string]: unknown;
}
export interface CodeApplyFileEditParams {
    scope?: CapabilityScopeString;
    file: string;
    edit: CodeFileEdit;
    baseVersion?: string;
    summary?: string;
}
export interface CodeApplyFileEditResultDataReader {
    file: string;
    summary?: string;
    metadata?: JsonObject;
    version?: string;
    [key: string]: unknown;
}
export type CodeApplyFileEditOkOutcome = Omit<CapabilityOkOutcome<CodeApplyFileEditResultDataReader | undefined>, "change"> & {
    change: ReviewableChangeRef;
};
export type CodeApplyFileEditOutcome = CodeApplyFileEditOkOutcome | Exclude<CapabilityOutcome<CodeApplyFileEditResultDataReader | undefined>, {
    status: "ok";
}>;
export interface CodeCreateDirectoryParams {
    scope?: CapabilityScopeString;
    path: string;
    baseVersion?: string;
}
export interface CodeCreateDirectoryResultDataReader {
    path: string;
    metadata?: JsonObject;
    [key: string]: unknown;
}
export interface CodeMoveFileParams {
    scope?: CapabilityScopeString;
    file: string;
    to: string;
    baseVersion?: string;
    summary?: string;
}
export interface CodeMoveFileResultData {
    file: string;
    previousFile: string;
    kind: "file" | "directory";
    summary?: string;
    metadata?: JsonObject;
    [key: string]: unknown;
}
export interface CodeMoveFileResultDataReader {
    file: string;
    previousFile: string;
    kind: string;
    summary?: string;
    metadata?: JsonObject;
    [key: string]: unknown;
}
export type CodeMoveFileOkOutcome = Omit<CapabilityOkOutcome<CodeMoveFileResultDataReader>, "change"> & {
    change: ReviewableChangeRef;
};
export type CodeMoveFileOutcome = CodeMoveFileOkOutcome | Exclude<CapabilityOutcome<CodeMoveFileResultDataReader>, {
    status: "ok";
}>;
export interface CodeDeleteFileParams {
    scope?: CapabilityScopeString;
    file: string;
    baseVersion?: string;
}
export interface CodeDeleteFileResultData {
    file: string;
    recoverableVia: "system-trash";
    metadata?: JsonObject;
    [key: string]: unknown;
}
export interface CodeDeleteFileResultDataReader {
    file: string;
    recoverableVia: string;
    metadata?: JsonObject;
    [key: string]: unknown;
}
export type CodeDeleteFileOkOutcome = Omit<CapabilityOkOutcome<CodeDeleteFileResultDataReader>, "change"> & {
    change: ReviewableChangeRef;
};
export type CodeDeleteFileOutcome = CodeDeleteFileOkOutcome | Exclude<CapabilityOutcome<CodeDeleteFileResultDataReader>, {
    status: "ok";
}>;
export interface CodeDeleteDirectoryParams {
    scope?: CapabilityScopeString;
    directory: string;
    confirmationToken?: string;
    confirmedEntryCount?: number;
    baseVersion?: string;
}
export interface CodeDeleteDirectoryResultData {
    directory: string;
    entryCount: number;
    entryCountExact: boolean;
    recoverableVia: "system-trash";
    metadata?: JsonObject;
    [key: string]: unknown;
}
export interface CodeDeleteDirectoryResultDataReader {
    directory: string;
    entryCount: number;
    entryCountExact: boolean;
    recoverableVia: string;
    metadata?: JsonObject;
    [key: string]: unknown;
}
export type CodeDeleteDirectoryOkOutcome = Omit<CapabilityOkOutcome<CodeDeleteDirectoryResultDataReader>, "change"> & {
    change: ReviewableChangeRef;
};
export type CodeDeleteDirectoryOutcome = CodeDeleteDirectoryOkOutcome | Exclude<CapabilityOutcome<CodeDeleteDirectoryResultDataReader>, {
    status: "ok";
}>;
export type CloudAuthorizeParams = Record<string, never>;
export interface CloudAuthorizeResultData {
    authorized: boolean;
    message?: string;
}
export type CloudGetDeployContextParams = Record<string, never>;
export interface CloudGetDeployContextResultData {
    projectId?: string;
    environmentId?: string;
    workspaceId?: string;
    pendingDeployment?: boolean;
}
export interface CloudDeployParams {
    recoverDeletedApp?: true;
}
export interface CloudDeployResultData {
    requestId: string;
    projectId: string;
    environmentId: string;
    status: string;
    deployUrl?: string;
}
export interface CloudDeployProgressData {
    stage: string;
    message: string;
}
export type ContentListSourcesParams = Record<string, never>;
export interface ContentListSourcesResultData {
    sources: ContentSource[];
}
export interface ContentListSourcesResultDataReader {
    sources: ContentSourceReader[];
    [key: string]: unknown;
}
export interface ContentListTypesParams {
    sourceId: string;
}
export interface ContentListTypesResultData {
    sourceId: string;
    types: ContentTypeSummary[];
}
export interface ContentListTypesResultDataReader {
    sourceId: string;
    types: ContentTypeSummaryReader[];
    [key: string]: unknown;
}
export interface ContentGetTypeParams {
    sourceId: string;
    typeId: string;
}
export interface ContentGetTypeResultData {
    type: ContentType | null;
}
export interface ContentGetTypeResultDataReader {
    type: ContentTypeReader | null;
    [key: string]: unknown;
}
export interface ContentQueryItemsParams {
    sourceId: string;
    typeId: string;
    search?: string;
    sort?: "default" | "title-asc" | "title-desc" | "updated-asc" | "updated-desc";
    limit?: number;
    cursor?: string;
}
export interface ContentQueryItemsResultData {
    sourceId: string;
    typeId: string;
    items: ContentItemSummary[];
    nextCursor?: string;
}
export interface ContentQueryItemsResultDataReader {
    sourceId: string;
    typeId: string;
    items: ContentItemSummaryReader[];
    nextCursor?: string;
    [key: string]: unknown;
}
export interface ContentGetItemParams {
    ref: ContentItemRef;
}
export type ContentGetItemResultData = {
    state: "found";
    item: ContentItem;
} | {
    state: "missing";
    ref: ContentItemRef;
} | {
    state: "item_too_large";
    ref: ContentItemRef;
    writeVersion: string;
    limits: ContentNormalizationLimits;
};
export type ContentGetItemResultDataReader = {
    state: "found";
    item: ContentItemReader;
    [key: string]: unknown;
} | {
    state: "missing";
    ref: ContentItemRef;
    [key: string]: unknown;
} | {
    state: "item_too_large";
    ref: ContentItemRef;
    writeVersion: string;
    limits: ContentNormalizationLimitsReader;
    [key: string]: unknown;
};
export interface ContentCreateItemParams {
    sourceId: string;
    typeId: string;
    typeVersion: string;
    fields: ContentFieldAssignment[];
}
export type ContentCreateItemResultData = {
    outcome: "created";
    item: ContentItem;
} | ContentMutationFailure;
export type ContentCreateItemResultDataReader = {
    outcome: "created";
    item: ContentItemReader;
    [key: string]: unknown;
} | ContentMutationFailureReader;
export interface ContentUpdateItemParams {
    ref: ContentItemRef;
    typeVersion: string;
    writeVersion: string;
    fields: ContentFieldAssignment[];
}
export type ContentUpdateItemResultData = {
    outcome: "updated";
    item: ContentItem;
} | ContentMutationFailure;
export type ContentUpdateItemResultDataReader = {
    outcome: "updated";
    item: ContentItemReader;
    [key: string]: unknown;
} | ContentMutationFailureReader;
export interface ContentDeleteItemParams {
    ref: ContentItemRef;
    writeVersion: string;
}
export type ContentDeleteItemResultData = {
    outcome: "deleted";
    ref: ContentItemRef;
} | ContentMutationFailure;
export type ContentDeleteItemResultDataReader = {
    outcome: "deleted";
    ref: ContentItemRef;
    [key: string]: unknown;
} | ContentMutationFailureReader;
export type SelectionSetParams = {
    action: "select";
    ref: ContentItemRef;
    token?: never;
    expectedRef?: never;
} | {
    action: "clear";
    token: string;
    expectedRef: ContentItemRef;
    ref?: never;
};
export interface SelectionGetCurrentParams {
    scope?: CapabilityScopeString;
}
export type SelectionReadPageTreeParams = Record<string, never>;
export interface SelectionPageTree {
    pageUrl: string;
    pageRevision: string;
    roots: SelectionPageNode[];
    truncated: boolean;
}
export interface SelectionPageTreeReader {
    pageUrl: string;
    pageRevision: string;
    roots: SelectionPageNodeReader[];
    truncated: boolean;
    [key: string]: unknown;
}
export interface SelectionPageNodeParams {
    pageUrl: string;
    pageRevision: string;
    elementRef: string;
    elementSignature: string;
}
export interface SelectionPageNodeResultDataReader {
    elementRef: string;
    pageUrl: string;
    [key: string]: unknown;
}
export type SelectionNodeMutation = {
    kind: "create";
    pageUrl: string;
    pageRevision: string;
    parentRef: string;
    parentSignature: string;
    tagName: string;
    textContent?: string;
    index?: number;
} | {
    kind: "update";
    pageUrl: string;
    pageRevision: string;
    elementRef: string;
    elementSignature: string;
    textContent: string;
} | {
    kind: "move";
    pageUrl: string;
    pageRevision: string;
    elementRef: string;
    elementSignature: string;
    parentRef: string;
    parentSignature: string;
    index: number;
} | {
    kind: "delete";
    pageUrl: string;
    pageRevision: string;
    elementRef: string;
    elementSignature: string;
};
export type SelectionNodeMutationResultDataReader = {
    elementRef?: string;
    persistence: "saved";
    [key: string]: unknown;
} | {
    elementRef?: string;
    persistence: "failed";
    [key: string]: unknown;
} | {
    elementRef?: string;
    persistence: "skipped";
    persistenceReason: "file-too-large" | "not-writable" | "source-element-mismatch" | "source-element-not-found" | "source-element-not-text-only" | "source-element-component-managed" | "invalid-mutation";
    [key: string]: unknown;
};
export interface SelectionPatchStyleParams {
    scope?: CapabilityScopeString;
    elementRef: string;
    pageUrl: string;
    elementSignature: string;
    declarations: {
        property: string;
        value: string;
    }[];
}
export type SelectionPatchStyleResultDataReader = {
    mutationId: string;
    pageUrl: string;
    elementSignature: string;
    applied: true;
    persistence: "saved";
    [key: string]: unknown;
} | {
    mutationId: string;
    pageUrl: string;
    elementSignature: string;
    applied: true;
    persistence: "failed";
    [key: string]: unknown;
} | {
    mutationId: string;
    pageUrl: string;
    elementSignature: string;
    applied: true;
    persistence: "skipped";
    persistenceReason: "cancelled" | "file-too-large" | "not-writable" | "source-element-mismatch" | "source-element-not-found" | "source-element-not-text-only";
    [key: string]: unknown;
};
export interface SelectionEditTextParams {
    scope?: CapabilityScopeString;
    elementRef: string;
    pageUrl: string;
    elementSignature: string;
    previousTextContent?: string;
    textContent: string;
}
export type SelectionEditTextResultDataReader = {
    mutationId: string;
    pageUrl: string;
    elementSignature: string;
    applied: true;
    persistence: "saved";
    [key: string]: unknown;
} | {
    mutationId: string;
    pageUrl: string;
    elementSignature: string;
    applied: true;
    persistence: "failed";
    [key: string]: unknown;
} | {
    mutationId: string;
    pageUrl: string;
    elementSignature: string;
    applied: true;
    persistence: "skipped";
    persistenceReason: "cancelled" | "file-too-large" | "not-writable" | "source-element-mismatch" | "source-element-not-found" | "source-element-not-text-only";
    [key: string]: unknown;
};
export type SelectionChangedParams = SelectionStateReader;
export interface ProjectGetInfoParams {
    scope?: CapabilityScopeString;
    include?: string[];
}
export type ProjectGetInfoResultDataReader = JsonObject;
export interface ExtensionUiOpenParams {
    contributionId: string;
    scope?: CapabilityScopeString;
    input?: JsonObject;
}
export interface ExtensionUiOpenResultData {
    uiId: string;
    [key: string]: unknown;
}
export interface ExtensionUiPostMessageParams {
    uiId: string;
    message: JsonValue;
}
export interface ExtensionUiPostMessageResultData {
    delivered: boolean;
    [key: string]: unknown;
}
export interface AgentRunParams {
    scope?: CapabilityScopeString;
    prompt: string;
    input?: JsonObject;
}
export interface AgentRunResultDataReader {
    runId: string;
    summary: string;
    outputRefs: ContextRefReader[];
    [key: string]: unknown;
}
export interface AgentRunProgressDataReader {
    runId: string;
    sequence: number;
    [key: string]: unknown;
}
export interface PreviewOpenTargetParams {
    scope?: CapabilityScopeString;
    target?: string;
    input?: JsonObject;
}
export interface PreviewOpenTargetResultDataReader {
    previewId: string;
    status: string;
    url?: string;
    [key: string]: unknown;
}
export interface PreviewReloadParams {
    scope?: CapabilityScopeString;
    previewId?: string;
}
export interface PreviewReloadResultDataReader {
    previewId: string;
    status: string;
    [key: string]: unknown;
}
export interface PreviewReadConsoleParams {
    scope?: CapabilityScopeString;
    previewId?: string;
    sinceSequence?: number;
}
export interface PreviewReadConsoleResultDataReader {
    previewId: string;
    status?: string;
    lineCount?: number;
    [key: string]: unknown;
}
export interface PreviewReadConsoleProgressDataReader {
    event: "log";
    message: string;
    level?: "debug" | "info" | "warn" | "error";
    sequence?: number;
    [key: string]: unknown;
}
export interface PreviewOpenArtifactParams {
    scope?: CapabilityScopeString;
    artifactRef: string;
    target?: PreviewArtifactTarget;
}
export interface PreviewOpenArtifactResultData {
    artifactRef: string;
    opened: true;
    contentType?: string;
    title?: string;
    [key: string]: unknown;
}
export interface RuntimeGetHealthParams {
    scope?: CapabilityScopeString;
}
export type RuntimeHealthChangedParams = RuntimeHealthResultDataReader;
export interface PublicCapabilityContract<TParams, TResult extends AnyCapabilityOutcome | never> {
    readonly params: TParams;
    readonly result: TResult;
}
interface PublicStreamCapabilityContract<TParams, TResult extends AnyCapabilityOutcome, TProgress> extends PublicCapabilityContract<TParams, TResult> {
    readonly progress: TProgress;
}
export interface PublicCapabilityContractMap {
    "context.append": PublicCapabilityContract<ContextAppendParams, CapabilityOutcome<ContextAppendResultData>>;
    "context.get": PublicCapabilityContract<ContextGetParams, CapabilityOutcome<ContextGetResultData>>;
    "context.query": PublicCapabilityContract<ContextQueryParams, CapabilityOutcome<ContextQueryResultData>>;
    "context.factAppended": PublicCapabilityContract<ContextFactAppendedParams, never>;
    "code.readFile": PublicCapabilityContract<CodeReadFileParams, CapabilityOutcome<CodeReadFileResultDataReader>>;
    "code.listDirectory": PublicCapabilityContract<CodeListDirectoryParams, CapabilityOutcome<CodeListDirectoryResultDataReader>>;
    "code.mapNodeToSource": PublicCapabilityContract<CodeMapNodeToSourceParams, CapabilityOutcome<CodeMapNodeToSourceResultDataReader>>;
    "code.applyFileEdit": PublicCapabilityContract<CodeApplyFileEditParams, CodeApplyFileEditOutcome>;
    "code.createDirectory": PublicCapabilityContract<CodeCreateDirectoryParams, CapabilityOutcome<CodeCreateDirectoryResultDataReader>>;
    "code.moveFile": PublicCapabilityContract<CodeMoveFileParams, CodeMoveFileOutcome>;
    "code.deleteFile": PublicCapabilityContract<CodeDeleteFileParams, CodeDeleteFileOutcome>;
    "code.deleteDirectory": PublicCapabilityContract<CodeDeleteDirectoryParams, CodeDeleteDirectoryOutcome>;
    "cloud.authorize": PublicCapabilityContract<CloudAuthorizeParams, CapabilityOutcome<CloudAuthorizeResultData>>;
    "cloud.getDeployContext": PublicCapabilityContract<CloudGetDeployContextParams, CapabilityOutcome<CloudGetDeployContextResultData>>;
    "cloud.deploy": PublicStreamCapabilityContract<CloudDeployParams, CapabilityOutcome<CloudDeployResultData>, CloudDeployProgressData>;
    "content.listSources": PublicCapabilityContract<ContentListSourcesParams, CapabilityOutcome<ContentListSourcesResultDataReader>>;
    "content.listTypes": PublicCapabilityContract<ContentListTypesParams, CapabilityOutcome<ContentListTypesResultDataReader>>;
    "content.getType": PublicCapabilityContract<ContentGetTypeParams, CapabilityOutcome<ContentGetTypeResultDataReader>>;
    "content.queryItems": PublicCapabilityContract<ContentQueryItemsParams, CapabilityOutcome<ContentQueryItemsResultDataReader>>;
    "content.getItem": PublicCapabilityContract<ContentGetItemParams, CapabilityOutcome<ContentGetItemResultDataReader>>;
    "content.createItem": PublicCapabilityContract<ContentCreateItemParams, CapabilityOutcome<ContentCreateItemResultDataReader>>;
    "content.updateItem": PublicCapabilityContract<ContentUpdateItemParams, CapabilityOutcome<ContentUpdateItemResultDataReader>>;
    "content.deleteItem": PublicCapabilityContract<ContentDeleteItemParams, CapabilityOutcome<ContentDeleteItemResultDataReader>>;
    "selection.set": PublicCapabilityContract<SelectionSetParams, CapabilityOutcome<SelectionSetResultDataReader>>;
    "selection.getCurrent": PublicCapabilityContract<SelectionGetCurrentParams, CapabilityOutcome<SelectionStateReader>>;
    "selection.readPageTree": PublicCapabilityContract<SelectionReadPageTreeParams, CapabilityOutcome<SelectionPageTreeReader>>;
    "selection.selectPageNode": PublicCapabilityContract<SelectionPageNodeParams, CapabilityOutcome<SelectionPageNodeResultDataReader>>;
    "selection.mutateNode": PublicCapabilityContract<SelectionNodeMutation, CapabilityOutcome<SelectionNodeMutationResultDataReader>>;
    "selection.patchStyle": PublicCapabilityContract<SelectionPatchStyleParams, CapabilityOutcome<SelectionPatchStyleResultDataReader>>;
    "selection.editText": PublicCapabilityContract<SelectionEditTextParams, CapabilityOutcome<SelectionEditTextResultDataReader>>;
    "selection.changed": PublicCapabilityContract<SelectionChangedParams, never>;
    "project.getInfo": PublicCapabilityContract<ProjectGetInfoParams, CapabilityOutcome<ProjectGetInfoResultDataReader>>;
    "extensionUi.open": PublicCapabilityContract<ExtensionUiOpenParams, CapabilityOutcome<ExtensionUiOpenResultData>>;
    "extensionUi.postMessage": PublicCapabilityContract<ExtensionUiPostMessageParams, CapabilityOutcome<ExtensionUiPostMessageResultData | undefined>>;
    "agent.run": PublicStreamCapabilityContract<AgentRunParams, CapabilityOutcome<AgentRunResultDataReader>, AgentRunProgressDataReader>;
    "preview.openTarget": PublicCapabilityContract<PreviewOpenTargetParams, CapabilityOutcome<PreviewOpenTargetResultDataReader>>;
    "preview.reload": PublicCapabilityContract<PreviewReloadParams, CapabilityOutcome<PreviewReloadResultDataReader>>;
    "preview.readConsole": PublicStreamCapabilityContract<PreviewReadConsoleParams, CapabilityOutcome<PreviewReadConsoleResultDataReader>, PreviewReadConsoleProgressDataReader>;
    "preview.openArtifact": PublicCapabilityContract<PreviewOpenArtifactParams, CapabilityOutcome<PreviewOpenArtifactResultData>>;
    "runtime.getHealth": PublicCapabilityContract<RuntimeGetHealthParams, CapabilityOutcome<RuntimeHealthResultDataReader>>;
    "runtime.healthChanged": PublicCapabilityContract<RuntimeHealthChangedParams, never>;
}
