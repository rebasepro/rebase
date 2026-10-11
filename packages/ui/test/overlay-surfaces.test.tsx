import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Dialog, Popover } from "../src";

class NoopResizeObserver implements ResizeObserver {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
}
globalThis.ResizeObserver = NoopResizeObserver;

/**
 * Overlays paint their roles from the theme, like the rest of the kit:
 * - the Dialog's scrim was `bg-black/50 dark:bg-black/60` beside the Sheet's
 *   `bg-surface-scrim` token — two scrims for one role;
 * - the Popover's arrow was `fill-white dark:fill-surface-900` under a
 *   `bg-surface-card` panel, so in dark mode a near-black arrow pointed out of
 *   a lighter panel;
 * - the Popover panel took the global focus ring, so a keyboard-opened popover
 *   drew a 2px ring around the whole panel (Menu and Select already opt out).
 */
describe("overlay surfaces", () => {
    it("the Dialog scrim is the theme's scrim", () => {
        render(<Dialog open onOpenChange={() => { /* noop */ }}><div>Body</div></Dialog>);
        const scrim = document.querySelector("[data-dialog-overlay], .bg-surface-scrim");
        expect(scrim).not.toBeNull();
        expect(document.querySelector(".bg-black\\/50")).toBeNull();
    });

    it("the Popover arrow is the panel's colour and the panel draws no focus ring", () => {
        render(<Popover open trigger={<button>Open</button>}><div>Panel</div></Popover>);
        const panel = screen.getByText("Panel").closest(".PopoverContent")!;
        expect(panel).toHaveClass("focus-visible:ring-0");
        const arrow = panel.querySelector("svg");
        expect(arrow).toHaveClass("fill-surface-card");
    });
});
