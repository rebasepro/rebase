/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, test, jest } from "@jest/globals";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

jest.mock("@rebasepro/app", () => ({
    IconForView: () => <svg data-testid="entry-icon"/>,
    // Mirrors the real helper's contract: a name resolves to an element, nothing
    // resolves to undefined — which is the switch the group renders on.
    getIcon: (key?: string) => (key ? <svg data-testid="group-icon"/> : undefined),
    useTranslation: () => ({ t: (k: string) => k }),
    useComponentOverride: (_slot: string, fallback: unknown) => fallback
}));

import { DrawerNavigationGroup } from "../../src/components/DrawerNavigationGroup";

const entries = [
    { id: "posts", url: "/c/posts", name: "Posts" },
    { id: "authors", url: "/c/authors", name: "Authors" }
] as never;

function renderGroup(props: Record<string, unknown> = {}) {
    const { container } = render(
        <MemoryRouter>
            <DrawerNavigationGroup
                group={"Content"}
                entries={entries}
                collapsed={false}
                onToggleCollapsed={() => undefined}
                drawerOpen={true}
                tooltipsOpen={false}
                {...props}
            />
        </MemoryRouter>
    );
    return container;
}

/**
 * The group label's own classes.
 *
 * Innermost match, not the first: the header wrapper's `textContent` is also
 * "Content" (the label is its only text), so a top-down search returns the
 * wrapper's layout classes instead of the label's typography.
 */
function labelClasses(container: HTMLElement): string[] {
    const el = Array.from(container.querySelectorAll("*"))
        .filter(n => n.textContent === "Content" && n.children.length === 0)
        .pop();
    return String((el as HTMLElement)?.className ?? "").split(/\s+/).filter(Boolean);
}

describe("DrawerNavigationGroup — categorised rendering is opt-in", () => {

    // The regression this exists for: the categorised treatment was briefly applied
    // to every group, which silently restyled the drawer of every project using the
    // framework. A group that declares no icon must render exactly as it always has.
    test("a group with no icon keeps the original label styling", () => {
        const classes = labelClasses(renderGroup());

        expect(classes).toEqual(expect.arrayContaining([
            "font-semibold", "text-[11px]", "uppercase", "tracking-wider",
            "flex-grow", "line-clamp-1", "text-surface-400", "dark:text-surface-400"
        ]));
        // The categorised-only values must not leak in.
        expect(classes).not.toContain("text-[12px]");
        expect(classes).not.toContain("tracking-wide");
        expect(classes).not.toContain("text-surface-600");
    });

    test("a group with no icon renders no group icon, and its entries keep theirs", () => {
        const container = renderGroup();

        expect(container.querySelectorAll("[data-testid='group-icon']")).toHaveLength(0);
        expect(container.querySelectorAll("[data-testid='entry-icon']")).toHaveLength(entries.length);
    });

    test("declaring an icon switches the group to the categorised treatment", () => {
        const container = renderGroup({ icon: "LibraryBig" });
        const classes = labelClasses(container);

        expect(container.querySelectorAll("[data-testid='group-icon']")).toHaveLength(1);
        expect(classes).toEqual(expect.arrayContaining([
            "text-[12px]", "tracking-wide", "text-surface-600"
        ]));
        // Entries give up their icons to indent under the group instead.
        expect(container.querySelectorAll("[data-testid='entry-icon']")).toHaveLength(0);
    });

    // Collapsed to a rail the entry icons are the only thing left to click, so the
    // indent must not apply there however the group is configured.
    test("a collapsed drawer keeps entry icons even for an icon-bearing group", () => {
        const container = renderGroup({ icon: "LibraryBig", drawerOpen: false });

        expect(container.querySelectorAll("[data-testid='group-icon']")).toHaveLength(0);
        expect(container.querySelectorAll("[data-testid='entry-icon']")).toHaveLength(entries.length);
    });
});
