import type { ContentItemRef, ContextRef } from "./generated-capability-types";
export declare const CONTENT_ITEM_CONTEXT_REF_TYPE = "content-item";
export declare const CONTENT_ITEM_CONTEXT_REF_CODEC_VERSION = "v1";
export declare const CONTENT_ITEM_CONTEXT_REF_MAX_ID_LENGTH = 6200;
export declare const CONTENT_ITEM_REF_IDENTIFIER_MAX_LENGTH = 256;
export declare function encodeContentItemContextRef(ref: ContentItemRef): ContextRef;
export declare function decodeContentItemContextRef(value: unknown): ContentItemRef | undefined;
