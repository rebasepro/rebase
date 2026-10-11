import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ResizablePanels } from "../src";

/**
 * The divider of the split views (record list | record, SQL editor | results)
 * took only `mousedown`: nothing on a tablet could resize it, and it was not a
 * focusable separator, so neither could a keyboard.
 */
describe("ResizablePanels divider", () => {
    const rect = (width: number): DOMRect => ({
        x: 0, y: 0, top: 0, left: 0, bottom: 500, right: width, width, height: 500,
        toJSON: () => ({})
    });

    beforeEach(() => {
        // The container is 1000px wide; the first panel is whatever basis it was given in px.
        jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
            const basis = this.style.flexBasis;
            if (basis.endsWith("px")) return rect(parseFloat(basis));
            if (basis.endsWith("%")) return rect(parseFloat(basis) * 10);
            return rect(1000);
        });
    });
    afterEach(() => jest.restoreAllMocks());

    function renderPanels(onPanelSizeChange: (n: number) => void) {
        return render(<ResizablePanels
            firstPanel={<div>list</div>}
            secondPanel={<div>record</div>}
            panelSizePercent={40}
            onPanelSizeChange={onPanelSizeChange}
            minPanelSizePx={100}
        />);
    }

    it("is a focusable separator carrying its position", () => {
        renderPanels(jest.fn());
        const separator = screen.getByRole("separator");
        expect(separator).toHaveAttribute("tabindex", "0");
        expect(separator).toHaveAttribute("aria-valuenow", "40");
        expect(separator).toHaveAttribute("aria-orientation", "vertical");
    });

    it("moves with the arrow keys", () => {
        const onPanelSizeChange = jest.fn();
        renderPanels(onPanelSizeChange);
        const separator = screen.getByRole("separator");
        fireEvent.keyDown(separator, { key: "ArrowRight" });
        expect(onPanelSizeChange).toHaveBeenLastCalledWith(42);
        fireEvent.keyDown(separator, { key: "ArrowLeft" });
        expect(onPanelSizeChange).toHaveBeenLastCalledWith(38);
    });

    it("is dragged with a pointer (touch or pen as well as mouse)", () => {
        const onPanelSizeChange = jest.fn();
        renderPanels(onPanelSizeChange);
        const separator = screen.getByRole("separator");
        // jsdom has no PointerEvent; a MouseEvent of the pointer type carries clientX.
        const pointer = (target: EventTarget, type: string, clientX: number) =>
            act(() => { target.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, cancelable: true })); });
        pointer(separator, "pointerdown", 400);
        pointer(window, "pointermove", 500);
        pointer(window, "pointerup", 500);
        expect(onPanelSizeChange).toHaveBeenCalledTimes(1);
        expect(onPanelSizeChange.mock.calls[0][0]).toBeCloseTo(50);
    });
});
