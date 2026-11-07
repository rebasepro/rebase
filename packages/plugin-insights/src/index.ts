// ── Data ──────────────────────────────────────────────────────────────
// Figures for the metric blocks in `@rebasepro/ui` (`KpiTile`, `TimeSeriesChart`,
// `BarChart`), loaded once per key and signed-in user.
export { useInsightData, clearInsightData, DEFAULT_INSIGHT_TTL } from "./blocks/useInsightData";
export type { InsightData } from "./blocks/useInsightData";
// Re-exported until the MCP view and the guide import them from @rebasepro/ui.
export {
    KpiTile,
    KpiReadout,
    KpiGrid,
    KpiChange,
    Placeholder,
    ChartCard,
    ChartStatus,
    TimeSeriesChart,
    BarChart,
    SERIES_COLORS,
    formatNumber,
    compactFormat,
    describeChange,
    niceTicks
} from "@rebasepro/ui";
export type { KpiProps, TimeSeries, TimeSeriesPoint, Bar, SeriesColor, Change, ChangeDirection, ChangeTone } from "@rebasepro/ui";

// ── Deprecated: the configured plugin's engine and widgets ────────────
// Kept working until they are removed.
export type {
    DataRow,
    InsightFormat,
    InsightComparison,
    InsightDefinition,
    InsightPeriod,
    InsightPeriodConfig,
    InsightSource,
    InsightSourceContext
} from "./types";

export { InsightsProvider, useInsightsEngine } from "./engine/InsightsProvider";
export { InsightsEngine, resolvePeriod } from "./engine/InsightsEngine";
export type { SourceResult } from "./engine/InsightsEngine";
export { useInsightSource } from "./engine/useInsightSource";

export { InsightsScorecardView } from "./components/InsightsScorecardView";
export { InsightWidget } from "./components/InsightWidget";
export { InsightsRow } from "./components/InsightsRow";
