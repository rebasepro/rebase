import { Button, IconButton, LoadingButton, Tooltip, Typography } from "@rebasepro/ui";
import { Filter, Code, Check, Info, Save } from "lucide-react";
import React, { lazy, Suspense, useEffect, useRef, useState } from "react";

import { DashboardFilterConfig, DataSource, DateParams, ParamFilter } from "../types";
import { SQLTableView, useSQLTableConfig } from "./SQLTableView";
import { formatSQL, getDialectFromDataSources } from "../utils/sql";
import { DataSourcesSelection } from "./DataSourcesSelection";
import { DashboardFiltersBar, useFiltersStateView } from "../hooks/useFiltersStateView";
import { getDataSourceKey, formatDataSource } from "../utils/datasource";
import { ResizablePanelLayout } from "./ResizablePanelLayout";

const CodeEditor = lazy(() => import("./CodeEditor").then(m => ({ default: m.CodeEditor })));

/**
 * This view allows you to run SQL queries and see the output
 * @constructor
 */
export function SQLQueryView({
    initialSql,
    initialDataSources,
    params,
    paramFilters,
    filters,
    onSaved,
    onDirtyChange,
    includeDataSourceSelection = true
}: {
    initialSql?: string,
    onSaved?: (sql?: string) => Promise<void>
    initialDataSources?: DataSource[],
    params?: DateParams,
    paramFilters?: ParamFilter[],
    filters: DashboardFilterConfig[],
    onDirtyChange?: (dirty: boolean) => void,
    includeDataSourceSelection?: boolean
}) {

    const editorRef = useRef<any>(null);
    const [dataSources, setDataSources] = useState<DataSource[]>(initialDataSources ?? []);
    const dialect = getDialectFromDataSources(dataSources);

    const [selectedText, setSelectedText] = useState<string | undefined>();

    const [resultsHeightPercent, setResultsHeightPercent] = useState(60);

    const {
        dateRange,
        setDateRange,
        paramFilters: paramFiltersState,
        setParamFilters: setParamFiltersState,
        filters: filtersState,
    } = useFiltersStateView({
        initialDateRange: params ? [params.dateStart ?? null, params.dateEnd ?? null] : undefined,
        initialParamFilters: paramFilters,
        filters,
        dataSources
    });

    const [sql, setSql] = useState<string | undefined>(initialSql);
    const [dirty, setDirty] = useState<boolean>(false);

    const [saved, setSaved] = useState<boolean>(false);

    // Reset saved state when initialSql changes or after 2 seconds
    useEffect(() => {
        if (initialSql) {
            setSaved(false);
        }
    }, [initialSql]);

    useEffect(() => {
        if (saved) {
            const timeout = setTimeout(() => {
                setSaved(false);
            }, 2000);
            return () => clearTimeout(timeout);
        }
        return undefined;
    }, [saved]);

    const doSave = () => {
        onSaved?.(sql).then(() => {
            setSql(sql);
            setDirty(false);
            onDirtyChange?.(false);
            setSaved(true);
        });
    }

    const updateSql = (newSql?: string) => {
        setSql(newSql);
        const newDirty = !initialSql;
        setDirty(newDirty);
        onDirtyChange?.(newDirty);
    }

    const sqlTableConfig = useSQLTableConfig({
        dataSources,
        sql: selectedText ?? sql ?? "",
        params: dateRange
            ? {
                dateStart: dateRange[0],
                dateEnd: dateRange[1]
            }
            : undefined,
        paramFilters: paramFiltersState
    });

    useEffect(() => {
        if (initialSql) {
            sqlTableConfig.refreshData();
        }
    }, []);

    return <div className={"flex flex-col h-full w-full px-4 sm:px-8 md:px-16 lg:px-24 xl:px-32 2xl:px-64 py-4"}>

        <div className={"flex flex-row gap-4 mt-8 mb-2 items-center overflow-x-scroll no-scrollbar h-16"}>
            <Typography className={"flex-grow "} variant={"label"}>
                SQL Editor
            </Typography>

            {includeDataSourceSelection && <DataSourcesSelection selectedDataSources={dataSources}
                setSelectedDataSources={(dataSources) => {
                    setDataSources(dataSources);
                }} />}
            {!includeDataSourceSelection &&
                <Tooltip title={<>
                    <Typography variant={"caption"}>Used data sources in this query</Typography>
                    <div className="flex flex-col gap-1 mt-1">
                        {dataSources.map((ds) => formatDataSource(ds))}
                    </div>
                </>}>

                    <Info size={14} className="text-text-disabled" />
                </Tooltip>}

            <DashboardFiltersBar
                filters={filtersState}
                paramFilters={paramFiltersState}
                setParamFilters={setParamFiltersState}
                dateRange={dateRange}
                setDateRange={setDateRange}
                dataSources={dataSources}
                includeFilters={true}
            />
            <Button variant={"text"} color={"neutral"}
                className={"text-text-secondary dark:text-text-secondary-dark"}
                onClick={() => {
                    console.debug("clicking format button")
                    updateSql(formatSQL(sql ?? "", dialect));
                }}>
                Format
            </Button>
            {onSaved && <Tooltip
                open={saved}
                side={"top"}
                title={"Updated!"}>

                <IconButton variant={"ghost"} shape={"square"} disabled={!dirty}
                    onClick={doSave}>
                    {saved ? <Check size={18} /> : <Save size={18} />}
                </IconButton>
            </Tooltip>}
            <LoadingButton color={"neutral"}
                loading={sqlTableConfig.dataLoading}
                onClick={() => sqlTableConfig.refreshData()}>
                Run
            </LoadingButton>
        </div>

        <div className={"flex-grow relative min-h-[400px]"}>
            <ResizablePanelLayout
                isPanelOpen={true}
                orientation={"vertical"}
                panelSizePercent={resultsHeightPercent}
                onPanelSizeChange={setResultsHeightPercent}
                sidePanel={
                    <div className={"h-full w-full pt-2 px-2 pb-2"}>
                        <SQLTableView sqlTableConfig={sqlTableConfig} />
                    </div>
                }
            >
                <div className={"h-full w-full pb-2"}>
                    <Suspense fallback={<div className="p-4">Loading editor...</div>}>
                        <CodeEditor
                            defaultLanguage={"sql"}
                            value={sql}
                            onChange={updateSql}
                            sqlDialect={dialect}
                            onMount={(editor) => {
                                editorRef.current = editor;
                                editor.onDidChangeCursorSelection((e: any) => {
                                    try {
                                        const model = editor.getModel();
                                        if (!model) return;
                                        const selection = editor.getSelection();
                                        if (!selection) return;
                                        setSelectedText(model.getValueInRange(selection));
                                    } catch (e) {
                                        console.error("Error getting selected SQL", e);
                                    }
                                });
                            }} />
                    </Suspense>
                </div>
            </ResizablePanelLayout>
        </div>

    </div>
}
