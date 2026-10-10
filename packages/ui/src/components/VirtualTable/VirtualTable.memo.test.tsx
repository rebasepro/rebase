/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { VirtualTable } from "./VirtualTable";
import { CellRendererParams, VirtualTableColumn } from "./VirtualTableProps";

// Fixed bounds: jsdom measures nothing, so the list would render zero rows.
jest.mock("react-use-measure", () => {
    return () => [
        () => undefined,
        { width: 1000, height: 500, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }
    ];
});

// VirtualTable hands the global to `react-use-measure` as its polyfill.
global.ResizeObserver = class ResizeObserver {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
};

type Row = { id: string; values: Record<string, unknown> };

const ROW_HEIGHT = 50;

function buildRow(i: number): Row {
    const values: Record<string, unknown> = {};
    for (let p = 0; p < 10; p++) values[`text_${p}`] = `Row ${i} text ${p}`;
    return { id: `id_${i}`, values };
}

/**
 * A copy of `rows` whose every object is new and deep-equal to the original —
 * what a realtime frame decodes to — and which records which rows anything read.
 */
function instrumentedCopy(rows: Row[], touched: Set<number>): Row[] {
    return rows.map((row, i) => new Proxy({ ...row, values: { ...row.values } }, {
        get(target, key, receiver) {
            touched.add(i);
            return Reflect.get(target, key, receiver);
        },
        ownKeys(target) {
            touched.add(i);
            return Reflect.ownKeys(target);
        }
    }));
}

const columns: VirtualTableColumn[] = [
    { key: "id", title: "ID", width: 100 },
    { key: "values", title: "Values", width: 200 }
];

describe("VirtualTable memoisation", () => {

    it("a new data array with nothing changed reads the rows on screen, not every row held", () => {
        const held = 2000;
        const rows = Array.from({ length: held }, (_, i) => buildRow(i));
        const cellRenderer = ({ rowData }: CellRendererParams<Row>) => <span>{rowData?.id}</span>;

        const { rerender } = render(<VirtualTable data={rows}
            columns={columns}
            rowHeight={ROW_HEIGHT}
            cellRenderer={cellRenderer}/>);

        const touched = new Set<number>();
        const pushed = instrumentedCopy(rows, touched);
        rerender(<VirtualTable data={pushed}
            columns={columns}
            rowHeight={ROW_HEIGHT}
            cellRenderer={cellRenderer}/>);

        // 500px / 50px = 10 rows on screen, plus react-window's overscan of 4.
        // Comparing the whole array deeply read all 2,000.
        expect(touched.size).toBeGreaterThan(0);
        expect(touched.size).toBeLessThanOrEqual(20);
    });

    it("a cell renders with the cellRenderer it is given now, not the first one", () => {
        const rows = Array.from({ length: 5 }, (_, i) => buildRow(i));
        const first = ({ rowData, column }: CellRendererParams<Row>) =>
            column.key === "id" ? <span data-testid={`cell-${rowData?.id}`}>first {rowData?.id}</span> : null;
        const second = ({ rowData, column }: CellRendererParams<Row>) =>
            column.key === "id" ? <span data-testid={`cell-${rowData?.id}`}>second {rowData?.id}</span> : null;

        const { rerender, getByTestId } = render(<VirtualTable data={rows}
            columns={columns}
            rowHeight={ROW_HEIGHT}
            cellRenderer={first}/>);
        expect(getByTestId("cell-id_0").textContent).toBe("first id_0");

        rerender(<VirtualTable data={rows}
            columns={columns}
            rowHeight={ROW_HEIGHT}
            cellRenderer={second}/>);
        expect(getByTestId("cell-id_0").textContent).toBe("second id_0");
    });

    it("a cell sees the columns it is given now", () => {
        const rows = Array.from({ length: 5 }, (_, i) => buildRow(i));
        const cellRenderer = ({ rowData, column, columns }: CellRendererParams<Row>) =>
            column.key === "id" ? <span data-testid={`cell-${rowData?.id}`}>{columns.length} columns</span> : null;

        const { rerender, getByTestId } = render(<VirtualTable data={rows}
            columns={columns}
            rowHeight={ROW_HEIGHT}
            cellRenderer={cellRenderer}/>);
        expect(getByTestId("cell-id_0").textContent).toBe("2 columns");

        rerender(<VirtualTable data={rows}
            columns={[...columns, { key: "extra", title: "Extra", width: 100 }]}
            rowHeight={ROW_HEIGHT}
            cellRenderer={cellRenderer}/>);
        expect(getByTestId("cell-id_0").textContent).toBe("3 columns");
    });

    it("a parent re-render with equal props renders no cell, and a changed row renders only its own cells", async () => {
        const rows = Array.from({ length: 50 }, (_, i) => buildRow(i));
        const renderedRows: string[] = [];
        const cellRenderer = ({ rowData }: CellRendererParams<Row>) => {
            renderedRows.push(String(rowData?.id));
            return <span>{rowData?.id}</span>;
        };
        const Harness = ({ data, tick }: { data: Row[]; tick: number }) =>
            <div data-tick={tick}>
                <VirtualTable data={data}
                    columns={columns.map(c => ({ ...c }))}
                    rowHeight={ROW_HEIGHT}
                    cellRenderer={cellRenderer}/>
            </div>;

        const { rerender } = render(<Harness data={rows} tick={0}/>);
        renderedRows.length = 0;

        // New column objects, equal by value: nothing to draw again.
        await act(async () => rerender(<Harness data={rows} tick={1}/>));
        expect(renderedRows).toEqual([]);

        // One row edited, the rest the same objects.
        const edited = rows.slice();
        edited[2] = { ...rows[2], values: { ...rows[2].values, text_0: "edited" } };
        await act(async () => rerender(<Harness data={edited} tick={2}/>));
        expect(renderedRows).toEqual(["id_2", "id_2"]);
    });
});
