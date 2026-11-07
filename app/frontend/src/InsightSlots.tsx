import React from "react";
import type { AdminCollection, AnySlotContribution, CollectionWidgetsSlotProps, HomeCardWidgetSlotProps } from "@rebasepro/cms-types";
import type { createRebaseClient } from "@rebasepro/client";
import { resolveEnumValues } from "@rebasepro/common";
import { useRebaseClient } from "@rebasepro/app";
import { useSidePanel, useUrlController } from "@rebasepro/cms";
import { BarChart, ChartCard, KpiGrid, KpiReadout, KpiTile, TimeSeriesChart, type Bar, type KpiProps } from "@rebasepro/ui";
import { useInsightData, type InsightData } from "@rebasepro/plugin-insights";

/**
 * The demo's KPIs and charts, put in three places: the top of the home page,
 * above a collection's list, and on a collection's home card.
 *
 * Every figure and series is computed on the server by the `insights`
 * function, one route each, as the signed-in user. The components here only
 * load a route with `useInsightData` and draw it with the metric blocks from
 * `@rebasepro/ui`.
 * To add a chart: a route that answers with its rows, a `useInsights` call,
 * and a chart where it belongs.
 */

type RebaseClient = ReturnType<typeof createRebaseClient>;
type Figures = Record<string, number>;
type DailyRow = { day: string; revenue: number; orders: number };
type TopProduct = { id: string | null; name: string; revenue: number };

/** The window: the last `PERIOD_DAYS` days, compared with the ones before them. */
const PERIOD_DAYS = 30;
const DAY_MS = 86_400_000;
/** How long a loaded route is reused, so the home row and a card share one request. */
const TTL_MS = 120_000;

const USD: Intl.NumberFormatOptions = { style: "currency", currency: "USD" };
const USD_COMPACT: Intl.NumberFormatOptions = { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 };
const USD_WHOLE: Intl.NumberFormatOptions = { style: "currency", currency: "USD", maximumFractionDigits: 0 };

/** The window as the `insights` function reads it, ending now. */
function windowStart(): Date {
    return new Date(Date.now() - PERIOD_DAYS * DAY_MS);
}

function windowQuery(): string {
    const to = Date.now();
    const from = to - PERIOD_DAYS * DAY_MS;
    return new URLSearchParams({
        previousFrom: new Date(from - PERIOD_DAYS * DAY_MS).toISOString(),
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString()
    }).toString();
}

/** One route of the `insights` function, loaded once per user and shared. */
function useInsights<T>(route: string, windowed: boolean): InsightData<T> {
    const client = useRebaseClient<RebaseClient>();
    return useInsightData<T>(route, () => {
        if (!client) throw new Error("No Rebase client");
        const path = windowed ? `${route}?${windowQuery()}` : route;
        return client.functions.invoke<T>("insights", undefined, { method: "GET", path });
    }, { ttl: TTL_MS });
}

interface Kpi extends Pick<KpiProps, "label" | "format" | "goodWhen" | "show"> {
    id: string;
    /** The field of the route's record holding the figure. */
    field: string;
    /** The field holding the same figure over the previous window. */
    previous?: string;
    icon?: string;
}

/** A KPI's tile props, read from its route's record. */
function figure(kpi: Kpi, { data, loading, error }: InsightData<Figures>): KpiProps {
    return {
        label: kpi.label,
        value: data?.[kpi.field],
        previous: kpi.previous ? data?.[kpi.previous] : undefined,
        format: kpi.format,
        goodWhen: kpi.goodWhen,
        show: kpi.show,
        periodDays: PERIOD_DAYS,
        loading,
        error
    };
}

const HOME_KPIS: Kpi[] = [
    { id: "total-revenue", label: "Total Revenue", field: "revenue", previous: "previousRevenue", icon: "DollarSign", format: USD_COMPACT },
    { id: "total-orders", label: "Orders", field: "orders", previous: "previousOrders", icon: "ShoppingCart" },
    { id: "avg-order-value", label: "Avg. Order Value", field: "avgOrderValue", previous: "previousAvgOrderValue", icon: "TrendingUp", format: USD },
    { id: "refunded-orders", label: "Refunded Orders", field: "refunded", previous: "previousRefunded", icon: "PackageX", goodWhen: "down", show: "absolute" }
];

/** KPIs by collection slug, with the route they read and whether it is windowed. */
const COLLECTION_KPIS: Record<string, { route: string; windowed: boolean; kpis: Kpi[] }> = {
    orders: {
        route: "orders",
        windowed: true,
        kpis: [
            { id: "orders-confirmed", label: "Confirmed", field: "confirmed", previous: "previousConfirmed", icon: "CheckCircle", show: "absolute" },
            { id: "orders-shipped", label: "Shipped", field: "shipped", previous: "previousShipped", icon: "Truck", show: "absolute" }
        ]
    },
    customers: {
        route: "customers",
        windowed: true,
        kpis: [{ id: "customers-new", label: "New", field: "newCustomers", previous: "previousNewCustomers", icon: "UserPlus", show: "absolute" }]
    },
    products: { route: "products", windowed: false, kpis: [{ id: "products-catalog", label: "Catalog", field: "total" }] },
    tickets: { route: "tickets", windowed: false, kpis: [{ id: "tickets-open", label: "Open", field: "open", icon: "Inbox" }] }
};

/** A string enum's options, in their declared order, as the collection labels them. */
function enumOptions(collection: AdminCollection, field: string): { id: string; label: string }[] {
    const property = collection.properties[field];
    if (!property || !("enum" in property) || !property.enum) return [];
    return (resolveEnumValues(property.enum) ?? []).map((option) => ({ id: String(option.id), label: option.label ?? String(option.id) }));
}

/** The collection's URL showing only the rows where every `field` equals its value (or, for a date, is on or after it). */
function useFilteredCollectionUrl(path: string) {
    const urls = useUrlController();
    return (filters: Record<string, string | Date>) => {
        const query = Object.entries(filters).flatMap(([field, value]) => [
            `${field}_op=${encodeURIComponent(value instanceof Date ? ">=" : "==")}`,
            `${field}_value=${encodeURIComponent(value instanceof Date ? value.toISOString() : value)}`
        ]).join("&");
        return `${urls.buildUrlCollectionPath(path)}?${query}`;
    };
}

// ── Home page ─────────────────────────────────────────────────────────

function HomeInsights() {
    const orders = useInsights<Figures>("orders", true);
    const daily = useInsights<DailyRow[]>("orders/daily", true);
    const top = useInsights<TopProduct[]>("products/top", true);
    const sidePanel = useSidePanel();

    const productBars: Bar[] = (top.data ?? []).map((product) => ({ key: product.id ?? `name:${product.name}`, label: product.name, value: product.revenue }));
    const productIds = new Set((top.data ?? []).flatMap((product) => (product.id ? [product.id] : [])));

    return (
        <div className="@container mt-6 pb-2 flex flex-col gap-4">
            <KpiGrid periodDays={PERIOD_DAYS}>
                {HOME_KPIS.map((kpi) => <KpiTile key={kpi.id} icon={kpi.icon} {...figure(kpi, orders)}/>)}
            </KpiGrid>
            <div className="grid grid-cols-1 @4xl:grid-cols-3 gap-4">
                <ChartCard title="Revenue per day" icon="ChartArea" className="@4xl:col-span-2">
                    <TimeSeriesChart
                        series={[{ id: "revenue", label: "Revenue", points: (daily.data ?? []).map((row) => ({ at: row.day, value: row.revenue })) }]}
                        format={USD}
                        height={220}
                        loading={daily.loading}
                        error={daily.error}
                    />
                </ChartCard>
                <ChartCard title="Top products by revenue" icon="Package">
                    <BarChart
                        bars={productBars}
                        format={USD_WHOLE}
                        loading={top.loading}
                        error={top.error}
                        onBarClick={(bar) => {
                            if (productIds.has(bar.key)) sidePanel.open({ path: "products", entityId: bar.key });
                        }}
                    />
                </ChartCard>
            </div>
        </div>
    );
}

// ── Above a collection's list ─────────────────────────────────────────

/** Orders: this window's confirmed and shipped orders, and every status as bars that filter the list. */
function OrdersInsights({ path, collection }: CollectionWidgetsSlotProps) {
    const { kpis } = COLLECTION_KPIS.orders;
    const orders = useInsights<Figures>("orders", true);
    const byStatus = useInsights<Figures>("orders/status", true);
    const urls = useUrlController();
    const filteredUrl = useFilteredCollectionUrl(path);

    const bars = enumOptions(collection, "status").map((status) => ({ key: status.id, label: status.label, value: byStatus.data?.[status.id] ?? 0 }));

    return (
        <KpiGrid periodDays={PERIOD_DAYS} className="pb-4">
            <div className="col-span-2 @xl:col-span-1 flex flex-col gap-4">
                {kpis.map((kpi) => <KpiTile key={kpi.id} icon={kpi.icon} {...figure(kpi, orders)}/>)}
            </div>
            <ChartCard title="Orders by status" icon="ChartBar" className="col-span-2 @4xl:col-span-3">
                <BarChart
                    bars={bars}
                    loading={byStatus.loading}
                    error={byStatus.error}
                    onBarClick={(bar) => urls.navigate(filteredUrl({ status: bar.key, order_date: windowStart() }))}
                />
            </ChartCard>
        </KpiGrid>
    );
}

/** Tickets: how many are open, and the open ones by priority as bars that filter the list. */
function TicketsInsights({ path, collection }: CollectionWidgetsSlotProps) {
    const { kpis } = COLLECTION_KPIS.tickets;
    const tickets = useInsights<Figures>("tickets", false);
    const byPriority = useInsights<Figures>("tickets/priority", false);
    const urls = useUrlController();
    const filteredUrl = useFilteredCollectionUrl(path);

    const bars = enumOptions(collection, "priority").map((priority) => ({ key: priority.id, label: priority.label, value: byPriority.data?.[priority.id] ?? 0 }));

    return (
        <KpiGrid className="pb-4">
            <div className="col-span-2 @xl:col-span-1 flex flex-col gap-4">
                {kpis.map((kpi) => <KpiTile key={kpi.id} icon={kpi.icon} {...figure(kpi, tickets)}/>)}
            </div>
            <ChartCard title="Open tickets by priority" icon="ChartBar" className="col-span-2 @4xl:col-span-3">
                <BarChart
                    bars={bars}
                    loading={byPriority.loading}
                    error={byPriority.error}
                    onBarClick={(bar) => urls.navigate(filteredUrl({ status: "open", priority: bar.key }))}
                />
            </ChartCard>
        </KpiGrid>
    );
}

/** A collection whose KPIs are figures alone. */
function CollectionKpis({ slug }: { slug: string }) {
    const { route, windowed, kpis } = COLLECTION_KPIS[slug];
    const figures = useInsights<Figures>(route, windowed);
    return (
        <KpiGrid periodDays={windowed ? PERIOD_DAYS : undefined} className="pb-4">
            {kpis.map((kpi) => <KpiTile key={kpi.id} icon={kpi.icon} {...figure(kpi, figures)}/>)}
        </KpiGrid>
    );
}

function CollectionInsights(props: CollectionWidgetsSlotProps) {
    const slug = props.collection.slug;
    // The figures are collection-wide, so they stay off a view scoped to a
    // parent record (one customer's Orders tab), where they would read as
    // that record's.
    if (!(slug in COLLECTION_KPIS) || props.parentEntityIds.length > 0) return null;
    if (slug === "orders") return <OrdersInsights {...props}/>;
    if (slug === "tickets") return <TicketsInsights {...props}/>;
    return <CollectionKpis slug={slug}/>;
}

// ── On a collection's home card ───────────────────────────────────────

function CardReadouts({ slug }: { slug: string }) {
    const { route, windowed, kpis } = COLLECTION_KPIS[slug];
    const figures = useInsights<Figures>(route, windowed);
    return (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-1.5">
            {kpis.map((kpi) => <KpiReadout key={kpi.id} {...figure(kpi, figures)}/>)}
        </div>
    );
}

function CardInsights({ slug }: HomeCardWidgetSlotProps) {
    return slug in COLLECTION_KPIS ? <CardReadouts slug={slug}/> : null;
}

/** Where the KPIs and charts go: pass to `<Rebase slots={insightSlots}>`. */
export const insightSlots: AnySlotContribution[] = [
    { slot: "home.children.start", Component: HomeInsights, order: 10 },
    { slot: "collection.widgets", Component: CollectionInsights, order: 10 },
    { slot: "home.card.widget", Component: CardInsights, order: 10 }
];
