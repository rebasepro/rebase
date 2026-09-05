import React, { useState, useMemo, useCallback } from "react";
import {
    Typography,
    cls,
    Chip,
    Skeleton,
    IconButton,
    Separator,
    Button,
    ChevronLeftIcon,
    ChevronRightIcon
} from "@rebasepro/ui";

/* ── Types ─────────────────────────────────────────────── */

interface TaskEntity {
    id: string;
    values: {
        title: string;
        status: string;
        dueDate: string | null;
        stageId: string | null;
        priority?: string | null;
        clientId: string | null;
        client?: { name?: string } | null;
    };
}

export interface CalendarWidgetProps {
    loading: boolean;
    tasks: TaskEntity[];
    onOpenTask: (taskId: string) => void;
}

/* ── Date helpers ──────────────────────────────────────── */

function startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function isSameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

function toDateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isBeforeToday(date: Date): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d < today;
}

/* ── Stage label map ───────────────────────────────────── */

const stageLabels: Record<string, string> = {
    incoming: "Incoming",
    email_sent: "Intro Email",
    discovery_call: "Discovery",
    agreements: "Agreements",
    onboarding: "Onboarding",
    active: "Active",
    delivered: "Delivered",
    completed: "Done"
};

/* ── Calendar grid builder ─────────────────────────────── */

interface CalendarDay {
    date: Date;
    isCurrentMonth: boolean;
    isToday: boolean;
    dateKey: string;
}

function buildCalendarGrid(viewDate: Date): CalendarDay[] {
    const today = new Date();
    const first = startOfMonth(viewDate);
    const last = endOfMonth(viewDate);

    // Monday = 0 ... Sunday = 6
    let startDay = first.getDay() - 1;
    if (startDay < 0) startDay = 6;

    const days: CalendarDay[] = [];

    // Fill leading days from previous month
    for (let i = startDay - 1; i >= 0; i--) {
        const d = new Date(first);
        d.setDate(d.getDate() - (i + 1));
        days.push({
            date: d,
            isCurrentMonth: false,
            isToday: isSameDay(d, today),
            dateKey: toDateKey(d)
        });
    }

    // Current month days
    for (let d = 1; d <= last.getDate(); d++) {
        const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
        days.push({
            date,
            isCurrentMonth: true,
            isToday: isSameDay(date, today),
            dateKey: toDateKey(date)
        });
    }

    // Fill trailing days to complete the last week
    while (days.length % 7 !== 0) {
        const d = new Date(last);
        d.setDate(d.getDate() + (days.length - (startDay + last.getDate())) + 1);
        days.push({
            date: d,
            isCurrentMonth: false,
            isToday: isSameDay(d, today),
            dateKey: toDateKey(d)
        });
    }

    return days;
}

/* ── Component ─────────────────────────────────────────── */

const DAY_HEADERS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

export function CalendarWidget({ loading, tasks, onOpenTask }: CalendarWidgetProps) {
    const [viewDate, setViewDate] = useState(() => new Date());
    const [selectedDay, setSelectedDay] = useState<string | null>(null);

    /* ── Group tasks by date key ── */
    const tasksByDate = useMemo(() => {
        const map = new Map<string, TaskEntity[]>();
        for (const task of tasks) {
            if (!task.values?.dueDate) continue;
            const d = new Date(task.values.dueDate);
            const key = toDateKey(d);
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(task);
        }
        return map;
    }, [tasks]);

    /* ── Calendar grid ── */
    const calendarDays = useMemo(() => buildCalendarGrid(viewDate), [viewDate]);

    /* ── Month navigation ── */
    const goToPrevMonth = useCallback(() => {
        setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
        setSelectedDay(null);
    }, []);

    const goToNextMonth = useCallback(() => {
        setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
        setSelectedDay(null);
    }, []);

    const goToToday = useCallback(() => {
        const today = new Date();
        setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
        setSelectedDay(toDateKey(today));
    }, []);

    /* ── Selected day tasks ── */
    const selectedDayTasks = useMemo(() => {
        if (!selectedDay) return [];
        return tasksByDate.get(selectedDay) || [];
    }, [selectedDay, tasksByDate]);

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <Typography variant="subtitle1">Calendar</Typography>
                <Button
                    variant="text"
                    size="small"
                    color="primary"
                    className="p-0 h-auto min-w-0"
                    onClick={goToToday}
                >
                    Today
                </Button>
            </div>

            {/* Month nav */}
            <div className="flex items-center justify-between mb-2">
                <IconButton
                    size="smallest"
                    aria-label="Previous month"
                    onClick={goToPrevMonth}
                >
                    <ChevronLeftIcon className="h-4 w-4" />
                </IconButton>
                <Typography variant="body2" className="font-semibold">
                    {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
                </Typography>
                <IconButton
                    size="smallest"
                    aria-label="Next month"
                    onClick={goToNextMonth}
                >
                    <ChevronRightIcon className="h-4 w-4" />
                </IconButton>
            </div>

            {loading ? (
                <Skeleton className="h-48 w-full rounded-lg" />
            ) : (
                <>
                    {/* Day headers */}
                    <div className="grid grid-cols-7 mb-1">
                        {DAY_HEADERS.map(d => (
                            <div key={d} className="text-center py-1">
                                <Typography variant="caption" color="secondary" className="text-[10px] font-semibold uppercase tracking-wider">
                                    {d}
                                </Typography>
                            </div>
                        ))}
                    </div>

                    {/* Calendar grid */}
                    <div className="grid grid-cols-7 gap-0.5">
                        {calendarDays.map((day) => {
                            const dayTasks = tasksByDate.get(day.dateKey) || [];
                            const hasTasks = dayTasks.length > 0;
                            const isSelected = selectedDay === day.dateKey;

                            // Count tasks by status
                            const pendingCount = dayTasks.filter(t => t.values.status === "pending").length;
                            const completedCount = dayTasks.filter(t => t.values.status === "completed").length;
                            const hasOverdue = dayTasks.some(
                                t => t.values.status === "pending" && isBeforeToday(new Date(t.values.dueDate!))
                            );

                            return (
                                <button
                                    key={day.dateKey}
                                    onClick={() => setSelectedDay(isSelected ? null : day.dateKey)}
                                    className={cls(
                                        "flex flex-col items-center justify-center py-1.5 rounded-md transition-colors duration-100 focus:outline-none",
                                        day.isCurrentMonth
                                            ? "text-text-primary dark:text-text-primary-dark"
                                            : "text-surface-300 dark:text-surface-650",
                                        day.isToday && !isSelected && "ring-1 ring-primary/50",
                                        isSelected
                                            ? "bg-primary/10 dark:bg-primary/15 ring-1 ring-primary/60"
                                            : "hover:bg-surface-100 dark:hover:bg-surface-800",
                                        hasTasks && "cursor-pointer"
                                    )}
                                >
                                    <Typography
                                        variant="caption"
                                        color="inherit"
                                        className={cls(
                                            "leading-none tabular-nums text-[11px]",
                                            day.isToday && "font-semibold text-primary dark:text-primary-light"
                                        )}
                                    >
                                        {day.date.getDate()}
                                    </Typography>

                                    {/* Task dots */}
                                    {hasTasks ? (
                                        <div className="flex items-center gap-0.5 mt-1 h-[5px]">
                                            {hasOverdue && (
                                                <span className="w-[5px] h-[5px] rounded-full bg-red-500" />
                                            )}
                                            {pendingCount > 0 && !hasOverdue && (
                                                <span className="w-[5px] h-[5px] rounded-full bg-primary" />
                                            )}
                                            {completedCount > 0 && (
                                                <span className="w-[5px] h-[5px] rounded-full bg-emerald-500" />
                                            )}
                                        </div>
                                    ) : (
                                        <div className="h-[5px] mt-1" />
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Dot legend */}
                    <div className="flex items-center gap-3 mt-3 mb-1 px-1">
                        <div className="flex items-center gap-1">
                            <span className="w-[5px] h-[5px] rounded-full bg-primary" />
                            <Typography variant="caption" color="secondary" className="text-[10px]">Pending</Typography>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="w-[5px] h-[5px] rounded-full bg-red-500" />
                            <Typography variant="caption" color="secondary" className="text-[10px]">Overdue</Typography>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="w-[5px] h-[5px] rounded-full bg-emerald-500" />
                            <Typography variant="caption" color="secondary" className="text-[10px]">Done</Typography>
                        </div>
                    </div>

                    {/* Selected day task list */}
                    {selectedDay && (
                        <div className="mt-2">
                            <Separator orientation="horizontal" className="mb-2" />
                            {selectedDayTasks.length === 0 ? (
                                <div className="py-3 text-center">
                                    <Typography variant="caption" color="secondary">
                                        No tasks on this day
                                    </Typography>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-0.5">
                                    <Typography variant="caption" color="secondary" className="mb-1 px-1">
                                        {selectedDayTasks.length} task{selectedDayTasks.length !== 1 ? "s" : ""} — {new Date(selectedDay + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                    </Typography>
                                    {selectedDayTasks.map((task) => {
                                        const isPending = task.values.status === "pending";
                                        const isOverdue = isPending && isBeforeToday(new Date(task.values.dueDate!));
                                        return (
                                            <button
                                                key={task.id}
                                                onClick={() => onOpenTask(task.id)}
                                                className={cls(
                                                    "flex items-start gap-2 px-2 py-1.5 rounded-md text-left w-full",
                                                    "hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors duration-100 focus:outline-none"
                                                )}
                                            >
                                                {/* Status dot */}
                                                <span
                                                    className={cls(
                                                        "w-1.5 h-1.5 rounded-full mt-1.5 shrink-0",
                                                        isOverdue
                                                            ? "bg-red-500"
                                                            : isPending
                                                                ? "bg-primary"
                                                                : "bg-emerald-500"
                                                    )}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <Typography variant="body2" className="truncate leading-snug">
                                                        {task.values.title}
                                                    </Typography>
                                                    <div className="flex items-center gap-2">
                                                        {task.values.client?.name && (
                                                            <Typography variant="caption" color="secondary" className="truncate text-[10px]">
                                                                {task.values.client.name}
                                                            </Typography>
                                                        )}
                                                        {task.values.stageId && (
                                                            <Typography variant="caption" color="disabled" className="truncate text-[10px]">
                                                                {stageLabels[task.values.stageId] || task.values.stageId}
                                                            </Typography>
                                                        )}
                                                    </div>
                                                </div>
                                                {task.values.priority === "high" && (
                                                    <Chip colorScheme="red" size="smallest">High</Chip>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
