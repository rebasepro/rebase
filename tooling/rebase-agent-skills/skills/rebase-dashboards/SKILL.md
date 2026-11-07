---
name: rebase-dashboards
description: How to add KPIs, charts and dashboards to a Rebase admin — headline figures with their change on the previous period, revenue over time, counts by status, top-N rankings — the same way in every project. Covers the SQL route that computes each number, `useInsightData`, the `KpiTile` / `TimeSeriesChart` / `BarChart` blocks from `@rebasepro/ui`, where to put them (home page, above a collection, a page of its own), and linking a chart to the records it counts. Use it whenever someone asks for metrics, analytics, a chart or a dashboard in the admin.
---

# Dashboards in the Rebase admin

A dashboard is three small pieces, written in the project, every time the same
way:

1. **A route that computes the numbers** — SQL in a backend function, run as
   the signed-in user. One route per figure record or per series.
2. **A component that loads the route and draws it**: `useInsightData` from
   `@rebasepro/plugin-insights` loads it, and the metric blocks from
   `@rebasepro/ui` draw it — `KpiTile`, `KpiReadout`, `KpiGrid`, `ChartCard`,
   `TimeSeriesChart`, `BarChart`.
3. **A place** for the component: `<Rebase slots>` or a page in
   `<RebaseCMS views>`.

There is no configuration object and no chart library to choose. Read the
installed packages for the props — they match the version in the project,
this skill may not: `useInsightData` in
`node_modules/@rebasepro/plugin-insights/README.md`, the blocks' props in their
types under `node_modules/@rebasepro/ui` (the "Metrics and charts" section of
the UI reference shows each one).

The Rebase repository's demo app is the complete reference: its
`app/backend/functions/insights.ts` (the routes) and
`app/frontend/src/InsightSlots.tsx` (the components and places).

## 1. Compute in SQL, on the server

Never pull rows into the browser to count them: a page of rows is not the
table, and the number is wrong past it. Write a backend function (see the
`rebase-custom-functions` skill) with `defineFunction` and `requireAuth` from
`@rebasepro/server/functions`, and answer each request with exactly what a
block draws:

- **A KPI record** — `{ revenue, previousRevenue, orders, previousOrders }`.
  Take the window from the request (`previousFrom`, `from`, `to` as ISO
  instants) rather than computing it on the server, so the figures describe
  the window the page labels. Compute the current and previous window in one
  query with `FILTER (WHERE …)`, and return each figure beside its
  `previous*` twin. Cap the window's length so one request cannot scan the
  table.
- **A series over time** — `[{ day: "2026-11-07", revenue, orders }]`, every
  day present: `generate_series` the days and `LEFT JOIN` the rows, so an
  empty day is zero rather than missing. Clip the first and last day to the
  window, so the days add up to the KPI.
- **Counts by category** — `{ pending: 6, shipped: 12 }` from a `GROUP BY`.
  Order and label them in the browser from the collection's enum.
- **A top N** — `[{ id, name, revenue }]`, `ORDER BY … DESC LIMIT 5`, with the
  record's id so a bar can open it.

`rebase.sql(text, { params })` runs it; convert `numeric` and `COUNT` results
with `Number(…)` before answering.

## 2. Load once, draw with the blocks

```tsx
import { useRebaseClient } from "@rebasepro/app";
import type { createRebaseClient } from "@rebasepro/client";
import { useInsightData } from "@rebasepro/plugin-insights";

type RebaseClient = ReturnType<typeof createRebaseClient>;
type DailyRow = { day: string; revenue: number };

/** The window the routes read: the last 30 days and the 30 before them. */
function windowQuery(): string {
    const to = Date.now();
    const from = to - 30 * 86_400_000;
    return new URLSearchParams({
        previousFrom: new Date(from - 30 * 86_400_000).toISOString(),
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString()
    }).toString();
}

function useDailyRevenue() {
    const client = useRebaseClient<RebaseClient>();
    return useInsightData("orders/daily", () => {
        if (!client) throw new Error("No Rebase client");
        return client.functions.invoke<DailyRow[]>("insights", undefined, { method: "GET", path: `orders/daily?${windowQuery()}` });
    });
}
```

`useInsightData(key, load)` loads once per key and signed-in user and shares
the result with every component reading that key, so the home page and a
collection showing the same figure make one request and agree. Name the key
after what the loader returns.

Pick the block by the job the number does:

| The reader needs | Block |
|---|---|
| One headline figure, maybe against the previous period | `KpiTile` (a card) or `KpiReadout` (one line, for a home-page card), in a `KpiGrid` with `periodDays` |
| How a measure moved over time | `TimeSeriesChart`, `variant="area"` for one series, `"line"` for several |
| Categories compared by size | `BarChart` — sorted when the ranking is the point, in the enum's order when the order means something (low → urgent) |
| Two measures of different scale | Two charts. Never a second y-axis. |
| More than eight series | Fold the tail into "Other", or a table |

Import the blocks from `@rebasepro/ui`:
`import { BarChart, ChartCard, KpiGrid, KpiTile, TimeSeriesChart } from "@rebasepro/ui";`.
Wrap each chart in a `ChartCard` with a short title. Pass `loading` and
`error` from `useInsightData` to every block: they draw their own pulse, error
and "no data" states, so nothing jumps when the numbers land. Pass number
formats as `Intl.NumberFormatOptions` (`{ style: "currency", currency: "USD" }`).

`KpiGrid` lays its tiles out by its own width, not the window's, so it is
right inside a split panel or a narrow frame. A child that spans columns says
so with container variants: `className="col-span-2 @4xl:col-span-3"`, never
`lg:`.

## 3. Put it in a place

| Where | Place | Notes |
|---|---|---|
| Top of the home page | `{ slot: "home.children.start", Component }` | |
| Above a collection's list | `{ slot: "collection.widgets", Component }` | Shown in list view. The component receives `collection`, `path` and `parentEntityIds`: check `collection.slug`, and return `null` when `parentEntityIds` is not empty — a figure for the whole table above one record's tab reads as that record's. |
| On a collection's home card | `{ slot: "home.card.widget", Component }` | Receives `slug`. Use `KpiReadout`. |
| A page of its own | `<RebaseCMS views={[{ slug, name, icon, view }]}>` | For a dashboard bigger than a row. |

Pass the slots as one module-level array, `<Rebase slots={insightSlots}>`, so
its identity is stable.

## 4. Link a chart to its records

A chart that counts records should open them. `BarChart`'s `onBarClick` makes
each row a button:

- **Open the list filtered to the bar**: navigate to the collection's URL with
  its filter in the query, `?<field>_op=%3D%3D&<field>_value=<value>` (repeat
  the pair per field; a date with `>=` keeps the window), via
  `useUrlController().buildUrlCollectionPath(path)` and `.navigate(url)`.
- **Open one record**: `useSidePanel().open({ path, entityId })`.

## Check it

- Every number on screen is computed by SQL on the server, as the user.
- The KPI and the series that explains it add up (sum the days).
- The bar counts equal the list each bar opens.
- Look at it in both themes and at phone width, and hover the chart.
