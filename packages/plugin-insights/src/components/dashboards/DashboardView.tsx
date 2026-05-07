import { Dashboard, Position } from "../../types";
import React from "react";
import { DashboardPageView } from "./DashboardPageView";
import { useAuthController } from "@rebasepro/core";
import { DashboardPageReadOnlyView } from "./DashboardPageReadOnlyView";
import { areDashboardsEqual } from "../../utils/comparators";

export const DashboardView = React.memo(function DashboardView({
    dashboard,
    initialViewPosition,
    onAnalyticsEvent
}: {
    dashboard: Dashboard,
    initialViewPosition?: Position,
    onAnalyticsEvent?: (event: string, data?: any) => void
}) {

    const {
        id,
        title,
        description,
        pages
    } = dashboard;

    const [selectedPageId, setSelectedPageId] = React.useState(pages[0].id);

    const selectedPage = pages.find(page => page.id === selectedPageId);

    const authController = useAuthController();
    const canUserEdit = dashboard._users_write?.includes(authController.user?.uid ?? "") ?? false;

    return (
        <div className={"w-full h-full"}>
            {/*{selectedPage &&*/}
            {/*    <DashboardPageReadOnlyView page={selectedPage}*/}
            {/*                               dashboard={dashboard}*/}
            {/*                               onAnalyticsEvent={onAnalyticsEvent}*/}
            {/*                               initialViewPosition={initialViewPosition}*/}
            {/*    />}*/}
            {selectedPage &&
                <DashboardPageView page={selectedPage}
                    dashboard={dashboard}
                    onAnalyticsEvent={onAnalyticsEvent}
                    readOnly={!canUserEdit}
                    initialViewPosition={initialViewPosition}
                />}
        </div>
    );

}, (prev, next) => {
    if (!areDashboardsEqual(prev.dashboard, next.dashboard)) return false;
    if (prev.initialViewPosition?.x !== next.initialViewPosition?.x) return false;
    if (prev.initialViewPosition?.y !== next.initialViewPosition?.y) return false;
    return true;
});
