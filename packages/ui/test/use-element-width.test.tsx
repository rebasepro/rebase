import React from "react";
import { render, screen } from "@testing-library/react";
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
