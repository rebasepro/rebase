/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * The record's bar draws what the developer promoted as buttons, and orders
 * the menu so the collection's own operations lead and Delete trails, apart.
 *
 * It used to take its actions as finished menu items, so there was nowhere for
 * an action declared `collapsed: false` to go but the menu — and the menu
 * listed Copy, Delete, then the collection's own.
 */

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useTranslation: () => ({ t: (key: string) => key })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { EntityIdentityBar, type RecordActionItem } from "../../src/components/EntityIdentityBar";
import type { PlacedEntityActions } from "../../src/util/entity_actions";

beforeAll(() => {
    // Radix menus need pointer capture and scrollIntoView; jsdom has neither.
    Object.assign(Element.prototype, {
        hasPointerCapture: () => false,
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        scrollIntoView: () => undefined
    });
});

const collection = { name: "Customers", slug: "customers", properties: {} } as unknown as AdminCollection;

function item(name: string, overrides: Partial<RecordActionItem> = {}): RecordActionItem {
    return { key: name.toLowerCase(), name, enabled: true, run: () => undefined, ...overrides };
}

function renderBar(recordActions: PlacedEntityActions<RecordActionItem>, extra: { onViewHistory?: () => void } = {}) {
    return render(
        <EntityIdentityBar collection={collection}
            title={"Robert Lopez"}
            entityId={"7"}
            status={"existing"}
            dirty={false}
            saving={false}
            onSave={() => undefined}
            recordActions={recordActions}
            {...extra}/>
    );
}

function openMenu() {
    // jsdom has no PointerEvent, so the menu is opened from the keyboard.
    fireEvent.keyDown(screen.getByRole("button", { name: "more_actions" }), { key: "Enter" });
    return screen.getByRole("menu");
}

describe("the record bar's actions", () => {

    it("draws a promoted action as a labelled button, outside the menu", () => {
        const run = jest.fn(() => undefined);
        renderBar({ inline: [item("Recalculate", { run })], own: [item("Resend")], generic: [], destructive: [] });

        fireEvent.click(screen.getByRole("button", { name: "Recalculate" }));
        expect(run).toHaveBeenCalledTimes(1);

        const menu = openMenu();
        expect(within(menu).queryByText("Recalculate")).toBeNull();
        expect(within(menu).getByText("Resend")).toBeTruthy();
    });

    it("leads the menu with the collection's own actions and puts Delete last, apart", () => {
        renderBar({
            inline: [],
            own: [item("Recalculate"), item("Resend")],
            generic: [item("Copy")],
            destructive: [item("Delete")]
        }, { onViewHistory: () => undefined });

        const menu = openMenu();
        const sequence = Array.from(menu.querySelectorAll("[role=menuitem], [role=separator]"))
            .map(node => node.getAttribute("role") === "separator" ? "—" : node.textContent);
        expect(sequence).toEqual(["Recalculate", "Resend", "—", "Copy", "record_history", "—", "Delete"]);
    });

    it("draws no rule at the menu's edge when a group is missing", () => {
        renderBar({ inline: [], own: [], generic: [item("Copy")], destructive: [item("Delete")] });

        const menu = openMenu();
        const sequence = Array.from(menu.querySelectorAll("[role=menuitem], [role=separator]"))
            .map(node => node.getAttribute("role") === "separator" ? "—" : node.textContent);
        expect(sequence).toEqual(["Copy", "—", "Delete"]);
    });

    it("keeps a promoted button busy while its work runs", async () => {
        let finish: () => void = () => undefined;
        const run = jest.fn(() => new Promise<void>(resolve => {
            finish = resolve;
        }));
        renderBar({ inline: [item("Resend", { run })], own: [], generic: [], destructive: [] });

        const button = screen.getByRole<HTMLButtonElement>("button", { name: "Resend" });
        fireEvent.click(button);
        expect(button.disabled).toBe(true);
        fireEvent.click(button);
        expect(run).toHaveBeenCalledTimes(1);

        await act(async () => finish());
        expect(button.disabled).toBe(false);
    });

    it("says under a disabled menu item why it is unavailable", () => {
        renderBar({
            inline: [],
            own: [item("Resend to Shopify", { enabled: false, disabledReason: "No Shopify account linked" })],
            generic: [],
            destructive: []
        });

        const menuItem = within(openMenu()).getByRole("menuitem");
        expect(menuItem.textContent).toBe("Resend to ShopifyNo Shopify account linked");
        expect(menuItem.getAttribute("data-disabled")).not.toBeNull();
    });

    it("keeps an enabled item's reason to itself", () => {
        renderBar({
            inline: [],
            own: [item("Resend", { disabledReason: "stale" })],
            generic: [],
            destructive: []
        });

        expect(within(openMenu()).getByRole("menuitem").textContent).toBe("Resend");
    });

    it("lets the hover through a disabled promoted button to the tooltip saying why", () => {
        renderBar({
            inline: [item("Resend", { enabled: false, disabledReason: "No Shopify account linked" })],
            own: [],
            generic: [],
            destructive: []
        });

        const button = screen.getByRole<HTMLButtonElement>("button", { name: "Resend" });
        expect(button.disabled).toBe(true);
        // A disabled button receives no pointer events, so the tooltip is on a
        // wrapper and the button lets the hover through to it.
        expect(button.className).toContain("pointer-events-none");
        expect(button.parentElement?.getAttribute("data-state")).toBe("closed");
    });

    it("disables a promoted action the record does not allow", () => {
        renderBar({ inline: [item("Resend", { enabled: false })], own: [], generic: [], destructive: [] });
        expect(screen.getByRole<HTMLButtonElement>("button", { name: "Resend" }).disabled).toBe(true);
    });
});
