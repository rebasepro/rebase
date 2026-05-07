import equal from "react-fast-compare";

import {
    areDataSourcesEqual,
    ChatMessage,
    Dashboard,
    DashboardFilterConfig,
    DashboardItem,
    DashboardPage,
    DataSource,
    DateParams
} from "../types";

/**
 * Compare two Dashboards for equality.
 * Focuses on properties that affect rendering in the main view.
 */
export function areDashboardsEqual(prev: Dashboard, next: Dashboard): boolean {
    if (prev === next) return true;
    if (!prev || !next) return false;

    if (prev.id !== next.id) return false;
    if (prev.title !== next.title) return false;
    if (prev.description !== next.description) return false;

    // Compare pages
    if (prev.pages === next.pages) {
        // Same reference, assuming deep equality if immutable.
        // But if someone mutated deep, we might miss it.
        // Given the app seems to use immutable updates (DatakiProvider), reference check is good optimization.
        // But let's be safe and check length first.
    }

    if (prev.pages.length !== next.pages.length) return false;

    for (let i = 0; i < prev.pages.length; i++) {
        if (!areDashboardPagesEqual(prev.pages[i], next.pages[i])) return false;
    }

    // Check permissions if they affect UI (e.g. read-only mode)
    // We can compare arrays length and string values
    if (prev._users_write?.length !== next._users_write?.length) return false;
    if (prev._users_write && next._users_write) {
        for (let i = 0; i < prev._users_write.length; i++) {
            if (prev._users_write[i] !== next._users_write[i]) return false;
        }
    }

    // Compare theme
    if (!equal(prev.theme, next.theme)) return false;

    return true;
}

/**
 * Compare two DashboardPages for equality.
 * This is critical for DashboardPageView performance.
 */
export function areDashboardPagesEqual(prev: DashboardPage, next: DashboardPage): boolean {
    if (prev === next) return true;
    if (!prev || !next) return false;

    if (prev.id !== next.id) return false;
    if (prev.title !== next.title) return false;

    // Compare Filters
    if (!areDashboardFilterArraysEqual(prev.filters, next.filters)) return false;

    // Compare Widgets
    if (!areDashboardWidgetArraysEqual(prev.widgets, next.widgets)) return false;

    return true;
}

function areDashboardFilterArraysEqual(prev: DashboardFilterConfig[], next: DashboardFilterConfig[]): boolean {
    if (prev === next) return true;
    if (!prev || !next) return false;
    if (prev.length !== next.length) return false;

    for (let i = 0; i < prev.length; i++) {
        if (!areDashboardFiltersEqual(prev[i], next[i])) return false;
    }
    return true;
}

export function areDashboardFiltersEqual(prev: DashboardFilterConfig, next: DashboardFilterConfig): boolean {
    if (prev === next) return true;
    if (prev.key !== next.key) return false;
    if (prev.label !== next.label) return false;
    if (prev.type !== next.type) return false;

    // Position
    if (prev.position?.x !== next.position?.x) return false;
    if (prev.position?.y !== next.position?.y) return false;

    // Options / DataSources (if filters have sources)
    if (prev.options?.length !== next.options?.length) return false;

    // Generic check for other props if needed, but keeping it simple for now
    return true;
}

function areDashboardWidgetArraysEqual(prev: DashboardItem[], next: DashboardItem[]): boolean {
    if (prev === next) return true;
    if (!prev || !next) return false;
    if (prev.length !== next.length) return false;

    for (let i = 0; i < prev.length; i++) {
        if (!areDashboardWidgetsEqual(prev[i], next[i])) return false;
    }
    return true;
}

/**
 * Compare individual DashboardItems (Widgets).
 */
export function areDashboardWidgetsEqual(prev: DashboardItem, next: DashboardItem): boolean {
    if (prev === next) return true;
    if (prev.id !== next.id) return false;
    if (prev.type !== next.type) return false;

    // Position & Size
    if (prev.position.x !== next.position.x) return false;
    if (prev.position.y !== next.position.y) return false;
    if (prev.size.width !== next.size.width) return false;
    if (prev.size.height !== next.size.height) return false;

    // Specific config by type
    if (prev.type === "chart" && next.type === "chart") {
        if (prev.title !== next.title) return false;
        if (prev.sql !== next.sql) return false;
        if (prev.description !== next.description) return false;
        // DataSources check
        if (!areDataSourceArraysEqual(prev.dataSources, next.dataSources)) return false;

        // Deep compare the chart config (Vega-Lite spec)
        // Since this can be complex, stringify is a reasonable compromise for "quirurgic" if we don't want to list every vega field.
        // Or we can check key top-level properties of the chart spec.
        if (!equal(prev.chart, next.chart)) return false;
    } else if (prev.type === "scorecard" && next.type === "scorecard") {
        if (prev.title !== next.title) return false;
        if (prev.sql !== next.sql) return false;
        if (prev.description !== next.description) return false;
        if (!areDataSourceArraysEqual(prev.dataSources, next.dataSources)) return false;
        if (!equal(prev.scorecard, next.scorecard)) return false;
    } else if (prev.type === "table" && next.type === "table") {
        if (prev.title !== next.title) return false;
        if (prev.sql !== next.sql) return false;
        if (prev.description !== next.description) return false;
        if (!areDataSourceArraysEqual(prev.dataSources, next.dataSources)) return false;
        if (!equal(prev.table, next.table)) return false;
    } else if (prev.type === "text" && next.type === "text") {
        if (prev.text !== next.text) return false;
    } else if ((prev.type === "title" || prev.type === "subtitle") && (next.type === "title" || next.type === "subtitle")) {
        if ("text" in prev && "text" in next && prev.text !== next.text) return false;
    }

    return true;
}

function areDataSourceArraysEqual(prev: DataSource[], next: DataSource[]): boolean {
    if (prev === next) return true;
    if (!prev || !next) return false;
    if (prev.length !== next.length) return false;

    for (let i = 0; i < prev.length; i++) {
        if (!areDataSourcesEqual(prev[i], next[i])) return false;
    }
    return true;
}

/**
 * Compare ChatMessages
 */
export function areChatMessagesEqual(prev: ChatMessage, next: ChatMessage): boolean {
    if (prev === next) return true;
    if (prev.id !== next.id) return false;
    if (prev.text !== next.text) return false;
    if (prev.user !== next.user) return false;
    // if (prev.date?.getTime() !== next.date?.getTime()) return false;
    if (prev.thoughtText !== next.thoughtText) return false;

    // Function calls
    if (prev.function_call || next.function_call) {
        if (!prev.function_call || !next.function_call) return false;
        if (prev.function_call.id !== next.function_call.id) return false;
        if (prev.function_call.name !== next.function_call.name) return false;

        // Check generic params/arguments
        // The type might be FunctionCall or specific subclass, usually 'params' for SQL/Python
        if (!equal(prev.function_call, next.function_call)) return false;
    }

    // Feedback
    if (prev.negative_feedback !== next.negative_feedback) { // Reference check first
        if (prev.negative_feedback?.reason !== next.negative_feedback?.reason) return false;
    }

    // Attached files
    if (prev.attachedFiles?.length !== next.attachedFiles?.length) return false;

    return true;
}

export function areDateParamsEqual(prev: DateParams, next: DateParams): boolean {
    if (prev === next) return true;
    if (prev.dateStart?.getTime() !== next.dateStart?.getTime()) return false;
    if (prev.dateEnd?.getTime() !== next.dateEnd?.getTime()) return false;
    return true;
}
