/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { act, render } from "@testing-library/react";
import { getRowHeight } from "@rebasepro/app";

/**
 * A table cell taller than its row fades out at the bottom (or scrolls, where
 * the binding allows it). Every cell is measured by one shared observer; this
 * drives that observer by hand, since jsdom lays nothing out.
 */

type Entry = { target: Element; contentRect: { height: number } };
const observed = new Set<Element>();
let deliver: ((entries: Entry[]) => void) | undefined;
let observersCreated = 0;

class ManualResizeObserver {
    constructor(callback: (entries: Entry[]) => void) {
        observersCreated++;
        deliver = callback;
    }
    observe(element: Element) { observed.add(element); }
    unobserve(element: Element) { observed.delete(element); }
    disconnect() { observed.clear(); }
}
Object.defineProperty(globalThis, "ResizeObserver", { value: ManualResizeObserver, configurable: true, writable: true });

import { EntityTableCell, measuredTableCellCount } from "../../src/components/CollectionTableBinding/internal/EntityTableCell";

function resize(height: number) {
    act(() => deliver!(Array.from(observed).map(target => ({ target, contentRect: { height } }))));
}

const faded = (container: HTMLElement) => Boolean(container.querySelector(".items-start"));

describe("a table cell taller than its row", () => {

    it("fades when its content outgrows the row, and stops when it fits again", () => {
        const { container, unmount } = render(<EntityTableCell size={"m"} width={200} align={"left"} disabled={false} value={"x"}>
            <span>content</span>
        </EntityTableCell>);
        expect(faded(container)).toBe(false);

        resize(getRowHeight("m") + 40);
        expect(faded(container)).toBe(true);

        resize(getRowHeight("m") - 10);
        expect(faded(container)).toBe(false);
        unmount();
    });

    it("is measured by one observer however many cells there are, and let go when it unmounts", () => {
        const before = observersCreated;
        const { unmount } = render(<>
            {Array.from({ length: 50 }, (_, i) =>
                <EntityTableCell key={i} size={"s"} width={100} align={"left"} disabled={false} value={i}>
                    <span>{i}</span>
                </EntityTableCell>)}
        </>);
        expect(measuredTableCellCount()).toBe(50);
        expect(observersCreated - before).toBeLessThanOrEqual(1);

        unmount();
        expect(measuredTableCellCount()).toBe(0);
        expect(observed.size).toBe(0);
    });
});
