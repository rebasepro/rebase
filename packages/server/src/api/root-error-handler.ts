import { Hono } from "hono";

import type { HonoEnv } from "./types";
import { errorHandler } from "./errors";
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
