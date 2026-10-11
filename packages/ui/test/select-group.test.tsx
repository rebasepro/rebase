import React from "react";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Select, SelectGroup, SelectItem } from "../src";

// Radix measures the content and scrolls the selected item into view.
class NoopResizeObserver implements ResizeObserver {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
}
globalThis.ResizeObserver = NoopResizeObserver;
Element.prototype.scrollIntoView = function () { /* noop */ };
Element.prototype.hasPointerCapture = function () { return false; };

/**
 * A `SelectGroup` is a group of its items, named by its label.
 *
 * It rendered the label inside the Radix group and the items after it, so the
 * `role="group"` held only the label text, was named by a `SelectLabel` that
 * was never rendered, and every item sat outside any group.
 */
describe("SelectGroup", () => {
    it("holds its items and is named by its label", () => {
        render(<Select aria-label="type" value="a" open onValueChange={() => { /* noop */ }}>
            <SelectGroup label="Text">
                <SelectItem value="a">Short text</SelectItem>
                <SelectItem value="b">Markdown</SelectItem>
            </SelectGroup>
            <SelectGroup label="Numbers">
                <SelectItem value="c">Number</SelectItem>
            </SelectGroup>
        </Select>);

        const text = screen.getByRole("group", { name: "Text" });
        expect(within(text).getAllByRole("option")).toHaveLength(2);
        const numbers = screen.getByRole("group", { name: "Numbers" });
        expect(within(numbers).getAllByRole("option")).toHaveLength(1);
    });
});
