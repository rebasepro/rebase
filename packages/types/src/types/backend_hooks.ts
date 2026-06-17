
/**
 * Context passed to every backend hook.
 * Provides information about the request that triggered the hook.
 * @group Backend Hooks
 */
export interface BackendHookContext {
    /** The currently authenticated user making the request (if any) */
    requestUser?: { userId: string; roles: string[] };
    /** The HTTP method of the request */
    method: "GET" | "POST" | "PUT" | "DELETE";
}


/**
 * Hooks for intercepting collection entity data at the REST API boundary.
 *
 * These run **after** per-collection `EntityCallbacks` (which execute inside
 * the DataDriver) and provide a single cross-cutting interception point for
 * ALL collections flowing through the REST API.
 *
 * Every callback receives the collection `slug` so you can target specific
 * collections or apply logic globally.
 *
 * @group Backend Hooks
 */
export interface DataHooks {
    /**
     * Transform an entity after it's read from the database,
     * before it's returned to the client.
     *
     * Runs for both list (GET /:slug) and single (GET /:slug/:id) fetches.
     * Return the modified entity, or `null` to filter it out.
     *
     * @param slug - The collection slug (e.g. "orders", "products")
     * @param entity - The flattened entity object (id + values merged)
     * @param context - Request context (authenticated user, HTTP method)
     */
    afterRead?(slug: string, entity: Record<string, unknown>, context: BackendHookContext): Record<string, unknown> | null | Promise<Record<string, unknown> | null>;

    /**
     * Transform entity values before they are written to the database.
     * Runs on POST (create) and PUT (update).
     *
     * Return the (possibly modified) values. Throw to abort the save.
     *
     * @param slug - The collection slug
     * @param values - The raw request body values
     * @param entityId - The entity ID (only present on updates)
     * @param context - Request context
     */
    beforeSave?(slug: string, values: Record<string, unknown>, entityId: string | undefined, context: BackendHookContext): Record<string, unknown> | Promise<Record<string, unknown>>;

    /**
     * Called after an entity is successfully saved (created or updated).
     * Useful for side-effects like syncing to external systems.
     *
     * @param slug - The collection slug
     * @param entity - The saved entity (flattened)
     * @param context - Request context
     */
    afterSave?(slug: string, entity: Record<string, unknown>, context: BackendHookContext): void | Promise<void>;

    /**
     * Called before an entity is deleted. Throw to prevent deletion.
     *
     * @param slug - The collection slug
     * @param entityId - The entity ID being deleted
     * @param context - Request context
     */
    beforeDelete?(slug: string, entityId: string, context: BackendHookContext): void | Promise<void>;

    /**
     * Called after an entity is successfully deleted.
     *
     * @param slug - The collection slug
     * @param entityId - The deleted entity ID
     * @param context - Request context
     */
    afterDelete?(slug: string, entityId: string, context: BackendHookContext): void | Promise<void>;
}

/**
 * Backend-level hooks for intercepting data at the API boundary.
 *
 * These hooks run server-side after database operations complete and before
 * API responses are sent.
 *
 * `data` hooks complement per-collection `EntityCallbacks`. Entity callbacks
 * run inside the DataDriver (close to the DB); data hooks run at the HTTP
 * boundary (close to the client). Use data hooks for cross-cutting concerns
 * like audit logging, response enrichment, or field masking.
 *
 * @example
 * ```typescript
 * const hooks: BackendHooks = {
 *     data: {
 *         afterRead(slug, entity, ctx) {
 *             // Mask PII for non-admin users across all collections
 *             if (!ctx.requestUser?.roles.includes("admin") && entity.email) {
 *                 return { ...entity, email: "***" };
 *             }
 *             return entity;
 *         }
 *     }
 * };
 * ```
 *
 * @group Backend Hooks
 */
export interface BackendHooks {
    /** Hooks for intercepting ALL collection entity data via the REST API */
    data?: DataHooks;
}
