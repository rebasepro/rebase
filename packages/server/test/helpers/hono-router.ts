import { Hono } from "hono";
import type { MountableRouter } from "@rebasepro/types";
import type { HonoEnv } from "../../src/api/types";

/**
 * An auth adapter's router, as the Hono app `app.route()` mounts.
 *
 * `AuthAdapter.createAuthRoutes()` / `createAdminRoutes()` return the
 * structural `MountableRouter` (so `@rebasepro/types` needs no hono
 * dependency), and both methods are optional; the built-in adapter's are real
 * `Hono` apps. The backend narrows them once when it mounts them; a test that
 * mounts them by hand narrows them here, and fails loudly if the adapter
 * returned nothing or something else.
 */
export function honoRouter(router: MountableRouter | undefined): Hono<HonoEnv> {
    if (!(router instanceof Hono)) {
        throw new Error("expected the adapter's routes to be a Hono app");
    }
    return router;
}
