import { MiddlewareHandler } from "hono";
import { HonoEnv } from "../api/types";

/**
 * In-memory sliding-window rate limiter for Hono.
 *
 * Suitable for single-instance and moderate-scale deployments.
 * For multi-instance setups, consider a shared store
 * (e.g. PostgreSQL-backed counters or an external rate-limit service).
 */

interface RateLimitEntry {
    timestamps: number[];
}

interface RateLimiterOptions {
    /** Time window in milliseconds (default: 15 minutes) */
    windowMs?: number;
    /** Maximum requests per window (default: 100) */
    limit?: number;
    /** Key generator function. Defaults to IP-based keying. */
    keyGenerator?: (c: Parameters<MiddlewareHandler<HonoEnv>>[0]) => string;
    /** Custom message for rate limit responses */
    message?: string;
}

/**
 * Create a rate-limiting middleware.
 *
 * Uses a sliding window algorithm: only timestamps within the last
 * `windowMs` milliseconds are counted. Old entries are garbage-collected
 * every `windowMs` to prevent unbounded memory growth.
 */
export function createRateLimiter(options: RateLimiterOptions = {}): MiddlewareHandler<HonoEnv> {
    const {
        windowMs = 15 * 60 * 1000,
        limit = 100,
        keyGenerator = defaultKeyGenerator,
        message = "Too many requests, please try again later."
    } = options;

    const store = new Map<string, RateLimitEntry>();

    // Periodic cleanup to prevent memory leak from expired entries
    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of store.entries()) {
            entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);
            if (entry.timestamps.length === 0) {
                store.delete(key);
            }
        }
    }, windowMs);

    // Allow the Node.js process to exit even if the interval is still running
    if (cleanupInterval.unref) {
        cleanupInterval.unref();
    }

    return async (c, next) => {
        const key = keyGenerator(c);
        const now = Date.now();

        let entry = store.get(key);
        if (!entry) {
            entry = { timestamps: [] };
            store.set(key, entry);
        }

        // Remove timestamps outside the current window
        entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);

        if (entry.timestamps.length >= limit) {
            const retryAfterMs = entry.timestamps[0] + windowMs - now;
            const retryAfterSec = Math.ceil(retryAfterMs / 1000);

            c.header("Retry-After", String(retryAfterSec));
            c.header("X-RateLimit-Limit", String(limit));
            c.header("X-RateLimit-Remaining", "0");
            c.header("X-RateLimit-Reset", String(Math.ceil((now + retryAfterMs) / 1000)));

            return c.json({
                error: {
                    message,
                    code: "RATE_LIMITED"
                }
            }, 429);
        }

        entry.timestamps.push(now);

        // Set rate limit headers
        c.header("X-RateLimit-Limit", String(limit));
        c.header("X-RateLimit-Remaining", String(limit - entry.timestamps.length));

        return next();
    };
}

/**
 * Default key generator: extract client IP from standard headers.
 */
function defaultKeyGenerator(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): string {
    const forwardedFor = c.req.header("x-forwarded-for");
    if (forwardedFor) {
        const ips = forwardedFor.split(",");
        // The leftmost IP can be easily spoofed by the client in the initial request.
        // Reverse proxies append to the right. We take the rightmost IP as the most
        // reliable indicator of the true client IP (the one closest to our server).
        return ips[ips.length - 1].trim();
    }
    return c.req.header("x-real-ip") || "unknown";
}

/**
 * Pre-configured rate limiter for general auth endpoints (login, register).
 * 200 requests per 15 minutes per IP.
 */
export const defaultAuthLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    message: "Too many authentication attempts, please try again later."
});

/**
 * Pre-configured strict rate limiter for sensitive endpoints (password reset, verification).
 * 50 requests per 15 minutes per IP.
 */
export const strictAuthLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    message: "Too many requests to this sensitive endpoint, please try again later."
});

/**
 * Key generator for API-key-based rate limiting.
 *
 * Uses the API key ID (from `c.get("apiKey")`) as the rate limit key.
 * Falls back to IP-based keying when the request is not authenticated
 * via an API key.
 */
export function apiKeyKeyGenerator(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): string {
    const apiKey = c.get("apiKey") as { id: string } | undefined;
    if (apiKey) {
        return `api-key:${apiKey.id}`;
    }
    return defaultKeyGenerator(c);
}

/**
 * Create a rate limiter specifically for API key requests.
 *
 * When a request is authenticated via an API key that has a `rate_limit`
 * configured, this limiter enforces per-key limits using the key's ID
 * as the rate limit bucket.
 *
 * @param defaultLimit - Fallback limit when the key has no `rate_limit` set.
 * @param windowMs     - Time window in milliseconds (default: 15 minutes).
 */
export function createApiKeyRateLimiter(
    defaultLimit = 1000,
    windowMs = 15 * 60 * 1000,
): MiddlewareHandler<HonoEnv> {
    // We maintain a single shared store keyed by API key ID.
    // The actual limit is resolved per-request from the key's metadata.
    const store = new Map<string, { timestamps: number[] }>();

    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of store.entries()) {
            entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);
            if (entry.timestamps.length === 0) {
                store.delete(key);
            }
        }
    }, windowMs);

    if (cleanupInterval.unref) {
        cleanupInterval.unref();
    }

    return async (c, next) => {
        const apiKey = c.get("apiKey") as { id: string; rate_limit: number | null } | undefined;
        if (!apiKey) {
            // Not an API key request — skip this limiter
            return next();
        }

        const limit = apiKey.rate_limit ?? defaultLimit;
        const key = `api-key:${apiKey.id}`;
        const now = Date.now();

        let entry = store.get(key);
        if (!entry) {
            entry = { timestamps: [] };
            store.set(key, entry);
        }

        entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);

        if (entry.timestamps.length >= limit) {
            const retryAfterMs = entry.timestamps[0] + windowMs - now;
            const retryAfterSec = Math.ceil(retryAfterMs / 1000);

            c.header("Retry-After", String(retryAfterSec));
            c.header("X-RateLimit-Limit", String(limit));
            c.header("X-RateLimit-Remaining", "0");
            c.header("X-RateLimit-Reset", String(Math.ceil((now + retryAfterMs) / 1000)));

            return c.json({
                error: {
                    message: "API key rate limit exceeded, please try again later.",
                    code: "RATE_LIMITED"
                }
            }, 429);
        }

        entry.timestamps.push(now);

        c.header("X-RateLimit-Limit", String(limit));
        c.header("X-RateLimit-Remaining", String(limit - entry.timestamps.length));

        return next();
    };
}
