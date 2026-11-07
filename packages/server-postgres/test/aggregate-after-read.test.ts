/**
 * An aggregate never runs `afterRead`, so it must not read what one hides.
 *
 * `afterRead` is where PII masking lives, and an aggregate reads the stored
 * columns: `max(email)` or `groupBy=salary` on a masked collection is the
 * masked value, one bucket at a time. So on a collection any `afterRead` tier
 * (global, collection or property) applies to, only a plain `count()` is
 * served. The rule sits on the driver's `restFetchService.aggregate`, which
 * the REST route, the in-process SDK and the MCP tool all read through — each
 * door is driven here to prove it reaches the refusal.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CollectionConfig, User } from "@rebasepro/types";
import { ApiError } from "@rebasepro/server";

import { AuthenticatedPostgresBackendDriver, PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { FetchService } from "../src/services/FetchService";
import type { RealtimeService } from "../src/services/realtimeService";
import type { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const mask = ({ row }: { row: Record<string, unknown> }) => ({ ...row, email: "***" });

const plain: CollectionConfig = {
    slug: "orders",
    table: "orders",
    properties: { total: { type: "number" }, status: { type: "string" } }
};
const masked: CollectionConfig = {
    slug: "customers",
    table: "customers",
    properties: { email: { type: "string" }, salary: { type: "number" } },
    callbacks: { afterRead: mask }
};
const propertyMasked: CollectionConfig = {
    slug: "staff",
    table: "staff",
    properties: {
        email: { type: "string", callbacks: { afterRead: ({ value }) => (value ? "***" : value) } },
        salary: { type: "number" }
    }
};

function registry(globalAfterRead = false): PostgresCollectionRegistry {
    const collections = [plain, masked, propertyMasked];
    const stub = {
        getCollectionByPath: (path: string) => collections.find(c => c.slug === path),
        getCollections: () => collections,
        getTable: () => ({}),
        getGlobalCallbacks: () => (globalAfterRead ? { afterRead: mask } : undefined)
    };
    return stub as unknown as PostgresCollectionRegistry;
}

const stubDb = {} as unknown as NodePgDatabase;
const stubRealtime = {} as unknown as RealtimeService;

const COUNT = [{ fn: "count" as const, alias: "count" }];
const SUM = [{ fn: "sum" as const, field: "salary", alias: "sum_salary" }];

describe("aggregates on a collection an afterRead callback rewrites", () => {
    let underlying: jest.SpiedFunction<FetchService["aggregate"]>;

    beforeEach(() => {
        underlying = jest.spyOn(FetchService.prototype, "aggregate").mockResolvedValue([{ count: 3 }]);
    });
    afterEach(() => underlying.mockRestore());

    const refusal = expect.objectContaining({
        code: "AGGREGATE_MASKED_BY_AFTER_READ",
        message: expect.stringContaining("Aggregates other than count are refused on a collection whose rows an afterRead callback rewrites")
    });

    it("refuses sum, min/max, a field count and groupBy on a collection-level afterRead", async () => {
        const fetch = new PostgresBackendDriver(stubDb, stubRealtime, registry()).restFetchService;
        for (const options of [
            { aggregates: SUM },
            { aggregates: [{ fn: "max" as const, field: "email", alias: "max_email" }] },
            { aggregates: [{ fn: "count" as const, field: "email", alias: "count_email" }] },
            { aggregates: COUNT, groupBy: ["email"] }
        ]) {
            await expect(fetch.aggregate!("customers", options)).rejects.toEqual(refusal);
        }
        expect(underlying).not.toHaveBeenCalled();
    });

    it("still serves a plain count there", async () => {
        const fetch = new PostgresBackendDriver(stubDb, stubRealtime, registry()).restFetchService;
        await expect(fetch.aggregate!("customers", { aggregates: COUNT })).resolves.toEqual([{ count: 3 }]);
        expect(underlying).toHaveBeenCalledTimes(1);
    });

    it("refuses on a property-level afterRead, with no exemption for the other fields", async () => {
        const fetch = new PostgresBackendDriver(stubDb, stubRealtime, registry()).restFetchService;
        await expect(fetch.aggregate!("staff", { aggregates: SUM })).rejects.toEqual(refusal);
    });

    it("refuses on every collection when a global afterRead is registered", async () => {
        const fetch = new PostgresBackendDriver(stubDb, stubRealtime, registry(true)).restFetchService;
        await expect(fetch.aggregate!("orders", {
            aggregates: [{ fn: "sum", field: "total", alias: "sum_total" }], groupBy: ["status"]
        })).rejects.toEqual(refusal);
    });

    it("aggregates a collection without afterRead as before", async () => {
        const fetch = new PostgresBackendDriver(stubDb, stubRealtime, registry()).restFetchService;
        const options = { aggregates: [{ fn: "sum" as const, field: "total", alias: "sum_total" }], groupBy: ["status"] };
        await expect(fetch.aggregate!("orders", options)).resolves.toEqual([{ count: 3 }]);
        expect(underlying).toHaveBeenCalledWith("orders", options);
    });

    it("is an ApiError, so REST and MCP hand it to the caller as a 400", async () => {
        const fetch = new PostgresBackendDriver(stubDb, stubRealtime, registry()).restFetchService;
        const error = await fetch.aggregate!("customers", { aggregates: SUM }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).statusCode).toBe(400);
    });

    it("refuses through the request-scoped driver, inside its transaction", async () => {
        const delegate = new PostgresBackendDriver(stubDb, stubRealtime, registry());
        const scoped = new AuthenticatedPostgresBackendDriver(delegate, { uid: "u1", roles: ["admin"] } as User);
        // The transaction itself is not under test: run the work on the base driver.
        jest.spyOn(scoped, "withTransaction").mockImplementation((work) => work(delegate));
        await expect(scoped.restFetchService.aggregate!("customers", { aggregates: SUM })).rejects.toEqual(refusal);
    });

    it("refuses through the in-process SDK (`context.data`)", async () => {
        const driver = new PostgresBackendDriver(stubDb, stubRealtime, registry());
        const accessor = driver.data.collection("customers");
        await expect(accessor.aggregate({ select: [{ fn: "sum", field: "salary" }] })).rejects.toEqual(refusal);
        await expect(accessor.aggregate({ select: [{ fn: "count" }], groupBy: ["email"] })).rejects.toEqual(refusal);
        await expect(accessor.aggregate({ select: [{ fn: "count" }] })).resolves.toEqual([{ count: 3 }]);
    });
});
