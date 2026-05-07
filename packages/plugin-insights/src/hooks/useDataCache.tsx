import { useCallback, useRef } from 'react';
import { DashboardFilterConfig, DateParams, DryChartWidgetConfig, ParamFilter, WidgetConfig } from '../types';

interface CacheEntry {
    config: WidgetConfig;
    timestamp: number;
    promise?: Promise<WidgetConfig>;
}

interface CacheKey {
    widgetId: string;
    configHash: string;
    paramsHash: string;
    filtersHash: string;
}

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000;

// Create a stable hash for cache keys
function createHash(obj: any): string {
    return JSON.stringify(obj, Object.keys(obj).sort());
}

function createCacheKey(
    widgetId: string,
    dryConfig: DryChartWidgetConfig,
    params: DateParams,
    paramFilters: ParamFilter[],
    filters: DashboardFilterConfig[]
): string {
    const configHash = createHash({
        ...dryConfig,
        // Exclude size and position from cache key as they don't affect data
        size: undefined,
        position: undefined
    });
    const paramsHash = createHash(params);
    const filtersHash = createHash({ paramFilters, filters });

    return `${widgetId}:${configHash}:${paramsHash}:${filtersHash}`;
}

export function useDataCache() {
    const cache = useRef<Map<string, CacheEntry>>(new Map());
    const inflightRequests = useRef<Map<string, Promise<WidgetConfig>>>(new Map());

    const getCachedData = useCallback((
        widgetId: string,
        dryConfig: DryChartWidgetConfig,
        params: DateParams,
        paramFilters: ParamFilter[],
        filters: DashboardFilterConfig[]
    ): WidgetConfig | null => {
        const cacheKey = createCacheKey(widgetId, dryConfig, params, paramFilters, filters);
        const entry = cache.current.get(cacheKey);

        if (!entry) return null;

        // Check if cache is still valid
        if (Date.now() - entry.timestamp > CACHE_DURATION) {
            cache.current.delete(cacheKey);
            return null;
        }

        return entry.config;
    }, []);

    const setCachedData = useCallback((
        widgetId: string,
        dryConfig: DryChartWidgetConfig,
        params: DateParams,
        paramFilters: ParamFilter[],
        filters: DashboardFilterConfig[],
        config: WidgetConfig
    ) => {
        const cacheKey = createCacheKey(widgetId, dryConfig, params, paramFilters, filters);
        cache.current.set(cacheKey, {
            config,
            timestamp: Date.now()
        });
    }, []);

    const getInflightRequest = useCallback((
        widgetId: string,
        dryConfig: DryChartWidgetConfig,
        params: DateParams,
        paramFilters: ParamFilter[],
        filters: DashboardFilterConfig[]
    ): Promise<WidgetConfig> | null => {
        const cacheKey = createCacheKey(widgetId, dryConfig, params, paramFilters, filters);
        return inflightRequests.current.get(cacheKey) || null;
    }, []);

    const setInflightRequest = useCallback((
        widgetId: string,
        dryConfig: DryChartWidgetConfig,
        params: DateParams,
        paramFilters: ParamFilter[],
        filters: DashboardFilterConfig[],
        promise: Promise<WidgetConfig>
    ) => {
        const cacheKey = createCacheKey(widgetId, dryConfig, params, paramFilters, filters);
        inflightRequests.current.set(cacheKey, promise);

        // Clean up inflight request when promise resolves/rejects
        promise.finally(() => {
            inflightRequests.current.delete(cacheKey);
        });
    }, []);

    const clearCache = useCallback(() => {
        cache.current.clear();
        inflightRequests.current.clear();
    }, []);

    const clearExpiredCache = useCallback(() => {
        const now = Date.now();
        for (const [key, entry] of cache.current.entries()) {
            if (now - entry.timestamp > CACHE_DURATION) {
                cache.current.delete(key);
            }
        }
    }, []);

    return {
        getCachedData,
        setCachedData,
        getInflightRequest,
        setInflightRequest,
        clearCache,
        clearExpiredCache
    };
}
