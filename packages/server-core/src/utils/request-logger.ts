/**
 * Structured HTTP request logging middleware for Hono.
 *
 * Logs every request with method, path, status code, latency, and
 * content-length. In production, outputs JSON for Cloud Logging; in
 * development, emits a coloured one-liner.
 *
 * @example
 * ```ts
 * import { requestLogger } from "@rebasepro/server-core";
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

        // Extract user ID from context if auth middleware ran
        const userId = c.get("userId" as never) as string | undefined;
        if (userId) {
            data.userId = userId;
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
