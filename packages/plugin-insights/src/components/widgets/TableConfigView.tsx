import { Clock, Download, Filter, GripVertical, RefreshCw, Settings, Trash2 } from "lucide-react";
import React, { useEffect } from "react";
import {
    DashboardFilterConfig,
    DateParams,
    DryChartWidgetConfig,
    DryScorecardWidgetConfig,
    DryTableWidgetConfig,
    DryWidgetConfig,
    ParamFilter,
    TableColumn
} from "../../types";
import { useSnackbarController } from "@rebasepro/core";
import { ErrorBoundary, slugify } from "../../utils/compat";
import { CircularProgress, cls, IconButton, Tooltip, Typography } from "@rebasepro/ui";
import { ConfigViewDialog } from "./ConfigViewDialog";
import { format } from "sql-formatter";
import { SQLTableView, useSQLTableConfig } from "../SQLTableView";
import equal from "react-fast-compare";
import { getDialectFromDataSources } from "../../utils/sql";
import { useDataki } from "../../DatakiContext";
import { makeSQLQuery } from "../../api";
import { downloadDataAsCsv } from "../../utils/data_export";
import { getUsedParamsForConfig, isConfigRelatedToParam, isConfigUsingDateParams } from "../../utils/widgets";
import { ExecutionErrorView } from "./ExecutionErrorView";
import { useWidgetDrag } from "../chat/WidgetDragContext";
import { useWidgetCache } from "./WidgetCacheContext";

function shouldRunHydration(config: DryTableWidgetConfig, a: LoadedConfig, b: LoadedConfig) {
    if (a.sql !== b.sql) return true;
    if (!equal(a.params, b.params)) return true;
    //compare column but ignore width
    if (!equal(a.columns?.map(c => ({
        ...c,
        width: undefined
    })), b.columns?.map(c => ({
        ...c,
        width: undefined
    })))) return true;
    if (!equal(a.paramFilters, b.paramFilters)) {
        return (b.paramFilters ?? []).some(p => isConfigRelatedToParam(config, p));
    }
    if (!equal(a.filters, b.filters)) {
        return true;
    }
    return false;
}

type LoadedConfig = {
    sql: string,
    columns?: TableColumn[],
    params?: DateParams,
    paramFilters?: ParamFilter[],
    filters?: DashboardFilterConfig[]
};

export function TableConfigView({
    dryConfig,
    params,
    paramFilters,
    filters,
    onUpdated,
    onError,
    onRemoveClick,
    maxWidth,
    selected,
    actions,
    className,
    readOnly,
    includeDataSourceSelection,
    dashboardId
}: {
    dryConfig: DryTableWidgetConfig,
    params: DateParams,
    paramFilters: ParamFilter[],
    filters: DashboardFilterConfig[],
    onUpdated?: (newConfig: DryTableWidgetConfig) => void,
    onError?: (error: Error | null) => void,
    onRemoveClick?: () => void,
    maxWidth?: number,
    selected?: boolean,
    actions?: React.ReactNode,
    className?: string,
    readOnly?: boolean,
    includeDataSourceSelection?: boolean,
    dashboardId?: string
}) {

    const {
        apiEndpoint,
        getDatakiAuthToken,
        embedApiKey
    } = useDataki();

    const dialect = getDialectFromDataSources(dryConfig.dataSources);

    const snackbar = useSnackbarController();

    const [configDialogOpen, setConfigDialogOpen] = React.useState(false);

    const [loadingDownload, setLoadingDownload] = React.useState(false);

    const columns = dryConfig?.table?.columns;
    const sql = dryConfig?.sql;
    const dataSources = dryConfig.dataSources;

    const sqlTableConfig = useSQLTableConfig({
        dashboardId,
        dataSources,
        sql,
        params,
        paramFilters,
        columns,
        onError
    });

    const downloadFile = async () => {
        setLoadingDownload(true);
        try {
            const firebaseToken = await getDatakiAuthToken();
            const data = await makeSQLQuery({
                firebaseAccessToken: firebaseToken,
                dataSources,
                apiEndpoint,
                sql,
                params,
                embedApiKey,
                dashboardId
            });
            downloadDataAsCsv(data, slugify(dryConfig.title) + ".csv");
        } catch (e) {
            console.error("Error downloading data", e);
            snackbar.open({
                message: "Error downloading data",
                type: "error"
            });
        }
        setLoadingDownload(false);
    }

    const {
        viewRef,
        setData,
        dataLoading,
        dataLoadingError,
        refreshData,
    } = sqlTableConfig;

    const onConfigUpdated = (newConfig: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig) => {
        if (!newConfig) return;
        console.log("Config updated", newConfig);
        if (newConfig.type === "table") {
            onUpdated?.(newConfig);
            refreshData(newConfig.sql);
        }
    };

    const onColumnResize = (params: { key: string, width: number }) => {
        const newColumns = columns?.map(col => {
            if (col.key === params.key) {
                return {
                    ...col,
                    width: params.width
                };
            }
            return col;
        });
        const newConfig: DryWidgetConfig = {
            ...dryConfig,
            table: {
                ...dryConfig.table,
                columns: newColumns ?? []
            }
        };
        onUpdated?.(newConfig);
    }

    const loadedConfig = React.useRef<LoadedConfig | null>(null);

    const widgetCache = useWidgetCache();
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
        const currentConfig = {
            sql,
            columns,
            params,
            paramFilters,
            filters
        };
        if (loadedConfig.current && !shouldRunHydration(dryConfig, loadedConfig.current, currentConfig)) {
            return;
        }

        if (sql) {
            setData([]);
            loadedConfig.current = currentConfig;
            try {
                const formattedDrySQL = format(dryConfig.sql, { language: dialect })
                const result = {
                    ...dryConfig,
                    sql: formattedDrySQL
                };
                if (!equal(result, dryConfig))
                    onUpdated?.(result);
            } catch (e) {
                console.error("Error formatting SQL", e);
            }
            refreshData();
        }
    }, [sql, columns, filters, params, paramFilters, dryConfig, refreshTick]);

    const isUsingDateParams = isConfigUsingDateParams(dryConfig);
    const usedParams = getUsedParamsForConfig(dryConfig, paramFilters ?? []);
    const widgetDrag = useWidgetDrag();

    return <>

        <div
            ref={viewRef}
            style={{ width: maxWidth }}
            className={cls("group flex flex-col w-full h-full rounded-lg overflow-visible",
                selected ? "ring-offset-transparent ring-2 ring-primary/50 ring-offset-2" : "",
                className)}>

            <div
                draggable={!!widgetDrag}
                unselectable={widgetDrag ? "on" : undefined}
                onDragStart={widgetDrag ? (e) => {
                    e.dataTransfer.setData("text/plain", "");
                    // Create a scaled-down preview of the full widget
                    if (viewRef.current) {
                        const original = viewRef.current;
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
                <div className={"grow px-3 py-4 flex flex-row items-center gap-2 h-10"}>
                    {widgetDrag && <GripVertical size={"smallest"} color={"disabled"} className="flex-shrink-0" />}
                    <Typography variant={"label"}
                        className={"leading-none line-clamp-1"}
                        style={{
                            fontFamily: "var(--dataki-title-font-family)",
                            fontSize: "var(--dataki-title-font-size)",
                            fontWeight: "var(--dataki-title-font-weight)",
                            color: "var(--dataki-title-color)",
                        } as React.CSSProperties}>{dryConfig.title}</Typography>
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

                {dataLoading && <div className={"m-3"}><CircularProgress size={"small"} /></div>}

                <div className={"m-2.5 flex-row gap-1 hidden group-hover:flex"}>

                    {!readOnly && onRemoveClick && <Tooltip title={"Remove this view"}>
                        <IconButton size={"small"} onClick={onRemoveClick}>
                            <Trash2 size={"small"} />
                        </IconButton>
                    </Tooltip>}

                    <Tooltip title={"Download"}>
                        <IconButton size={"small"}
                            disabled={loadingDownload}
                            onClick={downloadFile}>
                            {loadingDownload
                                ? <CircularProgress size={"small"} />
                                : <Download size={"small"} />}
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={"Refresh data"}>
                        <IconButton size={"small"} onClick={() => {
                            setData([]);
                            refreshData(undefined, true);
                        }}>
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

            {dryConfig?.table && (<SQLTableView sqlTableConfig={sqlTableConfig}
                onColumnResize={onColumnResize} />)}

            {/*{!dataLoading && dataLoadingError && (*/}
            {/*    <ExecutionErrorView executionError={dataLoadingError}/>*/}
            {/*)}*/}

            <ErrorBoundary>
                {dryConfig && <ConfigViewDialog open={configDialogOpen}
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
