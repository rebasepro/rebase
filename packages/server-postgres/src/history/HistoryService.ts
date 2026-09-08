import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { logger } from "@rebasepro/server";
import type { EntityHistoryEntry } from "@rebasepro/types";

export type {
    RecordHistoryParams,
    FetchHistoryOptions,
    HistoryRetentionConfig
} from "@rebasepro/types";
import type { RecordHistoryParams, FetchHistoryOptions, HistoryRetentionConfig } from "@rebasepro/types";

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

/**
 * Service for recording and querying row change history.
 * Stores history entries in the `rebase.entity_history` table.
 */
export class HistoryService {
    public retention: HistoryRetentionConfig;

    constructor(
        private db: NodePgDatabase,
        retention?: Partial<HistoryRetentionConfig>
    ) {
        this.retention = { ...DEFAULT_RETENTION,
...retention };
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
     * The row and its history entry commit together or neither does. That is a
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
        const {
            tableName,
            id,
            action,
            values,
            previousValues,
            updatedBy
        } = params;

        const changedFields = previousValues && values
            ? findChangedFields(previousValues, values)
            : null;


        // Skip recording if this is an update with zero actual changes

        if (action === "update" && (!changedFields || changedFields.length === 0)) {
            return;
        }

        try {
            await this.db.execute(sql`
                INSERT INTO rebase.entity_history
                    (table_name, entity_id, action, changed_fields, "values", previous_values, updated_by)
                VALUES (
                    ${tableName},
                    ${String(id)},
                    ${action},
                    ${changedFields ? sql`ARRAY[${sql.join(changedFields.map(f => sql`${f}`), sql`, `)}]::text[]` : sql`NULL`},
                    ${values ? sql`${JSON.stringify(values)}::jsonb` : sql`NULL`},
                    ${previousValues ? sql`${JSON.stringify(previousValues)}::jsonb` : sql`NULL`},
                    ${updatedBy ?? null}
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
                       "values", previous_values, updated_by, updated_at
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
            data: dataResult.rows as unknown as HistoryEntry[],
            total
        };
    }

    /**
     * Fetch a single history entry by ID.
     */
    async fetchHistoryEntry(historyId: string): Promise<HistoryEntry | null> {
        const result = await this.db.execute(sql`
            SELECT id, table_name, entity_id, action, changed_fields,
                   "values", previous_values, updated_by, updated_at
            FROM rebase.entity_history
            WHERE id = ${historyId}
        `);

        if (result.rows.length === 0) return null;
        return result.rows[0] as unknown as HistoryEntry;
    }

    // ───────── Retention / Pruning ─────────

    /**
     * Prune history for a single row: enforce maxEntries and TTL.
     */
    async pruneEntity(tableName: string, id: string): Promise<number> {
        let deleted = 0;

        // 1. TTL — delete entries older than ttlDays
        const ttlResult = await this.db.execute(sql`
            DELETE FROM rebase.entity_history
            WHERE table_name = ${tableName}
              AND entity_id = ${String(id)}
              AND updated_at < NOW() - MAKE_INTERVAL(days => ${this.retention.ttlDays})
        `);
        deleted += ttlResult.rowCount ?? 0;

        // 2. Max entries — keep the newest maxEntries, delete the rest
        const maxResult = await this.db.execute(sql`
            DELETE FROM rebase.entity_history
            WHERE id IN (
                SELECT id FROM rebase.entity_history
                WHERE table_name = ${tableName}
                  AND entity_id = ${String(id)}
                ORDER BY updated_at DESC
                OFFSET ${this.retention.maxEntries}
            )
        `);
        deleted += maxResult.rowCount ?? 0;

        return deleted;
    }

    /**
     * Global prune: enforce TTL across ALL rows in a single sweep.
     * Intended to be called periodically (e.g. once per hour or daily).
     */
    async pruneExpired(): Promise<number> {
        const result = await this.db.execute(sql`
            DELETE FROM rebase.entity_history
            WHERE updated_at < NOW() - MAKE_INTERVAL(days => ${this.retention.ttlDays})
        `);
        return result.rowCount ?? 0;
    }
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
