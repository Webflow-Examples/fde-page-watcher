export type ContentConnectionRequiredResultDataReader = {
    code: "content_connection_required";
    sourceId: string;
    action: "connect";
} & Record<string, unknown>;
export type ContentConnectionRequiredResultReader = {
    status: "blocked";
    reason: string;
    data: ContentConnectionRequiredResultDataReader;
} & Record<string, unknown>;
export declare function isContentConnectionRequiredResult(value: unknown): value is ContentConnectionRequiredResultReader;
