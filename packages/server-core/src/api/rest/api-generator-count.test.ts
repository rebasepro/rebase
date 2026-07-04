import { jest } from "@jest/globals";
import { Hono } from "hono";
import { RestApiGenerator } from "./api-generator";
import type { DataDriver, Snapshot, CollectionConfig, FetchCollectionProps } from "@rebasepro/types";

/**
 * Minimal mock DataDriver for testing.
 */
function createMockDriver(overrides?: Partial<DataDriver>): DataDriver {
    return {
        fetchCollection: jest.fn<DataDriver["fetchCollection"]>().mockResolvedValue([]),
        fetchOne: jest.fn<DataDriver["fetchOne"]>().mockResolvedValue(undefined),
        save: jest.fn<DataDriver["save"]>().mockResolvedValue({ id: "1",
path: "test",
values: {} } as Snapshot),
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

        // fetchOne should NOT have been called (i.e. "count" was not treated as a snapshot ID)
        expect(fetchOne).not.toHaveBeenCalled();
    });
});
