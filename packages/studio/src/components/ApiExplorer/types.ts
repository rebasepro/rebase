/** Minimal OpenAPI 3.x types we care about */
export interface OpenApiSpec {
    openapi: string;
    info: { title: string; version: string; description?: string };
    servers?: { url: string; description?: string }[];
    paths: Record<string, Record<string, OpenApiOperation>>;
    components?: {
        schemas?: Record<string, OpenApiSchema>;
        securitySchemes?: Record<string, unknown>;
    };
    tags?: { name: string; description?: string }[];
    security?: Record<string, string[]>[];
}

export interface OpenApiOperation {
    operationId?: string;
    summary?: string;
    description?: string;
    tags?: string[];
    parameters?: OpenApiParameter[];
    requestBody?: {
        required?: boolean;
        content?: Record<string, { schema?: OpenApiSchema }>;
    };
    responses?: Record<
        string,
        {
            description?: string;
            content?: Record<string, { schema?: OpenApiSchema }>;
        }
    >;
    security?: Record<string, string[]>[];
}

export interface OpenApiParameter {
    name: string;
    in: "query" | "path" | "header" | "cookie";
    description?: string;
    required?: boolean;
    schema?: OpenApiSchema;
}

export interface OpenApiSchema {
    type?: string;
    format?: string;
    description?: string;
    properties?: Record<string, OpenApiSchema>;
    required?: string[];
    items?: OpenApiSchema;
    enum?: (string | number)[];
    oneOf?: OpenApiSchema[];
    anyOf?: OpenApiSchema[];
    allOf?: OpenApiSchema[];
    $ref?: string;
    readOnly?: boolean;
    minimum?: number;
    maximum?: number;
    maxLength?: number;
    minLength?: number;
    default?: unknown;
    example?: unknown;
    additionalProperties?: boolean | OpenApiSchema;
}

export interface ParsedEndpoint {
    id: string;
    method: string;
    path: string;
    shortPath: string;
    summary: string;
    description: string;
    tags: string[];
    parameters: OpenApiParameter[];
    requestBody?: OpenApiOperation["requestBody"];
    responses: NonNullable<OpenApiOperation["responses"]>;
    security?: OpenApiOperation["security"];
    operationId?: string;
}

export interface EndpointGroup {
    tag: string;
    description?: string;
    endpoints: ParsedEndpoint[];
}
