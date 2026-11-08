/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { VirtualTable } from "./VirtualTable";
import { VirtualTableColumn } from "./VirtualTableProps";

/**
 * A body cell of a table whose columns can be reordered is not a drag handle.
 *
 * Each cell spread dnd-kit's handle attributes, so it was a `role="button"`,
 * and every cell of the frozen first column — a sortable that cannot move —
 * was `aria-disabled="true"`. The row's checkbox, its Edit button and its
 * actions all sit in that cell, and read as disabled to assistive tech (and to
 * Playwright, which refused to click them).
 */

jest.mock("react-use-measure", () => {
    return () => [
        () => undefined,
        { width: 1000, height: 540, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }
    ];
});

Element.prototype.scrollTo = function () { /* nothing laid out */ };

global.ResizeObserver = class ResizeObserver {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
};

type Row = { id: string; name: string };
const columns: VirtualTableColumn[] = [
    { key: "id", title: "Id", width: 120, frozen: true },
    { key: "name", title: "Name", width: 200 }
];

describe("VirtualTable — reorderable columns", () => {

    it("leaves the cells' own controls enabled, in the frozen column too", async () => {
        await act(async () => {
            render(<VirtualTable<Row> data={[{ id: "r1", name: "One" }]}
                columns={columns}
                onColumnsOrderChange={() => undefined}
                cellRenderer={({ column, rowData }) =>
                    <button type={"button"}>{`${column.key}:${rowData?.id}`}</button>}/>);
        });

        const edit = screen.getByRole("button", { name: "id:r1" });
        expect(edit.closest("[aria-disabled=\"true\"]")).toBeNull();
        expect(edit.parentElement?.closest("[role=\"button\"]")).toBeNull();
        expect(screen.getByRole("button", { name: "name:r1" }).parentElement?.closest("[role=\"button\"]")).toBeNull();
    });
});
