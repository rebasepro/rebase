/**
 * The Postgres type of a column, as a tag.
 *
 * One member per type Rebase creates, 1:1 with the planner's own `PgType`: a
 * column says which Postgres type it is, and nothing downstream has to work it
 * out from a document-shaped "string that is really a uuid". `other` is a type
 * Rebase serves but does not create (`inet`, `citext`, `interval`, a range, a
 * domain, a PostGIS type, an array of one of those, …): what introspection
 * reports for such a column, and what `col.custom(sqlType)` declares. Its value
 * is passed through as the driver returns it.
 *
 * @group Schema
 */
export type ColumnType =
    | { kind: "text" }
    | { kind: "varchar"; length: number }
    | { kind: "char"; length: number }
    | { kind: "uuid" }
    | { kind: "enum"; values: readonly string[]; name?: string }
    | { kind: "smallint" }
    | { kind: "integer" }
    | { kind: "bigint" }
    | { kind: "smallserial" }
    | { kind: "serial" }
    | { kind: "bigserial" }
    | { kind: "real" }
    | { kind: "doublePrecision" }
    | { kind: "numeric"; precision?: number; scale?: number }
    | { kind: "boolean" }
    | { kind: "timestamptz" }
    | { kind: "date" }
    | { kind: "time" }
    | { kind: "json" }
    | { kind: "jsonb" }
    | { kind: "vector"; dimensions: number }
    | { kind: "bytea" }
    | { kind: "array"; of: ColumnType }
    | { kind: "other"; sqlType: string };

/**
 * The tag of a {@link ColumnType}.
 *
 * @group Schema
 */
export type ColumnKind = ColumnType["kind"];

/** The kinds stored as text. */
export type TextColumnKind = "text" | "varchar" | "char";

/** The kinds a JavaScript `number` is read from and written to. */
export type NumericColumnKind =
    | "smallint" | "integer" | "bigint"
    | "smallserial" | "serial" | "bigserial"
    | "real" | "doublePrecision" | "numeric";

/** The kinds that hold an instant, a day or a time of day. */
export type TemporalColumnKind = "timestamptz" | "date" | "time";

const TEXT_KINDS: readonly ColumnKind[] = ["text", "varchar", "char"];
const NUMERIC_KINDS: readonly ColumnKind[] = [
    "smallint", "integer", "bigint", "smallserial", "serial", "bigserial", "real", "doublePrecision", "numeric"
];
const TEMPORAL_KINDS: readonly ColumnKind[] = ["timestamptz", "date", "time"];

/**
 * Whether a column type is stored as text (`text`, `varchar`, `char`).
 *
 * @group Schema
 */
export function isTextColumnType(type: ColumnType): boolean {
    return TEXT_KINDS.includes(type.kind);
}

/**
 * Whether a column type is read and written as a JavaScript `number`.
 *
 * @group Schema
 */
export function isNumericColumnType(type: ColumnType): boolean {
    return NUMERIC_KINDS.includes(type.kind);
}

/**
 * Whether a column type holds an instant, a day or a time of day.
 *
 * @group Schema
 */
export function isTemporalColumnType(type: ColumnType): boolean {
    return TEMPORAL_KINDS.includes(type.kind);
}

/**
 * Whether a column type is a JSON document (`json`, `jsonb`).
 *
 * @group Schema
 */
export function isJsonColumnType(type: ColumnType): boolean {
    return type.kind === "json" || type.kind === "jsonb";
}

/**
 * The SQL spelling of a column type, for messages and generated comments.
 *
 * Not the DDL renderer: an enum prints as `enum(a, b)` because its type name
 * belongs to the table it is planned in.
 *
 * @group Schema
 */
export function columnTypeLabel(type: ColumnType): string {
    switch (type.kind) {
        case "varchar": return `varchar(${type.length})`;
        case "char": return `char(${type.length})`;
        case "enum": return type.name ?? `enum(${type.values.join(", ")})`;
        case "doublePrecision": return "double precision";
        case "numeric":
            if (type.precision === undefined) return "numeric";
            return type.scale === undefined ? `numeric(${type.precision})` : `numeric(${type.precision}, ${type.scale})`;
        case "vector": return `vector(${type.dimensions})`;
        case "array": return `${columnTypeLabel(type.of)}[]`;
        case "other": return type.sqlType;
        default: return type.kind;
    }
}
