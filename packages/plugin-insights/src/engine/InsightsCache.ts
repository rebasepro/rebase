import type { InsightDataResult } from "../types";

interface CacheEntry {
    data: InsightDataResult;
    timestamp: number;
}

/**
 * In-memory cache for insight query results.
 * Supports TTL-based expiry and inflight request deduplication
 * to prevent redundant network requests when multiple widgets
 * share the same query.
 */
export class InsightsCache {
    private cache = new Map<string, CacheEntry>();
    private inflight = new Map<string, Promise<InsightDataResult>>();

    constructor(private ttl: number = 60_000) {}

    get(key: string): InsightDataResult | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }
        return entry.data;
    }

    set(key: string, data: InsightDataResult): void {
        this.cache.set(key, { data, timestamp: Date.now() });
        this.inflight.delete(key);
    }

    getInflight(key: string): Promise<InsightDataResult> | null {
        return this.inflight.get(key) ?? null;
    }

    setInflight(key: string, promise: Promise<InsightDataResult>): void {
        this.inflight.set(key, promise);
    }

    invalidate(key?: string): void {
        if (key) {
            this.cache.delete(key);
            this.inflight.delete(key);
        } else {
            this.cache.clear();
            this.inflight.clear();
        }
    }
}
