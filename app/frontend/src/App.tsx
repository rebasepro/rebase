import React from "react";
import "@fontsource/jetbrains-mono";
import "@fontsource/rubik";
import type { AnalyticsEvent } from "@rebasepro/types";

// Global gtag function injected by the GA4 script in index.html
declare function gtag(...args: any[]): void;

import { useRebaseAuthController, useBackendUserManagement } from "@rebasepro/auth";
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

    const userManagement = useBackendUserManagement({
        client: rebaseClient,
        currentUser: authController.user
    });

    const dataEnhancementPlugin = useDataEnhancementPlugin();

    // ── Insights Plugin ──────────────────────────────────────────────
    // Each insight widget has its own `data()` callback using the
    // existing Rebase client SDK — no custom backend endpoint needed.
    //
    // NOTE: `collection.find()` returns `Entity[]` where each entity
    // wraps data in `.values`. We extract `.values` for aggregation.

    // Inflight dedup for insight data calls — widgets with identical
    // queries (e.g. three widgets all fetching orders with limit 500)
    // share a single network request instead of firing separately.
    const insightFetchCache = React.useMemo(() => new Map<string, Promise<any>>(), []);

    const cachedFind = React.useCallback((collection: string, params: Record<string, unknown> = {}) => {
        const key = `${collection}:${JSON.stringify(params)}`;
        if (!insightFetchCache.has(key)) {
            const promise = rebaseClient.data.collection(collection).find(params)
                .finally(() => {
                    // Clear after a short window so co-occurring widgets share the request
                    setTimeout(() => insightFetchCache.delete(key), 200);
                });
            insightFetchCache.set(key, promise);
        }
        return insightFetchCache.get(key)!;
    }, [rebaseClient, insightFetchCache]);

    const insightsConfig = React.useMemo<InsightsPluginConfig>(() => ({
        cacheTTL: 120_000,
        insights: {
            home: [
                {
                    id: "total-revenue",
                    title: "Total Revenue",
                    data: async () => {
                        const res = await cachedFind("orders", { limit: 500 });
                        const total = res.data.reduce((sum: number, e: any) => sum + (Number(e.values?.total) || 0), 0);
                        const diff = 0.15; // Mock comparison +15%
                        return { rows: [{ value: total, comp: diff }] };
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
                        const res = await cachedFind("orders", { limit: 1 });
                        const diff = 0.124; // Mock comparison +12.4%
                        return { rows: [{ value: res.meta.total, comp: diff }] };
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
                        const res = await cachedFind("orders", { limit: 500 });
                        const total = res.data.reduce((sum: number, e: any) => sum + (Number(e.values?.total) || 0), 0);
                        const avg = res.data.length > 0 ? total / res.data.length : 0;
                        const diff = -0.052; // Mock comparison -5.2%
                        return { rows: [{ value: avg, comp: diff }] };
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
                        const res = await cachedFind("orders", {
                            limit: 1,
                            where: { status: "eq.refunded" },
                        });
                        const diff = 0.021; // Mock comparison +2.1%
                        return { rows: [{ value: res.meta.total, comp: diff }] };
                    },
                    scorecard: {
                        value: { field: "value", format: { style: "decimal" } },
                        comparison: { field: "comp", format: { style: "percent", showSign: true, decimals: 1 }, intent: "decrease_is_good" },
                        icon: "PackageX",
                        dateRange: "vs Previous 30 Days",
                    },
                },
            ],

            // ── Collection-level insights ───────────────────────────
            // Scorecards are auto-extracted for the home page cards
            // and rendered inline in the collection list view.
            collections: {
                orders: [
                    {
                        id: "orders-confirmed-count",
                        title: "Confirmed",
                        data: async (context) => {
                            if (context?.path && context.path !== "orders") {
                                return { rows: [] }; // Filtering by join table not supported in demo yet
                            }
                            const res = await cachedFind("orders", { limit: 1, where: { status: "eq.confirmed" } });
                            return { rows: [{ value: res.meta.total, comp: 0.18 }] };
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
                        data: async (context) => {
                            if (context?.path && context.path !== "orders") {
                                return { rows: [] };
                            }
                            const res = await cachedFind("orders", { limit: 1, where: { status: "eq.shipped" } });
                            return { rows: [{ value: res.meta.total, comp: 0.074 }] };
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
                        data: async (context) => {
                            if (context?.path && context.path !== "orders") {
                                return { rows: [] };
                            }
                            const res = await cachedFind("orders", { limit: 500 });
                            const total = res.data.reduce((sum: number, e: any) => sum + (Number(e.values?.total) || 0), 0);
                            return { rows: [{ value: total }] };
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
                            const res = await cachedFind("products", { limit: 1 });
                            return { rows: [{ value: res.meta.total }] };
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
                            const res = await cachedFind("tickets", {
                                limit: 1,
                                where: { status: "eq.open" },
                            });
                            return { rows: [{ value: res.meta.total }] };
                        },
                        scorecard: {
                            value: { field: "value", format: { style: "decimal" } },
                        },
                    },
                ],
            },
        },
    }), [cachedFind]);

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
            userManagement={userManagement}
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
