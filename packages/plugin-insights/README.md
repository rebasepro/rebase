# @rebasepro/plugin-insights

KPI tiles and charts for the Rebase admin panel, as components you put where
you want them.

## Installation

```bash
pnpm add @rebasepro/plugin-insights
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. It needs Node `>=22.22.0` (its `engines` floor), where `require()`
of it resolves too: Node has supported `require(esm)` since 22.12.

**Peer dependencies:** `react ^19.2.7`, `react-dom ^19.2.7`

## What This Package Does

It draws figures — revenue, orders, open tickets — and the series behind them,
in the admin's own card, type and colour tokens. It does not decide what to
show or where: you write a component that loads some numbers and draws them
with these blocks, and put it in a place of the admin (`<Rebase slots>`, a page
in `views`, a collection view).

The numbers come from wherever you like. The usual shape is a backend function
that runs the `GROUP BY` in SQL, one route per figure or series, called as the
signed-in user so permissions and row-level security apply. The demo app's
`app/backend/functions/insights.ts` and `app/frontend/src/InsightSlots.tsx` are
a complete example: KPI tiles, revenue per day, top products, and bars that
open the collection filtered to what they count.

Charts are SVG and HTML with no chart library, so they add a few kilobytes,
follow the admin's light and dark themes, and print. They follow one set of
rules: one y-axis starting at zero, 2px lines, bars at most 24px thick with a
rounded data end, the kit's primary for a single series, a legend from two
series, a hover (and arrow-key) readout, and a table for screen readers.

## Building blocks

| Export | What it is |
|---|---|
| `useInsightData(key, load, { ttl })` | Runs `load()` once per key **and signed-in user**, and shares the result with every component reading that key within `ttl` (60s by default). Returns `{ data, error, loading }`. |
| `KpiTile` | One figure as a card: label, optional icon, value, and the change on the previous window (`previous`, `goodWhen`, `show`). |
| `KpiReadout` | The same figure as one line of text, for a home-page card. |
| `KpiGrid` | A responsive grid of tiles; given `periodDays`, it names the window once above them. |
| `ChartCard` | A card with the header grammar (icon, micro title, optional headline and action) around a chart. |
| `TimeSeriesChart` | One or more measures over time, as lines or a line with a wash (`variant`). Points are `{ at, value }`; a bare day (`"2026-11-07"`) is that calendar day. `null` leaves a gap. |
| `BarChart` | Categories by size, as horizontal bars with their values beside them. `onBarClick` makes each row a button. |
| `formatNumber`, `compactFormat`, `describeChange`, `niceTicks` | The number formatting and axis maths the blocks use. |
| `SERIES_COLORS` | The validated series colours, as Tailwind classes, in the order series take them. |

Every block takes `Intl.NumberFormatOptions` for its numbers and writes them in
the admin's language.

## Example

```tsx
import { useRebaseClient } from "@rebasepro/app";
import type { AnySlotContribution } from "@rebasepro/cms-types";
import { ChartCard, KpiGrid, KpiTile, TimeSeriesChart, useInsightData } from "@rebasepro/plugin-insights";

type Figures = { revenue: number; previousRevenue: number };
type Day = { day: string; revenue: number };

function RevenueOverview() {
    const client = useRebaseClient<RebaseClient>();
    const read = <T,>(path: string) => () =>
        client!.functions.invoke<T>("insights", undefined, { method: "GET", path });

    const totals = useInsightData("orders", read<Figures>("orders"));
    const daily = useInsightData("orders/daily", read<Day[]>("orders/daily"));

    return (
        <KpiGrid periodDays={30}>
            <KpiTile
                label="Revenue"
                icon="DollarSign"
                value={totals.data?.revenue}
                previous={totals.data?.previousRevenue}
                format={{ style: "currency", currency: "USD", notation: "compact" }}
                loading={totals.loading}
                error={totals.error}
            />
            <ChartCard title="Revenue per day" className="col-span-2 lg:col-span-3">
                <TimeSeriesChart
                    series={[{ id: "revenue", label: "Revenue", points: (daily.data ?? []).map((d) => ({ at: d.day, value: d.revenue })) }]}
                    format={{ style: "currency", currency: "USD" }}
                    loading={daily.loading}
                    error={daily.error}
                />
            </ChartCard>
        </KpiGrid>
    );
}

// At the top of the home page:
const slots: AnySlotContribution[] = [{ slot: "home.children.start", Component: RevenueOverview }];

<Rebase client={rebaseClient} slots={slots}>…</Rebase>
```

The places a component can go: `home.children.start` (top of the home page),
`collection.widgets` (above a collection's list, in list view; it receives the
collection and its path), `home.card.widget` (on a collection's home card), a
page in `<RebaseCMS views>`, and the others in `@rebasepro/cms`'s recipes README.

## Deprecated: `useInsightsPlugin`

`useInsightsPlugin(config)` — named `sources`, a list of insight definitions,
and slots chosen for you — still works, and warns once that it is deprecated.
So do the pieces it is made of: `InsightsProvider`, `useInsightsEngine`,
`InsightsEngine`, `resolvePeriod`, `useInsightSource`, `InsightsScorecardView`,
`InsightWidget` and `InsightsRow`, and the `Insight*` types. To move off it:

- each source becomes a `useInsightData(key, load)` call, with the window in
  the loader's query;
- each insight becomes a `KpiTile` (or a `KpiReadout` on a home card) given the
  field's value and its `previous` twin; `comparison.intent` becomes `goodWhen`
  (`"up"` or `"down"`), `value.format.decimals` becomes `maximumFractionDigits`;
- the home and collection lists become a component in `home.children.start`,
  `collection.widgets` and `home.card.widget`, checking
  `props.collection.slug` itself.

## Related Packages

- `@rebasepro/app` — Core framework: `<Rebase slots>`, `useRebaseClient`, i18n
- `@rebasepro/cms` — The admin's places and the customization recipes
- `@rebasepro/ui` — The kit whose cards, type and colours the blocks use
