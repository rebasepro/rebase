import { DataSource } from "./datasources";
import { User } from "@rebasepro/types";

export type DatakiUser = User & Record<string, any>;
export type GCPProject = Record<string, any>;
export type Team = {
    id: string;
    name: string;
    dataSources?: DataSource[];
    [key: string]: any;
};
