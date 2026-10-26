/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";
import { CollectionPanel } from "@rebasepro/cms";
import { db, InRebase } from "./recipe_harness";
import { calendarView } from "../../recipes/calendar-view";

jest.mock("react-use-measure", () => {
    const mod = jest.requireActual("react-use-measure") as { default?: (o?: unknown) => unknown };
    const actual = (typeof mod === "function" ? mod : mod.default) as (o?: unknown) => unknown;
    return (options?: { offsetSize?: boolean }) => {
        const real = actual(options) as [unknown, unknown];
        if (options?.offsetSize) return [real[0], { width: 1440, height: 900, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }];
        return real;
    };
});

const tasks = {
    slug: "tasks",
    name: "Tasks",
    singularName: "Task",
    table: "tasks",
    properties: {
        id: { type: "string", name: "Id", isId: "uuid" },
        title: { type: "string", name: "Title" },
        dueDate: { type: "date", name: "Due date", columnType: "date" }
    },
    admin: { customViews: ["calendar"], defaultViewMode: "calendar" }
} as unknown as AdminCollection;

const now = new Date();
// A `date` column's "YYYY-MM-DD" reaches the admin as that day's UTC midnight,
// which west of Greenwich is the day before in local time. Jest cannot change
// the zone it runs in, so east of Greenwich the day is pinned at its last UTC
// hour, already the next day in local time: either way the local day is wrong
// and only the UTC day is right. (In a UTC runner the two agree.)
const utcHour = now.getTimezoneOffset() > 0 ? 0 : 23;
const thisMonth = (day: number) => new Date(Date.UTC(now.getFullYear(), now.getMonth(), day, utcHour, 30));
const dayCell = (day: number) =>
    document.querySelector(`[data-day="${now.getFullYear()}-${now.getMonth()}-${day}"]`) as HTMLElement;

describe("recipe: calendar view", () => {
    beforeEach(() => {
        db.rows = {
            tasks: [
                { id: "a", title: "Ship 0.26", dueDate: thisMonth(10) },
                { id: "b", title: "Write the changelog", dueDate: thisMonth(10) },
                { id: "c", title: "Retro", dueDate: thisMonth(20) },
                { id: "d", title: "Someday", dueDate: null }
            ]
        };
    });

    function renderCalendar() {
        return render(<InRebase collectionViews={[calendarView]}><CollectionPanel collection={tasks}/></InRebase>);
    }

    it("puts each row on the day of its date, and skips rows without one", async () => {
        // A due date of the 10th showed on the 9th for anyone west of UTC.
        renderCalendar();
        await screen.findByText("Ship 0.26");

        expect(within(dayCell(10)).getByText("Ship 0.26")).toBeTruthy();
        expect(within(dayCell(10)).getByText("Write the changelog")).toBeTruthy();
        expect(within(dayCell(20)).getByText("Retro")).toBeTruthy();
        expect(screen.queryByText("Someday")).toBeNull();
    });

    it("puts a timestamp on its day in the property's declared timezone", async () => {
        // 03:00 UTC on the 11th is still the 10th in Los Angeles, which is
        // where the admin shows this property's dates.
        const zoned = { ...tasks, properties: { ...tasks.properties, dueDate: { type: "date", name: "Due date", timezone: "America/Los_Angeles" } } } as unknown as AdminCollection;
        db.rows = { tasks: [{ id: "f", title: "West coast launch", dueDate: new Date(Date.UTC(now.getFullYear(), now.getMonth(), 11, 3)) }] };
        render(<InRebase collectionViews={[calendarView]}><CollectionPanel collection={zoned}/></InRebase>);
        await screen.findByText("West coast launch");

        expect(within(dayCell(10)).getByText("West coast launch")).toBeTruthy();
    });

    it("puts a timestamp on its local day", async () => {
        // 23:30 on the 10th in New York is already the 11th in UTC.
        const timestamps = { ...tasks, properties: { ...tasks.properties, dueDate: { type: "date", name: "Due date" } } } as unknown as AdminCollection;
        db.rows = { tasks: [{ id: "e", title: "Late call", dueDate: new Date(now.getFullYear(), now.getMonth(), 10, 23, 30) }] };
        render(<InRebase collectionViews={[calendarView]}><CollectionPanel collection={timestamps}/></InRebase>);
        await screen.findByText("Late call");

        expect(within(dayCell(10)).getByText("Late call")).toBeTruthy();
    });

    it("opens a row's record when it is clicked", async () => {
        renderCalendar();
        fireEvent.click(await screen.findByText("Retro"));
        await waitFor(() => expect(screen.getByDisplayValue("Retro")).toBeTruthy());
    });

    it("moves between months", async () => {
        renderCalendar();
        await screen.findByText("Retro");
        fireEvent.click(screen.getByRole("button", { name: "Next month" }));
        expect(screen.queryByText("Retro")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
        expect(screen.getByText("Retro")).toBeTruthy();
    });
});
