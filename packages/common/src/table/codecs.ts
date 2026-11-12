import type { ColumnDescriptor, ColumnType } from "@rebasepro/types";
import { isNumericColumnType, isTextColumnType } from "@rebasepro/types";

/**
 * How a column's value is encoded on its way to and from Postgres, read from
 * the column's Postgres type.
 *
 * The legacy codecs switched on a document-shaped property (`type: "number"`,
 * `type: "date"` plus `columnType: "time"`, `type: "array"` plus `of`,
 * `type: "geopoint"`, …). The column type says the same thing outright, so
 * every codec — the REST row, the write serialisation, the admin view model —
 * asks one of the two questions below and switches on the answer.
 *
 * @module
 */

/**
 * The encoding family of a value.
 *
 * - `number` — a numeric kind; Postgres sends `numeric` and `bigint` as text.
 * - `timestamp` — `timestamptz`: an instant.
 * - `date` — `date`: a calendar day, `YYYY-MM-DD`.
 * - `time` — `time`: a time of day.
 * - `text` — `text`, `varchar`, `char`, `uuid` or an enum.
 * - `boolean` — `boolean`.
 * - `json` — a `json`/`jsonb` document (walk its `json` shape, when it has one).
 * - `geopoint` — a `jsonb` point built with `col.geopoint()`: `{ latitude, longitude }`.
 * - `vector` — a pgvector `vector(d)`.
 * - `bytea` — raw bytes.
 * - `array` — a native Postgres array; its items take the codec of `arrayElementType`.
 * - `passthrough` — a type Rebase serves but does not create (`col.custom()`,
 *   an introspected `inet`, `interval`, range, …): the value goes to and comes
 *   from the driver untouched.
 *
 * @group Table
 */
export type ValueCodec =
    | "number"
    | "timestamp"
    | "date"
    | "time"
    | "text"
    | "boolean"
    | "json"
    | "geopoint"
    | "vector"
    | "bytea"
    | "array"
    | "passthrough";

/**
 * The encoding family of a Postgres type, without what a column adds to it
 * (its `semantic`). What a native array's items are encoded by:
 * `valueCodecOfType(arrayElementType(column.type))`.
 *
 * @group Table
 */
export function valueCodecOfType(type: ColumnType): ValueCodec {
    if (isNumericColumnType(type)) return "number";
    if (isTextColumnType(type)) return "text";
    switch (type.kind) {
        case "uuid":
        case "enum":
            return "text";
        case "boolean":
            return "boolean";
        case "timestamptz":
            return "timestamp";
        case "date":
            return "date";
        case "time":
            return "time";
        case "json":
        case "jsonb":
            return "json";
        case "vector":
            return "vector";
        case "bytea":
            return "bytea";
        case "array":
            return "array";
        default:
            return "passthrough";
    }
}

/**
 * The encoding family of a column's value: its type's
 * ({@link valueCodecOfType}), except a `col.geopoint()` column, which is a
 * `jsonb` document with a fixed shape (`geopoint`).
 *
 * Replaces the `switch (property.type)` of the write codec and the admin
 * view-model codec.
 *
 * @group Table
 */
export function valueCodecOf(column: Pick<ColumnDescriptor, "type" | "semantic">): ValueCodec {
    if (column.semantic === "geopoint") return "geopoint";
    return valueCodecOfType(column.type);
}

/**
 * What REST does to a column's value before serving it.
 *
 * - `number` — text that holds a number (`numeric`, `bigint`) becomes a number;
 * - `timestamp`, `date`, `time` — a temporal value is served as RFC 3339
 *   (a day stays `YYYY-MM-DD`, a time of day stays as Postgres wrote it);
 * - `passthrough` — served exactly as the driver returned it.
 *
 * @group Table
 */
export type RestCodec = "number" | "timestamp" | "date" | "time" | "passthrough";

/**
 * What REST does to a column's value before serving it (see {@link RestCodec}).
 *
 * Only numbers and temporal values are re-rendered; a document, a list, bytes
 * and a vector are served as the driver returns them. A foreign key is a
 * column like any other: a `bigint` key is served as a number. Replaces the
 * `property.type === "number" | "date"` reads of the REST row codec.
 *
 * @group Table
 */
export function restCodecOf(column: Pick<ColumnDescriptor, "type" | "semantic">): RestCodec {
    switch (valueCodecOf(column)) {
        case "number": return "number";
        case "timestamp": return "timestamp";
        case "date": return "date";
        case "time": return "time";
        default: return "passthrough";
    }
}
