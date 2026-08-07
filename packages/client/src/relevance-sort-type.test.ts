/**
 * `orderBy("_score")` has to typecheck, and a typo still has to not.
 *
 * The runtime accepted `_score` and the docs told people to use it while
 * `orderBy` stayed typed as `keyof M` — so on any project with a generated SDK
 * (where `M` is a concrete row type) the documented call was a compile error.
 * Caught downstream, in a real app, rather than here.
 *
 * These are compile-time assertions; the bodies never run.
 */
import type { FindParams, FindResult, SDKQueryBuilderInterface } from "@rebasepro/types";

interface Talent extends Record<string, unknown> {
    id: string;
    full_name: string;
    created_at: string;
}

describe("relevance is a valid sort key", () => {
    it("accepts _score in FindParams.orderBy", () => {
        const params: FindParams<Talent> = { searchString: "auditor", orderBy: ["_score", "desc"] };
        expect(params.orderBy?.[0]).toBe("_score");
    });

    it("still accepts a real column", () => {
        const params: FindParams<Talent> = { orderBy: ["created_at", "desc"] };
        expect(params.orderBy?.[0]).toBe("created_at");
    });

    it("still rejects a column that does not exist", () => {
        // @ts-expect-error - "nope" is neither a column of Talent nor a computed key
        const params: FindParams<Talent> = { orderBy: ["nope", "desc"] };
        expect(params).toBeDefined();
    });

    it("accepts _score on the fluent builder too", () => {
        const use = (qb: SDKQueryBuilderInterface<Talent>) =>
            qb.search("auditor").orderBy("_score", "desc");
        expect(typeof use).toBe("function");
    });

    it("rejects a typo on the fluent builder", () => {
        // @ts-expect-error - "_scoer" is not a computed sort key
        const use = (qb: SDKQueryBuilderInterface<Talent>) => qb.orderBy("_scoer", "desc");
        expect(typeof use).toBe("function");
    });
});

describe("what a query computes is readable off the row", () => {
    it("exposes _score and _distance as optional numbers", () => {
        const read = (result: FindResult<Talent>) => {
            const row = result.data[0];
            const score: number | undefined = row._score;
            const distance: number | undefined = row._distance;
            const name: string = row.full_name;
            return { score, distance, name };
        };
        expect(typeof read).toBe("function");
    });

    it("does not turn the row into `any` — a missing column is still an error", () => {
        const read = (result: FindResult<Talent>) => {
            // @ts-expect-error - `nope` is not on Talent nor computed
            return result.data[0].nope;
        };
        expect(typeof read).toBe("function");
    });
});
