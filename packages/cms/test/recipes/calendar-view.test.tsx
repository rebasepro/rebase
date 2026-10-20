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
        dueDate: { type: "date", name: "Due date" }
    },
    admin: { customViews: ["calendar"], defaultViewMode: "calendar" }
} as unknown as AdminCollection;

const now = new Date();
const thisMonth = (day: number) => new Date(now.getFullYear(), now.getMonth(), day, 12);

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
        renderCalendar();
        await screen.findByText("Ship 0.26");

        const tenth = document.querySelector(`[data-day="${now.getFullYear()}-${now.getMonth()}-10"]`) as HTMLElement;
        expect(within(tenth).getByText("Ship 0.26")).toBeTruthy();
        expect(within(tenth).getByText("Write the changelog")).toBeTruthy();
        const twentieth = document.querySelector(`[data-day="${now.getFullYear()}-${now.getMonth()}-20"]`) as HTMLElement;
        expect(within(twentieth).getByText("Retro")).toBeTruthy();
        expect(screen.queryByText("Someday")).toBeNull();
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
