import { and, sql, SQL } from "drizzle-orm";
import { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { ApiError } from "@rebasepro/server";
import type { ParsedFieldOp } from "@rebasepro/server";
import type { ArrayPropertyValidationSchema, NumberPropertyValidationSchema, Properties } from "@rebasepro/types";
import type { DrizzleClient } from "../interfaces";

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
 * What an operation produces answers to the property's declared bounds, and
 * that check is compiled here too, as conditions for the same UPDATE — see
 * {@link compileFieldOpBounds}.
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

/**
 * One declared bound an operation's result has to stay inside.
 *
 * `code` and `message` are what a plain value breaking the same rule reports
 * (see `write-validation.ts`), so `{ stock: { $inc: -1000 } }` and
 * `{ stock: -5 }` are refused with one answer.
 */
export interface FieldOpBound {
    /** The property key. */
    field: string;
    code: "min" | "max" | "more_than" | "less_than" | "positive" | "negative" | "min_items" | "max_items";
    /**
     * TRUE when the value the operation writes keeps to the rule, evaluated
     * against the row the statement is changing. Never NULL: an unset column
     * reads as `0` or empty wherever the operation itself reads it so, and an
     * array the operation leaves unset has no size for a bound to judge.
     */
    holds: SQL;
    message: string;
}

/**
 * The declared bounds each operation's *result* must satisfy, as conditions
 * for the UPDATE that applies it.
 *
 * `{ stock: -5 }` on `stock: { validation: { min: 0 } }` is refused before the
 * statement is built, because the value is in the request. What
 * `{ stock: { $inc: -1000 } }` produces depends on the stored row, which the
 * request never sees, so it can only be judged where the row is: in the WHERE
 * of the UPDATE that does the arithmetic, over the row that statement holds
 * locked. Reading the row first and judging the sum would reopen the race the
 * operation exists to close — two decrements of a stock of 1 would each read
 * `1`, each find room for one more, and both go through. A condition on the
 * UPDATE cannot be raced that way: under READ COMMITTED an UPDATE blocked on a
 * concurrent writer re-evaluates its WHERE against the row that writer
 * committed, so the second decrement sees `0 - 1` and matches nothing.
 *
 * The bound is the whole declared range, applied to the result the way it
 * applies to a value: a number's `min`, `max`, `moreThan`, `lessThan`,
 * `positive` and `negative`, an array's `min` and `max` items. `integer` is not
 * here: a whole increment of a whole number stays whole, and the request
 * already refuses a fractional one. `$merge` has no bounds to hold.
 */
export function compileFieldOpBounds(
    table: PgTable,
    fieldOps: Record<string, ParsedFieldOp>,
    properties: Properties,
    context: { collectionPath: string }
): FieldOpBound[] {
    const bounds: FieldOpBound[] = [];
    for (const [field, op] of Object.entries(fieldOps)) {
        const property = properties[field];
        if (!property?.validation) continue;
        if (property.type === "number" && op.operator === "$inc" && typeof op.operand === "number") {
            const result = compileFieldOp(table, field, op, context);
            bounds.push(...numberBounds(field, property.validation, result, op.operand));
        } else if (property.type === "array" && (op.operator === "$push" || op.operator === "$pull")) {
            const column = table[field as keyof typeof table] as AnyPgColumn | undefined;
            const result = compileFieldOp(table, field, op, context);
            // A native array is counted with `cardinality` (not `array_length`,
            // which is NULL for an empty array); a json document with
            // `jsonb_array_length`, through jsonb so one function serves both
            // `json` and `jsonb` columns.
            const size = column && isNativeArray(sqlTypeOf(column))
                ? sql`cardinality(${result})`
                : sql`jsonb_array_length((${result})::jsonb)`;
            bounds.push(...arrayBounds(field, property.validation, size, op.operator));
        }
    }
    return bounds;
}

function numberBounds(
    field: string,
    rules: NumberPropertyValidationSchema,
    result: SQL,
    operand: number
): FieldOpBound[] {
    // The bound is a parameter cast to numeric rather than left to inference:
    // Postgres would type it from the column, and `min: 0.5` on an integer
    // column is then a failed cast rather than a comparison.
    const by = `$inc by ${operand}`;
    const bounds: FieldOpBound[] = [];
    if (rules.min !== undefined) {
        bounds.push({ field, code: "min", holds: sql`(${result}) >= ${rules.min}::numeric`, message: `'${field}' must be at least ${rules.min}, and ${by} would take it below that.` });
    }
    if (rules.max !== undefined) {
        bounds.push({ field, code: "max", holds: sql`(${result}) <= ${rules.max}::numeric`, message: `'${field}' must be at most ${rules.max}, and ${by} would take it above that.` });
    }
    if (rules.moreThan !== undefined) {
        bounds.push({ field, code: "more_than", holds: sql`(${result}) > ${rules.moreThan}::numeric`, message: `'${field}' must be greater than ${rules.moreThan}, and ${by} would take it to ${rules.moreThan} or below.` });
    }
    if (rules.lessThan !== undefined) {
        bounds.push({ field, code: "less_than", holds: sql`(${result}) < ${rules.lessThan}::numeric`, message: `'${field}' must be less than ${rules.lessThan}, and ${by} would take it to ${rules.lessThan} or above.` });
    }
    if (rules.positive) {
        bounds.push({ field, code: "positive", holds: sql`(${result}) > 0`, message: `'${field}' must be positive, and ${by} would take it to 0 or below.` });
    }
    if (rules.negative) {
        bounds.push({ field, code: "negative", holds: sql`(${result}) < 0`, message: `'${field}' must be negative, and ${by} would take it to 0 or above.` });
    }
    return bounds;
}

function arrayBounds(
    field: string,
    rules: ArrayPropertyValidationSchema,
    size: SQL,
    operator: "$push" | "$pull"
): FieldOpBound[] {
    const items = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
    // COALESCE to TRUE: a `$pull` from an unset native array leaves it unset,
    // and a range has nothing to say about a value that is not there — the
    // same rule a plain `null` gets.
    const bounds: FieldOpBound[] = [];
    if (rules.min !== undefined) {
        bounds.push({ field, code: "min_items", holds: sql`COALESCE(${size} >= ${rules.min}::numeric, TRUE)`, message: `'${field}' must have at least ${items(rules.min)}, and ${operator} would leave it with fewer.` });
    }
    if (rules.max !== undefined) {
        bounds.push({ field, code: "max_items", holds: sql`COALESCE(${size} <= ${rules.max}::numeric, TRUE)`, message: `'${field}' must have at most ${items(rules.max)}, and ${operator} would leave it with more.` });
    }
    return bounds;
}

/**
 * Which bounds the row, as it now stands, would break — for an UPDATE that
 * carried bounds and matched nothing.
 *
 * A guarded UPDATE matching zero rows means one of three things: the row is not
 * there for this caller (404), a row-level security policy refused the write
 * (403), or the operation's result broke a bound (400). The first two are
 * `explainZeroRowWrite`'s; this answers the third, by evaluating each bound
 * against the row over the same handle and the same key conditions. An empty
 * answer — the row is not visible, or every bound holds — leaves the decision to
 * `explainZeroRowWrite`.
 *
 * It is a second statement, so the row can change in between. A row deleted in
 * between is a 404 here as it would have been anyway. A row changed so that the
 * operation now fits reads as "every bound holds" and falls through to the
 * row-level-security answer; the write was refused either way, and the
 * refusal is never turned into a write.
 *
 * Only booleans come back — whether each bound holds — never the stored value.
 */
export async function brokenFieldOpBounds(
    handle: DrizzleClient,
    table: PgTable,
    conditions: SQL[],
    bounds: FieldOpBound[]
): Promise<FieldOpBound[]> {
    if (bounds.length === 0) return [];
    const selection: Record<string, SQL<boolean>> = {};
    bounds.forEach((bound, index) => {
        selection[`bound${index}`] = sql<boolean>`(${bound.holds})`;
    });
    const rows = await handle.select(selection).from(table).where(and(...conditions)).limit(1);
    const row = rows[0];
    if (!row) return [];
    return bounds.filter((_bound, index) => row[`bound${index}`] === false);
}

/** The 400 a write gets when an operation's result breaks a bound. */
export function fieldOpBoundsError(collectionSlug: string, broken: FieldOpBound[]): ApiError {
    const violations = broken.map(({ field, code, message }) => ({ field, code, message }));
    const messages = violations.map(violation => violation.message);
    return ApiError.badRequest(messages.join(" "), "VALIDATION_CONSTRAINT", {
        collection: collectionSlug,
        violations,
        messages
    });
}
