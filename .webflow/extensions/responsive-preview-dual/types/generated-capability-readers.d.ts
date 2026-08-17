type ContractPresence = "required" | "optional";
type ContractInvocationMode = "request-response" | "stream";
type ReaderContractValue = {
    readonly kind: "string";
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly format?: "non-blank" | "date-time" | "date" | "image-data-url" | "capability-scope" | "normalized-project-file-path" | "json-rpc-method";
    readonly values?: readonly string[];
} | {
    readonly kind: "number";
    readonly integer?: boolean;
    readonly minimum?: number;
    readonly maximum?: number;
} | {
    readonly kind: "boolean";
} | {
    readonly kind: "json";
} | {
    readonly kind: "literal";
    readonly value: string | number | boolean | null;
} | {
    readonly kind: "named";
    readonly name: string;
} | {
    readonly kind: "array";
    readonly items: ReaderContractValue;
    readonly minItems?: number;
    readonly maxItems?: number;
} | {
    readonly kind: "union";
    readonly variants: readonly ReaderContractValue[];
    readonly exclusive?: boolean;
} | {
    readonly kind: "object";
    readonly fields: readonly ReaderContractField[];
    readonly additionalProperties: "forbidden" | "allowed-json";
};
interface ReaderContractField {
    readonly name: string;
    readonly required: boolean;
    readonly value: ReaderContractValue;
}
interface RequestReaderContract<TMode extends ContractInvocationMode, TParams extends ContractPresence, TData extends ContractPresence, TChange extends ContractPresence, TNamespace extends string, TMemberName extends string> {
    readonly invocationMode: TMode;
    readonly namespace: TNamespace;
    readonly memberName: TMemberName;
    readonly params: TParams;
    readonly ok: {
        readonly data: TData;
        readonly change: TChange;
        readonly readerData: ReaderContractValue;
    };
}
interface StreamReaderContract<TMode extends ContractInvocationMode, TParams extends ContractPresence, TData extends ContractPresence, TChange extends ContractPresence, TNamespace extends string, TMemberName extends string> extends RequestReaderContract<TMode, TParams, TData, TChange, TNamespace, TMemberName> {
    readonly progress: ReaderContractValue;
}
interface EventReaderContract<TNamespace extends string, TMemberName extends string> {
    readonly invocationMode: "event-notification";
    readonly namespace: TNamespace;
    readonly memberName: TMemberName;
    readonly payload: ReaderContractValue;
}
interface PublicCapabilityReaderContractMap {
    readonly "context.append": RequestReaderContract<"request-response", "required", "required", "optional", "context", "append">;
    readonly "context.get": RequestReaderContract<"request-response", "required", "required", "optional", "context", "get">;
    readonly "context.query": RequestReaderContract<"request-response", "optional", "required", "optional", "context", "query">;
    readonly "context.factAppended": EventReaderContract<"context", "factAppended">;
    readonly "code.readFile": RequestReaderContract<"request-response", "required", "required", "optional", "code", "readFile">;
    readonly "code.listDirectory": RequestReaderContract<"request-response", "optional", "required", "optional", "code", "listDirectory">;
    readonly "code.mapNodeToSource": RequestReaderContract<"request-response", "required", "required", "optional", "code", "mapNodeToSource">;
    readonly "code.applyFileEdit": RequestReaderContract<"request-response", "required", "optional", "required", "code", "applyFileEdit">;
    readonly "code.createDirectory": RequestReaderContract<"request-response", "required", "required", "optional", "code", "createDirectory">;
    readonly "code.moveFile": RequestReaderContract<"request-response", "required", "required", "required", "code", "moveFile">;
    readonly "code.deleteFile": RequestReaderContract<"request-response", "required", "required", "required", "code", "deleteFile">;
    readonly "code.deleteDirectory": RequestReaderContract<"request-response", "required", "required", "required", "code", "deleteDirectory">;
    readonly "cloud.authorize": RequestReaderContract<"request-response", "optional", "required", "optional", "cloud", "authorize">;
    readonly "cloud.getDeployContext": RequestReaderContract<"request-response", "optional", "required", "optional", "cloud", "getDeployContext">;
    readonly "cloud.deploy": StreamReaderContract<"stream", "optional", "required", "optional", "cloud", "deploy">;
    readonly "content.listSources": RequestReaderContract<"request-response", "optional", "required", "optional", "content", "listSources">;
    readonly "content.listTypes": RequestReaderContract<"request-response", "required", "required", "optional", "content", "listTypes">;
    readonly "content.getType": RequestReaderContract<"request-response", "required", "required", "optional", "content", "getType">;
    readonly "content.queryItems": RequestReaderContract<"request-response", "required", "required", "optional", "content", "queryItems">;
    readonly "content.getItem": RequestReaderContract<"request-response", "required", "required", "optional", "content", "getItem">;
    readonly "content.createItem": RequestReaderContract<"request-response", "required", "required", "optional", "content", "createItem">;
    readonly "content.updateItem": RequestReaderContract<"request-response", "required", "required", "optional", "content", "updateItem">;
    readonly "content.deleteItem": RequestReaderContract<"request-response", "required", "required", "optional", "content", "deleteItem">;
    readonly "selection.set": RequestReaderContract<"request-response", "required", "required", "optional", "selection", "set">;
    readonly "selection.getCurrent": RequestReaderContract<"request-response", "optional", "required", "optional", "selection", "getCurrent">;
    readonly "selection.readPageTree": RequestReaderContract<"request-response", "optional", "required", "optional", "selection", "readPageTree">;
    readonly "selection.selectPageNode": RequestReaderContract<"request-response", "required", "required", "optional", "selection", "selectPageNode">;
    readonly "selection.mutateNode": RequestReaderContract<"request-response", "required", "required", "optional", "selection", "mutateNode">;
    readonly "selection.patchStyle": RequestReaderContract<"request-response", "required", "required", "optional", "selection", "patchStyle">;
    readonly "selection.editText": RequestReaderContract<"request-response", "required", "required", "optional", "selection", "editText">;
    readonly "selection.changed": EventReaderContract<"selection", "changed">;
    readonly "project.getInfo": RequestReaderContract<"request-response", "optional", "required", "optional", "project", "getInfo">;
    readonly "extensionUi.open": RequestReaderContract<"request-response", "required", "required", "optional", "extensionUi", "open">;
    readonly "extensionUi.postMessage": RequestReaderContract<"request-response", "required", "optional", "optional", "extensionUi", "postMessage">;
    readonly "agent.run": StreamReaderContract<"stream", "required", "required", "optional", "agent", "run">;
    readonly "preview.openTarget": RequestReaderContract<"request-response", "optional", "required", "optional", "preview", "openTarget">;
    readonly "preview.reload": RequestReaderContract<"request-response", "optional", "required", "optional", "preview", "reload">;
    readonly "preview.readConsole": StreamReaderContract<"stream", "optional", "required", "optional", "preview", "readConsole">;
    readonly "preview.openArtifact": RequestReaderContract<"request-response", "required", "required", "optional", "preview", "openArtifact">;
    readonly "runtime.getHealth": RequestReaderContract<"request-response", "optional", "required", "optional", "runtime", "getHealth">;
    readonly "runtime.healthChanged": EventReaderContract<"runtime", "healthChanged">;
}
export declare const PUBLIC_NAMED_READER_CONTRACTS: Readonly<Record<string, ReaderContractValue>>;
export declare const PUBLIC_CAPABILITY_READER_CONTRACTS: PublicCapabilityReaderContractMap;
