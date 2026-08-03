/**
 * The PostgreSQL type → Rebase property type mapping.
 *
 * Split out of `introspect-db-logic` so that the structural analysis can use it
 * without importing the generator, which imports the analysis. Re-exported from
 * `introspect-db-logic` so existing callers keep their import path.
 */

/**
 * Map a PostgreSQL data type to a Rebase property type.
 */
export function mapPgType(dataType: string): string {
    const dt = dataType.toLowerCase();

    // Interval MUST be checked before numeric ("interval" contains "int")
    if (dt === "interval") return "string";

    // Array types MUST be checked before numeric ("_int4" contains "int")
    if (dt === "array" || dt.startsWith("_")) return "array";

    // Numeric types
    if (
        dt.includes("int") || // integer, smallint, bigint
        dt.includes("numeric") ||
        dt.includes("decimal") ||
        dt.includes("serial") || // serial, bigserial
        dt === "real" ||
        dt === "float4" ||
        dt === "float8" ||
        dt === "double precision" ||
        dt === "money"
    ) {
        return "number";
    }

    // Boolean
    if (dt.includes("bool")) return "boolean";

    // Date / Time
    if (dt.includes("time") || dt.includes("date")) return "date";

    // JSON
    if (dt === "json" || dt === "jsonb") return "map";

    // Binary
    if (dt === "bytea") return "binary";

    // Network types
    if (dt === "inet" || dt === "cidr" || dt === "macaddr" || dt === "macaddr8") return "string";

    // UUID
    if (dt === "uuid") return "string";

    // Text/varchar/char — default to string
    return "string";
}
