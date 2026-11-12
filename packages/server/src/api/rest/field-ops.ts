import { FieldOperation, FIELD_OPERATORS, isFieldOperation, type ColumnDescriptor, type TableDescriptor } from "@rebasepro/types";
import { fieldOperationKind, isColumnFieldOperation, type FieldOperationKind } from "@rebasepro/common";
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
 * accept, and which columns they are legal on (`fieldOperationKind`, read from
 * the column's descriptor). Compiling one to SQL is the driver's job
 * (`@rebasepro/server-postgres`): a native `text[]` and a jsonb list need
 * different statements.
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

/** The kind of value each operator is defined on. */
const LEGAL_ON: Record<FieldOperator, FieldOperationKind> = {
    $inc: "number",
    $push: "array",
    $pull: "array",
    $merge: "document"
};

/** What an operator's kind is called in a message. */
const KIND_NOUN: Record<FieldOperationKind, string> = {
    number: "a numeric column",
    array: "an array column (or a JSON list)",
    document: "a JSON object column"
};

/** What a column is, in a message about an operator it does not take. */
function columnNoun(column: ColumnDescriptor): string {
    const kind = fieldOperationKind(column);
    if (kind) return KIND_NOUN[kind];
    if (column.semantic === "geopoint") return "a geopoint column";
    if (column.json) return `a JSON column whose shape is ${column.json.kind === "oneOf" ? "a `json.oneOf()`" : `a \`json.${column.json.kind}()\``}`;
    return `a \`${column.type.kind}\` column`;
}

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

/**
 * True when any value in the payload is (or is attempting to be) an operation.
 * With the `table`, a JSON object value is one only when it is
 * `{ <operator>: … }`; see `isColumnFieldOperation`.
 */
export function hasFieldOps(values: Record<string, unknown> | undefined, table?: TableDescriptor): boolean {
    if (!values) return false;
    return Object.entries(values).some(([key, value]) => isColumnFieldOperation(value, columnOf(table, key)));
}

/** The column of `table` with this key, when there is a table and it has one. */
function columnOf(table: TableDescriptor | undefined, key: string): ColumnDescriptor | undefined {
    return table?.columns.find(column => column.key === key);
}

/**
 * Parse one value as an operation, or report why it is not a legal one.
 *
 * Returns `undefined` for an ordinary value. Throws for a value that reads as
 * an operation and is malformed, so a typo cannot be written as data. Given
 * the `column`, a JSON object value with `$` keys is data unless it is a
 * single real operator.
 */
export function parseFieldOp(key: string, value: unknown, column?: ColumnDescriptor): ParsedFieldOp | undefined {
    if (!isColumnFieldOperation(value, column) || typeof value !== "object" || value === null) return undefined;
    const entries = Object.entries(value);
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
 *
 * Pass the `table`: without it a JSON object value carrying `$` keys reads as a
 * (malformed) operation rather than as the document it is.
 */
export function splitFieldOps(values: Record<string, unknown>, table?: TableDescriptor): {
    values: Record<string, unknown>;
    fieldOps: Record<string, ParsedFieldOp>;
} {
    const plain: Record<string, unknown> = {};
    const fieldOps: Record<string, ParsedFieldOp> = {};
    for (const [key, value] of Object.entries(values ?? {})) {
        const op = parseFieldOp(key, value, columnOf(table, key));
        if (op) fieldOps[key] = op;
        else plain[key] = value;
    }
    return { values: plain, fieldOps };
}

/**
 * Refuse an operation the table's own columns say cannot apply.
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
    table: TableDescriptor,
    options?: { rowIndex?: number; operationIndex?: number }
): void {
    const where = options?.rowIndex !== undefined
        ? `Row ${options.rowIndex}: `
        : options?.operationIndex !== undefined
            ? `Operation ${options.operationIndex}: `
            : "";
    const bad = (message: string): never => {
        throw ApiError.badRequest(`${where}${message}`, "INVALID_FIELD_OPERATION", {
            collection: table.slug
        });
    };

    for (const [key, value] of Object.entries(values ?? {})) {
        const column = columnOf(table, key);
        const op = parseFieldOp(key, value, column);
        if (!op) continue;

        if (!column) {
            bad(
                `'${key}' is not a column of table '${table.slug}', so ` +
                `${op.operator} has nothing to apply to.`
            );
            continue;
        }

        const legal = LEGAL_ON[op.operator];
        if (fieldOperationKind(column) !== legal) {
            bad(
                `${op.operator} is not defined on '${key}', which is ${columnNoun(column)}. ` +
                `${op.operator} applies to ${KIND_NOUN[legal]}.`
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
 *
 * `table` decides how a JSON object value is read (see {@link splitFieldOps});
 * every request boundary has it and passes it.
 */
export function assertNoFieldOpsOnCreate(
    values: Record<string, unknown>,
    context: string,
    table?: TableDescriptor
): void {
    const offending = Object.entries(values ?? {}).filter(([key, value]) => parseFieldOp(key, value, columnOf(table, key)));
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
