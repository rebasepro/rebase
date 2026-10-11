import React from "react";
import { act, render } from "@testing-library/react";
import { CardView } from "../src/views/CardView";

/**
 * The card grid draws the rows of cards on screen and a couple either side,
 * placing them with the heights the rows actually have — cards are not one
 * height, and the grid must look as it did when every card was mounted.
 *
 * jsdom lays nothing out, so the layout is described here: a 600px scroll
 * parent, the rows box below a 100px header, and rows whose height depends on
 * the row (as cards with longer subtitles make a taller row).
 */

type Item = { id: string; name: string };

const items = (n: number): Item[] => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Card ${i}` }));

const rowHeight = (row: number) => 200 + (row % 3) * 50;

let observers: ResizeObserverMock[] = [];
class ResizeObserverMock {
    elements = new Set<Element>();
    constructor(private callback: ResizeObserverCallback) {
        observers.push(this);
    }
    observe(element: Element) { this.elements.add(element); }
    unobserve(element: Element) { this.elements.delete(element); }
    disconnect() { this.elements.clear(); }
    /** Report every observed element, as a layout pass would. */
    fire() {
        const entries = Array.from(this.elements).map(target => ({ target }) as unknown as ResizeObserverEntry);
        this.callback(entries, this as unknown as ResizeObserver);
    }
}

let scroller: HTMLDivElement;
let scrollTop = 0;
const originalRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
    observers = [];
    scrollTop = 0;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverMock;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
        const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 1000, width: 1000, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
        if (this === scroller) return rect(0, 600);
        if (this.dataset.row !== undefined) return rect(0, rowHeight(Number(this.dataset.row)));
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

async function measure() {
    await act(async () => {
        observers.forEach(observer => observer.fire());
    });
}

/** Scroll down in steps, measuring the rows drawn at each, as a user would. */
async function scrollThrough(to: number) {
    for (let offset = 0; offset <= to; offset += 300) {
        await scrollTo(offset);
        await measure();
    }
    await scrollTo(to);
}

function mount(data: (Item | undefined)[], onRowsRendered?: (range: { start: number; end: number }) => void) {
    const rendered: string[] = [];
    let view!: ReturnType<typeof render>;
    act(() => {
        view = render(
            <div ref={(el) => { if (el) scroller = el; }} style={{ overflowY: "auto", height: 600 }}>
                <CardView<Item>
                    data={data}
                    paginationEnabled={false}
                    onRowsRendered={onRowsRendered}
                    renderCard={(item) => {
                        rendered.push(item.id);
                        return <div data-card={item.id}>{item.name}</div>;
                    }}/>
            </div>
        );
    });
    return { view, rendered };
}

describe("CardView, drawn by rows", () => {

    it("draws the rows on screen and two either side, whatever is loaded", async () => {
        const { view } = mount(items(2_000));
        await scrollTo(0);
        // 5 columns at jsdom's 1024px; 600px of rows from 200px tall → rows 0–3, +2 below.
        const cards = view.container.querySelectorAll("[data-card]");
        expect(cards.length).toBeLessThanOrEqual(6 * 5);
        expect(cards.length).toBeGreaterThanOrEqual(3 * 5);
        expect(view.container.querySelectorAll("*").length).toBeLessThan(500);
    });

    it("places the rows with their measured heights", async () => {
        const { view } = mount(items(600));
        await scrollThrough(3_000);

        const drawn = Array.from(view.container.querySelectorAll<HTMLElement>("[data-row]"));
        const first = Number(drawn[0].dataset.row);
        const block = drawn[0].parentElement!;
        // The block's top is the rows above it, each as tall as it measured —
        // not as tall as a guess.
        let expected = 0;
        for (let r = 0; r < first; r++) expected += rowHeight(r);
        expect(Number.parseFloat(block.style.top)).toBeCloseTo(expected, 0);
        // The rows on screen are the ones 2,900–3,500px into the rows (the
        // box starts 100px down): rows 11–14, every three rows being 750px.
        expect(first).toBeLessThanOrEqual(11);
        expect(Number(drawn[drawn.length - 1].dataset.row)).toBeGreaterThanOrEqual(14);
    });

    it("says which cards are on screen as it scrolls", async () => {
        const ranges: { start: number; end: number }[] = [];
        mount(items(600), (range) => ranges.push(range));
        await scrollTo(0);
        // 5 columns; the rows box starts 100px down, so 500px of rows are on
        // screen: rows 0 (200px), 1 (250px) and 2 (from 450px).
        expect(ranges[ranges.length - 1]).toEqual({ start: 0, end: 15 });

        await scrollThrough(3_000);
        // 2,900–3,500px into the rows: rows 11–14 (every three rows are 750px).
        expect(ranges[ranges.length - 1]).toEqual({ start: 55, end: 75 });
    });

    it("draws a placeholder for a card not read yet, without asking for it", async () => {
        const data: (Item | undefined)[] = items(10);
        data[3] = undefined;
        const { view, rendered } = mount(data);
        await scrollTo(0);
        expect(rendered).not.toContain(undefined);
        expect(view.container.querySelectorAll("[data-card]").length).toBe(9);
        expect(view.container.querySelectorAll("[aria-busy=\"true\"]").length).toBe(1);
    });
});
