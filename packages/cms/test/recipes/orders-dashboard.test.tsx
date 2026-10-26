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
        render(<InRebase><CollectionsProvider collections={[orders]}><OrdersDashboard/></CollectionsProvider></InRebase>);

        expect(await screen.findByLabelText("paid: 3")).toBeTruthy();
        expect(screen.getByLabelText("shipped: 1")).toBeTruthy();
        expect(screen.getByLabelText("—: 1")).toBeTruthy();
        expect(screen.getByText("5")).toBeTruthy();

        const order = screen.getAllByRole("link").map(a => a.getAttribute("aria-label"));
        expect(order[0]).toBe("paid: 3");
    });

    it("links each group to the collection filtered to that group, without reloading the page", async () => {
        // Every bar linked to the unfiltered collection, and a plain anchor
        // reloaded the whole admin.
        render(<InRebase><CollectionsProvider collections={[orders]}><OrdersDashboard/></CollectionsProvider></InRebase>);
        const link = await screen.findByLabelText("paid: 3");
        const href = new URL(link.getAttribute("href") ?? "", window.location.origin);
        expect(href.pathname).toContain("orders");
        expect(href.searchParams.get("status_op")).toBe("==");
        expect(href.searchParams.get("status_value")).toBe("paid");
        expect(new URL(screen.getByLabelText("—: 1").getAttribute("href") ?? "", window.location.origin).searchParams.get("status_value")).toBe("null");

        const notPrevented = fireEvent.click(link);
        expect(notPrevented).toBe(false);
        await waitFor(() => expect(window.location.search).toContain("status_value=paid"));
    });

    it("counts every row in the total, past the rows it groups", async () => {
        // The total summed the first 5000 rows and called it "Total".
        db.rows = { orders: Array.from({ length: 5003 }, (_, i) => ({ id: String(i + 1), status: "paid" })) };
        render(<InRebase><CollectionsProvider collections={[orders]}><OrdersDashboard/></CollectionsProvider></InRebase>);

        expect(await screen.findByText("5003")).toBeTruthy();
        expect(screen.getByText("Grouped over the first 5000 of 5003 orders")).toBeTruthy();
    });
});
