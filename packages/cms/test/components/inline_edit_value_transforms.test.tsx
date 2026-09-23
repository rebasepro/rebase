/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Entity, StringProperty } from "@rebasepro/types";
import type { AdminCollection, SelectedCellProps } from "@rebasepro/cms-types";
import type { DataCollectionTableController, OnCellValueChangeParams } from "@rebasepro/app";

/**
 * A table edit writes a string the way the record form writes it.
 *
 * `validation.trim`, `lowercase` and `uppercase` change the value that is
 * written, and only the panel applies them: the server checks what it
 * receives. The form applies them on save. The table's inline editor and its
 * popup editor validated the transformed value and then saved what was typed,
 * so with the documented slug example (`matches: /^[a-z0-9-]+$/`, `trim`,
 * `lowercase`) "  My-Slug " passed the cell's check, was sent as typed, and
 * the server refused it.
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
import { PopupFormFieldInternal } from "../../src/components/CollectionTableBinding/internal/popup_field/PopupFormField";

type Page = { slug: string };

const slugProperty: StringProperty = {
    type: "string",
    name: "Slug",
    validation: { matches: "^[a-z0-9-]+$", trim: true, lowercase: true }
};

/** A title whose only transform is `trim`: words, and the spaces between them, are valid. */
const titleProperty: StringProperty = { type: "string", name: "Title", validation: { trim: true } };

const entity: Entity<Page> = { id: "1", path: "pages", values: { slug: "old-slug" } };

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

function renderCell(onValueChange: (params: OnCellValueChangeParams<unknown, Entity<Record<string, unknown>>>) => void,
    property: StringProperty = slugProperty) {
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
                property={property}
                height={40}
                width={200}
                entity={{ ...entity, values: { slug: value } }}
                path={"pages"}
                disabled={false}/>
        </SelectableTableContext.Provider>
    );
    const view = render(cell("old-slug"));
    act(() => store.select({
        propertyKey: "slug",
        entityPath: "pages",
        entityId: "1",
        cellRect: new DOMRect(0, 0, 200, 40),
        width: 200,
        height: 40
    }));
    return {
        store,
        editor: () => screen.getByRole("textbox") as HTMLTextAreaElement,
        /** The row as it is read again after the save lands. */
        echo: (value: string) => view.rerender(cell(value))
    };
}

describe("the table's inline editor", () => {

    it("saves the transformed value", async () => {
        const saves: unknown[] = [];
        const { editor } = renderCell(({ value }) => saves.push(value));
        fireEvent.change(editor(), { target: { value: "  My-Slug " } });
        fireEvent.blur(editor());
        await waitFor(() => expect(saves).toEqual(["my-slug"]));
    });

    it("keeps what is being typed when the saved value comes back", async () => {
        const saves: unknown[] = [];
        const { editor, echo } = renderCell(({ value }) => saves.push(value), titleProperty);
        fireEvent.change(editor(), { target: { value: "Hello " } });
        fireEvent.blur(editor());
        await waitFor(() => expect(saves).toEqual(["Hello"]));

        // Trimming the editor under the cursor would eat the space before the
        // next word.
        echo("Hello");
        expect(editor().value).toEqual("Hello ");
    });

    it("shows the written value once the cell is left", async () => {
        const saves: unknown[] = [];
        const { editor, store } = renderCell(({ value }) => saves.push(value));
        fireEvent.change(editor(), { target: { value: "  My-Slug " } });
        fireEvent.blur(editor());
        await waitFor(() => expect(saves).toEqual(["my-slug"]));

        act(() => store.select(undefined));
        expect(screen.queryByRole("textbox")).toBeNull();
        await waitFor(() => expect(screen.getByText("my-slug")).toBeTruthy());
    });

    it("does not write again when the typed value only differs by what the transforms remove", async () => {
        const saves: unknown[] = [];
        const { editor } = renderCell(({ value }) => saves.push(value));
        fireEvent.change(editor(), { target: { value: "  My-Slug " } });
        fireEvent.blur(editor());
        await waitFor(() => expect(saves).toEqual(["my-slug"]));

        fireEvent.change(editor(), { target: { value: "My-Slug" } });
        fireEvent.blur(editor());
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
        expect(saves).toEqual(["my-slug"]);
    });
});

describe("the table's popup editor", () => {

    it("saves the transformed value", async () => {
        const collection: AdminCollection<Page> = { slug: "pages", name: "Pages", properties: { slug: slugProperty } };
        const onCellValueChange = jest.fn<(params: OnCellValueChangeParams<unknown, Page>) => void>();
        render(
            <PopupFormFieldInternal<Page>
                tableKey="t"
                entityId="1"
                propertyKey={"slug"}
                collection={collection}
                path="pages"
                open={true}
                onClose={() => undefined}
                onCellValueChange={onCellValueChange}
                container={document.body}
                entity={{ ...entity, values: { slug: "  My-Slug " } }}/>
        );
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Save" }));
        });
        expect(onCellValueChange).toHaveBeenCalledTimes(1);
        expect(onCellValueChange.mock.calls[0][0].value).toEqual("my-slug");
    });
});
