/**
 * Recipe: a dashboard page — read data, draw it, link into the admin.
 *
 * A page of the admin is a React component on a route. It reads through
 * `useData()` (the same data layer, permissions and server callbacks as the
 * rest of the admin) and can draw with anything: this one uses plain divs so
 * it needs no chart library; swap in recharts or visx if you have one.
 *
 * Grouping happens in the browser, which is right for a few thousand rows.
 * For more, add a custom function on the server that runs the `GROUP BY` and
 * call it from here instead.
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

type Group = { value: string; count: number };

export function OrdersDashboard() {
    const data = useData();
    const urls = useUrlController();
    const [groups, setGroups] = useState<Group[] | undefined>();
    const [error, setError] = useState<string | undefined>();

    useEffect(() => {
        let cancelled = false;
        data.collection(COLLECTION).find({ limit: MAX_ROWS })
            .then(({ data: rows }) => {
                const counts = new Map<string, number>();
                for (const row of rows) {
                    const value = String(row.values[GROUP_FIELD] ?? "—");
                    counts.set(value, (counts.get(value) ?? 0) + 1);
                }
                if (!cancelled) {
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

    const total = groups.reduce((sum, g) => sum + g.count, 0);
    const max = Math.max(1, ...groups.map(g => g.count));

    return (
        <Container maxWidth={"4xl"} className={"py-8 flex flex-col gap-4"}>
            <Typography variant={"h4"}>Orders</Typography>
            <Card className={"p-4 flex flex-col gap-1"}>
                <Typography variant={"caption"} color={"secondary"}>Total</Typography>
                <Typography variant={"stat"}>{total}</Typography>
            </Card>
            <Card className={"p-4 flex flex-col gap-3"}>
                <Typography variant={"subtitle2"}>By {GROUP_FIELD}</Typography>
                {groups.map(group => (
                    <a key={group.value}
                        href={urls.buildUrlCollectionPath(COLLECTION)}
                        aria-label={`${group.value}: ${group.count}`}
                        className={"grid grid-cols-[8rem_1fr_3rem] items-center gap-3 no-underline"}>
                        <Typography variant={"body2"}>{group.value}</Typography>
                        <div className={"h-3 rounded bg-primary/80"} style={{ width: `${(group.count / max) * 100}%` }}/>
                        <Typography variant={"body2"} align={"right"}>{group.count}</Typography>
                    </a>
                ))}
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
