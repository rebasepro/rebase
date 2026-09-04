import { Hono } from "hono";
import type { MountableRouter } from "../src/types/auth_adapter";

/**
 * `MountableRouter` is what `AuthAdapter.createAuthRoutes()` and
 * `createAdminRoutes()` return. It used to be `Hono<any, any, any>`, and that
 * single `import type { Hono } from "hono"` was the whole reason
 * `@rebasepro/types` peer-depended on hono.
 *
 * npm ≥7 and pnpm ≥8 auto-install peers, so **every browser app that installed
 * `@rebasepro/client` got a 2.8 MB server framework** in its `node_modules`,
 * its lockfile and its security scanners — for a type used by two optional
 * methods a browser can never call. Removing the peer without loosening the
 * type was not an option either: the peer was load-bearing for typechecking,
 * and an app that merely named `User` failed with TS2307 when hono was absent.
 *
 * So the type became structural. A structural type is only worth having if
 * something proves the real thing still satisfies it, and that is this file —
 * the one place in the package that deliberately imports hono, as a
 * devDependency.
 *
 * If this stops compiling, hono changed the shape of its app and
 * `MountableRouter` has to follow.
 */
describe("MountableRouter", () => {
    it("is satisfied by a real Hono app", () => {
        const app = new Hono();
        app.get("/health", (c) => c.json({ ok: true }));

        // The assertion is the assignment: it is a compile-time check that a
        // real Hono app fits the structural contract.
        const mountable: MountableRouter = app;

        expect(typeof mountable.fetch).toBe("function");
        expect(Array.isArray(mountable.routes)).toBe(true);
        expect(mountable.routes.length).toBeGreaterThan(0);
    });

    it("is satisfied by a router that is not Hono at all", () => {
        // The point of the structural type: an adapter may bring its own
        // router, as long as it can answer a request and describe its routes.
        const handRolled: MountableRouter = {
            fetch: (request: Request) => new Response(`ok: ${new URL(request.url).pathname}`),
            routes: [{ method: "GET", path: "/" }]
        };
        expect(handRolled.fetch(new Request("https://example.test/x"))).toBeInstanceOf(Response);
    });

    it("answers a real request through the mounted shape", async () => {
        const app = new Hono();
        app.get("/health", (c) => c.json({ ok: true }));
        const mountable: MountableRouter = app;

        const res = await mountable.fetch(new Request("https://example.test/health"));
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ ok: true });
    });
});
