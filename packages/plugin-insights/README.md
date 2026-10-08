# @rebasepro/plugin-insights

Scorecard and KPI widget plugin for the Rebase admin panel.

## Installation

```bash
pnpm add @rebasepro/plugin-insights
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. It needs Node `>=22.22.0` (its `engines` floor), where `require()`
of it resolves too: Node has supported `require(esm)` since 22.12.

**Peer dependencies:** `react ^19.2.7`, `react-dom ^19.2.7`

## What This Package Does

This plugin puts figures — revenue, orders, open tickets — into the Rebase admin
UI, each beside its change over a comparison period. You declare named
`sources`, functions that fetch one record of figures for that period: use the
Rebase SDK, call a backend function, or hit any API. Each insight names the
source and the field it reads. The plugin fetches each source once per signed-in
user, caches it, works out the change, and renders it in the right slots.

Figures appear in three places:

- **Home page header**: a row of KPI cards via the `home.children.start` slot
- **Collection list view**: a row of figures below the title, above the list, via `collection.widgets`
- **Home page cards**: compact figures on each collection's card via `home.card.widget`

Collection insights are defined once, under `collections.<slug>`, and render
both in the collection's list view and on its home card. Every insight that
reads a source shares one fetch of it, so a figure shown in two places is the
same number.

## Key Exports

| Export | Type | Description |
|---|---|---|
| `useInsightsPlugin` | Hook | Creates the plugin from an `InsightsPluginConfig`. Returns a `RebasePlugin` |
| `InsightsPluginConfig` | Type | Top-level config: `sources`, `insights` (home + collections), optional `period` and `cacheTTL` |
| `InsightSource` | Type | `(context: { period }) => Promise<DataRow>`: fetches one record of figures |
| `InsightSourceContext` | Type | What a source is called with: `{ period: InsightPeriod }` |
| `InsightPeriod` | Type | The resolved windows: `days`, `from`, `to`, `previousFrom` |
| `InsightPeriodConfig` | Type | `{ days }`, the comparison window |
| `InsightDefinition` | Type | One figure: `id`, `title`, `source`, `value`, optional `comparison` and `icon` |
| `InsightComparison` | Type | `previous` field, `intent`, and `show` (`percent` or `absolute`) |
| `InsightFormat` | Type | Number formatting: `style` (decimal/currency/percent), `notation`, `currency`, `decimals` |
| `DataRow` | Type | `Record<string, string \| number \| boolean \| null>` |
| `InsightsProvider` | Component | React context provider (injected automatically by the plugin) |
| `useInsightsEngine` | Hook | Access the insights engine from context (advanced) |
| `InsightsEngine` | Class | Fetches and caches sources per user, and anchors the period (advanced) |
| `resolvePeriod` | Function | `(days, to) => InsightPeriod` (advanced) |
| `useInsightSource` | Hook | Reads one source for the signed-in user (custom layouts) |
| `InsightsRow` | Component | A row of insights under the period label (custom layouts) |
| `InsightsScorecardView` | Component | Renders one figure from a record and its definition (custom layouts) |
| `InsightWidget` | Component | Single insight container (custom layouts) |

### `InsightsPluginConfig`

| Prop | Type | Default | Description |
|---|---|---|---|
| `sources` | `Record<string, InsightSource>` | — | Where the figures come from, by name. Required |
| `insights.home` | `InsightDefinition[]` | — | Insights shown at the top of the home page |
| `insights.collections` | `Record<string, InsightDefinition[]>` | — | Insights per collection slug |
| `period.days` | `number` | `30` | The comparison window: the last N days against the N days before them |
| `cacheTTL` | `number` | `60_000` | How long a fetched source is reused, in milliseconds |

Creating the plugin throws when an insight names a source that `sources` does
not declare, or when `period.days` is not a whole number of at least 1. Pass a
memoized config: a new `sources` object starts a new cache.

### `InsightDefinition`

| Prop | Type | Description |
|---|---|---|
| `source` | `string` | The key in `sources` this insight reads |
| `value.field` | `string` | The field holding the figure |
| `value.format` | `InsightFormat` | How to write it, in the admin panel's language |
| `comparison.previous` | `string` | The field holding the same figure for the previous period |
| `comparison.intent` | `"increase_is_good" \| "decrease_is_good"` | Which direction reads as good news |
| `comparison.show` | `"percent" \| "absolute"` | The relative change (default), or the difference. Use `absolute` for small counts |
| `icon` | `string` | Icon key (e.g., `"ShoppingCart"`), resolved via `getIcon` |

## Quick Start

```tsx
import { useMemo } from "react";
import { Rebase } from "@rebasepro/app";
import { RebaseShell } from "@rebasepro/cms";
import { useInsightsPlugin } from "@rebasepro/plugin-insights";
import type { DataRow, InsightPeriod } from "@rebasepro/plugin-insights";

const windowQuery = (period: InsightPeriod) => new URLSearchParams({
    previousFrom: period.previousFrom.toISOString(),
    from: period.from.toISOString(),
    to: period.to.toISOString()
}).toString();

const insightsPlugin = useInsightsPlugin(useMemo(() => ({
    period: { days: 30 },
    sources: {
        // One request answers every insight below: { revenue, previousRevenue, shipped, previousShipped }
        orders: ({ period }) => rebaseClient.functions.invoke<DataRow>("insights", undefined, {
            method: "GET",
            path: `orders?${windowQuery(period)}`
        })
    },
    insights: {
        home: [
            {
                id: "revenue",
                title: "Revenue",
                source: "orders",
                icon: "DollarSign",
                value: { field: "revenue", format: { style: "currency", currency: "USD", notation: "compact" } },
                comparison: { previous: "previousRevenue", intent: "increase_is_good" }
            }
        ],
        collections: {
            orders: [
                {
                    id: "shipped",
                    title: "Shipped",
                    source: "orders",
                    icon: "Truck",
                    value: { field: "shipped" },
                    comparison: { previous: "previousShipped", intent: "increase_is_good", show: "absolute" }
                }
            ]
        }
    }
}), []));

// Pass to your Rebase app:
<Rebase client={rebaseClient} plugins={[insightsPlugin]}>
    <RebaseShell />
</Rebase>
```

A source runs in the browser under the signed-in user's permissions. The demo
app's `insights` backend function (`app/backend/functions/insights.ts`) is one
way to compute both windows in a single query.

## Related Packages

- `@rebasepro/app` — Core framework providing the plugin system
- `@rebasepro/cms-types` — Shared types (`RebasePlugin`, `SlotContribution`)
- `@rebasepro/ui` — UI components used by insight widgets
