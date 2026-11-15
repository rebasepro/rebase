/**
 * Rate limits for custom functions, counted where the backend counts its own.
 *
 * A function that guards a costly route (a paid API call, a push to someone's
 * lock screen) used to need its own limiter, and the natural one to write is a
 * `Map` in module scope. That counts per process: behind N replicas, or with
 * the `api` and `functions` roles split, every process grants the whole
 * allowance, and nothing reports it. These count in the backend's shared store
 * when it has one (`REBASE_RATE_LIMIT_STORE=sql`, or `rateLimit.store`) — the
 * same store the auth routes use — and in this process's memory otherwise,
 * which is exactly what the hand-written `Map` did.
 *
 * Portable: the store and the caller's address come off the request
 * (`c.var.services`), so nothing here imports Node.
 *
 * ```ts
 * app.post("/invite", rateLimit({ name: "invite", limit: 40, windowMs: 3_600_000 }), handler);
 *
 * // or inline, keyed by anything:
 * const { allowed } = await checkRateLimit(c, { name: "tts", limit: 200, windowMs: 86_400_000, key: userId });
 * ```
 *
 * @module
 */
import type { Context, MiddlewareHandler } from "hono";
import type { HonoEnv } from "../api/types";
import { MemoryRateLimitStore, type RateLimitDecision, type RateLimitStore } from "../auth/rate-limit-store";

export type { RateLimitDecision };

export interface FunctionRateLimit {
    /**
     * What this limit counts, unique among the app's limits. It namespaces the
     * keys, so two limits on the same caller never share a count.
     */
    name: string;
    /** Hits allowed per window. */
    limit: number;
    /** The sliding window, in milliseconds. */
    windowMs: number;
}

export interface RateLimitOptions extends FunctionRateLimit {
    /**
     * Whom the count is for. Defaults to the caller's address, read by the
     * deployment's proxy rule (`TRUSTED_PROXY_HOPS`) — see {@link clientAddress}.
     */
    key?: (c: Context<HonoEnv>) => string | Promise<string>;
    /** The 429's message. */
    message?: string;
}

export interface CheckRateLimitOptions extends FunctionRateLimit {
    /** Whom the count is for. Defaults to the caller's address. */
    key?: string;
}

/**
 * Per-window memory stores, for a backend with no shared one. One per window
 * because a memory store sweeps by a single window: a day-long count kept in a
 * store swept hourly would be forgotten after an hour.
 */
const memoryStores = new Map<number, MemoryRateLimitStore>();

function storeFor(c: Context<HonoEnv>, windowMs: number): RateLimitStore {
    const shared = c.var.services?.rateLimitStore;
    if (shared) return shared;
    let store = memoryStores.get(windowMs);
    if (!store) {
        store = new MemoryRateLimitStore(windowMs);
        memoryStores.set(windowMs, store);
    }
    return store;
}

/**
 * The caller's address, as the backend's own limiters judge it: the socket's,
 * or behind `TRUSTED_PROXY_HOPS` proxies the one they report — never a header
 * the caller wrote. `"unknown"` outside a backend's routes, which is one
 * shared bucket: callers nobody can tell apart throttle each other rather than
 * nobody.
 */
export function clientAddress(c: Context<HonoEnv>): string {
    return c.var.services?.clientAddress?.(c) ?? "unknown";
}

function assertLimit({ name, limit, windowMs }: FunctionRateLimit): void {
    if (!name) throw new Error("rateLimit: `name` is required, so the count is not shared with another limit.");
    if (!Number.isInteger(limit) || limit < 1) throw new Error(`rateLimit "${name}": \`limit\` must be a positive integer.`);
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error(`rateLimit "${name}": \`windowMs\` must be a positive number.`);
}

/**
 * Count one hit against `key` (the caller's address by default) and say
 * whether it is within the limit. For a limit decided inside a handler — per
 * user, per room, per kind of work.
 */
export async function checkRateLimit(c: Context<HonoEnv>, options: CheckRateLimitOptions): Promise<RateLimitDecision> {
    assertLimit(options);
    const key = options.key ?? clientAddress(c);
    return storeFor(c, options.windowMs).hit(`fn:${options.name}:${key}`, options.windowMs, options.limit);
}

/**
 * A route's rate limit, as middleware: past the limit it answers 429 with
 * `Retry-After`, in the same shape as the framework's own limiters.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler<HonoEnv> {
    assertLimit(options);
    const message = options.message ?? "Too many requests, please try again later.";
    return async (c, next) => {
        const key = options.key ? await options.key(c) : clientAddress(c);
        const decision = await checkRateLimit(c, { name: options.name, limit: options.limit, windowMs: options.windowMs, key });
        c.header("X-RateLimit-Limit", String(options.limit));
        c.header("X-RateLimit-Remaining", String(decision.remaining));
        if (!decision.allowed) {
            c.header("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)));
            return c.json({ error: { message, code: "RATE_LIMITED" } }, 429);
        }
        return next();
    };
}
