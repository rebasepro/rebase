import {
    DashboardWidgetConfig,
    DryChartWidgetConfig,
    DryScorecardWidgetConfig,
    DryTableWidgetConfig,
    ParamFilter
} from "../types";
import { randomString } from "@rebasepro/utils";
;;

export const DEFAULT_DASHBOARD_WIDTH = 1200;

export const DEFAULT_WIDGET_SIZE = {
    height: 340,
    width: 600
};

export const DEFAULT_SCORECARD_SIZE = {
    height: 160,
    width: 300
};

export const DEFAULT_FILTER_SIZE = {
    height: 50,
    width: 300
};

export const DEFAULT_PAPER_SIZE = {
    height: 1525,
    width: 1275
};

export const TITLE_HEIGHT = 148;
export const SUBTITLE_HEIGHT = 70;
export const TEXT_HEIGHT = 70;
export const TEXT_WIDTH = DEFAULT_DASHBOARD_WIDTH;

export const DEFAULT_GRID_SIZE = 25;

export function getConfigWithoutSize<T extends DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig>(config: T | DashboardWidgetConfig): T {
    const {
        size,
        // @ts-ignore
        position,
        ...rest
    } = config;
    return rest as T;
}

export function isConfigUsingDateParams(config: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig) {
    const sql = config.sql.toUpperCase();
    return sql.includes("@DATE_START") || sql.includes("@DATE_END");
}

export function isConfigRelatedToParam(config: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig, param: ParamFilter) {
    return config.sql.includes("@" + param.key);
}

export function getUsedParamsForConfig(config: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig, params: ParamFilter[]) {
    return params
        .filter(paramHasValue)
        .filter(param => isConfigRelatedToParam(config, param));
}

export function paramHasValue(param: ParamFilter) {
    return Boolean(param.value) && (Array.isArray(param.value) ? param.value.length > 0 : true);
}

export function generateWidgetId() {
    return randomString(20);
}
