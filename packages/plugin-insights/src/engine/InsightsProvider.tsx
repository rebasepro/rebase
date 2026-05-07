import React, { createContext, useContext, useMemo, type PropsWithChildren } from "react";
import type { InsightsFetchFn } from "../types";
import { InsightsCache } from "./InsightsCache";

interface InsightsContextValue {
    fetchData: InsightsFetchFn;
    cache: InsightsCache;
}

const InsightsContext = createContext<InsightsContextValue | null>(null);

/**
 * Root-level provider for the insights data engine.
 * Injected automatically by the plugin via `providers: [{ scope: "root" }]`.
 *
 * Manages a single `InsightsCache` instance and passes the user-provided
 * `fetchData` function down to all insight widgets via context.
 */
export function InsightsProvider({
    fetchData,
    cacheTTL,
    children
}: PropsWithChildren<{ fetchData: InsightsFetchFn; cacheTTL?: number }>) {
    const cache = useMemo(() => new InsightsCache(cacheTTL), [cacheTTL]);
    const value = useMemo(() => ({ fetchData, cache }), [fetchData, cache]);

    return (
        <InsightsContext.Provider value={value}>
            {children}
        </InsightsContext.Provider>
    );
}

/**
 * Access the insights data engine (fetch function + cache).
 * Must be called within an `InsightsProvider`.
 */
export function useInsightsEngine(): InsightsContextValue {
    const ctx = useContext(InsightsContext);
    if (!ctx) throw new Error("useInsightsEngine must be used within InsightsProvider");
    return ctx;
}
