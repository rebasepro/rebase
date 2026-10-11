import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ToggleButtonGroup } from "../src";

/**
 * Every `ToggleButtonGroup` was named "Toggle options", whatever it chose
 * between — which is why the CMS/Studio switch and the API-key dialog
 * hand-rolled their own segmented buttons. The caller now names it.
 */
describe("ToggleButtonGroup", () => {
    const options = [{ value: "cms", label: "Content" }, { value: "studio", label: "Studio" }];

    it("is a group named by the caller", () => {
        render(<ToggleButtonGroup aria-label="Mode" value="cms" onValueChange={() => { /* noop */ }} options={options}/>);
        expect(screen.getByRole("group", { name: "Mode" })).toBeInTheDocument();
    });

    it("has no made-up English name when the caller gives none", () => {
        render(<ToggleButtonGroup value="cms" onValueChange={() => { /* noop */ }} options={options}/>);
        expect(screen.getByRole("group")).not.toHaveAttribute("aria-label", "Toggle options");
    });
});
