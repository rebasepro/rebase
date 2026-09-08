import React, { useRef, useState } from "react";
import { getIcon } from "@rebasepro/app";
import { cls, defaultBorderMixin } from "@rebasepro/ui";
import type { DataRow, ScorecardConfig, ScorecardFormat } from "../types";

function formatNumber(value: number, format?: ScorecardFormat): string {
    if (value === null || value === undefined) return "N/A";

    const options: Intl.NumberFormatOptions = {
        style: format?.style ?? "decimal",
        notation: format?.notation ?? "standard"
    };

    // Only pin the fraction digits when the config asks for a specific count.
    // Without this, Intl's per-style defaults apply: integers stay integers
    // ("80", not "80.0") while currency keeps its two decimals ("$452.95").
    if (format?.decimals !== undefined) {
        options.maximumFractionDigits = format.decimals;
        options.minimumFractionDigits = format.decimals;
    }

    if (format?.style === "currency") {
        options.currency = format.currency ?? "USD";
    }

    let formatted = new Intl.NumberFormat("en-US", options).format(value);

    if (format?.showSign && value > 0) {
        formatted = "+" + formatted;
    }

    return formatted;
}

/**
 * Scorecard widget for the Rebase design system.
 *
 * Renders a single KPI metric with optional comparison value and icon.
 * Uses Tailwind `dark:` classes — no JS dark mode detection.
 * Icons are resolved via `getIcon` from `@rebasepro/app`.
 */
export function InsightsScorecardView({
    config,
    data,
    title,
    compact = false,
    embedded = false,
    fixedHeight
}: {
    config: ScorecardConfig;
    data: DataRow;
    title: string;
    compact?: boolean;
    /** When true, skip own border/bg since the parent card provides them. */
    embedded?: boolean;
    /** Explicit height to prevent layout shift between skeleton → loaded. */
    fixedHeight?: number;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState<number | null>(null);

    React.useLayoutEffect(() => {
        if (!containerRef.current) return;
        // Read initial width synchronously before paint
        setContainerWidth(containerRef.current.offsetWidth);
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    const mainValue = data[config.value.field];
    const formattedValue = typeof mainValue === "number"
        ? formatNumber(mainValue, config.value.format)
        : String(mainValue ?? "N/A");

    // Comparison rendering
    let comparisonElement: React.ReactNode = null;
    if (config.comparison) {
        const comparisonValue = data[config.comparison.field];
        if (typeof comparisonValue === "number") {
            const formattedComparison = formatNumber(comparisonValue, config.comparison.format);
            const isPositive = comparisonValue > 0;
            const isNegative = comparisonValue < 0;

            let colorClass = "text-surface-500 dark:text-surface-400";
            if (config.comparison.intent === "increase_is_good") {
                if (isPositive) colorClass = "text-emerald-500";
                if (isNegative) colorClass = "text-red-500";
            } else if (config.comparison.intent === "decrease_is_good") {
                if (isPositive) colorClass = "text-red-500";
                if (isNegative) colorClass = "text-emerald-500";
            }

            comparisonElement = (
                <span className={`font-mono tabular-nums font-medium ${compact ? "text-[10px]" : "text-xs"} ${colorClass}`}>
                    {formattedComparison}
                </span>
            );
        }
    }

    const isSmall = compact || (containerWidth !== null && containerWidth < 200);

    // Resolve icon via getIcon (Lucide-based resolution)
    // 14px in the secondary tier, beside the label — the card header grammar.
    const iconElement = config.icon
        ? getIcon(config.icon, "text-text-secondary dark:text-text-secondary-dark", undefined, 14)
        : null;

    // ── Compact card-inline layout ──────────────────────────────────────
    if (compact) {
        return (
            <div className={cls("flex flex-col gap-0.5 px-2.5 py-2 rounded-md bg-transparent border min-w-0", defaultBorderMixin)}>
                <span className="text-[10px] uppercase tracking-wider text-surface-400 dark:text-surface-500 truncate">
                    {title}
                </span>
                <div className="flex items-baseline gap-1.5">
                    <span className="text-sm font-semibold tabular-nums text-surface-800 dark:text-surface-100">
                        {formattedValue}
                    </span>
                    {comparisonElement}
                </div>
            </div>
        );
    }

    // ── Standard scorecard layout ───────────────────────────────────────
    const baseClass = embedded
        ? `flex flex-col min-w-0 h-full ${isSmall ? "px-3.5 py-3" : "px-5 py-4"}`
        // A card on the sheet: one step up and a hairline, like every other card.
        // It was transparent with a border, a box drawn on the sheet rather
        // than an object sitting on it.
        : cls("rounded-xl flex flex-col min-w-0 bg-surface-card border", defaultBorderMixin, isSmall ? "px-3.5 py-3" : "px-5 py-4");

    return (
        <div ref={containerRef} className={baseClass} style={embedded ? undefined : fixedHeight ? { height: fixedHeight } : { minHeight: isSmall ? 68 : 92 }}>
            {/* Title row — the card header grammar the reference page documents:
                a small icon in the secondary tier, then the label in the micro
                tier, on ONE line. The icon used to sit alone at the far right,
                which made every tile read as two unrelated corners. */}
            <div className={`flex flex-col min-w-0 ${isSmall ? "mb-1" : "mb-2.5"}`}>
                <div className="flex items-center gap-1.5 min-w-0">
                    {iconElement && (
                        <span className="shrink-0 flex items-center text-text-secondary dark:text-text-secondary-dark [&>svg]:size-3.5">{iconElement}</span>
                    )}
                    <span className="typography-micro truncate text-surface-400 dark:text-surface-400">
                        {title}
                    </span>
                </div>
                {config.dateRange && !isSmall && (
                    <span className="font-mono tabular-nums text-[10px] text-surface-400 dark:text-surface-500 truncate mt-1">
                        {config.dateRange}
                    </span>
                )}
            </div>

            {/* Main value */}
            <div className={`font-headers font-semibold leading-tight tracking-display tabular-nums break-all text-text-primary dark:text-text-primary-dark ${isSmall ? "text-lg" : (containerWidth !== null && containerWidth < 300) ? "text-xl" : "text-2xl"}`}>
                {formattedValue}
            </div>

            {/* Comparison */}
            {comparisonElement && (
                <div className={isSmall ? "mt-0.5" : "mt-1"}>
                    {comparisonElement}
                </div>
            )}
        </div>
    );
}

InsightsScorecardView.displayName = "InsightsScorecardView";
