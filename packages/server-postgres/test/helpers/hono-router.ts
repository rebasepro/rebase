import { Hono } from "hono";
import type { MountableRouter } from "@rebasepro/types";
import type { HonoEnv } from "@rebasepro/server";

/**
 * An auth adapter's router, as the Hono app `app.route()` mounts.
 *
 * `AuthAdapter.createAuthRoutes()` returns the structural `MountableRouter`
 * (so `@rebasepro/types` needs no hono dependency); the built-in adapter's is
 * a real `Hono`. The backend narrows it once when it mounts it; a test that
 * mounts it by hand narrows it here, and fails loudly if the adapter returned
 * nothing or something else.
 */
export function honoRouter(router: MountableRouter | undefined): Hono<HonoEnv> {
    if (!(router instanceof Hono)) {
        throw new Error("expected the adapter's routes to be a Hono app");
    }
    return router;
}
