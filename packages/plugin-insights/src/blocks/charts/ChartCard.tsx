import React, { useEffect, useState } from "react";
import { getIcon, useTranslation } from "@rebasepro/app";
import { cls, defaultBorderMixin, Typography } from "@rebasepro/ui";

/**
 * A chart on a card: the card header grammar (a small icon in the secondary
 * tier, the title in the micro tier), an optional headline figure under it,
 * and the chart.
 */
export function ChartCard({ title, icon, headline, action, className, children }: {
    title: string;
    /** An icon key, as `getIcon` takes it. */
    icon?: string;
    /** A figure or line under the title, such as the period's total. */
    headline?: React.ReactNode;
    /** A control on the right of the header: a link, a menu. */
    action?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}) {
    const iconNode = icon ? getIcon(icon, "text-text-secondary dark:text-text-secondary-dark", undefined, 14) : null;
    return (
        <section className={cls("rounded-xl bg-surface-card border min-w-0 px-5 py-4 flex flex-col", defaultBorderMixin, className)}>
            <div className="flex items-center gap-1.5 min-w-0">
                {iconNode && <span className="shrink-0 flex items-center [&>svg]:size-3.5">{iconNode}</span>}
                <Typography variant="micro" color="secondary" component="h3" className="truncate grow">{title}</Typography>
                {action}
            </div>
            {headline !== undefined && (
                <div className="mt-2 text-xl font-semibold text-text-primary dark:text-text-primary-dark">{headline}</div>
            )}
            <div className="mt-3 min-w-0 grow">{children}</div>
        </section>
    );
}

/** What a chart shows instead of marks: a pulse while loading, the error, or that there is nothing. */
export function ChartStatus({ height, loading, error, empty }: {
    height: number;
    loading?: boolean;
    error?: Error;
    empty?: boolean;
}) {
    const { t } = useTranslation();
    if (!loading && !error && !empty) return null;
    return (
        <div className="flex items-center justify-center" style={{ height }}>
            {loading
                ? <div className="w-full h-full rounded-md bg-surface-100 dark:bg-surface-800 animate-pulse"/>
                : (
                    <Typography variant="caption" color={error ? "error" : "secondary"} className="truncate" title={error?.message}>
                        {error ? error.message : t("insights_no_data")}
                    </Typography>
                )}
        </div>
    );
}

/**
 * The rendered width of the element the returned ref is attached to, kept
 * current as it resizes. A callback ref, so an element that mounts later —
 * after a loading state — is measured too.
 */
export function useElementWidth<E extends HTMLElement>(): [(element: E | null) => void, number] {
    const [element, setElement] = useState<E | null>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        if (!element) return;
        setWidth(element.getBoundingClientRect().width);
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);
    return [setElement, width];
}
