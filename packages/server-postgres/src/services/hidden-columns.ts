import type { TableDescriptor } from "@rebasepro/types";
import { buildTableSearchColumnSpec, isSearchIndexColumn, type SearchColumnSpec } from "../schema/search-column";

/**
 * Keeping a table's generated search columns out of the rows a read returns.
 *
 * A table's `search` block adds physical columns (the `tsvector`, and the
 * trigram text when fuzzy), so `SELECT *` returns them. They are an index in
 * column form and nothing outside the query planner has any use for them; left
 * in, every list response carries a second, larger copy of the row's text.
 *
 * Read from the table's descriptor (`buildTableSearchColumnSpec`, the same
 * builder the planner creates the columns with), plus any column whose type
 * only ever holds a search index (`isSearchIndexColumn` — an introspected
 * database can carry a `tsvector` this framework never created).
 *
 * @module
 */

/** The generated column names a table's search block adds, if any. */
export function searchColumnNamesOf(table: TableDescriptor): string[] {
    let spec: SearchColumnSpec | undefined;
    try {
        spec = buildTableSearchColumnSpec(table);
    } catch {
        // A malformed block is reported at boot, loudly. A read is the wrong
        // place to raise it a second time, and returning the row without the
        // exclusion would be worse than returning it with.
        return [];
    }
    if (!spec) return [];
    return spec.fuzzy ? [spec.column, spec.fuzzy.column] : [spec.column];
}

/**
 * The columns to keep out of a response, by name.
 *
 * `tableColumns` is whatever `getTableColumns` returned, which is `undefined`
 * for anything that is not a real drizzle table (a stub in a test). Nothing to
 * exclude is the answer there, never a throw: this runs on every read.
 */
function excludedColumnNames(
    tableColumns: Record<string, { getSQLType?: () => string }> | undefined,
    table: TableDescriptor | undefined
): string[] {
    if (!tableColumns || typeof tableColumns !== "object") return [];
    const byName = new Set(table ? searchColumnNamesOf(table) : []);
    return Object.keys(tableColumns).filter(
        name => byName.has(name) || isSearchIndexColumn(tableColumns[name])
    );
}

/**
 * A drizzle select projection over `tableColumns` with the search columns
 * dropped. `undefined` when nothing needs dropping, so the common case keeps a
 * plain `select()`.
 */
export function visibleColumnProjection<C extends { getSQLType?: () => string }>(
    tableColumns: Record<string, C> | undefined,
    table?: TableDescriptor
): Record<string, C> | undefined {
    const excluded = excludedColumnNames(tableColumns, table);
    if (!tableColumns || excluded.length === 0) return undefined;
    const projection: Record<string, C> = {};
    for (const [name, column] of Object.entries(tableColumns)) {
        if (!excluded.includes(name)) projection[name] = column;
    }
    return projection;
}

/** The same exclusion as a drizzle `db.query` `columns` denylist. */
export function hiddenColumnsOption(
    tableColumns: Record<string, { getSQLType?: () => string }> | undefined,
    table?: TableDescriptor
): Record<string, false> | undefined {
    const excluded = excludedColumnNames(tableColumns, table);
    if (excluded.length === 0) return undefined;
    return Object.fromEntries(excluded.map(name => [name, false as const]));
}
