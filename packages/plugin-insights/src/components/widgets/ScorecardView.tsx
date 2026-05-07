import React, { forwardRef, useEffect, useState } from "react";
import { DataRow, DryScorecardWidgetConfig, ScorecardFormat, WidgetSize } from "../../types";
import { cls, Typography } from "@rebasepro/ui";

interface ScorecardViewProps {
    size: WidgetSize;
    config: DryScorecardWidgetConfig["scorecard"];
    data: DataRow;
    title: string;
}

export const ScorecardView = forwardRef<HTMLDivElement, ScorecardViewProps>(
    ({ size, config, data, title }, ref) => {
        const [containerSize, setContainerSize] = useState({ width: size.width, height: size.height });

        // Measure the actual container size using ResizeObserver
        useEffect(() => {
            const element = (ref as React.RefObject<HTMLDivElement>)?.current;
            if (!element) return;

            const resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const { width, height } = entry.contentRect;
                    setContainerSize({ width, height });
                }
            });

            resizeObserver.observe(element);

            return () => {
                resizeObserver.disconnect();
            };
        }, [ref]);

        const formatNumber = (value: number, format?: ScorecardFormat): string => {
            if (value === null || value === undefined) return "N/A";

            const options: Intl.NumberFormatOptions = {
                style: format?.style ?? "decimal",
                notation: format?.notation ?? "standard",
                maximumFractionDigits: format?.decimals ?? 1,
                minimumFractionDigits: format?.decimals ?? 1,
            };

            if (format?.style === "currency") {
                options.currency = format.currency ?? "USD";
            }

            let formatted = new Intl.NumberFormat("en-US", options).format(value);

            if (format?.showSign && value > 0) {
                formatted = "+" + formatted;
            }

            return formatted;
        };

        const mainValue = data[config.value.field];
        const formattedValue = typeof mainValue === "number"
            ? formatNumber(mainValue, config.value.format)
            : String(mainValue ?? "N/A");

        let comparisonElement: React.ReactNode = null;
        if (config.comparison) {
            const comparisonValue = data[config.comparison.field];
            if (typeof comparisonValue === "number") {
                const formattedComparison = formatNumber(comparisonValue, config.comparison.format);
                const isPositive = comparisonValue > 0;
                const isNegative = comparisonValue < 0;

                // Determine color based on intent
                let colorClass = "text-slate-600 dark:text-slate-400";
                if (config.comparison.intent === "increase_is_good") {
                    if (isPositive) colorClass = "text-green-600 dark:text-green-400";
                    if (isNegative) colorClass = "text-red-600 dark:text-red-400";
                } else if (config.comparison.intent === "decrease_is_good") {
                    if (isPositive) colorClass = "text-red-600 dark:text-red-400";
                    if (isNegative) colorClass = "text-green-600 dark:text-green-400";
                }

                comparisonElement = (
                    <div className={cls("font-medium mt-1", colorClass)}>
                        {formattedComparison}
                    </div>
                );
            }
        }

        // Determine font sizes based on available space - more granular breakpoints
        const isVerySmall = containerSize.width < 150 || containerSize.height < 120;
        const isSmall = containerSize.width < 200 || containerSize.height < 150;
        const isCompact = containerSize.width < 250 || containerSize.height < 180;
        const isMedium = containerSize.width < 320 || containerSize.height < 210;
        const isLarge = containerSize.width < 440 || containerSize.height < 240;

        // Calculate dynamic font sizes
        let titleSize: "caption" | "label" | "body";
        let iconSize: "smallest" | "small" | "medium" | "large";
        let valueSize: string;
        let comparisonSize: string;

        if (isVerySmall) {
            titleSize = "caption";
            iconSize = "smallest";
            valueSize = "text-xl";
            comparisonSize = "text-xs";
        } else if (isSmall) {
            titleSize = "caption";
            iconSize = "small";
            valueSize = "text-2xl";
            comparisonSize = "text-sm";
        } else if (isCompact) {
            titleSize = "label";
            iconSize = "medium";
            valueSize = "text-3xl";
            comparisonSize = "text-base";
        } else if (isMedium) {
            titleSize = "label";
            iconSize = "medium";
            valueSize = "text-4xl";
            comparisonSize = "text-lg";
        } else if (isLarge) {
            titleSize = "label";
            iconSize = "large";
            valueSize = "text-5xl";
            comparisonSize = "text-xl";
        } else {
            // Extra large
            titleSize = "body";
            iconSize = "large";
            valueSize = "text-7xl";
            comparisonSize = "text-2xl";
        }

        return (
            <div
                ref={ref}
                className="rounded-xl w-full h-full flex flex-col"
                style={{
                    backgroundColor: "var(--dataki-widget-bg)",
                    borderWidth: "var(--dataki-widget-border-width)",
                    borderColor: "var(--dataki-widget-border-color)",
                    borderStyle: "solid",
                    borderRadius: "var(--dataki-widget-border-radius)",
                    boxShadow: "var(--dataki-widget-shadow)",
                } as React.CSSProperties}
            >
                {/* Header with title and icon */}
                <div className={cls(
                    "flex flex-row items-start justify-between",
                    isVerySmall ? "p-2 pb-1" : isSmall ? "p-3 pb-2" : isLarge ? "p-6 pb-3" : "p-4 pb-2"
                )}>
                    <Typography
                        variant={titleSize as any}
                        className="flex-1 line-clamp-2"
                        style={{
                            fontFamily: "var(--dataki-title-font-family)",
                            color: "var(--dataki-scorecard-label-color, var(--dataki-title-color))",
                        } as React.CSSProperties}
                    >
                        {title}
                    </Typography>
                    {config.icon && (
                        <span
                            className="text-primary ml-2 flex-shrink-0"
                            style={{ fontSize: iconSize }}
                        >
                            {config.icon}
                        </span>
                    )}
                </div>

                {/* Main value and comparison */}
                <div className={cls(
                    "flex-1 flex flex-col justify-center items-start",
                    isVerySmall ? "px-2 pb-2" : isSmall ? "px-3 pb-3" : isLarge ? "px-6 pb-6" : "px-4 pb-4"
                )}>
                    <div
                        className={cls(
                            "font-bold break-all leading-tight",
                            valueSize
                        )}
                        style={{
                            color: "var(--dataki-scorecard-value-color)",
                            fontFamily: "var(--dataki-font-family)",
                        } as React.CSSProperties}
                    >
                        {formattedValue}
                    </div>

                    {comparisonElement && (
                        <div className={comparisonSize}>
                            {comparisonElement}
                        </div>
                    )}
                </div>
            </div>
        );
    }
);

ScorecardView.displayName = "ScorecardView";

