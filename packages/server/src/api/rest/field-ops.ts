import { CollectionConfig, FieldOperation, FIELD_OPERATORS, isFieldOperation, Property } from "@rebasepro/types";
import { ApiError } from "../errors";

/**
 * Writes expressed as a change to the column's current value.
 *
 * `PATCH { views: 5 }` says what the number becomes. Saying what *happens* to
 * it needs a read first — and that read is where the counter is lost: two
 * requests that each read `4`, add one and write `5` end at `5`, not `6`, and
 * nothing in the response tells either of them an increment went missing. It is
 * not a rare interleaving either; it is the ordinary shape of a view counter, a
 * stock level, an inventory reservation, a tag list two people edit.
 *
 * `{ views: { $inc: 1 } }` compiles to `SET views = views + 1`, so the
 * arithmetic happens inside the statement that already holds the row lock and
 * there is no window to lose. Same for the array and jsonb forms.
 *
 * This module is the *contract* — what the operators are, what shapes they
 * accept, and which property types they are legal on. Compiling one to SQL is
 * the driver's job (`@rebasepro/server-postgres`), because only the driver
 * knows whether an `array` property is a native `text[]` or a jsonb document,
 * and those need different statements.
 *
 * @module
 */

export type FieldOperator = typeof FIELD_OPERATORS[number];

/** One parsed operation: which operator, and what it was given. */
export interface ParsedFieldOp {
    operator: FieldOperator;
    operand: unknown;
}

const OPERATOR_SET = new Set<string>(FIELD_OPERATORS);

/** The property types each operator is defined on. */
const LEGAL_ON: Record<FieldOperator, readonly string[]> = {
    $inc: ["number"],
    $push: ["array"],
    $pull: ["array"],
    $merge: ["map"]
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Whether a value is *trying* to be a field operation, misspellings included.
 *
 * That is the point: `{ $increment: 1 }` silently stored as a jsonb document on
 * a number column is the failure mode this module exists to make impossible, so
 * an attempted operation that is not a legal one has to be an error rather than
 * a value. The predicate itself lives in `@rebasepro/types` beside the operator
 * list, because the offline queue has to recognise one too and cannot import
 * this package.
 */
export const looksLikeFieldOp = isFieldOperation;

/** True when any value in the payload is (or is attempting to be) an operation. */
export function hasFieldOps(values: Record<string, unknown> | undefined): boolean {
    if (!values) return false;
    return Object.values(values).some(looksLikeFieldOp);
}

/**
 * Parse one value as an operation, or report why it is not a legal one.
 *
 * Returns `undefined` for an ordinary value. Throws for a value that reads as
 * an operation and is malformed, so a typo cannot be written as data.
 */
export function parseFieldOp(key: string, value: unknown): ParsedFieldOp | undefined {
    if (!looksLikeFieldOp(value)) return undefined;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length !== 1) {
        throw ApiError.badRequest(
            `'${key}' mixes ${entries.length} keys in one field operation. ` +
            "A field carries exactly one operator, applied on its own: " +
            `${FIELD_OPERATORS.join(", ")}.`,
            "INVALID_FIELD_OPERATION"
        );
    }
    const [operator, operand] = entries[0];
    if (!OPERATOR_SET.has(operator)) {
        throw ApiError.badRequest(
            `'${key}' uses an unknown field operator '${operator}'. ` +
            `Known operators: ${FIELD_OPERATORS.join(", ")}.`,
            "INVALID_FIELD_OPERATION"
        );
    }
    return { operator: operator as FieldOperator, operand };
}

/**
 * Split a write payload into ordinary values and field operations.
 *
 * The two travel together in one body — `{ title: "x", views: { $inc: 1 } }` is
 * a single `PATCH` — and are applied in one statement, so a caller never has to
 * choose between setting a column and incrementing another.
 */
export function splitFieldOps(values: Record<string, unknown>): {
    values: Record<string, unknown>;
    fieldOps: Record<string, ParsedFieldOp>;
} {
    const plain: Record<string, unknown> = {};
    const fieldOps: Record<string, ParsedFieldOp> = {};
    for (const [key, value] of Object.entries(values ?? {})) {
        const op = parseFieldOp(key, value);
        if (op) fieldOps[key] = op;
        else plain[key] = value;
    }
    return { values: plain, fieldOps };
}

/**
 * Refuse an operation the collection's own schema says cannot apply.
 *
 * Checked here rather than left to Postgres because the database's answer
 * arrives as a type error naming a generated column expression, from inside a
 * transaction that has already run other operations of the same batch — and
 * because `$push` on a `number` is a caller mistake, which is a 400, not a 500.
 *
 * `rowIndex` names the entry when the payload came from a bulk route, for the
 * same reason the other bulk validators take one: "the batch failed" is
 * unactionable at a thousand rows.
 */
export function assertFieldOpsValid(
    values: Record<string, unknown>,
    collection: CollectionConfig,
    options?: { rowIndex?: number; operationIndex?: number }
): void {
    const where = options?.rowIndex !== undefined
        ? `Row ${options.rowIndex}: `
        : options?.operationIndex !== undefined
            ? `Operation ${options.operationIndex}: `
            : "";
    const bad = (message: string): never => {
        throw ApiError.badRequest(`${where}${message}`, "INVALID_FIELD_OPERATION", {
            collection: collection.slug
        });
    };

    const properties = (collection.properties ?? {}) as Record<string, Property>;

    for (const [key, value] of Object.entries(values ?? {})) {
        const op = parseFieldOp(key, value);
        if (!op) continue;

        const property = properties[key];
        if (!property) {
            bad(
                `'${key}' is not a declared property of '${collection.slug}', so ` +
                `${op.operator} has no column to apply to.`
            );
            continue;
        }

        const legal = LEGAL_ON[op.operator];
        if (!legal.includes(property.type)) {
            bad(
                `${op.operator} is not defined on '${key}', which is a ${property.type} property. ` +
                `${op.operator} applies to ${legal.join(" or ")} properties.`
            );
            continue;
        }

        switch (op.operator) {
            case "$inc":
                if (typeof op.operand !== "number" || !Number.isFinite(op.operand)) {
                    bad(`$inc on '${key}' takes a finite number, received ${JSON.stringify(op.operand)}.`);
                }
                break;
            case "$push":
            case "$pull":
                if (op.operand === undefined) {
                    bad(`${op.operator} on '${key}' needs a value, or an array of values.`);
                }
                if (Array.isArray(op.operand) && op.operand.length === 0) {
                    bad(`${op.operator} on '${key}' was given an empty array, which changes nothing.`);
                }
                break;
            case "$merge":
                if (!isPlainObject(op.operand)) {
                    bad(`$merge on '${key}' takes an object to merge in, received ${JSON.stringify(op.operand)}.`);
                }
                break;
        }
    }
}

/**
 * Field operations describe a change to a value that is already there, so they
 * are meaningless on an insert — `views + 1` over a row that does not exist yet
 * is just `1`, and accepting it would make `$inc` mean two different things
 * depending on a race the caller cannot observe.
 */
export function assertNoFieldOpsOnCreate(
    values: Record<string, unknown>,
    context: string
): void {
    const offending = Object.entries(values ?? {}).filter(([key, value]) => parseFieldOp(key, value));
    if (offending.length === 0) return;
    throw ApiError.badRequest(
        `${context} cannot carry field operations (${offending.map(([key]) => `'${key}'`).join(", ")}). ` +
        "They change a value that is already stored, so they only apply to an update. " +
        "Send the value itself instead.",
        "INVALID_FIELD_OPERATION"
    );
}

/** Re-exported so callers type against one definition of the wire shape. */
export type { FieldOperation };
export { FIELD_OPERATORS };
