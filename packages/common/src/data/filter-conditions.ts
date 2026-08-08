/**
 * The `FilterValues` grammar, one level below the wire codec.
 *
 * A field's filter is either one `[op, value]` tuple or an **array** of them —
 * `{ age: [[">=", 18], ["<", 65]] }` — which is what the fluent builder produces
 * from two `.where()` calls on the same column. Reading that shape is grammar,
 * not a driver detail, so every compiler reads it through here.
 *
 * It lived only inside the Postgres compiler, and the Mongo one destructured
 * `const [op, value] = filterParam` regardless: given the array-of-tuples form
 * `op` bound to `[">=", 18]`, no operator matched, and the condition was
 * dropped. Both of them. A read asking for adults under 65 returned every row
 * of the collection with a 200.
 *
 * @module
 */

import type { WhereFilterOp } from "@rebasepro/types";

/** One `[operator, value]` condition. */
export type FilterTuple = [WhereFilterOp, unknown];

/**
 * Read one field's filter as the list of conditions it stands for.
 *
 * Accepts both declared shapes and normalises them to a list:
 *
 * ```ts
 * toFilterTuples(["==", "active"])          // [["==", "active"]]
 * toFilterTuples([[">=", 18], ["<", 65]])   // [[">=", 18], ["<", 65]]
 * ```
 *
 * A falsy, non-array or empty param has no conditions in it — the empty list,
 * so a caller iterating adds nothing rather than compiling a tuple of
 * `undefined`s and logging about an operator nobody sent.
 */
export function toFilterTuples(filterParam: unknown): FilterTuple[] {
    if (!filterParam || !Array.isArray(filterParam) || filterParam.length === 0) return [];
    // The first element discriminates: a condition starts with an operator
    // string, a list of conditions starts with a condition. `["in", ["a","b"]]`
    // is one condition whose value happens to be a list.
    if (Array.isArray(filterParam[0])) {
        return filterParam as FilterTuple[];
    }
    return [filterParam as FilterTuple];
}
