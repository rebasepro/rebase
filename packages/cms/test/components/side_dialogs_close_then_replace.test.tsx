/**
 * @jest-environment jsdom
 *
 * The panel-stack primitives `SidePanelBinding.onUpdate` is built on.
 *
 * That handler used to raise two of them for one save — a `replace` onto the
 * saved record's address *and* a close — and since the last navigation wins
 * (see router_two_navigations_one_handler.test.tsx), statement order decided
 * which the user got. It now raises exactly one, and calls the opener's
 * `onUpdate` last so the opener's own navigation is the final word.
 *
 * These pin why that shape is required: pairing a close with a replace
 * corrupts the stack, and two closes do not. See docs/bug-classes.md #28.
 */

import React from "react";
import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { useBuildSideDialogsController } from "../../src/hooks/useBuildSideDialogsController";
import type { SideDialogsController } from "../../src/hooks/useSideDialogsController";

// jsdom has no fetch primitives; the data router builds a Request per navigation.
if (typeof (globalThis as any).Request === "undefined") {
    (globalThis as any).Request = class {
        url: string;
        method: string;
        signal: unknown;
        constructor(url: string, init: { method?: string, signal?: unknown } = {}) {
            this.url = String(url);
            this.method = init.method ?? "GET";
            this.signal = init.signal;
        }
    };
}

const panel = (key: string, urlPath: string) => ({
    key,
    component: <div/>,
    urlPath,
    parentUrlPath: "/c/products"
});

let controller: SideDialogsController;

function Harness() {
    controller = useBuildSideDialogsController();
    const location = useLocation();
    return <div data-testid="here">
        {location.pathname + location.hash + " | " + controller.sidePanels.map(p => p.key).join(",")}
    </div>;
}

function setup() {
    const router = createMemoryRouter(
        [{ path: "*", element: <Harness/> }],
        { initialEntries: ["/c/products"] }
    );
    render(<RouterProvider router={router}/>);
    return () => screen.getByTestId("here").textContent;
}

const settle = async () => {
    await act(async () => {
        await new Promise(r => setTimeout(r, 20));
    });
};

const open = async (key: string, urlPath: string) => {
    await act(async () => {
        controller.open(panel(key, urlPath));
    });
    await settle();
};

describe("SideDialogs controller: pairing panel navigations in one handler", () => {

    it("close() then replace() undoes the close and rewrites the panel underneath", async () => {
        const here = setup();
        await open("picker", "/c/products#side");
        await open("new_entity", "/c/products#new_side");
        expect(here()).toContain("picker,new_entity");

        await act(async () => {
            controller.close();
            controller.replace(panel("saved_entity", "/c/products/7#side"));
        });
        await settle();

        // Why `onUpdate` may not do both: the close lost — `new_entity` was
        // popped and the replace then wrote the saved record into the *picker's*
        // slot, so the panel the user asked to close is still open and the one
        // they came from is gone. This is the shape the handler avoids, not one
        // it produces; it is pinned so the reason survives the fix.
        expect(here()).toBe("/c/products/7#side | saved_entity");
    });

    it("replace() then close() — the close wins, being last", async () => {
        const here = setup();
        await open("entity", "/c/products/7#side");

        await act(async () => {
            controller.replace(panel("entity", "/c/products/7#side"));
            controller.close();
        });
        await settle();

        expect(here()).toBe("/c/products | ");
    });

    it("two closes in one tick pop both panels", async () => {
        const here = setup();
        await open("picker", "/c/products#side");
        await open("new_entity", "/c/products#new_side");

        // The reference picker's "add new", saved: `closeOnSave` closes the new
        // entity's panel, then the opener's `onUpdate` selects the record and
        // closes the picker. Both closes have to land, or the picker is stranded
        // over a form that already has its value.
        await act(async () => {
            controller.close();
            controller.close();
        });
        await settle();

        expect(here()).toBe("/c/products | ");
    });
});
