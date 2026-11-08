import React, { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SPLIT_VIEW_MIN_WIDTH, SplitView, UiLabelsProvider } from "../src";

/**
 * `SplitView` chooses its layout from its own width, never the window: side
 * by side when its container is wide, a drill-down with a back bar when it is
 * narrow. jsdom lays nothing out, so the container's width is whatever the
 * test says, and a resize is the ResizeObserver callback fired by hand.
 */
describe("SplitView", () => {
    let containerWidth = 1000;
    const observers: { callback: ResizeObserverCallback; observer: ResizeObserver; target?: Element }[] = [];

    beforeEach(() => {
        observers.length = 0;
        Object.assign(globalThis, {
            ResizeObserver: class implements ResizeObserver {
                private readonly record: { callback: ResizeObserverCallback; observer: ResizeObserver; target?: Element };
                constructor(callback: ResizeObserverCallback) {
                    this.record = { callback, observer: this };
                    observers.push(this.record);
                }
                observe(target: Element) {
                    this.record.target = target;
                }
                unobserve() { /* nothing to stop */ }
                disconnect() { /* nothing to stop */ }
            }
        });
        jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(containerWidth));
    });
    afterEach(() => jest.restoreAllMocks());

    function rect(width: number): DOMRect {
        return { x: 0, y: 0, top: 0, left: 0, bottom: 600, right: width, width, height: 600, toJSON: () => ({}) };
    }

    function resizeTo(width: number) {
        containerWidth = width;
        act(() => {
            for (const { callback, observer, target } of observers) {
                if (!target) continue;
                const size = { inlineSize: width, blockSize: 600 };
                callback([{
                    target,
                    contentRect: rect(width),
                    borderBoxSize: [size],
                    contentBoxSize: [size],
                    devicePixelContentBoxSize: [size]
                }], observer);
            }
        });
    }

    const master = <ul aria-label="Orders"><li><button>Order 1</button></li></ul>;

    it("puts master and detail side by side when its container is wide", () => {
        containerWidth = SPLIT_VIEW_MIN_WIDTH;
        render(<SplitView master={master} detail={<p>Order 1 details</p>} detailTitle="Order #1" onClearSelection={jest.fn()}/>);
        expect(screen.getByRole("list", { name: "Orders" })).toBeInTheDocument();
        expect(screen.getByText("Order 1 details")).toBeInTheDocument();
        expect(screen.getByRole("separator", { name: "Resize the list" })).toBeInTheDocument();
        // Nothing covers the master, so there is nothing to go back from.
        expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
        expect(screen.getByRole("list", { name: "Orders" }).parentElement).not.toHaveClass("invisible");
    });

    it("drills down when its container is narrow: the detail covers the master under a back bar", () => {
        containerWidth = 400;
        const onClearSelection = jest.fn();
        const { rerender } = render(<SplitView master={master} detail={<p>Order 1 details</p>} detailTitle="Order #1" onClearSelection={onClearSelection}/>);
        expect(screen.getByText("Order 1 details")).toBeInTheDocument();
        expect(screen.getByText("Order #1")).toBeInTheDocument();
        expect(screen.queryByRole("separator")).not.toBeInTheDocument();
        // Covered, the master is hidden — out of the tab order — but still mounted.
        expect(screen.getByRole("list", { name: "Orders", hidden: true }).parentElement).toHaveClass("invisible");

        fireEvent.click(screen.getByRole("button", { name: "Back" }));
        expect(onClearSelection).toHaveBeenCalledTimes(1);

        rerender(<SplitView master={master} detail={null} onClearSelection={onClearSelection}/>);
        expect(screen.getByRole("list", { name: "Orders" }).parentElement).not.toHaveClass("invisible");
        expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
        expect(screen.queryByText("Order 1 details")).not.toBeInTheDocument();
    });

    it("shows the master alone when there is no detail", () => {
        containerWidth = 1000;
        render(<SplitView master={master} detail={false}/>);
        expect(screen.getByRole("list", { name: "Orders" })).toBeInTheDocument();
        expect(screen.queryByRole("separator")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    });

    it("has no back button without onClearSelection", () => {
        containerWidth = 400;
        render(<SplitView master={master} detail={<p>Order 1 details</p>} detailTitle="Order #1"/>);
        expect(screen.getByText("Order #1")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    });

    it("shows the detail only while something is selected, when told what is", () => {
        containerWidth = 1000;
        const { rerender } = render(<SplitView master={master} selected={null} detail={<p>Order details</p>}/>);
        expect(screen.queryByText("Order details")).not.toBeInTheDocument();

        rerender(<SplitView master={master} selected={{ id: "o1" }} detail={<p>Order details</p>}/>);
        expect(screen.getByText("Order details")).toBeInTheDocument();
    });

    it("follows its container across the switch without remounting either pane", () => {
        containerWidth = 1000;
        const mounts = { master: 0, detail: 0 };
        function Counted({ name }: { name: "master" | "detail" }) {
            useEffect(() => {
                mounts[name]++;
            }, [name]);
            return <p>{name}</p>;
        }
        render(<SplitView master={<Counted name="master"/>} detail={<Counted name="detail"/>} onClearSelection={jest.fn()}/>);
        expect(screen.getByRole("separator")).toBeInTheDocument();

        resizeTo(500);
        expect(screen.queryByRole("separator")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();

        resizeTo(1200);
        expect(screen.getByRole("separator")).toBeInTheDocument();
        expect(mounts).toEqual({ master: 1, detail: 1 });
    });

    it("reports the divider's moves, and says which arrangement it is in", () => {
        containerWidth = 1000;
        const onMasterPercentChange = jest.fn();
        const { container } = render(
            <SplitView master={master} detail={<p>details</p>} defaultMasterPercent={40}
                onMasterPercentChange={onMasterPercentChange}/>);
        expect(container.firstElementChild).toHaveAttribute("data-layout", "split");

        fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
        expect(onMasterPercentChange).toHaveBeenLastCalledWith(42);
        expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "42");

        resizeTo(500);
        expect(container.firstElementChild).toHaveAttribute("data-layout", "stacked");
    });

    it("moves focus from the chosen row to the back button when the detail covers the master", () => {
        containerWidth = 400;
        const { rerender } = render(<SplitView master={master} onClearSelection={jest.fn()}/>);
        screen.getByRole("button", { name: "Order 1" }).focus();
        rerender(<SplitView master={master} detail={<p>Order 1 details</p>} onClearSelection={jest.fn()}/>);
        expect(screen.getByRole("button", { name: "Back" })).toHaveFocus();
    });

    it("names the back button and the divider from the kit's labels, or backLabel", () => {
        containerWidth = 400;
        const { rerender } = render(
            <UiLabelsProvider labels={{ back: "Indietro", resizeList: "Ridimensiona l'elenco" }}>
                <SplitView master={master} detail={<p>details</p>} onClearSelection={jest.fn()}/>
            </UiLabelsProvider>
        );
        expect(screen.getByRole("button", { name: "Indietro" })).toBeInTheDocument();

        rerender(
            <UiLabelsProvider labels={{ back: "Indietro", resizeList: "Ridimensiona l'elenco" }}>
                <SplitView master={master} detail={<p>details</p>} onClearSelection={jest.fn()} backLabel="All orders"/>
            </UiLabelsProvider>
        );
        expect(screen.getByRole("button", { name: "All orders" })).toBeInTheDocument();

        resizeTo(1000);
        expect(screen.getByRole("separator", { name: "Ridimensiona l'elenco" })).toBeInTheDocument();
    });
});
