import React from "react";
import type { RebasePlugin, SlotContribution } from "@rebasepro/types";
import type { InsightsPluginConfig, InsightDefinition } from "./types";
import { InsightsProvider } from "./engine/InsightsProvider";
import { CollectionInsightsSlot } from "./components/CollectionInsightsSlot";
import { HomeCardInsightSlot } from "./components/HomeCardInsightSlot";
import { HomeInsightsSlot } from "./components/HomeInsightsSlot";

/**
 * Creates the Insights plugin for Rebase.
 *
 * This plugin injects data-driven widgets (charts, scorecards) into key UI locations:
 * - **Home page header**: Dashboard-style overview via `home.children.start` slot
 * - **Collection headers**: Detailed analytics above collection tables via `collection.insights` slot
 * - **Home page cards**: Compact inline metrics within collection cards via `home.card.insight` slot
 *
 * @example
 * ```typescript
 * import { useInsightsPlugin } from "@rebasepro/plugin-insights";
 *
 * const insightsPlugin = useInsightsPlugin({
 *     fetchData: async ({ query }) => {
 *         const res = await fetch("/api/query", {
 *             method: "POST",
 *             body: JSON.stringify({ sql: query }),
 *         });
 *         return res.json();
 *     },
 *     cacheTTL: 120_000,
 *     insights: {
 *         home: [
 *             {
 *                 id: "total-revenue",
 *                 title: "Total Revenue",
 *                 type: "scorecard",
 *                 query: "SELECT SUM(amount) as value FROM orders",
 *                 scorecard: {
 *                     value: { field: "value", format: { style: "currency", currency: "USD" } },
 *                 },
 *             },
 *         ],
 *         collections: {
 *             orders: [
 *                 {
 *                     id: "orders-by-status",
 *                     title: "Orders by Status",
 *                     type: "chart",
 *                     query: "SELECT status, COUNT(*) as count FROM orders GROUP BY status",
 *                     chart: {
 *                         mark: "bar",
 *                         encoding: {
 *                             x: { field: "status", type: "nominal" },
 *                             y: { field: "count", type: "quantitative" },
 *                         },
 *                     },
 *                 },
 *             ],
 *         },
 *         cards: {
 *             orders: [
 *                 {
 *                     id: "recent-orders-count",
 *                     title: "Recent Orders",
 *                     type: "scorecard",
 *                     query: "SELECT COUNT(*) as value FROM orders WHERE created_at > NOW() - INTERVAL '24 hours'",
 *                     scorecard: {
 *                         value: { field: "value", format: { style: "decimal", notation: "compact" } },
 *                     },
 *                 },
 *             ],
 *         },
 *     },
 * });
 * ```
 */
export function useInsightsPlugin(config: InsightsPluginConfig): RebasePlugin {
    const { insights, fetchData, cacheTTL } = config;
    const slots: SlotContribution[] = [];

    // ── Home page insights ────────────────────────────────────────────
    if (insights.home && insights.home.length > 0) {
        const homeInsights = insights.home;
        slots.push({
            slot: "home.children.start",
            Component: (props: Record<string, unknown>) => (
                <HomeInsightsSlot
                    {...props}
                    insights={homeInsights}
                />
            ),
            order: 10,
        });
    }

    // ── Collection header insights ────────────────────────────────────
    if (insights.collections) {
        for (const [slug, defs] of Object.entries(insights.collections)) {
            if (defs.length === 0) continue;
            const collectionInsights = defs;
            slots.push({
                slot: "collection.insights",
                Component: (props: Record<string, unknown>) => {
                    // Only render for matching collection
                    const path = props.path as string;
                    const collectionSlug = path?.split("/").filter(Boolean).pop() ?? "";
                    if (collectionSlug !== slug) return null;
                    return (
                        <CollectionInsightsSlot
                            {...props as { path: string; collection: unknown; parentCollectionIds: string[] }}
                            insights={collectionInsights}
                        />
                    );
                },
                order: 10,
            });
        }
    }

    // ── Home card inline insights ─────────────────────────────────────
    if (insights.cards) {
        for (const [slug, defs] of Object.entries(insights.cards)) {
            if (defs.length === 0) continue;
            const cardInsights = defs;
            slots.push({
                slot: "home.card.insight",
                Component: (props: Record<string, unknown>) => {
                    const cardSlug = props.slug as string;
                    if (cardSlug !== slug) return null;
                    return (
                        <HomeCardInsightSlot
                            {...props as { slug: string; collection: unknown; context: unknown }}
                            insights={cardInsights}
                        />
                    );
                },
                order: 10,
            });
        }
    }

    return {
        key: "plugin-insights",
        slots,
        providers: [
            {
                scope: "root",
                Component: InsightsProvider as React.ComponentType<React.PropsWithChildren<Record<string, unknown>>>,
                props: { fetchData, cacheTTL },
            },
        ],
    };
}
