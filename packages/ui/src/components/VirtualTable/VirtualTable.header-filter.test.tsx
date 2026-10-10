/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { VirtualTable } from "./VirtualTable";
import { VirtualTableColumn, VirtualTableFilterValues } from "./VirtualTableProps";

jest.mock("react-use-measure", () => {
    return () => [
        () => undefined,
        { width: 1000, height: 500, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }
    ];
});

global.ResizeObserver = class ResizeObserver {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
};

const columns: VirtualTableColumn[] = [
    { key: "name", title: "Name", width: 200, filter: true }
];
const data = [{ name: "a" }, { name: "b" }];
const cellRenderer = () => <span>cell</span>;
const createFilterField = () => <input aria-label="filter value"/>;

/** The dot on the column's filter button: drawn while a filter is applied to it. */
function filterBadgeShown(container: HTMLElement) {
    const dot = container.querySelector("#virtual-table span.rounded-full.absolute");
    if (!dot) throw new Error("no filter badge in the header");
    return dot.className.includes("w-2");
}

describe("the table header's filter state", () => {
    it("shows the filter it was given in the same render, not the one before", async () => {
        const onFilterUpdate = () => undefined;
        const Table = ({ filter }: { filter?: VirtualTableFilterValues<string> }) =>
            <VirtualTable data={data}
                columns={columns}
                cellRenderer={cellRenderer}
                createFilterField={createFilterField}
                onFilterUpdate={onFilterUpdate}
                filter={filter}/>;

        const { container, rerender } = render(<Table/>);
        expect(filterBadgeShown(container)).toBe(false);

        await act(async () => rerender(<Table filter={{ name: ["==", "a"] }}/>));
        expect(filterBadgeShown(container)).toBe(true);

        await act(async () => rerender(<Table filter={undefined}/>));
        expect(filterBadgeShown(container)).toBe(false);
    });
});
