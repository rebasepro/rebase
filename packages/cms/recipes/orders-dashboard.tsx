/**
 * Recipe: a dashboard page — count, group, chart, link into the admin.
 *
 * A page of the admin is a React component on a route. This one asks the data
 * source for two numbers rather than reading rows: `useRowCount` for the
 * total and `useAggregate` for a `count` per status, grouped and sorted by
 * the database. Both are true however many orders there are, and both follow
 * every write to the collection made in the admin.
 *
 * It draws with the metric blocks of `@rebasepro/ui` — `KpiGrid` / `KpiTile`
 * for the figure, `ChartCard` / `BarChart` for the groups — which are what the
 * admin's own dashboards are drawn with, in its tokens and dark mode. Each
 * bar opens the collection filtered to its group, the filter in the URL as
 * the collection's toolbar writes it, through the admin's router.
 *
 * Aggregates need a data source that computes them: Postgres through the
 * server does. Where one cannot, the chart says so in place of the bars.
 *
 * To use it: add `ordersDashboardView` to `<RebaseCMS views={[…]}>`. Change
 * `COLLECTION` / `GROUP_FIELD` to your own.
 */
import React from "react";
import type { AppView } from "@rebasepro/cms-types";
import { useAggregate, useRowCount } from "@rebasepro/app";
import { useUrlController } from "@rebasepro/cms";
import { BarChart, ChartCard, Container, KpiGrid, KpiTile, Typography } from "@rebasepro/ui";
import type { Bar } from "@rebasepro/ui";

const COLLECTION = "orders";
const GROUP_FIELD = "status";

/** The bar of the rows with no value in `GROUP_FIELD`; a bar's key is its value otherwise. */
const NO_VALUE = "\u0000none";

/** The collection's URL filtered to one value of `GROUP_FIELD`, as its toolbar writes it. */
function filteredUrl(collectionUrl: string, value: string | null): string {
    const op = encodeURIComponent("==");
    const encoded = value === null ? "null" : encodeURIComponent(value);
    return `${collectionUrl}?${GROUP_FIELD}_op=${op}&${GROUP_FIELD}_value=${encoded}`;
}

/** The hooks report a failure as its message; the blocks take an `Error`. */
function asError(message: string | undefined): Error | undefined {
    return message === undefined ? undefined : new Error(message);
}

export function OrdersDashboard() {
    const urls = useUrlController();
    const total = useRowCount(COLLECTION);
    // One row per status, `{ status, count }`, largest first. Over HTTP a
    // grouped aggregate returns 50 groups unless `limit` asks for more.
    const groups = useAggregate(COLLECTION, {
        select: [{ fn: "count" }],
        groupBy: [GROUP_FIELD],
        orderBy: ["count", "desc"]
    });

    const bars: Bar[] = (groups.result ?? []).map(row => {
        const value = row[GROUP_FIELD];
        return {
            key: value === null || value === undefined ? NO_VALUE : String(value),
            label: value === null || value === undefined ? "—" : String(value),
            value: Number(row.count)
        };
    });

    const openGroup = (bar: Bar) =>
        urls.navigate(filteredUrl(urls.buildUrlCollectionPath(COLLECTION), bar.key === NO_VALUE ? null : bar.key));

    return (
        <Container maxWidth={"4xl"} className={"py-8 flex flex-col gap-4"}>
            <Typography variant={"h4"}>Orders</Typography>
            <KpiGrid>
                <KpiTile label={"Total"} icon={"ShoppingCart"}
                    value={total.count}
                    loading={total.loading}
                    error={asError(total.error)}/>
            </KpiGrid>
            <ChartCard title={`By ${GROUP_FIELD}`} icon={"ChartBar"}>
                <BarChart bars={bars}
                    loading={groups.loading}
                    error={asError(groups.error)}
                    onBarClick={openGroup}/>
            </ChartCard>
        </Container>
    );
}

export const ordersDashboardView: AppView = {
    slug: "dashboards/orders",
    name: "Orders dashboard",
    icon: "ChartBar",
    view: <OrdersDashboard/>
};
