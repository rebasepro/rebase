import React from "react";
import "@fontsource/jetbrains-mono";
import "typeface-rubik";

import { useRebaseAuthController, useBackendUserManagement, RebaseAuth } from "@rebasepro/auth";
import { Rebase } from "@rebasepro/core";
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
    const insightsConfig = React.useMemo<InsightsPluginConfig>(() => ({
        cacheTTL: 120_000,
        insights: {
            home: [
                // ── Scorecards ──────────────────────────────────────
                {
                    id: "total-revenue",
                    title: "Total Revenue",
                    type: "scorecard",
                    data: async () => {
                        const res = await rebaseClient.data.collection("orders").find({ limit: 500 });
                        const total = res.data.reduce((sum: number, e) => sum + (Number(e.values?.total) || 0), 0);
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
                    type: "scorecard",
                    data: async () => {
                        const res = await rebaseClient.data.collection("orders").find({ limit: 1 });
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
                    type: "scorecard",
                    data: async () => {
                        const res = await rebaseClient.data.collection("orders").find({ limit: 500 });
                        const total = res.data.reduce((sum: number, e) => sum + (Number(e.values?.total) || 0), 0);
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
                    type: "scorecard",
                    data: async () => {
                        const res = await rebaseClient.data.collection("orders").find({
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

                // ── Charts ──────────────────────────────────────────
                {
                    id: "orders-by-status",
                    title: "Orders by Status",
                    type: "chart",
                    data: async () => {
                        const res = await rebaseClient.data.collection("orders").find({ limit: 500 });
                        const counts: Record<string, number> = {};
                        for (const e of res.data) {
                            const status = String(e.values?.status || "unknown");
                            counts[status] = (counts[status] || 0) + 1;
                        }
                        return {
                            rows: Object.entries(counts).map(([status, count]) => ({ status, count })),
                        };
                    },
                    chart: {
                        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
                        mark: { type: "bar", cornerRadiusEnd: 4 },
                        encoding: {
                            x: { field: "status", type: "nominal", axis: { title: null, labelAngle: 0 }, sort: "-y" },
                            y: { field: "count", type: "quantitative", axis: { title: null, grid: true } },
                            color: { field: "status", type: "nominal", legend: null },
                            tooltip: [
                                { field: "status", type: "nominal", title: "Status" },
                                { field: "count", type: "quantitative", title: "Orders" }
                            ],
                        },
                    },
                },
                {
                    id: "revenue-by-status",
                    title: "Revenue by Status",
                    type: "chart",
                    data: async () => {
                        const res = await rebaseClient.data.collection("orders").find({ limit: 500 });
                        const sums: Record<string, number> = {};
                        for (const e of res.data) {
                            const status = String(e.values?.status || "unknown");
                            sums[status] = (sums[status] || 0) + (Number(e.values?.total) || 0);
                        }
                        return {
                            rows: Object.entries(sums).map(([status, revenue]) => ({ status, revenue: Math.round(revenue) })),
                        };
                    },
                    chart: {
                        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
                        mark: { type: "arc", innerRadius: 50 },
                        encoding: {
                            theta: { field: "revenue", type: "quantitative", stack: true },
                            color: { field: "status", type: "nominal", legend: { orient: "right" } },
                            tooltip: [
                                { field: "status", type: "nominal" },
                                { field: "revenue", type: "quantitative", format: "$," },
                            ],
                        },
                    },
                },
            ],

            // ── Collection-level insights ───────────────────────────
            collections: {
                orders: [
                    {
                        id: "orders-daily-trend",
                        title: "Daily Orders",
                        type: "chart",
                        data: async () => {
                            const res = await rebaseClient.data.collection("orders").find({ limit: 500 });
                            const byDay: Record<string, number> = {};
                            for (const e of res.data) {
                                const d = String(e.values?.order_date || e.values?.created_at || "").slice(0, 10);
                                if (d) byDay[d] = (byDay[d] || 0) + 1;
                            }
                            return {
                                rows: Object.entries(byDay)
                                    .sort(([a], [b]) => a.localeCompare(b))
                                    .slice(-30)
                                    .map(([date, count]) => ({ date, count })),
                            };
                        },
                        chart: {
                            $schema: "https://vega.github.io/schema/vega-lite/v5.json",
                            mark: { type: "area", line: true, opacity: 0.3, interpolate: "monotone" },
                            encoding: {
                                x: { field: "date", type: "temporal", axis: { title: null, format: "%b %d" } },
                                y: { field: "count", type: "quantitative", axis: { title: null } },
                                tooltip: [
                                    { field: "date", type: "temporal", title: "Date", format: "%b %d, %Y" },
                                    { field: "count", type: "quantitative", title: "Orders" }
                                ],
                            },
                        },
                    },
                ],
            },

            // ── Inline card widgets ─────────────────────────────────
            cards: {
                orders: [
                    {
                        id: "card-orders-count",
                        title: "Total",
                        type: "scorecard",
                        data: async () => {
                            const res = await rebaseClient.data.collection("orders").find({ limit: 1 });
                            return { rows: [{ value: res.meta.total }] };
                        },
                        scorecard: {
                            value: { field: "value", format: { style: "decimal" } },
                        },
                    },
                    {
                        id: "card-orders-revenue",
                        title: "Revenue",
                        type: "scorecard",
                        data: async () => {
                            const res = await rebaseClient.data.collection("orders").find({ limit: 500 });
                            const total = res.data.reduce((sum: number, e) => sum + (Number(e.values?.total) || 0), 0);
                            return { rows: [{ value: total }] };
                        },
                        scorecard: {
                            value: { field: "value", format: { style: "currency", currency: "USD", notation: "compact", decimals: 1 } },
                        },
                    },
                ],
                products: [
                    {
                        id: "card-products-count",
                        title: "Catalog",
                        type: "scorecard",
                        data: async () => {
                            const res = await rebaseClient.data.collection("products").find({ limit: 1 });
                            return { rows: [{ value: res.meta.total }] };
                        },
                        scorecard: {
                            value: { field: "value", format: { style: "decimal" } },
                        },
                    },
                ],
                tickets: [
                    {
                        id: "card-tickets-open",
                        title: "Open",
                        type: "scorecard",
                        data: async () => {
                            const res = await rebaseClient.data.collection("tickets").find({
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
    }), [rebaseClient]);

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
        >
            <RebaseAuth loginView={<DemoLoginView authController={authController} googleEnabled={true} googleClientId={GOOGLE_CLIENT_ID}/>}/>
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
