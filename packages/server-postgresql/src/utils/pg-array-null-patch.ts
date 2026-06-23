import { getTableColumns } from "drizzle-orm";
import { PgArray, PgTable } from "drizzle-orm/pg-core";
import { logger } from "@rebasepro/server-core";

/**
 * Patches all PgArray columns on the given tables to handle NULL values safely.
 *
 * Drizzle ORM's `PgArray.mapFromDriverValue` calls `value.map(...)` without
 * guarding against `null`. When a PostgreSQL native array column (`text[]`,
 * `integer[]`, etc.) contains NULL, the pg driver returns `null` in JavaScript,
 * and `null.map(...)` throws `TypeError: value.map is not a function`.
 *
 * This function walks every column of every registered table and, for any
 * `PgArray` column, wraps its `mapFromDriverValue` to return `null` when the
 * database value is nullish.
 *
 * This is a workaround for a known Drizzle ORM issue. Should be removed once
 * Drizzle handles nullable arrays natively.
 */
export function patchPgArrayNullSafety(tables: Record<string, unknown>): void {
    let patchedCount = 0;

    for (const tableOrRelation of Object.values(tables)) {
        if (!(tableOrRelation instanceof PgTable)) continue;

        const columns = getTableColumns(tableOrRelation);
        for (const column of Object.values(columns)) {
            if (column instanceof PgArray) {
                const original = column.mapFromDriverValue.bind(column);
                column.mapFromDriverValue = function (value: unknown) {
                    if (value == null) return null;
                    return original(value as string | unknown[]);
                };
                patchedCount++;
            }
        }
    }

    if (patchedCount > 0) {
        logger.debug(`[PgArray] Patched ${patchedCount} array column(s) for null-safety`);
    }
}
