import { describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";

import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";

/**
 * The data routes say which collection the request is about.
 *
 * The request log carries it. "A 403 on /api/data/orders" and "a 403" are
 * different amounts of help at 3am, and the raw path does not survive being
 * aggregated by route — every id becomes a distinct series.
 *
 * Recorded by a middleware rather than in each handler, because the requests
 * whose log line is worth reading are exactly the ones that throw *before* a
 * handler body runs: an API-key permission check, a query parser refusing an
 * operator. And validated against the collections this backend serves, so the
 * field is a real slug rather than whatever a caller typed into the URL.
 */
const orders = {
    slug: "orders",
    name: "Orders",
    table: "orders",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
} as unknown as CollectionConfig;

function mount(): { app: Hono<HonoEnv>; seen: () => string | undefined } {
    let seen: string | undefined;

    const driver = {
        fetchCollection: jest.fn<never>(),
        fetchOne: jest.fn<never>(),
        save: jest.fn<never>(),
        delete: jest.fn<never>(),
        count: jest.fn<never>(),
        restFetchService: {
            fetchCollectionForRest: jest.fn<any>().mockResolvedValue({ rows: [], total: 0 }),
            fetchOneForRest: jest.fn<any>().mockResolvedValue(null)
        }
    } as unknown as DataDriver;

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        await next();
        // Read after the routes have run, which is where the request logger
        // reads it.
        seen = c.get("collection");
    });
    // Mounted under a prefix on purpose: inside a sub-app `c.req.path` is still
    // the FULL path, so a naive first-segment split would answer "api".
    app.route("/api/data", new RestApiGenerator([orders], driver).generateRoutes());

    return { app, seen: () => seen };
}

describe("the REST router names the collection", () => {
    it("records it for a list request", async () => {
        const { app, seen } = mount();
        await app.request("/api/data/orders");
        expect(seen()).toBe("orders");
    });

    it("records it for a nested path", async () => {
        const { app, seen } = mount();
        await app.request("/api/data/orders/abc");
        expect(seen()).toBe("orders");
    });

    it("leaves it unset for a slug this backend does not serve", async () => {
        // The value is for a log line, and a log field echoing arbitrary caller
        // input is a field nobody can group by.
        const { app, seen } = mount();
        const res = await app.request("/api/data/not-a-collection");
        expect(res.status).toBe(404);
        expect(seen()).toBeUndefined();
    });
});
