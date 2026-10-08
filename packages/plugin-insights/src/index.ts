// ── Types ─────────────────────────────────────────────────────────────
export type {
    DataRow,
    InsightFormat,
    InsightComparison,
    InsightDefinition,
    InsightPeriod,
    InsightPeriodConfig,
    InsightSource,
    InsightSourceContext,
    InsightsPluginConfig
} from "./types";

// ── Plugin ────────────────────────────────────────────────────────────
export { useInsightsPlugin } from "./useInsightsPlugin";

// ── Engine (for advanced usage) ───────────────────────────────────────
export { InsightsProvider, useInsightsEngine } from "./engine/InsightsProvider";
export { InsightsEngine, resolvePeriod } from "./engine/InsightsEngine";
export type { SourceResult } from "./engine/InsightsEngine";
export { useInsightSource } from "./engine/useInsightSource";

// ── Widget components (for custom layouts) ────────────────────────────
export { InsightsScorecardView } from "./components/InsightsScorecardView";
export { InsightWidget } from "./components/InsightWidget";
export { InsightsRow } from "./components/InsightsRow";
