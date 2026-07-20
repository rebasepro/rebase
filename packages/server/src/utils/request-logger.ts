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
import { logger as log } from "./logger";

export interface RequestLoggerOptions {
    /** Paths to skip logging (e.g. "/health"). Supports exact match. */
    skip?: string[];
}

export function requestLogger(options?: RequestLoggerOptions): MiddlewareHandler {
    const skipPaths = new Set(options?.skip ?? ["/health", "/favicon.ico"]);

    return async (c, next) => {
        const start = performance.now();
        const method = c.req.method;
        const path = c.req.path;

        // Skip noisy endpoints
        if (skipPaths.has(path)) {
            return next();
        }

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
        // This read `c.get("userId")` — a context key nothing has ever set, so
        // no request log has ever carried a user. The auth middlewares all set
        // `user`; the id lives on it.
        const uid = (c.get("user") as { uid?: string } | undefined)?.uid;
        if (uid) {
            data.uid = uid;
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
