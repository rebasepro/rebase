import { Hono } from "hono";
import { HonoEnv } from "../api/types";
import { BackendCollectionRegistry } from "../collections/BackendCollectionRegistry";
import { ApiError, errorHandler } from "../api/errors";
import { DataDriver } from "@rebasepro/types";
/**
 * Create Hono routes for snapshot history.
 * Mounted at `{basePath}/data/:slug/:id/history`.
 */
export interface HistoryService {
    fetchHistory(tableName: string, id: string, options: { limit: number, offset: number }): Promise<{ data: Record<string, unknown>[], total: number }>;
    fetchHistoryEntry(historyId: string): Promise<Record<string, unknown> | null>;
}

export function createHistoryRoutes(params: {
    historyService: HistoryService;
    registry: BackendCollectionRegistry;
    driver: DataDriver;
}): Hono<HonoEnv> {
    const { historyService, registry, driver } = params;
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);

    /**
     * GET /:slug/:id/history - List history entries for a snapshot
     *
     * Query params:
     *   limit  (default 20)
     *   offset (default 0)
     */
    router.get("/:slug/:id/history", async (c) => {
        const slug = c.req.param("slug");
        const id = c.req.param("id");
        const parsedLimit = parseInt(c.req.query("limit") ?? "20", 10);
        const parsedOffset = parseInt(c.req.query("offset") ?? "0", 10);
        const limit = Number.isNaN(parsedLimit) ? 20 : parsedLimit;
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

        const tableName = collection.slug;

        const result = await historyService.fetchHistory(tableName, id, {
            limit: Math.min(limit, 100),
            offset: Math.max(offset, 0)
        });

        return c.json({
            data: result.data,
            meta: {
                total: result.total,
                limit,
                offset,
                hasMore: offset + result.data.length < result.total
            }
        });
    });

    /**
     * POST /:slug/:id/history/:historyId/revert - Revert snapshot to a historical version
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

        // Fetch the history entry
        const historyEntry = await historyService.fetchHistoryEntry(historyId);

        if (!historyEntry) {
            throw ApiError.notFound(`History entry '${historyId}' not found`);
        }

        // Verify the history entry belongs to this snapshot (prevent cross-snapshot revert)
        const tableName = collection.slug;
        if (historyEntry.snapshot_id !== String(id) || historyEntry.table_name !== tableName) {
            throw ApiError.badRequest("History entry does not belong to this snapshot");
        }

        if (!historyEntry.values) {
            throw ApiError.badRequest("Cannot revert: history entry has no stored values");
        }

        // Revert by saving through the normal driver path — this will
        // itself create another history entry, giving a full audit trail.
        const authDriver = c.get("driver") || driver;
        const path = collection.slug;

        const savedSnapshot = await authDriver.save({
            path,
            id: String(id),
            values: historyEntry.values,
            collection,
            status: "existing"
        });

        return c.json({
            data: savedSnapshot,
            meta: { reverted_from: historyId }
        });
    });

    return router;
}
