import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ExpandablePanel } from "../src";

/**
 * The header of an ExpandablePanel is a `role="button"` that takes focus, and a
 * button answers Enter and Space. Radix's trigger only listens for `click`, and
 * a div does not turn a key into a click, so every map/array/block field group,
 * the home page's navigation groups and the Studio home groups could be reached
 * with Tab and not opened.
 */
describe("ExpandablePanel keyboard", () => {

    function header() {
        return screen.getByRole("button", { name: /Advanced/ });
    }

    it("opens and closes with Enter", () => {
        render(<ExpandablePanel title={<span>Advanced</span>} initiallyExpanded={false}><div>Body</div></ExpandablePanel>);
        expect(header()).toHaveAttribute("aria-expanded", "false");
        fireEvent.keyDown(header(), { key: "Enter" });
        expect(header()).toHaveAttribute("aria-expanded", "true");
        fireEvent.keyDown(header(), { key: "Enter" });
        expect(header()).toHaveAttribute("aria-expanded", "false");
    });

    it("opens with Space, without scrolling the page", () => {
        render(<ExpandablePanel title={<span>Advanced</span>} initiallyExpanded={false}><div>Body</div></ExpandablePanel>);
        const notPrevented = fireEvent.keyDown(header(), { key: " " });
        expect(notPrevented).toBe(false);
        expect(header()).toHaveAttribute("aria-expanded", "true");
    });

    it("leaves a key pressed on a control inside the title to that control", () => {
        render(<ExpandablePanel title={<span>Advanced <input aria-label="Filter"/></span>} initiallyExpanded={false}>
            <div>Body</div>
        </ExpandablePanel>);
        fireEvent.keyDown(screen.getByRole("textbox", { name: "Filter" }), { key: " " });
        expect(header()).toHaveAttribute("aria-expanded", "false");
    });
});
