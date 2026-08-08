import { MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { isAnonymousUid } from "@rebasepro/types";
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
    /**
     * Number of trusted reverse-proxy hops in front of this server. Each hop
     * appends the address it saw to `X-Forwarded-For`, so the real client IP is
     * the Nth entry from the right. Anything further left is client-supplied and
     * ignored — which is what stops a caller spoofing `X-Forwarded-For` to
     * rotate rate-limit keys. Defaults to `TRUSTED_PROXY_HOPS` (env) or `1`.
     * Set to `0` when the server is exposed directly (no proxy): `X-Forwarded-For`
     * is then ignored entirely in favour of `X-Real-IP`.
     */
    trustedProxyHops?: number;
}

/**
 * Resolve the number of trusted proxy hops from an explicit option, the
 * `TRUSTED_PROXY_HOPS` env var, or the default of 1.
 */
function resolveTrustedProxyHops(optionValue?: number): number {
    if (typeof optionValue === "number" && Number.isFinite(optionValue) && optionValue >= 0) {
        return Math.floor(optionValue);
    }
    const fromEnv = Number(process.env.TRUSTED_PROXY_HOPS);
    if (Number.isFinite(fromEnv) && fromEnv >= 0) {
        return Math.floor(fromEnv);
    }
    return 1;
}

/**
 * Create a rate-limiting middleware.
 *
 * Uses a sliding window: only hits within the last `windowMs` are counted.
 */
export function createRateLimiter(options: RateLimiterOptions = {}): MiddlewareHandler<HonoEnv> {
    const trustedProxyHops = resolveTrustedProxyHops(options.trustedProxyHops);
    const {
        windowMs = 15 * 60 * 1000,
        limit = 100,
        keyGenerator = (c: Parameters<MiddlewareHandler<HonoEnv>>[0]) => defaultKeyGenerator(c, trustedProxyHops),
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
 * The address the socket is actually connected to, or `undefined` on a runtime
 * that cannot say. Unforgeable, unlike every header below.
 *
 * `getConnInfo` is Node-specific and throws elsewhere, so the failure is
 * swallowed: a runtime without connection info falls back to the shared bucket,
 * which is a availability trade the caller cannot exploit.
 */
function socketAddress(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): string | undefined {
    try {
        return getConnInfo(c).remote.address;
    } catch {
        return undefined;
    }
}

/**
 * Default key generator: the client's address, from the most trustworthy source
 * this deployment has.
 *
 * `X-Forwarded-For` is a client-writable header; only the entries appended by
 * trusted reverse proxies can be believed. With `trustedProxyHops` proxies in
 * front, each appends the address it saw, so the real client IP is the
 * `trustedProxyHops`-th entry from the right — everything further left is
 * client-supplied and must be ignored. This is what prevents a caller from
 * spoofing `X-Forwarded-For` to spread its requests across many rate-limit keys.
 *
 * `X-Real-IP` is the *same* kind of header and needs the same rule, which it
 * did not have: it was read unconditionally, including under
 * `trustedProxyHops === 0` — the mode whose entire meaning is "no proxy is in
 * front of me". With no proxy there, nothing writes `X-Real-IP` except the
 * caller, so the key was theirs to choose: one header per request bought an
 * unlimited number of buckets, and the limiters on login, registration and
 * password reset counted to one. The reasoning had been done carefully for one
 * spelling of a proxy header and not carried to its twin.
 *
 * So `X-Real-IP` is now believed only where a proxy is declared to exist. With
 * none, the connection's own address is used — unforgeable, and available
 * because the server runs on `@hono/node-server`. `"unknown"` is the last
 * resort only, and it is a single shared bucket by design: better that
 * anonymous callers throttle each other than that any of them throttles nobody.
 */
function defaultKeyGenerator(
    c: Parameters<MiddlewareHandler<HonoEnv>>[0],
    trustedProxyHops: number = resolveTrustedProxyHops()
): string {
    if (trustedProxyHops > 0) {
        const forwardedFor = c.req.header("x-forwarded-for");
        if (forwardedFor) {
            const ips = forwardedFor.split(",").map(s => s.trim()).filter(Boolean);
            if (ips.length > 0) {
                const idx = Math.max(0, ips.length - trustedProxyHops);
                return ips[idx];
            }
        }
        // A trusted proxy is declared to be in front, so this header is its to
        // set — and a proxy that sets only `X-Real-IP` (the stock nginx recipe)
        // is a normal deployment.
        const realIp = c.req.header("x-real-ip");
        if (realIp) return realIp;
    }
    return socketAddress(c) ?? "unknown";
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
    /**
     * Per IP, for requests with no principal at all. Default 300.
     * `null` disables the anonymous bucket entirely.
     */
    anonymous?: number | null;
    /**
     * Per IP, for anonymous requests to `/api/functions/*`. Default 3000 —
     * deliberately far looser than {@link anonymous}, because the functions
     * router is public by default for webhook receivers (Stripe, GitHub) whose
     * bursts arrive from a handful of provider IPs and would trip the data
     * API's ceiling.
     *
     * The looseness bounds the *value*, not the existence of the limit: this
     * router is the one that invites anonymous callers, so it is the last one
     * that should have no ceiling at all. `null` disables it — an explicit
     * choice, which is what the hardcoded `anonymous: null` here used to be
     * without any way to say otherwise.
     */
    anonymousFunctions?: number | null;
    /** Share counts across replicas. Defaults to this process's memory. */
    store?: RateLimitStore;
}

/** @see DataRateLimitConfig.anonymousFunctions */
export const DEFAULT_FUNCTIONS_ANONYMOUS_LIMIT = 3000;

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
            const user = c.get("user") as { uid?: string } | undefined;
            if (user?.uid && !isAnonymousUid(user.uid)) return `user:${user.uid}`;
            return `ip:${defaultKeyGenerator(c)}`;
        },
        resolveLimit: (c) => {
            const key = c.get("apiKey") as { id: string; rate_limit?: number | null } | undefined;
            if (key) return key.rate_limit ?? apiKeyLimit;
            const user = c.get("user") as { uid?: string } | undefined;
            if (user?.uid && !isAnonymousUid(user.uid)) return userLimit;
            return anonLimit;
        }
    });
}

