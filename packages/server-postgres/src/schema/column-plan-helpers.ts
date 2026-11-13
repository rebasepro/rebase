/**
 * TRANSITIONAL (Postgres-first Stage B): the SQL column name of a legacy
 * `Property`, for the collection door of the index builder
 * (`buildCollectionIndexSpecs` in `table-index.ts`) and the tests that
 * still state fixtures as collections. The planner reads descriptors and never
 * imports this; it is deleted with the collection door.
 */
import type { ColumnDef, Property } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

const isColumnDef = (value: unknown): value is ColumnDef =>
    typeof value === "object" && value !== null
    && "type" in value && typeof value.type === "object" && value.type !== null
    && "kind" in value.type && typeof value.type.kind === "string"
    && "notNull" in value && typeof value.notNull === "boolean"
    && "primaryKey" in value && typeof value.primaryKey === "boolean";

/**
 * The column definition `lowerTables` attached to a lowered property
 * (`tableColumn`), or `undefined` for a legacy property.
 */
const tableColumnOf = (prop: Property | undefined): ColumnDef | undefined => {
    if (!prop || !("tableColumn" in prop)) return undefined;
    return isColumnDef(prop.tableColumn) ? prop.tableColumn : undefined;
};

/**
 * Resolve the SQL column name for a property.
 *
 * Uses the explicit `columnName` when set (e.g. from introspection), falling
 * back to `toSnakeCase(propName)` for manually-authored collections.
 */
export const resolveColumnName = (propName: string, prop?: Property | null): string => {
    // A column lowered from a table states its name, or takes its key's.
    const definition = prop && prop.type !== "relation" ? tableColumnOf(prop) : undefined;
    if (definition) return definition.column ?? toSnakeCase(propName);
    if (prop && "columnName" in prop && typeof prop.columnName === "string") {
        return prop.columnName;
    }
    return toSnakeCase(propName);
};
