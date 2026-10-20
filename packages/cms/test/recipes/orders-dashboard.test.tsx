/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
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

    it("links each group to the collection", async () => {
        render(<InRebase><CollectionsProvider collections={[orders]}><OrdersDashboard/></CollectionsProvider></InRebase>);
        const link = await screen.findByLabelText("paid: 3");
        expect(link.getAttribute("href")).toContain("orders");
    });
});
