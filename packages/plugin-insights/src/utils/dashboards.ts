import {
    DashboardItem,
    DashboardPage,
    DashboardWidgetConfig,
    DryChartWidgetConfig,
    DryFilterWidgetConfig,
    DryScorecardWidgetConfig,
    DryTableWidgetConfig,
    FilterWidgetItem,
    Position
} from "../types";
import {
    DEFAULT_FILTER_SIZE,
    DEFAULT_GRID_SIZE,
    DEFAULT_SCORECARD_SIZE,
    DEFAULT_WIDGET_SIZE,
    generateWidgetId
} from "./widgets";

export function sortWidgetsByPosition(widgets: DashboardItem[]): DashboardItem[] {
    return [...widgets].sort((a, b) => {
        const ax = a.position?.x ?? 0;
        const ay = a.position?.y ?? 0;
        const bx = b.position?.x ?? 0;
        const by = b.position?.y ?? 0;

        if (ax !== bx) return ax - bx;
        return ay - by;
    });
}

export function reorderPageWidgetsIfNeeded(page: DashboardPage): DashboardPage {
    // No widgets or a single widget: nothing to reorder
    if (!page.widgets || page.widgets.length <= 1) return page;

    const sortedWidgets = sortWidgetsByPosition(page.widgets);

    // If order didn't change, return original page reference
    let changed = false;
    for (let i = 0; i < page.widgets.length; i++) {
        if (page.widgets[i].id !== sortedWidgets[i].id) {
            changed = true;
            break;
        }
    }

    if (!changed) return page;

    return {
        ...page,
        widgets: sortedWidgets
    };
}

export function convertWidgetToDashboardWidget(
    config: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig | DryFilterWidgetConfig,
    position?: Position,
    existingId?: string
): DashboardWidgetConfig | FilterWidgetItem {
    const defaultSize = config.type === "scorecard"
        ? DEFAULT_SCORECARD_SIZE
        : config.type === "filter"
            ? DEFAULT_FILTER_SIZE
            : DEFAULT_WIDGET_SIZE;
    return {
        ...config,
        id: existingId ?? config.id ?? generateWidgetId(),
        position: position ?? (config as any).position ?? {
            x: 0,
            y: 0
        },
        size: config.size ?? defaultSize
    } as DashboardWidgetConfig | FilterWidgetItem;
}

export function convertWidgetToDashboardConfig(dashboardPage: DashboardPage, widget: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig | DryFilterWidgetConfig) {
    const maxYPosition = dashboardPage.widgets.reduce((acc, w) => {
        const y = w.position.y + w.size.height;
        if (y > acc)
            return y;
        return acc;
    }, 0);
    return convertWidgetToDashboardWidget(widget, {
        x: DEFAULT_GRID_SIZE,
        y: maxYPosition + DEFAULT_GRID_SIZE
    });
}
