/**
 * Compile-time tests for `AggregateParams.orderBy`.
 *
 * The REST route has always sorted a grouped aggregate by a group column or an
 * aggregate's alias; the type did not say so, so a typed caller could not ask
 * for it without a cast. The content is in the `@ts-expect-error` lines, which
 * fail `pnpm typecheck` (this directory is in `tsconfig.tests.json`) if the
 * line they mark ever starts compiling.
 */
import type { AggregateParams } from "../src";

/** A type alias, as generated models are: no index signature to widen `keyof`. */
type Order = {
    id: string;
    status: string;
    total: number;
    created_at: string;
};

describe("AggregateParams.orderBy", () => {
    it("takes a group column and an aggregate alias, in either form", () => {
        const byGroup: AggregateParams<Order> = {
            select: [{ fn: "sum", field: "total" }, { fn: "count" }],
            groupBy: ["status"],
            orderBy: ["status", "asc"]
        };
        const byAlias: AggregateParams<Order> = {
            select: [{ fn: "sum", field: "total" }, { fn: "count" }],
            groupBy: ["status"],
            orderBy: [["sum_total", "desc"], ["count", "asc"], ["max_created_at", "desc", "last"]]
        };
        expect([byGroup, byAlias]).toHaveLength(2);
    });

    it("refuses a key that is neither", () => {
        const unknown: AggregateParams<Order> = {
            select: [{ fn: "count" }],
            groupBy: ["status"],
            // @ts-expect-error — not a column, and not an aggregate's alias
            orderBy: ["nope", "desc"]
        };
        const sumOfText: AggregateParams<Order> = {
            select: [{ fn: "count" }],
            groupBy: ["status"],
            // @ts-expect-error — `sum` only adds up numbers, so `sum_status` is no alias
            orderBy: ["sum_status", "desc"]
        };
        const direction: AggregateParams<Order> = {
            select: [{ fn: "count" }],
            groupBy: ["status"],
            // @ts-expect-error — the direction is "asc" or "desc"
            orderBy: ["count", "down"]
        };
        expect([unknown, sumOfText, direction]).toHaveLength(3);
    });
});
