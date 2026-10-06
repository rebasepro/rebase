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

import { ArrayContainer } from "../../src/components/ArrayContainer";

function Harness({ value, tick }: { value: unknown[], tick: number }) {
    return <ArrayContainer droppableId="items"
        addLabel="Add"
        value={value}
        buildEntry={({ index }) => <span data-tick={tick}>{index}</span>}
        newDefaultEntry={null}
        onValueChange={() => undefined}
        sortable={false}
        canAddElements={false}/>;
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

    it("keeps one id per item, duplicates included", () => {
        const value = ["a", "b", "a", "c", "a"];
        const { container } = render(<Harness value={value} tick={0}/>);
        expect(container.querySelectorAll("span[data-tick]").length).toBe(5);
    });
});
