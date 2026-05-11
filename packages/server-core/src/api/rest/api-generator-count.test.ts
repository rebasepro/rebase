import { describe, it, expect, vi, beforeEach } from "vitest";
import { RestApiGenerator } from "./api-generator";
import type { DataDriver, EntityCollection, FetchCollectionProps } from "@rebasepro/types";

/**
 * Minimal mock DataDriver for testing.
 */
function createMockDriver(overrides?: Partial<DataDriver>): DataDriver {
    return {
        fetchCollection: vi.fn().mockResolvedValue([]),
        fetchEntity: vi.fn().mockResolvedValue(null),
        saveEntity: vi.fn().mockResolvedValue({ id: "1", path: "test", values: {} }),
        deleteEntity: vi.fn().mockResolvedValue(undefined),
        countEntities: vi.fn().mockResolvedValue(0),
        ...overrides,
    } as unknown as DataDriver;
}

function createTestCollection(slug: string): EntityCollection {
    return {
        slug,
        name: slug.charAt(0).toUpperCase() + slug.slice(1),
        path: slug,
        properties: {},
    } as unknown as EntityCollection;
}

describe("RestApiGenerator - Count Endpoint", () => {
    let driver: DataDriver;
    let collection: EntityCollection;

    beforeEach(() => {
        driver = createMockDriver({
            countEntities: vi.fn().mockResolvedValue(42),
        });
        collection = createTestCollection("products");
    });

    it("GET /products/count should return a count object", async () => {
        const generator = new RestApiGenerator([collection], driver);
        const app = generator.generateRoutes();

        const res = await app.request("/products/count");
        expect(res.status).toBe(200);

        const json = await res.json() as { count: number };
        expect(json.count).toBe(42);
    });

    it("should pass filters to countEntities driver", async () => {
        const generator = new RestApiGenerator([collection], driver);
        const app = generator.generateRoutes();

        const res = await app.request("/products/count?status=eq.active");
        expect(res.status).toBe(200);

        const json = await res.json() as { count: number };
        expect(json.count).toBe(42);

        // Verify countEntities was called with the filter
        expect(driver.countEntities).toHaveBeenCalled();
        const callArgs = (driver.countEntities as ReturnType<typeof vi.fn>).mock.calls[0][0] as FetchCollectionProps;
        expect(callArgs.path).toBe("products");
        expect(callArgs.filter).toHaveProperty("status");
    });

    it("should pass searchString to countEntities driver", async () => {
        const generator = new RestApiGenerator([collection], driver);
        const app = generator.generateRoutes();

        const res = await app.request("/products/count?searchString=widget");
        expect(res.status).toBe(200);

        const json = await res.json() as { count: number };
        expect(json.count).toBe(42);

        expect(driver.countEntities).toHaveBeenCalled();
        const callArgs = (driver.countEntities as ReturnType<typeof vi.fn>).mock.calls[0][0] as FetchCollectionProps;
        expect(callArgs.searchString).toBe("widget");
    });

    it("should return 0 when countEntities is not available on driver", async () => {
        const driverWithoutCount = createMockDriver({ countEntities: undefined });
        const generator = new RestApiGenerator([collection], driverWithoutCount);
        const app = generator.generateRoutes();

        const res = await app.request("/products/count");
        expect(res.status).toBe(200);

        const json = await res.json() as { count: number };
        expect(json.count).toBe(0);
    });

    it("GET /products/count should not be confused with GET /products/:id", async () => {
        // Ensure the count route is registered before the :id route
        const fetchEntity = vi.fn().mockResolvedValue(null);
        const driverCustom = createMockDriver({
            countEntities: vi.fn().mockResolvedValue(99),
            fetchEntity,
        });
        const generator = new RestApiGenerator([collection], driverCustom);
        const app = generator.generateRoutes();

        const res = await app.request("/products/count");
        expect(res.status).toBe(200);

        const json = await res.json() as { count: number };
        expect(json.count).toBe(99);

        // fetchEntity should NOT have been called (i.e. "count" was not treated as an entity ID)
        expect(fetchEntity).not.toHaveBeenCalled();
    });
});
