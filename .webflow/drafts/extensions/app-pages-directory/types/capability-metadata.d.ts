import { PUBLIC_CAPABILITY_READER_CONTRACTS } from "./generated-capability-readers";
type ReaderContractMap = typeof PUBLIC_CAPABILITY_READER_CONTRACTS;
type PublicMetadataFor<TMethod extends keyof ReaderContractMap> = ReaderContractMap[TMethod] extends {
    readonly invocationMode: "event-notification";
    readonly namespace: infer TNamespace extends string;
    readonly memberName: infer TMemberName extends string;
} ? {
    readonly method: TMethod;
    readonly invocationMode: "event-notification";
    readonly namespace: TNamespace;
    readonly memberName: TMemberName;
    readonly readPayload: (value: unknown) => boolean;
} : ReaderContractMap[TMethod] extends {
    readonly invocationMode: infer TInvocationMode extends "request-response" | "stream";
    readonly params: infer TParams extends "required" | "optional";
    readonly namespace: infer TNamespace extends string;
    readonly memberName: infer TMemberName extends string;
    readonly ok: {
        readonly data: infer TData extends "required" | "optional";
        readonly change: infer TChange extends "required" | "optional";
    };
} ? {
    readonly method: TMethod;
    readonly invocationMode: TInvocationMode;
    readonly namespace: TNamespace;
    readonly memberName: TMemberName;
    readonly params: TParams;
    readonly ok: {
        readonly data: TData;
        readonly change: TChange;
        readonly readData: (value: unknown) => boolean;
    };
} & (TInvocationMode extends "stream" ? {
    readonly readProgress: (value: unknown) => boolean;
} : Readonly<Record<never, never>>) : never;
export type PublicCapabilityMetadataMap = {
    readonly [TMethod in keyof ReaderContractMap]: PublicMetadataFor<TMethod>;
};
export type PublicCapabilityMethod = keyof PublicCapabilityMetadataMap;
export type PublicCapabilityMetadata = PublicCapabilityMetadataMap[PublicCapabilityMethod];
export declare const PUBLIC_CAPABILITY_METADATA: PublicCapabilityMetadataMap;
