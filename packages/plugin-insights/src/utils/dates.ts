import { X } from "lucide-react";
export type DatePreset = "last_7_days" | "last_30_days" | "last_90_days" | "last_12_months" | "year_to_date" | "previous_year";

export interface DateRangePreference {
    preset?: DatePreset;
    from?: string; // ISO string for custom date
    to?: string;   // ISO string for custom date
    includeToday: boolean;
}

const STORAGE_KEY_PREFIX = "dataki_date_range_";

export function saveDateRangePreference(dashboardId: string, pref: DateRangePreference): void {
    try {
        localStorage.setItem(STORAGE_KEY_PREFIX + dashboardId, JSON.stringify(pref));
    } catch (e) {
        // localStorage might be full or unavailable
    }
}

export function loadDateRangePreference(dashboardId: string): DateRangePreference | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_PREFIX + dashboardId);
        if (!raw) return null;
        return JSON.parse(raw) as DateRangePreference;
    } catch (e) {
        return null;
    }
}

function todayAtMidnight(): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

function endOfToday(): Date {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return today;
}

function getEndDate(includeToday: boolean): Date {
    return includeToday ? endOfToday() : todayAtMidnight();
}

export function getDateRangeFromPreset(preset: DatePreset, includeToday: boolean): [Date, Date] {
    const end = getEndDate(includeToday);
    switch (preset) {
        case "last_7_days": {
            const start = todayAtMidnight();
            start.setDate(start.getDate() - 7);
            return [start, end];
        }
        case "last_30_days": {
            const start = todayAtMidnight();
            start.setDate(start.getDate() - 30);
            return [start, end];
        }
        case "last_90_days": {
            const start = todayAtMidnight();
            start.setDate(start.getDate() - 90);
            return [start, end];
        }
        case "last_12_months": {
            const start = todayAtMidnight();
            start.setFullYear(start.getFullYear() - 1);
            return [start, end];
        }
        case "year_to_date": {
            const start = todayAtMidnight();
            start.setMonth(0);
            start.setDate(1);
            return [start, end];
        }
        case "previous_year": {
            const start = todayAtMidnight();
            start.setMonth(0);
            start.setDate(1);
            start.setFullYear(start.getFullYear() - 1);
            const endPrev = new Date(start.getFullYear(), 11, 31, 23, 59, 59, 999);
            return [start, endPrev];
        }
    }
}

export function getInitialDateRange(): [Date | null, Date | null] {
    const date = new Date();
    date.setMonth(date.getMonth() - 3);
    return [date, new Date()];
}
