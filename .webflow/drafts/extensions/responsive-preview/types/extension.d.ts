import type { ExtensionIntentData, ExtensionIntentDefinition, ExtensionIntentMapConstraint, ExtensionIntentName, ExtensionIntentParams, ExtensionIntentParamsProperty, UntypedExtensionIntentMap } from "./intent-map";
import type { ExtensionProvidedApiHandlers, ExtensionProvidedApiMapConstraint, UntypedExtensionProvidedApiMap } from "./extension-provided-api";
import type { CapabilityResult, ExtensionAbortSignal, CapabilityOutcome, CapabilityProducerOutcome, ExtensionCapabilities, ExtensionDisposable, JsonRpcMethod, JsonRpcParams, ReadonlyToolDescriptor, ToolDescriptor, TypedCapabilityResult } from "./shared";
export interface ExtensionRegistrationDiagnostic {
    readonly severity: "error";
    readonly code: string;
    readonly message: string;
    readonly path?: string;
}
export type ExtensionViewIntentDispatch<TIntents extends ExtensionIntentMapConstraint<TIntents> = UntypedExtensionIntentMap> = string extends keyof TIntents ? {
    readonly viewId: string;
    readonly intent: JsonRpcMethod;
    readonly params?: JsonRpcParams;
} : {
    [TIntent in ExtensionIntentName<TIntents>]: {
        readonly viewId: string;
        readonly intent: TIntent;
    } & ExtensionIntentParamsProperty<ExtensionIntentParams<TIntents, TIntent>>;
}[ExtensionIntentName<TIntents>];
export type ExtensionViewIntentHandlerContext<TIntents extends ExtensionIntentMapConstraint<TIntents>, TIntent extends ExtensionIntentName<TIntents>> = {
    readonly viewId: string;
    readonly intent: TIntent;
    readonly capabilities: ExtensionCapabilities;
} & ExtensionIntentParamsProperty<ExtensionIntentParams<TIntents, TIntent>>;
export type ExtensionViewIntentHandler<TIntents extends ExtensionIntentMapConstraint<TIntents>, TIntent extends ExtensionIntentName<TIntents>> = (context: ExtensionViewIntentHandlerContext<TIntents, TIntent>) => Promise<ExtensionViewIntentHandlerResult<ExtensionIntentData<TIntents, TIntent>> | undefined> | ExtensionViewIntentHandlerResult<ExtensionIntentData<TIntents, TIntent>> | undefined;
type ExtensionViewIntentHandlerResult<TData> = CapabilityOutcome<TData> | TypedCapabilityResult<CapabilityOutcome<TData>>;
export type ExtensionUiContributionOptions<TIntents extends ExtensionIntentMapConstraint<TIntents> = UntypedExtensionIntentMap> = string extends keyof TIntents ? {
    readonly intents?: Readonly<Record<string, UntypedExtensionViewIntentHandler>>;
} : {
    readonly intents: {
        readonly [TIntent in ExtensionIntentName<TIntents>]: ExtensionViewIntentHandler<TIntents, TIntent>;
    };
};
type ExtensionViewIntentResult<TIntents extends ExtensionIntentMapConstraint<TIntents>> = string extends keyof TIntents ? CapabilityResult : ExtensionViewIntentHandlerResult<ExtensionIntentData<TIntents, ExtensionIntentName<TIntents>>>;
export interface ExtensionUiContributionRegistration<TIntents extends ExtensionIntentMapConstraint<TIntents> = UntypedExtensionIntentMap> {
    readonly kind: "extension-ui";
    readonly id: string;
    readonly intents: readonly ExtensionIntentName<TIntents>[];
    handleIntent(dispatch: ExtensionViewIntentDispatch<TIntents>): Promise<ExtensionViewIntentResult<TIntents> | undefined> | ExtensionViewIntentResult<TIntents> | undefined;
}
export interface ExtensionToolContributionRegistration {
    readonly kind: "tool";
    readonly name: string;
    readonly descriptor: ReadonlyToolDescriptor;
}
export interface ExtensionProvidedApiRegistration {
    readonly kind: "provided-api";
    readonly id: string;
    readonly version: number;
    readonly methods: readonly string[];
    handle(request: {
        readonly method: string;
        readonly input: Readonly<Record<string, unknown>>;
        readonly signal: ExtensionAbortSignal;
    }): CapabilityProducerOutcome<unknown> | TypedCapabilityResult<CapabilityOutcome<unknown>> | Promise<CapabilityProducerOutcome<unknown> | TypedCapabilityResult<CapabilityOutcome<unknown>>> | undefined;
}
export type ExtensionContributionRegistration<TIntents extends ExtensionIntentMapConstraint<TIntents> = UntypedExtensionIntentMap> = ExtensionUiContributionRegistration<TIntents> | ExtensionToolContributionRegistration | ExtensionProvidedApiRegistration;
export type ExtensionRegistrationResult<TRegistration, TDiagnostic extends ExtensionRegistrationDiagnostic = ExtensionRegistrationDiagnostic> = (ExtensionDisposable & {
    readonly ok: true;
    readonly registration: TRegistration;
    readonly diagnostics: readonly [];
}) | (ExtensionDisposable & {
    readonly ok: false;
    readonly diagnostics: readonly TDiagnostic[];
    readonly registration?: undefined;
});
export interface ExtensionContext<TIntents extends ExtensionIntentMapConstraint<TIntents> = UntypedExtensionIntentMap, TDiagnostic extends ExtensionRegistrationDiagnostic = ExtensionRegistrationDiagnostic, TProvidedApis extends ExtensionProvidedApiMapConstraint<TProvidedApis> = UntypedExtensionProvidedApiMap> {
    readonly capabilities: ExtensionCapabilities;
    readonly subscriptions: ExtensionDisposable[];
    registerExtensionUiContribution(id: string, ...args: string extends keyof TIntents ? [options?: ExtensionUiContributionOptions<TIntents>] : [options: ExtensionUiContributionOptions<TIntents>]): ExtensionRegistrationResult<ExtensionUiContributionRegistration<TIntents>, TDiagnostic>;
    registerTool(descriptor: ToolDescriptor): ExtensionRegistrationResult<ExtensionToolContributionRegistration, TDiagnostic>;
    registerProvidedApi<TApiId extends Extract<keyof TProvidedApis, string>>(apiId: TApiId, handlers: ExtensionProvidedApiHandlers<TProvidedApis[TApiId]>): ExtensionRegistrationResult<ExtensionProvidedApiRegistration, TDiagnostic>;
}
export type ExtensionActivate<TIntents extends ExtensionIntentMapConstraint<TIntents> = UntypedExtensionIntentMap, TDiagnostic extends ExtensionRegistrationDiagnostic = ExtensionRegistrationDiagnostic, TProvidedApis extends ExtensionProvidedApiMapConstraint<TProvidedApis> = UntypedExtensionProvidedApiMap> = (context: ExtensionContext<TIntents, TDiagnostic, TProvidedApis>) => void;
export type ExtensionProvidedApiContext<TProvidedApis extends ExtensionProvidedApiMapConstraint<TProvidedApis>, TIntents extends ExtensionIntentMapConstraint<TIntents> = UntypedExtensionIntentMap, TDiagnostic extends ExtensionRegistrationDiagnostic = ExtensionRegistrationDiagnostic> = ExtensionContext<TIntents, TDiagnostic, TProvidedApis>;
export type ExtensionProvidedApiActivate<TProvidedApis extends ExtensionProvidedApiMapConstraint<TProvidedApis>, TIntents extends ExtensionIntentMapConstraint<TIntents> = UntypedExtensionIntentMap, TDiagnostic extends ExtensionRegistrationDiagnostic = ExtensionRegistrationDiagnostic> = ExtensionActivate<TIntents, TDiagnostic, TProvidedApis>;
export type UntypedExtensionViewIntentHandler = (context: {
    readonly viewId: string;
    readonly intent: JsonRpcMethod;
    readonly params?: JsonRpcParams;
    readonly capabilities: ExtensionCapabilities;
}) => Promise<CapabilityResult | undefined> | CapabilityResult | undefined;
export type { ExtensionIntentDefinition };
