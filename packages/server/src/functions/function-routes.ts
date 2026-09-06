import { Hono } from "hono";
import { HonoEnv } from "../api/types";
import { ApiError } from "../api/errors";
import { LoadedFunction } from "./function-loader";
import { requireAuth } from "./guards";

/** The file a loader problem names, without its extension: `broken.ts (threw: …)` → `broken`. */
function problemName(problem: string): string {
    return problem.split(" ")[0].replace(/\/$/, "").replace(/\.[cm]?[jt]s$/, "");
}

/**
 * Mount all loaded function routes under a single Hono router.
 *
 * Each function is mounted at `/<function-name>`, preserving
 * whatever HTTP methods and middleware the Hono sub-app defines.
 *
 * @param functions What loaded. May be empty — the router still mounts, so
 *   "no functions are served" answers 200 with an empty list instead of 404.
 * @param problems The files the loader saw and could not serve, as
 *   `"<file> (<reason>)"`. The listing reports a count and a pointer to the log,
 *   not the reasons: those carry import errors, and the listing is one guard
 *   away from anyone. The unmatched-route handler uses the *names* to answer the
 *   one question a 404 on a function nobody can find should answer — "there is a
 *   file for this and it did not load" — which is the difference between a typo
 *   and a broken deploy, and the loader was the only thing that knew.
 */
export function createFunctionRoutes(
    functions: LoadedFunction[],
    problems: string[] = [],
    /**
     * Where this router is mounted, so the listing can report a path a caller
     * can actually request. It used to hardcode `/functions/<name>`, which is
     * wrong under every `basePath` including the default `/api`.
     */
    mountPath = "/functions"
): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    const skipped = problems.length;

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

    // A name that matches nothing, answered in the envelope.
    //
    // Registered last so every real route wins it. Without it, a typo'd
    // function name — the single most likely 404 a developer meets on this
    // surface — fell through to Hono's default `404 Not Found` as `text/plain`,
    // and through the SDK arrived as `RebaseApiError { code: undefined }`, so
    // the documented `e.code === "FUNCTION_NOT_FOUND"` branch never ran.
    //
    // What the message may say depends on who is asking. The mounted names are
    // an inventory of every custom endpoint, which is exactly what the listing
    // above requires an identity to see — so an anonymous caller is told their
    // name is unknown and nothing more, and a resolved caller gets the list
    // that turns the 404 into a fix.
    const mounted = new Set(functions.map(fn => fn.name));
    const failedToLoad = new Map(problems.map(p => [problemName(p), p.split(" ")[0]]));

    router.all("/:name{.*}", (c): never => {
        const requested = (c.req.param("name") ?? "").split("/").filter(Boolean);
        const name = requested[0] ?? "";
        const rest = requested.slice(1).join("/");
        const identified = Boolean(c.get("user"));

        const refuse = (message: string): never => {
            throw new ApiError(404, "FUNCTION_NOT_FOUND", message, { function: name }, true);
        };

        if (!name) {
            refuse(`No function in the request path. Expected ${mountPath}/<function>.`);
        }
        if (mounted.has(name)) {
            refuse(
                `The function '${name}' is served, and has no ${c.req.method} route at '/${rest}'. ` +
                "The path after the function name is routed by the function's own Hono app."
            );
        }
        const file = failedToLoad.get(name);
        if (file) {
            refuse(
                `The function '${name}' is not served: '${file}' failed to load. ` +
                "The server log records why, at boot."
            );
        }
        return refuse(
            `No function named '${name}' on this backend.` +
            (identified
                ? (mounted.size > 0
                    ? ` This backend serves: ${[...mounted].sort().join(", ")}.`
                    : " This backend serves no functions.")
                : "") +
            (skipped > 0 && identified
                ? ` ${skipped} function file(s) failed to load and are not served — see the server log.`
                : "")
        );
    });

    return router;
}
