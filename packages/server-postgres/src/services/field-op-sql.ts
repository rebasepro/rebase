import { sql, SQL } from "drizzle-orm";
import { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { ApiError } from "@rebasepro/server";
import type { ParsedFieldOp } from "@rebasepro/server";

/**
 * Turning `{ views: { $inc: 1 } }` into the `SET` clause that cannot lose a
 * concurrent write.
 *
 * The contract — which operators exist, what they accept, which property types
 * they are legal on — lives in `@rebasepro/server`. What is here is the part
 * only this driver can know: an `array` property is a native `text[]` on one
 * collection and a jsonb document on the next (see the DDL generator's `array`
 * arm), and the two need entirely different statements. Compiling from the
 * property type alone would emit `array_append` against a jsonb column, which
 * Postgres rejects at plan time with a function-does-not-exist error naming
 * neither the collection nor the field.
 *
 * Every expression is NULL-safe. `NULL + 1` is `NULL`, and a counter that
 * silently empties itself the first time it is incremented from an unset column
 * is worse than one that never worked.
 *
 * @module
 */

/** What the column is, as Postgres sees it: `text[]`, `jsonb`, `integer`, … */
function sqlTypeOf(column: AnyPgColumn): string {
    try {
        return String(column.getSQLType()).toLowerCase();
    } catch {
        return "";
    }
}

function isNativeArray(type: string): boolean {
    return type.endsWith("[]") || type.endsWith(" array");
}

/** A `json` column needs the result cast back; a `jsonb` one does not. */
function isPlainJson(type: string): boolean {
    return type === "json";
}

function asList(operand: unknown): unknown[] {
    return Array.isArray(operand) ? operand : [operand];
}

/**
 * The expression one operation compiles to, or a 400 saying why it cannot.
 *
 * `field` is the property key; it is already known to be a column of `table`
 * (the caller checks that against the same table it builds the statement from).
 */
export function compileFieldOp(
    table: PgTable,
    field: string,
    op: ParsedFieldOp,
    context: { collectionPath: string }
): SQL {
    const column = table[field as keyof typeof table] as AnyPgColumn | undefined;
    if (!column) {
        throw ApiError.badRequest(
            `'${field}' is not a column of "${context.collectionPath}", so ${op.operator} has nothing to apply to.`,
            "INVALID_FIELD_OPERATION"
        );
    }
    const type = sqlTypeOf(column);

    switch (op.operator) {
        case "$inc": {
            // COALESCE, not a bare `+`: an unset counter is NULL, and NULL + 1
            // is NULL — so the first increment of a column that has never been
            // written would erase it rather than start it at 1.
            return sql`COALESCE(${column}, 0) + ${op.operand as number}`;
        }

        case "$push": {
            const values = asList(op.operand);
            if (isNativeArray(type)) {
                // Folded with array_append rather than concatenating a literal:
                // the element type is inferred from the column, so the same
                // code serves text[], integer[] and numeric[] without the
                // caller (or this file) having to name the type.
                let expression: SQL = sql`${column}`;
                for (const value of values) {
                    expression = sql`array_append(${expression}, ${value})`;
                }
                return expression;
            }
            if (type.startsWith("json")) {
                const appended = sql`COALESCE(${column}::jsonb, '[]'::jsonb) || ${JSON.stringify(values)}::jsonb`;
                return isPlainJson(type) ? sql`(${appended})::json` : appended;
            }
            throw unsupportedColumn(field, op.operator, type, context);
        }

        case "$pull": {
            const values = asList(op.operand);
            if (isNativeArray(type)) {
                let expression: SQL = sql`${column}`;
                for (const value of values) {
                    expression = sql`array_remove(${expression}, ${value})`;
                }
                return expression;
            }
            if (type.startsWith("json")) {
                // jsonb has no array_remove. Re-aggregating the elements that
                // survive is the standard form, and COALESCE around it is what
                // keeps a column that loses its last element as `[]` rather
                // than NULL — jsonb_agg over an empty set is NULL.
                const removals = sql`${JSON.stringify(values)}::jsonb`;
                const filtered = sql`COALESCE((
                    SELECT jsonb_agg(element)
                    FROM jsonb_array_elements(COALESCE(${column}::jsonb, '[]'::jsonb)) AS element
                    WHERE NOT (element IN (SELECT jsonb_array_elements(${removals})))
                ), '[]'::jsonb)`;
                return isPlainJson(type) ? sql`(${filtered})::json` : filtered;
            }
            throw unsupportedColumn(field, op.operator, type, context);
        }

        case "$merge": {
            if (!type.startsWith("json")) throw unsupportedColumn(field, op.operator, type, context);
            // `||` on jsonb is a shallow merge, which is what $merge promises:
            // a nested object replaces rather than merges, and saying so is
            // better than a deep merge nobody can predict the result of.
            const merged = sql`COALESCE(${column}::jsonb, '{}'::jsonb) || ${JSON.stringify(op.operand)}::jsonb`;
            return isPlainJson(type) ? sql`(${merged})::json` : merged;
        }
    }
}

function unsupportedColumn(
    field: string,
    operator: string,
    type: string,
    context: { collectionPath: string }
): ApiError {
    return ApiError.badRequest(
        `${operator} cannot be applied to '${field}' on "${context.collectionPath}": the column is ` +
        `${type || "of an unknown type"}, and ${operator} needs ` +
        (operator === "$merge" ? "a json or jsonb column." : "an array or json column."),
        "INVALID_FIELD_OPERATION"
    );
}

/** Compile a whole map of operations into a `SET`-ready object. */
export function compileFieldOps(
    table: PgTable,
    fieldOps: Record<string, ParsedFieldOp>,
    context: { collectionPath: string }
): Record<string, SQL> {
    const compiled: Record<string, SQL> = {};
    for (const [field, op] of Object.entries(fieldOps)) {
        compiled[field] = compileFieldOp(table, field, op, context);
    }
    return compiled;
}
