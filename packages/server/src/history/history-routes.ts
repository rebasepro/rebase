import { Hono, type Context } from "hono";
import { HonoEnv } from "../api/types";
import { BackendCollectionRegistry } from "../collections/BackendCollectionRegistry";
import { ApiError, errorHandler } from "../api/errors";
import { resolveListLimitParam } from "../api/rest/query-parser";
import { CollectionConfig, DataDriver } from "@rebasepro/types";
import type { ApiKeyMasked } from "../auth/api-keys/api-key-types";
import { httpMethodToOperation, isOperationAllowed } from "../auth/api-keys/api-key-permission-guard";
import { type FieldViewer, restrictedFieldNames } from "@rebasepro/common";
import { requestViewer } from "../api/rest/field-access-query";
import { assertNoClosedFields } from "../api/rest/write-validation";

/**
 * A history entry, with the fields this caller cannot read taken out of its
 * stored snapshot.
 *
 * History stores the **whole row** — that is what makes it a revert target — and
 * it is served to anyone who can read the row, not only to admins: the route's
 * gate is "can you fetch this entity", nothing more. So a field the data API
 * withholds was in every history entry of every row the caller could open, which
 * is the read rule with an audit log around it.
 *
 * The snapshot is rewritten rather than the entry dropped: the caller is
 * entitled to know that a version exists, who made it and when. Only the
 * withheld columns leave. The revert route reads the stored entry through the
 * history service, not through this projection; what it may write back is
 * {@link restorableValues}'s question.
 */
function stripHistoryValues(
    entries: Record<string, unknown>[],
    collection: CollectionConfig,
    viewer: { roles?: readonly string[] } | undefined
): Record<string, unknown>[] {
    const { refused } = restrictedFieldNames(collection, viewer, "read");
    if (refused.size === 0) return entries;

    return entries.map(entry => {
        const values = entry.values;
        if (typeof values !== "object" || values === null || Array.isArray(values)) return entry;
        const kept: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
            if (!refused.has(key)) kept[key] = value;
        }
        return { ...entry, values: kept };
    });
}
/**
 * The part of a stored version a revert writes, under the field write rules
 * every other write door applies.
 *
 * A revert is a write, so `access.write` and `excludeFromApi` hold through it:
 * without this, a caller refused `PATCH { discountPercent: 50 }` could set the
 * same value by reverting to a version that carried it, and a server-owned
 * column went back to whatever the snapshot held.
 *
 * The snapshot is the whole row, though, not a request body. It names every
 * restricted field whether the version changed it or not, so refusing on the
 * mere presence of one would make every revert on such a collection a 400 for
 * anyone without the role. The question is asked of what the revert would
 * actually change:
 *
 *  - a field closed to the caller whose stored value differs from the row's
 *    current one refuses the revert, with the error the PATCH would have got —
 *    never a silent partial revert that reports success;
 *  - one whose value is unchanged is left out of the write, which is the same
 *    row either way;
 *  - one the caller cannot read is left as it is. The history list strips it
 *    from their view of the version, so it is not part of what they chose to
 *    restore, and `current` — read through their scoped driver — does not carry
 *    it to compare against. `excludeFromApi` columns fall here for everyone.
 */
function restorableValues(
    stored: Record<string, unknown>,
    current: Record<string, unknown>,
    collection: CollectionConfig,
    viewer: FieldViewer
): Record<string, unknown> {
    const closed = restrictedFieldNames(collection, viewer, "write").refused;
    if (closed.size === 0) return stored;
    const unreadable = restrictedFieldNames(collection, viewer, "read").refused;

    const restorable: Record<string, unknown> = {};
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(stored)) {
        if (!closed.has(key)) {
            restorable[key] = value;
        } else if (!unreadable.has(key) && !sameStoredValue(value, current[key])) {
            changed[key] = value;
        }
    }
    assertNoClosedFields(changed, collection, "Cannot revert to this version: ", viewer);
    return restorable;
}

/**
 * Whether a value from a stored snapshot and one from the live row are the same.
 *
 * The snapshot went through `jsonb`, so both are compared in that form: a
 * `Date` is its ISO string, and an object's keys are unordered — `jsonb` hands
 * them back in its own order, not the one they were written in. A value the
 * live row does not carry is `null`, as it would be in the snapshot.
 */
function sameStoredValue(stored: unknown, live: unknown): boolean {
    return canonicalJson(stored) === canonicalJson(live);
}

function canonicalJson(value: unknown): string {
    return JSON.stringify(value ?? null, (_key, item: unknown) => {
        if (typeof item === "bigint") return item.toString();
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
            return Object.fromEntries(
                Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            );
        }
        return item;
    });
}

function isPlainValues(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
    ): Promise<Record<string, unknown>> {
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
        return row;
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
            data: stripHistoryValues(result.data, collection, requestViewer(c)),
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
        const current = await authorizeEntityRead(c, collection, id);

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

        if (!isPlainValues(historyEntry.values)) {
            throw ApiError.badRequest("Cannot revert: history entry has no stored values");
        }
        const values = restorableValues(historyEntry.values, current, collection, requestViewer(c));

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
            values,
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
