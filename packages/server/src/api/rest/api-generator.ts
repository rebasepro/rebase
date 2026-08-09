import { Hono, type Context } from "hono";
import { AuthAdapter, DataDriver, CollectionConfig, getCollectionDataPath } from "@rebasepro/types";
import { QueryOptions, HonoEnv } from "../types";
import { ApiError } from "../errors";
import { parseQueryOptions, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, type ListLimitOptions } from "./query-parser";
import { assertKnownWriteFields, assertWriteValuesValid, projectResponseFields } from "./write-validation";
import { httpMethodToOperation, isOperationAllowed } from "../../auth/api-keys/api-key-permission-guard";
import type { ApiKeyOperation } from "../../auth/api-keys/api-key-permission-guard";
import type { ApiKeyMasked } from "../../auth/api-keys/api-key-types";
import { findRelation, resolveCollectionRelations } from "@rebasepro/common";
import {
    createIdempotencyStore,
    IDEMPOTENCY_HEADER,
    requestFingerprint,
    type IdempotencyStore
} from "./idempotency";

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
    private parseQuery(queryDict: Record<string, unknown>): QueryOptions {
        return parseQueryOptions(queryDict, this.listLimits);
    }



    /**
     * Generate REST routes using existing DataDriver
     */
    generateRoutes(): Hono<HonoEnv> {
        this.collections.forEach(collection => {
            this.createCollectionRoutes(collection);
        });

        // Catch-all routes for subcollection paths like
        // /authors/111094/posts  and  /authors/111094/posts/43
        // The DataDriver already knows how to resolve nested relation paths.
        this.createSubcollectionRoutes();

        return this.router;
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
     * Get the request-scoped driver. Throws if none is set — never falls
     * back to the unscoped `this.driver` to avoid bypassing RLS/auth.
     */
    private getScopedDriver(c: { get: (key: string) => unknown }): DataDriver {
        const driver = c.get("driver") as DataDriver | undefined;
        if (!driver) throw ApiError.internal("Scoped driver not available");
        return driver;
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
            const queryOptions = this.parseQuery(queryDict);
            const searchString = Array.isArray(queryDict.searchString) ? queryDict.searchString[queryDict.searchString.length - 1] : undefined;
            const driver = this.getScopedDriver(c);

            const total = await this.countRawEntities(driver, resolvedCollection, queryOptions, searchString);
            return c.json({ count: total });
        });

        // GET /collection - List entities
        this.router.get(basePath, async (c) => {
            this.enforceApiKeyPermission(c, collection.slug);
            const queryDict = c.req.queries();
            const queryOptions = this.parseQuery(queryDict);
            const searchString = Array.isArray(queryDict.searchString) ? queryDict.searchString[queryDict.searchString.length - 1] : undefined;
            // `?searchExplain=true` asks each row which declared field matched.
            // Opt-in per request because it costs a `ts_headline` per field per
            // row; any value other than "true" is a no.
            const searchExplainRaw = Array.isArray(queryDict.searchExplain) ? queryDict.searchExplain[queryDict.searchExplain.length - 1] : undefined;
            const searchExplain = searchExplainRaw === "true";

            const driver = this.getScopedDriver(c);
            const fetchService = driver.restFetchService;

            // Use include-aware path when available
            const entities = fetchService
                ? await fetchService.fetchCollectionForRest(
                    collection.slug,
                    {
                        filter: queryOptions.where,
                        // `?or=`/`?and=` were parsed and then dropped right here,
                        // so a filtered read returned every row RLS allowed.
                        logical: queryOptions.logical,
                        limit: queryOptions.limit,
                        offset: queryOptions.offset,
                        orderBy: queryOptions.orderBy?.[0]?.field,
                        order: queryOptions.orderBy?.[0]?.direction === "desc" ? "desc" : "asc",
                        searchString,
                        searchExplain,
                        vectorSearch: queryOptions.vectorSearch
                    },
                    queryOptions.include
                )
                : await this.fetchRawCollection(driver, resolvedCollection, queryOptions, searchString);

            const total = await this.countRawEntities(driver, resolvedCollection, queryOptions, searchString);

            return c.json({
                data: projectResponseFields(
                    entities as Record<string, unknown>[],
                    queryOptions.fields,
                    resolvedCollection,
                    { include: queryOptions.include }
                ),
                meta: {
                    total,
                    limit: queryOptions.limit,
                    offset: queryOptions.offset,
                    hasMore: (queryOptions.offset || 0) + entities.length < total
                }
            });
        });

        // GET /collection/:id - Get single entity
        this.router.get(`${basePath}/:id`, async (c) => {
            this.enforceApiKeyPermission(c, collection.slug);
            const id = c.req.param("id");
            const queryDict = c.req.queries();
            const queryOptions = this.parseQuery(queryDict);
            const driver = this.getScopedDriver(c);
            const fetchService = driver.restFetchService;

            // Use include-aware path when available
            const entity = fetchService
                ? await fetchService.fetchOneForRest(collection.slug, String(id), queryOptions.include)
                : await this.fetchRawEntity(driver, resolvedCollection, String(id));

            if (!entity) {
                throw ApiError.notFound("Entity not found");
            }

            return c.json(projectResponseFields(
                [entity as Record<string, unknown>],
                queryOptions.fields,
                resolvedCollection,
                { include: queryOptions.include }
            )[0]);
        });

        /**
         * Run a bulk handler under an idempotency key.
         *
         * All three bulk routes need the identical claim-before-write dance —
         * claim, replay on a repeat, 409 while one is in flight, release on
         * failure, complete on success — and getting one of those steps wrong
         * is exactly the bug the key exists to prevent. Written once so the
         * three cannot drift into three different notions of "already done".
         *
         * `body` is what the key is claimed *for*: the same key on a different
         * request is a caller mistake, and replaying a create's answer to a
         * delete would report a deletion that never happened.
         */
        const withIdempotency = async (
            c: Context<HonoEnv>,
            body: unknown,
            run: () => Promise<unknown>,
            respond: (body: unknown) => Response
        ): Promise<Response> => {
            const idempotencyKey = c.req.header(IDEMPOTENCY_HEADER);
            const uid = (c.get("user") as { uid?: string } | undefined)?.uid;
            const store = this.idempotency();
            // Claimed before the write, not after: the two-step
            // recall-then-write let concurrent replays of one key both through.
            const claimed = idempotencyKey && store
                ? await store.claim(idempotencyKey, uid, requestFingerprint(c.req.method, c.req.path, body))
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
        };

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

            const body = await parseJsonBody(c) as { rows?: unknown; upsert?: unknown };

            assertBulkShape(body?.rows, "rows", true);
            const rows = body.rows as Record<string, unknown>[];
            if (rows.length === 0) {
                return c.json({ data: [], meta: { written: 0 } });
            }
            if (body.upsert !== undefined && typeof body.upsert !== "boolean") {
                throw ApiError.badRequest("`upsert` must be a boolean.", "INVALID_BULK_BODY");
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
                assertKnownWriteFields(row, resolvedCollection, { rowIndex });
                assertWriteValuesValid(row, resolvedCollection, { rowIndex });
            });

            // A client that never sees the response cannot know whether the
            // batch committed, so it retries — and without a key the server
            // cannot tell that retry from a second genuine import. On a single
            // create that duplicates one row; here it duplicates the batch.
            return withIdempotency(c, body, async () => {
                const written = await driver.saveMany!({
                    path,
                    rows,
                    collection: resolvedCollection,
                    upsert: body.upsert === true
                });
                return {
                    data: written.map((row) => this.formatResponse(row)),
                    meta: { written: written.length }
                };
            }, (result) => c.json(result as never));
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
                assertKnownWriteFields(entry.data as Record<string, unknown>, resolvedCollection, { rowIndex });
                assertWriteValuesValid(entry.data as Record<string, unknown>, resolvedCollection, { rowIndex });
            });

            return withIdempotency(c, body, async () => {
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
            }, (result) => c.json(result as never));
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

            return withIdempotency(c, body, async () => {
                await driver.deleteMany!({
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
                assertKnownWriteFields(body, resolvedCollection);
                assertWriteValuesValid(body, resolvedCollection);
            } else {
                const contract = this.authAdapter?.describeUserCreationContract?.(collectionAuthConfig);
                if (contract?.validate) {
                    assertKnownWriteFields(body, resolvedCollection, {
                        extraKnownFields: contract.extraFields
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
            const idempotencyKey = c.req.header(IDEMPOTENCY_HEADER);
            const uid = (c.get("user") as { uid?: string } | undefined)?.uid;
            const store = this.idempotency();
            // Claimed before the write, not after: the two-step
            // recall-then-write let concurrent replays of one key both
            // through, which is the duplicate this exists to stop.
            const claimed = idempotencyKey && store
                ? await store.claim(idempotencyKey, uid, requestFingerprint(c.req.method, c.req.path, body))
                : undefined;
            if (claimed?.status === "replay") {
                return c.json(claimed.response as never, 201);
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
                const entity = await driver.save({
                    path,
                    values: body,
                    collection: resolvedCollection,
                    status: "new"
                });
                response = this.formatResponse(entity);
            } catch (error) {
                // Hand the key back, or one transient failure would refuse
                // every retry of it until the row aged out.
                if (claimed?.status === "claimed" && idempotencyKey && store) {
                    await store.release(idempotencyKey, uid);
                }
                throw error;
            }

            if (claimed?.status === "claimed" && idempotencyKey && store) {
                await store.complete(idempotencyKey, uid, response);
            }

            return c.json(response as never, 201);
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


            const existingEntity = await driver.fetchOne({
                path: getCollectionDataPath(collection),
                id: String(id),
                collection: resolvedCollection
            });

            if (!existingEntity) {
                throw ApiError.notFound("Entity not found");
            }

            const body = await parseJsonBody(c);
            assertKnownWriteFields(body, resolvedCollection);
            assertWriteValuesValid(body, resolvedCollection);

            const entity = await driver.save({
                path: getCollectionDataPath(collection),
                id: String(id),
                values: body,
                collection: resolvedCollection,
                status: "existing"
            });

            const response = this.formatResponse(entity);



            return c.json(response);
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
         * PUT stays mounted on the same handler rather than being changed or
         * removed: every published SDK sends it, and altering its semantics to
         * be a true replace would silently start nulling columns that callers
         * had simply omitted for years — a data-loss change disguised as a
         * standards fix. So PATCH is the honest name, PUT is the compatible one,
         * and both do the documented thing.
         */
        this.router.patch(`${basePath}/:id`, updateEntity);
        this.router.put(`${basePath}/:id`, updateEntity);

        // DELETE /collection/:id - Delete entity
        this.router.delete(`${basePath}/:id`, async (c) => {
            this.enforceApiKeyPermission(c, collection.slug);
            const id = c.req.param("id");
            const driver = this.getScopedDriver(c);


            const existingEntity = await driver.fetchOne({
                path: getCollectionDataPath(collection),
                id: String(id),
                collection: resolvedCollection
            });

            if (!existingEntity) {
                throw ApiError.notFound("Entity not found");
            }

            await driver.delete({
                row: {
                    // The address is the one in the URL, not something read back
                    // off the row: a row is only its columns, so `existingEntity.id`
                    // is undefined for any table not keyed on `id` — and the delete
                    // went looking for a row called "undefined".
                    id: String(id),
                    path: getCollectionDataPath(collection),
                    values: existingEntity
                },
                collection: resolvedCollection
            });



            return new Response(null, { status: 204 });
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



            if (parsed.id === "count") {
                // GET /parent/:parentId/child/count — count child entities
                const queryDict = c.req.queries();
                const queryOptions = this.parseQuery(queryDict);
                const searchString = Array.isArray(queryDict.searchString) ? queryDict.searchString[queryDict.searchString.length - 1] : undefined;

                const total = driver.count ? await driver.count({
                    path: parsed.collectionPath,
                    filter: queryOptions.where,
                    // The two sibling counts in this file forward the group and
                    // this one did not, so a nested `/count?or=(…)` answered
                    // with the unnarrowed total beside a narrowed list.
                    logical: queryOptions.logical,
                    searchString
                }) : 0;

                return c.json({ count: total });
            } else if (parsed.id) {
                // GET /parent/:parentId/child/:id — single entity
                const queryOptions = this.parseQuery(c.req.queries());
                const fetchService = driver.restFetchService;
                const entity = fetchService
                    ? await fetchService.fetchOneForRest(parsed.collectionPath, parsed.id, queryOptions.include)
                    : await driver.fetchOne({ path: parsed.collectionPath,
id: parsed.id });
                if (!entity) throw ApiError.notFound("Entity not found");

                // `?fields=` is advertised on this endpoint too. It reached
                // `queryOptions` and was read by nothing here, so a
                // subcollection read returned every column while the root read
                // narrowed — the same defect `projectResponseFields` exists to
                // fix, surviving on the route family it was never wired into.
                const nestedCollection = this.resolveNestedWriteCollection(parsed.collectionPath);
                if (!nestedCollection) return c.json(entity);
                return c.json(projectResponseFields(
                    [entity as Record<string, unknown>],
                    queryOptions.fields,
                    nestedCollection,
                    { include: queryOptions.include }
                )[0]);
            } else {
                // GET /parent/:parentId/child — list entities.
                //
                // Same call the root list route makes. A child listing used to
                // be served by a second, thinner pipeline that accepted these
                // options and applied only `limit` — so `offset`, `orderBy` and
                // `include` were dropped without a word, and `total` counted
                // rows the filter would have excluded.
                const queryDict = c.req.queries();
                const queryOptions = this.parseQuery(queryDict);
                const searchString = Array.isArray(queryDict.searchString) ? queryDict.searchString[queryDict.searchString.length - 1] : undefined;
                const fetchService = driver.restFetchService;
                const listOptions = {
                    filter: queryOptions.where,
                    // Same omission the comment above describes, one parameter
                    // later: parsed, then dropped, so `?or=` widened the read.
                    logical: queryOptions.logical,
                    limit: queryOptions.limit,
                    offset: queryOptions.offset,
                    orderBy: queryOptions.orderBy?.[0]?.field,
                    order: queryOptions.orderBy?.[0]?.direction === "desc" ? "desc" as const : "asc" as const,
                    searchString
                };
                const entities = fetchService
                    ? await fetchService.fetchCollectionForRest(parsed.collectionPath, listOptions, queryOptions.include)
                    : await driver.fetchCollection({ path: parsed.collectionPath,
...listOptions });

                const total = driver.count ? await driver.count({
                    path: parsed.collectionPath,
                    filter: queryOptions.where,
                    logical: queryOptions.logical,
                    searchString
                }) : entities.length;

                const listCollection = this.resolveNestedWriteCollection(parsed.collectionPath);
                return c.json({
                    data: listCollection
                        ? projectResponseFields(
                            entities as Record<string, unknown>[],
                            queryOptions.fields,
                            listCollection,
                            { include: queryOptions.include }
                        )
                        : entities,
                    meta: {
                        total,
                        limit: queryOptions.limit,
                        offset: queryOptions.offset,
                        hasMore: (queryOptions.offset || 0) + entities.length < total
                    }
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
                assertKnownWriteFields(body, targetCollection);
                assertWriteValuesValid(body, targetCollection);
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

            const targetCollection = this.resolveNestedWriteCollection(parsed.collectionPath);
            if (targetCollection) {
                assertKnownWriteFields(body, targetCollection);
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
        this.router.put("/:parent/:parentId/:rest{.+}", updateNested);

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

            if (!existingEntity) throw ApiError.notFound("Entity not found");

            await driver.delete({
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
     * Fetch raw collection data without Entity wrapper (fallback for non-Postgres)
     */
    private async fetchRawCollection(driver: DataDriver, collection: CollectionConfig, queryOptions: QueryOptions, searchString?: string) {
        const entities = await driver.fetchCollection({
            path: getCollectionDataPath(collection),
            collection,
            filter: queryOptions.where,
            // The fallback every driver without a `restFetchService` uses —
            // mongo, firebase, anything a developer registers. It dropped the
            // group exactly as the Postgres path did.
            logical: queryOptions.logical,
            limit: queryOptions.limit,
            orderBy: queryOptions.orderBy?.[0]?.field,
            order: queryOptions.orderBy?.[0]?.direction === "desc" ? "desc" : "asc",
            startAfter: queryOptions.offset ? String(queryOptions.offset) : undefined,
            searchString,
            vectorSearch: queryOptions.vectorSearch
        });

        return entities;
    }

    /**
     * Count raw entities for a collection
     */
    private async countRawEntities(driver: DataDriver, collection: CollectionConfig, queryOptions: QueryOptions, searchString?: string): Promise<number> {
        return driver.count ? await driver.count({
            path: getCollectionDataPath(collection),
            collection,
            filter: queryOptions.where,
            // Counted as well as fetched, or `total` describes a different set
            // of rows from the one that was served.
            logical: queryOptions.logical,
            searchString
        }) : 0;
    }

    /**
     * Fetch single entity raw data without Entity wrapper (fallback)
     */
    private async fetchRawEntity(driver: DataDriver, collection: CollectionConfig, id: string) {
        const entity = await driver.fetchOne({
            path: getCollectionDataPath(collection),
            id,
            collection
        });

        return entity ?? null;
    }


}
