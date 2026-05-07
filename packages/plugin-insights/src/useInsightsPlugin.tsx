import React from "react";
import type { RebasePlugin, SlotContribution } from "@rebasepro/types";
import type { InsightsPluginConfig } from "./types";
import { InsightsProvider } from "./engine/InsightsProvider";
import { CollectionInsightsToolbarButton } from "./components/CollectionInsightsToolbarButton";
import { HomeCardInsightSlot } from "./components/HomeCardInsightSlot";
import { HomeInsightsSlot } from "./components/HomeInsightsSlot";

/**
 * Creates the Insights plugin for Rebase.
 *
 * This plugin injects data-driven widgets (charts, scorecards) into key UI locations:
 * - **Home page header**: Dashboard-style overview via `home.children.start` slot
 * - **Collection headers**: Detailed analytics via `collection.toolbar` slot (drawer)
 * - **Home page cards**: Compact inline metrics within collection cards via `home.card.insight` slot
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
 *         home: [ ... ],
 *         collections: { orders: [ ... ] },
 *         cards: { orders: [ ... ] },
 *     },
 * });
 * ```
 */
export function useInsightsPlugin(config: InsightsPluginConfig): RebasePlugin {
    const { insights, cacheTTL } = config;
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
            order: 10,
        });
    }

    // ── Collection header insights ────────────────────────────────────
    if (insights.collections) {
        for (const [slug, defs] of Object.entries(insights.collections)) {
            if (defs.length === 0) continue;
            const collectionInsights = defs;
            slots.push({
                slot: "collection.toolbar" as const,
                Component: (props: Record<string, unknown>) => {
                    // Only render for matching collection
                    const path = props.path as string;
                    const collectionSlug = path?.split("/").filter(Boolean).pop() ?? "";
                    if (collectionSlug !== slug) return null;
                    return (
                        <CollectionInsightsToolbarButton
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
                slot: "home.card.insight" as const,
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
                scope: "root" as const,
                Component: InsightsProvider as React.ComponentType<React.PropsWithChildren<Record<string, unknown>>>,
                props: { cacheTTL },
            },
        ],
    };
}
