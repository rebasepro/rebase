import { Hono } from "hono";
import { defineFunction } from "../src/functions/define-function";
import { createFunctionRoutes } from "../src/functions/function-routes";
import { createAuthMiddleware, requireAuth, requireAdmin } from "../src/auth/middleware";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import type { HonoEnv } from "../src/api/types";
import type { DataDriver } from "@rebasepro/types";

describe("defineFunction", () => {
    it("returns a loader-compatible Hono app (has .fetch and .routes)", () => {
        const app = defineFunction((a) => {
            a.get("/ping", (c) => c.text("pong"));
        });

        // These are exactly the properties the loader duck-types on.
        expect(typeof app.fetch).toBe("function");
        expect(Array.isArray(app.routes)).toBe(true);
    });

    it("registers routes on the provided app", async () => {
        const app = defineFunction((a) => {
            a.get("/hello", (c) => c.text("hi"));
        });

        const res = await app.request("/hello");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("hi");
    });

    it("exposes the rebase singleton via the injected context", () => {
        let received: unknown;
        defineFunction((_a, ctx) => {
            received = ctx.rebase;
        });
        // The singleton reference is passed without being dereferenced,
        // so no "not initialized" error is thrown at define time.
        expect(received).toBeDefined();
    });

    it("uses a returned Hono app when the definition returns one", async () => {
        const custom = new Hono();
        custom.get("/custom", (c) => c.text("custom"));

        const app = defineFunction(() => custom);

        const res = await app.request("/custom");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("custom");
    });
});

/**
 * The scaffolded example function (`backend/functions/hello.ts`) guards its
 * routes with `requireAuth` / `requireAdmin` in the per-route middleware slot.
 * A guard that composes but does not *enforce* would be worse than no example
 * at all — it would teach the shape while shipping the hole — so this
 * reproduces the real mount and checks the status codes.
 *
 * The mount matters: `init.ts` puts `createAuthMiddleware({ requireAuth:
 * false })` in front of the whole functions router (so webhook receivers can
 * stay token-less) and then routes each function in. Anything the route-level
 * guards do, they do downstream of that permissive middleware.
 */
describe("defineFunction: route guards under the real functions mount", () => {
    const SECRET = "test-secret-key-for-define-function-guards-1234567890";

    const mockDriver: DataDriver = {
        fetchCollection: (() => {}) as any,
        fetchOne: (() => {}) as any,
        save: (() => {}) as any,
        delete: (() => {}) as any
    };

    beforeAll(() => {
        configureJwt({ secret: SECRET,
accessExpiresIn: "1h" });
    });

    /** The three tiers the template demonstrates, mounted the way init.ts mounts them. */
    function mount() {
        const fn = defineFunction((app) => {
            app.get("/", (c) => c.json({ status: "ok" }));
            app.post("/", requireAuth, (c) => c.json({ user: (c.get("user") as any)?.uid }));
            app.get("/stats", requireAuth, requireAdmin, (c) => c.json({ admin: (c.get("user") as any)?.uid }));
        });

        const router = new Hono<HonoEnv>();
        router.use("/*", createAuthMiddleware({ driver: mockDriver,
requireAuth: false }));
        router.route("/", createFunctionRoutes([{ name: "hello",
app: fn } as any]));
        return router;
    }

    const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

    it("leaves the deliberately public route open to anonymous callers", async () => {
        const res = await mount().request("/hello");
        expect(res.status).toBe(200);
    });

    it("401s the requireAuth route when nobody is signed in", async () => {
        const res = await mount().request("/hello", { method: "POST" });
        expect(res.status).toBe(401);
    });

    it("401s the requireAuth route on a forged token", async () => {
        const res = await mount().request("/hello", { method: "POST",
headers: bearer("not.a.token") });
        expect(res.status).toBe(401);
    });

    it("lets a signed-in caller through to the requireAuth route", async () => {
        const token = await generateAccessToken("user-1", []);
        const res = await mount().request("/hello", { method: "POST",
headers: bearer(token) });
        expect(res.status).toBe(200);
        expect((await res.json() as any).user).toBe("user-1");
    });

    it("401s the admin route anonymously and 403s a signed-in non-admin", async () => {
        expect((await mount().request("/hello/stats")).status).toBe(401);

        const token = await generateAccessToken("user-1", ["editor"]);
        const res = await mount().request("/hello/stats", { headers: bearer(token) });
        expect(res.status).toBe(403);
    });

    it("lets an admin through the admin route", async () => {
        const token = await generateAccessToken("admin-1", ["admin"]);
        const res = await mount().request("/hello/stats", { headers: bearer(token) });
        expect(res.status).toBe(200);
        expect((await res.json() as any).admin).toBe("admin-1");
    });
});
