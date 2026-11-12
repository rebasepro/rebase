import type { ColumnDescriptor, TableDescriptor } from "@rebasepro/types";

/**
 * Column lookup over a {@link TableDescriptor}, both ways: by key (what a row,
 * a filter and the SDK say) and by SQL name (what the catalogue, a trigger and
 * a constraint say).
 *
 * The descriptor states both names for every column — the compiler derived the
 * SQL name once — so nothing here guesses. The legacy reads these replace had
 * to: `fieldKeyForColumn` scanned `properties` for a `columnName`, then tried
 * the key itself and its snake_case, and finally camel-cased the column.
 *
 * @module
 */

/**
 * The column with this key, or `undefined`.
 *
 * Replaces `collection.properties[key]` reads that wanted the column behind a
 * key.
 *
 * @group Table
 */
export function columnByKey(table: TableDescriptor, key: string): ColumnDescriptor | undefined {
    return table.columns.find(column => column.key === key);
}

/**
 * The column with this SQL name, or `undefined`.
 *
 * Replaces scanning `properties` for a `columnName`.
 *
 * @group Table
 */
export function columnBySqlName(table: TableDescriptor, sqlName: string): ColumnDescriptor | undefined {
    return table.columns.find(column => column.column === sqlName);
}

/**
 * The key of the column with this SQL name, or `undefined` when the table has
 * no such column.
 *
 * Replaces `fieldKeyForColumn(collection, column)` — which never said "no":
 * it camel-cased any name it did not find, so a typo became a key.
 *
 * @group Table
 */
export function keyForColumn(table: TableDescriptor, sqlName: string): string | undefined {
    return columnBySqlName(table, sqlName)?.key;
}

/**
 * The SQL name of the column with this key, or `undefined` when the table has
 * no such column.
 *
 * Replaces `property.columnName ?? toSnakeCase(key)`.
 *
 * @group Table
 */
export function columnNameOf(table: TableDescriptor, key: string): string | undefined {
    return columnByKey(table, key)?.column;
}

/**
 * Both maps at once, for a reader that looks up many columns of one table —
 * a runtime record built once per table.
 *
 * @group Table
 */
export function columnMaps(table: TableDescriptor): {
    byKey: ReadonlyMap<string, ColumnDescriptor>;
    bySqlName: ReadonlyMap<string, ColumnDescriptor>;
} {
    return {
        byKey: new Map(table.columns.map(column => [column.key, column])),
        bySqlName: new Map(table.columns.map(column => [column.column, column]))
    };
}
