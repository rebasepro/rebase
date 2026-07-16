import { MiddlewareHandler } from "hono";
import { HonoEnv } from "../api/types";
import { MemoryRateLimitStore, RateLimitStore } from "./rate-limit-store";

/**
 * Sliding-window rate limiting for Hono.
 *
 * The counting lives in a {@link RateLimitStore} — in this process's memory by
 * default, which is a per-replica limit and says so. See `rate-limit-store.ts`.
 */

interface RateLimiterOptions {
    /** Time window in milliseconds (default: 15 minutes) */
    windowMs?: number;
    /** Maximum requests per window (default: 100) */
    limit?: number;
    /** Key generator function. Defaults to IP-based keying. */
    keyGenerator?: (c: Parameters<MiddlewareHandler<HonoEnv>>[0]) => string;
    /** Custom message for rate limit responses */
    message?: string;
    /**
     * Where to keep the counts. Defaults to a private in-memory store — pass a
     * shared one to have several limiters (or several processes) agree.
     */
    store?: RateLimitStore;
    /**
     * Per-request limit override, for buckets whose allowance is data rather
     * than config (an API key's own `rate_limit`). Returning `undefined` uses
     * `limit`; returning `null` skips the limiter for this request.
     */
    resolveLimit?: (c: Parameters<MiddlewareHandler<HonoEnv>>[0]) => number | null | undefined;
}

/**
 * Create a rate-limiting middleware.
 *
 * Uses a sliding window: only hits within the last `windowMs` are counted.
 */
export function createRateLimiter(options: RateLimiterOptions = {}): MiddlewareHandler<HonoEnv> {
    const {
        windowMs = 15 * 60 * 1000,
        limit = 100,
        keyGenerator = defaultKeyGenerator,
        message = "Too many requests, please try again later.",
        store = new MemoryRateLimitStore(windowMs),
        resolveLimit
    } = options;

    return async (c, next) => {
        const effectiveLimit = resolveLimit ? resolveLimit(c) : limit;
        // `null` means "not my bucket" — e.g. an API-key limiter looking at a
        // request that carries no API key.
        if (effectiveLimit === null) return next();
        const activeLimit = effectiveLimit ?? limit;

        const decision = await store.hit(keyGenerator(c), windowMs, activeLimit);

        c.header("X-RateLimit-Limit", String(activeLimit));
        c.header("X-RateLimit-Remaining", String(decision.remaining));

        if (!decision.allowed) {
            const retryAfterSec = Math.ceil(decision.retryAfterMs / 1000);
            c.header("Retry-After", String(retryAfterSec));
            c.header("X-RateLimit-Reset", String(Math.ceil((Date.now() + decision.retryAfterMs) / 1000)));

            return c.json({
                error: {
                    message,
                    code: "RATE_LIMITED"
                }
            }, 429);
        }

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

/** How the data API's limits are apportioned. All fields optional. */
export interface DataRateLimitConfig {
    /** Turn the whole thing off — for a deployment whose proxy already does it. */
    enabled?: boolean;
    windowMs?: number;
    /** Fallback for an API key with no `rate_limit` of its own. Default 1000. */
    apiKey?: number;
    /** Per signed-in user. Default 1000. */
    user?: number;
    /** Per IP, for requests with no principal at all. Default 300. */
    anonymous?: number;
    /** Share counts across replicas. Defaults to this process's memory. */
    store?: RateLimitStore;
}

/**
 * Rate limiting for the data API.
 *
 * Every request is in exactly one bucket, resolved most-specific first: an API
 * key by its id, a signed-in user by their uid, anyone else by IP. Previously
 * only the first of those was limited at all — the middleware returned early
 * for any request without an API key — so JWT and anonymous traffic to
 * `/api/data/*` was unbounded, which is most of the traffic a BaaS gets.
 *
 * Per bucket, not per route: the point is to bound what one caller costs, and
 * they can spend it wherever they like.
 *
 * The defaults are deliberately loose. This is a floor against a runaway client
 * or a naive scraper, not a quota — a deployment that wants real quotas should
 * set them, and one that already has a proxy doing this should pass
 * `enabled: false` rather than pay for it twice.
 */
export function createDataRateLimiter(config: DataRateLimitConfig = {}): MiddlewareHandler<HonoEnv> {
    const {
        windowMs = 15 * 60 * 1000,
        apiKey: apiKeyLimit = 1000,
        user: userLimit = 1000,
        anonymous: anonLimit = 300,
        // One store for every bucket: the keys are already namespaced, and a
        // shared store is what makes a shared limit possible.
        store = new MemoryRateLimitStore(windowMs)
    } = config;

    return createRateLimiter({
        windowMs,
        store,
        message: "Too many requests, please try again later.",
        keyGenerator: (c) => {
            const key = c.get("apiKey") as { id: string } | undefined;
            if (key) return `api-key:${key.id}`;
            const user = c.get("user") as { userId?: string } | undefined;
            if (user?.userId && user.userId !== "anon") return `user:${user.userId}`;
            return `ip:${defaultKeyGenerator(c)}`;
        },
        resolveLimit: (c) => {
            const key = c.get("apiKey") as { id: string; rate_limit?: number | null } | undefined;
            if (key) return key.rate_limit ?? apiKeyLimit;
            const user = c.get("user") as { userId?: string } | undefined;
            if (user?.userId && user.userId !== "anon") return userLimit;
            return anonLimit;
        }
    });
}

/**
 * Create a rate limiter specifically for API key requests.
 *
 * @deprecated Use {@link createDataRateLimiter}, which limits signed-in users
 * and anonymous callers too. This one skips every request that is not
 * API-key-authenticated, which was most of them.
 *
 * @param defaultLimit - Fallback limit when the key has no `rate_limit` set.
 * @param windowMs     - Time window in milliseconds (default: 15 minutes).
 */
export function createApiKeyRateLimiter(
    defaultLimit = 1000,
    windowMs = 15 * 60 * 1000
): MiddlewareHandler<HonoEnv> {
    return createRateLimiter({
        windowMs,
        message: "API key rate limit exceeded, please try again later.",
        keyGenerator: apiKeyKeyGenerator,
        resolveLimit: (c) => {
            const apiKey = c.get("apiKey") as { id: string; rate_limit: number | null } | undefined;
            // Not an API key request — skip this limiter.
            if (!apiKey) return null;
            return apiKey.rate_limit ?? defaultLimit;
        }
    });
}
