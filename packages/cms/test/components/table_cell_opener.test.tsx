/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { BooleanProperty, DateProperty, Entity, Property, StringProperty } from "@rebasepro/types";
import type { SelectedCellProps } from "@rebasepro/cms-types";
import type { DataCollectionTableController } from "@rebasepro/app";

/**
 * A table cell looks the same at rest and selected, and opens its editor from
 * a control it reveals — in one click, from rest.
 *
 * A picker cell used to swap its resting preview for the editor's own field
 * when selected: a boxed trigger with its own padding, in which the value
 * moved and a relation's title stopped being the link it was a moment before.
 * Opening a dropdown took two clicks, the first of them spent selecting.
 */

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
import { getTableBindingForProperty } from "../../src/components/CollectionTableBinding/table_bindings";
import { TableCellOpener } from "../../src/components/CollectionTableBinding/internal/TableCellOpener";

beforeAll(() => {
    // Radix Select needs pointer capture and scrollIntoView; jsdom has neither.
    Object.assign(Element.prototype, {
        hasPointerCapture: () => false,
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        scrollIntoView: () => undefined
    });
});

const statusProperty: StringProperty = {
    type: "string",
    name: "Status",
    enum: [
        { id: "draft", label: "Draft" },
        { id: "published", label: "Published" }
    ]
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
        select: jest.fn((cell?: SelectedCellProps) => {
            selected = cell;
            listeners.forEach((listener) => listener());
        })
    };
}

function renderCell(property: Property, value: unknown) {
    const store = selectionStore();
    const controller: DataCollectionTableController<Record<string, unknown>> = {
        selectionStore: store,
        select: store.select,
        onValueChange: () => undefined,
        size: "m"
    };
    const entity: Entity<Record<string, unknown>> = { id: "1", path: "posts", values: { field: value } };
    const view = render(
        <SelectableTableContext.Provider value={controller}>
            <PropertyTableCell propertyKey={"field"}
                columnIndex={0}
                align={"left"}
                value={value}
                readonly={false}
                property={property}
                height={48}
                width={200}
                entity={entity}
                path={"posts"}
                disabled={false}/>
        </SelectableTableContext.Provider>
    );
    const select = () => act(() => store.select({
        propertyKey: "field",
        entityPath: "posts",
        entityId: "1",
        cellRect: new DOMRect(0, 0, 200, 48),
        width: 200,
        height: 48
    }));
    return { ...view, store, select };
}

describe("which cells have an opener", () => {

    it("every editor that floats declares one", () => {
        expect(getTableBindingForProperty(statusProperty, true)?.opener).toBe("dropdown");
        expect(getTableBindingForProperty({ type: "string", name: "Owner", userSelect: true }, true)?.opener).toBe("dropdown");
        expect(getTableBindingForProperty({ type: "array", name: "Tags", of: statusProperty }, true)?.opener).toBe("dropdown");
        expect(getTableBindingForProperty({ type: "date", name: "Due" }, true)?.opener).toBe("calendar");
        expect(getTableBindingForProperty({ type: "reference", name: "Author", path: "authors" }, true)?.opener).toBe("dialog");
    });

    it("an editor that is the value itself has none", () => {
        expect(getTableBindingForProperty({ type: "string", name: "Title" }, true)?.opener).toBeUndefined();
        expect(getTableBindingForProperty({ type: "number", name: "Price" }, true)?.opener).toBeUndefined();
        expect(getTableBindingForProperty({ type: "boolean", name: "Done" } satisfies BooleanProperty, true)?.opener).toBeUndefined();
    });
});

describe("a picker cell", () => {

    it("shows the opener at rest, before the picker is mounted", () => {
        const { container } = renderCell(statusProperty, "draft");
        expect(screen.getByText("Draft")).toBeTruthy();
        const opener = container.querySelector("[data-table-cell-opener='dropdown']");
        expect(opener).toBeTruthy();
        // Revealed by hovering the cell, not shown on every row.
        expect(opener?.className).toContain("opacity-0");
        expect(opener?.className).toContain("group-hover/cell:opacity-100");
    });

    it("opens the list in one click from rest, selecting the cell on the way", () => {
        const { container, store } = renderCell(statusProperty, "draft");
        const opener = container.querySelector("[data-table-cell-opener='dropdown']") as HTMLElement;
        fireEvent.pointerDown(opener);
        fireEvent.mouseDown(opener);
        fireEvent.click(opener);
        expect(store.select).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("listbox")).toBeTruthy();
    });

    it("keeps its value and its one chevron when selected", () => {
        const { container, select } = renderCell(statusProperty, "draft");
        select();
        expect(screen.getAllByText("Draft")).toHaveLength(1);
        // The trigger inside draws none of its own: the opener is the chevron.
        expect(container.querySelectorAll("svg.lucide-chevron-down")).toHaveLength(1);
        expect(container.querySelector("[data-table-cell-opener]")?.className).toContain("opacity-100");
    });
});

describe("a date cell", () => {

    it("opens the native picker from its opener, and draws no calendar button of its own", () => {
        const showPicker = jest.fn();
        Object.defineProperty(HTMLInputElement.prototype, "showPicker", { value: showPicker, configurable: true });
        const dateProperty: DateProperty = { type: "date", name: "Due", mode: "date" };
        const { container } = renderCell(dateProperty, new Date("2026-03-15T00:00:00Z"));
        const openers = container.querySelectorAll("[data-table-cell-opener]");
        expect(openers).toHaveLength(1);
        expect(container.querySelectorAll("svg.lucide-calendar")).toHaveLength(1);
        fireEvent.click(openers[0]);
        expect(showPicker).toHaveBeenCalledTimes(1);
    });
});

describe("the opener", () => {

    it("does not take the focus on a press, which would select the cell mid-click", () => {
        render(<TableCellOpener kind={"dropdown"} open={false} selected={false} focusOnSelect={false}
            label={"Edit Status"} onToggle={() => undefined}/>);
        const pressed = fireEvent.mouseDown(screen.getByLabelText("Edit Status"));
        // `fireEvent` returns false when the default was prevented.
        expect(pressed).toBe(false);
    });

    it("closes what it opened: a click while open asks for closed", () => {
        const onToggle = jest.fn();
        const { rerender } = render(<TableCellOpener kind={"dropdown"} open={false} selected={true} focusOnSelect={false}
            label={"Edit Status"} onToggle={onToggle}/>);
        fireEvent.click(screen.getByLabelText("Edit Status"));
        expect(onToggle).toHaveBeenLastCalledWith(true);
        rerender(<TableCellOpener kind={"dropdown"} open={true} selected={true} focusOnSelect={false}
            label={"Edit Status"} onToggle={onToggle}/>);
        const opener = screen.getByLabelText("Edit Status");
        // The state at the press is what counts: a picker that closes on an
        // outside mousedown has closed by the time the click lands.
        fireEvent.pointerDown(opener);
        rerender(<TableCellOpener kind={"dropdown"} open={false} selected={true} focusOnSelect={false}
            label={"Edit Status"} onToggle={onToggle}/>);
        fireEvent.click(opener);
        expect(onToggle).toHaveBeenLastCalledWith(false);
    });
});
