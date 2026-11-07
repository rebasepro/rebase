import React from "react";
import { useTranslation } from "@rebasepro/app";
import { cls } from "@rebasepro/ui";
import { formatNumber } from "../numbers";
import { ChartStatus } from "./ChartCard";
import { SERIES_COLORS } from "./palette";

export interface Bar {
    /** Stable identity: the category's id, not its label. */
    key: string;
    label: string;
    value: number;
}

const ROW_HEIGHT = 28;

/**
 * Categories compared by size, as horizontal bars growing from one baseline,
 * in the order given: sort them if the ranking is the point, keep their own
 * order (low → urgent) if that is.
 *
 * Every bar is one hue — the bars are one measure, not different series —
 * and its value is written beside it. Given `onBarClick`, each row is a
 * button: use it to open the records the bar counts.
 */
export function BarChart({ bars, format, onBarClick, loading, error, className }: {
    bars: Bar[];
    format?: Intl.NumberFormatOptions;
    onBarClick?: (bar: Bar) => void;
    loading?: boolean;
    error?: Error;
    className?: string;
}) {
    const { i18n } = useTranslation();
    const height = Math.max(bars.length, 3) * ROW_HEIGHT;
    const empty = bars.length === 0;
    if (loading || error || empty) {
        return (
            <div className={className}>
                <ChartStatus height={height} loading={loading} error={error} empty={!loading && !error && empty}/>
            </div>
        );
    }

    const max = Math.max(...bars.map((bar) => bar.value), 0);

    return (
        <ul className={cls("w-full min-w-0 flex flex-col", className)}>
            {bars.map((bar) => {
                const share = max > 0 ? Math.max(0, bar.value) / max : 0;
                const row = (
                    <>
                        <span className="w-[35%] max-w-40 shrink-0 truncate text-left text-xs text-text-secondary dark:text-text-secondary-dark" title={bar.label}>
                            {bar.label}
                        </span>
                        <span className="grow min-w-0 h-full flex items-center">
                            <span
                                // 4px rounded at the data end, square at the baseline; at least a
                                // sliver for any value above zero, so it does not read as nothing.
                                className={cls("block h-4 rounded-r-[4px] transition-opacity", SERIES_COLORS[0].bg, onBarClick && "group-hover:opacity-80")}
                                style={{ width: bar.value > 0 ? `max(2px, ${share * 100}%)` : 0 }}
                            />
                        </span>
                        <span className="shrink-0 min-w-10 text-right text-xs font-semibold tabular-nums text-text-primary dark:text-text-primary-dark">
                            {formatNumber(bar.value, format, i18n.language)}
                        </span>
                    </>
                );
                const rowClasses = "w-full flex items-center gap-3 px-1 rounded-md";
                return (
                    <li key={bar.key} style={{ height: ROW_HEIGHT }}>
                        {onBarClick
                            ? (
                                <button
                                    type="button"
                                    className={cls(rowClasses, "group h-full cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary")}
                                    onClick={() => onBarClick(bar)}
                                >
                                    {row}
                                </button>
                            )
                            : <div className={cls(rowClasses, "h-full")}>{row}</div>}
                    </li>
                );
            })}
        </ul>
    );
}
