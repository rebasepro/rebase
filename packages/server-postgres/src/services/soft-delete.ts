import { and, isNotNull, isNull, SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";
import { softDeleteColumn as softDeleteColumnOf } from "@rebasepro/common";
import { ApiError } from "@rebasepro/server";
import type { RuntimeTable } from "../model/runtime-table";

/**
 * Soft delete, in one place.
 *
 * A table with `softDelete` records a deletion as a timestamp instead of
 * removing the row, which means two things have to hold everywhere and not
 * almost everywhere:
 *
 *  1. a delete writes the stamp rather than issuing `DELETE`;
 *  2. **every** read hides stamped rows unless asked otherwise.
 *
 * The second is the one that goes wrong. A listing that filters and a `count`
 * that does not is a page saying "1 of 4 results"; a relation load that does not
 * is a deleted comment reappearing under its post. So the condition is built by
 * exactly one function, here, and the read paths call it — rather than each
 * path growing its own `isNull(...)`, which is how these features rot.
 *
 * The field is a timestamp column the table declares itself, named by the
 * table's descriptor (`softDelete.field`). This module resolves it and nothing
 * more: it does not add the column, and a definition that turns the flag on
 * without the column does not compile, so the answer is a schema change at
 * boot rather than a 500 at the first delete.
 */

/** How a caller asks about deleted rows. See `FetchCollectionProps.withDeleted`. */
export type WithDeleted = boolean | "only" | undefined;

export interface SoftDeleteField {
    /** The column key — the wire name, what a `PATCH` sets to `null`. */
    field: string;
    /** The SQL column name. */
    columnName: string;
}

/**
 * The soft-delete column of this table, or `undefined` if it has none.
 *
 * Read from the descriptor, which names both the key and the SQL name, so
 * nothing is derived here.
 */
export function resolveSoftDelete(table: RuntimeTable | undefined): SoftDeleteField | undefined {
    const column = table ? softDeleteColumnOf(table.descriptor) : undefined;
    return column ? { field: column.key, columnName: column.column } : undefined;
}

/**
 * The drizzle column behind the soft-delete field, if the catalogue table has
 * one.
 *
 * Matched on the key first, then on the column's own `name`, because a table
 * read back from the catalogue keys columns by wire name while a hand-written
 * drizzle table may key them by the column — and this has to work for both.
 *
 * @param pg The drizzle table the statement is built on.
 */
export function softDeleteColumn(
    table: RuntimeTable | undefined,
    pg: PgTable
): AnyPgColumn | undefined {
    const resolved = resolveSoftDelete(table);
    if (!resolved) return undefined;
    // A registry can hand back something that is not a drizzle table (a stub in
    // a test). No columns is "no soft-delete column", not a crash on a read.
    const columns = (pg ? getTableColumns(pg) : undefined) as Record<string, AnyPgColumn> | undefined;
    if (!columns) return undefined;
    const direct = columns[resolved.field] ?? columns[resolved.columnName];
    if (direct) return direct;
    for (const column of Object.values(columns)) {
        if (column.name === resolved.columnName) return column;
    }
    return undefined;
}

/**
 * `deleted_at IS NULL` — or nothing, when the caller asked for the deleted rows
 * or the table has no soft delete at all.
 *
 * The one place the rule is written. Call it from every read; `undefined` means
 * "add no condition", which composes with `and(...)` unchanged.
 */
export function softDeleteCondition(
    table: RuntimeTable | undefined,
    pg: PgTable,
    withDeleted?: WithDeleted
): SQL | undefined {
    if (withDeleted === true) return undefined;
    const column = softDeleteColumn(table, pg);
    if (!column) return undefined;
    return withDeleted === "only" ? isNotNull(column) : isNull(column);
}

/**
 * Fold the soft-delete condition into a list of conditions that is being built.
 *
 * A convenience for the call sites that already collect `SQL[]`, so adding soft
 * delete to one of them is a single line rather than three.
 */
export function withSoftDelete(
    conditions: SQL[],
    table: RuntimeTable | undefined,
    pg: PgTable,
    withDeleted?: WithDeleted
): SQL[] {
    const condition = softDeleteCondition(table, pg, withDeleted);
    if (condition) conditions.push(condition);
    return conditions;
}

/**
 * Combine an existing `where` with the soft-delete condition.
 *
 * For the call sites that hold one composed condition rather than a list.
 */
export function andSoftDelete(
    where: SQL | undefined,
    table: RuntimeTable | undefined,
    pg: PgTable,
    withDeleted?: WithDeleted
): SQL | undefined {
    const condition = softDeleteCondition(table, pg, withDeleted);
    if (!condition) return where;
    return where ? and(where, condition) : condition;
}

/**
 * The refusal of an upsert whose key belongs to a row in the trash.
 *
 * The key is taken — the stamped row still holds it — so the write cannot be a
 * create, and an upsert is not the operation that brings a deleted row back:
 * that is the restore, an update setting the field to `null`, which goes
 * through the update gate and is what history records as one. Left to the
 * statement, `INSERT … ON CONFLICT DO UPDATE` wrote the new values into the
 * hidden row and the caller was told "created", with the row still in the trash.
 */
export function rowInTrashError(path: string, key: string, softDelete: SoftDeleteField): ApiError {
    return ApiError.conflict(
        `"${key}" in "${path}" is in the trash, so an upsert cannot write it. Restore the row first `
        + `(an update setting '${softDelete.field}' to null), or purge it (a delete with ?hard=true) and upsert again.`,
        "ROW_IN_TRASH"
    );
}
