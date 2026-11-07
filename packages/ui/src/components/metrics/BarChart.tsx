"use client";
import React from "react";
import { cls } from "../../util";
import { formatNumber } from "../../util/numbers";
import { SERIES_COLORS } from "../../util/series_colors";
import { useUiLabels } from "../../hooks/UiLabelsContext";
import { Button } from "../Button";
import { Typography } from "../Typography";
import { ChartStatus } from "./ChartCard";

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
    const { locale } = useUiLabels();
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
                        <Typography variant="body2" component="span" color="secondary" className="w-[35%] max-w-40 shrink-0 truncate text-left font-normal" title={bar.label}>
                            {bar.label}
                        </Typography>
                        <span className="grow min-w-0 h-full flex items-center">
                            <span
                                // Rounded at the data end, square at the baseline; at least a
                                // sliver for any value above zero, so it does not read as nothing.
                                className={cls("block h-4 rounded-r-sm transition-opacity", SERIES_COLORS[0].bg, onBarClick && "group-hover:opacity-80")}
                                style={{ width: bar.value > 0 ? `max(2px, ${share * 100}%)` : 0 }}
                            />
                        </span>
                        <Typography variant="body2" component="span" className="shrink-0 min-w-10 text-right font-semibold tabular-nums">
                            {formatNumber(bar.value, format, locale)}
                        </Typography>
                    </>
                );
                const rowClasses = "w-full flex items-center gap-3 px-1";
                return (
                    <li key={bar.key} style={{ height: ROW_HEIGHT }}>
                        {onBarClick
                            ? (
                                <Button
                                    variant="text"
                                    size="smallest"
                                    fullWidth
                                    className={cls(rowClasses, "group h-full justify-start")}
                                    onClick={() => onBarClick(bar)}
                                >
                                    {row}
                                </Button>
                            )
                            : <div className={cls(rowClasses, "h-full")}>{row}</div>}
                    </li>
                );
            })}
        </ul>
    );
}
