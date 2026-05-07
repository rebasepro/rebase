import React, { createContext, useContext } from "react";
import { DataSource } from "./types/dashboards/datasources";

import { TextItem, DryChartWidgetConfig, DryTableWidgetConfig, DryScorecardWidgetConfig, DryFilterWidgetConfig, DashboardWidgetConfig, FilterWidgetItem, Dashboard, ChatSession } from "./types";

export type DatakiConfigParams = {
    enabled?: boolean;
    firebaseApp?: any;
    getDatakiAuthToken: () => Promise<string>;
    apiEndpoint: string;
    user?: any;
    authLoading?: boolean;
    appBarRef?: React.RefObject<HTMLDivElement>;
};

export type ListenChatSessionsParams = {
    userId?: string;
    dashboardId?: string;
    limit?: number;
    onChatSessionsUpdate?: (sessions: ChatSession[]) => void;
};

export type DatakiConfig = {
    loading?: boolean;
    dataSources?: DataSource[];
    theme?: any;
    dashboards: Dashboard[];
    addDashboardWidget: (id: string, widget: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig | DryFilterWidgetConfig) => DashboardWidgetConfig | FilterWidgetItem;
    duplicateDashboard: (id: string) => Promise<Dashboard>;
    deleteDashboard: (id: string) => void;
    createDashboard: (params: any) => Promise<Dashboard>;
    apiEndpoint: string;
    getDatakiAuthToken: () => Promise<string>;
    embedApiKey?: string;
    onWidgetUpdate: (dashboardId: string, pageId: string, id: string, widget: DashboardWidgetConfig | FilterWidgetItem) => Promise<void> | undefined;
    updateDashboardText: (dashboardId: string, pageId: string, id: string, node: TextItem) => Promise<void>;
    [key: string]: any; // Allow other properties from useBuildDatakiConfig
};

export const DatakiConfigContext = createContext<DatakiConfig>({ dashboards: [], addDashboardWidget: () => ({} as any), duplicateDashboard: async () => ({} as any), deleteDashboard: () => {}, createDashboard: async () => ({} as any), apiEndpoint: "", getDatakiAuthToken: async () => "", onWidgetUpdate: () => undefined, updateDashboardText: async () => {} } as DatakiConfig);

export const useDataki = () => useContext(DatakiConfigContext);

export const DatakiProvider: React.FC<{ children: React.ReactNode, config: DatakiConfig }> = ({ children, config }) => {
    return <DatakiConfigContext.Provider value={config}>{children}</DatakiConfigContext.Provider>;
};
