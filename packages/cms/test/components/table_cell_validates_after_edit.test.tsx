/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Entity, StringProperty } from "@rebasepro/types";
import type { SelectedCellProps } from "@rebasepro/cms-types";
import type { DataCollectionTableController, OnCellValueChangeParams } from "@rebasepro/app";

/**
 * A table cell judges a value only once it has been edited.
 *
 * A stored value that no longer passes the column's validation (a rule added
 * later, a row written over the API or by SQL) drew a red border and an error
 * tooltip on every cell holding one, as soon as the table rendered. The user
 * had touched nothing. The cell now shows validation after an edit, as the
 * record form does, and never for a stored value just by rendering it.
 */

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
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
    zodToFormErrors: jest.requireActual<typeof import("../../src/form/form_utils")>("../../src/form/form_utils").zodToFormErrors
}));

import { PropertyTableCell } from "../../src/components/CollectionTableBinding/PropertyTableCell";
import { SelectableTableContext } from "../../src/components/SelectableTable/SelectableTableContext";

const slugProperty: StringProperty = {
    type: "string",
    name: "Slug",
    validation: { matches: "^[a-z0-9-]+$" }
};

function selectionStore() {
    let selected: SelectedCellProps | undefined;
    const listeners = new Set<() => void>();
    return {
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
}

function renderCell(stored: string,
    onValueChange: (params: OnCellValueChangeParams<unknown, Entity<Record<string, unknown>>>) => void = () => undefined) {
    const store = selectionStore();
    const controller: DataCollectionTableController<Record<string, unknown>> = {
        selectionStore: store,
        select: store.select,
        onValueChange,
        size: "m"
    };
    const cell = (value: string) => (
        <SelectableTableContext.Provider value={controller}>
            <PropertyTableCell propertyKey={"slug"}
                columnIndex={0}
                align={"left"}
                value={value}
                readonly={false}
                property={slugProperty}
                height={40}
                width={200}
                entity={{ id: "1", path: "pages", values: { slug: value } }}
                path={"pages"}
                disabled={false}/>
        </SelectableTableContext.Provider>
    );
    const view = render(cell(stored));
    return {
        view,
        select: () => act(() => store.select({
            propertyKey: "slug",
            entityPath: "pages",
            entityId: "1",
            cellRect: new DOMRect(0, 0, 200, 40),
            width: 200,
            height: 40
        })),
        editor: () => screen.getByRole("textbox") as HTMLTextAreaElement,
        /** The row as it is read again: a realtime frame or a refetch. */
        reload: (value: string) => view.rerender(cell(value))
    };
}

/** Lets the cell's async schema check settle. */
async function settle() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

const flagged = (container: HTMLElement) => container.querySelector(".border-red-500") !== null;

describe("a table cell's validation", () => {

    it("does not flag a stored value that fails the rule just by rendering it", async () => {
        const { view } = renderCell("Not A Slug");
        await settle();
        expect(flagged(view.container)).toBe(false);
    });

    it("does not flag a stored value when the cell is selected", async () => {
        const { view, select } = renderCell("Not A Slug");
        select();
        await settle();
        expect(flagged(view.container)).toBe(false);
    });

    it("does not flag a stored value that a reload brings", async () => {
        const { view, reload } = renderCell("old-slug");
        reload("Not A Slug");
        await settle();
        expect(flagged(view.container)).toBe(false);
    });

    it("flags a value once it has been edited, and does not save it", async () => {
        const saves: unknown[] = [];
        const { view, select, editor } = renderCell("old-slug", ({ value }) => saves.push(value));
        select();
        fireEvent.change(editor(), { target: { value: "Not A Slug" } });
        fireEvent.blur(editor());
        await waitFor(() => expect(flagged(view.container)).toBe(true));
        expect(saves).toEqual([]);
    });

    it("drops the flag when the stored value changes under an edit", async () => {
        const { view, select, editor, reload } = renderCell("old-slug");
        select();
        fireEvent.change(editor(), { target: { value: "Not A Slug" } });
        fireEvent.blur(editor());
        await waitFor(() => expect(flagged(view.container)).toBe(true));
        reload("Still Not A Slug");
        await settle();
        expect(flagged(view.container)).toBe(false);
    });
});
