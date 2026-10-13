import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ApiError, logger } from "@rebasepro/server";
import type { EntityHistoryEntry } from "@rebasepro/types";

export type {
    RecordHistoryParams,
    FetchHistoryOptions,
    HistoryRetentionConfig
} from "@rebasepro/types";
import type { RecordHistoryParams, FetchHistoryOptions, HistoryRetentionConfig } from "@rebasepro/types";
import { firstSqlRow, sqlRows, withRelationReferencesOnly } from "@rebasepro/common";
import { currentWriteScope } from "../services/write-transaction-scope";
import { RECORD_HISTORY_FUNCTION, type HistoryTableState } from "./ensure-history-table";

/**
 * A Postgres history row is already the wire shape — `updated_at` comes back
 * from the driver as a string. Kept as an alias because the name is used
 * throughout this package and in `PostgresBackendDriver`.
 */
export type HistoryEntry = EntityHistoryEntry;

const DEFAULT_RETENTION: HistoryRetentionConfig = {
    maxEntries: 200,
    ttlDays: 90
};

/** Entries one statement of {@link HistoryService.pruneExpired} deletes at most. */
export const PRUNE_BATCH_SIZE = 5_000;

/**
 * Service for recording and querying row change history.
 * Stores history entries in the `rebase.entity_history` table.
 */
export class HistoryService {
    public retention: HistoryRetentionConfig;

    /**
     * Whether {@link RECORD_HISTORY_FUNCTION} exists, so an entry recorded
     * inside a write goes on that write's transaction. Without it, entries go
     * through the pool and commit on their own.
     */
    private readonly inTransaction: boolean;

    /**
     * What new entries are stored as — see `EntityHistoryEntry.format`. `2`,
     * the previous values of the changed fields only, needs the table's
     * `format` column, so it is what `ensureHistoryTableExists` found; a
     * service built without saying stores whole rows, as it always did.
     */
    private readonly entryFormat: 1 | 2;

    /**
     * What the database lacks for history to be recorded, when it lacks
     * something — `the rebase.entity_history table`. Set for a driver opened
     * without provisioning on a database no boot with history has prepared:
     * writes to a `history: true` collection are then refused before they
     * start (see {@link assertRecordable}), rather than made without their
     * audit entries.
     */
    private readonly unavailable?: string;

    /**
     * Whether recording an entry also prunes that row's history to
     * {@link retention}. Off for a process that does not know the retention the
     * project's server is configured with — `openRebase` — which would
     * otherwise delete entries the server keeps. What it leaves is pruned by
     * the server: the row's next write, and the hourly sweep.
     */
    private readonly pruneOnRecord: boolean;

    constructor(
        private db: NodePgDatabase,
        retention?: Partial<HistoryRetentionConfig>,
        options?: Partial<HistoryTableState> & { unavailable?: string; pruneOnRecord?: boolean }
    ) {
        this.retention = { ...DEFAULT_RETENTION,
...retention };
        this.inTransaction = options?.inTransaction === true;
        this.entryFormat = options?.entryFormat === 2 ? 2 : 1;
        this.unavailable = options?.unavailable;
        this.pruneOnRecord = options?.pruneOnRecord !== false;
    }

    /**
     * Refuse a write to `collection` (a `history: true` collection's slug)
     * when its entry could not be recorded. Called by the driver before the
     * write runs anything — hooks included — so a refused write has no side
     * effects. Reads are never refused.
     */
    assertRecordable(collection: string): void {
        if (!this.unavailable) return;
        throw ApiError.serviceUnavailable(
            `Collection "${collection}" keeps history (\`history: true\`), but this database has no ` +
            `${this.unavailable} — no backend with history enabled has provisioned it. The write was refused ` +
            "rather than made without its audit entry; reads still work. Provision it by starting the backend " +
            "once with `history` enabled and `provision: true` (`rebase dev` does).",
            "HISTORY_UNAVAILABLE"
        );
    }

    /**
     * Record a history entry for a row change.
     *
     * ## Why this is allowed to fail the write
     *
     * It used to swallow every error into a log line, and the driver called it
     * without `await`, so the promise was dropped on the floor. Both halves of
     * that made the same claim: that the audit trail is a nice-to-have. It is
     * not — `history: true` is opted into by collections whose changes somebody
     * has to be able to reconstruct, and a trail with gaps is worse than no
     * trail, because nothing distinguishes "no change was made" from "the entry
     * did not get written". The gaps were silent and unbounded: a transient
     * error on the history insert lost the entry for a row that committed
     * anyway, and nobody found out.
     *
     * So it throws, and the driver awaits it inside the write's transaction.
     * The row and its history entry commit together or neither does — which
     * needs the entry written *on* that transaction, not merely while it is
     * open. This service is built once, on the pool, and for a long time it
     * wrote there: a batch that rolled back after its first row left that
     * row's entry behind, describing a row that never existed. Inside a write
     * it now goes through {@link RECORD_HISTORY_FUNCTION} on the write's own
     * transaction (found through `currentWriteScope`). That is a
     * real trade — a broken `rebase.entity_history` now fails writes to the
     * collections that declare history, where before it failed quietly — and it
     * is the right side of it for a table that exists to answer "who changed
     * this". The table is created at boot (`ensureHistoryTableExists`), so the
     * failure mode is a database that is broken in other ways too.
     *
     * The pruning pass stays non-blocking: a prune that does not run leaves
     * *extra* history, which is not a loss and is fixed by the next write.
     */
    async recordHistory(params: RecordHistoryParams): Promise<void> {
        const { tableName, id, action, updatedBy } = params;
        this.assertRecordable(tableName);
        // A relation is stored as its reference, never the related row's
        // values: reading this row's history is not reading the rows it
        // points at. See `withRelationReferencesOnly`.
        const values = params.values ? withRelationReferencesOnly(params.values) : params.values;
        const previousValues = params.previousValues ? withRelationReferencesOnly(params.previousValues) : params.previousValues;

        const changedFields = previousValues && values
            ? findChangedFields(previousValues, values)
            : null;


        // Skip recording if this is an update with zero actual changes

        if (action === "update" && (!changedFields || changedFields.length === 0)) {
            return;
        }

        // An update's previous values, for the fields it changed — every other
        // field held what it holds now, which `values` already records. Two
        // copies of the whole row was 1,108 of a 1,256-byte entry for a
        // one-field change to a 20-field row. A revert writes `values`, so it
        // reads the same entry either way.
        const compact = this.entryFormat === 2;
        const storedPrevious = compact && previousValues && changedFields
            ? previousValuesOf(previousValues, changedFields)
            : previousValues;
        const format = compact ? sql`, ${2}::smallint` : sql``;

        try {
            // Checked and used with no `await` between, so the transaction
            // cannot close in the gap.
            const scope = this.inTransaction ? currentWriteScope() : undefined;
            if (scope?.tx) {
                await scope.track(scope.tx.execute(sql`
                    SELECT ${sql.raw(RECORD_HISTORY_FUNCTION)}(
                        ${tableName},
                        ${String(id)},
                        ${action},
                        ${changedFields ? sql`ARRAY[${sql.join(changedFields.map(f => sql`${f}`), sql`, `)}]::text[]` : sql`NULL::text[]`},
                        ${values ? sql`${JSON.stringify(values)}::jsonb` : sql`NULL::jsonb`},
                        ${storedPrevious ? sql`${JSON.stringify(storedPrevious)}::jsonb` : sql`NULL::jsonb`},
                        ${updatedBy ?? null}::text${format}
                    )
                `));
            } else await this.db.execute(sql`
                INSERT INTO rebase.entity_history
                    (table_name, entity_id, action, changed_fields, "values", previous_values, updated_by${compact ? sql`, format` : sql``})
                VALUES (
                    ${tableName},
                    ${String(id)},
                    ${action},
                    ${changedFields ? sql`ARRAY[${sql.join(changedFields.map(f => sql`${f}`), sql`, `)}]::text[]` : sql`NULL`},
                    ${values ? sql`${JSON.stringify(values)}::jsonb` : sql`NULL`},
                    ${storedPrevious ? sql`${JSON.stringify(storedPrevious)}::jsonb` : sql`NULL`},
                    ${updatedBy ?? null}${format}
                )
            `);
        } catch (error) {
            logger.error("Failed to record row history", { error });
            // Rethrown, not swallowed. See the docblock: the entry commits with
            // its row or the write does not happen. Wrapped so the caller reads
            // a sentence naming the audit trail rather than a bare SQLSTATE
            // from a table they did not know they were writing to.
            throw new Error(
                `Could not record the history entry for "${tableName}" (${String(id)}). ` +
                "The write was rolled back: this collection declares `history: true`, and a row " +
                "that commits without its audit entry leaves a gap nothing can distinguish from " +
                "\"no change was made\".",
                { cause: error }
            );
        }

        // Non-blocking prune for this specific row. Outside the try, and
        // deliberately not awaited: a prune that fails leaves *extra* history,
        // which is not a loss and is fixed by the next write to this row.
        if (!this.pruneOnRecord) return;
        this.pruneEntity(tableName, id).catch(err =>
            logger.error("History prune failed", { error: err })
        );
    }

    /**
     * Fetch history entries for an row, ordered by most recent first.
     */
    async fetchHistory(
        tableName: string,
        id: string,
        options: FetchHistoryOptions = {}
    ): Promise<{ data: HistoryEntry[]; total: number }> {
        const limit = options.limit ?? 20;
        const offset = options.offset ?? 0;

        const [countResult, dataResult] = await Promise.all([
            this.db.execute(sql`
                SELECT COUNT(*) as count
                FROM rebase.entity_history
                WHERE table_name = ${tableName}
                  AND entity_id = ${String(id)}
            `),
            this.db.execute(sql`
                SELECT id, table_name, entity_id, action, changed_fields,
                       "values", previous_values, updated_by, updated_at, ${this.formatColumn()}
                FROM rebase.entity_history
                WHERE table_name = ${tableName}
                  AND entity_id = ${String(id)}
                ORDER BY updated_at DESC
                LIMIT ${limit}
                OFFSET ${offset}
            `)
        ]);

        const total = parseInt(
            (countResult.rows[0] as Record<string, string>)?.count ?? "0",
            10
        );

        return {
            data: sqlRows<HistoryEntry>(dataResult),
            total
        };
    }

    /**
     * Fetch a single history entry by ID.
     */
    async fetchHistoryEntry(historyId: string): Promise<HistoryEntry | null> {
        const result = await this.db.execute(sql`
            SELECT id, table_name, entity_id, action, changed_fields,
                   "values", previous_values, updated_by, updated_at, ${this.formatColumn()}
            FROM rebase.entity_history
            WHERE id = ${historyId}
        `);

        return firstSqlRow<HistoryEntry>(result) ?? null;
    }

    /**
     * Each entry's `format`. A table without the column holds only entries
     * that store the whole previous row, which is what `1` says.
     */
    private formatColumn() {
        return this.entryFormat === 2 ? sql`format` : sql`1::smallint AS format`;
    }

    // ───────── Retention / Pruning ─────────

    /**
     * Prune history for a single row: enforce maxEntries and TTL.
     */
    async pruneEntity(tableName: string, id: string): Promise<number> {
        // One statement for both rules: older than `ttlDays`, or beyond the
        // newest `maxEntries`. They were two DELETEs, each its own pool
        // checkout after every recorded change — 2,000 of them queued by a
        // 1,000-row bulk. Together they remove the same rows: an expired entry
        // is older than every live one, so the newest `maxEntries` of all of
        // them are the newest of the live ones whenever there are that many,
        // and otherwise every entry past them has expired anyway.
        const result = await this.db.execute(sql`
            DELETE FROM rebase.entity_history
            WHERE table_name = ${tableName}
              AND entity_id = ${String(id)}
              AND (
                updated_at < NOW() - MAKE_INTERVAL(days => ${this.retention.ttlDays})
                OR id IN (
                    SELECT id FROM rebase.entity_history
                    WHERE table_name = ${tableName}
                      AND entity_id = ${String(id)}
                    ORDER BY updated_at DESC
                    OFFSET ${this.retention.maxEntries}
                )
              )
        `);
        return result.rowCount ?? 0;
    }

    /**
     * Delete every entry older than `ttlDays`, whichever row it belongs to.
     *
     * The inline prune above only ever visits a row that was just written,
     * so a row nobody writes again — every deleted one — kept its history for
     * good, whatever `ttlDays` said. This is the other half: the backend runs
     * it once an hour, on one instance of the fleet (see
     * `startHistoryRetentionSweep` in `@rebasepro/server`).
     *
     * In batches of {@link PRUNE_BATCH_SIZE}, each its own statement, repeated
     * until one comes back short: a first sweep over a year of backlog is many
     * short deletes, not one that holds millions of row locks and a pool
     * connection for minutes. `SKIP LOCKED`, so two instances sweeping at once
     * (or a sweep meeting an inline prune) split the work instead of waiting
     * on each other. Each batch reads `idx_history_updated_at`, built in the
     * background at boot (`ensureHistoryIndexes`).
     *
     * `signal` ends it after the batch in flight: a shutdown waits for the
     * sweep, and a first sweep over a large backlog is hundreds of batches.
     * What is left goes in the next sweep.
     */
    async pruneExpired(options?: { signal?: AbortSignal }): Promise<number> {
        let total = 0;
        for (;;) {
            if (options?.signal?.aborted) return total;
            const result = await this.db.execute(sql`
                DELETE FROM rebase.entity_history
                WHERE id IN (
                    SELECT id FROM rebase.entity_history
                    WHERE updated_at < NOW() - MAKE_INTERVAL(days => ${this.retention.ttlDays})
                    LIMIT ${PRUNE_BATCH_SIZE}
                    FOR UPDATE SKIP LOCKED
                )
            `);
            const deleted = result.rowCount ?? 0;
            total += deleted;
            if (deleted < PRUNE_BATCH_SIZE) return total;
        }
    }
}


/**
 * What `previous` held in `fields`. A field it did not have is left out, so it
 * reads as absent before the change, as it was.
 */
function previousValuesOf(previous: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
    const kept: Record<string, unknown> = {};
    for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(previous, field)) kept[field] = previous[field];
    }
    return kept;
}

/**
 * Deep equality without JSON.stringify.
 * Handles primitives, arrays, Dates, and plain objects recursively.
 */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (typeof a === "object" && typeof b === "object") {
        const aObj = a as Record<string, unknown>;
        const bObj = b as Record<string, unknown>;
        const aKeys = Object.keys(aObj);
        const bKeys = Object.keys(bObj);
        if (aKeys.length !== bKeys.length) return false;
        return aKeys.every(k => deepEqual(aObj[k], bObj[k]));
    }
    return false;
}

/**
 * Shallow comparison to find top-level keys that changed between two objects.
 */
export function findChangedFields(
    oldValues: Record<string, unknown>,
    newValues: Record<string, unknown>
): string[] | null {
    const changed: string[] = [];
    const allKeys = new Set([
        ...Object.keys(oldValues),
        ...Object.keys(newValues)
    ]);

    for (const key of allKeys) {
        const oldVal = oldValues[key];
        const newVal = newValues[key];

        // Skip internal metadata
        if (key.startsWith("__")) continue;

        if (oldVal !== newVal) {
            // For objects/arrays, use structural comparison
            if (
                typeof oldVal === "object" && oldVal !== null &&
                typeof newVal === "object" && newVal !== null
            ) {
                if (!deepEqual(oldVal, newVal)) {
                    changed.push(key);
                }
            } else {
                changed.push(key);
            }
        }
    }

    return changed.length > 0 ? changed : null;
}
