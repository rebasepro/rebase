import React from "react";
import { useTranslation } from "@rebasepro/app";
import { cls, Typography } from "@rebasepro/ui";
import type { InsightDefinition } from "../types";
import { useInsightsEngine } from "../engine/InsightsProvider";
import { DEFAULT_PERIOD_DAYS } from "../engine/InsightsEngine";
import { InsightWidget } from "./InsightWidget";

/**
 * A row of insight tiles. When any of them compares with the previous period,
 * the row says which period once, above the tiles, rather than on each.
 */
export function InsightsRow({
    insights,
    className
}: {
    insights: InsightDefinition[];
    className?: string;
}) {
    const { t } = useTranslation();
    const engine = useInsightsEngine();
    const days = engine?.periodDays ?? DEFAULT_PERIOD_DAYS;
    const compares = insights.some((definition) => definition.comparison);

    return (
        <section className={cls("w-full", className)}>
            {compares && (
                <Typography variant="micro" color="secondary" component="h2" className="block py-1 mb-4">
                    {t("insights_period_last_days", { count: days })}
                </Typography>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {insights.map((definition) => (
                    <InsightWidget key={definition.id} definition={definition}/>
                ))}
            </div>
        </section>
    );
}

InsightsRow.displayName = "InsightsRow";
