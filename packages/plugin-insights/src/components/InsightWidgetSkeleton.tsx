import React, { useRef, useState } from "react";
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
 *
 * The standard skeleton mirrors InsightsScorecardView's responsive
 * container-width breakpoints (ResizeObserver → isSmall / isMedium)
 * and uses placeholder heights that exactly match the **computed**
 * Tailwind line-heights (accounting for `leading-*` overrides).
 * This guarantees a pixel-perfect skeleton → loaded transition.
 */
export function InsightWidgetSkeleton({
    config,
    compact = false,
    embedded = false,
    fixedHeight,
}: {
    /** Scorecard config — used to match optional elements (comparison, dateRange, icon). */
    config: ScorecardConfig;
    compact?: boolean;
    /** When true, skip own border since the parent card provides it. */
    embedded?: boolean;
    /** Explicit height to prevent layout shift between skeleton → loaded. */
    fixedHeight?: number;
}) {
    const hasComparison = Boolean(config.comparison);
    const hasIcon = Boolean(config.icon);
    const hasDateRange = Boolean(config.dateRange);

    // ── Compact scorecard skeleton ──────────────────────────────────────
    // Matches InsightsScorecardView compact layout:
    //   container: flex flex-col gap-0.5 px-2.5 py-2 rounded-md border
    //   title:     text-[10px] uppercase → line-height ~14px
    //   value row: text-sm font-semibold → line-height 20px
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
    return <StandardSkeleton
        hasComparison={hasComparison}
        hasIcon={hasIcon}
        hasDateRange={hasDateRange}
        embedded={embedded}
        fixedHeight={fixedHeight}
    />;
}

// ── Tailwind line-height reference ──────────────────────────────────────
// All heights below are the **computed** CSS line-heights, accounting
// for `leading-*` overrides that InsightsScorecardView applies.
//
// Title:
//   text-xs (12px) + leading-snug (1.375)  → 12 × 1.375 = 16.5px
//   text-[11px]    + leading-snug (1.375)  → 11 × 1.375 = 15.125px
//
// DateRange:
//   text-[10px] with no explicit LH        → normal ≈ 14px (browser)
//
// Value:
//   text-2xl (24px) + leading-tight (1.25) → 24 × 1.25 = 30px
//   text-xl  (20px) + leading-tight (1.25) → 20 × 1.25 = 25px
//   text-lg  (18px) + leading-tight (1.25) → 18 × 1.25 = 22.5px
//
// Comparison:
//   text-xs (12px)  → built-in LH 1rem     = 16px

/**
 * Inner component for the standard scorecard skeleton.
 *
 * Mirrors InsightsScorecardView's layout by:
 * 1. Using the same ResizeObserver + containerWidth pattern for
 *    responsive breakpoints (isSmall < 200px, isMedium < 300px).
 * 2. Using placeholder heights derived from the exact computed
 *    Tailwind line-heights that InsightsScorecardView renders.
 * 3. Matching all container classes, margins, paddings, and flex
 *    layout properties identically.
 */
function StandardSkeleton({
    hasComparison,
    hasIcon,
    hasDateRange,
    embedded,
    fixedHeight,
}: {
    hasComparison: boolean;
    hasIcon: boolean;
    hasDateRange: boolean;
    embedded: boolean;
    fixedHeight?: number;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState<number | null>(null);

    React.useLayoutEffect(() => {
        if (!containerRef.current) return;
        setContainerWidth(containerRef.current.offsetWidth);
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    // Mirror InsightsScorecardView's responsive breakpoints exactly
    const isSmall = containerWidth !== null && containerWidth < 200;

    // Computed line-heights for each breakpoint
    // Title: text-xs + leading-snug = 16.5px, text-[11px] + leading-snug = 15.125px
    const titleHeight = isSmall ? 15 : 16.5;
    // Value: leading-tight (×1.25) applied on top of font-size
    const valueHeight = isSmall
        ? 22.5  // text-lg: 18 × 1.25
        : (containerWidth !== null && containerWidth < 300)
            ? 25    // text-xl: 20 × 1.25
            : 30;   // text-2xl: 24 × 1.25
    // Comparison: text-xs = 12px / 16px line-height (no leading override)
    const comparisonHeight = 16;
    // Icon: 14px when small, 18px otherwise
    const iconSize = isSmall ? 14 : 18;

    const baseClass = embedded
        ? `flex flex-col min-w-0 h-full ${isSmall ? "px-3.5 py-3" : "px-5 py-4"}`
        : cls("rounded-lg flex flex-col min-w-0 bg-transparent border", defaultBorderMixin, isSmall ? "px-3.5 py-3" : "px-5 py-4");

    return (
        <div
            ref={containerRef}
            className={cls("animate-pulse", baseClass)}
            style={embedded ? undefined : fixedHeight ? { height: fixedHeight } : { minHeight: isSmall ? 68 : 92 }}
        >
            {/* Title row — identical flex structure to InsightsScorecardView */}
            <div className={`flex items-center justify-between ${isSmall ? "mb-1" : "mb-2"}`}>
                <div className="flex flex-col min-w-0">
                    {/* Title placeholder */}
                    <div className="bg-surface-200 dark:bg-surface-700 rounded"
                        style={{ height: titleHeight, width: "60%" }}
                    />
                    {/* DateRange — hidden when isSmall, same as real view (line 134) */}
                    {hasDateRange && !isSmall && (
                        <div className="bg-surface-200/60 dark:bg-surface-700/60 rounded mt-0.5"
                            style={{ height: 14, width: "40%" }}
                        />
                    )}
                </div>
                {/* Icon placeholder — same wrapper as real view */}
                {hasIcon && (
                    <span className="ml-2 shrink-0">
                        <div className="bg-surface-200 dark:bg-surface-700 rounded"
                            style={{ height: iconSize, width: iconSize }}
                        />
                    </span>
                )}
            </div>

            {/* Main value placeholder */}
            <div className="bg-surface-200 dark:bg-surface-700 rounded"
                style={{ height: valueHeight, width: "40%" }}
            />

            {/* Comparison placeholder */}
            {hasComparison && (
                <div className={isSmall ? "mt-0.5" : "mt-1"}>
                    <div className="bg-surface-200/60 dark:bg-surface-700/60 rounded"
                        style={{ height: comparisonHeight, width: "25%" }}
                    />
                </div>
            )}
        </div>
    );
}

InsightWidgetSkeleton.displayName = "InsightWidgetSkeleton";
