# @rebasepro/plugin-insights

Figures for KPI tiles and charts in the Rebase admin panel. `useInsightData`
loads each one once per signed-in user and shares it; the tiles and charts
that draw them are in `@rebasepro/ui`.

## Installation

```bash
pnpm add @rebasepro/plugin-insights
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. It needs Node `>=22.22.0` (its `engines` floor), where `require()`
of it resolves too: Node has supported `require(esm)` since 22.12.

**Peer dependencies:** `react ^19.2.7`, `react-dom ^19.2.7`

## What This Package Does

It loads figures — revenue, orders, open tickets — and the series behind
them, for the metric blocks in `@rebasepro/ui` (`KpiTile`, `KpiGrid`,
`ChartCard`, `TimeSeriesChart`, `BarChart`) to draw. It does not decide what
to show or where: you write a component that loads some numbers with
`useInsightData` and draws them with those blocks, and put it in a place of
the admin (`<Rebase slots>`, a page in `views`, a collection view).

The numbers come from wherever you like. The usual shape is a backend function
that runs the `GROUP BY` in SQL, one route per figure or series, called as the
signed-in user so permissions and row-level security apply. The demo app's
`app/backend/functions/insights.ts` and `app/frontend/src/InsightSlots.tsx` are
a complete example: KPI tiles, revenue per day, top products, and bars that
open the collection filtered to what they count.

## Exports

| Export | What it is |
|---|---|
| `useInsightData(key, load, { ttl })` | Runs `load()` once per key **and signed-in user**, and shares the result with every component reading that key within `ttl` (60s by default). Returns `{ data, error, loading }`. |
| `clearInsightData()` | Forgets every loaded result, so the next read loads again. |
| `DEFAULT_INSIGHT_TTL` | The default `ttl`, in milliseconds. |

The blocks the figures go into — `KpiTile`, `KpiReadout`, `KpiGrid`,
`ChartCard`, `TimeSeriesChart`, `BarChart`, `SERIES_COLORS` and the number
helpers — are documented with the kit, under "Metrics and charts" in
`@rebasepro/ui`. They take `Intl.NumberFormatOptions` for their numbers and
write them in the admin's language.

## Example

```tsx
import { useRebaseClient } from "@rebasepro/app";
import type { createRebaseClient } from "@rebasepro/client";
import type { AnySlotContribution } from "@rebasepro/cms-types";
import { ChartCard, KpiGrid, KpiTile, TimeSeriesChart } from "@rebasepro/ui";
import { useInsightData } from "@rebasepro/plugin-insights";

type RebaseClient = ReturnType<typeof createRebaseClient>;
type Figures = { revenue: number; previousRevenue: number };
type Day = { day: string; revenue: number };

function RevenueOverview() {
    const client = useRebaseClient<RebaseClient>();
    const read = <T,>(path: string) => () => {
        if (!client) throw new Error("No Rebase client");
        return client.functions.invoke<T>("insights", undefined, { method: "GET", path });
    };

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
            <ChartCard title="Revenue per day" className="col-span-2 @4xl:col-span-3">
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

## Moving off `useInsightsPlugin`

`useInsightsPlugin(config)` — named `sources`, a list of insight definitions,
and slots chosen for you — is gone. The pieces it was made of still work and
are deprecated: `InsightsProvider`, `useInsightsEngine`, `InsightsEngine`,
`resolvePeriod`, `useInsightSource`, `InsightsScorecardView`, `InsightWidget`
and `InsightsRow`, and the `Insight*` types. To move a config over:

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
- `@rebasepro/ui` — The kit: `KpiTile`, `TimeSeriesChart`, `BarChart` and the rest of the metric blocks
