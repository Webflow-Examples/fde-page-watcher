import type { ExtensionStreamOptions, ExtensionSubscription, JsonRpcNotification, TypedCapabilityResult, TypedExtensionStreamHandle } from "./shared";
import type { PublicCapabilityMetadataMap, PublicCapabilityMethod } from "./capability-metadata";
import type { PublicCapabilityContractMap } from "./generated-capability-types";
export type * from "./generated-capability-types";
export type TypedCapabilityMethod = PublicCapabilityMethod;
type RequestResponseCapabilityMethod = {
    [TMethod in TypedCapabilityMethod]: PublicCapabilityMetadataMap[TMethod]["invocationMode"] extends "request-response" ? TMethod : never;
}[TypedCapabilityMethod];
type CapabilityIntentData<TOutcome> = [TOutcome] extends [never] ? never : Extract<TOutcome, {
    status: "ok";
}> extends infer TOk ? TOk extends {
    data?: unknown;
} ? TOk["data"] : never : never;
/**
 * Intent declaration that delegates one request-response capability without
 * exposing that capability's result envelope to extension-authored source.
 */
export type CapabilityIntentDefinition<TMethod extends RequestResponseCapabilityMethod> = {
    params: PublicCapabilityContractMap[TMethod]["params"];
    data: CapabilityIntentData<PublicCapabilityContractMap[TMethod]["result"]>;
};
type PublicCapabilityNamespace = PublicCapabilityMetadataMap[TypedCapabilityMethod]["namespace"];
type CapabilityParamsMode<TMethod extends TypedCapabilityMethod> = PublicCapabilityMetadataMap[TMethod] extends {
    params: infer TMode;
} ? TMode : never;
type RequestArgs<TMethod extends TypedCapabilityMethod, TParams> = CapabilityParamsMode<TMethod> extends "optional" ? [] | [params: TParams] : [params: TParams];
type StreamArgs<TMethod extends TypedCapabilityMethod, TParams, TProgress> = CapabilityParamsMode<TMethod> extends "optional" ? [] | [params: TParams] | [params: TParams, options: ExtensionStreamOptions<TProgress>] : [params: TParams] | [params: TParams, options: ExtensionStreamOptions<TProgress>];
type CapabilityApiMethod<TMethod extends TypedCapabilityMethod> = PublicCapabilityMetadataMap[TMethod]["invocationMode"] extends "request-response" ? (...args: RequestArgs<TMethod, PublicCapabilityContractMap[TMethod]["params"]>) => Promise<TypedCapabilityResult<PublicCapabilityContractMap[TMethod]["result"]>> : PublicCapabilityMetadataMap[TMethod]["invocationMode"] extends "stream" ? PublicCapabilityContractMap[TMethod] extends {
    progress: infer TProgress;
} ? (...args: StreamArgs<TMethod, PublicCapabilityContractMap[TMethod]["params"], TProgress>) => TypedExtensionStreamHandle<PublicCapabilityContractMap[TMethod]["result"], TProgress> : never : PublicCapabilityMetadataMap[TMethod]["invocationMode"] extends "event-notification" ? (callback: (params: PublicCapabilityContractMap[TMethod]["params"], notification: JsonRpcNotification) => unknown) => ExtensionSubscription : never;
type GrantedMethod<TGrantedMethods extends readonly string[]> = string extends TGrantedMethods[number] ? TypedCapabilityMethod : Extract<TGrantedMethods[number], TypedCapabilityMethod>;
type MethodsForNamespace<TNamespace extends PublicCapabilityNamespace> = {
    [TMethod in TypedCapabilityMethod]: PublicCapabilityMetadataMap[TMethod]["namespace"] extends TNamespace ? TMethod : never;
}[TypedCapabilityMethod];
type GrantedNamespace<TNamespace extends PublicCapabilityNamespace, TGrantedMethods extends readonly string[]> = Extract<MethodsForNamespace<TNamespace>, GrantedMethod<TGrantedMethods>> extends never ? never : TNamespace;
type NamespaceApi<TNamespace extends PublicCapabilityNamespace, TGrantedMethods extends readonly string[]> = {
    readonly [TMethod in Extract<MethodsForNamespace<TNamespace>, GrantedMethod<TGrantedMethods>> as PublicCapabilityMetadataMap[TMethod]["memberName"]]: CapabilityApiMethod<TMethod>;
};
export type TypedCapabilities<TGrantedMethods extends readonly string[] = readonly TypedCapabilityMethod[]> = {
    readonly [TNamespace in PublicCapabilityNamespace as GrantedNamespace<TNamespace, TGrantedMethods>]: NamespaceApi<TNamespace, TGrantedMethods>;
};
