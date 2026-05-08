import React from "react";

/**
 * Skeleton loader for scorecard insight widgets — displays animated
 * shimmer lines to provide visual feedback while data is loading.
 */
export function InsightWidgetSkeleton({
    compact = false,
    embedded = false,
}: {
    compact?: boolean;
    /** When true, skip own border since the parent card provides it. */
    embedded?: boolean;
}) {
    // ── Compact scorecard skeleton — matches InsightsScorecardView compact layout exactly ──
    if (compact) {
        return (
            <div
                className={embedded
                    ? "animate-pulse h-full px-2.5 py-2"
                    : "flex flex-col gap-0.5 rounded-md animate-pulse bg-transparent border border-surface-200 dark:border-surface-800 min-w-0 px-2.5 py-2"
                }
            >
                {/* Title line — matches text-[10px] uppercase */}
                <div className="bg-surface-200 dark:bg-surface-700"
                    style={{ height: 10, width: 48, borderRadius: 4 }}
                />
                {/* Value line — matches text-sm font-semibold */}
                <div className="bg-surface-200 dark:bg-surface-700"
                    style={{ height: 16, width: 40, borderRadius: 4, marginTop: 2 }}
                />
            </div>
        );
    }

    // ── Standard scorecard skeleton ──
    return (
        <div
            className={embedded
                ? `animate-pulse h-full px-5 py-4`
                : `rounded-lg animate-pulse bg-transparent border border-surface-200 dark:border-surface-800 px-5 py-4`
            }
            style={embedded ? undefined : { minHeight: 92 }}
        >
            {/* Title line */}
            <div className="bg-surface-200 dark:bg-surface-700 mb-3"
                style={{ height: 12, width: "60%", borderRadius: 6 }}
            />
            {/* Value line */}
            <div className="bg-surface-200 dark:bg-surface-700 mb-2"
                style={{ height: 32, width: "40%", borderRadius: 6 }}
            />
            {/* Comparison line */}
            <div className="bg-surface-200/80 dark:bg-surface-700/80"
                style={{ height: 10, width: "25%", borderRadius: 6 }}
            />
        </div>
    );
}

InsightWidgetSkeleton.displayName = "InsightWidgetSkeleton";
