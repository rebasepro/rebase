import { and, isNotNull, isNull, SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";
import type { CollectionConfig } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

/**
 * Soft delete, in one place.
 *
 * A collection with `softDelete` records a deletion as a timestamp instead of
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
 * The field is a `date` property the collection declares itself. This module
 * resolves it and nothing more: it does not add the column, and a config that
 * turns the flag on without the property is refused at boot
 * (`assertCollectionConfigs`), where the answer is a config change, rather than
 * at the first delete, where it would be a 500 for whoever pressed the button.
 */

/** The default field, when `softDelete: true` names none. */
export const DEFAULT_SOFT_DELETE_FIELD = "deletedAt";

/** How a caller asks about deleted rows. See `FetchCollectionProps.withDeleted`. */
export type WithDeleted = boolean | "only" | undefined;

export interface SoftDeleteField {
    /** The property key — the wire name, what a `PATCH` sets to `null`. */
    field: string;
    /** The physical column, `columnName ?? snake_case(field)`. */
    columnName: string;
}

/**
 * The soft-delete field this collection uses, or `undefined` if it has none.
 *
 * Returns the field even when the property is missing, because the *boot* check
 * is what refuses that config; making this return `undefined` for it would turn
 * a misconfiguration into "soft delete quietly off", which is the failure mode
 * worth avoiding — deletes would silently start removing rows.
 */
export function resolveSoftDelete(collection: CollectionConfig | undefined): SoftDeleteField | undefined {
    const declared = (collection as { softDelete?: boolean | { field?: string } } | undefined)?.softDelete;
    if (!declared) return undefined;
    const field = (typeof declared === "object" && declared.field) || DEFAULT_SOFT_DELETE_FIELD;
    const property = (collection?.properties as Record<string, { columnName?: string }> | undefined)?.[field];
    return {
        field,
        columnName: property?.columnName ?? toSnakeCase(field)
    };
}

/**
 * The drizzle column behind the soft-delete field, if the table has one.
 *
 * Matched on the column's own `name` rather than on the key, because a
 * generated schema keys columns by the property name while an introspected one
 * may key them by the column — and this has to work for both.
 */
export function softDeleteColumn(
    collection: CollectionConfig | undefined,
    table: PgTable
): AnyPgColumn | undefined {
    const resolved = resolveSoftDelete(collection);
    if (!resolved) return undefined;
    // A registry can hand back something that is not a drizzle table (a stub in
    // a test, a collection whose schema has not been generated). No columns is
    // "no soft-delete column", not a crash on a read.
    const columns = (table ? getTableColumns(table) : undefined) as Record<string, AnyPgColumn> | undefined;
    if (!columns) return undefined;
    const direct = columns[resolved.field] ?? columns[resolved.columnName];
    if (direct) return direct;
    for (const column of Object.values(columns)) {
        if ((column as { name?: string }).name === resolved.columnName) return column;
    }
    return undefined;
}

/**
 * `deleted_at IS NULL` — or nothing, when the caller asked for the deleted rows
 * or the collection has no soft delete at all.
 *
 * The one place the rule is written. Call it from every read; `undefined` means
 * "add no condition", which composes with `and(...)` unchanged.
 */
export function softDeleteCondition(
    collection: CollectionConfig | undefined,
    table: PgTable,
    withDeleted?: WithDeleted
): SQL | undefined {
    if (withDeleted === true) return undefined;
    const column = softDeleteColumn(collection, table);
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
    collection: CollectionConfig | undefined,
    table: PgTable,
    withDeleted?: WithDeleted
): SQL[] {
    const condition = softDeleteCondition(collection, table, withDeleted);
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
    collection: CollectionConfig | undefined,
    table: PgTable,
    withDeleted?: WithDeleted
): SQL | undefined {
    const condition = softDeleteCondition(collection, table, withDeleted);
    if (!condition) return where;
    return where ? and(where, condition) : condition;
}
