import { Zap } from "lucide-react";
import {
    DashboardFilterConfig,
    DateParams,
    DryChartWidgetConfig,
    DryScorecardWidgetConfig,
    DryTableWidgetConfig,
    ParamFilter
} from "../../types";
import JSON5 from "json5";

import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Button, Container, DialogActions, Sheet, TextField, Typography } from "@rebasepro/ui";
import { ErrorView, useSnackbarController } from "@rebasepro/core";
import { SQLQueryView } from "../SQLQueryView";
import { ResizablePanelLayout } from "../ResizablePanelLayout";
import { useConfirmationDialog } from "../../hooks/useConfirmationDialog";
import { useCreateFormex } from "../../utils/formex-shim";
import { DataSourcesSelection } from "../DataSourcesSelection";

const CodeEditor = lazy(() => import("../CodeEditor").then(m => ({ default: m.CodeEditor })));

export function ConfigViewDialog({
                                     dryConfig: dryConfigProp,
                                     open,
                                     setOpen,
                                     params,
                                     paramFilters,
                                     filters,
                                     onUpdate: onUpdateProp,
                                     includeDataSourceSelection = true
                                 }: {
    dryConfig: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig
    open: boolean,
    setOpen: (open: boolean) => void,
    params: DateParams,
    paramFilters: ParamFilter[],
    filters: DashboardFilterConfig[],
    onUpdate?: (newConfig: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig) => void,
    includeDataSourceSelection?: boolean
}) {

    const snackbar = useSnackbarController();

    const formex = useCreateFormex({
        initialValues: dryConfigProp
    });

    const [configError, setConfigError] = React.useState<Error | null>(null);

    const [editorOpen, setEditorOpen] = useState(false);
    const [editorDirty, setEditorDirty] = useState(false);

    const [jsonConfigWidth, setJsonConfigWidth] = useState(50);

    const sqlDialogEditorConfirmationDialog = useConfirmationDialog({
        confirmMessage: "Are you sure you want to close the editor? You have unsaved changes.",
        onAccept: () => {
            setEditorOpen(false);
            setEditorDirty(false);
        }
    });

    const onChangeEditorOpen = (open: boolean) => {

        if (editorDirty) {
            sqlDialogEditorConfirmationDialog.open();
        } else {
            setEditorOpen(false);
            setEditorDirty(false);
        }
    }

    const dataField = "table" in dryConfigProp ? dryConfigProp.table : ("chart" in dryConfigProp ? dryConfigProp.chart : ("scorecard" in dryConfigProp ? dryConfigProp.scorecard : null));
    const inputChartConfig: string = useMemo(() => {
        if (dryConfigProp.type === "chart")
            return JSON.stringify(dryConfigProp.chart, null, 2);
        else if (dryConfigProp.type === "table")
            return JSON.stringify(dryConfigProp.table, null, 2);
        else if (dryConfigProp.type === "scorecard")
            return JSON.stringify(dryConfigProp.scorecard, null, 2);
        else {
            // @ts-ignore
            throw new Error("Unknown widget type: " + dryConfigProp.type);
        }
    }, [dataField]);

    const [chartOrTableConfig, setChartOrTableConfig] = React.useState(inputChartConfig);

    useEffect(() => {
        setChartOrTableConfig(inputChartConfig);
    }, [inputChartConfig]);

    const updateChartConfig = (value: string) => {
        formex.setDirty(true);
        setChartOrTableConfig(value);
    }

    const onUpdate = () => {
        try {

            let dryConfig = {
                ...dryConfigProp,
                ...formex.values
            };

            let parsedConfig: any;
            try {
                parsedConfig = JSON5.parse(chartOrTableConfig);
            } catch (e: any) {
                setConfigError(e);
                snackbar.open({
                    type: "error",
                    message: "Error parsing JSON"
                });
                return;
            }

            setConfigError(null);

            if (dryConfig.type === "chart") {
                dryConfig = {
                    ...dryConfig,
                    chart: parsedConfig
                }
            } else if (dryConfig.type === "table") {
                dryConfig = {
                    ...dryConfig,
                    table: parsedConfig
                }
            } else if (dryConfig.type === "scorecard") {
                dryConfig = {
                    ...dryConfig,
                    scorecard: parsedConfig
                }
            }

            console.log("Updating config", dryConfig);
            onUpdateProp?.(dryConfig)
            setOpen(false);
        } catch (e) {
            snackbar.open({
                type: "error",
                message: "Error updating config"
            });
            console.error("Error updating config", e);
        }
    };

    const onTitleChange = (event: React.ChangeEvent<any>) => {
        formex.setFieldValue("title", event.target.value);
    }

    const onDescriptionChange = (event: React.ChangeEvent<any>) => {
        formex.setFieldValue("description", event.target.value);
    }

    const onProjectIdChange = (event: React.ChangeEvent<any>) => {
        formex.setFieldValue("projectId", event.target.value);
    }

    return <Sheet
        side={"bottom"}
        open={open}
        onOpenChange={setOpen}
    >
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onUpdate();
            }}
            className={"h-[92vh] w-full flex flex-col overflow-hidden bg-white dark:bg-surface-950"}>

            <Container
                className="p-8 w-full flex flex-col space-y-4 h-full"
                maxWidth={"7xl"}>
                <div className="flex flex-row gap-4 items-center">
                    <TextField value={formex.values.title}
                               invisible={true}
                               onChange={onTitleChange}
                               className={"text-lg font-semibold flex-grow"}
                               placeholder={"Title of the widget"}/>

                    <div className="flex flex-col items-end gap-1">
                        {includeDataSourceSelection &&
                            <DataSourcesSelection selectedDataSources={formex.values.dataSources}
                                                  setSelectedDataSources={(dataSources) => {
                                                      console.log("Setting data sources", dataSources);
                                                      formex.setFieldValue("dataSources", dataSources);
                                                  }}/>}
                        <Typography variant={"caption"} color={"secondary"}>
                            {formex.values.id}
                        </Typography>
                    </div>

                </div>

                <div className="flex flex-row gap-4 items-center">
                    <TextField value={formex.values.description}
                               invisible={true}
                               className={"flex-grow"}
                               size={"small"}
                               label={"Description"}
                               onChange={onDescriptionChange}
                               placeholder={"Description"}/>


                </div>

                <div className={"flex-grow w-full relative min-h-[400px]"}>
                    <ResizablePanelLayout
                        isPanelOpen={true}
                        panelSizePercent={jsonConfigWidth}
                        onPanelSizeChange={setJsonConfigWidth}
                        sidePanel={
                            <div className={"flex flex-col flex-grow h-full overflow-hidden pl-4 pr-2 pt-2"}>
                                <Typography gutterBottom variant={"label"} className={"mt-4"}>
                                    {dryConfigProp.type === "chart" ? "Chart config" : (dryConfigProp.type === "table" ? "Table config" : "Scorecard config")}
                                </Typography>
                                <div className="flex-grow relative overflow-hidden">
                                    <Suspense fallback={<div className="p-4">Loading editor...</div>}>
                                        <CodeEditor value={chartOrTableConfig ?? ""}
                                                    autoHeight={false}
                                                    defaultLanguage={"json"}
                                                    onChange={(value) => {
                                                        updateChartConfig(value ?? "");
                                                    }}/>
                                    </Suspense>
                                </div>
                                {configError && <ErrorView error={configError}/>}
                            </div>
                        }
                    >
                        <div className={"flex flex-col flex-grow h-full overflow-hidden px-2"}>
                            <div className={"flex flex-row gap-4 mb-2 items-center mt-4"}>
                                <Typography className={"flex-grow "} variant={"label"}>
                                    SQL query
                                </Typography>
                                <Button variant={"filled"}
                                        color={"neutral"}
                                        onClick={() => setEditorOpen(true)}
                                        size={"small"}>
                                    <Zap size={"smallest"}/>
                                    Run SQL
                                </Button>

                            </div>
                            <div className="flex-grow relative overflow-hidden">
                                <Suspense fallback={<div className="p-4">Loading editor...</div>}>
                                    <CodeEditor value={formex.values.sql ?? ""}
                                                autoHeight={false}
                                                defaultLanguage={"sql"}
                                                onChange={(updatedSQL) => {
                                                    formex.setFieldValue("sql", updatedSQL);
                                                }}/>
                                </Suspense>
                            </div>
                        </div>
                    </ResizablePanelLayout>
                </div>
            </Container>
            <DialogActions>
                <Button type={"submit"}
                        disabled={formex.isSubmitting || !formex.dirty}
                        color={"neutral"}>
                    Update
                </Button>
            </DialogActions>
        </form>
        <Sheet
            open={editorOpen}
            onOpenChange={onChangeEditorOpen}
            side={"bottom"}>
            <div className={"h-[92vh]"}>
                {editorOpen && <SQLQueryView
                    initialSql={formex.values.sql}
                    includeDataSourceSelection={includeDataSourceSelection}
                    params={params}
                    paramFilters={paramFilters}
                    filters={filters}
                    initialDataSources={dryConfigProp.dataSources}
                    onDirtyChange={setEditorDirty}
                    onSaved={async (sql) => {

                        formex.setFieldValue("sql", sql ?? "");
                    }}
                />}
            </div>

        </Sheet>

        {sqlDialogEditorConfirmationDialog.ConfirmationDialog}

    </Sheet>;
}
