export type { ExtensionProvidedApiDefinition, ExtensionProvidedApiMapConstraint, ExtensionProvidedApiMethodDefinition, ExtensionProvidedApiMethodInput, ExtensionProvidedApiMethodName, ExtensionProvidedApiMethodResult, ExtensionProvidedApiName, } from "./extension-provided-api";
export type { CapabilityResult, JsonObject, JsonValue } from "./shared";
export type { ExtensionBlockAbortSignal, ExtensionBlockApiDependencies, ExtensionBlockClient, ExtensionBlockConnectOptions, ExtensionBlockProvidedApiClient, ExtensionBlockProvidedApiMethod, ExtensionBlockRequestOptions, ExtensionBlockStateClient, ExtensionBlockStateClearResult, ExtensionBlockStateCurrentResult, ExtensionBlockStateFailure, ExtensionBlockStatePorts, ExtensionBlockStatePublishOptions, ExtensionBlockStatePublishResult, ExtensionBlockStateSnapshot, ExtensionBlockStateSubscribeResult, ExtensionBlockTransportErrorShape, WebflowExtensionBlockGlobal, } from "./block";
import type { WebflowExtensionBlockGlobal } from "./block";
declare global {
    const WebflowExtensionBlock: WebflowExtensionBlockGlobal;
    interface Window {
        readonly WebflowExtensionBlock: WebflowExtensionBlockGlobal;
    }
}
