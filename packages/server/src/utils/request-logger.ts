/**
 * Structured HTTP request logging middleware for Hono.
 *
 * Logs every request with method, path, status code, latency, and
 * content-length. In production, outputs JSON for Cloud Logging, one INFO line
 * per request; in development, a one-liner for failures and slow requests only
 * (the rest at debug: `LOG_LEVEL=debug` shows them).
 *
 * @example
 * ```ts
 * import { requestLogger } from "@rebasepro/server";
 * app.use("/*", requestLogger());
 * ```
 */
import type { MiddlewareHandler } from "hono";
import type { HonoEnv } from "../api/types";
import { logger as log } from "./logger";
import { hostEnv } from "./host";

export interface RequestLoggerOptions {
    /** Paths to skip logging (e.g. "/health"). Supports exact match. */
    skip?: string[];
    /**
     * Outside production, a request answered below 400 is logged at debug
     * unless it took at least this long, in milliseconds. Default 1000.
     */
    slowRequestMs?: number;
}

/** The latency from which a successful development request is worth a line. */
const DEFAULT_SLOW_REQUEST_MS = 1000;

export function requestLogger(options?: RequestLoggerOptions): MiddlewareHandler<HonoEnv> {
    const skipPaths = new Set(options?.skip ?? ["/health", "/favicon.ico"]);
    const slowRequestMs = options?.slowRequestMs ?? DEFAULT_SLOW_REQUEST_MS;

    return async (c, next) => {
        const start = performance.now();
        const method = c.req.method;
        const path = c.req.path;

        // Skip noisy endpoints
        if (skipPaths.has(path)) {
            return next();
        }

        // Claimed before the handler runs, because the error handler runs
        // *during* it and needs to know whether a request line is coming. See
        // `HonoEnv.Variables.requestLogged`.
        c.set("requestLogged", true);

        await next();

        const latencyMs = Math.round(performance.now() - start);
        const status = c.res.status;
        const contentLength = c.res.headers.get("content-length");

        const data: Record<string, unknown> = {
            method,
            path,
            status,
            latencyMs
        };

        // Include request correlation ID if available
        const reqId = c.get("requestId");
        if (reqId) {
            data.requestId = reqId;
        }

        if (contentLength) {
            data.contentLength = parseInt(contentLength, 10);
        }

        // Extract the user id from context if auth middleware ran.
        //
        // This read `c.get("uid")` — a context key nothing has ever set, so
        // no request log has ever carried a user. The auth middlewares all set
        // `user`; the id lives on it.
        const uid = (c.get("user") as { uid?: string } | undefined)?.uid;
        if (uid) {
            data.uid = uid;
        }

        // An administrator's request run as another user is that user's
        // request in every respect but one: who sent it. Without this the line
        // would attribute it to the user alone.
        const impersonator = c.get("impersonator");
        if (impersonator) {
            data.impersonatedBy = impersonator.uid;
        }

        // Which collection, when the request was about one. "A 403 on
        // /api/data/orders" and "a 403" are different amounts of help at 3am,
        // and the path does not survive being aggregated by route.
        const collection = c.get("collection");
        if (collection) {
            data.collection = collection;
        }

        // What the error handler answered, so the failure is described once
        // rather than in two half-lines. The handler holds the code and the
        // message; this line holds the user, the collection and the latency,
        // and neither was any use without the other.
        const errorSummary = c.get("errorSummary");
        if (errorSummary) {
            data.errorCode = errorSummary.code;
            data.errorMessage = errorSummary.message;
        }

        // A 4xx the handler marked expected (see ApiError.expected) is a
        // routine answer, such as NO_SESSION to a browser that holds no
        // session, and is logged like a success. Anything else at 4xx still
        // says something about the server and stays at warn.
        //
        // In development a page load is several requests, and an INFO line for
        // each scrolled the ready box and every real warning out of the
        // terminal. There a routine answer is logged at debug — `LOG_LEVEL=debug`
        // brings every line back — unless it was slow. Production keeps its
        // INFO line per request: that is its access log.
        if (status >= 500) {
            log.error("request", data);
        } else if (status >= 400 && !errorSummary?.expected) {
            log.warn("request", data);
        } else if (hostEnv().NODE_ENV === "production" || latencyMs >= slowRequestMs) {
            log.info("request", data);
        } else {
            log.debug("request", data);
        }
    };
}
