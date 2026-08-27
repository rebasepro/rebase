/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, test, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

// The popover measures itself; jsdom has no ResizeObserver.
class ResizeObserverStub {
    observe() { /* no-op */ }
    unobserve() { /* no-op */ }
    disconnect() { /* no-op */ }
}
Object.assign(global, { ResizeObserver: ResizeObserverStub });

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({ t: (k: string) => k }),
    // Mirrors the real helper: a name resolves to an element, nothing resolves
    // to undefined — which is the switch the custom entries render on.
    getIcon: (key?: string) => (key ? <svg data-testid={`icon-${String(key)}`}/> : undefined)
}));

import { ViewModeToggle } from "../../src/components/CollectionViewBinding/ViewModeToggle";

/**
 * The collection's view switcher.
 *
 * `enabledViews` was accepted as a prop and then read nowhere: the options
 * array was four hardcoded built-ins, so a collection that asked for
 * `["list", "table"]` still offered cards and kanban, and picking one rendered
 * it. Custom views need the prop honoured — a switcher that always draws the
 * built-ins has nowhere to put "Map" — so the two are pinned together here.
 *
 * The popover renders its content inline (`modal={false}`, open), so the
 * options are queryable without driving the trigger.
 */
function renderToggle(props: Record<string, unknown> = {}) {
    return render(
        <ViewModeToggle
            viewMode={"table"}
            onViewModeChange={() => undefined}
            open={true}
            {...props}
        />
    );
}

const MAP_VIEW = { key: "map", name: "Map", icon: "Map", Builder: () => null } as never;

describe("ViewModeToggle honours enabledViews", () => {
    test("offers every built-in by default", () => {
        renderToggle();
        for (const label of ["list", "table_view_mode", "cards", "board"]) {
            expect(screen.getAllByText(label).length).toBeGreaterThan(0);
        }
    });

    test("offers only the modes the collection enabled", () => {
        renderToggle({ enabledViews: ["list", "table"] });
        expect(screen.getAllByText("list").length).toBeGreaterThan(0);
        expect(screen.getAllByText("table_view_mode").length).toBeGreaterThan(0);
        // These used to be offered regardless, and switching to one worked.
        expect(screen.queryByText("cards")).toBeNull();
        expect(screen.queryByText("board")).toBeNull();
    });
});

describe("ViewModeToggle renders custom views", () => {
    test("draws a custom entry with its own name and icon", () => {
        renderToggle({
            enabledViews: ["table", "map"],
            customViews: [MAP_VIEW]
        });
        expect(screen.getAllByText("Map").length).toBeGreaterThan(0);
        expect(screen.getAllByTestId("icon-Map").length).toBeGreaterThan(0);
    });

    test("labels the trigger with the active custom view", () => {
        renderToggle({
            viewMode: "map",
            enabledViews: ["table", "map"],
            customViews: [MAP_VIEW]
        });
        // The declared name, not a translation key and not "undefined".
        expect(screen.getAllByText("Map").length).toBeGreaterThan(0);
    });

    test("skips an enabled key that resolves to nothing", () => {
        // Rather than drawing a nameless button for a view that was removed
        // from the registry but is still named in `enabledViews`.
        const { container } = renderToggle({
            enabledViews: ["table", "ghost"],
            customViews: []
        });
        expect(container.textContent).not.toContain("ghost");
    });

    test("hides itself when there is one mode and nothing else to offer", () => {
        // `enabledViews: ["map"]` — a switcher with a single option is a
        // trigger that opens a panel with nothing to choose.
        const { container } = renderToggle({
            viewMode: "map",
            enabledViews: ["map"],
            customViews: [MAP_VIEW]
        });
        expect(container.innerHTML).toBe("");
    });

    test("keeps the trigger when a lone mode still has a size selector", () => {
        const { container } = renderToggle({
            viewMode: "list",
            enabledViews: ["list"],
            size: "m",
            onSizeChanged: () => undefined
        });
        expect(container.innerHTML).not.toBe("");
    });
});
