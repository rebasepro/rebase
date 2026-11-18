"use client";
import React, { useState } from "react";
import { cls } from "../../util";
import { formatNumber } from "../../util/numbers";
import { accentTextMixin } from "../../styles";
import { useUiLabels } from "../../hooks/UiLabelsContext";
import { useElementWidth } from "../../hooks/useElementWidth";
import { Typography } from "../Typography";
import { ChartStatus } from "./ChartCard";
import { GRID_CLASSES } from "./chart_parts";
import { barIndexAt, barPath, markerAt, timeBarsGeometry, type BarSlot } from "./time_bars_geometry";

/** A `Date`, an epoch in ms, or an ISO string. */
type TimeInput = Date | string | number;

export interface TimeBucket {
    start: TimeInput;
    end: TimeInput;
    /** `null` is a gap — nothing was recorded — and draws nothing. `0` draws a baseline tick. */
    value: number | null;
    /** How much of `value` is the secondary measure: errors of requests. Drawn as a segment at the bar's top. */
    secondary?: number;
}

export interface TimeBarsMarker {
    at: TimeInput;
    /** What happened, in the readout: "Deployed". */
    label: string;
}

/** The request bars' strength when not hovered: sixty saturated bars read as a block. */
const BAR_OPACITY = 0.58;

function dateFormatter(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    try {
        return new Intl.DateTimeFormat(locale, options);
    } catch {
        return new Intl.DateTimeFormat(undefined, options);
    }
}

const toMs = (at: TimeInput) => new Date(at).getTime();

type Active = { kind: "bar"; index: number } | { kind: "marker"; x: number; at: number; label: string };

/**
 * A measure over time as one bar per bucket — requests per minute, say —
 * with an optional secondary share (the errors among them) drawn as a red
 * segment at the top of each bar.
 *
 * A bucket with nothing recorded is a GAP, drawn as nothing; a recorded zero
 * draws a 1px baseline tick, so "running and quiet" is visible and differs
 * from "not running". Vertical markers (a deploy) are dashed hairlines.
 *
 * The chart is one focus stop, labelled by `label`: hovering, or focusing it
 * and pressing the arrow keys, shows a readout of one bucket. Sixty tab stops
 * would be a keyboard trap. Each chart scales to its own maximum.
 *
 * Words and dates come from the nearest `UiLabelsProvider`, like
 * `TimeSeriesChart`. The geometry is `time_bars_geometry.ts`.
 */
export function TimeBars({
    buckets,
    markers = [],
    label,
    valueLabel,
    secondaryLabel,
    height = 56,
    format,
    loading,
    error,
    className
}: {
    buckets: TimeBucket[];
    markers?: TimeBarsMarker[];
    /** The chart's accessible name: what it shows and its totals. */
    label: string;
    /** What a bar counts, in the readout: "Requests". */
    valueLabel: string;
    /** What the secondary segment counts, in the readout: "Errors". */
    secondaryLabel?: string;
    height?: number;
    /** How values are written in the readout. */
    format?: Intl.NumberFormatOptions;
    loading?: boolean;
    error?: Error;
    className?: string;
}) {
    const labels = useUiLabels();
    const locale = labels.locale;
    const [ref, width] = useElementWidth<HTMLDivElement>();
    const [active, setActive] = useState<Active | null>(null);

    const slots: BarSlot[] = buckets.map(b => ({
        start: toMs(b.start),
        end: toMs(b.end),
        value: typeof b.value === "number" && Number.isFinite(b.value) ? b.value : null,
        secondary: Math.max(0, b.secondary ?? 0)
    }));
    const geometry = timeBarsGeometry(slots, width, height, markers.map(m => ({ at: toMs(m.at), label: m.label })));
    const span = slots.length > 0 ? slots[slots.length - 1].end - slots[0].start : 0;
    const dates = dateFormatter(locale, span > 2 * 86_400_000
        ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
        : { hour: "2-digit", minute: "2-digit" });
    const times = dateFormatter(locale, { hour: "2-digit", minute: "2-digit" });

    const activeX = active?.kind === "bar"
        ? (geometry.bars[active.index]?.x ?? 0) + (geometry.bars[active.index]?.width ?? 0) / 2
        : active?.x ?? 0;

    return (
        <div ref={ref} className={cls("w-full min-w-0", className)}>
            {loading || error || slots.length === 0
                ? <ChartStatus height={height} loading={loading} error={error} empty={!loading && !error && slots.length === 0}/>
                : (
                    <div
                        className="relative w-full outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md"
                        style={{ height }}
                        tabIndex={0}
                        role="group"
                        aria-label={label}
                        onPointerMove={(event) => {
                            const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
                            const marker = markerAt(x, geometry.markers);
                            if (marker) setActive({ kind: "marker", x: marker.x, at: marker.at, label: marker.label });
                            else {
                                const index = barIndexAt(x, width, geometry.bars.length);
                                setActive(index < 0 ? null : { kind: "bar", index });
                            }
                        }}
                        onPointerLeave={() => setActive(null)}
                        onFocus={() => setActive(current => current ?? { kind: "bar", index: slots.length - 1 })}
                        onBlur={() => setActive(null)}
                        onKeyDown={(event) => {
                            const current = active?.kind === "bar" ? active.index : slots.length;
                            if (event.key === "ArrowLeft") setActive({ kind: "bar", index: Math.max(0, current - 1) });
                            else if (event.key === "ArrowRight") setActive({ kind: "bar", index: Math.min(slots.length - 1, (active?.kind === "bar" ? active.index : -1) + 1) });
                            else if (event.key === "Escape" && active) setActive(null);
                            else return;
                            event.preventDefault();
                        }}
                    >
                        {width > 0 && (
                            <svg width={width} height={height} aria-hidden="true" className="absolute inset-0 overflow-visible">
                                <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} className={GRID_CLASSES} strokeWidth={1} shapeRendering="crispEdges"/>
                                <g className={cls(accentTextMixin, "fill-current")}>
                                    {geometry.bars.map(bar => bar.kind === "gap" ? null : (
                                        <path
                                            key={bar.index}
                                            d={barPath(bar.x, bar.y, bar.width, bar.height)}
                                            opacity={active?.kind === "bar" && active.index === bar.index ? 1 : BAR_OPACITY}
                                        />
                                    ))}
                                </g>
                                <g className="text-red-600 dark:text-red-400 fill-current">
                                    {geometry.bars.map(bar => bar.secondaryHeight > 0 ? (
                                        <path key={bar.index} d={barPath(bar.x, bar.y, bar.width, bar.secondaryHeight)}/>
                                    ) : null)}
                                </g>
                                {geometry.markers.map(marker => (
                                    <line
                                        key={`${marker.at}-${marker.label}`}
                                        x1={marker.x}
                                        x2={marker.x}
                                        y1={0}
                                        y2={height}
                                        strokeWidth={1}
                                        strokeDasharray="2 2"
                                        className="stroke-text-secondary dark:stroke-text-secondary-dark"
                                    />
                                ))}
                            </svg>
                        )}
                        {active && (
                            <div
                                // A floating surface: the card fill, the strong hairline and a shadow.
                                className="pointer-events-none absolute bottom-full mb-2 z-10 whitespace-nowrap rounded-lg border border-hairline-strong bg-surface-card px-3 py-2 shadow-sm"
                                style={activeX > width / 2 ? { right: width - activeX } : { left: activeX }}
                            >
                                {active.kind === "marker" ? (
                                    <>
                                        <Typography variant="body2" component="div" className="font-medium">{active.label}</Typography>
                                        <Typography variant="body2" component="div" color="secondary" className="tabular-nums">{dates.format(active.at)}</Typography>
                                    </>
                                ) : (() => {
                                    const slot = slots[active.index];
                                    if (!slot) return null;
                                    return (
                                        <>
                                            <Typography variant="body2" component="div" color="secondary" className="tabular-nums mb-0.5">
                                                {`${dates.format(slot.start)} – ${times.format(slot.end)}`}
                                            </Typography>
                                            {slot.value === null ? (
                                                <Typography variant="body2" component="div">{labels.nothingRecorded}</Typography>
                                            ) : (
                                                <div className="flex items-baseline gap-3 tabular-nums">
                                                    <Typography variant="body2" component="span">
                                                        <span className="font-semibold">{formatNumber(slot.value, format, locale)}</span>{" "}
                                                        <span className="text-text-secondary dark:text-text-secondary-dark">{valueLabel}</span>
                                                    </Typography>
                                                    {secondaryLabel && (
                                                        <Typography variant="body2" component="span">
                                                            <span className={cls("font-semibold", slot.secondary > 0 && "text-red-600 dark:text-red-400")}>
                                                                {formatNumber(slot.secondary, format, locale)}
                                                            </span>{" "}
                                                            <span className="text-text-secondary dark:text-text-secondary-dark">{secondaryLabel}</span>
                                                        </Typography>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                )}
        </div>
    );
}
