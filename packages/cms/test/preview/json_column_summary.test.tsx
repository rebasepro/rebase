/**
 * @jest-environment jsdom
 *
 * A JSON column reads as one line in a table cell.
 *
 * A JSON column with no renderer of its own was drawn in its cell as the full
 * tree — every nested object a bordered sub-table, every array index a row —
 * down to the coordinates of a map polygon: `trip › map › geo › 0 › rings › 0
 * › 0 › 107.97`. The cell now draws the document's top-level keys, labelled,
 * with short values, `n items` for a list and `n fields` for an object.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react";
import type { DataCollectionTableController } from "@rebasepro/app";
import type { Entity, MapProperty, Property, SelectedCellProps } from "@rebasepro/cms-types";

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
        useData: () => ({ table: () => ({}) }),
        useTranslation: () => ({
            t: (key: string, options?: { count?: number }) => options?.count !== undefined ? `${options.count} ${key}` : key
        })
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
import { isDocumentProperty, summarizeDocument } from "../../src/preview/document_summary";

const trip = {
    title: "Morocco loop",
    map: { geo: [{ rings: [[[107.97, 12.31], [107.98, 12.32]]] }] },
    days: [{ day: 1 }, { day: 2 }, { day: 3 }],
    published: true
};

function renderCell(property: Property, value: unknown) {
    let selected: SelectedCellProps | undefined;
    const controller: DataCollectionTableController<Record<string, unknown>> = {
        selectionStore: {
            getEntity: () => selected,
            subscribe: () => () => undefined,
            select: (cell?: SelectedCellProps) => { selected = cell; }
        },
        select: () => undefined,
        onValueChange: () => undefined,
        size: "m"
    };
    const entity: Entity<Record<string, unknown>> = { id: "1", path: "trips", values: { trip: value } };
    return render(
        <SelectableTableContext.Provider value={controller}>
            <PropertyTableCell propertyKey={"trip"}
                columnIndex={0}
                align={"left"}
                value={value}
                readonly={false}
                property={property}
                height={48}
                width={360}
                entity={entity}
                path={"trips"}
                disabled={false}/>
        </SelectableTableContext.Provider>
    );
}

describe("a JSON column's table cell", () => {

    it("draws a free-form document as its top-level keys, not as a tree", () => {
        const { container } = renderCell({ type: "map", name: "Trip", keyValue: true }, trip);
        const text = container.textContent ?? "";
        expect(text).toContain("title Morocco loop");
        expect(text).toContain("map 1 preview_fields_count");
        expect(text).toContain("days 3 preview_items_count");
        expect(text).toContain("published yes");
        expect(text).not.toContain("rings");
        expect(text).not.toContain("107.97");
    });

    it("labels a typed document's keys with their names", () => {
        const property: MapProperty = {
            type: "map",
            name: "Trip",
            properties: {
                title: { type: "string", name: "Title" },
                days: { type: "array", name: "Days", of: { type: "map", properties: { day: { type: "number", name: "Day" } } } }
            }
        };
        const { container } = renderCell(property, { title: "Morocco loop", days: [{ day: 1 }] });
        const text = container.textContent ?? "";
        expect(text).toContain("Title Morocco loop");
        expect(text).toContain("Days 1 preview_items_count");
        expect(text).not.toContain("Day1");
    });

    it("draws a list of documents as its count", () => {
        const property: Property = { type: "array", name: "Stops", of: { type: "map", properties: { city: { type: "string", name: "City" } } } };
        const { container } = renderCell(property, [{ city: "Fez" }, { city: "Rabat" }]);
        expect(container.textContent).toContain("2 preview_items_count");
        expect(container.textContent).not.toContain("Fez");
    });
});

describe("summarizeDocument", () => {

    it("names at most four keys, skipping empty ones", () => {
        const summary = summarizeDocument({ a: "", b: null, c: 1, d: "two", e: [1], f: { g: 1 }, h: "more" });
        expect(summary).toEqual({
            kind: "parts",
            parts: [
                { label: "c", kind: "text", text: "1" },
                { label: "d", kind: "text", text: "two" },
                { label: "e", kind: "items", count: 1 },
                { label: "f", kind: "fields", count: 1 }
            ]
        });
    });

    it("names only a map's previewFields, when it has them", () => {
        expect(summarizeDocument({ a: 1, b: 2, c: 3 }, { keys: ["c", "a"] })).toEqual({
            kind: "parts",
            parts: [
                { label: "c", kind: "text", text: "3" },
                { label: "a", kind: "text", text: "1" }
            ]
        });
    });

    it("cuts a long text value", () => {
        const summary = summarizeDocument({ note: "x".repeat(100) });
        expect(summary.kind === "parts" && summary.parts[0].kind === "text" && summary.parts[0].text.length).toBe(40);
    });

    it("counts a bare list, and has nothing to say about an empty object", () => {
        expect(summarizeDocument([1, 2])).toEqual({ kind: "items", count: 2 });
        expect(summarizeDocument({})).toEqual({ kind: "empty" });
    });
});

describe("isDocumentProperty", () => {
    it("is true for objects and lists of documents, false for scalars and lists of scalars", () => {
        expect(isDocumentProperty({ type: "map", keyValue: true })).toBe(true);
        expect(isDocumentProperty({ type: "array", of: { type: "map", properties: {} } })).toBe(true);
        expect(isDocumentProperty({ type: "array", of: { type: "string" } })).toBe(false);
        expect(isDocumentProperty({ type: "string" })).toBe(false);
    });
});
