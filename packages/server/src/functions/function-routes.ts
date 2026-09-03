import { Hono } from "hono";
import { HonoEnv } from "../api/types";
import { LoadedFunction } from "./function-loader";
import { requireAuth } from "./guards";

/**
 * Mount all loaded function routes under a single Hono router.
 *
 * Each function is mounted at `/<function-name>`, preserving
 * whatever HTTP methods and middleware the Hono sub-app defines.
 *
 * @param functions What loaded. May be empty — the router still mounts, so
 *   "no functions are served" answers 200 with an empty list instead of 404.
 * @param skipped How many files the loader saw and could not serve. Reported
 *   as a count and a pointer to the log, not as filenames: the per-file
 *   reasons carry import errors, and the listing is one guard away from anyone.
 */
export function createFunctionRoutes(
    functions: LoadedFunction[],
    skipped = 0,
    /**
     * Where this router is mounted, so the listing can report a path a caller
     * can actually request. It used to hardcode `/functions/<name>`, which is
     * wrong under every `basePath` including the default `/api`.
     */
    mountPath = "/functions"
): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();

    // Listing endpoint: GET / → list available functions.
    //
    // Functions themselves stay anonymous-callable by default — a webhook
    // receiver has to be — but the index of them does not: it is an inventory
    // of every custom endpoint, for whoever asks. `requireAuth` admits any
    // resolved identity (a signed-in user, an API key, the service key), so
    // `rebase doctor` and `rebase cloud debug` keep their answer; the latter
    // already reads a 401 here as "mounted".
    router.get("/", requireAuth, (c) => {
        return c.json({
            functions: functions.map((fn) => ({
                name: fn.name,
                endpoint: `${mountPath}/${fn.name}`
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
