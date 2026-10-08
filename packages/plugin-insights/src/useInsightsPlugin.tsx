import React from "react";
import type {
    RebasePlugin,
    AnySlotContribution,
    CollectionWidgetsSlotProps,
    HomeCardWidgetSlotProps
} from "@rebasepro/cms-types";
import type { InsightsPluginConfig } from "./types";
import { InsightsProvider } from "./engine/InsightsProvider";
import { DEFAULT_PERIOD_DAYS } from "./engine/InsightsEngine";
import { assertValidConfig } from "./validateConfig";
import { HomeCardInsightSlot } from "./components/HomeCardInsightSlot";
import { HomeInsightsSlot } from "./components/HomeInsightsSlot";
import { CollectionInsightsInline } from "./components/CollectionInsightsInline";

/**
 * Creates the Insights plugin for Rebase.
 *
 * This plugin injects scorecard widgets into key UI locations:
 * - **Home page header**: KPI overview via `home.children.start` slot
 * - **Collection list view**: Scorecards inline (below title, above list) via `collection.widgets` slot
 * - **Home page cards**: Compact readouts of the collection's insights via `home.card.widget` slot
 *
 * Figures come from named `sources`, each fetched once per user however many
 * insights read it: a value shown on the home page and in a collection view
 * is the same number. Every source is handed the comparison period, so the
 * query and the label above the tiles describe the same window.
 *
 * Pass a memoized config: a new `sources` object starts a new cache.
 *
 * @example
 * ```typescript
 * import { useInsightsPlugin } from "@rebasepro/plugin-insights";
 *
 * const insightsPlugin = useInsightsPlugin(useMemo(() => ({
 *     period: { days: 30 },
 *     sources: {
 *         orders: ({ period }) => fetchOrderStats(period.from, period.to, period.previousFrom)
 *     },
 *     insights: {
 *         home: [{
 *             id: "revenue",
 *             title: "Revenue",
 *             source: "orders",
 *             value: { field: "revenue", format: { style: "currency", currency: "USD" } },
 *             comparison: { previous: "previousRevenue", intent: "increase_is_good" }
 *         }],
 *         collections: {
 *             orders: [{
 *                 id: "shipped",
 *                 title: "Shipped",
 *                 source: "orders",
 *                 value: { field: "shipped" },
 *                 comparison: { previous: "previousShipped", intent: "increase_is_good", show: "absolute" }
 *             }]
 *         }
 *     }
 * }), []));
 * ```
 */
export function useInsightsPlugin(config: InsightsPluginConfig): RebasePlugin {
    const { insights, sources, period, cacheTTL } = config;
    const periodDays = period?.days ?? DEFAULT_PERIOD_DAYS;

    return React.useMemo(() => {
        assertValidConfig({ insights, sources, period: { days: periodDays } });
        const slots: AnySlotContribution[] = [];

        // ── Home page insights ────────────────────────────────────────────
        if (insights.home && insights.home.length > 0) {
            const homeInsights = insights.home;
            slots.push({
                slot: "home.children.start" as const,
                Component: () => <HomeInsightsSlot insights={homeInsights}/>,
                order: 10
            });
        }

        // ── Per-collection insights ───────────────────────────────────────
        // A single `collections.<slug>` definition serves two slots:
        // 1. collection.widgets   → inline scorecards in the list view
        // 2. home.card.widget     → compact scorecards on the home card
        if (insights.collections) {
            for (const [slug, defs] of Object.entries(insights.collections)) {
                if (defs.length === 0) continue;
                const collectionInsights = defs;

                // 1. Inline in collection list view
                slots.push({
                    slot: "collection.widgets" as const,
                    Component: (props: CollectionWidgetsSlotProps) => {
                        const collectionSlug = props.path?.split("/").filter(Boolean).pop() ?? "";
                        if (collectionSlug !== slug) return null;

                        // Skip relation-scoped views (e.g. a single product's Orders
                        // tab). Sources are collection-wide — a source is handed the
                        // period and nothing about a parent entity — and rendering
                        // "Revenue $36.2K" above one product's two orders reads as a
                        // figure for those orders.
                        if (props.parentEntityIds && props.parentEntityIds.length > 0) return null;

                        return <CollectionInsightsInline insights={collectionInsights}/>;
                    },
                    order: 10
                });

                // 2. Auto-extract scorecards for home page card
                slots.push({
                    slot: "home.card.widget" as const,
                    Component: (props: HomeCardWidgetSlotProps) => {
                        if (props.slug !== slug) return null;
                        return <HomeCardInsightSlot insights={collectionInsights}/>;
                    },
                    order: 10
                });
            }
        }

        return {
            key: "plugin-insights",
            slots,
            providers: [
                {
                    scope: "root" as const,
                    Component: InsightsProvider as React.ComponentType<React.PropsWithChildren<Record<string, unknown>>>,
                    props: { sources, periodDays, cacheTTL }
                }
            ]
        };
    }, [insights, sources, periodDays, cacheTTL]);
}
