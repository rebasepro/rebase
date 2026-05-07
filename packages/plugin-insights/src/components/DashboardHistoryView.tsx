import { Card, Chip, CircularProgress, cls, getColorSchemeForSeed, IconButton, Tooltip, Typography } from "@rebasepro/ui";
import { Filter, Type, History } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDataki } from "../DatakiProvider";
import { Dashboard, DashboardUpdateType } from "../types";
import { useSnackbarController } from "@rebasepro/core";
import { DashboardPanel } from "./DashboardPanel";

const PAGE_SIZE = 20;

export const DashboardHistoryView = React.memo(function DashboardHistoryView({
    dashboardId,
    onClose,
    hidden
}: {
    dashboardId: string,
    onClose?: () => void,
    hidden?: boolean
}) {

    const dataki = useDataki();
    const snackbarController = useSnackbarController();
    const [history, setHistory] = useState<Dashboard[]>([]);
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [loading, setLoading] = useState(true);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setLoading(true);
        const unsubscribe = dataki.listenDashboardHistory(dashboardId, (newHistory: Dashboard[]) => {
            setHistory(newHistory);
            setLoading(false);
        }, limit);
        return unsubscribe;
    }, [dashboardId, limit]);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
        // Load more when within 100px of bottom
        if (scrollBottom < 100 && !loading && history.length === limit) {
            setLimit(prev => prev + PAGE_SIZE);
        }
    }, [loading, history.length, limit]);

    return <DashboardPanel
        title={<Typography variant={"label"}>
            Dashboard history
        </Typography>}
        onClose={onClose}
        className={cls({ hidden })}
        contentClassName={"p-4 overflow-auto"}
        onContentScroll={handleScroll}
        contentRef={scrollContainerRef}>
        {history.map(dashboardEntry => <Card key={dashboardEntry.revision}>
            <div className={"flex gap-6 items-center p-4"}>
                <div className={"flex flex-col gap-1 flex-1"}>
                    {dashboardEntry.updated_type && <UpdateTypeLabel type={dashboardEntry.updated_type} />}
                    <div className={"flex gap-2 items-center"}>

                        <Typography variant={"caption"}>
                            {dashboardEntry.updatedByUser?.displayName ?? dashboardEntry.updatedByUser?.email ?? dashboardEntry.updated_by}</Typography>
                        <Typography color={"secondary"}
                            variant={"caption"}> {dashboardEntry.updated_at.toLocaleString()}</Typography>
                    </div>

                </div>
                <Tooltip title={"Revert to this version"}>
                    <IconButton size={"small"}
                        onClick={() => {
                            dataki.revertDashboard(dashboardEntry)
                                .then(() => {
                                    snackbarController.open({
                                        message: "Dashboard reverted",
                                        type: "success"
                                    });
                                })
                                .catch((error: any) => {
                                    console.error("Error reverting dashboard", error);
                                    snackbarController.open({
                                        message: "Error reverting dashboard",
                                        type: "error"
                                    });
                                });
                            onClose?.();
                        }}>
                        <History size={20} />
                    </IconButton>
                </Tooltip>
            </div>

        </Card>)}
        {loading && <div className="flex justify-center py-4"><CircularProgress size="small" /></div>}
    </DashboardPanel>;
});

function UpdateTypeLabel({ type }: { type: DashboardUpdateType }) {
    const color = getColorSchemeForSeed(type);
    return <Chip
        colorScheme={color}
        size={"small"}>{getTypeText(type)}</Chip>;
}

function getTypeText(type: DashboardUpdateType) {
    switch (type) {
        case "text_update":
            return "Text update";
        case "title_update":
            return "Title update";
        case "widget_create":
            return "Widget created";
        case "widget_update":
            return "Widget updated";
        case "widget_move":
            return "Widget moved";
        case "widget_resize":
            return "Widget resized";
        case "widget_remove":
            return "Widget removed";
        case "widgets_remove":
            return "Widgets removed";
        case "page_update":
            return "Page updated";
        case "dashboard_delete":
            return "Dashboard deleted";
        case "dashboard_create":
            return "Dashboard created";
        case "dashboard_revert":
            return "Dashboard reverted";
        case "filter_add":
            return "Filter added";
        case "filter_update":
            return "Filter updated";
        case "filter_remove":
            return "Filter removed";
        case "public_update":
            return "Visibility changed";
        case "permissions_update":
            return "Permissions changed";
    }
    console.warn("getTypeText: Unknown update type", type);
    return type;
}
