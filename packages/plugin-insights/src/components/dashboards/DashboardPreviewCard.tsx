import { ArrowRight, Copy, LineChart, MoreVertical, Plus, Trash2 } from "lucide-react";
import React from "react";
import {
    Dashboard,
    DashboardWidgetConfig,
    DryChartWidgetConfig,
    DryScorecardWidgetConfig,
    DryTableWidgetConfig,
    FilterWidgetItem
} from "../../types";
import { Card, cls, IconButton, Markdown, Menu, MenuItem, Typography } from "@rebasepro/ui";
import { useDataki } from "../../DatakiContext";
import { useNewDashboardFlow } from "../hooks/useNewDashboardFlow";
import { useConfirmationDialog } from "../../hooks/useConfirmationDialog";
import { useNavigate } from "react-router-dom";

export type DashboardCardProps = {
    dashboard: Dashboard;
    onClick?: () => void,
};

export function DashboardPreviewCard({
                                         dashboard,
                                         onClick
                                     }: DashboardCardProps) {

    const {
        title,
        description
    } = dashboard;

    const datakiConfig = useDataki();

    const navigate = useNavigate();
    const onDuplicateClick = async () => {
        try {
            const newDashboard = await datakiConfig.duplicateDashboard(dashboard.id);
            // Navigate to the new dashboard
            navigate(`/dashboards/${newDashboard.id}`);
        } catch (error) {
            console.error("Failed to duplicate dashboard:", error);
        }
    };

    const {
        open: openDeleteConfirmation,
        ConfirmationDialog: DeleteConfirmationDialog
    } = useConfirmationDialog({
        title: "Delete Dashboard",
        confirmMessage: `Are you sure you want to delete "${title ?? "Untitled dashboard"}"?`,
        onAccept: () => {
            datakiConfig.deleteDashboard(dashboard.id);
        }
    });

    return (<>
        <Card
            className={cls("m-0 p-4 cursor-pointer h-[180px] w-[270px] rounded-xl")}
            onClick={() => {
                onClick?.();
            }}>

            <div className="flex flex-col items-start h-full">
                <div
                    className="flex-grow w-full">

                    <div
                        className="h-10 flex items-center w-full justify-between text-surface-300 dark:text-surface-600">

                        <LineChart/>

                        <div
                            className="flex items-center gap-1"
                            onClick={(event: React.MouseEvent) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}>

                            <Menu
                                trigger={<IconButton>
                                    <MoreVertical size={"small"}/>
                                </IconButton>}
                            >
                                <MenuItem
                                    dense={true}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onDuplicateClick();
                                    }}>
                                    <Copy size={"small"}/>
                                    Duplicate
                                </MenuItem>
                                <MenuItem
                                    dense={true}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        openDeleteConfirmation();
                                    }}>
                                    <Trash2 size={"small"}/>
                                    Delete
                                </MenuItem>

                            </Menu>

                        </div>

                    </div>

                    <Typography gutterBottom variant="subtitle2">
                        {title ?? "Untitled dashboard"}
                    </Typography>

                    {description && <Typography variant="body2"
                                                color="secondary"
                                                component="div">
                        <Markdown source={description} size={"small"}/>
                    </Typography>}
                </div>

                <div style={{ alignSelf: "flex-end" }}>

                    <div className={"p-4"}>
                        <ArrowRight className="text-primary"/>
                    </div>
                </div>

            </div>

        </Card>
        {DeleteConfirmationDialog}
    </>)
}

export function NewDashboardCard({
                                     initialWidget,
                                     onDashboardCreated
                                 }: {
    initialWidget: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig;
    onDashboardCreated: (dashboard: Dashboard, dashboardWidget?: DashboardWidgetConfig | FilterWidgetItem) => void;
}) {

    const {
        dialog,
        openDialog,
        loading
    } = useNewDashboardFlow({
        initialWidget,
        onDashboardCreated
    });

    return (
        <>
            <Card className={cls("p-4 min-h-[124px] flex items-center justify-center w-full flex-grow flex-col my-8")}
                  onClick={loading ? undefined : openDialog}>
                <Plus color={loading ? undefined : "primary"} size={"large"}/>
                <Typography color="primary"
                            variant={"caption"}
                            className={"font-semibold"}>
                    {"Create a new dashboard".toUpperCase()}
                </Typography>

            </Card>
            {dialog}
        </>
    );
}
