# @rebasepro/plugin-insights

Scorecard and KPI widget plugin for the Rebase admin panel.

## Installation

```bash
pnpm add @rebasepro/plugin-insights
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. `require()` of it resolves only on Node 22.12+, which supports
`require(esm)`.

**Peer dependencies:** `react >= 19.0.0`, `react-dom >= 19.0.0`

## What This Package Does

This plugin injects data-driven scorecard widgets into the Rebase admin UI. You define insight definitions with custom `data()` callbacks — use the Rebase SDK, call a custom function, or hit any external API. The plugin handles caching, rendering, and slot injection.

Widgets appear in three locations automatically:

- **Home page header** — KPI overview cards via the `home.children.start` slot
- **Collection list view** — Inline scorecards below the title, above the data list via `collection.widgets`
- **Home page cards** — Compact metrics auto-extracted from collection insights via `home.card.widget`

Collection-level insights are the single source of truth: define once under `collections.<slug>`, and they render both in the collection view and on the home card.

## Key Exports

| Export | Type | Description |
|---|---|---|
| `useInsightsPlugin` | Hook | Creates the plugin from an `InsightsPluginConfig`. Returns a `RebasePlugin` |
| `InsightsPluginConfig` | Type | Top-level config: `insights` (home + collections) and optional `cacheTTL` |
| `InsightDefinition` | Type | Single insight: `id`, `title`, `data()` callback, `scorecard` config |
| `InsightDataResult` | Type | Return type of `data()`: `{ rows: DataRow[] }` |
| `DataRow` | Type | `Record<string, string \| number \| boolean \| null>` |
| `ScorecardConfig` | Type | Field mapping for value, comparison, icon, dateRange |
| `ScorecardFormat` | Type | Number formatting: style (decimal/currency/percent), notation, currency, decimals, showSign |
| `InsightsProvider` | Component | React context provider (injected automatically by the plugin) |
| `useInsightsEngine` | Hook | Access the insights engine from context (advanced) |
| `InsightsCache` | Class | TTL-based cache for insight data (advanced) |
| `useInsightsData` | Hook | Fetch and cache data for a specific insight (advanced) |
| `InsightsScorecardView` | Component | Renders a scorecard from data + config (custom layouts) |
| `InsightWidget` | Component | Single insight widget container (custom layouts) |
| `InsightWidgetSkeleton` | Component | Loading placeholder for insight widgets |

### `InsightsPluginConfig`

| Prop | Type | Default | Description |
|---|---|---|---|
| `insights.home` | `InsightDefinition[]` | — | Insights shown at the top of the home page |
| `insights.collections` | `Record<string, InsightDefinition[]>` | — | Insights per collection slug |
| `cacheTTL` | `number` | `60_000` | Cache TTL in milliseconds |

### `ScorecardConfig`

| Prop | Type | Description |
|---|---|---|
| `value.field` | `string` | Column name from data rows for the main value |
| `value.format` | `ScorecardFormat` | Number formatting options |
| `comparison.field` | `string` | Column name for comparison/delta value |
| `comparison.format` | `ScorecardFormat` | Formatting for comparison |
| `comparison.intent` | `"increase_is_good" \| "decrease_is_good"` | Controls green/red coloring |
| `icon` | `string` | Icon key (e.g., `"shopping_cart"`) |
| `dateRange` | `string` | Label text (e.g., `"Last 30 days"`) |

## Quick Start

```tsx
import { useInsightsPlugin } from "@rebasepro/plugin-insights";

const insightsPlugin = useInsightsPlugin({
    cacheTTL: 120_000,
    insights: {
        home: [
            {
                id: "revenue",
                title: "Revenue",
                data: async () => {
                    const res = await fetch("/api/analytics/revenue");
                    return { rows: [await res.json()] };
                },
                scorecard: {
                    value: { field: "total", format: { style: "currency", currency: "USD", notation: "compact" } },
                    comparison: { field: "delta_pct", format: { style: "percent", decimals: 1 }, intent: "increase_is_good" },
                    icon: "attach_money",
                    dateRange: "Last 30 days"
                }
            }
        ],
        collections: {
            orders: [
                {
                    id: "total_orders",
                    title: "Total Orders",
                    data: async () => {
                        const count = await rebaseClient.data.orders.count();
                        return { rows: [{ total: count }] };
                    },
                    scorecard: {
                        value: { field: "total", format: { style: "decimal", notation: "compact" } },
                        icon: "shopping_cart"
                    }
                }
            ]
        }
    }
});

// Pass to your Rebase app:
<RebaseFirebaseApp plugins={[insightsPlugin]} />
```

## Related Packages

- `@rebasepro/app` — Core framework providing the plugin system
- `@rebasepro/types` — Shared types (`RebasePlugin`, `SlotContribution`)
- `@rebasepro/ui` — UI components used by insight widgets
