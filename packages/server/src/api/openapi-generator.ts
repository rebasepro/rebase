import {
    DEFAULT_LIST_LIMIT,
    MAX_LIST_LIMIT,
    isNumericColumnType,
    isTemporalColumnType,
    isTextColumnType,
    type ColumnAccess,
    type ColumnDescriptor,
    type ColumnStorage,
    type ColumnType,
    type ColumnValidation,
    type JsonShape,
    type RelationDescriptor,
    type TableDescriptor
} from "@rebasepro/types";
import { columnAccess, tenantOf, textMaxLength, validationPattern } from "@rebasepro/common";
import { labelFromIdentifier, singularLabel } from "@rebasepro/utils";
import { DELETED_QUERY_PARAM, HARD_DELETE_QUERY_PARAM } from "./rest/soft-delete-params";
import type { TableLookup } from "./rest/served-table";

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

/**
 * A table as the document names it: its descriptor, and the labels its tags,
 * summaries and component names are built from.
 */
interface DocumentedTable {
    table: TableDescriptor;
    slug: string;
    /** "Order Items": the tag, and the plural in summaries. */
    name: string;
    /** "Order Item": the singular in summaries, and the stem of the component name. */
    singularName: string;
    description?: string;
}

/**
 * The labels a table is documented under, from its slug alone.
 *
 * A table has no labels of its own (presentation is the panel's,
 * `customizeTable`); these are the defaults a collection that declared none
 * was always given — `order_items` → "Order Items" / "Order Item" — through
 * the same `@rebasepro/utils` helpers, so every component name, `$ref` and
 * `operationId` in the document stays what it was.
 */
function documentedNames(slug: string): Pick<DocumentedTable, "slug" | "name" | "singularName"> {
    const name = labelFromIdentifier(slug);
    return { slug, name, singularName: singularLabel(name) };
}

/**
 * The OpenAPI document of the data API, built from the served tables'
 * descriptors.
 *
 * @param tables the tables the data routes serve, in the order they are
 *   documented. A relation's target is described from this list too; one that
 *   is not in it is documented as an open object.
 */
export function generateOpenApiSpec(
    tables: readonly TableDescriptor[],
    options: OpenApiGeneratorOptions = {}
): Record<string, unknown> {
    const lookup: TableLookup = slug => tables.find(table => table.slug === slug);
    const collections: DocumentedTable[] = tables.map(table => ({
        table,
        ...documentedNames(table.slug),
        ...(table.description !== undefined ? { description: table.description } : {})
    }));
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
            description: "Page number (alternative to offset). Calculates offset as (page-1)*limit. Cannot be combined with `offset` (400 PAGE_WITH_OFFSET)." },
        {
            name: "after",
            in: "query",
            schema: { type: "string" },
            description:
                "Keyset cursor: continue after the row the previous page ended on. Pass back "
                + "`meta.nextCursor` from that response, unchanged — it is opaque, and encodes both the "
                + "sort keys and the last row's values for them. Unlike `offset`, a row inserted or "
                + "deleted before the cursor cannot shift the window, so a walk neither repeats nor "
                + "skips rows. Cannot be combined with `offset`/`page` (400 CURSOR_WITH_OFFSET), and an "
                + "`orderBy` different from the one the cursor was issued under is refused "
                + "(400 CURSOR_ORDER_MISMATCH) rather than seeked in an order nobody asked for."
        },
        {
            name: "orderBy",
            in: "query",
            schema: { type: "string" },
            description:
                "Sort field and direction. Accepts `field:asc`, `field:desc`, or `field:desc:last` — "
                + "the third segment places NULLs (`first`/`last`), defaulting to Postgres's own "
                + "convention (last ascending, first descending). Also accepts a JSON array "
                + "`[{\"field\":\"name\",\"direction\":\"asc\",\"nulls\":\"last\"}]` — several entries sort by "
                + "each in turn, the second breaking ties on the first.",
            example: "created_at:desc:last"
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
            name: "not",
            in: "query",
            schema: { type: "string" },
            description:
                "Negation, AND-ed with `where` and `searchString`. Negates the **conjunction** of its "
                + "conditions: `not(a)` is `NOT a`, `not(a,b)` is `NOT (a AND b)`. Groups nest, so "
                + "`not(or(a,b))` is the De Morgan case. Compiles to a real SQL `NOT (...)`, which — "
                + "three-valued logic — also excludes rows whose column is NULL. Ignored when `or` or "
                + "`and` is also present.",
            example: "(status.eq.draft,views.gte.10)"
        },
        {
            name: "include",
            in: "query",
            schema: { type: "string" },
            description:
                "Relations to load, in either of two spellings. **Comma-separated names or dotted "
                + "paths** — `author,comments.author`, up to 3 hops deep; `*` loads every relation one "
                + "hop deep. **JSON**, when a relation needs narrowing — "
                + "`{\"comments\":{\"limit\":5,\"where\":{\"published\":[\"==\",true]},"
                + "\"orderBy\":\"created_at:desc\",\"fields\":\"id,body\",\"include\":{\"author\":true}}}`. "
                + "A value starting with `{` is read as the JSON form. A name that is not a relation of "
                + "the collection is a 400 UNKNOWN_RELATION, not a silently missing field.",
            example: "author,comments.author"
        },
        {
            name: "fields",
            in: "query",
            schema: { type: "string" },
            description:
                "Comma-separated columns to return. A projection pushed into the SELECT, so a query "
                + "that needs two fields of a wide row reads two columns. The primary key is always "
                + "returned (a row that cannot be addressed cannot be updated, deleted, or paged past), "
                + "and `excludeFromApi` columns stay hidden whether or not they are named here. An "
                + "unknown column is a 400 UNKNOWN_FIELD.",
            example: "id,name,created_at"
        },
        {
            name: "distinct",
            in: "query",
            schema: { type: "boolean" },
            description:
                "`SELECT DISTINCT` over the returned columns. Only meaningful alongside `fields`: the "
                + "primary key is always in the projection, so without narrowing it every row is "
                + "already distinct. The response has no `meta.total` — the rows before deduplication "
                + "are a different set, so their count would not describe the page — and `meta.hasMore` "
                + "comes from reading one row past the page. Refused (400) alongside "
                + "`searchString` or a vector search, which attach a per-row score that makes every row "
                + "distinct by construction, and (400 DISTINCT_ORDER_BY_NOT_SELECTED) when `orderBy` "
                + "names a column `fields` does not return.",
            example: "true"
        },
        {
            name: "count",
            in: "query",
            schema: { type: "string", enum: ["exact", "none"], default: "exact" },
            description:
                "Whether to count every matching row for `meta.total`. `exact` (the default) runs a "
                + "`COUNT(*)` beside the page, which on a large table costs more than the page itself; "
                + "`none` skips it, and the response then has no `meta.total`. `meta.hasMore` is exact "
                + "either way — without a count it comes from reading one row past the page — so a walk "
                + "that pages until `hasMore` is false needs no count. Anything else is a 400 INVALID_COUNT.",
            example: "none"
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
            description: "Drop rows farther than this distance. Rows are returned closest-first with a `_distance` field. "
                + "The response then has no `meta.total`: counting the rows within a distance computes it for every row "
                + "of the table. `meta.hasMore` is exact, from reading one row past the page."
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
description: "Total number of matching records. Absent on a `distinct` read, which has no count of the rows it returns, on a vector search with a `vector_threshold`, whose count would compute a distance for every row, and when the request asked for `count=none`." },
                        limit: { type: "integer",
description: "Page size used for this query" },
                        offset: { type: "integer",
description: "Number of records skipped" },
                        hasMore: { type: "boolean",
description: "Whether more records exist beyond this page" },
                        nextCursor: {
                            type: "string",
                            description:
                                "Opaque keyset cursor continuing this listing — pass it back as `?after=`. "
                                + "Present when `hasMore` is true and the page returned at least one row; "
                                + "absent on the last page and on an ordering no cursor can describe "
                                + "(relevance, whose scores are computed per query and not stored). Do not "
                                + "parse it: the encoding exists to be changed."
                        }
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
    //
    // `deleted` too: the parser reads it as the soft-delete parameter on every
    // collection (a value other than `include`/`only` is a 400), so a filter
    // on a column of that name never runs either.
    const reservedParameterNames = new Set([...listQueryParameters().map(p => p.name), DELETED_QUERY_PARAM]);

    /**
     * `?deleted=` on the reads of a `softDelete` collection. A delete there
     * moves the row to the trash, and every read hides trashed rows unless it
     * asks for them; the list, the single row, the count and the aggregate all
     * honour this. Empty for any other collection.
     */
    const deletedParameters = (collection: DocumentedTable) => {
        const field = collection.table.softDelete?.field;
        if (!field) return [];
        return [{
            name: DELETED_QUERY_PARAM,
            in: "query",
            required: false,
            schema: { type: "string", enum: ["include", "only"] },
            description:
                `Rows a delete moved to the trash (\`${field}\` set) are left out unless this asks for them: ` +
                "`include` reads them with the live rows, `only` reads them alone. Any other value is a " +
                "400 INVALID_DELETED_PARAM."
        }];
    };

    /**
     * `?hard=` on the deletes of a `softDelete` collection: delete for good
     * rather than move to the trash. Empty for any other collection.
     */
    const hardDeleteParameters = (collection: DocumentedTable) => {
        if (!collection.table.softDelete) return [];
        return [{
            name: HARD_DELETE_QUERY_PARAM,
            in: "query",
            required: false,
            schema: { type: "boolean", default: false },
            description:
                "`true` deletes for good instead of moving to the trash — a row already in the trash " +
                "included, which is how the trash is emptied. Only `true`/`1` and `false`/`0` are " +
                "accepted; anything else is a 400 INVALID_HARD_PARAM."
        }];
    };

    /** What a delete does to a `softDelete` collection's row, for the delete operations' descriptions. */
    const softDeleteBehaviour = (collection: DocumentedTable): string | undefined => {
        const field = collection.table.softDelete?.field;
        if (!field) return undefined;
        return `This collection soft-deletes: a delete moves the row to the trash by stamping \`${field}\`, ` +
            "and every read leaves it out unless it passes `?deleted=include` or `?deleted=only`. A PATCH " +
            `setting \`${field}\` back to \`null\` restores it. Pass \`?hard=true\` to delete for good.`;
    };

    // Every component name this document will carry, known before the first
    // schema is built: a relation may point at a collection that appears later
    // in the list, or at one that is not documented here at all, and a `$ref`
    // at a component that does not exist is a document Swagger UI renders empty
    // and a strict generator refuses.
    const registeredSchemas = new Set((collections || []).map(schemaNameFor));

    /**
     * `Prefer: return=minimal`, on every route that would otherwise send a row
     * back. Documented rather than left implicit because a client generated
     * from this spec cannot send a header the spec does not mention.
     */
    const preferHeader = {
        name: "Prefer",
        in: "header",
        required: false,
        schema: { type: "string", enum: ["return=minimal"] },
        description:
            "`return=minimal` asks the server not to send the written row back. Single writes then " +
            "answer `204 No Content`; bulk and batch writes answer `200` carrying the ids only. " +
            "The response repeats it in `Preference-Applied` when it was honoured."
    };

    const ifMatchHeader = {
        name: "If-Match",
        in: "header",
        required: false,
        schema: { type: "string" },
        description:
            "The `ETag` this edit was made against, from the `GET` that read the row. The write is " +
            "refused with `412` if the row has changed since — which is the difference between " +
            "\"update the row I read\" and \"overwrite whatever is there now\". `*` means only that " +
            "the row must exist."
    };

    const preconditionFailed = {
        412: {
            description:
                "The row changed since the ETag in `If-Match` was issued. Nothing was written: " +
                "re-read the row, re-apply the change, and send the new ETag",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
        }
    };

    const minimalResponse = {
        204: {
            description: "Written. `Prefer: return=minimal` was honoured, so there is no body",
            headers: {
                "Preference-Applied": { schema: { type: "string" }, description: "`return=minimal`" }
            }
        }
    };

    // ── POST /data/_batch — writes across collections, one transaction ────
    //
    // Registered before the per-collection paths for the same reason the route
    // is: `_batch` is not a collection, and reading it as one would document a
    // table that does not exist.
    if ((collections || []).length > 0) {
        paths["/data/_batch"] = {
            post: {
                tags: ["Data"],
                summary: "Write across collections in one transaction",
                description:
                    "All-or-nothing across collections — an order and its line items, a user and " +
                    "their membership row. `/bulk` is one collection at a time, and sending the two " +
                    "halves as separate requests is exactly the sequence that can half-succeed.\n\n" +
                    "Operations run in order, each through the same pipeline its single-row route " +
                    "uses: the same validation, callbacks and row-level security, as the same role. " +
                    "An operation may name itself with `ref`, and a later one may stand " +
                    "`{ \"$ref\": \"order.id\" }` wherever a value goes — in `values`, at any depth, " +
                    "or as an `id`. Only backward references resolve.\n\n" +
                    "Capped at the same number of entries as a bulk write, because one batch is one " +
                    "transaction and holds its locks for the whole of it.",
                operationId: "batchWrite",
                parameters: [
                    {
                        name: "Idempotency-Key",
                        in: "header",
                        required: false,
                        schema: { type: "string" },
                        description:
                            "Names this batch so a retry is recognised instead of repeated. Without it a " +
                            "client that lost the response cannot tell a replay from a second batch, and " +
                            "the whole batch is written twice."
                    },
                    preferHeader
                ],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["operations"],
                                properties: {
                                    operations: {
                                        type: "array",
                                        items: { $ref: "#/components/schemas/BatchOperation" }
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        description:
                            "One entry per operation, in order: the written row for a create, update or " +
                            "upsert, and `null` for a delete",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        data: { type: "array", items: { type: "object", nullable: true } },
                                        meta: { type: "object", properties: { operations: { type: "integer" } } }
                                    }
                                }
                            }
                        }
                    },
                    400: {
                        description:
                            "Malformed body, an unknown collection or field, an illegal field operation " +
                            "or conflict target, a forward `$ref`, or more operations than the limit. " +
                            "Nothing was written",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
                    },
                    404: {
                        description: "An `update` or `delete` names a row that does not exist; nothing was written",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
                    },
                    409: {
                        description: "A request with the same Idempotency-Key is still in flight",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
                    },
                    422: {
                        description: "The Idempotency-Key was already used for a different request",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
                    },
                    ...errorResponses(requireAuth)
                }
            }
        };

        schemas.FieldOperation = {
            type: "object",
            description:
                "A change to the column's current value rather than the value to store. Exactly one " +
                "operator per field. Only on an update: an operation over a value that does not exist " +
                "yet is refused with a 400.",
            properties: {
                $inc: { type: "number", description: "Add to a `number` column; negative to subtract." },
                $push: { description: "Append a value, or each of an array of values, to an `array` column." },
                $pull: { description: "Remove every occurrence of a value from an `array` column." },
                $merge: { type: "object", description: "Shallow-merge an object into a `map` column." }
            }
        };

        schemas.BatchOperation = {
            type: "object",
            required: ["op", "collection"],
            properties: {
                op: { type: "string", enum: ["create", "update", "upsert", "delete"] },
                collection: { type: "string", description: "The collection slug this operation writes to." },
                id: {
                    description:
                        "Required for `update` and `delete`. May instead be a reference marker — an " +
                        "object whose single key is `$ref` and whose value is `<ref name>.<field>`, " +
                        "e.g. `{ \"$ref\": \"order.id\" }` — naming a column of the row an earlier " +
                        "operation wrote. (Described rather than declared as a schema: `$ref` is a " +
                        "reserved word to every OpenAPI reader, and a property named `$ref` is read " +
                        "as a reference and mangled.)",
                    oneOf: [{ type: "string" }, { type: "integer" }, { type: "object" }]
                },
                values: {
                    type: "object",
                    description:
                        "The row's fields. Values may be `$ref` markers; an `update` may also carry " +
                        "field operations.",
                    additionalProperties: true
                },
                onConflict: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        "`upsert` only: the columns the conflict is matched on. Must carry a declared " +
                        "uniqueness guarantee. Defaults to the primary key."
                },
                ref: {
                    type: "string",
                    description: "Names this operation's result, so a later one can `$ref` its columns."
                }
            }
        };
    }

    // ── Collection routes ────────────────────────────────────────────────
    for (const collection of (collections || [])) {
        const schemaName = schemaNameFor(collection);
        const slug = collection.slug;

        tags.push({
            name: collection.name,
            description: collection.description || `CRUD operations for ${collection.name}`
        });

        // Build component schema for this collection
        schemas[schemaName] = buildTableSchema(collection.table, registeredSchemas, lookup);

        // Build an "input" schema (no read-only/auto fields like autoValue dates)
        schemas[`${schemaName}Input`] = buildTableInputSchema(collection.table, lookup);

        // The update body — same columns, no `required`. PATCH and PUT both
        // merge, so a field left out means "unchanged", not "omitted by mistake".
        schemas[`${schemaName}Update`] = buildTableUpdateSchema(collection.table, lookup);

        const dataPath = `/data/${slug}`;
        const softDeleteNote = softDeleteBehaviour(collection);

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
        //
        // Its parameters are the listing's that narrow the rows — the filters,
        // the logical groups, the search and the vector search, all of which
        // the route reads (`countRawEntities`) — and not the ones that page or
        // shape them. The vector search and the groups were read and not
        // described, which left a generated client unable to count what its
        // own `find()` had asked for.
        const countNarrowing = new Set([
            "where", "or", "and", "not", "searchString",
            "vector_search", "vector", "vector_distance", "vector_threshold"
        ]);
        const countParameters = [
            ...listQueryParameters()
                .filter(p => countNarrowing.has(p.name))
                .map(p => p.name === "vector_threshold"
                    ? { ...p, description: "Count only the rows within this distance of `vector`." }
                    : p),
            ...deletedParameters(collection),
            ...buildFilterParameters(collection.table, reservedParameterNames)
        ];
        const countResponses = {
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
        };
        paths[`${dataPath}/count`] = {
            get: {
                tags: [collection.name],
                summary: `Count ${collection.name}`,
                description:
                    "The number of rows the same filters would return, without returning them. " +
                    "Takes the filter and search parameters of the list endpoint; `limit`, `offset` " +
                    "and `orderBy` are not part of the question and are ignored.",
                operationId: `count${schemaName}`,
                parameters: countParameters,
                responses: countResponses
            },
            // The same count, its parameters in the body — documented from
            // the GET's own list, as `POST …/query` is from the listing's.
            post: queryOperation({
                tags: [collection.name],
                summary: `Count ${collection.name}, parameters in the body`,
                description:
                    "The count `GET` answers, with its query parameters in a JSON body instead of the URL: " +
                    "the same filters, search and vector search, the same row-level security, and the same " +
                    "errors. It reads and never writes, so a credential needs `data:read` for it. Use it when " +
                    "the URL would not fit: a vector search's embedding, a long `in` list. A parameter also on " +
                    "the URL is a 400 INVALID_QUERY_BODY.",
                operationId: `count${schemaName}Query`,
                parameters: countParameters,
                responses: countResponses,
                reserved: reservedParameterNames
            })
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
                    // `limit`, `offset` and `page` bound and page the groups,
                    // exactly as they do a listing's rows.
                    ...listQueryParameters().filter(p =>
                        p.name === "searchString" || p.name === "limit" || p.name === "offset" || p.name === "page"),
                    {
                        name: "orderBy",
                        in: "query",
                        required: false,
                        description:
                            "Sort for the groups, by a `groupBy` field or an aggregate's result key (`count`, " +
                            "`sum_total`): `key:asc`, `key:desc` or `key:desc:last`. Groups it leaves tied are " +
                            "ordered by the `groupBy` fields, so every page boundary falls in the same place. " +
                            "`offset`, `page` and `orderBy` need `groupBy` — without it the result is one row — " +
                            "and are otherwise a 400 INVALID_AGGREGATE_WINDOW.",
                        schema: { type: "string" },
                        example: "count:desc"
                    },
                    ...deletedParameters(collection),
                    ...buildFilterParameters(collection.table, reservedParameterNames)
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
                                        },
                                        meta: {
                                            type: "object",
                                            description: "The page of groups. Present when `groupBy` is.",
                                            properties: {
                                                limit: { type: "integer" },
                                                offset: { type: "integer" },
                                                hasMore: { type: "boolean", description: "Whether a group follows this page." }
                                            }
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
        const listParameters = [
            ...listQueryParameters(),
            ...deletedParameters(collection),
            ...buildFilterParameters(collection.table, reservedParameterNames)
        ];
        const listResponses = {
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
        };

        // ── POST /data/{slug}/query — the same listing, parameters in the body
        //
        // Before the list path, as `/count` is. Documented from the list's own
        // parameter list, so the two cannot describe different listings.
        paths[`${dataPath}/query`] = {
            post: queryOperation({
                tags: [collection.name],
                summary: `List ${collection.name}, parameters in the body`,
                operationId: `query${schemaName}`,
                parameters: listParameters,
                responses: listResponses,
                reserved: reservedParameterNames
            })
        };

        paths[dataPath] = {
            get: {
                tags: [collection.name],
                summary: `List ${collection.name}`,
                operationId: `list${schemaName}`,
                parameters: listParameters,
                responses: listResponses
            },
            post: {
                tags: [collection.name],
                summary: `Create ${collection.singularName || collection.name}`,
                operationId: `create${schemaName}`,
                parameters: [
                    {
                        name: "on_conflict",
                        in: "query",
                        required: false,
                        schema: { type: "string" },
                        description:
                            "Comma-separated columns to upsert on, turning the create into " +
                            "INSERT ... ON CONFLICT DO UPDATE. They must carry a declared uniqueness " +
                            "guarantee — `validation.unique`, a `unique` index, or the primary key — " +
                            "or the request is refused with a 400 naming the targets that do exist. " +
                            "Left off, this is a plain insert and a duplicate key still raises. " +
                            "Refused (400 `INVALID_CONFLICT_TARGET`) on the auth collection, whose rows are " +
                            "the users: create them with a plain POST and change them with PATCH.",
                        example: "sku"
                    },
                    preferHeader
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
                    201: {
                        description: "Created entity",
                        content: {
                            "application/json": {
                                schema: { $ref: `#/components/schemas/${schemaName}` }
                            }
                        }
                    },
                    ...minimalResponse,
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
                parameters: [idempotencyHeader, preferHeader],
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
                                        description:
                                            "Write each row as INSERT ... ON CONFLICT DO UPDATE. Refused " +
                                            "(400 `INVALID_CONFLICT_TARGET`) on the auth collection, whose rows are the users."
                                    },
                                    onConflict: {
                                        type: "array",
                                        items: { type: "string" },
                                        description:
                                            "The columns the conflict is matched on, instead of the primary key. " +
                                            "They must carry a declared uniqueness guarantee. Naming them without " +
                                            "`upsert: true` is a 400 rather than a silently ignored field."
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
                parameters: [idempotencyHeader, preferHeader],
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
                    "an explicit list can. `beforeDelete`/`afterDelete` fire per row." +
                    (softDeleteNote ? `\n\n${softDeleteNote}` : ""),
                operationId: `deleteMany${schemaName}`,
                parameters: [idempotencyHeader, ...hardDeleteParameters(collection)],
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
                        description: softDeleteNote
                            ? "How many rows were moved to the trash, or deleted for good with `?hard=true`"
                            : "How many rows were deleted",
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
                    // The same two parameters the list route documents, and the
                    // same code serves them — one row and a page of them go
                    // through one pipeline, so anything true of `include` or
                    // `fields` there is true here.
                    {
                        name: "include",
                        in: "query",
                        schema: { type: "string" },
                        description:
                            "Relations to load: comma-separated names or dotted paths "
                            + "(`author,comments.author`, up to 3 hops), `*` for all one hop deep, or the "
                            + "JSON form for per-relation `limit`/`where`/`orderBy`/`fields`. An unknown "
                            + "name is a 400 UNKNOWN_RELATION.",
                        example: "author,comments.author"
                    },
                    {
                        name: "fields",
                        in: "query",
                        schema: { type: "string" },
                        description:
                            "Comma-separated columns to return, as a SELECT projection. The primary key "
                            + "always survives and `excludeFromApi` columns stay hidden.",
                        example: "id,title"
                    },
                    ...deletedParameters(collection)
                ],
                responses: {
                    200: {
                        description: "Entity found",
                        headers: {
                            ETag: {
                                schema: { type: "string" },
                                description:
                                    "This row's version. Send it back as `If-Match` on a later PATCH or " +
                                    "DELETE to have the write refused if the row has changed in between."
                            }
                        },
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
            patch: updateOperation(collection, schemaName, requireAuth, {
                ifMatchHeader,
                preferHeader,
                preconditionFailed,
                minimalResponse
            }),
            delete: {
                tags: [collection.name],
                summary: `Delete ${collection.singularName || collection.name}`,
                ...(softDeleteNote ? { description: softDeleteNote } : {}),
                operationId: `delete${schemaName}`,
                parameters: [
                    { name: "id",
in: "path",
required: true,
schema: { type: "string" },
description: "Entity ID" },
                    ifMatchHeader,
                    {
                        name: "Idempotency-Key",
                        in: "header",
                        required: false,
                        schema: { type: "string" },
                        description:
                            "Names this delete so a retry replays its answer. A delete replayed after " +
                            "the first attempt committed would otherwise answer 404 — which an offline " +
                            "queue reads as a permanent failure for a delete that in fact succeeded."
                    },
                    ...hardDeleteParameters(collection)
                ],
                responses: {
                    204: {
                        description: softDeleteNote
                            ? "Moved to the trash: the row still exists and can be restored. With `?hard=true`, deleted for good"
                            : "Deleted successfully"
                    },
                    404: { description: "Entity not found",
content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
                    409: {
                        description: "A request with the same Idempotency-Key is still in flight",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
                    },
                    422: {
                        description: "The Idempotency-Key was already used for a different request",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
                    },
                    ...preconditionFailed,
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
        const relations = collection.table.relations.filter(relation => relation.cardinality === "many");
        for (const relation of relations) {
            const relationName = relation.name;
            const targetSchema = schemaNameFor(documentedNames(relation.target));

            const subPath = `/data/${slug}/{parentId}/${relationName}`;
            const nestedParameters = [
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
            ];
            const nestedResponses = {
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
            };

            // Only add if the schema exists (target collection is also registered)
            paths[subPath] = {
                get: {
                    tags: [collection.name],
                    summary: `List ${relationName} for ${withIndefiniteArticle(collection.singularName || collection.name)}`,
                    operationId: `list${schemaName}${toPascalCase(relationName)}`,
                    parameters: nestedParameters,
                    responses: nestedResponses
                }
            };
            paths[`${subPath}/query`] = {
                post: queryOperation({
                    tags: [collection.name],
                    summary: `List ${relationName} for ${withIndefiniteArticle(collection.singularName || collection.name)}, parameters in the body`,
                    operationId: `query${schemaName}${toPascalCase(relationName)}`,
                    parameters: nestedParameters,
                    responses: nestedResponses,
                    reserved: reservedParameterNames
                })
            };
        }
    }

    return spec;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Is this column (or relation) part of the shape the document may describe?
 *
 * One exclusion, and it is the document telling the truth about what the
 * server does: a `.private()` column is stripped from every row the API
 * serves, for every caller, including admins and service keys, and a list
 * `access.read: []` closes it to everybody the same way. A schema that lists
 * such a column describes a field that is never present, and it describes it
 * to everyone: `/docs` is mounted on the app, not on the data router, so it
 * carries none of the auth middleware `{basePath}/data` does.
 *
 * The write half adds `.readOnly()` and generated columns: nobody writes them
 * through the API (`write-validation.ts` refuses them), so an input body that
 * offered them would offer a 400.
 *
 * The same rule the SDK generator applies to its `Row` type
 * (`packages/codegen/src/generate-types.ts`).
 */
function isDocumented(target: Pick<ColumnDescriptor, "private" | "access" | "readOnly">, direction: "read" | "write" = "read"): boolean {
    if (direction === "write" && target.readOnly) return false;
    const access = columnAccess(target);
    return access?.[direction]?.length !== 0;
}

/**
 * The access rules a reader of the document is told about: the column's role
 * lists, with `.readOnly()` stated as "writable by nobody". A generated column
 * is left unannotated — its read-only-ness is the database's, not a rule.
 */
function documentedAccess(column: Pick<ColumnDescriptor, "private" | "access" | "readOnly" | "generated">): ColumnAccess | undefined {
    const access = columnAccess(column);
    if (column.readOnly && column.generated === undefined && !column.private) {
        return { ...(access?.read !== undefined ? { read: access.read } : {}), write: [] };
    }
    return access;
}

/**
 * The `x-rebase-access` annotation, or nothing for a column with no rule.
 *
 * A vendor extension rather than a schema keyword because OpenAPI has no way to
 * say "this property is present for some callers" — `readOnly` is about the
 * direction of a field, not about who. Generators ignore what they do not know,
 * so a client built from this spec still compiles; a *human* reading `/docs`, or
 * a gateway that wants to enforce the same rule at the edge, gets the role lists
 * verbatim. Emitted for the role case only: a column closed to everybody is
 * absent from the document entirely, which is a stronger statement.
 */
function accessAnnotation(access: ColumnAccess | undefined): Record<string, unknown> | undefined {
    if (!access) return undefined;
    const annotation: Record<string, unknown> = {};
    if (access.read !== undefined) annotation.read = [...access.read];
    if (access.write !== undefined) annotation.write = [...access.write];
    return Object.keys(annotation).length > 0 ? annotation : undefined;
}

/** The sentence `x-rebase-access` deserves in prose, for a reader of `/docs`. */
function accessDescription(access: ColumnAccess | undefined): string | undefined {
    if (!access) return undefined;
    const parts: string[] = [];
    const phrase = (roles: readonly string[]) =>
        roles.length === 0 ? "nobody through the API" : roles.map(r => `\`${r}\``).join(", ") + " (and `admin`)";
    if (access.read !== undefined) parts.push(`readable by ${phrase(access.read)}`);
    if (access.write !== undefined) parts.push(`writable by ${phrase(access.write)}`);
    if (parts.length === 0) return undefined;
    return `Field access: ${parts.join("; ")}. A caller without the role does not receive the field at all — it is absent, not null.`;
}

/**
 * The names an undocumented column or relation is served under — its key and
 * its SQL name — so a foreign key derived from a relation cannot put a hidden
 * column back on the surface under its other name. Same pair, same reason, as
 * `excludedApiKeys` in the SDK generator.
 */
function excludedApiKeys(table: TableDescriptor, direction: "read" | "write" = "read"): Set<string> {
    const excluded = new Set<string>();
    for (const column of table.columns) {
        if (isDocumented(column, direction)) continue;
        excluded.add(column.key);
        excluded.add(column.column);
    }
    for (const relation of table.relations) {
        if (!isDocumented(relation, direction)) excluded.add(relation.name);
    }
    return excluded;
}

/**
 * The column a table is addressed by on the wire: the first of its key.
 * `undefined` for a table introspected without a key.
 */
function keyColumnOf(table: TableDescriptor | undefined): ColumnDescriptor | undefined {
    const key = table?.primaryKey[0];
    return key === undefined ? undefined : table?.columns.find(column => column.key === key);
}

/**
 * The schema of a primary key or of a foreign key pointing at one: the key
 * column's own type, stripped of the column-level facts (description,
 * validation bounds) that belong to the column and not to a reference to it.
 *
 * Falls back to `string` for a table without a key.
 */
function idSchemaFor(table: TableDescriptor | undefined): Record<string, unknown> {
    const key = keyColumnOf(table);
    if (!key) return { type: "string" };
    const converted = columnTypeSchema(key);
    const schema: Record<string, unknown> = { type: converted.type ?? "string" };
    if (converted.format) schema.format = converted.format;
    return schema;
}

/**
 * Whether a key column is the planner's implicit `id` — text, keyed, filled by
 * `gen_random_uuid()::text`, declared first. It has always been documented as
 * a "Unique identifier", with no column facts of its own.
 */
function isImplicitIdColumn(table: TableDescriptor, column: ColumnDescriptor): boolean {
    return column.key === "id" && table.columns[0] === column && column.type.kind === "text"
        && column.default?.kind === "sql" && column.default.expression === "gen_random_uuid()::text";
}

/**
 * The schema an *included* relation arrives as: the target's own row.
 *
 * `$ref` when the target is one of the tables this document describes, and an
 * open object when it is not — a dangling pointer makes Swagger UI render an
 * empty model and makes a strict generator abort, which is worse than a vague
 * one.
 */
function includedRelationSchema(
    relation: RelationDescriptor,
    registeredSchemas: ReadonlySet<string>
): Record<string, unknown> {
    const targetSchema = schemaNameFor(documentedNames(relation.target));
    const item: Record<string, unknown> = registeredSchemas.has(targetSchema)
        ? { $ref: `#/components/schemas/${targetSchema}` }
        : { type: "object" };
    return relation.cardinality === "many" ? { type: "array", items: item } : item;
}

/**
 * Emit a table's relations onto a read schema: the foreign keys first, then
 * the relations themselves.
 *
 * The order and the keys are the SDK `Row`'s, deliberately — the parity test
 * next door compares the two key sets.
 *
 * A `belongsTo` reaches the wire under its foreign-key column's key
 * (`authorId`); a relation addressed by the same name as its own foreign key
 * is served as either the scalar or the nested row depending on `include`, so
 * it is documented as both.
 */
function emitRelationProperties(
    table: TableDescriptor,
    properties: Record<string, unknown>,
    required: string[],
    emitted: Set<string>,
    registeredSchemas: ReadonlySet<string>,
    lookup: TableLookup
): void {
    for (const relation of table.relations) {
        if (relation.kind !== "belongsTo") continue;
        const fieldKey = relation.localField;
        if (emitted.has(fieldKey)) continue;

        const foreignKey = idSchemaFor(lookup(relation.target));
        const shadowedByInclude = relation.name === fieldKey;
        properties[fieldKey] = shadowedByInclude
            ? { oneOf: [foreignKey, includedRelationSchema(relation, registeredSchemas)] }
            : { ...foreignKey, description: `Foreign key into \`${relation.target}\`` };
        emitted.add(fieldKey);

        const column = table.columns.find(candidate => candidate.key === fieldKey);
        if (column && !column.nullable && !shadowedByInclude) required.push(fieldKey);
    }

    for (const relation of table.relations) {
        if (emitted.has(relation.name)) continue;
        properties[relation.name] = includedRelationSchema(relation, registeredSchemas);
        emitted.add(relation.name);
    }
}

/**
 * Whether a foreign-key column states anything of its own — a rule, a
 * default, access, a description, … — beyond being the key a relation points
 * with. Such a column is documented as the column it is; a plain foreign key
 * is documented from the relation, typed from its target's key.
 */
function isExplicitForeignKey(column: ColumnDescriptor): boolean {
    if (column.derived) return false;
    return column.primaryKey !== undefined || column.default !== undefined || column.generated !== undefined
        || column.readOnly !== undefined || column.private !== undefined || column.access !== undefined
        || column.stamp !== undefined || column.validate !== undefined || column.oneOf !== undefined
        || column.description !== undefined || column.storage !== undefined || column.semantic !== undefined
        || column.vectorIndex !== undefined || column.json !== undefined || column.element !== undefined
        || column.transforms !== undefined;
}

/**
 * The columns a schema lists in the table's own pass, in physical order: every
 * column but the plain foreign keys of `belongsTo` relations, which
 * {@link emitRelationProperties} emits after them, in relation order.
 */
function ownColumns(table: TableDescriptor): ColumnDescriptor[] {
    return table.columns.filter(column => column.foreignKeyOf === undefined || isExplicitForeignKey(column));
}

/**
 * Build the component schema for a table (output / read shape).
 *
 * Every column except the ones {@link isDocumented} rules out, plus the
 * foreign keys and relations {@link emitRelationProperties} adds.
 *
 * @param lookup any table's descriptor by slug, for the type of a foreign key.
 */
export function buildTableSchema(
    table: TableDescriptor,
    registeredSchemas: ReadonlySet<string>,
    lookup: TableLookup
): Record<string, unknown> {
    const keyColumn = keyColumnOf(table);
    const idKey = keyColumn?.key ?? "id";
    const properties: Record<string, unknown> = {
        [idKey]: { ...idSchemaFor(table), description: "Unique identifier" }
    };
    const required: string[] = [idKey];
    const excluded = excludedApiKeys(table);
    const emitted = new Set<string>(excluded);
    emitted.add(idKey);

    for (const column of ownColumns(table)) {
        if (!isDocumented(column)) continue;
        if (column === keyColumn && isImplicitIdColumn(table, column)) continue;

        properties[column.key] = columnSchema(column);
        emitted.add(column.key);

        if (!column.nullable && !column.primaryKey) required.push(column.key);
    }

    emitRelationProperties(table, properties, required, emitted, registeredSchemas, lookup);
    annotateTenantField(table, properties, "read");

    return {
        type: "object",
        required: required.length > 0 ? required : undefined,
        properties
    };
}

/**
 * Mark the tenant column, on whichever schema is being built.
 *
 * A vendor extension for the same reason `x-rebase-access` is one: OpenAPI has
 * no keyword for "the server fills this in from who you are, and refuses a
 * value that is not yours". `readOnly` is the closest and it is wrong — the
 * column *is* writable, by a caller sending their own tenant, and a bypass role
 * may send any.
 */
function annotateTenantField(
    table: TableDescriptor,
    properties: Record<string, unknown>,
    direction: "read" | "write"
): void {
    const tenant = tenantOf(table);
    if (!tenant) return;
    const schema = properties[tenant.field];
    if (!schema || typeof schema !== "object") return;

    const existing = "description" in schema ? schema.description : undefined;
    const sentence = direction === "write"
        ? "The tenant this row belongs to. Omit it and the server stamps the tenant you are calling as; " +
          "send another tenant's and the write is refused with `TENANT_MISMATCH`. It cannot be changed " +
          "on an update (`TENANT_IMMUTABLE`)."
        : "The tenant this row belongs to. Rows of other tenants are not returned at all.";

    properties[tenant.field] = {
        ...schema,
        description: typeof existing === "string" && existing ? `${existing} — ${sentence}` : sentence,
        "x-rebase-tenant": true
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
    collection: DocumentedTable,
    schemaName: string,
    requireAuth: boolean,
    shared: {
        ifMatchHeader: Record<string, unknown>;
        preferHeader: Record<string, unknown>;
        preconditionFailed: Record<string, unknown>;
        minimalResponse: Record<string, unknown>;
    }
): Record<string, unknown> {
    return {
        tags: [collection.name],
        summary: `Update ${collection.singularName || collection.name}`,
        description:
            "Partial update: only the properties present in the body are written; the rest are left " +
            "unchanged.\n\n" +
            "A property's value may instead be a field operation — `{ \"views\": { \"$inc\": 1 } }`, " +
            "`{ \"tags\": { \"$push\": \"new\" } }`, `{ \"tags\": { \"$pull\": \"old\" } }`, " +
            "`{ \"meta\": { \"$merge\": { \"seen\": true } } }` — which is applied inside the " +
            "statement holding the row lock. That is the difference between a counter that is correct " +
            "under concurrency and one that silently loses increments, because expressing the same " +
            "change as a value means reading it first. `$inc` needs a `number` property, `$push`/`$pull` " +
            "an `array`, `$merge` a `map`; anything else is a 400. Pushed elements and merged keys answer " +
            "to the property's own rules, as a value would. See the `FieldOperation` schema.",
        operationId: `update${schemaName}`,
        parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Entity ID" },
            shared.ifMatchHeader,
            shared.preferHeader,
            {
                name: "Idempotency-Key",
                in: "header",
                required: false,
                schema: { type: "string" },
                description:
                    "Names this update so a retry replays its answer instead of applying the edit " +
                    "again. A PATCH is not naturally idempotent — a field operation emphatically is " +
                    "not — so a retry after a lost response applies it twice."
            }
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
                headers: {
                    ETag: {
                        schema: { type: "string" },
                        description:
                            "The version this write produced — the tag a `GET` of the row now answers. Send " +
                            "it as `If-Match` on the next write to chain conditional edits without reading " +
                            "the row back. Absent on an answer replayed from an `Idempotency-Key`."
                    }
                },
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
            409: {
                description: "A request with the same Idempotency-Key is still in flight",
                content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
            },
            422: {
                description: "The Idempotency-Key was already used for a different request",
                content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
            },
            ...shared.preconditionFailed,
            ...shared.minimalResponse,
            ...errorResponses(requireAuth)
        }
    };
}

/**
 * The update body: the create schema with `required` dropped.
 *
 * Derived rather than rebuilt so the two cannot describe different columns —
 * the only difference between creating and updating is which columns you must
 * supply, and that is exactly the one thing removed here.
 */
function buildTableUpdateSchema(table: TableDescriptor, lookup: TableLookup): Record<string, unknown> {
    const { required: _required, ...rest } = buildTableInputSchema(table, lookup);
    return rest;
}

/** Whether the database (or the server) fills a column a create leaves out: a non-literal default, or generation. */
function databaseFills(column: ColumnDescriptor): boolean {
    const fill = column.default?.kind;
    return fill === "database" || fill === "sql" || fill === "random-uuid" || fill === "identity" || column.generated !== undefined;
}

/**
 * Build an input schema (for POST) — leaves out what the server fills.
 *
 * Private, read-only and generated columns are left out too, and the server
 * agrees: a write naming one is refused (`write-validation.ts`).
 *
 * @param lookup any table's descriptor by slug, for the type of a foreign key.
 */
export function buildTableInputSchema(table: TableDescriptor, lookup: TableLookup): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    // The write half, not the read half: a column readable by nobody but
    // writable by an `admin` belongs in the input body and not in the row.
    const excluded = excludedApiKeys(table, "write");
    const emitted = new Set<string>(excluded);
    const idKey = keyColumnOf(table)?.key ?? "id";

    for (const column of ownColumns(table)) {
        if (!isDocumented(column, "write")) continue;

        // A time the server stamps is not the caller's to send.
        if (column.stamp?.value === "now") continue;

        // A key the database generates.
        if (column.primaryKey && (column.default?.kind === "random-uuid" || column.default?.kind === "identity" || column.default?.kind === "sql")) continue;

        properties[column.key] = columnSchema(column);
        emitted.add(column.key);

        // A column the database fills may be left out of a create.
        if (!column.nullable && !column.primaryKey && !databaseFills(column)) {
            required.push(column.key);
        }
    }

    // Allow an explicit key on create (optional), typed from the declared key.
    if (!emitted.has(idKey)) {
        properties[idKey] = {
            ...idSchemaFor(table),
            description: "Optional: client-assigned ID. If omitted, the server generates one."
        };
        emitted.add(idKey);
    }

    // Every relation a write may set, as the generated SDK's `Insert` types
    // them. See `emitWritableRelations`.
    emitWritableRelations(table, properties, emitted, lookup);
    annotateTenantField(table, properties, "write");

    // The tenant column is never required on input: the server fills it.
    const tenantField = tenantOf(table)?.field;
    const requiredOnInput = tenantField ? required.filter(key => key !== tenantField) : required;

    return {
        type: "object",
        required: requiredOnInput.length > 0 ? requiredOnInput : undefined,
        properties
    };
}

/**
 * The writable half of a table's relations — the same set the SDK generator's
 * `emitWritableRelations` types on `Insert`, kind for kind:
 *
 * - a `belongsTo`, under both spellings the server accepts: the foreign key
 *   (`authorId`) and the relation (`author`);
 * - a `hasOne`, and a single-hop to-one `via`, under the relation: the target's
 *   id, or `null` to unlink;
 * - a to-many membership — `hasMany`, `manyToMany`, and a single-hop to-many
 *   `via` — under the relation's name: a list of target ids or `{ id }`
 *   objects, a `manyToMany`'s carrying a `_pivot` of its link columns.
 *
 * None is listed in `required`: a belongsTo's two keys are alternatives.
 */
function emitWritableRelations(
    table: TableDescriptor,
    properties: Record<string, unknown>,
    emitted: Set<string>,
    lookup: TableLookup
): void {
    const emit = (key: string, schema: Record<string, unknown>): void => {
        if (emitted.has(key)) return;
        properties[key] = schema;
        emitted.add(key);
    };
    const belongsTo = (relation: RelationDescriptor): Record<string, unknown> => ({
        ...idSchemaFor(lookup(relation.target)),
        description: `The \`${relation.target}\` row this belongs to.`
    });

    for (const relation of table.relations) {
        if (relation.kind === "belongsTo") emit(relation.localField, belongsTo(relation));
    }

    for (const relation of table.relations) {
        if (relation.kind === "belongsTo") {
            emit(relation.name, belongsTo(relation));
        } else if (relation.kind === "hasOne" || (relation.kind === "via" && relation.cardinality === "one" && relation.writable)) {
            emit(relation.name, {
                ...idSchemaFor(lookup(relation.target)),
                nullable: true,
                description: `The \`${relation.target}\` row to link to this one; \`null\` unlinks it.`
            });
        }
    }

    for (const relation of table.relations) {
        if (relation.cardinality !== "many") continue;
        if (relation.kind === "via" && !relation.writable) continue;
        const id = idSchemaFor(lookup(relation.target));
        const pivotColumns = relation.kind === "manyToMany" ? relation.through.pivot : [];
        const pivot = pivotColumns.length > 0
            ? {
                _pivot: {
                    type: "object",
                    properties: Object.fromEntries(pivotColumns.map(column => [column.key, columnSchema(column)]))
                }
            }
            : {};
        emit(relation.name, {
            type: "array",
            description: `The \`${relation.target}\` rows linked to this one — the whole set, replacing the current links.`,
            items: { oneOf: [id, { type: "object", required: ["id"], properties: { id, ...pivot } }] }
        });
    }
}

/**
 * A column as an OpenAPI 3.0 schema object, with its access rules annotated.
 */
function columnSchema(column: ColumnDescriptor): Record<string, unknown> {
    const schema = columnTypeSchema(column);
    const access = documentedAccess(column);
    const annotation = accessAnnotation(access);
    if (!annotation) return schema;

    const sentence = accessDescription(access);
    return {
        ...schema,
        ...(sentence
            ? { description: schema.description ? `${schema.description} — ${sentence}` : sentence }
            : {}),
        "x-rebase-access": annotation
    };
}

/** A text value's rules as JSON Schema keywords: lengths, pattern, format, closed set. */
function textSchema(
    base: Record<string, unknown>,
    rules: { validate?: ColumnValidation; oneOf?: readonly (string | number)[]; maxLength?: number; storage?: ColumnStorage }
): Record<string, unknown> {
    base.type = "string";
    if (rules.oneOf && rules.oneOf.length > 0) base.enum = [...rules.oneOf];
    const validate = rules.validate;
    if (typeof validate?.min === "number") base.minLength = validate.min;
    if (rules.maxLength !== undefined) base.maxLength = rules.maxLength;
    if (validate?.length !== undefined) {
        base.minLength = validate.length;
        base.maxLength = validate.length;
    }
    const pattern = jsonSchemaPattern(validate);
    if (pattern !== undefined) base.pattern = pattern;
    if (validate?.email) base.format = "email";
    if (validate?.url) base.format = "uri";
    if (rules.storage) base.format = "uri";
    return base;
}

/** A number's rules as JSON Schema keywords. */
function numberSchema(
    base: Record<string, unknown>,
    rules: { validate?: ColumnValidation; oneOf?: readonly (string | number)[]; integer: boolean }
): Record<string, unknown> {
    base.type = rules.integer ? "integer" : "number";
    if (rules.oneOf && rules.oneOf.length > 0) base.enum = [...rules.oneOf];
    const validate = rules.validate;
    if (typeof validate?.min === "number") base.minimum = validate.min;
    if (typeof validate?.max === "number") base.maximum = validate.max;
    if (validate?.moreThan !== undefined) {
        base.minimum = validate.moreThan;
        base.exclusiveMinimum = true;
    }
    if (validate?.lessThan !== undefined) {
        base.maximum = validate.lessThan;
        base.exclusiveMaximum = true;
    }
    return base;
}

/** A list's rules as JSON Schema keywords. */
function listRules(base: Record<string, unknown>, validate: ColumnValidation | undefined): Record<string, unknown> {
    if (validate?.minItems !== undefined) base.minItems = validate.minItems;
    if (validate?.maxItems !== undefined) base.maxItems = validate.maxItems;
    if (validate?.uniqueItems) base.uniqueItems = true;
    return base;
}

/** A point on Earth. */
function geopointSchema(base: Record<string, unknown>): Record<string, unknown> {
    base.type = "object";
    base.properties = { latitude: { type: "number" }, longitude: { type: "number" } };
    base.required = ["latitude", "longitude"];
    return base;
}

/** A time the server stamps: read-only, and said so. */
function stampedSchema(base: Record<string, unknown>, on: "create" | "update"): Record<string, unknown> {
    base.readOnly = true;
    base.description = (base.description || "") + (on === "create" ? " (Auto-set on creation)" : " (Auto-updated)");
    return base;
}

/** The items of a native array column. */
function elementSchema(column: ColumnDescriptor, of: ColumnType): Record<string, unknown> {
    const element = column.element;
    const base: Record<string, unknown> = {};
    if (isTextColumnType(of) || of.kind === "uuid" || of.kind === "enum") {
        const max = element?.validate?.max;
        return textSchema(base, {
            validate: element?.validate,
            oneOf: element?.oneOf ?? (of.kind === "enum" ? of.values : undefined),
            maxLength: typeof max === "number" ? max : undefined,
            storage: element?.storage ?? column.storage
        });
    }
    if (of.kind === "boolean") {
        base.type = "boolean";
        return base;
    }
    if (isTemporalColumnType(of)) {
        base.type = "string";
        base.format = "date-time";
        return base;
    }
    return numberSchema(base, { validate: element?.validate, oneOf: element?.oneOf, integer: element?.validate?.integer === true });
}

/** One typed block of a `json.oneOf()`. */
function variantSchema(node: Extract<JsonShape, { kind: "oneOf" }>, name: string, variant: JsonShape): Record<string, unknown> {
    return {
        type: "object",
        properties: {
            [node.typeField]: { type: "string", enum: [name] },
            [node.valueField]: jsonNodeSchema(variant)
        },
        required: [node.typeField, node.valueField]
    };
}

/** A node of a JSON document's shape. */
function jsonNodeSchema(node: JsonShape, listValidate?: ColumnValidation): Record<string, unknown> {
    const base: Record<string, unknown> = {};
    if (node.description !== undefined) base.description = node.description;
    switch (node.kind) {
        case "string": {
            const max = node.validate?.max;
            return textSchema(base, { validate: node.validate, oneOf: node.oneOf, maxLength: typeof max === "number" ? max : undefined, storage: node.storage });
        }
        case "number":
            return numberSchema(base, { validate: node.validate, oneOf: node.oneOf, integer: node.validate?.integer === true });
        case "boolean":
            base.type = "boolean";
            return base;
        case "date":
            base.type = "string";
            base.format = "date-time";
            return node.stamp ? stampedSchema(base, node.stamp) : base;
        case "geopoint":
            return geopointSchema(base);
        case "object": {
            base.type = "object";
            const fields = Object.entries(node.fields);
            if (fields.length > 0) {
                base.properties = Object.fromEntries(fields.map(([key, field]) => [key, jsonNodeSchema(field)]));
                const required = fields.filter(([, field]) => field.required).map(([key]) => key);
                if (required.length > 0) base.required = required;
            } else if (node.additional) {
                base.additionalProperties = true;
            }
            return base;
        }
        case "array": {
            base.type = "array";
            const item = node.of;
            base.items = item.kind === "oneOf"
                ? { oneOf: Object.entries(item.variants).map(([name, variant]) => variantSchema(item, name, variant)) }
                : jsonNodeSchema(item);
            return listRules(base, { ...node.validate, ...listValidate });
        }
        case "oneOf":
            base.oneOf = Object.entries(node.variants).map(([name, variant]) => variantSchema(node, name, variant));
            return base;
        case "unknown":
            return base;
    }
}

/** The JSON Schema a column's *type* compiles to, before any access annotation. */
function columnTypeSchema(column: ColumnDescriptor): Record<string, unknown> {
    const base: Record<string, unknown> = {};
    if (column.description !== undefined) base.description = column.description;
    if (column.semantic === "geopoint") return geopointSchema(base);

    const type = column.type;
    switch (type.kind) {
        case "text":
        case "varchar":
        case "char":
        case "uuid":
        case "enum":
            return textSchema(base, {
                validate: column.validate,
                oneOf: type.kind === "enum" ? type.values : column.oneOf,
                maxLength: textMaxLength(column),
                storage: column.storage
            });
        case "smallint":
        case "integer":
        case "bigint":
        case "smallserial":
        case "serial":
        case "bigserial":
        case "real":
        case "doublePrecision":
        case "numeric":
            // A key is an integer however it is declared, as are the integer
            // kinds the API has always called integers.
            return numberSchema(base, {
                validate: column.validate,
                oneOf: column.oneOf,
                integer: column.validate?.integer === true || column.primaryKey === true
                    || type.kind === "integer" || type.kind === "bigint" || type.kind === "serial" || type.kind === "bigserial"
            });
        case "boolean":
            base.type = "boolean";
            return base;
        case "timestamptz":
        case "date":
        case "time":
            base.type = "string";
            base.format = "date-time";
            return column.stamp?.value === "now" ? stampedSchema(base, column.stamp.on) : base;
        case "json":
        case "jsonb": {
            const shape = column.json;
            if (shape === undefined || shape.kind === "unknown") {
                base.type = "object";
                return base;
            }
            const schema = jsonNodeSchema(shape, shape.kind === "array" ? column.validate : undefined);
            return base.description !== undefined ? { ...schema, description: base.description } : schema;
        }
        case "vector":
            base.type = "array";
            base.items = { type: "number" };
            base.description = (base.description || "") + ` (Vector(${type.dimensions}))`;
            return base;
        case "bytea":
            base.type = "string";
            base.description = (base.description || "") + " (Binary/Base64)";
            return base;
        case "array":
            base.type = "array";
            base.items = elementSchema(column, type.of);
            return listRules(base, column.validate);
        case "other":
            if (/\]\s*$/.test(type.sqlType)) {
                base.type = "array";
                base.items = {};
                return base;
            }
            base.type = "string";
            return base;
    }
}

/**
 * Build PostgREST-style filter parameters for a table.
 * These are additional query parameters like `?status=eq.active&price=gte.100`.
 *
 * Private columns are not offered: a filter on a column no response can
 * contain answers questions about the value one row at a time. A plain
 * foreign key is filterable and is still not offered here; JSON documents,
 * lists and points have no single value to compare.
 */
function buildFilterParameters(
    table: TableDescriptor,
    reservedNames: ReadonlySet<string> = new Set()
): Array<Record<string, unknown>> {
    const params: Array<Record<string, unknown>> = [];

    for (const column of ownColumns(table)) {
        if (!isDocumented(column)) continue;
        const kind = column.type.kind;
        if (column.semantic === "geopoint" || kind === "json" || kind === "jsonb" || kind === "array") continue;
        if (column.type.kind === "other" && /\]\s*$/.test(column.type.sqlType)) continue;
        // A column whose name a list parameter already owns is unfilterable
        // over the wire — see `reservedParameterNames`.
        if (reservedNames.has(column.key)) continue;

        const text = isTextColumnType(column.type) || kind === "uuid" || kind === "enum" || kind === "other";
        params.push({
            name: column.key,
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
                `Filter by \`${column.key}\`. Supports PostgREST operators: ` +
                "`eq.value`, `neq.value`, `gt.value`, `gte.value`, `lt.value`, `lte.value`, " +
                "`in.(a,b,c)`, `nin.(a,b,c)`, `cs.value` (array-contains), `csa.(a,b)` (array-contains-any), " +
                "`csall.(a,b)` (array-contains-all), `cd.(a,b)` (array-contained-by). " +
                "Plain values imply equality.",
            example: text ? "eq.active" : isNumericColumnType(column.type) ? "gte.100" : undefined
        });
    }

    return params;
}

/**
 * A `POST …/query` operation: the listing whose `parameters` are given, with
 * its query parameters moved into a JSON body.
 *
 * Built from the `GET`'s own parameter list, so the body documents exactly
 * what the route accepts — it turns the body back into those parameters and
 * runs the `GET`'s parser (`query-body.ts`). A filter parameter takes a list
 * where the URL would repeat it, and the four parameters whose URL value is
 * JSON take the JSON value itself.
 */
function queryOperation(operation: {
    tags: string[];
    summary: string;
    /** What the operation answers; the listing's description when unset. */
    description?: string;
    operationId: string;
    parameters: Array<Record<string, unknown>>;
    responses: Record<string, unknown>;
    /** The listing's own parameter names; every other query parameter is a per-field filter. */
    reserved: ReadonlySet<string>;
}): Record<string, unknown> {
    const jsonValued: Record<string, Record<string, unknown>> = {
        where: { oneOf: [{ type: "object", additionalProperties: true }, { type: "string" }] },
        include: { oneOf: [{ type: "object", additionalProperties: true }, { type: "string" }] },
        orderBy: { oneOf: [{ type: "array", items: {} }, { type: "string" }] },
        vector: { oneOf: [{ type: "array", items: { type: "number" } }, { type: "string" }] }
    };
    const properties: Record<string, unknown> = {};
    for (const parameter of operation.parameters) {
        if (parameter.in !== "query") continue;
        const name = String(parameter.name);
        const schema = parameter.schema as Record<string, unknown>;
        const isFilter = !operation.reserved.has(name);
        properties[name] = {
            ...(jsonValued[name]
                ?? (isFilter ? { oneOf: [schema, { type: "array", items: schema }] } : schema)),
            ...(parameter.description ? { description: parameter.description } : {})
        };
    }
    return {
        tags: operation.tags,
        summary: operation.summary,
        description: operation.description ??
            "The listing `GET` answers, with its query parameters in a JSON body instead of the URL: " +
            "the same filters, page, count, cursor and includes, the same row-level security, and the " +
            "same errors. It reads and never writes, so a credential needs `data:read` for it. Use it " +
            "when the URL would not fit: a vector search's embedding is a JSON array in `vector`, and " +
            "768 dimensions of it is 17 KB of URL, past what Node and most proxies accept. A parameter " +
            "also on the URL is a 400 INVALID_QUERY_BODY.",
        operationId: operation.operationId,
        parameters: operation.parameters.filter(parameter => parameter.in !== "query"),
        requestBody: {
            required: true,
            content: {
                "application/json": {
                    schema: { type: "object", properties }
                }
            }
        },
        responses: operation.responses
    };
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
function schemaNameFor(collection: Pick<DocumentedTable, "singularName" | "name" | "slug">): string {
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

/**
 * A text column's `validate({ matches })` as a JSON Schema `pattern`, or
 * `undefined` when it cannot be stated as one.
 *
 * A pattern is a regex's source and nothing else: no delimiting slashes and no
 * flags. A flag that changes what the source matches (`i`, `m`, `s`) has no
 * JSON Schema spelling; the source alone would refuse values the server
 * accepts, so no pattern is stated.
 */
function jsonSchemaPattern(validate: ColumnValidation | undefined): string | undefined {
    const regExp = validationPattern(validate);
    if (!regExp) return undefined;
    return /[ims]/.test(regExp.flags) ? undefined : regExp.source;
}
