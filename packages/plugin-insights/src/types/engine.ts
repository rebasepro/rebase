import type { DataRow, ScorecardConfig } from "./widgets";

export interface InsightContext {
    /** The resolved path of the collection (e.g., "products/123/orders" or "orders") */
    path?: string;
    parentCollectionSlugs?: string[];
    /** The parent entity IDs if this is a subcollection (e.g., ["123"]) */
    parentEntityIds?: string[];
    /** The collection slug if this is an insight at the collection level */
    collectionSlug?: string;
}

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
    data: (context: InsightContext) => Promise<InsightDataResult>;

    /** Scorecard field mapping + formatting. */
    scorecard: ScorecardConfig;
}

/**
 * Full plugin configuration passed to `useInsightsPlugin`.
 *
 * The developer defines scorecard widgets by placement and provides
 * their own data callbacks. No global fetch function needed — each
 * widget is self-contained.
 *
 * Collection-level insights (`collections.<slug>`) are rendered in two places
 * automatically:
 * - **Collection list view**: Scorecards appear inline below the title and
 *   above the data list.
 * - **Home page cards**: Scorecards are auto-extracted and rendered as compact
 *   widgets inside each collection's card on the home page.
 *
 * This eliminates the need to duplicate definitions across different locations.
 */
export interface InsightsPluginConfig {
    /**
     * Insight definitions keyed by placement.
     *
     * - `home`: Rendered at the top of the home page via `home.children.start`.
     * - `collections.<slug>`: Rendered inline in that collection's list view
     *   and auto-extracted as compact scorecards on the home card.
     */
    insights: {
        home?: InsightDefinition[];
        collections?: Record<string, InsightDefinition[]>;
    };

    /** Optional cache TTL in milliseconds (default: 60_000) */
    cacheTTL?: number;
}
