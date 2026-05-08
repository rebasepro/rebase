import { useEffect, useState } from "react";
import type { InsightDefinition, InsightDataResult } from "../types";
import { useInsightsEngine } from "./InsightsProvider";
import { useAuthController } from "@rebasepro/core";

/**
 * Hook that fetches and caches data for a single insight definition.
 *
 * Calls the definition's own `data()` callback and manages:
 * - TTL-based caching via InsightsCache
 * - Inflight request deduplication (multiple mounts of the same widget)
 * - Loading and error state management
 *
 * @param definition - The insight to fetch data for
 * @param collectionSlug - Optional collection context for cache key scoping
 */
export function useInsightsData(
    definition: InsightDefinition,
    collectionSlug?: string
): {
    data: InsightDataResult | null;
    loading: boolean;
    error: Error | null;
} {
    const { cache } = useInsightsEngine();
    const { initialLoading, authLoading, user, loginSkipped } = useAuthController();
    const authReady = !initialLoading && !authLoading && (Boolean(user) || loginSkipped);
    const [data, setData] = useState<InsightDataResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const cacheKey = `${definition.id}:${collectionSlug ?? "global"}`;

    useEffect(() => {
        if (!authReady) {
            return;
        }

        let cancelled = false;

        // 1. Check cache
        const cached = cache.get(cacheKey);
        if (cached) {
            setData(cached);
            setLoading(false);
            return;
        }

        // 2. Check inflight — deduplicate concurrent requests for the same widget
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

        // 3. Fresh fetch — invoke the definition's own data callback
        setLoading(true);
        setError(null);

        const promise = definition.data();

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
    }, [definition.id, definition.data, collectionSlug, cacheKey, cache, authReady]);

    return { data, loading, error };
}
