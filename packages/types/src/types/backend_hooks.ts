
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
 * REST-boundary interceptors for collection entity data.
 *
 * ## Layer & scope — read before using for security
 *
 * These hooks run **only at the REST/HTTP boundary**, and **after** the
 * per-collection {@link EntityCallbacks} that execute inside the DataDriver.
 * Execution order for a REST read is:
 *
 *   DataDriver → {@link EntityCallbacks} (all paths) → `DataHooks` (REST only)
 *
 * Read-path coverage differs from `EntityCallbacks`:
 *
 * | Read path                       | {@link EntityCallbacks} | `DataHooks` |
 * | ------------------------------- | :---------------------: | :---------: |
 * | REST API (`GET /:slug`)         |           ✅            |     ✅      |
 * | Realtime / WebSocket            |           ✅            |     ❌      |
 * | Server-side `rebase.data.*`     |           ✅            |     ❌      |
 *
 * **Do not enforce security-critical redaction here.** Because `DataHooks`
 * are REST-only, PII masking or row filtering placed here is **bypassed** by
 * realtime subscriptions and by any server code calling `rebase.data` (which
 * runs with admin privileges / no RLS). For redaction that must hold on every
 * read path, use {@link EntityCallbacks} on the collection (driver level) or
 * column-level RLS. Use `DataHooks` for REST-only cross-cutting concerns:
 * audit logging of HTTP requests, response envelope enrichment, etc.
 *
 * Every callback receives the collection `slug` so you can target specific
 * collections or apply logic globally.
 *
 * @group Backend Hooks
 */
export interface DataHooks {
    /**
     * Transform an entity after it's read from the database via REST,
     * before it's returned to the client.
     *
     * Runs for both list (GET /:slug) and single (GET /:slug/:id) fetches.
     * Return the modified entity, or `null` to filter it out.
     *
     * ⚠️ REST-only: this does NOT run for realtime or `rebase.data` reads.
     * For redaction that must hold on every read path, use
     * {@link EntityCallbacks.afterRead} instead.
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
 * Backend-level hooks for intercepting data at the **REST API boundary**.
 *
 * These hooks run server-side after database operations complete and before
 * REST API responses are sent — they do **not** fire for realtime or
 * server-side `rebase.data` reads. See {@link DataHooks} for the full
 * read-path coverage table.
 *
 * `data` hooks complement per-collection {@link EntityCallbacks}. Entity
 * callbacks run inside the DataDriver (close to the DB, on every read path);
 * data hooks run at the HTTP boundary (close to the client, REST only). Use
 * data hooks for REST-only cross-cutting concerns like audit logging of HTTP
 * requests or response envelope enrichment — **not** for security-critical
 * redaction, which belongs in {@link EntityCallbacks} so it can't be bypassed.
 *
 * @example REST-only audit logging (safe use of a data hook)
 * ```typescript
 * const hooks: BackendHooks = {
 *     data: {
 *         afterSave(slug, entity, ctx) {
 *             console.log(`[audit] ${ctx.requestUser?.userId} wrote ${slug}/${entity.id}`);
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
