import React from "react";
import "@fontsource/jetbrains-mono";
import "@fontsource/rubik";
import type { AnalyticsEvent } from "@rebasepro/types";

// Global gtag function injected by the GA4 script in index.html
declare function gtag(...args: any[]): void;

import { useRebaseAuthController } from "@rebasepro/auth";
import { Rebase, RebaseAuth } from "@rebasepro/core";
import { RebaseCMS, RebaseShell } from "@rebasepro/admin";
import type { RebasePlugin } from "@rebasepro/types";
import { useDataEnhancementPlugin } from "@rebasepro/plugin-data-enhancement";
import { useInsightsPlugin } from "@rebasepro/plugin-insights";
import type { InsightsPluginConfig } from "@rebasepro/plugin-insights";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";
import { BlogEntryPreview } from "./BlogEntryPreview";
import { DemoLoginView } from "./DemoLoginView";

// Configuration from environment
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : undefined);
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function App() {
    const rebaseClient = React.useMemo(() => createRebaseClient({
        baseUrl: API_URL
    }), []);

    // Forward all Rebase analytics events to GA4
    const onAnalyticsEvent = React.useCallback((event: AnalyticsEvent, data?: object) => {
        if (typeof gtag === "function") {
            gtag("event", event, data);
        }
    }, []);

    const authController = useRebaseAuthController({
        client: rebaseClient,
        googleClientId: GOOGLE_CLIENT_ID
    });



    const dataEnhancementPlugin = useDataEnhancementPlugin();

    // ── Insights Plugin ──────────────────────────────────────────────
    // Insight data is fetched via a backend function that runs SQL
    // aggregations server-side — no need to pull hundreds of rows
    // to the browser just to sum/count them.
    const fetchHomeInsights = React.useCallback(
        () => rebaseClient.functions.invoke<{
            totalRevenue: number;
            totalOrders: number;
            avgOrderValue: number;
            refundedOrders: number;
        }>("insights", undefined, { method: "GET", path: "home" }),
        [rebaseClient]
    );

    const fetchCollectionInsights = React.useCallback(
        (slug: string) => rebaseClient.functions.invoke<Record<string, number>>(
            "insights", undefined, { method: "GET", path: `collection/${slug}` }
        ),
        [rebaseClient]
    );

    const insightsConfig = React.useMemo<InsightsPluginConfig>(() => ({
        cacheTTL: 120_000,
        insights: {
            home: [
                {
                    id: "total-revenue",
                    title: "Total Revenue",
                    data: async () => {
                        const stats = await fetchHomeInsights();
                        return { rows: [{ value: stats.totalRevenue, comp: 0.15 }] };
                    },
                    scorecard: {
                        value: { field: "value", format: { style: "currency", currency: "USD", notation: "compact", decimals: 1 } },
                        comparison: { field: "comp", format: { style: "percent", showSign: true, decimals: 1 }, intent: "increase_is_good" },
                        icon: "DollarSign",
                        dateRange: "vs Previous 30 Days",
                    },
                },
                {
                    id: "total-orders",
                    title: "Orders",
                    data: async () => {
                        const stats = await fetchHomeInsights();
                        return { rows: [{ value: stats.totalOrders, comp: 0.124 }] };
                    },
                    scorecard: {
                        value: { field: "value", format: { style: "decimal" } },
                        comparison: { field: "comp", format: { style: "percent", showSign: true, decimals: 1 }, intent: "increase_is_good" },
                        icon: "ShoppingCart",
                        dateRange: "vs Previous 30 Days",
                    },
                },
                {
                    id: "avg-order-value",
                    title: "Avg. Order Value",
                    data: async () => {
                        const stats = await fetchHomeInsights();
                        return { rows: [{ value: stats.avgOrderValue, comp: -0.052 }] };
                    },
                    scorecard: {
                        value: { field: "value", format: { style: "currency", currency: "USD", decimals: 2 } },
                        comparison: { field: "comp", format: { style: "percent", showSign: true, decimals: 1 }, intent: "increase_is_good" },
                        icon: "TrendingUp",
                        dateRange: "vs Previous 30 Days",
                    },
                },
                {
                    id: "refunded-orders",
                    title: "Refunded Orders",
                    data: async () => {
                        const stats = await fetchHomeInsights();
                        return { rows: [{ value: stats.refundedOrders, comp: 0.021 }] };
                    },
                    scorecard: {
                        value: { field: "value", format: { style: "decimal" } },
                        comparison: { field: "comp", format: { style: "percent", showSign: true, decimals: 1 }, intent: "decrease_is_good" },
                        icon: "PackageX",
                        dateRange: "vs Previous 30 Days",
                    },
                },
            ],
            collections: {
                orders: [
                    {
                        id: "orders-confirmed-count",
                        title: "Confirmed",
                        data: async () => {
                            const stats = await fetchCollectionInsights("orders");
                            return { rows: [{ value: stats.confirmed, comp: 0.18 }] };
                        },
                        scorecard: {
                            value: { field: "value", format: { style: "decimal" } },
                            comparison: { field: "comp", format: { style: "percent", showSign: true, decimals: 1 }, intent: "increase_is_good" as const },
                            icon: "CheckCircle",
                            dateRange: "vs Previous Week",
                        },
                    },
                    {
                        id: "orders-shipped-count",
                        title: "Shipped",
                        data: async () => {
                            const stats = await fetchCollectionInsights("orders");
                            return { rows: [{ value: stats.shipped, comp: 0.074 }] };
                        },
                        scorecard: {
                            value: { field: "value", format: { style: "decimal" } },
                            comparison: { field: "comp", format: { style: "percent", showSign: true, decimals: 1 }, intent: "increase_is_good" as const },
                            icon: "Truck",
                            dateRange: "vs Previous Week",
                        },
                    },
                    {
                        id: "orders-revenue",
                        title: "Revenue",
                        data: async () => {
                            const stats = await fetchCollectionInsights("orders");
                            return { rows: [{ value: stats.revenue }] };
                        },
                        scorecard: {
                            value: { field: "value", format: { style: "currency", currency: "USD", notation: "compact", decimals: 1 } },
                        },
                    },
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
                            value: { field: "value", format: { style: "decimal" } },
                        },
                    },
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
                            value: { field: "value", format: { style: "decimal" } },
                        },
                    },
                ],
            },
        },
    }), [fetchHomeInsights, fetchCollectionInsights]);

    const insightsPlugin = useInsightsPlugin(insightsConfig);

    const collectionEditor = React.useMemo(() => ({
        getAuthToken: authController.getAuthToken
    }), [authController.getAuthToken]);

    const plugins: RebasePlugin[] = React.useMemo(
        () => [dataEnhancementPlugin, insightsPlugin],
        [dataEnhancementPlugin, insightsPlugin]
    );

    const entityViews = React.useMemo(() => [
        {
            key: "blog_preview",
            name: "Preview",
            Builder: BlogEntryPreview,
            position: "start" as const
        }
    ], []);

    return (
        <Rebase
            client={rebaseClient}
            authController={authController}
            plugins={plugins}
            onAnalyticsEvent={onAnalyticsEvent}
        >
            <RebaseAuth loginView={<DemoLoginView authController={authController} googleClientId={GOOGLE_CLIENT_ID}/>}/>
            <RebaseCMS
                collections={collections}
                collectionEditor={collectionEditor}
                entityViews={entityViews}
                plugins={plugins}
            />
            <RebaseStudio/>
            <RebaseShell title="Rebase"/>
        </Rebase>
    );
}
