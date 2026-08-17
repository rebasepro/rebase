import React from "react";
import type { RebasePlugin, SlotContribution } from "@rebasepro/admin-types";
import type { InsightsPluginConfig } from "./types";
import { InsightsProvider } from "./engine/InsightsProvider";
import { HomeCardInsightSlot } from "./components/HomeCardInsightSlot";
import { HomeInsightsSlot } from "./components/HomeInsightsSlot";
import { CollectionInsightsInline } from "./components/CollectionInsightsInline";

/**
 * Creates the Insights plugin for Rebase.
 *
 * This plugin injects scorecard widgets into key UI locations:
 * - **Home page header**: KPI overview via `home.children.start` slot
 * - **Collection list view**: Scorecards inline (below title, above list) via `collection.widgets` slot
 * - **Home page cards**: Compact scorecard metrics auto-extracted from collection insights via `home.card.widget` slot
 *
 * Collection-level insights (`collections.<slug>`) are the single source of truth:
 * scorecards render in the collection list view and are automatically extracted
 * to show as compact widgets on the corresponding home page card.
 *
 * Each insight owns its own `data()` callback — use the Rebase client SDK,
 * call a custom function, or hit any external API. Full flexibility, zero new endpoints.
 *
 * @example
 * ```typescript
 * import { useInsightsPlugin } from "@rebasepro/plugin-insights";
 *
 * const insightsPlugin = useInsightsPlugin({
 *     cacheTTL: 120_000,
 *     insights: {
 *         home: [
 *             { id: "revenue", title: "Revenue", data: async () => ..., scorecard: { ... } },
 *         ],
 *         collections: {
 *             orders: [
 *                 { id: "total", title: "Total Orders", data: async () => ..., scorecard: { ... } },
 *             ],
 *         },
 *     },
 * });
 * ```
 */
export function useInsightsPlugin(config: InsightsPluginConfig): RebasePlugin {
    const { insights, cacheTTL } = config;

    return React.useMemo(() => {
        const slots: SlotContribution[] = [];

        // ── Home page insights ────────────────────────────────────────────
        if (insights.home && insights.home.length > 0) {
            const homeInsights = insights.home;
            slots.push({
                slot: "home.children.start" as const,
                Component: (props: Record<string, unknown>) => (
                    <HomeInsightsSlot
                        {...props}
                        insights={homeInsights}
                    />
                ),
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
                    Component: (props: Record<string, unknown>) => {
                        const path = props.path as string;
                        const collectionSlug = path?.split("/").filter(Boolean).pop() ?? "";
                        if (collectionSlug !== slug) return null;

                        // Skip relation-scoped views (e.g. a single product's Orders
                        // tab). These aggregations are collection-wide — `InsightContext`
                        // carries no parent entity id, so a definition cannot narrow to
                        // the parent — and rendering "Revenue $36.2K" above one product's
                        // two orders reads as a figure for those orders.
                        const parentEntityIds = props.parentEntityIds as string[] | undefined;
                        if (parentEntityIds && parentEntityIds.length > 0) return null;

                        return (
                            <CollectionInsightsInline
                                {...props as { path: string; collection: unknown; parentCollectionSlugs: string[], parentEntityIds: string[] }}
                                insights={collectionInsights}
                            />
                        );
                    },
                    order: 10
                });

                // 2. Auto-extract scorecards for home page card
                slots.push({
                    slot: "home.card.widget" as const,
                    Component: (props: Record<string, unknown>) => {
                        const cardSlug = props.slug as string;
                        if (cardSlug !== slug) return null;
                        return (
                            <HomeCardInsightSlot
                                {...props as { slug: string; collection: unknown; context: unknown }}
                                insights={collectionInsights}
                            />
                        );
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
                    props: { cacheTTL }
                }
            ]
        };
    }, [insights, cacheTTL]);
}
