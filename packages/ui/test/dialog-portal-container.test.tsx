import React from "react";
import { render, screen } from "@testing-library/react";
import { Dialog, usePortalContainer } from "../src";
import "@testing-library/jest-dom";

/**
 * A modal dialog locks scrolling everywhere but its own content, so a popup
 * portaled to `document.body` opens looking fine and then refuses to scroll —
 * `react-remove-scroll` cancels every wheel event raised outside the lock.
 *
 * The fix is that the dialog offers descendants a portal host inside its own
 * content. These tests pin that contract: the host exists, it lives inside the
 * dialog, and it sits above the paper so popups are not painted behind it.
 */
function PortalContainerProbe() {
    const container = usePortalContainer();
    return <div data-testid="probe" data-has-container={container ? "yes" : "no"}
        data-container-class={container?.className ?? ""}/>;
}

describe("Dialog portal container", () => {

    it("hands descendants a host that lives inside the dialog", () => {
        render(<Dialog open={true}>
            <PortalContainerProbe/>
        </Dialog>);

        const probe = screen.getByTestId("probe");
        expect(probe.dataset.hasContainer).toBe("yes");

        const dialog = screen.getByRole("dialog");
        const host = dialog.querySelector(`.${probe.dataset.containerClass!.split(" ").join(".")}`);
        expect(host).toBeInTheDocument();
    });

    it("stacks the host above the paper so popups are not hidden behind it", () => {
        render(<Dialog open={true}>
            <PortalContainerProbe/>
        </Dialog>);

        // `z-60` is the paper. Anything portaled into the host has to win against it.
        const hostClasses = screen.getByTestId("probe").dataset.containerClass!;
        expect(hostClasses).toContain("relative");
        expect(hostClasses).toContain("z-70");
    });

    it("falls back to no container outside a dialog", () => {
        render(<PortalContainerProbe/>);
        expect(screen.getByTestId("probe").dataset.hasContainer).toBe("no");
    });
});
