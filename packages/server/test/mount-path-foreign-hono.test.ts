import { Hono } from "hono";
import { recordMountPath } from "../src/api/mount-path";
import type { HonoEnv } from "../src/api/types";

/**
 * A self-hosted app often builds its own Hono app and mounts Rebase's routers
 * into it, and its `hono` need not be the same physical copy as the one the
 * server resolves (a linked checkout, an install pnpm could not dedupe). Hono's
 * `routePath(c)` helper reads the match result under a `Symbol()` private to its
 * copy, so on a request built by the host's copy it found nothing and every
 * request through a group threw — `Cannot read properties of undefined
 * (reading '0')` — before any handler ran.
 */

/** `Hono` from a second, independent copy of the module, as a host app would have it. */
function foreignHono(): typeof Hono {
    let Foreign: typeof Hono | undefined;
    jest.isolateModules(() => {
        Foreign = require("hono").Hono;
    });
    if (!Foreign || Foreign === Hono) throw new Error("expected a second copy of hono");
    return Foreign;
}

function group(): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.use("/*", recordMountPath());
    router.get("/:slug", (c) => c.text(c.get("mountPath") ?? "(not recorded)"));
    return router;
}

describe("recordMountPath", () => {
    it("reads the mount from a host app on the same copy of hono", async () => {
        const host = new Hono();
        host.route("/api/data", group());
        const res = await host.request("/api/data/talents");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("/api/data");
    });

    it("reads the mount from a host app on another copy of hono", async () => {
        const Foreign = foreignHono();
        const host = new Foreign();
        host.route("/api/data", group());
        const res = await host.request("/api/data/talents");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("/api/data");
    });

    it("resolves a parameterised mount on another copy of hono", async () => {
        const Foreign = foreignHono();
        const host = new Foreign();
        host.route("/:tenant/data", group());
        const res = await host.request("/acme/data/talents");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("/acme/data");
    });
});
