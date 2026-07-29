import type { StringProperty } from "@rebasepro/types";

/**
 * The length a bounded string column is declared with when the property does
 * not say. Historical: it is what the DDL generator hardcoded, kept so that
 * regenerating an existing schema does not silently redefine its columns.
 */
export const DEFAULT_STRING_COLUMN_LENGTH = 255;

/**
 * How wide a `varchar`/`char` column should be for a given property.
 *
 * One definition, three call sites, because they used to disagree. For the same
 * `columnType: "varchar"` property the DDL generator emitted `VARCHAR(255)`
 * while the Drizzle generator emitted a bare `varchar("col")` — which Postgres
 * reads as *unbounded* — so which of the two you ran decided whether the column
 * had a limit at all. Introspection then dropped the length entirely, so reading
 * an existing `character varying(500)` column back and regenerating it produced
 * a `VARCHAR(255)`: a silent narrowing of a column with data already in it.
 *
 * `validation.max` is the property's own statement about how long the value may
 * be, so it is the only sensible source for the column's width — and it keeps
 * the constraint the database enforces in step with the one the app enforces,
 * rather than inventing a second, different limit underneath it.
 */
export function resolveStringColumnLength(prop: Pick<StringProperty, "validation">): number {
    const max = prop.validation?.max;
    return typeof max === "number" && Number.isInteger(max) && max > 0
        ? max
        : DEFAULT_STRING_COLUMN_LENGTH;
}
