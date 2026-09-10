import { Hono, type Context, type MiddlewareHandler } from "hono";
import { AuthAdapter, DataDriver, CollectionConfig, JUNCTION_PIVOT_KEY, ResolvedRelation, getCollectionDataPath, isManyToMany } from "@rebasepro/types";
import { QueryOptions, HonoEnv } from "../types";
import { ApiError } from "../errors";
import { hostEnv } from "../../utils/host";
import { parseQueryOptions, orderByEntriesToTuples, parseAggregateSelect, parseGroupBy, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, type ListLimitOptions } from "./query-parser";
import { cursorToStartAfter, topLevelIncludeNames } from "@rebasepro/common";
import { assertReadableFields, requestViewer } from "./field-access-query";
import { assertKnownWriteFields, assertWriteRequestValid, assertWriteValuesValid, projectResponseFields } from "./write-validation";
import { assertFieldOpsValid, assertNoFieldOpsOnCreate } from "./field-ops";
import { resolveConflictTarget } from "./conflict-target";
import { ETAG_HEADER, IF_MATCH_HEADER, assertIfMatch, rowETag, versionProperty } from "./etag";
import { assertRefsResolvable, parseBatchBody, type ParsedBatchOperation } from "./batch";
import { httpMethodToOperation, isOperationAllowed } from "../../auth/api-keys/api-key-permission-guard";
import type { ApiKeyOperation } from "../../auth/api-keys/api-key-permission-guard";
import type { ApiKeyMasked } from "../../auth/api-keys/api-key-types";
import { findRelation, getJunctionConfigForRelation, resolveCollectionRelations, resolvePrimaryKeys } from "@rebasepro/common";
import {
    createIdempotencyStore,
    IDEMPOTENCY_HEADER,
    requestFingerprint,
    type IdempotencyStore
} from "./idempotency";
import { HARD_DELETE_QUERY_PARAM, parseHardDelete } from "./soft-delete-params";

/**
 * Parse a JSON request body for a create/update. An empty body yields `{}`
 * (a valid "no explicit fields" write), but a **malformed** body throws a 400
 * rather than being silently swallowed to `{}` — which would turn bad input
 * into an unintended empty write.
 */
async function parseJsonBody(c: Context<HonoEnv>): Promise<Record<string, unknown>> {
    const raw = await c.req.text();
    if (!raw || raw.trim() === "") return {};
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch {
        throw ApiError.badRequest("Invalid JSON body");
    }
}

/**
 * Whether the caller asked not to be sent the row back.
 *
 * RFC 7240's `Prefer: return=minimal`. Every write on this API answers with the
 * full row, which is the right default — it carries what the *server* decided,
 * a serial id, an `autoValue` stamp, whatever `beforeSave` rewrote — and the
 * wrong one for an import, where it is a row serialisation and (on Postgres) a
 * read-back per written row, thrown away on arrival.
 *
 * A preference, not an instruction: a server is free to ignore it, so a client
 * cannot depend on the 204 without checking. `Preference-Applied` on the
 * response is how it finds out, and this API always applies it.
 */
function prefersMinimal(c: Context<HonoEnv>): boolean {
    const header = c.req.header("Prefer");
    if (!header) return false;
    return header
        .split(",")
        .some((part) => part.trim().toLowerCase().replace(/\s*=\s*/, "=") === "return=minimal");
}

/** The `204` a minimal write answers with, saying that it honoured the ask. */
function minimalResponse(): Response {
    return new Response(null, {
        status: 204,
        headers: { "Preference-Applied": "return=minimal" }
    });
}

/**
 * What a minimal *bulk* answer carries: the ids, and nothing else.
 *
 * A 204 would be the symmetric answer and is the wrong one here. On a create
 * the id is the one thing the caller cannot compute — it is the server's to
 * assign — so a batch import that discarded them would have to re-read the
 * table by some natural key to find out what it just wrote, which is more work
 * than the rows it was trying not to receive.
 *
 * A single key comes back as the scalar; a composite key as an object of its
 * columns, because there is no correct way to flatten two columns into one
 * value that a caller could then use as an address.
 */
function rowIdentity(row: Record<string, unknown>, collection: CollectionConfig): unknown {
    const keys = resolvePrimaryKeys(collection).map(info => info.fieldName);
    if (keys.length === 0) return null;
    if (keys.length === 1) return row[keys[0]] ?? null;
    return Object.fromEntries(keys.map(key => [key, row[key] ?? null]));
}

/**
 * A live key presented on a different request than the one it was claimed for.
 *
 * Refused rather than replayed, because the replay is the dangerous answer: a
 * delete sent under the key of an earlier create used to be handed the create's
 * `200` and its rows, so the caller saw a success for rows that are still
 * there. A `422` names the mistake instead — the key is well-formed, the
 * request is not repeatable under it.
 */
function idempotencyKeyReused(key: string): ApiError {
    return new ApiError(
        422,
        "IDEMPOTENCY_KEY_REUSED",
        `Idempotency-Key '${key}' was already used for a different request. ` +
        "A key names one write: use a new key for each distinct request, and re-send " +
        "the identical request to replay its answer."
    );
}



/**
 * Lightweight REST API generator that leverages existing Rebase DataDriver.
 * Supports `include` query parameter for eager-loading relations via Drizzle.
 */
/** Rows accepted by a single POST /<collection>/bulk. See `maxBulkRows`. */
export const DEFAULT_MAX_BULK_ROWS = 1000;

export class RestApiGenerator {
    private collections: CollectionConfig[];
    private router: Hono<HonoEnv>;
    private driver: DataDriver;
    private maxBulkRows: number;
    private listLimits: ListLimitOptions;

    private authAdapter?: AuthAdapter;

    constructor(
        collections: CollectionConfig[],
        driver: DataDriver,
        authAdapter?: AuthAdapter,
        maxBulkRows: number = DEFAULT_MAX_BULK_ROWS,
        listLimits: ListLimitOptions = {}
    ) {
        this.collections = collections;
        this.driver = driver;
        this.authAdapter = authAdapter;
        this.maxBulkRows = maxBulkRows;
        this.listLimits = {
            defaultLimit: listLimits.defaultLimit ?? DEFAULT_LIST_LIMIT,
            maxLimit: listLimits.maxLimit ?? MAX_LIST_LIMIT
        };
        this.router = new Hono<HonoEnv>();
    }

    /**
     * Built on first use rather than in the constructor: it probes the driver
     * for SQL support and creates a table, and most requests never send a key.
     */
    private idempotencyStore?: IdempotencyStore | null;
    private idempotency(): IdempotencyStore | undefined {
        this.idempotencyStore ??= createIdempotencyStore(this.driver) ?? null;
        return this.idempotencyStore ?? undefined;
    }

    /**
     * Parse request query params into QueryOptions, applying this generator's
     * list-pagination bounds (default page size + hard max limit) so no read
     * path can be tricked into buffering an entire table into memory.
     */
    private parseQuery(
        queryDict: Record<string, unknown>,
        /**
         * The collection this query reads and the caller reading it, so a
         * `where`, `orderBy` or `fields` naming a field their roles cannot read
         * is refused here rather than answered. Optional only for the one route
         * that resolves its collection *after* parsing (see `_batch`).
         */
        access?: { collection: CollectionConfig; c: Context<HonoEnv> }
    ): QueryOptions {
        return parseQueryOptions(queryDict, this.listLimits, access && {
            collection: access.collection,
            viewer: requestViewer(access.c)
        });
    }



    /**
     * Generate REST routes using existing DataDriver
     */
    generateRoutes(): Hono<HonoEnv> {
        this.nameTheCollection();

        // Before the per-collection routes, so `_batch` can never be read as a
        // collection slug — the same ordering `/bulk` relies on one level down.
        this.createBatchRoute();

        this.collections.forEach(collection => {
            this.createCollectionRoutes(collection);
        });

        // Catch-all routes for subcollection paths like
        // /authors/111094/posts  and  /authors/111094/posts/43
        // The DataDriver already knows how to resolve nested relation paths.
        this.createSubcollectionRoutes();

        // Last, so it only ever sees what nothing above matched.
        this.createUnmatchedRoute();

        return this.router;
    }

    /**
     * `POST /api/data/_batch` — writes across collections, as one transaction.
     *
     * `/bulk` is one collection at a time, which is the wrong shape for the
     * writes that most need to be atomic: an order and its line items, a user
     * and their membership row, a document and its audit entry. Sent as
     * separate requests those half-succeed, and the recovery — read back, work
     * out which half landed, undo it — is code nobody writes and everybody
     * needs.
     *
     * Underscored so it cannot collide with a collection: a slug is a table
     * name and Postgres identifiers do not start with one, so `_batch` is a
     * name no `db push` can produce.
     *
     * Every operation is checked before the transaction opens — shape, unknown
     * collections, unknown fields, value constraints, field operations,
     * conflict targets, forward `$ref`s — because a batch is all-or-nothing and
     * finding a typo at operation 40 costs the rollback of the 39 writes before
     * it. Inside, each operation runs the pipeline its single-row route runs:
     * the same callbacks, the same row-level security, as the same role.
     */
    private createBatchRoute(): void {
        const bySlug = new Map(this.collections.map(collection => [collection.slug, collection]));
        const knownCollections = new Set(bySlug.keys());

        this.router.post("/_batch", async (c) => {
            const driver = this.getScopedDriver(c);
            const body = await parseJsonBody(c) as { operations?: unknown };

            const operations = parseBatchBody(body, {
                knownCollections,
                // The same cap as a bulk write, and for the same reason: one
                // batch is one transaction and holds its locks for the whole of
                // it, so an unbounded one is a self-inflicted outage.
                maxOperations: this.maxBulkRows
            });
            if (operations.length === 0) {
                return c.json({ data: [], meta: { operations: 0 } });
            }
            assertRefsResolvable(operations);

            if (!driver.batchWrite) {
                throw ApiError.badRequest(
                    "This backend's data driver does not support cross-collection batches. " +
                    "Send the writes as separate requests, or per-collection /bulk calls.",
                    "BATCH_UNSUPPORTED"
                );
            }

            // A permission per operation, against the collection that operation
            // names — not one check for the request. A key scoped to write
            // `orders` and nothing else must not be able to reach `users`
            // because the two travelled in one body.
            // One viewer for the whole body: a batch is one request from one
            // caller, whatever collections it names.
            const batchViewer = requestViewer(c);
            operations.forEach((operation, index) => {
                this.enforceApiKeyPermission(
                    { get: (key: string) => c.get(key as never), req: { method: operation.op === "delete" ? "DELETE" : "POST" } },
                    operation.collection,
                    operation.op === "delete" ? "delete" : "write"
                );
                const collection = bySlug.get(operation.collection)!;
                if (!operation.values) return;
                assertKnownWriteFields(operation.values, collection, { viewer: batchViewer });
                assertWriteValuesValid(operation.values, collection);
                if (operation.op === "update") {
                    assertFieldOpsValid(operation.values, collection, { operationIndex: index });
                } else {
                    // A create or an upsert may insert, so there is no stored
                    // value for an operation to act on.
                    assertNoFieldOpsOnCreate(operation.values, `Operation ${index}`);
                }
                if (operation.op === "upsert") {
                    operation.onConflict = resolveConflictTarget(
                        operation.onConflict,
                        collection,
                        { where: `Operation ${index}` }
                    );
                }
            });

            return this.runIdempotent(c, body, async () => {
                const written = await driver.batchWrite!({
                    operations: operations.map((operation: ParsedBatchOperation) => ({
                        op: operation.op,
                        path: getCollectionDataPath(bySlug.get(operation.collection)!),
                        id: operation.id,
                        values: operation.values,
                        collection: bySlug.get(operation.collection),
                        onConflict: operation.onConflict,
                        ref: operation.ref
                    }))
                });
                return {
                    data: written.map((row) => (row ? this.formatResponse(row) : null)),
                    meta: { operations: written.length }
                };
            }, (result) => {
                if (!prefersMinimal(c)) return c.json(result as never);
                const rows = ((result as { data?: unknown })?.data ?? []) as (Record<string, unknown> | null)[];
                c.header("Preference-Applied", "return=minimal");
                return c.json({
                    data: rows.map((row, index) =>
                        row ? rowIdentity(row, bySlug.get(operations[index].collection)!) : null),
                    meta: (result as { meta?: unknown })?.meta
                } as never);
            });
        });
    }

    /**
     * A 404 that says which row was not found, and names the other reason.
     *
     * "Entity not found" was the entire message on five routes. It does not say
     * which collection, which id, or — the part that costs the most time — that
     * a row can be perfectly present and invisible: authenticated requests run
     * as a restricted role, so a `SELECT` policy that excludes this caller
     * produces exactly this 404. Somebody checking whether the row exists finds
     * it in psql, concludes the API is broken, and goes looking in the wrong
     * place.
     *
     * The collection and the id are both in the URL the caller just sent, so
     * naming them back reveals nothing. `details` is withheld in production
     * anyway, on the same principle as the database diagnostics one layer up:
     * structured fields are for the people building against this, and a
     * deployed API answers strangers.
     */
    private entityNotFound(collection: string, id: string): ApiError {
        return new ApiError(
            404,
            "NOT_FOUND",
            `No row with id '${id}' in '${collection}'. It may not exist, ` +
            "or it may be hidden from this caller by row-level security.",
            hostEnv().NODE_ENV === "production" ? undefined : { collection, id }
        );
    }

    /**
     * Record which collection a request is about, before anything can fail.
     *
     * One middleware rather than a `c.set` in each of the fifteen handlers,
     * because the value has to be there for the ones that throw *before*
     * reaching a handler body — an API-key permission check, a query parser
     * refusing an operator — which is exactly the set of requests whose log
     * line is worth reading.
     *
     * The slug is validated against the collections this backend serves, so the
     * field is always a real collection and never whatever a caller typed. An
     * unknown slug leaves it unset; the path is still logged, and the
     * unmatched-route handler already says the collection does not exist.
     */
    private nameTheCollection(): void {
        const known = new Set(this.collections.map(collection => collection.slug));
        // A route param, not `c.req.path`: inside a mounted sub-app the latter
        // is still the FULL request path (`/api/data/posts`), so splitting it
        // yields `api`. `:maybeSlug` is matched relative to where this router
        // was mounted, which is the thing being asked for.
        const remember: MiddlewareHandler<HonoEnv> = async (c, next) => {
            const slug = c.req.param("maybeSlug");
            if (slug && known.has(slug)) c.set("collection", slug);
            await next();
        };
        this.router.use("/:maybeSlug", remember);
        this.router.use("/:maybeSlug/*", remember);
    }

    /**
     * Answer anything left under `/api/data` in the canonical error envelope.
     *
     * Without this, `GET /api/data/nonexistent` fell through to Hono's default
     * handler and came back as the plain text `404 Not Found` — the one error
     * on the data API that is not `{"error":{"message","code","requestId"}}`.
     * A client that does `res.json()` on the error path got a parse failure
     * where every other 4xx hands it a code, so a mistyped collection name
     * surfaced as "invalid JSON" rather than "no such collection".
     *
     * Registered after every real route, so a request reaches it only when the
     * slug is unknown *or* the method/sub-path is: those are different
     * mistakes, and the message says which. The collection list is deliberately
     * not enumerated — an unauthenticated request to this same URL is answered
     * 401 before routing, on purpose, and echoing the full set of slugs back
     * would undo that for any signed-in caller.
     *
     * Every answer here is `expected`, so it logs at debug (see
     * {@link ApiError.expected}). This path used to log *nothing at all* —
     * Hono's default 404 never reaches `errorHandler` — so routing it through
     * the handler at warn would have traded a missing error envelope for a
     * `⚠️` line on every request from any frontend holding a stale slug. The
     * envelope is the fix; the log volume is not part of it.
     */
    private createUnmatchedRoute(): void {
        const known = new Set(this.collections.map(collection => collection.slug));
        const notFound = (message: string): ApiError =>
            new ApiError(404, "NOT_FOUND", message, undefined, true);

        this.router.all("/:slug{.*}", (c) => {
            const slug = (c.req.param("slug") ?? "").split("/")[0];
            if (!slug) {
                throw notFound("No collection in the request path. Expected /api/data/<collection>.");
            }
            if (known.has(slug)) {
                throw notFound(`No ${c.req.method} route on collection '${slug}' at this path.`);
            }
            throw notFound(
                `Unknown collection '${slug}'. It is not defined in this backend, `
                + "or its route is not exposed."
            );
        });
    }

    /**
     * Check API key permissions for a collection operation.
     * Throws 403 if the key doesn't have the required permission.
     * No-ops if the request is not authenticated via an API key.
     */
    private enforceApiKeyPermission(
        c: { get: (key: string) => unknown; req: { method: string } },
        collectionSlug: string,
        /**
         * What this route actually does, when the verb does not say it.
         *
         * `POST /bulk/delete` is a POST for transport reasons the route's own
         * docblock explains — a body on DELETE is dropped by proxies and by
         * several OpenAPI generators. Deriving the operation from the method
         * therefore classified it `write`, and a key scoped `["read","write"]`
         * with `delete` deliberately withheld — the shape the docs recommend
         * for an agent — deleted every row it named and got a 200. The verb is
         * a transport detail; the permission is about intent, so the route
         * states it.
         */
        operationOverride?: ApiKeyOperation
    ): void {
        const apiKey = c.get("apiKey") as ApiKeyMasked | undefined;
        if (!apiKey) return; // Not an API key request — skip

        const operation = operationOverride ?? httpMethodToOperation(c.req.method);
        if (!isOperationAllowed(apiKey.permissions, collectionSlug, operation)) {
            throw ApiError.forbidden(
                `API key does not have "${operation}" permission for collection "${collectionSlug}"`,
                "API_KEY_FORBIDDEN"
            );
        }
    }

    /**
     * API key permission check for nested paths. The operation targets the
     * LAST collection in the path (e.g. "posts" for /authors/1/posts), so
     * that is the slug the key must hold permission for — checking the
     * parent instead would let a key scoped to "authors" write "posts".
     * `parseSubPath` always yields a collectionPath ending in a collection
     * slug, never an id.
     */
    private enforceSubcollectionApiKeyPermission(
        c: { get: (key: string) => unknown; req: { method: string } },
        collectionPath: string
    ): void {
        this.enforceApiKeyPermission(c, collectionPath.split("/").pop()!);
    }

    /**
     * The collection a nested path writes into — the target of the relation its
     * last segment names.
     *
     * Needed so a nested write can be checked against a schema at all. Without
     * it these routes skipped `assertKnownWriteFields` entirely, which is why a
     * typo `POST /posts` rejected with a 400 while the same typo on
     * `POST /authors/1/posts` was dropped from the statement and answered 201.
     *
     * Returns `undefined` rather than throwing when the path cannot be walked:
     * the driver raises the authoritative error a moment later, and duplicating
     * it here would report a resolution failure as a validation failure.
     */
    private resolveNestedWriteCollection(collectionPath: string): CollectionConfig | undefined {
        const segments = collectionPath.split("/").filter(s => s && s !== "undefined");
        let current = this.collections.find(c => c.slug === segments[0]);

        for (let i = 2; i < segments.length && current; i += 2) {
            const relation = findRelation(resolveCollectionRelations(current), segments[i]);
            if (!relation) return undefined;
            try {
                const target = relation.target();
                current = this.collections.find(c => c.slug === target?.slug) ?? target;
            } catch {
                return undefined;
            }
        }

        return current;
    }

    /**
     * `PATCH <collection>/<id>/<relation>/<targetId>` with a `_pivot` body: set
     * the columns that one many-to-many link carries.
     *
     * The membership array on the parent (`PATCH posts/1 { tags: [...] }`) sets
     * *which* links exist; this sets what one of them holds. They are separate
     * because the array cannot express a single-link edit without either
     * unlinking everything it omits or re-sending the whole set — and re-sending
     * the set to change one `role` is exactly the lost update that the
     * membership diff exists to avoid.
     *
     * Validated against the junction's own properties, through the same
     * `assertWriteRequestValid` a row's values go through: `required`, `enum`,
     * `min`/`max`/`matches` and per-field `access.write` mean the same thing on
     * a payload column as on a collection's, or the promise that they are
     * "declared exactly like collection properties" is not one.
     */
    private async updateRelationPivotFromBody(
        c: Context<HonoEnv>,
        driver: DataDriver,
        collectionPath: string,
        targetId: string,
        body: Record<string, unknown>
    ): Promise<Response> {
        const extras = Object.keys(body).filter(key => key !== JUNCTION_PIVOT_KEY);
        if (extras.length > 0) {
            throw ApiError.badRequest(
                `A \`${JUNCTION_PIVOT_KEY}\` write sets the link's own columns, so it cannot also carry ` +
                `${extras.map(k => `'${k}'`).join(", ")} — those belong to the row on the far side. ` +
                "Send them as a separate request to the same address without `_pivot`.",
                "VALIDATION_UNKNOWN_FIELDS",
                { fields: extras, path: collectionPath }
            );
        }

        const pivot = body[JUNCTION_PIVOT_KEY];
        if (!pivot || typeof pivot !== "object" || Array.isArray(pivot)) {
            throw ApiError.badRequest(
                `\`${JUNCTION_PIVOT_KEY}\` must be an object of the junction's columns.`,
                "VALIDATION_CONSTRAINT",
                { path: collectionPath }
            );
        }

        const junction = this.resolveJunctionCollection(collectionPath);
        if (!junction) {
            throw ApiError.badRequest(
                `'${collectionPath}' does not reach its target through a \`manyToMany\` that declares ` +
                "`through.properties`, so there is no link payload to write.",
                "RELATION_HAS_NO_PIVOT",
                { path: collectionPath }
            );
        }
        assertWriteRequestValid(pivot as Record<string, unknown>, junction, { viewer: requestViewer(c) });

        if (!driver.updateRelationPivot) {
            throw ApiError.badRequest(
                "This data source cannot write junction columns.",
                "RELATION_PIVOT_UNSUPPORTED",
                { path: collectionPath }
            );
        }

        await driver.updateRelationPivot({
            path: collectionPath,
            targetId,
            pivot: pivot as Record<string, unknown>
        });

        return new Response(null, { status: 204 });
    }

    /**
     * The synthetic collection standing in for the junction a nested path's last
     * hop reaches through, or `undefined` when that hop is not a `manyToMany`
     * carrying `through.properties`.
     *
     * Built from the relation rather than by walking every collection: the same
     * `getJunctionConfigForRelation` the schema planner and the driver use, so
     * the shape validated here is the shape the columns were emitted from.
     */
    private resolveJunctionCollection(collectionPath: string): CollectionConfig | undefined {
        const segments = collectionPath.split("/").filter(s => s && s !== "undefined");
        if (segments.length < 3) return undefined;

        let current = this.collections.find(c => c.slug === segments[0]);
        let relation: ResolvedRelation | undefined;

        for (let i = 2; i < segments.length && current; i += 2) {
            relation = findRelation(resolveCollectionRelations(current), segments[i]);
            if (!relation) return undefined;
            try {
                const target = relation.target();
                current = this.collections.find(c => c.slug === target?.slug) ?? target;
            } catch {
                return undefined;
            }
        }

        if (!relation || !isManyToMany(relation)) return undefined;
        if (Object.keys(relation.through.properties).length === 0) return undefined;
        return getJunctionConfigForRelation(relation.through);
    }

    /**
     * Get the request-scoped driver. Throws if none is set — never falls
     * back to the unscoped `this.driver` to avoid bypassing RLS/auth.
     */
    private getScopedDriver(c: { get: (key: string) => unknown }): DataDriver {
        const driver = c.get("driver") as DataDriver | undefined;
        if (!driver) throw ApiError.internal("Scoped driver not available");
        return driver;
    }



    /**
     * Run a write under an idempotency key.
     *
     * Every keyed route needs the identical claim-before-write dance — claim,
     * replay on a repeat, 409 while one is in flight, release on failure,
     * complete on success — and getting one of those steps wrong is exactly the
     * bug the key exists to prevent. Written once so they cannot drift into
     * different notions of "already done".
     *
     * It lived inside `createCollectionRoutes` and served the three bulk routes
     * only, which is why the single-row `PATCH` and `DELETE` ignored the header
     * the SDK has always sent them: the mechanism was one closure away from
     * them, and nothing said so. A method reaches every route, including the
     * cross-collection batch.
     *
     * `body` is what the key is claimed *for*: the same key on a different
     * request is a caller mistake, and replaying a create's answer to a delete
     * would report a deletion that never happened.
     *
     * `respond` is applied to the *stored* result rather than the stored result
     * being a response, so a replay honours the `Prefer` header of the request
     * replaying it rather than the one that first answered.
     */
    private async runIdempotent(
        c: Context<HonoEnv>,
        body: unknown,
        run: () => Promise<unknown>,
        respond: (body: unknown) => Response
    ): Promise<Response> {
        const idempotencyKey = c.req.header(IDEMPOTENCY_HEADER);
        const uid = (c.get("user") as { uid?: string } | undefined)?.uid;
        const store = this.idempotency();
        // Claimed before the write, not after: the two-step recall-then-write
        // let concurrent replays of one key both through.
        const claimed = idempotencyKey && store
            ? await store.claim(idempotencyKey, uid, await requestFingerprint(c.req.method, c.req.path, body))
            : undefined;
        if (claimed?.status === "replay") {
            return respond(claimed.response);
        }
        if (claimed?.status === "mismatch") {
            throw idempotencyKeyReused(idempotencyKey!);
        }
        if (claimed?.status === "in-flight") {
            throw ApiError.conflict(
                `A request with Idempotency-Key '${idempotencyKey}' is already in progress. ` +
                "Retry once it has answered; its result will be replayed.",
                "IDEMPOTENCY_KEY_IN_PROGRESS"
            );
        }

        let response: unknown;
        try {
            response = await run();
        } catch (error) {
            // Hand the key back, or one transient failure would refuse every
            // retry of it until the row aged out.
            if (claimed?.status === "claimed" && idempotencyKey && store) {
                await store.release(idempotencyKey, uid);
            }
            throw error;
        }

        if (claimed?.status === "claimed" && idempotencyKey && store) {
            await store.complete(idempotencyKey, uid, response);
        }
        return respond(response);
    }

    /**
     * The row as the read routes serve it, for hashing into an `ETag`.
     *
     * A tag derived from a version column is the same whichever read produced
     * the row, so nothing extra is fetched for it. The fallback hashes the row
     * itself, and there the *shape* matters: `GET /:id` serves the REST walk
     * while the write routes read through `driver.fetchOne` (the admin view
     * model), so hashing whichever one happened to be in hand would give the
     * same row two different tags and make every `If-Match` a coin toss.
     */
    private async rowForETag(
        driver: DataDriver,
        collection: CollectionConfig,
        id: string,
        alreadyRead: Record<string, unknown> | undefined
    ): Promise<Record<string, unknown> | undefined> {
        // A version column makes the tag independent of which read produced the
        // row, so the one already in hand is the right one and costs nothing.
        if (versionProperty(collection) && alreadyRead) return alreadyRead;
        const fetchService = driver.restFetchService;
        if (!fetchService) return alreadyRead;
        return await fetchService.fetchOneForRest(collection.slug, id) as Record<string, unknown> | undefined;
    }

    /**
     * Answer a bulk write, honouring `Prefer: return=minimal`.
     *
     * Minimal is a 200 carrying the ids rather than a 204 — see
     * {@link rowIdentity} for why a batch keeps them when a single write does
     * not. `meta.written` is unchanged either way, so a caller that only wants
     * the count never has to ask for the rows.
     */
    private respondBulk(
        c: Context<HonoEnv>,
        result: unknown,
        collection: CollectionConfig
    ): Response {
        if (!prefersMinimal(c)) return c.json(result as never);
        const rows = ((result as { data?: unknown })?.data ?? []) as Record<string, unknown>[];
        const meta = (result as { meta?: unknown })?.meta;
        c.header("Preference-Applied", "return=minimal");
        return c.json({
            data: rows.map((row) => rowIdentity(row, collection)),
            meta
        } as never);
    }

    /**
     * Create REST routes for a collection using existing Rebase patterns
     */
    private createCollectionRoutes(collection: CollectionConfig): void {
        const basePath = `/${collection.slug}`;
        const resolvedCollection = collection;

        // GET /collection/count - Count entities (with optional filters)
        this.router.get(`${basePath}/count`, async (c) => {
            this.enforceApiKeyPermission(c, collection.slug);
            const queryDict = c.req.queries();
            const queryOptions = this.parseQuery(queryDict, { collection: resolvedCollection, c });
            const searchString = Array.isArray(queryDict.searchString) ? queryDict.searchString[queryDict.searchString.length - 1] : undefined;
            const driver = this.getScopedDriver(c);

            const total = await this.countRawEntities(driver, resolvedCollection, queryOptions, searchString);
            return c.json({ count: total });
        });

        // GET /collection/aggregate - count/sum/avg/min/max, optionally grouped
        //
        // Beside `/count` and before `/:id`, or "aggregate" is read as an id
        // and the endpoint 404s for a row that was never asked for.
        this.router.get(`${basePath}/aggregate`, async (c) => {
            this.enforceApiKeyPermission(c, collection.slug);
            const queryDict = c.req.queries();
            const queryOptions = this.parseQuery(queryDict, { collection: resolvedCollection, c });
            const searchString = Array.isArray(queryDict.searchString) ? queryDict.searchString[queryDict.searchString.length - 1] : undefined;

            const aggregates = parseAggregateSelect(queryDict.select);
            if (!aggregates) {
                throw ApiError.badRequest(
                    "`select` is required, e.g. `?select=count()` or `?select=sum(total)&groupBy=status`.",
                    "MISSING_AGGREGATE_SELECT"
                );
            }

            const driver = this.getScopedDriver(c);
            const fetchService = driver.restFetchService;
            if (!fetchService?.aggregate) {
                // Every non-Postgres driver. A 501 naming the capability rather
                // than a 500 — and emphatically not an empty result set, which
                // reads as "nothing matched" and is the wrong thing to believe
                // about a dashboard.
                throw new ApiError(501, "AGGREGATE_NOT_SUPPORTED",
                    "Aggregates are not implemented for this backend's data driver.");
            }

            // `sum(salary)` and `groupBy=salary` read the column as surely as
            // selecting it does — an aggregate is the classic way to read a
            // value you cannot select, one bucket at a time. `parseQuery` above
            // has already judged `where`/`orderBy`; these two are parsed here,
            // so they are judged here.
            const groupBy = parseGroupBy(queryDict.groupBy);
            const viewer = requestViewer(c);
            assertReadableFields(aggregates.map(a => a.field), resolvedCollection, viewer, "select");
            assertReadableFields(groupBy ?? [], resolvedCollection, viewer, "groupBy");

            const data = await fetchService.aggregate(collection.slug, {
                aggregates,
                groupBy,
                filter: queryOptions.where,
                logical: queryOptions.logical,
                searchString,
                limit: queryOptions.limit,
                // Same reasoning as the listing and its count: an aggregate
                // that counts stamped rows disagrees with the page beside it.
                withDeleted: queryOptions.withDeleted
            });

            return c.json({ data });
        });

        // GET /collection - List entities
        this.router.get(basePath, async (c) => {
            this.enforceApiKeyPermission(c, collection.slug);
            const queryDict = c.req.queries();
            const queryOptions = this.parseQuery(queryDict, { collection: resolvedCollection, c });
            const searchString = Array.isArray(queryDict.searchString) ? queryDict.searchString[queryDict.searchString.length - 1] : undefined;
            // `?searchExplain=true` asks each row which declared field matched.
            // Opt-in per request because it costs a `ts_headline` per field per
            // row; any value other than "true" is a no.
            const searchExplainRaw = Array.isArray(queryDict.searchExplain) ? queryDict.searchExplain[queryDict.searchExplain.length - 1] : undefined;
            const searchExplain = searchExplainRaw === "true";

            const driver = this.getScopedDriver(c);
            const fetchService = driver.restFetchService;

            const page = await this.readPage(
                driver, resolvedCollection, queryOptions, searchString, searchExplain
            );

            return c.json({
                data: page.rows,
                meta: page.meta
            });
        });

        // GET /collection/:id - Get single entity
        this.router.get(`${basePath}/:id`, async (c) => {
            this.enforceApiKeyPermission(c, collection.slug);
            const id = c.req.param("id");
            const queryDict = c.req.queries();
            const queryOptions = this.parseQuery(queryDict, { collection: resolvedCollection, c });
            const driver = this.getScopedDriver(c);
            const fetchService = driver.restFetchService;

            // Use include-aware path when available. `fields` reaches the
            // driver as a projection here too — the same columns a list read
            // would select, so one row and a page of them cost the same per
            // row rather than the get route paying for every column.
            const entity = fetchService
                ? await fetchService.fetchOneForRest(
                    collection.slug, String(id), queryOptions.include, undefined,
                    { fields: queryOptions.fields, withDeleted: queryOptions.withDeleted }
                )
                : await this.fetchRawEntity(driver, resolvedCollection, String(id), queryOptions.withDeleted);

            if (!entity) {
                throw this.entityNotFound(collection.slug, String(id));
            }

            // The version this read saw, so the write that follows can name it
            // and be refused if the row has moved on. Computed from the whole
            // row, before `?fields=` narrows it: the tag identifies the row,
            // not the projection the caller asked for, and two clients reading
            // different columns of one row must agree about its version.
            const etag = await rowETag(entity as Record<string, unknown>, resolvedCollection);
            if (etag) c.header(ETAG_HEADER, etag);

            // One row, shaped exactly as this route's list shapes each of its
            // own. Kept as a `body` rather than returned inline so the response
            // stays easy to extend with headers a caller has to see.
            const body = projectResponseFields(
                [entity as Record<string, unknown>],
                queryOptions.fields,
                resolvedCollection,
                { include: topLevelIncludeNames(queryOptions.include) }
            )[0];

            return c.json(body);
        });

        /**
         * Validate the envelope every bulk route shares: an array, non-empty,
         * of objects, within the row cap.
         *
         * The cap is the load-bearing one. A batch is a single transaction that
         * holds its locks for its whole duration, so an unbounded one is a
         * self-inflicted outage — and the message names both the limit and the
         * actual count so the caller can chunk to it rather than guess.
         */
        const assertBulkShape = (
            items: unknown,
            field: string,
            requireObjects: boolean
        ): void => {
            if (!Array.isArray(items)) {
                throw ApiError.badRequest(
                    `Expected a JSON body of { ${field}: [...] }.`,
                    "INVALID_BULK_BODY"
                );
            }
            if (requireObjects && items.some((it) => typeof it !== "object" || it === null || Array.isArray(it))) {
                throw ApiError.badRequest(
                    `Every entry in \`${field}\` must be an object.`,
                    "INVALID_BULK_BODY"
                );
            }
            if (items.length > this.maxBulkRows) {
                throw ApiError.badRequest(
                    `Too many rows: ${items.length} exceeds the ${this.maxBulkRows}-row limit for a single bulk write. ` +
                    `Send it in chunks of ${this.maxBulkRows} or fewer.`,
                    "BULK_TOO_LARGE"
                );
            }
        };

        // POST /collection/bulk - Write many rows as one transaction.
        //
        // Registered before POST /collection/:id-shaped routes so "bulk" is never
        // read as an id.
        this.router.post(`${basePath}/bulk`, async (c) => {
            this.enforceApiKeyPermission(c, collection.slug);
            const driver = this.getScopedDriver(c);
            const path = collection.slug;

            const body = await parseJsonBody(c) as { rows?: unknown; upsert?: unknown; onConflict?: unknown };

            assertBulkShape(body?.rows, "rows", true);
            const rows = body.rows as Record<string, unknown>[];
            if (rows.length === 0) {
                return c.json({ data: [], meta: { written: 0 } });
            }
            if (body.upsert !== undefined && typeof body.upsert !== "boolean") {
                throw ApiError.badRequest("`upsert` must be a boolean.", "INVALID_BULK_BODY");
            }
            // Checked whether or not `upsert` is set, so naming a target and
            // forgetting the flag is an error rather than a silently ignored
            // field that turns a re-runnable import into a duplicating one.
            const onConflict = resolveConflictTarget(body.onConflict, resolvedCollection);
            if (onConflict && body.upsert !== true) {
                throw ApiError.badRequest(
                    "`onConflict` names where an upsert matches, but `upsert` is not set. " +
                    "Send `upsert: true`, or drop `onConflict`.",
                    "INVALID_BULK_BODY"
                );
            }
            if (!driver.saveMany) {
                throw ApiError.badRequest(
                    "This collection's data source does not support bulk writes.",
                    "BULK_UNSUPPORTED"
                );
            }

            // Checked before the transaction opens, and named by row index: a
            // batch is all-or-nothing, so one bad field in ten thousand rows
            // should not be found by rolling the other 9,999 back.
            rows.forEach((row, rowIndex) => {
                assertKnownWriteFields(row, resolvedCollection, { rowIndex, viewer: requestViewer(c) });
                assertWriteValuesValid(row, resolvedCollection, { rowIndex, status: "new" });
                // This route inserts (or upserts), and an operation over a
                // value that is not there yet has nothing to mean. Refused here
                // rather than in the driver so the message names the row.
                assertNoFieldOpsOnCreate(row, `Row ${rowIndex} of a bulk create`);
            });

            // A client that never sees the response cannot know whether the
            // batch committed, so it retries — and without a key the server
            // cannot tell that retry from a second genuine import. On a single
            // create that duplicates one row; here it duplicates the batch.
            return this.runIdempotent(c, body, async () => {
                const written = await driver.saveMany!({
                    path,
                    rows,
                    collection: resolvedCollection,
                    upsert: body.upsert === true,
                    onConflict
                });
                return {
                    data: written.map((row) => this.formatResponse(row)),
                    meta: { written: written.length }
                };
            }, (result) => this.respondBulk(c, result, resolvedCollection));
        });

        // PATCH /collection/bulk — update many rows as one transaction.
        //
        // Entries are `{ id, data }` rather than flat rows carrying their own
        // key: on a table keyed on a `sku` or a composite key, a flat row cannot
        // say whether a column is the address or a value to write. This mirrors
        // single-row `update(id, data)` and leaves nothing to infer.
        this.router.patch(`${basePath}/bulk`, async (c) => {
            this.enforceApiKeyPermission(c, collection.slug);
            const driver = this.getScopedDriver(c);
            const path = collection.slug;

            const body = await parseJsonBody(c) as { updates?: unknown };

            assertBulkShape(body?.updates, "updates", true);
            const updates = body.updates as { id?: unknown; data?: unknown }[];
            if (updates.length === 0) {
                return c.json({ data: [], meta: { written: 0 } });
            }
            if (!driver.updateMany) {
                throw ApiError.badRequest(
                    "This collection's data source does not support bulk updates.",
                    "BULK_UNSUPPORTED"
                );
            }

            updates.forEach((entry, rowIndex) => {
                if (entry.id === undefined || entry.id === null || entry.id === "") {
                    throw ApiError.badRequest(
                        `Entry ${rowIndex} of \`updates\` is missing \`id\`. ` +
                        "Each entry must be { id, data }.",
                        "INVALID_BULK_BODY"
                    );
                }
                if (typeof entry.data !== "object" || entry.data === null || Array.isArray(entry.data)) {
                    throw ApiError.badRequest(
                        `Entry ${rowIndex} of \`updates\` is missing \`data\`, or it is not an object.`,
                        "INVALID_BULK_BODY"
                    );
                }
                assertKnownWriteFields(entry.data as Record<string, unknown>, resolvedCollection, { rowIndex, viewer: requestViewer(c) });
                assertWriteValuesValid(entry.data as Record<string, unknown>, resolvedCollection, { rowIndex });
                assertFieldOpsValid(entry.data as Record<string, unknown>, resolvedCollection, { rowIndex });
            });

            return this.runIdempotent(c, body, async () => {
                const written = await driver.updateMany!({
                    path,
                    updates: updates.map((entry) => ({
                        id: entry.id as string | number,
                        values: entry.data as Record<string, unknown>
                    })),
                    collection: resolvedCollection
                });
                return {
                    data: written.map((row) => this.formatResponse(row)),
                    meta: { written: written.length }
                };
            }, (result) => this.respondBulk(c, result, resolvedCollection));
        });

        // POST /collection/bulk/delete — delete many rows as one transaction.
        //
        // A POST rather than `DELETE /bulk` with the ids in the body. That would
        // be the honest verb, and it is the one request shape the HTTP ecosystem
        // handles unreliably: bodies on DELETE are permitted but widely dropped
        // by proxies and CDNs, and several OpenAPI generators ignore
        // `requestBody` on a DELETE operation — so a generated client would send
        // the request with no ids at all, and "delete nothing" is the *good*
        // outcome of that bet. Registered before `/bulk` cannot shadow it because
        // the path is longer and more specific.
        this.router.post(`${basePath}/bulk/delete`, async (c) => {
            this.enforceApiKeyPermission(c, collection.slug, "delete");
            const driver = this.getScopedDriver(c);
            const path = collection.slug;

            const body = await parseJsonBody(c) as { ids?: unknown };

            assertBulkShape(body?.ids, "ids", false);
            const ids = body.ids as unknown[];
            if (ids.length === 0) {
                return c.json({ meta: { deleted: 0 } });
            }
            if (ids.some((id) => typeof id !== "string" && typeof id !== "number")) {
                throw ApiError.badRequest(
                    "Every entry in `ids` must be a string or a number.",
                    "INVALID_BULK_BODY"
                );
            }
            if (!driver.deleteMany) {
                throw ApiError.badRequest(
                    "This collection's data source does not support bulk deletes.",
                    "BULK_UNSUPPORTED"
                );
            }

            return this.runIdempotent(c, body, async () => {
                await driver.deleteMany!({
                    hard: parseHardDelete(c.req.query(HARD_DELETE_QUERY_PARAM)),
                    path,
                    ids: ids as (string | number)[],
                    collection: resolvedCollection
                });
                return { meta: { deleted: ids.length } };
            }, (result) => c.json(result as never));
        });

        // POST /collection - Create entity
        this.router.post(basePath, async (c) => {
            // Errors from here are deliberately not re-classified. This layer
            // cannot tell a constraint violation from an unreachable database, and
            // it used to call both `BAD_REQUEST` — a claim that the caller sent
            // something wrong and should not retry. The driver holds the SQLSTATE
            // and raises an `ApiError` for what is genuinely the request's fault;
            // anything still unclassified here is ours, and that is a 500.
            this.enforceApiKeyPermission(c, collection.slug);
            const driver = this.getScopedDriver(c);
            const path = collection.slug;


            const body = await parseJsonBody(c);

            // `?on_conflict=email` turns the create into an upsert on a natural
            // key. A query parameter rather than a body field because the body
            // is the row: mixing a directive into it would collide with a
            // column of the same name the day someone declares one.
            const onConflict = resolveConflictTarget(
                c.req.query("on_conflict"),
                resolvedCollection,
                { where: "`on_conflict`" }
            );

            const isAuth = collection.auth;
            const isAuthCollection = isAuth === true || (isAuth && typeof isAuth === "object" && isAuth.enabled === true);

            const collectionAuthConfig = typeof isAuth === "object" ? isAuth : undefined;

            // Auth signups carry credential fields (`password`, provider
            // bits) that the users collection does not declare as columns —
            // `prepareUserCreation` turns them into what the table has. The
            // adapter says which those are, so the body can still be checked
            // for everything else. Skipping the check outright (as this used
            // to) meant a typo on the users table was silently dropped and
            // answered 201, while the same typo on `posts` was a 400.
            if (!isAuthCollection) {
                assertKnownWriteFields(body, resolvedCollection, { viewer: requestViewer(c) });
                assertWriteValuesValid(body, resolvedCollection, { status: "new" });
                assertNoFieldOpsOnCreate(body, "A create");
            } else {
                const contract = this.authAdapter?.describeUserCreationContract?.(collectionAuthConfig);
                if (contract?.validate) {
                    assertKnownWriteFields(body, resolvedCollection, {
                        extraKnownFields: contract.extraFields,
                        viewer: requestViewer(c)
                    });
                    // Same condition as the key check above: with a custom
                    // `onCreateUser` the adapter owns the body's shape, so the
                    // collection's constraints do not describe what arrived.
                    assertWriteValuesValid(body, resolvedCollection);
                }
            }

            if (isAuthCollection && this.authAdapter?.prepareUserCreation) {
                const prepared = await this.authAdapter.prepareUserCreation(body, collectionAuthConfig);

                const entity = await driver.save({
                    path,
                    values: prepared.values,
                    collection: resolvedCollection,
                    status: "new"
                });

                const result = prepared.hookHandledEmail
                    ? { temporaryPassword: prepared.clearPassword,
invitationSent: prepared.invitationSent }
                    : this.authAdapter.finalizeUserCreation
                        ? await this.authAdapter.finalizeUserCreation(
                            // `driver.save` returns the flat row — the row IS the
                            // values. Reading `entity.values` here (an Entity-era
                            // leftover) handed the adapter `undefined`, whose
                            // `.email` threw inside the invite-email try block —
                            // reported as "email delivery failed", so no
                            // invitation was ever sent.
                            { id: entity.id as string,
values: entity as Record<string, unknown> },
                            prepared.clearPassword
                        )
                        : { invitationSent: false };

                const response = this.formatResponse(entity) as Record<string, unknown>;



                return c.json({
                    ...response,
                    invitationSent: result.invitationSent,
                    ...(result.temporaryPassword ? { temporaryPassword: result.temporaryPassword } : {}),
                    ...("emailDeliveryFailed" in result && result.emailDeliveryFailed ? { emailDeliveryFailed: true } : {})
                }, 201);
            }

            // Deliberately not applied to the auth-signup branch above: that
            // response can carry a temporary password, and handing it out
            // again on a replayed key is a credential disclosure the plain
            // data path has no equivalent of.
            return this.runIdempotent(c, body, async () => {
                const entity = await driver.save({
                    path,
                    values: body,
                    collection: resolvedCollection,
                    status: "new",
                    // An upsert only when a target was named. Left off, this is
                    // the plain insert it has always been, and a duplicate key
                    // still raises — which is the answer a create should give.
                    ...(onConflict ? { upsert: true, onConflict } : {})
                });
                return this.formatResponse(entity);
            }, (result) => prefersMinimal(c)
                ? minimalResponse()
                : c.json(result as never, 201));
        });

        // PATCH /collection/:id — partial update. PUT is mounted on the same
        // handler for compatibility; see the note on `updateEntity` below.
        const updateEntity = async (c: Context<HonoEnv>) => {
            // Errors from here are deliberately not re-classified. This layer
            // cannot tell a constraint violation from an unreachable database, and
            // it used to call both `BAD_REQUEST` — a claim that the caller sent
            // something wrong and should not retry. The driver holds the SQLSTATE
            // and raises an `ApiError` for what is genuinely the request's fault;
            // anything still unclassified here is ours, and that is a 500.
            this.enforceApiKeyPermission(c, collection.slug);
            const id = c.req.param("id");
            const driver = this.getScopedDriver(c);


            const body = await parseJsonBody(c);
            assertKnownWriteFields(body, resolvedCollection, { viewer: requestViewer(c) });
            assertWriteValuesValid(body, resolvedCollection);
            // `{ views: { $inc: 1 } }` and the rest. Validated here, against the
            // collection's own property types, so a `$push` on a number is a
            // 400 naming the field rather than a Postgres type error raised
            // from inside the driver's transaction.
            assertFieldOpsValid(body, resolvedCollection);

            // The SDK has sent `Idempotency-Key` on `update()` since the option
            // existed; this route read it off no request at all. A `PATCH` is
            // not naturally idempotent — the field operations above make it
            // emphatically not — so a retry after a lost ACK applied the edit
            // twice, and `$inc` twice is a number nobody asked for.
            //
            // The existence read is *inside* the claim, so a replay is answered
            // by the key rather than by re-reading. Outside it, a replay sent
            // after the row was deleted in the meantime would 404 for an edit
            // that had already committed — the same class of lie the delete
            // route below exists to stop. A 404 or a failed precondition throws,
            // which releases the key, so neither burns it.
            return this.runIdempotent(c, body, async () => {
                const existingEntity = await driver.fetchOne({
                    path: getCollectionDataPath(collection),
                    id: String(id),
                    collection: resolvedCollection
                });

                if (!existingEntity) {
                    throw this.entityNotFound(collection.slug, String(id));
                }

                const ifMatch = c.req.header(IF_MATCH_HEADER);
                if (ifMatch) {
                    await assertIfMatch(
                        ifMatch,
                        await this.rowForETag(driver, resolvedCollection, String(id), existingEntity),
                        resolvedCollection,
                        { collection: collection.slug, id: String(id) }
                    );
                }

                const entity = await driver.save({
                    path: getCollectionDataPath(collection),
                    id: String(id),
                    values: body,
                    collection: resolvedCollection,
                    status: "existing"
                });
                return this.formatResponse(entity);
            }, (result) => prefersMinimal(c)
                ? minimalResponse()
                : c.json(result as never));
        };

        /**
         * The verb that matches what this actually does.
         *
         * The handler merges: it writes the columns in the body and leaves the
         * rest alone, which is what the SDK's `update(id, data: Partial<M>)`
         * sends. PUT was the only route, and PUT means replace — so the
         * generated OpenAPI spec described a full replacement while the server
         * performed a merge, and it reused the *create* input schema for it,
         * `required` fields and all. A client generated from that spec was
         * given a contract the server does not implement, and a spec-validating
         * gateway in front of this API would reject partial updates the server
         * would have accepted.
         *
         * PUT is mounted on the same handler, and is **not** in the generated
         * spec: the contract is PATCH, and a client generated from the spec can
         * only ever send it. The alias exists because dropping it was shipped
         * ahead of the clients that needed it — every published SDK up to and
         * including 0.16.0 sends PUT from `collection.update()`, so a control
         * plane that had already dropped the alias answered `rebase cloud
         * stop | start | restart` with a 404 naming the caller's own collection.
         * A verb removal is only safe once the oldest client in the field speaks
         * the new one.
         *
         * Delete it when no released SDK sends PUT any more — i.e. one release
         * after the first published client whose `update()` sends PATCH, giving
         * the field a version to move to.
         *
         * `Deprecation: true` is RFC 8594's signal, and how a caller finds out
         * before that happens. No `Sunset` date: the removal is gated on which
         * SDKs are in the field rather than on a calendar, and inventing a date
         * we would not honour is worse than saying only what is true. Set inline
         * rather than through a wrapper — a wrapper has to name the handler's
         * return type, and Hono's is worth neither widening nor casting for one
         * header at two call sites.
         */
        this.router.patch(`${basePath}/:id`, updateEntity);
        this.router.put(`${basePath}/:id`, (c) => {
            c.header("Deprecation", "true");
            return updateEntity(c);
        });

        // DELETE /collection/:id - Delete entity
        this.router.delete(`${basePath}/:id`, async (c) => {
            this.enforceApiKeyPermission(c, collection.slug);
            const id = c.req.param("id");
            const driver = this.getScopedDriver(c);


            // The header the SDK sends and this route ignored.
            //
            // The existence read is inside the claim, and on this route that is
            // the entire mechanism: a delete replayed after the first attempt
            // committed finds the row gone and answers 404 — which an offline
            // queue reads as a permanent failure, and reports to the user as an
            // error, for a delete that in fact succeeded. Under a key the
            // replay is answered from the key and the row is never read again.
            return this.runIdempotent(c, { id: String(id) }, async () => {
                const existingEntity = await driver.fetchOne({
                    path: getCollectionDataPath(collection),
                    id: String(id),
                    collection: resolvedCollection
                });

                if (!existingEntity) {
                    throw this.entityNotFound(collection.slug, String(id));
                }

                const ifMatch = c.req.header(IF_MATCH_HEADER);
                if (ifMatch) {
                    // A conditional delete is the one that matters most:
                    // "remove the row I read" is a different instruction from
                    // "remove whatever is there now", and only the first is
                    // safe once somebody else has edited it in between.
                    await assertIfMatch(
                        ifMatch,
                        await this.rowForETag(driver, resolvedCollection, String(id), existingEntity),
                        resolvedCollection,
                        { collection: collection.slug, id: String(id) }
                    );
                }

                await driver.delete({
                    // `?hard=true` — a real DELETE on a soft-delete collection. Same
                    // permission as the delete it replaces; see `soft-delete-params.ts`.
                    hard: parseHardDelete(c.req.query(HARD_DELETE_QUERY_PARAM)),
                    row: {
                        // The address is the one in the URL, not something read
                        // back off the row: a row is only its columns, so
                        // `existingEntity.id` is undefined for any table not
                        // keyed on `id` — and the delete went looking for a row
                        // called "undefined".
                        id: String(id),
                        path: getCollectionDataPath(collection),
                        values: existingEntity
                    },
                    collection: resolvedCollection
                });
                return null;
            }, () => new Response(null, { status: 204 }));
        });
    }

    /**
     * Catch-all routes for subcollection paths.
     *
     * Matches URL patterns like:
     *   GET    /authors/111094/posts          → list child collection
     *   GET    /authors/111094/posts/43       → get child entity
     *   POST   /authors/111094/posts          → create child entity
     *   PUT    /authors/111094/posts/43       → update child entity
     *   DELETE /authors/111094/posts/43       → delete child entity
     *
     * The `:rest{.+}` regex param captures the full remainder of the URL
     * path (Hono v4 `*` wildcard does not populate `c.req.param("*")`).
     * We split it into segments and reconstruct the `collectionPath`
     * (e.g. "authors/111094/posts") and optional `id` (e.g. "43").
     *
     * The DataDriver.save / fetchCollection / etc. already know how to
     * resolve multi-segment relation paths, so we just forward to them.
     */
    private createSubcollectionRoutes(): void {
        // Reserved path segments that should NOT be treated as relation names.
        // These are handled by dedicated route handlers (e.g., history routes)
        // mounted on the same data router.
        const RESERVED_SEGMENTS = new Set(["history"]);

        // Helper: parse a path like "authors/111094/posts/43" into
        // { collectionPath: "authors/111094/posts", id: "43" }
        // or "authors/111094/posts" into
        // { collectionPath: "authors/111094/posts", id: undefined }
        const parseSubPath = (rawPath: string): { collectionPath: string; id?: string } | null => {
            const segments = rawPath.split("/").filter(Boolean);
            // A literal "undefined" segment is a client that interpolated a
            // variable it did not have. The whole-`rest` case is already refused
            // by the route guards above; this used to *drop* the segment, so
            // `/authors/123/undefined/posts` was quietly answered with the
            // contents of `/authors/123/posts`. Serving a path nobody asked for
            // is worse than refusing the one they did: the caller gets rows,
            // concludes the address it built was right, and the bug ships.
            if (segments.some(s => s === "undefined")) return null;
            // Need at least 3 segments for a subcollection path (parent/id/child)
            if (segments.length < 3) return null;

            // If any segment is a reserved path (e.g. "history"), this is not a
            // subcollection route — let it fall through to other handlers.
            if (segments.some(s => RESERVED_SEGMENTS.has(s))) return null;

            // Odd segment count → collection path (parent/id/child or parent/id/child/id2/grandchild)
            // Even segment count → entity path   (parent/id/child/id)
            if (segments.length % 2 === 1) {
                return { collectionPath: segments.join("/") };
            } else {
                const id = segments.pop()!;
                return { collectionPath: segments.join("/"),
id };
            }
        };

        // GET /<subcollection-path> — list or get single entity
        // Use :rest{.+} instead of * because Hono v4's wildcard doesn't
        // capture into c.req.param("*") — it always returns undefined.
        this.router.get("/:parent/:parentId/:rest{.+}", async (c, next) => {
            const rest = c.req.param("rest");
            if (!rest || rest === "undefined") return next();
            const rawPath = `${c.req.param("parent")}/${c.req.param("parentId")}/${rest}`;
            const parsed = parseSubPath(rawPath);
            if (!parsed) return next();

            const driver = this.getScopedDriver(c);

            this.enforceSubcollectionApiKeyPermission(c, parsed.collectionPath);

            // Resolved before the query is parsed, not after: the field-access
            // refusal is part of parsing, and the branch below already needed
            // this collection to narrow its response.
            const nestedCollection = this.resolveNestedWriteCollection(parsed.collectionPath);
            const nestedAccess = nestedCollection ? { collection: nestedCollection, c } : undefined;

            if (parsed.id === "count") {
                // GET /parent/:parentId/child/count — count child entities
                const queryDict = c.req.queries();
                const queryOptions = this.parseQuery(queryDict, nestedAccess);
                const searchString = Array.isArray(queryDict.searchString) ? queryDict.searchString[queryDict.searchString.length - 1] : undefined;

                const total = driver.count ? await driver.count({
                    path: parsed.collectionPath,
                    filter: queryOptions.where,
                    // The two sibling counts in this file forward the group and
                    // this one did not, so a nested `/count?or=(…)` answered
                    // with the unnarrowed total beside a narrowed list.
                    logical: queryOptions.logical,
                    searchString,
                    vectorSearch: queryOptions.vectorSearch
                }) : 0;

                return c.json({ count: total });
            } else if (parsed.id) {
                // GET /parent/:parentId/child/:id — single entity
                const queryOptions = this.parseQuery(c.req.queries(), nestedAccess);
                const fetchService = driver.restFetchService;
                const entity = fetchService
                    ? await fetchService.fetchOneForRest(
                        parsed.collectionPath, parsed.id, queryOptions.include, undefined,
                        { fields: queryOptions.fields, withDeleted: queryOptions.withDeleted }
                    )
                    : await driver.fetchOne({ path: parsed.collectionPath,
id: parsed.id });
                if (!entity) throw this.entityNotFound(parsed.collectionPath, parsed.id);

                // `?fields=` is advertised on this endpoint too. It reached
                // `queryOptions` and was read by nothing here, so a
                // subcollection read returned every column while the root read
                // narrowed — the same defect `projectResponseFields` exists to
                // fix, surviving on the route family it was never wired into.
                if (!nestedCollection) return c.json(entity);
                return c.json(projectResponseFields(
                    [entity as Record<string, unknown>],
                    queryOptions.fields,
                    nestedCollection,
                    { include: topLevelIncludeNames(queryOptions.include) }
                )[0]);
            } else {
                // GET /parent/:parentId/child — list entities.
                //
                // Literally the same call the root list route makes, through
                // the same `readPage`. A child listing used to be served by a
                // second, thinner pipeline that accepted these options and
                // applied only `limit` — so `offset`, `orderBy` and `include`
                // were dropped without a word, and `total` counted rows the
                // filter would have excluded. Rewriting it to match was not
                // enough: every parameter added afterwards had to be remembered
                // in two places, and this is the copy that kept being missed.
                const queryDict = c.req.queries();
                const queryOptions = this.parseQuery(queryDict, nestedAccess);
                const searchString = Array.isArray(queryDict.searchString) ? queryDict.searchString[queryDict.searchString.length - 1] : undefined;
                const searchExplainRaw = Array.isArray(queryDict.searchExplain) ? queryDict.searchExplain[queryDict.searchExplain.length - 1] : undefined;

                const page = await this.readPage(
                    driver,
                    // The collection hoisted above, not a second lookup of the
                    // same path: one resolve, so the access check and the read
                    // are answered about the same collection.
                    nestedCollection ?? ({ slug: parsed.collectionPath } as CollectionConfig),
                    queryOptions,
                    searchString,
                    searchExplainRaw === "true",
                    parsed.collectionPath
                );

                return c.json({
                    data: page.rows,
                    meta: page.meta
                });
            }
        });

        // POST /<subcollection-path> — create entity
        this.router.post("/:parent/:parentId/:rest{.+}", async (c, next) => {
            const rest = c.req.param("rest");
            if (!rest || rest === "undefined") return next();
            const rawPath = `${c.req.param("parent")}/${c.req.param("parentId")}/${rest}`;
            const parsed = parseSubPath(rawPath);
            if (!parsed || parsed.id) return next();

            const driver = this.getScopedDriver(c);


            this.enforceSubcollectionApiKeyPermission(c, parsed.collectionPath);
            const body = await parseJsonBody(c);

            const targetCollection = this.resolveNestedWriteCollection(parsed.collectionPath);
            if (targetCollection) {
                assertKnownWriteFields(body, targetCollection, { viewer: requestViewer(c) });
                assertWriteValuesValid(body, targetCollection, { status: "new" });
            }

            const entity = await driver.save({
                path: parsed.collectionPath,
                values: body,
                status: "new"
            });

            const response = this.formatResponse(entity);



            return c.json(response, 201);
        });

        // PATCH /<subcollection-path>/:id — update entity. PUT is mounted on the
        // same handler for compatibility; see `updateEntity` above for why both.
        const updateNested = async (c: Context<HonoEnv>, next: () => Promise<void>) => {
            const rest = c.req.param("rest");
            if (!rest || rest === "undefined") return next();
            const rawPath = `${c.req.param("parent")}/${c.req.param("parentId")}/${rest}`;
            const parsed = parseSubPath(rawPath);
            if (!parsed || !parsed.id) return next();

            const driver = this.getScopedDriver(c);


            this.enforceSubcollectionApiKeyPermission(c, parsed.collectionPath);

            const body = await parseJsonBody(c);

            // ── The link's own columns ───────────────────────────────────────
            // `PATCH <c>/<id>/<relation>/<targetId>` with a `_pivot` body edits
            // the many-to-many *link*, not the row on the far side. The same URL
            // with the target's own columns still edits the target: the two are
            // told apart by the key, which is why `_pivot` is reserved and why
            // no property may be called that.
            //
            // They are also mutually exclusive. A body carrying both is a
            // request to do two different writes at one address, and guessing an
            // order for them is how one of the two silently does not happen.
            if (JUNCTION_PIVOT_KEY in body) {
                return this.updateRelationPivotFromBody(c, driver, parsed.collectionPath, parsed.id, body);
            }

            const targetCollection = this.resolveNestedWriteCollection(parsed.collectionPath);
            if (targetCollection) {
                assertKnownWriteFields(body, targetCollection, { viewer: requestViewer(c) });
                assertWriteValuesValid(body, targetCollection);
            }

            const entity = await driver.save({
                path: parsed.collectionPath,
                id: parsed.id,
                values: body,
                status: "existing"
            });

            const response = this.formatResponse(entity);



            return c.json(response);
        };

        this.router.patch("/:parent/:parentId/:rest{.+}", updateNested);
        // The same alias, for the same reason — see the note on `updateEntity`.
        this.router.put("/:parent/:parentId/:rest{.+}", (c, next) => {
            c.header("Deprecation", "true");
            return updateNested(c, next);
        });

        // DELETE /<subcollection-path>/:id — delete entity
        this.router.delete("/:parent/:parentId/:rest{.+}", async (c, next) => {
            const rest = c.req.param("rest");
            if (!rest || rest === "undefined") return next();
            const rawPath = `${c.req.param("parent")}/${c.req.param("parentId")}/${rest}`;
            const parsed = parseSubPath(rawPath);
            if (!parsed || !parsed.id) return next();

            const driver = this.getScopedDriver(c);


            this.enforceSubcollectionApiKeyPermission(c, parsed.collectionPath);

            const existingEntity = await driver.fetchOne({
                path: parsed.collectionPath,
                id: parsed.id
            });

            if (!existingEntity) throw this.entityNotFound(parsed.collectionPath, parsed.id);

            await driver.delete({
                // `?hard=true` — a real DELETE on a soft-delete collection. Same
                // permission as the delete it replaces; see `soft-delete-params.ts`.
                hard: parseHardDelete(c.req.query(HARD_DELETE_QUERY_PARAM)),
                row: {
                    // The address from the path, for the same reason as the
                    // collection-level delete above: a row carries no id.
                    id: parsed.id,
                    path: parsed.collectionPath,
                    values: existingEntity
                }
            });



            return new Response(null, { status: 204 });
        });
    }

    /**
     * Format successful API response
     */
    private formatResponse<T>(data: T, meta?: Record<string, unknown>): unknown {
        if (meta) {
            return {
                data,
                meta
            };
        }
        return data;
    }



    /**
     * One page of a listing: the rows, and the `meta` that describes them.
     *
     * Written once because it was written twice — the root listing and the
     * nested one each built their own `meta`, from their own idea of what
     * `hasMore` meant, over reads assembled from slightly different option
     * lists. Anything added to one (a cursor, a distinct read, an `include`
     * that now nests) had to be remembered in the other, and the nested route
     * is the one that kept being forgotten.
     *
     * @param collectionPath the path to read — a nested listing passes its own
     *   `parent/:id/child` path, which the driver resolves.
     */
    private async readPage(
        driver: DataDriver,
        collection: CollectionConfig,
        queryOptions: QueryOptions,
        searchString?: string,
        searchExplain?: boolean,
        collectionPath?: string
    ): Promise<{ rows: Record<string, unknown>[]; meta: Record<string, unknown> }> {
        const path = collectionPath ?? collection.slug;
        const orderBy = orderByEntriesToTuples(queryOptions.orderBy);
        const startAfter = queryOptions.cursor ? cursorToStartAfter(queryOptions.cursor) : undefined;
        const seeking = startAfter !== undefined;

        // One row past the page when seeking. `hasMore` on an offset page is
        // `offset + rows.length < total`, and under a cursor that arithmetic is
        // simply false: every seeked page runs at offset 0, so it compares one
        // page against the whole collection and says "more" forever.
        const limit = queryOptions.limit;
        const probeLimit = (seeking && limit !== undefined) ? limit + 1 : limit;

        const fetchService = driver.restFetchService;
        const fetched = fetchService
            ? await fetchService.fetchCollectionForRest(
                path,
                {
                    filter: queryOptions.where,
                    // `?or=`/`?and=` were parsed and then dropped right here,
                    // so a filtered read returned every row RLS allowed.
                    logical: queryOptions.logical,
                    limit: probeLimit,
                    // A cursor and an offset describe the same window two
                    // incompatible ways. The parser refuses both together, so
                    // reaching here with a cursor means there is no offset.
                    offset: seeking ? undefined : queryOptions.offset,
                    startAfter,
                    orderBy,
                    searchString,
                    searchExplain,
                    vectorSearch: queryOptions.vectorSearch,
                    fields: queryOptions.fields,
                    distinct: queryOptions.distinct,
                    // `?deleted=include|only`. Unset hides soft-deleted rows.
                    // The root list route used to pass this itself; every
                    // listing goes through here now, the nested one included,
                    // and `countRawEntities` below reads the same flag — a
                    // listing that hides four rows beside a total that counts
                    // them is a page saying "1 of 5".
                    withDeleted: queryOptions.withDeleted
                },
                queryOptions.include
            )
            : await this.fetchRawCollection(
                driver, collection, { ...queryOptions, limit: probeLimit }, searchString, searchExplain, path, startAfter
            );

        // The probe row is evidence, not data — it is never served.
        const entities = (seeking && limit !== undefined)
            ? (fetched as Record<string, unknown>[]).slice(0, limit)
            : fetched as Record<string, unknown>[];

        const total = await this.countRawEntities(driver, collection, queryOptions, searchString, path);

        const rows = projectResponseFields(
            entities,
            queryOptions.fields,
            collection,
            { include: topLevelIncludeNames(queryOptions.include) }
        );

        const offset = queryOptions.offset ?? 0;
        const hasMore = seeking
            ? (fetched as unknown[]).length > (limit ?? 0)
            : offset + entities.length < total;

        // The cursor for the *next* page, from the last row served. Issued by
        // the driver, which is the only layer that knows which columns address
        // a row; absent where none can describe the page — an ordering with no
        // stored value to seek on, such as relevance — and the caller then
        // pages by offset, exactly as it did before cursors existed.
        const last = entities[entities.length - 1];
        const nextCursor = (hasMore && last && fetchService?.cursorFor)
            ? fetchService.cursorFor(path, last, orderBy)
            : undefined;

        return {
            rows,
            meta: {
                total,
                limit: queryOptions.limit,
                offset: queryOptions.offset,
                hasMore,
                ...(nextCursor && { nextCursor })
            }
        };
    }

    /**
     * Fetch raw collection data without Entity wrapper (fallback for non-Postgres)
     */
    private async fetchRawCollection(
        driver: DataDriver,
        collection: CollectionConfig,
        queryOptions: QueryOptions,
        searchString?: string,
        searchExplain?: boolean,
        collectionPath?: string,
        startAfter?: Record<string, unknown>
    ) {
        const entities = await driver.fetchCollection({
            path: collectionPath ?? getCollectionDataPath(collection),
            collection,
            filter: queryOptions.where,
            include: queryOptions.include,
            fields: queryOptions.fields,
            distinct: queryOptions.distinct,
            startAfter,
            // The fallback every driver without a `restFetchService` uses —
            // mongo, firebase, anything a developer registers. It dropped the
            // group exactly as the Postgres path did.
            logical: queryOptions.logical,
            limit: queryOptions.limit,
            // The whole sort, not just its first key: forwarding
            // `orderBy[0].field` alone silently dropped every tie-breaker on
            // the driver-agnostic path, so a two-key sort asked for over HTTP
            // came back ordered by one of them.
            orderBy: orderByEntriesToTuples(queryOptions.orderBy),
            // `?offset=` is a row count. It used to be stringified into
            // `startAfter`, which is a cursor *row* — so the driver was handed
            // "20" where it expected a keyset value and the offset it does
            // understand never arrived. Every page served page one, while the
            // `meta` block this route returns reported the offset that was
            // asked for and computed `hasMore` from it. The same mistake was
            // fixed on the client; this is the server half.
            offset: queryOptions.offset,
            searchString,
            searchExplain,
            vectorSearch: queryOptions.vectorSearch,
            // `?deleted=include|only`, on the driver-agnostic path too. A
            // driver that does not soft-delete ignores it.
            withDeleted: queryOptions.withDeleted
        });

        return entities;
    }

    /**
     * Count raw entities for a collection
     */
    private async countRawEntities(
        driver: DataDriver,
        collection: CollectionConfig,
        queryOptions: QueryOptions,
        searchString?: string,
        collectionPath?: string
    ): Promise<number> {
        return driver.count ? await driver.count({
            path: collectionPath ?? getCollectionDataPath(collection),
            collection,
            filter: queryOptions.where,
            // Counted as well as fetched, or `total` describes a different set
            // of rows from the one that was served. `vectorSearch` was the
            // parameter still missing from that list: its `threshold` drops
            // rows on the fetch path, so a similarity-filtered listing reported
            // the size of the plain-filtered set and `hasMore` stayed true
            // across pages that came back empty.
            logical: queryOptions.logical,
            searchString,
            vectorSearch: queryOptions.vectorSearch,
            // Same reasoning again, for soft delete: a listing that hides four
            // rows and a total that counts them is a page saying "1 of 5".
            withDeleted: queryOptions.withDeleted
        }) : 0;
    }

    /**
     * Fetch single entity raw data without Entity wrapper (fallback)
     */
    private async fetchRawEntity(driver: DataDriver, collection: CollectionConfig, id: string, withDeleted?: boolean | "only") {
        const entity = await driver.fetchOne({
            path: getCollectionDataPath(collection),
            id,
            collection,
            withDeleted
        });

        return entity ?? null;
    }


}
