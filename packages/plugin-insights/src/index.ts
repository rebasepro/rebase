// ── Building blocks ───────────────────────────────────────────────────
// Components and hooks you put in places yourself: `<Rebase slots>`, a page,
// a collection view.
export { useInsightData, clearInsightData, DEFAULT_INSIGHT_TTL } from "./blocks/useInsightData";
export type { InsightData } from "./blocks/useInsightData";
export { KpiTile, KpiReadout, KpiGrid, KpiChange, Placeholder } from "./blocks/KpiTile";
export type { KpiProps } from "./blocks/KpiTile";
export { ChartCard, ChartStatus, useElementWidth } from "./blocks/charts/ChartCard";
export { TimeSeriesChart } from "./blocks/charts/TimeSeriesChart";
export type { TimeSeries, TimeSeriesPoint } from "./blocks/charts/TimeSeriesChart";
export { BarChart } from "./blocks/charts/BarChart";
export type { Bar } from "./blocks/charts/BarChart";
export { SERIES_COLORS } from "./blocks/charts/palette";
export type { SeriesColor } from "./blocks/charts/palette";
export { formatNumber, compactFormat, describeChange, niceTicks } from "./blocks/numbers";
export type { Change, ChangeDirection, ChangeTone } from "./blocks/numbers";

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
