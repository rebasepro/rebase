/**
 * The OpenAPI document `generateOpenApiSpec` returns, as the tests read it.
 *
 * The generator builds its document as `Record<string, unknown>` and returns
 * it as one, so a test that drills into `paths` or `components.schemas` needs
 * the shape spelled out somewhere. It is spelled out here, and every document
 * is checked against it at runtime before a test reads it — a generator that
 * stopped producing `paths` fails here, naming what is missing, instead of in
 * a `Cannot read properties of undefined` three accessors deep.
 */

/** A JSON Schema, as the generator writes one: every keyword optional. */
export interface JsonSchema {
    type?: string | string[];
    format?: string;
    description?: string;
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    required?: string[];
    enum?: unknown[];
    $ref?: string;
    oneOf?: JsonSchema[];
    anyOf?: JsonSchema[];
    allOf?: JsonSchema[];
    readOnly?: boolean;
    writeOnly?: boolean;
    nullable?: boolean;
    pattern?: string;
    minimum?: number;
    maximum?: number;
    default?: unknown;
    additionalProperties?: boolean | JsonSchema;
    [keyword: string]: unknown;
}

export interface OpenApiParameter {
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: JsonSchema;
    [key: string]: unknown;
}

export interface OpenApiMediaType {
    schema?: JsonSchema;
    [key: string]: unknown;
}

export interface OpenApiResponse {
    description?: string;
    content?: Record<string, OpenApiMediaType>;
    [key: string]: unknown;
}

export interface OpenApiOperation {
    operationId?: string;
    summary?: string;
    description?: string;
    tags?: string[];
    parameters?: OpenApiParameter[];
    requestBody?: { required?: boolean; content: Record<string, OpenApiMediaType>; [key: string]: unknown };
    responses: Record<string, OpenApiResponse>;
    [key: string]: unknown;
}

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export type OpenApiPathItem = Partial<Record<HttpMethod, OpenApiOperation>> & {
    parameters?: OpenApiParameter[];
};

export interface OpenApiDocument {
    openapi: string;
    paths: Record<string, OpenApiPathItem>;
    components: { schemas: Record<string, JsonSchema>; [key: string]: unknown };
    [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` has the document's skeleton: a version, `paths`, `components.schemas`. */
export function isOpenApiDocument(value: unknown): value is OpenApiDocument {
    return isRecord(value)
        && typeof value.openapi === "string"
        && isRecord(value.paths)
        && isRecord(value.components)
        && isRecord(value.components.schemas);
}

/** The document, checked; throws naming the generator's output when it is not one. */
export function openApiDocument(value: unknown): OpenApiDocument {
    if (!isOpenApiDocument(value)) {
        throw new Error(`Not an OpenAPI document: ${JSON.stringify(value)?.slice(0, 200)}`);
    }
    return value;
}

/** The operation at `path` / `method`; throws when the document has none. */
export function operationOf(doc: OpenApiDocument, path: string, method: HttpMethod): OpenApiOperation {
    const operation = doc.paths[path]?.[method];
    if (!operation) throw new Error(`The document has no ${method.toUpperCase()} ${path}`);
    return operation;
}

/** A component schema by name; throws when the document has none. */
export function schemaOf(doc: OpenApiDocument, name: string): JsonSchema {
    const schema = doc.components.schemas[name];
    if (!schema) throw new Error(`The document has no schema ${name}`);
    return schema;
}
