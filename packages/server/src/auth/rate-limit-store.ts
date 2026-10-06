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
    private store = new Map<string, HitWindow>();
    private cleanupInterval?: ReturnType<typeof setInterval>;
    private now: () => number;

    /**
     * `now` exists so the window can be driven directly instead of by sleeping:
     * a test that waits half a real window is a test that fails on a loaded
     * machine, where the sleep overruns and the hits it expects to still be in
     * the window have left it.
     */
    constructor(sweepMs = 15 * 60 * 1000, now: () => number = Date.now) {
        this.now = now;
        this.cleanupInterval = setInterval(() => this.sweep(sweepMs), sweepMs);
        // Never hold the process open for a cache sweep.
        this.cleanupInterval.unref?.();
    }

    async hit(key: string, windowMs: number, limit: number): Promise<RateLimitDecision> {
        const now = this.now();
        let window = this.store.get(key);
        if (!window) {
            window = { stamps: [], head: 0, ordered: true };
            this.store.set(key, window);
        }
        expire(window, now, windowMs);
        const live = window.stamps.length - window.head;

        if (live >= limit) {
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs: Math.max(0, window.stamps[window.head] + windowMs - now)
            };
        }

        if (live > 0 && now < window.stamps[window.stamps.length - 1]) window.ordered = false;
        window.stamps.push(now);
        return {
            allowed: true,
            remaining: limit - (live + 1),
            retryAfterMs: 0
        };
    }

    private sweep(windowMs: number): void {
        const now = this.now();
        for (const [key, window] of this.store.entries()) {
            expire(window, now, windowMs);
            if (window.head === window.stamps.length) this.store.delete(key);
        }
    }

    dispose(): void {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
        this.cleanupInterval = undefined;
        this.store.clear();
    }
}

/**
 * One key's hits, oldest first, from `head` on.
 *
 * Every hit used to `filter` the whole window into a new array — O(limit) work
 * and garbage per request, on the event loop: over a millisecond and 700 KB per
 * request at a limit of 100,000. Hits are recorded in the order they happen, so
 * the expired ones are a prefix: moving `head` past them is the same filter,
 * amortised O(1). The array is compacted once more than half of it is behind
 * `head`.
 *
 * `ordered` is false once a hit was recorded at an earlier time than the one
 * before it — a wall clock stepped back. Expiry is then no longer a prefix,
 * and the window is filtered as it always was until it empties.
 */
interface HitWindow {
    stamps: number[];
    head: number;
    ordered: boolean;
}

/** Drop the hits at least `windowMs` old — `now - t < windowMs` stays, as before. */
function expire(window: HitWindow, now: number, windowMs: number): void {
    if (!window.ordered) {
        window.stamps = window.stamps.slice(window.head).filter(t => now - t < windowMs);
        window.head = 0;
        if (window.stamps.length === 0) window.ordered = true;
        return;
    }
    const { stamps } = window;
    let head = window.head;
    while (head < stamps.length && now - stamps[head] >= windowMs) head++;
    if (head === stamps.length) {
        window.stamps = [];
        window.head = 0;
    } else if (head >= 32 && head * 2 >= stamps.length) {
        window.stamps = stamps.slice(head);
        window.head = 0;
    } else {
        window.head = head;
    }
}
