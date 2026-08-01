/**
 * @jest-environment jsdom
 */
import React from "react";
import { render } from "@testing-library/react";
import { VirtualTable } from "./VirtualTable";
import { VirtualTableProps } from "./VirtualTableProps";

// Counts executions of the row component body. The real VirtualTableRow is
// swapped for a memoized stub so the count reflects React's bail-out decision
// and nothing else.
const renderCallback = jest.fn();
jest.mock("./VirtualTableRow", () => {
    const React = require("react");
    // Memoized like the real component: without this the stub would re-render
    // on any parent render and the count would say nothing about the context.
    const VirtualTableRow = React.memo((props: any) => {
        renderCallback();
        return <div data-testid="row">{props.children}</div>;
    });
    VirtualTableRow.displayName = "VirtualTableRow";
    return { VirtualTableRow };
});

// Fixed bounds: the real hook measures nothing in jsdom, so the list would
// render zero rows.
jest.mock("react-use-measure", () => {
    return () => [
        (element: any) => {},
        { width: 500,
height: 500,
top: 0,
left: 0,
bottom: 0,
right: 0,
x: 0,
y: 0 }
    ];
});

// jsdom has no ResizeObserver, and VirtualTable passes the global in as the
// `react-use-measure` polyfill — the identifier has to resolve even though the
// mock above means it is never constructed.
global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
};

describe("VirtualTable Performance", () => {

    beforeEach(() => {
        renderCallback.mockClear();
    });

    it("does not re-render rows when VirtualTable re-renders but data is unchanged", async () => {
        const columns = [{ key: "col1",
title: "Column 1",
width: 100 }];
        const data = Array.from({ length: 10 }).map((_, i) => ({ col1: `Value ${i}` }));
        const cellRenderer = () => <div>Cell</div>;

        const props: VirtualTableProps<any> = {
            data,
            columns,
            rowHeight: 50,
            cellRenderer
        };

        const { rerender } = render(<VirtualTable {...props}
            className={"a"}/>);

        const initialRenderCount = renderCallback.mock.calls.length;
        expect(initialRenderCount).toBe(data.length);

        // `className` is deliberately NOT one of the context memo's dependencies:
        // changing it forces VirtualTable's body to run again (React.memo on the
        // table itself would otherwise bail out) while every value the rows read
        // stays identical.
        rerender(<VirtualTable {...props}
            className={"b"}/>);

        // Rows read everything through VirtualListContext, and the value handed
        // to the provider is memoized. If that memo goes away the provider gets a
        // fresh object, every Consumer re-runs, and each one hands the row a new
        // `style` object and a new children array — which defeats React.memo and
        // re-renders all 10 rows. So an unchanged count is the whole assertion.
        expect(renderCallback.mock.calls.length).toBe(initialRenderCount);
    });
});
