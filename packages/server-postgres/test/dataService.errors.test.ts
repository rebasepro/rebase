import { DataService } from "../src/services/dataService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CollectionConfig } from "@rebasepro/types";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
const collectionRegistry = new PostgresCollectionRegistry();

/**
 * The literal SQL a condition will emit — string fragments and column names,
 * and nothing else.
 *
 * The db here is a mock, so no statement is ever prepared and "it did not
 * throw" proves nothing about how a value was handled. Splitting a condition
 * into the text it renders and the data it carries does: a value that appears
 * in {@link sqlTextOf} was spliced into the statement, and one that appears in
 * {@link boundValuesOf} was handed to the driver as a parameter.
 *
 * `PgDialect.sqlToQuery` is the real renderer, but it needs real `Column`
 * instances and the table below is a plain object — hence the walk over
 * `queryChunks`.
 */
function sqlTextOf(node: unknown): string {
    if (node && typeof node === "object") {
        const chunk = node as Record<string, unknown>;
        if (Array.isArray(chunk.queryChunks)) return chunk.queryChunks.map(sqlTextOf).join("");
        if (Array.isArray(chunk.value)) return chunk.value.join("");
        if (typeof chunk.name === "string") return chunk.name;
    }
    return "";
}

/** The data a condition carries, in the order the driver would bind it. */
function boundValuesOf(node: unknown): unknown[] {
    if (node && typeof node === "object") {
        const chunk = node as Record<string, unknown>;
        if (Array.isArray(chunk.queryChunks)) return chunk.queryChunks.flatMap(boundValuesOf);
        if (Array.isArray(chunk.value)) return [];
        if (typeof chunk.name === "string") return [];
        if ("value" in chunk) return [chunk.value];
        return [];
    }
    return [node];
}

describe("DataService - Error Handling & Edge Cases", () => {
    let dataService: DataService;
    let db: jest.Mocked<NodePgDatabase<any>>;

    const mockTable = {
        id: { name: "id",
dataType: "number" },
        name: { name: "name" },
        _def: { tableName: "test_table" }
    };

    const testCollection: CollectionConfig = {
        slug: "test",
        name: "Test Collection",
        table: "test_table",
        properties: {
            id: { type: "number" },
            name: { type: "string" }
        },
        idField: "id"
    };

    beforeEach(() => {
        jest.clearAllMocks();

        jest.spyOn(collectionRegistry, "getCollectionByPath").mockImplementation(path => {
            if (path === "test" || path === "test_table") return testCollection;
            return undefined;
        });

        jest.spyOn(collectionRegistry, "getTable").mockImplementation(tableName => {
            if (tableName === "test_table") return mockTable as any;
            return undefined;
        });

        db = {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            $dynamic: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            innerJoin: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            values: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            delete: jest.fn().mockReturnThis(),
            // UPDATE and DELETE report how many rows they matched; the driver rejects a
            // write that matched none, so the chainable mock has to carry a row count.
            rowCount: 1,
            transaction: jest.fn((callback) => callback(db))
        } as any;

        // Add a then method to make the db object awaitable when the query chain ends
        (db as any).then = jest.fn((resolve) => resolve(Object.assign([], { rowCount: 1 })));

        dataService = new DataService(db, collectionRegistry);
    });

    describe("Collection Registry Errors", () => {
        it("should throw error when collection is not found", async () => {
            await expect(
                dataService.fetchOne("nonexistent", 1)
            ).rejects.toThrow("Collection not found: nonexistent");
        });

        it("should throw error when table is not found for collection", async () => {
            jest.spyOn(collectionRegistry, "getTable").mockReturnValue(undefined);

            await expect(
                dataService.fetchOne("test", 1)
            ).rejects.toThrow("Table not found for collection");
        });


    });

    describe("ID Type Validation", () => {
        it("should handle valid numeric ID strings", async () => {
            const mockEntity = { id: 123,
name: "Test" };
            db.limit.mockResolvedValue([mockEntity]);

            const entity = await dataService.fetchOne("test", "123");
            expect(entity?.id).toBe("123");
        });

        it("reports an id no row could have as no row, not as an error", async () => {
            // See the same case in dataService.test.ts: unaddressable is 404,
            // not 500 — and on a uuid key, not an aborted transaction either.
            await expect(
                dataService.fetchOne("test", "invalid-number")
            ).resolves.toBeUndefined();
        });

        it("never sends a non-UUID to a uuid key column", async () => {
            // `/c/products/new` in the admin. Postgres answers a uuid
            // comparison against "new" with 22P02 and aborts the transaction
            // the read runs in, so the error the user sees is the 25P02 that
            // the *next* statement raises — about a transaction they never
            // asked for. The column can be asked first, and cannot hold it.
            const uuidTable = {
                id: { name: "id",
columnType: "PgUUID",
dataType: "string",
primary: true },
                name: { name: "name" },
                _def: { tableName: "uuid_table" }
            };
            const uuidCollection: CollectionConfig = {
                slug: "uuidthings",
                name: "UUID things",
                table: "uuid_table",
                properties: {
                    id: { type: "string",
isId: "uuid" },
                    name: { type: "string" }
                }
            } as CollectionConfig;

            jest.spyOn(collectionRegistry, "getCollectionByPath").mockImplementation(path =>
                (path === "uuidthings" || path === "uuid_table") ? uuidCollection : undefined);
            jest.spyOn(collectionRegistry, "getTable").mockImplementation(tableName =>
                tableName === "uuid_table" ? uuidTable as any : undefined);

            await expect(dataService.fetchOne("uuidthings", "new")).resolves.toBeUndefined();
            expect(db.select).not.toHaveBeenCalled();

            // A well-formed uuid still reaches the database.
            db.limit.mockResolvedValue([{ id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
name: "Test" }]);
            await dataService.fetchOne("uuidthings", "3f2504e0-4f89-11d3-9a0c-0305e82c3301");
            expect(db.select).toHaveBeenCalled();
        });

        it("should handle zero as valid ID", async () => {
            const mockEntity = { id: 0,
name: "Test" };
            db.limit.mockResolvedValue([mockEntity]);

            const entity = await dataService.fetchOne("test", 0);
            expect(entity?.id).toBe("0");
        });

        it("should handle negative numbers as valid ID", async () => {
            const mockEntity = { id: -1,
name: "Test" };
            db.limit.mockResolvedValue([mockEntity]);

            const entity = await dataService.fetchOne("test", -1);
            expect(entity?.id).toBe("-1");
        });
    });

    describe("Database Operation Errors", () => {
        it("should propagate database connection errors on fetch", async () => {
            const dbError = new Error("Connection timeout");
            db.limit.mockRejectedValue(dbError);

            await expect(
                dataService.fetchOne("test", 1)
            ).rejects.toThrow("Connection timeout");
        });

        it("should propagate database errors on save", async () => {
            const dbError = new Error("Constraint violation");
            db.returning.mockRejectedValue(dbError);

            await expect(
                dataService.save("test", { name: "Test" })
            ).rejects.toThrow("Constraint violation");
        });

        it("should propagate database errors on delete", async () => {
            const dbError = new Error("Foreign key constraint");
            // Fix: Mock the delete method since delete doesn't use returning()
            db.delete.mockReturnValue({
                where: jest.fn().mockRejectedValue(dbError)
            } as any);

            await expect(
                dataService.delete("test", 1)
            ).rejects.toThrow("Foreign key constraint");
        });

        it("should handle transaction rollback scenarios", async () => {
            const transactionError = new Error("Transaction failed");
            db.transaction.mockImplementation((callback) => {
                throw transactionError;
            });

            await expect(
                dataService.save("test", { name: "Test" })
            ).rejects.toThrow("Transaction failed");
        });
    });

    describe("Path Validation", () => {
        it("should reject paths with even number of segments", async () => {
            await expect(
                dataService.fetchCollection("collection/id", {})
            ).rejects.toThrow("Invalid relation path: collection/id");
        });

        it("should read a single segment path as a root collection, not a relation path", async () => {
            // A slug never contains a separator, so "no separator" is exactly
            // what tells a root path from a nested one. This is the accepting
            // half of the rejections around it: widen what counts as nested and
            // every ordinary listing starts failing as a malformed relation
            // path — which is why the acceptance needs a test of its own.
            db.orderBy.mockResolvedValue([{ id: 7,
name: "Root row" }]);

            const entities = await dataService.fetchCollection("test", {});

            expect(entities).toHaveLength(1);
            expect(entities[0].name).toBe("Root row");
        });

        it("should reject a path whose last segment names no relation", async () => {
            // Well-formed shape, unresolvable meaning: three segments make a
            // relation path, but `test` declares no relations, so nothing can
            // be served. Named in the error, so a caller with a typo is told
            // which segment is wrong instead of reading an empty listing as
            // "no rows".
            await expect(
                dataService.fetchCollection("test/1/missing_relation", {})
            ).rejects.toThrow("Relation 'missing_relation' not found in collection 'test'");
        });

        it("should reject empty path segments", async () => {
            await expect(
                dataService.fetchCollection("collection//relation", {})
            ).rejects.toThrow("Invalid relation path");
        });
    });

    describe("Concurrent Operations", () => {
        it("should handle multiple simultaneous reads", async () => {
            const mockEntity = { id: 1,
name: "Test" };
            db.limit.mockResolvedValue([mockEntity]);

            const promises = Array(10).fill(0).map(() =>
                dataService.fetchOne("test", 1)
            );

            const results = await Promise.all(promises);

            expect(results).toHaveLength(10);
            results.forEach(result => {
                expect(result?.id).toBe("1");
            });
        });

        it("should handle race conditions in write operations", async () => {
            db.returning.mockResolvedValue([{ id: 1 }]);
            db.limit.mockResolvedValue([{ id: 1,
name: "Updated" }]);

            const promises = Array(5).fill(0).map((_, i) =>
                dataService.save("test", { name: `Update ${i}` }, 1)
            );

            const results = await Promise.all(promises);

            expect(results).toHaveLength(5);
            // Each concurrent save gets its own transaction — sharing one would
            // let a rollback in the loser take the winner's write with it.
            expect(db.transaction).toHaveBeenCalledTimes(5);
            // And each is an UPDATE of the id it was given. Five saves that
            // fell through to INSERT would still resolve five times, which is
            // all "they all succeeded" ever checked.
            expect(db.update).toHaveBeenCalledTimes(5);
            expect(db.insert).not.toHaveBeenCalled();
            // Sorted, because the five saves interleave: what matters is that
            // each carried its own payload to SET rather than five copies of
            // whichever one won a shared buffer.
            const written = db.set.mock.calls.map(([payload]) => (payload as { name: string }).name).sort();
            expect(written).toEqual(["Update 0", "Update 1", "Update 2", "Update 3", "Update 4"]);
        });
    });

    describe("Memory and Performance", () => {
        it("should handle large result sets without memory issues", async () => {
            const largeResultSet = Array(1000).fill(0).map((_, i) => ({
                id: i,
                name: `Entity ${i}`
            }));
            db.orderBy.mockResolvedValue(largeResultSet);

            const entities = await dataService.fetchCollection("test", {});

            expect(entities).toHaveLength(1000);
            expect(entities[0].name).toBe("Entity 0");
            expect(entities[999].name).toBe("Entity 999");
        });

        it("should handle pagination correctly for large datasets", async () => {
            const mockEntities = Array(50).fill(0).map((_, i) => ({
                id: i + 1,
                name: `Entity ${i + 1}`
            }));
            // Override the then method to return our mock data for this specific test
            (db as any).then = jest.fn((resolve) => resolve(mockEntities.slice(0, 20)));

            const entities = await dataService.fetchCollection("test", {
                limit: 20
            });

            expect(entities).toHaveLength(20);
            expect(db.limit).toHaveBeenCalledWith(20);
        });
    });

    describe("Data Integrity", () => {
        it("should report a missing required field by name", async () => {
            // The driver validates nothing itself — the NOT NULL constraint is
            // the only thing that knows which fields are required, so an
            // incomplete row is sent and the database decides. What the driver
            // owns is the answer: a raw PG error reaches the caller as
            // `Failed query: insert into ...` with the parameters attached,
            // which names neither the field nor the row.
            const notNullViolation = Object.assign(
                new Error("null value in column \"name\" violates not-null constraint"),
                { code: "23502",
column: "name",
table: "test_table" }
            );
            db.returning.mockRejectedValue(notNullViolation);

            await expect(
                dataService.save("test", {})
            ).rejects.toThrow("Missing required field: \"name\" in \"test_table\" cannot be empty.");

            // Sent, not rejected up front: the empty row still reaches the
            // INSERT, which is what makes the database the authority here.
            expect(db.insert).toHaveBeenCalled();
        });

        it("should handle NULL values in database correctly", async () => {
            const mockEntity = { id: 1,
name: null };
            db.limit.mockResolvedValue([mockEntity]);

            const entity = await dataService.fetchOne("test", 1);
            expect(entity?.name).toBeNull();
        });

        it("should handle undefined values in input data", async () => {
            const entityWithUndefined = { name: undefined };

            db.returning.mockResolvedValue([{ id: 1 }]);
            db.limit.mockResolvedValue([{ id: 1,
name: null }]);

            const entity = await dataService.save("test", entityWithUndefined);
            expect(entity.id).toBe(1);
        });
    });

    describe("Security and Validation", () => {
        it("should handle SQL injection attempts in IDs safely", async () => {
            const maliciousId = "1; DROP TABLE test_table;--";

            const mockEntity = { id: 1,
name: "Safe" };
            db.limit.mockResolvedValue([mockEntity]);

            await dataService.fetchOne("test", maliciousId);

            // Nothing is executed here, so "it did not throw" is not evidence
            // of anything. The condition the lookup composed is: the id is
            // carried as data, and the only SQL text is the comparison itself.
            const condition = db.where.mock.calls[0][0];
            expect(sqlTextOf(condition)).toBe("id = ");
            // A numeric key parses the address before comparing it, so what is
            // bound is the number 1 — the trailing statement never even
            // survives as data, let alone as SQL.
            expect(boundValuesOf(condition)).toEqual([1]);
        });

        it("should handle extremely long input values", async () => {
            const veryLongString = "a".repeat(10000);
            const entityWithLongValue = { name: veryLongString };

            db.returning.mockResolvedValue([{ id: 1 }]);
            db.limit.mockResolvedValue([{ id: 1,
name: veryLongString }]);

            await dataService.save("test", entityWithLongValue);

            // Whatever the mock echoes back is the mock's, not the driver's.
            // The value written is the assertion: serialization walks every
            // field on the way in, and a length limit imposed there would
            // truncate the row without the write ever failing.
            expect(db.values).toHaveBeenCalledWith({ name: veryLongString });
        });

        it("should handle special characters in string values", async () => {
            const specialChars = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~";
            const entityWithSpecialChars = { name: specialChars };

            db.returning.mockResolvedValue([{ id: 1 }]);
            db.limit.mockResolvedValue([{ id: 1,
name: specialChars }]);

            await dataService.save("test", entityWithSpecialChars);

            // Byte-for-byte, quotes and backslashes included: escaping belongs
            // to the driver that binds the parameter, and a layer that escaped
            // on the way in would store the escapes.
            expect(db.values).toHaveBeenCalledWith({ name: specialChars });
        });
    });

    describe("Edge Case Data Types", () => {
        it("should handle boolean false values correctly", async () => {
            const booleanCollection = {
                ...testCollection,
                properties: {
                    id: { type: "number" },
                    active: { type: "boolean" }
                }
            };
            jest.spyOn(collectionRegistry, "getCollectionByPath").mockReturnValue(booleanCollection);

            const mockEntity = { id: 1,
active: false };
            db.limit.mockResolvedValue([mockEntity]);

            const entity = await dataService.fetchOne("test", 1);
            expect(entity?.active).toBe(false);
        });

        it("should handle zero values correctly", async () => {
            const numericCollection = {
                ...testCollection,
                properties: {
                    id: { type: "number" },
                    count: { type: "number" }
                }
            };
            jest.spyOn(collectionRegistry, "getCollectionByPath").mockReturnValue(numericCollection);

            const mockEntity = { id: 1,
count: 0 };
            db.limit.mockResolvedValue([mockEntity]);

            const entity = await dataService.fetchOne("test", 1);
            expect(entity?.count).toBe(0);
        });

        it("should handle empty string values correctly", async () => {
            const mockEntity = { id: 1,
name: "" };
            db.limit.mockResolvedValue([mockEntity]);

            const entity = await dataService.fetchOne("test", 1);
            expect(entity?.name).toBe("");
        });
    });
});
