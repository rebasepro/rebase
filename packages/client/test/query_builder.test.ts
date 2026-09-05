import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { and, cond, or, QueryBuilder } from "../src/query_builder";
import { CollectionClient } from "../src/collection";
import { buildQueryString } from "../src/transport";
import { FindParams, WhereFilterOp } from "@rebasepro/types";

function getParams(qb: QueryBuilder<any>): any {
    return (qb as unknown as { params: FindParams }).params;
}

function createMockCollection(): CollectionClient<any> {
    return {
        find: jest.fn(),
        findById: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        listen: jest.fn(),
        where: jest.fn(),
        orderBy: jest.fn(),
        limit: jest.fn(),
        offset: jest.fn(),
        search: jest.fn(),
        include: jest.fn()
    } as unknown as CollectionClient<any>;
}

describe("QueryBuilder", () => {
    let mockCollection: CollectionClient<any>;

    beforeEach(() => {
        mockCollection = createMockCollection();
    });

    // -----------------------------------------------------------------------
    // Operator storage
    //
    // These titles used to claim a mapping ("maps == to eq") that the builder
    // never performs: `where()` stores the canonical tuple verbatim, and the
    // translation to REST short codes happens later, in `buildQueryString`.
    // The mapping itself is covered by "REST wire mapping" at the bottom of
    // this file — at the layer that actually does it.
    // -----------------------------------------------------------------------
    describe("Operator storage (canonical tuples, unmapped)", () => {
        it("stores == verbatim", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("age", "==", 18);
            expect(getParams(qb).where).toEqual({ age: ["==", 18] });
        });

        it("stores != verbatim", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("age", "!=", 18);
            expect(getParams(qb).where).toEqual({ age: ["!=", 18] });
        });

        it("stores > verbatim", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("score", ">", 100);
            expect(getParams(qb).where).toEqual({ score: [">", 100] });
        });

        it("stores >= verbatim", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("score", ">=", 50);
            expect(getParams(qb).where).toEqual({ score: [">=", 50] });
        });

        it("stores < verbatim", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("score", "<", 10);
            expect(getParams(qb).where).toEqual({ score: ["<", 10] });
        });

        it("stores <= verbatim", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("score", "<=", 0);
            expect(getParams(qb).where).toEqual({ score: ["<=", 0] });
        });

        it("stores array-contains verbatim", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("tags", "array-contains", "featured");
            expect(getParams(qb).where).toEqual({ tags: ["array-contains", "featured"] });
        });

        it("stores array-contains-any verbatim, array value intact", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("tags", "array-contains-any", ["a", "b"]);
            expect(getParams(qb).where).toEqual({ tags: ["array-contains-any", ["a", "b"]] });
        });

        it("stores not-in verbatim, array value intact", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("status", "not-in", ["deleted", "archived"]);
            expect(getParams(qb).where).toEqual({ status: ["not-in", ["deleted", "archived"]] });
        });

        it("passes through short operators (eq, neq, gt, gte, lt, lte) directly", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("x", "gt", 5);
            expect(getParams(qb).where).toEqual({ x: ["gt", 5] });
        });

        it("passes through in operator for arrays", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("status", "in", ["active", "pending"]);
            expect(getParams(qb).where).toEqual({ status: ["in", ["active", "pending"]] });
        });

        it("passes through cs and csa operators", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("tags", "cs", "test");
            expect(getParams(qb).where).toEqual({ tags: ["cs", "test"] });
        });
    });

    // -----------------------------------------------------------------------
    // Null / edge case values
    // -----------------------------------------------------------------------
    describe("Special values", () => {
        it("handles null values", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("deletedAt", "==", null);
            expect(getParams(qb).where).toEqual({ deletedAt: ["==", null] });
        });

        it("handles string values", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("name", "==", "John");
            expect(getParams(qb).where).toEqual({ name: ["==", "John"] });
        });

        it("handles boolean values", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("active", "==", true);
            expect(getParams(qb).where).toEqual({ active: ["==", true] });
        });

        it("handles empty string", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("name", "==", "");
            expect(getParams(qb).where).toEqual({ name: ["==", ""] });
        });

        it("handles zero", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("count", "==", 0);
            expect(getParams(qb).where).toEqual({ count: ["==", 0] });
        });
    });

    // -----------------------------------------------------------------------
    // orderBy
    // -----------------------------------------------------------------------
    describe("orderBy", () => {
        it("sets default ascending order", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.orderBy("createdAt");
            expect(getParams(qb).orderBy).toEqual([["createdAt", "asc"]]);
        });

        it("sets descending order", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.orderBy("createdAt", "desc");
            expect(getParams(qb).orderBy).toEqual([["createdAt", "desc"]]);
        });

        it("adds a tie-breaker on a second call rather than replacing the sort", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.orderBy("name", "asc").orderBy("date", "desc");
            // This used to keep only the last call, which made a multi-column
            // sort unexpressible through the builder. Keys now apply in the
            // order they were added: by name, newest first within each name.
            expect(getParams(qb).orderBy).toEqual([["name", "asc"], ["date", "desc"]]);
        });
    });

    // -----------------------------------------------------------------------
    // limit / offset
    // -----------------------------------------------------------------------
    describe("limit / offset", () => {
        it("sets limit correctly", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.limit(10);
            expect(getParams(qb).limit).toEqual(10);
        });

        it("sets offset correctly", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.offset(20);
            expect(getParams(qb).offset).toEqual(20);
        });

        it("allows overriding limit", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.limit(10).limit(50);
            expect(getParams(qb).limit).toEqual(50);
        });
    });

    // -----------------------------------------------------------------------
    // search
    // -----------------------------------------------------------------------
    describe("search", () => {
        it("sets searchString correctly", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.search("hello world");
            expect(getParams(qb).searchString).toEqual("hello world");
        });

        it("handles empty search string", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.search("");
            expect(getParams(qb).searchString).toEqual("");
        });
    });

    // -----------------------------------------------------------------------
    // include
    // -----------------------------------------------------------------------
    describe("include", () => {
        it("sets relations correctly", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.include("tags", "author");
            expect(getParams(qb).include).toEqual(["tags", "author"]);
        });

        it("sets wildcard include", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.include("*");
            expect(getParams(qb).include).toEqual(["*"]);
        });

        it("overrides previous include", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.include("tags").include("author");
            expect(getParams(qb).include).toEqual(["author"]);
        });
    });

    // -----------------------------------------------------------------------
    // Chaining
    // -----------------------------------------------------------------------
    describe("Method chaining", () => {
        it("supports full chain: where → orderBy → limit → offset → search → include", () => {
            const qb = new QueryBuilder(mockCollection);
            const result = qb
                .where("age", ">=", 18)
                .where("status", "==", "active")
                .orderBy("name", "asc")
                .limit(25)
                .offset(50)
                .search("keyword")
                .include("profile");

            const params = (result as any).params;
            expect(params.where).toEqual({
                age: [">=", 18],
                status: ["==", "active"]
            });
            expect(params.orderBy).toEqual([["name", "asc"]]);
            expect(params.limit).toBe(25);
            expect(params.offset).toBe(50);
            expect(params.searchString).toBe("keyword");
            expect(params.include).toEqual(["profile"]);
        });

        it("all methods return 'this' for chaining", () => {
            const qb = new QueryBuilder(mockCollection);
            expect(qb.where("a", "==", 1)).toBe(qb);
            expect(qb.orderBy("a")).toBe(qb);
            expect(qb.limit(1)).toBe(qb);
            expect(qb.offset(1)).toBe(qb);
            expect(qb.search("x")).toBe(qb);
            expect(qb.include("r")).toBe(qb);
        });

        it("supports multiple where conditions", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("a", "==", 1).where("b", ">", 2).where("c", "in", ["x", "y"]);
            expect(getParams(qb).where).toEqual({
                a: ["==", 1],
                b: [">", 2],
                c: ["in", ["x", "y"]]
            });
        });
    });

    // -----------------------------------------------------------------------
    // find execution
    // -----------------------------------------------------------------------
    describe("find execution", () => {
        it("calls find on collection with built params", async () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("age", "==", 18).limit(10).offset(5);

            (mockCollection.find as jest.Mock).mockResolvedValueOnce({ data: [],
meta: {} });
            await qb.find();

            expect(mockCollection.find).toHaveBeenCalledWith({
                where: { age: ["==", 18] },
                limit: 10,
                offset: 5
            });
        });

        it("passes include to find", async () => {
            const qb = new QueryBuilder(mockCollection);
            qb.include("tags", "author").limit(5);

            (mockCollection.find as jest.Mock).mockResolvedValueOnce({ data: [],
meta: {} });
            await qb.find();

            expect(mockCollection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    include: ["tags", "author"],
                    limit: 5
                })
            );
        });

        it("passes search to find", async () => {
            const qb = new QueryBuilder(mockCollection);
            qb.search("test query");

            (mockCollection.find as jest.Mock).mockResolvedValueOnce({ data: [],
meta: {} });
            await qb.find();

            expect(mockCollection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    searchString: "test query"
                })
            );
        });
    });

    // -----------------------------------------------------------------------
    // listen execution
    // -----------------------------------------------------------------------
    describe("listen execution", () => {
        it("throws error if listen is not available on collection", () => {
            const col = createMockCollection();
            (col as any).listen = undefined;
            const qb = new QueryBuilder(col);
            expect(() => qb.listen(jest.fn())).toThrow("Listen is only available when RebaseClient is configured with a websocketUrl.");
        });

        it("calls listen on collection with built params", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("age", "==", 18);

            const removeListener = jest.fn();
            (mockCollection.listen as jest.Mock).mockReturnValue(removeListener);

            const cb = jest.fn();
            const res = qb.listen(cb);

            expect(mockCollection.listen).toHaveBeenCalledWith(
                { where: { age: ["==", 18] } },
                cb,
                undefined
            );
            expect(res).toBe(removeListener);
        });

        it("passes error callback to listen", () => {
            const qb = new QueryBuilder(mockCollection);
            const cb = jest.fn();
            const errCb = jest.fn();

            (mockCollection.listen as jest.Mock).mockReturnValue(jest.fn());
            qb.listen(cb, errCb);

            expect(mockCollection.listen).toHaveBeenCalledWith(
                expect.any(Object),
                cb,
                errCb
            );
        });

        it("returns unsubscribe function from listen", () => {
            const unsubFn = jest.fn();
            (mockCollection.listen as jest.Mock).mockReturnValue(unsubFn);

            const qb = new QueryBuilder(mockCollection);
            const result = qb.listen(jest.fn());
            expect(result).toBe(unsubFn);
        });
    });
});

// ---------------------------------------------------------------------------
// Repeated where() on the SAME column
//
// The only non-trivial branch in `where()`: a second condition on a column
// that already has one does not overwrite it — the two collapse into an array
// of tuples, which is how a range (`>= 18` AND `< 65`) is expressed at all.
// Overwriting instead would silently widen every range query to its second
// bound alone.
// ---------------------------------------------------------------------------
describe("QueryBuilder — repeated where() on one column", () => {
    it("collapses two conditions into an array of tuples", () => {
        const qb = new QueryBuilder(createMockCollection());
        qb.where("age", ">=", 18).where("age", "<", 65);
        expect(getParams(qb).where).toEqual({ age: [[">=", 18], ["<", 65]] });
    });

    it("appends a third condition to the existing array", () => {
        const qb = new QueryBuilder(createMockCollection());
        qb.where("age", ">=", 18).where("age", "<", 65).where("age", "!=", 40);
        expect(getParams(qb).where).toEqual({
            age: [[">=", 18], ["<", 65], ["!=", 40]]
        });
    });

    it("keeps other columns as single tuples", () => {
        const qb = new QueryBuilder(createMockCollection());
        qb.where("age", ">=", 18).where("age", "<", 65).where("status", "==", "active");
        expect(getParams(qb).where).toEqual({
            age: [[">=", 18], ["<", 65]],
            status: ["==", "active"]
        });
    });

    it("survives the trip to the wire as repeated params", () => {
        const qb = new QueryBuilder(createMockCollection());
        qb.where("age", ">=", 18).where("age", "<", 65);
        const decoded = decodeURIComponent(buildQueryString(getParams(qb)));
        expect(decoded).toContain("age=gte.18");
        expect(decoded).toContain("age=lt.65");
    });
});

// ---------------------------------------------------------------------------
// where(logicalCondition) overload
// ---------------------------------------------------------------------------
describe("QueryBuilder — where(logicalCondition)", () => {
    it("stores an or(...) group under `logical`, not under `where`", () => {
        const qb = new QueryBuilder(createMockCollection());
        qb.where(or(cond("status", "==", "draft"), cond("status", "==", "review")));

        const params = getParams(qb);
        expect(params.logical).toEqual({
            type: "or",
            conditions: [
                { column: "status", operator: "==", value: "draft" },
                { column: "status", operator: "==", value: "review" }
            ]
        });
        // The group is a separate axis: it must not leak into the column
        // filters, where it would serialize as a nonsense `status=` param.
        expect(params.where).toEqual({});
    });

    it("composes with ordinary column filters", () => {
        const qb = new QueryBuilder(createMockCollection());
        qb.where("published", "==", true)
            .where(or(cond("author", "==", "a"), cond("author", "==", "b")));

        const decoded = decodeURIComponent(buildQueryString(getParams(qb)));
        expect(decoded).toContain("published=eq.true");
        expect(decoded).toContain("or=(author.eq.a,author.eq.b)");
    });

    /**
     * A second group **narrows**, like every other `.where()` on the chain.
     *
     * It used to replace the first, silently — the one call on the builder that
     * made a query match *more* rows rather than fewer. `find()`'s own
     * `where`/`logical`/`search` are AND-ed with each other, and a dropped `or`
     * returns rows the caller wrote the filter to exclude, which is the
     * direction that does not announce itself.
     */
    it("a second logical group ANDs with the first", () => {
        const qb = new QueryBuilder(createMockCollection());
        qb.where(or(cond("a", "==", 1))).where(and(cond("b", "==", 2)));
        expect(getParams(qb).logical).toEqual({
            type: "and",
            conditions: [
                { type: "or", conditions: [{ column: "a", operator: "==", value: 1 }] },
                { type: "and", conditions: [{ column: "b", operator: "==", value: 2 }] }
            ]
        });
    });
});

// ---------------------------------------------------------------------------
// REST wire mapping
//
// This is the layer the builder's tests used to claim: canonical operators
// become PostgREST short codes here, and nowhere earlier.
// ---------------------------------------------------------------------------
describe("canonical → REST mapping (buildQueryString)", () => {
    const wire = (op: WhereFilterOp, value: unknown) =>
        decodeURIComponent(buildQueryString({ where: { a: [op, value] } as any }));

    it.each([
        ["==", 1, "?a=eq.1"],
        ["!=", 1, "?a=neq.1"],
        [">", 1, "?a=gt.1"],
        [">=", 1, "?a=gte.1"],
        ["<", 1, "?a=lt.1"],
        ["<=", 1, "?a=lte.1"],
        ["like", "x%", "?a=like.x%"],
        ["ilike", "x%", "?a=ilike.x%"],
        ["not-like", "x%", "?a=nlike.x%"],
        ["not-ilike", "x%", "?a=nilike.x%"],
        ["is-null", null, "?a=isnull.null"],
        ["is-not-null", null, "?a=notnull.null"]
    ] as [WhereFilterOp, unknown, string][])("%s serializes to %s", (op, value, expected) => {
        expect(wire(op, value)).toBe(expected);
    });

    it.each([
        ["in", ["x", "y"], "?a=in.(x,y)"],
        ["not-in", ["x", "y"], "?a=nin.(x,y)"],
        ["array-contains", "x", "?a=cs.x"],
        ["array-contains-any", ["x", "y"], "?a=csa.(x,y)"]
    ] as [WhereFilterOp, unknown, string][])("%s serializes to %s", (op, value, expected) => {
        expect(wire(op, value)).toBe(expected);
    });

    it("rejects an operator that is not canonical", () => {
        // The builder happily stores whatever it is handed, so an unknown
        // operator only surfaces here — loudly, rather than as a query the
        // server cannot parse.
        expect(() => buildQueryString({ where: { a: ["gt" as WhereFilterOp, 5] } as any }))
            .toThrow(/unknown operator/);
    });
});
