import type { ColumnDescriptor } from "@rebasepro/types";
import { isFieldOperation, isNumericColumnType } from "@rebasepro/types";

/**
 * Which field operations a column takes, read from its descriptor.
 *
 * A field operation (`{ views: { $inc: 1 } }`) changes a stored value inside
 * the statement that holds the row lock. Each operator is defined on one kind
 * of value: `$inc` on a number, `$push` / `$pull` on a list, `$merge` on a JSON
 * object. The legacy reads asked the property's document type (`"number"`,
 * `"array"`, `"map"`); the column type says it outright.
 *
 * @module
 */

/**
 * The kind of value a field operation acts on.
 *
 * - `number` — a numeric column: `$inc`;
 * - `array` — a native array column (`text[]`, …), a `col.custom()` array type,
 *   or a JSON document whose shape is a `json.array()`: `$push`, `$pull`;
 * - `document` — a JSON document that is an object, or whose shape is not
 *   stated: `$merge`.
 *
 * @group Table
 */
export type FieldOperationKind = "number" | "array" | "document";

/**
 * The kind of value a field operation on this column acts on, or `undefined`
 * when no operator applies to it (text, a boolean, a date, a geopoint, a
 * document whose shape is a scalar or a `json.oneOf()`, …).
 *
 * Replaces `LEGAL_ON[operator].includes(property.type)`.
 *
 * @group Table
 */
export function fieldOperationKind(column: ColumnDescriptor): FieldOperationKind | undefined {
    if (column.semantic === "geopoint") return undefined;
    const type = column.type;
    if (isNumericColumnType(type)) return "number";
    if (type.kind === "array") return "array";
    if (type.kind === "other") return /\]\s*$/.test(type.sqlType) ? "array" : undefined;
    if (type.kind === "json" || type.kind === "jsonb") {
        const shape = column.json;
        if (shape === undefined || shape.kind === "object" || shape.kind === "unknown") return "document";
        if (shape.kind === "array") return "array";
    }
    return undefined;
}

/**
 * Whether a value written to this column is (or is trying to be) a field
 * operation.
 *
 * On a JSON object column, a value with `$`-prefixed keys is the document
 * unless it is exactly one real operator — `{ "$ref": "#/a" }` is data. On any
 * other column, any `$` key reads as an attempted operation, so a misspelled
 * operator is refused rather than stored. Without a column (a key the table
 * does not declare) the stricter reading applies.
 *
 * Replaces `isFieldOperation(value, property.type)`.
 *
 * @group Table
 */
export function isColumnFieldOperation(value: unknown, column: ColumnDescriptor | undefined): boolean {
    const document = column !== undefined && fieldOperationKind(column) === "document";
    return isFieldOperation(value, document ? "map" : undefined);
}
