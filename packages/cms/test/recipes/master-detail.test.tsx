/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";
import { CollectionsProvider } from "@rebasepro/cms";
import { db, InRebase } from "./recipe_harness";
import { CustomersMasterDetail } from "../../recipes/master-detail";

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

const customers: AdminCollection = {
    slug: "customers",
    name: "Customers",
    singularName: "Customer",
    table: "customers",
    properties: {
        id: { type: "string", name: "Id", isId: "uuid" },
        name: { type: "string", name: "Name" },
        email: { type: "string", name: "Email" },
        status: { type: "string", name: "Status" },
        notes: { type: "string", name: "Notes" },
        internalScore: { type: "number", name: "Internal score" }
    }
};

/** Every element measures `width` wide: what SplitView reads to choose its layout. */
function containerWidth(width: number) {
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        width, height: 800, top: 0, left: 0, bottom: 800, right: width, x: 0, y: 0, toJSON: () => ({})
    });
}

function renderPage() {
    return render(
        <InRebase>
            <CollectionsProvider collections={[customers]}><CustomersMasterDetail/></CollectionsProvider>
        </InRebase>
    );
}

/** Whether the list is on screen: covered, SplitView hides it rather than unmounting it. */
function listShown(): boolean {
    return screen.getByText("Grace Hopper").closest(".invisible") === null;
}

describe("recipe: master-detail", () => {
    beforeEach(() => {
        db.rows = {
            customers: [
                { id: "c1", name: "Ada Lovelace", email: "ada@example.com", status: "active", notes: "", internalScore: 9 },
                { id: "c2", name: "Grace Hopper", email: "grace@example.com", status: "trial", notes: "", internalScore: 7 }
            ]
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("lists only the list's fields", async () => {
        containerWidth(1200);
        renderPage();
        await screen.findByText("Ada Lovelace");
        expect(screen.getAllByText("trial").length).toBeGreaterThan(0);
        expect(screen.queryByText("ada@example.com")).toBeNull();
        expect(screen.queryByText("Internal score")).toBeNull();
    });

    it("opens the clicked row's form beside the list, with the form's fields", async () => {
        containerWidth(1200);
        renderPage();
        fireEvent.click(await screen.findByText("Grace Hopper"));

        expect(await screen.findByDisplayValue("grace@example.com")).toBeTruthy();
        expect(screen.getByDisplayValue("Grace Hopper")).toBeTruthy();
        expect(screen.queryByDisplayValue("7")).toBeNull();
        expect(screen.getByText("Ada Lovelace").closest(".invisible")).toBeNull();
        expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    });

    it("saves the form into the list", async () => {
        containerWidth(1200);
        renderPage();
        fireEvent.click(await screen.findByText("Grace Hopper"));

        const email = await screen.findByDisplayValue("grace@example.com");
        await act(async () => {
            fireEvent.change(screen.getByDisplayValue("trial"), { target: { value: "active" } });
            fireEvent.change(email, { target: { value: "hopper@example.com" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /save/i }));

        await waitFor(() => expect(db.rows.customers.find(c => c.id === "c2")).toMatchObject({ status: "active", email: "hopper@example.com", internalScore: 7 }));
        await waitFor(() => expect(screen.queryAllByText("trial")).toHaveLength(0));
    });

    it("drills down in a narrow container: the form covers the list, and Back returns to it", async () => {
        containerWidth(500);
        renderPage();
        fireEvent.click(await screen.findByText("Ada Lovelace"));

        expect(await screen.findByDisplayValue("ada@example.com")).toBeTruthy();
        expect(listShown()).toBe(false);

        fireEvent.click(screen.getByRole("button", { name: "Back" }));
        await waitFor(() => expect(screen.queryByDisplayValue("ada@example.com")).toBeNull());
        expect(listShown()).toBe(true);
    });
});
