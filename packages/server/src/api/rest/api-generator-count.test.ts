import { jest } from "@jest/globals";
import { Hono } from "hono";
import { RestApiGenerator } from "./api-generator";
import { errorHandler } from "../errors";
import type { DataDriver, Entity, CollectionConfig, FetchCollectionProps } from "@rebasepro/types";

/**
 * Minimal mock DataDriver for testing.
 */
function createMockDriver(overrides?: Partial<DataDriver>): DataDriver {
    return {
        fetchCollection: jest.fn<DataDriver["fetchCollection"]>().mockResolvedValue([]),
        fetchOne: jest.fn<DataDriver["fetchOne"]>().mockResolvedValue(undefined),
        save: jest.fn<DataDriver["save"]>().mockResolvedValue({ id: "1",
path: "test",
values: {} } as Entity),
        delete: jest.fn<DataDriver["delete"]>().mockResolvedValue(undefined),
        count: jest.fn<NonNullable<DataDriver["count"]>>().mockResolvedValue(0),
        ...overrides
    } as unknown as DataDriver;
}

function createTestCollection(slug: string): CollectionConfig {
    return {
        slug,
        name: slug.charAt(0).toUpperCase() + slug.slice(1),
        path: slug,
        properties: {}
    } as unknown as CollectionConfig;
}

/**
 * Wraps generated routes in a parent Hono app that injects the driver
 * into context — replicating what auth middleware does in production.
 */
function createApp(collections: CollectionConfig[], driver: DataDriver): Hono {
    const parent = new Hono();
    parent.use("/*", async (c, next) => {
        c.set("driver", driver);
        await next();
    });
    const generator = new RestApiGenerator(collections, driver);
    parent.route("/", generator.generateRoutes());
    return parent;
}

describe("RestApiGenerator - Count Endpoint", () => {
    let driver: DataDriver;
    let collection: CollectionConfig;

    beforeEach(() => {
        driver = createMockDriver({
            count: jest.fn<NonNullable<DataDriver["count"]>>().mockResolvedValue(42)
        });
        collection = createTestCollection("products");
    });

    it("GET /products/count should return a count object", async () => {
        const app = createApp([collection], driver);

        const res = await app.request("/products/count");
        expect(res.status).toBe(200);

        const json = await res.json() as { count: number };
        expect(json.count).toBe(42);
    });

    it("should pass filters to count driver", async () => {
        const app = createApp([collection], driver);

        const res = await app.request("/products/count?status=eq.active");
        expect(res.status).toBe(200);

        const json = await res.json() as { count: number };
        expect(json.count).toBe(42);

        // Verify count was called with the filter
        expect(driver.count).toHaveBeenCalled();
        const callArgs = (driver.count as ReturnType<typeof jest.fn>).mock.calls[0][0] as FetchCollectionProps;
        expect(callArgs.path).toBe("products");
        expect(callArgs.filter).toHaveProperty("status");
    });

    it("should pass searchString to count driver", async () => {
        const app = createApp([collection], driver);

        const res = await app.request("/products/count?searchString=widget");
        expect(res.status).toBe(200);

        const json = await res.json() as { count: number };
        expect(json.count).toBe(42);

        expect(driver.count).toHaveBeenCalled();
        const callArgs = (driver.count as ReturnType<typeof jest.fn>).mock.calls[0][0] as FetchCollectionProps;
        expect(callArgs.searchString).toBe("widget");
    });

    it("passes a logical group to the count driver", async () => {
        const app = createApp([collection], driver);

        const res = await app.request("/products/count?or=(status.eq.draft,status.eq.review)");
        expect(res.status).toBe(200);

        const callArgs = (driver.count as ReturnType<typeof jest.fn>).mock.calls[0][0] as FetchCollectionProps;
        expect(callArgs.logical).toBeDefined();
    });

    it("passes a logical group on a nested count too", async () => {
        // Three call sites issue a count in this file; two forwarded the group
        // and this one did not, so `GET /authors/1/posts/count?or=(…)` reported
        // the unnarrowed total beside a narrowed list.
        const authors = {
            ...createTestCollection("authors"),
            properties: {
                products: {
                    type: "relation",
                    relation: { kind: "hasMany", target: () => collection, foreignKeyOnTarget: "author_id" }
                }
            }
        } as unknown as CollectionConfig;
        const app = createApp([collection, authors], driver);

        const res = await app.request("/authors/1/products/count?or=(status.eq.draft,status.eq.review)");
        expect(res.status).toBe(200);

        const callArgs = (driver.count as ReturnType<typeof jest.fn>).mock.calls[0][0] as FetchCollectionProps;
        expect(callArgs.logical).toBeDefined();
    });

    it("should return 0 when count is not available on driver", async () => {
        const driverWithoutCount = createMockDriver({ count: undefined });
        const app = createApp([collection], driverWithoutCount);

        const res = await app.request("/products/count");
        expect(res.status).toBe(200);

        const json = await res.json() as { count: number };
        expect(json.count).toBe(0);
    });

    it("GET /products/count should not be confused with GET /products/:id", async () => {
        // Ensure the count route is registered before the :id route
        const fetchOne = jest.fn<DataDriver["fetchOne"]>().mockResolvedValue(undefined);
        const driverCustom = createMockDriver({
            count: jest.fn<NonNullable<DataDriver["count"]>>().mockResolvedValue(99),
            fetchOne: fetchOne as unknown as DataDriver["fetchOne"]
        });
        const app = createApp([collection], driverCustom);

        const res = await app.request("/products/count");
        expect(res.status).toBe(200);

        const json = await res.json() as { count: number };
        expect(json.count).toBe(99);

        // fetchOne should NOT have been called (i.e. "count" was not treated as a entity ID)
        expect(fetchOne).not.toHaveBeenCalled();
    });
});

/**
 * The `COUNT(*)` beside a list page is most of what a list read costs on a big
 * table: it reads every matching row to report one number. It runs only where
 * the response carries that number, and in the page's own transaction.
 */
describe("RestApiGenerator - the list's count", () => {
    let collection: CollectionConfig;
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

    beforeEach(() => {
        collection = createTestCollection("products");
    });

    it("counts a plain listing, and reports the total", async () => {
        const driver = createMockDriver({
            fetchCollection: jest.fn<DataDriver["fetchCollection"]>().mockResolvedValue(page(10)),
            count: jest.fn<NonNullable<DataDriver["count"]>>().mockResolvedValue(25)
        });
        const res = await createApp([collection], driver).request("/products?limit=10");
        const json = await res.json() as { meta: Record<string, unknown> };

        expect(driver.count).toHaveBeenCalledTimes(1);
        expect(json.meta).toMatchObject({ total: 25, hasMore: true });
    });

    it("does not count with `?count=none`, and takes `hasMore` from one row past the page", async () => {
        const fetchCollection = jest.fn<DataDriver["fetchCollection"]>().mockResolvedValue(page(11));
        const driver = createMockDriver({ fetchCollection });
        const res = await createApp([collection], driver).request("/products?limit=10&count=none");
        const json = await res.json() as { data: unknown[]; meta: Record<string, unknown> };

        expect(driver.count).not.toHaveBeenCalled();
        expect((fetchCollection.mock.calls[0][0] as FetchCollectionProps).limit).toBe(11);
        expect(json.data).toHaveLength(10);
        expect(json.meta).toMatchObject({ hasMore: true, limit: 10, offset: 0 });
        expect(json.meta).not.toHaveProperty("total");
    });

    it("says there is no more when the probe row does not come back", async () => {
        const driver = createMockDriver({
            fetchCollection: jest.fn<DataDriver["fetchCollection"]>().mockResolvedValue(page(4))
        });
        const json = await (await createApp([collection], driver).request("/products?limit=10&offset=20&count=none"))
            .json() as { meta: Record<string, unknown> };

        expect(json.meta).toMatchObject({ hasMore: false, offset: 20 });
    });

    it("does not count a distinct read, whose response has no total", async () => {
        const driver = createMockDriver({
            fetchCollection: jest.fn<DataDriver["fetchCollection"]>().mockResolvedValue(page(3))
        });
        const res = await createApp([collection], driver).request("/products?limit=10&fields=id&distinct=true");
        const json = await res.json() as { meta: Record<string, unknown> };

        expect(driver.count).not.toHaveBeenCalled();
        expect(json.meta).not.toHaveProperty("total");
        expect(json.meta.hasMore).toBe(false);
    });

    it("refuses a `count` it does not know rather than counting anyway", async () => {
        const driver = createMockDriver();
        const app = createApp([collection], driver);
        app.onError(errorHandler);
        const res = await app.request("/products?count=nnone");
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "INVALID_COUNT" } });
        expect(driver.count).not.toHaveBeenCalled();
    });

    it("reads the page and its count through one `readTogether`, when the driver has it", async () => {
        const inner = createMockDriver({
            fetchCollection: jest.fn<DataDriver["fetchCollection"]>().mockResolvedValue(page(2)),
            count: jest.fn<NonNullable<DataDriver["count"]>>().mockResolvedValue(2)
        });
        const readTogether = jest.fn(<T>(work: (d: DataDriver) => Promise<T>) => work(inner));
        const outer = createMockDriver({ readTogether: readTogether as DataDriver["readTogether"] });

        const json = await (await createApp([collection], outer).request("/products?limit=10"))
            .json() as { meta: Record<string, unknown> };

        expect(readTogether).toHaveBeenCalledTimes(1);
        // Both reads on the driver `readTogether` handed over, none on the outer one.
        expect(inner.fetchCollection).toHaveBeenCalledTimes(1);
        expect(inner.count).toHaveBeenCalledTimes(1);
        expect(outer.fetchCollection).not.toHaveBeenCalled();
        expect(outer.count).not.toHaveBeenCalled();
        expect(json.meta).toMatchObject({ total: 2, hasMore: false });
    });
});
