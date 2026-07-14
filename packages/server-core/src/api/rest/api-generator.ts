import { Hono, type Context } from "hono";
import { AuthAdapter, DataDriver, CollectionConfig, getCollectionDataPath } from "@rebasepro/types";
import { QueryOptions, HonoEnv } from "../types";
import { ApiError, isRebaseApiError } from "../errors";
import { parseQueryOptions } from "./query-parser";
import { httpMethodToOperation, isOperationAllowed } from "../../auth/api-keys/api-key-permission-guard";
import type { ApiKeyMasked } from "../../auth/api-keys/api-key-types";

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
 * Lightweight REST API generator that leverages existing Rebase DataDriver.
 * Supports `include` query parameter for eager-loading relations via Drizzle.
 */
export class RestApiGenerator {
    private collections: CollectionConfig[];
    private router: Hono<HonoEnv>;
    private driver: DataDriver;

    private authAdapter?: AuthAdapter;

    constructor(
        collections: CollectionConfig[],
        driver: DataDriver,
        authAdapter?: AuthAdapter
    ) {
        this.collections = collections;
        this.driver = driver;
        this.authAdapter = authAdapter;
        this.router = new Hono<HonoEnv>();
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
        collectionSlug: string
    ): void {
        const apiKey = c.get("apiKey") as ApiKeyMasked | undefined;
        if (!apiKey) return; // Not an API key request — skip

        const operation = httpMethodToOperation(c.req.method);
        if (!isOperationAllowed(apiKey.permissions, collectionSlug, operation)) {
            throw ApiError.forbidden(
                `API key does not have "${operation}" permission for collection "${collectionSlug}"`,
                "API_KEY_FORBIDDEN"
            );
        }
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
            const queryOptions = parseQueryOptions(queryDict);
            const searchString = Array.isArray(queryDict.searchString) ? queryDict.searchString[queryDict.searchString.length - 1] : undefined;
            const driver = this.getScopedDriver(c);

            const total = await this.countRawEntities(driver, resolvedCollection, queryOptions, searchString);
            return c.json({ count: total });
        });

        // GET /collection - List entities
        this.router.get(basePath, async (c) => {
            this.enforceApiKeyPermission(c, collection.slug);
            const queryDict = c.req.queries();
            const queryOptions = parseQueryOptions(queryDict);
            const searchString = Array.isArray(queryDict.searchString) ? queryDict.searchString[queryDict.searchString.length - 1] : undefined;

            const driver = this.getScopedDriver(c);
            const fetchService = driver.restFetchService;

            // Use include-aware path when available
            const entities = fetchService
                ? await fetchService.fetchCollectionForRest(
                    collection.slug,
                    {
                        filter: queryOptions.where,
                        limit: queryOptions.limit,
                        offset: queryOptions.offset,
                        orderBy: queryOptions.orderBy?.[0]?.field,
                        order: queryOptions.orderBy?.[0]?.direction === "desc" ? "desc" : "asc",
                        searchString,
                        vectorSearch: queryOptions.vectorSearch
                    },
                    queryOptions.include
                )
                : await this.fetchRawCollection(driver, resolvedCollection, queryOptions, searchString);

            const total = await this.countRawEntities(driver, resolvedCollection, queryOptions, searchString);

            return c.json({
                data: entities,
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
            const queryOptions = parseQueryOptions(queryDict);
            const driver = this.getScopedDriver(c);
            const fetchService = driver.restFetchService;

            // Use include-aware path when available
            const entity = fetchService
                ? await fetchService.fetchOneForRest(collection.slug, String(id), queryOptions.include)
                : await this.fetchRawEntity(driver, resolvedCollection, String(id));

            if (!entity) {
                throw ApiError.notFound("Entity not found");
            }

            return c.json(entity);
        });

        // POST /collection - Create entity
        this.router.post(basePath, async (c) => {
            try {
                this.enforceApiKeyPermission(c, collection.slug);
                const driver = this.getScopedDriver(c);
                const path = collection.slug;


                const body = await parseJsonBody(c);



                const isAuth = collection.auth;
                const isAuthCollection = isAuth === true || (isAuth && typeof isAuth === "object" && isAuth.enabled === true);

                if (isAuthCollection && this.authAdapter?.prepareUserCreation) {
                    const collectionAuthConfig = typeof isAuth === "object" ? isAuth : undefined;
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
                                { id: entity.id as string,
values: entity.values as Record<string, unknown> },
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

                const entity = await driver.save({
                    path,
                    values: body,
                    collection: resolvedCollection,
                    status: "new"
                });

                const response = this.formatResponse(entity);



                return c.json(response, 201);
            } catch (error) {
                if (isRebaseApiError(error) && !error.code) {
                    // Only classify as BAD_REQUEST if it's an operational error
                    // (e.g. validation, DB constraints). Runtime bugs like TypeError,
                    // RangeError etc. should remain as 500 INTERNAL_ERROR.
                    const isRuntimeBug = error instanceof TypeError
                        || error instanceof RangeError
                        || error instanceof SyntaxError
                        || error instanceof ReferenceError;
                    if (!isRuntimeBug) {
                        error.code = "BAD_REQUEST";
                    }
                }
                throw error;
            }
        });

        // PUT /collection/:id - Update entity
        this.router.put(`${basePath}/:id`, async (c) => {
            try {
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



                const entity = await driver.save({
                    path: getCollectionDataPath(collection),
                    id: String(id),
                    values: body,
                    collection: resolvedCollection,
                    status: "existing"
                });

                const response = this.formatResponse(entity);



                return c.json(response);
            } catch (error) {
                if (isRebaseApiError(error) && !error.code) {
                    // Only classify as BAD_REQUEST if it's an operational error.
                    // Runtime bugs (TypeError, RangeError, etc.) stay as 500.
                    const isRuntimeBug = error instanceof TypeError
                        || error instanceof RangeError
                        || error instanceof SyntaxError
                        || error instanceof ReferenceError;
                    if (!isRuntimeBug) {
                        error.code = "BAD_REQUEST";
                    }
                }
                throw error;
            }
        });

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
                    id: existingEntity.id as string | number,
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
            const segments = rawPath.split("/").filter(s => s && s !== "undefined");
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

            this.enforceApiKeyPermission(c, c.req.param("parent"));



            if (parsed.id === "count") {
                // GET /parent/:parentId/child/count — count child entities
                const queryDict = c.req.queries();
                const queryOptions = parseQueryOptions(queryDict);
                const searchString = Array.isArray(queryDict.searchString) ? queryDict.searchString[queryDict.searchString.length - 1] : undefined;

                const total = driver.count ? await driver.count({
                    path: parsed.collectionPath,
                    filter: queryOptions.where,
                    searchString
                }) : 0;

                return c.json({ count: total });
            } else if (parsed.id) {
                // GET /parent/:parentId/child/:id — single entity
                const entity = await driver.fetchOne({
                    path: parsed.collectionPath,
                    id: parsed.id
                });
                if (!entity) throw ApiError.notFound("Entity not found");

                return c.json(entity);
            } else {
                // GET /parent/:parentId/child — list entities
                const queryDict = c.req.queries();
                const queryOptions = parseQueryOptions(queryDict);
                const searchString = Array.isArray(queryDict.searchString) ? queryDict.searchString[queryDict.searchString.length - 1] : undefined;
                const entities = await driver.fetchCollection({
                    path: parsed.collectionPath,
                    filter: queryOptions.where,
                    limit: queryOptions.limit,
                    orderBy: queryOptions.orderBy?.[0]?.field,
                    order: queryOptions.orderBy?.[0]?.direction === "desc" ? "desc" : "asc",
                    searchString
                });

                const total = driver.count ? await driver.count({
                    path: parsed.collectionPath,
                    filter: queryOptions.where,
                    searchString
                }) : entities.length;

                return c.json({
                    data: entities,
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


            this.enforceApiKeyPermission(c, c.req.param("parent"));
            const body = await parseJsonBody(c);



            const entity = await driver.save({
                path: parsed.collectionPath,
                values: body,
                status: "new"
            });

            const response = this.formatResponse(entity);



            return c.json(response, 201);
        });

        // PUT /<subcollection-path>/:id — update entity
        this.router.put("/:parent/:parentId/:rest{.+}", async (c, next) => {
            const rest = c.req.param("rest");
            if (!rest || rest === "undefined") return next();
            const rawPath = `${c.req.param("parent")}/${c.req.param("parentId")}/${rest}`;
            const parsed = parseSubPath(rawPath);
            if (!parsed || !parsed.id) return next();

            const driver = this.getScopedDriver(c);


            this.enforceApiKeyPermission(c, c.req.param("parent"));

            const body = await parseJsonBody(c);



            const entity = await driver.save({
                path: parsed.collectionPath,
                id: parsed.id,
                values: body,
                status: "existing"
            });

            const response = this.formatResponse(entity);



            return c.json(response);
        });

        // DELETE /<subcollection-path>/:id — delete entity
        this.router.delete("/:parent/:parentId/:rest{.+}", async (c, next) => {
            const rest = c.req.param("rest");
            if (!rest || rest === "undefined") return next();
            const rawPath = `${c.req.param("parent")}/${c.req.param("parentId")}/${rest}`;
            const parsed = parseSubPath(rawPath);
            if (!parsed || !parsed.id) return next();

            const driver = this.getScopedDriver(c);


            this.enforceApiKeyPermission(c, c.req.param("parent"));

            const existingEntity = await driver.fetchOne({
                path: parsed.collectionPath,
                id: parsed.id
            });

            if (!existingEntity) throw ApiError.notFound("Entity not found");



            await driver.delete({
                row: {
                    id: existingEntity.id as string | number,
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
