import React from "react";
import { cls, defaultBorderMixin } from "@rebasepro/ui";
import type { ScorecardConfig } from "../types";

/**
 * Skeleton loader for scorecard insight widgets — displays animated
 * shimmer placeholders that exactly match the final rendered layout
 * of InsightsScorecardView for a given config, preventing layout shift.
 *
 * The skeleton receives the scorecard config so it can conditionally
 * render placeholder lines for comparison, dateRange, and icon —
 * only when the loaded view will also render them.
 */
export function InsightWidgetSkeleton({
    config,
    compact = false,
    embedded = false,
}: {
    /** Scorecard config — used to match optional elements (comparison, dateRange, icon). */
    config: ScorecardConfig;
    compact?: boolean;
    /** When true, skip own border since the parent card provides it. */
    embedded?: boolean;
}) {
    const hasComparison = Boolean(config.comparison);
    const hasIcon = Boolean(config.icon);
    const hasDateRange = Boolean(config.dateRange);

    // ── Compact scorecard skeleton ──────────────────────────────────────
    // Matches InsightsScorecardView compact layout:
    //   container: flex flex-col gap-0.5 px-2.5 py-2 rounded-md border
    //   title:     text-[10px] uppercase → line-height ~14px
    //   value row: text-sm font-semibold → line-height ~20px
    //   + optional comparison text-[10px] inside value row
    if (compact) {
        return (
            <div
                className={cls(
                    "animate-pulse",
                    embedded
                        ? "h-full px-2.5 py-2"
                        : "flex flex-col gap-0.5 rounded-md bg-transparent border min-w-0 px-2.5 py-2",
                    !embedded && defaultBorderMixin
                )}
            >
                {/* Title line */}
                <div className="bg-surface-200 dark:bg-surface-700 rounded-sm"
                    style={{ height: 14, width: 48 }}
                />
                {/* Value + optional comparison row */}
                <div className="flex items-baseline gap-1.5">
                    <div className="bg-surface-200 dark:bg-surface-700 rounded-sm"
                        style={{ height: 20, width: 40 }}
                    />
                    {hasComparison && (
                        <div className="bg-surface-200/60 dark:bg-surface-700/60 rounded-sm"
                            style={{ height: 14, width: 28 }}
                        />
                    )}
                </div>
            </div>
        );
    }

    // ── Standard scorecard skeleton ─────────────────────────────────────
    // Matches InsightsScorecardView standard layout (isSmall = false):
    //   container: rounded-lg px-5 py-4 border, minHeight 92
    //   title row: flex justify-between mb-2
    //     title:     text-xs → line-height ~16px
    //     dateRange: text-[10px] mt-0.5 → ~14px  (optional)
    //     icon:      18×18 ml-2                    (optional)
    //   value:     text-2xl → line-height ~32px
    //   comparison: text-xs mt-1 → ~16px           (optional)
    return (
        <div
            className={cls(
                "animate-pulse",
                embedded
                    ? "h-full px-5 py-4"
                    : "rounded-lg bg-transparent border px-5 py-4",
                !embedded && defaultBorderMixin
            )}
            style={embedded ? undefined : { minHeight: 92 }}
        >
            {/* Title row */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex flex-col min-w-0">
                    {/* Title */}
                    <div className="bg-surface-200 dark:bg-surface-700 rounded"
                        style={{ height: 16, width: "60%" }}
                    />
                    {/* DateRange (only if config has it) */}
                    {hasDateRange && (
                        <div className="bg-surface-200/60 dark:bg-surface-700/60 rounded mt-0.5"
                            style={{ height: 14, width: "40%" }}
                        />
                    )}
                </div>
                {/* Icon placeholder (only if config has it) */}
                {hasIcon && (
                    <div className="bg-surface-200 dark:bg-surface-700 rounded ml-2 shrink-0"
                        style={{ height: 18, width: 18 }}
                    />
                )}
            </div>

            {/* Main value */}
            <div className="bg-surface-200 dark:bg-surface-700 rounded"
                style={{ height: 32, width: "40%" }}
            />

            {/* Comparison (only if config has it) */}
            {hasComparison && (
                <div className="bg-surface-200/60 dark:bg-surface-700/60 rounded mt-1"
                    style={{ height: 16, width: "25%" }}
                />
            )}
        </div>
    );
}

InsightWidgetSkeleton.displayName = "InsightWidgetSkeleton";
