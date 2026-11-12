import { describe, it, expect, beforeAll } from "@jest/globals";
import { Hono, Context } from "hono";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { createAuthMiddleware } from "../src/auth/middleware";
import { createAdapterAuthMiddleware } from "../src/auth/adapter-middleware";
import type { HonoEnv } from "../src/api/types";
import type { DataDriver } from "@rebasepro/types";
import { fakeDataDriver } from "./helpers/server-b-fakes";
import { fakeAuthAdapter } from "./helpers/server-b-g1-auth-adapter";

const TEST_SECRET = "test-secret-key-for-multi-datasource-routing-1234567890";

// A mock driver that tags itself so we can assert which one was scoped into
// the request context. The Postgres databases implement withAuth (RLS); a
// custom driver without it is passed through (scopeDataDriver must no-op).
function mockDriver(key: string, withRls: boolean): DataDriver {
    const base = fakeDataDriver({ key, save: async () => ({ id: "x", path: key, values: {} }) });
    if (!withRls) return base;
    // Returns a scoped clone that keeps the same key tag. `withAuth` is what
    // the middleware scopes by; `DataDriver` does not declare it.
    const scoped: DataDriver & { withAuth(): Promise<DataDriver> } = { ...base, withAuth: async () => ({ ...base }) };
    return scoped;
}

describe("Multi-data-source request routing (middleware)", () => {

    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET, accessExpiresIn: "1h" });
    });

    const pg = mockDriver("postgres", true);
    // A second Postgres database — `database("analytics")` beside the default.
    const analytics = mockDriver("analytics", true);
    const custom = mockDriver("custom", false);

    // Route by first path segment: /products → pg, /events → analytics.
    const resolveDriver = (c: Context<HonoEnv>): DataDriver => {
        const slug = c.req.path.replace(/^\/+/, "").split("/")[0];
        return slug === "events" ? analytics : pg;
    };

    function createApp() {
        const app = new Hono<HonoEnv>();
        app.use("/*", createAuthMiddleware({ driver: pg, resolveDriver, requireAuth: false }));
        app.get("/:slug", (c: Context<HonoEnv>) => {
            const driver = c.get("driver") as DataDriver | undefined;
            return c.json({ key: driver?.key });
        });
        return app;
    }

    it("scopes the default delegate for a collection on the default database", async () => {
        const token = await generateAccessToken("u1", ["admin"]);
        const res = await createApp().request("/products", { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json() as { key: string };
        expect(body.key).toBe("postgres");
    });

    it("scopes the analytics delegate for a collection routed to it", async () => {
        const token = await generateAccessToken("u1", ["admin"]);
        const res = await createApp().request("/events", { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json() as { key: string };
        expect(body.key).toBe("analytics");
    });

    it("routes per request based on the resolver, not a fixed driver", async () => {
        const token = await generateAccessToken("u1", ["admin"]);
        const app = createApp();
        const a = await (await app.request("/events", { headers: { Authorization: `Bearer ${token}` } })).json() as { key: string };
        const b = await (await app.request("/products", { headers: { Authorization: `Bearer ${token}` } })).json() as { key: string };
        expect(a.key).toBe("analytics");
        expect(b.key).toBe("postgres");
    });

    it("falls back to the base driver when no resolver is provided", async () => {
        const app = new Hono<HonoEnv>();
        app.use("/*", createAuthMiddleware({ driver: custom, requireAuth: false }));
        app.get("/:slug", (c: Context<HonoEnv>) => c.json({ key: (c.get("driver") as DataDriver | undefined)?.key }));
        const res = await app.request("/anything");
        const body = await res.json() as { key: string };
        expect(body.key).toBe("custom");
    });

    it("routes a nested/subcollection path by its top-level segment", async () => {
        const token = await generateAccessToken("u1", ["admin"]);
        const app = new Hono<HonoEnv>();
        app.use("/*", createAuthMiddleware({ driver: pg, resolveDriver, requireAuth: false }));
        app.get("/events/:id/attendees", (c: Context<HonoEnv>) =>
            c.json({ key: (c.get("driver") as DataDriver | undefined)?.key }));
        const res = await app.request("/events/e1/attendees", { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json() as { key: string };
        expect(body.key).toBe("analytics");
    });

    it("routes per request through the adapter auth middleware too", async () => {
        const adapter = fakeAuthAdapter({
            id: "test-adapter",
            serviceKey: undefined,
            verifyRequest: async () => ({ uid: "u1", email: "", roles: ["admin"], isAdmin: false })
        });

        const app = new Hono<HonoEnv>();
        app.use("/*", createAdapterAuthMiddleware({ adapter, driver: pg, resolveDriver, requireAuth: false }));
        app.get("/:slug", (c: Context<HonoEnv>) => c.json({ key: (c.get("driver") as DataDriver | undefined)?.key }));

        const a = await (await app.request("/events")).json() as { key: string };
        const b = await (await app.request("/products")).json() as { key: string };
        expect(a.key).toBe("analytics");
        expect(b.key).toBe("postgres");
    });
});
