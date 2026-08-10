export type { ExtensionProvidedApiDefinition, ExtensionProvidedApiMapConstraint, ExtensionProvidedApiMethodDefinition, ExtensionProvidedApiMethodInput, ExtensionProvidedApiMethodName, ExtensionProvidedApiMethodResult, ExtensionProvidedApiName, ExtensionProvidedApiVersion, } from "./extension-provided-api";
export type { ExtensionIntentData, ExtensionIntentDefinition, ExtensionIntentMapConstraint, ExtensionIntentName, ExtensionIntentParams, ExtensionIntentParamsOptional, UntypedExtensionIntentMap, } from "./intent-map";
export type { CapabilityResult, JsonObject, JsonValue, } from "./shared";
export type { ExtensionViewAbortSignal, ExtensionViewClient, ExtensionViewConnectOptions, ExtensionViewDataParseResult, ExtensionViewIntentOptions, ExtensionViewProvidedApiClient, ExtensionViewProvidedApiMethod, ExtensionViewProvidedApiOptions, ExtensionViewResultHandlers, ExtensionViewTransportErrorShape, TypedExtensionViewIntentMethod, UntypedExtensionViewIntentMethod, UntypedExtensionViewProvidedApiMethod, WebflowExtensionViewGlobal, } from "./view";
import type { WebflowExtensionViewGlobal } from "./view";
declare global {
    const WebflowExtensionView: WebflowExtensionViewGlobal;
    interface Window {
        readonly WebflowExtensionView: WebflowExtensionViewGlobal;
    }
}
