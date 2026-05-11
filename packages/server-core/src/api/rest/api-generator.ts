import { Hono } from "hono";
import { DataDriver, Entity, EntityCollection, FetchCollectionProps, DataHooks, BackendHookContext, RestFetchService } from "@rebasepro/types";
import { QueryOptions, HonoEnv } from "../types";
import { ApiError } from "../errors";
import { parseQueryOptions } from "./query-parser";


/**
 * Lightweight REST API generator that leverages existing Rebase DataDriver.
 * Supports `include` query parameter for eager-loading relations via Drizzle.
 */
export class RestApiGenerator {
    private collections: EntityCollection[];
    private router: Hono<HonoEnv>;
    private driver: DataDriver;
    private dataHooks?: DataHooks;

    constructor(collections: EntityCollection[], driver: DataDriver, dataHooks?: DataHooks) {
        this.collections = collections;
        this.driver = driver;
        this.dataHooks = dataHooks;
        this.router = new Hono<HonoEnv>();
    }

    /** Build a BackendHookContext from a Hono context */
    private buildHookContext(c: { get: (key: string) => unknown }, method: BackendHookContext["method"]): BackendHookContext {
        const user = c.get("user") as { userId: string; roles?: string[] } | undefined;
        return {
            requestUser: user ? { userId: user.userId, roles: user.roles ?? [] } : undefined,
            method
        };
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
     * Get the typed RestFetchService from a driver if it exposes one (for include support).
     */
    private getFetchService(driver: DataDriver): RestFetchService | undefined {
        return driver.restFetchService;
    }

    /**
     * Create REST routes for a collection using existing Rebase patterns
     */
    private createCollectionRoutes(collection: EntityCollection): void {
        const basePath = `/${collection.slug}`;
        const resolvedCollection = collection;

        // GET /collection/count - Count entities (with optional filters)
        this.router.get(`${basePath}/count`, async (c) => {
            const queryDict = c.req.query();
            const queryOptions = parseQueryOptions(queryDict);
            const searchString = queryDict.searchString as string | undefined;
            const driver = c.get("driver") || this.driver;

            const total = await this.countRawEntities(driver, resolvedCollection, queryOptions, searchString);
            return c.json({ count: total });
        });

        // GET /collection - List entities
        this.router.get(basePath, async (c) => {
            const queryDict = c.req.query();
            const queryOptions = parseQueryOptions(queryDict);
            const searchString = queryDict.searchString as string | undefined;

            const driver = c.get("driver") || this.driver;
            const fetchService = this.getFetchService(driver);
            const hookCtx = this.buildHookContext(c, "GET");

            // Use include-aware path when available
            if (fetchService) {
                const collectionPath = collection.slug;
                let entities = await fetchService.fetchCollectionForRest(
                    collectionPath,
                    {
                        filter: queryOptions.where as FetchCollectionProps["filter"],
                        limit: queryOptions.limit,
                        offset: queryOptions.offset,
                        orderBy: queryOptions.orderBy?.[0]?.field,
                        order: queryOptions.orderBy?.[0]?.direction === "desc" ? "desc" : "asc",
                        searchString
                    },
                    queryOptions.include
                );

                entities = await this.applyAfterReadBatch(collection.slug, entities, hookCtx);

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
            }

            // Fallback path
            let entities = await this.fetchRawCollection(driver, resolvedCollection, queryOptions, searchString);

            entities = await this.applyAfterReadBatch(collection.slug, entities, hookCtx);

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
            const id = c.req.param("id");
            const queryDict = c.req.query();
            const queryOptions = parseQueryOptions(queryDict);
            const driver = c.get("driver") || this.driver;
            const fetchService = this.getFetchService(driver);
            const hookCtx = this.buildHookContext(c, "GET");

            // Use include-aware path when available
            if (fetchService) {
                const collectionPath = collection.slug;
                let entity = await fetchService.fetchEntityForRest(
                    collectionPath,
                    String(id),
                    queryOptions.include
                );

                if (!entity) {
                    throw ApiError.notFound("Entity not found");
                }

                entity = await this.applyAfterRead(collection.slug, entity, hookCtx);
                if (!entity) {
                    throw ApiError.notFound("Entity not found");
                }

                return c.json(entity);
            }

            // Fallback
            let entity = await this.fetchRawEntity(driver, resolvedCollection, String(id));

            if (!entity) {
                throw ApiError.notFound("Entity not found");
            }

            entity = await this.applyAfterRead(collection.slug, entity, hookCtx);
            if (!entity) {
                throw ApiError.notFound("Entity not found");
            }

            return c.json(entity);
        });

        // POST /collection - Create entity
        this.router.post(basePath, async (c) => {
            try {
                const driver = c.get("driver") || this.driver;
                const path = collection.slug;
                const hookCtx = this.buildHookContext(c, "POST");

                let body = await c.req.json().catch(() => ({}));

                if (this.dataHooks?.beforeSave) {
                    body = await this.dataHooks.beforeSave(path, body, undefined, hookCtx);
                }

                const entity = await driver.saveEntity({
                    path,
                    values: body,
                    collection: resolvedCollection,
                    status: "new"
                });

                const response = this.formatResponse(entity);

                if (this.dataHooks?.afterSave) {
                    Promise.resolve(this.dataHooks.afterSave(path, response as Record<string, unknown>, hookCtx)).catch(err => {
                        console.error("[BackendHooks] data.afterSave error:", err instanceof Error ? err.message : err);
                    });
                }

                return c.json(response, 201);
            } catch (error) {
                const err = error as Error & { code?: string };
                err.code = err.code || "BAD_REQUEST";
                throw err;
            }
        });

        // PUT /collection/:id - Update entity
        this.router.put(`${basePath}/:id`, async (c) => {
            try {
                const id = c.req.param("id");
                const driver = c.get("driver") || this.driver;
                const hookCtx = this.buildHookContext(c, "PUT");

                const existingEntity = await driver.fetchEntity({
                    path: collection.slug,
                    entityId: String(id),
                    collection: resolvedCollection
                });

                if (!existingEntity) {
                    throw ApiError.notFound("Entity not found");
                }

                let body = await c.req.json().catch(() => ({}));

                if (this.dataHooks?.beforeSave) {
                    body = await this.dataHooks.beforeSave(collection.slug, body, String(id), hookCtx);
                }

                const entity = await driver.saveEntity({
                    path: collection.slug,
                    entityId: String(id),
                    values: body,
                    collection: resolvedCollection,
                    status: "existing"
                });

                const response = this.formatResponse(entity);

                if (this.dataHooks?.afterSave) {
                    Promise.resolve(this.dataHooks.afterSave(collection.slug, response as Record<string, unknown>, hookCtx)).catch(err => {
                        console.error("[BackendHooks] data.afterSave error:", err instanceof Error ? err.message : err);
                    });
                }

                return c.json(response);
            } catch (error) {
                const err = error as Error & { code?: string };
                err.code = err.code || "BAD_REQUEST";
                throw err;
            }
        });

        // DELETE /collection/:id - Delete entity
        this.router.delete(`${basePath}/:id`, async (c) => {
            const id = c.req.param("id");
            const driver = c.get("driver") || this.driver;
            const hookCtx = this.buildHookContext(c, "DELETE");

            const existingEntity = await driver.fetchEntity({
                path: collection.slug,
                entityId: String(id),
                collection: resolvedCollection
            });

            if (!existingEntity) {
                throw ApiError.notFound("Entity not found");
            }

            if (this.dataHooks?.beforeDelete) {
                await this.dataHooks.beforeDelete(collection.slug, String(id), hookCtx);
            }

            await driver.deleteEntity({
                entity: existingEntity,
                collection: resolvedCollection
            });

            if (this.dataHooks?.afterDelete) {
                Promise.resolve(this.dataHooks.afterDelete(collection.slug, String(id), hookCtx)).catch(err => {
                    console.error("[BackendHooks] data.afterDelete error:", err instanceof Error ? err.message : err);
                });
            }

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
     * (e.g. "authors/111094/posts") and optional `entityId` (e.g. "43").
     *
     * The DataDriver.saveEntity / fetchCollection / etc. already know how to
     * resolve multi-segment relation paths, so we just forward to them.
     */
    private createSubcollectionRoutes(): void {
        // Reserved path segments that should NOT be treated as relation names.
        // These are handled by dedicated route handlers (e.g., history routes)
        // mounted on the same data router.
        const RESERVED_SEGMENTS = new Set(["history"]);

        // Helper: parse a path like "authors/111094/posts/43" into
        // { collectionPath: "authors/111094/posts", entityId: "43" }
        // or "authors/111094/posts" into
        // { collectionPath: "authors/111094/posts", entityId: undefined }
        const parseSubPath = (rawPath: string): { collectionPath: string; entityId?: string } | null => {
            const segments = rawPath.split("/").filter(s => s && s !== "undefined");
            // Need at least 3 segments for a subcollection path (parent/id/child)
            if (segments.length < 3) return null;

            // If any segment is a reserved path (e.g. "history"), this is not a
            // subcollection route — let it fall through to other handlers.
            if (segments.some(s => RESERVED_SEGMENTS.has(s))) return null;

            // Odd segment count → collection path (parent/id/child or parent/id/child/id2/grandchild)
            // Even segment count → entity path   (parent/id/child/entityId)
            if (segments.length % 2 === 1) {
                return { collectionPath: segments.join("/") };
            } else {
                const entityId = segments.pop()!;
                return { collectionPath: segments.join("/"),
entityId };
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

            const driver = c.get("driver") || this.driver;

            if (parsed.entityId) {
                // GET /parent/:parentId/child/:id — single entity
                const entity = await driver.fetchEntity({
                    path: parsed.collectionPath,
                    entityId: parsed.entityId
                });
                if (!entity) throw ApiError.notFound("Entity not found");
                return c.json(this.flattenEntity(entity));
            } else {
                // GET /parent/:parentId/child — list entities
                const queryDict = c.req.query();
                const queryOptions = parseQueryOptions(queryDict);
                const entities = await driver.fetchCollection({
                    path: parsed.collectionPath,
                    filter: queryOptions.where as FetchCollectionProps["filter"],
                    limit: queryOptions.limit,
                    orderBy: queryOptions.orderBy?.[0]?.field,
                    order: queryOptions.orderBy?.[0]?.direction === "desc" ? "desc" : "asc",
                    searchString: queryDict.searchString as string | undefined
                });
                return c.json({
                    data: entities.map(e => this.flattenEntity(e)),
                    meta: {
                        total: entities.length,
                        limit: queryOptions.limit,
                        offset: queryOptions.offset,
                        hasMore: false
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
            if (!parsed || parsed.entityId) return next();

            const driver = c.get("driver") || this.driver;
            const body = await c.req.json().catch(() => ({}));

            const entity = await driver.saveEntity({
                path: parsed.collectionPath,
                values: body,
                status: "new"
            });

            return c.json(this.formatResponse(entity), 201);
        });

        // PUT /<subcollection-path>/:id — update entity
        this.router.put("/:parent/:parentId/:rest{.+}", async (c, next) => {
            const rest = c.req.param("rest");
            if (!rest || rest === "undefined") return next();
            const rawPath = `${c.req.param("parent")}/${c.req.param("parentId")}/${rest}`;
            const parsed = parseSubPath(rawPath);
            if (!parsed || !parsed.entityId) return next();

            const driver = c.get("driver") || this.driver;
            const body = await c.req.json().catch(() => ({}));

            const entity = await driver.saveEntity({
                path: parsed.collectionPath,
                entityId: parsed.entityId,
                values: body,
                status: "existing"
            });

            return c.json(this.formatResponse(entity));
        });

        // DELETE /<subcollection-path>/:id — delete entity
        this.router.delete("/:parent/:parentId/:rest{.+}", async (c, next) => {
            const rest = c.req.param("rest");
            if (!rest || rest === "undefined") return next();
            const rawPath = `${c.req.param("parent")}/${c.req.param("parentId")}/${rest}`;
            const parsed = parseSubPath(rawPath);
            if (!parsed || !parsed.entityId) return next();

            const driver = c.get("driver") || this.driver;

            const existingEntity = await driver.fetchEntity({
                path: parsed.collectionPath,
                entityId: parsed.entityId
            });

            if (!existingEntity) throw ApiError.notFound("Entity not found");

            await driver.deleteEntity({ entity: existingEntity });

            return new Response(null, { status: 204 });
        });
    }

    /**
     * Format successful API response - flattened for traditional REST API
     */
    private formatResponse<T>(data: T, meta?: Record<string, unknown>): unknown {
        if (Array.isArray(data)) {
            const flattenedData = data.map(entity => this.flattenEntity(entity));
            if (meta) {
                return {
                    data: flattenedData,
                    meta
                };
            }
            return flattenedData;
        }

        if (data && typeof data === "object" && "values" in data) {
            return this.flattenEntity(data as unknown as Entity<Record<string, unknown>>);
        }

        if (meta) {
            return {
                data,
                meta
            };
        }
        return data;
    }

    /**
     * Flatten Rebase entity structure to traditional REST format
     */
    private flattenEntity(entity: Entity<Record<string, unknown>>): Record<string, unknown> {
        if (!entity || typeof entity !== "object") {
            return entity;
        }

        if ("values" in entity && typeof entity.values === "object") {
            return {
                id: entity.id,
                ...entity.values
            };
        }

        return entity as unknown as Record<string, unknown>;
    }

    /**
     * Fetch raw collection data without Entity wrapper (fallback for non-Postgres)
     */
    private async fetchRawCollection(driver: DataDriver, collection: EntityCollection, queryOptions: QueryOptions, searchString?: string) {
        const entities = await driver.fetchCollection({
            path: collection.slug,
            collection,
            filter: queryOptions.where as FetchCollectionProps["filter"],
            limit: queryOptions.limit,
            orderBy: queryOptions.orderBy?.[0]?.field,
            order: queryOptions.orderBy?.[0]?.direction === "desc" ? "desc" : "asc",
            startAfter: queryOptions.offset ? String(queryOptions.offset) : undefined,
            searchString
        });

        return entities.map(entity => this.flattenEntity(entity));
    }

    /**
     * Count raw entities for a collection
     */
    private async countRawEntities(driver: DataDriver, collection: EntityCollection, queryOptions: QueryOptions, searchString?: string): Promise<number> {
        return driver.countEntities ? await driver.countEntities({
            path: collection.slug,
            collection,
            filter: queryOptions.where as FetchCollectionProps["filter"],
            searchString
        }) : 0;
    }

    /**
     * Fetch single entity raw data without Entity wrapper (fallback)
     */
    private async fetchRawEntity(driver: DataDriver, collection: EntityCollection, entityId: string) {
        const entity = await driver.fetchEntity({
            path: collection.slug,
            entityId,
            collection
        });

        return entity ? this.flattenEntity(entity) : null;
    }

    /**
     * Apply data.afterRead hook to a single entity.
     * Returns the transformed entity, or null to filter it out.
     */
    private async applyAfterRead(slug: string, entity: Record<string, unknown>, ctx: BackendHookContext): Promise<Record<string, unknown> | null> {
        if (!this.dataHooks?.afterRead) return entity;
        return this.dataHooks.afterRead(slug, entity, ctx);
    }

    /**
     * Apply data.afterRead hook to an array of entities, filtering out nulls.
     */
    private async applyAfterReadBatch(slug: string, entities: Record<string, unknown>[], ctx: BackendHookContext): Promise<Record<string, unknown>[]> {
        if (!this.dataHooks?.afterRead) return entities;
        const results = await Promise.all(
            entities.map(e => this.applyAfterRead(slug, e, ctx))
        );
        return results.filter((e): e is Record<string, unknown> => e !== null);
    }
}
