import { buildRebaseData, wrapAsEntityData } from "../src/data/buildRebaseData";
import { CollectionAccessor, DataDriver, Entity, RebaseData, RebaseSdkData } from "@rebasepro/types";

/**
 * `RebaseData`'s dynamic index signature is a union of a collection accessor
 * and the `collection()` method that shares the namespace with it, so tsc
 * cannot narrow a bare `data.products` on its own. A project generates a
 * `Database` type and gets the narrowing for free; a test does it here.
 */
function at(data: RebaseData, slug: string): CollectionAccessor {
    return data[slug] as CollectionAccessor;
}

// ── Mock driver ─────────────────────────────────────────────
function createMockDriver(overrides: Partial<DataDriver> = {}): DataDriver {
    return {
        fetchCollection: jest.fn().mockResolvedValue([]),
        fetchOne: jest.fn().mockResolvedValue(undefined),
        save: jest.fn().mockImplementation(async ({ path, values, id, status }) => ({
            id: id ?? "new-id",
            path,
            values
        })),
        delete: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(0),
        checkUniqueField: jest.fn().mockResolvedValue(true),
        ...overrides
    } as unknown as DataDriver;
}

describe("buildRebaseData", () => {
    it("creates a proxy that returns CollectionAccessor for any slug", () => {
        const driver = createMockDriver();
        const data = buildRebaseData(driver);

        expect(data.products).toBeDefined();
        expect(data.users).toBeDefined();
        expect(typeof at(data, "products").find).toBe("function");
        expect(typeof at(data, "products").findById).toBe("function");
        expect(typeof at(data, "products").create).toBe("function");
        expect(typeof at(data, "products").update).toBe("function");
        expect(typeof at(data, "products").delete).toBe("function");
    });

    it("caches accessor instances", () => {
        const driver = createMockDriver();
        const data = buildRebaseData(driver);

        const ref1 = data.products;
        const ref2 = data.products;
        expect(ref1).toBe(ref2);
    });

    it("provides a collection() method", () => {
        const driver = createMockDriver();
        const data = buildRebaseData(driver);

        const accessor = data.collection("products");
        expect(accessor).toBe(data.products);
    });

    it("ignores Symbol properties", () => {
        const driver = createMockDriver();
        const data = buildRebaseData(driver);

        expect((data as any)[Symbol.toPrimitive]).toBeUndefined();
    });

    it("ignores 'then' property (Promise interop)", () => {
        const driver = createMockDriver();
        const data = buildRebaseData(driver);

        expect((data as any).then).toBeUndefined();
    });

    it("converts camelCase properties to snake_case slugs", () => {
        const driver = createMockDriver();
        const data = buildRebaseData(driver);

        const companyMembers = (data as any).companyMembers;
        const manualCollection = data.collection("company_members");

        expect(companyMembers).toBe(manualCollection);

        // Let's also verify that creating uses the correct path
        companyMembers.create({ name: "Test" });
        expect(driver.save).toHaveBeenCalledWith(
            expect.objectContaining({
                path: "company_members"
            })
        );
    });

    // ── find ────────────────────────────────────────────────
    describe("CollectionAccessor.find", () => {
        it("delegates to driver.fetchCollection", async () => {
            // The driver returns flat rows; the accessor wraps them into Entities
            const mockRows = [
                { id: "1",
name: "Camera" }
            ];
            const driver = createMockDriver({
                fetchCollection: jest.fn().mockResolvedValue(mockRows)
            });
            const data = buildRebaseData(driver);

            const result = await at(data, "products").find({ limit: 10 });

            expect(driver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({ path: "products",
limit: 10 })
            );
            expect(result.data).toEqual([
                { id: "1",
path: "products",
values: { id: "1",
name: "Camera" } }
            ]);
            expect(result.meta.limit).toBe(10);
        });

        it("converts PostgREST where filters", async () => {
            const driver = createMockDriver({
                fetchCollection: jest.fn().mockResolvedValue([])
            });
            const data = buildRebaseData(driver);

            // Legacy PostgREST-encoded strings: the accessor converts them, but
            // `FindParams["where"]` only admits `[op, value]` tuples, so the
            // fixture cannot be well typed.
            await at(data, "products").find({
                where: { status: "eq.published",
price: "gte.100" } as never
            });

            expect(driver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({
                    filter: {
                        status: ["==", "published"],
                        price: [">=", "100"]
                    }
                })
            );
        });

        it("parses comma-separated list values", async () => {
            const driver = createMockDriver({
                fetchCollection: jest.fn().mockResolvedValue([])
            });
            const data = buildRebaseData(driver);

            await at(data, "products").find({
                where: { role: "in.(admin,editor)" } as never
            });

            expect(driver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({
                    filter: {
                        role: ["in", ["admin", "editor"]]
                    }
                })
            );
        });

        it("parses orderBy string", async () => {
            const driver = createMockDriver({
                fetchCollection: jest.fn().mockResolvedValue([])
            });
            const data = buildRebaseData(driver);

            await at(data, "products").find({ orderBy: ["created_at", "desc"] });

            expect(driver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({
                    orderBy: "created_at",
                    order: "desc"
                })
            );
        });

        it("sets hasMore based on entity count vs limit", async () => {
            const entities = Array.from({ length: 20 }, (_, i) => ({
                id: String(i),
                path: "products",
                values: {}
            }));
            const driver = createMockDriver({
                fetchCollection: jest.fn().mockResolvedValue(entities),
                // When count is available, hasMore is based on
                // total vs offset+fetched. 100 > 0+20 → hasMore=true.
                count: jest.fn().mockResolvedValue(100)
            });
            const data = buildRebaseData(driver);

            const result = await at(data, "products").find({ limit: 20 });
            expect(result.meta.hasMore).toBe(true);
            expect(result.meta.total).toBe(100);

            const partial = entities.slice(0, 5);
            (driver.fetchCollection as jest.Mock).mockResolvedValue(partial);
            // 5 returned, total still 100 → offset 0 + 5 < 100 → hasMore=true
            // but typically the driver returns fewer when near the end
            (driver.count as jest.Mock).mockResolvedValue(5);
            const result2 = await at(data, "products").find({ limit: 20 });
            expect(result2.meta.hasMore).toBe(false);
            expect(result2.meta.total).toBe(5);
        });
    });

    // ── findById ────────────────────────────────────────────
    describe("CollectionAccessor.findById", () => {
        it("delegates to driver.fetchOne", async () => {
            // The driver returns a flat row; the accessor wraps it into a Entity
            const row = { id: "abc",
name: "Camera" };
            const driver = createMockDriver({
                fetchOne: jest.fn().mockResolvedValue(row)
            });
            const data = buildRebaseData(driver);

            const result = await at(data, "products").findById("abc");
            expect(result).toEqual({ id: "abc",
path: "products",
values: { id: "abc",
name: "Camera" } });
            expect(driver.fetchOne).toHaveBeenCalledWith({ path: "products",
id: "abc" });
        });
    });

    // ── create ──────────────────────────────────────────────
    describe("CollectionAccessor.create", () => {
        it("delegates to driver.save with status new", async () => {
            const driver = createMockDriver();
            const data = buildRebaseData(driver);

            await at(data, "products").create({ name: "Camera",
price: 299 });

            expect(driver.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "products",
                    values: { name: "Camera",
price: 299 },
                    status: "new"
                })
            );
        });

        it("passes optional id", async () => {
            const driver = createMockDriver();
            const data = buildRebaseData(driver);

            await at(data, "products").create({ name: "Camera" }, "custom-id");

            expect(driver.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: "custom-id",
                    status: "new"
                })
            );
        });
    });

    // ── update ──────────────────────────────────────────────
    describe("CollectionAccessor.update", () => {
        it("delegates to driver.save with status existing", async () => {
            const driver = createMockDriver();
            const data = buildRebaseData(driver);

            await at(data, "products").update("prod-1", { price: 399 });

            expect(driver.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "products",
                    id: "prod-1",
                    values: { price: 399 },
                    status: "existing"
                })
            );
        });
    });

    // ── delete ──────────────────────────────────────────────
    describe("CollectionAccessor.delete", () => {
        it("delegates to driver.delete", async () => {
            const driver = createMockDriver();
            const data = buildRebaseData(driver);

            await at(data, "products").delete("prod-1");

            expect(driver.delete).toHaveBeenCalledWith(
                expect.objectContaining({
                    row: expect.objectContaining({ id: "prod-1",
path: "products" })
                })
            );
        });
    });

    // ── count ───────────────────────────────────────────────
    describe("CollectionAccessor.count", () => {
        it("delegates to driver.count when available", async () => {
            const driver = createMockDriver();
            const data = buildRebaseData(driver);

            expect(at(data, "products").count).toBeDefined();
            const result = await at(data, "products").count!();
            expect(driver.count).toHaveBeenCalled();
        });

        it("is undefined when driver has no count", () => {
            const driver = createMockDriver({ count: undefined });
            const data = buildRebaseData(driver);
            expect(at(data, "products").count).toBeUndefined();
        });
    });

    // ── Fluent Query Builder ────────────────────────────────
    describe("CollectionAccessor Fluent Queries", () => {
        it("supports fluent query building and translates to find calls", async () => {
            const driver = createMockDriver();
            const data = buildRebaseData(driver);

            await at(data, "products")
                .where("price", ">", 100)
                .orderBy("createdAt", "desc")
                .limit(5)
                .offset(10)
                .search("camera")
                .find();

            expect(driver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "products",
                    filter: {
                        price: [">", 100]
                    },
                    orderBy: "createdAt",
                    order: "desc",
                    limit: 5,
                    offset: 10,
                    searchString: "camera"
                })
            );
        });
    });
});

/**
 * The admin's `useData()` is `wrapAsEntityData(client.data)`, so this is the
 * accessor the CMS actually holds. `createMany` is declared on
 * `CollectionAccessor` and was implemented on the driver-backed accessor only —
 * which is why the admin's own import wrote one HTTP request per row, could not
 * be atomic, and never asked for the upsert its preview screen promised.
 */
describe("wrapAsEntityData", () => {

    function sdkDataWithBulk() {
        const calls: Array<{ rows: Record<string, unknown>[]; options?: { upsert?: boolean } }> = [];
        const collection = () => ({
            find: jest.fn(),
            create: jest.fn(),
            createMany: async (rows: Record<string, unknown>[], options?: { upsert?: boolean }) => {
                calls.push({ rows,
                    options });
                return rows;
            }
        });
        return { calls,
            sdkData: { collection } as unknown as Pick<RebaseSdkData, "collection"> };
    }

    it("exposes createMany and forwards the rows and the upsert flag", async () => {
        const { calls, sdkData } = sdkDataWithBulk();
        const accessor = wrapAsEntityData(sdkData).collection("products");

        expect(accessor.createMany).toBeDefined();
        const written = await accessor.createMany!(
            [{ id: "p1",
                name: "Widget" }],
            { upsert: true }
        );

        expect(calls).toEqual([{
            rows: [{ id: "p1",
                name: "Widget" }],
            options: { upsert: true }
        }]);
        // Entity-shaped on the way back out, like every other accessor method.
        expect(written[0].id).toEqual("p1");
        expect(written[0].values).toEqual({ id: "p1",
            name: "Widget" });
    });
});
