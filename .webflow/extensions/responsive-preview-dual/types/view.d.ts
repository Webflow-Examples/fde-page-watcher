import type { ExtensionProvidedApiMapConstraint, ExtensionProvidedApiMethodInput, ExtensionProvidedApiMethodName, ExtensionProvidedApiMethodResult, ExtensionProvidedApiName, ExtensionProvidedApiVersion, UntypedExtensionProvidedApiMap } from "./extension-provided-api";
import type { ExtensionIntentData, ExtensionIntentMapConstraint, ExtensionIntentName, ExtensionIntentParams, ExtensionIntentParamsOptional, UntypedExtensionIntentMap } from "./intent-map";
import type { BlockedResultReader, CapabilityOkOutcome, CapabilityOutcome, CapabilityResult, JsonRpcMethod, JsonRpcParams, JsonRpcRequestId, JsonValue, NeedsInputResult, TypedCapabilityResult } from "./shared";
export interface ExtensionViewAbortSignal {
    readonly aborted: boolean;
    addEventListener?(type: "abort", listener: () => void, options?: {
        readonly once?: boolean;
    }): void;
    removeEventListener?(type: "abort", listener: () => void): void;
}
export interface ExtensionViewIntentOptions {
    readonly signal?: ExtensionViewAbortSignal;
    /** Positive milliseconds before timeout; `Infinity` disables the deadline. */
    readonly timeoutMs?: number;
}
export type ExtensionViewProvidedApiOptions = ExtensionViewIntentOptions;
export interface ExtensionViewProvidedApiClient<TApi> {
    call<TMethod extends ExtensionProvidedApiMethodName<TApi>>(method: TMethod, input: ExtensionProvidedApiMethodInput<TApi, TMethod>, options?: ExtensionViewProvidedApiOptions): Promise<TypedCapabilityResult<CapabilityOutcome<ExtensionProvidedApiMethodResult<TApi, TMethod>>>>;
}
export type ExtensionViewProvidedApiMethod<TApis extends ExtensionProvidedApiMapConstraint<TApis>> = <TApiId extends ExtensionProvidedApiName<TApis>>(extensionId: string, apiId: TApiId, version: ExtensionProvidedApiVersion<TApis[TApiId]>) => ExtensionViewProvidedApiClient<TApis[TApiId]>;
export type UntypedExtensionViewProvidedApiMethod = (extensionId: string, apiId: string, version: number) => ExtensionViewProvidedApiClient<UntypedExtensionProvidedApiMap[string]>;
export interface ExtensionViewConnectOptions {
    readonly targetOrigin?: string;
    readonly expectedOrigin?: string | readonly string[];
}
export interface ExtensionViewTransportErrorShape {
    readonly type: "transport";
    readonly message: string;
    readonly code?: number | string;
    readonly data?: JsonValue | undefined;
    readonly id?: JsonRpcRequestId | null;
}
type TypedExtensionViewIntentArgs<TParams> = ExtensionIntentParamsOptional<TParams> extends true ? [] | [params: TParams] | [params: TParams | undefined, options: ExtensionViewIntentOptions] : [params: TParams] | [params: TParams, options: ExtensionViewIntentOptions];
export type UntypedExtensionViewIntentMethod = <TCapabilityResult extends CapabilityResult = CapabilityResult>(method: JsonRpcMethod, params?: JsonRpcParams, options?: ExtensionViewIntentOptions) => Promise<TCapabilityResult>;
export type TypedExtensionViewIntentMethod<TIntents extends ExtensionIntentMapConstraint<TIntents>> = <TIntent extends ExtensionIntentName<TIntents>>(method: TIntent, ...args: TypedExtensionViewIntentArgs<ExtensionIntentParams<TIntents, TIntent>>) => Promise<TypedCapabilityResult<CapabilityOutcome<ExtensionIntentData<TIntents, TIntent>>>>;
export type ExtensionViewDataParseResult<TData> = {
    readonly ok: true;
    readonly value: TData;
} | {
    readonly ok: false;
};
export interface ExtensionViewResultHandlers<TData, TReturn> {
    readOkData(value: JsonValue | undefined): ExtensionViewDataParseResult<TData>;
    ok(result: CapabilityOkOutcome<TData>): TReturn;
    needs_input(result: NeedsInputResult): TReturn;
    blocked(result: BlockedResultReader): TReturn;
    unknown(status: string, result: CapabilityResult): TReturn;
}
export interface ExtensionViewClientBase {
    onMessage(handler: (message: unknown) => void): () => void;
    disconnect(): void;
}
export type ExtensionViewClient<TIntents extends ExtensionIntentMapConstraint<TIntents> = UntypedExtensionIntentMap, TProvidedApis extends ExtensionProvidedApiMapConstraint<TProvidedApis> = UntypedExtensionProvidedApiMap> = ExtensionViewClientBase & {
    readonly intent: string extends keyof TIntents ? UntypedExtensionViewIntentMethod : TypedExtensionViewIntentMethod<TIntents>;
    readonly providedApi: string extends keyof TProvidedApis ? UntypedExtensionViewProvidedApiMethod : ExtensionViewProvidedApiMethod<TProvidedApis>;
};
export interface WebflowExtensionViewGlobal {
    readonly TransportError: new (message: string, details?: Partial<ExtensionViewTransportErrorShape>) => Error & ExtensionViewTransportErrorShape;
    connect(options?: ExtensionViewConnectOptions): ExtensionViewClient;
    connect<TIntents extends ExtensionIntentMapConstraint<TIntents>>(options?: ExtensionViewConnectOptions): ExtensionViewClient<TIntents>;
    connect<TIntents extends ExtensionIntentMapConstraint<TIntents>, TProvidedApis extends ExtensionProvidedApiMapConstraint<TProvidedApis>>(options?: ExtensionViewConnectOptions): ExtensionViewClient<TIntents, TProvidedApis>;
    matchResult<TData, TReturn>(result: TypedCapabilityResult<CapabilityOutcome<TData>>, handlers: ExtensionViewResultHandlers<NoInfer<TData>, TReturn>): TReturn;
}
