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

/** The rows' subjects in the order the table draws them: the order of their checkboxes. */
function selectionOrder(): string[] {
    return ["Printer on fire", "VPN down", "New laptop"]
        .map(subject => ({ subject, node: screen.getByText(subject) }))
        .sort((a, b) => a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
        .map(({ subject }) => subject);
}

/** Whether each row's checkbox is ticked, by the row's subject. */
function selectionBySubject(): Record<string, string> {
    const subjects = selectionOrder();
    const checkboxes = screen.getAllByRole("checkbox").slice(-3);
    return Object.fromEntries(subjects.map((subject, i) =>
        [subject, checkboxes[i].getAttribute("aria-checked") ?? String((checkboxes[i] as HTMLInputElement).checked)]));
}

describe("recipe: bulk set status", () => {
    beforeEach(() => {
        db.failSaveOf = undefined;
        db.keys = undefined;
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

    it("archives the rows of a collection keyed by a column other than id", async () => {
        // The row is exactly its columns, so it has no `id` here: the recipe
        // writes with the id handed beside it.
        db.keys = { products: "sku" };
        db.rows = {
            products: [
                { sku: "p-1", subject: "Printer on fire", status: "open" },
                { sku: "p-2", subject: "VPN down", status: "open" },
                { sku: "p-3", subject: "New laptop", status: "open" }
            ]
        };
        const products = {
            ...tickets,
            slug: "products",
            name: "Products",
            table: "products",
            properties: {
                sku: { type: "string", name: "SKU", isId: true },
                subject: { type: "string", name: "Subject" },
                status: { type: "string", name: "Status" }
            }
        } as unknown as AdminCollection;
        render(<InRebase><CollectionPanel collection={products} viewMode={"table"}/></InRebase>);
        await screen.findByText("Printer on fire");

        await act(async () => {
            fireEvent.click(screen.getAllByRole("checkbox").slice(-3)[selectionOrder().indexOf("VPN down")]);
        });
        fireEvent.click(await screen.findByRole("button", { name: "Archive selected" }));

        await waitFor(() => expect(db.rows.products.map(p => [p.sku, p.status]).sort()).toEqual([
            ["p-1", "open"], ["p-2", "archived"], ["p-3", "open"]
        ]));
        expect(db.rows.products).toHaveLength(3);
    });

    it("saves each row as the record form does, through the collection's browser callbacks", async () => {
        const withCallbacks = {
            ...tickets,
            browserCallbacks: {
                beforeSave: ({ values }: { values: Record<string, unknown> }) => ({ ...values, archivedBy: "ada" })
            }
        } as unknown as AdminCollection;
        render(<InRebase><CollectionPanel collection={withCallbacks} viewMode={"table"}/></InRebase>);
        await screen.findByText("Printer on fire");

        await act(async () => {
            fireEvent.click(screen.getAllByRole("checkbox").slice(-3)[0]);
        });
        fireEvent.click(await screen.findByRole("button", { name: "Archive selected" }));

        await waitFor(() => expect(db.rows.tickets.find(t => t.status === "archived")).toMatchObject({ archivedBy: "ada" }));
        expect(db.rows.tickets.filter(t => t.status === "archived")).toHaveLength(1);
    });

    it("says how many rows it archived when one fails, and keeps the rest selected", async () => {
        // Rows before the failure were already archived, but the toast showed
        // only the error and the selection still held every row.
        db.failSaveOf = "t2";
        render(<InRebase><CollectionPanel collection={tickets} viewMode={"table"}/></InRebase>);
        await screen.findByText("Printer on fire");

        const rowCheckboxes = screen.getAllByRole("checkbox").slice(-3);
        await act(async () => {
            rowCheckboxes.forEach(checkbox => fireEvent.click(checkbox));
        });
        fireEvent.click(await screen.findByRole("button", { name: "Archive selected" }));

        expect(await screen.findByText(/Archived 1 of 3 rows.*Saving t2 was refused/)).toBeTruthy();
        expect(db.rows.tickets.find(t => t.id === "t1")?.status).toBe("archived");
        // The rows still to archive stay selected, ready for another try —
        // whatever order the table reads them back in after the save.
        await waitFor(() => expect(selectionBySubject()).toEqual({
            "Printer on fire": "false",
            "VPN down": "true",
            "New laptop": "true"
        }));
    });
});
