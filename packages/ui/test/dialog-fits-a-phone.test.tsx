import React from "react";
import { render, screen } from "@testing-library/react";
import { Dialog } from "../src";
import "@testing-library/jest-dom";

/**
 * The paper never runs wider than the screen.
 *
 * `fullWidth` (the default) sized the paper to `w-11/12` of the viewport and
 * `maxWidth` added `max-w-lg w-lg`. The class merge keeps the last of two
 * widths, so `w-11/12` was dropped and every default dialog was a fixed 512px:
 * on a 375px phone it ran edge to edge or past it. jsdom lays nothing out, so
 * this reads the classes the paper's box carries, which is what decides it.
 */
function boxClasses(): string[] {
    return screen.getByRole("dialog").className.split(/\s+/);
}

describe("Dialog width", () => {
    it("is a share of the viewport, capped at maxWidth, by default", () => {
        render(<Dialog open={true}>content</Dialog>);
        const classes = boxClasses();
        expect(classes).toContain("w-11/12");
        expect(classes).toContain("max-w-lg");
        expect(classes).not.toContain("w-lg");
    });

    it.each(["xs", "md", "2xl", "4xl"] as const)("keeps the viewport share with maxWidth %s", (maxWidth) => {
        render(<Dialog open={true} maxWidth={maxWidth}>content</Dialog>);
        const classes = boxClasses();
        expect(classes).toContain("w-11/12");
        expect(classes).toContain(`max-w-${maxWidth}`);
        expect(classes).not.toContain(`w-${maxWidth}`);
    });

    it("without fullWidth, takes maxWidth's width but no more than the viewport share", () => {
        render(<Dialog open={true} fullWidth={false} maxWidth={"2xl"}>content</Dialog>);
        const classes = boxClasses();
        expect(classes).toContain("w-2xl");
        expect(classes).toContain("max-w-11/12");
        expect(classes).not.toContain("max-w-2xl");
    });

    it("fills the screen when fullScreen, whatever maxWidth says", () => {
        render(<Dialog open={true} fullScreen maxWidth={"lg"}>content</Dialog>);
        const classes = boxClasses();
        expect(classes).toContain("w-screen");
        expect(classes.filter(c => c.startsWith("max-w-"))).toEqual([]);
    });
});
