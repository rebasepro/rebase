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

/**
 * The trigger shows the selected item's label wherever the item sits. It
 * looked for the item among the select's direct children only, so a value
 * held by an item inside a `SelectGroup` or a fragment showed the placeholder.
 */
describe("a Select's trigger", () => {
    it("shows the label of a selected item inside a group", () => {
        render(<Select aria-label="type" value="b" placeholder="Pick one" onValueChange={() => { /* noop */ }}>
            <SelectGroup label="Text">
                <SelectItem value="a">Short text</SelectItem>
                <SelectItem value="b">Markdown</SelectItem>
            </SelectGroup>
        </Select>);

        expect(screen.getByRole("combobox")).toHaveTextContent("Markdown");
        expect(screen.getByRole("combobox")).not.toHaveTextContent("Pick one");
    });

    it("shows the label of a selected item inside a fragment", () => {
        render(<Select aria-label="type" value="b" placeholder="Pick one" onValueChange={() => { /* noop */ }}>
            <>
                <SelectItem value="a">Short text</SelectItem>
                <SelectItem value="b">Markdown</SelectItem>
            </>
        </Select>);

        expect(screen.getByRole("combobox")).toHaveTextContent("Markdown");
    });
});
