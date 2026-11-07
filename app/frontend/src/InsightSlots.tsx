import React, { useEffect, useState } from "react";
import type { AnySlotContribution, CollectionWidgetsSlotProps, HomeCardWidgetSlotProps } from "@rebasepro/cms-types";
import type { createRebaseClient } from "@rebasepro/client";
import { getIcon, useAuthController, useRebaseClient, useTranslation } from "@rebasepro/app";
import { cls, defaultBorderMixin, Tooltip, Typography } from "@rebasepro/ui";

/**
 * The demo's KPIs: four figures at the top of the home page, and a few per
 * collection, shown above its list and on its home card.
 *
 * Each figure is computed on the server by the `insights` function, one route
 * per source, as the signed-in user. The components here only fetch a record
 * of figures and draw it, so a figure is added by adding a column to a route's
 * query and an entry to the lists below.
 */

type RebaseClient = ReturnType<typeof createRebaseClient>;
type Figures = Record<string, number>;
type Source = "orders" | "customers" | "products" | "tickets";

/** The comparison window: the last `PERIOD_DAYS` days against the ones before them. */
const PERIOD_DAYS = 30;
const DAY_MS = 86_400_000;
/** How long a fetched record is reused, so the home row and a card share one request. */
const TTL_MS = 120_000;

/** Sources whose figures are counted over the window, and so take one. */
const WINDOWED: Record<Source, boolean> = { orders: true, customers: true, products: false, tickets: false };

interface Kpi {
    id: string;
    title: string;
    /** The field of the source's record holding the figure. */
    field: string;
    icon?: string;
    format?: Intl.NumberFormatOptions;
    /** The field holding the same figure over the previous window. */
    previous?: string;
    /** Which direction of change is good news. */
    goodWhen?: "up" | "down";
    /** Write the change as a percentage (the default) or as the difference. */
    show?: "percent" | "absolute";
}

const HOME: { source: Source; kpis: Kpi[] } = {
    source: "orders",
    kpis: [
        {
            id: "total-revenue",
            title: "Total Revenue",
            field: "revenue",
            icon: "DollarSign",
            format: { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 },
            previous: "previousRevenue",
            goodWhen: "up"
        },
        { id: "total-orders", title: "Orders", field: "orders", icon: "ShoppingCart", previous: "previousOrders", goodWhen: "up" },
        {
            id: "avg-order-value",
            title: "Avg. Order Value",
            field: "avgOrderValue",
            icon: "TrendingUp",
            format: { style: "currency", currency: "USD" },
            previous: "previousAvgOrderValue",
            goodWhen: "up"
        },
        {
            id: "refunded-orders",
            title: "Refunded Orders",
            field: "refunded",
            icon: "PackageX",
            previous: "previousRefunded",
            goodWhen: "down",
            show: "absolute"
        }
    ]
};

/** KPIs by collection slug, shown above the collection's list and on its home card. */
const COLLECTIONS: Record<string, { source: Source; kpis: Kpi[] }> = {
    orders: {
        source: "orders",
        kpis: [
            { id: "orders-confirmed", title: "Confirmed", field: "confirmed", icon: "CheckCircle", previous: "previousConfirmed", goodWhen: "up", show: "absolute" },
            { id: "orders-shipped", title: "Shipped", field: "shipped", icon: "Truck", previous: "previousShipped", goodWhen: "up", show: "absolute" }
        ]
    },
    customers: {
        source: "customers",
        kpis: [
            { id: "customers-new", title: "New", field: "newCustomers", icon: "UserPlus", previous: "previousNewCustomers", goodWhen: "up", show: "absolute" }
        ]
    },
    products: { source: "products", kpis: [{ id: "products-catalog", title: "Catalog", field: "total" }] },
    tickets: { source: "tickets", kpis: [{ id: "tickets-open", title: "Open", field: "open" }] }
};

// ── Fetching ──────────────────────────────────────────────────────────

/**
 * Fetches in flight or done, by user and source. The user is part of the key:
 * figures are computed under the permissions of whoever asked, and this cache
 * outlives a sign-out.
 */
const cache = new Map<string, { at: number; figures: Promise<Figures> }>();

function loadFigures(client: RebaseClient, userId: string | null, source: Source): Promise<Figures> {
    const key = JSON.stringify([userId, source]);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.figures;

    const to = Date.now();
    const from = to - PERIOD_DAYS * DAY_MS;
    const window = new URLSearchParams({
        previousFrom: new Date(from - PERIOD_DAYS * DAY_MS).toISOString(),
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString()
    });
    const path = WINDOWED[source] ? `${source}?${window}` : source;
    const figures = client.functions.invoke<Figures>("insights", undefined, { method: "GET", path });

    cache.set(key, { at: to, figures });
    // A failed fetch is retried by the next reader rather than served for the TTL.
    figures.catch(() => {
        if (cache.get(key)?.figures === figures) cache.delete(key);
    });
    return figures;
}

/** The source's figures for the signed-in user. */
function useFigures(source: Source): { figures?: Figures; error?: Error } {
    const client = useRebaseClient<RebaseClient>();
    const userId = useAuthController().user?.uid ?? null;
    const key = JSON.stringify([userId, source]);
    const [state, setState] = useState<{ key: string; figures?: Figures; error?: Error }>();

    useEffect(() => {
        if (!client) return;
        let cancelled = false;
        loadFigures(client, userId, source).then(
            (figures) => {
                if (!cancelled) setState({ key, figures });
            },
            (error: unknown) => {
                if (!cancelled) setState({ key, error: error instanceof Error ? error : new Error(String(error)) });
            }
        );
        return () => {
            cancelled = true;
        };
    }, [client, userId, source, key]);

    // A record fetched for another user or source is not this one's.
    return state?.key === key ? state : {};
}

// ── Formatting ────────────────────────────────────────────────────────

/** A number formatter in the admin's language, or the browser's when `Intl` does not take that tag. */
function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
    try {
        return new Intl.NumberFormat(locale, options);
    } catch {
        return new Intl.NumberFormat(undefined, options);
    }
}

/**
 * The change from `previous` to `current`, unsigned: the direction carries the
 * sign. A change from zero has no percentage, so it is written as the difference.
 */
function describeChange(current: number, previous: number, kpi: Kpi, locale: string): {
    direction: "up" | "down" | "flat";
    tone: keyof typeof toneClasses;
    magnitude: string;
} {
    const delta = current - previous;
    const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const tone = direction === "flat" ? "neutral" : direction === kpi.goodWhen ? "positive" : "negative";

    if (kpi.show !== "absolute" && previous !== 0) {
        const ratio = Math.abs(delta / previous);
        const decimals = ratio < 0.1 ? 1 : 0;
        const magnitude = numberFormat(locale, { style: "percent", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(ratio);
        return { direction, tone, magnitude };
    }
    return { direction, tone, magnitude: numberFormat(locale, kpi.format ?? {}).format(Math.abs(delta)) };
}

const toneClasses = {
    // The kit's success hue a step darker in light mode: emerald-600 on the card is under 4.5:1.
    positive: "text-emerald-700 dark:text-emerald-400",
    negative: "text-red-600 dark:text-red-500",
    neutral: "text-text-secondary dark:text-text-secondary-dark"
};

// ── Drawing ───────────────────────────────────────────────────────────

/** A pulsing bar standing in for a figure that has not arrived. */
function Placeholder({ className }: { className: string }) {
    return <span className={cls("inline-block align-middle rounded-sm bg-surface-200 dark:bg-surface-700 animate-pulse", className)}/>;
}

/** The change on the previous window: an arrow and its size, coloured by whether it is good news. */
function Change({ kpi, figures, tooltip }: { kpi: Kpi; figures: Figures; tooltip: boolean }) {
    const { t, i18n } = useTranslation();
    const current = figures[kpi.field];
    const previous = kpi.previous ? figures[kpi.previous] : undefined;
    if (typeof current !== "number" || typeof previous !== "number") return null;

    const change = describeChange(current, previous, kpi, i18n.language);
    const arrow = change.direction === "up" ? "↑ " : change.direction === "down" ? "↓ " : "";
    const spoken = change.direction === "up"
        ? t("insights_change_up", { change: change.magnitude })
        : change.direction === "down"
            ? t("insights_change_down", { change: change.magnitude })
            : t("insights_change_none");
    const previousLabel = t("insights_previous_period_value", {
        count: PERIOD_DAYS,
        value: numberFormat(i18n.language, kpi.format ?? {}).format(previous)
    });

    const label = (
        <span className={cls("typography-mono text-xs font-medium whitespace-nowrap", toneClasses[change.tone])}>
            <span aria-hidden="true">{arrow + change.magnitude}</span>
            <span className="sr-only">{`${spoken}. ${previousLabel}`}</span>
        </span>
    );
    return tooltip ? <Tooltip title={previousLabel}>{label}</Tooltip> : label;
}

function formatFigure(figures: Figures | undefined, kpi: Kpi, locale: string): string {
    const value = figures?.[kpi.field];
    return typeof value === "number" ? numberFormat(locale, kpi.format ?? {}).format(value) : "—";
}

/** One KPI as a card. The label renders before the figures arrive, so nothing moves when they do. */
function KpiTile({ kpi, figures, error }: { kpi: Kpi; figures?: Figures; error?: Error }) {
    const { i18n } = useTranslation();
    const loading = !figures && !error;
    const icon = kpi.icon ? getIcon(kpi.icon, "text-text-secondary dark:text-text-secondary-dark", undefined, 14) : null;

    return (
        <div className={cls("@container rounded-xl bg-surface-card border min-w-0", defaultBorderMixin)}>
            <div className="flex flex-col min-w-0 h-full px-5 py-4 @max-[200px]:px-3.5 @max-[200px]:py-3">
                <div className="flex items-center gap-1.5 min-w-0 mb-2.5 @max-[200px]:mb-1">
                    {icon && <span className="shrink-0 flex items-center [&>svg]:size-3.5">{icon}</span>}
                    <Typography variant="micro" color="secondary" className="truncate">{kpi.title}</Typography>
                </div>
                <div className="typography-stat leading-tight break-all text-text-primary dark:text-text-primary-dark @max-[200px]:text-xl">
                    {loading ? <Placeholder className="h-[0.8em] w-24"/> : formatFigure(figures, kpi, i18n.language)}
                </div>
                {error
                    ? <Typography variant="caption" color="error" className="block mt-1 truncate" title={error.message}>{error.message}</Typography>
                    : kpi.previous && (
                        <div className="mt-1 leading-4">
                            {figures ? <Change kpi={kpi} figures={figures} tooltip={true}/> : <Placeholder className="h-3 w-12"/>}
                        </div>
                    )}
            </div>
        </div>
    );
}

/** A row of KPI cards, under the window they compare when any of them does. */
function KpiRow({ source, kpis, className }: { source: Source; kpis: Kpi[]; className?: string }) {
    const { t } = useTranslation();
    const { figures, error } = useFigures(source);

    return (
        <section className={cls("w-full", className)}>
            {kpis.some((kpi) => kpi.previous) && (
                <Typography variant="micro" color="secondary" component="h2" className="block py-1 mb-4">
                    {t("insights_period_last_days", { count: PERIOD_DAYS })}
                </Typography>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {kpis.map((kpi) => <KpiTile key={kpi.id} kpi={kpi} figures={figures} error={error}/>)}
            </div>
        </section>
    );
}

function HomeKpis() {
    return <KpiRow source={HOME.source} kpis={HOME.kpis} className="mt-6 pb-2"/>;
}

function CollectionKpis({ collection, parentEntityIds }: CollectionWidgetsSlotProps) {
    const entry = COLLECTIONS[collection.slug];
    // The figures are collection-wide, so they stay off a view scoped to a
    // parent record (one product's Orders tab), where they would read as that
    // record's.
    if (!entry || parentEntityIds.length > 0) return null;
    return <KpiRow source={entry.source} kpis={entry.kpis} className="pb-4"/>;
}

/** The collection's KPIs as one line of text readouts on its home card. */
function CardKpis({ slug }: HomeCardWidgetSlotProps) {
    const entry = COLLECTIONS[slug];
    if (!entry) return null;
    return <CardReadouts source={entry.source} kpis={entry.kpis}/>;
}

function CardReadouts({ source, kpis }: { source: Source; kpis: Kpi[] }) {
    const { i18n } = useTranslation();
    const { figures, error } = useFigures(source);

    return (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-1.5" title={error?.message}>
            {kpis.map((kpi) => (
                <div key={kpi.id} className="flex items-baseline gap-1.5 min-w-0">
                    <Typography variant="micro" color="secondary" className="truncate">{kpi.title}</Typography>
                    {!figures && !error
                        ? <Placeholder className="h-3 w-8"/>
                        : (
                            <span className="text-sm font-semibold tabular-nums text-text-primary dark:text-text-primary-dark">
                                {formatFigure(figures, kpi, i18n.language)}
                            </span>
                        )}
                    {figures && <Change kpi={kpi} figures={figures} tooltip={false}/>}
                </div>
            ))}
        </div>
    );
}

/** Where the KPIs go: pass to `<Rebase slots={insightSlots}>`. */
export const insightSlots: AnySlotContribution[] = [
    { slot: "home.children.start", Component: HomeKpis, order: 10 },
    { slot: "collection.widgets", Component: CollectionKpis, order: 10 },
    { slot: "home.card.widget", Component: CardKpis, order: 10 }
];
