import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MultiSelect, MultiSelectItem } from "../src";

// cmdk measures its list; jsdom has neither of these.
class NoopResizeObserver implements ResizeObserver {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
}
globalThis.ResizeObserver = NoopResizeObserver;
Element.prototype.scrollIntoView = function () { /* noop */ };

/**
 * One value type out of every path, and "(Select All)" means all of them.
 *
 * Clicking an option reported `String(value)`, but "(Select All)" reported the
 * options' raw values filtered through `Boolean`: an item given a number came
 * back as a number from one path and a string from the other, and an option
 * whose value is `""` was dropped from "all" — so the box never showed checked
 * and clicking it never selected that option.
 */
describe("MultiSelect values", () => {

    function openAndPick(text: string) {
        fireEvent.click(screen.getByRole("button", { name: "tags" }));
        const option = screen.getAllByRole("option").find((o) => o.textContent?.includes(text));
        expect(option).toBeDefined();
        fireEvent.click(option!);
    }

    it("Select All includes an empty-string option", () => {
        const onValueChange = jest.fn();
        render(
            <MultiSelect value={[]} onValueChange={onValueChange} aria-label="tags">
                <MultiSelectItem value="">None</MultiSelectItem>
                <MultiSelectItem value="a">Alpha</MultiSelectItem>
            </MultiSelect>
        );
        openAndPick("(Select All)");
        expect(onValueChange).toHaveBeenLastCalledWith(["", "a"]);
    });

    it("Select All shows checked when every option, falsy ones included, is selected", () => {
        render(
            <MultiSelect value={["", "a"]} onValueChange={jest.fn()} aria-label="tags">
                <MultiSelectItem value="">None</MultiSelectItem>
                <MultiSelectItem value="a">Alpha</MultiSelectItem>
            </MultiSelect>
        );
        fireEvent.click(screen.getByRole("button", { name: "tags" }));
        const all = screen.getAllByRole("option").find((o) => o.textContent?.includes("(Select All)"))!;
        // InnerCheckBox draws a check icon only when checked.
        expect(all.querySelector("svg")).not.toBeNull();
    });

    it("an option and Select All report the same values", () => {
        const onValueChange = jest.fn();
        render(
            <MultiSelect value={[]} onValueChange={onValueChange} aria-label="tags">
                <MultiSelectItem value="0">Zero</MultiSelectItem>
                <MultiSelectItem value="1">One</MultiSelectItem>
            </MultiSelect>
        );
        openAndPick("One");
        expect(onValueChange).toHaveBeenLastCalledWith(["1"]);
        const all = screen.getAllByRole("option").find((o) => o.textContent?.includes("(Select All)"))!;
        fireEvent.click(all);
        expect(onValueChange).toHaveBeenLastCalledWith(["0", "1"]);
    });

    it("puts its id on the trigger", () => {
        render(
            <MultiSelect id="file-types" value={[]} onValueChange={jest.fn()} aria-label="tags">
                <MultiSelectItem value="a">Alpha</MultiSelectItem>
            </MultiSelect>
        );
        expect(screen.getByRole("button", { name: "tags" })).toHaveAttribute("id", "file-types");
    });
});
