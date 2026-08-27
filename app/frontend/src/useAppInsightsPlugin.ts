import React from "react";
import { useInsightsPlugin } from "@rebasepro/plugin-insights";
import type { InsightsPluginConfig } from "@rebasepro/plugin-insights";
import type { RebasePlugin } from "@rebasepro/cms-types";
import type { createRebaseClient } from "@rebasepro/client";

type RebaseClientType = ReturnType<typeof createRebaseClient>;

/** Period-over-period deltas are null when the previous window was empty. */
type Change = number | null;

interface HomeInsights {
    totalRevenue: number;
    totalRevenueChange: Change;
    totalOrders: number;
    totalOrdersChange: Change;
    avgOrderValue: number;
    avgOrderValueChange: Change;
    refundedOrders: number;
    refundedOrdersChange: Change;
}

/**
 * Custom hook to initialize the Insights plugin.
 * Handles fetching logic for home and collection insights and returns the plugin instance.
 */
export function useAppInsightsPlugin(rebaseClient: RebaseClientType): RebasePlugin {
    // ── Insights Fetch Helpers ─────────────────────────────────────────
    // The insights cache keys on the insight id, so the four home
    // scorecards each call their own `data()` and would each issue the
    // same GET. Sharing the in-flight promise collapses them back to the
    // single round trip the endpoint was written for; it is cleared on
    // settle so a later refresh still re-fetches.
    const inflightHome = React.useRef<Promise<HomeInsights> | null>(null);
    const inflightCollections = React.useRef(new Map<string, Promise<Record<string, number | null>>>());

    const fetchHomeInsights = React.useCallback(
        () => {
            if (!inflightHome.current) {
                inflightHome.current = rebaseClient.functions
                    .invoke<HomeInsights>("insights", undefined, { method: "GET",
path: "home" })
                    .finally(() => { inflightHome.current = null; });
            }
            return inflightHome.current;
        },
        [rebaseClient]
    );

    const fetchCollectionInsights = React.useCallback(
        (slug: string) => {
            const inflight = inflightCollections.current;
            let pending = inflight.get(slug);
            if (!pending) {
                pending = rebaseClient.functions
                    .invoke<Record<string, number | null>>(
                        "insights", undefined, { method: "GET",
path: `collection/${slug}` }
                    )
                    .finally(() => { inflight.delete(slug); });
                inflight.set(slug, pending);
            }
            return pending;
        },
        [rebaseClient]
    );

    // ── Insights Config ────────────────────────────────────────────────
    const insightsConfig = React.useMemo<InsightsPluginConfig>(() => ({
        cacheTTL: 120_000,
        insights: {
            home: [
                {
                    id: "total-revenue",
                    title: "Total Revenue",
                    data: async () => {
                        const stats = await fetchHomeInsights();
                        return { rows: [{ value: stats.totalRevenue,
comp: stats.totalRevenueChange }] };
                    },
                    scorecard: {
                        value: { field: "value",
format: { style: "currency",
currency: "USD",
notation: "compact",
decimals: 1 } },
                        comparison: { field: "comp",
format: { style: "percent",
showSign: true,
decimals: 1 },
intent: "increase_is_good" },
                        icon: "DollarSign",
                        dateRange: "vs Previous 30 Days"
                    }
                },
                {
                    id: "total-orders",
                    title: "Orders",
                    data: async () => {
                        const stats = await fetchHomeInsights();
                        return { rows: [{ value: stats.totalOrders,
comp: stats.totalOrdersChange }] };
                    },
                    scorecard: {
                        value: { field: "value",
format: { style: "decimal" } },
                        comparison: { field: "comp",
format: { style: "percent",
showSign: true,
decimals: 1 },
intent: "increase_is_good" },
                        icon: "ShoppingCart",
                        dateRange: "vs Previous 30 Days"
                    }
                },
                {
                    id: "avg-order-value",
                    title: "Avg. Order Value",
                    data: async () => {
                        const stats = await fetchHomeInsights();
                        return { rows: [{ value: stats.avgOrderValue,
comp: stats.avgOrderValueChange }] };
                    },
                    scorecard: {
                        value: { field: "value",
format: { style: "currency",
currency: "USD",
decimals: 2 } },
                        comparison: { field: "comp",
format: { style: "percent",
showSign: true,
decimals: 1 },
intent: "increase_is_good" },
                        icon: "TrendingUp",
                        dateRange: "vs Previous 30 Days"
                    }
                },
                {
                    id: "refunded-orders",
                    title: "Refunded Orders",
                    data: async () => {
                        const stats = await fetchHomeInsights();
                        return { rows: [{ value: stats.refundedOrders,
comp: stats.refundedOrdersChange }] };
                    },
                    scorecard: {
                        value: { field: "value",
format: { style: "decimal" } },
                        comparison: { field: "comp",
format: { style: "percent",
showSign: true,
decimals: 1 },
intent: "decrease_is_good" },
                        icon: "PackageX",
                        dateRange: "vs Previous 30 Days"
                    }
                }
            ],
            collections: {
                orders: [
                    {
                        id: "orders-confirmed-count",
                        title: "Confirmed",
                        data: async () => {
                            const stats = await fetchCollectionInsights("orders");
                            return { rows: [{ value: stats.confirmed,
comp: stats.confirmedChange }] };
                        },
                        scorecard: {
                            value: { field: "value",
format: { style: "decimal" } },
                            comparison: { field: "comp",
format: { style: "percent",
showSign: true,
decimals: 1 },
intent: "increase_is_good" as const },
                            icon: "CheckCircle",
                            dateRange: "vs Previous 30 Days"
                        }
                    },
                    {
                        id: "orders-shipped-count",
                        title: "Shipped",
                        data: async () => {
                            const stats = await fetchCollectionInsights("orders");
                            return { rows: [{ value: stats.shipped,
comp: stats.shippedChange }] };
                        },
                        scorecard: {
                            value: { field: "value",
format: { style: "decimal" } },
                            comparison: { field: "comp",
format: { style: "percent",
showSign: true,
decimals: 1 },
intent: "increase_is_good" as const },
                            icon: "Truck",
                            dateRange: "vs Previous 30 Days"
                        }
                    },
                    {
                        id: "orders-revenue",
                        title: "Revenue",
                        data: async () => {
                            const stats = await fetchCollectionInsights("orders");
                            return { rows: [{ value: stats.revenue,
comp: stats.revenueChange }] };
                        },
                        scorecard: {
                            value: { field: "value",
format: { style: "currency",
currency: "USD",
notation: "compact",
decimals: 1 } },
                            comparison: { field: "comp",
format: { style: "percent",
showSign: true,
decimals: 1 },
intent: "increase_is_good" as const },
                            dateRange: "vs Previous 30 Days"
                        }
                    }
                ],
                products: [
                    {
                        id: "products-catalog-count",
                        title: "Catalog",
                        data: async () => {
                            const stats = await fetchCollectionInsights("products");
                            return { rows: [{ value: stats.total }] };
                        },
                        scorecard: {
                            value: { field: "value",
format: { style: "decimal" } }
                        }
                    }
                ],
                tickets: [
                    {
                        id: "tickets-open-count",
                        title: "Open",
                        data: async () => {
                            const stats = await fetchCollectionInsights("tickets");
                            return { rows: [{ value: stats.openCount }] };
                        },
                        scorecard: {
                            value: { field: "value",
format: { style: "decimal" } }
                        }
                    }
                ]
            }
        }
    }), [fetchHomeInsights, fetchCollectionInsights]);

    return useInsightsPlugin(insightsConfig);
}
