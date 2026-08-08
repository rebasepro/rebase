import { Hono, type Context } from "hono";
import { HonoEnv } from "../api/types";
import { BackendCollectionRegistry } from "../collections/BackendCollectionRegistry";
import { ApiError, errorHandler } from "../api/errors";
import { resolveListLimitParam } from "../api/rest/query-parser";
import { CollectionConfig, DataDriver } from "@rebasepro/types";
import type { ApiKeyMasked } from "../auth/api-keys/api-key-types";
import { httpMethodToOperation, isOperationAllowed } from "../auth/api-keys/api-key-permission-guard";
/**
 * Create Hono routes for entity history.
 * Mounted at `{basePath}/data/:slug/:id/history`.
 */
export interface HistoryService {
    fetchHistory(tableName: string, id: string, options: { limit: number, offset: number }): Promise<{ data: Record<string, unknown>[], total: number }>;
    fetchHistoryEntry(historyId: string): Promise<Record<string, unknown> | null>;
}

/** Entries returned when the caller names no `?limit`. */
const HISTORY_DEFAULT_LIMIT = 20;
/** Most entries one history read will serve. Above it the request is refused. */
const HISTORY_MAX_LIMIT = 100;

export function createHistoryRoutes(params: {
    historyService: HistoryService;
    registry: BackendCollectionRegistry;
    /**
     * The unscoped driver, still accepted so the call in `init.ts` and any
     * embedder's keeps compiling — and deliberately not read. Every read and
     * write on these routes goes through the request-scoped driver instead;
     * see {@link authorizeEntityRead}.
     */
    driver: DataDriver;
}): Hono<HonoEnv> {
    const { historyService, registry } = params;
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);

    /**
     * Both halves of the authorization the REST generator applies to every
     * other route on this router, for the row whose history is being asked for.
     *
     * `historyService` reads `rebase.entity_history` through the *privileged*
     * handle the bootstrapper built — not `c.get("driver")` — and it has to:
     * history is one table shadowing every audited collection, so it cannot
     * carry their row policies, and `ensure-history-table` revokes it from
     * `rebase_user` outright for exactly that reason. Nothing about the read is
     * therefore scoped to the caller. That makes this function the *entire*
     * access-control model for the route, the same way `storageAuthorize` is
     * for storage.
     *
     * It asks the two questions the data API already answers, in its order:
     *
     *  - the API key's permission list, via the same predicate
     *    `RestApiGenerator.enforceApiKeyPermission` uses, and keyed on the
     *    request's own method so that reverting needs `write` and listing needs
     *    `read` — a key scoped to no collection, or to a different one, or to
     *    reading only, must not get past this;
     *  - RLS, by fetching the row itself through the request-scoped driver.
     *    A row the caller may not read comes back undefined, and its history is
     *    then a 404 rather than a 403, because a 403 confirms the row exists.
     *
     * A missing scoped driver is an internal error, never a fallback to the
     * unscoped one — the same rule, and the same reason, as
     * {@link RestApiGenerator.getScopedDriver}.
     */
    async function authorizeEntityRead(
        c: Context<HonoEnv>,
        collection: CollectionConfig,
        id: string
    ): Promise<void> {
        const apiKey = c.get("apiKey") as ApiKeyMasked | undefined;
        const operation = httpMethodToOperation(c.req.method);
        if (apiKey && !isOperationAllowed(apiKey.permissions, collection.slug, operation)) {
            throw ApiError.forbidden(
                `API key does not have "${operation}" permission for collection "${collection.slug}"`,
                "API_KEY_FORBIDDEN"
            );
        }

        const scoped = c.get("driver") as DataDriver | undefined;
        if (!scoped) throw ApiError.internal("Scoped driver not available");

        const row = await scoped.fetchOne({ path: collection.slug, id, collection });
        if (!row) {
            throw ApiError.notFound(`Entity '${id}' not found in collection '${collection.slug}'`);
        }
    }

    /**
     * GET /:slug/:id/history - List history entries for a entity
     *
     * Query params:
     *   limit  (default 20, maximum 100 — above that the request is refused)
     *   offset (default 0)
     */
    router.get("/:slug/:id/history", async (c) => {
        const slug = c.req.param("slug");
        const id = c.req.param("id");
        // This route has its own, tighter window (20/100), but the *rule* is
        // the shared one: an absent limit defaults, and a limit this route will
        // not serve is a 400 naming the ceiling. It used to clamp silently, so
        // `?limit=1000` answered with 100 rows and a `meta` that agreed with
        // itself — a caller could only tell by comparing what it asked for.
        const limit = resolveListLimitParam(c.req.query("limit"), {
            defaultLimit: HISTORY_DEFAULT_LIMIT,
            maxLimit: HISTORY_MAX_LIMIT
        });
        const parsedOffset = parseInt(c.req.query("offset") ?? "0", 10);
        const offset = Number.isNaN(parsedOffset) ? 0 : parsedOffset;

        // Resolve the collection to get the actual table name
        const collection = registry.getCollections().find(
            col => col.slug === slug || false
        );

        if (!collection) {
            throw ApiError.notFound(`Collection '${slug}' not found`);
        }

        if (!collection.history) {
            throw ApiError.badRequest(`History is not enabled for collection '${slug}'`);
        }

        await authorizeEntityRead(c, collection, id);

        const tableName = collection.slug;

        // Echo back the offset that was actually applied, not the one asked
        // for. A client paginating on `meta` — which is what `meta` is for —
        // would otherwise advance by the number it requested while receiving
        // the clamped number, and skip every row in between. (The limit can no
        // longer differ from the request: an unservable one was refused above.)
        const appliedLimit = limit;
        const appliedOffset = Math.max(offset, 0);

        const result = await historyService.fetchHistory(tableName, id, {
            limit: appliedLimit,
            offset: appliedOffset
        });

        return c.json({
            data: result.data,
            meta: {
                total: result.total,
                limit: appliedLimit,
                offset: appliedOffset,
                hasMore: appliedOffset + result.data.length < result.total
            }
        });
    });

    /**
     * POST /:slug/:id/history/:historyId/revert - Revert entity to a historical version
     *
     * This goes through the normal save path, so it creates its own history entry.
     */
    router.post("/:slug/:id/history/:historyId/revert", async (c) => {
        const slug = c.req.param("slug");
        const id = c.req.param("id");
        const historyId = c.req.param("historyId");

        const collection = registry.getCollections().find(
            col => col.slug === slug || false
        );

        if (!collection) {
            throw ApiError.notFound(`Collection '${slug}' not found`);
        }

        if (!collection.history) {
            throw ApiError.badRequest(`History is not enabled for collection '${slug}'`);
        }

        // Before looking the entry up at all: the lookup is by history id alone,
        // across every table, so answering "no such entry" vs "not yours" for an
        // id the caller cannot see is itself a read of the history table.
        await authorizeEntityRead(c, collection, id);

        // Fetch the history entry
        const historyEntry = await historyService.fetchHistoryEntry(historyId);

        if (!historyEntry) {
            throw ApiError.notFound(`History entry '${historyId}' not found`);
        }

        // Verify the history entry belongs to this entity (prevent cross-entity revert)
        const tableName = collection.slug;
        if (historyEntry.entity_id !== String(id) || historyEntry.table_name !== tableName) {
            throw ApiError.badRequest("History entry does not belong to this entity");
        }

        if (!historyEntry.values) {
            throw ApiError.badRequest("Cannot revert: history entry has no stored values");
        }

        // Revert by saving through the normal driver path — this will
        // itself create another history entry, giving a full audit trail.
        //
        // The request-scoped driver, with no fallback. This used to read
        // `c.get("driver") || driver`, which would have written a stored version
        // over a row on the *unscoped* handle whenever the scoped one was
        // absent — an RLS-free write, reached by the absence of a value rather
        // than by any decision. `authorizeEntityRead` above already refuses that
        // request, so the fallback was unreachable; it is gone rather than left
        // armed for whoever moves the authorization call.
        const authDriver = c.get("driver") as DataDriver;
        const path = collection.slug;

        const savedEntity = await authDriver.save({
            path,
            id: String(id),
            values: historyEntry.values,
            collection,
            status: "existing"
        });

        return c.json({
            data: savedEntity,
            meta: { reverted_from: historyId }
        });
    });

    return router;
}
