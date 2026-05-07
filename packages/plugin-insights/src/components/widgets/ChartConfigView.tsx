import { Clock, Download, Filter, GripVertical, RefreshCw, Settings, Trash2 } from "lucide-react";
import React, { useEffect, useState, useCallback } from "react";
import equal from "react-fast-compare"

import { hydrateWidgetConfig } from "../../api";
import { useDataki } from "../../DatakiContext";
import { useWidgetCache } from "./WidgetCacheContext";
import {
    DashboardFilterConfig,
    DateParams,
    DryChartWidgetConfig,
    DryWidgetConfig,
    ParamFilter,
    WidgetConfig
} from "../../types";
import { useModeController } from "@rebasepro/core";
import { ErrorBoundary, mergeDeep } from "../../utils/compat";
import { ChartView } from "./ChartView";
import { cls, IconButton, Tooltip, Typography } from "@rebasepro/ui";
import { ChartSkeleton } from "./skeletons";
import { ConfigViewDialog } from "./ConfigViewDialog";
import { toPng } from "html-to-image";
import { downloadImage } from "../../utils/downloadImage";
import { ExecutionErrorView } from "./ExecutionErrorView";
import {
    DEFAULT_WIDGET_SIZE,
    getConfigWithoutSize,
    getUsedParamsForConfig,
    isConfigRelatedToParam,
    isConfigUsingDateParams
} from "../../utils/widgets";
import { useWidgetDrag } from "../chat/WidgetDragContext";

type LoadedConfig = {
    dryConfig: DryChartWidgetConfig,
    params?: DateParams,
    paramFilters?: ParamFilter[],
    filters?: DashboardFilterConfig[]
};

export function ChartConfigView({
    dryConfig,
    params,
    paramFilters,
    filters,
    onUpdated,
    onRemoveClick,
    dashboardId,
    maxWidth,
    selected,
    actions,
    className,
    readOnly,
    onError,
    includeDataSourceSelection
}: {
    dryConfig: DryChartWidgetConfig,
    params: DateParams,
    paramFilters: ParamFilter[],
    filters: DashboardFilterConfig[],
    onUpdated?: (newConfig: DryChartWidgetConfig) => void,
    onRemoveClick?: () => void,
    dashboardId?: string,
    maxWidth?: number,
    selected?: boolean,
    actions?: React.ReactNode,
    className?: string,
    readOnly?: boolean,
    onError?: (error: Error | null) => void,
    includeDataSourceSelection?: boolean
}) {

    const {
        apiEndpoint,
        getDatakiAuthToken,
        embedApiKey
    } = useDataki();

    const { mode } = useModeController();

    const [configDialogOpen, setConfigDialogOpen] = React.useState(false);

    const [config, setConfig] = useState<WidgetConfig | null>(null);
    const [hydrationInProgress, setHydrationInProgress] = useState<boolean>(false);
    const [hydrationError, setHydrationError] = useState<Error | null>(null);

    const viewRef = React.useRef<HTMLDivElement>(null);
    const widgetRef = React.useRef<HTMLDivElement>(null);

    const loadedConfig = React.useRef<LoadedConfig | null>(null);

    // Get cache context (may be null if not wrapped in provider)
    const widgetCache = useWidgetCache();
    const widgetId = dryConfig.id ?? 'unknown';
    const refreshTick = widgetCache?.refreshTick ?? 0;

    // Reset loadedConfig when refreshTick changes so hydration guard doesn't block
    const prevRefreshTick = React.useRef(refreshTick);
    useEffect(() => {
        if (refreshTick !== prevRefreshTick.current) {
            prevRefreshTick.current = refreshTick;
            loadedConfig.current = null;
        }
    }, [refreshTick]);

    useEffect(() => {
        const thisConfig = {
            dryConfig: getConfigWithoutSize(dryConfig),
            params,
            paramFilters,
            filters
        };

        if (!shouldRunHydration(dryConfig, loadedConfig.current, thisConfig)) {
            return;
        }

        if (dryConfig) {
            try {
                loadedConfig.current = thisConfig;
                makeHydrationRequest(dryConfig, false, params, paramFilters ?? [], filters ?? []);
            } catch (e) {
                console.error(dryConfig);
                console.error("Error parsing dry config", e);
            }
        }
    }, [dryConfig, params, paramFilters, filters, refreshTick]);

    const makeHydrationRequest = useCallback(async (
        newDryConfig: DryChartWidgetConfig,
        bypassCache = false,
        currentParams?: DateParams,
        currentParamFilters?: ParamFilter[],
        currentFilters?: DashboardFilterConfig[]
    ) => {
        const firebaseToken = await getDatakiAuthToken();
        if (!newDryConfig) {
            throw Error("makeHydrationRequest: No code provided");
        }

        // Use passed values or fall back to props (for refresh button calls)
        const usedParams = currentParams ?? params;
        const usedParamFilters = currentParamFilters ?? paramFilters ?? [];
        const usedFilters = currentFilters ?? filters ?? [];

        // Check cache first (unless bypassing)
        if (!bypassCache && widgetCache) {
            const cachedConfig = widgetCache.getCachedData(widgetId, newDryConfig, usedParams, usedParamFilters, usedFilters);
            if (cachedConfig) {
                // @ts-ignore -- config editing view, type narrowing deferred
                setConfig(mergeDeep(newDryConfig, cachedConfig));
                setHydrationInProgress(false);
                setHydrationError(null);
                onError?.(null);
                return;
            }
        }

        // Check for in-flight request with same params
        if (widgetCache) {
            const inflightPromise = widgetCache.getInflightRequest(widgetId, newDryConfig, usedParams, usedParamFilters, usedFilters);
            if (inflightPromise) {
                setHydrationInProgress(true);
                try {
                    const result = await inflightPromise;
                    // @ts-ignore -- config editing view, type narrowing deferred
                    setConfig(mergeDeep(newDryConfig, result));
                    onError?.(null);
                } catch (e) {
                    onError?.(e as Error);
                    setHydrationError(e as Error);
                } finally {
                    setHydrationInProgress(false);
                }
                return;
            }
        }

        setConfig(null);
        setHydrationInProgress(true);
        setHydrationError(null);

        const hydrationPromise = hydrateWidgetConfig(firebaseToken, apiEndpoint, newDryConfig, dashboardId, usedParams, usedParamFilters, embedApiKey);

        // Register in-flight request
        if (widgetCache) {
            widgetCache.setInflightRequest(widgetId, newDryConfig, usedParams, usedParamFilters, usedFilters, hydrationPromise);
        }

        hydrationPromise
            .then((config) => {
                onError?.(null);
                // Cache the result
                if (widgetCache) {
                    widgetCache.setCachedData(widgetId, newDryConfig, usedParams, usedParamFilters, usedFilters, config);
                }
                // @ts-ignore -- config editing view, type narrowing deferred
                setConfig(mergeDeep(newDryConfig, config));
            })
            .catch((e) => {
                onError?.(e);
                setHydrationError(e);
            })
            .finally(() => setHydrationInProgress(false));
    }, [getDatakiAuthToken, apiEndpoint, dashboardId, params, paramFilters, filters, widgetCache, widgetId, onError]);

    const downloadFile = () => {
        toPng(viewRef.current as HTMLElement, {
            backgroundColor: mode === "dark" ? "#18181c" : "#fff",
            width: viewRef.current?.scrollWidth,
            height: viewRef.current?.scrollHeight,
        }).then((url) => downloadImage(url, "chart.png"));
    }

    const onConfigUpdated = (newConfig: DryWidgetConfig) => {
        console.log("onConfigUpdated", newConfig);
        if (newConfig.type === "chart") {
            if (!newConfig) return;
            makeHydrationRequest(newConfig);
            onUpdated?.(newConfig);
        } else {
            throw new Error("INTERNAL: Unknown widget type: " + newConfig.type);
        }
    };

    const isUsingDateParams = isConfigUsingDateParams(dryConfig);
    const usedParams = getUsedParamsForConfig(dryConfig, paramFilters ?? []);
    const widgetDrag = useWidgetDrag();

    return <>

        <div
            ref={widgetRef}
            style={{
                maxWidth
            }}
            className={cls("group flex flex-col w-full h-full rounded-lg overflow-visible",
                selected ? " ring-offset-transparent ring-2 ring-primary/50 ring-offset-2" : "",
                className)}>

            <div
                draggable={!!widgetDrag}
                unselectable={widgetDrag ? "on" : undefined}
                onDragStart={widgetDrag ? (e) => {
                    e.dataTransfer.setData("text/plain", "");
                    // Create a scaled-down preview of the full widget
                    if (widgetRef.current) {
                        const original = widgetRef.current;
                        const clone = original.cloneNode(true) as HTMLElement;
                        const scale = 0.55;
                        const origWidth = original.offsetWidth;
                        const origHeight = original.offsetHeight;
                        const scaledW = Math.round(origWidth * scale);
                        const scaledH = Math.round(origHeight * scale);

                        // Wrapper with explicit small dimensions
                        const wrapper = document.createElement("div");
                        wrapper.style.width = `${scaledW}px`;
                        wrapper.style.height = `${scaledH}px`;
                        wrapper.style.overflow = "hidden";
                        wrapper.style.position = "fixed";
                        wrapper.style.top = "-10000px";
                        wrapper.style.left = "-10000px";
                        wrapper.style.zIndex = "99999";
                        wrapper.style.borderRadius = "8px";
                        wrapper.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";

                        clone.style.width = `${origWidth}px`;
                        clone.style.height = `${origHeight}px`;
                        clone.style.transform = `scale(${scale})`;
                        clone.style.transformOrigin = "top left";
                        clone.style.pointerEvents = "none";

                        wrapper.appendChild(clone);
                        document.body.appendChild(wrapper);
                        e.dataTransfer.setDragImage(wrapper, scaledW / 2, scaledH / 2);
                        // Store wrapper for cleanup on dragend
                        (e.currentTarget as any).__dragWrapper = wrapper;
                    }
                    // @ts-ignore -- config editing view, type narrowing deferred
                    widgetDrag?.onWidgetDragStart(dryConfig);
                } : undefined}
                onDragEnd={widgetDrag ? (e) => {
                    const wrapper = (e.currentTarget as any).__dragWrapper;
                    if (wrapper && wrapper.parentNode) {
                        wrapper.parentNode.removeChild(wrapper);
                        delete (e.currentTarget as any).__dragWrapper;
                    }
                    // @ts-ignore -- config editing view, type narrowing deferred
                    widgetDrag?.onWidgetDragEnd();
                } : undefined}
                className={cls("min-h-[54px] items-center flex flex-row w-full", widgetDrag ? "cursor-move" : "")}>
                <div className={"grow px-3 py-4 flex flex-row items-center gap-1 h-10"}>
                    {widgetDrag && <GripVertical size={"smallest"} color={"disabled"} className="flex-shrink-0" />}
                    <Typography variant={"label"}
                        className={"leading-none line-clamp-1"}
                        style={{
                            fontFamily: "var(--dataki-title-font-family)",
                            fontSize: "var(--dataki-title-font-size)",
                            fontWeight: "var(--dataki-title-font-weight)",
                            color: "var(--dataki-title-color)",
                        } as React.CSSProperties}>{config?.title ?? dryConfig.title}</Typography>
                    {isUsingDateParams && <Tooltip
                        className={"inline-flex items-center"}
                        title={"This view is filtered by the date range"}>
                        <Clock className={"-mt-px"} size={"smallest"} color={"disabled"} />
                    </Tooltip>}
                    {(usedParams ?? []).length > 0 &&
                        <Tooltip className={"inline-flex items-center"}
                            title={"This view is filtered by " + usedParams.map(p => p.key).join(", ")}>
                            <Filter className={"-mt-px"} size={"smallest"} color={"disabled"} />
                        </Tooltip>}
                </div>

                <div className={cls("flex-row gap-1 group-hover:flex nodrag", selected ? "flex" : "hidden")}>

                    {!readOnly && onRemoveClick && <Tooltip title={"Remove this view"}>
                        <IconButton size={"small"} onClick={onRemoveClick}>
                            <Trash2 size={"small"} />
                        </IconButton>
                    </Tooltip>}
                    <Tooltip title={"Download"}>
                        <IconButton size={"small"} onClick={downloadFile}>
                            <Download size={"small"} />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={"Refresh data"}>
                        <IconButton size={"small"} onClick={() => makeHydrationRequest(dryConfig, true)}>
                            <RefreshCw size={"small"} />
                        </IconButton>
                    </Tooltip>

                    {!readOnly && onUpdated && <Tooltip title={"Edit widget configuration"}>
                        <IconButton size={"small"} onClick={() => setConfigDialogOpen(true)}>
                            <Settings size={"small"} />
                        </IconButton>
                    </Tooltip>}

                    {!readOnly && actions}

                </div>

            </div>

            {hydrationInProgress && <div
                className={"rounded-xl w-full h-full border border-surface-100 dark:border-surface-800/80 relative flex-grow bg-white dark:bg-surface-950"}>
                <ChartSkeleton />
            </div>}

            {!hydrationInProgress && !hydrationError && <>
                {config?.chart && (
                    <ErrorBoundary>
                        <ChartView
                            ref={viewRef}
                            config={config?.chart} />
                    </ErrorBoundary>
                )}
            </>}

            {!hydrationInProgress && hydrationError && (
                <ExecutionErrorView executionError={hydrationError} />
            )}

            <ErrorBoundary>
                {dryConfig && configDialogOpen && <ConfigViewDialog open={configDialogOpen}
                    setOpen={setConfigDialogOpen}
                    dryConfig={dryConfig}
                    params={params}
                    paramFilters={paramFilters}
                    filters={filters}
                    onUpdate={onConfigUpdated}
                    includeDataSourceSelection={includeDataSourceSelection}
                />}
            </ErrorBoundary>
        </div>

    </>;
}

function shouldRunHydration(config: DryChartWidgetConfig, a: LoadedConfig | null, b: LoadedConfig | null) {
    if (!a || !b) return true;
    if (a.dryConfig.sql !== b.dryConfig.sql) return true;
    if (!equal(a.dryConfig.chart, b.dryConfig.chart)) return true;
    if (!equal(a.params, b.params)) return true;
    if (!equal(a.filters, b.filters)) return true;
    if (!equal(a.paramFilters, b.paramFilters)) {
        // Check if ANY of the changed filters (old or new) are related to this config
        const oldHasRelated = (a.paramFilters ?? []).some(p => isConfigRelatedToParam(config, p));
        const newHasRelated = (b.paramFilters ?? []).some(p => isConfigRelatedToParam(config, p));
        return oldHasRelated || newHasRelated;
    }
    return false;
}
