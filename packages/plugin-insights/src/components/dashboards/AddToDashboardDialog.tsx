import { X } from "lucide-react";
import { Dialog, DialogContent, IconButton, Typography } from "@rebasepro/ui";
import React from "react";
import { useDataki } from "../../DatakiContext";
import { DashboardPreviewCard, NewDashboardCard } from "./DashboardPreviewCard";
import {
    Dashboard,
    DashboardItem,
    DryChartWidgetConfig,
    DryScorecardWidgetConfig,
    DryTableWidgetConfig
} from "../../types";

export function AddToDashboardDialog({
                                         open,
                                         setOpen,
                                         widget,
                                         onWidgetAdded
                                     }: {
    open: boolean;
    setOpen: (open: boolean) => void;
    widget: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig;
    onWidgetAdded: (dashboard: Dashboard, dashboardWidget: DashboardItem) => void;
}) {

    const datakiConfig = useDataki();

    return <Dialog
        maxWidth={"4xl"}
        open={open}
        onOpenChange={setOpen}
        onOpenAutoFocus={(e) => {
            e.preventDefault();
        }}>
        <DialogContent className={"flex flex-col gap-4"}>
            <Typography variant={"label"}>Select a dashboard to add this widget to</Typography>

            <NewDashboardCard
                initialWidget={widget}
                onDashboardCreated={(dashboard, dashboardWidget) => {
                    if (!dashboardWidget) throw new Error("INTERNAL: Dashboard widget is required");
                    setOpen(false);
                    onWidgetAdded(dashboard, dashboardWidget);
                }}/>

            <div className={"flex flex-row gap-2 flex-wrap"}>
                {datakiConfig.dashboards.map((dashboard, index) => (
                    <DashboardPreviewCard
                        key={index}
                        dashboard={dashboard}
                        onClick={() => {
                            const dashboardWidget = datakiConfig.addDashboardWidget(dashboard.id, widget);
                            onWidgetAdded(dashboard, dashboardWidget);
                            setOpen(false);
                        }}/>
                ))}
            </div>
        </DialogContent>
        {/*<DialogActions>*/}
        {/*    <Button variant={"text"} color={"neutral"}*/}
        {/*            onClick={() => {*/}
        {/*                setOpen(false);*/}
        {/*            }}>Cancel</Button>*/}
        {/*</DialogActions>*/}

        <IconButton className={"absolute top-4 right-4"}
                    onClick={() => setOpen(false)}>
            <X/>
        </IconButton>
    </Dialog>;
}
