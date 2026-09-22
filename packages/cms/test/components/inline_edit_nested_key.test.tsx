/**
 * @jest-environment jsdom
 *
 * An inline edit of one key inside a map saves the whole map.
 *
 * A map with `admin.spreadChildren` shows each child as its own column, so a
 * cell edit arrives with a dotted key: `address.street`. The payload was built
 * as `setIn({}, "address.street", value)` — `{ address: { street } }` — and the
 * map is one jsonb column, which a PATCH replaces whole: `city` was erased.
 *
 * The popup editor for the same cell read the value as `values["address.street"]`,
 * a key that does not exist on nested form values, so it saved `undefined` and
 * reported success.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { AdminCollection, RebaseContext } from "@rebasepro/cms-types";
import type { OnCellValueChangeParams } from "@rebasepro/app";

// jsdom has no ResizeObserver; the popup observes its own size to stay on screen.
if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

type SaveCall = { values: Record<string, unknown> };
const saves: SaveCall[] = [];

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        saveEntityWithCallbacks: async (props: SaveCall & { afterSave?: () => void }) => {
            saves.push({ values: props.values });
            props.afterSave?.();
        },
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
jest.mock("../../src/form", () => ({
    PropertyFieldBinding: () => null,
    zodToFormErrors: () => ({})
}));

import { useCollectionInlineEditor } from "../../src/components/CollectionViewBinding/hooks/useCollectionInlineEditor";
import { PopupFormFieldInternal } from "../../src/components/CollectionTableBinding/internal/popup_field/PopupFormField";

type Customer = { address: { street: string; city: string }; tags?: string[] };

const collection: AdminCollection<Customer> = {
    slug: "customers",
    name: "Customers",
    properties: {
        address: {
            type: "map",
            admin: { spreadChildren: true },
            properties: { street: { type: "string" }, city: { type: "string" } }
        },
        tags: { type: "array", of: { type: "string" } }
    }
};

const entity: Entity<Customer> = {
    id: "1",
    path: "customers",
    values: { address: { street: "Old St", city: "Berlin" }, tags: ["a", "b"] }
};

describe("inline editing a key inside a map", () => {

    beforeEach(() => {
        saves.length = 0;
    });

    const editCell = async (propertyKey: string, value: unknown) => {
        const { result } = renderHook(() => useCollectionInlineEditor<Customer>({
            path: "customers",
            collection,
            dataClient: {} as never,
            context: {} as RebaseContext
        }));
        await act(async () => {
            await result.current.onValueChange({
                value,
                propertyKey,
                onValueUpdated: () => undefined,
                setError: () => undefined,
                data: entity
            } as OnCellValueChangeParams<unknown, Customer>);
        });
    };

    it("sends the whole map, with the untouched keys in it", async () => {
        await editCell("address.street", "New St 1");
        expect(saves).toHaveLength(1);
        expect(saves[0].values).toEqual({ address: { street: "New St 1", city: "Berlin" } });
    });

    it("sends the whole array for an edit of one of its items", async () => {
        await editCell("tags[1]", "c");
        expect(saves[0].values).toEqual({ tags: ["a", "c"] });
    });

    it("still sends just the column for a top-level key", async () => {
        await editCell("tags", ["x"]);
        expect(saves[0].values).toEqual({ tags: ["x"] });
    });

    it("the popup editor saves the value at the nested key", async () => {
        const onCellValueChange = jest.fn<(params: OnCellValueChangeParams<unknown, Customer>) => void>();
        render(
            <PopupFormFieldInternal<Customer>
                tableKey="t"
                entityId="1"
                propertyKey={"address.street" as never}
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
        expect(onCellValueChange).toHaveBeenCalledTimes(1);
        expect(onCellValueChange.mock.calls[0][0].value).toBe("Old St");
        expect(onCellValueChange.mock.calls[0][0].propertyKey).toBe("address.street");
    });
});
