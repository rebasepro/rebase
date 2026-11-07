"use client";
import React from "react";
import { cls } from "../../util";
import { useUiLabels } from "../../hooks/UiLabelsContext";
import { Card } from "../Card";
import { Skeleton } from "../Skeleton";
import { Typography } from "../Typography";
import { HeaderIcon } from "./chart_parts";

/**
 * A chart on a card: the card header grammar (a small icon in the secondary
 * tier, the title in the micro tier), an optional headline figure under it,
 * and the chart.
 */
export function ChartCard({ title, icon, headline, action, className, children }: {
    title: string;
    /** A Lucide icon name (`"ChartArea"`) or an icon element, drawn before the title. */
    icon?: string | React.ReactNode;
    /** A figure or line under the title, such as the period's total. */
    headline?: React.ReactNode;
    /** A control on the right of the header: a link, a menu. */
    action?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <Card className={cls("min-w-0 px-5 py-4 flex flex-col", className)}>
            <div className="flex items-center gap-1.5 min-w-0">
                <HeaderIcon icon={icon}/>
                <Typography variant="micro" color="secondary" component="h3" className="truncate grow">{title}</Typography>
                {action}
            </div>
            {headline !== undefined && (
                <Typography variant="h4" component="div" className="mt-2">{headline}</Typography>
            )}
            <div className="mt-3 min-w-0 grow">{children}</div>
        </Card>
    );
}

/**
 * What a chart shows instead of marks: a shimmer while loading, the error, or
 * that there is nothing (the nearest `UiLabelsProvider`'s `noData`). Renders
 * nothing when none of the three applies.
 */
export function ChartStatus({ height, loading, error, empty }: {
    height: number;
    loading?: boolean;
    error?: Error;
    empty?: boolean;
}) {
    const labels = useUiLabels();
    if (!loading && !error && !empty) return null;
    return (
        <div className="flex items-center justify-center" style={{ height }}>
            {loading
                ? <Skeleton className="h-full"/>
                : (
                    <Typography variant="caption" color={error ? "error" : "secondary"} className="truncate" title={error?.message}>
                        {error ? error.message : labels.noData}
                    </Typography>
                )}
        </div>
    );
}
