/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CollectionsProvider } from "@rebasepro/cms";
import type { AdminCollection } from "@rebasepro/cms-types";
import { db, InRebase } from "./recipe_harness";
import { OrdersDashboard } from "../../recipes/orders-dashboard";

const orders = {
    slug: "orders",
    name: "Orders",
    table: "orders",
    properties: {
        id: { type: "string", name: "Id", isId: "uuid" },
        status: { type: "string", name: "Status" }
    }
} as unknown as AdminCollection;

/** The chart's bars, top to bottom, as "<label>: <count>". Each bar is a button: its label (also its title), then its count. */
function bars(): string[] {
    return screen.queryAllByRole("button").flatMap(button => {
        const label = button.querySelector("[title]")?.getAttribute("title");
        return label === null || label === undefined ? [] : [`${label}: ${(button.textContent ?? "").slice(label.length)}`];
    });
}

function bar(label: string): HTMLElement {
    const found = screen.getAllByRole("button").find(button => button.querySelector("[title]")?.getAttribute("title") === label);
    if (!found) throw new Error(`No bar labelled ${label}`);
    return found;
}

function renderDashboard() {
    return render(<InRebase><CollectionsProvider collections={[orders]}><OrdersDashboard/></CollectionsProvider></InRebase>);
}

describe("recipe: orders dashboard", () => {
    beforeEach(() => {
        db.rows = {
            orders: [
                { id: "1", status: "paid" },
                { id: "2", status: "paid" },
                { id: "3", status: "shipped" },
                { id: "4", status: "paid" },
                { id: "5" }
            ]
        };
    });

    it("counts the rows, grouped and largest first", async () => {
        renderDashboard();

        await waitFor(() => expect(bars()).toHaveLength(3));
        expect(bars()[0]).toBe("paid: 3");
        expect(bars()).toContain("shipped: 1");
        expect(bars()).toContain("—: 1");
        expect(screen.getByText("5")).toBeTruthy();
    });

    it("links each group to the collection filtered to that group, without reloading the page", async () => {
        // Every bar linked to the unfiltered collection, and a plain anchor
        // reloaded the whole admin.
        renderDashboard();
        await waitFor(() => expect(bars()).toHaveLength(3));

        const page = screen.getByRole("heading", { name: "Orders" });
        fireEvent.click(bar("paid"));
        await waitFor(() => expect(window.location.search).toContain("status_value=paid"));
        // Through the router: the same page is still mounted.
        expect(page.isConnected).toBe(true);
        const url = new URL(window.location.href);
        expect(url.pathname).toContain("orders");
        expect(url.searchParams.get("status_op")).toBe("==");
        expect(url.searchParams.get("status_value")).toBe("paid");

        fireEvent.click(bar("—"));
        await waitFor(() => expect(new URL(window.location.href).searchParams.get("status_value")).toBe("null"));
    });

    it("counts every row, in the total and in the groups", async () => {
        // The total summed the first 5000 rows and called it "Total".
        db.rows = { orders: Array.from({ length: 5003 }, (_, i) => ({ id: String(i + 1), status: "paid" })) };
        renderDashboard();

        await waitFor(() => expect(bars()).toHaveLength(1));
        // The count is written in the runtime's locale: 5,003 / 5.003 / 5003.
        expect(bars()[0]).toMatch(/^paid: 5\D?003$/);
        expect(screen.getAllByText(/^5\D?003$/)).toHaveLength(2);
    });
});
