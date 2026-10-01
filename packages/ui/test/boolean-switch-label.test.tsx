import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BooleanSwitchWithLabel } from "../src";

/**
 * A labelled switch is one switch, and the one that takes focus has the name.
 *
 * It used to be a `div role="switch"` carrying the label and `tabIndex=-1`,
 * wrapped around the real `button role="switch"` that took focus with no name:
 * a screen reader tabbing into a "Published" field heard "switch, off".
 */
describe("BooleanSwitchWithLabel", () => {

    function Harness({ autoFocus }: { autoFocus?: boolean }) {
        const [value, setValue] = useState(false);
        return <BooleanSwitchWithLabel label="Published" value={value} onValueChange={setValue} autoFocus={autoFocus}/>;
    }

    it("is exactly one switch, named by its label, and the focusable one", () => {
        render(<Harness/>);
        const switches = screen.getAllByRole("switch");
        expect(switches).toHaveLength(1);
        const named = screen.getByRole("switch", { name: "Published" });
        expect(named.tabIndex).toBe(0);
    });

    it("toggles from the keyboard and from a click on the label", () => {
        render(<Harness/>);
        const control = screen.getByRole("switch", { name: "Published" });
        fireEvent.click(control);
        expect(control).toHaveAttribute("aria-checked", "true");
        fireEvent.click(screen.getByText("Published"));
        expect(control).toHaveAttribute("aria-checked", "false");
    });

    it("takes focus when asked to", () => {
        render(<Harness autoFocus/>);
        expect(document.activeElement).toBe(screen.getByRole("switch", { name: "Published" }));
    });

    it("takes a name when the label is drawn outside it", () => {
        render(<BooleanSwitchWithLabel aria-label="Published" value={false} onValueChange={() => undefined}/>);
        expect(screen.getByRole("switch", { name: "Published" })).toBeInTheDocument();
    });
});
