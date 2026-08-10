import type { CapabilityOutcome, CapabilityProducerOutcome, ExtensionAbortSignal, ExtensionCapabilities, TypedCapabilityResult } from "./shared";
export interface ExtensionProvidedApiMethodDefinition<TInput extends object, TResult> {
    readonly input: TInput;
    readonly result: TResult;
}
export interface ExtensionProvidedApiDefinition<TVersion extends number, TMethods> {
    readonly version: TVersion;
    readonly methods: TMethods;
}
export type ExtensionProvidedApiMapConstraint<TApis> = {
    readonly [TApiId in keyof TApis]: TApis[TApiId] extends ExtensionProvidedApiDefinition<infer TVersion, infer TMethods> ? TMethods extends ExtensionProvidedApiMethodMapConstraint<TMethods> ? ExtensionProvidedApiDefinition<TVersion, TMethods> : never : never;
};
type ExtensionProvidedApiMethodMapConstraint<TMethods> = {
    readonly [TMethod in keyof TMethods]: TMethods[TMethod] extends ExtensionProvidedApiMethodDefinition<infer TInput, infer TResult> ? ExtensionProvidedApiMethodDefinition<TInput, TResult> : never;
};
export type UntypedExtensionProvidedApiMap = Readonly<Record<string, ExtensionProvidedApiDefinition<number, Readonly<Record<string, ExtensionProvidedApiMethodDefinition<object, unknown>>>>>>;
export type ExtensionProvidedApiName<TApis extends ExtensionProvidedApiMapConstraint<TApis>> = Extract<keyof TApis, string>;
export type ExtensionProvidedApiVersion<TApi> = TApi extends ExtensionProvidedApiDefinition<infer TVersion, unknown> ? TVersion : never;
export type ExtensionProvidedApiMethodName<TApi> = TApi extends ExtensionProvidedApiDefinition<number, infer TMethods> ? Extract<keyof TMethods, string> : never;
export type ExtensionProvidedApiMethodInput<TApi, TMethod> = TApi extends ExtensionProvidedApiDefinition<number, infer TMethods> ? TMethod extends keyof TMethods ? TMethods[TMethod] extends ExtensionProvidedApiMethodDefinition<infer TInput, unknown> ? TInput : never : never : never;
export type ExtensionProvidedApiMethodResult<TApi, TMethod> = TApi extends ExtensionProvidedApiDefinition<number, infer TMethods> ? TMethod extends keyof TMethods ? TMethods[TMethod] extends ExtensionProvidedApiMethodDefinition<object, infer TResult> ? TResult : never : never : never;
export interface ExtensionProvidedApiHandlerContext<TInput extends object> {
    readonly input: TInput;
    readonly capabilities: ExtensionCapabilities;
    readonly signal: ExtensionAbortSignal;
}
export type ExtensionProvidedApiHandlerResult<TResult> = CapabilityProducerOutcome<TResult> | TypedCapabilityResult<CapabilityOutcome<TResult>>;
export type ExtensionProvidedApiHandler<TMethod> = TMethod extends ExtensionProvidedApiMethodDefinition<infer TInput, infer TResult> ? (context: ExtensionProvidedApiHandlerContext<TInput>) => ExtensionProvidedApiHandlerResult<TResult> | Promise<ExtensionProvidedApiHandlerResult<TResult>> : never;
export type ExtensionProvidedApiHandlers<TApi> = TApi extends ExtensionProvidedApiDefinition<number, infer TMethods> ? {
    readonly [TMethod in keyof TMethods]: ExtensionProvidedApiHandler<TMethods[TMethod]>;
} : never;
export type ExtensionProvidedApiHandlerMap<TApis extends ExtensionProvidedApiMapConstraint<TApis>> = {
    readonly [TApiId in keyof TApis]: ExtensionProvidedApiHandlers<TApis[TApiId]>;
};
