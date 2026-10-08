import React from "react";
import type { InsightDefinition } from "../types";
import { useInsightSource } from "../engine/useInsightSource";
import { InsightsScorecardView } from "./InsightsScorecardView";

/** One insight, reading its source through the shared engine. */
export function InsightWidget({
    definition,
    compact = false
}: {
    definition: InsightDefinition;
    compact?: boolean;
}) {
    const { result, loading, error } = useInsightSource(definition.source);

    return (
        <InsightsScorecardView
            definition={definition}
            result={result}
            loading={loading}
            error={error}
            compact={compact}
        />
    );
}

InsightWidget.displayName = "InsightWidget";
