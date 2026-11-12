/**
 * The table definitions a lowered collection carries, read back by the planner.
 *
 * `lowerTables` (`@rebasepro/common`) attaches to every property it lowers the
 * definition it came from — `tableColumn` for a column, `tableRelation` for a
 * relation (see `LoweredDefinitions`) — and to every index the table index it
 * came from. The planner plans a column from that definition when it is there,
 * and from the legacy property fields only when it is not (a collection literal
 * written in the legacy shape, which only tests still do).
 *
 * The planner's input is typed `CollectionConfig`, the shape relation targets
 * and every shared helper hand back, so the definitions are read through the
 * guards below rather than through a wider input type: each checks the value is
 * what `lowerTables` put there, and a property without one reads as legacy.
 */
import {
    isRelationDef,
    type BelongsToDef,
    type CollectionIndex,
    type ColumnDef,
    type Property
} from "@rebasepro/types";
import type { LoweredDefinitions, LoweredIndex } from "@rebasepro/common";

/**
 * A property as the planner reads it: the legacy property, and — when it was
 * lowered from a table — the definitions it came from.
 */
export type SchemaPropertyInput = Property & LoweredDefinitions;

/** An index entry as the planner reads it. */
export type SchemaIndexInput = LoweredIndex;

const isColumnDef = (value: unknown): value is ColumnDef =>
    typeof value === "object" && value !== null
    && "type" in value && typeof value.type === "object" && value.type !== null
    && "kind" in value.type && typeof value.type.kind === "string"
    && "notNull" in value && typeof value.notNull === "boolean"
    && "primaryKey" in value && typeof value.primaryKey === "boolean";

/** The column a property was lowered from, or `undefined` for a legacy property. */
export const tableColumnOf = (prop: Property | undefined): ColumnDef | undefined => {
    if (!prop || !("tableColumn" in prop)) return undefined;
    return isColumnDef(prop.tableColumn) ? prop.tableColumn : undefined;
};

/**
 * The `rel.belongsTo` a relation property addresses, or `undefined` for a
 * legacy relation property or one of another kind.
 */
export const tableBelongsToOf = (prop: Property | undefined): BelongsToDef | undefined => {
    if (!prop || !("tableRelation" in prop)) return undefined;
    const relation = prop.tableRelation;
    return isRelationDef(relation) && relation.kind === "belongsTo" ? relation : undefined;
};

/**
 * Whether an index entry was lowered from a table's `indexes`, where `reason`
 * is optional — a legacy entry must state one.
 */
export const isTableIndex = (index: CollectionIndex): boolean =>
    "tableIndex" in index && typeof index.tableIndex === "object" && index.tableIndex !== null
    && "columns" in index.tableIndex && Array.isArray(index.tableIndex.columns);
