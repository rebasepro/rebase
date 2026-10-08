import type { DataRow, InsightFormat } from "./widgets";

/**
 * The window every comparison is measured over: the last `days` days against
 * the `days` days before them.
 */
export interface InsightPeriodConfig {
    days: number;
}

/**
 * A period resolved to instants. The current window is `[from, to)` and the
 * previous one is `[previousFrom, from)`, both `days` long.
 *
 * `to` is fixed when the first source of a page load is fetched and shared by
 * every source fetched while the cache holds, so two sources on one screen
 * describe the same window.
 */
export interface InsightPeriod {
    days: number;
    /** Start of the current window, inclusive. */
    from: Date;
    /** End of the current window, exclusive. */
    to: Date;
    /** Start of the previous window, inclusive. It ends at `from`. */
    previousFrom: Date;
}

/** What a source is called with. */
export interface InsightSourceContext {
    period: InsightPeriod;
}

/**
 * Fetches one record of figures. Use the Rebase client, call a backend
 * function, hit any API: the plugin only reads the fields its insights name.
 *
 * A source is fetched once per signed-in user however many insights read it,
 * on the home page and in the collection views alike, so a figure shown in two
 * places is always the same number.
 *
 * @example
 * ```typescript
 * orders: ({ period }) => rebaseClient.functions.invoke("insights", undefined, {
 *     method: "GET",
 *     path: `orders?from=${period.from.toISOString()}&to=${period.to.toISOString()}`
 * })
 * ```
 */
export type InsightSource = (context: InsightSourceContext) => Promise<DataRow>;

/**
 * How an insight compares its value with the previous period. The plugin
 * works out the change from the two figures, so it can choose how to show it.
 */
export interface InsightComparison {
    /** The field holding the same figure for the previous period. */
    previous: string;
    /**
     * Which direction is good news.
     * - `increase_is_good`: an increase reads as positive (revenue, sign-ups).
     * - `decrease_is_good`: a decrease reads as positive (refunds, churn).
     */
    intent: "increase_is_good" | "decrease_is_good";
    /**
     * - `percent` (default): the relative change, `↑ 42%`. Shown as an
     *   absolute change when the previous figure is zero.
     * - `absolute`: the difference in the value's own format, `↑ 9`. Right for
     *   small counts, where going from 3 to 12 would read as `↑ 300%`.
     */
    show?: "percent" | "absolute";
}

/**
 * One figure on a scorecard: which source to read, which field holds the
 * value, and how to write it.
 */
export interface InsightDefinition {
    /** Unique identifier for this insight */
    id: string;
    /** Display title */
    title: string;
    /** The key in {@link InsightsPluginConfig.sources} this insight reads. */
    source: string;
    /** The field holding the value, and how to write it. */
    value: {
        field: string;
        format?: InsightFormat;
    };
    comparison?: InsightComparison;
    /** Optional icon key (e.g., "ShoppingCart", "Users"), resolved via `getIcon` */
    icon?: string;
}

/**
 * Full plugin configuration passed to `useInsightsPlugin`.
 *
 * Collection-level insights (`collections.<slug>`) are rendered in two places
 * automatically:
 * - **Collection list view**: Scorecards appear inline below the title and
 *   above the data list.
 * - **Home page cards**: Scorecards are rendered as compact figures inside
 *   each collection's card on the home page.
 */
export interface InsightsPluginConfig {
    /** The comparison window. Defaults to 30 days. */
    period?: InsightPeriodConfig;

    /** Where the figures come from, by name. Insights refer to these keys. */
    sources: Record<string, InsightSource>;

    /**
     * Insight definitions keyed by placement.
     *
     * - `home`: Rendered at the top of the home page via `home.children.start`.
     * - `collections.<slug>`: Rendered inline in that collection's list view
     *   and as compact figures on its home card.
     */
    insights: {
        home?: InsightDefinition[];
        collections?: Record<string, InsightDefinition[]>;
    };

    /** Optional cache TTL in milliseconds (default: 60_000) */
    cacheTTL?: number;
}
