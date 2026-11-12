import type { ColumnDescriptor, ColumnStamp, TableDescriptor } from "@rebasepro/types";

/**
 * What the server writes into a row on its own: stamps and defaults.
 *
 * @module
 */

/**
 * The stamp a column carries, or `undefined`.
 *
 * Replaces the `autoValue` reads: `on_create` is `{ on: "create", value: "now" }`,
 * `on_update` is `{ on: "update", value: "now" }`, `user_on_create` and
 * `user_on_update` the same with `value: "user"`.
 *
 * @group Table
 */
export function stampOf(column: ColumnDescriptor): ColumnStamp | undefined {
    return column.stamp;
}

/**
 * The keys of the top-level columns stamped once, when the row is created
 * (`.onCreateNow()`, `.onCreateUser()`).
 *
 * What they hold is a fact about the row's creation, so an update — and the
 * conflict-update of an upsert that met a stored row — leaves them alone.
 * Replaces `createStampKeys(properties)` (PersistService), which read
 * `autoValue: "on_create" | "user_on_create"`. Top level only: a stamp inside a
 * JSON document is part of that document's value (see `walkJsonShape`).
 *
 * @group Table
 */
export function createStampKeys(table: TableDescriptor): string[] {
    return table.columns.filter(column => column.stamp?.on === "create").map(column => column.key);
}

/**
 * The keys of the top-level columns stamped on every write
 * (`.onUpdateNow()`, `.onUpdateUser()`).
 *
 * Replaces the `autoValue: "on_update" | "user_on_update"` reads of
 * `updateDateAutoValues` / `updateUserAutoValues`.
 *
 * @group Table
 */
export function updateStampKeys(table: TableDescriptor): string[] {
    return table.columns.filter(column => column.stamp?.on === "update").map(column => column.key);
}

/**
 * The value the driver writes into a column a create leaves out, or
 * `undefined` when it writes none.
 *
 * Only a literal `.default(value)` is applied by the driver — so every writer
 * (REST, in-process, batch) produces the same row as the DDL default would.
 * A `random-uuid`, `identity`, `sql` or `database` default is the database's
 * to fill; the driver leaves the column out of the INSERT. Returned wrapped,
 * so a literal default of `null` is told apart from none.
 *
 * Replaces the column half of `applyDefaultValuesOnCreate` (common's
 * `util/entities`), which read `defaultValue`. Its other half — dropping a
 * `null` sent for a `databaseDefault` column so the database fills it — is
 * {@link databaseOwnsDefault}.
 *
 * @group Table
 */
export function defaultOnCreate(column: ColumnDescriptor): { value: unknown } | undefined {
    return column.default?.kind === "literal" ? { value: column.default.value } : undefined;
}

/**
 * Whether the database owns this column's default without Rebase stating it
 * (`.dbDefault()`): a create that sends `null` for it means "nothing given",
 * so the column is left out of the INSERT for the database to fill rather
 * than stored as NULL.
 *
 * Replaces the `databaseDefault` read of `applyDefaultValuesOnCreate`.
 *
 * @group Table
 */
export function databaseOwnsDefault(column: ColumnDescriptor): boolean {
    return column.default?.kind === "database";
}
