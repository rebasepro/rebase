import type { DataRow, HydratedChartConfig, ScorecardConfig } from "./widgets";

/**
 * Result returned by the data engine after executing a query.
 */
export interface InsightDataResult {
    rows: DataRow[];
}

/**
 * Parameters passed to the fetch function when executing a query.
 */
export interface InsightFetchParams {
    /** The SQL query string to execute */
    query: string;
    /** Optional collection slug for context-scoped queries */
    collectionSlug?: string;
    /** Arbitrary extra context for custom fetch implementations */
    context?: Record<string, unknown>;
}

/**
 * The data engine is a user-provided async function that executes
 * a query and returns tabular data. This decouples the plugin from
 * any specific backend implementation.
 *
 * @example
 * ```typescript
 * const fetchData: InsightsFetchFn = async ({ query }) => {
 *     const res = await fetch("/api/insights/query", {
 *         method: "POST",
 *         headers: { "Content-Type": "application/json" },
 *         body: JSON.stringify({ sql: query }),
 *     });
 *     return res.json();
 * };
 * ```
 */
export type InsightsFetchFn = (params: InsightFetchParams) => Promise<InsightDataResult>;

/**
 * A single insight definition — the "dry" configuration that describes
 * what data to fetch and how to render it.
 */
export interface InsightDefinition {
    /** Unique identifier for this insight */
    id: string;
    /** Display title */
    title: string;
    /** Optional description */
    description?: string;
    /** Type of visualization */
    type: "chart" | "scorecard";
    /**
     * The SQL query string used to fetch data.
     * Passed to the `InsightsFetchFn` at runtime.
     */
    query: string;
    /** Vega-Lite chart spec (merged with fetched data). Required when type is "chart". */
    chart?: Partial<HydratedChartConfig>;
    /** Scorecard field mapping. Required when type is "scorecard". */
    scorecard?: ScorecardConfig;
}

/**
 * Full plugin configuration passed to `useInsightsPlugin`.
 */
export interface InsightsPluginConfig {
    /**
     * Insight definitions keyed by placement.
     *
     * - `home`: Rendered at the top of the home page via `home.children.start`.
     * - `collections.<slug>`: Rendered above that collection's view via `collection.insights`.
     * - `cards.<slug>`: Rendered inline in the home page card for that collection.
     */
    insights: {
        home?: InsightDefinition[];
        collections?: Record<string, InsightDefinition[]>;
        cards?: Record<string, InsightDefinition[]>;
    };

    /** Data fetching function — executes queries and returns tabular data */
    fetchData: InsightsFetchFn;

    /** Optional cache TTL in milliseconds (default: 60_000) */
    cacheTTL?: number;
}
