import { BATCH_REF_KEY } from "@rebasepro/types";
import { ApiError } from "../errors";

/**
 * Cross-collection writes that land together or not at all.
 *
 * `/bulk` is one collection at a time, which is the wrong shape for the writes
 * that most need atomicity: an order and its line items, a user and their
 * membership row, a document and its audit entry. Sent as separate requests
 * they can half-succeed, and the recovery — read back, work out which half
 * landed, undo it — is code nobody writes and everybody needs.
 *
 * A batch is one transaction under the caller's own RLS role, with every
 * operation running the same pipeline the single routes run: the same
 * validation, the same callbacks, the same policies. The one thing it adds is
 * `$ref`, because the sequence it exists to express — create a parent, then
 * point children at it — needs a value the caller cannot know before sending.
 *
 * @module
 */

/**
 * The marker key, re-exported from `@rebasepro/types` where it is declared
 * beside the field operators — the two share the `$`-prefixed namespace, and
 * the predicate that recognises a field operation has to know this one is not.
 */
export { BATCH_REF_KEY };

/** Operations accepted in one batch, mirroring the single-row routes. */
export const BATCH_OPS = ["create", "update", "upsert", "delete"] as const;
export type BatchOp = typeof BATCH_OPS[number];

/** One operation, after the envelope has been checked but before RLS sees it. */
export interface ParsedBatchOperation {
    op: BatchOp;
    /** The collection slug, validated against the collections this API serves. */
    collection: string;
    id?: unknown;
    values?: Record<string, unknown>;
    onConflict?: string[];
    /** The name later operations may reference this one's result by. */
    ref?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A `{ "$ref": "order.id" }` marker, or `undefined` for an ordinary value. */
function asRef(value: unknown): string | undefined {
    if (!isPlainObject(value)) return undefined;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== BATCH_REF_KEY) return undefined;
    const path = value[BATCH_REF_KEY];
    if (typeof path !== "string" || path.trim() === "") {
        throw ApiError.badRequest(
            `A ${BATCH_REF_KEY} must name '<ref>.<field>', e.g. { "${BATCH_REF_KEY}": "order.id" }.`,
            "INVALID_BATCH_REF"
        );
    }
    return path;
}

/**
 * Replace every `$ref` marker under `value` with what the named operation wrote.
 *
 * Recursive rather than top-level-only: a foreign key is usually a top-level
 * column, but a `map` column holding `{ meta: { orderId: … } }` is an ordinary
 * shape and there is no principled reason for the marker to stop working one
 * level down.
 *
 * Runs inside the transaction, because that is the only place the earlier
 * operation's result exists.
 */
export function resolveBatchRefs(
    value: unknown,
    resolved: ReadonlyMap<string, Record<string, unknown>>
): unknown {
    const path = asRef(value);
    if (path !== undefined) {
        const separator = path.indexOf(".");
        if (separator <= 0 || separator === path.length - 1) {
            throw ApiError.badRequest(
                `'${path}' is not a valid ${BATCH_REF_KEY}. Use '<ref>.<field>', e.g. 'order.id'.`,
                "INVALID_BATCH_REF"
            );
        }
        const name = path.slice(0, separator);
        const field = path.slice(separator + 1);
        const row = resolved.get(name);
        if (!row) {
            throw ApiError.badRequest(
                `'${path}' references '${name}', which is not the ref of any earlier operation in this batch. ` +
                "Only backward references resolve: name the operation with `ref` before referencing it.",
                "INVALID_BATCH_REF"
            );
        }
        if (!(field in row)) {
            throw ApiError.badRequest(
                `'${path}' references the field '${field}', which the row written by '${name}' does not have.`,
                "INVALID_BATCH_REF"
            );
        }
        return row[field];
    }

    if (Array.isArray(value)) return value.map((entry) => resolveBatchRefs(entry, resolved));
    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) out[key] = resolveBatchRefs(entry, resolved);
        return out;
    }
    return value;
}

/**
 * Check the envelope of a batch body and hand back the operations.
 *
 * Everything here is decided before the transaction opens. A batch is
 * all-or-nothing, so a shape error found half-way in costs a rollback of every
 * operation before it — and the caller learns about entry 40 only after 39
 * writes have been done and undone.
 */
export function parseBatchBody(
    body: unknown,
    options: {
        knownCollections: ReadonlySet<string>;
        maxOperations: number;
    }
): ParsedBatchOperation[] {
    const operations = (body as { operations?: unknown } | undefined)?.operations;

    if (!Array.isArray(operations)) {
        throw ApiError.badRequest(
            "Expected a JSON body of { operations: [ { op, collection, … } ] }.",
            "INVALID_BATCH_BODY"
        );
    }
    if (operations.length > options.maxOperations) {
        throw ApiError.badRequest(
            `Too many operations: ${operations.length} exceeds the ${options.maxOperations}-operation limit ` +
            "for a single batch. One batch is one transaction and holds its locks for the whole of it; " +
            "send it in chunks.",
            "BATCH_TOO_LARGE"
        );
    }

    const parsed: ParsedBatchOperation[] = [];
    const refNames = new Set<string>();

    operations.forEach((raw, index) => {
        const at = `Operation ${index}`;
        if (!isPlainObject(raw)) {
            throw ApiError.badRequest(`${at} is not an object.`, "INVALID_BATCH_BODY");
        }
        const op = raw.op;
        if (typeof op !== "string" || !(BATCH_OPS as readonly string[]).includes(op)) {
            throw ApiError.badRequest(
                `${at} has no valid \`op\`. Expected one of: ${BATCH_OPS.join(", ")}.`,
                "INVALID_BATCH_BODY"
            );
        }
        const collection = raw.collection;
        if (typeof collection !== "string" || collection === "") {
            throw ApiError.badRequest(`${at} is missing \`collection\`.`, "INVALID_BATCH_BODY");
        }
        if (!options.knownCollections.has(collection)) {
            // Named rather than enumerated, for the same reason the unmatched
            // route does not list the collections: an unauthenticated caller is
            // refused before routing, and echoing the set back would undo that.
            throw ApiError.badRequest(
                `${at} names the unknown collection '${collection}'. It is not defined in this backend, ` +
                "or its route is not exposed.",
                "INVALID_BATCH_BODY"
            );
        }

        const needsValues = op === "create" || op === "update" || op === "upsert";
        if (needsValues && !isPlainObject(raw.values)) {
            throw ApiError.badRequest(
                `${at} is a ${op} and needs a \`values\` object.`,
                "INVALID_BATCH_BODY"
            );
        }
        const needsId = op === "update" || op === "delete";
        if (needsId && (raw.id === undefined || raw.id === null || raw.id === "")) {
            throw ApiError.badRequest(
                `${at} is a ${op} and needs an \`id\` — a value, or a { "${BATCH_REF_KEY}": "…" } naming an earlier one.`,
                "INVALID_BATCH_BODY"
            );
        }
        if (op === "upsert" && raw.onConflict !== undefined && !Array.isArray(raw.onConflict)) {
            throw ApiError.badRequest(
                `${at} has an \`onConflict\` that is not an array of column names.`,
                "INVALID_BATCH_BODY"
            );
        }

        let ref: string | undefined;
        if (raw.ref !== undefined) {
            if (typeof raw.ref !== "string" || raw.ref.trim() === "") {
                throw ApiError.badRequest(`${at} has a \`ref\` that is not a non-empty string.`, "INVALID_BATCH_BODY");
            }
            ref = raw.ref.trim();
            if (ref.includes(".")) {
                throw ApiError.badRequest(
                    `${at} has the ref '${ref}'. A ref name cannot contain '.', which separates it from the field.`,
                    "INVALID_BATCH_BODY"
                );
            }
            if (refNames.has(ref)) {
                throw ApiError.badRequest(
                    `${at} reuses the ref '${ref}'. A reference would then be ambiguous, so names are unique per batch.`,
                    "INVALID_BATCH_BODY"
                );
            }
            refNames.add(ref);
        }

        parsed.push({
            op: op as BatchOp,
            collection,
            id: raw.id,
            values: needsValues ? (raw.values as Record<string, unknown>) : undefined,
            onConflict: raw.onConflict as string[] | undefined,
            ref
        });
    });

    return parsed;
}

/**
 * Refuse a `$ref` that points at an operation which does not exist, or which
 * comes later.
 *
 * Checked up front rather than left to fail inside the transaction: a forward
 * reference is a static property of the body, and finding it at operation 40
 * costs the rollback of the 39 writes before it.
 */
export function assertRefsResolvable(operations: readonly ParsedBatchOperation[]): void {
    const seen = new Set<string>();
    operations.forEach((operation, index) => {
        const visit = (value: unknown): void => {
            const path = asRef(value);
            if (path !== undefined) {
                const name = path.split(".")[0];
                if (!seen.has(name)) {
                    throw ApiError.badRequest(
                        `Operation ${index} references '${path}', but no earlier operation is named '${name}'. ` +
                        "Only backward references resolve.",
                        "INVALID_BATCH_REF"
                    );
                }
                return;
            }
            if (Array.isArray(value)) { value.forEach(visit); return; }
            if (isPlainObject(value)) { Object.values(value).forEach(visit); }
        };
        visit(operation.values);
        visit(operation.id);
        if (operation.ref) seen.add(operation.ref);
    });
}
