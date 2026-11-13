import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { TableAccessor } from "@rebasepro/types";
import { QueryBuilder } from "../src/data/query_builder";

/**
 * The admin accessor's builder: what it collects, and what it hands its
 * accessor's `find` / `listen`. (Moved from `@rebasepro/client`'s tests with
 * the builder; the client's own builder, `SDKQueryBuilder`, keeps the cases
 * that read the collected params through its query string.)
 */

/**
 * The params a builder has collected. They are private, and these tests are
 * about exactly what they hold, so they are read by name and checked.
 */
function getParams(qb: QueryBuilder): Record<string, unknown> {
    const params: unknown = Reflect.get(qb, "params");
    if (typeof params !== "object" || params === null) throw new Error("the builder holds no params");
    return Object.fromEntries(Object.entries(params));
}

/** The accessor's own builder methods, which a QueryBuilder never calls. */
const notCalledByTheBuilder = (): never => {
    throw new Error("QueryBuilder does not call the accessor's builder methods");
};

/** A collection the builder runs against: a jest mock per member it calls. */
function createMockCollection() {
    return {
        where: notCalledByTheBuilder,
        orderBy: notCalledByTheBuilder,
        limit: notCalledByTheBuilder,
        offset: notCalledByTheBuilder,
        search: notCalledByTheBuilder,
        vectorSearch: notCalledByTheBuilder,
        include: notCalledByTheBuilder,
        find: jest.fn<TableAccessor["find"]>(),
        findById: jest.fn<TableAccessor["findById"]>(),
        create: jest.fn<TableAccessor["create"]>(),
        update: jest.fn<TableAccessor["update"]>(),
        delete: jest.fn<TableAccessor["delete"]>(),
        listen: jest.fn<NonNullable<TableAccessor["listen"]>>()
    };
}

describe("QueryBuilder", () => {
    let mockCollection: ReturnType<typeof createMockCollection>;

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

            const params = getParams(result);
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

            mockCollection.find.mockResolvedValueOnce({ data: [],
meta: { total: 0, limit: 20, offset: 0, hasMore: false } });
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

            mockCollection.find.mockResolvedValueOnce({ data: [],
meta: { total: 0, limit: 20, offset: 0, hasMore: false } });
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

            mockCollection.find.mockResolvedValueOnce({ data: [],
meta: { total: 0, limit: 20, offset: 0, hasMore: false } });
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
            const { listen: _listen, ...col } = createMockCollection();
            const qb = new QueryBuilder(col);
            expect(() => qb.listen(jest.fn())).toThrow("Listen is only available when RebaseClient is configured with a websocketUrl.");
        });

        it("calls listen on collection with built params", () => {
            const qb = new QueryBuilder(mockCollection);
            qb.where("age", "==", 18);

            const removeListener = jest.fn();
            mockCollection.listen.mockReturnValue(removeListener);

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

            mockCollection.listen.mockReturnValue(jest.fn());
            qb.listen(cb, errCb);

            expect(mockCollection.listen).toHaveBeenCalledWith(
                expect.any(Object),
                cb,
                errCb
            );
        });

        it("returns unsubscribe function from listen", () => {
            const unsubFn = jest.fn();
            mockCollection.listen.mockReturnValue(unsubFn);

            const qb = new QueryBuilder(mockCollection);
            const result = qb.listen(jest.fn());
            expect(result).toBe(unsubFn);
        });
    });
});
