import type { ColumnDescriptor } from "@rebasepro/types";
import { fieldOperationKind } from "./field-operations";

/**
 * The declared range a field operation's *result* must stay inside.
 *
 * `{ stock: -5 }` is checked against `validate({ min: 0 })` before a write,
 * because the value is in the request. What `{ stock: { $inc: -1000 } }`
 * produces depends on the stored row, so the driver compiles these bounds into
 * the UPDATE that does the arithmetic. This says which bounds apply, read from
 * the column's descriptor.
 *
 * @module
 */

/**
 * The bounds of a numeric column an `$inc` must keep to. `integer` is not
 * here: a whole increment of a whole number stays whole, and the request
 * already refuses a fractional one.
 *
 * @group Table
 */
export interface NumberOperationBounds {
    kind: "number";
    min?: number;
    max?: number;
    moreThan?: number;
    lessThan?: number;
    positive?: true;
    negative?: true;
}

/**
 * The size bounds of a list (a native array, or a JSON document that is a
 * `json.array()`) a `$push` or `$pull` must keep to.
 *
 * @group Table
 */
export interface ArrayOperationBounds {
    kind: "array";
    minItems?: number;
    maxItems?: number;
}

/**
 * What {@link fieldOperationBounds} answers.
 *
 * @group Table
 */
export type FieldOperationBounds = NumberOperationBounds | ArrayOperationBounds;

/**
 * The bounds a field operation's result on this column must keep to, or
 * `undefined` when the column declares none an operation can break.
 *
 * - a numeric column: `validate({ min, max, moreThan, lessThan, positive,
 *   negative })`, for `$inc`;
 * - a list (`fieldOperationKind` is `"array"`): `validate({ minItems,
 *   maxItems })` — on the column, or on the `json.array()` shape of a JSON
 *   list — for `$push` and `$pull`.
 *
 * `uniqueItems` / `uniqueBy` are not bounds of the result's size; the request
 * checks the pushed items against them. Replaces the `property.type` and
 * `property.validation` reads of the driver's field-operation SQL.
 *
 * @group Table
 */
export function fieldOperationBounds(column: ColumnDescriptor): FieldOperationBounds | undefined {
    // A JSON list states its size rules on its shape (`json.array(…).validate()`);
    // a lifted legacy array states them on the column.
    const rules = column.validate ?? (column.json?.kind === "array" ? column.json.validate : undefined);
    if (!rules) return undefined;
    const kind = fieldOperationKind(column);
    if (kind === "number") {
        const bounds: NumberOperationBounds = { kind: "number" };
        if (typeof rules.min === "number") bounds.min = rules.min;
        if (typeof rules.max === "number") bounds.max = rules.max;
        if (rules.moreThan !== undefined) bounds.moreThan = rules.moreThan;
        if (rules.lessThan !== undefined) bounds.lessThan = rules.lessThan;
        if (rules.positive) bounds.positive = true;
        if (rules.negative) bounds.negative = true;
        return Object.keys(bounds).length > 1 ? bounds : undefined;
    }
    if (kind === "array") {
        const bounds: ArrayOperationBounds = { kind: "array" };
        if (rules.minItems !== undefined) bounds.minItems = rules.minItems;
        if (rules.maxItems !== undefined) bounds.maxItems = rules.maxItems;
        return Object.keys(bounds).length > 1 ? bounds : undefined;
    }
    return undefined;
}
