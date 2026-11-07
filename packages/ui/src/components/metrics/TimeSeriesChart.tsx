"use client";
import React, { useState } from "react";
import { cls } from "../../util";
import { compactFormat, formatNumber, niceTicks } from "../../util/numbers";
import { SERIES_COLORS } from "../../util/series_colors";
import { useUiLabels } from "../../hooks/UiLabelsContext";
import { useElementWidth } from "../../hooks/useElementWidth";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../Table";
import { Typography } from "../Typography";
import { ChartStatus } from "./ChartCard";
import { GRID_CLASSES, TICK_CLASSES } from "./chart_parts";

export interface TimeSeriesPoint {
    /** A `Date`, an epoch in ms, or an ISO string. A bare day (`"2026-11-07"`) is that calendar day. */
    at: Date | string | number;
    /** `null` leaves a gap in the line rather than drawing a zero. */
    value: number | null;
}

export interface TimeSeries {
    id: string;
    label: string;
    points: TimeSeriesPoint[];
}

const MARGIN = { top: 8, right: 8, bottom: 22 };
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function dateFormatter(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    try {
        return new Intl.DateTimeFormat(locale, options);
    } catch {
        return new Intl.DateTimeFormat(undefined, options);
    }
}

/** An SVG path through the points, broken where a value is missing. */
function linePath(points: { x: number; y: number | null }[]): string {
    let path = "";
    let drawing = false;
    for (const { x, y } of points) {
        if (y === null) {
            drawing = false;
            continue;
        }
        path += `${drawing ? "L" : "M"}${x},${y}`;
        drawing = true;
    }
    return path;
}

/** The area under each unbroken run of the line, down to `baseline`. */
function areaPath(points: { x: number; y: number | null }[], baseline: number): string {
    let path = "";
    let run: { x: number; y: number }[] = [];
    const close = () => {
        if (run.length > 0) {
            path += `M${run[0].x},${baseline}` + run.map(({ x, y }) => `L${x},${y}`).join("") + `L${run[run.length - 1].x},${baseline}Z`;
        }
        run = [];
    };
    for (const { x, y } of points) {
        if (y === null) close();
        else run.push({ x, y });
    }
    close();
    return path;
}

/**
 * One or more measures over time, as lines — or, by default, a line with a
 * light wash under it.
 *
 * One y-axis, starting at zero. Hovering (or focusing the chart and pressing
 * the arrow keys) moves a crosshair to the nearest date and lists every
 * series' value there. Two or more series get a legend; screen readers get
 * the values as a table.
 *
 * Two measures of different scale (revenue and orders) are two charts, not
 * one with two axes.
 *
 * It fills its container's width, measured, so it redraws to fit a split
 * panel or a narrow frame. Dates and numbers are written in the nearest
 * `UiLabelsProvider`'s `locale`.
 */
export function TimeSeriesChart({ series, variant = "area", format, dateFormat, height = 200, loading, error, xLabel, className }: {
    series: TimeSeries[];
    variant?: "area" | "line";
    /** How values are written in the tooltip; ticks use the compact form of it. */
    format?: Intl.NumberFormatOptions;
    /** How dates are written. Defaults to month and day. */
    dateFormat?: Intl.DateTimeFormatOptions;
    height?: number;
    loading?: boolean;
    error?: Error;
    /** What the x values are, for the table screen readers get. Defaults to the `date` label. */
    xLabel?: string;
    className?: string;
}) {
    const labels = useUiLabels();
    const locale = labels.locale;
    // On the root, which every state renders, so the width is known the
    // moment the data lands.
    const [ref, width] = useElementWidth<HTMLDivElement>();

    const dayOnly = series.every((s) => s.points.every((p) => typeof p.at === "string" && DAY_ONLY.test(p.at)));
    // A bare day parses as its UTC midnight, so it is written in UTC or it
    // lands on the day before west of Greenwich.
    const dates = dateFormatter(locale, { month: "short", day: "numeric", ...dateFormat, ...(dayOnly ? { timeZone: "UTC" } : {}) });

    const parsed = series.map((s) => ({
        ...s,
        points: s.points
            .map((p) => ({ t: new Date(p.at).getTime(), value: p.value }))
            .filter((p) => Number.isFinite(p.t))
            .sort((a, b) => a.t - b.t)
    }));
    const times = [...new Set(parsed.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
    const values = parsed.flatMap((s) => s.points.flatMap((p) => (p.value === null ? [] : [p.value])));
    const empty = times.length === 0 || values.length === 0;

    return (
        <div ref={ref} className={cls("w-full min-w-0", className)}>
            {loading || error || empty
                ? <ChartStatus height={height} loading={loading} error={error} empty={!loading && !error && empty}/>
                : (
                    <Plot
                        series={parsed}
                        times={times}
                        values={values}
                        width={width}
                        height={height}
                        variant={variant}
                        format={format}
                        dates={dates}
                        locale={locale}
                        xLabel={xLabel ?? labels.date}
                    />
                )}
        </div>
    );
}

interface ParsedSeries {
    id: string;
    label: string;
    points: { t: number; value: number | null }[];
}

/** The legend, the marks, the readout and the screen-reader table of a chart with data. */
function Plot({ series: parsed, times, values, width, height, variant, format, dates, locale, xLabel }: {
    series: ParsedSeries[];
    times: number[];
    values: number[];
    width: number;
    height: number;
    variant: "area" | "line";
    format?: Intl.NumberFormatOptions;
    dates: Intl.DateTimeFormat;
    locale?: string;
    xLabel: string;
}) {
    const [active, setActive] = useState<number | null>(null);

    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const yMin = ticks[0];
    const yMax = ticks.length > 1 ? ticks[ticks.length - 1] : yMin + 1;
    const tickFormat = compactFormat(format);
    const tickLabels = ticks.map((tick) => formatNumber(tick, tickFormat, locale));

    const left = Math.max(...tickLabels.map((label) => label.length)) * 6.5 + 10;
    const x0 = left;
    const x1 = Math.max(x0 + 1, width - MARGIN.right);
    const y0 = MARGIN.top;
    const y1 = height - MARGIN.bottom;
    const tMin = times[0];
    const tMax = times[times.length - 1];
    const xOf = (time: number) => (tMax === tMin ? (x0 + x1) / 2 : x0 + ((time - tMin) / (tMax - tMin)) * (x1 - x0));
    const yOf = (value: number) => y1 - ((value - yMin) / (yMax - yMin)) * (y1 - y0);
    const baseline = yOf(Math.max(yMin, Math.min(0, yMax)));

    const xTicks = width < 240 || times.length < 3
        ? [...new Set([0, times.length - 1])]
        : [0, Math.floor((times.length - 1) / 2), times.length - 1];

    const nearest = (pointerX: number): number => {
        let best = 0;
        for (let i = 1; i < times.length; i++) {
            if (Math.abs(xOf(times[i]) - pointerX) < Math.abs(xOf(times[best]) - pointerX)) best = i;
        }
        return best;
    };

    const activeTime = active === null ? null : times[active];
    const valueAt = (s: ParsedSeries, time: number) => s.points.find((p) => p.t === time)?.value ?? null;

    return (
        <>
            {parsed.length > 1 && (
                <ul className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
                    {parsed.map((s, i) => (
                        <li key={s.id} className="flex items-center gap-1.5">
                            <span aria-hidden="true" className={cls("w-3 h-0.5 rounded-full", SERIES_COLORS[i % SERIES_COLORS.length].bg)}/>
                            <Typography variant="body2" component="span" color="secondary">{s.label}</Typography>
                        </li>
                    ))}
                </ul>
            )}
            <div
                className="relative w-full outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
                style={{ height }}
                tabIndex={0}
                aria-label={parsed.map((s) => s.label).join(", ")}
                onPointerMove={(event) => setActive(nearest(event.clientX - event.currentTarget.getBoundingClientRect().left))}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive((current) => current ?? times.length - 1)}
                onBlur={() => setActive(null)}
                onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") setActive((current) => Math.max(0, (current ?? times.length) - 1));
                    else if (event.key === "ArrowRight") setActive((current) => Math.min(times.length - 1, (current ?? -1) + 1));
                    else return;
                    event.preventDefault();
                }}
            >
                {width > 0 && (
                    <svg width={width} height={height} aria-hidden="true" className="block overflow-visible">
                        {ticks.map((tick, i) => (
                            <g key={tick}>
                                <line x1={x0} x2={x1} y1={yOf(tick)} y2={yOf(tick)} className={GRID_CLASSES} strokeWidth={1} shapeRendering="crispEdges"/>
                                <text x={x0 - 8} y={yOf(tick)} dy="0.32em" textAnchor="end" className={TICK_CLASSES}>{tickLabels[i]}</text>
                            </g>
                        ))}
                        {xTicks.map((index, i) => (
                            <text
                                key={index}
                                x={xOf(times[index])}
                                y={height - 6}
                                textAnchor={xTicks.length === 1 ? "middle" : i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
                                className={TICK_CLASSES}
                            >
                                {dates.format(times[index])}
                            </text>
                        ))}
                        {parsed.map((s, i) => {
                            const color = SERIES_COLORS[i % SERIES_COLORS.length];
                            const points = s.points.map((p) => ({ x: xOf(p.t), y: p.value === null ? null : yOf(p.value) }));
                            return (
                                <g key={s.id}>
                                    {variant === "area" && <path d={areaPath(points, baseline)} className={color.fill} fillOpacity={0.1}/>}
                                    <path d={linePath(points)} className={color.stroke} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>
                                </g>
                            );
                        })}
                        {activeTime !== null && (
                            <g>
                                <line x1={xOf(activeTime)} x2={xOf(activeTime)} y1={y0} y2={y1} className="stroke-text-disabled dark:stroke-text-disabled-dark" strokeWidth={1}/>
                                {parsed.map((s, i) => {
                                    const value = valueAt(s, activeTime);
                                    if (value === null) return null;
                                    return (
                                        <circle
                                            key={s.id}
                                            cx={xOf(activeTime)}
                                            cy={yOf(value)}
                                            r={4}
                                            strokeWidth={2}
                                            className={cls(SERIES_COLORS[i % SERIES_COLORS.length].fill, "stroke-surface-card")}
                                        />
                                    );
                                })}
                            </g>
                        )}
                    </svg>
                )}
                {activeTime !== null && (
                    <div
                        // A floating surface: the card fill, the strong hairline and a shadow.
                        className="pointer-events-none absolute top-0 z-10 min-w-32 rounded-lg border border-hairline-strong bg-surface-card px-3 py-2 shadow-sm"
                        style={xOf(activeTime) > width / 2
                            ? { right: width - xOf(activeTime) + 12 }
                            : { left: xOf(activeTime) + 12 }}
                    >
                        <Typography variant="body2" component="div" color="secondary" className="mb-1">{dates.format(activeTime)}</Typography>
                        {parsed.map((s, i) => {
                            const value = valueAt(s, activeTime);
                            return (
                                <div key={s.id} className="flex items-center gap-2 whitespace-nowrap">
                                    <span aria-hidden="true" className={cls("w-3 h-0.5 rounded-full shrink-0", SERIES_COLORS[i % SERIES_COLORS.length].bg)}/>
                                    <Typography variant="body2" component="span" className="font-semibold tabular-nums">
                                        {value === null ? "—" : formatNumber(value, format, locale)}
                                    </Typography>
                                    <Typography variant="body2" component="span" color="secondary">{s.label}</Typography>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            <Table className="sr-only">
                <TableHeader>
                    <TableCell>{xLabel}</TableCell>
                    {parsed.map((s) => <TableCell key={s.id}>{s.label}</TableCell>)}
                </TableHeader>
                <TableBody>
                    {times.map((time) => (
                        <TableRow key={time}>
                            <TableCell header scope="row">{dates.format(time)}</TableCell>
                            {parsed.map((s) => {
                                const value = valueAt(s, time);
                                return <TableCell key={s.id}>{value === null ? "—" : formatNumber(value, format, locale)}</TableCell>;
                            })}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </>
    );
}
