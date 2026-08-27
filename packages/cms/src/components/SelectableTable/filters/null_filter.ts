import { WhereFilterOp } from "@rebasepro/types";

/**
 * The "filter for null values" checkbox, expressed portably.
 *
 * The checkbox used to emit `[whichever operator is selected, null]` and leave
 * the driver to work out that a null value means a null check. That reads as
 * an engine-neutral convention and is not one:
 *
 *  - Postgres took `["==", null]` as `IS NULL`, but dropped `["in", null]`
 *    entirely — a dropped condition widens, so ticking the box returned every
 *    row instead of the ones with no value.
 *  - MongoDB maps `in`/`not-in` straight onto `$in`/`$nin`, and Mongo rejects
 *    those with a non-array: `$in needs an array`. The read fails outright.
 *  - A Firestore driver is supplied by the developer, and the Firestore SDK
 *    likewise refuses `in` without a non-empty array.
 *
 * Only `==`/`!=` ever worked, and only because two engines independently chose
 * to special-case a null operand. Nothing in the filter contract promises that,
 * and a filter field is shared by every engine the admin can talk to.
 *
 * `is-null`/`is-not-null` are the operators that mean this, they are in
 * {@link ALL_WHERE_FILTER_OPS}, and every driver already handles them
 * explicitly rather than by inference. So the checkbox emits those, and the
 * question of what a null operand means to a given engine stops being asked.
 */
export const NULL_FILTER_OPERATORS: readonly WhereFilterOp[] = ["is-null", "is-not-null"];

/** Whether `op` asks about absence rather than about a value. */
export function isNullFilterOperator(op: WhereFilterOp | undefined): boolean {
    return op === "is-null" || op === "is-not-null";
}

/**
 * The null check carrying the same sense as `op`.
 *
 * The checkbox is a toggle, not an operator, so the operator it is ticked
 * alongside is what says which way round it means: `==`/`in` are asking for
 * a match, so their null form is "has nothing"; `!=`/`not-in` are asking for
 * the absence of one, so theirs is "has something".
 */
export function nullFilterOperatorFor(op: WhereFilterOp | undefined): WhereFilterOp {
    if (op === "!=" || op === "not-in" || op === "is-not-null") return "is-not-null";
    return "is-null";
}

/**
 * The value operator to return to when the checkbox is unticked.
 *
 * `is-null` could have been reached from `==` or from `in` — the field cannot
 * know which, and it does not matter. What matters is landing on an operator
 * the dropdown actually offers, in the same sense, so the control does not
 * come back showing something it cannot render.
 */
export function valueOperatorFor(
    op: WhereFilterOp | undefined,
    offered: readonly WhereFilterOp[]
): WhereFilterOp | undefined {
    const negative = op === "is-not-null";
    const wanted: WhereFilterOp[] = negative ? ["!=", "not-in"] : ["==", "in", "array-contains"];
    return wanted.find(candidate => offered.includes(candidate))
        ?? offered.find(candidate => !isNullFilterOperator(candidate));
}
