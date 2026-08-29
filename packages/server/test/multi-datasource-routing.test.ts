import { describe, it, expect, beforeAll } from "@jest/globals";
import { Hono, Context } from "hono";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { createAuthMiddleware } from "../src/auth/middleware";
import { createAdapterAuthMiddleware } from "../src/auth/adapter-middleware";
import type { HonoEnv } from "../src/api/types";
import type { DataDriver, AuthAdapter } from "@rebasepro/types";

const TEST_SECRET = "test-secret-key-for-multi-datasource-routing-1234567890";

// A mock driver that tags itself so we can assert which one was scoped into
// the request context. The Postgres-like one implements withAuth (RLS), the
// Mongo-like one does not (scopeDataDriver must no-op for it).
function mockDriver(key: string, withRls: boolean): DataDriver {
    const base: Record<string, unknown> = {
        key,
        fetchCollection: async () => [],
        fetchOne: async () => undefined,
        save: async () => ({ id: "x", path: key, values: {} }),
        delete: async () => undefined
    };
    if (withRls) {
        // Returns a scoped clone that keeps the same key tag.
        base.withAuth = async () => ({ ...base, scoped: true });
    }
    return base as unknown as DataDriver;
}

describe("Multi-data-source request routing (middleware)", () => {

    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET, accessExpiresIn: "1h" });
    });

    const pg = mockDriver("postgres", true);
    const mongo = mockDriver("mongodb", false);

    // Route by first path segment: /products → pg, /events → mongo.
    const resolveDriver = (c: Context<HonoEnv>): DataDriver => {
        const slug = c.req.path.replace(/^\/+/, "").split("/")[0];
        return slug === "events" ? mongo : pg;
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

    it("scopes the Postgres delegate for a Postgres collection path", async () => {
        const token = await generateAccessToken("u1", ["admin"]);
        const res = await createApp().request("/products", { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json() as { key: string };
        expect(body.key).toBe("postgres");
    });

    it("scopes the Mongo delegate for a Mongo collection path", async () => {
        const token = await generateAccessToken("u1", ["admin"]);
        const res = await createApp().request("/events", { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json() as { key: string };
        expect(body.key).toBe("mongodb");
    });

    it("routes per request based on the resolver, not a fixed driver", async () => {
        const token = await generateAccessToken("u1", ["admin"]);
        const app = createApp();
        const a = await (await app.request("/events", { headers: { Authorization: `Bearer ${token}` } })).json() as { key: string };
        const b = await (await app.request("/products", { headers: { Authorization: `Bearer ${token}` } })).json() as { key: string };
        expect(a.key).toBe("mongodb");
        expect(b.key).toBe("postgres");
    });

    it("falls back to the base driver when no resolver is provided", async () => {
        const app = new Hono<HonoEnv>();
        app.use("/*", createAuthMiddleware({ driver: mongo, requireAuth: false }));
        app.get("/:slug", (c: Context<HonoEnv>) => c.json({ key: (c.get("driver") as DataDriver | undefined)?.key }));
        const res = await app.request("/anything");
        const body = await res.json() as { key: string };
        expect(body.key).toBe("mongodb");
    });

    it("routes a nested/subcollection path by its top-level segment", async () => {
        const token = await generateAccessToken("u1", ["admin"]);
        const app = new Hono<HonoEnv>();
        app.use("/*", createAuthMiddleware({ driver: pg, resolveDriver, requireAuth: false }));
        app.get("/events/:id/attendees", (c: Context<HonoEnv>) =>
            c.json({ key: (c.get("driver") as DataDriver | undefined)?.key }));
        const res = await app.request("/events/e1/attendees", { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json() as { key: string };
        expect(body.key).toBe("mongodb");
    });

    it("routes per request through the adapter auth middleware too", async () => {
        const adapter: AuthAdapter = {
            id: "test-adapter",
            serviceKey: undefined,
            verifyRequest: async () => ({ uid: "u1", roles: ["admin"] })
        } as unknown as AuthAdapter;

        const app = new Hono<HonoEnv>();
        app.use("/*", createAdapterAuthMiddleware({ adapter, driver: pg, resolveDriver, requireAuth: false }));
        app.get("/:slug", (c: Context<HonoEnv>) => c.json({ key: (c.get("driver") as DataDriver | undefined)?.key }));

        const a = await (await app.request("/events")).json() as { key: string };
        const b = await (await app.request("/products")).json() as { key: string };
        expect(a.key).toBe("mongodb");
        expect(b.key).toBe("postgres");
    });
});
