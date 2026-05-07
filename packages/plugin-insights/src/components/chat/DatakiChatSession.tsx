import React from "react";
import { ChatSession, DataSource, DashboardPage } from "../../types";

export function getInitialDataSources(
    selectedSession: ChatSession | undefined,
    uid: string,
    allDataSources: DataSource[],
    page: DashboardPage | undefined
): DataSource[] {
    return [];
}

export function DatakiChatSession(props: any) {
    return (
        <div className="p-4 flex items-center justify-center h-full text-gray-500">
            AI features are currently disabled.
        </div>
    );
}
