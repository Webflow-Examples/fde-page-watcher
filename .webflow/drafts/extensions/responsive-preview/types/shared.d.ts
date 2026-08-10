export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
export type JsonObject = {
    [key: string]: JsonValue;
};
export type JsonRpcMethod = string;
export type JsonRpcRequestId = string | number;
export type JsonRpcParams = JsonObject & {
    scope?: string;
};
export interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: JsonRpcRequestId;
    method: JsonRpcMethod;
    params?: JsonRpcParams;
}
export interface JsonRpcNotification {
    jsonrpc: "2.0";
    method: JsonRpcMethod;
    params?: JsonRpcParams;
}
export interface ReviewableChangeRef {
    id: string;
    reviewable: boolean;
}
export type CapabilityResult = {
    status: string;
    [key: string]: JsonValue;
};
export interface OkResult {
    status: "ok";
    change?: ReviewableChangeRef;
    data?: JsonValue;
    jobId?: string;
    lifetime?: "ephemeral" | "durable";
}
export type AnyCapabilityOutcome = {
    status: "ok";
    change?: ReviewableChangeRef;
    data?: unknown;
    jobId?: string;
    lifetime?: "ephemeral" | "durable";
} | NeedsInputResult | BlockedResultReader;
export interface NeedsInputResult {
    status: "needs_input";
    data?: JsonValue;
    jobId?: string;
    lifetime?: "ephemeral" | "durable";
}
export type BlockedResultReader = {
    status: "blocked";
    reason: string;
    capability?: string;
    data?: JsonValue;
    jobId?: string;
    lifetime?: "ephemeral" | "durable";
} & Record<string, unknown>;
export interface BlockedResult {
    status: "blocked";
    reason: "permission" | "runtime" | "governance";
    capability?: string;
    data?: JsonValue;
    jobId?: string;
    lifetime?: "ephemeral" | "durable";
}
export type CapabilityOkOutcome<TData> = Omit<OkResult, "data"> & (undefined extends TData ? {
    data?: Exclude<TData, undefined>;
} : {
    data: TData;
});
export type CapabilityOutcome<TData> = CapabilityOkOutcome<TData> | NeedsInputResult | BlockedResultReader;
export type CapabilityProducerOutcome<TData> = CapabilityOkOutcome<TData> | NeedsInputResult | BlockedResult;
declare const capabilityResultBrand: unique symbol;
export type TypedCapabilityResult<TOutcome extends AnyCapabilityOutcome = AnyCapabilityOutcome> = CapabilityResult & {
    readonly [capabilityResultBrand]: TOutcome;
};
export interface CapabilityOutcomeHandlers<TOutcome extends AnyCapabilityOutcome, TReturn> {
    ok(result: Extract<TOutcome, {
        status: "ok";
    }>): TReturn;
    needs_input(result: Extract<TOutcome, {
        status: "needs_input";
    }>): TReturn;
    blocked(result: Extract<TOutcome, {
        status: "blocked";
    }>): TReturn;
    unknown(status: string, result: CapabilityResult): TReturn;
}
export interface ExtensionDisposable {
    dispose(): void;
}
export interface ExtensionSubscription extends ExtensionDisposable {
    readonly ready: Promise<CapabilityResult>;
    unsubscribe(): void;
}
export interface ExtensionAbortSignal {
    readonly aborted: boolean;
    readonly reason?: unknown;
    addEventListener(type: "abort", listener: () => void, options?: {
        readonly once?: boolean;
    }): void;
    removeEventListener(type: "abort", listener: () => void): void;
}
export type ExtensionStreamAbortSignal = ExtensionAbortSignal;
export type ExtensionStreamProgress<TData = never> = CapabilityResult & {
    status: "partial";
} & ([TData] extends [never] ? object : {
    data: TData;
});
export type ExtensionStreamProgressCallback<TData = never> = (progress: ExtensionStreamProgress<TData>, notification: JsonRpcNotification) => unknown;
export interface ExtensionStreamProgressSubscription extends ExtensionDisposable {
    unsubscribe(): void;
}
export interface ExtensionStreamOptions<TProgress = never> {
    signal?: ExtensionStreamAbortSignal;
    onProgress?: ExtensionStreamProgressCallback<TProgress>;
}
export interface TypedExtensionStreamHandle<TOutcome extends AnyCapabilityOutcome, TProgress = never> extends ExtensionDisposable {
    readonly id: JsonRpcRequestId;
    readonly result: Promise<TypedCapabilityResult<TOutcome>>;
    onProgress(callback: ExtensionStreamProgressCallback<TProgress>): ExtensionStreamProgressSubscription;
    cancel(reason?: JsonValue): void;
}
export interface ExtensionCapabilities {
    request(method: JsonRpcMethod, params?: JsonRpcParams): Promise<CapabilityResult>;
    subscribe(method: JsonRpcMethod, callback: (params: JsonRpcNotification["params"], notification: JsonRpcNotification) => unknown): ExtensionSubscription;
    stream(method: JsonRpcMethod, params?: JsonRpcParams, options?: ExtensionStreamOptions): {
        readonly id: JsonRpcRequestId;
        readonly result: Promise<CapabilityResult>;
        onProgress(callback: ExtensionStreamProgressCallback): ExtensionStreamProgressSubscription;
        cancel(reason?: JsonValue): void;
        dispose(): void;
    };
}
export interface ToolAnnotations {
    readOnly?: boolean;
    destructive?: boolean;
    idempotent?: boolean;
    requiresConfirmation?: boolean;
    externalAccess?: boolean;
    [key: string]: JsonValue | undefined;
}
export interface ToolDescriptor {
    name: string;
    title: string;
    description: string;
    inputSchema: JsonObject;
    requiredCapabilities: string[];
    annotations: ToolAnnotations;
}
export type ReadonlyJsonValue = string | number | boolean | null | readonly ReadonlyJsonValue[] | {
    readonly [key: string]: ReadonlyJsonValue;
};
export type ReadonlyJsonObject = {
    readonly [key: string]: ReadonlyJsonValue;
};
export type ReadonlyToolAnnotations = {
    readonly readOnly?: boolean;
    readonly destructive?: boolean;
    readonly idempotent?: boolean;
    readonly requiresConfirmation?: boolean;
    readonly externalAccess?: boolean;
    readonly [key: string]: ReadonlyJsonValue | undefined;
};
export interface ReadonlyToolDescriptor {
    readonly name: string;
    readonly title: string;
    readonly description: string;
    readonly inputSchema: ReadonlyJsonObject;
    readonly requiredCapabilities: readonly string[];
    readonly annotations: ReadonlyToolAnnotations;
}
