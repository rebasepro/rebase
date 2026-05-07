import React, { createContext, useContext, useRef, useCallback, useState } from 'react';
import { DashboardFilterConfig, DataRow, DateParams, DryWidgetConfig, ParamFilter, WidgetConfig } from '../../types';

interface CacheEntry {
    config: WidgetConfig;
    timestamp: number;
}

interface TableCacheEntry {
    data: DataRow[];
    timestamp: number;
}

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000;

// Create a stable hash for cache keys - recursively sorts object keys for consistent hashing
function createHash(obj: any): string {
    return JSON.stringify(sortDeep(obj));
}

// Recursively sort object keys for stable serialization
function sortDeep(obj: any): any {
    if (obj === null || obj === undefined) {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(sortDeep);
    }
    if (typeof obj === 'object') {
        // Handle Date objects
        if (obj instanceof Date) {
            return obj.toISOString();
        }
        // Sort keys and recursively process values
        const sortedKeys = Object.keys(obj).sort();
        const result: Record<string, any> = {};
        for (const key of sortedKeys) {
            result[key] = sortDeep(obj[key]);
        }
        return result;
    }
    return obj;
}

function createCacheKey(
    widgetId: string,
    dryConfig: DryWidgetConfig,
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

function createTableCacheKey(
    sql: string,
    params: DateParams | undefined,
    paramFilters: ParamFilter[] | undefined,
    sortBy: [string, "asc" | "desc"] | undefined,
    offset: number
): string {
    return createHash({ sql, params, paramFilters, sortBy, offset });
}

interface WidgetCacheContextValue {
    getCachedData: (
        widgetId: string,
        dryConfig: DryWidgetConfig,
        params: DateParams,
        paramFilters: ParamFilter[],
        filters: DashboardFilterConfig[]
    ) => WidgetConfig | null;
    setCachedData: (
        widgetId: string,
        dryConfig: DryWidgetConfig,
        params: DateParams,
        paramFilters: ParamFilter[],
        filters: DashboardFilterConfig[],
        config: WidgetConfig
    ) => void;
    getInflightRequest: (
        widgetId: string,
        dryConfig: DryWidgetConfig,
        params: DateParams,
        paramFilters: ParamFilter[],
        filters: DashboardFilterConfig[]
    ) => Promise<WidgetConfig> | null;
    setInflightRequest: (
        widgetId: string,
        dryConfig: DryWidgetConfig,
        params: DateParams,
        paramFilters: ParamFilter[],
        filters: DashboardFilterConfig[],
        promise: Promise<WidgetConfig>
    ) => void;
    invalidateWidget: (widgetId: string) => void;
    invalidateAll: () => void;
    refreshTick: number;
    triggerRefresh: () => void;
    // Table-specific cache functions
    getTableCachedData: (
        sql: string,
        params: DateParams | undefined,
        paramFilters: ParamFilter[] | undefined,
        sortBy: [string, "asc" | "desc"] | undefined,
        offset: number
    ) => DataRow[] | null;
    setTableCachedData: (
        sql: string,
        params: DateParams | undefined,
        paramFilters: ParamFilter[] | undefined,
        sortBy: [string, "asc" | "desc"] | undefined,
        offset: number,
        data: DataRow[]
    ) => void;
    invalidateTableCache: (sql: string) => void;
}

const WidgetCacheContext = createContext<WidgetCacheContextValue | null>(null);

export function useWidgetCache(): WidgetCacheContextValue | null {
    return useContext(WidgetCacheContext);
}

export function WidgetCacheProvider({ children }: { children: React.ReactNode }) {
    const cache = useRef<Map<string, CacheEntry>>(new Map());
    const inflightRequests = useRef<Map<string, Promise<WidgetConfig>>>(new Map());
    const tableCache = useRef<Map<string, TableCacheEntry>>(new Map());
    const [refreshTick, setRefreshTick] = useState(0);

    const getCachedData = useCallback((
        widgetId: string,
        dryConfig: DryWidgetConfig,
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
        dryConfig: DryWidgetConfig,
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
        dryConfig: DryWidgetConfig,
        params: DateParams,
        paramFilters: ParamFilter[],
        filters: DashboardFilterConfig[]
    ): Promise<WidgetConfig> | null => {
        const cacheKey = createCacheKey(widgetId, dryConfig, params, paramFilters, filters);
        return inflightRequests.current.get(cacheKey) || null;
    }, []);

    const setInflightRequest = useCallback((
        widgetId: string,
        dryConfig: DryWidgetConfig,
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

    const invalidateWidget = useCallback((widgetId: string) => {
        // Remove all cache entries for this widget
        for (const key of cache.current.keys()) {
            if (key.startsWith(`${widgetId}:`)) {
                cache.current.delete(key);
            }
        }
        // Also remove any inflight requests
        for (const key of inflightRequests.current.keys()) {
            if (key.startsWith(`${widgetId}:`)) {
                inflightRequests.current.delete(key);
            }
        }
    }, []);

    const invalidateAll = useCallback(() => {
        cache.current.clear();
        inflightRequests.current.clear();
        tableCache.current.clear();
    }, []);

    const triggerRefresh = useCallback(() => {
        invalidateAll();
        setRefreshTick(t => t + 1);
    }, [invalidateAll]);

    // Table-specific cache functions
    const getTableCachedData = useCallback((
        sql: string,
        params: DateParams | undefined,
        paramFilters: ParamFilter[] | undefined,
        sortBy: [string, "asc" | "desc"] | undefined,
        offset: number
    ): DataRow[] | null => {
        const cacheKey = createTableCacheKey(sql, params, paramFilters, sortBy, offset);
        const entry = tableCache.current.get(cacheKey);

        if (!entry) return null;

        if (Date.now() - entry.timestamp > CACHE_DURATION) {
            tableCache.current.delete(cacheKey);
            return null;
        }

        return entry.data;
    }, []);

    const setTableCachedData = useCallback((
        sql: string,
        params: DateParams | undefined,
        paramFilters: ParamFilter[] | undefined,
        sortBy: [string, "asc" | "desc"] | undefined,
        offset: number,
        data: DataRow[]
    ) => {
        const cacheKey = createTableCacheKey(sql, params, paramFilters, sortBy, offset);
        tableCache.current.set(cacheKey, {
            data,
            timestamp: Date.now()
        });
    }, []);

    const invalidateTableCache = useCallback((sql: string) => {
        // Remove all table cache entries containing this SQL
        for (const key of tableCache.current.keys()) {
            if (key.includes(sql)) {
                tableCache.current.delete(key);
            }
        }
    }, []);

    const value: WidgetCacheContextValue = {
        getCachedData,
        setCachedData,
        getInflightRequest,
        setInflightRequest,
        invalidateWidget,
        invalidateAll,
        refreshTick,
        triggerRefresh,
        getTableCachedData,
        setTableCachedData,
        invalidateTableCache
    };

    return (
        <WidgetCacheContext.Provider value={value}>
            {children}
        </WidgetCacheContext.Provider>
    );
}

