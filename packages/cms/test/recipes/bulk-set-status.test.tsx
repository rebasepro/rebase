/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";
import { CollectionPanel } from "@rebasepro/cms";
import { db, InRebase } from "./recipe_harness";
import { ArchiveSelectedAction } from "../../recipes/bulk-set-status";

// jsdom measures nothing: give the table a laptop-sized viewport.
jest.mock("react-use-measure", () => {
    const mod = jest.requireActual("react-use-measure") as { default?: (o?: unknown) => unknown };
    const actual = (typeof mod === "function" ? mod : mod.default) as (o?: unknown) => unknown;
    return (options?: { offsetSize?: boolean }) => {
        const real = actual(options) as [unknown, unknown];
        if (options?.offsetSize) return [real[0], { width: 1440, height: 900, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }];
        return real;
    };
});

const tickets = {
    slug: "tickets",
    name: "Tickets",
    table: "tickets",
    properties: {
        id: { type: "string", name: "Id", isId: "uuid" },
        subject: { type: "string", name: "Subject" },
        status: { type: "string", name: "Status" }
    },
    // Where the recipe says to put it: the collection's `admin` block.
    admin: { Actions: [ArchiveSelectedAction] }
} as unknown as AdminCollection;

describe("recipe: bulk set status", () => {
    beforeEach(() => {
        db.rows = {
            tickets: [
                { id: "t1", subject: "Printer on fire", status: "open" },
                { id: "t2", subject: "VPN down", status: "open" },
                { id: "t3", subject: "New laptop", status: "open" }
            ]
        };
    });

    it("is not in the toolbar until rows are selected", async () => {
        render(<InRebase><CollectionPanel collection={tickets} viewMode={"table"}/></InRebase>);
        await screen.findByText("Printer on fire");
        expect(screen.queryByRole("button", { name: "Archive selected" })).toBeNull();
    });

    it("archives the selected rows and leaves the rest", async () => {
        render(<InRebase><CollectionPanel collection={tickets} viewMode={"table"}/></InRebase>);
        await screen.findByText("Printer on fire");

        const rowCheckboxes = screen.getAllByRole("checkbox").slice(-3);
        await act(async () => {
            fireEvent.click(rowCheckboxes[0]);
            fireEvent.click(rowCheckboxes[1]);
        });
        fireEvent.click(await screen.findByRole("button", { name: "Archive selected" }));

        await waitFor(() => expect(db.rows.tickets.map(t => [t.id, t.status]).sort()).toEqual([
            ["t1", "archived"], ["t2", "archived"], ["t3", "open"]
        ]));
        await waitFor(() => expect(screen.queryByRole("button", { name: "Archive selected" })).toBeNull());
    });
});
