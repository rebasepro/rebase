import { describe, expect, it } from "@jest/globals";
import { policy } from "@rebasepro/types";
import type { Entity, PolicyCompareOperator } from "@rebasepro/types";

import { evaluatePolicy } from "../src/util/policy/evaluatePolicy";

/**
 * The ordering comparisons — `lt`, `lte`, `gt`, `gte` — over each operand type
 * this evaluator handles separately: string, number and bigint.
 *
 * Twelve branches, and not one was covered: grepping every test in this package
 * for those operators returned nothing. Found by mutation — flipping the
 * `op === "lt"` guard inside the bigint block left the whole suite green.
 *
 * It matters because `evaluatePolicy` is the JavaScript twin of
 * `policyToPostgres`: both compile from the same expression so that what the
 * admin UI decides locally matches what RLS enforces in the database. When they
 * disagree, the panel shows a row the server would refuse, or hides one it
 * would serve — and neither side reports an error.
 *
 * `eq`/`neq` are handled before the type dispatch, so they are checked here
 * only to pin that the early return still happens for every type.
 */

const row = (values: Record<string, unknown>): Entity =>
    ({ id: "e1", path: "things", values } as unknown as Entity);

const ctx = (values: Record<string, unknown>) => ({
    user: { uid: "u1", roles: [] },
    entity: row(values)
} as never);

/** `<field> <op> <literal>`, evaluated against a row holding `fieldValue`. */
const compare = (fieldValue: unknown, op: PolicyCompareOperator, literal: unknown) =>
    evaluatePolicy(
        policy.compare(policy.field("v"), op, policy.literal(literal as never)),
        ctx({ v: fieldValue })
    );

describe("ordering comparisons over strings", () => {
    it.each([
        ["lt", "apple", "banana", true],
        ["lt", "banana", "apple", false],
        ["lte", "apple", "apple", true],
        ["lte", "banana", "apple", false],
        ["gt", "banana", "apple", true],
        ["gt", "apple", "banana", false],
        ["gte", "apple", "apple", true],
        ["gte", "apple", "banana", false]
    ] as const)("%s: %s vs %s", (op, a, b, expected) => {
        expect(compare(a, op as PolicyCompareOperator, b)).toBe(expected);
    });
});

describe("ordering comparisons over numbers", () => {
    it.each([
        ["lt", 1, 2, true],
        ["lt", 2, 1, false],
        ["lte", 2, 2, true],
        ["lte", 3, 2, false],
        ["gt", 2, 1, true],
        ["gt", 1, 2, false],
        ["gte", 2, 2, true],
        ["gte", 1, 2, false]
    ] as const)("%s: %s vs %s", (op, a, b, expected) => {
        expect(compare(a, op as PolicyCompareOperator, b)).toBe(expected);
    });
});

describe("ordering comparisons over bigints", () => {
    // A bigint literal cannot be spelled through `policy.literal` (its type is
    // string | number | boolean | null), so both sides come off the row — which
    // is also how a real policy meets one: an int8 column read back by the
    // driver.
    const bothFromRow = (a: bigint, b: bigint, op: PolicyCompareOperator) =>
        evaluatePolicy(
            policy.compare(policy.field("a"), op, policy.field("b")),
            ctx({ a, b })
        );

    it.each([
        ["lt", 1n, 2n, true],
        ["lte", 2n, 2n, true],
        ["gt", 2n, 1n, true],
        ["gte", 1n, 2n, false]
    ] as const)("%s: %s vs %s", (op, a, b, expected) => {
        expect(bothFromRow(a, b, op as PolicyCompareOperator)).toBe(expected);
    });
});

describe("comparisons that cannot be ordered", () => {
    it("is `unknown` when the operands are of different types", () => {
        // Not `false`: an unorderable pair is a question this evaluator cannot
        // answer, and Kleene logic needs that distinct from a definite no —
        // `false` would let an `or` branch be wrongly discarded.
        expect(compare("2", "gt", 1)).toBe("unknown");
    });

    /**
     * Every operator, `eq` and `neq` included. SQL answers NULL for any
     * comparison against NULL, and this is the twin of that SQL.
     *
     * These two used to answer `false` and `true`, which is JavaScript's
     * two-valued reading of a three-valued question. `neq` was the dangerous
     * one — a hard `true` is a grant even a fail-closed caller honours, and
     * `owner_id != rebase.uid()` on a row with a NULL owner read as permitted
     * in the panel while Postgres refused it.
     *
     * `false` for `eq` looked harmless, since false denies and NULL denies too.
     * It was not, because it did not survive negation: `not(a = NULL)` came out
     * `true` while `NOT NULL` is still NULL. An answer that is only right in a
     * positive position is not right, it just moves.
     *
     * Both were found by the exhaustive Postgres differential
     * (`server-postgres/test/e2e/policy-agreement-exhaustive.test.ts`), the
     * second only after the first was fixed.
     */
    it("is `unknown` when either side is null, for every operator", () => {
        for (const op of ["gt", "gte", "lt", "lte", "eq", "neq"] as const) {
            expect({ op, result: compare(null, op, 1) }).toEqual({ op, result: "unknown" });
            expect({ op, result: compare(1, op, null) }).toEqual({ op, result: "unknown" });
        }
    });

    it("is `unknown` when the row is absent, whatever the operator", () => {
        const noRow = { user: { uid: "u1", roles: [] }, entity: null } as never;

        expect(evaluatePolicy(
            policy.compare(policy.field("v"), "gt", policy.literal(1)), noRow
        )).toBe("unknown");
    });
});

describe("equality still short-circuits ahead of the type dispatch", () => {
    it.each([
        ["strings", "a", "a"],
        ["numbers", 1, 1],
        ["booleans", true, true]
    ] as const)("eq/neq on %s", (_label, a, b) => {
        expect(compare(a, "eq", b)).toBe(true);
        expect(compare(a, "neq", b)).toBe(false);
    });
});
