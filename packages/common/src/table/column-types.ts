import type { ColumnDescriptor, ColumnType } from "@rebasepro/types";
import { isNumericColumnType, isTextColumnType } from "@rebasepro/types";

/**
 * Predicates on a column's Postgres type that `@rebasepro/types` does not
 * already answer (`isTextColumnType`, `isNumericColumnType`,
 * `isTemporalColumnType`, `isJsonColumnType` live there).
 *
 * Each replaces a family of legacy reads that worked the answer out from a
 * document-shaped property: `type === "number"`, `type === "date"` plus
 * `columnType === "time"`, `type === "array"` plus `columnType`, a `geopoint`
 * property, an `enum` list on a string. The column type says it outright.
 *
 * @module
 */

/**
 * Whether values of this type are read and written as a JavaScript `number`.
 *
 * Every numeric kind — the integer family, the serials, `real`,
 * `double precision` and `numeric` (which Postgres sends as text and the
 * driver casts back). Replaces the `property.type === "number"` sites.
 *
 * @group Table
 */
export function isJsNumberType(type: ColumnType): boolean {
    return isNumericColumnType(type);
}

/**
 * Whether the type is one of the integer family (`smallint`, `integer`,
 * `bigint`) or a serial. Replaces `isId: "increment"` and `columnType`
 * checks that asked "is this key a counter".
 *
 * @group Table
 */
export function isIntegerFamilyType(type: ColumnType): boolean {
    return type.kind === "smallint" || type.kind === "integer" || type.kind === "bigint" || isSerialType(type);
}

/**
 * Whether the type is a serial (`smallserial`, `serial`, `bigserial`): an
 * integer the database fills from a sequence.
 *
 * @group Table
 */
export function isSerialType(type: ColumnType): boolean {
    return type.kind === "smallserial" || type.kind === "serial" || type.kind === "bigserial";
}

/**
 * Whether the type is a time of day (`time`). Replaces
 * `property.type === "date" && property.columnType === "time"`.
 *
 * @group Table
 */
export function isTimeOfDayType(type: ColumnType): boolean {
    return type.kind === "time";
}

/**
 * Whether the type is a calendar day (`date`), addressed and served as
 * `YYYY-MM-DD`. Replaces `property.type === "date" && columnType === "date"`.
 *
 * @group Table
 */
export function isDateOnlyType(type: ColumnType): boolean {
    return type.kind === "date";
}

/**
 * Whether the type is an instant (`timestamptz`).
 *
 * @group Table
 */
export function isInstantType(type: ColumnType): boolean {
    return type.kind === "timestamptz";
}

/**
 * Whether the type is a native Postgres array (`text[]`, `integer[]`, …) —
 * not a JSON array. Replaces `property.type === "array"` plus the
 * `columnType` it was stored as.
 *
 * @group Table
 */
export function isNativeArrayType(type: ColumnType): type is Extract<ColumnType, { kind: "array" }> {
    return type.kind === "array";
}

/**
 * The element type of a native array column, or `undefined` for any other
 * type. Replaces `property.of`.
 *
 * @group Table
 */
export function arrayElementType(type: ColumnType): ColumnType | undefined {
    return type.kind === "array" ? type.of : undefined;
}

/**
 * Whether the type is a Postgres enum type. Replaces `enum` lists on a string
 * property; the labels are `type.values`.
 *
 * @group Table
 */
export function isEnumType(type: ColumnType): type is Extract<ColumnType, { kind: "enum" }> {
    return type.kind === "enum";
}

/**
 * Whether the type is a pgvector `vector(d)`.
 *
 * @group Table
 */
export function isVectorType(type: ColumnType): type is Extract<ColumnType, { kind: "vector" }> {
    return type.kind === "vector";
}

/**
 * Whether the type is `bytea`.
 *
 * @group Table
 */
export function isByteaType(type: ColumnType): boolean {
    return type.kind === "bytea";
}

/**
 * Whether the column holds a point on Earth: a `jsonb` column built with
 * `col.geopoint()` (`semantic: "geopoint"`). Replaces `type === "geopoint"`.
 *
 * @group Table
 */
export function isGeopointColumn(column: ColumnDescriptor): boolean {
    return column.semantic === "geopoint";
}

/**
 * Whether a text search may match the column with `ILIKE`: a text kind
 * (`text`, `varchar`, `char`) that is not a closed set of values.
 *
 * - A Postgres enum is not text — `ILIKE` on one needs a cast and matches
 *   labels — and neither is a uuid or anything else.
 * - A text column with `.oneOf([...])` holds one of a few ids, and searching
 *   ids for a substring of what a person typed is noise: `act` matching every
 *   `active` row. Skipped, as the legacy `enum` on a string property was.
 *
 * Replaces the search-column choice that read `type === "string"` and skipped
 * `enum`.
 *
 * @group Table
 */
export function isIlikeSearchable(column: Pick<ColumnDescriptor, "type" | "oneOf">): boolean {
    return isTextColumnType(column.type) && column.oneOf === undefined;
}
