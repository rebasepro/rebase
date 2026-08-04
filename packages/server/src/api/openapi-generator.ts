import { CollectionConfig, Property, StringProperty, NumberProperty, ArrayProperty, MapProperty, isToMany, VectorProperty, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "@rebasepro/types";
import { resolveCollectionRelations } from "@rebasepro/common";

/**
 * OpenAPI 3.0.3 specification generator.
 *
 * Produces a spec that exactly mirrors the REST API consumed by the
 * Rebase SDK client (`@rebasepro/client`).
 *
 * Routes are mounted at `{basePath}/data/{slug}` by `initializeRebaseBackend`.
 */

export interface OpenApiGeneratorOptions {
    /** Base path for the API (e.g. "/api"). Defaults to "/api". */
    basePath?: string;
    /** Whether auth is enabled on data routes. Defaults to true. */
    requireAuth?: boolean;
    /**
     * The list-pagination bounds the REST layer applies, so the spec states the
     * ones a request will actually meet.
     *
     * These were hardcoded as `default: 20, maximum: 100` — neither of which
     * the server has ever used. The spec drives the API Explorer and is what a
     * generated client is built from, so an understated ceiling is a request
     * the client refuses to make, and an overstated one is a 400 nobody
     * predicted.
     */
    listLimits?: { defaultLimit?: number; maxLimit?: number };
}

export function generateOpenApiSpec(
    collections: CollectionConfig[],
    options: OpenApiGeneratorOptions = {}
): Record<string, unknown> {
    const basePath = options.basePath ?? "/api";
    const requireAuth = options.requireAuth ?? true;
    const defaultLimit = options.listLimits?.defaultLimit ?? DEFAULT_LIST_LIMIT;
    const maxLimit = options.listLimits?.maxLimit ?? MAX_LIST_LIMIT;

    /**
     * The query parameters every list endpoint honours.
     *
     * Written once because it was written twice: the root listing named eight
     * and the subcollection listing named four, though both go through the same
     * `parseQueryOptions` and the same fetch. Four capabilities were therefore
     * unreachable from a generated client on nested routes, and `or`/`and` were
     * undocumented on both.
     */
    const listQueryParameters = () => [
        { name: "limit", in: "query", schema: { type: "integer", default: defaultLimit, maximum: maxLimit },
            description: "Maximum number of records to return" },
        { name: "offset", in: "query", schema: { type: "integer", default: 0 },
            description: "Number of records to skip" },
        { name: "page", in: "query", schema: { type: "integer", minimum: 1 },
            description: "Page number (alternative to offset). Calculates offset as (page-1)*limit" },
        {
            name: "orderBy",
            in: "query",
            schema: { type: "string" },
            description: "Sort field and direction. Accepts `field:asc` or `field:desc`, or a JSON array `[{\"field\":\"name\",\"direction\":\"asc\"}]`",
            example: "created_at:desc"
        },
        {
            name: "where",
            in: "query",
            schema: { type: "string" },
            description: "JSON object filter, mapping each field to a `[operator, value]` tuple. "
                + "Combines with the per-field `?field=op.value` parameters below; on the same field, the per-field parameter wins.",
            example: "{\"status\":[\"==\",\"active\"]}"
        },
        {
            name: "or",
            in: "query",
            schema: { type: "string" },
            description: "Disjunction of conditions, AND-ed with `where` and `searchString`.",
            example: "(status.eq.draft,status.eq.review)"
        },
        {
            name: "and",
            in: "query",
            schema: { type: "string" },
            description: "Conjunction of conditions, AND-ed with `where` and `searchString`. Ignored when `or` is also present.",
            example: "(views.gte.10,status.eq.draft)"
        },
        {
            name: "include",
            in: "query",
            schema: { type: "string" },
            description: "Comma-separated list of relations to include (eager-load). Use `*` for all relations.",
            example: "author,tags"
        },
        {
            name: "fields",
            in: "query",
            schema: { type: "string" },
            description: "Comma-separated list of fields to return (field selection)",
            example: "id,name,created_at"
        },
        {
            name: "searchString",
            in: "query",
            schema: { type: "string" },
            description: "Full-text search query"
        }
    ];

    const spec: Record<string, unknown> = {
        openapi: "3.0.3",
        info: {
            title: "Rebase API",
            version: "1.0.0",
            description:
                "Auto-generated REST API from Rebase collection definitions. " +
                "This is the same API consumed by the `@rebasepro/client` SDK."
        },
        servers: [
            {
                url: basePath,
                description: "API Server"
            }
        ],
        paths: {} as Record<string, unknown>,
        components: {
            schemas: {
                ErrorResponse: {
                    type: "object",
                    properties: {
                        error: {
                            type: "object",
                            required: ["message", "code"],
                            properties: {
                                message: { type: "string" },
                                code: { type: "string" },
                                details: {}
                            }
                        }
                    }
                },
                PaginationMeta: {
                    type: "object",
                    properties: {
                        total: { type: "integer",
description: "Total number of matching records" },
                        limit: { type: "integer",
description: "Page size used for this query" },
                        offset: { type: "integer",
description: "Number of records skipped" },
                        hasMore: { type: "boolean",
description: "Whether more records exist beyond this page" }
                    }
                }
            } as Record<string, unknown>,
            securitySchemes: {} as Record<string, unknown>
        },
        tags: [] as Array<{ name: string; description?: string }>
    };

    // ── Security Schemes ─────────────────────────────────────────────────
    if (requireAuth) {
        (spec.components as Record<string, unknown>).securitySchemes = {
            bearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
                description:
                    "JWT access token obtained from `POST /auth/login` or `POST /auth/register`. " +
                    "Can also be a static service key for server-to-server authentication."
            },
            queryToken: {
                type: "apiKey",
                in: "query",
                name: "token",
                description: "Alternative: pass the JWT or service key as a `token` query parameter."
            }
        };
        (spec as Record<string, unknown>).security = [
            { bearerAuth: [] },
            { queryToken: [] }
        ];
    }

    const paths = spec.paths as Record<string, unknown>;
    const schemas = (spec.components as Record<string, unknown>).schemas as Record<string, unknown>;
    const tags = spec.tags as Array<{ name: string; description?: string }>;

    // ── Collection routes ────────────────────────────────────────────────
    for (const collection of (collections || [])) {
        const schemaName = toPascalCase(collection.singularName || collection.name);
        const slug = collection.slug;

        tags.push({
            name: collection.name,
            description: collection.description || `CRUD operations for ${collection.name}`
        });

        // Build component schema for this collection
        schemas[schemaName] = buildCollectionSchema(collection);

        // Build an "input" schema (no read-only/auto fields like autoValue dates)
        schemas[`${schemaName}Input`] = buildCollectionInputSchema(collection);

        const dataPath = `/data/${slug}`;

        // ── GET /data/{slug} — List entities ──────────────────────────
        paths[dataPath] = {
            get: {
                tags: [collection.name],
                summary: `List ${collection.name}`,
                operationId: `list${schemaName}`,
                parameters: [
                    ...listQueryParameters(),
                    ...buildFilterParameters(collection)
                ],
                responses: {
                    200: {
                        description: "Paginated list of entities",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        data: {
                                            type: "array",
                                            items: { $ref: `#/components/schemas/${schemaName}` }
                                        },
                                        meta: { $ref: "#/components/schemas/PaginationMeta" }
                                    }
                                }
                            }
                        }
                    },
                    ...errorResponses(requireAuth)
                }
            },
            post: {
                tags: [collection.name],
                summary: `Create ${collection.singularName || collection.name}`,
                operationId: `create${schemaName}`,
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: `#/components/schemas/${schemaName}Input` }
                        }
                    }
                },
                responses: {
                    201: {
                        description: "Created entity",
                        content: {
                            "application/json": {
                                schema: { $ref: `#/components/schemas/${schemaName}` }
                            }
                        }
                    },
                    ...errorResponses(requireAuth)
                }
            }
        };

        // ── GET/PUT/DELETE /data/{slug}/{id} ──────────────────────────
        const entityPath = `/data/${slug}/{id}`;
        paths[entityPath] = {
            get: {
                tags: [collection.name],
                summary: `Get ${collection.singularName || collection.name} by ID`,
                operationId: `get${schemaName}ById`,
                parameters: [
                    { name: "id",
in: "path",
required: true,
schema: { type: "string" },
description: "Entity ID" },
                    {
                        name: "include",
                        in: "query",
                        schema: { type: "string" },
                        description: "Comma-separated list of relations to include",
                        example: "author,tags"
                    }
                ],
                responses: {
                    200: {
                        description: "Entity found",
                        content: {
                            "application/json": {
                                schema: { $ref: `#/components/schemas/${schemaName}` }
                            }
                        }
                    },
                    404: { description: "Entity not found",
content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
                    ...errorResponses(requireAuth)
                }
            },
            put: {
                tags: [collection.name],
                summary: `Update ${collection.singularName || collection.name}`,
                operationId: `update${schemaName}`,
                parameters: [
                    { name: "id",
in: "path",
required: true,
schema: { type: "string" },
description: "Entity ID" }
                ],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: `#/components/schemas/${schemaName}Input` }
                        }
                    }
                },
                responses: {
                    200: {
                        description: "Updated entity",
                        content: {
                            "application/json": {
                                schema: { $ref: `#/components/schemas/${schemaName}` }
                            }
                        }
                    },
                    404: { description: "Entity not found",
content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
                    ...errorResponses(requireAuth)
                }
            },
            delete: {
                tags: [collection.name],
                summary: `Delete ${collection.singularName || collection.name}`,
                operationId: `delete${schemaName}`,
                parameters: [
                    { name: "id",
in: "path",
required: true,
schema: { type: "string" },
description: "Entity ID" }
                ],
                responses: {
                    204: { description: "Deleted successfully" },
                    404: { description: "Entity not found",
content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
                    ...errorResponses(requireAuth)
                }
            }
        };

    }

    // ── Subcollection routes ─────────────────────────────────────────────
    //
    // A second pass, after every collection's component schema exists. These
    // routes `$ref` the *target's* schema, and the first pass builds schemas in
    // array order — so doing this inline meant a subcollection whose target
    // appeared later in the list silently degraded to an untyped `object`.
    //
    // The names come from the *resolved* relations, not from the authored
    // `relations` array. `relationName` is optional at the authoring surface —
    // it defaults to the property key, or to the target's slug — so reading the
    // raw field skipped every relation that relied on the default, and missed
    // relations declared inline on a property entirely, since those are not in
    // the array. These are the same resolved names the nested-path router
    // matches, so the spec and the routes cannot drift apart.
    //
    // A to-one relation is left out. `posts/1/author` resolves, but it
    // addresses a single row, and documenting it as a paginated list would
    // describe a response shape the client never gets.
    for (const collection of (collections || [])) {
        const slug = collection.slug;
        const schemaName = toPascalCase(collection.singularName || collection.name);
        const relations = Object.values(resolveCollectionRelations(collection))
            .filter(isToMany);
        for (const relation of relations) {
            const relationName = relation.relationName;
            const targetCollection = relation.target();
            const targetName = targetCollection.singularName || targetCollection.name;
            const targetSchema = toPascalCase(targetName);

            const subPath = `/data/${slug}/{parentId}/${relationName}`;

            // Only add if the schema exists (target collection is also registered)
            paths[subPath] = {
                get: {
                    tags: [collection.name],
                    summary: `List ${relationName} for ${withIndefiniteArticle(collection.singularName || collection.name)}`,
                    operationId: `list${schemaName}${toPascalCase(relationName)}`,
                    parameters: [
                        { name: "parentId",
in: "path",
required: true,
schema: { type: "string" },
description: `${collection.singularName || collection.name} ID` },
                        // The nested list handler goes through the same
                        // `parseQueryOptions` and the same fetch as the root
                        // one, so it honours the same parameters. It documented
                        // four of them.
                        ...listQueryParameters()
                    ],
                    responses: {
                        200: {
                            description: `List of related ${relationName}`,
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            data: {
                                                type: "array",
                                                items: schemas[targetSchema]
                                                    ? { $ref: `#/components/schemas/${targetSchema}` }
                                                    : { type: "object" }
                                            },
                                            meta: { $ref: "#/components/schemas/PaginationMeta" }
                                        }
                                    }
                                }
                            }
                        },
                        ...errorResponses(requireAuth)
                    }
                }
            };
        }
    }

    return spec;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build the component schema for a collection (output / read shape).
 * All fields are included (including relation foreign keys).
 */
function buildCollectionSchema(collection: CollectionConfig): Record<string, unknown> {
    const properties: Record<string, unknown> = {
        id: { type: "string",
description: "Unique identifier" }
    };
    const required: string[] = ["id"];

    for (const [key, property] of Object.entries(collection.properties)) {
        // Skip relation properties — they are virtual and not part of the REST payload
        if (property.type === "relation") continue;

        properties[key] = convertPropertyToSchema(property);

        if (property.validation?.required) {
            required.push(key);
        }
    }

    return {
        type: "object",
        required: required.length > 0 ? required : undefined,
        properties
    };
}

/**
 * Build an input schema (for POST/PUT) — excludes auto-generated fields.
 */
function buildCollectionInputSchema(collection: CollectionConfig): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, property] of Object.entries(collection.properties)) {
        if (property.type === "relation") continue;

        // Skip auto-value date fields from the input schema
        if (property.type === "date" && property.autoValue) continue;

        // Skip auto-generated ID fields
        if ("isId" in property && property.isId && property.isId !== "manual" && property.isId !== true) continue;

        properties[key] = convertPropertyToSchema(property);

        if (property.validation?.required) {
            required.push(key);
        }
    }

    // Allow explicit ID for create (optional)
    properties["id"] = {
        type: "string",
        description: "Optional: client-assigned ID. If omitted, the server generates one."
    };

    return {
        type: "object",
        required: required.length > 0 ? required : undefined,
        properties
    };
}

/**
 * Convert a Rebase Property to an OpenAPI 3.0 schema object.
 */
function convertPropertyToSchema(property: Property): Record<string, unknown> {
    const base: Record<string, unknown> = {};

    if (property.name) {
        base.description = property.name;
    }

    switch (property.type) {
        case "string": {
            const sp = property as StringProperty;
            base.type = "string";

            if (sp.enum) {
                const enumValues = resolveEnumValues(sp.enum);
                if (enumValues.length > 0) {
                    base.enum = enumValues;
                }
            }

            if (sp.validation) {
                if (sp.validation.min !== undefined) base.minLength = sp.validation.min;
                if (sp.validation.max !== undefined) base.maxLength = sp.validation.max;
                if (sp.validation.length !== undefined) {
                    base.minLength = sp.validation.length;
                    base.maxLength = sp.validation.length;
                }
                if (sp.validation.matches !== undefined) {
                    base.pattern = String(sp.validation.matches);
                }
            }

            if (sp.email) base.format = "email";
            if (sp.url) base.format = "uri";
            if (sp.storage) base.format = "uri";

            return base;
        }

        case "number": {
            const np = property as NumberProperty;
            const isInteger = np.validation?.integer || np.columnType === "integer" || np.columnType === "serial" || np.columnType === "bigserial" || np.columnType === "bigint";
            base.type = isInteger ? "integer" : "number";

            if (np.enum) {
                const enumValues = resolveEnumValues(np.enum);
                if (enumValues.length > 0) {
                    base.enum = enumValues;
                }
            }

            if (np.validation) {
                if (np.validation.min !== undefined) base.minimum = np.validation.min;
                if (np.validation.max !== undefined) base.maximum = np.validation.max;
                if (np.validation.moreThan !== undefined) {
                    base.minimum = np.validation.moreThan;
                    base.exclusiveMinimum = true;
                }
                if (np.validation.lessThan !== undefined) {
                    base.maximum = np.validation.lessThan;
                    base.exclusiveMaximum = true;
                }
            }

            return base;
        }

        case "boolean":
            base.type = "boolean";
            return base;

        case "date": {
            base.type = "string";
            if (property.mode === "date") {
                base.format = "date";
            } else {
                base.format = "date-time";
            }
            if (property.autoValue) {
                base.readOnly = true;
                base.description = (base.description || "") +
                    (property.autoValue === "on_create" ? " (Auto-set on creation)" : " (Auto-updated)");
            }
            return base;
        }

        case "geopoint":
            base.type = "object";
            base.properties = {
                latitude: { type: "number" },
                longitude: { type: "number" }
            };
            base.required = ["latitude", "longitude"];
            return base;

        case "reference":
            base.type = "string";
            base.description = (base.description || "") + " (Reference ID)";
            return base;

        case "array": {
            const ap = property as ArrayProperty;
            base.type = "array";

            if (ap.oneOf) {
                // Discriminated union (e.g., content blocks)
                const typeField = ap.oneOf.typeField || "type";
                const valueField = ap.oneOf.valueField || "value";
                const variants: Record<string, unknown>[] = [];

                for (const [variantKey, variantProp] of Object.entries(ap.oneOf.properties)) {
                    variants.push({
                        type: "object",
                        properties: {
                            [typeField]: { type: "string",
enum: [variantKey] },
                            [valueField]: convertPropertyToSchema(variantProp)
                        },
                        required: [typeField, valueField]
                    });
                }

                base.items = { oneOf: variants };
            } else if (ap.of) {
                if (Array.isArray(ap.of)) {
                    base.items = { oneOf: ap.of.map(p => convertPropertyToSchema(p)) };
                } else {
                    base.items = convertPropertyToSchema(ap.of);
                }
            } else {
                base.items = {};
            }

            if (ap.validation) {
                if (ap.validation.min !== undefined) base.minItems = ap.validation.min;
                if (ap.validation.max !== undefined) base.maxItems = ap.validation.max;
            }

            return base;
        }

        case "map": {
            const mp = property as MapProperty;
            base.type = "object";

            if (mp.properties) {
                const props: Record<string, unknown> = {};
                const req: string[] = [];

                for (const [key, subProp] of Object.entries(mp.properties)) {
                    props[key] = convertPropertyToSchema(subProp);
                    if (subProp.validation?.required) {
                        req.push(key);
                    }
                }

                base.properties = props;
                if (req.length > 0) base.required = req;
            } else if (mp.keyValue) {
                base.additionalProperties = true;
            }

            return base;
        }

        case "vector": {
            const vp = property as VectorProperty;
            base.type = "array";
            base.items = { type: "number" };
            base.description = (base.description || "") + ` (Vector(${vp.dimensions}))`;
            return base;
        }
        case "binary": {
            base.type = "string";
            base.description = (base.description || "") + " (Binary/Base64)";
            return base;
        }
        default:
            base.type = "string";
            return base;
    }
}

/**
 * Resolve EnumValues (array or record) into a flat array of enum values.
 */
function resolveEnumValues(enumDef: Record<string | number, unknown> | Array<{ id: string | number }>): Array<string | number> {
    if (Array.isArray(enumDef)) {
        return enumDef.map(e => (typeof e === "object" && e !== null && "id" in e) ? e.id : e as string | number);
    }
    return Object.keys(enumDef).map(k => {
        // Preserve numeric keys as numbers
        const num = Number(k);
        return isNaN(num) ? k : num;
    });
}

/**
 * Build PostgREST-style filter parameters for a collection.
 * These are additional query parameters like `?status=eq.active&price=gte.100`.
 */
function buildFilterParameters(collection: CollectionConfig): Array<Record<string, unknown>> {
    const params: Array<Record<string, unknown>> = [];

    for (const [key, property] of Object.entries(collection.properties)) {
        if (property.type === "relation" || property.type === "map" || property.type === "array" || property.type === "geopoint") {
            continue;
        }

        params.push({
            name: key,
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
                `Filter by \`${key}\`. Supports PostgREST operators: ` +
                "`eq.value`, `neq.value`, `gt.value`, `gte.value`, `lt.value`, `lte.value`, " +
                "`in.(a,b,c)`, `nin.(a,b,c)`, `cs.value` (array-contains), `csa.(a,b)` (array-contains-any). " +
                "Plain values imply equality.",
            example: property.type === "string" ? "eq.active" : property.type === "number" ? "gte.100" : undefined
        });
    }

    return params;
}

/**
 * Standard error responses included on every endpoint.
 */
function errorResponses(requireAuth: boolean): Record<string, unknown> {
    const responses: Record<string, unknown> = {
        400: {
            description: "Bad request",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
        },
        500: {
            description: "Internal server error",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
        }
    };

    if (requireAuth) {
        responses[401] = {
            description: "Authentication required or invalid token",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
        };
        responses[403] = {
            description: "Insufficient permissions",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
        };
    }

    return responses;
}

/**
 * Prefix a noun with "a" or "an" based on its leading sound.
 */
function withIndefiniteArticle(noun: string): string {
    return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

/**
 * Convert a string to PascalCase for schema names.
 */
function toPascalCase(str: string): string {
    return str
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .split(" ")
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join("");
}
