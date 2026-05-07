import { Lock } from "lucide-react";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { areDashboardPagesEqual, areDashboardsEqual } from "../../utils/comparators";
import { createPortal } from "react-dom";
import GridLayout from "react-grid-layout";
import type { Layout, LayoutItem } from "react-grid-layout";
import { createScaledStrategy, verticalCompactor } from "react-grid-layout/core";
import "react-grid-layout/css/styles.css";
import "./grid-layout.css";
import { cls, defaultBorderMixin, IconButton, Tooltip, Typography } from "@rebasepro/ui";
import {
    Dashboard,
    DashboardFilterConfig,
    DashboardItem,
    DashboardPage,
    DashboardTheme,
    DashboardUpdateType,
    DashboardWidgetConfig,
    DateParams,
    DryChartWidgetConfig,
    DryFilterWidgetConfig,
    DryScorecardWidgetConfig,
    DryTableWidgetConfig,
    FilterConfig,
    FilterWidgetItem,
    ParamFilter,
    Position,
    TextItem
} from "../../types";
import GridWidgetWrapper from "./nodes/GridWidgetWrapper";
import { useDataki } from "../../DatakiProvider";
import { DashboardAppbar } from "./DashboardAppbar";
import { DashboardState, useCreateDashboardState } from "../../hooks/useCreateDashboardState";
import { ShareDialog } from "../ShareDialog";
import { EmbedDialog } from "./EmbedDialog";
import { DashboardHistoryView } from "../DashboardHistoryView";
import { createNewSession, DashboardChatView, useDashboardChatController } from "../DashboardChatView";
import { getSidePanelWidth, saveSidePanelWidth } from "../../utils/side_panels";
import { DashboardFiltersBar, useFiltersStateView } from "../../hooks/useFiltersStateView";
import { getInitialParamFilters } from "../../utils/filters";
import {
    DEFAULT_DASHBOARD_WIDTH,
    DEFAULT_FILTER_SIZE,
    DEFAULT_SCORECARD_SIZE,
    DEFAULT_WIDGET_SIZE,
    generateWidgetId,
    SUBTITLE_HEIGHT,
    TEXT_HEIGHT,
    TEXT_WIDTH,
    TITLE_HEIGHT
} from "../../utils/widgets";
import { useNavigate } from "react-router-dom";
import { useResizeObserver } from "../../utils/useResizeObserver";
import { WidgetCacheProvider, useWidgetCache } from "../widgets/WidgetCacheContext";
import { DashboardThemePanel } from "./DashboardThemePanel";
import { DashboardThemeProvider } from "./DashboardThemeContext";

const GRID_MARGIN: [number, number] = [8, 8];
const GRID_PADDING: [number, number] = [16, 32]; // horizontal, vertical
const GRID_SCALE = 25;

function visualHeightToGridHeight(visualHeight: number): number {
    const marginY = GRID_MARGIN[1];
    return Math.ceil((visualHeight + marginY) / (GRID_SCALE + marginY));
}

function gridHeightToVisualHeight(gridH: number): number {
    const marginY = GRID_MARGIN[1];
    return gridH * GRID_SCALE + Math.max(0, gridH - 1) * marginY;
}

const DashboardStateContext = React.createContext<DashboardState | undefined>(undefined);

export function useDashboardStateContext() {
    const context = React.useContext(DashboardStateContext);
    if (context === undefined) {
        throw new Error("useDashboardStateContext must be used within a DashboardStateContext");
    }
    return context;
}

function widgetsToLayout(widgets: DashboardItem[]): LayoutItem[] {
    return widgets.map(w => {
        const gridX = Math.max(0, Math.round(w.position.x / GRID_SCALE));
        const gridY = Math.max(0, Math.round(w.position.y / GRID_SCALE));
        const gridW = Math.max(
            w.type === "scorecard" ? 6 : w.type === "filter" ? 6 : w.type === "title" || w.type === "subtitle" || w.type === "text" ? 4 : 8,
            Math.round(w.size.width / GRID_SCALE)
        );

        const gridH = Math.max(
            w.type === "scorecard" ? 3 : w.type === "filter" ? 2 : w.type === "title" ? 2 : w.type === "subtitle" ? 2 : w.type === "text" ? 2 : 5,
            visualHeightToGridHeight(w.size.height)
        );

        return {
            i: w.id,
            x: gridX,
            y: gridY,
            w: gridW,
            h: gridH,
            minW: w.type === "scorecard" ? 6 : w.type === "filter" ? 6 : w.type === "title" || w.type === "subtitle" || w.type === "text" ? 4 : 8,
            minH: w.type === "scorecard" ? 3 : w.type === "filter" ? 2 : w.type === "title" ? 2 : w.type === "subtitle" ? 2 : w.type === "text" ? 2 : 5
        };
    });
}

function layoutToWidgets(layout: LayoutItem[], widgets: DashboardItem[]): DashboardItem[] {
    return widgets.map(w => {
        const layoutItem = layout.find(l => l.i === w.id);
        if (!layoutItem) return w;

        const widgetHeight = gridHeightToVisualHeight(layoutItem.h);

        return {
            ...w,
            position: {
                x: layoutItem.x * GRID_SCALE,
                y: layoutItem.y * GRID_SCALE
            },
            size: {
                width: layoutItem.w * GRID_SCALE,
                height: widgetHeight
            }
        };
    });
}

const SidePanel = React.memo(React.forwardRef<HTMLDivElement, {
    panelOpen: "dashboard_chat" | "dashboard_history" | "dashboard_theme" | null,
    width: number,
    setHistoryPanelElement: (element: HTMLDivElement | null) => void,
    setChatPanelElement: (element: HTMLDivElement | null) => void,
    setThemePanelElement: (element: HTMLDivElement | null) => void,
    onResizeStart: (e: React.MouseEvent) => void,
    isResizing: boolean
}>(({
    panelOpen,
    width,
    setHistoryPanelElement,
    setChatPanelElement,
    setThemePanelElement,
    onResizeStart,
    isResizing
}, ref) => {
    return (
        <div
            ref={ref}
            className={cls(
                "h-full bg-surface-50 dark:bg-surface-950 overflow-hidden flex flex-row z-20 absolute top-0 right-0",
                // Conditional CSS transition
                isResizing ? "" : "transition-all duration-300 ease-in-out",
                panelOpen ? "opacity-100" : "opacity-0"
            )}
            style={{
                width: panelOpen ? `${width}%` : "0px",
                minWidth: panelOpen ? "300px" : "0px"
            }}
        >
            {/* Resize Handle */}
            <div
                className={cls("absolute left-0 top-0 bottom-0 w-1.5 z-30 cursor-col-resize hover:bg-accent-500/50 active:bg-accent-500 transition-colors flex items-center justify-center group",
                    { hidden: !panelOpen }
                )}
                onMouseDown={onResizeStart}
            >
                {/* Visual indicator on hover */}
                <div className="h-8 w-1 bg-slate-300 dark:bg-slate-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>

            <div ref={setHistoryPanelElement}
                className={cls("h-full w-full py-2 pr-2 pl-1", { hidden: panelOpen !== "dashboard_history" })} />

            <div ref={setChatPanelElement}
                className={cls("h-full w-full py-2 pr-2 pl-1", { hidden: panelOpen !== "dashboard_chat" })} />

            <div ref={setThemePanelElement}
                className={cls("h-full w-full py-2 pr-2 pl-1 overflow-y-auto", { hidden: panelOpen !== "dashboard_theme" })} />

        </div>
    );
}));

SidePanel.displayName = "SidePanel";



function AppBarContent({
    dashboard,
    dashboardState,
    onSharedClick,
    onEmbedClick,
    onDuplicateClick,
    readOnly,
    onNewWidgetClick,
    onStartTextPlacement,
    dateRangeView,
    onHistoryClick,
    isHistoryOpen,
    onThemeClick,
    isThemeOpen
}: {
    dashboard: Dashboard,
    dashboardState: DashboardState,
    onSharedClick: () => void,
    onEmbedClick: () => void,
    onDuplicateClick: () => void,
    readOnly: boolean,
    onNewWidgetClick: () => void,
    onStartTextPlacement: (type: "title" | "subtitle" | "text" | null) => void,
    dateRangeView: React.ReactNode,
    onHistoryClick: () => void,
    isHistoryOpen: boolean,
    onThemeClick?: () => void,
    isThemeOpen?: boolean
}) {
    const widgetCache = useWidgetCache();

    const onRefreshAll = useCallback(() => {
        widgetCache?.triggerRefresh();
    }, [widgetCache]);

    return (
        <>
            <DashboardAppbar
                dashboard={dashboard}
                dashboardState={dashboardState}
                onSharedClick={onSharedClick}
                onEmbedClick={onEmbedClick}
                onDuplicateClick={onDuplicateClick}
                className={"flex-1 shrink-1"}
                readOnly={readOnly}
                onNewWidgetClick={onNewWidgetClick}
                onStartTextPlacement={onStartTextPlacement}
                onRefreshAll={onRefreshAll}
                onHistoryClick={onHistoryClick}
                isHistoryOpen={isHistoryOpen}
                onThemeClick={onThemeClick}
                isThemeOpen={isThemeOpen}
            />
            {dateRangeView}
        </>
    );
}


export const DashboardPageView = React.memo(function DashboardPageView({
    page,
    dashboard,
    initialViewPosition,
    readOnly = false,
    onAnalyticsEvent
}: {
    page: DashboardPage,
    dashboard: Dashboard,
    initialViewPosition?: Position,
    readOnly?: boolean,
    onAnalyticsEvent?: (event: string, data?: any) => void
}) {
    const parentRef = useRef<HTMLDivElement>(null);
    const dashboardContainerRef = useRef<HTMLDivElement>(null);
    const gridWrapperRef = useRef<HTMLDivElement>(null);
    const sidePanelRef = useRef<HTMLDivElement>(null);
    const dashboardScaleWrapperRef = useRef<HTMLDivElement>(null);
    const dashboardScaleContainerRef = useRef<HTMLDivElement>(null);

    const dashboardChatController = useDashboardChatController();

    const navigate = useNavigate();
    const datakiConfig = useDataki();

    const [shareDialogOpen, setShareDialogOpen] = useState(false);
    const [embedDialogOpen, setEmbedDialogOpen] = useState(false);
    const [historyPanelElement, setHistoryPanelElement] = useState<HTMLDivElement | null>(null);
    const [chatPanelElement, setChatPanelElement] = useState<HTMLDivElement | null>(null);
    const [themePanelElement, setThemePanelElement] = useState<HTMLDivElement | null>(null);
    const [localTheme, setLocalTheme] = useState<DashboardTheme | undefined>(dashboard.theme);
    const [cameraLocked, setCameraLocked] = useState(true);
    const [containerWidth, setContainerWidth] = useState<number>(DEFAULT_DASHBOARD_WIDTH);
    const [isDragging, setIsDragging] = useState(false);
    const [isResizingPanel, setIsResizingPanel] = useState(false); // Track panel resize state

    const [contentHeight, setContentHeight] = useState<number>(0);
    const contentHeightRef = useRef<number>(0);

    const [textPlacementMode, setTextPlacementMode] = useState<{
        type: "title" | "subtitle" | "text";
        width: number;
        height: number;
    } | null>(null);

    const [filterPlacementMode, setFilterPlacementMode] = useState<DryFilterWidgetConfig | null>(null);
    const [widgetPlacementMode, setWidgetPlacementMode] = useState<DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig | null>(null);

    const windowSize = useResizeObserver({ current: document.body });

    const windowSizeRef = useRef(windowSize);
    useEffect(() => {
        windowSizeRef.current = windowSize;
    }, [windowSize]);

    const {
        dateRange,
        setDateRange,
        includeToday,
        onIncludeTodayChange,
        onPresetSelect,
        paramFilters,
        setParamFilters,
        filters
    } = useFiltersStateView({
        initialDateRange: undefined,
        initialParamFilters: getInitialParamFilters(page.filters ?? []),
        filters: page.filters,
        dashboardId: dashboard.id,
    });

    const onFilterUpdate = useCallback((updatedFilter: FilterConfig) => {
        onAnalyticsEvent?.("dashboard:filter_update", {
            dashboardId: dashboard.id,
            pageId: page.id,
            filterKey: updatedFilter.key
        });
        const currentParamFilter = paramFilters.find((f) => f.key === updatedFilter.key);

        const updatedParamFilter: ParamFilter = {
            key: updatedFilter.key,
            value: currentParamFilter?.value ?? null,
            operator: currentParamFilter?.operator ?? undefined,
            type: updatedFilter.type ?? currentParamFilter?.type
        }

        setParamFilters((currentParamFilter) => {
            const existingFilter = currentParamFilter.find((f) => f.key === updatedParamFilter.key);
            if (existingFilter) {
                return currentParamFilter.map((f) => f.key === updatedParamFilter.key ? updatedParamFilter : f);
            }
            return [...currentParamFilter, updatedParamFilter];
        });

        const updatedDashboard: Dashboard = {
            ...dashboard,
            pages: dashboard.pages.map((p) => {
                if (p.id === page.id) {
                    return {
                        ...p,
                        filters: p.filters.map((f) => {
                            if (f.key === updatedFilter.key) {
                                // Merge updated filter with existing position
                                return {
                                    ...updatedFilter,
                                    position: f.position
                                } as DashboardFilterConfig;
                            }
                            return f;
                        })
                    }
                }
                return p;
            })
        };
        datakiConfig.updateDashboard(dashboard.id, updatedDashboard, "filter_update");
    }, [dashboard, page.id, paramFilters, setParamFilters, datakiConfig, onAnalyticsEvent]);

    const onFilterRemove = useCallback((removedFilter: FilterConfig) => {
        onAnalyticsEvent?.("dashboard:filter_remove", {
            dashboardId: dashboard.id,
            pageId: page.id,
            filterKey: removedFilter.key
        });
        const updatedDashboard: Dashboard = {
            ...dashboard,
            pages: dashboard.pages.map((p) => {
                if (p.id === page.id) {
                    return {
                        ...p,
                        filters: p.filters.filter((f) => f.key !== removedFilter.key)
                    }
                }
                return p;
            })
        };
        datakiConfig.updateDashboard(dashboard.id, updatedDashboard, "filter_remove");
        setParamFilters((filters) => filters.filter((f) => f.key !== removedFilter.key));
    }, [dashboard, page.id, datakiConfig, onAnalyticsEvent, setParamFilters]);

    const onStartFilterPlacement = useCallback((filter: FilterConfig) => {
        onAnalyticsEvent?.("dashboard:filter_add_to_dashboard", {
            dashboardId: dashboard.id,
            pageId: page.id,
            filterKey: filter.key
        });

        const filterWidget: DryFilterWidgetConfig = {
            type: "filter",
            key: filter.key,
            label: filter.label,
            filterType: filter.type,
            dataSources: filter.dataSources,
            ...(filter.sqlQuery && { sqlQuery: filter.sqlQuery }),
            ...(filter.options && { options: filter.options }),
            ...(filter.placeholder && { placeholder: filter.placeholder }),
            ...(filter.defaultValue !== undefined && { defaultValue: filter.defaultValue })
        };

        setFilterPlacementMode(filterWidget);
    }, [dashboard.id, page.id, onAnalyticsEvent]);

    const onEndFilterPlacement = useCallback(() => {
        setFilterPlacementMode(null);
    }, []);

    const onCreateFirstFilter = useCallback(() => {
        onAnalyticsEvent?.("dashboard:create_first_filter_initiated", {
            dashboardId: dashboard.id,
            pageId: page.id
        });
        openPanel("dashboard_chat");
    }, [dashboard.id, page.id, onAnalyticsEvent]);

    const getInitialPanelState = (): "dashboard_chat" | "dashboard_history" | null => {
        const params = new URLSearchParams(window.location.search);
        const panelParam = params.get("panel");
        if (panelParam === "chat") return "dashboard_chat";
        if (panelParam === "history") return "dashboard_history";
        return null;
    };

    const [panelOpen, setPanelOpen] = useState<"dashboard_chat" | "dashboard_history" | "dashboard_theme" | null>(getInitialPanelState());
    const [updateTick, setUpdateTick] = useState(0); // Force re-render when width updates

    const openPanel = useCallback((panel: "dashboard_chat" | "dashboard_history" | "dashboard_theme" | null) => {
        onAnalyticsEvent?.(panel ? "dashboard:panel_opened" : "dashboard:panel_closed", {
            dashboardId: dashboard.id,
            panelId: panel ?? panelOpen
        });

        const url = new URL(window.location.href);
        if (panel === "dashboard_chat") {
            url.searchParams.set("panel", "chat");
        } else if (panel === "dashboard_history") {
            url.searchParams.set("panel", "history");
        } else {
            url.searchParams.delete("panel");
        }

        window.history.replaceState({}, "", url);
        setPanelOpen(panel);
    }, [dashboard.id, panelOpen, onAnalyticsEvent]);

    const updatePanelWidth = useCallback((width: number) => {
        if (panelOpen) {
            saveSidePanelWidth(panelOpen, width);
            setUpdateTick(t => t + 1);
        }
    }, [panelOpen]);

    const sidePanelWidth = useMemo(() => panelOpen ? getSidePanelWidth(panelOpen) : 0, [panelOpen, updateTick]);

    const dateRangeView = useMemo(() => (
        <DashboardFiltersBar
            filters={filters}
            paramFilters={paramFilters}
            setParamFilters={setParamFilters}
            dashboardId={dashboard.id}
            dateRange={dateRange}
            setDateRange={setDateRange}
            includeToday={includeToday}
            onIncludeTodayChange={onIncludeTodayChange}
            onPresetSelect={onPresetSelect}
            onFilterUpdate={onFilterUpdate}
            onFilterRemove={onFilterRemove}
            onStartFilterPlacement={onStartFilterPlacement}
            onEndFilterPlacement={onEndFilterPlacement}
            onCreateFirstFilter={onCreateFirstFilter}
        />
    ), [filters, paramFilters, setParamFilters, dashboard.id, dateRange, setDateRange, includeToday, onIncludeTodayChange, onPresetSelect, onFilterUpdate, onFilterRemove, onStartFilterPlacement, onEndFilterPlacement, onCreateFirstFilter]);

    const isResizingRef = useRef(false);
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);
    const currentDragWidthRef = useRef(0);
    const lastThrottleTime = useRef(0);

    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizingRef.current = true;
        setIsResizingPanel(true); // Trigger re-render to remove transition class
        startXRef.current = e.clientX;

        // Measure current width directly from DOM to avoid state drift
        if (sidePanelRef.current) {
            const w = sidePanelRef.current.getBoundingClientRect().width;
            startWidthRef.current = w;
            currentDragWidthRef.current = w;
        } else {
            const currentWindowWidth = windowSizeRef.current?.width || window.innerWidth;
            startWidthRef.current = (currentWindowWidth * sidePanelWidth) / 100;
        }

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, [sidePanelWidth]);

    // Calculate target panel width in pixels based on current window size
    const getTargetPanelWidth = useCallback(() => {
        if (!panelOpen || !windowSize?.width) return 0;
        const pctWidth = (windowSize.width * sidePanelWidth) / 100;
        return Math.max(300, pctWidth);
    }, [panelOpen, windowSize, sidePanelWidth]);

    // Viewport adjustment callback - Updates containerWidth based on state
    // Accepts overrideWidth for throttled updates during drag
    const adjustViewport = useCallback((overrideWidth?: number) => {
        const currentWindowWidth = window.innerWidth;
        const padding = currentWindowWidth < 768 ? 16 : currentWindowWidth < DEFAULT_DASHBOARD_WIDTH ? 32 : 64;

        let panelWidthPx = 0;
        if (overrideWidth !== undefined) {
            panelWidthPx = overrideWidth;
        } else {
            // If resizing but no override provided (e.g. window resize event), use current drag width
            // Otherwise fall back to target
            panelWidthPx = (isResizingRef.current && currentDragWidthRef.current > 0)
                ? currentDragWidthRef.current
                : (!panelOpen ? 0 : getTargetPanelWidth());
        }

        const availableWidth = currentWindowWidth - panelWidthPx - padding;
        setContainerWidth(availableWidth);
    }, [panelOpen, getTargetPanelWidth]);

    // Update viewport when panel state changes (open/close) or window resizes
    useEffect(() => {
        if (!isResizingRef.current) {
            adjustViewport();
        }
        const handleResize = () => adjustViewport();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [panelOpen, sidePanelWidth, isResizingPanel, adjustViewport]);

    // Handle Resize End to update layout to final drag position
    const handleResizeEnd = useCallback(() => {
        adjustViewport();
    }, [adjustViewport]);


    // Restore manual styles after render if resizing
    // This prevents React from clearing the style during throttled renders
    useLayoutEffect(() => {
        if (isResizingPanel && currentDragWidthRef.current > 0) {
            if (parentRef.current) {
                parentRef.current.style.paddingRight = `${currentDragWidthRef.current}px`;
            }
            // SidePanel is memoized so it retains its DOM state, but we can enforce it if needed
            if (sidePanelRef.current) {
                sidePanelRef.current.style.width = `${currentDragWidthRef.current}px`;
            }
        }
    }, [isResizingPanel, containerWidth]); // Dependency on containerWidth ensures it runs after throttled render


    // Dragging Logic - Updates DOM (60fps) and Throttles State (100ms)
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingRef.current) return;

            const delta = startXRef.current - e.clientX;
            let newWidth = startWidthRef.current + delta;

            // Constraints
            const maxWidth = (windowSize?.width || window.innerWidth) * 0.8;
            newWidth = Math.max(300, Math.min(newWidth, maxWidth));

            currentDragWidthRef.current = newWidth;

            // 1. Direct DOM update for performance (60fps)
            if (sidePanelRef.current) {
                sidePanelRef.current.style.width = `${newWidth}px`;
            }
            if (parentRef.current) {
                parentRef.current.style.paddingRight = `${newWidth}px`;
            }

            // 2. Throttled Layout Update (100ms)
            const now = Date.now();
            if (now - lastThrottleTime.current > 100) {
                adjustViewport(newWidth);
                lastThrottleTime.current = now;
            }
        };

        const handleMouseUp = () => {
            if (isResizingRef.current) {
                isResizingRef.current = false;
                setIsResizingPanel(false); // Re-enable transitions
                document.body.style.cursor = "";
                document.body.style.userSelect = "";

                // Final layout update
                const finalWidth = currentDragWidthRef.current;

                // Save new width as percentage
                if (finalWidth > 0) {
                    const currentWindowWidth = windowSize?.width || window.innerWidth;
                    if (currentWindowWidth > 0) {
                        const newPercent = (finalWidth / currentWindowWidth) * 100;
                        updatePanelWidth(newPercent);
                        // Ensure final state sync
                        adjustViewport(finalWidth);
                    }
                }
            }
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [updatePanelWidth, windowSize, adjustViewport]);


    const appBarRef = datakiConfig.appBarRef;


    const toggleChatPanel = useCallback(() => {
        openPanel(panelOpen === "dashboard_chat" ? null : "dashboard_chat");
    }, [openPanel, panelOpen]);

    const toggleHistoryPanel = useCallback(() => {
        openPanel(panelOpen === "dashboard_history" ? null : "dashboard_history");
    }, [openPanel, panelOpen]);

    const toggleThemePanel = useCallback(() => {
        openPanel(panelOpen === "dashboard_theme" ? null : "dashboard_theme");
    }, [openPanel, panelOpen]);

    // Calculate Scale Factor based on State

    const scaleFactor = useMemo(() => {

        if (!cameraLocked) return 1;

        const targetWidth = DEFAULT_DASHBOARD_WIDTH;

        if (!containerWidth || containerWidth <= 0) return 1;

        return Math.max(0.1, Math.min(1, containerWidth / targetWidth));

    }, [cameraLocked, containerWidth]);



    useEffect(() => {

        const element = gridWrapperRef.current;

        if (!element) return;

        const observer = new ResizeObserver((entries) => {

            for (const entry of entries) {

                const h = entry.contentRect.height;

                setContentHeight(h);

                contentHeightRef.current = h;

            }

        });

        observer.observe(element);

        return () => observer.disconnect();

    }, []);

    const onSharedClick = useCallback(() => {
        onAnalyticsEvent?.("dashboard:share_dashboard_initiated", { dashboardId: dashboard.id });
        setShareDialogOpen(true);
    }, [dashboard.id, onAnalyticsEvent]);

    const onEmbedClick = useCallback(() => {
        onAnalyticsEvent?.("dashboard:embed_dialog_opened", { dashboardId: dashboard.id });
        setEmbedDialogOpen(true);
    }, [dashboard.id, onAnalyticsEvent]);

    const onDuplicateClick = useCallback(async () => {
        onAnalyticsEvent?.("dashboard:duplicate_dashboard_initiated", { dashboardId: dashboard.id });
        try {
            const newDashboard = await datakiConfig.duplicateDashboard(dashboard.id);
            navigate(`/dashboards/${newDashboard.id}`);
        } catch (error) {
            console.error("Failed to duplicate dashboard:", error);
        }
    }, [dashboard.id, datakiConfig, navigate, onAnalyticsEvent]);

    const params: DateParams = useMemo(() => ({
        dateStart: dateRange[0] ?? null,
        dateEnd: dateRange[1] ?? null
    }), [dateRange]);

    const onWidgetEdit = useCallback(async (widget: DashboardItem, error?: Error) => {
        onAnalyticsEvent?.("dashboard:widget_edit_initiated", {
            dashboardId: dashboard.id,
            widgetId: widget.id
        });
        const chatId = await datakiConfig.createChatSessionId();
        const newSession = createNewSession(chatId, dashboard.id, widget.id, error);
        dashboardChatController.setSelectedSession(newSession);
        openPanel("dashboard_chat");
    }, [dashboard.id, datakiConfig, dashboardChatController, openPanel, onAnalyticsEvent]);

    const onWidgetsUpdate = useCallback((updatedWidgets: DashboardItem[], updateType: DashboardUpdateType) => {
        const updatedDashboard: Dashboard = {
            ...dashboard,
            pages: dashboard.pages.map(p =>
                p.id === page.id ? {
                    ...p,
                    widgets: updatedWidgets
                } : p
            )
        };
        datakiConfig.updateDashboard(dashboard.id, updatedDashboard, updateType);
    }, [dashboard, page.id, datakiConfig]);

    const onPaperResize = useCallback(() => { }, []);

    // Stable dashboard state to prevent context thrashing -> preventing persistent chat re-renders
    const dashboardState = useCreateDashboardState({
        dashboard,
        page,
        onWidgetsUpdate,
        params,
        paramFilters,
        setParamFilters,
        filters,
        readOnly,
        onPaperResize,
        dashboardContainerRef,
        onWidgetEdit
    });

    const handleLayoutChange = useCallback((newLayout: LayoutItem[], updateType: "widget_move" | "widget_resize") => {
        if (readOnly || textPlacementMode || filterPlacementMode || widgetPlacementMode) return;

        const updatedWidgets = layoutToWidgets(newLayout, page.widgets);

        let hasChanges = false;
        if (updateType === "widget_resize") {
            hasChanges = updatedWidgets.some(widget => {
                const originalWidget = page.widgets.find(w => w.id === widget.id);
                return originalWidget &&
                    (originalWidget.size.width !== widget.size.width ||
                        originalWidget.size.height !== widget.size.height);
            });
        } else {
            hasChanges = updatedWidgets.some(widget => {
                const originalWidget = page.widgets.find(w => w.id === widget.id);
                return originalWidget &&
                    (originalWidget.position.x !== widget.position.x ||
                        originalWidget.position.y !== widget.position.y);
            });
        }

        if (hasChanges) {
            dashboardState.updateStateAndHistory(updatedWidgets, updateType);
        }
    }, [page.widgets, readOnly, textPlacementMode, filterPlacementMode, widgetPlacementMode, dashboardState]);

    const onLayoutChangeCallback = useCallback((l: Layout) => {
        // if (!isDragging) handleLayoutChange(l, "widget_move");
    }, []);

    const handleDragStart = useCallback((_layout: Layout, _oldItem: LayoutItem | null, _newItem: LayoutItem | null) => {
        setIsDragging(true);
    }, []);

    const handleDragStop = useCallback((newLayout: Layout, _oldItem: LayoutItem | null, _newItem: LayoutItem | null) => {
        setIsDragging(false);
        handleLayoutChange([...newLayout], "widget_move");
    }, [handleLayoutChange]);

    const handleResizeStop = useCallback((newLayout: Layout, _oldItem: LayoutItem | null, _newItem: LayoutItem | null) => {
        handleLayoutChange([...newLayout], "widget_resize");
    }, [handleLayoutChange]);

    const scrollToWidget = useCallback((widgetId: string) => {
        setTimeout(() => {
            const widgetElement = document.querySelector(`[data-widget-id="${widgetId}"]`);

            if (widgetElement && dashboardContainerRef.current) {
                const containerRect = dashboardContainerRef.current.getBoundingClientRect();
                const widgetRect = widgetElement.getBoundingClientRect();

                const scrollTop = dashboardContainerRef.current.scrollTop +
                    (widgetRect.top - containerRect.top) -
                    (containerRect.height / 2) +
                    (widgetRect.height / 2);

                dashboardContainerRef.current.scrollTo({
                    top: scrollTop,
                    behavior: "smooth"
                });
            }
        }, 300);
    }, []);

    const handleWidgetUpdated = useCallback((widget: DashboardWidgetConfig | FilterWidgetItem) => {
        scrollToWidget(widget.id);
    }, [scrollToWidget]);

    const startTextPlacement = useCallback((type: "title" | "subtitle" | "text" | null) => {
        if (type === null) {
            setTextPlacementMode(null);
            return;
        }
        const width = TEXT_WIDTH;
        const height = type === "title" ? TITLE_HEIGHT : type === "subtitle" ? SUBTITLE_HEIGHT : TEXT_HEIGHT;
        setTextPlacementMode({
            type,
            width,
            height
        });
    }, []);

    const cancelTextPlacement = useCallback(() => {
        setTextPlacementMode(null);
    }, []);

    const cancelFilterPlacement = useCallback(() => {
        setFilterPlacementMode(null);
    }, []);

    const startWidgetPlacement = useCallback((config: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig | null) => {
        setWidgetPlacementMode(config);
    }, []);

    const cancelWidgetPlacement = useCallback(() => {
        setWidgetPlacementMode(null);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (textPlacementMode) {
                    cancelTextPlacement();
                } else if (filterPlacementMode) {
                    cancelFilterPlacement();
                } else if (widgetPlacementMode) {
                    cancelWidgetPlacement();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [textPlacementMode, filterPlacementMode, widgetPlacementMode, cancelTextPlacement, cancelFilterPlacement, cancelWidgetPlacement]);

    useEffect(() => {
        if (filterPlacementMode || textPlacementMode || widgetPlacementMode) {
            document.body.style.cursor = "crosshair";
        } else document.body.style.cursor = "";
    }, [filterPlacementMode, textPlacementMode, widgetPlacementMode]);

    useEffect(() => {
        if (filterPlacementMode || textPlacementMode || widgetPlacementMode) {
            setIsDragging(true);
        } else setIsDragging(false);
    }, [filterPlacementMode, textPlacementMode, widgetPlacementMode]);

    const onGridDragOver = useCallback((e: React.DragEvent) => {
        if (filterPlacementMode || textPlacementMode || widgetPlacementMode) {
            e.preventDefault(); // Required to allow drop
            e.dataTransfer.dropEffect = "copy";
        }
    }, [filterPlacementMode, textPlacementMode, widgetPlacementMode]);

    const onGridDrop = useCallback((e: React.DragEvent) => {
        if (filterPlacementMode || textPlacementMode || widgetPlacementMode) {
            e.preventDefault();
            // Let react-grid-layout handle the actual drop
        }
    }, [filterPlacementMode, textPlacementMode, widgetPlacementMode]);

    const handleDrop = useCallback((layout: Layout, layoutItem: LayoutItem | undefined, _event: Event) => {
        setIsDragging(false);
        if (!layoutItem) return;

        if (textPlacementMode) {
            const newWidget: TextItem = {
                id: generateWidgetId(),
                type: textPlacementMode.type,
                text: "",
                position: {
                    x: layoutItem.x * GRID_SCALE,
                    y: layoutItem.y * GRID_SCALE
                },
                size: {
                    width: layoutItem.w * GRID_SCALE,
                    height: layoutItem.h * GRID_SCALE
                }
            };

            // Manual update since dashboardState might not have helper
            const updatedExistingWidgets = layoutToWidgets([...layout], page.widgets);
            const allWidgets = [...updatedExistingWidgets, newWidget];

            const updatedDashboard = {
                ...dashboard,
                pages: dashboard.pages.map((p) => {
                    if (p.id === page.id) {
                        return {
                            ...p,
                            widgets: allWidgets
                        };
                    }
                    return p;
                })
            };

            datakiConfig.updateDashboard(dashboard.id, updatedDashboard, "widget_create");
            setTextPlacementMode(null);

            setTimeout(() => {
                const widgetElement = document.querySelector(`[data-widget-id="${newWidget.id}"] textarea`);
                if (widgetElement) {
                    (widgetElement as HTMLTextAreaElement).focus();
                }
            }, 100);

        } else if (filterPlacementMode) {
            const newFilterWidget: FilterWidgetItem = {
                ...filterPlacementMode,
                id: generateWidgetId(),
                position: {
                    x: layoutItem.x * GRID_SCALE,
                    y: layoutItem.y * GRID_SCALE
                },
                size: {
                    width: layoutItem.w * GRID_SCALE,
                    height: layoutItem.h * GRID_SCALE
                }
            };

            const updatedExistingWidgets = layoutToWidgets([...layout], page.widgets);
            const allWidgets = [...updatedExistingWidgets, newFilterWidget];

            const updatedDashboard = {
                ...dashboard,
                pages: dashboard.pages.map((p) => {
                    if (p.id === page.id) {
                        return {
                            ...p,
                            widgets: allWidgets
                        };
                    }
                    return p;
                })
            };

            datakiConfig.updateDashboard(dashboard.id, updatedDashboard, "widget_create");
            setFilterPlacementMode(null);
        } else if (widgetPlacementMode) {
            const defaultSize = widgetPlacementMode.type === "scorecard" ? DEFAULT_SCORECARD_SIZE : DEFAULT_WIDGET_SIZE;
            const newWidget: DashboardWidgetConfig = {
                ...widgetPlacementMode,
                id: generateWidgetId(),
                position: {
                    x: layoutItem.x * GRID_SCALE,
                    y: layoutItem.y * GRID_SCALE
                },
                size: {
                    width: layoutItem.w * GRID_SCALE,
                    height: gridHeightToVisualHeight(layoutItem.h)
                }
            };

            const updatedExistingWidgets = layoutToWidgets([...layout], page.widgets);
            const allWidgets = [...updatedExistingWidgets, newWidget];

            dashboardState.updateStateAndHistory(allWidgets, "widget_create");
            setWidgetPlacementMode(null);
            scrollToWidget(newWidget.id);
        }
    }, [textPlacementMode, filterPlacementMode, widgetPlacementMode, dashboard, page, datakiConfig, scrollToWidget]);

    const layout = useMemo(() => {
        return widgetsToLayout(page.widgets);
    }, [page.widgets]);

    return (
        <>
        <DashboardThemeProvider theme={localTheme}>
        <WidgetCacheProvider>
            <DashboardStateContext.Provider value={dashboardState}>
                <ShareDialog
                    dashboard={dashboard}
                    open={shareDialogOpen}
                    onOpenChange={setShareDialogOpen}
                />

                <EmbedDialog
                    dashboard={dashboard}
                    open={embedDialogOpen}
                    onOpenChange={setEmbedDialogOpen}
                />

                <div className={"flex w-full h-full relative overflow-hidden"}>
                    <div
                        className={cls("w-full h-full min-w-0 flex flex-col",
                            // Add transition unless we are resizing
                            isResizingPanel ? "" : "transition-all duration-300 ease-in-out"
                        )}
                        ref={parentRef}
                        style={{
                            paddingRight: isResizingPanel ? undefined : (panelOpen ? `${sidePanelWidth}%` : "0px")
                        }}
                    >
                        <div className={"flex flex-col w-full h-full relative"}>
                            {appBarRef.current &&
                                createPortal(
                                    <AppBarContent
                                        dashboard={dashboard}
                                        dashboardState={dashboardState}
                                        onSharedClick={onSharedClick}
                                        onEmbedClick={onEmbedClick}
                                        onDuplicateClick={onDuplicateClick}
                                        readOnly={readOnly}
                                        onNewWidgetClick={toggleChatPanel}
                                        onStartTextPlacement={startTextPlacement}
                                        dateRangeView={dateRangeView}
                                        onHistoryClick={toggleHistoryPanel}
                                        isHistoryOpen={panelOpen === "dashboard_history"}
                                        onThemeClick={toggleThemePanel}
                                        isThemeOpen={panelOpen === "dashboard_theme"}
                                    />,
                                    appBarRef.current
                                )
                            }

                            {!readOnly && (
                                <Tooltip title={"Lock camera to maintain dashboard width"}
                                    className={"absolute bottom-4 left-4 z-10"}
                                    side={"right"}>
                                    <IconButton
                                        size={"smallest"}
                                        variant={"ghost"}
                                        shape={"square"}
                                        className={cls(
                                            defaultBorderMixin,
                                            cameraLocked ? "border bg-surface-accent-100 dark:bg-surface-800" : "bg-surface-50 dark:bg-surface-900"
                                        )}
                                        onClick={() => {
                                            onAnalyticsEvent?.("dashboard:camera_lock_toggled", {
                                                dashboardId: dashboard.id,
                                                locked: !cameraLocked
                                            });
                                            setCameraLocked(!cameraLocked);
                                        }}
                                    >
                                        <Lock size={"smallest"} />
                                    </IconButton>
                                </Tooltip>
                            )}


                            <div
                                ref={dashboardContainerRef}
                                className={cls(
                                    "relative w-full h-full bg-surface-50 dark:bg-surface-950/80 flex-1 p-2 md:p-6 lg:p-12",
                                    cameraLocked ? "overflow-y-auto overflow-x-hidden" : "overflow-auto"
                                )}
                                style={{
                                    backgroundColor: "var(--dataki-bg)",
                                    color: "var(--dataki-text)",
                                }}
                            >
                                <div
                                    ref={dashboardScaleContainerRef}
                                    className={cls(
                                        "transition-all duration-300 ease-in-out", // Add transition for smooth height/width change
                                        (() => {
                                            const shouldShowBlue = isDragging || textPlacementMode || filterPlacementMode || widgetPlacementMode;
                                            return shouldShowBlue && "bg-accent-50/30 dark:bg-accent-950/20";
                                        })()
                                    )}
                                    style={{
                                        position: "relative",
                                        margin: "0 auto",
                                        // overflow: "hidden", // Removed to prevent clipping when scaling up

                                        // Height calculation to remove empty space when scaled
                                        height: cameraLocked && contentHeight > 0
                                            ? `${contentHeight * scaleFactor}px`
                                            : "fit-content",

                                        // Explicit width logic:
                                        // Locked: use scaled width.
                                        // Unlocked: use exact dashboard width.
                                        width: cameraLocked
                                            ? `${DEFAULT_DASHBOARD_WIDTH * scaleFactor}px`
                                            : `${DEFAULT_DASHBOARD_WIDTH}px`
                                    }}
                                >
                                    <div
                                        ref={dashboardScaleWrapperRef}
                                        className={cls(
                                            "transition-transform duration-300 ease-in-out", // Add transition for smooth scale
                                            (isDragging || textPlacementMode || filterPlacementMode || widgetPlacementMode) && "bg-accent-50/30 dark:bg-accent-950/20"
                                        )}
                                        style={{
                                            transform: `scale(${scaleFactor})`,
                                            transformOrigin: "top left",
                                            width: DEFAULT_DASHBOARD_WIDTH,
                                            height: "fit-content"
                                        }}
                                    >
                                        <div
                                            ref={gridWrapperRef}
                                            onDragOver={onGridDragOver}
                                            onDrop={onGridDrop}
                                        >
                                            <GridLayout
                                                className={cls("layout", readOnly ? "read-only" : "editable")}
                                                layout={layout}
                                                gridConfig={{
                                                    cols: 48,
                                                    rowHeight: GRID_SCALE,
                                                    margin: GRID_MARGIN,
                                                    containerPadding: GRID_PADDING,
                                                }}
                                                width={DEFAULT_DASHBOARD_WIDTH}
                                                positionStrategy={createScaledStrategy(scaleFactor)}
                                                compactor={verticalCompactor}
                                                onDragStart={handleDragStart}
                                                onDragStop={handleDragStop}
                                                onResizeStop={handleResizeStop}
                                                onDrop={handleDrop}
                                                dragConfig={{ enabled: !readOnly, cancel: ".nodrag" }}
                                                resizeConfig={{ enabled: !readOnly, handles: ["se"] }}
                                                dropConfig={{ enabled: !readOnly, defaultItem: { w: 4, h: 4 } }}
                                                onLayoutChange={onLayoutChangeCallback}
                                                droppingItem={
                                                    textPlacementMode ? {
                                                        i: "__dropping__",
                                                        x: 0, y: 0,
                                                        w: Math.round(textPlacementMode.width / GRID_SCALE),
                                                        h: Math.round(textPlacementMode.height / GRID_SCALE)
                                                    } : filterPlacementMode ? {
                                                        i: "__dropping__",
                                                        x: 0, y: 0,
                                                        w: Math.round(DEFAULT_FILTER_SIZE.width / GRID_SCALE),
                                                        h: Math.round(DEFAULT_FILTER_SIZE.height / GRID_SCALE)
                                                    } : widgetPlacementMode ? {
                                                        i: "__dropping__",
                                                        x: 0, y: 0,
                                                        w: Math.round((widgetPlacementMode.size?.width ?? (widgetPlacementMode.type === "scorecard" ? DEFAULT_SCORECARD_SIZE.width : DEFAULT_WIDGET_SIZE.width)) / GRID_SCALE),
                                                        h: visualHeightToGridHeight(widgetPlacementMode.size?.height ?? (widgetPlacementMode.type === "scorecard" ? DEFAULT_SCORECARD_SIZE.height : DEFAULT_WIDGET_SIZE.height))
                                                    } : undefined
                                                }
                                            >
                                                {page.widgets.map(w => (
                                                    <div key={w.id} data-widget-id={w.id}>
                                                        <GridWidgetWrapper
                                                            widget={w}
                                                            dashboardId={dashboard.id}
                                                            pageId={page.id}
                                                            params={params}
                                                            paramFilters={paramFilters}
                                                            filters={filters}
                                                            readOnly={readOnly}
                                                            onWidgetError={dashboardState.onWidgetError}
                                                            onWidgetEdit={dashboardState.onWidgetEdit}
                                                            onNodesDelete={dashboardState.onNodesDelete}
                                                            onFilterValueChange={dashboardState.onFilterValueChange as any}
                                                        />
                                                    </div>
                                                ))}
                                            </GridLayout>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {!readOnly && (
                        <SidePanel
                            ref={sidePanelRef}
                            panelOpen={panelOpen}
                            width={sidePanelWidth}
                            setHistoryPanelElement={setHistoryPanelElement}
                            setChatPanelElement={setChatPanelElement}
                            setThemePanelElement={setThemePanelElement}
                            onResizeStart={handleResizeStart}
                            isResizing={isResizingPanel}
                        />
                    )}

                    {historyPanelElement && createPortal(
                        <DashboardHistoryView
                            dashboardId={dashboard.id}
                            onClose={() => openPanel(null)}
                            hidden={panelOpen !== "dashboard_history"}
                        />,
                        historyPanelElement
                    )}

                    {chatPanelElement && createPortal(
                        <DashboardChatView
                            dashboardChatController={dashboardChatController}
                            dashboardState={dashboardState}
                            onClose={() => openPanel(null)}
                            paramFilters={paramFilters}
                            filters={filters}
                            onDashboardWidgetUpdated={handleWidgetUpdated}
                            dateRange={dateRange}
                            hidden={panelOpen !== "dashboard_chat"}
                            onStartWidgetPlacement={startWidgetPlacement}
                        />,
                        chatPanelElement
                    )}
                </div>
            </DashboardStateContext.Provider>
        </WidgetCacheProvider>
        </DashboardThemeProvider>

        {themePanelElement && createPortal(
            <DashboardThemePanel
                dashboard={dashboard}
                onClose={() => openPanel(null)}
                onThemeChange={setLocalTheme}
            />,
            themePanelElement
        )}
        </>
    );
}, (prev, next) => {
    // If readOnly changes, we must re-render
    if (prev.readOnly !== next.readOnly) return false;

    // If initialViewPosition changes (reference equality usually sufficient or shallow compare)
    if (prev.initialViewPosition !== next.initialViewPosition) return false;

    // Deep compare dashboard and page
    // Note: onAnalyticsEvent is a function, we assume it's stable or we ignore it (usually ignored in memo)
    // but strict equality check is safer for functions if we don't want to ignore.
    // However, for performance we usually ignore callback props if we trust they don't change logic often
    // or are memoized themselves. DashboardView passes stable callbacks usually.

    return areDashboardsEqual(prev.dashboard, next.dashboard) &&
        areDashboardPagesEqual(prev.page, next.page);
});
