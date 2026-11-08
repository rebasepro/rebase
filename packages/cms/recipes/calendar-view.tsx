/**
 * Recipe: a calendar view mode — a collection's rows on a month grid.
 *
 * A custom view mode sits in the collection's view switcher next to table,
 * cards and board. Its `Builder` is handed the live `tableController`, so the
 * toolbar's search and filters drive it, and `onRowClick`, which opens a row
 * the way the collection opens rows. The rows are the server's: a date is an
 * ISO string, `YYYY-MM-DD` for a date-only column. All this file decides is
 * the layout.
 *
 * To use it:
 *   1. Register it: `<RebaseCMS collectionViews={[calendarView]}>`
 *      (or `<Rebase collectionViews>`).
 *   2. Turn it on for a collection: `admin: { customViews: ["calendar"] }`,
 *      and `defaultViewMode: "calendar"` to open on it.
 * Change `DATE_FIELD` / `TITLE_FIELD` to your collection's keys.
 */
import React, { useMemo, useState } from "react";
import type { CollectionCustomView, CollectionCustomViewParams } from "@rebasepro/cms-types";
import { Button, Typography } from "@rebasepro/ui";
import { getDatePropertyTimezone } from "@rebasepro/cms";

const DATE_FIELD = "dueDate";
const TITLE_FIELD = "title";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * The day a stored date falls on, in the zone the admin shows it in: the day
 * itself for a `columnType: "date"` column, which arrives as `YYYY-MM-DD`;
 * for a timestamp, its day in the property's `timezone` when it declares
 * one, else the browser's.
 */
function storedDayKey(raw: string, timeZone: string | undefined): string | undefined {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (day) return `${Number(day[1])}-${Number(day[2]) - 1}-${Number(day[3])}`;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return undefined;
    if (!timeZone) return dayKey(date);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" })
        .formatToParts(date);
    const part = (type: string) => Number(parts.find(p => p.type === type)?.value);
    return `${part("year")}-${part("month") - 1}-${part("day")}`;
}

/** The days shown for a month: whole weeks, Monday first. */
function monthGrid(month: Date): Date[] {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const days: Date[] = [];
    for (let d = new Date(start); days.length < 42; d.setDate(d.getDate() + 1)) {
        days.push(new Date(d));
    }
    return days;
}

export function CalendarView({ collection, tableController, onRowClick }: CollectionCustomViewParams) {
    const [month, setMonth] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });

    const dateProperty = collection.properties[DATE_FIELD];
    const timeZone = dateProperty?.type === "date" ? getDatePropertyTimezone(dateProperty) : undefined;

    // Each row with its id, which `tableController.ids` holds at the row's position.
    const byDay = useMemo(() => {
        const map = new Map<string, { row: Record<string, unknown>; id: string }[]>();
        tableController.rows.forEach((row, i) => {
            const raw = row[DATE_FIELD];
            if (typeof raw !== "string") return;
            const key = storedDayKey(raw, timeZone);
            if (key === undefined) return;
            map.set(key, [...(map.get(key) ?? []), { row, id: tableController.ids[i] }]);
        });
        return map;
    }, [tableController.rows, tableController.ids, timeZone]);

    const shift = (months: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + months, 1));

    return (
        <div className={"flex flex-col gap-2 p-4 h-full overflow-auto"}>
            <div className={"flex items-center gap-2"}>
                <Button size={"small"} variant={"text"} onClick={() => shift(-1)} aria-label={"Previous month"}>‹</Button>
                <Typography variant={"subtitle1"} className={"min-w-40 text-center"}>
                    {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                </Typography>
                <Button size={"small"} variant={"text"} onClick={() => shift(1)} aria-label={"Next month"}>›</Button>
            </div>
            <div className={"grid grid-cols-7 gap-px rounded-lg overflow-hidden border border-hairline bg-hairline"}>
                {WEEKDAYS.map(day => (
                    <Typography key={day} variant={"caption"} color={"secondary"}
                        className={"bg-surface-raised px-2 py-1"}>{day}</Typography>
                ))}
                {monthGrid(month).map(day => (
                    <div key={dayKey(day)}
                        data-day={dayKey(day)}
                        className={"min-h-24 bg-surface-card p-1 flex flex-col gap-1"
                            + (day.getMonth() === month.getMonth() ? "" : " opacity-40")}>
                        <Typography variant={"caption"} color={"secondary"}>{day.getDate()}</Typography>
                        {(byDay.get(dayKey(day)) ?? []).map(({ row, id }) => (
                            <Button key={id}
                                variant={"text"}
                                size={"smallest"}
                                fullWidth
                                onClick={() => onRowClick?.(row)}
                                className={"justify-start min-w-0"}>
                                <span className={"truncate"}>{String(row[TITLE_FIELD] ?? id)}</span>
                            </Button>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

export const calendarView: CollectionCustomView = {
    key: "calendar",
    name: "Calendar",
    icon: "Calendar",
    Builder: CalendarView
};
