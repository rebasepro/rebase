/**
 * Entity change history — the shape a history entry has on the wire.
 *
 * This was declared three times: once in `@rebasepro/server-postgres`, once in
 * `@rebasepro/server-mongo`, and once again in the admin's `useHistory` hook.
 * The two driver copies disagreed on the one field that matters for a consumer,
 * `updated_at`, which was a `string` in Postgres and a `Date` in MongoDB — so
 * nothing could read history without first choosing a driver.
 *
 * The contract is the wire shape, and on the wire it is an ISO-8601 string.
 * A driver whose stored document differs (MongoDB keeps a `Date` and an
 * `ObjectId`) declares that storage row for itself and maps to this on the way
 * out; it is not the shared type.
 *
 * @group Backend
 */

/**
 * One recorded change to a row.
 * @group Backend
 */
export interface EntityHistoryEntry {
    id: string;
    /** The table (Postgres) or collection (MongoDB) the row belongs to. */
    table_name: string;
    /** The row's id, as a string regardless of its native type. */
    entity_id: string;
    action: "create" | "update" | "delete";
    /** Which fields changed. `null` for creates and deletes. */
    changed_fields: string[] | null;
    values: Record<string, unknown> | null;
    previous_values: Record<string, unknown> | null;
    updated_by: string | null;
    /** ISO-8601. A driver storing a native date converts on read. */
    updated_at: string;
}

/**
 * Arguments to record one change.
 * @group Backend
 */
export interface RecordHistoryParams {
    tableName: string;
    id: string;
    action: "create" | "update" | "delete";
    values?: Record<string, unknown> | null;
    previousValues?: Record<string, unknown> | null;
    updatedBy?: string | null;
}

/**
 * How much history to keep. Pruning runs per row after each write.
 * @group Backend
 */
export interface HistoryRetentionConfig {
    /** Max entries per row. Oldest pruned first. Default 200. */
    maxEntries: number;
    /** Entries older than this many days are pruned. Default 90. */
    ttlDays: number;
}

/** @group Backend */
export interface FetchHistoryOptions {
    limit?: number;
    offset?: number;
}
