import type { ColumnDescriptor, JsonPathStep, TableDescriptor } from "@rebasepro/types";

import { walkJsonShape } from "./json-shape";

/**
 * Where a table holds a user's id: the columns written with `.userId()`
 * (`semantic: "user"`), the items of an array of them, and `.userId()` fields
 * inside a JSON document. The panel offers a user picker for each, and a
 * caller who may write such a table may look users up to fill it.
 *
 * Replaces the legacy walk for `userSelect` string properties through maps and
 * arrays.
 *
 * @module
 */

/**
 * One position of a table that holds a user's id.
 *
 * @group Table
 */
export interface UserReferencePosition {
    /** The column it sits in. */
    column: ColumnDescriptor;
    /** From the column's value to the id: `[]`, `[{ items: true }]`, or a path inside a JSON document. */
    path: JsonPathStep[];
}

/**
 * Every position of a table that holds a user's id, columns in physical order.
 *
 * @group Table
 */
export function userReferencePositions(table: TableDescriptor): UserReferencePosition[] {
    const out: UserReferencePosition[] = [];
    for (const column of table.columns) {
        if (column.semantic === "user") out.push({ column, path: [] });
        if (column.element?.semantic === "user") out.push({ column, path: [{ items: true }] });
        if (column.json) {
            walkJsonShape(column.json, ({ shape, path }) => {
                if (shape.kind === "string" && shape.semantic === "user") out.push({ column, path });
            });
        }
    }
    return out;
}

/**
 * Whether the table holds a user's id anywhere.
 *
 * @group Table
 */
export function referencesUsers(table: TableDescriptor): boolean {
    return userReferencePositions(table).length > 0;
}
