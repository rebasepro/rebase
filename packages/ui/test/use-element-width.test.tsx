import React from "react";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useElementWidth } from "../src";

/**
 * Where there is no `ResizeObserver` the element is still measured, once, and
 * nothing throws: a test environment or an old embedded browser draws the
 * layout of the width it has.
 */
function Measured() {
    const [ref, width] = useElementWidth<HTMLDivElement>();
    return <div ref={ref}>{`width ${width}`}</div>;
}

describe("useElementWidth without ResizeObserver", () => {
    const original = globalThis.ResizeObserver;

    beforeEach(() => {
        Reflect.deleteProperty(globalThis, "ResizeObserver");
        jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
            x: 0, y: 0, top: 0, left: 0, bottom: 100, right: 640, width: 640, height: 100, toJSON: () => ({})
        }));
    });
    afterEach(() => {
        jest.restoreAllMocks();
        if (original) globalThis.ResizeObserver = original;
    });

    it("measures the element once and does not throw", () => {
        expect(typeof ResizeObserver).toBe("undefined");
        render(<Measured/>);
        expect(screen.getByText("width 640")).toBeInTheDocument();
    });
});

/**
 * With a `ResizeObserver`, a resize is measured as the first read was: the
 * border box. The content box — narrower by the padding — would make a
 * padded element's width jump at its first resize.
 */
describe("useElementWidth with ResizeObserver", () => {
    const original = globalThis.ResizeObserver;
    let notify: ((entries: ResizeObserverEntry[]) => void) | undefined;

    class FakeResizeObserver {
        constructor(callback: (entries: ResizeObserverEntry[]) => void) {
            notify = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
    }

    function entry(target: Element, size: { border?: number; content: number }): ResizeObserverEntry {
        return {
            target,
            contentRect: { x: 0, y: 0, top: 0, left: 0, bottom: 100, right: size.content, width: size.content, height: 100, toJSON: () => ({}) },
            borderBoxSize: size.border === undefined ? [] : [{ inlineSize: size.border, blockSize: 100 }],
            contentBoxSize: [{ inlineSize: size.content, blockSize: 100 }],
            devicePixelContentBoxSize: []
        };
    }

    beforeEach(() => {
        Object.assign(globalThis, { ResizeObserver: FakeResizeObserver });
        jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
            x: 0, y: 0, top: 0, left: 0, bottom: 100, right: 640, width: 640, height: 100, toJSON: () => ({})
        }));
    });
    afterEach(() => {
        jest.restoreAllMocks();
        if (original) globalThis.ResizeObserver = original;
        else Reflect.deleteProperty(globalThis, "ResizeObserver");
    });

    it("reads the border box on every resize, as on mount", () => {
        render(<Measured/>);
        expect(screen.getByText("width 640")).toBeInTheDocument();
        const element = screen.getByText("width 640");

        act(() => notify!([entry(element, { border: 700, content: 668 })]));
        expect(screen.getByText("width 700")).toBeInTheDocument();
    });

    it("falls back to the element's bounding box where the entry has no border box", () => {
        render(<Measured/>);
        const element = screen.getByText("width 640");
        act(() => notify!([entry(element, { content: 608 })]));
        expect(screen.getByText("width 640")).toBeInTheDocument();
    });
});
