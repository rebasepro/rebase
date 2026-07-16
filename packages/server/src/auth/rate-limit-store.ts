/**
 * Where a rate limiter keeps its counts.
 *
 * Split out from the limiter itself because the two have different lifetimes:
 * the policy (how many, how often, keyed by what) is a property of the route,
 * and the storage is a property of the deployment. One process behind one
 * proxy is happy with a Map; several replicas behind a load balancer are not,
 * because a limit of 200 enforced independently by four of them is a limit of
 * 800.
 */
export interface RateLimitDecision {
    allowed: boolean;
    /** Requests left in the current window. Zero when `allowed` is false. */
    remaining: number;
    /** How long until the oldest hit falls out of the window. */
    retryAfterMs: number;
}

export interface RateLimitStore {
    /**
     * Record a hit against `key` and say whether it is allowed.
     *
     * Called once per request, so it must not be chatty. Implementations are
     * expected to be atomic per key: two concurrent hits must not both read a
     * count of `limit - 1` and both be allowed.
     */
    hit(key: string, windowMs: number, limit: number): Promise<RateLimitDecision>;

    /** Release timers/connections. Tests need this; servers rarely do. */
    dispose?(): void;
}

/**
 * The default store: a sliding window in this process's memory.
 *
 * Sliding rather than fixed: a fixed window lets a caller spend its whole
 * allowance in the last second of one window and again in the first second of
 * the next, which is twice the limit over an instant. Timestamps outside the
 * window are dropped on read, and swept periodically so an idle key does not
 * pin its array forever.
 *
 * Per-process, so N replicas enforce N times the limit between them. That is
 * the honest reason {@link RateLimitStore} exists.
 */
export class MemoryRateLimitStore implements RateLimitStore {
    private store = new Map<string, number[]>();
    private cleanupInterval?: ReturnType<typeof setInterval>;

    constructor(sweepMs = 15 * 60 * 1000) {
        this.cleanupInterval = setInterval(() => this.sweep(sweepMs), sweepMs);
        // Never hold the process open for a cache sweep.
        this.cleanupInterval.unref?.();
    }

    async hit(key: string, windowMs: number, limit: number): Promise<RateLimitDecision> {
        const now = Date.now();
        const timestamps = (this.store.get(key) ?? []).filter(t => now - t < windowMs);

        if (timestamps.length >= limit) {
            this.store.set(key, timestamps);
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs: Math.max(0, timestamps[0] + windowMs - now)
            };
        }

        timestamps.push(now);
        this.store.set(key, timestamps);
        return {
            allowed: true,
            remaining: limit - timestamps.length,
            retryAfterMs: 0
        };
    }

    private sweep(windowMs: number): void {
        const now = Date.now();
        for (const [key, timestamps] of this.store.entries()) {
            const live = timestamps.filter(t => now - t < windowMs);
            if (live.length === 0) this.store.delete(key);
            else this.store.set(key, live);
        }
    }

    dispose(): void {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
        this.cleanupInterval = undefined;
        this.store.clear();
    }
}
