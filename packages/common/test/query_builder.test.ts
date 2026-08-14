import { QueryBuilder } from "../src/data/query_builder";

function createMockCollection() {
    return {
        find: jest.fn().mockResolvedValue({ data: [],
count: 0 }),
        listen: jest.fn().mockReturnValue(() => {})
    };
}

/**
 * These test names used to describe a PostgREST-style prefix encoding — "maps
 * >= to gte prefix", "maps array-contains to cs prefix", "formats null as the
 * string 'null'" — that the builder has never done. It accumulates `[op, value]`
 * tuples and hands them to the accessor untouched; the encoding belongs to
 * whichever transport is underneath. The assertions were right and the names
 * were describing a different implementation.
 */
describe("QueryBuilder", () => {
    describe("where()", () => {
        it("passes == through as an [op, value] tuple", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.where("name", "==", "John").find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { name: ["==", "John"] }
                })
            );
        });

        it("passes >= through as an [op, value] tuple", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.where("age", ">=", 18).find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { age: [">=", 18] }
                })
            );
        });

        it("passes > through as an [op, value] tuple", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.where("score", ">", 100).find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { score: [">", 100] }
                })
            );
        });

        it("passes != through as an [op, value] tuple", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.where("status", "!=", "deleted").find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { status: ["!=", "deleted"] }
                })
            );
        });

        it("passes < through as an [op, value] tuple", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.where("price", "<", 50).find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { price: ["<", 50] }
                })
            );
        });

        it("passes <= through as an [op, value] tuple", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.where("quantity", "<=", 10).find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { quantity: ["<=", 10] }
                })
            );
        });

        it("passes array-contains through as an [op, value] tuple", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.where("tags", "array-contains", "featured").find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tags: ["array-contains", "featured"] }
                })
            );
        });

        it("keeps an array value as an array for the in operator", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.where("status", "in", ["active", "pending"]).find();

            const [op, value] = collection.find.mock.calls[0][0].where.status;
            expect(op).toBe("in");
            // Not "(active,pending)" or any other flattening: whatever encoding a
            // transport needs is the transport's business, and doing it here
            // would leave the driver parsing a string back into a list.
            expect(Array.isArray(value)).toBe(true);
            expect(value).toEqual(["active", "pending"]);
        });

        it("keeps a null value as literal null, never the string \"null\"", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.where("deletedAt", "==", null).find();

            const [op, value] = collection.find.mock.calls[0][0].where.deletedAt;
            expect(op).toBe("==");
            expect(value).toBeNull();
            expect(typeof value).not.toBe("string");
        });

        it("supports chaining multiple where clauses", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb
                .where("age", ">=", 18)
                .where("status", "==", "active")
                .find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { age: [">=", 18],
status: ["==", "active"] }
                })
            );
        });

        it("aggregates multiple filters on the same column instead of overwriting", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb
                .where("age", ">=", 18)
                .where("age", "<=", 30)
                .find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        age: [
                            [">=", 18],
                            ["<=", 30]
                        ]
                    }
                })
            );
        });
    });

    describe("orderBy()", () => {
        it("sets ascending order", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.orderBy("createdAt", "asc").find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    orderBy: [["createdAt", "asc"]]
                })
            );
        });

        it("sets descending order", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.orderBy("updatedAt", "desc").find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    orderBy: [["updatedAt", "desc"]]
                })
            );
        });

        it("defaults to ascending", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.orderBy("name").find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    orderBy: [["name", "asc"]]
                })
            );
        });
    });

    describe("limit()", () => {
        it("sets the limit parameter", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.limit(25).find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 25 })
            );
        });
    });

    describe("offset()", () => {
        it("sets the offset parameter", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.offset(50).find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({ offset: 50 })
            );
        });
    });

    describe("search()", () => {
        it("sets the searchString parameter", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.search("hello world").find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({ searchString: "hello world" })
            );
        });
    });

    describe("include()", () => {
        it("sets the include parameter with specific relations", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.include("tags", "author").find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({ include: ["tags", "author"] })
            );
        });

        it("supports wildcard for all relations", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb.include("*").find();

            expect(collection.find).toHaveBeenCalledWith(
                expect.objectContaining({ include: ["*"] })
            );
        });
    });

    describe("chaining", () => {
        it("supports full method chaining", async () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);

            await qb
                .where("status", "==", "active")
                .where("age", ">=", 18)
                .orderBy("createdAt", "desc")
                .limit(10)
                .offset(20)
                .search("keyword")
                .include("tags")
                .find();

            expect(collection.find).toHaveBeenCalledWith({
                where: { status: ["==", "active"],
age: [">=", 18] },
                orderBy: [["createdAt", "desc"]],
                limit: 10,
                offset: 20,
                searchString: "keyword",
                include: ["tags"]
            });
        });
    });

    describe("find()", () => {
        it("returns the result from collection.find()", async () => {
            const collection = createMockCollection();
            collection.find.mockResolvedValue({ data: [{ id: "1" }],
count: 1 });

            const qb = new QueryBuilder(collection as never);
            const result = await qb.find();

            expect(result).toEqual({ data: [{ id: "1" }],
count: 1 });
        });
    });

    describe("listen()", () => {
        it("throws when collection.listen is not available", () => {
            const collection = { find: jest.fn() }; // No listen method
            const qb = new QueryBuilder(collection as never);

            expect(() => qb.listen(() => {})).toThrow(
                "Listen is only available when RebaseClient is configured with a websocketUrl."
            );
        });

        it("calls collection.listen with accumulated params", () => {
            const collection = createMockCollection();
            const qb = new QueryBuilder(collection as never);
            const onUpdate = jest.fn();
            const onError = jest.fn();

            qb.where("status", "==", "active").listen(onUpdate, onError);

            expect(collection.listen).toHaveBeenCalledWith(
                expect.objectContaining({ where: { status: ["==", "active"] } }),
                onUpdate,
                onError
            );
        });

        it("returns the unsubscribe function", () => {
            const unsubscribe = jest.fn();
            const collection = createMockCollection();
            collection.listen.mockReturnValue(unsubscribe);

            const qb = new QueryBuilder(collection as never);
            const result = qb.listen(() => {});

            expect(result).toBe(unsubscribe);
        });
    });
});
