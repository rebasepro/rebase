import React from "react";
import { KpiGrid } from "@rebasepro/ui";
import type { InsightDefinition } from "../types";
import { useInsightsEngine } from "../engine/InsightsProvider";
import { DEFAULT_PERIOD_DAYS } from "../engine/InsightsEngine";
import { InsightWidget } from "./InsightWidget";

/**
 * A row of insight tiles. When any of them compares with the previous period,
 * the row says which period once, above the tiles, rather than on each.
 *
 * @deprecated Use `KpiGrid` with `KpiTile`s from `@rebasepro/ui` instead.
 */
export function InsightsRow({
    insights,
    className
}: {
    insights: InsightDefinition[];
    className?: string;
}) {
    const engine = useInsightsEngine();
    const days = engine?.periodDays ?? DEFAULT_PERIOD_DAYS;
    const compares = insights.some((definition) => definition.comparison);

    return (
        <KpiGrid periodDays={compares ? days : undefined} className={className}>
            {insights.map((definition) => (
                <InsightWidget key={definition.id} definition={definition}/>
            ))}
        </KpiGrid>
    );
}

InsightsRow.displayName = "InsightsRow";
