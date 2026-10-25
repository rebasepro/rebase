/**
 * `/admin/storage` — the routes behind `rebase storage orphans` and
 * `rebase storage move`. Admin-only; the caller mounts them behind the admin
 * gate (`database:read` to read, `database:write` to delete or move).
 *
 *   GET    /orphans?storageId=&olderThanHours=   objects no row names
 *   DELETE /orphans?storageId=&olderThanHours=   delete them, found again first
 *   POST   /move  { from, to, prefix?, cursor?, limit?, deleteSource? }
 *   POST   /move/verify  (the same body)            what a move left behind
 */
import { Hono } from "hono";
import type { CollectionCallbacks, CollectionConfig, DataDriver } from "@rebasepro/types";
import { DEFAULT_STORAGE_SOURCE_KEY } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { ApiError } from "../api/errors";
import type { StorageController } from "./types";
import type { StorageRegistry } from "./storage-registry";
import { canonicalStorageId } from "./keys";
import { findOrphans, InvalidMaintenanceRequestError, moveObjects, storesInSamePlace, verifyMove } from "./maintenance";

export interface StorageMaintenanceRoutesConfig {
    registry?: StorageRegistry;
    controller?: StorageController;
    /** The collections whose rows are read for references, read per request. */
    collections: () => readonly CollectionConfig[];
    /**
     * The unscoped driver serving a collection: every row, whoever wrote it.
     * Its `scanStoredRows` is read when it has one — rows as stored, past
     * every read hook.
     */
    driverFor: (collection: CollectionConfig) => DataDriver | undefined;
    /** The global callbacks, read per request: a global read hook makes every collection hooked. */
    globalCallbacks?: () => CollectionCallbacks | undefined;
    /** Row history, when kept: a file only an entry names is restored by a revert. */
    history?: { scanStoredValues?(pageSize?: number): AsyncIterable<unknown[]> };
}

/** The default grace period: an upload whose row is not saved yet is a day old at most. */
const DEFAULT_OLDER_THAN_HOURS = 24;

export function createStorageMaintenanceRoutes(config: StorageMaintenanceRoutesConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();

    const sourceOf = (rawId: unknown, label: string): StorageController => {
        if (rawId !== undefined && typeof rawId !== "string") {
            throw ApiError.badRequest(`\`${label}\` must be a storage source key.`);
        }
        const id = canonicalStorageId(rawId);
        const controller = config.registry
            ? config.registry.get(id)
            : id === DEFAULT_STORAGE_SOURCE_KEY ? config.controller : undefined;
        if (!controller) {
            const served = config.registry?.list() ?? (config.controller ? [DEFAULT_STORAGE_SOURCE_KEY] : []);
            throw new ApiError(
                404,
                "UNKNOWN_STORAGE_SOURCE",
                `This server has no storage source "${id}". It serves ${served.map(key => `"${key}"`).join(", ") || "none"}.`
            );
        }
        return controller;
    };

    const olderThanMs = (raw: string | undefined): number => {
        if (raw === undefined || raw === "") return DEFAULT_OLDER_THAN_HOURS * 3_600_000;
        const hours = Number(raw);
        if (!Number.isFinite(hours) || hours < 0) {
            throw ApiError.badRequest("`olderThanHours` must be a number of hours, 0 or more.");
        }
        return hours * 3_600_000;
    };

    const report = async (storageId: string | undefined, olderThan: string | undefined) => {
        const controller = sourceOf(storageId, "storageId");
        return findOrphans({
            controller,
            collections: config.collections(),
            driverFor: config.driverFor,
            globalCallbacks: config.globalCallbacks?.(),
            history: config.history,
            olderThanMs: olderThanMs(olderThan)
        });
    };

    router.get("/orphans", async (c) => {
        const storageId = c.req.query("storageId");
        const found = await report(storageId, c.req.query("olderThanHours"));
        return c.json({ data: { storageId: canonicalStorageId(storageId), ...found } });
    });

    router.delete("/orphans", async (c) => {
        const storageId = c.req.query("storageId");
        const controller = sourceOf(storageId, "storageId");
        // Found again rather than taken from the caller: a list the caller
        // read minutes ago may name a file a row has picked up since.
        const found = await report(storageId, c.req.query("olderThanHours"));
        if (found.unscanned.length > 0) {
            throw ApiError.conflict(
                "Some collections could not be read, so a file they name would look unused. Nothing was deleted: " +
                found.unscanned.map(entry => `${entry.collection} (${entry.reason})`).join("; "),
                "STORAGE_SCAN_INCOMPLETE",
                { unscanned: found.unscanned }
            );
        }
        const deleted: string[] = [];
        const failed: { key: string; error: string }[] = [];
        for (const orphan of found.orphans) {
            try {
                await controller.deleteObject(orphan.key);
                deleted.push(orphan.key);
            } catch (error: unknown) {
                failed.push({ key: orphan.key, error: error instanceof Error ? error.message : String(error) });
            }
        }
        return c.json({ data: { storageId: canonicalStorageId(storageId), deleted, failed, recent: found.recent } });
    });

    /** A move's JSON body, checked: the two sources, and the walk's options. */
    const moveRequest = async (c: { req: { json(): Promise<unknown> } }) => {
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw ApiError.badRequest("The body must be a JSON object: { from, to, prefix?, cursor?, limit?, deleteSource? }.");
        }
        const field = (name: string): unknown => (body as Record<string, unknown>)[name];
        const fromId = canonicalStorageId(typeof field("from") === "string" ? field("from") as string : undefined);
        const toId = canonicalStorageId(typeof field("to") === "string" ? field("to") as string : undefined);
        if (fromId === toId) {
            throw ApiError.badRequest(`\`from\` and \`to\` are both "${fromId}": a move needs two storage sources.`);
        }
        const prefix = field("prefix");
        const cursor = field("cursor");
        const limit = field("limit");
        const deleteSource = field("deleteSource");
        if ((prefix !== undefined && typeof prefix !== "string")
            || (cursor !== undefined && typeof cursor !== "string")
            || (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 500))
            || (deleteSource !== undefined && typeof deleteSource !== "boolean")) {
            throw ApiError.badRequest("`prefix` and `cursor` are strings, `limit` a whole number from 1 to 500, `deleteSource` a boolean.");
        }
        return {
            fromId,
            toId,
            from: sourceOf(field("from"), "from"),
            to: sourceOf(field("to"), "to"),
            prefix,
            cursor,
            limit,
            deleteSource
        };
    };

    router.post("/move", async (c) => {
        const { fromId, toId, from, to, prefix, cursor, limit, deleteSource } = await moveRequest(c);
        // Two names for one store: every object is "already there" in the
        // target, being the same object, and deleting the source's copy
        // deletes it from both.
        if (deleteSource && await storesInSamePlace(from, to)) {
            throw new ApiError(
                400,
                "STORAGE_SAME_LOCATION",
                `"${fromId}" and "${toId}" store in the same place, so deleting the source's copy would delete the only one. ` +
                "Nothing was moved or deleted. Point the property at the other source instead; its files are already there."
            );
        }
        try {
            const result = await moveObjects({
                from,
                to,
                prefix,
                cursor,
                limit,
                deleteSource
            });
            return c.json({ data: { from: fromId, to: toId, ...result } });
        } catch (error: unknown) {
            if (error instanceof InvalidMaintenanceRequestError) throw ApiError.badRequest(error.message);
            throw error;
        }
    });

    // The source listed again after a move, by a walk of its own: every file
    // the move did not move. Reads only; `rebase storage move` asks it once
    // the move's own pages are done.
    router.post("/move/verify", async (c) => {
        const { fromId, toId, from, to, prefix, cursor, limit, deleteSource } = await moveRequest(c);
        try {
            const result = await verifyMove({ from, to, prefix, cursor, limit, deleteSource });
            return c.json({ data: { from: fromId, to: toId, ...result } });
        } catch (error: unknown) {
            if (error instanceof InvalidMaintenanceRequestError) throw ApiError.badRequest(error.message);
            throw error;
        }
    });

    return router;
}
