import React, { useEffect } from "react";
import { DatakiConfig } from "../DatakiProvider";
import { useLocation, useParams } from "react-router-dom";
import { Dashboard, Position } from "../types";
import { DashboardView } from "../components/dashboards/DashboardView";
import { CenteredView, Typography } from "@rebasepro/ui";
import { useDashboardAccess } from "../hooks/useDashboardAccess";
import { Loader2 } from "lucide-react";

function CircularProgressCenter() {
    return (
        <div className="flex items-center justify-center w-full h-full min-h-[200px]">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
    );
}

export function DashboardRoute({
                                   datakiConfig,
                                   onAnalyticsEvent,
                               }: {
    datakiConfig: DatakiConfig,
    onAnalyticsEvent?: (event: string, params?: any) => void,
}) {

    const { dashboardId } = useParams();
    if (!dashboardId) throw Error("Dashboard id not found");

    return <DashboardRouteInner
        key={dashboardId}
        dashboardId={dashboardId}
        datakiConfig={datakiConfig}
        onAnalyticsEvent={onAnalyticsEvent}/>
}

interface DashboardRouteInnerProps {
    dashboardId: any;
    datakiConfig: DatakiConfig;
    onAnalyticsEvent?: (event: string, params?: any) => void,
}

function DashboardRouteInner({
                                 dashboardId,
                                 datakiConfig,
                                 onAnalyticsEvent,
                             }: DashboardRouteInnerProps) {

    const location = useLocation();

    const initialViewPosition = location.state?.initialViewPosition as Position | undefined;
    useEffect(() => {
        if (initialViewPosition != null) {
            // eslint-disable-next-line react-compiler/react-compiler
            location.state = {};
        }
    }, [initialViewPosition]);

    // Use dashboard access hook for security check
    const dashboardAccess = useDashboardAccess(dashboardId, datakiConfig.firebaseApp, datakiConfig.userData ? { uid: datakiConfig.userData.id } as any : null);

    const [dashboard, setDashboard] = React.useState<Dashboard | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<Error | null>(null);

    useEffect(() => {
        // If access check is still loading, wait
        if (dashboardAccess.loading) {
            setLoading(true);
            return;
        }

        // If no access, don't try to load dashboard
        if (!dashboardAccess.canAccess) {
            setLoading(false);
            setError(dashboardAccess.error || new Error('Access denied'));
            return;
        }

        // If we have access, listen to dashboard updates
        setLoading(true);
        console.log("Loading dashboard", dashboardId);
        return datakiConfig.listenDashboard(dashboardId,
            (dashboard: any) => {
                console.debug("Dashboard updated", dashboard);
                setDashboard(dashboard);
                setLoading(false);
                setError(null);
            }, (error: any) => {
                console.error("Error loading dashboard", error);
                setLoading(false);
                setError(error);
            });
    }, [dashboardId, dashboardAccess.loading, dashboardAccess.canAccess]);

    if (loading) {
        return <CircularProgressCenter/>
    }

    if (error) {
        return <CenteredView>
            <Typography variant={"label"}>
                {error.message.includes('Access denied') ? 'Access Denied' : 'Error loading dashboard'}: {error.message}
            </Typography>
        </CenteredView>
    }

    if (!dashboard) {
        return <CenteredView>
            <Typography variant={"label"}>
                Dashboard not found
            </Typography>
        </CenteredView>
    }

    return (
        <DashboardView
            dashboard={dashboard}
            initialViewPosition={initialViewPosition}
            onAnalyticsEvent={onAnalyticsEvent}
        />
    )
}
