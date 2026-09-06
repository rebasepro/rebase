import { Hono } from "hono";

import type { HonoEnv } from "./types";
import { ApiError, errorHandler } from "./errors";
import { logger } from "../utils/logger";

/**
 * Give the root app the JSON error envelope, unless it already has one.
 *
 * `errorHandler` was installed on the data router and the functions router and
 * nowhere else, so anything thrown outside those two — an app-level middleware,
 * an auth route, a storage route, a custom route a project mounted itself — fell
 * through to Hono's default: `500` with the body `Internal Server Error`, as
 * `text/plain`. A client that parses `error.code` got a JSON parse failure
 * instead of a code, which is the one shape no caller handles.
 *
 * The check is deliberate rather than an unconditional `onError`. An
 * application that passes its own `config.app` may have installed a handler of
 * its own, and overwriting it would silently replace the project's error
 * contract with ours — a much worse failure than the one this fixes, because it
 * would look like the framework working.
 *
 * Identity against a fresh `Hono` is what distinguishes the two: Hono's default
 * handler is one module-level function shared by every instance, so an app that
 * has never been given a handler compares equal to a brand-new one, and an app
 * that has compares unequal. It reads a private field, which is why it is here,
 * behind a name, with a test that fails if Hono ever stops working this way.
 */
export function installRootErrorHandler(app: Hono<HonoEnv>): boolean {
    if (hasOwnErrorHandler(app)) {
        logger.debug("Root app already has an error handler — leaving it alone.");
        return false;
    }
    app.onError(errorHandler);
    return true;
}

/**
 * And the same envelope for a path under `basePath` that matched nothing.
 *
 * `onError` was only ever half of it. A request that matches no route is not a
 * thrown error — Hono answers it from its not-found handler, which `onError`
 * never sees — so every unmatched path under `/api` came back as `404 Not
 * Found`, `text/plain`. `backend/errors.md` opens by promising that *every*
 * failure uses one envelope and carries a stable `code`, and
 * `troubleshooting.md` says it again; a client parsing `error.code` got a JSON
 * parse failure instead, which is the one shape no caller handles. Through the
 * SDK it arrived as `RebaseApiError { code: undefined }`, so `e.code ===
 * "NOT_FOUND"` never matched.
 *
 * Written as middleware that inspects the answer, rather than as `app.notFound`
 * or as a catch-all route, because both of those are wrong here:
 *
 * - `app.notFound` would *replace* the handler of an application that passes its
 *   own `config.app`. Hono keeps that handler in a `#private` field, so — unlike
 *   the error handler, which is readable and therefore respected — there is no
 *   way to tell an app that has one from an app that has the default.
 * - A catch-all route depends on being registered after every real route, and
 *   `boot.ts` registers `/api/health` *after* `initializeRebaseBackend` returns.
 *   A catch-all would have swallowed the health probe.
 *
 * Post-processing has neither problem: it converts a 404 that came back as
 * anything but JSON, and leaves the ones that are already an envelope — a
 * storage miss, an unknown collection, an unknown function — exactly as their
 * route wrote them. Scoped to `basePath`, so an app serving its own pages at `/`
 * keeps answering its own way for the pages.
 *
 * `expected`, so it logs at debug. A 404 from a frontend holding a stale link is
 * routine, and a `⚠️` per request would trade a missing envelope for noise
 * nobody can act on.
 */
export function installUnmatchedApiEnvelope(app: Hono<HonoEnv>, basePath: string): void {
    const prefix = basePath.replace(/\/$/, "");
    app.use(`${prefix}/*`, async (c, next) => {
        await next();

        if (c.res.status !== 404) return;
        if ((c.res.headers.get("content-type") ?? "").includes("application/json")) return;

        // Assignment, not a fresh return: Hono's `c.res` setter copies the
        // headers of the response being replaced onto the new one, so the
        // `X-Request-ID` the request-ID middleware just wrote survives.
        c.res = errorHandler(
            new ApiError(
                404,
                "NOT_FOUND",
                `No route for ${c.req.method} ${c.req.path} on this backend.`,
                undefined,
                true
            ),
            c
        ) as Response;
    });
    logger.debug("Unmatched API routes answer the JSON envelope", { prefix });
}

/** Whether `onError` has been called on this app. */
export function hasOwnErrorHandler(app: Hono<never> | Hono<HonoEnv>): boolean {
    const current = (app as unknown as { errorHandler?: unknown }).errorHandler;
    // No such field at all: a Hono version that keeps it somewhere else. Assume
    // the app has its own rather than clobbering one we cannot see.
    if (typeof current !== "function") return true;
    return current !== defaultErrorHandler();
}

/** Hono's own default, read once off an app nobody has configured. */
let cachedDefault: unknown;
function defaultErrorHandler(): unknown {
    if (cachedDefault === undefined) {
        cachedDefault = (new Hono() as unknown as { errorHandler?: unknown }).errorHandler;
    }
    return cachedDefault;
}
