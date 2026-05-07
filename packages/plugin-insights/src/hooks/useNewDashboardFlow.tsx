import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from "@rebasepro/ui";
import { Share } from "lucide-react";
import { useDataki } from "../DatakiContext";
import { convertWidgetToDashboardConfig } from "../utils/dashboards";
import React, { useCallback, useEffect, useTransition } from "react";
import {
    Dashboard,
    DashboardItem,
    DashboardPage,
    DashboardWidgetConfig,
    DryChartWidgetConfig,
    DryScorecardWidgetConfig,
    DryTableWidgetConfig,
    FilterWidgetItem
} from "../types";
import { randomString } from "@rebasepro/utils";
import { generateWidgetId, TEXT_WIDTH, TITLE_HEIGHT } from "../utils/widgets";

export function useNewDashboardFlow({
                                        initialWidget,
                                        onDashboardCreated
                                    }: {
    initialWidget?: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig;
    onDashboardCreated: (dashboard: Dashboard, dashboardWidget?: DashboardWidgetConfig | FilterWidgetItem) => void;
}) {

    const datakiConfig = useDataki();

    const [dialogOpen, setDialogOpen] = React.useState(false);
    const [dialogTitle, setDialogTitle] = React.useState("");

    const [isPending, startTransition] = useTransition();

    const doCreate = useCallback(() => {

        if (dialogTitle.length === 0) {
            return;
        }
        startTransition(async () => {

            const widgets: DashboardItem[] = [
                {
                    id: generateWidgetId(),
                    type: "title",
                    text: dialogTitle,
                    position: {
                        x: 0,
                        y: 0
                    },
                    size: {
                        width: TEXT_WIDTH,
                        height: TITLE_HEIGHT
                    }
                }
            ];

            const page: DashboardPage = {
                id: randomString(20),
                title: dialogTitle,
                widgets,
                filters: []
            };

            let initialDashboardWidget: DashboardWidgetConfig | FilterWidgetItem | undefined;
            if (initialWidget) {
                initialDashboardWidget = convertWidgetToDashboardConfig(page, initialWidget);
                if (initialDashboardWidget) {
                    page.widgets.push(initialDashboardWidget);
                }
            }

            await datakiConfig.createDashboard({
                title: dialogTitle,
                pages: [page]
            })
                .then((dashboard: Dashboard) => onDashboardCreated(dashboard, initialDashboardWidget));
            setDialogTitle("");
            setDialogOpen(false);
        });
    }, [dialogTitle, initialWidget]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Enter" && dialogOpen) {
                event.preventDefault();
                doCreate();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [dialogOpen, doCreate]);

    const dialog = <Dialog open={dialogOpen}
                           onOpenChange={setDialogOpen}>
        <DialogTitle>
            Create a new dashboard
        </DialogTitle>
        <DialogContent className={"flex flex-col gap-4"}>

            <TextField value={dialogTitle}
                       size={"large"}
                       className={"rounded-xl"}
                       inputClassName={"rounded-xl"}
                       autoFocus={true}
                       placeholder={"Select a title for your new dashboard."}
                       onChange={(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                           setDialogTitle(event.target.value);
                       }}/>

            <Typography variant={"body2"}>
                Dashboards are a collection of widgets that can be used to visualize data. In a dashboard you can:

            </Typography>
            <Typography variant={"body2"}>
                <ul className={"list-disc ml-8"}>
                    <li><b>Explore the data</b> in your datasets in natural language</li>
                    <li>Generate visualizations like <b>charts and tables</b>.</li>
                    <li>Arrange your views in a <b>drag and drop</b> UI</li>
                    <li>Generate <b>filters</b></li>
                    <li><b>Share your</b> dashboards with your team</li>
                </ul>
            </Typography>

        </DialogContent>
        <DialogActions>
            <Button variant={"text"} color={"neutral"} onClick={() => {
                setDialogTitle("");
                setDialogOpen(false);
            }}>
                Cancel
            </Button>
            <Button variant={"filled"}
                    disabled={dialogTitle.length === 0}
                    onClick={doCreate}>
                Create
            </Button>
        </DialogActions>
    </Dialog>;

    return {
        dialog,
        openDialog: () => setDialogOpen(true),
        loading: isPending
    }
}
