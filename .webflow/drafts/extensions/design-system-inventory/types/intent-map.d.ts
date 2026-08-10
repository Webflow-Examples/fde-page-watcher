import type { JsonRpcParams } from "./shared";
export interface ExtensionIntentDefinition<TParams extends object | undefined = JsonRpcParams | undefined, TData = unknown> {
    params: TParams;
    data: TData;
}
export type ExtensionIntentMapConstraint<TIntents> = {
    [TIntent in keyof TIntents]: TIntents[TIntent] extends ExtensionIntentDefinition<object | undefined, unknown> ? TIntents[TIntent] : never;
};
export type UntypedExtensionIntentMap = Record<string, ExtensionIntentDefinition<JsonRpcParams | undefined, unknown>>;
export type ExtensionIntentName<TIntents> = Extract<keyof TIntents, string>;
export type ExtensionIntentParams<TIntents, TIntent extends ExtensionIntentName<TIntents>> = TIntents[TIntent] extends {
    params: infer TParams;
} ? TParams : never;
export type ExtensionIntentData<TIntents, TIntent extends ExtensionIntentName<TIntents>> = TIntents[TIntent] extends {
    data: infer TData;
} ? TData : never;
export type ExtensionIntentParamsOptional<TParams> = undefined extends TParams ? true : Record<string, never> extends TParams ? true : false;
export type ExtensionIntentParamsProperty<TParams> = ExtensionIntentParamsOptional<TParams> extends true ? {
    readonly params?: TParams;
} : {
    readonly params: TParams;
};
