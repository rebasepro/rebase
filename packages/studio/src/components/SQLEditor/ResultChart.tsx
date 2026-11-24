import React, { useEffect, useMemo, useRef, useState } from "react";
import { Select, SelectItem, ToggleButtonGroup, Typography } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import type { ResultProvenance } from "../../utils/sql_utils";

export interface ResultChartProps {
    rows: Record<string, unknown>[];
    /** The result's columns, in order. */
    columns: string[];
    provenance: ResultProvenance | null;
}

/** The most points one chart draws; a result past it is drawn by its first rows. */
export const MAX_CHART_POINTS = { bar: 200, line: 2000 } as const;

const NUMERIC_TYPES = /^(smallint|integer|bigint|numeric|real|double precision|money|decimal)/;

function asNumber(value: unknown): number | null {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The columns a y axis can take: numeric by the type the database said, or,
 * when it said none, every non-empty value of the first rows reads as a number.
 */
function numericColumns(rows: Record<string, unknown>[], columns: string[], provenance: ResultProvenance | null): string[] {
    const typed = new Map((provenance?.columns ?? []).map(column => [column.name, column.type]));
    return columns.filter(column => {
        const type = typed.get(column);
        if (type) return NUMERIC_TYPES.test(type);
        const sample = rows.slice(0, 50).map(row => row[column]).filter(value => value !== null && value !== undefined);
        return sample.length > 0 && sample.every(value => asNumber(value) !== null);
    });
}

/** About `count` round tick values from at or below `min` to at or above `max`, so the axis ends on a labelled line. */
function ticks(min: number, max: number, count = 5): number[] {
    if (min === max) return [min];
    const span = max - min;
    const raw = span / count;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(candidate => span / candidate <= count) ?? raw;
    const out: number[] = [];
    const last = Math.ceil(max / step - 1e-9) * step;
    for (let value = Math.floor(min / step + 1e-9) * step; value <= last + step * 1e-9; value += step) out.push(Number(value.toPrecision(12)));
    return out;
}

function formatTick(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (abs >= 1e4) return `${(value / 1e3).toFixed(0)}k`;
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

const MARGIN = { top: 16, right: 16, bottom: 48, left: 56 };

/**
 * A bar or line chart of one result: one column along the x axis, one
 * numeric column up the y axis. Drawn as SVG sized to its container.
 */
export const ResultChart: React.FC<ResultChartProps> = ({ rows, columns, provenance }) => {
    const { t } = useTranslation();
    const numeric = useMemo(() => numericColumns(rows, columns, provenance), [rows, columns, provenance]);
    const [kind, setKind] = useState<"bar" | "line">("bar");
    const [xColumn, setXColumn] = useState(() => columns.find(column => !numeric.includes(column)) ?? columns[0] ?? "");
    const [yColumn, setYColumn] = useState(() => numeric.find(column => column !== xColumn) ?? numeric[0] ?? "");

    // Laid out by the space it has, which a resizable pane changes.
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => {
            setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const points = useMemo(() => rows
        .slice(0, MAX_CHART_POINTS[kind])
        .map(row => ({ label: row[xColumn] === null || row[xColumn] === undefined ? "NULL" : String(row[xColumn]), value: asNumber(row[yColumn]) }))
        .filter((point): point is { label: string; value: number } => point.value !== null),
    [rows, kind, xColumn, yColumn]);

    const width = Math.max(size.width, 0);
    const height = Math.max(size.height, 0);
    const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
    const plotHeight = Math.max(height - MARGIN.top - MARGIN.bottom, 0);
    const values = points.map(point => point.value);
    const yMin = Math.min(0, ...values);
    const yMax = Math.max(0, ...values);
    const yTicks = ticks(yMin, yMax);
    const top = Math.max(yMax, yTicks[yTicks.length - 1] ?? yMax);
    const bottom = Math.min(yMin, yTicks[0] ?? yMin);
    const y = (value: number) => MARGIN.top + (top === bottom ? plotHeight / 2 : (1 - (value - bottom) / (top - bottom)) * plotHeight);
    const band = points.length > 0 ? plotWidth / points.length : 0;
    const x = (index: number) => MARGIN.left + band * index + band / 2;
    // At most one x label per 64px, so they do not overlap.
    const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotWidth / 64))));

    return (
        <div className="h-full w-full flex flex-col min-h-0">
            <div className="flex flex-wrap items-center gap-3 px-4 py-2 shrink-0">
                <ToggleButtonGroup<"bar" | "line">
                    aria-label={t("studio_sql_chart_kind")}
                    value={kind}
                    onValueChange={setKind}
                    options={[
                        { value: "bar", label: t("studio_sql_chart_bar") },
                        { value: "line", label: t("studio_sql_chart_line") }
                    ]}
                />
                <Select size="small" className="w-48" label={t("studio_sql_chart_x")} value={xColumn} onValueChange={setXColumn}>
                    {columns.map(column => <SelectItem key={column} value={column}>{column}</SelectItem>)}
                </Select>
                <Select size="small" className="w-48" label={t("studio_sql_chart_y")} value={yColumn} onValueChange={setYColumn} disabled={numeric.length === 0}>
                    {numeric.map(column => <SelectItem key={column} value={column}>{column}</SelectItem>)}
                </Select>
                {rows.length > MAX_CHART_POINTS[kind] && (
                    <Typography variant="caption" color="secondary">{t("studio_sql_chart_first_rows", { count: MAX_CHART_POINTS[kind] })}</Typography>
                )}
            </div>
            <div ref={containerRef} className="flex-grow min-h-0 relative">
                {numeric.length === 0 || points.length === 0 ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Typography variant="body2" color="secondary">{t("studio_sql_chart_no_numbers")}</Typography>
                    </div>
                ) : width > 0 && height > 0 && (
                    <svg width={width} height={height} role="img" aria-label={t("studio_sql_chart_label", { y: yColumn, x: xColumn })} className="block">
                        {yTicks.map(tick => (
                            <g key={tick}>
                                <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} className="stroke-hairline" strokeWidth={1}/>
                                <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-text-secondary dark:fill-text-secondary-dark text-[11px] font-mono">{formatTick(tick)}</text>
                            </g>
                        ))}
                        <g className="text-primary dark:text-primary-dark">
                            {kind === "bar"
                                ? points.map((point, index) => {
                                    const barTop = y(Math.max(point.value, 0));
                                    const barHeight = Math.abs(y(point.value) - y(0));
                                    return (
                                        <rect
                                            key={index}
                                            x={MARGIN.left + band * index + band * 0.15}
                                            y={barTop}
                                            width={Math.max(band * 0.7, 1)}
                                            height={Math.max(barHeight, 1)}
                                            rx={Math.min(3, band * 0.2)}
                                            fill="currentColor"
                                            fillOpacity={0.85}
                                        >
                                            <title>{`${point.label}: ${point.value}`}</title>
                                        </rect>
                                    );
                                })
                                : (
                                    <>
                                        <polyline
                                            points={points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")}
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth={2}
                                            strokeLinejoin="round"
                                        />
                                        {points.length <= 100 && points.map((point, index) => (
                                            <circle key={index} cx={x(index)} cy={y(point.value)} r={3} fill="currentColor">
                                                <title>{`${point.label}: ${point.value}`}</title>
                                            </circle>
                                        ))}
                                    </>
                                )}
                        </g>
                        <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(0)} y2={y(0)} className="stroke-hairline-strong" strokeWidth={1}/>
                        {points.map((point, index) => index % labelEvery === 0 && (
                            <text
                                key={index}
                                x={x(index)}
                                y={MARGIN.top + plotHeight + 16}
                                textAnchor="middle"
                                className="fill-text-secondary dark:fill-text-secondary-dark text-[11px]"
                            >
                                {point.label.length > 10 ? `${point.label.slice(0, 9)}…` : point.label}
                            </text>
                        ))}
                        <text x={MARGIN.left + plotWidth / 2} y={height - 8} textAnchor="middle" className="fill-text-disabled dark:fill-text-disabled-dark text-[11px] font-mono">{xColumn}</text>
                    </svg>
                )}
            </div>
        </div>
    );
};
