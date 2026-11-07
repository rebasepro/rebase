/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
    DataDisplaySection,
    DisclosureLayoutSection,
    MoreControlsSection,
    OverlaysSection,
    SplitViewSection
} from "../src/debug/ui-reference/ComponentSections";

/**
 * The reference's component chapters render, and the overlays open from the
 * keyboard-reachable triggers they show: the page is the design source of
 * truth, and a chapter that throws takes the whole page down with it.
 */
beforeAll(() => {
    // jsdom has no layout observers; VirtualTable and ResizablePanels ask for one.
    class NoopResizeObserver {
        observe() { /* noop */ }
        unobserve() { /* noop */ }
        disconnect() { /* noop */ }
    }
    Object.assign(globalThis, { ResizeObserver: globalThis.ResizeObserver ?? NoopResizeObserver });
});

describe("UI reference component chapters", () => {
    it("render every chapter", () => {
        render(<>
            <MoreControlsSection/>
            <OverlaysSection/>
            <DisclosureLayoutSection/>
            <DataDisplaySection/>
        </>);
        for (const title of ["More form controls", "Overlays — Dialog, Sheet, Popover, Menubar", "Disclosure and layout", "Data display — Badge, InfoLabel, Markdown, VirtualTable"]) {
            expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
        }
        expect(screen.getByRole("separator", { name: "Resize the list" })).toBeInTheDocument();
        expect(screen.getByRole("group", { name: "View mode" })).toBeInTheDocument();
    });

    it("shows the split view side by side and drilled down", () => {
        render(<SplitViewSection/>);
        expect(screen.getByRole("heading", { name: "Split view" })).toBeInTheDocument();
        // jsdom measures every box as 0px wide, so both specimens take the
        // narrow layout: the selected order covers the list under a back bar.
        expect(screen.getAllByRole("button", { name: "Back" })).toHaveLength(2);
        fireEvent.click(screen.getAllByRole("button", { name: "Back" })[0]);
        expect(screen.getAllByRole("button", { name: "Back" })).toHaveLength(1);
    });

    it("opens the dialog with its title and actions", () => {
        render(<OverlaysSection/>);
        fireEvent.click(screen.getByRole("button", { name: "Rename collection" }));
        const dialog = screen.getByRole("dialog", { name: "Rename collection" });
        expect(dialog).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });
});
