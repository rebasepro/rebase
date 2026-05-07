import { Copy, MessageSquare, Wand2 } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import {
    DashboardFilterConfig,
    DashboardItem,
    DashboardWidgetConfig,
    DateParams,
    DryChartWidgetConfig,
    DryScorecardWidgetConfig,
    DryTableWidgetConfig,
    DryWidgetConfig,
    FilterOp,
    FilterWidgetItem,
    ParamFilter
} from "../../../types";
import { ChartConfigView } from "../../widgets/ChartConfigView";
import { TableConfigView } from "../../widgets/TableConfigView";
import { ScorecardConfigView } from "../../widgets/ScorecardConfigView";
import { FilterWidgetView } from "../../widgets/FilterWidgetView";
import { useDataki } from "../../../DatakiContext";
// Removed unused import
import { Button, cls, IconButton, Tooltip } from "@rebasepro/ui";
import { AddToDashboardDialog } from "../AddToDashboardDialog";
import GridTextWrapper from "./GridTextWrapper";

type GridWidgetWrapperProps = {
    widget: DashboardItem;
    dashboardId: string;
    pageId: string;
    params: DateParams;
    paramFilters: ParamFilter[];
    filters: DashboardFilterConfig[];
    readOnly: boolean;
    onWidgetError: (widget: DashboardItem, error: Error | null) => void;
    onWidgetEdit: (widget: DashboardItem, error?: Error) => void;
    onNodesDelete: (widgetIds: string[]) => void;
    onFilterValueChange: (key: string, value: any, operator?: FilterOp) => void;
};

function GridWidgetWrapper({
                               widget,
                               dashboardId,
                               pageId,
                               params,
                               paramFilters,
                               filters,
                               readOnly,
                               onWidgetError,
                               onWidgetEdit,
                               onNodesDelete,
                               onFilterValueChange,
                           }: GridWidgetWrapperProps) {
    const datakiConfig = useDataki();
    const [executionError, setExecutionError] = useState<Error | null>(null);
    const [addToDashboardDialogOpen, setAddToDashboardDialogOpen] = useState(false);

    const onError = useCallback((error: Error | null) => {
        if (widget.type !== "title" && widget.type !== "subtitle" && widget.type !== "text") {
            onWidgetError(widget, error);
            setExecutionError(error);
        }
    }, [onWidgetError, widget]);

    const onAddToDashboard = useCallback(() => {
        setAddToDashboardDialogOpen(true);
    }, []);

    const onEditWidget = useCallback(() => {
        onWidgetEdit(widget, executionError ?? undefined);
    }, [onWidgetEdit, widget, executionError]);

    const onUpdated = useCallback((newConfig: DryWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig) => {
        if (widget.type === "title" || widget.type === "subtitle" || widget.type === "text" || widget.type === "filter") return;

        if (newConfig.type !== widget.type) {
            console.error("Widget type mismatch", {
                newConfig,
                widget
            });
            return;
        }
        const result = {
            ...widget,
            ...newConfig
        } satisfies DashboardWidgetConfig;
        datakiConfig.onWidgetUpdate(dashboardId, pageId, widget.id, result);
    }, [widget, datakiConfig, dashboardId, pageId]);

    const onRemoveClick = useCallback(() => {
        onNodesDelete([widget.id]);
    }, [onNodesDelete, widget.id]);

    const actions = useMemo(() => (
        <>
            <Tooltip title={"Add this view to a different dashboard"}>
                <IconButton size={"small"} onClick={onAddToDashboard}>
                    <Copy size={"small"}/>
                </IconButton>
            </Tooltip>
            <Button
                color={executionError ? "error" : "neutral"}
                size={"small"}
                onClick={onEditWidget}
            >
                {executionError ? <Wand2 size="small"/> : <MessageSquare size="small"/>}
                {executionError ? "Fix" : "Edit"}
            </Button>
        </>
    ), [executionError, onAddToDashboard, onEditWidget]);

    const commonProps = useMemo(() => ({
        actions,
        params,
        paramFilters,
        filters,
        readOnly,
        onRemoveClick,
        onUpdated,
        onError,
        dashboardId
    }), [actions, params, paramFilters, filters, readOnly, onRemoveClick, onUpdated, onError, dashboardId]);

    // Handle text widgets
    if (widget.type === "title" || widget.type === "subtitle" || widget.type === "text") {
        return (
            <GridTextWrapper
                widget={widget}
                dashboardId={dashboardId}
                pageId={pageId}
                readOnly={readOnly}
                onNodesDelete={onNodesDelete}
            />
        );
    }
    // Handle filter widgets
    if (widget.type === "filter") {
        const filterWidget = widget as FilterWidgetItem;
        const currentParamFilter = paramFilters.find(f => f.key === filterWidget.key);

        return (
            <div className={cls("w-full h-full flex flex-col justify-end p-1 rounded-lg transition-colors",
                !readOnly && "hover:bg-surface-accent-100 dark:hover:bg-surface-accent-800")}>
                <FilterWidgetView
                    dryConfig={filterWidget}
                    value={currentParamFilter?.value}
                    operator={currentParamFilter?.operator}
                    onChange={(newValue, newOperator) => {
                        onFilterValueChange(filterWidget.key, newValue, newOperator);
                    }}
                    onRemoveClick={onRemoveClick}
                    onUpdated={(newConfig) => {
                        const result: FilterWidgetItem = {
                            ...filterWidget,
                            ...newConfig
                        };
                        datakiConfig.onWidgetUpdate(dashboardId, pageId, filterWidget.id, result);
                    }}
                    readOnly={readOnly}
                    dashboardId={dashboardId}
                />
            </div>
        );
    }

    // Handle chart/table/scorecard widgets - TypeScript knows widget is DashboardWidgetConfig here
    const dashboardWidget = widget as DashboardWidgetConfig;

    return (
        <div className="w-full h-full"
            style={{
                background: "var(--dataki-widget-bg)",
                borderColor: "var(--dataki-widget-border-color)",
                borderWidth: "var(--dataki-widget-border-width)",
                borderStyle: "solid",
                borderRadius: "var(--dataki-widget-border-radius)",
                boxShadow: "var(--dataki-widget-shadow)",
                padding: "var(--dataki-widget-padding)",
            } as React.CSSProperties}
        >            <AddToDashboardDialog
                open={addToDashboardDialogOpen}
                setOpen={setAddToDashboardDialogOpen}
                widget={dashboardWidget}
                onWidgetAdded={() => {
                }}
            />

            {dashboardWidget.type === "chart" && (
                <ChartConfigView
                    dryConfig={dashboardWidget as DryChartWidgetConfig}
                    {...commonProps}
                />
            )}

            {dashboardWidget.type === "table" && (
                <TableConfigView
                    dryConfig={dashboardWidget as DryTableWidgetConfig}
                    {...commonProps}
                />
            )}

            {dashboardWidget.type === "scorecard" && (
                <ScorecardConfigView
                    dryConfig={dashboardWidget as DryScorecardWidgetConfig}
                    {...commonProps}
                />
            )}
        </div>
    );
}

export default React.memo(GridWidgetWrapper, (prevProps, nextProps) => {
    return prevProps.widget === nextProps.widget &&
        prevProps.dashboardId === nextProps.dashboardId &&
        prevProps.pageId === nextProps.pageId &&
        prevProps.params === nextProps.params &&
        prevProps.paramFilters === nextProps.paramFilters &&
        prevProps.filters === nextProps.filters &&
        prevProps.readOnly === nextProps.readOnly
});
