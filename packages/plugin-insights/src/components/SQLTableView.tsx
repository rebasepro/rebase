import { Filter, Check, Type } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import { makeSQLQuery } from "../api";
import { useDataki } from "../DatakiContext";
import { DataRow, DataSource, DataType, DateParams, ParamFilter, TableColumn } from "../types";
import { DataTable } from "./DataTable";
import { ExecutionErrorView } from "./widgets/ExecutionErrorView";
import { TableSkeleton } from "./widgets/skeletons";
import { useWidgetCache } from "./widgets/WidgetCacheContext";

export type SQLTableConfigParams = {
    dataSources: DataSource[];
    sql: string;
    params?: DateParams;
    paramFilters?: ParamFilter[];
    columns?: TableColumn[];
    onError?: (error: Error | null) => void,
    dashboardId?: string;
}

export type SQLTableConfig = {
    viewRef: React.RefObject<HTMLDivElement | null>;
    limit: number;
    columns?: TableColumn[];
    updateColumns: (newColumns: TableColumn[]) => void;
    resetPagination: () => void;
    desiredOffset: React.RefObject<number>;
    currentOffset: React.RefObject<number>;
    data: DataRow[];
    setData: React.Dispatch<React.SetStateAction<DataRow[]>>;
    dataLoading: boolean;
    dataLoadingError: Error | null;
    refreshData: (updatedSQL?: string, bypassCache?: boolean) => void;
    onEndReached: () => void;
    sortBy?: [string, "asc" | "desc"];
    onSortByUpdate: (sortBy?: [string, "asc" | "desc"]) => void;
}

export function useSQLTableConfig({
    dataSources,
    sql,
    params,
    paramFilters,
    columns,
    onError,
    dashboardId
}: SQLTableConfigParams): SQLTableConfig {

    const usedSQL = useRef<string>(sql);

    const viewRef = React.useRef<HTMLDivElement>(null);

    const [usedColumns, setUsedColumns] = useState<TableColumn[] | undefined>(columns);

    useEffect(() => {
        setUsedColumns(columns);
    }, [columns]);

    const {
        apiEndpoint,
        getDatakiAuthToken,
        embedApiKey
    } = useDataki();

    // Get cache context (may be null if not wrapped in provider)
    const widgetCache = useWidgetCache();
    const bypassCacheRef = useRef<boolean>(false);

    const limit = 100;

    const desiredOffset = useRef<number>(0);
    const currentOffset = useRef<number>(0);

    const [data, setData] = useState<DataRow[]>([]);
    const [dataLoading, setDataLoading] = useState<boolean>(false);
    const [dataLoadingError, setDataloadingError] = useState<Error | null>(null);

    function resetPagination() {
        desiredOffset.current = 0;
        currentOffset.current = 0;
    }

    function updateColumnsWithData(newData: DataRow[]) {
        if (!columns) {
            const extractedColumns = extractColumns(newData);
            setUsedColumns(extractedColumns);
        }
    }

    const [sortBy, setSortBy] = useState<[string, "asc" | "desc"] | undefined>(undefined);

    const abortControllerRef = useRef<AbortController | null>(null);

    const fetchData = async (offset: number) => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        // Check cache first (unless bypassing)
        if (!bypassCacheRef.current && widgetCache) {
            const cachedData = widgetCache.getTableCachedData(usedSQL.current, params, paramFilters, sortBy, offset);
            if (cachedData) {
                currentOffset.current = offset;
                updateColumnsWithData(cachedData);
                onError?.(null);
                setData((existingData) => [...existingData, ...cachedData]);
                setDataLoading(false);
                return;
            }
        }

        const firebaseToken = await getDatakiAuthToken();
        setDataLoading(true);
        setDataloadingError(null);
        makeSQLQuery({
            firebaseAccessToken: firebaseToken,
            dataSources,
            apiEndpoint,
            sql: usedSQL.current,
            params,
            paramFilters,
            orderBy: sortBy ? [sortBy] : undefined,
            limit,
            offset,
            dashboardId,
            signal: controller.signal,
            embedApiKey
        })
            .then((newData) => {
                if (controller.signal.aborted) return;
                currentOffset.current = offset;
                updateColumnsWithData(newData);
                onError?.(null);
                // Cache the result
                if (widgetCache) {
                    widgetCache.setTableCachedData(usedSQL.current, params, paramFilters, sortBy, offset, newData);
                }
                setData((existingData) => [...existingData, ...newData]);
            })
            .catch((e) => {
                if (e.name === "AbortError") return;
                onError?.(e);
                setDataloadingError(e);
            })
            .finally(() => {
                if (controller.signal.aborted) return;
                setDataLoading(false);
                bypassCacheRef.current = false; // Reset bypass flag after fetch
            });
    };

    const onEndReached = () => {
        if (currentOffset.current === desiredOffset.current) {
            desiredOffset.current = currentOffset.current + limit;
            fetchData(desiredOffset.current);
        }
    };

    const refreshData = (updatedSQL?: string, bypassCache = false) => {
        usedSQL.current = updatedSQL ?? sql;
        bypassCacheRef.current = bypassCache;
        setData([]);
        resetPagination();
        fetchData(0);
    }

    const onSortByUpdate = (newSortBy?: [string, "asc" | "desc"]) => {
        setSortBy(newSortBy);
        setData([]);
        resetPagination();
        setDataLoading(true);
        // We need to trigger a fetch, but since state update is async, we might need to handle it carefully.
        // However, since we are resetting data, the effect or next render cycle should handle it if we were using an effect.
        // But here fetchData is manual.
        // Let's use a ref or just call fetchData with the new sort value if we could, but fetchData uses the state.
        // Actually fetchData uses `sortBy` from closure? No, it uses state.
        // So we need to wait for state update.
        // A better approach is to use a useEffect for fetching when dependencies change, but this component seems to rely on manual calls.
        // Let's look at how `refreshData` works. It calls `fetchData(0)`.
        // But `fetchData` closes over `sortBy`.
        // We need to update `fetchData` to use the latest `sortBy` or pass it as arg.
        // But `fetchData` is defined inside the component, so it sees the current render's `sortBy`.
        // If we call `setSortBy` and then `fetchData`, `fetchData` will still see the old `sortBy`.
        // So we should probably use a `useEffect` to trigger fetch when `sortBy` changes.
    }

    // Use effect to refetch when sortBy changes
    useEffect(() => {
        // Actually, we want to fetch when sortBy changes.
        // But we also need to reset data.
        // Let's do the reset in the effect?
        // Or just call fetchData in the effect.
        // But we need to reset pagination too.
        setData([]);
        resetPagination();
        // We need to make sure we are not fetching if it's the very first render and we haven't done anything yet?
        // The original code didn't have auto-fetch on mount in the hook, it seems.
        // Let's check where fetchData is called initially.
        // It seems it is NOT called in the hook. It returns `refreshData` and `onEndReached`.
        // The consumer probably calls `refreshData` or `onEndReached`.
        // Wait, `SQLTableView` doesn't call `refreshData` on mount.
        // Let's check `SQLTableView` again.
        // It renders `DataTable`.
        // Maybe the parent calls it?
        // Or `onEndReached` is called by `VirtualTable` on mount?
        // Yes, `VirtualTable` calls `onEndReached` if data is empty or not enough to fill.

        // So if we change `sortBy`, we want to clear data and reset pagination.
        // Then `VirtualTable` will see empty data and call `onEndReached`?
        // Or we can just call `fetchData(0)` here.
        // But we need to access the *new* sortBy.
        // The `useEffect` [sortBy] will run with the new sortBy.
        fetchData(0);
    }, [sortBy]);

    return {
        viewRef,
        limit,
        updateColumns: setUsedColumns,
        columns: usedColumns,
        resetPagination,
        desiredOffset,
        currentOffset,
        data,
        setData,
        dataLoading,
        dataLoadingError,
        refreshData,
        onEndReached,
        sortBy,
        onSortByUpdate
    };
}

export function SQLTableView({
    sqlTableConfig,
    onColumnResize
}: {
    sqlTableConfig: SQLTableConfig,
    onColumnResize?: (params: { key: string, width: number }) => void;
}) {

    const {
        viewRef,
        columns,
        updateColumns,
        data,
        dataLoading,
        dataLoadingError,
        onEndReached,
        sortBy,
        onSortByUpdate
    } = sqlTableConfig;

    return <>

        {!columns && dataLoading && <div
            className={"rounded-xl w-full h-full border border-surface-100 dark:border-surface-800/80 relative flex-grow bg-white dark:bg-surface-950 overflow-hidden"}>
            <TableSkeleton />
        </div>}

        {!dataLoading && dataLoadingError && (
            <ExecutionErrorView executionError={dataLoadingError} />
        )}

        {columns && !dataLoadingError && <>
            <DataTable
                ref={viewRef}
                data={(dataLoading && data.length === 0) ? Array(20).fill({ __isSkeleton: true }) : data}
                columns={columns}
                loading={dataLoading && data.length > 0} // Only show loading spinner if we have data (pagination), otherwise we show skeletons
                sortBy={sortBy}
                onSortByUpdate={onSortByUpdate}
                onColumnResize={(params) => {
                    // Update the column width in the SQLTableConfig
                    const updatedColumns = columns.map((col) => {
                        if (col.key === params.key) {
                            return {
                                ...col,
                                width: params.width
                            };
                        }
                        return col;
                    });
                    updateColumns(updatedColumns);
                    onColumnResize?.(params);
                }}
                onEndReached={onEndReached} />
        </>}
    </>;
}

function determineDataType(values: any[]): DataType {
    const typeCounts: { [key in DataType]?: number } = {};

    values.forEach((value) => {
        let type: DataType;

        if (typeof value === "string") {
            // Check if the string is a date
            if (!isNaN(Date.parse(value))) {
                type = "date";
            } else {
                type = "string";
            }
        } else if (typeof value === "number") {
            type = "number";
        } else if (Array.isArray(value)) {
            type = "array";
        } else if (typeof value === "object" && value !== null) {
            type = "object";
        } else {
            type = "string";
        }

        typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    // Find the most frequent type
    const mostFrequentType = Object.keys(typeCounts).reduce((a, b) =>
        typeCounts[a as DataType]! > typeCounts[b as DataType]! ? a : b
    );

    return mostFrequentType as DataType;
}

function extractColumns(newData: DataRow[]): TableColumn[] {
    if (!newData || newData.length === 0) {
        return [];
    }

    const sampleSize = Math.min(newData.length, 10);
    const sampleData = newData.slice(0, sampleSize);

    const columns = Object.keys(sampleData[0]).map((key) => {
        const sampleValues = sampleData.map((row) => row[key]);
        const type = determineDataType(sampleValues);

        return {
            key,
            name: key,
            type
        };
    });

    return columns;
}
