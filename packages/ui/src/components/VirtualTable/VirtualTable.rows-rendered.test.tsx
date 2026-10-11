/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { VirtualTable } from "./VirtualTable";
import { CellRendererParams, VirtualTableColumn } from "./VirtualTableProps";

/**
 * The table says which rows are on screen (`onRowsRendered`), so the
 * collection view can keep those current under realtime instead of every row
 * it holds; and a position holding `undefined` — a row that exists but has not
 * been read — is drawn with no `rowData`, for the renderer to show a
 * placeholder.
 */

jest.mock("react-use-measure", () => {
    return () => [
        () => undefined,
        { width: 1000, height: 540, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }
    ];
});

// jsdom has no scrolling: the table's scroll to `initialScroll` is a no-op.
Element.prototype.scrollTo = function () { /* nothing laid out */ };

global.ResizeObserver = class ResizeObserver {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
};

type Row = { name: string };
const columns: VirtualTableColumn[] = [{ key: "name", title: "Name", width: 200 }];
const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ name: `row ${i}` }));
const ROW_HEIGHT = 54;

describe("VirtualTable — the rows on screen", () => {

    it("reports the rows on screen, not the ones drawn ahead of them", async () => {
        const ranges: { start: number; end: number }[] = [];
        await act(async () => {
            render(<VirtualTable<Row> data={rows(1_000)}
                columns={columns}
                rowHeight={ROW_HEIGHT}
                cellRenderer={() => <span>cell</span>}
                onRowsRendered={(range) => ranges.push(range)}/>);
        });
        expect(ranges[0].start).toBe(0);
        // 540px of list at 54px a row: 10 rows, the overscan not counted.
        expect(ranges[0].end).toBeLessThanOrEqual(11);
        expect(ranges[ranges.length - 1].end).toBeLessThanOrEqual(11);
    });

    it("on its way to `initialScroll`, reports the rows there, not the top rows it draws first", async () => {
        const ranges: { start: number; end: number }[] = [];
        await act(async () => {
            render(<VirtualTable<Row> data={rows(1_000)}
                columns={columns}
                rowHeight={ROW_HEIGHT}
                initialScroll={500 * ROW_HEIGHT}
                cellRenderer={() => <span>cell</span>}
                onRowsRendered={(range) => ranges.push(range)}/>);
        });
        expect(ranges.length).toBeGreaterThan(0);
        expect(ranges.every(range => range.start >= 500)).toBe(true);
    });

    it("draws a row not read yet with no rowData", async () => {
        const data: (Row | undefined)[] = rows(5);
        data[2] = undefined;
        const seen: (Row | undefined)[] = [];
        await act(async () => {
            render(<VirtualTable<Row> data={data}
                columns={columns}
                rowHeight={ROW_HEIGHT}
                cellRenderer={({ rowData }: CellRendererParams<Row>) => {
                    seen.push(rowData);
                    return <span>{rowData?.name ?? "placeholder"}</span>;
                }}/>);
        });
        expect(seen).toContain(undefined);
        expect(seen.filter(Boolean).map(row => row!.name)).toEqual(expect.arrayContaining(["row 0", "row 1", "row 3", "row 4"]));
    });
});
