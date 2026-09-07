import { getTableColumns } from "drizzle-orm";
import { PgArray, PgNumeric, PgTable } from "drizzle-orm/pg-core";
import { logger } from "@rebasepro/server";

/**
 * Serve NUMERIC columns as JavaScript numbers.
 *
 * A property declared `type: "number"` without `validation.integer` becomes a
 * Postgres `numeric` column (see `generate-drizzle-schema-logic`). Postgres
 * sends `numeric` as text, node-postgres registers no parser for OID 1700, and
 * drizzle's `PgNumeric.mapFromDriverValue` keeps the string — so a price
 * written as `2.5` reads back as `"2.5"`. The generated SDK types that field
 * `number`, the OpenAPI document this server publishes says `type: number`, and
 * the admin's view model parses it as a number, so the string is the one shape
 * nothing in the system claims. It also breaks *asymmetrically*: the create
 * response carries the number and the read that follows carries the string, so
 * a client that multiplies a price works until the first refresh.
 *
 * Cast here — in the driver's row mapping — rather than in one of the read
 * paths, because there are several of them (the relational query builder, the
 * `select` fallback, the realtime frame, the admin's view model) and only the
 * REST renderer used to coerce. Every one of them goes through the column's
 * `mapFromDriverValue`, so this is the single place that cannot be bypassed.
 *
 * The cast is safe for what a `number` property can hold: declaring a property
 * `number` already promises double precision — that is what the admin has
 * always parsed it to and what the generated `Row` type says. A column wider
 * than a double (a hand-written `numeric(38, 0)` reached through an
 * introspected collection) loses precision, which is the trade the declared
 * type already made.
 *
 * `null` stays `null`; an unparseable value stays whatever the driver sent,
 * because inventing `NaN` for it would be worse than passing it through.
 */
export function patchPgNumericToNumber(tables: Record<string, unknown>): void {
    let patchedCount = 0;

    const patch = (column: PgNumeric<never>): void => {
        // Idempotent: bootstrapping twice in one process (two data sources
        // sharing a table object) must not stack wrappers.
        const marked = column as unknown as { __rebaseNumericPatched?: boolean };
        if (marked.__rebaseNumericPatched) return;
        marked.__rebaseNumericPatched = true;

        column.mapFromDriverValue = function (value: unknown) {
            if (value === null || value === undefined) return value as never;
            if (typeof value === "number") return value as never;
            const parsed = Number(value);
            return (Number.isNaN(parsed) ? value : parsed) as never;
        };
        patchedCount++;
    };

    for (const tableOrRelation of Object.values(tables)) {
        if (!(tableOrRelation instanceof PgTable)) continue;

        for (const column of Object.values(getTableColumns(tableOrRelation))) {
            if (column instanceof PgNumeric) {
                patch(column as PgNumeric<never>);
                continue;
            }
            // `numeric[]`: the array column parses the literal and hands each
            // element to its base column, so the base column is what to patch.
            if (column instanceof PgArray && column.baseColumn instanceof PgNumeric) {
                patch(column.baseColumn as PgNumeric<never>);
            }
        }
    }

    if (patchedCount > 0) {
        logger.debug(`[PgNumeric] ${patchedCount} numeric column(s) will be served as numbers`);
    }
}
