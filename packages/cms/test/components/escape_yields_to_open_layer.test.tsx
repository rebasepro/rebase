/**
 * @jest-environment jsdom
 *
 * Escape pressed in an open dropdown closes the dropdown, and only the dropdown.
 *
 * The split view and the inspector decided "an overlay owns this key" by asking
 * the DOM for `[role="dialog"][data-state="open"]`. A kit `Menu` is
 * `role="menu"` and a `Select` list `role="listbox"`, so neither matched: Escape
 * to dismiss a record's actions menu or an enum field's dropdown also closed
 * the record — the default open mode of the default list view.
 *
 * The rule now is the kit's `isKeyHandled`: a Radix layer calls
 * `preventDefault()` on the Escape it consumes, and a global handler that finds
 * the event handled does nothing.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EntityTableController } from "@rebasepro/cms-types";
import { Button, Dialog, DialogTitle, isKeyHandled, Menu, MenuItem } from "@rebasepro/ui";

const mockNavigate = jest.fn();
jest.mock("react-router", () => ({
    ...(jest.requireActual("react-router") as Record<string, unknown>),
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: "/c/products/5", search: "", hash: "", state: null, key: "k" })
}));

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useLargeLayout: () => true
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

/** The record panel: a form with an actions menu, as EditViewBinding renders one. */
jest.mock("../../src/components/EditViewBinding", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ui = require("@rebasepro/ui") as typeof import("@rebasepro/ui");
    return {
        EditViewBinding: () => (
            <ui.Menu trigger={<ui.Button>Record actions</ui.Button>}>
                <ui.MenuItem onClick={() => undefined}>Duplicate</ui.MenuItem>
            </ui.Menu>
        )
    };
});
jest.mock("../../src/components/DetailViewBinding", () => ({
    DetailViewBinding: () => null
}));
jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => ({
    useUrlController: () => ({ buildUrlCollectionPath: (p: string) => `/c/${p}` })
}));
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({
        getParentCollectionSlugs: () => [],
        getParentEntityIds: () => []
    })
}));

import { SplitListView } from "../../src/components/CollectionViewBinding/SplitListView";
import { EntityInspector } from "../../src/components/EntityInspector";

const tableController = { data: [] } as unknown as EntityTableController<Record<string, unknown>>;

/** A keystroke targets the focused element, so it travels window → document → target and back. */
function pressEscape() {
    const target = document.activeElement ?? document.body;
    act(() => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
}

async function openMenu(name: string) {
    const trigger = screen.getByRole("button", { name });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    await screen.findByRole("menu");
}

describe("SplitListView — Escape in an open menu", () => {

    beforeEach(() => {
        mockNavigate.mockReset();
        window.history.replaceState({}, "", "/c/products/5");
    });

    function renderSplit() {
        return render(
            <SplitListView
                collection={{ slug: "products", name: "Products", properties: {} }}
                tableController={tableController}
                path="products"
                selectedEntityId="5">
                <div/>
            </SplitListView>
        );
    }

    it("closes the menu and leaves the record open", async () => {
        renderSplit();
        await openMenu("Record actions");

        pressEscape();

        await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("closes the record when nothing above it is open", () => {
        renderSplit();
        screen.getByRole("button", { name: "Record actions" }).focus();

        pressEscape();

        expect(mockNavigate).toHaveBeenCalledTimes(1);
        expect(String(mockNavigate.mock.calls[0][0]).split("?")[0]).toBe("/c/products");
    });
});

describe("SplitListView — list shortcuts with a dialog open", () => {

    it("a bare j pressed inside the dialog does not move the list behind it", async () => {
        const onEntityClick = jest.fn();
        const data = [{ id: "5", path: "products", values: {} }, { id: "6", path: "products", values: {} }];
        render(<>
            <SplitListView
                collection={{ slug: "products", name: "Products", properties: {} }}
                tableController={{ data } as unknown as EntityTableController<Record<string, unknown>>}
                path="products"
                selectedEntityId="5"
                onEntityClick={onEntityClick}>
                <div/>
            </SplitListView>
            <Dialog open={true}>
                <DialogTitle>Delete?</DialogTitle>
                <button>Cancel</button>
            </Dialog>
        </>);
        const dialog = await screen.findByRole("dialog");
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

        act(() => {
            document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }));
        });

        expect(onEntityClick).not.toHaveBeenCalled();
    });
});

describe("EntityInspector — Escape in an open menu", () => {

    function renderInspector(onClose: () => void) {
        return render(<>
            <Menu trigger={<Button>Record actions</Button>}>
                <MenuItem onClick={() => undefined}>Duplicate</MenuItem>
            </Menu>
            <EntityInspector
                tab="json"
                onTabChange={() => undefined}
                onClose={onClose}
                collection={{ slug: "products", name: "Products", properties: {} }}
                includeHistory={false}/>
        </>);
    }

    it("closes the menu and leaves the inspector open", async () => {
        const onClose = jest.fn();
        renderInspector(onClose);
        await openMenu("Record actions");

        pressEscape();

        await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
        expect(onClose).not.toHaveBeenCalled();
    });

    it("closes itself otherwise, and marks the key handled for the record underneath", () => {
        const onClose = jest.fn();
        renderInspector(onClose);
        let seenByRecord: boolean | undefined;
        const recordListener = (e: KeyboardEvent) => {
            seenByRecord = isKeyHandled(e);
        };
        window.addEventListener("keydown", recordListener);
        screen.getByRole("button", { name: "Record actions" }).focus();

        pressEscape();
        window.removeEventListener("keydown", recordListener);

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(seenByRecord).toBe(true);
    });
});
