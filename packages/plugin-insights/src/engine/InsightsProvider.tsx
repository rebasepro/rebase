import React, { createContext, useContext, useMemo, type PropsWithChildren } from "react";
import type { InsightSource } from "../types";
import { InsightsEngine } from "./InsightsEngine";

const InsightsContext = createContext<InsightsEngine | null>(null);

/**
 * Root-level provider for the insights data engine.
 * Injected automatically by the plugin via `providers: [{ scope: "root" }]`.
 *
 * Holds the one `InsightsEngine` every insight widget reads its source from.
 */
export function InsightsProvider({
    sources,
    periodDays,
    cacheTTL,
    children
}: PropsWithChildren<{
    sources: Record<string, InsightSource>;
    periodDays?: number;
    cacheTTL?: number;
}>) {
    const engine = useMemo(
        () => new InsightsEngine(sources, periodDays, cacheTTL),
        [sources, periodDays, cacheTTL]
    );

    return (
        <InsightsContext.Provider value={engine}>
            {children}
        </InsightsContext.Provider>
    );
}

/**
 * The insights engine (for advanced usage).
 * Returns null when called outside of an `InsightsProvider`
 * (e.g. during auth-loading phase before plugin providers mount).
 */
export function useInsightsEngine(): InsightsEngine | null {
    return useContext(InsightsContext);
}
