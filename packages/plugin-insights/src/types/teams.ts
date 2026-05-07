import { DataSource } from "./datasources";
import { DashboardTheme } from "./dashboards";

export type Team = {
    id: string;
    name: string;
    created_at?: Date;
    updated_at?: Date;
    deleted?: boolean;
    users?: string[];
    created_by?: string;
    linked_gcp_projects?: string[];
    dataSources?: DataSource[];
    /** Team-level reusable theme library */
    themes?: DashboardTheme[];
}
