import { useEffect, useState } from "react";
import type { InsightDefinition, InsightDataResult } from "../types";
import { useInsightsEngine } from "./InsightsProvider";

/**
 * Hook that fetches and caches data for a single insight definition.
 *
 * Handles:
 * - TTL-based caching via InsightsCache
 * - Inflight request deduplication (multiple widgets sharing same query)
 * - Loading and error state management
 *
 * @param definition - The insight to fetch data for
 * @param collectionSlug - Optional collection context for scoped queries
 */
export function useInsightsData(
    definition: InsightDefinition,
    collectionSlug?: string
): {
    data: InsightDataResult | null;
    loading: boolean;
    error: Error | null;
} {
    const { fetchData, cache } = useInsightsEngine();
    const [data, setData] = useState<InsightDataResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const cacheKey = `${definition.id}:${collectionSlug ?? "global"}`;

    useEffect(() => {
        let cancelled = false;

        // 1. Check cache
        const cached = cache.get(cacheKey);
        if (cached) {
            setData(cached);
            setLoading(false);
            return;
        }

        // 2. Check inflight — deduplicate concurrent requests for the same query
        const inflight = cache.getInflight(cacheKey);
        if (inflight) {
            setLoading(true);
            inflight
                .then((result) => {
                    if (!cancelled) {
                        setData(result);
                    }
                })
                .catch((err) => {
                    if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
            return;
        }

        // 3. Fresh fetch — execute the SQL query
        setLoading(true);
        setError(null);

        const promise = fetchData({
            query: definition.query,
            collectionSlug,
        });

        cache.setInflight(cacheKey, promise);

        promise
            .then((result) => {
                cache.set(cacheKey, result);
                if (!cancelled) {
                    setData(result);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err instanceof Error ? err : new Error(String(err)));
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [definition.id, definition.query, collectionSlug, cacheKey, fetchData, cache]);

    return { data, loading, error };
}
