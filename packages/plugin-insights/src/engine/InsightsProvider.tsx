import React, { createContext, useContext, useMemo, type PropsWithChildren } from "react";
import { InsightsCache } from "./InsightsCache";

interface InsightsContextValue {
    cache: InsightsCache;
}

const InsightsContext = createContext<InsightsContextValue | null>(null);

/**
 * Root-level provider for the insights data engine.
 * Injected automatically by the plugin via `providers: [{ scope: "root" }]`.
 *
 * Manages a single `InsightsCache` instance shared by all insight widgets
 * for TTL-based caching and inflight request deduplication.
 */
export function InsightsProvider({
    cacheTTL,
    children
}: PropsWithChildren<{ cacheTTL?: number }>) {
    const cache = useMemo(() => new InsightsCache(cacheTTL), [cacheTTL]);
    const value = useMemo(() => ({ cache }), [cache]);

    return (
        <InsightsContext.Provider value={value}>
            {children}
        </InsightsContext.Provider>
    );
}

/**
 * Access the insights cache (for advanced usage).
 * Returns null when called outside of an `InsightsProvider`
 * (e.g. during auth-loading phase before plugin providers mount).
 */
export function useInsightsEngine(): InsightsContextValue | null {
    return useContext(InsightsContext);
}
