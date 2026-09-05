/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, test, jest } from "@jest/globals";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";

jest.mock("@rebasepro/app", () => ({
    IconForView: () => <svg data-testid="entry-icon"/>,
    // Mirrors the real helper's contract: a name resolves to an element, nothing
    // resolves to undefined — which is the switch the group renders on.
    getIcon: (key?: string) => (key ? <svg data-testid="group-icon"/> : undefined),
    useTranslation: () => ({ t: (k: string) => k }),
    // Only the header label is translated; the group name stays the identifier
    // the icon mapping and the collapse memory key off.
    useNavigationGroupLabel: () => (group: string) => group,
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

describe("DrawerNavigationGroup — a group icon decorates the header only", () => {

    // The regression this exists for: a group icon used to also restyle the header
    // and strip every entry beneath it of its own icon. That made one app's styling
    // choice into framework behaviour — every project that labelled a group with an
    // icon lost the icons on its rows, with no way to turn it off. An app that wants
    // that look builds it in its own drawer, by overriding
    // `Shell.DrawerNavigationItem` and passing `indented`.
    const ORIGINAL_LABEL = [
        "font-semibold", "text-[11px]", "uppercase", "tracking-wider",
        "flex-grow", "line-clamp-1", "text-surface-400", "dark:text-surface-400"
    ];

    test("a group with no icon renders no group icon, and its entries keep theirs", () => {
        const container = renderGroup();

        expect(labelClasses(container)).toEqual(expect.arrayContaining(ORIGINAL_LABEL));
        expect(container.querySelectorAll("[data-testid='group-icon']")).toHaveLength(0);
        expect(container.querySelectorAll("[data-testid='entry-icon']")).toHaveLength(entries.length);
    });

    test("declaring an icon adds the header icon and changes nothing else", () => {
        const container = renderGroup({ icon: "LibraryBig" });

        expect(container.querySelectorAll("[data-testid='group-icon']")).toHaveLength(1);
        // The label keeps the styling it has with no icon...
        expect(labelClasses(container)).toEqual(expect.arrayContaining(ORIGINAL_LABEL));
        // ...and, the point of the whole test file, so do the rows.
        expect(container.querySelectorAll("[data-testid='entry-icon']")).toHaveLength(entries.length);
    });

    test("a collapsed drawer hides the header icon and keeps the entry icons", () => {
        const container = renderGroup({ icon: "LibraryBig", drawerOpen: false });

        expect(container.querySelectorAll("[data-testid='group-icon']")).toHaveLength(0);
        expect(container.querySelectorAll("[data-testid='entry-icon']")).toHaveLength(entries.length);
    });
});
