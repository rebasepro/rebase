import type { DataRow, InsightPeriod, InsightSource } from "../types";

export const DEFAULT_PERIOD_DAYS = 30;

const DAY_MS = 86_400_000;

/** The current and previous windows of `days` days, ending at `to`. */
export function resolvePeriod(days: number, to: Date): InsightPeriod {
    const from = new Date(to.getTime() - days * DAY_MS);
    return {
        days,
        from,
        to,
        previousFrom: new Date(from.getTime() - days * DAY_MS)
    };
}

/** A source's record, with the period it was fetched for. */
export interface SourceResult {
    row: DataRow;
    period: InsightPeriod;
}

/**
 * The cache key for one source, for one user.
 *
 * The engine lives at the root of the app and outlives a sign-out, and a figure
 * is computed under the permissions and row-level security of whoever asked
 * for it. A key without the user would serve the previous account's numbers to
 * the next one that signs in on the same tab, until the TTL ran out.
 */
export function sourceCacheKey(sourceId: string, userId: string | null): string {
    return JSON.stringify([userId, sourceId]);
}

/**
 * Fetches and caches the plugin's sources.
 *
 * Every insight that reads a source shares one fetch of it: concurrent reads
 * join the request in flight, later ones read the cache until the TTL passes.
 * That is what keeps a figure shown on the home page and in a collection view
 * the same number.
 */
export class InsightsEngine {
    private readonly cache = new Map<string, { result: SourceResult; at: number }>();
    private readonly inflight = new Map<string, Promise<SourceResult>>();
    private anchor: { period: InsightPeriod; at: number } | null = null;

    constructor(
        private readonly sources: Record<string, InsightSource>,
        readonly periodDays: number = DEFAULT_PERIOD_DAYS,
        private readonly ttl: number = 60_000,
        private readonly now: () => number = Date.now
    ) {}

    /**
     * The period a fetch starting now is asked for. Its end is fixed by the
     * first fetch and kept until the TTL passes, so sources fetched for the
     * same screen describe the same window.
     */
    period(): InsightPeriod {
        const now = this.now();
        if (!this.anchor || now - this.anchor.at > this.ttl) {
            this.anchor = { period: resolvePeriod(this.periodDays, new Date(now)), at: now };
        }
        return this.anchor.period;
    }

    /** The cached result for this source and user, if it is still fresh. */
    peek(sourceId: string, userId: string | null): SourceResult | null {
        const entry = this.cache.get(sourceCacheKey(sourceId, userId));
        if (!entry || this.now() - entry.at > this.ttl) return null;
        return entry.result;
    }

    /** The source's record for this user: from the cache, the fetch in flight, or a new fetch. */
    load(sourceId: string, userId: string | null): Promise<SourceResult> {
        const cached = this.peek(sourceId, userId);
        if (cached) return Promise.resolve(cached);

        const key = sourceCacheKey(sourceId, userId);
        const pending = this.inflight.get(key);
        if (pending) return pending;

        const source = this.sources[sourceId];
        if (!source) {
            return Promise.reject(new Error(`No insights source is named "${sourceId}".`));
        }

        const period = this.period();
        let fetched: Promise<DataRow>;
        try {
            fetched = Promise.resolve(source({ period }));
        } catch (error: unknown) {
            // A source that throws before returning its promise fails like one that rejects.
            fetched = Promise.reject(error);
        }
        const promise: Promise<SourceResult> = fetched
            .then(
                (row) => {
                    const result = { row, period };
                    // A fetch that `invalidate()` dropped while it ran must not
                    // write its result back over the cleared cache.
                    if (this.inflight.get(key) === promise) {
                        this.inflight.delete(key);
                        this.cache.set(key, { result, at: this.now() });
                    }
                    return result;
                },
                (error: unknown) => {
                    if (this.inflight.get(key) === promise) this.inflight.delete(key);
                    throw error;
                }
            );
        this.inflight.set(key, promise);
        return promise;
    }

    /** Drops every cached result and fetch in flight, and re-anchors the period on the next fetch. */
    invalidate(): void {
        this.cache.clear();
        this.inflight.clear();
        this.anchor = null;
    }
}
