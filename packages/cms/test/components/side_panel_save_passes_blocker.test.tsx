/**
 * @jest-environment jsdom
 *
 * A save that moves the side panel is not stopped by its own unsaved-changes
 * guard.
 *
 * "Create" on a new record replaces the panel with the saved record's address
 * (`…/orders#new_side` → `…/orders/<id>`), a pathname change, which is what the
 * panel's guard blocks while the form is dirty. The save clears the flag first
 * — `afterSave` reports the form clean, and `SidePanelBinding.onUpdate` then
 * navigates — but both run in the same tick. With the flag held as state, the
 * guard still read it as set, and asked "There are unsaved changes" about a
 * record that was already on the server, leaving the URL on `#new_side`.
 */

import React from "react";
import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { NavigationBlockerProvider } from "@rebasepro/app";
import { SideDialogs, useSideDialogContext, type SideDialogController } from "../../src/components/SideDialogs";
import { useBuildSideDialogsController } from "../../src/hooks/useBuildSideDialogsController";
import { SideDialogsControllerContext } from "../../src/contexts/SideDialogsControllerContext";
import type { SideDialogsController } from "../../src/hooks/useSideDialogsController";

// jsdom has no fetch primitives; the data router builds a Request per navigation.
if (typeof globalThis.Request === "undefined") {
    Object.defineProperty(globalThis, "Request", {
        configurable: true,
        value: class {
            url: string;
            method: string;
            signal: unknown;
            constructor(url: string, init: { method?: string, signal?: unknown } = {}) {
                this.url = String(url);
                this.method = init.method ?? "GET";
                this.signal = init.signal;
            }
        }
    });
}

let controller: SideDialogsController;
let panelContext: SideDialogController;

/** The form inside the panel, reduced to what it tells the panel. */
function PanelForm() {
    panelContext = useSideDialogContext();
    return <div/>;
}

const panel = (key: string, urlPath: string) => ({
    key,
    component: <PanelForm/>,
    urlPath,
    parentUrlPath: "/c/orders"
});

function Harness() {
    controller = useBuildSideDialogsController();
    const location = useLocation();
    return <SideDialogsControllerContext.Provider value={controller}>
        <div data-testid="here">{location.pathname + location.hash}</div>
        <SideDialogs/>
    </SideDialogsControllerContext.Provider>;
}

function setup() {
    const router = createMemoryRouter(
        [{
            path: "*",
            element: <NavigationBlockerProvider><Harness/></NavigationBlockerProvider>
        }],
        { initialEntries: ["/c/orders"] }
    );
    render(<RouterProvider router={router}/>);
    return () => screen.getByTestId("here").textContent;
}

const settle = async () => {
    await act(async () => {
        await new Promise(r => setTimeout(r, 20));
    });
};

describe("a save that moves the side panel", () => {

    it("reaches the saved record's address without asking about unsaved changes", async () => {
        const here = setup();
        await act(async () => {
            controller.open(panel("new_order", "/c/orders#new_side"));
        });
        await settle();

        // Typing into the new record.
        await act(async () => {
            panelContext.setBlocked(true);
        });
        await settle();

        // "Create": the form reports itself clean, and the panel moves to the
        // record it just created — in one tick, as `afterSave` does.
        await act(async () => {
            panelContext.setBlocked(false);
            controller.replace(panel("order_7", "/c/orders/7#side"));
        });
        await settle();

        expect(screen.queryByText("There are unsaved changes")).toBeNull();
        expect(here()).toBe("/c/orders/7#side");
    });

    it("still asks before leaving a dirty record", async () => {
        const here = setup();
        await act(async () => {
            controller.open(panel("new_order", "/c/orders#new_side"));
        });
        await settle();

        await act(async () => {
            panelContext.setBlocked(true);
        });
        await settle();

        await act(async () => {
            controller.replace(panel("order_7", "/c/orders/7#side"));
        });
        await settle();

        expect(screen.queryByText("There are unsaved changes")).not.toBeNull();
        expect(here()).toBe("/c/orders#new_side");
    });
});
