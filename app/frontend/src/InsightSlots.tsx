import React from "react";
import type { AdminCollection, AnySlotContribution, CollectionWidgetsSlotProps, HomeCardWidgetSlotProps } from "@rebasepro/cms-types";
import type { createRebaseClient } from "@rebasepro/client";
import type { FilterValues } from "@rebasepro/types";
import { resolveEnumValues } from "@rebasepro/common";
import { useAggregate, useRebaseClient, useRowCount } from "@rebasepro/app";
import { useSidePanel, useUrlController } from "@rebasepro/cms";
import { BarChart, ChartCard, KpiGrid, KpiReadout, KpiTile, TimeSeriesChart, type Bar, type KpiProps } from "@rebasepro/ui";
import { useInsightData, type InsightData } from "@rebasepro/plugin-insights";

/**
 * The demo's KPIs and charts, put in three places: the top of the home page,
 * above a collection's list, and on a collection's home card.
 *
 * Above a collection and on its home card, every figure is a count or a
 * grouped count the database computes as the signed-in user (`useRowCount`,
 * `useAggregate`), so the widgets work wherever the collection is drawn — in
 * the admin, and in the view Claude opens. The home page's revenue per day
 * and top products need SQL an aggregate cannot express (a day bucket, a sum
 * across order items), so the `insights` function computes those, one route
 * each, loaded with `useInsightData`. Everything is drawn with the metric
 * blocks from `@rebasepro/ui`.
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

// ── Above a collection's list, and on its home card ───────────────────

/** This window and the one before it, as ISO bounds, fixed for the life of the component. */
function useWindow(): { from: string; previousFrom: string } {
    const [bounds] = React.useState(() => {
        const from = Date.now() - PERIOD_DAYS * DAY_MS;
        return { from: new Date(from).toISOString(), previousFrom: new Date(from - PERIOD_DAYS * DAY_MS).toISOString() };
    });
    return bounds;
}

type Where = FilterValues<string>;

/** A count of rows: in this window and the one before it when `dateField` is set, of every row otherwise. */
interface CountKpi {
    id: string;
    label: string;
    collection: string;
    where: Where;
    dateField?: string;
    icon?: string;
}

/** What each collection shows above its list and on its home card. */
const COLLECTION_KPIS: Record<string, CountKpi[]> = {
    orders: [
        { id: "orders-confirmed", label: "Confirmed", collection: "orders", where: { status: ["==", "confirmed"] }, dateField: "order_date", icon: "CheckCircle" },
        { id: "orders-shipped", label: "Shipped", collection: "orders", where: { status: ["==", "shipped"] }, dateField: "order_date", icon: "Truck" }
    ],
    customers: [{ id: "customers-new", label: "New", collection: "customers", where: {}, dateField: "created_at", icon: "UserPlus" }],
    products: [{ id: "products-catalog", label: "Catalog", collection: "products", where: {} }],
    tickets: [{ id: "tickets-open", label: "Open", collection: "tickets", where: { status: ["==", "open"] }, icon: "Inbox" }]
};

function countProps(kpi: CountKpi, count: { count?: number; loading: boolean; error?: string }, previous?: number): KpiProps {
    return {
        label: kpi.label,
        value: count.count,
        previous,
        show: "absolute",
        periodDays: kpi.dateField ? PERIOD_DAYS : undefined,
        loading: count.loading,
        error: count.error ? new Error(count.error) : undefined
    };
}

function WindowedCount({ kpi, readout }: { kpi: CountKpi & { dateField: string }; readout?: boolean }) {
    const { from, previousFrom } = useWindow();
    const current = useRowCount(kpi.collection, { ...kpi.where, [kpi.dateField]: [">=", from] });
    const previous = useRowCount(kpi.collection, { ...kpi.where, [kpi.dateField]: [[">=", previousFrom], ["<", from]] });
    const props = countProps(kpi, current, previous.count);
    return readout ? <KpiReadout {...props}/> : <KpiTile icon={kpi.icon} {...props}/>;
}

function TotalCount({ kpi, readout }: { kpi: CountKpi; readout?: boolean }) {
    const props = countProps(kpi, useRowCount(kpi.collection, kpi.where));
    return readout ? <KpiReadout {...props}/> : <KpiTile icon={kpi.icon} {...props}/>;
}

function Count({ kpi, readout }: { kpi: CountKpi; readout?: boolean }) {
    const { dateField } = kpi;
    return dateField ? <WindowedCount kpi={{ ...kpi, dateField }} readout={readout}/> : <TotalCount kpi={kpi} readout={readout}/>;
}

/** One bar per option of an enum field, counted in the database. */
function useEnumBars(collection: AdminCollection, field: string, where: Where) {
    const groups = useAggregate(collection.slug, { select: [{ fn: "count" }], groupBy: [field], where });
    const counts = new Map((groups.result ?? []).map((row) => [String(row[field]), Number(row.count)]));
    return {
        bars: enumOptions(collection, field).map((option): Bar => ({ key: option.id, label: option.label, value: counts.get(option.id) ?? 0 })),
        loading: groups.loading,
        error: groups.error ? new Error(groups.error) : undefined
    };
}

/** Orders: this window's confirmed and shipped orders, and every status as bars that filter the list. */
function OrdersInsights({ path, collection }: CollectionWidgetsSlotProps) {
    const { from } = useWindow();
    const byStatus = useEnumBars(collection, "status", { order_date: [">=", from] });
    const urls = useUrlController();
    const filteredUrl = useFilteredCollectionUrl(path);

    return (
        <KpiGrid periodDays={PERIOD_DAYS} className="pb-4">
            <div className="col-span-2 @xl:col-span-1 flex flex-col gap-4">
                {COLLECTION_KPIS.orders.map((kpi) => <Count key={kpi.id} kpi={kpi}/>)}
            </div>
            <ChartCard title="Orders by status" icon="ChartBar" className="col-span-2 @4xl:col-span-3">
                <BarChart
                    bars={byStatus.bars.map((bar) => ({ ...bar, href: filteredUrl({ status: bar.key, order_date: new Date(from) }) }))}
                    loading={byStatus.loading}
                    error={byStatus.error}
                    onBarClick={(bar) => bar.href && urls.navigate(bar.href)}
                />
            </ChartCard>
        </KpiGrid>
    );
}

/** Tickets: how many are open, and the open ones by priority as bars that filter the list. */
function TicketsInsights({ path, collection }: CollectionWidgetsSlotProps) {
    const byPriority = useEnumBars(collection, "priority", { status: ["==", "open"] });
    const urls = useUrlController();
    const filteredUrl = useFilteredCollectionUrl(path);

    return (
        <KpiGrid className="pb-4">
            <div className="col-span-2 @xl:col-span-1 flex flex-col gap-4">
                {COLLECTION_KPIS.tickets.map((kpi) => <Count key={kpi.id} kpi={kpi}/>)}
            </div>
            <ChartCard title="Open tickets by priority" icon="ChartBar" className="col-span-2 @4xl:col-span-3">
                <BarChart
                    bars={byPriority.bars.map((bar) => ({ ...bar, href: filteredUrl({ status: "open", priority: bar.key }) }))}
                    loading={byPriority.loading}
                    error={byPriority.error}
                    onBarClick={(bar) => bar.href && urls.navigate(bar.href)}
                />
            </ChartCard>
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
    const kpis = COLLECTION_KPIS[slug];
    return (
        <KpiGrid periodDays={kpis.some((kpi) => kpi.dateField) ? PERIOD_DAYS : undefined} className="pb-4">
            {kpis.map((kpi) => <Count key={kpi.id} kpi={kpi}/>)}
        </KpiGrid>
    );
}

function CardInsights({ slug }: HomeCardWidgetSlotProps) {
    const kpis = COLLECTION_KPIS[slug];
    if (!kpis) return null;
    return (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-1.5">
            {kpis.map((kpi) => <Count key={kpi.id} kpi={kpi} readout/>)}
        </div>
    );
}

/** Where the KPIs and charts go: pass to `<Rebase slots={insightSlots}>`. */
export const insightSlots: AnySlotContribution[] = [
    { slot: "home.children.start", Component: HomeInsights, order: 10 },
    { slot: "collection.widgets", Component: CollectionInsights, order: 10 },
    { slot: "home.card.widget", Component: CardInsights, order: 10 }
];
