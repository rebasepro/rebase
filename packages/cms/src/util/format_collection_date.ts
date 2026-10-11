import type { Property } from "@rebasepro/types";
import { formatRelativeTime } from "@rebasepro/utils";
import { getDatePropertyMode, getDatePropertyTimezone } from "../preview/util";

export type FormatCollectionDateOptions = {
    /** The instant relative phrases are measured from. Defaults to now. */
    now?: Date;
    /** BCP 47 locale. Defaults to the browser's. */
    locale?: string;
};

function yearIn(date: Date, timeZone: string | undefined): string {
    return new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }).format(date);
}

/**
 * The short date a collection's list, card and board views show: the date
 * slot, and the list view's date columns.
 *
 * It reads the property the way the table cell, the filter and the form do
 * (`getDatePropertyMode` / `getDatePropertyTimezone`):
 * - a `columnType: "date"` value is a calendar day stored as its UTC midnight,
 *   so it is shown as that day in UTC, with no time and no relative phrase —
 *   in the browser's zone a stored 15th read as the 14th west of Greenwich;
 * - a `columnType: "time"` value is a time of day, shown in UTC;
 * - any other date reads "3h ago" / "in 2d" within a week, else a short date
 *   in the property's declared `timezone` (the browser's when none).
 *
 * A slot can also hold a non-date property or a computed value; with no date
 * property the browser's zone is used.
 *
 * Returns `null` for an empty or unreadable value.
 */
export function formatCollectionDate(
    value: unknown,
    property: Property | undefined,
    options: FormatCollectionDateOptions = {}
): string | null {
    if (value === undefined || value === null || value === "") return null;
    let date: Date | null = null;
    if (value instanceof Date) date = value;
    else if (typeof value === "string" || typeof value === "number") date = new Date(value);
    if (!date || isNaN(date.getTime())) return null;

    const now = options.now ?? new Date();
    const dateProperty = property?.type === "date" ? property : undefined;
    const timeZone = dateProperty ? getDatePropertyTimezone(dateProperty) : undefined;

    if (dateProperty?.columnType === "time") {
        return new Intl.DateTimeFormat(options.locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(date);
    }

    const dayOnly = dateProperty !== undefined && getDatePropertyMode(dateProperty) === "date";
    if (!dayOnly) {
        // A date slot holds whatever the collection points it at, as often a
        // due or publish date as an `updated_at`; `formatRelativeTime` reads
        // the sign, so a scheduled date says "in 3d".
        const relative = formatRelativeTime(date, { now });
        if (relative) return relative;
    }

    // Comparing years rather than counting days: a date six weeks back across a
    // new year needs the year, and one 400 days ahead needs it just as much.
    const sameYear = yearIn(date, timeZone) === yearIn(now, timeZone);
    return new Intl.DateTimeFormat(options.locale, {
        month: "short",
        day: "numeric",
        year: sameYear ? undefined : "numeric",
        timeZone
    }).format(date);
}
