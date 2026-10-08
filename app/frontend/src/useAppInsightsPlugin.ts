import React from "react";
import { useInsightsPlugin } from "@rebasepro/plugin-insights";
import type { DataRow, InsightPeriod, InsightsPluginConfig } from "@rebasepro/plugin-insights";
import type { RebasePlugin } from "@rebasepro/cms-types";
import type { createRebaseClient } from "@rebasepro/client";

type RebaseClientType = ReturnType<typeof createRebaseClient>;

/** The comparison window as the `insights` function reads it. */
function windowQuery(period: InsightPeriod): string {
    return new URLSearchParams({
        previousFrom: period.previousFrom.toISOString(),
        from: period.from.toISOString(),
        to: period.to.toISOString()
    }).toString();
}

/**
 * The demo's insights: four KPIs on the home page and a few figures per
 * collection, all read from the `insights` backend function.
 *
 * The home page's order KPIs and the Orders card read the same `orders`
 * source, so they come from one request and one query.
 */
export function useAppInsightsPlugin(rebaseClient: RebaseClientType): RebasePlugin {
    const insightsConfig = React.useMemo<InsightsPluginConfig>(() => {
        const read = (path: string) =>
            rebaseClient.functions.invoke<DataRow>("insights", undefined, { method: "GET", path });

        return {
            period: { days: 30 },
            cacheTTL: 120_000,
            sources: {
                orders: ({ period }) => read(`orders?${windowQuery(period)}`),
                customers: ({ period }) => read(`customers?${windowQuery(period)}`),
                products: () => read("products"),
                tickets: () => read("tickets")
            },
            insights: {
                home: [
                    {
                        id: "total-revenue",
                        title: "Total Revenue",
                        source: "orders",
                        icon: "DollarSign",
                        value: { field: "revenue", format: { style: "currency", currency: "USD", notation: "compact", decimals: 1 } },
                        comparison: { previous: "previousRevenue", intent: "increase_is_good" }
                    },
                    {
                        id: "total-orders",
                        title: "Orders",
                        source: "orders",
                        icon: "ShoppingCart",
                        value: { field: "orders" },
                        comparison: { previous: "previousOrders", intent: "increase_is_good" }
                    },
                    {
                        id: "avg-order-value",
                        title: "Avg. Order Value",
                        source: "orders",
                        icon: "TrendingUp",
                        value: { field: "avgOrderValue", format: { style: "currency", currency: "USD", decimals: 2 } },
                        comparison: { previous: "previousAvgOrderValue", intent: "increase_is_good" }
                    },
                    {
                        id: "refunded-orders",
                        title: "Refunded Orders",
                        source: "orders",
                        icon: "PackageX",
                        value: { field: "refunded" },
                        comparison: { previous: "previousRefunded", intent: "decrease_is_good", show: "absolute" }
                    }
                ],
                collections: {
                    orders: [
                        {
                            id: "orders-confirmed",
                            title: "Confirmed",
                            source: "orders",
                            icon: "CheckCircle",
                            value: { field: "confirmed" },
                            comparison: { previous: "previousConfirmed", intent: "increase_is_good", show: "absolute" }
                        },
                        {
                            id: "orders-shipped",
                            title: "Shipped",
                            source: "orders",
                            icon: "Truck",
                            value: { field: "shipped" },
                            comparison: { previous: "previousShipped", intent: "increase_is_good", show: "absolute" }
                        }
                    ],
                    customers: [
                        {
                            id: "customers-new",
                            title: "New",
                            source: "customers",
                            icon: "UserPlus",
                            value: { field: "newCustomers" },
                            comparison: { previous: "previousNewCustomers", intent: "increase_is_good", show: "absolute" }
                        }
                    ],
                    products: [
                        {
                            id: "products-catalog",
                            title: "Catalog",
                            source: "products",
                            value: { field: "total" }
                        }
                    ],
                    tickets: [
                        {
                            id: "tickets-open",
                            title: "Open",
                            source: "tickets",
                            value: { field: "open" }
                        }
                    ]
                }
            }
        };
    }, [rebaseClient]);

    return useInsightsPlugin(insightsConfig);
}
