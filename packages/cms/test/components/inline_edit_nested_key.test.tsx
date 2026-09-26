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
 *
 * The whole map is built from the row the cell was rendered with. The cell's
 * memo compared only its own value, so a row read back with a sibling key
 * changed (`address.city`, edited in the next column) never reached the
 * `address.street` cell, and its next edit sent the old city back.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { Entity, StringProperty } from "@rebasepro/types";
import type { AdminCollection, RebaseContext, SelectedCellProps } from "@rebasepro/cms-types";
import type { DataCollectionTableController, OnCellValueChangeParams } from "@rebasepro/app";

// jsdom has no ResizeObserver; the popup observes its own size to stay on screen.
if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

type SaveCall = { values: Record<string, unknown>; previousValues?: Record<string, unknown> };
const saves: SaveCall[] = [];

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        saveEntityWithCallbacks: async (props: SaveCall & { afterSave?: () => void }) => {
            saves.push({ values: props.values, previousValues: props.previousValues });
            props.afterSave?.();
        },
        useRebaseContext: () => ({}),
        useAuthController: () => ({ user: null }),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, locale: undefined }),
        useData: () => ({ collection: () => ({}) }),
        useTranslation: () => ({ t: (key: string) => key })
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
import { PropertyTableCell } from "../../src/components/CollectionTableBinding/PropertyTableCell";
import { SelectableTableContext } from "../../src/components/SelectableTable/SelectableTableContext";

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

    it("a spread child cell builds the map from the row as it is now, not as it last saw it", async () => {
        let selected: SelectedCellProps | undefined;
        const listeners = new Set<() => void>();
        const store = {
            getEntity: () => selected,
            subscribe: (listener: () => void) => {
                listeners.add(listener);
                return () => { listeners.delete(listener); };
            },
            select: (cell?: SelectedCellProps) => {
                selected = cell;
                listeners.forEach((listener) => listener());
            }
        };
        const streetProperty: StringProperty = { type: "string", name: "Street" };

        function StreetCell({ row }: { row: Entity<Customer> }) {
            const { onValueChange } = useCollectionInlineEditor<Customer>({
                path: "customers",
                collection,
                dataClient: {} as never,
                context: {} as RebaseContext
            });
            const controller: DataCollectionTableController<Record<string, unknown>> = {
                selectionStore: store,
                select: store.select,
                onValueChange,
                size: "m"
            };
            return <SelectableTableContext.Provider value={controller}>
                <PropertyTableCell propertyKey={"address.street"}
                    columnIndex={1}
                    align={"left"}
                    value={row.values.address.street}
                    readonly={false}
                    property={streetProperty}
                    height={40}
                    width={200}
                    entity={row}
                    path={"customers"}
                    disabled={false}/>
            </SelectableTableContext.Provider>;
        }

        const view = render(<StreetCell row={{ id: "1", path: "customers", values: { address: { street: "Old St", city: "Berlin" } } }}/>);
        // The city cell was edited and saved; the row is read back with the
        // new city and the street untouched.
        view.rerender(<StreetCell row={{ id: "1", path: "customers", values: { address: { street: "Old St", city: "Munich" } } }}/>);

        act(() => store.select({
            propertyKey: "address.street",
            entityPath: "customers",
            entityId: "1",
            cellRect: new DOMRect(0, 0, 200, 40),
            width: 200,
            height: 40
        }));
        const editor = screen.getByRole("textbox");
        fireEvent.change(editor, { target: { value: "New St" } });
        await act(async () => {
            fireEvent.blur(editor);
        });

        expect(saves).toHaveLength(1);
        expect(saves[0].values).toEqual({ address: { street: "New St", city: "Munich" } });
        expect(saves[0].previousValues).toEqual({ address: { street: "Old St", city: "Munich" } });
    });
});
