"use client";
import React, { createContext, useContext, useMemo } from "react";

/**
 * The words the kit itself puts on screen: the list and card views' notices,
 * the table's error title, the search bar's names, and the relative-time
 * phrases of `formatRelativeTime` (`@rebasepro/utils`).
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
