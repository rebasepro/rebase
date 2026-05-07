import React from "react";
import { useDataki } from "../../DatakiProvider";
import { Button, Card, cls, Typography } from "@rebasepro/ui";
import { Loader2, Plus } from "lucide-react";
import { DashboardPreviewCard } from "../dashboards/DashboardPreviewCard";
import { useNavigate } from "react-router-dom";
import { getDashboardPath } from "../../utils/navigation";
import { useNewDashboardFlow } from "../hooks/useNewDashboardFlow";

export function DashboardsOverview() {
    const datakiConfig = useDataki();
    const navigate = useNavigate();

    const {
        dialog,
        openDialog,
        loading,
    } = useNewDashboardFlow({
        onDashboardCreated: (dashboard) => {
            console.log("Dashboard created", dashboard);
            navigate(getDashboardPath(dashboard.id));
        }
    });

    if (datakiConfig.loading) {
        return (
            <div className="flex items-center justify-center w-full min-h-[200px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className={"my-8"}>

            <div className={"flex flex-row"}>
                <Typography variant={"h6"} gutterBottom={true} className={"flex-grow font-mono my-2"}>
                    Dashboards
                </Typography>
                <Button color={"neutral"}
                        size={"small"}
                        disabled={loading}
                        onClick={openDialog}>
                    <Plus/>
                    New dashboard
                </Button>
            </div>
            <div className={"flex flex-row flex-wrap font-mono  mx-auto min-h-48 flex-1 gap-2 my-4"}>
                {datakiConfig.dashboards.map((dashboard, index) => (
                    <DashboardPreviewCard
                        key={dashboard.id}
                        dashboard={dashboard}
                        onClick={() => {
                            console.log("Navigate to dashboard", dashboard.id);
                            navigate(getDashboardPath(dashboard.id));
                        }}/>
                ))}
                <Card
                    className={cls("m-0 p-4 cursor-pointer h-[180px] w-[270px] rounded-xl")}
                    onClick={openDialog}>

                    <div className="flex flex-col items-center justify-center h-full w-full ">

                        <Plus color={"primary"}/>
                        <Typography gutterBottom variant="caption" className={"uppercase text-semibold mt-2"}>
                            {"New dashboard"}
                        </Typography>
                    </div>

                </Card>
            </div>

            {dialog}
        </div>
    );
}
