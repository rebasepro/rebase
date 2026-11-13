import { Hono, type Context } from "hono";
import { HonoEnv } from "../api/types";
import { ApiError, errorHandler } from "../api/errors";
import { resolveListLimitParam } from "../api/rest/query-parser";
import { DataDriver, scopeGrants, type TableDescriptor } from "@rebasepro/types";
import { httpMethodToOperation } from "../auth/api-keys/http-operation";
import { refuseSimulatedWrite } from "../auth/simulation-read-only";
import { type FieldViewer, restrictedKeys } from "@rebasepro/common";
import { requestViewer } from "../api/rest/field-access-query";
import { assertNoClosedFields } from "../api/rest/write-validation";
import type { RestTables, ServedTable } from "../api/rest/served-table";

/**
 * History entries as this caller may see them: every snapshot served as a read
 * of the table serves the row.
 *
 * History stores the **whole row as it was written** — the stored values,
 * before any hook, because that is what a revert writes back — and it is served
 * to anyone who can read the row, not only to admins: the route's gate is "can
 * you fetch this entity", nothing more. So each snapshot goes through what a
 * live read goes through, in the same order:
 *
 *  1. the field rules, here, from the descriptor: a column the caller may not
 *     read (`.private()`, `.access({ read })`, a withheld relation and its
 *     foreign key) leaves both snapshots (`values` and
 *     `previous_values`: an update entry carries the row on both sides of the
 *     write, each read under the writer's viewer, and stripping one leaves the
 *     same value one key over) and `changed_fields`.
 *     So does a key the table has **no column for today**: a column dropped
 *     since, or a field an old `afterRead` once recorded. What rules applied
 *     to it is not known any more, so it is withheld (fail closed);
 *  2. the driver's {@link DataDriver.serveStoredRows}: the same strip for the
 *     caller's viewer, then the table's one `afterRead` chain — global, the
 *     table's, its columns' transforms — with the caller as `context`. Not
 *     re-implemented here: the driver's chain is the only one.
 *
 * A compact entry (`format: 2`) stores only the changed fields' previous
 * values. Its hooks are handed the whole previous row — the entry's `values`
 * with those fields put back, which is what the row held — and the fields the
 * entry stores are taken back out of the result, so a hook that reads one
 * column to mask another sees the row it expects and nothing is added.
 *
 * Today's hooks mask yesterday's rows. A hook that needs what a snapshot does
 * not carry and throws fails the request: the history is not served rather
 * than served unmasked. A driver without `serveStoredRows` is refused the same
 * way (501).
 *
 * The entry itself stays, with `updated_by` and `updated_at`: the caller is
 * entitled to know that a version exists, who made it and when — that is what
 * the history of a row is for. The revert route reads the stored entry through
 * the history service, not through this projection; what it may write back is
 * {@link restorableValues}'s question.
 */
async function servedHistoryEntries(
    entries: Record<string, unknown>[],
    table: TableDescriptor,
    viewer: FieldViewer,
    driver: DataDriver
): Promise<Record<string, unknown>[]> {
    if (entries.length === 0) return entries;
    if (!driver.serveStoredRows) {
        throw new ApiError(501, "HISTORY_UNSERVABLE",
            `History of table '${table.slug}' cannot be served: this data driver cannot run the table's read rules ` +
            "and afterRead hooks over stored rows (`serveStoredRows`), and history is not served unmasked.");
    }
    const { refused } = restrictedKeys(table, viewer, "read");
    const known = new Set<string>([...table.columns.map(column => column.key), ...table.relations.map(relation => relation.name)]);
    const readable = (key: string): boolean => known.has(key) && !refused.has(key);
    const narrow = (snapshot: unknown): Record<string, unknown> | undefined => {
        if (!isPlainValues(snapshot)) return undefined;
        const kept: Record<string, unknown> = {};
        // An old entry's view-model values as the wire values they stand for
        // (see `wireOfStoredVersion`) — a related row it embedded is reduced
        // to its key, so the caller, who may read this row, reads none of it.
        for (const [key, value] of Object.entries(wireOfStoredVersion(snapshot, table))) {
            if (readable(key)) kept[key] = value;
        }
        return kept;
    };

    // One call for every snapshot of the page: rows[] in entry order, each
    // entry's `values` then its whole previous row.
    const rows: Record<string, unknown>[] = [];
    const plan = entries.map(entry => {
        const values = narrow(entry.values);
        const previous = narrow(entry.previous_values);
        const compact = entry.format === 2;
        const at = { values: -1, previous: -1 };
        if (values) at.values = rows.push(values) - 1;
        if (previous) at.previous = rows.push(compact ? { ...values, ...previous } : previous) - 1;
        return { entry, at, previousKeys: compact && previous ? Object.keys(previous) : undefined };
    });
    const served = await driver.serveStoredRows(table.slug, rows);
    if (served.length !== rows.length) {
        throw ApiError.internal(`History of table '${table.slug}': the driver served ${served.length} of ${rows.length} snapshots`);
    }

    return plan.map(({ entry, at, previousKeys }) => {
        const out: Record<string, unknown> = { ...entry };
        if (Array.isArray(entry.changed_fields)) {
            out.changed_fields = entry.changed_fields.filter(field => typeof field === "string" && readable(field));
        }
        if (isPlainValues(entry.values)) out.values = at.values >= 0 ? served[at.values] : {};
        if (isPlainValues(entry.previous_values)) {
            const previous = at.previous >= 0 ? served[at.previous] : {};
            out.previous_values = previousKeys
                ? Object.fromEntries(previousKeys.filter(key => key in previous).map(key => [key, previous[key]]))
                : previous;
        }
        return out;
    });
}
/**
 * The part of a stored version a revert writes, under the field write rules
 * every other write door applies.
 *
 * A revert is a write, so `access.write` and `.private()` hold through it:
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
 *  - one the caller cannot read is left as it is, whether or not they may
 *    write it. The history list strips it from their view of the version, so
 *    it is not part of what they chose to restore, and `current` — read
 *    through their scoped driver — does not carry it to compare against.
 *    Private columns fall here for everyone. (This was only so for a column
 *    closed both ways: a column with `access.read` and no `access.write` went
 *    back to a value the caller had never been shown.)
 */
function restorableValues(
    stored: Record<string, unknown>,
    current: Record<string, unknown>,
    table: TableDescriptor,
    viewer: FieldViewer
): Record<string, unknown> {
    const closed = restrictedKeys(table, viewer, "write").refused;
    const unreadable = restrictedKeys(table, viewer, "read").refused;
    if (closed.size === 0 && unreadable.size === 0) return stored;

    const restorable: Record<string, unknown> = {};
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(stored)) {
        if (unreadable.has(key)) continue;
        if (!closed.has(key)) {
            restorable[key] = value;
        } else if (!sameStoredValue(value, current[key])) {
            changed[key] = value;
        }
    }
    assertNoClosedFields(changed, table, "Cannot revert to this version: ", viewer);
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

/**
 * A stored version as the wire row it stands for.
 *
 * An entry is the stored row today: wire values, which this leaves as they
 * are. Older entries are not. A delete before 1bad8f5b5 recorded the row
 * through the admin's view-model walk, so an entry may hold
 *
 * - a date as `{ __type: "date", value }` — served, and written back by a
 *   revert, as its value (a revert once handed the envelope to Postgres as
 *   the column's value: a 400 `PG_22007` for a version the list offered);
 * - a relation as a ref `{ __type: "relation", id, path, data? }` under the
 *   relation's name — an owning relation's as its foreign key under the
 *   foreign key's own key (which is how a new entry holds it; when the entry
 *   holds that key too, the ref goes), any other's as the related row's key,
 *   a to-many list as a list of keys. The related row a ref embedded is
 *   never served.
 *
 * Only the entry's own fields are read: a JSON document holding such keys
 * further down is data.
 */
function wireOfStoredVersion(values: Record<string, unknown>, table: TableDescriptor): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
        if (isPlainValues(value) && value.__type === "date") {
            out[key] = value.value ?? null;
            continue;
        }
        const relation = table.relations.find(candidate => candidate.name === key);
        if (!relation) {
            out[key] = value;
            continue;
        }
        const keys = Array.isArray(value) ? value.map(refKey) : refKey(value);
        if (relation.kind === "belongsTo" && !Array.isArray(keys)) {
            if (!(relation.localField in values)) out[relation.localField] = keys;
            continue;
        }
        out[key] = keys;
    }
    return out;
}

/** The key a relation ref of an old entry points at; any other value as it is. */
function refKey(value: unknown): unknown {
    return isPlainValues(value) && (value.__type === "relation" || value.__type === "reference")
        && (typeof value.id === "string" || typeof value.id === "number")
        ? value.id
        : value;
}

/**
 * A stored version narrowed to the row's columns, and what was left out.
 *
 * An entry is the stored row today, so this changes nothing about one. Older
 * entries are not: before 229f61720 a save recorded the row as `afterRead`
 * showed it, so a computed field (the docs' `displayName`) was in every
 * version, and before 1bad8f5b5 a delete recorded the admin view model, each
 * relation an envelope under the relation's name. A revert handed those keys
 * to the driver, which has no column for them: 400 VALIDATION_UNKNOWN_FIELDS
 * for a version the history list offered.
 *
 * The columns are the keys of `current`, the REST row the route just read;
 * `stored` has been through {@link wireOfStoredVersion}, so an owning
 * relation's old ref is already its foreign key. Any other key — a computed
 * field, a to-many relation, which no entry restores — is dropped and named,
 * so the caller is told the revert was partial rather than finding out. A
 * field the caller cannot read is not in `current`, and is left to
 * {@link restorableValues}. A masked value an old `afterRead` recorded
 * (`********`) has a column, and nothing here can tell it from data: it is
 * written back as it was stored.
 */
function columnValuesOf(
    stored: Record<string, unknown>,
    current: Record<string, unknown>,
    table: TableDescriptor,
    viewer: FieldViewer
): { values: Record<string, unknown>; dropped: string[] } {
    const unreadable = restrictedKeys(table, viewer, "read").refused;
    const values: Record<string, unknown> = {};
    const dropped: string[] = [];
    for (const [key, value] of Object.entries(stored)) {
        if (key in current || unreadable.has(key)) {
            values[key] = value;
            continue;
        }
        dropped.push(key);
    }
    return { values, dropped };
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
    /**
     * Delete every entry past the retention period, of every row; resolves to
     * how many went. Run hourly by the backend — see `retention-sweep.ts`. A
     * service without it is pruned only inline, after each write. `signal`
     * asks it to stop between batches.
     */
    pruneExpired?(options?: { signal?: AbortSignal }): Promise<number>;
    /**
     * Every entry's stored values, of every row, a page at a time — what
     * `rebase storage orphans` reads, since a revert restores them. A service
     * without it makes that scan refuse to delete anything.
     */
    scanStoredValues?(pageSize?: number): AsyncIterable<unknown[]>;
}

/** Entries returned when the caller names no `?limit`. */
const HISTORY_DEFAULT_LIMIT = 20;
/** Most entries one history read will serve. Above it the request is refused. */
const HISTORY_MAX_LIMIT = 100;

export function createHistoryRoutes(params: {
    historyService: HistoryService;
    /**
     * The tables served now — a live schema edit included: their descriptors
     * say which keep history and who may see which column.
     */
    tables: () => RestTables;
    /**
     * The unscoped driver, still accepted so the call in `init.ts` and any
     * embedder's keeps compiling — and deliberately not read. Every read and
     * write on these routes goes through the request-scoped driver instead;
     * see {@link authorizeEntityRead}.
     */
    driver: DataDriver;
}): Hono<HonoEnv> {
    const { historyService } = params;

    /** The served table at this slug, with history on; a 404 or a 400 otherwise. */
    const historyTable = (slug: string): ServedTable => {
        const { descriptors, served } = params.tables();
        const table = descriptors.find(candidate => candidate.slug === slug);
        if (!table || (served !== undefined && !served.includes(slug))) throw ApiError.notFound(`Table '${slug}' not found`);
        if (!table.history) throw ApiError.badRequest(`History is not enabled for table '${slug}'`);
        return { table };
    };
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
     *    A row in the trash is read too: `?deleted=only` lists it to the same
     *    caller, and "who deleted this, and when" is the question its history
     *    exists to answer — it was a 404 exactly while it mattered most.
     *
     * A missing scoped driver is an internal error, never a fallback to the
     * unscoped one — the same rule, and the same reason, as
     * {@link RestApiGenerator.getScopedDriver}.
     */
    async function authorizeEntityRead(
        c: Context<HonoEnv>,
        served: ServedTable,
        id: string
    ): Promise<{ row: Record<string, unknown>; scoped: DataDriver }> {
        const slug = served.table.slug;
        // A revert is a write: refused while simulating access.
        refuseSimulatedWrite(c, httpMethodToOperation(c.req.method));
        const narrowed = c.get("scopes");
        const scope = `data:${httpMethodToOperation(c.req.method)}`;
        if (narrowed && !scopeGrants(narrowed, scope, slug)) {
            throw new ApiError(403, "SCOPE_MISSING",
                `This credential does not hold "${scope}" for table "${slug}".`,
                { requiredScope: `${scope}:${slug}` });
        }

        const scoped = c.get("driver");
        if (!scoped) throw ApiError.internal("Scoped driver not available");

        // The REST read of the row: its columns, through the same policies.
        // `fetchOne` is the admin's view-model walk, which loaded every
        // declared relation of the row — every comment of a post — to answer
        // whether one row may be read. It is also the rendering a history
        // entry is stored in, which is what a revert compares it against.
        const row = scoped.restFetchService
            ? await scoped.restFetchService.fetchOneForRest(slug, id, undefined, undefined, { withDeleted: true }) ?? undefined
            : await scoped.fetchOne({ path: slug, id, withDeleted: true });
        if (!row) {
            throw ApiError.notFound(`No row with id '${id}' in table '${slug}'`);
        }
        return { row, scoped };
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

        const served = historyTable(slug);
        const { scoped } = await authorizeEntityRead(c, served, id);

        const tableName = served.table.slug;

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
            data: await servedHistoryEntries(result.data, served.table, requestViewer(c), scoped),
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

        const served = historyTable(slug);
        const table = served.table;

        // Before looking the entry up at all: the lookup is by history id alone,
        // across every table, so answering "no such entry" vs "not yours" for an
        // id the caller cannot see is itself a read of the history table.
        const { row: current, scoped } = await authorizeEntityRead(c, served, id);

        // Fetch the history entry
        const historyEntry = await historyService.fetchHistoryEntry(historyId);

        if (!historyEntry) {
            throw ApiError.notFound(`History entry '${historyId}' not found`);
        }

        // Verify the history entry belongs to this entity (prevent cross-entity revert)
        const tableName = table.slug;
        if (historyEntry.entity_id !== String(id) || historyEntry.table_name !== tableName) {
            throw ApiError.badRequest("History entry does not belong to this entity");
        }

        if (!isPlainValues(historyEntry.values)) {
            throw ApiError.badRequest("Cannot revert: history entry has no stored values");
        }
        const viewer = requestViewer(c);
        // Narrowed to columns only where `current` is the REST row: a driver
        // without the REST read hands back its own rendering, whose keys are
        // not the columns.
        const restRow = Boolean(scoped.restFetchService);
        const storedVersion = wireOfStoredVersion(historyEntry.values, table);
        const { values: columnValues, dropped } = restRow
            ? columnValuesOf(storedVersion, current, table, viewer)
            : { values: storedVersion, dropped: [] };
        const values = restorableValues(columnValues, current, table, viewer);

        // Revert by saving through the normal driver path — this will
        // itself create another history entry, giving a full audit trail.
        //
        // The request-scoped driver, with no fallback. This used to read
        // `c.get("driver") || driver`, which would have written a stored version
        // over a row on the *unscoped* handle whenever the scoped one was
        // absent — an RLS-free write, reached by the absence of a value rather
        // than by any decision. `authorizeEntityRead` above already refuses that
        // request, so the fallback was unreachable; it is gone rather than left
        // armed for whoever moves the authorization call: the driver is the
        // one it returned.
        const path = table.slug;

        const savedEntity = await scoped.save({
            path,
            id: String(id),
            values,
            status: "existing"
        });

        return c.json({
            data: savedEntity,
            meta: {
                reverted_from: historyId,
                // Keys of the stored version the row has no column for, left
                // out of the write. Only on an entry an older version recorded.
                ...(dropped.length > 0 ? { dropped_fields: dropped } : {})
            }
        });
    });

    return router;
}
