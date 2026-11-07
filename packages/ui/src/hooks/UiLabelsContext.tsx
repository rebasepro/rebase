"use client";
import React, { createContext, useContext, useMemo } from "react";

/**
 * The words the kit itself puts on screen: the list and card views' notices,
 * the table's error title, the search bar's names, the split view's back
 * button and divider, the metric blocks' change and period phrases, and the
 * relative-time phrases of `formatRelativeTime`
 * (`@rebasepro/utils`).
 *
 * A label that carries a value is a function of it, so a translation can
 * choose its own plural form.
 */
export interface UiLabels {
    /** A list or card view that could not load its first page: "Error loading data: <message>". */
    errorLoadingData: (message: string) => string;
    /** A list or card view with no rows. */
    noEntriesFound: string;
    /** Under the last row of a list or card view: "All <count> entries loaded". */
    allEntriesLoaded: (count: number) => string;
    /** The title of a table that could not load its rows. */
    error: string;
    /** The search bar's name, and its placeholder when none is given. */
    search: string;
    /** The search bar's clear button. */
    clearSearch: string;
    /** A row's or card's selection checkbox in the collection views. */
    select: string;
    /** The button that opens a time-of-day field's picker (`DateTimeField mode="time"`). */
    openTimePicker: string;
    /** The back button of a narrow `SplitView`, which returns from the detail to the master. */
    back: string;
    /** The divider between a `SplitView`'s master and detail. */
    resizeList: string;
    /** A rise, as a screen reader hears a `KpiChange`: "Up 12%". */
    changeUp: (change: string) => string;
    /** A fall, as a screen reader hears a `KpiChange`: "Down 12%". */
    changeDown: (change: string) => string;
    /** A figure that did not move, as a screen reader hears a `KpiChange`. */
    noChange: string;
    /** The figure a change is measured against, in a `KpiChange` tooltip: "Previous 30 days: $1,200". */
    previousPeriodValue: (days: number, value: string) => string;
    /** The window a `KpiGrid` names above its tiles: "Last 30 days". */
    lastDays: (days: number) => string;
    /** A chart with nothing to draw. */
    noData: string;
    /** The heading of the dates column in a `TimeSeriesChart`'s screen-reader table. */
    date: string;
    /**
     * The language the metric blocks write numbers and dates in, as a BCP 47
     * tag (`"de"`, `"pt-BR"`). The runtime's own when absent.
     */
    locale?: string;
    /** The phrases `formatRelativeTime` (`@rebasepro/utils`) takes as `labels`. */
    relativeTime: UiRelativeTimeLabels;
}

/** Relative-time phrases, as `formatRelativeTime`'s `labels` option takes them. */
export interface UiRelativeTimeLabels {
    justNow: string;
    inAMoment: string;
    minutesAgo: (count: number) => string;
    inMinutes: (count: number) => string;
    hoursAgo: (count: number) => string;
    inHours: (count: number) => string;
    daysAgo: (count: number) => string;
    inDays: (count: number) => string;
}

/** The English labels: exactly the strings the kit rendered before it took any. */
export const defaultUiLabels: UiLabels = {
    errorLoadingData: (message) => `Error loading data: ${message}`,
    noEntriesFound: "No entries found",
    allEntriesLoaded: (count) => `All ${count} entries loaded`,
    error: "Error",
    search: "Search",
    clearSearch: "Clear search",
    select: "Select",
    openTimePicker: "Open time picker",
    back: "Back",
    resizeList: "Resize the list",
    changeUp: (change) => `Up ${change}`,
    changeDown: (change) => `Down ${change}`,
    noChange: "No change",
    previousPeriodValue: (days, value) => (days === 1 ? `Previous day: ${value}` : `Previous ${days} days: ${value}`),
    lastDays: (days) => (days === 1 ? "Last day" : `Last ${days} days`),
    noData: "No data for this period",
    date: "Date",
    relativeTime: {
        justNow: "just now",
        inAMoment: "in a moment",
        minutesAgo: (count) => `${count}m ago`,
        inMinutes: (count) => `in ${count}m`,
        hoursAgo: (count) => `${count}h ago`,
        inHours: (count) => `in ${count}h`,
        daysAgo: (count) => `${count}d ago`,
        inDays: (count) => `in ${count}d`
    }
};

const UiLabelsContext = createContext<UiLabels>(defaultUiLabels);

export interface UiLabelsProviderProps {
    /** The labels to use; any left out keep their English default. */
    labels: Partial<Omit<UiLabels, "relativeTime">> & { relativeTime?: Partial<UiRelativeTimeLabels> };
    children: React.ReactNode;
}

/**
 * Gives the kit's own words in another language. `@rebasepro/app` mounts one
 * filled from its translations; without a provider the kit speaks English.
 *
 * @example
 * ```tsx
 * <UiLabelsProvider labels={{ noEntriesFound: "Nessun elemento" }}>
 *   <ListView …/>
 * </UiLabelsProvider>
 * ```
 */
export function UiLabelsProvider({ labels, children }: UiLabelsProviderProps) {
    const value = useMemo((): UiLabels => ({
        ...defaultUiLabels,
        ...labels,
        relativeTime: { ...defaultUiLabels.relativeTime, ...labels.relativeTime }
    }), [labels]);
    return <UiLabelsContext.Provider value={value}>{children}</UiLabelsContext.Provider>;
}

/** The labels in effect: the nearest {@link UiLabelsProvider}'s, or English. */
export function useUiLabels(): UiLabels {
    return useContext(UiLabelsContext);
}
