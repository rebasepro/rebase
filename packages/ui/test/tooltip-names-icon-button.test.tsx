import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Button, IconButton, Tooltip, Trash2Icon } from "../src";

/**
 * A tooltip's title names the icon-only button it wraps. Radix only describes
 * the trigger, and only while the tooltip is open, so 54 tooltip-wrapped icon
 * buttons in the product were announced as "button".
 */
describe("Tooltip names an icon-only button", () => {

    it("with the wrapper", () => {
        render(<Tooltip title="Delete row"><IconButton><Trash2Icon/></IconButton></Tooltip>);
        expect(screen.getByRole("button", { name: "Delete row" })).toBeInTheDocument();
    });

    it("as the trigger itself", () => {
        render(<Tooltip asChild title="Delete row"><IconButton><Trash2Icon/></IconButton></Tooltip>);
        expect(screen.getByRole("button", { name: "Delete row" })).toBeInTheDocument();
    });

    it("but leaves a name the button already has", () => {
        render(<Tooltip title="Delete this row and its children"><IconButton aria-label="Delete"><Trash2Icon/></IconButton></Tooltip>);
        expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    });

    it("and leaves a button with text named by its text", () => {
        render(<Tooltip title="Save the record (Ctrl+S)"><Button>Save</Button></Tooltip>);
        expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    });
});
