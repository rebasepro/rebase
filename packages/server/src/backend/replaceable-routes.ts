import { Hono, type MiddlewareHandler } from "hono";

import { errorHandler } from "../api/errors";
import type { HonoEnv } from "../api/types";

/**
 * Routes that can be replaced after the router holding them was built.
 *
 * Hono fixes a router's routes once it has matched a request, so the REST
 * routes generated at boot — one set per table, each holding its table — stay
 * what they were for the life of the process. Live schema editing changes the
 * tables a running server serves (`/api/admin/schema/apply`), and the data
 * API must serve the change without a restart.
 *
 * So the data group carries this middleware ahead of the boot-time routes.
 * Until {@link ReplaceableRoutes.replace} is called it passes every request on
 * to them, and the data API behaves exactly as it always has. Once replaced,
 * it answers every request the boot-time routes would have, from the new
 * routes: they are mounted, at the path the group itself is mounted at, in a
 * router of their own, which is handed the request with everything the
 * group's middleware already established about it (the caller, the scoped
 * driver, the mount path) — the same request the boot-time routes would have
 * seen.
 *
 * @group Schema
 */
export interface ReplaceableRoutes {
    /** Registered on the group before the routes it replaces. */
    middleware: MiddlewareHandler<HonoEnv>;
    /** Serve these routes from now on. */
    replace(routes: Hono<HonoEnv>): void;
}

/** See {@link ReplaceableRoutes}. */
export function replaceableRoutes(): ReplaceableRoutes {
    let current: Hono<HonoEnv> | undefined;
    /** One router per mount path, built on first use for each. */
    let byMountPath = new Map<string, Hono<HonoEnv>>();
    /** What the group established about a request, for the router that answers it. */
    const established = new WeakMap<Request, Record<string, unknown>>();

    const routerFor = (routes: Hono<HonoEnv>, mountPath: string): Hono<HonoEnv> => {
        const router = new Hono<HonoEnv>();
        router.onError(errorHandler);
        router.use("/*", async (c, next) => {
            const variables = established.get(c.req.raw) ?? {};
            // `set` is typed by the variables a handler declares; these are the
            // group's own, set by its middleware, carried over by name.
            for (const key of Object.keys(variables)) Reflect.apply(c.set, c, [key, variables[key]]);
            await next();
        });
        router.route(mountPath || "/", routes);
        return router;
    };

    return {
        middleware: async (c, next) => {
            const routes = current;
            if (!routes) return next();
            const mountPath = c.get("mountPath") ?? "";
            let router = byMountPath.get(mountPath);
            if (!router) {
                router = routerFor(routes, mountPath);
                byMountPath.set(mountPath, router);
            }
            established.set(c.req.raw, { ...c.var });
            return router.fetch(c.req.raw);
        },
        replace(routes) {
            current = routes;
            byMountPath = new Map();
        }
    };
}
