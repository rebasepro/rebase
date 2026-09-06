import { CollectionConfig, Property, StringProperty, NumberProperty, ArrayProperty, MapProperty, isToMany, ResolvedRelation, VectorProperty, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "@rebasepro/types";
import { fieldKeyForColumn, findRelation, isRelationRequired, resolveCollectionRelations } from "@rebasepro/common";

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
        { name: "limit", in: "query", schema: { type: "integer", default: defaultLimit, minimum: 1, maximum: maxLimit },
            description: `Maximum number of records to return. Must be a whole number between 1 and ${maxLimit}; a larger one is rejected with 400 INVALID_LIMIT rather than trimmed, so a short page always means a short collection. Page past the ceiling with \`offset\`.` },
        { name: "offset", in: "query", schema: { type: "integer", default: 0 },
            description: "Number of records to skip" },
        { name: "page", in: "query", schema: { type: "integer", minimum: 1 },
            description: "Page number (alternative to offset). Calculates offset as (page-1)*limit" },
        {
            name: "orderBy",
            in: "query",
            schema: { type: "string" },
            description: "Sort field and direction. Accepts `field:asc` or `field:desc`, or a JSON array `[{\"field\":\"name\",\"direction\":\"asc\"}]` — several entries sort by each in turn, the second breaking ties on the first.",
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
            description:
                "Text search. By default a case-insensitive substring match OR-ed across the " +
                "collection's top-level string properties. A collection declaring a `search` block " +
                "gets ranked full-text matching over the fields it names, and rows carry a `_score`."
        },
        // Vector search has been served here since vectors landed and was
        // documented nowhere, so the only way to find it was to read the query
        // parser. All four are needed together; `vector_search` and `vector`
        // are ignored unless both are present.
        {
            name: "vector_search",
            in: "query",
            schema: { type: "string" },
            description: "Name of the `vector` property to run a nearest-neighbour search against. Requires `vector`.",
            example: "embedding"
        },
        {
            name: "vector",
            in: "query",
            schema: { type: "string" },
            description: "The query embedding, as a JSON array of numbers. Its length must match the property's declared `dimensions`.",
            example: "[0.12,-0.04,0.98]"
        },
        {
            name: "vector_distance",
            in: "query",
            schema: { type: "string", enum: ["cosine", "l2", "inner_product"], default: "cosine" },
            description: "Distance function used for ordering."
        },
        {
            name: "vector_threshold",
            in: "query",
            schema: { type: "number" },
            description: "Drop rows farther than this distance. Rows are returned closest-first with a `_distance` field."
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
            }
            // No `?token=` scheme. It was declared here — globally, so on every
            // operation — and no data route has ever accepted one: both
            // `createAuthMiddleware` and `createAdapterAuthMiddleware` read the
            // `Authorization` header and nothing else, deliberately, because
            // URLs leak into access logs, proxies, Referer headers and browser
            // history (`auth/middleware.ts`). Following it cost a caller twice:
            // unauthenticated, *and* a 400, since `token` is not in the query
            // parser's `reservedQueryKeys` and so compiles as a filter on a
            // column named `token`. `queryTokenAuth` is real but is mounted
            // only on storage file serving, for `<img src>`; if those routes
            // are ever documented, the scheme belongs on them, per-operation.
        };
        (spec as Record<string, unknown>).security = [
            { bearerAuth: [] }
        ];
    }

    const paths = spec.paths as Record<string, unknown>;
    const schemas = (spec.components as Record<string, unknown>).schemas as Record<string, unknown>;
    const tags = spec.tags as Array<{ name: string; description?: string }>;

    // The names a listing has already spent. A collection is free to have a
    // `limit` or a `fields` column, and the query parser reads those names as
    // pagination and field selection before any filter is compiled — so the
    // per-field filter could never fire, and documenting it a second time put
    // two parameters with the same (`name`, `in`) pair on one operation, which
    // is invalid OpenAPI: Swagger UI renders a duplicate and several generators
    // abort. Taken from the parameter list itself so the two cannot drift.
    const reservedParameterNames = new Set(listQueryParameters().map(p => p.name));

    // Every component name this document will carry, known before the first
    // schema is built: a relation may point at a collection that appears later
    // in the list, or at one that is not documented here at all, and a `$ref`
    // at a component that does not exist is a document Swagger UI renders empty
    // and a strict generator refuses.
    const registeredSchemas = new Set((collections || []).map(schemaNameFor));

    // ── Collection routes ────────────────────────────────────────────────
    for (const collection of (collections || [])) {
        const schemaName = schemaNameFor(collection);
        const slug = collection.slug;

        tags.push({
            name: collection.name,
            description: collection.description || `CRUD operations for ${collection.name}`
        });

        // Build component schema for this collection
        schemas[schemaName] = buildCollectionSchema(collection, registeredSchemas);

        // Build an "input" schema (no read-only/auto fields like autoValue dates)
        schemas[`${schemaName}Input`] = buildCollectionInputSchema(collection);

        // The update body — same columns, no `required`. PATCH and PUT both
        // merge, so a field left out means "unchanged", not "omitted by mistake".
        schemas[`${schemaName}Update`] = buildCollectionUpdateSchema(collection);

        const dataPath = `/data/${slug}`;

        // ── GET /data/{slug}/count — How many rows match ──────────────
        //
        // Served for every collection since the route existed and described
        // here for the first time. A spec is what a generated client can see,
        // so an endpoint missing from it is an endpoint that client does not
        // have — and this is the one a paginating UI needs to know how many
        // pages there are.
        //
        // Registered before the list path so its literal segment cannot be read
        // as an `{id}`, which is the same ordering the router uses.
        paths[`${dataPath}/count`] = {
            get: {
                tags: [collection.name],
                summary: `Count ${collection.name}`,
                description:
                    "The number of rows the same filters would return, without returning them. " +
                    "Takes the filter and search parameters of the list endpoint; `limit`, `offset` " +
                    "and `orderBy` are not part of the question and are ignored.",
                operationId: `count${schemaName}`,
                parameters: [
                    ...listQueryParameters().filter(p => p.name === "searchString"),
                    ...buildFilterParameters(collection, reservedParameterNames)
                ],
                responses: {
                    200: {
                        description: "The number of matching rows",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["count"],
                                    properties: {
                                        count: { type: "integer", description: "Rows matching the filters" }
                                    }
                                }
                            }
                        }
                    },
                    ...errorResponses(requireAuth)
                }
            }
        };

        // ── GET /data/{slug}/aggregate — count/sum/avg/min/max ────────
        //
        // Before the list path for the same reason `/count` is: a literal
        // segment that a generated client would otherwise be told is an `{id}`.
        paths[`${dataPath}/aggregate`] = {
            get: {
                tags: [collection.name],
                summary: `Aggregate ${collection.name}`,
                description:
                    "Aggregate values over the rows the same filters would return. Takes the filter and " +
                    "search parameters of the list endpoint. Row-level security applies to the rows " +
                    "being aggregated, so a caller who can read nothing counts nothing.",
                operationId: `aggregate${schemaName}`,
                parameters: [
                    {
                        name: "select",
                        in: "query",
                        required: true,
                        description:
                            "Comma-separated aggregates, e.g. `count()`, `sum(total)`, `avg(total),max(total)`. " +
                            "Results are keyed `count`, `sum_total`, `avg_total` and so on.",
                        schema: { type: "string" },
                        example: "count(),sum(total)"
                    },
                    {
                        name: "groupBy",
                        in: "query",
                        required: false,
                        description: "Comma-separated fields to group by. Each grouped field is returned alongside the aggregates.",
                        schema: { type: "string" },
                        example: "status"
                    },
                    ...listQueryParameters().filter(p => p.name === "searchString" || p.name === "limit"),
                    ...buildFilterParameters(collection, reservedParameterNames)
                ],
                responses: {
                    200: {
                        description: "One row per group, or a single row when `groupBy` is absent",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["data"],
                                    properties: {
                                        data: {
                                            type: "array",
                                            items: { type: "object", additionalProperties: true }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    501: { description: "This backend's data driver does not implement aggregates" },
                    ...errorResponses(requireAuth)
                }
            }
        };

        // ── GET /data/{slug} — List entities ──────────────────────────
        paths[dataPath] = {
            get: {
                tags: [collection.name],
                summary: `List ${collection.name}`,
                operationId: `list${schemaName}`,
                parameters: [
                    ...listQueryParameters(),
                    ...buildFilterParameters(collection, reservedParameterNames)
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

        // ── Bulk: one transaction, all-or-nothing ─────────────────────
        //
        // These went undocumented while they existed, which is the same defect
        // the update verb had: an endpoint the server serves and the spec does
        // not mention cannot be reached by a generated client at all.
        const idempotencyHeader = {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { type: "string" },
            description:
                "Names this write so a retry is recognised instead of repeated. Without it a " +
                "client that lost the response cannot distinguish a replay from a second " +
                "genuine batch, and the whole batch is written twice. A key names one request: " +
                "re-send the identical request to replay its answer, and use a new key for a " +
                "different one."
        };

        const bulkErrors = {
            400: {
                description: "Malformed body, an unknown field, or more rows than the per-batch limit",
                content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
            },
            409: {
                description:
                    "A request with the same Idempotency-Key is still in flight. Retry it: the " +
                    "first attempt's result is replayed once it lands",
                content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
            },
            422: {
                description: "The Idempotency-Key was already used for a different request",
                content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
            },
            ...errorResponses(requireAuth)
        };

        paths[`/data/${slug}/bulk`] = {
            post: {
                tags: [collection.name],
                summary: `Create many ${collection.name} in one transaction`,
                description:
                    "All-or-nothing: if any row is rejected none of them land, and the error names " +
                    "the offending index. Every row still runs callbacks, relations and row-level " +
                    "security. Capped server-side because one batch holds its locks for its whole " +
                    "duration.",
                operationId: `createMany${schemaName}`,
                parameters: [idempotencyHeader],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["rows"],
                                properties: {
                                    rows: { type: "array", items: { $ref: `#/components/schemas/${schemaName}Input` } },
                                    upsert: {
                                        type: "boolean",
                                        description: "Write each row as INSERT ... ON CONFLICT DO UPDATE on the primary key."
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        description: "The written rows, in the order given",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        data: { type: "array", items: { $ref: `#/components/schemas/${schemaName}` } },
                                        meta: { type: "object", properties: { written: { type: "integer" } } }
                                    }
                                }
                            }
                        }
                    },
                    ...bulkErrors
                }
            },
            patch: {
                tags: [collection.name],
                summary: `Update many ${collection.name} in one transaction`,
                description:
                    "Each entry names its row and the fields to change. `{ id, data }` rather than " +
                    "flat rows carrying their own key, because on a table keyed on something other " +
                    "than `id` a flat row cannot say whether a column is the address or a value to " +
                    "write. An id matching no row fails the batch.",
                operationId: `updateMany${schemaName}`,
                parameters: [idempotencyHeader],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["updates"],
                                properties: {
                                    updates: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            required: ["id", "data"],
                                            properties: {
                                                id: { type: "string", description: "The row to update" },
                                                data: { $ref: `#/components/schemas/${schemaName}Update` }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        description: "The updated rows, in the order given",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        data: { type: "array", items: { $ref: `#/components/schemas/${schemaName}` } },
                                        meta: { type: "object", properties: { written: { type: "integer" } } }
                                    }
                                }
                            }
                        }
                    },
                    404: {
                        description: "One of the ids matches no row; nothing was written",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
                    },
                    ...bulkErrors
                }
            }
        };

        paths[`/data/${slug}/bulk/delete`] = {
            post: {
                tags: [collection.name],
                summary: `Delete many ${collection.name} in one transaction`,
                description:
                    "A POST, not `DELETE /bulk` with a body. Bodies on DELETE are permitted but " +
                    "widely dropped by proxies and CDNs, and several generators ignore " +
                    "`requestBody` on a DELETE operation — a generated client would send the " +
                    "request with no ids at all. Takes ids rather than a filter: a mistyped " +
                    "condition that empties a table cannot be reviewed at the call site the way " +
                    "an explicit list can. `beforeDelete`/`afterDelete` fire per row.",
                operationId: `deleteMany${schemaName}`,
                parameters: [idempotencyHeader],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["ids"],
                                properties: {
                                    ids: {
                                        type: "array",
                                        items: { oneOf: [{ type: "string" }, { type: "integer" }] }
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        description: "How many rows were deleted",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        meta: { type: "object", properties: { deleted: { type: "integer" } } }
                                    }
                                }
                            }
                        }
                    },
                    404: {
                        description: "One of the ids matches no row; nothing was deleted",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
                    },
                    ...bulkErrors
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
            patch: updateOperation(collection, schemaName, requireAuth),
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
        const schemaName = schemaNameFor(collection);
        const relations = Object.values(resolveCollectionRelations(collection))
            .filter(isToMany);
        for (const relation of relations) {
            const relationName = relation.relationName;
            const targetCollection = relation.target();
            const targetSchema = schemaNameFor(targetCollection);

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
 * Is this property part of the shape the document may describe?
 *
 * One exclusion, and it is the document telling the truth about what the server
 * does: `excludeFromApi` is a server-side guarantee that the column "is
 * stripped from every row the API serves, for every caller, including admins
 * and service keys" — `stripExcluded` in the row pipeline enforces it. A schema
 * that lists such a column describes a field that is never present, and it
 * describes it to everyone: `/docs` is mounted on the app, not on the data
 * router, so it carries none of the auth middleware `{basePath}/data` does.
 * Every project scaffolded by `rebase init` published its `users` collection's
 * `passwordHash` and `emailVerificationToken` this way.
 *
 * A `relation` property used to be excluded here too, on the reasoning that the
 * property is virtual. It is — but the row is not empty where it stands: the
 * owning side carries a foreign key under a *wire* name (`authorId`), and a
 * read that includes the relation carries the target's row under the relation's
 * own name. Excluding both left `/api/docs` describing a strictly smaller
 * collection than `generated/sdk/database.types.ts` did for the same config.
 * Relations are now emitted by {@link emitRelationProperties}, under the same
 * keys and in the same order as the SDK's `Row`; the direct-property loops skip
 * them so the two passes cannot emit one key twice.
 *
 * Written as one predicate rather than a `continue` per loop because it kept
 * being fixed in one loop at a time: this is the same rule the SDK generator
 * applies to its `Row` type (`packages/codegen/src/generate-types.ts`).
 */
function isDocumentedProperty(property: Property): boolean {
    return !property.excludeFromApi;
}

/**
 * The keys `stripExcluded` deletes: the property name *and* its column name.
 *
 * Seeding the emitted set with both is what stops a foreign key derived from a
 * relation putting an `excludeFromApi` column back on the surface under its
 * other name. Same pair, same reason, as `excludedApiKeys` in the SDK
 * generator.
 */
function excludedApiKeys(collection: CollectionConfig): Set<string> {
    const excluded = new Set<string>();
    for (const [key, property] of Object.entries(collection.properties ?? {})) {
        if (!(property as Property)?.excludeFromApi) continue;
        excluded.add(key);
        const columnName = (property as { columnName?: unknown }).columnName;
        if (typeof columnName === "string") excluded.add(columnName);
    }
    return excluded;
}

/**
 * The collection's primary key, as the key it is addressed by on the wire and
 * the property that declares it.
 *
 * `id` was a literal in three places — seeded before the read loop, assigned
 * after the input loop, inherited by the update schema from the input one — and
 * the two spellings disagreed: a declared `id: { type: "number" }` overwrote
 * the read seed and was overwritten by the input assignment, so the same field
 * was `integer` in `Post` and `string` in `PostInput`. One helper now answers
 * the question for all three.
 */
function idPropertyEntry(collection: CollectionConfig | undefined): [string, Property] | undefined {
    for (const [key, property] of Object.entries(collection?.properties ?? {})) {
        if ((property as unknown as Record<string, unknown>)?.isId) return [key, property as Property];
    }
    return undefined;
}

/**
 * The schema of a primary key or of a foreign key pointing at one: the declared
 * property's own type, stripped of the field-level facts (description,
 * validation bounds) that belong to the column and not to a reference to it.
 *
 * Falls back to `string` for a collection that declares no primary key, which
 * is what every schema here assumed unconditionally before.
 */
function idSchemaFor(collection: CollectionConfig | undefined): Record<string, unknown> {
    const declared = idPropertyEntry(collection);
    if (!declared) return { type: "string" };
    const converted = convertPropertyToSchema(declared[1]);
    const schema: Record<string, unknown> = { type: converted.type ?? "string" };
    if (converted.format) schema.format = converted.format;
    return schema;
}

/**
 * Relations resolve or they do not; a document is still owed for a collection
 * whose target thunk throws (a circular import, usually). The SDK generator
 * warns and carries on with no relation fields, and so does this — the
 * alternative is `/api/docs` 500ing for the whole project.
 */
function resolveRelationsForDocument(collection: CollectionConfig): Record<string, ResolvedRelation> {
    try {
        return resolveCollectionRelations(collection);
    } catch {
        return {};
    }
}

/** Unwrap a target handed back as a module namespace — `() => import("./authors")`. */
function relationTarget(relation: ResolvedRelation): CollectionConfig | undefined {
    try {
        let target = relation.target() as CollectionConfig & { default?: CollectionConfig; __esModule?: boolean };
        if (target && (target.default || target.__esModule)) {
            target = (target.default ?? target) as typeof target;
        }
        return target;
    } catch {
        return undefined;
    }
}

/**
 * The schema an *included* relation arrives as: the target's own row.
 *
 * `$ref` when the target is one of the collections this document describes, and
 * an open object when it is not — a dangling pointer makes Swagger UI render an
 * empty model and makes a strict generator abort, which is worse than a vague
 * one.
 */
function includedRelationSchema(
    relation: ResolvedRelation,
    registeredSchemas: ReadonlySet<string>
): Record<string, unknown> {
    const target = relationTarget(relation);
    const targetSchema = target ? schemaNameFor(target) : undefined;
    const item: Record<string, unknown> = targetSchema && registeredSchemas.has(targetSchema)
        ? { $ref: `#/components/schemas/${targetSchema}` }
        : { type: "object" };
    return relation.cardinality === "many" ? { type: "array", items: item } : item;
}

/**
 * Emit a collection's relations onto a read schema: the foreign keys first,
 * then the relations themselves.
 *
 * The order and the keys are the SDK `Row`'s, deliberately — the parity test
 * next door compares the two key sets, and the only way that stays true is for
 * both to be derived the same way rather than kept in step by hand.
 *
 * A `belongsTo` reaches the wire under the *field* name of its local column
 * (`author_id` → `authorId`), which is what `fieldKeyForColumn` answers; a
 * relation addressed by the same name as its own foreign key is served as
 * either the scalar or the nested row depending on `include`, so it is
 * documented as both.
 */
function emitRelationProperties(
    collection: CollectionConfig,
    properties: Record<string, unknown>,
    required: string[],
    emitted: Set<string>,
    registeredSchemas: ReadonlySet<string>
): void {
    const resolved = resolveRelationsForDocument(collection);

    for (const [relationKey, relation] of Object.entries(resolved)) {
        if (relation.kind !== "belongsTo" || !relation.localKey) continue;
        const fieldKey = fieldKeyForColumn(collection, relation.localKey);
        if (emitted.has(fieldKey)) continue;

        const foreignKey = idSchemaFor(relationTarget(relation));
        const shadowedByInclude = relationKey === fieldKey;
        properties[fieldKey] = shadowedByInclude
            ? { oneOf: [foreignKey, includedRelationSchema(relation, registeredSchemas)] }
            : { ...foreignKey, description: `Foreign key into \`${relation.targetSlug}\`` };
        emitted.add(fieldKey);

        if (isRelationRequired(collection, relation) && !shadowedByInclude) required.push(fieldKey);
    }

    for (const [key, relation] of Object.entries(resolved)) {
        if (emitted.has(key)) continue;
        properties[key] = includedRelationSchema(relation, registeredSchemas);
        emitted.add(key);
    }

    // A `relation` property whose relation did not resolve. Still a field of the
    // row, just not a precisely describable one.
    for (const [key, property] of Object.entries(collection.properties ?? {})) {
        if ((property as Property)?.type !== "relation") continue;
        if (emitted.has(key)) continue;
        properties[key] = { type: "object" };
        emitted.add(key);
    }
}

/**
 * Build the component schema for a collection (output / read shape).
 *
 * Every declared property except the ones {@link isDocumentedProperty} rules
 * out, plus the foreign keys and relations {@link emitRelationProperties} adds.
 */
function buildCollectionSchema(
    collection: CollectionConfig,
    registeredSchemas: ReadonlySet<string>
): Record<string, unknown> {
    const idKey = idPropertyEntry(collection)?.[0] ?? "id";
    const properties: Record<string, unknown> = {
        [idKey]: { ...idSchemaFor(collection), description: "Unique identifier" }
    };
    const required: string[] = [idKey];
    const excluded = excludedApiKeys(collection);
    const emitted = new Set<string>(excluded);
    emitted.add(idKey);

    for (const [key, property] of Object.entries(collection.properties)) {
        if (property.type === "relation") continue;
        if (!isDocumentedProperty(property)) continue;

        properties[key] = convertPropertyToSchema(property);
        emitted.add(key);

        if (property.validation?.required && key !== idKey) {
            required.push(key);
        }
    }

    emitRelationProperties(collection, properties, required, emitted, registeredSchemas);

    return {
        type: "object",
        required: required.length > 0 ? required : undefined,
        properties
    };
}

/**
 * The PATCH/PUT operation for `/data/{slug}/{id}`.
 *
 * Split out because both verbs serve it and they must not drift: the update
 * body is a **partial**, and describing it with the create schema was the bug
 * this replaces. `<Name>Input` marks every `validation.required` property as
 * required — correct for POST, wrong for an update, where omitting a field
 * means "leave it alone" rather than "I forgot it". A client generated from
 * that spec demanded fields the server does not, and a spec-validating gateway
 * would have rejected partial updates the server accepts.
 */
function updateOperation(
    collection: CollectionConfig,
    schemaName: string,
    requireAuth: boolean
): Record<string, unknown> {
    return {
        tags: [collection.name],
        summary: `Update ${collection.singularName || collection.name}`,
        description: "Partial update: only the properties present in the body are written; the rest are left unchanged.",
        operationId: `update${schemaName}`,
        parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Entity ID" }
        ],
        requestBody: {
            required: true,
            content: {
                "application/json": {
                    schema: { $ref: `#/components/schemas/${schemaName}Update` }
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
            404: {
                description: "Entity not found",
                content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
            },
            ...errorResponses(requireAuth)
        }
    };
}

/**
 * The update body: the create schema with `required` dropped.
 *
 * Derived rather than rebuilt so the two cannot describe different columns —
 * the only difference between creating and updating is which fields you must
 * supply, and that is exactly the one thing removed here.
 */
function buildCollectionUpdateSchema(collection: CollectionConfig): Record<string, unknown> {
    const { required: _required, ...rest } = buildCollectionInputSchema(collection);
    return rest;
}

/**
 * Build an input schema (for POST/PUT) — excludes auto-generated fields.
 *
 * `excludeFromApi` columns are left out too, and the server now agrees: a write
 * naming one is refused (`write-validation.ts`), which is what the flag's name
 * and the generated SDK's own documentation always said. This comment used to
 * record that such a write was "still accepted" — the document was right and
 * the server was the thing that had not caught up.
 */
function buildCollectionInputSchema(collection: CollectionConfig): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const excluded = excludedApiKeys(collection);
    const emitted = new Set<string>(excluded);
    const idKey = idPropertyEntry(collection)?.[0] ?? "id";

    for (const [key, property] of Object.entries(collection.properties)) {
        if (property.type === "relation") continue;
        if (!isDocumentedProperty(property)) continue;

        // Skip auto-value date fields from the input schema
        if (property.type === "date" && property.autoValue) continue;

        // Skip auto-generated ID fields
        if ("isId" in property && property.isId && property.isId !== "manual" && property.isId !== true) continue;

        properties[key] = convertPropertyToSchema(property);
        emitted.add(key);

        if (property.validation?.required) {
            required.push(key);
        }
    }

    // Allow explicit ID for create (optional). Typed from the declared primary
    // key rather than as a `string` literal: a serial `id` was `integer` on the
    // read schema and `string` here, for the same column, in every document the
    // generator has ever produced.
    if (!emitted.has(idKey)) {
        properties[idKey] = {
            ...idSchemaFor(collection),
            description: "Optional: client-assigned ID. If omitted, the server generates one."
        };
        emitted.add(idKey);
    }

    // The two ways a write may name a `belongsTo` target, both of which the
    // server accepts and the generated SDK's `Insert` already offered: the
    // foreign key under its own wire name (`authorId`), and the relation
    // property (`author`), which the write transformer maps onto that column.
    // Neither reached the document, so the spec described a create that could
    // not set a relation at all.
    emitWritableRelations(collection, properties, emitted);

    return {
        type: "object",
        required: required.length > 0 ? required : undefined,
        properties
    };
}

/**
 * The writable half of a collection's relations: `belongsTo` only.
 *
 * A to-many is not writable through the body — the server links rows through
 * the nested routes — so offering `tags: [...]` on a create would describe a
 * write that does nothing. Same rule, same reason, as `emitWritableRelations`
 * in the SDK generator, whose `Insert` type this mirrors key for key.
 *
 * Neither spelling is listed in `required`, even for a relation the collection
 * declares `validation: { required: true }` on: the two keys are alternatives,
 * and a schema naming both would tell a spec-validating gateway to reject a
 * create that the server accepts. (The SDK's `Insert` marks both non-optional
 * for the same relation, which is the same fact stated less carefully; a
 * document is the half that a gateway enforces.)
 */
function emitWritableRelations(
    collection: CollectionConfig,
    properties: Record<string, unknown>,
    emitted: Set<string>
): void {
    const resolved = resolveRelationsForDocument(collection);

    const emit = (key: string, relation: ResolvedRelation): void => {
        if (emitted.has(key)) return;
        properties[key] = {
            ...idSchemaFor(relationTarget(relation)),
            description: `The \`${relation.targetSlug}\` row this belongs to.`
        };
        emitted.add(key);
    };

    for (const relation of Object.values(resolved)) {
        if (relation.kind === "belongsTo" && relation.localKey) {
            emit(fieldKeyForColumn(collection, relation.localKey), relation);
        }
    }

    for (const [key, property] of Object.entries(collection.properties ?? {})) {
        if ((property as Property)?.type !== "relation") continue;
        const relation = findRelation(resolved, key);
        if (relation?.kind === "belongsTo" && relation.localKey) emit(key, relation);
    }
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
            // `isId` is on this list because the DDL generator puts it there:
            // a numeric primary key is `INTEGER GENERATED BY DEFAULT AS
            // IDENTITY` for `"increment"` and `INTEGER` for every other form
            // (`generate-postgres-ddl-logic.ts`), so the column the scaffold's
            // `posts.id` creates is an integer and the document called it a
            // `number` — which lets a generated client send `1.5` for a row id.
            const isInteger = np.validation?.integer
                || Boolean(np.isId)
                || np.columnType === "integer" || np.columnType === "serial"
                || np.columnType === "bigserial" || np.columnType === "bigint";
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
 *
 * `excludeFromApi` columns are not offered: the server does filter on them, and
 * that is exactly the problem — a filter on a column no response can contain
 * answers questions about the value one row at a time, which is a worse
 * disclosure than the column name alone.
 */
function buildFilterParameters(
    collection: CollectionConfig,
    reservedNames: ReadonlySet<string> = new Set()
): Array<Record<string, unknown>> {
    const params: Array<Record<string, unknown>> = [];

    for (const [key, property] of Object.entries(collection.properties)) {
        if (!isDocumentedProperty(property)) continue;
        // A `relation` property is not a column, so there is nothing to compare
        // against. The foreign key beside it is filterable and is still not
        // offered here — a separate gap from the schema one, and one the query
        // layer has to answer first.
        if (property.type === "relation") continue;
        if (property.type === "map" || property.type === "array" || property.type === "geopoint") {
            continue;
        }
        // A column whose name a list parameter already owns is unfilterable
        // over the wire — see `reservedParameterNames`.
        if (reservedNames.has(key)) continue;

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
 * The component-schema name for a collection — and the stem of every
 * `operationId` and `$ref` that mentions it.
 *
 * `toPascalCase` keeps ASCII letters and digits and nothing else, so a name
 * written in a script that has none of them — a Cyrillic or Japanese
 * `singularName`, which the docs' six locales make ordinary rather than exotic
 * — reduced to the empty string. The schema was then stored under `""` and
 * every reference to it read `#/components/schemas/`, an unresolvable pointer:
 * Swagger UI renders the model empty and a strict generator fails outright. So
 * fall through the names until one survives, and keep a constant as the floor.
 *
 * Two collections whose names PascalCase identically still share one component;
 * that needs a disambiguation rule, not a fallback.
 */
function schemaNameFor(collection: CollectionConfig): string {
    return toPascalCase(collection.singularName || "")
        || toPascalCase(collection.name || "")
        || toPascalCase(collection.slug || "")
        || "Collection";
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
