import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";

import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";

/**
 * A 404 on a row says which row, and names the other reason it can happen.
 *
 * "Entity not found" was the entire message on five routes. It does not say
 * which collection, which id, or — the part that costs the most time — that a
 * row can be present and invisible: authenticated requests run as a restricted
 * role, so a `SELECT` policy that excludes this caller produces exactly this
 * 404. Somebody checks whether the row exists, finds it in psql, concludes the
 * API is broken, and spends the afternoon in the wrong file.
 */
const orders = {
    slug: "orders",
    name: "Orders",
    table: "orders",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
} as unknown as CollectionConfig;

function app(): Hono<HonoEnv> {
    const driver = {
        fetchCollection: jest.fn<never>(),
        fetchOne: jest.fn<any>().mockResolvedValue(null),
        save: jest.fn<never>(),
        delete: jest.fn<never>(),
        count: jest.fn<never>(),
        restFetchService: {
            fetchCollectionForRest: jest.fn<any>().mockResolvedValue({ rows: [], total: 0 }),
            fetchOneForRest: jest.fn<any>().mockResolvedValue(null)
        }
    } as unknown as DataDriver;

    const hono = new Hono<HonoEnv>();
    hono.onError(errorHandler);
    hono.use("/*", async (c, next) => { c.set("driver", driver); await next(); });
    hono.route("/api/data", new RestApiGenerator([orders], driver).generateRoutes());
    return hono;
}

describe("a missing row", () => {
    const originalEnv = process.env.NODE_ENV;
    afterEach(() => { process.env.NODE_ENV = originalEnv; });

    it("names the collection, the id, and row-level security", async () => {
        const res = await app().request("/api/data/orders/abc-123");
        const body = await res.json() as { error: { message: string; details?: unknown } };

        expect(res.status).toBe(404);
        expect(body.error.message).toContain("abc-123");
        expect(body.error.message).toContain("orders");
        expect(body.error.message).toContain("row-level security");
    });

    it("carries the structured details outside production", async () => {
        process.env.NODE_ENV = "development";
        const res = await app().request("/api/data/orders/abc-123");
        const body = await res.json() as { error: { details?: { collection?: string; id?: string } } };

        expect(body.error.details).toEqual({ collection: "orders", id: "abc-123" });
    });

    it("withholds them in production, like the database diagnostics one layer up", async () => {
        process.env.NODE_ENV = "production";
        const res = await app().request("/api/data/orders/abc-123");
        const body = await res.json() as { error: { message: string; details?: unknown } };

        expect(body.error.details).toBeUndefined();
        // The sentence stays: both values are in the URL the caller just sent,
        // so naming them back reveals nothing they did not already know.
        expect(body.error.message).toContain("abc-123");
    });

    it("names the resolved path for a subcollection read", async () => {
        const res = await app().request("/api/data/orders/abc-123/lines/9");
        const body = await res.json() as { error: { message: string } };

        expect(res.status).toBe(404);
        expect(body.error.message).toContain("9");
    });
});
