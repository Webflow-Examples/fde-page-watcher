import type { ExtensionProvidedApiMapConstraint, ExtensionProvidedApiMethodInput, ExtensionProvidedApiMethodName, ExtensionProvidedApiMethodResult, ExtensionProvidedApiName } from "./extension-provided-api";
import type { CapabilityOutcome, JsonRpcRequestId, JsonValue, TypedCapabilityResult } from "./shared";
export interface ExtensionBlockAbortSignal {
    readonly aborted: boolean;
    addEventListener?(type: "abort", listener: () => void, options?: {
        readonly once?: boolean;
    }): void;
    removeEventListener?(type: "abort", listener: () => void): void;
}
export interface ExtensionBlockRequestOptions {
    readonly signal?: ExtensionBlockAbortSignal;
    /** Positive milliseconds before timeout; `Infinity` is accepted where the host permits it. Block actions remain host-deadline bounded. */
    readonly timeoutMs?: number;
}
export interface ExtensionBlockActionHandlerContext {
    readonly signal: ExtensionBlockAbortSignal;
}
type ExtensionBlockContractInput<TContract> = TContract extends {
    readonly input: infer TInput;
} ? TInput : never;
type ExtensionBlockContractResult<TContract> = TContract extends {
    readonly result: infer TResult;
} ? TResult : never;
export interface ExtensionBlockCallClient<TContract> {
    invoke(input: ExtensionBlockContractInput<TContract>, options?: ExtensionBlockRequestOptions): Promise<ExtensionBlockContractResult<TContract>>;
}
export type ExtensionBlockCallsClient<TCalls> = [TCalls] extends [never] ? Readonly<Record<never, never>> : {
    readonly [TCall in keyof TCalls]: ExtensionBlockCallClient<TCalls[TCall]>;
};
export interface ExtensionBlockActionClient<TContract> {
    handle(handler: (input: ExtensionBlockContractInput<TContract>, context: ExtensionBlockActionHandlerContext) => ExtensionBlockContractResult<TContract> | Promise<ExtensionBlockContractResult<TContract>>): () => void;
}
export type ExtensionBlockActionsClient<TActions> = [TActions] extends [never] ? Readonly<Record<never, never>> : {
    readonly [TAction in keyof TActions]: ExtensionBlockActionClient<TActions[TAction]>;
};
export interface ExtensionBlockProvidedApiClient<TApi> {
    call<TMethod extends ExtensionProvidedApiMethodName<TApi>>(method: TMethod, input: ExtensionProvidedApiMethodInput<TApi, TMethod>, options?: ExtensionBlockRequestOptions): Promise<TypedCapabilityResult<CapabilityOutcome<ExtensionProvidedApiMethodResult<TApi, TMethod>>>>;
}
export type ExtensionBlockProvidedApiMethod<TApis extends ExtensionProvidedApiMapConstraint<TApis>> = <TApiId extends ExtensionProvidedApiName<TApis>>(apiId: TApiId) => ExtensionBlockProvidedApiClient<TApis[TApiId]>;
export type ExtensionBlockApiDependencies<TBlock extends {
    readonly dependencies: {
        readonly extensionApis: object;
    };
}> = TBlock["dependencies"]["extensionApis"];
export type ExtensionBlockStatePorts<TBlock> = TBlock extends {
    readonly coordination: {
        readonly statePorts: infer TPorts;
    };
} ? TPorts : never;
export type ExtensionBlockCalls<TBlock> = TBlock extends {
    readonly dependencies: {
        readonly extensionApis: object;
    };
    readonly calls: infer TCalls;
} ? TCalls : never;
export type ExtensionBlockActions<TBlock> = TBlock extends {
    readonly dependencies: {
        readonly extensionApis: object;
    };
    readonly actions: infer TActions;
} ? TActions : never;
export interface ExtensionBlockStateSnapshot<TValue extends JsonValue = JsonValue> {
    readonly value: TValue;
    readonly revision: number;
}
export interface ExtensionBlockStateFailure<TValue extends JsonValue = JsonValue> {
    readonly status: "error";
    readonly code: "undeclared_port" | "unbound_port" | "access_denied" | "invalid_value" | "value_too_large" | "revision_conflict" | "stale_runtime";
    readonly placementId: string;
    readonly port: string;
    readonly slotId?: string;
    readonly currentRevision?: number;
    readonly current?: ExtensionBlockStateSnapshot<TValue>;
}
export type ExtensionBlockStateCurrentResult<TValue extends JsonValue> = {
    readonly status: "ok";
    /** Revision 0 is the initial unset state; a higher revision was cleared. */
    readonly revision: number;
    readonly snapshot?: ExtensionBlockStateSnapshot<TValue>;
} | ExtensionBlockStateFailure<TValue>;
export type ExtensionBlockStatePublishResult<TValue extends JsonValue> = {
    readonly status: "ok";
    readonly snapshot: ExtensionBlockStateSnapshot<TValue>;
} | ExtensionBlockStateFailure<TValue>;
export type ExtensionBlockStateSubscribeResult<TValue extends JsonValue> = {
    readonly status: "ok";
    /** Revision 0 is the initial unset state; a higher revision was cleared. */
    readonly revision: number;
    readonly snapshot?: ExtensionBlockStateSnapshot<TValue>;
    unsubscribe(): void;
} | ExtensionBlockStateFailure<TValue>;
export type ExtensionBlockStateClearResult<TValue extends JsonValue> = {
    readonly status: "ok";
    readonly revision: number;
} | ExtensionBlockStateFailure<TValue>;
export type ExtensionBlockStatePublishOptions = {
    /** Bind this write to an explicit snapshot revision. Defaults to the latest observed revision. */
    readonly expectedRevision?: number;
    readonly replace?: never;
} | {
    /** Intentionally write without compare-and-set. */
    readonly replace: true;
    readonly expectedRevision?: never;
};
interface ExtensionBlockReadableStatePort<TValue extends JsonValue> {
    current(): Promise<ExtensionBlockStateCurrentResult<TValue>>;
    subscribe(listener: (snapshot: ExtensionBlockStateSnapshot<TValue> | undefined, revision: number) => unknown): Promise<ExtensionBlockStateSubscribeResult<TValue>>;
}
interface ExtensionBlockWritableStatePort<TValue extends JsonValue> {
    publish(value: TValue, options?: ExtensionBlockStatePublishOptions): Promise<ExtensionBlockStatePublishResult<TValue>>;
    clear(options?: ExtensionBlockStatePublishOptions): Promise<ExtensionBlockStateClearResult<TValue>>;
}
type ExtensionBlockStatePortClient<TPort> = TPort extends {
    readonly value: infer TValue extends JsonValue;
    readonly access: infer TAccess;
} ? (TAccess extends "read" | "read-write" ? ExtensionBlockReadableStatePort<TValue> : object) & (TAccess extends "write" | "read-write" ? ExtensionBlockWritableStatePort<TValue> : object) : never;
export type ExtensionBlockStateClient<TPorts> = [TPorts] extends [never] ? Readonly<Record<never, never>> : {
    readonly [TPort in keyof TPorts]: ExtensionBlockStatePortClient<TPorts[TPort]>;
};
export interface ExtensionBlockConnectOptions {
    readonly targetOrigin?: string;
    readonly expectedOrigin?: string | readonly string[];
}
export interface ExtensionBlockTransportErrorShape {
    readonly type: "transport";
    readonly message: string;
    readonly code?: number | string;
    readonly data?: JsonValue | undefined;
    readonly id?: JsonRpcRequestId | null;
}
export interface ExtensionBlockClientBase {
    disconnect(): void;
}
export type ExtensionBlockClient<TProvidedApis extends ExtensionProvidedApiMapConstraint<TProvidedApis>, TStatePorts = never, TCalls = never, TActions = never> = ExtensionBlockClientBase & {
    readonly providedApi: ExtensionBlockProvidedApiMethod<TProvidedApis>;
    readonly state: ExtensionBlockStateClient<TStatePorts>;
    readonly calls: ExtensionBlockCallsClient<TCalls>;
    readonly actions: ExtensionBlockActionsClient<TActions>;
};
export type ExtensionBlockConnectionApis<TBlockOrApis> = TBlockOrApis extends {
    readonly dependencies: {
        readonly extensionApis: infer TApis;
    };
} ? TApis : TBlockOrApis;
export type ExtensionBlockConnectionState<TBlockOrApis> = ExtensionBlockStatePorts<TBlockOrApis>;
export type ExtensionBlockConnectionCalls<TBlockOrApis> = ExtensionBlockCalls<TBlockOrApis>;
export type ExtensionBlockConnectionActions<TBlockOrApis> = ExtensionBlockActions<TBlockOrApis>;
export interface WebflowExtensionBlockGlobal {
    /** Host-validated configuration for this placement. */
    readonly configuration: JsonValue;
    readonly TransportError: new (message: string, details?: Partial<ExtensionBlockTransportErrorShape>) => Error & ExtensionBlockTransportErrorShape;
    connect<TBlockOrApis = never>(...args: [TBlockOrApis] extends [never] ? [options: never] : [options?: ExtensionBlockConnectOptions]): ExtensionBlockClient<ExtensionBlockConnectionApis<TBlockOrApis> & ExtensionProvidedApiMapConstraint<ExtensionBlockConnectionApis<TBlockOrApis>>, ExtensionBlockConnectionState<TBlockOrApis>, ExtensionBlockConnectionCalls<TBlockOrApis>, ExtensionBlockConnectionActions<TBlockOrApis>>;
}
