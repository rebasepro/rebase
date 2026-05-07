// ── Types ─────────────────────────────────────────────────────────────
export type {
    DataRow,
    HydratedChartConfig,
    ScorecardFormat,
    ScorecardConfig,
    InsightDataResult,
    InsightFetchParams,
    InsightsFetchFn,
    InsightDefinition,
    InsightsPluginConfig,
} from "./types";

// ── Plugin ────────────────────────────────────────────────────────────
export { useInsightsPlugin } from "./useInsightsPlugin";

// ── Engine (for advanced usage) ───────────────────────────────────────
export { InsightsProvider, useInsightsEngine } from "./engine/InsightsProvider";
export { InsightsCache } from "./engine/InsightsCache";
export { useInsightsData } from "./engine/useInsightsData";

// ── Widget components (for custom layouts) ────────────────────────────
export { InsightsChartView } from "./components/InsightsChartView";
export { InsightsScorecardView } from "./components/InsightsScorecardView";
export { InsightWidget } from "./components/InsightWidget";
export { InsightWidgetSkeleton } from "./components/InsightWidgetSkeleton";
