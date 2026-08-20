import React from "react";
import { render, screen } from "@testing-library/react";
import { Sheet, usePortalContainer } from "../src";
import "@testing-library/jest-dom";

/**
 * The side panel hands its descendants a portal host so their popups open
 * inside the panel, where the modal's focus and scroll locks let them be
 * used at all. That host is the panel itself, which is also the element the
 * slide animation transforms — and that is where this went wrong.
 *
 * `will-change: transform` (like `transform` itself) makes an element a
 * containing block for its `position: fixed` descendants. A Select dropdown
 * is fixed and positioned in *viewport* coordinates, so once the panel was a
 * containing block every dropdown was resolved against the panel instead and
 * came out displaced by the panel's own left offset. A Select on the right of
 * a right-hand panel opened its list past the edge of the screen: open, but
 * nowhere anyone could see it, which reads exactly like a Select that refuses
 * to open.
 *
 * jsdom computes no layout, so the test pins the cause rather than the
 * symptom: whatever else the host wears, it may not wear anything that
 * promotes it to a containing block.
 */
function PortalContainerProbe() {
    const container = usePortalContainer();
    return <div data-testid="probe" data-has-container={container ? "yes" : "no"}/>;
}

/** Properties that make an element a containing block for fixed descendants. */
const CONTAINING_BLOCK_CLASSES = [
    "will-change-transform",
    "will-change-[transform",
    "transform-gpu",
    "filter",
    "backdrop-blur",
    "perspective"
];

describe("Sheet portal container", () => {

    it("hands descendants a host that lives inside the sheet", () => {
        render(<Sheet open={true}>
            <PortalContainerProbe/>
        </Sheet>);

        const probe = screen.getByTestId("probe");
        expect(probe.dataset.hasContainer).toBe("yes");
        expect(screen.getByRole("dialog")).toContainElement(probe);
    });

    it("does not turn the host into a containing block for fixed popups", () => {
        render(<Sheet open={true}>
            <PortalContainerProbe/>
        </Sheet>);

        const host = screen.getByRole("dialog");
        for (const promoted of CONTAINING_BLOCK_CLASSES) {
            expect(host.className).not.toContain(promoted);
        }
    });

    it("falls back to no container outside a sheet", () => {
        render(<PortalContainerProbe/>);
        expect(screen.getByTestId("probe").dataset.hasContainer).toBe("no");
    });
});
