/**
 * Recipe: a calendar view mode — a collection's rows on a month grid.
 *
 * A custom view mode sits in the collection's view switcher next to table,
 * cards and board. Its `Builder` is handed the live `tableController`, so the
 * toolbar's search and filters drive it, and `onEntityClick`, which opens a
 * row the way the collection opens rows. All this file decides is the layout.
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
import type { Entity } from "@rebasepro/types";
import { Button, Typography } from "@rebasepro/ui";

const DATE_FIELD = "dueDate";
const TITLE_FIELD = "title";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
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

export function CalendarView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    const [month, setMonth] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });

    const byDay = useMemo(() => {
        const map = new Map<string, Entity[]>();
        for (const entity of tableController.data ?? []) {
            const raw = entity.values[DATE_FIELD];
            if (raw === null || raw === undefined) continue;
            const date = raw instanceof Date ? raw : new Date(String(raw));
            if (Number.isNaN(date.getTime())) continue;
            const key = dayKey(date);
            map.set(key, [...(map.get(key) ?? []), entity]);
        }
        return map;
    }, [tableController.data]);

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
            <div className={"grid grid-cols-7 gap-px rounded-lg overflow-hidden border border-surface-200 dark:border-surface-700 bg-surface-200 dark:bg-surface-700"}>
                {WEEKDAYS.map(day => (
                    <Typography key={day} variant={"caption"} color={"secondary"}
                        className={"bg-surface-50 dark:bg-surface-900 px-2 py-1"}>{day}</Typography>
                ))}
                {monthGrid(month).map(day => (
                    <div key={dayKey(day)}
                        data-day={dayKey(day)}
                        className={"min-h-24 bg-white dark:bg-surface-950 p-1 flex flex-col gap-1"
                            + (day.getMonth() === month.getMonth() ? "" : " opacity-40")}>
                        <Typography variant={"caption"} color={"secondary"}>{day.getDate()}</Typography>
                        {(byDay.get(dayKey(day)) ?? []).map(entity => (
                            <button key={String(entity.id)}
                                type={"button"}
                                onClick={() => onEntityClick?.(entity)}
                                className={"truncate text-left text-xs rounded px-1 py-0.5 bg-primary/10 text-primary hover:bg-primary/20"}>
                                {String(entity.values[TITLE_FIELD] ?? entity.id)}
                            </button>
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
