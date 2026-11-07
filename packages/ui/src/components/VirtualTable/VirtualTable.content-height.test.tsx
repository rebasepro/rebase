/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { VirtualTable } from "./VirtualTable";
import { VirtualTableColumn } from "./VirtualTableProps";

/**
 * A table in a parent that gives it no height — a page, a panel with only a
 * max-height — is as tall as its header and rows; in one that does, it fills
 * it or scrolls inside it. The height it asks for is its flex basis, capped
 * at the parent's.
 */

let measuredWidth = 1000;
jest.mock("react-use-measure", () => {
    return () => [
        () => undefined,
        { width: measuredWidth, height: 0, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }
    ];
});

Element.prototype.scrollTo = function () { /* nothing laid out */ };

global.ResizeObserver = class ResizeObserver {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
};

type Row = { name: string };
const columns: VirtualTableColumn[] = [{ key: "name", title: "Name", width: 200 }];
const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ name: `row ${i}` }));

async function rootOf(element: React.ReactElement): Promise<HTMLElement> {
    let container!: HTMLElement;
    await act(async () => {
        container = render(element).container;
    });
    return container.firstElementChild as HTMLElement;
}

describe("VirtualTable — the height it asks for", () => {
    beforeEach(() => {
        measuredWidth = 1000;
    });

    it("is its header and its rows, for a short table", async () => {
        const root = await rootOf(<VirtualTable<Row> data={rows(3)} columns={columns} rowHeight={54} headerHeight={40}
            cellRenderer={() => <span>cell</span>}/>);
        expect(root.style.height).toBe(`${40 + 3 * 54}px`);
        // Never more than a parent of definite height has.
        expect(root.style.maxHeight).toBe("100%");
    });

    it("keeps room for the empty view when there are no rows", async () => {
        const root = await rootOf(<VirtualTable<Row> data={[]} columns={columns} rowHeight={54} headerHeight={40}
            emptyComponent={<span>Nothing here</span>} cellRenderer={() => <span>cell</span>}/>);
        expect(parseFloat(root.style.height)).toBeGreaterThan(40 + 54);
    });

    it("leaves room for a horizontal scrollbar where the columns overflow", async () => {
        measuredWidth = 150;
        const root = await rootOf(<VirtualTable<Row> data={rows(2)} columns={columns} rowHeight={54} headerHeight={40}
            cellRenderer={() => <span>cell</span>}/>);
        expect(parseFloat(root.style.height)).toBeGreaterThan(40 + 2 * 54);
    });

    it("grows into a parent with a height, and shrinks to one", async () => {
        const root = await rootOf(<VirtualTable<Row> data={rows(3)} columns={columns}
            cellRenderer={() => <span>cell</span>}/>);
        expect(root.className).toContain("grow");
        expect(root.className).toContain("min-h-0");
    });
});
