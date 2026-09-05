/**
 * Structured HTTP request logging middleware for Hono.
 *
 * Logs every request with method, path, status code, latency, and
 * content-length. In production, outputs JSON for Cloud Logging; in
 * development, emits a coloured one-liner.
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

export interface RequestLoggerOptions {
    /** Paths to skip logging (e.g. "/health"). Supports exact match. */
    skip?: string[];
}

export function requestLogger(options?: RequestLoggerOptions): MiddlewareHandler<HonoEnv> {
    const skipPaths = new Set(options?.skip ?? ["/health", "/favicon.ico"]);

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

        if (status >= 500) {
            log.error("request", data);
        } else if (status >= 400) {
            log.warn("request", data);
        } else {
            log.info("request", data);
        }
    };
}
