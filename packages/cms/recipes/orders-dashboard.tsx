/**
 * Recipe: a dashboard page — read data, draw it, link into the admin.
 *
 * A page of the admin is a React component on a route. It reads through
 * `useData()` (the same data layer, permissions and server callbacks as the
 * rest of the admin) and can draw with anything: this one uses plain divs so
 * it needs no chart library; swap in recharts or visx if you have one.
 *
 * Grouping happens in the browser, over the first `MAX_ROWS` rows, which is
 * right for a few thousand. The total is counted by the data source, so it
 * stays true past that, and the page says when the groups cover only part of
 * it. For more, add a custom function on the server that runs the `GROUP BY`
 * and call it from here instead.
 *
 * Each bar opens the collection filtered to its group — the filter rides in
 * the URL, as the collection writes it — through the admin's router.
 *
 * To use it: add `ordersDashboardView` to `<RebaseCMS views={[…]}>`. Change
 * `COLLECTION` / `GROUP_FIELD` to your own.
 */
import React, { useEffect, useState } from "react";
import type { AppView } from "@rebasepro/cms-types";
import { useData } from "@rebasepro/app";
import { useUrlController } from "@rebasepro/cms";
import { Card, CircularProgressCenter, Container, Typography } from "@rebasepro/ui";

const COLLECTION = "orders";
const GROUP_FIELD = "status";
const MAX_ROWS = 5000;

type Group = { value: string | null; count: number };

/** The collection's URL filtered to one value of `GROUP_FIELD`, as its toolbar writes it. */
function filteredUrl(collectionUrl: string, value: string | null): string {
    const op = encodeURIComponent("==");
    const encoded = value === null ? "null" : encodeURIComponent(value);
    return `${collectionUrl}?${GROUP_FIELD}_op=${op}&${GROUP_FIELD}_value=${encoded}`;
}

export function OrdersDashboard() {
    const data = useData();
    const urls = useUrlController();
    const [groups, setGroups] = useState<Group[] | undefined>();
    const [total, setTotal] = useState(0);
    const [error, setError] = useState<string | undefined>();

    useEffect(() => {
        let cancelled = false;
        const orders = data.collection(COLLECTION);
        // `count` is optional on an accessor: not every data source can count.
        Promise.all([orders.find({ limit: MAX_ROWS }), orders.count ? orders.count() : undefined])
            .then(([{ data: rows }, counted]) => {
                const counts = new Map<string | null, number>();
                for (const row of rows) {
                    const raw = row.values[GROUP_FIELD];
                    const value = raw === null || raw === undefined ? null : String(raw);
                    counts.set(value, (counts.get(value) ?? 0) + 1);
                }
                if (!cancelled) {
                    setTotal(Math.max(counted ?? 0, rows.length));
                    setGroups([...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count));
                }
            })
            .catch((e: unknown) => {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e));
            });
        return () => {
            cancelled = true;
        };
    }, [data]);

    if (error) return <Typography color={"error"} className={"p-8"}>{error}</Typography>;
    if (!groups) return <CircularProgressCenter/>;

    const grouped = groups.reduce((sum, g) => sum + g.count, 0);
    const max = Math.max(1, ...groups.map(g => g.count));
    const collectionUrl = urls.buildUrlCollectionPath(COLLECTION);

    return (
        <Container maxWidth={"4xl"} className={"py-8 flex flex-col gap-4"}>
            <Typography variant={"h4"}>Orders</Typography>
            <Card className={"p-4 flex flex-col gap-1"}>
                <Typography variant={"caption"} color={"secondary"}>Total</Typography>
                <Typography variant={"stat"}>{total}</Typography>
                {grouped < total && (
                    <Typography variant={"caption"} color={"secondary"}>
                        {`Grouped over the first ${grouped} of ${total} orders`}
                    </Typography>
                )}
            </Card>
            <Card className={"p-4 flex flex-col gap-3"}>
                <Typography variant={"subtitle2"}>By {GROUP_FIELD}</Typography>
                {groups.map(group => {
                    const href = filteredUrl(collectionUrl, group.value);
                    const label = group.value ?? "—";
                    return (
                        <a key={label}
                            href={href}
                            // The href is for "open in a new tab"; a plain
                            // click goes through the admin's router instead
                            // of reloading the page.
                            onClick={(event) => {
                                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                                event.preventDefault();
                                urls.navigate(href);
                            }}
                            aria-label={`${label}: ${group.count}`}
                            className={"grid grid-cols-[8rem_1fr_3rem] items-center gap-3 no-underline"}>
                            <Typography variant={"body2"}>{label}</Typography>
                            <div className={"h-3 rounded bg-primary/80"} style={{ width: `${(group.count / max) * 100}%` }}/>
                            <Typography variant={"body2"} align={"right"}>{group.count}</Typography>
                        </a>
                    );
                })}
            </Card>
        </Container>
    );
}

export const ordersDashboardView: AppView = {
    slug: "dashboards/orders",
    name: "Orders dashboard",
    icon: "ChartBar",
    view: <OrdersDashboard/>
};
