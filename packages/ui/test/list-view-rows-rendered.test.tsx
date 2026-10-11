import React from "react";
import { act, render } from "@testing-library/react";
import { ListView } from "../src/views/ListView";

/**
 * The list says which rows are on screen, so a caller can keep those current
 * rather than every row it holds; and it draws a placeholder for a row that
 * exists but has not been read, without handing it to `renderRow`.
 *
 * jsdom lays nothing out, so the layout is described: a 600px scroll parent
 * and the rows box below a 100px header.
 */

type Item = { id: string; name: string };
const items = (n: number): Item[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));

let scroller: HTMLDivElement;
let scrollTop = 0;
const originalRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
    scrollTop = 0;
    if (typeof globalThis.ResizeObserver === "undefined") {
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
            observe() { /* nothing laid out */ }
            unobserve() { /* nothing laid out */ }
            disconnect() { /* nothing laid out */ }
        };
    }
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
        const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 1000, width: 1000, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
        if (this === scroller) return rect(0, 600);
        if (this.style.position === "relative" && this.style.height) return rect(100 - scrollTop, Number.parseFloat(this.style.height));
        return rect(0, 0);
    };
});

afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
});

async function scrollTo(offset: number) {
    scrollTop = offset;
    Object.defineProperty(scroller, "scrollTop", { value: offset, configurable: true });
    await act(async () => {
        scroller.dispatchEvent(new Event("scroll"));
        await new Promise(resolve => setTimeout(resolve, 30));
    });
}

function mount(data: (Item | undefined)[], onRowsRendered?: (range: { start: number; end: number }) => void) {
    const rendered: string[] = [];
    let view!: ReturnType<typeof render>;
    act(() => {
        view = render(
            <div ref={(el) => { if (el) scroller = el; }} style={{ overflowY: "auto", height: 600 }}>
                <ListView<Item>
                    data={data}
                    size={"m"}
                    paginationEnabled={false}
                    onRowsRendered={onRowsRendered}
                    renderRow={({ item, style }) => {
                        rendered.push(item.id);
                        return <div key={item.id} style={style} data-item={item.id}>{item.name}</div>;
                    }}/>
            </div>
        );
    });
    return { view, rendered };
}

describe("ListView", () => {

    it("says which rows are on screen as it scrolls", async () => {
        const ranges: { start: number; end: number }[] = [];
        mount(items(1_000), (range) => ranges.push(range));
        await scrollTo(0);
        // 64px rows ("m"); the rows box starts 100px down.
        expect(ranges[ranges.length - 1]).toEqual({ start: 0, end: 8 });

        await scrollTo(6_500);
        // 6,400px into the rows: row 100, and 600px of rows after it.
        expect(ranges[ranges.length - 1]).toEqual({ start: 100, end: 110 });
    });

    it("draws a placeholder for a row not read yet, without asking for it", async () => {
        const data: (Item | undefined)[] = items(10);
        data[3] = undefined;
        const { view, rendered } = mount(data);
        await scrollTo(0);
        expect(rendered).not.toContain(undefined);
        expect(view.container.querySelectorAll("[data-item]").length).toBe(9);
        expect(view.container.querySelectorAll("[aria-busy=\"true\"]").length).toBe(1);
    });
});
