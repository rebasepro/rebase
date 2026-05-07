import React, { useEffect, useMemo, useRef, useState } from "react";
import GridLayout from "react-grid-layout";
import type { Layout, LayoutItem } from "react-grid-layout";
import { verticalCompactor } from "react-grid-layout/core";
import "react-grid-layout/css/styles.css";
import "./grid-layout.css";
import { cls } from "@rebasepro/ui";
import { Dashboard, DashboardItem, DashboardPage, DateParams, Position, FilterValue, ParamFilter } from "../../types";
import { DashboardState, useCreateDashboardState } from "../../hooks/useCreateDashboardState";
import { DashboardFiltersBar, useFiltersStateView } from "../../hooks/useFiltersStateView";
import { getInitialParamFilters } from "../../utils/filters";
import GridWidgetWrapper from "./nodes/GridWidgetWrapper";
import { DashboardThemeProvider } from "./DashboardThemeContext";

const GRID_MARGIN: [number, number] = [8, 8];
const GRID_PADDING: [number, number] = [16, 32];
const GRID_SCALE = 25;
const DEFAULT_DASHBOARD_WIDTH = 1200;

const DashboardStateContext = React.createContext<DashboardState | undefined>(undefined);

export function useDashboardStateContext() {
    const context = React.useContext(DashboardStateContext);
    if (context === undefined) {
        throw new Error("useDashboardStateContext must be used within a DashboardStateContext");
    }
    return context;
}

function visualHeightToGridHeight(visualHeight: number): number {
    const marginY = GRID_MARGIN[1];
    return Math.ceil((visualHeight + marginY) / (GRID_SCALE + marginY));
}

// Same as DashboardPageView widgetsToLayout for desktop
function widgetsToLayoutDesktop(widgets: DashboardItem[]): LayoutItem[] {
    return widgets.map(w => {
        const gridX = Math.max(0, Math.round(w.position.x / GRID_SCALE));
        const gridY = Math.max(0, Math.round(w.position.y / GRID_SCALE));
        const gridW = Math.max(
            w.type === "scorecard" ? 6 :
                w.type === "filter" ? 6 :
                    w.type === "title" || w.type === "subtitle" || w.type === "text" ? 4 :
                        8,
            Math.round(w.size.width / GRID_SCALE)
        );

        const gridH = Math.max(
            w.type === "scorecard" ? 3 :
                w.type === "filter" ? 2 :
                    w.type === "title" ? 2 :
                        w.type === "subtitle" ? 2 :
                            w.type === "text" ? 2 :
                                5,
            visualHeightToGridHeight(w.size.height)
        );

        return {
            i: w.id,
            x: gridX,
            y: gridY,
            w: gridW,
            h: gridH,
            minW: w.type === "scorecard" ? 6 :
                w.type === "filter" ? 6 :
                    w.type === "title" || w.type === "subtitle" || w.type === "text" ? 4 :
                        8,
            minH: w.type === "scorecard" ? 3 :
                w.type === "filter" ? 2 :
                    w.type === "title" ? 2 :
                        w.type === "subtitle" ? 2 :
                            w.type === "text" ? 2 :
                                5
        };
    });
}

// Mobile layout: derive order from desktop layout (y then x), then stack full-width
function widgetsToLayoutMobileFromDesktop(desktopLayout: LayoutItem[], cols: number): LayoutItem[] {
    const sorted = [...desktopLayout].sort((a, b) => {
        if (a.y !== b.y) return a.y - b.y; // row order (top to bottom)
        return a.x - b.x;                  // within row, left to right
    });

    let currentY = 0;

    return sorted.map(item => {
        const layoutItem: LayoutItem = {
            i: item.i,
            x: 0,
            y: currentY,
            w: cols,
            h: item.h,
            minW: 1,
            minH: 1,
        };
        currentY += item.h;
        return layoutItem;
    });
}

export type DashboardEmbedFiltersProp = false | {
    /**
     * If false, hide the top bar UI (filters button + date range).
     * Values/dateRange can still be applied/enforced even when hidden.
     */
    topBar?: boolean;
    /** If true, user changes from the UI are ignored and the enforced values stay in place */
    enforce?: boolean;
    /** Force/prefill filter values by filter key */
    values?: Record<string, FilterValue>;
    /** Force/prefill date range (JS Dates) */
    dateRange?: {
        start?: Date | null;
        end?: Date | null;
    };
};

function normalizeDate(value: Date | null | undefined): Date | null {
    if (!value) return null;
    return isNaN(value.getTime()) ? null : value;
}

function applyEmbedFilterValues(paramFilters: ParamFilter[], enforced?: Record<string, FilterValue>): ParamFilter[] {
    if (!enforced) return paramFilters;
    // only apply keys that exist in the current paramFilters list (ignore unknown keys)
    return paramFilters.map(pf => {
        if (!(pf.key in enforced)) return pf;
        return {
            ...pf,
            value: enforced[pf.key]
        };
    });
}

export const DashboardPageReadOnlyView = ({
    page,
    dashboard,
    initialViewPosition,
    onAnalyticsEvent,
    filters: embedFilters
}: {
    page: DashboardPage,
    dashboard: Dashboard,
    initialViewPosition?: Position,
    onAnalyticsEvent?: (event: string, data?: any) => void,
    /** Embed-only: hide the top bar or prefill/enforce values */
    filters?: DashboardEmbedFiltersProp
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [gridWidth, setGridWidth] = useState<number>(DEFAULT_DASHBOARD_WIDTH);
    const [cols, setCols] = useState<number>(48);

    useEffect(() => {
        const updateWidth = () => {
            if (!containerRef.current) return;
            const wrapper = containerRef.current.querySelector<HTMLDivElement>(".dashboard-readonly-wrapper");
            const available = wrapper?.clientWidth ?? containerRef.current.clientWidth;
            const width = Math.min(available, DEFAULT_DASHBOARD_WIDTH);
            setGridWidth(width);

            // Desktop: 48 cols; tablet: 24; phone: 12
            if (width >= 1200) setCols(48);
            else if (width >= 768) setCols(24);
            else setCols(12);
        };
        updateWidth();
        window.addEventListener("resize", updateWidth);
        return () => window.removeEventListener("resize", updateWidth);
    }, []);

    const isDesktop = gridWidth >= 1200;

    const desktopLayout = useMemo(
        () => widgetsToLayoutDesktop(page.widgets),
        [page.widgets]
    );

    const layout = useMemo(() => {
        if (isDesktop) return desktopLayout;
        return widgetsToLayoutMobileFromDesktop(desktopLayout, cols);
    }, [desktopLayout, isDesktop, cols]);

    const embedFiltersConfig = typeof embedFilters === "boolean" ? undefined : embedFilters;
    const showTopBar = embedFilters === false ? false : (embedFiltersConfig?.topBar ?? true);
    const enforceEmbedFilters = embedFiltersConfig?.enforce ?? false;

    const initialDateRangeForEmbed = useMemo<[Date | null, Date | null] | undefined>(() => {
        if (!embedFiltersConfig?.dateRange) return undefined;
        const start = normalizeDate(embedFiltersConfig.dateRange.start);
        const end = normalizeDate(embedFiltersConfig.dateRange.end);
        // If both are missing/invalid, ignore
        if (!start && !end) return undefined;
        return [start, end];
    }, [embedFiltersConfig?.dateRange]);

    const {
        dateRange,
        setDateRange,
        paramFilters,
        setParamFilters,
        filters: dashboardFilters
    } = useFiltersStateView({
        initialDateRange: initialDateRangeForEmbed,
        initialParamFilters: getInitialParamFilters(page.filters ?? []),
        filters: page.filters,
        dashboardId: dashboard.id,
        onFilterUpdate: () => {
        },
        onFilterRemove: () => {
        }
    });

    // Apply embed-prefilled/enforced values on top of the synced param filters
    const effectiveParamFilters = useMemo(() => {
        return applyEmbedFilterValues(paramFilters, embedFiltersConfig?.values);
    }, [paramFilters, embedFiltersConfig?.values]);

    // Wrap setters when enforcement is enabled
    const setParamFiltersEffective = useMemo(() => {
        if (!enforceEmbedFilters) return setParamFilters;
        return (next: ParamFilter[]) => {
            // ignore external changes; keep enforced values
            setParamFilters(applyEmbedFilterValues(next, embedFiltersConfig?.values));
        };
    }, [enforceEmbedFilters, setParamFilters, embedFiltersConfig?.values]);

    const setDateRangeEffective = useMemo(() => {
        if (!enforceEmbedFilters || !embedFiltersConfig?.dateRange) return setDateRange;
        const start = normalizeDate(embedFiltersConfig.dateRange.start);
        const end = normalizeDate(embedFiltersConfig.dateRange.end);
        return (_next: [Date | null, Date | null]) => {
            setDateRange([start, end]);
        };
    }, [enforceEmbedFilters, setDateRange, embedFiltersConfig?.dateRange]);

    const effectiveDateRange = useMemo<[Date | null, Date | null]>(() => {
        if (!embedFiltersConfig?.dateRange) return dateRange;
        const start = normalizeDate(embedFiltersConfig.dateRange.start);
        const end = normalizeDate(embedFiltersConfig.dateRange.end);
        // preserve current state if both not provided
        if (start === null && end === null) return dateRange;
        return [start, end];
    }, [dateRange, embedFiltersConfig?.dateRange]);

    const params = useMemo<DateParams>(() => ({
        dateStart: effectiveDateRange[0] ?? null,
        dateEnd: effectiveDateRange[1] ?? null
    }), [effectiveDateRange]);

    const dashboardState = useCreateDashboardState({
        dashboard,
        page,
        params,
        paramFilters: effectiveParamFilters,
        setParamFilters: setParamFiltersEffective,
        filters: dashboardFilters,
        readOnly: true,
        onWidgetsUpdate: () => {
        },
        onPaperResize: () => {
        },
        onWidgetEdit: () => {
        },
        dashboardContainerRef: containerRef
    });

    return (
        <DashboardThemeProvider theme={dashboard.theme}>
        <DashboardStateContext.Provider value={dashboardState}>
            <div className="flex flex-col w-full h-full">
                {/* Header with filters */}
                {showTopBar && (
                    <div
                        className="flex flex-row items-center justify-between px-4 py-2 border-b border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900">
                        <div className="flex-1" />
                        <div className="flex gap-2">
                            <DashboardFiltersBar
                                filters={dashboardFilters}
                                paramFilters={effectiveParamFilters}
                                setParamFilters={setParamFiltersEffective}
                                dateRange={effectiveDateRange}
                                setDateRange={setDateRangeEffective}
                                dashboardId={dashboard.id}
                                includeFilters={true}
                            />
                        </div>
                    </div>
                )}

                {/* Grid container - max 1200px width, responsive down */}
                <div
                    ref={containerRef}
                    className="relative w-full h-full bg-surface-50 dark:bg-surface-900 flex-1 overflow-y-auto overflow-x-hidden p-2 md:p-6 lg:p-12"
                >
                    <div
                        className={cls("dashboard-readonly-wrapper transition-colors duration-200 rounded mx-auto w-full", "max-w-[1200px]")}
                        style={{
                            height: "fit-content"
                        }}
                    >
                        <GridLayout
                            className={cls("layout", "read-only")}
                            layout={layout}
                            gridConfig={{
                                cols,
                                rowHeight: GRID_SCALE,
                                margin: GRID_MARGIN,
                                containerPadding: GRID_PADDING,
                            }}
                            width={gridWidth}
                            dragConfig={{ enabled: false }}
                            resizeConfig={{ enabled: false, handles: ["se"] }}
                            dropConfig={{ enabled: false, defaultItem: { w: 4, h: 4 } }}
                            compactor={verticalCompactor}
                        >
                            {page.widgets.map(w => (
                                <div key={w.id} data-widget-id={w.id}>
                                    <GridWidgetWrapper
                                        widget={w}
                                        dashboardId={dashboard.id}
                                        pageId={page.id}
                                        params={params}
                                        paramFilters={effectiveParamFilters}
                                        filters={dashboardFilters}
                                        readOnly={true}
                                        onWidgetError={dashboardState.onWidgetError}
                                        onWidgetEdit={dashboardState.onWidgetEdit}
                                        onNodesDelete={dashboardState.onNodesDelete}
                                        onFilterValueChange={dashboardState.onFilterValueChange}
                                    />
                                </div>
                            ))}
                        </GridLayout>
                    </div>
                </div>
            </div>
        </DashboardStateContext.Provider>
        </DashboardThemeProvider>
    );
};
