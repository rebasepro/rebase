/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import type { OnCellValueChangeParams } from "@rebasepro/app";
import type { PropertyFieldBindingProps } from "../../src/types/fields";

/**
 * The popup editor validates a spread map's child.
 *
 * A map with `admin.spreadChildren` shows each child as its own column, so the
 * popup for one of them edits `address.street`. It looked the property up as
 * `collection.properties["address.street"]`, a key that does not exist, and
 * built its schema from nothing: any value was saved, and the rule the column
 * declares was left to the server to refuse.
 */

// jsdom has no ResizeObserver; the popup observes its own size to stay on screen.
if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({}),
        useAuthController: () => ({ user: null }),
        useCustomizationController: () => ({ plugins: [] }),
        useData: () => ({ collection: () => ({}) })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});
// The field shows the error the form holds at its own key, which is where the
// real binding reads it from.
jest.mock("../../src/form", () => {
    const { getIn } = jest.requireActual<typeof import("@rebasepro/forms")>("@rebasepro/forms");
    return {
        PropertyFieldBinding: ({ propertyKey, context }: PropertyFieldBindingProps<Record<string, unknown>>) =>
            <output aria-label={"field error"}>{String(getIn(context.formex.errors, propertyKey) ?? "")}</output>,
        zodToFormErrors: jest.requireActual<typeof import("../../src/form/form_utils")>("../../src/form/form_utils").zodToFormErrors
    };
});

import { PopupFormFieldInternal } from "../../src/components/CollectionTableBinding/internal/popup_field/PopupFormField";

type Customer = { address: { street: string | null; city: string } };

const collection: AdminCollection<Customer> = {
    slug: "customers",
    name: "Customers",
    properties: {
        address: {
            type: "map",
            admin: { spreadChildren: true },
            properties: {
                street: { type: "string", name: "Street", validation: { max: 8, trim: true } },
                // Invalid in the stored row, and not what the popup edits.
                city: { type: "string", name: "City", validation: { max: 3 } }
            }
        }
    }
};

async function saveStreet(street: string | null) {
    const onCellValueChange = jest.fn<(params: OnCellValueChangeParams<unknown, Customer>) => void>();
    const entity: Entity<Customer> = { id: "1", path: "customers", values: { address: { street, city: "Berlin" } } };
    render(
        <PopupFormFieldInternal<Customer>
            tableKey="t"
            entityId="1"
            propertyKey={"address.street"}
            collection={collection}
            path="customers"
            open={true}
            onClose={() => undefined}
            onCellValueChange={onCellValueChange}
            container={document.body}
            entity={entity}/>
    );
    await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    return onCellValueChange;
}

describe("the popup editor of a spread map's child", () => {

    it("refuses a value its property does not allow, and says so on the field", async () => {
        const onCellValueChange = await saveStreet("Long Street 12");
        expect(onCellValueChange).not.toHaveBeenCalled();
        expect(screen.getByLabelText("field error").textContent).toMatch(/Street/);
    });

    it("saves a value its property allows, written the way the form writes it", async () => {
        const onCellValueChange = await saveStreet("  Main 1 ");
        expect(onCellValueChange).toHaveBeenCalledTimes(1);
        expect(onCellValueChange.mock.calls[0][0].value).toEqual("Main 1");
        expect(onCellValueChange.mock.calls[0][0].propertyKey).toEqual("address.street");
    });

    it("judges only the child it edits, not its siblings in the map", async () => {
        // `city` breaks its own rule in the stored row; the popup shows no
        // city field, so an error there could only block the save unseen.
        const onCellValueChange = await saveStreet("Main 1");
        expect(onCellValueChange).toHaveBeenCalledTimes(1);
    });

    it("saves a cleared value", async () => {
        const onCellValueChange = await saveStreet(null);
        expect(onCellValueChange).toHaveBeenCalledTimes(1);
        expect(onCellValueChange.mock.calls[0][0].value).toBeNull();
    });
});
