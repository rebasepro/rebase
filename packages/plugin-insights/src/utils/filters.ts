import { Filter } from "lucide-react";
import { DashboardFilterConfig, ParamFilter } from "../types";

export function getInitialParamFilters(filters: DashboardFilterConfig[]): ParamFilter[] {
    return filters.map(filter => ({
        key: filter.key,
        value: null,
        type: filter.type,
        operator: filter.type === "number" || filter.type === "date" ? "==" : undefined
    }));
}
