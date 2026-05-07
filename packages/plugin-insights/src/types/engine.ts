import type { DataRow, HydratedChartConfig, ScorecardConfig } from "./widgets";

/**
 * Result returned by an insight's data callback.
 */
export interface InsightDataResult {
    rows: DataRow[];
}

/**
 * A single insight definition — the "dry" configuration that describes
 * what data to fetch and how to render it.
 *
 * Each insight owns its own `data()` callback, giving the developer
 * full flexibility: use the Rebase client SDK, call a custom function,
 * hit an external API — whatever makes sense for that widget.
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
     * Async callback that fetches data for this insight.
     *
     * The developer has full control — they can use any data source:
     * - `rebaseClient.data.orders.find({ limit: 100 })`
     * - `rebaseClient.call("functions/my-analytics", { ... })`
     * - A plain `fetch()` to any external API
     * - Static data for prototyping
     *
     * @returns Tabular data as `{ rows: DataRow[] }`.
     *
     * @example
     * ```typescript
     * data: async () => {
     *     const res = await rebaseClient.data.orders.find({
     *         limit: 1000,
     *         orderBy: "created_at",
     *     });
     *     return { rows: res.data };
     * }
     * ```
     */
    data: () => Promise<InsightDataResult>;

    /** Vega-Lite chart spec (merged with fetched data). Required when type is "chart". */
    chart?: Partial<HydratedChartConfig>;
    /** Scorecard field mapping. Required when type is "scorecard". */
    scorecard?: ScorecardConfig;
}

/**
 * Full plugin configuration passed to `useInsightsPlugin`.
 *
 * The developer defines insight widgets by placement and provides
 * their own data callbacks. No global fetch function needed — each
 * widget is self-contained.
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

    /** Optional cache TTL in milliseconds (default: 60_000) */
    cacheTTL?: number;
}
