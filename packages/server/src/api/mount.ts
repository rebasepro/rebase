/**
 * Mounting a surface at its canonical path, and at the path it used to have.
 *
 * Several admin-only surfaces grew up at the top level — `/api/cron`,
 * `/api/logs`, `/api/schema-editor` — while the ones added later went under
 * `/api/admin`. Nothing was wrong with either choice on its own; what was wrong
 * was having both, because the shape of the path stopped predicting whether a
 * caller needed to be an admin. `docs/api-conventions.md` states the rule the
 * repo now follows and this module is how existing callers survive it.
 *
 * ## Why an alias rather than a redirect
 *
 * A 308 would be correct and would break things anyway: `fetch` follows
 * redirects but drops an `Authorization` header on a cross-origin hop, and a
 * good deal of client code posts to these paths with one attached. An alias
 * serves the same handler at both paths, so nothing observable changes for a
 * caller that has not moved yet.
 *
 * The alias is not silent. Every response through it carries `Deprecation` and
 * a `Link` naming the successor, which is what makes the old path removable
 * later: an operator can find the callers in their own logs rather than
 * discovering them when the path is gone.
 */
import { Hono } from "hono";
import type { HonoEnv } from "./types";
import { logger } from "../utils/logger";

export interface MountOptions {
    /** Where the surface lives now. */
    canonical: string;
    /** Where it used to live, when it has moved. */
    legacy?: string;
    /** For the boot log — "Cron", "Logs". */
    surface: string;
}

/**
 * Mount `router` at its canonical path, and at its legacy path when it has one.
 *
 * The same router instance serves both, so the two paths cannot drift: there is
 * one set of handlers and one gate, and an alias that forgot to apply the admin
 * gate is not a state this can reach.
 */
export function mountWithLegacyAlias(
    app: Hono<HonoEnv>,
    router: Hono<HonoEnv>,
    options: MountOptions
): void {
    app.route(options.canonical, router);

    if (!options.legacy) {
        logger.debug(`${options.surface} routes mounted`, { path: options.canonical });
        return;
    }

    const alias = new Hono<HonoEnv>();
    // Before `route`, not after. Hono collects matching handlers in
    // registration order, so a `use("/*")` appended to an already-populated
    // router runs after the handler it was meant to wrap — which is to say
    // never, because the handler has already answered.
    alias.use("/*", async (c, next) => {
        await next();
        c.header("Deprecation", "true");
        c.header("Link", `<${options.canonical}>; rel="successor-version"`);
    });
    alias.route("/", router);
    app.route(options.legacy, alias);

    logger.debug(`${options.surface} routes mounted`, {
        path: options.canonical,
        deprecatedAlias: options.legacy
    });
}
