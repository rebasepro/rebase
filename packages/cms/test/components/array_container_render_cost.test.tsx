/**
 * @jest-environment jsdom
 */
/**
 * An array field's item ids are assigned once, at mount.
 *
 * `useRef(buildIdsMap(value))` evaluated its argument on every render and threw
 * the result away: every re-render of an array field — and in a record form
 * that was every keystroke anywhere — hashed every item (object-hash for
 * anything without an `id`) and merged the results with a quadratic spread.
 * 2,000 items cost ~350 ms per render.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";

const mockHashCalls = { count: 0 };
jest.mock("@rebasepro/utils", () => {
    const actual = jest.requireActual("@rebasepro/utils") as Record<string, unknown> & {
        getHashValue: (v: unknown) => string | null
    };
    return {
        ...actual,
        getHashValue: (v: unknown) => {
            mockHashCalls.count++;
            return actual.getHashValue(v);
        }
    };
});

jest.mock("@rebasepro/app", () => {
    const actual = jest.requireActual("@rebasepro/app") as Record<string, unknown>;
    return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

// Each item's options button is drawn inside one Tooltip: counting Tooltip
// renders counts item-chrome renders.
const mockTooltipRenders = { count: 0 };
jest.mock("@rebasepro/ui", () => {
    const actual = jest.requireActual("@rebasepro/ui") as Record<string, unknown> & {
        Tooltip: React.ComponentType<Record<string, unknown>>
    };
    const mockReact = jest.requireActual("react") as typeof React;
    return {
        ...actual,
        Tooltip: (props: Record<string, unknown>) => {
            mockTooltipRenders.count++;
            return mockReact.createElement(actual.Tooltip, props);
        }
    };
});

import { ArrayContainer } from "../../src/components/ArrayContainer";

function Harness({ value, tick, sortable = false, canAddElements = false }: {
    value: unknown[],
    tick: number,
    sortable?: boolean,
    canAddElements?: boolean
}) {
    return <ArrayContainer droppableId="items"
        addLabel="Add"
        value={value}
        // A new builder per render, as RepeatFieldBinding passes one.
        buildEntry={({ index }) => <span data-tick={tick}>{index}</span>}
        newDefaultEntry={null}
        onValueChange={() => undefined}
        sortable={sortable}
        canAddElements={canAddElements}/>;
}

/** Count `mousedown` listeners added to and removed from `document` while `run` runs. */
function countDocumentListeners(run: () => void): { added: number, removed: number } {
    const counts = { added: 0, removed: 0 };
    const add = jest.spyOn(document, "addEventListener").mockName("add");
    const remove = jest.spyOn(document, "removeEventListener").mockName("remove");
    try {
        run();
        counts.added = add.mock.calls.filter(([type]) => type === "mousedown").length;
        counts.removed = remove.mock.calls.filter(([type]) => type === "mousedown").length;
    } finally {
        add.mockRestore();
        remove.mockRestore();
    }
    return counts;
}

describe("ArrayContainer", () => {

    it("hashes its items at mount and not again on a re-render with the same value", () => {
        const value = Array.from({ length: 2000 }, (_, i) => ({ label: "item " + i, n: i }));

        mockHashCalls.count = 0;
        const { rerender, container } = render(<Harness value={value} tick={0}/>);
        // If this is 0 the module no longer hashes through `@rebasepro/utils`
        // and the assertion below proves nothing: point the mock at it.
        expect(mockHashCalls.count).toBeGreaterThanOrEqual(2000);
        expect(container.querySelectorAll("span[data-tick]").length).toBe(2000);

        mockHashCalls.count = 0;
        for (let tick = 1; tick <= 10; tick++) {
            act(() => {
                rerender(<Harness value={value} tick={tick}/>);
            });
        }
        expect(mockHashCalls.count).toBe(0);
        expect(container.querySelectorAll("span[data-tick='10']").length).toBe(2000);
    });

    it("does not re-draw or re-subscribe each item's options on a re-render", () => {
        const value = Array.from({ length: 500 }, (_, i) => ({ id: "x" + i }));
        let listeners = { added: 0, removed: 0 };

        mockTooltipRenders.count = 0;
        let rerender: (ui: React.ReactElement) => void = () => undefined;
        listeners = countDocumentListeners(() => {
            rerender = render(<Harness value={value} tick={0} sortable={true} canAddElements={true}/>).rerender;
        });
        expect(mockTooltipRenders.count).toBeGreaterThanOrEqual(500);
        // A closed menu listens to nothing.
        expect(listeners.added).toBe(0);

        mockTooltipRenders.count = 0;
        listeners = countDocumentListeners(() => {
            for (let tick = 1; tick <= 5; tick++) {
                act(() => {
                    rerender(<Harness value={value} tick={tick} sortable={true} canAddElements={true}/>);
                });
            }
        });
        expect(listeners).toEqual({ added: 0, removed: 0 });
        expect(mockTooltipRenders.count).toBe(0);
        // The entries themselves are still built with the latest builder.
        expect(document.querySelectorAll("span[data-tick='5']").length).toBe(500);
    });

    it("keeps one id per item, duplicates included", () => {
        const value = ["a", "b", "a", "c", "a"];
        const { container } = render(<Harness value={value} tick={0}/>);
        expect(container.querySelectorAll("span[data-tick]").length).toBe(5);
    });
});
