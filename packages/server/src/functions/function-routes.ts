import { Hono } from "hono";
import { HonoEnv } from "../api/types";
import { LoadedFunction } from "./function-loader";

/**
 * Mount all loaded function routes under a single Hono router.
 *
 * Each function is mounted at `/<function-name>`, preserving
 * whatever HTTP methods and middleware the Hono sub-app defines.
 *
 * @param functions What loaded. May be empty — the router still mounts, so
 *   "no functions are served" answers 200 with an empty list instead of 404.
 * @param skipped How many files the loader saw and could not serve. Reported
 *   as a count and a pointer to the log, not as filenames: the listing is
 *   reachable anonymously, and the per-file reasons carry import errors.
 */
export function createFunctionRoutes(
    functions: LoadedFunction[],
    skipped = 0
): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();

    // Listing endpoint: GET / → list available functions
    router.get("/", (c) => {
        return c.json({
            functions: functions.map((fn) => ({
                name: fn.name,
                endpoint: `/functions/${fn.name}`
            })),
            ...(skipped > 0 && {
                skipped,
                note: `${skipped} function file(s) failed to load and are NOT served — see the server log for the reason.`
            })
        });
    });

    for (const fn of functions) {
        router.route(`/${fn.name}`, fn.app);
    }

    return router;
}
